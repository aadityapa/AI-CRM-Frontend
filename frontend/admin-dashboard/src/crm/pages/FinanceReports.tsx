/** Customer-wise financial reports: Complete Ledger + Payment Receivables (aging).
 * Data: /api/finance/reports/customer-ledger and /api/finance/reports/receivables.
 * Read access mirrors Invoices (Admin/Finance; Sales_Head read). CSV export is
 * client-side. Token-only styling — works in Dune day + dark. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FileDown, Search } from "lucide-react";
import { crmGet, qs } from "../api";
import {
  EmptyState, ErrorBox, Spinner, Tabs, btnSecondary, inputCls, useToast,
} from "../components/ui";

const inr = (v?: number | null) =>
  v == null ? "—" : `₹ ${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
type ReceivableRow = {
  customer_id: number; customer_name: string;
  invoiced: number; received: number; tds: number; credit_notes: number;
  outstanding: number; invoice_count: number; overdue_count: number;
  b_0_30: number; b_31_60: number; b_61_90: number; b_90_plus: number;
};
type ReceivablesData = { as_of: string; customers: ReceivableRow[]; totals: Record<string, number> };

function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* --------------------------------------------------------- Customer Ledger */

function CustomerLedgerTab() {
  const [customers, setCustomers] = useState<{ id: number; name: string }[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [data, setData] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    crmGet<{ id: number; name: string }[]>("/api/customers?limit=100")
      .then((r) => setCustomers(r.data || [])).catch(() => {});
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
              <tr className="border-b border-subtle bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
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
              <tr className="border-b border-subtle bg-surface-2/30 font-semibold">
                <td className="px-3 py-2" colSpan={6}>Opening balance</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(data.opening_balance)}</td>
              </tr>
              {data.entries.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted">No activity in this period</td></tr>
              )}
              {data.entries.map((e, i) => (
                <tr key={i} className="border-b border-subtle/60 hover:bg-surface-2/40">
                  <td className="px-3 py-2 whitespace-nowrap">{e.date}</td>
                  <td className="px-3 py-2">{e.type}</td>
                  <td className="px-3 py-2">{e.ref || "—"}</td>
                  <td className="px-3 py-2 text-muted">{e.note}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{e.debit != null ? inr(e.debit) : ""}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{e.credit != null ? inr(e.credit) : ""}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(e.balance)}</td>
                </tr>
              ))}
              <tr className="bg-surface-2/60 font-bold">
                <td className="px-3 py-2" colSpan={4}>Closing balance (receivable from {data.customer_name})</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(data.totals.debit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(data.totals.credit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(data.closing_balance)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- Receivables */

function ReceivablesTab() {
  const [asOf, setAsOf] = useState("");
  const [data, setData] = useState<ReceivablesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await crmGet<ReceivablesData>(
        `/api/finance/reports/receivables${qs({ as_of: asOf || undefined })}`,
      );
      setData(res.data);
    } catch (e: any) {
      setError(e?.message || "Failed to load receivables");
    } finally {
      setLoading(false);
    }
  }, [asOf]);

  useEffect(() => { void load(); }, [load]);

  const filteredCustomers = useMemo(() => {
    const rows = data?.customers || [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.customer_name ?? "").toLowerCase().includes(q));
  }, [data, search]);

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `receivables-${data.as_of}.csv`,
      ["Customer", "Invoiced", "Received", "TDS", "Credit Notes", "Outstanding",
       "0-30 days", "31-60 days", "61-90 days", "90+ days", "Invoices", "Overdue"],
      filteredCustomers.map((r) => [
        r.customer_name, r.invoiced, r.received, r.tds, r.credit_notes, r.outstanding,
        r.b_0_30, r.b_31_60, r.b_61_90, r.b_90_plus, r.invoice_count, r.overdue_count,
      ]),
    );
  };

  const t = data?.totals;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-secondary">
          As of
          <input type="date" className={`${inputCls} !w-40`} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <div className="relative min-w-[14rem] flex-1">
          <input
            className={`${inputCls} !pl-9`}
            placeholder="Search customers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search receivables by customer"
          />
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        </div>
        {data && (
          <button className={btnSecondary} onClick={exportCsv}>
            <FileDown size={15} /> Export CSV
          </button>
        )}
      </div>

      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : loading ? (
        <Spinner label="Computing receivables…" />
      ) : !data || data.customers.length === 0 ? (
        <EmptyState message="No invoices found up to the selected date." />
      ) : filteredCustomers.length === 0 ? (
        <EmptyState message="No customers match your search" />
      ) : (
        <div className="overflow-x-auto rounded-card border border-subtle">
          <table className="w-full min-w-max text-sm lg:min-w-0">
            <thead>
              <tr className="border-b border-subtle bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2 text-right">Invoiced</th>
                <th className="px-3 py-2 text-right">Received</th>
                <th className="px-3 py-2 text-right">TDS</th>
                <th className="px-3 py-2 text-right">Credit notes</th>
                <th className="px-3 py-2 text-right">Outstanding</th>
                <th className="px-3 py-2 text-right">0–30</th>
                <th className="px-3 py-2 text-right">31–60</th>
                <th className="px-3 py-2 text-right">61–90</th>
                <th className="px-3 py-2 text-right">90+</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((r) => (
                <tr key={r.customer_id} className="border-b border-subtle/60 hover:bg-surface-2/40">
                  <td className="px-3 py-2">
                    <span className="font-semibold text-primary">{r.customer_name}</span>
                    <span className="ml-2 text-xs text-muted">
                      {r.invoice_count} inv{r.overdue_count > 0 ? ` · ${r.overdue_count} overdue` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(r.invoiced)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(r.received)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(r.tds)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(r.credit_notes)}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">{inr(r.outstanding)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(r.b_0_30)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(r.b_31_60)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(r.b_61_90)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-danger">{inr(r.b_90_plus)}</td>
                </tr>
              ))}
              {t && !search.trim() && (
                <tr className="bg-surface-2/60 font-bold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(t.invoiced)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(t.received)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(t.tds)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(t.credit_notes)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(t.outstanding)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(t.b_0_30)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(t.b_31_60)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(t.b_61_90)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(t.b_90_plus)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- page */

export function FinanceReportsPage() {
  const [tab, setTab] = useState("ledger");
  const [toast] = useToast();
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-display text-xl font-bold text-primary">Financial Reports</h1>
        <p className="mt-1 text-sm text-muted">
          Customer-wise complete ledger and payment receivables with aging.
        </p>
      </div>
      <div className="mb-4">
        <Tabs
          tabs={[
            { key: "ledger", label: "Customer Ledger" },
            { key: "receivables", label: "Receivables (Aging)" },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>
      {tab === "ledger" ? <CustomerLedgerTab /> : <ReceivablesTab />}
      {toast}
    </div>
  );
}
