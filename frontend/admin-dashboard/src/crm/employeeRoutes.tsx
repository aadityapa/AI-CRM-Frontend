/**
 * Route switch for an employee-only login (26 Nov 2026): the Opportunities routes
 * render the employee's "Open positions" page (role + JD + Apply) instead of the
 * Sales pipeline / opportunity / position pages. Everyone else gets `Normal`.
 * The employee page is lazy, so other logins never download it.
 */
import type { ComponentType } from "react";
import { lazyRetry } from "../lib/lazyRetry";
import { isEmployeeOnlyLogin, useMeMaybe } from "./CrmApp";
import { useCrmParams } from "./router";

const EmployeeOpportunitiesPage = lazyRetry(() => import("./pages/EmployeeOpportunities")
  .then((m) => ({ default: m.EmployeeOpportunitiesPage })));

export type EmployeeRouteKind = "list" | "opportunity" | "requirement";

/** What an employee's Opportunities route opens. PURE. */
export function employeeFocus(kind: EmployeeRouteKind, rawId: string | undefined):
  { requirementId?: number; opportunityId?: number } | undefined {
  const n = Number(rawId);
  const id = Number.isFinite(n) && n > 0 ? n : undefined;
  if (kind === "opportunity") return { opportunityId: id };
  if (kind === "requirement") return { requirementId: id };
  return undefined;
}

export function employeeAware(Normal: ComponentType, kind: EmployeeRouteKind): ComponentType {
  function EmployeeAwareRoute() {
    const me = useMeMaybe();
    const params = useCrmParams();
    if (!isEmployeeOnlyLogin(me)) return <Normal />;
    return <EmployeeOpportunitiesPage focus={employeeFocus(kind, params.id)} />;
  }
  EmployeeAwareRoute.displayName = `EmployeeAware(${kind})`;
  return EmployeeAwareRoute;
}
