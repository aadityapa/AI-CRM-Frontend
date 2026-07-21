/** Access-template helpers — read effective_access from /api/me (server source of truth). */
import { useMemo } from "react";
import type { Me } from "./CrmApp";
import { useMe } from "./CrmApp";
import { crmTabKey, isSuperAdmin, tabVisible } from "../lib/rbac";

export type AccessMode = "view" | "edit";

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

export function canEditTab(
  access: EffectiveAccess | undefined,
  roles: string[],
  tab: string,
): boolean {
  if (isSuperAdmin(roles) || access?.full || access?.visible_tabs == null) return true;
  return tabMode(access, tab) === "edit";
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
  if (fmode) return true;
  return tabMode(access, tab) != null;
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
  if (fmode) return fmode === "edit";
  return tabMode(access, tab) === "edit";
}

export function useCrmAccess(tabPath: string) {
  const me = useMe();
  const tab = tabPath || "dashboard";
  return useMemo(
    () => ({
      canEditTab: canEditTab(me.access, me.roles, tab),
      isReadOnly:
        !!me.access?.visible_tabs &&
        !me.access?.full &&
        !isSuperAdmin(me.roles) &&
        tabMode(me.access, tab) === "view",
      canEditField: (field: string) => canEditField(me.access, me.roles, tab, field),
      canViewField: (field: string) => canViewField(me.access, me.roles, tab, field),
    }),
    [me, tab],
  );
}

export function useCanEditTab(tabPath: string): boolean {
  const me = useMe();
  return canEditTab(me.access, me.roles, tabPath);
}
