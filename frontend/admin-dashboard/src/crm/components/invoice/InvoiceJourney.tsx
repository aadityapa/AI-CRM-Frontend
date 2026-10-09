/**
 * The tax invoice's journey (8 Oct 2026, replaces the 6 Oct "Customer approval
 * & e-invoice" card; server half in B-V2 `services/invoice_customer_approval.py`):
 *
 *   1 Invoice issued  →  2 Customer approved (Sales Manager / Sales Head)
 *     →  3 e-Invoice — Finance adds the IRN + Ack No.  →  4 Payment collected
 *
 * Record Payment / Record TDS live on step 4 and stay LOCKED until step 3 is
 * done — the server refuses them too (`payment_block`), and says why; the page
 * prints that same reason. The e-invoice itself (the tax invoice with its IRN ·
 * Ack No. · Ack Date band and a QR to the public e-invoice page) opens from
 * step 3 and from the page header.
 *
 * Rights are never guessed: `customer_approval.can_confirm / can_withdraw`,
 * the presence of `einvoice` (Finance / Admin / CEO only) and `payments_open`
 * decide every button.
 */
import { useState } from "react";
import {
  BadgeCheck, CheckCircle2, FileCheck2, FileKey2, Hourglass, IndianRupee, Lock, Mail, Receipt, RotateCcw,
  ShieldCheck, type LucideIcon,
} from "lucide-react";
import { crmDelete, crmPost, crmPut } from "../../api";
import { Modal, inputCls } from "../ui";
import { DecisionDialog, DialogActions, DialogFailure, DialogHero, DialogSection, type DecisionSpec } from "../dialogKit";
import { fmtDateShort, fmtDateTime12 } from "../../../lib/datetime";

export type CustomerApproval = {
  approved: boolean;
  approved_at: string | null;
  approved_by: number | null;
  approved_by_name: string | null;
  note: string | null;
  can_confirm: boolean;
  can_withdraw: boolean;
  block: string | null;
};

export type EInvoice = {
  irn: string | null;
  ack_number: string | null;
  ack_date: string | null;
  recorded_at: string | null;
  recorded_by: number | null;
  recorded_by_name: string | null;
  can_edit: boolean;
};

type Notify = (msg: string, kind?: "ok" | "err") => void;

/** Rupees with paise — an invoice figure is exact. */
const inr = (v: number | null | undefined): string =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Mirrors the server's `clean_irn` / `irn_error` so the form says what is wrong before posting. PURE. */
export const cleanIrn = (v: string) => v.replace(/\s+/g, "").toLowerCase();
export const cleanAck = (v: string) => v.replace(/\s+/g, "");
export function irnProblem(irn: string, ack: string, ackDate: string, today = new Date()): string | null {
  if (!/^[0-9a-f]{64}$/.test(cleanIrn(irn))) return "The IRN is the 64-character code from the e-invoice portal (letters a–f and digits).";
  if (!/^\d{10,20}$/.test(cleanAck(ack))) return "The Acknowledgement No. is 10–20 digits from the e-invoice portal.";
  if (ackDate) {
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (new Date(`${ackDate}T00:00:00`) > t) return "The acknowledgement date cannot be in the future.";
  }
  return null;
}

type StepState = "done" | "current" | "waiting";

/** Which step is the one to act on now. PURE — exported for tests. */
export function journeyStates(approved: boolean, einvoiceReady: boolean, fullyPaid: boolean): StepState[] {
  const done = [true, approved, einvoiceReady, fullyPaid];
  const firstOpen = done.indexOf(false);
  return done.map((d, i) => (d ? "done" : i === firstOpen ? "current" : "waiting"));
}

const STATE_LOOK: Record<StepState, { card: string; dot: string; label: string; labelCls: string }> = {
  done: {
    card: "border-emerald-200 bg-emerald-50/80 dark:border-emerald-800 dark:bg-emerald-950/30",
    dot: "bg-emerald-600 text-white",
    label: "Done", labelCls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  },
  current: {
    card: "border-brand-300 bg-surface-1 ring-2 ring-brand-200 dark:border-brand-700 dark:ring-brand-800",
    dot: "bg-gradient-to-br from-brand-600 to-indigo-600 text-white shadow-raised",
    label: "Now", labelCls: "bg-brand-50 text-brand-700 dark:bg-brand-900 dark:text-brand-200",
  },
  waiting: {
    card: "border-subtle bg-surface-2",
    dot: "bg-surface-1 text-muted border border-subtle",
    label: "Waiting", labelCls: "bg-surface-1 text-muted",
  },
};

const STEP_BTN = "inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const BTN_SOLID = `${STEP_BTN} bg-gradient-to-r from-brand-600 to-indigo-600 text-white shadow-raised hover:brightness-110`;
const BTN_GREEN = `${STEP_BTN} bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-raised hover:brightness-110`;
const BTN_SOFT = `${STEP_BTN} border border-subtle bg-surface-1 text-secondary hover:bg-surface-2`;

function JourneyStep({ n, state, icon: Icon, title, who, children, actions }: {
  n: number; state: StepState; icon: LucideIcon; title: string; who: string;
  children: React.ReactNode; actions?: React.ReactNode;
}) {
  const look = STATE_LOOK[state];
  return (
    <li className={`relative flex min-w-0 flex-col rounded-card border p-3 ${look.card}`}>
      <div className="flex items-start gap-2.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${look.dot}`} aria-hidden>
          {state === "done" ? <CheckCircle2 size={17} /> : <Icon size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Step {n}</span>
            <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${look.labelCls}`}>{look.label}</span>
          </div>
          <div className="text-sm font-bold text-primary">{title}</div>
          <div className="text-[11px] text-muted">{who}</div>
        </div>
      </div>
      <div className="mt-2 flex-1 text-xs text-secondary">{children}</div>
      {actions && <div className="mt-3 flex flex-wrap gap-1.5">{actions}</div>}
    </li>
  );
}

export function InvoiceJourney({ inv, canWrite, onPay, onTds, onOpenEInvoice, einvoiceBusy, onChanged, notify }: {
  inv: any;
  /** Finance's write grant on invoices — Record Payment / TDS. */
  canWrite: boolean;
  onPay: () => void;
  onTds: () => void;
  onOpenEInvoice: () => void;
  einvoiceBusy?: boolean;
  onChanged: () => void;
  notify: Notify;
}) {
  const [dialog, setDialog] = useState<null | "confirm" | "withdraw" | "irn">(null);
  const approval: CustomerApproval | undefined = inv.customer_approval;
  const einvoice: EInvoice | undefined = inv.einvoice;
  if (!approval) return null;
  const einvoiceReady = !!(inv.einvoice_ready || einvoice?.irn);
  const total = Number(inv.gst?.grand_total ?? inv.grand_total ?? 0);
  const paid = Number(inv.paid_amount || 0);
  const balance = Number(inv.balance_amount || 0);
  const fullyPaid = total > 0 && balance <= 0;
  const states = journeyStates(approval.approved, einvoiceReady, fullyPaid);
  const paidPct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  const paymentsOpen = inv.payments_open !== false;
  const tds = inv.tds_record;

  const confirmSpec: DecisionSpec = {
    tone: "emerald", icon: BadgeCheck, eyebrow: "Customer approval", title: "Customer approved — no changes",
    intro: <>Confirm the customer accepted <b>{inv.invoice_number}</b> exactly as issued. Finance is told to add the e-invoice IRN. If the customer wants anything changed, use <b>Edit</b> (a change request) instead.</>,
    flow: { steps: ["Invoice issued", "Customer approved", "Finance adds IRN", "Payment"], current: 1 },
    reason: { label: "Note (optional)", placeholder: "e.g. Approved by the customer's accounts team on mail",
      picks: ["Approved on email by the customer", "Customer confirmed on call", "Accepted by the customer's accounts team"] },
    happens: [
      { icon: Mail, text: "Finance gets a bell and an email to add the IRN and Ack No." },
      { icon: ShieldCheck, text: "You can withdraw this until Finance records the IRN." },
    ],
    confirmLabel: "Confirm customer approval", busyLabel: "Confirming…",
  };
  const withdrawSpec: DecisionSpec = {
    tone: "amber", icon: RotateCcw, eyebrow: "Customer approval", title: "Withdraw the approval",
    intro: <>Undo the confirmation on <b>{inv.invoice_number}</b> — for a click made by mistake. Possible only until Finance records the IRN.</>,
    reason: { label: "Note (optional)" },
    happens: [{ icon: Hourglass, text: "The invoice goes back to waiting for the customer's approval." }],
    confirmLabel: "Withdraw approval", busyLabel: "Withdrawing…",
  };

  return (
    <section className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised" aria-labelledby={`inv-journey-${inv.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle bg-gradient-to-r from-indigo-50 via-sky-50 to-emerald-50 px-4 py-3 dark:from-indigo-950/40 dark:via-sky-950/30 dark:to-emerald-950/30">
        <div>
          <h2 id={`inv-journey-${inv.id}`} className="text-base font-bold text-primary">From invoice to payment</h2>
          <p className="text-xs text-muted">The customer approves it, Finance registers the e-invoice, then the money is recorded against it.</p>
        </div>
        <span className="rounded-full bg-surface-1 px-2.5 py-1 text-xs font-semibold text-secondary shadow-raised">
          {states.filter((s) => s === "done").length} of 4 steps done
        </span>
      </div>

      <ol className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
        <JourneyStep n={1} state={states[0]} icon={Receipt} title="Invoice issued" who="Finance">
          <div className="font-semibold text-primary">{inv.invoice_number}</div>
          <div>{inv.invoice_date ? fmtDateShort(inv.invoice_date) : "—"}{inv.proforma_number ? ` · from ${inv.proforma_number}` : ""}</div>
          <div className="mt-1 text-sm font-bold text-primary tabular-nums">{inr(total)}</div>
        </JourneyStep>

        <JourneyStep n={2} state={states[1]} icon={Mail} title="Customer approved" who="Sales Manager / Sales Head"
          actions={(approval.can_confirm || approval.can_withdraw) ? (
            <>
              {approval.can_confirm && (
                <button type="button" className={BTN_GREEN} onClick={() => setDialog("confirm")}>
                  <BadgeCheck size={14} /> Customer approved — no changes
                </button>
              )}
              {approval.can_withdraw && (
                <button type="button" className={BTN_SOFT} onClick={() => setDialog("withdraw")}>
                  <RotateCcw size={14} /> Withdraw
                </button>
              )}
            </>
          ) : undefined}>
          {approval.approved ? (
            <>
              Confirmed by <b>{approval.approved_by_name || "Sales"}</b> · {approval.approved_at ? fmtDateTime12(approval.approved_at) : "—"}
              {approval.note && <span className="mt-1 block italic">“{approval.note}”</span>}
            </>
          ) : (
            <>Sent to the customer; confirmed here once they accept it unchanged. A change goes through <b>Edit</b>.</>
          )}
        </JourneyStep>

        <JourneyStep n={3} state={states[2]} icon={FileKey2} title="e-Invoice (IRN)" who="Finance"
          actions={(einvoice?.can_edit || einvoiceReady) && einvoice ? (
            <>
              {einvoiceReady && (
                <button type="button" className={BTN_SOLID} onClick={onOpenEInvoice} disabled={einvoiceBusy}>
                  <FileCheck2 size={14} /> {einvoiceBusy ? "Opening…" : "Open e-invoice"}
                </button>
              )}
              {einvoice.can_edit && (
                <button type="button" className={einvoiceReady ? BTN_SOFT : BTN_SOLID} onClick={() => setDialog("irn")}>
                  <FileKey2 size={14} /> {einvoiceReady ? "Correct IRN" : "Add IRN & Ack No."}
                </button>
              )}
            </>
          ) : undefined}>
          {einvoice && einvoice.irn ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
              <dt className="font-semibold">IRN</dt><dd className="break-all font-mono text-[11px]">{einvoice.irn}</dd>
              <dt className="font-semibold">Ack No.</dt><dd className="font-mono">{einvoice.ack_number}</dd>
              <dt className="font-semibold">Ack date</dt><dd>{einvoice.ack_date ? fmtDateShort(einvoice.ack_date) : "—"}</dd>
            </dl>
          ) : einvoiceReady ? (
            <>Registered on the GST e-invoice portal.</>
          ) : approval.approved ? (
            <>Generate the e-invoice on the GST portal, then add the IRN and Ack No. here.</>
          ) : (
            <>Opens once the customer's approval is confirmed.</>
          )}
        </JourneyStep>

        <JourneyStep n={4} state={states[3]} icon={IndianRupee} title="Payment" who="Finance"
          actions={canWrite ? (
            paymentsOpen ? (
              <>
                <button type="button" className={BTN_GREEN} onClick={onPay} disabled={balance <= 0}>
                  <IndianRupee size={14} /> Record payment
                </button>
                <button type="button" className={BTN_SOFT} onClick={onTds}
                  disabled={!!tds && Number(tds.tds_balance) <= 0}>
                  {tds ? "TDS payment" : "Record TDS"}
                </button>
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-control bg-surface-2 px-2.5 py-1.5 text-[11px] font-semibold text-muted">
                <Lock size={13} aria-hidden /> Locked until the e-invoice exists
              </span>
            )
          ) : undefined}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-bold text-primary tabular-nums">{inr(paid)}</span>
            <span className="text-[11px] text-muted tabular-nums">of {inr(total)}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500" style={{ width: `${paidPct}%` }} />
          </div>
          <div className="mt-1">{fullyPaid ? "Fully paid." : `Balance ${inr(balance)}`}</div>
          {!paymentsOpen && inv.payment_block && <div className="mt-1 text-[11px] text-muted">{inv.payment_block}</div>}
        </JourneyStep>
      </ol>

      {dialog === "confirm" && (
        <DecisionDialog spec={confirmSpec} onClose={() => setDialog(null)}
          onConfirm={async (note) => {
            const res = await crmPost(`/api/invoices/${inv.id}/customer-approval`, { note: note.trim() || null });
            notify(res.message || "Customer approval confirmed");
            setDialog(null);
            onChanged();
          }} />
      )}
      {dialog === "withdraw" && (
        <DecisionDialog spec={withdrawSpec} onClose={() => setDialog(null)}
          onConfirm={async () => {
            const res = await crmDelete(`/api/invoices/${inv.id}/customer-approval`);
            notify(res.message || "Customer approval withdrawn");
            setDialog(null);
            onChanged();
          }} />
      )}
      {dialog === "irn" && einvoice && (
        <IrnModal invoiceId={inv.id} invoiceNumber={inv.invoice_number} current={einvoice}
          onClose={() => setDialog(null)} onSaved={(msg) => { setDialog(null); notify(msg); onChanged(); }} />
      )}
    </section>
  );
}

function IrnModal({ invoiceId, invoiceNumber, current, onClose, onSaved }: {
  invoiceId: number;
  invoiceNumber: string;
  current: EInvoice;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [irn, setIrn] = useState(current.irn || "");
  const [ack, setAck] = useState(current.ack_number || "");
  const [ackDate, setAckDate] = useState((current.ack_date || "").slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const problem = irnProblem(irn, ack, ackDate);
  const dirty = irn !== (current.irn || "") || ack !== (current.ack_number || "") || ackDate !== (current.ack_date || "").slice(0, 10);
  const irnLen = cleanIrn(irn).length;

  const save = async () => {
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError("");
    try {
      const res = await crmPut(`/api/invoices/${invoiceId}/einvoice`, {
        irn: cleanIrn(irn), ack_number: cleanAck(ack), ack_date: ackDate || null,
      });
      onSaved(res.message || "IRN saved");
    } catch (e: any) {
      setError(e?.message || "Could not save the IRN");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={current.irn ? "Correct the e-invoice IRN" : "Add the e-invoice IRN"} medium dirty={dirty} onClose={() => { if (!busy) onClose(); }}
      hero={<DialogHero tone="indigo" icon={FileKey2} eyebrow="E-invoice" title={current.irn ? "Correct the IRN" : "Add the IRN & Ack No."}
        subtitle={<>From the GST e-invoice portal for <b>{invoiceNumber}</b>. They are printed in the e-Invoice band of the invoice, beside its QR.</>} />}
      footer={<DialogActions tone="indigo" icon={FileKey2} label={current.irn ? "Save correction" : "Save IRN"} busy={busy}
        disabled={!dirty || !!problem} onCancel={onClose} onConfirm={() => void save()}
        hint={problem && dirty ? <span className="text-warning">{problem}</span> : "Ctrl + Enter to save"} />}
    >
      <div className="space-y-4">
        <DialogSection n={1} title="IRN (Invoice Reference Number)" tone="indigo" done={irnLen === 64}
          hint="64 characters — paste it exactly as the portal shows it.">
          <textarea className={`${inputCls} min-h-[64px] font-mono text-xs`} value={irn} spellCheck={false}
            onChange={(e) => setIrn(e.target.value)} placeholder="e.g. 3f2a…(64 characters)" aria-label="IRN" />
          <p className={`mt-1 text-[11px] ${irnLen === 64 ? "text-success" : "text-muted"}`}>{irnLen} / 64 characters</p>
        </DialogSection>
        <DialogSection n={2} title="Acknowledgement" tone="indigo" done={/^\d{10,20}$/.test(cleanAck(ack))}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-secondary">Ack No.</span>
              <input className={`${inputCls} font-mono`} inputMode="numeric" value={ack} onChange={(e) => setAck(e.target.value)}
                placeholder="10–20 digits" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-secondary">Ack date</span>
              <input type="date" className={inputCls} value={ackDate} onChange={(e) => setAckDate(e.target.value)} />
            </label>
          </div>
        </DialogSection>
        {error && <DialogFailure message={error} />}
      </div>
    </Modal>
  );
}
