import { describe, expect, it } from "vitest";
import { currentFyStart, ledgerRange, ledgerRangeProblem } from "./ledgerPeriod";

describe("ledger period", () => {
  it("financial year runs April to March", () => {
    expect(currentFyStart(new Date(2026, 1, 10))).toBe(2025);
    expect(currentFyStart(new Date(2026, 3, 1))).toBe(2026);
    expect(ledgerRange({ mode: "fy", fy: 2026, month: "", from: "", to: "" })).toMatchObject(
      { from: "2026-04-01", to: "2027-03-31", label: "FY 2026-27" });
  });
  it("a month ends on its last day, February included", () => {
    expect(ledgerRange({ mode: "month", fy: 2026, month: "2027-02", from: "", to: "" })).toMatchObject(
      { from: "2027-02-01", to: "2027-02-28" });
  });
  it("custom and all time", () => {
    expect(ledgerRange({ mode: "custom", fy: 0, month: "", from: "2026-05-01", to: "" }).from).toBe("2026-05-01");
    expect(ledgerRange({ mode: "all", fy: 0, month: "", from: "x", to: "y" })).toMatchObject({ from: "", to: "" });
    expect(ledgerRangeProblem({ mode: "custom", fy: 0, month: "", from: "2026-06-01", to: "2026-05-01" })).toBeTruthy();
  });
});
