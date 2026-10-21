import { describe, expect, it } from "vitest";
import { einvoiceDate } from "./EInvoiceBand";
import { canShowEInvoice, fileStem } from "./InvoicePage";
import type { InvoiceData } from "./types";

const base = { id: 7, invoice_number: "KRNX/26-27/23", kind: "Tax", einvoice: { irn: "ab" } } as unknown as InvoiceData;

describe("e-invoice sheet helpers", () => {
  it("prints the ack date as DD/MM/YYYY", () => {
    expect(einvoiceDate("2026-10-15")).toBe("15/10/2026");
    expect(einvoiceDate("15 Oct 2026")).toBe("15 Oct 2026");
    expect(einvoiceDate(null)).toBe("—");
  });

  it("shows the band only on a tax invoice with an IRN, and names the file EInvoice_", () => {
    expect(canShowEInvoice(base)).toBe(true);
    expect(canShowEInvoice({ ...base, einvoice: null })).toBe(false);
    expect(canShowEInvoice({ ...base, kind: "Proforma" })).toBe(false);
    expect(fileStem(base, 7, true)).toBe("EInvoice_KRNX_26-27_23");
    expect(fileStem(base, 7)).toBe("TaxInvoice_KRNX_26-27_23");
  });
});
