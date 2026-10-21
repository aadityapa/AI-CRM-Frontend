/**
 * Change a timesheet's period (19 Oct 2026; neighbour-aware 20 Oct 2026).
 *
 * Some customers bill on a 21st–20th cycle: the March sheet runs 21 Feb – 20 Mar,
 * April 21 Mar – 20 Apr, and a long bridge sheet takes them back to calendar
 * months. The period may therefore start in an earlier month or end in a later
 * one. The server enforces the rules (`period_window_error`, no overlap, the
 * employee's dates on the project); this dialog reads
 * `GET /api/timesheets/{id}/period-options` first so it never offers a period
 * the server would refuse:
 *
 *  - a LOCKED neighbour (submitted / approved / invoiced) already bills its days
 *    → the quick picks start after it, and a hand-typed overlap is explained
 *    with a one-click fix;
 *  - an OPEN neighbour (Draft / Rejected) gives its days up — they MOVE onto
 *    this sheet with their hours (`adjust_neighbours`);
 *  - days this change removes go to the open sheet right next to them, with
 *    their hours, instead of being deleted (`hand_over_removed`).
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRightLeft, CalendarClock, CalendarRange, Info, Trash2 } from "lucide-react";

import { crmGet } from "../api";
import { Modal } from "./ui";
import { DialogActions, DialogFailure, DialogHero, DialogSection, WhatHappens } from "./dialogKit";
import { CONTROL } from "./controlTower";

export const MAX_PERIOD_DAYS = 62;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];

/** Local "YYYY-MM-DD" — never toISOString (UTC would shift the day in IST). */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
export const daysBetween = (start: string, end: string) =>
  Math.round((parse(end).getTime() - parse(start).getTime()) / 86_400_000) + 1;
const monthStart = (y: number, m: number) => isoDay(new Date(y, m - 1, 1));
const monthEnd = (y: number, m: number) => isoDay(new Date(y, m, 0));
export const shiftDay = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return isoDay(d); };
/** Last day of the one-month cycle that starts on `s` (21 Apr → 20 May). PURE. */
export function cycleEnd(s: string): string {
  const d = parse(s);
  const y = d.getFullYear(), m = d.getMonth() + 1;
  const last = new Date(y, m + 1, 0).getDate();
  return shiftDay(isoDay(new Date(y, m, Math.min(d.getDate(), last))), -1);
}
export const fmtDay = (s: string) =>
  parse(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const short = (s: string) => parse(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** The server's `period_window_error`, client side. PURE. */
export function periodProblem(year: number, month: number, start: string, end: string): string | null {
  if (!start || !end) return "Pick both dates";
  if (end < start) return "The end date is before the start date";
  const n = daysBetween(start, end);
  if (n > MAX_PERIOD_DAYS) return `A timesheet period can be at most ${MAX_PERIOD_DAYS} days long (this is ${n})`;
  if (end < monthStart(year, month) || start > monthEnd(year, month)) {
    return `The period must include at least one day of ${MONTHS[month - 1]} ${year} — this is that month's timesheet`;
  }
  return null;
}

export type Neighbour = {
  id: number; label: string; start: string; end: string; status: string; open: boolean;
};
export type PeriodOptions = {
  current: { start: string; end: string };
  previous: Neighbour | null;
  next: Neighbour | null;
  joined_on: string | null;
  left_on: string | null;
  free_start: string | null;
  free_end: string | null;
};

/** Quick picks for the sheet's month, kept inside the free span when the
 * server says a LOCKED neighbour or the employee's joining / leaving date
 * gets in the way (the pick then names its real dates). PURE. */
export function periodPresets(year: number, month: number, opts?: PeriodOptions | null):
  { key: string; label: string; start: string; end: string; note?: string }[] {
  const prev = new Date(year, month - 2, 1);
  const py = prev.getFullYear(), pm = prev.getMonth() + 1;
  const clamp = (s: string, e: string) => {
    let note: string | undefined;
    if (opts?.free_start && s < opts.free_start) {
      s = opts.free_start;
      note = opts.joined_on === s ? "starts on the joining date" : `${opts.previous?.label ?? "the previous sheet"} ends ${short(shiftDay(s, -1))}`;
    }
    if (opts?.free_end && e > opts.free_end) {
      e = opts.free_end;
      note = opts.left_on === e ? "ends on the last working day" : `${opts.next?.label ?? "the next sheet"} starts ${short(shiftDay(e, 1))}`;
    }
    return { s, e, note };
  };
  const out = [
    { key: "calendar", base: [monthStart(year, month), monthEnd(year, month)], name: "Calendar month" },
    { key: "21-20", base: [isoDay(new Date(py, pm - 1, 21)), isoDay(new Date(year, month - 1, 20))], name: "21st → 20th" },
    { key: "20-19", base: [isoDay(new Date(py, pm - 1, 20)), isoDay(new Date(year, month - 1, 19))], name: "20th → 19th" },
  ];
  return out.map((p) => {
    const { s, e, note } = clamp(p.base[0], p.base[1]);
    return { key: p.key, label: `${p.name} (${short(s)} – ${short(e)})`, start: s, end: e, note };
  });
}

export type PeriodEntry = { entry_date: string; hours_worked?: number | null; leave_type?: string | null };

/** What applying the window does to the grid. PURE. */
export function periodChange(entries: PeriodEntry[], start: string, end: string) {
  const have = new Set(entries.map((e) => e.entry_date.slice(0, 10)));
  const removed = entries.filter((e) => {
    const d = e.entry_date.slice(0, 10);
    return d < start || d > end;
  });
  const withWork = removed.filter((e) => Number(e.hours_worked || 0) > 0 || !!e.leave_type);
  let added = 0;
  if (start && end && end >= start && daysBetween(start, end) <= 400) {
    for (let d = start; d <= end; d = shiftDay(d, 1)) if (!have.has(d)) added += 1;
  }
  return { added, removed: removed.length, removedWithWork: withWork.length };
}

export type NeighbourEffect = {
  /** Why the server would refuse, with the dates to use instead. */
  blocker: { text: string; fix?: { start?: string; end?: string; label: string } } | null;
  /** Open neighbours giving days to this sheet (moved with their hours). */
  takes: { from: Neighbour; days: number; newStart: string; newEnd: string }[];
  /** The open neighbour that can take the removed days, and what it becomes. */
  handOver: { to: Neighbour; days: number; newStart: string; newEnd: string; tooLong: boolean } | null;
};

/** What the chosen dates do to the sheets either side. PURE — mirrors the server. */
export function neighbourEffect(opts: PeriodOptions | null, s: string, e: string): NeighbourEffect {
  const out: NeighbourEffect = { blocker: null, takes: [], handOver: null };
  if (!opts || !s || !e || e < s) return out;
  if (opts.joined_on && s < opts.joined_on) {
    out.blocker = { text: `The employee joined this project on ${fmtDay(opts.joined_on)} — days before that would be billed.`,
      fix: { start: opts.joined_on, label: `Start on ${short(opts.joined_on)}` } };
    return out;
  }
  if (opts.left_on && e > opts.left_on) {
    out.blocker = { text: `The employee's last day on this project is ${fmtDay(opts.left_on)}.`,
      fix: { end: opts.left_on, label: `End on ${short(opts.left_on)}` } };
    return out;
  }
  const prev = opts.previous, next = opts.next;
  if (prev && s <= prev.end) {
    if (!prev.open) {
      const day = shiftDay(prev.end, 1);
      out.blocker = { text: `${prev.label} is ${prev.status} and already bills ${fmtDay(prev.start)} – ${fmtDay(prev.end)}. Those days cannot be on this sheet too.`,
        fix: { start: day, label: `Start on ${short(day)}` } };
      return out;
    }
    const newEnd = shiftDay(s, -1);
    if (newEnd < prev.start) {
      out.blocker = { text: `This would take every day of ${prev.label} (${fmtDay(prev.start)} – ${fmtDay(prev.end)}).` };
      return out;
    }
    out.takes.push({ from: prev, days: daysBetween(s, prev.end), newStart: prev.start, newEnd });
  }
  if (next && e >= next.start) {
    if (!next.open) {
      const day = shiftDay(next.start, -1);
      out.blocker = { text: `${next.label} is ${next.status} and already bills ${fmtDay(next.start)} – ${fmtDay(next.end)}.`,
        fix: { end: day, label: `End on ${short(day)}` } };
      return out;
    }
    const newStart = shiftDay(e, 1);
    if (newStart > next.end) {
      out.blocker = { text: `This would take every day of ${next.label} (${fmtDay(next.start)} – ${fmtDay(next.end)}).` };
      return out;
    }
    out.takes.push({ from: next, days: daysBetween(next.start, e), newStart, newEnd: next.end });
  }
  // Removed days → the open sheet right next to them.
  const cur = opts.current;
  if (e < cur.end && next && next.open && next.start === shiftDay(cur.end, 1)) {
    const newStart = shiftDay(e, 1);
    out.handOver = { to: next, days: daysBetween(newStart, cur.end), newStart, newEnd: next.end,
      tooLong: daysBetween(newStart, next.end) > MAX_PERIOD_DAYS };
  } else if (s > cur.start && prev && prev.open && prev.end === shiftDay(cur.start, -1)) {
    const newEnd = shiftDay(s, -1);
    out.handOver = { to: prev, days: daysBetween(cur.start, newEnd), newStart: prev.start, newEnd,
      tooLong: daysBetween(prev.start, newEnd) > MAX_PERIOD_DAYS };
  }
  return out;
}

export type ApplyPeriodOptions = { adjust_neighbours: boolean; hand_over_removed: boolean };

export function TimesheetPeriodModal({ timesheetId, year, month, start, end, entries, employeeName, onApply, onClose }: {
  timesheetId: number;
  year: number; month: number; start: string; end: string;
  entries: PeriodEntry[]; employeeName?: string | null;
  /** Saves; throws with the server's reason on refusal. */
  onApply: (start: string, end: string, opts: ApplyPeriodOptions) => Promise<void>;
  onClose: () => void;
}) {
  const [s, setS] = useState(start);
  const [e, setE] = useState(end);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [opts, setOpts] = useState<PeriodOptions | null>(null);
  const [handOverOn, setHandOverOn] = useState(true);

  useEffect(() => {
    let alive = true;
    crmGet<PeriodOptions>(`/api/timesheets/${timesheetId}/period-options`)
      .then((r) => { if (alive) setOpts(r.data); })
      .catch(() => { /* an older server: the dialog still works, the server has the final word */ });
    return () => { alive = false; };
  }, [timesheetId]);

  const presets = useMemo(() => periodPresets(year, month, opts), [year, month, opts]);
  const problem = periodProblem(year, month, s, e);
  const effect = useMemo(() => neighbourEffect(opts, s, e), [opts, s, e]);
  const change = useMemo(() => periodChange(entries, s, e), [entries, s, e]);
  const unchanged = s === start && e === end;
  const days = !problem ? daysBetween(s, e) : 0;
  const crosses = !problem && (s < monthStart(year, month) || e > monthEnd(year, month));
  const longer = !problem && crosses && e > cycleEnd(s);
  const handOver = effect.handOver && !effect.handOver.tooLong ? effect.handOver : null;
  const handing = !!handOver && handOverOn;
  const blocked = !!problem || !!effect.blocker;
  // Inputs reach two months either way — the server has the final word.
  const minDate = isoDay(new Date(year, month - 3, 1));
  const maxDate = isoDay(new Date(year, month + 2, 0));

  const apply = async () => {
    if (blocked || unchanged || busy) return;
    setBusy(true); setErr(null);
    try {
      await onApply(s, e, { adjust_neighbours: effect.takes.length > 0, hand_over_removed: handing });
      onClose();
    } catch (ex: any) {
      setErr(ex?.message || "Could not change the period");
    } finally {
      setBusy(false);
    }
  };

  const hint = problem || effect.blocker?.text
    || (unchanged ? "Pick a different start or end date" : `${days} days · ${fmtDay(s)} to ${fmtDay(e)}`);

  return (
    <Modal title="Change timesheet period" medium onClose={() => { if (!busy) onClose(); }} dirty={!unchanged}
      hero={<DialogHero tone="sky" icon={CalendarRange} eyebrow={`${MONTHS[month - 1]} ${year} timesheet`}
        title="Change the period"
        subtitle="The period can start in the previous month or end in the next — for customers who bill 21st to 20th."
        person={employeeName ? { name: employeeName } : null} />}
      footer={
        <div className="space-y-2">
          <DialogFailure message={err} />
          <DialogActions tone="sky" icon={CalendarClock} label="Apply period" busy={busy} busyLabel="Applying…"
            disabled={blocked || unchanged} onCancel={onClose} onConfirm={apply} hint={hint} />
        </div>
      }>
      <div className="space-y-4">
        {opts && (opts.previous || opts.next) && (
          <div className="flex flex-wrap gap-2 text-xs">
            {[opts.previous, opts.next].filter(Boolean).map((n) => (
              <span key={n!.id} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${n!.open
                ? "bg-surface-2 text-secondary" : "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"}`}>
                {n!.label}: {short(n!.start)} – {short(n!.end)} · {n!.status}
              </span>
            ))}
          </div>
        )}

        <DialogSection n={1} title="Quick pick" tone="sky" done={presets.some((p) => p.start === s && p.end === e)}>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => {
              const on = p.start === s && p.end === e;
              return (
                <button key={p.key} type="button" onClick={() => { setS(p.start); setE(p.end); }}
                  aria-pressed={on} title={p.note}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${on
                    ? "border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
                    : "border-subtle bg-surface-1 text-secondary hover:bg-surface-2"}`}>
                  {p.label}{p.note ? <span className="ml-1 font-normal text-muted">· {p.note}</span> : null}
                </button>
              );
            })}
            {s !== start || e !== end ? (
              <button type="button" onClick={() => { setS(start); setE(end); }}
                className="rounded-full border border-dashed border-subtle px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface-2">
                Back to {fmtDay(start)} – {fmtDay(end)}
              </button>
            ) : null}
          </div>
        </DialogSection>

        <DialogSection n={2} title="Dates" tone="sky" done={!blocked}>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-secondary">
              Start date
              <input type="date" className={`${CONTROL} w-44`} value={s} min={minDate} max={maxDate}
                onChange={(ev) => setS(ev.target.value)} aria-label="Period start date" />
            </label>
            <span className="pb-2 text-muted" aria-hidden>→</span>
            <label className="flex flex-col gap-1 text-xs font-semibold text-secondary">
              End date
              <input type="date" className={`${CONTROL} w-44`} value={e} min={minDate} max={maxDate}
                onChange={(ev) => setE(ev.target.value)} aria-label="Period end date" />
            </label>
            {!problem && (
              <span className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
                {days} days{crosses ? " · crosses a month" : ""}
              </span>
            )}
          </div>
          {problem && <p className="mt-2 text-sm font-semibold text-danger">{problem}</p>}
          {!problem && effect.blocker && (
            <div role="alert" className="mt-3 flex flex-wrap items-start gap-2 rounded-card border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">{effect.blocker.text}</span>
              {effect.blocker.fix && (
                <button type="button"
                  onClick={() => { if (effect.blocker?.fix?.start) setS(effect.blocker.fix.start); if (effect.blocker?.fix?.end) setE(effect.blocker.fix.end); }}
                  className="rounded-full bg-amber-600 px-3 py-1 text-xs font-bold text-[#fff] hover:bg-amber-700">
                  {effect.blocker.fix.label}
                </button>
              )}
            </div>
          )}
          {!problem && !effect.blocker && effect.takes.map((t) => (
            <div key={t.from.id} className="mt-3 flex items-start gap-2 rounded-card border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900 dark:border-sky-500/40 dark:bg-sky-950/30 dark:text-sky-200">
              <ArrowRightLeft className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                <b>{t.from.label}</b> ({t.from.status}) gives {t.days} day{t.days === 1 ? "" : "s"} to this sheet — they move here
                with their hours and leave. {t.from.label} will run {fmtDay(t.newStart)} – {fmtDay(t.newEnd)}.
              </span>
            </div>
          ))}
        </DialogSection>

        {!problem && !effect.blocker && !unchanged && (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-card border border-subtle bg-surface-2 px-3 py-2.5">
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Days added</div>
              <div className="text-xl font-bold tabular-nums text-primary">{change.added}</div>
              <div className="text-xs text-secondary">
                {effect.takes.length
                  ? "Moved from the neighbouring sheet with their hours; any others pre-filled from the billing policy"
                  : "New rows, pre-filled from the billing policy"}
              </div>
            </div>
            <div className={`rounded-card border px-3 py-2.5 ${change.removedWithWork && !handing
              ? "border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-950/30" : "border-subtle bg-surface-2"}`}>
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Days removed
              </div>
              <div className="text-xl font-bold tabular-nums text-primary">{change.removed}</div>
              <div className={`text-xs ${change.removedWithWork && !handing ? "font-semibold text-danger" : "text-secondary"}`}>
                {handing
                  ? `They go to ${handOver!.to.label} with their hours — nothing is deleted`
                  : change.removedWithWork
                    ? `${change.removedWithWork} of them have hours or leave — those are deleted`
                    : "Rows outside the new period are deleted"}
              </div>
            </div>
          </div>
        )}

        {!problem && !effect.blocker && effect.handOver && (
          effect.handOver.tooLong ? (
            <p className="rounded-card border border-subtle bg-surface-2 px-3 py-2 text-xs text-secondary">
              {effect.handOver.to.label} cannot take the removed days — it would run longer than {MAX_PERIOD_DAYS} days.
            </p>
          ) : (
            <label className="flex cursor-pointer items-start gap-2 rounded-card border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950/30 dark:text-emerald-200">
              <input type="checkbox" className="mt-0.5" checked={handOverOn} onChange={(ev) => setHandOverOn(ev.target.checked)} />
              <span>
                Give the {effect.handOver.days} removed day{effect.handOver.days === 1 ? "" : "s"} to <b>{effect.handOver.to.label}</b> ({effect.handOver.to.status})
                with their hours — it will then run {fmtDay(effect.handOver.newStart)} – {fmtDay(effect.handOver.newEnd)}.
              </span>
            </label>
          )
        )}

        <WhatHappens tone="sky" title="Good to know" items={[
          { icon: Info, text: <>A day is on one timesheet only. An open neighbouring sheet (Draft or Rejected) gives or takes days with their hours; a submitted or approved one keeps its days.</> },
          { icon: CalendarClock, text: longer
            ? <>This period is longer than one month: a <b>Monthly</b> rate bills one month plus the extra days. Hourly and daily rates bill what is filled.</>
            : <>A <b>Monthly</b> rate bills one month for a full cycle (21st → 20th), and its share for a shorter period. Hourly and daily rates bill what is filled.</> },
          { icon: CalendarRange, text: <>Next month&rsquo;s new timesheet starts the day after this one ends.</> },
        ]} />
      </div>
    </Modal>
  );
}
