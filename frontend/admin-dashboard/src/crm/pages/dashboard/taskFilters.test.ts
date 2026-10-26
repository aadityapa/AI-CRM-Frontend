import { describe, expect, it } from "vitest";

import { EMPTY_FILTER, facetOptions, filterItems, itemStatus, sectionGroupLabel, statusOf } from "./taskFilters";

const item = (key: string, chip: string, extra: Record<string, unknown> = {}) =>
  ({ key, title: key, subtitle: "", chip, tone: "info" as const, ...extra });

describe("My Tasks Status filter — one status per item (27 Oct 2026)", () => {
  it("collapses day counts into one word", () => {
    expect(statusOf("12 days overdue")).toBe("Overdue");
    expect(statusOf("Unpaid · 10 d overdue")).toBe("Unpaid");
    expect(statusOf("Waiting 4 days")).toBe("Waiting");
    expect(statusOf("Issued 3 d ago")).toBe("Issued");
    expect(statusOf("Ends in 12 d")).toBe("Ending soon");
    expect(statusOf("In 5 days")).toBe("Coming up");
    expect(statusOf("3")).toBe("");
  });

  it("reads the server's status before the chip", () => {
    expect(itemStatus({ status: "Awaiting customer", chip: "Awaiting customer · 10 d overdue" })).toBe("Awaiting customer");
    expect(itemStatus({ status: null, chip: "12 days overdue" })).toBe("Overdue");
    const items = [item("a", "x", { status: "Unpaid" }), item("b", "y", { status: "Awaiting customer" })];
    expect(filterItems(items, { ...EMPTY_FILTER, status: "Unpaid" }).map((i) => i.key)).toEqual(["a"]);
  });

  it("offers no choice that only hidden ticked items hold", () => {
    const items = [item("a", "x", { customer: "Harman" }), item("b", "y", { customer: "Visteon", done: true })];
    expect(facetOptions(items).customers).toEqual(["Harman"]);
    expect(facetOptions(items, "", true).customers).toEqual(["Harman", "Visteon"]);
  });

  it("names the grouping after what the sections are", () => {
    expect(sectionGroupLabel("team_collections")).toBe("By salesperson");
    expect(sectionGroupLabel("sales_terms")).toBe("By step");
    expect(sectionGroupLabel("ta_pending")).toBe("By position");
    expect(sectionGroupLabel("sales_invoices")).toBe("By customer");
  });
});
