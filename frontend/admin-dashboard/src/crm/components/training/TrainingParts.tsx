/**
 * Training plans — approach → train → re-interview (25 Nov 2026).
 *
 * Shared pieces for the Bench person page, Interview readiness, the Bench
 * Training tab and the plan page: the "Start training plan" dialog, the AI
 * interview dialog (RMG takes a bench employee's AI interview on the plan's
 * skills, from the plan), the close dialog and the status chip. Server:
 * `routers/crm/training.py` / `services/training_plans.py` (B-V2).
 */
import { useEffect, useMemo, useState } from "react";
import {
  Bot, CalendarClock, CheckCircle2, ClipboardCopy, GraduationCap, Plus, Sparkles, Star, Target, Trash2, X,
} from "lucide-react";
import { crmGet, crmPost, crmPut } from "../../api";
import { useHasRole } from "../../CrmApp";
import { useCanAct, useCanApprove } from "../../useAccess";
import { CrmLink } from "../../router";
import { Modal } from "../ui";
import {
  DialogActions, DialogFailure, DialogHero, DialogSection, QuickPicks, ReasonBox, WhatHappens,
  type DialogTone,
} from "../dialogKit";
import { toDateKey } from "../../lib/calendarDates";

export type PlanSkill = { name: string; current: number | null; target: number; task?: string | null };
export type TrainingInterview = {
  id: number; plan_id: number; kind: "practice" | "re_interview"; kind_label: string;
  status: "Scheduled" | "Completed" | "Not_attempted" | "Cancelled";
  template_job_id: string | null; template_title: string | null; skills: string[]; email: string | null;
  scheduled_at: string | null; overall: number | null; technical: number | null; communication: number | null;
  recommendation: string | null; passed: boolean | null; interview_record_id: string | null;
  invite_token: string | null; created_by_name: string | null; created_at: string | null; completed_at: string | null;
};
export type PlanSubject = {
  kind: "employee" | "candidate" | "unknown"; employee_id: number | null; candidate_id: number | null;
  name: string; code: string | null; email: string | null; phone: string | null; skills: string[];
  experience: number | null; path: string | null;
};
export type TrainingPlan = {
  id: number; title: string; status: PlanStatus; status_label: string; subject: PlanSubject;
  skills: PlanSkill[]; target_date: string | null; days_left: number | null; requirement_id: number | null;
  trainer_user_id: number | null; trainer_name: string | null; source: string; notes: string | null;
  outcome_note: string | null; baseline: number | null; baseline_label: string | null; after: number | null;
  uplift: number | null; latest_score: number | null; tasks_total: number; tasks_done: number;
  tasks_percent: number | null; activity_days: number | null; interviews: TrainingInterview[];
  scheduled: TrainingInterview | null; created_by_name: string | null; created_at: string | null;
  updated_at: string | null; closed_at: string | null; closed_by_name: string | null; open: boolean;
  tasks?: { id: number; title: string; status: string; due_date: string | null; skill?: string | null;
            progress_note: string | null; overdue: boolean }[];
  positions?: { requirement_id: number; req_number: string; title: string; opportunity_id: number; opp_id: string;
                customer: string | null; open: number; score: number | null; matched: string[]; missing: string[];
                exp_fit: boolean | null }[];
};
export type PlanStatus = "Active" | "Interview_due" | "Passed" | "Not_yet" | "Closed";
export type TrainingTemplate = { job_id: string; title: string; skills: string[]; question_type?: string | null;
  num_q?: number | null; timing_mode?: string | null; time_limit_sec?: number | null };
export type TrainingMeta = { templates: TrainingTemplate[]; trainers: { id: number; name: string }[];
  statuses: { key: PlanStatus; label: string }[]; pass_score: number; communication_ok: number; max_skills: number };
/** What a list row (bench / readiness) carries about its latest plan. */
export type TrainingRef = { plan_id: number; status: PlanStatus; status_label: string; title: string; after?: number | null } | null | undefined;

export const STATUS_LOOK: Record<PlanStatus, string> = {
  Active: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-800",
  Interview_due: "bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-950/40 dark:text-purple-200 dark:ring-purple-800",
  Passed: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800",
  Not_yet: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800",
  Closed: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
};
export const LEVEL_WORDS = ["", "Aware", "Basic", "Working", "Strong", "Expert"];
const CTRL = "input-recessed min-h-[38px] w-full rounded-control px-3 py-2 text-sm text-primary";

/** RMG by role, a grant on `bench`, or a screener (GM) — the server's gate for plans. */
export function useTrainingWriter(): boolean {
  const rmg = useHasRole("RMG");
  const screener = useCanApprove("profile.rmg_screening");
  const grant = useCanAct("bench", "edit", rmg);
  return rmg || screener || grant;
}

let metaPromise: Promise<TrainingMeta> | null = null;
/** One read of `/api/training/meta` per page load (retried after a failure). */
export function useTrainingMeta(): TrainingMeta | null {
  const [m, setM] = useState<TrainingMeta | null>(null);
  useEffect(() => {
    if (!metaPromise) metaPromise = crmGet<TrainingMeta>("/api/training/meta").then((r) => r.data)
      .catch((e) => { metaPromise = null; throw e; });
    metaPromise.then(setM).catch(() => setM(null));
  }, []);
  return m;
}

/** PURE: the template whose skills overlap the plan's most (twin of the server's `suggest_template`). */
export function suggestTemplate(templates: TrainingTemplate[], skills: string[]): string | null {
  const want = new Set(skills.map((s) => s.toLowerCase()));
  let best: string | null = null; let score = 0;
  for (const t of templates) {
    const n = (t.skills || []).filter((s) => want.has(s.toLowerCase())).length;
    if (n > score) { best = t.job_id; score = n; }
  }
  return best;
}

/** PURE: add a skill (unique, case-insensitive). */
export function addPlanSkill(list: PlanSkill[], name: string, current: number | null = null, target = 4): PlanSkill[] {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n || list.some((s) => s.name.toLowerCase() === n.toLowerCase())) return list;
  return [...list, { name: n, current, target: Math.max(target, current ?? 1) }];
}

/** PURE: "YYYY-MM-DD" n days from `from`. */
export function plusDays(n: number, from: Date = new Date()): string {
  const d = new Date(from); d.setDate(d.getDate() + n); return toDateKey(d);
}

export function TrainingChip({ training, compact }: { training: TrainingRef; compact?: boolean }) {
  if (!training) return null;
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <span onClick={(e) => e.stopPropagation()}><CrmLink to={`training/${training.plan_id}`}
      title={`Training plan: ${training.title}`}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset hover:underline ${STATUS_LOOK[training.status]}`}>
      <GraduationCap size={11} aria-hidden />{compact ? training.status_label : `Training · ${training.status_label}`}
      {training.after != null && ` · ${Math.round(training.after)}%`}
    </CrmLink></span>
  );
}

function LevelSelect({ value, onChange, label, allowBlank }: { value: number | null; onChange: (v: number | null) => void; label: string; allowBlank?: boolean }) {
  return (
    <select className="input-recessed h-8 rounded-control px-2 text-xs text-primary" aria-label={label}
      value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      {allowBlank && <option value="">Not rated</option>}
      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} · {LEVEL_WORDS[n]}</option>)}
    </select>
  );
}

/* =========================================================== start / edit plan */

export function PlanDialog({ subject, plan, suggestions = [], weak = [], source = "manual", requirementId, onClose, onDone }: {
  /** Who is trained (create mode). */
  subject?: { employee_id?: number | null; candidate_id?: number | null; name: string; isEmployee: boolean };
  /** Edit mode. */
  plan?: TrainingPlan;
  /** Skill names offered as one-tap picks (their skills, the gap skill …). */
  suggestions?: string[];
  /** Weak skills — prefilled with their level now. */
  weak?: { name: string; current?: number | null; target?: number | null }[];
  source?: "readiness" | "bench" | "skill_gap" | "manual";
  requirementId?: number | null;
  onClose: () => void;
  onDone: (plan: TrainingPlan, message: string) => void;
}) {
  const meta = useTrainingMeta();
  const editing = !!plan;
  const [skills, setSkills] = useState<PlanSkill[]>(() => plan ? plan.skills.map((s) => ({ name: s.name, current: s.current, target: s.target }))
    : weak.reduce<PlanSkill[]>((acc, w) => addPlanSkill(acc, w.name, w.current ?? null, w.target ?? 4), []));
  const [draft, setDraft] = useState("");
  const [title, setTitle] = useState(plan?.title || "");
  const [target, setTarget] = useState(plan?.target_date || plusDays(28));
  const [trainer, setTrainer] = useState<number | "">(plan?.trainer_user_id ?? "");
  const [notes, setNotes] = useState(plan?.notes || "");
  const [addTasks, setAddTasks] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isEmployee = editing ? plan!.subject.kind === "employee" : !!subject?.isEmployee;
  const name = editing ? plan!.subject.name : subject?.name || "";
  const offered = suggestions.filter((s) => !skills.some((k) => k.name.toLowerCase() === s.toLowerCase())).slice(0, 12);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const body = { title: title.trim() || null, skills: skills.map(({ name: n, current, target: t }) => ({ name: n, current, target: t })),
                     target_date: target || null, trainer_user_id: trainer || null, notes: notes.trim() || null };
      const r = editing ? await crmPut<TrainingPlan>(`/api/training/plans/${plan!.id}`, body)
        : await crmPost<TrainingPlan>("/api/training/plans", { ...body, employee_id: subject?.employee_id || null,
            candidate_id: subject?.employee_id ? null : subject?.candidate_id || null, source,
            requirement_id: requirementId || null, add_tasks: isEmployee && addTasks });
      onDone(r.data, r.message || "Saved");
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const missing = skills.length === 0 ? "Add at least one skill to train" : "";
  return (
    <Modal title={editing ? "Edit training plan" : "Start a training plan"} onClose={onClose} xl
      hero={<DialogHero tone="emerald" icon={GraduationCap} eyebrow={editing ? "Training plan" : "Approach → train → re-interview"}
        title={editing ? "Edit the training plan" : "Start a training plan"} person={{ name, meta: isEmployee ? "Employee" : "Candidate" }}
        flow={{ steps: ["Plan the skills", "Train (tasks + daily log)", "AI re-interview", "Ready to place"], current: editing ? 1 : 0 }} />}>
      <div className="space-y-4">
        <DialogSection n={1} title="Skills to train" done={skills.length > 0} tone="emerald"
          hint="Level now → the level they should reach. The AI re-interview asks on these skills.">
          <div className="space-y-2">
            {skills.map((s, i) => (
              <div key={s.name} className="flex flex-wrap items-center gap-2 rounded-control border border-subtle bg-surface-1 p-2">
                <span className="min-w-[140px] flex-1 text-sm font-semibold text-primary">{s.name}</span>
                <span className="text-[11px] text-muted">Now</span>
                <LevelSelect label={`${s.name} level now`} allowBlank value={s.current}
                  onChange={(v) => setSkills(skills.map((x, j) => j === i ? { ...x, current: v, target: Math.max(x.target, v ?? 1) } : x))} />
                <Target size={13} className="text-emerald-600" aria-hidden />
                <LevelSelect label={`${s.name} target level`} value={s.target}
                  onChange={(v) => setSkills(skills.map((x, j) => j === i ? { ...x, target: v ?? 4 } : x))} />
                <button type="button" className="rounded p-1 text-muted hover:bg-surface-2 hover:text-rose-600" aria-label={`Remove ${s.name}`}
                  onClick={() => setSkills(skills.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
              </div>
            ))}
            <div className="flex gap-2">
              <input type="text" className={CTRL} value={draft} placeholder="Type a skill and press Enter (e.g. AUTOSAR, CAPL)"
                aria-label="Add a skill" onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setSkills(addPlanSkill(skills, draft)); setDraft(""); } }} />
              <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded-control bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700"
                onClick={() => { setSkills(addPlanSkill(skills, draft)); setDraft(""); }}><Plus size={14} /> Add</button>
            </div>
            {offered.length > 0 && <QuickPicks label="Add" options={offered} tone="emerald" onPick={(s) => setSkills(addPlanSkill(skills, s))} />}
          </div>
        </DialogSection>
        <DialogSection n={2} title="By when, and who trains" done={!!target} tone="emerald">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-secondary">Target date
              <input type="date" className={`${CTRL} mt-1`} value={target} onChange={(e) => setTarget(e.target.value)} />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {[[14, "2 weeks"], [28, "4 weeks"], [42, "6 weeks"], [56, "8 weeks"]].map(([d, l]) => (
                  <button key={d} type="button" className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-secondary hover:bg-emerald-50 hover:text-emerald-700"
                    onClick={() => setTarget(plusDays(Number(d)))}>{l}</button>))}
              </div>
            </label>
            <label className="text-xs font-semibold text-secondary">Trainer
              <select className={`${CTRL} mt-1`} value={trainer} onChange={(e) => setTrainer(e.target.value ? Number(e.target.value) : "")}>
                <option value="">{editing ? (plan?.trainer_name || "Not set") : "Me"}</option>
                {(meta?.trainers || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-secondary sm:col-span-2">Plan name (optional)
              <input type="text" className={`${CTRL} mt-1`} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)}
                placeholder={skills.length ? `Training: ${skills.slice(0, 3).map((s) => s.name).join(", ")}` : "Training: …"} />
            </label>
          </div>
        </DialogSection>
        <DialogSection n={3} title="Notes for the trainer and the person" optional tone="emerald">
          <ReasonBox id="planNotes" label="Notes" value={notes} onChange={setNotes} max={2000} rows={2} tone="emerald"
            picks={["Self-study + weekly review with the trainer", "Pair with a deployed engineer on the same stack", "Hands-on project on a sample codebase"]} />
          {!editing && isEmployee && (
            <label className="mt-2 flex items-center gap-2 text-sm text-primary">
              <input type="checkbox" checked={addTasks} onChange={(e) => setAddTasks(e.target.checked)} />
              Put one task per skill on their My Workspace (due on the target date)
            </label>
          )}
        </DialogSection>
        <WhatHappens tone="emerald" items={[
          { icon: CheckCircle2, text: isEmployee ? "They see the training tasks in My Workspace and log progress daily." : "Share the skills with the candidate — tasks are for employees." },
          { icon: Bot, text: "When they are ready, schedule the AI re-interview from the plan — it asks on these skills." },
          { icon: Sparkles, text: `A score of ${meta?.pass_score ?? 70}%+ (communication ${meta?.communication_ok ?? 60}%+) marks them Ready, with matching positions.` },
        ]} />
        <DialogFailure message={err} />
      </div>
      <DialogActions onCancel={onClose} busy={busy} tone="emerald" icon={GraduationCap} disabled={!!missing}
        hint={missing || undefined} label={editing ? "Save plan" : "Start the plan"} onConfirm={save} />
    </Modal>
  );
}

/* =========================================================== AI interview */

function quickTimes(): { label: string; value: string }[] {
  const at = (d: Date, h: number, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
  const fmt = (d: Date) => `${toDateKey(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const now = new Date(); const soon = new Date(now.getTime() + 15 * 60000);
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  return [{ label: "In 15 min", value: fmt(soon) }, { label: "Today 5 PM", value: fmt(at(now, 17)) },
          { label: "Tomorrow 10 AM", value: fmt(at(tomorrow, 10)) }, { label: "Tomorrow 3 PM", value: fmt(at(tomorrow, 15)) }];
}

export function TrainingInterviewDialog({ plan, initialKind = "re_interview", onClose, onDone }: {
  plan: TrainingPlan; initialKind?: "practice" | "re_interview";
  onClose: () => void;
  onDone: (res: { invite_url: string; access_key: string; mailed: boolean; plan: TrainingPlan }, message: string) => void;
}) {
  const meta = useTrainingMeta();
  const planSkills = plan.skills.map((s) => s.name);
  const [kind, setKind] = useState(initialKind);
  const [job, setJob] = useState("");
  const [ask, setAsk] = useState<string[]>(planSkills);
  const [when, setWhen] = useState("");
  const [email, setEmail] = useState(plan.subject.email || "");
  const [mail, setMail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ invite_url: string; access_key: string; mailed: boolean } | null>(null);
  const picks = useMemo(quickTimes, []);
  useEffect(() => {
    if (!job && meta?.templates.length) setJob(suggestTemplate(meta.templates, planSkills) || meta.templates[0].job_id);
  }, [meta]); // eslint-disable-line react-hooks/exhaustive-deps
  const tpl = meta?.templates.find((t) => t.job_id === job);
  const tone: DialogTone = kind === "practice" ? "sky" : "purple";
  const missing = !job ? "Pick the interview template" : !ask.length ? "Tick at least one skill" : !email.trim() ? "Type the email the link goes to" : "";
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await crmPost<{ invite_url: string; access_key: string; mailed: boolean; plan: TrainingPlan }>(
        `/api/training/plans/${plan.id}/interviews`,
        { kind, template_job_id: job, skills: ask, scheduled_at: when || null, email: email.trim(), send_email: mail });
      setDone(r.data); onDone(r.data, r.message || "Scheduled"); setBusy(false);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Modal title="AI interview on the training plan" onClose={onClose} xl
      hero={<DialogHero tone={tone} icon={Bot} eyebrow={plan.title} title={kind === "practice" ? "Practice AI interview" : "AI re-interview"}
        subtitle={kind === "practice" ? "Shows progress — it never decides the plan." : `Decides the plan: ${meta?.pass_score ?? 70}%+ = Ready to place.`}
        person={{ name: plan.subject.name, meta: plan.subject.code || plan.subject.email || undefined }}
        flow={{ steps: ["Train", kind === "practice" ? "Practice" : "Re-interview", "Result on the plan"], current: 1 }} />}>
      {done ? (
        <div className="space-y-3">
          <div className="rounded-card border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
            <b>{kind === "practice" ? "Practice interview" : "Re-interview"} scheduled.</b> {done.mailed ? `The link was emailed to ${email}.` : "Send them the link below."}
            <p className="mt-1 text-xs">The score comes back to this plan by itself when they finish.</p>
          </div>
          <label className="block text-xs font-semibold text-secondary">Interview link
            <div className="mt-1 flex gap-2">
              <input readOnly className={CTRL} value={done.invite_url} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded-control bg-brand-600 px-3 text-sm font-semibold text-white"
                onClick={() => void navigator.clipboard?.writeText(done.invite_url)}><ClipboardCopy size={14} /> Copy</button>
            </div>
          </label>
          {done.access_key && <p className="text-xs text-secondary">Access key: <b className="font-mono text-primary">{done.access_key}</b></p>}
          <div className="flex justify-end"><button type="button" className="rounded-control bg-surface-2 px-4 py-2 text-sm font-semibold text-primary" onClick={onClose}>Close</button></div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Interview kind">
            {([["re_interview", "Re-interview", "Decides the plan"], ["practice", "Practice", "Unscored for the plan"]] as const).map(([k, l, d]) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                className={`rounded-card border p-3 text-left ${kind === k ? "border-purple-500 bg-purple-50 ring-2 ring-purple-500/30 dark:bg-purple-950/30" : "border-subtle bg-surface-1 hover:bg-surface-2"}`}>
                <span className="block text-sm font-bold text-primary">{l}</span><span className="text-xs text-muted">{d}</span>
              </button>))}
          </div>
          <DialogSection n={1} title="Interview template" done={!!job} tone={tone}
            hint="Its timing and question count are used; an AI-written template asks on the skills ticked below.">
            <select className={CTRL} value={job} onChange={(e) => setJob(e.target.value)} aria-label="Interview template">
              {!meta && <option value="">Loading…</option>}
              {meta && !meta.templates.length && <option value="">No active template — create one in Interview Templates</option>}
              {(meta?.templates || []).map((t) => (
                <option key={t.job_id} value={t.job_id}>{t.title}{t.skills.length ? ` — ${t.skills.slice(0, 4).join(", ")}` : ""}</option>))}
            </select>
            {tpl && <p className="mt-1 text-[11px] text-muted">{tpl.question_type === "skill_bank" ? "Questions written by us" : "AI-written questions"}
              {tpl.num_q ? ` · ${tpl.num_q} questions` : ""}{tpl.timing_mode === "time" && tpl.time_limit_sec ? ` · ${Math.round(tpl.time_limit_sec / 60)} min` : ""}</p>}
          </DialogSection>
          <DialogSection n={2} title="Skills to ask on" done={ask.length > 0} tone={tone}>
            <div className="flex flex-wrap gap-1.5">
              {planSkills.map((s) => {
                const on = ask.includes(s);
                return <button key={s} type="button" aria-pressed={on} onClick={() => setAsk(on ? ask.filter((x) => x !== s) : [...ask, s])}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${on ? "bg-purple-600 text-white ring-purple-600" : "bg-surface-1 text-secondary ring-subtle"}`}>
                  {on ? <CheckCircle2 size={12} /> : <X size={12} />}{s}</button>;
              })}
            </div>
          </DialogSection>
          <DialogSection n={3} title="When, and where the link goes" done={!!email.trim()} tone={tone}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-secondary">Time (IST) — blank = now
                <input type="datetime-local" className={`${CTRL} mt-1`} value={when} onChange={(e) => setWhen(e.target.value)} />
                <div className="mt-1.5 flex flex-wrap gap-1">{picks.map((p) => (
                  <button key={p.label} type="button" onClick={() => setWhen(p.value)}
                    className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-secondary hover:bg-purple-50 hover:text-purple-700">{p.label}</button>))}</div>
              </label>
              <label className="text-xs font-semibold text-secondary">Email
                <input type="email" className={`${CTRL} mt-1`} value={email} onChange={(e) => setEmail(e.target.value)} />
                <span className="mt-1 flex items-center gap-2 text-[11px] font-normal text-secondary">
                  <input type="checkbox" checked={mail} onChange={(e) => setMail(e.target.checked)} /> Email them the link now
                </span>
              </label>
            </div>
          </DialogSection>
          <WhatHappens tone={tone} items={[
            { icon: CalendarClock, text: "They get the usual AI interview link (laptop rules, camera, proctoring)." },
            { icon: Star, text: kind === "practice" ? "The score shows on the plan as practice." : "The score decides: Ready to place, or keep training." },
          ]} />
          <DialogFailure message={err} />
          <DialogActions onCancel={onClose} busy={busy} tone={tone} icon={Bot} disabled={!!missing} hint={missing || undefined}
            label={kind === "practice" ? "Schedule practice" : "Schedule re-interview"} busyLabel="Scheduling…" onConfirm={submit} />
        </div>
      )}
    </Modal>
  );
}

/* =========================================================== close */

export function ClosePlanDialog({ plan, onClose, onDone }: { plan: TrainingPlan; onClose: () => void; onDone: (p: TrainingPlan, m: string) => void }) {
  const [outcome, setOutcome] = useState<"passed" | "not_yet" | "closed">("passed");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const need = outcome !== "passed" && note.trim().length < 5;
  const submit = async () => {
    setBusy(true); setErr(null);
    try { const r = await crmPost<TrainingPlan>(`/api/training/plans/${plan.id}/close`, { outcome, note: note.trim() || null }); onDone(r.data, r.message || "Saved"); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const looks: Record<string, string> = { passed: "Passed — ready to place", not_yet: "Not yet — keep training", closed: "Close the plan" };
  return (
    <Modal title="Decide the plan" onClose={onClose} medium
      hero={<DialogHero tone="slate" icon={Target} eyebrow={plan.title} title="Decide the training plan" person={{ name: plan.subject.name }} />}>
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Outcome">
          {(["passed", "not_yet", "closed"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={outcome === k} onClick={() => setOutcome(k)}
              className={`rounded-card border p-3 text-left text-sm font-semibold ${outcome === k ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/30 dark:bg-brand-900/30" : "border-subtle bg-surface-1"}`}>{looks[k]}</button>))}
        </div>
        <ReasonBox id="closeNote" label={outcome === "passed" ? "Note (optional)" : "Why"} value={note} onChange={setNote} required={outcome !== "passed"} min={outcome === "passed" ? 0 : 5}
          picks={outcome === "closed" ? ["Deployed on a project", "Left the company", "Training no longer needed"] : outcome === "not_yet" ? ["Needs more hands-on practice", "Communication still below the bar"] : ["Cleared the trainer's review"]} />
        <DialogFailure message={err} />
        <DialogActions onCancel={onClose} busy={busy} tone="slate" icon={CheckCircle2} disabled={need} hint={need ? "Say why (5 characters or more)" : undefined}
          label="Save" onConfirm={submit} />
      </div>
    </Modal>
  );
}
