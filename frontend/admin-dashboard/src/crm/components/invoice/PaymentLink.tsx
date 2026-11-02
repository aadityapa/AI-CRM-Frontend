/**
 * Record Payment ⇄ Received Amount, and reversing a payment (2 Nov 2026,
 * Finance / Admin ask). Server half: B-V2 `services/invoice_payments.py`.
 *
 *  - `ReceivedAmountChoice` — the OPTIONAL section of the Record Payment
 *    dialog: leave it unlinked (as before), take the money from a received
 *    amount still on account for this customer, or also save it as a new
 *    received amount mapped to this invoice.
 *  - `ReversePaymentDialog` — undo one payment with a reason; money that came
 *    from a received amount goes back on account there.
 */
import { useEffect, useState } from "react";
import { ArrowDownToLine, Info, Link2, PlusCircle, RotateCcw, Unlink, Wallet } from "lucide-react";
import { crmGet, crmPost } from "../../api";
import { CrmLink } from "../../router";
import { DecisionDialog, type DecisionSpec } from "../dialogKit";

export type ReceiptOnAccount = {
  id: number;
  received_date: string | null;
  amount: number;
  unallocated_amount: number;
  payment_mode: string | null;
  reference_number: string | null;
  branch_id: number | null;
  branch_name: string | null;
};

export type PaymentOptions = {
  customer_id: number | null;
  customer_name: string | null;
  branch_id: number | null;
  branch_name: string | null;
  receipts_on_account: ReceiptOnAccount[];
};

export type LinkKind = "none" | "from" | "add";

/** PURE: the most this payment can be — the invoice balance, and when it is
 * drawn from a received amount, what is still on account there. */
export function paymentCap(balance: number, receipt?: ReceiptOnAccount | null): number {
  const b = Math.max(0, Number(balance) || 0);
  if (!receipt) return b;
  return Math.min(b, Math.max(0, Number(receipt.unallocated_amount) || 0));
}

/** PURE: the request fields the choice adds to the record-payment POST. */
export function linkPayload(kind: LinkKind, receiptId: number | null): Record<string, unknown> {
  if (kind === "from" && receiptId) return { receipt_id: receiptId };
  if (kind === "add") return { add_to_received: true };
  return {};
}

const rupee = (v: number | null | undefined) =>
  `₹${Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDay = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

export function usePaymentOptions(invoiceId: number | string) {
  const [opts, setOpts] = useState<PaymentOptions | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    crmGet<PaymentOptions>(`/api/invoices/${invoiceId}/payment-options`)
      .then((r) => { if (live) setOpts(r.data); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [invoiceId]);
  return { opts, failed };
}

function Choice({ active, onClick, icon: Icon, title, hint, disabled }: {
  active: boolean; onClick: () => void; icon: typeof Link2; title: string; hint: string; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active}
      className={`flex min-w-0 flex-1 items-start gap-2 rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500 dark:bg-indigo-950/40"
          : "border-[color:var(--wiz-border)] hover:bg-surface-2"}`}>
      <Icon size={16} className={`mt-0.5 shrink-0 ${active ? "text-indigo-600" : "text-muted"}`} aria-hidden />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-primary">{title}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </button>
  );
}

/** The optional "Received Amount" section of Record Payment. */
export function ReceivedAmountChoice({ opts, failed, kind, onKind, receiptId, onReceipt }: {
  opts: PaymentOptions | null;
  failed: boolean;
  kind: LinkKind;
  onKind: (k: LinkKind) => void;
  receiptId: number | null;
  onReceipt: (r: ReceiptOnAccount) => void;
}) {
  const receipts = opts?.receipts_on_account || [];
  return (
    <section className="rounded-xl border border-[color:var(--wiz-border)] p-3">
      <div className="mb-2 flex items-center gap-2">
        <Wallet size={15} className="text-indigo-600" aria-hidden />
        <span className="text-sm font-semibold text-primary">Received Amount</span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted">optional</span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Choice active={kind === "none"} onClick={() => onKind("none")} icon={Unlink}
          title="Don't link" hint="Record it on this invoice only (as before)" />
        <Choice active={kind === "from"} onClick={() => onKind("from")} icon={ArrowDownToLine}
          disabled={!opts || receipts.length === 0}
          title="From a received amount"
          hint={receipts.length ? `${receipts.length} on account for this customer` : "Nothing on account for this customer"} />
        <Choice active={kind === "add"} onClick={() => onKind("add")} icon={PlusCircle} disabled={!opts?.customer_id}
          title="Add to Received Amount" hint="Also save it in the Received Amount register" />
      </div>
      {failed && (
        <p className="mt-2 text-xs text-warning">Could not read this customer's received amounts — you can still record the payment unlinked.</p>
      )}

      {kind === "from" && receipts.length > 0 && (
        <div className="mt-3 space-y-1.5" role="radiogroup" aria-label="Received amount to take it from">
          {receipts.map((r) => {
            const on = r.id === receiptId;
            return (
              <button key={r.id} type="button" role="radio" aria-checked={on} onClick={() => onReceipt(r)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm ${
                  on ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40" : "border-[color:var(--wiz-border)] hover:bg-surface-2"}`}>
                <span className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${on ? "border-emerald-600 bg-emerald-600" : "border-slate-400"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-primary">
                    #{r.id} · received {fmtDay(r.received_date)} · {rupee(r.amount)}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {[r.payment_mode, r.reference_number, r.branch_name].filter(Boolean).join(" · ") || "No reference"}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs">
                  <span className="block font-semibold text-emerald-700 dark:text-emerald-300">{rupee(r.unallocated_amount)}</span>
                  <span className="text-muted">on account</span>
                </span>
              </button>
            );
          })}
          <p className="flex items-start gap-1.5 pt-1 text-xs text-muted">
            <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
            The payment takes that credit's date, mode and reference — it is the same money, now mapped to this invoice.
          </p>
        </div>
      )}
      {kind === "add" && opts?.customer_id && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
          <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
          A received amount for {opts.customer_name || "this customer"}
          {opts.branch_name ? ` · ${opts.branch_name}` : ""} is created with this date, amount, mode and reference,
          already mapped to this invoice.
        </p>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- reverse */

export type PaymentRow = {
  id: number;
  invoice_id: number;
  amount: number;
  payment_date: string | null;
  payment_mode?: string | null;
  reference_number?: string | null;
  receipt_id?: number | null;
};

const REVERSE_SPEC: DecisionSpec = {
  tone: "rose",
  icon: RotateCcw,
  eyebrow: "Undo a payment",
  title: "Reverse this payment",
  intro: "Takes the payment off the invoice: the balance and payment status are worked out again. Use it for a payment recorded by mistake — wrong invoice, wrong amount, or recorded twice.",
  reason: {
    label: "Why is it reversed?",
    required: true,
    min: 10,
    placeholder: "e.g. Recorded on the wrong invoice — belongs to the July invoice",
    picks: ["Recorded on the wrong invoice", "Wrong amount entered", "Recorded twice", "Payment bounced / returned by the bank"],
  },
  happens: [],
  confirmLabel: "Reverse payment",
  busyLabel: "Reversing…",
};

export function ReversePaymentDialog({ invoiceId, invoiceNumber, payment, onClose, onDone }: {
  invoiceId: number | string;
  invoiceNumber?: string | null;
  payment: PaymentRow;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const fromReceipt = !!payment.receipt_id;
  const spec: DecisionSpec = {
    ...REVERSE_SPEC,
    happens: [
      { icon: RotateCcw, text: <>{rupee(payment.amount)} comes off {invoiceNumber || "this invoice"}; its balance goes up by the same.</> },
      fromReceipt
        ? { icon: Wallet, text: removeReceipt
            ? <>Received amount #{payment.receipt_id} is deleted too (only when nothing else is left on it).</>
            : <>The money goes back <b>on account</b> on received amount #{payment.receipt_id} — map it to the right invoice from Received Amount.</> }
        : { icon: Info, text: <>It was recorded directly on the invoice, so nothing else changes.</> },
      { icon: Info, text: <>The reversal and your reason are kept on the customer's Activity Log.</> },
    ],
  };
  return (
    <DecisionDialog spec={spec}
      person={{ name: `${rupee(payment.amount)} · ${fmtDay(payment.payment_date)}`,
        meta: [payment.payment_mode, payment.reference_number].filter(Boolean).join(" · ") || undefined }}
      onClose={onClose}
      onConfirm={async (note) => {
        const r = await crmPost<any>(`/api/invoices/${invoiceId}/payments/${payment.id}/reverse`,
          { reason: note, remove_receipt: fromReceipt && removeReceipt });
        onDone(r.message || "Payment reversed");
      }}>
      {fromReceipt && (
        <div className="flex items-start gap-2 rounded-xl border border-[color:var(--wiz-border)] p-3 text-sm">
          <input id="rev-remove-receipt" type="checkbox" className="mt-0.5" checked={removeReceipt} onChange={(e) => setRemoveReceipt(e.target.checked)} />
          <span>
            <label htmlFor="rev-remove-receipt" className="font-semibold text-primary">Also remove received amount #{payment.receipt_id}</label>
            <span className="block text-xs text-muted">
              Tick only if the money never arrived (the entry was made just for this payment). Otherwise leave it — the credit stays on account.{" "}
              <CrmLink to={`received-amounts?receipt=${payment.receipt_id}`} className="font-semibold text-brand-600 hover:underline">Open it</CrmLink>
            </span>
          </span>
        </div>
      )}
    </DecisionDialog>
  );
}
