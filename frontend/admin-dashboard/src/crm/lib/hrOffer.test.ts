import { describe, expect, it } from "vitest";
import { hrOfferVisible, type HrOffer } from "./hrOffer";

const offer: HrOffer = {
  offered_ctc: null, offered_at: null, offered_by: null, offered_by_name: null, note: null,
  editable: true, edit_block: null, stage: "Preboarding",
  expected_ctc: 1_400_000, current_ctc: 1_200_000, approved_ctc: 1_500_000,
  approved_offer_date: null, approved_joining_date: null, offer_letter_reference: null,
};

describe("hrOfferVisible", () => {
  it("needs the server's hr_offer (HR only) AND a stage with HR", () => {
    expect(hrOfferVisible({ hr_offer: offer, pipeline_status: "Preboarding" })).toBe(true);
    expect(hrOfferVisible({ hr_offer: offer, pipeline_status: "Joined" })).toBe(true);
    expect(hrOfferVisible({ hr_offer: null, pipeline_status: "Preboarding" })).toBe(false);
    expect(hrOfferVisible({ hr_offer: offer, pipeline_status: "Sales_Screening" })).toBe(false);
  });
});
