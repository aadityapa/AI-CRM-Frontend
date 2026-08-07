/** Customers module — list page + detail page with Branches (incl. per-branch
 * billing policy) / Default Billing Policy / Contacts / Documents tabs.
 * Branch management (formerly the standalone Customer Branches page) lives in
 * the Branches tab. Writes restricted to Sales, Sales_Head, Admin. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Eye, Lock, Pencil, Plus, Search, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut, qs } from "../api";
import type { Meta } from "../api";
import { crmNavigate, useCrmParams } from "../routerHooks";
import { useHasRole } from "../CrmApp";
import { useCanEditTab, useCrmAccess } from "../useAccess";
import { CrmBreadcrumb } from "../components/CrmBreadcrumb";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { RowActions, afterListDelete } from "../components/RowActions";
import { FileLink, FileUploadButton } from "../components/FileUpload";
import { CustomerFormModal } from "../components/CustomerFormModal";
import { ContactPersonFormModal } from "../components/ContactPersonFormModal";
import { EditBranchWizard } from "../components/BranchWizardModal";
import { SearchableSelect, optionsFromStrings } from "../components/SearchableSelect";
import {
  COUNTRIES, DEFAULT_COUNTRY, INDIAN_CITIES, INDIAN_STATES,
} from "../constants/geo";
import {
  ConfirmModal, EmptyState, ErrorBox, Field, Modal, Spinner, StatusBadge, Tabs,
  btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";
import { SectionHeaderBanner, WizardField } from "../components/wizard";

/** Local single-screen shell — applies the shared New Opportunity wizard look
 * (theme-aware body + SectionHeaderBanner) inside the existing Modal.
 * Visual-only wrapper: no field, state, or submit logic lives here. */
function WizFormShell({
  title, subtitle, icon, children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="crm-wizard wiz-noise min-h-full w-full bg-[color:var(--wiz-bg)] px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-3xl">
        <SectionHeaderBanner title={title} description={subtitle} icon={icon} />
        {children}
      </div>
    </div>
  );
}

/* Shared footer container for the reskinned single-screen dialogs. */
const wizFooterRow = "mt-6 flex items-center gap-3 border-t border-[color:var(--wiz-border)] pt-5";

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
  billing_type?: string | null;
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
  role?: string | null;
  contact_priority?: string | null;
  notification?: string | null;
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
  // Default to Active customers (inactive/archived ones stay one click away).
  const [status, setStatus] = useState("Active");
  const [sort, setSort] = useState<{ by: string; dir: "asc" | "desc" }>({ by: "created_at", dir: "desc" });
  const [showNew, setShowNew] = useState(false);
  // "All entities" filter — narrows the loaded rows by legal-entity presence.
  const [entityFilter, setEntityFilter] = useState<"" | "with" | "without">("");
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

  // Client-side entity filter over the loaded page (list is small; usually 1 page).
  const displayRows = useMemo(() => {
    if (!entityFilter) return rows;
    return rows.filter((r) =>
      entityFilter === "with" ? !!(r.legal_entity_name || "").trim() : !(r.legal_entity_name || "").trim(),
    );
  }, [rows, entityFilter]);

  const columns: Column<Customer>[] = [
    { key: "name", label: "Name", sortable: true, render: (r) => <span className="font-semibold text-primary">{r.name}</span> },
    {
      key: "legal_entity_name",
      label: "Legal Entity",
      render: (r) =>
        r.legal_entity_name ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-subtle bg-surface-2/60 px-2 py-0.5 text-sm text-primary">
            <Lock size={12} className="text-muted" aria-hidden />
            {r.legal_entity_name}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
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
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-display text-xl font-bold text-primary">Customers</h1>
          <p className="mt-1 text-sm text-muted">Manage and view all your customer organizations.</p>
        </div>
        {canWrite && (
          <button className={btnPrimary} onClick={() => setShowNew(true)}>
            <Plus size={15} /> New Customer
          </button>
        )}
      </div>
      {error && <div className="mb-3"><ErrorBox error={error} onRetry={load} /></div>}
      <DataTable
        columns={columns}
        rows={displayRows}
        meta={meta}
        loading={loading}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search customers or entities…"
        sort={sort}
        onSort={(by) => setSort((s) => ({ by, dir: s.by === by && s.dir === "asc" ? "desc" : "asc" }))}
        onPage={setPage}
        onRowClick={(r) => crmNavigate(`customers/${r.id}`)}
        emptyMessage="No customers found"
        filters={
          <>
            <select className={`${inputCls} !w-40`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              <option value="">All statuses</option>
              {CUSTOMER_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              className={`${inputCls} !w-40`}
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value as "" | "with" | "without")}
              aria-label="Filter by legal entity"
            >
              <option value="">All entities</option>
              <option value="with">With legal entity</option>
              <option value="without">Without legal entity</option>
            </select>
          </>
        }
        rowActions={(r) => (
          <RowActions
            entity="customer"
            itemLabel={r.name}
            onView={() => crmNavigate(`customers/${r.id}`)}
            onEdit={() => crmNavigate(`customers/${r.id}`)}
            deleteUrl={`/api/customers/${r.id}`}
            onDeleted={() => afterListDelete(r.id, setRows, load)}
            notify={notify}
            canEdit={canWrite}
            canDelete={canWrite}
          />
        )}
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
    country: initial?.country || DEFAULT_COUNTRY,
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
    <Modal
      title={<span className="sr-only">{initial ? "Edit Branch" : "Add Branch"}</span>}
      onClose={onClose}
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title={initial ? "Edit Branch" : "Add Branch"}
        subtitle="Branch identity, registered address, and tax identifiers."
        icon={<Building2 size={20} aria-hidden />}
      >
        <form onSubmit={submit} className="space-y-5">
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            <WizardField label="Branch name" required error={errors.branch_name} icon="building" filled={!!form.branch_name.trim()}>
              <input className={inputCls} value={form.branch_name} onChange={(e) => set("branch_name", e.target.value)} />
            </WizardField>
            <WizardField label="Branch legal name" icon="building" filled={!!form.branch_legal_name.trim()}>
              <input className={inputCls} value={form.branch_legal_name} onChange={(e) => set("branch_legal_name", e.target.value)} />
            </WizardField>
          </div>
          <WizardField label="Billing address">
            <textarea className={inputCls} rows={2} value={form.billing_address} onChange={(e) => set("billing_address", e.target.value)} />
          </WizardField>
          <WizardField label="Address line 2" icon="map" filled={!!form.address_line_2.trim()}>
            <input className={inputCls} value={form.address_line_2} onChange={(e) => set("address_line_2", e.target.value)} />
          </WizardField>
          <WizardField label="Delivery address">
            <textarea className={inputCls} rows={2} value={form.delivery_address} onChange={(e) => set("delivery_address", e.target.value)} />
          </WizardField>
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            <WizardField label="City">
              <SearchableSelect
                value={form.city}
                options={optionsFromStrings(INDIAN_CITIES)}
                allowAdd
                searchable
                placeholder="Search city…"
                onChange={(v) => set("city", v)}
              />
            </WizardField>
            <WizardField label="State">
              <SearchableSelect
                value={form.state}
                options={optionsFromStrings(INDIAN_STATES)}
                searchable
                placeholder="Search state…"
                onChange={(v) => set("state", v)}
              />
            </WizardField>
            <WizardField label="Pincode" icon="map" filled={!!form.pincode.trim()}>
              <input className={inputCls} value={form.pincode} onChange={(e) => set("pincode", e.target.value)} maxLength={16} />
            </WizardField>
            <WizardField label="Country">
              <SearchableSelect
                value={form.country || DEFAULT_COUNTRY}
                options={optionsFromStrings(COUNTRIES)}
                allowAdd
                searchable
                placeholder="Search country…"
                onChange={(v) => set("country", v)}
              />
            </WizardField>
            <WizardField label="GSTIN" error={errors.gstin} icon="hash" filled={!!form.gstin.trim() && !errors.gstin}>
              <input className={inputCls} value={form.gstin} onChange={(e) => set("gstin", e.target.value)} maxLength={15} />
            </WizardField>
            <WizardField label="PAN" error={errors.pan} icon="hash" filled={!!form.pan.trim() && !errors.pan}>
              <input className={inputCls} value={form.pan} onChange={(e) => set("pan", e.target.value)} maxLength={10} />
            </WizardField>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-[color:var(--wiz-text)]">
            <input type="checkbox" className="h-4 w-4 accent-sky-600" checked={form.is_primary} onChange={(e) => set("is_primary", e.target.checked)} />
            Primary branch
          </label>
          <div className={wizFooterRow}>
            <button type="button" className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className={`${btnPrimary} btn-gradient ml-auto h-10 rounded-xl px-4`} disabled={saving}>{saving ? "Saving…" : "Save branch"}</button>
          </div>
        </form>
      </WizFormShell>
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
  normal_hours_per_day: number;
};

/** Built-in fallbacks when the customer has no default policy row (mirrors
 * services/timesheets.py BillingPolicy defaults). */
const BUILTIN_DEFAULTS: CustomerDefaults = {
  week_off_billable: false,
  leave_billable: false,
  holidays_billable: false,
  min_hours_full_day: 8,
  min_hours_half_day: 4,
  normal_hours_per_day: 8,
};

/** Billing Type — API enum values with display labels (null = inherit / not set). */
const BILLING_TYPE_CHOICES = [
  { value: "Per_Hour", label: "Per Hour" },
  { value: "Per_Day", label: "Per Day" },
  { value: "Per_Month", label: "Per Month" },
  { value: "Per_Year", label: "Per Year" },
];

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
    working_hours_per_day: "",
    billing_frequency: "",
    billing_type: "",
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
        working_hours_per_day: p.working_hours_per_day != null ? String(p.working_hours_per_day) : "",
        billing_frequency: p.billing_frequency || "",
        billing_type: p.billing_type || "",
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
          normal_hours_per_day: Number(d.normal_hours_per_day ?? 8),
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
    const whpd = numOrNull(form.working_hours_per_day);
    const sd = numOrNull(form.billing_cycle_start_day);
    const ed = numOrNull(form.billing_cycle_end_day);
    if (full != null && (!Number.isFinite(full) || full < 0 || full > 24)) errs.full = "Must be between 0 and 24";
    if (half != null && (!Number.isFinite(half) || half < 0 || half > 24)) errs.half = "Must be between 0 and 24";
    if (whpd != null && (!Number.isFinite(whpd) || whpd < 0 || whpd > 24)) errs.whpd = "Must be between 0 and 24";
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
        working_hours_per_day: whpd,
        billing_frequency: form.billing_frequency || null,
        billing_type: form.billing_type || null,
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {triSelect("weekoff_billable", "Week-offs billable", defaults.week_off_billable)}
            {triSelect("leave_billable", "Leaves billable", defaults.leave_billable)}
            {triSelect("holidays_billable", "Holidays billable", defaults.holidays_billable)}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
            <Field label="Working hours / day" error={errors.whpd}>
              <input
                type="number" step="0.5" min={0} max={24}
                className={inputCls}
                value={form.working_hours_per_day}
                disabled={!canWrite}
                placeholder={`Inherit (${defaults.normal_hours_per_day})`}
                onChange={(e) => set("working_hours_per_day", e.target.value)}
              />
              <p className="mt-1 text-xs text-muted">Feeds &quot;Hours Per Day&quot; in New Opportunity.</p>
              {inheritNote(form.working_hours_per_day === "", `${defaults.normal_hours_per_day} h`)}
              {clearBtn("working_hours_per_day")}
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Billing Type">
              <select
                className={inputCls}
                value={form.billing_type}
                disabled={!canWrite}
                onChange={(e) => set("billing_type", e.target.value)}
              >
                <option value="">— Not set —</option>
                {BILLING_TYPE_CHOICES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {clearBtn("billing_type")}
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
  !!b.billing_type ||
  b.billing_cycle_start_day != null ||
  b.billing_cycle_end_day != null;

function BranchesTab({ customerId, customerName, canWrite, notify }: { customerId: number; customerName?: string | null; canWrite: boolean; notify: Notify }) {
  const [rows, setRows] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<{ initial?: Branch } | null>(null);
  const [wizardRow, setWizardRow] = useState<Branch | null>(null);
  const [policyRow, setPolicyRow] = useState<Branch | null>(null);
  const [deleting, setDeleting] = useState<Branch | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const isAdmin = useHasRole("Admin", "CEO");
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

  const remove = async (force = false) => {
    if (!deleting) return;
    setBusy(true);
    if (!force) setDeleteError(null);
    try {
      const res = await crmDelete(
        `/api/customers/${customerId}/branches/${deleting.id}${force ? "?force=true" : ""}`,
      );
      notify(res.message || "Branch deleted");
      setDeleting(null);
      setDeleteError(null);
      load();
    } catch (e: any) {
      const msg = e?.message || "Failed to delete branch";
      // Referenced by other records: Admin/CEO get a "Delete anyway" action that
      // detaches those records (they keep their data, just lose the branch link).
      if (isAdmin && /referenced/i.test(msg) && !force) setDeleteError(msg);
      else notify(msg, "err");
    } finally {
      setBusy(false);
    }
  };

  /** One branch box: click opens full branch details; corner actions for
   *  view / edit / delete; key fields grouped into labelled cells. */
  const cell = "min-w-0";
  const cellLabel = "text-[10px] font-bold uppercase tracking-wide text-muted";
  const BranchCard = ({ r }: { r: Branch }) => (
    <div
      className="group flex cursor-pointer flex-col rounded-card border border-subtle bg-surface-1 p-4 shadow-raised transition-shadow hover:shadow-overlay"
      role="button"
      tabIndex={0}
      onClick={() => crmNavigate(`branch-policy/${r.id}`)}
      onKeyDown={(e) => { if (e.key === "Enter") crmNavigate(`branch-policy/${r.id}`); }}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-bold text-brand-600 dark:text-brand-300">{r.branch_name}</span>
          {r.is_primary && (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
              Primary
            </span>
          )}
        </div>
        <span className="inline-flex shrink-0 gap-1 opacity-70 transition-opacity group-hover:opacity-100">
          <button className={iconBtn} title="Open branch" aria-label="Open branch"
            onClick={(e) => { e.stopPropagation(); crmNavigate(`branch-policy/${r.id}`); }}>
            <Eye size={15} />
          </button>
          {canWrite && (
            <>
              <button className={iconBtn} title="Edit branch" aria-label="Edit branch"
                onClick={(e) => { e.stopPropagation(); setWizardRow(r); }}>
                <Pencil size={15} />
              </button>
              <button className={`${iconBtn} hover:!text-rose-600`} title="Delete branch" aria-label="Delete branch"
                onClick={(e) => { e.stopPropagation(); setDeleting(r); }}>
                <Trash2 size={15} />
              </button>
            </>
          )}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className={cell}>
          <p className={cellLabel}>Legal name</p>
          <p className="mt-0.5 text-sm font-semibold text-primary">{r.branch_legal_name || "—"}</p>
        </div>
        <div className={cell}>
          <p className={cellLabel}>Location</p>
          <p className="mt-0.5 text-sm text-primary">
            <span className="font-semibold">{r.city || "—"}</span>
            {r.state ? `, ${r.state}` : ""}
          </p>
          {r.pincode && <p className="text-xs text-muted">PIN: {r.pincode}</p>}
        </div>
        <div className={cell}>
          <p className={cellLabel}>Tax identifiers</p>
          <p className="mt-0.5 text-sm text-primary"><span className="text-xs text-muted">GSTIN </span>{r.gstin || "—"}</p>
          <p className="text-sm text-primary"><span className="text-xs text-muted">PAN </span>{r.pan || "—"}</p>
        </div>
        <div className={cell}>
          <p className={cellLabel}>Billing policy</p>
          <button
            className="mt-0.5 inline-flex items-center gap-1.5 rounded-lg border border-subtle px-2 py-1 text-xs font-semibold text-sky-600 hover:bg-surface-2 dark:text-sky-400"
            title="View / edit this branch's billing policy"
            onClick={(e) => { e.stopPropagation(); setPolicyRow(r); }}
          >
            <SlidersHorizontal size={13} />
            {hasOwnPolicy(r) ? "Custom" : "Inherits default"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <input
            className={`${inputCls} !pl-9`}
            placeholder="Search branches…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        </div>
        {canWrite && (
          <button className={btnPrimary} onClick={() => setModal({})}>
            <Plus size={15} /> Add Branch
          </button>
        )}
      </div>
      {error && <div className="mb-3"><ErrorBox error={error} onRetry={load} /></div>}
      {loading ? (
        <Spinner label="Loading branches…" />
      ) : filtered.length === 0 ? (
        <EmptyState message={search ? "No branches match your search" : "No branches yet"} />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {filtered.map((r) => <BranchCard key={r.id} r={r} />)}
        </div>
      )}
      {modal && (
        <BranchFormModal customerId={customerId} initial={modal.initial} onClose={() => setModal(null)} onSaved={load} notify={notify} />
      )}
      {wizardRow && (
        <EditBranchWizard
          customerId={customerId}
          customerName={customerName}
          initial={wizardRow}
          onClose={() => setWizardRow(null)}
          onSaved={load}
          notify={notify}
        />
      )}
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
          message={
            deleteError ? (
              <>
                Delete branch <b>{deleting.branch_name}</b> anyway? Linked contacts,
                opportunities, projects, POs and holidays are kept — they simply lose
                their branch link and can be reassigned later.
              </>
            ) : (
              <>Delete branch <b>{deleting.branch_name}</b>? This cannot be undone.</>
            )
          }
          confirmLabel={deleteError ? "Delete anyway" : "Delete"}
          danger
          busy={busy}
          error={deleteError}
          onConfirm={() => remove(!!deleteError)}
          onClose={() => { setDeleting(null); setDeleteError(null); }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------- default billing policy tab */

/** Customer-level DEFAULT billing policy — branches without their own policy
 * (Branches tab → Billing Policy) inherit these values field-by-field.
 * Week/leave/holiday billability is edited at branch/project level only. */
function BillingPolicyTab({ customerId, canWrite, notify }: { customerId: number; canWrite: boolean; notify: Notify }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [exists, setExists] = useState(false);
  const [form, setForm] = useState({
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
      // Omit week/leave/holiday billable flags so existing DB values are preserved.
      const res = await crmPut(`/api/customers/${customerId}/billing-policy`, {
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
    { key: "designation", label: "Department", render: (r) => r.designation || "—" },
    { key: "role", label: "Role", render: (r) => r.role || "—" },
    { key: "contact_priority", label: "Priority", render: (r) => r.contact_priority || "—" },
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
        <ContactPersonFormModal
          customerId={customerId}
          branches={branches}
          initial={modal.initial}
          onClose={() => setModal(null)}
          onSaved={() => load()}
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
    <Modal
      title={<span className="sr-only">Upload Document</span>}
      onClose={onClose}
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title="Upload Document"
        subtitle="Attach a customer document and tag its type and validity window."
        icon={<Upload size={20} aria-hidden />}
      >
        <div className="space-y-5">
          <WizardField label="Document type" required error={!typeId ? "Select a document type before uploading" : undefined} icon="hash">
            <select className={inputCls} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">— Select type —</option>
              {docTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </WizardField>
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            <WizardField label="Start date" icon="calendar" filled={!!startDate}>
              <input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </WizardField>
            <WizardField label="End date" error={dateError || undefined} icon="calendar" filled={!!endDate && !dateError}>
              <input type="date" className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </WizardField>
          </div>
          <div className={wizFooterRow}>
            <button type="button" className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose}>Cancel</button>
            <div className="ml-auto">
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
                <button type="button" className={`${btnSecondary} h-10 rounded-xl`} disabled>Choose file & upload</button>
              )}
            </div>
          </div>
        </div>
      </WizFormShell>
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
      <CrmBreadcrumb items={[
        { label: "Customers", to: "customers" },
        { label: customer.name },
      ]} />
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
        {tab === "branches" && <BranchesTab customerId={customerId} customerName={customer?.name} canWrite={canWrite} notify={notify} />}
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
