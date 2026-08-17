/** The Commercial Details rule: a rate's expiry is never typed, it is DERIVED —
 * each rate ends the day before the next one starts, and the "Current" badge
 * lands on the rate in force today. These tests pin that arithmetic, including
 * the edges (single row, future-only schedules, unsorted input, month/year
 * boundaries) where off-by-one bugs in date maths like to live.
 */
import { describe, it, expect } from "vitest";
import { deriveRateSchedule } from "./ProjectEmployees";

const today = new Date().toISOString().slice(0, 10);

describe("deriveRateSchedule", () => {
  it("a single rate runs open-ended and is current", () => {
    const [r] = deriveRateSchedule([{ effective_from: "2026-01-01", rate: "100" }]);
    expect(r.expiry).toBeNull();
    expect(r.isCurrent).toBe(true);
  });

  it("each rate expires the day before the next begins", () => {
    const rows = deriveRateSchedule([
      { effective_from: "2026-01-01", rate: "100" },
      { effective_from: "2026-04-15", rate: "120" },
      { effective_from: "2027-01-01", rate: "140" },
    ]);
    expect(rows.map((r) => r.expiry)).toEqual(["2026-04-14", "2026-12-31", null]);
  });

  it("handles month and year boundaries without off-by-one", () => {
    const rows = deriveRateSchedule([
      { effective_from: "2026-03-01", rate: "1" },
      { effective_from: "2026-05-01", rate: "2" },
    ]);
    // Day before 1 May is 30 April — not 31 April, not 1 May.
    expect(rows[0].expiry).toBe("2026-04-30");
  });

  it("sorts unsorted input by date before deriving", () => {
    const rows = deriveRateSchedule([
      { effective_from: "2027-01-01", rate: "140" },
      { effective_from: "2026-01-01", rate: "100" },
    ]);
    expect(rows[0].effective_from).toBe("2026-01-01");
    expect(rows[0].expiry).toBe("2026-12-31");
    // Rows keep their draft index so edits land on the right input.
    expect(rows[0].index).toBe(1);
  });

  it("marks the latest past-dated rate current, not a future one", () => {
    const rows = deriveRateSchedule([
      { effective_from: "2020-01-01", rate: "100" },
      { effective_from: today, rate: "120" },
      { effective_from: "2099-01-01", rate: "999" },
    ]);
    expect(rows.map((r) => r.isCurrent)).toEqual([false, true, false]);
  });

  it("falls back to the earliest rate when every date is in the future", () => {
    const rows = deriveRateSchedule([
      { effective_from: "2098-01-01", rate: "1" },
      { effective_from: "2099-01-01", rate: "2" },
    ]);
    expect(rows[0].isCurrent).toBe(true);
    expect(rows[1].isCurrent).toBe(false);
  });

  it("ignores rows without a date yet (still being typed)", () => {
    const rows = deriveRateSchedule([
      { effective_from: "", rate: "50" },
      { effective_from: "2026-01-01", rate: "100" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].effective_from).toBe("2026-01-01");
  });
});
