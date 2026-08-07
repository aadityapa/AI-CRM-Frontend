/**
 * AI L1 outcome, as one table cell.
 *
 * Shared by the Candidate Profiles list and the Opportunity's Applicants table
 * so the two cannot drift — they previously showed no AI status at all, and the
 * one place that did show it (the Resumes tab) showed the raw AI verdict even
 * after a recruiter had overridden it.
 *
 * The rule, in one place: a recruiter's decision outranks the AI's
 * score-threshold verdict, and the AI's verdict stays visible beside it. Both
 * are facts, and a candidate selected at 57.2% should still visibly be a 57.2%
 * candidate.
 */
import { Bot, UserCheck } from "lucide-react";

export type AiInterviewFields = {
  ai_interview_status?: string | null;
  ai_interview_result?: string | null;
  ai_overall_score_percent?: number | null;
  ai_hr_decision?: string | null;
  ai_hr_decision_label?: string | null;
  ai_effective_result?: string | null;
  ai_is_overridden?: boolean;
  ai_report_link?: string | null;
};

/** Tone per verdict. Kept deliberately small — anything unknown reads neutral. */
function toneFor(value: string): string {
  const v = value.toLowerCase();
  if (v.includes("pass") || v.includes("select")) {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
  }
  if (v.includes("fail") || v.includes("reject")) {
    return "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300";
  }
  if (v.includes("hold") || v.includes("pending") || v.includes("review")) {
    return "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300";
  }
  return "bg-surface-2 text-secondary";
}

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
   * `full` — standalone. Shows the verdict, the score, and the AI's own
   *   verdict when a recruiter overrode it. Used on the Opportunity
   *   applicants table, where nothing else displays the score.
   *
   * `beside-score` — a ScoreIndicator is already next to this. It renders ONLY
   *   what the ring cannot say: the human decision. Without this the cell read
   *   "57 Moderate · Selected 57.2% · AI: Failed" — the score twice and three
   *   competing verdicts in one table cell.
   */
  variant?: "full" | "beside-score";
}) {
  const overrideLabel = row.ai_hr_decision_label;
  const aiVerdict = row.ai_interview_result || row.ai_interview_status;
  const score = fmtScore(row.ai_overall_score_percent);

  // No link row at all — the candidate has never been scheduled for an AI
  // interview. Distinct from "scheduled but not finished", which reads Pending.
  if (!overrideLabel && !aiVerdict) {
    return variant === "beside-score" ? null : <span className="text-xs text-muted">Not scheduled</span>;
  }

  const shown = overrideLabel || aiVerdict || "";
  const tooltip = row.ai_is_overridden
    ? `A recruiter marked this ${overrideLabel}. The AI recorded ${aiVerdict}${score ? ` at ${score}` : ""}.`
    : `AI L1 ${aiVerdict}${score ? ` at ${score}` : ""}`;

  if (variant === "beside-score") {
    // The ring already states the score and its tier. A pass/fail verdict that
    // simply restates "57 is below 60" adds nothing, so only a HUMAN decision
    // earns space here — that is the one thing the ring cannot express.
    if (!overrideLabel) return null;
    return (
      <span
        className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneFor(overrideLabel)}`}
        title={tooltip}
      >
        <UserCheck size={10} aria-hidden />
        {overrideLabel}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className="inline-flex items-center gap-1.5">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${toneFor(shown)}`}
          title={tooltip}
        >
          {overrideLabel ? <UserCheck size={11} /> : <Bot size={11} />}
          {shown}
        </span>
        {score && (
          <span className="text-xs font-bold tabular-nums text-primary">{score}</span>
        )}
      </span>
      {row.ai_is_overridden && (
        <span className="text-[11px] text-muted">AI: {aiVerdict}</span>
      )}
    </span>
  );
}
