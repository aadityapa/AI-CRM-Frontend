/**
 * UserManageModal (7 Oct 2026) — everything about one login in one place.
 *
 * Replaces the wall of seven buttons on every Users row (Edit Roles · Edit Tab
 * Access · Reset Password · Deactivate · Portal access · Delete …). The row keeps
 * one "Manage" button; this dialog groups the actions by what they change:
 *   Overview — who (identity, last sign-in, pending password change), access
 *              (roles, where the tabs come from, exceptions), security, account;
 *   History  — the access audit log for this person.
 * Destructive actions sit in their own "Account" card, never next to a routine one.
 * The page owns the dialogs each action opens (they already exist there).
 */
import { useState } from "react";
import {
  Clock, History, KeyRound, LayoutGrid, Mail, ShieldCheck, SlidersHorizontal, Trash2, UserCheck, UserCog, UserX,
  type LucideIcon,
} from "lucide-react";

import { fmtDateTime12 } from "../../../lib/datetime";
import { DialogHero } from "../dialogKit";
import { Modal } from "../ui";
import { AccessAuditLog } from "./AccessAuditLog";

export type ManagedUser = {
  id: number;
  full_name: string;
  username: string;
  email: string;
  is_active: boolean;
  roles: string[];
  custom_roles?: string[];
  tab_access?: string[] | null;
  access_template_id?: number | null;
  last_login?: string | null;
  must_change_password?: boolean;
  has_employee?: boolean;
};

export type ManageActions = {
  editRoles: () => void;
  tabExceptions: () => void;
  resetPassword: () => void;
  togglePortal: () => void;
  toggleEmail: () => void;
  deactivate: () => void;
  activate: () => void;
  remove: () => void;
};

function Card({ icon: Icon, title, hint, children, danger }: {
  icon: LucideIcon; title: string; hint?: string; children: React.ReactNode; danger?: boolean;
}) {
  return (
    <section className={`rounded-xl border p-4 ${danger ? "border-rose-200 bg-rose-50/40 dark:border-rose-900 dark:bg-rose-950/20" : "border-subtle bg-surface-1"}`}>
      <header className="mb-3 flex items-start gap-2.5">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${danger ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"}`}>
          <Icon size={16} aria-hidden />
        </span>
        <span>
          <span className="block text-sm font-bold text-primary">{title}</span>
          {hint && <span className="block text-xs text-muted">{hint}</span>}
        </span>
      </header>
      {children}
    </section>
  );
}

function Action({ icon: Icon, label, hint, onClick, disabled, title, tone = "neutral" }: {
  icon: LucideIcon; label: string; hint?: string; onClick: () => void; disabled?: boolean; title?: string;
  tone?: "neutral" | "danger" | "success";
}) {
  const toneCls = tone === "danger"
    ? "text-rose-700 hover:border-rose-300 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
    : tone === "success"
      ? "text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
      : "text-primary hover:border-strong hover:bg-surface-2";
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={`flex w-full items-start gap-2.5 rounded-lg border border-subtle bg-surface-1 px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${toneCls}`}>
      <Icon size={15} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </button>
  );
}

export function UserManageModal({ user, accessLabel, isSelf, emailPaused, actions, onClose, refreshKey = 0 }: {
  user: ManagedUser;
  /** "Custom role · GM" / "Template · Default — TA" / "Role defaults". */
  accessLabel: string;
  isSelf: boolean;
  emailPaused: boolean;
  actions: ManageActions;
  onClose: () => void;
  refreshKey?: number;
}) {
  const [tab, setTab] = useState<"overview" | "history">("overview");
  const name = user.full_name || user.username;
  const allRoles = [...(user.custom_roles || []), ...user.roles.map((r) => r.replace(/_/g, " "))];
  const exceptions = user.tab_access?.length || 0;

  return (
    <Modal title={`Manage ${name}`} xl onClose={onClose}
      hero={<DialogHero tone="slate" icon={UserCog} eyebrow="Access Control · manage user" title={name}
        subtitle={user.email}
        chips={<>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${user.is_active ? "bg-emerald-400/25 ring-emerald-200/40" : "bg-rose-400/30 ring-rose-200/40"}`}>
            {user.is_active ? "Active" : "Deactivated"}
          </span>
          {user.must_change_password && (
            <span className="rounded-full bg-amber-400/30 px-2.5 py-1 text-[11px] font-semibold ring-1 ring-amber-200/40">Must set a new password</span>
          )}
          {isSelf && <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold ring-1 ring-white/20">This is you</span>}
        </>} />}>
      <div role="tablist" aria-label="Manage user" className="mb-4 inline-flex rounded-lg border border-subtle bg-surface-2 p-1">
        {([["overview", "Overview", LayoutGrid], ["history", "History", History]] as const).map(([k, label, Icon]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${tab === k ? "bg-surface-1 text-primary shadow-raised" : "text-muted hover:text-primary"}`}>
            <Icon size={13} aria-hidden /> {label}
          </button>
        ))}
      </div>

      {tab === "history" ? (
        <AccessAuditLog userId={user.id} compact refreshKey={refreshKey} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card icon={UserCog} title="Who" hint="Identity and sign-in">
            <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 text-sm">
              <dt className="text-muted">Username</dt><dd className="font-semibold text-primary">{user.username}</dd>
              <dt className="text-muted">Email</dt><dd className="truncate text-primary">{user.email || "—"}</dd>
              <dt className="text-muted">Last sign-in</dt>
              <dd className="text-primary">{user.last_login ? fmtDateTime12(user.last_login) : <span className="text-muted">Never</span>}</dd>
              <dt className="text-muted">Password</dt>
              <dd>{user.must_change_password
                ? <span className="font-semibold text-amber-700 dark:text-amber-300">Reset — must set a new one at next sign-in</span>
                : <span className="text-primary">Set by the user</span>}</dd>
            </dl>
          </Card>

          <Card icon={ShieldCheck} title="Access" hint="What they can open and approve">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {allRoles.length
                ? allRoles.map((r) => <span key={r} className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">{r}</span>)
                : <span className="rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-semibold text-danger">No role — cannot open the CRM</span>}
            </div>
            <p className="mb-3 text-xs text-secondary">
              Tabs come from <b className="text-primary">{accessLabel}</b>
              {exceptions ? <> · <b className="text-primary">{exceptions}</b> tab exception{exceptions === 1 ? "" : "s"}</> : null}.
            </p>
            <div className="grid gap-2">
              <Action icon={ShieldCheck} label="Edit roles" hint="Built-in and custom roles" onClick={actions.editRoles} />
              <Action icon={SlidersHorizontal} label="Tab exceptions" hint="Extra or fewer tabs for this person only" onClick={actions.tabExceptions} />
            </div>
          </Card>

          <Card icon={KeyRound} title="Security & notifications">
            <div className="grid gap-2">
              <Action icon={KeyRound} label="Reset password" disabled={isSelf}
                title={isSelf ? "Use Change password on My Profile for your own account" : undefined}
                hint="Generate a temporary one — they must change it at next sign-in" onClick={actions.resetPassword} />
              <Action icon={Mail} label={emailPaused ? "Resume application email" : "Pause application email"}
                hint={emailPaused ? "Their notifications are paused" : "Notifications are being sent"} onClick={actions.toggleEmail} />
              {user.has_employee && (
                <Action icon={Clock} label="Employee portal access" hint="Turn their employee self-service on or off" onClick={actions.togglePortal} />
              )}
            </div>
          </Card>

          <Card icon={UserX} title="Account" hint="Ends or restores access — recorded in the audit log" danger>
            <div className="grid gap-2">
              {user.is_active ? (
                <Action icon={UserX} tone="danger" label="Deactivate" disabled={isSelf}
                  title={isSelf ? "You cannot deactivate your own account" : undefined}
                  hint="They cannot sign in; their records keep their name" onClick={actions.deactivate} />
              ) : (
                <Action icon={UserCheck} tone="success" label="Activate" hint="They can sign in again" onClick={actions.activate} />
              )}
              <Action icon={Trash2} tone="danger" label="Delete account" disabled={isSelf}
                title={isSelf ? "You cannot delete your own account" : undefined}
                hint="Only for an account that never did anything" onClick={actions.remove} />
            </div>
          </Card>
        </div>
      )}
    </Modal>
  );
}
