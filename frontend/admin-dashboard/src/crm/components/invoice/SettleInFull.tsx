/** Settle a partly paid invoice in full (20 Nov 2026, Finance ask): the small
 *  balance left (bank charges, rounding, a short payment) is ADJUSTED — not
 *  received — and the invoice reads Paid. Finance / Admin / CEO only; the server
 *  sends `can_settle` / `can_undo_settlement` and is the boundary. */
import { BadgeCheck, BookOpen, CheckCircle2, IndianRupee, RotateCcw } from "lucide-react";
import { crmPost } from "../../api";
import { DecisionDialog } from "../dialogKit";

export type Settlement = { amount: number; reason?: string | null; by_name?: string | null; at?: string | null };

const rupee = (v: number) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function SettleInFullDialog({ mode, invoiceId, invoiceNumber, balance, settlement, onClose, onDone }: {
  mode: "settle" | "undo";
  invoiceId: number;
  invoiceNumber: string;
  /** The balance left (settle) — what will be adjusted. */
  balance: number;
  settlement?: Settlement | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const settle = mode === "settle";
  return (
    <DecisionDialog
      person={{ name: invoiceNumber, meta: settle ? `${rupee(balance)} still open` : `${rupee(settlement?.amount || 0)} adjusted` }}
      spec={settle ? {
        tone: "emerald", icon: BadgeCheck, eyebrow: "Partially paid invoice", title: "Settle in full",
        flow: { steps: ["Partially paid", "Balance adjusted", "Paid"], current: 1 },
        intro: <>The {rupee(balance)} still open is <b>adjusted</b>, not received — the invoice reads <b>Paid</b> and
          leaves every “to collect” list. Use it when the customer will not pay the small difference.</>,
        reason: { label: "Why is the balance settled?", required: true, min: 10,
          placeholder: "Bank charges deducted by the customer…",
          picks: ["Bank charges deducted by the customer", "Rounding difference on the payment",
            "Short payment agreed with the customer", "Customer deducted it — will not be paid"] },
        happens: [
          { icon: CheckCircle2, text: <>Status becomes Paid; balance ₹0.</> },
          { icon: IndianRupee, text: <>Collected / Received Bank stay as they are — the adjustment is not cash.</> },
          { icon: BookOpen, text: <>The customer ledger shows an “Adjustment” line; the reason goes on the Activity Log.</> },
        ],
        confirmLabel: `Settle ${rupee(balance)}`, busyLabel: "Settling…",
      } : {
        tone: "rose", icon: RotateCcw, eyebrow: "Settled invoice", title: "Undo the settlement",
        intro: <>The {rupee(settlement?.amount || 0)} adjusted is open again and the invoice goes back to Partially paid.
          {settlement?.reason ? <> It was settled because: “{settlement.reason}”.</> : null}</>,
        reason: { label: "Why undo it?", required: true, min: 10, placeholder: "The customer will pay the difference…",
          picks: ["The customer will pay the difference", "Settled by mistake"] },
        happens: [{ icon: RotateCcw, text: <>Balance {rupee(settlement?.amount || 0)} is due again.</> }],
        confirmLabel: "Undo settlement", busyLabel: "Undoing…",
      }}
      onClose={onClose}
      onConfirm={async (reason) => {
        const url = `/api/invoices/${invoiceId}/settle-in-full${settle ? "" : "/undo"}`;
        const res = await crmPost<any>(url, { reason });
        onDone(res.message || (settle ? "Settled in full" : "Settlement undone"));
      }}
    />
  );
}
