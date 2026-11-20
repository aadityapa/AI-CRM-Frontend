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
/** 20 Nov 2026 (user ask): the first tab, opened by default — every invoice,
 *  whatever its stage, with a Stage filter of its own. */
export const ALL_INVOICES_TAB_KEY = "All";

/** The stages the All tab's Stage filter offers, in the money's order. */
export const INVOICE_STAGE_FILTERS: { stage: string; label: string }[] = [
  { stage: "proforma", label: "Proforma" },
  { stage: "awaiting_customer", label: "Awaiting customer" },
  { stage: "pending_einvoice", label: "Pending e-invoice" },
  { stage: "unpaid", label: "Unpaid" },
  { stage: "partially_paid", label: "Partially paid" },
  { stage: "paid", label: "Paid" },
];
/** "Still open" = everything raised and not yet fully paid (a one-click pick). */
export const OPEN_STAGES = ["awaiting_customer", "pending_einvoice", "unpaid", "partially_paid"];

/** The words for a row's stage (server `stage`). */
export function stageWords(stage: string | null | undefined): string {
  return INVOICE_STAGE_FILTERS.find((x) => x.stage === stage)?.label || "";
}

export type InvoiceStageTab = { key: string; label: string; stage: string; hint: string };

export const INVOICE_STAGE_TABS: InvoiceStageTab[] = [
  { key: ALL_INVOICES_TAB_KEY, label: "All", stage: "",
    hint: "Every invoice and Proforma, whatever its stage — narrow it with the Stage, Status and other filters." },
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

/** The server query of one tab (PURE). An unknown tab reads as Unpaid; the All
 *  tab sends the stages its Stage filter picked (CSV), or none = every invoice. */
export function invoiceTabParams(tab: string, stages: string[] = []): Record<string, string> {
  if (tab === ALL_INVOICES_TAB_KEY) return stages.length ? { stage: stages.join(",") } : {};
  const t = INVOICE_STAGE_TABS.find((x) => x.key === tab);
  return { stage: t?.stage || "unpaid" };
}

/** The All tab's count = every stage added up (PURE). */
export function allInvoicesCount(counts: Record<string, number> | null | undefined): number | undefined {
  if (!counts) return undefined;
  return INVOICE_STAGE_FILTERS.reduce((a, s) => a + (counts[s.stage] || 0), 0);
}

/** Toggle one stage in the All tab's Stage filter, kept in the money's order (PURE). */
export function toggleStage(picked: string[], stage: string): string[] {
  const set = new Set(picked);
  if (set.has(stage)) set.delete(stage); else set.add(stage);
  return INVOICE_STAGE_FILTERS.map((s) => s.stage).filter((s) => set.has(s));
}

/**
 * Where a search found its invoices (2 Nov 2026, screenshot: KRNX26-27-01-CT
 * typed on the Proforma tab read "No invoices yet" while it sat under Unpaid).
 * The tabs — among `allowed` keys, other than `current` — whose server count
 * for this search is above zero, in tab order (PURE).
 */
export function tabsWithMatches(
  counts: Record<string, number> | null | undefined, current: string, allowed?: string[],
): { key: string; label: string; count: number }[] {
  if (!counts) return [];
  return INVOICE_STAGE_TABS
    .filter((t) => t.stage && t.key !== current && (!allowed || allowed.includes(t.key)) && (counts[t.stage] || 0) > 0)
    .map((t) => ({ key: t.key, label: t.label, count: counts[t.stage] || 0 }));
}

/** "Unpaid (12)" — the tab label with the server's count, when known. */
export function stageTabLabel(tab: InvoiceStageTab, counts?: Record<string, number> | null): string {
  if (!tab.stage || !counts || counts[tab.stage] == null) return tab.label;
  return `${tab.label} (${counts[tab.stage]})`;
}
