import { describe, expect, it } from "vitest";
import { hitMessage, type InvoiceHit } from "./InvoiceSearchHits";
import { tabsWithMatches } from "../../lib/invoiceStages";

const hit = (over: Partial<InvoiceHit>): InvoiceHit => ({
  id: 9, kind: "Tax", invoice_number: "KRNX26-27-01-CT", grand_total: 281686, received: 0, balance: 281686,
  stage: "unpaid", stage_label: "Unpaid", receipt_ids: [], payment_block: null, ...over,
});

describe("finding an invoice by its number (2 Nov 2026)", () => {
  it("says where the money on the invoice stands", () => {
    expect(hitMessage(hit({}))).toMatch(/Nothing received against this invoice yet/);
    expect(hitMessage(hit({ payment_block: "the customer has not approved it" }))).toMatch(/not approved/);
    expect(hitMessage(hit({ received: 281686, balance: 0, receipt_ids: [4] }))).toMatch(/Fully settled/);
    expect(hitMessage(hit({ kind: "Proforma" }))).toMatch(/Still a Proforma/);
  });

  it("names the tabs that hold the search's invoices", () => {
    const counts = { proforma: 0, awaiting_customer: 0, pending_einvoice: 0, unpaid: 1, partially_paid: 0, paid: 2 };
    expect(tabsWithMatches(counts, "Proforma").map((t) => t.key)).toEqual(["Unpaid", "Paid"]);
    expect(tabsWithMatches(counts, "Unpaid").map((t) => t.key)).toEqual(["Paid"]);
    // A tab the login cannot see is never offered.
    expect(tabsWithMatches(counts, "Proforma", ["Proforma", "Unpaid"]).map((t) => t.key)).toEqual(["Unpaid"]);
    expect(tabsWithMatches(null, "Proforma")).toEqual([]);
  });
});
