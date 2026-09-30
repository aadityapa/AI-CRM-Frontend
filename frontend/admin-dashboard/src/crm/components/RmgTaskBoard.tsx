/**
 * RMG / GM task board (28 Sep 2026, user ask: "all RMG & GM pending tasks in one
 * place in the Screening Desk, each opening the exact place to act, and the same
 * on the Dashboard so they know their pending work two ways").
 *
 * One server list, `GET /api/screening-desk/tasks` (B-V2 `services/rmg_tasks.py`),
 * which the Dashboard's work desk also turns into its tabs — the two never
 * disagree. Each category is a tile with its count. A category that lives ON the
 * desk (results to review, to screen, choose route, to book, submit to Sales, AI
 * L1 not cleared) filters the desk's queue in place (`onPickDeskTask`); the others
 * (feedback due, positions to approve, JD missing, headcount, template requests)
 * open their list under the board, each row a link to the page where it is done.
 *
 * 29 Sep 2026: (1) a login that approves timesheets / raises the Proforma (the GM)
 * also gets the billing chain here — Timesheets to approve · Proformas to raise ·
 * Proformas with Finance · Tax invoices issued (the last two are `info`: never
 * counted as pending). (2) A desk category can hold candidates who are PAST the
 * desk (with Sales / the customer) — "Results to review 1" used to open an empty
 * queue. Those items are now listed under the board with their own links, and a
 * result can be marked reviewed right there, so a tile never opens onto nothing.
 */
import { useState, type ReactNode } from "react";
import {
  AlertTriangle, BadgeCheck, BadgeIndianRupee, CalendarPlus, CheckCircle2, ChevronDown, ClipboardCheck,
  Clock, FileWarning, Hourglass, Inbox, LayoutTemplate, ListTodo, Receipt, RefreshCw, Route, Send,
  Sparkles, Users, type LucideIcon,
} from "lucide-react";

import { fmtDateTime12 } from "../../lib/datetime";
import { crmPost } from "../api";
import { STATE_CHIP, type StateTone } from "./controlTower";
import { FLOW_BTN } from "./flowButtons";
import { InterviewRoundsModal } from "./InterviewRoundsModal";
import { FeedbackDuePanel } from "./FeedbackDuePanel";
import { CrmLink } from "../router";

export type TaskItem = {
  key: string; title: string; subtitle: string; chip: string | null;
  tone: "ok" | "warn" | "bad" | "info"; when: string | null; path: string;
  action: string | null; profile_id: number | null;
  /** Feedback-due facets (30 Sep 2026): the position, the round, who took it. */
  section?: string | null; round_kind?: string | null; interviewer?: string | null; overdue_hours?: number | null;
};
export type TaskCategory = {
  key: string; label: string; hint: string; icon: string; on_desk: boolean;
  count: number; items: TaskItem[]; desk_ids: number[];
  /** Information, not work (never counted as pending). */
  info?: boolean;
  /** Stays on the board at zero. */
  always?: boolean;
};
export type TaskBoardData = { categories: TaskCategory[]; total: number; as_of: string };

/** Server icon names → lucide + one gradient per category. */
export const TASK_ICON: Record<string, LucideIcon> = {
  sparkles: Sparkles, message: ClipboardCheck, inbox: Inbox, route: Route, calendar: CalendarPlus,
  send: Send, alert: AlertTriangle, check: BadgeCheck, file: FileWarning, users: Users,
  layout: LayoutTemplate, clock: Clock, receipt: Receipt, hourglass: Hourglass, rupee: BadgeIndianRupee,
};
export const TASK_ACCENT: Record<string, string> = {
  results: "from-emerald-500 to-teal-600",
  feedback: "from-amber-500 to-orange-600",
  screening: "from-violet-500 to-fuchsia-600",
  route: "from-indigo-500 to-violet-600",
  booking: "from-sky-500 to-blue-600",
  decide: "from-blue-600 to-indigo-700",
  ai_failed: "from-rose-500 to-red-600",
  approvals: "from-teal-500 to-cyan-600",
  jd: "from-orange-500 to-amber-600",
  headcount: "from-pink-500 to-rose-600",
  templates: "from-slate-500 to-slate-700",
  ts_approve: "from-sky-500 to-cyan-600",
  proforma_raise: "from-orange-500 to-amber-600",
  proforma_finance: "from-amber-500 to-yellow-600",
  invoices_issued: "from-emerald-500 to-teal-600",
};

/** Items of a desk category whose candidate is no longer on the desk. */
export function offDeskItems(c: TaskCategory | null | undefined): TaskItem[] {
  if (!c?.on_desk) return [];
  const on = new Set(c.desk_ids);
  return c.items.filter((it) => it.profile_id == null || !on.has(it.profile_id));
}
const TONE: Record<TaskItem["tone"], StateTone> = { ok: "ok", warn: "warn", bad: "bad", info: "none" };

export function RmgTaskBoard({ data, loading, error, onRetry, activeTask, onPickDeskTask }: {
  data: TaskBoardData | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  /** The task from the URL: a desk category filters the queue (highlighted
   *  tile); a page category opens its list under the board. */
  activeTask: string | null;
  /** A desk category was picked (null = clear the filter). */
  onPickDeskTask: (key: string | null) => void;
}) {
  /* `undefined` = the user has not toggled a list yet: a deep link
     (`?task=jd` from a Dashboard tile) opens that category's list. */
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const categories = data?.categories ?? [];
  const openList = picked === undefined ? activeTask : picked;
  const setOpenList = (key: string | null) => setPicked(key);
  const listed = categories.find((c) => c.key === openList && !c.on_desk) || null;
  /* The active desk task's candidates who are past the desk — listed here, or
     the tile would open onto an empty queue. */
  const deskCategory = categories.find((c) => c.key === activeTask && c.on_desk) || null;
  const pastDesk = offDeskItems(deskCategory);
  const [marking, setMarking] = useState<number | null>(null);
  const [markError, setMarkError] = useState("");
  /* "Record feedback" opens the verdict pop-up here (30 Sep 2026, user ask) —
     never a trip to the profile; the saved feedback shows on its Interviews tab. */
  const [feedbackFor, setFeedbackFor] = useState<{ profileId: number; name: string } | null>(null);
  const feedbackButton = (it: TaskItem) => it.profile_id != null ? (
    <button type="button" className={FLOW_BTN.warn} onClick={() => setFeedbackFor({ profileId: it.profile_id as number, name: it.title })}>
      <ClipboardCheck size={13} aria-hidden /> Record feedback
    </button>
  ) : undefined;
  const markReviewed = async (profileId: number) => {
    setMarking(profileId);
    setMarkError("");
    try {
      await crmPost("/api/screening-desk/results-reviewed", { profile_id: profileId });
      onRetry();
    } catch (e: any) {
      setMarkError(e?.message || "Could not mark it reviewed");
    } finally {
      setMarking(null);
    }
  };

  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
        <AlertTriangle size={15} aria-hidden /> Could not load your pending work: {error}
        <button type="button" className={FLOW_BTN.neutral} onClick={onRetry}><RefreshCw size={12} /> Retry</button>
      </div>
    );
  }
  if (!data && loading) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[74px] animate-pulse rounded-card bg-surface-2" />)}
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" role="group" aria-label="Your pending work">
        {categories.map((c) => {
          const Icon = TASK_ICON[c.icon] ?? ListTodo;
          const accent = TASK_ACCENT[c.key] ?? "from-slate-500 to-slate-700";
          const on = c.on_desk ? activeTask === c.key : openList === c.key;
          const idle = c.count === 0;
          const countCls = c.info ? "text-brand-700 dark:text-brand-300" : "text-primary";
          return (
            <button
              key={c.key}
              type="button"
              title={c.hint}
              aria-pressed={on}
              onClick={() => {
                if (c.on_desk) { setOpenList(null); onPickDeskTask(on ? null : c.key); }
                else setOpenList(on ? null : c.key);
              }}
              className={`fx-lift relative flex items-center gap-3 overflow-hidden rounded-card border px-3 py-2.5 text-left transition-all duration-micro ${
                on ? "border-brand-500 bg-surface-1 shadow-overlay ring-2 ring-brand-500"
                  : idle ? "border-subtle bg-surface-2 opacity-70 hover:opacity-100"
                    : "border-subtle bg-surface-1 shadow-raised hover:border-brand-500"}`}
            >
              <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accent}`} aria-hidden />
              <span className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-gradient-to-br text-white shadow-raised ${accent}`}>
                <Icon className="h-5 w-5" aria-hidden />
                {c.key === "results" && c.count > 0 && (
                  <span className="absolute -right-1 -top-1 h-3 w-3 animate-ping rounded-full bg-emerald-400 motion-reduce:animate-none" aria-hidden />
                )}
              </span>
              <span className="min-w-0 pr-3">
                <span className={`block text-xl font-bold leading-6 tabular-nums ${countCls}`}>
                  {c.count || (c.info ? <span className="text-sm font-semibold text-muted">None</span>
                    : <CheckCircle2 className="inline h-5 w-5 text-success" aria-label="All clear" />)}
                </span>
                <span className="line-clamp-2 block text-xs font-semibold leading-tight text-secondary">{c.label}</span>
              </span>
              {!c.on_desk && c.count > 0 && (
                <ChevronDown size={14} className={`absolute bottom-2 right-2 text-muted transition-transform ${on ? "rotate-180" : ""}`} aria-hidden />
              )}
            </button>
          );
        })}
      </div>

      {/* Feedback due (30 Sep 2026, user ask): not a "past the desk" remainder —
          EVERY overdue verdict, grouped by position or by day, with filters; each
          row records in place. The queue below still lists the on-desk ones. */}
      {deskCategory?.key === "feedback" ? (
        <FeedbackDuePanel items={deskCategory.items} count={deskCategory.count} primary={feedbackButton}
          hint="Every round whose time has passed with no verdict — on the desk or already with Sales." />
      ) : deskCategory && pastDesk.length > 0 && (
        <div className="mt-3 rounded-card border border-warning bg-surface-1" role="region" aria-label={`${deskCategory.label} — past the desk`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-4 py-2">
            <p className="text-sm font-bold text-primary">
              {pastDesk.length} of “{deskCategory.label}” {pastDesk.length === 1 ? "is" : "are"} past the desk
            </p>
            <p className="text-xs text-muted">With Sales or the customer now — open them from here.</p>
          </div>
          {markError && <p className="px-4 pt-2 text-xs text-danger">{markError}</p>}
          <TaskItemList items={pastDesk} count={pastDesk.length}
            primary={deskCategory.key === "feedback" ? feedbackButton : undefined}
            extra={deskCategory.key === "results" ? (it) => it.profile_id != null && (
              <button type="button" className={FLOW_BTN.success} disabled={marking === it.profile_id}
                onClick={() => void markReviewed(it.profile_id as number)}>
                <CheckCircle2 size={13} aria-hidden /> {marking === it.profile_id ? "Marking…" : "Mark reviewed"}
              </button>
            ) : undefined} />
        </div>
      )}

      {listed && (
        <div className="mt-3 rounded-card border border-subtle bg-surface-1" role="region" aria-label={listed.label}>
          <div className="flex items-center justify-between gap-2 border-b border-subtle px-4 py-2">
            <p className="text-sm font-bold text-primary">{listed.label}</p>
            <p className="text-xs text-muted">{listed.hint}</p>
          </div>
          <TaskItemList items={listed.items} count={listed.count}
            primary={listed.key === "feedback" ? feedbackButton : undefined} />
        </div>
      )}
      {feedbackFor && (
        <InterviewRoundsModal profileId={feedbackFor.profileId} candidateName={feedbackFor.name} feedbackFirst
          onClose={() => setFeedbackFor(null)} onChanged={() => { setFeedbackFor(null); onRetry(); }} />
      )}
    </div>
  );
}

/** One category's rows — the same row the Dashboard work desk prints. */
export function TaskItemList({ items, count, extra, primary }: {
  items: TaskItem[];
  count: number;
  /** An extra button beside the row's own link (e.g. "Mark reviewed"). */
  extra?: (it: TaskItem) => ReactNode;
  /** Replaces the row's link when it returns a node (e.g. "Record feedback" in place). */
  primary?: (it: TaskItem) => ReactNode | undefined;
}) {
  if (!items.length) {
    return (
      <p className="flex items-center gap-2 px-4 py-5 text-sm text-success">
        <CheckCircle2 className="h-4 w-4" aria-hidden /> All clear — nothing here.
      </p>
    );
  }
  return (
    <>
      <ul className="divide-y divide-subtle">
        {items.map((it) => (
          <li key={it.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-primary">
                <span className="truncate">{it.title}</span>
                {it.chip && <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP[TONE[it.tone]]}`}>{it.chip}</span>}
              </div>
              <div className="truncate text-xs text-muted">
                {[it.subtitle, it.when ? fmtDateTime12(it.when) : ""].filter(Boolean).join(" · ")}
              </div>
            </div>
            <span className="flex flex-wrap items-center gap-2">
              {extra?.(it)}
              {primary?.(it) ?? (it.path && <CrmLink to={it.path} className={FLOW_BTN.primary}>{it.action || "Open"}</CrmLink>)}
            </span>
          </li>
        ))}
      </ul>
      {count > items.length && <p className="px-4 pb-3 text-xs text-muted">Showing {items.length} of {count}.</p>}
    </>
  );
}
