/**
 * Employee-only login (26 Nov 2026) — mirror of the server's
 * `services/employee_scope.names_are_employee_only`: the roles the login HOLDS
 * include "Employee" and are all Employee / Interviewer, and it is not Admin / CEO.
 *
 * Kept outside CrmApp so the platform shell (App.tsx) can ask it without pulling
 * the CRM bundle. PURE.
 */
export const EMPLOYEE_ONLY_ROLES = ["employee", "interviewer"];

export function isEmployeeOnlyRoles(roles: readonly unknown[] | null | undefined,
                                    displayRoles?: readonly unknown[] | null): boolean {
  const list = displayRoles && displayRoles.length ? displayRoles : roles || [];
  const held = list.map((r) => String(r).trim().toLowerCase()).filter(Boolean);
  if (held.some((r) => r === "admin" || r === "ceo")) return false;
  return held.includes("employee") && held.every((r) => EMPLOYEE_ONLY_ROLES.includes(r));
}
