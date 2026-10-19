/**
 * Timesheet look (20 Oct 2026, user ask: "redesign this Timesheet as best as" —
 * both the list and the sheet). Presentation only: every handler stays in
 * Timesheets.tsx and is passed in.
 *
 * The one idea on both screens is WHERE THE SHEET STANDS on its road:
 * Fill → Submitted → Approved → Proforma → Tax invoice. The list shows it as a
 * compact five-dot rail per row; the sheet shows it as a journey under its
 * identity band, with one "what happens next" line saying whose move it is.
 */
import type { ReactNode } from "react";
import {
  CalendarDays, CalendarClock, Check, ClipboardCheck, FileText, Receipt, Send, Undo2, UserRound, Wallet,
  type LucideIcon,
} from "lucide-react";

import { focusRing } from "../../components/ui";
import { CrmLink } from "../../router";

/* ------------------------------------------------------------------ the road */

export type TsInvoice = {
  id: number; invoice_number: string; payment_status?: string;
  kind?: "Proforma" | "Tax"; returned_at?: string | null;
};
export type TsBilling = { parts?: number; split?: boolean; fully_billed?: boolean; remaining?: number | null } | null | undefined;

export const TS_STEPS = ["Fill", "Submitted", "Approved", "Proforma", "Tax invoice"] as const;

/** How far along the road the sheet is: index of the CURRENT step. PURE. */
export function tsStepIndex(status: string | null | undefined, invoice?: TsInvoice | null): number {
  if (status === "Approved") {
    if (!invoice || invoice.returned_at) return 2;
    return invoice.kind === "Proforma" ? 3 : 4;
  }
  if (status === "Submitted") return 1;
  return 0; // Draft / Rejected
}

/** One line: whose move it is now. PURE. */
export function tsNextStep(status: string | null | undefined, invoice?: TsInvoice | null, billing?: TsBilling): {
  text: string; tone: "info" | "warn" | "ok" | "bad";
} {
  if (status === "Rejected") return { text: "Rejected — correct the days and submit again", tone: "bad" };
  if (status === "Draft") return { text: "Being filled — submit it for approval when the month is complete", tone: "info" };
  if (status === "Submitted") return { text: "Waiting for the GM to review and approve", tone: "warn" };
  if (billing?.split && !billing.fully_billed) {
    return { text: `Part billed — ${inr(billing.remaining)} still to raise on another PO`, tone: "warn" };
  }
  if (!invoice) return { text: "Approved — the GM raises the Proforma", tone: "warn" };
  if (invoice.returned_at) return { text: "Finance returned the Proforma — reissue it", tone: "bad" };
  if (invoice.kind === "Proforma") return { text: "With Finance — the tax invoice is generated from the Proforma", tone: "info" };
  return { text: invoice.payment_status === "Paid" ? "Invoiced and paid" : "Invoiced — awaiting payment", tone: "ok" };
}

const inr = (n?: number | null) =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const TONE: Record<string, string> = {
  info: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-800",
  warn: "bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800",
  ok: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800",
  bad: "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-800",
};

/** The five-dot rail for a list row. */
export function TsMiniRail({ status, invoice }: { status?: string | null; invoice?: TsInvoice | null }) {
  const at = tsStepIndex(status, invoice);
  const rejected = status === "Rejected";
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Step ${at + 1} of ${TS_STEPS.length}: ${TS_STEPS[at]}`}
      title={TS_STEPS.map((s, i) => `${i < at ? "✓" : i === at ? "●" : "○"} ${s}`).join("\n")}>
      {TS_STEPS.map((s, i) => (
        <span key={s} className={`h-1.5 rounded-full transition-all ${i === at ? "w-4" : "w-1.5"} ${
          i < at ? "bg-emerald-500"
            : i === at ? (rejected ? "bg-rose-500" : at === 4 ? "bg-emerald-500" : "bg-brand-500")
            : "bg-slate-300 dark:bg-slate-600"}`} />
      ))}
    </span>
  );
}

/** Invoice cell on a list row: the document, or the parts and what is left. */
export function TsInvoiceCell({ invoice, billing, status }: { invoice?: TsInvoice | null; billing?: TsBilling; status?: string | null }) {
  if (!invoice) {
    return status === "Approved"
      ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">To raise</span>
      : <span className="text-xs text-muted">—</span>;
  }
  const proforma = invoice.kind === "Proforma";
  return (
    <span className="inline-flex flex-col gap-0.5">
      {/* The row itself opens the timesheet — this link must not bubble to it. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <span className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <span className={`h-1.5 w-1.5 rounded-full ${invoice.returned_at ? "bg-rose-500" : proforma ? "bg-orange-500" : "bg-emerald-500"}`} aria-hidden />
        <CrmLink to={`invoices/${invoice.id}`}
          className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
          {invoice.invoice_number}
        </CrmLink>
      </span>
      <span className="text-[11px] text-muted">
        {invoice.returned_at ? "Proforma returned" : proforma ? "Proforma" : invoice.payment_status || "Tax invoice"}
        {billing?.split ? ` · ${billing.parts} part${billing.parts === 1 ? "" : "s"}` : ""}
        {billing?.split && !billing.fully_billed && billing.remaining ? ` · ${inr(billing.remaining)} left` : ""}
      </span>
    </span>
  );
}

const initials = (name?: string | null) =>
  (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

const AVATAR = [
  "from-sky-500 to-indigo-600", "from-emerald-500 to-teal-600", "from-amber-500 to-orange-600",
  "from-fuchsia-500 to-purple-600", "from-rose-500 to-pink-600", "from-cyan-500 to-sky-600",
];
const avatarOf = (name?: string | null) => AVATAR[[...(name || "")].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR.length];

/** Who + where, for a list row. */
export function TsIdentityCell({ employee, project, customer }: { employee?: string | null; project?: string | null; customer?: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br ${avatarOf(employee)} text-[11px] font-bold text-white`} aria-hidden>
        {initials(employee)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-primary">{employee || "—"}</span>
        <span className="block truncate text-[11px] text-muted">{[project, customer].filter(Boolean).join(" · ") || "—"}</span>
      </span>
    </span>
  );
}

/* --------------------------------------------------------------- list tabs */

const TAB_ICON: Record<string, LucideIcon> = {
  due: CalendarClock, submission: Send, approvals: ClipboardCheck, all: FileText,
  payroll: Wallet, myleave: UserRound, leaveApps: CalendarDays,
};

export function TsTabStrip({ tabs, active, onChange }: {
  tabs: ReadonlyArray<{ key: string; label: string }>; active: string; onChange: (k: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Timesheet sections">
      {tabs.map((t) => {
        const on = t.key === active;
        const Icon = TAB_ICON[t.key] || FileText;
        return (
          <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors ${focusRing} ${
              on ? "bg-brand-600 text-white ring-brand-600 shadow-raised" : "bg-surface-2 text-secondary ring-subtle hover:text-primary"}`}>
            <Icon size={13} aria-hidden /> {t.label}
          </button>
        );
      })}
    </div>
  );
}

export const TS_STATUS_PILLS = [
  { key: "", label: "All", dot: "bg-brand-500" },
  { key: "Draft", label: "Pending for submission", dot: "bg-slate-400" },
  { key: "Submitted", label: "Pending for approval", dot: "bg-amber-500" },
  { key: "Approved", label: "Approved", dot: "bg-emerald-500" },
  { key: "Rejected", label: "Rejected", dot: "bg-rose-500" },
] as const;

export function TsStatusPills({ value, onChange, counts }: {
  value: string; onChange: (v: string) => void; counts?: Record<string, number> | null;
}) {
  const all = counts ? Object.values(counts).reduce((s, n) => s + n, 0) : null;
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Timesheet status">
      {TS_STATUS_PILLS.map((p) => {
        const on = p.key === value;
        const n = p.key === "" ? all : counts?.[p.key] ?? (counts ? 0 : null);
        return (
          <button key={p.key || "all"} type="button" role="tab" aria-selected={on} onClick={() => onChange(p.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors ${focusRing} ${
              on ? "bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-900 dark:ring-white"
                : "bg-surface-1 text-secondary ring-subtle hover:text-primary"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} aria-hidden />
            {p.label}
            {n != null && <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${on ? "bg-white/20" : "bg-surface-2"}`}>{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- the sheet */

const STEP_ICON: LucideIcon[] = [FileText, Send, Check, Receipt, Wallet];

/** The sheet's identity band: who, which month, where on the road. */
export function TimesheetHero({
  employee, employeeCode, monthLabel, periodLabel, statusBadge, projectLink, customer, branch, projectType,
  status, invoice, billing, onChangePeriod, tools, facts,
}: {
  employee: string; employeeCode?: string | null;
  monthLabel: string; periodLabel: string;
  statusBadge: ReactNode;
  projectLink: ReactNode; customer?: string | null; branch?: ReactNode; projectType?: string | null;
  status: string; invoice?: TsInvoice | null; billing?: TsBilling;
  onChangePeriod?: () => void;
  /** Grid tools (fill, fix week-offs, fill from file) — shown under the journey. */
  tools?: ReactNode;
  facts: Array<{ label: string; value: ReactNode; tone?: "bad" | "ok" }>;
}) {
  const at = tsStepIndex(status, invoice);
  const next = tsNextStep(status, invoice, billing);
  const rejected = status === "Rejected";
  return (
    <section className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
      <div className="relative bg-gradient-to-r from-sky-700 via-brand-700 to-indigo-800 px-4 py-4 text-white sm:px-5">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/20 text-base font-bold ring-2 ring-white/30">
              {initials(employee)}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/75">
                <CrmLink to="timesheets" className="hover:underline">Timesheets</CrmLink>
                <span aria-hidden>/</span>
                <span>{employeeCode ? `Emp ID ${employeeCode}` : "Timesheet"}</span>
              </div>
              <h1 className="text-display truncate text-xl font-bold leading-tight">{employee}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/85">
                <span className="[&_a]:text-white [&_a]:underline-offset-2">{projectLink}</span>
                {customer && <span>· {customer}</span>}
                {branch && <span>· {branch}</span>}
                {projectType && <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold">{projectType}</span>}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="text-2xl font-bold leading-none">{monthLabel}</div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ring-white/20">{periodLabel}</span>
              {onChangePeriod && (
                <button type="button" onClick={onChangePeriod}
                  className="inline-flex items-center gap-1 rounded-full bg-[#ffffff] px-2.5 py-1 text-[11px] font-bold text-[#1d4ed8] hover:bg-[#eff6ff]">
                  <CalendarDays size={12} aria-hidden /> Change period
                </button>
              )}
            </div>
            <div>{statusBadge}</div>
          </div>
        </div>
      </div>

      {/* the road */}
      <div className="border-b border-subtle px-4 py-3 sm:px-5">
        <ol className="flex flex-wrap items-center gap-y-2" aria-label="Where this timesheet stands">
          {TS_STEPS.map((s, i) => {
            const Icon = i === 0 && rejected ? Undo2 : STEP_ICON[i];
            const done = i < at || (i === at && at === 4);
            const cur = i === at && !done;
            return (
              <li key={s} className="flex items-center">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  done ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                    : cur ? (rejected && i === 0 ? "bg-rose-600 text-white" : "bg-brand-600 text-white shadow-raised")
                    : "text-muted"}`} aria-current={cur ? "step" : undefined}>
                  {done ? <Check size={13} aria-hidden /> : <Icon size={13} aria-hidden />}
                  {i === 0 && rejected ? "Correct & resubmit" : s}
                </span>
                {i < TS_STEPS.length - 1 && <span className={`mx-1.5 h-px w-5 ${i < at ? "bg-emerald-400" : "bg-slate-300 dark:bg-slate-600"}`} aria-hidden />}
              </li>
            );
          })}
        </ol>
        <p className={`mt-2.5 inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${TONE[next.tone]}`} role="status">
          {next.text}
        </p>
      </div>

      {/* the month at a glance */}
      <dl className="grid grid-cols-2 gap-px bg-[color:var(--border-subtle)] sm:grid-cols-3 lg:grid-cols-6">
        {facts.map((f) => (
          <div key={f.label} className="bg-surface-1 px-4 py-3">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{f.label}</dt>
            <dd className={`mt-0.5 text-lg font-bold tabular-nums ${f.tone === "bad" ? "text-danger" : f.tone === "ok" ? "text-success" : "text-primary"}`}>{f.value}</dd>
          </div>
        ))}
      </dl>

      {tools && <div className="flex flex-wrap items-center gap-2 border-t border-subtle bg-surface-2/60 px-4 py-2.5 sm:px-5">{tools}</div>}
    </section>
  );
}

/** Section card with an icon tile — the sheet's Days / Save & Submit / Decision blocks. */
export function TsSectionHead({ icon: Icon, title, hint, tone = "brand", right }: {
  icon: LucideIcon; title: string; hint?: ReactNode; tone?: "brand" | "emerald" | "amber" | "rose"; right?: ReactNode;
}) {
  const tile = {
    brand: "from-sky-500 to-indigo-600", emerald: "from-emerald-500 to-teal-600",
    amber: "from-amber-500 to-orange-600", rose: "from-rose-500 to-pink-600",
  }[tone];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-control bg-gradient-to-br ${tile} text-white`} aria-hidden>
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold tracking-wide text-primary">{title}</h2>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

/** Small tool button on the hero's tool row. */
export const TS_TOOL_BTN =
  "inline-flex items-center gap-1.5 rounded-full border border-subtle bg-surface-1 px-3 py-1 text-xs font-semibold text-secondary "
  + "transition-colors hover:border-brand-400 hover:text-brand-700 disabled:opacity-60 dark:hover:text-brand-300";
