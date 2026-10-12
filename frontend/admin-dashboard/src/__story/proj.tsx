/* Story harness (12 Oct 2026): New Project wizard step 1 — active customers only.
   ?dark=1  ?pick=1 (customer + branch pre-picked through the UI by the script) */
import { createRoot } from "react-dom/client";
import "../styles.css";
import { ThemeProvider } from "../theme/ThemeProvider";
import { CrmMeProvider } from "../crm/CrmApp";
import { CreateProjectWizard } from "../crm/components/EditProjectWizard";

const active = ["Aptiv", "Harman", "HARMAN Connected Service", "Magna Steyr", "Visteon"].map((name, i) => ({ id: 60 + i, name, status: "Active" }));
const branches = [{ id: 11, branch_name: "Bengaluru — Whitefield" }, { id: 12, branch_name: "Pune — Hinjewadi" }, { id: 13, branch_name: "Hyderabad — HITEC City" }];
(window as any).fetch = async (url: string) => {
  const u = String(url);
  let body: any = { success: true, data: [] };
  if (u.includes("/api/customers/names?status=Active")) body = { success: true, data: active };
  else if (u.includes("/api/customers/names")) body = { success: true, data: active };
  else if (/\/api\/customers\/\d+\/branches/.test(u)) body = { success: true, data: branches };
  else if (u.includes("/policy")) body = { success: true, data: { leave_policies: [] } };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
const me: any = { id: 2, username: "karan", full_name: "Karan Singh", roles: ["Admin"], access: { full: true }, approvals: [] };
createRoot(document.getElementById("root")!).render(
  <ThemeProvider><CrmMeProvider value={me}>
    <CreateProjectWizard onClose={() => {}} onSaved={() => {}} notify={() => {}} />
  </CrmMeProvider></ThemeProvider>);
