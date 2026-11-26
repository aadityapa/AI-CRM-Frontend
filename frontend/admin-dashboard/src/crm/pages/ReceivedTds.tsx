/**
 * Received TDS (20 Nov 2026, Finance ask) — the TDS twin of Customer Received
 * Amount. Finance records the TDS a customer deposited (Form 16A / 26AS credit)
 * once — date, amount, certificate no., quarter, proof — and maps it onto the
 * invoices it covers. The amount per invoice is editable while mapping.
 *
 * Linked with Received Amount both ways: an entry can name the received amount
 * it goes with, and lists every received amount that paid the same invoices;
 * a received amount lists its TDS entries (ReceiptWorkbench).
 *
 * Lives in the sidebar (`received-tds`, Finance) and on the customer page
 * (Customers ▸ customer ▸ Received TDS). `?entry=<id>` opens one entry;
 * `?q=` pre-fills the search (the invoice page's link).
 *
 * API: routers/crm/tds_receipts.py.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, FileText, Link2, Percent, Plus, Receipt as ReceiptIcon, Trash2, Wallet } from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut, crmUpload, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanAct } from "../useAccess";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { CrmLink } from "../routerHooks";
import { HERO_BTN_SOLID, PageHeader } from "../components/PageHeader";
import { DialogActions, DialogFailure, DialogHero, DialogSection } from "../components/dialogKit";
import { ConfirmModal, ErrorBox, Modal, inputCls, useToast } from "../components/ui";
import { ProofChip, blockNote, fmtDate, inr, isoDay } from "./receipts/receiptShared";

export type TdsAllocation = {
  invoice_id: number; amount: number; booked_here?: boolean;
  invoice_number?: string; invoice_date?: string | null; employee_name?: string | null;
  month_label?: string | null; branch_name?: string | null; grand_total?: number;
};
export type LinkedReceipt = {
  id: number; received_date: string | null; amount: number; reference_number?: string | null;
  payment_mode?: string | null; named?: boolean;
};
export type TdsEntry = {
  id: number; customer_id: number; customer_name?: string | null;
  branch_id?: number | null; branch_name?: string | null;
  received_date: string; amount: number; certificate_number?: string | null; quarter?: string | null;
  section?: string | null; reference_number?: string | null; notes?: string | null;
  unallocated_amount: number; allocated_amount: number; receipt_id?: number | null;
  proof_url?: string | null; proof_name?: string | null;
  allocations: TdsAllocation[]; linked_receipts: LinkedReceipt[];
};
type TdsOption = {
  id: number; invoice_number: string; invoice_date: string | null; employee_name?: string | null;
  month_label?: string | null; branch_name?: string | null; grand_total: number; balance_amount: number;
  tds_open: number; tds_cap: number; has_tds: boolean; payment_block?: string | null;
};
type ReceiptOption = {
  id: number; received_date: string | null; amount: number; reference_number?: string | null;
  payment_mode?: string | null; branch_name?: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** PURE: what each ticked invoice takes — typed first, the rest in order from
 *  what is left (the server's `plan_tds`). */
export function tdsPlan(available: number, ids: number[], open: Record<number, number>, cap: Record<number, number>,
                        typed: Record<number, string>): { take: Record<number, number>; left: number; over: string } {
  const take: Record<number, number> = {};
  let left = round2(available);
  let over = "";
  for (const id of ids) {
    const raw = typed[id];
    if (raw == null || raw === "") continue;
    const v = round2(Math.max(0, Number(raw) || 0));
    if (v > round2(cap[id] ?? 0) + 0.004) over = over || "An amount is more than that invoice can take";
    take[id] = v;
    left = round2(left - v);
  }
  if (left < -0.004) over = over || "The amounts are more than this TDS";
  for (const id of ids) {
    if (id in take) continue;
    const v = Math.max(0, Math.min(round2(open[id] ?? 0), Math.max(0, left)));
    take[id] = round2(v);
    left = round2(left - v);
  }
  return { take, left, over };
}

/** Quarter label for a date, Indian FY ("Q3 FY26-27"). */
export function quarterOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const m = d.getMonth() + 1;
  const fy = m >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  const q = m >= 4 && m <= 6 ? 1 : m <= 9 && m >= 7 ? 2 : m >= 10 ? 3 : 4;
  return `Q${q} FY${String(fy).slice(2)}-${String(fy + 1).slice(2)}`;
}

export function ReceivedTdsPage({ scope, standalone = false }: {
  scope?: { customerId: number; customerName?: string | null };
  standalone?: boolean;
} = {}) {
  const invEdit = useCanAct("invoices", "edit", useHasRole("Finance"));
  // 25 Nov 2026: the "Received TDS" page granted at Edit in Access Control works it too.
  const pageEdit = useCanAct("received-tds", "edit", false);
  const canEdit = invEdit || pageEdit;
  const [toastNode, showToast] = useToast();
  const [rows, setRows] = useState<TdsEntry[]>([]);
  const [meta, setMeta] = useState<(Meta & { total_received?: number; total_unmapped?: number }) | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("q") || ""; } catch { return ""; }
  });
  const [debounced, setDebounced] = useState(search);
  const [sort, setSort] = useState<{ by: string; dir: "asc" | "desc" }>({ by: "received_date", dir: "desc" });
  const [customers, setCustomers] = useState<{ value: string; label: string }[]>([]);
  const [customerFilter, setCustomerFilter] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [detail, setDetail] = useState<{ entry: TdsEntry; map?: boolean } | null>(null);
  const [removing, setRemoving] = useState<TdsEntry | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const scopeCustomer = scope?.customerId ?? null;

  useEffect(() => {
    const t = window.setTimeout(() => { setDebounced(search); setPage(1); }, 350);
    return () => window.clearTimeout(t);
  }, [search]);
  useEffect(() => {
    crmGet<any[]>("/api/customers/names?status=Active")
      .then((r) => setCustomers((r.data || []).map((c: any) => ({ value: String(c.id), label: String(c.name) }))
        .sort((a, b) => a.label.localeCompare(b.label))))
      .catch(() => setCustomers([]));
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<TdsEntry[]>(`/api/tds-receipts${qs({
        search: debounced, sort_by: sort.by, sort_dir: sort.dir, page, limit: 20,
        customer_id: scopeCustomer ?? (customerFilter || undefined),
      })}`);
      setRows(res.data || []);
      setMeta(res.meta as any);
    } catch (e: any) {
      setError(e?.message || "Failed to load received TDS");
    } finally {
      setLoading(false);
    }
  }, [debounced, sort, page, scopeCustomer, customerFilter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let id = 0;
    try { id = Number(new URLSearchParams(window.location.search).get("entry") || 0); } catch { /* none */ }
    if (!id) return;
    crmGet<TdsEntry>(`/api/tds-receipts/${id}`)
      .then((res) => res.data && setDetail({ entry: res.data }))
      .catch((e: any) => showToast(e?.message || "That entry could not be opened", "err"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const columns: Column<TdsEntry>[] = useMemo(() => {
    const all: Column<TdsEntry>[] = [
      { key: "received_date", label: "Received", sortable: true, render: (r) => fmtDate(r.received_date) },
      { key: "customer_name", label: "Customer", sortable: true, render: (r) => r.customer_name || "—" },
      { key: "branch_name", label: "Branch", sortable: true, render: (r) => r.branch_name || <span className="text-muted">—</span> },
      { key: "amount", label: "TDS amount", sortable: true, align: "right", render: (r) => (
        <span className="font-semibold tabular-nums text-primary">{inr(r.amount)}</span>) },
      { key: "certificate_number", label: "Certificate · quarter", render: (r) => (
        <span className="flex flex-col">
          <span>{r.certificate_number || "—"}</span>
          <span className="text-[11px] text-muted">{[r.quarter, r.section].filter(Boolean).join(" · ") || ""}</span>
          {r.proof_url && <ProofChip url={r.proof_url} name={r.proof_name} />}
        </span>) },
      { key: "mapped", label: "Mapped", align: "right", render: (r) => (
        Number(r.unallocated_amount) > 0
          ? <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-amber-800 ring-1 ring-inset ring-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800">
              {inr(r.unallocated_amount)} to map</span>
          : <span className="text-[11px] text-emerald-700 dark:text-emerald-300">Fully mapped · {r.allocations.length} invoice(s)</span>) },
      { key: "linked", label: "Received amount", render: (r) => r.linked_receipts.length ? (
        <span className="flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
          {r.linked_receipts.slice(0, 2).map((x) => (
            <CrmLink key={x.id} to={`received-amounts?receipt=${x.id}`} className="text-[11px] font-semibold text-brand-600 hover:underline"
              title={x.reference_number || ""}>
              #{x.id} · {fmtDate(x.received_date)} · {inr(x.amount)}
            </CrmLink>
          ))}
          {r.linked_receipts.length > 2 && <span className="text-[11px] text-muted">+{r.linked_receipts.length - 2} more</span>}
        </span>) : <span className="text-[11px] text-muted">—</span> },
    ];
    return all.filter((c) => !scope || c.key !== "customer_name");
  }, [scope]);

  const remove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      const res = await crmDelete(`/api/tds-receipts/${removing.id}`);
      showToast(res.message || "Removed");
      setRemoving(null);
      load();
    } catch (e: any) {
      showToast(e?.message || "Could not remove", "err");
    } finally {
      setRemoveBusy(false);
    }
  };

  const addBtn = canEdit ? (
    <button className={HERO_BTN_SOLID} onClick={() => setShowAdd(true)}><Plus size={15} /> Add received TDS</button>
  ) : null;
  return (
    <div className="space-y-4">
      {toastNode}
      {standalone ? (
        <PageHeader icon={Percent} accent="amber" eyebrow="Finance" title="Received TDS"
          subtitle="TDS each customer deposited for us (Form 16A / 26AS), and the invoices it covers. Linked with Received Amount."
          stats={[
            { label: "entries", value: meta?.total ?? rows.length },
            ...(meta?.total_received != null ? [{ label: "TDS received", value: inr(meta.total_received) }] : []),
            ...(meta?.total_unmapped ? [{ label: "not mapped yet", value: inr(meta.total_unmapped) }] : []),
          ]}
          actions={addBtn || undefined} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-primary">TDS received from {scope?.customerName || "this customer"}</h2>
            <p className="text-xs text-muted">Every TDS credit (Form 16A / 26AS) and the invoices it covers.
              {meta?.total_received != null && <> Total: <b className="text-primary">{inr(meta.total_received)}</b>.</>}</p>
          </div>
          {canEdit && (
            <button className="inline-flex items-center gap-1.5 rounded-control bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-2 text-sm font-semibold text-white shadow-sm"
              onClick={() => setShowAdd(true)}><Plus size={15} /> Add received TDS</button>
          )}
        </div>
      )}
      {error && <ErrorBox error={error} onRetry={load} />}
      <DataTable<TdsEntry>
        columns={columns} rows={rows} meta={meta} loading={loading}
        search={search} onSearch={setSearch}
        sort={sort} onSort={(by) => setSort((s) => ({ by, dir: s.by === by && s.dir === "desc" ? "asc" : "desc" }))}
        onPage={setPage}
        onRowClick={(r) => setDetail({ entry: r })}
        filters={!scope ? (
          <select className="h-9 rounded-control border border-subtle bg-surface-1 px-2 text-sm" aria-label="Customer"
            value={customerFilter} onChange={(e) => { setCustomerFilter(e.target.value); setPage(1); }}>
            <option value="">All customers</option>
            {customers.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        ) : undefined}
        emptyMessage={debounced ? `Nothing matches “${debounced}”.` : "No TDS received yet — record the first Form 16A / 26AS credit with “Add received TDS”."}
        rowActions={canEdit ? (r) => (
          <span className="inline-flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            {Number(r.unallocated_amount) > 0 && (
              <button type="button" className="rounded-control p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                title="Map to invoices" aria-label="Map to invoices" onClick={() => setDetail({ entry: r, map: true })}>
                <Link2 size={15} />
              </button>
            )}
            <button type="button" className="rounded-control p-1.5 text-muted hover:bg-danger-soft hover:!text-danger"
              title="Remove this TDS entry (its invoices read TDS pending again)" aria-label="Delete"
              onClick={() => setRemoving(r)}>
              <Trash2 size={15} />
            </button>
          </span>
        ) : undefined}
      />
      {showAdd && (
        <TdsMapDialog customers={customers} presetCustomer={scope ? { id: scope.customerId, name: scope.customerName } : null}
          onClose={() => setShowAdd(false)}
          onSaved={(msg) => { setShowAdd(false); showToast(msg); load(); }} />
      )}
      {detail && (
        <TdsEntryModal entry={detail.entry} canEdit={canEdit} startMap={!!detail.map}
          onClose={() => setDetail(null)}
          onChanged={(msg, updated) => { showToast(msg); if (updated) setDetail({ entry: updated }); load(); }}
          onDelete={(e) => { setDetail(null); setRemoving(e); }} />
      )}
      {removing && (
        <ConfirmModal title="Remove this TDS entry?" confirmLabel="Remove" danger busy={removeBusy}
          message={`${inr(removing.amount)} TDS from ${removing.customer_name || "the customer"} (${fmtDate(removing.received_date)}) will be removed. Its ${removing.allocations.length} invoice(s) read TDS pending from client again.`}
          onConfirm={remove} onClose={() => setRemoving(null)} />
      )}
    </div>
  );
}

export function ReceivedTdsStandalonePage() {
  return <ReceivedTdsPage standalone />;
}

/* ------------------------------------------------------------------------ */

function InvoicePicker({ options, loading, selected, typed, take, onToggle, onType }: {
  options: TdsOption[]; loading: boolean; selected: Set<number>; typed: Record<number, string>;
  take: Record<number, number>; onToggle: (id: number) => void; onType: (id: number, v: string) => void;
}) {
  const [q, setQ] = useState("");
  const shown = options.filter((o) => selected.has(o.id) || !q.trim()
    || [o.invoice_number, o.employee_name, o.month_label, o.branch_name].filter(Boolean).join(" ").toLowerCase().includes(q.trim().toLowerCase()));
  if (loading) return <p className="text-xs text-muted">Loading invoices…</p>;
  if (!options.length) return <p className="text-xs text-muted">No invoice of this customer has TDS left to map.</p>;
  return (
    <div className="space-y-2">
      <input className={inputCls} placeholder="Search invoice, employee, month, branch" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
        {shown.map((o) => {
          const on = selected.has(o.id);
          return (
            <li key={o.id} className={`rounded-control border px-3 py-2 ${on ? "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30" : "border-subtle bg-surface-1"}`}>
              <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => onToggle(o.id)} aria-pressed={on}>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? "border-amber-600 bg-amber-600 text-white" : "border-subtle bg-surface-1"}`} aria-hidden>
                  {on && <Check size={13} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-primary">
                    {o.invoice_number} <span className="text-xs font-normal text-muted">· {fmtDate(o.invoice_date)}</span>
                    {o.month_label && <span className="ml-1.5 rounded-full bg-teal-50 px-1.5 text-[11px] font-semibold text-teal-800 dark:bg-teal-950/40 dark:text-teal-200">{o.month_label}</span>}
                  </span>
                  <span className="block truncate text-xs text-secondary">{[o.employee_name, o.branch_name].filter(Boolean).join(" · ") || "—"}</span>
                  <span className="block text-[11px] text-muted">
                    Invoice {inr(o.grand_total)} · {o.has_tds ? <>TDS pending <b className="text-amber-700 dark:text-amber-300">{inr(o.tds_open)}</b></>
                      : <>no TDS booked yet — suggested {inr(o.tds_open)} (default rate)</>}
                  </span>
                  {blockNote(o.payment_block) && <span className="block text-[11px] text-amber-700 dark:text-amber-300">{blockNote(o.payment_block)}</span>}
                </span>
                <span className="shrink-0 text-sm font-bold tabular-nums text-amber-700 dark:text-amber-300">{on && take[o.id] ? inr(take[o.id]) : ""}</span>
              </button>
              {on && (
                <label className="ml-8 mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-secondary">
                  TDS on this invoice ₹
                  <input type="number" min={0} step="0.01" inputMode="decimal"
                    className="h-7 w-28 rounded-control border border-subtle bg-surface-1 px-2 text-right text-xs tabular-nums text-primary"
                    value={typed[o.id] ?? ""} placeholder={String(take[o.id] ?? o.tds_open)}
                    aria-label={`TDS on ${o.invoice_number}`}
                    title={o.has_tds ? `Up to ${inr(o.tds_cap)} pending` : `The customer deducted a different figure? Type it (up to ${inr(o.tds_cap)})`}
                    onChange={(e) => onType(o.id, e.target.value)} />
                </label>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function useTdsOptions(customerId: string | number | null) {
  const [options, setOptions] = useState<TdsOption[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!customerId) { setOptions([]); return undefined; }
    let alive = true;
    setLoading(true);
    crmGet<TdsOption[]>(`/api/tds-receipts/invoice-options?customer_id=${customerId}`)
      .then((r) => { if (alive) setOptions(r.data || []); })
      .catch(() => { if (alive) setOptions([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [customerId]);
  return { options, loading };
}

function useSelection(options: TdsOption[], available: number) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [typed, setTyped] = useState<Record<number, string>>({});
  const plan = useMemo(() => {
    const ids = options.filter((o) => selected.has(o.id)).map((o) => o.id);
    const open: Record<number, number> = {}; const cap: Record<number, number> = {};
    options.forEach((o) => { open[o.id] = o.tds_open; cap[o.id] = o.tds_cap; });
    return { ids, ...tdsPlan(available, ids, open, cap, typed) };
  }, [options, selected, typed, available]);
  const toggle = (id: number) => {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    setTyped((m) => { const n = { ...m }; delete n[id]; return n; });
  };
  const items = plan.ids.map((id) => ({ invoice_id: id, amount: typed[id] != null && typed[id] !== "" ? Number(typed[id]) : null }));
  return { selected, typed, setTyped, plan, toggle, items, reset: () => { setSelected(new Set()); setTyped({}); } };
}

/** Add received TDS (create, optionally mapped at once). */
function TdsMapDialog({ customers, presetCustomer, onClose, onSaved }: {
  customers: { value: string; label: string }[];
  presetCustomer: { id: number; name?: string | null } | null;
  onClose: () => void; onSaved: (msg: string) => void;
}) {
  const [customerId, setCustomerId] = useState(presetCustomer ? String(presetCustomer.id) : "");
  const [receivedDate, setReceivedDate] = useState(isoDay(0));
  const [amount, setAmount] = useState("");
  const [certificate, setCertificate] = useState("");
  const [quarter, setQuarter] = useState(quarterOf(isoDay(0)));
  const [section, setSection] = useState("194J");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [receiptId, setReceiptId] = useState("");
  const [receiptOpts, setReceiptOpts] = useState<ReceiptOption[]>([]);
  const [proof, setProof] = useState<{ url: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const amt = Number(amount) || 0;
  const { options, loading } = useTdsOptions(customerId || null);
  const sel = useSelection(options, amt);
  useEffect(() => {
    sel.reset(); setReceiptId("");
    if (!customerId) { setReceiptOpts([]); return; }
    crmGet<ReceiptOption[]>(`/api/tds-receipts/receipt-options?customer_id=${customerId}`)
      .then((r) => setReceiptOpts(r.data || [])).catch(() => setReceiptOpts([]));
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps
  const ticked = options.filter((o) => sel.selected.has(o.id)).reduce((t, o) => t + o.tds_open, 0);
  const missing = !customerId ? "Pick the customer" : !(amt > 0) ? "Enter the TDS amount" : !receivedDate ? "Pick the date" : sel.plan.over;
  const upload = async (file: File) => {
    try {
      const res = await crmUpload<{ url: string; name: string }>("/api/customer-receipts/proof", file);
      if (res.data) setProof({ url: res.data.url, name: res.data.name || file.name });
    } catch (e: any) { setError(e?.message || "Upload failed"); }
  };
  const submit = async () => {
    if (missing) { setError(missing); return; }
    setBusy(true); setError("");
    try {
      const res = await crmPost("/api/tds-receipts", {
        customer_id: Number(customerId), received_date: receivedDate, amount: amt,
        certificate_number: certificate.trim() || null, quarter: quarter.trim() || null, section: section || null,
        reference_number: reference.trim() || null, notes: notes.trim() || null,
        receipt_id: receiptId ? Number(receiptId) : null,
        proof_url: proof?.url || null, proof_name: proof?.name || null,
        items: sel.items,
      });
      onSaved(res.message || "Received TDS recorded");
    } catch (e: any) { setError(e?.message || "Failed to save"); setBusy(false); }
  };
  return (
    <Modal title="Add received TDS" onClose={onClose} wide dirty={!!(amount || certificate || sel.selected.size)}
      hero={<DialogHero tone="amber" icon={Percent} eyebrow="Received TDS" title="Record TDS received"
        subtitle="The TDS a customer deposited for us (Form 16A / 26AS) — map it onto the invoices it covers."
        flow={{ steps: ["TDS received", "Invoices mapped", "Rest to map later"], current: sel.selected.size ? 1 : 0 }} />}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-4">
          <DialogSection n={1} title="The TDS credit" tone="amber" done={!!customerId && amt > 0}>
            <div className="grid gap-3 sm:grid-cols-2">
              {!presetCustomer && (
                <label className="sm:col-span-2 text-xs font-semibold text-secondary">Customer
                  <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">Choose…</option>
                    {customers.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </label>
              )}
              <label className="text-xs font-semibold text-secondary">Date received / credited
                <input type="date" className={inputCls} value={receivedDate}
                  onChange={(e) => { setReceivedDate(e.target.value); if (!quarter || quarter === quarterOf(receivedDate)) setQuarter(quarterOf(e.target.value)); }} />
              </label>
              <label className="text-xs font-semibold text-secondary">TDS amount (₹)
                <input type="number" min={0} step="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
                {ticked > 0 && (
                  <button type="button" className="mt-1 text-[11px] font-semibold text-amber-700 hover:underline dark:text-amber-300"
                    onClick={() => setAmount(String(round2(ticked)))}>Use the ticked TDS · {inr(ticked)}</button>
                )}
              </label>
              <label className="text-xs font-semibold text-secondary">Form 16A certificate no.
                <input className={inputCls} value={certificate} onChange={(e) => setCertificate(e.target.value)} placeholder="optional" />
              </label>
              <label className="text-xs font-semibold text-secondary">Quarter
                <input className={inputCls} value={quarter} onChange={(e) => setQuarter(e.target.value)} />
              </label>
              <label className="text-xs font-semibold text-secondary">Section
                <select className={inputCls} value={section} onChange={(e) => setSection(e.target.value)}>
                  {["194J", "194C", "194I", "194H", "Other"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-secondary">Reference (TRACES / challan)
                <input className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="optional" />
              </label>
              <label className="sm:col-span-2 text-xs font-semibold text-secondary">Goes with the received amount (optional)
                <select className={inputCls} value={receiptId} onChange={(e) => setReceiptId(e.target.value)} disabled={!customerId}>
                  <option value="">— Linked automatically through the invoices —</option>
                  {receiptOpts.map((r) => (
                    <option key={r.id} value={r.id}>#{r.id} · {fmtDate(r.received_date)} · {inr(r.amount)}{r.reference_number ? ` · ${r.reference_number}` : ""}{r.branch_name ? ` · ${r.branch_name}` : ""}</option>
                  ))}
                </select>
              </label>
              <label className="sm:col-span-2 text-xs font-semibold text-secondary">Proof (Form 16A / 26AS)
                {proof ? <span className="mt-1 flex items-center gap-2"><ProofChip url={proof.url} name={proof.name} />
                  <button type="button" className="text-[11px] text-muted hover:underline" onClick={() => setProof(null)}>Remove</button></span>
                  : <input type="file" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv" className="mt-1 block text-xs"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />}
              </label>
            </div>
          </DialogSection>
          <DialogSection n={2} title="Invoices it covers" tone="emerald" optional done={sel.selected.size > 0}
            hint="Tick the invoices; the amount per invoice can be changed. What is not mapped can be mapped later.">
            {customerId ? <InvoicePicker options={options} loading={loading} selected={sel.selected} typed={sel.typed}
              take={sel.plan.take} onToggle={sel.toggle} onType={(id, v) => sel.setTyped((m) => ({ ...m, [id]: v }))} />
              : <p className="text-xs text-muted">Pick the customer first.</p>}
          </DialogSection>
          <DialogSection n={3} title="Notes" optional>
            <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </DialogSection>
        </div>
        <aside className="h-fit space-y-2 rounded-card border border-subtle bg-surface-2 p-3 text-sm lg:sticky lg:top-0">
          <div className="font-bold text-primary">Where the TDS goes</div>
          <dl className="space-y-1">
            <div className="flex justify-between"><dt className="text-muted">TDS received</dt><dd className="font-semibold tabular-nums">{inr(amt)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Mapped to {sel.plan.ids.length} invoice(s)</dt><dd className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{inr(Math.max(0, amt - Math.max(0, sel.plan.left)))}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Left to map later</dt><dd className="font-semibold tabular-nums">{inr(Math.max(0, sel.plan.left))}</dd></div>
          </dl>
          <p className="text-[11px] text-muted">An invoice with no TDS booked yet gets the deduction booked by this mapping (it settles the invoice beside the cash) and is marked received at once.</p>
        </aside>
      </div>
      <DialogFailure message={error} />
      <DialogActions onCancel={onClose} busy={busy} tone="amber" icon={Percent} label="Save received TDS"
        disabled={!!missing} hint={missing || undefined} onConfirm={submit} />
    </Modal>
  );
}

/** Open one entry: stats, mapped invoices (Unmap), linked received amounts, Map more, Edit. */
function TdsEntryModal({ entry, canEdit, startMap, onClose, onChanged, onDelete }: {
  entry: TdsEntry; canEdit: boolean; startMap: boolean;
  onClose: () => void; onChanged: (msg: string, updated?: TdsEntry) => void; onDelete: (e: TdsEntry) => void;
}) {
  const [mapping, setMapping] = useState(startMap && entry.unallocated_amount > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { options, loading } = useTdsOptions(mapping ? entry.customer_id : null);
  const sel = useSelection(options, Number(entry.unallocated_amount) || 0);
  const [receiptOpts, setReceiptOpts] = useState<ReceiptOption[]>([]);
  useEffect(() => {
    crmGet<ReceiptOption[]>(`/api/tds-receipts/receipt-options?customer_id=${entry.customer_id}`)
      .then((r) => setReceiptOpts(r.data || [])).catch(() => setReceiptOpts([]));
  }, [entry.customer_id]);
  const unmap = async (invoiceId: number) => {
    setBusy(true); setError("");
    try {
      const res = await crmDelete<TdsEntry>(`/api/tds-receipts/${entry.id}/allocations/${invoiceId}`);
      onChanged(res.message || "Unmapped", res.data as TdsEntry);
    } catch (e: any) { setError(e?.message || "Could not unmap"); } finally { setBusy(false); }
  };
  const map = async () => {
    if (!sel.items.length) { setError("Tick at least one invoice"); return; }
    if (sel.plan.over) { setError(sel.plan.over); return; }
    setBusy(true); setError("");
    try {
      const res = await crmPost<TdsEntry>(`/api/tds-receipts/${entry.id}/allocate`, { items: sel.items });
      setMapping(false); sel.reset();
      onChanged(res.message || "Mapped", res.data as TdsEntry);
    } catch (e: any) { setError(e?.message || "Could not map"); } finally { setBusy(false); }
  };
  const link = async (receiptId: string) => {
    try {
      const res = await crmPut<TdsEntry>(`/api/tds-receipts/${entry.id}`, { receipt_id: receiptId ? Number(receiptId) : 0 });
      onChanged(res.message || "Linked", res.data as TdsEntry);
    } catch (e: any) { setError(e?.message || "Could not link"); }
  };
  return (
    <Modal title={`Received TDS #${entry.id}`} onClose={onClose} wide
      hero={<DialogHero tone="amber" icon={Percent} eyebrow={`Received TDS · ${entry.customer_name || ""}`}
        title={inr(entry.amount)}
        subtitle={<>{fmtDate(entry.received_date)}{entry.certificate_number ? ` · Form 16A ${entry.certificate_number}` : ""}{entry.quarter ? ` · ${entry.quarter}` : ""}{entry.branch_name ? ` · ${entry.branch_name}` : ""}</>}
        chips={entry.proof_url ? <ProofChip url={entry.proof_url} name={entry.proof_name} /> : undefined} />}>
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          {[["TDS received", entry.amount, "text-primary"], ["Mapped", entry.allocated_amount, "text-emerald-700 dark:text-emerald-300"],
            ["Left to map", entry.unallocated_amount, Number(entry.unallocated_amount) > 0 ? "text-amber-700 dark:text-amber-300" : "text-muted"]].map(([l, v, c]) => (
            <div key={String(l)} className="rounded-card border border-subtle bg-surface-2 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase text-muted">{l}</div>
              <div className={`text-lg font-bold tabular-nums ${c}`}>{inr(Number(v))}</div>
            </div>
          ))}
        </div>
        <section>
          <h3 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-primary"><FileText size={14} /> Invoices this TDS covers</h3>
          {entry.allocations.length === 0 ? <p className="text-xs text-muted">Not mapped to any invoice yet.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase text-muted"><th className="py-1">Invoice</th><th>Employee · month</th><th className="text-right">TDS</th><th /></tr></thead>
              <tbody>
                {entry.allocations.map((a) => (
                  <tr key={a.invoice_id} className="border-t border-subtle">
                    <td className="py-1.5"><CrmLink to={`invoices/${a.invoice_id}`} className="font-semibold text-brand-600 hover:underline">{a.invoice_number || `#${a.invoice_id}`}</CrmLink>
                      {a.booked_here && <span className="ml-1 rounded-full bg-amber-50 px-1.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" title="The deduction was booked by this mapping">booked here</span>}</td>
                    <td className="text-xs text-secondary">{[a.employee_name, a.month_label].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="text-right font-semibold tabular-nums">{inr(a.amount)}</td>
                    <td className="text-right">{canEdit && (
                      <button type="button" disabled={busy} className="rounded-control px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        onClick={() => void unmap(a.invoice_id)}>Unmap</button>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section>
          <h3 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-primary"><Wallet size={14} /> Received amount it goes with</h3>
          {entry.linked_receipts.length === 0 ? <p className="text-xs text-muted">No received amount linked yet — it links by itself once a received amount pays the same invoices.</p> : (
            <ul className="flex flex-wrap gap-1.5">
              {entry.linked_receipts.map((r) => (
                <li key={r.id}>
                  <CrmLink to={`received-amounts?receipt=${r.id}`} className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800 ring-1 ring-inset ring-teal-200 hover:underline dark:bg-teal-950/40 dark:text-teal-200 dark:ring-teal-800">
                    <ReceiptIcon size={11} aria-hidden /> #{r.id} · {fmtDate(r.received_date)} · {inr(r.amount)}{r.named ? " · named" : ""}
                  </CrmLink>
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <label className="mt-2 block text-xs font-semibold text-secondary">Name the received amount
              <select className={inputCls} value={entry.receipt_id ? String(entry.receipt_id) : ""} onChange={(e) => void link(e.target.value)}>
                <option value="">— None named —</option>
                {receiptOpts.map((r) => <option key={r.id} value={r.id}>#{r.id} · {fmtDate(r.received_date)} · {inr(r.amount)}{r.reference_number ? ` · ${r.reference_number}` : ""}</option>)}
              </select>
            </label>
          )}
        </section>
        {mapping && (
          <section className="rounded-card border border-emerald-200 p-3 dark:border-emerald-900">
            <h3 className="mb-2 text-sm font-bold text-primary">Map {inr(entry.unallocated_amount)} to invoices</h3>
            <InvoicePicker options={options} loading={loading} selected={sel.selected} typed={sel.typed}
              take={sel.plan.take} onToggle={sel.toggle} onType={(id, v) => sel.setTyped((m) => ({ ...m, [id]: v }))} />
            <p className="mt-2 text-xs text-muted">Left after this: <b className="text-primary">{inr(Math.max(0, sel.plan.left))}</b>{sel.plan.over ? <span className="ml-2 text-rose-600">{sel.plan.over}</span> : null}</p>
          </section>
        )}
        <DialogFailure message={error} />
        <div className="flex flex-wrap justify-end gap-2 border-t border-subtle pt-3">
          {canEdit && <button type="button" className="rounded-control px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50" onClick={() => onDelete(entry)}>Delete</button>}
          <button type="button" className="rounded-control border border-subtle px-3 py-2 text-sm font-semibold" onClick={onClose}>Close</button>
          {canEdit && Number(entry.unallocated_amount) > 0 && (mapping ? (
            <button type="button" disabled={busy} className="rounded-control bg-emerald-600 px-3 py-2 text-sm font-semibold text-white" onClick={() => void map()}>
              {busy ? "Mapping…" : `Map ${sel.plan.ids.length} invoice(s)`}</button>
          ) : (
            <button type="button" className="inline-flex items-center gap-1 rounded-control bg-emerald-600 px-3 py-2 text-sm font-semibold text-white" onClick={() => setMapping(true)}>
              <Link2 size={14} /> Map to invoices</button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
