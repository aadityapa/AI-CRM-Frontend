/** HR module pages: employee directory + detail page ("Tab 13: Employees").
 * Detail Profile tab (29 Sep 2026) = ONE page: completeness ring → Job details |
 * Personal details (field specs in crm/lib/employeeFields.ts) → Projects →
 * Addresses → Leave Balances → "More details" (education, experience,
 * attendance rule, separation), each card with its own Edit → Save.
 * Writes: HR (Admin implicit). Reads open to page viewers. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Briefcase, Building2, CalendarDays, ChevronDown, Download, FileSpreadsheet, FolderOpen, GraduationCap,
  History, IdCard, LogOut, Mail, MapPin, Pencil, Phone, Plus, Save, Trash2, User, UserCheck, Users, X,
  type LucideIcon,
} from "lucide-react";
import { HERO_BTN, HERO_BTN_SOLID, PageHeader } from "../components/PageHeader";
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
  Modal, Spinner, StatusBadge, useToast,
} from "../components/ui";
import { TeachingEmpty } from "../components/TeachingEmpty";
import { WizardAurora } from "../components/WizardAurora";
import { SearchableSelect, optionsFromStrings } from "../components/SearchableSelect";
import {
  COUNTRIES, DEFAULT_COUNTRY, INDIAN_CITIES, INDIAN_STATES,
} from "../constants/geo";
import {
  SectionHeaderBanner, WizardField,
} from "../components/wizard";
import {
  EMPLOYEE_CARDS, changedPayload, coreCount, displayValue, hiddenFields, missingCore, seedValue,
  validationError, visibleFields, type EmpCardKey, type EmpDraftValue, type EmpField,
} from "../lib/employeeFields";
import { usePageTab, useSessionState } from "../lib/pageState";

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

const fmtDate = (d?: string | null): string =>
  (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");

const num = (s: string): number | undefined => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
};

/** Trimmed string or null (for optional API string fields). */
const sOrNull = (v: string): string | null => {
  const t = v.trim();
  return t ? t : null;
};


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
    <div className="min-w-0 rounded-control border border-subtle bg-surface-2 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 break-words text-sm font-medium text-primary">{children ?? "—"}</div>
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

/** Icon for a section header, picked from its title (presentation only). */
function sectionIconFor(title: string): LucideIcon {
  const t = title.toLowerCase();
  if (t.includes("address")) return MapPin;
  if (t.includes("education")) return GraduationCap;
  if (t.includes("experience")) return Briefcase;
  if (t.includes("project")) return Briefcase;
  if (t.includes("office") || t.includes("job")) return Building2;
  if (t.includes("separation") || t.includes("exit")) return LogOut;
  if (t.includes("leave") || t.includes("attendance")) return CalendarDays;
  return User;
}

/** Up to two initials for the avatar. */
function initialsOf(name?: string | null): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] || "" : "")).toUpperCase();
}

/** Stable avatar gradient per person (presentation only). */
const AVATAR_TONES = [
  "from-teal-500 to-cyan-600", "from-sky-500 to-indigo-600", "from-violet-500 to-fuchsia-600",
  "from-amber-500 to-orange-600", "from-emerald-500 to-teal-600", "from-rose-500 to-pink-600",
];
function avatarTone(seed: string | number | undefined): string {
  const str = String(seed ?? "");
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

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
  subtitle,
  editLabel = "Edit",
  children,
}: {
  title: string;
  subtitle?: string;
  editLabel?: string;
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
  const SectionIcon = sectionIconFor(title);
  return (
    <motion.section
      className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised"
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
    >
      <div className={`flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-4 py-3 sm:px-5 ${
        editing ? "bg-brand-50 dark:bg-brand-900" : "bg-surface-2"
      }`}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-gradient-to-br from-teal-500 to-cyan-600 text-white shadow-raised" aria-hidden>
            <SectionIcon size={15} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-primary">{title}</h2>
            {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
          </div>
          {editing && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${dirty ? "bg-warning-soft text-warning" : "bg-info-soft text-info"}`}>
              {dirty ? "Unsaved changes" : "Editing"}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {headerExtra}
          {canWrite && onEdit && !editing && (
            <button className={btnSecondary} onClick={onEdit}>
              <Pencil size={14} /> {editLabel}
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
      <div className="px-4 py-4 sm:px-5">{children}</div>
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


/** Deployed (with the live project in the tooltip) or Bench — from the list
 *  endpoint's `deployment_status`; an inactive person shows neither. */
function DeploymentCell({ row }: { row: { deployment_status?: string | null; current_projects?: { project: string; customer: string | null }[] } }) {
  if (!row.deployment_status) return <span className="text-muted">—</span>;
  if (row.deployment_status === "Bench") {
    return <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-bold text-warning">Bench</span>;
  }
  const where = (row.current_projects || []).map((p) => [p.project, p.customer].filter(Boolean).join(" · ")).join("\n");
  return (
    <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-bold text-success" title={where || undefined}>
      Deployed{(row.current_projects?.length || 0) > 1 ? ` ×${row.current_projects!.length}` : ""}
    </span>
  );
}

export function EmployeesListPage() {
  /* Both hooks must run unconditionally (rules-of-hooks) — combine after. */
  const canWriteRole = useHasRole("HR");
  const canWrite = useCanAct("employees", "edit", canWriteRole);
  const [tab, setTab] = usePageTab<string>("status", "All", EMP_TABS.map((t) => t.key));
  const [search, setSearch] = useSessionState("emp.search", "");
  const [deptFilter, setDeptFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  /**
   * Blank = the server's default (joining date, newest first). "Recently
   * updated" exists because joining date cannot answer "who changed just now"
   * (22 Sep 2026): an internal employee with Karnex since 2022 who was placed
   * with a customer today still sorts by 2022 and lands near the bottom.
   */
  const [sortBy, setSortBy] = useState("");
  /** "bench" = active and on no live project today (25 Sep 2026) — where a
   *  closed project's team lands. Server-side filter, so paging stays right. */
  const [deploymentFilter, setDeploymentFilter] = useState(() => {
    // Deep link from the CEO dashboard's Deployed / Bench tiles (28 Sep 2026).
    const v = new URLSearchParams(window.location.search).get("deployment") || "";
    return v === "bench" || v === "deployed" ? v : "";
  });
  const [page, setPage] = useSessionState("emp.page", 1);
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
        // Default (DOJ) is sent as undefined so the server owns it in one place.
        sort_by: sortBy || undefined,
        deployment: deploymentFilter || undefined,
        search,
        page,
        limit: 20,
      })}`)
        .then((r) => { if (alive) { setRows(r.data || []); setMeta(r.meta); setError(""); } })
        .catch((e) => { if (alive) setError(e?.message || "Failed to load employees"); })
        .finally(() => { if (alive) setLoading(false); });
    }, search ? 300 : 0);
    return () => { alive = false; window.clearTimeout(t); };
  }, [tab, search, deptFilter, typeFilter, sortBy, deploymentFilter, page, reloadKey]);

  const columns: Column<any>[] = [
    { key: "employee_code", label: "Emp ID", className: "whitespace-nowrap",
      render: (r) => r.employee_code ? <span className="font-mono text-xs font-semibold text-secondary">{r.employee_code}</span> : <span className="text-muted">—</span> },
    { key: "full_name", label: "Name", render: (r) => (
      <div className="flex min-w-[12rem] items-center gap-2.5">
        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xs font-bold text-white shadow-raised ${avatarTone(r.id ?? r.full_name)}`} aria-hidden>
          {initialsOf(r.full_name)}
        </span>
        <div className="min-w-0">
          <div className="truncate font-semibold text-primary">{r.full_name}</div>
          <div className="truncate text-xs text-muted">{r.email || "—"}</div>
        </div>
      </div>
    ) },
    { key: "designation", label: "Designation", render: (r) => (
      <div className="min-w-[8rem]">
        <div className="font-medium text-primary">{r.designation_id ? designations[r.designation_id] || `#${r.designation_id}` : "—"}</div>
        <div className="text-xs text-muted">{r.department_id ? departments[r.department_id] || `#${r.department_id}` : "No department"}</div>
      </div>
    ) },
    { key: "profile_type", label: "Type", render: (r) => <TypeBadge type={r.profile_type} /> },
    { key: "date_of_joining", label: "Joined", className: "whitespace-nowrap", render: (r) => (
      <span className="inline-flex items-center gap-1 text-secondary"><CalendarDays size={12} className="text-muted" aria-hidden />{fmtDate(r.date_of_joining)}</span>
    ) },
    { key: "is_active", label: "Status", render: (r) => <StatusBadge status={r.is_active ? "Active" : "Inactive"} /> },
    { key: "deployment_status", label: "Deployment", render: (r) => <DeploymentCell row={r} /> },
  ];

  const filters = (
    <>
      <select className={`${inputCls} !w-48`} value={deploymentFilter}
              onChange={(e) => { setDeploymentFilter(e.target.value); setPage(1); }} title="Deployment">
        <option value="">Bench & deployed</option>
        <option value="bench">On the bench</option>
        <option value="deployed">Deployed</option>
      </select>
      <select className={`${inputCls} !w-44`} value={deptFilter} onChange={(e) => { setDeptFilter(e.target.value); setPage(1); }}>
        <option value="">All departments</option>
        {Object.entries(departments).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
      <select className={`${inputCls} !w-36`} value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
        <option value="">All types</option>
        <option value="Internal">Internal</option>
        <option value="External">External</option>
      </select>
      {/* `!w-44` — the `!` matters: `inputCls` ends in `w-full`, which beats a
          plain `w-44` appended after it (see F-V2 CLAUDE.md). */}
      <select
        className={`${inputCls} !w-44`}
        value={sortBy}
        onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
        title="Sort the list"
      >
        {/* "" = the server default: latest first (recently updated — a new
            joiner or an internal one the join just updated tops the list). */}
        <option value="">Latest first</option>
        <option value="date_of_joining">Newest joiner first</option>
        <option value="name">Name (A–Z)</option>
      </select>
    </>
  );

  /* Headline chips — read-only, from what the page already loaded. */
  const deployedHere = rows.filter((r) => r.deployment_status === "Deployed").length;
  const benchHere = rows.filter((r) => r.deployment_status === "Bench").length;
  const heroStats = [
    { label: meta?.total === 1 ? "employee" : "employees", value: meta ? meta.total : "—" },
    { label: "deployed on this page", value: deployedHere, title: "Deployed people among the rows shown" },
    { label: "on the bench on this page", value: benchHere, title: "Bench people among the rows shown" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Users}
        accent="teal"
        eyebrow="People"
        title="Employees"
        subtitle="The Karnex directory — who works here, where they are deployed and who is on the bench."
        stats={heroStats}
        actions={
          <>
            <button className={HERO_BTN} onClick={exportEmployees} disabled={exporting}>
              <Download size={15} aria-hidden /> {exporting ? "Exporting…" : "Export"}
            </button>
            {canWrite && (
              <button className={HERO_BTN} onClick={() => setShowBulk(true)}>
                <FileSpreadsheet size={15} aria-hidden /> Bulk upload
              </button>
            )}
            {canWrite && (
              <button className={HERO_BTN_SOLID} onClick={() => setShowNew(true)}>
                <Plus size={15} /> New Employee
              </button>
            )}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Employee status">
          {EMP_TABS.map((t) => {
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => { setTab(t.key); setPage(1); }}
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${focusRing} ${
                  on
                    ? "bg-gradient-to-r from-teal-600 to-cyan-700 text-white shadow-raised"
                    : "bg-surface-2 text-secondary ring-1 ring-inset ring-black/5 hover:text-primary dark:ring-white/10"
                }`}
              >
                {t.label}
              </button>
            );
          })}
          <span className="ml-auto hidden text-xs text-muted sm:inline">
            Click a person to open their record · right-click for a new tab
          </span>
        </div>
      </PageHeader>
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
        onRowClick={(r) => crmNavigate(`employees/${r.id}`)} rowHref={(r: any) => `employees/${r.id}`}
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
          <div className="rounded-card border border-subtle bg-surface-2 p-4 text-sm text-secondary">
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
const DETAIL_TAB_ICONS: Record<string, LucideIcon> = {
  profile: UserCheck,
  employee_history: History,
  history: Briefcase,
};

export function EmployeeDetailPage() {
  const { id } = useCrmParams();
  /* Both hooks must run unconditionally (rules-of-hooks) — combine after. */
  const canWriteRole = useHasRole("HR");
  const canWrite = useCanAct("employees", "edit", canWriteRole);
  const [emp, setEmp] = useState<any | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = usePageTab<string>("tab", "profile", DETAIL_TABS.map((t) => t.key));
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

  const mailOk = typeof emp.email === "string" && emp.email.includes("@");
  const pillCls = "inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold text-white ring-1 ring-inset ring-white/25";
  const bandFacts: { label: string; value: React.ReactNode }[] = [
    { label: "Designation", value: emp.designation_name || "—" },
    { label: "Department", value: emp.department_name || "—" },
    { label: "Reporting manager", value: emp.reporting_manager_name || "—" },
    { label: "Joined", value: fmtDate(emp.date_of_joining) },
  ];

  return (
    <div className="space-y-4">
      {/* Identity band (29 Sep 2026 redesign) — presentation only; every figure
          is from the employee payload already loaded above. */}
      <header className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="relative bg-gradient-to-r from-teal-700 via-emerald-700 to-cyan-800 px-4 py-5 text-white sm:px-6">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
          <nav className="relative mb-3 flex items-center gap-1.5 text-xs font-semibold text-white/80" aria-label="Breadcrumb">
            <CrmLink to="employees" className={`rounded-control text-white/90 hover:text-white hover:underline ${focusRing}`}>Employees</CrmLink>
            <span aria-hidden>/</span>
            <span className="truncate">{emp.full_name}</span>
          </nav>
          <div className="relative flex min-w-0 flex-wrap items-start gap-4">
            <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/15 text-lg font-bold ring-2 ring-white/40" aria-hidden>
              {initialsOf(emp.full_name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-display break-words text-2xl font-bold leading-tight">{emp.full_name}</h1>
                {emp.employee_code && (
                  <span className={`${pillCls} font-mono`}><IdCard size={12} aria-hidden /> {emp.employee_code}</span>
                )}
              </div>
              <div className="mt-1 text-sm text-white/85">
                {[emp.designation_name, emp.department_name].filter(Boolean).join(" · ") || "No designation recorded"}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <TypeBadge type={emp.profile_type} />
                <StatusBadge status={emp.is_active ? "Active" : "Inactive"} />
                {(emp.is_exit || emp.is_resigned) && <StatusBadge status="Exited" />}
                {emp.deployment_status && <DeploymentCell row={emp} />}
                {emp.email && (
                  mailOk
                    ? <a href={`mailto:${emp.email}`} className={`${pillCls} hover:bg-white/25`}><Mail size={12} aria-hidden /> {emp.email}</a>
                    : <span className={pillCls}><Mail size={12} aria-hidden /> {emp.email}</span>
                )}
                {emp.phone && <span className={pillCls}><Phone size={12} aria-hidden /> {emp.phone}</span>}
              </div>
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-2 border-t border-subtle bg-surface-1 sm:grid-cols-4">
          {bandFacts.map((f) => (
            <div key={f.label} className="min-w-0 px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{f.label}</dt>
              <dd className="mt-0.5 truncate text-sm font-semibold text-primary" title={typeof f.value === "string" ? f.value : undefined}>{f.value}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-subtle px-3 py-2 sm:px-4">
          <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Employee sections">
            {DETAIL_TABS.map((t) => {
              const on = tab === t.key;
              const Icon = DETAIL_TAB_ICONS[t.key] || User;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => {
                    setTab(t.key);
                    if (t.key === "employee_history") setHistoryOpened(true);
                  }}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-control px-3 py-2 text-sm font-semibold transition-colors ${focusRing} ${
                    on
                      ? "bg-gradient-to-r from-teal-600 to-cyan-700 text-white shadow-raised"
                      : "text-secondary hover:bg-surface-2 hover:text-primary"
                  }`}
                >
                  <Icon size={15} aria-hidden /> {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {tab === "profile" && <EmployeeProfile {...common} />}

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

/* ------------------------------------------ Profile: one page, core first */
/*
 * 29 Sep 2026 (user ask: "only the required details on the Employee page, and
 * make adding details easy"). The 7-step wizard of read-only boxes — most of
 * them "—" — is gone. The Profile tab is ONE page:
 *   completeness ring + "Add …" chips for every core detail still missing
 *   → Job details | Personal details (+ CV)   (crm/lib/employeeFields.ts)
 *   → Current projects → Addresses → Leave balances
 *   → "More" (education, experience, attendance rule, separation), collapsed.
 * A card shows its CORE fields and any optional field that holds something;
 * blank optional fields wait behind "Add more details". A save sends only the
 * fields that changed.
 */

type OpenSignal = { card: EmpCardKey; field?: string; n: number } | null;
type Option = { id: number; name: string };
type Masters = { departments: Option[]; designations: Option[]; people: Option[] };

/** Departments · designations · active people for the pickers (writers only). */
function useEmployeeMasters(enabled: boolean, selfId: number): Masters {
  const [m, setM] = useState<Masters>({ departments: [], designations: [], people: [] });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const named = (rows: any[]) => rows.map((x) => ({ id: x.id, name: x.name || x.full_name || `${x.first_name || ""} ${x.last_name || ""}`.trim() }));
    Promise.all([
      fetchAllMaster<any>("/api/departments").catch(() => []),
      fetchAllMaster<any>("/api/designations").catch(() => []),
      fetchAllMaster<any>("/api/employees?is_active=true").catch(() => []),
    ]).then(([d, g, p]) => {
      if (!alive) return;
      setM({ departments: named(d), designations: named(g), people: named(p).filter((x) => x.id !== selfId) });
    });
    return () => { alive = false; };
  }, [enabled, selfId]);
  return m;
}

/** One input for one field spec. */
function EmpFieldInput({ f, value, onChange, masters, current, disabled }: {
  f: EmpField;
  value: EmpDraftValue;
  onChange: (v: EmpDraftValue) => void;
  masters: Masters;
  /** The readable current value of a `ref` field (so it shows before the list loads). */
  current?: string | null;
  disabled?: boolean;
}) {
  const common = { id: `emp-f-${f.key}`, "data-field": f.key, disabled, className: inputCls };
  if (f.kind === "toggle") {
    return (
      <div className="flex h-10 items-center gap-2">
        <Toggle checked={Boolean(value)} onChange={onChange} label={f.label} disabled={disabled} />
        <span className="text-sm font-semibold text-secondary">
          {f.key === "is_active" ? (value ? "Active" : "Inactive") : (value ? "Yes" : "No")}
        </span>
      </div>
    );
  }
  if (f.kind === "skills") return <SkillsInput value={value as string[]} onChange={onChange} />;
  if (f.kind === "select" || f.kind === "ref") {
    const list = f.kind === "select"
      ? (f.options || [])
      : masters[f.ref!].map((o) => ({ value: String(o.id), label: o.name }));
    const known = list.some((o) => o.value === value);
    return (
      <select {...common} value={String(value)} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {!known && value ? <option value={String(value)}>{current || `#${value}`}</option> : null}
        {list.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  const type = f.kind === "money" || f.kind === "number" ? "number" : f.kind === "text" ? "text" : f.kind;
  return (
    <div className="relative">
      {f.kind === "money" && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">₹</span>}
      <input {...common} type={type} min={type === "number" ? 0 : undefined}
        step={f.kind === "number" ? "0.25" : undefined}
        className={`${inputCls} ${f.kind === "money" ? "pl-7" : ""}`}
        value={String(value)} maxLength={f.maxLength} placeholder={f.placeholder}
        onChange={(e) => onChange(f.upper ? e.target.value.toUpperCase() : e.target.value)} />
    </div>
  );
}

/** A card of employee fields: core + filled ones to read, a short form to edit. */
function DetailsCard({ cardKey, emp, canWrite, onSaved, showToast, masters, open, skip, locked, footer, emptyText }: SectionProps & {
  cardKey: EmpCardKey;
  masters: Masters;
  open: OpenSignal;
  /** Fields this login may not see at all (e.g. CTC without the field grant). */
  skip: (f: EmpField) => boolean;
  /** Fields this login may see but not change. */
  locked: (f: EmpField) => boolean;
  footer?: React.ReactNode;
  /** Said when the card has nothing to show yet (no core fields, nothing filled). */
  emptyText?: string;
}) {
  const spec = EMPLOYEE_CARDS[cardKey];
  const fields = useMemo(() => spec.fields.filter((f) => !skip(f)), [spec, skip]);
  const [draft, setDraft] = useState<Record<string, EmpDraftValue> | null>(null);
  const [more, setMore] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { busy, save } = useEmployeeSave(emp.id, onSaved, showToast);

  const shown = visibleFields(emp, fields);
  const extra = hiddenFields(emp, fields);

  const begin = (opts: { more?: boolean; field?: string } = {}) => {
    const seed: Record<string, EmpDraftValue> = {};
    fields.forEach((f) => { seed[f.key] = seedValue(emp, f); });
    setDraft(seed);
    setMore(Boolean(opts.more));
    setFocusKey(opts.field || null);
  };

  /* "Add …" on the completeness card opens THIS card on that field. */
  useEffect(() => {
    if (!open || open.card !== cardKey || !canWrite) return;
    begin({ field: open.field, more: extra.some((f) => f.key === open.field) });
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.n]);

  useEffect(() => {
    if (!draft || !focusKey) return;
    const t = window.setTimeout(() => {
      ref.current?.querySelector<HTMLElement>(`[data-field="${focusKey}"]`)?.focus();
      setFocusKey(null);
    }, 60);
    return () => window.clearTimeout(t);
  }, [draft, focusKey]);

  const payload = draft ? changedPayload(emp, fields, draft) : {};
  const dirty = Object.keys(payload).length > 0;

  const submit = async () => {
    if (!draft) return;
    const err = validationError(Object.fromEntries(Object.keys(payload).map((k) => [k, draft[k]])));
    if (err) { showToast(err, "err"); return; }
    if (await save(payload, `${spec.title} saved`)) setDraft(null);
  };

  const inputFor = (f: EmpField) => (
    <div key={f.key} className={f.kind === "skills" ? "sm:col-span-2" : undefined}>
      <Field label={f.label} required={f.mandatory}>
        <EmpFieldInput f={f} value={draft![f.key]} masters={masters} current={f.display ? emp[f.display] : null}
          disabled={locked(f)} onChange={(v) => setDraft((d) => (d ? { ...d, [f.key]: v } : d))} />
      </Field>
    </div>
  );

  return (
    <div ref={ref} className="scroll-mt-20">
      <SectionCard title={spec.title} subtitle={spec.subtitle} canWrite={canWrite} editing={draft != null}
        dirty={dirty} busy={busy} onEdit={() => begin()} onCancel={() => setDraft(null)} onSave={submit}>
        {draft ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{shown.map(inputFor)}</div>
            {extra.length > 0 && (
              <div className="rounded-card border border-dashed border-subtle">
                <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-brand-700 dark:text-brand-300 ${focusRing}`}>
                  <span className="inline-flex items-center gap-1.5"><Plus size={14} aria-hidden /> Add more details ({extra.length})</span>
                  <span className="text-xs font-normal text-muted">{more ? "Hide" : extra.map((f) => f.label).slice(0, 3).join(" · ") + (extra.length > 3 ? " …" : "")}</span>
                </button>
                {more && <div className="grid grid-cols-1 gap-3 border-t border-subtle p-3 sm:grid-cols-2">{extra.map(inputFor)}</div>}
              </div>
            )}
            <p className="text-xs text-muted">Only what you change is saved. <span className="text-danger">*</span> required to save.</p>
          </div>
        ) : (
          <>
            {shown.length === 0 && emptyText && <p className="text-sm text-secondary">{emptyText}</p>}
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {shown.map((f) => {
                const v = displayValue(emp, f);
                return (
                  <div key={f.key} className="min-w-0 border-b border-subtle pb-2">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{f.label}</dt>
                    <dd className="mt-0.5 break-words text-sm font-medium text-primary">
                      {v != null ? (f.key === "is_active" ? <StatusBadge status={emp.is_active ? "Active" : "Inactive"} /> : v)
                        : canWrite ? (
                          <button type="button" onClick={() => begin({ field: f.key })}
                            className={`inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning hover:underline ${focusRing}`}>
                            <Plus size={11} aria-hidden /> Add
                          </button>
                        ) : <span className="text-muted">Not added</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>
            {canWrite && extra.length > 0 && (
              <button type="button" onClick={() => begin({ more: true })}
                className={`mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300 ${focusRing}`}>
                <Plus size={13} aria-hidden /> Add more details — {extra.map((f) => f.label).slice(0, 3).join(", ")}{extra.length > 3 ? ` +${extra.length - 3}` : ""}
              </button>
            )}
          </>
        )}
        {footer}
      </SectionCard>
    </div>
  );
}

/** How much of the core record is there, and one click to add each gap. */
function ProfileCompleteness({ emp, skip, canWrite, onAdd }: {
  emp: any;
  skip: (f: EmpField) => boolean;
  canWrite: boolean;
  onAdd: (card: EmpCardKey, field: string) => void;
}) {
  const missing = missingCore(emp, skip);
  const total = coreCount(skip);
  const done = total - missing.length;
  const pct = total ? Math.round((done / total) * 100) : 100;
  const r = 22;
  const c = 2 * Math.PI * r;
  const tone = pct === 100 ? "text-success" : pct >= 70 ? "text-brand-600" : "text-warning";
  return (
    <section className="flex flex-wrap items-center gap-4 rounded-card border border-subtle bg-surface-1 px-4 py-3 shadow-raised" aria-label="Profile completeness">
      <svg viewBox="0 0 56 56" className={`h-14 w-14 shrink-0 ${tone}`} aria-hidden>
        <circle cx="28" cy="28" r={r} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="6" />
        <circle cx="28" cy="28" r={r} fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform="rotate(-90 28 28)" />
        <text x="28" y="32" textAnchor="middle" className="fill-current text-[12px] font-bold">{pct}%</text>
      </svg>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-primary">
          {missing.length ? `${done} of ${total} key details recorded` : "Every key detail is recorded"}
        </div>
        {missing.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {missing.map(({ card, field }) => canWrite ? (
              <button key={field.key} type="button" onClick={() => onAdd(card, field.key)}
                className={`inline-flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-semibold text-warning hover:underline ${focusRing}`}>
                <Plus size={11} aria-hidden /> {field.label}
              </button>
            ) : (
              <span key={field.key} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-muted">{field.label}</span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted">Optional details can still be added from each card.</p>
        )}
      </div>
    </section>
  );
}

/** A collapsed group for the rarely-touched sections; mounts its body on first open. */
function MoreSection({ title, hint, icon: Icon, children, defaultOpen = false }: {
  title: string; hint: string; icon: LucideIcon; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 ${focusRing}`}>
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-gradient-to-br from-slate-500 to-slate-700 text-white shadow-raised" aria-hidden>
          <Icon size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-primary">{title}</span>
          <span className="block truncate text-xs text-muted">{hint}</span>
        </span>
        <ChevronDown size={16} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && <div className="space-y-4 border-t border-subtle bg-surface-2 p-3 sm:p-4">{children}</div>}
    </section>
  );
}

function EmployeeProfile({ emp, canWrite, onSaved, showToast }: SectionProps) {
  const acc = useCrmAccess("employees");
  const canSeeCtc = acc.canViewField("current_ctc");
  const canEditCtc = acc.canEditField("current_ctc");
  const skip = useCallback((f: EmpField) => f.key === "current_ctc" && !canSeeCtc, [canSeeCtc]);
  const locked = useCallback((f: EmpField) => f.key === "current_ctc" && !canEditCtc, [canEditCtc]);
  const masters = useEmployeeMasters(canWrite, emp.id);
  const [open, setOpen] = useState<OpenSignal>(null);
  const common = { emp, canWrite, onSaved, showToast, masters, open, skip, locked };
  const resigned = Boolean(emp.is_resigned || emp.is_exit);

  /* CV upload persists immediately (independent of the card's edit mode). */
  const cv = (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-subtle pt-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">CV</span>
      {emp.cv_url ? <FileLink url={emp.cv_url} label="View CV" /> : <span className="text-sm text-muted">Not uploaded</span>}
      {canWrite && (
        <FileUploadButton path={`/api/employees/${emp.id}/cv`} label={emp.cv_url ? "Replace CV" : "Upload CV"}
          accept=".pdf,.doc,.docx" onDone={() => { showToast("CV uploaded"); onSaved(); }}
          onError={(m) => showToast(m, "err")} />
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <ProfileCompleteness emp={emp} skip={skip} canWrite={canWrite}
        onAdd={(card, field) => setOpen((o) => ({ card, field, n: (o?.n || 0) + 1 }))} />
      {resigned && <SeparationSection emp={emp} canWrite={canWrite} onSaved={onSaved} showToast={showToast} />}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <DetailsCard cardKey="job" {...common} />
        <DetailsCard cardKey="personal" {...common} footer={cv} />
      </div>
      <ProjectsSection emp={emp} />
      <AddressSection emp={emp} canWrite={canWrite} onSaved={onSaved} showToast={showToast} />
      <LeaveBalancesSection employeeId={emp.id} canWrite={canWrite} showToast={showToast} />
      <MoreSection title="More details" icon={FolderOpen}
        hint={`Education · Experience · Attendance rule${resigned ? "" : " · Resignation"} — open only when you need them`}>
        <EducationSection employeeId={emp.id} canWrite={canWrite} showToast={showToast} />
        <ExperienceSection employeeId={emp.id} canWrite={canWrite} showToast={showToast} />
        <DetailsCard cardKey="attendance" {...common}
          emptyText="Follows the branch / project attendance policy. Set hours here only for an exception." />
        {!resigned && <SeparationSection emp={emp} canWrite={canWrite} onSaved={onSaved} showToast={showToast} />}
      </MoreSection>
    </div>
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

/** Anything beyond the default country recorded? */
const hasAddress = (a?: any): boolean =>
  [a?.line1, a?.line2, a?.city, a?.state, a?.postal_code].some((x) => x && String(x).trim());

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

  const addressEmpty = !hasAddress(emp.present_address) && !hasAddress(emp.permanent_address);

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
      editLabel={addressEmpty ? "Add address" : "Edit"}
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
        <p className="text-sm text-muted">No education recorded yet{canWrite ? " — use Add to record a degree or certificate" : ""}.</p>
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
        <p className="text-sm text-muted">No earlier employers recorded{canWrite ? " — use Add to record one" : ""}.</p>
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
      subtitle={emp.is_resigned ? "Resignation, notice period and last working day" : undefined}
      editLabel={emp.is_resigned ? "Edit" : "Record resignation"}
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
      ) : !emp.is_resigned ? (
        <p className="text-sm text-secondary">No resignation recorded — this person is currently employed.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
  /* Leave types with nothing accrued, taken or left are hidden until asked for
     (29 Sep 2026: six rows of zeros read as noise, not information). */
  const [showAllTypes, setShowAllTypes] = useState(false);

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
        (() => {
          const nonZero = (v: number | null | undefined) => Number(v || 0) !== 0;
          const active = matrix.rows.filter((r) => nonZero(r.accrual) || nonZero(r.consumed) || nonZero(r.balance));
          const listed = showAllTypes ? matrix.rows : active;
          const tiles = [
            { label: "Earned leave carried from last year", value: matrix.el_carry_forward_last_year },
            { label: "Comp-off carried from last year", value: matrix.comp_off_carry_forward_last_year },
            { label: "Loss of pay", value: matrix.loss_of_pay },
          ].filter((t) => nonZero(t.value));
          const toggle = active.length < matrix.rows.length && (
            <button type="button" onClick={() => setShowAllTypes((v) => !v)}
              className={`mt-2 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300 ${focusRing}`}>
              {showAllTypes ? "Hide leave types with nothing recorded"
                : `Show all ${matrix.rows.length} leave types`}
            </button>
          );
          return (
        <>
          {listed.length === 0 ? (
            <p className="text-sm text-secondary">No leave accrued or taken in {year} yet.</p>
          ) : (
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
                {listed.map((r) => (
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
          )}
          {toggle}
          {tiles.length > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {tiles.map((t) => <StatTile key={t.label} label={t.label} value={t.value} />)}
            </div>
          )}
        </>
          );
        })()
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------- Project history tab */

/** Rupees, en-IN, no decimals — the same shape every money cell in the CRM uses. */
function money(n: number | null | undefined): string {
  return n === null || n === undefined
    ? "—"
    : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

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

  // "Where has this person worked, and what was the placement FOR." A project
  // name and two dates answered the first half only (22 Sep 2026) — the
  // customer, the deal and the headcount it was sourcing for are the context
  // that makes a history row mean anything. All server-derived; see
  // `project_history_context` for the batched lookup.
  const columns: Column<any>[] = [
    {
      key: "project_name",
      label: "Project",
      render: (r) => (
        <span>
          <CrmLink to={`projects/${r.project_id}`} className="font-semibold hover:underline">
            {r.project_name || `#${r.project_id}`}
          </CrmLink>
          {r.customer_name && <span className="block text-xs text-muted">{r.customer_name}</span>}
        </span>
      ),
    },
    {
      key: "opportunity",
      label: "Opportunity",
      render: (r) => (r.opportunity_id ? (
        <span>
          <CrmLink to={`opportunities/${r.opportunity_id}`} className="hover:underline">
            {r.opportunity_opp_id || `#${r.opportunity_id}`}
          </CrmLink>
          {r.opportunity_title && (
            <span className="block text-xs text-muted">{r.opportunity_title}</span>
          )}
        </span>
      ) : <span className="text-muted">Direct placement</span>),
    },
    // The designation held ON that project, captured at assignment — not the
    // employee's current one, which may have moved on since.
    { key: "role", label: "Position held", render: (r) => r.role || "—" },
    {
      key: "positions_total",
      label: "Headcount",
      className: "text-right",
      render: (r) => (r.positions_total ?? "—"),
    },
    {
      key: "billing_rate",
      label: "Rate",
      className: "text-right",
      render: (r) => (r.billing_rate
        ? <span className="tabular-nums">{money(r.billing_rate)}
            <span className="ml-1 text-xs text-muted">
              {String(r.billing_unit || "").replace(/_/g, " ")}
            </span>
          </span>
        : "—"),
    },
    { key: "start_date", label: "Start", render: (r) => fmtDate(r.start_date) },
    {
      key: "end_date",
      label: "End",
      render: (r) => (r.end_date
        ? fmtDate(r.end_date)
        : <StatusBadge status="Active" label="Ongoing" />),
    },
  ];

  if (error) return <ErrorBox error={error} />;
  return <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No project history" />;
}
