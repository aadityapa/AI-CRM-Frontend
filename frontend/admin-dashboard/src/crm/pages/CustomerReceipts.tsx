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
import { Plus, Trash2 } from "lucide-react";
import { crmDelete, crmGet, crmPost, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanAct } from "../useAccess";
import { DataTable } from "../components/DataTable";
import type { Column, ColumnFilterValue } from "../components/DataTable";
import { CrmLink } from "../routerHooks";
import {
  ConfirmModal, ErrorBox, Field, Modal, StatusBadge, btnPrimary, btnSecondary, inputCls, useToast,
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

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<Receipt[]>(`/api/customer-receipts${qs({
        page, limit: 20, search: debounced, sort_by: sort.by, sort_dir: sort.dir,
        customer_id: colFilters.customer_name?.value || undefined,
        payment_mode: colFilters.payment_mode?.value || undefined,
        received_from: colFilters.received_date?.from || undefined,
        received_to: colFilters.received_date?.to || undefined,
      })}`);
      setRows(res.data || []);
      setMeta(res.meta as any);
    } catch (e: any) {
      setError(e?.message || "Failed to load received amounts");
    } finally {
      setLoading(false);
    }
  }, [page, debounced, sort, colFilters]);
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

function AddReceiptModal({ customers, onClose, onSaved }: {
  customers: { value: string; label: string }[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [receivedDate, setReceivedDate] = useState(() => {
    const d = new Date(); const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
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

  const submit = async () => {
    setError("");
    if (!customerId) { setError("Pick the customer"); return; }
    if (!receivedDate) { setError("Received date is required"); return; }
    if (!(amt > 0)) { setError("Enter the amount received"); return; }
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

  return (
    <Modal title="Add received amount" onClose={onClose} medium dirty={!!(amount || reference || notes || selected.size)}>
      <div className="space-y-4">
        {error && <ErrorBox error={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer" required>
            <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— pick customer —</option>
              {customers.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Received date" required>
            <input type="date" className={inputCls} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
          </Field>
          <Field label="Amount (₹)" required>
            <input type="number" min={0} step="0.01" className={inputCls} value={amount} placeholder="e.g. 250000"
              onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Payment mode">
            <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value)}>
              {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Reference number">
            <input className={inputCls} value={reference} placeholder="UTR / cheque no. / transaction id"
              onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>

        <div>
          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">
            Invoices this covers (per employee) {selected.size > 0 && <span className="font-medium normal-case">— {selected.size} selected</span>}
          </div>
          {!customerId ? (
            <p className="text-xs text-muted">Pick the customer to see their open invoices.</p>
          ) : optLoading ? (
            <p className="text-xs text-muted">Loading invoices…</p>
          ) : options.length === 0 ? (
            <p className="text-xs text-muted">No open invoices for this customer — the amount will be held on account.</p>
          ) : (
            <>
            <div className="mb-1.5 flex items-center gap-2">
              <input className={`${inputCls} !h-8 text-sm`} value={invQuery} placeholder="Search invoice no., employee or project…"
                onChange={(e) => setInvQuery(e.target.value)} aria-label="Search invoices" />
              <button type="button" className="whitespace-nowrap text-xs font-semibold text-sky-600 hover:underline"
                onClick={() => setSelected((s) => { const n = new Set(s); visibleOptions.forEach((o) => n.add(o.id)); return n; })}
                title="Select every invoice currently listed">
                Select all{invQuery ? " shown" : ""}
              </button>
              {selected.size > 0 && (
                <button type="button" className="whitespace-nowrap text-xs font-semibold text-muted hover:underline"
                  onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              )}
            </div>
            <div className="max-h-56 overflow-y-auto rounded-control border border-subtle">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-2 text-left text-[11px] uppercase text-muted">
                  <tr><th className="w-8 px-2 py-1.5" /><th className="py-1.5">Invoice</th><th>Employee</th><th>Project</th><th className="text-right">Balance</th><th className="pr-2 text-right">Will apply</th></tr>
                </thead>
                <tbody>
                  {visibleOptions.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-2 text-xs text-muted">No invoice matches “{invQuery}”.</td></tr>
                  )}
                  {visibleOptions.map((o) => {
                    const on = selected.has(o.id);
                    return (
                      <tr key={o.id} className={`cursor-pointer border-t border-subtle ${on ? "bg-surface-2" : "hover:bg-surface-2/60"}`}
                        onClick={() => setSelected((s) => { const n = new Set(s); n.has(o.id) ? n.delete(o.id) : n.add(o.id); return n; })}>
                        <td className="px-2 py-1.5"><input type="checkbox" readOnly checked={on} className="accent-brand-600" /></td>
                        <td className="py-1.5 font-semibold text-primary">{o.invoice_number}<span className="ml-1 text-xs font-normal text-muted">{fmtDate(o.invoice_date)}</span></td>
                        <td>{o.employee_name || "—"}</td>
                        <td className="text-secondary">{o.project_name || "—"}</td>
                        <td className="text-right tabular-nums">{inr(o.balance_amount)}</td>
                        <td className={`pr-2 text-right tabular-nums ${on && takeFor(o.id) > 0 ? "font-semibold text-success" : "text-muted"}`}>
                          {on ? inr(takeFor(o.id)) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
          {amt > 0 && selected.size > 0 && (
            <p className="mt-1 text-xs text-muted">
              Applied oldest invoice first. {preview.left > 0
                ? <>{inr(preview.left)} will stay <b>unallocated</b> (on account).</>
                : <>Fully allocated.</>}
            </p>
          )}
        </div>

        <Field label="Notes">
          <textarea className={`${inputCls} !h-auto min-h-[64px]`} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={btnPrimary} onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save received amount"}</button>
        </div>
      </div>
    </Modal>
  );
}
