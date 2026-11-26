import { describe, expect, it } from "vitest";
import { ddmmyyyy, days, filterTracker, money2, sumRows, type TrackerData, type TrackerRow } from "./InvoiceTrackerPanel";

const row = (o: Partial<TrackerRow>): TrackerRow => ({
  invoice_id: 1, timesheet_id: 1, customer_id: 1, customer: "HARMAN", project: "IVI", resource: "Dev Rao",
  employee_code: "K1", billing_month: "2026-09", billing_month_label: "Sep 2026", period_label: null, part: null,
  expected_revenue: 300000, no_of_days: 30, rate_per_day: 10000, week_off: 8, holiday: 1, leave: 1,
  extra_days: 0, billed_days: 29, amount: 290000, gst: 52200, total_amount: 342200, invoice_number: "INV-1",
  invoice_date: "2026-10-03", payment_status: "Received", received_date: "2026-11-02", received_amount: 313200,
  tds_amount: 29000, diff: 0, amount_received: 342200, ...o,
});

describe("invoice tracker", () => {
  it("formats like the sheet", () => {
    expect(money2(251613)).toBe("2,51,613.00");
    expect(money2(null)).toBe("");
    expect(days(29.5)).toBe("29.5");
    expect(ddmmyyyy("2026-10-03")).toBe("03-10-2026");
  });

  it("filters by status and search and re-adds the totals", () => {
    const data: TrackerData = {
      label: "September 2026", period_key: "2026-09", count: 3,
      groups: [{ customer_id: 1, customer: "HARMAN", rows: [row({}), row({ invoice_id: 2, resource: "Asha K", payment_status: "Not Received", diff: 342200, received_amount: 0, tds_amount: 0, amount_received: 0 })],
        totals: sumRows([]) }],
      totals: sumRows([]),
    };
    expect(filterTracker(data, "", "Not Received")[0].rows.map((r) => r.resource)).toEqual(["Asha K"]);
    expect(filterTracker(data, "dev", "all")[0].totals.total_amount).toBe(342200);
    expect(filterTracker(data, "nobody", "all")).toEqual([]);
    const t = sumRows(data.groups[0].rows);
    expect(t.received).toBe(1);
    expect(t.diff).toBe(342200);
  });
});
