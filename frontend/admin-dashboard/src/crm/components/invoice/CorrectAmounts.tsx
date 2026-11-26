/** Admin / CEO correct an invoice's amounts by hand (24 Nov 2026, user ask with a
 *  screenshot: Orbit showed ₹3,22,541.00 for an invoice issued at ₹3,22,537.66).
 *
 *  The typed figures — amount before GST, CGST + SGST or IGST, an optional
 *  round-off — become the invoice's amounts everywhere (sheet, PDF, Word,
 *  e-invoice, lists, dashboards). The server (`PUT /api/invoices/{id}/amounts`,
 *  Admin / CEO by role) moves the PO by the difference, refreshes the balance
 *  and logs it; `POST …/amounts/undo` puts the amounts back. PURE helpers
 *  mirror `services/invoice_amounts.py`. */
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Calculator, IndianRupee, Layers, RotateCcw, ScrollText } from "lucide-react";
import { crmPost, crmPut } from "../../api";
import { Modal, inputCls } from "../ui";
import {
  DecisionDialog, DialogActions, DialogFailure, DialogHero, DialogSection, QuickPicks, ReasonBox, WhatHappens,
  useCtrlEnter,
} from "../dialogKit";

export type AmountCorrection = {
  sub_total: number; cgst: number; sgst: number; igst: number; total_gst: number;
  round_off: number | null; grand_total: number;
  reason?: string | null; by_name?: string | null; at?: string | null;
  previous_grand_total?: number | null; previous_sub_total?: number | null;
};

const MIN_REASON = 10;
const MAX_ROUND_OFF = 100;

const paise = (v: number) => Math.round(v * 100) / 100;
/** "₹3,22,537.66" — always two decimals, the invoice's own format. */
export const money = (v: number) =>
  `₹${Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Text box → number; blank = 0, junk = NaN. PURE. */
export function toNum(raw: string): number {
  const t = String(raw ?? "").replace(/[₹,\s]/g, "");
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** 18 % GST on `sub`: CGST + SGST (same state) or IGST — the server's `gst_parts`. PURE. */
export function gstFor(sub: number, inter: boolean): { cgst: number; sgst: number; igst: number } {
  const total = paise(sub * 0.18);
  if (inter) return { cgst: 0, sgst: 0, igst: total };
  const half = paise(total / 2);
  return { cgst: half, sgst: paise(total - half), igst: 0 };
}

export type Figures = { sub: number; cgst: number; sgst: number; igst: number; gst: number; roundOff: number | null; total: number };

/** The full set from what was typed. PURE. */
export function figuresOf(sub: number, cgst: number, sgst: number, igst: number, roundOff: number | null): Figures {
  const gst = paise(cgst + sgst + igst);
  return { sub: paise(sub), cgst: paise(cgst), sgst: paise(sgst), igst: paise(igst), gst, roundOff,
    total: paise(sub + gst + (roundOff ?? 0)) };
}

/** Why the figures cannot be saved, in words — the server's `problems`. PURE. */
export function amountsProblem(f: Figures): string | null {
  if ([f.sub, f.cgst, f.sgst, f.igst].some((n) => Number.isNaN(n)) || (f.roundOff != null && Number.isNaN(f.roundOff))) {
    return "Type amounts as numbers, e.g. 273337.00";
  }
  if (f.sub <= 0) return "Type the amount before GST";
  if (Math.min(f.cgst, f.sgst, f.igst) < 0) return "GST cannot be negative";
  if (f.igst > 0 && (f.cgst > 0 || f.sgst > 0)) return "Use CGST + SGST or IGST, not both";
  if (Math.abs(f.cgst - f.sgst) > 0.01) return "CGST and SGST are the same amount";
  if (f.roundOff != null && Math.abs(f.roundOff) > MAX_ROUND_OFF) return `A round-off above ₹${MAX_ROUND_OFF} looks like a typing slip`;
  if (f.gst > 0) {
    const expected = f.sub * 0.18;
    if (Math.abs(f.gst - expected) > expected * 0.005 + 1) return `GST is not 18 % of the amount (that is ${money(expected)})`;
  }
  return null;
}

/** The small "Amounts corrected by hand" line under the totals. */
export function AmountCorrectionNote({ correction }: { correction?: AmountCorrection | null }) {
  if (!correction) return null;
  const prev = correction.previous_grand_total;
  return (
    <p className="mx-4 mb-2 rounded-control bg-indigo-50 px-2.5 py-1.5 text-[11px] text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200">
      Amounts corrected by hand{correction.by_name ? ` by ${correction.by_name}` : ""}
      {correction.at ? ` on ${new Date(correction.at).toLocaleDateString("en-IN")}` : ""}
      {prev != null ? ` (was ${money(prev)})` : ""}
      {correction.reason ? ` — ${correction.reason}` : ""}
    </p>
  );
}

const REASONS = [
  "Match the invoice issued to the customer",
  "Rounding difference with the issued invoice",
  "Invoice was raised outside Orbit with these figures",
  "Customer approved these amounts",
];

export function CorrectAmountsDialog({
  invoiceId, invoiceNumber, current, isProforma, received, onClose, onDone,
}: {
  invoiceId: number;
  invoiceNumber: string;
  /** What Orbit shows now. */
  current: { sub: number; cgst: number; sgst: number; igst: number; roundOff: number | null; total: number };
  isProforma: boolean;
  /** Cash + TDS + settled — money already against the invoice. */
  received: number;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const startInter = current.igst > 0 && current.cgst + current.sgst === 0;
  const [inter, setInter] = useState(startInter);
  const [sub, setSub] = useState(current.sub.toFixed(2));
  const [half, setHalf] = useState((startInter ? 0 : current.cgst).toFixed(2));
  const [igst, setIgst] = useState((startInter ? current.igst : 0).toFixed(2));
  const [roundOff, setRoundOff] = useState(current.roundOff == null ? "" : current.roundOff.toFixed(2));
  const [gstTouched, setGstTouched] = useState(false);
  const [typedTotal, setTypedTotal] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // GST follows the amount at 18 % until someone types it — never on opening
  // (the figures Orbit holds now are shown as they are).
  const opened = useRef(true);
  useEffect(() => {
    if (opened.current) { opened.current = false; return; }
    if (gstTouched) return;
    const n = toNum(sub);
    if (!Number.isFinite(n)) return;
    const g = gstFor(n, inter);
    setHalf(g.cgst.toFixed(2));
    setIgst(g.igst.toFixed(2));
  }, [sub, inter, gstTouched]);

  const f = useMemo(() => {
    const h = inter ? 0 : toNum(half);
    return figuresOf(toNum(sub), h, h, inter ? toNum(igst) : 0, roundOff.trim() === "" ? null : toNum(roundOff));
  }, [sub, half, igst, roundOff, inter]);
  const problem = amountsProblem(f);
  const diff = Number.isFinite(f.total) ? paise(f.total - current.total) : 0;
  const reasonOk = reason.trim().length >= MIN_REASON;
  const unchanged = Math.abs(diff) < 0.005 && Math.abs(f.sub - current.sub) < 0.005;
  const missing = problem || (unchanged ? "Change at least one amount" : null)
    || (!reasonOk ? `Reason: ${MIN_REASON - reason.trim().length} more characters` : null);
  const excess = paise(received - f.total);

  const workOutTotal = (typed: string) => {
    // "I only know the invoice total": round-off = total − amount − GST.
    const t = toNum(typed);
    if (!Number.isFinite(t) || t <= 0) return;
    const ro = paise(t - f.sub - f.gst);
    setRoundOff(Math.abs(ro) < 0.005 ? "" : ro.toFixed(2));
  };

  const save = async () => {
    if (missing || busy) return;
    setBusy(true); setErr("");
    try {
      const res = await crmPut<unknown>(`/api/invoices/${invoiceId}/amounts`, {
        sub_total: f.sub, cgst: f.cgst, sgst: f.sgst, igst: f.igst,
        round_off: f.roundOff, reason: reason.trim(),
      });
      onDone(res.message || "Amounts corrected");
    } catch (e: any) {
      setErr(e?.message || "Could not correct the amounts");
      setBusy(false);
    }
  };
  useCtrlEnter(() => void save());

  const field = (id: string, label: string, value: string, onChange: (v: string) => void, opts: { hint?: string; disabled?: boolean } = {}) => (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-xs font-semibold text-secondary">{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">₹</span>
        <input id={id} inputMode="decimal" className={`${inputCls} pl-7 text-right tabular-nums`} value={value}
               disabled={opts.disabled} onChange={(e) => onChange(e.target.value)} />
      </div>
      {opts.hint && <span className="mt-1 block text-[11px] text-muted">{opts.hint}</span>}
    </label>
  );

  return (
    <Modal
      title={`Correct the amounts — ${invoiceNumber}`}
      medium
      onClose={() => { if (!busy) onClose(); }}
      dirty={!unchanged || reason.trim().length > 0}
      hero={<DialogHero tone="indigo" icon={Calculator} eyebrow="Admin correction" title="Correct the invoice amounts"
                        subtitle={<>{invoiceNumber} · now <span className="font-semibold">{money(current.total)}</span></>} />}
      footer={<DialogActions onCancel={onClose} busy={busy} tone="indigo" icon={Calculator}
                             label={`Save ${Number.isFinite(f.total) ? money(f.total) : ""}`} busyLabel="Saving…"
                             disabled={!!missing} onConfirm={() => void save()} hint={missing || "Ctrl + Enter saves"} />}
    >
      <div className="space-y-4">
        <DialogSection n={1} tone="indigo" title="The amounts on the invoice that was issued" done={!problem}
                       hint="Type them exactly as the issued invoice shows them.">
          <div className="grid gap-3 sm:grid-cols-2">
            {field("amt-sub", "Amount before GST (sub-total)", sub, setSub)}
            <div>
              <span className="mb-1 block text-xs font-semibold text-secondary">GST — same state or another state</span>
              <div className="flex rounded-control border border-subtle p-0.5" role="radiogroup" aria-label="GST type">
                {([[false, "CGST + SGST"], [true, "IGST"]] as const).map(([v, label]) => (
                  <button key={String(v)} type="button" role="radio" aria-checked={inter === v}
                          onClick={() => setInter(v)}
                          className={`flex-1 rounded-[5px] px-2 py-1.5 text-xs font-semibold ${inter === v ? "bg-indigo-600 text-white" : "text-secondary hover:bg-surface-2"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {inter
              ? field("amt-igst", "IGST @ 18 %", igst, (v) => { setGstTouched(true); setIgst(v); })
              : (
                <>
                  {field("amt-cgst", "CGST @ 9 %", half, (v) => { setGstTouched(true); setHalf(v); })}
                  {field("amt-sgst", "SGST @ 9 %", half, (v) => { setGstTouched(true); setHalf(v); }, { hint: "Always the same as CGST" })}
                </>
              )}
            {field("amt-ro", "Round off (optional)", roundOff, (v) => { setTypedTotal(""); setRoundOff(v); }, { hint: "e.g. −0.66 or 0.34 — leave blank when none" })}
            {field("amt-total", "…or type the invoice total", typedTotal, (v) => { setTypedTotal(v); workOutTotal(v); },
                   { hint: "Works out the round-off from the total" })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <QuickPicks label="GST" tone="indigo" options={["Work out 18 %"]} active={null}
                        onPick={() => { setGstTouched(false); const g = gstFor(toNum(sub), inter); setHalf(g.cgst.toFixed(2)); setIgst(g.igst.toFixed(2)); }} />
          </div>
        </DialogSection>

        <DialogSection n={2} tone="indigo" title="Before → after" done={!unchanged && !problem}>
          <div className="overflow-hidden rounded-card border border-subtle">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-muted">
                <tr><th className="px-3 py-2 text-left">Amount</th><th className="px-3 py-2 text-right">Now</th><th className="px-3 py-2 text-right">After</th></tr>
              </thead>
              <tbody className="divide-y divide-subtle tabular-nums">
                {[
                  ["Sub-total", current.sub, f.sub],
                  ["GST", paise(current.cgst + current.sgst + current.igst), f.gst],
                  ["Round off", current.roundOff ?? 0, f.roundOff ?? 0],
                ].map(([label, a, b]) => (
                  <tr key={label as string}>
                    <td className="px-3 py-1.5 text-secondary">{label}</td>
                    <td className="px-3 py-1.5 text-right">{money(a as number)}</td>
                    <td className={`px-3 py-1.5 text-right ${Math.abs((a as number) - (b as number)) > 0.004 ? "font-semibold text-indigo-700 dark:text-indigo-300" : ""}`}>
                      {Number.isFinite(b as number) ? money(b as number) : "—"}
                    </td>
                  </tr>
                ))}
                <tr className="bg-surface-2 font-bold">
                  <td className="px-3 py-2 text-primary">Grand total</td>
                  <td className="px-3 py-2 text-right">{money(current.total)}</td>
                  <td className="px-3 py-2 text-right text-primary">{Number.isFinite(f.total) ? money(f.total) : "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {!unchanged && Number.isFinite(diff) && (
            <p className={`mt-2 text-xs font-semibold ${diff < 0 ? "text-rose-700 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300"}`}>
              Difference {diff > 0 ? "+" : "−"}{money(Math.abs(diff))}
            </p>
          )}
          {excess > 0.004 && !problem && (
            <p className="mt-2 rounded-control bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {money(received)} is already received on this invoice — {money(excess)} more than the new total. The invoice
              will read Paid; take the extra back from Received Amount if it belongs to another invoice.
            </p>
          )}
        </DialogSection>

        <DialogSection n={3} tone="indigo" title="Why" done={reasonOk}>
          <ReasonBox id="amt-reason" label="Reason" required min={MIN_REASON} value={reason} onChange={setReason}
                     tone="indigo" picks={REASONS} placeholder="e.g. Match the invoice issued to UNO MINDA" />
        </DialogSection>

        <WhatHappens tone="indigo" items={[
          { icon: IndianRupee, text: <>The invoice, its PDF / Word copy and e-invoice print these amounts; lists, Received Amount and dashboards use them.</> },
          { icon: Layers, text: <>The service line takes the new sub-total so the table adds up.</> },
          ...(isProforma ? [] : [{ icon: ScrollText, text: <>The purchase order is drawn by the new sub-total (it moves by the difference).</> }]),
          { icon: BookOpen, text: <>Saved in the change history and on the customer's Activity Log — Undo puts the old amounts back.</> },
        ]} />
        <DialogFailure message={err} />
      </div>
    </Modal>
  );
}

/** Put back the amounts from before the hand correction. */
export function UndoAmountsDialog({ invoiceId, invoiceNumber, correction, onClose, onDone }: {
  invoiceId: number;
  invoiceNumber: string;
  correction: AmountCorrection;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  return (
    <DecisionDialog
      person={{ name: invoiceNumber, meta: `now ${money(correction.grand_total)}` }}
      spec={{
        tone: "rose", icon: RotateCcw, eyebrow: "Admin correction", title: "Undo the amount correction",
        intro: <>The invoice goes back to {correction.previous_grand_total != null ? money(correction.previous_grand_total) : "its earlier amounts"}
          {" "}(amounts worked out from its lines).</>,
        reason: { label: "Why undo it?", required: true, min: MIN_REASON, placeholder: "Corrected the wrong invoice…",
          picks: ["Corrected the wrong invoice", "The issued invoice was re-raised with Orbit's amounts"] },
        happens: [{ icon: RotateCcw, text: <>Sub-total, GST, total and the service line go back; the PO moves back too.</> }],
        confirmLabel: "Undo correction", busyLabel: "Undoing…",
      }}
      onClose={onClose}
      onConfirm={async (reason) => {
        const res = await crmPost<unknown>(`/api/invoices/${invoiceId}/amounts/undo`, { reason });
        onDone(res.message || "Amounts put back");
      }}
    />
  );
}
