/**
 * Reports for an employee-only login (25 Nov 2026).
 *
 * User report with a screenshot: an employee (Employee + Interviewer) pressed
 * Reports in the top bar and got every candidate's AI interview report. An
 * employee reads only their OWN interviews — the same list and learning report
 * as My Workspace ▸ AI interviews (`/api/my-workspace/interviews`, the caller's
 * record only). The staff report endpoints refuse such a login as well
 * (B-V2 `services/employee_scope.PLATFORM_REFUSAL`).
 */
import { Sparkles } from "lucide-react";
import { MyInterviewReports } from "../crm/components/workspace/EmployeePortal";

export function MyAiReportsPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 px-4 py-6 sm:px-6">
      <header className="relative overflow-hidden rounded-card bg-gradient-to-br from-fuchsia-600 via-purple-600 to-indigo-700 p-5 text-[#fff] shadow-raised">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-[#fff]/15 ring-1 ring-[#fff]/25">
            <Sparkles size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#fff]/75">Reports</p>
            <h1 className="text-2xl font-bold leading-tight">My AI interview reports</h1>
            <p className="mt-1 max-w-3xl text-sm text-[#fff]/85">
              Only your own interviews — the score for each, what went well, what to work on and every question
              with what a good answer covers. Nobody else's reports are shown here.
            </p>
          </div>
        </div>
      </header>
      <MyInterviewReports />
    </div>
  );
}
