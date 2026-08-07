import { describe, expect, it } from "vitest";
import {
  BILLING_TYPE_OPTIONS,
  LEAVE_POLICY_OPTIONS,
  OPPORTUNITY_SCHEMA,
  SALES_STAGE_OPTIONS,
  WFO_REMOTE_OPTIONS,
  WORK_LOCATION_OPTIONS,
  fieldMatchesShowWhen,
  fieldVisible,
  isFieldShown,
  stripHiddenFields,
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
      "Monthly",
      "Quarterly",
      "Yearly",
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

  it("orders Candidate CTC Slab before Commercial Details", () => {
    const keys = OPPORTUNITY_SCHEMA.map((s) => s.key);
    expect(keys.indexOf("ctcSlab")).toBeLessThan(keys.indexOf("commercial"));
    const rfi = OPPORTUNITY_SCHEMA
      .find((s) => s.key === "commercial")
      ?.fields?.find((f) => f.key === "rfi_value");
    expect(rfi?.computed?.formula).toBe("rfiValue");
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

  it("shows Replacement Engineer only when Position Type is Replacement", () => {
    const tm = OPPORTUNITY_SCHEMA.find((s) => s.key === "timeAndMaterial")!;
    const keys = tm.fields!.map((f) => f.key);
    expect(keys.indexOf("tm_closing_date")).toBeLessThan(keys.indexOf("tm_replacement_engineer"));
    expect(keys.indexOf("tm_replacement_engineer")).toBeLessThan(keys.indexOf("tm_duration_months"));
    const eng = tm.fields!.find((f) => f.key === "tm_replacement_engineer")!;
    expect(eng.searchable).toBe(true);
    expect(eng.optionsSource).toBe("engineers");
    expect(eng.showWhen).toEqual({ field: "tm_position_type", equals: "Replacement" });
    expect(eng.dependsOn).toEqual({ field: "customer_id", hint: "Select a customer first." });
    expect(fieldVisible(tm, eng, "T&M")).toBe(true);
    expect(fieldMatchesShowWhen(eng, {}, { tm_position_type: "New" })).toBe(false);
    expect(fieldMatchesShowWhen(eng, {}, { tm_position_type: "Replacement" })).toBe(true);
    expect(isFieldShown(tm, eng, "T&M", {}, { tm_position_type: "New" })).toBe(false);
    expect(isFieldShown(tm, eng, "T&M", {}, { tm_position_type: "Replacement" })).toBe(true);
    expect(isFieldShown(tm, eng, "Retainer", {}, { tm_position_type: "Replacement" })).toBe(false);
    const strippedNew = stripHiddenFields(
      { tm_position_type: "New", tm_replacement_engineer: "42", tm_role: "Engineer" },
      "T&M",
      {},
      { tm_position_type: "New", tm_replacement_engineer: "42" },
    );
    expect(strippedNew.tm_replacement_engineer).toBeUndefined();
    const strippedRep = stripHiddenFields(
      { tm_position_type: "Replacement", tm_replacement_engineer: "42", tm_role: "Engineer" },
      "T&M",
      {},
      { tm_position_type: "Replacement", tm_replacement_engineer: "42" },
    );
    expect(strippedRep.tm_replacement_engineer).toBe("42");
  });
});
