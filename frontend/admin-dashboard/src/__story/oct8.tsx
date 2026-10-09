import { createRoot } from "react-dom/client";
import "../styles.css";
import { ThemeProvider } from "../theme/ThemeProvider";
import { CrmMeProvider } from "../crm/CrmApp";
import { InvoiceJourney } from "../crm/components/invoice/InvoiceJourney";
import { ApplicantsBoard } from "../crm/components/ApplicantsBoard";
import { MyTasksPage } from "../crm/pages/dashboard/WorkDesk";

const q = new URLSearchParams(location.search);
const desk = { as_of: "2026-10-08T10:00:00Z", tabs: [{ key: "fin_invoices", label: "Tax invoices issued", hint: "Every original invoice", count: 4, stage: "Done", info: true, done_count: 1,
  items: [
    { key: "iv:1", title: "KRSW26-27-124-VS · ₹80,146", subtitle: "HARMAN · Linux Kernel · Swapnil Chide", chip: "Unpaid", tone: "info", when: "2026-10-07", path: "invoices/1", action: "Open invoice", profile_id: null, section: "HARMAN", customer: "HARMAN", employee: "Swapnil Chide", month: "2026-10", amount: 80146 },
    { key: "iv:2", title: "KRSW26-27-123-VS · ₹3,47,294", subtitle: "HARMAN · HMI · Hrushabh Khamkar", chip: "Unpaid", tone: "info", when: "2026-10-07", path: "invoices/2", action: "Open invoice", profile_id: null, section: "HARMAN", customer: "HARMAN", employee: "Hrushabh Khamkar", month: "2026-10", amount: 347294 },
    { key: "iv:3", title: "KRSW26-27-85-VS · ₹2,93,819", subtitle: "HARMAN · V&V · Rakesh Singh", chip: "Unpaid", tone: "info", when: "2026-09-24", path: "invoices/3", action: "Open invoice", profile_id: null, section: "HARMAN", customer: "HARMAN", employee: "Rakesh Singh", month: "2026-09", amount: 293819, done: true },
    { key: "iv:4", title: "KRNX26-27-04-MH · ₹3,02,080", subtitle: "Mahle · Prachi Dahake", chip: "Paid", tone: "ok", when: "2026-09-06", path: "invoices/4", action: "Open invoice", profile_id: null, section: "Mahle", customer: "Mahle", employee: "Prachi Dahake", month: "2026-09", amount: 302080 },
  ] }] };
const rows = [
  { id: 1, candidate_id: 1, pipeline_status: "Sales_Screening", candidate_name: "Dasari Vasu", email: "vasudasari1999@gmail.com", phone: "+919866592715", experience_years: 2.8, current_ctc: 400000, expected_ctc: 700000, hike_percent: 75, notice_period: "7 days", created_at: "2026-10-07", candidate_status: { key: "with_sales", label: "With Sales – Ready to Submit", tone: "info" }, allowed_next_statuses: ["Customer_Screening", "Sales_Rejected", "Self_Withdrawn"] },
  { id: 2, candidate_id: 2, pipeline_status: "Shortlisted", candidate_name: "Chandana Gunduboina", email: "chandana@gmail.com", phone: "+919381828500", experience_years: 2, current_ctc: 270000, expected_ctc: 550000, hike_percent: 103.7, notice_period: "15", created_at: "2026-10-07", candidate_status: { key: "customer_shortlisted", label: "Customer Shortlisted", tone: "ok" }, allowed_next_statuses: ["Customer_Approval", "Customer_Rejected"], next_interview: null },
  { id: 3, candidate_id: 3, pipeline_status: "Customer_Approval", candidate_name: "Meera Iyer", email: "meera@gmail.com", experience_years: 6, current_ctc: 900000, expected_ctc: 1200000, created_at: "2026-10-01", candidate_status: { key: "approval", label: "Pending Sales Head Approval", tone: "warn" }, allowed_next_statuses: [], offer: { ctc: 1300000, rate_unit: "Monthly", rate_value: 108000, joining_date: "2026-10-20" } },
];
(window as any).fetch = async (url: string) => {
  const u = String(url);
  let body: any = { success: true, data: [] };
  if (u.includes("/api/dashboard/desk")) body = { success: true, data: desk };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
const base = { id: 7, invoice_number: "KRNX26-27-04-MH", invoice_date: "2026-09-06", proforma_number: "PI-2026-003", grand_total: 302080, paid_amount: 0, balance_amount: 302080, gst: { grand_total: 302080 } };
const inv = (w: string) => w === "approved" ? { ...base, customer_approval: { approved: true, approved_at: "2026-10-06T13:20:00Z", approved_by_name: "Balasaheb Suryawanshi", note: "No changes suggested", can_confirm: false, can_withdraw: false, block: null }, einvoice: { irn: null, ack_number: null, ack_date: null, can_edit: true }, einvoice_ready: false, payments_open: false, payment_block: "Add the e-invoice IRN and Ack No. first — payments are recorded against the e-invoice." }
  : w === "irn" ? { ...base, paid_amount: 100000, balance_amount: 202080, customer_approval: { approved: true, approved_at: "2026-10-06T13:20:00Z", approved_by_name: "Balasaheb Suryawanshi", note: "No changes suggested", can_confirm: false, can_withdraw: false, block: null }, einvoice: { irn: "3f9a".repeat(16), ack_number: "112410012345678", ack_date: "2026-10-07", can_edit: true }, einvoice_ready: true, payments_open: true }
  : { ...base, customer_approval: { approved: false, can_confirm: true, can_withdraw: false, block: null }, einvoice_ready: false, payments_open: false, payment_block: "Waiting for the customer's approval — the Sales Manager / Sales Head confirms it, then Finance adds the IRN. Payments open after that." };
const me: any = { id: 1, username: "fin", full_name: "Test Finance", roles: ["Finance", "Sales_Head"], access: { full: true }, approvals: [] };
const w = q.get("w") || "journey";
window.history.replaceState(null, "", "?view=crm&p=my-tasks&tab=fin_invoices");
createRoot(document.getElementById("root")!).render(
  <ThemeProvider><CrmMeProvider value={me}><div className="space-y-4 p-4">
    {w === "journey" && ["new", "approved", "irn"].map((s) => <InvoiceJourney key={s} inv={inv(s)} canWrite onPay={() => {}} onTds={() => {}} onOpenEInvoice={() => {}} onChanged={() => {}} notify={() => {}} />)}
    {w === "applicants" && <ApplicantsBoard rows={rows as any} meta={{ page: 1, limit: 20, total: 35, pages: 2, phase_counts: { sourcing: 12, technical_screening: 4, technical_interview: 9, sales_screening: 3, customer_screening: 2, customer_interviewing: 1, selection: 2, closed: 2 } } as any}
      search="" onSearch={() => {}} page={1} onPage={() => {}} stage="all" onStage={() => {}} canApply onApply={() => {}} onChanged={() => {}} toast={() => {}} />}
    {w === "tasks" && <MyTasksPage />}
  </div></CrmMeProvider></ThemeProvider>);
