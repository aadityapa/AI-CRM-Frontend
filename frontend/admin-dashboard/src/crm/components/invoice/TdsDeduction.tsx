/**
 * TDS the customer withholds on an invoice (16 Oct 2026, Finance ask).
 *
 * Three pieces, used by Customer Received Amount, the invoice page and the
 * TDS register:
 *
 *  - `TdsDeductionModal` — opens when Finance ticks an invoice in "Add received
 *    amount" (or presses Record TDS on the invoice): did the customer deduct
 *    TDS, at what %, on what base (before GST — the default, CBDT circular
 *    23/2017 — or the invoice total). Shows the TDS and the amount we should
 *    actually receive from the customer.
 *  - `TdsChip` — "TDS ₹10,000 · Pending from client" on a receipt / invoice line.
 *  - `TdsDetailModal` — click the chip: this invoice's TDS, how long it has been
 *    pending from the client, and "Mark received (Form 16A)" for Finance.
 *
 * The server owns the maths (`services/tds.py`); `computeTds` here mirrors it
 * for the live preview only.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { BadgeCheck, CalendarClock, FileCheck2, Hourglass, Landmark, Percent, Receipt } from "lucide-react";

import { crmGet, crmPost } from "../../api";
import { CrmLink } from "../../routerHooks";
import { Modal, inputCls } from "../ui";
import { DialogActions, DialogFailure, DialogHero, DialogSection, WhatHappens, useCtrlEnter } from "../dialogKit";

export type TdsBase = "taxable" | "total";
export type TdsSection = { section: string; rate: number; label: string };
/** What Finance chose for one invoice in the receipt dialog. */
export type TdsChoice = { rate: number; base: TdsBase; section?: string | null; amount: number; baseAmount: number };
/** A booked TDS record as the server serialises it. */
export type TdsInfo = {
  id: number; invoice_id: number; tds_amount: number; tds_paid: number; tds_balance: number;
  tds_status: string; status_label?: string; tds_rate?: number | null; tds_base?: string | null;
  base_amount?: number | null; section?: string | null; receipt_id?: number | null; created_at?: string | null;
  invoice_number?: string | null; customer_name?: string | null; deducted_on?: string | null;
  pending_days?: number | null; receipt_reference?: string | null;
};
/** The figures of the invoice the TDS is on. */
export type TdsInvoice = {
  id: number; invoice_number?: string | null; sub_total: number; tax_amount: number;
  grand_total: number; paid_amount?: number; balance_amount: number;
  employee_name?: string | null; month_label?: string | null;
};

export const DEFAULT_SECTIONS: TdsSection[] = [
  { section: "194J", rate: 10, label: "194J · professional / technical services" },
  { section: "194J", rate: 2, label: "194J · technical services (2%)" },
  { section: "194C", rate: 2, label: "194C · contract work (company)" },
  { section: "194C", rate: 1, label: "194C · contract work (individual / HUF)" },
];

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const inr = (v: number | null | undefined) =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** PURE — mirror of `services/tds.work_out` for the preview. */
export function computeTds(inv: Pick<TdsInvoice, "sub_total" | "grand_total">, rate: number, base: TdsBase) {
  const baseAmount = round2(Number(base === "total" ? inv.grand_total : inv.sub_total) || 0);
  const amount = rate > 0 ? round2((baseAmount * rate) / 100) : 0;
  return { baseAmount, amount };
}

/** PURE — what the customer still owes in money once the TDS is taken off. */
export function netDue(balance: number, tds: number) {
  return Math.max(0, round2((Number(balance) || 0) - (Number(tds) || 0)));
}

export function tdsStatusLabel(t: Pick<TdsInfo, "tds_status" | "status_label">) {
  return t.status_label || ({ Pending: "Pending from client", Partially_Paid: "Partly received", Paid: "Received (Form 16A)" } as Record<string, string>)[t.tds_status] || t.tds_status;
}

/* ------------------------------------------------------------------ chip */

export function TdsChip({ tds, onClick, compact }: { tds: TdsInfo; onClick?: () => void; compact?: boolean }) {
  const pending = Number(tds.tds_balance || 0) > 0;
  const cls = pending
    ? "bg-amber-50 text-amber-800 ring-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800"
    : "bg-emerald-50 text-emerald-800 ring-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800";
  const body = (
    <>
      {pending ? <Hourglass size={11} aria-hidden /> : <BadgeCheck size={11} aria-hidden />}
      TDS {inr(tds.tds_amount)}
      <span className="font-normal">· {compact ? (pending ? "pending" : "received") : tdsStatusLabel(tds)}</span>
    </>
  );
  const base = `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${cls}`;
  if (!onClick) return <span className={base} title={tdsStatusLabel(tds)}>{body}</span>;
  return (
    <button type="button" className={`${base} hover:underline`} title={`${tdsStatusLabel(tds)} — open`}
      onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {body}
    </button>
  );
}

/* ------------------------------------------------- the deduction pop-up */

const choiceCls = (on: boolean) => `rounded-card border px-3 py-2.5 text-left text-sm transition-colors ${on
  ? "border-amber-500 bg-amber-50 ring-2 ring-amber-400 dark:bg-amber-950/30"
  : "border-subtle bg-surface-1 hover:border-amber-300"}`;
const pill = (on: boolean) => `rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${on
  ? "border-amber-500 bg-amber-500 text-[#fff] shadow-raised"
  : "border-subtle bg-surface-1 text-secondary hover:border-amber-300 hover:text-primary"}`;

/**
 * "Did the customer deduct TDS on this invoice?"
 * `onSave(choice)` — a choice, or null for "no TDS". `mode="record"` posts to
 * the invoice's record-tds itself (invoice page) and calls `onSaved`.
 */
export function TdsDeductionModal({
  invoice, initial, defaultRate = 10, sections = DEFAULT_SECTIONS, customerName, onClose, onSave, mode = "choose", onSaved,
}: {
  invoice: TdsInvoice;
  initial?: TdsChoice | null;
  defaultRate?: number;
  sections?: TdsSection[];
  customerName?: string | null;
  onClose: () => void;
  onSave?: (choice: TdsChoice | null) => void;
  mode?: "choose" | "record";
  onSaved?: (message: string) => void;
}) {
  const [deducted, setDeducted] = useState<boolean>(initial !== null);
  const [rate, setRate] = useState<string>(String(initial?.rate ?? defaultRate));
  const [base, setBase] = useState<TdsBase>(initial?.base ?? "taxable");
  const [section, setSection] = useState<string>(initial?.section ?? (sections.find((s) => s.rate === (initial?.rate ?? defaultRate))?.section || ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const r = Number(rate);
  const rateOk = deducted ? r > 0 && r <= 30 : true;
  const { baseAmount, amount } = useMemo(
    () => computeTds(invoice, deducted && rateOk ? r : 0, base), [invoice, deducted, rateOk, r, base]);
  const balance = Number(invoice.balance_amount || 0);
  const tooMuch = deducted && amount > balance + 0.001;
  const net = netDue(balance, deducted ? amount : 0);
  const gst = round2(Number(invoice.tax_amount || 0));
  const problem = !rateOk ? "Enter a TDS rate between 0 and 30 %" : tooMuch ? `TDS is more than the open balance ${inr(balance)}` : "";

  const save = async () => {
    if (problem) return;
    const choice: TdsChoice | null = deducted
      ? { rate: r, base, section: section || null, amount, baseAmount } : null;
    if (mode === "choose") { onSave?.(choice); return; }
    if (!choice) { onClose(); return; }
    setBusy(true);
    setError("");
    try {
      const res = await crmPost(`/api/invoices/${invoice.id}/record-tds`, {
        tds_rate: choice.rate, tds_base: choice.base, section: choice.section || null,
      });
      onSaved?.(res.message || "TDS recorded — pending from client");
    } catch (e: any) {
      setError(e?.message || "Could not record the TDS");
      setBusy(false);
    }
  };
  useCtrlEnter(() => void save());

  const num = invoice.invoice_number || `#${invoice.id}`;
  return (
    <Modal title={`TDS on ${num}`} onClose={onClose} xl
      hero={<DialogHero tone="amber" icon={Percent} eyebrow="Tax deducted at source"
        title={<>Did {customerName || "the customer"} deduct TDS on {num}?</>}
        subtitle="Customers usually pay the invoice less TDS and deposit the TDS with the government. We count it as settled and follow it as pending from client until the Form 16A comes in."
        flow={{ steps: ["Invoice", "Customer deducts TDS", "Pays the net amount", "Form 16A received"], current: deducted ? 2 : 1 }}
        chips={invoice.employee_name || invoice.month_label ? (
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold">
            {[invoice.employee_name, invoice.month_label].filter(Boolean).join(" · ")}
          </span>
        ) : undefined} />}
      footer={<DialogActions tone="amber" icon={Receipt}
        label={mode === "record" ? (deducted ? `Record TDS ${inr(amount)}` : "Close") : deducted ? `Use · receive ${inr(net)}` : "No TDS — receive in full"}
        busy={busy} disabled={!!problem} onCancel={onClose} onConfirm={() => void save()}
        hint={problem ? <span className="text-warning">{problem}</span> : "Ctrl + Enter to confirm"} />}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-4">
          <DialogSection n={1} title="Was TDS deducted?" tone="amber" done>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Was TDS deducted">
              <button type="button" role="radio" aria-checked={deducted} className={choiceCls(deducted)} onClick={() => setDeducted(true)}>
                <span className="block font-semibold text-primary">Yes — the customer deducted TDS</span>
                <span className="block text-xs text-muted">They pay the balance less TDS</span>
              </button>
              <button type="button" role="radio" aria-checked={!deducted} className={choiceCls(!deducted)} onClick={() => setDeducted(false)}>
                <span className="block font-semibold text-primary">No TDS</span>
                <span className="block text-xs text-muted">They pay the full balance</span>
              </button>
            </div>
          </DialogSection>

          {deducted && (
            <DialogSection n={2} title="Rate and base" tone="amber" done={rateOk}
              hint="TDS is normally on the value before GST when GST is shown separately on the invoice.">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Common TDS rates">
                  {sections.map((s) => (
                    <button key={`${s.section}-${s.rate}`} type="button" title={s.label}
                      className={pill(Number(rate) === s.rate && section === s.section)}
                      onClick={() => { setRate(String(s.rate)); setSection(s.section); }}>
                      {s.rate}% · {s.section}
                    </button>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-secondary">TDS rate (%) *</span>
                    <input type="number" min={0} max={30} step="0.01" className={`${inputCls} text-lg font-bold tabular-nums`}
                      value={rate} onChange={(e) => setRate(e.target.value)} aria-label="TDS rate percent" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-secondary">Section (optional)</span>
                    <input className={`${inputCls} font-mono uppercase`} value={section} maxLength={16}
                      placeholder="194J / 194C" onChange={(e) => setSection(e.target.value.toUpperCase())} />
                  </label>
                </div>
                <div>
                  <span className="mb-1 block text-xs font-semibold text-secondary">Calculated on</span>
                  <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="TDS base">
                    <button type="button" role="radio" aria-checked={base === "taxable"} className={choiceCls(base === "taxable")} onClick={() => setBase("taxable")}>
                      <span className="block font-semibold text-primary">Value before GST <span className="text-[11px] font-normal text-emerald-700 dark:text-emerald-300">· usual</span></span>
                      <span className="block text-xs text-muted tabular-nums">{inr(invoice.sub_total)}</span>
                    </button>
                    <button type="button" role="radio" aria-checked={base === "total"} className={choiceCls(base === "total")} onClick={() => setBase("total")}>
                      <span className="block font-semibold text-primary">Invoice total (incl. GST)</span>
                      <span className="block text-xs text-muted tabular-nums">{inr(invoice.grand_total)}</span>
                    </button>
                  </div>
                </div>
              </div>
            </DialogSection>
          )}

          {mode === "choose" && (
            <WhatHappens tone="amber" items={deducted ? [
              { icon: Receipt, text: <>The invoice counts as settled by the cash <b>plus</b> the TDS.</> },
              { icon: Hourglass, text: <>TDS {inr(amount)} shows as <b>Pending from client</b> on this invoice and in the TDS register.</> },
              { icon: FileCheck2, text: "Mark it received when the Form 16A / 26AS shows it." },
            ] : [
              { icon: Receipt, text: "The full balance is expected in the bank." },
            ]} />
          )}
          {error && <DialogFailure message={error} />}
        </div>

        <aside className="h-max space-y-3 rounded-card border border-subtle bg-surface-1 p-4 shadow-raised lg:sticky lg:top-0">
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted">{num}</div>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Value before GST</dt><dd className="tabular-nums text-primary">{inr(invoice.sub_total)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">GST</dt><dd className="tabular-nums text-primary">{inr(gst)}</dd></div>
            <div className="flex justify-between border-t border-subtle pt-1"><dt className="font-semibold text-secondary">Invoice total</dt><dd className="font-semibold tabular-nums text-primary">{inr(invoice.grand_total)}</dd></div>
            {Number(invoice.paid_amount || 0) > 0 && (
              <div className="flex justify-between"><dt className="text-muted">Already received</dt><dd className="tabular-nums text-primary">− {inr(invoice.paid_amount)}</dd></div>
            )}
            <div className="flex justify-between"><dt className="text-muted">Open balance</dt><dd className="tabular-nums text-primary">{inr(balance)}</dd></div>
            {deducted && (
              <div className="flex justify-between text-amber-700 dark:text-amber-300">
                <dt>TDS {rateOk ? `${r}%` : ""}<span className="block text-[11px]">on {inr(baseAmount)}</span></dt><dd className="font-semibold tabular-nums">− {inr(amount)}</dd>
              </div>
            )}
          </dl>
          <div className="rounded-control bg-emerald-50 p-3 dark:bg-emerald-950/30">
            <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">To receive from the customer</div>
            <div className="text-2xl font-extrabold tabular-nums text-emerald-700 dark:text-emerald-300">{inr(net)}</div>
          </div>
          {deducted && (
            <div className="rounded-control bg-amber-50 p-3 dark:bg-amber-950/30">
              <div className="text-[11px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">TDS pending from client</div>
              <div className="text-xl font-bold tabular-nums text-amber-700 dark:text-amber-300">{inr(amount)}</div>
              <p className="mt-0.5 text-[11px] text-amber-800/80 dark:text-amber-200/80">Kept separately until Form 16A.</p>
            </div>
          )}
        </aside>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------ the detail pop-up */

type TdsReceipt = { id: number; payment_date: string | null; amount: number; transaction_id?: string | null; notes?: string | null };

/**
 * "TDS pending from client for this invoice" — the facts, the history, and
 * (for Finance) Mark received (Form 16A).
 */
export function TdsDetailModal({ tds, invoiceNumber, canMark, onClose, onChanged }: {
  tds: TdsInfo;
  invoiceNumber?: string | null;
  canMark: boolean;
  onClose: () => void;
  onChanged?: (message: string) => void;
}) {
  const [history, setHistory] = useState<TdsReceipt[] | null>(null);
  const [amount, setAmount] = useState(String(Number(tds.tds_balance || 0)));
  const [date, setDate] = useState(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
  const [cert, setCert] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = Number(tds.tds_balance || 0);
  const num = invoiceNumber || tds.invoice_number || `#${tds.invoice_id}`;

  useEffect(() => {
    let alive = true;
    crmGet<TdsReceipt[]>(`/api/invoices/${tds.invoice_id}/tds-payments`)
      .then((r) => { if (alive) setHistory(r.data || []); })
      .catch(() => { if (alive) setHistory([]); });
    return () => { alive = false; };
  }, [tds.invoice_id]);

  const amt = Number(amount);
  const problem = !(amt > 0) ? "Enter the TDS amount received" : amt > pending + 0.001 ? `More than the pending ${inr(pending)}` : "";
  const mark = async () => {
    if (problem) return;
    setBusy(true);
    setError("");
    try {
      await crmPost(`/api/invoices/${tds.invoice_id}/tds-payment`, {
        amount: amt, payment_date: date || null, transaction_id: cert.trim() || null, notes: notes.trim() || null,
      });
      onChanged?.(amt >= pending ? `TDS on ${num} marked received` : `Part of the TDS on ${num} marked received`);
    } catch (e: any) {
      setError(e?.message || "Could not save");
      setBusy(false);
    }
  };

  const rateLine = tds.tds_rate != null
    ? `${tds.tds_rate}% on ${tds.tds_base === "total" ? "the invoice total" : "the value before GST"}${tds.base_amount != null ? ` (${inr(tds.base_amount)})` : ""}`
    : "Amount entered by hand";
  return (
    <Modal title={`TDS on ${num}`} onClose={onClose} medium
      hero={<DialogHero tone={pending > 0 ? "amber" : "emerald"} icon={pending > 0 ? Hourglass : BadgeCheck}
        eyebrow={pending > 0 ? "TDS pending from client" : "TDS received"}
        title={<>{inr(tds.tds_amount)} TDS on {num}</>}
        subtitle={pending > 0
          ? "The customer withheld this from the payment. It stays pending until the Form 16A / 26AS shows it."
          : "The certificate is in — nothing pending on this invoice."} />}
      footer={canMark && pending > 0 ? (
        <DialogActions tone="emerald" icon={FileCheck2} label={`Mark ${inr(amt || 0)} received`} busy={busy}
          disabled={!!problem} onCancel={onClose} onConfirm={() => void mark()}
          hint={problem ? <span className="text-warning">{problem}</span> : "When the Form 16A / 26AS shows this TDS"} />
      ) : undefined}
    >
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <Fact icon={Percent} label="Deducted">{rateLine}</Fact>
          <Fact icon={Landmark} label="Section">{tds.section || "—"}</Fact>
          <Fact icon={CalendarClock} label="Deducted on">
            {tds.deducted_on || tds.created_at ? new Date(tds.deducted_on || tds.created_at || "").toLocaleDateString() : "—"}
            {tds.pending_days != null && pending > 0 && <span className="ml-1 text-amber-700 dark:text-amber-300">· pending {tds.pending_days} d</span>}
          </Fact>
          <Fact icon={Hourglass} label="Status">
            <span className={pending > 0 ? "font-semibold text-amber-700 dark:text-amber-300" : "font-semibold text-emerald-700 dark:text-emerald-300"}>{tdsStatusLabel(tds)}</span>
            {Number(tds.tds_paid || 0) > 0 && pending > 0 && <span className="text-muted"> · {inr(tds.tds_paid)} received, {inr(pending)} pending</span>}
          </Fact>
        </div>

        <section>
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Received so far</h3>
          {history == null ? <p className="text-xs text-muted">Loading…</p>
            : history.length === 0 ? <p className="text-xs text-muted">Nothing marked received yet.</p> : (
              <ul className="space-y-1 text-sm">
                {history.map((h) => (
                  <li key={h.id} className="flex justify-between gap-2 rounded-control bg-surface-2 px-3 py-1.5">
                    <span>{h.payment_date ? new Date(h.payment_date).toLocaleDateString() : "—"}
                      {h.transaction_id && <span className="ml-1.5 font-mono text-xs text-muted">{h.transaction_id}</span>}
                      {h.notes && <span className="ml-1.5 text-xs text-muted">{h.notes}</span>}</span>
                    <span className="font-semibold tabular-nums">{inr(h.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
        </section>

        {canMark && pending > 0 && (
          <section className="rounded-card border border-subtle bg-surface-1 p-3">
            <h3 className="mb-2 text-sm font-bold text-primary">Mark received (Form 16A)</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="mb-1 block text-xs font-semibold text-secondary">Amount (₹)</span>
                <input type="number" min={0} step="0.01" className={`${inputCls} tabular-nums`} value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className="block"><span className="mb-1 block text-xs font-semibold text-secondary">Received on</span>
                <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="block"><span className="mb-1 block text-xs font-semibold text-secondary">Form 16A / certificate no.</span>
                <input className={`${inputCls} font-mono`} value={cert} maxLength={64} onChange={(e) => setCert(e.target.value)} />
              </label>
              <label className="block"><span className="mb-1 block text-xs font-semibold text-secondary">Note</span>
                <input className={inputCls} value={notes} maxLength={255} placeholder="e.g. Q2 FY26-27, seen in 26AS" onChange={(e) => setNotes(e.target.value)} />
              </label>
            </div>
          </section>
        )}
        {error && <DialogFailure message={error} />}
        <p className="text-xs">
          <CrmLink to={`invoices/${tds.invoice_id}`} className="font-semibold text-sky-600 hover:underline">Open invoice {num}</CrmLink>
        </p>
      </div>
    </Modal>
  );
}

function Fact({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-control bg-surface-2 px-3 py-2">
      <Icon size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden />
      <div className="min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</div>
        <div className="text-sm text-primary">{children}</div>
      </div>
    </div>
  );
}
