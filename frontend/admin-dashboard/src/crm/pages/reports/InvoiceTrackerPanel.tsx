/** Invoice tracker on the Revenue page (24 Nov 2026, Finance's own sheet layout).
 *
 *  One row per issued tax invoice of the page's period and scope — the same
 *  columns, in the same order, as Finance's Excel tracker; the table's Excel
 *  button (and the Excel pack's first sheet) give exactly what is on screen.
 *  Every figure comes from `GET /api/reports/revenue/invoice-tracker` (invoice +
 *  the timesheet figures frozen at approval); nothing is worked out here. */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, Search } from "lucide-react";

import { authFetch } from "../../../api/client";
import { crmGet, qs } from "../../api";
import { CrmLink } from "../../routerHooks";
import { CONTROL, Panel } from "../../components/controlTower";

export type TrackerRow = {
  invoice_id: number;
  timesheet_id: number | null;
  customer_id: number;
  customer: string;
  project: string | null;
  resource: string;
  employee_code: string | null;
  billing_month: string | null;
  billing_month_label: string | null;
  period_label: string | null;
  part: number | null;
  manual?: boolean;
  expected_revenue: number | null;
  no_of_days: number | null;
  rate_per_day: number | null;
  week_off: number | null;
  holiday: number | null;
  leave: number | null;
  extra_days: number | null;
  billed_days: number | null;
  amount: number;
  gst: number;
  total_amount: number;
  invoice_number: string | null;
  invoice_date: string | null;
  payment_status: "Received" | "Not Received";
  received_date: string | null;
  received_amount: number;
  tds_amount: number;
  diff: number;
  amount_received: number;
};

export type TrackerTotals = {
  expected_revenue: number; amount: number; gst: number; total_amount: number;
  received_amount: number; tds_amount: number; diff: number; amount_received: number;
  invoices: number; received: number; not_received: number;
};

export type TrackerData = {
  label: string;
  period_key: string;
  groups: { customer_id: number; customer: string; rows: TrackerRow[]; totals: TrackerTotals }[];
  totals: TrackerTotals;
  count: number;
};

export type StatusFilter = "all" | "Received" | "Not Received";

/** PURE. Rupees with paise, en-IN grouping; blank for null. */
export function money2(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** PURE. A day count without trailing zeros (29, 29.5). */
export function days(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return String(Math.round(n * 100) / 100);
}

/** PURE. "2026-10-03" → "03-10-2026" (the Excel sheet's DD-MM-YYYY). */
export function ddmmyyyy(iso: string | null | undefined): string {
  if (!iso || iso.length < 10) return "";
  return `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
}

/** PURE. Narrow the groups by search + payment status; re-add each group's totals. */
export function filterTracker(data: TrackerData | null, search: string, status: StatusFilter): TrackerData["groups"] {
  if (!data) return [];
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const keep = (r: TrackerRow) => {
    if (status !== "all" && r.payment_status !== status) return false;
    if (!words.length) return true;
    const hay = [r.resource, r.customer, r.project, r.invoice_number, r.billing_month_label, r.employee_code]
      .filter(Boolean).join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const out: TrackerData["groups"] = [];
  for (const g of data.groups) {
    const rows = g.rows.filter(keep);
    if (!rows.length) continue;
    out.push({ ...g, rows, totals: sumRows(rows) });
  }
  return out;
}

/** PURE. The money sums the table prints under each customer. */
export function sumRows(rows: TrackerRow[]): TrackerTotals {
  const add = (k: keyof TrackerRow) => Math.round(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) * 100) / 100;
  const received = rows.filter((r) => r.payment_status === "Received").length;
  return {
    expected_revenue: add("expected_revenue"), amount: add("amount"), gst: add("gst"),
    total_amount: add("total_amount"), received_amount: add("received_amount"), tds_amount: add("tds_amount"),
    diff: add("diff"), amount_received: add("amount_received"),
    invoices: rows.length, received, not_received: rows.length - received,
  };
}

const TH = "sticky top-0 z-10 whitespace-nowrap border-b border-subtle bg-[#1e3a8a] px-2.5 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-[#fff]";
const TD = "whitespace-nowrap border-b border-subtle px-2.5 py-2 text-sm text-secondary";
const NUM = `${TD} text-right tabular-nums`;

type Query = { month: string; period: string; customer_id?: number; project_id?: number; branch_id?: number };

export function InvoiceTrackerPanel({ query, tick, onError }: {
  query: Query; tick: number; onError: (msg: string) => void;
}) {
  const [data, setData] = useState<TrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true); setError("");
    crmGet<TrackerData>(`/api/reports/revenue/invoice-tracker${qs(query)}`)
      .then((r) => { if (live) setData(r.data); })
      .catch((e: any) => { if (live) setError(e?.message || "Could not load the invoice tracker"); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [query, tick]);

  const groups = useMemo(() => filterTracker(data, search, status), [data, search, status]);
  const shown = useMemo(() => sumRows(groups.flatMap((g) => g.rows)), [groups]);

  const download = async () => {
    setExporting(true);
    try {
      const res = await authFetch(`/api/reports/revenue/invoice-tracker${qs({ ...query, format: "xlsx" })}`);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `karnex-invoice-tracker-${data?.period_key || query.month}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      onError(e?.message || "Download failed");
    } finally {
      setExporting(false);
    }
  };

  const toggle = (id: number) => setClosed((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const chip = (key: StatusFilter, label: string, count: number, tone: string) => (
    <button type="button" onClick={() => setStatus(key)} aria-pressed={status === key}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors ${
        status === key ? `${tone} border-transparent` : "border-subtle bg-surface-1 text-secondary hover:bg-surface-2"}`}>
      {label} <span className="tabular-nums opacity-80">{count}</span>
    </button>
  );

  const totalCells = (t: TrackerTotals) => (
    <>
      <td className={NUM}>{t.expected_revenue ? money2(t.expected_revenue) : ""}</td>
      <td className={TD} colSpan={7} />
      <td className={NUM}>{money2(t.amount)}</td>
      <td className={NUM}>{money2(t.gst)}</td>
      <td className={NUM}>{money2(t.total_amount)}</td>
      <td className={TD} colSpan={4} />
      <td className={NUM}>{money2(t.received_amount)}</td>
      <td className={NUM}>{money2(t.tds_amount)}</td>
      <td className={`${NUM} ${t.diff > 0.009 ? "text-rose-700 dark:text-rose-300" : ""}`}>{money2(t.diff)}</td>
      <td className={NUM}>{money2(t.amount_received)}</td>
    </>
  );

  return (
    <Panel
      title="Invoice tracker"
      hint={`Every tax invoice of ${data?.label || "this period"} — the same columns as the Excel sheet`}
      action={
        <button type="button" onClick={() => void download()} disabled={exporting || !data}
          className="inline-flex h-9 items-center gap-1.5 rounded-control bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          <Download size={15} aria-hidden /> {exporting ? "Downloading…" : "Download Excel"}
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Resource, customer, invoice no., month…"
            aria-label="Search the invoice tracker" className={`${CONTROL} w-full pl-8`} />
        </label>
        {data && (
          <>
            {chip("all", "All", data.totals.invoices, "bg-brand-600 text-white")}
            {chip("Received", "Received", data.totals.received, "bg-emerald-600 text-white")}
            {chip("Not Received", "Not Received", data.totals.not_received, "bg-rose-600 text-white")}
          </>
        )}
        {data && groups.length > 1 && (
          <button type="button" className="ml-auto text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300"
            onClick={() => setClosed(closed.size ? new Set() : new Set(groups.map((g) => g.customer_id)))}>
            {closed.size ? "Expand all" : "Collapse all"}
          </button>
        )}
      </div>

      {error ? (
        <p className="rounded-card border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">{error}</p>
      ) : !data ? (
        <p className="text-sm text-muted">Loading the invoices…</p>
      ) : !groups.length ? (
        <p className="rounded-card border border-dashed border-subtle px-3 py-6 text-center text-sm text-muted">
          {data.count ? "No invoice matches the search." : `No tax invoice in ${data.label}.`}
        </p>
      ) : (
        <div className={`-mx-5 -mb-5 max-h-[34rem] overflow-auto border-t border-subtle transition-opacity ${loading ? "opacity-60" : ""}`}>
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className={`${TH} sticky left-0 z-20 text-left`}>Resource Name</th>
                <th className={TH}>Billing Month</th>
                <th className={TH}>Expected Revenue</th>
                <th className={TH}>No. Of Days</th>
                <th className={TH}>Rate/day</th>
                <th className={TH}>WeekOff</th>
                <th className={TH}>Holiday</th>
                <th className={TH} title="Leave days not billed (loss of pay)">Leave</th>
                <th className={TH} title="Week-off / holiday work billed">Extra Days</th>
                <th className={TH}>Billed Days</th>
                <th className={TH}>Amount</th>
                <th className={TH}>GST @18%</th>
                <th className={TH}>Total Amount</th>
                <th className={TH}>Invoice No.</th>
                <th className={TH}>Invoice Date</th>
                <th className={TH}>Payment Status</th>
                <th className={TH}>Received Date</th>
                <th className={TH}>Received Amount<br />(In Account)</th>
                <th className={TH}>TDS Amount</th>
                <th className={TH} title="Total Amount − (Received + TDS)">Diff</th>
                <th className={TH}>Amount Received</th>
              </tr>
            </thead>
            {groups.map((g) => {
              const open = !closed.has(g.customer_id);
              return (
                <tbody key={g.customer_id}>
                  <tr>
                    <td colSpan={21} className="sticky left-0 border-b border-subtle bg-brand-50 px-2.5 py-1.5 dark:bg-brand-900">
                      <button type="button" onClick={() => toggle(g.customer_id)} aria-expanded={open}
                        className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-800 dark:text-brand-200">
                        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                        {g.customer}
                        <span className="text-xs font-semibold text-secondary">
                          · {g.totals.invoices} invoice{g.totals.invoices === 1 ? "" : "s"} · ₹{money2(g.totals.total_amount)}
                          {g.totals.not_received ? ` · ${g.totals.not_received} not received` : " · all received"}
                        </span>
                      </button>
                    </td>
                  </tr>
                  {open && g.rows.map((r) => (
                    <tr key={r.invoice_id} className="hover:bg-surface-2">
                      <td className={`${TD} sticky left-0 z-[1] bg-surface-1 font-semibold text-primary`}>
                        {r.timesheet_id
                          ? <CrmLink to={`timesheets/${r.timesheet_id}`} className="hover:underline">{r.resource}</CrmLink>
                          : <span title="Raised by hand — no timesheet">{r.resource}</span>}
                        {r.part ? <span className="ml-1 text-[11px] font-semibold text-muted">part {r.part}</span> : null}
                        {r.employee_code && <div className="text-[11px] font-normal text-muted">{r.employee_code}</div>}
                      </td>
                      <td className={TD}>
                        {r.billing_month_label || "—"}
                        {r.period_label && <div className="text-[11px] text-muted">{r.period_label}</div>}
                      </td>
                      <td className={NUM}>{money2(r.expected_revenue)}</td>
                      <td className={NUM}>{days(r.no_of_days)}</td>
                      <td className={NUM}>{money2(r.rate_per_day)}</td>
                      <td className={NUM}>{days(r.week_off)}</td>
                      <td className={NUM}>{days(r.holiday)}</td>
                      <td className={NUM}>{days(r.leave)}</td>
                      <td className={NUM}>{days(r.extra_days)}</td>
                      <td className={`${NUM} font-semibold text-primary`}>{days(r.billed_days)}</td>
                      <td className={NUM}>{money2(r.amount)}</td>
                      <td className={NUM}>{money2(r.gst)}</td>
                      <td className={`${NUM} font-semibold text-primary`}>{money2(r.total_amount)}</td>
                      <td className={TD}>
                        {r.invoice_number
                          ? <CrmLink to={`invoices/${r.invoice_id}`} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">{r.invoice_number}</CrmLink>
                          : "—"}
                      </td>
                      <td className={TD}>{ddmmyyyy(r.invoice_date)}</td>
                      <td className={TD}>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          r.payment_status === "Received"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
                            : "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200"}`}>{r.payment_status}</span>
                      </td>
                      <td className={TD}>{ddmmyyyy(r.received_date)}</td>
                      <td className={NUM}>{money2(r.received_amount)}</td>
                      <td className={NUM}>{money2(r.tds_amount)}</td>
                      <td className={`${NUM} ${r.diff > 0.009 ? "font-semibold text-rose-700 dark:text-rose-300" : ""}`}>{money2(r.diff)}</td>
                      <td className={NUM}>{money2(r.amount_received)}</td>
                    </tr>
                  ))}
                  <tr className="bg-surface-2 font-semibold">
                    <td className={`${TD} sticky left-0 z-[1] bg-surface-2 font-bold text-primary`} colSpan={2}>Total — {g.customer}</td>
                    {totalCells(g.totals)}
                  </tr>
                </tbody>
              );
            })}
            <tfoot>
              <tr>
                <td className="sticky bottom-0 left-0 z-20 whitespace-nowrap bg-[#1e3a8a] px-2.5 py-2 text-sm font-bold text-[#fff]" colSpan={2}>
                  Grand total · {shown.invoices} invoices · {shown.received} received
                </td>
                {([
                  money2(shown.expected_revenue), null, money2(shown.amount), money2(shown.gst), money2(shown.total_amount), null,
                  money2(shown.received_amount), money2(shown.tds_amount), money2(shown.diff), money2(shown.amount_received),
                ] as (string | null)[]).map((v, i) => (
                  <td key={i} colSpan={i === 1 ? 7 : i === 5 ? 4 : 1}
                    className="sticky bottom-0 whitespace-nowrap bg-[#1e3a8a] px-2.5 py-2 text-right text-sm font-bold tabular-nums text-[#fff]">
                    {v ?? ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Panel>
  );
}
