import { describe, expect, it } from "vitest";
import { datesSummary } from "./ProjectClosure";

describe("datesSummary (Edit project ▸ Project Dates)", () => {
  it("open-ended when there is no last working day", () => {
    expect(datesSummary(null).tone).toBe("open");
    expect(datesSummary({ state: "open", end_date: null, reason: null, closed_at: null, closed_by: null, days_left: null }).headline).toBe("Open-ended");
  });
  it("running with days left, closed once the day has gone", () => {
    const run = datesSummary({ state: "scheduled", end_date: "2026-12-31", reason: "PO", closed_at: null, closed_by: null, days_left: 37 }, "2026-11-24");
    expect(run.tone).toBe("scheduled");
    expect(run.detail).toContain("in 37 days");
    const done = datesSummary({ state: "closed", end_date: "2026-06-30", reason: "PO ended", closed_at: "x", closed_by: 1, days_left: null }, "2026-11-24");
    expect(done.tone).toBe("closed");
  });
});
