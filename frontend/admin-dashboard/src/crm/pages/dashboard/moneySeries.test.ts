import { describe, expect, it } from "vitest";
import { MONEY_SERIES, moneyDrill, moneyRows, moneyTooltipNote, presetSeries } from "./moneySeries";

describe("money series (6 Nov 2026)", () => {
  it("names the ten series in the CEO's order and every preset lists them all", () => {
    expect(MONEY_SERIES.map((s) => s.label)).toEqual([
      "Revenue (Ex. Tax)", "Revenue (Inc Tax)", "Received (Ex. Tax)", "Due (Ex. Tax)", "Receivable Bank",
      "Receivable TDS", "Received Bank", "Received TDS", "Due Bank", "Due TDS", "Total Due",
      "Predicted revenue (project count)",
    ]);
    const due = presetSeries("due");
    expect(due).toHaveLength(12);
    expect(due.filter((s) => !s.defaultOff).map((s) => s.key)).toEqual(["due_ex", "due_bank", "due_tds", "total_due"]);
    // 20 Nov 2026 — Overview reads on the Ex. Tax basis: Received + Due = Revenue (Ex. Tax).
    expect(presetSeries("overview").filter((s) => !s.defaultOff).map((s) => s.key))
      .toEqual(["revenue_ex", "received_ex", "due_ex", "predicted"]);
    expect(presetSeries("overview", false).some((s) => s.key === "predicted")).toBe(false);
  });

  it("falls back to billed / collected for an older server and opens the right drill page", () => {
    const [r] = moneyRows([{ key: "2026-04", label: "Apr 26", billed: 10, collected: 4 }]);
    expect(r.revenue_ex).toBe(10);
    expect(r.received_bank).toBe(4);
    expect(r.revenue_inc).toBe(0); // never a copy of Ex. Tax (12 Nov 2026)
    const [o] = moneyRows([{ key: "2026-05", label: "May 26", revenue_ex: 100, received_ex: 70 }]);
    expect(o.due_ex).toBe(30); // an older server: the rest of the value before GST is due
    expect(moneyDrill("received_ex")).toBe("collected");
    expect(moneyDrill("due_ex")).toBe("outstanding");
    expect(moneyDrill("received_tds")).toBe("collected");
    expect(moneyDrill("total_due")).toBe("outstanding");
    expect(moneyDrill("revenue_inc")).toBe("billed");
  });

  it("the predicted bar names its projects and people", () => {
    expect(moneyTooltipNote({ predicted_projects: 12, predicted_heads: 40 }, "predicted")).toBe("12 projects · 40 people");
    expect(moneyTooltipNote({ predicted_projects: 12 }, "revenue_ex")).toBeNull();
  });
});

describe("an older server without the split (12 Nov 2026)", () => {
  it("is detected, so the chart shows only what it sent", async () => {
    const { moneySplitMissing } = await import("./moneySeries");
    expect(moneySplitMissing([{ key: "2026-06", label: "Jun 26", billed: 899, collected: 949 }])).toBe(true);
    expect(moneySplitMissing([{ key: "2026-06", label: "Jun 26", revenue_inc: 1060, total_due: 0 }])).toBe(false);
    expect(moneySplitMissing([])).toBe(false);
  });
});

describe("ticks carried from the dashboard to the Billed page (7 Nov 2026)", () => {
  it("reads and writes ?series= in the CEO's order and refuses junk", async () => {
    const { parseSeriesParam, seriesParam, asMoneyKey, presetOf, presetKeys } = await import("./moneySeries");
    expect(parseSeriesParam("total_due,revenue_ex,junk")).toEqual(["revenue_ex", "total_due"]);
    expect(parseSeriesParam("junk")).toBeNull();
    expect(parseSeriesParam(null)).toBeNull();
    expect(seriesParam(["predicted", "revenue_ex"])).toBe("revenue_ex,predicted");
    expect(asMoneyKey("due_tds")).toBe("due_tds");
    expect(asMoneyKey("nope")).toBeNull();
    expect(presetOf(presetKeys("due"))).toBe("due");
    expect(presetOf(["revenue_ex", "due_tds"])).toBeNull();
  });

  it("totals count predicted on every month and the rest only on months already started", async () => {
    const { moneyTotals, shareOf } = await import("./moneySeries");
    const t = moneyTotals([
      { key: "2026-04", label: "Apr 26", revenue_ex: 100, predicted: 90 },
      { key: "2026-12", label: "Dec 26", revenue_ex: 5, predicted: 80, future: true },
    ]);
    expect(t.revenue_ex).toBe(100);
    expect(t.predicted).toBe(170);
    expect(shareOf(25, 100)).toBe(25);
    expect(shareOf(1, 0)).toBeNull();
  });
});
