/**
 * Planned release / extension of a project employee (4 Nov 2026; server:
 * services/pe_release.py). The Sales Manager records what the customer informs:
 * **Release date** (the person is expected to roll off on that day) or
 * **Extension** (the customer keeps them longer). A PLAN — reminders go out 30,
 * 15, 5, 2 and 1 days before, and the predicted revenue stops there; the person
 * still leaves through the Exit action.
 */
import { useState, type SyntheticEvent } from "react";
import { BellRing, CalendarClock, CalendarPlus, CalendarX2, History, TrendingDown } from "lucide-react";
import { crmDelete, crmPost } from "../api";
import { useHasRole } from "../CrmApp";
import { DialogActions, DialogFailure, DialogHero, DialogSection, QuickPicks, ReasonBox, WhatHappens } from "./dialogKit";
import { Modal, inputCls } from "./ui";

export type ReleaseHistory = {
  id: number; kind: "release" | "extension" | "cleared";
  old_date: string | null; new_date: string | null; note: string | null;
  informed_on: string | null; by_name: string | null; at: string | null;
};
export type ReleaseInfo = {
  release_date: string | null;
  days_left: number | null;
  planned_end: string | null;
  informed_on: string | null;
  note: string | null;
  set_by_name: string | null;
  set_at: string | null;
  extensions: number;
  history: ReleaseHistory[];
  reminder_days: number[];
};

export const RELEASE_ROLES = ["Sales Manager", "Sales_Head", "RMG", "GM"];

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export function isoPlus(base: Date, days: number): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Last day of the month `months` ahead of `base` (0 = this month). PURE. */
export function monthEnd(base: Date, months: number): string {
  const d = new Date(base.getFullYear(), base.getMonth() + months + 1, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Which reminders are still to go out for a release date. PURE. */
export function remindersLeft(daysLeft: number | null, days: number[]): number[] {
  if (daysLeft == null || daysLeft <= 0) return [];
  return days.filter((d) => d <= daysLeft);
}

function leftTone(days: number | null): string {
  if (days == null) return "bg-surface-2 text-secondary ring-subtle";
  if (days < 0) return "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-900/50 dark:text-slate-300 dark:ring-slate-700";
  if (days <= 5) return "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-900/40 dark:text-rose-200 dark:ring-rose-800";
  if (days <= 30) return "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-800";
  return "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-900/40 dark:text-sky-200 dark:ring-sky-800";
}

export function ReleasePlanPanel({ peId, employeeName, onboardingDate, monthlyRate, isExit, info, onSaved, toast }: {
  peId: number;
  employeeName: string;
  onboardingDate?: string | null;
  monthlyRate?: number | null;
  isExit?: boolean;
  info: ReleaseInfo | null | undefined;
  onSaved: () => void;
  toast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const canEdit = useHasRole(...RELEASE_ROLES);
  const [dialog, setDialog] = useState<"release" | "extension" | "clear" | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  if (info === undefined) return null;
  const rd = info?.release_date ?? null;
  const days = info?.days_left ?? null;
  const left = remindersLeft(days, info?.reminder_days ?? [30, 15, 5, 2, 1]);

  return (
    <div className="rounded-card border border-subtle bg-surface-1 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow">
          <CalendarClock className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-primary">Planned release</p>
          {rd ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-bold text-primary">{fmt(rd)}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${leftTone(days)}`}>
                {days == null ? "" : days < 0 ? `${-days} d ago` : days === 0 ? "today" : `in ${days} d`}
              </span>
              {info && info.extensions > 0 && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:ring-emerald-800">
                  Extended {info.extensions}×
                </span>
              )}
            </div>
          ) : (
            <p className="mt-0.5 text-sm text-secondary">
              No release date — the forecast assumes they keep billing{isExit ? "" : " until an exit is recorded"}.
            </p>
          )}
          {rd && (
            <p className="mt-1 text-xs text-muted">
              Customer informed {fmt(info?.informed_on)}{info?.set_by_name ? ` · recorded by ${info.set_by_name}` : ""}
              {info?.note ? ` · “${info.note}”` : ""}
            </p>
          )}
          {rd && left.length > 0 && (
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-secondary">
              <BellRing className="h-3.5 w-3.5" aria-hidden /> Reminders to Sales Manager · Sales Head · RMG at {left.join(" · ")} days before
            </p>
          )}
          {rd && monthlyRate ? (
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-secondary">
              <TrendingDown className="h-3.5 w-3.5" aria-hidden /> About ₹{Math.round(monthlyRate).toLocaleString("en-IN")} a month stops billing from then — the dashboard's predicted revenue already counts it.
            </p>
          ) : null}
        </div>
        {canEdit && !isExit && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setDialog("release")}
              className="inline-flex items-center gap-1.5 rounded-control bg-gradient-to-r from-amber-500 to-orange-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:brightness-105">
              <CalendarX2 className="h-3.5 w-3.5" aria-hidden /> {rd ? "Change release date" : "Release date"}
            </button>
            {rd && (
              <button type="button" onClick={() => setDialog("extension")}
                className="inline-flex items-center gap-1.5 rounded-control bg-gradient-to-r from-emerald-500 to-teal-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:brightness-105">
                <CalendarPlus className="h-3.5 w-3.5" aria-hidden /> Extension
              </button>
            )}
            {rd && (
              <button type="button" onClick={() => setDialog("clear")}
                className="rounded-control border border-subtle bg-surface-2 px-3 py-1.5 text-xs font-semibold text-secondary hover:text-primary">
                Remove
              </button>
            )}
          </div>
        )}
      </div>
      {info && info.history.length > 0 && (
        <div className="mt-3 border-t border-subtle pt-2">
          <button type="button" onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
            <History className="h-3.5 w-3.5" aria-hidden /> {showHistory ? "Hide" : "Show"} history ({info.history.length})
          </button>
          {showHistory && (
            <ul className="mt-2 space-y-1.5 text-xs">
              {info.history.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-x-2 text-secondary">
                  <span className={`font-semibold ${h.kind === "extension" ? "text-emerald-700 dark:text-emerald-300"
                    : h.kind === "cleared" ? "text-muted" : "text-amber-700 dark:text-amber-300"}`}>
                    {h.kind === "extension" ? "Extended" : h.kind === "cleared" ? "Release withdrawn" : "Release set"}
                  </span>
                  <span>{h.old_date ? `${fmt(h.old_date)} → ` : ""}{h.new_date ? fmt(h.new_date) : ""}</span>
                  <span className="text-muted">{h.by_name || "—"} · {h.at ? fmt(h.at) : ""}</span>
                  {h.note && <span className="w-full text-muted">“{h.note}”</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {dialog && (
        <ReleaseDialog mode={dialog} peId={peId} employeeName={employeeName} current={rd}
          onboardingDate={onboardingDate ?? null}
          onClose={() => setDialog(null)}
          onDone={(msg) => { setDialog(null); toast(msg); onSaved(); }} />
      )}
    </div>
  );
}

/** Why the date cannot be saved; mirrors services/pe_release.release_problem. PURE. */
export function releaseDateProblem(mode: "release" | "extension", date: string, current: string | null,
                                   onboarding: string | null): string | null {
  if (!date) return "Pick the date the customer gave";
  if (onboarding && date < onboarding.slice(0, 10)) return "The date is before the onboarding date";
  if (mode === "extension") {
    if (!current) return "Set the release date first";
    if (date <= current) return "An extension must be after the current release date";
  }
  return null;
}

export function ReleaseDialog({ mode, peId, employeeName, current, onboardingDate, onClose, onDone }: {
  mode: "release" | "extension" | "clear";
  peId: number; employeeName: string; current: string | null; onboardingDate: string | null;
  onClose: () => void; onDone: (msg: string) => void;
}) {
  const today = new Date();
  const [date, setDate] = useState(mode === "extension" && current ? "" : current || "");
  const [informed, setInformed] = useState(isoPlus(today, 0));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isClear = mode === "clear";
  const tone = mode === "extension" ? "emerald" : isClear ? "slate" : "amber";
  const problem = isClear ? null : releaseDateProblem(mode, date, current, onboardingDate);

  const base = mode === "extension" && current ? new Date(`${current}T00:00:00`) : today;
  const picks: Record<string, string> = mode === "extension"
    ? { "+1 month": isoPlus(base, 30), "+3 months": isoPlus(base, 91), "+6 months": isoPlus(base, 182), "+1 year": isoPlus(base, 365) }
    : { "End of this month": monthEnd(today, 0), "End of next month": monthEnd(today, 1),
        "In 30 days": isoPlus(today, 30), "In 60 days": isoPlus(today, 60), "In 90 days": isoPlus(today, 90) };

  const submit = async () => {
    if (problem || busy) return;
    setBusy(true); setErr(null);
    try {
      const res = isClear
        ? await crmDelete(`/api/projects/employees/${peId}/release`)
        : await crmPost(`/api/projects/employees/${peId}/release`,
          { kind: mode, release_date: date, informed_on: informed || null, note: note.trim() || null });
      onDone(res.message || "Saved");
    } catch (e: any) {
      setErr(e?.message || "Could not save");
      setBusy(false);
    }
  };

  return (
    <Modal medium title={isClear ? "Remove release date" : mode === "extension" ? "Extension" : "Release date"}
      onClose={onClose} dirty={!!note.trim() || (!isClear && date !== (current || ""))}
      hero={<DialogHero tone={tone} icon={mode === "extension" ? CalendarPlus : CalendarX2}
        eyebrow={isClear ? "Customer withdrew the release" : mode === "extension" ? "Customer extended" : "Customer informed a release"}
        title={employeeName}
        subtitle={current ? `Current planned release: ${fmt(current)}` : "No release date yet"} />}
      footer={<DialogActions onCancel={onClose} busy={busy} tone={tone}
        label={isClear ? "Remove release date" : mode === "extension" ? "Save extension" : "Save release date"}
        disabled={!!problem} onConfirm={submit} hint={problem || undefined} />}>
      <div className="space-y-4">
        {!isClear && (
          <DialogSection n={1} tone={tone} done={!problem}
            title={mode === "extension" ? "Extended until" : "Last working day the customer gave"}>
            <QuickPicks tone={tone} label="Quick dates" options={Object.keys(picks)}
              active={Object.keys(picks).find((k) => picks[k] === date) || null}
              onPick={(k) => setDate(picks[k])} />
            <input type="date" className={`${inputCls} mt-2 !w-48`} value={date} min={onboardingDate?.slice(0, 10)}
              onChange={(e) => setDate(e.target.value)} aria-label="Release date" />
          </DialogSection>
        )}
        {!isClear && (
          <DialogSection n={2} tone={tone} optional title="When did the customer tell you?">
            <input type="date" className={`${inputCls} !w-48`} value={informed} max={isoPlus(today, 0)}
              onChange={(e) => setInformed(e.target.value)} aria-label="Informed on" />
          </DialogSection>
        )}
        <ReasonBox id="release-note" label={isClear ? "Why (optional)" : "Note (optional)"} tone={tone}
          value={note} onChange={setNote} max={1000}
          picks={isClear ? ["Customer withdrew the release", "Project continues"]
            : mode === "extension" ? ["SOW extended", "PO renewed", "Customer asked to continue"]
              : ["Project ending", "Budget cut", "Customer downsizing", "Moving to another vendor"]} />
        <WhatHappens tone={tone} items={isClear ? [
          { icon: TrendingDown, text: "The predicted revenue counts them as billing again." },
          { icon: BellRing, text: "Release reminders stop." },
        ] : [
          { icon: BellRing, text: "Sales Manager, Sales Head and RMG are reminded 30, 15, 5, 2 and 1 days before." },
          { icon: TrendingDown, text: "Predicted revenue on the CEO dashboard stops billing them on that day." },
          { icon: CalendarClock, text: "Nothing else changes — they still leave through the Exit action." },
        ]} />
        <DialogFailure message={err} />
      </div>
    </Modal>
  );
}

/** Whole days from today (local) to an ISO date; null without a date. PURE. */
export function daysUntil(iso: string | null | undefined, today: Date = new Date()): number | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}

/** The project band's release stat (5 Nov 2026): the next planned release among
 *  the people still on the project, or "None set". PURE. */
export function releaseSummary(team: { release_date?: string | null }[], today: Date = new Date()):
  { label: string; value: string; planned: number } {
  const dates = team.map((t) => (t.release_date ? t.release_date.slice(0, 10) : null)).filter(Boolean) as string[];
  if (dates.length === 0) return { label: "planned release", value: "None set", planned: 0 };
  const next = [...dates].sort()[0];
  const of = dates.length === team.length ? "" : ` · ${dates.length} of ${team.length}`;
  return { label: `next release${of}`, value: `${fmt(next)} · ${daysWords(daysUntil(next, today))}`, planned: dates.length };
}

function daysWords(days: number | null): string {
  if (days == null) return "";
  return days < 0 ? `${-days} d ago` : days === 0 ? "today" : `in ${days} d`;
}

/**
 * The release plan of ONE row in a list (Project ▸ Team, Project Employees):
 * the date + days left, and — for Sales Manager / Sales Head / RMG / GM — the
 * same Release / Extension / Remove dialogs as the employee page. Clicks never
 * reach the row (it navigates).
 */
export function ReleaseCell({ peId, employeeName, releaseDate, onboardingDate, isExit, onSaved, toast }: {
  peId: number;
  employeeName: string;
  releaseDate: string | null | undefined;
  onboardingDate?: string | null;
  isExit?: boolean;
  onSaved: () => void;
  toast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const canEdit = useHasRole(...RELEASE_ROLES);
  const [dialog, setDialog] = useState<"release" | "extension" | "clear" | null>(null);
  const rd = releaseDate ? releaseDate.slice(0, 10) : null;
  const days = daysUntil(rd);
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  const btn = "rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 hover:brightness-95";
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="flex flex-col items-start gap-1" onClick={stop}>
      {rd ? (
        <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold text-primary">{fmt(rd)}</span>
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${leftTone(days)}`}>{daysWords(days)}</span>
        </span>
      ) : (
        <span className="text-xs text-muted">{isExit ? "—" : "No release date"}</span>
      )}
      {canEdit && !isExit && (
        <span className="flex flex-wrap gap-1">
          <button type="button" onClick={() => setDialog("release")}
            className={`${btn} bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-800`}
            title={rd ? "Change the release date" : "Record the release date the customer gave"}>
            {rd ? "Change" : "Release date"}
          </button>
          {rd && (
            <button type="button" onClick={() => setDialog("extension")}
              className={`${btn} bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:ring-emerald-800`}>
              Extend
            </button>
          )}
          {rd && (
            <button type="button" onClick={() => setDialog("clear")}
              className={`${btn} bg-surface-2 text-secondary ring-subtle`}>
              Remove
            </button>
          )}
        </span>
      )}
      {dialog && (
        <ReleaseDialog mode={dialog} peId={peId} employeeName={employeeName} current={rd}
          onboardingDate={onboardingDate ?? null}
          onClose={() => setDialog(null)}
          onDone={(msg) => { setDialog(null); toast(msg); onSaved(); }} />
      )}
    </div>
  );
}

export type TeamReleaseRow = {
  pe_id: number;
  employee_name: string;
  release_date?: string | null;
  onboarding_date?: string | null;
  is_exit?: boolean;
};

/** Who may be picked for a team release / extension; the reason when not. PURE. */
export function teamPickBlock(row: TeamReleaseRow, mode: "release" | "extension", date: string): string | null {
  if (row.is_exit) return "Already exited";
  const current = row.release_date ? row.release_date.slice(0, 10) : null;
  if (mode === "extension" && !current) return "No release date to extend";
  if (date) {
    const p = releaseDateProblem(mode, date, current, row.onboarding_date ?? null);
    if (p) return p;
  }
  return null;
}

/**
 * One release / extension date for several people of a project — what a
 * customer usually says ("the whole team rolls off on 31 Dec"). Posts
 * POST /api/projects/{id}/release; each person is checked on their own.
 */
export function TeamReleaseDialog({ projectId, projectName, team, onClose, onDone, initialMode = "release" }: {
  projectId: number;
  projectName: string;
  team: TeamReleaseRow[];
  onClose: () => void;
  onDone: (msg: string) => void;
  /** Which switch is on when the dialog opens (the project hero has a button for each). */
  initialMode?: "release" | "extension";
}) {
  const today = new Date();
  const live = team.filter((r) => !r.is_exit);
  const [mode, setMode] = useState<"release" | "extension">(initialMode);
  const [date, setDate] = useState("");
  const [informed, setInformed] = useState(isoPlus(today, 0));
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Set<number>>(() => new Set(live.map((r) => r.pe_id)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tone = mode === "extension" ? "emerald" : "amber";

  const blockOf = (r: TeamReleaseRow) => teamPickBlock(r, mode, date);
  const chosen = live.filter((r) => picked.has(r.pe_id) && !blockOf(r));
  const problem = !date ? "Pick the date the customer gave"
    : chosen.length === 0 ? "Pick at least one person who can take this date" : null;

  const picks: Record<string, string> = mode === "extension"
    ? { "End of next month": monthEnd(today, 1), "In 3 months": monthEnd(today, 3), "In 6 months": monthEnd(today, 6), "In 1 year": monthEnd(today, 12) }
    : { "End of this month": monthEnd(today, 0), "End of next month": monthEnd(today, 1),
        "In 30 days": isoPlus(today, 30), "In 60 days": isoPlus(today, 60), "In 90 days": isoPlus(today, 90) };

  const toggle = (id: number) => setPicked((s) => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  const submit = async () => {
    if (problem || busy) return;
    setBusy(true); setErr(null);
    try {
      const res = await crmPost(`/api/projects/${projectId}/release`, {
        kind: mode, release_date: date, pe_ids: chosen.map((r) => r.pe_id),
        informed_on: informed || null, note: note.trim() || null,
      });
      onDone(res.message || "Saved");
    } catch (e: any) {
      setErr(e?.message || "Could not save");
      setBusy(false);
    }
  };

  return (
    <Modal medium title={mode === "extension" ? "Extension" : "Release date"} onClose={onClose} dirty={!!date || !!note.trim()}
      hero={<DialogHero tone={tone} icon={mode === "extension" ? CalendarPlus : CalendarX2}
        eyebrow={mode === "extension" ? "Customer extended the team" : "Customer informed a release"}
        title={projectName}
        subtitle={`${live.length} on the project today`} />}
      footer={<DialogActions onCancel={onClose} busy={busy} tone={tone}
        label={`Save for ${chosen.length}`}
        disabled={!!problem} onConfirm={submit} hint={problem || undefined} />}>
      <div className="space-y-4">
        <div className="inline-flex rounded-control border border-subtle bg-surface-2 p-0.5 text-xs font-semibold">
          {(["release", "extension"] as const).map((m) => (
            <button key={m} type="button" onClick={() => { setMode(m); setDate(""); }}
              className={`rounded-control px-3 py-1.5 ${mode === m ? "bg-surface-1 text-primary shadow-raised" : "text-secondary"}`}>
              {m === "release" ? "Release date" : "Extension"}
            </button>
          ))}
        </div>
        <DialogSection n={1} tone={tone} done={!!date}
          title={mode === "extension" ? "Extended until" : "Last working day the customer gave"}>
          <QuickPicks tone={tone} label="Quick dates" options={Object.keys(picks)}
            active={Object.keys(picks).find((k) => picks[k] === date) || null}
            onPick={(k) => setDate(picks[k])} />
          <input type="date" className={`${inputCls} mt-2 !w-48`} value={date}
            onChange={(e) => setDate(e.target.value)} aria-label="Release date" />
        </DialogSection>
        <DialogSection n={2} tone={tone} done={chosen.length > 0} title={`Who it applies to · ${chosen.length} picked`}>
          {live.length === 0 ? (
            <p className="text-sm text-secondary">Nobody is on this project today.</p>
          ) : (
            <>
              <div className="mb-2 flex gap-3 text-xs font-semibold">
                <button type="button" className="text-brand-600 hover:underline dark:text-brand-300"
                  onClick={() => setPicked(new Set(live.map((r) => r.pe_id)))}>Pick all</button>
                <button type="button" className="text-secondary hover:underline"
                  onClick={() => setPicked(new Set())}>None</button>
              </div>
              <ul className="max-h-64 divide-y divide-subtle overflow-y-auto rounded-control border border-subtle">
                {live.map((r) => {
                  const block = blockOf(r);
                  const on = picked.has(r.pe_id) && !block;
                  return (
                    <li key={r.pe_id}>
                      <label className={`flex items-center gap-3 px-3 py-2 text-sm ${block ? "opacity-60" : "cursor-pointer"}`}>
                        <input type="checkbox" checked={on} disabled={!!block} onChange={() => toggle(r.pe_id)} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-primary">{r.employee_name}</span>
                          <span className="block text-xs text-muted">
                            {r.release_date ? `Release ${fmt(r.release_date)}` : "No release date"}
                            {block ? ` · ${block}` : ""}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </DialogSection>
        <DialogSection n={3} tone={tone} optional title="When did the customer tell you?">
          <input type="date" className={`${inputCls} !w-48`} value={informed} max={isoPlus(today, 0)}
            onChange={(e) => setInformed(e.target.value)} aria-label="Informed on" />
        </DialogSection>
        <ReasonBox id="team-release-note" label="Note (optional)" tone={tone} value={note} onChange={setNote} max={1000}
          picks={mode === "extension" ? ["SOW extended", "PO renewed", "Customer asked to continue"]
            : ["Project ending", "Budget cut", "Customer downsizing", "Moving to another vendor"]} />
        <WhatHappens tone={tone} items={[
          { icon: BellRing, text: "Each person's plan is saved on their own page — reminders 30, 15, 5, 2 and 1 days before." },
          { icon: TrendingDown, text: "Predicted revenue stops billing them on that day." },
          { icon: CalendarClock, text: "Anyone the date does not fit is skipped and named; nobody exits by this." },
        ]} />
        <DialogFailure message={err} />
      </div>
    </Modal>
  );
}
