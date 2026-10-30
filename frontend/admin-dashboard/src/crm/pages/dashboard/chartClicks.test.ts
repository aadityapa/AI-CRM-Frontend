/**
 * 29 Oct 2026 — "every graph should open the data behind it". Pins the pure rules
 * that decide where a clicked bar goes, on the dashboard tabs and the drill pages.
 */
import { describe, expect, it } from "vitest";
import { bucketLink, bucketPeriod, drillBarAction, insightLink } from "./CeoInsightPage";
import { trackerBarPatch } from "./BillingTracker";
import { hiringBarLink } from "./HiringControlTower";
import { seriesAt } from "../../components/controlTower";

describe("bucketPeriod / bucketLink — a bar's month, quarter or FY", () => {
  it("reads the three bucket keys the server sends", () => {
    expect(bucketPeriod("2026-04")).toEqual({ anchor_month: "2026-04", kind: "month" });
    expect(bucketPeriod("2026-Q1")).toEqual({ anchor_month: "2026-04", kind: "quarter" });
    expect(bucketPeriod("2026-Q3")).toEqual({ anchor_month: "2026-10", kind: "quarter" });
    // Q4 of FY 2026-27 is Jan–Mar 2027.
    expect(bucketPeriod("2026-Q4")).toEqual({ anchor_month: "2027-01", kind: "quarter" });
    expect(bucketPeriod("FY2020")).toEqual({ anchor_month: "2021-03", kind: "fy" });
    expect(bucketPeriod("Others (3)")).toBeNull();
    expect(bucketPeriod(undefined)).toBeNull();
  });

  it("opens the same drill page zoomed to the bar, keeping the scope", () => {
    expect(bucketLink("collected", "2026-06", { customer_id: 7 }))
      .toBe("insights/collected?month=2026-06&period=month&customer_id=7");
    expect(bucketLink("billed", "not-a-month")).toBeNull();
    expect(insightLink("stages", { anchor_month: "2026-09", kind: "fy" }, { q: "Customer interview" }))
      .toContain("q=Customer");
  });
});

describe("drillBarAction — a bar on a drill page", () => {
  const segs = [{ key: "overdue", label: "Overdue" }, { key: "paid", label: "Paid" }];
  const here = { month: "2026-09", period: "fy" as const };

  it("opens a row's own link first", () => {
    expect(drillBarAction({ label: "X", link: "customers/4" }, segs, here)).toEqual({ kind: "open", path: "customers/4" });
  });
  it("zooms to a month bar, but not to the month already on screen", () => {
    expect(drillBarAction({ label: "Jun 26", key: "2026-06" }, segs, here))
      .toEqual({ kind: "period", anchor_month: "2026-06", period: "month" });
    expect(drillBarAction({ label: "Sep 26", key: "2026-09" }, segs, { month: "2026-09", period: "month" }))
      .toEqual({ kind: "search", text: "Sep 26" });
  });
  it("picks the status chip of the same name, else searches the table, never for Others", () => {
    expect(drillBarAction({ label: "Overdue" }, segs, here)).toEqual({ kind: "segment", key: "overdue" });
    expect(drillBarAction({ label: "HARMAN" }, segs, here)).toEqual({ kind: "search", text: "HARMAN" });
    expect(drillBarAction({ label: "Others (4)" }, segs, here)).toBeNull();
  });
});

describe("trackerBarPatch — a bar on the Billing Tracker narrows the table", () => {
  it("month bars set the work month and the stage group", () => {
    expect(trackerBarPatch("months", { key: "2026-08" }, "due")).toEqual({ month: "2026-08", stage: "due" });
    expect(trackerBarPatch("months", { key: "2026-08" }, "total")).toEqual({ month: "2026-08", stage: "all" });
  });
  it("lateness and customer bars", () => {
    expect(trackerBarPatch("late", { key: "late_31_60" }, "balance")).toEqual({ late: "late_31_60", stage: "all" });
    expect(trackerBarPatch("customers", { customer_id: 9 }, "paid"))
      .toEqual({ customer: "9", branch: "", project: "", stage: "paid" });
    expect(trackerBarPatch("customers", { label: "—" }, "paid")).toBeNull();
  });
});

describe("hiringBarLink + seriesAt", () => {
  it("opens the role's own lists", () => {
    expect(hiringBarLink("trend", {}, "onboardings")).toBe("profiles?f_stage=joined");
    expect(hiringBarLink("customers", { customer_id: 3 }, "open")).toBe("customers/3");
    expect(hiringBarLink("stages", {}, "waiting")).toBe("profiles");
    expect(hiringBarLink("funnel", {}, "positions")).toBe("opportunities");
  });
  it("a click between bars belongs to the first ticked series with a value", () => {
    expect(seriesAt({ billed: 0, collected: 5 }, ["billed", "collected"])).toBe("collected");
    expect(seriesAt({ billed: 0 }, ["billed"])).toBe("billed");
  });
});
