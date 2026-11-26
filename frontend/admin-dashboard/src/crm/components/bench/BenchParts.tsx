/**
 * Pieces shared by Bench & Deployed (RMG / GM / CEO) and My Workspace (the
 * employee) — 23 Nov 2026. The server is `services/bench_desk.py`.
 */
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Briefcase, CalendarDays, CheckCircle2, CircleDot, Clock, Coffee, Flag, ListTodo, PencilLine, Trash2,
} from "lucide-react";
import { Modal, btnPrimary, btnSecondary, inputCls } from "../ui";
import { fmtDateShort, fmtDateTime12 } from "../../../lib/datetime";

export type CurrentProject = {
  project_id: number; project: string; customer: string | null; since: string | null;
  release_date: string | null; role: string | null;
};
export type BenchRow = {
  id: number; name: string; employee_code: string | null; email: string; phone: string | null;
  designation: string | null; department: string | null; experience_years: number | null; skills: string[];
  work_location: string | null; date_of_joining: string | null; employment_type: string | null;
  status: "Bench" | "Deployed"; bench_since: string | null; bench_days: number | null;
  bench_spells: number; total_bench_days: number; projects_count: number;
  current: CurrentProject[];
  last_project: { project_id: number; project: string; customer: string | null; ended: string | null } | null;
  tasks_open: number; tasks_overdue: number; last_activity: string | null; logged_today: boolean;
  resume_percent: number | null; resume_missing: string[] | null; resume_updated_at: string | null;
  cv_url: string | null; has_login: boolean;
  /** The Bench & Deployed group the person is filed under (24 Nov 2026). */
  group?: import("./BenchGroups").PersonGroup | null;
  /** Server hint for an ungrouped person: "management" | "internal". */
  suggested_group?: string | null;
};
export type TimelineItem = {
  kind: "project" | "bench"; start: string | null; end: string | null; days: number | null;
  project_id?: number; project?: string; customer?: string | null; role?: string | null;
  release_date?: string | null; billing_rate?: number; billing_unit?: string; live?: boolean;
};
export type Task = {
  id: number; employee_id: number; title: string; details: string | null; priority: "High" | "Medium" | "Low";
  due_date: string | null; status: "Open" | "In_Progress" | "Done" | "Cancelled"; progress_note: string | null;
  assigned_by_name: string | null; updated_by_name: string | null; created_at: string | null;
  updated_at: string | null; done_at: string | null; overdue: boolean;
};
export type Activity = {
  id: number; date: string; hours: number | null; summary: string; task_ids: number[];
  written_by_name: string | null; updated_at: string | null;
};
export type Person = BenchRow & {
  timeline: TimelineItem[];
  education: { course: string; specialization: string | null; university: string | null; start: string | null; end: string | null }[];
  previous_companies: { company: string; title: string | null; current: boolean; from: string | null; to: string | null }[];
  tasks: Task[];
  activity: Activity[];
};

export const TASK_STATUS_WORDS: Record<Task["status"], string> = {
  Open: "Open", In_Progress: "In progress", Done: "Done", Cancelled: "Cancelled",
};
const STATUS_CHIP: Record<Task["status"], string> = {
  Open: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  In_Progress: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  Done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  Cancelled: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};
const PRIORITY_CHIP: Record<Task["priority"], string> = {
  High: "text-rose-600", Medium: "text-amber-600", Low: "text-slate-500",
};

export const chip = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold";

export function daysText(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 31) return `${n} day${n === 1 ? "" : "s"}`;
  const m = Math.round(n / 30.4);
  return m < 12 ? `${m} month${m === 1 ? "" : "s"}` : `${(n / 365).toFixed(1)} years`;
}

export function benchTone(days: number | null | undefined): string {
  if (days == null) return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  if (days > 60) return "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200";
  if (days > 30) return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
}

export function TaskStatusChip({ status }: { status: Task["status"] }) {
  return <span className={`${chip} ${STATUS_CHIP[status]}`}>{TASK_STATUS_WORDS[status]}</span>;
}

/* ------------------------------------------------------------------ history */

export function HistoryTimeline({ items, showRates }: { items: TimelineItem[]; showRates?: boolean }) {
  if (!items.length) return <p className="text-sm text-muted">No history yet.</p>;
  return (
    <ol className="relative space-y-3 border-l-2 border-subtle pl-5">
      {items.map((t, i) => {
        const bench = t.kind === "bench";
        return (
          <li key={i} className="relative">
            <span className={`absolute -left-[29px] top-1 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-surface-1 ${
              bench ? "bg-amber-500" : t.live ? "bg-emerald-500" : "bg-brand-500"} text-white`}>
              {bench ? <Coffee size={12} /> : <Briefcase size={12} />}
            </span>
            <div className={`rounded-control border p-3 ${bench ? "border-amber-200 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-900/20" : "border-subtle bg-surface-1"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-primary">{bench ? "On the bench" : t.project}</span>
                {!bench && t.customer && <span className="text-xs text-secondary">· {t.customer}</span>}
                {t.live && <span className={`${chip} bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200`}>Current</span>}
                {bench && t.end == null && <span className={`${chip} bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100`}>Now</span>}
                <span className="ml-auto text-xs font-semibold text-secondary">{daysText(t.days)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                <span><CalendarDays size={11} className="mr-1 inline" />{fmtDateShort(t.start) || "—"} → {t.end ? fmtDateShort(t.end) : "today"}</span>
                {t.role && <span>Role: {t.role}</span>}
                {t.release_date && <span>Planned release {fmtDateShort(t.release_date)}</span>}
                {showRates && t.billing_rate ? <span>Rate ₹{t.billing_rate.toLocaleString("en-IN")} / {t.billing_unit}</span> : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ tasks */

export function TaskCard({ t, children }: { t: Task; children?: React.ReactNode }) {
  return (
    <div className={`rounded-control border p-3 ${t.overdue ? "border-rose-300 dark:border-rose-800" : "border-subtle"} bg-surface-1`}>
      <div className="flex flex-wrap items-start gap-2">
        <ListTodo size={16} className="mt-0.5 shrink-0 text-brand-600" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-primary">{t.title}</span>
            <TaskStatusChip status={t.status} />
            <span className={`text-[11px] font-semibold ${PRIORITY_CHIP[t.priority]}`}><Flag size={11} className="mr-0.5 inline" />{t.priority}</span>
            {t.due_date && (
              <span className={`text-[11px] ${t.overdue ? "font-bold text-rose-600" : "text-muted"}`}>
                <Clock size={11} className="mr-0.5 inline" />Due {fmtDateShort(t.due_date)}{t.overdue ? " · overdue" : ""}
              </span>
            )}
          </div>
          {t.details && <p className="mt-1 whitespace-pre-line text-xs text-secondary">{t.details}</p>}
          {t.progress_note && (
            <p className="mt-2 rounded-control bg-surface-2 px-2 py-1.5 text-xs text-secondary">
              <b className="text-primary">Progress:</b> {t.progress_note}
            </p>
          )}
          <p className="mt-1 text-[11px] text-muted">
            Given by {t.assigned_by_name || "—"}{t.created_at ? ` · ${fmtDateShort(t.created_at)}` : ""}
            {t.updated_by_name && t.updated_at ? ` · last update ${t.updated_by_name}, ${fmtDateTime12(t.updated_at)}` : ""}
          </p>
        </div>
        {children && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{children}</div>}
      </div>
    </div>
  );
}

export type TaskDraft = { title: string; details: string; priority: Task["priority"]; due_date: string; status?: Task["status"] };

/** RMG / GM — assign a task or change one. */
export function TaskDialog({ person, task, onClose, onSave }: {
  person: string;
  task?: Task | null;
  onClose: () => void;
  onSave: (draft: TaskDraft) => Promise<void>;
}) {
  const [d, setD] = useState<TaskDraft>({
    title: task?.title || "", details: task?.details || "", priority: task?.priority || "Medium",
    due_date: task?.due_date || "", status: task?.status,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ok = d.title.trim().length >= 3;
  const submit = async () => {
    setBusy(true); setErr("");
    try { await onSave(d); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const pick = (days: number) => {
    const t = new Date(); t.setDate(t.getDate() + days);
    const p = (n: number) => String(n).padStart(2, "0");
    setD({ ...d, due_date: `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}` });
  };
  return (
    <Modal title={task ? `Change task — ${person}` : `New task for ${person}`} onClose={onClose} medium dirty={!!d.title && !task}>
      <div className="space-y-3">
        <label className="block"><span className="mb-1 block text-xs font-semibold text-secondary">Task *</span>
          <input className={inputCls} value={d.title} maxLength={200} onChange={(e) => setD({ ...d, title: e.target.value })}
                 placeholder="Complete the AUTOSAR basics course" /></label>
        <label className="block"><span className="mb-1 block text-xs font-semibold text-secondary">Details</span>
          <textarea className={`${inputCls} !min-h-[90px]`} rows={4} value={d.details} onChange={(e) => setD({ ...d, details: e.target.value })}
                    placeholder="What exactly, where to find it, what to send back" /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="mb-1 block text-xs font-semibold text-secondary">Priority</span>
            <div className="flex gap-1.5">
              {(["High", "Medium", "Low"] as const).map((p) => (
                <button key={p} type="button" onClick={() => setD({ ...d, priority: p })}
                        className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${
                          d.priority === p ? "bg-brand-600 text-white ring-brand-600" : "text-secondary ring-subtle hover:bg-surface-2"}`}>{p}</button>
              ))}
            </div>
          </div>
          <label className="block"><span className="mb-1 block text-xs font-semibold text-secondary">Due date</span>
            <input type="date" className={inputCls} value={d.due_date} onChange={(e) => setD({ ...d, due_date: e.target.value })} />
            <span className="mt-1 flex gap-1.5 text-[11px]">
              {[["Today", 0], ["Tomorrow", 1], ["In a week", 7]].map(([l, n]) => (
                <button key={l} type="button" className="text-brand-600 hover:underline" onClick={() => pick(n as number)}>{l}</button>
              ))}
            </span>
          </label>
        </div>
        {task && (
          <div>
            <span className="mb-1 block text-xs font-semibold text-secondary">Status</span>
            <div className="flex flex-wrap gap-1.5">
              {(["Open", "In_Progress", "Done", "Cancelled"] as const).map((s) => (
                <button key={s} type="button" onClick={() => setD({ ...d, status: s })}
                        className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${
                          d.status === s ? "bg-brand-600 text-white ring-brand-600" : "text-secondary ring-subtle hover:bg-surface-2"}`}>{TASK_STATUS_WORDS[s]}</button>
              ))}
            </div>
          </div>
        )}
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={!ok || busy} onClick={() => void submit()}>
            {busy ? "Saving…" : task ? "Save" : "Assign task"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function TaskManageButtons({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <>
      <button type="button" className={btnSecondary} onClick={onEdit}><PencilLine size={13} /> Change</button>
      <button type="button" className={`${btnSecondary} !text-danger`} onClick={onDelete} aria-label="Delete task"><Trash2 size={13} /></button>
    </>
  );
}

/* ------------------------------------------------------------------ activity */

export function ActivityList({ items, tasks, empty = "No daily activity logged yet." }: {
  items: Activity[]; tasks?: Task[]; empty?: string;
}) {
  if (!items.length) return <p className="text-sm text-muted">{empty}</p>;
  const names = new Map((tasks || []).map((t) => [t.id, t.title]));
  return (
    <ul className="space-y-2">
      {items.map((a) => (
        <li key={a.id} className="rounded-control border border-subtle bg-surface-1 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold text-primary"><CalendarDays size={12} className="mr-1 inline" />{fmtDateShort(a.date)}</span>
            {a.hours != null && <span className={`${chip} bg-surface-2 text-secondary`}><Clock size={11} />{a.hours} h</span>}
            {a.task_ids.map((id) => names.get(id) && (
              <span key={id} className={`${chip} bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200`}><CircleDot size={10} />{names.get(id)}</span>
            ))}
            <span className="ml-auto text-muted">{a.written_by_name}</span>
          </div>
          <p className="mt-1.5 whitespace-pre-line text-sm text-secondary">{a.summary}</p>
        </li>
      ))}
    </ul>
  );
}

/** Days in the last `n` with no entry (oldest first, weekends left out). PURE. */
export function missingDays(items: Activity[], today: string, n = 7): string[] {
  const have = new Set(items.map((a) => a.date));
  const out: string[] = [];
  const base = new Date(`${today}T00:00:00`);
  for (let i = n; i >= 0; i -= 1) {
    const d = new Date(base); d.setDate(base.getDate() - i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const p = (x: number) => String(x).padStart(2, "0");
    const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    if (!have.has(key)) out.push(key);
  }
  return out;
}

export function DoneMark() {
  return <CheckCircle2 size={14} className="text-emerald-600" />;
}

/** The section card both pages use. */
export function BenchCard({ title, icon: Icon, action, children }: { title: string; icon: LucideIcon; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
      <header className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-control bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200"><Icon size={15} /></span>
        <h3 className="text-sm font-bold text-primary">{title}</h3>
        {action && <div className="ml-auto">{action}</div>}
      </header>
      {children}
    </section>
  );
}

