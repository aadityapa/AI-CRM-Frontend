/**
 * My Workspace — every employee's own page (23 Nov 2026).
 *
 * The person logs today's activity, moves the tasks RMG / GM gave them, keeps
 * their resume in the company format and sees their own history. Admin creates
 * the login in Access Control ▸ Users with the seeded **Employee** role; the
 * login IS the Employees record with that official email (or linked user).
 * Server: `/api/my-workspace` (only ever the caller's own record).
 * Sections (`?tab=`): home · opportunities · applications · interviews · training ·
 * today · tasks · resume · history (25 Nov 2026: the employee portal — a dashboard
 * about the person, open positions with just the name + JD and Apply, their AI
 * interview reports and training; never billing. components/workspace/EmployeePortal).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Briefcase, CalendarCheck2, CheckCircle2, ClipboardList, Clock, FileText, GraduationCap, History, LayoutDashboard,
  NotebookPen, PlayCircle, RefreshCw, Save, Send, Sparkles,
} from "lucide-react";
import { crmGet, crmPut } from "../api";
import { HERO_BTN, PageHeader } from "../components/PageHeader";
import { ErrorBox, btnPrimary, btnSecondary, inputCls, useToast } from "../components/ui";
import { ResumeEditor } from "../components/resume/ResumeEditor";
import {
  EmployeeHome, MyApplications, MyInterviewReports, MyTraining, OpenPositions,
} from "../components/workspace/EmployeePortal";
import {
  ActivityList, BenchCard as Card, HistoryTimeline, TaskCard, chip, daysText, missingDays,
  type Activity, type Person, type Task,
} from "../components/bench/BenchParts";
import { usePageTab } from "../lib/pageState";
import { useSubTabs } from "../useAccess";
import { fmtDateShort } from "../../lib/datetime";

type Sec = "home" | "opportunities" | "applications" | "interviews" | "training" | "today" | "tasks" | "resume" | "history";
const ALL_SECS: Sec[] = ["home", "opportunities", "applications", "interviews", "training", "today", "tasks", "resume", "history"];
type Data = Person & { resume: { percent: number; missing: string[]; saved: boolean; updated_at: string | null } };
type Meta = { linked: boolean; message?: string; today: string; back_days: number; earliest: string };

const HOUR_PICKS = [2, 4, 6, 8, 9];

export function MyWorkspacePage() {
  // Each section is a sub-tab a role can switch off in Access Control (25 Nov 2026).
  const wsSub = useSubTabs("my-workspace");
  const allowedSecs = ALL_SECS.filter((k) => wsSub.allowed(k));
  const [sec, setSec] = usePageTab<Sec>("tab", allowedSecs[0] || "home", allowedSecs.length ? allowedSecs : ["home"]);
  const [data, setData] = useState<Data | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState("");
  const [toastEl, toast] = useToast();

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
  useEffect(() => { void load(); }, [load]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!meta) return <div className="p-6 text-sm text-muted">Loading…</div>;
  if (!meta.linked || !data) {
    return (
      <div className="mx-auto mt-10 max-w-lg rounded-card border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
        <h2 className="mb-2 text-base font-bold">My Workspace is not ready for your login</h2>
        <p>{meta.message}</p>
      </div>
    );
  }
  const open = data.tasks.filter((t) => t.status === "Open" || t.status === "In_Progress");
  const todayEntry = data.activity.find((a) => a.date === meta.today) || null;
  type Section = { key: Sec; label: string; icon: typeof NotebookPen; badge?: number };
  const SECTIONS: Section[] = ([
    { key: "home", label: "Home", icon: LayoutDashboard },
    { key: "opportunities", label: "Open positions", icon: Briefcase },
    { key: "applications", label: "My applications", icon: Send },
    { key: "interviews", label: "AI interviews", icon: Sparkles },
    { key: "training", label: "Training", icon: GraduationCap },
    { key: "today", label: "Daily activity", icon: NotebookPen },
    { key: "tasks", label: "My tasks", icon: ClipboardList, badge: open.length },
    { key: "resume", label: "My resume", icon: FileText },
    { key: "history", label: "My history", icon: History },
  ] as Section[]).filter((t) => allowedSecs.includes(t.key));

  return (
    <div className="space-y-4">
      {toastEl}
      <PageHeader icon={NotebookPen} accent="brand" eyebrow="My Workspace" title={`Hello, ${data.name.split(" ")[0]}`}
        subtitle={data.status === "Bench"
          ? "You are between projects — log what you do each day and keep your resume ready."
          : `You are on ${data.current.map((c) => c.project).join(", ")}. Keep your resume up to date.`}
        stats={[
          { label: "Today", value: todayEntry ? "Logged" : "Not logged yet" },
          { label: "Open tasks", value: open.length },
          { label: "Resume", value: `${data.resume.percent}%` },
          data.status === "Bench" ? { label: "On the bench", value: daysText(data.bench_days) }
            : { label: "Project", value: data.current[0]?.project || "—" },
        ]}
        actions={<button type="button" className={HERO_BTN} onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>}>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Sections">
          {SECTIONS.map(({ key, label, icon: Icon, badge }) => (
            <button key={key} type="button" role="tab" aria-selected={sec === key} onClick={() => setSec(key)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${
                      sec === key ? "bg-brand-600 text-white ring-brand-600" : "text-secondary ring-subtle hover:bg-surface-2"}`}>
              <Icon size={13} />{label}{badge ? <span className="rounded-full bg-white/25 px-1.5">{badge}</span> : null}
            </button>
          ))}
        </div>
      </PageHeader>

      {sec === "home" && <EmployeeHome person={data} go={(k) => setSec(k as Sec)} />}
      {sec === "opportunities" && <OpenPositions toast={toast} resumePercent={data.resume.percent} goResume={() => setSec("resume")} />}
      {sec === "applications" && <MyApplications go={(k) => setSec(k as Sec)} />}
      {sec === "interviews" && <MyInterviewReports />}
      {sec === "training" && <MyTraining />}
      {sec === "today" && <TodaySection data={data} meta={meta} toast={toast} reload={load} />}
      {sec === "tasks" && <TasksSection tasks={data.tasks} toast={toast} reload={load} />}
      {sec === "resume" && <ResumeEditor base="/api/my-workspace/resume" canEdit toast={toast} title="My resume" onSaved={() => void load()} />}
      {sec === "history" && (
        <Card title="My projects and bench periods" icon={History}>
          <HistoryTimeline items={data.timeline} />
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ today */

function TodaySection({ data, meta, toast, reload }: {
  data: Data; meta: Meta; toast: (m: string, k?: "ok" | "err") => void; reload: () => Promise<void>;
}) {
  const [day, setDay] = useState(meta.today);
  const entry = useMemo(() => data.activity.find((a) => a.date === day) || null, [data.activity, day]);
  const [summary, setSummary] = useState(entry?.summary || "");
  const [hours, setHours] = useState<string>(entry?.hours != null ? String(entry.hours) : "");
  const [taskIds, setTaskIds] = useState<number[]>(entry?.task_ids || []);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setSummary(entry?.summary || ""); setHours(entry?.hours != null ? String(entry.hours) : ""); setTaskIds(entry?.task_ids || []);
  }, [entry, day]);
  const open = data.tasks.filter((t) => t.status === "Open" || t.status === "In_Progress");
  const missed = missingDays(data.activity, meta.today, meta.back_days);
  const ok = summary.trim().length >= 10;

  const save = async () => {
    setBusy(true);
    try {
      const r = await crmPut(`/api/my-workspace/activity/${day}`, {
        summary, hours: hours === "" ? null : Number(hours), task_ids: taskIds,
      });
      toast(r.message || "Saved");
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <Card title={day === meta.today ? "What did you do today?" : `Your entry for ${fmtDateShort(day)}`} icon={CalendarCheck2}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block"><span className="mb-1 block text-xs font-semibold text-secondary">Day</span>
              <input type="date" className={`${inputCls} !w-44`} value={day} min={meta.earliest} max={meta.today}
                     onChange={(e) => setDay(e.target.value || meta.today)} /></label>
            <div>
              <span className="mb-1 block text-xs font-semibold text-secondary">Hours</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {HOUR_PICKS.map((h) => (
                  <button key={h} type="button" onClick={() => setHours(String(h))}
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
                            hours === String(h) ? "bg-brand-600 text-white ring-brand-600" : "text-secondary ring-subtle hover:bg-surface-2"}`}>{h} h</button>
                ))}
                <input type="number" min={0} max={24} step={0.5} className={`${inputCls} !w-20`} value={hours}
                       onChange={(e) => setHours(e.target.value)} aria-label="Hours" />
              </div>
            </div>
          </div>
          <label className="block"><span className="mb-1 block text-xs font-semibold text-secondary">What you worked on *</span>
            <textarea className={`${inputCls} !min-h-[150px]`} rows={7} value={summary} onChange={(e) => setSummary(e.target.value)}
                      placeholder={"• Completed module 3 of the AUTOSAR course\n• Wrote CAPL script for CAN message simulation\n• Practised UDS diagnostics on CANoe"} />
          </label>
          {open.length > 0 && (
            <div>
              <span className="mb-1 block text-xs font-semibold text-secondary">Tasks you worked on</span>
              <div className="flex flex-wrap gap-1.5">
                {open.map((t) => {
                  const on = taskIds.includes(t.id);
                  return (
                    <button key={t.id} type="button" aria-pressed={on}
                            onClick={() => setTaskIds(on ? taskIds.filter((x) => x !== t.id) : [...taskIds, t.id])}
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
                              on ? "bg-emerald-600 text-white ring-emerald-600" : "text-secondary ring-subtle hover:bg-surface-2"}`}>{t.title}</button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">You can add or change the last {meta.back_days} days.</span>
            <button type="button" className={btnPrimary} disabled={!ok || busy} onClick={() => void save()}>
              <Save size={14} /> {busy ? "Saving…" : entry ? "Update entry" : "Save entry"}
            </button>
          </div>
        </div>
      </Card>
      <div className="space-y-4">
        {missed.length > 0 && (
          <Card title="Days without an entry" icon={Clock}>
            <div className="flex flex-wrap gap-1.5">
              {missed.map((d) => (
                <button key={d} type="button" onClick={() => setDay(d)}
                        className={`${chip} bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200`}>{fmtDateShort(d)}</button>
              ))}
            </div>
          </Card>
        )}
        <Card title="Your recent entries" icon={NotebookPen}>
          <ActivityList items={data.activity.slice(0, 10) as Activity[]} tasks={data.tasks} />
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tasks */

function TasksSection({ tasks, toast, reload }: { tasks: Task[]; toast: (m: string, k?: "ok" | "err") => void; reload: () => Promise<void> }) {
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  if (!tasks.length) {
    return <Card title="My tasks" icon={ClipboardList}><p className="text-sm text-muted">No tasks from RMG yet.</p></Card>;
  }
  const update = async (t: Task, status?: Task["status"]) => {
    setBusy(t.id);
    try {
      const r = await crmPut(`/api/my-workspace/tasks/${t.id}`, {
        status: status ?? null, progress_note: notes[t.id] ?? t.progress_note ?? null,
      });
      toast(r.message || "Updated");
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card title="Tasks from RMG / GM" icon={ClipboardList}>
      <div className="space-y-3">
        {tasks.map((t) => (
          <div key={t.id} className="space-y-2">
            <TaskCard t={t}>
              {t.status === "Open" && (
                <button type="button" className={btnSecondary} disabled={busy === t.id} onClick={() => void update(t, "In_Progress")}>
                  <PlayCircle size={13} /> Start
                </button>
              )}
              {(t.status === "Open" || t.status === "In_Progress") && (
                <button type="button" className={btnPrimary} disabled={busy === t.id} onClick={() => void update(t, "Done")}>
                  <CheckCircle2 size={13} /> Mark done
                </button>
              )}
              {t.status === "Done" && (
                <button type="button" className={btnSecondary} disabled={busy === t.id} onClick={() => void update(t, "In_Progress")}>Reopen</button>
              )}
            </TaskCard>
            {t.status !== "Cancelled" && (
              <div className="flex gap-2 pl-6">
                <input className={`${inputCls} !w-auto min-w-0 flex-1`} placeholder="Progress note for RMG (optional)"
                       value={notes[t.id] ?? t.progress_note ?? ""} onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })} />
                <button type="button" className={btnSecondary} disabled={busy === t.id || notes[t.id] === undefined}
                        onClick={() => void update(t)}>Save note</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
