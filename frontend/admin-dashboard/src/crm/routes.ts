/** CRM route table — pattern → lazily-loaded page component. */

import { lazyRetry } from "../lib/lazyRetry";
import type { CrmRoute } from "./router";

const CrmDashboardPage = lazyRetry(() => import("./pages/CrmDashboard").then((m) => ({ default: m.CrmDashboardPage })));
const CustomersListPage = lazyRetry(() => import("./pages/Customers").then((m) => ({ default: m.CustomersListPage })));
const CustomerDetailPage = lazyRetry(() => import("./pages/Customers").then((m) => ({ default: m.CustomerDetailPage })));
const OpportunitiesWorkspace = lazyRetry(() => import("./pages/OpportunitiesWorkspace").then((m) => ({ default: m.OpportunitiesWorkspace })));
const RequirementsListRedirect = lazyRetry(() => import("./pages/OpportunitiesWorkspace").then((m) => ({ default: m.RequirementsListRedirect })));
const OpportunityDetailPage = lazyRetry(() => import("./pages/Opportunities").then((m) => ({ default: m.OpportunityDetailPage })));
const RequirementDetailPage = lazyRetry(() => import("./pages/Requirements").then((m) => ({ default: m.RequirementDetailPage })));
const CandidatesListPage = lazyRetry(() => import("./pages/CrmCandidates").then((m) => ({ default: m.CandidatesListPage })));
const CandidateDetailPage = lazyRetry(() => import("./pages/CrmCandidates").then((m) => ({ default: m.CandidateDetailPage })));
const ProfilesListPage = lazyRetry(() => import("./pages/Profiles").then((m) => ({ default: m.ProfilesListPage })));
const ProfileDetailPage = lazyRetry(() => import("./pages/Profiles").then((m) => ({ default: m.ProfileDetailPage })));
const ActivityLogPage = lazyRetry(() => import("./pages/ActivityLog").then((m) => ({ default: m.ActivityLogPage })));
const EmailCenterPage = lazyRetry(() => import("./pages/EmailCenter").then((m) => ({ default: m.EmailCenterPage })));
const FileViewPage = lazyRetry(() => import("./pages/FileView").then((m) => ({ default: m.FileViewPage })));
const CalendarPage = lazyRetry(() => import("./pages/Calendar"));
const ProjectsListPage = lazyRetry(() => import("./pages/Projects").then((m) => ({ default: m.ProjectsListPage })));
const ProjectDetailPage = lazyRetry(() => import("./pages/Projects").then((m) => ({ default: m.ProjectDetailPage })));
const ProjectEmployeesPage = lazyRetry(() => import("./pages/ProjectEmployees").then((m) => ({ default: m.ProjectEmployeesPage })));
const ProjectEmployeeDetailPage = lazyRetry(() => import("./pages/ProjectEmployeeDetail").then((m) => ({ default: m.ProjectEmployeeDetailPage })));
const MyLeavePage = lazyRetry(() => import("./pages/MyLeave").then((m) => ({ default: m.MyLeavePage })));
const BranchPolicyPage = lazyRetry(() => import("./pages/BranchPolicy").then((m) => ({ default: m.BranchPolicyPage })));
const LeaveApplicationsPage = lazyRetry(() => import("./pages/LeaveApplications").then((m) => ({ default: m.LeaveApplicationsPage })));
const HolidaysPage = lazyRetry(() => import("./pages/Holidays").then((m) => ({ default: m.HolidaysPage })));
const TimesheetsListPage = lazyRetry(() => import("./pages/Timesheets").then((m) => ({ default: m.TimesheetsListPage })));
const TimesheetDetailPage = lazyRetry(() => import("./pages/Timesheets").then((m) => ({ default: m.TimesheetDetailPage })));
const TalentPoolPage = lazyRetry(() => import("./pages/TalentPool").then((m) => ({ default: m.TalentPoolPage })));
const EInvoicesPage = lazyRetry(() => import("./components/invoice/EInvoiceRegister").then((m) => ({ default: m.EInvoicesPage })));
const ReceivedAmountsPage = lazyRetry(() => import("./pages/CustomerReceipts").then((m) => ({ default: m.ReceivedAmountsPage })));
const PurchaseOrdersPage = lazyRetry(() => import("./pages/Finance").then((m) => ({ default: m.PurchaseOrdersPage })));
const PODetailPage = lazyRetry(() => import("./pages/Finance").then((m) => ({ default: m.PODetailPage })));
const InvoicesPage = lazyRetry(() => import("./pages/Finance").then((m) => ({ default: m.InvoicesPage })));
const InvoiceDetailPage = lazyRetry(() => import("./pages/Finance").then((m) => ({ default: m.InvoiceDetailPage })));
const TaxInvoiceGeneratorPage = lazyRetry(() =>
  import("./pages/TaxInvoiceGenerator").then((m) => ({ default: m.TaxInvoiceGeneratorPage })),
);
const InvoiceTaxInvoicePage = lazyRetry(() =>
  import("./components/invoice/InvoicePage").then((m) => ({ default: m.InvoicePage })),
);
const TdsPage = lazyRetry(() => import("./pages/Finance").then((m) => ({ default: m.TdsPage })));
const PayrollPage = lazyRetry(() =>
  import("./pages/Payroll").then((m) => ({ default: m.PayrollPage })),
);
const FinanceReportsPage = lazyRetry(() =>
  import("./pages/FinanceReports").then((m) => ({ default: m.FinanceReportsPage })),
);
const EmployeesListPage = lazyRetry(() => import("./pages/Employees").then((m) => ({ default: m.EmployeesListPage })));
const EmployeeDetailPage = lazyRetry(() => import("./pages/Employees").then((m) => ({ default: m.EmployeeDetailPage })));
const UsersAdminPage = lazyRetry(() => import("./pages/UsersAdmin").then((m) => ({ default: m.UsersAdminPage })));
const AccessTemplatesPage = lazyRetry(() => import("./pages/AccessTemplates").then((m) => ({ default: m.AccessTemplatesPage })));
const CrmSettingsPage = lazyRetry(() => import("./pages/CrmSettings").then((m) => ({ default: m.CrmSettingsPage })));
const SupportTicketsPage = lazyRetry(() => import("./pages/SupportTickets").then((m) => ({ default: m.SupportTicketsPage })));
const SupportTicketDetailPage = lazyRetry(() => import("./pages/SupportTickets").then((m) => ({ default: m.SupportTicketDetailPage })));
const CrmReportsPage = lazyRetry(() => import("./pages/CrmReports").then((m) => ({ default: m.CrmReportsPage })));
const TemplateRequestsPage = lazyRetry(() => import("./pages/TemplateRequests").then((m) => ({ default: m.TemplateRequestsPage })));
const ProfilePage = lazyRetry(() => import("./pages/Profile").then((m) => ({ default: m.ProfilePage })));
const ScreeningDeskPage = lazyRetry(() => import("./pages/ScreeningDesk").then((m) => ({ default: m.ScreeningDeskPage })));
const MyInterviewsPage = lazyRetry(() => import("./pages/MyInterviews").then((m) => ({ default: m.MyInterviewsPage })));
const MyTasksPage = lazyRetry(() => import("./pages/dashboard/WorkDesk").then((m) => ({ default: m.MyTasksPage })));

export const CRM_ROUTES: CrmRoute[] = [
  { pattern: "", element: CrmDashboardPage },
  { pattern: "customers", element: CustomersListPage },
  { pattern: "customers/:id", element: CustomerDetailPage },
  { pattern: "opportunities", element: OpportunitiesWorkspace },
  { pattern: "opportunities/:id", element: OpportunityDetailPage },
  { pattern: "requirements", element: RequirementsListRedirect },
  { pattern: "requirements/:id", element: RequirementDetailPage },
  { pattern: "candidates", element: CandidatesListPage },
  { pattern: "candidates/:id", element: CandidateDetailPage },
  { pattern: "profiles", element: ProfilesListPage },
  { pattern: "profiles/:id", element: ProfileDetailPage },
  { pattern: "screening-desk", element: ScreeningDeskPage },
  { pattern: "talent-pool", element: TalentPoolPage },
  // The panel member's own technical rounds (7 Oct 2026) — the Interviewer
  // role's one page; RMG / TA who take rounds reach it from the sidebar too.
  { pattern: "my-interviews", element: MyInterviewsPage },
  // A CRM file in its own tab (10 Oct 2026) — `?file=/api/crm-files/…&name=`.
  // A bare <a target=_blank> to the file cannot send the bearer token.
  { pattern: "file-view", element: FileViewPage },
  { pattern: "my-tasks", element: MyTasksPage },
  { pattern: "calendar", element: CalendarPage },
  { pattern: "emails", element: EmailCenterPage },
  { pattern: "activity-log", element: ActivityLogPage },
  { pattern: "projects", element: ProjectsListPage },
  { pattern: "projects/:id", element: ProjectDetailPage },
  { pattern: "project-employees", element: ProjectEmployeesPage },
  { pattern: "project-employees/:id", element: ProjectEmployeeDetailPage },
  { pattern: "my-leave", element: MyLeavePage },
  { pattern: "branch-policy/:id", element: BranchPolicyPage },
  { pattern: "leave-applications", element: LeaveApplicationsPage },
  { pattern: "holidays", element: HolidaysPage },
  { pattern: "timesheets", element: TimesheetsListPage },
  { pattern: "timesheets/:id", element: TimesheetDetailPage },
  { pattern: "pos", element: PurchaseOrdersPage },
  { pattern: "pos/:id", element: PODetailPage },
  { pattern: "invoices", element: InvoicesPage },
  { pattern: "received-amounts", element: ReceivedAmountsPage },
  { pattern: "e-invoices", element: EInvoicesPage },
  { pattern: "invoices/tax-generator", element: TaxInvoiceGeneratorPage },
  { pattern: "invoices/:id/tax-invoice", element: InvoiceTaxInvoicePage },
  { pattern: "invoices/:id", element: InvoiceDetailPage },
  { pattern: "tds", element: TdsPage },
  { pattern: "finance-reports", element: FinanceReportsPage },
  { pattern: "payroll", element: PayrollPage },
  { pattern: "employees", element: EmployeesListPage },
  { pattern: "employees/:id", element: EmployeeDetailPage },
  { pattern: "users", element: UsersAdminPage },
  { pattern: "access-templates", element: AccessTemplatesPage },
  { pattern: "settings", element: CrmSettingsPage },
  { pattern: "support-tickets", element: SupportTicketsPage },
  { pattern: "support-tickets/:id", element: SupportTicketDetailPage },
  { pattern: "reports", element: CrmReportsPage },
  { pattern: "template-requests", element: TemplateRequestsPage },
  { pattern: "profile", element: ProfilePage },
];
