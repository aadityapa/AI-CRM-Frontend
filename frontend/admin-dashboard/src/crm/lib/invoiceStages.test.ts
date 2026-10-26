import { describe, expect, it } from "vitest";
import { INVOICE_STAGE_TABS, invoiceTabParams, stageTabLabel } from "./invoiceStages";
import { isLikelyMatch, isPartlyPaid, orderByLikelyMatch } from "../pages/receipts/ReceiptWorkbench";
import { roundPerDay } from "../components/invoice/ProformaActions";

describe("invoice stage tabs (24 Oct 2026)", () => {
  it("each tab asks for exactly one stage, in the money's order", () => {
    const stages = INVOICE_STAGE_TABS.filter((t) => t.stage).map((t) => t.stage);
    expect(stages).toEqual(["proforma", "awaiting_customer", "pending_einvoice", "unpaid", "partially_paid", "paid"]);
    expect(new Set(stages).size).toBe(stages.length);
    expect(invoiceTabParams("Awaiting_Customer")).toEqual({ stage: "awaiting_customer" });
    expect(invoiceTabParams("Partially_Paid")).toEqual({ stage: "partially_paid" });
    const unpaid = INVOICE_STAGE_TABS.find((t) => t.key === "Unpaid")!;
    expect(stageTabLabel(unpaid, { unpaid: 12 })).toBe("Unpaid (12)");
    expect(stageTabLabel(unpaid, null)).toBe("Unpaid");
  });
});

describe("second payment advice", () => {
  it("puts the invoice whose balance equals the payment first; a partly paid invoice stays mappable", () => {
    const rows = [{ id: 1, balance_amount: 118 }, { id: 2, balance_amount: 23497 }, { id: 3, balance_amount: 500 }];
    expect(orderByLikelyMatch(rows, 23497).map((r) => r.id)).toEqual([2, 1, 3]);
    expect(orderByLikelyMatch(rows, 99).map((r) => r.id)).toEqual([1, 2, 3]);
    expect(isLikelyMatch({ balance_amount: 23497 }, 23496.5)).toBe(true);
    expect(isLikelyMatch({ balance_amount: 0 }, 0)).toBe(false);
    expect(isPartlyPaid({ paid_amount: 211464.6, balance_amount: 23497 })).toBe(true);
    expect(isPartlyPaid({ paid_amount: 118, balance_amount: 0 })).toBe(false);
  });
});

describe("per-day round off", () => {
  it("rounds the day amount on a part month and leaves a full month alone", () => {
    const perDay = 120000 / 31;
    const plan = roundPerDay({ billing_unit: "Monthly", rate_per_unit: 120000,
      amount: Math.round(perDay * 18 * 100) / 100, per_day_charge: Math.round(perDay * 100) / 100 });
    expect(plan).toMatchObject({ perDay: 3871, days: 18, amount: 69678 });
    expect(roundPerDay({ billing_unit: "Monthly", rate_per_unit: 120000, amount: 120000, per_day_charge: 3870.97 })).toBeNull();
    expect(roundPerDay({ billing_unit: "Hourly", rate_per_unit: 1000, amount: 500, per_day_charge: 8000 })).toBeNull();
  });
});
