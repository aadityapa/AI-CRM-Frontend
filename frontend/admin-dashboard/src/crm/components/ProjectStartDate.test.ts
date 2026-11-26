import { describe, expect, it } from "vitest";

import { startPicks, startProblem, type StartPreview } from "./ProjectStartDate";

describe("startPicks", () => {
  it("offers the 1st of the month and whole months earlier", () => {
    const picks = startPicks("2026-07-15");
    expect(picks.map((p) => p.value)).toEqual(["2026-07-01", "2026-06-01", "2026-04-01", "2026-01-01"]);
    expect(startPicks("2026-07-01").map((p) => p.value)).toEqual(["2026-06-01", "2026-04-01", "2026-01-01"]);
  });
});

describe("startProblem", () => {
  const base: StartPreview = { start_date: "2026-07-01", team: [], new_start: "2026-04-01", direction: "earlier",
    people: [{ project_employee_id: 1, name: "A", from: "2026-07-01", to: "2026-04-01", create: ["Apr 2026"],
      fill: [], remove: [], trim: [], blocked: [], before_window: [], refusal: null }], blocked: [], refusals: [] };
  it("is clear when the server says it can save", () => {
    expect(startProblem(base, 1)).toBeNull();
  });
  it("names what is missing", () => {
    expect(startProblem(base, 0)).toMatch(/Tick/);
    expect(startProblem({ ...base, blocked: ["A: Jul 2026 (Approved)"] }, 1)).toMatch(/blocks/);
    expect(startProblem({ ...base, refusals: ["A left on 31 Aug 2026"] }, 1)).toMatch(/left/);
    expect(startProblem(null, 1)).toMatch(/Pick/);
  });
});
