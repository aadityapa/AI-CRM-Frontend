/**
 * The Invoices tabs (24 Oct 2026, user report: an invoice still waiting for the
 * customer's approval also showed under "Unpaid").
 *
 * Every invoice sits in exactly ONE tab — the server's stage
 * (`billing_rules.invoice_stage_case`): Proforma → Awaiting customer → Pending
 * e-invoice → Unpaid → Partially paid → Paid. Money on an invoice (cash or TDS)
 * puts it in Partially paid / Paid even when it predates the approval rule.
 * The E-invoice register lists every invoice with its IRN, whatever its stage.
 *
 * The tab KEYS are the old ones, so saved links (`invoices?tab=Customer_Approved`,
 * `?tab=Unpaid`, the work desk's `?tab=Proforma`) keep opening the right list.
 */
export const EINVOICE_TAB_KEY = "EInvoice";

export type InvoiceStageTab = { key: string; label: string; stage: string; hint: string };

export const INVOICE_STAGE_TABS: InvoiceStageTab[] = [
  { key: "Proforma", label: "Proforma", stage: "proforma",
    hint: "Proformas raised by the GM — Finance checks them and generates the tax invoice." },
  { key: "Awaiting_Customer", label: "Awaiting customer", stage: "awaiting_customer",
    hint: "Tax invoices sent to the customer; the Sales Manager / Sales Head confirms the approval." },
  { key: "Customer_Approved", label: "Pending e-invoice", stage: "pending_einvoice",
    hint: "Customer approved — Finance adds the IRN and Ack No. Payments open after that." },
  { key: "Unpaid", label: "Unpaid", stage: "unpaid",
    hint: "E-invoice done (IRN added), nothing received yet." },
  { key: "Partially_Paid", label: "Partially paid", stage: "partially_paid",
    hint: "Part of the money received (cash or TDS) — the balance is still due from the customer." },
  { key: "Paid", label: "Paid", stage: "paid", hint: "Fully settled (cash + TDS)." },
  { key: EINVOICE_TAB_KEY, label: "E-invoice register", stage: "",
    hint: "Every tax invoice with its IRN, whatever its payment state." },
];

/** The server query of one tab (PURE). An unknown tab reads as Unpaid. */
export function invoiceTabParams(tab: string): Record<string, string> {
  const t = INVOICE_STAGE_TABS.find((x) => x.key === tab);
  return { stage: t?.stage || "unpaid" };
}

/** "Unpaid (12)" — the tab label with the server's count, when known. */
export function stageTabLabel(tab: InvoiceStageTab, counts?: Record<string, number> | null): string {
  if (!tab.stage || !counts || counts[tab.stage] == null) return tab.label;
  return `${tab.label} (${counts[tab.stage]})`;
}
