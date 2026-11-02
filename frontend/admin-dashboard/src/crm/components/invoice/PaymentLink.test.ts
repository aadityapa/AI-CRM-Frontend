import { describe, expect, it } from "vitest";
import { linkPayload, paymentCap, type ReceiptOnAccount } from "./PaymentLink";

const receipt = (unallocated: number): ReceiptOnAccount => ({
  id: 7, received_date: "2026-09-12", amount: 500000, unallocated_amount: unallocated,
  payment_mode: "NEFT", reference_number: "UTR1", branch_id: null, branch_name: null,
});

describe("paymentCap", () => {
  it("is the invoice balance when nothing is linked", () => {
    expect(paymentCap(120000)).toBe(120000);
    expect(paymentCap(-5)).toBe(0);
  });
  it("is the smaller of the balance and what is on account", () => {
    expect(paymentCap(120000, receipt(80000))).toBe(80000);
    expect(paymentCap(120000, receipt(300000))).toBe(120000);
  });
});

describe("linkPayload", () => {
  it("adds only the fields of the chosen link", () => {
    expect(linkPayload("none", 7)).toEqual({});
    expect(linkPayload("from", 7)).toEqual({ receipt_id: 7 });
    expect(linkPayload("from", null)).toEqual({});
    expect(linkPayload("add", 7)).toEqual({ add_to_received: true });
  });
});
