/**
 * Reports ▸ Invoice Summary (23 Oct 2026, user ask).
 *
 * Sales / the Sales Manager send each customer the month's invoices as a small
 * table — Sr · Invoice Number · Invoice Date · Invoice Amount · Tax Amount ·
 * Total Amount · Description ("Contract Staffing Service <employee> - <Mon
 * YYYY>"). This page builds that table customer by customer for one month, and
 * every table has a **Copy** button that puts it on the clipboard as a real
 * table (HTML for Outlook / Gmail, tab-separated text for Excel), so it pastes
 * into a mail exactly as shown. Server: `GET /api/reports/invoice-summary`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ClipboardCopy, Download, FileText, RefreshCw } from "lucide-react";
import { crmGet, qs } from "../../api";
import { authFetch } from "../../../api/client";
import { CrmLink } from "../../routerHooks";
import { CONTROL, ICON_BTN, Tile, inrCompact } from "../../components/controlTower";
import { ErrorBox } from "../../components/ui";
import { useActiveCustomers } from "../../lib/activeCustomers";
import { useSessionState } from "../../lib/pageState";

export type SummaryRow = {
  sr: number; invoice_id: number; invoice_number: string; invoice_date: string | null;
  invoice_amount: number; tax_amount: number; total_amount: number; description: string;
  employee?: string | null; work_month_label?: string | null; period_label?: string | null;
  branch?: string | null; payment_status?: string | null;
};
export type SummaryGroup = {
  customer_id: number | null; customer: string; rows: SummaryRow[];
  totals: { count: number; invoice_amount: number; tax_amount: number; total_amount: number };
};
type Summary = {
  month: string; month_label: string; basis: "invoice" | "work"; service: string;
  groups: SummaryGroup[]; totals: SummaryGroup["totals"];
};

const HEADERS = ["Sr.", "Invoice Number", "Invoice Date", "Invoice Amount", "Tax Amount", "Total Amount", "Description"];

/** "₹ 2,26,400.00" — the invoice's own figure, paise kept. PURE. */
export function rupees(n: number): string {
  return `₹ ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "2026-10-15" → "15-10-2026" (the format customers receive). PURE. */
export function ddmmyyyy(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}-${m}-${y}` : iso;
}

function cells(r: SummaryRow): string[] {
  return [String(r.sr), r.invoice_number, ddmmyyyy(r.invoice_date), rupees(r.invoice_amount),
          rupees(r.tax_amount), rupees(r.total_amount), r.description];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The table as HTML a mail client keeps (inline borders, no classes). PURE. */
export function summaryTableHtml(group: SummaryGroup, withTotal = true): string {
  const td = 'style="border:1px solid #9ca3af;padding:4px 8px;font-family:Calibri,Arial,sans-serif;font-size:11pt"';
  const tdR = 'style="border:1px solid #9ca3af;padding:4px 8px;text-align:right;white-space:nowrap;font-family:Calibri,Arial,sans-serif;font-size:11pt"';
  const th = 'style="border:1px solid #9ca3af;padding:4px 8px;background:#f3f4f6;text-align:left;font-family:Calibri,Arial,sans-serif;font-size:11pt"';
  const head = `<tr>${HEADERS.map((h) => `<th ${th}>${esc(h)}</th>`).join("")}</tr>`;
  const body = group.rows.map((r) => {
    const c = cells(r);
    return `<tr>${c.map((v, i) => `<td ${i >= 3 && i <= 5 ? tdR : td}>${esc(v)}</td>`).join("")}</tr>`;
  }).join("");
  const total = withTotal
    ? `<tr><td ${td} colspan="3"><b>Total</b></td><td ${tdR}><b>${esc(rupees(group.totals.invoice_amount))}</b></td>`
      + `<td ${tdR}><b>${esc(rupees(group.totals.tax_amount))}</b></td><td ${tdR}><b>${esc(rupees(group.totals.total_amount))}</b></td><td ${td}></td></tr>`
    : "";
  return `<table style="border-collapse:collapse">${head}${body}${total}</table>`;
}

/** The same table as tab-separated text (pastes into Excel / plain mail). PURE. */
export function summaryTsv(group: SummaryGroup, withTotal = true): string {
  const lines = [HEADERS.join("\t"), ...group.rows.map((r) => cells(r).join("\t"))];
  if (withTotal) {
    lines.push(["Total", "", "", rupees(group.totals.invoice_amount), rupees(group.totals.tax_amount),
                rupees(group.totals.total_amount), ""].join("\t"));
  }
  return lines.join("\n");
}

async function copyTable(html: string, text: string): Promise<void> {
  const ClipboardItemCtor = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (navigator.clipboard && ClipboardItemCtor) {
    try {
      await navigator.clipboard.write([new ClipboardItemCtor({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      })]);
      return;
    } catch { /* fall through to plain text */ }
  }
  await navigator.clipboard.writeText(text);
}

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function CopyButton({ html, text, label = "Copy table" }: { html: string; text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <button type="button"
      onClick={() => copyTable(html, text).then(() => { setDone(true); setFailed(false); window.setTimeout(() => setDone(false), 2000); })
        .catch(() => setFailed(true))}
      className={`inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-semibold text-white shadow-raised transition-colors ${done ? "bg-emerald-600" : "bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700"}`}
      title="Copies the table — paste it straight into the mail to the customer">
      {done ? <Check size={13} aria-hidden /> : <ClipboardCopy size={13} aria-hidden />}
      {done ? "Copied" : failed ? "Copy blocked — select the table" : label}
    </button>
  );
}

function GroupCard({ g }: { g: SummaryGroup }) {
  const html = useMemo(() => summaryTableHtml(g), [g]);
  const text = useMemo(() => summaryTsv(g), [g]);
  return (
    <section className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-primary">
            {g.customer_id ? <CrmLink to={`customers/${g.customer_id}`} className="hover:underline">{g.customer}</CrmLink> : g.customer}
          </h3>
          <p className="text-xs text-muted">
            {g.totals.count} invoice{g.totals.count === 1 ? "" : "s"} · {rupees(g.totals.total_amount)} incl. GST
          </p>
        </div>
        <CopyButton html={html} text={text} />
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-2 text-left text-[11px] font-bold uppercase tracking-wide text-muted">
            <tr>{HEADERS.map((h, i) => <th key={h} className={`px-3 py-2 ${i >= 3 && i <= 5 ? "text-right" : ""}`}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {g.rows.map((r) => (
              <tr key={r.invoice_id} className="border-t border-subtle">
                <td className="px-3 py-2 tabular-nums text-secondary">{r.sr}</td>
                <td className="px-3 py-2 font-semibold">
                  <CrmLink to={`invoices/${r.invoice_id}`} className="text-brand-700 hover:underline dark:text-brand-300">{r.invoice_number}</CrmLink>
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{ddmmyyyy(r.invoice_date)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{rupees(r.invoice_amount)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{rupees(r.tax_amount)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{rupees(r.total_amount)}</td>
                <td className="px-3 py-2">
                  {r.description}
                  {(r.branch || r.period_label) && (
                    <div className="text-[11px] text-muted">{[r.branch, r.period_label].filter(Boolean).join(" · ")}</div>
                  )}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-subtle bg-surface-2 font-bold">
              <td className="px-3 py-2" colSpan={3}>Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{rupees(g.totals.invoice_amount)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{rupees(g.totals.tax_amount)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{rupees(g.totals.total_amount)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function InvoiceSummaryReport() {
  const [f, setF] = useSessionState("reports.invoiceSummary", { month: thisMonth(), basis: "invoice", customer: "" });
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const customers = useActiveCustomers(f.customer || null);

  const query = useMemo(() => qs({ month: f.month || undefined, basis: f.basis, customer_id: f.customer || undefined }), [f]);
  const load = useCallback(() => {
    setLoading(true);
    setError("");
    crmGet<Summary>(`/api/reports/invoice-summary${query}`)
      .then((r) => setData(r.data))
      .catch((e: any) => setError(e?.message || "Could not load the invoices"))
      .finally(() => setLoading(false));
  }, [query]);
  useEffect(() => { load(); }, [load]);

  const downloadCsv = async () => {
    const res = await authFetch(`/api/reports/invoice-summary${query}${query ? "&" : "?"}format=csv`);
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-summary-${f.month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
        <label className="text-xs font-semibold text-secondary">Month
          <input type="month" className={`${CONTROL} mt-1 block`} value={f.month} max={thisMonth()}
            onChange={(e) => setF({ ...f, month: e.target.value })} />
        </label>
        <div className="text-xs font-semibold text-secondary">Month means
          <div className="mt-1 inline-flex rounded-control border border-subtle bg-surface-2 p-0.5" role="group" aria-label="Month means">
            {([["invoice", "Invoice date"], ["work", "Work month"]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setF({ ...f, basis: k })}
                className={`rounded-control px-3 py-1.5 text-xs font-semibold ${f.basis === k ? "bg-surface-1 text-primary shadow-raised" : "text-secondary"}`}>{label}</button>
            ))}
          </div>
        </div>
        <label className="text-xs font-semibold text-secondary">Customer
          <select className={`${CONTROL} mt-1 block min-w-[14rem]`} value={f.customer}
            onChange={(e) => setF({ ...f, customer: e.target.value })}>
            <option value="">All customers</option>
            {customers.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={downloadCsv} className="inline-flex h-9 items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-3 text-xs font-semibold text-secondary hover:text-primary">
            <Download size={13} aria-hidden /> CSV
          </button>
          <button type="button" onClick={load} className={ICON_BTN} aria-label="Refresh" title="Refresh">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} aria-hidden />
          </button>
        </div>
        <p className="basis-full text-xs text-muted">
          Tax invoices only (a Proforma is not sent). <b>Invoice date</b> lists the invoices raised in the month;
          <b> Work month</b> lists the invoices for the work done in that month. Each table copies as a real table —
          paste it into the mail to the customer.
        </p>
      </div>

      {error ? <ErrorBox error={error} onRetry={load} /> : !data ? (
        <div className="h-40 animate-pulse rounded-card bg-surface-2" aria-busy="true" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Customers" value={data.groups.length} sub={data.month_label} />
            <Tile label="Invoices" value={data.totals.count} sub={f.basis === "work" ? "For the month's work" : "Raised in the month"} />
            <Tile label="Invoice amount" value={inrCompact(data.totals.invoice_amount)} sub={`Tax ${inrCompact(data.totals.tax_amount)}`} />
            <Tile label="Total incl. GST" value={inrCompact(data.totals.total_amount)} tone="success" sub="What the customers pay" />
          </div>
          {data.groups.length ? (
            <div className="space-y-4">{data.groups.map((g) => <GroupCard key={g.customer_id ?? "none"} g={g} />)}</div>
          ) : (
            <div className="rounded-card border border-subtle bg-surface-1 p-8 text-center text-sm text-muted">
              <FileText size={18} className="mx-auto mb-2" aria-hidden />
              No tax invoice {f.basis === "work" ? "for the work of" : "raised in"} {data.month_label}
              {f.customer ? " for this customer" : ""}.
            </div>
          )}
        </>
      )}
    </div>
  );
}
