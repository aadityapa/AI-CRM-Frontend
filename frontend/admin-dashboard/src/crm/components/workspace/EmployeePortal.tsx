/**
 * The employee's own portal — the sections My Workspace adds (25 Nov 2026).
 *
 * User ask: "a Dashboard for Employee — nothing about billing, just about him;
 * every AI interview report in his login; all opportunities with just the name
 * and JD, rest hidden, and an Apply option; the resume he creates himself; and
 * whatever else is useful". Server: `/api/my-workspace/*` (only ever the caller's
 * own record) — services/employee_portal.py.
 *
 *  - `EmployeeHome`        — the dashboard: today, tasks, resume, roles that fit,
 *                            interviews, applications, current project (no rates).
 *  - `OpenPositions`       — title + JD + skills only, fit to their skills, Apply.
 *  - `MyApplications`      — where each application stands, in plain words.
 *  - `MyInterviewReports`  — every AI interview + its learning report.
 *  - `MyTraining`          — their training plans.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight, Award, BookOpenCheck, Briefcase, CalendarCheck2, CheckCircle2, ChevronDown, ClipboardList,
  FileText, GraduationCap, Lightbulb, ListChecks, Search, Send, Sparkles, Target, TrendingUp, XCircle,
} from "lucide-react";
import { crmGet, crmPost } from "../../api";
import { DecisionDialog, type DecisionSpec } from "../dialogKit";
import { ErrorBox, Modal } from "../ui";
import { ScoreIndicator } from "../ScoreIndicator";
import { BenchCard as Card, chip } from "../bench/BenchParts";
import { fmtDateShort } from "../../../lib/datetime";

type Toast = (m: string, k?: "ok" | "err") => void;

/* ------------------------------------------------------------------ types */

export type FitBand = "good" | "some" | "low" | "unknown";
export type Role = {
  id: number; opportunity_id?: number | null; title: string; jd: string; skills: { name: string; must: boolean }[]; posted: string | null;
  fit: { score: number | null; band: FitBand; matched: string[]; missing: string[] };
  applied: { label: string; state: string; applied_on: string | null } | null;
};
export type AppState = "in_progress" | "on_hold" | "joined" | "withdrawn" | "closed";
export type Application = {
  profile_id: number; opportunity_id: number; title: string; applied_on: string | null;
  state: AppState; label: string; stage: string;
};
export type InterviewRow = {
  kind: "ai_l1" | "training"; id: number; kind_label: string; title: string;
  status: "completed" | "invited" | "not_attempted" | "cancelled"; voided: boolean; when: string | null;
  scheduled_at?: string | null; overall: number | null; technical: number | null; communication: number | null;
  skills?: string[]; has_report: boolean;
};
export type Home = {
  tasks_open: number; tasks_overdue: number; logged_today: boolean; resume_percent: number | null;
  roles_open: number; roles_good_fit: number; applications_live: number; interviews_done: number;
  interviews_upcoming: number; best_score: number | null;
  top_roles: { id: number; title: string; fit: Role["fit"] }[];
};
export type TrainingPlanRow = {
  id: number; title: string; status: string; status_label: string;
  skills: { name: string; current: number | null; target: number | null }[];
  target_date: string | null; days_left: number | null; trainer_name: string | null; notes: string | null;
  baseline: number | null; after: number | null; uplift: number | null; latest_score: number | null;
  tasks_total: number; tasks_done: number; tasks_percent: number | null; open: boolean;
  scheduled: { kind_label: string; scheduled_at: string | null } | null; outcome_note: string | null;
};

/* ------------------------------------------------------------------ pure */

export const FIT_LOOK: Record<FitBand, { label: string; cls: string }> = {
  good: { label: "Good fit", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  some: { label: "Partial fit", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  low: { label: "Stretch", cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  unknown: { label: "No skills listed", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
};

export const APP_LOOK: Record<AppState, string> = {
  in_progress: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  on_hold: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  joined: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  withdrawn: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  closed: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
};

export type RoleFilter = "all" | "good" | "not_applied" | "applied";

/** The roles a search + filter keep (title, JD and skills are searched). PURE. */
export function filterRoles(roles: Role[], q: string, f: RoleFilter): Role[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return roles.filter((r) => {
    if (f === "good" && r.fit.band !== "good") return false;
    if (f === "not_applied" && r.applied) return false;
    if (f === "applied" && !r.applied) return false;
    if (!words.length) return true;
    const hay = `${r.title} ${r.jd} ${r.skills.map((s) => s.name).join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** The interview status in words. PURE. */
export function interviewWords(i: InterviewRow): string {
  if (i.voided) return "Did not count";
  return { completed: "Completed", invited: "Invite sent — check your email", not_attempted: "Not attempted",
           cancelled: "Cancelled" }[i.status] || i.status;
}

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)}%`);

/* ------------------------------------------------------------------ data */

function useLoad<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [meta, setMeta] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const r = await crmGet<T>(url);
      setData(r.data);
      setMeta((r.meta || {}) as Record<string, unknown>);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [url]);
  useEffect(() => { void load(); }, [load]);
  return { data, meta, error, load };
}

/* ------------------------------------------------------------------ home */

function HomeTile({ icon: Icon, label, value, sub, tone, onClick }: {
  icon: LucideIcon; label: string; value: React.ReactNode; sub?: string; tone: string; onClick?: () => void;
}) {
  const body = (
    <>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-[#fff] bg-gradient-to-br ${tone}`}><Icon size={17} /></span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
        <span className="block text-lg font-bold leading-tight text-primary">{value}</span>
        {sub && <span className="block truncate text-[11px] text-muted">{sub}</span>}
      </span>
    </>
  );
  const cls = "flex items-center gap-3 rounded-card border border-subtle bg-surface-1 p-3 text-left shadow-raised";
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} hover:border-strong`}>{body}</button>
    : <div className={cls}>{body}</div>;
}

export function EmployeeHome({ person, go }: {
  person: { status: "Bench" | "Deployed"; current: { project: string; since: string | null; release_date: string | null; role: string | null }[];
            bench_days: number | null; skills: string[]; designation: string | null; experience_years: number | null };
  go: (sec: string) => void;
}) {
  const { data, error, load } = useLoad<Home>("/api/my-workspace/home");
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <div className="p-4 text-sm text-muted">Loading your dashboard…</div>;
  const todo: { text: string; sec: string; icon: LucideIcon }[] = [];
  if (!data.logged_today) todo.push({ text: "Log what you worked on today", sec: "today", icon: CalendarCheck2 });
  if (data.tasks_overdue) todo.push({ text: `${data.tasks_overdue} task${data.tasks_overdue > 1 ? "s are" : " is"} past the due date`, sec: "tasks", icon: ClipboardList });
  if ((data.resume_percent ?? 0) < 70) todo.push({ text: `Finish your resume (${data.resume_percent ?? 0}% done) — it is what you apply with`, sec: "resume", icon: FileText });
  if (data.roles_good_fit) todo.push({ text: `${data.roles_good_fit} open position${data.roles_good_fit > 1 ? "s fit" : " fits"} your skills`, sec: "opportunities", icon: Target });
  if (data.interviews_upcoming) todo.push({ text: `${data.interviews_upcoming} AI interview invite${data.interviews_upcoming > 1 ? "s" : ""} waiting — check your email`, sec: "interviews", icon: Sparkles });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HomeTile icon={CalendarCheck2} label="Today" value={data.logged_today ? "Logged" : "Not logged"}
          sub={data.logged_today ? "Thank you" : "Add today's entry"} tone="from-sky-500 to-blue-600" onClick={() => go("today")} />
        <HomeTile icon={ClipboardList} label="Open tasks" value={data.tasks_open}
          sub={data.tasks_overdue ? `${data.tasks_overdue} overdue` : "Nothing overdue"} tone="from-violet-500 to-purple-600" onClick={() => go("tasks")} />
        <HomeTile icon={FileText} label="My resume" value={`${data.resume_percent ?? 0}%`}
          sub={(data.resume_percent ?? 0) >= 70 ? "Ready to apply" : "Needs a few details"} tone="from-teal-500 to-emerald-600" onClick={() => go("resume")} />
        <HomeTile icon={Briefcase} label="Open positions" value={data.roles_open}
          sub={`${data.roles_good_fit} fit your skills`} tone="from-amber-500 to-orange-600" onClick={() => go("opportunities")} />
        <HomeTile icon={Send} label="My applications" value={data.applications_live}
          sub="in progress" tone="from-indigo-500 to-blue-700" onClick={() => go("applications")} />
        <HomeTile icon={Sparkles} label="AI interviews" value={data.interviews_done}
          sub={data.interviews_upcoming ? `${data.interviews_upcoming} invite waiting` : "completed"} tone="from-fuchsia-500 to-pink-600" onClick={() => go("interviews")} />
        <HomeTile icon={Award} label="Best AI score" value={pct(data.best_score)} sub="across your interviews"
          tone="from-emerald-500 to-green-700" onClick={() => go("interviews")} />
        <HomeTile icon={Briefcase} label={person.status === "Bench" ? "Between projects" : "Current project"}
          value={person.status === "Bench" ? `${person.bench_days ?? 0} days` : (person.current[0]?.project || "—")}
          sub={person.status === "Bench" ? "Apply to an open position" : person.current[0]?.release_date ? `Planned until ${fmtDateShort(person.current[0].release_date)}` : (person.current[0]?.role || "")}
          tone="from-slate-500 to-slate-700" onClick={() => go("history")} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Your next steps" icon={ListChecks}>
          {todo.length === 0
            ? <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={16} /> All done for now — nice work.</p>
            : (
              <ul className="space-y-2">
                {todo.map((t) => (
                  <li key={t.text}>
                    <button type="button" onClick={() => go(t.sec)}
                      className="flex w-full items-center gap-2 rounded-control border border-subtle px-3 py-2 text-left text-sm text-primary hover:bg-surface-2">
                      <t.icon size={15} className="shrink-0 text-brand-600" /><span className="flex-1">{t.text}</span><ArrowRight size={14} className="text-muted" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </Card>
        <Card title="Positions that fit you" icon={Target}
          action={<button type="button" className="text-xs font-semibold text-brand-600 hover:underline" onClick={() => go("opportunities")}>See all</button>}>
          {data.top_roles.length === 0
            ? <p className="text-sm text-muted">No strong match right now. Add your skills to your resume — the match reads them.</p>
            : (
              <ul className="space-y-2">
                {data.top_roles.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 rounded-control border border-subtle px-3 py-2">
                    <ScoreIndicator score={r.fit.score} size="sm" showLabel={false} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-primary">{r.title}</span>
                      <span className="block truncate text-[11px] text-muted">You have {r.fit.matched.join(", ") || "—"}</span>
                    </span>
                    <button type="button" className="text-xs font-semibold text-brand-600 hover:underline" onClick={() => go("opportunities")}>View</button>
                  </li>
                ))}
              </ul>
            )}
        </Card>
      </div>
      {person.skills.length > 0 && (
        <Card title="Your skills on record" icon={GraduationCap}>
          <div className="flex flex-wrap gap-1.5">
            {person.skills.map((s) => <span key={s} className={`${chip} bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-200`}>{s}</span>)}
          </div>
          <p className="mt-2 text-[11px] text-muted">Add more under My resume ▸ Technical skills — open positions are matched against both.</p>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ open positions */

const APPLY_SPEC = (title: string, resumePct: number): DecisionSpec => ({
  tone: "emerald", icon: Send, eyebrow: "Apply to an open position", title,
  intro: <>Your Karnex resume ({resumePct}% complete) is sent with this application. TA checks your details and
    sends you for Technical Screening — you can follow it under <b>My applications</b>.</>,
  flow: { steps: ["You apply", "TA checks", "Technical Screening", "Interviews"], current: 0 },
  reason: { label: "A note for TA (optional)", placeholder: "Why this role suits you, when you can start…",
            picks: ["I have hands-on experience with these skills", "I am available to start right away", "I would like to move into this area"] },
  happens: [
    { icon: FileText, text: "A PDF of your Karnex resume is attached to the application." },
    { icon: Send, text: "The position's TA is told at once." },
    { icon: ListChecks, text: "Where it stands shows under My applications." },
  ],
  confirmLabel: "Apply", busyLabel: "Applying…",
});

export type JdBlock = { kind: "h" | "p" | "li"; text: string };

/** A JD as headings, paragraphs and bullets (the careers page's reading). PURE.
 *  A short line ending in ":" is a heading; "- * • 1." lines are bullets. */
export function jdBlocks(text: string): JdBlock[] {
  const out: JdBlock[] = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^(?:[-*•·▪◦]|\d{1,2}[.)])\s+(.*)$/);
    if (bullet) out.push({ kind: "li", text: bullet[1].trim() });
    else if (line.length <= 60 && /:$/.test(line)) out.push({ kind: "h", text: line.replace(/:$/, "") });
    else out.push({ kind: "p", text: line });
  }
  return out;
}

/** The first plain words of a JD for a card (no headings / bullets markup). PURE. */
export function jdPreview(text: string, max = 220): string {
  const flat = jdBlocks(text).map((b) => b.text).join(" · ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max).replace(/\s+\S*$/, "")}…` : flat;
}

/** The role an old link points at — by position (requirement) or deal id. PURE. */
export function findFocusRole(roles: Role[], focus?: { requirementId?: number; opportunityId?: number }): Role | null {
  if (!focus) return null;
  return roles.find((r) => (focus.requirementId != null && r.id === focus.requirementId)
    || (focus.opportunityId != null && r.opportunity_id === focus.opportunityId)) || null;
}

function JdBody({ text }: { text: string }) {
  const blocks = jdBlocks(text);
  if (!blocks.length) return <p className="text-sm text-muted">The job description is being written — ask TA for details.</p>;
  const out: React.ReactNode[] = [];
  let items: string[] = [];
  const flush = (k: number) => {
    if (!items.length) return;
    out.push(<ul key={`ul${k}`} className="ml-5 list-disc space-y-1 text-sm leading-relaxed text-secondary">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>);
    items = [];
  };
  blocks.forEach((b, i) => {
    if (b.kind === "li") { items.push(b.text); return; }
    flush(i);
    out.push(b.kind === "h"
      ? <h4 key={i} className="pt-2 text-xs font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">{b.text}</h4>
      : <p key={i} className="text-sm leading-relaxed text-secondary">{b.text}</p>);
  });
  flush(blocks.length);
  return <div className="space-y-2">{out}</div>;
}

function SkillChips({ role }: { role: Role }) {
  if (!role.skills.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {role.skills.map((s) => {
        const have = role.fit.matched.includes(s.name);
        return (
          <span key={s.name} title={have ? "You have this skill" : "Not on your record yet"}
            className={`${chip} ${have ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-surface-2 text-secondary"}`}>
            {have ? <CheckCircle2 size={11} /> : null}{s.name}{s.must ? " ★" : ""}
          </span>
        );
      })}
    </div>
  );
}

/** The whole role: the JD read properly, the skills against theirs, Apply. */
function RoleDialog({ role, onClose, onApply }: { role: Role; onClose: () => void; onApply: () => void }) {
  const fit = FIT_LOOK[role.fit.band];
  return (
    <Modal title={role.title} onClose={onClose} xl
      hero={(
        <div className="bg-gradient-to-r from-teal-700 via-emerald-700 to-cyan-800 px-6 py-5 text-[#fff]">
          <div className="text-[11px] font-bold uppercase tracking-wider text-white/80">Open position at Karnex</div>
          <h2 className="mt-1 pr-10 text-xl font-bold">{role.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-white/20 px-2.5 py-0.5 font-semibold">{fit.label}{role.fit.score != null ? ` · ${role.fit.score}%` : ""}</span>
            {role.posted && <span className="text-white/80">Posted {fmtDateShort(role.posted)}</span>}
            {role.applied && <span className="rounded-full bg-[#fff] px-2.5 py-0.5 font-semibold text-[#065f46]">Applied · {role.applied.label}</span>}
          </div>
        </div>
      )}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-primary"><FileText size={15} className="text-brand-600" /> Job description</h3>
          <JdBody text={role.jd} />
        </section>
        <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
          <div className="flex items-center gap-3 rounded-card border border-subtle bg-surface-2 p-3">
            <ScoreIndicator score={role.fit.score} size="md" showLabel={false} />
            <div className="min-w-0">
              <div className="text-sm font-bold text-primary">{fit.label}</div>
              <div className="text-[11px] text-muted">How your skills match this role</div>
            </div>
          </div>
          {role.skills.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">Skills (★ must-have)</h4>
              <SkillChips role={role} />
            </div>
          )}
          {role.fit.missing.length > 0 && (
            <p className="flex gap-1.5 text-xs text-secondary"><Lightbulb size={14} className="shrink-0 text-amber-500" /> To learn: {role.fit.missing.join(", ")}</p>
          )}
          {role.applied
            ? <p className="rounded-control bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:bg-sky-900/20 dark:text-sky-100">You applied{role.applied.applied_on ? ` on ${fmtDateShort(role.applied.applied_on)}` : ""}. Follow it under My applications.</p>
            : (
              <button type="button" onClick={onApply}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-control bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-2.5 text-sm font-bold text-[#fff] shadow-raised hover:brightness-110">
                <Send size={15} /> Apply with my Karnex resume
              </button>
            )}
        </aside>
      </div>
    </Modal>
  );
}

export function OpenPositions({ toast, resumePercent, goResume, focus }: {
  toast: Toast;
  /** Omitted on the Opportunities page — the list's own figure is used. */
  resumePercent?: number;
  goResume: () => void;
  /** An old opportunity / position link opens that role's JD (26 Nov 2026). */
  focus?: { requirementId?: number; opportunityId?: number };
}) {
  const { data, meta, error, load } = useLoad<{ roles: Role[]; your_skills: string[]; counts: { open: number; good_fit: number; applied: number } }>("/api/my-workspace/opportunities");
  const [q, setQ] = useState("");
  const [f, setF] = useState<RoleFilter>("all");
  const [viewing, setViewing] = useState<Role | null>(null);
  const [applying, setApplying] = useState<Role | null>(null);
  const [focusDone, setFocusDone] = useState(false);
  const shown = useMemo(() => filterRoles(data?.roles || [], q, f), [data, q, f]);
  const ready = Number(meta.resume_ready_pct ?? 70);
  const resumePct = resumePercent ?? Number(meta.resume_percent ?? 0);
  const focusRole = useMemo(() => findFocusRole(data?.roles || [], focus), [data, focus]);

  useEffect(() => {
    if (!data || focusDone || !focus) return;
    setFocusDone(true);
    if (focusRole) setViewing(focusRole);
  }, [data, focus, focusRole, focusDone]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <div className="p-4 text-sm text-muted">Loading open positions…</div>;
  const FILTERS: { key: RoleFilter; label: string; n: number }[] = [
    { key: "all", label: "All", n: data.counts.open },
    { key: "good", label: "Good fit", n: data.counts.good_fit },
    { key: "not_applied", label: "Not applied", n: data.counts.open - data.counts.applied },
    { key: "applied", label: "Applied", n: data.counts.applied },
  ];

  return (
    <div className="space-y-3">
      {focus && focusDone && !focusRole && (
        <div className="rounded-card border border-subtle bg-surface-2 px-4 py-3 text-sm text-secondary">
          That position is no longer open. Here is every role open right now.
        </div>
      )}
      {resumePct < ready && (
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
          <FileText size={16} /> You apply with your Karnex resume — it is {resumePct}% complete.
          <button type="button" className="font-semibold underline" onClick={goResume}>Finish it first</button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 rounded-card border border-subtle bg-surface-1 p-3 shadow-raised">
        <label className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search role, skill or JD…" aria-label="Search positions"
            className="w-full rounded-control border border-subtle bg-surface-1 py-1.5 pl-8 pr-2 text-sm text-primary" />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
          {FILTERS.map((x) => (
            <button key={x.key} type="button" aria-pressed={f === x.key} onClick={() => setF(x.key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${f === x.key ? "bg-brand-600 text-white ring-brand-600" : "text-secondary ring-subtle hover:bg-surface-2"}`}>
              {x.label} <span className="opacity-70">{x.n}</span>
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 && <p className="rounded-card border border-dashed border-subtle p-6 text-center text-sm text-muted">No open position matches.</p>}
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {shown.map((r) => {
          const preview = jdPreview(r.jd);
          return (
            <article key={r.id}
              className={`flex flex-col rounded-card border bg-surface-1 p-4 shadow-raised transition-colors hover:border-strong ${focusRole?.id === r.id ? "border-emerald-400 ring-2 ring-emerald-300/60" : "border-subtle"}`}>
              <header className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-gradient-to-br from-teal-500 to-emerald-600 text-[#fff]"><Briefcase size={18} /></span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-bold leading-snug text-primary">{r.title}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className={`${chip} ${FIT_LOOK[r.fit.band].cls}`}>{FIT_LOOK[r.fit.band].label}{r.fit.score != null ? ` · ${r.fit.score}%` : ""}</span>
                    {r.posted && <span className="text-[11px] text-muted">Posted {fmtDateShort(r.posted)}</span>}
                  </div>
                </div>
              </header>
              <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-secondary">{preview || "The job description is being written — ask TA for details."}</p>
              {r.skills.length > 0 && <div className="mt-3"><SkillChips role={r} /></div>}
              <div className="flex-1" />
              <footer className="mt-3 flex items-center justify-between gap-2 border-t border-subtle pt-3">
                <button type="button" onClick={() => setViewing(r)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
                  <FileText size={13} /> Read the job description
                </button>
                {r.applied
                  ? <span className={`${chip} bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200`}><CheckCircle2 size={12} /> Applied · {r.applied.label}</span>
                  : (
                    <button type="button" onClick={() => setApplying(r)}
                      className="inline-flex items-center gap-1.5 rounded-control bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-1.5 text-xs font-bold text-[#fff] shadow-raised hover:brightness-110">
                      <Send size={13} /> Apply
                    </button>
                  )}
              </footer>
            </article>
          );
        })}
      </div>
      <p className="text-[11px] text-muted">Only the role and its job description are shown. Matching reads your skills: {data.your_skills.join(", ") || "none yet — add them to your resume"}.</p>
      {viewing && !applying && (
        <RoleDialog role={viewing} onClose={() => setViewing(null)} onApply={() => setApplying(viewing)} />
      )}
      {applying && (
        <DecisionDialog spec={APPLY_SPEC(applying.title, resumePct)}
          notice={resumePct < ready ? (
            <div className="rounded-control border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
              Your resume is only {resumePct}% complete — TA sees exactly what is on it. You can still apply.
            </div>
          ) : undefined}
          onClose={() => setApplying(null)}
          onConfirm={async (note) => {
            const r = await crmPost(`/api/my-workspace/opportunities/${applying.id}/apply`, { note: note || null });
            toast(r.message || "Applied");
            setApplying(null);
            setViewing(null);
            await load();
          }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ applications */

export function MyApplications({ go }: { go: (sec: string) => void }) {
  const { data, error, load } = useLoad<Application[]>("/api/my-workspace/applications");
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <div className="p-4 text-sm text-muted">Loading…</div>;
  if (!data.length) {
    return (
      <Card title="My applications" icon={Send}>
        <p className="text-sm text-muted">You have not applied to a position yet.</p>
        <button type="button" className="mt-2 text-sm font-semibold text-brand-600 hover:underline" onClick={() => go("opportunities")}>See open positions →</button>
      </Card>
    );
  }
  return (
    <Card title="My applications" icon={Send}>
      <ul className="divide-y divide-subtle">
        {data.map((a) => (
          <li key={a.profile_id} className="flex flex-wrap items-center gap-3 py-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-control bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200"><Briefcase size={15} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-primary">{a.title}</span>
              <span className="block text-[11px] text-muted">{a.applied_on ? `Applied ${fmtDateShort(a.applied_on)}` : ""}</span>
            </span>
            <span className={`${chip} ${APP_LOOK[a.state]}`}>{a.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted">Only the step your application is at is shown. TA keeps you posted on the next interview.</p>
    </Card>
  );
}

/* ------------------------------------------------------------------ AI interviews */

type Report = {
  available: boolean; message?: string; kind_label: string; voided: boolean; when: string | null; plan?: string;
  terminated?: boolean; not_attempted?: boolean;
  overall_score_percent?: number | null; technical_score_percent?: number | null;
  communication_score_percent?: number | null; problem_solving_score_percent?: number | null;
  summary?: string; strengths?: string[]; improvements?: string[];
  skills?: { name?: string; skill?: string; score?: number | null; score_percent?: number | null }[];
  questions?: { total: number; answered: number; skipped: number };
  job_title?: string;
  question_list?: { number: number; question: string; answer: string; answered: boolean; score_percent: number | null;
                    band: string; skill: string | null; got_right: string[]; missed: string[]; expected: string }[];
  skill_check?: { skill: string; avg_score_percent: number | null; status: string; label: string; questions: number }[];
};

const BAND_LOOK: Record<string, string> = {
  strong: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  weak: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  skipped: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  unscored: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};
const BAND_WORD: Record<string, string> = { strong: "Strong", partial: "Partly right", weak: "Needs work", skipped: "Skipped", unscored: "Not scored" };

export function MyInterviewReports() {
  const { data, error, load } = useLoad<InterviewRow[]>("/api/my-workspace/interviews");
  const [open, setOpen] = useState<InterviewRow | null>(null);
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <div className="p-4 text-sm text-muted">Loading your interviews…</div>;
  if (!data.length) {
    return <Card title="My AI interviews" icon={Sparkles}><p className="text-sm text-muted">No AI interview yet. When you take one, its report appears here.</p></Card>;
  }
  return (
    <Card title="My AI interviews" icon={Sparkles}>
      <div className="grid gap-3 md:grid-cols-2">
        {data.map((i) => (
          <article key={`${i.kind}-${i.id}`} className={`rounded-card border border-subtle p-3 ${i.voided ? "opacity-60" : ""}`}>
            <div className="flex items-start gap-3">
              <ScoreIndicator score={i.status === "completed" ? i.overall : null} size="md" showLabel={false} />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold uppercase tracking-wide text-muted">{i.kind_label}</div>
                <h4 className="truncate text-sm font-bold text-primary">{i.title}</h4>
                <div className="mt-0.5 text-[11px] text-muted">{interviewWords(i)}{i.when ? ` · ${fmtDateShort(i.when)}` : ""}</div>
              </div>
            </div>
            {i.status === "completed" && (
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                {([["Overall", i.overall], ["Technical", i.technical], ["Communication", i.communication]] as const).map(([l, v]) => (
                  <div key={l} className="rounded-control bg-surface-2 px-2 py-1.5">
                    <div className="text-[10px] font-semibold uppercase text-muted">{l}</div>
                    <div className="text-sm font-bold text-primary">{pct(v)}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 flex justify-end">
              <button type="button" disabled={!i.has_report} onClick={() => setOpen(i)}
                className="inline-flex items-center gap-1 rounded-control bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-40">
                <BookOpenCheck size={13} /> {i.has_report ? "Open my report" : "Report not ready"}
              </button>
            </div>
          </article>
        ))}
      </div>
      {open && <InterviewReportModal row={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function InterviewReportModal({ row, onClose }: { row: InterviewRow; onClose: () => void }) {
  const { data, error, load } = useLoad<Report>(`/api/my-workspace/interviews/${row.kind}/${row.id}`);
  const [openQ, setOpenQ] = useState<number | null>(null);
  return (
    <Modal title={`${row.kind_label} — ${row.title}`} xl onClose={onClose}>
      {error && <ErrorBox error={error} onRetry={load} />}
      {!data && !error && <p className="text-sm text-muted">Loading the report…</p>}
      {data && !data.available && <p className="text-sm text-muted">{data.message || "The report is not ready yet."}</p>}
      {data && data.available && (
        <div className="space-y-4">
          {data.voided && <p className="rounded-control bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">This interview did not count — a fresh one was arranged.</p>}
          <div className="flex flex-wrap items-center gap-4">
            <ScoreIndicator score={data.overall_score_percent} size="lg" />
            <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3">
              {([["Technical", data.technical_score_percent], ["Communication", data.communication_score_percent],
                 ["Problem solving", data.problem_solving_score_percent]] as const).map(([l, v]) => (
                <div key={l} className="rounded-control border border-subtle px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase text-muted">{l}</div>
                  <div className="text-lg font-bold text-primary">{pct(v)}</div>
                </div>
              ))}
            </div>
          </div>
          {data.questions && <p className="text-xs text-muted">{data.questions.answered} of {data.questions.total} questions answered{data.questions.skipped ? ` · ${data.questions.skipped} skipped` : ""}{data.when ? ` · ${fmtDateShort(data.when)}` : ""}</p>}
          {data.summary && <p className="rounded-card bg-surface-2 p-3 text-sm leading-relaxed text-secondary">{data.summary}</p>}
          <div className="grid gap-3 md:grid-cols-2">
            <section className="rounded-card border border-emerald-200 p-3 dark:border-emerald-900">
              <h4 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-emerald-700 dark:text-emerald-300"><TrendingUp size={15} /> What went well</h4>
              <ul className="list-disc space-y-1 pl-5 text-sm text-secondary">{(data.strengths || []).map((s) => <li key={s}>{s}</li>)}{!data.strengths?.length && <li className="list-none text-muted">—</li>}</ul>
            </section>
            <section className="rounded-card border border-amber-200 p-3 dark:border-amber-900">
              <h4 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-amber-700 dark:text-amber-300"><Lightbulb size={15} /> What to work on</h4>
              <ul className="list-disc space-y-1 pl-5 text-sm text-secondary">{(data.improvements || []).map((s) => <li key={s}>{s}</li>)}{!data.improvements?.length && <li className="list-none text-muted">—</li>}</ul>
            </section>
          </div>
          {(data.skill_check || []).length > 0 && (
            <section>
              <h4 className="mb-2 text-sm font-bold text-primary">Skill by skill</h4>
              <div className="grid gap-2 sm:grid-cols-2">
                {data.skill_check!.map((s) => (
                  <div key={s.skill} className="flex items-center gap-2 rounded-control border border-subtle px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-primary">{s.skill}</span>
                    <span className="text-xs text-muted">{s.avg_score_percent != null ? pct(s.avg_score_percent) : ""}</span>
                    <span className={`${chip} ${s.status === "shown" ? BAND_LOOK.strong : s.status === "weak" ? BAND_LOOK.weak : s.status === "not_tested" ? BAND_LOOK.skipped : BAND_LOOK.partial}`}>{s.label}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          {(data.question_list || []).length > 0 && (
            <section>
              <h4 className="mb-2 text-sm font-bold text-primary">Question by question</h4>
              <ul className="space-y-2">
                {data.question_list!.map((q) => (
                  <li key={q.number} className="rounded-card border border-subtle">
                    <button type="button" className="flex w-full items-start gap-2 px-3 py-2 text-left" aria-expanded={openQ === q.number}
                      onClick={() => setOpenQ(openQ === q.number ? null : q.number)}>
                      <span className="mt-0.5 text-xs font-bold text-muted">Q{q.number}</span>
                      <span className="flex-1 text-sm text-primary">{q.question}</span>
                      <span className={`${chip} ${BAND_LOOK[q.band] || BAND_LOOK.unscored}`}>{BAND_WORD[q.band] || q.band}{q.score_percent != null ? ` · ${pct(q.score_percent)}` : ""}</span>
                      <ChevronDown size={14} className={`mt-1 shrink-0 text-muted ${openQ === q.number ? "rotate-180" : ""}`} />
                    </button>
                    {openQ === q.number && (
                      <div className="space-y-2 border-t border-subtle px-3 py-2 text-sm">
                        <div><span className="text-[11px] font-bold uppercase text-muted">Your answer</span>
                          <p className="whitespace-pre-line text-secondary">{q.answered ? q.answer : "Skipped"}</p></div>
                        {q.got_right.length > 0 && <div className="flex gap-1.5 text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={14} className="mt-0.5 shrink-0" /><span>{q.got_right.join(" · ")}</span></div>}
                        {q.missed.length > 0 && <div className="flex gap-1.5 text-amber-700 dark:text-amber-300"><XCircle size={14} className="mt-0.5 shrink-0" /><span>{q.missed.join(" · ")}</span></div>}
                        {q.expected && <div><span className="text-[11px] font-bold uppercase text-muted">A good answer covers</span><p className="text-secondary">{q.expected}</p></div>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-[11px] text-muted">These scores come from an AI reviewer reading a transcript of what you said. Use them to see what to practise next.</p>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ training */

export function MyTraining() {
  const { data, error, load } = useLoad<TrainingPlanRow[]>("/api/my-workspace/training");
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <div className="p-4 text-sm text-muted">Loading…</div>;
  if (!data.length) return <Card title="My training" icon={GraduationCap}><p className="text-sm text-muted">No training plan yet. RMG sets one up when you are learning a new skill.</p></Card>;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {data.map((p) => (
        <Card key={p.id} title={p.title} icon={GraduationCap}
          action={<span className={`${chip} ${p.open ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"}`}>{p.status_label}</span>}>
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {p.target_date && <span>Target {fmtDateShort(p.target_date)}{p.days_left != null && p.open ? ` · ${p.days_left} days left` : ""}</span>}
              {p.trainer_name && <span>Trainer: {p.trainer_name}</span>}
            </div>
            <ul className="space-y-1.5">
              {p.skills.map((s) => (
                <li key={s.name} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-semibold text-primary">{s.name}</span>
                  <span className="text-xs text-muted">level {s.current ?? "?"} → {s.target ?? "?"}</span>
                </li>
              ))}
            </ul>
            <div>
              <div className="mb-1 flex justify-between text-xs text-muted"><span>Training tasks</span><span>{p.tasks_done} of {p.tasks_total}</span></div>
              <div className="h-2 rounded-full bg-surface-2"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${p.tasks_percent ?? 0}%` }} /></div>
            </div>
            {(p.baseline != null || p.after != null) && <p className="text-xs text-secondary">AI score before {pct(p.baseline)} → after {pct(p.after)}</p>}
            {p.scheduled && <p className="rounded-control bg-fuchsia-50 px-3 py-2 text-xs text-fuchsia-900 dark:bg-fuchsia-900/20 dark:text-fuchsia-100">{p.scheduled.kind_label} scheduled{p.scheduled.scheduled_at ? ` for ${p.scheduled.scheduled_at.replace("T", " ")}` : ""} — the link is in your email.</p>}
            {p.notes && <p className="text-xs text-muted">{p.notes}</p>}
          </div>
        </Card>
      ))}
    </div>
  );
}
