/**
 * Interview-round vocabulary shared by every screen that shows rounds (28 Sep
 * 2026): the Applied Candidates Rounds column, the interviews pop-up, the
 * Screening Desk ladder and the Dashboard's "My work" desk. Kinds mirror B-V2
 * `services/interview_rounds.ROUNDS`.
 */

/** Round kind → the name every screen uses for it. */
export const ROUND_KIND_LABEL: Record<string, string> = {
  L1_Interview: "Technical L1 Interview",
  L2_F2F: "Technical L2 Interview",
  L3_Interview: "Technical L3 Interview",
  L4_Interview: "Technical L4 Interview",
  Customer_Interview: "Customer L1 Interview",
  Customer_L2: "Customer L2 Interview",
  HR_Interview: "HR Round",
};

/** Who conducted a round of this kind — the `user_role` a verdict is saved with. */
export function roundUserRole(kind: string): string {
  if (kind === "HR_Interview") return "HR";
  if (kind === "Customer_Interview" || kind === "Customer_L2") return "Customer";
  return "RMG";
}

/** The customer's own rounds — Sales carries their verdict back. */
export const CUSTOMER_ROUND_KINDS = ["Customer_Interview", "Customer_L2"] as const;
export const isCustomerRoundKind = (kind?: string | null) =>
  !!kind && (CUSTOMER_ROUND_KINDS as readonly string[]).includes(kind);

/** Who records a customer round's verdict — mirror of B-V2
 *  `interview_followups.CUSTOMER_ROUND_ROLES` ("Sales Manager" is a custom role;
 *  `me.roles` carries custom-role names). */
export const CUSTOMER_ROUND_ROLES = ["Sales", "Sales_Head", "Sales Manager"] as const;

/** A round that did not happen (Cancelled · No Show · Rescheduled …) — mirror
 *  of B-V2 `interview_rounds.NOT_HELD_STATUSES`. */
export const isRoundNotHeld = (status?: string | null) => /cancel|no show|reschedul/i.test(status || "");
/** Assumed length of a round with no duration — B-V2 `DEFAULT_DURATION_MIN`. */
const DEFAULT_DURATION_MIN = 60;

/** A round whose time is over and whose verdict is missing — the SAME rule
 *  the server's feedback-due reminder uses (B-V2 `interview_followups`). */
export function isFeedbackDue(
  e: { result?: string | null; status?: string | null; scheduled_at?: string | null; duration_minutes?: number | null },
  now: number = Date.now(),
): boolean {
  if ((e.result || "").trim() || !e.scheduled_at) return false;
  if (isRoundNotHeld(e.status)) return false;
  const start = new Date(e.scheduled_at).getTime();
  if (!Number.isFinite(start)) return false;
  return start + (e.duration_minutes || DEFAULT_DURATION_MIN) * 60_000 <= now;
}

/** The slots the customer offered, passed by Sales to TA (B-V2
 *  `candidate_profiles.latest_customer_slots`). `scheduled_at` is the IST wall
 *  clock "YYYY-MM-DDTHH:MM" — ready for a datetime-local field — or null when
 *  Sales typed something that is not a date (then `label` is what they typed). */
export type CustomerSlotOffer = {
  kind: string;
  slots: { scheduled_at: string | null; label: string; meeting_link: string | null }[];
  interviewer: string | null;
  duration_minutes: number | null;
  note: string | null;
  proposed_at: string | null;
};

/** Colour of a verdict chip — the ONE mapping. */
export function roundResultTone(result: string | null | undefined): string {
  const v = (result || "").toLowerCase();
  if (!v) return "bg-info-soft text-info";
  if (v.includes("not attempted")) return "bg-warning-soft text-warning";   // never happened ≠ failed (7 Oct 2026)
  if (v.includes("no hire") || v.includes("not recommend") || v === "drop" || v.includes("fail") || v.includes("reject")) {
    return "bg-danger-soft text-danger";
  }
  if (v.includes("leaning no") || v.includes("hold")) return "bg-warning-soft text-warning";
  if (v.includes("hire") || v.includes("pass") || v.includes("select") || v.includes("shortlist")) {
    return "bg-success-soft text-success";
  }
  return "bg-surface-2 text-secondary";
}
