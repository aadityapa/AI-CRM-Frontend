import { describe, expect, it } from "vitest";
import { MONEY_SERIES, moneyDrill, moneyRows, moneyTooltipNote, presetSeries } from "./moneySeries";

describe("money series (6 Nov 2026)", () => {
  it("names the ten series in the CEO's order and every preset lists them all", () => {
    expect(MONEY_SERIES.map((s) => s.label)).toEqual([
      "Revenue (Ex. Tax)", "Revenue (Inc Tax)", "Receivable Bank", "Receivable TDS", "Received Bank",
      "Received TDS", "Due Bank", "Due TDS", "Total Due", "Predicted revenue (project count)",
    ]);
    const due = presetSeries("due");
    expect(due).toHaveLength(10);
    expect(due.filter((s) => !s.defaultOff).map((s) => s.key)).toEqual(["due_bank", "due_tds", "total_due"]);
    expect(presetSeries("overview", false).some((s) => s.key === "predicted")).toBe(false);
  });

  it("falls back to billed / collected for an older server and opens the right drill page", () => {
    const [r] = moneyRows([{ key: "2026-04", label: "Apr 26", billed: 10, collected: 4 }]);
    expect(r.revenue_ex).toBe(10);
    expect(r.received_bank).toBe(4);
    expect(moneyDrill("received_tds")).toBe("collected");
    expect(moneyDrill("total_due")).toBe("outstanding");
    expect(moneyDrill("revenue_inc")).toBe("billed");
  });

  it("the predicted bar names its projects and people", () => {
    expect(moneyTooltipNote({ predicted_projects: 12, predicted_heads: 40 }, "predicted")).toBe("12 projects · 40 people");
    expect(moneyTooltipNote({ predicted_projects: 12 }, "revenue_ex")).toBeNull();
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
