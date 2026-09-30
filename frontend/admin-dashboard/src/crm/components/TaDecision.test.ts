/** TA's row buttons + the feedback-button clock (28 Sep 2026, user flow). */
import { describe, expect, it } from "vitest";

import { roundHasStarted } from "./flowButtons";
import { TA_HOLD, taDecisionsFor } from "./TaDecision";

describe("taDecisionsFor", () => {
  const at = (key: string, extra: Record<string, unknown> = {}) =>
    ({ profile_status: { stage: { key } }, profile_pipeline_status: "Sourcing", ...extra });
  it("offers Technical Screening, Hold and Reject at Sourcing", () => {
    expect(taDecisionsFor(at("sourcing"))).toEqual(["screen", "hold", "reject", "withdraw"]);
  });
  it("offers Release instead of Hold (and no send) while held", () => {
    expect(taDecisionsFor(at("sourcing", { budget_status: TA_HOLD })))
      .toEqual(["release", "reject", "withdraw"]);
  });
  it("follows the DERIVED stage — an L1 already booked is past Sourcing", () => {
    expect(taDecisionsFor(at("technical_interview"))).toEqual(["withdraw"]);
    expect(taDecisionsFor(at("technical_screening"))).toEqual(["withdraw"]);
  });
  it("falls back to the stored stage for an older payload", () => {
    expect(taDecisionsFor({ profile_pipeline_status: "Sourcing" })).toContain("screen");
    expect(taDecisionsFor({ profile_pipeline_status: "RMG_Review" })).toEqual(["withdraw"]);
  });
});

describe("roundHasStarted", () => {
  const now = new Date("2026-09-28T12:00:00+05:30");
  it("locks the verdict until the interview time", () => {
    expect(roundHasStarted("2026-09-28T13:00:00+05:30", now)).toBe(false);
    expect(roundHasStarted("2026-09-28T11:00:00+05:30", now)).toBe(true);
  });
  it("never locks a round with no recorded time", () => {
    expect(roundHasStarted(null, now)).toBe(true);
    expect(roundHasStarted("not a date", now)).toBe(true);
  });
});
