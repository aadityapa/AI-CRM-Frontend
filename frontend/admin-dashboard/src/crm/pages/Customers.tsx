/** Customers module — list page + detail page with Branches (incl. per-branch
 * billing policy) / Default Billing Policy / Contacts / Documents tabs.
 * Branch management (formerly the standalone Customer Branches page) lives in
 * the Branches tab. Writes restricted to Sales, Sales_Head, Admin. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut, qs } from "../api";
import type { Meta } from "../api";
import { CrmLink, crmNavigate, useCrmParams } from "../routerHooks";
import { useHasRole } from "../CrmApp";
import { useCanEditTab, useCrmAccess } from "../useAccess";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { FileLink, FileUploadButton } from "../components/FileUpload";
import { CustomerFormModal } from "../components/CustomerFormModal";
import { normalizePhoneForSave } from "../lib/phone";
import {
  ConfirmModal, ErrorBox, Field, Modal, Spinner, StatusBadge, Tabs,
  btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";

/* ------------------------------------------------------------------ types */

export type Customer = {
  id: number;
  name: string;
  legal_entity_name?: string | null;
  status: string;
  created_at?: string | null;
  customer_type?: string | null;
};

type Branch = {
  id: number;
  branch_name: string;
  branch_legal_name?: string | null;
  billing_address?: string | null;
  address_line_2?: string | null;
  delivery_address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country?: string | null;
  gstin?: string | null;
  pan?: string | null;
  is_primary: boolean;
  // Branch-level billing policy (null/undefined = inherit customer default).
  weekoff_billable?: boolean | null;
  leave_billable?: boolean | null;
  holidays_billable?: boolean | null;
  hours_required_full_day?: number | null;
  hours_required_half_day?: number | null;
  billing_frequency?: string | null;
  billing_cycle_start_day?: number | null;
  billing_cycle_end_day?: number | null;
};

type Contact = {
  id: number;
  branch_id?: number | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  designation?: string | null;
  is_hiring_manager: boolean;
  is_active: boolean;
};

type CustomerDoc = {
  id: number;
  document_type_id: number;
  document_type_name?: string | null;
  file_url?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
};

type DocType = { id: number; name: string; is_active: boolean };

type Notify = (msg: string, kind?: "ok" | "err") => void;

const CUSTOMER_STATUSES = ["Active", "Inactive"];

/* ---------------------------------------------------------------- helpers */

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString() : "—");

const iconBtn =
  "rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-primary";

/* Re-export for opportunity inline create (+) and other modules. */
export { CustomerFormModal } from "../components/CustomerFormModal";

/* ------------------------------------------------------------- list page */

export function CustomersListPage() {
  const canWrite = useHasRole("Sales", "Sales_Head") && useCanEditTab("customers");
  const { isReadOnly } = useCrmAccess("customers");
  const [toast, notify] = useToast();
  const [rows, setRows] = useState<Customer[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<{ by: string; dir: "asc" | "desc" }>({ by: "created_at", dir: "desc" });
  const [showNew, setShowNew] = useState(false);
  const dSearch = useDebounced(search);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<Customer[]>(
        `/api/customers${qs({ page, limit: 20, search: dSearch, status, sort_by: sort.by, sort_dir: sort.dir })}`,
      );
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load customers");
    } finally {
      setLoading(false);
    }
  }, [page, dSearch, status, sort]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [dSearch, status]);

  const columns: Column<Customer>[] = [
    { key: "name", label: "Name", sortable: true, render: (r) => <span className="font-semibold text-primary">{r.name}</span> },
    { key: "legal_entity_name", label: "Legal Entity", render: (r) => r.legal_entity_name || "—" },
    { key: "status", label: "Status", sortable: true, render: (r) => <StatusBadge status={r.status} /> },
    { key: "created_at", label: "Created", sortable: true, render: (r) => fmtDate(r.created_at) },
  ];

  return (
    <div>
      {toast}
      {isReadOnly && (
        <p className="mb-3 rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          View-only access — you can browse customers but cannot create or edit.
        </p>
      )}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-display text-xl font-bold text-primary">Customers</h1>
        {canWrite && (
          <button className={btnPrimary} onClick={() => setShowNew(true)}>
            <Plus size={15} /> New Customer
          </button>
        )}
      </div>
      {error && <div className="mb-3"><ErrorBox error={error} onRetry={load} /></div>}
      <DataTable
        columns={columns}
        rows={rows}
        meta={meta}
        loading={loading}
        search={search}
        onSearch={setSearch}
        sort={sort}
        onSort={(by) => setSort((s) => ({ by, dir: s.by === by && s.dir === "asc" ? "desc" : "asc" }))}
        onPage={setPage}
        onRowClick={(r) => crmNavigate(`customers/${r.id}`)}
        emptyMessage="No customers found"
        filters={
          <select className={`${inputCls} !w-44`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            {CUSTOMER_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        }
      />
      {showNew && (
        <CustomerFormModal
          onClose={() => setShowNew(false)}
          onSaved={(c) => crmNavigate(`customers/${c.id}`)}
          notify={notify}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------- branches tab */

function BranchFormModal({
  customerId,
  initial,
  onClose,
  onSaved,
  notify,
}: {
  customerId: number;
  initial?: Branch;
  onClose: () => void;
  onSaved: () => void;
  notify: Notify;
}) {
  const [form, setForm] = useState({
    branch_name: initial?.branch_name || "",
    branch_legal_name: initial?.branch_legal_name || "",
    billing_address: initial?.billing_address || "",
    address_line_2: initial?.address_line_2 || "",
    delivery_address: initial?.delivery_address || "",
    city: initial?.city || "",
    state: initial?.state || "",
    pincode: initial?.pincode || "",
    country: initial?.country || "",
    gstin: initial?.gstin || "",
    pan: initial?.pan || "",
    is_primary: initial?.is_primary || false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.branch_name.trim()) errs.branch_name = "Branch name is required";
    if (form.gstin && form.gstin.trim().length > 15) errs.gstin = "GSTIN must be at most 15 characters";
    if (form.pan && form.pan.trim().length > 10) errs.pan = "PAN must be at most 10 characters";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const payload = {
        branch_name: form.branch_name.trim(),
        branch_legal_name: form.branch_legal_name.trim() || null,
        billing_address: form.billing_address.trim() || null,
        address_line_2: form.address_line_2.trim() || null,
        delivery_address: form.delivery_address.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        pincode: form.pincode.trim() || null,
        country: form.country.trim() || null,
        gstin: form.gstin.trim() || null,
        pan: form.pan.trim() || null,
        is_primary: form.is_primary,
      };
      const res = initial
        ? await crmPut(`/api/customers/${customerId}/branches/${initial.id}`, payload)
        : await crmPost(`/api/customers/${customerId}/branches`, payload);
      notify(res.message || "Branch saved");
      onSaved();
      onClose();
    } catch (err: any) {
      notify(err?.message || "Failed to save branch", "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? "Edit Branch" : "Add Branch"} onClose={onClose} fullScreen>
      <form onSubmit={submit} className="space-y-3.5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Branch name" required error={errors.branch_name}>
            <input className={inputCls} value={form.branch_name} onChange={(e) => set("branch_name", e.target.value)} />
          </Field>
          <Field label="Branch legal name">
            <input className={inputCls} value={form.branch_legal_name} onChange={(e) => set("branch_legal_name", e.target.value)} />
          </Field>
        </div>
        <Field label="Billing address">
          <textarea className={inputCls} rows={2} value={form.billing_address} onChange={(e) => set("billing_address", e.target.value)} />
        </Field>
        <Field label="Address line 2">
          <input className={inputCls} value={form.address_line_2} onChange={(e) => set("address_line_2", e.target.value)} />
        </Field>
        <Field label="Delivery address">
          <textarea className={inputCls} rows={2} value={form.delivery_address} onChange={(e) => set("delivery_address", e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="City">
            <input className={inputCls} value={form.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="State">
            <input className={inputCls} value={form.state} onChange={(e) => set("state", e.target.value)} />
          </Field>
          <Field label="Pincode">
            <input className={inputCls} value={form.pincode} onChange={(e) => set("pincode", e.target.value)} maxLength={16} />
          </Field>
          <Field label="Country">
            <input className={inputCls} value={form.country} onChange={(e) => set("country", e.target.value)} />
          </Field>
          <Field label="GSTIN" error={errors.gstin}>
            <input className={inputCls} value={form.gstin} onChange={(e) => set("gstin", e.target.value)} maxLength={15} />
          </Field>
          <Field label="PAN" error={errors.pan}>
            <input className={inputCls} value={form.pan} onChange={(e) => set("pan", e.target.value)} maxLength={10} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold text-primary">
          <input type="checkbox" className="h-4 w-4 accent-sky-600" checked={form.is_primary} onChange={(e) => set("is_primary", e.target.checked)} />
          Primary branch
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={saving}>{saving ? "Saving…" : "Save branch"}</button>
        </div>
      </form>
    </Modal>
  );
}

const branchAddress = (b: Branch) =>
  [b.billing_address, b.address_line_2, b.city, b.state, b.pincode, b.country].filter(Boolean).join(", ") || "—";

/** Read-only branch details (ported from the removed Customer Branches page). */
function BranchViewModal({ row, onClose }: { row: Branch; onClose: () => void }) {
  return (
    <Modal title={`Branch — ${row.branch_name}`} onClose={onClose}>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-xs font-semibold uppercase text-muted">Branch legal name</dt><dd>{row.branch_legal_name || "—"}</dd></div>
        <div><dt className="text-xs font-semibold uppercase text-muted">Primary</dt><dd>{row.is_primary ? "Yes" : "No"}</dd></div>
        <div><dt className="text-xs font-semibold uppercase text-muted">GSTIN</dt><dd>{row.gstin || "—"}</dd></div>
        <div><dt className="text-xs font-semibold uppercase text-muted">PAN</dt><dd>{row.pan || "—"}</dd></div>
        <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase text-muted">Billing address</dt><dd>{branchAddress(row)}</dd></div>
        {row.delivery_address && (
          <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase text-muted">Delivery address</dt><dd>{row.delivery_address}</dd></div>
        )}
      </dl>
      <div className="mt-4 flex justify-end">
        <button type="button" className={btnSecondary} onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

/* --------------------------------------------- branch billing policy modal */

type CustomerDefaults = {
  week_off_billable: boolean;
  leave_billable: boolean;
  holidays_billable: boolean;
  min_hours_full_day: number;
  min_hours_half_day: number;
};

/** Built-in fallbacks when the customer has no default policy row (mirrors
 * services/timesheets.py BillingPolicy defaults). */
const BUILTIN_DEFAULTS: CustomerDefaults = {
  week_off_billable: false,
  leave_billable: false,
  holidays_billable: false,
  min_hours_full_day: 8,
  min_hours_half_day: 4,
};

const BILLING_FREQUENCIES = ["Weekly", "Bi-Weekly", "Monthly"];

type Tri = "" | "yes" | "no";
const triFromApi = (v: boolean | null | undefined): Tri => (v == null ? "" : v ? "yes" : "no");
const triToApi = (v: Tri): boolean | null => (v === "" ? null : v === "yes");

/** Per-branch billing policy editor. Unset fields inherit the customer's
 * default policy; every field can be cleared back to "inherit". */
function BranchBillingPolicyModal({
  customerId,
  branch,
  canWrite,
  onClose,
  onSaved,
  notify,
}: {
  customerId: number;
  branch: Branch;
  canWrite: boolean;
  onClose: () => void;
  onSaved: () => void;
  notify: Notify;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [defaults, setDefaults] = useState<CustomerDefaults>(BUILTIN_DEFAULTS);
  const [form, setForm] = useState({
    weekoff_billable: "" as Tri,
    leave_billable: "" as Tri,
    holidays_billable: "" as Tri,
    hours_required_full_day: "",
    hours_required_half_day: "",
    billing_frequency: "",
    billing_cycle_start_day: "",
    billing_cycle_end_day: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [polRes, defRes] = await Promise.all([
        crmGet<any>(`/api/customers/${customerId}/branches/${branch.id}/billing-policy`),
        crmGet<any>(`/api/customers/${customerId}/billing-policy`),
      ]);
      const p = polRes.data || {};
      setForm({
        weekoff_billable: triFromApi(p.weekoff_billable),
        leave_billable: triFromApi(p.leave_billable),
        holidays_billable: triFromApi(p.holidays_billable),
        hours_required_full_day: p.hours_required_full_day != null ? String(p.hours_required_full_day) : "",
        hours_required_half_day: p.hours_required_half_day != null ? String(p.hours_required_half_day) : "",
        billing_frequency: p.billing_frequency || "",
        billing_cycle_start_day: p.billing_cycle_start_day != null ? String(p.billing_cycle_start_day) : "",
        billing_cycle_end_day: p.billing_cycle_end_day != null ? String(p.billing_cycle_end_day) : "",
      });
      const d = defRes.data;
      if (d) {
        setDefaults({
          week_off_billable: !!d.week_off_billable,
          leave_billable: !!d.leave_billable,
          holidays_billable: !!d.holidays_billable,
          min_hours_full_day: Number(d.min_hours_full_day ?? 8),
          min_hours_half_day: Number(d.min_hours_half_day ?? 4),
        });
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load branch billing policy");
    } finally {
      setLoading(false);
    }
  }, [customerId, branch.id]);
  useEffect(() => { load(); }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const numOrNull = (v: string) => (v === "" ? null : Number(v));
    const full = numOrNull(form.hours_required_full_day);
    const half = numOrNull(form.hours_required_half_day);
    const sd = numOrNull(form.billing_cycle_start_day);
    const ed = numOrNull(form.billing_cycle_end_day);
    if (full != null && (!Number.isFinite(full) || full < 0 || full > 24)) errs.full = "Must be between 0 and 24";
    if (half != null && (!Number.isFinite(half) || half < 0 || half > 24)) errs.half = "Must be between 0 and 24";
    if (!errs.full && !errs.half && full != null && half != null && half > full)
      errs.half = "Half-day hours cannot exceed full-day hours";
    if (sd != null && (!Number.isInteger(sd) || sd < 1 || sd > 31)) errs.start = "Day must be 1–31";
    if (ed != null && (!Number.isInteger(ed) || ed < 1 || ed > 31)) errs.end = "Day must be 1–31";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const res = await crmPut(`/api/customers/${customerId}/branches/${branch.id}/billing-policy`, {
        weekoff_billable: triToApi(form.weekoff_billable),
        leave_billable: triToApi(form.leave_billable),
        holidays_billable: triToApi(form.holidays_billable),
        hours_required_full_day: full,
        hours_required_half_day: half,
        billing_frequency: form.billing_frequency || null,
        billing_cycle_start_day: sd,
        billing_cycle_end_day: ed,
      });
      notify(res.message || "Branch billing policy saved");
      onSaved();
      onClose();
    } catch (err: any) {
      notify(err?.message || "Failed to save branch billing policy", "err");
    } finally {
      setSaving(false);
    }
  };

  const inheritNote = (shown: boolean, what: string) =>
    shown ? <p className="mt-1 text-xs text-muted">Inherits customer default ({what})</p> : null;

  const triSelect = (key: "weekoff_billable" | "leave_billable" | "holidays_billable", label: string, def: boolean) => (
    <Field label={label}>
      <select className={inputCls} value={form[key]} disabled={!canWrite} onChange={(e) => set(key, e.target.value)}>
        <option value="">Inherit customer default</option>
        <option value="yes">Billable</option>
        <option value="no">Not billable</option>
      </select>
      {inheritNote(form[key] === "", def ? "Billable" : "Not billable")}
    </Field>
  );

  const clearBtn = (key: keyof typeof form) =>
    canWrite && form[key] !== "" ? (
      <button
        type="button"
        className="mt-1 text-xs font-semibold text-sky-600 hover:underline dark:text-sky-400"
        onClick={() => set(key, "")}
      >
        Clear (inherit)
      </button>
    ) : null;

  return (
    <Modal title={`Billing Policy — ${branch.branch_name}`} onClose={onClose}>
      {loading ? (
        <Spinner label="Loading branch billing policy…" />
      ) : error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : (
        <form onSubmit={save} className="space-y-3.5">
          <p className="text-sm text-muted">
            Fields left as <b>Inherit</b> / blank fall back to the customer&apos;s default billing policy.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {triSelect("weekoff_billable", "Week-offs billable", defaults.week_off_billable)}
            {triSelect("leave_billable", "Leaves billable", defaults.leave_billable)}
            {triSelect("holidays_billable", "Holidays billable", defaults.holidays_billable)}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Min hours — full day" error={errors.full}>
              <input
                type="number" step="0.5" min={0} max={24}
                className={inputCls}
                value={form.hours_required_full_day}
                disabled={!canWrite}
                placeholder={`Inherit (${defaults.min_hours_full_day})`}
                onChange={(e) => set("hours_required_full_day", e.target.value)}
              />
              {inheritNote(form.hours_required_full_day === "", `${defaults.min_hours_full_day} h`)}
              {clearBtn("hours_required_full_day")}
            </Field>
            <Field label="Min hours — half day" error={errors.half}>
              <input
                type="number" step="0.5" min={0} max={24}
                className={inputCls}
                value={form.hours_required_half_day}
                disabled={!canWrite}
                placeholder={`Inherit (${defaults.min_hours_half_day})`}
                onChange={(e) => set("hours_required_half_day", e.target.value)}
              />
              {inheritNote(form.hours_required_half_day === "", `${defaults.min_hours_half_day} h`)}
              {clearBtn("hours_required_half_day")}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Billing frequency">
              <select
                className={inputCls}
                value={form.billing_frequency}
                disabled={!canWrite}
                onChange={(e) => set("billing_frequency", e.target.value)}
              >
                <option value="">— Not set —</option>
                {BILLING_FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </Field>
            <Field label="Cycle start day" error={errors.start}>
              <input
                type="number" min={1} max={31} step={1}
                className={inputCls}
                value={form.billing_cycle_start_day}
                disabled={!canWrite}
                placeholder="Not set"
                onChange={(e) => set("billing_cycle_start_day", e.target.value)}
              />
              {clearBtn("billing_cycle_start_day")}
            </Field>
            <Field label="Cycle end day" error={errors.end}>
              <input
                type="number" min={1} max={31} step={1}
                className={inputCls}
                value={form.billing_cycle_end_day}
                disabled={!canWrite}
                placeholder="Not set"
                onChange={(e) => set("billing_cycle_end_day", e.target.value)}
              />
              {clearBtn("billing_cycle_end_day")}
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className={btnSecondary} onClick={onClose} disabled={saving}>
              {canWrite ? "Cancel" : "Close"}
            </button>
            {canWrite && (
              <button type="submit" className={btnPrimary} disabled={saving}>
                {saving ? "Saving…" : "Save policy"}
              </button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Does the branch define any of its own billing-policy fields? */
const hasOwnPolicy = (b: Branch) =>
  b.weekoff_billable != null ||
  b.leave_billable != null ||
  b.holidays_billable != null ||
  b.hours_required_full_day != null ||
  b.hours_required_half_day != null ||
  !!b.billing_frequency ||
  b.billing_cycle_start_day != null ||
  b.billing_cycle_end_day != null;

function BranchesTab({ customerId, canWrite, notify }: { customerId: number; canWrite: boolean; notify: Notify }) {
  const [rows, setRows] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<{ initial?: Branch } | null>(null);
  const [viewRow, setViewRow] = useState<Branch | null>(null);
  const [policyRow, setPolicyRow] = useState<Branch | null>(null);
  const [deleting, setDeleting] = useState<Branch | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<Branch[]>(`/api/customers/${customerId}/branches`);
      setRows(res.data || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load branches");
    } finally {
      setLoading(false);
    }
  }, [customerId]);
  useEffect(() => { load(); }, [load]);

  // Search across branch name / legal name / GSTIN / city (ported from the
  // removed Customer Branches page, scoped to this customer).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.branch_name, r.branch_legal_name, r.gstin, r.pan, r.city, r.state]
        .some((v) => (v || "").toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      const res = await crmDelete(`/api/customers/${customerId}/branches/${deleting.id}`);
      notify(res.message || "Branch deleted");
      setDeleting(null);
      load();
    } catch (e: any) {
      notify(e?.message || "Failed to delete branch", "err");
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<Branch>[] = [
    {
      key: "branch_name",
      label: "Branch",
      render: (r) => (
        <span className="font-semibold text-primary">
          {r.branch_name}
          {r.is_primary && (
            <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
              Primary
            </span>
          )}
        </span>
      ),
    },
    { key: "branch_legal_name", label: "Legal Name", render: (r) => r.branch_legal_name || "—" },
    { key: "city", label: "City", render: (r) => r.city || "—" },
    { key: "state", label: "State", render: (r) => r.state || "—" },
    { key: "pincode", label: "Pincode", render: (r) => r.pincode || "—" },
    { key: "gstin", label: "GSTIN", render: (r) => r.gstin || "—" },
    { key: "pan", label: "PAN", render: (r) => r.pan || "—" },
    {
      key: "_billing_policy",
      label: "Billing Policy",
      render: (r) => (
        <button
          className="inline-flex items-center gap-1.5 rounded-lg border border-subtle px-2 py-1 text-xs font-semibold text-sky-600 hover:bg-surface-2 dark:text-sky-400"
          title="View / edit this branch's billing policy"
          onClick={(e) => { e.stopPropagation(); setPolicyRow(r); }}
        >
          <SlidersHorizontal size={13} />
          {hasOwnPolicy(r) ? "Custom" : "Inherits default"}
        </button>
      ),
    },
    {
      key: "_actions",
      label: "",
      className: "text-right",
      render: (r) => (
        <span className="inline-flex gap-1">
          <button className={iconBtn} title="View branch" aria-label="View branch" onClick={(e) => { e.stopPropagation(); setViewRow(r); }}>
            <Eye size={15} />
          </button>
          {canWrite && (
            <>
              <button className={iconBtn} title="Edit branch" aria-label="Edit branch" onClick={(e) => { e.stopPropagation(); setModal({ initial: r }); }}>
                <Pencil size={15} />
              </button>
              <button className={`${iconBtn} hover:!text-rose-600`} title="Delete branch" aria-label="Delete branch" onClick={(e) => { e.stopPropagation(); setDeleting(r); }}>
                <Trash2 size={15} />
              </button>
            </>
          )}
        </span>
      ),
    },
  ];

  return (
    <div>
      {canWrite && (
        <div className="mb-3 flex justify-end">
          <button className={btnPrimary} onClick={() => setModal({})}>
            <Plus size={15} /> Add Branch
          </button>
        </div>
      )}
      {error && <div className="mb-3"><ErrorBox error={error} onRetry={load} /></div>}
      <DataTable
        columns={columns}
        rows={filtered}
        loading={loading}
        search={search}
        onSearch={setSearch}
        emptyMessage={search ? "No branches match your search" : "No branches yet"}
      />
      {modal && (
        <BranchFormModal customerId={customerId} initial={modal.initial} onClose={() => setModal(null)} onSaved={load} notify={notify} />
      )}
      {viewRow && <BranchViewModal row={viewRow} onClose={() => setViewRow(null)} />}
      {policyRow && (
        <BranchBillingPolicyModal
          customerId={customerId}
          branch={policyRow}
          canWrite={canWrite}
          onClose={() => setPolicyRow(null)}
          onSaved={load}
          notify={notify}
        />
      )}
      {deleting && (
        <ConfirmModal
          title="Delete branch"
          message={<>Delete branch <b>{deleting.branch_name}</b>? This cannot be undone.</>}
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={remove}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------- default billing policy tab */

/** Customer-level DEFAULT billing policy — branches without their own policy
 * (Branches tab → Billing Policy) inherit these values field-by-field. */
function BillingPolicyTab({ customerId, canWrite, notify }: { customerId: number; canWrite: boolean; notify: Notify }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [exists, setExists] = useState(false);
  const [form, setForm] = useState({
    week_off_billable: false,
    leave_billable: false,
    holidays_billable: false,
    min_hours_full_day: "8",
    min_hours_half_day: "4",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<any>(`/api/customers/${customerId}/billing-policy`);
      if (res.data) {
        setExists(true);
        setForm({
          week_off_billable: !!res.data.week_off_billable,
          leave_billable: !!res.data.leave_billable,
          holidays_billable: !!res.data.holidays_billable,
          min_hours_full_day: String(res.data.min_hours_full_day ?? 8),
          min_hours_half_day: String(res.data.min_hours_half_day ?? 4),
        });
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load billing policy");
    } finally {
      setLoading(false);
    }
  }, [customerId]);
  useEffect(() => { load(); }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const full = Number(form.min_hours_full_day);
    const half = Number(form.min_hours_half_day);
    const errs: Record<string, string> = {};
    if (!Number.isFinite(full) || full < 0 || full > 24) errs.min_hours_full_day = "Must be a number between 0 and 24";
    if (!Number.isFinite(half) || half < 0 || half > 24) errs.min_hours_half_day = "Must be a number between 0 and 24";
    if (!errs.min_hours_full_day && !errs.min_hours_half_day && half > full)
      errs.min_hours_half_day = "Half-day hours cannot exceed full-day hours";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const res = await crmPut(`/api/customers/${customerId}/billing-policy`, {
        week_off_billable: form.week_off_billable,
        leave_billable: form.leave_billable,
        holidays_billable: form.holidays_billable,
        min_hours_full_day: full,
        min_hours_half_day: half,
      });
      setExists(true);
      notify(res.message || "Billing policy saved");
    } catch (err: any) {
      notify(err?.message || "Failed to save billing policy", "err");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner label="Loading billing policy…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;

  const check = (key: "week_off_billable" | "leave_billable" | "holidays_billable", label: string) => (
    <label className="flex items-center gap-2 text-sm font-semibold text-primary">
      <input
        type="checkbox"
        className="h-4 w-4 accent-sky-600"
        checked={form[key]}
        disabled={!canWrite}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
      />
      {label}
    </label>
  );

  return (
    <form onSubmit={save} className="max-w-xl rounded-card border border-subtle bg-surface-1 p-5 shadow-sm">
      <p className="mb-4 text-sm text-muted">
        Branches without their own policy inherit this.
      </p>
      {!exists && (
        <p className="mb-4 text-sm text-muted">
          No billing policy is set for this customer yet — saving will create one.
        </p>
      )}
      <div className="space-y-3">
        {check("week_off_billable", "Week-offs are billable")}
        {check("leave_billable", "Leaves are billable")}
        {check("holidays_billable", "Holidays are billable")}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Min hours — full day" required error={errors.min_hours_full_day}>
          <input
            type="number" step="0.5" min={0} max={24}
            className={inputCls}
            value={form.min_hours_full_day}
            disabled={!canWrite}
            onChange={(e) => setForm((f) => ({ ...f, min_hours_full_day: e.target.value }))}
          />
        </Field>
        <Field label="Min hours — half day" required error={errors.min_hours_half_day}>
          <input
            type="number" step="0.5" min={0} max={24}
            className={inputCls}
            value={form.min_hours_half_day}
            disabled={!canWrite}
            onChange={(e) => setForm((f) => ({ ...f, min_hours_half_day: e.target.value }))}
          />
        </Field>
      </div>
      {canWrite && (
        <div className="mt-5 flex justify-end">
          <button type="submit" className={btnPrimary} disabled={saving}>{saving ? "Saving…" : "Save policy"}</button>
        </div>
      )}
    </form>
  );
}

/* ---------------------------------------------------------- contacts tab */

function ContactFormModal({
  customerId,
  branches,
  initial,
  onClose,
  onSaved,
  notify,
}: {
  customerId: number;
  branches: Branch[];
  initial?: Contact;
  onClose: () => void;
  onSaved: () => void;
  notify: Notify;
}) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    branch_id: initial?.branch_id ? String(initial.branch_id) : "",
    email: initial?.email || "",
    phone: initial?.phone || "",
    designation: initial?.designation || "",
    is_hiring_manager: initial?.is_hiring_manager || false,
    is_active: initial?.is_active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Contact name is required";
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) errs.email = "Enter a valid email address";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        branch_id: form.branch_id ? Number(form.branch_id) : null,
        email: form.email.trim() || null,
        // Store E.164 (+919876543210); unparseable input is kept as typed so
        // nothing is lost (the read-side parser copes with legacy formats).
        phone: normalizePhoneForSave(form.phone) || null,
        designation: form.designation.trim() || null,
        is_hiring_manager: form.is_hiring_manager,
        is_active: form.is_active,
      };
      const res = initial
        ? await crmPut(`/api/customers/${customerId}/contacts/${initial.id}`, payload)
        : await crmPost(`/api/customers/${customerId}/contacts`, payload);
      notify(res.message || "Contact saved");
      onSaved();
      onClose();
    } catch (err: any) {
      notify(err?.message || "Failed to save contact", "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? "Edit Contact" : "Add Contact"} onClose={onClose} fullScreen>
      <form onSubmit={submit} className="space-y-3.5">
        <Field label="Name" required error={errors.name}>
          <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Branch">
          <select className={inputCls} value={form.branch_id} onChange={(e) => set("branch_id", e.target.value)}>
            <option value="">— No branch —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.branch_name}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Email" error={errors.email}>
            <input className={inputCls} value={form.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Phone">
            <input className={inputCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} maxLength={32} />
          </Field>
        </div>
        <Field label="Designation">
          <input className={inputCls} value={form.designation} onChange={(e) => set("designation", e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-5">
          <label className="flex items-center gap-2 text-sm font-semibold text-primary">
            <input type="checkbox" className="h-4 w-4 accent-sky-600" checked={form.is_hiring_manager} onChange={(e) => set("is_hiring_manager", e.target.checked)} />
            Hiring manager
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-primary">
            <input type="checkbox" className="h-4 w-4 accent-sky-600" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} />
            Active
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={saving}>{saving ? "Saving…" : "Save contact"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ContactsTab({ customerId, canWrite, notify }: { customerId: number; canWrite: boolean; notify: Notify }) {
  const [rows, setRows] = useState<Contact[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<{ initial?: Contact } | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [c, b] = await Promise.all([
        crmGet<Contact[]>(`/api/customers/${customerId}/contacts`),
        crmGet<Branch[]>(`/api/customers/${customerId}/branches`),
      ]);
      setRows(c.data || []);
      setBranches(b.data || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, [customerId]);
  useEffect(() => { load(); }, [load]);

  const branchName = (id?: number | null) => branches.find((b) => b.id === id)?.branch_name || "—";

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      const res = await crmDelete(`/api/customers/${customerId}/contacts/${deleting.id}`);
      notify(res.message || "Contact deleted");
      setDeleting(null);
      load();
    } catch (e: any) {
      notify(e?.message || "Failed to delete contact", "err");
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<Contact>[] = [
    {
      key: "name",
      label: "Name",
      render: (r) => (
        <span className="font-semibold text-primary">
          {r.name}
          {r.is_hiring_manager && (
            <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
              Hiring Manager
            </span>
          )}
        </span>
      ),
    },
    { key: "email", label: "Email", render: (r) => r.email || "—" },
    { key: "phone", label: "Phone", render: (r) => r.phone || "—" },
    { key: "designation", label: "Designation", render: (r) => r.designation || "—" },
    { key: "branch_id", label: "Branch", render: (r) => branchName(r.branch_id) },
    { key: "is_active", label: "Status", render: (r) => <StatusBadge status={r.is_active ? "Active" : "Inactive"} /> },
  ];
  if (canWrite) {
    columns.push({
      key: "_actions",
      label: "",
      className: "text-right",
      render: (r) => (
        <span className="inline-flex gap-1">
          <button className={iconBtn} title="Edit contact" aria-label="Edit contact" onClick={(e) => { e.stopPropagation(); setModal({ initial: r }); }}>
            <Pencil size={15} />
          </button>
          <button className={`${iconBtn} hover:!text-rose-600`} title="Delete contact" aria-label="Delete contact" onClick={(e) => { e.stopPropagation(); setDeleting(r); }}>
            <Trash2 size={15} />
          </button>
        </span>
      ),
    });
  }

  return (
    <div>
      {canWrite && (
        <div className="mb-3 flex justify-end">
          <button className={btnPrimary} onClick={() => setModal({})}>
            <Plus size={15} /> Add Contact
          </button>
        </div>
      )}
      {error && <div className="mb-3"><ErrorBox error={error} onRetry={load} /></div>}
      <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No contacts yet" />
      {modal && (
        <ContactFormModal
          customerId={customerId}
          branches={branches}
          initial={modal.initial}
          onClose={() => setModal(null)}
          onSaved={load}
          notify={notify}
        />
      )}
      {deleting && (
        <ConfirmModal
          title="Delete contact"
          message={<>Delete contact <b>{deleting.name}</b>? This cannot be undone.</>}
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={remove}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------- documents tab */

function DocumentUploadModal({
  customerId,
  docTypes,
  onClose,
  onUploaded,
  notify,
}: {
  customerId: number;
  docTypes: DocType[];
  onClose: () => void;
  onUploaded: () => void;
  notify: Notify;
}) {
  const [typeId, setTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const dateError = startDate && endDate && endDate < startDate ? "End date cannot be before start date" : "";
  const canUpload = !!typeId && !dateError;

  const fields: Record<string, string> = { document_type_id: typeId };
  if (startDate) fields.start_date = startDate;
  if (endDate) fields.end_date = endDate;

  return (
    <Modal title="Upload Document" onClose={onClose} fullScreen>
      <div className="space-y-3.5">
        <Field label="Document type" required error={!typeId ? "Select a document type before uploading" : undefined}>
          <select className={inputCls} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">— Select type —</option>
            {docTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Start date">
            <input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="End date" error={dateError || undefined}>
            <input type="date" className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
          {canUpload ? (
            <FileUploadButton
              path={`/api/customers/${customerId}/documents`}
              fields={fields}
              label="Choose file & upload"
              onDone={() => {
                notify("Document uploaded");
                onUploaded();
                onClose();
              }}
              onError={(m) => notify(m, "err")}
            />
          ) : (
            <button type="button" className={btnSecondary} disabled>Choose file & upload</button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function DocumentsTab({ customerId, canWrite, notify }: { customerId: number; canWrite: boolean; notify: Notify }) {
  const [rows, setRows] = useState<CustomerDoc[]>([]);
  const [docTypes, setDocTypes] = useState<DocType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [deleting, setDeleting] = useState<CustomerDoc | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [docs, types] = await Promise.all([
        crmGet<CustomerDoc[]>(`/api/customers/${customerId}/documents`),
        crmGet<DocType[]>(`/api/document-types${qs({ limit: 200, is_active: true })}`),
      ]);
      setRows(docs.data || []);
      setDocTypes(types.data || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [customerId]);
  useEffect(() => { load(); }, [load]);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      const res = await crmDelete(`/api/customers/${customerId}/documents/${deleting.id}`);
      notify(res.message || "Document deleted");
      setDeleting(null);
      load();
    } catch (e: any) {
      notify(e?.message || "Failed to delete document", "err");
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<CustomerDoc>[] = [
    {
      key: "document_type_name",
      label: "Type",
      render: (r) => <span className="font-semibold text-primary">{r.document_type_name || `Type #${r.document_type_id}`}</span>,
    },
    { key: "start_date", label: "Start", render: (r) => fmtDate(r.start_date) },
    { key: "end_date", label: "End", render: (r) => fmtDate(r.end_date) },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status || undefined} /> },
    { key: "file_url", label: "File", render: (r) => <FileLink url={r.file_url} /> },
  ];
  if (canWrite) {
    columns.push({
      key: "_actions",
      label: "",
      className: "text-right",
      render: (r) => (
        <button className={`${iconBtn} hover:!text-rose-600`} title="Delete document" aria-label="Delete document" onClick={(e) => { e.stopPropagation(); setDeleting(r); }}>
          <Trash2 size={15} />
        </button>
      ),
    });
  }

  return (
    <div>
      {canWrite && (
        <div className="mb-3 flex justify-end">
          <button className={btnPrimary} onClick={() => setShowUpload(true)}>
            <Plus size={15} /> Upload Document
          </button>
        </div>
      )}
      {error && <div className="mb-3"><ErrorBox error={error} onRetry={load} /></div>}
      <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No documents uploaded" />
      {showUpload && (
        <DocumentUploadModal
          customerId={customerId}
          docTypes={docTypes}
          onClose={() => setShowUpload(false)}
          onUploaded={load}
          notify={notify}
        />
      )}
      {deleting && (
        <ConfirmModal
          title="Delete document"
          message={<>Delete this <b>{deleting.document_type_name || "document"}</b> file? This cannot be undone.</>}
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={remove}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ detail page */

export function CustomerDetailPage() {
  const params = useCrmParams();
  const customerId = Number(params.id);
  const canWrite = useHasRole("Sales", "Sales_Head") && useCanEditTab("customers");
  const [toast, notify] = useToast();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("branches");
  const [showEdit, setShowEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<Customer>(`/api/customers/${customerId}`);
      setCustomer(res.data);
    } catch (e: any) {
      setError(e?.message || "Failed to load customer");
    } finally {
      setLoading(false);
    }
  }, [customerId]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner label="Loading customer…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!customer) return <ErrorBox error="Customer not found" />;

  return (
    <div>
      {toast}
      <div className="mb-1">
        <CrmLink to="customers" className="text-sm font-semibold text-sky-600 hover:underline dark:text-sky-400">
          ← Customers
        </CrmLink>
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-display text-xl font-bold text-primary">{customer.name}</h1>
            <StatusBadge status={customer.status} />
          </div>
          <div className="mt-0.5 text-sm text-muted">
            {customer.legal_entity_name || "No legal entity name"} · Created {fmtDate(customer.created_at)}
          </div>
        </div>
        {canWrite && (
          <button className={btnSecondary} onClick={() => setShowEdit(true)}>
            <Pencil size={15} /> Edit
          </button>
        )}
      </div>

      <Tabs
        tabs={[
          { key: "branches", label: "Branches" },
          { key: "billing", label: "Default Billing Policy" },
          { key: "contacts", label: "Contacts" },
          { key: "documents", label: "Documents" },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="mt-4">
        {tab === "branches" && <BranchesTab customerId={customerId} canWrite={canWrite} notify={notify} />}
        {tab === "billing" && <BillingPolicyTab customerId={customerId} canWrite={canWrite} notify={notify} />}
        {tab === "contacts" && <ContactsTab customerId={customerId} canWrite={canWrite} notify={notify} />}
        {tab === "documents" && <DocumentsTab customerId={customerId} canWrite={canWrite} notify={notify} />}
      </div>

      {showEdit && (
        <CustomerFormModal
          initial={customer}
          onClose={() => setShowEdit(false)}
          onSaved={(c) => setCustomer(c)}
          notify={notify}
        />
      )}
    </div>
  );
}
