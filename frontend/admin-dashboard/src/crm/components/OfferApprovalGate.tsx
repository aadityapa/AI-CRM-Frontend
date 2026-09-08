/**
 * The Sales → Sales Head approval gate, as two modals any surface can open.
 *
 *   customer shortlists → Sales SUBMITS the rate + customer onboarding date
 *   → "Pending Sales Head Approval" → Sales Head APPROVES (→ Pre Onboarding,
 *   HR notified), SENDS BACK the terms, or REJECTS.
 *
 * Both halves existed as pieces (an offer riding a generic status change; a
 * banner on the profile page) but no screen offered the step by name, so it
 * was skipped in practice (user report, 2 Sep 2026). These modals are the
 * step, and the profile page and the opportunity's Applied Candidates tab
 * both open them — one implementation, one wording, one endpoint each.
 *
 * Money is typed in LAKH and sent in RUPEES (the server's unit), the same
 * convention as every other CTC field in the CRM.
 */
import { useState } from "react";
import { BadgeCheck, IndianRupee, Send, Undo2, X } from "lucide-react";

import { crmPost } from "../api";
import { Field, Modal, btnPrimary, btnSecondary, inputCls } from "./ui";

const LAKH = 100_000;
const toRupees = (lac: string) => Math.round(Number(lac) * LAKH);
const toLac = (rupees?: number | null) =>
  rupees == null ? "" : String(Math.round((Number(rupees) / LAKH) * 100) / 100);

export type OfferTerms = {
  ctc?: number | null;                       // rupees, annualised
  joining_date?: string | null;              // the customer onboarding date
  offer_date?: string | null;
  /** The rate as Sales typed it (2 Sep 2026): unit + figure in that unit. */
  rate_unit?: string | null;
  rate_value?: number | null;
};

export type RateUnit = "Hourly" | "Monthly" | "Yearly";
const RATE_UNITS: RateUnit[] = ["Hourly", "Monthly", "Yearly"];
/** Mirrors RATE_UNIT_TO_ANNUAL on the server — hourly = 8 h × 22 days × 12. */
const ANNUAL_FACTOR: Record<RateUnit, number> = { Hourly: 8 * 22 * 12, Monthly: 12, Yearly: 1 };
const fmtRs = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

/* ------------------------------------------------------------ Sales submits */

export function SubmitForApprovalModal({
  profileId,
  candidateName,
  /** Prefill: the candidate's expected CTC (rupees) and any existing terms. */
  expectedCtc,
  existing,
  onClose,
  onDone,
}: {
  profileId: number;
  candidateName: string;
  expectedCtc?: number | null;
  existing?: OfferTerms | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  /* ONE rate field with a unit (2 Sep 2026, user request). Yearly is typed in
     LAKH like every other CTC box; Hourly and Monthly in plain rupees. The
     server stores the figure as typed plus the annualised CTC. */
  const existingUnit = (existing?.rate_unit as RateUnit | undefined) || "Yearly";
  const [unit, setUnit] = useState<RateUnit>(existingUnit);
  const [rate, setRate] = useState(() => {
    if (existing?.rate_value != null) {
      return existingUnit === "Yearly" ? toLac(existing.rate_value) : String(existing.rate_value);
    }
    return toLac(existing?.ctc ?? expectedCtc);
  });
  const [onboarding, setOnboarding] = useState(existing?.joining_date?.slice(0, 10) ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<{ ctc?: string; date?: string; form?: string }>({});

  // What the server will store as the annual CTC — shown so a monthly figure
  // typed into a yearly box (or vice versa) is caught before it reaches Sales Head.
  const rateValue = unit === "Yearly" ? toRupees(rate) : Math.round(Number(rate) || 0);
  const annual = rateValue > 0 ? rateValue * ANNUAL_FACTOR[unit] : 0;

  const submit = async () => {
    const next: typeof errs = {};
    if (!rate.trim() || !(Number(rate) > 0)) next.ctc = "Enter the candidate's rate";
    if (!onboarding) next.date = "Pick the customer onboarding date";
    setErrs(next);
    if (next.ctc || next.date) return;
    setBusy(true);
    try {
      const res = await crmPost(`/api/candidate-profiles/${profileId}/submit-for-approval`, {
        rate_value: rateValue,
        rate_unit: unit,
        customer_onboarding_date: onboarding,
        note: note.trim() || undefined,
      });
      onDone(res.message || "Sent to Sales Head for approval");
    } catch (e: any) {
      setErrs({ form: e?.message || "Could not submit for approval" });
      setBusy(false);
    }
  };

  return (
    <Modal title="Submit for Sales Head approval" onClose={() => { if (!busy) onClose(); }}>
      <div className="space-y-4">
        <p className="text-sm text-secondary">
          The customer has shortlisted <b>{candidateName}</b>. Enter the terms — Sales Head
          reviews them and, on approval, the candidate moves to <b>Pre Onboarding</b> and HR
          takes over.
        </p>
        {errs.form && (
          <p className="rounded-control bg-danger-soft px-3 py-2 text-xs font-semibold text-danger">{errs.form}</p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={`Candidate rate${unit === "Yearly" ? " — CTC (Lac)" : ` (₹ per ${unit === "Hourly" ? "hour" : "month"})`}`} required error={errs.ctc}>
            <div className="flex items-stretch gap-2">
              <input
                type="number" min={0} step={unit === "Yearly" ? 0.01 : 1} className={inputCls} value={rate}
                placeholder={unit === "Yearly" ? "e.g. 12.00" : unit === "Monthly" ? "e.g. 1,00,000" : "e.g. 650"}
                onChange={(e) => { setRate(e.target.value); setErrs((p) => ({ ...p, ctc: undefined })); }}
              />
              <select
                className={`${inputCls} !w-32 shrink-0`} value={unit}
                onChange={(e) => {
                  const next = e.target.value as RateUnit;
                  // Keep the annual value steady across a unit switch so the
                  // figure does not silently change meaning under the cursor.
                  if (annual > 0) {
                    const v = annual / ANNUAL_FACTOR[next];
                    setRate(next === "Yearly" ? toLac(v) : String(Math.round(v)));
                  }
                  setUnit(next);
                }}
              >
                {RATE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              {annual > 0 ? <>≈ ₹{fmtRs(annual)} a year.</> : null}
              {expectedCtc != null && <> Candidate expects {toLac(expectedCtc)} L.</>}
            </p>
          </Field>
          <Field label="Customer onboarding date" required error={errs.date}>
            <input
              type="date" className={inputCls} value={onboarding}
              onChange={(e) => { setOnboarding(e.target.value); setErrs((p) => ({ ...p, date: undefined })); }}
            />
            <p className="mt-1 text-[11px] text-muted">The day the customer takes them onto the project.</p>
          </Field>
        </div>
        <Field label="Note for Sales Head (optional)">
          <textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Rate agreed with the customer's PMO on the call" />
        </Field>
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={btnPrimary} onClick={() => void submit()} disabled={busy}>
            <Send size={15} /> {busy ? "Submitting…" : "Submit for approval"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------ Sales Head decides */

export type SalesHeadDecision = "approve" | "send_back" | "reject";

export function SalesHeadDecisionModal({
  profileId,
  candidateName,
  decision,
  terms,
  onClose,
  onDone,
}: {
  profileId: number;
  candidateName: string;
  decision: SalesHeadDecision;
  /** The terms Sales submitted — editable on approve, shown otherwise. */
  terms: OfferTerms | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  /* Shown and edited in the unit SALES QUOTED (2 Sep 2026, user report):
     ₹1,200 hourly must read as ₹1,200 hourly here, not as the annualised
     "25.34 L" — that figure is derived, and misleads the person approving. */
  const termUnit = (terms?.rate_unit as RateUnit | undefined) || "Yearly";
  const [unit, setUnit] = useState<RateUnit>(termUnit);
  const [rate, setRate] = useState(() =>
    terms?.rate_value != null
      ? (termUnit === "Yearly" ? toLac(terms.rate_value) : String(terms.rate_value))
      : toLac(terms?.ctc));
  const rateValue = unit === "Yearly" ? toRupees(rate) : Math.round(Number(rate) || 0);
  const annual = rateValue > 0 ? rateValue * ANNUAL_FACTOR[unit] : 0;
  const originalValue = terms?.rate_value != null ? Math.round(Number(terms.rate_value)) : Math.round(Number(terms?.ctc ?? 0));
  const rateChanged = unit !== termUnit || rateValue !== originalValue;
  const [onboarding, setOnboarding] = useState(terms?.joining_date?.slice(0, 10) ?? "");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const titles: Record<SalesHeadDecision, string> = {
    approve: "Approve these terms?",
    send_back: "Send the terms back to Sales?",
    reject: "Reject this candidate?",
  };
  const confirms: Record<SalesHeadDecision, string> = {
    approve: "Approve — send to HR Screening",
    send_back: "Send back to Sales",
    reject: "Reject candidate",
  };

  const submit = async () => {
    if (comment.trim().length < 5) {
      setError("Add a note of at least 5 characters — it is recorded against the decision.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body: Record<string, unknown> = { decision, comment: comment.trim() };
      if (decision === "approve") {
        // Only send a correction when Sales Head actually changed something.
        if (rateValue > 0 && rateChanged) { body.rate_value = rateValue; body.rate_unit = unit; }
        if (onboarding && onboarding !== (terms?.joining_date?.slice(0, 10) ?? "")) body.customer_onboarding_date = onboarding;
      }
      const res = await crmPost(`/api/candidate-profiles/${profileId}/sales-head-decision`, body);
      onDone(res.message || "Decision recorded");
    } catch (e: any) {
      setError(e?.message || "Could not record the decision");
      setBusy(false);
    }
  };

  return (
    <Modal title={titles[decision]} onClose={() => { if (!busy) onClose(); }}>
      <div className="space-y-4">
        <p className="text-sm text-secondary">
          {decision === "approve" && <><b>{candidateName}</b> moves to <b>HR Screening</b> — TA is asked to schedule the HR round, and RMG, HR and the submitting Sales person are notified. Correct the terms here if needed — what you approve is what HR receives.</>}
          {decision === "send_back" && <>The terms go back to Sales to be redone. <b>{candidateName}</b> returns to Customer Shortlisted; the Sales person is told why.</>}
          {decision === "reject" && <><b>{candidateName}</b> moves to Customer Rejected — a terminal status. The Sales person is told why.</>}
        </p>
        {decision === "approve" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={`Rate${unit === "Yearly" ? " — CTC (Lac)" : ` (₹ per ${unit === "Hourly" ? "hour" : "month"})`}`}>
              <div className="flex items-stretch gap-2">
                <input type="number" min={0} step={unit === "Yearly" ? 0.01 : 1} className={inputCls} value={rate}
                  onChange={(e) => setRate(e.target.value)} />
                <select className={`${inputCls} !w-32 shrink-0`} value={unit}
                  onChange={(e) => {
                    const next = e.target.value as RateUnit;
                    if (annual > 0) {
                      const v = annual / ANNUAL_FACTOR[next];
                      setRate(next === "Yearly" ? toLac(v) : String(Math.round(v)));
                    }
                    setUnit(next);
                  }}>
                  {RATE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {annual > 0 ? <>≈ ₹{fmtRs(annual)} a year. </> : null}
                Sales quoted {terms?.rate_value != null
                  ? `₹${fmtRs(terms.rate_value)} ${termUnit.toLowerCase()}`
                  : `${toLac(terms?.ctc) || "—"} L a year`}.
              </p>
            </Field>
            <Field label="Customer onboarding date">
              <input type="date" className={inputCls} value={onboarding}
                onChange={(e) => setOnboarding(e.target.value)} />
            </Field>
          </div>
        ) : terms ? (
          <dl className="flex flex-wrap gap-x-6 gap-y-1 rounded-control bg-surface-2 px-3 py-2 text-sm">
            <div className="flex items-center gap-1.5"><IndianRupee size={13} className="text-muted" /><dt className="text-muted">Rate</dt>
              <dd className="font-semibold text-primary">
                {terms.rate_value != null && terms.rate_unit && terms.rate_unit !== "Yearly"
                  ? `₹${fmtRs(terms.rate_value)} ${terms.rate_unit.toLowerCase()} (≈ ${toLac(terms.ctc)} L a year)`
                  : `${toLac(terms.ctc) || "—"} L`}
              </dd></div>
            <div className="flex items-center gap-1.5"><dt className="text-muted">Customer onboarding</dt><dd className="font-semibold text-primary">{terms.joining_date?.slice(0, 10) || "—"}</dd></div>
          </dl>
        ) : null}
        <Field label={decision === "approve" ? "Approval note" : "Reason"} required error={error}>
          <textarea autoFocus rows={3} className={inputCls} value={comment}
            onChange={(e) => { setComment(e.target.value); setError(""); }}
            placeholder={decision === "approve" ? "e.g. Terms agreed with the customer, onboarding date confirmed"
              : decision === "send_back" ? "e.g. Rate is above the approved budget — rework to 11.5 L"
              : "Why is this candidate being rejected?"} />
        </Field>
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className={decision === "reject"
              ? "inline-flex h-10 items-center gap-1.5 rounded-xl border border-rose-300/60 bg-rose-50 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-300"
              : btnPrimary}
            onClick={() => void submit()} disabled={busy}
          >
            {decision === "approve" ? <BadgeCheck size={15} /> : decision === "send_back" ? <Undo2 size={15} /> : <X size={15} />}
            {busy ? "Working…" : confirms[decision]}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------ the Pre-Onboarding budget hold */

/** HR: the candidate is out of budget / the joining date does not fit (3 Sep
 * 2026). Corrected figures + a note go to Sales Head and the Sales person. */
export function BudgetFlagModal({
  profileId, currentCtc, expectedCtc, customerOnboardingDate, presetNote, onClose, onDone,
}: {
  profileId: number;
  currentCtc?: number | null;
  expectedCtc?: number | null;
  customerOnboardingDate?: string | null;
  presetNote?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [current, setCurrent] = useState(toLac(currentCtc));
  const [expected, setExpected] = useState(toLac(expectedCtc));
  const [onboarding, setOnboarding] = useState(customerOnboardingDate?.slice(0, 10) ?? "");
  const [note, setNote] = useState(presetNote || "");
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<{ ctc?: string; note?: string; form?: string }>({});

  const submit = async () => {
    const e: typeof errs = {};
    if (expected !== "" && !(Number(expected) > 0)) e.ctc = "Expected CTC must be a positive number (in Lac)";
    if (note.trim().length < 5) e.note = "Tell Sales what does not fit (at least 5 characters)";
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const res = await crmPost(`/api/candidate-profiles/${profileId}/budget-flag`, {
        note: note.trim(),
        expected_ctc: expected === "" ? null : toRupees(expected),
        current_ctc: current === "" ? null : toRupees(current),
        customer_onboarding_date: onboarding || null,
      });
      onDone(res.message || "Flagged — Sales notified");
    } catch (err: any) {
      setErrs({ form: err?.message || "Could not flag the budget" });
      setBusy(false);
    }
  };

  return (
    <Modal title="Out of budget — notify Sales" onClose={onClose} dirty={note.trim() !== (presetNote || "")}>
      <div className="space-y-4">
        <p className="text-sm text-secondary">
          Correct the figures to what the candidate now expects, say what does not fit, and Sales Head plus
          the Sales person who submitted the terms will be told. The candidate stays at Pre Onboarding
          while they talk to the customer; their reply comes back to you here.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Current CTC (Lac)">
            <input type="number" min={0} step="0.01" className={inputCls} value={current}
              onChange={(ev) => setCurrent(ev.target.value)} />
          </Field>
          <Field label="Expected CTC (Lac)" error={errs.ctc}>
            <input type="number" min={0} step="0.01" className={inputCls} value={expected}
              onChange={(ev) => { setExpected(ev.target.value); setErrs((p) => ({ ...p, ctc: undefined })); }} />
          </Field>
          <Field label="Customer onboarding date">
            <input type="date" className={inputCls} value={onboarding} onChange={(ev) => setOnboarding(ev.target.value)} />
          </Field>
        </div>
        <Field label="What does not fit" required error={errs.note}>
          <textarea className={`${inputCls} min-h-24`} value={note}
            onChange={(ev) => { setNote(ev.target.value); setErrs((p) => ({ ...p, note: undefined })); }}
            placeholder="e.g. Candidate now expects 14 L; the approved rate is 12 L. Joining only from 15 Oct." />
        </Field>
        {errs.form && <div className="rounded-card border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{errs.form}</div>}
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={btnPrimary} onClick={() => void submit()} disabled={busy}>
            <Send size={15} /> {busy ? "Sending…" : "Notify Sales"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Sales / Sales Head: reply to HR's budget flag after talking to the customer,
 * optionally with the revised rate (in the quoted unit) or onboarding date. */
export function BudgetReplyModal({
  profileId, offer, hrNote, onClose, onDone,
}: {
  profileId: number;
  offer?: OfferTerms | null;
  hrNote: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const existingUnit = (offer?.rate_unit as RateUnit | undefined) || "Yearly";
  const [revise, setRevise] = useState(false);
  const [unit, setUnit] = useState<RateUnit>(existingUnit);
  const [rate, setRate] = useState(() => {
    if (offer?.rate_value != null) return existingUnit === "Yearly" ? toLac(offer.rate_value) : String(offer.rate_value);
    return toLac(offer?.ctc);
  });
  const [onboarding, setOnboarding] = useState(offer?.joining_date?.slice(0, 10) ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<{ rate?: string; note?: string; form?: string }>({});

  const rateRupees = unit === "Yearly" ? toRupees(rate) : Math.round(Number(rate));
  const annual = rateRupees * ANNUAL_FACTOR[unit];

  const submit = async () => {
    const e: typeof errs = {};
    if (revise && !(rateRupees > 0)) e.rate = "Enter the revised rate";
    if (note.trim().length < 5) e.note = "Tell HR what the customer said (at least 5 characters)";
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const res = await crmPost(`/api/candidate-profiles/${profileId}/budget-resolve`, {
        note: note.trim(),
        ...(revise ? { rate_value: rateRupees, rate_unit: unit } : {}),
        ...(revise && onboarding ? { customer_onboarding_date: onboarding } : {}),
      });
      onDone(res.message || "Reply sent — HR notified");
    } catch (err: any) {
      setErrs({ form: err?.message || "Could not send the reply" });
      setBusy(false);
    }
  };

  return (
    <Modal title="Reply to HR — budget" onClose={onClose} dirty={!!note.trim()}>
      <div className="space-y-4">
        <div className="rounded-card border border-subtle bg-surface-2/50 px-3.5 py-2.5 text-sm text-secondary">
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted">HR said</span>
          <div className="mt-0.5 italic">{hrNote || "—"}</div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-primary">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={revise} onChange={(ev) => setRevise(ev.target.checked)} />
          The customer agreed to revised terms — update the approved rate / onboarding date
        </label>
        {revise && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Rate unit">
              <select className={inputCls} value={unit} onChange={(ev) => setUnit(ev.target.value as RateUnit)}>
                {RATE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
            <Field label={unit === "Yearly" ? "Rate (Lac / year)" : `Rate (₹ per ${unit === "Hourly" ? "hour" : "month"})`} required error={errs.rate}>
              <input type="number" min={0} step="0.01" className={inputCls} value={rate}
                onChange={(ev) => { setRate(ev.target.value); setErrs((p) => ({ ...p, rate: undefined })); }} />
              {rateRupees > 0 && <div className="mt-1 text-xs text-muted">≈ ₹{fmtRs(annual)} a year</div>}
            </Field>
            <Field label="Customer onboarding date">
              <input type="date" className={inputCls} value={onboarding} onChange={(ev) => setOnboarding(ev.target.value)} />
            </Field>
          </div>
        )}
        <Field label="Reply to HR" required error={errs.note}>
          <textarea className={`${inputCls} min-h-24`} value={note}
            onChange={(ev) => { setNote(ev.target.value); setErrs((p) => ({ ...p, note: undefined })); }}
            placeholder="e.g. Customer agreed to 1,300/hour and a 15 Oct start — please proceed." />
        </Field>
        {errs.form && <div className="rounded-card border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{errs.form}</div>}
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={btnPrimary} onClick={() => void submit()} disabled={busy}>
            <Send size={15} /> {busy ? "Sending…" : "Send reply to HR"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
