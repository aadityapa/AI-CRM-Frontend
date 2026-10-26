/**
 * What the report page's Shortlist / On Hold / Reject did to the candidacy
 * (23 Oct 2026, RMG / GM ask: "tell me what happened — will the Archive button
 * come?"). The words come from the server (`crm.message` / `crm.next`); this
 * only colours them and adds the before → after stages.
 */
import { ArrowRight, CheckCircle2, Info, PauseCircle, X, XCircle } from "lucide-react";

import type { HrDecisionOutcome } from "../../api";

type Choice = "shortlist" | "reject" | "on_hold" | null;

const LOOK: Record<string, { box: string; icon: typeof Info; title: string }> = {
  shortlist: { box: "bg-success-soft text-success", icon: CheckCircle2, title: "Shortlisted" },
  reject: { box: "bg-danger-soft text-danger", icon: XCircle, title: "Rejected" },
  on_hold: { box: "bg-warning-soft text-warning", icon: PauseCircle, title: "On hold" },
  clear: { box: "bg-surface-2 text-secondary", icon: Info, title: "Decision cleared" },
};

/** "RMG_Rejected" → "RMG Rejected". PURE. */
export function stageWords(value: string | null | undefined): string {
  return String(value || "").replace(/_/g, " ").trim();
}

export function DecisionOutcomeBanner({
  outcome,
  onClose,
}: {
  outcome: HrDecisionOutcome & { choice: Choice };
  onClose: () => void;
}) {
  const look = LOOK[outcome.choice || "clear"];
  const Icon = look.icon;
  return (
    <div role="status" className={`rounded-card border border-subtle px-4 py-3 ${look.box}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
            <span>{look.title} — what happened to the candidacy</span>
            {outcome.moved && outcome.status_before && outcome.status_after ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-1 px-2 py-0.5 text-xs font-semibold text-primary">
                {stageWords(outcome.status_before)}
                <ArrowRight className="h-3 w-3" />
                {stageWords(outcome.status_after)}
              </span>
            ) : null}
            {outcome.closed ? (
              <span className="rounded-full bg-surface-1 px-2 py-0.5 text-xs font-semibold text-primary">
                Archive available to TA
              </span>
            ) : null}
          </div>
          <p className="text-sm text-primary">{outcome.message}</p>
          {outcome.next?.length ? (
            <ul className="list-disc pl-5 text-xs text-secondary">
              {outcome.next.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="rounded-control p-1 text-secondary hover:bg-surface-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
