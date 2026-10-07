import { createRoot } from "react-dom/client";
import "../styles.css";
import { ThemeProvider } from "../theme/ThemeProvider";
import { CrmMeProvider } from "../crm/CrmApp";
import { ResumesTab } from "../crm/pages/Requirements";
import catalogue from "./catalogue.json";

const req: any = { id: 82, req_number: "REQ-0082", opportunity_id: 87, opportunity_opp_id: "C-2026-00087",
  customer_id: 60, customer_name: "Harman", title: "Senior non-AUTOSAR engineer", description: "", no_of_positions: 1,
  experience_min: 5, experience_max: 9, budget_ctc_min: 1200000, budget_ctc_max: 1800000, work_mode: "Onsite",
  location_id: null, priority: "High", target_closure_date: null, status: "In_Progress", created_by: 1,
  sales_head_approved_by: null, sales_head_approved_at: null, sales_head_rejection_reason: null,
  engineering_reviewed_by: null, engineering_reviewed_at: null, engineering_rejection_reason: null,
  created_at: null, updated_at: null, skills: [] };
const st = (key: string, stage: string, sl: string, rk: string | null, rl: string, rs: string | null, tone = "warn", label = rl) =>
  ({ key, label, tone, group: "internal", hint: "", stage: { key: stage, label: sl }, round: { key: rk, label: rl, state: rs } });
const day = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
const row = (id: number, name: string, extra: object) => ({ id, candidate_id: id, requirement_id: 82, candidate_name: name,
  email: `${name.toLowerCase().replace(/ /g, ".")}@example.com`, phone: "+91 98765 43210", applied_by: "Neelam Singh",
  profile_id: 100 + id, received_date: day(20), created_at: day(20), ats_score: 72, ats_status: "Shortlisted",
  rmg_screening_status: "Shortlisted", profile_pipeline_status: "Sourcing", resume_file_url: "/x.pdf", rounds_booked: 1, rounds_done: 0, ...extra });
const live = [
  row(1, "Akshay Dhankar", { profile_status: st("manual_l1_scheduled", "technical_interview", "Technical Interview", "manual_l1", "Technical L1 Interview", "Scheduled"),
    l1_manual_requested: true, l1_manual_scheduled: true, l1_manual_when: day(-2), l1_manual_interviewer: "Suresh Kumar", waiting_days: 4, waiting_since: day(4) }),
  row(2, "Shubham Chodankar", { profile_status: st("manual_l1_pending", "technical_interview", "Technical Interview", "manual_l1", "Technical L1 Interview", "Yet to Schedule", "neutral"),
    l1_manual_requested: true, waiting_days: 9, waiting_since: day(9), over_budget: true, expected_ctc: 2200000, budget_ctc_max: 1800000 }),
  row(3, "Ganesh Kumar T", { profile_status: st("customer_l1_passed", "customer_interviewing", "Customer Interviewing", "customer_l1", "Customer L1 Interview", "Passed", "ok"),
    profile_pipeline_status: "L1_Feedback", cust_l1_scheduled: true, cust_l1_when: day(3), cust_l1_interviewer: "Ravi Menon (Harman)", cust_l1_result: "Hire", rounds_booked: 3, rounds_done: 3, waiting_days: 1, waiting_since: day(1) }),
  row(4, "Meera Iyer", { profile_status: st("ai_l1_scheduled", "technical_interview", "Technical Interview", "ai_l1", "Technical L1 Interview (AI)", "Scheduled"),
    ai_l1_requested: true, ai_interview_status: "Scheduled", ai_interview_scheduled_at: day(-1), waiting_days: 0, waiting_since: day(0) }),
  row(6, "Rahul Verma", { profile_status: st("ai_l1_not_attempted", "technical_interview", "Technical Interview", "ai_l1", "Technical L1 Interview (AI)", "Not Attempted"),
    ai_l1_requested: true, ai_interview_status: "Failed", ai_interview_result: "Failed", ai_effective_result: "Failed",
    ai_overall_score_percent: 0, ai_not_attempted: true, ai_interview_scheduled_at: day(2), ai_report_link: "/admin/?view=candidateReport&cid=x&iid=y",
    waiting_days: 2, waiting_since: day(2) }),
  row(5, "Priya Nair", { profile_status: { key: "technical_screening", label: "Technical Screening", tone: "warn", group: "screening", hint: "", stage: { key: "technical_screening", label: "Technical Screening" }, round: { key: null, label: "CV Screening", state: "With RMG / GM" } },
    rmg_screening_status: "Pending", rounds_booked: 0, waiting_days: 12, waiting_since: day(12) }),
];
const archive = [
  row(6, "Tanvi G", { profile_status: { key: "rmg_rejected", label: "RMG Rejected", tone: "bad", group: "screening", hint: "", stage: { key: "technical_screening", label: "Technical Screening" }, round: { key: null, label: "RMG Rejected", state: null } },
    rmg_screening_status: "Rejected", profile_pipeline_status: "RMG_Rejected", rounds_booked: 0, waiting_days: 6, waiting_since: day(6) }),
  row(7, "Om Patil", { profile_status: st("customer_l1_failed", "customer_interviewing", "Customer Interviewing", "customer_l1", "Customer L1 Interview", "Failed", "bad"),
    profile_pipeline_status: "Customer_Rejected", cust_l1_when: day(8), cust_l1_interviewer: "Ravi Menon (Harman)", cust_l1_result: "No Hire", rounds_done: 1, waiting_days: 8, waiting_since: day(8) }),
];
const counts = { live: { manual_l1_scheduled: 1, manual_l1_pending: 1, customer_l1_passed: 1, ai_l1_scheduled: 1, ai_l1_not_attempted: 1, technical_screening: 1 },
  archive: { rmg_rejected: 1, customer_l1_failed: 1 }, live_total: 6, archive_total: 2 };
const rounds = [
  { id: 1, kind: "L1_Interview", scheduled_at: day(-2), interviewer: "Suresh Kumar", status: "Scheduled", result: null, feedback: null, duration_minutes: 60, mode: "Online", meeting_link: "https://meet.google.com/abc" },
];
(window as any).fetch = async (url: string) => {
  const u = String(url);
  let body: any = { success: true, data: [] };
  if (u.includes("/status-options")) body = { success: true, data: catalogue };
  else if (u.includes("/resumes?") || u.endsWith("/resumes")) {
    const arch = u.includes("bucket=archive");
    const m = u.match(/status_key=([a-z0-9_]+)/);
    let rows = arch ? archive : live;
    if (m) rows = rows.filter((r: any) => r.profile_status.key === m[1]);
    body = { success: true, data: rows, meta: { page: 1, limit: 10, total: rows.length, pages: 1, status_counts: counts, bucket: arch ? "archive" : "live" } };
  } else if (u.includes("/interview-rounds/options")) body = { success: true, data: { writable_rounds: ["L1_Interview"], results: ["Hire", "No Hire"], hr_results: [], interviewers: [] } };
  else if (u.includes("/interview-rounds")) body = { success: true, data: rounds };
  else if (u.includes("/ai-interviews")) body = { success: true, data: [] };
  else if (u.includes("/table-preferences")) body = { success: true, data: { is_customised: false, columns: [], sort: [], sortable_columns: [], max_sort_levels: 0 } };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
const q = new URLSearchParams(location.search);
window.history.replaceState(null, "", `?view=crm&p=requirements/82&tab=resumes${q.get("sub") ? `&sub=${q.get("sub")}` : ""}${q.get("status") ? `&status=${q.get("status")}` : ""}`);
const me: any = q.get("ta")
  ? { id: 1, username: "ta", full_name: "Neelam Singh", roles: ["TA"], access: { full: true }, approvals: [] }
  : { id: 1, username: "gm", full_name: "Laddagiri", roles: ["GM"], access: { full: true }, approvals: ["profile.rmg_screening"] };
createRoot(document.getElementById("root")!).render(
  <ThemeProvider><CrmMeProvider value={me}><div className="p-4"><ResumesTab req={req} toast={() => {}} onRequirementChanged={() => {}} /></div></CrmMeProvider></ThemeProvider>);
