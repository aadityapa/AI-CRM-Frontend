/**
 * Customer Received Amount (7 Sep 2026, user request) — the Projects hub tab
 * after Invoices. Every bank credit Finance records from a customer, and the
 * employees' invoices it settled.
 *
 * "Add received amount" asks for Received Date, Amount, Payment Mode,
 * Reference Number, the invoices it covers (multi-select, per employee) and
 * Notes. The server allocates the amount across the ticked invoices oldest
 * first; anything left over stays on the receipt as unallocated.
 *
 * API: routers/crm/customer_receipts.py.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Lock, Plus, Trash2, Wallet } from "lucide-react";
import { DialogActions, DialogFailure, DialogHero, DialogSection } from "../components/dialogKit";
import { crmDelete, crmGet, crmPost, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanAct } from "../useAccess";
import { DataTable } from "../components/DataTable";
import type { Column, ColumnFilterValue } from "../components/DataTable";
import { CustomerGroupedList, ViewToggle, useGroupView } from "../components/CustomerGroupedList";
import { fetchAllMaster } from "../lib/fetchAllMaster";
import { CrmLink } from "../routerHooks";
import {
  ConfirmModal, ErrorBox, Modal, StatusBadge, btnPrimary, inputCls, useToast,
} from "../components/ui";

type Allocation = {
  payment_id: number; invoice_id: number; amount: number;
  invoice_number?: string; employee_name?: string | null; project_name?: string | null;
  balance_amount?: number; payment_status?: string;
};
type Receipt = {
  id: number; customer_id: number; customer_name?: string | null;
  received_date: string; amount: number; payment_mode?: string | null;
  reference_number?: string | null; notes?: string | null;
  unallocated_amount: number; allocated_amount: number; created_at?: string | null;
  allocations: Allocation[];
};
type InvoiceOption = {
  id: number; invoice_number: string; invoice_date: string | null; project_name?: string | null;
  employee_name?: string | null; grand_total: number; paid_amount: number; balance_amount: number;
  payment_status: string;
  /** 8 Oct 2026 — why money cannot go on it yet (customer approval / IRN); null = open. */
  payment_block?: string | null;
};

const PAYMENT_MODES = ["NEFT", "RTGS", "IMPS", "UPI", "Cheque", "Cash", "Wire", "Other"];
const inr = (v: number | null | undefined) =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : "—");

export function CustomerReceiptsPage() {
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
  const [view, setView] = useGroupView();
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = {
        search: debounced, sort_by: sort.by, sort_dir: sort.dir,
        customer_id: colFilters.customer_name?.value || undefined,
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
  }, [page, debounced, sort, colFilters, view]);
  useEffect(() => { load(); }, [load]);

  const columns: Column<Receipt>[] = useMemo(() => [
    { key: "received_date", label: "Received", sortable: true, render: (r) => fmtDate(r.received_date),
      filter: { type: "date-range" } },
    { key: "customer_name", label: "Customer", sortable: true, render: (r) => r.customer_name || "—",
      filter: { type: "select", options: customers } },
    { key: "amount", label: "Amount", sortable: true, align: "right",
      render: (r) => <span className="font-semibold tabular-nums text-primary">{inr(r.amount)}</span> },
    { key: "payment_mode", label: "Mode", render: (r) => r.payment_mode || "—",
      filter: { type: "select", options: PAYMENT_MODES.map((m) => ({ value: m, label: m })) } },
    { key: "reference_number", label: "Reference", render: (r) => r.reference_number || "—" },
    { key: "invoices", label: "Invoices settled", render: (r) => (
      <div className="flex max-w-[320px] flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
        {r.allocations.length === 0 && <span className="text-muted">— (on account)</span>}
        {r.allocations.map((a) => (
          <CrmLink key={a.payment_id} to={`invoices/${a.invoice_id}`}
            className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-primary ring-1 ring-inset ring-subtle hover:underline"
            title={`${a.invoice_number || `#${a.invoice_id}`} — ${inr(a.amount)} applied`}>
            {a.employee_name || a.invoice_number || `#${a.invoice_id}`}
            <span className="text-muted">{inr(a.amount)}</span>
          </CrmLink>
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
  ], [customers]);

  return (
    <div className="space-y-4">
      {toastNode}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-primary">Customer Received Amount</h2>
          <p className="text-xs text-muted">
            Money received from customers, recorded by Finance, and the employees&rsquo; invoices it settled.
            {meta?.total_received != null && (
              <> Total received (this filter): <b className="text-primary">{inr(meta.total_received)}</b>.</>
            )}
          </p>
        </div>
        {canEdit && (
          <button className={btnPrimary} onClick={() => setShowAdd(true)}>
            <Plus size={15} /> Add received amount
          </button>
        )}
      </div>
      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : view === "customer" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${inputCls} !w-64`} placeholder="Search reference, notes or customer…" value={search}
              onChange={(e) => setSearch(e.target.value)} aria-label="Search received amounts" />
            <ViewToggle view={view} onChange={setView} />
            <span className="ml-auto text-xs text-muted">
              {rows.length} receipt{rows.length === 1 ? "" : "s"} · total {inr(rows.reduce((a, r) => a + Number(r.amount || 0), 0))}
            </span>
          </div>
          <CustomerGroupedList<Receipt>
            rows={rows}
            loading={loading}
            columns={columns.filter((c) => c.key !== "customer_name")}
            customerId={(r) => r.customer_id}
            customerName={(r) => r.customer_name}
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
          filters={<ViewToggle view={view} onChange={setView} />}
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
              <span className="font-bold text-primary">Receipt #{r.id} — {r.customer_name} · {inr(r.amount)} on {fmtDate(r.received_date)}</span>
              <button className="text-xs text-sky-600 hover:underline" onClick={() => setExpanded(null)}>Close</button>
            </div>
            {r.allocations.length === 0 ? (
              <p className="text-muted">Not applied to any invoice (held on account).</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs uppercase text-muted">
                  <th className="py-1">Invoice</th><th>Employee</th><th>Project</th><th className="text-right">Applied</th><th className="text-right">Balance now</th><th>Status</th>
                </tr></thead>
                <tbody>
                  {r.allocations.map((a) => (
                    <tr key={a.payment_id} className="border-t border-subtle">
                      <td className="py-1.5"><CrmLink to={`invoices/${a.invoice_id}`} className="font-semibold text-sky-600 hover:underline">{a.invoice_number || `#${a.invoice_id}`}</CrmLink></td>
                      <td>{a.employee_name || "—"}</td>
                      <td>{a.project_name || "—"}</td>
                      <td className="text-right tabular-nums">{inr(a.amount)}</td>
                      <td className="text-right tabular-nums">{inr(a.balance_amount)}</td>
                      <td>{a.payment_status ? <StatusBadge status={a.payment_status} /> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {r.notes && <p className="mt-2 whitespace-pre-wrap text-secondary">{r.notes}</p>}
          </div>
        );
      })()}
      {showAdd && (
        <AddReceiptModal
          customers={customers}
          onClose={() => setShowAdd(false)}
          onSaved={(msg) => { setShowAdd(false); showToast(msg); load(); }}
        />
      )}
      {removing && (
        <ConfirmModal
          title="Remove this receipt?"
          message={`${inr(removing.amount)} received from ${removing.customer_name} on ${fmtDate(removing.received_date)} will be removed and the ${removing.allocations.length} invoice(s) it settled will show their balance again.`}
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
function AddReceiptModal({ customers, onClose, onSaved }: {
  customers: { value: string; label: string }[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [receivedDate, setReceivedDate] = useState(() => isoDay(0));
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("NEFT");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [options, setOptions] = useState<InvoiceOption[]>([]);
  const [optLoading, setOptLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [invQuery, setInvQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const openOptions = useMemo(() => options.filter((o) => !o.payment_block), [options]);
  /* Search across invoice no., employee and project; ticked rows stay in
     the list whatever the query so a selection can't silently vanish. */
  const visibleOptions = useMemo(() => {
    const q = invQuery.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => selected.has(o.id)
      || [o.invoice_number, o.employee_name, o.project_name].filter(Boolean).join(" ").toLowerCase().includes(q));
  }, [options, invQuery, selected]);

  useEffect(() => {
    setSelected(new Set());
    if (!customerId) { setOptions([]); return; }
    let alive = true;
    setOptLoading(true);
    crmGet<InvoiceOption[]>(`/api/customer-receipts/invoice-options?customer_id=${customerId}`)
      .then((r) => { if (alive) setOptions(r.data || []); })
      .catch((e: any) => { if (alive) setError(e?.message || "Could not load invoices"); })
      .finally(() => { if (alive) setOptLoading(false); });
    return () => { alive = false; };
  }, [customerId]);

  const amt = Number(amount) || 0;
  // Preview the oldest-first allocation so Finance sees where the money goes.
  const preview = useMemo(() => {
    let left = amt;
    const rows: { id: number; take: number }[] = [];
    for (const o of options.filter((x) => selected.has(x.id))) {
      if (left <= 0) break;
      const take = Math.min(o.balance_amount, left);
      rows.push({ id: o.id, take });
      left = Math.round((left - take) * 100) / 100;
    }
    return { rows, left };
  }, [amt, options, selected]);
  const takeFor = (id: number) => preview.rows.find((r) => r.id === id)?.take ?? 0;
  const allocated = Math.max(0, amt - preview.left);
  const selectedBalance = options.filter((o) => selected.has(o.id)).reduce((t, o) => t + o.balance_amount, 0);
  const toggle = (o: InvoiceOption) => {
    if (o.payment_block) return;
    setSelected((s) => { const n = new Set(s); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; });
  };
  const missing = !customerId ? "Pick the customer" : !receivedDate ? "Pick the received date" : !(amt > 0) ? "Enter the amount received" : "";

  const submit = async () => {
    setError("");
    if (missing) { setError(missing); return; }
    setBusy(true);
    try {
      const res = await crmPost("/api/customer-receipts", {
        customer_id: Number(customerId), received_date: receivedDate, amount: amt,
        payment_mode: mode || null, reference_number: reference.trim() || null,
        notes: notes.trim() || null, invoice_ids: [...selected],
      });
      onSaved(res.message || "Received amount recorded");
    } catch (e: any) {
      setError(e?.message || "Failed to save");
      setBusy(false);
    }
  };

  const customerName = customers.find((c) => c.value === customerId)?.label;
  return (
    <Modal title="Add received amount" onClose={onClose} wide dirty={!!(amount || reference || notes || selected.size)}
      hero={<DialogHero tone="emerald" icon={Wallet} eyebrow="Customer received amount" title="Record money received"
        subtitle={customerName ? <>From <b>{customerName}</b> — settle their invoices, the rest stays on account.</> : "A bank credit from a customer, settled against their invoices."}
        flow={{ steps: ["Money received", "Invoices settled", "Balance on account"], current: selected.size ? 1 : 0 }} />}
      footer={<DialogActions tone="emerald" icon={Wallet} label={amt > 0 ? `Save ${inr(amt)}` : "Save received amount"}
        busy={busy} disabled={!!missing} onCancel={onClose} onConfirm={() => void submit()}
        hint={missing ? <span className="text-warning">{missing}</span> : "Ctrl + Enter to save"} />}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="space-y-4">
          <DialogSection n={1} title="The money" tone="emerald" done={!!customerId && amt > 0 && !!receivedDate}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-semibold text-secondary">Customer *</span>
                <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">— pick customer —</option>
                  {customers.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-secondary">Amount received (₹) *</span>
                <input type="number" min={0} step="0.01" className={`${inputCls} text-lg font-bold tabular-nums`} value={amount}
                  placeholder="0.00" onChange={(e) => setAmount(e.target.value)} />
                {selectedBalance > 0 && (
                  <button type="button" className="mt-1 text-[11px] font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                    onClick={() => setAmount(String(Math.round(selectedBalance * 100) / 100))}>
                    Use the ticked balance · {inr(selectedBalance)}
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

          <DialogSection n={2} title="Invoices it settles" tone="emerald" done={selected.size > 0} optional
            hint="Ticked invoices are settled oldest first; an invoice still waiting for the customer's approval or its IRN cannot take money yet."
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
            ) : options.length === 0 ? (
              <p className="text-xs text-muted">No open invoices for this customer — the amount will be held on account.</p>
            ) : (
              <>
                <input className={`${inputCls} mb-2 text-sm`} value={invQuery} placeholder="Search invoice no., employee or project…"
                  onChange={(e) => setInvQuery(e.target.value)} aria-label="Search invoices" />
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
                            </span>
                            <span className="block truncate text-xs text-secondary">
                              {[o.employee_name, o.project_name].filter(Boolean).join(" · ") || "—"}
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
                      </li>
                    );
                  })}
                </ul>
                {openOptions.length < options.length && (
                  <p className="mt-1.5 text-[11px] text-muted">
                    {options.length - openOptions.length} invoice(s) locked until the customer approves them and Finance adds the IRN.
                  </p>
                )}
              </>
            )}
          </DialogSection>

          <DialogSection n={3} title="Notes" tone="emerald" optional done={!!notes.trim()}>
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
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Settles {preview.rows.length} invoice(s)</dt><dd className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{inr(allocated)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">On account</dt><dd className="font-semibold tabular-nums text-primary">{inr(preview.left)}</dd></div>
            {selectedBalance > amt && amt > 0 && (
              <div className="flex justify-between"><dt className="text-muted">Still due on ticked</dt><dd className="font-semibold tabular-nums text-warning">{inr(selectedBalance - amt)}</dd></div>
            )}
          </dl>
          <p className="text-[11px] text-muted">Oldest invoice first, up to each balance. Deleting the receipt later puts every amount back.</p>
        </aside>
      </div>
    </Modal>
  );
}

const pillCls = (on: boolean) => `rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${on
  ? "border-emerald-500 bg-emerald-600 text-white shadow-raised"
  : "border-subtle bg-surface-1 text-secondary hover:border-emerald-300 hover:text-primary"}`;
