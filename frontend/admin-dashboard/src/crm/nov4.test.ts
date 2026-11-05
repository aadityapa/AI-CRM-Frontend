import { describe, expect, it } from "vitest";
import { effectiveType, isCompanyEmail } from "./lib/internalCandidate";
import { isoPlus, monthEnd, releaseDateProblem, remindersLeft } from "./components/ReleasePlanPanel";
import { forecastRows, type ForecastData } from "./pages/dashboard/FinanceForecastPanels";
import { expenseProblem } from "./pages/Expenses";
import { monthlyRateOf } from "./pages/ProjectEmployeeDetail";

describe("internal vs external (4 Nov 2026)", () => {
  it("a karnex.in address is internal unless TA chose otherwise", () => {
    expect(isCompanyEmail("abc@karnex.in")).toBe(true);
    expect(isCompanyEmail("abc@hr.karnex.in")).toBe(true);
    expect(isCompanyEmail("abc@karnex.in.evil.com")).toBe(false);
    expect(effectiveType("", "abc@karnex.in")).toBe("Internal");
    expect(effectiveType("External", "abc@karnex.in")).toBe("External");
    expect(effectiveType(null, "abc@gmail.com")).toBe("External");
  });
});

describe("release / extension", () => {
  it("dates and rules mirror the server", () => {
    const base = new Date(2026, 10, 4);
    expect(isoPlus(base, 30)).toBe("2026-12-04");
    expect(monthEnd(base, 0)).toBe("2026-11-30");
    expect(monthEnd(base, 3)).toBe("2027-02-28");
    expect(remindersLeft(20, [30, 15, 5, 2, 1])).toEqual([15, 5, 2, 1]);
    expect(remindersLeft(0, [30, 15])).toEqual([]);
    expect(releaseDateProblem("release", "", null, null)).toMatch(/Pick/);
    expect(releaseDateProblem("extension", "2027-01-31", null, null)).toMatch(/release date first/);
    expect(releaseDateProblem("extension", "2026-12-01", "2026-12-31", null)).toMatch(/after/);
    expect(releaseDateProblem("release", "2026-12-31", null, "2026-01-05")).toBeNull();
    expect(monthlyRateOf(1200000, "Yearly")).toBe(100000);
    expect(monthlyRateOf(1000, "Hourly")).toBe(168000);
  });
});

describe("finance panels", () => {
  it("forecast rows mark the current bucket", () => {
    const b = { key: "2026-11", label: "Nov 26", kind: "month" as const, start: "", end: "", predicted: 10,
      lost_to_releases: 0, billed_so_far: 2, heads: 1, customers: 1, projects: 1, releasing: 0, current: true };
    const f: ForecastData = { month: [b], quarter: [], fy: [], releases: [], assumptions: "" };
    expect(forecastRows(f, "month")[0]).toMatchObject({ label: "Nov 26 (now)", predicted: 10, customers: 1 });
  });

  it("an expense needs a date, category, description and an amount", () => {
    const ok = { expense_date: "2026-04-03", category: "Travel", description: "Cab", amount: "100" };
    expect(expenseProblem(ok)).toBeNull();
    expect(expenseProblem({ ...ok, amount: "0" })).toMatch(/amount/);
    expect(expenseProblem({ ...ok, description: " " })).toMatch(/for/);
    expect(expenseProblem({ ...ok, expense_date: "2999-01-01" })).toMatch(/future/);
  });
});
