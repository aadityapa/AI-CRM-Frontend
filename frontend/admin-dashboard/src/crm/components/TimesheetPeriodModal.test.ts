import { describe, expect, it } from "vitest";

import {
  cycleEnd, daysBetween, neighbourEffect, periodChange, periodPresets, periodProblem,
  type Neighbour, type PeriodOptions,
} from "./TimesheetPeriodModal";

describe("timesheet period rules (mirror of the server)", () => {
  it("allows a period that crosses into the previous month", () => {
    expect(periodProblem(2026, 3, "2026-02-20", "2026-03-20")).toBeNull();
    expect(periodProblem(2026, 5, "2026-04-21", "2026-05-30")).toBeNull();
    expect(daysBetween("2026-02-20", "2026-03-20")).toBe(29);
  });

  it("refuses what the server refuses", () => {
    expect(periodProblem(2026, 3, "2026-03-20", "2026-03-01")).toMatch(/before the start/);
    expect(periodProblem(2026, 3, "2026-01-01", "2026-03-31")).toMatch(/at most 62/);
    expect(periodProblem(2026, 3, "2026-02-01", "2026-02-28")).toMatch(/March 2026/);
  });

  it("offers the calendar month and the 21st → 20th cycle", () => {
    const p = periodPresets(2026, 4);
    expect(p.find((x) => x.key === "calendar")).toMatchObject({ start: "2026-04-01", end: "2026-04-30" });
    expect(p.find((x) => x.key === "21-20")).toMatchObject({ start: "2026-03-21", end: "2026-04-20" });
    // January's cycle starts in December of the year before.
    expect(periodPresets(2027, 1).find((x) => x.key === "21-20")).toMatchObject({ start: "2026-12-21" });
    expect(cycleEnd("2026-04-21")).toBe("2026-05-20");
  });

  it("counts the days added and the filled days that would be deleted", () => {
    const entries = [
      { entry_date: "2026-03-01", hours_worked: 8 },
      { entry_date: "2026-03-02", hours_worked: 0 },
      { entry_date: "2026-03-25", hours_worked: 0, leave_type: "Sick Leave" },
    ];
    const c = periodChange(entries, "2026-02-27", "2026-03-20");
    expect(c.added).toBe(20);          // 27–28 Feb + 3–20 Mar
    expect(c.removed).toBe(1);         // 25 Mar
    expect(c.removedWithWork).toBe(1); // it carried leave
  });
});

const feb = (open: boolean): Neighbour => ({ id: 1, label: "February 2026", start: "2026-02-01", end: "2026-02-28",
  status: open ? "Draft" : "Approved", open });
const apr = (open: boolean): Neighbour => ({ id: 3, label: "April 2026", start: "2026-04-01", end: "2026-04-30",
  status: open ? "Draft" : "Approved", open });
const opts = (o: Partial<PeriodOptions>): PeriodOptions => ({
  current: { start: "2026-03-01", end: "2026-03-31" }, previous: null, next: null,
  joined_on: null, left_on: null, free_start: null, free_end: null, ...o,
});

describe("the sheets either side (mirror of the server)", () => {
  it("an open February gives its days to March", () => {
    const e = neighbourEffect(opts({ previous: feb(true) }), "2026-02-21", "2026-03-20");
    expect(e.blocker).toBeNull();
    expect(e.takes[0]).toMatchObject({ days: 8, newEnd: "2026-02-20" });
  });

  it("a locked February blocks with the day March can start", () => {
    const e = neighbourEffect(opts({ previous: feb(false) }), "2026-02-21", "2026-03-20");
    expect(e.blocker?.fix).toMatchObject({ start: "2026-03-01" });
  });

  it("days before joining are refused", () => {
    const e = neighbourEffect(opts({ joined_on: "2026-03-05" }), "2026-02-21", "2026-03-20");
    expect(e.blocker?.fix).toMatchObject({ start: "2026-03-05" });
  });

  it("removed tail days go to the open April", () => {
    const e = neighbourEffect(opts({ next: apr(true) }), "2026-03-01", "2026-03-20");
    expect(e.handOver).toMatchObject({ days: 11, newStart: "2026-03-21", tooLong: false });
  });

  it("presets stay clear of a locked neighbour", () => {
    const p = periodPresets(2026, 3, opts({ previous: feb(false), free_start: "2026-03-01" }));
    expect(p.find((x) => x.key === "21-20")).toMatchObject({ start: "2026-03-01", end: "2026-03-20" });
  });
});
