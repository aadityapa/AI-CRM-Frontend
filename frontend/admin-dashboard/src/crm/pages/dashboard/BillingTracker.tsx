/**
 * Billing tracker on the Dashboard — Finance, Admin and CEO (20 Oct 2026, user
 * ask: "one filter that holds approved timesheets and invoices with customer &
 * month — I see an invoice approved but not showing there, same for timesheet").
 *
 * The work desk's billing tiles are to-do lists (one step of the chain each,
 * inside a time window). This panel is the whole chain: EVERY approved
 * timesheet and EVERY invoice, one row per piece of billed work, filtered on
 * the SERVER (`GET /api/dashboard/billing`) by stage · customer · work month ·
 * search, and paged — so nothing can fall off a list.
 *
 * 24 Oct 2026 — Finance's filters: branch · project · employee · PO · Sales
 * owner · days late · invoice / due date range · amount · waiting at a stage ·
 * quick switches (overdue, TDS pending, split, no branch), behind "More filters",
 * with removable chips (`billingTrackerFilters.ts`).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowRight, CalendarRange, ChevronLeft, ChevronRight, Download, FileText, Hourglass, ListChecks,
  RefreshCw, Search, SlidersHorizontal, X,
} from "lucide-react";

import { authFetch } from "../../../api/client";
import { DESK_CHANGED_EVENT, crmGet, qs } from "../../api";
import { CrmLink } from "../../routerHooks";
import { CONTROL, FilteredBars, ICON_BTN, MiniStat, Panel, STATE_CHIP, Speedometer, Tile, inr, inrCompact, num, pct } from "../../components/controlTower";
import { semanticAnchor } from "../../../design-system/tokens/tokens";
import { useSessionState } from "../../lib/pageState";
import {
  EMPTY_FILTERS, FLAG_LABELS, LATE_LABELS, activeChips, moreFilterCount, trackerQuery, withDefaults,
  type TrackerFilters, type TrackerFlag,
} from "./billingTrackerFilters";

export type TrackerRow = {
  key: string;
  stage: string; stage_label: string; overdue: boolean;
  customer_id: number | null; customer: string | null;
  project_id: number | null; project: string | null;
  employee: string | null; employee_code: string | null;
  month: string | null; month_label: string | null; period_label: string | null;
  timesheet_id: number | null; timesheet_status: string | null;
  invoice_id: number | null; invoice_kind: "Proforma" | "Tax" | null;
  invoice_number: string | null; proforma_number: string | null;
  invoice_date: string | null; due_date: string | null;
  grand_total: number | null; balance: number | null; payment_status: string | null;
  returned_reason: string | null;
  // 24 Oct 2026
  employee_id?: number | null;
  branch_id?: number | null; branch?: string | null;
  po_id?: number | null; po_number?: string | null;
  owner_id?: number | null; owner?: string | null;
  days_late?: number | null; late_bucket?: string | null;
  waiting_days?: number | null; amount?: number | null;
  tds_pending?: number | null; split?: boolean; part_label?: string | null;
};

type Named = { id: number; name: string };

type Meta = {
  total: number; page: number; limit: number; pages: number;
  counts: Record<string, number>; amounts: Record<string, number>; overdue: number;
  stages: { key: string; label: string; open: boolean }[];
  options: {
    customers: Named[]; months: { key: string; label: string }[];
    branches?: Named[]; no_branch?: number; projects?: (Named & { customer_id?: number | null })[];
    employees?: Named[]; pos?: Named[]; owners?: Named[];
  };
  late_total?: number;
  /** 27 Oct 2026 — tiles + chart data over the same filtered rows (server `tracker_summary`). */
  summary?: TrackerSummaryData;
};

type TrackerSummaryData = {
  tiles: {
    to_raise: number; to_raise_returned: number; with_customer: number; with_customer_amount: number;
    due_amount: number; due_count: number; overdue_amount: number; overdue_count: number;
    paid_amount: number; paid_count: number; tds_pending: number; avg_wait_days: number | null;
  };
  groups: { key: string; label: string }[];
  by_month: Record<string, string | number>[];
  late: { key: string; label: string; balance: number; count: number }[];
  customers: { label: string; customer_id?: number | null; due: number; paid: number; with_customer: number }[];
};

/** What a bar of the Billing tab does (29 Oct 2026, "every graph opens its data"):
 *  it narrows the table below to exactly what the bar counted. PURE. */
export type TrackerBarPatch = { stage?: string; month?: string; late?: string; customer?: string; branch?: string; project?: string };
export function trackerBarPatch(chart: "months" | "late" | "customers", row: Record<string, unknown>, series: string): TrackerBarPatch | null {
  if (chart === "months") {
    const month = String(row.key ?? "");
    if (!month) return null;
    return { month, stage: series === "total" ? "all" : series };   // to_raise · with_customer · due · paid (a group or a stage)
  }
  if (chart === "late") {
    const late = String(row.key ?? "");
    return late ? { late, stage: "all" } : null;
  }
  const cid = row.customer_id;
  if (typeof cid !== "number") return null;
  return { customer: String(cid), branch: "", project: "", stage: series === "paid" ? "paid" : series === "due" ? "due" : "with_customer" };
}

/** The chip a stage GROUP shows while a bar has chosen it (it is not one of the stage chips). */
const GROUP_CHIP: Record<string, string> = { to_raise: "Proforma to raise / with Finance", with_customer: "With the customer", due: "Payment due" };

/** One colour per stage — chips, dots and the row badge share it. */
export const STAGE_LOOK: Record<string, { short: string; dot: string; chip: string }> = {
  awaiting_proforma: { short: "Proforma to raise", dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-500/30" },
  returned: { short: "Returned to GM", dot: "bg-rose-500",
    chip: "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-500/30" },
  proforma: { short: "Proforma with Finance", dot: "bg-orange-500",
    chip: "bg-orange-50 text-orange-800 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:ring-orange-500/30" },
  awaiting_customer: { short: "Customer to approve", dot: "bg-sky-500",
    chip: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-500/30" },
  irn_pending: { short: "IRN to add", dot: "bg-purple-500",
    chip: "bg-purple-50 text-purple-800 ring-purple-200 dark:bg-purple-950/40 dark:text-purple-200 dark:ring-purple-500/30" },
  unpaid: { short: "Payment due", dot: "bg-indigo-500",
    chip: "bg-indigo-50 text-indigo-800 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:ring-indigo-500/30" },
  partially_paid: { short: "Balance due", dot: "bg-orange-500",
    chip: "bg-orange-50 text-orange-800 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:ring-orange-500/30" },
  paid: { short: "Paid", dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-500/30" },
};

/** What the reader opens next for a row. PURE. */
export function rowLink(r: TrackerRow): { to: string; label: string } | null {
  if (r.invoice_id) return { to: `invoices/${r.invoice_id}`, label: r.invoice_kind === "Proforma" ? "Open Proforma" : "Open invoice" };
  if (r.timesheet_id) return { to: `timesheets/${r.timesheet_id}`, label: "Open timesheet" };
  return null;
}

type Filters = TrackerFilters;
const EMPTY: Filters = EMPTY_FILTERS;
const PAGE = 15;
const FLAG_KEYS = Object.keys(FLAG_LABELS) as TrackerFlag[];

export function BillingTracker() {
  const [stored, setF] = useSessionState<Filters>("dash.billing", EMPTY);
  const f = useMemo(() => withDefaults(stored), [stored]);
  const [moreOpen, setMoreOpen] = useState(() => moreFilterCount(withDefaults(stored)) > 0);
  const [amountText, setAmountText] = useState(f.amountMin);
  const [page, setPage] = useState(1);
  const [text, setText] = useState(f.search);
  const [rows, setRows] = useState<TrackerRow[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  // Free text waits for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => { if (text !== f.search) { setF({ ...f, search: text }); setPage(1); } }, 350);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    setLoading(true);
    crmGet<TrackerRow[]>(`/api/dashboard/billing${qs(trackerQuery(f, page, PAGE))}`)
      .then((res) => { if (live) { setRows(res.data || []); setMeta(res.meta as Meta); setErr(null); } })
      .catch((e: any) => { if (live) setErr(e?.message || "Could not load the billing tracker"); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [JSON.stringify(f), page, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // The amount box waits for a pause in typing too.
  useEffect(() => {
    const t = setTimeout(() => { if (amountText !== f.amountMin) { setF({ ...f, amountMin: amountText }); setPage(1); } }, 450);
    return () => clearTimeout(t);
  }, [amountText]); // eslint-disable-line react-hooks/exhaustive-deps

  // 23 Oct 2026: real time — re-read every minute while visible, when the tab
  // comes back, and after any change made in this browser.
  useEffect(() => {
    const bump = () => { if (document.visibilityState !== "hidden") setTick((t) => t + 1); };
    const timer = window.setInterval(bump, 60_000);
    const onStorage = (e: StorageEvent) => { if (e.key === DESK_CHANGED_EVENT) bump(); };
    document.addEventListener("visibilitychange", bump);
    window.addEventListener(DESK_CHANGED_EVENT, bump);
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", bump);
      window.removeEventListener(DESK_CHANGED_EVENT, bump);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const set = (patch: Partial<Filters>) => { setF({ ...f, ...patch }); setPage(1); };
  const opts = meta?.options;
  const chipsOn = useMemo(() => activeChips(f, opts || {}), [f, opts]);
  const more = moreFilterCount(f);
  const filtered = !!(f.search || chipsOn.length);
  const clearAll = () => { setText(""); setAmountText(""); setF({ ...EMPTY, stage: f.stage }); setPage(1); };
  const toggleFlag = (flag: TrackerFlag) =>
    set({ flags: f.flags.includes(flag) ? f.flags.filter((x) => x !== flag) : [...f.flags, flag] });
  const projects = (opts?.projects || []).filter((p) => !f.customer || String(p.customer_id) === f.customer);
  const chips = useMemo(() => {
    const counts = meta?.counts || {};
    return [
      { key: "open", label: "Needs action", count: counts.open },
      { key: "all", label: "All", count: counts.all },
      // 26 Oct 2026 — every generated tax invoice, newest first (the register).
      { key: "invoiced", label: "Invoices issued", count: counts.invoiced },
      // A chart bar may choose a stage GROUP; it shows as its own chip while chosen.
      ...(GROUP_CHIP[f.stage] ? [{ key: f.stage, label: GROUP_CHIP[f.stage], count: meta?.total }] : []),
      ...(meta?.stages || []).map((s) => ({ key: s.key, label: STAGE_LOOK[s.key]?.short || s.label, count: counts[s.key] })),
    ];
  }, [meta, f.stage]);
  // 29 Oct 2026 — a bar narrows the table to what it counted, then the table comes into view.
  const listRef = useRef<HTMLDivElement>(null);
  const onBar = (chart: "months" | "late" | "customers") => (row: Record<string, unknown>, series: string) => {
    const patch = trackerBarPatch(chart, row, series);
    if (!patch) return;
    set(patch);
    window.requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  // 26 Oct 2026 — "take it from there whenever they want": every row the
  // filters hold (not one page) as CSV.
  const [csvBusy, setCsvBusy] = useState(false);
  const downloadCsv = async () => {
    setCsvBusy(true);
    try {
      const res = await authFetch(`/api/dashboard/billing${qs({ ...trackerQuery(f, 1, PAGE), format: "csv" })}`);
      if (!res.ok) { setErr(`Could not download (${res.status})`); return; }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `billing-${f.stage || "all"}${f.month ? `-${f.month}` : ""}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setCsvBusy(false);
    }
  };
  const from = meta && meta.total ? (meta.page - 1) * meta.limit + 1 : 0;
  const to = meta ? Math.min(meta.total, meta.page * meta.limit) : 0;

  return (
    <section className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised" aria-label="Billing tracker">
      <header className="relative overflow-hidden bg-gradient-to-r from-indigo-600 via-blue-600 to-sky-500 px-5 py-4 text-[#fff]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-[#fff]/15 ring-1 ring-[#fff]/25">
              <ListChecks className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#fff]/75">Timesheets · Proformas · Invoices</div>
              <h2 className="text-lg font-bold leading-tight">Billing tracker</h2>
              <p className="text-xs text-[#fff]/80">Every approved timesheet and invoice — by customer and the month the work was done.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {meta?.overdue ? (
              <button type="button" onClick={() => toggleFlag("overdue")} title="Show only the overdue rows"
                className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/90 px-3 py-1 text-xs font-bold hover:bg-rose-500">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {meta.overdue} overdue
                {meta.late_total ? <span className="font-semibold text-[#fff]/90">· {inrCompact(meta.late_total)}</span> : null}
              </button>
            ) : null}
            <button type="button" onClick={downloadCsv} disabled={csvBusy} title="Download every row these filters hold (CSV)"
              className="inline-flex h-9 items-center gap-1.5 rounded-control bg-[#fff]/15 px-3 text-xs font-semibold ring-1 ring-[#fff]/25 hover:bg-[#fff]/25 disabled:opacity-60">
              <Download className="h-4 w-4" aria-hidden /> {csvBusy ? "Preparing…" : "Download CSV"}
            </button>
            <button type="button" onClick={() => setTick((n) => n + 1)} title="Refresh"
              className="inline-flex h-9 w-9 items-center justify-center rounded-control bg-[#fff]/15 ring-1 ring-[#fff]/25 hover:bg-[#fff]/25">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            </button>
          </div>
        </div>
      </header>

      {meta?.summary && (
        <TrackerSummary s={meta.summary} stage={f.stage} flags={f.flags}
          onStage={(stage) => set({ stage })}
          onOverdue={() => { if (!f.flags.includes("overdue")) toggleFlag("overdue"); }}
          onTds={() => { if (!f.flags.includes("tds_pending")) toggleFlag("tds_pending"); }}
          onBar={onBar} />
      )}

      <div ref={listRef} className="scroll-mt-4 space-y-3 border-b border-subtle px-5 py-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Billing stage">
          {chips.map((c) => {
            const on = f.stage === c.key;
            const look = STAGE_LOOK[c.key];
            return (
              <button key={c.key} type="button" role="tab" aria-selected={on} onClick={() => set({ stage: c.key })}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-micro ${on
                  ? "border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200"
                  : "border-subtle bg-surface-1 text-secondary hover:bg-surface-2"}`}>
                {look && <span className={`h-2 w-2 rounded-full ${look.dot}`} aria-hidden />}
                {c.label}
                <span className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums ${on ? "bg-brand-600 text-[#fff]" : "bg-surface-2 text-muted"}`}>
                  {c.count ?? "…"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Search</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <input type="text" value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Employee, invoice / PI no., project…" className={`${CONTROL} w-64 pl-8`} />
          </label>
          <select className={`${CONTROL} w-56`} value={f.customer}
            onChange={(e) => set({ customer: e.target.value, branch: "", project: "" })}
            aria-label="Customer">
            <option value="">All customers</option>
            {(meta?.options.customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className={`${CONTROL} w-44`} value={f.month} onChange={(e) => set({ month: e.target.value })}
            aria-label="Work month">
            <option value="">All months</option>
            {(meta?.options.months || []).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <select className={`${CONTROL} w-44`} value={f.late} onChange={(e) => set({ late: e.target.value })}
            aria-label="Days late">
            <option value="">Any due status</option>
            {Object.entries(LATE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button type="button" onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen}
            className={`inline-flex h-9 items-center gap-1.5 rounded-control border px-3 text-xs font-semibold transition-colors duration-micro ${moreOpen || more
              ? "border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200"
              : "border-subtle bg-surface-1 text-secondary hover:bg-surface-2"}`}>
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> More filters
            {more > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-[#fff]">{more}</span>}
          </button>
          {filtered && (
            <button type="button" onClick={clearAll}
              className="inline-flex h-9 items-center gap-1 rounded-control px-2.5 text-xs font-semibold text-secondary hover:bg-surface-2">
              <X className="h-3.5 w-3.5" aria-hidden /> Clear filters
            </button>
          )}
          <span className="ml-auto text-xs text-muted">
            {meta ? <>{meta.total} row{meta.total === 1 ? "" : "s"}{f.stage !== "all" && f.stage !== "open" && meta.amounts?.[f.stage]
              ? <> · {inrCompact(meta.amounts[f.stage])}</> : null}</> : null}
          </span>
        </div>

        {moreOpen && (
          <div className="grid gap-3 rounded-card border border-subtle bg-surface-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterField label="Branch">
              <select className={`${CONTROL} w-full`} value={f.branch} onChange={(e) => set({ branch: e.target.value })}>
                <option value="">All branches</option>
                {(opts?.no_branch || 0) > 0 && <option value="0">No branch on record ({opts?.no_branch})</option>}
                {(opts?.branches || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </FilterField>
            <FilterField label="Project">
              <select className={`${CONTROL} w-full`} value={f.project} onChange={(e) => set({ project: e.target.value })}>
                <option value="">All projects</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FilterField>
            <FilterField label="Employee">
              <select className={`${CONTROL} w-full`} value={f.employee} onChange={(e) => set({ employee: e.target.value })}>
                <option value="">All employees</option>
                {(opts?.employees || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </FilterField>
            <FilterField label="Purchase order">
              <select className={`${CONTROL} w-full`} value={f.po} onChange={(e) => set({ po: e.target.value })}>
                <option value="">All POs</option>
                <option value="0">No PO</option>
                {(opts?.pos || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </FilterField>
            <FilterField label="Sales owner (raised the deal)">
              <select className={`${CONTROL} w-full`} value={f.owner} onChange={(e) => set({ owner: e.target.value })}>
                <option value="">Everyone</option>
                {(opts?.owners || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </FilterField>
            <FilterField label="Date range">
              <div className="flex flex-wrap items-center gap-1.5">
                <select className={`${CONTROL} w-28`} value={f.dateField}
                  onChange={(e) => set({ dateField: e.target.value === "due" ? "due" : "invoice" })} aria-label="Which date">
                  <option value="invoice">Invoiced</option>
                  <option value="due">Due</option>
                </select>
                <input type="date" className={`${CONTROL} w-36`} value={f.dateFrom} max={f.dateTo || undefined}
                  onChange={(e) => set({ dateFrom: e.target.value })} aria-label="From" />
                <input type="date" className={`${CONTROL} w-36`} value={f.dateTo} min={f.dateFrom || undefined}
                  onChange={(e) => set({ dateTo: e.target.value })} aria-label="To" />
              </div>
            </FilterField>
            <FilterField label="Amount at least (₹)">
              <input type="number" min={0} inputMode="numeric" className={`${CONTROL} w-full`} value={amountText}
                placeholder="e.g. 100000" onChange={(e) => setAmountText(e.target.value)} />
            </FilterField>
            <FilterField label="Waiting at this stage">
              <div className="flex flex-wrap gap-1">
                {["", "3", "7", "15", "30"].map((d) => (
                  <button key={d || "any"} type="button" onClick={() => set({ waitingMin: d })}
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${f.waitingMin === d
                      ? "border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200"
                      : "border-subtle bg-surface-1 text-secondary hover:bg-surface-2"}`}>
                    {d ? `${d}+ days` : "Any"}
                  </button>
                ))}
              </div>
            </FilterField>
            <div className="sm:col-span-2 lg:col-span-4">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Quick switches</div>
              <div className="flex flex-wrap gap-1.5">
                {FLAG_KEYS.map((flag) => {
                  const on = f.flags.includes(flag);
                  return (
                    <button key={flag} type="button" aria-pressed={on} onClick={() => toggleFlag(flag)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${on
                        ? "border-brand-500 bg-brand-600 text-[#fff]"
                        : "border-subtle bg-surface-1 text-secondary hover:bg-surface-2"}`}>
                      {FLAG_LABELS[flag]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {chipsOn.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {chipsOn.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
                {c.label}
                <button type="button" onClick={() => { if ("amountMin" in c.clear) setAmountText(""); set(c.clear); }}
                  aria-label={`Remove ${c.label}`} className="rounded-full p-0.5 hover:bg-brand-100 dark:hover:bg-brand-800/60">
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {err ? (
        <p className="px-5 py-6 text-sm font-semibold text-danger">{err}</p>
      ) : !loading && rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted">
          Nothing here{filtered ? " for these filters" : ""}.
          {filtered && <> <button type="button" className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
            onClick={() => { setText(""); setAmountText(""); setF({ ...EMPTY, stage: "all" }); setPage(1); }}>Show everything</button></>}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-surface-2 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
              <tr>
                <th className="px-5 py-2">Work month</th>
                <th className="px-3 py-2">Customer · project</th>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Document</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Where it stands</th>
                <th className="px-5 py-2 text-right"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody className={`divide-y divide-[var(--border-subtle)] ${loading ? "opacity-60" : ""}`}>
              {rows.map((r) => <TrackerRowView key={r.key} r={r} />)}
            </tbody>
          </table>
        </div>
      )}

      {meta && meta.total > meta.limit && (
        <footer className="flex items-center justify-between gap-2 border-t border-subtle px-5 py-2.5 text-xs text-secondary">
          <span>Showing {from}–{to} of {meta.total}</span>
          <div className="flex items-center gap-1">
            <button type="button" className={ICON_BTN} disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <span className="px-2 font-semibold tabular-nums">{meta.page} / {meta.pages}</span>
            <button type="button" className={ICON_BTN} disabled={page >= meta.pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}

function TrackerRowView({ r }: { r: TrackerRow }) {
  const look = STAGE_LOOK[r.stage] || STAGE_LOOK.paid;
  const link = rowLink(r);
  return (
    <tr className="row-hover align-top">
      <td className="px-5 py-2.5">
        <div className="inline-flex items-center gap-1.5 font-semibold text-primary">
          <CalendarRange className="h-3.5 w-3.5 text-muted" aria-hidden /> {r.month_label || "—"}
        </div>
        {r.period_label && (
          <div className="mt-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300" title="Timesheet period">{r.period_label}</div>
        )}
      </td>
      <td className="px-3 py-2.5">
        {r.customer_id ? (
          <CrmLink to={`customers/${r.customer_id}`} className="font-semibold text-primary hover:underline">{r.customer || "—"}</CrmLink>
        ) : <span className="font-semibold text-primary">{r.customer || "—"}</span>}
        <div className="text-xs text-muted">{r.project || "—"}{r.branch ? ` · ${r.branch}` : ""}</div>
        {r.owner && <div className="text-[11px] text-muted">Sales: {r.owner}</div>}
      </td>
      <td className="px-3 py-2.5">
        <div className="text-primary">{r.employee || <span className="text-muted">Manual invoice</span>}</div>
        {r.employee_code && <div className="text-xs text-muted">{r.employee_code}</div>}
      </td>
      <td className="px-3 py-2.5">
        {r.invoice_id ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-muted" aria-hidden />
            <CrmLink to={`invoices/${r.invoice_id}`} className="font-semibold text-brand-600 hover:underline dark:text-brand-300">
              {r.invoice_number}
            </CrmLink>
            {r.invoice_kind === "Proforma" && (
              <span className="rounded-full bg-orange-100 px-1.5 text-[10px] font-bold text-orange-800 dark:bg-orange-950/50 dark:text-orange-200">PI</span>
            )}
          </div>
        ) : <span className="text-xs text-muted">{r.part_label || "No invoice yet"}</span>}
        {r.invoice_id && r.part_label && <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">{r.part_label}</div>}
        {r.po_number && <div className="text-[11px] text-muted">PO {r.po_number}</div>}
        {r.timesheet_id && (
          <CrmLink to={`timesheets/${r.timesheet_id}`} className="mt-0.5 block text-xs text-secondary hover:underline">
            Timesheet · approved
          </CrmLink>
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {r.grand_total != null ? <div className="font-semibold text-primary">{inr(r.grand_total)}</div>
          : r.amount ? <div className="font-semibold text-amber-700 dark:text-amber-300">{inr(r.amount)}</div>
          : <span className="text-muted">—</span>}
        {r.tds_pending ? <div className="text-[11px] text-amber-700 dark:text-amber-300">TDS {inr(r.tds_pending)} pending</div> : null}
        {r.balance != null && r.balance > 0 && r.invoice_kind === "Tax" && r.balance !== r.grand_total && (
          <div className="text-[11px] text-muted">{inr(r.balance)} open</div>
        )}
      </td>
      <td className="px-3 py-2.5">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${look.chip}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${look.dot}`} aria-hidden /> {look.short}
        </span>
        {r.days_late != null && r.days_late > 0 ? (
          <span className="ml-1.5 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-[#fff]" title={r.due_date ? `Due ${r.due_date}` : "30 days from the invoice date"}>
            {r.days_late} d late
          </span>
        ) : r.overdue ? <span className="ml-1.5 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-[#fff]">Overdue</span> : null}
        {r.waiting_days != null && r.waiting_days > 0 && (
          <div className={`mt-1 inline-flex items-center gap-1 text-[11px] ${r.waiting_days >= 7 ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted"}`}>
            <Hourglass className="h-3 w-3" aria-hidden /> {r.waiting_days} d at this stage
          </div>
        )}
        {r.returned_reason && <div className="mt-1 max-w-[16rem] text-[11px] text-rose-700 dark:text-rose-300" title={r.returned_reason}>“{r.returned_reason}”</div>}
      </td>
      <td className="px-5 py-2.5 text-right">
        {link && (
          <CrmLink to={link.to} className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
            {link.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </CrmLink>
        )}
      </td>
    </tr>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">{label}</div>
      {children}
    </div>
  );
}


/* ---------- 27 Oct 2026 — the tab reads like the other CEO tabs: tiles, then bars ---------- */

const GROUP_COLOR: Record<string, string> = {
  to_raise: semanticAnchor.warning, with_customer: "#0ea5e9", due: semanticAnchor.danger, paid: semanticAnchor.success,
};

type Tone3 = "ok" | "warn" | "bad" | "none";
const chipOf = (state: Tone3, text: string) => <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATE_CHIP[state]}`}>{text}</span>;

/** PURE (exported for the test): the three dial figures of the Billing tab, from the tiles. */
export function trackerDials(t: TrackerSummaryData["tiles"]) {
  const pipeline = t.paid_amount + t.due_amount + t.with_customer_amount;
  const collectedPct = pipeline > 0 ? (t.paid_amount / pipeline) * 100 : null;
  const overduePct = t.due_amount > 0 ? (t.overdue_amount / t.due_amount) * 100 : null;
  const collectedState: Tone3 = collectedPct === null ? "none" : collectedPct >= 70 ? "ok" : collectedPct >= 50 ? "warn" : "bad";
  const overdueState: Tone3 = overduePct === null ? "none" : overduePct <= 20 ? "ok" : overduePct <= 40 ? "warn" : "bad";
  const waitState: Tone3 = t.avg_wait_days === null ? "none" : t.avg_wait_days <= 7 ? "ok" : t.avg_wait_days <= 15 ? "warn" : "bad";
  return { pipeline, collectedPct, overduePct, collectedState, overdueState, waitState };
}

/**
 * The Billing tab in the Finance tab's reading order (28 Oct 2026, CEO ask):
 * tiles → "How the work moved" (the first chart) → three dials → two bar charts,
 * every chart grouped columns with series AND row ticks — nothing stacked.
 */
function TrackerSummary({ s, stage, flags, onStage, onOverdue, onTds, onBar }: {
  s: TrackerSummaryData; stage: string; flags: string[];
  onStage: (stage: string) => void; onOverdue: () => void; onTds: () => void;
  onBar?: (chart: "months" | "late" | "customers") => (row: Record<string, unknown>, series: string) => void;
}) {
  const hint = "Click a bar to list those rows below";
  const t = s.tiles;
  const dial = trackerDials(t);
  const groupSeries = [
    ...s.groups.map((g) => ({ key: g.key, label: g.label, color: GROUP_COLOR[g.key] })),
    { key: "total", label: "All work", color: "#64748b", defaultOff: true },
  ];
  const byMonth = s.by_month.map((r) => ({
    ...r, total: s.groups.reduce((a, g) => a + (Number(r[g.key]) || 0), 0),
  }));
  const tdsOn = flags.includes("tds_pending"), overdueOn = flags.includes("overdue");
  return (
    <div className="space-y-4 border-b border-subtle bg-surface-2 px-5 py-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Proforma to raise" value={num(t.to_raise)} tone="warning" onClick={() => onStage("awaiting_proforma")}
          active={stage === "awaiting_proforma"} title="Show these rows"
          sub={t.to_raise_returned ? `${t.to_raise_returned} returned to the GM` : "approved sheets / with Finance"} />
        <Tile label="With the customer" value={inrCompact(t.with_customer_amount)} tone="brand" onClick={() => onStage("awaiting_customer")}
          active={stage === "awaiting_customer"} title="Show these rows"
          sub={`${num(t.with_customer)} invoices — approval or IRN pending`} />
        <Tile label="Payment due" value={inrCompact(t.due_amount)} tone="brand" onClick={() => onStage("unpaid")}
          active={stage === "unpaid"} title="Show these rows" sub={`${num(t.due_count)} open invoices`} />
        <Tile label="Overdue" value={inrCompact(t.overdue_amount)} tone={t.overdue_amount > 0 ? "danger" : "success"} onClick={onOverdue}
          active={overdueOn} title="Show only the overdue rows" sub={`${num(t.overdue_count)} past the due date`} />
        <Tile label="Paid" value={inrCompact(t.paid_amount)} tone="success" onClick={() => onStage("paid")}
          active={stage === "paid"} title="Show these rows" sub={`${num(t.paid_count)} invoices settled`} />
        <Tile label="TDS from clients" value={inrCompact(t.tds_pending)} tone="neutral" onClick={onTds}
          active={tdsOn} title="Show only rows with TDS pending" sub="certificate (Form 16A) pending" />
      </div>

      {/* 1 · How the work moved — the first chart, like Finance's "How the year unfolded". */}
      <Panel title="How the work moved, month by month" hint="pieces of billed work per work month, by where each stands now — tick what to compare">
        {byMonth.length ? (
          <FilteredBars data={byMonth} series={groupSeries} rowFilter rowLabel="Months" format={(v) => num(v)}
            onBarClick={onBar?.("months")} clickHint={hint} />
        ) : <p className="text-sm text-muted">Nothing billed for these filters.</p>}
      </Panel>

      {/* 2 · The dials: collected · overdue · waiting. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Collected" hint="paid ÷ (paid + payment due + with the customer)"
               action={chipOf(dial.collectedState, pct(dial.collectedPct, 0))}>
          <Speedometer value={dial.collectedPct ?? 0} max={100} marker={70} markerLabel="goal" state={dial.collectedState}
                       label="Collected share" caption="collected" format={(v) => `${Math.round(v)}%`} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat k="Paid" v={inrCompact(t.paid_amount)} tone="ok" />
            <MiniStat k="Still to come in" v={inrCompact(t.due_amount + t.with_customer_amount)} tone={t.due_amount ? "warn" : "ok"} />
          </div>
        </Panel>
        <Panel title="Overdue" hint="overdue ÷ payment due — lower is better"
               action={chipOf(dial.overdueState, pct(dial.overduePct, 0))}>
          <Speedometer value={dial.overduePct ?? 0} max={100} marker={20} markerLabel="limit" state={dial.overdueState} invert
                       label="Overdue share" caption="of payment due" format={(v) => `${Math.round(v)}%`} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat k="Overdue" v={inrCompact(t.overdue_amount)} tone={t.overdue_amount ? "bad" : "ok"} hint={`${num(t.overdue_count)} invoices`} />
            <MiniStat k="Payment due" v={inrCompact(t.due_amount)} hint={`${num(t.due_count)} invoices`} />
          </div>
        </Panel>
        <Panel title="Waiting at a stage" hint="average days each open item has sat at its current step"
               action={chipOf(dial.waitState, t.avg_wait_days === null ? "—" : `${t.avg_wait_days} d`)}>
          <Speedometer value={t.avg_wait_days ?? 0} max={30} marker={7} markerLabel="goal" state={dial.waitState} invert
                       label="Average wait" caption="days" format={(v) => `${Math.round(v)} d`} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat k="Proforma to raise" v={num(t.to_raise)} tone={t.to_raise ? "warn" : "ok"} />
            <MiniStat k="With the customer" v={num(t.with_customer)} />
          </div>
        </Panel>
      </div>

      {/* 3 · Where the money is — two bar charts with their own ticks. */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="How late the open money is" hint="balance by days past the due date"
               action={t.overdue_amount > 0 ? chipOf("bad", `${inrCompact(t.overdue_amount)} overdue`) : chipOf("ok", "Nothing overdue")}>
          <FilteredBars data={s.late} rowFilter rowLabel="Buckets" height={220} format={(v) => inrCompact(v)}
            onBarClick={onBar?.("late")} clickHint={hint}
            series={[{ key: "balance", label: "Balance", color: semanticAnchor.danger },
              { key: "count", label: "Invoices", color: "#94a3b8", defaultOff: true }]} />
        </Panel>
        <Panel title="Customers — due, with them, paid" hint="the ten largest customers in these filters">
          {s.customers.length ? (
            <FilteredBars data={s.customers} rowFilter rowLabel="Customers" height={220} format={(v) => inrCompact(v)}
              onBarClick={onBar?.("customers")} clickHint={hint}
              series={[{ key: "due", label: "Payment due", color: semanticAnchor.danger },
                { key: "with_customer", label: "With the customer", color: "#0ea5e9" },
                { key: "paid", label: "Paid", color: semanticAnchor.success }]} />
          ) : <p className="text-sm text-muted">No customers in these filters.</p>}
        </Panel>
      </div>
    </div>
  );
}
