import { describe, expect, it } from "vitest";
import { paymentEffect, receiptFit } from "./RecordPaymentDialog";

describe("Record Payment dialog (2 Nov 2026)", () => {
  it("says how a credit on account sits against the balance", () => {
    expect(receiptFit(198240, 198240.4)).toBe("match");
    expect(receiptFit(198240, 348960)).toBe("covers");
    expect(receiptFit(198240, 100000)).toBe("part");
  });

  it("works out the invoice after the payment", () => {
    const e = paymentEffect(200000, 150000, 150000);
    expect(e.receivedBefore).toBe(50000);
    expect(e.balanceAfter).toBe(0);
    expect(e.settles).toBe(true);
    expect(e.pctBefore).toBe(25);
    expect(e.pctAfter).toBe(100);
    const part = paymentEffect(200000, 150000, 50000);
    expect(part.balanceAfter).toBe(100000);
    expect(part.settles).toBe(false);
    // An amount above the balance is never shown as more than settling it.
    expect(paymentEffect(1000, 400, 900).balanceAfter).toBe(0);
  });
});
