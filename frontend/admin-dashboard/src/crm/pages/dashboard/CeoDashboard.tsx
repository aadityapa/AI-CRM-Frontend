/**
 * CEO dashboard (28 Sep 2026) — four tabs at the top of the Dashboard for
 * Admin / CEO, over `GET /api/dashboard/ceo?tab=&month=&period=`:
 *
 *   Finance  · billed · collected · owed · margin · target · cash flow
 *   Customer · customer → project → employee revenue drill-down
 *   Sales    · positions brought in, filled (internal vs external), open, pace
 *   People   · headcount, deployed vs bench, joiners / exits, roll-offs
 *
 * Every number is computed on the server (B-V2 `services/executive_dashboard.py`,
 * itself composed from the Revenue report, the placements report and the hiring
 * control tower — one rule per figure). This file only lays it out: a header
 * card (title · tab strip · zoom · FY stepper · refresh), then EVERY tab in the
 * same reading order: alert chips → 8 KPI tiles → "How the year unfolded"
 * (month by month, the first chart) → three coloured speedometers → four BAR
 * charts with tick filters (`FilteredBars`) → one table / the names. Every
 * tile links to the page that explains its number, with the SAME period in
 * the URL (`revenueLink`). The default zoom is the FINANCIAL YEAR because that
 * is how the CEO asked to read it; month / quarter come for free.
 *
 * Reuses the control-tower atoms (`Tile`, `Panel`, `Speedometer`, `Delta`, the
 * period controls) and the hiring tower's `PaceCard`, so the Sales tab and the
 * hiring tower can never disagree.
 * Controls use `CONTROL` (`inputCls` ends in `w-full`); no alpha modifier on a
 * `var()` token. The chosen tab is remembered per browser
 * (`localStorage["crm.ceo.tab"]`) — a convenience, never state.
 */
import React, { useMemo, useState } from "react";
import {
  AlertTriangle, Briefcase, Building2, ChevronDown, ChevronRight, RefreshCw, Target, Users, Wallet,
} from "lucide-react";
import { crmGet, qs } from "../../api";
import { CrmLink } from "../../routerHooks";
import { ErrorBox, SkeletonText, btnSecondary, useToast } from "../../components/ui";
import { RevenueTargetsModal } from "../../components/RevenueTargetsModal";
import type { TargetsForModal } from "../../components/RevenueTargetsModal";
import {
  CONTROL, DateStepper, Delta, FilteredBars, ICON_BTN, MiniStat, Panel, PeriodSwitcher, STATE_CHIP,
  Speedometer, Tile, inr, inrCompact, num, pct, shiftMonthKey, thisMonthKey,
} from "../../components/controlTower";
import type { PeriodKind, StateTone } from "../../components/controlTower";
import type { RevenueReportData } from "../reports/RevenueReport";
import { PaceCard } from "./HiringControlTower";
import type { HiringData } from "./HiringControlTower";
import { useDeskData } from "./DeskWidgets";

/* ---------- payload (services/executive_dashboard.py) ---------- */

export type CeoTab = "finance" | "customer" | "sales" | "people";

export type CeoPeriod = {
  kind: PeriodKind; key: string; label: string; short_label: string; fy_label: string;
  anchor_month: string; start: string; end: string; months: number; is_current: boolean;
  comparison_label: string; previous_key: string;
};

type MonthRow = { key: string; label: string; future: boolean };

export type FinanceData = {
  headline: RevenueReportData["headline"];
  targets: RevenueReportData["targets"];
  margin: Omit<RevenueReportData["margin"], "by_customer">;
  collections: RevenueReportData["collections"];
  ageing: RevenueReportData["ageing"];
  cashflow: RevenueReportData["cashflow"];
  pipeline: RevenueReportData["pipeline"];
  efficiency: RevenueReportData["efficiency"];
  alerts: RevenueReportData["alerts"];
  series: RevenueReportData["series"];
  monthly: (MonthRow & { billed: number; collected: number; cost: number; margin: number })[];
  by_type: { label: string; billed: number; invoices: number; share_pct: number | null }[];
  top_customers: { customer_id: number; customer: string; billed: number; share_pct: number | null }[];
  concentration: { top1_share_pct: number | null; top3_share_pct: number | null; risk: boolean; top_customer: string | null };
};

type Kind = "internal" | "external" | "unknown";

export type EmployeeRow = {
  pe_id: number; employee_id: number; employee: string; employee_code: string | null;
  rate: number; unit: string; monthly_rate: number; billed: number; invoices: number;
  cost: number; margin: number; has_ctc: boolean; onboarding: string | null; exit: string | null;
  exited: boolean; deployed_today: boolean; kind: Kind; kind_reason: string;
};
export type ProjectRow = {
  project_id: number; project: string; status: string | null; end_date: string | null;
  opportunity: string | null; opp_id: string | null; billed: number; previous: number;
  change_pct: number | null; share_pct: number | null; invoices: number; collected: number;
  outstanding: number; unlinked_billed: number; cost: number; margin: number; margin_pct: number | null;
  heads: number; heads_today: number; internal: number; external: number; employees: EmployeeRow[];
};
export type CustomerRowT = {
  customer_id: number; customer: string; billed: number; previous: number; change_pct: number | null;
  share_pct: number | null; invoices: number; collected: number; outstanding: number; overdue: number;
  cost: number; margin: number; margin_pct: number | null; heads: number; heads_today: number;
  internal: number; external: number; projects_count: number; po_balance: number;
  monthly_burn: number; po_cover_months: number | null;
  open_positions: number; total_positions: number; joined_positions: number; projects: ProjectRow[];
};
type Alert = RevenueReportData["alerts"][number];
export type CustomerData = {
  summary: {
    customers: number; customers_billing: number; billed: number; previous: number; change_pct: number | null;
    collected: number; outstanding: number; overdue: number; heads: number; heads_today: number;
    top1_share_pct: number | null; top3_share_pct: number | null; concentration_risk: boolean;
    top_customer: string | null;
  };
  donut: { label: string; value: number; customer_id: number | null }[];
  /** Month by month inside the period; `customers` = billed by top customer (+ Others). */
  monthly: (MonthRow & { billed: number; collected: number; cost: number; customers: Record<string, number> })[];
  monthly_series: string[];
  /** Heads deployed at the END of each bucket, by customer and by customer location, at three zooms. */
  deployed_trend: Record<PeriodKind, (MonthRow & { total: number; customers: Record<string, number>; locations: Record<string, number> })[]>;
  deployed_series: { customers: string[]; locations: string[] };
  alerts: Alert[];
  customers: CustomerRowT[];
};

export type PositionRow = {
  requirement_id: number; opportunity_id: number; opp_id: string | null; title: string;
  customer_id: number; customer: string; owner: string | null; opp_type: string | null;
  rfi_value: number | null; status: string; opp_stage: string; live: boolean; workable: boolean;
  positions: number; joined: number; open: number; fill_pct: number | null; created_on: string;
  closed_on: string | null; age_days: number; created_in_period: boolean; joined_in_period: number;
  internal: number; external: number; unknown: number;
  candidates: { profile_id: number; name: string; joined_on: string; kind: Kind; reason: string; in_period: boolean }[];
  candidates_more: number;
};
export type SalesData = Pick<HiringData, "kpis" | "pace" | "targets" | "series" | "funnel" | "customers" | "stage_delays"> & {
  onboarding_mix: { internal: number; external: number; unknown: number; total: number; internal_pct: number | null };
  onboarding_trend: Record<PeriodKind, (MonthRow & { onboardings: number; positions_in: number; internal: number; external: number; unknown: number })[]>;
  monthly: (MonthRow & { positions_in: number; onboardings: number; internal: number; external: number; unknown: number })[];
  positions: PositionRow[];
  positions_summary: { shown: number; live: number; open: number; total: number; joined: number; stale_30: number };
  by_owner: { owner: string; positions: number; open: number; joined: number; opportunities: number }[];
  by_customer: { customer_id: number; customer: string; positions: number; open: number; joined: number; internal: number; external: number; opportunities: number; stale: number }[];
  alerts: Alert[];
  rules: { internal: string; external: string; unknown: string };
};

type PersonRow = {
  employee_id: number; employee: string; employee_code: string | null; role: string | null;
  doj: string | null; cost_month: number | null; has_ctc: boolean; exit_on: string | null;
  projects: { project_id: number; project: string; customer: string | null }[];
};
export type PeopleData = {
  headline: {
    headcount: number; deployed: number; bench: number; utilisation_pct: number | null;
    bench_cost_month: number; people_cost_month: number; bench_cost_pct: number | null;
    heads_without_ctc: number; joiners: number; exits: number;
    net_change: number; opening_headcount: number; attrition_pct: number | null; on_notice: number;
    avg_tenure_years: number | null; billed: number; revenue_per_deployed_head: number | null;
    rolloffs_90d: number;
  };
  monthly: (MonthRow & {
    joiners: number; exits: number; headcount: number | null; deployed: number | null; bench: number | null;
    cost: number | null; bench_cost: number | null;
  })[];
  by_role: { role: string; deployed: number; bench: number; on_notice: number; cost: number }[];
  tenure: { label: string; deployed: number; bench: number }[];
  rolloffs_by_month: { key: string; label: string; heads: number; monthly_rate: number }[];
  alerts: Alert[];
  bench: PersonRow[]; on_notice: PersonRow[]; joiners: PersonRow[]; exits: PersonRow[];
  rolloffs: {
    project_employee_id: number; employee_id: number; employee_name: string; role_title: string | null;
    project_id: number; project_name: string; customer_name: string | null; po_end_date: string | null;
    ends_by: string; days_left: number | null;
  }[];
  /** Internal vs external placements in the period (B-V2 `_people_placements`, no money). */
  placements?: PlacementsData | null;
};

export type PlacementsData = {
  window: { label: string; bucket: string };
  headline: {
    placements: number; unique_people: number; internal: number; external: number; unknown: number;
    internal_pct: number | null; external_pct: number | null; undated: number;
    previous: { placements: number; internal: number; external: number; unknown: number };
  };
  series: { key: string; label: string; internal: number; external: number; unknown: number; internal_pct: number | null }[];
  by_customer: { customer_id: number | null; customer: string; internal: number; external: number; unknown: number; total: number }[];
  rows: { pe_id: number; employee_id: number; employee: string; employee_code: string | null; customer: string | null;
          project: string | null; placed_on: string; karnex_joined: string | null; kind: Kind; reason: string }[];
  rows_truncated: boolean;
  rules: { internal: string; external: string; unknown: string };
};

export type CeoPayload<T> = { as_of: string; tab: CeoTab; period: CeoPeriod; data: T };

/* ---------- tabs ---------- */

const TABS: { key: CeoTab; label: string; blurb: string; icon: React.ComponentType<{ className?: string }>; accent: string }[] = [
  { key: "finance", label: "Finance", blurb: "Billed · collected · margin · cash", icon: Wallet, accent: "from-emerald-500 to-teal-600" },
  { key: "customer", label: "Customer", blurb: "Revenue by customer → project → person", icon: Building2, accent: "from-sky-500 to-blue-600" },
  { key: "sales", label: "Sales", blurb: "Positions, fills, internal vs external, pace", icon: Briefcase, accent: "from-violet-500 to-fuchsia-600" },
  { key: "people", label: "People", blurb: "Headcount, bench, joiners, exits", icon: Users, accent: "from-amber-500 to-orange-600" },
];

const TAB_STORAGE_KEY = "crm.ceo.tab";

function readStoredTab(): CeoTab {
  try {
    const v = localStorage.getItem(TAB_STORAGE_KEY);
    if (v && TABS.some((t) => t.key === v)) return v as CeoTab;
  } catch { /* private mode — default */ }
  return "finance";
}

/* ---------- small helpers ---------- */

const fmtDay = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

const attainmentState = (p: number | null | undefined): StateTone =>
  p === null || p === undefined ? "none" : p >= 100 ? "ok" : p >= 80 ? "warn" : "bad";
const highGood = (v: number | null | undefined, ok: number, warn: number): StateTone =>
  v === null || v === undefined ? "none" : v >= ok ? "ok" : v >= warn ? "warn" : "bad";
const lowGood = (v: number | null | undefined, ok: number, warn: number): StateTone =>
  v === null || v === undefined ? "none" : v <= ok ? "ok" : v <= warn ? "warn" : "bad";

/** Reports ▸ Revenue at the same anchor + zoom — the page behind every money tile. */
const revenueLink = (p: CeoPeriod) => `reports?tab=revenue&month=${p.anchor_month}&period=${p.kind}`;

const KIND_CHIP: Record<Kind, string> = {
  internal: "bg-success-soft text-success",
  external: "bg-info-soft text-info",
  unknown: "bg-surface-2 text-muted",
};
const KIND_LABEL: Record<Kind, string> = { internal: "Internal", external: "External", unknown: "Unknown" };

function KindChip({ kind, title }: { kind: Kind; title?: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${KIND_CHIP[kind]}`} title={title}>
      {KIND_LABEL[kind]}
    </span>
  );
}

function ShareBar({ value }: { value: number | null | undefined }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${v}%` }} />
      </div>
      <span className="text-xs tabular-nums text-secondary">{pct(value, 0)}</span>
    </div>
  );
}

const thCls = "px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-muted whitespace-nowrap";
const tdCls = "px-3 py-2 text-sm text-primary tabular-nums whitespace-nowrap";
const tableWrap = "-mx-5 -mb-5 overflow-x-auto";

/* ---------- alerts ---------- */

/** The "needs attention" chip strip every tab opens with. `to` is the page that
 *  explains the alerts (Reports ▸ Revenue for money; the list page otherwise). */
function Alerts({ alerts, to, where }: { alerts: Alert[]; to: string; where: string }) {
  const live = alerts.filter((a) => a.level === "bad" || a.level === "warn");
  if (!live.length) return null;
  return (
    <div className="flex flex-wrap gap-2" aria-label="Needs attention">
      {live.slice(0, 6).map((a) => (
        <CrmLink key={a.key} to={to} title={`${a.detail} — open ${where}`}
                 className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold hover:underline ${STATE_CHIP[a.level === "bad" ? "bad" : "warn"]}`}>
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {a.title}
        </CrmLink>
      ))}
      {live.length > 6 && <span className="text-xs text-muted">+{live.length - 6} more on {where}</span>}
    </div>
  );
}

/** The state chip a panel header carries (target attainment, collection rate …). */
function StateChip({ state, children }: { state: StateTone; children: React.ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP[state]}`}>{children}</span>;
}

/** One segmented control for every "zoom" / "scope" toggle on the page. */
function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="inline-flex h-9 items-center rounded-control border border-subtle bg-surface-2 p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" onClick={() => onChange(o.key)} aria-pressed={value === o.key}
                className={`h-8 rounded-control px-3 text-xs font-semibold transition-all duration-micro ${value === o.key ? "bg-surface-1 text-brand-600 shadow-raised dark:text-brand-300" : "text-secondary hover:text-primary"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const ZOOM_LABEL: Record<PeriodKind, string> = { month: "Monthly", quarter: "Quarterly", fy: "Yearly" };
const ZOOM_OPTIONS = (["month", "quarter", "fy"] as PeriodKind[]).map((z) => ({ key: z, label: ZOOM_LABEL[z] }));
const ZOOM_ROWS: Record<PeriodKind, string> = { month: "Months", quarter: "Quarters", fy: "Years" };

/* ====================================================================== Finance */

function FinanceTab({ d, period }: { d: FinanceData; period: CeoPeriod }) {
  const rev = revenueLink(period);
  const h = d.headline, t = d.targets, m = d.margin, c = d.collections;
  const collectionState = highGood(h.collection_rate_pct, 90, 75);
  const marginState = highGood(m.gross_margin_pct, 30, 15);
  // At the FY zoom the target is the FY target; `month_*` is the SELECTED period's
  // figure at month / quarter zoom (the report's naming, kept as-is).
  const isFy = period.kind === "fy";
  const target = isFy ? t.fy_target : t.month_target;
  const attainment = isFy ? t.fy_attainment_pct : t.month_attainment_pct;
  const gap = target === null ? null : Math.max(0, target - h.billed);
  const targetMax = Math.max(h.billed, target ?? 0, 1) * 1.1;
  const cash = d.cashflow;
  const monthly = d.monthly.filter((r) => !r.future);

  return (
    <div className="space-y-4">
      <Alerts alerts={d.alerts} to={rev} where="Reports ▸ Revenue" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Tile label="Billed (excl. GST)" value={inrCompact(h.billed)} to={rev} sub={`${num(h.invoices)} invoices`}
              foot={<><Delta value={h.billed_mom_pct} label={period.comparison_label} /><Delta value={h.billed_yoy_pct} label="YoY" /></>} />
        <Tile label="Collected" value={inrCompact(h.collected)} tone="success" to={rev} sub={`${pct(h.collection_rate_pct, 0)} of billed`}
              foot={<Delta value={h.collected_mom_pct} label={period.comparison_label} />} />
        <Tile label="Outstanding" value={inrCompact(h.outstanding)} tone={h.outstanding > 0 ? "warning" : "neutral"} to={rev} sub={`${num(h.open_invoices)} open invoices`} />
        <Tile label="Overdue" value={inrCompact(d.ageing.overdue_total)} tone={d.ageing.overdue_total > 0 ? "danger" : "success"} to={rev}
              sub={d.ageing.overdue_90_plus > 0 ? `${inrCompact(d.ageing.overdue_90_plus)} past 90 days` : "nothing past 90 days"} />
        <Tile label="Gross margin" value={pct(m.gross_margin_pct, 0)} tone={marginState === "ok" ? "success" : marginState === "warn" ? "warning" : "danger"} to={rev}
              sub={`${inrCompact(m.gross_margin)} on ${inrCompact(m.cost)} people cost`} />
        <Tile label={`${isFy ? "FY" : "Period"} target`} value={target === null ? "—" : pct(attainment, 0)}
              tone={attainmentState(attainment) === "ok" ? "success" : attainmentState(attainment) === "warn" ? "warning" : "neutral"}
              to={rev} sub={target === null ? "no target set — Reports ▸ Revenue ▸ Targets" : `of ${inrCompact(target)}`} />
        <Tile label="DSO" value={c.dso_days === null ? "—" : `${num(c.dso_days)} d`} tone={lowGood(c.dso_days, 45, 60) === "ok" ? "success" : lowGood(c.dso_days, 45, 60) === "warn" ? "warning" : "danger"} to={rev}
              sub={c.avg_days_to_pay === null ? "no receipts in the period" : `paid ${num(c.avg_days_to_pay)} days after due on average`} />
        <Tile label="PO cover" value={d.pipeline.po_cover_months === null ? "—" : `${d.pipeline.po_cover_months} mo`} to="pos"
              tone={lowGood(d.pipeline.po_cover_months === null ? null : -d.pipeline.po_cover_months, -2, -1) === "ok" ? "success" : "warning"}
              sub={`${inrCompact(d.pipeline.active_po_balance)} active PO balance`} />
      </div>

      {/* 1 · How the year unfolded — the CEO's first question, so the first chart. */}
      <Panel title={`How ${period.kind === "fy" ? "the year" : "the period"} unfolded`} hint="billed · collected · people cost · margin, month by month — tick what to compare">
        <FilteredBars data={monthly} rowFilter rowLabel="Months" format={inrCompact}
                      series={[{ key: "billed", label: "Billed", color: 0 }, { key: "collected", label: "Collected", color: 1 },
                               { key: "cost", label: "People cost", color: 6 }, { key: "margin", label: "Margin", color: 2, defaultOff: true }]} />
      </Panel>

      {/* 2 · Where we stand against target, collections and margin — the dials, right under the trend. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={`${period.kind === "fy" ? period.fy_label : period.label} target`} hint="needle = billed so far · flag = target"
               action={<StateChip state={attainmentState(attainment)}>{pct(attainment, 0)}</StateChip>}>
          <Speedometer value={h.billed} max={targetMax} marker={target} markerLabel="target" state={attainmentState(attainment)}
                       label="Revenue target" caption="billed" format={inrCompact} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat k="Gap" v={gap === null ? "—" : inrCompact(gap)} />
            <MiniStat k={t.is_current_month ? "Run rate" : "Per month"} v={inrCompact(t.is_current_month ? t.run_rate : h.billed_per_month)} hint="billed ÷ days elapsed × days in period" />
            {isFy
              ? <MiniStat k="Projection" v={inrCompact(t.fy_projection)} tone={attainmentState(t.fy_projection_pct)} hint="billed to date + trailing-3-month average × months left" />
              : <MiniStat k="FY projection" v={inrCompact(t.fy_projection)} tone={attainmentState(t.fy_projection_pct)} />}
            {isFy
              ? <MiniStat k="Needed / month" v={inrCompact(t.fy_required_monthly)} />
              : <MiniStat k="FY attainment" v={pct(t.fy_attainment_pct, 0)} />}
          </div>
        </Panel>
        <Panel title="Collection rate" hint="collected ÷ billed in the period" action={<StateChip state={collectionState}>{pct(h.collection_rate_pct, 0)}</StateChip>}>
          <Speedometer value={h.collection_rate_pct ?? 0} max={100} marker={90} markerLabel="goal" state={collectionState}
                       label="Collection rate" caption="collected" format={(v) => `${Math.round(v)}%`} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat k="Collected" v={inrCompact(h.collected)} tone="ok" />
            <MiniStat k="Still owed" v={inrCompact(h.outstanding)} tone={h.outstanding > 0 ? "warn" : "ok"} />
          </div>
        </Panel>
        <Panel title="Gross margin" hint="billed − people cost (CTC ÷ 12 × months deployed)" action={<StateChip state={marginState}>{pct(m.gross_margin_pct, 0)}</StateChip>}>
          <Speedometer value={m.gross_margin_pct ?? 0} max={60} marker={30} markerLabel="goal" state={marginState}
                       label="Gross margin" caption="margin" format={(v) => `${Math.round(v)}%`} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat k="People cost" v={inrCompact(m.cost)} />
            <MiniStat k="Deployed heads" v={num(d.efficiency.deployed_heads)} hint={m.heads_without_ctc ? `${m.heads_without_ctc} without a CTC — cost understated` : undefined} tone={m.heads_without_ctc ? "warn" : undefined} />
          </div>
        </Panel>
      </div>

      {/* 3 · Where the money is — four bar charts, each with its own ticks. */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Who we bill" hint={d.concentration.risk ? `${d.concentration.top_customer} is ${pct(d.concentration.top1_share_pct, 0)} of billing — concentration risk` : `top 3 = ${pct(d.concentration.top3_share_pct, 0)} of billing`}
               action={d.concentration.risk ? <StateChip state="warn">Concentrated</StateChip> : undefined}>
          {d.top_customers.length ? (
            <FilteredBars rowFilter rowLabel="Customers" format={inrCompact} height={220}
                          data={d.top_customers.map((r) => ({ label: r.customer, billed: r.billed, share: r.share_pct ?? 0 }))}
                          series={[{ key: "billed", label: "Billed", color: 0 }, { key: "share", label: "Share %", color: 3, defaultOff: true }]} />
          ) : <p className="text-sm text-muted">No billing in this period.</p>}
        </Panel>

        <Panel title="Cash flow — next 3 months" hint={`as of ${fmtDay(cash.as_of)} · what lands each month vs the people cost that month`}
               action={<StateChip state={cash.covers_cost ? "ok" : "bad"}>{cash.covers_cost ? "Covers cost" : "Short"}</StateChip>}>
          <FilteredBars rowFilter rowLabel="Months" format={inrCompact} height={200}
                        data={cash.months.map((r) => ({ label: r.label, expected: r.expected, at_pace: r.expected_at_pace, people_cost: r.people_cost, net: r.net_at_pace }))}
                        series={[{ key: "at_pace", label: "Expected in (our pace)", color: 2 }, { key: "expected", label: "On agreed terms", color: 1, defaultOff: true },
                                 { key: "people_cost", label: "People cost", color: 6 }, { key: "net", label: "Net", color: 0, defaultOff: true }]} />
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <MiniStat k="Expected in" v={inrCompact(cash.expected_total_at_pace)} tone="ok" hint={`${inrCompact(cash.expected_total)} on agreed terms`} />
            <MiniStat k="People cost out" v={inrCompact(cash.people_cost_total)} />
            <MiniStat k="Net" v={inrCompact(cash.net_total_at_pace)} tone={cash.net_total_at_pace >= 0 ? "ok" : "bad"} />
            <MiniStat k="Overdue to chase" v={inrCompact(cash.overdue.amount)} tone={cash.overdue.amount > 0 ? "warn" : "ok"} hint={`${cash.overdue.count} invoice(s)`} />
          </div>
          {cash.unbilled_ready.amount > 0 && (
            <p className="mt-3 text-xs text-secondary">{inrCompact(cash.unbilled_ready.amount)} approved but not yet invoiced ({cash.unbilled_ready.count}) — the cheapest lever.</p>
          )}
        </Panel>

        <Panel title="Receivables ageing" hint={`${inrCompact(d.ageing.overdue_total)} overdue · by days past due`}
               action={d.ageing.overdue_90_plus > 0 ? <StateChip state="bad">{inrCompact(d.ageing.overdue_90_plus)} past 90 d</StateChip> : undefined}>
          {d.ageing.buckets.length ? (
            <FilteredBars rowFilter rowLabel="Buckets" format={inrCompact} height={200}
                          data={d.ageing.buckets.map((b) => ({ label: b.label, amount: b.amount, invoices: b.count }))}
                          series={[{ key: "amount", label: "Outstanding", color: 5 }, { key: "invoices", label: "Invoices", color: 7, defaultOff: true }]} />
          ) : <p className="text-sm text-muted">Nothing outstanding.</p>}
          {d.ageing.top_overdue_customers.length > 0 && (
            <p className="mt-3 text-xs text-secondary">Owes most: {d.ageing.top_overdue_customers.slice(0, 3).map((r) => `${r.customer} ${inrCompact(r.overdue)}`).join(" · ")}</p>
          )}
        </Panel>

        <Panel title="Billing by engagement type" hint="T&M · Work package · Fixed price · Retainer">
          {d.by_type.length ? (
            <FilteredBars rowFilter rowLabel="Types" format={inrCompact} height={220}
                          data={d.by_type.map((r) => ({ label: r.label, billed: r.billed, share: r.share_pct ?? 0, invoices: r.invoices }))}
                          series={[{ key: "billed", label: "Billed", color: 0 }, { key: "share", label: "Share %", color: 3, defaultOff: true }, { key: "invoices", label: "Invoices", color: 7, defaultOff: true }]} />
          ) : <p className="text-sm text-muted">No billing in this period.</p>}
        </Panel>
      </div>
    </div>
  );
}

/* ====================================================================== Customer */

function EmployeeRows({ rows }: { rows: EmployeeRow[] }) {
  if (!rows.length) return <tr><td colSpan={8} className="px-3 py-2 text-xs text-muted">No one was deployed on this project in the period.</td></tr>;
  return (
    <>
      {rows.map((e) => (
        <tr key={e.pe_id} className="bg-surface-2">
          <td className={`${tdCls} pl-16`}>
            <CrmLink to={`employees/${e.employee_id}`} className="font-medium text-brand-600 hover:underline dark:text-brand-300">{e.employee}</CrmLink>
            {e.employee_code && <span className="ml-1.5 text-xs text-muted">{e.employee_code}</span>}
            <span className="ml-2"><KindChip kind={e.kind} title={e.kind_reason} /></span>
          </td>
          <td className={tdCls}>{inr(e.billed)}</td>
          <td className={tdCls}><span className="text-xs text-muted">{e.invoices} inv</span></td>
          <td className={tdCls}>{inr(e.cost)}{!e.has_ctc && <span className="ml-1 text-xs text-warning" title="No CTC on the employee record — cost understated">?</span>}</td>
          <td className={`${tdCls} ${e.margin < 0 ? "text-danger" : ""}`}>{inr(e.margin)}</td>
          <td className={tdCls}><span className="text-xs text-secondary">{inrCompact(e.rate)} / {e.unit}</span></td>
          <td className={tdCls}><span className="text-xs text-secondary">{fmtDay(e.onboarding)}{e.exit ? ` → ${fmtDay(e.exit)}` : ""}</span></td>
          <td className={tdCls}>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${e.exited ? STATE_CHIP.none : e.deployed_today ? STATE_CHIP.ok : STATE_CHIP.warn}`}>
              {e.exited ? "Exited" : e.deployed_today ? "Deployed" : "Not live"}
            </span>
          </td>
        </tr>
      ))}
    </>
  );
}

function ProjectRows({ rows, open, toggle }: { rows: ProjectRow[]; open: Set<string>; toggle: (k: string) => void }) {
  return (
    <>
      {rows.map((p) => {
        const key = `p${p.project_id}`;
        const isOpen = open.has(key);
        return (
          <React.Fragment key={p.project_id}>
            <tr className="bg-surface-1">
              <td className={`${tdCls} pl-8`}>
                <button type="button" onClick={() => toggle(key)} className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded text-secondary hover:bg-surface-2" aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${p.project}`}>
                  {isOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                </button>
                <CrmLink to={`projects/${p.project_id}`} className="font-medium text-brand-600 hover:underline dark:text-brand-300">{p.project}</CrmLink>
                {p.status && p.status !== "Active" && <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATE_CHIP.none}`}>{p.status}</span>}
                {p.end_date && <span className="ml-2 text-xs text-muted">ends {fmtDay(p.end_date)}</span>}
              </td>
              <td className={tdCls}>{inr(p.billed)}<div><Delta value={p.change_pct} /></div></td>
              <td className={tdCls}><ShareBar value={p.share_pct} /></td>
              <td className={tdCls}>{inr(p.cost)}</td>
              <td className={`${tdCls} ${p.margin < 0 ? "text-danger" : ""}`}>{inr(p.margin)} <span className="text-xs text-muted">{pct(p.margin_pct, 0)}</span></td>
              <td className={tdCls}>{num(p.heads)} <span className="text-xs text-muted">({p.heads_today} live)</span></td>
              <td className={tdCls}><span className="text-xs text-secondary">{p.internal} int · {p.external} ext</span></td>
              <td className={tdCls}>{p.outstanding > 0 ? inr(p.outstanding) : <span className="text-xs text-muted">—</span>}</td>
            </tr>
            {isOpen && (
              <>
                <EmployeeRows rows={p.employees} />
                {p.unlinked_billed > 0 && (
                  <tr className="bg-surface-2"><td colSpan={8} className="px-3 py-1.5 pl-16 text-xs text-secondary">{inr(p.unlinked_billed)} billed on invoices not linked to a timesheet (manual invoices) — counted on the project, not on a person.</td></tr>
                )}
              </>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

function CustomerTab({ d, period }: { d: CustomerData; period: CeoPeriod }) {
  const rev = revenueLink(period);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState<PeriodKind>("month");          // deployed-heads zoom: months of the period first
  const [groupBy, setGroupBy] = useState<"customers" | "locations">("customers");
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const s = d.summary;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? d.customers.filter((c) => c.customer.toLowerCase().includes(q) || c.projects.some((p) => p.project.toLowerCase().includes(q))) : d.customers;
  }, [d.customers, query]);
  const expandAll = () => setOpen(new Set(d.customers.flatMap((c) => [`c${c.customer_id}`, ...c.projects.map((p) => `p${p.project_id}`)])));

  // Dials: concentration (LOW is good), collection rate, blended margin.
  const collectionPct = s.billed ? (s.collected / s.billed) * 100 : null;
  const collectionState = highGood(collectionPct, 90, 75);
  const concState: StateTone = s.top1_share_pct === null ? "none" : s.top1_share_pct >= 50 ? "bad" : s.top1_share_pct >= 35 ? "warn" : "ok";
  const totalCost = d.customers.reduce((a, c) => a + c.cost, 0);
  const marginPct = s.billed ? ((s.billed - totalCost) / s.billed) * 100 : null;
  const marginState = highGood(marginPct, 30, 15);
  const lossMaking = d.customers.filter((c) => c.billed > 0 && c.margin < 0);
  const growing = d.customers.filter((c) => c.change_pct !== null && c.change_pct > 0).length;
  const shrinking = d.customers.filter((c) => c.change_pct !== null && c.change_pct < 0).length;

  // Charts: the period month by month with the top customers as series, then
  // four cuts of the customer book — billing, receivables, PO runway, people.
  const monthly = d.monthly.filter((r) => !r.future).map((r) => ({ label: r.label, ...r.customers }));
  const monthSeries = d.monthly_series.map((name, i) => ({ key: name, label: name, color: i, stackId: "billed" }));
  const active = d.customers.filter((c) => c.billed > 0 || c.previous > 0 || c.outstanding > 0 || c.heads_today > 0);
  const billing = active.map((c) => ({ label: c.customer, billed: c.billed, previous: c.previous, collected: c.collected, cost: c.cost, margin: c.margin }));
  const receivables = active.filter((c) => c.outstanding > 0).map((c) => ({ label: c.customer, outstanding: c.outstanding, overdue: c.overdue, current: c.outstanding - c.overdue }));
  const runway = active.filter((c) => c.po_balance > 0 || c.monthly_burn > 0).map((c) => ({ label: c.customer, po_balance: c.po_balance, burn: c.monthly_burn, cover: c.po_cover_months ?? 0 }));
  const people = active.filter((c) => c.heads > 0 || c.open_positions > 0).map((c) => ({ label: c.customer, deployed: c.heads_today, internal: c.internal, external: c.external, open: c.open_positions }));
  const runwayShort = runway.filter((r) => r.burn > 0 && r.cover < 2).length;
  // Deployed heads over time — rows are buckets, series are customers OR locations (one toggle).
  const deployedRows = d.deployed_trend[zoom].filter((r) => !r.future).map((r) => ({ label: r.label, total: r.total, ...r[groupBy] }));
  const deployedSeries = [
    ...d.deployed_series[groupBy].map((name, i) => ({ key: name, label: name, color: i, stackId: "heads" })),
    { key: "total", label: "Total deployed", color: 7, defaultOff: true, stackId: "total" },
  ];

  return (
    <div className="space-y-4">
      <Alerts alerts={d.alerts} to="customers" where="Customers" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Tile label="Customers billing" value={num(s.customers_billing)} to="customers" sub={`of ${num(s.customers)} with activity`} />
        <Tile label="Billed" value={inrCompact(s.billed)} to={rev} foot={<Delta value={s.change_pct} label={period.comparison_label} />} />
        <Tile label="Collected" value={inrCompact(s.collected)} tone="success" to={rev} sub={`${pct(collectionPct, 0)} of billed`} />
        <Tile label="Outstanding" value={inrCompact(s.outstanding)} tone={s.outstanding > 0 ? "warning" : "neutral"} to={rev} />
        <Tile label="Overdue" value={inrCompact(s.overdue)} tone={s.overdue > 0 ? "danger" : "success"} to={rev} />
        <Tile label="Heads in period" value={num(s.heads)} to="project-employees" sub={`${num(s.heads_today)} deployed today`} />
        <Tile label="Growing / shrinking" value={`${num(growing)} / ${num(shrinking)}`} tone={shrinking > growing ? "warning" : "success"} to="customers" sub={`accounts ${period.comparison_label}`} />
        <Tile label="Top customer" value={pct(s.top1_share_pct, 0)} tone={s.concentration_risk ? "warning" : "neutral"} sub={s.top_customer ?? "—"} to={rev} />
      </div>

      {/* 1 · How the period unfolded, customer by customer. */}
      <Panel title={`How ${period.kind === "fy" ? "the year" : "the period"} unfolded — by customer`} hint="billed month by month, stacked by customer — tick a customer or a month">
        {monthSeries.length ? (
          <FilteredBars data={monthly} stacked rowFilter rowLabel="Months" format={inrCompact} series={monthSeries} />
        ) : <p className="text-sm text-muted">No billing in this period.</p>}
      </Panel>

      <Panel title="Deployed on customer sites" hint={`heads deployed at the end of each ${zoom === "month" ? "month" : zoom === "quarter" ? "quarter" : "financial year"} · by ${groupBy === "customers" ? "customer" : "customer location (delivery branch, else the opportunity's work location)"} — tick a series or a period`}
             action={
               <div className="flex flex-wrap items-center gap-2">
                 <Segmented value={groupBy} options={[{ key: "customers", label: "By customer" }, { key: "locations", label: "By location" }]} onChange={setGroupBy} label="Deployed group" />
                 <Segmented value={zoom} options={ZOOM_OPTIONS} onChange={setZoom} label="Deployed zoom" />
               </div>
             }>
        {d.deployed_series[groupBy].length ? (
          <FilteredBars key={`${zoom}-${groupBy}`} data={deployedRows} stacked rowFilter rowLabel={ZOOM_ROWS[zoom]} series={deployedSeries} />
        ) : <p className="text-sm text-muted">Nobody deployed in this window.</p>}
      </Panel>

      {/* 2 · The dials: dependence, collection, margin. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Concentration" hint="share of billing from the largest customer — lower is safer" action={<StateChip state={concState}>{pct(s.top1_share_pct, 0)}</StateChip>}>
          <Speedometer value={s.top1_share_pct ?? 0} max={100} marker={50} markerLabel="risk" state={concState} invert label="Top customer share" caption={s.top_customer ?? "—"} format={(v) => `${Math.round(v)}%`} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat k="Top 3 share" v={pct(s.top3_share_pct, 0)} />
            <MiniStat k="Customers billing" v={num(s.customers_billing)} />
          </div>
        </Panel>
        <Panel title="Collection rate" hint="collected ÷ billed in the period" action={<StateChip state={collectionState}>{pct(collectionPct, 0)}</StateChip>}>
          <Speedometer value={collectionPct ?? 0} max={100} marker={90} markerLabel="goal" state={collectionState} label="Collection rate" caption="collected" format={(v) => `${Math.round(v)}%`} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat k="Collected" v={inrCompact(s.collected)} tone="ok" />
            <MiniStat k="Overdue" v={inrCompact(s.overdue)} tone={s.overdue > 0 ? "bad" : "ok"} />
          </div>
        </Panel>
        <Panel title="Blended margin" hint="billed − people cost across every customer" action={<StateChip state={marginState}>{pct(marginPct, 0)}</StateChip>}>
          <Speedometer value={marginPct ?? 0} max={60} marker={30} markerLabel="goal" state={marginState} label="Gross margin" caption="margin" format={(v) => `${Math.round(v)}%`} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat k="People cost" v={inrCompact(totalCost)} />
            <MiniStat k="Loss-making" v={num(lossMaking.length)} tone={lossMaking.length ? "bad" : "ok"} hint={lossMaking.map((c) => c.customer).join(", ") || undefined} />
          </div>
        </Panel>
      </div>

      {/* 3 · Four cuts of the customer book — bar charts with their own ticks. */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Customer billing" hint={`billed · ${period.comparison_label} · collected · cost · margin`}
               action={s.concentration_risk ? <StateChip state="warn">Concentrated</StateChip> : undefined}>
          {billing.length ? (
            <FilteredBars rowFilter rowLabel="Customers" format={inrCompact} height={220} data={billing}
                          series={[{ key: "billed", label: "Billed", color: 0 }, { key: "previous", label: period.comparison_label, color: 7 },
                                   { key: "collected", label: "Collected", color: 1, defaultOff: true }, { key: "cost", label: "People cost", color: 6, defaultOff: true },
                                   { key: "margin", label: "Margin", color: 2, defaultOff: true }]} />
          ) : <p className="text-sm text-muted">No billing in this period.</p>}
        </Panel>

        <Panel title="Receivables by customer" hint="what each customer still owes · overdue = past the due date today"
               action={s.overdue > 0 ? <StateChip state="bad">{inrCompact(s.overdue)} overdue</StateChip> : <StateChip state="ok">Nothing overdue</StateChip>}>
          {receivables.length ? (
            <FilteredBars rowFilter rowLabel="Customers" format={inrCompact} height={220} data={receivables} stacked
                          series={[{ key: "current", label: "Not yet due", color: 1 }, { key: "overdue", label: "Overdue", color: 5 },
                                   { key: "outstanding", label: "Total outstanding", color: 7, defaultOff: true, stackId: "total" }]} />
          ) : <p className="text-sm text-muted">Nothing outstanding.</p>}
        </Panel>

        <Panel title="PO runway by customer" hint="active PO balance vs this month's burn (deployed heads × monthly rate) — months of cover"
               action={runwayShort ? <StateChip state="warn">{runwayShort} under 2 months</StateChip> : undefined}>
          {runway.length ? (
            <FilteredBars rowFilter rowLabel="Customers" format={inrCompact} height={220} data={runway}
                          series={[{ key: "po_balance", label: "PO balance", color: 0 }, { key: "burn", label: "Monthly burn", color: 6 },
                                   { key: "cover", label: "Months of cover", color: 3, defaultOff: true }]} />
          ) : <p className="text-sm text-muted">No active PO or deployment.</p>}
        </Panel>

        <Panel title="People by customer" hint="deployed today · internal vs external placements · open positions">
          {people.length ? (
            <FilteredBars rowFilter rowLabel="Customers" height={220} data={people}
                          series={[{ key: "deployed", label: "Deployed today", color: 0 }, { key: "internal", label: "Internal", color: 2 },
                                   { key: "external", label: "External", color: 1 }, { key: "open", label: "Open positions", color: 5 }]} />
          ) : <p className="text-sm text-muted">Nobody deployed and nothing open.</p>}
        </Panel>
      </div>

      {/* 4 · The drill-down the CEO asked for: customer → project → person. */}
      <Panel title="Customer → project → person" hint="click a row to drill down · revenue is issued Tax invoices by invoice date · cost is CTC ÷ 12 × months deployed"
             action={
               <div className="flex items-center gap-2">
                 <input className={`${CONTROL} w-44`} placeholder="Find customer / project" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find customer or project" />
                 <button type="button" className={`${CONTROL} text-xs font-semibold`} onClick={expandAll}>Expand all</button>
                 <button type="button" className={`${CONTROL} text-xs font-semibold`} onClick={() => setOpen(new Set())}>Collapse</button>
               </div>
             }>
        <div className={tableWrap}>
          <table className="min-w-full">
            <thead className="border-b border-subtle">
              <tr>
                <th className={thCls}>Customer / project / person</th>
                <th className={thCls}>Billed</th>
                <th className={thCls}>Share</th>
                <th className={thCls}>People cost</th>
                <th className={thCls}>Margin</th>
                <th className={thCls}>Heads</th>
                <th className={thCls}>Internal / external</th>
                <th className={thCls}>Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-muted">{query ? "No customer or project matches." : "No billing or deployment in this period."}</td></tr>}
              {rows.map((c) => {
                const key = `c${c.customer_id}`;
                const isOpen = open.has(key);
                return (
                  <React.Fragment key={c.customer_id}>
                    <tr className="row-hover">
                      <td className={tdCls}>
                        <button type="button" onClick={() => toggle(key)} className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded text-secondary hover:bg-surface-2" aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${c.customer}`}>
                          {isOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                        </button>
                        <CrmLink to={`customers/${c.customer_id}`} className="font-semibold text-brand-600 hover:underline dark:text-brand-300">{c.customer}</CrmLink>
                        <span className="ml-2 text-xs text-muted">{c.projects_count} project{c.projects_count === 1 ? "" : "s"}</span>
                        {c.open_positions > 0 && <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATE_CHIP.warn}`}>{c.open_positions} open position{c.open_positions === 1 ? "" : "s"}</span>}
                        {c.po_balance > 0 && (
                          <span className="ml-2 text-xs text-muted">
                            PO {inrCompact(c.po_balance)} left{c.po_cover_months !== null && <> · <span className={c.po_cover_months < 2 ? "font-semibold text-warning" : ""}>{c.po_cover_months} mo cover</span></>}
                          </span>
                        )}
                      </td>
                      <td className={`${tdCls} font-semibold`}>{inr(c.billed)}<div className="font-normal"><Delta value={c.change_pct} label={period.comparison_label} /></div></td>
                      <td className={tdCls}><ShareBar value={c.share_pct} /></td>
                      <td className={tdCls}>{inr(c.cost)}</td>
                      <td className={`${tdCls} ${c.margin < 0 ? "text-danger" : ""}`}>{inr(c.margin)} <span className="text-xs text-muted">{pct(c.margin_pct, 0)}</span></td>
                      <td className={tdCls}>{num(c.heads)} <span className="text-xs text-muted">({c.heads_today} live)</span></td>
                      <td className={tdCls}><span className="text-xs text-secondary">{c.internal} int · {c.external} ext</span></td>
                      <td className={tdCls}>
                        {c.outstanding > 0 ? inr(c.outstanding) : <span className="text-xs text-muted">—</span>}
                        {c.overdue > 0 && <span className="ml-1.5 text-xs font-semibold text-danger">{inrCompact(c.overdue)} overdue</span>}
                      </td>
                    </tr>
                    {isOpen && <ProjectRows rows={c.projects} open={open} toggle={toggle} />}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

/* ====================================================================== Sales */

function SalesTab({ d, period }: { d: SalesData; period: CeoPeriod }) {
  const [scope, setScope] = useState<"live" | "all">("live");
  const [zoom, setZoom] = useState<PeriodKind>("month");   // months inside the period first; Quarterly / Yearly one click away
  const k = d.kpis, mix = d.onboarding_mix, ps = d.positions_summary, f = d.funnel;
  const fillPct = ps.total ? (ps.joined / ps.total) * 100 : null;
  const fillState = highGood(fillPct, 80, 50);
  const mixState = highGood(mix.internal_pct, 40, 20);
  const positions = scope === "live" ? d.positions.filter((p) => p.live) : d.positions;
  const trend = d.onboarding_trend[zoom].filter((r) => !r.future);
  const byCustomer = d.by_customer.map((c) => ({ label: c.customer, open: c.open, joined: c.joined, positions: c.positions, internal: c.internal, external: c.external, stale: c.stale }));
  const byOwner = d.by_owner.map((o) => ({ label: o.owner, positions: o.positions, open: o.open, joined: o.joined, opportunities: o.opportunities }));
  const funnel = [
    { label: "Pipeline", value: f.pipeline, hint: "positions on every requirement still moving" },
    { label: "Open to fill", value: f.active_open, hint: "pipeline minus already joined" },
    { label: "Workable by TA", value: f.workable, hint: "RMG-approved, not on hold" },
    { label: "Joined so far", value: f.in_progress_joined, hint: "on active requirements" },
    { label: "Awaiting approval", value: f.awaiting_approval, hint: "Sales Head / RMG queue" },
    { label: "On hold", value: f.on_hold, hint: "customer or Sales hold" },
  ].map((s) => ({ label: s.label, positions: s.value }));
  const stages = d.stage_delays.rows.map((r) => ({ label: r.label, waiting: r.count, over_warn: r.over_warn, over_bad: r.over_bad, avg_days: r.avg_days }));

  return (
    <div className="space-y-4">
      <Alerts alerts={d.alerts} to="opportunities" where="Opportunities" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Tile label="Positions brought in" value={num(k.pipeline_positions)} to="opportunities" foot={<Delta value={k.pipeline_positions_prev ? ((k.pipeline_positions - k.pipeline_positions_prev) / k.pipeline_positions_prev) * 100 : null} label={period.comparison_label} />} sub={`${num(k.opportunities)} opportunities`} />
        <Tile label="Onboarded" value={num(k.onboardings)} tone="success" to="profiles?f_state=joined" foot={<Delta value={k.onboardings_prev ? ((k.onboardings - k.onboardings_prev) / k.onboardings_prev) * 100 : null} label={period.comparison_label} />}
              sub={<><span className="font-semibold text-success">{mix.internal} internal</span> · <span className="font-semibold text-info">{mix.external} external</span>{mix.unknown ? ` · ${mix.unknown} unknown` : ""}</>} />
        <Tile label="Open now" value={num(k.active_positions)} tone={k.active_positions ? "warning" : "success"} to="opportunities" sub={`${num(k.workable_positions)} workable (approved, not on hold)`} />
        <Tile label="Fill rate" value={pct(fillPct, 0)} tone={fillState === "ok" ? "success" : fillState === "warn" ? "warning" : "danger"} sub={`${num(ps.joined)} of ${num(ps.total)} live positions filled`} />
        <Tile label="Fulfilled" value={num(k.positions_fulfilled)} tone="success" sub={<>customer closed <span className="font-semibold text-danger">{num(k.positions_customer_closed)}</span> beside, never added</>} />
        <Tile label="Active customers" value={num(k.active_customers)} to="customers" sub={d.customers.largest ? `${d.customers.largest.name} holds ${pct(d.customers.largest.share_pct, 0)} of open positions` : "with a live, approved deal"} tone={d.customers.concentration_risk ? "warning" : "brand"} />
        <Tile label="Stale positions" value={num(ps.stale_30)} tone={ps.stale_30 ? "danger" : "success"} to="opportunities" sub="open for 30+ days" />
        <Tile label="Waiting in stages" value={num(d.stage_delays.total_waiting)} tone={d.stage_delays.rows.some((r) => r.state === "bad") ? "danger" : d.stage_delays.rows.some((r) => r.state === "warn") ? "warning" : "neutral"} to="profiles" sub="candidates between stages" />
      </div>

      {/* 1 · How the period unfolded — positions in vs onboarded, internal vs external, at three zooms. */}
      <Panel title={`How ${period.kind === "fy" ? "the year" : "the period"} unfolded`} hint={`${ZOOM_LABEL[zoom].toLowerCase()} · positions brought in vs candidates onboarded (internal / external) — tick a series or a period`}
             action={<Segmented value={zoom} options={ZOOM_OPTIONS} onChange={setZoom} label="Onboarding zoom" />}>
        <FilteredBars key={zoom} data={trend} stacked rowFilter rowLabel={ZOOM_ROWS[zoom]}
                      series={[{ key: "positions_in", label: "Positions brought in", color: 3, stackId: "in" },
                               { key: "internal", label: "Onboarded — internal", color: 2 }, { key: "external", label: "Onboarded — external", color: 0 },
                               { key: "unknown", label: "Onboarded — unknown", color: 7 },
                               { key: "onboardings", label: "Total onboarded", color: 1, defaultOff: true, stackId: "total" }]} />
      </Panel>

      {/* 2 · The dials: Sales pace · Fulfilment pace · internal share. */}
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <PaceCard title="Sales pace" pace={d.pace.sales} targetLabel="Positions target" unit="positions" periodLabel={period.label}
                  comparison={<span>{period.comparison_label} {num(k.pipeline_positions_prev)}</span>} />
        <PaceCard title="Fulfilment pace" pace={d.pace.fulfilment} targetLabel="Onboarding target" unit="onboardings" periodLabel={period.label}
                  comparison={<span>{period.comparison_label} {num(k.onboardings_prev)}</span>} />
        <Panel className="lg:col-span-2 2xl:col-span-1" title="Internal vs external" hint="of the period's onboardings — the placements rule" action={<StateChip state={mixState}>{pct(mix.internal_pct, 0)} internal</StateChip>}>
          <div className="grid gap-4 md:grid-cols-[minmax(0,15rem),1fr] md:items-center">
            <Speedometer value={mix.internal_pct ?? 0} max={100} marker={40} markerLabel="goal" state={mixState} label="Internal share" caption="internal" format={(v) => `${Math.round(v)}%`} />
            <div className="grid grid-cols-2 gap-2">
              <MiniStat k="Internal" v={num(mix.internal)} tone="ok" hint={d.rules.internal} />
              <MiniStat k="External" v={num(mix.external)} hint={d.rules.external} />
              <MiniStat k="Unknown" v={num(mix.unknown)} tone={mix.unknown ? "warn" : undefined} hint={d.rules.unknown} />
              <MiniStat k="Onboarded" v={num(mix.total)} />
              <p className="col-span-2 text-xs leading-relaxed text-secondary">Internal = redeployed from the bench or on Karnex rolls 30+ days before the onboarding; external = hired for the position.</p>
            </div>
          </div>
        </Panel>
      </div>

      {/* 3 · Where the open headcount sits — four bar charts with their own ticks. */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Positions by customer" hint="live positions · open vs joined · internal vs external · stale"
               action={d.customers.concentration_risk ? <StateChip state="warn">Concentrated</StateChip> : undefined}>
          {byCustomer.length ? (
            <FilteredBars rowFilter rowLabel="Customers" height={220} data={byCustomer}
                          series={[{ key: "open", label: "Open", color: 5 }, { key: "joined", label: "Joined", color: 2 },
                                   { key: "positions", label: "Total positions", color: 7, defaultOff: true }, { key: "internal", label: "Internal", color: 1, defaultOff: true },
                                   { key: "external", label: "External", color: 0, defaultOff: true }, { key: "stale", label: "Stale 30+ d", color: 6, defaultOff: true }]} />
          ) : <p className="text-sm text-muted">No live positions.</p>}
        </Panel>

        <Panel title="Where every position stands" hint="today's snapshot of the sourcing funnel"
               action={<span className="text-xs text-muted">all time: <span className="font-semibold text-success">{num(f.fulfilled)} fulfilled</span> · {num(f.customer_closed)} closed by customer</span>}>
          <FilteredBars rowFilter rowLabel="Stages" height={220} data={funnel}
                        series={[{ key: "positions", label: "Positions", color: 0 }]} />
        </Panel>

        <Panel title="By Sales owner" hint="positions on live deals or deals opened in the period">
          {byOwner.length ? (
            <FilteredBars rowFilter rowLabel="Owners" height={220} data={byOwner}
                          series={[{ key: "positions", label: "Positions", color: 3 }, { key: "open", label: "Open", color: 5 },
                                   { key: "joined", label: "Joined", color: 2 }, { key: "opportunities", label: "Opportunities", color: 7, defaultOff: true }]} />
          ) : <p className="text-sm text-muted">No positions in this view.</p>}
        </Panel>

        <Panel title="Hiring-stage delays" hint={`candidates waiting at each stage · amber ≥ ${d.stage_delays.warn_days} days · red ≥ ${d.stage_delays.bad_days} days since the last move`}
               action={d.stage_delays.total_waiting ? <StateChip state={d.stage_delays.rows.some((r) => r.state === "bad") ? "bad" : d.stage_delays.rows.some((r) => r.state === "warn") ? "warn" : "ok"}>{num(d.stage_delays.total_waiting)} waiting</StateChip> : undefined}>
          {stages.length ? (
            <FilteredBars rowFilter rowLabel="Stages" height={220} data={stages}
                          series={[{ key: "waiting", label: "Waiting", color: 0 }, { key: "over_warn", label: `Over ${d.stage_delays.warn_days} d`, color: 6 },
                                   { key: "over_bad", label: `Over ${d.stage_delays.bad_days} d`, color: 5 }, { key: "avg_days", label: "Avg days", color: 7, defaultOff: true }]} />
          ) : <p className="text-sm text-muted">Nobody is waiting at an interview, offer or joining stage right now.</p>}
        </Panel>
      </div>

      {/* 4 · The position-by-position table. */}
      <Panel title="Positions" hint="every live position (plus, on 'All', those opened or closed in the period) · who joined and whether they were internal or external"
             action={<Segmented value={scope} options={[{ key: "live", label: `Live (${ps.live})` }, { key: "all", label: `All (${ps.shown})` }]} onChange={setScope} label="Positions scope" />}>
        <div className={tableWrap}>
          <table className="min-w-full">
            <thead className="border-b border-subtle">
              <tr>
                <th className={thCls}>Opportunity</th>
                <th className={thCls}>Customer</th>
                <th className={thCls}>Owner</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>Filled</th>
                <th className={thCls}>Open</th>
                <th className={thCls}>Internal / external</th>
                <th className={thCls}>Joined</th>
                <th className={thCls}>Age</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {positions.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-sm text-muted">No positions in this view.</td></tr>}
              {positions.map((p) => (
                <tr key={p.requirement_id} className="row-hover align-top">
                  <td className={tdCls}>
                    <CrmLink to={`opportunities/${p.opportunity_id}`} className="font-medium text-brand-600 hover:underline dark:text-brand-300">{p.title}</CrmLink>
                    <div className="text-xs text-muted">{p.opp_id}{p.opp_type ? ` · ${p.opp_type}` : ""}{p.rfi_value ? ` · ${inrCompact(p.rfi_value)}` : ""}</div>
                  </td>
                  <td className={tdCls}><CrmLink to={`customers/${p.customer_id}`} className="hover:underline">{p.customer}</CrmLink></td>
                  <td className={tdCls}><span className="text-xs text-secondary">{p.owner ?? "—"}</span></td>
                  <td className={tdCls}>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${p.live ? (p.workable ? STATE_CHIP.ok : STATE_CHIP.warn) : STATE_CHIP.none}`}>{p.status.replace(/_/g, " ")}</span>
                  </td>
                  <td className={tdCls}>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2"><div className={`h-full rounded-full ${p.open === 0 ? "bg-emerald-500" : "bg-brand-500"}`} style={{ width: `${p.fill_pct ?? 0}%` }} /></div>
                      <span className="text-xs tabular-nums">{p.joined} / {p.positions}</span>
                    </div>
                  </td>
                  <td className={`${tdCls} font-semibold ${p.open > 0 && p.live ? "text-warning" : ""}`}>{p.live ? p.open : "—"}</td>
                  <td className={tdCls}><span className="text-xs"><span className="font-semibold text-success">{p.internal}</span> / <span className="font-semibold text-info">{p.external}</span>{p.unknown ? <span className="text-muted"> / {p.unknown}?</span> : null}</span></td>
                  <td className={`${tdCls} whitespace-normal`}>
                    <div className="flex max-w-[22rem] flex-wrap gap-1">
                      {p.candidates.map((c) => (
                        <CrmLink key={c.profile_id} to={`profiles/${c.profile_id}`} title={`${c.reason}${c.reason ? " · " : ""}joined ${fmtDay(c.joined_on)}`}
                                 className={`rounded-full px-2 py-0.5 text-[10px] font-semibold hover:underline ${KIND_CHIP[c.kind]} ${c.in_period ? "" : "opacity-60"}`}>
                          {c.name}
                        </CrmLink>
                      ))}
                      {p.candidates_more > 0 && <span className="text-[10px] text-muted">+{p.candidates_more} more</span>}
                      {!p.candidates.length && <span className="text-xs text-muted">none yet</span>}
                    </div>
                  </td>
                  <td className={tdCls}><span className={`text-xs ${p.live && p.open > 0 && p.age_days >= 30 ? "font-semibold text-danger" : "text-secondary"}`}>{p.age_days} d</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

/* ====================================================================== People */

/** Initials on a colour picked from the name — the same person, the same colour, everywhere. */
const AVATAR_TONES = ["from-sky-500 to-indigo-600", "from-emerald-500 to-teal-600", "from-violet-500 to-fuchsia-600",
  "from-amber-500 to-orange-600", "from-rose-500 to-pink-600", "from-cyan-500 to-sky-600"];
function Avatar({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  const tone = AVATAR_TONES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  return (
    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br text-xs font-bold text-white shadow-raised ${tone}`} aria-hidden>
      {initials}
    </span>
  );
}

const daysFromToday = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const now = new Date();
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
};

type DirKey = "bench" | "on_notice" | "joiners" | "exits" | "placed";
const DIR_PAGE = 12;

/**
 * The names behind the numbers (29 Sep 2026 redesign, HR ask "make this a better
 * view"): ONE panel with a tab per list — On the bench · On notice · Joined · Left ·
 * Placed — counts on the tabs, a search box, and people as cards (avatar, name →
 * the employee, code · role, what matters for that list as a chip). Twelve at a
 * time with "Show more"; the rest are on Employees.
 */
function PeopleDirectory({ d, period }: { d: PeopleData; period: CeoPeriod }) {
  const [tab, setTab] = useState<DirKey>(d.on_notice.length ? "on_notice" : "joiners");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(DIR_PAGE);
  const placed = d.placements?.rows ?? [];
  const tabs: { key: DirKey; label: string; count: number; hint: string }[] = [
    { key: "on_notice", label: "On notice", count: d.on_notice.length, hint: "resigned, last working day ahead" },
    { key: "joiners", label: `Joined in ${period.short_label}`, count: d.joiners.length, hint: "by Karnex joining date" },
    { key: "placed", label: "Placed", count: placed.length, hint: "onto a customer project in the period — internal or external" },
    { key: "bench", label: "On the bench", count: d.bench.length, hint: "no live assignment today" },
    { key: "exits", label: `Left in ${period.short_label}`, count: d.exits.length, hint: "by last working day" },
  ];
  const active = tabs.find((t) => t.key === tab) ?? tabs[0];
  const needle = q.trim().toLowerCase();
  const match = (...parts: (string | null | undefined)[]) => !needle || parts.some((x) => (x || "").toLowerCase().includes(needle));

  type Card = { key: string; id: number; name: string; sub: string; chip: React.ReactNode; extra?: React.ReactNode };
  const people = (rows: PersonRow[], chip: (r: PersonRow) => React.ReactNode): Card[] =>
    rows.filter((r) => match(r.employee, r.employee_code, r.role)).map((r) => ({
      key: `${tab}:${r.employee_id}`, id: r.employee_id, name: r.employee,
      sub: [r.employee_code, r.role].filter(Boolean).join(" · ") || "—", chip: chip(r),
      extra: r.projects.length ? <span className="truncate">{r.projects.map((x) => x.customer || x.project).join(", ")}</span> : undefined,
    }));
  const pill = (cls: string, text: string) => <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>{text}</span>;
  const cards: Card[] =
    tab === "bench" ? people(d.bench, (r) => pill(r.has_ctc ? STATE_CHIP.warn : STATE_CHIP.none, r.cost_month === null ? "no CTC" : `${inrCompact(r.cost_month)} / mo`))
    : tab === "on_notice" ? people(d.on_notice, (r) => {
        const n = daysFromToday(r.exit_on);
        return pill(n !== null && n <= 7 ? STATE_CHIP.bad : STATE_CHIP.warn, n === null ? "last day —" : n <= 0 ? "last day today" : `last day in ${n} d`);
      })
    : tab === "joiners" ? people(d.joiners, (r) => pill(STATE_CHIP.ok, `joined ${fmtDay(r.doj)}`))
    : tab === "exits" ? people(d.exits, (r) => pill(STATE_CHIP.none, `left ${fmtDay(r.exit_on)}`))
    : placed.filter((r) => match(r.employee, r.employee_code, r.customer, r.project)).map((r) => ({
        key: `placed:${r.pe_id}`, id: r.employee_id, name: r.employee,
        sub: [r.employee_code, r.customer, r.project].filter(Boolean).join(" · ") || "—",
        chip: <KindChip kind={r.kind} title={r.reason} />,
        extra: <span>placed {fmtDay(r.placed_on)}{r.karnex_joined ? ` · joined Karnex ${fmtDay(r.karnex_joined)}` : ""}</span>,
      }));

  return (
    <section className="rounded-card border border-subtle bg-surface-1 shadow-raised" aria-label="People">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-primary">The people behind the numbers</h2>
          <p className="text-xs text-muted">{active.hint}</p>
        </div>
        <input type="text" value={q} onChange={(e) => { setQ(e.target.value); setShown(DIR_PAGE); }}
               placeholder="Search name, code, role, customer…" aria-label="Search people"
               className={`${CONTROL} w-full sm:w-64`} />
      </header>
      <div className="flex gap-1 overflow-x-auto border-b border-subtle px-3 py-2" role="tablist" aria-label="People lists">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={t.key === tab}
                  onClick={() => { setTab(t.key); setShown(DIR_PAGE); }}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-semibold transition-colors duration-micro ${
                    t.key === tab ? "bg-brand-600 text-white shadow-raised" : "text-secondary hover:bg-surface-2 hover:text-primary"}`}>
            {t.label}
            <span className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums ${t.key === tab ? "bg-white/25 text-white" : "bg-surface-2 text-secondary"}`}>{t.count}</span>
          </button>
        ))}
      </div>
      <div className="p-4">
        {cards.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{needle ? "Nobody matches that search." : "Nobody in this list."}</p>
        ) : (
          <>
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" role="tabpanel" aria-label={active.label}>
              {cards.slice(0, shown).map((c) => (
                <li key={c.key} className="fx-lift flex items-center gap-3 rounded-card border border-subtle bg-surface-2 px-3 py-2.5">
                  <Avatar name={c.name} />
                  <div className="min-w-0 flex-1">
                    <CrmLink to={`employees/${c.id}`} className="block truncate text-sm font-semibold text-primary hover:text-brand-600 hover:underline dark:hover:text-brand-300">{c.name}</CrmLink>
                    <div className="truncate text-xs text-muted">{c.sub}</div>
                    {c.extra && <div className="truncate text-[11px] text-secondary">{c.extra}</div>}
                  </div>
                  <div className="shrink-0">{c.chip}</div>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>Showing {Math.min(shown, cards.length)} of {cards.length}{tab === "placed" && d.placements?.rows_truncated ? " (latest only)" : ""}</span>
              <span className="flex items-center gap-2">
                {shown < cards.length && (
                  <button type="button" className={btnSecondary} onClick={() => setShown((n) => n + DIR_PAGE * 2)}>Show more</button>
                )}
                <CrmLink to="employees" className="font-semibold text-brand-600 hover:underline dark:text-brand-300">All employees →</CrmLink>
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** Internal vs external placements (29 Sep 2026, HR ask): stacked bars per bucket
 *  of the period, a customer split, and the counts — the Revenue page's rule. */
function PlacementsPanels({ p }: { p: PlacementsData }) {
  const h = p.headline;
  const series = p.series.map((r) => ({ label: r.label, internal: r.internal, external: r.external, unknown: r.unknown,
                                        total: r.internal + r.external + r.unknown }));
  const customers = p.by_customer.slice(0, 12).map((c) => ({ label: c.customer, internal: c.internal, external: c.external, unknown: c.unknown }));
  const share = h.internal_pct;
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Panel title="Placed — internal vs external" hint={`${p.window.label} · ${p.window.bucket === "week" ? "by week" : "by month"} · internal = already with us before the placement`}
             action={<span className="text-xs font-semibold text-secondary">{num(h.placements)} placements</span>}>
        <FilteredBars data={series} stacked height={230}
                      series={[{ key: "internal", label: "Internal", color: 2 }, { key: "external", label: "External", color: 1 },
                               { key: "unknown", label: "Unknown", color: 7 }, { key: "total", label: "Total", color: 0, defaultOff: true, stackId: "total" }]} />
      </Panel>
      <Panel title="Mix this period" hint="who we placed — our own people or new hires"
             action={<StateChip state={share === null ? "none" : share >= 50 ? "ok" : "warn"}>{pct(share, 0)} internal</StateChip>}>
        <Speedometer value={share ?? 0} max={100} marker={50} markerLabel="half" state={share === null ? "none" : share >= 50 ? "ok" : "warn"}
                     label="Internal share" caption="internal" format={(v) => `${Math.round(v)}%`} />
        <div className="mt-3 grid grid-cols-3 gap-2">
          <MiniStat k="Internal" v={num(h.internal)} tone="ok" hint={p.rules.internal} />
          <MiniStat k="External" v={num(h.external)} hint={p.rules.external} />
          <MiniStat k="Unknown" v={num(h.unknown)} tone={h.unknown ? "warn" : undefined} hint={p.rules.unknown} />
        </div>
        {h.undated > 0 && <p className="mt-2 text-xs text-warning">{h.undated} assignment(s) have no onboarding date — not counted.</p>}
        <p className="mt-1 text-[11px] text-muted">Previous period: {num(h.previous.placements)} placed · {num(h.previous.internal)} internal · {num(h.previous.external)} external</p>
      </Panel>
      <Panel title="By customer" hint="where they went — internal vs external">
        {customers.length ? (
          <FilteredBars data={customers} stacked height={230}
                        series={[{ key: "internal", label: "Internal", color: 2 }, { key: "external", label: "External", color: 1 },
                                 { key: "unknown", label: "Unknown", color: 7, defaultOff: true }]} />
        ) : <p className="text-sm text-muted">No placements in this period.</p>}
      </Panel>
    </div>
  );
}

export function PeopleTab({ d, period }: { d: PeopleData; period: CeoPeriod }) {
  const h = d.headline;
  const utilState = highGood(h.utilisation_pct, 85, 70);
  const attrState = lowGood(h.attrition_pct, 10, 20);
  const benchState = lowGood(h.bench_cost_pct, 10, 20);
  const past = d.monthly.filter((r) => !r.future);
  const strip = past.map((r) => ({ label: r.label, headcount: r.headcount ?? 0, deployed: r.deployed ?? 0, bench: r.bench ?? 0, joiners: r.joiners, exits: r.exits }));
  const costs = past.map((r) => ({ label: r.label, cost: r.cost ?? 0, bench_cost: r.bench_cost ?? 0, deployed_cost: (r.cost ?? 0) - (r.bench_cost ?? 0) }));
  const planned = d.monthly.filter((r) => r.future && r.exits > 0).reduce((a, r) => a + r.exits, 0);
  const byRole = d.by_role.map((r) => ({ label: r.role, deployed: r.deployed, bench: r.bench, on_notice: r.on_notice, cost: r.cost }));
  const tenure = d.tenure.map((t) => ({ label: t.label, deployed: t.deployed, bench: t.bench }));
  const rolloffs = d.rolloffs_by_month.map((r) => ({ label: r.label, heads: r.heads, monthly_rate: r.monthly_rate }));
  const rateAtRisk = d.rolloffs_by_month.reduce((a, r) => a + r.monthly_rate, 0);

  return (
    <div className="space-y-4">
      <Alerts alerts={d.alerts} to="employees" where="Employees" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Tile label="Headcount" value={num(h.headcount)} to="employees" sub={`${num(h.opening_headcount)} at the start of the period`} foot={<Delta value={h.opening_headcount ? ((h.headcount - h.opening_headcount) / h.opening_headcount) * 100 : null} label="since start" />} />
        <Tile label="Deployed" value={num(h.deployed)} tone="success" to="employees?deployment=deployed" sub={`${pct(h.utilisation_pct, 0)} utilisation`} />
        <Tile label="On the bench" value={num(h.bench)} tone={h.bench ? "warning" : "success"} to="employees?deployment=bench" sub={`${inrCompact(h.bench_cost_month)} / month · ${pct(h.bench_cost_pct, 0)} of people cost`} />
        <Tile label="Joined" value={num(h.joiners)} tone="success" to="employees" sub={`in ${period.short_label}`} />
        <Tile label="Left" value={num(h.exits)} tone={h.exits ? "danger" : "neutral"} to="employees" sub={`net ${h.net_change >= 0 ? "+" : ""}${h.net_change}${planned ? ` · ${planned} planned` : ""}`} />
        <Tile label="Attrition" value={pct(h.attrition_pct, 0)} tone={attrState === "ok" ? "success" : attrState === "warn" ? "warning" : "danger"} to="employees" sub={`${num(h.on_notice)} on notice`} />
        <Tile label="Revenue / deployed head" value={inrCompact(h.revenue_per_deployed_head)} sub={`${inrCompact(h.billed)} billed`} to={revenueLink(period)} />
        <Tile label="Roll-offs next 90 d" value={num(h.rolloffs_90d)} tone={h.rolloffs_90d ? "warning" : "success"} to="project-employees" sub={`${inrCompact(rateAtRisk)} / month at risk`} />
      </div>

      {/* 1 · How the period unfolded — headcount, deployed, bench, joiners, exits, month by month. */}
      <Panel title={`How ${period.kind === "fy" ? "the year" : "the period"} unfolded`} hint="headcount · deployed · bench at month end, joiners and exits in the month — tick what to compare">
        <FilteredBars data={strip} rowFilter rowLabel="Months"
                      series={[{ key: "deployed", label: "Deployed", color: 2 }, { key: "bench", label: "On the bench", color: 6 },
                               { key: "headcount", label: "Headcount", color: 0, defaultOff: true }, { key: "joiners", label: "Joiners", color: 1, defaultOff: true },
                               { key: "exits", label: "Exits", color: 5, defaultOff: true }]} />
      </Panel>

      {/* 1b · Internal vs external placements (29 Sep 2026, HR ask). */}
      {d.placements && <PlacementsPanels p={d.placements} />}

      {/* 2 · The dials: utilisation · attrition · bench cost. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Utilisation" hint="deployed ÷ headcount today" action={<StateChip state={utilState}>{pct(h.utilisation_pct, 0)}</StateChip>}>
          <Speedometer value={h.utilisation_pct ?? 0} max={100} marker={85} markerLabel="goal" state={utilState} label="Utilisation" caption="deployed" format={(v) => `${Math.round(v)}%`} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat k="Deployed" v={num(h.deployed)} tone="ok" />
            <MiniStat k="On the bench" v={num(h.bench)} tone={h.bench ? "warn" : undefined} />
          </div>
        </Panel>
        <Panel title="Attrition" hint="exits ÷ average headcount in the period" action={<StateChip state={attrState}>{pct(h.attrition_pct, 0)}</StateChip>}>
          <Speedometer value={h.attrition_pct ?? 0} max={40} marker={10} markerLabel="limit" state={attrState} invert label="Attrition" caption="attrition" format={(v) => `${Math.round(v)}%`} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat k="Left" v={num(h.exits)} tone={h.exits ? "bad" : "ok"} />
            <MiniStat k="On notice" v={num(h.on_notice)} tone={h.on_notice ? "warn" : undefined} />
          </div>
        </Panel>
        <Panel title="Bench cost" hint="bench CTC ÷ this month's people cost — the money earning nothing" action={<StateChip state={benchState}>{pct(h.bench_cost_pct, 0)}</StateChip>}>
          <Speedometer value={h.bench_cost_pct ?? 0} max={40} marker={10} markerLabel="limit" state={benchState} invert label="Bench cost share" caption="of people cost" format={(v) => `${Math.round(v)}%`} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat k="Bench / month" v={inrCompact(h.bench_cost_month)} tone={h.bench ? "warn" : "ok"} hint={h.heads_without_ctc ? `${h.heads_without_ctc} head(s) without a CTC — understated` : undefined} />
            <MiniStat k="People cost / month" v={inrCompact(h.people_cost_month)} />
          </div>
        </Panel>
      </div>

      {/* 3 · Four cuts of the workforce — bar charts with their own ticks. */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="People cost by month" hint="CTC ÷ 12 of everyone on the rolls · split deployed vs bench">
          <FilteredBars data={costs} stacked rowFilter rowLabel="Months" format={inrCompact} height={220}
                        series={[{ key: "deployed_cost", label: "Deployed", color: 2 }, { key: "bench_cost", label: "Bench", color: 6 },
                                 { key: "cost", label: "Total", color: 0, defaultOff: true, stackId: "total" }]} />
        </Panel>

        <Panel title="Deployed vs bench by designation" hint="who is idle, by role — the skills on the bench"
               action={<span className="text-xs text-muted">{num(h.headcount)} on the rolls today</span>}>
          {byRole.length ? (
            <FilteredBars data={byRole} stacked rowFilter rowLabel="Designations" height={220}
                          series={[{ key: "deployed", label: "Deployed", color: 2 }, { key: "bench", label: "On the bench", color: 6 },
                                   { key: "on_notice", label: "On notice", color: 5, defaultOff: true, stackId: "notice" }]} />
          ) : <p className="text-sm text-muted">Nobody on the rolls.</p>}
        </Panel>

        <Panel title="Tenure mix" hint={`how long today's people have been with us · avg ${h.avg_tenure_years ?? "—"} yrs`}>
          <FilteredBars data={tenure} stacked rowFilter rowLabel="Tenure" height={220}
                        series={[{ key: "deployed", label: "Deployed", color: 2 }, { key: "bench", label: "On the bench", color: 6 }]} />
        </Panel>

        <Panel title="Rolling off in the next 90 days" hint="cover ends with the project's last working day or its PO · monthly rate that stops billing"
               action={d.rolloffs.length ? <StateChip state={d.rolloffs.some((r) => r.days_left !== null && r.days_left <= 30) ? "bad" : "warn"}>{num(d.rolloffs.length)} heads</StateChip> : <StateChip state="ok">None</StateChip>}>
          {rolloffs.length ? (
            <>
              <FilteredBars data={rolloffs} rowFilter rowLabel="Months" height={180}
                            series={[{ key: "heads", label: "Heads", color: 6 }, { key: "monthly_rate", label: "Monthly rate at risk", color: 5, defaultOff: true }]} />
              <ul className="mt-3 divide-y divide-subtle">
                {d.rolloffs.slice(0, 5).map((r) => (
                  <li key={r.project_employee_id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    <div className="min-w-0">
                      <CrmLink to={`employees/${r.employee_id}`} className="font-medium text-brand-600 hover:underline dark:text-brand-300">{r.employee_name}</CrmLink>
                      <span className="ml-2 truncate text-xs text-muted">{r.project_name}{r.customer_name ? ` · ${r.customer_name}` : ""}</span>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${r.days_left !== null && r.days_left <= 30 ? STATE_CHIP.bad : STATE_CHIP.warn}`}>
                      {r.days_left === null ? "—" : r.days_left < 0 ? "ended" : `${r.days_left} d`}
                    </span>
                  </li>
                ))}
                {d.rolloffs.length > 5 && <li className="pt-2 text-xs text-muted">+{d.rolloffs.length - 5} more</li>}
              </ul>
            </>
          ) : <p className="text-sm text-muted">Nobody rolls off in the next 90 days.</p>}
        </Panel>
      </div>

      {/* 4 · The names behind the numbers — one directory, a tab per list. */}
      <PeopleDirectory d={d} period={period} />
    </div>
  );
}

/* ====================================================================== shell */

export function CeoDashboard() {
  const [tab, setTab] = useState<CeoTab>(readStoredTab);
  const [period, setPeriod] = useState<PeriodKind>("fy");
  const [month, setMonth] = useState<string>(thisMonthKey());

  const url = `/api/dashboard/ceo${qs({ tab, month, period })}`;
  const { data, loading, error, retry } = useDeskData<CeoPayload<unknown>>(url);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [toast, showToast] = useToast();
  // The Targets dialog reads the Finance tab's `targets`; on another tab it
  // fetches them itself so the button works from every tab.
  const [targetsFor, setTargetsFor] = useState<{ month: string; targets: TargetsForModal } | null>(null);
  const openTargets = async () => {
    const fin = data && data.tab === "finance" ? (data.data as FinanceData).targets : null;
    if (fin) { setTargetsFor({ month, targets: fin }); setTargetsOpen(true); return; }
    try {
      const r = await crmGet<{ targets: TargetsForModal }>(`/api/reports/revenue${qs({ month, period })}`);
      setTargetsFor({ month, targets: r.data.targets }); setTargetsOpen(true);
    } catch (e: any) { showToast(e?.message || "Could not load the targets", "err"); }
  };
  const atCurrent = useMemo(() => {
    if (!data) return month >= thisMonthKey();
    return data.period.is_current || data.period.end >= new Date().toISOString().slice(0, 10);
  }, [data, month]);

  const pick = (t: CeoTab) => {
    setTab(t);
    try { localStorage.setItem(TAB_STORAGE_KEY, t); } catch { /* per-viewer convenience only */ }
  };

  return (
    <section className="space-y-4" aria-label="CEO dashboard">
      <header className="rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-display text-base font-bold text-primary">Company at a glance</h2>
            <p className="text-xs text-muted">
              {data ? `${data.period.label} · as of ${fmtDay(data.as_of)}` : "Finance · Customer · Sales · People, by financial year"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PeriodSwitcher value={period} onChange={setPeriod} />
            <DateStepper month={month} period={period} atCurrent={atCurrent} onShift={(d) => setMonth((m) => shiftMonthKey(m, d))} onPick={setMonth} />
            <button type="button" className={`${btnSecondary} h-9 min-h-0 gap-1.5`} onClick={() => void openTargets()} title="Set the monthly, quarterly and yearly revenue targets">
              <Target className="h-4 w-4" aria-hidden /> Targets
            </button>
            <button type="button" className={ICON_BTN} onClick={retry} aria-label="Refresh" title="Refresh">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-subtle px-3 py-3 md:grid-cols-4" role="tablist" aria-label="CEO dashboard tabs">
          {TABS.map((t) => {
            const active = t.key === tab;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => pick(t.key)}
                className={`fx-lift relative flex items-center gap-3 overflow-hidden rounded-card border px-4 py-3 text-left transition-all duration-micro ${
                  active ? "border-brand-500 bg-surface-1 shadow-overlay" : "border-subtle bg-surface-2 hover:bg-surface-1"
                }`}
              >
                <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${t.accent}`} aria-hidden />
                <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-gradient-to-br text-white shadow-raised ${t.accent}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm font-bold ${active ? "text-primary" : "text-secondary"}`}>{t.label}</span>
                  <span className="block truncate text-[11px] text-muted">{t.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      </header>

      {error && <ErrorBox error={error} onRetry={retry} />}
      {!data && loading && !error && (
        <div className="grid gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="rounded-card border border-subtle bg-surface-1 p-4"><SkeletonText lines={2} /></div>)}</div>
      )}
      {data && data.tab === "finance" && <FinanceTab d={data.data as FinanceData} period={data.period} />}
      {data && data.tab === "customer" && <CustomerTab d={data.data as CustomerData} period={data.period} />}
      {data && data.tab === "sales" && <SalesTab d={data.data as SalesData} period={data.period} />}
      {data && data.tab === "people" && <PeopleTab d={data.data as PeopleData} period={data.period} />}
      {targetsOpen && targetsFor && (
        <RevenueTargetsModal month={targetsFor.month} targets={targetsFor.targets}
                             onClose={() => setTargetsOpen(false)}
                             onSaved={(msg) => { setTargetsOpen(false); showToast(msg); retry(); }} />
      )}
      {toast}
    </section>
  );
}
