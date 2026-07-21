import { describe, expect, it } from "vitest";
import {
  BILLING_TYPE_OPTIONS,
  LEAVE_POLICY_OPTIONS,
  OPPORTUNITY_SCHEMA,
  SALES_STAGE_OPTIONS,
  WFO_REMOTE_OPTIONS,
  WORK_LOCATION_OPTIONS,
} from "./opportunitySchema";

describe("opportunity schema form options", () => {
  it("exposes WFO/Remote options for T&M", () => {
    expect(WFO_REMOTE_OPTIONS.map((o) => o.value)).toEqual(["Remote", "Onsite", "Hybrid"]);
    const tm = OPPORTUNITY_SCHEMA.find((s) => s.key === "timeAndMaterial");
    const field = tm?.fields?.find((f) => f.key === "tm_wfo_remote");
    expect(field?.optionsSource).toBe("wfoRemote");
    expect(field?.visibleFor).toEqual(["T&M"]);
    const workLoc = tm?.fields?.find((f) => f.key === "tm_work_location");
    expect(workLoc?.next).toBe("tm_wfo_remote");
    expect(workLoc?.searchable).toBe(true);
  });

  it("lists major Indian cities for Work Location (searchable)", () => {
    expect(WORK_LOCATION_OPTIONS.length).toBeGreaterThanOrEqual(20);
    expect(WORK_LOCATION_OPTIONS.some((o) => o.value === "Bangalore")).toBe(true);
    expect(WORK_LOCATION_OPTIONS.some((o) => o.value === "Remote")).toBe(true);
    expect(WORK_LOCATION_OPTIONS.every((o) => o.value === o.label)).toBe(true);
    const customer = OPPORTUNITY_SCHEMA.find((s) => s.key === "customerDetails");
    expect(customer?.fields?.find((f) => f.key === "customer_id")?.searchable).toBe(true);
  });

  it("exposes Leave Policy and Billing Type option values", () => {
    expect(LEAVE_POLICY_OPTIONS.map((o) => o.value)).toEqual([
      "Credit Balance Every Month",
      "Carry Forward Every Month",
    ]);
    expect(BILLING_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      "Per Hour",
      "Per Day",
      "Per Month",
      "Per Year",
    ]);
  });

  it("shows Candidate CTC Slab for every opportunity type with calculated columns", () => {
    const slab = OPPORTUNITY_SCHEMA.find((s) => s.key === "ctcSlab");
    expect(slab?.visibleFor).toBeUndefined();
    expect(slab?.table?.columns.map((c) => c.key)).toEqual([
      "exp_min", "exp_max", "target_exp", "rate",
      "revenue_monthly", "revenue_annual", "management_cost_pct",
      "engineering_budget", "hike_pct", "appraisal_cycle", "approved_ctc_lac",
    ]);
    expect(slab?.table?.columns.find((c) => c.key === "revenue_annual")?.computed).toBeTruthy();
    expect(OPPORTUNITY_SCHEMA.some((s) => s.key === "skillEval")).toBe(true);
  });

  it("shows Project Scope for all non-T&M types and fixed duration only for Fixed Price", () => {
    const workPage = OPPORTUNITY_SCHEMA.find((s) => s.key === "workPage");
    expect(workPage?.fields?.find((f) => f.key === "project_scope")?.visibleFor).toEqual([
      "Work_Package", "Fixed_Price", "Retainer",
    ]);
    expect(workPage?.fields?.find((f) => f.key === "project_duration_months")?.visibleFor)
      .toEqual(["Fixed_Price"]);
  });

  it("gates Sales Validation stage for Sales vs non-Sales roles", () => {
    expect(SALES_STAGE_OPTIONS.map((o) => o.value)).toEqual([
      "Sales Validation",
      "Sales Verify",
    ]);
    const forSales = SALES_STAGE_OPTIONS;
    const forNonSales = SALES_STAGE_OPTIONS.filter((o) => o.value !== "Sales Validation");
    expect(forSales.some((o) => o.value === "Sales Validation")).toBe(true);
    expect(forNonSales.some((o) => o.value === "Sales Validation")).toBe(false);
    expect(forNonSales.map((o) => o.value)).toEqual(["Sales Verify"]);
  });
});
