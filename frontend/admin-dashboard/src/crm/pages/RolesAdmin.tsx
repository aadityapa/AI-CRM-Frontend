/**
 * Access Control ▸ Roles (23 Sep 2026).
 *
 * Roles grouped by DEPARTMENT (7 Oct 2026, user ask): one section per
 * department (`registry.departments`, B-V2 `access_registry.DEPARTMENTS`), the
 * eight built-in roles and every custom role Admin/CEO has created
 * (`GET /api/roles`) as cards with people / tabs / buttons counts. A custom role is a name + the same tab grant
 * map an Access Template uses (`TabPermissionMatrix`), and it takes effect
 * for its members exactly like an authoritative template — see B-V2
 * `models/custom_roles.py`. From here Admin/CEO can create/edit/deactivate a
 * role, manage its members, and reset any member's password.
 *
 * Built-in roles are listed for completeness only: their permissions come from
 * the product's role rules and membership is edited on the Users tab.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeIndianRupee, ClipboardCheck, Cpu, Crown, Handshake, HeartHandshake, KeyRound, Pencil, Plus, Search, Shapes,
  Shield, ShieldCheck, Trash2, UserMinus, UserPlus, UserSearch, Users, type LucideIcon,
} from "lucide-react";
import { DialogHero, DialogSection } from "../components/dialogKit";
import { crmDelete, crmGet, crmPost, crmPut } from "../api";
import { fetchAllMaster } from "../lib/fetchAllMaster";
import { TabPermissionMatrix, type GrantMap, type RegistryTab } from "../components/TabPermissionMatrix";
import { ApprovalGrants, ApprovalGrantsHeading, type ApprovalDef } from "../components/ApprovalGrants";
import { ResetPasswordModal } from "../components/ResetPasswordModal";
import { Avatar } from "../components/Avatar";
import {
  ConfirmModal, EmptyState, ErrorBox, Modal, Spinner, StatusBadge,
  btnPrimary, btnSecondary, inputCls,
} from "../components/ui";

type BuiltinRole = { name: string; label: string; builtin: true; members_count: number; description: string; department?: string };
type CustomRole = {
  id: number; name: string; description: string; is_active: boolean;
  tab_access: GrantMap; field_access: Record<string, Record<string, string>>;
  /** Approval buttons the role grants (server resolves a never-configured role
   *  to the approvals whose default names it). */
  action_access?: string[];
  /** Where the role sits on this page (7 Oct 2026) — a registry department key. */
  department?: string;
  members_count: number; builtin: false;
};
type Member = { id: number; full_name: string; email: string; username: string; is_active: boolean };
type UserOpt = { id: number; full_name: string; email: string; username: string; is_active: boolean; roles?: string[]; custom_roles?: string[] };
type Notify = (msg: string, kind?: "ok" | "err") => void;
type Department = { key: string; label: string };

const actionBtn =
  "inline-flex items-center gap-1 rounded-control border border-strong px-2 py-1 text-xs font-semibold text-secondary hover:bg-surface-2 disabled:opacity-50";

/** Department → icon + gradient. Keys mirror B-V2 `access_registry.DEPARTMENTS`. */
export const DEPARTMENT_LOOK: Record<string, { icon: LucideIcon; accent: string; blurb: string }> = {
  leadership: { icon: Crown, accent: "from-slate-700 to-slate-900", blurb: "Admin / CEO — every tab, every button." },
  sales: { icon: Handshake, accent: "from-sky-500 to-blue-600", blurb: "Deals, customers, the customer's interview rounds and terms." },
  recruitment: { icon: UserSearch, accent: "from-violet-500 to-fuchsia-600", blurb: "Sourcing, applied candidates, scheduling every round." },
  engineering: { icon: Cpu, accent: "from-indigo-500 to-violet-700", blurb: "Screening, the technical ladder, positions and templates." },
  panel: { icon: ClipboardCheck, accent: "from-purple-500 to-purple-700", blurb: "Employees who take the technical interviews — My Interviews only." },
  hr: { icon: HeartHandshake, accent: "from-teal-500 to-emerald-600", blurb: "HR round, onboarding, the employee master, leave." },
  finance: { icon: BadgeIndianRupee, accent: "from-amber-500 to-orange-600", blurb: "Proformas, tax invoices, receipts, TDS." },
  other: { icon: Shapes, accent: "from-slate-500 to-slate-700", blurb: "Roles not placed in a department yet — edit one to move it." },
};
const FALLBACK_DEPTS: Department[] = [
  { key: "leadership", label: "Leadership" }, { key: "sales", label: "Sales" }, { key: "recruitment", label: "Recruitment (TA)" },
  { key: "engineering", label: "Engineering / RMG" }, { key: "panel", label: "Interview Panel" }, { key: "hr", label: "HR" },
  { key: "finance", label: "Finance" }, { key: "other", label: "Other" },
];

function tabSummary(grants: GrantMap, labels: Map<string, string>): string {
  const keys = Object.keys(grants).filter((k) => grants[k]);
  if (!keys.length) return "—";
  const shown = keys.slice(0, 4).map((k) => `${labels.get(k) || k} (${grants[k]})`);
  return shown.join(", ") + (keys.length > 4 ? ` +${keys.length - 4} more` : "");
}

/** Roles grouped by department, in catalogue order; a department with no role
 *  is left out. Built-in roles follow the server's fixed map. PURE. */
export function groupRolesByDepartment<B extends { department?: string }, C extends { department?: string }>(
  departments: Department[], builtin: B[], custom: C[],
): { dept: Department; builtin: B[]; custom: C[] }[] {
  const keys = new Set(departments.map((d) => d.key));
  const of = (r: { department?: string }) => (r.department && keys.has(r.department) ? r.department : "other");
  return departments
    .map((dept) => ({ dept, builtin: builtin.filter((r) => of(r) === dept.key), custom: custom.filter((r) => of(r) === dept.key) }))
    .filter((g) => g.builtin.length + g.custom.length > 0);
}

export function RolesPanel({ notify }: { notify: Notify }) {
  const [builtin, setBuiltin] = useState<BuiltinRole[]>([]);
  const [custom, setCustom] = useState<CustomRole[]>([]);
  const [registry, setRegistry] = useState<RegistryTab[]>([]);
  const [approvals, setApprovals] = useState<ApprovalDef[]>([]);
  const [departments, setDepartments] = useState<Department[]>(FALLBACK_DEPTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CustomRole | { department: string } | null>(null);
  const [membersFor, setMembersFor] = useState<CustomRole | null>(null);
  const [deleteFor, setDeleteFor] = useState<CustomRole | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [roles, reg] = await Promise.all([
        crmGet<{ builtin: BuiltinRole[]; custom: CustomRole[] }>("/api/roles"),
        crmGet<{ tabs: RegistryTab[]; approvals?: ApprovalDef[]; departments?: Department[] }>("/api/access-templates/registry"),
      ]);
      setBuiltin(roles.data?.builtin || []);
      setCustom(roles.data?.custom || []);
      setRegistry(reg.data?.tabs || []);
      setApprovals(reg.data?.approvals || []);
      if (reg.data?.departments?.length) setDepartments(reg.data.departments);
    } catch (err: any) {
      setError(err?.message || "Could not load roles");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const labels = useMemo(() => new Map(registry.map((t) => [t.key, t.label])), [registry]);
  const q = search.trim().toLowerCase();
  const matches = (name: string, desc?: string) => !q || name.toLowerCase().includes(q) || (desc || "").toLowerCase().includes(q);
  const groups = useMemo(() => groupRolesByDepartment(
    departments,
    builtin.filter((r) => matches(r.label, r.description)),
    custom.filter((r) => matches(r.name, r.description)),
  ), [departments, builtin, custom, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalMembers = builtin.reduce((n, r) => n + r.members_count, 0) + custom.reduce((n, r) => n + r.members_count, 0);

  const remove = async () => {
    if (!deleteFor) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      const res = await crmDelete(`/api/roles/${deleteFor.id}`);
      notify(res.message || "Role deleted");
      setDeleteFor(null);
      void load();
    } catch (err: any) {
      setDeleteError(err?.message || "Could not delete the role");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-2xl">
          <p className="text-sm text-secondary">
            Roles are grouped by <strong>department</strong>. A built-in role carries the product's own rules; a
            custom role is a name plus exactly the tabs and buttons you tick — add people to it and that is all they get.
          </p>
          <p className="mt-1 text-xs text-muted">
            {builtin.length + custom.length} roles · {totalMembers} memberships · {groups.length} departments
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input className={`${inputCls} !w-56 !pl-8`} placeholder="Find a role…" value={search}
              onChange={(e) => setSearch(e.target.value)} aria-label="Find a role" />
          </div>
          <button className={btnPrimary} onClick={() => setEditing({ department: "other" })}>
            <Plus size={15} /> New role
          </button>
        </div>
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}
      {loading ? <Spinner label="Loading roles…" /> : groups.length === 0 ? (
        <EmptyState message={q ? "No role matches that search." : "No roles yet."} />
      ) : groups.map(({ dept, builtin: b, custom: c }) => {
        const look = DEPARTMENT_LOOK[dept.key] || DEPARTMENT_LOOK.other;
        const Icon = look.icon;
        const members = b.reduce((n, r) => n + r.members_count, 0) + c.reduce((n, r) => n + r.members_count, 0);
        return (
          <section key={dept.key} className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised" aria-label={dept.label}>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-4 py-3">
              <div className="flex items-center gap-3">
                <span className={`inline-flex h-10 w-10 flex-none items-center justify-center rounded-card bg-gradient-to-br ${look.accent} text-white shadow-raised`}>
                  <Icon size={18} aria-hidden />
                </span>
                <div>
                  <h3 className="text-base font-bold text-primary">{dept.label}</h3>
                  <p className="text-xs text-secondary">{look.blurb}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold tabular-nums text-secondary">
                  {b.length + c.length} role{b.length + c.length === 1 ? "" : "s"} · {members} people
                </span>
                <button className={actionBtn} onClick={() => setEditing({ department: dept.key })} title={`Create a custom role in ${dept.label}`}>
                  <Plus size={13} /> Role here
                </button>
              </div>
            </header>
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {c.map((r) => (
                <article key={`c-${r.id}`} className={`flex flex-col rounded-card border p-3 ${r.is_active ? "border-subtle bg-surface-1" : "border-dashed border-subtle bg-surface-2 opacity-80"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <ShieldCheck size={16} className="flex-none text-brand-600 dark:text-brand-300" aria-hidden />
                      <span className="truncate text-sm font-bold text-primary">{r.name}</span>
                    </div>
                    <span className="flex flex-none items-center gap-1">
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">Custom</span>
                      {!r.is_active && <StatusBadge status="Inactive" />}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 min-h-[2rem] text-xs text-secondary">{r.description || "No description."}</p>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-control bg-surface-2 px-2 py-1.5">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">People</dt>
                      <dd className="text-sm font-bold tabular-nums text-primary">{r.members_count}</dd>
                    </div>
                    <div className="rounded-control bg-surface-2 px-2 py-1.5">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">Tabs</dt>
                      <dd className="text-sm font-bold tabular-nums text-primary">{Object.keys(r.tab_access).filter((k) => r.tab_access[k]).length}</dd>
                    </div>
                    <div className="rounded-control bg-surface-2 px-2 py-1.5">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">Buttons</dt>
                      <dd className="text-sm font-bold tabular-nums text-primary">{r.action_access?.length ?? 0}</dd>
                    </div>
                  </dl>
                  <p className="mt-2 truncate text-[11px] text-muted" title={tabSummary(r.tab_access, labels)}>{tabSummary(r.tab_access, labels)}</p>
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                    <button className={actionBtn} onClick={() => setMembersFor(r)} title="Add or remove members, reset a member's password">
                      <Users size={13} /> Members
                    </button>
                    <button className={actionBtn} onClick={() => setEditing(r)} title="Edit name, department, tabs and buttons">
                      <Pencil size={13} /> Edit
                    </button>
                    <button className={`${actionBtn} text-danger`} onClick={() => { setDeleteError(""); setDeleteFor(r); }} title="Delete (only once it has no members)">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </article>
              ))}
              {b.map((r) => (
                <article key={`b-${r.name}`} className="flex flex-col rounded-card border border-subtle bg-surface-2/0 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Shield size={16} className="flex-none text-muted" aria-hidden />
                      <span className="truncate text-sm font-bold text-primary">{r.label}</span>
                    </div>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-secondary">Built-in</span>
                  </div>
                  <p className="mt-1 line-clamp-2 min-h-[2rem] text-xs text-secondary">Permissions come from the product's role rules; an Access Template can narrow or widen the tabs.</p>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-control bg-surface-2 px-2 py-1.5">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">People</dt>
                      <dd className="text-sm font-bold tabular-nums text-primary">{r.members_count}</dd>
                    </div>
                    <div className="col-span-2 rounded-control bg-surface-2 px-2 py-1.5">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">Assigned from</dt>
                      <dd className="text-sm font-semibold text-primary">Users ▸ Edit roles</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </section>
        );
      })}

      {editing && (
        <RoleEditorModal
          role={"id" in editing ? editing : null}
          initialDepartment={"id" in editing ? editing.department : editing.department}
          departments={departments}
          registry={registry}
          approvals={approvals}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
          notify={notify}
        />
      )}
      {membersFor && (
        <RoleMembersModal role={membersFor} labels={labels} onClose={() => { setMembersFor(null); void load(); }} notify={notify} />
      )}
      {deleteFor && (
        <ConfirmModal
          title={`Delete role "${deleteFor.name}"`}
          message={deleteFor.members_count > 0
            ? `This role still has ${deleteFor.members_count} member(s). Remove them first, or deactivate the role instead.`
            : "The role and its permissions are removed. Users keep their built-in roles."}
          confirmLabel="Delete"
          danger
          busy={deleteBusy}
          error={deleteError}
          onConfirm={remove}
          onClose={() => setDeleteFor(null)}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- editor */

function RoleEditorModal({
  role, initialDepartment, departments, registry, approvals, onClose, onSaved, notify,
}: {
  role: CustomRole | null; initialDepartment?: string; departments: Department[];
  registry: RegistryTab[]; approvals: ApprovalDef[];
  onClose: () => void; onSaved: () => void; notify: Notify;
}) {
  const [name, setName] = useState(role?.name || "");
  const [description, setDescription] = useState(role?.description || "");
  const [department, setDepartment] = useState(role?.department || initialDepartment || "other");
  const [isActive, setIsActive] = useState(role?.is_active ?? true);
  const [grants, setGrants] = useState<GrantMap>(role?.tab_access || {});
  const [actions, setActions] = useState<string[]>(role?.action_access || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const granted = Object.keys(grants).filter((k) => grants[k]).length;
  const dirty = name !== (role?.name || "") || description !== (role?.description || "")
    || department !== (role?.department || initialDepartment || "other") || isActive !== (role?.is_active ?? true)
    || JSON.stringify(grants) !== JSON.stringify(role?.tab_access || {}) || JSON.stringify(actions) !== JSON.stringify(role?.action_access || []);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const body = {
        name: name.trim(), description: description.trim(), is_active: isActive, department,
        tab_access: grants, action_access: actions,
      };
      const res = role
        ? await crmPut(`/api/roles/${role.id}`, body)
        : await crmPost("/api/roles", body);
      notify(res.message || "Role saved");
      onSaved();
    } catch (err: any) {
      setError(err?.message || "Could not save the role");
    } finally {
      setBusy(false);
    }
  };
  const look = DEPARTMENT_LOOK[department] || DEPARTMENT_LOOK.other;

  return (
    <Modal
      title={role ? `Edit role — ${role.name}` : "New role"}
      onClose={onClose}
      wide
      dirty={dirty}
      hero={<DialogHero tone="indigo" icon={ShieldCheck} eyebrow={role ? "Custom role · edit" : "Custom role"}
        title={role ? role.name : name.trim() || "New role"}
        subtitle="A name, a department, the tabs and the buttons — members get exactly this, nothing more."
        flow={{ steps: ["Name & department", "Tabs", "Buttons & approvals", "Members"], current: 0 }} />}
      footer={
        <>
          <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={btnPrimary} onClick={save} disabled={busy || name.trim().length < 2 || granted === 0}>
            {busy ? "Saving…" : role ? "Save changes" : "Create role"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <DialogSection n={1} tone="indigo" title="Name & department" done={name.trim().length >= 2}
          hint="The department only decides where the role is listed; it grants nothing by itself.">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr]">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-secondary">Role name</span>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GM" maxLength={40} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-secondary">Department</span>
              <select className={inputCls} value={department} onChange={(e) => setDepartment(e.target.value)}>
                {departments.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-secondary">Description</span>
              <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. General Manager — invoices and purchase orders" maxLength={512} />
            </label>
          </div>
          <p className="mt-2 text-xs text-muted">{look.blurb}</p>
          <label className="mt-2 inline-flex items-center gap-2 text-sm text-secondary">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active — an inactive role grants nothing until switched back on
          </label>
        </DialogSection>
        <DialogSection n={2} tone="indigo" title="Tabs the role opens" done={granted > 0}
          hint="View · Edit · Create per tab. Interview Platform tabs: once one is ticked the role decides the whole platform.">
          <TabPermissionMatrix tabs={registry} value={grants} onChange={setGrants} />
          {granted === 0 && <p className="mt-2 text-xs text-warning">Grant at least one tab — a role with nothing granted cannot open anything.</p>}
        </DialogSection>
        {approvals.length > 0 && (
          <DialogSection n={3} tone="indigo" title="Buttons & approvals" optional done={actions.length > 0}
            hint="Which approvals and manage buttons this role may press. A tab grant never implies an approval.">
            <ApprovalGrantsHeading count={actions.length} total={approvals.length} />
            <ApprovalGrants approvals={approvals} value={actions} onChange={setActions} />
          </DialogSection>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- members */

function MemberRoleChips({ roles }: { roles?: string[] }) {
  if (!roles?.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <span key={r} className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
          {r.replace(/_/g, " ")}
        </span>
      ))}
    </span>
  );
}

function RoleMembersModal({
  role, labels, onClose, notify,
}: { role: CustomRole; labels: Map<string, string>; onClose: () => void; notify: Notify }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [resetFor, setResetFor] = useState<Member | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [m, u] = await Promise.all([
        crmGet<Member[]>(`/api/roles/${role.id}/members`),
        fetchAllMaster<UserOpt>("/api/users"),
      ]);
      setMembers(m.data || []);
      setUsers(u);
    } catch (err: any) {
      setError(err?.message || "Could not load members");
    } finally {
      setLoading(false);
    }
  }, [role.id]);
  useEffect(() => { void load(); }, [load]);

  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);
  const q = search.trim().toLowerCase();
  const candidates = users
    .filter((u) => !memberIds.has(u.id))
    .filter((u) => !q || (u.full_name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q) || (u.username || "").toLowerCase().includes(q));
  const grantedTabs = Object.keys(role.tab_access).filter((k) => role.tab_access[k]);

  const save = async (ids: number[]) => {
    setBusy(true);
    setError("");
    try {
      const res = await crmPut<Member[]>(`/api/roles/${role.id}/members`, { user_ids: ids });
      setMembers(res.data || []);
      notify(res.message || "Members updated");
    } catch (err: any) {
      setError(err?.message || "Could not update members");
    } finally {
      setBusy(false);
    }
  };
  const add = (id: number) => save([...members.map((m) => m.id), id]);
  const removeMember = (id: number) => save(members.filter((m) => m.id !== id).map((m) => m.id));

  return (
    <Modal
      title={`${role.name} — members`}
      onClose={onClose}
      xl
      footer={
        <>
          <span className="mr-auto text-xs text-muted">
            {members.length} member{members.length === 1 ? "" : "s"} · changes save immediately
          </span>
          <button className={btnPrimary} onClick={onClose}>Done</button>
        </>
      }
    >
      {/* Role summary — what a member of this role actually gets. */}
      <div className="mb-4 flex flex-wrap items-start gap-4 rounded-card border border-subtle bg-surface-2 p-4">
        <span className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-card bg-brand-600 text-white shadow-raised">
          <ShieldCheck size={22} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-bold text-primary">{role.name}</span>
            <StatusBadge status={role.is_active ? "Active" : "Inactive"} />
            <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-[11px] font-semibold text-brand-600 dark:text-brand-300">Custom role</span>
          </div>
          {role.description && <p className="mt-0.5 text-sm text-secondary">{role.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Grants</span>
            {grantedTabs.length === 0 && <span className="text-xs text-muted">nothing yet</span>}
            {grantedTabs.map((k) => (
              <span key={k} className="inline-flex items-center gap-1 rounded-full border border-subtle bg-surface-1 px-2 py-0.5 text-[11px] font-medium text-secondary">
                {labels.get(k) || k}
                <span className="text-muted">· {role.tab_access[k]}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="mb-3"><ErrorBox error={error} onRetry={load} /></div>}
      {loading ? <Spinner label="Loading members…" /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Current members */}
          <section className="flex min-h-[18rem] flex-col rounded-card border border-subtle bg-surface-1">
            <header className="flex items-center justify-between fx-hairline-b px-4 py-2.5">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-primary">
                <Users size={15} className="text-brand-600 dark:text-brand-300" aria-hidden /> In this role
              </span>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold tabular-nums text-secondary">{members.length}</span>
            </header>
            {members.length === 0 ? (
              <div className="flex flex-1 items-center justify-center p-6">
                <EmptyState message="Nobody in this role yet — pick people from the list on the right." />
              </div>
            ) : (
              <ul className="divide-y divide-subtle">
                {members.map((m) => {
                  const u = byId.get(m.id);
                  return (
                    <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                      <Avatar name={m.full_name || m.username} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-primary">{m.full_name || m.username}</span>
                          {!m.is_active && <StatusBadge status="Inactive" />}
                        </div>
                        <div className="truncate text-xs text-muted">{m.email}</div>
                        <div className="mt-1"><MemberRoleChips roles={u?.roles} /></div>
                      </div>
                      <span className="inline-flex flex-none gap-1.5">
                        <button className={actionBtn} onClick={() => setResetFor(m)} title="Set or generate a new password">
                          <KeyRound size={13} /> Reset password
                        </button>
                        <button className={`${actionBtn} text-danger`} onClick={() => removeMember(m.id)} disabled={busy} title="Remove from this role">
                          <UserMinus size={13} /> Remove
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Add people */}
          <section className="flex min-h-[18rem] flex-col rounded-card border border-subtle bg-surface-1">
            <header className="flex items-center justify-between fx-hairline-b px-4 py-2.5">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-primary">
                <UserPlus size={15} className="text-brand-600 dark:text-brand-300" aria-hidden /> Add people
              </span>
              <span className="text-xs text-muted">{candidates.length} available</span>
            </header>
            <div className="px-4 pt-3">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
                <input
                  className={`${inputCls} !pl-8`}
                  placeholder="Search by name, email or username…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search users"
                />
              </div>
            </div>
            <ul className="mt-2 max-h-80 flex-1 divide-y divide-subtle overflow-auto">
              {candidates.slice(0, 50).map((u) => (
                <li key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar name={u.full_name || u.username} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-primary">{u.full_name || u.username}</span>
                      {!u.is_active && <StatusBadge status="Inactive" />}
                    </div>
                    <div className="truncate text-xs text-muted">{u.email}</div>
                    <div className="mt-1"><MemberRoleChips roles={u.roles} /></div>
                  </div>
                  <button className={btnSecondary} onClick={() => add(u.id)} disabled={busy} title={`Add ${u.full_name || u.username} to ${role.name}`}>
                    <Plus size={14} /> Add
                  </button>
                </li>
              ))}
              {candidates.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-muted">
                  {q ? "No user matches that search." : "Everyone is already in this role."}
                </li>
              )}
            </ul>
          </section>
        </div>
      )}
      {resetFor && <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} notify={notify} />}
    </Modal>
  );
}
