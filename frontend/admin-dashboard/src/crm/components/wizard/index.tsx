/**
 * Premium shared wizard chrome — New Opportunity + Customer forms.
 * Visual system: Linear / Stripe / Vercel inspired (scoped via `.crm-wizard`).
 * No new UI libraries — Tailwind + framer-motion + lucide + existing btn tokens.
 */
import React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Check, ChevronLeft, ChevronRight, Loader2, Cloud, CloudOff,
  RotateCcw, Lock, Info, Save,
  Building2, Mail, Phone, User, MapPin, Hash, Calendar, type LucideIcon,
} from "lucide-react";
import { createPortal } from "react-dom";
import { motion as motionTok } from "../../../design-system/tokens/tokens";
import { ConfirmModal, btnPrimary, btnSecondary, focusRing, Skeleton, inputCls } from "../ui";
import "./premium.css";

/* ================================================================== types */
export type StepStatus = "complete" | "error" | "partial" | "empty";

export type WizardStep = {
  key: string;
  title: string;
  sublabel?: string;
  status: StepStatus;
};

export type AutosaveState = "idle" | "saving" | "saved" | "error";

export type FieldIconKind =
  | "building" | "mail" | "phone" | "user" | "map" | "hash" | "calendar" | "lock";

/* ============================================================ section copy */
const SECTION_HELPERS: Record<string, string> = {
  customerDetails: "Select the customer, branch, and key contacts for this opportunity.",
  rfiDetails: "Capture the request title, dates, and opportunity type.",
  timeAndMaterial: "Define the position, role, location, and engagement details.",
  leaveHoliday: "Estimation only for costing. Holidays / Weekoff / Leave prefill only when a leave policy is linked to the selected branch; otherwise leave blank. The APPLIED leave policy always comes from branch/project settings, not this form.",
  commercial: "Billing type, hours, and RFI Value (auto from CTC Annual Revenue × Period ÷ 12 × Positions).",
  ctcSlab: "Define candidate CTC bands and revenue assumptions — enter these before Commercial Details.",
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

/* ======================================================== autosave / top */
export function AutosaveIndicator({
  status,
  savedAt,
}: {
  status: AutosaveState;
  savedAt: number | null;
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
    <span className="inline-flex items-center gap-1.5 text-[11px] tabular-nums text-[color:var(--wiz-muted)]" role="status" aria-live="polite">
      {status === "saving" ? (
        <Loader2 size={13} className="animate-spin text-[color:var(--wiz-primary)]" aria-hidden />
      ) : status === "error" ? (
        <CloudOff size={13} className="text-danger" aria-hidden />
      ) : (
        <Cloud size={13} className="text-[color:var(--wiz-primary)]" aria-hidden />
      )}
      {label}
    </span>
  );
}

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
}) {
  const reduce = useReducedMotion();
  const safeTotal = Math.max(totalSteps, 1);
  const safeStep = Math.min(stepIndex + 1, safeTotal);

  return (
    <div className="w-full min-w-0">
      <div className="flex min-h-14 flex-wrap items-center gap-3 px-1 py-1">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold tracking-tight text-[color:var(--wiz-text)] sm:text-base">
            {title}
          </h2>
          <p className="mt-0.5 text-[11px] font-medium text-[color:var(--wiz-muted)]">
            Step {safeStep} of {safeTotal}
          </p>
        </div>
        <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:gap-2.5">
          {showAutosave && autosaveStatus != null && (
            <AutosaveIndicator status={autosaveStatus} savedAt={savedAt ?? null} />
          )}
          {onSaveDraft && (
            <button
              type="button"
              onClick={onSaveDraft}
              disabled={busy}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border border-[color:var(--wiz-border)] bg-[color:var(--wiz-elevated)] px-2.5 text-[11px] font-semibold text-[color:var(--wiz-text)] transition hover:border-[color:var(--wiz-primary)]/50 disabled:opacity-50 ${focusRing}`}
            >
              <Save size={13} aria-hidden />
              Save draft
            </button>
          )}
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              disabled={busy}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border border-[color:var(--wiz-border)] bg-[color:var(--wiz-elevated)] px-2.5 text-[11px] font-semibold text-[color:var(--wiz-muted)] transition hover:border-danger/40 hover:text-danger disabled:opacity-50 ${focusRing}`}
            >
              <RotateCcw size={13} aria-hidden />
              Reset
            </button>
          )}
        </div>
      </div>
      <div className="h-0.5 w-full overflow-hidden rounded-full bg-[color:var(--wiz-border)]">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-[#6D5DFB] to-[#8B7BFF]"
          initial={false}
          animate={{ width: `${stepPct}%` }}
          transition={reduce ? { duration: 0 } : { duration: DUR.panel, ease: EASE }}
        />
      </div>
    </div>
  );
}

/* ============================================================== stepper */
function StepDot({
  index, isCurrent, isPast, reduce,
}: {
  index: number; isCurrent: boolean; isPast: boolean; reduce: boolean | null;
}) {
  const done = isPast && !isCurrent;
  return (
    <span
      className={`relative z-[1] inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-all duration-200 ${
        isCurrent
          ? "wiz-pulse-ring bg-[#6D5DFB] text-white ring-2 ring-[#8B7BFF]/60"
          : done
            ? "bg-[#6D5DFB] text-white"
            : "border-2 border-[color:var(--wiz-border-strong)] bg-transparent text-[color:var(--wiz-muted)]"
      }`}
    >
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.span
            key="check"
            initial={reduce ? false : { scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: DUR.micro, ease: EASE }}
            className="inline-flex"
          >
            <Check size={15} strokeWidth={2.75} aria-hidden />
          </motion.span>
        ) : (
          <span className="tabular-nums">{index + 1}</span>
        )}
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
  const reduce = useReducedMotion();
  const vertical = orientation === "vertical";

  return (
    <nav aria-label={ariaLabel} className="w-full">
      <ol className={vertical ? "relative space-y-1" : "flex gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"}>
        {steps.map((s, i) => {
          const isCurrent = i === currentIndex;
          const reachable = i <= maxReached;
          const isPast = i < currentIndex;

          return (
            <li key={s.key} className={vertical ? "relative flex" : "relative shrink-0"}>
              {vertical && i < steps.length - 1 && (
                <span aria-hidden className="absolute left-[13px] top-8 z-0 h-[calc(100%-6px)] w-px bg-[color:var(--wiz-border-strong)]">
                  <span
                    className={`absolute inset-x-0 top-0 w-px bg-[#6D5DFB]/70 transition-all duration-300 ${
                      isPast ? "h-full" : "h-0"
                    }`}
                  />
                </span>
              )}
              <button
                type="button"
                disabled={!reachable}
                title={reachable ? s.title : "Complete earlier steps to unlock"}
                onClick={() => onSelect(i)}
                aria-current={isCurrent ? "step" : undefined}
                className={`group relative z-[1] flex items-start gap-2.5 rounded-xl text-left transition-all duration-200 ${focusRing} ${
                  vertical ? "w-full px-2.5 py-2" : "min-w-[9rem] flex-col gap-1 px-2 py-1.5"
                } ${
                  isCurrent
                    ? "bg-[color:var(--wiz-primary)]/10 shadow-[inset_0_0_0_1px_rgba(109,93,251,0.45)]"
                    : reachable
                      ? "hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                      : "cursor-not-allowed opacity-40"
                }`}
              >
                <StepDot index={i} isCurrent={isCurrent} isPast={isPast} reduce={reduce} />
                <span className={`min-w-0 ${vertical ? "pt-0.5" : ""}`}>
                  <span
                    className={`block truncate text-[13px] leading-snug ${
                      isCurrent
                        ? "font-semibold text-[color:var(--wiz-text)]"
                        : isPast
                          ? "font-medium text-[color:var(--wiz-text)]/80"
                          : "font-medium text-[color:var(--wiz-muted)] group-hover:text-[color:var(--wiz-text)]/90"
                    }`}
                  >
                    {s.title}
                  </span>
                  {s.sublabel && vertical && (
                    <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-[color:var(--wiz-muted)]">
                      {s.sublabel}
                    </span>
                  )}
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

export function WizardStepProgress({
  pct,
  completeLabel = "All required fields in this step are completed.",
  incompleteLabel = "Fill required fields to continue.",
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
    <div className="wiz-step-progress mt-6 rounded-2xl border border-[color:var(--wiz-border)] bg-[color:var(--wiz-elevated)] p-3.5">
      <div className="flex items-start gap-3">
        <div className="relative h-12 w-12 shrink-0" aria-hidden>
          <svg viewBox="0 0 44 44" className="h-12 w-12 -rotate-90">
            <circle cx="22" cy="22" r={r} fill="none" stroke="var(--wiz-border-strong)" strokeWidth="3.5" />
            <circle
              cx="22" cy="22" r={r} fill="none"
              stroke={done ? "var(--wiz-success)" : "var(--wiz-primary)"}
              strokeWidth="3.5" strokeLinecap="round"
              strokeDasharray={c} strokeDashoffset={offset}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums text-[color:var(--wiz-text)]">
            {clamped}%
          </span>
        </div>
        <p className="pt-1 text-[11px] leading-snug text-[color:var(--wiz-muted)]">
          {done ? completeLabel : incompleteLabel}
        </p>
      </div>
    </div>
  );
}

/* ====================================================== section banner */
export function SectionHeaderBanner({
  title,
  description,
  headingRef,
}: {
  title: string;
  description?: string;
  headingRef?: React.Ref<HTMLHeadingElement>;
  /** Kept for call-site compatibility; the clean header omits the icon tile. */
  icon?: React.ReactNode;
}) {
  // Clean, compact step header (no gradient banner / icon tile / chart art) —
  // a prominent 20px title over a muted one-line description, matching the
  // reference design. Shared by New Opportunity + New Customer + New Candidate.
  return (
    <header className="mb-6 border-b border-[color:var(--wiz-border)] pb-4">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-bold tracking-tight text-[color:var(--wiz-text)] outline-none sm:text-[22px]"
      >
        {title}
      </h2>
      {description && (
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[color:var(--wiz-muted)]">
          {description}
        </p>
      )}
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
}) {
  void _stepPct;
  const safeTotal = Math.max(totalSteps, 1);
  const safeStep = Math.min(stepIndex + 1, safeTotal);

  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 justify-between sm:justify-start">
        <button
          type="button"
          className={`${btnSecondary} h-10 gap-1.5 rounded-xl border border-[color:var(--wiz-border)] bg-transparent px-3.5 text-[12px] text-[color:var(--wiz-text)] ${isFirstStep ? "opacity-40" : ""}`}
          onClick={onPrev}
          disabled={busy || isFirstStep}
        >
          <ChevronLeft size={15} aria-hidden />
          Previous
        </button>
      </div>

      <div className="hidden flex-col items-center gap-1.5 sm:flex">
        <span className="text-[11px] font-medium tabular-nums text-[color:var(--wiz-muted)]">
          Step {safeStep} of {safeTotal}
        </span>
        <div className="flex items-center gap-1.5" aria-hidden>
          {Array.from({ length: safeTotal }).map((_, i) => (
            <motion.span
              key={i}
              layout
              className={`rounded-full transition-colors ${
                i === stepIndex
                  ? "h-1.5 w-6 bg-[#6D5DFB]"
                  : i < stepIndex
                    ? "h-1.5 w-1.5 bg-[#6D5DFB]/55"
                    : "h-1.5 w-1.5 bg-[color:var(--wiz-border-strong)]"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 justify-end">
        {isLastStep ? (
          <button type="button" className={`${btnPrimary} btn-gradient min-w-[9rem] justify-center rounded-xl px-4 text-[12px]`} onClick={onSubmit} disabled={busy}>
            {busy ? (
              <><Loader2 size={15} className="animate-spin" aria-hidden />{submitBusyLabel}</>
            ) : submitLabel}
          </button>
        ) : (
          <button type="button" className={`${btnPrimary} btn-gradient min-w-[9rem] justify-center rounded-xl px-4 text-[12px]`} onClick={onNext} disabled={busy}>
            Next
            <ChevronRight size={15} aria-hidden />
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
    <p className="mt-2 inline-flex max-w-full items-start gap-2 rounded-xl border border-[#6D5DFB]/35 bg-[#6D5DFB]/12 px-3 py-2 text-[11px] leading-snug text-[color:var(--wiz-muted)]">
      <Info size={13} className="mt-0.5 shrink-0 text-[#8B7BFF]" aria-hidden />
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
          <span className="pointer-events-none absolute left-3.5 top-1/2 z-[1] -translate-y-1/2">{iconNode}</span>
        )}
        <div className={iconNode ? "[&_input]:pl-10 [&_select]:pl-10 [&_textarea]:pl-10 [&_button.min-w-0]:pl-10" : undefined}>
          {children}
        </div>
        {(locked || filled) && (
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2">
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
  const reduce = useReducedMotion();
  const panelRef = React.useRef<HTMLDivElement>(null);

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
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="flex h-[100dvh] w-full flex-col overflow-hidden"
      >
        {/* Header 72px */}
        <header className="sticky top-0 z-20 shrink-0 border-b border-[color:var(--wiz-border)] bg-[color:var(--wiz-bg)] px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">{topBar ?? title}</div>
            <button
              type="button"
              onClick={onClose}
              className={`mb-1 shrink-0 rounded-lg p-1.5 text-[color:var(--wiz-muted)] transition hover:bg-black/[0.04] hover:text-[color:var(--wiz-text)] dark:hover:bg-white/5 dark:hover:text-white ${focusRing}`}
              aria-label="Close"
            >
              <XIcon />
            </button>
          </div>
        </header>

        {/* Mobile stepper */}
        <div className="shrink-0 border-b border-[color:var(--wiz-border)] bg-[color:var(--wiz-card)] px-4 py-2.5 md:hidden">
          <WizardStepper
            steps={steps}
            currentIndex={currentIndex}
            maxReached={maxReached}
            onSelect={onSelectStep}
            orientation="horizontal"
            ariaLabel={ariaLabel}
          />
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Sidebar 320px */}
          <motion.aside
            initial={reduce ? false : { x: -24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: DUR.panel, ease: EASE }}
            className="wiz-glass m-4 hidden w-[280px] shrink-0 overflow-y-auto rounded-[20px] p-4 lg:w-[320px] md:block"
          >
            <WizardStepper
              steps={steps}
              currentIndex={currentIndex}
              maxReached={maxReached}
              onSelect={onSelectStep}
              orientation="vertical"
              ariaLabel={ariaLabel}
            />
            {stepProgressPct != null && <WizardStepProgress pct={stepProgressPct} />}
          </motion.aside>

          {/* Content */}
          <div
            ref={contentRef}
            className="wizard-body relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6 sm:py-6 lg:px-10 lg:py-8"
          >
            {/* Soft radial glow behind card */}
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-20 h-[360px] w-[640px] -translate-x-1/2 rounded-full bg-[#6D5DFB]/10 blur-[90px]"
            />
            <div className="relative z-[1]">{children}</div>
          </div>
        </div>

        <footer className="wiz-chrome-footer sticky bottom-0 z-20 shrink-0 border-t border-[color:var(--wiz-border)] bg-[color:var(--wiz-bg)] px-5 py-3 sm:px-8">
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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function WizardStepCard({
  stepKey,
  stepDir,
  children,
}: {
  stepKey: string;
  stepDir: number;
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
        className="wiz-card relative mx-auto max-w-[1000px] px-4 py-5 sm:px-8 sm:py-8"
      >
        {children}
      </motion.section>
    </AnimatePresence>
  );
}
