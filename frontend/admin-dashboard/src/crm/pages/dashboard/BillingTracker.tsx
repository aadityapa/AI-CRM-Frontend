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
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, CalendarRange, ChevronLeft, ChevronRight, FileText, ListChecks,
  RefreshCw, Search, X,
} from "lucide-react";

import { crmGet, qs } from "../../api";
import { CrmLink } from "../../routerHooks";
import { CONTROL, ICON_BTN, inr, inrCompact } from "../../components/controlTower";
import { useSessionState } from "../../lib/pageState";

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
};

type Meta = {
  total: number; page: number; limit: number; pages: number;
  counts: Record<string, number>; amounts: Record<string, number>; overdue: number;
  stages: { key: string; label: string; open: boolean }[];
  options: { customers: { id: number; name: string }[]; months: { key: string; label: string }[] };
};

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
  paid: { short: "Paid", dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-500/30" },
};

/** What the reader opens next for a row. PURE. */
export function rowLink(r: TrackerRow): { to: string; label: string } | null {
  if (r.invoice_id) return { to: `invoices/${r.invoice_id}`, label: r.invoice_kind === "Proforma" ? "Open Proforma" : "Open invoice" };
  if (r.timesheet_id) return { to: `timesheets/${r.timesheet_id}`, label: "Open timesheet" };
  return null;
}

type Filters = { stage: string; customer: string; month: string; search: string };
const EMPTY: Filters = { stage: "open", customer: "", month: "", search: "" };
const PAGE = 15;

export function BillingTracker() {
  const [f, setF] = useSessionState<Filters>("dash.billing", EMPTY);
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
    crmGet<TrackerRow[]>(`/api/dashboard/billing${qs({
      stage: f.stage === "all" ? "" : f.stage, customer_id: f.customer, month: f.month,
      search: f.search, page, limit: PAGE,
    })}`)
      .then((res) => { if (live) { setRows(res.data || []); setMeta(res.meta as Meta); setErr(null); } })
      .catch((e: any) => { if (live) setErr(e?.message || "Could not load the billing tracker"); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [f.stage, f.customer, f.month, f.search, page, tick]);

  const set = (patch: Partial<Filters>) => { setF({ ...f, ...patch }); setPage(1); };
  const filtered = !!(f.customer || f.month || f.search);
  const chips = useMemo(() => {
    const counts = meta?.counts || {};
    return [
      { key: "open", label: "Needs action", count: counts.open },
      { key: "all", label: "All", count: counts.all },
      ...(meta?.stages || []).map((s) => ({ key: s.key, label: STAGE_LOOK[s.key]?.short || s.label, count: counts[s.key] })),
    ];
  }, [meta]);
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
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/90 px-3 py-1 text-xs font-bold">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {meta.overdue} overdue
              </span>
            ) : null}
            <button type="button" onClick={() => setTick((n) => n + 1)} title="Refresh"
              className="inline-flex h-9 w-9 items-center justify-center rounded-control bg-[#fff]/15 ring-1 ring-[#fff]/25 hover:bg-[#fff]/25">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            </button>
          </div>
        </div>
      </header>

      <div className="space-y-3 border-b border-subtle px-5 py-3">
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
          <select className={`${CONTROL} w-56`} value={f.customer} onChange={(e) => set({ customer: e.target.value })}
            aria-label="Customer">
            <option value="">All customers</option>
            {(meta?.options.customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className={`${CONTROL} w-44`} value={f.month} onChange={(e) => set({ month: e.target.value })}
            aria-label="Work month">
            <option value="">All months</option>
            {(meta?.options.months || []).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          {filtered && (
            <button type="button" onClick={() => { setText(""); setF({ ...EMPTY, stage: f.stage }); setPage(1); }}
              className="inline-flex h-9 items-center gap-1 rounded-control px-2.5 text-xs font-semibold text-secondary hover:bg-surface-2">
              <X className="h-3.5 w-3.5" aria-hidden /> Clear filters
            </button>
          )}
          <span className="ml-auto text-xs text-muted">
            {meta ? <>{meta.total} row{meta.total === 1 ? "" : "s"}{f.stage !== "all" && f.stage !== "open" && meta.amounts?.[f.stage]
              ? <> · {inrCompact(meta.amounts[f.stage])}</> : null}</> : null}
          </span>
        </div>
      </div>

      {err ? (
        <p className="px-5 py-6 text-sm font-semibold text-danger">{err}</p>
      ) : !loading && rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted">
          Nothing here{filtered ? " for these filters" : ""}.
          {filtered && <> <button type="button" className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
            onClick={() => { setText(""); setF({ ...EMPTY, stage: "all" }); setPage(1); }}>Show everything</button></>}
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
        <div className="text-xs text-muted">{r.project || "—"}</div>
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
        ) : <span className="text-xs text-muted">No invoice yet</span>}
        {r.timesheet_id && (
          <CrmLink to={`timesheets/${r.timesheet_id}`} className="mt-0.5 block text-xs text-secondary hover:underline">
            Timesheet · approved
          </CrmLink>
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {r.grand_total != null ? <div className="font-semibold text-primary">{inr(r.grand_total)}</div> : <span className="text-muted">—</span>}
        {r.balance != null && r.balance > 0 && r.invoice_kind === "Tax" && r.balance !== r.grand_total && (
          <div className="text-[11px] text-muted">{inr(r.balance)} open</div>
        )}
      </td>
      <td className="px-3 py-2.5">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${look.chip}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${look.dot}`} aria-hidden /> {look.short}
        </span>
        {r.overdue && <span className="ml-1.5 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-[#fff]">Overdue</span>}
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
