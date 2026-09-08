import { describe, expect, it } from "vitest";
import {
  calculateBillingBases,
  calculateCtcSlabRow,
  calculateRfiValue,
  resolveRfiPeriodMonths,
  validateCtcExperience,
} from "./ctcSlab";

const base = {
  opportunityType: "T&M",
  hoursPerDay: 8,
  holidays: 10,
  weekoff: 104,
  leave: 24,
  holidaysBillable: false,
  weekoffBillable: false,
  leaveBillable: false,
};

describe("Candidate CTC Slab calculations", () => {
  it("derives billing days and hours using only non-billable deductions", () => {
    expect(calculateBillingBases(base)).toEqual({
      actualBillingDays: 227,
      actualBillingHours: 1816,
    });
    expect(calculateBillingBases({ ...base, holidaysBillable: true })).toEqual({
      actualBillingDays: 237,
      actualBillingHours: 1896,
    });
  });

  it("derives hours from billing days × hours/day — the branch cap never replaces it (P1 fix, 27 Aug 2026)", () => {
    // The old behaviour substituted maxBillableHoursMonth × 12 (176 × 12 =
    // 2112) for the calendar derivation. That rule existed ONLY in the form —
    // the server (opportunity_ctc.py) stores calendar-derived figures — so
    // the screen promised ~16% more revenue than the DB saved. Hours now
    // ALWAYS equal days × hours/day, with or without a cap.
    const allBillable = {
      ...base,
      holidaysBillable: true,
      weekoffBillable: true,
      leaveBillable: true,
    };
    expect(calculateBillingBases(allBillable).actualBillingHours).toBe(2920); // 365 × 8
    expect(
      calculateBillingBases({ ...allBillable, maxBillableHoursMonth: 176 }).actualBillingHours,
    ).toBe(2920); // cap ignored for the revenue basis
    expect(
      calculateBillingBases({ ...base, maxBillableHoursMonth: 176 }).actualBillingHours,
    ).toBe(1816); // 227 days × 8 — matches what the server stores
    expect(
      calculateBillingBases({ ...allBillable, maxBillableHoursMonth: 0 }).actualBillingHours,
    ).toBe(2920);
    // Revenue chain from the calendar hours: Monthly = 1414.77 × 2920 ÷ 12.
    const row = calculateCtcSlabRow(
      { rate: 1414.77, management_cost_pct: 30, hike_pct: 10 },
      { ...allBillable, billingType: "Per Hour", maxBillableHoursMonth: 176 },
    );
    expect(row.revenue_annual).toBe(4131128.4); // 1414.77 × 2920
    expect(row.revenue_monthly).toBe(344260.7); // annual ÷ 12
  });

  it.each([
    ["Per Hour", 100, 181600, 15133.33],
    ["Per Day", 100, 22700, 1891.67],
    ["Per Month", 10000, 120000, 10000],
    ["Per Year", 120000, 120000, 10000],
  ])("calculates %s revenue", (billingType, rate, annual, monthly) => {
    const row = calculateCtcSlabRow(
      { rate, management_cost_pct: 30, hike_pct: 10 },
      { ...base, billingType },
    );
    expect(row.revenue_annual).toBe(annual);
    expect(row.revenue_monthly).toBe(monthly);
    expect(row.engineering_budget).toBe(Math.round(annual * 0.7 * 100) / 100);
    expect(row.approved_ctc_lac).toBe(
      Math.round((annual * 0.7 / 1.1 + Number.EPSILON) * 100) / 100,
    );
  });

  it("does not prorate Per Month by billing days", () => {
    const row = calculateCtcSlabRow(
      { rate: 15000 },
      { ...base, billingType: "Per Month", holidays: 300 },
    );
    expect(row.revenue_annual).toBe(180000);
    expect(row.revenue_monthly).toBe(15000);
  });

  it.each([
    ["Work_Package", 120000, undefined, 120000],
    ["Fixed_Price", 60000, 6, 120000],
    ["Retainer", 10000, undefined, 120000],
  ])("calculates %s without hidden billing hours", (opportunityType, rate, duration, annual) => {
    const row = calculateCtcSlabRow(
      { rate },
      {
        opportunityType,
        projectDurationMonths: duration,
        billingType: "Per Hour",
        hoursPerDay: 999,
      },
    );
    expect(row.revenue_annual).toBe(annual);
    expect(row.revenue_monthly).toBe(10000);
  });

  it("recalculates and clears stale values when opportunity type changes", () => {
    const tm = calculateCtcSlabRow({ rate: 100 }, { ...base, billingType: "Per Hour" });
    expect(tm.revenue_annual).toBe(181600);

    const workPackage = calculateCtcSlabRow(tm, {
      opportunityType: "Work_Package",
      billingType: "Per Hour",
      hoursPerDay: 8,
    });
    expect(workPackage.revenue_annual).toBe(100);
    expect(workPackage.revenue_monthly).toBe(8.33);

    const unknown = calculateCtcSlabRow(workPackage, { opportunityType: "" });
    expect(unknown.revenue_annual).toBe("");
    expect(unknown.revenue_monthly).toBe("");
  });

  it("treats blank cost percentages as zero", () => {
    const row = calculateCtcSlabRow(
      { rate: 120000, management_cost_pct: "", hike_pct: "" },
      { ...base, billingType: "Per Year" },
    );
    expect(row.engineering_budget).toBe(120000);
    expect(row.approved_ctc_lac).toBe(120000);
  });

  it("returns blank outputs instead of NaN when rate or required hours are missing", () => {
    const noRate = calculateCtcSlabRow({}, { ...base, billingType: "Per Day" });
    expect(noRate.revenue_annual).toBe("");
    expect(noRate.approved_ctc_lac).toBe("");

    const noHours = calculateCtcSlabRow(
      { rate: 100 },
      { ...base, hoursPerDay: "", billingType: "Per Hour" },
    );
    expect(noHours.revenue_annual).toBe("");
  });

  it("accepts zero rate and guards a zero approved-CTC denominator", () => {
    const zero = calculateCtcSlabRow(
      { rate: 0, hike_pct: 0 },
      { ...base, billingType: "Per Year" },
    );
    expect(zero.revenue_annual).toBe(0);
    expect(zero.approved_ctc_lac).toBe(0);

    const invalidHike = calculateCtcSlabRow(
      { rate: 100000, hike_pct: -100 },
      { ...base, billingType: "Per Year" },
    );
    expect(invalidHike.approved_ctc_lac).toBe("");
  });

  it("uses total value for blank fixed duration and blanks output for zero duration", () => {
    const blankDuration = calculateCtcSlabRow(
      { rate: 120000 },
      { opportunityType: "Fixed_Price", projectDurationMonths: "" },
    );
    expect(blankDuration.revenue_annual).toBe(120000);

    const zeroDuration = calculateCtcSlabRow(
      { rate: 120000 },
      { opportunityType: "Fixed_Price", projectDurationMonths: 0 },
    );
    expect(zeroDuration.revenue_annual).toBe("");
    expect(zeroDuration.approved_ctc_lac).toBe("");
  });

  it("derives Exp Max as one year above Exp Min (NEXUS parity, 4 Sep 2026)", () => {
    const row = calculateCtcSlabRow(
      { exp_min: 7, target_exp: 10, rate: 1407.5 },
      { ...base, billingType: "Per Hour" },
    );
    expect(row.exp_max).toBe(8);

    const noMin = calculateCtcSlabRow(
      { exp_min: "", target_exp: 5, rate: 400 },
      { ...base, billingType: "Per Hour" },
    );
    expect(noMin.exp_max).toBe("");

    const nonTm = calculateCtcSlabRow(
      { exp_min: 2, target_exp: 6, rate: 120000 },
      { opportunityType: "Work_Package" },
    );
    expect(nonTm.exp_max).toBe(3);
  });

  it("validates experience ordering", () => {
    expect(validateCtcExperience({ exp_min: 5, exp_max: 3 })).toContain("Exp Min");
    expect(validateCtcExperience({ exp_min: 3, exp_max: 5 })).toBe("");
  });

  it("computes RFI Value = Annual Revenue × (Period / 12) × Positions", () => {
    expect(calculateRfiValue({
      revenueAnnual: 1_200_000,
      periodMonths: 6,
      positionsCount: 2,
    })).toBe(1_200_000);
    expect(calculateRfiValue({
      revenueAnnual: 1_200_000,
      periodMonths: "",
      positionsCount: 2,
    })).toBeNull();
    expect(calculateRfiValue({
      revenueAnnual: "",
      periodMonths: 6,
      positionsCount: 2,
    })).toBeNull();
  });

  it("resolves Fixed_Price period from project_duration_months when T&M duration absent", () => {
    expect(resolveRfiPeriodMonths("Fixed_Price", {
      project_duration_months: 9,
    })).toBe(9);
    expect(resolveRfiPeriodMonths("Fixed_Price", {
      tm_duration_months: 6,
      project_duration_months: 9,
    })).toBe(6);
    expect(resolveRfiPeriodMonths("T&M", {
      project_duration_months: 9,
    })).toBeUndefined();
  });
});
