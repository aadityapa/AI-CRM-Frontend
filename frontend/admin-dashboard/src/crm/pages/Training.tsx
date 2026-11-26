/**
 * Training — approach → train → re-interview (25 Nov 2026).
 *
 * `TrainingPlansView` is the Bench & Deployed ▸ Training tab (every plan, success
 * rate per skill / trainer); `TrainingPlanPage` is `training/:id` — the plan with
 * its skills, tasks, AI interviews (practice / re-interview, scheduled from here),
 * before → after and, once passed, the positions to place them on.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight, Bot, CheckCircle2, ClipboardList, GraduationCap, Pencil, RefreshCw, RotateCcw, Search, Send, Target,
  TrendingUp, UserRound, XCircle,
} from "lucide-react";
import { crmDelete, crmGet, crmPost, qs } from "../api";
import { CrmLink, crmNavigate, useCrmParams } from "../router";
import { HERO_BTN, HERO_BTN_SOLID, PageHeader, StagePills } from "../components/PageHeader";
import { ConfirmModal, ErrorBox, useToast } from "../components/ui";
import { Panel, Tile } from "../components/controlTower";
import { FLOW_BTN } from "../components/flowButtons";
import {
  ClosePlanDialog, LEVEL_WORDS, useTrainingWriter, PlanDialog, STATUS_LOOK, TrainingInterviewDialog, type PlanStatus, type TrainingPlan,
} from "../components/training/TrainingParts";
import { useSessionState } from "../lib/pageState";
import { fmtDateShort, fmtDateTime12 } from "../../lib/datetime";

type Analytics = {
  counts: Record<PlanStatus, number>; total: number; success_rate: number | null; avg_uplift: number | null;
  by_skill: { name: string; plans: number; decided: number; passed: number; rate: number | null }[];
  by_trainer: { name: string; plans: number; decided: number; passed: number; rate: number | null; avg_uplift: number | null }[];
  pass_score: number;
};
const CONTROL = "input-recessed min-h-[38px] rounded-control px-3 py-2 text-sm text-primary";
const pctText = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)}%`);

function Score({ label, v, tone }: { label: string; v: number | null; tone?: string }) {
  return (
    <div className="rounded-control bg-surface-2 px-3 py-2 text-center">
      <div className={`text-lg font-extrabold tabular-nums ${tone || "text-primary"}`}>{pctText(v)}</div>
      <div className="text-[11px] font-semibold text-muted">{label}</div>
    </div>
  );
}

function Bar({ pct }: { pct: number | null }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <span className={`block h-full ${(pct ?? 0) >= 100 ? "bg-emerald-500" : "bg-sky-500"}`} style={{ width: `${pct ?? 0}%` }} />
    </span>
  );
}

/* ================================================================ list (Bench ▸ Training) */

export function TrainingPlansView() {
  const [status, setStatus] = useSessionState("training.status", "open");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<TrainingPlan[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [an, setAn] = useState<Analytics | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const [r, a] = await Promise.all([crmGet<TrainingPlan[]>(`/api/training/plans${qs({ status, search: q || undefined })}`),
                                        crmGet<Analytics>("/api/training/analytics")]);
      setRows(r.data); setCounts(((r.meta || {}) as unknown as { counts: Record<string, number> }).counts || {}); setAn(a.data);
    } catch (e) { setError((e as Error).message); }
  }, [status, q]);
  useEffect(() => { const t = setTimeout(() => void load(), q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  const open = (counts.Active || 0) + (counts.Interview_due || 0) + (counts.Not_yet || 0);
  return (
    <div className="space-y-4">
      {an && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Tile label="In training" value={an.counts.Active} tone="brand" onClick={() => setStatus("Active")} active={status === "Active"} />
          <Tile label="Re-interview due" value={an.counts.Interview_due} tone="warning" onClick={() => setStatus("Interview_due")} active={status === "Interview_due"} />
          <Tile label="Passed — ready" value={an.counts.Passed} tone="success" onClick={() => setStatus("Passed")} active={status === "Passed"} />
          <Tile label="Not yet" value={an.counts.Not_yet} tone="danger" onClick={() => setStatus("Not_yet")} active={status === "Not_yet"} />
          <Tile label="Success rate" value={pctText(an.success_rate)} sub={`pass mark ${an.pass_score}%`} tone="success" />
          <Tile label="Average uplift" value={an.avg_uplift == null ? "—" : `${an.avg_uplift > 0 ? "+" : ""}${an.avg_uplift} pts`} sub="after − before" tone="brand" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <StagePills label="Plan status" active={status} onChange={setStatus}
          tabs={[{ key: "open", label: `Open · ${open}` }, { key: "Active", label: "Training" }, { key: "Interview_due", label: "Re-interview due" },
                 { key: "Passed", label: "Passed" }, { key: "Not_yet", label: "Not yet" }, { key: "Closed", label: "Closed" }, { key: "", label: "All" }]} />
        <label className="relative ml-auto min-w-[220px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input type="text" className={`${CONTROL} w-full pl-8`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Person, skill, trainer" aria-label="Search plans" />
        </label>
      </div>
      {error && <ErrorBox error={error} onRetry={load} />}
      {!rows && !error && <div className="p-6 text-sm text-muted">Loading…</div>}
      {rows && rows.length === 0 && (
        <div className="rounded-card border border-dashed border-subtle p-8 text-center text-sm text-muted">
          No training plans here. Start one from a bench person's page (“Training plan”) or from Interview readiness (“Start training”).
        </div>
      )}
      {rows && rows.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {rows.map((p) => <PlanCard key={p.id} p={p} />)}
        </div>
      )}
      {an && (an.by_skill.length > 0 || an.by_trainer.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel className="!h-auto" title="Success rate by skill" hint="Plans decided by a re-interview or by hand">
            <RateTable rows={an.by_skill} />
          </Panel>
          <Panel className="!h-auto" title="Success rate by trainer">
            <RateTable rows={an.by_trainer} uplift />
          </Panel>
        </div>
      )}
    </div>
  );
}

function RateTable({ rows, uplift }: { rows: Analytics["by_trainer"] | Analytics["by_skill"]; uplift?: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted">
        <th className="py-1">Name</th><th className="py-1 text-right">Plans</th><th className="py-1 text-right">Decided</th>
        <th className="py-1 text-right">Passed</th><th className="py-1 text-right">Rate</th>{uplift && <th className="py-1 text-right">Uplift</th>}
      </tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.name} className="border-t border-subtle">
          <td className="py-1.5 font-semibold text-primary">{r.name}</td>
          <td className="py-1.5 text-right tabular-nums">{r.plans}</td><td className="py-1.5 text-right tabular-nums">{r.decided}</td>
          <td className="py-1.5 text-right tabular-nums">{r.passed}</td>
          <td className={`py-1.5 text-right font-bold tabular-nums ${(r.rate ?? 0) >= 60 ? "text-emerald-600" : "text-amber-700"}`}>{pctText(r.rate)}</td>
          {uplift && <td className="py-1.5 text-right tabular-nums">{"avg_uplift" in r && r.avg_uplift != null ? `${r.avg_uplift > 0 ? "+" : ""}${r.avg_uplift}` : "—"}</td>}
        </tr>))}</tbody>
    </table>
  );
}

function PlanCard({ p }: { p: TrainingPlan }) {
  return (
    <CrmLink to={`training/${p.id}`} className="block rounded-card border border-subtle bg-surface-1 p-4 shadow-raised transition hover:border-brand-300">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white"><GraduationCap size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <b className="truncate text-sm text-primary">{p.subject.name}</b>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${STATUS_LOOK[p.status]}`}>{p.status_label}</span>
          </div>
          <p className="truncate text-xs text-secondary">{p.title}</p>
          <p className="text-[11px] text-muted">{p.subject.kind === "employee" ? "Employee" : "Candidate"} · trainer {p.trainer_name || "—"}
            {p.target_date && ` · by ${fmtDateShort(p.target_date)}`}{p.days_left != null && p.open && p.days_left < 0 && " · overdue"}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">{p.skills.slice(0, 6).map((s) => (
        <span key={s.name} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.task === "Done" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-surface-2 text-secondary"}`}>
          {s.task === "Done" && "✓ "}{s.name} → {s.target}</span>))}</div>
      <div className="mt-3 grid grid-cols-3 items-end gap-2 text-xs">
        <div><span className="text-muted">Tasks</span><Bar pct={p.tasks_percent} /><span className="text-secondary">{p.tasks_done}/{p.tasks_total}</span></div>
        <div className="text-center"><span className="block text-muted">Before</span><b className="text-primary">{pctText(p.baseline)}</b></div>
        <div className="text-center"><span className="block text-muted">After</span>
          <b className={p.after == null ? "text-muted" : p.status === "Passed" ? "text-emerald-600" : "text-amber-700"}>{pctText(p.after)}</b>
          {p.uplift != null && <span className="ml-1 text-[11px] text-emerald-600">{p.uplift > 0 ? "+" : ""}{p.uplift}</span>}</div>
      </div>
      {p.scheduled && <p className="mt-2 text-[11px] font-semibold text-purple-700 dark:text-purple-300">
        <Bot size={11} className="mr-1 inline" />{p.scheduled.kind_label} scheduled {fmtDateTime12(p.scheduled.scheduled_at)}</p>}
    </CrmLink>
  );
}

/* ================================================================ plan page */

export function TrainingPlanPage() {
  const { id } = useCrmParams();
  const [p, setP] = useState<TrainingPlan | null>(null);
  const [error, setError] = useState("");
  const [toastEl, toast] = useToast();
  const canEdit = useTrainingWriter();
  const [dialog, setDialog] = useState<null | "edit" | "practice" | "re_interview" | "close">(null);
  const [cancelIv, setCancelIv] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setError("");
    try { setP((await crmGet<TrainingPlan>(`/api/training/plans/${id}`)).data); } catch (e) { setError((e as Error).message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!p) return <div className="p-6 text-sm text-muted">Loading…</div>;
  const done = (plan: TrainingPlan, m: string) => { setP(plan); setDialog(null); toast(m); };
  const act = async (path: string, body?: unknown) => {
    setBusy(true);
    try { const r = await crmPost<TrainingPlan>(path, body ?? {}); setP(r.data); toast(r.message || "Done"); }
    catch (e) { toast((e as Error).message, "err"); }
    finally { setBusy(false); }
  };
  const isEmp = p.subject.kind === "employee";
  const apply = async (requirementId: number) => {
    if (!p.subject.candidate_id) return;
    setBusy(true);
    try {
      const r = await crmPost(`/api/candidates/${p.subject.candidate_id}/multi-apply`,
        { items: [{ requirement_id: requirementId }], note: `Passed the training re-interview — ${p.title}` });
      toast(r.message || "Applied");
    } catch (e) { toast((e as Error).message, "err"); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      {toastEl}
      <PageHeader icon={GraduationCap} accent={p.status === "Passed" ? "teal" : p.status === "Not_yet" ? "amber" : "violet"}
        eyebrow={<CrmLink to="bench?tab=training" className="hover:underline">← Training plans</CrmLink>}
        title={p.subject.name} subtitle={`${p.title} · ${p.status_label}`}
        stats={[
          { label: "Before", value: pctText(p.baseline), title: p.baseline_label || undefined },
          { label: "After", value: pctText(p.after) },
          { label: "Tasks done", value: `${p.tasks_done}/${p.tasks_total}` },
          { label: "Days logged", value: p.activity_days ?? "—" },
          { label: "Target", value: p.target_date ? fmtDateShort(p.target_date) : "—" },
        ]}
        actions={<>
          {canEdit && p.status !== "Closed" && <>
            <button type="button" className={HERO_BTN_SOLID} onClick={() => setDialog("re_interview")} disabled={!!p.scheduled && p.scheduled.kind === "re_interview"}>
              <Bot size={14} /> AI re-interview</button>
            <button type="button" className={HERO_BTN} onClick={() => setDialog("practice")}><Bot size={14} /> Practice interview</button>
            <button type="button" className={HERO_BTN} onClick={() => setDialog("edit")}><Pencil size={14} /> Edit</button>
            <button type="button" className={HERO_BTN} onClick={() => setDialog("close")}><Target size={14} /> Decide</button>
          </>}
          {canEdit && !p.open && <button type="button" className={HERO_BTN} disabled={busy} onClick={() => void act(`/api/training/plans/${p.id}/reopen`)}><RotateCcw size={14} /> Reopen</button>}
          {p.subject.path && <button type="button" className={HERO_BTN} onClick={() => crmNavigate(p.subject.path!)}><UserRound size={14} /> {isEmp ? "Bench page" : "Candidate"}</button>}
          <button type="button" className={HERO_BTN} onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
        </>} />

      {p.status === "Passed" && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100">
          <CheckCircle2 size={18} /> <b>Ready to place.</b> {p.closed_by_name && <span>Decided by {p.closed_by_name}{p.closed_at ? `, ${fmtDateShort(p.closed_at)}` : ""}.</span>}
          {p.outcome_note && <span>“{p.outcome_note}”</span>}
        </div>
      )}
      {p.status === "Not_yet" && (
        <div className="rounded-card border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <b>Not yet.</b> Keep training on the weak skills and schedule another re-interview. {p.outcome_note && `“${p.outcome_note}”`}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel className="!h-auto" title="Skills" hint="Level now → target · the task status per skill">
            <div className="grid gap-2 sm:grid-cols-2">
              {p.skills.map((s) => (
                <div key={s.name} className="rounded-control border border-subtle bg-surface-1 p-2.5">
                  <div className="flex items-center justify-between gap-2"><b className="text-sm text-primary">{s.name}</b>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${s.task === "Done" ? "bg-emerald-100 text-emerald-700" : s.task === "In_Progress" ? "bg-sky-100 text-sky-700" : "bg-surface-2 text-muted"}`}>
                      {s.task ? s.task.replace("_", " ") : isEmp ? "No task" : "—"}</span></div>
                  <p className="mt-1 text-xs text-secondary">{s.current ? `${s.current} · ${LEVEL_WORDS[s.current]}` : "Not rated"} <ArrowRight size={11} className="inline" /> <b>{s.target} · {LEVEL_WORDS[s.target]}</b></p>
                </div>))}
            </div>
            {canEdit && isEmp && p.skills.some((s) => !s.task) && (
              <button type="button" className={`${FLOW_BTN.edit} mt-3`} disabled={busy} onClick={() => void act(`/api/training/plans/${p.id}/tasks`, {})}>
                <ClipboardList size={13} /> Add a task for every skill</button>)}
          </Panel>

          <Panel className="!h-auto" title="AI interviews on this plan" hint="Practice never decides; a re-interview does.">
            {p.interviews.length === 0 ? (
              <p className="text-sm text-muted">None yet. When they are ready, press <b>AI re-interview</b> — it asks on this plan's skills.</p>
            ) : (
              <ul className="space-y-2">{p.interviews.map((iv) => (
                <li key={iv.id} className="rounded-control border border-subtle bg-surface-1 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${iv.kind === "practice" ? "bg-sky-100 text-sky-700" : "bg-purple-100 text-purple-700"}`}>{iv.kind_label}</span>
                    <span className="text-sm font-semibold text-primary">{iv.template_title || iv.template_job_id}</span>
                    <span className="text-xs text-muted">{iv.status === "Scheduled" ? `scheduled ${fmtDateTime12(iv.scheduled_at)}` : iv.completed_at ? fmtDateShort(iv.completed_at) : ""}</span>
                    <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      iv.status === "Completed" ? (iv.passed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800")
                        : iv.status === "Scheduled" ? "bg-surface-2 text-secondary" : "bg-rose-100 text-rose-700"}`}>
                      {iv.status === "Completed" ? (iv.passed ? "Passed" : "Below the bar") : iv.status.replace("_", " ")}</span>
                  </div>
                  {iv.status === "Completed" && (
                    <div className="mt-2 grid grid-cols-3 gap-2"><Score label="Overall" v={iv.overall} tone={iv.passed ? "text-emerald-600" : "text-amber-700"} />
                      <Score label="Technical" v={iv.technical} /><Score label="Communication" v={iv.communication} /></div>)}
                  <p className="mt-1 text-[11px] text-muted">Skills: {iv.skills.join(", ")} · to {iv.email} · by {iv.created_by_name || "—"}</p>
                  {canEdit && iv.status === "Scheduled" && (
                    <button type="button" className={`${FLOW_BTN.danger} mt-2`} onClick={() => setCancelIv(iv.id)}><XCircle size={13} /> Cancel</button>)}
                </li>))}</ul>
            )}
          </Panel>

          {isEmp && p.tasks && p.tasks.length > 0 && (
            <Panel className="!h-auto" title="Training tasks (their My Workspace)">
              <ul className="divide-y divide-subtle text-sm">{p.tasks.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="font-semibold text-primary">{t.title}</span>
                  <span className="text-xs text-muted">{t.status.replace("_", " ")}{t.due_date && ` · due ${fmtDateShort(t.due_date)}`}</span>
                  {t.overdue && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">Overdue</span>}
                  {t.progress_note && <span className="w-full text-xs text-secondary">“{t.progress_note}”</span>}
                </li>))}</ul>
            </Panel>
          )}
        </div>

        <div className="space-y-4">
          <Panel className="!h-auto" title="Before → after">
            <div className="flex items-center justify-around gap-2 py-2">
              <Score label="Before training" v={p.baseline} />
              <TrendingUp className={p.uplift != null && p.uplift > 0 ? "text-emerald-600" : "text-muted"} />
              <Score label="Re-interview" v={p.after} tone={p.status === "Passed" ? "text-emerald-600" : undefined} />
            </div>
            <p className="text-center text-xs text-secondary">{p.uplift != null ? `${p.uplift > 0 ? "+" : ""}${p.uplift} points` : p.baseline_label || "No score before training on record"}</p>
          </Panel>
          {(p.positions || []).length > 0 && (
            <Panel className="!h-auto" title="Place them now" hint="Open positions their skills fit">
              <ul className="space-y-2">{(p.positions || []).map((pos) => (
                <li key={pos.requirement_id} className="rounded-control border border-subtle p-2.5 text-sm">
                  <div className="flex items-center gap-2"><CrmLink to={`requirements/${pos.requirement_id}`} className="font-semibold text-brand-700 hover:underline">{pos.title}</CrmLink>
                    <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">{pos.score}%</span></div>
                  <p className="text-[11px] text-muted">{pos.opp_id} · {pos.customer || "—"} · {pos.open} open</p>
                  {pos.missing.length > 0 && <p className="text-[11px] text-amber-700">Missing: {pos.missing.join(", ")}</p>}
                  {canEdit && p.subject.candidate_id && (
                    <button type="button" className={`${FLOW_BTN.success} mt-1.5`} disabled={busy} onClick={() => void apply(pos.requirement_id)}><Send size={12} /> Apply</button>)}
                </li>))}</ul>
              {!p.subject.candidate_id && <p className="mt-2 text-[11px] text-muted">No candidate record behind this employee — share their resume with Sales from the Bench page.</p>}
            </Panel>
          )}
          <Panel className="!h-auto" title="About the plan">
            <dl className="space-y-1 text-xs">
              <div><dt className="inline text-muted">Trainer: </dt><dd className="inline text-primary">{p.trainer_name || "—"}</dd></div>
              <div><dt className="inline text-muted">Started: </dt><dd className="inline text-primary">{fmtDateShort(p.created_at)} by {p.created_by_name || "—"}</dd></div>
              <div><dt className="inline text-muted">From: </dt><dd className="inline text-primary">{({ readiness: "Interview readiness", bench: "Bench & Deployed", skill_gap: "Skill gap", manual: "Started by hand" } as Record<string, string>)[p.source] || p.source}</dd></div>
              {p.notes && <div className="pt-1 text-secondary">“{p.notes}”</div>}
            </dl>
          </Panel>
        </div>
      </div>

      {dialog === "edit" && <PlanDialog plan={p} onClose={() => setDialog(null)} onDone={done} />}
      {(dialog === "practice" || dialog === "re_interview") && (
        <TrainingInterviewDialog plan={p} initialKind={dialog} onClose={() => setDialog(null)}
          onDone={(r, m) => { setP(r.plan); toast(m); }} />)}
      {dialog === "close" && <ClosePlanDialog plan={p} onClose={() => setDialog(null)} onDone={done} />}
      {cancelIv != null && (
        <ConfirmModal title="Cancel this interview?" message="The link stops working and the plan goes back to training."
          confirmLabel="Cancel interview" danger onClose={() => setCancelIv(null)}
          onConfirm={async () => {
            try { const r = await crmDelete<TrainingPlan>(`/api/training/plans/${p.id}/interviews/${cancelIv}`); setP(r.data); toast(r.message || "Cancelled"); }
            catch (e) { toast((e as Error).message, "err"); }
            setCancelIv(null);
          }} />)}
    </div>
  );
}
