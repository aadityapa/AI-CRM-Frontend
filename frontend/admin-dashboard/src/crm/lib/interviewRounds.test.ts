import { describe, expect, it } from "vitest";
import { isFeedbackDue, isRoundNotHeld } from "./interviewRounds";

describe("isFeedbackDue — the server's feedback-due rule", () => {
  const now = new Date("2026-09-29T12:00:00+05:30").getTime();
  it("is due once start + duration has passed with no verdict", () => {
    expect(isFeedbackDue({ scheduled_at: "2026-09-29T10:00:00+05:30", duration_minutes: 60 }, now)).toBe(true);
    expect(isFeedbackDue({ scheduled_at: "2026-09-29T11:30:00+05:30", duration_minutes: 60 }, now)).toBe(false);
    // no duration recorded → 60 min assumed
    expect(isFeedbackDue({ scheduled_at: "2026-09-29T11:30:00+05:30" }, now)).toBe(false);
  });
  it("is never due with a verdict, no time, or a round that did not happen", () => {
    expect(isFeedbackDue({ scheduled_at: "2026-09-28T10:00:00+05:30", result: "Hire" }, now)).toBe(false);
    expect(isFeedbackDue({ scheduled_at: null }, now)).toBe(false);
    expect(isFeedbackDue({ scheduled_at: "2026-09-28T10:00:00+05:30", status: "No Show" }, now)).toBe(false);
    expect(isRoundNotHeld("Rescheduled Requested By Panel")).toBe(true);
    expect(isRoundNotHeld("Scheduled")).toBe(false);
  });
});
