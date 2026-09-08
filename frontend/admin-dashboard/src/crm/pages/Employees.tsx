/** HR module pages: employee directory + detail master form ("Tab 13: Employees").
 * Detail = sectioned glass cards with per-section Edit → Save (dirty-tracked):
 * Employee Details / Addresses / Education / Experience / Projects / Office /
 * Separation / Leave Balances (matrix + editable upsert) / Attendance Rule.
 * Writes: HR (Admin implicit). Reads open to page viewers. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Briefcase, Building2, CalendarDays, ClipboardCheck, GraduationCap, LogOut, Mail,
  Pencil, Plus, Save, Trash2, User, X,
} from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut, crmUpload, qs, type Meta } from "../api";
import { fetchAllMaster } from "../lib/fetchAllMaster";
import { useHasRole } from "../CrmApp";
import { useCanAct, useCrmAccess } from "../useAccess";
import { CrmLink, crmNavigate, useCrmParams } from "../routerHooks";
import { DataTable, type Column } from "../components/DataTable";
import { RowActions, afterListDelete } from "../components/RowActions";
import { EmployeeHistoryTab } from "./EmployeeHistory";
import { FileLink, FileUploadButton } from "../components/FileUpload";
import {
  btnPrimary, btnSecondary, ConfirmModal, EmptyState, ErrorBox, Field, inputCls,
  Modal, Spinner, StatusBadge, Tabs, useToast,
} from "../components/ui";
import { TeachingEmpty } from "../components/TeachingEmpty";
import { WizardAurora } from "../components/WizardAurora";
import { SearchableSelect, optionsFromStrings } from "../components/SearchableSelect";
import {
  COUNTRIES, DEFAULT_COUNTRY, INDIAN_CITIES, INDIAN_STATES,
} from "../constants/geo";
import {
  StepperRail, SectionHeaderBanner, WizardField, WizardFooter, WizardStepProgress, WizardStepCard,
  InfoChip, type WizardStep,
} from "../components/wizard";

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

/* ---------------------------------------------------------------- helpers */

/* Mirrors motion tokens in src/styles/tokens.css (framer-motion needs numbers). */
const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
const focusRing = "focus-visible:outline-none focus-visible:shadow-focus-ring";

type ShowToast = (msg: string, kind?: "ok" | "err") => void;

const fmtDate = (d?: string | null): string => (d ? new Date(d).toLocaleDateString("en-IN") : "—");

const num = (s: string): number | undefined => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
};

/** Trimmed string or null (for optional API string fields). */
const sOrNull = (v: string): string | null => {
  const t = v.trim();
  return t ? t : null;
};

const TITLES = ["Mr", "Ms", "Mrs", "Dr"];
const GENDERS = ["Male", "Female", "Other"];
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const EMPLOYMENT_TYPES = [
  { value: "Full_Time", label: "Full Time" },
  { value: "Part_Time", label: "Part Time" },
  { value: "Contract", label: "Contract" },
];
const empTypeLabel = (v?: string | null): string =>
  EMPLOYMENT_TYPES.find((t) => t.value === v)?.label || (v ? String(v).replace(/_/g, " ") : "—");

/** id → name map from a CRM list endpoint. */
function useNameMap(path: string): Record<number, string> {
  const [map, setMap] = useState<Record<number, string>>({});
  useEffect(() => {
    let alive = true;
    crmGet<any[]>(path)
      .then((r) => {
        if (!alive) return;
        const m: Record<number, string> = {};
        (r.data || []).forEach((x: any) => { m[x.id] = x.name; });
        setMap(m);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [path]);
  return map;
}

function TypeBadge({ type }: { type?: string | null }) {
  if (!type) return null;
  const cls =
    type === "Internal"
      ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
      : "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{type}</span>;
}

function InfoItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-sm text-primary">{children ?? "—"}</div>
    </div>
  );
}

const chipCls =
  "inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-secondary ring-1 ring-inset ring-black/5 dark:ring-white/10";

/** Accessible on/off switch (brand fill when on, focus ring per tokens). */
function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-base ease-smooth ${focusRing} ${
        checked ? "bg-brand-600" : "bg-surface-2 ring-1 ring-inset ring-black/10 dark:ring-white/15"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-base ease-smooth ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
        aria-hidden
      />
    </button>
  );
}

/* ---------------------------------------------------- section scaffolding */

/** Glass E1 section card (text-heavy → no sheen per DEPTH_SYSTEM) with a
 * per-section Edit → Save/Cancel header. Save disabled until dirty. */
function SectionCard({
  title,
  canWrite,
  editing,
  dirty,
  busy,
  onEdit,
  onCancel,
  onSave,
  headerExtra,
  children,
}: {
  title: string;
  canWrite?: boolean;
  editing?: boolean;
  dirty?: boolean;
  busy?: boolean;
  onEdit?: () => void;
  onCancel?: () => void;
  onSave?: () => void;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      className="overflow-hidden rounded-card border border-subtle bg-surface-1"
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
    >
      <div className="fx-hairline-b flex flex-wrap items-center justify-between gap-2 px-5 py-3">
        <h2 className="text-sm font-bold text-primary">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {headerExtra}
          {canWrite && onEdit && !editing && (
            <button className={btnSecondary} onClick={onEdit}>
              <Pencil size={14} /> Edit
            </button>
          )}
          {canWrite && editing && (
            <>
              <button className={btnSecondary} onClick={onCancel} disabled={busy}>
                <X size={14} /> Cancel
              </button>
              <button className={btnPrimary} onClick={onSave} disabled={busy || !dirty} title={dirty ? undefined : "No changes yet"}>
                <Save size={14} /> {busy ? "Saving…" : "Save"}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
    </motion.section>
  );
}

/** Draft state with dirty tracking for edit-in-place sections. */
function useDraft<T extends object>(makeSeed: () => T) {
  const [draft, setDraft] = useState<T | null>(null);
  const seedRef = useRef("");
  const begin = () => {
    const seed = makeSeed();
    seedRef.current = JSON.stringify(seed);
    setDraft(seed);
  };
  const cancel = () => setDraft(null);
  const patch = (p: Partial<T>) => setDraft((d) => (d == null ? d : { ...d, ...p }));
  const dirty = draft != null && JSON.stringify(draft) !== seedRef.current;
  return { draft, begin, cancel, patch, setDraft, dirty, editing: draft != null };
}

/** PUT a partial employee payload; toast + reload on success. */
function useEmployeeSave(employeeId: number | string, onSaved: () => void, showToast: ShowToast) {
  const [busy, setBusy] = useState(false);
  const save = async (payload: any, okMsg = "Saved"): Promise<boolean> => {
    setBusy(true);
    try {
      await crmPut(`/api/employees/${employeeId}`, payload);
      showToast(okMsg);
      onSaved();
      return true;
    } catch (e: any) {
      showToast(e?.message || "Failed to save", "err");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, save };
}

/* Plain table styles for subform tables (inside a glass section → no nested glass). */
const thCls = "px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-muted";
const tdCls = "px-3 py-2.5 align-top text-secondary";
const rowCls = "border-b border-subtle";
const iconBtnCls = `btn-depth rounded-control p-1.5 text-secondary disabled:cursor-not-allowed`;

/* ---------------------------------------------------------- skills input */

/** Multi-chip skills editor backed by /api/skills suggestions; stores string[]. */
function SkillsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [all, setAll] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetchAllMaster<any>("/api/skills", { is_active: true })
      .then((rows) => setAll(rows.map((s: any) => s?.name).filter(Boolean)))
      .catch(() => {});
  }, []);

  const has = (s: string) => value.some((v) => v.toLowerCase() === s.toLowerCase());
  const add = (s: string) => {
    const t = s.trim();
    if (!t) return;
    if (!has(t)) onChange([...value, t]);
    setQ("");
  };
  const remove = (s: string) => onChange(value.filter((v) => v !== s));

  const suggestions = all
    .filter((s) => !has(s) && (!q || s.toLowerCase().includes(q.toLowerCase())))
    .slice(0, 8);

  return (
    <div className="relative">
      <div className="input-recessed flex w-full flex-wrap items-center gap-1.5 rounded-control px-2 py-1.5">
        {value.map((s) => (
          <span key={s} className={chipCls}>
            {s}
            <button
              type="button"
              className={`rounded-full text-muted hover:text-danger ${focusRing}`}
              onClick={() => remove(s)}
              aria-label={`Remove ${s}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm text-primary placeholder:text-muted focus:outline-none"
          placeholder={value.length ? "Add skill…" : "Type to add skills…"}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); add(q); }
            else if (e.key === "Backspace" && !q && value.length) remove(value[value.length - 1]);
          }}
        />
      </div>
      {open && suggestions.length > 0 && (
        <div className="elev-3 absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-card py-1">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className={`block w-full px-3 py-1.5 text-left text-sm text-secondary transition-colors duration-fast ease-smooth hover:bg-surface-2 hover:text-primary ${focusRing}`}
              onMouseDown={(e) => { e.preventDefault(); add(s); }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* =====================================================================
 * Employee create modal (full editing lives on the detail master form)
 * =================================================================== */

function EmployeeFormModal({
  initial,
  onClose,
  onSaved,
  onError,
}: {
  initial?: any;
  onClose: () => void;
  onSaved: (emp: any) => void;
  onError: (msg: string) => void;
}) {
  const [departments, setDepartments] = useState<any[]>([]);
  const [designations, setDesignations] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);

  const [firstName, setFirstName] = useState(initial?.first_name || "");
  const [lastName, setLastName] = useState(initial?.last_name || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [employeeCode, setEmployeeCode] = useState(initial?.employee_code || "");
  const [deptId, setDeptId] = useState(initial?.department_id ? String(initial.department_id) : "");
  const [desigId, setDesigId] = useState(initial?.designation_id ? String(initial.designation_id) : "");
  const [managerId, setManagerId] = useState(initial?.reporting_manager_id ? String(initial.reporting_manager_id) : "");
  const [profileType, setProfileType] = useState(initial?.profile_type || "Internal");
  const [portalAccess, setPortalAccess] = useState(Boolean(initial?.portal_access));
  const [doj, setDoj] = useState(initial?.date_of_joining || "");
  const [pan, setPan] = useState(initial?.pan || "");
  const [aadhar, setAadhar] = useState(initial?.aadhar || "");
  const [isActive, setIsActive] = useState(initial ? Boolean(initial.is_active) : true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    crmGet<any[]>("/api/departments?limit=100").then((r) => setDepartments(r.data || [])).catch(() => {});
    crmGet<any[]>("/api/designations?limit=100").then((r) => setDesignations(r.data || [])).catch(() => {});
    crmGet<any[]>("/api/employees?is_active=true&limit=100").then((r) => setManagers(r.data || [])).catch(() => {});
  }, []);

  const submit = async () => {
    if (!firstName.trim()) { setErr("First name is required"); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setErr("A valid official email is required"); return; }
    setErr("");
    setBusy(true);
    try {
      const payload: any = {
        first_name: firstName.trim(),
        last_name: lastName.trim() || null,
        email: email.trim(),
        phone: phone.trim() || null,
        employee_code: employeeCode.trim() || null,
        department_id: deptId ? Number(deptId) : null,
        designation_id: desigId ? Number(desigId) : null,
        reporting_manager_id: managerId ? Number(managerId) : null,
        profile_type: profileType,
        portal_access: portalAccess,
        date_of_joining: doj || null,
        pan: pan.trim() || null,
        aadhar: aadhar.trim() || null,
      };
      if (initial) payload.is_active = isActive;
      const res = initial
        ? await crmPut(`/api/employees/${initial.id}`, payload)
        : await crmPost("/api/employees", payload);
      onSaved(res.data);
    } catch (e: any) {
      const msg = e?.message || "Failed to save employee";
      setErr(msg);          // inline — e.g. 409 "email already exists"
      onError(msg);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={initial ? "Edit Employee" : "New Employee"}
      onClose={onClose}
      wide
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      panelClassName="wiz-moonlit-panel"
      headerClassName="wiz-moonlit-header"
      bodyClassName="relative !overflow-hidden !p-0 sm:!px-0 sm:!py-0"
    >
      <div className="wiz-moonlit-shell relative flex h-full min-h-0 flex-col">
        <WizardAurora />
        <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-8 sm:py-6">
          <div className="mx-auto w-full max-w-3xl">
            <div className="wiz-moonlit-form-card rounded-card border border-subtle bg-surface-1 px-5 py-6 shadow-raised sm:px-8 sm:py-8">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="First name" required>
                  <input className={inputCls} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </Field>
                <Field label="Last name">
                  <input className={inputCls} value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </Field>
                <Field label="Email (Official)" required>
                  <input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
                <Field label="Phone">
                  <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
                </Field>
                <Field label="Employee ID">
                  <input className={inputCls} value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} placeholder="e.g. KRX-0042" />
                </Field>
                <Field label="Date of joining">
                  <input type="date" className={inputCls} value={doj} onChange={(e) => setDoj(e.target.value)} />
                </Field>
                <Field label="Department">
                  <select className={inputCls} value={deptId} onChange={(e) => setDeptId(e.target.value)}>
                    <option value="">—</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Field>
                <Field label="Designation">
                  <select className={inputCls} value={desigId} onChange={(e) => setDesigId(e.target.value)}>
                    <option value="">—</option>
                    {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Field>
                <Field label="Reporting manager">
                  <select className={inputCls} value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                    <option value="">—</option>
                    {managers
                      .filter((m) => !initial || m.id !== initial.id)
                      .map((m) => <option key={m.id} value={m.id}>{m.full_name || `${m.first_name} ${m.last_name || ""}`}</option>)}
                  </select>
                </Field>
                <Field label="Profile type">
                  <select className={inputCls} value={profileType} onChange={(e) => setProfileType(e.target.value)}>
                    <option value="Internal">Internal</option>
                    <option value="External">External</option>
                  </select>
                </Field>
                <div className="flex items-end gap-4 pb-1.5">
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-secondary">
                    <input type="checkbox" checked={portalAccess} onChange={(e) => setPortalAccess(e.target.checked)} />
                    Portal access
                  </label>
                  {initial && (
                    <label className="inline-flex items-center gap-2 text-sm font-semibold text-secondary">
                      <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                      Active
                    </label>
                  )}
                </div>
                <Field label="PAN">
                  <input className={inputCls} value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} maxLength={10} placeholder="ABCDE1234F" />
                </Field>
                <Field label="Aadhar">
                  <input className={inputCls} value={aadhar} onChange={(e) => setAadhar(e.target.value)} maxLength={12} placeholder="12-digit number" />
                </Field>
              </div>
              <p className="mt-3 text-xs text-muted">Full profile (addresses, education, experience, office & leave details) is edited on the employee page after creation.</p>
              {err && <div className="mt-2 text-sm text-danger">{err}</div>}
              <div className="mt-5 flex justify-end gap-2">
                <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
                <button className={btnPrimary} onClick={submit} disabled={busy}>
                  {busy ? "Saving…" : initial ? "Save Changes" : "Create Employee"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* =====================================================================
 * Employees — list
 * =================================================================== */

/** "All" first and default (26 Aug 2026, user decision): after the directory
 * import, 191 of 288 people are Relieved — hiding them behind a second tab
 * made the directory look two-thirds empty. */
const EMP_TABS = [
  { key: "All", label: "All" },
  { key: "Active", label: "Working" },
  { key: "Inactive", label: "Relieved / Inactive" },
];

export function EmployeesListPage() {
  /* Both hooks must run unconditionally (rules-of-hooks) — combine after. */
  const canWriteRole = useHasRole("HR");
  const canWrite = useCanAct("employees", "edit", canWriteRole);
  const [tab, setTab] = useState("All");
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, showToast] = useToast();
  const departments = useNameMap("/api/departments?limit=100");
  const designations = useNameMap("/api/designations?limit=100");
  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  /** Authenticated xlsx download (Export / template) — same blob pattern as
   * the report CSVs; a plain <a href> would miss the bearer token. */
  const downloadXlsx = async (url: string, filename: string) => {
    const { authFetch } = await import("../../api/client");
    const res = await authFetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  };

  const exportEmployees = async () => {
    setExporting(true);
    try {
      await downloadXlsx("/api/employees/export", "employees.xlsx");
      showToast("Employees exported");
    } catch (e: any) {
      showToast(e?.message || "Export failed", "err");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = window.setTimeout(() => {
      crmGet<any[]>(`/api/employees${qs({
        is_active: tab === "All" ? undefined : tab === "Active",
        department_id: deptFilter || undefined,
        profile_type: typeFilter || undefined,
        search,
        page,
        limit: 20,
      })}`)
        .then((r) => { if (alive) { setRows(r.data || []); setMeta(r.meta); setError(""); } })
        .catch((e) => { if (alive) setError(e?.message || "Failed to load employees"); })
        .finally(() => { if (alive) setLoading(false); });
    }, search ? 300 : 0);
    return () => { alive = false; window.clearTimeout(t); };
  }, [tab, search, deptFilter, typeFilter, page, reloadKey]);

  const columns: Column<any>[] = [
    { key: "full_name", label: "Name", render: (r) => <span className="font-semibold">{r.full_name}</span> },
    { key: "email", label: "Email" },
    { key: "department", label: "Department", render: (r) => (r.department_id ? departments[r.department_id] || `#${r.department_id}` : "—") },
    { key: "designation", label: "Designation", render: (r) => (r.designation_id ? designations[r.designation_id] || `#${r.designation_id}` : "—") },
    { key: "profile_type", label: "Type", render: (r) => <TypeBadge type={r.profile_type} /> },
    { key: "date_of_joining", label: "DOJ", render: (r) => fmtDate(r.date_of_joining) },
    { key: "is_active", label: "Status", render: (r) => <StatusBadge status={r.is_active ? "Active" : "Inactive"} /> },
  ];

  const filters = (
    <>
      <select className={`${inputCls} !w-44`} value={deptFilter} onChange={(e) => { setDeptFilter(e.target.value); setPage(1); }}>
        <option value="">All departments</option>
        {Object.entries(departments).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
      <select className={`${inputCls} !w-36`} value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
        <option value="">All types</option>
        <option value="Internal">Internal</option>
        <option value="External">External</option>
      </select>
    </>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-display text-lg font-bold text-primary">Employees</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button className={btnSecondary} onClick={exportEmployees} disabled={exporting}>
            {exporting ? "Exporting…" : "Export"}
          </button>
          {canWrite && (
            <button className={btnSecondary} onClick={() => setShowBulk(true)}>
              Bulk upload
            </button>
          )}
          {canWrite && (
            <button className={btnPrimary} onClick={() => setShowNew(true)}>
              <Plus size={15} /> New Employee
            </button>
          )}
        </div>
      </div>
      <Tabs tabs={EMP_TABS} active={tab} onChange={(k) => { setTab(k); setPage(1); }} />
      {error && <ErrorBox error={error} />}
      <DataTable
        columns={columns}
        rows={rows}
        meta={meta}
        headerRight={meta ? <span className="whitespace-nowrap text-xs font-medium text-muted">{meta.total} {meta.total === 1 ? "employee" : "employees"}, page {meta.page}/{Math.max(1, meta.pages || 1)}</span> : undefined}
        loading={loading}
        search={search}
        onSearch={(q) => { setSearch(q); setPage(1); }}
        onPage={setPage}
        onRowClick={(r) => crmNavigate(`employees/${r.id}`)}
        filters={filters}
        emptyMessage={<TeachingEmpty page="employees" />}
        rowActions={canWrite ? (r) => (
          <RowActions
            entity="employee"
            itemLabel={r.full_name}
            onView={() => crmNavigate(`employees/${r.id}`)}
            onEdit={() => crmNavigate(`employees/${r.id}`)}
            deleteUrl={`/api/employees/${r.id}`}
            onDeleted={() => afterListDelete(r.id, setRows, load)}
            notify={showToast}
            canEdit
            canDelete
            onDeactivate={
              r.is_active
                ? async () => {
                    await crmPut(`/api/employees/${r.id}`, { is_active: false });
                  }
                : undefined
            }
            deactivateSuccessMessage="Employee deactivated"
          colored />
        ) : undefined}
      />
      {showNew && (
        <EmployeeFormModal
          onClose={() => setShowNew(false)}
          onSaved={(emp) => { setShowNew(false); showToast("Employee created"); crmNavigate(`employees/${emp.id}`); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
      {showBulk && (
        <BulkEmployeeUploadModal
          onClose={() => setShowBulk(false)}
          onDone={() => load()}
          onTemplate={() => downloadXlsx("/api/employees/import-template", "employee-import-template.xlsx")}
          notify={showToast}
        />
      )}
      {toast}
    </div>
  );
}

/* =====================================================================
 * Bulk upload (Excel) — download template, fill, upload, review results
 * =================================================================== */

type BulkResult = {
  created: { row: number; id: number; label: string }[];
  skipped: { row: number; label: string; reason: string }[];
  failed: { row: number; label: string; error: string }[];
  summary: string;
};

function BulkEmployeeUploadModal({ onClose, onDone, onTemplate, notify }: {
  onClose: () => void;
  onDone: () => void;
  onTemplate: () => Promise<void>;
  notify: (msg: string, kind?: "ok" | "err") => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await crmUpload<BulkResult>("/api/employees/bulk-import", file);
      setResult(res.data);
      notify(res.message || res.data?.summary || "Import complete",
             (res.data?.failed?.length ?? 0) > 0 ? "err" : "ok");
      onDone();
    } catch (e: any) {
      notify(e?.message || "Import failed", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Bulk upload employees" onClose={onClose} wide>
      {!result ? (
        <div className="space-y-4">
          <div className="rounded-card border border-subtle bg-surface-2/40 p-4 text-sm text-secondary">
            <div className="font-semibold text-primary">How it works</div>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>
                <button type="button" className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
                  onClick={() => onTemplate().catch((e: any) => notify(e?.message || "Download failed", "err"))}>
                  Download the Excel template
                </button>{" "}
                — every employee field, plus a Reference sheet listing valid
                departments, designations and manager codes.
              </li>
              <li>Fill one row per employee. Only First Name and Email are required.</li>
              <li>Upload the file here. Existing emails are skipped, never overwritten;
                a bad row fails alone with the reason.</li>
            </ol>
          </div>
          <input
            type="file"
            accept=".xlsx"
            className="block w-full text-sm text-secondary file:mr-3 file:rounded-control file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-700"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <div className="flex justify-end gap-2">
            <button className={btnSecondary} onClick={onClose}>Cancel</button>
            <button className={btnPrimary} onClick={upload} disabled={!file || busy}>
              {busy ? "Importing…" : "Upload & import"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-sm font-bold text-primary">{result.summary}</div>
          {result.created.length > 0 && (
            <div>
              <div className="text-xs font-bold uppercase text-success">Created ({result.created.length})</div>
              <ul className="mt-1 space-y-0.5 text-sm text-secondary">
                {result.created.map((r) => (
                  <li key={r.row}>
                    Row {r.row}:{" "}
                    <CrmLink to={`employees/${r.id}`} className="font-semibold text-brand-600 hover:underline dark:text-brand-300">
                      {r.label}
                    </CrmLink>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.skipped.length > 0 && (
            <div>
              <div className="text-xs font-bold uppercase text-warning">Skipped ({result.skipped.length})</div>
              <ul className="mt-1 space-y-0.5 text-sm text-secondary">
                {result.skipped.map((r) => <li key={r.row}>Row {r.row}: {r.label} — {r.reason}</li>)}
              </ul>
            </div>
          )}
          {result.failed.length > 0 && (
            <div>
              <div className="text-xs font-bold uppercase text-danger">Failed ({result.failed.length})</div>
              <ul className="mt-1 space-y-0.5 text-sm text-secondary">
                {result.failed.map((r) => <li key={r.row}>Row {r.row}: {r.label} — <span className="text-danger">{r.error}</span></li>)}
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button className={btnSecondary} onClick={() => { setResult(null); setFile(null); }}>
              Upload another file
            </button>
            <button className={btnPrimary} onClick={onClose}>Done</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* =====================================================================
 * Employee — detail (master form)
 * =================================================================== */

const DETAIL_TABS = [
  { key: "profile", label: "Profile" },
  { key: "employee_history", label: "History" },
  { key: "history", label: "Project History" },
];

export function EmployeeDetailPage() {
  const { id } = useCrmParams();
  /* Both hooks must run unconditionally (rules-of-hooks) — combine after. */
  const canWriteRole = useHasRole("HR");
  const canWrite = useCanAct("employees", "edit", canWriteRole);
  const [emp, setEmp] = useState<any | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("profile");
  /* Lazy-load flag: the 360° History view mounts (and fetches) only on first
   * open, then stays mounted (hidden) so switching tabs doesn't refetch. */
  const [historyOpened, setHistoryOpened] = useState(false);
  const [toast, showToast] = useToast();

  const load = () => {
    crmGet<any>(`/api/employees/${id}`)
      .then((r) => { setEmp(r.data); setError(""); })
      .catch((e) => setError(e?.message || "Failed to load employee"));
  };
  useEffect(load, [id]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!emp) return <Spinner label="Loading employee…" />;

  const common = { emp, canWrite, onSaved: load, showToast };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <CrmLink to="employees" className={`rounded-control text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300 ${focusRing}`}>Employees</CrmLink>
        <span className="text-muted">/</span>
        <h1 className="text-display text-lg font-bold text-primary">{emp.full_name}</h1>
        {emp.employee_code && <span className={chipCls}>{emp.employee_code}</span>}
        <TypeBadge type={emp.profile_type} />
        <StatusBadge status={emp.is_active ? "Active" : "Inactive"} />
        {(emp.is_exit || emp.is_resigned) && <StatusBadge status="Exited" />}
      </div>

      <Tabs
        tabs={DETAIL_TABS}
        active={tab}
        onChange={(k) => {
          setTab(k);
          if (k === "employee_history") setHistoryOpened(true);
        }}
      />

      {tab === "profile" && <EmployeeProfileWizard {...common} />}

      {historyOpened && (
        <div className={tab === "employee_history" ? undefined : "hidden"}>
          <EmployeeHistoryTab employeeId={Number(id)} />
        </div>
      )}

      {tab === "history" && <ProjectHistoryTab employeeId={Number(id)} />}

      {toast}
    </div>
  );
}

type SectionProps = { emp: any; canWrite: boolean; onSaved: () => void; showToast: ShowToast };

/* ------------------------------------------ Profile master form as a wizard */

/** Read-only summary shown on the final wizard step. */
function EmployeeReviewStep({ emp }: { emp: any }) {
  const name = emp.full_name || `${emp.first_name || ""} ${emp.last_name || ""}`.trim();
  return (
    <div className="space-y-4">
      <InfoChip>
        Each section saves independently as you edit — there is no combined submit. Review the key
        details below, then choose Done.
      </InfoChip>
      <div className="rounded-2xl border border-[color:var(--wiz-border)] bg-[color:var(--wiz-card)] p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          <InfoItem label="Name">{name || "—"}</InfoItem>
          <InfoItem label="Employee ID">{emp.employee_code || "—"}</InfoItem>
          <InfoItem label="Email (Official)">{emp.email || "—"}</InfoItem>
          <InfoItem label="Phone">{emp.phone || "—"}</InfoItem>
          <InfoItem label="Department">{emp.department_name || "—"}</InfoItem>
          <InfoItem label="Designation">{emp.designation_name || "—"}</InfoItem>
          <InfoItem label="Profile type">{emp.profile_type || "—"}</InfoItem>
          <InfoItem label="Status">{emp.is_active ? "Active" : "Inactive"}</InfoItem>
          <InfoItem label="Date of joining">{fmtDate(emp.date_of_joining)}</InfoItem>
          <InfoItem label="Reporting manager">{emp.reporting_manager_name || "—"}</InfoItem>
          <InfoItem label="Portal access">{emp.portal_access ? "Yes" : "No"}</InfoItem>
          <InfoItem label="Resigned">{emp.is_resigned ? "Yes" : "No"}</InfoItem>
        </div>
      </div>
    </div>
  );
}

/** Re-skins the profile master form as a premium multi-step wizard (New
 *  Opportunity look). Each step hosts the EXISTING section component(s)
 *  unchanged — per-section Edit → Save (useDraft) plus every data/validation/
 *  API wire (incl. CV & certificate upload) is preserved. Previous/Next only
 *  navigate; there is no combined submit. */
function EmployeeProfileWizard({ emp, canWrite, onSaved, showToast }: SectionProps) {
  const reduce = useReducedMotion();
  const [stepIndex, setStepIndex] = useState(0);
  const [stepDir, setStepDir] = useState<1 | -1>(1);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const steps = useMemo(
    () => [
      {
        key: "identity",
        title: "Identity & Personal",
        description: "Name, contact numbers, identifiers, CTC, and CV for this employee.",
        icon: <User size={20} aria-hidden />,
        render: () => (
          <EmployeeDetailsSection emp={emp} canWrite={canWrite} onSaved={onSaved} showToast={showToast} />
        ),
      },
      {
        key: "contact",
        title: "Contact & Address",
        description: "Present and permanent addresses with correspondence details.",
        icon: <Mail size={20} aria-hidden />,
        render: () => (
          <AddressSection emp={emp} canWrite={canWrite} onSaved={onSaved} showToast={showToast} />
        ),
      },
      {
        key: "office",
        title: "Office Details",
        description: "Department, designation, reporting line, role, skills, and project assignments.",
        icon: <Building2 size={20} aria-hidden />,
        render: () => (
          <div className="space-y-4">
            <OfficeDetailsSection emp={emp} canWrite={canWrite} onSaved={onSaved} showToast={showToast} />
            <ProjectsSection emp={emp} />
          </div>
        ),
      },
      {
        key: "education",
        title: "Education & Experience",
        description: "Qualifications and prior work history, with certificate uploads.",
        icon: <GraduationCap size={20} aria-hidden />,
        render: () => (
          <div className="space-y-4">
            <EducationSection employeeId={emp.id} canWrite={canWrite} showToast={showToast} />
            <ExperienceSection employeeId={emp.id} canWrite={canWrite} showToast={showToast} />
          </div>
        ),
      },
      {
        key: "leave",
        title: "Leave & Attendance",
        description: "Leave balances by year and attendance-hour rules.",
        icon: <CalendarDays size={20} aria-hidden />,
        render: () => (
          <div className="space-y-4">
            <LeaveBalancesSection employeeId={emp.id} canWrite={canWrite} showToast={showToast} />
            <AttendanceRuleSection emp={emp} canWrite={canWrite} onSaved={onSaved} showToast={showToast} />
          </div>
        ),
      },
      {
        key: "separation",
        title: "Separation",
        description: "Resignation status, notice period, and last working day.",
        icon: <LogOut size={20} aria-hidden />,
        render: () => (
          <SeparationSection emp={emp} canWrite={canWrite} onSaved={onSaved} showToast={showToast} />
        ),
      },
      {
        key: "review",
        title: "Review",
        description: "Confirm the details. Each section saves independently as you edit.",
        icon: <ClipboardCheck size={20} aria-hidden />,
        render: () => <EmployeeReviewStep emp={emp} />,
      },
    ],
    [emp, canWrite, onSaved, showToast],
  );

  const total = steps.length;
  const clamped = Math.min(Math.max(stepIndex, 0), total - 1);
  const current = steps[clamped];
  const isFirst = clamped <= 0;
  const isLast = clamped >= total - 1;
  const maxReached = total - 1; // edit context — every step is freely reachable

  const wizardSteps: WizardStep[] = steps.map((s, i) => ({
    key: s.key,
    title: s.title,
    sublabel: s.description,
    status: i < clamped ? "complete" : i === clamped ? "partial" : "empty",
  }));

  const goTo = (i: number) => {
    if (i < 0 || i >= total) return;
    setStepDir(i >= clamped ? 1 : -1);
    setStepIndex(i);
  };
  const goPrev = () => {
    if (isFirst) return;
    setStepDir(-1);
    setStepIndex((i) => Math.max(0, i - 1));
  };
  const goNext = () => {
    if (isLast) return;
    setStepDir(1);
    setStepIndex((i) => Math.min(total - 1, i + 1));
  };

  /* Focus the step heading (a11y) then the first editable field on step change. */
  useEffect(() => {
    const t = window.setTimeout(() => {
      headingRef.current?.focus?.({ preventScroll: true });
      const el = bodyRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])',
      );
      el?.focus?.({ preventScroll: true });
    }, reduce ? 0 : 200);
    return () => window.clearTimeout(t);
  }, [clamped, reduce]);

  const pct = Math.round(((clamped + 1) / total) * 100);

  return (
    <div className="crm-wizard wiz-noise overflow-hidden rounded-2xl border border-[color:var(--wiz-border)]">
      {/* Mobile: compact horizontal stepper */}
      <div className="border-b border-[color:var(--wiz-border)] bg-[color:var(--wiz-card)] px-4 py-2.5 md:hidden">
        <StepperRail
          steps={wizardSteps}
          currentIndex={clamped}
          maxReached={maxReached}
          onSelect={goTo}
          orientation="horizontal"
          ariaLabel="Employee profile steps"
        />
      </div>

      <div className="flex min-h-0">
        {/* Desktop: vertical rail + step progress */}
        <aside className="hidden w-72 shrink-0 overflow-y-auto border-r border-[color:var(--wiz-border)] bg-[color:var(--wiz-card)] p-4 md:block">
          <StepperRail
            steps={wizardSteps}
            currentIndex={clamped}
            maxReached={maxReached}
            onSelect={goTo}
            orientation="vertical"
            ariaLabel="Employee profile steps"
          />
          <WizardStepProgress
            pct={pct}
            completeLabel="You're on the final step — review and finish."
            incompleteLabel="Use Edit within each section to make changes."
          />
        </aside>

        {/* Content */}
        <div
          ref={bodyRef}
          className="min-h-0 min-w-0 flex-1 overflow-x-hidden px-4 py-5 sm:px-6 sm:py-6 lg:px-8"
        >
          <WizardStepCard stepKey={current.key} stepDir={stepDir}>
            <SectionHeaderBanner
              title={current.title}
              description={current.description}
              headingRef={headingRef}
              icon={current.icon}
            />
            {current.render()}
          </WizardStepCard>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-[color:var(--wiz-border)] bg-[color:var(--wiz-bg)] px-4 py-3 sm:px-6">
        <WizardFooter
          stepIndex={clamped}
          totalSteps={total}
          isFirstStep={isFirst}
          isLastStep={isLast}
          onPrev={goPrev}
          onNext={goNext}
          onSubmit={() => crmNavigate("employees")}
          submitLabel="Done"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------ 1. Employee Details */

function EmployeeDetailsSection({ emp, canWrite, onSaved, showToast }: SectionProps) {
  const d = useDraft(() => ({
    title: emp.title || "",
    first_name: emp.first_name || "",
    middle_name: emp.middle_name || "",
    last_name: emp.last_name || "",
    display_name: emp.display_name || "",
    phone: emp.phone || "",
    personal_email: emp.personal_email || "",
    email: emp.email || "",
    gender: emp.gender || "",
    blood_group: emp.blood_group || "",
    current_ctc: emp.current_ctc != null ? String(emp.current_ctc) : "",
    employee_code: emp.employee_code || "",
    date_of_joining: emp.date_of_joining || "",
    emergency_number: emp.emergency_number || "",
    date_of_birth: emp.date_of_birth || "",
    profile_type: emp.profile_type || "Internal",
    pan: emp.pan || "",
    aadhar: emp.aadhar || "",
  }));
  const { busy, save } = useEmployeeSave(emp.id, onSaved, showToast);
  // Template field grant: CTC is the classic "HR sees it, others don't" field.
  const acc = useCrmAccess("employees");
  const canEditCtc = acc.canEditField("current_ctc");

  const submit = async () => {
    const v = d.draft!;
    if (!v.first_name.trim()) { showToast("First name is required", "err"); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim())) { showToast("A valid official email is required", "err"); return; }
    const ok = await save({
      title: sOrNull(v.title),
      first_name: v.first_name.trim(),
      middle_name: sOrNull(v.middle_name),
      last_name: sOrNull(v.last_name),
      display_name: sOrNull(v.display_name),
      phone: sOrNull(v.phone),
      personal_email: sOrNull(v.personal_email),
      email: v.email.trim(),
      gender: v.gender || null,
      blood_group: v.blood_group || null,
      ...(canEditCtc ? { current_ctc: num(v.current_ctc) ?? null } : {}),
      employee_code: sOrNull(v.employee_code),
      date_of_joining: v.date_of_joining || null,
      emergency_number: sOrNull(v.emergency_number),
      date_of_birth: v.date_of_birth || null,
      profile_type: v.profile_type,
      pan: sOrNull(v.pan),
      aadhar: sOrNull(v.aadhar),
    }, "Employee details saved");
    if (ok) d.cancel();
  };

  /* CV upload persists immediately (independent of section edit mode). */
  const cvBlock = (
    <div className="flex flex-wrap items-center gap-2">
      <FileLink url={emp.cv_url} label="View CV" />
      {canWrite && (
        <FileUploadButton
          path={`/api/employees/${emp.id}/cv`}
          label={emp.cv_url ? "Replace CV" : "Upload CV"}
          accept=".pdf,.doc,.docx"
          onDone={() => { showToast("CV uploaded"); onSaved(); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
    </div>
  );

  return (
    <SectionCard
      title="Employee Details"
      canWrite={canWrite}
      editing={d.editing}
      dirty={d.dirty}
      busy={busy}
      onEdit={d.begin}
      onCancel={d.cancel}
      onSave={submit}
    >
      {d.editing ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Title">
            <select className={inputCls} value={d.draft!.title} onChange={(e) => d.patch({ title: e.target.value })}>
              <option value="">—</option>
              {TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="First name" required>
            <input className={inputCls} value={d.draft!.first_name} onChange={(e) => d.patch({ first_name: e.target.value })} />
          </Field>
          <Field label="Middle name">
            <input className={inputCls} value={d.draft!.middle_name} onChange={(e) => d.patch({ middle_name: e.target.value })} />
          </Field>
          <Field label="Last name">
            <input className={inputCls} value={d.draft!.last_name} onChange={(e) => d.patch({ last_name: e.target.value })} />
          </Field>
          <Field label="Display name">
            <input className={inputCls} value={d.draft!.display_name} onChange={(e) => d.patch({ display_name: e.target.value })} />
          </Field>
          <Field label="Phone">
            <input className={inputCls} value={d.draft!.phone} onChange={(e) => d.patch({ phone: e.target.value })} />
          </Field>
          <Field label="Email (Personal)">
            <input type="email" className={inputCls} value={d.draft!.personal_email} onChange={(e) => d.patch({ personal_email: e.target.value })} />
          </Field>
          <Field label="Gender">
            <select className={inputCls} value={d.draft!.gender} onChange={(e) => d.patch({ gender: e.target.value })}>
              <option value="">—</option>
              {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Blood group">
            <select className={inputCls} value={d.draft!.blood_group} onChange={(e) => d.patch({ blood_group: e.target.value })}>
              <option value="">—</option>
              {BLOOD_GROUPS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Current CTC">
            <input type="number" min={0} className={inputCls} value={d.draft!.current_ctc} disabled={!canEditCtc} onChange={(e) => d.patch({ current_ctc: e.target.value })} />
          </Field>
          <div>
            <span className="mb-1 block text-xs font-semibold text-secondary">CV</span>
            {cvBlock}
          </div>
          <Field label="Employee ID">
            <input className={inputCls} value={d.draft!.employee_code} onChange={(e) => d.patch({ employee_code: e.target.value })} />
          </Field>
          <Field label="Date of joining">
            <input type="date" className={inputCls} value={d.draft!.date_of_joining} onChange={(e) => d.patch({ date_of_joining: e.target.value })} />
          </Field>
          <Field label="Emergency number">
            <input className={inputCls} value={d.draft!.emergency_number} onChange={(e) => d.patch({ emergency_number: e.target.value })} />
          </Field>
          <Field label="Email (Official)" required>
            <input type="email" className={inputCls} value={d.draft!.email} onChange={(e) => d.patch({ email: e.target.value })} />
          </Field>
          <Field label="Date of birth">
            <input type="date" className={inputCls} value={d.draft!.date_of_birth} onChange={(e) => d.patch({ date_of_birth: e.target.value })} />
          </Field>
          <Field label="Profile type">
            <select className={inputCls} value={d.draft!.profile_type} onChange={(e) => d.patch({ profile_type: e.target.value })}>
              <option value="Internal">Internal</option>
              <option value="External">External</option>
            </select>
          </Field>
          <Field label="PAN">
            <input className={inputCls} value={d.draft!.pan} onChange={(e) => d.patch({ pan: e.target.value.toUpperCase() })} maxLength={10} placeholder="ABCDE1234F" />
          </Field>
          <Field label="Aadhar">
            <input className={inputCls} value={d.draft!.aadhar} onChange={(e) => d.patch({ aadhar: e.target.value })} maxLength={12} placeholder="12-digit number" />
          </Field>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          <InfoItem label="Title">{emp.title || "—"}</InfoItem>
          <InfoItem label="First name">{emp.first_name || "—"}</InfoItem>
          <InfoItem label="Middle name">{emp.middle_name || "—"}</InfoItem>
          <InfoItem label="Last name">{emp.last_name || "—"}</InfoItem>
          <InfoItem label="Display name">{emp.display_name || "—"}</InfoItem>
          <InfoItem label="Phone">{emp.phone || "—"}</InfoItem>
          <InfoItem label="Email (Personal)">{emp.personal_email || "—"}</InfoItem>
          <InfoItem label="Gender">{emp.gender || "—"}</InfoItem>
          <InfoItem label="Blood group">{emp.blood_group || "—"}</InfoItem>
          <InfoItem label="Current CTC">{emp.current_ctc != null ? Number(emp.current_ctc).toLocaleString("en-IN") : "—"}</InfoItem>
          <InfoItem label="CV">{cvBlock}</InfoItem>
          <InfoItem label="Employee ID">{emp.employee_code || "—"}</InfoItem>
          <InfoItem label="Date of joining">{fmtDate(emp.date_of_joining)}</InfoItem>
          <InfoItem label="Emergency number">{emp.emergency_number || "—"}</InfoItem>
          <InfoItem label="Email (Official)">{emp.email || "—"}</InfoItem>
          <InfoItem label="Date of birth">{fmtDate(emp.date_of_birth)}</InfoItem>
          <InfoItem label="Profile type">{emp.profile_type || "—"}</InfoItem>
          <InfoItem label="PAN">{emp.pan || "—"}</InfoItem>
          <InfoItem label="Aadhar">{emp.aadhar || "—"}</InfoItem>
        </div>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------ 2. Addresses */

type Address = {
  line1: string; line2: string; city: string; state: string;
  postal_code: string; country: string; phone: string;
};

const emptyAddress = (a?: any): Address => ({
  line1: a?.line1 || "",
  line2: a?.line2 || "",
  city: a?.city || "",
  state: a?.state || "",
  postal_code: a?.postal_code || "",
  country: a?.country || DEFAULT_COUNTRY,
  phone: a?.phone || "",
});

const addrPayload = (a: Address, withPhone: boolean): any | null => {
  const out: any = {
    line1: sOrNull(a.line1),
    line2: sOrNull(a.line2),
    city: sOrNull(a.city),
    state: sOrNull(a.state),
    postal_code: sOrNull(a.postal_code),
    country: sOrNull(a.country),
  };
  if (withPhone) out.phone = sOrNull(a.phone);
  const hasAny = Object.values(out).some((v) => v != null);
  return hasAny ? out : null;
};

function AddressReadout({ a }: { a?: any }) {
  const parts = [a?.line1, a?.line2, a?.city, a?.state, a?.postal_code, a?.country].filter(Boolean);
  if (!parts.length) return <span className="text-sm text-muted">Not provided</span>;
  return (
    <div className="text-sm text-primary">
      {parts.join(", ")}
      {a?.phone && <div className="mt-0.5 text-xs text-muted">Phone: {a.phone}</div>}
    </div>
  );
}

function AddressFields({
  value,
  onChange,
  withPhone,
}: {
  value: Address;
  onChange: (a: Address) => void;
  withPhone?: boolean;
}) {
  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Address line 1"><input className={inputCls} value={value.line1} onChange={set("line1")} /></Field>
      <Field label="Address line 2"><input className={inputCls} value={value.line2} onChange={set("line2")} /></Field>
      <Field label="City">
        <SearchableSelect
          value={value.city}
          options={optionsFromStrings(INDIAN_CITIES)}
          allowAdd
          searchable
          placeholder="Search city…"
          onChange={(v) => onChange({ ...value, city: v })}
        />
      </Field>
      <Field label="State">
        <SearchableSelect
          value={value.state}
          options={optionsFromStrings(INDIAN_STATES)}
          searchable
          placeholder="Search state…"
          onChange={(v) => onChange({ ...value, state: v })}
        />
      </Field>
      <Field label="Postal code"><input className={inputCls} value={value.postal_code} onChange={set("postal_code")} /></Field>
      <Field label="Country">
        <SearchableSelect
          value={value.country || DEFAULT_COUNTRY}
          options={optionsFromStrings(COUNTRIES)}
          allowAdd
          searchable
          placeholder="Search country…"
          onChange={(v) => onChange({ ...value, country: v })}
        />
      </Field>
      {withPhone && <Field label="Phone"><input className={inputCls} value={value.phone} onChange={set("phone")} /></Field>}
    </div>
  );
}

function AddressSection({ emp, canWrite, onSaved, showToast }: SectionProps) {
  const d = useDraft(() => ({
    present: emptyAddress(emp.present_address),
    permanent: emptyAddress(emp.permanent_address),
    same: false,
  }));
  const { busy, save } = useEmployeeSave(emp.id, onSaved, showToast);

  const submit = async () => {
    const v = d.draft!;
    const ok = await save({
      present_address: addrPayload(v.present, false),
      permanent_address: addrPayload(v.permanent, true),
    }, "Addresses saved");
    if (ok) d.cancel();
  };

  const copyPresent = (checked: boolean) => {
    if (!d.draft) return;
    if (checked) {
      d.patch({ same: true, permanent: { ...d.draft.present, phone: d.draft.permanent.phone } });
    } else {
      d.patch({ same: false });
    }
  };

  return (
    <SectionCard
      title="Present & Permanent Address"
      canWrite={canWrite}
      editing={d.editing}
      dirty={d.dirty}
      busy={busy}
      onEdit={d.begin}
      onCancel={d.cancel}
      onSave={submit}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Present Address</h3>
          {d.editing ? (
            <AddressFields
              value={d.draft!.present}
              onChange={(a) => d.patch({ present: a, ...(d.draft!.same ? { permanent: { ...a, phone: d.draft!.permanent.phone } } : {}) })}
            />
          ) : (
            <AddressReadout a={emp.present_address} />
          )}
        </div>
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted">Permanent Address</h3>
            {d.editing && (
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-secondary">
                <input type="checkbox" checked={d.draft!.same} onChange={(e) => copyPresent(e.target.checked)} />
                Same as present
              </label>
            )}
          </div>
          {d.editing ? (
            <AddressFields value={d.draft!.permanent} onChange={(a) => d.patch({ permanent: a, same: false })} withPhone />
          ) : (
            <AddressReadout a={emp.permanent_address} />
          )}
        </div>
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------ 3 & 4. Subform tables */

/** Row modal for the Education subform. */
function EducationModal({
  employeeId,
  initial,
  onClose,
  onSaved,
  showToast,
}: {
  employeeId: number;
  initial?: any;
  onClose: () => void;
  onSaved: () => void;
  showToast: ShowToast;
}) {
  const [course, setCourse] = useState(initial?.course || "");
  const [branch, setBranch] = useState(initial?.branch_specialization || "");
  const [start, setStart] = useState(initial?.start_date || "");
  const [end, setEnd] = useState(initial?.end_date || "");
  const [university, setUniversity] = useState(initial?.university || "");
  const [city, setCity] = useState(initial?.city || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!course.trim()) { setErr("Course is required"); return; }
    setErr("");
    setBusy(true);
    const payload = {
      course: course.trim(),
      branch_specialization: sOrNull(branch),
      start_date: start || null,
      end_date: end || null,
      university: sOrNull(university),
      city: sOrNull(city),
    };
    try {
      if (initial) await crmPut(`/api/education/${initial.id}`, payload);
      else await crmPost(`/api/employees/${employeeId}/education`, payload);
      showToast(initial ? "Education updated" : "Education added");
      onSaved();
    } catch (e: any) {
      showToast(e?.message || "Failed to save education", "err");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={<span className="sr-only">{initial ? "Edit Education" : "Add Education"}</span>}
      onClose={onClose}
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0"
    >
      <WizFormShell
        title={initial ? "Edit Education" : "Add Education"}
        subtitle="Qualification, institution, and study period."
        icon={<GraduationCap size={20} aria-hidden />}
      >
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          <WizardField label="Course" required icon="hash" filled={!!course.trim()}>
            <input className={inputCls} value={course} onChange={(e) => setCourse(e.target.value)} placeholder="e.g. B.E. / M.Sc." />
          </WizardField>
          <WizardField label="Branch / Specialization" icon="hash" filled={!!branch.trim()}>
            <input className={inputCls} value={branch} onChange={(e) => setBranch(e.target.value)} />
          </WizardField>
          <WizardField label="Start date" icon="calendar" filled={!!start}>
            <input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
          </WizardField>
          <WizardField label="End date" icon="calendar" filled={!!end}>
            <input type="date" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} />
          </WizardField>
          <WizardField label="University" icon="building" filled={!!university.trim()}>
            <input className={inputCls} value={university} onChange={(e) => setUniversity(e.target.value)} />
          </WizardField>
          <WizardField label="City">
            <SearchableSelect
              value={city}
              options={optionsFromStrings(INDIAN_CITIES)}
              allowAdd
              searchable
              placeholder="Search city…"
              onChange={setCity}
            />
          </WizardField>
        </div>
        {err && <div className="mt-3 text-sm text-danger">{err}</div>}
        <div className={wizFooterRow}>
          <button className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`${btnPrimary} btn-gradient ml-auto h-10 rounded-xl px-4`} onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </WizFormShell>
    </Modal>
  );
}

function EducationSection({
  employeeId,
  canWrite,
  showToast,
}: {
  employeeId: number;
  canWrite: boolean;
  showToast: ShowToast;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<{ open: boolean; initial?: any } | null>(null);
  const [toDelete, setToDelete] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    crmGet<any[]>(`/api/employees/${employeeId}/education`)
      .then((r) => { setRows(r.data || []); setError(""); })
      .catch((e) => setError(e?.message || "Failed to load education details"))
      .finally(() => setLoading(false));
  };
  useEffect(load, [employeeId]);

  const doDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await crmDelete(`/api/education/${toDelete.id}`);
      showToast("Education entry deleted");
      setToDelete(null);
      load();
    } catch (e: any) {
      showToast(e?.message || "Failed to delete", "err");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SectionCard
      title="Education Details"
      headerExtra={canWrite ? (
        <button className={btnSecondary} onClick={() => setModal({ open: true })}>
          <Plus size={14} /> Add
        </button>
      ) : undefined}
    >
      {error && <ErrorBox error={error} onRetry={load} />}
      {loading ? (
        <div className="py-6 text-center text-sm text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState message="No education details recorded" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm lg:min-w-0">
            <thead>
              <tr className={rowCls}>
                <th className={thCls}>Course</th>
                <th className={thCls}>Branch / Specialization</th>
                <th className={thCls}>Start Date</th>
                <th className={thCls}>End Date</th>
                <th className={thCls}>University</th>
                <th className={thCls}>City</th>
                <th className={thCls}>Certificate</th>
                {canWrite && <th className={thCls}></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`${rowCls} transition-colors duration-base ease-smooth hover:bg-surface-2`}>
                  <td className={`${tdCls} font-semibold text-primary`}>{r.course}</td>
                  <td className={tdCls}>{r.branch_specialization || "—"}</td>
                  <td className={tdCls}>{fmtDate(r.start_date)}</td>
                  <td className={tdCls}>{fmtDate(r.end_date)}</td>
                  <td className={tdCls}>{r.university || "—"}</td>
                  <td className={tdCls}>{r.city || "—"}</td>
                  <td className={tdCls}>
                    <div className="flex flex-wrap items-center gap-2">
                      <FileLink url={r.certificate_url} label="View" />
                      {canWrite && (
                        <FileUploadButton
                          path={`/api/education/${r.id}/certificate`}
                          label={r.certificate_url ? "Replace" : "Upload"}
                          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                          onDone={() => { showToast("Certificate uploaded"); load(); }}
                          onError={(m) => showToast(m, "err")}
                        />
                      )}
                    </div>
                  </td>
                  {canWrite && (
                    <td className={tdCls}>
                      <div className="flex gap-1.5">
                        <button className={iconBtnCls} onClick={() => setModal({ open: true, initial: r })} aria-label="Edit education">
                          <Pencil size={14} />
                        </button>
                        <button className={`${iconBtnCls} hover:text-danger`} onClick={() => setToDelete(r)} aria-label="Delete education">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal?.open && (
        <EducationModal
          employeeId={employeeId}
          initial={modal.initial}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
          showToast={showToast}
        />
      )}
      {toDelete && (
        <ConfirmModal
          title="Delete education entry"
          message={<>Delete <span className="font-semibold">{toDelete.course}</span>? This cannot be undone.</>}
          confirmLabel="Delete"
          danger
          busy={deleting}
          onConfirm={doDelete}
          onClose={() => setToDelete(null)}
        />
      )}
    </SectionCard>
  );
}

/** Row modal for the Experience subform (Currently Working disables relieving date). */
function ExperienceModal({
  employeeId,
  initial,
  onClose,
  onSaved,
  showToast,
}: {
  employeeId: number;
  initial?: any;
  onClose: () => void;
  onSaved: () => void;
  showToast: ShowToast;
}) {
  const [company, setCompany] = useState(initial?.company_name || "");
  const [jobTitle, setJobTitle] = useState(initial?.job_title || "");
  const [current, setCurrent] = useState(Boolean(initial?.currently_working));
  const [doj, setDoj] = useState(initial?.date_of_joining || "");
  const [relieving, setRelieving] = useState(initial?.date_of_relieving || "");
  const [city, setCity] = useState(initial?.city || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!company.trim()) { setErr("Company name is required"); return; }
    setErr("");
    setBusy(true);
    const payload = {
      company_name: company.trim(),
      job_title: sOrNull(jobTitle),
      currently_working: current,
      date_of_joining: doj || null,
      date_of_relieving: current ? null : (relieving || null),
      city: sOrNull(city),
    };
    try {
      if (initial) await crmPut(`/api/experience/${initial.id}`, payload);
      else await crmPost(`/api/employees/${employeeId}/experience`, payload);
      showToast(initial ? "Experience updated" : "Experience added");
      onSaved();
    } catch (e: any) {
      showToast(e?.message || "Failed to save experience", "err");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={<span className="sr-only">{initial ? "Edit Experience" : "Add Experience"}</span>}
      onClose={onClose}
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0"
    >
      <WizFormShell
        title={initial ? "Edit Experience" : "Add Experience"}
        subtitle="Prior employer, role, and tenure dates."
        icon={<Briefcase size={20} aria-hidden />}
      >
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          <WizardField label="Company name" required icon="building" filled={!!company.trim()}>
            <input className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} />
          </WizardField>
          <WizardField label="Job title" icon="user" filled={!!jobTitle.trim()}>
            <input className={inputCls} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </WizardField>
          <WizardField label="Date of joining" icon="calendar" filled={!!doj}>
            <input type="date" className={inputCls} value={doj} onChange={(e) => setDoj(e.target.value)} />
          </WizardField>
          <WizardField label="Date of relieving" icon={current ? "lock" : "calendar"} filled={!current && !!relieving}>
            <input
              type="date"
              className={inputCls}
              value={current ? "" : relieving}
              onChange={(e) => setRelieving(e.target.value)}
              disabled={current}
            />
          </WizardField>
          <WizardField label="City">
            <SearchableSelect
              value={city}
              options={optionsFromStrings(INDIAN_CITIES)}
              allowAdd
              searchable
              placeholder="Search city…"
              onChange={setCity}
            />
          </WizardField>
          <div className="flex items-end pb-1.5">
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--wiz-text)]">
              <input type="checkbox" checked={current} onChange={(e) => setCurrent(e.target.checked)} />
              Currently working here
            </label>
          </div>
        </div>
        {err && <div className="mt-3 text-sm text-danger">{err}</div>}
        <div className={wizFooterRow}>
          <button className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`${btnPrimary} btn-gradient ml-auto h-10 rounded-xl px-4`} onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </WizFormShell>
    </Modal>
  );
}

function ExperienceSection({
  employeeId,
  canWrite,
  showToast,
}: {
  employeeId: number;
  canWrite: boolean;
  showToast: ShowToast;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<{ open: boolean; initial?: any } | null>(null);
  const [toDelete, setToDelete] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    crmGet<any[]>(`/api/employees/${employeeId}/experience`)
      .then((r) => { setRows(r.data || []); setError(""); })
      .catch((e) => setError(e?.message || "Failed to load experience details"))
      .finally(() => setLoading(false));
  };
  useEffect(load, [employeeId]);

  const doDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await crmDelete(`/api/experience/${toDelete.id}`);
      showToast("Experience entry deleted");
      setToDelete(null);
      load();
    } catch (e: any) {
      showToast(e?.message || "Failed to delete", "err");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SectionCard
      title="Experience Details"
      headerExtra={canWrite ? (
        <button className={btnSecondary} onClick={() => setModal({ open: true })}>
          <Plus size={14} /> Add
        </button>
      ) : undefined}
    >
      {error && <ErrorBox error={error} onRetry={load} />}
      {loading ? (
        <div className="py-6 text-center text-sm text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState message="No prior experience recorded" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm lg:min-w-0">
            <thead>
              <tr className={rowCls}>
                <th className={thCls}>Company</th>
                <th className={thCls}>Job Title</th>
                <th className={thCls}>Joining</th>
                <th className={thCls}>Relieving</th>
                <th className={thCls}>City</th>
                <th className={thCls}>Certificate</th>
                {canWrite && <th className={thCls}></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`${rowCls} transition-colors duration-base ease-smooth hover:bg-surface-2`}>
                  <td className={`${tdCls} font-semibold text-primary`}>{r.company_name}</td>
                  <td className={tdCls}>{r.job_title || "—"}</td>
                  <td className={tdCls}>{fmtDate(r.date_of_joining)}</td>
                  <td className={tdCls}>
                    {r.currently_working
                      ? <StatusBadge status="Present" />
                      : fmtDate(r.date_of_relieving)}
                  </td>
                  <td className={tdCls}>{r.city || "—"}</td>
                  <td className={tdCls}>
                    <div className="flex flex-wrap items-center gap-2">
                      <FileLink url={r.certificate_url} label="View" />
                      {canWrite && (
                        <FileUploadButton
                          path={`/api/experience/${r.id}/certificate`}
                          label={r.certificate_url ? "Replace" : "Upload"}
                          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                          onDone={() => { showToast("Certificate uploaded"); load(); }}
                          onError={(m) => showToast(m, "err")}
                        />
                      )}
                    </div>
                  </td>
                  {canWrite && (
                    <td className={tdCls}>
                      <div className="flex gap-1.5">
                        <button className={iconBtnCls} onClick={() => setModal({ open: true, initial: r })} aria-label="Edit experience">
                          <Pencil size={14} />
                        </button>
                        <button className={`${iconBtnCls} hover:text-danger`} onClick={() => setToDelete(r)} aria-label="Delete experience">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal?.open && (
        <ExperienceModal
          employeeId={employeeId}
          initial={modal.initial}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
          showToast={showToast}
        />
      )}
      {toDelete && (
        <ConfirmModal
          title="Delete experience entry"
          message={<>Delete <span className="font-semibold">{toDelete.company_name}</span>? This cannot be undone.</>}
          confirmLabel="Delete"
          danger
          busy={deleting}
          onConfirm={doDelete}
          onClose={() => setToDelete(null)}
        />
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------ 5. Projects (read-only) */

function ProjectsSection({ emp }: { emp: any }) {
  const projects: any[] = emp.projects || [];
  const userRoles: string[] = emp.user_roles || [];
  const isExit = Boolean(emp.is_exit || emp.is_resigned);
  const exitDate = emp.exit_date || emp.last_working_day || emp.date_of_resignation;

  return (
    <SectionCard title="Projects">
      {projects.length === 0 ? (
        <EmptyState message="Not assigned to any project" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm lg:min-w-0">
            <thead>
              <tr className={rowCls}>
                <th className={thCls}>Project</th>
                <th className={thCls}>Onboarding Date</th>
                <th className={thCls}>Experience</th>
                <th className={thCls}>Work Mode</th>
                <th className={thCls}>Billing Unit</th>
                <th className={thCls}>Status</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p, i) => (
                <tr key={p.project_id ?? i} className={`${rowCls} transition-colors duration-base ease-smooth hover:bg-surface-2`}>
                  <td className={`${tdCls} font-semibold text-primary`}>{p.project_name || `#${p.project_id}`}</td>
                  <td className={tdCls}>{fmtDate(p.onboarding_date)}</td>
                  <td className={tdCls}>{p.experience_years != null ? `${p.experience_years} yrs` : "—"}</td>
                  <td className={tdCls}>{p.work_mode || "—"}</td>
                  <td className={tdCls}>{p.billing_unit || "—"}</td>
                  <td className={tdCls}><StatusBadge status={p.is_active ? "Active" : "Inactive"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-subtle pt-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">User Roles:</span>
        {userRoles.length ? userRoles.map((r) => <span key={r} className={chipCls}>{r}</span>) : <span className="text-sm text-muted">—</span>}
        <span className="mx-1 hidden text-muted sm:inline">·</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Candidate Profile:</span>
        {emp.candidate_profile_id ? (
          <CrmLink
            to={`profiles/${emp.candidate_profile_id}`}
            className={`rounded-control text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300 ${focusRing}`}
          >
            View profile #{emp.candidate_profile_id}
          </CrmLink>
        ) : (
          <span className="text-sm text-muted">—</span>
        )}
        <span className="mx-1 hidden text-muted sm:inline">·</span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ring-black/5 dark:ring-white/10 ${
            emp.portal_access ? "bg-success-soft text-success" : "bg-surface-2 text-muted"
          }`}
        >
          Portal Access: {emp.portal_access ? "Yes" : "No"}
        </span>
        {isExit && (
          <>
            <StatusBadge status="Exited" />
            <span className="text-sm text-secondary">Exit date: <span className="font-semibold text-primary">{fmtDate(exitDate)}</span></span>
          </>
        )}
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------ 6. Office Details */

function OfficeDetailsSection({ emp, canWrite, onSaved, showToast }: SectionProps) {
  const [departments, setDepartments] = useState<any[]>([]);
  const [designations, setDesignations] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]);

  useEffect(() => {
    if (!canWrite) return;
    crmGet<any[]>("/api/departments?limit=100").then((r) => setDepartments(r.data || [])).catch(() => {});
    crmGet<any[]>("/api/designations?limit=100").then((r) => setDesignations(r.data || [])).catch(() => {});
    crmGet<any[]>("/api/employees?is_active=true&limit=100").then((r) => setPeople(r.data || [])).catch(() => {});
  }, [canWrite]);

  const d = useDraft(() => ({
    work_location: emp.work_location || "",
    role_title: emp.role_title || "",
    skills: (emp.skills || []) as string[],
    experience_years: emp.experience_years != null ? String(emp.experience_years) : "",
    employment_type: emp.employment_type || "",
    is_active: Boolean(emp.is_active),
    portal_access: Boolean(emp.portal_access),
    department_id: emp.department_id ? String(emp.department_id) : "",
    designation_id: emp.designation_id ? String(emp.designation_id) : "",
    reporting_manager_id: emp.reporting_manager_id ? String(emp.reporting_manager_id) : "",
    reporting_hr_id: emp.reporting_hr_id ? String(emp.reporting_hr_id) : "",
  }));
  const { busy, save } = useEmployeeSave(emp.id, onSaved, showToast);

  const submit = async () => {
    const v = d.draft!;
    const ok = await save({
      work_location: sOrNull(v.work_location),
      role_title: sOrNull(v.role_title),
      skills: v.skills,
      experience_years: num(v.experience_years) ?? null,
      employment_type: v.employment_type || null,
      is_active: v.is_active,
      portal_access: v.portal_access,
      department_id: v.department_id ? Number(v.department_id) : null,
      designation_id: v.designation_id ? Number(v.designation_id) : null,
      reporting_manager_id: v.reporting_manager_id ? Number(v.reporting_manager_id) : null,
      reporting_hr_id: v.reporting_hr_id ? Number(v.reporting_hr_id) : null,
    }, "Office details saved");
    if (ok) d.cancel();
  };

  const personName = (m: any) => m.full_name || `${m.first_name} ${m.last_name || ""}`;
  const peopleOptions = people.filter((m) => m.id !== emp.id);

  return (
    <SectionCard
      title="Office Details"
      canWrite={canWrite}
      editing={d.editing}
      dirty={d.dirty}
      busy={busy}
      onEdit={d.begin}
      onCancel={d.cancel}
      onSave={submit}
    >
      {d.editing ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Work location">
            <input className={inputCls} value={d.draft!.work_location} onChange={(e) => d.patch({ work_location: e.target.value })} />
          </Field>
          <Field label="Role">
            <input className={inputCls} value={d.draft!.role_title} onChange={(e) => d.patch({ role_title: e.target.value })} />
          </Field>
          <Field label="Experience in years">
            <input type="number" min={0} step="0.5" className={inputCls} value={d.draft!.experience_years} onChange={(e) => d.patch({ experience_years: e.target.value })} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label="Skills">
              <SkillsInput value={d.draft!.skills} onChange={(skills) => d.patch({ skills })} />
            </Field>
          </div>
          <Field label="Employment type">
            <select className={inputCls} value={d.draft!.employment_type} onChange={(e) => d.patch({ employment_type: e.target.value })}>
              <option value="">—</option>
              {EMPLOYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Department">
            <select className={inputCls} value={d.draft!.department_id} onChange={(e) => d.patch({ department_id: e.target.value })}>
              <option value="">—</option>
              {departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <Field label="Designation">
            <select className={inputCls} value={d.draft!.designation_id} onChange={(e) => d.patch({ designation_id: e.target.value })}>
              <option value="">—</option>
              {designations.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <Field label="Reporting manager">
            <select className={inputCls} value={d.draft!.reporting_manager_id} onChange={(e) => d.patch({ reporting_manager_id: e.target.value })}>
              <option value="">—</option>
              {peopleOptions.map((m) => <option key={m.id} value={m.id}>{personName(m)}</option>)}
            </select>
          </Field>
          <Field label="Reporting HR">
            <select className={inputCls} value={d.draft!.reporting_hr_id} onChange={(e) => d.patch({ reporting_hr_id: e.target.value })}>
              <option value="">—</option>
              {peopleOptions.map((m) => <option key={m.id} value={m.id}>{personName(m)}</option>)}
            </select>
          </Field>
          <div className="flex items-end gap-6 pb-1.5">
            <div className="flex items-center gap-2">
              <Toggle checked={d.draft!.is_active} onChange={(v) => d.patch({ is_active: v })} label="Active status" />
              <span className="text-sm font-semibold text-secondary">Active</span>
            </div>
            <div className="flex items-center gap-2">
              <Toggle checked={d.draft!.portal_access} onChange={(v) => d.patch({ portal_access: v })} label="Portal access" />
              <span className="text-sm font-semibold text-secondary">Portal access</span>
            </div>
          </div>
          <InfoItem label="Current experience (computed)">
            {emp.current_experience_years != null ? `${emp.current_experience_years} yrs` : "—"}
          </InfoItem>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          <InfoItem label="Work location">{emp.work_location || "—"}</InfoItem>
          <InfoItem label="Role">{emp.role_title || "—"}</InfoItem>
          <InfoItem label="Skills">
            {(emp.skills || []).length ? (
              <span className="flex flex-wrap gap-1.5">
                {(emp.skills as string[]).map((s) => <span key={s} className={chipCls}>{s}</span>)}
              </span>
            ) : "—"}
          </InfoItem>
          <InfoItem label="Experience in years">{emp.experience_years != null ? `${emp.experience_years} yrs` : "—"}</InfoItem>
          <InfoItem label="Employment type">{empTypeLabel(emp.employment_type)}</InfoItem>
          <InfoItem label="Status"><StatusBadge status={emp.is_active ? "Active" : "Inactive"} /></InfoItem>
          <InfoItem label="Department">{emp.department_name || "—"}</InfoItem>
          <InfoItem label="Designation">{emp.designation_name || "—"}</InfoItem>
          <InfoItem label="Reporting manager">{emp.reporting_manager_name || "—"}</InfoItem>
          <InfoItem label="Reporting HR">{emp.reporting_hr_name || "—"}</InfoItem>
          <InfoItem label="Portal access">{emp.portal_access ? "Yes" : "No"}</InfoItem>
          <InfoItem label="Current experience (computed)">
            {emp.current_experience_years != null ? `${emp.current_experience_years} yrs` : "—"}
          </InfoItem>
        </div>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------ 7. Separation Details */

function SeparationSection({ emp, canWrite, onSaved, showToast }: SectionProps) {
  const d = useDraft(() => ({
    is_resigned: Boolean(emp.is_resigned),
    date_of_resignation: emp.date_of_resignation || "",
    notice_period_days: emp.notice_period_days != null ? String(emp.notice_period_days) : "",
    last_working_day: emp.last_working_day || "",
  }));
  const { busy, save } = useEmployeeSave(emp.id, onSaved, showToast);

  const submit = async () => {
    const v = d.draft!;
    const ok = await save({
      is_resigned: v.is_resigned,
      date_of_resignation: v.is_resigned ? (v.date_of_resignation || null) : null,
      notice_period_days: v.is_resigned ? (num(v.notice_period_days) ?? null) : null,
      last_working_day: v.is_resigned ? (v.last_working_day || null) : null,
    }, "Separation details saved");
    if (ok) d.cancel();
  };

  return (
    <SectionCard
      title="Separation Details"
      canWrite={canWrite}
      editing={d.editing}
      dirty={d.dirty}
      busy={busy}
      onEdit={d.begin}
      onCancel={d.cancel}
      onSave={submit}
    >
      {d.editing ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-end gap-2 pb-1.5">
            <Toggle checked={d.draft!.is_resigned} onChange={(v) => d.patch({ is_resigned: v })} label="Is resigned" />
            <span className="text-sm font-semibold text-secondary">Is resigned</span>
          </div>
          <Field label="Date of resignation">
            <input
              type="date"
              className={inputCls}
              value={d.draft!.date_of_resignation}
              onChange={(e) => d.patch({ date_of_resignation: e.target.value })}
              disabled={!d.draft!.is_resigned}
            />
          </Field>
          <Field label="Notice period (days)">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={d.draft!.notice_period_days}
              onChange={(e) => d.patch({ notice_period_days: e.target.value })}
              disabled={!d.draft!.is_resigned}
            />
          </Field>
          <Field label="Last working day">
            <input
              type="date"
              className={inputCls}
              value={d.draft!.last_working_day}
              onChange={(e) => d.patch({ last_working_day: e.target.value })}
              disabled={!d.draft!.is_resigned}
            />
          </Field>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          <InfoItem label="Is resigned">{emp.is_resigned ? "Yes" : "No"}</InfoItem>
          <InfoItem label="Date of resignation">{fmtDate(emp.date_of_resignation)}</InfoItem>
          <InfoItem label="Notice period (days)">{emp.notice_period_days ?? "—"}</InfoItem>
          <InfoItem label="Last working day">{fmtDate(emp.last_working_day)}</InfoItem>
        </div>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------ 8. Leave Balances */

type LeaveDraft = { accrued: string; consumed: string; carry: string };

type LeaveMatrix = {
  rows: { code: string; label: string; accrual: number | null; consumed: number | null; balance: number | null }[];
  el_carry_forward_last_year: number | null;
  comp_off_carry_forward_last_year: number | null;
  loss_of_pay: number | null;
};

function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="glass fx-gradient-border fx-lift rounded-card px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-display text-xl font-bold tabular-nums text-primary">{value ?? "—"}</div>
    </div>
  );
}

function LeaveBalancesSection({
  employeeId,
  canWrite,
  showToast,
}: {
  employeeId: number;
  canWrite: boolean;
  showToast: ShowToast;
}) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [matrix, setMatrix] = useState<LeaveMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* Legacy per-type upsert editing (existing PUT endpoint), shown in edit mode. */
  const [editing, setEditing] = useState(false);
  const [types, setTypes] = useState<any[]>([]);
  const [balances, setBalances] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<Record<number, LeaveDraft>>({});
  const [busy, setBusy] = useState(false);

  const loadMatrix = () => {
    setLoading(true);
    crmGet<LeaveMatrix>(`/api/employees/${employeeId}/leave-matrix${qs({ year })}`)
      .then((r) => { setMatrix(r.data); setError(""); })
      .catch((e) => setError(e?.message || "Failed to load leave balances"))
      .finally(() => setLoading(false));
  };
  useEffect(loadMatrix, [employeeId, year]);

  useEffect(() => {
    if (!canWrite) return;
    crmGet<any[]>("/api/leave-policy-types?limit=100").then((r) => setTypes(r.data || [])).catch(() => {});
  }, [canWrite]);

  /** All known leave types merged with this year's balance rows (legacy edit UI). */
  const editRows = useMemo(() => {
    const byType: Record<number, any> = {};
    balances.forEach((b) => { byType[b.leave_type_id] = b; });
    return types.length
      ? types.map((t) => ({
          leave_type_id: t.id,
          name: t.name,
          accrual_rule: t.accrual_rule,
          carry_forward_rule: t.carry_forward_rule,
          bal: byType[t.id] || null,
        }))
      : balances.map((b) => ({
          leave_type_id: b.leave_type_id,
          name: b.leave_type_name || `Type #${b.leave_type_id}`,
          accrual_rule: null,
          carry_forward_rule: null,
          bal: b,
        }));
  }, [types, balances]);

  const startEdit = async () => {
    try {
      const r = await crmGet<any[]>(`/api/employees/${employeeId}/leave-balances${qs({ year })}`);
      const bal = r.data || [];
      setBalances(bal);
      const byType: Record<number, any> = {};
      bal.forEach((b: any) => { byType[b.leave_type_id] = b; });
      const d: Record<number, LeaveDraft> = {};
      const ids = types.length ? types.map((t) => t.id) : bal.map((b: any) => b.leave_type_id);
      ids.forEach((tid: number) => {
        const b = byType[tid];
        d[tid] = {
          accrued: b?.accrued != null ? String(b.accrued) : "",
          consumed: b?.consumed != null ? String(b.consumed) : "",
          carry: b?.carry_forward != null ? String(b.carry_forward) : "",
        };
      });
      setDrafts(d);
      setEditing(true);
    } catch (e: any) {
      showToast(e?.message || "Failed to load balances for editing", "err");
    }
  };

  const setDraft = (typeId: number, key: keyof LeaveDraft, value: string) => {
    setDrafts((prev) => ({ ...prev, [typeId]: { ...prev[typeId], [key]: value } }));
  };

  const saveEdits = async () => {
    const payload = editRows
      .filter((r) => {
        const d = drafts[r.leave_type_id];
        return r.bal || (d && (d.accrued !== "" || d.consumed !== "" || d.carry !== ""));
      })
      .map((r) => {
        const d = drafts[r.leave_type_id] || { accrued: "", consumed: "", carry: "" };
        return {
          leave_type_id: r.leave_type_id,
          year,
          accrued: num(d.accrued),
          consumed: num(d.consumed),
          carry_forward: num(d.carry),
        };
      });
    if (!payload.length) {
      showToast("Enter at least one leave balance value", "err");
      return;
    }
    setBusy(true);
    try {
      await crmPut(`/api/employees/${employeeId}/leave-balances`, payload);
      showToast("Leave balances saved");
      setEditing(false);
      loadMatrix();
    } catch (e: any) {
      showToast(e?.message || "Failed to save leave balances", "err");
    } finally {
      setBusy(false);
    }
  };

  const liveBalance = (typeId: number): number => {
    const d = drafts[typeId] || { accrued: "", consumed: "", carry: "" };
    return (num(d.accrued) ?? 0) + (num(d.carry) ?? 0) - (num(d.consumed) ?? 0);
  };

  const years: number[] = [];
  for (let y = currentYear + 1; y >= currentYear - 4; y--) years.push(y);

  const yearPicker = (
    <select
      className={`${inputCls} !w-28`}
      value={year}
      onChange={(e) => { setYear(Number(e.target.value)); setEditing(false); }}
      aria-label="Leave balance year"
    >
      {years.map((y) => <option key={y} value={y}>{y}</option>)}
    </select>
  );

  const editButtons = canWrite ? (
    editing ? (
      <div className="flex gap-2">
        <button className={btnSecondary} onClick={() => setEditing(false)} disabled={busy}>
          <X size={14} /> Cancel
        </button>
        <button className={btnPrimary} onClick={saveEdits} disabled={busy}>
          <Save size={14} /> {busy ? "Saving…" : "Save"}
        </button>
      </div>
    ) : (
      <button className={btnSecondary} onClick={startEdit}>
        <Pencil size={14} /> Edit balances
      </button>
    )
  ) : undefined;

  return (
    <SectionCard title="Leave Balances" headerExtra={<div className="flex items-center gap-2">{yearPicker}{editButtons}</div>}>
      {error && <ErrorBox error={error} onRetry={loadMatrix} />}
      {editing ? (
        /* Legacy per-type upsert UI (PUT /leave-balances). */
        editRows.length === 0 ? (
          <EmptyState message="No leave types configured" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm lg:min-w-0">
              <thead>
                <tr className={rowCls}>
                  {["Leave Type", "Accrued", "Consumed", "Carry Forward", "Balance"].map((h) => (
                    <th key={h} className={thCls}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {editRows.map((r) => {
                  const d = drafts[r.leave_type_id] || { accrued: "", consumed: "", carry: "" };
                  return (
                    <tr key={r.leave_type_id} className={rowCls}>
                      <td className={tdCls}>
                        <div className="font-semibold text-primary">{r.name}</div>
                        {(r.accrual_rule || r.carry_forward_rule) && (
                          <div className="mt-0.5 text-xs text-muted">
                            {r.accrual_rule && <span>Accrual: {r.accrual_rule}</span>}
                            {r.accrual_rule && r.carry_forward_rule && <span> · </span>}
                            {r.carry_forward_rule && <span>Carry forward: {r.carry_forward_rule}</span>}
                          </div>
                        )}
                      </td>
                      <td className={tdCls}>
                        <input type="number" min={0} step="0.5" className={`${inputCls} !w-24`} value={d.accrued}
                          onChange={(e) => setDraft(r.leave_type_id, "accrued", e.target.value)} />
                      </td>
                      <td className={tdCls}>
                        <input type="number" min={0} step="0.5" className={`${inputCls} !w-24`} value={d.consumed}
                          onChange={(e) => setDraft(r.leave_type_id, "consumed", e.target.value)} />
                      </td>
                      <td className={tdCls}>
                        <input type="number" min={0} step="0.5" className={`${inputCls} !w-24`} value={d.carry}
                          onChange={(e) => setDraft(r.leave_type_id, "carry", e.target.value)} />
                      </td>
                      <td className={tdCls}>
                        <span className="font-semibold text-primary">{liveBalance(r.leave_type_id)}</span>
                        <div className="text-xs text-muted">recomputed on save</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : loading ? (
        <div className="py-6 text-center text-sm text-muted">Loading…</div>
      ) : !matrix || (matrix.rows || []).length === 0 ? (
        <EmptyState message={`No leave data for ${year}`} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm lg:min-w-0">
              <thead>
                <tr className={rowCls}>
                  <th className={thCls}>Leave Type</th>
                  <th className={thCls}>Accrual</th>
                  <th className={thCls}>Consumed</th>
                  <th className={thCls}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {(matrix.rows || []).map((r) => (
                  <tr key={r.code} className={`${rowCls} transition-colors duration-base ease-smooth hover:bg-surface-2`}>
                    <td className={tdCls}>
                      <span className="font-semibold text-primary">{r.label || r.code}</span>
                      <span className="ml-2 text-xs uppercase text-muted">{r.code}</span>
                    </td>
                    <td className={tdCls}>{r.accrual ?? "—"}</td>
                    <td className={tdCls}>{r.consumed ?? "—"}</td>
                    <td className={`${tdCls} font-semibold text-primary`}>{r.balance ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile label="Earned Leave Carry Forward (Last Year)" value={matrix.el_carry_forward_last_year ?? "—"} />
            <StatTile label="Comp Off Carry Forward (Last Year)" value={matrix.comp_off_carry_forward_last_year ?? "—"} />
            <StatTile label="Loss of Pay" value={matrix.loss_of_pay ?? "—"} />
          </div>
        </>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------ 9. Attendance Rule */

function AttendanceRuleSection({ emp, canWrite, onSaved, showToast }: SectionProps) {
  const d = useDraft(() => ({
    min_hours_full_day: emp.min_hours_full_day != null ? String(emp.min_hours_full_day) : "",
    min_hours_half_day: emp.min_hours_half_day != null ? String(emp.min_hours_half_day) : "",
    normal_hours_per_day: emp.normal_hours_per_day != null ? String(emp.normal_hours_per_day) : "",
  }));
  const { busy, save } = useEmployeeSave(emp.id, onSaved, showToast);

  const submit = async () => {
    const v = d.draft!;
    const ok = await save({
      min_hours_full_day: num(v.min_hours_full_day) ?? null,
      min_hours_half_day: num(v.min_hours_half_day) ?? null,
      normal_hours_per_day: num(v.normal_hours_per_day) ?? null,
    }, "Attendance rule saved");
    if (ok) d.cancel();
  };

  return (
    <SectionCard
      title="Attendance Rule"
      canWrite={canWrite}
      editing={d.editing}
      dirty={d.dirty}
      busy={busy}
      onEdit={d.begin}
      onCancel={d.cancel}
      onSave={submit}
    >
      {d.editing ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Min hours for full day">
            <input type="number" min={0} step="0.25" className={inputCls} value={d.draft!.min_hours_full_day}
              onChange={(e) => d.patch({ min_hours_full_day: e.target.value })} />
          </Field>
          <Field label="Min hours for half day">
            <input type="number" min={0} step="0.25" className={inputCls} value={d.draft!.min_hours_half_day}
              onChange={(e) => d.patch({ min_hours_half_day: e.target.value })} />
          </Field>
          <Field label="Normal hours per day">
            <input type="number" min={0} step="0.25" className={inputCls} value={d.draft!.normal_hours_per_day}
              onChange={(e) => d.patch({ normal_hours_per_day: e.target.value })} />
          </Field>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          <InfoItem label="Min hours for full day">{emp.min_hours_full_day ?? "—"}</InfoItem>
          <InfoItem label="Min hours for half day">{emp.min_hours_half_day ?? "—"}</InfoItem>
          <InfoItem label="Normal hours per day">{emp.normal_hours_per_day ?? "—"}</InfoItem>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">Overrides branch policy when set.</p>
    </SectionCard>
  );
}

/* ------------------------------------------------- Project history tab */

function ProjectHistoryTab({ employeeId }: { employeeId: number }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    crmGet<any[]>(`/api/employees/${employeeId}/project-history`)
      .then((r) => { setRows(r.data || []); setError(""); })
      .catch((e) => setError(e?.message || "Failed to load project history"))
      .finally(() => setLoading(false));
  }, [employeeId]);

  const columns: Column<any>[] = [
    { key: "project_name", label: "Project", render: (r) => r.project_name || `#${r.project_id}` },
    { key: "role", label: "Role", render: (r) => r.role || "—" },
    { key: "start_date", label: "Start", render: (r) => fmtDate(r.start_date) },
    { key: "end_date", label: "End", render: (r) => (r.end_date ? fmtDate(r.end_date) : "Ongoing") },
  ];

  if (error) return <ErrorBox error={error} />;
  return <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No project history" />;
}
