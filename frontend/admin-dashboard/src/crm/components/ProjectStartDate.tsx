/**
 * Project start date inside Edit project (24 Nov 2026; server: B-V2
 * `services/project_start_date.py`, `GET|PUT /api/projects/{id}/start-date`).
 *
 * User ask: "show the current date when I click Edit Project, let us update it,
 * and from the updated month the timesheets are added (Draft) in the Timesheet
 * tab for the employee" — teams need old timesheets.
 *
 * The start is the team's earliest onboarding. The form shows it, takes a new
 * date and the people who move with it (pre-ticked: everyone who started on the
 * current start), previews what saving does (Draft timesheets per month, days
 * added, sheets removed, what blocks) and saves at once. Nothing is computed
 * here that the server does not decide — the preview IS the server's.
 */
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CalendarPlus, FileClock, Trash2, TriangleAlert, Users } from "lucide-react";

import { crmGet, crmPut } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanAct } from "../useAccess";
import { fmtDateShort } from "../../lib/datetime";
import { inputCls } from "./ui";

export type StartTeamRow = {
  project_employee_id: number;
  employee_id: number;
  name: string | null;
  onboarding_date: string | null;
  billing_date: string | null;
  exit_date: string | null;
  is_exit: boolean;
  started_with_project: boolean;
  picked: boolean;
};

export type StartPersonPlan = {
  project_employee_id: number;
  name: string;
  from: string | null;
  to: string;
  create: string[];
  fill: string[];
  remove: string[];
  trim: string[];
  blocked: string[];
  before_window: string[];
  window_note?: string;
  refusal: string | null;
};

export type StartPreview = {
  start_date: string | null;
  team: StartTeamRow[];
  data_start?: { key: string; label: string };
  end_date?: string | null;
  new_start?: string;
  direction?: "earlier" | "later" | "same" | "set";
  people?: StartPersonPlan[];
  draft_months?: number;
  blocked?: string[];
  refusals?: string[];
  ok?: boolean;
};

const CONTROL = inputCls.replace("w-full", "").trim();

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** One-click dates around the current start: its 1st, and 1 / 3 / 6 months earlier. PURE. */
export function startPicks(current: string | null, today: Date = new Date()): { label: string; value: string }[] {
  const base = current ? new Date(`${current}T00:00:00`) : today;
  const first = (months: number) => isoDay(new Date(base.getFullYear(), base.getMonth() - months, 1));
  const out = [
    { label: "1 month earlier", value: first(1) },
    { label: "3 months earlier", value: first(3) },
    { label: "6 months earlier", value: first(6) },
  ];
  if (base.getDate() !== 1) out.unshift({ label: `1st of ${base.toLocaleString("en-IN", { month: "short" })}`, value: first(0) });
  return out;
}

/** What the save button should say is still missing, or null. PURE. */
export function startProblem(p: StartPreview | null, picked: number): string | null {
  if (!p?.new_start) return "Pick the new start date.";
  if (!picked) return "Tick who starts on that day.";
  if (p.direction === "same" && !(p.people || []).length) return "That is already the start date.";
  if ((p.refusals || []).length) return p.refusals![0];
  if ((p.blocked || []).length) return "A sent or approved timesheet blocks this — see below.";
  if (!(p.people || []).length) return "Nobody's start changes.";
  return null;
}

export function ProjectStartDateBody({
  projectId,
  notify,
  onChanged,
}: {
  projectId: number;
  notify: (msg: string, kind?: "ok" | "err") => void;
  onChanged?: () => void;
}) {
  const canEdit = useCanAct("projects", "edit", useHasRole("Sales_Head", "Finance"));
  const [base, setBase] = useState<StartPreview | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [newStart, setNewStart] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<StartPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const load = async () => {
    setLoadErr(null);
    try {
      const r = await crmGet<StartPreview>(`/api/projects/${projectId}/start-date`);
      setBase(r.data);
      setNewStart(r.data.start_date || "");
      setPicked(new Set(r.data.team.filter((t) => t.picked).map((t) => t.project_employee_id)));
      setPreview(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Could not read the project's start date.");
    }
  };
  useEffect(() => { void load(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = !!newStart && newStart !== (base?.start_date || "");
  const pickedKey = useMemo(() => [...picked].sort((a, b) => a - b).join(","), [picked]);

  useEffect(() => {
    setSaveErr(null);
    if (!changed || !picked.size) { setPreview(null); setPreviewErr(null); return; }
    let live = true;
    const t = window.setTimeout(async () => {
      try {
        const r = await crmGet<StartPreview>(
          `/api/projects/${projectId}/start-date?start_date=${newStart}&pe_ids=${pickedKey}`);
        if (live) { setPreview(r.data); setPreviewErr(null); }
      } catch (e) {
        if (live) setPreviewErr(e instanceof Error ? e.message : "Could not preview the change.");
      }
    }, 300);
    return () => { live = false; window.clearTimeout(t); };
  }, [projectId, newStart, pickedKey, changed, picked.size]);

  const problem = changed ? startProblem(preview, picked.size) : null;

  const save = async () => {
    if (problem || !changed) return;
    setBusy(true);
    setSaveErr(null);
    try {
      const r = await crmPut<unknown>(`/api/projects/${projectId}/start-date`, {
        start_date: newStart, pe_ids: [...picked], reason: reason.trim() || null,
      });
      notify(r.message || "Start date updated", "ok");
      setReason("");
      await load();
      onChanged?.();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Could not update the start date.");
    } finally {
      setBusy(false);
    }
  };

  if (loadErr) {
    return (
      <div className="rounded-card border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
        {loadErr} <button type="button" className="ml-2 font-semibold underline" onClick={() => void load()}>Try again</button>
      </div>
    );
  }
  if (!base) return <div className="h-24 animate-pulse rounded-card bg-surface-2" />;

  const team = base.team;
  const plans = preview?.people || [];

  return (
    <div className="space-y-4" data-wizard-enter-off>
      {/* Current start */}
      <div className="flex flex-wrap items-center gap-4 rounded-card border border-default bg-surface-1 p-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-gradient-to-br from-sky-500 to-indigo-600 text-white">
          <CalendarDays size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Current start date</div>
          <div className="text-xl font-bold text-primary">
            {base.start_date ? fmtDateShort(base.start_date) : "Not set — no employee mapped yet"}
          </div>
          <div className="text-xs text-secondary">
            The day the team started on this project (their onboarding date).
            {base.data_start ? ` Timesheets are kept from ${base.data_start.label}.` : ""}
          </div>
        </div>
      </div>

      {!team.length ? (
        <p className="text-sm text-secondary">Map an employee first — the start date is their onboarding date.</p>
      ) : !canEdit ? (
        <p className="text-sm text-secondary">Ask Sales Head or Finance to change the start date.</p>
      ) : (
        <>
          {/* New start */}
          <div className="rounded-card border border-default bg-surface-1 p-4">
            <label htmlFor="proj-new-start" className="text-sm font-semibold text-primary">New start date</label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                id="proj-new-start"
                type="date"
                className={`${CONTROL} !w-48`}
                value={newStart}
                max={base.end_date || undefined}
                onChange={(e) => setNewStart(e.target.value)}
              />
              {startPicks(base.start_date).map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setNewStart(p.value)}
                  className={`rounded-pill border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    newStart === p.value ? "border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200"
                      : "border-default text-secondary hover:border-strong hover:text-primary"}`}
                >
                  {p.label}
                </button>
              ))}
              {changed ? (
                <button type="button" className="text-xs font-semibold text-muted underline"
                  onClick={() => setNewStart(base.start_date || "")}>Undo</button>
              ) : null}
            </div>
          </div>

          {/* Who moves */}
          <div className="rounded-card border border-default bg-surface-1 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-primary">
              <Users size={16} /> Who starts on the new date
            </div>
            <p className="mt-0.5 text-xs text-secondary">
              Their onboarding date moves (billing date and first rate too). People who joined later are left as they are.
            </p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {team.map((t) => {
                const on = picked.has(t.project_employee_id);
                return (
                  <li key={t.project_employee_id}>
                    <label className={`flex cursor-pointer items-start gap-3 rounded-control border p-3 ${
                      on ? "border-brand-600 bg-brand-50/60 dark:bg-brand-900/20" : "border-default"}`}>
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={on}
                        onChange={() => setPicked((s) => {
                          const n = new Set(s);
                          if (n.has(t.project_employee_id)) n.delete(t.project_employee_id); else n.add(t.project_employee_id);
                          return n;
                        })}
                      />
                      <span className="min-w-0">
                        <span className="block font-semibold text-primary">{t.name || `Employee #${t.employee_id}`}</span>
                        <span className="block text-xs text-secondary">
                          Joined {t.onboarding_date ? fmtDateShort(t.onboarding_date) : "— no date"}
                          {t.exit_date ? ` · ${t.is_exit ? "left" : "leaves"} ${fmtDateShort(t.exit_date)}` : ""}
                          {t.started_with_project ? "" : " · joined later"}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* What happens */}
          {changed && picked.size ? (
            <div className="rounded-card border border-default bg-surface-1 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                <FileClock size={16} /> What saving does
              </div>
              {previewErr ? <p className="mt-2 text-sm text-danger">{previewErr}</p> : null}
              {!preview && !previewErr ? <p className="mt-2 text-xs text-muted">Working it out…</p> : null}
              {preview ? (
                <div className="mt-2 space-y-3">
                  {plans.map((p) => (
                    <div key={p.project_employee_id} className="rounded-control border border-default p-3 text-sm">
                      <div className="font-semibold text-primary">
                        {p.name}: {p.from ? fmtDateShort(p.from) : "no date"} → {fmtDateShort(p.to)}
                      </div>
                      {p.refusal ? <p className="mt-1 text-danger">{p.refusal}</p> : null}
                      {p.create.length ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                            <CalendarPlus size={13} /> New Draft timesheets:
                          </span>
                          {p.create.map((m) => (
                            <span key={m} className="rounded-pill bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">{m}</span>
                          ))}
                        </div>
                      ) : null}
                      {p.fill.length ? (
                        <p className="mt-1 text-xs text-secondary">Days added to the Draft timesheet of {p.fill.join(", ")}.</p>
                      ) : null}
                      {p.remove.length ? (
                        <p className="mt-1 inline-flex items-center gap-1 text-xs text-warning">
                          <Trash2 size={12} /> Untouched timesheets removed: {p.remove.join(", ")}.
                        </p>
                      ) : null}
                      {p.trim.length ? (
                        <p className="mt-1 text-xs text-secondary">Days before the new start leave the Draft of {p.trim.join(", ")}.</p>
                      ) : null}
                      {p.blocked.length ? (
                        <p className="mt-1 text-xs text-danger">Blocked by: {p.blocked.join(", ")} — reject or reopen it first.</p>
                      ) : null}
                      {p.window_note ? (
                        <p className="mt-1 inline-flex items-start gap-1 text-xs text-warning">
                          <TriangleAlert size={12} className="mt-0.5 shrink-0" /> {p.window_note}
                        </p>
                      ) : null}
                      {!p.refusal && !p.create.length && !p.fill.length && !p.remove.length && !p.trim.length && !p.blocked.length ? (
                        <p className="mt-1 text-xs text-secondary">
                          {p.window_note
                            ? "Only the dates move — no timesheet is opened for the months above. To get them, set Data starts from to the start month first, then press Update start date."
                            : "Only the dates move — every month already has a timesheet."}
                        </p>
                      ) : null}
                    </div>
                  ))}
                  <p className="text-xs text-secondary">
                    New timesheets appear in the Timesheets tab as Draft, with their days, ready to fill and submit.
                  </p>
                </div>
              ) : null}
              <label htmlFor="proj-start-reason" className="mt-3 block text-xs font-semibold text-secondary">
                Note (optional — kept on the customer's Activity Log)
              </label>
              <input
                id="proj-start-reason"
                className={`${inputCls} mt-1`}
                value={reason}
                maxLength={1000}
                placeholder="e.g. Customer confirmed the work started in April"
                onChange={(e) => setReason(e.target.value)}
              />
              {saveErr ? <p className="mt-2 text-sm text-danger">{saveErr}</p> : null}
              <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
                {problem ? <span className="text-xs text-muted">{problem}</span> : null}
                <button
                  type="button"
                  disabled={!!problem || busy}
                  onClick={() => void save()}
                  className="inline-flex items-center gap-2 rounded-control bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-raised disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <CalendarDays size={15} /> {busy ? "Updating…" : "Update start date"}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
