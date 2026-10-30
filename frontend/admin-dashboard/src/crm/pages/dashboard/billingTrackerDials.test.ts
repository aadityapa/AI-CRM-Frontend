import { describe, expect, it } from "vitest";
import { trackerDials } from "./BillingTracker";

const tiles = {
  to_raise: 2, to_raise_returned: 0, with_customer: 1, with_customer_amount: 100,
  due_amount: 200, due_count: 2, overdue_amount: 50, overdue_count: 1,
  paid_amount: 700, paid_count: 7, tds_pending: 0, avg_wait_days: 9,
};

describe("trackerDials — the Billing tab's three dials (28 Oct 2026)", () => {
  it("collected share is paid over everything still moving or paid", () => {
    const d = trackerDials(tiles);
    expect(d.pipeline).toBe(1000);
    expect(d.collectedPct).toBe(70);
    expect(d.collectedState).toBe("ok");
    expect(d.overduePct).toBe(25);
    expect(d.overdueState).toBe("warn");
    expect(d.waitState).toBe("warn");
  });

  it("an empty book reads as no data, never as a failure", () => {
    const d = trackerDials({ ...tiles, paid_amount: 0, due_amount: 0, with_customer_amount: 0, overdue_amount: 0, avg_wait_days: null });
    expect(d.collectedPct).toBeNull();
    expect(d.overduePct).toBeNull();
    expect([d.collectedState, d.overdueState, d.waitState]).toEqual(["none", "none", "none"]);
  });
});
