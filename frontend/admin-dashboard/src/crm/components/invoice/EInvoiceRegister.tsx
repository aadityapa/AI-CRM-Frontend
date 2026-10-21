/** The E-invoice register (21 Oct 2026, user ask): every tax invoice whose IRN
 *  is recorded, for Finance and every Sales rung (Sales · Sales Manager · Sales
 *  Head) + Admin / CEO. Read-only here — only Finance records or corrects the
 *  IRN, on the invoice page.
 *
 *  Filters: search (invoice / PI number, employee), customer → branch, the
 *  month the invoice BILLS, the IRN date range (server); employee and payment
 *  status (client, over the loaded set). Each row opens the e-invoice sheet,
 *  downloads it as PDF (the same sheet, captured in its own tab) or Word. */
import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck, Copy, Download, ExternalLink, FileText, Loader2, RefreshCw, Search, X,
} from "lucide-react";
import { authFetch } from "../../../api/client";
import { crmGet, qs } from "../../api";
import { fetchAllMaster } from "../../lib/fetchAllMaster";
import { CrmLink, crmUrl } from "../../routerHooks";
import { StatusBadge } from "../ui";
import { WorkMonth } from "../WorkMonth";
import { PageHeader } from "../PageHeader";

export type EInvoiceRow = {
  id: number;
  invoice_number?: string | null;
  proforma_number?: string | null;
  customer_id?: number | null;
  customer_name?: string | null;
  branch_name?: string | null;
  employee?: string | null;
  employee_id?: number | null;
  month?: string | null;
  month_label?: string | null;
  period_label?: string | null;
  invoice_date?: string | null;
  grand_total?: number | string | null;
  sub_total?: number | string | null;
  paid_amount?: number | string | null;
  balance_amount?: number | string | null;
  payment_status?: string | null;
  irn_number?: string | null;
  ack_number?: string | null;
  ack_date?: string | null;
  irn_recorded_at?: string | null;
  irn_recorded_by_name?: string | null;
};

export type ClientFilter = { employee: string; status: string };

const STATUS_CHOICES = [
  { key: "", label: "Any payment" },
  { key: "Unpaid", label: "Unpaid" },
  { key: "Partially_Paid", label: "Partly paid" },
  { key: "Paid", label: "Paid" },
];

const CONTROL =
  "h-9 rounded-control border border-subtle bg-surface-1 px-2.5 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-brand-500/40";

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const rupee = (v: unknown) =>
  `₹${num(v).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 })}`;
const fmtDay = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** Employee + payment status narrow the loaded set (PURE). */
export function filterEInvoices(rows: EInvoiceRow[], f: ClientFilter): EInvoiceRow[] {
  return rows.filter((r) =>
    (!f.employee || (r.employee || "") === f.employee) &&
    (!f.status || (r.payment_status || "") === f.status));
}

/** The employees named on the loaded set, A→Z (PURE). */
export function employeeChoices(rows: EInvoiceRow[]): string[] {
  return Array.from(new Set(rows.map((r) => (r.employee || "").trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

/** CSV of the rows on screen, formula-safe (PURE). */
export function eInvoiceCsv(rows: EInvoiceRow[]): string {
  const head = ["Invoice", "Customer", "Branch", "Work month", "Employee", "IRN", "Ack No.", "Ack date",
    "Recorded by", "Invoice date", "Grand total", "Paid", "Balance", "Payment status"];
  const cell = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) => [
    r.invoice_number, r.customer_name, r.branch_name, r.month_label, r.employee, r.irn_number, r.ack_number,
    r.ack_date, r.irn_recorded_by_name, r.invoice_date, num(r.grand_total), num(r.paid_amount),
    num(r.balance_amount), r.payment_status,
  ].map(cell).join(","));
  return [head.join(","), ...lines].join("\n");
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: string }) {
  return (
    <div className="relative overflow-hidden rounded-card border border-subtle bg-surface-1 p-3 shadow-raised">
      <span aria-hidden className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${tone}`} />
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-xl font-bold text-primary tnum">{value}</div>
      {sub ? <div className="text-xs text-secondary">{sub}</div> : null}
    </div>
  );
}

export function EInvoiceRegister() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [month, setMonth] = useState("");
  const [irnFrom, setIrnFrom] = useState("");
  const [irnTo, setIrnTo] = useState("");
  const [client, setClient] = useState<ClientFilter>({ employee: "", status: "" });
  const [rows, setRows] = useState<EInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [customers, setCustomers] = useState<{ id: number; name: string }[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [busy, setBusy] = useState<string>("");
  const [note, setNote] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    crmGet<any[]>("/api/customers/names?status=Active")
      .then((r) => setCustomers(((r.data || []) as any[])
        .map((c) => ({ id: Number(c.id), name: String(c.name || c.legal_entity_name || `Customer ${c.id}`) }))
        .sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setCustomers([]));
  }, []);

  useEffect(() => {
    setBranchId("");
    setBranches([]);
    if (!customerId) return;
    let alive = true;
    crmGet<any[]>(`/api/invoices${qs({ customer_id: customerId, limit: 1 })}`)
      .then((r) => { if (alive) setBranches(((r.meta as any)?.branches || []) as { id: number; name: string }[]); })
      .catch(() => { if (alive) setBranches([]); });
    return () => { alive = false; };
  }, [customerId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchAllMaster<EInvoiceRow>("/api/invoices", {
      einvoice: true,
      search: debounced || undefined,
      customer_id: customerId || undefined,
      branch_id: branchId || undefined,
      month: month || undefined,
      irn_from: irnFrom || undefined,
      irn_to: irnTo || undefined,
    })
      .then((all) => { if (alive) { setRows(all); setError(""); } })
      .catch((e) => { if (alive) { setRows([]); setError(e?.message || "Could not load the e-invoices"); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [debounced, customerId, branchId, month, irnFrom, irnTo, reload]);

  const employees = useMemo(() => employeeChoices(rows), [rows]);
  const shown = useMemo(() => filterEInvoices(rows, client), [rows, client]);
  const totals = useMemo(() => ({
    value: shown.reduce((a, r) => a + num(r.grand_total), 0),
    paid: shown.reduce((a, r) => a + num(r.paid_amount), 0),
    due: shown.reduce((a, r) => a + num(r.balance_amount), 0),
    unpaid: shown.filter((r) => r.payment_status !== "Paid").length,
  }), [shown]);
  const activeCount = [debounced, customerId, branchId, month, irnFrom, irnTo, client.employee, client.status]
    .filter(Boolean).length;
  const clearAll = () => {
    setSearch(""); setCustomerId(""); setBranchId(""); setMonth(""); setIrnFrom(""); setIrnTo("");
    setClient({ employee: "", status: "" });
  };

  const openSheet = (r: EInvoiceRow, pdf = false) => {
    const w = window.open(crmUrl(`invoices/${r.id}/tax-invoice?einvoice=1${pdf ? "&pdf=1" : ""}`), "_blank", "noopener");
    if (!w) setNote("Allow pop-ups for this site to open the e-invoice.");
  };
  const downloadWord = async (r: EInvoiceRow) => {
    setBusy(`w${r.id}`);
    try {
      const res = await authFetch(`/api/invoices/${r.id}/einvoice.docx`);
      if (!res.ok) throw new Error(`E-invoice Word failed (${res.status})`);
      const blob = await res.blob();
      const m = /filename="?([^"]+)"?/i.exec(res.headers.get("Content-Disposition") || "");
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = m?.[1] || `EInvoice_${r.invoice_number || r.id}.docx`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (e: any) {
      setNote(e?.message || "Could not download the e-invoice");
    } finally {
      setBusy("");
    }
  };
  const copyIrn = async (r: EInvoiceRow) => {
    try {
      await navigator.clipboard.writeText(r.irn_number || "");
      setNote(`IRN of ${r.invoice_number} copied`);
    } catch {
      setNote("Copy is blocked in this browser — select the IRN and copy it.");
    }
  };
  const exportCsv = () => {
    const blob = new Blob([eInvoiceCsv(shown)], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `e-invoices${month ? `-${month}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(href);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="E-invoices" value={String(shown.length)} sub={`${totals.unpaid} not fully paid`}
          tone="from-violet-500 to-indigo-600" />
        <Tile label="Invoice value" value={rupee(totals.value)} sub="incl. GST" tone="from-sky-500 to-blue-600" />
        <Tile label="Received" value={rupee(totals.paid)} tone="from-emerald-500 to-teal-600" />
        <Tile label="Still to collect" value={rupee(totals.due)} tone="from-amber-500 to-orange-600" />
      </div>

      <div className="rounded-card border border-subtle bg-surface-1 p-3 shadow-raised">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Invoice, PI number or employee…" aria-label="Search e-invoices"
              className={`${CONTROL} w-64 pl-8`} />
          </div>
          <select className={`${CONTROL} w-52`} value={customerId} onChange={(e) => setCustomerId(e.target.value)}
            aria-label="Customer">
            <option value="">All customers</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {customerId && branches.length > 0 ? (
            <select className={`${CONTROL} w-44`} value={branchId} onChange={(e) => setBranchId(e.target.value)}
              aria-label="Branch">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          ) : null}
          <label className="flex items-center gap-1.5 text-xs font-semibold text-secondary">
            Work month
            <input type="month" className={`${CONTROL} w-40`} value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <select className={`${CONTROL} w-48`} value={client.employee}
            onChange={(e) => setClient((c) => ({ ...c, employee: e.target.value }))} aria-label="Employee">
            <option value="">All employees</option>
            {employees.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <select className={`${CONTROL} w-36`} value={client.status}
            onChange={(e) => setClient((c) => ({ ...c, status: e.target.value }))} aria-label="Payment status">
            {STATUS_CHOICES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-secondary">
            IRN date
            <input type="date" className={`${CONTROL} w-36`} value={irnFrom} onChange={(e) => setIrnFrom(e.target.value)}
              aria-label="IRN date from" />
            <span className="text-muted">to</span>
            <input type="date" className={`${CONTROL} w-36`} value={irnTo} onChange={(e) => setIrnTo(e.target.value)}
              aria-label="IRN date to" />
          </label>
          <div className="ml-auto flex items-center gap-2">
            {activeCount > 0 ? (
              <button type="button" onClick={clearAll}
                className="inline-flex items-center gap-1 rounded-full border border-subtle px-2.5 py-1 text-xs font-semibold text-secondary hover:bg-surface-2">
                <X className="h-3.5 w-3.5" aria-hidden /> Clear {activeCount}
              </button>
            ) : null}
            <button type="button" onClick={() => setReload((k) => k + 1)} title="Refresh"
              className="inline-flex h-9 w-9 items-center justify-center rounded-control border border-subtle text-secondary hover:bg-surface-2">
              <RefreshCw className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" onClick={exportCsv} disabled={!shown.length}
              className="inline-flex h-9 items-center gap-1.5 rounded-control border border-subtle px-3 text-sm font-semibold text-secondary hover:bg-surface-2 disabled:opacity-50">
              <Download className="h-4 w-4" aria-hidden /> CSV
            </button>
          </div>
        </div>
        {note ? (
          <div className="mt-2 flex items-center justify-between rounded-control bg-sky-50 px-3 py-1.5 text-xs text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
            <span>{note}</span>
            <button type="button" onClick={() => setNote("")} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
          </div>
        ) : null}
      </div>

      {error ? (
        <div role="alert" className="rounded-card border border-danger/40 bg-danger-soft p-3 text-sm text-danger">{error}</div>
      ) : null}

      <div className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="sticky top-0 z-10 bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Invoice</th>
                <th className="px-3 py-2">Customer · branch</th>
                <th className="px-3 py-2">Work month</th>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">IRN · Ack</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Payment</th>
                <th className="px-3 py-2 text-right">E-invoice</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-muted">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden /> Loading e-invoices…
                </td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-muted">
                  {activeCount ? "No e-invoice matches these filters." : "No e-invoice yet — Finance adds the IRN once the customer approves an invoice."}
                </td></tr>
              ) : shown.map((r) => (
                <tr key={r.id} className="border-t border-subtle align-top hover:bg-surface-2/60">
                  <td className="px-3 py-2">
                    <CrmLink to={`invoices/${r.id}`} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
                      {r.invoice_number || `#${r.id}`}
                    </CrmLink>
                    <div className="text-xs text-muted">{fmtDay(r.invoice_date)}{r.proforma_number ? ` · from ${r.proforma_number}` : ""}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-primary">{r.customer_name || "—"}</div>
                    <div className="text-xs text-muted">{r.branch_name || "No branch"}</div>
                  </td>
                  <td className="px-3 py-2"><WorkMonth label={r.month_label} period={r.period_label} /></td>
                  <td className="px-3 py-2">{r.employee || <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                      <code className="max-w-[12rem] truncate text-[11px] text-secondary" title={r.irn_number || ""}>
                        {r.irn_number || "—"}
                      </code>
                      {r.irn_number ? (
                        <button type="button" onClick={() => void copyIrn(r)} title="Copy IRN"
                          className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-primary">
                          <Copy className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted">
                      Ack {r.ack_number || "—"} · {fmtDay(r.ack_date || r.irn_recorded_at)}
                      {r.irn_recorded_by_name ? ` · by ${r.irn_recorded_by_name}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tnum">
                    <div className="font-semibold text-primary">{rupee(r.grand_total)}</div>
                    {num(r.balance_amount) > 0 ? (
                      <div className="text-xs text-warning">{rupee(r.balance_amount)} due</div>
                    ) : <div className="text-xs text-success">Settled</div>}
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={r.payment_status} /></td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      <button type="button" onClick={() => openSheet(r)} title="Open the e-invoice"
                        className="inline-flex items-center gap-1 rounded-control bg-gradient-to-r from-violet-600 to-indigo-600 px-2.5 py-1 text-xs font-semibold text-[#fff] hover:opacity-90">
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open
                      </button>
                      <button type="button" onClick={() => openSheet(r, true)} title="Download the e-invoice as PDF"
                        className="inline-flex items-center gap-1 rounded-control border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
                        <FileText className="h-3.5 w-3.5" aria-hidden /> PDF
                      </button>
                      <button type="button" onClick={() => void downloadWord(r)} disabled={busy === `w${r.id}`}
                        title="Download the e-invoice as Word"
                        className="inline-flex items-center gap-1 rounded-control border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-60 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
                        {busy === `w${r.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FileText className="h-3.5 w-3.5" aria-hidden />} Word
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Sidebar "E-invoices" page (Finance + every Sales rung + Admin / CEO). */
export function EInvoicesPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        icon={BadgeCheck}
        accent="violet"
        eyebrow="Finance · Sales"
        title="E-invoices"
        subtitle="Every tax invoice with its IRN recorded — open it, download it as PDF or Word, and see what the customer still owes. Finance adds the IRN on the invoice page."
      />
      <EInvoiceRegister />
    </div>
  );
}
