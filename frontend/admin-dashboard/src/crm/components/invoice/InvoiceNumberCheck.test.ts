import { describe, expect, it } from "vitest";
import { invoiceNumberKey, normalizeInvoiceNumber } from "./InvoiceNumberCheck";

describe("one invoice number, once (26 Nov 2026)", () => {
  it("stores what was typed, tidied", () => {
    expect(normalizeInvoiceNumber("  KRSW26–27-65   -VS ")).toBe("KRSW26-27-65 -VS");
    expect(normalizeInvoiceNumber("")).toBe("");
  });

  it("compares numbers with case, spaces and dash look-alikes ignored — like the server", () => {
    expect(invoiceNumberKey("krsw26-27-65-vs")).toBe("KRSW26-27-65-VS");
    expect(invoiceNumberKey(" KRSW26 – 27-65-VS")).toBe(invoiceNumberKey("KRSW26-27-65-VS"));
    expect(invoiceNumberKey("KRSW26-27-66-VS")).not.toBe(invoiceNumberKey("KRSW26-27-65-VS"));
  });
});
