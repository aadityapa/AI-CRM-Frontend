/**
 * Change a timesheet's period (19 Oct 2026).
 *
 * Some customers bill on a 21st–20th cycle: the March sheet runs 20 Feb – 20 Mar,
 * April 21 Mar – 20 Apr, and a long bridge sheet takes them back to calendar
 * months. The period may therefore start in an earlier month or end in a later
 * one. The server enforces the rules (`period_window_error` + no overlap with
 * another sheet of the same employee); `periodProblem` mirrors the first so the
 * dialog explains before anyone clicks.
 *
 * Nothing changes until Apply: the day grid then gains the new days and LOSES
 * the days outside the window — with their hours — which is why the dialog
 * counts them first.
 */
import { useMemo, useState } from "react";
import { CalendarClock, CalendarRange, Info, Trash2 } from "lucide-react";

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
const shiftDay = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return isoDay(d); };
/** Last day of the one-month cycle that starts on `s` (21 Apr → 20 May). PURE. */
export function cycleEnd(s: string): string {
  const d = parse(s);
  const y = d.getFullYear(), m = d.getMonth() + 1;
  const last = new Date(y, m + 1, 0).getDate();
  return shiftDay(isoDay(new Date(y, m, Math.min(d.getDate(), last))), -1);
}
export const fmtDay = (s: string) =>
  parse(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

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

/** Quick picks for the sheet's month. PURE. */
export function periodPresets(year: number, month: number): { key: string; label: string; start: string; end: string }[] {
  const prev = new Date(year, month - 2, 1);
  const py = prev.getFullYear(), pm = prev.getMonth() + 1;
  const short = (m: number, d: number) => `${d} ${MONTHS[m - 1].slice(0, 3)}`;
  return [
    { key: "calendar", label: `Calendar month (1 – ${new Date(year, month, 0).getDate()} ${MONTHS[month - 1].slice(0, 3)})`,
      start: monthStart(year, month), end: monthEnd(year, month) },
    { key: "21-20", label: `21st → 20th (${short(pm, 21)} – ${short(month, 20)})`,
      start: isoDay(new Date(py, pm - 1, 21)), end: isoDay(new Date(year, month - 1, 20)) },
    { key: "20-20", label: `20th → 20th (${short(pm, 20)} – ${short(month, 20)})`,
      start: isoDay(new Date(py, pm - 1, 20)), end: isoDay(new Date(year, month - 1, 20)) },
  ];
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

export function TimesheetPeriodModal({ year, month, start, end, entries, employeeName, onApply, onClose }: {
  year: number; month: number; start: string; end: string;
  entries: PeriodEntry[]; employeeName?: string | null;
  /** Saves; throws with the server's reason on refusal. */
  onApply: (start: string, end: string) => Promise<void>;
  onClose: () => void;
}) {
  const [s, setS] = useState(start);
  const [e, setE] = useState(end);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const presets = useMemo(() => periodPresets(year, month), [year, month]);
  const problem = periodProblem(year, month, s, e);
  const change = useMemo(() => periodChange(entries, s, e), [entries, s, e]);
  const unchanged = s === start && e === end;
  const days = !problem ? daysBetween(s, e) : 0;
  const crosses = !problem && (s < monthStart(year, month) || e > monthEnd(year, month));
  const longer = !problem && crosses && e > cycleEnd(s);
  // Inputs reach two months either way — the server has the final word.
  const minDate = isoDay(new Date(year, month - 3, 1));
  const maxDate = isoDay(new Date(year, month + 2, 0));

  const apply = async () => {
    if (problem || unchanged || busy) return;
    setBusy(true); setErr(null);
    try {
      await onApply(s, e);
      onClose();
    } catch (ex: any) {
      setErr(ex?.message || "Could not change the period");
    } finally {
      setBusy(false);
    }
  };

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
            disabled={!!problem || unchanged} onCancel={onClose} onConfirm={apply}
            hint={problem || (unchanged ? "Pick a different start or end date" : `${days} days · ${fmtDay(s)} to ${fmtDay(e)}`)} />
        </div>
      }>
      <div className="space-y-4">
        <DialogSection n={1} title="Quick pick" tone="sky" done={presets.some((p) => p.start === s && p.end === e)}>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => {
              const on = p.start === s && p.end === e;
              return (
                <button key={p.key} type="button" onClick={() => { setS(p.start); setE(p.end); }}
                  aria-pressed={on}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${on
                    ? "border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
                    : "border-subtle bg-surface-1 text-secondary hover:bg-surface-2"}`}>
                  {p.label}
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

        <DialogSection n={2} title="Dates" tone="sky" done={!problem}>
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
        </DialogSection>

        {!problem && !unchanged && (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-card border border-subtle bg-surface-2 px-3 py-2.5">
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Days added</div>
              <div className="text-xl font-bold tabular-nums text-primary">{change.added}</div>
              <div className="text-xs text-secondary">New rows, pre-filled from the billing policy</div>
            </div>
            <div className={`rounded-card border px-3 py-2.5 ${change.removedWithWork
              ? "border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-950/30" : "border-subtle bg-surface-2"}`}>
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Days removed
              </div>
              <div className="text-xl font-bold tabular-nums text-primary">{change.removed}</div>
              <div className={`text-xs ${change.removedWithWork ? "font-semibold text-danger" : "text-secondary"}`}>
                {change.removedWithWork
                  ? `${change.removedWithWork} of them have hours or leave — those are deleted`
                  : "Rows outside the new period are deleted"}
              </div>
            </div>
          </div>
        )}

        <WhatHappens tone="sky" title="Good to know" items={[
          { icon: Info, text: <>The same days can never be on two timesheets — move the neighbouring month&rsquo;s period first if they would overlap.</> },
          { icon: CalendarClock, text: longer
            ? <>This period is longer than one month: a <b>Monthly</b> rate bills one month plus the extra days. Hourly and daily rates bill what is filled.</>
            : <>A <b>Monthly</b> rate bills one month for a period up to one month long. Hourly and daily rates bill what is filled.</> },
          { icon: CalendarRange, text: <>Next month&rsquo;s new timesheet starts the day after this one ends.</> },
        ]} />
      </div>
    </Modal>
  );
}
