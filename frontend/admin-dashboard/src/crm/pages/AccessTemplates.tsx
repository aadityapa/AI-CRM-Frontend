/** Access Templates (Admin/CEO) — create department/role-wise templates that grant,
 * per CRM tab, a LADDER mode (View < Edit < Create — higher includes lower) and,
 * per field, View or Edit. For assigned users the template is AUTHORITATIVE:
 * it decides what they can do, even beyond their role's defaults.
 * API: /api/access-templates (+ /registry, /assign). Tokens/components only. */
import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Save, Trash2, UserPlus, X } from "lucide-react";
import { crmGet, crmPost, crmPut, crmDelete, qs } from "../api";
import {
  ConfirmModal, EmptyState, ErrorBox, Field, Spinner, StatusBadge,
  btnDanger, btnPrimary, btnSecondary, focusRing, inputCls, useToast,
} from "../components/ui";
import { crmNavigate } from "../router";
import { useHasRole } from "../CrmApp";

type RegField = { key: string; label: string };
type RegTab = { key: string; label: string; fields: RegField[] };
type Registry = { modes: string[]; tabs: RegTab[] };
type Template = {
  id: number; name: string; description?: string | null; role?: string | null;
  department_id?: number | null; is_active: boolean;
  tab_access: Record<string, string>; field_access: Record<string, Record<string, string>>;
};
type User = { id: number; full_name?: string; email?: string; username?: string };
type Dept = { id: number; name: string };

const ROLES = ["Sales", "Sales_Head", "RMG", "TA", "HR", "Finance"];

/** Module grouping (25 Aug 2026) — the flat 25-tab list read as a wall; this
 * mirrors how people think about the app. Unknown keys fall into "Other" so a
 * future registry tab can never silently disappear from the editor. */
const TAB_MODULES: Record<string, string> = {
  dashboard: "General", calendar: "General", reports: "General",
  customers: "Sales", opportunities: "Sales", "rate-cards": "Sales", "branch-policy": "Sales",
  requirements: "Recruitment", candidates: "Recruitment", profiles: "Recruitment",
  "template-requests": "Recruitment",
  projects: "Projects & Finance", "project-employees": "Projects & Finance",
  timesheets: "Projects & Finance", pos: "Projects & Finance", invoices: "Projects & Finance",
  tds: "Projects & Finance", "finance-reports": "Projects & Finance",
  employees: "HR", holidays: "HR", "my-leave": "HR", "leave-applications": "HR", payroll: "HR",
  users: "Administration", settings: "Administration",
};
const MODULE_ORDER = ["General", "Sales", "Recruitment", "Projects & Finance", "HR", "Administration", "Other"];

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
/** Tab modes are a ladder: each level includes everything below it. */
const MODE_OPTS = [
  { value: "", label: "No access" },
  { value: "view", label: "View" },
  { value: "edit", label: "View + Edit" },
  { value: "create", label: "View + Edit + Create" },
];
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
};

const emptyForm = (): Form => ({
  id: null, name: "", description: "", role: "", department_id: "", is_active: true,
  tabAccess: {}, fieldAccess: {},
});

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
      await crmPost("/api/access-templates/assign", { user_id: Number(assignUser), template_id: form.id });
      notify("Template assigned to user");
      setAssignUser("");
    } catch (e: any) { setErr(String(e?.message || e)); }
  };

  const tabs = registry?.tabs || [];
  const tabCount = Object.keys(form.tabAccess).length;

  if (!isAdminUser) {
    return <EmptyState message="Access Templates are managed by Admin/CEO only." />;
  }
  if (err && !registry) return <ErrorBox error={err} />;
  if (!registry) return <div className="rounded-card border border-subtle bg-surface-1 p-6"><Spinner /></div>;

  return (
    <div className="space-y-4">
      {toast}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-display text-lg font-bold text-primary">Access Templates</h1>
          <p className="text-xs text-muted">
            Admin/CEO — grant each tab a mode (View &lt; Edit &lt; Create, higher includes lower)
            and lock individual fields, then assign to users. For assigned users the template is
            the authority: it decides what they can do, even beyond their role's defaults.
          </p>
        </div>
        <button type="button" className={btnSecondary} onClick={openNewTemplate}>
          <Plus size={14} /> New template
        </button>
      </div>
      {err && <ErrorBox error={err} />}

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* list */}
        <div className="space-y-1 rounded-card border border-subtle bg-surface-1 p-2">
          {templates.length === 0
            ? <EmptyState message="No templates yet." />
            : templates.map((t) => (
              <button key={t.id} type="button"
                className={`flex w-full items-center justify-between rounded-control px-3 py-2 text-left text-sm ${focusRing} ${editing && form.id === t.id ? "bg-surface-2 font-semibold text-primary" : "text-secondary hover:bg-surface-2"}`}
                onClick={() => selectTemplate(t)}>
                <span>{t.name}</span>
                {!t.is_active && <StatusBadge status="Inactive" />}
              </button>
            ))}
        </div>

        {/* editor — only when editing is true */}
        {!editing ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-card border border-subtle bg-surface-1 p-8 text-center">
            <EmptyState message="Select a template from the list, or create a new one." />
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" className={btnPrimary} onClick={openNewTemplate}>
                <Plus size={14} /> New template
              </button>
              <button type="button" className={btnSecondary} onClick={() => crmNavigate("users")}>
                <X size={14} /> Close
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 rounded-card border border-subtle bg-surface-1 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-primary">{form.id ? "Edit template" : "New template"}</h2>
              <button type="button" className={btnSecondary} onClick={closeEditor} disabled={busy} title="Close without saving">
                <X size={14} /> Close
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Template name">
                <input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Sales" />
              </Field>
              <Field label="Role tag">
                <select className={inputCls} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                  <option value="">—</option>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
              <Field label="Department">
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
              <Field label="Description">
                <input className={inputCls} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </Field>
            </div>

            <div>
              <div className="fx-hairline-b mb-2 flex flex-wrap items-center justify-between gap-2 pb-2">
                <h2 className="text-sm font-semibold text-primary">Permissions</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-secondary">
                    {tabCount} tab{tabCount === 1 ? "" : "s"} granted
                  </span>
                  <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-secondary">
                    {Object.values(form.fieldAccess).reduce((n, m) => n + Object.keys(m).length, 0)} field override(s)
                  </span>
                  <input
                    className={`${inputCls} !h-8 !w-48 !py-1 text-xs`}
                    placeholder="Find a tab or field…"
                    value={tabSearch}
                    onChange={(e) => setTabSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-3">
                {MODULE_ORDER.map((mod) => {
                  const q = tabSearch.trim().toLowerCase();
                  const modTabs = tabs.filter((t) => (TAB_MODULES[t.key] || "Other") === mod)
                    .filter((t) => !q
                      || t.label.toLowerCase().includes(q)
                      || t.fields.some((f) => f.label.toLowerCase().includes(q)));
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
                                    <span className="ml-1 rounded-full bg-brand-600/10 px-1.5 text-[10px] font-bold text-brand-600 dark:text-brand-300"
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
                                        <select className={`${inputCls} max-w-36`}
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
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <button type="button" className={btnPrimary} onClick={save} disabled={busy}>
                  <Save size={14} /> {busy ? "Saving…" : "Save"}
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
                <div className="flex items-end gap-2">
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
        )}
      </div>
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
