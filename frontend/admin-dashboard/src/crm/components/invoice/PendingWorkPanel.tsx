/**
 * Invoices ▸ Pending work (26 Nov 2026, user ask: "one tab in Invoices with the
 * invoices pending after the Proforma is generated and the timesheets pending
 * for approval, with all required filters — so we see straight away which
 * employee's timesheet is waiting, instead of opening each project").
 *
 * One list, server-built (`GET /api/invoices/pending-work`,
 * services/pending_billing.py): every piece of work that has not yet become a
 * tax invoice, at the step it is stuck on —
 *
 *   Timesheet not created → Not submitted → Rejected → Waiting for approval →
 *   Approved, Proforma to raise → Proforma returned → Proforma with Finance
 *
 * Redesigned the same day for readability (user ask "make this page more
 * user-friendly"):
 *  - the steps are three LANES by whose move it is (Sales · GM · Finance) — a
 *    lane header picks all its steps, a step picks itself (several at once);
 *  - "waited for" is a row of chips with counts (Any · under 3 days · 3+ · 15+ ·
 *    30+), the rest of the filters sit behind "More filters", and every filter
 *    that is on shows as a chip you can remove;
 *  - each row shows a five-dot progress rail (Timesheet → Submitted → Approved
 *    → Proforma → Tax invoice) so where it is stuck reads at a glance;
 *  - the list can be grouped by customer, project, employee or work month.
 * Buttons open the timesheet / invoice page, where each action and its rules
 * already live.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, Building2, Check, CheckCircle2, ChevronDown, ChevronRight, ClipboardList,
  Download, FilePlus2, FileText, Filter, HelpCircle, Landmark, Loader2, RefreshCw, Search, Send,
  SlidersHorizontal, Undo2, UserCog, UserX, Users, X,
} from "lucide-react";
import { authFetch } from "../../../api/client";
import { crmGet, DESK_CHANGED_EVENT, qs } from "../../api";
import { useSessionState } from "../../lib/pageState";
import { CrmLink } from "../../routerHooks";

export type PendingStage =
  | "not_created" | "not_submitted" | "rejected" | "awaiting_approval" | "to_raise" | "returned" | "proforma";

export type PendingRow = {
  key: string;
  stage: PendingStage;
  stage_label: string;
  next_owner: string;
  employee?: string | null;
  employee_id?: number | null;
  employee_code?: string | null;
  customer?: string | null;
  customer_id?: number | null;
  branch?: string | null;
  branch_id?: number | null;
  project?: string | null;
  project_id?: number | null;
  owner?: string | null;
  month?: string | null;
  month_label?: string | null;
  period_label?: string | null;
  hours?: number | null;
  billable_days?: number | null;
  timesheet_id?: number | null;
  invoice_id?: number | null;
  proforma_number?: string | null;
  po_number?: string | null;
  part?: number | null;
  amount?: number | null;
  waiting_days?: number | null;
  since_label?: string | null;
  by_name?: string | null;
  note?: string | null;
};

type Opt = { id: number; name: string; customer_id?: number | null; branch_id?: number | null };
type Meta = {
  total: number; page: number; limit: number; all: number; amount: number;
  counts: Record<string, { count: number; amount: number }>;
  wait_buckets?: Record<WaitKey, number>;
  options: {
    customers: Opt[]; branches: Opt[]; no_branch: number; projects: Opt[]; employees: Opt[]; owners: Opt[];
    months: { key: string; label: string }[];
  };
  can?: { approve: boolean; raise: boolean; convert: boolean };
  data_start?: { label: string };
};

export type GroupBy = "" | "customer" | "project" | "employee" | "month";

export type PendingFilters = {
  stages: PendingStage[];
  search: string;
  customer: string;
  branch: string;
  project: string;
  employee: string;
  owner: string;
  month: string;
  waiting: string;
  sort: string;
  groupBy: GroupBy;
  pageSize: number;
};

const LIMIT = 25;

export const EMPTY_PENDING_FILTERS: PendingFilters = {
  stages: [], search: "", customer: "", branch: "", project: "", employee: "", owner: "", month: "",
  waiting: "", sort: "waiting", groupBy: "", pageSize: LIMIT,
};

/** The chain, in order, with how each step looks. Whose move: Sales fills,
 *  the GM approves and raises, Finance issues. */
export const STAGE_LOOK: Record<PendingStage, {
  label: string; short: string; who: string; icon: typeof FileText; chip: string; bar: string; dot: string;
}> = {
  not_created: { label: "Timesheet not created", short: "No timesheet", who: "Sales", icon: UserX,
    chip: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200", bar: "from-slate-400 to-slate-500",
    dot: "bg-slate-500" },
  not_submitted: { label: "Not submitted", short: "Not submitted", who: "Sales", icon: ClipboardList,
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200", bar: "from-amber-400 to-orange-500",
    dot: "bg-amber-500" },
  rejected: { label: "Rejected — fix & resubmit", short: "Rejected", who: "Sales", icon: Undo2,
    chip: "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200", bar: "from-rose-500 to-pink-500",
    dot: "bg-rose-500" },
  awaiting_approval: { label: "Waiting for approval", short: "For approval", who: "GM", icon: Send,
    chip: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200", bar: "from-sky-500 to-cyan-500",
    dot: "bg-sky-500" },
  to_raise: { label: "Approved — Proforma to raise", short: "Proforma to raise", who: "GM", icon: FilePlus2,
    chip: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200", bar: "from-indigo-500 to-blue-600",
    dot: "bg-indigo-500" },
  returned: { label: "Proforma returned by Finance", short: "Proforma returned", who: "GM", icon: AlertTriangle,
    chip: "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-200", bar: "from-orange-500 to-red-500",
    dot: "bg-orange-500" },
  proforma: { label: "Proforma — tax invoice to issue", short: "Proforma with Finance", who: "Finance", icon: FileText,
    chip: "bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-200", bar: "from-purple-500 to-fuchsia-500",
    dot: "bg-purple-500" },
};
export const STAGE_ORDER: PendingStage[] = [
  "not_created", "not_submitted", "rejected", "awaiting_approval", "to_raise", "returned", "proforma",
];

/** The three lanes — whose move it is. */
export const LANES: {
  key: "sales" | "gm" | "finance"; who: string; title: string; hint: string; icon: typeof FileText;
  tile: string; stages: PendingStage[];
}[] = [
  { key: "sales", who: "Sales", title: "With Sales", hint: "Fill and submit the timesheet", icon: Users,
    tile: "from-amber-400 to-orange-500", stages: ["not_created", "not_submitted", "rejected"] },
  { key: "gm", who: "GM", title: "With the GM", hint: "Approve the timesheet, raise the Proforma", icon: UserCog,
    tile: "from-sky-500 to-indigo-600", stages: ["awaiting_approval", "to_raise", "returned"] },
  { key: "finance", who: "Finance", title: "With Finance", hint: "Issue the tax invoice", icon: Landmark,
    tile: "from-purple-500 to-fuchsia-500", stages: ["proforma"] },
];

/** Pick a whole lane — or let go of it when it is exactly what is picked (PURE). */
export function toggleLane(picked: PendingStage[], lane: PendingStage[]): PendingStage[] {
  const same = picked.length === lane.length && lane.every((s) => picked.includes(s));
  return same ? [] : STAGE_ORDER.filter((s) => lane.includes(s));
}

/** The five steps every piece of work goes through. */
export const STEPS = ["Timesheet", "Submitted", "Approved", "Proforma", "Tax invoice"] as const;

/** Which step a stage is waiting on (PURE): the steps before it are done. */
export function stepOf(stage: PendingStage): { current: number; blocked: boolean } {
  switch (stage) {
    case "not_created": return { current: 0, blocked: false };
    case "not_submitted": return { current: 1, blocked: false };
    case "rejected": return { current: 1, blocked: true };
    case "awaiting_approval": return { current: 2, blocked: false };
    case "to_raise": return { current: 3, blocked: false };
    case "returned": return { current: 3, blocked: true };
    case "proforma": return { current: 4, blocked: false };
    default: return { current: 0, blocked: false };
  }
}

export type WaitKey = "under_3" | "d3" | "d15" | "d30";
const WAIT_CHIPS: { key: string; bucket?: WaitKey; label: string; tone: string }[] = [
  { key: "", label: "Any time", tone: "" },
  { key: "3", bucket: "d3", label: "3+ days", tone: "text-amber-700 dark:text-amber-300" },
  { key: "15", bucket: "d15", label: "15+ days", tone: "text-orange-700 dark:text-orange-300" },
  { key: "30", bucket: "d30", label: "30+ days", tone: "text-rose-700 dark:text-rose-300" },
];

const CONTROL =
  "h-9 rounded-control border border-subtle bg-surface-1 px-2.5 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-brand-500/40";
const SORTS = [
  { key: "waiting", label: "Waiting longest" }, { key: "newest", label: "Newest first" },
  { key: "month", label: "Work month" }, { key: "employee", label: "Employee A–Z" },
  { key: "amount", label: "Largest amount" },
];
const GROUPS: { key: GroupBy; label: string }[] = [
  { key: "", label: "No grouping" }, { key: "customer", label: "Customer" }, { key: "project", label: "Project" },
  { key: "employee", label: "Employee" }, { key: "month", label: "Work month" },
];
/** Grouping needs the rows in group order — the server sorts by the group. */
const GROUP_SORT: Record<Exclude<GroupBy, "">, string> = {
  customer: "customer", project: "project", employee: "employee", month: "month",
};
const PAGE_SIZES = [25, 50, 100];

export const rupee = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—";
};

/** The server query for these filters (PURE). */
export function pendingQuery(f: PendingFilters, page: number): Record<string, string | number | undefined> {
  return {
    stage: f.stages.length ? f.stages.join(",") : undefined,
    search: f.search.trim() || undefined,
    customer_id: f.customer || undefined,
    branch_id: f.branch || undefined,
    project_id: f.project || undefined,
    employee_id: f.employee || undefined,
    owner_id: f.owner || undefined,
    month: f.month || undefined,
    waiting_min: f.waiting || undefined,
    sort: f.groupBy ? GROUP_SORT[f.groupBy] : (f.sort || "waiting"),
    page, limit: f.pageSize || LIMIT,
  };
}

/** How many filters are on, besides the stage, the sort and the view (PURE). */
export function activeFilterCount(f: PendingFilters): number {
  return [f.search.trim(), f.customer, f.branch, f.project, f.employee, f.owner, f.month, f.waiting]
    .filter(Boolean).length;
}

/** Add / remove a stage, kept in chain order (PURE). */
export function toggleStage(picked: PendingStage[], s: PendingStage): PendingStage[] {
  const set = new Set(picked);
  if (set.has(s)) set.delete(s); else set.add(s);
  return STAGE_ORDER.filter((x) => set.has(x));
}

/** The waiting chip's tone: green < 3 days, amber < 15, red after (PURE). */
export function waitTone(days?: number | null): string {
  if (days == null) return "text-muted";
  if (days >= 15) return "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200";
  if (days >= 3) return "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200";
  return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200";
}

/** "Today", "1 day", "12 days", "239 days" — and roughly in months past 60 (PURE). */
export function waitText(days?: number | null): { main: string; sub: string | null } {
  if (days == null) return { main: "—", sub: null };
  if (days === 0) return { main: "Today", sub: null };
  const main = `${days} day${days === 1 ? "" : "s"}`;
  return { main, sub: days >= 60 ? `about ${Math.round(days / 30)} months` : null };
}

/** Who the "by" name on a row is, in words (PURE). */
export function byLabel(stage: PendingStage): string {
  switch (stage) {
    case "not_submitted": return "Sheet created by";
    case "rejected": return "Rejected by";
    case "awaiting_approval": return "Submitted by";
    case "to_raise": return "Approved by";
    case "returned": return "Returned by";
    default: return "By";
  }
}

/** The row's main button: where it goes and what it says (PURE). */
export function rowAction(r: PendingRow, can?: Meta["can"]): { to: string; label: string } | null {
  switch (r.stage) {
    case "not_created":
      return { to: "timesheets?tab=due", label: "Create timesheet" };
    case "not_submitted":
    case "rejected":
      return r.timesheet_id ? { to: `timesheets/${r.timesheet_id}`, label: r.stage === "rejected" ? "Fix & resubmit" : "Open timesheet" } : null;
    case "awaiting_approval":
      return r.timesheet_id ? { to: `timesheets/${r.timesheet_id}`, label: can?.approve ? "Review & approve" : "Open timesheet" } : null;
    case "to_raise":
      return r.timesheet_id ? { to: `timesheets/${r.timesheet_id}`, label: can?.raise ? "Raise Proforma" : "Open timesheet" } : null;
    case "returned":
      return r.timesheet_id ? { to: `timesheets/${r.timesheet_id}`, label: can?.raise ? "Reissue Proforma" : "Open timesheet" }
        : r.invoice_id ? { to: `invoices/${r.invoice_id}`, label: "Open Proforma" } : null;
    case "proforma":
      return r.invoice_id ? { to: `invoices/${r.invoice_id}`, label: can?.convert ? "Generate tax invoice" : "Open Proforma" } : null;
    default:
      return null;
  }
}

/** The rows of one page cut into groups, in the order they arrive (PURE). */
export function groupRows(rows: PendingRow[], by: GroupBy): { key: string; label: string; sub?: string | null; rows: PendingRow[]; amount: number }[] {
  if (!by) return [{ key: "_all", label: "", rows, amount: rows.reduce((a, r) => a + (r.amount || 0), 0) }];
  const out: { key: string; label: string; sub?: string | null; rows: PendingRow[]; amount: number }[] = [];
  const index = new Map<string, number>();
  for (const r of rows) {
    const key = by === "customer" ? `c${r.customer_id ?? r.customer ?? "-"}`
      : by === "project" ? `p${r.project_id ?? r.project ?? "-"}`
        : by === "employee" ? `e${r.employee_id ?? r.employee ?? "-"}`
          : `m${r.month ?? "-"}`;
    const label = (by === "customer" ? r.customer : by === "project" ? r.project
      : by === "employee" ? r.employee : r.month_label) || "Not on record";
    const sub = by === "project" ? r.customer : by === "employee" ? r.employee_code : null;
    let i = index.get(key);
    if (i == null) { i = out.length; index.set(key, i); out.push({ key, label, sub, rows: [], amount: 0 }); }
    out[i].rows.push(r);
    out[i].amount += r.amount || 0;
  }
  return out;
}

function initials(name?: string | null) {
  const parts = (name || "?").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

/** Five dots: done (green tick), the step it waits on (stage colour), still to come. */
function StepRail({ stage }: { stage: PendingStage }) {
  const { current, blocked } = stepOf(stage);
  const look = STAGE_LOOK[stage];
  return (
    <div className="flex items-center" aria-label={`Waiting on: ${STEPS[current]}`}>
      {STEPS.map((s, i) => {
        const done = i < current;
        const here = i === current;
        return (
          <Fragment key={s}>
            {i > 0 && <span aria-hidden className={`h-0.5 w-4 ${i <= current ? "bg-emerald-400" : "bg-slate-200 dark:bg-slate-700"}`} />}
            <span title={`${s}${done ? " — done" : here ? (blocked ? " — sent back" : " — waiting here") : ""}`}
              className={`flex h-4 w-4 flex-none items-center justify-center rounded-full ${
                done ? "bg-emerald-500 text-white"
                  : here ? `${look.dot} ring-4 ring-offset-0 ${blocked ? "ring-rose-200 dark:ring-rose-900/60" : "ring-brand-100 dark:ring-brand-900/50"}`
                    : "border-2 border-slate-300 bg-surface-1 dark:border-slate-600"}`}>
              {done && <Check size={10} strokeWidth={3} />}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

export function PendingWorkPanel({ onCount }: { onCount?: (n: number) => void }) {
  const [f, setF] = useSessionState<PendingFilters>("inv.pending", EMPTY_PENDING_FILTERS);
  const filters = { ...EMPTY_PENDING_FILTERS, ...f };
  const [page, setPage] = useSessionState("inv.pending.page", 1);
  const [moreOpen, setMoreOpen] = useSessionState("inv.pending.more", false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchText, setSearchText] = useState(filters.search);
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const set = (patch: Partial<PendingFilters>) => { setF((prev) => ({ ...EMPTY_PENDING_FILTERS, ...prev, ...patch })); setPage(1); };

  useEffect(() => {
    if (searchText === filters.search) return undefined;
    const t = window.setTimeout(() => set({ search: searchText }), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  const queryKey = JSON.stringify(pendingQuery(filters, page));
  useEffect(() => {
    let alive = true;
    setLoading(true);
    crmGet<PendingRow[]>(`/api/invoices/pending-work${qs(pendingQuery(filters, page))}`)
      .then((r) => {
        if (!alive) return;
        setRows((r.data || []) as PendingRow[]);
        const m = r.meta as unknown as Meta;
        setMeta(m);
        setError("");
        if (m && onCount) onCount(Object.values(m.counts || {}).reduce((a, c) => a + (c?.count || 0), 0));
      })
      .catch((e) => { if (alive) setError(e?.message || "Could not load the pending work"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queryKey stands for filters + page
  }, [queryKey, reload]);

  /* Live: re-read after a change anywhere in the app, and every 60 s while visible. */
  useEffect(() => {
    const bump = () => { if (document.visibilityState === "visible") setReload((k) => k + 1); };
    window.addEventListener(DESK_CHANGED_EVENT, bump);
    const t = window.setInterval(bump, 60_000);
    return () => { window.removeEventListener(DESK_CHANGED_EVENT, bump); window.clearInterval(t); };
  }, []);

  const opts = meta?.options;
  const branches = useMemo(() => (opts?.branches || [])
    .filter((b) => !filters.customer || String(b.customer_id) === filters.customer), [opts, filters.customer]);
  const projects = useMemo(() => (opts?.projects || [])
    .filter((p) => (!filters.customer || String(p.customer_id) === filters.customer)
      && (!filters.branch || String(p.branch_id || 0) === filters.branch)), [opts, filters.customer, filters.branch]);
  const allCount = STAGE_ORDER.reduce((a, s) => a + (meta?.counts?.[s]?.count || 0), 0);
  const allAmount = STAGE_ORDER.reduce((a, s) => a + (meta?.counts?.[s]?.amount || 0), 0);
  const active = activeFilterCount(filters);
  const pageSize = meta?.limit || filters.pageSize || LIMIT;
  const pages = meta ? Math.max(1, Math.ceil(meta.total / pageSize)) : 1;
  const firstShown = meta && meta.total ? (page - 1) * pageSize + 1 : 0;
  const lastShown = meta ? Math.min(meta.total, page * pageSize) : 0;
  const groups = useMemo(() => groupRows(rows, filters.groupBy), [rows, filters.groupBy]);
  const moreCount = [filters.branch, filters.project, filters.owner].filter(Boolean).length;

  /* Every filter that is on, as a removable chip. */
  const nameOf = (list: Opt[] | undefined, id: string) => list?.find((x) => String(x.id) === id)?.name || `#${id}`;
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.search.trim()) chips.push({ key: "search", label: `“${filters.search.trim()}”`, clear: () => { setSearchText(""); set({ search: "" }); } });
  if (filters.customer) chips.push({ key: "customer", label: `Customer: ${nameOf(opts?.customers, filters.customer)}`, clear: () => set({ customer: "", branch: "", project: "" }) });
  if (filters.branch) chips.push({ key: "branch", label: `Branch: ${filters.branch === "0" ? "none on record" : nameOf(opts?.branches, filters.branch)}`, clear: () => set({ branch: "", project: "" }) });
  if (filters.project) chips.push({ key: "project", label: `Project: ${nameOf(opts?.projects, filters.project)}`, clear: () => set({ project: "" }) });
  if (filters.employee) chips.push({ key: "employee", label: `Employee: ${nameOf(opts?.employees, filters.employee)}`, clear: () => set({ employee: "" }) });
  if (filters.owner) chips.push({ key: "owner", label: `Sales owner: ${nameOf(opts?.owners, filters.owner)}`, clear: () => set({ owner: "" }) });
  if (filters.month) chips.push({ key: "month", label: `Work month: ${opts?.months?.find((m) => m.key === filters.month)?.label || filters.month}`, clear: () => set({ month: "" }) });
  if (filters.waiting) chips.push({ key: "waiting", label: `Waiting ${filters.waiting}+ days`, clear: () => set({ waiting: "" }) });
  const clearAll = () => { setSearchText(""); setF({ ...EMPTY_PENDING_FILTERS, sort: filters.sort, groupBy: filters.groupBy, pageSize: filters.pageSize }); setPage(1); };

  const downloadCsv = async () => {
    setBusy(true);
    try {
      const q = { ...pendingQuery(filters, 1), format: "csv", page: undefined, limit: undefined };
      const res = await authFetch(`/api/invoices/pending-work${qs(q)}`);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const href = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = href;
      a.download = `pending-billing-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (e: any) {
      setError(e?.message || "Download failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleGroup = (key: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------ The summary line */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-subtle bg-surface-1 px-4 py-3 shadow-raised">
        <div className="min-w-0">
          <div className="text-base font-bold text-primary">
            {meta ? <><span className="tnum">{allCount}</span> piece{allCount === 1 ? "" : "s"} of work not billed yet</> : "Loading pending work…"}
          </div>
          <div className="text-xs text-secondary">
            {meta && allAmount > 0 && <>Proformas and approved sheets worth <b className="tnum text-primary">{rupee(Math.round(allAmount))}</b> · </>}
            {meta?.wait_buckets?.d30 ? <><b className="text-rose-700 dark:text-rose-300">{meta.wait_buckets.d30}</b> waiting over 30 days · </> : null}
            Work months from {meta?.data_start?.label || "the data start month"}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {filters.stages.length > 0 && (
            <button type="button" onClick={() => set({ stages: [] })}
              className="inline-flex h-8 items-center gap-1 rounded-control border border-subtle px-2.5 text-xs font-semibold text-primary hover:bg-surface-2">
              <X size={13} /> Show every step
            </button>
          )}
          <button type="button" onClick={() => setHelpOpen((o) => !o)} aria-expanded={helpOpen}
            className="inline-flex h-8 items-center gap-1 rounded-control px-2.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-surface-2">
            <HelpCircle size={14} /> How this list works
          </button>
        </div>
        {helpOpen && (
          <ol className="w-full list-decimal space-y-0.5 rounded-control bg-surface-2 py-2 pl-8 pr-3 text-xs text-secondary">
            <li><b className="text-primary">Sales</b> creates the month's timesheet, fills it and submits it.</li>
            <li>The <b className="text-primary">GM</b> approves it and raises the Proforma on a purchase order.</li>
            <li><b className="text-primary">Finance</b> checks the Proforma and issues the tax invoice — then it leaves this list.</li>
            <li>Click a lane to see only that person's work; click a step inside it to narrow further (several at once).</li>
            <li>"Waiting" counts from the day the step started — for a timesheet, the day after its month ended.</li>
          </ol>
        )}
      </div>

      {/* ------------------------------------------------ The three lanes */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        {LANES.map((lane, li) => {
          const total = lane.stages.reduce((a, s) => a + (meta?.counts?.[s]?.count || 0), 0);
          const amount = lane.stages.reduce((a, s) => a + (meta?.counts?.[s]?.amount || 0), 0);
          const laneOn = lane.stages.every((s) => filters.stages.includes(s));
          const LaneIcon = lane.icon;
          return (
            <Fragment key={lane.key}>
              {li > 0 && (
                <div aria-hidden className="hidden items-center justify-center text-muted lg:flex">
                  <ChevronRight size={22} />
                </div>
              )}
              <section className={`flex flex-col overflow-hidden rounded-card border bg-surface-1 shadow-raised transition ${
                laneOn ? "border-brand-500 ring-2 ring-brand-500/30" : "border-subtle"}`}>
                <button type="button" onClick={() => set({ stages: toggleLane(filters.stages, lane.stages) })}
                  aria-pressed={laneOn} title={laneOn ? "Show every step again" : `Show only ${lane.title.toLowerCase()}`}
                  className="flex items-center gap-3 px-3 py-3 text-left hover:bg-surface-2">
                  <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-gradient-to-br ${lane.tile} text-white shadow-sm`}>
                    <LaneIcon size={19} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-primary">{lane.title}</span>
                    <span className="block truncate text-xs text-secondary">{lane.hint}</span>
                  </span>
                  <span className="text-right">
                    <span className="block text-2xl font-bold leading-none text-primary tnum">{meta ? total : "…"}</span>
                    {amount > 0 && <span className="block text-[11px] text-secondary tnum">{rupee(Math.round(amount))}</span>}
                  </span>
                </button>
                <div className="flex flex-1 flex-col gap-1 border-t border-subtle p-2">
                  {lane.stages.map((s) => {
                    const look = STAGE_LOOK[s];
                    const c = meta?.counts?.[s];
                    const on = filters.stages.includes(s);
                    const Icon = look.icon;
                    return (
                      <button key={s} type="button" aria-pressed={on} title={look.label}
                        onClick={() => set({ stages: toggleStage(filters.stages, s) })}
                        className={`flex items-center gap-2 rounded-control px-2 py-1.5 text-left text-sm transition ${
                          on ? "bg-brand-50 font-semibold text-brand-800 ring-1 ring-brand-300 dark:bg-brand-900/30 dark:text-brand-200 dark:ring-brand-700"
                            : "text-primary hover:bg-surface-2"} ${!c?.count ? "opacity-60" : ""}`}>
                        <span className={`flex h-6 w-6 flex-none items-center justify-center rounded-md ${look.chip}`}><Icon size={13} /></span>
                        <span className="min-w-0 flex-1 truncate">{look.short}</span>
                        {c?.amount ? <span className="hidden text-[11px] text-secondary tnum sm:inline">{rupee(Math.round(c.amount))}</span> : null}
                        <span className={`min-w-[2rem] rounded-full px-2 py-0.5 text-center text-xs font-bold tnum ${
                          c?.count ? "bg-surface-2 text-primary" : "text-muted"}`}>{c ? c.count : "…"}</span>
                        {on && <Check size={14} className="text-brand-600 dark:text-brand-300" />}
                      </button>
                    );
                  })}
                </div>
              </section>
            </Fragment>
          );
        })}
      </div>

      {/* ------------------------------------------------ Find & filter */}
      <div className="space-y-3 rounded-card border border-subtle bg-surface-1 p-3 shadow-raised">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-[2]">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search an employee, Emp ID, project, customer or PI number…" aria-label="Search pending work"
              className={`${CONTROL} w-full pl-8 pr-8`} />
            {searchText && (
              <button type="button" aria-label="Clear the search" onClick={() => { setSearchText(""); set({ search: "" }); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-primary"><X size={14} /></button>
            )}
          </div>
          <select className={`${CONTROL} min-w-[160px] flex-1`} value={filters.customer} aria-label="Customer"
            onChange={(e) => set({ customer: e.target.value, branch: "", project: "" })}>
            <option value="">All customers</option>
            {(opts?.customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className={`${CONTROL} min-w-[150px] flex-1`} value={filters.employee} aria-label="Employee"
            onChange={(e) => set({ employee: e.target.value })}>
            <option value="">All employees</option>
            {(opts?.employees || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className={CONTROL} value={filters.month} aria-label="Work month"
            onChange={(e) => set({ month: e.target.value })}>
            <option value="">All work months</option>
            {(opts?.months || []).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <button type="button" onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen}
            className={`inline-flex h-9 items-center gap-1.5 rounded-control border px-3 text-sm font-semibold ${
              moreOpen || moreCount ? "border-brand-400 text-brand-700 dark:text-brand-300" : "border-subtle text-primary"} hover:bg-surface-2`}>
            <SlidersHorizontal size={14} /> More filters
            {moreCount > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] text-white">{moreCount}</span>}
            <ChevronDown size={14} className={moreOpen ? "rotate-180" : ""} />
          </button>
        </div>

        {moreOpen && (
          <div className="flex flex-wrap items-center gap-2 rounded-control bg-surface-2 p-2">
            <Building2 size={14} className="text-muted" />
            <select className={CONTROL} value={filters.branch} aria-label="Branch"
              onChange={(e) => set({ branch: e.target.value, project: "" })}>
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              {opts?.no_branch ? <option value="0">No branch on record ({opts.no_branch})</option> : null}
            </select>
            <select className={`${CONTROL} min-w-[200px] flex-1`} value={filters.project} aria-label="Project"
              onChange={(e) => set({ project: e.target.value })}>
              <option value="">All projects</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className={CONTROL} value={filters.owner} aria-label="Sales owner"
              onChange={(e) => set({ owner: e.target.value })}>
              <option value="">Any Sales owner</option>
              {(opts?.owners || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Waiting</span>
          <div className="flex flex-wrap gap-1" role="group" aria-label="How long it has waited">
            {WAIT_CHIPS.map((w) => {
              const on = filters.waiting === w.key;
              const n = w.bucket ? meta?.wait_buckets?.[w.bucket] : undefined;
              return (
                <button key={w.key || "any"} type="button" aria-pressed={on} onClick={() => set({ waiting: w.key })}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${
                    on ? "border-brand-500 bg-brand-600 text-white" : `border-subtle bg-surface-1 hover:bg-surface-2 ${w.tone || "text-primary"}`}`}>
                  {w.label}
                  {n != null && <span className={`rounded-full px-1.5 tnum ${on ? "bg-white/25" : "bg-surface-2"}`}>{n}</span>}
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-secondary">
              Group by
              <select className={`${CONTROL} font-normal`} value={filters.groupBy} aria-label="Group by"
                onChange={(e) => { setCollapsed(new Set()); set({ groupBy: e.target.value as GroupBy }); }}>
                {GROUPS.map((g) => <option key={g.key || "none"} value={g.key}>{g.label}</option>)}
              </select>
            </label>
            {!filters.groupBy && (
              <label className="flex items-center gap-1.5 text-xs font-semibold text-secondary">
                Sort
                <select className={`${CONTROL} font-normal`} value={filters.sort} aria-label="Sort" onChange={(e) => set({ sort: e.target.value })}>
                  {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
            )}
            <button type="button" onClick={() => setReload((k) => k + 1)} title="Refresh" aria-label="Refresh"
              className="inline-flex h-9 w-9 items-center justify-center rounded-control border border-subtle hover:bg-surface-2">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
            <button type="button" onClick={downloadCsv} disabled={busy} title="Download every filtered row"
              className="inline-flex h-9 items-center gap-1 rounded-control border border-subtle px-3 text-sm font-semibold text-primary hover:bg-surface-2 disabled:opacity-60">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} CSV
            </button>
          </div>
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-subtle pt-2">
            <Filter size={13} className="text-muted" />
            {chips.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-2.5 pr-1 text-xs font-semibold text-brand-800 dark:bg-brand-900/30 dark:text-brand-200">
                {c.label}
                <button type="button" onClick={c.clear} aria-label={`Remove ${c.label}`}
                  className="rounded-full p-0.5 hover:bg-brand-100 dark:hover:bg-brand-800/50"><X size={12} /></button>
              </span>
            ))}
            {active > 1 && (
              <button type="button" onClick={clearAll} className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center justify-between gap-2 rounded-card border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          <span>{error}</span>
          <button type="button" onClick={() => setReload((k) => k + 1)} className="font-semibold underline">Try again</button>
        </div>
      )}

      {/* ------------------------------------------------ The list */}
      <div className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
        {meta && rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-3 py-2 text-xs text-secondary">
            <span>
              Showing <b className="text-primary tnum">{firstShown}–{lastShown}</b> of <b className="text-primary tnum">{meta.total}</b>
              {meta.amount ? <> · <b className="text-primary tnum">{rupee(Math.round(meta.amount))}</b> in Proformas and approved sheets</> : null}
            </span>
            <span>{filters.groupBy ? `Grouped by ${GROUPS.find((g) => g.key === filters.groupBy)?.label.toLowerCase()}, longest waiting first`
              : `Sorted: ${SORTS.find((s) => s.key === filters.sort)?.label.toLowerCase()}`}</span>
          </div>
        )}
        {loading && !rows.length ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-secondary"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : !rows.length ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <CheckCircle2 size={30} className="text-emerald-500" />
            <p className="font-semibold text-primary">{active || filters.stages.length ? "Nothing matches these filters" : "Nothing pending — every timesheet is billed"}</p>
            {(active > 0 || filters.stages.length > 0) && (
              <button type="button" className="text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300"
                onClick={() => { setSearchText(""); setF({ ...EMPTY_PENDING_FILTERS, groupBy: filters.groupBy, pageSize: filters.pageSize }); setPage(1); }}>
                Clear every filter
              </button>
            )}
          </div>
        ) : (
          <div className={`overflow-x-auto transition-opacity ${loading ? "opacity-60" : ""}`}>
            <table className="w-full min-w-[1040px] text-sm">
              <thead className="bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Employee · month</th>
                  <th className="px-3 py-2">Project · customer</th>
                  <th className="px-3 py-2">Where it stands</th>
                  <th className="px-3 py-2">Work &amp; billing</th>
                  <th className="px-3 py-2">Waiting</th>
                  <th className="px-3 py-2 text-right">Next step</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {groups.map((g) => {
                  const closed = collapsed.has(g.key);
                  return (
                    <Fragment key={g.key}>
                      {filters.groupBy && (
                        <tr className="bg-surface-2/70">
                          <td colSpan={6} className="px-3 py-1.5">
                            <button type="button" onClick={() => toggleGroup(g.key)} aria-expanded={!closed}
                              className="flex w-full items-center gap-2 text-left">
                              <ChevronDown size={15} className={`text-muted transition ${closed ? "-rotate-90" : ""}`} />
                              <span className="font-bold text-primary">{g.label}</span>
                              {g.sub && <span className="truncate text-xs text-muted">{g.sub}</span>}
                              <span className="rounded-full bg-surface-1 px-2 py-0.5 text-xs font-semibold text-secondary tnum">{g.rows.length}</span>
                              {g.amount > 0 && <span className="ml-auto text-xs font-semibold text-secondary tnum">{rupee(Math.round(g.amount))}</span>}
                            </button>
                          </td>
                        </tr>
                      )}
                      {!closed && g.rows.map((r) => <PendingTableRow key={r.key} r={r} can={meta?.can} />)}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {meta && meta.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-subtle px-3 py-2 text-xs text-secondary">
            <label className="flex items-center gap-1.5">
              Rows per page
              <select className={`${CONTROL} !h-8`} value={filters.pageSize} aria-label="Rows per page"
                onChange={(e) => set({ pageSize: Number(e.target.value) })}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            {pages > 1 && (
              <span className="flex items-center gap-1">
                <button type="button" disabled={page <= 1} onClick={() => setPage(1)}
                  className="h-8 rounded-control border border-subtle px-2.5 font-semibold disabled:opacity-50 hover:bg-surface-2">First</button>
                <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}
                  className="h-8 rounded-control border border-subtle px-2.5 font-semibold disabled:opacity-50 hover:bg-surface-2">Previous</button>
                <span className="px-2">Page <b className="text-primary">{page}</b> of {pages}</span>
                <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}
                  className="h-8 rounded-control border border-subtle px-2.5 font-semibold disabled:opacity-50 hover:bg-surface-2">Next</button>
                <button type="button" disabled={page >= pages} onClick={() => setPage(pages)}
                  className="h-8 rounded-control border border-subtle px-2.5 font-semibold disabled:opacity-50 hover:bg-surface-2">Last</button>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PendingTableRow({ r, can }: { r: PendingRow; can?: Meta["can"] }) {
  const look = STAGE_LOOK[r.stage];
  const act = rowAction(r, can);
  const wait = waitText(r.waiting_days);
  const { blocked } = stepOf(r.stage);
  return (
    <tr className="align-top hover:bg-surface-2/60">
      <td className="px-3 py-3">
        <div className="flex items-start gap-2.5">
          <span aria-hidden className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-indigo-600 text-xs font-bold text-white">
            {initials(r.employee)}
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-primary">{r.employee || "—"}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              {r.employee_code && <span>{r.employee_code}</span>}
              {r.month_label && (
                <span className="whitespace-nowrap rounded-full bg-teal-50 px-2 py-0.5 font-semibold text-teal-800 dark:bg-teal-950/40 dark:text-teal-200"
                  title={r.period_label ? `Timesheet period ${r.period_label}` : "The month the work was done"}>
                  {r.month_label}
                </span>
              )}
            </div>
            {r.period_label && <div className="text-[11px] text-muted">{r.period_label}</div>}
          </div>
        </div>
      </td>
      <td className="max-w-[300px] px-3 py-3">
        <div className="truncate font-medium text-primary" title={r.project || undefined}>
          {r.project_id ? <CrmLink to={`projects/${r.project_id}`} className="hover:underline">{r.project}</CrmLink> : r.project || "—"}
        </div>
        <div className="truncate text-xs text-secondary" title={[r.customer, r.branch].filter(Boolean).join(" · ")}>
          {r.customer || "—"}{r.branch ? <> · {r.branch}</> : null}
        </div>
        {r.owner && <div className="text-[11px] text-muted">Sales owner: {r.owner}</div>}
      </td>
      <td className="px-3 py-3">
        <StepRail stage={r.stage} />
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${look.chip}`}>
            <look.icon size={12} /> {look.label}
          </span>
        </div>
        <div className="mt-0.5 text-[11px] text-muted">
          {blocked ? "Sent back — " : ""}{look.who}'s move{r.part ? ` · part ${r.part}` : ""}
        </div>
        {r.note && <div className="mt-1 max-w-[280px] text-xs italic text-secondary" title={r.note}>“{r.note}”</div>}
      </td>
      <td className="px-3 py-3">
        {r.hours != null || r.billable_days != null ? (
          <div className="text-primary tnum">
            {r.hours != null && <>{r.hours} h</>}
            {r.hours != null && r.billable_days != null && <span className="text-muted"> · </span>}
            {r.billable_days != null && <>{r.billable_days} days</>}
          </div>
        ) : <div className="text-xs text-muted">No hours yet</div>}
        {r.invoice_id && (
          <CrmLink to={`invoices/${r.invoice_id}`} className="mt-0.5 inline-block text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
            {r.proforma_number || `Proforma #${r.invoice_id}`}
          </CrmLink>
        )}
        {r.po_number && <div className="text-[11px] text-muted">PO {r.po_number}</div>}
        {r.amount != null && <div className="mt-0.5 font-semibold text-primary tnum">{rupee(r.amount)}</div>}
      </td>
      <td className="px-3 py-3">
        {r.waiting_days != null ? (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${waitTone(r.waiting_days)}`}
            title={wait.sub || undefined}>{wait.main}</span>
        ) : <span className="text-muted">—</span>}
        {wait.sub && <div className="mt-0.5 text-[11px] text-muted">{wait.sub}</div>}
        {r.since_label && <div className="mt-0.5 text-[11px] text-muted">since {r.since_label}</div>}
        {r.by_name && <div className="text-[11px] text-muted">{byLabel(r.stage)} {r.by_name}</div>}
      </td>
      <td className="px-3 py-3 text-right">
        {act && (
          <CrmLink to={act.to}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-control bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-700">
            {act.label} <ArrowRight size={12} />
          </CrmLink>
        )}
        {r.stage === "returned" && r.timesheet_id && r.invoice_id && (
          <div className="mt-1">
            <CrmLink to={`invoices/${r.invoice_id}`} className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">Open Proforma</CrmLink>
          </div>
        )}
      </td>
    </tr>
  );
}
