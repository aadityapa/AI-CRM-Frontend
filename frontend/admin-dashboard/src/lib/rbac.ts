/**
 * Karnex — single source of truth for role-based access in the unified admin shell.
 *
 * Two products live in one shell: the AI Interview Platform (React pages in
 * src/pages/*) and the Karnex CRM (src/crm/*). CRM roles come from the backend
 * `/api/me` endpoint (roles[] out of the 7-role RBAC table). This module decides,
 * per role, which Interview Platform views are visible and where each user lands
 * after login. The CRM enforces its own per-module RBAC internally (CrmApp NAV).
 *
 * Access matrix (per product spec):
 *   Admin        — everything; lands on CRM first, can enter the Interview Platform.
 *   TA, HR       — Interview Platform: Dashboard, Reports, ATS, Integrity (+ CRM).
 *   RMG          — Interview Platform: Templates, Dashboard, Reports, ATS
 *                  (NO Integrity) (+ CRM).
 *   Sales,
 *   Sales_Head   — CRM only. No Interview Platform.
 *   Finance      — CRM only (TDS, Invoices, Purchase Orders). No Interview Platform.
 *
 * The backend independently enforces these same rules on every endpoint
 * (crm_deps.enforce_roles) so restricted screens cannot be reached by direct URL.
 */

export type CrmRole = "Admin" | "Sales" | "Sales_Head" | "RMG" | "TA" | "HR" | "Finance";

/** Every top-level + nested view the Interview Platform shell can render. */
export type InterviewView =
  | "dashboard"
  | "templates"
  | "questionBank"
  | "candidates"
  | "ats"
  | "promptLogs"
  | "integrityLogs"
  | "templateForm"
  | "candidateInterviews"
  | "candidateReport"
  | "upcomingInterviews"
  | "hrSetup"
  | "crm";

/**
 * Roles allowed to see each Interview Platform view. Admin is implicitly allowed
 * everywhere (see canAccessInterviewView). Nested/detail views inherit the access
 * of the primary nav item they belong to.
 */
export const INTERVIEW_VIEW_ROLES: Record<InterviewView, CrmRole[]> = {
  dashboard: ["TA", "HR", "RMG"],
  upcomingInterviews: ["TA", "HR", "RMG"], // reached from the Dashboard
  templates: ["RMG"],
  templateForm: ["RMG"], // create/edit template — same authority as Templates
  candidates: ["TA", "HR", "RMG"], // "Reports"
  candidateReport: ["TA", "HR", "RMG"], // detail page under Reports
  candidateInterviews: ["TA", "HR", "RMG"], // detail page under Reports/Dashboard
  ats: ["TA", "HR", "RMG"],
  integrityLogs: ["TA", "HR"], // RMG explicitly excluded
  hrSetup: ["TA", "HR"], // Interview scheduler (reached via the Interview Schedule button)
  promptLogs: [], // AI Logs — Admin only
  questionBank: [], // Admin/super-admin only
  crm: ["Sales", "Sales_Head", "RMG", "TA", "HR", "Finance"], // any CRM role
};

/** Nav items that make up the Interview Platform primary navigation, in order. */
export const INTERVIEW_NAV_VIEWS: InterviewView[] = [
  "dashboard",
  "templates",
  "candidates",
  "ats",
  "promptLogs",
  "integrityLogs",
];

/** Admin and CEO are both super-admins (CEO is the top tier). */
export const SUPERADMIN_ROLES = ["Admin", "CEO"] as const;

export function isAdmin(roles: string[]): boolean {
  return roles.includes("Admin") || roles.includes("CEO");
}

/** Only CEO/Admin may edit another user's tab access. */
export function isSuperAdmin(roles: string[]): boolean {
  return isAdmin(roles);
}

/* ------------------------------------------------------------------ tabs
 * Per-user "tab access" lets an Admin/CEO choose exactly which tabs a user sees.
 * Tab keys are namespaced: "iv:<view>" (Interview Platform) and "crm:<path>" (CRM).
 *
 * NULL/undefined tab_access → role-based defaults.
 * Non-null tab_access → explicit allow-list chosen by Admin (may include tabs
 * beyond the user's roles for navigation; API endpoints still enforce RBAC).
 */
export type TabGroup = "Interview Platform" | "CRM";

export interface ManageableTab {
  key: string;
  label: string;
  group: TabGroup;
  roles: CrmRole[]; // roles that may see it (empty = super-admin only)
  mandatory?: boolean; // cannot be hidden (prevents locking a user out)
}

export function crmTabKey(path: string): string {
  return `crm:${path || "dashboard"}`;
}
export function ivTabKey(view: InterviewView): string {
  return `iv:${view}`;
}

/** Every tab an Admin/CEO can toggle for a user, in display order. */
export const MANAGEABLE_TABS: ManageableTab[] = [
  // Interview Platform (top nav)
  { key: "iv:dashboard", label: "Dashboard", group: "Interview Platform", roles: ["TA", "HR", "RMG"] },
  { key: "iv:templates", label: "Templates", group: "Interview Platform", roles: ["RMG"] },
  { key: "iv:candidates", label: "Reports", group: "Interview Platform", roles: ["TA", "HR", "RMG"] },
  { key: "iv:ats", label: "ATS", group: "Interview Platform", roles: ["TA", "HR", "RMG"] },
  { key: "iv:promptLogs", label: "AI Logs", group: "Interview Platform", roles: [] },
  { key: "iv:integrityLogs", label: "Integrity", group: "Interview Platform", roles: ["TA", "HR"] },
  // CRM (sidebar) — mirrors CrmApp NAV
  { key: "crm:dashboard", label: "Dashboard", group: "CRM", roles: ["Sales", "Sales_Head", "RMG", "TA", "HR", "Finance"], mandatory: true },
  { key: "crm:customers", label: "Customers", group: "CRM", roles: ["Sales", "Sales_Head", "TA"] },
  { key: "crm:opportunities", label: "Opportunities", group: "CRM", roles: ["Sales", "Sales_Head"] },
  { key: "crm:requirements", label: "Requirements", group: "CRM", roles: ["Sales", "Sales_Head", "RMG", "TA"] },
  { key: "crm:candidates", label: "Candidates", group: "CRM", roles: ["TA", "Sales", "Sales_Head"] },
  { key: "crm:template-requests", label: "Template Requests", group: "CRM", roles: ["TA", "RMG"] },
  { key: "crm:profiles", label: "Candidate Profiles", group: "CRM", roles: ["Sales", "Sales_Head", "RMG", "TA"] },
  { key: "crm:projects", label: "Projects", group: "CRM", roles: ["Sales", "Sales_Head"] },
  { key: "crm:project-employees", label: "Project Employees", group: "CRM", roles: ["Sales", "Sales_Head", "HR", "Finance"] },
  { key: "crm:leave-applications", label: "Leave Applications", group: "CRM", roles: ["HR"] },
  { key: "crm:holidays", label: "Holidays", group: "CRM", roles: ["HR"] },
  { key: "crm:timesheets", label: "Timesheets", group: "CRM", roles: ["HR"] },
  { key: "crm:pos", label: "Purchase Orders", group: "CRM", roles: ["Finance"] },
  { key: "crm:invoices", label: "Invoices", group: "CRM", roles: ["Finance"] },
  { key: "crm:tds", label: "TDS", group: "CRM", roles: ["Finance"] },
  { key: "crm:employees", label: "Employees", group: "CRM", roles: ["HR"] },
  { key: "crm:reports", label: "Reports", group: "CRM", roles: ["Sales", "Sales_Head", "RMG", "TA", "HR", "Finance"] },
  { key: "crm:users", label: "Users", group: "CRM", roles: [] },
  { key: "crm:settings", label: "Settings", group: "CRM", roles: [] },
];

/** Is a tab permitted for a user's ROLES (before any per-user override)? */
export function tabPermittedByRole(tab: ManageableTab, roles: string[]): boolean {
  if (isSuperAdmin(roles)) return true;
  return tab.roles.some((r) => roles.includes(r));
}

/** Tabs a user's roles permit by default (used to pre-check the editor). */
export function manageableTabsForRoles(roles: string[]): ManageableTab[] {
  return MANAGEABLE_TABS.filter((t) => tabPermittedByRole(t, roles));
}

/** Every tab key an Admin/CEO can assign in the tab-access editor. */
export function allManageableTabKeys(): string[] {
  return MANAGEABLE_TABS.map((t) => t.key);
}

/* ---------------------------------------------------------------- field access
 * Optional per-tab field-level access. For tabs listed here, an Admin/CEO can
 * further restrict WHICH fields a user may see/edit. A tab absent from a user's
 * field_access map = all its fields are allowed. Pages read `me.field_access` and
 * hide fields not listed. Add a tab here (with its fields) to make it manageable.
 */
export interface TabField {
  key: string;
  label: string;
}

export const TAB_FIELDS: Record<string, TabField[]> = {
  "crm:opportunities": [
    { key: "title", label: "Opportunity Title" },
    { key: "customer_id", label: "Customer" },
    { key: "opp_type", label: "Opportunity Type" },
    { key: "rfi_value", label: "RFI Value" },
    { key: "rfi_received_date", label: "Received Date" },
    { key: "skills", label: "Skill Evaluation" },
    { key: "ctc_slab", label: "Candidate CTC Slab" },
    { key: "details", label: "Type-specific details" },
    { key: "attachments", label: "Attachments" },
  ],
  "crm:customers": [
    { key: "name", label: "Name" },
    { key: "customer_type", label: "Customer Type" },
    { key: "legal_entity_name", label: "Legal Entity" },
    { key: "address", label: "Address" },
    { key: "branches", label: "Branches" },
    { key: "contacts", label: "Contacts" },
  ],
  "crm:candidates": [
    { key: "name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "experience_years", label: "Experience" },
    { key: "current_ctc", label: "Current CTC" },
    { key: "expected_ctc", label: "Expected CTC" },
    { key: "cv", label: "Resume" },
  ],
};

export function tabHasFields(tabKey: string): boolean {
  return !!TAB_FIELDS[tabKey]?.length;
}

/** Is a field allowed given a user's field_access map? Absent tab = all allowed. */
export function fieldAllowed(
  fieldAccess: Record<string, string[]> | null | undefined,
  tabKey: string,
  fieldKey: string,
): boolean {
  const list = fieldAccess?.[tabKey];
  if (!list) return true; // no restriction on this tab
  return list.includes(fieldKey);
}

/**
 * Should a tab appear in the shell? Mandatory tabs always show. With no override,
 * role rules apply; with an override, only listed keys show (Admin's choice).
 */
export function tabVisible(
  tabAccess: string[] | null | undefined,
  key: string,
  rolePermitted: boolean,
  mandatory = false,
): boolean {
  if (mandatory) return true;
  if (tabAccess == null) return rolePermitted;
  return tabAccess.includes(key);
}

/** @deprecated Use tabVisible with rolePermitted — kept for gradual migration. */
export function tabAllowedByOverride(tabAccess: string[] | null | undefined, key: string, mandatory = false): boolean {
  return tabVisible(tabAccess, key, true, mandatory);
}

/** Does this set of roles grant access to a specific Interview Platform view? */
export function canAccessInterviewView(roles: string[], view: InterviewView): boolean {
  if (isAdmin(roles)) return true;
  const allowed = INTERVIEW_VIEW_ROLES[view] || [];
  return allowed.some((r) => roles.includes(r));
}

/**
 * Does the user have access to ANY Interview Platform screen (i.e. should the
 * platform nav be shown at all)? "crm" is excluded — CRM access alone does not
 * grant the Interview Platform.
 */
export function hasInterviewAccess(roles: string[]): boolean {
  if (isAdmin(roles)) return true;
  return INTERVIEW_NAV_VIEWS.some((v) => canAccessInterviewView(roles, v));
}

/** Does the user have access to the CRM section? */
export function hasCrmAccess(roles: string[]): boolean {
  return roles.length > 0; // any assigned CRM role can open the CRM (it self-restricts)
}

/**
 * Where a user lands immediately after login. Every CRM-role user (Admin, TA, HR,
 * RMG, Sales, Sales_Head, Finance) lands on the CRM. The Interview Platform (and
 * the HR Setup scheduler) are reached from the nav / the Interview Schedule button.
 */
export function defaultLanding(_roles: string[]): InterviewView {
  return "crm";
}

/** Filtered, ordered list of Interview Platform nav views for these roles. */
export function allowedInterviewNav(roles: string[]): InterviewView[] {
  return INTERVIEW_NAV_VIEWS.filter((v) => canAccessInterviewView(roles, v));
}
