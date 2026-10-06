/**
 * Proforma → Tax invoice lifecycle UI (23 Sep 2026; server half in B-V2
 * `services/proforma.py`).
 *
 * - `InvoiceFormatPicker`  — the three optional service-table columns as
 *   checkboxes. Used by the GM's "Raise proforma" dialog AND by Finance's
 *   proforma editor, so both speak the same vocabulary.
 * - `ProformaBanner`       — what this document is and what happens next
 *   (orange), including Finance's return reason when there is one.
 * - `ConvertProformaModal` — Finance generates the original invoice: number
 *   (prefilled with the next INV-…), date.
 * - `ReturnProformaModal`  — Finance sends it back to the GM with a reason.
 * - `ProformaEditModal`    — Finance corrects header fields + format directly
 *   (a Proforma is not issued, so no change request is needed).
 * - `RoundOffToggle`       — round the grand total to the rupee (5 Oct 2026).
 */
import { useEffect, useState } from "react";
import { FileCheck2, Undo2 } from "lucide-react";
import { crmGet, crmPost, crmPut } from "../../api";
import { Modal, btnPrimary, btnSecondary, inputCls } from "../ui";
import { INVOICE_FORMAT_COLUMNS, type InvoiceFormat } from "./types";

type Notify = (msg: string, kind?: "ok" | "err") => void;

export const PROFORMA_COLOR = "#c2410c";

export function normalizeFormat(fmt?: InvoiceFormat | null): Required<InvoiceFormat> {
  return { sac: fmt?.sac !== false, leave: fmt?.leave !== false, per_day: fmt?.per_day !== false };
}

export function formatSummary(fmt?: InvoiceFormat | null): string {
  const f = normalizeFormat(fmt);
  const hidden = INVOICE_FORMAT_COLUMNS.filter((c) => !f[c.key]).map((c) => c.label);
  return hidden.length ? `Hides: ${hidden.join(", ")}` : "All columns";
}

export function InvoiceFormatPicker({
  value,
  onChange,
  disabled,
}: {
  value: InvoiceFormat;
  onChange: (next: Required<InvoiceFormat>) => void;
  disabled?: boolean;
}) {
  const f = normalizeFormat(value);
  return (
    <div className="space-y-1.5">
      {INVOICE_FORMAT_COLUMNS.map((c) => (
        <label key={c.key} className="flex cursor-pointer items-start gap-2 rounded-card border border-subtle px-3 py-2 text-sm hover:bg-surface-2">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0"
            checked={f[c.key]}
            disabled={disabled}
            onChange={(e) => onChange({ ...f, [c.key]: e.target.checked })}
          />
          <span>
            <span className="font-semibold text-primary">{c.label}</span>
            <span className="block text-xs text-muted">{c.hint}</span>
          </span>
        </label>
      ))}
      <p className="text-xs text-muted">Description, cost basis, quantity and amount always print.</p>
    </div>
  );
}

/** Round the grand total to the nearest rupee (B-V2 `finance.apply_round_off`):
 * GST and the sub-total never move, the difference prints as a "Round Off" line,
 * and the PO is still drawn by the sub-total. Chosen on the Proforma only — a
 * tax invoice keeps whatever was decided before it was generated. */
export function RoundOffToggle({ value, onChange, disabled }: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-card border border-subtle px-3 py-2 text-sm hover:bg-surface-2">
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={value} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-semibold text-primary">Round off the grand total</span>
        <span className="block text-xs text-muted">
          Grand total to the nearest rupee (e.g. ₹1,23,456.40 → ₹1,23,456; ₹1,23,456.50 → ₹1,23,457).
          GST is not changed; the difference prints as a “Round Off” line.
        </span>
      </span>
    </label>
  );
}

export function ProformaBanner({ inv }: { inv: { invoice_number: string; returned_reason?: string | null; returned_at?: string | null; invoice_format?: InvoiceFormat | null } }) {
  const returned = !!inv.returned_at;
  return (
    <div
      className="rounded-card border px-4 py-3 text-sm"
      style={{ borderColor: PROFORMA_COLOR, background: "#fff7ed", color: "#7c2d12" }}
      role="status"
    >
      <div className="font-bold" style={{ color: PROFORMA_COLOR }}>
        {returned ? "Proforma returned to the GM" : "Proforma invoice — awaiting Finance review"}
      </div>
      {returned ? (
        <p className="mt-1">
          Finance sent {inv.invoice_number} back: <span className="font-semibold">{inv.returned_reason}</span>.
          The GM fixes the timesheet or format and raises it again from the timesheet (same number).
        </p>
      ) : (
        <p className="mt-1">
          Nothing has been billed yet — the PO balance moves only when Finance generates the original invoice.
          Columns: {formatSummary(inv.invoice_format)}.
        </p>
      )}
    </div>
  );
}

export function ConvertProformaModal({
  invoiceId,
  invoiceDate,
  roundOff,
  onClose,
  onDone,
  notify,
}: {
  invoiceId: number;
  invoiceDate?: string | null;
  /** The Proforma's current choice (`round_off` not null = rounded). */
  roundOff?: boolean;
  onClose: () => void;
  onDone: () => void;
  notify: Notify;
}) {
  const [number, setNumber] = useState("");
  const [date, setDate] = useState((invoiceDate || "").slice(0, 10));
  const [round, setRound] = useState(!!roundOff);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    crmGet<{ invoice_number: string }>("/api/invoices/next-number")
      .then((r) => setNumber(r.data?.invoice_number || ""))
      .catch(() => { /* the field stays blank — the server picks the next number */ });
  }, []);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await crmPost(`/api/invoices/${invoiceId}/convert`, {
        invoice_number: number.trim() || null,
        invoice_date: date || null,
        round_off: round,
      });
      notify(res.message || "Original invoice generated");
      onDone();
      onClose();
    } catch (e: any) {
      setError(e?.message || "Could not generate the invoice");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Generate original invoice"
      onClose={onClose}
      footer={
        <>
          <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={btnPrimary} onClick={submit} disabled={busy}>
            <FileCheck2 size={14} /> {busy ? "Generating…" : "Generate invoice"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-secondary">
          This turns the Proforma into the tax invoice: it gets the invoice number below, the PO balance is
          drawn down now, and the Sales Manager is notified. The proforma number stays on record.
        </p>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-secondary">Invoice number</span>
          <input className={inputCls} value={number} onChange={(e) => setNumber(e.target.value)}
            placeholder="Blank = next INV-YYYY-NNN" maxLength={64} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-secondary">Invoice date</span>
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <RoundOffToggle value={round} onChange={setRound} />
        <p className="text-xs text-muted">This is the last chance to change it — a generated tax invoice keeps this choice.</p>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

export function ReturnProformaModal({
  invoiceId,
  onClose,
  onDone,
  notify,
}: {
  invoiceId: number;
  onClose: () => void;
  onDone: () => void;
  notify: Notify;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ok = reason.trim().length >= 10;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await crmPost(`/api/invoices/${invoiceId}/return`, { reason: reason.trim() });
      notify(res.message || "Proforma returned to the GM");
      onDone();
      onClose();
    } catch (e: any) {
      setError(e?.message || "Could not return the proforma");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Return proforma to the GM"
      onClose={onClose}
      footer={
        <>
          <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={btnPrimary} onClick={submit} disabled={busy || !ok}>
            <Undo2 size={14} /> {busy ? "Returning…" : "Return to GM"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-secondary">
          Say what needs to change — the GM reads this in the notification and on the timesheet.
        </p>
        <textarea className={`${inputCls} min-h-[96px]`} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="At least 10 characters, e.g. 'Leave days do not match the customer's approved sheet'" />
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

export function ProformaEditModal({
  inv,
  onClose,
  onSaved,
  notify,
}: {
  inv: { id: number; invoice_date?: string | null; due_date?: string | null; buyer_state_code?: string | null; invoice_format?: InvoiceFormat | null; round_off?: number | null };
  onClose: () => void;
  onSaved: () => void;
  notify: Notify;
}) {
  const [round, setRound] = useState(inv.round_off != null);
  const [date, setDate] = useState((inv.invoice_date || "").slice(0, 10));
  const [due, setDue] = useState((inv.due_date || "").slice(0, 10));
  const [state, setState] = useState(inv.buyer_state_code || "");
  const [format, setFormat] = useState<Required<InvoiceFormat>>(normalizeFormat(inv.invoice_format));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await crmPut(`/api/invoices/${inv.id}`, {
        invoice_date: date || undefined,
        due_date: due || undefined,
        buyer_state_code: state.trim() || null,
        invoice_format: format,
        round_off: round,
      });
      notify(res.message || "Proforma updated");
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Correct proforma"
      onClose={onClose}
      footer={
        <>
          <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={btnPrimary} onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-secondary">Invoice date</span>
            <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-secondary">Due date</span>
            <input type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-secondary">Buyer state code</span>
            <input className={inputCls} value={state} onChange={(e) => setState(e.target.value)} placeholder="2 digits, blank = branch" maxLength={2} />
          </label>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold text-secondary">Invoice format (columns printed)</div>
          <InvoiceFormatPicker value={format} onChange={setFormat} />
        </div>
        <RoundOffToggle value={round} onChange={setRound} />
        <p className="text-xs text-muted">
          Figures come from the approved timesheet. If a quantity or rate is wrong, return the proforma to the GM.
        </p>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
