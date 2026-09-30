/**
 * RevenueReport — the CEO's monthly revenue page (Reports ▸ Revenue).
 *
 * Admin/CEO only. The server enforces it (`GET /api/reports/revenue` is
 * `role_required()`); the tab in CrmReports is shown only to Admin/CEO so
 * nobody else even sees the entry. Every number here is computed server-side
 * by `services/revenue_report.py` — this file only lays it out.
 *
 * Reading order mirrors how a CEO scans a month: the four headline numbers
 * (billed · collected · outstanding · overdue) with month-on-month and
 * year-on-year deltas, then the 12-month trend, then "who paid us" (customer
 * concentration), "who owes us" (ageing), "what is coming" (pipeline / PO
 * runway) and "what leaked" (LOP days on approved sheets).
 *
 * v2 (18 Sep 2026): alerts strip first (the exception list), targets with
 * attainment + run-rate + FY projection (editable here — Admin/CEO only),
 * gross margin per customer (CTC/12 people cost), 3-month forecast from the
 * deployed team's rates, DSO / days-to-pay, billing by type / branch / owner,
 * and the month-close Excel pack (`/api/reports/revenue/export.xlsx`).
 *
 * v3 (21 Sep 2026): the same page at three zooms — Month / Quarter / Financial
 * year — plus customer and project filters that narrow EVERYTHING (the server
 * applies them in SQL, so ageing and leakage follow too), and two new tables:
 * revenue by project and revenue by employee. The month input is the ANCHOR in
 * every zoom, so one date control serves all three and every `?month=` link
 * already in circulation keeps resolving. The Excel pack carries the same four
 * parameters, so the download is always the workbook of what is on screen.
 *
 * v4 (24 Sep 2026): restyled in the Dashboard's control-tower language, on
 * the shared atoms in `crm/components/controlTower.tsx` — an 8-tile KPI strip,
 * three half-dial gauges (period target · financial year · collections/DSO),
 * a customer-share donut, step bars for ageing / forecast / dimensions. The
 * payload and every number are unchanged; only the presentation moved.
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Download, Filter, RefreshCw, Target, X,
} from "lucide-react";
import { authFetch } from "../../../api/client";
import { crmGet, qs } from "../../api";
import { CrmLink } from "../../routerHooks";
import { ErrorBox, SkeletonText, btnPrimary, btnSecondary, useToast } from "../../components/ui";
import {
  CONTROL, DateStepper, Delta, FilteredBars, ICON_BTN, MiniStat, PERIODS, Panel, PeriodSwitcher, STATE_CHIP,
  Speedometer, Tile, inr, inrCompact, pct, periodMeta, shiftMonthKey, thisMonthKey,
} from "../../components/controlTower";
import type { PeriodKind, StateTone } from "../../components/controlTower";
import { PlacementsPanel } from "./PlacementsPanel";
import { RevenueTargetsModal, monthLabelOf } from "../../components/RevenueTargetsModal";

/* ---------- Wire shape (services/revenue_report.py) ---------- */

type Headline = {
  billed: number; gst: number; billed_incl_gst: number; invoices: number;
  collected: number; collection_rate_pct: number | null;
  outstanding: number; open_invoices: number;
  billed_prev: number; billed_mom_pct: number | null;
  billed_yoy: number; billed_yoy_pct: number | null;
  collected_prev: number; collected_mom_pct: number | null;
  months_in_period: number; billed_per_month: number; comparison_label: string;
};
type SeriesPoint = { month: string; label: string; billed: number; collected: number; invoices: number };
type CustomerRow = {
  customer_id: number | null; customer: string; billed: number; invoices: number; collected: number;
  share_pct: number; previous: number; change_pct: number | null;
};
type ProjectRow = {
  project_id: number; project: string; customer: string | null; customer_id: number | null;
  billed: number; invoices: number; previous: number; change_pct: number | null;
  cost: number; margin: number; margin_pct: number | null; heads: number; share_pct: number;
};
type EmployeeRow = {
  employee_id: number; employee: string; employee_code: string | null;
  customer: string | null; project: string | null;
  billed: number; invoices: number; cost: number; margin: number; margin_pct: number | null;
  billed_per_month: number; deployed: boolean;
};
type FilterOption = {
  id: number; name: string; customer_id?: number | null;
  /** Did this account/project bill inside the selected period? */
  billed?: boolean;
  /** Dormant records stay selectable — they are just labelled. */
  active?: boolean;
};
type AgeingBucket = { label: string; amount: number; count: number };

type Targets = {
  month_target: number | null; month_target_is_default: boolean; month_attainment_pct: number | null;
  month_gap: number | null; run_rate: number; run_rate_attainment_pct: number | null; is_current_month: boolean;
  fy_label: string; fy_start: string; fy_end: string; fy_target: number | null; fy_billed_to_date: number;
  fy_attainment_pct: number | null; fy_months_elapsed: number; fy_months_remaining: number;
  fy_projection: number; fy_projection_pct: number | null; fy_required_monthly: number | null;
  period_label: string; months_with_target: number;
  fy_target_is_default: boolean; fy_key: string; anchor_month: string; anchor_month_target: number | null;
  anchor_month_target_is_override: boolean; quarter_key: string; quarter_label: string;
  quarter_target: number | null; quarter_months_with_target: number;
};
type MarginRow = {
  customer_id: number; customer: string; billed: number; cost: number; margin: number; margin_pct: number | null; heads: number;
};
type ForecastMonth = {
  month: string; label: string; amount: number; heads: number; roll_off_count: number; po_covered: boolean;
  roll_offs: { name: string; customer: string; exit: string }[];
};
type DimRow = { label: string; billed: number; invoices: number; share_pct: number };
type CashMonth = {
  month: string; label: string; expected: number; expected_at_pace: number; invoices: number;
  people_cost: number; net: number; net_at_pace: number;
};
type Cashflow = {
  as_of: string; months: CashMonth[]; horizon_months: number; slip_days: number;
  overdue: { amount: number; count: number };
  beyond_horizon: { amount: number; count: number };
  expected_total: number; expected_total_at_pace: number; people_cost_total: number;
  net_total: number; net_total_at_pace: number; covers_cost: boolean;
  unbilled_ready: { amount: number; count: number };
  top_expected: {
    customer: string; number: string; amount: number; due: string; expected: string;
    overdue_days: number;
  }[];
  heads_costed: number; heads_without_ctc: number; assumptions: string;
};
type Alert = { key: string; level: "warn" | "bad"; title: string; detail: string };

export type { PeriodKind } from "../../components/controlTower";

export type RevenueReportData = {
  month: string; label: string; as_of: string;
  period: PeriodKind; period_key: string; period_start: string; period_end: string;
  months_in_period: number; short_label: string; comparison_label: string;
  filters: {
    customer_id: number | null; project_id: number | null;
    options: { customers: FilterOption[]; projects: FilterOption[] };
  };
  headline: Headline;
  series: SeriesPoint[];
  by_customer: {
    rows: CustomerRow[]; customers: number; top1_share_pct: number; top3_share_pct: number;
    concentration_risk: boolean; top_customer: string | null;
  };
  ageing: {
    buckets: AgeingBucket[]; overdue_total: number; overdue_90_plus: number;
    top_overdue_customers: { customer: string; overdue: number }[];
  };
  pipeline: {
    approved_uninvoiced: { count: number; amount: number };
    active_po_balance: number; avg_monthly_billed: number; po_cover_months: number | null;
  };
  by_project: {
    rows: ProjectRow[]; projects: number; billed: number; heads_without_ctc: number;
    loss_making: ProjectRow[];
  };
  by_employee: {
    rows: EmployeeRow[]; employees: number; billing_heads: number;
    linked_billed: number; unlinked_billed: number; unlinked_invoices: number;
    coverage_pct: number | null; avg_revenue_per_head: number | null;
    idle_heads: { employee: string; customer: string | null; project: string | null; cost: number }[];
    idle_count: number; idle_cost: number; heads_without_ctc: number;
  };
  efficiency: { deployed_heads: number; revenue_per_head: number | null; revenue_per_head_per_month: number | null };
  leakage: {
    approved_sheets: number; lop_days: number; lop_covered_by_weekend_work_days: number;
    no_billing_period_days: number;
  };
  targets: Targets;
  margin: {
    billed: number; cost: number; gross_margin: number; gross_margin_pct: number | null;
    heads_without_ctc: number; loss_making: MarginRow[]; by_customer: MarginRow[];
  };
  forecast: { months: ForecastMonth[]; total: number; po_shortfall: number; assumptions: string };
  collections: { dso_days: number | null; dso_window_days: number; avg_days_to_pay: number | null; receipts: number; outstanding: number };
  cashflow: Cashflow;
  dimensions: { by_type: DimRow[]; by_branch: DimRow[]; by_owner: DimRow[] };
  alerts: Alert[];
};

/* ---------- Formatting ---------- */

// `inr` / `inrCompact` / `pct` / `Delta` live in controlTower.tsx (28 Sep 2026) — one copy for every tower.


const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Attainment → state: ≥ 100 ok · ≥ 80 warn · else bad · no target none. */
const attainmentState = (p: number | null | undefined): StateTone =>
  p === null || p === undefined ? "none" : p >= 100 ? "ok" : p >= 80 ? "warn" : "bad";

/** DSO → state. 45 days is comfortable on 30-day terms; past 60 the page already flags it. */
const DSO_WARN_DAYS = 45;
const DSO_BAD_DAYS = 60;
const dsoState = (d: number | null): StateTone =>
  d === null ? "none" : d <= DSO_WARN_DAYS ? "ok" : d <= DSO_BAD_DAYS ? "warn" : "bad";

/* ---------- Controls ---------- */

/** Customer → project filter pair. Projects are scoped to the chosen customer
 *  so the second dropdown can never offer a combination that returns nothing. */
function FilterBar({
  options, customerId, projectId, onCustomer, onProject,
}: {
  options: { customers: FilterOption[]; projects: FilterOption[] };
  customerId: number | null;
  projectId: number | null;
  onCustomer: (v: number | null) => void;
  onProject: (v: number | null) => void;
}) {
  const projects = customerId
    ? options.projects.filter((p) => p.customer_id === customerId)
    : options.projects;
  const active = customerId !== null || projectId !== null;

  /**
   * Split into "billed here" and "everything else" rather than filtering the
   * quiet ones out. A dropdown that hides an account the CEO knows exists reads
   * as a bug, and "why did this one bill nothing?" is a question this page
   * should answer — so the option has to be selectable.
   */
  const split = (rows: FilterOption[]) => ({
    billed: rows.filter((r) => r.billed),
    quiet: rows.filter((r) => !r.billed),
  });
  const label = (r: FilterOption) => (r.active === false ? `${r.name} (inactive)` : r.name);
  const cust = split(options.customers);
  const proj = split(projects);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <Filter className="h-3.5 w-3.5" aria-hidden /> Scope
      </span>
      <select
        className={`${CONTROL} w-[13rem] max-w-full`}
        value={customerId ?? ""}
        onChange={(e) => onCustomer(e.target.value ? Number(e.target.value) : null)}
        aria-label="Filter by customer"
      >
        <option value="">All customers</option>
        {cust.billed.length > 0 && (
          <optgroup label="Billed in this period">
            {cust.billed.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}
          </optgroup>
        )}
        {cust.quiet.length > 0 && (
          <optgroup label="No billing in this period">
            {cust.quiet.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}
          </optgroup>
        )}
      </select>
      <select
        className={`${CONTROL} w-[13rem] max-w-full`}
        value={projectId ?? ""}
        onChange={(e) => onProject(e.target.value ? Number(e.target.value) : null)}
        aria-label="Filter by project"
        disabled={projects.length === 0}
      >
        <option value="">All projects</option>
        {proj.billed.length > 0 && (
          <optgroup label="Billed in this period">
            {proj.billed.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
          </optgroup>
        )}
        {proj.quiet.length > 0 && (
          <optgroup label="No billing in this period">
            {proj.quiet.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
          </optgroup>
        )}
      </select>
      {active && (
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1 rounded-control px-2 text-xs font-semibold text-brand-600 transition-colors duration-micro hover:bg-surface-2 dark:text-brand-300"
          onClick={() => { onCustomer(null); onProject(null); }}
        >
          <X className="h-3.5 w-3.5" aria-hidden /> Clear
        </button>
      )}
    </div>
  );
}

/* ---------- Small pieces ---------- */

/** Amber note inside a panel body — a caveat the number carries. */
function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-start gap-2 rounded-control border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

/* Table atoms. The header row is sticky so a long project/employee table keeps
   its column names while the CEO scrolls it. */
const thCls =
  "sticky top-0 z-10 bg-surface-2 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-muted";
const tdCls = "px-3 py-2.5 align-middle text-sm text-secondary";
const tdNum = `${tdCls} text-right tabular-nums`;
/* No `/60` alpha here: Tailwind emits no rule at all for an alpha modifier on
   a var() colour, so the hover would silently do nothing. */
const trCls = "border-b border-subtle transition-colors duration-micro last:border-0 hover:bg-surface-2";
/* A table bleeds to the panel's edges. `-mb-5` cancels the body padding BELOW
   it, so use `tableWrap` only when the table is the LAST thing in the panel —
   otherwise it drags the following paragraph up over the rows. */
const tableWrapMid = "-mx-5 overflow-x-auto";
const tableWrap = `${tableWrapMid} -mb-5`;
/** Long lists scroll inside the panel, so `thCls`'s sticky header stays put. */
const tableWrapTall = `${tableWrap} max-h-[26rem] overflow-y-auto`;
const tableWrapTallMid = `${tableWrapMid} max-h-[26rem] overflow-y-auto`;

/** Share bar inside a table cell. */
function ShareCell({ value, width = "w-16" }: { value: number; width?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-1.5 ${width} overflow-hidden rounded-full bg-surface-2`} aria-hidden>
        <span className="block h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </span>
      {pct(value, 0)}
    </span>
  );
}

/** Small key → value list used by the side panels. */
function Stat({ k, v, tone, sub }: { k: string; v: React.ReactNode; tone?: "danger" | "success"; sub?: string }) {
  const cls = tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-primary";
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-secondary">{k}</dt>
      <dd className={`text-right font-semibold tabular-nums ${cls}`}>
        {v}
        {sub && <div className="text-xs font-normal text-muted">{sub}</div>}
      </dd>
    </div>
  );
}

/** Attainment bar: green ≥ 100, amber ≥ 80, red below. */
function Attainment({ pctValue }: { pctValue: number | null }) {
  if (pctValue === null) return <span className="text-xs font-normal text-muted">no target</span>;
  const tone = pctValue >= 100 ? "bg-emerald-500" : pctValue >= 80 ? "bg-amber-500" : "bg-rose-500";
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-1" aria-hidden>
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, Math.max(0, pctValue))}%` }} />
      </span>
      <span className="text-xs font-semibold tabular-nums text-primary">{pct(pctValue, 0)}</span>
    </span>
  );
}

/**
 * The CEO's exception list — the first thing on the page when non-empty.
 *
 * One bordered card holding the rows, not N floating boxes: a stack of
 * full-width banners is the single loudest thing on a page and it drowned the
 * numbers underneath. Beyond ALERTS_VISIBLE the rest collapse behind a toggle,
 * so a bad month cannot push the KPIs below the fold.
 */
const ALERTS_VISIBLE = 3;

function AlertsStrip({ alerts, periodLabel }: { alerts: Alert[]; periodLabel: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!alerts.length) {
    return (
      <div className="flex items-center gap-2.5 rounded-card border border-success bg-success-soft px-4 py-3 text-sm font-medium text-success">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
        Nothing needs your attention in {periodLabel}.
      </div>
    );
  }
  const bad = alerts.filter((a) => a.level === "bad").length;
  const shown = expanded ? alerts : alerts.slice(0, ALERTS_VISIBLE);
  const hidden = alerts.length - shown.length;
  return (
    <section className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
      <header className="flex items-center gap-2 border-b border-subtle bg-surface-2 px-4 py-2.5">
        <AlertTriangle className={`h-4 w-4 ${bad ? "text-danger" : "text-warning"}`} aria-hidden />
        <h2 className="text-sm font-bold text-primary">Needs attention</h2>
        <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-bold tabular-nums text-secondary">
          {alerts.length}
        </span>
        {bad > 0 && (
          <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-bold tabular-nums text-danger">
            {bad} urgent
          </span>
        )}
      </header>
      <ul className="divide-y divide-subtle">
        {shown.map((a) => (
          <li key={a.key} className="flex items-start gap-3 px-4 py-3">
            <span
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.level === "bad" ? "bg-danger" : "bg-warning"}`}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary">{a.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-secondary">{a.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      {(hidden > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full border-t border-subtle px-4 py-2 text-xs font-semibold text-brand-600 transition-colors duration-micro hover:bg-surface-2 dark:text-brand-300"
        >
          {expanded ? "Show less" : `Show ${hidden} more`}
        </button>
      )}
    </section>
  );
}

/** Chart rows: the top `MAX_BAR_ROWS` by the sort key; the rest fold into "Others" so a
 *  long book stays readable (the table below still lists everyone). */
const MAX_BAR_ROWS = 12;
function topRows<T extends Record<string, unknown>>(rows: T[], by: keyof T, label: (r: T) => string, sums: (keyof T)[]): Record<string, unknown>[] {
  const sorted = [...rows].sort((x, y) => Number(y[by] ?? 0) - Number(x[by] ?? 0));
  const top = sorted.slice(0, MAX_BAR_ROWS).map((r) => ({ label: label(r), ...Object.fromEntries(sums.map((k) => [k, Number(r[k] ?? 0)])) }));
  const rest = sorted.slice(MAX_BAR_ROWS);
  if (rest.length) {
    top.push({ label: `Others (${rest.length})`, ...Object.fromEntries(sums.map((k) => [k, rest.reduce((a, r) => a + Number(r[k] ?? 0), 0)])) });
  }
  return top;
}

/** One segmented control for the three billing dimensions. */
type DimKey = "by_type" | "by_branch" | "by_owner";
const DIM_OPTIONS: { key: DimKey; label: string }[] = [
  { key: "by_type", label: "Engagement type" }, { key: "by_branch", label: "Customer branch" }, { key: "by_owner", label: "Sales owner" },
];

/* ---------- Gauge cards ---------- */

/** Period target: sweep = billed, tick = target, needle = billed. */
function PeriodTargetCard({ data, meta }: { data: RevenueReportData; meta: ReturnType<typeof periodMeta> }) {
  const t = data.targets;
  const billed = data.headline.billed;
  const target = t.month_target;
  const state = attainmentState(t.month_attainment_pct);
  const scaleMax = Math.max(target ?? 0, billed, t.is_current_month ? t.run_rate : 0, 1) * 1.1;
  const hint = target === null
    ? `Set a monthly target to measure the ${meta.label.toLowerCase()}`
    : data.months_in_period > 1
      ? `sum of ${t.months_with_target} monthly target(s)`
      : t.month_target_is_default ? "using the default monthly target" : "month-specific target";
  return (
    <Panel
      title={`Target · ${data.label}`}
      hint={hint}
      action={
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP[state]}`}>
          {target === null ? "No target" : pct(t.month_attainment_pct, 0)}
        </span>
      }
    >
      <div className="space-y-3">
        <Speedometer value={billed} max={scaleMax} marker={target} markerLabel="target" state={state} label="Period target" caption="billed so far" format={inrCompact} />
        <div className="grid grid-cols-2 gap-2">
          <MiniStat k="Target" v={inr(target)} />
          <MiniStat k="Billed" v={<Attainment pctValue={t.month_attainment_pct} />} />
          {t.is_current_month && (
            <MiniStat k={`Run-rate · full ${meta.label.toLowerCase()}`} v={inr(t.run_rate)} tone={attainmentState(t.run_rate_attainment_pct) === "none" ? undefined : attainmentState(t.run_rate_attainment_pct)}
              hint={t.run_rate_attainment_pct === null ? undefined : `${pct(t.run_rate_attainment_pct, 0)} of target at this pace`} />
          )}
          {t.month_gap !== null && (
            <MiniStat k={t.month_gap > 0 ? "Still to bill" : "Ahead by"} v={inr(Math.abs(t.month_gap))} tone={t.month_gap > 0 ? "bad" : "ok"} />
          )}
          <p className="col-span-2 text-xs text-muted">
            Billed = invoice value before GST, by invoice date · {data.headline.invoices} invoice{data.headline.invoices === 1 ? "" : "s"} in {data.label}
          </p>
        </div>
      </div>
    </Panel>
  );
}

/** Financial year: sweep = billed to date, tick = FY target. State follows the PROJECTION. */
function FyTargetCard({ data }: { data: RevenueReportData }) {
  const t = data.targets;
  const state = attainmentState(t.fy_projection_pct);
  const scaleMax = Math.max(t.fy_target ?? 0, t.fy_billed_to_date, t.fy_projection, 1) * 1.1;
  const needMore = t.fy_required_monthly !== null && t.fy_months_remaining > 0;
  return (
    <Panel
      title={`${t.fy_label} · April to March`}
      hint={`${t.fy_months_elapsed} of 12 months booked`}
      action={
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP[state]}`}>
          {t.fy_target === null ? "No FY target" : `Projected ${pct(t.fy_projection_pct, 0)}`}
        </span>
      }
    >
      <div className="space-y-3">
        <Speedometer value={t.fy_billed_to_date} max={scaleMax} marker={t.fy_target} markerLabel="FY target" state={state} label="Financial year" caption="billed to date" format={inrCompact} />
        <div className="grid grid-cols-2 gap-2">
          <MiniStat k="FY target" v={inr(t.fy_target)} />
          <MiniStat k="To date" v={<Attainment pctValue={t.fy_attainment_pct} />} />
          <MiniStat k="Projected close" v={inr(t.fy_projection)} tone={state === "none" ? undefined : state}
            hint={t.fy_projection_pct === null ? undefined : `${pct(t.fy_projection_pct, 0)} of the FY target at the last-3-month pace`} />
          {needMore && (
            <MiniStat k={`Needed / month · ${t.fy_months_remaining} left`} v={inr(Math.max(0, t.fy_required_monthly!))}
              tone={t.fy_required_monthly! > data.pipeline.avg_monthly_billed ? "bad" : "ok"} />
          )}
          <p className="col-span-2 text-xs text-muted">
            Projection = billed to date + the trailing 3-month average × months left.
          </p>
        </div>
      </div>
    </Panel>
  );
}

/** Collections: sweep = DSO days, tick = the 60-day line. Lower is better here. */
function CollectionsCard({ data }: { data: RevenueReportData }) {
  const c = data.collections;
  const state = dsoState(c.dso_days);
  const dso = c.dso_days ?? 0;
  const scaleMax = Math.max(90, Math.ceil((dso * 1.2) / 30) * 30);
  const fmtDays = (v: number) => `${Math.round(v)} d`;
  return (
    <Panel
      title="Collections"
      hint={`DSO over the last ${c.dso_window_days} days · lower is better`}
      action={
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP[state]}`}>
          {c.dso_days === null ? "No billing" : state === "ok" ? "Healthy" : state === "warn" ? "Slowing" : "Slow"}
        </span>
      }
    >
      <div className="space-y-3">
        <Speedometer value={dso} max={scaleMax} marker={DSO_BAD_DAYS} markerLabel="limit" state={state} invert label="Days sales outstanding" caption="days sales outstanding" format={fmtDays}
          ariaLabel={`DSO ${c.dso_days === null ? "not available" : `${c.dso_days} days`}; the tick marks ${DSO_BAD_DAYS} days`} />
        <div className="grid grid-cols-2 gap-2">
          <MiniStat k="Avg days to pay" v={c.avg_days_to_pay === null ? "—" : `${c.avg_days_to_pay} d`} hint="amount-weighted, receipts in this period" />
          <MiniStat k="Receipts" v={c.receipts.toLocaleString("en-IN")} />
          <MiniStat k="Outstanding" v={inr(data.headline.outstanding)} />
          <MiniStat k="Overdue" v={inr(data.ageing.overdue_total)} tone={data.ageing.overdue_total > 0 ? "bad" : "ok"} />
          <p className="col-span-2 text-xs text-muted">
            DSO = outstanding ÷ trailing-{c.dso_window_days}-day billing (incl. GST) × {c.dso_window_days}. The tick is the {DSO_BAD_DAYS}-day line.
          </p>
        </div>
      </div>
    </Panel>
  );
}

/* ---------- Page ---------- */

export function RevenueReport() {
  const params = new URLSearchParams(window.location.search);
  const [month, setMonth] = useState<string>(() => params.get("month") || thisMonthKey());
  const [period, setPeriod] = useState<PeriodKind>(() => {
    const p = params.get("period");
    return PERIODS.some((x) => x.key === p) ? (p as PeriodKind) : "month";
  });
  const [customerId, setCustomerId] = useState<number | null>(() => {
    const v = Number(params.get("customer_id"));
    return Number.isFinite(v) && v > 0 ? v : null;
  });
  const [projectId, setProjectId] = useState<number | null>(() => {
    const v = Number(params.get("project_id"));
    return Number.isFinite(v) && v > 0 ? v : null;
  });
  const [data, setData] = useState<RevenueReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dim, setDim] = useState<DimKey>("by_type");
  const [toast, showToast] = useToast();

  /** The query every request on this page shares, so the workbook can never be
   *  a different slice from what is on screen. */
  const query = useMemo(
    () => ({ month, period, customer_id: customerId ?? undefined, project_id: projectId ?? undefined }),
    [month, period, customerId, projectId],
  );

  /** Period-close workbook — streamed through authFetch (a bare <a href> carries no bearer). */
  const exportXlsx = async () => {
    setExporting(true);
    try {
      const res = await authFetch(`/api/reports/revenue/export.xlsx${qs(query)}`);
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `karnex-revenue-${data?.period_key || month}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      showToast(e?.message || "Export failed", "err");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    crmGet<RevenueReportData>(`/api/reports/revenue${qs(query)}`)
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || "Could not load the revenue report"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query, tick]);

  /** Picking a customer drops a project that belongs to somebody else, so the
   *  two dropdowns can never describe an empty intersection. */
  const pickCustomer = (id: number | null) => {
    setCustomerId(id);
    if (id !== null && projectId !== null) {
      const owner = data?.filters.options.projects.find((p) => p.id === projectId)?.customer_id;
      if (owner !== id) setProjectId(null);
    }
  };

  const meta = periodMeta(period);
  // "Next" is off once the period on screen is the one we are living in.
  const today = new Date().toISOString().slice(0, 10);
  const isCurrent = data ? data.period_start <= today && today <= data.period_end : month === thisMonthKey();
  const h = data?.headline;

  const customerRows = useMemo(() => data?.by_customer.rows ?? [], [data]);
  const projectRows = useMemo(() => data?.by_project.rows ?? [], [data]);
  const employeeRows = useMemo(() => data?.by_employee.rows ?? [], [data]);

  const marginState: StateTone = !data ? "none" : data.margin.gross_margin < 0 ? "bad" : (data.margin.gross_margin_pct ?? 0) < 20 ? "warn" : "ok";
  const toneOf = (s: StateTone): "success" | "warning" | "danger" | "neutral" =>
    s === "ok" ? "success" : s === "warn" ? "warning" : s === "bad" ? "danger" : "neutral";

  return (
    <div className="space-y-5">
      {/*
        Header + controls as ONE card — title, zoom, anchor month, actions and
        the scope filters in one place, so the eye has one spot for "what am I
        seeing". The month input is the ANCHOR at every zoom.
      */}
      <header className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Revenue control tower</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <h1 className="text-display truncate text-xl font-bold text-primary">
                {data?.label || monthLabelOf(month)}
              </h1>
              <span className="rounded-full border border-subtle bg-surface-2 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-secondary">
                {meta.label}
              </span>
              {data && (customerId !== null || projectId !== null) && (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-bold text-brand-700 dark:bg-brand-900 dark:text-brand-300">
                  <Filter className="h-3 w-3" aria-hidden /> Filtered
                </span>
              )}
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              Billed = invoice value before GST, by invoice date · Collected = customer receipts by payment date
              {data?.as_of && <> · as of {fmtDay(data.as_of)}</>}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <PeriodSwitcher value={period} onChange={setPeriod} />
            <DateStepper
              month={month}
              period={period}
              atCurrent={isCurrent}
              onShift={(d) => setMonth((m) => shiftMonthKey(m, d))}
              onPick={setMonth}
            />
            {/* `bg-subtle` is not a token (only border-/ring- are), so the rule is a border. */}
            <span className="mx-0.5 hidden h-6 border-l border-subtle sm:block" aria-hidden />
            <button type="button" className={ICON_BTN} onClick={() => setTick((t) => t + 1)} aria-label="Refresh" title="Refresh">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            </button>
            <button type="button" className={`${btnSecondary} h-9 min-h-0`} onClick={() => setTargetsOpen(true)} disabled={!data}>
              <Target size={15} aria-hidden /> Targets
            </button>
            <button type="button" className={`${btnPrimary} h-9 min-h-0`} onClick={() => void exportXlsx()} disabled={exporting || !data}>
              <Download size={15} aria-hidden /> {exporting ? "Exporting…" : "Excel pack"}
            </button>
          </div>
        </div>

        {data && (
          <div className="border-t border-subtle bg-surface-2 px-5 py-3">
            <FilterBar
              options={data.filters.options}
              customerId={customerId}
              projectId={projectId}
              onCustomer={pickCustomer}
              onProject={setProjectId}
            />
          </div>
        )}
      </header>

      {error ? (
        <ErrorBox error={error} onRetry={() => setTick((t) => t + 1)} />
      ) : !data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised"><SkeletonText lines={3} /></div>
          ))}
        </div>
      ) : (
        <div className={`space-y-5 transition-opacity duration-micro ${loading ? "opacity-60" : ""}`}>
          {/* Exceptions first */}
          <AlertsStrip alerts={data.alerts} periodLabel={data.label} />

          {/* The KPI strip. A tile links to the list that produced it; a derived figure stays a card. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
            <Tile
              label="Revenue billed"
              value={inrCompact(h!.billed)}
              to="invoices"
              sub={`${h!.invoices} invoice${h!.invoices === 1 ? "" : "s"} · ${inr(h!.billed_incl_gst)} incl. GST${
                h!.months_in_period > 1 ? ` · ${inr(h!.billed_per_month)}/month` : ""}`}
              foot={<><Delta value={h!.billed_mom_pct} label={h!.comparison_label} /><Delta value={h!.billed_yoy_pct} label="vs last year" /></>}
            />
            <Tile
              label="Cash collected"
              value={inrCompact(h!.collected)}
              to="invoices"
              tone="success"
              sub={h!.collection_rate_pct === null ? "no billing in this period" : `${pct(h!.collection_rate_pct)} of this period's billing`}
              foot={<Delta value={h!.collected_mom_pct} label={h!.comparison_label} />}
            />
            <Tile
              label="Outstanding"
              value={inrCompact(h!.outstanding)}
              to="invoices"
              tone="warning"
              sub={`${h!.open_invoices} open invoice${h!.open_invoices === 1 ? "" : "s"} up to the period end`}
            />
            <Tile
              label="Overdue"
              value={inrCompact(data.ageing.overdue_total)}
              to="invoices"
              tone={data.ageing.overdue_total > 0 ? "danger" : "success"}
              sub={data.ageing.overdue_90_plus > 0 ? `${inr(data.ageing.overdue_90_plus)} past 90 days` : "nothing past 90 days"}
            />
            <Tile
              label="Gross margin"
              value={pct(data.margin.gross_margin_pct, 0)}
              tone={toneOf(marginState)}
              sub={<>{inr(data.margin.gross_margin)} on {inr(data.margin.cost)} people cost</>}
            />
            <Tile
              label="Target attainment"
              value={data.targets.month_target === null ? "—" : pct(data.targets.month_attainment_pct, 0)}
              tone={toneOf(attainmentState(data.targets.month_attainment_pct))}
              sub={data.targets.month_target === null ? "no target set — use Targets" : `of ${inr(data.targets.month_target)} for ${data.short_label}`}
            />
            <Tile
              label="DSO"
              value={data.collections.dso_days === null ? "—" : `${data.collections.dso_days} d`}
              to="invoices"
              tone={toneOf(dsoState(data.collections.dso_days))}
              sub={data.collections.avg_days_to_pay === null ? "no receipts in this period" : `paid in ${data.collections.avg_days_to_pay} d on average`}
            />
            <Tile
              label="Deployed heads"
              value={data.efficiency.deployed_heads.toLocaleString("en-IN")}
              to="project-employees"
              tone="neutral"
              sub={<>{inr(data.efficiency.revenue_per_head)} revenue per head</>}
            />
          </div>

          {/* 1 · How the period unfolded — the first chart, as on the Dashboard. */}
          <Panel title={meta.trend} hint={`billed per ${meta.label.toLowerCase()} vs the cash collected in it — tick a series or a ${meta.label.toLowerCase()}`}>
            <FilteredBars rowFilter rowLabel={`${meta.label}s`} format={inrCompact}
                          data={data.series.map((p) => ({ label: p.label, billed: p.billed, collected: p.collected, invoices: p.invoices }))}
                          series={[{ key: "billed", label: "Billed (excl. GST)", color: 0 }, { key: "collected", label: "Collected", color: 1 },
                                   { key: "invoices", label: "Invoices", color: 7, defaultOff: true }]} />
          </Panel>

          {/* 2 · The three dials: period target · financial year · collections. */}
          <div className="grid gap-4 xl:grid-cols-3">
            <PeriodTargetCard data={data} meta={meta} />
            <FyTargetCard data={data} />
            <CollectionsCard data={data} />
          </div>

          {/* 3 · Where the money is — bar charts with their own ticks, two per row. */}
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel
              title="Revenue by customer"
              hint={`${data.by_customer.customers} customer${data.by_customer.customers === 1 ? "" : "s"} billed · top 3 = ${pct(data.by_customer.top3_share_pct, 0)}`}
              action={data.by_customer.concentration_risk && data.by_customer.top_customer ? (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP.warn}`} title="One account carries half or more of this period's billing">
                  {data.by_customer.top_customer} {pct(data.by_customer.top1_share_pct, 0)}
                </span>
              ) : undefined}
            >
              {customerRows.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted">No invoices raised in {data.label}.</div>
              ) : (
                <FilteredBars rowFilter rowLabel="Customers" format={inrCompact} height={220}
                              data={topRows(customerRows, "billed", (r) => r.customer, ["billed", "previous", "collected"])}
                              series={[{ key: "billed", label: "Billed", color: 0 }, { key: "previous", label: data.comparison_label, color: 7 },
                                       { key: "collected", label: "Collected", color: 1, defaultOff: true }]} />
              )}
            </Panel>

            <Panel
              title="Cash flow — next 3 months"
              hint={`as of ${fmtDay(data.cashflow.as_of)} · open invoices placed on the calendar by due date`}
              action={
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${data.cashflow.covers_cost ? STATE_CHIP.ok : STATE_CHIP.bad}`}>
                  {data.cashflow.covers_cost ? "Covers payroll" : "Falls short"}
                </span>
              }
            >
              {data.cashflow.heads_without_ctc > 0 && (
                <Warn>{data.cashflow.heads_without_ctc} deployed head(s) have no CTC on record — the people cost below is understated.</Warn>
              )}
              <FilteredBars rowFilter rowLabel="Months" format={inrCompact} height={220}
                            data={data.cashflow.months.map((m) => ({ label: m.label, at_pace: m.expected_at_pace, expected: m.expected, people_cost: m.people_cost, net: m.net_at_pace }))}
                            series={[{ key: "at_pace", label: "Expected in (our pace)", color: 2 }, { key: "expected", label: "On agreed terms", color: 1, defaultOff: true },
                                     { key: "people_cost", label: "People cost", color: 6 }, { key: "net", label: "Net", color: 0, defaultOff: true }]} />
              <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
                <MiniStat k="Expected in, at our pace" v={inrCompact(data.cashflow.expected_total_at_pace)} hint={`${inr(data.cashflow.expected_total)} if everyone paid on terms`} />
                <MiniStat k="People cost out" v={inrCompact(data.cashflow.people_cost_total)} hint={`${data.cashflow.heads_costed} deployed head(s)`} />
                <MiniStat k="Net position" v={inrCompact(data.cashflow.net_total_at_pace)} tone={data.cashflow.covers_cost ? "ok" : "bad"} />
                <MiniStat k="Paid late by" v={data.cashflow.slip_days === 0 ? "On terms" : `${data.cashflow.slip_days} d`} tone={data.cashflow.slip_days > 30 ? "warn" : undefined} hint="amount-weighted, last 12 months" />
              </div>
              {(data.cashflow.overdue.amount > 0 || data.cashflow.unbilled_ready.amount > 0) && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {data.cashflow.overdue.amount > 0 && (
                    <CrmLink to="invoices" className="rounded-control border border-subtle bg-surface-2 px-3 py-2 text-xs transition-colors duration-micro hover:border-danger">
                      <span className="font-bold text-danger">{inr(data.cashflow.overdue.amount)}</span>
                      <span className="text-secondary"> overdue across {data.cashflow.overdue.count} invoice(s) — chase first.</span>
                    </CrmLink>
                  )}
                  {data.cashflow.unbilled_ready.amount > 0 && (
                    <CrmLink to="timesheets" className="rounded-control border border-subtle bg-surface-2 px-3 py-2 text-xs transition-colors duration-micro hover:border-warning">
                      <span className="font-bold text-warning">{inr(data.cashflow.unbilled_ready.amount)}</span>
                      <span className="text-secondary"> approved but not invoiced ({data.cashflow.unbilled_ready.count} timesheet(s)) — raise it.</span>
                    </CrmLink>
                  )}
                </div>
              )}
              {data.cashflow.top_expected.length > 0 && (
                <p className="mt-3 text-xs text-secondary">
                  Biggest inflows: {data.cashflow.top_expected.slice(0, 3).map((r) => `${r.customer} ${inrCompact(r.amount)}${r.overdue_days > 0 ? ` (${r.overdue_days}d overdue)` : ""}`).join(" · ")}
                </p>
              )}
            </Panel>

            <Panel
              title="Receivables ageing"
              hint="open invoices by days past due (30-day terms when none set)"
              action={data.ageing.overdue_90_plus > 0 ? (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP.bad}`}>{inrCompact(data.ageing.overdue_90_plus)} past 90 d</span>
              ) : undefined}
            >
              {data.ageing.buckets.length === 0 ? (
                <p className="text-sm text-muted">Nothing outstanding.</p>
              ) : (
                <FilteredBars rowFilter rowLabel="Buckets" format={inrCompact} height={220}
                              data={data.ageing.buckets.map((b) => ({ label: b.label, amount: b.amount, invoices: b.count }))}
                              series={[{ key: "amount", label: "Outstanding", color: 5 }, { key: "invoices", label: "Invoices", color: 7, defaultOff: true }]} />
              )}
              {data.ageing.top_overdue_customers.length > 0 && (
                <p className="mt-3 text-xs text-secondary">
                  Owes most: {data.ageing.top_overdue_customers.slice(0, 3).map((c) => `${c.customer} ${inrCompact(c.overdue)}`).join(" · ")}
                  {" · "}<CrmLink to="invoices" className="font-semibold text-brand-600 hover:underline dark:text-brand-300">Open invoices →</CrmLink>
                </p>
              )}
            </Panel>

            <Panel title="Billing by dimension" hint={`${data.label} billing split by ${DIM_OPTIONS.find((d) => d.key === dim)?.label.toLowerCase()}`}
                   action={
                     <div className="inline-flex h-9 items-center rounded-control border border-subtle bg-surface-2 p-0.5" role="group" aria-label="Billing dimension">
                       {DIM_OPTIONS.map((o) => (
                         <button key={o.key} type="button" onClick={() => setDim(o.key)} aria-pressed={dim === o.key}
                                 className={`h-8 rounded-control px-3 text-xs font-semibold transition-all duration-micro ${dim === o.key ? "bg-surface-1 text-brand-600 shadow-raised dark:text-brand-300" : "text-secondary hover:text-primary"}`}>
                           {o.label}
                         </button>
                       ))}
                     </div>
                   }>
              {data.dimensions[dim].length === 0 ? (
                <p className="text-sm text-muted">No billing in this period.</p>
              ) : (
                <FilteredBars key={dim} rowFilter rowLabel="Rows" format={inrCompact} height={220}
                              data={data.dimensions[dim].map((r) => ({ label: r.label, billed: r.billed, share: r.share_pct ?? 0, invoices: r.invoices }))}
                              series={[{ key: "billed", label: "Billed", color: 0 }, { key: "share", label: "Share %", color: 3, defaultOff: true }, { key: "invoices", label: "Invoices", color: 7, defaultOff: true }]} />
              )}
            </Panel>
          </div>

          {/* 4 · Margin beside forecast — bars first, the tables under them. */}
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel
              title="Gross margin by customer"
              hint={`billed − people cost (annual CTC ÷ 12 × ${data.months_in_period} month${data.months_in_period === 1 ? "" : "s"} for everyone deployed)`}
              action={<span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP[marginState]}`}>{pct(data.margin.gross_margin_pct, 0)}</span>}
            >
              {data.margin.heads_without_ctc > 0 && (
                <Warn>{data.margin.heads_without_ctc} deployed assignment(s) have no CTC on the employee record — their cost is counted as zero.</Warn>
              )}
              <div className="mb-3 grid grid-cols-3 gap-2">
                <MiniStat k="People cost" v={inrCompact(data.margin.cost)} />
                <MiniStat k="Gross margin" v={inrCompact(data.margin.gross_margin)} tone={data.margin.gross_margin < 0 ? "bad" : undefined} />
                <MiniStat k="Margin %" v={pct(data.margin.gross_margin_pct)} tone={marginState === "none" ? undefined : marginState} />
              </div>
              {data.margin.by_customer.length === 0 ? (
                <div className="py-4 text-center text-sm text-muted">No billing or deployments in {data.label}.</div>
              ) : (
                <FilteredBars rowFilter rowLabel="Customers" format={inrCompact} height={220}
                              data={topRows(data.margin.by_customer, "billed", (r) => r.customer, ["billed", "cost", "margin", "heads"])}
                              series={[{ key: "billed", label: "Billed", color: 0 }, { key: "cost", label: "People cost", color: 6 },
                                       { key: "margin", label: "Margin", color: 2 }, { key: "heads", label: "Heads", color: 7, defaultOff: true }]} />
              )}
            </Panel>

            <Panel
              title={`Forecast · next ${data.forecast.months.length} months`}
              hint={`${inrCompact(data.forecast.total)} from the deployed team's billing rates`}
              action={data.forecast.po_shortfall > 0 ? (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP.bad}`}>{inrCompact(data.forecast.po_shortfall)} without PO</span>
              ) : (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP.ok}`}>PO covered</span>
              )}
            >
              {data.forecast.po_shortfall > 0 && (
                <Warn>{inr(data.forecast.po_shortfall)} of the forecast has no PO cover — renew or raise POs before billing.</Warn>
              )}
              <FilteredBars rowFilter rowLabel="Months" format={inrCompact} height={220}
                            data={data.forecast.months.map((m) => ({ label: m.label, amount: m.amount, heads: m.heads, roll_offs: m.roll_off_count }))}
                            series={[{ key: "amount", label: "Expected billing", color: 2 }, { key: "heads", label: "Heads", color: 7, defaultOff: true },
                                     { key: "roll_offs", label: "Roll-offs", color: 5, defaultOff: true }]} />
              <p className="mt-3 text-xs text-secondary">
                {data.forecast.months.map((m) => `${m.label}: ${m.heads} head(s)${m.roll_off_count ? `, ${m.roll_off_count} roll-off(s)` : ""}${m.po_covered ? "" : ", no PO cover"}`).join(" · ")}
              </p>
              <p className="mt-2 text-xs text-muted">{data.forecast.assumptions}</p>
            </Panel>
          </div>

          {/* 5 · People: who we placed at customers, redeployed vs newly hired. */}
          <PlacementsPanel month={month} period={period} customerId={customerId} projectId={projectId} />

          {/* 6 · Delivery view: which projects and which people made the money — bars, then the full table. */}
          <Panel
            title="Revenue by project"
            hint={`${data.by_project.projects} project${data.by_project.projects === 1 ? "" : "s"} billed in ${data.label} · tick a project to compare`}
            action={data.by_project.loss_making.length > 0 ? (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP.bad}`}>{data.by_project.loss_making.length} loss-making</span>
            ) : undefined}
          >
            {data.by_project.heads_without_ctc > 0 && (
              <Warn>{data.by_project.heads_without_ctc} deployed assignment(s) have no CTC on the employee record — their cost shows as zero, so the margin below is optimistic.</Warn>
            )}
            {projectRows.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted">No project billing in {data.label}.</div>
            ) : (
              <>
                <FilteredBars rowFilter rowLabel="Projects" format={inrCompact}
                              data={topRows(projectRows, "billed", (r) => r.customer ? `${r.project} · ${r.customer}` : r.project, ["billed", "previous", "cost", "margin", "heads"])}
                              series={[{ key: "billed", label: "Billed", color: 0 }, { key: "previous", label: data.comparison_label, color: 7, defaultOff: true },
                                       { key: "cost", label: "People cost", color: 6 }, { key: "margin", label: "Margin", color: 2 },
                                       { key: "heads", label: "Heads", color: 3, defaultOff: true }]} />
                <div className={`${tableWrapTall} mt-4`}>
                  <table className="w-full">
                    <thead><tr className={trCls}>
                      <th className={thCls}>Project</th>
                      <th className={thCls}>Customer</th>
                      <th className={`${thCls} text-right`}>Billed</th>
                      <th className={`${thCls} text-right`}>Share</th>
                      <th className={`${thCls} text-right`} title={data.comparison_label}>Change</th>
                      <th className={`${thCls} text-right`}>Heads</th>
                      <th className={`${thCls} text-right`}>People cost</th>
                      <th className={`${thCls} text-right`}>Margin</th>
                      <th className={`${thCls} text-right`}>%</th>
                    </tr></thead>
                    <tbody>
                      {projectRows.map((r) => (
                        <tr key={r.project_id} className={trCls}>
                          <td className={`${tdCls} font-semibold text-primary`}>
                            <CrmLink to={`projects/${r.project_id}`} className="hover:underline">{r.project}</CrmLink>
                          </td>
                          <td className={tdCls}>
                            {r.customer_id
                              ? <CrmLink to={`customers/${r.customer_id}`} className="hover:underline">{r.customer}</CrmLink>
                              : (r.customer || "—")}
                          </td>
                          <td className={tdNum}>{inr(r.billed)}</td>
                          <td className={tdNum}><ShareCell value={r.share_pct} width="w-12" /></td>
                          <td className={tdNum} title={`${inr(r.previous)} ${data.comparison_label}`}><Delta value={r.change_pct} label="" /></td>
                          <td className={tdNum}>{r.heads}</td>
                          <td className={tdNum}>{inr(r.cost)}</td>
                          <td className={`${tdNum} ${r.margin < 0 ? "font-semibold text-danger" : ""}`}>{inr(r.margin)}</td>
                          <td className={`${tdNum} ${r.margin < 0 ? "font-semibold text-danger" : ""}`}>{pct(r.margin_pct, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Panel>

          <Panel
            title="Revenue by employee"
            hint={data.by_employee.coverage_pct === null
              ? "per-head revenue comes from timesheet-driven invoices"
              : `${pct(data.by_employee.coverage_pct, 0)} of billing is traceable to a person · ${data.by_employee.billing_heads} head(s) billing · tick a person to compare`}
            action={data.by_employee.idle_count > 0 ? (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP.warn}`}>{data.by_employee.idle_count} on the bench</span>
            ) : undefined}
          >
            {data.by_employee.unlinked_billed > 0 && (
              <Warn>
                {inr(data.by_employee.unlinked_billed)} across {data.by_employee.unlinked_invoices} invoice(s) was raised without a timesheet,
                so it cannot be attributed to a person and is NOT in the chart or table below.
              </Warn>
            )}
            <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              <MiniStat k="Traceable to a person" v={inrCompact(data.by_employee.linked_billed)} />
              <MiniStat k="Avg per billing head" v={inrCompact(data.by_employee.avg_revenue_per_head)} />
              <MiniStat k="Deployed, nothing billed" v={data.by_employee.idle_count} tone={data.by_employee.idle_count > 0 ? "warn" : undefined} />
              <MiniStat k="Cost of those heads" v={inrCompact(data.by_employee.idle_cost)} tone={data.by_employee.idle_cost > 0 ? "bad" : undefined} />
            </div>
            {employeeRows.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted">No deployments or timesheet-driven invoices in {data.label}.</div>
            ) : (
              <>
                <FilteredBars rowFilter rowLabel="Employees" format={inrCompact}
                              data={topRows(employeeRows, "billed", (r) => r.employee, ["billed", "cost", "margin", "billed_per_month"])}
                              series={[{ key: "billed", label: "Billed", color: 0 }, { key: "cost", label: "People cost", color: 6 },
                                       { key: "margin", label: "Margin", color: 2 },
                                       ...(data.months_in_period > 1 ? [{ key: "billed_per_month", label: "Per month", color: 3, defaultOff: true }] : [])]} />
                <div className={`${tableWrapTallMid} mt-4`}>
                  <table className="w-full">
                    <thead><tr className={trCls}>
                      <th className={thCls}>Employee</th>
                      <th className={thCls}>Emp ID</th>
                      <th className={thCls}>Customer · Project</th>
                      <th className={`${thCls} text-right`}>Billed</th>
                      {data.months_in_period > 1 && <th className={`${thCls} text-right`}>Per month</th>}
                      <th className={`${thCls} text-right`}>Invoices</th>
                      <th className={`${thCls} text-right`}>People cost</th>
                      <th className={`${thCls} text-right`}>Margin</th>
                      <th className={`${thCls} text-right`}>%</th>
                    </tr></thead>
                    <tbody>
                      {employeeRows.map((r) => (
                        <tr key={r.employee_id} className={trCls}>
                          <td className={`${tdCls} font-semibold text-primary`}>
                            <CrmLink to={`employees/${r.employee_id}`} className="hover:underline">{r.employee}</CrmLink>
                            {r.deployed && r.billed <= 0 && (
                              <span className="ml-2 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-bold uppercase text-warning">No billing</span>
                            )}
                          </td>
                          <td className={tdCls}>{r.employee_code || "—"}</td>
                          <td className={tdCls}>
                            <span className="block truncate" title={`${r.customer || "—"} · ${r.project || "—"}`}>
                              {r.customer || "—"}<span className="text-muted"> · {r.project || "—"}</span>
                            </span>
                          </td>
                          <td className={tdNum}>{inr(r.billed)}</td>
                          {data.months_in_period > 1 && <td className={tdNum}>{inr(r.billed_per_month)}</td>}
                          <td className={tdNum}>{r.invoices}</td>
                          <td className={tdNum}>{inr(r.cost)}</td>
                          <td className={`${tdNum} ${r.margin < 0 ? "font-semibold text-danger" : ""}`}>{inr(r.margin)}</td>
                          <td className={`${tdNum} ${r.margin < 0 ? "font-semibold text-danger" : ""}`}>{pct(r.margin_pct, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <p className="mt-3 text-xs text-muted">
              Revenue is attributed through the invoice&rsquo;s timesheet; cost is the employee&rsquo;s annual CTC ÷ 12,
              prorated across every active assignment overlapping {data.label}.
            </p>
          </Panel>

          {/* 7 · Runway · efficiency · leakage. */}
          <div className="grid gap-4 md:grid-cols-3">
            <Panel
              title="Coming up"
              hint="Billing already earned, and how long the POs last"
              action={data.pipeline.po_cover_months !== null ? (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${data.pipeline.po_cover_months < 2 ? STATE_CHIP.bad : STATE_CHIP.ok}`}>
                  PO cover {data.pipeline.po_cover_months} mo
                </span>
              ) : undefined}
            >
              <dl className="space-y-3">
                <Stat k="Approved, not yet invoiced" v={inr(data.pipeline.approved_uninvoiced.amount)}
                  sub={`${data.pipeline.approved_uninvoiced.count} timesheet${data.pipeline.approved_uninvoiced.count === 1 ? "" : "s"}`} />
                <Stat k="Active PO balance" v={inr(data.pipeline.active_po_balance)} />
                <Stat k="Avg billed · last 3 months" v={inr(data.pipeline.avg_monthly_billed)} />
                <Stat k="PO cover at that pace" v={data.pipeline.po_cover_months === null ? "—" : `${data.pipeline.po_cover_months} months`}
                  tone={data.pipeline.po_cover_months !== null && data.pipeline.po_cover_months < 2 ? "danger" : undefined} />
              </dl>
              {data.pipeline.approved_uninvoiced.count > 0 && (
                <CrmLink to="timesheets" className="mt-3 inline-block text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
                  Raise those invoices →
                </CrmLink>
              )}
            </Panel>

            <Panel title="Efficiency" hint={`Billing per deployed head · ${data.label}`}>
              <dl className="space-y-3">
                <Stat k="Deployed headcount" v={data.efficiency.deployed_heads} />
                <Stat k="Revenue per head" v={inr(data.efficiency.revenue_per_head)} />
                {data.months_in_period > 1 && <Stat k="Per head, per month" v={inr(data.efficiency.revenue_per_head_per_month)} />}
                <Stat k="GST on billing" v={inr(h!.gst)} />
              </dl>
            </Panel>

            <Panel
              title="Leakage"
              hint={`${data.leakage.approved_sheets} approved timesheet${data.leakage.approved_sheets === 1 ? "" : "s"} for ${data.label}`}
              action={data.leakage.lop_days - data.leakage.lop_covered_by_weekend_work_days > 0 ? (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP.warn}`}>
                  {(data.leakage.lop_days - data.leakage.lop_covered_by_weekend_work_days).toFixed(1)} LOP days unbilled
                </span>
              ) : undefined}
            >
              <dl className="space-y-3">
                <Stat k="Loss-of-pay days" v={data.leakage.lop_days} />
                <Stat k="Covered by weekend work" v={data.leakage.lop_covered_by_weekend_work_days} />
                <Stat k="No-billing period days" v={data.leakage.no_billing_period_days} />
              </dl>
            </Panel>
          </div>
        </div>
      )}
      {targetsOpen && data && (
        <RevenueTargetsModal
          month={month}
          targets={data.targets}
          onClose={() => setTargetsOpen(false)}
          onSaved={(msg) => { setTargetsOpen(false); showToast(msg); setTick((t) => t + 1); }}
        />
      )}
      {toast}
    </div>
  );
}
