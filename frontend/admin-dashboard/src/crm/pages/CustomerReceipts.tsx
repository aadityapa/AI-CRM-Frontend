/**
 * Customer Received Amount (7 Sep 2026, user request). Every bank credit
 * Finance records from a customer, and the employees' invoices it settled.
 *
 * 16 Oct 2026 (user ask: "remove it from Projects and map it with the branch"):
 * it is no longer a Projects hub tab. It lives in two places —
 *   * the customer BRANCH page (Customers ▸ customer ▸ branch ▸ Received
 *     Amount): `scope` = that customer + branch; the list shows only that
 *     branch's receipts and "Add received amount" is locked to it;
 *   * the "Received Amount" sidebar page (`received-amounts`, Finance / Admin):
 *     every branch, grouped Customer ▸ Branch.
 *
 * "Add received amount" asks for Received Date, Amount, Payment Mode,
 * Reference Number, the invoices it covers (multi-select, per employee) and
 * Notes. The server allocates the amount across the ticked invoices oldest
 * first; anything left over stays on the receipt as unallocated.
 *
 * TDS (16 Oct 2026, Finance ask): ticking an invoice in "Add received amount"
 * asks whether the customer deducted TDS (`TdsDeductionModal`: rate %, base
 * before GST / total) and shows the amount to receive from the customer. The
 * TDS settles the invoice beside the cash and is followed separately as
 * "Pending from client" — the chip on every receipt line opens it
 * (`TdsDetailModal`, Mark received when the Form 16A is in).
 *
 * 19 Oct 2026 (user ask): a third home — the CUSTOMER page's "Received Amount"
 * tab (after Project Employees): every branch of that customer, Add locked to
 * the customer (the branch is picked in the dialog). The dialog takes the
 * PROOF of the credit — a bank screenshot (paste with Ctrl+V), remittance
 * advice or UTR PDF (`POST /api/customer-receipts/proof`) — kept on the receipt
 * and on every invoice payment it makes; a saved receipt can get its proof
 * later (`PUT …/{id}/proof`). Each open invoice shows the month it bills, the
 * employee, project, due date and how late it is.
 *
 * API: routers/crm/customer_receipts.py.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock, FileImage, Lock, MapPin, Paperclip, Pencil, Percent, Plus, Trash2, Upload, Wallet, X } from "lucide-react";
import {
  DEFAULT_SECTIONS, TdsChip, TdsDeductionModal, TdsDetailModal, netDue,
  type TdsChoice, type TdsInfo, type TdsSection,
} from "../components/invoice/TdsDeduction";
import { DialogActions, DialogFailure, DialogHero, DialogSection } from "../components/dialogKit";
import { crmDelete, crmGet, crmPost, crmPut, crmUpload, qs } from "../api";
import { fileViewHref } from "./FileView";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanAct } from "../useAccess";
import { useActiveCustomers } from "../lib/activeCustomers";
import { DataTable } from "../components/DataTable";
import type { Column, ColumnFilterValue } from "../components/DataTable";
import { CustomerGroupedList, ViewToggle, useGroupView } from "../components/CustomerGroupedList";
import { fetchAllMaster } from "../lib/fetchAllMaster";
import { CrmLink } from "../routerHooks";
import { HERO_BTN_SOLID, PageHeader } from "../components/PageHeader";
import {
  ConfirmModal, ErrorBox, Modal, StatusBadge, btnPrimary, inputCls, useToast,
} from "../components/ui";

type Allocation = {
  payment_id: number | null; invoice_id: number; amount: number;
  /** 16 Oct 2026 — the TDS the customer withheld on this invoice. */
  tds?: TdsInfo | null; tds_booked_here?: boolean;
  invoice_number?: string; employee_name?: string | null; project_name?: string | null;
  balance_amount?: number; payment_status?: string;
  /** 16 Oct 2026 — the month the invoice bills and its branch. */
  month_label?: string | null; branch_name?: string | null;
};
type Receipt = {
  id: number; customer_id: number; customer_name?: string | null;
  /** The paying branch (16 Oct 2026); null = before that / no branch. */
  branch_id?: number | null; branch_name?: string | null;
  received_date: string; amount: number; payment_mode?: string | null;
  reference_number?: string | null; notes?: string | null;
  unallocated_amount: number; allocated_amount: number; created_at?: string | null;
  /** TDS withheld on the invoices of this receipt, and what is still pending from the client. */
  tds_total?: number; tds_pending?: number;
  /** Proof of the credit (19 Oct 2026) — screenshot / remittance advice. */
  proof_url?: string | null; proof_name?: string | null;
  allocations: Allocation[];
};
type InvoiceOption = {
  id: number; invoice_number: string; invoice_date: string | null; project_name?: string | null;
  employee_name?: string | null; grand_total: number; paid_amount: number; balance_amount: number;
  payment_status: string;
  /** 16 Oct 2026 — the TDS base (value before GST), GST, and any TDS already on record. */
  sub_total: number; tax_amount: number; tds_deducted?: number; tds?: TdsInfo | null;
  /** 8 Oct 2026 — why money cannot go on it yet (customer approval / IRN); null = open. */
  payment_block?: string | null;
  /** 16 Oct 2026 — the branch it belongs to and the month it bills. */
  branch_id?: number | null; branch_name?: string | null;
  month?: string | null; month_label?: string | null; due_date?: string | null;
};
type BranchOption = { id: number; name: string; invoices: number; balance: number };
/** The branch page's scope — the list and the Add dialog are locked to it.
 *  Without `branchId` (the customer page's tab, 19 Oct 2026) it is the whole
 *  customer: every branch listed, the branch picked in the Add dialog. */
export type BranchScope = { customerId: number; customerName?: string | null; branchId?: number | null; branchName?: string | null };

/** One group per (customer, branch) in the grouped view — a stable number key. */
const groupKey = (r: { customer_id: number; branch_id?: number | null }) => r.customer_id * 100000 + (r.branch_id || 0);

const PAYMENT_MODES = ["NEFT", "RTGS", "IMPS", "UPI", "Cheque", "Cash", "Wire", "Other"];
const inr = (v: number | null | undefined) =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
/** Days an open invoice is past its due date (0 when not yet due). PURE. */
export function daysLate(due: string | null | undefined, today: Date = new Date()): number {
  if (!due) return 0;
  const d = new Date(`${due.slice(0, 10)}T00:00:00`);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((t.getTime() - d.getTime()) / 86400000));
}

/** "Proof" chip — opens the stored file in the CRM's file viewer. */
function ProofChip({ url, name }: { url: string; name?: string | null }) {
  const href = fileViewHref(url, name || "Payment proof");
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
      title={name || "Proof of payment"}
      className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800 ring-1 ring-inset ring-sky-200 hover:underline dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-800">
      <Paperclip size={11} aria-hidden /> Proof
    </a>
  );
}

export function CustomerReceiptsPage({ scope, standalone = false }: {
  /** Set on the branch page: only that branch, Add locked to it. */
  scope?: BranchScope;
  /** The sidebar page: full-width header, grouped Customer ▸ Branch. */
  standalone?: boolean;
} = {}) {
  const canEdit = useCanAct("invoices", "edit", useHasRole("Finance"));
  const [toastNode, showToast] = useToast();
  const [rows, setRows] = useState<Receipt[]>([]);
  const [meta, setMeta] = useState<(Meta & { total_received?: number }) | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<{ by: string; dir: "asc" | "desc" }>({ by: "received_date", dir: "desc" });
  const [colFilters, setColFilters] = useState<Record<string, ColumnFilterValue>>({});
  const [customers, setCustomers] = useState<{ value: string; label: string }[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [removing, setRemoving] = useState<Receipt | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  // "TDS pending from client" pop-up (16 Oct 2026).
  const [tdsOpen, setTdsOpen] = useState<{ tds: TdsInfo; invoiceNumber?: string | null } | null>(null);
  const canMarkTds = useCanAct("tds", "edit", useHasRole("Finance"));

  useEffect(() => {
    const t = window.setTimeout(() => { setDebounced(search); setPage(1); }, 350);
    return () => window.clearTimeout(t);
  }, [search]);
  useEffect(() => {
    crmGet<any[]>("/api/customers/names")
      .then((r) => setCustomers((r.data || []).map((c: any) => ({ value: String(c.id), label: String(c.name) }))
        .sort((a: any, b: any) => a.label.localeCompare(b.label))))
      .catch(() => {});
  }, []);

  // Customer-wise view (14 Sep 2026, like Purchase Orders): fetch every page
  // of the current filters so each customer's section is complete.
  const [groupView, setView] = useGroupView();
  // A branch's own list is short and has one customer — always the flat table.
  const view = scope ? "flat" : groupView;
  // Primitives, so a parent re-render (a fresh `scope` object) never refetches.
  const scopeCustomer = scope?.customerId ?? null;
  const scopeBranch = scope?.branchId ?? null;
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = {
        search: debounced, sort_by: sort.by, sort_dir: sort.dir,
        customer_id: scopeCustomer ?? (colFilters.customer_name?.value || undefined),
        branch_id: scopeBranch ?? undefined,
        payment_mode: colFilters.payment_mode?.value || undefined,
        received_from: colFilters.received_date?.from || undefined,
        received_to: colFilters.received_date?.to || undefined,
      };
      if (view === "customer") {
        setRows(await fetchAllMaster<Receipt>("/api/customer-receipts", params));
        setMeta(undefined);
      } else {
        const res = await crmGet<Receipt[]>(`/api/customer-receipts${qs({ ...params, page, limit: 20 })}`);
        setRows(res.data || []);
        setMeta(res.meta as any);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load received amounts");
    } finally {
      setLoading(false);
    }
  }, [page, debounced, sort, colFilters, view, scopeCustomer, scopeBranch]);
  useEffect(() => { load(); }, [load]);

  const columns: Column<Receipt>[] = useMemo(() => { const all: Column<Receipt>[] = [
    { key: "received_date", label: "Received", sortable: true, render: (r) => fmtDate(r.received_date),
      filter: { type: "date-range" } },
    { key: "customer_name", label: "Customer", sortable: true, render: (r) => r.customer_name || "—",
      filter: { type: "select", options: customers } },
    { key: "branch_name", label: "Branch", sortable: true, render: (r) => r.branch_name
      ? <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800 dark:bg-teal-950/40 dark:text-teal-200"><MapPin size={11} aria-hidden /> {r.branch_name}</span>
      : <span className="text-muted">—</span> },
    { key: "amount", label: "Amount", sortable: true, align: "right",
      render: (r) => (
        <span className="block text-right">
          <span className="font-semibold tabular-nums text-primary">{inr(r.amount)}</span>
          {Number(r.tds_total || 0) > 0 && (
            <span className={`block text-[11px] tabular-nums ${Number(r.tds_pending || 0) > 0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}
              title="TDS the customer withheld on these invoices">
              + TDS {inr(r.tds_total)}{Number(r.tds_pending || 0) > 0 ? " pending" : " received"}
            </span>
          )}
        </span>
      ) },
    { key: "payment_mode", label: "Mode", render: (r) => r.payment_mode || "—",
      filter: { type: "select", options: PAYMENT_MODES.map((m) => ({ value: m, label: m })) } },
    { key: "reference_number", label: "Reference", render: (r) => (
      <span className="flex flex-col items-start gap-1">
        <span>{r.reference_number || "—"}</span>
        {r.proof_url ? <ProofChip url={r.proof_url} name={r.proof_name} />
          : <span className="text-[11px] text-muted">No proof</span>}
      </span>
    ) },
    { key: "invoices", label: "Invoices settled", render: (r) => (
      <div className="flex max-w-[320px] flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
        {r.allocations.length === 0 && <span className="text-muted">— (on account)</span>}
        {r.allocations.map((a) => (
          <span key={a.invoice_id} className="inline-flex flex-wrap items-center gap-1">
            <CrmLink to={`invoices/${a.invoice_id}`}
              className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-primary ring-1 ring-inset ring-subtle hover:underline"
              title={`${a.invoice_number || `#${a.invoice_id}`}${a.month_label ? ` · ${a.month_label}` : ""} — ${inr(a.amount)} applied`}>
              {a.employee_name || a.invoice_number || `#${a.invoice_id}`}
              {a.month_label && <span className="text-teal-700 dark:text-teal-300">{a.month_label}</span>}
              <span className="text-muted">{inr(a.amount)}</span>
            </CrmLink>
            {a.tds && (
              <TdsChip tds={a.tds} compact onClick={() => setTdsOpen({ tds: a.tds as TdsInfo, invoiceNumber: a.invoice_number })} />
            )}
          </span>
        ))}
        {r.unallocated_amount > 0 && (
          <span className="inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning"
            title="Received but not applied to any invoice">
            Unallocated {inr(r.unallocated_amount)}
          </span>
        )}
      </div>
    ) },
    { key: "notes", label: "Notes", render: (r) => (
      <span className="block max-w-[220px] truncate text-secondary" title={r.notes || ""}>{r.notes || "—"}</span>
    ) },
  ];
    return all.filter((c) => !scope || (c.key !== "customer_name" && (c.key !== "branch_name" || !scope.branchId)));
  }, [customers, scope]);

  const totalShown = rows.reduce((a, r) => a + Number(r.amount || 0), 0);
  const tdsPendingShown = rows.reduce((a, r) => a + Number(r.tds_pending || 0), 0);
  const tdsLink = tdsPendingShown > 0 ? (
    <CrmLink to="tds" className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-300 hover:underline dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800"
      title="TDS the customer withheld that is still pending from the client — open the TDS register">
      <Percent size={12} aria-hidden /> TDS pending from client {inr(tdsPendingShown)}
    </CrmLink>
  ) : null;
  return (
    <div className="space-y-4">
      {toastNode}
      {standalone ? (
        <PageHeader icon={Wallet} accent="teal" eyebrow="Finance" title="Received Amount"
          subtitle="Money received from each customer branch, and the employees' invoices it settled. Also on every branch page (Customers ▸ customer ▸ branch)."
          stats={[
            { label: view === "customer" ? "receipts" : "receipts in this filter", value: meta?.total ?? rows.length },
            ...(meta?.total_received != null ? [{ label: "received (this filter)", value: inr(meta.total_received) }]
              : view === "customer" ? [{ label: "received", value: inr(totalShown) }] : []),
          ]}
          actions={canEdit ? (
            <button className={HERO_BTN_SOLID} onClick={() => setShowAdd(true)}>
              <Plus size={15} /> Add received amount
            </button>
          ) : undefined}>
          {tdsLink}
        </PageHeader>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-primary">
              {scope ? `Received from ${scope.branchName || scope.customerName || "this customer"}` : "Customer Received Amount"}
            </h2>
            <p className="text-xs text-muted">
              {scope?.branchId
                ? "Money this branch paid, and the employees' invoices of this branch it settled."
                : scope
                ? "Every amount this customer paid, branch by branch, with its proof and the employees' invoices it settled."
                : "Money received from customers, recorded by Finance, and the employees\u2019 invoices it settled."}
              {meta?.total_received != null && (
                <> Total received{scope ? "" : " (this filter)"}: <b className="text-primary">{inr(meta.total_received)}</b>.</>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {tdsLink}
            {canEdit && (
              <button className={btnPrimary} onClick={() => setShowAdd(true)}>
                <Plus size={15} /> Add received amount
              </button>
            )}
          </div>
        </div>
      )}
      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : view === "customer" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${inputCls} !w-64`} placeholder="Search reference, notes, customer or branch…" value={search}
              onChange={(e) => setSearch(e.target.value)} aria-label="Search received amounts" />
            <ViewToggle view={view} onChange={setView} />
            <span className="ml-auto text-xs text-muted">
              {rows.length} receipt{rows.length === 1 ? "" : "s"} · total {inr(rows.reduce((a, r) => a + Number(r.amount || 0), 0))}
            </span>
          </div>
          <CustomerGroupedList<Receipt>
            rows={rows}
            loading={loading}
            columns={columns.filter((c) => c.key !== "customer_name" && c.key !== "branch_name")}
            customerId={(r) => groupKey(r)}
            customerName={(r) => `${r.customer_name || `Customer #${r.customer_id}`} · ${r.branch_name || "No branch on record"}`}
            noun="receipt"
            summary={(rs) => (
              <>
                <span>Received <span className="font-semibold text-primary tnum">{inr(rs.reduce((a, r) => a + Number(r.amount || 0), 0))}</span></span>
                <span>Unallocated <span className="font-semibold text-primary tnum">{inr(rs.reduce((a, r) => a + Number(r.unallocated_amount || 0), 0))}</span></span>
              </>
            )}
            onRowClick={(r) => setExpanded((cur) => (cur === r.id ? null : r.id))}
            rowKey={(r) => r.id}
            empty={<div className="rounded-card border border-subtle bg-surface-1 p-6 text-sm text-muted">No amounts received yet — Finance records the first one with “Add received amount”.</div>}
            rowActions={canEdit ? (r) => (
              <button type="button"
                className="inline-flex items-center justify-center rounded-control p-1.5 text-muted transition-colors hover:bg-danger-soft hover:!text-danger"
                title="Remove this receipt and restore the invoice balances"
                onClick={() => setRemoving(r)}>
                <Trash2 size={15} />
              </button>
            ) : undefined}
          />
        </div>
      ) : (
        <DataTable<Receipt>
          columns={columns}
          rows={rows}
          meta={meta}
          loading={loading}
          search={search}
          onSearch={setSearch}
          sort={sort}
          onSort={(by) => setSort((s) => ({ by, dir: s.by === by && s.dir === "desc" ? "asc" : "desc" }))}
          onPage={setPage}
          columnFilters={colFilters}
          onColumnFilter={(key, v) => {
            setColFilters((prev) => { const n = { ...prev }; if (v) n[key] = v; else delete n[key]; return n; });
            setPage(1);
          }}
          onRowClick={(r) => setExpanded((cur) => (cur === r.id ? null : r.id))}
          headerRight={meta ? (
            <span className="whitespace-nowrap text-xs font-medium text-muted">
              {meta.total} receipt{meta.total === 1 ? "" : "s"}, page {meta.page}/{Math.max(1, meta.pages || 1)}
            </span>
          ) : undefined}
          filters={scope ? undefined : <ViewToggle view={view} onChange={setView} />}
          emptyMessage="No amounts received yet — Finance records the first one with “Add received amount”."
          rowActions={canEdit ? (r) => (
            <button type="button"
              className="inline-flex items-center justify-center rounded-control p-1.5 text-muted transition-colors hover:bg-danger-soft hover:!text-danger"
              title="Remove this receipt and restore the invoice balances"
              onClick={(e) => { e.stopPropagation(); setRemoving(r); }}>
              <Trash2 size={15} />
            </button>
          ) : undefined}
        />
      )}
      {expanded != null && (() => {
        const r = rows.find((x) => x.id === expanded);
        if (!r) return null;
        return (
          <div className="rounded-card border border-subtle bg-surface-1 p-4 text-sm">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-primary">Receipt #{r.id} — {r.customer_name}{r.branch_name ? ` (${r.branch_name})` : ""} · {inr(r.amount)} on {fmtDate(r.received_date)}</span>
              <button className="text-xs text-sky-600 hover:underline" onClick={() => setExpanded(null)}>Close</button>
            </div>
            {r.allocations.length === 0 ? (
              <p className="text-muted">Not applied to any invoice (held on account).</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs uppercase text-muted">
                  <th className="py-1">Invoice</th><th>Month</th><th>Employee</th><th>Project</th><th className="text-right">Cash applied</th><th>TDS</th><th className="text-right">Balance now</th><th>Status</th>
                </tr></thead>
                <tbody>
                  {r.allocations.map((a) => (
                    <tr key={a.invoice_id} className="border-t border-subtle">
                      <td className="py-1.5"><CrmLink to={`invoices/${a.invoice_id}`} className="font-semibold text-sky-600 hover:underline">{a.invoice_number || `#${a.invoice_id}`}</CrmLink></td>
                      <td>{a.month_label || "—"}</td>
                      <td>{a.employee_name || "—"}</td>
                      <td>{a.project_name || "—"}</td>
                      <td className="text-right tabular-nums">{inr(a.amount)}</td>
                      <td>{a.tds ? <TdsChip tds={a.tds} onClick={() => setTdsOpen({ tds: a.tds as TdsInfo, invoiceNumber: a.invoice_number })} /> : <span className="text-muted">—</span>}</td>
                      <td className="text-right tabular-nums">{inr(a.balance_amount)}</td>
                      <td>{a.payment_status ? <StatusBadge status={a.payment_status} /> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {r.notes && <p className="mt-2 whitespace-pre-wrap text-secondary">{r.notes}</p>}
            <ReceiptProofRow receipt={r} canEdit={canEdit}
              onSaved={(msg) => { showToast(msg); load(); }} onError={(m) => showToast(m, "err")} />
          </div>
        );
      })()}
      {showAdd && (
        <AddReceiptModal
          customers={customers}
          preset={scope}
          onClose={() => setShowAdd(false)}
          onSaved={(msg) => { setShowAdd(false); showToast(msg); load(); }}
        />
      )}
      {tdsOpen && (
        <TdsDetailModal tds={tdsOpen.tds} invoiceNumber={tdsOpen.invoiceNumber} canMark={canMarkTds}
          onClose={() => setTdsOpen(null)}
          onChanged={(msg) => { setTdsOpen(null); showToast(msg); load(); }} />
      )}
      {removing && (
        <ConfirmModal
          title="Remove this receipt?"
          message={`${inr(removing.amount)} received from ${removing.customer_name} on ${fmtDate(removing.received_date)} will be removed and the ${removing.allocations.length} invoice(s) it settled will show their balance again${Number(removing.tds_total || 0) > 0 ? ` (the TDS ${inr(removing.tds_total)} recorded with it is removed too)` : ""}.`}
          confirmLabel="Remove"
          danger
          busy={removeBusy}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            setRemoveBusy(true);
            try {
              const res = await crmDelete(`/api/customer-receipts/${removing.id}`);
              showToast(res.message || "Receipt removed");
              setRemoving(null);
              load();
            } catch (e: any) {
              showToast(e?.message || "Failed to remove", "err");
            } finally {
              setRemoveBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

/** "2026-10-08" for today minus `daysBack`, in local time. PURE. */
function isoDay(daysBack = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * "Add received amount" (redesigned 8 Oct 2026 on the dialog kit): the money
 * (customer · amount · date · mode · reference) → the invoices it settles
 * (an invoice still waiting for the customer's approval / its IRN is shown
 * LOCKED with the reason — the server refuses it too) → notes, with a live
 * "where the money goes" summary beside it. Same POST as before.
 */
function AddReceiptModal({ customers, preset, onClose, onSaved }: {
  customers: { value: string; label: string }[];
  /** From the branch page — customer and branch fixed. */
  preset?: BranchScope;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [customerId, setCustomerId] = useState(preset ? String(preset.customerId) : "");
  // Active customers — the Customers tab's list (12 Oct 2026); inactive ones on request.
  const [showInactive, setShowInactive] = useState(false);
  const pickList = useActiveCustomers(customerId, { includeInactive: showInactive });
  const [receivedDate, setReceivedDate] = useState(() => isoDay(0));
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("NEFT");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [options, setOptions] = useState<InvoiceOption[]>([]);
  const [optLoading, setOptLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [invQuery, setInvQuery] = useState("");
  /* One payment = one branch (16 Oct 2026, user decision): "" = not picked,
     "none" = invoices with no branch on record, else the branch id. */
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [noBranch, setNoBranch] = useState<{ invoices: number; balance: number } | null>(null);
  const presetBranch = preset?.branchId ?? null;
  const [branchKey, setBranchKey] = useState(presetBranch ? String(presetBranch) : "");
  const [invMonth, setInvMonth] = useState("");
  const needsBranch = branches.length > 0 || !!noBranch;
  const branchStep = needsBranch && !presetBranch;
  const branchOptions = useMemo(() => options.filter((o) => !needsBranch || !branchKey ? !needsBranch
    : branchKey === "none" ? !o.branch_id : String(o.branch_id) === branchKey), [options, needsBranch, branchKey]);
  const monthChoices = useMemo(() => [...new Map(branchOptions.filter((o) => o.month)
    .map((o) => [o.month as string, o.month_label || o.month])).entries()].sort((a, b) => b[0].localeCompare(a[0])),
  [branchOptions]);
  // TDS per ticked invoice (16 Oct 2026): a choice, null = "no TDS", absent = not asked.
  const [tdsMap, setTdsMap] = useState<Record<number, TdsChoice | null>>({});
  const [tdsAsk, setTdsAsk] = useState<InvoiceOption | null>(null);
  const [defaultRate, setDefaultRate] = useState(10);
  const [sections, setSections] = useState<TdsSection[]>(DEFAULT_SECTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Proof of the credit (19 Oct 2026): uploaded as soon as it is picked / pasted.
  const [proof, setProof] = useState<{ url: string; name: string; preview?: string } | null>(null);
  const [proofBusy, setProofBusy] = useState(0);
  const uploadProof = useCallback(async (file: File) => {
    if (file.size > 15 * 1024 * 1024) { setError("The proof file is larger than 15 MB"); return; }
    setError("");
    setProofBusy(1);
    try {
      const res = await crmUpload<{ url: string; name: string }>("/api/customer-receipts/proof", file, {},
        (pct) => setProofBusy(Math.max(1, pct)));
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      setProof({ url: res.data.url, name: res.data.name || file.name, preview });
    } catch (e: any) {
      setError(e?.message || "Could not upload the proof");
    } finally {
      setProofBusy(0);
    }
  }, []);
  // A screenshot pasted anywhere in the dialog (Ctrl+V) becomes the proof.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === "file");
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      const named = file.name && file.name !== "image.png" ? file
        : new File([file], `payment-screenshot-${isoDay(0)}.${(file.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: file.type });
      void uploadProof(named);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [uploadProof]);
  const openOptions = useMemo(() => branchOptions.filter((o) => !o.payment_block), [branchOptions]);
  /* Search across invoice no., employee, project and month; ticked rows stay in
     the list whatever the query so a selection can't silently vanish. */
  const visibleOptions = useMemo(() => {
    const q = invQuery.trim().toLowerCase();
    return branchOptions.filter((o) => selected.has(o.id) || (
      (!invMonth || o.month === invMonth)
      && (!q || [o.invoice_number, o.employee_name, o.project_name, o.month_label]
        .filter(Boolean).join(" ").toLowerCase().includes(q))));
  }, [branchOptions, invQuery, invMonth, selected]);

  useEffect(() => {
    setSelected(new Set());
    setTdsMap({});
    setBranchKey("");
    setInvMonth("");
    if (!customerId) { setOptions([]); setBranches([]); setNoBranch(null); return; }
    let alive = true;
    setOptLoading(true);
    crmGet<InvoiceOption[]>(`/api/customer-receipts/invoice-options?customer_id=${customerId}`)
      .then((r) => {
        if (!alive) return;
        setOptions(r.data || []);
        const m = (r.meta || {}) as { branches?: BranchOption[]; no_branch?: { invoices: number; balance: number };
          default_tds_rate?: number; tds_sections?: TdsSection[] };
        if (m.default_tds_rate) setDefaultRate(Number(m.default_tds_rate));
        if (m.tds_sections?.length) setSections(m.tds_sections);
        const bs = m.branches || [];
        setBranches(bs);
        setNoBranch(m.no_branch || null);
        // From the branch page → that branch; one branch and nothing unassigned → pick it.
        if (presetBranch) setBranchKey(String(presetBranch));
        else if (bs.length === 1 && !m.no_branch) setBranchKey(String(bs[0].id));
      })
      .catch((e: any) => { if (alive) setError(e?.message || "Could not load invoices"); })
      .finally(() => { if (alive) setOptLoading(false); });
    return () => { alive = false; };
  }, [customerId, presetBranch]);

  const amt = Number(amount) || 0;
  /** What the customer owes in money on an invoice once its TDS is taken off. */
  const tdsFor = (id: number) => tdsMap[id]?.amount ?? 0;
  const dueFor = (o: InvoiceOption) => netDue(o.balance_amount, tdsFor(o.id));
  // Preview the oldest-first allocation so Finance sees where the money goes.
  const preview = useMemo(() => {
    let left = amt;
    const rows: { id: number; take: number }[] = [];
    for (const o of branchOptions.filter((x) => selected.has(x.id))) {
      if (left <= 0) break;
      const take = Math.min(netDue(o.balance_amount, tdsMap[o.id]?.amount ?? 0), left);
      rows.push({ id: o.id, take });
      left = Math.round((left - take) * 100) / 100;
    }
    return { rows, left };
  }, [amt, branchOptions, selected, tdsMap]);
  const takeFor = (id: number) => preview.rows.find((r) => r.id === id)?.take ?? 0;
  const allocated = Math.max(0, amt - preview.left);
  const ticked = options.filter((o) => selected.has(o.id));
  /** The amount to receive from the customer for the ticked invoices (balance − TDS). */
  const selectedBalance = ticked.reduce((t, o) => t + dueFor(o), 0);
  const tdsTotal = ticked.reduce((t, o) => t + tdsFor(o.id), 0);
  const toggle = (o: InvoiceOption) => {
    if (o.payment_block) return;
    if (selected.has(o.id)) {
      setSelected((s) => { const n = new Set(s); n.delete(o.id); return n; });
      setTdsMap((m) => { const n = { ...m }; delete n[o.id]; return n; });
      return;
    }
    // Ticking asks about TDS first — unless TDS is already on record for it.
    if (o.tds) { setSelected((s) => new Set(s).add(o.id)); return; }
    setTdsAsk(o);
  };
  const answerTds = (o: InvoiceOption, choice: TdsChoice | null) => {
    setTdsMap((m) => ({ ...m, [o.id]: choice }));
    setSelected((s) => new Set(s).add(o.id));
    setTdsAsk(null);
  };
  const missing = !customerId ? "Pick the customer" : needsBranch && !branchKey ? "Pick the branch that paid" : !receivedDate ? "Pick the received date" : !(amt > 0) ? "Enter the amount received" : "";

  const submit = async () => {
    setError("");
    if (missing) { setError(missing); return; }
    setBusy(true);
    try {
      const res = await crmPost("/api/customer-receipts", {
        customer_id: Number(customerId), received_date: receivedDate, amount: amt,
        branch_id: branchKey && branchKey !== "none" ? Number(branchKey) : null,
        payment_mode: mode || null, reference_number: reference.trim() || null,
        notes: notes.trim() || null, invoice_ids: [...selected],
        proof_url: proof?.url || null, proof_name: proof?.name || null,
        tds: [...selected].filter((id) => tdsMap[id]).map((id) => ({
          invoice_id: id, tds_rate: tdsMap[id]!.rate, tds_base: tdsMap[id]!.base, section: tdsMap[id]!.section || null,
        })),
      });
      onSaved(res.message || "Received amount recorded");
    } catch (e: any) {
      setError(e?.message || "Failed to save");
      setBusy(false);
    }
  };

  const customerName = preset
    ? `${preset.customerName || customers.find((c) => c.value === customerId)?.label || "Customer"}${preset.branchName ? ` · ${preset.branchName}` : ""}`
    : customers.find((c) => c.value === customerId)?.label;
  return (
    <Modal title="Add received amount" onClose={onClose} wide dirty={!!(amount || reference || notes || selected.size || proof)}
      hero={<DialogHero tone="emerald" icon={Wallet} eyebrow="Customer received amount" title="Record money received"
        subtitle={customerName ? <>From <b>{customerName}</b> — settle their invoices, the rest stays on account.</> : "A bank credit from a customer, settled against their invoices."}
        flow={{ steps: ["Money received", "Invoices settled", "Balance on account"], current: selected.size ? 1 : 0 }} />}
      footer={<DialogActions tone="emerald" icon={Wallet} label={amt > 0 ? `Save ${inr(amt)}` : "Save received amount"}
        busy={busy} disabled={!!missing} onCancel={onClose} onConfirm={() => void submit()}
        hint={missing ? <span className="text-warning">{missing}</span> : "Ctrl + Enter to save"} />}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="space-y-4">
          <DialogSection n={1} title="Proof of payment" tone="emerald" optional done={!!proof}
            hint="Attach the bank screenshot, remittance advice or UTR PDF. Paste a screenshot with Ctrl + V. It is kept with the receipt and on every invoice it settles.">
            <ProofPicker proof={proof} busy={proofBusy} onPick={(f) => void uploadProof(f)}
              onClear={() => setProof(null)} />
          </DialogSection>
          <DialogSection n={2} title="The money" tone="emerald" done={!!customerId && amt > 0 && !!receivedDate}>
            <div className="grid gap-3 sm:grid-cols-2">
              {preset ? (
                <div className="flex items-center gap-2 rounded-control border border-subtle bg-surface-2 px-3 py-2 text-sm sm:col-span-2">
                  <MapPin size={14} className="text-emerald-600" aria-hidden />
                  <span className="text-secondary">Recording for</span>
                  <b className="text-primary">{preset.customerName || "this customer"}{preset.branchName ? ` · ${preset.branchName}` : ""}</b>
                </div>
              ) : (
                <>
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-xs font-semibold text-secondary">Customer *</span>
                    <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                      <option value="">— pick customer —</option>
                      {pickList.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                    </select>
                  </label>
                  <label className="-mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted sm:col-span-2">
                    <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                    Include inactive customers (money still owed by a customer made inactive)
                  </label>
                </>
              )}
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-secondary">Amount received (₹) *</span>
                <input type="number" min={0} step="0.01" className={`${inputCls} text-lg font-bold tabular-nums`} value={amount}
                  placeholder="0.00" onChange={(e) => setAmount(e.target.value)} />
                {selectedBalance > 0 && (
                  <button type="button" className="mt-1 text-[11px] font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                    onClick={() => setAmount(String(Math.round(selectedBalance * 100) / 100))}>
                    {tdsTotal > 0 ? "Use the amount to receive (after TDS)" : "Use the ticked balance"} · {inr(selectedBalance)}
                  </button>
                )}
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-secondary">Received on *</span>
                <input type="date" className={inputCls} value={receivedDate} max={isoDay(0)} onChange={(e) => setReceivedDate(e.target.value)} />
                <span className="mt-1 flex gap-1.5">
                  {[["Today", 0], ["Yesterday", 1]].map(([label, back]) => (
                    <button key={label} type="button" className={pillCls(receivedDate === isoDay(Number(back)))}
                      onClick={() => setReceivedDate(isoDay(Number(back)))}>{label}</button>
                  ))}
                </span>
              </label>
              <div className="sm:col-span-2">
                <span className="mb-1 block text-xs font-semibold text-secondary">Payment mode</span>
                <div className="flex flex-wrap gap-1.5">
                  {PAYMENT_MODES.map((m) => (
                    <button key={m} type="button" className={pillCls(mode === m)} onClick={() => setMode(m)}>{m}</button>
                  ))}
                </div>
              </div>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-semibold text-secondary">Reference number</span>
                <input className={`${inputCls} font-mono`} value={reference} placeholder="UTR / cheque no. / transaction id"
                  onChange={(e) => setReference(e.target.value)} />
              </label>
            </div>
          </DialogSection>

          {branchStep && (
            <DialogSection n={3} title="Branch that paid" tone="emerald" done={!!branchKey}
              hint="One payment belongs to one branch — only that branch's employee invoices are offered.">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Branch that paid">
                {branches.map((b) => (
                  <button key={b.id} type="button" role="radio" aria-checked={branchKey === String(b.id)}
                    onClick={() => { setBranchKey(String(b.id)); setSelected(new Set()); setInvMonth(""); }}
                    className={`rounded-card border px-3 py-2 text-left text-sm transition-colors ${branchKey === String(b.id)
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "border-subtle bg-surface-1 hover:border-emerald-300"}`}>
                    <span className="flex items-center gap-1 font-semibold text-primary"><MapPin size={13} aria-hidden /> {b.name}</span>
                    <span className="block text-[11px] text-muted">{b.invoices} open · {inr(b.balance)}</span>
                  </button>
                ))}
                {noBranch && (
                  <button type="button" role="radio" aria-checked={branchKey === "none"}
                    onClick={() => { setBranchKey("none"); setSelected(new Set()); setInvMonth(""); }}
                    className={`rounded-card border px-3 py-2 text-left text-sm transition-colors ${branchKey === "none"
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "border-subtle bg-surface-1 hover:border-emerald-300"}`}>
                    <span className="font-semibold text-primary">No branch on record</span>
                    <span className="block text-[11px] text-muted">{noBranch.invoices} open · {inr(noBranch.balance)}</span>
                  </button>
                )}
              </div>
            </DialogSection>
          )}

          <DialogSection n={branchStep ? 4 : 3} title="Invoices it settles" tone="emerald" done={selected.size > 0} optional
            hint="Ticking an invoice asks whether the customer deducted TDS. Settled oldest first; an invoice still waiting for the customer's approval or its IRN cannot take money yet."
            action={options.length > 0 ? (
              <div className="flex gap-2 text-xs font-semibold">
                <button type="button" className="text-emerald-700 hover:underline dark:text-emerald-300"
                  onClick={() => setSelected((s) => { const n = new Set(s); visibleOptions.forEach((o) => { if (!o.payment_block) n.add(o.id); }); return n; })}>
                  Select all open{invQuery ? " shown" : ""}
                </button>
                {selected.size > 0 && (
                  <button type="button" className="text-muted hover:underline" onClick={() => setSelected(new Set())}>Clear</button>
                )}
              </div>
            ) : undefined}>
            {!customerId ? (
              <p className="text-xs text-muted">Pick the customer to see their open invoices.</p>
            ) : optLoading ? (
              <p className="text-xs text-muted">Loading invoices…</p>
            ) : needsBranch && !branchKey ? (
              <p className="text-xs text-muted">Pick the branch that paid to see its invoices.</p>
            ) : branchOptions.length === 0 ? (
              <p className="text-xs text-muted">No open invoices here — the amount will be held on account.</p>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap gap-2">
                  <input className={`${inputCls} !w-auto min-w-[14rem] flex-1 text-sm`} value={invQuery}
                    placeholder="Search invoice no., employee, project or month…"
                    onChange={(e) => setInvQuery(e.target.value)} aria-label="Search invoices" />
                  {monthChoices.length > 1 && (
                    <select className={`${inputCls} !w-40 text-sm`} value={invMonth} onChange={(e) => setInvMonth(e.target.value)}
                      aria-label="Invoice month">
                      <option value="">All months</option>
                      {monthChoices.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                  )}
                </div>
                <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {visibleOptions.length === 0 && <li className="px-1 py-2 text-xs text-muted">No invoice matches “{invQuery}”.</li>}
                  {visibleOptions.map((o) => {
                    const on = selected.has(o.id);
                    const locked = !!o.payment_block;
                    const take = takeFor(o.id);
                    return (
                      <li key={o.id}>
                        <button type="button" onClick={() => toggle(o)} disabled={locked}
                          title={locked ? o.payment_block || "" : undefined}
                          className={`flex w-full items-center gap-3 rounded-control border px-3 py-2 text-left transition-colors ${locked
                            ? "cursor-not-allowed border-subtle bg-surface-2 opacity-70"
                            : on ? "border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30"
                              : "border-subtle bg-surface-1 hover:border-emerald-300"}`}>
                          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-subtle bg-surface-1"}`} aria-hidden>
                            {locked ? <Lock size={11} className="text-muted" /> : on ? <Check size={13} /> : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-primary">
                              {o.invoice_number} <span className="text-xs font-normal text-muted">· {fmtDate(o.invoice_date)}</span>
                              {o.month_label && (
                                <span className="ml-1.5 rounded-full bg-teal-50 px-1.5 py-px text-[11px] font-semibold text-teal-800 dark:bg-teal-950/40 dark:text-teal-200"
                                  title="The month this invoice bills">{o.month_label}</span>
                              )}
                            </span>
                            <span className="block truncate text-xs text-secondary">
                              {[o.employee_name, o.project_name, o.branch_name].filter(Boolean).join(" · ") || "—"}
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                              <span>Invoice {inr(o.grand_total)}</span>
                              {o.paid_amount > 0 && <span>· paid {inr(o.paid_amount)}</span>}
                              {o.due_date && (() => {
                                const late = daysLate(o.due_date);
                                return late > 0
                                  ? <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 font-semibold ${late > 60 ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"}`}>
                                      <Clock size={10} aria-hidden /> {late} d late (due {fmtDate(o.due_date)})</span>
                                  : <span>· due {fmtDate(o.due_date)}</span>;
                              })()}
                            </span>
                            {locked && <span className="block text-[11px] text-warning">{o.payment_block}</span>}
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-xs text-muted tabular-nums">Balance {inr(o.balance_amount)}</span>
                            <span className={`block text-sm font-bold tabular-nums ${on && take > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-muted"}`}>
                              {on ? (take > 0 ? `− ${inr(take)}` : "nothing left") : ""}
                            </span>
                          </span>
                        </button>
                        {on && (
                          <div className="ml-8 mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                            {o.tds ? (
                              <TdsChip tds={o.tds} />
                            ) : tdsMap[o.id] ? (
                              <>
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 ring-1 ring-inset ring-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800">
                                  <Percent size={11} aria-hidden /> TDS {tdsMap[o.id]!.rate}% · {inr(tdsMap[o.id]!.amount)} pending from client
                                </span>
                                <span className="font-semibold text-emerald-700 dark:text-emerald-300">To receive {inr(dueFor(o))}</span>
                                <button type="button" className="inline-flex items-center gap-1 font-semibold text-sky-600 hover:underline" onClick={() => setTdsAsk(o)}>
                                  <Pencil size={11} aria-hidden /> Change
                                </button>
                              </>
                            ) : (
                              <button type="button" className="inline-flex items-center gap-1 font-semibold text-amber-700 hover:underline dark:text-amber-300" onClick={() => setTdsAsk(o)}>
                                <Percent size={11} aria-hidden /> {o.id in tdsMap ? "No TDS — add TDS" : "TDS deducted? Add it"}
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {openOptions.length < branchOptions.length && (
                  <p className="mt-1.5 text-[11px] text-muted">
                    {branchOptions.length - openOptions.length} invoice(s) locked until the customer approves them and Finance adds the IRN.
                  </p>
                )}
              </>
            )}
          </DialogSection>

          <DialogSection n={branchStep ? 5 : 4} title="Notes" tone="emerald" optional done={!!notes.trim()}>
            <textarea className={`${inputCls} !h-auto min-h-[64px]`} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Part payment for August — balance promised next week" aria-label="Notes" />
          </DialogSection>
          {error && <DialogFailure message={error} />}
        </div>

        <aside className="h-max space-y-3 rounded-card border border-subtle bg-surface-1 p-4 shadow-raised lg:sticky lg:top-0">
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted">Where the money goes</div>
          <div>
            <div className="text-xs text-muted">Received</div>
            <div className="text-2xl font-extrabold tabular-nums text-primary">{inr(amt)}</div>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500"
              style={{ width: `${amt > 0 ? Math.min(100, Math.round((allocated / amt) * 100)) : 0}%` }} />
          </div>
          <dl className="space-y-1 text-sm [&>div]:gap-3">
            {tdsTotal > 0 && (
              <div className="flex justify-between" title="Withheld by the customer — settles the invoices, followed as pending from client">
                <dt className="text-muted">TDS withheld (pending from client)</dt>
                <dd className="font-semibold tabular-nums text-amber-700 dark:text-amber-300">{inr(tdsTotal)}</dd>
              </div>
            )}
            {selected.size > 0 && (
              <div className="flex justify-between"><dt className="text-muted">To receive from customer</dt><dd className="font-semibold tabular-nums text-primary">{inr(selectedBalance)}</dd></div>
            )}
            <div className="flex justify-between"><dt className="text-muted">Settles {preview.rows.length} invoice(s)</dt><dd className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{inr(allocated)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">On account</dt><dd className="font-semibold tabular-nums text-primary">{inr(preview.left)}</dd></div>
            {selectedBalance > amt && amt > 0 && (
              <div className="flex justify-between"><dt className="text-muted">Still due on ticked</dt><dd className="font-semibold tabular-nums text-warning">{inr(selectedBalance - amt)}</dd></div>
            )}
          </dl>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">Proof</span>
            {proof ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300"><Check size={13} aria-hidden /> attached</span>
              : <span className="text-amber-700 dark:text-amber-300">not attached</span>}
          </div>
          <p className="text-[11px] text-muted">Oldest invoice first, up to each balance less its TDS. Deleting the receipt later puts every amount back, TDS included.</p>
        </aside>
      </div>
      {tdsAsk && (
        <TdsDeductionModal
          invoice={tdsAsk}
          initial={tdsMap[tdsAsk.id]}
          defaultRate={defaultRate}
          sections={sections}
          customerName={preset?.customerName || customerName}
          onClose={() => setTdsAsk(null)}
          onSave={(choice) => answerTds(tdsAsk, choice)} />
      )}
    </Modal>
  );
}

/** Drop zone / picker for the proof; shows the uploaded file (an image previewed). */
function ProofPicker({ proof, busy, onPick, onClear }: {
  proof: { url: string; name: string; preview?: string } | null;
  busy: number;
  onPick: (f: File) => void;
  onClear: () => void;
}) {
  const [over, setOver] = useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  if (proof) {
    const href = fileViewHref(proof.url, proof.name);
    return (
      <div className="flex items-center gap-3 rounded-control border border-emerald-300 bg-emerald-50 p-2.5 dark:border-emerald-800 dark:bg-emerald-950/30">
        {proof.preview
          ? <img src={proof.preview} alt="Proof of payment" className="h-16 w-24 rounded border border-subtle object-cover" />
          : <span className="grid h-16 w-16 place-items-center rounded bg-surface-1 text-emerald-700"><FileImage size={24} aria-hidden /></span>}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-primary">{proof.name}</div>
          <div className="text-[11px] text-emerald-700 dark:text-emerald-300">Uploaded — saved with the receipt</div>
          {href && <a href={href} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-sky-600 hover:underline">Open</a>}
        </div>
        <button type="button" className="rounded p-1 text-muted hover:bg-surface-2 hover:text-rose-600" onClick={onClear} aria-label="Remove proof">
          <X size={15} aria-hidden />
        </button>
      </div>
    );
  }
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onPick(f); }}
      className={`flex flex-wrap items-center gap-3 rounded-control border-2 border-dashed px-4 py-3 transition-colors ${over
        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "border-subtle bg-surface-2"}`}>
      <Upload size={20} className="text-emerald-600" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold text-primary">{busy ? `Uploading… ${busy}%` : "Drop the screenshot or file here"}</div>
        <div className="text-[11px] text-muted">PNG / JPG screenshot, PDF, Excel or Word · up to 15 MB · or paste a screenshot (Ctrl + V)</div>
      </div>
      <button type="button" className="rounded-control border border-emerald-400 bg-surface-1 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300"
        disabled={!!busy} onClick={() => inputRef.current?.click()}>
        Choose file
      </button>
      <input ref={inputRef} type="file" className="hidden" accept="image/*,.pdf,.xls,.xlsx,.csv,.doc,.docx,.txt"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
    </div>
  );
}

/** In the expanded receipt: the proof, and attach / replace / remove it later. */
function ReceiptProofRow({ receipt, canEdit, onSaved, onError }: {
  receipt: Receipt; canEdit: boolean; onSaved: (msg: string) => void; onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const save = async (url: string | null, name: string | null) => {
    setBusy(true);
    try {
      const res = await crmPut(`/api/customer-receipts/${receipt.id}/proof`, { proof_url: url, proof_name: name });
      onSaved(res.message || "Proof saved");
    } catch (e: any) {
      onError(e?.message || "Could not save the proof");
    } finally {
      setBusy(false);
    }
  };
  const pick = async (file: File) => {
    setBusy(true);
    try {
      const up = await crmUpload<{ url: string; name: string }>("/api/customer-receipts/proof", file);
      await save(up.data.url, up.data.name || file.name);
    } catch (e: any) {
      onError(e?.message || "Could not upload the proof");
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-subtle pt-3 text-xs">
      <span className="font-semibold text-secondary">Proof of payment:</span>
      {receipt.proof_url ? <><ProofChip url={receipt.proof_url} name={receipt.proof_name} />
        <span className="text-muted">{receipt.proof_name}</span></> : <span className="text-muted">none attached</span>}
      {canEdit && (
        <>
          <button type="button" disabled={busy} className="font-semibold text-sky-600 hover:underline"
            onClick={() => inputRef.current?.click()}>{receipt.proof_url ? "Replace" : "Attach proof"}</button>
          {receipt.proof_url && (
            <button type="button" disabled={busy} className="font-semibold text-rose-600 hover:underline"
              onClick={() => void save(null, null)}>Remove</button>
          )}
          <input ref={inputRef} type="file" className="hidden" accept="image/*,.pdf,.xls,.xlsx,.csv,.doc,.docx,.txt"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ""; }} />
        </>
      )}
    </div>
  );
}

const pillCls = (on: boolean) => `rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${on
  ? "border-emerald-500 bg-emerald-600 text-white shadow-raised"
  : "border-subtle bg-surface-1 text-secondary hover:border-emerald-300 hover:text-primary"}`;

/** The "Received Amount" sidebar page — every branch, grouped Customer ▸ Branch. */
export function ReceivedAmountsPage() {
  return <CustomerReceiptsPage standalone />;
}
