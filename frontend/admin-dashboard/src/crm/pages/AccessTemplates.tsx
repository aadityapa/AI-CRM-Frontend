/** Access Templates (Admin/CEO) — create department/role-wise templates that grant,
 * per CRM tab, a LADDER mode (View < Edit < Create — higher includes lower) and,
 * per field, View or Edit. For assigned users the template is AUTHORITATIVE:
 * it decides what they can do, even beyond their role's defaults.
 * API: /api/access-templates (+ /registry, /assign). Tokens/components only. */
import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, LayoutTemplate, Pencil, Plus, Save, Search, Trash2, UserPlus, Users, X } from "lucide-react";
import { DEPARTMENT_LOOK, groupRolesByDepartment } from "./RolesAdmin";
import { DialogSection } from "../components/dialogKit";
import { crmGet, crmPost, crmPut, crmDelete, qs } from "../api";
import {
  ConfirmModal, EmptyState, ErrorBox, Field, Spinner, StatusBadge,
  btnDanger, btnPrimary, btnSecondary, focusRing, inputCls, useToast,
} from "../components/ui";
import { useHasRole } from "../CrmApp";
import { ApprovalGrants, ApprovalGrantsHeading, impliedButtons, type ApprovalDef } from "../components/ApprovalGrants";
import { IV_MODULE, IV_MODULE_HINT, MODULE_ORDER, moduleOf } from "../components/TabPermissionMatrix";

type RegField = { key: string; label: string };
type RegTab = { key: string; label: string; fields: RegField[]; group?: string; default_roles?: string[] };
/** `role_tags` = built-in operational roles + every ACTIVE custom role (GM,
 *  Sales Manager, …) — the server's list, so a new custom role appears here
 *  without a frontend change. `approvals` = the approval-button catalogue. */
type Registry = {
  modes: string[]; tabs: RegTab[]; role_tags?: string[]; approvals?: ApprovalDef[];
  /** Access-control departments (7 Oct 2026) — the sections the list is grouped in. */
  departments?: { key: string; label: string }[];
};
type Template = {
  id: number; name: string; description?: string | null; role?: string | null;
  department_id?: number | null; is_active: boolean;
  tab_access: Record<string, string>; field_access: Record<string, Record<string, string>>;
  /** null = approvals never configured (role lists decide); list = explicit. */
  action_access?: string[] | null;
  /** Its role tag's department (server-derived) and how many logins hold it. */
  role_department?: string;
  assigned_count?: number;
};
type User = { id: number; full_name?: string; email?: string; username?: string };
type Dept = { id: number; name: string };

/** Used only if an older server sends no `role_tags`. */
const FALLBACK_ROLES = ["Sales", "Sales_Head", "RMG", "TA", "HR", "Finance"];

/** Module grouping lives in TabPermissionMatrix (`moduleOf`, 7 Oct 2026) so the
 * template and role editors read the same way; Interview Platform tabs first. */

/** Segmented mode picker — a permission matrix reads faster than 25 dropdowns. */
function ModeSegments({ value, onChange, compact }: {
  value: string; onChange: (m: string) => void; compact?: boolean;
}) {
  const opts = [
    { value: "", label: "None" },
    { value: "view", label: "View" },
    { value: "edit", label: "Edit" },
    { value: "create", label: "Create" },
  ];
  return (
    <div className="inline-flex overflow-hidden rounded-control border border-subtle" role="radiogroup">
      {opts.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.value === "" ? "No access"
            : o.value === "view" ? "View only"
              : o.value === "edit" ? "View + Edit"
                : "View + Edit + Create"}
          className={`px-2.5 ${compact ? "py-0.5 text-[11px]" : "py-1 text-xs"} font-semibold transition-colors duration-micro ${
            i > 0 ? "border-l border-subtle" : ""
          } ${value === o.value
            ? o.value === "" ? "bg-surface-2 text-muted" : "bg-brand-600 text-white"
            : "bg-surface-1 text-secondary hover:bg-surface-2"}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
/** Field grants stop at edit — creating happens at record level, not per field.
 * "Hidden" (25 Aug 2026) removes the field — or, for `tab:*` entries, the whole
 * SUB-TAB — from the templated user's view. */
const FIELD_MODE_OPTS = [
  { value: "", label: "Tab default" },
  { value: "hidden", label: "Hidden" },
  { value: "view", label: "View only" },
  { value: "edit", label: "Edit" },
];

type Form = {
  id: number | null; name: string; description: string; role: string;
  department_id: string; is_active: boolean;
  tabAccess: Record<string, string>; fieldAccess: Record<string, Record<string, string>>;
  actions: string[];
  /** The stored template has no Approvals list yet (role lists decide today). */
  actionsUnset: boolean;
};

const emptyForm = (): Form => ({
  id: null, name: "", description: "", role: "", department_id: "", is_active: true,
  tabAccess: {}, fieldAccess: {}, actions: [], actionsUnset: false,
});

/** Buttons whose default names this role — what a template tagged with it
 *  starts from (mirrors `action_permissions.default_actions_for_role`). */
function defaultApprovalsFor(role: string, approvals: ApprovalDef[]): string[] {
  return role ? approvals.filter((a) => a.default_roles.includes(role)).map((a) => a.key) : [];
}

/** Interview Platform tabs this role opens by default (`{ "iv:ats": "view" }`). */
function defaultIvTabsFor(role: string, tabs: RegTab[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (role) tabs.filter((t) => moduleOf(t) === IV_MODULE && t.default_roles?.includes(role)).forEach((t) => { out[t.key] = "view"; });
  return out;
}

/** The buttons a template starts with: the role's defaults + what its tab grants imply (server rule). */
function seedActions(role: string, tabAccess: Record<string, string>, approvals: ApprovalDef[]): string[] {
  const wanted = new Set([...defaultApprovalsFor(role, approvals), ...impliedButtons(tabAccess, approvals)]);
  return approvals.map((a) => a.key).filter((k) => wanted.has(k));
}

export function AccessTemplatesPage() {
  // Admin/CEO only — this page EDITS access. The server already 403s every
  // mutation; this stops the page rendering at all for anyone else (it was the
  // one CRM page with no gate of its own).
  const isAdminUser = useHasRole();
  const [toast, notify] = useToast();
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [form, setForm] = useState<Form>(emptyForm());
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tabSearch, setTabSearch] = useState("");
  const [assignUser, setAssignUser] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [search, setSearch] = useState("");

  const loadTemplates = useCallback(async () => {
    setTemplates((await crmGet<Template[]>("/api/access-templates")).data);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setRegistry((await crmGet<Registry>("/api/access-templates/registry")).data);
        await loadTemplates();
        setUsers(await crmGet<User[]>(`/api/users${qs({ limit: 200 })}`).then((r) => r.data).catch(() => []));
        setDepts(await crmGet<Dept[]>(`/api/departments${qs({ limit: 200 })}`).then((r) => r.data).catch(() => []));
      } catch (e: any) { setErr(String(e?.message || e)); }
    })();
  }, [loadTemplates]);

  const selectTemplate = (t: Template) => {
    setForm({
      id: t.id, name: t.name, description: t.description || "", role: t.role || "",
      department_id: t.department_id ? String(t.department_id) : "", is_active: t.is_active,
      tabAccess: { ...(t.tab_access || {}) },
      fieldAccess: JSON.parse(JSON.stringify(t.field_access || {})),
      // Never configured → show what the role tag's default would grant, so
      // saving writes an explicit list that matches what the user already had.
      actions: t.action_access ?? seedActions(t.role || "", t.tab_access || {}, registry?.approvals || []),
      actionsUnset: t.action_access == null,
    });
    setEditing(true);
    setErr("");
  };

  const openNewTemplate = () => {
    setForm(emptyForm());
    setExpanded({});
    setAssignUser("");
    setEditing(true);
    setErr("");
  };

  const setTabMode = (tab: string, mode: string) =>
    setForm((f) => {
      const tabAccess = { ...f.tabAccess };
      if (mode) tabAccess[tab] = mode; else delete tabAccess[tab];
      return { ...f, tabAccess };
    });

  const setFieldMode = (tab: string, field: string, mode: string) =>
    setForm((f) => {
      const fieldAccess = { ...f.fieldAccess, [tab]: { ...(f.fieldAccess[tab] || {}) } };
      if (mode) fieldAccess[tab][field] = mode; else delete fieldAccess[tab][field];
      if (!Object.keys(fieldAccess[tab]).length) delete fieldAccess[tab];
      return { ...f, fieldAccess };
    });

  const closeEditor = () => {
    setForm(emptyForm());
    setExpanded({});
    setAssignUser("");
    setEditing(false);
    setErr("");
  };

  const save = async () => {
    if (!form.name.trim()) { setErr("Template name is required"); return; }
    setBusy(true); setErr("");
    const payload = {
      name: form.name.trim(), description: form.description || null, role: form.role || null,
      department_id: form.department_id ? Number(form.department_id) : null,
      is_active: form.is_active, tab_access: form.tabAccess, field_access: form.fieldAccess,
      action_access: form.actions,
    };
    try {
      if (form.id) {
        await crmPut(`/api/access-templates/${form.id}`, payload);
        notify("Template saved");
      } else {
        await crmPost<Template>("/api/access-templates", payload);
        notify("Template created");
      }
      await loadTemplates();
      // Persist then close the editor (return to the template list).
      closeEditor();
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!form.id) return;
    setBusy(true);
    try {
      await crmDelete(`/api/access-templates/${form.id}`);
      notify("Template deleted");
      setConfirmDelete(false);
      closeEditor();
      setTemplates((prev) => prev.filter((t) => t.id !== form.id));
      await loadTemplates();
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  const assign = async () => {
    if (!form.id || !assignUser) return;
    try {
      const res = await crmPost<{ role_added?: string | null }>(
        "/api/access-templates/assign", { user_id: Number(assignUser), template_id: form.id });
      // A user needs a ROLE to open the CRM; the server adds the template's
      // built-in role tag when they had none — say so.
      notify(res.data?.role_added
        ? `Template assigned — role ${res.data.role_added.replace(/_/g, " ")} added so they can open the CRM`
        : "Template assigned to user");
      setAssignUser("");
    } catch (e: any) { setErr(String(e?.message || e)); }
  };

  const tabs = registry?.tabs || [];
  const tabCount = Object.keys(form.tabAccess).length;
  const allTags = registry?.role_tags?.length ? registry.role_tags : FALLBACK_ROLES;
  const roleTags = {
    all: allTags,
    builtin: allTags.filter((r) => FALLBACK_ROLES.includes(r)),
    custom: allTags.filter((r) => !FALLBACK_ROLES.includes(r)),
  };
  const approvalDefs = registry?.approvals || [];

  if (!isAdminUser) {
    return <EmptyState message="Access Templates are managed by Admin/CEO only." />;
  }
  if (err && !registry) return <ErrorBox error={err} />;
  if (!registry) return <div className="rounded-card border border-subtle bg-surface-1 p-6"><Spinner /></div>;

  const departments = registry.departments?.length ? registry.departments : [{ key: "other", label: "Other" }];
  const q = search.trim().toLowerCase();
  const shown = templates.filter((t) => !q || t.name.toLowerCase().includes(q) || (t.description || "").toLowerCase().includes(q)
    || (t.role || "").toLowerCase().includes(q));
  const groups = groupRolesByDepartment(departments, [] as { department?: string }[],
    shown.map((t) => ({ ...t, department: t.role_department })));
  const assignedTotal = templates.reduce((n, t) => n + (t.assigned_count || 0), 0);
  const fieldOverrides = Object.values(form.fieldAccess).reduce((n, m) => n + Object.keys(m).length, 0);

  const templateCard = (t: Template & { department?: string }) => {
    const tabsN = Object.keys(t.tab_access || {}).length;
    return (
      <article key={t.id}
        className={`flex flex-col rounded-card border p-3 transition-colors duration-micro ${
          editing && form.id === t.id ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : t.is_active ? "border-subtle bg-surface-1" : "border-dashed border-subtle bg-surface-2 opacity-80"}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <LayoutTemplate size={16} className="flex-none text-brand-600 dark:text-brand-300" aria-hidden />
            <span className="truncate text-sm font-bold text-primary">{t.name}</span>
          </div>
          <span className="flex flex-none items-center gap-1">
            {t.role && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-secondary">{t.role.replace(/_/g, " ")}</span>}
            {!t.is_active && <StatusBadge status="Inactive" />}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 min-h-[2rem] text-xs text-secondary">{t.description || "No description."}</p>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-control bg-surface-2 px-2 py-1.5">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">Users</dt>
            <dd className="text-sm font-bold tabular-nums text-primary">{t.assigned_count ?? 0}</dd>
          </div>
          <div className="rounded-control bg-surface-2 px-2 py-1.5">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">Tabs</dt>
            <dd className="text-sm font-bold tabular-nums text-primary">{tabsN}</dd>
          </div>
          <div className="rounded-control bg-surface-2 px-2 py-1.5">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">Buttons</dt>
            <dd className="text-sm font-bold tabular-nums text-primary">{t.action_access == null ? "role" : t.action_access.length}</dd>
          </div>
        </dl>
        <div className="mt-auto flex gap-1.5 pt-3">
          <button type="button" className={btnSecondary} onClick={() => selectTemplate(t)}><Pencil size={13} /> Edit</button>
          <button type="button" className={btnSecondary} onClick={() => { selectTemplate(t); setTimeout(() => document.getElementById("tpl-assign")?.scrollIntoView({ block: "center" }), 50); }}>
            <UserPlus size={13} /> Assign
          </button>
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-4">
      {toast}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-display text-lg font-bold text-primary">Access Templates</h1>
          <p className="text-xs text-secondary">
            A template decides, tab by tab, what its users may do (View &lt; Edit &lt; Create), locks single fields and
            names the buttons they may press. Assigned users follow the template alone — even beyond their role's defaults.
          </p>
          <p className="mt-1 text-xs text-muted">{templates.length} templates · assigned to {assignedTotal} logins</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input className={`${inputCls} !w-56 !pl-8`} placeholder="Find a template…" value={search}
              onChange={(e) => setSearch(e.target.value)} aria-label="Find a template" />
          </div>
          <button type="button" className={btnPrimary} onClick={openNewTemplate}>
            <Plus size={14} /> New template
          </button>
        </div>
      </div>
      {err && <ErrorBox error={err} />}

      {!editing ? (
        templates.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-card border border-subtle bg-surface-1 p-8 text-center">
            <EmptyState message="No templates yet — create one per department (a Sales template, an HR template …) and assign people to it." />
            <button type="button" className={btnPrimary} onClick={openNewTemplate}><Plus size={14} /> New template</button>
          </div>
        ) : groups.length === 0 ? <EmptyState message="No template matches that search." /> : groups.map(({ dept, custom: list }) => {
          const look = DEPARTMENT_LOOK[dept.key] || DEPARTMENT_LOOK.other;
          const Icon = look.icon;
          const users = list.reduce((n, t) => n + ((t as Template).assigned_count || 0), 0);
          return (
            <section key={dept.key} className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised" aria-label={dept.label}>
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className={`inline-flex h-10 w-10 flex-none items-center justify-center rounded-card bg-gradient-to-br ${look.accent} text-white shadow-raised`}>
                    <Icon size={18} aria-hidden />
                  </span>
                  <div>
                    <h3 className="text-base font-bold text-primary">{dept.label}</h3>
                    <p className="text-xs text-secondary">Templates tagged with a {dept.label} role.</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold tabular-nums text-secondary">
                  <Users size={12} aria-hidden /> {list.length} template{list.length === 1 ? "" : "s"} · {users} users
                </span>
              </header>
              <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                {list.map((t) => templateCard(t as Template & { department?: string }))}
              </div>
            </section>
          );
        })
      ) : (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          {/* the list stays beside the editor, compact */}
          <div className="space-y-1 self-start rounded-card border border-subtle bg-surface-1 p-2">
            <button type="button" className={`flex w-full items-center gap-1 rounded-control px-3 py-2 text-left text-sm font-semibold text-brand-700 hover:bg-surface-2 ${focusRing}`}
              onClick={openNewTemplate}><Plus size={14} /> New template</button>
            {groups.map(({ dept, custom: list }) => (
              <div key={dept.key}>
                <div className="px-3 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-wide text-muted">{dept.label}</div>
                {list.map((t) => (
                  <button key={t.id} type="button"
                    className={`flex w-full items-center justify-between rounded-control px-3 py-1.5 text-left text-sm ${focusRing} ${form.id === t.id ? "bg-surface-2 font-semibold text-primary" : "text-secondary hover:bg-surface-2"}`}
                    onClick={() => selectTemplate(t as Template)}>
                    <span className="truncate">{t.name}</span>
                    {!(t as Template).is_active && <StatusBadge status="Inactive" />}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div className="space-y-4 rounded-card border border-subtle bg-surface-1 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-primary">{form.id ? `Edit template — ${form.name || `#${form.id}`}` : "New template"}</h2>
                <p className="text-xs text-muted">{tabCount} tab{tabCount === 1 ? "" : "s"} · {fieldOverrides} field override{fieldOverrides === 1 ? "" : "s"} · {form.actions.length} button{form.actions.length === 1 ? "" : "s"}</p>
              </div>
              <button type="button" className={btnSecondary} onClick={closeEditor} disabled={busy} title="Close without saving">
                <X size={14} /> Close
              </button>
            </div>

            <DialogSection n={1} tone="brand" title="Name, role tag & status" done={!!form.name.trim()}
              hint="The role tag seeds a NEW template's Interview Platform tabs and buttons and decides which department it is listed under.">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Field label="Template name">
                  <input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Sales" />
                </Field>
                <Field label="Role tag">
                  <select className={inputCls} value={form.role} onChange={(e) => {
                    const role = e.target.value;
                    // A NEW template starts from what its role gets by default — the
                    // Interview Platform tabs it opens and the buttons it holds (plus
                    // the buttons its tab grants imply); an existing one keeps what the
                    // admin already set.
                    setForm((f) => {
                      if (f.id) return { ...f, role };
                      const tabAccess = { ...f.tabAccess };
                      Object.keys(tabAccess).filter((k) => k.startsWith("iv:")).forEach((k) => { delete tabAccess[k]; });
                      Object.assign(tabAccess, defaultIvTabsFor(role, tabs));
                      return { ...f, role, tabAccess, actions: seedActions(role, tabAccess, approvalDefs) };
                    });
                  }}>
                    <option value="">—</option>
                    {roleTags.builtin.length > 0 && (
                      <optgroup label="Built-in roles">
                        {roleTags.builtin.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
                      </optgroup>
                    )}
                    {roleTags.custom.length > 0 && (
                      <optgroup label="Custom roles">
                        {roleTags.custom.map((r) => <option key={r} value={r}>{r}</option>)}
                      </optgroup>
                    )}
                    {/* A tag that is no longer offered (a deactivated custom role) stays visible. */}
                    {form.role && !roleTags.all.includes(form.role) && <option value={form.role}>{form.role} (inactive)</option>}
                  </select>
                </Field>
                <Field label="HR department (optional)">
                  <select className={inputCls} value={form.department_id} onChange={(e) => setForm((f) => ({ ...f, department_id: e.target.value }))}>
                    <option value="">—</option>
                    {depts.map((d) => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
                  </select>
                </Field>
                <Field label="Active">
                  <select className={inputCls} value={form.is_active ? "1" : "0"} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.value === "1" }))}>
                    <option value="1">Yes</option><option value="0">No</option>
                  </select>
                </Field>
                <div className="sm:col-span-2 xl:col-span-4">
                  <Field label="Description">
                    <input className={inputCls} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Who this template is for and what it opens" />
                  </Field>
                </div>
              </div>
            </DialogSection>

            <DialogSection n={2} tone="brand" title="Tabs & fields" done={tabCount > 0}
              hint="Pick a mode per tab; open a tab to lock single fields or hide a sub-tab."
              action={<input className={`${inputCls} !h-8 !w-48 !py-1 text-xs`} placeholder="Find a tab or field…"
                value={tabSearch} onChange={(e) => setTabSearch(e.target.value)} aria-label="Find a tab or field" />}>
              <div className="space-y-3">
                {MODULE_ORDER.map((mod) => {
                  const mq = tabSearch.trim().toLowerCase();
                  const modTabs = tabs.filter((t) => moduleOf(t) === mod)
                    .filter((t) => !mq
                      || t.label.toLowerCase().includes(mq)
                      || t.fields.some((f) => f.label.toLowerCase().includes(mq)));
                  if (!modTabs.length) return null;
                  const grantedInMod = modTabs.filter((t) => form.tabAccess[t.key]).length;
                  return (
                    <div key={mod} className="overflow-hidden rounded-card border border-subtle">
                      <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-2 px-3 py-2">
                        <span className="text-xs font-bold uppercase tracking-wide text-secondary">
                          {mod}
                          <span className="ml-2 font-semibold normal-case text-muted">
                            {grantedInMod}/{modTabs.length} granted
                          </span>
                        </span>
                        <span className="flex gap-1.5">
                          <button type="button" className="text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-300"
                            onClick={() => setForm((f) => {
                              const tabAccess = { ...f.tabAccess };
                              modTabs.forEach((t) => { tabAccess[t.key] = "view"; });
                              return { ...f, tabAccess };
                            })}>
                            All view
                          </button>
                          <button type="button" className="text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-300"
                            onClick={() => setForm((f) => {
                              const tabAccess = { ...f.tabAccess };
                              modTabs.forEach((t) => { tabAccess[t.key] = "edit"; });
                              return { ...f, tabAccess };
                            })}>
                            All edit
                          </button>
                          <button type="button" className="text-[11px] font-semibold text-muted hover:underline"
                            onClick={() => setForm((f) => {
                              const tabAccess = { ...f.tabAccess };
                              modTabs.forEach((t) => { delete tabAccess[t.key]; });
                              return { ...f, tabAccess };
                            })}>
                            Clear
                          </button>
                        </span>
                      </div>
                      {mod === IV_MODULE && <p className="border-b border-subtle px-3 py-1.5 text-[11px] text-muted">{IV_MODULE_HINT}</p>}
                      <div className="divide-y divide-subtle">
                        {modTabs.map((tab) => {
                          const open = !!expanded[tab.key];
                          const tabMode = form.tabAccess[tab.key] || "";
                          const overrides = Object.keys(form.fieldAccess[tab.key] || {}).length;
                          return (
                            <div key={tab.key}>
                              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                                <button type="button" className={`inline-flex items-center gap-1 text-sm font-medium text-primary ${focusRing}`}
                                  onClick={() => setExpanded((e) => ({ ...e, [tab.key]: !open }))} disabled={!tab.fields.length}>
                                  {tab.fields.length ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="w-3.5" />}
                                  {tab.label}
                                  {overrides > 0 && (
                                    <span className="ml-1 rounded-full bg-brand-50 px-1.5 text-[10px] font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                                      title={`${overrides} field override(s)`}>
                                      {overrides}
                                    </span>
                                  )}
                                </button>
                                <ModeSegments value={tabMode} onChange={(m) => setTabMode(tab.key, m)} />
                              </div>
                              {open && tab.fields.length > 0 && (
                                <div className="bg-surface-2 px-6 py-2">
                                  <p className="mb-1.5 text-[11px] text-muted">
                                    Fields inherit the tab mode unless set here. A view-only field stays
                                    locked even when the tab allows edit.
                                  </p>
                                  <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                                    {tab.fields.map((fld) => (
                                      <div key={fld.key} className="flex items-center justify-between gap-2">
                                        <span className="text-sm text-secondary">{fld.label}</span>
                                        <select className={`${inputCls} !max-w-36`}
                                          value={form.fieldAccess[tab.key]?.[fld.key] || ""}
                                          onChange={(e) => setFieldMode(tab.key, fld.key, e.target.value)}>
                                          {FIELD_MODE_OPTS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                                        </select>
                                      </div>
                                    ))}
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
            </DialogSection>

            {approvalDefs.length > 0 && (
              <DialogSection n={3} tone="brand" title="Buttons & approvals" optional done={form.actions.length > 0}
                hint="A tab grant never implies an approval — tick what this template's users may press.">
                <ApprovalGrantsHeading count={form.actions.length} total={approvalDefs.length} />
                {form.actionsUnset && (
                  <p className="mb-2 rounded-control border border-subtle bg-surface-2 px-3 py-2 text-xs text-secondary">
                    Approvals were never set on this template, so today its users follow their role's
                    defaults. The ticks below are those defaults — saving makes them this template's rule.
                  </p>
                )}
                <ApprovalGrants approvals={approvalDefs} value={form.actions}
                  onChange={(actions) => setForm((f) => ({ ...f, actions }))} />
              </DialogSection>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-subtle pt-3">
              <div className="flex gap-2">
                <button type="button" className={btnPrimary} onClick={save} disabled={busy}>
                  <Save size={14} /> {busy ? "Saving…" : form.id ? "Save changes" : "Create template"}
                </button>
                {form.id && (
                  <button
                    type="button"
                    className={btnDanger}
                    onClick={() => setConfirmDelete(true)}
                    disabled={busy}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                )}
                <button type="button" className={btnSecondary} onClick={closeEditor} disabled={busy}>
                  <X size={14} /> Close
                </button>
              </div>
              {form.id && (
                <div id="tpl-assign" className="flex items-end gap-2">
                  <Field label="Assign to user">
                    <select className={inputCls} value={assignUser} onChange={(e) => setAssignUser(e.target.value)}>
                      <option value="">Select user…</option>
                      {users.map((u) => <option key={u.id} value={String(u.id)}>{u.full_name || u.username || u.email || `#${u.id}`}</option>)}
                    </select>
                  </Field>
                  <button type="button" className={btnSecondary} onClick={assign} disabled={!assignUser}><UserPlus size={14} /> Assign</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {confirmDelete && form.id && (
        <ConfirmModal
          title="Delete an access template?"
          message={<>Do you want to delete this access template (<b>{form.name || `#${form.id}`}</b>)? This cannot be undone.</>}
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={() => { void remove(); }}
          onClose={() => { if (!busy) setConfirmDelete(false); }}
        />
      )}
    </div>
  );
}
