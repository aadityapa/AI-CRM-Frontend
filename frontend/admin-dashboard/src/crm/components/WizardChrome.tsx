/**
 * Shared presentational chrome for multi-step CRM wizards
 * (New Opportunity, New/Edit Customer). Navigation rules live in each form.
 */
import React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, Loader2, Cloud, CloudOff } from "lucide-react";
import { motion as motionTok } from "../../design-system/tokens/tokens";
import { btnPrimary, btnSecondary, focusRing, Skeleton } from "./ui";

export type StepStatus = "complete" | "error" | "partial" | "empty";

export type WizardStep = {
  key: string;
  title: string;
  sublabel?: string;
  status: StepStatus;
};

const SECTION_HELPERS: Record<string, string> = {
  customerDetails: "Select the customer, branch, and key contacts for this opportunity.",
  rfiDetails: "Capture the request title, dates, and opportunity type.",
  timeAndMaterial: "Define the position, role, location, and engagement details.",
  leaveHoliday: "Configure leave, holiday, and week-off billing rules.",
  commercial: "Set billing type, rates, and commercial terms.",
  ctcSlab: "Define candidate CTC bands and revenue assumptions.",
  workPage: "Stage, scope, and contract duration for the work page.",
  attachments: "Attach customer JDs and supporting documents.",
  skillEval: "Required skills and evaluation criteria.",
  onboardingStatus: "Track onboarding progress for this opportunity.",
  activityHistories: "Review recent activity before creating the opportunity.",
  activityLog: "Review recent activity before creating the opportunity.",
  // Customer wizard
  address: "Enter the customer's registered and correspondence address.",
  branches: "Add one or more branches with GST/PAN and contact persons.",
  documents: "Upload contracts, MSAs, and other supporting documents.",
  billingPolicy: "Leave & holiday billability, leave credit policies, comp-off, and attendance rules.",
};

export function sectionHelper(key: string, fallbackTitle?: string): string {
  return SECTION_HELPERS[key] || (fallbackTitle ? `Complete the ${fallbackTitle} section.` : "Complete the fields below to continue.");
}

/* ---------- Autosave indicator ---------- */
export type AutosaveState = "idle" | "saving" | "saved" | "error";

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
      const mins = Math.floor(secs / 60);
      return `Draft saved · ${mins}m ago`;
    }
    if (status === "saved") return "Draft saved";
    return "Autosave on";
  })();

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted tabular-nums"
      role="status"
      aria-live="polite"
    >
      {status === "saving" ? (
        <Loader2 size={12} className="animate-spin text-brand-500" aria-hidden />
      ) : status === "error" ? (
        <CloudOff size={12} className="text-danger" aria-hidden />
      ) : (
        <Cloud size={12} className="text-brand-500/80" aria-hidden />
      )}
      {label}
    </span>
  );
}

/* ---------- Top bar title block ---------- */
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
    <div className="w-full min-w-0 pr-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-display text-base font-bold tracking-tight text-primary sm:text-lg">
          {title}
        </h2>
        <span className="hidden text-xs font-medium text-muted sm:inline">
          Step {safeStep} of {safeTotal}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {showAutosave && autosaveStatus != null && (
            <AutosaveIndicator status={autosaveStatus} savedAt={savedAt ?? null} />
          )}
          {onSaveDraft && (
            <button
              type="button"
              onClick={onSaveDraft}
              disabled={busy}
              className={`text-xs font-semibold text-secondary transition-colors hover:text-primary disabled:opacity-50 ${focusRing} rounded-control px-1.5 py-0.5`}
            >
              Save draft
            </button>
          )}
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              disabled={busy}
              className={`text-xs font-semibold text-muted transition-colors hover:text-danger disabled:opacity-50 ${focusRing} rounded-control px-1.5 py-0.5`}
            >
              Reset
            </button>
          )}
        </div>
      </div>
      <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-surface-2">
        <motion.div
          className="h-full rounded-full bg-brand-500"
          initial={false}
          animate={{ width: `${stepPct}%` }}
          transition={reduce ? { duration: 0 } : { duration: motionTok.panel, ease: motionTok.easeOut }}
        />
      </div>
    </div>
  );
}

/* ---------- Stepper ---------- */
function StepDot({
  index,
  status,
  isCurrent,
  reduce,
}: {
  index: number;
  status: StepStatus;
  isCurrent: boolean;
  reduce: boolean | null;
}) {
  const done = status === "complete" && !isCurrent;
  return (
    <span
      className={`relative z-[1] inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-shadow duration-150 ${
        isCurrent
          ? `bg-brand-600 text-white shadow-focus-ring ring-2 ring-brand-500/30 ${focusRing}`
          : done
            ? "bg-brand-600 text-white"
            : status === "error"
              ? "border-2 border-danger/60 bg-surface-1 text-danger"
              : "border border-subtle bg-surface-1 text-muted"
      }`}
    >
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.span
            key="check"
            initial={reduce ? { opacity: 1 } : { scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionTok.micro, ease: motionTok.easeOut }}
            className="inline-flex"
          >
            <Check size={14} strokeWidth={2.5} aria-hidden />
          </motion.span>
        ) : (
          <motion.span key="num" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="tabular-nums">
            {index + 1}
          </motion.span>
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
    <nav aria-label={ariaLabel} className={vertical ? "w-full" : "w-full"}>
      <ol
        className={
          vertical
            ? "relative space-y-0"
            : "flex gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        }
      >
        {steps.map((s, i) => {
          const isCurrent = i === currentIndex;
          const reachable = i <= maxReached;
          const done = s.status === "complete" && !isCurrent;
          const connectorFilled = i < currentIndex || (done && i < maxReached);

          return (
            <li
              key={s.key}
              className={vertical ? "relative flex" : "relative shrink-0"}
            >
              {vertical && i < steps.length - 1 && (
                <span
                  aria-hidden
                  className="absolute left-[13px] top-7 z-0 h-[calc(100%-4px)] w-px bg-surface-2"
                >
                  <span
                    className={`absolute inset-x-0 top-0 w-px bg-brand-500/70 transition-all duration-200 ease-out ${
                      connectorFilled ? "h-full" : "h-0"
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
                className={`group relative z-[1] flex items-start gap-3 rounded-control text-left transition-colors duration-150 ${focusRing} ${
                  vertical
                    ? "w-full px-2 py-2.5"
                    : "min-w-[9.5rem] max-w-[11rem] flex-col gap-1.5 px-2.5 py-2"
                } ${
                  isCurrent
                    ? "bg-brand-600/10"
                    : reachable
                      ? "hover:bg-surface-2/80"
                      : "cursor-not-allowed opacity-45"
                }`}
              >
                <StepDot index={i} status={s.status} isCurrent={isCurrent} reduce={reduce} />
                <span className={`min-w-0 ${vertical ? "pt-0.5" : ""}`}>
                  <span
                    className={`block truncate text-sm leading-snug ${
                      isCurrent
                        ? "font-bold text-primary"
                        : reachable
                          ? "font-semibold text-secondary group-hover:text-primary"
                          : "font-medium text-muted"
                    }`}
                  >
                    {s.title}
                  </span>
                  {s.sublabel && vertical && (
                    <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted">
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

/* ---------- Circular step progress (sidebar) ---------- */
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
    <div className="mt-6 flex items-start gap-3 border-t border-subtle px-2 pt-5">
      <div className="relative h-11 w-11 shrink-0" aria-hidden>
        <svg viewBox="0 0 44 44" className="h-11 w-11 -rotate-90">
          <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeWidth="3" className="text-surface-2" />
          <circle
            cx="22"
            cy="22"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            className={done ? "text-success" : "text-brand-500"}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums text-primary">
          {clamped}%
        </span>
      </div>
      <p className="pt-0.5 text-[11px] leading-snug text-muted">
        {done ? completeLabel : incompleteLabel}
      </p>
    </div>
  );
}

/* ---------- Step header ---------- */
export function WizardStepHeader({
  title,
  description,
  headingRef,
  icon,
}: {
  title: string;
  description?: string;
  headingRef?: React.Ref<HTMLHeadingElement>;
  icon?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4 sm:mb-8">
      <div className="min-w-0 flex items-start gap-3">
        {icon && (
          <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-brand-600/15 text-brand-600">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h3
            ref={headingRef}
            tabIndex={-1}
            className="text-display text-xl font-bold tracking-tight text-primary outline-none sm:text-2xl"
          >
            {title}
          </h3>
          {description && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>
          )}
        </div>
      </div>
      <div
        aria-hidden
        className="hidden h-16 w-28 shrink-0 overflow-hidden rounded-control bg-gradient-to-br from-brand-600/20 via-brand-500/10 to-transparent sm:block"
      >
        <svg viewBox="0 0 112 64" className="h-full w-full opacity-60" fill="none">
          <rect x="8" y="28" width="18" height="28" rx="2" className="fill-brand-500/40" />
          <rect x="30" y="16" width="22" height="40" rx="2" className="fill-brand-600/50" />
          <rect x="56" y="22" width="16" height="34" rx="2" className="fill-brand-500/35" />
          <rect x="76" y="10" width="24" height="46" rx="2" className="fill-brand-600/45" />
        </svg>
      </div>
    </header>
  );
}

/* ---------- Footer: Previous + Next both bottom-right ---------- */
export function WizardFooter({
  stepIndex,
  totalSteps,
  stepPct,
  isFirstStep,
  isLastStep,
  busy,
  onPrev,
  onNext,
  onSubmit,
  submitLabel = "Submit",
  submitBusyLabel = "Saving…",
}: {
  stepIndex: number;
  totalSteps: number;
  stepPct: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  busy?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  submitBusyLabel?: string;
}) {
  const reduce = useReducedMotion();
  const safeTotal = Math.max(totalSteps, 1);
  const safeStep = Math.min(stepIndex + 1, safeTotal);

  return (
    <div className="flex w-full items-center gap-3">
      {/* Left / center: step progress only */}
      <div className="hidden min-w-0 flex-1 flex-col items-start gap-1.5 sm:flex">
        <span className="text-[11px] font-medium tabular-nums text-muted">
          Step {safeStep} of {safeTotal}
        </span>
        <div className="h-0.5 w-full max-w-[14rem] overflow-hidden rounded-full bg-surface-2">
          <motion.div
            className="h-full rounded-full bg-brand-500/80"
            initial={false}
            animate={{ width: `${stepPct}%` }}
            transition={reduce ? { duration: 0 } : { duration: motionTok.micro, ease: motionTok.easeOut }}
          />
        </div>
      </div>

      {/* Both Previous and Next (or Submit) anchored to the right */}
      <div className="ml-auto flex shrink-0 items-center justify-end gap-2">
        <button
          type="button"
          className={`${btnSecondary} gap-1 ${isFirstStep ? "opacity-40" : ""}`}
          onClick={onPrev}
          disabled={busy || isFirstStep}
          aria-disabled={isFirstStep}
        >
          <ChevronLeft size={16} aria-hidden />
          Previous
        </button>
        {isLastStep ? (
          <button type="button" className={btnPrimary} onClick={onSubmit} disabled={busy}>
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" aria-hidden />
                {submitBusyLabel}
              </>
            ) : (
              submitLabel
            )}
          </button>
        ) : (
          <button type="button" className={btnPrimary} onClick={onNext} disabled={busy}>
            Next
            <ChevronRight size={16} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- Field skeleton while options load ---------- */
export function WizardFieldSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2" aria-busy="true" aria-label="Loading form fields">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`space-y-2 ${i === rows - 1 ? "sm:col-span-2" : ""}`}>
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  );
}

export { WizardAurora } from "./WizardAurora";
