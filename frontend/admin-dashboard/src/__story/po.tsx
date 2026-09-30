import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import { ThemeProvider } from "../theme/ThemeProvider";
import { CrmMeProvider } from "../crm/CrmApp";
import { PoPicker, type PoOption } from "../crm/components/PoPicker";
import { JdSkillsModal } from "../crm/components/JdSkillsModal";
import { PoSelectModal } from "../crm/pages/Timesheets";

const po = (id: number, no: string, extra: Partial<PoOption>): PoOption => ({
  id, po_number: no, po_type: "Standard", status: "Active", start_date: "2026-04-01", end_date: "2027-03-31",
  total_value: 747000, used_value: 0, balance_value: 747000, ...extra });
const pos = [
  po(1, "VL-KNB-300871", { tagged_to_employee: true, employee_match: true, employee_name: "Kunche Nani Babu", used_value: 232060, balance_value: 514940 }),
  po(2, "VL-KNB-300777", { employee_match: true, billed_before: 3, used_value: 700000, balance_value: 47000, end_date: "2026-08-31", expired: true }),
  po(3, "VL-NS-300840", { employee_name: "Navakoti Snigdha", employee_id: 9, total_value: 630000, balance_value: 630000 }),
  po(4, "VL-GGR-300986", { employee_name: "Gurusiddesh GR", employee_id: 10, total_value: 978870, balance_value: 978870, project_allocated: 978870, project_used: 0 }),
  po(5, "Dum_PO_0101", { employee_name: "Dummy RAO", employee_id: 11, total_value: 500000, balance_value: 288800, used_value: 211200, expired: true, end_date: "2026-06-30" }),
  po(6, "VL-SSCH-301000", { status: "Cancelled", selectable: false, total_value: 210000, balance_value: 210000 }),
];
(window as any).fetch = async (url: string) => {
  const u = String(url);
  let body: any = { success: true, data: [] };
  if (u.includes("/po-options")) body = { success: true, data: { pos, selected_po_id: null, suggested_po_id: 1, timesheet_employee_name: "Kunche Nani Babu",
    project_name: "Contract Staffing Service", customer_name: "VISTEON", invoice_format: { sac: true, leave: true, per_day: true },
    returned_proforma: q.get("ret") ? { invoice_number: "PI-2026-014", reason: "Rate does not match the PO — please check the June rate.", returned_at: "2026-09-29T10:00:00Z" } : null,
    rate: { month: "2026-06", billing_unit: "Hourly", rate: 1414.77, rate_split: false, sub_periods: [], source: "Project Employee — Commercial Details",
      project_employee_id: 5, current_rate_row: { id: 1, effective_from: "2026-04-01", rate: 1414.77 } } } };
  else if (u.includes("/invoice-preview")) body = { success: true, data: { line_items: [{ description: "Contract Staffing Service Anamalamudi Gowtham - Jun 2026", total_billed_qty: 176, rate_per_unit: 1414.77, amount: 248999.52, loss_of_pay_days: 1 }], totals: { sub_total: 248999.52, frozen_at: "2026-09-30T05:00:00Z" } } };
  else if (u.includes("/attachments")) body = { success: true, data: [{ id: 1, file_url: "/api/crm-files/x/jd.pdf", file_name: "AGM-RnD-JD.pdf", kind: "rmg_jd" }] };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
const q = new URLSearchParams(location.search);
window.history.replaceState(null, "", "?view=crm&p=timesheets/1");
function Po() {
  const [v, setV] = useState<number | null>(1);
  return <div className="mx-auto max-w-2xl rounded-2xl border border-subtle bg-surface-0 p-5">
    <h2 className="mb-3 text-sm font-bold">Purchase Order</h2>
    <PoPicker pos={pos} value={v} onChange={setV} employeeName="Kunche Nani Babu" suggestedId={1} monthLabel="August 2026" />
  </div>;
}
const me: any = { id: 1, username: "gm", full_name: "Laddagiri", roles: ["GM"], access: { full: true }, approvals: [] };
const req: any = { id: 82, title: "AGM - Research & Development (ADAS & ARAS)", req_number: "REQ-0082", opportunity_opp_id: "C-2026-00097",
  status: "Open_For_Sourcing", description: "AGM - Research & Development (ADAS & ARAS)", rmg_jd_text: "", skills: [] };
createRoot(document.getElementById("root")!).render(
  <ThemeProvider><CrmMeProvider value={me}><div className="p-4">
    {q.get("w") === "jd" ? <JdSkillsModal req={req} onClose={() => {}} onSaved={() => {}} toast={() => {}} mode={q.get("approve") ? "approve" : "edit"} />
     : q.get("w") === "raise" ? <PoSelectModal timesheetId={1} onClose={() => {}} onGenerated={() => {}} showToast={() => {}} /> : <Po />}
  </div></CrmMeProvider></ThemeProvider>);
