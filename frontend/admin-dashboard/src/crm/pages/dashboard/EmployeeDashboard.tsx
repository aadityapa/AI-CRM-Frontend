/**
 * The Dashboard of an employee-only login (Employee, + Interviewer) — 25 Nov 2026.
 *
 * User report with a screenshot: the employee's Dashboard showed "My work today"
 * and the company's Hiring control tower (pipeline positions, onboardings, sales
 * and fulfilment pace) — numbers about the company, nothing about them. Their
 * Dashboard is now about the person: where they are today (project / between
 * projects), this week's daily log, their tasks, resume, open positions that fit,
 * applications and AI interviews (`EmployeeHome`), and — when they also hold the
 * Interviewer role — the interviews they are taking (`PanelDashboard`).
 *
 * Data: `/api/my-workspace` (the caller's own Employees record) and the existing
 * `/api/my-workspace/home` + `/api/my-interviews`. The server refuses the hiring
 * tower to such a login (B-V2 `routers/crm/dashboards.hiring_control_tower`).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Briefcase, CalendarCheck2, CheckCircle2, CircleDashed, ClipboardList, FileText, History,
  NotebookPen, RefreshCw, Sparkles, UserCheck, Video,
} from "lucide-react";
import { crmGet } from "../../api";
import { crmNavigate } from "../../router";
import { ErrorBox } from "../../components/ui";
import { EmployeeHome } from "../../components/workspace/EmployeePortal";
import {
  BenchCard as Card, TASK_STATUS_WORDS, chip, daysText, type Activity, type Person, type Task,
} from "../../components/bench/BenchParts";
import { PanelDashboard } from "./PanelDashboard";
import { fmtDateShort } from "../../../lib/datetime";

type Data = Person & { resume: { percent: number; missing: string[]; saved: boolean; updated_at: string | null } };
type Meta = { linked: boolean; message?: string; today: string; back_days: number; earliest: string };

const go = (sec: string) => crmNavigate(sec === "opportunities" ? "opportunities" : `my-workspace?tab=${sec}`);

/** The working days of the week holding `today` (Mon–Fri), each logged or not. PURE. */
export function weekDays(activity: Pick<Activity, "date">[], today: string): { date: string; label: string; state: "done" | "missed" | "today" | "ahead" }[] {
  const have = new Set(activity.map((a) => a.date));
  const base = new Date(`${today}T00:00:00`);
  if (Number.isNaN(base.getTime())) return [];
  const dow = (base.getDay() + 6) % 7;                  // Monday = 0
  const monday = new Date(base);
  monday.setDate(base.getDate() - dow);
  const p = (x: number) => String(x).padStart(2, "0");
  const out: { date: string; label: string; state: "done" | "missed" | "today" | "ahead" }[] = [];
  for (let i = 0; i < 5; i += 1) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const label = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric" });
    const state = have.has(key) ? "done" : key === today ? "today" : key > today ? "ahead" : "missed";
    out.push({ date: key, label, state });
  }
  return out;
}

/** Open tasks first by overdue, then due date, then priority. PURE. */
export function tasksToShow(tasks: Task[], n = 5): Task[] {
  const rank = { High: 0, Medium: 1, Low: 2 } as const;
  return tasks
    .filter((t) => t.status === "Open" || t.status === "In_Progress")
    .sort((a, b) => Number(b.overdue) - Number(a.overdue)
      || (a.due_date || "9999").localeCompare(b.due_date || "9999")
      || rank[a.priority] - rank[b.priority])
    .slice(0, n);
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function HeroAction({ icon: Icon, label, onClick, solid }: { icon: LucideIcon; label: string; onClick: () => void; solid?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-control px-3 py-2 text-xs font-bold transition ${
        solid ? "bg-[#fff] text-[#0f766e] hover:bg-[#f0fdfa]" : "bg-[#fff]/15 text-[#fff] ring-1 ring-[#fff]/30 hover:bg-[#fff]/25"}`}>
      <Icon size={14} aria-hidden /> {label}
    </button>
  );
}

const WEEK_LOOK = {
  done: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
  missed: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-200",
  today: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  ahead: "border-subtle bg-surface-2 text-muted",
} as const;
const WEEK_WORD = { done: "Logged", missed: "Missed", today: "Log today", ahead: "—" } as const;

export function EmployeeDashboard({ roles }: { roles: string[] }) {
  const [data, setData] = useState<Data | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await crmGet<Data | null>("/api/my-workspace");
      setData(r.data);
      setMeta((r.meta || {}) as unknown as Meta);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { void load(); }, [load, tick]);

  const isInterviewer = roles.some((r) => String(r).toLowerCase() === "interviewer");
  const week = useMemo(() => (data && meta ? weekDays(data.activity, meta.today) : []), [data, meta]);
  const tasks = useMemo(() => (data ? tasksToShow(data.tasks) : []), [data]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!meta) return <div className="h-48 animate-pulse rounded-card bg-surface-2" aria-busy="true" />;
  if (!meta.linked || !data) {
    return (
      <div className="space-y-5">
        <div className="mx-auto mt-6 max-w-xl rounded-card border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
          <h2 className="mb-2 text-base font-bold">Your dashboard is not ready yet</h2>
          <p>{meta.message || "Your login is not linked to an Employees record. Ask HR / Admin to add you to Employees with this login's email."}</p>
        </div>
        {isInterviewer && <PanelDashboard />}
      </div>
    );
  }

  const first = data.name.split(" ")[0] || data.name;
  const onProject = data.status === "Deployed" && data.current.length > 0;
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const loggedToday = data.activity.some((a) => a.date === meta.today);
  const missed = week.filter((d) => d.state === "missed").length;
  const recent = data.activity.slice(0, 4);

  return (
    <div className="space-y-6">
      {/* Who and where — the person, not the company. */}
      <header className="relative overflow-hidden rounded-card bg-gradient-to-br from-teal-600 via-cyan-700 to-indigo-700 p-5 text-[#fff] shadow-raised sm:p-6">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#fff]/10" />
        <div aria-hidden className="pointer-events-none absolute -bottom-20 right-24 h-40 w-40 rounded-full bg-[#fff]/5" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#fff]/20 text-lg font-bold ring-2 ring-[#fff]/40">
              {initials(data.name)}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#fff]/75">{today}</p>
              <h1 className="text-2xl font-bold leading-tight">{greeting()}, {first}</h1>
              <p className="mt-0.5 text-sm text-[#fff]/85">
                {[data.designation, data.employee_code, data.experience_years != null ? `${data.experience_years} yrs experience` : null]
                  .filter(Boolean).join(" · ") || "Karnex employee"}
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff]/15 px-3 py-1.5 text-xs font-bold ring-1 ring-[#fff]/30">
            {onProject ? <Briefcase size={13} aria-hidden /> : <UserCheck size={13} aria-hidden />}
            {onProject
              ? `On ${data.current.map((c) => c.project).join(", ")}${data.current[0]?.since ? ` · since ${fmtDateShort(data.current[0].since)}` : ""}`
              : `Between projects · ${daysText(data.bench_days)}`}
          </span>
        </div>
        <div className="relative mt-5 flex flex-wrap gap-2">
          <HeroAction icon={NotebookPen} label={loggedToday ? "Today's log ✓" : "Log today's work"} onClick={() => go("today")} solid />
          <HeroAction icon={Briefcase} label="Open positions" onClick={() => go("opportunities")} />
          <HeroAction icon={FileText} label={`My resume · ${data.resume.percent}%`} onClick={() => go("resume")} />
          <HeroAction icon={Sparkles} label="My AI reports" onClick={() => go("interviews")} />
          {isInterviewer && <HeroAction icon={Video} label="My interviews" onClick={() => crmNavigate("my-interviews")} />}
          <button type="button" onClick={() => setTick((t) => t + 1)} aria-label="Refresh"
            className="ml-auto inline-flex items-center gap-1 rounded-control px-2 py-2 text-xs font-semibold text-[#fff]/80 hover:text-[#fff]">
            <RefreshCw size={14} aria-hidden /> Refresh
          </button>
        </div>
      </header>

      {/* This week's daily log. */}
      <section className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-control bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200"><CalendarCheck2 size={15} /></span>
          <h2 className="text-sm font-bold text-primary">This week's daily log</h2>
          <span className={`${chip} ${missed ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"}`}>
            {missed ? `${missed} day${missed > 1 ? "s" : ""} missed` : "Up to date"}
          </span>
          <button type="button" onClick={() => go("today")} className="ml-auto text-xs font-semibold text-brand-600 hover:underline">Open daily activity</button>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {week.map((d) => (
            <button key={d.date} type="button" disabled={d.state === "ahead"} onClick={() => go("today")}
              className={`rounded-control border px-2 py-2.5 text-center transition disabled:cursor-default ${WEEK_LOOK[d.state]} ${d.state === "ahead" ? "" : "hover:shadow-raised"}`}>
              <span className="block text-xs font-bold">{d.label}</span>
              <span className="mt-0.5 flex items-center justify-center gap-1 text-[11px] font-semibold">
                {d.state === "done" ? <CheckCircle2 size={12} aria-hidden /> : d.state === "ahead" ? null : <CircleDashed size={12} aria-hidden />}
                {WEEK_WORD[d.state]}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Tiles · next steps · positions that fit · skills. */}
      <EmployeeHome person={data} go={go} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`My tasks (${data.tasks.filter((t) => t.status === "Open" || t.status === "In_Progress").length} open)`} icon={ClipboardList}
          action={<button type="button" className="text-xs font-semibold text-brand-600 hover:underline" onClick={() => go("tasks")}>All tasks</button>}>
          {tasks.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={16} /> No open task — nothing assigned right now.</p>
          ) : (
            <ul className="divide-y divide-subtle">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${t.overdue ? "bg-rose-500" : t.priority === "High" ? "bg-amber-500" : "bg-sky-500"}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-primary">{t.title}</span>
                    <span className="block truncate text-[11px] text-muted">
                      {TASK_STATUS_WORDS[t.status]} · {t.priority} priority
                      {t.due_date ? ` · due ${fmtDateShort(t.due_date)}` : ""}{t.assigned_by_name ? ` · from ${t.assigned_by_name}` : ""}
                    </span>
                  </span>
                  {t.overdue && <span className={`${chip} bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200`}>Overdue</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="What I logged lately" icon={History}
          action={<button type="button" className="text-xs font-semibold text-brand-600 hover:underline" onClick={() => go("today")}>Add / edit</button>}>
          {recent.length === 0 ? (
            <p className="text-sm text-muted">Nothing logged yet. A short line a day is enough — what you worked on and for how long.</p>
          ) : (
            <ul className="space-y-2">
              {recent.map((a) => (
                <li key={a.id} className="rounded-control border border-subtle px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-muted">
                    <span>{fmtDateShort(a.date)}</span>
                    {a.hours != null && <span>{a.hours} h</span>}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-sm text-primary">{a.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {isInterviewer && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-control bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-200"><Video size={15} /></span>
            <h2 className="text-base font-bold text-primary">Interviews you are taking</h2>
            <span className="text-xs text-muted">as a panel member</span>
          </div>
          <PanelDashboard />
        </section>
      )}
    </div>
  );
}
