import { describe, expect, it } from "vitest";
import { daysUntil, releaseSummary, teamPickBlock } from "./ReleasePlanPanel";

describe("release plan helpers (4 Nov 2026)", () => {
  it("counts whole local days to a date", () => {
    const today = new Date(2026, 10, 4);
    expect(daysUntil("2026-11-04", today)).toBe(0);
    expect(daysUntil("2026-12-04", today)).toBe(30);
    expect(daysUntil("2026-11-01", today)).toBe(-3);
    expect(daysUntil(null, today)).toBeNull();
  });

  it("says who a team release / extension cannot apply to", () => {
    const base = { pe_id: 1, employee_name: "Asha", onboarding_date: "2026-01-05" };
    expect(teamPickBlock({ ...base, is_exit: true }, "release", "2026-12-31")).toBe("Already exited");
    expect(teamPickBlock(base, "extension", "2026-12-31")).toBe("No release date to extend");
    expect(teamPickBlock({ ...base, release_date: "2026-12-31" }, "extension", "2026-12-15"))
      .toMatch(/after the current release date/);
    expect(teamPickBlock(base, "release", "2025-12-31")).toMatch(/before the onboarding date/);
    expect(teamPickBlock(base, "release", "2026-12-31")).toBeNull();
    expect(teamPickBlock(base, "release", "")).toBeNull();
  });

  it("names the next planned release on the project band (5 Nov 2026)", () => {
    const today = new Date(2026, 10, 5);
    expect(releaseSummary([{}, { release_date: null }], today)).toEqual({ label: "planned release", value: "None set", planned: 0 });
    const s = releaseSummary([{ release_date: "2026-12-31" }, { release_date: "2026-11-30" }, {}], today);
    expect(s.planned).toBe(2);
    expect(s.label).toBe("next release · 2 of 3");
    expect(s.value).toMatch(/30 Nov 2026 · in 25 d/);
  });
});
