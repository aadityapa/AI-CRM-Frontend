/** HR's offered CTC (30 Sep 2026) — the figure HR records at Pre-Onboarding.
 *
 *  The server puts `hr_offer` on the profile detail for HR / Admin / CEO ONLY,
 *  so the field can never render for anyone else; `editable` / `edit_block`
 *  are the server's stage window (Pre-Onboarding). Stored in annual rupees.
 *  Shown as one card in the profile's Overview ▸ Commercials block (the
 *  separate tab was removed the same day, user decision). */
export type HrOffer = {
  offered_ctc: number | null;
  offered_at: string | null;
  offered_by: number | null;
  offered_by_name: string | null;
  note: string | null;
  editable: boolean;
  edit_block: string | null;
  stage: string;
  expected_ctc: number | null;
  current_ctc: number | null;
  approved_ctc: number | null;
  approved_offer_date: string | null;
  approved_joining_date: string | null;
  offer_letter_reference: string | null;
};

/** Stages at which the card is shown at all (mirror of B-V2 hr_offer.VISIBLE_STAGES). */
export const HR_OFFER_STAGES = new Set(["HR_Screening", "HR_Interviewing", "Preboarding", "Joined"]);

/** Whether this login gets the field for this profile — the server decides WHO
 *  (`hr_offer` present), the stage decides WHEN. PURE. */
export function hrOfferVisible(detail: { hr_offer?: HrOffer | null; pipeline_status: string }): boolean {
  return !!detail.hr_offer && HR_OFFER_STAGES.has(detail.pipeline_status);
}
