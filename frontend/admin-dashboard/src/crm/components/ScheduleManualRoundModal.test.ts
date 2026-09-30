/** The schedule dialog's pure helpers (30 Sep 2026). */
import { describe, expect, it } from "vitest";

import { meetingProvider, quickTimes } from "./ScheduleManualRoundModal";

describe("ScheduleManualRoundModal helpers", () => {
  it("offers today only before 3 PM, then tomorrow and next Monday, as datetime-local values", () => {
    const morning = quickTimes(new Date(2026, 8, 30, 10, 0));   // Wed 30 Sep 2026
    expect(morning.map((p) => p.label)).toEqual(["Today 4:00 PM", "Tomorrow 11:00 AM", "Tomorrow 3:00 PM", "Next Monday 11:00 AM"]);
    expect(morning[0].value).toBe("2026-09-30T16:00");
    expect(morning[3].value).toBe("2026-10-05T11:00");
    const evening = quickTimes(new Date(2026, 8, 30, 18, 0));
    expect(evening[0].label).toBe("Tomorrow 11:00 AM");
  });

  it("names the meeting provider from the link, nothing for a bare string", () => {
    expect(meetingProvider("https://teams.microsoft.com/l/meetup-join/x")).toBe("Microsoft Teams");
    expect(meetingProvider("https://meet.google.com/abc-defg-hij")).toBe("Google Meet");
    expect(meetingProvider("https://us02web.zoom.us/j/123")).toBe("Zoom");
    expect(meetingProvider("https://example.com/room")).toBe("Video call");
    expect(meetingProvider("teams link")).toBeNull();
  });
});
