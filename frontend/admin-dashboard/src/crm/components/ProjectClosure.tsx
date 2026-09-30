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
import { useEffect, useState } from "react";
import { CalendarX2, Undo2, UsersRound } from "lucide-react";

import { crmDelete, crmGet, crmPost } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanAct } from "../useAccess";
import { fmtDateShort } from "../../lib/datetime";
import { ActionError, ConfirmModal, Field, Modal, btnPrimary, btnSecondary, inputCls } from "./ui";

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
            To take on new work, set the status back to Active and assign people again.
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
