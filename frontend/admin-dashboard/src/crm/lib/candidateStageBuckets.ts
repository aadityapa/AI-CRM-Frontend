/**
 * Stage filter chips for candidate lists (Applied Candidates, the
 * opportunity's Applicants) — ONE definition, so both lists offer the same
 * chips under the same names.
 *
 * Each chip is a STAGE key from the server (B-V2 `services/candidate_status.
 * STAGES`, sent as `?phase=`): the phase a candidate sits in, derived from the
 * stored stage + RMG screening + booked rounds (28 Sep 2026). The first three
 * share one stored stage, which is why the chip cannot be a stage list. The
 * labels are the words the Stage column prints. "Closed" holds every
 * rejected / withdrawn candidacy; the other chips are live candidates only.
 */
export type StageBucket = { key: string; label: string };

export const CANDIDATE_STAGE_BUCKETS: StageBucket[] = [
  { key: "all", label: "All" },
  { key: "sourcing", label: "Sourcing" },
  { key: "technical_screening", label: "Technical Screening" },
  { key: "technical_interview", label: "Technical Interview" },
  { key: "sales_screening", label: "Sales Screening" },
  { key: "customer_screening", label: "Customer Screening" },
  { key: "customer_interviewing", label: "Customer Interviewing" },
  { key: "selection", label: "Customer Shortlisted" },
  { key: "hr_screening", label: "HR Screening" },
  { key: "onboarding", label: "Onboarding" },
  { key: "closed", label: "Closed" },
];

/** ONE colour per stage — the Stage column badge and the filter chip above it
 *  wear the same colour, so the chips read as the column's legend (28 Sep
 *  2026, user ask: "the filters must line up with the Stage column"). */
export const STAGE_TONE: Record<string, string> = {
  sourcing: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  technical_screening: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  technical_interview: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300",
  sales_screening: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  customer_screening: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300",
  customer_interviewing: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  selection: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  hr_screening: "bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300",
  onboarding: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
  closed: "bg-surface-2 text-muted",
  all: "bg-surface-1 text-secondary",
};

/** The `?phase=` value a chip sends — undefined for "All". */
export function bucketPhase(key: string): string | undefined {
  return key && key !== "all" && CANDIDATE_STAGE_BUCKETS.some((b) => b.key === key) ? key : undefined;
}
