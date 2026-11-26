/**
 * Bench & Deployed — RMG / GM / CEO (23 Nov 2026).
 *
 * User ask: "one tab in RMG & GM login with two tabs, Bench & Deployed; click
 * Bench and see every bench person with all their history — same for Deployed:
 * resume, skill set, the daily tasks RMG gives; every employee logs in and adds
 * their daily activity and prepares their resume on our tool in one format;
 * RMG, GM and CEO see all details."
 *
 * `bench` (list, `?tab=bench|deployed`) and `bench/:id` (one person, sections
 * Overview · History · Tasks · Daily activity · Resume). Data:
 * `GET /api/bench`, `GET /api/bench/{id}`; tasks and the resume through the
 * same router. Who is on the bench is the server's rule (no live assignment
 * today) — the same as Employees and the CEO People tab.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Armchair, Bot, Briefcase, CalendarClock, ClipboardList, Coffee, FileText, FolderInput, GraduationCap,
  History, KeyRound, Layers, ListTodo, Mail, MapPin, NotebookPen, Phone, Plus, RefreshCw, RotateCcw, Search, Sparkles,
  Share2, UserMinus, UserRound, UsersRound,
} from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut, qs } from "../api";
import { CrmLink, crmNavigate, useCrmParams } from "../router";
import { useHasRole } from "../CrmApp";
import { useCanApprove, useCanAct, useSubTabs } from "../useAccess";
import { HERO_BTN, HERO_BTN_SOLID, PageHeader, StagePills } from "../components/PageHeader";
import { ConfirmModal, ErrorBox, btnPrimary, btnSecondary, useToast } from "../components/ui";
import { toDateKey } from "../lib/calendarDates";
import { FileLink } from "../components/FileUpload";
import { ResumeEditor } from "../components/resume/ResumeEditor";
import {
  ActivityList, BenchCard as Card, HistoryTimeline, TaskCard, TaskDialog, TaskManageButtons, benchTone, chip, daysText, missingDays,
  type BenchRow, type Person, type Task, type TaskDraft,
} from "../components/bench/BenchParts";
import {
  GroupChip, ManageGroupsDialog, MoveToGroupDialog, SuggestionsDialog, lookOf, suggestWords,
  type BenchGroup, type MovePerson, type Suggestion,
} from "../components/bench/BenchGroups";
import { usePageTab, useSessionState } from "../lib/pageState";
import { BenchInsightsView, ShareResumeDialog } from "../components/bench/BenchInsights";
import { PlanDialog, TrainingChip, TrainingInterviewDialog, type TrainingPlan, type TrainingRef } from "../components/training/TrainingParts";
import { TrainingPlansView } from "./Training";
import { fmtDateShort, fmtDateTime12 } from "../../lib/datetime";

type View = "bench" | "deployed" | "groups" | "insights" | "training";
const LIST_VIEWS: View[] = ["bench", "deployed", "groups"];
type Counts = {
  bench: number; deployed: number; bench_not_logged_today: number; resume_incomplete: number;
  tasks_overdue: number; no_login: number; bench_over_30: number;
  grouped?: number; out_of_pool?: number; suggested?: number;
};
const CONTROL = "input-recessed min-h-[38px] rounded-control px-3 py-2 text-sm text-primary";
const BUCKET_WORDS: Record<string, string> = { "0_15": "0–15 days", "16_30": "16–30 days", "31_60": "31–60 days", "60_plus": "60+ days" };
const FLAG_WORDS: Record<string, string> = {
  not_logged_today: "Not logged today", resume_incomplete: "Resume incomplete", tasks_overdue: "Tasks overdue",
  no_login: "No login yet", releasing_30: "Releasing in 30 days",
};

/** RMG by role, a grant on `bench`, or a screener (GM) — the server's `screener_or`. */
export function useBenchWriter(): boolean {
  const rmg = useHasRole("RMG");
  const screener = useCanApprove("profile.rmg_screening");
  const grant = useCanAct("bench", "edit", rmg);
  return rmg || screener || grant;
}

function initials(n: string) {
  return n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("");
}

function ResumeBar({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-[11px] font-semibold text-rose-600">Not started</span>;
  const tone = pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-rose-500";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-secondary">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2"><span className={`block h-full ${tone}`} style={{ width: `${pct}%` }} /></span>
      {pct}%
    </span>
  );
}

/* ================================================================== list */

export function BenchDeskPage() {
  // Each view is a sub-tab a role can switch off in Access Control (25 Nov 2026).
  const benchSub = useSubTabs("bench");
  const allowedViews = (["bench", "deployed", "groups", "insights", "training"] as View[]).filter((k) => benchSub.allowed(k));
  const [view, setView] = usePageTab<View>("tab", allowedViews[0] || "bench", allowedViews.length ? allowedViews : ["bench"]);
  const isList = LIST_VIEWS.includes(view);
  const [search, setSearch] = useSessionState("bench.search", "");
  const [skill, setSkill] = useSessionState("bench.skill", "");
  const [bucket, setBucket] = useSessionState("bench.bucket", "");
  const [flag, setFlag] = useSessionState("bench.flag", "");
  const [groupId, setGroupId] = useSessionState<number | null>("bench.group", null);
  const [rows, setRows] = useState<BenchRow[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [groups, setGroups] = useState<BenchGroup[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState("");
  const [q, setQ] = useState(search);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [moving, setMoving] = useState<MovePerson[] | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [managing, setManaging] = useState(false);
  const [toastEl, toast] = useToast();
  const canEdit = useBenchWriter();

  useEffect(() => { const t = setTimeout(() => setSearch(q), 300); return () => clearTimeout(t); }, [q, setSearch]);

  const load = useCallback(async () => {
    setError("");
    if (!LIST_VIEWS.includes(view)) return;
    try {
      const r = await crmGet<BenchRow[]>(`/api/bench${qs({ view, search, skill, bucket: view === "bench" ? bucket : "", flag,
        group_id: view === "groups" && groupId ? groupId : undefined })}`);
      const meta = (r.meta || {}) as unknown as { counts: Counts; skills: string[]; groups?: BenchGroup[]; suggestions?: Suggestion[] };
      setRows(r.data); setCounts(meta.counts); setSkills(meta.skills || []);
      setGroups(meta.groups || []); setSuggestions(meta.suggestions || []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [view, search, skill, bucket, flag, groupId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPicked(new Set()); }, [view, groupId]);

  const done = (msg: string) => { setMoving(null); setReviewing(false); setPicked(new Set()); toast(msg); void load(); };
  const flags = view === "deployed" ? ["releasing_30", "resume_incomplete", "tasks_overdue", "no_login"]
    : ["not_logged_today", "resume_incomplete", "tasks_overdue", "no_login"];
  const filtersOn = [skill, view === "bench" ? bucket : "", flag, search].filter(Boolean).length;
  const chosen = (rows || []).filter((r) => picked.has(r.id));
  const toggle = (id: number, on: boolean) => setPicked((prev) => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
  const shownGroups = groups.filter((g) => g.members > 0 || g.id === groupId);

  return (
    <div className="space-y-4">
      {toastEl}
      <PageHeader icon={UsersRound} accent="teal" eyebrow="RMG · GM · CEO" title="Bench & Deployed"
        subtitle="Every person, where they are today and everything they did before — tasks, daily activity and the company resume."
        stats={counts ? [
          { label: "On the bench", value: counts.bench },
          { label: "Deployed", value: counts.deployed },
          { label: "Bench 30+ days", value: counts.bench_over_30 },
          { label: "Bench — no log today", value: counts.bench_not_logged_today },
          { label: "In other groups", value: counts.grouped ?? 0 },
        ] : undefined}
        actions={<>
          {canEdit && <button type="button" className={HERO_BTN} onClick={() => setManaging(true)}><Layers size={14} /> Groups</button>}
          <button type="button" className={HERO_BTN} onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
        </>}>
        <div className="space-y-3">
          <StagePills label="Bench, deployed or groups" active={view} onChange={(k) => setView(k as View)}
            tabs={[{ key: "bench", label: `Bench${counts ? ` · ${counts.bench}` : ""}` },
                   { key: "deployed", label: `Deployed${counts ? ` · ${counts.deployed}` : ""}` },
                   { key: "groups", label: `Groups${counts?.grouped != null ? ` · ${counts.grouped}` : ""}` },
                   { key: "insights", label: "Insights · cost, roll-offs, skill gap" },
                   { key: "training", label: "Training" }].filter((t) => allowedViews.includes(t.key as View))} />
          {view === "groups" && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Group">
              <button type="button" aria-pressed={!groupId} onClick={() => setGroupId(null)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${!groupId ? "bg-brand-600 text-white ring-brand-600" : "bg-surface-1 text-secondary ring-subtle hover:bg-surface-2"}`}>
                All groups
              </button>
              {shownGroups.map((g) => (
                <button key={g.id} type="button" aria-pressed={groupId === g.id} onClick={() => setGroupId(g.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${
                    groupId === g.id ? "bg-brand-600 text-white ring-brand-600" : `${lookOf(g.color).chip}`}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${groupId === g.id ? "bg-white" : lookOf(g.color).dot}`} />{g.name} · {g.members}
                </button>
              ))}
            </div>
          )}
          {isList && <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[220px] flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input type="text" className={`${CONTROL} w-full pl-8`} value={q} onChange={(e) => setQ(e.target.value)}
                     placeholder="Name, Emp ID, skill, designation, project, customer" aria-label="Search people" />
            </label>
            <select className={CONTROL} value={skill} onChange={(e) => setSkill(e.target.value)} aria-label="Skill">
              <option value="">All skills</option>
              {skills.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {view === "bench" && (
              <select className={CONTROL} value={bucket} onChange={(e) => setBucket(e.target.value)} aria-label="Days on the bench">
                <option value="">Any time on bench</option>
                {Object.entries(BUCKET_WORDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            )}
            <select className={CONTROL} value={flags.includes(flag) ? flag : ""} onChange={(e) => setFlag(e.target.value)} aria-label="Needs attention">
              <option value="">Everyone</option>
              {flags.map((f) => <option key={f} value={f}>{FLAG_WORDS[f]}</option>)}
            </select>
            {filtersOn > 0 && (
              <button type="button" className="text-xs font-semibold text-brand-600 hover:underline"
                      onClick={() => { setQ(""); setSearch(""); setSkill(""); setBucket(""); setFlag(""); }}>Clear filters</button>
            )}
          </div>}
        </div>
      </PageHeader>

      {view === "insights" && <BenchInsightsView />}
      {view === "training" && <TrainingPlansView />}
      {view === "bench" && canEdit && suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-purple-200 bg-purple-50 p-3 dark:border-purple-800 dark:bg-purple-950/30">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 text-white"><Sparkles size={16} /></span>
          <div className="min-w-0 flex-1 text-sm text-purple-900 dark:text-purple-100">
            <b>{suggestions.length} {suggestions.length === 1 ? "person" : "people"} on the bench look like management or internal staff</b>
            <span className="block text-xs text-purple-800/80 dark:text-purple-200/80">
              {suggestions.slice(0, 4).map((x) => `${x.name} (${x.designation || x.department || suggestWords(x.suggested_group)})`).join(", ")}
              {suggestions.length > 4 ? ` and ${suggestions.length - 4} more` : ""}. Move them out so the bench shows only billable people.
            </span>
          </div>
          <button type="button" className={btnPrimary} onClick={() => setReviewing(true)}><FolderInput size={14} /> Review & move</button>
        </div>
      )}

      {isList && error && <ErrorBox error={error} onRetry={load} />}
      {isList && !rows && !error && <div className="p-6 text-sm text-muted">Loading…</div>}
      {isList && rows && rows.length === 0 && (
        <div className="rounded-card border border-dashed border-subtle p-10 text-center text-sm text-muted">
          {filtersOn ? "Nobody matches these filters."
            : view === "bench" ? "Nobody is on the bench today."
              : view === "deployed" ? "Nobody is deployed today."
                : "Nobody is in a group yet. Use “Move to group” on a person's card to file management or internal staff here."}
        </div>
      )}
      {isList && rows && rows.length > 0 && (
        <>
          {canEdit && (
            <div className="flex items-center justify-between text-xs text-secondary">
              <span>{rows.length} {rows.length === 1 ? "person" : "people"}{view === "groups" ? " · sorted by group" : ""}</span>
              <button type="button" className="font-semibold text-brand-600 hover:underline"
                onClick={() => setPicked(picked.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))}>
                {picked.size === rows.length ? "Clear selection" : "Select all shown"}
              </button>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {rows.map((r) => (
              <PersonCard key={r.id} r={r} canEdit={canEdit} selected={picked.has(r.id)} onSelect={(on) => toggle(r.id, on)}
                onMove={() => setMoving([{ id: r.id, name: r.name, group: r.group }])} />
            ))}
          </div>
        </>
      )}

      {canEdit && chosen.length > 0 && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-2 rounded-card border border-brand-300 bg-surface-1 px-4 py-2.5 shadow-overlay">
          <span className="text-sm font-semibold text-primary">{chosen.length} selected</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={() => setPicked(new Set())}>Clear</button>
            {chosen.some((c) => c.group) && (
              <button type="button" className={btnSecondary}
                onClick={() => setMoving(chosen.map((c) => ({ id: c.id, name: c.name, group: c.group })))}><RotateCcw size={14} /> Put back / move</button>
            )}
            <button type="button" className={btnPrimary} onClick={() => setMoving(chosen.map((c) => ({ id: c.id, name: c.name, group: c.group })))}>
              <FolderInput size={14} /> Move {chosen.length} to a group
            </button>
          </div>
        </div>
      )}

      {moving && <MoveToGroupDialog people={moving} onClose={() => setMoving(null)} onDone={done} />}
      {reviewing && <SuggestionsDialog suggestions={suggestions} onClose={() => setReviewing(false)} onDone={done} />}
      {managing && <ManageGroupsDialog onClose={() => { setManaging(false); void load(); }} onChanged={(m) => toast(m)} />}
    </div>
  );
}

function PersonCard({ r, canEdit, selected, onSelect, onMove }: {
  r: BenchRow; canEdit: boolean; selected: boolean; onSelect: (on: boolean) => void; onMove: () => void;
}) {
  const bench = r.status === "Bench";
  return (
    <article className={`flex flex-col rounded-card border bg-surface-1 shadow-raised transition hover:-translate-y-0.5 hover:shadow-overlay ${
      selected ? "border-brand-500 ring-2 ring-brand-500/30" : "border-subtle"}`}>
      <CrmLink to={`bench/${r.id}`} className="group block flex-1 p-4">
        <div className="flex items-start gap-3">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${
            r.group && !r.group.counts_as_bench ? `bg-gradient-to-br ${lookOf(r.group.color).grad}`
              : bench ? "bg-gradient-to-br from-amber-500 to-orange-600" : "bg-gradient-to-br from-emerald-500 to-teal-600"}`}>{initials(r.name)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-bold text-primary group-hover:text-brand-700">{r.name}</span>
              {r.employee_code && <span className="text-[11px] text-muted">{r.employee_code}</span>}
            </div>
            <p className="truncate text-xs text-secondary">
              {[r.designation, r.department, r.experience_years != null ? `${r.experience_years} yrs` : null, r.work_location].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          {bench ? (
            <span className={`${chip} ${benchTone(r.bench_days)}`} title={r.bench_since ? `Since ${fmtDateShort(r.bench_since)}` : undefined}>
              <Coffee size={11} /> {daysText(r.bench_days)}
            </span>
          ) : (
            <span className={`${chip} bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200`}><Briefcase size={11} /> Deployed</span>
          )}
        </div>

        {r.group && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            <GroupChip group={r.group} small />
            {r.group.note && <span className="truncate">“{r.group.note}”</span>}
            {r.group.set_by_name && <span>· by {r.group.set_by_name}</span>}
          </div>
        )}

        <div className="mt-3 text-xs text-secondary">
          {bench ? (
            r.last_project
              ? <>Last: <b className="text-primary">{r.last_project.project}</b>{r.last_project.customer ? ` · ${r.last_project.customer}` : ""} · ended {fmtDateShort(r.last_project.ended)}</>
              : <span className="text-muted">Never placed on a project yet</span>
          ) : r.current.map((c) => (
            <div key={c.project_id} className="flex flex-wrap gap-x-2">
              <b className="text-primary">{c.project}</b>{c.customer && <span>· {c.customer}</span>}
              <span className="text-muted">since {fmtDateShort(c.since)}</span>
              {c.release_date && <span className="font-semibold text-amber-700 dark:text-amber-300">release {fmtDateShort(c.release_date)}</span>}
            </div>
          ))}
        </div>

        {r.skills.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {r.skills.slice(0, 6).map((s) => <span key={s} className={`${chip} bg-surface-2 text-secondary`}>{s}</span>)}
            {r.skills.length > 6 && <span className="text-[11px] text-muted">+{r.skills.length - 6}</span>}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-subtle pt-2.5 text-[11px]">
          <span className="inline-flex items-center gap-1 text-secondary"><FileText size={11} /> Resume <ResumeBar pct={r.resume_percent} /></span>
          <span className={r.tasks_overdue ? "font-bold text-rose-600" : "text-secondary"}>
            <ListTodo size={11} className="mr-0.5 inline" />{r.tasks_open} open{r.tasks_overdue ? ` · ${r.tasks_overdue} overdue` : ""}
          </span>
          <span className={r.logged_today ? "text-emerald-700 dark:text-emerald-300" : bench ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted"}>
            <NotebookPen size={11} className="mr-0.5 inline" />
            {r.logged_today ? "Logged today" : r.last_activity ? `Last log ${fmtDateShort(r.last_activity)}` : "No daily log yet"}
          </span>
          {!r.has_login && <span className="text-muted" title="Create a login in Access Control ▸ Users with the Employee role"><KeyRound size={11} className="mr-0.5 inline" />No login</span>}
        </div>
      </CrmLink>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 border-t border-subtle bg-surface-2/50 px-4 py-2 text-xs">
          <label className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-secondary">
            <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select ${r.name}`} /> Select
          </label>
          {r.suggested_group && !r.group && (
            <span className="inline-flex items-center gap-1 font-semibold text-purple-700 dark:text-purple-300" title="Read from the designation / department">
              <Sparkles size={11} /> Looks like {suggestWords(r.suggested_group)}
            </span>
          )}
          <button type="button" onClick={onMove}
            className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200 hover:bg-indigo-50 dark:text-indigo-200 dark:ring-indigo-800 dark:hover:bg-indigo-950/40">
            {r.group ? <><Layers size={12} /> Change group</> : <><UserMinus size={12} /> Move to group</>}
          </button>
        </div>
      )}
    </article>
  );
}

/* ================================================================== one person */

type Sec = "overview" | "history" | "tasks" | "activity" | "resume";
const SECTIONS: { key: Sec; label: string; icon: typeof UserRound }[] = [
  { key: "overview", label: "Overview", icon: UserRound },
  { key: "history", label: "History", icon: History },
  { key: "tasks", label: "Tasks", icon: ClipboardList },
  { key: "activity", label: "Daily activity", icon: NotebookPen },
  { key: "resume", label: "Resume", icon: FileText },
];

export function BenchPersonPage() {
  const { id } = useCrmParams();
  const [sec, setSec] = usePageTab<Sec>("sec", "overview", SECTIONS.map((s) => s.key));
  const [p, setP] = useState<Person | null>(null);
  const [error, setError] = useState("");
  const [toastEl, toast] = useToast();
  const canEdit = useBenchWriter();
  const [taskEdit, setTaskEdit] = useState<Task | null | undefined>(undefined);
  const [taskDelete, setTaskDelete] = useState<Task | null>(null);
  const [moving, setMoving] = useState(false);
  const [planDlg, setPlanDlg] = useState<null | "new" | "interview">(null);
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try { setP((await crmGet<Person>(`/api/bench/${id}`)).data); } catch (e) { setError((e as Error).message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const saveTask = async (d: TaskDraft) => {
    const body = { title: d.title, details: d.details || null, priority: d.priority, due_date: d.due_date || null,
                   ...(taskEdit ? { status: d.status } : {}) };
    const r = taskEdit ? await crmPut(`/api/bench/tasks/${taskEdit.id}`, body) : await crmPost(`/api/bench/${id}/tasks`, body);
    toast(r.message || "Saved");
    setTaskEdit(undefined);
    void load();
  };

  const today = useMemo(() => toDateKey(new Date()), []);
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!p) return <div className="p-6 text-sm text-muted">Loading…</div>;
  const bench = p.status === "Bench";
  const open = p.tasks.filter((t) => t.status === "Open" || t.status === "In_Progress");
  const missed = bench ? missingDays(p.activity, today, 7) : [];
  const training = (p as Person & { training?: TrainingRef }).training;
  const trainingOpen = !!training && ["Active", "Interview_due", "Not_yet"].includes(training.status);
  /** RMG takes the AI interview from here: on the open plan, or start a plan first. */
  const openInterview = async () => {
    if (training && trainingOpen) {
      try { setPlan((await crmGet<TrainingPlan>(`/api/training/plans/${training.plan_id}`)).data); setPlanDlg("interview"); }
      catch (e) { toast((e as Error).message, "err"); }
    } else setPlanDlg("new");
  };

  return (
    <div className="space-y-4">
      {toastEl}
      <PageHeader icon={bench ? Armchair : Briefcase} accent={bench ? "amber" : "teal"}
        eyebrow={<CrmLink to={`bench?tab=${p.group && !p.group.counts_as_bench ? "groups" : bench ? "bench" : "deployed"}`} className="hover:underline">← Bench & Deployed</CrmLink>}
        title={p.name}
        subtitle={[p.employee_code, p.designation, p.department, p.experience_years != null ? `${p.experience_years} yrs experience` : null].filter(Boolean).join(" · ")}
        stats={[
          bench ? { label: "On the bench", value: daysText(p.bench_days), title: p.bench_since ? `Since ${fmtDateShort(p.bench_since)}` : undefined }
                : { label: "Deployed on", value: p.current.map((c) => c.project).join(", ") || "—" },
          { label: "Projects so far", value: p.projects_count },
          { label: "Total bench time", value: daysText(p.total_bench_days) },
          { label: "Open tasks", value: open.length },
          { label: "Resume", value: p.resume_percent == null ? "Not started" : `${p.resume_percent}%` },
        ]}
        actions={<>
          {canEdit && <button type="button" className={HERO_BTN_SOLID} onClick={() => { setSec("tasks"); setTaskEdit(null); }}><Plus size={14} /> Give a task</button>}
          {canEdit && <button type="button" className={HERO_BTN_SOLID} onClick={() => void openInterview()}><Bot size={14} /> AI interview</button>}
          {canEdit && <button type="button" className={HERO_BTN} onClick={() => training && trainingOpen ? crmNavigate(`training/${training.plan_id}`) : setPlanDlg("new")}>
            <GraduationCap size={14} /> {training && trainingOpen ? "Training plan" : "Start training"}</button>}
          {canEdit && <button type="button" className={HERO_BTN} onClick={() => setSharing(true)}><Share2 size={14} /> Share resume</button>}
          {canEdit && <button type="button" className={HERO_BTN} onClick={() => setMoving(true)}>{p.group ? <><Layers size={14} /> Change group</> : <><UserMinus size={14} /> Move to group</>}</button>}
          <button type="button" className={HERO_BTN} onClick={() => crmNavigate(`employees/${p.id}`)}><UserRound size={14} /> Employee record</button>
        </>}>
        {training && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-secondary">
            <span className="font-semibold text-primary">Training:</span><TrainingChip training={training} />
            <span>“{training.title}”</span>
          </div>
        )}
        {p.group && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-secondary">
            <span className="font-semibold text-primary">Group:</span>
            <GroupChip group={p.group} />
            {p.group.note && <span>“{p.group.note}”</span>}
            {p.group.set_by_name && <span className="text-muted">· by {p.group.set_by_name}{p.group.set_at ? `, ${fmtDateShort(p.group.set_at)}` : ""}</span>}
            {!p.group.counts_as_bench && <span className="text-muted">· not counted on the Bench tab</span>}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Sections">
          {SECTIONS.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" role="tab" aria-selected={sec === key} onClick={() => setSec(key)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition ${
                      sec === key ? "bg-brand-600 text-white ring-brand-600" : "text-secondary ring-subtle hover:bg-surface-2"}`}>
              <Icon size={13} />{label}
              {key === "tasks" && open.length > 0 && <span className="rounded-full bg-white/25 px-1.5">{open.length}</span>}
            </button>
          ))}
        </div>
      </PageHeader>

      {!p.has_login && (
        <div className="flex items-start gap-2 rounded-card border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
          <KeyRound size={16} className="mt-0.5 shrink-0" />
          <span>{p.name} has no login yet, so they cannot log daily activity or edit their resume. Admin: Access Control ▸ Users ▸ Create user with <b>{p.email}</b> and the <b>Employee</b> role.</span>
        </div>
      )}

      {sec === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card title="Where they are today" icon={bench ? Coffee : Briefcase}>
              {bench ? (
                <p className="text-sm text-secondary">
                  On the bench for <b className="text-primary">{daysText(p.bench_days)}</b>{p.bench_since && <> (since {fmtDateShort(p.bench_since)})</>}.
                  {p.last_project ? <> Last project: <b className="text-primary">{p.last_project.project}</b>{p.last_project.customer && ` · ${p.last_project.customer}`}, ended {fmtDateShort(p.last_project.ended)}.</> : " Never placed on a project yet."}
                </p>
              ) : p.current.map((c) => (
                <div key={c.project_id} className="text-sm text-secondary">
                  <CrmLink to={`projects/${c.project_id}`} className="font-bold text-brand-700 hover:underline">{c.project}</CrmLink>
                  {c.customer && ` · ${c.customer}`} · since {fmtDateShort(c.since)}
                  {c.release_date && <span className="ml-2 font-semibold text-amber-700 dark:text-amber-300">planned release {fmtDateShort(c.release_date)}</span>}
                </div>
              ))}
            </Card>
            <Card title="Skills" icon={ListTodo}>
              {p.skills.length ? <div className="flex flex-wrap gap-1.5">{p.skills.map((s) => <span key={s} className={`${chip} bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200`}>{s}</span>)}</div>
                : <p className="text-sm text-muted">No skills on the employee record — they appear on the resume once added.</p>}
            </Card>
            <Card title="Before Karnex" icon={Briefcase}>
              {p.previous_companies.length ? (
                <ul className="space-y-1.5 text-sm">{p.previous_companies.map((c, i) => (
                  <li key={i}><b className="text-primary">{c.company}</b>{c.title && ` · ${c.title}`} <span className="text-xs text-muted">{fmtDateShort(c.from)} → {c.current ? "present" : fmtDateShort(c.to)}</span></li>
                ))}</ul>
              ) : <p className="text-sm text-muted">No previous companies on record.</p>}
            </Card>
            <Card title="Education" icon={GraduationCap}>
              {p.education.length ? (
                <ul className="space-y-1.5 text-sm">{p.education.map((e, i) => (
                  <li key={i}><b className="text-primary">{e.course}</b>{e.specialization && ` (${e.specialization})`}{e.university && ` · ${e.university}`} <span className="text-xs text-muted">{e.end ? fmtDateShort(e.end) : ""}</span></li>
                ))}</ul>
              ) : <p className="text-sm text-muted">No education on record.</p>}
            </Card>
          </div>
          <div className="space-y-4">
            <Card title="Contact" icon={UserRound}>
              <ul className="space-y-1.5 text-sm text-secondary">
                <li><Mail size={13} className="mr-1.5 inline" />{p.email}</li>
                {p.phone && <li><Phone size={13} className="mr-1.5 inline" />{p.phone}</li>}
                {p.work_location && <li><MapPin size={13} className="mr-1.5 inline" />{p.work_location}</li>}
                <li><CalendarClock size={13} className="mr-1.5 inline" />Joined {fmtDateShort(p.date_of_joining)}</li>
              </ul>
              {p.cv_url && <div className="mt-2 text-sm">Uploaded CV: <FileLink url={p.cv_url} label="Open" downloadName={p.name} /></div>}
            </Card>
            <Card title="This week" icon={NotebookPen}>
              <p className="text-sm text-secondary">{p.logged_today ? "Logged today." : p.last_activity ? `Last log ${fmtDateShort(p.last_activity)}.` : "No daily log yet."}</p>
              {missed.length > 0 && <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">No entry on {missed.map((d) => fmtDateShort(d)).join(", ")}</p>}
              {p.tasks_overdue > 0 && <p className="mt-1 text-xs font-semibold text-rose-600"><AlertTriangle size={12} className="mr-1 inline" />{p.tasks_overdue} task(s) overdue</p>}
            </Card>
          </div>
        </div>
      )}

      {sec === "history" && (
        <Card title="Projects and bench periods, newest first" icon={History}>
          <p className="mb-3 text-xs text-muted">{p.projects_count} project(s) · {p.bench_spells} bench period(s), {daysText(p.total_bench_days)} in all.</p>
          <HistoryTimeline items={p.timeline} showRates />
        </Card>
      )}

      {sec === "tasks" && (
        <Card title="Tasks from RMG / GM" icon={ClipboardList}
              action={canEdit ? <button type="button" className={btnPrimary} onClick={() => setTaskEdit(null)}><Plus size={14} /> Give a task</button> : undefined}>
          {p.tasks.length === 0 ? <p className="text-sm text-muted">No tasks yet.</p> : (
            <div className="space-y-2">
              {p.tasks.map((t) => (
                <TaskCard key={t.id} t={t}>
                  {canEdit && <TaskManageButtons onEdit={() => setTaskEdit(t)} onDelete={() => setTaskDelete(t)} />}
                </TaskCard>
              ))}
            </div>
          )}
        </Card>
      )}

      {sec === "activity" && (
        <Card title="Daily activity — last 60 days" icon={NotebookPen}>
          {missed.length > 0 && (
            <p className="mb-3 rounded-control bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              No entry on {missed.map((d) => fmtDateShort(d)).join(", ")} (weekdays, last 7 days).
            </p>
          )}
          <ActivityList items={p.activity} tasks={p.tasks} empty={`${p.name} has not logged any daily activity yet.`} />
        </Card>
      )}

      {sec === "resume" && (
        <ResumeEditor base={`/api/bench/${p.id}/resume`} canEdit={canEdit} toast={toast} title={`${p.name} — resume`} onSaved={() => void load()} />
      )}

      {moving && (
        <MoveToGroupDialog people={[{ id: p.id, name: p.name, group: p.group }]} onClose={() => setMoving(false)}
          onDone={(m) => { setMoving(false); toast(m); void load(); }} />
      )}
      {planDlg === "new" && (
        <PlanDialog subject={{ employee_id: p.id, name: p.name, isEmployee: true }} source="bench" suggestions={p.skills}
          onClose={() => setPlanDlg(null)}
          onDone={(pl, m) => { toast(m); setPlan(pl); setPlanDlg("interview"); void load(); }} />
      )}
      {planDlg === "interview" && plan && (
        <TrainingInterviewDialog plan={plan} onClose={() => { setPlanDlg(null); void load(); }}
          onDone={(r, m) => { setPlan(r.plan); toast(m); }} />
      )}
      {sharing && <ShareResumeDialog employee={{ id: p.id, name: p.name }} onClose={() => setSharing(false)} onDone={(m) => toast(m)} />}
      {taskEdit !== undefined && (
        <TaskDialog person={p.name} task={taskEdit} onClose={() => setTaskEdit(undefined)} onSave={saveTask} />
      )}
      {taskDelete && (
        <ConfirmModal title="Delete this task?" message={`“${taskDelete.title}” will be removed from ${p.name}'s list.`}
          confirmLabel="Delete" danger onClose={() => setTaskDelete(null)}
          onConfirm={async () => { await crmDelete(`/api/bench/tasks/${taskDelete.id}`); setTaskDelete(null); toast("Task deleted"); void load(); }} />
      )}
      <p className="text-right text-[11px] text-muted">Updated {fmtDateTime12(new Date())}</p>
    </div>
  );
}


