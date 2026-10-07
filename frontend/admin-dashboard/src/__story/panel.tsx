/* Story harness (7 Oct 2026): My Interviews, the department-wise Roles and
   Access Templates tabs, the redesigned Action permissions / Email flows,
   the Settings navigator and the Reports tiles — mocked fetch.
   ?w=mi | roles | templates | perms | settings | reports   (&dark=1) */
import { createRoot } from "react-dom/client";
import "../styles.css";
import { ThemeProvider } from "../theme/ThemeProvider";
import { CrmMeProvider } from "../crm/CrmApp";
import { MyInterviewsPage } from "../crm/pages/MyInterviews";
import { RolesPanel } from "../crm/pages/RolesAdmin";
import { AccessTemplatesPage } from "../crm/pages/AccessTemplates";
import { UsersAdminPage } from "../crm/pages/UsersAdmin";
import { CrmSettingsPage } from "../crm/pages/CrmSettings";
import { CrmReportsPage } from "../crm/pages/CrmReports";

const q = new URLSearchParams(location.search);
const w = q.get("w") || "mi";

const departments = [
  { key: "leadership", label: "Leadership" }, { key: "sales", label: "Sales" }, { key: "recruitment", label: "Recruitment (TA)" },
  { key: "engineering", label: "Engineering / RMG" }, { key: "panel", label: "Interview Panel" }, { key: "hr", label: "HR" },
  { key: "finance", label: "Finance" }, { key: "other", label: "Other" },
];
const tabs = [
  ["iv:dashboard", "Interview Dashboard", "Interview Platform"], ["iv:candidates", "Interview Reports", "Interview Platform"],
  ["dashboard", "Dashboard", "CRM"], ["customers", "Customers", "CRM"], ["opportunities", "Opportunities", "CRM"], ["requirements", "Requirements (Sourcing)", "CRM"],
  ["candidates", "Candidates", "CRM"], ["profiles", "Candidate Profiles", "CRM"], ["my-interviews", "My Interviews (panel feedback)", "CRM"],
  ["projects", "Projects", "CRM"], ["timesheets", "Timesheets", "CRM"], ["invoices", "Invoices", "CRM"], ["employees", "Employees", "CRM"], ["reports", "Reports", "CRM"],
].map(([key, label, group]) => ({ key, label, group, default_roles: key.startsWith("iv:") ? ["TA", "RMG", "HR"] : [], fields: key === "profiles" ? [{ key: "current_ctc", label: "Current CTC" }, { key: "workflow", label: "Workflow" }] : [] }));
const approvals = [
  { key: "timesheet.approve", label: "Approve timesheet", description: "Approve a submitted timesheet", group: "Timesheets & invoicing", default_roles: ["GM"], kind: "APPROVAL" },
  { key: "profile.rmg_screening", label: "RMG screening decision", description: "Shortlist / reject at screening", group: "Sales & hiring", default_roles: ["RMG", "GM"], kind: "APPROVAL" },
  { key: "po.manage", label: "Manage purchase orders", description: "Create / edit POs", group: "Timesheets & invoicing", default_roles: ["Finance"], kind: "MANAGE", tab: "pos" },
];
const builtin = ["CEO", "Admin", "Sales", "Sales_Head", "RMG", "TA", "HR", "Finance"].map((n, i) => ({
  name: n, label: n.replace("_", " "), builtin: true, members_count: [1, 2, 4, 1, 2, 5, 1, 1][i],
  department: ({ CEO: "leadership", Admin: "leadership", Sales: "sales", Sales_Head: "sales", RMG: "engineering", TA: "recruitment", HR: "hr", Finance: "finance" } as any)[n],
  description: "Built-in role — permissions come from the product's role rules and any Access Template.",
}));
const custom = [
  { id: 1, name: "GM", description: "General Manager — screens with RMG, raises Proformas.", is_active: true, department: "engineering", tab_access: { opportunities: "view", requirements: "edit", profiles: "edit", timesheets: "edit", invoices: "create" }, field_access: {}, action_access: ["timesheet.approve", "profile.rmg_screening"], members_count: 1, builtin: false },
  { id: 2, name: "Sales Manager", description: "Whole-team deals, confirms invoices with the customer.", is_active: true, department: "sales", tab_access: { opportunities: "create", customers: "edit", invoices: "view" }, field_access: {}, action_access: [], members_count: 1, builtin: false },
  { id: 3, name: "Interviewer", description: "Panel member: sees only the candidates whose technical interview they take and records that round's feedback. Nothing else.", is_active: true, department: "panel", tab_access: { "my-interviews": "edit" }, field_access: {}, action_access: [], members_count: 8, builtin: false },
  { id: 4, name: "Auditor", description: "", is_active: false, department: "other", tab_access: { reports: "view" }, field_access: {}, action_access: [], members_count: 0, builtin: false },
];
const templates = [
  { id: 11, name: "Default — TA", description: "Sourcing + applied candidates", role: "TA", role_department: "recruitment", is_active: true, assigned_count: 5, tab_access: { dashboard: "view", opportunities: "view", requirements: "edit", candidates: "create", profiles: "edit", "iv:dashboard": "view" }, field_access: {}, action_access: [] },
  { id: 12, name: "Default — HR", description: "", role: "HR", role_department: "hr", is_active: true, assigned_count: 1, tab_access: { dashboard: "view", employees: "create" }, field_access: { profiles: { workflow: "edit" } }, action_access: null },
  { id: 13, name: "Default — Sales", description: "Own deals only", role: "Sales", role_department: "sales", is_active: true, assigned_count: 4, tab_access: { dashboard: "view", customers: "edit", opportunities: "create" }, field_access: {}, action_access: [] },
  { id: 14, name: "GM template", description: "Screening + billing", role: "GM", role_department: "engineering", is_active: false, assigned_count: 0, tab_access: { profiles: "edit", timesheets: "edit" }, field_access: {}, action_access: ["timesheet.approve"] },
];
const actions = [
  { action: "timesheet.approve", label: "Approve timesheet", description: "Approve a submitted timesheet so it can be invoiced.", kind: "APPROVAL", group: "Timesheets & invoicing", default_roles: ["GM"], roles: ["GM"], customized: false },
  { action: "timesheet.generate_invoice", label: "Raise the Proforma", description: "Generate the Proforma from an approved sheet.", kind: "APPROVAL", group: "Timesheets & invoicing", default_roles: ["GM"], roles: ["GM", "Finance"], customized: true },
  { action: "invoice.convert_proforma", label: "Generate the tax invoice", description: "Convert a Proforma into the original invoice.", kind: "APPROVAL", group: "Timesheets & invoicing", default_roles: ["Finance"], roles: ["Finance"], customized: false },
  { action: "profile.rmg_screening", label: "RMG screening decision", description: "Shortlist or reject a candidate at Technical Screening.", kind: "APPROVAL", group: "Sales & hiring", default_roles: ["RMG", "GM"], roles: ["RMG", "GM"], customized: false },
  { action: "opportunity.approve", label: "Approve an opportunity", description: "The Sales Head's approval of a new deal.", kind: "APPROVAL", group: "Sales & hiring", default_roles: ["Sales_Head"], roles: ["Sales_Head"], customized: false },
  { action: "po.manage", label: "Manage purchase orders", description: "Create, edit, renew and cancel POs.", kind: "MANAGE", group: "Timesheets & invoicing", default_roles: ["Finance"], roles: ["Finance"], customized: false },
  { action: "project.close", label: "Close a project", description: "Schedule or cancel a project's last working day.", kind: "MANAGE", group: "Other", default_roles: ["Sales_Head", "RMG", "HR"], roles: ["Sales_Head", "RMG", "HR"], customized: false },
];
const flows = [
  { event: "opportunity.stage_closed", label: "Opportunity closed", description: "Sent when Sales closes a deal.", kind: "internal", default_roles: ["TA", "RMG", "Sales_Head"], roles: ["TA", "RMG", "Sales_Head"], extra_emails: [], enabled: true, customized: false, tokens: ["subject", "recipient", "company"], default_subject: "{subject}", default_body: "Hello {recipient},\n\n{body}", last_sent: { subject: "Opportunity closed: C-2026-00099", to: "Gargee Joshi", sent_at: "2026-10-06T11:20:00+05:30" } },
  { event: "requirement.ta_assigned", label: "Position assigned to a TA", description: "Only the TAs named on the assignment receive it.", kind: "internal", default_roles: ["TA"], roles: ["TA"], extra_emails: [], enabled: true, customized: false, tokens: ["subject", "recipient", "company"] },
  { event: "interview.panel_assigned", label: "You are taking this interview — panel member notified", description: "Sent to the employee named as the interviewer of a Technical L1–L4 round. Only that person receives it.", kind: "internal", default_roles: [], roles: [], extra_emails: [], enabled: true, customized: false, tokens: ["subject", "recipient", "company"] },
  { event: "interview.feedback_due", label: "Interview over — feedback due", description: "Daily until the verdict is in.", kind: "internal", default_roles: [], roles: [], extra_emails: ["audit@karnex.in"], enabled: true, customized: true, tokens: ["subject", "recipient", "company"], subject_template: "[Karnex] {subject}", body_template: null },
  { event: "invoice.generated", label: "Tax invoice generated", description: "Sent to the Sales Manager and Sales Head.", kind: "internal", default_roles: ["Sales Manager", "Sales_Head"], roles: ["Sales Manager", "Sales_Head"], extra_emails: [], enabled: true, customized: false, tokens: ["subject", "recipient", "company"] },
  { event: "timesheet.submitted", label: "Timesheet submitted", description: "Sent to whoever may approve.", kind: "internal", default_roles: ["GM", "CEO"], roles: ["GM"], extra_emails: [], enabled: false, customized: true, tokens: ["subject", "recipient", "company"] },
  { event: "leave.applied", label: "Leave applied", description: "Sent to HR.", kind: "internal", default_roles: ["HR"], roles: ["HR"], extra_emails: [], enabled: true, customized: false, tokens: ["subject", "recipient", "company"] },
  { event: "support.ticket_raised", label: "Support ticket raised", description: "Sent to Admin and CEO.", kind: "internal", default_roles: ["Admin", "CEO"], roles: ["Admin", "CEO"], extra_emails: [], enabled: true, customized: false, tokens: ["subject", "recipient", "company"] },
  { event: "candidate.opening_interest", label: "Job opportunity — are you interested?", description: "Sent to every bulk-uploaded candidate.", kind: "candidate", default_roles: [], roles: [], extra_emails: [], enabled: true, customized: false, tokens: ["candidate", "role"], default_subject: "Job opportunity: {role} — are you interested?", default_body: "Dear {candidate}, …" },
];
const allRoles = ["CEO", "Admin", "Sales", "Sales_Head", "RMG", "TA", "HR", "Finance", "GM", "Sales Manager", "Interviewer"];
const customersNames = [{ id: 60, name: "Harman" }, { id: 61, name: "APTIV" }, { id: 62, name: "VISTEON" }];
const users = [{ id: 2, full_name: "Karan Singh", username: "karan", email: "karan.singh@karnex.in", is_active: true, roles: ["Admin", "CEO"], custom_roles: [] },
  { id: 3, full_name: "Gargee Joshi", username: "gargee", email: "gargee.joshi@karnex.in", is_active: true, roles: ["TA"], custom_roles: [] },
  { id: 7, full_name: "Asha Rao", username: "asha", email: "asha@karnex.in", is_active: true, roles: [], custom_roles: ["Interviewer"] }];

const cand = (id: number, name: string, email: string) => ({ id, name, email, phone: "98765 43210", experience_years: 6.5, notice_period: "30 days", technical_domain: "Embedded", cv_url: "/api/crm-files/resumes/x.pdf", current_ctc: 1400000, expected_ctc: 1800000 });
const rounds = [
  { id: 501, profile_id: 91, kind: "L1_Interview", round_label: "L1 - Interview", phase: "pending", scheduled_at: "2026-10-07T05:30:00+00:00", raw_when: "2026-10-07 11:00", duration_minutes: 60, meeting_link: "https://teams.microsoft.com/l/meetup-join/abc", status: "Scheduled", result: null, feedback: null, note: "Probe RTOS and bootloaders.", interviewer: "Asha Rao", candidate: cand(1, "Rahul Verma", "rahul@mail.com"), position: { opportunity_id: 104, opp_id: "C-2026-00104", title: "IT&V Engineer [Certification]", customer_name: "Harman" }, ai_l1: { ai_interview_result: "Passed", ai_effective_result: "Passed", ai_overall_score_percent: 72, ai_interview_completed_at: "2026-10-05T09:00:00+00:00" } },
  { id: 502, profile_id: 92, kind: "L2_F2F", round_label: "L2 - Interview", phase: "pending", scheduled_at: "2026-10-06T09:30:00+00:00", raw_when: "2026-10-06 15:00", duration_minutes: 45, meeting_link: null, status: "Scheduled", result: null, feedback: null, note: null, interviewer: "Asha Rao", candidate: cand(2, "Priya Nair", "priya@mail.com"), position: { opportunity_id: 99, opp_id: "C-2026-00099", title: "AUTOSAR BSW Engineer", customer_name: "APTIV" }, ai_l1: null },
  { id: 503, profile_id: 93, kind: "L1_Interview", round_label: "L1 - Interview", phase: "upcoming", scheduled_at: "2026-10-09T04:30:00+00:00", raw_when: "2026-10-09 10:00", duration_minutes: 60, meeting_link: "https://meet.google.com/xyz", status: "Scheduled", result: null, feedback: null, note: null, interviewer: "Asha Rao", candidate: cand(3, "Likhith Nelaballi", "likhith@mail.com"), position: { opportunity_id: 104, opp_id: "C-2026-00104", title: "IT&V Engineer [Certification]", customer_name: "Harman" }, ai_l1: { ai_interview_result: "Failed", ai_effective_result: "Failed", ai_overall_score_percent: 0, ai_not_attempted: true, ai_interview_completed_at: null } },
  { id: 504, profile_id: 94, kind: "L1_Interview", round_label: "L1 - Interview", phase: "done", scheduled_at: "2026-10-01T06:00:00+00:00", raw_when: "2026-10-01 11:30", duration_minutes: 60, meeting_link: null, status: "Completed", result: "Hire", feedback: "Strong fundamentals, explained a mutex vs a semaphore clearly, hands-on with CAPL.", note: null, interviewer: "Asha Rao", candidate: cand(4, "Sneha Kulkarni", "sneha@mail.com"), position: { opportunity_id: 99, opp_id: "C-2026-00099", title: "AUTOSAR BSW Engineer", customer_name: "APTIV" }, ai_l1: null },
];
const oppRows = [
  { opp_id: "C-2026-00104", title: "IT&V Engineer [Certification]", customer: "Harman", customer_id: 60, stage: "Active", approval_status: "Approved", opp_type: "T&M", rfi_value: 2400000, positions_total: 2, positions_open: 1, positions_joined: 1, position_status: "In Progress", created_by: "Sanjana Patil", created_by_username: "sanjana", created_at: "2026-09-28T10:00:00+05:30" },
  { opp_id: "C-2026-00099", title: "AUTOSAR BSW Engineer", customer: "APTIV", customer_id: 61, stage: "Active", approval_status: "Pending_Sales_Head_Approval", opp_type: "T&M", rfi_value: null, positions_total: null, position_status: null, created_by: "Balasaheb Suryawanshi", created_by_username: "bala", created_at: "2026-10-02T10:00:00+05:30" },
  { opp_id: "C-2026-00086", title: "Senior non-AUTOSAR engineer", customer: "VISTEON", customer_id: 62, stage: "Closed_Won", approval_status: "Approved", opp_type: "T&M", rfi_value: 1816000, positions_total: 1, positions_open: 0, positions_joined: 1, position_status: "Closed Won", created_by: "Sanjana Patil", created_by_username: "sanjana", created_at: "2026-08-12T10:00:00+05:30" },
];
const oppSummary = { count: 3, rfi_total: 4216000, rfi_known: 2, positions_total: 3, positions_open: 1, positions_joined: 2, by_stage: { Active: 2, Closed_Won: 1 }, by_type: { "T&M": 3 } };

(window as any).fetch = async (url: string) => {
  const u = String(url);
  let body: any = { success: true, data: [] };
  if (u.startsWith("/api/my-interviews/") && u.endsWith("/ai-summary")) body = { success: true, data: { available: true, report_status: "ready", final_status: "completed", terminated: false, not_attempted: false, overall_score_percent: 72, technical_score_percent: 70, communication_score_percent: 80, problem_solving_score_percent: 66, recommendation: "Hire", fitment: "Good fit", summary: "Answers were brief but correct; strong on embedded fundamentals.", strengths: ["RTOS concepts", "Clear communication"], improvements: ["Design-level questions"], skills: [{ skill: "RTOS", score: 78 }, { skill: "C++", score: 64 }], questions: { total: 8, answered: 7, skipped: 1, excluded: 0 }, job_title: "IT&V Engineer", completed_at_ist: "5 Oct 2026, 2:30 PM", result: "Passed", effective_result: "Passed", hr_decision_label: null, level: "L1" } };
  else if (u.startsWith("/api/my-interviews/")) { const id = Number(u.split("/")[3]); const r = rounds.find((x) => x.id === id)!; body = { success: true, data: { ...r, skills: [{ skill_id: 1, skill_name: "C++", is_mandatory: true, min_rating: 4 }, { skill_id: 3, skill_name: "RTOS", is_mandatory: true, min_rating: 3 }, { skill_id: 5, skill_name: "CAPL", is_mandatory: false, min_rating: 2 }], results_scale: ["No Hire", "Leaning No", "Leaning Hire", "Hire", "Strong Hire"], my_other_rounds: id === 501 ? [{ id: 504, kind: "L1_Interview", round_label: "L1 - Interview", scheduled_at: "2026-10-01T06:00:00+00:00", result: "Hire", phase: "done" }] : [] } }; }
  else if (u.startsWith("/api/my-interviews")) { const scope = new URLSearchParams(u.split("?")[1] || "").get("scope") || "pending"; body = { success: true, data: rounds.filter((r) => scope === "all" || r.phase === scope), meta: { counts: { pending: 2, upcoming: 1, done: 1 }, linked: q.get("unlinked") !== "1", scope } }; }
  else if (u.includes("/api/access-templates/registry")) body = { success: true, data: { modes: ["view", "edit", "create"], tabs, approvals, departments, role_tags: ["Sales", "Sales_Head", "RMG", "TA", "HR", "Finance", "GM", "Sales Manager", "Interviewer"] } };
  else if (u.includes("/api/access-templates")) body = { success: true, data: templates };
  else if (u.includes("/api/roles")) body = { success: true, data: { builtin, custom } };
  else if (u.includes("/api/email-flows")) body = { success: true, data: { flows, all_roles: allRoles, paused_user_ids: [] } };
  else if (u.includes("/api/action-permissions")) body = { success: true, data: { actions, all_roles: allRoles } };
  else if (u.includes("/api/customers/names")) body = { success: true, data: customersNames };
  else if (u.includes("/api/reports/opportunities")) body = { success: true, data: oppRows, meta: { summary: oppSummary } };
  else if (u.includes("/api/reports/candidate-profiles")) body = { success: true, data: [], meta: { summary: { count: 0, joined: 0, closed: 0, live: 0, avg_hike_percent: null, by_stage: {}, by_group: {} } } };
  else if (u.includes("/api/departments")) body = { success: true, data: [{ id: 1, name: "Engineering", is_active: true }, { id: 2, name: "Sales", is_active: true }], meta: { total: 2, pages: 1 } };
  else if (u.startsWith("/api/users")) body = { success: true, data: users, meta: { page: 1, limit: 20, total: 3, pages: 1, counts: { total: 3, active: 3, inactive: 0, no_role: 0, password_pending: 0 } } };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
const path = { mi: "my-interviews", roles: "users", templates: "users", perms: "users", settings: "settings", reports: "reports" }[w] || "my-interviews";
window.history.replaceState(null, "", `?view=crm&p=${path}${w === "mi" && q.get("focus") ? `&focus=${q.get("focus")}` : ""}${w === "mi" && q.get("scope") ? `&scope=${q.get("scope")}` : ""}`);
const me: any = w === "mi"
  ? { id: 7, username: "asha", full_name: "Asha Rao", email: "asha@karnex.in", roles: ["Interviewer"], display_roles: ["Interviewer"], access: { full: false, visible_tabs: ["my-interviews"], tabs: { "my-interviews": "edit" } }, approvals: [] }
  : { id: 2, username: "karan", full_name: "Karan Singh", roles: ["Admin", "CEO"], access: { full: true }, approvals: [] };
const noop = () => {};
const view = w === "roles" ? <RolesPanel notify={noop} />
  : w === "templates" ? <AccessTemplatesPage />
  : w === "perms" ? <UsersAdminPage />
  : w === "settings" ? <CrmSettingsPage />
  : w === "reports" ? <CrmReportsPage />
  : <MyInterviewsPage />;
createRoot(document.getElementById("root")!).render(
  <ThemeProvider><CrmMeProvider value={me}><div className="p-4">{view}</div></CrmMeProvider></ThemeProvider>);
