import { describe, expect, it } from "vitest";

import { BUCKET_LOOK, profitRows, sortProfitRows } from "./FinanceReports";

const data = {
  label: "Sep 2026", short_label: "Sep 2026", period: "month" as const, period_start: "2026-09-01", period_end: "2026-09-30",
  headline: { billed: 300, gst: 54, collected: 100, outstanding: 254, invoices: 3 },
  margin: {
    billed: 300, cost: 250, gross_margin: 50, gross_margin_pct: 16.7, heads_without_ctc: 0,
    by_customer: [{ customer_id: 1, customer: "Top only", billed: 200, cost: 100, margin: 100, margin_pct: 50, heads: 2 }],
    customers: [
      { customer_id: 1, customer: "Acme", billed: 200, cost: 100, margin: 100, margin_pct: 50, heads: 2 },
      { customer_id: 2, customer: "Beta", billed: 100, cost: 150, margin: -50, margin_pct: -50, heads: 1 },
    ],
  },
  by_project: { rows: [{ project_id: 9, project: "Gateway", customer: "Acme", billed: 200, cost: 100, margin: 100, margin_pct: 50, heads: 2 }], heads_without_ctc: 0 },
  by_employee: {
    rows: [{ employee_id: 5, employee: "Asha", employee_code: "K-5", customer: "Acme", project: "Gateway", billed: 200, cost: 100, margin: 100, margin_pct: 50 }],
    unlinked_billed: 0, idle_count: 0, idle_cost: 0,
  },
};

describe("Financial Reports ▸ Profit", () => {
  it("lists EVERY customer, not only the top eight, and links each row", () => {
    const rows = profitRows(data, "customer");
    expect(rows.map((r) => r.name)).toEqual(["Acme", "Beta"]);
    expect(rows[0].to).toBe("customers/1");
    expect(profitRows(data, "project")[0]).toMatchObject({ name: "Gateway", sub: "Acme", to: "projects/9" });
    expect(profitRows(data, "employee")[0].sub).toBe("K-5 · Acme · Gateway");
  });

  it("sorts losses first when asked", () => {
    const rows = profitRows(data, "customer");
    expect(sortProfitRows(rows, "profit_low")[0].name).toBe("Beta");
    expect(sortProfitRows(rows, "billed")[0].name).toBe("Acme");
  });
});

describe("Financial Reports ▸ Who owes us", () => {
  it("names every late bucket in plain words", () => {
    expect(Object.values(BUCKET_LOOK).map((b) => b.short)).toEqual([
      "Not yet due", "1–30 days late", "31–60 days late", "61–90 days late", "Over 90 days late",
    ]);
  });
});
