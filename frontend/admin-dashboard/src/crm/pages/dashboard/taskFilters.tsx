/**
 * Filters for every My Tasks tab, every role (29 Sep 2026, user ask: "Sales —
 * timesheets customer-wise, month-wise, search; invoices pending and generated
 * need filters; Finance the same; find what fits every role").
 *
 * The server (B-V2 `work_desk.fill_facets`) gives each item its `customer`, its
 * `month` (a timesheet's PERIOD, an invoice's date, else the item's own date)
 * and, on billing items, its `project`; `?full=true` sends the whole list, so a
 * filter never works on the first 50 alone. Everything here is PURE except the
 * bar itself:
 *   `facetOptions(items)`    what each control can offer (only real values)
 *   `filterItems(items, f)`  the items a filter keeps
 *   `statusOf(chip)`         a chip without its day counts ("12 days overdue" → "Overdue")
 * A control appears only when it can actually narrow the list (≥ 2 values), so a
 * short tab shows the search box alone and no control ever offers one choice.
 */
import { Search, X } from "lucide-react";

import { CONTROL } from "../../components/controlTower";
import { ROUND_KIND_LABEL } from "../../lib/interviewRounds";

export type FilterableItem = {
  key: string;
  title: string;
  subtitle: string;
  chip: string | null;
  tone: "ok" | "warn" | "bad" | "info";
  section?: string | null;
  customer?: string | null;
  project?: string | null;
  month?: string | null;
  /** The person the sheet / invoice is for (billing items, 30 Sep 2026). */
  employee?: string | null;
  /** TA's "Pending activities" (30 Sep 2026): which list the item came from, and the round to book. */
  activity?: string | null;
  round_kind?: string | null;
};

export type GroupBy = "section" | "employee";

export type TaskFilter = {
  q: string;
  customer: string;
  project: string;
  month: string;
  employee: string;
  activity: string;
  round: string;
  status: string;
  priority: "" | "urgent" | "attention" | "on_track";
  /** How the list is sectioned: the server's `section` (customer / salesperson) or the employee. */
  groupBy: GroupBy;
};

export const EMPTY_FILTER: TaskFilter = {
  q: "", customer: "", project: "", month: "", employee: "", activity: "", round: "", status: "", priority: "", groupBy: "section",
};

/** Statuses beyond this many are noise, not a filter — the search box covers them. */
const MAX_STATUS_OPTIONS = 12;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09" → "Sep 2026". */
export function monthLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** The chip as a status: day counts and trailing details dropped. */
export function statusOf(chip: string | null | undefined): string {
  const head = (chip || "").split(" · ")[0].trim();
  if (/^\d+\s+days?\s+overdue$/i.test(head)) return "Overdue";
  return head;
}

const PRIORITY: Record<Exclude<TaskFilter["priority"], "">, (t: FilterableItem["tone"]) => boolean> = {
  urgent: (t) => t === "bad",
  attention: (t) => t === "bad" || t === "warn",
  on_track: (t) => t === "ok" || t === "info",
};
const PRIORITY_LABEL: Record<Exclude<TaskFilter["priority"], "">, string> = {
  urgent: "Urgent", attention: "Needs attention", on_track: "On track",
};

function distinct(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v && !!v.trim())));
}
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

export type FacetOptions = {
  customers: string[];
  projects: string[];
  months: string[];
  employees: string[];
  activities: string[];
  rounds: string[];
  statuses: string[];
  priorities: boolean;
};

/** What each control can offer. Projects follow the chosen customer. */
export function facetOptions(items: FilterableItem[], customer = ""): FacetOptions {
  const scoped = customer ? items.filter((i) => i.customer === customer) : items;
  const statuses = distinct(items.map((i) => statusOf(i.chip))).sort(byName);
  const tones = new Set(items.map((i) => i.tone));
  return {
    customers: distinct(items.map((i) => i.customer)).sort(byName),
    projects: distinct(scoped.map((i) => i.project)).sort(byName),
    months: distinct(items.map((i) => i.month)).sort().reverse(),
    employees: distinct(scoped.map((i) => i.employee)).sort(byName),
    activities: distinct(items.map((i) => i.activity)).sort(byName),
    rounds: distinct(items.map((i) => i.round_kind)),
    statuses: statuses.length <= MAX_STATUS_OPTIONS ? statuses : [],
    priorities: (tones.has("bad") || tones.has("warn")) && tones.size > 1,
  };
}

/** The items a filter keeps, in their server order. */
export function filterItems<T extends FilterableItem>(items: T[], f: TaskFilter): T[] {
  const words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((i) => {
    if (f.customer && i.customer !== f.customer) return false;
    if (f.project && i.project !== f.project) return false;
    if (f.month && i.month !== f.month) return false;
    if (f.employee && i.employee !== f.employee) return false;
    if (f.activity && i.activity !== f.activity) return false;
    if (f.round && i.round_kind !== f.round) return false;
    if (f.status && statusOf(i.chip) !== f.status) return false;
    if (f.priority && !PRIORITY[f.priority](i.tone)) return false;
    if (words.length) {
      const hay = [i.title, i.subtitle, i.chip, i.section, i.customer, i.project, i.employee, i.month && monthLabel(i.month)]
        .filter(Boolean).join(" ").toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

export function isFiltering(f: TaskFilter): boolean {
  return (Object.keys(f) as (keyof TaskFilter)[]).some((k) => k !== "groupBy" && f[k] !== "");
}

/** The group each item lands in under `groupBy` — the server's section, or the employee. */
export function groupKeyOf(item: { section?: string | null; employee?: string | null }, groupBy: GroupBy): string | null {
  if (groupBy === "employee") return item.employee || "No employee named";
  return item.section ?? null;
}

/** The bar under a My Tasks tab header. */
export function TaskFilterBar({ items, filter, onChange, shown }: {
  items: FilterableItem[];
  filter: TaskFilter;
  onChange: (f: TaskFilter) => void;
  shown: number;
}) {
  const opts = facetOptions(items, filter.customer);
  const set = (patch: Partial<TaskFilter>) => onChange({ ...filter, ...patch });
  const select = (label: string, value: string, options: [string, string][], onPick: (v: string) => void,
    all: string) => (
    <select aria-label={label} value={value} onChange={(e) => onPick(e.target.value)} className={`${CONTROL} max-w-[14rem]`}>
      <option value="">{all}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-subtle bg-surface-2 px-5 py-2.5">
      <label className="relative min-w-[12rem] flex-1 sm:max-w-xs">
        <span className="sr-only">Search this tab</span>
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        <input type="text" value={filter.q} onChange={(e) => set({ q: e.target.value })}
          placeholder="Search name, customer, project, number…" className={`${CONTROL} w-full pl-8`} />
      </label>
      {opts.customers.length > 1 && select("Customer", filter.customer, opts.customers.map((c) => [c, c]),
        (v) => set({ customer: v, project: v && filter.project && !items.some((i) => i.customer === v && i.project === filter.project) ? "" : filter.project }),
        "All customers")}
      {opts.projects.length > 1 && select("Project", filter.project, opts.projects.map((p) => [p, p]),
        (v) => set({ project: v }), "All projects")}
      {opts.months.length > 1 && select("Month", filter.month, opts.months.map((m) => [m, monthLabel(m)]),
        (v) => set({ month: v }), "All months")}
      {opts.employees.length > 1 && select("Employee", filter.employee, opts.employees.map((e) => [e, e]),
        (v) => set({ employee: v }), "All employees")}
      {opts.activities.length > 1 && select("Activity", filter.activity, opts.activities.map((a) => [a, a]),
        (v) => set({ activity: v }), "Every activity")}
      {opts.rounds.length > 1 && select("Round", filter.round, opts.rounds.map((r) => [r, ROUND_KIND_LABEL[r] || r]),
        (v) => set({ round: v }), "Every round")}
      {opts.statuses.length > 1 && select("Status", filter.status, opts.statuses.map((s) => [s, s]),
        (v) => set({ status: v }), "All statuses")}
      {opts.priorities && select("Priority", filter.priority,
        (Object.keys(PRIORITY_LABEL) as Exclude<TaskFilter["priority"], "">[]).map((k) => [k, PRIORITY_LABEL[k]]),
        (v) => set({ priority: v as TaskFilter["priority"] }), "Any priority")}
      {opts.employees.length > 0 && items.some((i) => i.section) && (
        <div className="inline-flex rounded-control bg-surface-1 p-0.5 ring-1 ring-inset ring-subtle" role="group" aria-label="Group by">
          {(["section", "employee"] as GroupBy[]).map((g) => (
            <button key={g} type="button" aria-pressed={filter.groupBy === g} onClick={() => set({ groupBy: g })}
              className={`rounded-control px-2.5 py-1 text-xs font-semibold transition-colors duration-micro ${
                filter.groupBy === g ? "bg-surface-0 text-primary shadow-raised" : "text-secondary hover:text-primary"}`}>
              {g === "section" ? "By customer" : "By employee"}
            </button>
          ))}
        </div>
      )}
      <span className="ml-auto text-xs text-muted tnum" aria-live="polite">
        {isFiltering(filter) ? `${shown} of ${items.length}` : `${items.length} item${items.length === 1 ? "" : "s"}`}
      </span>
      {isFiltering(filter) && (
        <button type="button" onClick={() => onChange(EMPTY_FILTER)}
          className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-surface-1 dark:text-brand-300">
          <X size={12} aria-hidden /> Clear
        </button>
      )}
    </div>
  );
}
