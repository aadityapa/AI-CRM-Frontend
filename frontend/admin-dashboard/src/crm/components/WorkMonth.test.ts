import { describe, expect, it } from "vitest";

import { monthName, periodText } from "./WorkMonth";
import { qtyMeaning, rupee } from "./PaymentBreakdownModal";
import { STAGE_LOOK, rowLink, type TrackerRow } from "../pages/dashboard/BillingTracker";

describe("which month a timesheet / invoice is for", () => {
  it("names the month and only names a period that is not the calendar month", () => {
    expect(monthName(2026, 5)).toBe("May 2026");
    expect(monthName(null, 5)).toBeNull();
    expect(periodText(2026, 5, "2026-05-01", "2026-05-31")).toBeNull();
    expect(periodText(2026, 5, "2026-04-21", "2026-05-30")).toBe("21 Apr – 30 May 2026");
    expect(periodText(2027, 1, "2026-12-21", "2027-01-20")).toBe("21 Dec 2026 – 20 Jan 2027");
  });
});

describe("payment breakdown wording", () => {
  it("prints rupees with paise only when there are paise", () => {
    expect(rupee(200000)).toBe("₹2,00,000");
    expect(rupee(49201.2)).toBe("₹49,201.20");
    expect(rupee(null)).toBe("—");
  });

  it("says what the quantity means for the rate's unit", () => {
    expect(qtyMeaning("Monthly", 1)).toBe("one full month");
    expect(qtyMeaning("Monthly", 1.3667)).toBe("1.3667 × the monthly rate");
    expect(qtyMeaning("Hourly", 168)).toBe("168 billable hours");
    expect(qtyMeaning("Daily", 1)).toBe("1 billable day");
  });
});

describe("billing tracker", () => {
  const base = { invoice_id: null, timesheet_id: 7, invoice_kind: null } as unknown as TrackerRow;
  it("opens the invoice when there is one, else the timesheet", () => {
    expect(rowLink(base)).toEqual({ to: "timesheets/7", label: "Open timesheet" });
    expect(rowLink({ ...base, invoice_id: 3, invoice_kind: "Proforma" })).toEqual({ to: "invoices/3", label: "Open Proforma" });
  });
  it("has a colour for every server stage", () => {
    expect(Object.keys(STAGE_LOOK)).toEqual([
      "awaiting_proforma", "returned", "proforma", "awaiting_customer", "irn_pending", "unpaid", "paid",
    ]);
  });
});
