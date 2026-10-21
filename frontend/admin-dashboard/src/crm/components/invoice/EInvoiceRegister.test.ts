import { describe, expect, it } from "vitest";
import { eInvoiceCsv, employeeChoices, filterEInvoices, type EInvoiceRow } from "./EInvoiceRegister";

const rows: EInvoiceRow[] = [
  { id: 1, invoice_number: "INV-1", employee: "Ravi", payment_status: "Paid", grand_total: 100 },
  { id: 2, invoice_number: "INV-2", employee: "Asha", payment_status: "Unpaid", grand_total: 200 },
  { id: 3, invoice_number: "=HYPERLINK()", employee: null, payment_status: "Unpaid", grand_total: 50 },
];

describe("e-invoice register", () => {
  it("narrows by employee and payment status", () => {
    expect(filterEInvoices(rows, { employee: "", status: "" })).toHaveLength(3);
    expect(filterEInvoices(rows, { employee: "Asha", status: "" }).map((r) => r.id)).toEqual([2]);
    expect(filterEInvoices(rows, { employee: "", status: "Unpaid" }).map((r) => r.id)).toEqual([2, 3]);
  });

  it("lists the named employees once, A to Z", () => {
    expect(employeeChoices(rows)).toEqual(["Asha", "Ravi"]);
  });

  it("writes a formula-safe CSV", () => {
    const csv = eInvoiceCsv(rows);
    expect(csv.split("\n")).toHaveLength(4);
    expect(csv).toContain("'=HYPERLINK()");
  });
});
