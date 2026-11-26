/**
 * Opportunities for an employee-only login (26 Nov 2026).
 *
 * User report with screenshots: an employee (Employee + Interviewer) opened
 * Opportunities and saw the Sales pipeline — customers, budgets, the CTC slab and
 * the commercial details. An employee only needs the roles Karnex is hiring for,
 * each with its job description and Apply. So for such a login (`isEmployeeOnlyLogin`)
 * the three Opportunities routes render this page instead, over the employee's own
 * `/api/my-workspace/opportunities` (title + JD + skills — no customer, no money);
 * the server refuses the deal / position endpoints to them as well
 * (B-V2 `services/employee_scope.py`).
 *
 *  - `opportunities`            → every open role
 *  - `opportunities/:id`        → the same list, that deal's role opened
 *  - `requirements/:id`         → the same list, that position opened
 */
import { Briefcase, FileText, Send, Sparkles } from "lucide-react";
import { crmNavigate } from "../router";
import { HERO_BTN, HERO_BTN_SOLID, PageHeader } from "../components/PageHeader";
import { useToast } from "../components/ui";
import { OpenPositions } from "../components/workspace/EmployeePortal";

export function EmployeeOpportunitiesPage({ focus }: { focus?: { requirementId?: number; opportunityId?: number } }) {
  const [toastEl, toast] = useToast();
  return (
    <div className="space-y-4">
      {toastEl}
      <PageHeader
        icon={Briefcase}
        accent="teal"
        eyebrow="Karnex is hiring"
        title="Open positions"
        subtitle="Every role open right now — read the job description and apply with your Karnex resume. Customer and commercial details are not part of an employee's view."
        actions={(
          <>
            <button type="button" className={HERO_BTN} onClick={() => crmNavigate("my-workspace?tab=applications")}>
              <Send size={15} /> My applications
            </button>
            <button type="button" className={HERO_BTN} onClick={() => crmNavigate("my-workspace?tab=interviews")}>
              <Sparkles size={15} /> My AI interviews
            </button>
            <button type="button" className={HERO_BTN_SOLID} onClick={() => crmNavigate("my-workspace?tab=resume")}>
              <FileText size={15} /> My resume
            </button>
          </>
        )}
      />
      <OpenPositions toast={toast} goResume={() => crmNavigate("my-workspace?tab=resume")} focus={focus} />
    </div>
  );
}
