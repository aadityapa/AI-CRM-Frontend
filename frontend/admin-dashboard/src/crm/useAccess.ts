/** Access helpers — read effective_access from /api/me (server source of truth).
 * Since 27 Oct 2026 the permissions come from the user's ROLES (built-in and
 * custom, each with its own permissions — Access Templates were merged into
 * Roles); "templated" below means "restricted by a role's permissions".
 *
 * Modes are a LADDER, mirroring `backend/services/access_registry.py`:
 * view < edit < create. A "create" grant satisfies an "edit" check, and so on.
 *
 * Precedence, mirroring `crm_deps._gate`:
 *   1. Superadmin / access.full → everything.
 *   2. User HAS a template (visible_tabs != null) → the template ALONE decides,
 *      the role list is not consulted. Admin/CEO chose these grants on purpose.
 *   3. No template → role defaults (pass `rolePermitted` from useHasRole).
 */
import { useMemo } from "react";
import type { Me } from "./CrmApp";
import { useMe } from "./CrmApp";
import { crmTabKey, isSuperAdmin, tabVisible } from "../lib/rbac";

/** "hidden" (25 Aug 2026) is FIELD-only: it removes a field or a `tab:*`
 *  sub-tab from a templated user's view. Tab grants stay view/edit/create. */
export type AccessMode = "hidden" | "view" | "edit" | "create";

const MODE_RANK: Record<string, number> = { view: 1, edit: 2, create: 3 };

export function modeSatisfies(granted: string | null | undefined, required: AccessMode): boolean {
  if (!granted) return false;
  return (MODE_RANK[granted] ?? 0) >= (MODE_RANK[required] ?? 99);
}

export type EffectiveAccess = {
  full?: boolean;
  template_id?: number | null;
  tabs?: Record<string, AccessMode>;
  fields?: Record<string, Record<string, AccessMode>>;
  visible_tabs?: string[] | null;
  /** Approval actions the template / custom role grants; null = role lists decide. */
  actions?: string[] | null;
  source?: string;
};

/** Approval action keys — mirror of `services/action_permissions.APPROVAL_ACTIONS`. */
export type ApprovalAction =
  | "timesheet.approve" | "timesheet.reject" | "timesheet.generate_invoice"
  | "invoice.convert_proforma" | "invoice.revision.approve" | "credit_note.approve"
  | "opportunity.approve" | "requirement.sales_head_approve" | "requirement.engineering_approve"
  | "requirement.positions.approve" | "profile.rmg_screening" | "profile.sales_head_decision"
  | "profile.budget_resolve" | "profile.fast_track_internal" | "leave.approve" | "leave.reject"
  | "requirement.hm_approve" | "profile.hm_review" | "profile.hm_signoff"
  // 23 Oct 2026: RMG / GM decisions, Admin-editable (were buttons any
  // Requirements: Edit grant implied — a TA saw them).
  | "requirement.positions.request" | "requirement.team.assign";

/** May this user press an APPROVAL button? (25 Sep 2026)
 *
 * A tab grant never answers this — Timesheets: Edit is what Sales needs to
 * FILL a sheet, and it used to show them Approve too. The server computes
 * `me.approvals` with the very function its gate uses (template / custom-role
 * Approvals list, else the action's role list), so the button appears exactly
 * when the click would be accepted. Admin/CEO always may.
 */
export function canApprove(me: Me, action: ApprovalAction): boolean {
  if (isSuperAdmin(me.roles) || me.access?.full) return true;
  return (me.approvals ?? []).includes(action);
}

export function useCanApprove(action: ApprovalAction): boolean {
  const me = useMe();
  return canApprove(me, action);
}

/** The candidate stages this login sees (13 Oct 2026) — set per role on
 *  Access Control ▸ Roles; null = every stage. Feed it to
 *  `visibleStageBuckets` for the stage chips. */
export function useCandidateStages(): string[] | null {
  const me = useMe();
  if (isSuperAdmin(me.roles) || me.access?.full) return null;
  return me.candidate_stages ?? null;
}

function bareTabKey(pathOrKey: string): string {
  if (pathOrKey.startsWith("crm:")) return pathOrKey.slice(4) || "dashboard";
  return pathOrKey || "dashboard";
}

function tabMode(access: EffectiveAccess | undefined, tabKey: string): AccessMode | null {
  if (!access || access.full || access.visible_tabs == null) return null;
  const bare = bareTabKey(tabKey);
  return access.tabs?.[bare] ?? access.tabs?.[`crm:${bare}`] ?? null;
}

/** Is this user restricted by a template/override (as opposed to role defaults)? */
function isTemplated(access: EffectiveAccess | undefined, roles: string[]): boolean {
  return !!access && !access.full && access.visible_tabs != null && !isSuperAdmin(roles);
}

/** Should a CRM nav item show for this user? */
export function crmTabVisibleFromMe(
  me: Me,
  path: string,
  rolePermitted: boolean,
  mandatory = false,
): boolean {
  if (mandatory) return true;
  if (isSuperAdmin(me.roles) || me.access?.full) return rolePermitted;
  // Prefer mode map from /api/me.access (bare or crm: keys).
  if (me.access?.visible_tabs != null) {
    const bare = path || "dashboard";
    const tabs = me.access.tabs || {};
    if (bare in tabs || `crm:${bare}` in tabs) return true;
    // Also accept legacy allow-list on me.tab_access (crm: keys).
    if (Array.isArray(me.tab_access) && me.tab_access.includes(crmTabKey(bare))) return true;
    return false;
  }
  return tabVisible(me.tab_access, crmTabKey(path), rolePermitted, mandatory);
}

/** THE act check — mirrors the server's `_gate`.
 *
 * `rolePermitted` is what the user's roles alone would allow for this action
 * (e.g. `useHasRole("Sales_Head", "Finance")` for project writes). It is only
 * consulted for users WITHOUT a template.
 */
export function canAct(
  access: EffectiveAccess | undefined,
  roles: string[],
  tab: string,
  mode: AccessMode,
  rolePermitted: boolean,
): boolean {
  if (isSuperAdmin(roles) || access?.full) return true;
  if (isTemplated(access, roles)) return modeSatisfies(tabMode(access, tab), mode);
  return rolePermitted;
}

export function canEditTab(
  access: EffectiveAccess | undefined,
  roles: string[],
  tab: string,
): boolean {
  if (isSuperAdmin(roles) || access?.full || access?.visible_tabs == null) return true;
  return modeSatisfies(tabMode(access, tab), "edit");
}

export function canViewField(
  access: EffectiveAccess | undefined,
  roles: string[],
  tab: string,
  field: string,
): boolean {
  if (isSuperAdmin(roles) || access?.full || access?.visible_tabs == null) return true;
  const bare = bareTabKey(tab);
  const fmode = access?.fields?.[bare]?.[field] ?? access?.fields?.[`crm:${bare}`]?.[field];
  // "hidden" (25 Aug 2026): a template can remove a sub-tab/field from view
  // entirely — the only field mode that answers false here.
  if (fmode) return fmode !== "hidden";
  return tabMode(access, tab) != null;
}

/** What a template / custom role says about ONE sub-tab (22 Oct 2026) —
 * the mirror of B-V2 `access_registry.subtab_choice`:
 *   * "show"    — Admin/CEO, or the template lists this sub-tab as View
 *                 (once any sub-tab of a tab is set to View, the template
 *                 decides that tab's sub-tabs ALONE);
 *   * "hide"    — explicitly Hidden, or left out of a configured list;
 *   * "default" — the template says nothing: the page's own role rule decides.
 * Untemplated logins always get "default". `sub` may be "tab:x" or "x". */
export type SubTabChoice = "show" | "hide" | "default";

export function subTabChoice(
  access: EffectiveAccess | undefined,
  roles: string[],
  tab: string,
  sub: string,
): SubTabChoice {
  if (isSuperAdmin(roles) || access?.full) return "show";
  if (!access || access.visible_tabs == null) return "default";
  const bare = bareTabKey(tab);
  const map = access.fields?.[bare] ?? access.fields?.[`crm:${bare}`] ?? {};
  const key = sub.startsWith("tab:") ? sub : `tab:${sub}`;
  const shown = (m: unknown) => m === "view" || m === "edit";
  const entries = Object.entries(map).filter(([k]) => k.startsWith("tab:"));
  if (entries.some(([, m]) => shown(m))) return shown(map[key]) ? "show" : "hide";
  return map[key] === "hidden" ? "hide" : "default";
}

/** Is this sub-tab visible? `roleDefault` is what the page would show without
 * a template rule (the role / other-tab condition it always used). */
export function subTabVisible(
  access: EffectiveAccess | undefined,
  roles: string[],
  tab: string,
  field: string,
  roleDefault = true,
): boolean {
  const c = subTabChoice(access, roles, tab, field);
  return c === "show" || (c === "default" && roleDefault);
}

/** Hook form: `const sub = useSubTabs("reports"); sub.allowed("revenue", roleOk)`.
 *  `allowed(key)` with no role default = visible unless the template hides it. */
export function useSubTabs(tabPath: string) {
  const me = useMe();
  return useMemo(() => ({
    choice: (key: string) => subTabChoice(me.access, me.roles, tabPath, key),
    allowed: (key: string, roleDefault = true) =>
      subTabVisible(me.access, me.roles, tabPath, key, roleDefault),
  }), [me, tabPath]);
}

export function canEditField(
  access: EffectiveAccess | undefined,
  roles: string[],
  tab: string,
  field: string,
): boolean {
  if (isSuperAdmin(roles) || access?.full || access?.visible_tabs == null) return true;
  const bare = bareTabKey(tab);
  const fmode = access?.fields?.[bare]?.[field] ?? access?.fields?.[`crm:${bare}`]?.[field];
  if (fmode) return fmode !== "hidden" && modeSatisfies(fmode, "edit");
  return modeSatisfies(tabMode(access, tab), "edit");
}

export function useCrmAccess(tabPath: string) {
  const me = useMe();
  const tab = tabPath || "dashboard";
  return useMemo(
    () => ({
      canEditTab: canEditTab(me.access, me.roles, tab),
      canCreateTab:
        isSuperAdmin(me.roles) || me.access?.full || me.access?.visible_tabs == null
          ? true
          : modeSatisfies(tabMode(me.access, tab), "create"),
      isReadOnly:
        !!me.access?.visible_tabs &&
        !me.access?.full &&
        !isSuperAdmin(me.roles) &&
        tabMode(me.access, tab) === "view",
      canEditField: (field: string) => canEditField(me.access, me.roles, tab, field),
      canViewField: (field: string) => canViewField(me.access, me.roles, tab, field),
      subTabVisible: (field: string, roleDefault = true) => subTabVisible(me.access, me.roles, tab, field, roleDefault),
    }),
    [me, tab],
  );
}

export function useCanEditTab(tabPath: string): boolean {
  const me = useMe();
  return canEditTab(me.access, me.roles, tabPath);
}

/** Template-aware action check — the hook pages should use for buttons.
 *
 *     const canWrite  = useCanAct("projects", "edit",   useHasRole("Sales_Head", "Finance"));
 *     const canCreate = useCanAct("projects", "create", useHasRole("Sales_Head", "Finance"));
 *
 * For templated users the template alone decides; for everyone else the
 * rolePermitted argument (the pre-template behaviour) decides.
 */
export function useCanAct(tabPath: string, mode: AccessMode, rolePermitted: boolean): boolean {
  const me = useMe();
  return canAct(me.access, me.roles, tabPath || "dashboard", mode, rolePermitted);
}

/** Is this user's access GRANT-driven (a template or a custom role such as GM)
 *  rather than role defaults? Pages whose layout depends on built-in roles use
 *  it to fall back to the grants instead of rendering nothing. */
export function useIsTemplated(): boolean {
  const me = useMe();
  return isTemplated(me.access, me.roles);
}
