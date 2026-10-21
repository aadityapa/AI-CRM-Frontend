import { describe, expect, it } from "vitest";
import { journeyStates, latestPayment } from "./InvoiceJourney";

describe("InvoiceJourney helpers", () => {
  it("names the step to act on", () => {
    expect(journeyStates(true, false, false)).toEqual(["done", "done", "current", "waiting"]);
    expect(journeyStates(true, true, true)).toEqual(["done", "done", "done", "done"]);
  });

  it("picks the latest recorded payment, falling back to the payment date", () => {
    expect(latestPayment([])).toBeNull();
    expect(latestPayment(null)).toBeNull();
    const p = latestPayment([
      { id: 1, payment_date: "2026-09-01", created_at: "2026-09-02T10:00:00+05:30" },
      { id: 2, payment_date: "2026-10-01", created_at: null },
      { id: 3, payment_date: "2026-08-01", created_at: "2026-10-21T09:00:00+05:30" },
    ]);
    expect(p.id).toBe(3);
  });
});
