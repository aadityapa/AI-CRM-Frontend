/**
 * Project close → team on the bench (25 Sep 2026; server: B-V2
 * `services/project_closure.py`).
 *
 * A project records its LAST WORKING DAY and a reason. The team keeps working
 * until that day and is on the bench from the next one:
 *   • a future day is SCHEDULED — every open assignment's exit is capped at it
 *     straight away, and the daily job moves the team to the bench after it;
 *   • a day already gone closes at once.
 * A scheduled close can be withdrawn (every exit date it capped is restored);
 * a finished one cannot — the team has already left.
 *
 * `ProjectClosureBanner` states where the project stands; `CloseProjectButton`
 * opens the dialog, which previews who rolls off on which day BEFORE saving
 * (the server's own `close-preview`, so the preview and the save can never
 * disagree). Visibility is a convenience: the server gate is the admin-editable
 * `project.close` action.
 */
import { useEffect, useState, type ReactNode } from "react";
import { CalendarClock, CalendarX2, FileClock, Undo2, UserCheck, UsersRound } from "lucide-react";

import { crmDelete, crmGet, crmPost, crmPut } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanAct } from "../useAccess";
import { fmtDateShort } from "../../lib/datetime";
import { ActionError, ConfirmModal, Field, Modal, btnPrimary, btnSecondary, inputCls } from "./ui";
import { DialogActions, DialogFailure, DialogHero, DialogSection, QuickPicks, ReasonBox, WhatHappens, useCtrlEnter } from "./dialogKit";

export type ClosureState = "open" | "scheduled" | "closed";

export type ProjectClosure = {
  state: ClosureState;
  end_date: string | null;
  reason: string | null;
  closed_at: string | null;
  closed_by: number | null;
  days_left: number | null;
};

type PreviewRow = {
  project_employee_id: number;
  employee_id: number;
  name: string | null;
  onboarding_date: string | null;
  exit_date: string;
  starts_after_end: boolean;
};

/** Same bar as the server (`MIN_REASON_LENGTH`). */
const MIN_REASON = 10;

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Who may close — mirrors the `project.close` defaults; the server decides. */
export function useCanCloseProject(): boolean {
  return useCanAct("projects", "edit", useHasRole("Sales_Head", "RMG", "HR"));
}

export function ProjectClosureBanner({
  projectId, closure, onCancelled, notify,
}: {
  projectId: number;
  closure?: ProjectClosure | null;
  onCancelled: () => void;
  notify: (msg: string, kind?: "ok" | "err") => void;
}) {
  const canClose = useCanCloseProject();
  const [confirming, setConfirming] = useState(false);
  if (!closure || closure.state === "open") return null;
  if (closure.state === "closed") {
    return (
      <div role="status" className="flex flex-wrap items-start gap-3 rounded-card border border-subtle bg-surface-2 px-4 py-3 text-sm">
        <UsersRound className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-primary">
            Project closed{closure.end_date ? ` — last working day ${fmtDateShort(closure.end_date)}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-secondary">
            The team was moved to the bench{closure.reason ? ` · ${closure.reason}` : ""}.
            Extended by the customer? Use <span className="font-semibold">Change last working day</span> (Overview tab) — the team comes
            back and the new months get Draft timesheets.
          </p>
        </div>
      </div>
    );
  }
  const days = closure.days_left ?? 0;
  return (
    <div role="status" className="flex flex-wrap items-start gap-3 rounded-card border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-200">
      <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          Closing — last working day {fmtDateShort(closure.end_date)}
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold dark:bg-amber-900">
            {days === 1 ? "last day today" : `${days} days left`}
          </span>
        </p>
        <p className="mt-0.5 text-xs">
          The team keeps working until then and moves to the bench the next day.
          {closure.reason ? ` Reason: ${closure.reason}` : ""}
        </p>
      </div>
      {canClose && (
        <button type="button" className={`${btnSecondary} h-8 min-h-0`} onClick={() => setConfirming(true)}>
          <Undo2 size={14} aria-hidden /> Cancel close
        </button>
      )}
      {confirming && (
        <ConfirmModal
          title="Cancel the scheduled close?"
          message="The project stays open and every exit date the close set is restored to what it was."
          confirmLabel="Cancel close"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            try {
              await crmDelete(`/api/projects/${projectId}/close`);
              notify("Scheduled close cancelled");
              onCancelled();
            } catch (e: any) {
              notify(e?.message || "Could not cancel the close", "err");
            } finally {
              setConfirming(false);
            }
          }}
        />
      )}
    </div>
  );
}

export function CloseProjectButton({
  projectId, projectName, closure, onClosed, notify,
}: {
  projectId: number;
  projectName: string;
  closure?: ProjectClosure | null;
  onClosed: () => void;
  notify: (msg: string, kind?: "ok" | "err") => void;
}) {
  const canClose = useCanCloseProject();
  const [open, setOpen] = useState(false);
  if (!canClose || (closure && closure.state !== "open")) return null;
  return (
    <>
      <button type="button" className={btnSecondary} onClick={() => setOpen(true)}>
        <CalendarX2 size={15} aria-hidden /> Close project
      </button>
      {open && (
        <CloseProjectModal
          projectId={projectId}
          projectName={projectName}
          onClose={() => setOpen(false)}
          onDone={(msg) => { setOpen(false); notify(msg); onClosed(); }}
        />
      )}
    </>
  );
}

function CloseProjectModal({
  projectId, projectName, onClose, onDone,
}: {
  projectId: number;
  projectName: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [endDate, setEndDate] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [team, setTeam] = useState<PreviewRow[] | null>(null);
  const [previewErr, setPreviewErr] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  // Preview who rolls off for the chosen day — from the server, so it is the save's own rule.
  useEffect(() => {
    if (!endDate) { setTeam(null); return; }
    let cancelled = false;
    setPreviewErr("");
    crmGet<{ team: PreviewRow[] }>(`/api/projects/${projectId}/close-preview?end_date=${endDate}`)
      .then((r) => { if (!cancelled) setTeam(r.data.team); })
      .catch((e: any) => { if (!cancelled) { setTeam(null); setPreviewErr(e?.message || "Could not load the team"); } });
    return () => { cancelled = true; };
  }, [projectId, endDate]);

  const past = !!endDate && endDate < todayIso();
  const blocked = (team || []).filter((t) => t.starts_after_end);
  const reasonOk = reason.trim().length >= MIN_REASON;

  const save = async () => {
    setSaving(true); setErr("");
    try {
      const res = await crmPost<unknown>(`/api/projects/${projectId}/close`, { end_date: endDate, reason: reason.trim() });
      onDone(res.message || "Project close saved");
    } catch (e: any) {
      setErr(e?.message || "Could not close the project");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Close ${projectName}`}
      onClose={onClose}
      dirty={reason.trim().length > 0}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={btnPrimary} onClick={() => void save()}
                  disabled={saving || !endDate || !reasonOk || blocked.length > 0}>
            {saving ? "Saving…" : past ? "Close now" : "Schedule close"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-secondary">
          Enter the <span className="font-semibold text-primary">last working day</span>. The team keeps working and
          billing until then and moves to the bench the next day. A date already gone closes the project at once.
        </p>
        <Field label="Last working day">
          <input type="date" className={`${inputCls} [color-scheme:light] dark:[color-scheme:dark]`}
                 value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <Field label={`Reason (at least ${MIN_REASON} characters)`}>
          <textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Customer completed the programme; SOW not renewed" />
        </Field>

        <div className="rounded-card border border-subtle">
          <div className="border-b border-subtle bg-surface-2 px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted">
            Moves to the bench{team ? ` · ${team.length}` : ""}
          </div>
          {previewErr ? (
            <p className="px-3 py-3 text-sm text-danger">{previewErr}</p>
          ) : team === null ? (
            <p className="px-3 py-3 text-sm text-muted">Loading the team…</p>
          ) : team.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted">Nobody is working on this project right now.</p>
          ) : (
            <ul className="max-h-56 divide-y divide-subtle overflow-y-auto">
              {team.map((t) => (
                <li key={t.project_employee_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate font-medium text-primary">{t.name || `Employee #${t.employee_id}`}</span>
                  {t.starts_after_end ? (
                    <span className="shrink-0 rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-bold text-danger">
                      onboards {fmtDateShort(t.onboarding_date)} — after the last day
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs tabular-nums text-secondary">last day {fmtDateShort(t.exit_date)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {blocked.length > 0 && (
          <ActionError error="Someone onboards after this date. Change their onboarding or remove them from the team first." />
        )}
        <ActionError error={err} />
      </div>
    </Modal>
  );
}


/* ------------------------------------------------ change the last working day (24 Nov 2026) */

type EndDatePreview = {
  ok: boolean;
  reason?: string;
  old_end: string;
  new_end: string;
  direction: "later" | "earlier" | "same";
  state_after: "closed" | "scheduled";
  people: { project_employee_id: number; name: string | null; from: string | null; to: string; back_on_project: boolean }[];
  draft_months: string[];
  blocked: string[];
};

/** Quick dates from the current last working day. PURE. */
export function endDatePicks(oldEnd: string): { label: string; value: string }[] {
  const [y, m] = oldEnd.split("-").map(Number);
  const monthEnd = (yy: number, mm: number) => {
    const d = new Date(yy, mm, 0); // day 0 of the next month = last day of mm
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const add = (n: number) => { const t = m + n; return monthEnd(y + Math.floor((t - 1) / 12), ((t - 1) % 12) + 1); };
  return [
    { label: "+1 month", value: add(1) },
    { label: "+2 months", value: add(2) },
    { label: "+3 months", value: add(3) },
    { label: "+6 months", value: add(6) },
  ];
}

const END_DATE_REASONS = [
  "Customer extended the PO.",
  "New PO received for the same work.",
  "Customer extended the engagement.",
  "The last working day was entered wrongly.",
  "Customer ended the work earlier.",
];

export function ChangeEndDateButton({
  projectId, closure, onChanged, notify, compact,
}: {
  projectId: number;
  closure?: ProjectClosure | null;
  onChanged: () => void;
  notify: (msg: string, kind?: "ok" | "err") => void;
  compact?: boolean;
}) {
  const canClose = useCanCloseProject();
  const [open, setOpen] = useState(false);
  if (!canClose || !closure || closure.state === "open" || !closure.end_date) return null;
  return (
    <>
      <button type="button" className={`${btnSecondary} ${compact ? "h-8 min-h-0" : ""}`} onClick={() => setOpen(true)}>
        <CalendarClock size={compact ? 14 : 15} aria-hidden /> Change last working day
      </button>
      {open && (
        <ChangeEndDateModal
          projectId={projectId}
          oldEnd={closure.end_date}
          onClose={() => setOpen(false)}
          onDone={(msg) => { setOpen(false); notify(msg); onChanged(); }}
        />
      )}
    </>
  );
}

function ChangeEndDateModal({
  projectId, oldEnd, onClose, onDone,
}: {
  projectId: number;
  oldEnd: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [endDate, setEndDate] = useState(oldEnd);
  const [reason, setReason] = useState("");
  const [pv, setPv] = useState<EndDatePreview | null>(null);
  const [pvErr, setPvErr] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!endDate || endDate === oldEnd) { setPv(null); return; }
    let cancelled = false;
    setPvErr("");
    crmGet<EndDatePreview>(`/api/projects/${projectId}/end-date-preview?end_date=${endDate}`)
      .then((r) => { if (!cancelled) setPv(r.data); })
      .catch((e: any) => { if (!cancelled) { setPv(null); setPvErr(e?.message || "Could not check the change"); } });
    return () => { cancelled = true; };
  }, [projectId, endDate, oldEnd]);

  const reasonOk = reason.trim().length >= MIN_REASON;
  const same = endDate === oldEnd;
  const blocked = pv?.blocked || [];
  const later = pv?.direction === "later";
  const missing = !endDate ? "Pick the new last working day"
    : same ? "Pick a different day"
    : blocked.length ? "Some timesheets block this day"
    : !reasonOk ? `Reason: ${MIN_REASON - reason.trim().length} more characters` : null;

  const save = async () => {
    if (missing || saving) return;
    setSaving(true); setErr("");
    try {
      const res = await crmPut<unknown>(`/api/projects/${projectId}/end-date`, { end_date: endDate, reason: reason.trim() });
      onDone(res.message || "Last working day changed");
    } catch (e: any) {
      setErr(e?.message || "Could not change the last working day");
    } finally {
      setSaving(false);
    }
  };
  useCtrlEnter(() => void save());

  const happens: { icon: typeof UserCheck; text: ReactNode }[] = [];
  if (pv && later) {
    if (pv.people.some((p) => p.back_on_project)) {
      happens.push({ icon: UserCheck, text: <>The team comes back on the project and works until {fmtDateShort(endDate)}; they move to the bench the day after.</> });
    } else {
      happens.push({ icon: UserCheck, text: <>The project stays closed; the team's last day becomes {fmtDateShort(endDate)}.</> });
    }
    if (pv.draft_months.length) {
      happens.push({ icon: FileClock, text: <>Draft timesheets, days already filled in, for: <span className="font-semibold">{pv.draft_months.join(" · ")}</span>. Open each, correct the days and submit.</> });
    }
  } else if (pv && pv.direction === "earlier") {
    happens.push({ icon: CalendarX2, text: <>Everyone on the project stops on {fmtDateShort(endDate)}; untouched Draft timesheets after it are removed.</> });
  }

  return (
    <Modal
      title="Change last working day"
      medium
      onClose={onClose}
      dirty={reason.trim().length > 0 || !same}
      hero={
        <DialogHero tone="emerald" icon={CalendarClock} eyebrow="Project"
                    title="Change the last working day"
                    subtitle={<>Now: <span className="font-semibold">{fmtDateShort(oldEnd)}</span>{!same && endDate ? <> → {fmtDateShort(endDate)}</> : null}</>} />
      }
      footer={<DialogActions onCancel={onClose} busy={saving} tone="emerald" icon={CalendarClock}
                             label="Change the day" disabled={!!missing} onConfirm={() => void save()} hint={missing} />}
    >
      <div className="space-y-4">
        <DialogSection n={1} title="New last working day" tone="emerald" done={!!endDate && !same}
                       hint="The last day the team works. A later day brings the team back and opens Draft timesheets for the new months.">
          <div className="flex flex-wrap items-center gap-3">
            <input type="date" aria-label="New last working day" className={`${inputCls} !w-48 [color-scheme:light] dark:[color-scheme:dark]`}
                   value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <QuickPicks label="Extend by" tone="emerald" options={endDatePicks(oldEnd).map((p) => p.label)}
                        active={endDatePicks(oldEnd).find((p) => p.value === endDate)?.label ?? null}
                        onPick={(l) => setEndDate(endDatePicks(oldEnd).find((p) => p.label === l)!.value)} />
          </div>
        </DialogSection>

        {pvErr && <ActionError error={pvErr} />}
        {pv && (
          <DialogSection n={2} title="Who it changes" tone="emerald" done={pv.people.length > 0}>
            {pv.people.length === 0 ? (
              <p className="text-sm text-muted">Nobody ended on {fmtDateShort(oldEnd)} — no one's dates move.</p>
            ) : (
              <ul className="max-h-48 divide-y divide-subtle overflow-y-auto rounded-card border border-subtle">
                {pv.people.map((p) => (
                  <li key={p.project_employee_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate font-medium text-primary">{p.name || "—"}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-secondary">
                      {p.from ? fmtDateShort(p.from) : "open"} → <span className="font-semibold text-primary">{fmtDateShort(p.to)}</span>
                      {p.back_on_project && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">back on project</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {later && pv.draft_months.length > 0 && (
              <p className="mt-3 rounded-card bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                Draft timesheets will be ready for <span className="font-semibold">{pv.draft_months.join(" · ")}</span>
                {" "}(a sheet that already exists keeps its entries and gets the missing days).
              </p>
            )}
            {blocked.length > 0 && (
              <ActionError error={`These timesheets already hold days after ${fmtDateShort(endDate)}: ${blocked.join(", ")}. Reject or reopen them first.`} />
            )}
          </DialogSection>
        )}

        <DialogSection n={pv ? 3 : 2} title="Why" tone="emerald" done={reasonOk}>
          <ReasonBox id="end-date-reason" label="Reason" required min={MIN_REASON} value={reason} onChange={setReason}
                     tone="emerald" picks={END_DATE_REASONS} placeholder="e.g. Customer extended the PO to 31 Aug 2026" />
        </DialogSection>

        {happens.length > 0 && <WhatHappens tone="emerald" items={happens} />}
        <DialogFailure message={err} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------ dates inside Edit project (24 Nov 2026) */

/** What the dates card says about the project's end. PURE. */
export function datesSummary(closure: ProjectClosure | null | undefined, today = todayIso()): {
  headline: string;
  detail: string;
  tone: "open" | "scheduled" | "closed";
} {
  if (!closure || closure.state === "open" || !closure.end_date) {
    return { headline: "Open-ended", detail: "No last working day yet — the team works until one is set.", tone: "open" };
  }
  const d = fmtDateShort(closure.end_date);
  if (closure.state === "closed" || closure.end_date < today) {
    return { headline: d, detail: `Project closed — the team moved to the bench the day after ${d}.`, tone: "closed" };
  }
  const left = closure.days_left;
  const when = left == null ? "" : left === 0 ? " (today)" : ` (in ${left} day${left === 1 ? "" : "s"})`;
  return { headline: d, detail: `Running — the team works until ${d}${when} and moves to the bench the next day.`, tone: "scheduled" };
}

const DATE_TONE: Record<"open" | "scheduled" | "closed", string> = {
  open: "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200",
  scheduled: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  closed: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
};
const DATE_WORD: Record<"open" | "scheduled" | "closed", string> = {
  open: "Open-ended", scheduled: "Last day set", closed: "Closed",
};

/** The "Project dates" step of Edit project: the last working day with Change /
 * Set buttons. A change saves at once (it needs a reason and moves the team and
 * the timesheets), separate from the wizard's "Save changes". */
export function ProjectDatesBody({
  projectId, projectName, closure, onChanged, notify, onDialogChange,
}: {
  projectId: number;
  projectName: string;
  closure: ProjectClosure | null | undefined;
  onChanged: () => void;
  notify: (msg: string, kind?: "ok" | "err") => void;
  /** Tells the host a dialog is open (so its own Esc / Enter keys stand back). */
  onDialogChange?: (open: boolean) => void;
}) {
  const canClose = useCanCloseProject();
  const [dialog, setDialog] = useState<"change" | "set" | null>(null);
  const open = (d: "change" | "set" | null) => { setDialog(d); onDialogChange?.(d != null); };
  const s = datesSummary(closure);
  const hasEnd = !!closure?.end_date && closure.state !== "open";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[color:var(--wiz-border)] bg-[color:var(--wiz-elevated)] px-4 py-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-[#fff]">
          <CalendarClock size={20} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--wiz-muted)]">Last working day</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold text-[color:var(--wiz-text)]">{s.headline}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${DATE_TONE[s.tone]}`}>{DATE_WORD[s.tone]}</span>
          </div>
          <p className="text-xs text-[color:var(--wiz-muted)]">{s.detail}</p>
          {closure?.reason && hasEnd ? (
            <p className="mt-1 text-xs text-[color:var(--wiz-muted)]">Reason: <span className="text-[color:var(--wiz-text)]">{closure.reason}</span></p>
          ) : null}
        </div>
        {canClose ? (
          hasEnd ? (
            <button type="button" onClick={() => open("change")}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-[#fff] shadow-raised hover:bg-emerald-700">
              <CalendarClock size={16} aria-hidden /> Change last working day
            </button>
          ) : (
            <button type="button" onClick={() => open("set")}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-[#fff] shadow-raised hover:bg-emerald-700">
              <CalendarX2 size={16} aria-hidden /> Set last working day
            </button>
          )
        ) : (
          <span className="text-xs text-[color:var(--wiz-muted)]">Ask Sales Head, RMG or HR to change it.</span>
        )}
      </div>
      <p className="text-xs text-[color:var(--wiz-muted)]">
        {hasEnd
          ? "A later day brings the team back and opens Draft timesheets for the new months; an earlier day ends everyone on it. The change saves at once with a reason — the other steps save with “Save changes”."
          : "Setting a last working day schedules the close: the team keeps working and billing until then and moves to the bench the next day. It saves at once with a reason."}
      </p>
      {dialog === "change" && closure?.end_date && (
        <ChangeEndDateModal projectId={projectId} oldEnd={closure.end_date}
          onClose={() => open(null)}
          onDone={(msg) => { open(null); notify(msg); onChanged(); }} />
      )}
      {dialog === "set" && (
        <CloseProjectModal projectId={projectId} projectName={projectName}
          onClose={() => open(null)}
          onDone={(msg) => { open(null); notify(msg); onChanged(); }} />
      )}
    </div>
  );
}
