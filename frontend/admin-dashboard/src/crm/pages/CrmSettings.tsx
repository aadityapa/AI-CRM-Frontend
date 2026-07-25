/** CRM Settings (Admin-only): master-data tables (departments, designations,
 * skills, locations, document types, leave policy types) + app settings. */
import React, { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Power, Settings } from "lucide-react";
import { crmGet, crmPost, crmPut, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import {
  ErrorBox, Modal, Spinner, StatusBadge, Tabs,
  btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";
import { SectionHeaderBanner, WizardField } from "../components/wizard";

/** Local single-screen shell — applies the shared New Opportunity wizard look
 * (dark themed body + gradient SectionHeaderBanner) inside the existing Modal.
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
    <div className="crm-wizard wiz-noise min-h-full w-full px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-3xl">
        <SectionHeaderBanner title={title} description={subtitle} icon={icon} />
        {children}
      </div>
    </div>
  );
}

/* Shared footer container for the reskinned single-screen dialogs. */
const wizFooterRow = "mt-6 flex items-center gap-3 border-t border-[color:var(--wiz-border)] pt-5";

type Notify = (msg: string, kind?: "ok" | "err") => void;

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

const iconBtn =
  "rounded-control p-1.5 text-muted hover:bg-surface-2 hover:text-primary";

/* -------------------------------------------------- generic master table */

type Option = { value: string; label: string };

type MasterField = {
  key: string;
  label: string;
  type?: "text" | "checkbox" | "select";
  required?: boolean;
  asNumber?: boolean;
  options?: Option[];
  defaultValue?: string | boolean;
  placeholder?: string;
};

function MasterFormModal({
  endpoint,
  label,
  fields,
  initial,
  onClose,
  onSaved,
  notify,
}: {
  endpoint: string;
  label: string;
  fields: MasterField[];
  initial?: Record<string, any>;
  onClose: () => void;
  onSaved: () => void;
  notify: Notify;
}) {
  const init: Record<string, any> = {};
  for (const f of fields) {
    if (initial) {
      init[f.key] = f.type === "checkbox" ? !!initial[f.key] : initial[f.key] != null ? String(initial[f.key]) : "";
    } else {
      init[f.key] = f.type === "checkbox" ? (f.defaultValue ?? false) : String(f.defaultValue ?? "");
    }
  }
  const [form, setForm] = useState<Record<string, any>>(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    for (const f of fields) {
      if (f.required && f.type !== "checkbox" && !String(form[f.key] ?? "").trim()) {
        errs[f.key] = `${f.label} is required`;
      }
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const payload: Record<string, any> = {};
      for (const f of fields) {
        if (f.type === "checkbox") {
          payload[f.key] = !!form[f.key];
        } else {
          const raw = String(form[f.key] ?? "").trim();
          payload[f.key] = raw === "" ? null : f.asNumber ? Number(raw) : raw;
        }
      }
      const res = initial
        ? await crmPut(`/api/${endpoint}/${initial.id}`, payload)
        : await crmPost(`/api/${endpoint}`, payload);
      notify(res.message || `${label} saved`);
      onSaved();
      onClose();
    } catch (err: any) {
      notify(err?.message || `Failed to save ${label.toLowerCase()}`, "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={<span className="sr-only">{`${initial ? "Edit" : "Add"} ${label}`}</span>}
      onClose={onClose}
      fullScreen
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title={`${initial ? "Edit" : "Add"} ${label}`}
        subtitle={`Manage the ${label.toLowerCase()} master record used across the CRM.`}
        icon={<Settings size={20} aria-hidden />}
      >
        <form onSubmit={submit} className="space-y-5">
          {fields.map((f) =>
            f.type === "checkbox" ? (
              <label key={f.key} className="flex items-center gap-2 text-sm font-semibold text-primary">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-sky-600"
                  checked={!!form[f.key]}
                  onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.checked }))}
                />
                {f.label}
              </label>
            ) : f.type === "select" ? (
              <WizardField key={f.key} label={f.label} required={f.required} error={errors[f.key]}>
                <select
                  className={inputCls}
                  value={form[f.key] ?? ""}
                  onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value }))}
                >
                  <option value="">— None —</option>
                  {(f.options || []).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </WizardField>
            ) : (
              <WizardField key={f.key} label={f.label} required={f.required} error={errors[f.key]} filled={!!String(form[f.key] ?? "").trim() && !errors[f.key]}>
                <input
                  className={inputCls}
                  value={form[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              </WizardField>
            ),
          )}
          <div className={wizFooterRow}>
            <button type="button" className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </WizFormShell>
    </Modal>
  );
}

function MasterTab({
  endpoint,
  label,
  columns,
  fields,
  hasActive,
  notify,
}: {
  endpoint: string;
  label: string;
  columns: Column<any>[];
  fields: MasterField[];
  hasActive?: boolean;
  notify: Notify;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<{ initial?: Record<string, any> } | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const dSearch = useDebounced(search);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<any[]>(`/api/${endpoint}${qs({ page, limit: 20, search: dSearch })}`);
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || `Failed to load ${label.toLowerCase()} list`);
    } finally {
      setLoading(false);
    }
  }, [endpoint, label, page, dSearch]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [dSearch]);

  const toggleActive = async (row: any) => {
    setTogglingId(row.id);
    try {
      const res = await crmPut(`/api/${endpoint}/${row.id}`, { is_active: !row.is_active });
      notify(res.message || `${label} ${row.is_active ? "deactivated" : "activated"}`);
      load();
    } catch (e: any) {
      notify(e?.message || "Failed to update status", "err");
    } finally {
      setTogglingId(null);
    }
  };

  const allColumns: Column<any>[] = [...columns];
  if (hasActive) {
    allColumns.push({
      key: "is_active",
      label: "Status",
      render: (r) => <StatusBadge status={r.is_active ? "Active" : "Inactive"} />,
    });
  }
  allColumns.push({
    key: "_actions",
    label: "",
    className: "text-right",
    render: (r) => (
      <span className="inline-flex gap-1">
        <button className={iconBtn} title={`Edit ${label.toLowerCase()}`} aria-label={`Edit ${label.toLowerCase()}`} onClick={(e) => { e.stopPropagation(); setModal({ initial: r }); }}>
          <Pencil size={15} />
        </button>
        {hasActive && (
          <button
            className={`${iconBtn} ${r.is_active ? "hover:!text-rose-600" : "hover:!text-emerald-600"}`}
            title={r.is_active ? "Deactivate" : "Activate"}
            aria-label={r.is_active ? "Deactivate" : "Activate"}
            disabled={togglingId === r.id}
            onClick={(e) => { e.stopPropagation(); toggleActive(r); }}
          >
            <Power size={15} />
          </button>
        )}
      </span>
    ),
  });

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button className={btnPrimary} onClick={() => setModal({})}>
          <Plus size={15} /> Add {label}
        </button>
      </div>
      {error && <div className="mb-3"><ErrorBox error={error} onRetry={load} /></div>}
      <DataTable
        columns={allColumns}
        rows={rows}
        meta={meta}
        loading={loading}
        search={search}
        onSearch={setSearch}
        onPage={setPage}
        emptyMessage={`No ${label.toLowerCase()} records`}
      />
      {modal && (
        <MasterFormModal
          endpoint={endpoint}
          label={label}
          fields={fields}
          initial={modal.initial}
          onClose={() => setModal(null)}
          onSaved={load}
          notify={notify}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------- app settings */

type SettingRow = { key: string; value: string; description?: string | null };

const THRESHOLD_KEY = "ai_interview_pass_threshold";

function AppSettingsTab({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<SettingRow[]>("/api/settings");
      setRows(res.data || []);
      setEdited({});
      setErrors({});
    } catch (e: any) {
      setError(e?.message || "Failed to load app settings");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const valueOf = (r: SettingRow) => edited[r.key] ?? r.value;

  const save = async (r: SettingRow) => {
    const value = valueOf(r).trim();
    if (r.key === THRESHOLD_KEY) {
      const n = Number(value);
      if (value === "" || !Number.isFinite(n) || n < 0 || n > 100) {
        setErrors((e) => ({ ...e, [r.key]: "Must be a number between 0 and 100" }));
        return;
      }
    }
    setErrors((e) => ({ ...e, [r.key]: "" }));
    setSavingKey(r.key);
    try {
      const res = await crmPut(`/api/settings/${encodeURIComponent(r.key)}`, { value });
      notify(res.message || `Setting '${r.key}' saved`);
      setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, value } : x)));
      setEdited((e) => {
        const next = { ...e };
        delete next[r.key];
        return next;
      });
    } catch (e: any) {
      notify(e?.message || "Failed to save setting", "err");
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) return <Spinner label="Loading settings…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!rows.length) return <div className="py-10 text-center text-sm text-muted">No app settings found</div>;

  return (
    <div className="rounded-card border border-subtle bg-surface-1 shadow-raised">
      {rows.map((r) => {
        const isThreshold = r.key === THRESHOLD_KEY;
        const dirty = edited[r.key] !== undefined && edited[r.key] !== r.value;
        return (
          <div
            key={r.key}
            className={`flex flex-wrap items-start gap-3 border-b border-subtle px-4 py-3.5 last:border-b-0 ${
              isThreshold ? "bg-sky-50/70 dark:bg-sky-950/30" : ""
            }`}
          >
            <div className="min-w-56 flex-1">
              <div className="text-sm font-bold text-primary">
                {r.key}
                {isThreshold && (
                  <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                    AI interview pass threshold
                  </span>
                )}
              </div>
              {r.description && <div className="mt-0.5 text-xs text-muted">{r.description}</div>}
              {errors[r.key] && <div className="mt-1 text-xs text-rose-600">{errors[r.key]}</div>}
            </div>
            <div className="flex items-center gap-2">
              {isThreshold ? (
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className={`${inputCls} !w-32 pr-7`}
                    value={valueOf(r)}
                    onChange={(e) => setEdited((v) => ({ ...v, [r.key]: e.target.value }))}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">%</span>
                </div>
              ) : (
                <input
                  className={`${inputCls} !w-64`}
                  value={valueOf(r)}
                  onChange={(e) => setEdited((v) => ({ ...v, [r.key]: e.target.value }))}
                />
              )}
              <button className={btnPrimary} disabled={!dirty || savingKey === r.key} onClick={() => save(r)}>
                {savingKey === r.key ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- page */

export function CrmSettingsPage() {
  const isAdmin = useHasRole();
  const [toast, notify] = useToast();
  const [tab, setTab] = useState("departments");
  const [deptOptions, setDeptOptions] = useState<Option[]>([]);

  useEffect(() => {
    if (!isAdmin || tab !== "designations") return;
    crmGet<any[]>(`/api/departments${qs({ limit: 200 })}`)
      .then((res) => setDeptOptions((res.data || []).map((d: any) => ({ value: String(d.id), label: d.name }))))
      .catch(() => setDeptOptions([]));
  }, [isAdmin, tab]);

  if (!isAdmin) {
    return <ErrorBox error="Access denied: the Settings page is available to Admins only." />;
  }

  const deptName = (id?: number | null) => deptOptions.find((o) => o.value === String(id))?.label || (id ? `#${id}` : "—");

  return (
    <div>
      {toast}
      <h1 className="text-display mb-4 text-xl font-bold text-primary">Settings</h1>
      <Tabs
        tabs={[
          { key: "departments", label: "Departments" },
          { key: "designations", label: "Designations" },
          { key: "skills", label: "Skills" },
          { key: "locations", label: "Locations" },
          { key: "document-types", label: "Document Types" },
          { key: "leave-policy-types", label: "Leave Policy Types" },
          { key: "app-settings", label: "App Settings" },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="mt-4">
        {tab === "departments" && (
          <MasterTab
            endpoint="departments"
            label="Department"
            hasActive
            notify={notify}
            columns={[{ key: "name", label: "Name", render: (r) => <span className="font-semibold text-primary">{r.name}</span> }]}
            fields={[
              { key: "name", label: "Name", required: true },
              { key: "is_active", label: "Active", type: "checkbox", defaultValue: true },
            ]}
          />
        )}
        {tab === "designations" && (
          <MasterTab
            endpoint="designations"
            label="Designation"
            hasActive
            notify={notify}
            columns={[
              { key: "name", label: "Name", render: (r) => <span className="font-semibold text-primary">{r.name}</span> },
              { key: "department_id", label: "Department", render: (r) => deptName(r.department_id) },
            ]}
            fields={[
              { key: "name", label: "Name", required: true },
              { key: "department_id", label: "Department", type: "select", asNumber: true, options: deptOptions },
              { key: "is_active", label: "Active", type: "checkbox", defaultValue: true },
            ]}
          />
        )}
        {tab === "skills" && (
          <MasterTab
            endpoint="skills"
            label="Skill"
            hasActive
            notify={notify}
            columns={[
              { key: "name", label: "Name", render: (r) => <span className="font-semibold text-primary">{r.name}</span> },
              { key: "category", label: "Category", render: (r) => r.category || "—" },
            ]}
            fields={[
              { key: "name", label: "Name", required: true },
              { key: "category", label: "Category", placeholder: "e.g. Backend, Cloud, QA" },
              { key: "is_active", label: "Active", type: "checkbox", defaultValue: true },
            ]}
          />
        )}
        {tab === "locations" && (
          <MasterTab
            endpoint="locations"
            label="Location"
            notify={notify}
            columns={[
              { key: "city", label: "City", render: (r) => <span className="font-semibold text-primary">{r.city}</span> },
              { key: "state", label: "State", render: (r) => r.state || "—" },
              { key: "country", label: "Country" },
            ]}
            fields={[
              { key: "city", label: "City", required: true },
              { key: "state", label: "State" },
              { key: "country", label: "Country", required: true, defaultValue: "India" },
            ]}
          />
        )}
        {tab === "document-types" && (
          <MasterTab
            endpoint="document-types"
            label="Document Type"
            hasActive
            notify={notify}
            columns={[{ key: "name", label: "Name", render: (r) => <span className="font-semibold text-primary">{r.name}</span> }]}
            fields={[
              { key: "name", label: "Name", required: true },
              { key: "is_active", label: "Active", type: "checkbox", defaultValue: true },
            ]}
          />
        )}
        {tab === "leave-policy-types" && (
          <MasterTab
            endpoint="leave-policy-types"
            label="Leave Policy Type"
            notify={notify}
            columns={[
              { key: "name", label: "Name", render: (r) => <span className="font-semibold text-primary">{r.name}</span> },
              { key: "accrual_rule", label: "Accrual Rule", render: (r) => r.accrual_rule || "—" },
              { key: "carry_forward_rule", label: "Carry-Forward Rule", render: (r) => r.carry_forward_rule || "—" },
            ]}
            fields={[
              { key: "name", label: "Name", required: true },
              { key: "accrual_rule", label: "Accrual rule", placeholder: "e.g. 1.5 days per month" },
              { key: "carry_forward_rule", label: "Carry-forward rule", placeholder: "e.g. Max 10 days per year" },
            ]}
          />
        )}
        {tab === "app-settings" && <AppSettingsTab notify={notify} />}
      </div>
    </div>
  );
}
