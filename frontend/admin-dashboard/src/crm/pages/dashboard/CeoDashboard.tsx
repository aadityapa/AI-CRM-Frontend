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
import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, BadgeCheck, Briefcase, Building2, ChevronDown, ChevronRight, ReceiptText, RefreshCw, Target, Users, Wallet,
} from "lucide-react";
import { DESK_CHANGED_EVENT, crmGet, qs } from "../../api";
import { CrmLink } from "../../routerHooks";
import { fmtDateShort } from "../../../lib/datetime";
import { ErrorBox, SkeletonText, btnSecondary, useToast } from "../../components/ui";
import { RevenueTargetsModal } from "../../components/RevenueTargetsModal";
import type { TargetsForModal } from "../../components/RevenueTargetsModal";
import {
  CONTROL, DateStepper, Delta, FilteredBars, ICON_BTN, MiniStat, Panel, PeriodSwitcher, STATE_CHIP,
  Speedometer, Tile, inr, inrCompact, num, openBarLink, pct, shiftMonthKey, thisMonthKey,
} from "../../components/controlTower";
import type { PeriodKind, StateTone } from "../../components/controlTower";
import type { RevenueReportData } from "../reports/RevenueReport";
import { PaceCard } from "./HiringControlTower";
import type { HiringData } from "./HiringControlTower";
import { useDeskData } from "./DeskWidgets";
import { subTabVisible } from "../../useAccess";
import { useMeMaybe } from "../../CrmApp";
import { BillingTracker } from "./BillingTracker";
import { InvoiceApprovals } from "./InvoiceApprovals";
import { bucketLink, insightLink } from "./CeoInsightPage";
import { ScopeFilterBar, type FilterOption } from "../../components/ScopeFilterBar";
import {
  MONEY_GROUPS, MONEY_SERIES, moneyDrill, moneyRows, seriesParam,
  type MoneyKey, type MoneyRow,
} from "./moneySeries";
import { GlassToggle, MoneyStoryChart } from "./MoneyStoryChart";
import { SpotLine, StoryChart, STORY_THEMES, paletteColor, type StoryRow, type StorySeries } from "./StoryChart";
import {
  NetRevenuePanel, PredictedRevenuePanel, TdsCollectionPanel,
  type ForecastData, type NetData, type TdsData,
} from "./FinanceForecastPanels";

/* ---------- payload (services/executive_dashboard.py) ---------- */

/** `billing` (20 Oct 2026) is the Billing Tracker — its own endpoint
 *  (`/api/dashboard/billing`, Finance · Admin · CEO), not a `/ceo` tab. */
/** `approvals` (20 Nov 2026) — Admin / CEO sign off collected invoices (`/api/dashboard/invoice-approvals`). */
export type CeoTab = "finance" | "customer" | "sales" | "people" | "billing" | "approvals";
type DataTab = Exclude<CeoTab, "billing" | "approvals">;
const OWN_TABS: CeoTab[] = ["billing", "approvals"];

export type CeoPeriod = {
  kind: PeriodKind; key: string; label: string; short_label: string; fy_label: string;
  anchor_month: string; start: string; end: string; months: number; is_current: boolean;
  comparison_label: string; previous_key: string;
};

type MonthRow = { key: string; label: string; future: boolean };

export type FinanceData = {
  /** 8 Nov 2026 — false: people cost (CTC) is not tracked yet, so gross margin,
   *  net profit and the people-cost side of the cash flow are hidden. Absent = shown. */
  track_people_cost?: boolean;
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
  monthly: (MonthRow & MoneyRow & { billed: number; collected: number; cost: number; margin: number;
    /** 4 Nov 2026 — predicted (current month on), expenses, net revenue / profit. */
    predicted?: number | null; expenses?: number; net_revenue?: number; net_profit?: number;
    /** 4 Nov 2026 — received against the month's invoices, their share before GST. */
    received_ex?: number;
    /** 5 Nov 2026 — money by the day it arrived (mapped payments + still on account). */
    cash_in?: number; cash_mapped?: number; cash_on_account?: number;
    /** 20 Nov 2026 — of the mapped cash: paid this period's invoices / invoices of EARLIER periods. */
    cash_this_period?: number; cash_earlier?: number;
    /** 5 Nov 2026 — money mapped to this month's invoices AFTER the month ended. */
    mapping_changed_on?: string | null; mapped_later?: number })[];
  /** 5 Nov 2026 — received amounts still on account (not counted as Collected). */
  on_account?: OnAccount | null;
  /** 21 Nov 2026 — the period's invoices by the Invoices tabs' stage rule. */
  invoice_stages?: InvoiceStages | null;
  /** 6 Nov 2026 — the period's bank / TDS split (services/money_split). */
  money?: Partial<Record<MoneyKey | "expected_tds", number>> & { tds_rate_pct?: number;
    /** 20 Nov 2026 — what Total Due is made of (services/cash_month.due_breakdown). */
    due_tds_expected?: number; due_tds_booked?: number; on_account?: number; total_due_net?: number;
    cash_mapped?: number; cash_earlier?: number; cash_on_account?: number };
  net?: NetData | null;
  forecast?: ForecastData | null;
  tds?: TdsData | null;
  by_type: { label: string; billed: number; invoices: number; share_pct: number | null }[];
  top_customers: { customer_id: number; customer: string; billed: number; share_pct: number | null }[];
  concentration: { top1_share_pct: number | null; top3_share_pct: number | null; risk: boolean; top_customer: string | null };
  /** 24 Oct 2026 — the scope the figures were built for + every choice. */
  filters?: { customer_id: number | null; project_id: number | null; branch_id?: number | null;
    options: { customers: FilterOption[]; projects: FilterOption[]; branches?: FilterOption[] } };
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
  /** 8 Nov 2026 — see FinanceData.track_people_cost. */
  track_people_cost?: boolean;
  summary: {
    customers: number; customers_billing: number; billed: number; previous: number; change_pct: number | null;
    collected: number; outstanding: number; overdue: number; heads: number; heads_today: number;
    top1_share_pct: number | null; top3_share_pct: number | null; concentration_risk: boolean;
    top_customer: string | null;
  };
  donut: { label: string; value: number; customer_id: number | null }[];
  /** Month by month inside the period; `customers` = billed by top customer (+ Others). */
  monthly: (MonthRow & MoneyRow & { billed: number; collected: number; cost: number; customers: Record<string, number> })[];
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
  { key: "billing", label: "Billing Tracker", blurb: "Timesheet → Proforma → invoice → paid", icon: ReceiptText, accent: "from-rose-500 to-pink-600" },
  { key: "approvals", label: "Invoice approvals", blurb: "Collected + TDS in → your sign-off", icon: BadgeCheck, accent: "from-emerald-600 to-sky-600" },
];

const TAB_STORAGE_KEY = "crm.ceo.tab";

/** How many invoices wait for the Admin / CEO sign-off — the badge on the tab. */
function useApprovalsBadge(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const read = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      crmGet<unknown[]>("/api/dashboard/invoice-approvals?state=ready&limit=1")
        .then((r) => { if (alive) setCount(Number((r.meta as any)?.counts?.ready || 0)); })
        .catch(() => { /* the badge is a hint — the tab shows any error */ });
    };
    read();
    const timer = window.setInterval(read, 60_000);
    window.addEventListener(DESK_CHANGED_EVENT, read);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener(DESK_CHANGED_EVENT, read); };
  }, [enabled]);
  return count;
}

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

/** A chart row's customer id (null for "Others" and for rows that are not a customer). */
const rowCid = (r: Record<string, unknown>): number | null =>
  typeof r.customer_id === "number" && r.customer_id > 0 ? r.customer_id : null;

/** Which drill page a money series opens (29 Oct 2026 — every bar opens its data). */
const MONEY_METRIC: Record<string, string> = {
  billed: "billed", previous: "billed", share: "billed", invoices: "billed",
  collected: "collected",
  cost: "margin", people_cost: "margin", margin: "margin",
  outstanding: "outstanding", current: "outstanding", not_due: "outstanding",
  overdue: "overdue",
};
const moneyMetric = (series: string, fallback = "billed") => MONEY_METRIC[series] ?? fallback;

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

/* ---------------------------------------------- unmapped money + counting (5 Nov 2026) */

export type OnAccount = {
  amount: number; receipts: number; oldest: string | null; oldest_days: number | null;
  customers: { customer_id: number; customer: string; amount: number; receipts: number }[];
  customers_total?: number; out_of_scope?: boolean;
};

/** How "How the year unfolded" places money: by the invoice's work month (the
 *  rule the dashboard counts Collected by) or by the day the cash arrived. */
export type CountedBy = "work" | "cash";
export const COUNTED_BY_OPTIONS: { key: CountedBy; label: string }[] = [
  { key: "work", label: "Work month" }, { key: "cash", label: "Cash received month" },
];

/** PURE — the months whose Collected moved because money was mapped after the
 *  month ended (newest change first). */
export function mappingNotes(rows: { label: string; mapping_changed_on?: string | null; mapped_later?: number }[]) {
  return rows.filter((r) => !!r.mapping_changed_on)
    .map((r) => ({ label: r.label, on: r.mapping_changed_on as string, amount: r.mapped_later ?? 0 }))
    .sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0));
}

type StageCell = { count: number; amount: number };
export type InvoiceStages = {
  period_label: string; count: number; stages: Record<string, StageCell>;
  before: { from: string; to: string; count: number; stages: Record<string, StageCell> } | null;
};
/** The Invoices tab each stage opens (keys of `crm/lib/invoiceStages`). */
const STAGE_STRIP: { stage: string; label: string; tab: string; tone: string }[] = [
  { stage: "paid", label: "Paid", tab: "Paid", tone: "border-emerald-300 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300" },
  { stage: "partially_paid", label: "Partially paid", tab: "Partially_Paid", tone: "border-sky-300 text-sky-700 dark:border-sky-500/40 dark:text-sky-300" },
  { stage: "unpaid", label: "Unpaid", tab: "Unpaid", tone: "border-rose-300 text-rose-700 dark:border-rose-500/40 dark:text-rose-300" },
  { stage: "pending_einvoice", label: "Pending e-invoice", tab: "Customer_Approved", tone: "border-amber-300 text-amber-700 dark:border-amber-500/40 dark:text-amber-300" },
  { stage: "awaiting_customer", label: "Awaiting customer", tab: "Awaiting_Customer", tone: "border-subtle text-secondary" },
];

/** 21 Nov 2026 (CEO: "we paid 139 invoices and the dashboard did not move").
 *  The Invoices tabs count every invoice since the data start; this tab counts the
 *  invoices whose WORK month is in the period. One line ties the two together. */
export function InvoiceStagesStrip({ s }: { s: InvoiceStages | null | undefined }) {
  if (!s) return null;
  const b = s.before;
  return (
    <div className="rounded-card border border-subtle bg-surface-1 p-3 shadow-raised">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-secondary">
          {num(s.count)} invoices in {s.period_label}
        </span>
        {STAGE_STRIP.map((x) => {
          const c = s.stages[x.stage] || { count: 0, amount: 0 };
          if (!c.count && x.stage === "awaiting_customer") return null;
          return (
            <CrmLink key={x.stage} to={`invoices?tab=${x.tab}`}
                     className={`inline-flex items-center gap-1.5 rounded-pill border bg-surface-1 px-2.5 py-1 text-xs hover:shadow-raised ${x.tone}`}
                     title={`${num(c.count)} invoice(s) of ${s.period_label} · ${inrCompact(c.amount)} before GST`}>
              <span className="font-semibold">{x.label}</span>
              <span className="tnum">{num(c.count)}</span>
              <span className="tnum text-muted">· {inrCompact(c.amount)}</span>
            </CrmLink>
          );
        })}
      </div>
      {b && b.count > 0 && (
        <p className="mt-2 text-xs text-secondary">
          The Invoices tabs also list <span className="font-semibold text-primary">{num(b.count)} invoice{b.count === 1 ? "" : "s"}</span>{" "}
          for work from {fmtDateShort(b.from)} to {fmtDateShort(b.to)} ({num(b.stages.paid?.count ?? 0)} paid) — they belong to the
          period before this one, so paying them moves that period's figures, not these. Pick that period above to see them.
        </p>
      )}
    </div>
  );
}

/** The money in Received Amount that is not on any invoice yet — never counted
 *  as Collected until Finance maps it. */
function OnAccountPanel({ oa, collectedLink }: { oa: OnAccount | null | undefined; collectedLink: string }) {
  if (!oa || oa.out_of_scope) return null;
  const has = oa.amount > 0;
  const old = (oa.oldest_days ?? 0) > 30;
  return (
    <div className={`rounded-card border p-4 shadow-raised ${has ? "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10" : "border-subtle bg-surface-1"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-secondary">In Received Amount, not mapped yet</p>
          <p className={`mt-1 text-2xl font-bold tnum ${has ? "text-amber-700 dark:text-amber-300" : "text-primary"}`}>{inrCompact(oa.amount)}</p>
          <p className="mt-1 text-sm text-secondary">
            {has
              ? <>{num(oa.receipts)} received amount{oa.receipts === 1 ? "" : "s"} still on account
                  {oa.oldest && <> · oldest from {fmtDateShort(oa.oldest)}{oa.oldest_days != null && <span className={old ? "font-semibold text-danger" : ""}> ({num(oa.oldest_days)} days)</span>}</>}.
                  {" "}Not counted as Collected until Finance maps it to invoices.</>
              : "Every received amount is mapped to invoices — nothing waiting."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {has && <CrmLink to={collectedLink} className={btnSecondary}>See the list</CrmLink>}
          <CrmLink to="received-amounts" className={`${btnSecondary} ${has ? "!border-amber-400 !text-amber-800 dark:!text-amber-200" : ""}`}>Map in Received Amount</CrmLink>
        </div>
      </div>
      {has && oa.customers.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {oa.customers.map((c) => (
            <CrmLink key={c.customer_id} to={`customers/${c.customer_id}?tab=receipts`}
                     className="inline-flex items-center gap-1.5 rounded-pill border border-amber-300 bg-surface-1 px-2.5 py-1 text-xs hover:border-amber-500 dark:border-amber-500/40">
              <span className="font-medium text-primary">{c.customer}</span>
              <span className="tnum text-amber-700 dark:text-amber-300">{inrCompact(c.amount)}</span>
              <span className="text-muted">· {num(c.receipts)}</span>
            </CrmLink>
          ))}
          {(oa.customers_total ?? 0) > oa.customers.length && (
            <span className="self-center text-xs text-muted">+{num((oa.customers_total ?? 0) - oa.customers.length)} more customers</span>
          )}
        </div>
      )}
    </div>
  );
}

const ZOOM_LABEL: Record<PeriodKind, string> = { month: "Monthly", quarter: "Quarterly", fy: "Yearly" };
const ZOOM_OPTIONS = (["month", "quarter", "fy"] as PeriodKind[]).map((z) => ({ key: z, label: ZOOM_LABEL[z] }));
const ZOOM_ROWS: Record<PeriodKind, string> = { month: "Months", quarter: "Quarters", fy: "Years" };

/* ---------- story-chart series of the Customer / Sales / People tabs (8 Nov 2026) ---------- */

/** Open a bar's link (a bucket the server could not read gives none). */
const openLink = (link: string | null, e?: React.MouseEvent | null) => { if (link) openBarLink(link, e); };
const num0 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** Whole percent of part in whole; null when whole is 0. */
const shareOfPct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 100) : null);

/** 20 Nov 2026 — one line that ties the Cash view to the Work-month view:
 *  Mapped = paid this period's invoices (≈ Received Bank there) + paid EARLIER invoices;
 *  money still on account is in neither until Finance maps it. */
function CashReconcile({ tot, receivedBank, periodWord }: {
  tot: { cash_in: number; cash_mapped: number; cash_on_account: number; cash_this_period: number; cash_earlier: number };
  receivedBank: number | null; periodWord: string;
}) {
  if (tot.cash_in <= 0) return null;
  return (
    <div className="space-y-2">
      <p className="rounded-control border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
        <span className="font-semibold">How this ties to the Work month view:</span>{" "}
        Mapped {inrCompact(tot.cash_mapped)} = {inrCompact(tot.cash_this_period)} for this {periodWord}'s invoices
        {receivedBank != null && <> (Received Bank there: {inrCompact(receivedBank)})</>}
        {" "}+ {inrCompact(tot.cash_earlier)} for invoices from before this {periodWord} — those count in their own work month, not here.
      </p>
      {tot.cash_on_account > 0 && (
        <p className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <span className="font-semibold">{inrCompact(tot.cash_on_account)} is still on account.</span>{" "}
          It counts as Collected once Finance maps it to invoices in Received Amount — it then moves to the month of each invoice's work, and Total Due drops by the same amount.
        </p>
      )}
    </div>
  );
}

/* 8 Nov 2026 — the "Cash received month" view of How the year unfolded, in the same
   story-chart design as the work-month view (it was a plain bar panel). */
const CASH_SERIES: StorySeries[] = [
  // 20 Nov 2026 (user: "Mapped ₹3.80 Cr but Received ₹2.98 Cr — why?"): the mapped cash is split
  // into what paid THIS period's invoices (the Received figure of the work-month view) and what
  // paid invoices of EARLIER periods (it never shows on the work-month view).
  { key: "cash_this_period", label: "Paid this period's invoices", color: "#10b981", group: "cash", hint: "mapped to invoices whose work month is in this period — the Received figure on the Work month view" },
  { key: "cash_earlier", label: "Paid earlier invoices", color: "#a855f7", group: "cash", hint: "mapped to invoices whose work month is BEFORE this period starts — not part of this period's Received" },
  { key: "cash_on_account", label: "Still on account", color: "#f59e0b", group: "cash", hint: "money in Received Amount not mapped to any invoice yet — not Collected" },
  { key: "cash_in", label: "Cash received", color: "#22d3ee", group: "cash", line: true, hint: "everything that arrived that month, with GST (mapped + on account)" },
  { key: "revenue_inc", label: "Revenue (Inc Tax)", color: "#2563eb", group: "compare", hint: "the month's invoices with GST, by work month — cash carries GST too, so this is the fair comparison" },
];
const CASH_GROUPS = [{ key: "cash", label: "Cash in" }, { key: "compare", label: "Compare" }];
const CASH_PRESETS = [
  { key: "overview", label: "Overview", keys: ["cash_this_period", "cash_earlier", "cash_on_account", "cash_in"] },
  { key: "mapping", label: "Mapping", keys: ["cash_this_period", "cash_earlier", "cash_on_account"] },
  { key: "vsrevenue", label: "Cash vs revenue", keys: ["cash_in", "revenue_inc"] },
  { key: "all", label: "All", keys: CASH_SERIES.map((s) => s.key) },
];

const CUSTOMER_GROUPS = [...MONEY_GROUPS.filter((g) => g.key !== "forecast"), { key: "cost", label: "Cost & margin" }];
const CUSTOMER_TOTAL_PRESETS = [
  { key: "overview", label: "Overview", keys: ["revenue_ex", "received_ex", "due_ex"] },
  { key: "revenue", label: "Revenue", keys: ["revenue_ex", "revenue_inc"] },
  { key: "received", label: "Received", keys: ["revenue_ex", "received_ex", "received_bank", "received_tds"] },
  { key: "due", label: "Due", keys: ["due_ex", "due_bank", "due_tds", "total_due"] },
  { key: "profit", label: "Profit", keys: ["revenue_ex", "cost", "margin"] },
  { key: "all", label: "All", keys: [...MONEY_SERIES.filter((x) => x.key !== "predicted").map((x) => x.key), "cost", "margin"] },
];
/** 8 Nov 2026 — the same, with people cost switched off: no cost / margin anywhere. */
const CUSTOMER_GROUPS_NO_COST = CUSTOMER_GROUPS.filter((g) => g.key !== "cost");
const CUSTOMER_TOTAL_PRESETS_NO_COST = CUSTOMER_TOTAL_PRESETS
  .filter((p) => p.key !== "profit")
  .map((p) => ({ ...p, keys: p.keys.filter((k) => k !== "cost" && k !== "margin") }));

const SALES_SERIES: StorySeries[] = [
  { key: "positions_in", label: "Positions brought in", color: "#8b5cf6", group: "demand", hint: "positions on requirements created in the bucket" },
  { key: "onboardings", label: "Onboarded", color: "#10b981", group: "onboarded", hint: "candidates who joined" },
  { key: "internal", label: "Internal", color: "#14b8a6", group: "onboarded", hint: "redeployed from the bench or on Karnex rolls 30+ days before" },
  { key: "external", label: "External", color: "#0ea5e9", group: "onboarded", hint: "hired for the position" },
  { key: "unknown", label: "Unknown", color: "#94a3b8", group: "onboarded", hint: "no employee record to decide" },
];
const SALES_GROUPS = [{ key: "demand", label: "Demand" }, { key: "onboarded", label: "Onboarded" }];
const SALES_PRESETS = [
  { key: "overview", label: "Overview", keys: ["positions_in", "onboardings"] },
  { key: "mix", label: "Internal vs external", keys: ["internal", "external", "unknown"] },
  { key: "all", label: "All", keys: SALES_SERIES.map((x) => x.key) },
];

const PEOPLE_STORY_SERIES: StorySeries[] = [
  { key: "headcount", label: "Headcount", color: "#6366f1", group: "rolls", line: true, agg: "last", hint: "on the rolls at month end" },
  { key: "deployed", label: "Deployed", color: "#10b981", group: "rolls", agg: "last", hint: "on a customer project at month end" },
  { key: "bench", label: "On the bench", color: "#f59e0b", group: "rolls", agg: "last", hint: "on the rolls, not on a project" },
  { key: "joiners", label: "Joiners", color: "#0ea5e9", group: "movement", hint: "joined in the month" },
  { key: "exits", label: "Exits", color: "#ef4444", group: "movement", hint: "left in the month" },
];
const PEOPLE_GROUPS = [{ key: "rolls", label: "On the rolls" }, { key: "movement", label: "Movement" }];
const PEOPLE_PRESETS = [
  { key: "deployment", label: "Deployment", keys: ["headcount", "deployed", "bench"] },
  { key: "movement", label: "Joiners & exits", keys: ["joiners", "exits"] },
  { key: "all", label: "All", keys: PEOPLE_STORY_SERIES.map((x) => x.key) },
];

/* ====================================================================== Finance */

function FinanceTab({ d, period, showOnAccount = false }: { d: FinanceData; period: CeoPeriod; showOnAccount?: boolean }) {
  const rev = revenueLink(period);
  // 27 Oct 2026 — every tile opens its own drill-down page (same period, same scope).
  const drill = (metric: string, scope?: string) => insightLink(metric, period,
    { scope, customer_id: d.filters?.customer_id, project_id: d.filters?.project_id, branch_id: d.filters?.branch_id });
  const h = d.headline, t = d.targets, m = d.margin, c = d.collections;
  // 6 Nov 2026 — the bank / TDS split. Received = cash + TDS certificates, compared
  // with Revenue (Inc Tax) so both sides carry GST (the old rate put cash with GST
  // over billed before GST). An older server without `money` keeps the old figures.
  const mo = d.money;
  const revInc = mo?.revenue_inc ?? h.billed_incl_gst;
  const received = mo ? (mo.received_bank ?? 0) + (mo.received_tds ?? 0) : h.collected;
  const receivedPct = mo ? (revInc > 0 ? received / revInc * 100 : null) : h.collection_rate_pct;
  const totalDue = mo?.total_due ?? h.outstanding;
  const receivedEx = mo?.received_ex ?? null;
  const receivedExPct = receivedEx !== null && h.billed > 0 ? receivedEx / h.billed * 100 : null;
  const marginState = highGood(m.gross_margin_pct, 30, 15);
  // 8 Nov 2026 (user: "for now Gross margin — we do not track expense"): with people
  // cost switched off (Settings ▸ Organisation ▸ Billing) every cost / margin figure
  // is hidden; the tile becomes "Ready to bill".
  const showCost = d.track_people_cost !== false;
  const ready = d.pipeline.approved_uninvoiced;
  // At the FY zoom the target is the FY target; `month_*` is the SELECTED period's
  // figure at month / quarter zoom (the report's naming, kept as-is).
  const isFy = period.kind === "fy";
  // 27 Oct 2026: with a customer / project filter the billed figure is one
  // account; the target is the company's — no attainment, no gap.
  const scoped = !!t.scoped;
  const target = scoped ? null : isFy ? t.fy_target : t.month_target;
  const attainment = isFy ? t.fy_attainment_pct : t.month_attainment_pct;
  const gap = target === null ? null : Math.max(0, target - h.billed);
  const cash = d.cashflow;
  // Past + current months, plus the months to come that carry a prediction (4 Nov 2026).
  const monthly = moneyRows(d.monthly.filter((r) => !r.future || r.predicted != null));
  // 5 Nov 2026 — "Counted by": the invoice's work month (the dashboard's rule) or
  // the day the cash arrived (mapped payments + money still on account).
  const [countedBy, setCountedBy] = useState<CountedBy>("work");
  const hasCash = d.monthly.some((r) => r.cash_in != null);
  const byCash = countedBy === "cash" && hasCash;
  const cashRows = monthly.filter((r) => !r.future).map((r) => ({ ...r, cash_in: r.cash_in ?? 0,
    cash_mapped: r.cash_mapped ?? 0, cash_on_account: r.cash_on_account ?? 0,
    // An older server sends no split — all mapped cash reads as this period's.
    cash_this_period: r.cash_this_period ?? r.cash_mapped ?? 0, cash_earlier: r.cash_earlier ?? 0,
    revenue_inc: r.revenue_inc ?? r.billed ?? 0 }));
  const cashTot = cashRows.reduce((a, r) => ({ cash_in: a.cash_in + num0(r.cash_in), cash_mapped: a.cash_mapped + num0(r.cash_mapped),
    cash_on_account: a.cash_on_account + num0(r.cash_on_account), cash_this_period: a.cash_this_period + num0(r.cash_this_period),
    cash_earlier: a.cash_earlier + num0(r.cash_earlier), revenue_inc: a.revenue_inc + num0(r.revenue_inc) }),
    { cash_in: 0, cash_mapped: 0, cash_on_account: 0, cash_this_period: 0, cash_earlier: 0, revenue_inc: 0 });
  // 20 Nov 2026 — Total Due carries invoices that money already in Received Amount will
  // settle once Finance maps it; and Due TDS is partly an estimate (no TDS booked yet).
  const onAccountNow = mo?.on_account ?? 0;
  const dueNet = mo?.total_due_net ?? null;
  const tdsExpected = mo?.due_tds_expected ?? 0;
  const cashMonths = cashRows.filter((r) => num0(r.cash_in) > 0).length;
  const changed = mappingNotes(d.monthly.filter((r) => !r.future));
  const scopeIds = { customer_id: d.filters?.customer_id, project_id: d.filters?.project_id, branch_id: d.filters?.branch_id };
  // 29 Oct 2026 — every bar opens the drill page of its series, zoomed to that bar.
  const monthBar = (r: Record<string, unknown>, s: string) => bucketLink(moneyMetric(s), r.key, scopeIds);
  const customerBar = (r: Record<string, unknown>, s: string) =>
    insightLink(moneyMetric(s), period, { customer_id: rowCid(r) ?? d.filters?.customer_id, project_id: d.filters?.project_id, branch_id: d.filters?.branch_id });

  return (
    <div className="space-y-4">
      <Alerts alerts={d.alerts} to={rev} where="Reports ▸ Revenue" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Tile label="Revenue (Ex. Tax)" value={inrCompact(h.billed)} to={drill("billed")} sub={`Inc Tax ${inrCompact(revInc)} · ${num(h.invoices)} invoices`}
              foot={h.comparison_partial
                ? <span className="text-[11px] text-muted" title="The previous period starts before the month Orbit has data from (Settings ▸ Billing ▸ Data starts from), so a % change would compare a full period with a few months.">no like-for-like comparison yet</span>
                : <><Delta value={h.billed_mom_pct} label={period.comparison_label} />{!h.yoy_same_as_previous && <Delta value={h.billed_yoy_pct} label="YoY" />}</>} />
        {/* 20 Nov 2026 (CEO ask) — Received on Revenue (Ex. Tax)'s own basis: a paid invoice
            counts its whole value before GST, a partly paid one its share; with GST under it. */}
        <Tile label={receivedEx !== null ? "Received (Ex. Tax)" : "Received (Bank + TDS)"}
              value={inrCompact(receivedEx ?? received)} tone="success" to={drill("collected")}
              sub={receivedEx !== null
                ? `${pct(receivedExPct, 0)} of Revenue (Ex. Tax) · with GST ${inrCompact(received)}`
                : mo ? `${pct(receivedPct, 0)} of Inc Tax · Bank ${inrCompact(mo.received_bank ?? 0)} · TDS ${inrCompact(mo.received_tds ?? 0)}` : `${pct(receivedPct, 0)} of billed`}
              foot={h.comparison_partial ? undefined : <Delta value={h.collected_mom_pct} label={period.comparison_label} />} />
        <Tile label="Total Due" value={inrCompact(totalDue)} tone={totalDue > 0 ? "warning" : "neutral"} to={drill("outstanding")}
              sub={mo ? `${mo.due_ex != null ? `Ex. Tax ${inrCompact(mo.due_ex)} · ` : ""}Bank ${inrCompact(mo.due_bank ?? 0)} · TDS ${inrCompact(mo.due_tds ?? 0)}${tdsExpected > 0 ? ` (${inrCompact(tdsExpected)} expected)` : ""}` : `${num(h.open_invoices)} open invoices`}
              foot={mo ? (onAccountNow > 0 && dueNet !== null ? (
                <span className="text-[11px] font-semibold text-warning"
                  title={`${inrCompact(onAccountNow)} is already in Received Amount but not mapped to any invoice. Once Finance maps it, Total Due drops by up to that much. Expected TDS = ${mo.tds_rate_pct ?? 10}% assumed on open invoices with no TDS booked yet.`}>
                  {inrCompact(onAccountNow)} received, not mapped · really owed ≈ {inrCompact(dueNet)}</span>
              ) : <span className="text-[11px] text-muted" title="Every open invoice up to the end of the period, including earlier years">all open to date {inrCompact(h.outstanding)}</span>) : undefined} />
        <Tile label="Overdue" value={inrCompact(d.ageing.overdue_total)} tone={d.ageing.overdue_total > 0 ? "danger" : "success"} to={drill("overdue")}
              sub={d.ageing.overdue_90_plus > 0 ? `${inrCompact(d.ageing.overdue_90_plus)} past 90 days` : "nothing past 90 days"} />
        {showCost ? (
          <Tile label="Gross margin" value={pct(m.gross_margin_pct, 0)} tone={marginState === "ok" ? "success" : marginState === "warn" ? "warning" : "danger"} to={drill("margin")}
                sub={`${inrCompact(m.gross_margin)} on ${inrCompact(m.cost)} people cost`}
                foot={m.heads_without_ctc ? <span className="text-[11px] font-semibold text-warning">{num(m.heads_without_ctc)} heads without a CTC — cost understated</span> : undefined} />
        ) : (
          <Tile label="Ready to bill" value={inrCompact(ready?.amount ?? 0)} tone={(ready?.amount ?? 0) > 0 ? "warning" : "success"} to="timesheets?tab=all"
                sub={(ready?.count ?? 0) > 0 ? `${num(ready?.count ?? 0)} approved timesheet${ready?.count === 1 ? "" : "s"} not yet invoiced` : "every approved timesheet is invoiced"} />
        )}
        <Tile label={`${isFy ? "FY" : "Period"} target`} value={target === null ? "—" : pct(attainment, 0)}
              tone={attainmentState(attainment) === "ok" ? "success" : attainmentState(attainment) === "warn" ? "warning" : "neutral"}
              to={drill("target")} sub={scoped ? "company-wide — clear the customer filter to compare"
                : target === null ? "no target set — Reports ▸ Revenue ▸ Targets"
                : `of ${inrCompact(target)} · ${gap && gap > 0 ? `${inrCompact(gap)} to go` : "reached"}`}
              foot={!scoped && target !== null && t.fy_projection != null
                ? <span className="text-[11px] text-muted" title="Billed to date + the trailing 3-month average × the months left">FY projection {inrCompact(t.fy_projection)}</span>
                : undefined} />
        <Tile label="DSO" value={c.dso_days === null ? "—" : `${num(c.dso_days)} d`} tone={lowGood(c.dso_days, 45, 60) === "ok" ? "success" : lowGood(c.dso_days, 45, 60) === "warn" ? "warning" : "danger"} to={drill("dso")}
              sub={c.avg_days_to_pay === null ? "no receipts in the period" : `paid ${num(c.avg_days_to_pay)} days after the invoice date on average`} />
        <Tile label="PO cover" value={d.pipeline.po_cover_months === null ? "—" : `${d.pipeline.po_cover_months} mo`} to={drill("po")}
              tone={lowGood(d.pipeline.po_cover_months === null ? null : -d.pipeline.po_cover_months, -2, -1) === "ok" ? "success" : "warning"}
              sub={`${inrCompact(d.pipeline.active_po_balance)} active PO balance`}
              foot={d.pipeline.cover_basis ? <span className="text-[11px] text-muted"
                title={d.pipeline.cover_basis === "team" ? "PO balance ÷ the monthly billing of everyone deployed today" : "No team on record — PO balance ÷ the last 3 months' invoices"}>
                {d.pipeline.cover_basis === "team" ? `team bills ${inrCompact(d.pipeline.monthly_burn ?? 0)} / month` : `at ${inrCompact(d.pipeline.avg_monthly_billed ?? 0)} / month billed`}</span> : undefined} />
      </div>

      {/* 21 Nov 2026 — the period's invoices by stage, tied to the Invoices tabs. */}
      <InvoiceStagesStrip s={d.invoice_stages} />

      {/* 0 · Money received but not on any invoice yet (5 Nov 2026) — not in Collected. */}
      {showOnAccount && <OnAccountPanel oa={d.on_account} collectedLink={drill("collected")} />}

      {/* 1 · How the year unfolded — the CEO's first question, so the first chart.
          7 Nov 2026: the interactive MoneyStoryChart; a month click opens the Billed page
          carrying the ticks chosen here (`series`), the month (`fmonth`) and the bar (`bar`). */}
      {byCash ? (
        <StoryChart rows={cashRows as unknown as StoryRow[]} series={CASH_SERIES} groups={CASH_GROUPS} presets={CASH_PRESETS}
          theme="finance" storageKey="crm.ceo.cash" todayKey={thisMonthKey()} format={inrCompact} leadKey="cash_in"
          stripKeys={["cash_mapped", "cash_on_account"]}
          title={`How ${period.kind === "fy" ? "the year" : "the period"} unfolded`}
          hint="Cash by the day it arrived, with GST · Mapped = recorded against invoices · On account = in Received Amount, not on an invoice yet · Billed stays by work month"
          headerExtra={<GlassToggle value={countedBy} options={COUNTED_BY_OPTIONS} onChange={setCountedBy} label="Counted by" />}
          stats={[
            { label: "Cash received", value: inrCompact(cashTot.cash_in), sub: `${num(cashMonths)} month${cashMonths === 1 ? "" : "s"} with money in`, dot: "#22d3ee" },
            { label: "Mapped to invoices", value: inrCompact(cashTot.cash_mapped), sub: `${pct(shareOfPct(cashTot.cash_mapped, cashTot.cash_in), 0)} of cash received`, dot: "#10b981",
              ring: shareOfPct(cashTot.cash_mapped, cashTot.cash_in) },
            { label: "Paid earlier invoices", value: inrCompact(cashTot.cash_earlier), sub: cashTot.cash_earlier > 0 ? "invoices from before this period" : "all for this period's invoices", dot: "#a855f7" },
            { label: "Still on account", value: inrCompact(cashTot.cash_on_account), sub: cashTot.cash_on_account > 0 ? "not Collected until Finance maps it" : "everything is mapped", dot: "#f59e0b" },
          ]}
          ring={(r) => ({ pct: shareOfPct(num0(r.cash_mapped), num0(r.cash_in)), color: "#10b981" })}
          spotlightSub={(r) => (num0(r.cash_in) > 0 ? "of the cash that arrived is on an invoice" : "no money arrived this month")}
          spotlightExtra={(r) => (
            <>
              <SpotLine label="Paid this period's invoices" value={inrCompact(num0(r.cash_this_period))} />
              <SpotLine label="Paid earlier invoices" value={inrCompact(num0(r.cash_earlier))} />
              <SpotLine label="Revenue (Inc Tax, work month)" value={inrCompact(num0(r.revenue_inc))} />
            </>
          )}
          onOpen={(row, s, _ticked, e) => openLink(monthBar(row, s === "revenue_inc" ? "billed" : "collected"), e)}
          openLabel={(row) => `Open the money received in ${row.label}`}
          footer={<CashReconcile tot={cashTot} receivedBank={mo?.received_bank ?? null} periodWord={period.kind === "fy" ? "FY" : "period"} />} />
      ) : (
        <MoneyStoryChart rows={monthly} storageKey="crm.ceo.money" todayKey={thisMonthKey()}
          title={`How ${period.kind === "fy" ? "the year" : "the period"} unfolded`}
          hint="Every figure by the invoice's work month · Bank = cash, TDS = what the customer withholds · Predicted = the deployed team × the rate in force that month"
          headerExtra={hasCash ? <GlassToggle value={countedBy} options={COUNTED_BY_OPTIONS} onChange={setCountedBy} label="Counted by" /> : undefined}
          onOpen={(row, s, ticked, e) => openBarLink(insightLink("billed", period, {
            ...scopeIds, fmonth: row.key, series: seriesParam(ticked), bar: s }), e)}
          openLabel={(row) => (row.future ? `Open the Billed page at ${row.label}` : `Open the invoices of ${row.label}`)}
          footer={changed.length > 0 || onAccountNow > 0 ? (<div className="space-y-2">
          {onAccountNow > 0 && (
            <p className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <span className="font-semibold">{inrCompact(onAccountNow)} is already received but not mapped to any invoice.</span>{" "}
              Received and Due here count it only once Finance maps it in Received Amount — Total Due {inrCompact(totalDue)} is really ≈ {inrCompact(dueNet ?? totalDue)}.
              {tdsExpected > 0 && <> Due TDS includes {inrCompact(tdsExpected)} expected at {mo?.tds_rate_pct ?? 10}% on invoices with no TDS booked yet.</>}
            </p>
          )}
          {changed.length > 0 && (
            <p className="rounded-control border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
              <span className="font-semibold">Collected changed after the month closed:</span>{" "}
              {changed.slice(0, 4).map((c, i) => (
                <span key={c.label}>{i > 0 && " · "}{c.label} — {inrCompact(c.amount)} mapped on {fmtDateShort(c.on)}</span>
              ))}
              {changed.length > 4 && <> · +{changed.length - 4} more</>}
              . Money mapped later moves into the month of its invoice's work.
            </p>
          )}
          </div>) : undefined} />
      )}

      {/* 25 Nov 2026 (user ask): the three dials — period target · collection rate ·
          gross margin / overdue share — are gone from this tab; the same figures are
          the Target, Received, Total Due, Overdue and Gross margin / Ready to bill tiles. */}
      {/* 2b · What is coming (4 Nov 2026): predicted revenue, net revenue, TDS. */}
      <PredictedRevenuePanel f={d.forecast} />
      <div className="grid gap-4 xl:grid-cols-2">
        <NetRevenuePanel net={d.net} monthly={d.monthly} showCost={showCost} />
        <TdsCollectionPanel tds={d.tds} />
      </div>

      {/* 3 · Where the money is — four bar charts, each with its own ticks. */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Who we bill" hint={d.concentration.risk ? `${d.concentration.top_customer} is ${pct(d.concentration.top1_share_pct, 0)} of billing — concentration risk` : `top 3 = ${pct(d.concentration.top3_share_pct, 0)} of billing`}
               action={d.concentration.risk ? <StateChip state="warn">Concentrated</StateChip> : undefined}>
          {d.top_customers.length ? (
            <FilteredBars rowFilter rowLabel="Customers" format={inrCompact} height={220} barLink={customerBar}
                          data={d.top_customers.map((r) => ({ label: r.customer, customer_id: r.customer_id, billed: r.billed, share: r.share_pct ?? 0 }))}
                          series={[{ key: "billed", label: "Billed", color: 0 }, { key: "share", label: "Share %", color: 3, defaultOff: true }]} />
          ) : <p className="text-sm text-muted">No billing in this period.</p>}
        </Panel>

        <Panel title="Cash flow — next 3 months"
               hint={showCost ? `as of ${fmtDay(cash.as_of)} · what lands each month vs the people cost that month` : `as of ${fmtDay(cash.as_of)} · what should land each month from open invoices`}
               action={showCost ? <StateChip state={cash.covers_cost ? "ok" : "bad"}>{cash.covers_cost ? "Covers cost" : "Short"}</StateChip> : undefined}>
          <FilteredBars rowFilter rowLabel="Months" format={inrCompact} height={200}
                        barLink={(_r, s) => (s === "people_cost" ? insightLink("margin", period, scopeIds) : insightLink("outstanding", period, scopeIds))}
                        clickHint={showCost ? "Click a bar: money due → the open invoices · people cost → who it is for" : "Click a bar: the open invoices behind it"}
                        data={cash.months.map((r) => ({ label: r.label, expected: r.expected, at_pace: r.expected_at_pace, people_cost: r.people_cost, net: r.net_at_pace }))}
                        series={[{ key: "at_pace", label: "Expected in (our pace)", color: 2 }, { key: "expected", label: "On agreed terms", color: 1, defaultOff: showCost },
                                 ...(showCost ? [{ key: "people_cost", label: "People cost", color: 6 }, { key: "net", label: "Net", color: 0, defaultOff: true }] : [])]} />
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <MiniStat k="Expected in" v={inrCompact(cash.expected_total_at_pace)} tone="ok" hint={`${inrCompact(cash.expected_total)} on agreed terms`} />
            {showCost ? <>
              <MiniStat k="People cost out" v={inrCompact(cash.people_cost_total)} />
              <MiniStat k="Net" v={inrCompact(cash.net_total_at_pace)} tone={cash.net_total_at_pace >= 0 ? "ok" : "bad"} />
            </> : <>
              <MiniStat k="On agreed terms" v={inrCompact(cash.expected_total)} />
              <MiniStat k="Days paid late" v={`${num(cash.slip_days ?? 0)} d`} hint="average days past due of last year's receipts" />
            </>}
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
                          barLink={(r) => insightLink(/not|current|0\s*[–-]\s*0/i.test(String(r.label)) ? "outstanding" : "overdue", period, scopeIds)}
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
                          barLink={() => insightLink("billed", period, scopeIds)}
                          data={d.by_type.map((r) => ({ label: r.label, billed: r.billed, share: r.share_pct ?? 0, invoices: r.invoices }))}
                          series={[{ key: "billed", label: "Billed", color: 0 }, { key: "share", label: "Share %", color: 3, defaultOff: true }, { key: "invoices", label: "Invoices", color: 7, defaultOff: true }]} />
          ) : <p className="text-sm text-muted">No billing in this period.</p>}
        </Panel>
      </div>
    </div>
  );
}

/* ====================================================================== Customer */

function EmployeeRows({ rows, showCost = true }: { rows: EmployeeRow[]; showCost?: boolean }) {
  if (!rows.length) return <tr><td colSpan={showCost ? 8 : 6} className="px-3 py-2 text-xs text-muted">No one was deployed on this project in the period.</td></tr>;
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
          {showCost && <td className={tdCls}>{inr(e.cost)}{!e.has_ctc && <span className="ml-1 text-xs text-warning" title="No CTC on the employee record — cost understated">?</span>}</td>}
          {showCost && <td className={`${tdCls} ${e.margin < 0 ? "text-danger" : ""}`}>{inr(e.margin)}</td>}
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

function ProjectRows({ rows, open, toggle, showCost = true }: { rows: ProjectRow[]; open: Set<string>; toggle: (k: string) => void; showCost?: boolean }) {
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
              {showCost && <td className={tdCls}>{inr(p.cost)}</td>}
              {showCost && <td className={`${tdCls} ${p.margin < 0 ? "text-danger" : ""}`}>{inr(p.margin)} <span className="text-xs text-muted">{pct(p.margin_pct, 0)}</span></td>}
              <td className={tdCls}>{num(p.heads)} <span className="text-xs text-muted">({p.heads_today} live)</span></td>
              <td className={tdCls}><span className="text-xs text-secondary">{p.internal} int · {p.external} ext</span></td>
              <td className={tdCls}>{p.outstanding > 0 ? inr(p.outstanding) : <span className="text-xs text-muted">—</span>}</td>
            </tr>
            {isOpen && (
              <>
                <EmployeeRows rows={p.employees} showCost={showCost} />
                {p.unlinked_billed > 0 && (
                  <tr className="bg-surface-2"><td colSpan={showCost ? 8 : 6} className="px-3 py-1.5 pl-16 text-xs text-secondary">{inr(p.unlinked_billed)} billed on invoices not linked to a timesheet (manual invoices) — counted on the project, not on a person.</td></tr>
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
  const drill = (metric: string, scope?: string) => insightLink(metric, period, { scope });
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
  // 6 Nov 2026 — received (bank + TDS) over revenue Inc Tax, both with GST, from the
  // month rows' money split; an older server falls back to cash ÷ billed.
  const moneyIn = d.monthly.reduce((a, r) => a + (r.received_bank ?? 0) + (r.received_tds ?? 0), 0);
  const moneyInc = d.monthly.reduce((a, r) => a + (r.revenue_inc ?? 0), 0);
  const collectionPct = moneyInc > 0 ? (moneyIn / moneyInc) * 100 : s.billed ? (s.collected / s.billed) * 100 : null;
  const collectionState = highGood(collectionPct, 90, 75);
  const concState: StateTone = s.top1_share_pct === null ? "none" : s.top1_share_pct >= 50 ? "bad" : s.top1_share_pct >= 35 ? "warn" : "ok";
  // 8 Nov 2026 — people cost switched off (Settings ▸ Billing): no cost / margin.
  const showCost = d.track_people_cost !== false;
  const overdueSharePct = s.outstanding > 0 ? Math.min(100, (s.overdue / s.outstanding) * 100) : null;
  const overdueShareState: StateTone = overdueSharePct === null ? "none" : lowGood(overdueSharePct, 20, 40);
  const totalCost = d.customers.reduce((a, c) => a + c.cost, 0);
  const marginPct = s.billed ? ((s.billed - totalCost) / s.billed) * 100 : null;
  const marginState = highGood(marginPct, 30, 15);
  const lossMaking = d.customers.filter((c) => c.billed > 0 && c.margin < 0);
  const growing = d.customers.filter((c) => c.change_pct !== null && c.change_pct > 0).length;
  const shrinking = d.customers.filter((c) => c.change_pct !== null && c.change_pct < 0).length;

  // Charts: the period month by month with the top customers as series, then
  // four cuts of the customer book — billing, receivables, PO runway, people.
  // Grouped columns like the Finance tab (28 Oct 2026, CEO ask): the totals view is
  // Finance's own "How the year unfolded"; "By customer" puts one column per customer
  // side by side — nothing is stacked on any tab.
  const [unfoldBy, setUnfoldBy] = useState<"totals" | "customers">("totals");
  const pastMonths = d.monthly.filter((r) => !r.future);
  const monthly = unfoldBy === "totals"
    ? moneyRows(pastMonths).map((r) => ({ ...r, cost: r.cost, margin: r.billed - r.cost, customers: undefined }))
    : pastMonths.map((r) => ({ label: r.label, key: r.key, ...r.customers }));
  // 29 Oct 2026 — every bar opens its data: a customer-named series narrows the drill
  // page to that customer (looked up by name; "Others" opens everyone).
  const idByName = useMemo(() => new Map(d.customers.map((c) => [c.customer, c.customer_id])), [d.customers]);
  const unfoldBar = (r: Record<string, unknown>, s: string) => (unfoldBy === "totals"
    ? bucketLink(s === "cost" || s === "margin" ? moneyMetric(s) : moneyDrill(s), r.key)
    : bucketLink("billed", r.key, { customer_id: idByName.get(s) ?? null }));
  const deployedBar = (r: Record<string, unknown>, s: string) =>
    bucketLink("deployed", r.key, { customer_id: groupBy === "customers" ? idByName.get(s) ?? null : null });
  const customerBar = (metricOf: (s: string) => string, scopeOf?: (s: string) => string | undefined) =>
    (r: Record<string, unknown>, s: string) => insightLink(metricOf(s), period, { customer_id: rowCid(r), scope: scopeOf?.(s) });
  // 8 Nov 2026 — the story chart's series, presets and headline figures.
  const custNames = d.monthly_series;
  const unfoldSeries: StorySeries[] = unfoldBy === "totals"
    ? [...MONEY_SERIES.filter((x) => x.key !== "predicted").map((x) => ({ key: x.key, label: x.label, color: x.color, group: x.group, hint: x.hint })),
       ...(showCost ? [
         { key: "cost", label: "People cost", color: "#64748b", group: "cost", hint: "CTC ÷ 12 of the people deployed that month" },
         { key: "margin", label: "Margin", color: "#14b8a6", group: "cost", hint: "Revenue (Ex. Tax) − people cost" }] : [])]
    : custNames.map((name, i) => ({ key: name, label: name, color: paletteColor(name, i) }));
  const named = custNames.filter((x) => !/^Others/i.test(x));
  const unfoldPresets = unfoldBy === "totals" ? (showCost ? CUSTOMER_TOTAL_PRESETS : CUSTOMER_TOTAL_PRESETS_NO_COST) : [
    { key: "top3", label: "Top 3", keys: named.slice(0, 3) },
    { key: "top5", label: "Top 5", keys: named.slice(0, 5) },
    { key: "all", label: "All", keys: custNames },
  ];
  const unfoldRows = monthly as unknown as StoryRow[];
  const sumOf = (k: string) => unfoldRows.reduce((a, r) => a + num0(r[k]), 0);
  const unfoldStats = unfoldBy === "totals" ? (() => {
    const ex = sumOf("revenue_ex"), inc = sumOf("revenue_inc"), recv = sumOf("received_bank") + sumOf("received_tds"), mg = sumOf("margin");
    const recvEx = sumOf("received_ex");
    // 20 Nov 2026 — Received / Due on Revenue (Ex. Tax)'s own basis (they add up to it).
    return [
      { label: "Revenue (Ex. Tax)", value: inrCompact(ex), sub: `Inc Tax ${inrCompact(inc)}`, dot: "#7dd3fc" },
      { label: "Received (Ex. Tax)", value: inrCompact(recvEx), sub: ex > 0 ? `${pct(shareOfPct(recvEx, ex), 0)} of Ex. Tax · with GST ${inrCompact(recv)}` : "nothing billed yet", dot: "#6ee7b7", ring: shareOfPct(recvEx, ex) },
      { label: "Due (Ex. Tax)", value: inrCompact(sumOf("due_ex")), sub: `Total Due ${inrCompact(sumOf("total_due"))} · Bank ${inrCompact(sumOf("due_bank"))} · TDS ${inrCompact(sumOf("due_tds"))}`, dot: "#fca5a5" },
      showCost
        ? { label: "Margin", value: inrCompact(mg), sub: `${pct(shareOfPct(mg, ex), 0)} after ${inrCompact(sumOf("cost"))} people cost`, dot: "#5eead4" }
        : { label: "Overdue", value: inrCompact(s.overdue), sub: s.overdue > 0 ? `${pct(overdueSharePct, 0)} of what is owed, past the due date` : "nothing past the due date", dot: "#fca5a5" },
    ];
  })() : (() => {
    const byName = custNames.map((name) => ({ name, total: sumOf(name) })).sort((a, b) => b.total - a.total);
    const all = byName.reduce((a, x) => a + x.total, 0);
    const top = byName.find((x) => !/^Others/i.test(x.name));
    const last = [...unfoldRows].reverse().find((r) => custNames.some((k) => num0(r[k]) > 0));
    return [
      { label: "Revenue (Ex. Tax)", value: inrCompact(all), sub: `${num(named.length)} customers named`, dot: "#7dd3fc" },
      { label: "Top customer", value: top ? top.name : "—", sub: top ? `${inrCompact(top.total)} · ${pct(shareOfPct(top.total, all), 0)} of revenue` : "no billing", dot: "#fde68a", ring: top ? shareOfPct(top.total, all) : null },
      { label: "Top 3 share", value: pct(shareOfPct(byName.filter((x) => !/^Others/i.test(x.name)).slice(0, 3).reduce((a, x) => a + x.total, 0), all), 0), sub: "of the period's revenue", dot: "#c4b5fd" },
      { label: "Latest month", value: last ? inrCompact(custNames.reduce((a, k) => a + num0(last[k]), 0)) : "—", sub: last ? last.label : "no billing", dot: "#6ee7b7" },
    ];
  })();
  const active = d.customers.filter((c) => c.billed > 0 || c.previous > 0 || c.outstanding > 0 || c.heads_today > 0);
  const billing = active.map((c) => ({ label: c.customer, customer_id: c.customer_id, billed: c.billed, previous: c.previous, collected: c.collected,
    ...(showCost ? { cost: c.cost, margin: c.margin } : {}) }));
  const receivables = active.filter((c) => c.outstanding > 0).map((c) => ({ label: c.customer, customer_id: c.customer_id, outstanding: c.outstanding, overdue: c.overdue, current: c.outstanding - c.overdue }));
  const runway = active.filter((c) => c.po_balance > 0 || c.monthly_burn > 0).map((c) => ({ label: c.customer, customer_id: c.customer_id, po_balance: c.po_balance, burn: c.monthly_burn, cover: c.po_cover_months ?? 0 }));
  const people = active.filter((c) => c.heads > 0 || c.open_positions > 0).map((c) => ({ label: c.customer, customer_id: c.customer_id, deployed: c.heads_today, internal: c.internal, external: c.external, open: c.open_positions }));
  const runwayShort = runway.filter((r) => r.burn > 0 && r.cover < 2).length;
  // Deployed heads over time — rows are buckets, series are customers OR locations (one toggle).
  const deployedRows = d.deployed_trend[zoom].filter((r) => !r.future).map((r) => ({ label: r.label, key: r.key, total: r.total, ...r[groupBy] }));
  const deployedNames = d.deployed_series[groupBy];
  const deployedSeries: StorySeries[] = [
    { key: "total", label: "Total deployed", color: "#0ea5e9", line: true, agg: "last", hint: "everyone deployed at the end of the bucket" },
    ...deployedNames.map((name, i) => ({ key: name, label: name, color: paletteColor(name, i), agg: "last" as const })),
  ];
  const deployedPresets = [
    { key: "top4", label: "Top 4", keys: ["total", ...deployedNames.filter((x) => !/^Others/i.test(x)).slice(0, 4)] },
    { key: "all", label: "All", keys: ["total", ...deployedNames] },
    { key: "total", label: "Total only", keys: ["total"] },
  ];
  const deployedStats = (() => {
    const rowsD = deployedRows as unknown as StoryRow[];
    const lastR = rowsD[rowsD.length - 1], firstR = rowsD[0];
    const peak = rowsD.reduce<StoryRow | null>((best, r) => (!best || num0(r.total) > num0(best.total) ? r : best), null);
    const live = lastR ? deployedNames.filter((k) => num0(lastR[k]) > 0).length : 0;
    const change = lastR && firstR ? num0(lastR.total) - num0(firstR.total) : 0;
    return [
      { label: "Deployed now", value: num(num0(lastR?.total)), sub: lastR ? `end of ${lastR.label}` : "nobody", dot: "#7dd3fc" },
      { label: "Peak", value: num(num0(peak?.total)), sub: peak ? peak.label : "—", dot: "#fde68a" },
      { label: groupBy === "customers" ? "Customers" : "Locations", value: num(live), sub: "with people on site now", dot: "#6ee7b7" },
      { label: "Change in the window", value: `${change >= 0 ? "+" : ""}${num(change)}`, sub: firstR ? `since ${firstR.label}` : "—", dot: change >= 0 ? "#86efac" : "#fca5a5" },
    ];
  })();

  return (
    <div className="space-y-4">
      <Alerts alerts={d.alerts} to="customers" where="Customers" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Tile label="Customers billing" value={num(s.customers_billing)} to={drill("customers")} sub={`of ${num(s.customers)} with activity`} />
        <Tile label="Revenue (Ex. Tax)" value={inrCompact(s.billed)} to={drill("billed")} foot={<Delta value={s.change_pct} label={period.comparison_label} />} />
        <Tile label="Received Bank" value={inrCompact(s.collected)} tone="success" to={drill("collected")} sub={`${pct(collectionPct, 0)} received of Inc Tax`} />
        <Tile label="Outstanding" value={inrCompact(s.outstanding)} tone={s.outstanding > 0 ? "warning" : "neutral"} to={drill("outstanding")} />
        <Tile label="Overdue" value={inrCompact(s.overdue)} tone={s.overdue > 0 ? "danger" : "success"} to={drill("overdue")} />
        <Tile label="Heads in period" value={num(s.heads)} to={drill("deployed")} sub={`${num(s.heads_today)} deployed today`} />
        <Tile label="Growing / shrinking" value={`${num(growing)} / ${num(shrinking)}`} tone={shrinking > growing ? "warning" : "success"} to={drill("customers", shrinking > growing ? "shrinking" : "growing")} sub={`accounts ${period.comparison_label}`} />
        <Tile label="Top customer" value={pct(s.top1_share_pct, 0)} tone={s.concentration_risk ? "warning" : "neutral"} sub={s.top_customer ?? "—"} to={drill("customers")} />
      </div>

      {/* 1 · How the period unfolded — 8 Nov 2026: the Finance tab's story chart, in the
          Customer tab's colours. Totals = the money words + people cost + margin; By
          customer = one column per top customer. A column opens its drill page. */}
      <StoryChart key={unfoldBy} theme="customer" rows={unfoldRows} series={unfoldSeries} storageKey={`crm.ceo.customer.${unfoldBy}`}
        groups={unfoldBy === "totals" ? (showCost ? CUSTOMER_GROUPS : CUSTOMER_GROUPS_NO_COST) : undefined} presets={unfoldPresets} format={inrCompact} todayKey={thisMonthKey()}
        title={`How ${period.kind === "fy" ? "the year" : "the period"} unfolded`}
        hint={unfoldBy === "totals"
          ? `Revenue · Receivable · Received · Due (bank and TDS)${showCost ? " · people cost · margin" : ""}, by the invoice's work month`
          : "Revenue (Ex. Tax) month by month, one column per customer — the largest are named, the rest are Others"}
        headerExtra={<GlassToggle value={unfoldBy} ink={STORY_THEMES.customer.ink} label="Unfolded view"
          options={[{ key: "totals", label: "Totals" }, { key: "customers", label: "By customer" }]} onChange={setUnfoldBy} />}
        stats={unfoldStats} stripKeys={unfoldBy === "totals" ? ["revenue_ex", "received_ex"] : [unfoldSeries[0]?.key ?? "", unfoldSeries[1]?.key]}
        ring={unfoldBy === "totals" ? (r) => ({ pct: shareOfPct(num0(r.received_ex), num0(r.revenue_ex)), color: "#10b981" }) : undefined}
        spotlightSub={() => "work month"}
        spotlightExtra={unfoldBy === "totals" && showCost ? (r) => (
          <SpotLine label="Margin" value={`${inrCompact(num0(r.margin))} · ${pct(shareOfPct(num0(r.margin), num0(r.revenue_ex)), 0)}`}
            tone={num0(r.margin) < 0 ? "bad" : "ok"} />
        ) : undefined}
        onOpen={(row, sKey, _t, e) => openLink(sKey ? unfoldBar(row, sKey) : bucketLink("billed", row.key), e)}
        openLabel={(row) => `Open the invoices of ${row.label}`}
        emptyText="No billing in this period." />

      <StoryChart key={`${zoom}-${groupBy}`} theme="customer" rows={deployedRows} series={deployedSeries} storageKey={`crm.ceo.deployed.${groupBy}`}
        presets={deployedPresets} format={(v) => num(v)} rowLabel={ZOOM_ROWS[zoom]} todayKey={zoom === "month" ? thisMonthKey() : undefined}
        title="Deployed on customer sites"
        hint={`heads deployed at the end of each ${zoom === "month" ? "month" : zoom === "quarter" ? "quarter" : "financial year"} · by ${groupBy === "customers" ? "customer" : "customer location (delivery branch, else the opportunity's work location)"}`}
        headerExtra={<>
          <GlassToggle value={groupBy} ink={STORY_THEMES.customer.ink} label="Deployed group"
            options={[{ key: "customers", label: "By customer" }, { key: "locations", label: "By location" }]} onChange={setGroupBy} />
          <GlassToggle value={zoom} ink={STORY_THEMES.customer.ink} label="Deployed zoom" options={ZOOM_OPTIONS} onChange={setZoom} />
        </>}
        stats={deployedStats} stripKeys={["total", deployedSeries[1]?.key]} leadKey="total"
        onOpen={(row, sKey, _t, e) => openLink(deployedBar(row, sKey ?? "total"), e)}
        openLabel={(row) => `See who was deployed in ${row.label}`}
        emptyText="Nobody deployed in this window." />

      {/* 2 · The dials: dependence, collection, margin. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Concentration" hint="share of billing from the largest customer — lower is safer" action={<StateChip state={concState}>{pct(s.top1_share_pct, 0)}</StateChip>}>
          <Speedometer value={s.top1_share_pct ?? 0} max={100} marker={50} markerLabel="risk" state={concState} invert label="Top customer share" caption={s.top_customer ?? "—"} format={(v) => `${Math.round(v)}%`} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat k="Top 3 share" v={pct(s.top3_share_pct, 0)} />
            <MiniStat k="Customers billing" v={num(s.customers_billing)} />
          </div>
        </Panel>
        <Panel title="Collection rate" hint="received (bank + TDS) ÷ revenue (Inc Tax)" action={<StateChip state={collectionState}>{pct(collectionPct, 0)}</StateChip>}>
          <Speedometer value={collectionPct ?? 0} max={100} marker={90} markerLabel="goal" state={collectionState} label="Collection rate" caption="collected" format={(v) => `${Math.round(v)}%`} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat k="Collected" v={inrCompact(s.collected)} tone="ok" />
            <MiniStat k="Overdue" v={inrCompact(s.overdue)} tone={s.overdue > 0 ? "bad" : "ok"} />
          </div>
        </Panel>
        {showCost ? (
          <Panel title="Blended margin" hint="billed − people cost across every customer" action={<StateChip state={marginState}>{pct(marginPct, 0)}</StateChip>}>
            <Speedometer value={marginPct ?? 0} max={60} marker={30} markerLabel="goal" state={marginState} label="Gross margin" caption="margin" format={(v) => `${Math.round(v)}%`} />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <MiniStat k="People cost" v={inrCompact(totalCost)} />
              <MiniStat k="Loss-making" v={num(lossMaking.length)} tone={lossMaking.length ? "bad" : "ok"} hint={lossMaking.map((c) => c.customer).join(", ") || undefined} />
            </div>
          </Panel>
        ) : (
          <Panel title="Overdue share" hint="overdue ÷ everything the customers still owe — lower is better"
                 action={<StateChip state={overdueShareState}>{pct(overdueSharePct, 0)}</StateChip>}>
            <Speedometer value={overdueSharePct ?? 0} max={100} marker={20} markerLabel="limit" state={overdueShareState} invert
                         label="Overdue share" caption="overdue" format={(v) => `${Math.round(v)}%`} />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <MiniStat k="Outstanding" v={inrCompact(s.outstanding)} />
              <MiniStat k="Customers overdue" v={num(d.customers.filter((c) => c.overdue > 0).length)}
                        tone={d.customers.some((c) => c.overdue > 0) ? "bad" : "ok"}
                        hint={d.customers.filter((c) => c.overdue > 0).map((c) => c.customer).join(", ") || undefined} />
            </div>
          </Panel>
        )}
      </div>

      {/* 3 · Four cuts of the customer book — bar charts with their own ticks. */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Customer billing" hint={`billed · ${period.comparison_label} · collected${showCost ? " · cost · margin" : ""}`}
               action={s.concentration_risk ? <StateChip state="warn">Concentrated</StateChip> : undefined}>
          {billing.length ? (
            <FilteredBars rowFilter rowLabel="Customers" format={inrCompact} height={220} data={billing}
                          barLink={customerBar((s) => moneyMetric(s))}
                          series={[{ key: "billed", label: "Billed", color: 0 }, { key: "previous", label: period.comparison_label, color: 7 },
                                   { key: "collected", label: "Collected", color: 1, defaultOff: true },
                                   ...(showCost ? [{ key: "cost", label: "People cost", color: 6, defaultOff: true },
                                                   { key: "margin", label: "Margin", color: 2, defaultOff: true }] : [])]} />
          ) : <p className="text-sm text-muted">No billing in this period.</p>}
        </Panel>

        <Panel title="Receivables by customer" hint="what each customer still owes · overdue = past the due date today"
               action={s.overdue > 0 ? <StateChip state="bad">{inrCompact(s.overdue)} overdue</StateChip> : <StateChip state="ok">Nothing overdue</StateChip>}>
          {receivables.length ? (
            <FilteredBars rowFilter rowLabel="Customers" format={inrCompact} height={220} data={receivables}
                          barLink={customerBar((s) => moneyMetric(s, "outstanding"))}
                          series={[{ key: "outstanding", label: "Outstanding", color: 0 }, { key: "overdue", label: "Overdue", color: 5 },
                                   { key: "current", label: "Not yet due", color: 1, defaultOff: true }]} />
          ) : <p className="text-sm text-muted">Nothing outstanding.</p>}
        </Panel>

        <Panel title="PO runway by customer" hint="active PO balance vs this month's burn (deployed heads × monthly rate) — months of cover"
               action={runwayShort ? <StateChip state="warn">{runwayShort} under 2 months</StateChip> : undefined}>
          {runway.length ? (
            <FilteredBars rowFilter rowLabel="Customers" format={inrCompact} height={220} data={runway}
                          barLink={customerBar(() => "po")}
                          series={[{ key: "po_balance", label: "PO balance", color: 0 }, { key: "burn", label: "Monthly burn", color: 6 },
                                   { key: "cover", label: "Months of cover", color: 3, defaultOff: true }]} />
          ) : <p className="text-sm text-muted">No active PO or deployment.</p>}
        </Panel>

        <Panel title="People by customer" hint="deployed today · internal vs external placements · open positions">
          {people.length ? (
            <FilteredBars rowFilter rowLabel="Customers" height={220} data={people}
                          barLink={customerBar((s) => (s === "open" ? "positions" : "deployed"), (s) => (s === "open" ? "open" : undefined))}
                          series={[{ key: "deployed", label: "Deployed today", color: 0 }, { key: "internal", label: "Internal", color: 2 },
                                   { key: "external", label: "External", color: 1 }, { key: "open", label: "Open positions", color: 5 }]} />
          ) : <p className="text-sm text-muted">Nobody deployed and nothing open.</p>}
        </Panel>
      </div>

      {/* 4 · The drill-down the CEO asked for: customer → project → person. */}
      <Panel title="Customer → project → person" hint={`click a row to drill down · revenue is issued Tax invoices by invoice date${showCost ? " · cost is CTC ÷ 12 × months deployed" : ""}`}
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
                {showCost && <th className={thCls}>People cost</th>}
                {showCost && <th className={thCls}>Margin</th>}
                <th className={thCls}>Heads</th>
                <th className={thCls}>Internal / external</th>
                <th className={thCls}>Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {rows.length === 0 && <tr><td colSpan={showCost ? 8 : 6} className="px-3 py-6 text-center text-sm text-muted">{query ? "No customer or project matches." : "No billing or deployment in this period."}</td></tr>}
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
                      {showCost && <td className={tdCls}>{inr(c.cost)}</td>}
                      {showCost && <td className={`${tdCls} ${c.margin < 0 ? "text-danger" : ""}`}>{inr(c.margin)} <span className="text-xs text-muted">{pct(c.margin_pct, 0)}</span></td>}
                      <td className={tdCls}>{num(c.heads)} <span className="text-xs text-muted">({c.heads_today} live)</span></td>
                      <td className={tdCls}><span className="text-xs text-secondary">{c.internal} int · {c.external} ext</span></td>
                      <td className={tdCls}>
                        {c.outstanding > 0 ? inr(c.outstanding) : <span className="text-xs text-muted">—</span>}
                        {c.overdue > 0 && <span className="ml-1.5 text-xs font-semibold text-danger">{inrCompact(c.overdue)} overdue</span>}
                      </td>
                    </tr>
                    {isOpen && <ProjectRows rows={c.projects} open={open} toggle={toggle} showCost={showCost} />}
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
  const drill = (metric: string, scope?: string) => insightLink(metric, period, { scope });
  const [scope, setScope] = useState<"live" | "all">("live");
  const [zoom, setZoom] = useState<PeriodKind>("month");   // months inside the period first; Quarterly / Yearly one click away
  const k = d.kpis, mix = d.onboarding_mix, ps = d.positions_summary, f = d.funnel;
  const fillPct = ps.total ? (ps.joined / ps.total) * 100 : null;
  const fillState = highGood(fillPct, 80, 50);
  const mixState = highGood(mix.internal_pct, 40, 20);
  const positions = scope === "live" ? d.positions.filter((p) => p.live) : d.positions;
  const trend = d.onboarding_trend[zoom].filter((r) => !r.future);
  // 29 Oct 2026 — every bar opens the positions / onboardings behind it.
  const trendBar = (r: Record<string, unknown>, s: string) =>
    (s === "positions_in" ? bucketLink("positions", r.key, { scope: "brought_in" }) : bucketLink("onboarded", r.key));
  const POS_SCOPE: Record<string, string | undefined> = { open: "open", stale: "stale", joined: "filled" };
  const customerPosBar = (r: Record<string, unknown>, s: string) => (s === "internal" || s === "external"
    ? insightLink("onboarded", period, { customer_id: rowCid(r) })
    : insightLink("positions", period, { customer_id: rowCid(r), scope: POS_SCOPE[s] }));
  const FUNNEL_SCOPE: Record<string, string | undefined> = { "Open to fill": "open", "Workable by TA": "open", "Joined so far": "filled" };
  const funnelBar = (r: Record<string, unknown>) => insightLink("positions", period, { scope: FUNNEL_SCOPE[String(r.label)] });
  const ownerBar = (r: Record<string, unknown>, s: string) =>
    insightLink("positions", period, { scope: POS_SCOPE[s], q: /^Others/.test(String(r.label)) ? null : String(r.label) });
  const stageBar = (r: Record<string, unknown>) => insightLink("stages", period, { q: String(r.label) });
  const byCustomer = d.by_customer.map((c) => ({ label: c.customer, customer_id: c.customer_id, open: c.open, joined: c.joined, positions: c.positions, internal: c.internal, external: c.external, stale: c.stale }));
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
  const salesStats = (() => {
    const sum = (k: string) => trend.reduce((a, r) => a + num0((r as Record<string, unknown>)[k]), 0);
    const pin = sum("positions_in"), onb = sum("onboardings"), int = sum("internal"), ext = sum("external");
    return [
      { label: "Positions brought in", value: num(pin), sub: `${num(k.opportunities)} opportunities in the period`, dot: "#c4b5fd" },
      { label: "Onboarded", value: num(onb), sub: `${num(int)} internal · ${num(ext)} external`, dot: "#6ee7b7" },
      { label: "Internal share", value: pct(shareOfPct(int, onb), 0), sub: "redeployed, not hired", dot: "#5eead4", ring: shareOfPct(int, onb) },
      { label: "Onboarded ÷ brought in", value: pct(shareOfPct(onb, pin), 0), sub: `${num(k.active_positions)} still open now`, dot: "#f9a8d4" },
    ];
  })();

  return (
    <div className="space-y-4">
      <Alerts alerts={d.alerts} to="opportunities" where="Opportunities" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Tile label="Positions brought in" value={num(k.pipeline_positions)} to={drill("positions", "brought_in")} foot={<Delta value={k.pipeline_positions_prev ? ((k.pipeline_positions - k.pipeline_positions_prev) / k.pipeline_positions_prev) * 100 : null} label={period.comparison_label} />} sub={`${num(k.opportunities)} opportunities`} />
        <Tile label="Onboarded" value={num(k.onboardings)} tone="success" to={drill("onboarded")} foot={<Delta value={k.onboardings_prev ? ((k.onboardings - k.onboardings_prev) / k.onboardings_prev) * 100 : null} label={period.comparison_label} />}
              sub={<><span className="font-semibold text-success">{mix.internal} internal</span> · <span className="font-semibold text-info">{mix.external} external</span>{mix.unknown ? ` · ${mix.unknown} unknown` : ""}</>} />
        <Tile label="Open now" value={num(k.active_positions)} tone={k.active_positions ? "warning" : "success"} to={drill("positions", "open")} sub={`${num(k.workable_positions)} workable (approved, not on hold)`} />
        <Tile label="Fill rate" to={drill("positions")} value={pct(fillPct, 0)} tone={fillState === "ok" ? "success" : fillState === "warn" ? "warning" : "danger"} sub={`${num(ps.joined)} of ${num(ps.total)} live positions filled`} />
        <Tile label="Fulfilled" to={drill("positions", "filled")} value={num(k.positions_fulfilled)} tone="success" sub={<>customer closed <span className="font-semibold text-danger">{num(k.positions_customer_closed)}</span> beside, never added</>} />
        <Tile label="Active customers" value={num(k.active_customers)} to={drill("customers")} sub={d.customers.largest ? `${d.customers.largest.name} holds ${pct(d.customers.largest.share_pct, 0)} of open positions` : "with a live, approved deal"} tone={d.customers.concentration_risk ? "warning" : "brand"} />
        <Tile label="Stale positions" value={num(ps.stale_30)} tone={ps.stale_30 ? "danger" : "success"} to={drill("positions", "stale")} sub="open for 30+ days" />
        <Tile label="Waiting in stages" value={num(d.stage_delays.total_waiting)} tone={d.stage_delays.rows.some((r) => r.state === "bad") ? "danger" : d.stage_delays.rows.some((r) => r.state === "warn") ? "warning" : "neutral"} to={drill("stages")} sub="candidates between stages" />
      </div>

      {/* 1 · How the period unfolded — 8 Nov 2026: the Finance tab's story chart, in the Sales colours. */}
      <StoryChart key={zoom} theme="sales" rows={trend as unknown as StoryRow[]} series={SALES_SERIES} groups={SALES_GROUPS} presets={SALES_PRESETS}
        storageKey="crm.ceo.sales.trend" format={(v) => num(v)} rowLabel={ZOOM_ROWS[zoom]} todayKey={zoom === "month" ? thisMonthKey() : undefined}
        title={`How ${period.kind === "fy" ? "the year" : "the period"} unfolded`}
        hint="positions brought in by Sales vs candidates onboarded — internal (redeployed) and external (hired for the position)"
        headerExtra={<GlassToggle value={zoom} ink={STORY_THEMES.sales.ink} label="Onboarding zoom" options={ZOOM_OPTIONS} onChange={setZoom} />}
        stats={salesStats} stripKeys={["positions_in", "onboardings"]}
        ring={(r) => ({ pct: shareOfPct(num0(r.internal), num0(r.onboardings)), color: "#14b8a6" })}
        spotlightSub={(r) => `${num(num0(r.onboardings))} onboarded of ${num(num0(r.positions_in))} brought in`}
        spotlightExtra={(r) => <SpotLine label="Internal share" value={pct(shareOfPct(num0(r.internal), num0(r.onboardings)), 0)} />}
        onOpen={(row, sKey, _t, e) => openLink(trendBar(row, sKey ?? "onboardings"), e)}
        openLabel={(row) => `Open the onboardings of ${row.label}`}
        emptyText="No positions or onboardings in this window." />

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
            <FilteredBars rowFilter rowLabel="Customers" height={220} data={byCustomer} barLink={customerPosBar}
                          series={[{ key: "open", label: "Open", color: 5 }, { key: "joined", label: "Joined", color: 2 },
                                   { key: "positions", label: "Total positions", color: 7, defaultOff: true }, { key: "internal", label: "Internal", color: 1, defaultOff: true },
                                   { key: "external", label: "External", color: 0, defaultOff: true }, { key: "stale", label: "Stale 30+ d", color: 6, defaultOff: true }]} />
          ) : <p className="text-sm text-muted">No live positions.</p>}
        </Panel>

        <Panel title="Where every position stands" hint="today's snapshot of the sourcing funnel"
               action={<span className="text-xs text-muted">all time: <span className="font-semibold text-success">{num(f.fulfilled)} fulfilled</span> · {num(f.customer_closed)} closed by customer</span>}>
          <FilteredBars rowFilter rowLabel="Stages" height={220} data={funnel} barLink={funnelBar}
                        series={[{ key: "positions", label: "Positions", color: 0 }]} />
        </Panel>

        <Panel title="By Sales owner" hint="positions on live deals or deals opened in the period">
          {byOwner.length ? (
            <FilteredBars rowFilter rowLabel="Owners" height={220} data={byOwner} barLink={ownerBar}
                          series={[{ key: "positions", label: "Positions", color: 3 }, { key: "open", label: "Open", color: 5 },
                                   { key: "joined", label: "Joined", color: 2 }, { key: "opportunities", label: "Opportunities", color: 7, defaultOff: true }]} />
          ) : <p className="text-sm text-muted">No positions in this view.</p>}
        </Panel>

        <Panel title="Hiring-stage delays" hint={`candidates waiting at each stage · amber ≥ ${d.stage_delays.warn_days} days · red ≥ ${d.stage_delays.bad_days} days since the last move`}
               action={d.stage_delays.total_waiting ? <StateChip state={d.stage_delays.rows.some((r) => r.state === "bad") ? "bad" : d.stage_delays.rows.some((r) => r.state === "warn") ? "warn" : "ok"}>{num(d.stage_delays.total_waiting)} waiting</StateChip> : undefined}>
          {stages.length ? (
            <FilteredBars rowFilter rowLabel="Stages" height={220} data={stages} barLink={stageBar}
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

/** Internal vs external placements (29 Sep 2026, HR ask): grouped bars per bucket
 *  of the period, a customer split, and the counts — the Revenue page's rule. */
function PlacementsPanels({ p, period, canDrill }: { p: PlacementsData; period: CeoPeriod; canDrill: boolean }) {
  const h = p.headline;
  const series = p.series.map((r) => ({ label: r.label, key: r.key, internal: r.internal, external: r.external, unknown: r.unknown,
                                        total: r.internal + r.external + r.unknown }));
  const customers = p.by_customer.slice(0, 12).map((c) => ({ label: c.customer, customer_id: c.customer_id, internal: c.internal, external: c.external, unknown: c.unknown }));
  // 29 Oct 2026 — a bar opens the people placed: the deployed list for that bucket /
  // customer (CEO / Admin), else the Employees list placed on projects (HR).
  const seriesBar = (r: Record<string, unknown>) => (canDrill
    ? bucketLink("deployed", r.key) ?? insightLink("deployed", period) : "employees?deployment=deployed");
  const customerBar = (r: Record<string, unknown>) => (canDrill
    ? insightLink("deployed", period, { customer_id: rowCid(r) }) : "employees?deployment=deployed");
  const share = h.internal_pct;
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Panel title="Placed — internal vs external" hint={`${p.window.label} · ${p.window.bucket === "week" ? "by week" : "by month"} · internal = already with us before the placement`}
             action={<span className="text-xs font-semibold text-secondary">{num(h.placements)} placements</span>}>
        <FilteredBars data={series} rowFilter rowLabel={p.window.bucket === "week" ? "Weeks" : "Months"} height={230} barLink={seriesBar}
                      series={[{ key: "total", label: "Placed", color: 0 }, { key: "internal", label: "Internal", color: 2 },
                               { key: "external", label: "External", color: 1 }, { key: "unknown", label: "Unknown", color: 7, defaultOff: true }]} />
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
          <FilteredBars data={customers} rowFilter rowLabel="Customers" height={230} barLink={customerBar}
                        series={[{ key: "internal", label: "Internal", color: 2 }, { key: "external", label: "External", color: 1 },
                                 { key: "unknown", label: "Unknown", color: 7, defaultOff: true }]} />
        ) : <p className="text-sm text-muted">No placements in this period.</p>}
      </Panel>
    </div>
  );
}

export function PeopleTab({ d, period, drill: canDrill = false }: { d: PeopleData; period: CeoPeriod; drill?: boolean }) {
  const h = d.headline;
  // CEO / Admin open the drill-down pages; HR's desk (no access to them) keeps the plain lists.
  const go = (metric: string, plain: string, scope?: string) => (canDrill ? insightLink(metric, period, { scope }) : plain);
  const utilState = highGood(h.utilisation_pct, 85, 70);
  const attrState = lowGood(h.attrition_pct, 10, 20);
  const benchState = lowGood(h.bench_cost_pct, 10, 20);
  const past = d.monthly.filter((r) => !r.future);
  const strip = past.map((r) => ({ label: r.label, key: r.key, headcount: r.headcount ?? 0, deployed: r.deployed ?? 0, bench: r.bench ?? 0, joiners: r.joiners, exits: r.exits, cost: r.cost ?? 0, bench_cost: r.bench_cost ?? 0 }));
  const peopleStats = (() => {
    const joined = past.reduce((a, r) => a + r.joiners, 0), left = past.reduce((a, r) => a + r.exits, 0);
    return [
      { label: "Headcount", value: num(h.headcount), sub: `${num(h.opening_headcount)} at the start`, dot: "#fde68a" },
      { label: "Deployed", value: num(h.deployed), sub: `${pct(h.utilisation_pct, 0)} utilisation`, dot: "#86efac", ring: h.utilisation_pct === null ? null : Math.round(h.utilisation_pct) },
      { label: "Joined / left", value: `+${num(joined)} / −${num(left)}`, sub: `net ${joined - left >= 0 ? "+" : ""}${num(joined - left)} in the window`, dot: "#7dd3fc" },
      { label: "Bench cost / month", value: inrCompact(h.bench_cost_month), sub: `${num(h.bench)} on the bench · ${pct(h.bench_cost_pct, 0)} of cost`, dot: "#fca5a5" },
    ];
  })();
  const costs = past.map((r) => ({ label: r.label, key: r.key, cost: r.cost ?? 0, bench_cost: r.bench_cost ?? 0, deployed_cost: (r.cost ?? 0) - (r.bench_cost ?? 0) }));
  // 29 Oct 2026 — every bar opens the people behind it: the drill page at that month
  // for CEO / Admin; HR (no drill pages) gets the Employees list in the same cut.
  const PEOPLE_SERIES: Record<string, { metric: string; scope?: string; plain: string }> = {
    deployed: { metric: "headcount", scope: "deployed", plain: "employees?deployment=deployed" },
    deployed_cost: { metric: "headcount", scope: "deployed", plain: "employees?deployment=deployed" },
    bench: { metric: "headcount", scope: "bench", plain: "employees?deployment=bench" },
    bench_cost: { metric: "headcount", scope: "bench", plain: "employees?deployment=bench" },
    headcount: { metric: "headcount", plain: "employees" },
    cost: { metric: "headcount", plain: "employees" },
    joiners: { metric: "joiners", plain: "employees" },
    exits: { metric: "exits", plain: "employees" },
    on_notice: { metric: "exits", scope: "notice", plain: "employees" },
  };
  const monthPeopleBar = (r: Record<string, unknown>, s: string) => {
    const m = PEOPLE_SERIES[s] ?? PEOPLE_SERIES.headcount;
    return canDrill ? bucketLink(m.metric, r.key, { scope: m.scope }) : m.plain;
  };
  const cutPeopleBar = (withName: boolean) => (r: Record<string, unknown>, s: string) => {
    const m = PEOPLE_SERIES[s] ?? PEOPLE_SERIES.headcount;
    const name = String(r.label ?? "");
    return canDrill ? insightLink(m.metric, period, { scope: m.scope, q: withName && !/^Others/.test(name) ? name : null }) : m.plain;
  };
  const rolloffBar = () => (canDrill ? insightLink("rolloffs", period) : "project-employees");
  const planned = d.monthly.filter((r) => r.future && r.exits > 0).reduce((a, r) => a + r.exits, 0);
  const byRole = d.by_role.map((r) => ({ label: r.role, deployed: r.deployed, bench: r.bench, on_notice: r.on_notice, cost: r.cost }));
  const tenure = d.tenure.map((t) => ({ label: t.label, deployed: t.deployed, bench: t.bench }));
  const rolloffs = d.rolloffs_by_month.map((r) => ({ label: r.label, heads: r.heads, monthly_rate: r.monthly_rate }));
  const rateAtRisk = d.rolloffs_by_month.reduce((a, r) => a + r.monthly_rate, 0);

  return (
    <div className="space-y-4">
      <Alerts alerts={d.alerts} to="employees" where="Employees" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Tile label="Headcount" value={num(h.headcount)} to={go("headcount", "employees")} sub={`${num(h.opening_headcount)} at the start of the period`} foot={<Delta value={h.opening_headcount ? ((h.headcount - h.opening_headcount) / h.opening_headcount) * 100 : null} label="since start" />} />
        <Tile label="Deployed" value={num(h.deployed)} tone="success" to={go("headcount", "employees?deployment=deployed", "deployed")} sub={`${pct(h.utilisation_pct, 0)} utilisation`} />
        <Tile label="On the bench" value={num(h.bench)} tone={h.bench ? "warning" : "success"} to={go("headcount", "employees?deployment=bench", "bench")} sub={`${inrCompact(h.bench_cost_month)} / month · ${pct(h.bench_cost_pct, 0)} of people cost`} />
        <Tile label="Joined" value={num(h.joiners)} tone="success" to={go("joiners", "employees")} sub={`in ${period.short_label}`} />
        <Tile label="Left" value={num(h.exits)} tone={h.exits ? "danger" : "neutral"} to={go("exits", "employees")} sub={`net ${h.net_change >= 0 ? "+" : ""}${h.net_change}${planned ? ` · ${planned} planned` : ""}`} />
        <Tile label="Attrition" value={pct(h.attrition_pct, 0)} tone={attrState === "ok" ? "success" : attrState === "warn" ? "warning" : "danger"} to={go("exits", "employees")} sub={`${num(h.on_notice)} on notice`} />
        <Tile label="Revenue / deployed head" value={inrCompact(h.revenue_per_deployed_head)} sub={`${inrCompact(h.billed)} billed`} to={go("deployed", revenueLink(period))} />
        <Tile label="Roll-offs next 90 d" value={num(h.rolloffs_90d)} tone={h.rolloffs_90d ? "warning" : "success"} to={go("rolloffs", "project-employees")} sub={`${inrCompact(rateAtRisk)} / month at risk`} />
      </div>

      {/* 1 · How the period unfolded — 8 Nov 2026: the Finance tab's story chart, in the People colours. */}
      <StoryChart theme="people" rows={strip as unknown as StoryRow[]} series={PEOPLE_STORY_SERIES} groups={PEOPLE_GROUPS} presets={PEOPLE_PRESETS}
        storageKey="crm.ceo.people.trend" format={(v) => num(v)} todayKey={thisMonthKey()} stripKeys={["deployed", "bench"]} leadKey="headcount"
        title={`How ${period.kind === "fy" ? "the year" : "the period"} unfolded`}
        hint="headcount, deployed and bench at each month end · joiners and exits in the month"
        stats={peopleStats}
        ring={(r) => ({ pct: shareOfPct(num0(r.deployed), num0(r.headcount)), color: "#10b981" })}
        spotlightSub={(r) => `${pct(shareOfPct(num0(r.deployed), num0(r.headcount)), 0)} utilisation at month end`}
        spotlightExtra={(r) => (<>
          <SpotLine label="People cost" value={inrCompact(num0(r.cost))} />
          <SpotLine label="Bench cost" value={inrCompact(num0(r.bench_cost))} tone={num0(r.bench_cost) > 0 ? "warn" : "ok"} />
        </>)}
        onOpen={(row, sKey, _t, e) => openLink(monthPeopleBar(row, sKey ?? "headcount"), e)}
        openLabel={(row) => (canDrill ? `Open the people of ${row.label}` : "Open the Employees list")}
        emptyText="Nobody on the rolls in this window." />

      {/* 1b · Internal vs external placements (29 Sep 2026, HR ask). */}
      {d.placements && <PlacementsPanels p={d.placements} period={period} canDrill={canDrill} />}

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
          <FilteredBars data={costs} rowFilter rowLabel="Months" format={inrCompact} height={220} barLink={monthPeopleBar}
                        series={[{ key: "cost", label: "Total", color: 0 }, { key: "deployed_cost", label: "Deployed", color: 2 },
                                 { key: "bench_cost", label: "Bench", color: 6 }]} />
        </Panel>

        <Panel title="Deployed vs bench by designation" hint="who is idle, by role — the skills on the bench"
               action={<span className="text-xs text-muted">{num(h.headcount)} on the rolls today</span>}>
          {byRole.length ? (
            <FilteredBars data={byRole} rowFilter rowLabel="Designations" height={220} barLink={cutPeopleBar(true)}
                          series={[{ key: "deployed", label: "Deployed", color: 2 }, { key: "bench", label: "On the bench", color: 6 },
                                   { key: "on_notice", label: "On notice", color: 5, defaultOff: true }]} />
          ) : <p className="text-sm text-muted">Nobody on the rolls.</p>}
        </Panel>

        <Panel title="Tenure mix" hint={`how long today's people have been with us · avg ${h.avg_tenure_years ?? "—"} yrs`}>
          <FilteredBars data={tenure} rowFilter rowLabel="Tenure" height={220} barLink={cutPeopleBar(false)}
                        series={[{ key: "deployed", label: "Deployed", color: 2 }, { key: "bench", label: "On the bench", color: 6 }]} />
        </Panel>

        <Panel title="Rolling off in the next 90 days" hint="cover ends with the project's last working day or its PO · monthly rate that stops billing"
               action={d.rolloffs.length ? <StateChip state={d.rolloffs.some((r) => r.days_left !== null && r.days_left <= 30) ? "bad" : "warn"}>{num(d.rolloffs.length)} heads</StateChip> : <StateChip state="ok">None</StateChip>}>
          {rolloffs.length ? (
            <>
              <FilteredBars data={rolloffs} rowFilter rowLabel="Months" height={180} barLink={rolloffBar}
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

/**
 * `tabs` — which tabs this login opens (19 Oct 2026): Admin / CEO all five;
 * Finance the Finance tab + the Billing Tracker; the Sales family the Finance
 * tab alone (the server refuses the others). `canSetTargets` — Finance + Admin / CEO set the revenue targets;
 * Sales only reads them.
 */
type CeoDashboardProps = {
  tabs?: CeoTab[];
  canSetTargets?: boolean;
  /** 5 Nov 2026 (user rule): the "not mapped yet" panel is Finance's work — Finance only, never Admin / CEO. */
  showOnAccount?: boolean;
};

/** 25 Nov 2026 — each Dashboard tab is a sub-tab a role can switch off in Access
 *  Control ▸ Roles & permissions (Dashboard ▸ sub-tabs). A tick can only HIDE a
 *  tab here: which tabs a login may open at all is still the server's rule. */
export function CeoDashboard(props: CeoDashboardProps = {}) {
  const me = useMeMaybe();
  const base = props.tabs ? TABS.filter((t) => props.tabs!.includes(t.key)) : TABS;
  const keys = base.filter((t) => !me || subTabVisible(me.access, me.roles, "dashboard", t.key)).map((t) => t.key);
  if (!keys.length) return null;
  return <CeoDashboardInner {...props} tabs={keys} key={keys.join(",")} />;
}

function CeoDashboardInner({ tabs: allowed, canSetTargets = true, showOnAccount = false }: CeoDashboardProps) {
  const shownTabs = allowed ? TABS.filter((t) => allowed.includes(t.key)) : TABS;
  const single = shownTabs.length === 1;
  const [tab, setTab] = useState<CeoTab>(() => {
    const stored = readStoredTab();
    return shownTabs.some((t) => t.key === stored) ? stored : shownTabs[0].key;
  });
  // The Billing Tracker fetches for itself; the period payload stays on the
  // last company tab (so the Targets button and returning to it are instant).
  const firstData = (shownTabs.find((t) => !OWN_TABS.includes(t.key))?.key ?? "finance") as DataTab;
  const [dataTab, setDataTab] = useState<DataTab>(() => (OWN_TABS.includes(tab) ? firstData : tab as DataTab));
  // Billing Tracker and Invoice approvals fetch for themselves — no period controls.
  const isBilling = OWN_TABS.includes(tab);
  const showApprovals = shownTabs.some((t) => t.key === "approvals");
  const readyCount = useApprovalsBadge(showApprovals);
  const [period, setPeriod] = useState<PeriodKind>("fy");
  const [month, setMonth] = useState<string>(thisMonthKey());

  // 24 Oct 2026 — the Finance tab narrows to one customer / project (the same
  // scope as the Revenue report); the other tabs never send it.
  const [scope, setScope] = useState<{ customer: number | null; project: number | null; branch: number | null }>({ customer: null, project: null, branch: null });
  const scoped = dataTab === "finance";
  const url = `/api/dashboard/ceo${qs({
    tab: dataTab, month, period,
    customer_id: scoped ? scope.customer ?? undefined : undefined,
    project_id: scoped ? scope.project ?? undefined : undefined,
    branch_id: scoped ? scope.branch ?? undefined : undefined,
  })}`;
  // 20 Nov 2026 (user: "when Finance maps invoices the data must change"): re-read quietly
  // every minute while visible, on return to the tab and at once after any change made in
  // this browser (Map invoices, Record payment, Settle… — `announceDeskChange`).
  const { data, loading, error, retry } = useDeskData<CeoPayload<unknown>>(url, { live: 60_000 });
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
  // Keep the last options seen, so the pickers do not blink while a new scope loads.
  const [financeOptions, setFinanceOptions] = useState<{ customers: FilterOption[]; projects: FilterOption[]; branches?: FilterOption[] } | null>(null);
  useEffect(() => {
    const opts = data && data.tab === "finance" ? (data.data as FinanceData).filters?.options : null;
    if (opts) setFinanceOptions(opts);
  }, [data]);
  const atCurrent = useMemo(() => {
    if (!data) return month >= thisMonthKey();
    return data.period.is_current || data.period.end >= new Date().toISOString().slice(0, 10);
  }, [data, month]);

  const pick = (t: CeoTab) => {
    setTab(t);
    if (!OWN_TABS.includes(t)) setDataTab(t as DataTab);
    try { localStorage.setItem(TAB_STORAGE_KEY, t); } catch { /* per-viewer convenience only */ }
  };

  return (
    <section className="space-y-4" aria-label="CEO dashboard">
      <header className="rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-display text-base font-bold text-primary">{single ? "Company finance at a glance" : "Company at a glance"}</h2>
            <p className="text-xs text-muted">
              {data ? `${data.period.label} · as of ${fmtDay(data.as_of)}` : single ? "Revenue, collections, profit and cash, by financial year" : `${shownTabs.map((t) => t.label).join(" · ")}`}
              {!canSetTargets && " · view only"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isBilling && <PeriodSwitcher value={period} onChange={setPeriod} />}
            {!isBilling && <DateStepper month={month} period={period} atCurrent={atCurrent} onShift={(d) => setMonth((m) => shiftMonthKey(m, d))} onPick={setMonth} />}
            {canSetTargets && !isBilling && (
              <button type="button" className={`${btnSecondary} h-9 min-h-0 gap-1.5`} onClick={() => void openTargets()} title="Set the monthly, quarterly and yearly revenue targets">
                <Target className="h-4 w-4" aria-hidden /> Targets
              </button>
            )}
            {!isBilling && <button type="button" className={ICON_BTN} onClick={retry} aria-label="Refresh" title="Refresh">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            </button>}
          </div>
        </div>
        {!single && <div className={`grid grid-cols-2 gap-2 border-t border-subtle px-3 py-3 ${shownTabs.length >= 6 ? "md:grid-cols-3 xl:grid-cols-6" : shownTabs.length >= 5 ? "md:grid-cols-3 xl:grid-cols-5" : shownTabs.length === 2 ? "md:grid-cols-2" : "md:grid-cols-4"}`} role="tablist" aria-label="CEO dashboard tabs">
          {shownTabs.map((t) => {
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
                  <span className={`flex items-center gap-1.5 text-sm font-bold ${active ? "text-primary" : "text-secondary"}`}>
                    {t.label}
                    {t.key === "approvals" && readyCount > 0 && (
                      <span className="rounded-full bg-emerald-600 px-1.5 text-[10px] font-bold text-white tabular-nums" title={`${readyCount} invoice(s) ready for your approval`}>{readyCount}</span>
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-muted">{t.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>}
        {tab === "finance" && financeOptions && (
          <div className="flex flex-wrap items-center gap-2 border-t border-subtle px-5 py-2.5">
            <ScopeFilterBar
              options={financeOptions}
              customerId={scope.customer}
              projectId={scope.project}
              onCustomer={(v) => setScope((s) => ({
                customer: v,
                // A project / branch of another customer would make an empty scope.
                project: v && s.project && financeOptions.projects.find((p) => p.id === s.project)?.customer_id !== v ? null : s.project,
                branch: v && s.branch && financeOptions.branches?.find((b) => b.id === s.branch)?.customer_id !== v ? null : s.branch,
              }))}
              onProject={(v) => setScope((s) => ({ ...s, project: v }))}
              branchId={scope.branch}
              onBranch={(v) => setScope((s) => {
                const p = financeOptions.projects.find((x) => x.id === s.project);
                const foreign = v !== null && p && (v === 0 ? !!p.branch_id : p.branch_id !== v);
                return { ...s, branch: v, project: foreign ? null : s.project };
              })}
            />
            {(scope.customer || scope.project || scope.branch !== null) && (
              <span className="text-[11px] text-muted">Every tile, dial and chart below is for this scope only.</span>
            )}
          </div>
        )}
      </header>

      {tab === "billing" && <BillingTracker />}
      {tab === "approvals" && <InvoiceApprovals />}
      {!isBilling && error && <ErrorBox error={error} onRetry={retry} />}
      {!isBilling && !data && loading && !error && (
        <div className="grid gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="rounded-card border border-subtle bg-surface-1 p-4"><SkeletonText lines={2} /></div>)}</div>
      )}
      {!isBilling && data && data.tab === "finance" && <FinanceTab d={data.data as FinanceData} period={data.period} showOnAccount={showOnAccount} />}
      {!isBilling && data && data.tab === "customer" && <CustomerTab d={data.data as CustomerData} period={data.period} />}
      {!isBilling && data && data.tab === "sales" && <SalesTab d={data.data as SalesData} period={data.period} />}
      {!isBilling && data && data.tab === "people" && <PeopleTab d={data.data as PeopleData} period={data.period} drill />}
      {targetsOpen && targetsFor && (
        <RevenueTargetsModal month={targetsFor.month} targets={targetsFor.targets}
                             onClose={() => setTargetsOpen(false)}
                             onSaved={(msg) => { setTargetsOpen(false); showToast(msg); retry(); }} />
      )}
      {toast}
    </section>
  );
}
