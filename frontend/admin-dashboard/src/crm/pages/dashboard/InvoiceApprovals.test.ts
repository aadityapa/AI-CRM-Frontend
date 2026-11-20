import { describe, expect, it } from "vitest";
import { approvable, collectedLine, type ApprovalRow } from "./InvoiceApprovals";

const ok = [{ key: "money", label: "Payment collected", ok: true, detail: "" }, { key: "tds", label: "TDS collected", ok: true, detail: "" }];
const row = (id: number, state: ApprovalRow["state"], checks = ok): ApprovalRow => ({
  id, invoice_number: `INV-${id}`, invoice_date: null, customer_id: 1, customer: "C", branch: null, employee: null,
  month: null, month_label: null, period_label: null, sub_total: 100, grand_total: 118, cash: 108,
  tds_amount: 10, tds_received: 10, tds_pending: 0, adjusted: 0, balance: 0, last_payment_date: null,
  waiting_days: 1, checks, done: checks.filter((c) => c.ok).length, missing: null, state, state_label: state,
  approved_at: null, approved_by_name: null, note: null,
});

describe("invoice approvals", () => {
  it("approves only ticked rows that are ready, or changed but ready again", () => {
    const notOk = [ok[0], { ...ok[1], ok: false }];
    const rows = [row(1, "ready"), row(2, "waiting", notOk), row(3, "changed", notOk), row(4, "changed"), row(5, "approved")];
    expect(approvable(rows, new Set([1, 2, 3, 4, 5])).map((r) => r.id)).toEqual([1, 4]);
  });

  it("says how the invoice was collected", () => {
    expect(collectedLine({ cash: 108, tds_amount: 10, tds_received: 4, adjusted: 2 }))
      .toBe("Cash ₹108.00 + TDS ₹4.00 of ₹10.00 + adjusted ₹2.00");
    expect(collectedLine({ cash: 118, tds_amount: 0, tds_received: 0, adjusted: 0 })).toBe("Cash ₹118.00");
  });
});
