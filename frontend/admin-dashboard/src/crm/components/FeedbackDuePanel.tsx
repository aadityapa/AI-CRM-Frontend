/**
 * FeedbackDuePanel (30 Sep 2026, user ask: the Screening Desk's "Feedback due" tile
 * used to print "37 of Feedback due are past the desk" — a flat list; RMG / GM want
 * the overdue verdicts POSITION-wise or DAY-wise, with filters).
 *
 * One list — every round whose time has passed with no verdict (the server's
 * `rmg_tasks` feedback items, on the desk or already with Sales) — grouped by the
 * position it was for or by the day it was held, with search, a round filter and a
 * position filter. Each row records the verdict IN PLACE (the caller's `primary`
 * button opens `InterviewRoundsModal`). PURE helpers are exported for tests.
 */
import { useMemo, useState, type ReactNode } from "react";
import { CalendarDays, Layers, Search } from "lucide-react";

import { fmtDateTime12 } from "../../lib/datetime";
import { CONTROL } from "./controlTower";
import { ROUND_KIND_LABEL } from "../lib/interviewRounds";
import { TaskItemList, type TaskItem } from "./RmgTaskBoard";

export type FeedbackItem = TaskItem & {
  section?: string | null;
  round_kind?: string | null;
  interviewer?: string | null;
  overdue_hours?: number | null;
};
export type FeedbackGroupBy = "position" | "day";
export type FeedbackFilter = { q: string; round: string; position: string };
export const EMPTY_FEEDBACK_FILTER: FeedbackFilter = { q: "", round: "", position: "" };

const dayKey = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const dayLabel = (key: string) => {
  if (!key) return "No time recorded";
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
};

/** PURE: the rows that match the filter. */
export function filterFeedback(items: FeedbackItem[], f: FeedbackFilter): FeedbackItem[] {
  const q = f.q.trim().toLowerCase();
  return items.filter((it) =>
    (!f.round || (it.round_kind || "") === f.round) &&
    (!f.position || (it.section || "") === f.position) &&
    (!q || [it.title, it.subtitle, it.chip, it.interviewer, it.section].some((s) => (s || "").toLowerCase().includes(q))),
  );
}

/** PURE: group the rows by position (oldest overdue first inside) or by day (newest day first). */
export function groupFeedback(items: FeedbackItem[], by: FeedbackGroupBy): { key: string; label: string; items: FeedbackItem[] }[] {
  const map = new Map<string, FeedbackItem[]>();
  for (const it of items) {
    const key = by === "position" ? (it.section || "No position") : dayKey(it.when);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(it);
  }
  const groups = Array.from(map.entries()).map(([key, rows]) => ({
    key,
    label: by === "position" ? key : dayLabel(key),
    items: rows.slice().sort((a, b) => (a.when || "").localeCompare(b.when || "")),
  }));
  if (by === "day") groups.sort((a, b) => b.key.localeCompare(a.key));
  else groups.sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
  return groups;
}

export function FeedbackDuePanel({ items, count, primary, hint }: {
  items: FeedbackItem[];
  count: number;
  primary?: (it: TaskItem) => ReactNode | undefined;
  hint?: string;
}) {
  const [by, setBy] = useState<FeedbackGroupBy>("position");
  const [filter, setFilter] = useState<FeedbackFilter>(EMPTY_FEEDBACK_FILTER);
  const rounds = useMemo(() => Array.from(new Set(items.map((i) => i.round_kind).filter(Boolean) as string[])), [items]);
  const positions = useMemo(() => Array.from(new Set(items.map((i) => i.section).filter(Boolean) as string[])).sort(), [items]);
  const shown = useMemo(() => filterFeedback(items, filter), [items, filter]);
  const groups = useMemo(() => groupFeedback(shown, by), [shown, by]);
  const filtering = filter.q || filter.round || filter.position;

  return (
    <div className="mt-3 overflow-hidden rounded-card border border-subtle bg-surface-1" role="region" aria-label="Feedback due">
      <div className="flex flex-wrap items-center gap-2 border-b border-subtle bg-surface-2 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-primary">Feedback due · {shown.length}{filtering ? ` of ${count}` : ""}</p>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
        <div className="inline-flex rounded-full border border-subtle bg-surface-1 p-0.5" role="tablist" aria-label="Group by">
          {([["position", "By position", Layers], ["day", "By day", CalendarDays]] as const).map(([k, label, Icon]) => (
            <button key={k} type="button" role="tab" aria-selected={by === k} onClick={() => setBy(k)}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                by === k ? "bg-brand-600 text-white" : "text-secondary hover:text-primary"}`}>
              <Icon size={12} aria-hidden /> {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-subtle px-4 py-2">
        <label className="relative min-w-[14rem] flex-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input type="text" className={`${CONTROL} w-full pl-8`} placeholder="Candidate, position, interviewer…"
            value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} aria-label="Search feedback due" />
        </label>
        {rounds.length > 1 && (
          <select className={CONTROL} value={filter.round} onChange={(e) => setFilter((f) => ({ ...f, round: e.target.value }))} aria-label="Round">
            <option value="">Every round</option>
            {rounds.map((r) => <option key={r} value={r}>{ROUND_KIND_LABEL[r] || r}</option>)}
          </select>
        )}
        {positions.length > 1 && (
          <select className={`${CONTROL} max-w-[18rem]`} value={filter.position} onChange={(e) => setFilter((f) => ({ ...f, position: e.target.value }))} aria-label="Position">
            <option value="">Every position</option>
            {positions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        {filtering && (
          <button type="button" className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300"
            onClick={() => setFilter(EMPTY_FEEDBACK_FILTER)}>Clear</button>
        )}
      </div>
      {groups.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted">{filtering ? "Nothing matches these filters." : "No feedback is due."}</p>
      ) : groups.map((g) => (
        <section key={g.key} className="border-b border-subtle last:border-b-0">
          <header className="flex items-center justify-between gap-2 px-4 py-1.5">
            <h3 className="truncate text-xs font-bold uppercase tracking-wide text-secondary">{g.label}</h3>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              {g.items.length} due{by === "day" ? "" : ` · oldest ${fmtDateTime12(g.items[0].when || "")}`}
            </span>
          </header>
          <TaskItemList items={g.items} count={g.items.length} primary={primary} />
        </section>
      ))}
    </div>
  );
}
