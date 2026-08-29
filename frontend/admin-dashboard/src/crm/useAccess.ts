/** Access-template helpers — read effective_access from /api/me (server source of truth).
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
  source?: string;
};

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

/** Sub-tab visibility (25 Aug 2026): hidden ONLY when the template explicitly
 * says "hidden". A template that never mentions the tab (or the sub-tab) must
 * not erase anything — page reachability is decided by roles, and the first
 * cut of this check (canViewField) blanked every detail tab for templated
 * users whose template predated the sub-tab entries (seen live). */
export function subTabVisible(
  access: EffectiveAccess | undefined,
  roles: string[],
  tab: string,
  field: string,
): boolean {
  if (isSuperAdmin(roles) || access?.full || access?.visible_tabs == null) return true;
  const bare = bareTabKey(tab);
  const fmode = access?.fields?.[bare]?.[field] ?? access?.fields?.[`crm:${bare}`]?.[field];
  return fmode !== "hidden";
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
      subTabVisible: (field: string) => subTabVisible(me.access, me.roles, tab, field),
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
