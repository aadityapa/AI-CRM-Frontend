/** CRM sidebar / command-palette nav entries (shared, no CrmApp side effects). */
import type { ComponentType } from "react";
import {
  Banknote,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarDays,
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
  { path: "opportunities", label: "Opportunities", icon: Target, roles: ["Admin", "Sales", "Sales_Head", "RMG", "TA"] },
  { path: "candidates", label: "Candidates", icon: Users, roles: ["Admin", "TA", "Sales", "Sales_Head"] },
  { path: "template-requests", label: "Template Requests", icon: FileText, roles: ["Admin", "TA", "RMG"] },
  { path: "profiles", label: "Candidate Profiles", icon: UsersRound, roles: ["Admin", "Sales", "Sales_Head", "RMG", "TA"] },
  // Interview calendar. Deliberately NOT Sales/Sales_Head: booking and running
  // interviews is not their workflow, which is also why the upcoming-interviews
  // widget was removed from their dashboard.
  { path: "calendar", label: "Interview Calendar", icon: CalendarClock, roles: ["Admin", "CEO", "TA", "RMG"] },
  { path: "projects", label: "Projects", icon: Briefcase, roles: ["Admin", "Sales", "Sales_Head"] },
  { path: "project-employees", label: "Project Employees", icon: Network, roles: ["Admin", "Sales", "Sales_Head", "HR", "Finance"] },
  { path: "my-leave", label: "My Leave", icon: CalendarDays, roles: ["Admin", "Sales", "Sales_Head", "RMG", "TA", "HR", "Finance"] },
  { path: "leave-applications", label: "Leave Applications", icon: CalendarDays, roles: ["Admin", "HR"] },
  { path: "holidays", label: "Holidays", icon: CalendarOff, roles: ["Admin", "HR"] },
  { path: "timesheets", label: "Timesheets", icon: Clock, roles: ["Admin", "HR", "Finance", "RMG", "Sales", "Sales_Head"] },
  { path: "pos", label: "Purchase Orders", icon: Receipt, roles: ["Admin", "Finance"] },
  { path: "invoices", label: "Invoices", icon: FileText, roles: ["Admin", "Finance"] },
  { path: "finance-reports", label: "Financial Reports", icon: Banknote, roles: ["Admin", "Finance", "Sales_Head"] },
  { path: "employees", label: "Employees", icon: UserCog, roles: ["Admin", "HR"] },
  { path: "reports", label: "Reports", icon: FileSpreadsheet, roles: ["Admin", "Sales", "Sales_Head", "RMG", "TA", "HR", "Finance"] },
  { path: "users", label: "Users", icon: UserCog, roles: ["Admin", "CEO"] },
  { path: "access-templates", label: "Access Templates", icon: UserCog, roles: ["Admin", "CEO"] },
  { path: "settings", label: "Settings", icon: SettingsIcon, roles: ["Admin", "CEO"] },
];
