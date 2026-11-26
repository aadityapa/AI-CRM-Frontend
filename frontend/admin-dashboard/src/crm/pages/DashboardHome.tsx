/**
 * The CRM home (`""`).
 *  - An employee-only login (Employee, + Interviewer — 25 Nov 2026) gets its OWN
 *    dashboard: about the person (project, daily log, tasks, resume, open
 *    positions that fit, AI interviews; the interviews they take as a panel
 *    member) — never the company's hiring numbers.
 *  - A login whose only page is My Workspace (23 Nov 2026) keeps that as its home.
 *  - Everyone else gets the role dashboard.
 */
import { isEmployeeOnlyLogin, isWorkspaceOnlyLogin, useMe } from "../CrmApp";
import { CrmDashboardPage } from "./CrmDashboard";
import { EmployeeDashboard } from "./dashboard/EmployeeDashboard";
import { MyWorkspacePage } from "./MyWorkspace";

export function DashboardHome() {
  const me = useMe();
  if (isEmployeeOnlyLogin(me)) return <EmployeeDashboard roles={me.display_roles?.length ? me.display_roles : me.roles} />;
  return isWorkspaceOnlyLogin(me) ? <MyWorkspacePage /> : <CrmDashboardPage />;
}
