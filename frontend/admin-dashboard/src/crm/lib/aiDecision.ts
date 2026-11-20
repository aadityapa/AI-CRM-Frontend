/**
 * The AI L1 status every screen prints (18 Nov 2026, user rule).
 *
 * The AI scores the interview; a PERSON decides. Until RMG / GM press
 * Selected / Rejected / On Hold, a finished AI L1 reads "In Review" — the
 * AI's own Passed / Failed (score vs the pass mark) is shown only as a
 * suggestion beside it. The server already sends `ai_effective_result` this
 * way; these helpers also cover older payloads that still carry the raw verdict.
 */

export const AI_IN_REVIEW = "In Review";

/** The AI's raw verdicts — advice, never the status. */
const AI_RAW_VERDICTS = new Set(["Passed", "Failed", "Completed"]);
/** Labels a recruiter's decision may carry. */
const DECIDED = new Set(["Selected", "Rejected", "On Hold"]);
/** Every word that is an AI L1 STATUS once the interview finished. */
export const AI_DECISION_WORDS: ReadonlySet<string> = new Set([AI_IN_REVIEW, "Selected", "Rejected", "On Hold"]);

export interface AiDecisionFields {
  ai_hr_decision?: string | null;
  ai_hr_decision_label?: string | null;
  ai_effective_result?: string | null;
  ai_interview_result?: string | null;
  ai_interview_status?: string | null;
  ai_suggestion?: string | null;
  ai_not_attempted?: boolean | null;
}

/** "In Review" · "Selected" · "Rejected" · "On Hold" · "Pending" · … or null (no AI L1). PURE. */
export function aiDecisionLabel(r: AiDecisionFields): string | null {
  const decided = r.ai_hr_decision_label || "";
  if (DECIDED.has(decided)) return decided;
  if (decided === "Pending Review" || decided === AI_IN_REVIEW) return AI_IN_REVIEW;
  const eff = r.ai_effective_result || "";
  if (eff) {
    if (DECIDED.has(eff)) return eff;
    if (AI_RAW_VERDICTS.has(eff) || eff === "Pending Review") return AI_IN_REVIEW;
    return eff;
  }
  const raw = r.ai_interview_result || r.ai_interview_status || "";
  if (!raw) return null;
  return AI_RAW_VERDICTS.has(raw) ? AI_IN_REVIEW : raw;
}

/** True once a person (RMG / GM) has selected, rejected or held it. PURE. */
export function aiIsDecided(r: AiDecisionFields): boolean {
  return DECIDED.has(aiDecisionLabel(r) || "");
}

/** The AI's own read, as advice: "pass" / "below the pass mark" — or null. PURE. */
export function aiSuggestion(r: AiDecisionFields): string | null {
  if (r.ai_not_attempted) return null;
  const s = r.ai_suggestion || (AI_RAW_VERDICTS.has(r.ai_interview_result || "") ? r.ai_interview_result : null);
  if (s === "Passed") return "AI suggests: above the pass mark";
  if (s === "Failed") return "AI suggests: below the pass mark";
  return null;
}

/** Chip colours by the decision. PURE. */
export function aiDecisionTone(label: string | null | undefined): string {
  const v = (label || "").toLowerCase();
  if (v.includes("select") || v.includes("pass")) {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
  }
  if (v.includes("reject") || v.includes("fail")) {
    return "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300";
  }
  if (v.includes("review")) {
    return "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300";
  }
  if (v.includes("hold") || v.includes("pending") || v.includes("not attempted")) {
    return "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300";
  }
  return "bg-surface-2 text-secondary";
}
