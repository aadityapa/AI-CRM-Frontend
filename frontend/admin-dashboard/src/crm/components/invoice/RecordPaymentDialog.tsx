/**
 * Record Payment — the redesigned dialog (2 Nov 2026, Finance ask with a screenshot:
 * the three "Received Amount" cards overlapped their own text, and Finance wanted to
 * go straight to "Map invoices" from here).
 *
 * Layout (dialog kit, emerald): hero with the invoice and what is still to collect →
 *  1 Where this money is — Don't link · From a received amount · Add to Received Amount,
 *    the customer's credits on account as cards (a "Likely match" chip when one equals
 *    the balance) and, on each, "Map to several invoices" — the receipt's own Map
 *    invoices dialog opens on top, in place;
 *  2 The payment — amount with quick fills, date, mode chips, reference;
 *  3 Notes (optional);
 * and a sticky aside: the invoice before → after this payment, and what stays on account.
 *
 * Same endpoint and payload as before: POST /api/invoices/{id}/record-payment.
 */
import { Suspense, useState } from "react";
import {
  ArrowDownToLine, ArrowRight, CalendarDays, CheckCircle2, ExternalLink, IndianRupee, Info, Link2, Lock,
  PlusCircle, Receipt as ReceiptIcon, Sparkles, Unlink, Wallet,
} from "lucide-react";
import { crmGet, crmPost } from "../../api";
import { CrmLink } from "../../router";
import { Modal, inputCls } from "../ui";
import {
  DialogActions, DialogFailure, DialogHero, DialogSection, WhatHappens, useCtrlEnter,
} from "../dialogKit";
import { lazyRetry } from "../../../lib/lazyRetry";
import type { Receipt } from "../../pages/receipts/receiptShared";
import {
  linkPayload, paymentCap, usePaymentOptions, type LinkKind, type ReceiptOnAccount,
} from "./PaymentLink";

// The receipt workbench lives on the Received Amount page — load it only when asked.
const MapInvoicesModal = lazyRetry(() =>
  import("../../pages/receipts/ReceiptWorkbench").then((m) => ({ default: m.MapInvoicesModal })));

export const PAYMENT_MODES = ["Bank Transfer", "NEFT", "RTGS", "IMPS", "UPI", "Cheque", "Cash", "Wire", "Other"];

/** Within this much of the balance a credit "matches" the invoice. */
const MATCH_TOLERANCE = 1;

const rupee = (v: number | null | undefined) =>
  `₹${Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const isoDaysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDay = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/** PURE: how a credit on account sits against this invoice's balance. */
export function receiptFit(balance: number, onAccount: number): "match" | "covers" | "part" {
  const b = Math.max(0, Number(balance) || 0);
  const a = Math.max(0, Number(onAccount) || 0);
  if (Math.abs(a - b) < MATCH_TOLERANCE) return "match";
  return a > b ? "covers" : "part";
}

/** PURE: the invoice after this payment. */
export function paymentEffect(grand: number, balance: number, amount: number) {
  const g = Math.max(0, Number(grand) || 0);
  const b = Math.max(0, Number(balance) || 0);
  const a = Math.max(0, Math.min(Number(amount) || 0, b));
  const before = Math.max(0, g - b);
  const after = before + a;
  return {
    receivedBefore: before,
    balanceAfter: Math.max(0, Math.round((b - a) * 100) / 100),
    pctBefore: g > 0 ? Math.min(100, (before / g) * 100) : 0,
    pctAfter: g > 0 ? Math.min(100, (after / g) * 100) : 0,
    settles: b > 0 && a >= b - 0.005,
  };
}

function SourceCard({ active, onClick, icon: Icon, title, hint, disabled, badge }: {
  active: boolean; onClick: () => void; icon: typeof Link2; title: string; hint: string;
  disabled?: boolean; badge?: string | null;
}) {
  return (
    <button type="button" role="radio" aria-checked={active} onClick={onClick} disabled={disabled}
      className={`group relative flex h-full flex-col items-start gap-2 rounded-xl border p-3 text-left transition-all duration-micro disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? "border-emerald-500 bg-emerald-50 shadow-sm ring-1 ring-emerald-500 dark:bg-emerald-950/40"
          : "border-subtle bg-surface-1 hover:border-strong hover:bg-surface-2"}`}>
      <span className="flex w-full items-center justify-between gap-2">
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${active ? "bg-emerald-600 text-white" : "bg-surface-2 text-secondary"}`}>
          <Icon size={16} aria-hidden />
        </span>
        {badge && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${active ? "bg-emerald-600 text-white" : "bg-surface-2 text-secondary"}`}>
            {badge}
          </span>
        )}
      </span>
      <span className="text-sm font-bold leading-tight text-primary">{title}</span>
      <span className="text-xs leading-snug text-muted">{hint}</span>
    </button>
  );
}

function ReceiptCard({ r, on, balance, onPick, onMap }: {
  r: ReceiptOnAccount; on: boolean; balance: number; onPick: () => void; onMap: () => void;
}) {
  const fit = receiptFit(balance, r.unallocated_amount);
  return (
    <div className={`rounded-xl border transition-colors ${
      on ? "border-emerald-500 bg-emerald-50/70 ring-1 ring-emerald-500 dark:bg-emerald-950/30" : "border-subtle bg-surface-1 hover:bg-surface-2"}`}>
      <button type="button" role="radio" aria-checked={on} onClick={onPick}
        className="flex w-full items-start gap-3 px-3 pt-3 text-left">
        <span className={`mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${on ? "border-emerald-600" : "border-slate-400"}`}>
          {on && <span className="h-2 w-2 rounded-full bg-emerald-600" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-bold text-primary">Received amount #{r.id}</span>
            {fit === "match" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                <Sparkles size={10} aria-hidden /> Likely match
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-secondary">
            Received {fmtDay(r.received_date)} · {rupee(r.amount)}
          </span>
          <span className="block truncate text-xs text-muted">
            {[r.payment_mode, r.reference_number, r.branch_name].filter(Boolean).join(" · ") || "No mode or reference"}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{rupee(r.unallocated_amount)}</span>
          <span className="block text-[11px] text-muted">on account</span>
        </span>
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-subtle px-3 py-2 text-xs">
        <span className="text-muted">
          {fit === "match" ? "Equals this invoice's balance"
            : fit === "covers" ? `Covers this invoice — ${rupee(r.unallocated_amount - balance)} stays on account`
            : `Pays part of this invoice — ${rupee(balance - r.unallocated_amount)} still due`}
        </span>
        <button type="button" onClick={onMap}
          className="ml-auto inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-300">
          <Link2 size={12} aria-hidden /> Map to several invoices <ArrowRight size={12} aria-hidden />
        </button>
      </div>
    </div>
  );
}

function AsideRow({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "ok" | "warn" | "muted" }) {
  const color = tone === "ok" ? "text-emerald-700 dark:text-emerald-300" : tone === "warn" ? "text-amber-700 dark:text-amber-300"
    : tone === "muted" ? "text-muted" : "text-primary";
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs text-secondary">{label}</span>
      <span className={`tabular-nums ${strong ? "text-base font-bold" : "text-sm font-semibold"} ${color}`}>{value}</span>
    </div>
  );
}

export function RecordPaymentDialog({ invoice, onClose, onSaved, onError }: {
  invoice: any;
  onClose: () => void;
  onSaved: (msg?: string) => void;
  onError: (msg: string) => void;
}) {
  const { opts, failed } = usePaymentOptions(invoice.id);
  const [kind, setKind] = useState<LinkKind>("none");
  const [receipt, setReceipt] = useState<ReceiptOnAccount | null>(null);
  const [paymentDate, setPaymentDate] = useState(isoToday());
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("Bank Transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const [mapping, setMapping] = useState<Receipt | null>(null);
  const [opening, setOpening] = useState<number | null>(null);

  const receipts = opts?.receipts_on_account || [];
  const fromReceipt = kind === "from" && receipt != null;
  const balance = Number(invoice.balance_amount || 0);
  const grand = Number(invoice.grand_total || 0);
  const cap = paymentCap(balance, fromReceipt ? receipt : null);
  const amtN = amount === "" ? undefined : Number(amount);
  const amountErr =
    amount === "" ? "" :
    amtN === undefined || !Number.isFinite(amtN) || amtN <= 0 ? "Enter an amount above zero" :
    amtN > balance + 0.005 ? `More than the balance (${rupee(balance)})` :
    fromReceipt && amtN > cap + 0.005 ? `Only ${rupee(cap)} of received amount #${receipt!.id} is on account` : "";
  const effect = paymentEffect(grand, balance, amountErr ? 0 : amtN || 0);
  const leftOnAccount = fromReceipt && !amountErr && amtN ? Math.max(0, receipt!.unallocated_amount - amtN) : null;

  const missing =
    kind === "from" && !receipt ? "Pick the received amount this money comes from" :
    amount === "" ? "Enter the amount received" :
    amountErr ? amountErr :
    !paymentDate ? "Pick the payment date" : "";

  const pickReceipt = (r: ReceiptOnAccount) => {
    setReceipt(r);
    // The payment IS that credit — its date / mode / reference; amount up to what is left.
    if (r.received_date) setPaymentDate(String(r.received_date).slice(0, 10));
    if (r.payment_mode) setMode(r.payment_mode);
    setReference(r.reference_number || "");
    setAmount(String(paymentCap(balance, r)));
  };
  const pickKind = (k: LinkKind) => {
    setKind(k);
    if (k !== "from") setReceipt(null);
    if (k === "from" && !receipt) {
      const match = receipts.find((r) => receiptFit(balance, r.unallocated_amount) === "match");
      if (match) pickReceipt(match);
      else if (receipts.length === 1) pickReceipt(receipts[0]);
    }
  };

  const openMap = async (id: number) => {
    setOpening(id);
    try {
      const r = await crmGet<Receipt>(`/api/customer-receipts/${id}`);
      if (r.data) setMapping(r.data);
    } catch (e: any) {
      onError(e?.message || "That received amount could not be opened");
    } finally {
      setOpening(null);
    }
  };

  const submit = async () => {
    if (missing || busy) return;
    setBusy(true);
    setServerError("");
    try {
      const payload: any = { payment_date: paymentDate, amount: amtN, payment_mode: mode,
        ...linkPayload(kind, receipt?.id ?? null) };
      if (reference.trim()) payload.reference_number = reference.trim();
      if (notes.trim()) payload.notes = notes.trim();
      const r = await crmPost<any>(`/api/invoices/${invoice.id}/record-payment`, payload);
      onSaved(r.message || "Payment recorded");
    } catch (e: any) {
      const msg = e?.message || "Failed to record payment";
      setServerError(msg);
      onError(msg);
      setBusy(false);
    }
  };
  useCtrlEnter(() => { if (!mapping) void submit(); });

  const invNo = invoice.invoice_number || `Invoice #${invoice.id}`;
  const customer = opts?.customer_name || invoice.customer_name || invoice.buyer?.name || null;
  const dirty = amount !== "" || kind !== "none" || !!reference || !!notes;

  return (
    <>
      <Modal title="Record Payment" xl onClose={onClose} dirty={dirty && !busy}
        hero={<DialogHero tone="emerald" icon={IndianRupee} eyebrow={`Record payment · ${invNo}`}
          title={<>{rupee(balance)} still to collect</>}
          subtitle={[customer, opts?.branch_name].filter(Boolean).join(" · ") || "Log money received against this invoice"}
          chips={<>
            <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-white/25">Invoice total {rupee(grand)}</span>
            <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-white/25">Received so far {rupee(effect.receivedBefore)}</span>
            {receipts.length > 0 && (
              <span className="rounded-full bg-amber-300 px-2.5 py-0.5 text-[11px] font-bold text-[#1e293b]">
                {receipts.length} credit{receipts.length === 1 ? "" : "s"} on account
              </span>
            )}
          </>} />}
        footer={<DialogActions tone="emerald" icon={CheckCircle2} busy={busy} busyLabel="Recording…"
          disabled={!!missing}
          label={amtN && !amountErr ? `Record ${rupee(amtN)}` : "Record payment"}
          onCancel={onClose} onConfirm={() => void submit()}
          hint={missing ? <span className={amount !== "" || kind === "from" ? "text-warning" : undefined}>{missing}</span> : "Ctrl + Enter to record"} />}>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 space-y-4">
            <DialogFailure message={serverError} />

            <DialogSection n={1} tone="emerald" title="Where is this money?" optional done={kind !== "none" ? (kind !== "from" || !!receipt) : true}
              hint="Link it to Received Amount so the register and the invoice tell the same story — or record it on this invoice only, as before.">
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Received Amount link">
                <SourceCard active={kind === "none"} onClick={() => pickKind("none")} icon={Unlink}
                  title="Don't link" hint="Record it on this invoice only." />
                <SourceCard active={kind === "from"} onClick={() => pickKind("from")} icon={ArrowDownToLine}
                  disabled={!opts || receipts.length === 0}
                  badge={receipts.length ? String(receipts.length) : null}
                  title="From a received amount"
                  hint={!opts ? "Reading this customer's credits…"
                    : receipts.length ? "Use money already on account for this customer."
                    : "Nothing on account for this customer."} />
                <SourceCard active={kind === "add"} onClick={() => pickKind("add")} icon={PlusCircle}
                  disabled={!opts?.customer_id}
                  title="Add to Received Amount" hint="Also save it in the register, mapped here." />
              </div>
              {failed && (
                <p className="mt-2 text-xs text-warning">Could not read this customer's received amounts — you can still record the payment unlinked.</p>
              )}

              {kind === "from" && receipts.length > 0 && (
                <div className="mt-3 space-y-2" role="radiogroup" aria-label="Received amount to take it from">
                  {receipts.map((r) => (
                    <ReceiptCard key={r.id} r={r} on={r.id === receipt?.id} balance={balance}
                      onPick={() => pickReceipt(r)}
                      onMap={() => void openMap(r.id)} />
                  ))}
                  {opening != null && <p className="text-xs text-muted">Opening received amount #{opening}…</p>}
                  <p className="flex items-start gap-1.5 text-xs text-muted">
                    <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
                    <span>
                      The payment takes that credit's date, mode and reference — it is the same money, now on this invoice.
                      One credit paying several invoices? Use <b>Map to several invoices</b>.{" "}
                      <CrmLink to="received-amounts" className="inline-flex items-center gap-0.5 font-semibold text-brand-600 hover:underline">
                        Open Received Amount <ExternalLink size={11} aria-hidden />
                      </CrmLink>
                    </span>
                  </p>
                </div>
              )}
              {kind === "add" && opts?.customer_id && (
                <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                  <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
                  <span>
                    A received amount for <b>{opts.customer_name || "this customer"}</b>
                    {opts.branch_name ? <> · {opts.branch_name}</> : null} is created with this date, amount, mode and reference,
                    already mapped to {invNo}.
                  </span>
                </p>
              )}
            </DialogSection>

            <DialogSection n={2} tone="emerald" title="The payment" done={!missing}
              hint={fromReceipt ? <>Date, mode and reference come from received amount #{receipt!.id}.</> : "What arrived, when and how."}>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-secondary">Amount received (₹) *</span>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-bold text-muted">₹</span>
                  <input type="number" min={0} step="0.01" inputMode="decimal" value={amount}
                    onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
                    className={`${inputCls} !h-12 !pl-8 text-xl font-bold tabular-nums ${amountErr ? "input-error" : ""}`} />
                </div>
                {amountErr && <span className="mt-1 block text-xs font-semibold text-danger">{amountErr}</span>}
              </label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setAmount(String(cap))}
                  className="rounded-full border border-subtle bg-surface-2 px-2.5 py-1 text-xs font-semibold text-secondary hover:border-strong hover:text-primary">
                  {fromReceipt && cap < balance ? `All on account · ${rupee(cap)}` : `Full balance · ${rupee(balance)}`}
                </button>
                {balance > 0 && !fromReceipt && (
                  <button type="button" onClick={() => setAmount(String(Math.round((balance / 2) * 100) / 100))}
                    className="rounded-full border border-subtle bg-surface-2 px-2.5 py-1 text-xs font-semibold text-secondary hover:border-strong hover:text-primary">
                    Half · {rupee(balance / 2)}
                  </button>
                )}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 flex items-center gap-1 text-xs font-semibold text-secondary">
                    <CalendarDays size={12} aria-hidden /> Payment date *
                    {fromReceipt && <Lock size={11} className="text-muted" aria-label="Taken from the received amount" />}
                  </span>
                  <input type="date" className={inputCls} value={paymentDate} disabled={fromReceipt} max={isoToday()}
                    onChange={(e) => setPaymentDate(e.target.value)} />
                  {!fromReceipt && (
                    <span className="mt-1 flex gap-1.5">
                      {[["Today", isoToday()], ["Yesterday", isoDaysAgo(1)]].map(([l, v]) => (
                        <button key={l} type="button" onClick={() => setPaymentDate(v)}
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${paymentDate === v ? "bg-emerald-600 text-white" : "bg-surface-2 text-secondary hover:text-primary"}`}>
                          {l}
                        </button>
                      ))}
                    </span>
                  )}
                </label>
                <label className="block">
                  <span className="mb-1 flex items-center gap-1 text-xs font-semibold text-secondary">
                    <ReceiptIcon size={12} aria-hidden /> Reference (UTR / cheque no.)
                    {fromReceipt && <Lock size={11} className="text-muted" aria-label="Taken from the received amount" />}
                  </span>
                  <input className={inputCls} value={reference} disabled={fromReceipt} placeholder="e.g. UTR202656"
                    onChange={(e) => setReference(e.target.value)} />
                </label>
              </div>

              <div className="mt-3">
                <span className="mb-1 block text-xs font-semibold text-secondary">Payment mode</span>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Payment mode">
                  {Array.from(new Set([...PAYMENT_MODES, mode])).filter(Boolean).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={fromReceipt && mode !== m}
                      onClick={() => setMode(m)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-40 ${
                        mode === m ? "border-transparent bg-gradient-to-r from-emerald-500 to-teal-600 text-white"
                          : "border-subtle bg-surface-2 text-secondary hover:border-strong hover:text-primary"}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </DialogSection>

            <DialogSection n={3} tone="emerald" title="Notes" optional done={!!notes.trim()}>
              <textarea className={inputCls} rows={2} value={notes} maxLength={1000}
                placeholder="e.g. Customer paid net of bank charges"
                onChange={(e) => setNotes(e.target.value)} />
            </DialogSection>
          </div>

          <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
            <div className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">{invNo} after this payment</p>
              <div className="relative h-2.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                <div className="absolute inset-y-0 left-0 bg-emerald-300 dark:bg-emerald-800" style={{ width: `${effect.pctAfter}%` }} />
                <div className="absolute inset-y-0 left-0 bg-emerald-600" style={{ width: `${effect.pctBefore}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-muted">{Math.round(effect.pctAfter)}% of the invoice received</p>
              <div className="mt-3 divide-y divide-[color:var(--border-subtle,transparent)]">
                <AsideRow label="Invoice total" value={rupee(grand)} />
                <AsideRow label="Received so far" value={rupee(effect.receivedBefore)} tone="muted" />
                <AsideRow label="This payment" value={amtN && !amountErr ? `+ ${rupee(amtN)}` : "—"} tone="ok" />
                <AsideRow label="Balance after" value={rupee(effect.balanceAfter)} strong tone={effect.balanceAfter > 0 ? "warn" : "ok"} />
              </div>
              {effect.settles && (
                <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                  <CheckCircle2 size={13} aria-hidden /> The invoice will read Paid
                </p>
              )}
            </div>

            {fromReceipt && (
              <div className="rounded-card border border-subtle bg-surface-1 p-4">
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
                  <Wallet size={12} aria-hidden /> Received amount #{receipt!.id}
                </p>
                <AsideRow label="On account now" value={rupee(receipt!.unallocated_amount)} />
                <AsideRow label="Left on account after" value={leftOnAccount == null ? "—" : rupee(leftOnAccount)}
                  strong tone={leftOnAccount ? "warn" : "ok"} />
                {!!leftOnAccount && leftOnAccount > 0 && (
                  <button type="button" onClick={() => void openMap(receipt!.id)}
                    className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-300">
                    <Link2 size={13} aria-hidden /> Map the rest to other invoices
                  </button>
                )}
              </div>
            )}

            <WhatHappens tone="emerald" items={[
              { icon: CheckCircle2, text: <>The invoice's balance and payment status are worked out again.</> },
              kind === "from" && receipt
                ? { icon: Wallet, text: <>Received amount #{receipt.id} goes down by what is applied here.</> }
                : kind === "add"
                  ? { icon: PlusCircle, text: <>A received amount is added to the register, already mapped.</> }
                  : { icon: Unlink, text: <>Not linked — it stays on this invoice only.</> },
              { icon: Info, text: <>Dashboards count it as collected in the invoice's month. You can reverse it later from Payment History.</> },
            ]} />
          </aside>
        </div>
      </Modal>

      {mapping && (
        <Suspense fallback={null}>
          <MapInvoicesModal receipt={mapping}
            onClose={() => setMapping(null)}
            onSaved={(msg) => { setMapping(null); onSaved(msg || "Invoices mapped"); }} />
        </Suspense>
      )}
    </>
  );
}
