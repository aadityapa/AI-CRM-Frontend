/** Users administration (Admin/CEO): create login accounts (email + password),
 * assign CRM roles, activate/deactivate, and delete access. Users update their
 * own profile details from My Profile after first login. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { HERO_BTN, HERO_BTN_SOLID, PageHeader } from "../components/PageHeader";
import { KeyRound, Lock, Plus, Send, Shield, ShieldCheck, SlidersHorizontal, Trash2, UserCheck, UserCog, UserX, Crown, Briefcase, Users, Wallet } from "lucide-react";
import { crmGet, crmPost, crmPut, crmDelete, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole, useMe } from "../CrmApp";
import { crmNavigate } from "../routerHooks";
import { AccessTemplatesPage } from "./AccessTemplates";
import { RolesPanel } from "./RolesAdmin";
import { ResetPasswordModal } from "../components/ResetPasswordModal";
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
  ConfirmModal, ErrorBox, Modal, StatusBadge, Tabs,
  btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";
import { SectionHeaderBanner, WizardField, FieldLabel } from "../components/wizard";
import { usePageTab } from "../lib/pageState";

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
  /** Admin/CEO-defined roles (Access Control ▸ Roles). */
  custom_roles?: string[];
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

function RoleChips({ roles, custom = [] }: { roles: string[]; custom?: string[] }) {
  if (!roles.length && !custom.length) return <span className="text-xs text-muted">No CRM roles</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {custom.map((r) => (
        <span key={`c-${r}`} title="Custom role (Access Control ▸ Roles)"
          className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          {r}
        </span>
      ))}
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

/** A custom role as `GET /api/roles` lists it (Access Control ▸ Roles). */
type CustomRoleOpt = { id: number; name: string; description: string; is_active: boolean; tab_access: Record<string, string> };

const CUSTOM_SELECTED = "border-emerald-300 bg-emerald-50/60 dark:border-emerald-700 dark:bg-emerald-950/30";
const CUSTOM_CHIP = "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";

function customRoleSummary(r: CustomRoleOpt): string {
  const keys = Object.keys(r.tab_access || {}).filter((k) => r.tab_access[k]);
  if (!keys.length) return r.description || "Custom role";
  const tabs = keys.slice(0, 4).map((k) => k.replace(/-/g, " ")).join(", ") + (keys.length > 4 ? ` +${keys.length - 4}` : "");
  return r.description ? `${r.description} · ${tabs}` : tabs;
}

function RoleSelector({
  selected,
  onChange,
  userName,
  customRoles,
  selectedCustom = [],
  onCustomChange,
}: {
  selected: string[];
  onChange: (roles: string[]) => void;
  userName?: string;
  /** Custom roles to offer as their own group (23 Sep 2026). Omit to show built-in only. */
  customRoles?: CustomRoleOpt[];
  selectedCustom?: number[];
  onCustomChange?: (ids: number[]) => void;
}) {
  const toggle = (role: string, checked: boolean) =>
    onChange(checked ? [...selected, role] : selected.filter((r) => r !== role));
  const toggleCustom = (id: number, checked: boolean) =>
    onCustomChange?.(checked ? [...selectedCustom, id] : selectedCustom.filter((r) => r !== id));

  const byGroup = (g: RoleGroup) =>
    CRM_ROLES.filter((r) => ROLE_META[r].group === g);
  const customs = (customRoles || []).filter((r) => r.is_active || selectedCustom.includes(r.id));
  const totalOffered = CRM_ROLES.length + customs.length;
  const totalSelected = selected.length + selectedCustom.length;

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
              {totalSelected} of {totalOffered} selected
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

        {customRoles && (
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted">
              <ShieldCheck size={13} className="opacity-70" />
              Custom roles
              <span className="font-semibold normal-case tracking-normal text-muted">— created in Access Control ▸ Roles</span>
            </div>
            {customs.length === 0 ? (
              <p className="rounded-card border border-dashed border-subtle px-3 py-2.5 text-xs text-muted">
                No custom roles yet. Create one (e.g. <b>GM</b>) on the Roles tab and it will appear here.
              </p>
            ) : (
              <div className="space-y-1.5">
                {customs.map((r) => {
                  const checked = selectedCustom.includes(r.id);
                  return (
                    <label
                      key={`custom-${r.id}`}
                      className={`flex cursor-pointer items-start gap-3 rounded-card border px-3 py-2.5 transition-colors duration-micro ${
                        checked ? CUSTOM_SELECTED : "border-subtle hover:border-strong hover:bg-surface-2"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600"
                        checked={checked}
                        onChange={(e) => toggleCustom(r.id, e.target.checked)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-primary">{r.name}</span>
                          <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${CUSTOM_CHIP}`}>Custom</span>
                          {!r.is_active && <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-xs font-semibold text-muted">Inactive</span>}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted">{customRoleSummary(r)}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {totalSelected > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-subtle pt-3">
          {selectedCustom.map((id) => {
            const r = (customRoles || []).find((c) => c.id === id);
            return (
              <span key={`cc-${id}`} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${CUSTOM_CHIP}`}>
                {r?.name || `Role #${id}`}
                <button type="button" className="rounded-full px-0.5 opacity-70 hover:opacity-100"
                  aria-label={`Remove ${r?.name || id}`} onClick={() => toggleCustom(id, false)}>
                  ×
                </button>
              </span>
            );
          })}
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

/** Role picker for Create User / Invite (same visual language, less chrome).
 * 25 Sep 2026: offers the custom roles too, so a GM or Sales Manager is
 * created in one step — a custom role alone is enough to reach the CRM. A
 * failed /api/roles fetch just hides the custom group. */
function RoleCheckboxes({
  selected,
  onChange,
  selectedCustom,
  onCustomChange,
}: {
  selected: string[];
  onChange: (roles: string[]) => void;
  selectedCustom: number[];
  onCustomChange: (ids: number[]) => void;
}) {
  const [customRoles, setCustomRoles] = useState<CustomRoleOpt[] | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    crmGet<{ custom: CustomRoleOpt[] }>("/api/roles")
      .then((res) => { if (alive) setCustomRoles((res.data?.custom || []).filter((r) => r.is_active)); })
      .catch(() => { if (alive) setCustomRoles(undefined); });
    return () => { alive = false; };
  }, []);
  return (
    <RoleSelector
      selected={selected}
      onChange={onChange}
      customRoles={customRoles}
      selectedCustom={selectedCustom}
      onCustomChange={onCustomChange}
    />
  );
}

/* -------------------------------------------------------- invite user */

/** Add someone by EMAIL alone. The account is created with roles and an
 * unusable password; they receive an invitation mail with a set-password link
 * and complete their own details after first login. This is the "new RMG
 * joins" path: no password exchange, no profile typing by the admin. */
function InviteUserModal({ onClose, onSaved, notify }: {
  onClose: () => void; onSaved: () => void; notify: (m: string, k?: "ok" | "err") => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [customIds, setCustomIds] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError("Enter a valid email address");
      return;
    }
    if (!roles.length && !customIds.length) {
      setError("Pick at least one role");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const res = await crmPost("/api/users/invite", {
        email: email.trim().toLowerCase(),
        full_name: fullName.trim(),
        roles,
        custom_roles: customIds,
      });
      notify(res.message || "Invitation sent");
      onSaved();
      onClose();
    } catch (err: any) {
      notify(err?.message || "Failed to send invitation", "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Invite user" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-muted">
          They receive an email with a set-password link (valid 7 days), sign in, and fill
          their own profile. You only choose the address and the roles.
        </p>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-secondary">Email <span className="text-danger">*</span></span>
          <input className={inputCls} type="email" value={email} placeholder="new.person@karnex.in"
            onChange={(e) => { setEmail(e.target.value); setError(""); }} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-secondary">Full name (optional)</span>
          <input className={inputCls} value={fullName} placeholder="Derived from the email if left blank"
            onChange={(e) => setFullName(e.target.value)} />
        </label>
        <div>
          <span className="mb-1 block text-xs font-semibold text-secondary">CRM roles <span className="text-danger">*</span></span>
          <RoleCheckboxes selected={roles} onChange={(r) => { setRoles(r); setError(""); }}
            selectedCustom={customIds} onCustomChange={(ids) => { setCustomIds(ids); setError(""); }} />
        </div>
        {error && <div className="text-xs font-semibold text-danger" role="alert">{error}</div>}
        <div className="flex justify-end gap-2 border-t border-subtle pt-4">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={saving}>
            {saving ? "Sending…" : "Send invitation"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------- email flows */

type EmailFlow = {
  event: string;
  label: string;
  description: string;
  default_roles: string[];
  roles: string[];
  extra_emails: string[];
  enabled: boolean;
  subject_template?: string | null;
  body_template?: string | null;
  customized: boolean;
};

/** Which roles receive which application email — the reason nobody edits code
 * when an approver changes. Each flow saves independently; Reset returns it
 * to the code default. */
function EmailFlowsPanel({ allRoles, flows, reload, notify }: {
  allRoles: string[];
  flows: EmailFlow[];
  reload: () => void;
  notify: (m: string, k?: "ok" | "err") => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, EmailFlow>>({});
  const [busyEvent, setBusyEvent] = useState<string | null>(null);
  useEffect(() => {
    setDrafts(Object.fromEntries(flows.map((f) => [f.event, { ...f }])));
  }, [flows]);

  const setFlow = (event: string, patch: Partial<EmailFlow>) =>
    setDrafts((d) => ({ ...d, [event]: { ...d[event], ...patch } }));

  const save = async (event: string) => {
    const f = drafts[event];
    if (!f) return;
    if (f.enabled && !f.roles.length && !f.extra_emails.length) {
      notify("An enabled flow needs at least one role or extra email — or disable it", "err");
      return;
    }
    setBusyEvent(event);
    try {
      const res = await crmPut(`/api/email-flows/${event}`, {
        roles: f.roles, extra_emails: f.extra_emails, enabled: f.enabled,
        subject_template: f.subject_template || null,
        body_template: f.body_template || null,
      });
      notify(res.message || "Flow saved");
      reload();
    } catch (e: any) {
      notify(e?.message || "Failed to save flow", "err");
    } finally {
      setBusyEvent(null);
    }
  };

  const reset = async (event: string) => {
    setBusyEvent(event);
    try {
      await crmDelete(`/api/email-flows/${event}`);
      notify("Flow reset to default");
      reload();
    } catch (e: any) {
      notify(e?.message || "Failed to reset flow", "err");
    } finally {
      setBusyEvent(null);
    }
  };

  return (
    <div className="mt-6 rounded-card border border-subtle bg-surface-1">
      <div className="border-b border-subtle px-4 py-3">
        <div className="text-sm font-bold text-primary">Email flows</div>
        <p className="mt-0.5 text-xs text-muted">
          Who receives which application email. Change roles here when people join or leave —
          no code changes. An unchecked flow's default is shown until you customise it.
        </p>
      </div>
      <div className="divide-y divide-[color:var(--border-subtle)]">
        {Object.values(drafts).map((f) => (
          <div key={f.event} className="px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-sm font-semibold text-primary">{f.label}</span>
                {f.customized && (
                  <span className="ml-2 rounded-control bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                    Customised
                  </span>
                )}
                <div className="text-xs text-muted">{f.description}</div>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-secondary">
                <input type="checkbox" checked={f.enabled}
                  onChange={(e) => setFlow(f.event, { enabled: e.target.checked })} />
                Enabled
              </label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {allRoles.map((r) => (
                <label key={r} className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-secondary">
                  <input
                    type="checkbox"
                    checked={f.roles.includes(r)}
                    disabled={!f.enabled}
                    onChange={(e) =>
                      setFlow(f.event, {
                        roles: e.target.checked ? [...f.roles, r] : f.roles.filter((x) => x !== r),
                      })}
                  />
                  {r}
                </label>
              ))}
            </div>
            {/* Wording templates (0071): the email's TEXT becomes admin data.
                Empty = the application's standard wording. Placeholders are
                replaced when the mail is queued. */}
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-muted">
                  Custom subject (blank = standard) — placeholders: {"{subject} {recipient} {company}"}
                </span>
                <input
                  className={`${inputCls} text-xs`}
                  value={f.subject_template || ""}
                  disabled={!f.enabled}
                  placeholder="e.g. [Karnex] {subject}"
                  onChange={(e) => setFlow(f.event, { subject_template: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-muted">
                  Custom body (blank = standard) — {"{body}"} inserts the standard text
                </span>
                <textarea
                  className={`${inputCls} min-h-[2.25rem] text-xs`}
                  rows={2}
                  value={f.body_template || ""}
                  disabled={!f.enabled}
                  placeholder={"Dear {recipient},\n\n{body}\n\nRegards, {company}"}
                  onChange={(e) => setFlow(f.event, { body_template: e.target.value })}
                />
              </label>
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="block min-w-[16rem] flex-1">
                <span className="mb-1 block text-[11px] font-semibold text-muted">
                  Extra email addresses (comma separated — auditors, group mailboxes)
                </span>
                <input
                  className={`${inputCls} text-xs`}
                  value={f.extra_emails.join(", ")}
                  disabled={!f.enabled}
                  onChange={(e) =>
                    setFlow(f.event, {
                      extra_emails: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                    })}
                />
              </label>
              <button type="button" className={`${btnPrimary} !px-3 !py-1.5 text-xs`}
                disabled={busyEvent === f.event} onClick={() => save(f.event)}>
                {busyEvent === f.event ? "Saving…" : "Save"}
              </button>
              {f.customized && (
                <button type="button" className={`${btnSecondary} !px-3 !py-1.5 text-xs`}
                  disabled={busyEvent === f.event} onClick={() => reset(f.event)}>
                  Reset to default
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------- action permissions */

type ActionPerm = {
  action: string;
  label: string;
  description: string;
  default_roles: string[];
  roles: string[];
  customized: boolean;
};

/** WHO MAY DO each gated action (approve timesheets, manage POs…), the
 * companion of Email Flows' who-hears-about-it. Admin/CEO always pass, so an
 * empty selection means "admins only" — lock-out is impossible. */
function ActionPermissionsPanel({ allRoles, actions, reload, notify }: {
  allRoles: string[];
  actions: ActionPerm[];
  reload: () => void;
  notify: (m: string, k?: "ok" | "err") => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, ActionPerm>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  useEffect(() => {
    setDrafts(Object.fromEntries(actions.map((a) => [a.action, { ...a }])));
  }, [actions]);

  const setPerm = (action: string, roles: string[]) =>
    setDrafts((d) => ({ ...d, [action]: { ...d[action], roles } }));

  const save = async (action: string) => {
    const a = drafts[action];
    if (!a) return;
    setBusyAction(action);
    try {
      const res = await crmPut(`/api/action-permissions/${action}`, { roles: a.roles });
      notify(res.message || "Permission saved");
      reload();
    } catch (e: any) {
      notify(e?.message || "Failed to save permission", "err");
    } finally {
      setBusyAction(null);
    }
  };

  const reset = async (action: string) => {
    setBusyAction(action);
    try {
      await crmDelete(`/api/action-permissions/${action}`);
      notify("Permission reset to default");
      reload();
    } catch (e: any) {
      notify(e?.message || "Failed to reset permission", "err");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="mt-6 rounded-card border border-subtle bg-surface-1">
      <div className="border-b border-subtle px-4 py-3">
        <div className="text-sm font-bold text-primary">Action permissions</div>
        <p className="mt-0.5 text-xs text-muted">
          Who may perform each action. Admin/CEO always can — ticking nobody means admins only.
          Changes apply within a minute, without a restart. <b>Approval</b> actions for anyone on an
          Access Template or a custom role are decided by that template's / role's <b>Approvals</b>{" "}
          section instead — this list covers users with neither.
        </p>
      </div>
      <div className="divide-y divide-[color:var(--border-subtle)]">
        {Object.values(drafts).map((a) => (
          <div key={a.action} className="px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-sm font-semibold text-primary">{a.label}</span>
                {a.customized && (
                  <span className="ml-2 rounded-control bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                    Customised
                  </span>
                )}
                <div className="text-xs text-muted">{a.description}</div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className={`${btnPrimary} !px-3 !py-1.5 text-xs`}
                  disabled={busyAction === a.action} onClick={() => save(a.action)}>
                  {busyAction === a.action ? "Saving…" : "Save"}
                </button>
                {a.customized && (
                  <button type="button" className={`${btnSecondary} !px-3 !py-1.5 text-xs`}
                    disabled={busyAction === a.action} onClick={() => reset(a.action)}>
                    Reset
                  </button>
                )}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {allRoles.map((r) => (
                <label key={r} className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-secondary">
                  <input
                    type="checkbox"
                    checked={a.roles.includes(r)}
                    onChange={(e) =>
                      setPerm(a.action, e.target.checked
                        ? [...a.roles, r]
                        : a.roles.filter((x) => x !== r))}
                  />
                  {r}
                  {a.default_roles.includes(r) && <span className="text-[10px] text-muted">(default)</span>}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
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
  const [customIds, setCustomIds] = useState<number[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [usernameTouched, setUsernameTouched] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const onEmailChange = (email: string) => {
    set("email", email);
    if (!usernameTouched) {
      const local = email.trim().split("@")[0] || "";
      set("username", local.toLowerCase().replace(/[^a-z0-9._-]/g, ""));
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.full_name.trim()) errs.full_name = "Full name is required";
    if (!form.email.trim()) errs.email = "Email is required";
    else if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errs.email = "Enter a valid email address";
    if (!form.username.trim()) errs.username = "Username is required";
    if (!form.password) errs.password = "Password is required";
    else if (form.password.length < 8) errs.password = "Password must be at least 8 characters";
    if (roles.length === 0 && customIds.length === 0) errs.roles = "Assign at least one CRM role so they can access the app";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const res = await crmPost("/api/users", {
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        username: form.username.trim().toLowerCase(),
        password: form.password,
        roles,
        custom_roles: customIds,
      });
      notify(res.message || "User created — they can log in with this email or username");
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
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title="Create User"
        subtitle="Admin/CEO grants app access here — email + password for login. The user updates their own profile details after signing in."
        icon={<UserCog size={20} aria-hidden />}
      >
        <form onSubmit={submit} className="space-y-5">
          <WizardField label="Full name" required error={errors.full_name} icon="user" filled={!!form.full_name.trim() && !errors.full_name}>
            <input className={inputCls} value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
          </WizardField>
          <WizardField label="Email" required error={errors.email} icon="mail" filled={!!form.email.trim() && !errors.email}>
            <input
              className={inputCls}
              type="email"
              value={form.email}
              onChange={(e) => onEmailChange(e.target.value)}
              placeholder="name@karnex.in"
              autoComplete="off"
            />
          </WizardField>
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <WizardField label="Username" required error={errors.username} icon="user" filled={!!form.username.trim() && !errors.username}>
              <input
                className={inputCls}
                value={form.username}
                onChange={(e) => {
                  setUsernameTouched(true);
                  set("username", e.target.value);
                }}
                autoComplete="off"
              />
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
            <FieldLabel label="CRM roles" required />
            {errors.roles && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{errors.roles}</p>}
            <RoleCheckboxes selected={roles} onChange={setRoles}
              selectedCustom={customIds} onCustomChange={setCustomIds} />
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
  const [customRoles, setCustomRoles] = useState<CustomRoleOpt[] | null>(null);
  const [customIds, setCustomIds] = useState<number[]>([]);
  const [customLoadError, setCustomLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const displayName = user.full_name || user.username;
  const currentCustomNames = user.custom_roles || [];

  // The user row carries custom-role NAMES; the dialog needs ids. One fetch,
  // and the initial selection is derived from it so "Reset to current" works.
  useEffect(() => {
    let alive = true;
    crmGet<{ custom: CustomRoleOpt[] }>("/api/roles")
      .then((res) => {
        if (!alive) return;
        const list = res.data?.custom || [];
        setCustomRoles(list);
        setCustomIds(list.filter((r) => currentCustomNames.includes(r.name)).map((r) => r.id));
      })
      .catch((err: any) => {
        if (!alive) return;
        setCustomRoles([]);
        setCustomLoadError(err?.message || "Could not load custom roles");
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  const currentCustomIds = (customRoles || []).filter((r) => currentCustomNames.includes(r.name)).map((r) => r.id);
  const sameSet = (a: (string | number)[], b: (string | number)[]) =>
    a.length === b.length && a.every((x) => b.includes(x));
  const unchanged = sameSet(roles, user.roles) && sameSet(customIds, currentCustomIds);
  const nothingSelected = roles.length === 0 && customIds.length === 0;

  const submit = async () => {
    setSaving(true);
    try {
      // Only send the custom set once the list resolved — a failed fetch must
      // not silently strip the roles the user already holds.
      const res = await crmPost(`/api/users/${user.id}/roles`, {
        roles,
        ...(customRoles && !customLoadError ? { custom_roles: customIds } : {}),
      });
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
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0"
    >
      <WizFormShell
        title={`Edit Roles — ${user.username}`}
        subtitle="Select the CRM roles for this user — the selection replaces all existing roles."
        icon={<Shield size={20} aria-hidden />}
      >
      <p className="mb-3 text-sm text-muted">
        Choose which CRM roles <b>{displayName}</b> should have — built-in roles and any custom roles
        (e.g. <b>GM</b>, <b>Sales Manager</b>). The selection below <b>replaces all existing roles</b>.
        Picking a custom role also removes any Access Template, so the role alone decides their tabs.
      </p>
      {nothingSelected && (
        <p className="mb-3 rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          No roles selected — this user will lose access to the CRM until roles are assigned.
        </p>
      )}
      {customLoadError && (
        <p className="mb-3 rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          Custom roles could not be loaded ({customLoadError}) — saving will change built-in roles only.
        </p>
      )}
      <RoleSelector
        selected={roles}
        onChange={setRoles}
        userName={displayName}
        customRoles={customRoles || []}
        selectedCustom={customIds}
        onCustomChange={setCustomIds}
      />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--wiz-border)] pt-5">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btnSecondary}
            onClick={() => setRoles([...CRM_ROLES])}
            disabled={saving}
          >
            Select all built-in
          </button>
          <button
            type="button"
            className={btnSecondary}
            onClick={() => { setRoles(user.roles); setCustomIds(currentCustomIds); }}
            disabled={saving || unchanged}
          >
            Reset to current
          </button>
          <button
            type="button"
            className={btnSecondary}
            onClick={() => { setRoles([]); setCustomIds([]); }}
            disabled={saving || nothingSelected}
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
      scopeClassName="crm-wizard wiz-noise"
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
  // Access Control hub (target IA): ONE sidebar entry with Users and Access
  // Templates as tabs inside it, instead of two sibling pages.
  const [hubTab, setHubTab] = usePageTab<"users" | "roles" | "templates">("tab", "users", ["users", "roles", "templates"]);
  const [resetFor, setResetFor] = useState<UserRow | null>(null);
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
  const [customRoles, setCustomRoles] = useState<{ id: number; name: string; is_active: boolean }[]>([]);
  const [templateBusyId, setTemplateBusyId] = useState<number | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [flows, setFlows] = useState<EmailFlow[]>([]);
  const [perms, setPerms] = useState<ActionPerm[]>([]);
  const [allRoles, setAllRoles] = useState<string[]>([]);
  const [pausedIds, setPausedIds] = useState<Set<number>>(new Set());
  const [pauseBusyId, setPauseBusyId] = useState<number | null>(null);
  const dSearch = useDebounced(search);

  const loadFlows = useCallback(async () => {
    try {
      const res = await crmGet<{ flows: EmailFlow[]; all_roles: string[]; paused_user_ids: number[] }>(
        "/api/email-flows",
      );
      setFlows(res.data?.flows || []);
      setAllRoles(res.data?.all_roles || []);
      setPausedIds(new Set(res.data?.paused_user_ids || []));
    } catch { /* flows panel simply stays empty pre-migration */ }
    try {
      const res = await crmGet<{ actions: ActionPerm[] }>("/api/action-permissions");
      setPerms(res.data?.actions || []);
    } catch { /* permissions panel stays empty pre-migration */ }
  }, []);
  useEffect(() => { if (isAdmin) loadFlows(); }, [isAdmin, loadFlows]);

  const toggleEmailPause = async (u: UserRow) => {
    const paused = pausedIds.has(u.id);
    setPauseBusyId(u.id);
    try {
      const res = await crmPost(`/api/users/${u.id}/email-pause`, { paused: !paused });
      notify(res.message || "Email preference updated");
      setPausedIds((prev) => {
        const next = new Set(prev);
        if (paused) next.delete(u.id); else next.add(u.id);
        return next;
      });
    } catch (e: any) {
      notify(e?.message || "Failed to update email preference", "err");
    } finally {
      setPauseBusyId(null);
    }
  };

  useEffect(() => {
    crmGet<AccessTemplateOpt[]>("/api/access-templates")
      .then((r) => setTemplates((r.data || []).filter((t) => t.is_active)))
      .catch(() => {});
    crmGet<{ custom: { id: number; name: string; is_active: boolean }[] }>("/api/roles")
      .then((r) => setCustomRoles((r.data?.custom || []).filter((c) => c.is_active)))
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
    return <ErrorBox error="Access denied: the Users page is available to Admin and CEO only." />;
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

  /** ONE source of access per user (23 Sep 2026): role default, an Access
   *  Template, or a custom role. The server clears whichever was set before. */
  const setAccessSource = async (user: UserRow, value: string) => {
    const [kind, idStr] = value ? value.split(":") : ["default", ""];
    setTemplateBusyId(user.id);
    try {
      const res = await crmPost<{ access_template_id: number | null; custom_roles: string[]; roles?: string[] }>(
        `/api/users/${user.id}/access-source`,
        { kind, id: idStr ? Number(idStr) : null },
      );
      notify(res.message || "Access updated");
      // A template can add the built-in role it is tagged with (a user needs a
      // role to open the CRM), so the role chips are refreshed from the reply too.
      setRows((prev) =>
        prev.map((r) => (r.id === user.id
          ? {
              ...r,
              access_template_id: res.data?.access_template_id ?? null,
              custom_roles: res.data?.custom_roles ?? [],
              roles: res.data?.roles ?? r.roles,
            }
          : r)),
      );
    } catch (e: any) {
      notify(e?.message || "Failed to update access", "err");
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
    {
      key: "roles", label: "CRM Roles",
      // No role at all = the CRM refuses them ("No CRM role is assigned"),
      // whatever template they carry. Say so on the row, where it can be fixed.
      render: (r) => (r.roles.length || (r.custom_roles || []).length)
        ? <RoleChips roles={r.roles} custom={r.custom_roles} />
        : (
          <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger"
            title="A template decides which tabs a user sees; a role is what lets them into the CRM. Use Edit Roles.">
            No role — cannot open the CRM
          </span>
        ),
    },
    {
      key: "access_template_id",
      label: "Access",
      render: (r) => {
        // The one thing that decides this user's tabs: a custom role, an
        // Access Template, or the built-in role defaults.
        const roleMatch = customRoles.find((c) => (r.custom_roles || []).includes(c.name));
        const value = roleMatch ? `role:${roleMatch.id}` : r.access_template_id ? `template:${r.access_template_id}` : "";
        return (
          <select
            className={`${inputCls} min-w-[10rem] py-1 text-xs`}
            value={value}
            disabled={templateBusyId === r.id}
            onChange={(e) => setAccessSource(r, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            title="Picking one clears the others"
          >
            <option value="">— Role default —</option>
            {customRoles.length > 0 && (
              <optgroup label="Custom roles">
                {customRoles.map((c) => <option key={`r${c.id}`} value={`role:${c.id}`}>{c.name}</option>)}
              </optgroup>
            )}
            {templates.length > 0 && (
              <optgroup label="Access templates">
                {templates.map((t) => <option key={`t${t.id}`} value={`template:${t.id}`}>{t.name}</option>)}
              </optgroup>
            )}
          </select>
        );
      },
    },
    { key: "is_active", label: "Status", render: (r) => <StatusBadge status={r.is_active ? "Active" : "Inactive"} /> },
    {
      key: "_email",
      label: "Email",
      render: (r) => {
        const paused = pausedIds.has(r.id);
        return (
          <button
            type="button"
            className={`inline-flex items-center rounded-control px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
              paused
                ? "bg-warning-soft text-warning ring-warning/30"
                : "bg-success-soft text-success ring-success/30"
            } disabled:opacity-50`}
            title={paused ? "Application email is paused for this user — click to resume"
              : "Application email is on — click to pause (e.g. when they leave)"}
            disabled={pauseBusyId === r.id}
            onClick={(e) => { e.stopPropagation(); toggleEmailPause(r); }}
          >
            {pauseBusyId === r.id ? "…" : paused ? "Paused" : "On"}
          </button>
        );
      },
    },
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
          <button className={actionBtn} title="Set or generate a new password for this user" disabled={r.id === me.id} onClick={() => setResetFor(r)}>
            <KeyRound size={13} /> Reset Password
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

  if (hubTab === "templates" || hubTab === "roles") {
    return (
      <div>
        {toast}
        <div className="mb-4">
          <PageHeader
            icon={ShieldCheck}
            accent="slate"
            eyebrow="Admin · CEO"
            title="Access Control"
            subtitle={hubTab === "roles"
              ? "Roles are the job titles people sign in as. Create a custom role, choose the tabs it may open, then add its members — or reset a member's password from here."
              : "Users get an Access Template (from the Users tab, or automatically from their role); the template controls which tabs and fields they can see and edit."}
          >
            <Tabs
              tabs={[{ key: "users", label: "Users" }, { key: "roles", label: "Roles" }, { key: "templates", label: "Access Templates" }]}
              active={hubTab}
              onChange={(k) => setHubTab(k as "users" | "roles" | "templates")}
            />
          </PageHeader>
        </div>
        {hubTab === "roles" ? <RolesPanel notify={notify} /> : <AccessTemplatesPage />}
      </div>
    );
  }
  return (
    <div>
      {toast}
      <div className="mb-4">
        <PageHeader
          icon={ShieldCheck}
          accent="slate"
          eyebrow="Admin · CEO"
          title="Access Control"
          subtitle="Admin/CEO control who can access the application. Create an account with email and password,
            assign roles and an Access Template, then the user signs in and updates their own profile."
          stats={meta ? [{ label: meta.total === 1 ? "user" : "users", value: meta.total }] : undefined}
          actions={
            <>
              <button className={HERO_BTN} onClick={() => setShowInvite(true)}>
                <Send size={15} /> Invite User
              </button>
              <button className={HERO_BTN_SOLID} onClick={() => setShowCreate(true)}>
                <Plus size={15} /> Create User
              </button>
            </>
          }
        >
          <Tabs
            tabs={[{ key: "users", label: "Users" }, { key: "roles", label: "Roles" }, { key: "templates", label: "Access Templates" }]}
            active={hubTab}
            onChange={(k) => setHubTab(k as "users" | "roles" | "templates")}
          />
        </PageHeader>
      </div>
      {error && <div className="mb-3"><ErrorBox error={error} onRetry={load} /></div>}
      <DataTable
        columns={columns}
        rows={rows}
        meta={meta}
        headerRight={meta ? <span className="whitespace-nowrap text-xs font-medium text-muted">{meta.total} {meta.total === 1 ? "user" : "users"}, page {meta.page}/{Math.max(1, meta.pages || 1)}</span> : undefined}
        loading={loading}
        search={search}
        onSearch={setSearch}
        onPage={setPage}
        emptyMessage="No users found"
      />
      {perms.length > 0 && (
        <ActionPermissionsPanel allRoles={allRoles} actions={perms} reload={loadFlows} notify={notify} />
      )}
      {flows.length > 0 && (
        <EmailFlowsPanel allRoles={allRoles} flows={flows} reload={loadFlows} notify={notify} />
      )}
      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onSaved={load} notify={notify} />}
      {showInvite && <InviteUserModal onClose={() => setShowInvite(false)} onSaved={load} notify={notify} />}
      {rolesFor && <EditRolesModal user={rolesFor} onClose={() => setRolesFor(null)} onSaved={load} notify={notify} />}
      {tabAccessFor && <TabAccessModal user={tabAccessFor} onClose={() => setTabAccessFor(null)} onSaved={load} notify={notify} />}
      {resetFor && <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} notify={notify} />}
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
            <>Permanently delete <b>{deleteFor.username}</b> ({deleteFor.full_name || deleteFor.email})?
            They will lose login access immediately. History they created is kept and reassigned to you when needed.</>
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
