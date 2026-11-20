/**
 * AI L1 outcome, as one table cell.
 *
 * Shared by the Candidate Profiles list and the Opportunity's Applicants table
 * so the two cannot drift.
 *
 * The rule (18 Nov 2026, user): the AI scores, a PERSON decides. A finished AI
 * L1 reads "In Review" until RMG / GM select, reject or hold it; the AI's own
 * pass / fail read is shown underneath as a suggestion, never as the status.
 */
import { Bot, UserCheck } from "lucide-react";
import { aiDecisionLabel, aiDecisionTone, aiIsDecided, aiSuggestion } from "../lib/aiDecision";

export type AiInterviewFields = {
  ai_interview_status?: string | null;
  ai_interview_result?: string | null;
  ai_overall_score_percent?: number | null;
  ai_hr_decision?: string | null;
  ai_hr_decision_label?: string | null;
  ai_effective_result?: string | null;
  ai_suggestion?: string | null;
  ai_not_attempted?: boolean | null;
  ai_is_overridden?: boolean;
  ai_report_link?: string | null;
};

function fmtScore(value?: number | null): string | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `${n % 1 === 0 ? n : n.toFixed(1)}%`;
}

export function AiInterviewCell({
  row,
  variant = "full",
}: {
  row: AiInterviewFields;
  /**
   * `full` — standalone: the status, the score and the AI's suggestion.
   * `beside-score` — a ScoreIndicator is already next to this: only the status.
   */
  variant?: "full" | "beside-score";
}) {
  const shown = row.ai_not_attempted && !aiIsDecided(row) ? "Not attempted" : aiDecisionLabel(row);
  const score = fmtScore(row.ai_overall_score_percent);
  const decided = aiIsDecided(row);
  const suggestion = aiSuggestion(row);

  if (!shown) {
    return variant === "beside-score" ? null : <span className="text-xs text-muted">Not scheduled</span>;
  }

  const tooltip = decided
    ? `RMG / GM marked this ${shown}.${score ? ` AI score ${score}.` : ""}`
    : shown === "In Review"
      ? `The AI interview is done${score ? ` (${score})` : ""}. RMG / GM read the report and decide — Select, Reject or Hold.`
      : `AI L1 ${shown}${score ? ` at ${score}` : ""}`;

  const chip = (
    <span
      className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${aiDecisionTone(shown)}`}
      title={tooltip}
    >
      {decided ? <UserCheck size={11} aria-hidden /> : <Bot size={11} aria-hidden />}
      {shown}
    </span>
  );

  if (variant === "beside-score") {
    // The ring states the score; only the status earns space here.
    return shown === "Pending" ? null : chip;
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className="inline-flex items-center gap-1.5">
        {chip}
        {score && <span className="text-xs font-bold tabular-nums text-primary">{score}</span>}
      </span>
      {suggestion && !decided && <span className="text-[11px] text-muted">{suggestion}</span>}
    </span>
  );
}
