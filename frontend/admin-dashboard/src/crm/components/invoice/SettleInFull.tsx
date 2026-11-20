/** Settle a partly paid invoice in full (20 Nov 2026, Finance ask): the small
 *  balance left (bank charges, rounding, a short payment) is ADJUSTED — not
 *  received — and the invoice reads Paid. Finance / Admin / CEO only; the server
 *  sends `can_settle` / `can_undo_settlement` and is the boundary. */
import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, BookOpen, CheckCircle2, IndianRupee, RotateCcw } from "lucide-react";
import { crmPost } from "../../api";
import { fetchAllMaster } from "../../lib/fetchAllMaster";
import { Modal, inputCls } from "../ui";
import { DecisionDialog, DialogActions, DialogFailure, DialogHero, DialogSection, ReasonBox } from "../dialogKit";

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


type PartlyPaidRow = { id: number; invoice_number?: string | null; customer_name?: string | null;
  grand_total?: number; paid_amount?: number; balance_amount?: number; invoice_date?: string | null };

/** PURE: the invoices whose balance is at most `limit` (the small ones to settle). */
export function smallBalances(rows: PartlyPaidRow[], limit: number): number[] {
  return rows.filter((r) => Number(r.balance_amount || 0) > 0 && Number(r.balance_amount || 0) <= limit).map((r) => r.id);
}

/** Settle many Partially paid invoices at once (20 Nov 2026, Finance ask) —
 *  `POST /api/invoices/settle-in-full/bulk`. Pre-ticks balances up to ₹100. */
export function BulkSettleDialog({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [rows, setRows] = useState<PartlyPaidRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState("100");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    fetchAllMaster<PartlyPaidRow>("/api/invoices", { stage: "partially_paid" })
      .then((r) => { setRows(r); setSelected(new Set(smallBalances(r, 100))); })
      .catch((e: any) => setError(e?.message || "Could not load the partly paid invoices"))
      .finally(() => setLoading(false));
  }, []);
  const shown = useMemo(() => rows.filter((r) => !q.trim()
    || [r.invoice_number, r.customer_name].filter(Boolean).join(" ").toLowerCase().includes(q.trim().toLowerCase())), [rows, q]);
  const total = rows.filter((r) => selected.has(r.id)).reduce((t, r) => t + Number(r.balance_amount || 0), 0);
  const missing = !selected.size ? "Tick the invoices to settle" : reason.trim().length < 10 ? "Say why (at least 10 characters)" : "";
  const submit = async () => {
    if (missing) { setError(missing); return; }
    setBusy(true); setError("");
    try {
      const res = await crmPost<any>("/api/invoices/settle-in-full/bulk", { invoice_ids: [...selected], reason: reason.trim() });
      const skipped = (res.data?.skipped || []) as { invoice_number: string; reason: string }[];
      onDone((res.message || "Settled") + (skipped.length ? ` (${skipped.map((x) => x.invoice_number).join(", ")})` : ""));
    } catch (e: any) { setError(e?.message || "Could not settle"); setBusy(false); }
  };
  return (
    <Modal title="Settle partly paid invoices" onClose={onClose} wide dirty={selected.size > 0 && !!reason}
      hero={<DialogHero tone="emerald" icon={BadgeCheck} eyebrow="Partially paid" title="Settle small balances in full"
        subtitle="The balance left on each ticked invoice is adjusted, not received — they read Paid."
        flow={{ steps: ["Partially paid", "Balance adjusted", "Paid"], current: 1 }} />}>
      <div className="space-y-4">
        <DialogSection n={1} title="Invoices to settle" tone="emerald" done={selected.size > 0}
          hint="Small balances are ticked for you; tick or untick any.">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <label className="inline-flex items-center gap-1 font-semibold text-secondary">Tick every balance up to ₹
              <input type="number" min={0} className="h-8 w-24 rounded-control border border-subtle bg-surface-1 px-2 text-right"
                value={limit} onChange={(e) => setLimit(e.target.value)} />
            </label>
            <button type="button" className="rounded-control border border-subtle px-2 py-1 font-semibold hover:bg-surface-2"
              onClick={() => setSelected(new Set(smallBalances(rows, Number(limit) || 0)))}>Apply</button>
            <button type="button" className="rounded-control border border-subtle px-2 py-1 font-semibold hover:bg-surface-2"
              onClick={() => setSelected(new Set())}>None</button>
            <input className={`${inputCls} !w-56`} placeholder="Search invoice / customer" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {loading ? <p className="text-xs text-muted">Loading…</p> : (
            <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
              {shown.map((r) => {
                const on = selected.has(r.id);
                return (
                  <li key={r.id}>
                    <label className={`flex cursor-pointer items-center gap-3 rounded-control border px-3 py-1.5 text-sm ${on ? "border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30" : "border-subtle"}`}>
                      <input type="checkbox" checked={on} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
                      <span className="min-w-0 flex-1 truncate"><b>{r.invoice_number || `#${r.id}`}</b> <span className="text-xs text-muted">· {r.customer_name || ""}</span></span>
                      <span className="text-xs text-muted tabular-nums">paid {rupee(Number(r.paid_amount || 0))} of {rupee(Number(r.grand_total || 0))}</span>
                      <span className="w-24 text-right font-semibold tabular-nums text-amber-700 dark:text-amber-300">{rupee(Number(r.balance_amount || 0))}</span>
                    </label>
                  </li>
                );
              })}
              {!shown.length && <li className="text-xs text-muted">No partly paid invoice.</li>}
            </ul>
          )}
          <p className="mt-2 text-xs text-secondary">{selected.size} ticked · <b>{rupee(total)}</b> will be adjusted</p>
        </DialogSection>
        <DialogSection n={2} title="Why" tone="emerald" done={reason.trim().length >= 10}>
          <ReasonBox id="bulk-settle-reason" required tone="emerald" value={reason} onChange={setReason} min={10} label="Why are these balances settled?"
            placeholder="Rounding / bank charges left on the payments…"
            picks={["Rounding difference on the payment", "Bank charges deducted by the customer", "Short payment agreed with the customer"]} />
        </DialogSection>
        <DialogFailure message={error} />
        <DialogActions onCancel={onClose} busy={busy} tone="emerald" icon={BadgeCheck}
          label={`Settle ${selected.size} invoice(s)`} disabled={!!missing} hint={missing || undefined} onConfirm={submit} />
      </div>
    </Modal>
  );
}
