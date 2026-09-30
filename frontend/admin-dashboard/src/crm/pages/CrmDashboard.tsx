/** Role-adaptive CRM dashboard — each role section loads its own endpoint
 * independently, so one failing widget never kills the rest of the page. */
import React, { useEffect, useState } from "react";
import {
  ArrowRight, Briefcase, Building2, CalendarCheck, CalendarClock, CalendarDays, FileText, FolderKanban,
  Layers, Percent, Receipt, RefreshCw, Settings, ShieldCheck, Sparkles, UserCheck, UserSearch, Users, X,
} from "lucide-react";
import { crmGet, qs } from "../api";
import { roleTitle, useHasRole, useMe } from "../CrmApp";
import { CrmLink } from "../routerHooks";
import { FadeInUp } from "../components/motion3d";
import { EmptyState, ErrorBox, Modal, SkeletonText, Spinner, btnSecondary, statusColor } from "../components/ui";
import {
  DateStepper, FilteredBars, ICON_BTN, MiniStat, Panel, PeriodSwitcher, STATE_CHIP, Speedometer, Tile,
  inrCompact, num, pct, shiftMonthKey, thisMonthKey,
} from "../components/controlTower";
import type { PeriodKind, StateTone } from "../components/controlTower";
import { WorkDesk } from "./dashboard/WorkDesk";
import { PoExpiryPanel } from "./dashboard/PoExpiryPanel";
import { HiringControlTower, useShowsHiringTower } from "./dashboard/HiringControlTower";
import { CeoDashboard, PeopleTab } from "./dashboard/CeoDashboard";
import type { CeoPayload, PeopleData } from "./dashboard/CeoDashboard";
import { fmtDateTime12 } from "../../lib/datetime";

/* ---------- Backend response shapes (services/dashboards.py) ---------- */

type FunnelEntry = { stage?: string; status?: string; count: number };

type ExecutiveData = {
  headcount: number;
  customer_count: number;
  project_count: number;
  opportunity_funnel: { stage: string; count: number }[];
  quarterly_matrix: { quarter: string; joined_count: number; revenue: number }[];
  requirement_funnel: { status: string; count: number }[];
};

type RequirementsData = {
  funnel: { status: string; count: number }[];
  avg_days_in_stage: {
    submission_to_sales_head_approval: number | null;
    sales_head_to_engineering: number | null;
  };
  positions: { open: number; filled: number };
};

type RmgData = {
  pipeline: {
    req_number: string;
    /** ONE id rule (18 Aug 2026): the parent opportunity's OPP-xxxx is what humans see. */
    opp_id?: string | null;
    title: string;
    customer: string;
    no_of_positions: number;
    resumes_count: number;
    profiles_by_status: Record<string, number>;
  }[];
  /** RMG screening queue (25 Aug 2026): applicants waiting on Shortlist/Reject. */
  pending_screening?: {
    profile_id: number;
    candidate_name: string;
    opportunity_title: string;
    applied_on: string | null;
    ta_owner_name: string | null;
  }[];
  totals: { pending_engineering_reviews: number; pending_screening?: number };
};

type TaData = {
  open_requirements_count: number;
  resumes_pending_scan: number;
  interview_pending_queue: {
    id: number;
    candidate_name: string;
    /** The human-visible id (OPP-xxxx; server falls back to req_number for legacy rows). */
    requirement: string;
    requirement_id?: number | null;
    scheduled_at: string | null;
  }[];
  recruiter_productivity: {
    user: string;
    resumes_screened_today: number;
    this_week: number;
    total: number;
    shortlisted_total: number;
  }[];
};

type FinanceData = {
  outstanding_invoices: { count: number; amount: number };
  tds_pending: { count: number; amount: number };
  po_consumption: {
    po_number: string;
    total_value: number;
    consumed_value: number;
    balance_value: number;
    pct_consumed: number;
  }[];
};

/* ---------- Shared helpers ---------- */

function useDashData<T>(url: string) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string }>({
    data: null,
    loading: true,
    error: "",
  });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    crmGet<T>(url)
      .then((r) => alive && setState({ data: r.data, loading: false, error: "" }))
      .catch((e) => alive && setState({ data: null, loading: false, error: e?.message || "Failed to load" }));
    return () => {
      alive = false;
    };
  }, [url, tick]);
  return { ...state, retry: () => setTick((t) => t + 1) };
}

/* Calm section header per DESIGN-DECISIONS: small caps, muted, generous gap
 * to content (16px inside the section, 32px between sections on the page). */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <FadeInUp>
        <h2 className="w-fit text-sm font-semibold uppercase tracking-wider text-muted">
          {title}
        </h2>
      </FadeInUp>
      {children}
    </section>
  );
}

function SectionLoading() {
  return (
    <div className="rounded-card border border-subtle bg-surface-1 p-5 shadow-raised">
      <SkeletonText lines={3} />
    </div>
  );
}

/* Table recipe: zebra-free, 48px rows, sticky opaque header, right-aligned
 * numeric cells with tabular figures (mirrors DataTable). */
const theadCls = "sticky top-0 z-10 bg-surface-1";
const thCls = "px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-muted";
const tdCls = "h-12 px-3 py-2 align-middle text-sm text-secondary";
const tdNum = `${tdCls} text-right tabular-nums`;
const trCls = "border-b border-subtle last:border-0";

/** A funnel payload as bar rows — the label is the stage / status with underscores as spaces. */
function funnelData(data: FunnelEntry[], nameKey: "stage" | "status") {
  return data.map((d) => ({ label: String(d[nameKey] || "").replace(/_/g, " "), count: d.count }));
}

const tableWrap = "-mx-5 -mb-5 overflow-x-auto";

/* ---------- Bench / redeployment radar (RMG / Sales_Head) ---------- */

type BenchRow = {
  project_employee_id: number; employee_id: number; employee_name: string;
  role_title: string | null; project_id: number; project_name: string;
  customer_name: string | null; po_end_date: string | null; days_left: number | null;
};

type BenchMatch = {
  requirement_id: number; req_number: string; opp_id?: string | null; title: string; status: string;
  match_score: number | null; skills_matched: string[]; mandatory_total: number;
};

function BenchCard() {
  const { data } = useDashData<BenchRow[]>("/api/dashboard/bench?days=60");
  const [matchFor, setMatchFor] = useState<BenchRow | null>(null);
  const [matches, setMatches] = useState<BenchMatch[] | null>(null);
  const [matchErr, setMatchErr] = useState("");
  const rows = data || [];
  if (rows.length === 0) return null;

  const openMatches = (r: BenchRow) => {
    setMatchFor(r);
    setMatches(null);
    setMatchErr("");
    crmGet<BenchMatch[]>(`/api/dashboard/bench/${r.employee_id}/matches`)
      .then((res) => setMatches(res.data || []))
      .catch((e: any) => setMatchErr(e?.message || "Failed to compute matches"));
  };

  const tone = (d: number | null) =>
    d == null ? "text-muted" : d <= 0 ? "text-danger" : d <= 30 ? "text-warning" : "text-secondary";
  return (
    <FadeInUp>
      <div className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
        <p className="text-sm font-bold text-primary">
          🪑 Bench radar — rolling off within 60 days ({rows.length})
        </p>
        <ul className="mt-2 divide-y divide-subtle/60">
          {rows.map((r) => (
            <li key={r.project_employee_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-semibold text-primary">{r.employee_name}</span>
                {r.role_title && <span className="text-muted"> · {r.role_title}</span>}
                <span className="text-muted"> · {r.project_name}{r.customer_name ? ` (${r.customer_name})` : ""}</span>
              </span>
              <span className="inline-flex items-center gap-3">
                <span className={`font-semibold ${tone(r.days_left)}`}>
                  {r.days_left == null ? "—"
                    : r.days_left <= 0 ? `PO ended ${-r.days_left}d ago`
                    : `${r.days_left}d left`} {r.po_end_date ? `(${r.po_end_date})` : ""}
                </span>
                <button className={`${btnSecondary} !h-8 !px-2.5 !text-xs`} onClick={() => openMatches(r)}>
                  Find matches
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
      {matchFor && (
        <Modal title={`Redeployment matches — ${matchFor.employee_name}`} onClose={() => setMatchFor(null)}>
          {matchErr ? (
            <p className="text-sm text-danger">{matchErr}</p>
          ) : matches === null ? (
            <Spinner label="Scoring against open requirements…" />
          ) : matches.length === 0 ? (
            <p className="text-sm text-muted">No open requirements to match against right now.</p>
          ) : (
            <ul className="divide-y divide-subtle">
              {matches.map((m) => (
                <li key={m.requirement_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <CrmLink to={`requirements/${m.requirement_id}`} className="font-semibold text-brand-600 hover:underline dark:text-brand-300">
                      {m.opp_id || m.req_number} — {m.title}
                    </CrmLink>
                    {m.skills_matched.length > 0 && (
                      <span className="block text-xs text-muted">Matched: {m.skills_matched.join(", ")}</span>
                    )}
                  </span>
                  <span className={`text-sm font-bold tabular-nums ${
                    (m.match_score ?? 0) >= 60 ? "text-success" : (m.match_score ?? 0) >= 35 ? "text-warning" : "text-muted"
                  }`}>
                    {m.match_score ?? "—"}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </FadeInUp>
  );
}

/* ---------- Executive (Sales_Head) ---------- */

function ExecutiveSection() {
  const { data, loading, error, retry } = useDashData<ExecutiveData>("/api/dashboard/executive");
  if (loading) return <Section title="Executive Overview"><SectionLoading /></Section>;
  if (error || !data)
    return <Section title="Executive Overview"><ErrorBox error={error || "No data"} onRetry={retry} /></Section>;
  const quarters = data.quarterly_matrix.map((q) => ({ label: q.quarter, joined: q.joined_count, revenue: q.revenue }));
  return (
    <Section title="Executive Overview">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Tile label="Headcount" value={num(data.headcount)} to="employees" sub="active employees" />
        <Tile label="Customers" value={num(data.customer_count)} to="customers" tone="neutral" sub="active customers" />
        <Tile label="Projects" value={num(data.project_count)} to="projects" tone="success" sub="active projects" />
      </div>
      <Panel title="Quarter by quarter" hint="candidates joined and revenue billed, per financial-year quarter — tick a series or a quarter">
        <FilteredBars rowFilter rowLabel="Quarters" data={quarters} format={(v) => (v >= 1000 ? inrCompact(v) : num(v))}
                      series={[{ key: "revenue", label: "Revenue", color: 0 }, { key: "joined", label: "Joined", color: 2, defaultOff: true }]} />
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Opportunity funnel" hint="deals by pipeline stage, today">
          <FilteredBars rowFilter rowLabel="Stages" height={220} data={funnelData(data.opportunity_funnel, "stage")}
                        series={[{ key: "count", label: "Opportunities", color: 0 }]} />
        </Panel>
        <Panel title="Requirement funnel" hint="positions by sourcing status, today">
          <FilteredBars rowFilter rowLabel="Statuses" height={220} data={funnelData(data.requirement_funnel, "status")}
                        series={[{ key: "count", label: "Requirements", color: 3 }]} />
        </Panel>
      </div>
    </Section>
  );
}

/* ---------- Requirements overview (Sales / Sales_Head / RMG) ---------- */

function RequirementsSection() {
  const { data, loading, error, retry } = useDashData<RequirementsData>("/api/dashboard/requirements");
  if (loading) return <Section title="Requirements Overview"><SectionLoading /></Section>;
  if (error || !data)
    return <Section title="Requirements Overview"><ErrorBox error={error || "No data"} onRetry={retry} /></Section>;
  const days = (v: number | null) => (v === null || v === undefined ? "—" : `${v} days`);
  const total = data.positions.open + data.positions.filled;
  const fillPct = total ? (data.positions.filled / total) * 100 : null;
  const fillState: StateTone = fillPct === null ? "none" : fillPct >= 80 ? "ok" : fillPct >= 50 ? "warn" : "bad";
  const approvalDays = data.avg_days_in_stage.submission_to_sales_head_approval;
  const reviewDays = data.avg_days_in_stage.sales_head_to_engineering;
  const turnState = (d: number | null): StateTone => (d === null ? "none" : d <= 2 ? "ok" : d <= 5 ? "warn" : "bad");
  return (
    <Section title="Requirements Overview">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Positions open" value={num(data.positions.open)} to="opportunities" tone={data.positions.open ? "warning" : "success"} sub="non-terminal requirements" />
        <Tile label="Positions filled" value={num(data.positions.filled)} to="opportunities" tone="success" sub="fulfilled requirements" />
        <Tile label="Submit → Sales Head" value={days(approvalDays)} tone={turnState(approvalDays) === "ok" ? "success" : turnState(approvalDays) === "warn" ? "warning" : "danger"} sub="average approval turnaround" />
        <Tile label="Sales Head → RMG review" value={days(reviewDays)} tone={turnState(reviewDays) === "ok" ? "success" : turnState(reviewDays) === "warn" ? "warning" : "danger"} sub="average review turnaround" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,20rem),1fr]">
        <Panel title="Fill rate" hint="filled ÷ (open + filled)" action={<span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP[fillState]}`}>{pct(fillPct, 0)}</span>}>
          <Speedometer value={fillPct ?? 0} max={100} marker={80} markerLabel="goal" state={fillState} label="Fill rate" caption="filled" format={(v) => `${Math.round(v)}%`} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat k="Filled" v={num(data.positions.filled)} tone="ok" />
            <MiniStat k="Open" v={num(data.positions.open)} tone={data.positions.open ? "warn" : undefined} />
          </div>
        </Panel>
        <Panel title="Requirement funnel" hint="positions by sourcing status, today — tick a status to compare">
          <FilteredBars rowFilter rowLabel="Statuses" data={funnelData(data.funnel, "status")}
                        series={[{ key: "count", label: "Requirements", color: 0 }]} />
        </Panel>
      </div>
    </Section>
  );
}

/* ---------- RMG ---------- */

function RmgSection() {
  const { data, loading, error, retry } = useDashData<RmgData>("/api/dashboard/rmg");
  if (loading) return <Section title="RMG Pipeline"><SectionLoading /></Section>;
  if (error || !data)
    return <Section title="RMG Pipeline"><ErrorBox error={error || "No data"} onRetry={retry} /></Section>;
  const pipeline = data.pipeline.map((r) => ({
    label: r.opp_id || r.req_number, positions: r.no_of_positions, resumes: r.resumes_count,
    in_pipeline: Object.values(r.profiles_by_status).reduce((a, b) => a + b, 0),
  }));
  const screening = data.pending_screening ?? [];
  return (
    <Section title="RMG Pipeline">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Pending RMG reviews" value={num(data.totals.pending_engineering_reviews)} to="opportunities" tone={data.totals.pending_engineering_reviews ? "warning" : "success"} sub="requirements awaiting your JD & approval" />
        <Tile label="Pending screening" value={num(data.totals.pending_screening ?? 0)} to="screening-desk" tone={(data.totals.pending_screening ?? 0) ? "warning" : "success"} sub="applicants awaiting Shortlist / Reject" />
        <Tile label="Open requirements" value={num(data.pipeline.length)} to="opportunities" sub="in sourcing" />
        <Tile label="Resumes in play" value={num(data.pipeline.reduce((a, r) => a + r.resumes_count, 0))} to="screening-desk" tone="neutral" sub="across open requirements" />
      </div>
      <Panel title="Sourcing pipeline by position" hint="positions · resumes · candidates in the pipeline, per open requirement — tick a position to compare">
        {pipeline.length ? (
          <FilteredBars rowFilter rowLabel="Positions" data={pipeline}
                        series={[{ key: "positions", label: "Positions", color: 0 }, { key: "resumes", label: "Resumes", color: 3 }, { key: "in_pipeline", label: "In pipeline", color: 2 }]} />
        ) : <p className="text-sm text-muted">No open requirements in sourcing.</p>}
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Applicants awaiting RMG screening" hint="oldest first — the AI L1 stays locked until you decide"
               action={screening.length ? <CrmLink to="screening-desk" className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">Open the Screening Desk →</CrmLink> : undefined}>
          {screening.length ? (
            <ul className="divide-y divide-subtle">
              {screening.slice(0, 8).map((p) => (
                <li key={p.profile_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <CrmLink to={`profiles/${p.profile_id}`} className="font-semibold text-primary hover:underline">{p.candidate_name}</CrmLink>
                    <span className="ml-2 text-xs text-muted">{p.opportunity_title}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {p.ta_owner_name ? <>by {p.ta_owner_name} · </> : null}
                    {p.applied_on ? new Date(p.applied_on).toLocaleDateString("en-IN") : ""}
                  </div>
                </li>
              ))}
              {screening.length > 8 && <li className="pt-2 text-xs text-muted">+{screening.length - 8} more on the Screening Desk</li>}
            </ul>
          ) : <p className="text-sm text-muted">Nobody is waiting for screening.</p>}
        </Panel>
        <Panel title="Open requirements — pipeline volume" hint="where each position's candidates are">
          {data.pipeline.length ? (
            <div className={tableWrap}>
              <table className="w-full">
                <thead className={theadCls}>
                  <tr className="border-b border-subtle">
                    <th className={thCls}>Requirement</th>
                    <th className={thCls}>Customer</th>
                    <th className={`${thCls} text-right`}>Positions</th>
                    <th className={`${thCls} text-right`}>Resumes</th>
                    <th className={thCls}>Pipeline</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pipeline.map((r) => (
                    <tr key={r.req_number} className={trCls}>
                      <td className={tdCls}>
                        <div className="font-semibold text-primary">{r.opp_id || r.req_number}</div>
                        <div className="text-xs text-muted">{r.title}</div>
                      </td>
                      <td className={tdCls}>{r.customer}</td>
                      <td className={tdNum}>{r.no_of_positions}</td>
                      <td className={tdNum}>{r.resumes_count}</td>
                      <td className={tdCls}>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(r.profiles_by_status).length === 0 && <span className="text-xs text-muted">—</span>}
                          {Object.entries(r.profiles_by_status).map(([status, count]) => (
                            <span key={status} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ring-subtle ${statusColor(status)}`}>
                              {status.replace(/_/g, " ")} · {count}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState message="No open requirements in sourcing" />}
        </Panel>
      </div>
    </Section>
  );
}

/* ---------- TA ---------- */

function TaSection() {
  const { data, loading, error, retry } = useDashData<TaData>("/api/dashboard/ta");
  if (loading) return <Section title="Talent Acquisition"><SectionLoading /></Section>;
  if (error || !data)
    return <Section title="Talent Acquisition"><ErrorBox error={error || "No data"} onRetry={retry} /></Section>;
  const productivity = data.recruiter_productivity.map((r) => ({ label: r.user, today: r.resumes_screened_today, week: r.this_week, total: r.total, shortlisted: r.shortlisted_total }));
  return (
    <Section title="Talent Acquisition">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Open requirements" value={num(data.open_requirements_count)} to="opportunities" sub="sourcing · posted · in progress" />
        <Tile label="Resumes pending scan" value={num(data.resumes_pending_scan)} to="candidates" tone={data.resumes_pending_scan ? "warning" : "success"} sub="awaiting ATS" />
        <Tile label="AI interviews pending" value={num(data.interview_pending_queue.length)} to="calendar" tone="neutral" sub="scheduled, not yet taken" />
        <Tile label="Screened this week" value={num(data.recruiter_productivity.reduce((a, r) => a + r.this_week, 0))} to="profiles" tone="success" sub={`${num(data.recruiter_productivity.reduce((a, r) => a + r.resumes_screened_today, 0))} today`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Recruiter productivity" hint="resumes screened today · this week · all time · shortlisted — tick a recruiter to compare">
          {productivity.length ? (
            <FilteredBars rowFilter rowLabel="Recruiters" height={240} data={productivity}
                          series={[{ key: "today", label: "Today", color: 0 }, { key: "week", label: "This week", color: 3 },
                                   { key: "shortlisted", label: "Shortlisted", color: 2 }, { key: "total", label: "All time", color: 7, defaultOff: true }]} />
          ) : <EmptyState message="No screening activity yet" />}
        </Panel>
        <Panel title="AI interviews pending" hint="scheduled and waiting for the candidate">
          {data.interview_pending_queue.length ? (
            <ul className="divide-y divide-subtle">
              {data.interview_pending_queue.slice(0, 8).map((q) => (
                <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-semibold text-primary">{q.candidate_name}</span>
                    <CrmLink to={q.requirement_id ? `requirements/${q.requirement_id}` : "requirements"} className="ml-2 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">{q.requirement}</CrmLink>
                  </div>
                  <span className="text-xs text-secondary">{fmtDateTime12(q.scheduled_at)}</span>
                </li>
              ))}
              {data.interview_pending_queue.length > 8 && <li className="pt-2 text-xs text-muted">+{data.interview_pending_queue.length - 8} more on the Calendar</li>}
            </ul>
          ) : <EmptyState message="No interviews pending" />}
        </Panel>
      </div>
    </Section>
  );
}

/* ---------- Finance ---------- */

function FinanceSection() {
  const { data, loading, error, retry } = useDashData<FinanceData>("/api/dashboard/finance");
  if (loading) return <Section title="Finance"><SectionLoading /></Section>;
  if (error || !data)
    return <Section title="Finance"><ErrorBox error={error || "No data"} onRetry={retry} /></Section>;
  const poTotal = data.po_consumption.reduce((a, p) => a + p.total_value, 0);
  const poConsumed = data.po_consumption.reduce((a, p) => a + p.consumed_value, 0);
  const utilPct = poTotal ? (poConsumed / poTotal) * 100 : null;
  // A high utilisation means the POs are running out — renewals are due.
  const utilState: StateTone = utilPct === null ? "none" : utilPct < 70 ? "ok" : utilPct < 90 ? "warn" : "bad";
  const pos = data.po_consumption.map((p) => ({ label: p.po_number, consumed: p.consumed_value, balance: p.balance_value, total: p.total_value, pct: p.pct_consumed }));
  const nearlyOut = data.po_consumption.filter((p) => p.pct_consumed >= 90).length;
  return (
    <Section title="Finance">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Outstanding invoices" value={num(data.outstanding_invoices.count)} to="invoices" tone={data.outstanding_invoices.count ? "warning" : "success"} sub={`${inrCompact(data.outstanding_invoices.amount)} unpaid`} />
        <Tile label="Outstanding amount" value={inrCompact(data.outstanding_invoices.amount)} to="invoices" tone={data.outstanding_invoices.amount ? "warning" : "success"} sub="unpaid invoice balance" />
        <Tile label="TDS pending" value={num(data.tds_pending.count)} to="tds" tone={data.tds_pending.count ? "warning" : "success"} sub={`${inrCompact(data.tds_pending.amount)} to record`} />
        <Tile label="Active PO balance" value={inrCompact(poTotal - poConsumed)} to="pos" tone={nearlyOut ? "danger" : "brand"} sub={nearlyOut ? `${nearlyOut} PO(s) ≥ 90 % used` : `${num(data.po_consumption.length)} active POs`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,20rem),1fr]">
        <Panel title="PO utilisation" hint="consumed ÷ total of the active POs — high means renewals are due" action={<span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP[utilState]}`}>{pct(utilPct, 0)}</span>}>
          <Speedometer value={utilPct ?? 0} max={100} marker={90} markerLabel="renew" state={utilState} invert label="PO utilisation" caption="consumed" format={(v) => `${Math.round(v)}%`} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat k="Consumed" v={inrCompact(poConsumed)} />
            <MiniStat k="Balance" v={inrCompact(poTotal - poConsumed)} tone={utilState === "none" ? undefined : utilState} />
          </div>
        </Panel>
        <Panel title="PO consumption" hint="active POs, top 20 by value — consumed vs balance, tick a PO to compare">
          {pos.length ? (
            <FilteredBars rowFilter rowLabel="Purchase orders" stacked format={inrCompact} data={pos}
                          series={[{ key: "consumed", label: "Consumed", color: 5 }, { key: "balance", label: "Balance", color: 2 },
                                   { key: "total", label: "Total", color: 7, defaultOff: true, stackId: "total" }, { key: "pct", label: "% used", color: 3, defaultOff: true, stackId: "pct" }]} />
          ) : <EmptyState message="No active purchase orders" />}
        </Panel>
      </div>
    </Section>
  );
}

/* ---------- HR — the CEO's People tab on its own desk ---------- */

function HrPeopleSection() {
  const [period, setPeriod] = useState<PeriodKind>("fy");
  const [month, setMonth] = useState<string>(thisMonthKey());
  const { data, loading, error, retry } = useDashData<CeoPayload<PeopleData>>(`/api/dashboard/people${qs({ month, period })}`);
  const atCurrent = data ? data.period.is_current || data.period.end >= new Date().toISOString().slice(0, 10) : month >= thisMonthKey();
  return (
    <section className="space-y-4" aria-label="People dashboard">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-subtle bg-surface-1 px-5 py-3 shadow-raised">
        <div className="min-w-0">
          <h2 className="text-display text-base font-bold text-primary">People</h2>
          <p className="text-xs text-muted">{data ? `${data.period.label} · as of ${data.as_of}` : "Headcount, deployed vs bench, joiners and exits, roll-offs"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodSwitcher value={period} onChange={setPeriod} />
          <DateStepper month={month} period={period} atCurrent={atCurrent} onShift={(d) => setMonth((m) => shiftMonthKey(m, d))} onPick={setMonth} />
          <button type="button" className={ICON_BTN} onClick={retry} aria-label="Refresh" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
          </button>
        </div>
      </header>
      {error && <ErrorBox error={error} onRetry={retry} />}
      {!data && loading && !error && <SectionLoading />}
      {data && <PeopleTab d={data.data} period={data.period} />}
    </section>
  );
}

/* ---------- Page ---------- */

/* ---------- Start Here (17 Aug 2026) ----------
 * A new user's first minute: 12 sidebar entries and no idea of order. This
 * card shows the person's OWN workflow as numbered links, once, and goes away
 * forever on Dismiss (localStorage). First matching role wins. */
const START_HERE: { match: string[]; steps: { label: string; to: string; desc: string }[] }[] = [
  {
    match: ["Admin", "CEO"],
    steps: [
      { label: "Users", to: "users", desc: "create logins and assign CRM roles" },
      { label: "Access Templates", to: "access-templates", desc: "control what each role sees and edits" },
      { label: "Settings", to: "settings", desc: "organisation, billing, background jobs and UI text" },
    ],
  },
  {
    match: ["Sales_Head"],
    steps: [
      { label: "Opportunities", to: "opportunities", desc: "review and approve deals Sales created" },
      { label: "Customers", to: "customers", desc: "branches, policies and CTC slabs live here" },
      { label: "Projects", to: "projects", desc: "delivery: employees, timesheets, POs and invoices" },
    ],
  },
  {
    match: ["Sales"],
    steps: [
      { label: "Customers", to: "customers", desc: "create the customer, its branches and contacts" },
      { label: "CTC Slab", to: "customers", desc: "open a branch → CTC Slab tab → build the rate ladder" },
      { label: "Opportunities", to: "opportunities", desc: "create the deal — Sales Head approves it" },
      { label: "Timesheets", to: "projects", desc: "approve submitted sheets from the Projects hub" },
    ],
  },
  {
    match: ["RMG"],
    steps: [
      { label: "Opportunities", to: "opportunities", desc: "engineering review — attach the JD and approve" },
      { label: "Candidate Profiles", to: "profiles", desc: "move candidates through your review stages" },
      { label: "Projects", to: "projects", desc: "approve timesheets from the Timesheets tab" },
    ],
  },
  {
    match: ["TA"],
    steps: [
      { label: "Candidates", to: "candidates", desc: "the master list — add or import people" },
      { label: "Opportunities", to: "opportunities", desc: "open one → Suggested Candidates → bulk apply" },
      { label: "Template Requests", to: "template-requests", desc: "request AI interviews and schedule them" },
    ],
  },
  {
    match: ["Finance"],
    steps: [
      { label: "Purchase Orders", to: "pos", desc: "record the customer's PO first — invoices draw it down" },
      { label: "Invoices", to: "invoices", desc: "generate from approved timesheets, record payments" },
      { label: "TDS", to: "tds", desc: "track deductions against invoices" },
    ],
  },
  {
    match: ["HR"],
    steps: [
      { label: "Employees", to: "employees", desc: "the HR master — personal, CTC and bank details" },
      { label: "Leave Applications", to: "leave-applications", desc: "approve or reject employee leave" },
      { label: "Holidays", to: "holidays", desc: "holidays drive timesheet pre-marking and billing" },
    ],
  },
];

const START_HERE_KEY = "crm.startHere.dismissed";

/** Icon per destination (CTC Slab shares `customers` and is keyed by label). */
const STEP_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  users: Users, "access-templates": ShieldCheck, settings: Settings, opportunities: Briefcase,
  customers: Building2, "CTC Slab": Layers, projects: FolderKanban, profiles: UserCheck,
  candidates: UserSearch, "template-requests": CalendarClock, pos: FileText, invoices: Receipt,
  tds: Percent, employees: Users, "leave-applications": CalendarCheck, holidays: CalendarDays,
};

const STEP_ACCENT = ["from-brand-500 to-brand-700", "from-violet-500 to-fuchsia-600", "from-emerald-500 to-teal-600", "from-amber-500 to-orange-600"];

/**
 * "Start here" (redesigned 28 Sep 2026): the person's own workflow as a
 * journey — numbered step cards joined by arrows, each a link with an icon —
 * instead of a plain numbered list. Same data (`START_HERE`), same one-time
 * dismiss; first matching role wins.
 */
export function StartHereCard() {
  const me = useMe();
  const [hidden, setHidden] = useState(() => {
    try { return window.localStorage.getItem(START_HERE_KEY) === "1"; } catch { return false; }
  });
  if (hidden) return null;
  const roles = me.roles || [];
  const plan = START_HERE.find((p) => p.match.some((r) => roles.includes(r)));
  if (!plan) return null;
  const dismiss = () => {
    try { window.localStorage.setItem(START_HERE_KEY, "1"); } catch { /* ignore */ }
    setHidden(true);
  };
  return (
    <section className="fx-aurora relative overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised" aria-label="Start here — your workflow">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-card bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-raised">
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-bold text-primary">Start here — your workflow</h2>
            <p className="text-xs text-muted">The order things happen in for your role. Click a step to go there.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <p className="hidden text-xs text-muted md:block">
            <kbd className="rounded border border-subtle bg-surface-2 px-1.5 py-0.5 font-semibold">Ctrl</kbd>+<kbd className="rounded border border-subtle bg-surface-2 px-1.5 py-0.5 font-semibold">K</kbd> jump anywhere ·{" "}
            <kbd className="rounded border border-subtle bg-surface-2 px-1.5 py-0.5 font-semibold">Ctrl</kbd>+<kbd className="rounded border border-subtle bg-surface-2 px-1.5 py-0.5 font-semibold">/</kbd> ask AI
          </p>
          <button type="button" onClick={dismiss} aria-label="Dismiss" title="Dismiss — this card will not show again"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-control text-muted transition-colors duration-micro hover:bg-surface-2 hover:text-primary">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
      <ol className="flex flex-col gap-2 p-4 md:flex-row md:items-stretch">
        {plan.steps.map((st, i) => {
          const Icon = STEP_ICON[st.label] || STEP_ICON[st.to] || ArrowRight;
          const accent = STEP_ACCENT[i % STEP_ACCENT.length];
          return (
            <li key={st.to + i} className="flex min-w-0 flex-1 items-stretch gap-2">
              <CrmLink to={st.to} className="fx-lift group relative flex min-w-0 flex-1 items-center gap-3 overflow-hidden rounded-card border border-subtle bg-surface-1 px-4 py-3 transition-shadow duration-micro hover:shadow-overlay">
                <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accent}`} aria-hidden />
                <span className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-gradient-to-br text-white shadow-raised ${accent}`}>
                  <Icon className="h-5 w-5" />
                  <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-surface-1 bg-surface-3 text-[10px] font-bold text-primary">{i + 1}</span>
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-primary group-hover:text-brand-600 dark:group-hover:text-brand-300">{st.label}</span>
                  <span className="block text-xs leading-snug text-secondary">{st.desc}</span>
                </span>
              </CrmLink>
              {i < plan.steps.length - 1 && (
                <span className="hidden shrink-0 items-center text-muted md:flex" aria-hidden><ArrowRight className="h-4 w-4" /></span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

type TaTrackRow = {
  user_id: number; name: string; applied: number; active: number;
  shortlisted: number; joined: number; rejected: number; interviews_scheduled: number;
};
type TaTrackData = {
  rows: TaTrackRow[];
  totals: { tas: number; applied: number; interviews_scheduled: number; shortlisted: number; joined: number };
};

/** Per-TA recruiting scorecard. `mine` = a TA viewing only their own record;
 * otherwise Admin/CEO see every recruiter. Attribution is ta_owner_id, stamped
 * when a candidate is applied to an opportunity. */
function TaTrackingSection({ mine }: { mine: boolean }) {
  const { data, loading, error, retry } = useDashData<TaTrackData>("/api/dashboard/ta-tracking");
  const title = mine ? "My Recruiting Scorecard" : "TA Tracking";
  if (loading) return <Section title={title}><SectionLoading /></Section>;
  if (error || !data)
    return <Section title={title}><ErrorBox error={error || "No data"} onRetry={retry} /></Section>;
  const t = data.totals;
  const convPct = t.applied ? (t.joined / t.applied) * 100 : null;
  const convState: StateTone = convPct === null ? "none" : convPct >= 20 ? "ok" : convPct >= 10 ? "warn" : "bad";
  const rows = data.rows.map((r) => ({ label: r.name, applied: r.applied, active: r.active, interviews: r.interviews_scheduled, shortlisted: r.shortlisted, joined: r.joined, rejected: r.rejected }));
  return (
    <Section title={title}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {!mine && <Tile label="Active TAs" value={num(t.tas)} to="users" tone="neutral" />}
        <Tile label="Candidates applied" value={num(t.applied)} to="profiles" sub="attributed to a TA" />
        <Tile label="Interviews scheduled" value={num(t.interviews_scheduled)} to="calendar" tone="neutral" />
        <Tile label="Shortlisted" value={num(t.shortlisted)} to="profiles" tone="success" />
        <Tile label="Joined" value={num(t.joined)} to="profiles?f_state=joined" tone="success" sub={`${pct(convPct, 0)} of applied`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,20rem),1fr]">
        <Panel title="Applied → joined" hint="joined ÷ candidates applied" action={<span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP[convState]}`}>{pct(convPct, 0)}</span>}>
          <Speedometer value={convPct ?? 0} max={50} marker={20} markerLabel="goal" state={convState} label="Conversion" caption="joined" format={(v) => `${Math.round(v)}%`} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat k="Applied" v={num(t.applied)} />
            <MiniStat k="Joined" v={num(t.joined)} tone="ok" />
          </div>
        </Panel>
        <Panel title={mine ? "Your funnel" : "By recruiter"} hint="applied · active · interviews · shortlisted · joined · rejected — tick a series or a recruiter">
          {rows.length ? (
            <FilteredBars rowFilter={!mine} rowLabel="Recruiters" height={240} data={rows}
                          series={[{ key: "applied", label: "Applied", color: 0 }, { key: "active", label: "Active", color: 3, defaultOff: true },
                                   { key: "interviews", label: "Interviews", color: 1 }, { key: "shortlisted", label: "Shortlisted", color: 2 },
                                   { key: "joined", label: "Joined", color: 4 }, { key: "rejected", label: "Rejected", color: 5, defaultOff: true }]} />
          ) : (
            <EmptyState message={mine
              ? "You haven't applied any candidates yet — apply from Suggested Candidates or a candidate's profile."
              : "No TA activity yet."} />
          )}
        </Panel>
      </div>
    </Section>
  );
}

export function CrmDashboardPage() {
  const me = useMe();
  const isAdmin = me.roles.includes("Admin") || me.roles.includes("CEO");
  const showExecutive = useHasRole("Sales_Head");
  const showRequirements = useHasRole("Sales", "Sales_Head", "RMG");
  const showRmg = useHasRole("RMG");
  const showTa = useHasRole("TA");
  const showTaTracking = isAdmin || showTa;
  const showFinance = useHasRole("Finance");
  const showHr = useHasRole("HR");
  // PO expiry warnings: Finance/Admin plus Sales & Sales Head (they own the
  // customer relationship and drive PO renewals before billing breaks).
  const showPoExpiry = useHasRole("Finance", "Sales", "Sales_Head");
  const showBench = useHasRole("RMG", "Sales_Head");
  // The Sales → TA control tower (23 Sep 2026): every desk except a pure
  // HR / Finance login reads the same positions, onboardings and pace.
  const showHiringTower = useShowsHiringTower();
  const nothing = !showExecutive && !showRequirements && !showRmg && !showTa && !showFinance && !showTaTracking && !showHr;

  // CEO outranks Admin on the chip — a CEO login usually carries both roles.
  // …and a custom role (Sales Manager, GM) is named as itself, never as the
  // built-in roles it carries (29 Sep 2026).
  const roleLabel = roleTitle(me);
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="space-y-6 xl:space-y-8">
      {/* Zone 0 — who and when. The four desk zones follow. */}
      <FadeInUp>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-display w-fit text-xl font-bold text-primary">
            Good {new Date().getHours() < 12 ? "Morning" : new Date().getHours() < 17 ? "Afternoon" : "Evening"}, {me.full_name || me.username}
            {roleLabel && (
              <span className="ml-2 align-middle rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold tracking-wide text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                {roleLabel}
              </span>
            )}
          </h1>
          <p className="text-sm text-muted">{today}</p>
        </div>
      </FadeInUp>
      {/* The login's daily tasks as tabs (28 Sep 2026) — feedback due, rounds
          to schedule, candidates awaiting a call, screening, upcoming, queues.
          The server picks the tabs; every role gets its own set. */}
      <WorkDesk />
      {/* Admin / CEO (28 Sep 2026): the company view and nothing else — Finance
          (revenue) is the first tab, so it is the first thing on the page.
          Its Sales tab IS the hiring control tower. The desk widgets (Today
          strip · My work · Coming up · Quick actions · Team) were removed from
          EVERY role's dashboard the same day at the user's request; the
          server endpoints behind them still serve the bell links. */}
      {isAdmin ? (
        <>
          <CeoDashboard />
          <StartHereCard />
        </>
      ) : (
        <>
          <StartHereCard />
          {showHiringTower && <HiringControlTower />}
          {showPoExpiry && <PoExpiryPanel />}
          {showBench && <BenchCard />}
          {showExecutive && <ExecutiveSection />}
          {showRequirements && <RequirementsSection />}
          {showRmg && <RmgSection />}
          {showTa && <TaSection />}
          {showTaTracking && <TaTrackingSection mine />}
          {showFinance && <FinanceSection />}
          {showHr && <HrPeopleSection />}
        </>
      )}
      {nothing && !isAdmin && (
        <div className="rounded-card border border-subtle bg-surface-1 shadow-raised">
          <EmptyState
            message={`No dashboard widgets for your roles — nothing to show for ${me.roles.join(", ") || "your current roles"}. Use the sidebar to navigate.`}
          />
        </div>
      )}
    </div>
  );
}
