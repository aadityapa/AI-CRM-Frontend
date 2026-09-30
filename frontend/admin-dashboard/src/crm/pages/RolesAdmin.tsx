/**
 * Access Control ▸ Roles (23 Sep 2026).
 *
 * One table of the eight built-in roles and every custom role Admin/CEO has
 * created (`GET /api/roles`). A custom role is a name + the same tab grant
 * map an Access Template uses (`TabPermissionMatrix`), and it takes effect
 * for its members exactly like an authoritative template — see B-V2
 * `models/custom_roles.py`. From here Admin/CEO can create/edit/deactivate a
 * role, manage its members, and reset any member's password.
 *
 * Built-in roles are listed for completeness only: their permissions come from
 * the product's role rules and membership is edited on the Users tab.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, Pencil, Plus, Search, Shield, ShieldCheck, Trash2, UserMinus, UserPlus, Users } from "lucide-react";
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

type BuiltinRole = { name: string; label: string; builtin: true; members_count: number; description: string };
type CustomRole = {
  id: number; name: string; description: string; is_active: boolean;
  tab_access: GrantMap; field_access: Record<string, Record<string, string>>;
  /** Approval buttons the role grants (server resolves a never-configured role
   *  to the approvals whose default names it). */
  action_access?: string[];
  members_count: number; builtin: false;
};
type Member = { id: number; full_name: string; email: string; username: string; is_active: boolean };
type UserOpt = { id: number; full_name: string; email: string; username: string; is_active: boolean; roles?: string[]; custom_roles?: string[] };
type Notify = (msg: string, kind?: "ok" | "err") => void;

const actionBtn =
  "inline-flex items-center gap-1 rounded-control border border-strong px-2 py-1 text-xs font-semibold text-secondary hover:bg-surface-2 disabled:opacity-50";

function tabSummary(grants: GrantMap, labels: Map<string, string>): string {
  const keys = Object.keys(grants).filter((k) => grants[k]);
  if (!keys.length) return "—";
  const shown = keys.slice(0, 4).map((k) => `${labels.get(k) || k} (${grants[k]})`);
  return shown.join(", ") + (keys.length > 4 ? ` +${keys.length - 4} more` : "");
}

export function RolesPanel({ notify }: { notify: Notify }) {
  const [builtin, setBuiltin] = useState<BuiltinRole[]>([]);
  const [custom, setCustom] = useState<CustomRole[]>([]);
  const [registry, setRegistry] = useState<RegistryTab[]>([]);
  const [approvals, setApprovals] = useState<ApprovalDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<CustomRole | "new" | null>(null);
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
        crmGet<{ tabs: RegistryTab[]; approvals?: ApprovalDef[] }>("/api/access-templates/registry"),
      ]);
      setBuiltin(roles.data?.builtin || []);
      setCustom(roles.data?.custom || []);
      setRegistry(reg.data?.tabs || []);
      setApprovals(reg.data?.approvals || []);
    } catch (err: any) {
      setError(err?.message || "Could not load roles");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const labels = useMemo(() => new Map(registry.map((t) => [t.key, t.label])), [registry]);

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
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted">
          A custom role bundles tab permissions under a name (e.g. <strong>GM</strong> with Invoices and
          Purchase Orders). Add people to it and they get exactly those tabs. Built-in roles keep the
          product's own rules and are assigned from the Users tab.
        </p>
        <button className={btnPrimary} onClick={() => setEditing("new")}>
          <Plus size={15} /> New role
        </button>
      </div>

      {error && <div className="mb-3"><ErrorBox error={error} onRetry={load} /></div>}
      {loading ? (
        <Spinner label="Loading roles…" />
      ) : (
        <div className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Members</th>
                <th className="px-4 py-2">Tabs granted</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {custom.map((r) => (
                <tr key={`c-${r.id}`} className="row-hover">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 font-semibold text-primary">
                      <ShieldCheck size={14} className="text-brand-600 dark:text-brand-300" aria-hidden /> {r.name}
                    </div>
                    {r.description && <div className="text-xs text-muted">{r.description}</div>}
                  </td>
                  <td className="px-4 py-2.5"><span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-[11px] font-semibold text-brand-600 dark:text-brand-300">Custom</span></td>
                  <td className="px-4 py-2.5 tabular-nums">{r.members_count}</td>
                  <td className="px-4 py-2.5 text-xs text-secondary">{tabSummary(r.tab_access, labels)}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={r.is_active ? "Active" : "Inactive"} /></td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="inline-flex flex-wrap justify-end gap-1.5">
                      <button className={actionBtn} onClick={() => setMembersFor(r)} title="Add or remove members, reset a member's password">
                        <Users size={13} /> Members
                      </button>
                      <button className={actionBtn} onClick={() => setEditing(r)} title="Edit name, description or tab permissions">
                        <Pencil size={13} /> Edit
                      </button>
                      <button className={`${actionBtn} text-danger`} onClick={() => { setDeleteError(""); setDeleteFor(r); }} title="Delete (only once it has no members)">
                        <Trash2 size={13} /> Delete
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
              {custom.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6">
                    <EmptyState message="No custom roles yet — create one to give a job title its own set of tabs, for example GM with Invoices and Purchase Orders." />
                  </td>
                </tr>
              )}
              {builtin.map((r) => (
                <tr key={`b-${r.name}`} className="row-hover">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 font-semibold text-primary">
                      <Shield size={14} className="text-muted" aria-hidden /> {r.label}
                    </div>
                    <div className="text-xs text-muted">{r.description}</div>
                  </td>
                  <td className="px-4 py-2.5"><span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-secondary">Built-in</span></td>
                  <td className="px-4 py-2.5 tabular-nums">{r.members_count}</td>
                  <td className="px-4 py-2.5 text-xs text-muted">Product rules + Access Template</td>
                  <td className="px-4 py-2.5"><StatusBadge status="Active" /></td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted">Assign on the Users tab</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <RoleEditorModal
          role={editing === "new" ? null : editing}
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
  role, registry, approvals, onClose, onSaved, notify,
}: {
  role: CustomRole | null; registry: RegistryTab[]; approvals: ApprovalDef[];
  onClose: () => void; onSaved: () => void; notify: Notify;
}) {
  const [name, setName] = useState(role?.name || "");
  const [description, setDescription] = useState(role?.description || "");
  const [isActive, setIsActive] = useState(role?.is_active ?? true);
  const [grants, setGrants] = useState<GrantMap>(role?.tab_access || {});
  const [actions, setActions] = useState<string[]>(role?.action_access || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const granted = Object.keys(grants).filter((k) => grants[k]).length;

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const body = {
        name: name.trim(), description: description.trim(), is_active: isActive,
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

  return (
    <Modal
      title={role ? `Edit role — ${role.name}` : "New role"}
      onClose={onClose}
      wide
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
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-secondary">Role name</span>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GM" maxLength={40} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-secondary">Description</span>
            <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. General Manager — invoices and purchase orders" maxLength={512} />
          </label>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-secondary">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active — an inactive role grants nothing until switched back on
        </label>
        <div>
          <div className="mb-1 text-xs font-semibold text-secondary">Tab permissions</div>
          <TabPermissionMatrix tabs={registry} value={grants} onChange={setGrants} />
          {granted === 0 && <p className="mt-2 text-xs text-warning">Grant at least one tab — a role with nothing granted cannot open anything.</p>}
        </div>
        {approvals.length > 0 && (
          <div>
            <ApprovalGrantsHeading count={actions.length} total={approvals.length} />
            <ApprovalGrants approvals={approvals} value={actions} onChange={setActions} />
          </div>
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
