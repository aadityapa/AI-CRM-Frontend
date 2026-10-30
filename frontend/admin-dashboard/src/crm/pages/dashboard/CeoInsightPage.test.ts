import { describe, expect, it } from "vitest";
import { filterRows, formatValue, insightLink, rowHas, sortRows, toCsv } from "./CeoInsightPage";

describe("CEO drill-down helpers", () => {
  it("builds the tile link with the dashboard's period and scope", () => {
    expect(insightLink("billed", { anchor_month: "2026-09", kind: "fy" }))
      .toBe("insights/billed?month=2026-09&period=fy");
    expect(insightLink("headcount", { anchor_month: "2026-09", kind: "quarter" }, { scope: "bench", customer_id: 4 }))
      .toContain("scope=bench");
  });

  it("filters by the chosen chip and the search text, never by a link", () => {
    const rows = [
      { invoice: "INV-1", customer: "HARMAN", segment: "paid", link: "invoices/1" },
      { invoice: "INV-2", customer: "APTIV", segment: "unpaid", link: "invoices/2" },
    ];
    expect(filterRows(rows, ["paid"], "")).toHaveLength(1);
    expect(filterRows(rows, [], "aptiv").map((r) => r.invoice)).toEqual(["INV-2"]);
    expect(filterRows(rows, [], "invoices/")).toHaveLength(0);
  });

  it("a clicked tile keeps only the rows its figure comes from", () => {
    const rows = [
      { invoice: "INV-1", received: 0, balance: 1000, overdue_amount: 1000, segment: "unpaid" },
      { invoice: "INV-2", received: 500, balance: 0, overdue_amount: 0, segment: "paid" },
      { invoice: "INV-3", received: 200, balance: 300, overdue_amount: 0, segment: "partially_paid" },
    ];
    expect(filterRows(rows, [], "", "received").map((r) => r.invoice)).toEqual(["INV-2", "INV-3"]);
    expect(filterRows(rows, [], "", "balance").map((r) => r.invoice)).toEqual(["INV-1", "INV-3"]);
    expect(filterRows(rows, [], "", "overdue_amount").map((r) => r.invoice)).toEqual(["INV-1"]);
    expect(rowHas({ x: "0" }, "x")).toBe(false);
    expect(rowHas({ x: "yes" }, "x")).toBe(true);
  });

  it("sorts numbers as numbers and keeps blanks last", () => {
    const rows = [{ v: 5 }, { v: null }, { v: 50 }];
    expect(sortRows(rows, "v", -1).map((r) => r.v)).toEqual([50, 5, null]);
  });

  it("formats and exports safely", () => {
    expect(formatValue(1234567, "money")).toContain("12,34,567");
    expect(formatValue(null, "money")).toBe("—");
    expect(formatValue(12, "days")).toBe("12 d");
    const csv = toCsv([{ key: "a", label: "A", format: "text" }], [{ a: "=SUM(1)" }, { a: "x,y" }]);
    expect(csv).toBe("A\n'=SUM(1)\n\"x,y\"");
  });
});
