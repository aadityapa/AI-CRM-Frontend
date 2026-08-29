/** Shared CRM UI primitives — built on the KARNEX depth-token system
 * (src/styles/tokens.css + DEPTH_SYSTEM.md): .elev-*, .glass, .sheen,
 * .input-recessed, .btn-depth and the brand/surface/semantic Tailwind keys.
 * Every interactive element carries a :focus-visible ring (shadow-focus-ring). */
import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Inbox, Info, X, XCircle } from "lucide-react";
import { AnimatedNumber } from "./motion3d";
import { statusHelp } from "../lib/statusHelp";

/* Mirrors the motion tokens in src/styles/tokens.css (--dur-*, --ease-out).
 * framer-motion needs raw numbers — keep in sync with tokens.css. */
const DUR = { fast: 0.1, base: 0.15, slow: 0.25 } as const;
/* Shared focus-visible ring (readable on glass — 2px surface gap + brand halo). */
export const focusRing = "focus-visible:outline-none focus-visible:shadow-focus-ring";

/* ---------- Status badge (consistent colour map per spec) ---------- */
const GREEN = ["Active", "Closed_Won", "Joined", "Approved", "Paid", "Fulfilled", "Accepted", "Passed", "Present", "Open_For_Sourcing", "Confirmed"];
const BLUE = ["In_Progress", "Submitted", "Scheduled", "Posted_On_Portals", "Scored", "New", "Sourcing", "Technical_Screening", "RMG_Review", "Sales_Screening", "Customer_Screening", "Customer_Interview", "L1_Feedback", "L2_Feedback", "Shortlisted", "Customer_Approval", "Preboarding", "Completed", "Closed_Partial"];
const YELLOW = ["On_Hold", "Pending", "Pending_Scan", "Partially_Paid", "Pending_Sales_Head_Approval", "Pending_Engineering_Review", "Unpaid", "Half_Day", "Blanket", "Draft"];
const RED = ["Rejected", "Closed_Lost", "Cancelled", "Failed", "Expired", "Absent", "Sales_Head_Rejected", "Engineering_Rejected", "Sales_Rejected", "RMG_Rejected", "Customer_Rejected", "Self_Withdrawn", "Exhausted"];
const GREY = ["Archived", "Inactive", "Closed", "Not_Scheduled", "Removed", "Leave", "Holiday"];

export function statusColor(status: string): string {
  const s = String(status || "");
  if (GREEN.includes(s)) return "bg-success-soft text-success";
  if (RED.includes(s) || /reject|lost|fail|cancel/i.test(s)) return "bg-danger-soft text-danger";
  if (YELLOW.includes(s) || /pending|hold/i.test(s)) return "bg-warning-soft text-warning";
  if (GREY.includes(s) || /archiv|inactive/i.test(s)) return "bg-surface-2 text-muted";
  if (BLUE.includes(s)) return "bg-info-soft text-info";
  return "bg-surface-2 text-secondary";
}

/** Display-name overrides for stored status values (DB values stay unchanged). */
export const STATUS_LABEL_OVERRIDES: Record<string, string> = {
  Customer_Interview: "Customer Interviewing",
  // The customer's own two interview rounds. Labelled "Customer L1/L2" rather
  // than a bare "L1/L2" because RMG runs its OWN L1 and L2 much earlier in the
  // pipeline — without the prefix, a status reading "L2 Interview" is genuinely
  // ambiguous about who conducted it.
  // Label only: the stored values stay L1_Feedback / L2_Feedback.
  L1_Feedback: "Customer L1 Interview",
  L2_Feedback: "Customer L2 Interview",
  // "Shortlisted" on its own was ambiguous — we shortlist internally too. This
  // stage specifically means the CUSTOMER shortlisted them. Label only: the
  // stored value stays `Shortlisted`, so no migration and no data rewrite.
  Shortlisted: "Customer Shortlisted",
  Customer_Approval: "Customer Approved",
  // The team says "Pre Onboarding"; the column has always stored "Preboarding".
  Preboarding: "Pre Onboarding",
  // Vocabulary pass (Aug 2026): say WHO the ball is with, in plain words.
  // Label only — stored values unchanged, no migration.
  Pending_Sales_Head_Approval: "Awaiting Sales Head approval",
  Pending_Engineering_Review: "Awaiting RMG review",
  Pending_RMG: "Awaiting RMG template",
  RMG_Review: "RMG Review",
  Self_Withdrawn: "Self Withdrew",
  // Round-specific customer rejections (Aug 2026): a resume-screen "no" is a
  // different conversation from an interview "no". Stored values are new enum
  // members; the generic Customer_Rejected stays for legacy rows and for drops
  // at Shortlisted / Customer Approval.
  Customer_Screen_Rejected: "Customer Screen Reject",
  Customer_L1_Rejected: "Customer L1 Interview Reject",
  Customer_L2_Rejected: "Customer L2 Interview Reject",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL_OVERRIDES[status] ?? String(status).replace(/_/g, " ");
}

/** "Self Withdrew (RMG Review)" — the withdrawal label carrying the stage the
 * candidate withdrew FROM (candidate_profiles.withdrawn_from_status). Returns
 * undefined for every other status so callers can pass it straight to
 * StatusBadge's `label` override. */
export function selfWithdrewLabel(
  status?: string | null,
  withdrawnFrom?: string | null,
): string | undefined {
  if (status === "Self_Withdrawn" && withdrawnFrom) {
    return `Self Withdrew (${statusLabel(withdrawnFrom)})`;
  }
  return undefined;
}

export function StatusBadge({ status, label }: { status?: string | null; label?: string }) {
  if (!status) return null;
  // Every badge explains itself: hover shows what the status means and WHO
  // acts next (crm/lib/statusHelp.ts). This is where the workflow's tribal
  // knowledge lives now, instead of in colleagues' heads.
  const help = statusHelp(String(status));
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset ring-subtle ${statusColor(status)} ${help ? "cursor-help" : ""}`}
      title={help}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden />
      {label ?? statusLabel(String(status))}
      {help && (
        <Info size={12} className="shrink-0 opacity-60" aria-label={`What does ${statusLabel(String(status))} mean?`} />
      )}
    </span>
  );
}

/** Provenance chip: which layer of the leave-policy chain governs a PE leave row. */
export const POLICY_SOURCE_LABELS: Record<string, string> = {
  project: "Project override",
  branch: "Branch policy",
  customer: "Customer default",
};

export function PolicySourceChip({ source }: { source?: string | null }) {
  if (!source) return null;
  const label = POLICY_SOURCE_LABELS[source] || source;
  const cls =
    source === "project"
      ? "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
      : "bg-surface-2 text-secondary";
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}
      title={`Crediting rules inherited from the ${label.toLowerCase()}`}
    >
      {label}
    </span>
  );
}

/* ---------- Buttons ----------
 * .btn-depth (tokens.css) is the flat-first control recipe (hover/active
 * tints, focus ring, 50% disabled). Colour comes from token utilities
 * composed on top.
 * v3 primary: .btn-gradient layers the indigo→violet gradient + glow +
 * micro-lift over .btn-depth; bg-brand-600 stays as the paint fallback and
 * keeps the solid-button hover overrides in styles/tokens.css engaged. */
export const btnPrimary =
  "btn-depth btn-gradient inline-flex min-h-[40px] items-center gap-1.5 rounded-control bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed";
export const btnSecondary =
  "btn-depth inline-flex min-h-[40px] items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-3.5 py-2 text-sm font-semibold text-primary disabled:cursor-not-allowed";
export const btnDanger =
  "btn-depth inline-flex min-h-[40px] items-center gap-1.5 rounded-control bg-danger px-3.5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed";

/* ---------- Modal + ConfirmModal ---------- */
export function Modal({
  title,
  onClose,
  children,
  wide,
  fullScreen,
  medium,
  footer,
  bodyClassName,
  /** Deep layered chrome for wizards: page = surface-0, bars = surface-1. */
  deep,
  /** Optional theming scope applied to the whole modal overlay (e.g. `crm-wizard wiz-noise`). */
  scopeClassName,
  /** Extra classes on the dialog panel (e.g. glass / glow). */
  panelClassName,
  /** Extra classes on the sticky header bar. */
  headerClassName,
  /** Extra classes on the sticky footer bar (full-page only). */
  footerClassName,
  /** Accessible name when `title` is not a plain string. */
  ariaLabel,
  /** Unsaved-changes guard (17 Aug 2026): when true, Esc / backdrop / the X
   * button confirm before discarding. Explicit Cancel/Save buttons inside the
   * modal call onClose directly and are NOT affected. */
  dirty,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  /** Render as a large, near-full-viewport form surface (sticky header + scroll body). */
  fullScreen?: boolean;
  /** Mid-size dialog (e.g. file preview) — wider than default, not full-page. */
  medium?: boolean;
  /** Optional sticky footer action bar (shown only in full-page mode). */
  footer?: React.ReactNode;
  /** Extra classes for the scrollable body (e.g. flush padding for nested panes). */
  bodyClassName?: string;
  /** Use deep page background (surface-0) with raised surface-1 header/footer. */
  deep?: boolean;
  /** Optional theming scope applied to the whole modal overlay (e.g. `crm-wizard wiz-noise`). */
  scopeClassName?: string;
  panelClassName?: string;
  headerClassName?: string;
  footerClassName?: string;
  ariaLabel?: string;
  dirty?: boolean;
}) {
  const reduce = useReducedMotion();
  const guardedClose = React.useCallback(() => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  }, [dirty, onClose]);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const returnFocusRef = React.useRef<Element | null>(null);
  /** Full viewport takeover — used for create/edit forms (`fullScreen` or legacy `wide`). */
  const isFullPage = !!(fullScreen || wide);
  /* Full-page forms use surface-0 so the scroll body matches `.crm-wizard` (--wiz-bg)
     and a short shell can't leave a white band below the fold. */
  const pageBg = deep || isFullPage ? "bg-surface-0" : "bg-surface-3";
  const chromeBg = deep || isFullPage ? "bg-surface-1" : "bg-surface-3";

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") guardedClose();
      // Basic focus trap: keep Tab within the panel.
      if (e.key === "Tab" && panelRef.current) {
        const f = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
        );
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [guardedClose]);

  // Remember the trigger and restore focus to it on close (a11y).
  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    panelRef.current?.focus();
    return () => {
      (returnFocusRef.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  const scopeCls = scopeClassName ? ` ${scopeClassName}` : "";
  const outerCls = (isFullPage
    ? `fixed inset-0 z-[200] flex flex-col ${pageBg}`
    : "fixed inset-0 z-[200] flex items-center justify-center bg-backdrop p-3 sm:p-4 [backdrop-filter:blur(var(--glass-blur))] [-webkit-backdrop-filter:blur(var(--glass-blur))]") + scopeCls;
  const panelCls = [
    isFullPage
      ? "flex h-[100dvh] w-full max-w-none flex-col overflow-hidden"
      : medium
        ? "elev-3 flex w-full max-w-3xl max-h-[90dvh] flex-col overflow-hidden rounded-modal"
        : "elev-3 flex w-full max-w-lg max-h-[90dvh] flex-col overflow-hidden rounded-modal",
    panelClassName || "",
  ].filter(Boolean).join(" ");

  const dialog = (
    <motion.div
      className={outerCls}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0 : DUR.base }}
      onMouseDown={(e) => !isFullPage && e.target === e.currentTarget && guardedClose()}
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || (typeof title === "string" ? title : undefined)}
        tabIndex={-1}
        className={panelCls}
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: isFullPage ? 0.985 : 0.96, y: isFullPage ? 10 : 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 28 }}
      >
        <div className={[
          `sticky top-0 z-20 flex shrink-0 items-center justify-between gap-3 border-b border-subtle ${chromeBg} px-4 py-3.5 sm:px-8 ${isFullPage ? "" : "rounded-t-modal"}`,
          headerClassName || "",
        ].filter(Boolean).join(" ")}>
          <div className="min-w-0 flex-1 text-base font-bold text-primary">{title}</div>
          <button
            onClick={guardedClose}
            className={`ml-3 shrink-0 rounded-control p-1 text-muted transition-all duration-fast ease-smooth hover:bg-surface-2 hover:text-primary active:scale-90 ${focusRing}`}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div
          className={[
            isFullPage
              ? `relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-8 sm:py-6 ${pageBg}`
              : medium
                ? "min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5"
                : "min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5",
            bodyClassName || "",
          ].filter(Boolean).join(" ")}
        >
          {/*
            Full-page forms that nest their own overflow-y-auto (e.g. New Opportunity
            with bodyClassName overflow-hidden) need a height-bounded flex child.
            h-full + min-h-0 keeps that chain working; tall WizFormShell content still
            extends the Modal body's scroll when the body itself scrolls.
          */}
          <div className={isFullPage ? "relative flex h-full min-h-0 w-full max-w-none flex-col" : undefined}>{children}</div>
        </div>
        {isFullPage && footer && (
          <div className={[
            `wiz-chrome-footer sticky bottom-0 z-20 shrink-0 border-t border-subtle ${chromeBg} px-5 py-3 sm:px-8`,
            footerClassName || "",
          ].filter(Boolean).join(" ")}>
            {footer}
          </div>
        )}
      </motion.div>
    </motion.div>
  );

  return createPortal(dialog, document.body);
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  onConfirm,
  onClose,
  busy,
  error,
  secondaryLabel,
  onSecondary,
  secondaryBusy,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  /** Shown under the confirm message (e.g. 409 dependency block). */
  error?: string | null;
  /** Optional alternate action (e.g. Deactivate when hard-delete is blocked). */
  secondaryLabel?: string;
  onSecondary?: () => void;
  secondaryBusy?: boolean;
}) {
  const blocked = Boolean(error);
  const anyBusy = Boolean(busy || secondaryBusy);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-warning-soft p-2 text-warning">
          <AlertTriangle size={18} />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-sm text-secondary">{message}</div>
          {error ? (
            <div className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-medium text-danger" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button className={btnSecondary} onClick={onClose} disabled={anyBusy}>
          {blocked ? "Close" : "Cancel"}
        </button>
        {blocked && secondaryLabel && onSecondary ? (
          <button
            className={btnPrimary}
            onClick={onSecondary}
            disabled={anyBusy}
          >
            {secondaryBusy ? "Working…" : secondaryLabel}
          </button>
        ) : null}
        <button
          className={danger ? btnDanger : btnPrimary}
          onClick={onConfirm}
          disabled={anyBusy || blocked}
          title={blocked ? "Resolve dependencies before deleting" : undefined}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ---------- Tabs ---------- */
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onChange: (key: string) => void;
}) {
  const reduce = useReducedMotion();
  const uid = useId();
  return (
    <div className="flex flex-wrap gap-1 border-b border-subtle">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`relative -mb-px rounded-t-control px-3.5 py-2 text-sm font-semibold transition-colors duration-base ease-smooth ${focusRing} ${
            active === t.key ? "text-brand-600 dark:text-brand-300" : "text-muted hover:text-primary"
          }`}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-xs text-secondary ring-1 ring-inset ring-subtle">{t.count}</span>
          )}
          {active === t.key && (
            <motion.span
              layoutId={`crm-tab-underline-${uid}`}
              className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-brand-500"
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 35 }}
            />
          )}
        </button>
      ))}
    </div>
  );
}

/* ---------- Misc ---------- */
export function KpiCard({
  label,
  value,
  sub,
  accent = "from-brand-400 to-brand-600",
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: string;
}) {
  const numeric = typeof value === "number" && Number.isFinite(value);
  return (
    /* v3: glass card + masked gradient hairline border + 150ms lift. Tilt3D
       dropped (3D tilt on dense screens is scoped out — DESIGN-DECISIONS §14).
       KPI numerals ride --font-display (Space Grotesk); AnimatedNumber stays. */
    <div className="glass fx-gradient-border fx-lift relative h-full rounded-card p-4">
      <div
        className={`absolute inset-x-0 top-0 h-0.5 rounded-t-card bg-gradient-to-r opacity-70 ${accent}`}
        aria-hidden
      />
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="text-display mt-1 text-2xl font-bold text-primary tabular-nums">
        {numeric ? <AnimatedNumber value={value as number} /> : value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[30vh] items-center justify-center">
      <div className="elev-1 flex items-center gap-3 rounded-panel px-5 py-3">
        <span className="flex items-end gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-2 w-2 animate-bounce rounded-full bg-brand-500"
              style={{ animationDelay: `${i * 0.16}s`, animationDuration: "0.9s" }}
            />
          ))}
        </span>
        <span className="text-sm font-semibold text-secondary">{label}</span>
      </div>
    </div>
  );
}

/** Placeholder block with shimmer animation (loading states). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`shimmer rounded-control ${className}`} aria-hidden />;
}

/** v3 AI typing/thinking indicator — 3-dot pulse (.ai-thinking recipe in
 * styles/tokens.css; static staggered opacity under reduced motion). */
export function AiThinking({ label = "AI is thinking…", className = "" }: { label?: string; className?: string }) {
  return (
    <span className={`ai-thinking ${className}`} role="status" aria-label={label}>
      <span />
      <span />
      <span />
    </span>
  );
}

/** Stacked shimmer lines for paragraph-style loading placeholders. */
export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  const widths = ["w-full", "w-11/12", "w-4/5", "w-3/5"];
  return (
    <div className={`space-y-2 ${className}`} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`shimmer h-3.5 rounded-control ${widths[i % widths.length]}`} />
      ))}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  /* Permission errors are not ERRORS to the person seeing them — they are a
   * property of their role. Rendering the backend's raw "Requires one of
   * roles: Admin, CEO, TA" as a red failure box (with a useless Retry) read
   * as something being broken. One check here fixes every screen. */
  if (/requires one of roles|not permitted|permission denied|access denied/i.test(error)) {
    return (
      <div className="flex items-start gap-3 rounded-card border border-subtle bg-surface-1 px-5 py-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </span>
        <div>
          <div className="text-sm font-semibold text-primary">This section isn&rsquo;t available for your role</div>
          <div className="mt-0.5 text-sm text-secondary">
            You don&rsquo;t currently have access to this area. If you need it for your work,
            ask your administrator to grant it from Access Control.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-card border border-subtle bg-danger-soft px-4 py-3 text-sm text-danger">
      {error}
      {onRetry && (
        <button onClick={onRetry} className={`ml-3 rounded-control font-semibold underline ${focusRing}`}>Retry</button>
      )}
    </div>
  );
}

export function EmptyState({
  message,
  icon,
  actionLabel,
  onAction,
  action,
}: {
  /** Widened to ReactNode so empty states can TEACH (title + explanation),
   * not just report absence. */
  message: React.ReactNode;
  icon?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  /** v3 additive CTA slot — arbitrary action node (rendered after the
   * legacy actionLabel/onAction button when both are provided). */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      {/* v3: icon chip in a masked gradient ring (rounded-full = documented
          shape exception for the avatar-like chip). */}
      <span
        className="fx-gradient-border flex h-12 w-12 items-center justify-center rounded-full bg-surface-1 text-muted"
        aria-hidden
      >
        {icon ?? <Inbox size={22} />}
      </span>
      <div className="max-w-md text-sm text-muted">{message}</div>
      {actionLabel && onAction && (
        <button type="button" className={btnSecondary} onClick={onAction}>
          {actionLabel}
        </button>
      )}
      {action}
    </div>
  );
}

export function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-secondary">
        {label} {required && <span className="text-danger">*</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
}

/* Recessed at rest, rises to E1 + brand focus ring on focus (tokens.css). */
export const inputCls =
  "input-recessed min-h-[40px] w-full rounded-control px-3 py-2 text-sm text-primary placeholder:text-muted";

/* ---------- Toast (minimal) ---------- */
export function useToast(): [React.ReactNode, (msg: string, kind?: "ok" | "err") => void] {
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = (msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3500);
  };
  const node = (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={`${toast.kind}:${toast.msg}`}
          initial={{ opacity: 0, x: 48, scale: 0.95 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 48, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
          className={`glass fixed bottom-5 right-5 z-[250] flex items-center gap-2 rounded-card border-l-2 px-4 py-2.5 text-sm font-semibold text-primary shadow-overlay ${
            toast.kind === "ok" ? "border-l-success" : "border-l-danger"
          }`}
          role="status"
        >
          {toast.kind === "ok" ? <CheckCircle2 size={16} className="text-success" /> : <XCircle size={16} className="text-danger" />}
          {toast.msg}
        </motion.div>
      )}
    </AnimatePresence>
  );
  return [node, show];
}
