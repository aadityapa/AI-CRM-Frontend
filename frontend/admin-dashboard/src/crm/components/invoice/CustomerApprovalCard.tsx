/**
 * Customer approval + e-invoice (IRN) on a TAX invoice (6 Oct 2026; server half
 * in B-V2 `services/invoice_customer_approval.py`, migration 0121).
 *
 *   Finance generates the invoice → the Sales Manager / Sales Head sends it to
 *   the customer and, when the customer accepts it UNCHANGED, confirms that here
 *   → Finance records the IRN + Ack No. from the e-invoice portal.
 *
 * The page never guesses rights: `customer_approval.can_confirm / can_withdraw`
 * and the presence of `einvoice` (sent to Finance / Admin / CEO only) decide
 * every button. A change the customer wants goes through a change request
 * ("Edit"), never through this card.
 */
import { useState } from "react";
import { BadgeCheck, CheckCircle2, FileKey2, Hourglass, Mail, RotateCcw, ShieldCheck } from "lucide-react";
import { crmDelete, crmPost, crmPut } from "../../api";
import { Modal, btnPrimary, btnSecondary, inputCls } from "../ui";
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

const when = (v: string | null) => (v ? fmtDateTime12(v) : "—");

function Step({ done, icon: Icon, title, children }: { done: boolean; icon: typeof Mail; title: string; children: React.ReactNode }) {
  return (
    <div className={`flex gap-3 rounded-card border p-3 ${done
      ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
      : "border-subtle bg-surface-1"}`}>
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${done
        ? "bg-emerald-600 text-white" : "bg-surface-2 text-muted"}`}>
        {done ? <CheckCircle2 size={16} aria-hidden /> : <Icon size={16} aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-primary">{title}</div>
        <div className="mt-0.5 text-xs text-secondary">{children}</div>
      </div>
    </div>
  );
}

export function CustomerApprovalCard({ invoiceId, invoiceNumber, approval, einvoice, onChanged, notify }: {
  invoiceId: number;
  invoiceNumber: string;
  approval?: CustomerApproval | null;
  /** Present only for Finance / Admin / CEO. */
  einvoice?: EInvoice | null;
  onChanged: () => void;
  notify: Notify;
}) {
  const [dialog, setDialog] = useState<null | "confirm" | "withdraw" | "irn">(null);
  if (!approval) return null;
  const irnIn = !!einvoice?.irn;

  const confirmSpec: DecisionSpec = {
    tone: "emerald", icon: BadgeCheck, eyebrow: "Customer approval", title: "Customer approved — no changes",
    intro: <>Confirm the customer accepted <b>{invoiceNumber}</b> exactly as issued. Finance is told to record the e-invoice IRN. If the customer wants anything changed, use <b>Edit</b> (a change request) instead.</>,
    flow: { steps: ["Invoice generated", "Sent to customer", "Customer approved", "Finance adds IRN"], current: 2 },
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
    intro: <>Undo the confirmation on <b>{invoiceNumber}</b> — for a click made by mistake. Possible only until Finance records the IRN.</>,
    reason: { label: "Note (optional)" },
    happens: [{ icon: Hourglass, text: "The invoice goes back to waiting for the customer's approval." }],
    confirmLabel: "Withdraw approval", busyLabel: "Withdrawing…",
  };

  return (
    <section className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised" aria-labelledby={`inv-approval-${invoiceId}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={`inv-approval-${invoiceId}`} className="text-base font-bold text-primary">Customer approval & e-invoice</h2>
          <p className="text-xs text-muted">Sales confirms the customer accepted the invoice unchanged; Finance then records the IRN.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {approval.can_confirm && (
            <button type="button" className={btnPrimary} onClick={() => setDialog("confirm")}>
              <BadgeCheck size={15} /> Customer approved — no changes
            </button>
          )}
          {approval.can_withdraw && (
            <button type="button" className={btnSecondary} onClick={() => setDialog("withdraw")}>
              <RotateCcw size={15} /> Withdraw approval
            </button>
          )}
          {einvoice?.can_edit && (
            <button type="button" className={irnIn ? btnSecondary : btnPrimary} onClick={() => setDialog("irn")}>
              <FileKey2 size={15} /> {irnIn ? "Correct IRN" : "Add IRN & Ack No."}
            </button>
          )}
        </div>
      </div>

      <div className={`mt-3 grid gap-3 ${einvoice ? "md:grid-cols-2" : ""}`}>
        <Step done={approval.approved} icon={Mail} title={approval.approved ? "Customer approved" : "Waiting for the customer's approval"}>
          {approval.approved ? (
            <>
              Confirmed by <b>{approval.approved_by_name || "Sales"}</b> on {when(approval.approved_at)}.
              {approval.note && <span className="mt-1 block italic">“{approval.note}”</span>}
            </>
          ) : (
            <>The Sales Manager / Sales Head sends the invoice to the customer and confirms here when it is accepted unchanged.</>
          )}
        </Step>
        {einvoice && (
          <Step done={irnIn} icon={FileKey2} title={irnIn ? "E-invoice IRN recorded" : "E-invoice IRN pending"}>
            {irnIn ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <dt className="font-semibold">IRN</dt><dd className="break-all font-mono">{einvoice.irn}</dd>
                <dt className="font-semibold">Ack No.</dt><dd className="font-mono">{einvoice.ack_number}</dd>
                <dt className="font-semibold">Ack date</dt><dd>{einvoice.ack_date ? fmtDateShort(einvoice.ack_date) : "—"}</dd>
                <dt className="font-semibold">Recorded</dt><dd>{einvoice.recorded_by_name || "Finance"} · {when(einvoice.recorded_at)}</dd>
              </dl>
            ) : approval.approved ? (
              <>Generate the e-invoice on the GST portal and add the IRN and Ack No. here.</>
            ) : (
              <>Opens once Sales confirms the customer's approval. Visible to Finance, Admin and CEO only.</>
            )}
          </Step>
        )}
      </div>

      {dialog === "confirm" && (
        <DecisionDialog spec={confirmSpec} onClose={() => setDialog(null)}
          onConfirm={async (note) => {
            const res = await crmPost(`/api/invoices/${invoiceId}/customer-approval`, { note: note.trim() || null });
            notify(res.message || "Customer approval confirmed");
            setDialog(null);
            onChanged();
          }} />
      )}
      {dialog === "withdraw" && (
        <DecisionDialog spec={withdrawSpec} onClose={() => setDialog(null)}
          onConfirm={async () => {
            const res = await crmDelete(`/api/invoices/${invoiceId}/customer-approval`);
            notify(res.message || "Customer approval withdrawn");
            setDialog(null);
            onChanged();
          }} />
      )}
      {dialog === "irn" && einvoice && (
        <IrnModal invoiceId={invoiceId} invoiceNumber={invoiceNumber} current={einvoice}
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
        subtitle={<>From the GST e-invoice portal for <b>{invoiceNumber}</b>. Finance, Admin and CEO see it; it is not printed on the invoice.</>} />}
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
