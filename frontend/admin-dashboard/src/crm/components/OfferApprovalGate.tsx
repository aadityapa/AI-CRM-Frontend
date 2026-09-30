/**
 * The Sales → Sales Head approval gate, as two modals any surface can open.
 *
 *   customer shortlists → Sales SUBMITS the rate + customer onboarding date
 *   → "Pending Sales Head Approval" → Sales Head APPROVES (→ HR Discussion,
 *   HR notified), SENDS BACK the terms ("Terms Sent Back"), or REJECTS.
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
import { useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, BadgeCheck, CalendarCheck2, CheckCircle2, IndianRupee, Send, Undo2, X } from "lucide-react";

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

/** Where a date sits relative to today, in words ("in 6 days", "today"). */
function relDays(iso: string): { text: string; past: boolean } {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return { text: "", past: false };
  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const n = Math.round((target - today) / 86_400_000);
  if (n === 0) return { text: "today", past: false };
  if (n === 1) return { text: "tomorrow", past: false };
  if (n < 0) return { text: `${-n} day${n === -1 ? "" : "s"} ago`, past: true };
  return { text: n < 14 ? `in ${n} days` : `in ${Math.round(n / 7)} weeks`, past: false };
}
const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** One-click onboarding dates — the ones Sales actually agrees with customers. */
function quickDates(): { label: string; iso: string }[] {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
  const twoWeeks = new Date(now);
  twoWeeks.setDate(now.getDate() + 14);
  const firstNext = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return [
    { label: "Next Monday", iso: isoOf(monday) },
    { label: "In 2 weeks", iso: isoOf(twoWeeks) },
    { label: "1st of next month", iso: isoOf(firstNext) },
  ];
}
const longDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
};
const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
const UNIT_SUFFIX: Record<RateUnit, string> = { Yearly: "L / year", Monthly: "/ month", Hourly: "/ hour" };

/** A number the comparison strip prints — Lac with 2 decimals. */
const lac = (rupees: number) => `${(rupees / LAKH).toFixed(2).replace(/\.00$/, "")} L`;


/* ------------------------------------------------ shared pieces (both modals) */

/** Who, where, and where the decision sends them — the hero both dialogs open with. */
function CandidateHero({ name, opportunityLabel, gradient, chip, steps, current }: {
  name: string;
  opportunityLabel?: string | null;
  gradient: string;
  chip: string;
  steps: string[];
  /** Index of the step this dialog performs (earlier ones are done). */
  current: number;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-subtle">
      <div className={`flex items-center gap-3 bg-gradient-to-r px-4 py-3 text-white ${gradient}`}>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/20 text-base font-bold ring-2 ring-white/40" aria-hidden>
          {initials(name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-base font-bold">{name}</span>
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold">{chip}</span>
          </div>
          {opportunityLabel && <div className="truncate text-xs text-white/85">{opportunityLabel}</div>}
        </div>
      </div>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-surface-2 px-4 py-2 text-[11px] font-semibold" aria-label="Where this sends them">
        {steps.map((st, i) => (
          <li key={st} className="inline-flex items-center gap-2">
            {i > 0 && <ArrowRight size={12} className="text-muted" aria-hidden />}
            {i < current
              ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 size={13} aria-hidden /> {st}</span>
              : i === current
                ? <span className="rounded-full bg-brand-600 px-2 py-0.5 text-white">{st}</span>
                : <span className="text-muted">{st}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A numbered-icon section header. */
function SectionTitle({ icon, gradient, children }: { icon: ReactNode; gradient: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-sm font-bold text-primary">
      <span className={`grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br text-white ${gradient}`} aria-hidden>{icon}</span>
      {children}
    </span>
  );
}

/** Keep the annual value steady across a unit switch so the figure never changes meaning under the cursor. */
function convertRate(annual: number, next: RateUnit): string | null {
  if (!(annual > 0)) return null;
  const v = annual / ANNUAL_FACTOR[next];
  return next === "Yearly" ? toLac(v) : String(Math.round(v));
}

/** The unit as a segmented control + one large rupee input with its suffix. */
function RateInput({ unit, rate, error, onUnit, onRate }: {
  unit: RateUnit; rate: string; error?: string;
  onUnit: (u: RateUnit) => void; onRate: (v: string) => void;
}) {
  return (
    <>
      <div role="radiogroup" aria-label="Rate is priced per" className="inline-flex rounded-control border border-subtle bg-surface-2 p-0.5">
        {RATE_UNITS.map((u) => (
          <button key={u} type="button" role="radio" aria-checked={unit === u} onClick={() => onUnit(u)}
            className={`rounded-[5px] px-2.5 py-1 text-xs font-semibold transition-colors duration-micro ${
              unit === u ? "bg-brand-600 text-white shadow-raised" : "text-secondary hover:text-primary"}`}>
            {u}
          </button>
        ))}
      </div>
      <div className={`mt-2 flex items-stretch overflow-hidden rounded-control border bg-surface-1 focus-within:ring-2 focus-within:ring-brand-500 ${error ? "border-danger" : "border-subtle"}`}>
        <span className="grid place-items-center bg-surface-2 px-3 text-lg font-bold text-secondary" aria-hidden>₹</span>
        <input
          type="number" min={0} step={unit === "Yearly" ? 0.01 : 1} value={rate} aria-label="Rate"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-2xl font-bold text-primary tnum outline-none"
          placeholder={unit === "Yearly" ? "12.00" : unit === "Monthly" ? "100000" : "650"}
          onChange={(e) => onRate(e.target.value)}
        />
        <span className="grid place-items-center px-3 text-sm font-semibold text-muted">{UNIT_SUFFIX[unit]}</span>
      </div>
      {error && <p className="mt-1 text-xs font-semibold text-danger">{error}</p>}
    </>
  );
}

/** Current · expected · budget · this rate, as bars on one scale. */
function BudgetCheck({ annual, currentCtc, expectedCtc, budget, budgetBand, overBudget, rateLabel = "This rate (a year)" }: {
  annual: number; currentCtc?: number | null; expectedCtc?: number | null;
  budget: number | null; budgetBand?: string | null; overBudget: number | null; rateLabel?: string;
}) {
  const compare: { label: string; value: number; tone: string }[] = [
    ...(currentCtc ? [{ label: "Current CTC", value: currentCtc, tone: "bg-slate-400" }] : []),
    ...(expectedCtc ? [{ label: "Expected CTC", value: expectedCtc, tone: "bg-sky-500" }] : []),
    ...(budget != null ? [{ label: `Budget${budgetBand ? ` (${budgetBand} yrs)` : ""}`, value: budget, tone: "bg-emerald-500" }] : []),
  ];
  if (!compare.length) return null;
  const rows = [...compare, ...(annual > 0 ? [{ label: rateLabel, value: annual,
    tone: overBudget != null && overBudget > 0 ? "bg-danger" : "bg-brand-600" }] : [])];
  const scaleMax = Math.max(...rows.map((c) => c.value), 1);
  return (
    <div className="mt-3 space-y-1.5 rounded-control bg-surface-2 p-2.5" aria-label="Budget check">
      {rows.map((c) => (
        <div key={c.label} className="grid grid-cols-[7.5rem_1fr_4rem] items-center gap-2 text-[11px]">
          <span className="truncate font-semibold text-secondary">{c.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-surface-1">
            <span className={`block h-full rounded-full ${c.tone}`} style={{ width: `${Math.max(3, (c.value / scaleMax) * 100)}%` }} />
          </span>
          <span className="text-right font-bold tnum text-primary">{lac(c.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** A date input + the three one-click picks + "Monday, 5 Oct 2026 · in 6 days". */
function OnboardingPicker({ value, error, onChange, emptyHint }: {
  value: string; error?: string; onChange: (iso: string) => void; emptyHint: string;
}) {
  const when = value ? relDays(value) : null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={value} aria-label="Customer onboarding date"
          className="rounded-control border border-subtle bg-surface-1 px-3 py-2 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-brand-500"
          onChange={(e) => onChange(e.target.value)} />
        {quickDates().map((q) => (
          <button key={q.label} type="button" onClick={() => onChange(q.iso)}
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors duration-micro ${
              value === q.iso ? "border-brand-600 bg-brand-600 text-white" : "border-subtle text-secondary hover:bg-surface-2"}`}>
            {q.label}
          </button>
        ))}
      </div>
      <p className={`mt-1.5 text-xs ${error ? "font-semibold text-danger" : when?.past ? "font-semibold text-warning" : "text-muted"}`}>
        {error || (value ? `${longDate(value)} · ${when?.text}${when?.past ? " — is that right?" : ""}` : emptyHint)}
      </p>
    </>
  );
}

/**
 * Sales submits the terms (redesigned 29 Sep 2026, user ask "best of best"):
 * a hero that names who and where, the rate with its unit as a segmented
 * control and a live BUDGET CHECK (current · expected · approved budget vs this
 * rate), the onboarding date with one-click picks and "in N days", a note, and
 * a summary of exactly what Sales Head receives. Same endpoint and payload as
 * before — `submit-for-approval` with the rate as typed + its unit.
 */
export function SubmitForApprovalModal({
  profileId,
  candidateName,
  /** Prefill: the candidate's expected CTC (rupees) and any existing terms. */
  expectedCtc,
  currentCtc,
  /** The opportunity's approved CTC budget for this candidate's band, in LAC. */
  approvedBudgetLac,
  budgetBand,
  opportunityLabel,
  /** Sales Head sent the terms back — shown as a banner above the form. */
  sentBack,
  existing,
  onClose,
  onDone,
}: {
  profileId: number;
  candidateName: string;
  expectedCtc?: number | null;
  currentCtc?: number | null;
  approvedBudgetLac?: number | null;
  budgetBand?: string | null;
  opportunityLabel?: string | null;
  sentBack?: boolean;
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
  const budget = approvedBudgetLac != null && approvedBudgetLac > 0 ? approvedBudgetLac * LAKH : null;
  const overBudget = budget != null && annual > 0 ? annual - budget : null;
  const vsExpected = expectedCtc && annual > 0 ? Math.round(((annual - expectedCtc) / expectedCtc) * 100) : null;
  const dirty = !!note.trim() || onboarding !== (existing?.joining_date?.slice(0, 10) ?? "");

  const switchUnit = (next: RateUnit) => {
    const v = convertRate(annual, next);
    if (v != null) setRate(v);
    setUnit(next);
  };
  const applyAnnual = (rupees: number) => {
    setUnit("Yearly");
    setRate(toLac(rupees));
    setErrs((p) => ({ ...p, ctc: undefined }));
  };

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
    <Modal title="Submit for Sales Head approval" onClose={() => { if (!busy) onClose(); }} dirty={dirty} medium>
      <div className="space-y-4">
        <CandidateHero name={candidateName} opportunityLabel={opportunityLabel} chip="Customer shortlisted"
          gradient="from-emerald-600 via-teal-600 to-sky-600"
          steps={["Customer shortlisted", "Sales Head approval", "HR Discussion"]} current={1} />

        {sentBack && (
          <p className="flex items-start gap-2 rounded-card border border-warning bg-warning-soft px-3 py-2 text-xs font-semibold text-warning">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            Sales Head sent these terms back — revise them and resubmit. Their reason is in the candidate&rsquo;s history.
          </p>
        )}
        {errs.form && (
          <p className="rounded-control bg-danger-soft px-3 py-2 text-xs font-semibold text-danger" role="alert">{errs.form}</p>
        )}

        {/* 1 — the rate */}
        <section className="rounded-card border border-subtle bg-surface-1 p-3" aria-label="Candidate rate">
          <div className="mb-2">
            <SectionTitle icon={<IndianRupee size={13} />} gradient="from-emerald-500 to-teal-600">
              Candidate rate <span className="text-danger">*</span>
            </SectionTitle>
          </div>
          <RateInput unit={unit} rate={rate} error={errs.ctc} onUnit={switchUnit}
            onRate={(v) => { setRate(v); setErrs((p) => ({ ...p, ctc: undefined })); }} />
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            {annual > 0 && (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 font-bold text-brand-700 dark:bg-brand-900 dark:text-brand-300">
                ≈ ₹{fmtRs(annual)} a year
              </span>
            )}
            {overBudget != null && (
              overBudget > 0
                ? <span className="rounded-full bg-danger-soft px-2 py-0.5 font-bold text-danger">Over budget by {lac(overBudget)}</span>
                : <span className="rounded-full bg-success-soft px-2 py-0.5 font-bold text-success">Within budget · {lac(-overBudget)} headroom</span>
            )}
            {vsExpected != null && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 font-semibold text-secondary">
                {vsExpected === 0 ? "Matches expected" : `${vsExpected > 0 ? "+" : ""}${vsExpected}% vs expected`}
              </span>
            )}
            {expectedCtc ? (
              <button type="button" onClick={() => applyAnnual(expectedCtc)}
                className="rounded-full border border-subtle px-2 py-0.5 font-semibold text-sky-700 hover:bg-surface-2 dark:text-sky-300">
                Use expected ({lac(expectedCtc)})
              </button>
            ) : null}
            {budget != null && (
              <button type="button" onClick={() => applyAnnual(budget)}
                className="rounded-full border border-subtle px-2 py-0.5 font-semibold text-emerald-700 hover:bg-surface-2 dark:text-emerald-300">
                Use budget ({lac(budget)})
              </button>
            )}
          </div>
          <BudgetCheck annual={annual} currentCtc={currentCtc} expectedCtc={expectedCtc} budget={budget}
            budgetBand={budgetBand} overBudget={overBudget} />
        </section>

        {/* 2 — the customer onboarding date */}
        <section className={`rounded-card border bg-surface-1 p-3 ${errs.date ? "border-danger" : "border-subtle"}`} aria-label="Customer onboarding date">
          <div className="mb-2">
            <SectionTitle icon={<CalendarCheck2 size={13} />} gradient="from-sky-500 to-indigo-600">
              Customer onboarding date <span className="text-danger">*</span>
            </SectionTitle>
          </div>
          <OnboardingPicker value={onboarding} error={errs.date} emptyHint="The day the customer takes them onto the project."
            onChange={(iso) => { setOnboarding(iso); setErrs((p) => ({ ...p, date: undefined })); }} />
        </section>

        {/* 3 — a note */}
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-xs font-semibold text-secondary">
            <span>Note for Sales Head (optional)</span>
            <span className="text-muted tnum">{note.length}/1000</span>
          </span>
          <textarea className={inputCls} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Rate agreed with the customer's PMO on the call" />
        </label>

        {/* What Sales Head receives. */}
        <div className="flex items-start gap-3 rounded-card border border-subtle bg-surface-2 p-3 text-sm">
          <BadgeCheck size={18} className="mt-0.5 shrink-0 text-brand-600" aria-hidden />
          <div className="min-w-0">
            <div className="font-semibold text-primary">Sales Head receives</div>
            <div className="text-xs text-secondary">
              {annual > 0 ? `${unit === "Yearly" ? `₹${fmtRs(annual)} a year` : `₹${fmtRs(rateValue)} ${UNIT_SUFFIX[unit]} (≈ ₹${fmtRs(annual)} a year)`}` : "The rate"}
              {" · "}
              {onboarding ? `onboarding ${longDate(onboarding)}` : "the onboarding date"}
              {" — they approve (the candidate moves to HR Discussion), send the terms back, or reject."}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-sky-600 px-5 text-sm font-bold text-white shadow-raised transition-transform duration-micro hover:scale-[1.02] disabled:opacity-60"
            onClick={() => void submit()} disabled={busy}>
            <Send size={15} /> {busy ? "Submitting…" : "Submit for approval"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------ Sales Head decides */

export type SalesHeadDecision = "approve" | "send_back" | "reject";

/** One look per decision — hero gradient, where it sends the candidate, the button. */
const DECISION_LOOK: Record<SalesHeadDecision, {
  label: string; title: string; gradient: string; chip: string; steps: string[]; current: number;
  confirm: string; button: string; noteLabel: string; placeholder: string; icon: ReactNode;
}> = {
  approve: {
    label: "Approve", title: "Approve these terms", gradient: "from-emerald-600 via-teal-600 to-sky-600",
    chip: "Pending your approval", steps: ["Customer shortlisted", "Sales Head approval", "HR Discussion"], current: 1,
    confirm: "Approve — send to HR Discussion",
    button: "bg-gradient-to-r from-emerald-600 via-teal-600 to-sky-600",
    noteLabel: "Approval note", placeholder: "e.g. Terms agreed with the customer, onboarding date confirmed",
    icon: <BadgeCheck size={15} aria-hidden />,
  },
  send_back: {
    label: "Send back", title: "Send the terms back to Sales", gradient: "from-amber-500 via-orange-500 to-rose-500",
    chip: "Terms need rework", steps: ["Sales Head approval", "Back to Sales", "Resubmitted"], current: 1,
    confirm: "Send back to Sales",
    button: "bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500",
    noteLabel: "What Sales should change", placeholder: "e.g. Rate is above the approved budget — rework to 11.5 L",
    icon: <Undo2 size={15} aria-hidden />,
  },
  reject: {
    label: "Reject", title: "Reject this candidate", gradient: "from-rose-600 via-red-600 to-fuchsia-700",
    chip: "Closing the candidacy", steps: ["Sales Head approval", "Customer Rejected"], current: 1,
    confirm: "Reject candidate",
    button: "bg-gradient-to-r from-rose-600 via-red-600 to-fuchsia-700",
    noteLabel: "Reason", placeholder: "Why is this candidate being rejected?",
    icon: <X size={15} aria-hidden />,
  },
};
const NOTE_PICKS: Record<SalesHeadDecision, string[]> = {
  approve: ["Terms agreed with the customer", "Within the approved budget", "Onboarding date confirmed"],
  send_back: ["Rate is above the approved budget", "Onboarding date does not work", "Confirm the rate with the customer"],
  reject: ["Over budget, no room to move", "Customer withdrew the position", "Candidate declined the terms"],
};

/**
 * Sales Head decides (redesigned 29 Sep 2026, user ask "best of best"): the
 * SAME hero, rate input and budget check as the submit dialog, so the person
 * approving reads the terms exactly as Sales entered them — plus a decision
 * switch (Approve · Send back · Reject) so a change of mind needs no second
 * dialog, "Sales quoted …" beside any correction, one-click note starters and
 * a summary of what happens next. Same endpoint and body as before
 * (`sales-head-decision`; a rate / date only when it was actually changed).
 */
export function SalesHeadDecisionModal({
  profileId,
  candidateName,
  decision: initialDecision,
  terms,
  expectedCtc,
  currentCtc,
  approvedBudgetLac,
  budgetBand,
  opportunityLabel,
  onClose,
  onDone,
}: {
  profileId: number;
  candidateName: string;
  decision: SalesHeadDecision;
  /** The terms Sales submitted — editable on approve, shown otherwise. */
  terms: OfferTerms | null;
  expectedCtc?: number | null;
  currentCtc?: number | null;
  approvedBudgetLac?: number | null;
  budgetBand?: string | null;
  opportunityLabel?: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [decision, setDecision] = useState<SalesHeadDecision>(initialDecision);
  const look = DECISION_LOOK[decision];
  /* Shown and edited in the unit SALES QUOTED (2 Sep 2026, user report):
     ₹1,200 hourly must read as ₹1,200 hourly here, not as the annualised
     "25.34 L" — that figure is derived, and misleads the person approving. */
  const termUnit = (terms?.rate_unit as RateUnit | undefined) || "Yearly";
  const quotedRate = terms?.rate_value != null
    ? (termUnit === "Yearly" ? toLac(terms.rate_value) : String(terms.rate_value))
    : toLac(terms?.ctc);
  const quotedDate = terms?.joining_date?.slice(0, 10) ?? "";
  const [unit, setUnit] = useState<RateUnit>(termUnit);
  const [rate, setRate] = useState(quotedRate);
  const [onboarding, setOnboarding] = useState(quotedDate);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const rateValue = unit === "Yearly" ? toRupees(rate) : Math.round(Number(rate) || 0);
  const annual = rateValue > 0 ? rateValue * ANNUAL_FACTOR[unit] : 0;
  const originalValue = terms?.rate_value != null ? Math.round(Number(terms.rate_value)) : Math.round(Number(terms?.ctc ?? 0));
  const rateChanged = unit !== termUnit || rateValue !== originalValue;
  const dateChanged = !!onboarding && onboarding !== quotedDate;
  const budget = approvedBudgetLac != null && approvedBudgetLac > 0 ? approvedBudgetLac * LAKH : null;
  const overBudget = budget != null && annual > 0 ? annual - budget : null;
  const quotedText = terms?.rate_value != null && termUnit !== "Yearly"
    ? `₹${fmtRs(terms.rate_value)} ${UNIT_SUFFIX[termUnit]}`
    : terms?.ctc != null || terms?.rate_value != null
      ? `${lac(Number(terms?.rate_value ?? terms?.ctc))} a year` : "no rate";
  const dirty = !!comment.trim() || (decision === "approve" && (rateChanged || dateChanged));

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
        if (dateChanged) body.customer_onboarding_date = onboarding;
      }
      const res = await crmPost(`/api/candidate-profiles/${profileId}/sales-head-decision`, body);
      onDone(res.message || "Decision recorded");
    } catch (e: any) {
      setError(e?.message || "Could not record the decision");
      setBusy(false);
    }
  };

  const outcome: Record<SalesHeadDecision, ReactNode> = {
    approve: <><b>{candidateName}</b> moves to <b>HR Discussion</b>. TA is asked to book the HR round; RMG, HR and the Sales person are told.
      {(rateChanged || dateChanged) ? <> HR receives <b>your corrected terms</b>.</> : null}</>,
    send_back: <>The terms go back to Sales with your note — <b>{candidateName}</b> returns to Customer Shortlisted until they resubmit.</>,
    reject: <><b>{candidateName}</b> moves to <b>Customer Rejected</b> — a closed status. The Sales person is told why.</>,
  };

  return (
    <Modal title={look.title} onClose={() => { if (!busy) onClose(); }} dirty={dirty} medium>
      <div className="space-y-4">
        <CandidateHero name={candidateName} opportunityLabel={opportunityLabel} chip={look.chip}
          gradient={look.gradient} steps={look.steps} current={look.current} />

        {/* The decision, switchable in place. */}
        <div role="radiogroup" aria-label="Decision" className="grid grid-cols-3 gap-1 rounded-card border border-subtle bg-surface-2 p-1">
          {(Object.keys(DECISION_LOOK) as SalesHeadDecision[]).map((k) => {
            const on = k === decision;
            const tone = k === "approve" ? "text-success" : k === "send_back" ? "text-warning" : "text-danger";
            return (
              <button key={k} type="button" role="radio" aria-checked={on}
                disabled={k === "approve" && !terms}
                title={k === "approve" && !terms ? "No terms on record — send it back so Sales submits them" : undefined}
                onClick={() => { setDecision(k); setError(""); }}
                className={`inline-flex items-center justify-center gap-1.5 rounded-control px-2 py-2 text-xs font-bold transition-colors duration-micro disabled:opacity-40 ${
                  on ? `bg-surface-1 shadow-raised ${tone}` : "text-secondary hover:text-primary"}`}>
                {DECISION_LOOK[k].icon} {DECISION_LOOK[k].label}
              </button>
            );
          })}
        </div>

        {decision === "approve" ? (
          <>
            <section className="rounded-card border border-subtle bg-surface-1 p-3" aria-label="Rate">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <SectionTitle icon={<IndianRupee size={13} />} gradient="from-emerald-500 to-teal-600">Rate</SectionTitle>
                <span className="text-[11px] font-semibold text-muted">Sales quoted {quotedText}</span>
              </div>
              <RateInput unit={unit} rate={rate}
                onUnit={(u) => { const v = convertRate(annual, u); if (v != null) setRate(v); setUnit(u); }}
                onRate={setRate} />
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                {annual > 0 && (
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 font-bold text-brand-700 dark:bg-brand-900 dark:text-brand-300">≈ ₹{fmtRs(annual)} a year</span>
                )}
                {overBudget != null && (overBudget > 0
                  ? <span className="rounded-full bg-danger-soft px-2 py-0.5 font-bold text-danger">Over budget by {lac(overBudget)}</span>
                  : <span className="rounded-full bg-success-soft px-2 py-0.5 font-bold text-success">Within budget · {lac(-overBudget)} headroom</span>)}
                {rateChanged && (
                  <>
                    <span className="rounded-full bg-warning-soft px-2 py-0.5 font-bold text-warning">You changed the rate</span>
                    <button type="button" className="rounded-full border border-subtle px-2 py-0.5 font-semibold text-secondary hover:bg-surface-2"
                      onClick={() => { setUnit(termUnit); setRate(quotedRate); }}>Undo</button>
                  </>
                )}
              </div>
              <BudgetCheck annual={annual} currentCtc={currentCtc} expectedCtc={expectedCtc} budget={budget}
                budgetBand={budgetBand} overBudget={overBudget} rateLabel="Rate to approve" />
            </section>
            <section className="rounded-card border border-subtle bg-surface-1 p-3" aria-label="Customer onboarding date">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <SectionTitle icon={<CalendarCheck2 size={13} />} gradient="from-sky-500 to-indigo-600">Customer onboarding date</SectionTitle>
                {dateChanged && (
                  <button type="button" className="rounded-full border border-subtle px-2 py-0.5 text-[11px] font-semibold text-secondary hover:bg-surface-2"
                    onClick={() => setOnboarding(quotedDate)}>Undo — Sales said {quotedDate ? longDate(quotedDate) : "none"}</button>
                )}
              </div>
              <OnboardingPicker value={onboarding} onChange={setOnboarding} emptyHint="Sales gave no onboarding date." />
            </section>
          </>
        ) : terms ? (
          <div className="grid gap-2 sm:grid-cols-2" aria-label="The terms Sales submitted">
            <div className="rounded-card border border-subtle bg-surface-2 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Rate Sales quoted</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-base font-bold text-primary tnum"><IndianRupee size={14} className="text-muted" aria-hidden />
                {quotedText.replace(/^₹/, "")}</div>
              {overBudget != null && overBudget > 0 && <div className="text-[11px] font-semibold text-danger">Over budget by {lac(overBudget)}</div>}
            </div>
            <div className="rounded-card border border-subtle bg-surface-2 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Customer onboarding</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-base font-bold text-primary"><CalendarCheck2 size={14} className="text-muted" aria-hidden />
                {quotedDate ? longDate(quotedDate) : "—"}</div>
            </div>
          </div>
        ) : null}

        {/* The note — recorded against the decision; the starters only fill an empty box. */}
        <div>
          <span className="mb-1 flex items-center justify-between text-xs font-semibold text-secondary">
            <span>{look.noteLabel} <span className="text-danger">*</span></span>
            <span className="text-muted tnum">{comment.length}/1000</span>
          </span>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {NOTE_PICKS[decision].map((t) => (
              <button key={t} type="button" onClick={() => { setComment((c) => (c.trim() ? `${c.trim()}. ${t}` : t)); setError(""); }}
                className="rounded-full border border-subtle px-2.5 py-1 text-[11px] font-semibold text-secondary hover:bg-surface-2">+ {t}</button>
            ))}
          </div>
          <textarea rows={3} maxLength={1000} className={`${inputCls} ${error ? "border-danger" : ""}`} value={comment}
            aria-label={look.noteLabel} placeholder={look.placeholder}
            onChange={(e) => { setComment(e.target.value); setError(""); }} />
          {error && <p className="mt-1 text-xs font-semibold text-danger" role="alert">{error}</p>}
        </div>

        {/* What happens next. */}
        <div className="flex items-start gap-3 rounded-card border border-subtle bg-surface-2 p-3 text-xs text-secondary">
          <span className="mt-0.5 shrink-0">{look.icon}</span>
          <div className="min-w-0">{outcome[decision]}</div>
        </div>

        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className={`inline-flex h-10 items-center gap-1.5 rounded-xl px-5 text-sm font-bold text-white shadow-raised transition-transform duration-micro hover:scale-[1.02] disabled:opacity-60 ${look.button}`}
            onClick={() => void submit()} disabled={busy || (decision === "approve" && !terms)}>
            {look.icon} {busy ? "Working…" : look.confirm}
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
        {errs.form && <div className="rounded-card border border-danger bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{errs.form}</div>}
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
        <div className="rounded-card border border-subtle bg-surface-2 px-3.5 py-2.5 text-sm text-secondary">
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
        {errs.form && <div className="rounded-card border border-danger bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{errs.form}</div>}
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
