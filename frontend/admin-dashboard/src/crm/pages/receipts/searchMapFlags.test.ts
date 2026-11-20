import { describe, expect, it } from "vitest";
import { searchMapFlags, type FoundInvoice } from "./ReceiptWorkbench";

const found = (id: number, fit: FoundInvoice["fit"], extra: Partial<FoundInvoice> = {}): FoundInvoice => ({
  id, invoice_number: `INV-${id}`, invoice_date: null, grand_total: 100, paid_amount: 0, balance_amount: 100,
  payment_status: "Unpaid", sub_total: 100, tax_amount: 0, customer_id: 1, customer_name: "Aptiv",
  fit, can_map: true, move_receipt: true, reason: null, branch_id: 7, ...extra,
});

describe("mapping invoices found by search", () => {
  it("moves an unmapped receipt to the one other branch it pays", () => {
    const x = { 5: found(5, "other_branch") };
    expect(searchMapFlags([5], x, 1)).toEqual({ move_receipt: true, other_branches: false, problem: "" });
  });

  it("maps across branches when the receipt's own invoices are ticked too", () => {
    const x = { 5: found(5, "other_branch") };
    expect(searchMapFlags([5, 9], x, 1)).toEqual({ move_receipt: false, other_branches: true, problem: "" });
  });

  it("another customer's invoice moves the receipt, but never with this customer's invoices", () => {
    const x = { 6: found(6, "other_customer", { customer_id: 2 }) };
    expect(searchMapFlags([6], x, 1).move_receipt).toBe(true);
    expect(searchMapFlags([6, 9], x, 1).problem).toMatch(/one customer/);
  });
});
