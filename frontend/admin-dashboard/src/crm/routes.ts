/** CRM route table — pattern → lazily-loaded page component. */
import { lazy } from "react";
import type { CrmRoute } from "./router";

const CrmDashboardPage = lazy(() => import("./pages/CrmDashboard").then((m) => ({ default: m.CrmDashboardPage })));
const CustomersListPage = lazy(() => import("./pages/Customers").then((m) => ({ default: m.CustomersListPage })));
const CustomerDetailPage = lazy(() => import("./pages/Customers").then((m) => ({ default: m.CustomerDetailPage })));
const OpportunitiesWorkspace = lazy(() => import("./pages/OpportunitiesWorkspace").then((m) => ({ default: m.OpportunitiesWorkspace })));
const RequirementsListRedirect = lazy(() => import("./pages/OpportunitiesWorkspace").then((m) => ({ default: m.RequirementsListRedirect })));
const OpportunityDetailPage = lazy(() => import("./pages/Opportunities").then((m) => ({ default: m.OpportunityDetailPage })));
const RequirementDetailPage = lazy(() => import("./pages/Requirements").then((m) => ({ default: m.RequirementDetailPage })));
const CandidatesListPage = lazy(() => import("./pages/CrmCandidates").then((m) => ({ default: m.CandidatesListPage })));
const CandidateDetailPage = lazy(() => import("./pages/CrmCandidates").then((m) => ({ default: m.CandidateDetailPage })));
const ProfilesListPage = lazy(() => import("./pages/Profiles").then((m) => ({ default: m.ProfilesListPage })));
const ProfileDetailPage = lazy(() => import("./pages/Profiles").then((m) => ({ default: m.ProfileDetailPage })));
const CalendarPage = lazy(() => import("./pages/Calendar"));
const ProjectsListPage = lazy(() => import("./pages/Projects").then((m) => ({ default: m.ProjectsListPage })));
const ProjectDetailPage = lazy(() => import("./pages/Projects").then((m) => ({ default: m.ProjectDetailPage })));
const ProjectEmployeesPage = lazy(() => import("./pages/ProjectEmployees").then((m) => ({ default: m.ProjectEmployeesPage })));
const ProjectEmployeeDetailPage = lazy(() => import("./pages/ProjectEmployeeDetail").then((m) => ({ default: m.ProjectEmployeeDetailPage })));
const MyLeavePage = lazy(() => import("./pages/MyLeave").then((m) => ({ default: m.MyLeavePage })));
const BranchPolicyPage = lazy(() => import("./pages/BranchPolicy").then((m) => ({ default: m.BranchPolicyPage })));
const LeaveApplicationsPage = lazy(() => import("./pages/LeaveApplications").then((m) => ({ default: m.LeaveApplicationsPage })));
const HolidaysPage = lazy(() => import("./pages/Holidays").then((m) => ({ default: m.HolidaysPage })));
const TimesheetsListPage = lazy(() => import("./pages/Timesheets").then((m) => ({ default: m.TimesheetsListPage })));
const TimesheetDetailPage = lazy(() => import("./pages/Timesheets").then((m) => ({ default: m.TimesheetDetailPage })));
const PurchaseOrdersPage = lazy(() => import("./pages/Finance").then((m) => ({ default: m.PurchaseOrdersPage })));
const PODetailPage = lazy(() => import("./pages/Finance").then((m) => ({ default: m.PODetailPage })));
const InvoicesPage = lazy(() => import("./pages/Finance").then((m) => ({ default: m.InvoicesPage })));
const InvoiceDetailPage = lazy(() => import("./pages/Finance").then((m) => ({ default: m.InvoiceDetailPage })));
const TaxInvoiceGeneratorPage = lazy(() =>
  import("./pages/TaxInvoiceGenerator").then((m) => ({ default: m.TaxInvoiceGeneratorPage })),
);
const InvoiceTaxInvoicePage = lazy(() =>
  import("./components/invoice/InvoicePage").then((m) => ({ default: m.InvoicePage })),
);
const TdsPage = lazy(() => import("./pages/Finance").then((m) => ({ default: m.TdsPage })));
const FinanceReportsPage = lazy(() =>
  import("./pages/FinanceReports").then((m) => ({ default: m.FinanceReportsPage })),
);
const EmployeesListPage = lazy(() => import("./pages/Employees").then((m) => ({ default: m.EmployeesListPage })));
const EmployeeDetailPage = lazy(() => import("./pages/Employees").then((m) => ({ default: m.EmployeeDetailPage })));
const UsersAdminPage = lazy(() => import("./pages/UsersAdmin").then((m) => ({ default: m.UsersAdminPage })));
const AccessTemplatesPage = lazy(() => import("./pages/AccessTemplates").then((m) => ({ default: m.AccessTemplatesPage })));
const CrmSettingsPage = lazy(() => import("./pages/CrmSettings").then((m) => ({ default: m.CrmSettingsPage })));
const CrmReportsPage = lazy(() => import("./pages/CrmReports").then((m) => ({ default: m.CrmReportsPage })));
const TemplateRequestsPage = lazy(() => import("./pages/TemplateRequests").then((m) => ({ default: m.TemplateRequestsPage })));
const ProfilePage = lazy(() => import("./pages/Profile").then((m) => ({ default: m.ProfilePage })));

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
  { pattern: "calendar", element: CalendarPage },
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
  { pattern: "invoices/tax-generator", element: TaxInvoiceGeneratorPage },
  { pattern: "invoices/:id/tax-invoice", element: InvoiceTaxInvoicePage },
  { pattern: "invoices/:id", element: InvoiceDetailPage },
  { pattern: "tds", element: TdsPage },
  { pattern: "finance-reports", element: FinanceReportsPage },
  { pattern: "employees", element: EmployeesListPage },
  { pattern: "employees/:id", element: EmployeeDetailPage },
  { pattern: "users", element: UsersAdminPage },
  { pattern: "access-templates", element: AccessTemplatesPage },
  { pattern: "settings", element: CrmSettingsPage },
  { pattern: "reports", element: CrmReportsPage },
  { pattern: "template-requests", element: TemplateRequestsPage },
  { pattern: "profile", element: ProfilePage },
];
