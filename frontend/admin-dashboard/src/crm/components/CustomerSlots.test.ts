/**
 * The slot card prints exactly the IST wall clock Sales typed (29 Sep 2026
 * redesign) — no zone conversion, whatever zone the browser is in.
 */
import { describe, it, expect } from "vitest";

import { offerFor, slotParts } from "./CustomerSlots";

describe("slotParts", () => {
  it("splits the stored wall clock into the card's parts", () => {
    expect(slotParts("2026-09-30T10:00")).toEqual({ weekday: "Wed", day: "30", month: "Sep", time: "10:00 AM" });
    expect(slotParts("2026-10-01T15:30")).toEqual({ weekday: "Thu", day: "1", month: "Oct", time: "3:30 PM" });
    expect(slotParts("2026-10-02T00:05")?.time).toBe("12:05 AM");
    expect(slotParts("2026-10-02T12:00")?.time).toBe("12:00 PM");
  });

  it("returns null for a slot whose time never parsed", () => {
    expect(slotParts(null)).toBeNull();
    expect(slotParts("next Tuesday")).toBeNull();
  });
});

describe("offerFor", () => {
  const offer = { kind: "Customer_L2", interviewer: null, duration_minutes: null, note: null, proposed_at: null,
    slots: [{ scheduled_at: "2026-09-30T10:00", label: "x", meeting_link: null }] };
  it("only an offer for THIS round", () => {
    expect(offerFor(offer, "Customer_L2")).toBe(offer);
    expect(offerFor(offer, "Customer_Interview")).toBeNull();
    expect(offerFor({ ...offer, slots: [] }, "Customer_L2")).toBeNull();
  });
});
