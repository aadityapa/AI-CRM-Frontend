/** Users administration (Admin-only): list/search users, create users with CRM
 * roles, replace roles, activate/deactivate, toggle employee portal access. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, Lock, Plus, Shield, ShieldCheck, SlidersHorizontal, Trash2, UserCheck, UserCog, UserX, Crown, Briefcase, Users, Wallet } from "lucide-react";
import { crmGet, crmPost, crmDelete, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole, useMe } from "../CrmApp";
import { crmNavigate } from "../routerHooks";
import {
  allManageableTabKeys,
  manageableTabsForRoles,
  MANAGEABLE_TABS,
  TAB_FIELDS,
  tabHasFields,
  fieldAllowed,
  type ManageableTab,
  type TabGroup,
} from "../../lib/rbac";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import {
  ConfirmModal, ErrorBox, Modal, StatusBadge,
  btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";
import { SectionHeaderBanner, WizardField, FieldLabel } from "../components/wizard";

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

const CRM_ROLES = ["CEO", "Admin", "Sales", "Sales_Head", "RMG", "TA", "HR", "Finance"] as const;

type RoleGroup = "Governance" | "Sales" | "Recruitment" | "HR & Finance";

const ROLE_GROUPS: RoleGroup[] = ["Governance", "Sales", "Recruitment", "HR & Finance"];

const ROLE_META: Record<
  (typeof CRM_ROLES)[number],
  { label: string; group: RoleGroup; description: string; accent: "violet" | "sky" | "emerald" | "amber" }
> = {
  CEO: {
    label: "CEO",
    group: "Governance",
    description: "Super-admin — full platform access and per-user tab control",
    accent: "violet",
  },
  Admin: {
    label: "Admin",
    group: "Governance",
    description: "CRM & interview platform administrator",
    accent: "violet",
  },
  Sales: {
    label: "Sales",
    group: "Sales",
    description: "Customers, opportunities, requirements, and profiles",
    accent: "sky",
  },
  Sales_Head: {
    label: "Sales Head",
    group: "Sales",
    description: "Approvals, executive dashboards, and offer workflows",
    accent: "sky",
  },
  RMG: {
    label: "RMG",
    group: "Recruitment",
    description: "Engineering review, sourcing, and candidate profiles",
    accent: "emerald",
  },
  TA: {
    label: "TA",
    group: "Recruitment",
    description: "Resumes, ATS scoring, and AI interview scheduling",
    accent: "emerald",
  },
  HR: {
    label: "HR",
    group: "HR & Finance",
    description: "Employees, timesheets, staffing, and onboarding",
    accent: "amber",
  },
  Finance: {
    label: "Finance",
    group: "HR & Finance",
    description: "Purchase orders, invoices, payments, and TDS",
    accent: "amber",
  },
};

const GROUP_ICON: Record<RoleGroup, React.ComponentType<{ size?: number | string; className?: string }>> = {
  Governance: Crown,
  Sales: Briefcase,
  Recruitment: Users,
  "HR & Finance": Wallet,
};

const ACCENT_SELECTED: Record<(typeof ROLE_META)[keyof typeof ROLE_META]["accent"], string> = {
  violet:
    "border-violet-300 bg-violet-50/70 dark:border-violet-800/60 dark:bg-violet-950/30",
  sky: "border-sky-300 bg-sky-50/60 dark:border-sky-800/60 dark:bg-sky-950/30",
  emerald:
    "border-emerald-300 bg-emerald-50/60 dark:border-emerald-800/60 dark:bg-emerald-950/30",
  amber:
    "border-amber-300 bg-amber-50/60 dark:border-amber-800/60 dark:bg-amber-950/30",
};

const ACCENT_CHIP: Record<(typeof ROLE_META)[keyof typeof ROLE_META]["accent"], string> = {
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

type UserRow = {
  id: number;
  full_name: string;
  email: string;
  username: string;
  legacy_role: string;
  is_active: boolean;
  roles: string[];
  tab_access?: string[] | null;
  access_template_id?: number | null;
};

type AccessTemplateOpt = { id: number; name: string; is_active: boolean };

type Notify = (msg: string, kind?: "ok" | "err") => void;

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

function RoleChips({ roles }: { roles: string[] }) {
  if (!roles.length) return <span className="text-xs text-muted">No CRM roles</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <span
          key={r}
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            r === "Admin"
              ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
              : "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
          }`}
        >
          {r.replace(/_/g, " ")}
        </span>
      ))}
    </span>
  );
}

function RoleSelector({
  selected,
  onChange,
  userName,
}: {
  selected: string[];
  onChange: (roles: string[]) => void;
  userName?: string;
}) {
  const toggle = (role: string, checked: boolean) =>
    onChange(checked ? [...selected, role] : selected.filter((r) => r !== role));

  const byGroup = (g: RoleGroup) =>
    CRM_ROLES.filter((r) => ROLE_META[r].group === g);

  return (
    <div className="space-y-4">
      {userName && (
        <div className="rounded-card border border-subtle bg-surface-2 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">Assigning roles for</div>
              <div className="text-sm font-bold text-primary">{userName}</div>
            </div>
            <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-bold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
              {selected.length} of {CRM_ROLES.length} selected
            </span>
          </div>
        </div>
      )}

      <div className="max-h-[56vh] space-y-4 overflow-y-auto pr-1">
        {ROLE_GROUPS.map((g) => {
          const items = byGroup(g);
          const Icon = GROUP_ICON[g];
          return (
            <div key={g}>
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted">
                <Icon size={13} className="opacity-70" />
                {g}
              </div>
              <div className="space-y-1.5">
                {items.map((r) => {
                  const meta = ROLE_META[r];
                  const checked = selected.includes(r);
                  return (
                    <label
                      key={r}
                      className={`flex cursor-pointer items-start gap-3 rounded-card border px-3 py-2.5 transition-colors duration-micro ${
                        checked
                          ? ACCENT_SELECTED[meta.accent]
                          : "border-subtle hover:border-strong hover:bg-surface-2"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 accent-sky-600"
                        checked={checked}
                        onChange={(e) => toggle(r, e.target.checked)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-primary">{meta.label}</span>
                          {checked && (
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${ACCENT_CHIP[meta.accent]}`}
                            >
                              Active
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                          {meta.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-subtle pt-3">
          {selected.map((r) => (
            <span
              key={r}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${ACCENT_CHIP[ROLE_META[r as (typeof CRM_ROLES)[number]].accent]}`}
            >
              {ROLE_META[r as (typeof CRM_ROLES)[number]].label}
              <button
                type="button"
                className="rounded-full px-0.5 opacity-70 hover:opacity-100"
                aria-label={`Remove ${r}`}
                onClick={() => toggle(r, false)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Compact grid for Create User (same visual language, less chrome). */
function RoleCheckboxes({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (roles: string[]) => void;
}) {
  return <RoleSelector selected={selected} onChange={onChange} />;
}

/* -------------------------------------------------------- create user */

function CreateUserModal({
  onClose,
  onSaved,
  notify,
}: {
  onClose: () => void;
  onSaved: () => void;
  notify: Notify;
}) {
  const [form, setForm] = useState({ full_name: "", email: "", username: "", password: "" });
  const [roles, setRoles] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.full_name.trim()) errs.full_name = "Full name is required";
    if (!form.email.trim()) errs.email = "Email is required";
    else if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errs.email = "Enter a valid email address";
    if (!form.username.trim()) errs.username = "Username is required";
    if (!form.password) errs.password = "Password is required";
    else if (form.password.length < 8) errs.password = "Password must be at least 8 characters";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const res = await crmPost("/api/users", {
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        username: form.username.trim(),
        password: form.password,
        roles,
      });
      notify(res.message || "User created");
      onSaved();
      onClose();
    } catch (err: any) {
      notify(err?.message || "Failed to create user", "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={<span className="sr-only">Create User</span>}
      onClose={onClose}
      fullScreen
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title="Create User"
        subtitle="Set up account credentials and assign the CRM roles this user needs."
        icon={<UserCog size={20} aria-hidden />}
      >
        <form onSubmit={submit} className="space-y-5">
          <WizardField label="Full name" required error={errors.full_name} icon="user" filled={!!form.full_name.trim() && !errors.full_name}>
            <input className={inputCls} value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
          </WizardField>
          <WizardField label="Email" required error={errors.email} icon="mail" filled={!!form.email.trim() && !errors.email}>
            <input className={inputCls} value={form.email} onChange={(e) => set("email", e.target.value)} />
          </WizardField>
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <WizardField label="Username" required error={errors.username} icon="user" filled={!!form.username.trim() && !errors.username}>
              <input className={inputCls} value={form.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" />
            </WizardField>
            <WizardField label="Password" required error={errors.password} icon="lock">
              <input
                type="password"
                className={inputCls}
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                placeholder="Min 8 characters"
                autoComplete="new-password"
              />
            </WizardField>
          </div>
          <div>
            <FieldLabel label="CRM roles" />
            <RoleCheckboxes selected={roles} onChange={setRoles} />
          </div>
          <div className={wizFooterRow}>
            <button type="button" className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`} disabled={saving}>{saving ? "Creating…" : "Create user"}</button>
          </div>
        </form>
      </WizFormShell>
    </Modal>
  );
}

/* --------------------------------------------------------- edit roles */

function EditRolesModal({
  user,
  onClose,
  onSaved,
  notify,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
  notify: Notify;
}) {
  const [roles, setRoles] = useState<string[]>(user.roles);
  const [saving, setSaving] = useState(false);
  const displayName = user.full_name || user.username;
  const unchanged =
    roles.length === user.roles.length && roles.every((r) => user.roles.includes(r));

  const submit = async () => {
    setSaving(true);
    try {
      const res = await crmPost(`/api/users/${user.id}/roles`, { roles });
      notify(res.message || "Roles updated");
      onSaved();
      onClose();
    } catch (err: any) {
      notify(err?.message || "Failed to update roles", "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={<span className="sr-only">{`Edit Roles — ${user.username}`}</span>}
      onClose={onClose}
      bodyClassName="!px-0 !py-0"
    >
      <WizFormShell
        title={`Edit Roles — ${user.username}`}
        subtitle="Select the CRM roles for this user — the selection replaces all existing roles."
        icon={<Shield size={20} aria-hidden />}
      >
      <p className="mb-3 text-sm text-muted">
        Choose which CRM roles <b>{displayName}</b> should have. The selection below{" "}
        <b>replaces all existing roles</b> — pick every role they need access to.
      </p>
      {roles.length === 0 && (
        <p className="mb-3 rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          No roles selected — this user will lose access to the CRM until roles are assigned.
        </p>
      )}
      <RoleSelector
        selected={roles}
        onChange={setRoles}
        userName={displayName}
      />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--wiz-border)] pt-5">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btnSecondary}
            onClick={() => setRoles([...CRM_ROLES])}
            disabled={saving}
          >
            Select all roles
          </button>
          <button
            type="button"
            className={btnSecondary}
            onClick={() => setRoles(user.roles)}
            disabled={saving || unchanged}
          >
            Reset to current
          </button>
          <button
            type="button"
            className={btnSecondary}
            onClick={() => setRoles([])}
            disabled={saving || roles.length === 0}
          >
            Clear all
          </button>
        </div>
        <div className="flex gap-2">
          <button className={btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button className={btnPrimary} onClick={submit} disabled={saving || unchanged}>
            {saving ? "Saving…" : "Save roles"}
          </button>
        </div>
      </div>
      </WizFormShell>
    </Modal>
  );
}

/* ----------------------------------------------------- edit tab access */

function TabAccessModal({
  user,
  onClose,
  onSaved,
  notify,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
  notify: Notify;
}) {
  // Admin sees every tab; role defaults only pre-check the boxes.
  const allTabs = MANAGEABLE_TABS;
  const allTabKeys = useMemo(() => allManageableTabKeys(), []);
  const rolePermittedKeys = useMemo(
    () => manageableTabsForRoles(user.roles).map((t) => t.key),
    [user.roles],
  );
  const mandatoryKeys = useMemo(
    () => allTabs.filter((t) => t.mandatory).map((t) => t.key),
    [allTabs],
  );

  const initial = useMemo(() => {
    const base =
      user.tab_access == null
        ? rolePermittedKeys
        : user.tab_access.filter((k) => allTabKeys.includes(k));
    return Array.from(new Set([...base, ...mandatoryKeys]));
  }, [user.tab_access, rolePermittedKeys, mandatoryKeys, allTabKeys]);

  const [selected, setSelected] = useState<string[]>(initial);
  const [saving, setSaving] = useState(false);
  // Per-tab field access. A tab absent = all its fields allowed.
  const [fieldAccess, setFieldAccess] = useState<Record<string, string[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  // Load the saved field_access for this user (GET returns tab_access + field_access).
  useEffect(() => {
    crmGet<{ field_access?: Record<string, string[]> | null }>(`/api/users/${user.id}/tab-access`)
      .then((r) => { if (r.data?.field_access) setFieldAccess(r.data.field_access); })
      .catch(() => {});
  }, [user.id]);

  const toggle = (key: string, on: boolean) => {
    if (mandatoryKeys.includes(key)) return; // can't hide mandatory tabs
    setSelected((cur) => (on ? Array.from(new Set([...cur, key])) : cur.filter((k) => k !== key)));
  };

  const toggleField = (tabKey: string, fieldKey: string, on: boolean) => {
    setFieldAccess((prev) => {
      const all = (TAB_FIELDS[tabKey] || []).map((f) => f.key);
      const cur = prev[tabKey] ?? all; // absent = all allowed
      const nextList = on ? Array.from(new Set([...cur, fieldKey])) : cur.filter((k) => k !== fieldKey);
      const next = { ...prev };
      if (nextList.length >= all.length) delete next[tabKey]; // full = no restriction
      else next[tabKey] = nextList;
      return next;
    });
  };

  const groups: TabGroup[] = ["Interview Platform", "CRM"];
  const byGroup = (g: TabGroup): ManageableTab[] => allTabs.filter((t) => t.group === g);

  const sameAsRoleDefaults = (keys: string[]) => {
    const withMandatory = Array.from(new Set([...keys, ...mandatoryKeys]));
    if (withMandatory.length !== rolePermittedKeys.length) return false;
    return rolePermittedKeys.every((k) => withMandatory.includes(k));
  };

  const submit = async () => {
    setSaving(true);
    try {
      const withMandatory = Array.from(new Set([...selected, ...mandatoryKeys]));
      const tabs = sameAsRoleDefaults(withMandatory) ? null : withMandatory;
      // Only keep field restrictions for tabs the user can actually see.
      const field_access: Record<string, string[]> = {};
      Object.entries(fieldAccess).forEach(([k, v]) => {
        if (withMandatory.includes(k) && v.length) field_access[k] = v;
      });
      const res = await crmPost(`/api/users/${user.id}/tab-access`, { tabs, field_access });
      notify(res.message || "Tab access updated");
      onSaved();
      onClose();
    } catch (err: any) {
      notify(err?.message || "Failed to update tab access", "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={<span className="sr-only">{`Edit Tab Access — ${user.username}`}</span>}
      onClose={onClose}
      bodyClassName="!px-0 !py-0"
    >
      <WizFormShell
        title={`Edit Tab Access — ${user.username}`}
        subtitle="Choose which tabs and fields this user can see — a per-user override on top of any Access Template."
        icon={<Lock size={20} aria-hidden />}
      >
      <p className="mb-3 text-sm text-muted">
        Per-user override on top of any assigned <b>Access Template</b> (override wins per tab/field).
        Choose which tabs <b>{user.full_name || user.username}</b> can see. Unchecked tabs are hidden.
      </p>
      {user.roles.length === 0 && (
        <p className="mb-3 text-xs text-amber-600 dark:text-amber-400">
          This user has no CRM roles yet. You can still set tab access; assign roles so they can sign in.
        </p>
      )}
      <div className="space-y-4 max-h-[56vh] overflow-y-auto pr-1">
        {groups.map((g) => {
          const items = byGroup(g);
          if (!items.length) return null;
          return (
            <div key={g}>
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">{g}</div>
              <div className="space-y-1.5">
                {items.map((t) => {
                  const isMandatory = t.mandatory;
                  const checked = selected.includes(t.key) || isMandatory;
                  const hasFields = tabHasFields(t.key);
                  const isOpen = expanded === t.key;
                  const restricted = !!fieldAccess[t.key]?.length;
                  return (
                    <div
                      key={t.key}
                      className={`rounded-card border transition-colors ${
                        checked
                          ? "border-sky-300 bg-sky-50/60 dark:border-sky-800/60 dark:bg-sky-950/30"
                          : "border-subtle"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 px-3 py-2">
                        <label
                          className={`flex flex-1 items-center gap-2.5 text-sm font-semibold ${
                            isMandatory ? "text-muted" : "text-primary"
                          }`}
                          title={isMandatory ? "Always available — cannot be hidden" : undefined}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-sky-600"
                            checked={checked}
                            disabled={isMandatory}
                            onChange={(e) => toggle(t.key, e.target.checked)}
                          />
                          {t.label}
                          {restricted && checked && (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                              some fields
                            </span>
                          )}
                        </label>
                        {checked && hasFields && (
                          <button
                            type="button"
                            className="rounded-control px-2 py-0.5 text-xs font-semibold text-sky-600 hover:bg-sky-100/70 dark:text-sky-300 dark:hover:bg-sky-900/40"
                            onClick={() => setExpanded(isOpen ? null : t.key)}
                          >
                            {isOpen ? "Hide fields" : "Fields"}
                          </button>
                        )}
                      </div>
                      {checked && hasFields && isOpen && (
                        <div className="border-t border-subtle px-3 py-2">
                          <p className="mb-1.5 text-xs text-muted">
                            Uncheck a field to hide it from this user on this page.
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {(TAB_FIELDS[t.key] || []).map((f) => {
                              const on = fieldAllowed(fieldAccess, t.key, f.key);
                              return (
                                <button
                                  key={f.key}
                                  type="button"
                                  onClick={() => toggleField(t.key, f.key, !on)}
                                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                                    on
                                      ? "border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-700 dark:bg-sky-900/50 dark:text-sky-200"
                                      : "border-subtle bg-transparent text-muted line-through"
                                  }`}
                                >
                                  {f.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--wiz-border)] pt-5">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btnSecondary}
            onClick={() => setSelected(allTabKeys)}
            disabled={saving}
          >
            Select all tabs
          </button>
          <button
            type="button"
            className={btnSecondary}
            onClick={() => setSelected(rolePermittedKeys)}
            disabled={saving}
          >
            Reset to role defaults
          </button>
        </div>
        <div className="flex gap-2">
          <button className={btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button className={btnPrimary} onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Save tab access"}
          </button>
        </div>
      </div>
      </WizFormShell>
    </Modal>
  );
}

/* --------------------------------------------------------------- page */

export function UsersAdminPage() {
  const isAdmin = useHasRole();
  const me = useMe();
  const [toast, notify] = useToast();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [rolesFor, setRolesFor] = useState<UserRow | null>(null);
  const [tabAccessFor, setTabAccessFor] = useState<UserRow | null>(null);
  const [toggleActiveFor, setToggleActiveFor] = useState<UserRow | null>(null);
  const [deleteFor, setDeleteFor] = useState<UserRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [portalBusyId, setPortalBusyId] = useState<number | null>(null);
  const [templates, setTemplates] = useState<AccessTemplateOpt[]>([]);
  const [templateBusyId, setTemplateBusyId] = useState<number | null>(null);
  const dSearch = useDebounced(search);

  useEffect(() => {
    crmGet<AccessTemplateOpt[]>("/api/access-templates")
      .then((r) => setTemplates((r.data || []).filter((t) => t.is_active)))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<UserRow[]>(`/api/users${qs({ page, limit: 20, search: dSearch })}`);
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [page, dSearch]);
  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);
  useEffect(() => { setPage(1); }, [dSearch]);

  if (!isAdmin) {
    return <ErrorBox error="Access denied: the Users page is available to Admins only." />;
  }

  const toggleActive = async () => {
    if (!toggleActiveFor) return;
    setBusy(true);
    try {
      const action = toggleActiveFor.is_active ? "deactivate" : "activate";
      const res = await crmPost(`/api/users/${toggleActiveFor.id}/${action}`);
      notify(res.message || `User ${action}d`);
      setToggleActiveFor(null);
      load();
    } catch (e: any) {
      notify(e?.message || "Failed to update user", "err");
    } finally {
      setBusy(false);
    }
  };

  const deleteUser = async () => {
    if (!deleteFor) return;
    setBusy(true);
    try {
      const res = await crmDelete(`/api/users/${deleteFor.id}`);
      notify(res.message || "User deleted");
      setDeleteFor(null);
      load();
    } catch (e: any) {
      notify(e?.message || "Failed to delete user", "err");
    } finally {
      setBusy(false);
    }
  };

  const assignTemplate = async (user: UserRow, templateId: number | null) => {
    setTemplateBusyId(user.id);
    try {
      const res = await crmPost("/api/access-templates/assign", {
        user_id: user.id,
        template_id: templateId,
      });
      notify(res.message || "Access template updated");
      setRows((prev) =>
        prev.map((r) => (r.id === user.id ? { ...r, access_template_id: templateId } : r)),
      );
    } catch (e: any) {
      notify(e?.message || "Failed to assign template", "err");
    } finally {
      setTemplateBusyId(null);
    }
  };

  const togglePortal = async (user: UserRow) => {
    setPortalBusyId(user.id);
    try {
      const res = await crmPost(`/api/users/${user.id}/portal-access`);
      notify(res.message || "Portal access updated");
    } catch (e: any) {
      // e.g. 404 "No employee is linked to this user"
      notify(e?.message || "Failed to toggle portal access", "err");
    } finally {
      setPortalBusyId(null);
    }
  };

  const actionBtn =
    "inline-flex items-center gap-1 rounded-control border border-strong px-2 py-1 text-xs font-semibold text-secondary hover:bg-surface-2 disabled:opacity-50";

  const columns: Column<UserRow>[] = [
    { key: "username", label: "Username", render: (r) => <span className="font-semibold text-primary">{r.username}</span> },
    { key: "full_name", label: "Full Name" },
    { key: "email", label: "Email" },
    { key: "roles", label: "CRM Roles", render: (r) => <RoleChips roles={r.roles} /> },
    {
      key: "access_template_id",
      label: "Access Template",
      render: (r) => (
        <select
          className={`${inputCls} min-w-[9rem] py-1 text-xs`}
          value={r.access_template_id ?? ""}
          disabled={templateBusyId === r.id}
          onChange={(e) => {
            const v = e.target.value;
            assignTemplate(r, v ? Number(v) : null);
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <option value="">— Role default —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      ),
    },
    { key: "is_active", label: "Status", render: (r) => <StatusBadge status={r.is_active ? "Active" : "Inactive"} /> },
    {
      key: "_actions",
      label: "Actions",
      className: "text-right",
      render: (r) => (
        <span className="inline-flex flex-wrap justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button className={actionBtn} title="Replace CRM roles" onClick={() => setRolesFor(r)}>
            <ShieldCheck size={13} /> Edit Roles
          </button>
          <button className={actionBtn} title="Choose which tabs this user can see" onClick={() => setTabAccessFor(r)}>
            <SlidersHorizontal size={13} /> Edit Tab Access
          </button>
          <button
            className={actionBtn}
            title={r.is_active ? "Deactivate user" : "Activate user"}
            disabled={r.id === me.id}
            onClick={() => setToggleActiveFor(r)}
          >
            {r.is_active ? <UserX size={13} /> : <UserCheck size={13} />}
            {r.is_active ? "Deactivate" : "Activate"}
          </button>
          <button
            className={actionBtn}
            title="Toggle employee portal access"
            disabled={portalBusyId === r.id}
            onClick={() => togglePortal(r)}
          >
            <KeyRound size={13} /> {portalBusyId === r.id ? "Toggling…" : "Portal access"}
          </button>
          <button
            className={`${actionBtn} !border-red-300 !text-red-600 hover:!bg-red-50 dark:!border-red-700/60 dark:!text-red-400 dark:hover:!bg-red-950/40`}
            title="Delete user permanently"
            disabled={r.id === me.id}
            onClick={() => setDeleteFor(r)}
          >
            <Trash2 size={13} /> Delete
          </button>
        </span>
      ),
    },
  ];

  return (
    <div>
      {toast}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-display text-xl font-bold text-primary">Users</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button className={btnSecondary} onClick={() => crmNavigate("access-templates")}>
            <ShieldCheck size={15} /> Access Templates
          </button>
          <button className={btnPrimary} onClick={() => setShowCreate(true)}>
            <Plus size={15} /> Create User
          </button>
        </div>
      </div>
      {error && <div className="mb-3"><ErrorBox error={error} onRetry={load} /></div>}
      <DataTable
        columns={columns}
        rows={rows}
        meta={meta}
        loading={loading}
        search={search}
        onSearch={setSearch}
        onPage={setPage}
        emptyMessage="No users found"
      />
      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onSaved={load} notify={notify} />}
      {rolesFor && <EditRolesModal user={rolesFor} onClose={() => setRolesFor(null)} onSaved={load} notify={notify} />}
      {tabAccessFor && <TabAccessModal user={tabAccessFor} onClose={() => setTabAccessFor(null)} onSaved={load} notify={notify} />}
      {toggleActiveFor && (
        <ConfirmModal
          title={toggleActiveFor.is_active ? "Deactivate user" : "Activate user"}
          message={
            toggleActiveFor.is_active ? (
              <>Deactivate <b>{toggleActiveFor.username}</b>? They will no longer be able to log in.</>
            ) : (
              <>Activate <b>{toggleActiveFor.username}</b>? They will be able to log in again.</>
            )
          }
          confirmLabel={toggleActiveFor.is_active ? "Deactivate" : "Activate"}
          danger={toggleActiveFor.is_active}
          busy={busy}
          onConfirm={toggleActive}
          onClose={() => setToggleActiveFor(null)}
        />
      )}
      {deleteFor && (
        <ConfirmModal
          title="Delete user"
          message={
            <>Permanently delete <b>{deleteFor.username}</b> ({deleteFor.full_name || deleteFor.email})? This cannot be undone.
            If the user is linked to records they created, deletion is blocked — deactivate them instead.</>
          }
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={deleteUser}
          onClose={() => setDeleteFor(null)}
        />
      )}
    </div>
  );
}
