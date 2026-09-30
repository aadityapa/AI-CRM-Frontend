/**
 * THE wizard chrome for every multi-step CRM form — New / Edit Candidate,
 * Customer, Opportunity, Branch, Project and Purchase Order (scoped via
 * `.crm-wizard`, theme in `premium.css`).
 *
 * Redesigned 30 Sep 2026 (user ask: "Candidate, Customer and Opportunity forms
 * — best of best"). One implementation replaces the two chromes that existed
 * (`WizardChrome.tsx` is gone — its section copy lives here):
 *
 *   WizardTopBar   a full-bleed gradient header (Modal `hero=` / WizardShell):
 *                  icon · eyebrow · title · subtitle · a progress ring · a
 *                  segmented progress strip, one segment per step
 *   WizardFrame    the body: a step rail (icon tiles, per-step status, "N of
 *                  M complete") beside the scrolling content column
 *   WizardStepper  the rail itself (vertical) or the mobile pills (horizontal)
 *   WizardStepHeader / SectionHeaderBanner  icon tile · "STEP 2 OF 5" · title
 *   WizardFooter   Previous · where you are · "Next: <step name>" / Submit
 *   WizardShell    a full-screen portal that composes all of the above
 *
 * Every export keeps its old props; the new ones are optional.
 * ⚠️ `.crm-wizard button.min-w-0` is styled AS AN INPUT (premium.css) — never
 * put `min-w-0` on a button in this chrome.
 */
import React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle, Briefcase, Building2, Calendar, CalendarDays, Check, ChevronLeft, ChevronRight, CircleDot,
  ClipboardCheck, ClipboardList, Clock, Cloud, CloudOff, FileText, FileUp, GitBranch, Hash, History, Info,
  IndianRupee, Layers, Loader2, Lock, Mail, MapPin, Paperclip, Phone, Receipt, Repeat, RotateCcw, Save, Scale,
  Sparkles, Umbrella, User, UserRound, Wallet, type LucideIcon,
} from "lucide-react";
import { createPortal } from "react-dom";
import { motion as motionTok } from "../../../design-system/tokens/tokens";
import { ConfirmModal, btnSecondary, focusRing, Skeleton, inputCls } from "../ui";
import "./premium.css";

/* ================================================================== types */
export type StepStatus = "complete" | "error" | "partial" | "empty";

export type WizardStep = {
  key: string;
  title: string;
  sublabel?: string;
  status: StepStatus;
  /** Overrides the icon the step key maps to (`STEP_ICONS`). */
  icon?: LucideIcon;
};

export type AutosaveState = "idle" | "saving" | "saved" | "error";

export type FieldIconKind =
  | "building" | "mail" | "phone" | "user" | "map" | "hash" | "calendar" | "lock";

/* ============================================================ section copy */
const SECTION_HELPERS: Record<string, string> = {
  customerDetails: "Select the customer, branch, and key contacts for this opportunity.",
  rfiDetails: "Capture the request title, dates, and opportunity type.",
  timeAndMaterial: "Define the position, role, location, and engagement details.",
  // The MERGED Commercials step: Leave & Holiday costing + Commercial Details +
  // Candidate CTC Slab, with RFI Value rolling up last.
  leaveHoliday: "Everything commercial in one place: leave & holiday costing from the branch, billing type and hours, the Candidate CTC Slab — and the RFI Value it rolls up into.",
  commercial: "Billing type, hours, and RFI Value (auto from CTC Annual Revenue × Period ÷ 12 × Positions).",
  ctcSlab: "Define candidate CTC bands and revenue assumptions.",
  attachments: "Attach customer JDs and supporting documents.",
  skillEval: "Required skills and evaluation criteria.",
  onboardingStatus: "Track onboarding progress for this opportunity.",
  activityHistories: "Review recent activity before creating the opportunity.",
  activityLog: "Review recent activity before creating the opportunity.",
  address: "Enter the customer's registered and correspondence address.",
  branches: "Add one or more branches with GST/PAN and contact persons.",
  documents: "Upload contracts, MSAs, and other supporting documents.",
  billingPolicy: "Set default leave, holiday, and week-off billing rules.",
  compOff: "Configure compensatory-off balance and carry-forward limits.",
  attendance: "Define minimum hours for full-day and half-day attendance.",
  review: "Check the entered details, then save. Use Edit to jump back to any step.",
  branchInfo: "Branch identity, registered address, and tax identifiers.",
  holidayPolicy: "Per calendar year. View, edit, or freeze holiday dates.",
  leaveHolidayBilling: "Attendance hour thresholds and holidays/weekoff billable rules.",
  billingProps: "Billing frequency, cycle window, caps, and initial no-billing period.",
  leavePolicy: "Optional per-branch leave policy rows for this branch.",
};

const CUSTOMER_SECTION_HELPERS: Record<string, string> = {
  customerDetails: "Company identity, legal name, type, and status.",
  billingPolicy: "Leave & holiday billability, leave credit policies, comp-off, and attendance rules.",
};

export function sectionHelper(
  key: string,
  fallbackTitle?: string,
  variant: "opportunity" | "customer" = "opportunity",
): string {
  if (variant === "customer" && CUSTOMER_SECTION_HELPERS[key]) return CUSTOMER_SECTION_HELPERS[key];
  return SECTION_HELPERS[key]
    || (fallbackTitle ? `Complete the ${fallbackTitle} section.` : "Complete the fields below to continue.");
}

/** The icon each step key is drawn with (rail tiles, step headers). */
export const STEP_ICONS: Record<string, LucideIcon> = {
  resume: FileUp, personal: UserRound, professional: Briefcase, compensation: Wallet,
  customerDetails: Building2, address: MapPin, branches: GitBranch, documents: FileText,
  billingPolicy: CalendarDays, rfiDetails: ClipboardList, timeAndMaterial: Clock, leaveHoliday: IndianRupee,
  commercial: IndianRupee, ctcSlab: Layers, attachments: Paperclip, skillEval: Sparkles,
  onboardingStatus: ClipboardCheck, activityHistories: History, activityLog: History, review: ClipboardCheck,
  branchInfo: Building2, holidayPolicy: CalendarDays, leaveHolidayBilling: Scale, billingProps: Receipt,
  leavePolicy: Umbrella, compOff: Repeat, attendance: Clock,
};

export const stepIcon = (s: { key: string; icon?: LucideIcon }): LucideIcon =>
  s.icon || STEP_ICONS[s.key] || CircleDot;

const ICON_MAP: Record<FieldIconKind, LucideIcon> = {
  building: Building2,
  mail: Mail,
  phone: Phone,
  user: User,
  map: MapPin,
  hash: Hash,
  calendar: Calendar,
  lock: Lock,
};

export function guessFieldIcon(key: string, type?: string): FieldIconKind | undefined {
  const k = key.toLowerCase();
  if (type === "readonly" || k === "opp_id") return undefined;
  if (type === "email" || k.includes("email")) return "mail";
  if (k.includes("phone") || k.endsWith("_contact") || k.includes("hiring_manager_contact")) return "phone";
  if (type === "tel") return "phone";
  if (k.includes("contact_person") || k.includes("hiring_manager") || (k.includes("person") && !k.includes("customer"))) return "user";
  if (k === "customer_type") return "user";
  if (k.includes("branch") || k.includes("customer") || k === "name" || k.includes("company") || k.includes("legal")) return "building";
  if (k.includes("address") || k.includes("city") || k.includes("state") || k.includes("country") || k.includes("pincode") || k.includes("postal")) return "map";
  if (type === "date" || k.includes("date")) return "calendar";
  if (k.includes("gstin") || k.includes("pan")) return "hash";
  return undefined;
}

const EASE = motionTok.easeOut;
const DUR = { micro: motionTok.micro, panel: motionTok.panel };

/** The chrome's one accent gradient (indigo → purple), Tailwind palette only. */
const ACCENT = "from-indigo-600 via-indigo-600 to-purple-600";

/* ======================================================== autosave / top */
export function AutosaveIndicator({
  status,
  savedAt,
  onDark,
}: {
  status: AutosaveState;
  savedAt: number | null;
  /** Rendered on the gradient header (white text). */
  onDark?: boolean;
}) {
  const label = (() => {
    if (status === "saving") return "Saving draft…";
    if (status === "error") return "Draft not saved";
    if (status === "saved" && savedAt) {
      const secs = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
      if (secs < 8) return "Draft saved · just now";
      if (secs < 60) return `Draft saved · ${secs}s ago`;
      return `Draft saved · ${Math.floor(secs / 60)}m ago`;
    }
    if (status === "saved") return "Draft saved";
    return "Autosave on";
  })();

  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium tabular-nums ${
      onDark ? "rounded-full bg-white/15 px-2.5 py-1 text-white" : "text-[color:var(--wiz-muted)]"}`}
      role="status" aria-live="polite">
      {status === "saving" ? (
        <Loader2 size={13} className="animate-spin" aria-hidden />
      ) : status === "error" ? (
        <CloudOff size={13} className={onDark ? "" : "text-danger"} aria-hidden />
      ) : (
        <Cloud size={13} aria-hidden />
      )}
      {label}
    </span>
  );
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <span className="relative hidden h-12 w-12 shrink-0 sm:block" aria-hidden>
      <svg viewBox="0 0 48 48" className="h-12 w-12 -rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="4" />
        <circle cx="24" cy="24" r={r} fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - clamped / 100)}
          style={{ transition: "stroke-dashoffset 250ms cubic-bezier(0.2,0,0,1)" }} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[11px] font-bold tabular-nums text-white">{clamped}%</span>
    </span>
  );
}

const SEGMENT_TONE: Record<StepStatus, string> = {
  complete: "bg-[#fff]",
  partial: "bg-amber-300",
  error: "bg-rose-300",
  empty: "bg-white/25",
};

/**
 * The gradient header. Rendered FULL-BLEED: pass it as `Modal hero=` (the
 * close button floats on it) or as `WizardShell topBar=`.
 */
export function WizardTopBar({
  title,
  stepIndex,
  totalSteps,
  stepPct,
  autosaveStatus,
  savedAt,
  onSaveDraft,
  onReset,
  busy,
  showAutosave = true,
  subtitle,
  eyebrow,
  icon: Icon = ClipboardList,
  steps,
}: {
  title: string;
  stepIndex: number;
  totalSteps: number;
  stepPct: number;
  autosaveStatus?: AutosaveState;
  savedAt?: number | null;
  onSaveDraft?: () => void;
  onReset?: () => void;
  busy?: boolean;
  showAutosave?: boolean;
  /** Second line — the record, or what the form is for. */
  subtitle?: string;
  /** Small caps line above the title ("New customer"). */
  eyebrow?: string;
  icon?: LucideIcon;
  /** When given, the strip under the header shows one segment per step, coloured by its status. */
  steps?: WizardStep[];
}) {
  const reduce = useReducedMotion();
  const safeTotal = Math.max(totalSteps, 1);
  const safeStep = Math.min(stepIndex + 1, safeTotal);
  const current = steps?.[stepIndex];
  const done = steps ? steps.filter((s) => s.status === "complete").length : null;
  const ringPct = steps && steps.length ? (done! / steps.length) * 100 : stepPct;

  return (
    <div className={`relative w-full overflow-hidden bg-gradient-to-r text-white ${ACCENT}`}>
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/10" />
      <span aria-hidden className="pointer-events-none absolute -bottom-28 left-1/3 h-56 w-56 rounded-full bg-white/5" />
      <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pb-3 pt-4 pr-14 sm:px-8 sm:pr-16">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/15 shadow-lg ring-1 ring-white/30">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="flex-1 basis-48 overflow-hidden">
          <p className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-white/75">
            {eyebrow ? `${eyebrow} · ` : ""}Step {safeStep} of {safeTotal}{current ? ` · ${current.title}` : ""}
          </p>
          <h2 className="truncate text-lg font-bold leading-snug tracking-tight sm:text-xl">{title}</h2>
          {subtitle && <p className="truncate text-xs text-white/85">{subtitle}</p>}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {showAutosave && autosaveStatus != null && (
            <AutosaveIndicator status={autosaveStatus} savedAt={savedAt ?? null} onDark />
          )}
          {onSaveDraft && (
            <button type="button" onClick={onSaveDraft} disabled={busy}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full bg-white/15 px-3 text-[11px] font-semibold text-white ring-1 ring-white/25 transition hover:bg-white/25 disabled:opacity-50 ${focusRing}`}>
              <Save size={13} aria-hidden /> Save draft
            </button>
          )}
          {onReset && (
            <button type="button" onClick={onReset} disabled={busy}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-[11px] font-semibold text-white/90 ring-1 ring-white/20 transition hover:bg-white/20 disabled:opacity-50 ${focusRing}`}>
              <RotateCcw size={13} aria-hidden /> Reset
            </button>
          )}
          <ProgressRing pct={ringPct} />
        </div>
      </div>
      <div className="relative flex gap-1 px-5 pb-3 sm:px-8" aria-hidden>
        {steps && steps.length ? steps.map((s, i) => (
          <motion.span
            key={s.key}
            className={`h-1.5 flex-1 rounded-full ${i === stepIndex ? "bg-[#fff] shadow-[0_0_10px_rgba(255,255,255,0.8)]" : SEGMENT_TONE[s.status]}`}
            initial={false}
            animate={{ opacity: i === stepIndex ? 1 : 0.9 }}
            title={s.title}
          />
        )) : (
          <span className="h-1.5 w-full overflow-hidden rounded-full bg-white/25">
            <motion.span
              className="block h-full rounded-full bg-[#fff]"
              initial={false}
              animate={{ width: `${stepPct}%` }}
              transition={reduce ? { duration: 0 } : { duration: DUR.panel, ease: EASE }}
            />
          </span>
        )}
      </div>
    </div>
  );
}

/* ============================================================== stepper */
const STATUS_WORD: Record<StepStatus, string> = {
  complete: "Done",
  partial: "In progress",
  error: "Needs attention",
  empty: "Not started",
};

function StepTile({ step, isCurrent, reachable }: { step: WizardStep; isCurrent: boolean; reachable: boolean }) {
  const Icon = stepIcon(step);
  const reduce = useReducedMotion();
  const done = step.status === "complete" && !isCurrent;
  // A locked step reads neutral whatever its data says — it cannot be opened yet.
  const cls = !reachable && !isCurrent
    ? "bg-[color:var(--wiz-bg)] text-[color:var(--wiz-muted)] opacity-70 ring-1 ring-[color:var(--wiz-border)]"
    : isCurrent
    ? `bg-gradient-to-br text-white shadow-md ${ACCENT} wiz-pulse-ring`
    : done
      ? "bg-emerald-500 text-white"
      : step.status === "error"
        ? "bg-rose-500 text-white"
        : step.status === "partial"
          ? "bg-amber-100 text-amber-700 ring-1 ring-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-800"
          : reachable
            ? "bg-[color:var(--wiz-bg)] text-[color:var(--wiz-muted)] ring-1 ring-[color:var(--wiz-border-strong)]"
            : "bg-[color:var(--wiz-bg)] text-[color:var(--wiz-muted)] opacity-70 ring-1 ring-[color:var(--wiz-border)]";
  return (
    <span className={`relative z-[1] grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors duration-200 ${cls}`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={done ? "done" : step.status === "error" && !isCurrent ? "err" : "icon"}
          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: DUR.micro, ease: EASE }}
          className="inline-flex"
        >
          {done ? <Check size={16} strokeWidth={2.75} aria-hidden />
            : step.status === "error" && !isCurrent ? <AlertCircle size={16} aria-hidden />
              : <Icon size={16} aria-hidden />}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function WizardStepper({
  steps,
  currentIndex,
  maxReached,
  onSelect,
  orientation = "vertical",
  ariaLabel = "Wizard steps",
}: {
  steps: WizardStep[];
  currentIndex: number;
  maxReached: number;
  onSelect: (index: number) => void;
  orientation?: "vertical" | "horizontal";
  ariaLabel?: string;
}) {
  const vertical = orientation === "vertical";

  return (
    <nav aria-label={ariaLabel} className="w-full">
      <ol className={vertical ? "relative space-y-1.5" : "flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"}>
        {steps.map((s, i) => {
          const isCurrent = i === currentIndex;
          const reachable = i <= maxReached;
          const doneBefore = i < currentIndex || s.status === "complete";

          if (!vertical) {
            const Icon = stepIcon(s);
            return (
              <li key={s.key} className="shrink-0">
                <button type="button" disabled={!reachable} onClick={() => onSelect(i)}
                  aria-current={isCurrent ? "step" : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${focusRing} ${
                    isCurrent ? `bg-gradient-to-r text-white shadow ${ACCENT}`
                      : s.status === "complete" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                        : reachable ? "bg-[color:var(--wiz-card)] text-[color:var(--wiz-text)] ring-1 ring-[color:var(--wiz-border)]"
                          : "cursor-not-allowed text-[color:var(--wiz-muted)] opacity-60 ring-1 ring-[color:var(--wiz-border)]"}`}>
                  {s.status === "complete" && !isCurrent ? <Check size={13} aria-hidden /> : <Icon size={13} aria-hidden />}
                  <span className="tabular-nums">{i + 1}.</span> {s.title}
                </button>
              </li>
            );
          }

          return (
            <li key={s.key} className="relative flex">
              {i < steps.length - 1 && (
                <span aria-hidden className="absolute left-[25px] top-11 z-0 h-[calc(100%-26px)] w-0.5 rounded-full bg-[color:var(--wiz-border-strong)]">
                  <span className={`absolute inset-x-0 top-0 rounded-full bg-gradient-to-b from-emerald-500 to-indigo-500 transition-all duration-300 ${doneBefore ? "h-full" : "h-0"}`} />
                </span>
              )}
              <button
                type="button"
                disabled={!reachable}
                title={reachable ? s.title : "Complete the earlier steps to unlock"}
                onClick={() => onSelect(i)}
                aria-current={isCurrent ? "step" : undefined}
                className={`group relative z-[1] flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-all duration-200 ${focusRing} ${
                  isCurrent
                    ? "bg-[color:var(--wiz-card)] shadow-md ring-1 ring-indigo-300 dark:ring-indigo-700"
                    : reachable
                      ? "hover:bg-[color:var(--wiz-card)]"
                      : "cursor-not-allowed"
                }`}
              >
                <StepTile step={s} isCurrent={isCurrent} reachable={reachable} />
                <span className="flex-1 overflow-hidden">
                  <span className={`block truncate text-[13px] leading-snug ${
                    isCurrent ? "font-bold text-[color:var(--wiz-text)]"
                      : reachable ? "font-semibold text-[color:var(--wiz-text)]"
                        : "font-medium text-[color:var(--wiz-muted)]"}`}>
                    {s.title}
                  </span>
                  <span className={`mt-0.5 block truncate text-[11px] font-semibold ${
                    isCurrent ? "text-indigo-600 dark:text-indigo-300"
                      : !reachable ? "text-[color:var(--wiz-muted)]"
                      : s.status === "complete" ? "text-emerald-600 dark:text-emerald-400"
                        : s.status === "error" ? "text-rose-600 dark:text-rose-400"
                          : s.status === "partial" ? "text-amber-600 dark:text-amber-400"
                            : "text-[color:var(--wiz-muted)]"}`}>
                    {isCurrent ? "You are here" : !reachable ? "Locked" : STATUS_WORD[s.status]}
                    {s.sublabel && reachable && !isCurrent ? <span className="font-normal text-[color:var(--wiz-muted)]"> · {s.sublabel}</span> : null}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export const StepperRail = WizardStepper;

/** "3 of 5 complete" + a bar — the rail's heading. */
function RailSummary({ steps }: { steps: WizardStep[] }) {
  const done = steps.filter((s) => s.status === "complete").length;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
  return (
    <div className="mb-4 rounded-2xl border border-[color:var(--wiz-border)] bg-[color:var(--wiz-card)] p-3.5">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--wiz-muted)]">Your progress</p>
        <p className="text-xs font-bold tabular-nums text-[color:var(--wiz-text)]">{done} of {steps.length} done</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[color:var(--wiz-bg)]">
        <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-indigo-500 transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function WizardStepProgress({
  pct,
  completeLabel = "All required fields in this step are completed.",
  incompleteLabel = "Fill the required fields to continue.",
}: {
  pct: number;
  completeLabel?: string;
  incompleteLabel?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const r = 18;
  const c = 2 * Math.PI * r;
  const offset = c - (clamped / 100) * c;
  const done = clamped >= 100;

  return (
    <div className="wiz-step-progress mt-4 rounded-2xl border border-[color:var(--wiz-border)] bg-[color:var(--wiz-card)] p-3.5">
      <div className="flex items-center gap-3">
        <div className="relative h-12 w-12 shrink-0" aria-hidden>
          <svg viewBox="0 0 44 44" className="h-12 w-12 -rotate-90">
            <circle cx="22" cy="22" r={r} fill="none" stroke="var(--wiz-border-strong)" strokeWidth="3.5" />
            <circle
              cx="22" cy="22" r={r} fill="none"
              stroke={done ? "#10b981" : "#6366f1"}
              strokeWidth="3.5" strokeLinecap="round"
              strokeDasharray={c} strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 250ms cubic-bezier(0.2,0,0,1)" }}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums text-[color:var(--wiz-text)]">
            {clamped}%
          </span>
        </div>
        <div>
          <p className="text-xs font-bold text-[color:var(--wiz-text)]">This step</p>
          <p className="text-[11px] leading-snug text-[color:var(--wiz-muted)]">{done ? completeLabel : incompleteLabel}</p>
        </div>
      </div>
    </div>
  );
}

/* ====================================================== section banner */
export function SectionHeaderBanner({
  title,
  description,
  headingRef,
  icon,
  stepKey,
  step,
}: {
  title: string;
  description?: string;
  headingRef?: React.Ref<HTMLHeadingElement>;
  /** A ready icon node — or pass `stepKey` and the step's icon is used. */
  icon?: React.ReactNode;
  stepKey?: string;
  /** Prints "STEP 2 OF 5" above the title. */
  step?: { index: number; total: number };
}) {
  const KeyIcon = stepKey ? STEP_ICONS[stepKey] : undefined;
  const tile = icon ?? (KeyIcon ? <KeyIcon size={20} aria-hidden /> : null);
  return (
    <header className="mb-6 flex items-start gap-3.5 border-b border-[color:var(--wiz-border)] pb-5">
      {tile && (
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-md [&_svg]:h-5 [&_svg]:w-5 ${ACCENT}`}>
          {tile}
        </span>
      )}
      <div className="flex-1 overflow-hidden">
        {step && (
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-300">
            Step {step.index + 1} of {step.total}
          </p>
        )}
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-bold tracking-tight text-[color:var(--wiz-text)] outline-none sm:text-[22px]"
        >
          {title}
        </h2>
        {description && (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[color:var(--wiz-muted)]">
            {description}
          </p>
        )}
      </div>
    </header>
  );
}

export const WizardStepHeader = SectionHeaderBanner;

/* ============================================================== footer */
export function WizardFooter({
  stepIndex,
  totalSteps,
  isFirstStep,
  isLastStep,
  busy,
  onPrev,
  onNext,
  onSubmit,
  submitLabel = "Submit",
  submitBusyLabel = "Saving…",
  stepPct: _stepPct,
  nextTitle,
  prevTitle,
}: {
  stepIndex: number;
  totalSteps: number;
  stepPct?: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  busy?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  submitBusyLabel?: string;
  /** The next step's name — the button reads "Next: <name>". */
  nextTitle?: string;
  prevTitle?: string;
}) {
  void _stepPct;
  const safeTotal = Math.max(totalSteps, 1);
  const safeStep = Math.min(stepIndex + 1, safeTotal);
  const primary = `inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r px-5 text-sm font-semibold text-white shadow-lg transition-all duration-150 hover:-translate-y-px hover:shadow-xl hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 ${focusRing} ${ACCENT}`;

  return (
    <div className="flex w-full items-center gap-3">
      <div className="flex flex-1 justify-start">
        <button
          type="button"
          className={`${btnSecondary} h-11 gap-1.5 rounded-xl px-4 text-sm ${isFirstStep ? "invisible" : ""}`}
          onClick={onPrev}
          disabled={busy || isFirstStep}
          title={prevTitle ? `Back to ${prevTitle}` : undefined}
        >
          <ChevronLeft size={16} aria-hidden />
          <span className="hidden sm:inline">{prevTitle ? `Back: ${prevTitle}` : "Previous"}</span>
          <span className="sm:hidden">Back</span>
        </button>
      </div>

      <div className="hidden flex-col items-center gap-1.5 md:flex">
        <span className="text-[11px] font-semibold tabular-nums text-[color:var(--wiz-muted)]">
          Step {safeStep} of {safeTotal}
        </span>
        <div className="flex items-center gap-1.5" aria-hidden>
          {Array.from({ length: safeTotal }).map((_, i) => (
            <motion.span
              key={i}
              layout
              className={`h-1.5 rounded-full ${
                i === stepIndex ? `w-7 bg-gradient-to-r ${ACCENT}` : i < stepIndex ? "w-1.5 bg-indigo-400" : "w-1.5 bg-[color:var(--wiz-border-strong)]"}`}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-1 justify-end">
        {isLastStep ? (
          <button type="button" className={primary} onClick={onSubmit} disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} aria-hidden />}
            {busy ? submitBusyLabel : submitLabel}
          </button>
        ) : (
          <button type="button" className={primary} onClick={onNext} disabled={busy}>
            <span className="hidden sm:inline">{nextTitle ? `Next: ${nextTitle}` : "Next"}</span>
            <span className="sm:hidden">Next</span>
            <ChevronRight size={16} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

/* ======================================================= field chrome */
export function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <span className="wiz-field-label mb-1.5 block text-[11px] font-semibold text-[color:var(--wiz-label)]">
      {label}
      {required && <span className="ml-0.5 text-danger">*</span>}
    </span>
  );
}

export function InfoChip({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 inline-flex max-w-full items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] leading-snug text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200">
      <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function AutoFilledBadge() {
  return (
    <span className="mt-1 inline-flex items-center rounded-full bg-[color:var(--wiz-border)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--wiz-muted)]">
      Auto Filled
    </span>
  );
}

export function WizardField({
  label, required, error, icon, filled, locked, info, className = "", children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  icon?: FieldIconKind | React.ReactNode;
  filled?: boolean;
  locked?: boolean;
  info?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const IconComp = typeof icon === "string" ? ICON_MAP[icon as FieldIconKind] : null;
  const iconNode = IconComp ? <IconComp size={15} className="text-[color:var(--wiz-muted)]" aria-hidden /> : (icon as React.ReactNode);

  return (
    <div className={`block ${className}`}>
      <FieldLabel label={label} required={required} />
      <div className="relative">
        {iconNode && (
          // Centred on the 42px control (premium.css), not on the control + helper text.
          <span className="pointer-events-none absolute left-3.5 top-[21px] z-[1] -translate-y-1/2">{iconNode}</span>
        )}
        <div className={iconNode ? "[&_input]:pl-10 [&_select]:pl-10 [&_textarea]:pl-10 [&_button.min-w-0]:pl-10" : undefined}>
          {children}
        </div>
        {(locked || filled) && (
          <span className="pointer-events-none absolute right-3.5 top-[21px] -translate-y-1/2">
            {locked ? <Lock size={14} className="text-[color:var(--wiz-muted)]" aria-hidden />
              : <Check size={15} className="text-[color:var(--wiz-success)]" strokeWidth={2.5} aria-hidden />}
          </span>
        )}
      </div>
      {info}
      {error && <span className="mt-1 block text-xs text-danger" role="alert">{error}</span>}
    </div>
  );
}

/**
 * A titled group of fields inside a step (icon tile · title · hint · a tick
 * once `done`). Splits a long step into readable blocks — Name · Contact ·
 * Address … `cols` sets the grid (2 by default, 4 for a name row).
 */
export function WizardGroup({ icon: Icon, title, hint, done, accent = "from-sky-500 to-indigo-600", cols = 2, action, children }: {
  icon: LucideIcon;
  title: string;
  hint?: React.ReactNode;
  done?: boolean;
  /** Tailwind gradient stops for the icon tile. */
  accent?: string;
  cols?: 1 | 2 | 3 | 4;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const grid = cols === 1 ? "grid-cols-1" : cols === 3 ? "sm:grid-cols-3" : cols === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2";
  return (
    <section className="rounded-2xl border border-[color:var(--wiz-border)] bg-[color:var(--wiz-bg)] p-4 sm:p-5">
      <header className="mb-4 flex items-center gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow ${accent}`}>
          <Icon size={17} aria-hidden />
        </span>
        <div className="flex-1 overflow-hidden">
          <h3 className="text-sm font-bold text-[color:var(--wiz-text)]">{title}</h3>
          {hint && <p className="truncate text-xs text-[color:var(--wiz-muted)]">{hint}</p>}
        </div>
        {action}
        {done && <Check size={18} strokeWidth={2.5} className="shrink-0 text-emerald-500" aria-label="Complete" />}
      </header>
      <div className={`grid grid-cols-1 gap-x-5 gap-y-4 ${grid}`}>{children}</div>
    </section>
  );
}

export const lockedInputCls = `${inputCls} bg-[color:var(--wiz-elevated)] opacity-90 cursor-default pr-10`;

export function WizardFieldSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-[52px] w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}

/* =============================================================== frame */
/**
 * The wizard body: the step rail beside the scrolling content column (and a
 * pill strip on small screens). WizardShell uses it; so do the Modal-hosted
 * Customer and Opportunity forms — one layout, three hosts.
 */
export function WizardFrame({
  steps,
  currentIndex,
  maxReached,
  onSelectStep,
  stepProgressPct,
  ariaLabel = "Wizard steps",
  contentRef,
  railFooter,
  children,
}: {
  steps: WizardStep[];
  currentIndex: number;
  maxReached: number;
  onSelectStep: (index: number) => void;
  stepProgressPct?: number;
  ariaLabel?: string;
  contentRef?: React.Ref<HTMLDivElement>;
  railFooter?: React.ReactNode;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-[color:var(--wiz-border)] bg-[color:var(--wiz-card)] px-4 py-2.5 md:hidden">
        <WizardStepper steps={steps} currentIndex={currentIndex} maxReached={maxReached}
          onSelect={onSelectStep} orientation="horizontal" ariaLabel={ariaLabel} />
      </div>
      <div className="flex min-h-0 flex-1">
        <motion.aside
          initial={reduce ? false : { x: -16, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: DUR.panel, ease: EASE }}
          className="hidden w-[288px] shrink-0 overflow-y-auto border-r border-[color:var(--wiz-border)] bg-[color:var(--wiz-bg)] px-4 py-5 md:block lg:w-[312px]"
        >
          <RailSummary steps={steps} />
          <WizardStepper steps={steps} currentIndex={currentIndex} maxReached={maxReached}
            onSelect={onSelectStep} orientation="vertical" ariaLabel={ariaLabel} />
          {stepProgressPct != null && <WizardStepProgress pct={stepProgressPct} />}
          {railFooter}
        </motion.aside>
        <div
          ref={contentRef}
          className="wizard-body relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-4 py-5 sm:px-6 sm:py-6 lg:px-10 lg:py-8"
        >
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-10 h-[320px] w-[620px] -translate-x-1/2 rounded-full bg-indigo-500/10 blur-[90px]" />
          <div className="relative z-[1]">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================== shell */
export function WizardShell({
  title,
  onClose,
  topBar,
  footer,
  steps,
  currentIndex,
  maxReached,
  onSelectStep,
  stepProgressPct,
  ariaLabel = "Wizard steps",
  confirmClose,
  onConfirmClose,
  onCancelClose,
  confirmTitle = "Close wizard?",
  confirmMessage = "Your draft is autosaved on this device. You can continue later from where you left off.",
  contentRef,
  children,
}: {
  title?: React.ReactNode;
  onClose: () => void;
  topBar: React.ReactNode;
  footer: React.ReactNode;
  steps: WizardStep[];
  currentIndex: number;
  maxReached: number;
  onSelectStep: (index: number) => void;
  stepProgressPct?: number;
  ariaLabel?: string;
  confirmClose?: boolean;
  onConfirmClose?: () => void;
  onCancelClose?: () => void;
  confirmTitle?: string;
  confirmMessage?: string;
  contentRef?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dialog = (
    <motion.div
      className="crm-wizard wiz-noise fixed inset-0 z-[200] flex flex-col"
      style={{ background: "var(--wiz-bg)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DUR.micro }}
    >
      <div role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : ariaLabel} tabIndex={-1}
        className="flex h-[100dvh] w-full flex-col overflow-hidden">
        <header className="relative z-20 shrink-0">
          {topBar ?? title}
          <button
            type="button"
            onClick={onClose}
            className={`absolute right-3 top-3 rounded-full bg-white/15 p-1.5 text-white transition hover:bg-white/25 sm:right-5 sm:top-4 ${focusRing}`}
            aria-label="Close"
          >
            <XIcon />
          </button>
        </header>

        <WizardFrame steps={steps} currentIndex={currentIndex} maxReached={maxReached}
          onSelectStep={onSelectStep} stepProgressPct={stepProgressPct} ariaLabel={ariaLabel} contentRef={contentRef}>
          {children}
        </WizardFrame>

        <footer className="wiz-chrome-footer sticky bottom-0 z-20 shrink-0 border-t border-[color:var(--wiz-border)] bg-[color:var(--wiz-card)] px-5 py-3 sm:px-8">
          {footer}
        </footer>
      </div>
    </motion.div>
  );

  return (
    <>
      {createPortal(dialog, document.body)}
      {confirmClose && onConfirmClose && onCancelClose && (
        <ConfirmModal
          title={confirmTitle}
          message={confirmMessage}
          confirmLabel="Close"
          onConfirm={onConfirmClose}
          onClose={onCancelClose}
        />
      )}
    </>
  );
}

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

const CARD_WIDTH = { narrow: "max-w-3xl", normal: "max-w-[1000px]", wide: "max-w-5xl", full: "max-w-7xl" } as const;

export function WizardStepCard({
  stepKey,
  stepDir,
  width = "normal",
  children,
}: {
  stepKey: string;
  stepDir: number;
  width?: keyof typeof CARD_WIDTH;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.section
        key={stepKey}
        id={`sec-${stepKey}`}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, x: stepDir * 20 }}
        animate={{ opacity: 1, y: 0, x: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, x: stepDir * -20 }}
        transition={reduce ? { duration: 0 } : { duration: DUR.panel, ease: EASE }}
        className={`wiz-card relative mx-auto px-4 py-5 sm:px-8 sm:py-8 ${CARD_WIDTH[width]}`}
      >
        {children}
      </motion.section>
    </AnimatePresence>
  );
}
