/**
 * Payment breakdown — the WHY behind a timesheet's invoice amount (20 Oct 2026
 * redesign, user ask: "redesign this pop-up as best as possible").
 *
 * Read in the order money people read it, left to right:
 *   1. the sheet — worked, billable, paid leave, LOP, comp-off;
 *   2. the rate — which rate this employee bills in and what a day / an hour
 *      of them costs in THIS period;
 *   3. the bill (sticky aside, a receipt) — Qty × Rate, the LOP deduction and
 *      the comp-off addition, sub-total, each GST part, grand total.
 *
 * Every figure comes from the server (`/api/timesheets/{id}/invoice-preview`
 * + the sheet summary); nothing is recomputed here except the two ₹ lines the
 * old pop-up already derived (LOP deduction and comp-off addition).
 */
import type { ReactNode } from "react";
import {
  AlertTriangle, Briefcase, CalendarRange, Calculator, Clock, Coffee, IndianRupee, Info, Lock,
  MinusCircle, PlusCircle, Receipt, Snowflake, UserRound,
} from "lucide-react";

import { Modal, Spinner } from "./ui";
import { DialogHero, initials } from "./dialogKit";

/* What this pop-up reads — loose on purpose, the server owns the shapes. */
export type BreakdownLine = {
  description?: string | null;
  total_billed_qty?: number | null;
  rate_per_unit?: number | null;
  leave_billable_days?: number | null;
  comp_off_billable_qty?: number | null;
  loss_of_pay_days?: number | null;
  lop_covered_days?: number | null;
  no_billing_days_excluded?: number | null;
  billing_unit?: string | null;
  working_days_in_period?: number | null;
  hours_per_full_day?: number | null;
  per_day_charge?: number | null;
  per_hour_charge?: number | null;
  amount?: number | null;
};
export type BreakdownTotals = {
  sub_total?: number | null;
  tax_amount?: number | null;
  grand_total?: number | null;
  figures_drifted?: boolean;
  live_sub_total?: number | null;
  frozen_at?: string | null;
  gst?: { cgst?: number | null; sgst?: number | null; igst?: number | null; intra?: boolean | null } | null;
};
export type BreakdownSummary = {
  total_no_of_days_worked?: number | null; present_days?: number | null;
  total_hours_worked?: number | null; hours_worked?: number | null;
  total_billable_days?: number | null; total_billable_hours?: number | null;
  comp_off_earned?: number | null;
};
export type BreakdownSheet = {
  employee?: string | null;
  monthLabel?: string | null;
  periodLabel?: string | null;
  customer?: string | null;
  project?: string | null;
};

/** ₹ with paise only when there are paise ("₹49,201.20", "₹2,00,000"). PURE. */
export function rupee(v?: number | null): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  const whole = Math.abs(n % 1) < 0.005;
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}
const figure = (v?: number | null) =>
  v === null || v === undefined ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });

const qty4 = (v?: number | null) =>
  v === null || v === undefined ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 4 });

/** What one unit of quantity is, in words. PURE. */
export function qtyMeaning(unit?: string | null, qty?: number | null): string {
  const q = Number(qty ?? 0);
  switch (unit) {
    case "Hourly": return `${figure(q)} billable hour${q === 1 ? "" : "s"}`;
    case "Daily": return `${figure(q)} billable day${q === 1 ? "" : "s"}`;
    case "Monthly":
    case "Yearly": return q === 1 ? "one full month" : `${qty4(q)} × the monthly rate`;
    default: return figure(q);
  }
}
const perUnit = (unit?: string | null) =>
  unit === "Yearly" ? "Month" : unit === "Hourly" ? "Hour" : unit === "Daily" ? "Day" : unit === "Monthly" ? "Month" : unit || "";

export function PaymentBreakdownModal({ line, totals, summary, sheet, loading, warning, onClose }: {
  line: BreakdownLine | null;
  totals: BreakdownTotals | null;
  summary?: BreakdownSummary | null;
  sheet?: BreakdownSheet;
  loading?: boolean;
  /** The server's rate/unit sanity note, rendered by the page. */
  warning?: ReactNode;
  onClose: () => void;
}) {
  const t = totals || {};
  const li = line;
  const unit = li?.billing_unit || null;
  const monthly = unit === "Monthly" || unit === "Yearly";
  const lop = Number(li?.loss_of_pay_days || 0);
  const lopAmount = lop > 0 && li?.per_day_charge != null ? Math.round(lop * Number(li.per_day_charge) * 100) / 100 : 0;
  const comp = Number(li?.comp_off_billable_qty || 0);
  const compAmount = comp > 0
    ? Math.round(comp * Number(monthly ? li?.per_day_charge || 0 : li?.rate_per_unit || 0) * 100) / 100
    : 0;
  const gst = t.gst || null;
  const subtotal = Number(t.sub_total || 0);
  const pctOf = (v?: number | null) => (subtotal > 0 && v ? `${Math.round((Number(v) / subtotal) * 1000) / 10}%` : "");
  const worked = Number(summary?.total_no_of_days_worked ?? summary?.present_days ?? 0);
  const billable = Number(summary?.total_billable_days ?? 0);

  return (
    <Modal title="Payment breakdown" xl onClose={onClose}
      hero={
        <DialogHero tone="indigo" icon={Calculator}
          eyebrow={`Payment breakdown${sheet?.monthLabel ? ` · ${sheet.monthLabel}` : ""}`}
          title={sheet?.employee || li?.description || "This timesheet"}
          subtitle={li?.description || undefined}
          chips={
            <>
              {sheet?.monthLabel && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff] px-2.5 py-1 text-xs font-bold text-[#312e81]">
                  <CalendarRange className="h-3.5 w-3.5" aria-hidden /> {sheet.monthLabel}
                </span>
              )}
              {sheet?.periodLabel && (
                <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold ring-1 ring-white/25" title="Timesheet period">
                  {sheet.periodLabel}
                </span>
              )}
              {(sheet?.customer || sheet?.project) && (
                <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold ring-1 ring-white/25">
                  <Briefcase className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{[sheet?.customer, sheet?.project].filter(Boolean).join(" · ")}</span>
                </span>
              )}
              {t.frozen_at && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold ring-1 ring-white/25"
                  title="These figures were frozen when the timesheet was approved">
                  <Lock className="h-3.5 w-3.5" aria-hidden /> Frozen at approval
                </span>
              )}
            </>
          }
        />
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5" aria-hidden />
            {t.tax_amount != null
              ? "Tax is advisory here (from the auto-resolved PO / branch); the binding figure is fixed when the invoice is raised."
              : "Tax not computable yet — no PO or buyer state code on file."}
          </span>
          <button type="button" onClick={onClose}
            className="inline-flex h-9 items-center rounded-control border border-subtle bg-surface-1 px-4 text-sm font-semibold text-secondary hover:bg-surface-2">
            Close
          </button>
        </div>
      }
    >
      {loading || !li ? (
        <Spinner label="Loading breakdown…" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)]">
          <div className="space-y-4">
            {t.figures_drifted && (
              <div role="alert" className="flex items-start gap-2 rounded-card border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  The billing policy or calendar changed after this sheet was approved. A live recompute now gives{" "}
                  <b>{rupee(t.live_sub_total)}</b>; the figures here were frozen at approval and are what gets billed.
                </span>
              </div>
            )}

            {/* 1 — the sheet */}
            <section className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-primary">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-indigo-600 to-purple-700 text-xs font-bold text-white">1</span>
                What the timesheet says
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Figure icon={UserRound} label="Days worked" value={figure(worked)} />
                <Figure icon={Clock} label="Hours worked" value={figure(summary?.total_hours_worked ?? summary?.hours_worked)} />
                <Figure icon={IndianRupee} label="Billable days" value={figure(billable)} tone="indigo"
                  hint={billable > worked ? "Includes billable week-offs / holidays / paid leave" : undefined} />
                <Figure icon={IndianRupee} label="Billable hours" value={figure(summary?.total_billable_hours)} tone="indigo" />
                <Figure icon={Coffee} label="Paid leave days" value={figure(li.leave_billable_days)} />
                <Figure icon={MinusCircle} label="Loss of pay" value={figure(li.loss_of_pay_days)} tone={lop > 0 ? "rose" : undefined} />
                <Figure icon={Snowflake} label="Comp-off credited" value={figure(summary?.comp_off_earned)} />
                <Figure icon={PlusCircle} label="Comp-off billed" value={figure(li.comp_off_billable_qty)} tone={comp > 0 ? "emerald" : undefined} />
                {Number(li.lop_covered_days || 0) > 0 && (
                  <Figure icon={PlusCircle} label="LOP covered by weekend work" value={figure(li.lop_covered_days)} tone="emerald" />
                )}
                {Number(li.no_billing_days_excluded || 0) > 0 && (
                  <Figure icon={MinusCircle} label="No-billing days" value={figure(li.no_billing_days_excluded)} tone="amber" />
                )}
              </div>
              {worked > 0 && billable > 0 && (
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-[11px] font-semibold text-muted">
                    <span>Worked {figure(worked)} d</span><span>Billed {figure(billable)} d</span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <span className="bg-gradient-to-r from-indigo-500 to-purple-600" style={{ width: `${Math.min(100, (worked / Math.max(worked, billable)) * 100)}%` }} />
                    {billable > worked && <span className="bg-indigo-200 dark:bg-indigo-800" style={{ width: `${((billable - worked) / billable) * 100}%` }} />}
                  </div>
                </div>
              )}
            </section>

            {/* 2 — the rate */}
            {unit && (
              <section className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-primary">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-indigo-600 to-purple-700 text-xs font-bold text-white">2</span>
                  The rate it bills at
                </h3>
                <div className="flex flex-wrap items-end justify-between gap-3 rounded-control bg-indigo-50 px-4 py-3 dark:bg-indigo-950/40">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Rate basis</div>
                    <div className="text-display text-2xl font-bold tabular-nums text-primary">
                      {rupee(li.rate_per_unit)} <span className="text-base font-semibold text-secondary">/ {perUnit(unit)}</span>
                    </div>
                    <div className="text-xs text-secondary">
                      From the employee&rsquo;s Commercial Details{unit === "Yearly" ? " (yearly contract ÷ 12)" : ""}
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Figure label="Days billed in period" value={figure(li.working_days_in_period)} small />
                  <Figure label="One day costs" value={rupee(li.per_day_charge)} small />
                  <Figure label={`One hour (${figure(li.hours_per_full_day)} h/day)`} value={rupee(li.per_hour_charge)} small />
                </div>
              </section>
            )}
            {warning}
          </div>

          {/* 3 — the bill */}
          <aside className="lg:sticky lg:top-0 lg:self-start">
            <div className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
              <div className="flex items-center gap-2 border-b border-dashed border-subtle px-4 py-3 text-sm font-bold text-primary">
                <Receipt className="h-4 w-4 text-indigo-600 dark:text-indigo-300" aria-hidden /> How the amount is built
              </div>
              <dl className="space-y-2.5 px-4 py-3 text-sm">
                <Row k="Quantity" v={qty4(li.total_billed_qty)} hint={qtyMeaning(unit, li.total_billed_qty)} />
                <Row k="× Rate" v={`${rupee(li.rate_per_unit)}${unit ? ` / ${perUnit(unit)}` : ""}`} />
                {lopAmount > 0 && (
                  <Row k="incl. Loss of Pay" v={`− ${rupee(lopAmount)}`} tone="rose"
                    hint={`${figure(lop)} day × ${rupee(li.per_day_charge)}`} />
                )}
                {monthly && compAmount > 0 && (
                  <Row k="incl. Comp-off billed" v={`+ ${rupee(compAmount)}`} tone="emerald"
                    hint={`${figure(comp)} day × ${rupee(li.per_day_charge)} (weekend / holiday work)`} />
                )}
                <div className="border-t border-subtle pt-2.5">
                  <Row k="Sub-total" v={rupee(t.sub_total)} strong />
                </div>
                {t.tax_amount != null && (
                  gst && (gst.cgst || gst.sgst || gst.igst) ? (
                    <>
                      {gst.intra !== false ? (
                        <>
                          <Row k={`CGST ${pctOf(gst.cgst)}`} v={rupee(gst.cgst)} muted />
                          <Row k={`SGST ${pctOf(gst.sgst)}`} v={rupee(gst.sgst)} muted />
                        </>
                      ) : (
                        <Row k={`IGST ${pctOf(gst.igst)}`} v={rupee(gst.igst)} muted />
                      )}
                      <Row k="Total GST" v={rupee(t.tax_amount)} />
                    </>
                  ) : (
                    <Row k="GST" v={rupee(t.tax_amount)} />
                  )
                )}
              </dl>
              <div className="bg-gradient-to-br from-indigo-600 via-indigo-600 to-purple-700 px-4 py-3.5 text-white">
                <div className="text-[11px] font-bold uppercase tracking-wide text-white/80">
                  {t.grand_total != null ? "Grand total" : "Sub-total"}
                </div>
                <div className="text-display text-2xl font-extrabold tabular-nums">
                  {rupee(t.grand_total != null ? t.grand_total : t.sub_total)}
                </div>
                {t.grand_total != null && <div className="text-xs text-white/80">incl. GST {rupee(t.tax_amount)}</div>}
              </div>
            </div>
            {sheet?.employee && (
              <p className="mt-2 flex items-center gap-2 text-xs text-muted">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-2 text-[10px] font-bold text-secondary">{initials(sheet.employee)}</span>
                {sheet.employee}{sheet.monthLabel ? ` · ${sheet.monthLabel}` : ""}
              </p>
            )}
          </aside>
        </div>
      )}
    </Modal>
  );
}

const TONE_TEXT: Record<string, string> = {
  indigo: "text-indigo-700 dark:text-indigo-300",
  rose: "text-rose-700 dark:text-rose-300",
  emerald: "text-emerald-700 dark:text-emerald-300",
  amber: "text-amber-700 dark:text-amber-300",
};

function Figure({ icon: Icon, label, value, tone, hint, small }: {
  icon?: typeof Clock; label: string; value: ReactNode; tone?: keyof typeof TONE_TEXT; hint?: string; small?: boolean;
}) {
  return (
    <div className="rounded-control border border-subtle bg-surface-2 px-3 py-2" title={hint}>
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.06em] text-muted">
        {Icon && <Icon className="h-3 w-3" aria-hidden />} {label}
      </div>
      <div className={`mt-0.5 font-bold tabular-nums ${small ? "text-sm" : "text-lg"} ${tone ? TONE_TEXT[tone] : "text-primary"}`}>{value}</div>
    </div>
  );
}

function Row({ k, v, hint, tone, strong, muted }: {
  k: string; v: ReactNode; hint?: string; tone?: "rose" | "emerald"; strong?: boolean; muted?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className={muted ? "text-xs text-muted" : "text-secondary"}>{k}</dt>
        <dd className={`tabular-nums ${strong ? "text-base font-bold text-primary" : muted ? "text-xs text-muted" : "font-semibold text-primary"} ${tone ? TONE_TEXT[tone] : ""}`}>{v}</dd>
      </div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}
