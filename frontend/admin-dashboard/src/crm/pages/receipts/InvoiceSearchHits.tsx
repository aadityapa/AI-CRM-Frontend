/**
 * Received Amount ▸ search by an INVOICE number (2 Nov 2026, screenshot).
 *
 * Searching "KRNX26-27-01-CT" here read "No amounts received yet" although the
 * invoice existed: nothing had been received against it, and the search never
 * looked at invoice numbers anyway. The server now finds receipts by the
 * invoices they paid AND returns `meta.invoice_hits` — the invoices the term
 * names, with what came in. This strip shows them, so the answer is always
 * "here is the invoice, and here is (or is not) the money".
 */
import { FileText, Link2, Search, Wallet } from "lucide-react";
import { CrmLink } from "../../routerHooks";
import { inr } from "./receiptShared";

export type InvoiceHit = {
  id: number;
  kind?: string | null;
  invoice_number?: string | null;
  proforma_number?: string | null;
  customer_name?: string | null;
  invoice_date?: string | null;
  grand_total: number;
  received: number;
  balance: number;
  stage: string;
  stage_label: string;
  receipt_ids: number[];
  payment_block?: string | null;
};

/** One line about where the money on this invoice stands (PURE). */
export function hitMessage(h: InvoiceHit): string {
  if (h.kind === "Proforma") return "Still a Proforma — money is recorded once Finance issues the tax invoice.";
  const n = h.receipt_ids.length;
  if (h.received <= 0) {
    return h.payment_block
      ? `Nothing received yet — ${h.payment_block}`
      : "Nothing received against this invoice yet — no received amount pays it.";
  }
  if (h.balance <= 0) return n ? `Fully settled — by ${n === 1 ? "received amount" : `${n} received amounts`} below.` : "Fully settled (recorded on the invoice).";
  return `${inr(h.received)} received, ${inr(h.balance)} still due${n ? "" : " — recorded on the invoice, not from a received amount"}.`;
}

const STAGE_TONE: Record<string, string> = {
  paid: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  partially_paid: "bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
  unpaid: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
};

export function InvoiceSearchHits({ hits, term, onOpenReceipt, noReceipts }: {
  hits: InvoiceHit[];
  term: string;
  /** Open a receipt that paid the invoice in the workbench. */
  onOpenReceipt: (id: number) => void;
  /** No receipt row matched the search — say it plainly. */
  noReceipts: boolean;
}) {
  if (!hits.length) return null;
  return (
    <div className="rounded-card border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-900/50 dark:bg-sky-950/20">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-sky-900 dark:text-sky-200">
        <Search size={13} aria-hidden />
        {noReceipts
          ? `“${term}” is an invoice — no received amount pays it yet.`
          : `“${term}” matches ${hits.length === 1 ? "this invoice" : "these invoices"}:`}
      </p>
      <div className="space-y-2">
        {hits.map((h) => (
          <div key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-control bg-surface-1 px-3 py-2 ring-1 ring-inset ring-subtle">
            <FileText size={15} className="text-sky-600" aria-hidden />
            <CrmLink to={`invoices/${h.id}`} className="font-semibold text-primary hover:underline">
              {h.invoice_number || h.proforma_number || `#${h.id}`}
            </CrmLink>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STAGE_TONE[h.stage] || "bg-surface-2 text-secondary"}`}>
              {h.stage_label}
            </span>
            {h.customer_name && <span className="text-xs text-secondary">{h.customer_name}</span>}
            <span className="text-xs tabular-nums text-secondary">
              Total <b className="text-primary">{inr(h.grand_total)}</b> · received <b className="text-primary">{inr(h.received)}</b>
              {" "}· due <b className={h.balance > 0 ? "text-amber-700 dark:text-amber-300" : "text-primary"}>{inr(h.balance)}</b>
            </span>
            <span className="w-full text-xs text-muted md:w-auto">{hitMessage(h)}</span>
            <span className="ml-auto flex flex-wrap gap-1.5">
              {h.receipt_ids.map((rid) => (
                <button key={rid} type="button" onClick={() => onOpenReceipt(rid)}
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-300 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800">
                  <Wallet size={11} aria-hidden /> Received amount #{rid}
                </button>
              ))}
              <CrmLink to={`invoices/${h.id}`}
                className="inline-flex items-center gap-1 rounded-full bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-700">
                <Link2 size={11} aria-hidden /> {h.received <= 0 && h.balance > 0 && h.kind !== "Proforma" ? "Open invoice · Record payment" : "Open invoice"}
              </CrmLink>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
