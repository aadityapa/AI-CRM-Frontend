/** Financial Reports — three tabs:
 *  · Profit — what we billed, what the people cost, what is left, by customer /
 *    project / employee (GET /api/reports/revenue, the SAME figures as the
 *    Revenue page and the CEO dashboard's Finance tab).
 *  · Who owes us — receivables by how LATE the money is
 *    (GET /api/finance/reports/receivables; Proformas never counted).
 *  · Customer ledger — every invoice, payment, TDS and credit note with a
 *    running balance (GET /api/finance/reports/customer-ledger).
 * Access (server-side): Finance reads + sets targets; Sales / Sales Head
 * (and the Sales Manager) read; Admin / CEO everything. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ChevronDown, ChevronRight, FileDown, Info, LineChart, RefreshCw, Search,
} from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { crmGet, qs } from "../api";
import {
  EmptyState, ErrorBox, Spinner, Tabs, btnSecondary, inputCls, useToast,
} from "../components/ui";
import {
  CONTROL, DateStepper, FilteredBars, ICON_BTN, Panel, PeriodSwitcher, Tile,
  inrCompact, pct, periodMeta, shiftMonthKey, thisMonthKey, type PeriodKind,
} from "../components/controlTower";
import { usePageTab } from "../lib/pageState";
import { CrmLink } from "../routerHooks";

/** Full rupees with paise — for ledgers, where every paisa has to reconcile. */
const inr2 = (v?: number | null) =>
  v == null ? "—" : `₹ ${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Whole rupees — for management tables. */
const rupees = (v?: number | null) =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtDay = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;   // no formula injection
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* =================================================================== Profit */

type ProfitRow = {
  key: string; name: string; sub?: string | null; to?: string;
  billed: number; cost: number; margin: number; margin_pct: number | null; heads?: number;
};
type ProfitData = {
  label: string; short_label: string; period: PeriodKind; period_start: string; period_end: string;
  headline: { billed: number; gst: number; collected: number; outstanding: number; invoices: number };
  margin: {
    billed: number; cost: number; gross_margin: number; gross_margin_pct: number | null; heads_without_ctc: number;
    by_customer: MarginRaw[]; customers?: MarginRaw[];
  };
  by_project: { rows: ProjectRaw[]; heads_without_ctc: number };
  by_employee: { rows: EmployeeRaw[]; unlinked_billed: number; idle_count: number; idle_cost: number };
};
type MarginRaw = { customer_id: number | null; customer: string; billed: number; cost: number; margin: number; margin_pct: number | null; heads: number };
type ProjectRaw = { project_id: number; project: string; customer: string | null; billed: number; cost: number; margin: number; margin_pct: number | null; heads: number };
type EmployeeRaw = { employee_id: number; employee: string; employee_code: string | null; customer: string | null; project: string | null; billed: number; cost: number; margin: number; margin_pct: number | null };

type ProfitView = "customer" | "project" | "employee";
const PROFIT_VIEWS: { key: ProfitView; label: string }[] = [
  { key: "customer", label: "By customer" },
  { key: "project", label: "By project" },
  { key: "employee", label: "By employee" },
];
type ProfitSort = "billed" | "profit_high" | "profit_low" | "margin_low";

/** The three tables read three server lists; one row shape keeps them in one table. */
export function profitRows(data: ProfitData, view: ProfitView): ProfitRow[] {
  if (view === "customer") {
    return (data.margin.customers ?? data.margin.by_customer).map((r) => ({
      key: `c${r.customer_id ?? r.customer}`, name: r.customer, heads: r.heads,
      to: r.customer_id ? `customers/${r.customer_id}` : undefined,
      billed: r.billed, cost: r.cost, margin: r.margin, margin_pct: r.margin_pct,
    }));
  }
  if (view === "project") {
    return data.by_project.rows.map((r) => ({
      key: `p${r.project_id}`, name: r.project, sub: r.customer, heads: r.heads, to: `projects/${r.project_id}`,
      billed: r.billed, cost: r.cost, margin: r.margin, margin_pct: r.margin_pct,
    }));
  }
  return data.by_employee.rows.map((r) => ({
    key: `e${r.employee_id}`, name: r.employee,
    sub: [r.employee_code, r.customer, r.project].filter(Boolean).join(" · ") || null,
    to: `employees/${r.employee_id}`,
    billed: r.billed, cost: r.cost, margin: r.margin, margin_pct: r.margin_pct,
  }));
}

export function sortProfitRows(rows: ProfitRow[], sort: ProfitSort): ProfitRow[] {
  const out = [...rows];
  if (sort === "profit_high") out.sort((a, b) => b.margin - a.margin);
  else if (sort === "profit_low") out.sort((a, b) => a.margin - b.margin);
  else if (sort === "margin_low") out.sort((a, b) => (a.margin_pct ?? 1e9) - (b.margin_pct ?? 1e9));
  else out.sort((a, b) => b.billed - a.billed);
  return out;
}

const MAX_CHART_ROWS = 12;

function ProfitTab() {
  const [period, setPeriod] = useState<PeriodKind>("month");
  const [month, setMonth] = useState(thisMonthKey());
  const [data, setData] = useState<ProfitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<ProfitView>("customer");
  const [sort, setSort] = useState<ProfitSort>("billed");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await crmGet<ProfitData>(`/api/reports/revenue${qs({ month, period })}`);
      setData(res.data);
    } catch (e: any) {
      setError(e?.message || "Could not load the profit figures");
    } finally {
      setLoading(false);
    }
  }, [month, period]);
  useEffect(() => { void load(); }, [load]);

  const atCurrent = shiftMonthKey(month, periodMeta(period).months) > thisMonthKey();
  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const all = profitRows(data, view).filter((r) =>
      !q || r.name.toLowerCase().includes(q) || (r.sub ?? "").toLowerCase().includes(q));
    return sortProfitRows(all, sort);
  }, [data, view, sort, search]);
  const totals = useMemo(() => rows.reduce(
    (t, r) => ({ billed: t.billed + r.billed, cost: t.cost + r.cost, margin: t.margin + r.margin }),
    { billed: 0, cost: 0, margin: 0 },
  ), [rows]);
  const chart = useMemo(() => [...rows].sort((a, b) => b.billed - a.billed).slice(0, MAX_CHART_ROWS)
    .map((r) => ({ label: r.name, billed: r.billed, cost: r.cost, profit: r.margin })), [rows]);
  const lossCount = rows.filter((r) => r.margin < 0).length;

  const exportCsv = () => {
    if (!data) return;
    const what = PROFIT_VIEWS.find((v) => v.key === view)?.label.replace("By ", "") ?? view;
    downloadCsv(
      `profit-by-${what}-${data.short_label || month}.csv`,
      [what[0].toUpperCase() + what.slice(1), "Detail", "Billed (excl. GST)", "People cost", "Profit", "Margin %"],
      rows.map((r) => [r.name, r.sub ?? "", r.billed, r.cost, r.margin, r.margin_pct ?? ""]),
    );
  };

  const m = data?.margin;
  const marginTone = !m ? "neutral" : m.gross_margin < 0 ? "danger" : (m.gross_margin_pct ?? 0) < 15 ? "warning" : "success";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodSwitcher value={period} onChange={setPeriod} />
        <DateStepper
          month={month} period={period} atCurrent={atCurrent}
          onShift={(d) => setMonth((cur) => {
            const next = shiftMonthKey(cur, d);
            return next > thisMonthKey() ? thisMonthKey() : next;
          })}
          onPick={setMonth}
        />
        {data && <span className="text-sm font-semibold text-primary">{data.label}</span>}
        <button type="button" className={`${ICON_BTN} ml-auto`} onClick={load} aria-label="Refresh" title="Refresh">
          <RefreshCw className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {error ? <ErrorBox error={error} onRetry={load} /> : loading && !data ? <Spinner label="Working out the profit…" /> : data && m ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="Billed" value={inrCompact(m.billed)} sub={`${data.headline.invoices} tax invoices · excl. GST`} />
            <Tile label="People cost" value={inrCompact(m.cost)} tone="neutral" sub="Salary (CTC) of the people deployed" />
            <Tile label="Gross profit" value={inrCompact(m.gross_margin)} tone={marginTone}
                  sub={m.gross_margin < 0 ? "Billing does not cover the people" : "Billed − people cost"} />
            <Tile label="Margin" value={pct(m.gross_margin_pct)} tone={marginTone} sub="Profit as a share of billing" />
            <Tile label="Collected" value={inrCompact(data.headline.collected)} tone="success" sub="Money received in the period" />
            <Tile label="Still to collect" value={inrCompact(data.headline.outstanding)} tone="warning"
                  sub="Open invoices up to the period end" />
          </div>

          <div className="flex gap-2 rounded-card border border-subtle bg-surface-2 px-4 py-3 text-xs leading-relaxed text-secondary">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            <p>
              <b className="text-primary">How profit is worked out:</b> billed = issued tax invoices before GST (Proformas are not
              counted). People cost = each person's yearly CTC ÷ 12 for every month of the period they were deployed. Profit =
              billed − people cost. Office rent, salaries of internal staff and other overheads are <b>not</b> taken off.
              {m.heads_without_ctc > 0 && (
                <span className="ml-1 font-semibold text-warning">
                  {m.heads_without_ctc} deployed {m.heads_without_ctc === 1 ? "person has" : "people have"} no CTC on record, so
                  the cost is understated — add it on their Employee page.
                </span>
              )}
            </p>
          </div>

          <Panel
            title="Profit by"
            hint={view === "employee" && data.by_employee.unlinked_billed > 0
              ? `${rupees(data.by_employee.unlinked_billed)} was billed on manual invoices that name nobody — it is in the customer and project views, not here.`
              : "Click a name to open it. A red row loses money."}
            action={
              <div className="inline-flex h-9 items-center rounded-control border border-subtle bg-surface-2 p-0.5" role="group" aria-label="Group profit by">
                {PROFIT_VIEWS.map((v) => (
                  <button key={v.key} type="button" onClick={() => setView(v.key)} aria-pressed={view === v.key}
                    className={`h-8 whitespace-nowrap rounded-control px-3 text-xs font-semibold transition-all duration-micro ${
                      view === v.key ? "bg-surface-1 text-brand-600 shadow-raised dark:text-brand-300" : "text-secondary hover:text-primary"}`}>
                    {v.label}
                  </button>
                ))}
              </div>
            }
          >
            {chart.length > 0 && (
              <FilteredBars
                key={view}
                data={chart}
                series={[
                  { key: "billed", label: "Billed", color: 0 },
                  { key: "cost", label: "People cost", color: 3 },
                  { key: "profit", label: "Profit", color: 1 },
                ]}
                format={inrCompact}
                height={240}
                className="mb-4"
              />
            )}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[12rem] flex-1">
                <input className={`${CONTROL} w-full pl-9`} placeholder="Search…" value={search}
                       onChange={(e) => setSearch(e.target.value)} aria-label="Search the profit table" />
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
              </div>
              <select className={CONTROL} value={sort} onChange={(e) => setSort(e.target.value as ProfitSort)} aria-label="Sort">
                <option value="billed">Biggest billing first</option>
                <option value="profit_high">Most profit first</option>
                <option value="profit_low">Least profit / losses first</option>
                <option value="margin_low">Lowest margin % first</option>
              </select>
              {lossCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2.5 py-1 text-xs font-semibold text-danger">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {lossCount} losing money
                </span>
              )}
              <button className={btnSecondary} onClick={exportCsv} disabled={!rows.length}>
                <FileDown size={15} /> Export CSV
              </button>
            </div>
            {rows.length === 0 ? (
              <EmptyState message={search ? "Nothing matches your search." : "No billing in this period."} />
            ) : (
              <div className="max-h-[30rem] overflow-auto rounded-card border border-subtle">
                <table className="w-full min-w-max text-sm lg:min-w-0">
                  <thead className="sticky top-0 z-10 bg-surface-2">
                    <tr className="border-b border-subtle text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-3 py-2">{view === "customer" ? "Customer" : view === "project" ? "Project" : "Employee"}</th>
                      {view !== "employee" && <th className="px-3 py-2 text-right">People</th>}
                      <th className="px-3 py-2 text-right">Billed</th>
                      <th className="px-3 py-2 text-right">People cost</th>
                      <th className="px-3 py-2 text-right">Profit</th>
                      <th className="px-3 py-2 text-right">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} className={`border-b border-subtle last:border-0 hover:bg-surface-2 ${r.margin < 0 ? "bg-danger-soft/40" : ""}`}>
                        <td className="px-3 py-2">
                          {r.to ? <CrmLink to={r.to} className="font-semibold text-primary hover:text-brand-600">{r.name}</CrmLink>
                                : <span className="font-semibold text-primary">{r.name}</span>}
                          {r.sub && <div className="text-xs text-muted">{r.sub}</div>}
                        </td>
                        {view !== "employee" && <td className="px-3 py-2 text-right tabular-nums">{r.heads ?? "—"}</td>}
                        <td className="px-3 py-2 text-right tabular-nums">{rupees(r.billed)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-secondary">{rupees(r.cost)}</td>
                        <td className={`px-3 py-2 text-right font-bold tabular-nums ${r.margin < 0 ? "text-danger" : "text-success"}`}>{rupees(r.margin)}</td>
                        <td className="px-3 py-2 text-right">
                          <MarginBar value={r.margin_pct} />
                        </td>
                      </tr>
                    ))}
                    <tr className="sticky bottom-0 bg-surface-2 font-bold">
                      <td className="px-3 py-2">Total{search ? " (shown)" : ""}</td>
                      {view !== "employee" && <td />}
                      <td className="px-3 py-2 text-right tabular-nums">{rupees(totals.billed)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{rupees(totals.cost)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${totals.margin < 0 ? "text-danger" : "text-success"}`}>{rupees(totals.margin)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{totals.billed ? pct((totals.margin / totals.billed) * 100) : "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}

function MarginBar({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted">—</span>;
  const width = Math.max(0, Math.min(100, Math.abs(value)));
  const tone = value < 0 ? "bg-danger" : value < 15 ? "bg-warning" : "bg-success";
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface-3 sm:inline-block" aria-hidden>
        <span className={`block h-full ${tone}`} style={{ width: `${width}%` }} />
      </span>
      <span className={`w-14 text-right font-semibold tabular-nums ${value < 0 ? "text-danger" : "text-primary"}`}>{pct(value)}</span>
    </span>
  );
}

/* ============================================================== Who owes us */

type BucketKey = "not_due" | "late_1_30" | "late_31_60" | "late_61_90" | "late_90_plus";
type OpenInvoice = {
  id: number; invoice_number: string | null; invoice_date: string | null; month_label: string | null;
  branch_name: string | null; employee: string | null; project: string | null;
  due_date: string; days_late: number; bucket: BucketKey; outstanding: number;
};
type ReceivableRow = {
  customer_id: number; customer_name: string;
  invoiced: number; received: number; tds: number; credit_notes: number;
  outstanding: number; overdue: number; invoice_count: number; overdue_count: number; oldest_days_late: number;
  open_invoices: OpenInvoice[];
} & Record<BucketKey, number>;
type ReceivablesData = {
  as_of: string; customers: ReceivableRow[]; terms_days: number;
  totals: Record<string, number>; buckets: { key: BucketKey; label: string }[];
};

/** One colour per bucket, from calm (not due) to alarm (90+ late). */
export const BUCKET_LOOK: Record<BucketKey, { short: string; text: string; bar: string; hint: string }> = {
  not_due: { short: "Not yet due", text: "text-secondary", bar: "bg-slate-400", hint: "Still inside the payment terms — nothing to chase yet." },
  late_1_30: { short: "1–30 days late", text: "text-amber-600 dark:text-amber-400", bar: "bg-amber-400", hint: "Just past the due date — a reminder usually does it." },
  late_31_60: { short: "31–60 days late", text: "text-orange-600 dark:text-orange-400", bar: "bg-orange-500", hint: "A month late — call the customer's accounts team." },
  late_61_90: { short: "61–90 days late", text: "text-rose-600 dark:text-rose-400", bar: "bg-rose-500", hint: "Two months late — escalate to the customer's manager." },
  late_90_plus: { short: "Over 90 days late", text: "text-rose-700 dark:text-rose-300", bar: "bg-rose-700", hint: "Over three months late — the money most at risk." },
};
const BUCKET_ORDER: BucketKey[] = ["not_due", "late_1_30", "late_31_60", "late_61_90", "late_90_plus"];

function lateChip(days: number) {
  if (days <= 0) return <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs font-semibold text-secondary">Not due</span>;
  const tone = days > 90 ? "bg-danger-soft text-danger" : days > 30 ? "bg-warning-soft text-warning" : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{days} d late</span>;
}

function ReceivablesTab() {
  const [asOf, setAsOf] = useState("");
  const [data, setData] = useState<ReceivablesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [only, setOnly] = useState<BucketKey | "overdue" | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await crmGet<ReceivablesData>(`/api/finance/reports/receivables${qs({ as_of: asOf || undefined })}`);
      setData(res.data);
    } catch (e: any) {
      setError(e?.message || "Could not load the receivables");
    } finally {
      setLoading(false);
    }
  }, [asOf]);
  useEffect(() => { void load(); }, [load]);

  const customers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.customers || [])
      .filter((r) => r.outstanding > 0)
      .filter((r) => !q || r.customer_name.toLowerCase().includes(q)
        || r.open_invoices.some((i) => (i.invoice_number ?? "").toLowerCase().includes(q) || (i.employee ?? "").toLowerCase().includes(q)))
      .filter((r) => !only || (only === "overdue" ? r.overdue > 0 : r[only] > 0));
  }, [data, search, only]);

  const t = data?.totals ?? {};
  const toggle = (id: number) => setOpen((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `who-owes-us-${data.as_of}.csv`,
      ["Customer", "Invoice", "Billed month", "Employee", "Branch", "Invoice date", "Due date", "Days late",
       "Status", "Amount to collect"],
      customers.flatMap((r) => r.open_invoices.map((i) => [
        r.customer_name, i.invoice_number ?? "", i.month_label ?? "", i.employee ?? "", i.branch_name ?? "",
        i.invoice_date ?? "", i.due_date, i.days_late, BUCKET_LOOK[i.bucket]?.short ?? i.bucket, i.outstanding,
      ])),
    );
  };

  const outstanding = Number(t.outstanding || 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-secondary">
          As of
          <input type="date" className={`${inputCls} !w-40`} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <div className="relative min-w-[14rem] flex-1">
          <input className={`${inputCls} !pl-9`} placeholder="Search customer, invoice or employee…" value={search}
                 onChange={(e) => setSearch(e.target.value)} aria-label="Search receivables" />
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        </div>
        {data && (
          <button className={btnSecondary} onClick={exportCsv} disabled={!customers.length}>
            <FileDown size={15} /> Export CSV (every open invoice)
          </button>
        )}
      </div>

      {error ? <ErrorBox error={error} onRetry={load} /> : loading && !data ? <Spinner label="Working out who owes us…" /> : data ? (
        <>
          <div className="flex gap-2 rounded-card border border-subtle bg-surface-2 px-4 py-3 text-xs leading-relaxed text-secondary">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            <p>
              <b className="text-primary">How to read this:</b> every unpaid tax invoice has a due date — the date printed on it,
              or {data.terms_days} days after the invoice date when none was set. Money before that date is <b>not yet due</b>.
              After it, the columns say <b>how many days late</b> the payment is. The further right, the harder it is to collect —
              start with the red. Paid amounts, TDS the customer deducted and credit notes are already taken off.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <button type="button" onClick={() => setOnly(null)} aria-pressed={only === null}
              className={`rounded-card border p-3 text-left shadow-raised transition-colors ${only === null ? "border-brand-500 bg-brand-50 dark:bg-brand-900/30" : "border-subtle bg-surface-1 hover:bg-surface-2"}`}>
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">To collect</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-primary">{inrCompact(outstanding)}</div>
              <div className="mt-1 text-xs text-secondary">{data.customers.filter((r) => r.outstanding > 0).length} customers</div>
            </button>
            {BUCKET_ORDER.map((k) => {
              const amount = Number(t[k] || 0);
              const share = outstanding > 0 ? (amount / outstanding) * 100 : 0;
              return (
                <button key={k} type="button" onClick={() => setOnly(only === k ? null : k)} aria-pressed={only === k}
                  title={BUCKET_LOOK[k].hint}
                  className={`rounded-card border p-3 text-left shadow-raised transition-colors ${only === k ? "border-brand-500 bg-brand-50 dark:bg-brand-900/30" : "border-subtle bg-surface-1 hover:bg-surface-2"}`}>
                  <div className={`text-[11px] font-bold uppercase tracking-[0.08em] ${BUCKET_LOOK[k].text}`}>{BUCKET_LOOK[k].short}</div>
                  <div className="mt-1 text-xl font-bold tabular-nums text-primary">{inrCompact(amount)}</div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                    <div className={`h-full ${BUCKET_LOOK[k].bar}`} style={{ width: `${share}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-secondary">{pct(share, 0)} of the total</div>
                </button>
              );
            })}
          </div>

          {only && (
            <div className="flex items-center gap-2 text-xs text-secondary">
              Showing customers with money {only === "overdue" ? "overdue" : `“${BUCKET_LOOK[only].short.toLowerCase()}”`}.
              <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => setOnly(null)}>Show all</button>
            </div>
          )}

          {customers.length === 0 ? (
            <EmptyState message={search || only ? "No customer matches." : "Nothing to collect — every invoice up to this date is settled."} />
          ) : (
            <div className="overflow-x-auto rounded-card border border-subtle">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="border-b border-subtle bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2 text-right">To collect</th>
                    {BUCKET_ORDER.map((k) => (
                      <th key={k} className={`px-3 py-2 text-right ${BUCKET_LOOK[k].text}`} title={BUCKET_LOOK[k].hint}>{BUCKET_LOOK[k].short}</th>
                    ))}
                    <th className="px-3 py-2 text-right" title="Total of the customer's tax invoices up to this date">Billed</th>
                    <th className="px-3 py-2 text-right">Received</th>
                    <th className="px-3 py-2 text-right" title="TDS the customer deducted + credit notes">TDS & credit</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((r) => {
                    const isOpen = open.has(r.customer_id);
                    return (
                      <React.Fragment key={r.customer_id}>
                        <tr className="cursor-pointer border-b border-subtle hover:bg-surface-2"
                            onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) toggle(r.customer_id); }}>
                          <td className="px-3 py-2">
                            <div className="flex items-start gap-1.5">
                              <button type="button" className="mt-0.5 text-muted" aria-expanded={isOpen}
                                aria-label={isOpen ? "Hide invoices" : "Show invoices"}
                                onClick={() => toggle(r.customer_id)}>
                                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </button>
                              <div>
                                <CrmLink to={`customers/${r.customer_id}`} className="font-semibold text-primary hover:text-brand-600">{r.customer_name}</CrmLink>
                                <div className="text-xs text-muted">
                                  {r.open_invoices.length} unpaid
                                  {r.overdue_count > 0 ? ` · ${r.overdue_count} late · oldest ${r.oldest_days_late} d` : " · none late"}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-bold tabular-nums">{rupees(r.outstanding)}</td>
                          {BUCKET_ORDER.map((k) => (
                            <td key={k} className={`px-3 py-2 text-right tabular-nums ${r[k] > 0 ? BUCKET_LOOK[k].text : "text-muted"}`}>
                              {r[k] > 0 ? rupees(r[k]) : "—"}
                            </td>
                          ))}
                          <td className="px-3 py-2 text-right tabular-nums text-secondary">{rupees(r.invoiced)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-secondary">{rupees(r.received)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-secondary">{rupees(r.tds + r.credit_notes)}</td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-subtle bg-surface-2">
                            <td colSpan={10} className="px-4 py-3">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left uppercase tracking-wide text-muted">
                                    <th className="py-1 pr-3">Invoice</th>
                                    <th className="py-1 pr-3">For month</th>
                                    <th className="py-1 pr-3">Employee</th>
                                    <th className="py-1 pr-3">Branch</th>
                                    <th className="py-1 pr-3">Invoice date</th>
                                    <th className="py-1 pr-3">Due</th>
                                    <th className="py-1 pr-3">Status</th>
                                    <th className="py-1 text-right">To collect</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {r.open_invoices.map((i) => (
                                    <tr key={i.id} className="border-t border-subtle">
                                      <td className="py-1.5 pr-3">
                                        <CrmLink to={`invoices/${i.id}`} className="font-semibold text-brand-600 hover:underline">
                                          {i.invoice_number || `#${i.id}`}
                                        </CrmLink>
                                      </td>
                                      <td className="py-1.5 pr-3">{i.month_label || "—"}</td>
                                      <td className="py-1.5 pr-3">{i.employee || <span className="text-muted">{i.project || "—"}</span>}</td>
                                      <td className="py-1.5 pr-3">{i.branch_name || "—"}</td>
                                      <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDay(i.invoice_date)}</td>
                                      <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDay(i.due_date)}</td>
                                      <td className="py-1.5 pr-3">{lateChip(i.days_late)}</td>
                                      <td className="py-1.5 text-right font-semibold tabular-nums">{rupees(i.outstanding)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {!search.trim() && !only && (
                    <tr className="bg-surface-2 font-bold">
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2 text-right tabular-nums">{rupees(t.outstanding)}</td>
                      {BUCKET_ORDER.map((k) => <td key={k} className="px-3 py-2 text-right tabular-nums">{rupees(t[k])}</td>)}
                      <td className="px-3 py-2 text-right tabular-nums">{rupees(t.invoiced)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{rupees(t.received)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{rupees((t.tds || 0) + (t.credit_notes || 0))}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

/* ========================================================= Customer Ledger */

type LedgerEntry = {
  date: string; type: string; ref: string; note: string;
  debit?: number | null; credit?: number | null; balance: number;
};
type LedgerData = {
  customer_id: number; customer_name: string;
  opening_balance: number; closing_balance: number;
  totals: { debit: number; credit: number };
  entries: LedgerEntry[];
};

function CustomerLedgerTab() {
  const [customers, setCustomers] = useState<{ id: number; name: string }[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [data, setData] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    crmGet<{ id: number; name: string }[]>("/api/customers/names")
      .then((r) => setCustomers(r.data || []))
      .catch((e) => setError(e?.message || "Could not load the customer list"));
  }, []);

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true); setError("");
    try {
      const res = await crmGet<LedgerData>(
        `/api/finance/reports/customer-ledger${qs({
          customer_id: customerId, date_from: dateFrom || undefined, date_to: dateTo || undefined,
        })}`,
      );
      setData(res.data);
    } catch (e: any) {
      setError(e?.message || "Failed to load ledger");
    } finally {
      setLoading(false);
    }
  }, [customerId, dateFrom, dateTo]);

  useEffect(() => { void load(); }, [load]);

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `ledger-${data.customer_name}.csv`,
      ["Date", "Type", "Reference", "Note", "Debit", "Credit", "Balance"],
      [
        ["", "Opening balance", "", "", "", "", data.opening_balance],
        ...data.entries.map((e) => [e.date, e.type, e.ref, e.note, e.debit ?? "", e.credit ?? "", e.balance]),
        ["", "Closing balance", "", "", data.totals.debit, data.totals.credit, data.closing_balance],
      ],
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-secondary">
          Customer
          <select className={`${inputCls} !w-56`} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-secondary">
          From
          <input type="date" className={`${inputCls} !w-40`} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-secondary">
          To
          <input type="date" className={`${inputCls} !w-40`} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        {data && (
          <button className={btnSecondary} onClick={exportCsv}>
            <FileDown size={15} /> Export CSV
          </button>
        )}
      </div>

      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : !customerId ? (
        <EmptyState message="Pick a customer — the complete ledger shows every invoice, payment, TDS deduction and credit note with a running balance." />
      ) : loading ? (
        <Spinner label="Building ledger…" />
      ) : data ? (
        <div className="overflow-x-auto rounded-card border border-subtle">
          <table className="w-full min-w-max text-sm lg:min-w-0">
            <thead>
              <tr className="border-b border-subtle bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Reference</th>
                <th className="px-3 py-2">Details</th>
                <th className="px-3 py-2 text-right">Debit</th>
                <th className="px-3 py-2 text-right">Credit</th>
                <th className="px-3 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-subtle bg-surface-2 font-semibold">
                <td className="px-3 py-2" colSpan={6}>Opening balance</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr2(data.opening_balance)}</td>
              </tr>
              {data.entries.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted">No activity in this period</td></tr>
              )}
              {data.entries.map((e, i) => (
                <tr key={i} className="border-b border-subtle hover:bg-surface-2">
                  <td className="px-3 py-2 whitespace-nowrap">{e.date}</td>
                  <td className="px-3 py-2">{e.type}</td>
                  <td className="px-3 py-2">{e.ref || "—"}</td>
                  <td className="px-3 py-2 text-muted">{e.note}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{e.debit != null ? inr2(e.debit) : ""}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{e.credit != null ? inr2(e.credit) : ""}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr2(e.balance)}</td>
                </tr>
              ))}
              <tr className="bg-surface-2 font-bold">
                <td className="px-3 py-2" colSpan={4}>Closing balance (receivable from {data.customer_name})</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr2(data.totals.debit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr2(data.totals.credit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr2(data.closing_balance)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/* ==================================================================== page */

const FIN_TABS = [
  { key: "profit", label: "Profit" },
  { key: "receivables", label: "Who owes us" },
  { key: "ledger", label: "Customer ledger" },
];
const FIN_TAB_KEYS = FIN_TABS.map((t) => t.key);
const SUBTITLE = "Profit by customer, project and employee · who owes us and how late · each customer's full ledger.";

/** `embedded` — rendered inside Reports ▸ Financial Reports. The host page
 *  owns `?tab=` (its own tabs), so this one keeps its tab in `?ftab=`. */
export function FinanceReportsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [tab, setTab] = usePageTab<string>(embedded ? "ftab" : "tab", "profit", FIN_TAB_KEYS);
  const [toast] = useToast();
  const tabs = <Tabs tabs={FIN_TABS} active={tab} onChange={setTab} />;
  return (
    <div>
      {embedded ? (
        <div className="mb-4">
          <p className="mb-3 text-sm text-muted">{SUBTITLE}</p>
          {tabs}
        </div>
      ) : (
        <div className="mb-4">
          <PageHeader icon={LineChart} accent="violet" eyebrow="Finance" title="Financial Reports" subtitle={SUBTITLE}>
            {tabs}
          </PageHeader>
        </div>
      )}
      {tab === "profit" ? <ProfitTab /> : tab === "receivables" ? <ReceivablesTab /> : <CustomerLedgerTab />}
      {toast}
    </div>
  );
}
