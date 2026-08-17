/** CRM sidebar / command-palette nav entries (shared, no CrmApp side effects). */
import type { ComponentType } from "react";
import {
  Briefcase,
  Building2,
  CalendarClock,
  CalendarOff,
  Clock,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  Network,
  Receipt,
  Settings as SettingsIcon,
  Target,
  UserCog,
  Users,
  UsersRound,
} from "lucide-react";

export type CrmNavItem = {
  path: string;
  label: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  roles: string[];
};

/** Sidebar entries — exported for light nav-merge tests and ⌘K palette. */
export const CRM_NAV: CrmNavItem[] = [
  { path: "", label: "Dashboard", icon: LayoutDashboard, roles: ["Admin", "Sales", "Sales_Head", "RMG", "TA", "HR", "Finance"] },
  { path: "customers", label: "Customers", icon: Building2, roles: ["Admin", "Sales", "Sales_Head", "TA"] },
  // Rate Card lives INSIDE each customer branch (Customers → Branches tab)
  // since Aug 2026 — no standalone sidebar page.
  { path: "opportunities", label: "Opportunities", icon: Target, roles: ["Admin", "Sales", "Sales_Head", "RMG", "TA"] },
  { path: "candidates", label: "Candidates", icon: Users, roles: ["Admin", "TA", "Sales", "Sales_Head"] },
  { path: "template-requests", label: "Template Requests", icon: FileText, roles: ["Admin", "TA", "RMG"] },
  { path: "profiles", label: "Candidate Profiles", icon: UsersRound, roles: ["Admin", "Sales", "Sales_Head", "RMG", "TA"] },
  // Interview calendar. Deliberately NOT Sales/Sales_Head: booking and running
  // interviews is not their workflow, which is also why the upcoming-interviews
  // widget was removed from their dashboard.
  { path: "calendar", label: "Interview Calendar", icon: CalendarClock, roles: ["Admin", "CEO", "TA", "RMG"] },
  // Projects is the PROJECT HUB (Aug 2026): its tabs carry Project Employees,
  // Timesheets, Purchase Orders and Invoices — the old Timesheets sidebar
  // entry was replaced by this. Roles = union of everything the hub serves.
  { path: "projects", label: "Projects", icon: Briefcase,
    roles: ["Admin", "Sales", "Sales_Head", "HR", "Finance", "RMG", "TA"] },
  { path: "project-employees", label: "Project Employees", icon: Network, roles: ["Admin", "Sales", "Sales_Head", "HR", "Finance"] },
  // My Leave and Leave Applications live INSIDE Timesheets (the attendance
  // hub) since Aug 2026 — no standalone sidebar pages; routes stay for deep
  // links. TA is on Timesheets' roles ONLY for the My Leave tab: inside the
  // page, non-timesheet roles see just that tab.
  { path: "holidays", label: "Holidays", icon: CalendarOff, roles: ["Admin", "HR"] },
  { path: "pos", label: "Purchase Orders", icon: Receipt, roles: ["Admin", "Finance"] },
  { path: "invoices", label: "Invoices", icon: FileText, roles: ["Admin", "Finance"] },
  // Financial Reports lives INSIDE Reports (Reports → Financial Reports tab)
  // and Payroll INSIDE Timesheets (Timesheets → Payroll tab) since Aug 2026 —
  // no standalone sidebar pages. Their routes stay for deep links.
  { path: "employees", label: "Employees", icon: UserCog, roles: ["Admin", "HR"] },
  { path: "reports", label: "Reports", icon: FileSpreadsheet, roles: ["Admin", "Sales", "Sales_Head", "RMG", "TA", "HR", "Finance"] },
  { path: "users", label: "Users", icon: UserCog, roles: ["Admin", "CEO"] },
  { path: "access-templates", label: "Access Templates", icon: UserCog, roles: ["Admin", "CEO"] },
  { path: "settings", label: "Settings", icon: SettingsIcon, roles: ["Admin", "CEO"] },
];
