/** Access Templates (Admin/CEO) — create department/role-wise templates that grant,
 * per CRM tab and per field, a mode of View or Insert/Edit, and assign them to users.
 * API: /api/access-templates (+ /registry, /assign). Tokens/components only. */
import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Save, Trash2, UserPlus, X } from "lucide-react";
import { crmGet, crmPost, crmPut, crmDelete, qs } from "../api";
import {
  EmptyState, ErrorBox, Field, Spinner, StatusBadge,
  btnDanger, btnPrimary, btnSecondary, focusRing, inputCls, useToast,
} from "../components/ui";
import { crmNavigate } from "../router";

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
const MODE_OPTS = [
  { value: "", label: "No access" },
  { value: "view", label: "View" },
  { value: "edit", label: "Insert / Edit" },
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
  const [toast, notify] = useToast();
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [form, setForm] = useState<Form>(emptyForm());
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [assignUser, setAssignUser] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

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
      closeEditor();
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

  if (err && !registry) return <ErrorBox error={err} />;
  if (!registry) return <div className="rounded-card border border-subtle bg-surface-1 p-6"><Spinner /></div>;

  return (
    <div className="space-y-4">
      {toast}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-display text-lg font-bold text-primary">Access Templates</h1>
          <p className="text-xs text-muted">Admin/CEO — grant each tab & field as View or Insert/Edit, then assign to users.</p>
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
              <div className="fx-hairline-b mb-2 flex items-center justify-between pb-2">
                <h2 className="text-sm font-semibold text-primary">Tab & field access</h2>
                <span className="text-xs text-muted">{tabCount} tab{tabCount === 1 ? "" : "s"} granted</span>
              </div>
              <div className="divide-y divide-subtle rounded-card border border-subtle">
                {tabs.map((tab) => {
                  const open = !!expanded[tab.key];
                  const tabMode = form.tabAccess[tab.key] || "";
                  return (
                    <div key={tab.key}>
                      <div className="flex items-center justify-between gap-2 px-3 py-2">
                        <button type="button" className={`inline-flex items-center gap-1 text-sm font-medium text-primary ${focusRing}`}
                          onClick={() => setExpanded((e) => ({ ...e, [tab.key]: !open }))} disabled={!tab.fields.length}>
                          {tab.fields.length ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="w-3.5" />}
                          {tab.label}
                        </button>
                        <select className={`${inputCls} max-w-40`} value={tabMode} onChange={(e) => setTabMode(tab.key, e.target.value)}>
                          {MODE_OPTS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                      </div>
                      {open && tab.fields.length > 0 && (
                        <div className="space-y-1 bg-surface-2 px-6 py-2">
                          {tab.fields.map((fld) => (
                            <div key={fld.key} className="flex items-center justify-between gap-2">
                              <span className="text-sm text-secondary">{fld.label}</span>
                              <select className={`${inputCls} max-w-40`}
                                value={form.fieldAccess[tab.key]?.[fld.key] || ""}
                                onChange={(e) => setFieldMode(tab.key, fld.key, e.target.value)}>
                                {MODE_OPTS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                              </select>
                            </div>
                          ))}
                        </div>
                      )}
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
                {form.id && <button type="button" className={btnDanger} onClick={remove} disabled={busy}><Trash2 size={14} /> Delete</button>}
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
    </div>
  );
}
