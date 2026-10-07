/** Story harness — Reports ▸ Recruiter Productivity with mocked data (7 Oct 2026). */
import { createRoot } from "react-dom/client";
import "../styles.css";
import { ThemeProvider } from "../theme/ThemeProvider";
import { RecruiterProductivity } from "../crm/pages/reports/RecruiterProductivity";

const columns = [
  { key: "candidates_added", label: "Added", group: "sourcing", hint: "Candidate records this recruiter created." },
  { key: "applied", label: "Applied", group: "sourcing", hint: "Candidacies raised on a position." },
  { key: "opening_emails", label: "Emails", group: "sourcing", hint: "'Are you interested?' mails sent." },
  { key: "sent_for_screening", label: "Screening", group: "sourcing", hint: "Pushed to Technical Screening." },
  { key: "rmg_shortlisted", label: "Shortlisted", group: "pipeline", hint: "Shortlisted by RMG / GM." },
  { key: "interviews_scheduled", label: "Interviews", group: "pipeline", hint: "AI L1, manual rounds, slot invites." },
  { key: "submitted_to_sales", label: "To Sales", group: "pipeline", hint: "Reached Sales Screening." },
  { key: "to_customer", label: "To customer", group: "pipeline", hint: "Submitted to the customer." },
  { key: "selected", label: "Selected", group: "outcome", hint: "Customer shortlisted." },
  { key: "joined", label: "Joined", group: "outcome", hint: "Joined." },
  { key: "rejected", label: "Closed", group: "outcome", hint: "Closed at any stage." },
  { key: "days_active", label: "Active days", group: "pace", hint: "Distinct days with a sourcing action." },
  { key: "per_day_avg", label: "Per day", group: "pace", hint: "Applied ÷ working days." },
];
const row = (id: number, name: string, username: string, is_ta: boolean, v: number[]) => ({
  user_id: id, name, username, is_ta,
  candidates_added: v[0], applied: v[1], opening_emails: v[2], sent_for_screening: v[3], rmg_shortlisted: v[4],
  interviews_scheduled: v[5], submitted_to_sales: v[6], to_customer: v[7], selected: v[8], joined: v[9], rejected: v[10],
  days_active: v[11], per_day_avg: v[1] / 5,
});
const rows = [
  row(1, "Sweety Falke", "sweety.falke@karnex.in", true, [38, 42, 30, 25, 9, 7, 5, 3, 1, 0, 6, 5]),
  row(2, "Mohammed Suhel", "mohammed.suhel@karnex.in", true, [12, 18, 10, 14, 6, 5, 4, 2, 1, 1, 2, 4]),
  row(3, "Gargee Joshi", "gargee.joshi@karnex.in", true, [9, 11, 0, 8, 2, 3, 1, 1, 0, 0, 1, 3]),
  row(4, "Neelam Singh", "neelam.singh@karnex.in", true, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  row(5, "Pavan Sanap", "pawan_sanap", false, [3, 2, 0, 1, 0, 2, 0, 0, 0, 0, 0, 2]),
];
(window as any).fetch = async () => new Response(JSON.stringify({
  success: true, data: rows,
  meta: { window: { from: "2026-10-01", to: "2026-10-07", explicit_from: true }, working_days: 5, columns },
}), { status: 200, headers: { "content-type": "application/json" } });
try { localStorage.setItem("authToken", "x"); localStorage.setItem("authTokenExpiryIst", "2099-01-01T00:00:00+05:30"); } catch { /* ignore */ }
createRoot(document.getElementById("root")!).render(
  <ThemeProvider><div className="p-4"><RecruiterProductivity /></div></ThemeProvider>);
