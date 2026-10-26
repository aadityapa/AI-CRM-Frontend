import { describe, expect, it } from "vitest";
import { REOPEN_SPEC, STEP_LOOK, agoText } from "./ReturnedProformasPanel";

describe("returned Proformas board (26 Oct 2026)", () => {
  it("says how long ago Finance returned it", () => {
    expect(agoText(0)).toBe("today");
    expect(agoText(1)).toBe("1 day ago");
    expect(agoText(9)).toBe("9 days ago");
    expect(agoText(null)).toBe("");
  });

  it("has a look for every step the server sends, and the reopen note is optional", () => {
    expect(Object.keys(STEP_LOOK).sort()).toEqual(["correcting", "manual", "reissue", "resubmitted", "to_correct"]);
    expect(REOPEN_SPEC.reason.required).toBe(false);
  });
});
