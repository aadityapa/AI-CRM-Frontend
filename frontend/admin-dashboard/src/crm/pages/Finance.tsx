/** Finance module pages: Purchase Orders (list/detail), Invoices (list/detail), TDS register.
 * Writes: Finance (Admin implicit). Reads also Sales_Head. */
import React, { useEffect, useMemo, useState } from "react";
import { Ban, FileDown, IndianRupee, Plus, Receipt } from "lucide-react";
import { crmGet, crmPost, qs, type Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanEditTab } from "../useAccess";
import { CrmLink, crmNavigate, useCrmParams } from "../routerHooks";
import { DataTable, type Column } from "../components/DataTable";
import { FileLink } from "../components/FileUpload";
import {
  btnDanger, btnPrimary, btnSecondary, ConfirmModal, ErrorBox, Field, inputCls,
  Modal, Spinner, StatusBadge, Tabs, useToast,
} from "../components/ui";

/* ---------------------------------------------------------------- helpers */

const inr = (v: number | null | undefined): string =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const fmtDate = (d?: string | null): string => (d ? new Date(d).toLocaleDateString("en-IN") : "—");

const num = (s: string): number | undefined => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
};

const today = () => new Date().toISOString().slice(0, 10);

/** id → display-name map from a CRM list endpoint. */
function useNameMap(path: string, nameKey = "name"): Record<number, string> {
  const [map, setMap] = useState<Record<number, string>>({});
  useEffect(() => {
    let alive = true;
    crmGet<any[]>(path)
      .then((r) => {
        if (!alive) return;
        const m: Record<number, string> = {};
        (r.data || []).forEach((x: any) => { m[x.id] = x[nameKey]; });
        setMap(m);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [path, nameKey]);
  return map;
}

function InfoItem({ label, children, numeric }: { label: string; children: React.ReactNode; numeric?: boolean }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 text-sm text-primary${numeric ? " font-display tabular-nums" : ""}`}>{children}</div>
    </div>
  );
}

function Card({ title, actions, children, hero }: { title: string; actions?: React.ReactNode; children: React.ReactNode; hero?: boolean }) {
  return (
    <div className={hero ? "glass fx-gradient-border fx-lift rounded-card shadow-sm" : "rounded-card border border-subtle bg-surface-1 shadow-sm"}>
      <div className="fx-hairline-b flex flex-wrap items-center justify-between gap-2 px-5 py-3">
        <h2 className="text-sm font-bold text-primary">{title}</h2>
        {actions}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function GstChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 dark:bg-sky-950/50 px-2.5 py-1 text-xs font-semibold text-sky-700 dark:text-sky-300">
      {label}: {value}
    </span>
  );
}

/* =====================================================================
 * PURCHASE ORDERS — list
 * =================================================================== */

const PO_TABS = [
  { key: "Active", label: "Active" },
  { key: "Exhausted", label: "Exhausted" },
  { key: "Cancelled", label: "Cancelled" },
];

export function PurchaseOrdersPage() {
  const canWrite = useHasRole("Finance") && useCanEditTab("pos");
  const [tab, setTab] = useState("Active");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [toast, showToast] = useToast();
  const customers = useNameMap("/api/customers?limit=100");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = window.setTimeout(() => {
      crmGet<any[]>(`/api/purchase-orders${qs({ status: tab, search, page, limit: 20 })}`)
        .then((r) => { if (alive) { setRows(r.data || []); setMeta(r.meta); setError(""); } })
        .catch((e) => { if (alive) setError(e?.message || "Failed to load purchase orders"); })
        .finally(() => { if (alive) setLoading(false); });
    }, search ? 300 : 0);
    return () => { alive = false; window.clearTimeout(t); };
  }, [tab, search, page]);

  const columns: Column<any>[] = [
    { key: "po_number", label: "PO Number", render: (r) => <span className="font-semibold">{r.po_number}</span> },
    { key: "customer", label: "Customer", render: (r) => customers[r.customer_id] || `#${r.customer_id}` },
    { key: "po_type", label: "Type" },
    { key: "total_value", label: "Total", render: (r) => inr(r.total_value) },
    { key: "consumed_value", label: "Consumed", render: (r) => inr(r.consumed_value) },
    { key: "balance_value", label: "Balance", render: (r) => inr(r.balance_value) },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-display text-lg font-bold text-primary">Purchase Orders</h1>
        {canWrite && (
          <button className={btnPrimary} onClick={() => setShowNew(true)}>
            <Plus size={15} /> New PO
          </button>
        )}
      </div>
      <Tabs tabs={PO_TABS} active={tab} onChange={(k) => { setTab(k); setPage(1); }} />
      {error && <ErrorBox error={error} />}
      <DataTable
        columns={columns}
        rows={rows}
        meta={meta}
        loading={loading}
        search={search}
        onSearch={(q) => { setSearch(q); setPage(1); }}
        onPage={setPage}
        onRowClick={(r) => crmNavigate(`pos/${r.id}`)}
        emptyMessage={`No ${tab.toLowerCase()} purchase orders`}
      />
      {showNew && (
        <POFormModal
          customers={customers}
          onClose={() => setShowNew(false)}
          onSaved={(po) => { setShowNew(false); showToast("Purchase order created"); crmNavigate(`pos/${po.id}`); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
      {toast}
    </div>
  );
}

/* ------------------------------------------------------- New PO modal */

function POFormModal({
  customers,
  onClose,
  onSaved,
  onError,
}: {
  customers: Record<number, string>;
  onClose: () => void;
  onSaved: (po: any) => void;
  onError: (msg: string) => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [branches, setBranches] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [billingId, setBillingId] = useState("");
  const [deliveryId, setDeliveryId] = useState("");
  const [contactId, setContactId] = useState("");
  const [receivedDate, setReceivedDate] = useState("");
  const [poType, setPoType] = useState("Standard");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [taxSlab, setTaxSlab] = useState("");
  const [interState, setInterState] = useState(false);
  const [totalValue, setTotalValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setBranches([]); setContacts([]); setBillingId(""); setDeliveryId(""); setContactId("");
    if (!customerId) return;
    crmGet<any[]>(`/api/customers/${customerId}/branches`).then((r) => setBranches(r.data || [])).catch(() => {});
    crmGet<any[]>(`/api/customers/${customerId}/contacts`).then((r) => setContacts(r.data || [])).catch(() => {});
  }, [customerId]);

  const slabN = num(taxSlab) ?? 0;
  const half = Math.round((slabN / 2) * 100) / 100;

  const submit = async () => {
    const total = num(totalValue);
    if (!customerId) { setErr("Customer is required"); return; }
    if (total === undefined || total <= 0) { setErr("Total value must be a positive number"); return; }
    setErr("");
    setBusy(true);
    try {
      const payload: any = {
        customer_id: Number(customerId),
        po_type: poType,
        inter_state: interState,
        total_value: total,
      };
      if (billingId) payload.billing_branch_id = Number(billingId);
      if (deliveryId) payload.delivery_branch_id = Number(deliveryId);
      if (contactId) payload.contact_person_id = Number(contactId);
      if (receivedDate) payload.received_date = receivedDate;
      if (paymentTerms.trim()) payload.payment_terms = paymentTerms.trim();
      if (taxSlab !== "") payload.tax_slab = num(taxSlab);
      const res = await crmPost("/api/purchase-orders", payload);
      onSaved(res.data);
    } catch (e: any) {
      onError(e?.message || "Failed to create purchase order");
      setBusy(false);
    }
  };

  return (
    <Modal title="New Purchase Order" onClose={onClose} wide fullScreen>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Customer" required>
          <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select customer…</option>
            {Object.entries(customers).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </Field>
        <Field label="Received date">
          <input type="date" className={inputCls} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
        </Field>
        <Field label="Billing branch">
          <select className={inputCls} value={billingId} onChange={(e) => setBillingId(e.target.value)} disabled={!customerId}>
            <option value="">—</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}{b.is_primary ? " (primary)" : ""}</option>)}
          </select>
        </Field>
        <Field label="Delivery branch">
          <select className={inputCls} value={deliveryId} onChange={(e) => setDeliveryId(e.target.value)} disabled={!customerId}>
            <option value="">—</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}{b.is_primary ? " (primary)" : ""}</option>)}
          </select>
        </Field>
        <Field label="Contact person">
          <select className={inputCls} value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!customerId}>
            <option value="">—</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="PO type">
          <select className={inputCls} value={poType} onChange={(e) => setPoType(e.target.value)}>
            <option value="Standard">Standard</option>
            <option value="Blanket">Blanket</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Payment terms">
            <textarea className={inputCls} rows={2} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="e.g. Net 30 from invoice date" />
          </Field>
        </div>
        <Field label="Tax slab (GST %)">
          <input type="number" min={0} max={100} step="0.01" className={inputCls} value={taxSlab} onChange={(e) => setTaxSlab(e.target.value)} placeholder="e.g. 18" />
        </Field>
        <Field label="Total value (₹)" required>
          <input type="number" min={0} step="0.01" className={inputCls} value={totalValue} onChange={(e) => setTotalValue(e.target.value)} />
        </Field>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3 rounded-xl border border-subtle bg-surface-2 px-3 py-2.5">
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-primary">
            <input type="checkbox" checked={interState} onChange={(e) => setInterState(e.target.checked)} />
            Inter-state supply (IGST)
          </label>
          <div className="flex flex-wrap gap-1.5">
            {interState ? (
              <GstChip label="IGST" value={`${slabN}%`} />
            ) : (
              <>
                <GstChip label="SGST" value={`${half}%`} />
                <GstChip label="CGST" value={`${half}%`} />
              </>
            )}
            {num(totalValue) !== undefined && slabN > 0 && (
              <GstChip label="GST on total" value={inr(Math.round((num(totalValue)! * slabN) / 100 * 100) / 100)} />
            )}
          </div>
        </div>
      </div>
      {err && <div className="mt-2 text-sm text-rose-600">{err}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={btnPrimary} onClick={submit} disabled={busy}>
          <Receipt size={15} /> {busy ? "Creating…" : "Create PO"}
        </button>
      </div>
    </Modal>
  );
}

/* =====================================================================
 * PURCHASE ORDER — detail
 * =================================================================== */

export function PODetailPage() {
  const { id } = useCrmParams();
  const canWrite = useHasRole("Finance") && useCanEditTab("pos");
  const [po, setPo] = useState<any | null>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [showAllocate, setShowAllocate] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [toast, showToast] = useToast();

  const load = () => {
    crmGet<any>(`/api/purchase-orders/${id}`)
      .then((r) => {
        setPo(r.data);
        setError("");
        if (r.data?.customer_id) {
          crmGet<any>(`/api/customers/${r.data.customer_id}`)
            .then((c) => setCustomerName(c.data?.name || "")).catch(() => {});
        }
      })
      .catch((e) => setError(e?.message || "Failed to load purchase order"));
    crmGet<any[]>(`/api/invoices${qs({ po_id: id, limit: 100 })}`)
      .then((r) => setInvoices(r.data || [])).catch(() => {});
  };
  useEffect(load, [id]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!po) return <Spinner label="Loading purchase order…" />;

  const total = Number(po.total_value || 0);
  const consumed = Number(po.consumed_value || 0);
  const pct = total > 0 ? Math.min(100, Math.round((consumed / total) * 100)) : 0;

  const cancelPO = async () => {
    setCancelBusy(true);
    try {
      await crmPost(`/api/purchase-orders/${id}/cancel`);
      showToast("Purchase order cancelled");
      setShowCancel(false);
      load();
    } catch (e: any) {
      showToast(e?.message || "Failed to cancel PO", "err");
      setShowCancel(false);
    } finally {
      setCancelBusy(false);
    }
  };

  const allocCols: Column<any>[] = [
    { key: "project_name", label: "Project", render: (r) => r.project_name || `#${r.project_id}` },
    { key: "allocated_amount", label: "Allocated", render: (r) => inr(r.allocated_amount) },
    { key: "consumed_amount", label: "Consumed", render: (r) => inr(r.consumed_amount) },
  ];

  const invCols: Column<any>[] = [
    { key: "invoice_number", label: "Invoice #", render: (r) => <span className="font-semibold">{r.invoice_number}</span> },
    { key: "invoice_date", label: "Date", render: (r) => fmtDate(r.invoice_date) },
    { key: "grand_total", label: "Grand Total", render: (r) => inr(r.grand_total) },
    { key: "paid_amount", label: "Paid", render: (r) => inr(r.paid_amount) },
    { key: "balance_amount", label: "Balance", render: (r) => inr(r.balance_amount) },
    { key: "payment_status", label: "Status", render: (r) => <StatusBadge status={r.payment_status} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CrmLink to="pos" className="text-sm font-semibold text-sky-600 hover:underline">Purchase Orders</CrmLink>
          <span className="text-muted">/</span>
          <h1 className="text-display text-lg font-bold text-primary">{po.po_number}</h1>
          <StatusBadge status={po.status} />
        </div>
        {canWrite && po.status === "Active" && (
          <button className={btnDanger} onClick={() => setShowCancel(true)}>
            <Ban size={15} /> Cancel PO
          </button>
        )}
      </div>

      <Card title="PO Details" hero>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <InfoItem label="Customer">{customerName || `#${po.customer_id}`}</InfoItem>
          <InfoItem label="Type">{po.po_type || "—"}</InfoItem>
          <InfoItem label="Received">{fmtDate(po.received_date)}</InfoItem>
          <InfoItem label="Tax slab">{po.tax_slab != null ? `${po.tax_slab}%` : "—"}</InfoItem>
          <InfoItem label="Total value" numeric>{inr(po.total_value)}</InfoItem>
          <InfoItem label="Consumed" numeric>{inr(po.consumed_value)}</InfoItem>
          <InfoItem label="Balance" numeric>{inr(po.balance_value)}</InfoItem>
          <InfoItem label="Invoices" numeric>{po.invoice_count ?? invoices.length}</InfoItem>
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {po.igst != null && Number(po.igst) > 0 ? (
            <GstChip label="IGST" value={`${po.igst}%`} />
          ) : po.tax_slab != null ? (
            <>
              <GstChip label="SGST" value={`${po.sgst ?? 0}%`} />
              <GstChip label="CGST" value={`${po.cgst ?? 0}%`} />
            </>
          ) : (
            <span className="text-xs text-muted">No GST slab configured</span>
          )}
        </div>
        {po.payment_terms && (
          <div className="mt-4">
            <InfoItem label="Payment terms">{po.payment_terms}</InfoItem>
          </div>
        )}
        <div className="mt-4">
          <div className="flex justify-between text-xs font-semibold text-muted">
            <span>Consumption</span>
            <span>{pct}% ({inr(consumed)} of {inr(total)})</span>
          </div>
          <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full transition-all ${pct >= 100 ? "bg-rose-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </Card>

      <Card
        title="Project Allocations"
        actions={
          canWrite && po.status === "Active" ? (
            <button className={btnSecondary} onClick={() => setShowAllocate(true)}>
              <Plus size={15} /> Allocate to project
            </button>
          ) : undefined
        }
      >
        <DataTable columns={allocCols} rows={po.allocations || []} emptyMessage="No project allocations yet" />
      </Card>

      <Card title="Linked Invoices">
        <DataTable
          columns={invCols}
          rows={invoices}
          onRowClick={(r) => crmNavigate(`invoices/${r.id}`)}
          emptyMessage="No invoices raised against this PO"
        />
      </Card>

      {showAllocate && (
        <AllocateModal
          po={po}
          onClose={() => setShowAllocate(false)}
          onSaved={() => { setShowAllocate(false); showToast("Project allocation saved"); load(); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
      {showCancel && (
        <ConfirmModal
          title="Cancel Purchase Order"
          message={<>Cancel PO <b>{po.po_number}</b>? This cannot be undone. POs with invoices raised against them cannot be cancelled.</>}
          confirmLabel="Cancel PO"
          danger
          busy={cancelBusy}
          onConfirm={cancelPO}
          onClose={() => setShowCancel(false)}
        />
      )}
      {toast}
    </div>
  );
}

function AllocateModal({
  po,
  onClose,
  onSaved,
  onError,
}: {
  po: any;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    crmGet<any[]>("/api/projects?limit=100").then((r) => setProjects(r.data || [])).catch(() => {});
  }, []);

  const allocatedSum = (po.allocations || []).reduce((s: number, a: any) => s + Number(a.allocated_amount || 0), 0);
  const remaining = Number(po.total_value || 0) - allocatedSum;
  const amtN = num(amount);
  const amountErr =
    amount === "" ? "" :
    amtN === undefined || amtN <= 0 ? "Amount must be a positive number" :
    amtN > remaining ? `Exceeds unallocated amount (${inr(remaining)})` : "";

  const submit = async () => {
    if (!projectId || amtN === undefined || amtN <= 0 || amountErr) return;
    setBusy(true);
    try {
      await crmPost(`/api/purchase-orders/${po.id}/allocate-project`, {
        project_id: Number(projectId),
        allocated_amount: amtN,
      });
      onSaved();
    } catch (e: any) {
      onError(e?.message || "Failed to allocate");
      setBusy(false);
    }
  };

  return (
    <Modal title="Allocate to Project" onClose={onClose} fullScreen>
      <div className="space-y-3">
        <div className="text-xs text-muted">
          PO total {inr(po.total_value)} · already allocated {inr(allocatedSum)} · unallocated {inr(remaining)}
        </div>
        <Field label="Project" required>
          <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Select project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Amount (₹)" required error={amountErr || undefined}>
          <input type="number" min={0} step="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={btnPrimary} onClick={submit} disabled={busy || !projectId || !!amountErr || amount === ""}>
          {busy ? "Saving…" : "Allocate"}
        </button>
      </div>
    </Modal>
  );
}

/* =====================================================================
 * INVOICES — list
 * =================================================================== */

const INVOICE_TABS = [
  { key: "Unpaid", label: "Unpaid" },
  { key: "Partially_Paid", label: "Partially Paid" },
  { key: "Paid", label: "Paid" },
];

export function InvoicesPage() {
  const canWrite = useHasRole("Finance") && useCanEditTab("invoices");
  const [tab, setTab] = useState("Unpaid");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [toast, showToast] = useToast();
  const projects = useNameMap("/api/projects?limit=100");
  const pos = useNameMap("/api/purchase-orders?limit=100", "po_number");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = window.setTimeout(() => {
      crmGet<any[]>(`/api/invoices${qs({ payment_status: tab, search, page, limit: 20 })}`)
        .then((r) => { if (alive) { setRows(r.data || []); setMeta(r.meta); setError(""); } })
        .catch((e) => { if (alive) setError(e?.message || "Failed to load invoices"); })
        .finally(() => { if (alive) setLoading(false); });
    }, search ? 300 : 0);
    return () => { alive = false; window.clearTimeout(t); };
  }, [tab, search, page]);

  const columns: Column<any>[] = [
    { key: "invoice_number", label: "Invoice #", render: (r) => <span className="font-semibold">{r.invoice_number}</span> },
    { key: "project", label: "Project", render: (r) => projects[r.project_id] || `#${r.project_id}` },
    { key: "po", label: "PO", render: (r) => (r.po_id ? pos[r.po_id] || `#${r.po_id}` : "—") },
    { key: "invoice_date", label: "Invoice Date", render: (r) => fmtDate(r.invoice_date) },
    { key: "due_date", label: "Due Date", render: (r) => fmtDate(r.due_date) },
    { key: "grand_total", label: "Grand Total", render: (r) => inr(r.grand_total) },
    { key: "paid_amount", label: "Paid", render: (r) => inr(r.paid_amount) },
    { key: "balance_amount", label: "Balance", render: (r) => inr(r.balance_amount) },
    { key: "payment_status", label: "Status", render: (r) => <StatusBadge status={r.payment_status} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-display text-lg font-bold text-primary">Invoices</h1>
        {canWrite && (
          <button className={btnPrimary} onClick={() => setShowNew(true)}>
            <Plus size={15} /> New Invoice
          </button>
        )}
      </div>
      <Tabs tabs={INVOICE_TABS} active={tab} onChange={(k) => { setTab(k); setPage(1); }} />
      {error && <ErrorBox error={error} />}
      <DataTable
        columns={columns}
        rows={rows}
        meta={meta}
        loading={loading}
        search={search}
        onSearch={(q) => { setSearch(q); setPage(1); }}
        onPage={setPage}
        onRowClick={(r) => crmNavigate(`invoices/${r.id}`)}
        emptyMessage={`No ${tab.replace(/_/g, " ").toLowerCase()} invoices`}
      />
      {showNew && (
        <InvoiceFormModal
          onClose={() => setShowNew(false)}
          onSaved={(inv) => { setShowNew(false); showToast("Invoice created"); crmNavigate(`invoices/${inv.id}`); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
      {toast}
    </div>
  );
}

/* ------------------------------------------------- New Invoice modal */

function InvoiceFormModal({
  onClose,
  onSaved,
  onError,
}: {
  onClose: () => void;
  onSaved: (inv: any) => void;
  onError: (msg: string) => void;
}) {
  const [projects, setProjects] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  const [projectId, setProjectId] = useState("");
  const [poId, setPoId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [subTotal, setSubTotal] = useState("");
  const [taxAmount, setTaxAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    crmGet<any[]>("/api/projects?limit=100").then((r) => setProjects(r.data || [])).catch(() => {});
    crmGet<any[]>("/api/purchase-orders?status=Active&limit=100").then((r) => setPos(r.data || [])).catch(() => {});
  }, []);

  const selectedPo = useMemo(() => pos.find((p) => String(p.id) === poId), [pos, poId]);
  const subN = num(subTotal) ?? 0;
  const taxOverride = taxAmount.trim() === "" ? undefined : num(taxAmount);
  const previewTax =
    taxOverride !== undefined
      ? taxOverride
      : selectedPo?.tax_slab != null
        ? Math.round(subN * Number(selectedPo.tax_slab)) / 100
        : 0;
  const previewGrand = Math.round((subN + previewTax) * 100) / 100;

  const submit = async () => {
    if (!projectId) { setErr("Project is required"); return; }
    if (!invoiceDate) { setErr("Invoice date is required"); return; }
    const sub = num(subTotal);
    if (sub === undefined || sub <= 0) { setErr("Sub-total must be a positive number"); return; }
    setErr("");
    setBusy(true);
    try {
      const payload: any = {
        project_id: Number(projectId),
        invoice_date: invoiceDate,
        sub_total: sub,
      };
      if (poId) payload.po_id = Number(poId);
      if (dueDate) payload.due_date = dueDate;
      if (taxOverride !== undefined) payload.tax_amount = taxOverride;
      const res = await crmPost("/api/invoices", payload);
      onSaved(res.data);
    } catch (e: any) {
      onError(e?.message || "Failed to create invoice");
      setBusy(false);
    }
  };

  return (
    <Modal title="New Invoice" onClose={onClose} wide fullScreen>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Project" required>
          <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Select project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Purchase order (active)">
          <select className={inputCls} value={poId} onChange={(e) => setPoId(e.target.value)}>
            <option value="">— No PO —</option>
            {pos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.po_number} (balance {inr(p.balance_value)})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Invoice date" required>
          <input type="date" className={inputCls} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
        </Field>
        <Field label="Due date">
          <input type="date" className={inputCls} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Sub-total (₹)" required>
          <input type="number" min={0} step="0.01" className={inputCls} value={subTotal} onChange={(e) => setSubTotal(e.target.value)} />
        </Field>
        <Field label="Tax amount (₹) — override">
          <input type="number" min={0} step="0.01" className={inputCls} value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} placeholder="Leave blank to auto-compute" />
          <span className="mt-1 block text-xs text-muted">
            Computed from the PO tax slab when left blank{selectedPo?.tax_slab != null ? ` (${selectedPo.tax_slab}%)` : ""}.
          </span>
        </Field>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-2 rounded-xl border border-subtle bg-surface-2 px-3 py-2.5">
          <IndianRupee size={15} className="text-muted" />
          <span className="text-sm text-secondary">
            Preview — Sub-total {inr(subN)} + Tax {inr(previewTax)} =
          </span>
          <span className="text-sm font-bold text-primary">Grand total {inr(previewGrand)}</span>
        </div>
      </div>
      {err && <div className="mt-2 text-sm text-rose-600">{err}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={btnPrimary} onClick={submit} disabled={busy}>
          {busy ? "Creating…" : "Create Invoice"}
        </button>
      </div>
    </Modal>
  );
}

/* =====================================================================
 * INVOICE — detail
 * =================================================================== */

export function InvoiceDetailPage() {
  const { id } = useCrmParams();
  const canWrite = useHasRole("Finance") && useCanEditTab("invoices");
  const [inv, setInv] = useState<any | null>(null);
  const [error, setError] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showTds, setShowTds] = useState(false);
  const [toast, showToast] = useToast();

  const load = () => {
    crmGet<any>(`/api/invoices/${id}`)
      .then((r) => { setInv(r.data); setError(""); })
      .catch((e) => setError(e?.message || "Failed to load invoice"));
  };
  useEffect(load, [id]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!inv) return <Spinner label="Loading invoice…" />;

  const tds = inv.tds_record;

  const generatePdf = async () => {
    setPdfBusy(true);
    try {
      const res = await crmPost<any>(`/api/invoices/${id}/generate-pdf`);
      setInv({ ...inv, invoice_pdf_url: res.data?.invoice_pdf_url });
      showToast("Invoice PDF generated");
    } catch (e: any) {
      showToast(e?.message || "Failed to generate PDF", "err");
    } finally {
      setPdfBusy(false);
    }
  };

  const paymentCols: Column<any>[] = [
    { key: "payment_date", label: "Date", render: (r) => fmtDate(r.payment_date) },
    { key: "amount", label: "Amount", render: (r) => inr(r.amount) },
    { key: "payment_mode", label: "Mode", render: (r) => r.payment_mode || "—" },
    { key: "reference_number", label: "Reference", render: (r) => r.reference_number || "—" },
    { key: "notes", label: "Notes", render: (r) => r.notes || "—" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <CrmLink to="invoices" className="text-sm font-semibold text-sky-600 hover:underline">Invoices</CrmLink>
        <span className="text-muted">/</span>
        <h1 className="text-display text-lg font-bold text-primary">{inv.invoice_number}</h1>
        <StatusBadge status={inv.payment_status} />
      </div>

      <Card
        title="Invoice"
        hero
        actions={<FileLink url={inv.invoice_pdf_url} label="Invoice PDF" />}
      >
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <InfoItem label="Project">
            {inv.project_id ? <CrmLink to={`projects/${inv.project_id}`} className="text-sky-600 hover:underline">{inv.project_name || `#${inv.project_id}`}</CrmLink> : "—"}
          </InfoItem>
          <InfoItem label="Purchase order">
            {inv.po_id ? <CrmLink to={`pos/${inv.po_id}`} className="text-sky-600 hover:underline">{inv.po_number || `#${inv.po_id}`}</CrmLink> : "—"}
          </InfoItem>
          <InfoItem label="Invoice date">{fmtDate(inv.invoice_date)}</InfoItem>
          <InfoItem label="Due date">{fmtDate(inv.due_date)}</InfoItem>
          <InfoItem label="Sub-total" numeric>{inr(inv.sub_total)}</InfoItem>
          <InfoItem label="Tax" numeric>{inr(inv.tax_amount)}</InfoItem>
          <InfoItem label="Grand total" numeric><span className="font-bold">{inr(inv.grand_total)}</span></InfoItem>
          <InfoItem label="Paid / Balance" numeric>{inr(inv.paid_amount)} / <span className="font-semibold">{inr(inv.balance_amount)}</span></InfoItem>
        </div>
        {canWrite && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-subtle pt-4">
            <button className={btnSecondary} onClick={generatePdf} disabled={pdfBusy}>
              <FileDown size={15} /> {pdfBusy ? "Generating…" : "Generate PDF"}
            </button>
            <button className={btnPrimary} onClick={() => setShowPayment(true)} disabled={Number(inv.balance_amount) <= 0}>
              <IndianRupee size={15} /> Record Payment
            </button>
            {!tds ? (
              <button className={btnSecondary} onClick={() => setShowTds(true)}>Record TDS</button>
            ) : (
              <button className={btnSecondary} onClick={() => setShowTds(true)} disabled={Number(tds.tds_balance) <= 0}>
                TDS Payment
              </button>
            )}
          </div>
        )}
      </Card>

      <Card title="Payment History">
        <DataTable columns={paymentCols} rows={inv.payments || []} emptyMessage="No payments recorded" />
      </Card>

      {tds && (
        <Card title="TDS Record">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="TDS amount" numeric>{inr(tds.tds_amount)}</InfoItem>
            <InfoItem label="TDS paid" numeric>{inr(tds.tds_paid)}</InfoItem>
            <InfoItem label="TDS balance" numeric>{inr(tds.tds_balance)}</InfoItem>
            <InfoItem label="Status"><StatusBadge status={tds.tds_status} /></InfoItem>
          </div>
        </Card>
      )}

      {showPayment && (
        <RecordPaymentModal
          invoice={inv}
          onClose={() => setShowPayment(false)}
          onSaved={() => { setShowPayment(false); showToast("Payment recorded"); load(); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
      {showTds && !tds && (
        <RecordTdsModal
          invoiceId={inv.id}
          onClose={() => setShowTds(false)}
          onSaved={() => { setShowTds(false); showToast("TDS recorded"); load(); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
      {showTds && tds && (
        <TdsPaymentModal
          invoiceId={inv.id}
          tds={tds}
          onClose={() => setShowTds(false)}
          onSaved={() => { setShowTds(false); showToast("TDS payment recorded"); load(); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
      {toast}
    </div>
  );
}

function RecordPaymentModal({
  invoice,
  onClose,
  onSaved,
  onError,
}: {
  invoice: any;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [paymentDate, setPaymentDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("Bank Transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const balance = Number(invoice.balance_amount || 0);
  const amtN = num(amount);
  const amountErr =
    amount === "" ? "" :
    amtN === undefined || amtN <= 0 ? "Amount must be a positive number" :
    amtN > balance ? `Cannot exceed the balance (${inr(balance)})` : "";

  const submit = async () => {
    if (!paymentDate || amtN === undefined || amtN <= 0 || amountErr) return;
    setBusy(true);
    try {
      const payload: any = { payment_date: paymentDate, amount: amtN, payment_mode: mode };
      if (reference.trim()) payload.reference_number = reference.trim();
      if (notes.trim()) payload.notes = notes.trim();
      await crmPost(`/api/invoices/${invoice.id}/record-payment`, payload);
      onSaved();
    } catch (e: any) {
      onError(e?.message || "Failed to record payment");
      setBusy(false);
    }
  };

  return (
    <Modal title="Record Payment" onClose={onClose} fullScreen>
      <div className="space-y-3">
        <div className="text-xs text-muted">Outstanding balance: <b>{inr(balance)}</b></div>
        <Field label="Payment date" required>
          <input type="date" className={inputCls} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
        </Field>
        <Field label="Amount (₹)" required error={amountErr || undefined}>
          <input type="number" min={0} step="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Payment mode">
          <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option>Cash</option>
            <option>Bank Transfer</option>
            <option>Cheque</option>
            <option>UPI</option>
          </select>
        </Field>
        <Field label="Reference number">
          <input className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
        </Field>
        <Field label="Notes">
          <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={btnPrimary} onClick={submit} disabled={busy || amount === "" || !!amountErr || !paymentDate}>
          {busy ? "Saving…" : "Record Payment"}
        </button>
      </div>
    </Modal>
  );
}

function RecordTdsModal({
  invoiceId,
  onClose,
  onSaved,
  onError,
}: {
  invoiceId: number;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const amtN = num(amount);
  const amountErr = amount !== "" && (amtN === undefined || amtN <= 0) ? "Amount must be a positive number" : "";

  const submit = async () => {
    if (amountErr) return;
    setBusy(true);
    try {
      const payload: any = {};
      if (amount !== "" && amtN !== undefined) payload.tds_amount = amtN;
      await crmPost(`/api/invoices/${invoiceId}/record-tds`, payload);
      onSaved();
    } catch (e: any) {
      onError(e?.message || "Failed to record TDS");
      setBusy(false);
    }
  };

  return (
    <Modal title="Record TDS" onClose={onClose} fullScreen>
      <div className="space-y-3">
        <Field label="TDS amount (₹)" error={amountErr || undefined}>
          <input type="number" min={0} step="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Leave blank for default" />
          <span className="mt-1 block text-xs text-muted">
            Defaults to the configured TDS rate on the invoice sub-total when left blank.
          </span>
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={btnPrimary} onClick={submit} disabled={busy || !!amountErr}>
          {busy ? "Saving…" : "Record TDS"}
        </button>
      </div>
    </Modal>
  );
}

function TdsPaymentModal({
  invoiceId,
  tds,
  onClose,
  onSaved,
  onError,
}: {
  invoiceId: number;
  tds: any;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const balance = Number(tds.tds_balance || 0);
  const amtN = num(amount);
  const amountErr =
    amount === "" ? "" :
    amtN === undefined || amtN <= 0 ? "Amount must be a positive number" :
    amtN > balance ? `Cannot exceed the TDS balance (${inr(balance)})` : "";

  const submit = async () => {
    if (amtN === undefined || amtN <= 0 || amountErr) return;
    setBusy(true);
    try {
      await crmPost(`/api/invoices/${invoiceId}/tds-payment`, { amount: amtN });
      onSaved();
    } catch (e: any) {
      onError(e?.message || "Failed to record TDS payment");
      setBusy(false);
    }
  };

  return (
    <Modal title="TDS Payment" onClose={onClose} fullScreen>
      <div className="space-y-3">
        <div className="text-xs text-muted">TDS balance: <b>{inr(balance)}</b></div>
        <Field label="Amount (₹)" required error={amountErr || undefined}>
          <input type="number" min={0} step="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={btnPrimary} onClick={submit} disabled={busy || amount === "" || !!amountErr}>
          {busy ? "Saving…" : "Record TDS Payment"}
        </button>
      </div>
    </Modal>
  );
}

/* =====================================================================
 * TDS register
 * =================================================================== */

const TDS_TABS = [
  { key: "Pending", label: "Pending" },
  { key: "Partially_Paid", label: "Partially Paid" },
  { key: "Paid", label: "Paid" },
];

export function TdsPage() {
  const [tab, setTab] = useState("Pending");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = window.setTimeout(() => {
      crmGet<any[]>(`/api/tds${qs({ tds_status: tab, search, page, limit: 20 })}`)
        .then((r) => { if (alive) { setRows(r.data || []); setMeta(r.meta); setError(""); } })
        .catch((e) => { if (alive) setError(e?.message || "Failed to load TDS records"); })
        .finally(() => { if (alive) setLoading(false); });
    }, search ? 300 : 0);
    return () => { alive = false; window.clearTimeout(t); };
  }, [tab, search, page]);

  const columns: Column<any>[] = [
    { key: "invoice_number", label: "Invoice #", render: (r) => <span className="font-semibold">{r.invoice_number || `Invoice #${r.invoice_id}`}</span> },
    { key: "customer_name", label: "Customer", render: (r) => r.customer_name || "—" },
    { key: "tds_amount", label: "TDS Amount", render: (r) => inr(r.tds_amount) },
    { key: "tds_paid", label: "Paid", render: (r) => inr(r.tds_paid) },
    { key: "tds_balance", label: "Balance", render: (r) => inr(r.tds_balance) },
    { key: "tds_status", label: "Status", render: (r) => <StatusBadge status={r.tds_status} /> },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-display text-lg font-bold text-primary">TDS Register</h1>
      <Tabs tabs={TDS_TABS} active={tab} onChange={(k) => { setTab(k); setPage(1); }} />
      {error && <ErrorBox error={error} />}
      <DataTable
        columns={columns}
        rows={rows}
        meta={meta}
        loading={loading}
        search={search}
        onSearch={(q) => { setSearch(q); setPage(1); }}
        onPage={setPage}
        onRowClick={(r) => crmNavigate(`invoices/${r.invoice_id}`)}
        emptyMessage={`No ${tab.replace(/_/g, " ").toLowerCase()} TDS records`}
      />
    </div>
  );
}
