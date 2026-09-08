/** Finance module pages: Purchase Orders (list/detail), Invoices (list/detail), TDS register.
 * Writes: Finance (Admin implicit). Reads also Sales_Head. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ban, Building2, ChevronDown, ChevronRight, ClipboardCheck, DollarSign, FileDown, FileText,
  IndianRupee, Layers, MapPin, Pencil, Plus, Receipt, RefreshCw, Search,
} from "lucide-react";
import { crmGet, crmPost, crmPut, qs, type Meta } from "../api";
import { authFetch } from "../../api/client";
import { useHasRole } from "../CrmApp";
import { useCanAct } from "../useAccess";
import { CrmLink, crmNavigate, useCrmParams } from "../routerHooks";
import { DataTable, type Column } from "../components/DataTable";
import { RowActions, afterListDelete } from "../components/RowActions";
import {
  ActionError, btnDanger, btnPrimary, btnSecondary, ConfirmModal, ErrorBox, inputCls,
  Modal, Spinner, StatusBadge, Tabs, useToast,
} from "../components/ui";
import { TeachingEmpty } from "../components/TeachingEmpty";
import {
  InfoChip, SectionHeaderBanner, WizardField, WizardFooter, WizardShell, WizardStepCard,
  WizardTopBar, type WizardStep,
} from "../components/wizard";
import { ContactPersonFormModal } from "../components/ContactPersonFormModal";
import { SearchableSelect, type SearchableOption } from "../components/SearchableSelect";
import { fetchAllMaster } from "../lib/fetchAllMaster";
import { COUNTRIES, DEFAULT_COUNTRY } from "../constants/geo";
/* ---------------------------------------------------------------- helpers */

const inr = (v: number | null | undefined): string =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Tax Invoice–style currency: "₹ " + en-IN with forced 2dp. */
const formatGstInr = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(Number(v))
    ? "—"
    : `₹ ${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d?: string | null): string => (d ? new Date(d).toLocaleDateString("en-IN") : "—");

const num = (s: string): number | undefined => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
};

const TAX_SLABS = [0, 5, 12, 18, 25, 30] as const;

const GST_SLAB_OPTIONS: { value: string; label: string }[] = TAX_SLABS.map((r) => ({
  value: String(r),
  label: r === 0 ? "GST 0%" : `GST ${r}%`,
}));

function parseGstRate(key: string): number | null {
  if (!key.trim()) return null;
  const rate = Number(key);
  if (!TAX_SLABS.includes(rate as (typeof TAX_SLABS)[number])) return null;
  return rate;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const fmtAmt2 = (n: number): string =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const today = () => new Date().toISOString().slice(0, 10);

type AddrForm = {
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
};

const emptyAddr = (): AddrForm => ({
  address_line_1: "",
  address_line_2: "",
  city: "",
  state: "",
  pincode: "",
  country: DEFAULT_COUNTRY,
});

/** Prefill editable address fields from a customer branch (billing vs delivery line). */
function addrFromBranch(branch: any | undefined, kind: "billing" | "delivery"): AddrForm {
  if (!branch) return emptyAddr();
  const line1 = kind === "delivery"
    ? (branch.delivery_address || branch.billing_address)
    : branch.billing_address;
  return {
    address_line_1: String(line1 || ""),
    address_line_2: String(branch.address_line_2 || ""),
    city: String(branch.city || ""),
    state: String(branch.state || ""),
    pincode: String(branch.pincode || ""),
    country: String(branch.country || DEFAULT_COUNTRY),
  };
}

function formatAddrForm(addr: AddrForm): string {
  const parts = [
    addr.address_line_1,
    addr.address_line_2,
    [addr.city, addr.state].filter(Boolean).join(", "),
    addr.pincode,
    addr.country,
  ].map((p) => String(p || "").trim()).filter(Boolean);
  return parts.join(" · ");
}

/** AddressSnapshotIn for POST/PUT /api/purchase-orders (nulls when empty). */
function addrToSnapshot(addr: AddrForm) {
  const snap = {
    address_line_1: addr.address_line_1.trim() || null,
    address_line_2: addr.address_line_2.trim() || null,
    city: addr.city.trim() || null,
    state: addr.state.trim() || null,
    pincode: addr.pincode.trim() || null,
    country: addr.country.trim() || null,
  };
  if (!Object.values(snap).some(Boolean)) return undefined;
  return snap;
}

/** Hydrate editable address fields from a PO billing/delivery snapshot. */
function snapToAddr(snap: any | null | undefined): AddrForm {
  if (!snap || typeof snap !== "object") return emptyAddr();
  return {
    address_line_1: String(snap.address_line_1 || ""),
    address_line_2: String(snap.address_line_2 || ""),
    city: String(snap.city || ""),
    state: String(snap.state || ""),
    pincode: String(snap.pincode || ""),
    country: String(snap.country || DEFAULT_COUNTRY),
  };
}

/** Editable address block under Billing / Delivery branch (Zoho-style layout). */
function PoAddressFields({
  title,
  addr,
  onChange,
  disabled,
}: {
  title: string;
  addr: AddrForm;
  onChange: (next: AddrForm) => void;
  disabled?: boolean;
}) {
  const set = (k: keyof AddrForm, v: string) => onChange({ ...addr, [k]: v });
  const sub = "mt-1 text-[11px] font-medium text-muted";
  return (
    <div className="space-y-3 rounded-xl border border-subtle bg-surface-2/60 p-3">
      <div className="text-xs font-bold uppercase tracking-wide text-secondary">{title}</div>
      <div>
        <input
          className={inputCls}
          value={addr.address_line_1}
          onChange={(e) => set("address_line_1", e.target.value)}
          disabled={disabled}
          placeholder="Address line 1"
        />
        <div className={sub}>Address Line 1</div>
      </div>
      <div>
        <input
          className={inputCls}
          value={addr.address_line_2}
          onChange={(e) => set("address_line_2", e.target.value)}
          disabled={disabled}
          placeholder="Address line 2"
        />
        <div className={sub}>Address Line 2</div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <input
            className={inputCls}
            value={addr.city}
            onChange={(e) => set("city", e.target.value)}
            disabled={disabled}
            placeholder="City"
          />
          <div className={sub}>City / District</div>
        </div>
        <div>
          <input
            className={inputCls}
            value={addr.state}
            onChange={(e) => set("state", e.target.value)}
            disabled={disabled}
            placeholder="State"
          />
          <div className={sub}>State / Province</div>
        </div>
        <div>
          <input
            className={inputCls}
            value={addr.pincode}
            onChange={(e) => set("pincode", e.target.value)}
            disabled={disabled}
            placeholder="Postal code"
          />
          <div className={sub}>Postal Code</div>
        </div>
        <div>
          <select
            className={inputCls}
            value={addr.country}
            onChange={(e) => set("country", e.target.value)}
            disabled={disabled}
          >
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <div className={sub}>Country</div>
        </div>
      </div>
    </div>
  );
}

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

/** KARNEX GST breakdown — mirrors Tax Invoice layout with CRM/Dune tokens. */
function InvoiceGstSection({ gst }: { gst: any }) {
  if (!gst) return null;
  const row = (label: string, value: number, muted?: boolean) => (
    <div className={`flex items-center justify-between gap-3 py-1.5 text-sm ${muted ? "text-muted" : "text-primary"}`}>
      <span>{label}</span>
      <span className="font-display tabular-nums">{formatGstInr(value)}</span>
    </div>
  );
  const note = typeof gst.note === "string" ? gst.note : "";
  const missing = note.includes("GST not computed");

  return (
    <div className="space-y-3">
          {missing && (
        <div className="inline-flex max-w-full items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
          <span>
            {note}. Set the customer branch State (2-digit code) or GSTIN so GST can be computed.
          </span>
        </div>
      )}
      {!missing && note && (
        <div className="text-xs text-muted">{note}</div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-card border border-subtle bg-surface-1 px-4 py-3 shadow-sm">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">GST Summary</div>
          {row("CGST @ 9%", Number(gst.cgst || 0), Number(gst.cgst || 0) === 0)}
          {row("SGST @ 9%", Number(gst.sgst || 0), Number(gst.sgst || 0) === 0)}
          {row("IGST @ 18%", Number(gst.igst || 0), Number(gst.igst || 0) === 0)}
          <div className="mt-1 border-t border-subtle pt-1.5">
            {row("Total GST", Number(gst.total_gst || 0))}
          </div>
        </div>
        <div className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-sm">
          <div className="px-4 py-3">
            {row("Sub Total", Number(gst.subtotal ?? gst.sub_total ?? 0))}
            {row("CGST @ 9%", Number(gst.cgst || 0), Number(gst.cgst || 0) === 0)}
            {row("SGST @ 9%", Number(gst.sgst || 0), Number(gst.sgst || 0) === 0)}
            {row("IGST @ 18%", Number(gst.igst || 0), Number(gst.igst || 0) === 0)}
            {row("Total GST Tax", Number(gst.total_gst || 0))}
          </div>
          <div className="flex items-center justify-between gap-3 bg-[color:var(--accent,#c2410c)] px-4 py-3 text-sm font-bold text-white">
            <span>GRAND TOTAL</span>
            <span className="font-display tabular-nums">{formatGstInr(Number(gst.grand_total || 0))}</span>
          </div>
        </div>
      </div>
    </div>
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
  /* Both hooks must run unconditionally (rules-of-hooks) — combine after. */
  const canWriteRole = useHasRole("Finance");
  const canWrite = useCanAct("pos", "edit", canWriteRole);
  const [tab, setTab] = useState("Active");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);

  // Deep-link create (hub "New …" buttons): ?create=1 opens the dialog once,
  // then strips the flag so refresh / back never reopen it.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("create") === "1") {
      setEditPoId(null); setShowNew(true);
      sp.delete("create");
      window.history.replaceState(null, "", `${window.location.pathname}?${sp.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [editPoId, setEditPoId] = useState<number | null>(null);
  /** Allocate straight from the LIST (26 Aug 2026): the full PO is fetched
   * first because the modal needs its allocations for the remaining-balance
   * maths — the list rows carry only the totals. */
  const [allocPo, setAllocPo] = useState<any | null>(null);
  const [allocLoadingId, setAllocLoadingId] = useState<number | null>(null);
  const openAllocate = (r: any) => {
    setAllocLoadingId(r.id);
    crmGet<any>(`/api/purchase-orders/${r.id}`)
      .then((res) => setAllocPo(res.data))
      .catch((e: any) => showToast(e?.message || "Failed to load PO", "err"))
      .finally(() => setAllocLoadingId(null));
  };
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, showToast] = useToast();
  const customers = useNameMap("/api/customers/names");
  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    // CUSTOMER-GROUPED VIEW (user decision, 26 Aug 2026): every page is
    // fetched so the grouping covers the whole tab, not one page of it.
    let alive = true;
    setLoading(true);
    fetchAllMaster<any>("/api/purchase-orders", { status: tab })
      .then((all) => { if (alive) { setRows(all); setError(""); } })
      .catch((e) => { if (alive) setError(e?.message || "Failed to load purchase orders"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tab, reloadKey]);

  /** Customers first, their POs beneath (user decision, 26 Aug 2026): one
   * expandable section per customer, on all three status tabs. Search is
   * client-side over the full tab — PO number OR customer name. */
  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const visible = !needle ? rows : rows.filter((r) =>
      String(r.po_number || "").toLowerCase().includes(needle)
      || (customers[r.customer_id] || "").toLowerCase().includes(needle)
      || String(r.employee_name || "").toLowerCase().includes(needle));
    const byCust = new Map<number, any[]>();
    for (const r of visible) {
      const list = byCust.get(r.customer_id) || [];
      list.push(r);
      byCust.set(r.customer_id, list);
    }
    return [...byCust.entries()]
      .map(([cid, pos]) => ({
        customer_id: cid,
        name: customers[cid] || `Customer #${cid}`,
        pos,
        total: pos.reduce((s, p) => s + Number(p.total_value || 0), 0),
        balance: pos.reduce((s, p) => s + Number(p.balance_value || 0), 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, customers, search]);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const toggle = (cid: number) => setExpanded((prev) => ({ ...prev, [cid]: !prev[cid] }));
  // A search means "find that PO" — auto-open every matching section.
  const isOpen = (cid: number) => (search ? expanded[cid] !== false : !!expanded[cid]);

  const closeForm = () => { setShowNew(false); setEditPoId(null); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-display text-lg font-bold text-primary">Purchase Orders</h1>
        {canWrite && (
          <button className={btnPrimary} onClick={() => { setEditPoId(null); setShowNew(true); }}>
            <Plus size={15} /> New PO
          </button>
        )}
      </div>
      <Tabs tabs={PO_TABS} active={tab} onChange={setTab} />
      {error && <ErrorBox error={error} />}
      <div className="flex min-w-[220px] max-w-sm items-center gap-2 rounded-control border border-subtle bg-surface-1 px-3">
        <Search size={14} className="shrink-0 text-muted" />
        <input
          className="h-9 w-full bg-transparent text-sm text-primary placeholder:text-muted focus:outline-none"
          placeholder="Search PO number, customer or employee…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {loading && <Spinner label="Loading purchase orders…" />}
      {!loading && groups.length === 0 && <TeachingEmpty page="pos" />}
      {!loading && groups.map((g) => (
        <div key={g.customer_id} className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
          <button
            type="button"
            onClick={() => toggle(g.customer_id)}
            className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors duration-micro hover:bg-surface-2"
            aria-expanded={isOpen(g.customer_id)}
          >
            {isOpen(g.customer_id)
              ? <ChevronDown size={16} className="shrink-0 text-muted" />
              : <ChevronRight size={16} className="shrink-0 text-muted" />}
            <Building2 size={16} className="shrink-0 text-brand-600 dark:text-brand-300" />
            <span className="text-sm font-bold text-primary">{g.name}</span>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-secondary">
              {g.pos.length} PO{g.pos.length === 1 ? "" : "s"}
            </span>
            <span className="ml-auto flex flex-wrap gap-x-5 text-xs text-muted">
              <span>Total <span className="font-semibold text-primary tnum">{inr(g.total)}</span></span>
              <span>Balance <span className="font-semibold text-primary tnum">{inr(g.balance)}</span></span>
            </span>
          </button>
          {isOpen(g.customer_id) && (
            <table className="w-full border-t border-subtle text-sm">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted">
                  <th className="px-4 py-2">PO Number</th>
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Total</th>
                  <th className="px-3 py-2">Consumed</th>
                  <th className="px-3 py-2">Balance</th>
                  <th className="px-3 py-2">Status</th>
                  {canWrite && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {g.pos.map((r) => (
                  <tr key={r.id} className="row-hover cursor-pointer border-t border-subtle"
                    onClick={() => crmNavigate(`pos/${r.id}`)}>
                    <td className="px-4 py-2.5 font-semibold text-primary">{r.po_number}</td>
                    <td className="px-3 py-2.5 text-secondary">{r.employee_name || "—"}</td>
                    <td className="px-3 py-2.5 text-secondary">{r.po_type}</td>
                    <td className="px-3 py-2.5 tnum">{inr(r.total_value)}</td>
                    <td className="px-3 py-2.5 tnum">{inr(r.consumed_value)}</td>
                    <td className="px-3 py-2.5 tnum">{inr(r.balance_value)}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={r.status} /></td>
                    {canWrite && (
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                          {r.status === "Active" && (
                            <button
                              type="button"
                              title={`Allocate ${r.po_number} to a project`}
                              aria-label={`Allocate ${r.po_number} to a project`}
                              disabled={allocLoadingId === r.id}
                              onClick={() => openAllocate(r)}
                              className="rounded-control p-1.5 text-muted transition-colors duration-micro hover:bg-surface-2 hover:text-brand-600 disabled:opacity-50 dark:hover:text-brand-300"
                            >
                              <Layers size={15} />
                            </button>
                          )}
                          <RowActions
                            entity="purchase order"
                            itemLabel={r.po_number}
                            onView={() => crmNavigate(`pos/${r.id}`)}
                            onEdit={() => { setShowNew(false); setEditPoId(r.id); }}
                            deleteUrl={`/api/purchase-orders/${r.id}`}
                            onDeleted={() => afterListDelete(r.id, setRows, load)}
                            notify={showToast}
                            canEdit={r.status !== "Cancelled"}
                            canDelete
                          colored />
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
      {(showNew || editPoId != null) && (
        <POFormModal
          customers={customers}
          editPoId={editPoId}
          onClose={closeForm}
          onSaved={(po) => {
            const wasEdit = editPoId != null;
            closeForm();
            showToast(wasEdit ? "Purchase order updated" : "Purchase order created");
            if (wasEdit) load();
            else crmNavigate(`pos/${po.id}`);
          }}
          onError={(m) => showToast(m, "err")}
          notify={showToast}
        />
      )}
      {allocPo && (
        <AllocateModal
          po={allocPo}
          customerName={customers[allocPo.customer_id]}
          onClose={() => setAllocPo(null)}
          onSaved={() => {
            setAllocPo(null);
            showToast("Project allocation saved");
            load();
          }}
          onError={(m) => showToast(m, "err")}
        />
      )}
      {toast}
    </div>
  );
}

/* ------------------------------------------------------- New / Edit PO modal */

function POFormModal({
  customers,
  editPoId = null,
  onClose,
  onSaved,
  onError,
  notify,
}: {
  customers: Record<number, string>;
  editPoId?: number | null;
  onClose: () => void;
  onSaved: (po: any) => void;
  onError: (msg: string) => void;
  notify: (msg: string, kind?: "ok" | "err") => void;
}) {
  const isEdit = editPoId != null;
  const [customerId, setCustomerId] = useState("");
  const [branches, setBranches] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [billingId, setBillingId] = useState("");
  const [deliveryId, setDeliveryId] = useState("");
  const [billingAddr, setBillingAddr] = useState<AddrForm>(emptyAddr);
  const [deliveryAddr, setDeliveryAddr] = useState<AddrForm>(emptyAddr);
  const [contactId, setContactId] = useState("");
  // Which employee this PO funds (26 Aug 2026) — searched from the Employees master.
  const [employeeId, setEmployeeId] = useState("");
  const [employees, setEmployees] = useState<SearchableOption[]>([]);
  const [poNumber, setPoNumber] = useState("");
  /** Live duplicate check (26 Aug 2026): the server refuses duplicate PO
   * numbers at save — on the LAST step, as a missable toast. Warn while
   * typing instead, and block Next/Create while the number is taken. */
  const [poNumberTaken, setPoNumberTaken] = useState("");
  useEffect(() => {
    const typed = poNumber.trim();
    if (!typed) { setPoNumberTaken(""); return; }
    let alive = true;
    const t = window.setTimeout(() => {
      crmGet<{ available: boolean; existing?: { po_number: string; customer_name?: string | null } }>(
        `/api/purchase-orders/check-number${qs({ po_number: typed, exclude_id: editPoId || undefined })}`,
      )
        .then((r) => {
          if (!alive) return;
          setPoNumberTaken(r.data?.available === false
            ? `PO number '${typed}' already exists${r.data?.existing?.customer_name ? ` (${r.data.existing.customer_name})` : ""}. Use a different number.`
            : "");
        })
        .catch(() => { /* check failure must not block typing; save still validates */ });
    }, 450);
    return () => { alive = false; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poNumber, editPoId]);
  const [receivedDate, setReceivedDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // Regular PO is the house default; edit hydration overwrites this from the row.
  const [poType, setPoType] = useState("Regular PO");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [taxSlabKey, setTaxSlabKey] = useState("");
  const [interState, setInterState] = useState(false);
  const [totalValue, setTotalValue] = useState("");
  const [projects, setProjects] = useState<any[]>([]);
  const [allocProjectId, setAllocProjectId] = useState("");
  const [allocAmount, setAllocAmount] = useState("");
  /** When editing, remember an existing allocation so we don't double-POST allocate. */
  const [hadExistingAlloc, setHadExistingAlloc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingPo, setLoadingPo] = useState(isEdit);
  const [loadErr, setLoadErr] = useState("");
  const [err, setErr] = useState("");
  const [stepIndex, setStepIndex] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [stepDir, setStepDir] = useState<1 | -1>(1);
  const [showNewContact, setShowNewContact] = useState(false);
  const [hydrated, setHydrated] = useState(!isEdit);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isEdit || editPoId == null) {
      setLoadingPo(false);
      setHydrated(true);
      return;
    }
    let alive = true;
    setLoadingPo(true);
    setLoadErr("");
    (async () => {
      try {
        const r = await crmGet<any>(`/api/purchase-orders/${editPoId}`);
        const po = r.data;
        if (!alive || !po) throw new Error("Purchase order not found");
        const cid = po.customer_id;
        const [brRes, ctRes] = await Promise.all([
          crmGet<any[]>(`/api/customers/${cid}/branches`),
          crmGet<any[]>(`/api/customers/${cid}/contacts`),
        ]);
        if (!alive) return;
        const br = brRes.data || [];
        const ct = ctRes.data || [];
        setBranches(br);
        setContacts(ct);
        setCustomerId(String(cid));
        setPoNumber(String(po.po_number || ""));
        setReceivedDate(po.received_date ? String(po.received_date).slice(0, 10) : "");
        setStartDate(po.start_date ? String(po.start_date).slice(0, 10) : "");
        setEndDate(po.end_date ? String(po.end_date).slice(0, 10) : "");
        setPoType(po.po_type || "Open PO");
        setPaymentTerms(po.payment_terms || "");
        const slab = po.tax_slab != null ? String(Number(po.tax_slab)) : "";
        setTaxSlabKey(TAX_SLABS.includes(Number(slab) as (typeof TAX_SLABS)[number]) ? slab : "");
        setInterState(po.igst != null && Number(po.igst) > 0);
        setTotalValue(po.total_value != null ? String(po.total_value) : "");
        const billId = po.billing_branch_id != null ? String(po.billing_branch_id) : "";
        const delId = po.delivery_branch_id != null ? String(po.delivery_branch_id) : "";
        setBillingId(billId);
        setDeliveryId(delId);
        const billingSnap = snapToAddr(po.billing_address);
        const deliverySnap = snapToAddr(po.delivery_address);
        const snapMeaningful = (a: AddrForm) =>
          Boolean(a.address_line_1 || a.address_line_2 || a.city || a.state || a.pincode);
        setBillingAddr(
          snapMeaningful(billingSnap)
            ? billingSnap
            : (billId ? addrFromBranch(br.find((x: any) => String(x.id) === billId), "billing") : emptyAddr()),
        );
        setDeliveryAddr(
          snapMeaningful(deliverySnap)
            ? deliverySnap
            : (delId ? addrFromBranch(br.find((x: any) => String(x.id) === delId), "delivery") : emptyAddr()),
        );
        setContactId(po.contact_person_id != null ? String(po.contact_person_id) : "");
        setEmployeeId(po.employee_id != null ? String(po.employee_id) : "");
        const firstAlloc = Array.isArray(po.allocations) && po.allocations.length > 0 ? po.allocations[0] : null;
        if (firstAlloc?.project_id != null) {
          setAllocProjectId(String(firstAlloc.project_id));
          setAllocAmount(firstAlloc.allocated_amount != null ? String(firstAlloc.allocated_amount) : "");
          setHadExistingAlloc(true);
        } else {
          setAllocProjectId("");
          setAllocAmount("");
          setHadExistingAlloc(false);
        }
        setMaxReached(4);
        setHydrated(true);
        setLoadErr("");
      } catch (e: any) {
        if (alive) setLoadErr(e?.message || "Failed to load purchase order");
      } finally {
        if (alive) setLoadingPo(false);
      }
    })();
    return () => { alive = false; };
  }, [editPoId, isEdit]);

  // AUTO IGST (user decision, 26 Aug 2026): Karnex bills from Maharashtra, so
  // a billing address in any OTHER state is an inter-state supply → IGST on;
  // a Maharashtra billing address stays CGST+SGST. Recomputed whenever the
  // billing STATE changes (including on edit-open, so a wrongly saved split
  // self-corrects); the checkbox stays manually overridable afterwards.
  useEffect(() => {
    if (isEdit && !hydrated) return;
    const st = (billingAddr.state || "").trim().toLowerCase();
    if (!st) return;
    setInterState(!st.includes("maharashtra"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingAddr.state, hydrated]);

  useEffect(() => {
    // ALL employees, including Relieved (26 Aug 2026, user decision): POs are
    // being backfilled from April 2026, and many belong to people who have
    // since left. Relieved names are suffixed so Finance picks them knowingly;
    // active names sort first. Every page is fetched — the API caps at
    // 100/request and the directory holds ~290 people.
    fetchAllMaster<any>("/api/employees")
      .then((rows) => setEmployees(
        rows
          .sort((a: any, b: any) => Number(b.is_active) - Number(a.is_active))
          .map((e: any) => ({
            value: String(e.id),
            label: `${e.full_name || `${e.first_name} ${e.last_name || ""}`.trim()}${e.is_active ? "" : " (Relieved)"}`,
          }))))
      .catch(() => setEmployees([]));
  }, []);

  useEffect(() => {
    // Edit hydrate owns branches/contacts; customer is locked so skip reset.
    if (isEdit) return;
    setBranches([]); setContacts([]); setBillingId(""); setDeliveryId(""); setContactId("");
    setBillingAddr(emptyAddr()); setDeliveryAddr(emptyAddr());
    setProjects([]); setAllocProjectId(""); setAllocAmount("");
    if (!customerId) return;
    crmGet<any[]>(`/api/customers/${customerId}/branches`).then((r) => setBranches(r.data || [])).catch(() => {});
    crmGet<any[]>(`/api/customers/${customerId}/contacts`).then((r) => setContacts(r.data || [])).catch(() => {});
  }, [customerId, isEdit]);

  useEffect(() => {
    if (isEdit && !hydrated) return;
    if (!(isEdit && hadExistingAlloc)) {
      setAllocProjectId("");
      setAllocAmount("");
    }
    if (!customerId || !billingId) {
      setProjects([]);
      return;
    }
    let alive = true;
    crmGet<any[]>(`/api/projects${qs({ customer_id: customerId, limit: 100 })}`)
      .then((r) => {
        if (!alive) return;
        const rows = (r.data || []).filter(
          (p: any) => p.branch_id == null || String(p.branch_id) === billingId,
        );
        setProjects(rows);
      })
      .catch(() => { if (alive) setProjects([]); });
    return () => { alive = false; };
  }, [customerId, billingId, isEdit, hydrated, hadExistingAlloc]);

  const selectBillingBranch = (id: string) => {
    setBillingId(id);
    const b = branches.find((x) => String(x.id) === id);
    setBillingAddr(id ? addrFromBranch(b, "billing") : emptyAddr());
  };
  const selectDeliveryBranch = (id: string) => {
    setDeliveryId(id);
    const b = branches.find((x) => String(x.id) === id);
    setDeliveryAddr(id ? addrFromBranch(b, "delivery") : emptyAddr());
  };

  const slabN = parseGstRate(taxSlabKey);
  const totalN = num(totalValue);
  const poValueAmt = totalN ?? 0;
  const gstAmt = slabN === null ? 0 : round2(poValueAmt * slabN / 100);
  /** Sub value = taxable PO value; Total value = PO + GST. */
  const subValueAmt = poValueAmt;
  const totalWithGstAmt = round2(poValueAmt + gstAmt);
  const sgstAmt = round2(gstAmt / 2);
  const cgstAmt = round2(gstAmt / 2);

  const submit = async () => {
    const total = num(totalValue);
    if (!customerId) { setErr("Customer is required"); return; }
    if (!poNumber.trim()) { setErr("PO No is required"); return; }
    if (poNumberTaken) { setErr(poNumberTaken); return; }
    if (startDate && endDate && endDate < startDate) {
      setErr("PO End Date cannot be before PO Start Date");
      return;
    }
    if (total === undefined || total <= 0) { setErr("PO Value must be a positive number"); return; }
    setErr("");
    setBusy(true);
    try {
      const payload: any = {
        po_number: poNumber.trim(),
        po_type: poType,
        inter_state: interState,
        total_value: total,
      };
      if (!isEdit) payload.customer_id = Number(customerId);
      if (billingId) payload.billing_branch_id = Number(billingId);
      else if (isEdit) payload.billing_branch_id = null;
      if (deliveryId) payload.delivery_branch_id = Number(deliveryId);
      else if (isEdit) payload.delivery_branch_id = null;
      if (isEdit && customerId) payload.customer_id = Number(customerId);
      if (employeeId) payload.employee_id = Number(employeeId);
      else if (isEdit) payload.employee_id = null;
      if (receivedDate) payload.received_date = receivedDate;
      else if (isEdit) payload.received_date = null;
      if (startDate) payload.start_date = startDate;
      else if (isEdit) payload.start_date = null;
      if (endDate) payload.end_date = endDate;
      else if (isEdit) payload.end_date = null;
      if (paymentTerms.trim()) payload.payment_terms = paymentTerms.trim();
      else if (isEdit) payload.payment_terms = null;
      if (slabN !== null) payload.tax_slab = slabN;
      else if (isEdit) payload.tax_slab = null;
      const billingSnap = addrToSnapshot(billingAddr);
      const deliverySnap = addrToSnapshot(deliveryAddr);
      if (billingSnap) payload.billing_address = billingSnap;
      else if (isEdit) payload.billing_address = null;
      if (deliverySnap) payload.delivery_address = deliverySnap;
      else if (isEdit) payload.delivery_address = null;

      const res = isEdit
        ? await crmPut<any>(`/api/purchase-orders/${editPoId}`, payload)
        : await crmPost<any>("/api/purchase-orders", payload);
      const po = res.data;
      // Create: optional allocate. Edit: only allocate when none existed yet (avoid double-add).
      const shouldAllocate = !!allocProjectId && po?.id && (!isEdit || !hadExistingAlloc);
      if (shouldAllocate) {
        const alloc = num(allocAmount) ?? total;
        try {
          await crmPost(`/api/purchase-orders/${po.id}/allocate-project`, {
            project_id: Number(allocProjectId),
            allocated_amount: alloc,
            contact_person_id: contactId ? Number(contactId) : null,
          });
        } catch (e: any) {
          notify(
            `${isEdit ? "PO updated" : "PO created"}, but project allocation failed: ${e?.message || "unknown error"}`,
            "err",
          );
        }
      }
      onSaved(po);
    } catch (e: any) {
      const msg = e?.message || (isEdit ? "Failed to update purchase order" : "Failed to create purchase order");
      setErr(msg);  // visible on the Review step — a toast alone was missed
      onError(msg);
      setBusy(false);
    }
  };

  const poSteps = [
    { key: "header", title: "PO Header", subtitle: "Customer, PO number, and dates.", icon: <Receipt size={20} aria-hidden /> },
    { key: "address", title: "Billing & Delivery Address", subtitle: "Set the billing and delivery branches.", icon: <MapPin size={20} aria-hidden /> },
    { key: "commercial", title: "Commercial Details", subtitle: "PO type, value, GST slab, and tax split.", icon: <DollarSign size={20} aria-hidden /> },
    {
      key: "allocate",
      title: "Allocate to Project (optional)",
      subtitle: isEdit && hadExistingAlloc
        ? "Existing allocation shown. Add more from the PO detail page."
        : "Skip freely — you can allocate any time from the PO page after creating it.",
      icon: <Layers size={20} aria-hidden />,
    },
    {
      key: "review",
      title: "Review",
      subtitle: isEdit ? "Confirm the details, then save changes." : "Confirm the details, then create the PO.",
      icon: <ClipboardCheck size={20} aria-hidden />,
    },
  ];
  const totalSteps = poSteps.length;
  const isFirstStep = stepIndex <= 0;
  const isLastStep = stepIndex >= totalSteps - 1;
  const stepPct = Math.round(((stepIndex + 1) / totalSteps) * 100);
  const commercialStepIdx = poSteps.findIndex((s) => s.key === "commercial");
  const allocateStepIdx = poSteps.findIndex((s) => s.key === "allocate");

  const stepStatus = (key: string): WizardStep["status"] => {
    if (key === "header") return customerId && poNumber.trim() ? "complete" : "empty";
    if (key === "address") return (billingId || deliveryId || maxReached >= 1) ? "complete" : "empty";
    if (key === "allocate") return allocProjectId || maxReached >= allocateStepIdx ? "complete" : "empty";
    if (key === "commercial") return totalN !== undefined && totalN > 0 ? "complete" : totalValue !== "" ? "error" : "empty";
    return isLastStep ? "complete" : "empty";
  };
  const wizardSteps: WizardStep[] = poSteps.map((s) => ({
    key: s.key, title: s.title, sublabel: s.subtitle, status: stepStatus(s.key),
  }));

  const validateStep = (idx: number): boolean => {
    if (idx === 0) {
      if (!customerId) { setErr("Customer is required"); return false; }
      if (!poNumber.trim()) { setErr("PO No is required"); return false; }
      if (poNumberTaken) { setErr(poNumberTaken); return false; }
      if (startDate && endDate && endDate < startDate) {
        setErr("PO End Date cannot be before PO Start Date");
        return false;
      }
    }
    if (idx === commercialStepIdx && (totalN === undefined || totalN <= 0)) {
      setErr("PO Value must be a positive number");
      return false;
    }
    return true;
  };
  const goToStep = (i: number) => {
    if (i < 0 || i >= totalSteps || i > maxReached) return;
    setStepDir(i >= stepIndex ? 1 : -1);
    setStepIndex(i);
  };
  const goPrev = () => { if (isFirstStep) return; setStepDir(-1); setStepIndex((i) => Math.max(0, i - 1)); };
  const goNext = () => {
    if (!validateStep(stepIndex)) return;
    setErr("");
    if (isLastStep) return;
    const n = stepIndex + 1;
    setStepDir(1); setStepIndex(n); setMaxReached((m) => Math.max(m, n));
  };

  useEffect(() => {
    if (loadingPo) return;
    const t = window.setTimeout(() => {
      const el = bodyRef.current?.querySelector<HTMLElement>(
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
      );
      el?.focus?.();
    }, 220);
    return () => window.clearTimeout(t);
  }, [stepIndex, loadingPo]);

  if (loadingPo) {
    return (
      <Modal title="Edit Purchase Order" onClose={onClose} wide>
        <div className="py-10"><Spinner label="Loading purchase order…" /></div>
      </Modal>
    );
  }

  if (loadErr) {
    return (
      <Modal title="Edit Purchase Order" onClose={onClose} wide>
        <ErrorBox error={loadErr} />
      </Modal>
    );
  }

  const gridCls = "grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2";
  const branchOptions = branches.map((b) => (
    <option key={b.id} value={b.id}>{b.branch_name}{b.is_primary ? " (primary)" : ""}</option>
  ));
  const billingBranch = branches.find((b) => String(b.id) === billingId);
  const deliveryBranch = branches.find((b) => String(b.id) === deliveryId);
  const billingBranchName = billingBranch?.branch_name;
  const deliveryBranchName = deliveryBranch?.branch_name;
  const billingAddressText = formatAddrForm(billingAddr);
  const deliveryAddressText = formatAddrForm(deliveryAddr);
  const contactName = contacts.find((c) => String(c.id) === contactId)?.name;
  const readonlyCls = `${inputCls} bg-surface-2 text-secondary`;
  const showGstCalc = slabN !== null && totalN !== undefined;
  const allocLocked = isEdit && hadExistingAlloc;

  const renderStep = (key: string) => {
    if (key === "header") {
      return (
        <div className={gridCls}>
          <WizardField label="Customer" required icon="building" filled={!!customerId}>
            <select
              className={inputCls}
              value={customerId}
              onChange={(e) => {
                const v = e.target.value;
                setCustomerId(v);
                // Editable on EDIT too (user request, 26 Aug 2026) — a wrong
                // pick must be fixable. Everything customer-scoped resets;
                // the server refuses the save if invoices/allocations exist.
                if (isEdit) {
                  setBillingId(""); setDeliveryId(""); setContactId("");
                  setBillingAddr(emptyAddr()); setDeliveryAddr(emptyAddr());
                  setAllocProjectId(""); setAllocAmount("");
                  setBranches([]); setContacts([]);
                  if (v) {
                    crmGet<any[]>(`/api/customers/${v}/branches`).then((r) => setBranches(r.data || [])).catch(() => {});
                    crmGet<any[]>(`/api/customers/${v}/contacts`).then((r) => setContacts(r.data || [])).catch(() => {});
                  }
                }
              }}
            >
              <option value="">Select customer…</option>
              {Object.entries(customers).map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </WizardField>
          <WizardField label="PO No" required icon="hash" filled={!!poNumber.trim() && !poNumberTaken}
            error={poNumberTaken || undefined}>
            <input
              className={inputCls}
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
              placeholder="e.g. PO-2026-001"
            />
          </WizardField>
          <WizardField label="Employee" icon="user" filled={!!employeeId}>
            <SearchableSelect
              value={employeeId}
              options={employees}
              searchable
              placeholder="Search employee…"
              onChange={setEmployeeId}
            />
          </WizardField>
          <WizardField label="PO Date" icon="calendar" filled={!!receivedDate}>
            <input type="date" className={inputCls} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
          </WizardField>
          <WizardField label="PO Start Date" icon="calendar" filled={!!startDate}>
            <input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </WizardField>
          <WizardField
            label="PO End Date"
            icon="calendar"
            filled={!!endDate}
            error={startDate && endDate && endDate < startDate ? "Must be on or after PO Start Date" : undefined}
          >
            <input
              type="date"
              className={inputCls}
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </WizardField>
          {/* Contact person removed from the header (26 Aug 2026, user decision):
              a contact only means something once a project is chosen, so the
              field now lives on the Allocate step / Allocate modal. Legacy POs
              keep their stored header contact untouched. */}
        </div>
      );
    }
    if (key === "address") {
      return (
        <div className={gridCls}>
          <div className="space-y-3">
            <WizardField label="Billing branch" icon="map" filled={!!billingId}>
              <select
                className={inputCls}
                value={billingId}
                onChange={(e) => selectBillingBranch(e.target.value)}
                disabled={!customerId}
              >
                <option value="">—</option>
                {branchOptions}
              </select>
            </WizardField>
            {billingId ? (
              <PoAddressFields
                title="Billing Address"
                addr={billingAddr}
                onChange={setBillingAddr}
              />
            ) : (
              <p className="text-xs text-muted">Select a billing branch to load and edit its address.</p>
            )}
          </div>
          <div className="space-y-3">
            <WizardField label="Delivery branch" icon="map" filled={!!deliveryId}>
              <select
                className={inputCls}
                value={deliveryId}
                onChange={(e) => selectDeliveryBranch(e.target.value)}
                disabled={!customerId}
              >
                <option value="">—</option>
                {branchOptions}
              </select>
            </WizardField>
            {deliveryId ? (
              <PoAddressFields
                title="Delivery Address"
                addr={deliveryAddr}
                onChange={setDeliveryAddr}
              />
            ) : (
              <p className="text-xs text-muted">Select a delivery branch to load and edit its address.</p>
            )}
          </div>
        </div>
      );
    }
    if (key === "allocate") {
      const canPickProject = !!(customerId && billingId) && !allocLocked;
      const projectName = projects.find((p) => String(p.id) === allocProjectId)?.name;
      return (
        <div className={gridCls}>
          <WizardField label="Project" icon="building" filled={!!allocProjectId}>
            <select
              className={inputCls}
              value={allocProjectId}
              disabled={!canPickProject}
              onChange={(e) => {
                const id = e.target.value;
                setAllocProjectId(id);
                if (!id) setAllocAmount("");
                else if (allocAmount === "" || allocAmount === totalValue) setAllocAmount(totalValue);
              }}
            >
              <option value="">
                {allocLocked
                  ? (projectName || `Project #${allocProjectId}`)
                  : !customerId
                    ? "Select a customer first…"
                    : !billingId
                      ? "Select a billing branch first…"
                      : projects.length === 0
                        ? "No projects for this customer/branch"
                        : "Select project…"}
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              {allocLocked && allocProjectId && !projects.some((p) => String(p.id) === allocProjectId) && (
                <option value={allocProjectId}>{projectName || `Project #${allocProjectId}`}</option>
              )}
            </select>
          </WizardField>
          <WizardField label="Allocated amount (₹)" icon="hash" filled={!!allocAmount && !!allocProjectId}>
            <input
              type="number"
              min={0}
              step="0.01"
              className={inputCls}
              value={allocAmount}
              disabled={!allocProjectId || allocLocked}
              placeholder={allocProjectId ? "Defaults to full PO value" : "Select a project first"}
              onChange={(e) => setAllocAmount(e.target.value)}
            />
          </WizardField>
          {/* Contact person moved HERE from the PO header (26 Aug 2026): it is
              recorded on the allocation, where it actually means something. */}
          <WizardField label="Contact person" icon="user" filled={!!contactId}>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className={`${inputCls} min-w-0 flex-1`}
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                disabled={!allocProjectId || allocLocked}
              >
                <option value="">—</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button
                type="button"
                className={`${btnSecondary} !px-2.5 !py-2 shrink-0`}
                disabled={!customerId}
                title={!customerId ? "Select a customer first" : "Create new contact person"}
                onClick={() => setShowNewContact(true)}
              >
                <Plus size={15} /> New Contact
              </button>
            </div>
          </WizardField>
          {allocProjectId && (
            <p className="sm:col-span-2 text-xs text-muted">
              {allocLocked
                ? <>Existing allocation to <span className="font-semibold text-secondary">{projectName || `#${allocProjectId}`}</span>
                  {allocAmount && num(allocAmount) !== undefined ? ` · ${inr(num(allocAmount)!)}` : ""}. Use Allocate on the PO detail to add more.</>
                : <>
                    Mapping to <span className="font-semibold text-secondary">{projectName}</span>
                    {totalN !== undefined ? ` · PO value ${inr(totalN)}` : ""}
                    {(allocAmount === "" || allocAmount === totalValue) && totalN !== undefined
                      ? " (allocated amount defaults to full PO value)"
                      : ""}
                  </>}
            </p>
          )}
        </div>
      );
    }
    if (key === "commercial") {
      return (
        <div className={gridCls}>
          <WizardField label="PO Type" required icon="hash" filled={!!poType}>
            <select className={inputCls} value={poType} onChange={(e) => setPoType(e.target.value)}>
              <option value="Open PO">Open PO</option>
              <option value="Regular PO">Regular PO</option>
              {(poType === "Standard" || poType === "Blanket") && (
                <option value={poType}>{poType} (legacy)</option>
              )}
            </select>
          </WizardField>
          <WizardField label="PO Value (₹)" required icon="hash" filled={totalN !== undefined && totalN > 0}>
            <input
              type="number"
              min={0}
              step="0.01"
              className={inputCls}
              value={totalValue}
              onChange={(e) => {
                const v = e.target.value;
                if (!allocLocked && (allocAmount === "" || allocAmount === totalValue)) setAllocAmount(v);
                setTotalValue(v);
              }}
            />
          </WizardField>
          <WizardField label="Tax Slab (GST)" icon="hash" filled={!!taxSlabKey}>
            <select className={inputCls} value={taxSlabKey} onChange={(e) => setTaxSlabKey(e.target.value)}>
              <option value="">Select slab…</option>
              {GST_SLAB_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </WizardField>
          <div className="flex items-end pb-1">
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-primary cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-subtle text-accent focus:ring-accent"
                checked={interState}
                onChange={(e) => setInterState(e.target.checked)}
              />
              IGST (inter-state supply)
            </label>
          </div>
          {showGstCalc && (
            <>
              <WizardField label="Sub Value" icon="hash" filled>
                <input className={readonlyCls} readOnly value={fmtAmt2(subValueAmt)} tabIndex={-1} />
              </WizardField>
              <WizardField label="GST Amount" icon="hash" filled>
                <input className={readonlyCls} readOnly value={fmtAmt2(gstAmt)} tabIndex={-1} />
              </WizardField>
              <WizardField label="Total Value" icon="hash" filled>
                <input className={readonlyCls} readOnly value={fmtAmt2(totalWithGstAmt)} tabIndex={-1} />
              </WizardField>
              {interState ? (
                <WizardField label="IGST Amount" icon="hash" filled>
                  <input className={readonlyCls} readOnly value={fmtAmt2(gstAmt)} tabIndex={-1} />
                </WizardField>
              ) : (
                <>
                  <WizardField label="SGST Amount" icon="hash" filled>
                    <input className={readonlyCls} readOnly value={fmtAmt2(sgstAmt)} tabIndex={-1} />
                  </WizardField>
                  <WizardField label="CGST Amount" icon="hash" filled>
                    <input className={readonlyCls} readOnly value={fmtAmt2(cgstAmt)} tabIndex={-1} />
                  </WizardField>
                </>
              )}
            </>
          )}
          <div className="sm:col-span-2">
            <WizardField label="Payment terms">
              <textarea className={inputCls} rows={2} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="e.g. Net 30 from invoice date" />
            </WizardField>
          </div>
        </div>
      );
    }
    // review
    const allocProjectName = projects.find((p) => String(p.id) === allocProjectId)?.name;
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 md:grid-cols-3">
          <InfoItem label="Customer">{customers[Number(customerId)] || "—"}</InfoItem>
          <InfoItem label="PO No">{poNumber.trim() || "—"}</InfoItem>
          <InfoItem label="Employee">{employees.find((e) => e.value === employeeId)?.label || "—"}</InfoItem>
          <InfoItem label="PO Date">{receivedDate ? fmtDate(receivedDate) : "—"}</InfoItem>
          <InfoItem label="PO Start Date">{startDate ? fmtDate(startDate) : "—"}</InfoItem>
          <InfoItem label="PO End Date">{endDate ? fmtDate(endDate) : "—"}</InfoItem>
          <InfoItem label="PO type">{poType}</InfoItem>
          <InfoItem label="Contact person">{contactName || "—"}</InfoItem>
          <InfoItem label="Billing branch">
            <span className="block">{billingBranchName || "—"}</span>
            {billingAddressText ? <span className="mt-0.5 block text-xs font-normal text-muted">{billingAddressText}</span> : null}
          </InfoItem>
          <InfoItem label="Delivery branch">
            <span className="block">{deliveryBranchName || "—"}</span>
            {deliveryAddressText ? <span className="mt-0.5 block text-xs font-normal text-muted">{deliveryAddressText}</span> : null}
          </InfoItem>
          <InfoItem label="Allocated project">
            {allocProjectId
              ? `${allocProjectName || `#${allocProjectId}`} · ${
                  allocAmount && num(allocAmount) !== undefined ? inr(num(allocAmount)!) : "full PO value"
                }`
              : "—"}
          </InfoItem>
          <InfoItem label="PO Value" numeric>{totalN !== undefined ? inr(totalN) : "—"}</InfoItem>
          <InfoItem label="Tax slab">{taxSlabKey ? (GST_SLAB_OPTIONS.find((o) => o.value === taxSlabKey)?.label || `GST ${taxSlabKey}%`) : "—"}</InfoItem>
          <InfoItem label="IGST">{interState ? "Yes" : "No"}</InfoItem>
          <InfoItem label="Sub Value" numeric>{showGstCalc ? inr(subValueAmt) : "—"}</InfoItem>
          <InfoItem label="GST Amount" numeric>{showGstCalc ? inr(gstAmt) : "—"}</InfoItem>
          <InfoItem label="Total Value" numeric>{showGstCalc ? inr(totalWithGstAmt) : "—"}</InfoItem>
          <InfoItem label="GST split">
            {!showGstCalc
              ? "—"
              : interState
                ? `IGST ${fmtAmt2(gstAmt)}`
                : `SGST ${fmtAmt2(sgstAmt)} + CGST ${fmtAmt2(cgstAmt)}`}
          </InfoItem>
        </div>
        {paymentTerms.trim() && (
          <InfoItem label="Payment terms">{paymentTerms}</InfoItem>
        )}
      </div>
    );
  };

  const currentStep = poSteps[stepIndex];
  return (
    <WizardShell
      onClose={onClose}
      contentRef={bodyRef}
      steps={wizardSteps}
      currentIndex={stepIndex}
      maxReached={maxReached}
      onSelectStep={goToStep}
      ariaLabel="Purchase order wizard steps"
      topBar={
        <WizardTopBar
          title={isEdit ? "Edit Purchase Order" : "New Purchase Order"}
          stepIndex={stepIndex}
          totalSteps={totalSteps}
          stepPct={stepPct}
        />
      }
      footer={
        <WizardFooter
          stepIndex={stepIndex}
          totalSteps={totalSteps}
          isFirstStep={isFirstStep}
          isLastStep={isLastStep}
          busy={busy}
          onPrev={goPrev}
          onNext={goNext}
          onSubmit={() => void submit()}
          submitLabel={isEdit ? "Save changes" : "Create PO"}
          submitBusyLabel={isEdit ? "Saving…" : "Creating…"}
        />
      }
    >
      <WizardStepCard stepKey={currentStep.key} stepDir={stepDir}>
        <SectionHeaderBanner title={currentStep.title} description={currentStep.subtitle} icon={currentStep.icon} />
        {err && <div className="mb-4 text-sm text-danger" role="alert">{err}</div>}
        {renderStep(currentStep.key)}
      </WizardStepCard>
      {showNewContact && customerId && (
        <ContactPersonFormModal
          customerId={Number(customerId)}
          customerName={customers[Number(customerId)]}
          branches={branches}
          requireBranch
          lockCustomer
          onClose={() => setShowNewContact(false)}
          notify={notify}
          onSaved={(contact) => {
            setContacts((prev) => {
              if (prev.some((c) => c.id === contact.id)) {
                return prev.map((c) => (c.id === contact.id ? contact : c));
              }
              return [...prev, contact];
            });
            if (contact.id) setContactId(String(contact.id));
            setShowNewContact(false);
          }}
        />
      )}
    </WizardShell>
  );
}

/* =====================================================================
 * PURCHASE ORDER — detail
 * =================================================================== */

export function PODetailPage() {
  const { id } = useCrmParams();
  /* Both hooks must run unconditionally (rules-of-hooks) — combine after. */
  const canWriteRole = useHasRole("Finance");
  const canWrite = useCanAct("pos", "edit", canWriteRole);
  const [po, setPo] = useState<any | null>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [showAllocate, setShowAllocate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [showRenew, setShowRenew] = useState(false);
  const [toast, showToast] = useToast();
  const customers = useNameMap("/api/customers/names");

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
    crmGet<any[]>(`/api/purchase-orders/${id}/invoices`)
      .then((r) => setInvoices(r.data || [])).catch(() => {});
  };
  useEffect(load, [id]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!po) return <Spinner label="Loading purchase order…" />;

  const total = Number(po.total_value || 0);
  const consumed = Number(po.consumed_value || 0);
  const pct = total > 0 ? Math.min(100, Math.round((consumed / total) * 100)) : 0;
  const commercial = po.commercial || null;
  const formatSnap = (snap: any): string => {
    if (!snap || typeof snap !== "object") return "";
    return [
      snap.address_line_1, snap.address_line_2,
      [snap.city, snap.state].filter(Boolean).join(", "),
      snap.pincode, snap.country,
    ].map((p) => String(p || "").trim()).filter(Boolean).join(" · ");
  };
  const billingSnapText = formatSnap(po.billing_address);
  const deliverySnapText = formatSnap(po.delivery_address);

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
    // Recorded at allocation time (26 Aug 2026) — replaced the PO-header field.
    { key: "contact_person_name", label: "Contact person", render: (r) => r.contact_person_name || "—" },
    { key: "hsn_sac", label: "HSN/SAC", render: (r) => r.hsn_sac || "—" },
  ];

  const invCols: Column<any>[] = [
    { key: "invoice_number", label: "Invoice #", render: (r) => <span className="font-semibold">{r.invoice_number}</span> },
    { key: "project_title", label: "Project", render: (r) => r.project_title || "—" },
    { key: "timesheet_period", label: "Period", render: (r) => r.timesheet_period || "—" },
    { key: "invoice_date", label: "Date", render: (r) => fmtDate(r.invoice_date) },
    { key: "grand_total", label: "Grand Total", render: (r) => inr(r.grand_total) },
    { key: "paid_amount", label: "Paid", render: (r) => inr(r.paid_amount) },
    { key: "balance_amount", label: "Balance", render: (r) => inr(r.balance_amount ?? r.bank_receivables) },
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
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && po.status !== "Cancelled" && (
            <button className={btnSecondary} onClick={() => setShowEdit(true)}>
              <Pencil size={15} /> Edit
            </button>
          )}
          {canWrite && po.status !== "Cancelled" && (
            <button className={btnSecondary} onClick={() => setShowRenew(true)}>
              <RefreshCw size={15} /> Renew PO
            </button>
          )}
          {canWrite && po.status === "Active" && (
            <button className={btnDanger} onClick={() => setShowCancel(true)}>
              <Ban size={15} /> Cancel PO
            </button>
          )}
        </div>
      </div>

      {/* The renewal chain, stated on both ends. Finance used to track "which
          PO replaced which" outside the system entirely. */}
      {(po.renewed_from || (po.renewals || []).length > 0) && (
        <div className="rounded-card border border-subtle bg-surface-1 px-4 py-3 text-xs shadow-raised">
          {po.renewed_from && (
            <div className="text-secondary">
              Renews{" "}
              <CrmLink to={`pos/${po.renewed_from.id}`} className="font-semibold text-sky-600 hover:underline">
                {po.renewed_from.po_number}
              </CrmLink>
              {po.renewed_from.end_date ? ` (ended ${fmtDate(po.renewed_from.end_date)})` : ""}
            </div>
          )}
          {(po.renewals || []).map((r: any) => (
            <div key={r.id} className="text-secondary">
              Renewed by{" "}
              <CrmLink to={`pos/${r.id}`} className="font-semibold text-sky-600 hover:underline">
                {r.po_number}
              </CrmLink>
              {r.start_date ? ` (from ${fmtDate(r.start_date)})` : ""}
            </div>
          ))}
        </div>
      )}

      <Card title="PO Details" hero>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          <InfoItem label="Customer">{customerName || `#${po.customer_id}`}</InfoItem>
          <InfoItem label="Type">{po.po_type || "—"}</InfoItem>
          <InfoItem label="PO Date">{fmtDate(po.received_date)}</InfoItem>
          <InfoItem label="PO Start Date">{fmtDate(po.start_date)}</InfoItem>
          <InfoItem label="PO End Date">{fmtDate(po.end_date)}</InfoItem>
          <InfoItem label="Tax slab">{po.tax_slab != null ? `${po.tax_slab}%` : "—"}</InfoItem>
          <InfoItem label="Total value" numeric>{inr(po.total_value)}</InfoItem>
          <InfoItem label="Consumed" numeric>{inr(po.consumed_value)}</InfoItem>
          <InfoItem label="Balance" numeric>{inr(po.balance_value)}</InfoItem>
          <InfoItem label="Invoices" numeric>{po.invoice_count ?? invoices.length}</InfoItem>
          <InfoItem label="Contact">{po.contact?.name || "—"}</InfoItem>
          <InfoItem label="Billing branch">
            <span className="block">{po.billing_branch?.branch_name || "—"}</span>
            {billingSnapText ? <span className="mt-0.5 block text-xs font-normal text-muted">{billingSnapText}</span> : null}
          </InfoItem>
          <InfoItem label="Delivery branch">
            <span className="block">{po.delivery_branch?.branch_name || "—"}</span>
            {deliverySnapText ? <span className="mt-0.5 block text-xs font-normal text-muted">{deliverySnapText}</span> : null}
          </InfoItem>
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

      {commercial && (
        <Card title="Commercial">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
            <InfoItem label="PO value" numeric>{inr(commercial.po_value)}</InfoItem>
            <InfoItem label="Tax slab">{commercial.tax_slab != null ? `${commercial.tax_slab}%` : "—"}</InfoItem>
            <InfoItem label="Sub total" numeric>{inr(commercial.sub_total)}</InfoItem>
            <InfoItem label="Tax" numeric>{inr(commercial.tax_amount)}</InfoItem>
            <InfoItem label="Grand total" numeric>{inr(commercial.grand_total)}</InfoItem>
            {Number(commercial.igst_amount || 0) > 0 ? (
              <InfoItem label="IGST" numeric>{inr(commercial.igst_amount)}</InfoItem>
            ) : (
              <>
                <InfoItem label="SGST" numeric>{inr(commercial.sgst_amount)}</InfoItem>
                <InfoItem label="CGST" numeric>{inr(commercial.cgst_amount)}</InfoItem>
              </>
            )}
          </div>
        </Card>
      )}

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
          customerName={customers[po.customer_id]}
          onClose={() => setShowAllocate(false)}
          onSaved={() => { setShowAllocate(false); showToast("Project allocation saved"); load(); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
      {showEdit && (
        <POFormModal
          customers={{ ...customers, ...(po.customer_id ? { [po.customer_id]: customerName || customers[po.customer_id] || `#${po.customer_id}` } : {}) }}
          editPoId={po.id}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); showToast("Purchase order updated"); load(); }}
          onError={(m) => showToast(m, "err")}
          notify={showToast}
        />
      )}
      {showRenew && (
        <RenewPoModal
          po={po}
          customerName={customerName}
          onClose={() => setShowRenew(false)}
          onRenewed={(newId, message) => {
            setShowRenew(false);
            showToast(message);
            crmNavigate(`pos/${newId}`);
          }}
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
  customerName,
  onClose,
  onSaved,
  onError,
}: {
  po: any;
  customerName?: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  // Contact captured at allocation time (26 Aug 2026) — the customer's contacts.
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactId, setContactId] = useState("");
  /** Detail row (26 Aug 2026): the LIST row has no allocations, so opening
   * from the list showed "already allocated ₹0" even on a part-allocated PO
   * and could prefill more than remains. The detail is authoritative. */
  const [detail, setDetail] = useState<any | null>(null);
  const eff = detail || po;

  useEffect(() => {
    // Only THIS customer's projects (26 Aug 2026): a HARMAN PO must not offer
    // Magna Steyr projects — an allocation across customers is always a mistake.
    crmGet<any[]>(`/api/projects${qs({ customer_id: po?.customer_id || undefined, limit: 100 })}`)
      .then((r) => setProjects(r.data || []))
      .catch(() => {});
    if (po?.customer_id) {
      crmGet<any[]>(`/api/customers/${po.customer_id}/contacts`)
        .then((r) => setContacts(r.data || []))
        .catch(() => { /* select degrades to empty — allocation still saves */ });
    }
    crmGet<any>(`/api/purchase-orders/${po.id}`)
      .then((r) => setDetail(r.data))
      .catch(() => setDetail(null));
  }, [po?.customer_id, po?.id]);

  const allocatedSum = (eff.allocations || []).reduce((s: number, a: any) => s + Number(a.allocated_amount || 0), 0);
  const remaining = Number(eff.total_value || 0) - allocatedSum;

  // Auto-fill (user decision, 26 Aug 2026): the amount defaults to the PO's
  // unallocated value — most allocations are the whole PO. Editable after.
  const prefilledRef = React.useRef(false);
  useEffect(() => {
    if (detail === null || prefilledRef.current) return;
    prefilledRef.current = true;
    if (remaining > 0) setAmount(String(remaining));
  }, [detail, remaining]);
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
        contact_person_id: contactId ? Number(contactId) : null,
      });
      onSaved();
    } catch (e: any) {
      const msg = e?.message || "Failed to allocate";
      setServerError(msg);
      onError(msg);
      setBusy(false);
    }
  };

  return (
    <FinanceModalShell
      title="Allocate to Project"
      subtitle="Distribute this purchase order value across a delivery project."
      icon={<Layers size={20} aria-hidden />}
      onClose={onClose}
      busy={busy}
      error={serverError}
      onSubmit={() => void submit()}
      submitLabel="Allocate"
      submitBusyLabel="Saving…"
      submitDisabled={busy || !projectId || !!amountErr || amount === ""}
    >
      {/* The PO's key facts, right where the decision is made (user request,
          26 Aug 2026): value, customer and the received/start/end dates. */}
      <div className="mb-1 grid grid-cols-2 gap-x-6 gap-y-2 rounded-card border border-subtle bg-surface-2/40 p-3 text-sm sm:grid-cols-3">
        <div><div className="text-[11px] font-bold uppercase text-muted">PO Value</div>
          <div className="font-semibold text-primary">{inr(eff.total_value)}</div></div>
        <div><div className="text-[11px] font-bold uppercase text-muted">Customer</div>
          <div className="font-semibold text-primary">{customerName || "—"}</div></div>
        <div><div className="text-[11px] font-bold uppercase text-muted">PO Date</div>
          <div className="font-semibold text-primary">{eff.received_date ? fmtDate(eff.received_date) : "—"}</div></div>
        <div><div className="text-[11px] font-bold uppercase text-muted">PO Start Date</div>
          <div className="font-semibold text-primary">{eff.start_date ? fmtDate(eff.start_date) : "—"}</div></div>
        <div><div className="text-[11px] font-bold uppercase text-muted">PO End Date</div>
          <div className="font-semibold text-primary">{eff.end_date ? fmtDate(eff.end_date) : "—"}</div></div>
      </div>
      <InfoChip>
        PO total {inr(eff.total_value)} · already allocated {inr(allocatedSum)} · unallocated {inr(remaining)}
      </InfoChip>
      <WizardField label="Project" required icon="building">
        <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">
            {projects.length === 0
              ? `No projects for ${customerName || "this customer"} yet — create one first`
              : "Select project…"}
          </option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </WizardField>
      <WizardField label="Amount (₹)" required icon="hash" error={amountErr || undefined} filled={amtN !== undefined && amtN > 0 && !amountErr}>
        <input type="number" min={0} step="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </WizardField>
      <WizardField label="Contact person" icon="user" filled={!!contactId}>
        <select className={inputCls} value={contactId} onChange={(e) => setContactId(e.target.value)}>
          <option value="">—</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </WizardField>
    </FinanceModalShell>
  );
}

/**
 * Raise the next PO in a series from the one that is expiring.
 *
 * Before this, the expiry notices told Finance a PO was running out and then
 * left them to re-key the same customer, branches, contact, tax slab and
 * payment terms into a blank New PO form. Everything except the number, the
 * value and the dates is inherited here and shown as inherited, so the person
 * renewing can see what is carried rather than having to remember it.
 *
 * The PO number has no default on purpose: it is the customer's reference, so
 * generating one would invent a document that does not exist on their side.
 */
function RenewPoModal({
  po,
  customerName,
  onClose,
  onRenewed,
  onError,
}: {
  po: any;
  customerName: string;
  onClose: () => void;
  onRenewed: (newPoId: number, message: string) => void;
  onError: (msg: string) => void;
}) {
  const dayAfter = (iso?: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  };

  const [poNumber, setPoNumber] = useState("");
  const [totalValue, setTotalValue] = useState("");
  const [startDate, setStartDate] = useState(() => dayAfter(po.end_date));
  const [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");

  const totalN = num(totalValue);
  const totalErr =
    totalValue === "" ? "" : totalN === undefined || totalN <= 0 ? "Enter a positive PO value" : "";
  const dateErr =
    startDate && endDate && endDate < startDate ? "End date is before the start date" : "";
  const unspent = Number(po.balance_value || 0);

  const submit = async () => {
    if (!poNumber.trim() || totalN === undefined || totalN <= 0 || totalErr || dateErr) return;
    setBusy(true);
    try {
      const res = await crmPost<any>(`/api/purchase-orders/${po.id}/renew`, {
        po_number: poNumber.trim(),
        total_value: totalN,
        start_date: startDate || null,
        end_date: endDate || null,
      });
      onRenewed(res.data?.id, res.message || "Renewal purchase order created");
    } catch (e: any) {
      const msg = e?.message || "Failed to renew the purchase order";
      setServerError(msg);
      onError(msg);
      setBusy(false);
    }
  };

  return (
    <FinanceModalShell
      title="Renew Purchase Order"
      subtitle={`Raise the next PO for ${customerName || "this customer"}, carrying forward the terms of ${po.po_number}.`}
      icon={<RefreshCw size={20} aria-hidden />}
      onClose={onClose}
      busy={busy}
      error={serverError}
      onSubmit={() => void submit()}
      submitLabel="Create renewal"
      submitBusyLabel="Creating…"
      submitDisabled={busy || !poNumber.trim() || totalValue === "" || !!totalErr || !!dateErr}
    >
      <InfoChip>
        Carried over: customer, billing and delivery branch, contact, PO type, tax slab and payment
        terms. {po.po_number} is left exactly as it is — its invoices still reconcile against it.
      </InfoChip>
      {unspent > 0 && (
        <InfoChip>
          {po.po_number} has {inr(unspent)} unspent. That balance stays with it and is not added to
          the renewal — enter the new order's own value below.
        </InfoChip>
      )}
      <WizardField label="New PO number" required icon="hash"
        info="As issued by the customer — this is their reference, not ours.">
        <input className={inputCls} value={poNumber} autoFocus
          onChange={(e) => setPoNumber(e.target.value)} placeholder="e.g. 4500123456" />
      </WizardField>
      <WizardField label="PO value (₹)" required icon="hash"
        error={totalErr || undefined} filled={totalN !== undefined && totalN > 0 && !totalErr}>
        <input type="number" min={0} step="0.01" className={inputCls} value={totalValue}
          onChange={(e) => setTotalValue(e.target.value)} />
      </WizardField>
      <WizardField label="Start date" icon="calendar"
        info="Defaults to the day after the current PO ends, so there is no uncovered day between them.">
        <input type="date" className={inputCls} value={startDate}
          onChange={(e) => setStartDate(e.target.value)} />
      </WizardField>
      <WizardField label="End date" icon="calendar" error={dateErr || undefined}>
        <input type="date" className={inputCls} value={endDate}
          onChange={(e) => setEndDate(e.target.value)} />
      </WizardField>
    </FinanceModalShell>
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
  /* Both hooks must run unconditionally (rules-of-hooks) — combine after. */
  const canWriteRole = useHasRole("Finance");
  const canWrite = useCanAct("invoices", "edit", canWriteRole);
  const [tab, setTab] = useState("Unpaid");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);

  // Deep-link create (hub "New …" buttons): ?create=1 opens the dialog once,
  // then strips the flag so refresh / back never reopen it.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("create") === "1") {
      setShowNew(true);
      sp.delete("create");
      window.history.replaceState(null, "", `${window.location.pathname}?${sp.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, showToast] = useToast();
  const projects = useNameMap("/api/projects?limit=100");
  const pos = useNameMap("/api/purchase-orders?limit=100", "po_number");
  const load = useCallback(() => setReloadKey((k) => k + 1), []);
  /* Customer + project filters (25 Aug 2026): server-side — paginated list. */
  const [customerFilter, setCustomerFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const customerNames = useNameMap("/api/customers/names");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = window.setTimeout(() => {
      crmGet<any[]>(`/api/invoices${qs({
        payment_status: tab, search, page, limit: 20,
        customer_id: customerFilter || undefined,
        project_id: projectFilter || undefined,
      })}`)
        .then((r) => { if (alive) { setRows(r.data || []); setMeta(r.meta); setError(""); } })
        .catch((e) => { if (alive) setError(e?.message || "Failed to load invoices"); })
        .finally(() => { if (alive) setLoading(false); });
    }, search ? 300 : 0);
    return () => { alive = false; window.clearTimeout(t); };
  }, [tab, search, page, reloadKey, customerFilter, projectFilter]);
  useEffect(() => { setPage(1); }, [customerFilter, projectFilter]);

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
        <div className="flex flex-wrap gap-2">
          <button className={btnSecondary} onClick={() => crmNavigate("invoices/tax-generator")}>
            <FileText size={15} /> New Tax Invoice
          </button>
          {canWrite && (
            <button className={btnPrimary} onClick={() => setShowNew(true)}>
              <Plus size={15} /> New Invoice
            </button>
          )}
        </div>
      </div>
      <Tabs tabs={INVOICE_TABS} active={tab} onChange={(k) => { setTab(k); setPage(1); }} />
      {error && <ErrorBox error={error} />}
      <DataTable
        columns={columns}
        rows={rows}
        meta={meta}
        headerRight={meta ? <span className="whitespace-nowrap text-xs font-medium text-muted">{meta.total} {meta.total === 1 ? "invoice" : "invoices"}, page {meta.page}/{Math.max(1, meta.pages || 1)}</span> : undefined}
        loading={loading}
        search={search}
        onSearch={(q) => { setSearch(q); setPage(1); }}
        onPage={setPage}
        onRowClick={(r) => crmNavigate(`invoices/${r.id}`)}
        filters={
          <>
            <select className="input-recessed !w-48 rounded-control px-3 py-2 text-sm"
              value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}
              title="Filter by customer">
              <option value="">All customers</option>
              {Object.entries(customerNames).sort((a, b) => a[1].localeCompare(b[1]))
                .map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <select className="input-recessed !w-48 rounded-control px-3 py-2 text-sm"
              value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}
              title="Filter by project">
              <option value="">All projects</option>
              {Object.entries(projects).sort((a, b) => a[1].localeCompare(b[1]))
                .map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </>
        }
        emptyMessage={<TeachingEmpty page="invoices" />}
        rowActions={(r) => (
          <RowActions
            entity="invoice"
            itemLabel={r.invoice_number}
            onView={() => crmNavigate(`invoices/${r.id}`)}
            onEdit={() => crmNavigate(`invoices/${r.id}`)}
            deleteUrl={`/api/invoices/${r.id}`}
            onDeleted={() => afterListDelete(r.id, setRows, load)}
            notify={showToast}
            canEdit={canWrite}
            canDelete={canWrite}
          colored />
        )}
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
  const [stepIndex, setStepIndex] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [stepDir, setStepDir] = useState<1 | -1>(1);
  const bodyRef = React.useRef<HTMLDivElement>(null);

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
      const msg = e?.message || "Failed to create invoice";
      setErr(msg);          // inline — e.g. "invoice exceeds the PO balance"
      onError(msg);
      setBusy(false);
    }
  };

  const invSteps = [
    { key: "details", title: "Invoice Details", subtitle: "Link the project and PO, and set the dates.", icon: <FileText size={20} aria-hidden /> },
    { key: "amounts", title: "Amounts & Review", subtitle: "Enter the sub-total and tax, then review the grand total.", icon: <IndianRupee size={20} aria-hidden /> },
  ];
  const totalSteps = invSteps.length;
  const isFirstStep = stepIndex <= 0;
  const isLastStep = stepIndex >= totalSteps - 1;
  const stepPct = Math.round(((stepIndex + 1) / totalSteps) * 100);
  const subValid = num(subTotal);

  const stepStatus = (key: string): WizardStep["status"] => {
    if (key === "details") return projectId && invoiceDate ? "complete" : (projectId || invoiceDate) ? "partial" : "empty";
    return subValid !== undefined && subValid > 0 ? "complete" : subTotal !== "" ? "error" : "empty";
  };
  const wizardSteps: WizardStep[] = invSteps.map((s) => ({
    key: s.key, title: s.title, sublabel: s.subtitle, status: stepStatus(s.key),
  }));

  const validateStep = (idx: number): boolean => {
    if (idx === 0) {
      if (!projectId) { setErr("Project is required"); return false; }
      if (!invoiceDate) { setErr("Invoice date is required"); return false; }
    }
    return true;
  };
  const goToStep = (i: number) => {
    if (i < 0 || i >= totalSteps || i > maxReached) return;
    setStepDir(i >= stepIndex ? 1 : -1);
    setStepIndex(i);
  };
  const goPrev = () => { if (isFirstStep) return; setStepDir(-1); setStepIndex((i) => Math.max(0, i - 1)); };
  const goNext = () => {
    if (!validateStep(stepIndex)) return;
    setErr("");
    if (isLastStep) return;
    const n = stepIndex + 1;
    setStepDir(1); setStepIndex(n); setMaxReached((m) => Math.max(m, n));
  };

  useEffect(() => {
    const t = window.setTimeout(() => {
      const el = bodyRef.current?.querySelector<HTMLElement>(
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
      );
      el?.focus?.();
    }, 220);
    return () => window.clearTimeout(t);
  }, [stepIndex]);

  const gridCls = "grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2";

  const renderStep = (key: string) => {
    if (key === "details") {
      return (
        <div className={gridCls}>
          <WizardField label="Project" required icon="building" filled={!!projectId}>
            <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Select project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </WizardField>
          <WizardField label="Purchase order (active)" icon="hash" filled={!!poId}>
            <select className={inputCls} value={poId} onChange={(e) => setPoId(e.target.value)}>
              <option value="">— No PO —</option>
              {pos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.po_number} (balance {inr(p.balance_value)})
                </option>
              ))}
            </select>
          </WizardField>
          <WizardField label="Invoice date" required icon="calendar" filled={!!invoiceDate}>
            <input type="date" className={inputCls} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </WizardField>
          <WizardField label="Due date" icon="calendar" filled={!!dueDate}>
            <input type="date" className={inputCls} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </WizardField>
        </div>
      );
    }
    // amounts & review
    return (
      <div className="space-y-6">
        <div className={gridCls}>
          <WizardField label="Sub-total (₹)" required icon="hash" filled={subValid !== undefined && subValid > 0}>
            <input type="number" min={0} step="0.01" className={inputCls} value={subTotal} onChange={(e) => setSubTotal(e.target.value)} />
          </WizardField>
          <WizardField
            label="Tax amount (₹) — override"
            icon="hash"
            filled={taxAmount !== ""}
            info={
              <span className="mt-1 block text-xs text-muted">
                Computed from the PO tax slab when left blank{selectedPo?.tax_slab != null ? ` (${selectedPo.tax_slab}%)` : ""}.
              </span>
            }
          >
            <input type="number" min={0} step="0.01" className={inputCls} value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} placeholder="Leave blank to auto-compute" />
          </WizardField>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-subtle bg-surface-2 px-3 py-2.5">
          <IndianRupee size={15} className="text-muted" />
          <span className="text-sm text-secondary">
            Preview — Sub-total {inr(subN)} + Tax {inr(previewTax)} =
          </span>
          <span className="text-sm font-bold text-primary">Grand total {inr(previewGrand)}</span>
        </div>
      </div>
    );
  };

  const currentStep = invSteps[stepIndex];
  return (
    <WizardShell
      onClose={onClose}
      contentRef={bodyRef}
      steps={wizardSteps}
      currentIndex={stepIndex}
      maxReached={maxReached}
      onSelectStep={goToStep}
      ariaLabel="Invoice wizard steps"
      topBar={
        <WizardTopBar
          title="New Invoice"
          stepIndex={stepIndex}
          totalSteps={totalSteps}
          stepPct={stepPct}
        />
      }
      footer={
        <WizardFooter
          stepIndex={stepIndex}
          totalSteps={totalSteps}
          isFirstStep={isFirstStep}
          isLastStep={isLastStep}
          busy={busy}
          onPrev={goPrev}
          onNext={goNext}
          onSubmit={() => void submit()}
          submitLabel="Create Invoice"
          submitBusyLabel="Creating…"
        />
      }
    >
      <WizardStepCard stepKey={currentStep.key} stepDir={stepDir}>
        <SectionHeaderBanner title={currentStep.title} description={currentStep.subtitle} icon={currentStep.icon} />
        {err && <div className="mb-4 text-sm text-danger" role="alert">{err}</div>}
        {renderStep(currentStep.key)}
      </WizardStepCard>
    </WizardShell>
  );
}

/* =====================================================================
 * INVOICE — detail
 * =================================================================== */

export function InvoiceDetailPage() {
  const { id } = useCrmParams();
  /* Both hooks must run unconditionally (rules-of-hooks) — combine after. */
  const canWriteRole = useHasRole("Finance");
  const canWrite = useCanAct("invoices", "edit", canWriteRole);
  const [inv, setInv] = useState<any | null>(null);
  const [error, setError] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [taxPdfBusy, setTaxPdfBusy] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showTds, setShowTds] = useState(false);
  const [toast, showToast] = useToast();

  const load = () => {
    crmGet<any>(`/api/invoices/${id}`)
      .then((r) => {
        setInv(r.data);
        setError("");
      })
      .catch((e) => setError(e?.message || "Failed to load invoice"));
  };
  useEffect(load, [id]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!inv) return <Spinner label="Loading invoice…" />;

  const tds = inv.tds_record;
  const gst = inv.gst;
  const displayTax = gst != null ? Number(gst.total_gst) : Number(inv.tax_amount);
  const displayGrand = gst != null ? Number(gst.grand_total) : Number(inv.grand_total);
  const paid = Number(inv.paid_amount || 0);
  // Balance vs the same grand total shown in the header / GST banner.
  const displayBalance = Math.max(0, displayGrand - paid);
  const paymentBalance = Number(inv.balance_amount || 0);

  // Auto-resolved buyer state for display. Prefer explicit API fields; fall back to
  // buyer party / GST split so the label never stays blank when CGST/SGST already show.
  const resolvedCode = String(
    gst?.buyer_state_code
    || inv.resolved_state_code
    || inv.buyer_state_code
    || inv.buyer?.state_code
    || "",
  ).trim();
  const stateSource = String(
    gst?.buyer_state_source
    || inv.resolved_state_source
    || (inv.buyer_state_code ? "override" : "")
    || (resolvedCode ? "branch" : ""),
  ).trim();
  let stateLabel = !resolvedCode
    ? "— (set branch GSTIN / state)"
    : stateSource === "override"
      ? `${resolvedCode} · invoice override`
      : `${resolvedCode} · from branch`;
  if (!resolvedCode && gst && Number(gst.total_gst) > 0) {
    // Engine already taxed this invoice — infer label from the split.
    if (gst.intra || (Number(gst.cgst) > 0 && Number(gst.sgst) > 0)) {
      stateLabel = "27 · from branch (Maharashtra)";
    } else if (Number(gst.igst) > 0) {
      stateLabel = "Inter-state · from branch";
    }
  }
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

  const downloadTaxInvoicePdf = async () => {
    setTaxPdfBusy(true);
    try {
      const res = await authFetch(`/api/invoices/${id}/tax-invoice.pdf`);
      if (!res.ok) throw new Error(`Tax Invoice PDF failed (${res.status})`);
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = /filename="?([^"]+)"?/i.exec(cd);
      const name = m?.[1] || `TaxInvoice_${inv.invoice_number || id}.pdf`;
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      a.click();
      URL.revokeObjectURL(href);
      showToast("Tax Invoice PDF downloaded");
    } catch (e: any) {
      showToast(e?.message || "Failed to download Tax Invoice PDF", "err");
    } finally {
      setTaxPdfBusy(false);
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
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            className={btnPrimary}
            disabled={taxPdfBusy}
            onClick={() => void downloadTaxInvoicePdf()}
          >
            <FileDown size={15} /> {taxPdfBusy ? "Preparing…" : "Tax Invoice (PDF)"}
          </button>
          <CrmLink
            to={`invoices/${inv.id}/tax-invoice`}
            className={btnSecondary}
          >
            <FileText size={15} /> View Tax Invoice
          </CrmLink>
        </div>
      </div>

      <Card
        title="Invoice"
        hero
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          <InfoItem label="Project">
            {inv.project_id ? <CrmLink to={`projects/${inv.project_id}`} className="text-sky-600 hover:underline">{inv.project_name || `#${inv.project_id}`}</CrmLink> : "—"}
          </InfoItem>
          <InfoItem label="Purchase order">
            {inv.po_id ? <CrmLink to={`pos/${inv.po_id}`} className="text-sky-600 hover:underline">{inv.po_number || `#${inv.po_id}`}</CrmLink> : "—"}
          </InfoItem>
          <InfoItem label="Invoice date">{fmtDate(inv.invoice_date)}</InfoItem>
          <InfoItem label="Due date">{fmtDate(inv.due_date)}</InfoItem>
          <InfoItem label="Sub-total" numeric>{inr(gst != null ? (gst.subtotal ?? gst.sub_total) : inv.sub_total)}</InfoItem>
          <InfoItem label="Tax" numeric>{formatGstInr(displayTax)}</InfoItem>
          <InfoItem label="State code">{stateLabel}</InfoItem>
          <InfoItem label="Grand total" numeric><span className="font-bold">{formatGstInr(displayGrand)}</span></InfoItem>
          <InfoItem label="Paid / Balance" numeric>{inr(paid)} / <span className="font-semibold">{formatGstInr(displayBalance)}</span></InfoItem>
        </div>
        {gst && (
          <div className="mt-4 border-t border-subtle pt-4">
            <InvoiceGstSection gst={gst} />
          </div>
        )}
        {canWrite && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-subtle pt-4">
            <button className={btnSecondary} onClick={generatePdf} disabled={pdfBusy}>
              <FileDown size={15} /> {pdfBusy ? "Generating…" : "Generate PDF"}
            </button>
            <button className={btnPrimary} onClick={() => setShowPayment(true)} disabled={paymentBalance <= 0}>
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
            <InfoItem label="TDS amount" numeric>{inr(tds.tds_amount)}</InfoItem>
            <InfoItem label="TDS paid" numeric>{inr(tds.tds_paid)}</InfoItem>
            <InfoItem label="TDS balance" numeric>{inr(tds.tds_balance)}</InfoItem>
            <InfoItem label="Status"><StatusBadge status={tds.tds_status} /></InfoItem>
          </div>
        </Card>
      )}

      {showPayment && (
        <RecordPaymentModal
          invoice={{ ...inv, grand_total: displayGrand, balance_amount: paymentBalance }}
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

/** Compact, single-screen finance dialog re-skinned to the shared wizard look
 * (theme-aware body + SectionHeaderBanner + wizard-style footer, NO stepper). */
function FinanceModalShell({
  title,
  subtitle,
  icon,
  onClose,
  onSubmit,
  submitLabel,
  submitBusyLabel,
  submitDisabled,
  busy,
  error,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  submitBusyLabel: string;
  submitDisabled?: boolean;
  busy?: boolean;
  /** The server's reason the last submit failed — shown inside the dialog. */
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <Modal
      title={<span className="sr-only">{title}</span>}
      onClose={onClose}
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <div className="rounded-b-modal px-5 py-5">
        <SectionHeaderBanner title={title} description={subtitle} icon={icon} />
        <div className="space-y-5">{children}</div>
        <ActionError error={error} className="mt-4" />
        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            className="btn-depth inline-flex h-10 items-center gap-1.5 rounded-xl border border-[color:var(--wiz-border)] bg-transparent px-3.5 text-sm font-semibold text-[color:var(--wiz-text)] disabled:opacity-50"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${btnPrimary} btn-gradient ml-auto h-10 rounded-xl px-4`}
            onClick={onSubmit}
            disabled={submitDisabled}
          >
            {busy ? submitBusyLabel : submitLabel}
          </button>
        </div>
      </div>
    </Modal>
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
  const [serverError, setServerError] = useState("");

  const balance = Number(invoice.balance_amount || 0);
  const grand = Number(invoice.grand_total || 0);
  const amtN = num(amount);
  const amountErr =
    amount === "" ? "" :
    amtN === undefined || amtN <= 0 ? "Amount must be a positive number" :
    amtN > balance ? `Cannot exceed the balance (${formatGstInr(balance)})` : "";

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
      const msg = e?.message || "Failed to record payment";
      setServerError(msg);
      onError(msg);
      setBusy(false);
    }
  };

  return (
    <FinanceModalShell
      title="Record Payment"
      subtitle={`Grand total ${formatGstInr(grand)}. Outstanding balance ${formatGstInr(balance)}. Log a receipt against this invoice.`}
      icon={<IndianRupee size={20} aria-hidden />}
      onClose={onClose}
      error={serverError}
      busy={busy}
      onSubmit={() => void submit()}
      submitLabel="Record Payment"
      submitBusyLabel="Saving…"
      submitDisabled={busy || amount === "" || !!amountErr || !paymentDate}
    >
      <WizardField label="Payment date" required icon="calendar" filled={!!paymentDate}>
        <input type="date" className={inputCls} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
      </WizardField>
      <WizardField label="Amount (₹)" required icon="hash" error={amountErr || undefined} filled={amtN !== undefined && amtN > 0 && !amountErr}>
        <input type="number" min={0} step="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </WizardField>
      <WizardField label="Payment mode" icon="hash" filled={!!mode}>
        <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value)}>
          <option>Cash</option>
          <option>Bank Transfer</option>
          <option>Cheque</option>
          <option>UPI</option>
        </select>
      </WizardField>
      <WizardField label="Reference number" icon="hash" filled={!!reference}>
        <input className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
      </WizardField>
      <WizardField label="Notes">
        <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </WizardField>
    </FinanceModalShell>
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
  const [serverError, setServerError] = useState("");
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
      const msg = e?.message || "Failed to record TDS";
      setServerError(msg);
      onError(msg);
      setBusy(false);
    }
  };

  return (
    <FinanceModalShell
      title="Record TDS"
      subtitle="Record tax deducted at source against this invoice."
      icon={<Receipt size={20} aria-hidden />}
      onClose={onClose}
      busy={busy}
      error={serverError}
      onSubmit={() => void submit()}
      submitLabel="Record TDS"
      submitBusyLabel="Saving…"
      submitDisabled={busy || !!amountErr}
    >
      <WizardField
        label="TDS amount (₹)"
        icon="hash"
        error={amountErr || undefined}
        filled={amtN !== undefined && amtN > 0}
        info={
          <span className="mt-1 block text-xs text-muted">
            Defaults to the configured TDS rate on the invoice sub-total when left blank.
          </span>
        }
      >
        <input type="number" min={0} step="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Leave blank for default" />
      </WizardField>
    </FinanceModalShell>
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
  const [serverError, setServerError] = useState("");
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
      const msg = e?.message || "Failed to record TDS payment";
      setServerError(msg);
      onError(msg);
      setBusy(false);
    }
  };

  return (
    <FinanceModalShell
      title="TDS Payment"
      subtitle={`TDS balance ${inr(balance)}. Record a payment against the deducted tax.`}
      icon={<IndianRupee size={20} aria-hidden />}
      onClose={onClose}
      busy={busy}
      error={serverError}
      onSubmit={() => void submit()}
      submitLabel="Record TDS Payment"
      submitBusyLabel="Saving…"
      submitDisabled={busy || amount === "" || !!amountErr}
    >
      <WizardField label="Amount (₹)" required icon="hash" error={amountErr || undefined} filled={amtN !== undefined && amtN > 0 && !amountErr}>
        <input type="number" min={0} step="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </WizardField>
    </FinanceModalShell>
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
  /* Both hooks must run unconditionally (rules-of-hooks) — combine after. */
  const canWriteRole = useHasRole("Finance");
  const canWrite = useCanAct("invoices", "edit", canWriteRole);
  const [tab, setTab] = useState("Pending");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, showToast] = useToast();
  const load = useCallback(() => setReloadKey((k) => k + 1), []);

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
  }, [tab, search, page, reloadKey]);

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
      {toast}
      <h1 className="text-display text-lg font-bold text-primary">TDS Register</h1>
      <Tabs tabs={TDS_TABS} active={tab} onChange={(k) => { setTab(k); setPage(1); }} />
      {error && <ErrorBox error={error} />}
      <DataTable
        columns={columns}
        rows={rows}
        meta={meta}
        headerRight={meta ? <span className="whitespace-nowrap text-xs font-medium text-muted">{meta.total} {meta.total === 1 ? "record" : "records"}, page {meta.page}/{Math.max(1, meta.pages || 1)}</span> : undefined}
        loading={loading}
        search={search}
        onSearch={(q) => { setSearch(q); setPage(1); }}
        onPage={setPage}
        onRowClick={(r) => crmNavigate(`invoices/${r.invoice_id}`)}
        emptyMessage={`No ${tab.replace(/_/g, " ").toLowerCase()} TDS records`}
        rowActions={canWrite ? (r) => (
          <RowActions
            entity="TDS record"
            itemLabel={r.invoice_number || `Invoice #${r.invoice_id}`}
            deleteUrl={`/api/tds/${r.id}`}
            onDeleted={() => afterListDelete(r.id, setRows, load)}
            notify={showToast}
            canEdit={false}
            canDelete
          colored />
        ) : undefined}
      />
    </div>
  );
}
