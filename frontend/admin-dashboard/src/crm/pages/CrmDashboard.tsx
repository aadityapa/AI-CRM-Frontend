/** Role-adaptive CRM dashboard — each role section loads its own endpoint
 * independently, so one failing widget never kills the rest of the page. */
import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartPalette, chartPaletteDark, neutral, radius } from "../../design-system/tokens/tokens";
import { useTheme } from "../../theme/ThemeProvider";
import { crmGet } from "../api";
import { useHasRole, useMe } from "../CrmApp";
import { CrmLink } from "../routerHooks";
import { FadeInUp, Stagger } from "../components/motion3d";
import { EmptyState, ErrorBox, KpiCard, SkeletonText, StatusBadge, statusColor } from "../components/ui";

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
    title: string;
    customer: string;
    no_of_positions: number;
    resumes_count: number;
    profiles_by_status: Record<string, number>;
  }[];
  totals: { pending_engineering_reviews: number };
};

type TaData = {
  open_requirements_count: number;
  resumes_pending_scan: number;
  interview_pending_queue: {
    id: number;
    candidate_name: string;
    requirement: string;
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

const inr = (n: number) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

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

function Card({ title, children, ai }: { title: string; children: React.ReactNode; ai?: boolean }) {
  return (
    /* v3: AI-related cards swap the plain border for the animated gradient
       hairline (.fx-gradient-border-animated — AI surfaces only) + a cyan
       accent dot in the header. Everything else is unchanged. */
    <div
      className={`rounded-card bg-surface-1 p-5 shadow-raised transition-shadow duration-micro ease-smooth hover:shadow-overlay ${
        ai ? "fx-gradient-border-animated" : "border border-subtle"
      }`}
    >
      <div className="mb-4 flex items-center gap-2 text-sm font-bold text-primary">
        {ai && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" aria-hidden />}
        {title}
      </div>
      {children}
    </div>
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

/** Small horizontal-bar funnel (recharts) — colors come from the design-system
 * chart palette (theme-aware via useTheme; static mirrors by design). */
function FunnelBarChart({ data, nameKey }: { data: FunnelEntry[]; nameKey: "stage" | "status" }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const palette = dark ? chartPaletteDark : chartPalette;
  const axis = dark ? neutral[400] : neutral[500];
  const rows = data.map((d) => ({ name: String(d[nameKey] || "").replace(/_/g, " "), count: d.count }));
  return (
    <div style={{ height: Math.max(rows.length * 34 + 40, 120) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={axis} strokeOpacity={0.2} horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={{ fill: axis, fontSize: 12 }} />
          <YAxis
            type="category"
            dataKey="name"
            width={170}
            tick={{ fill: axis, fontSize: 12 }}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: axis, fillOpacity: 0.08 }}
            contentStyle={{
              /* v3 tooltip recipe: surface-3 + rounded-card + border-subtle
                 (theme-aware via CSS vars — no per-theme branches needed). */
              borderRadius: radius.card,
              border: "1px solid var(--border-subtle)",
              boxShadow: "var(--elev-overlay)",
              background: "var(--surface-3)",
              color: "var(--text-primary)",
              fontSize: 12,
              fontWeight: 600,
            }}
          />
          <Bar
            dataKey="count"
            fill={palette[0]}
            radius={[0, radius.input, radius.input, 0]}
            barSize={18}
            animationDuration={250}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Compact status-badge + count list (funnel widget). */
function FunnelList({ data }: { data: { status: string; count: number }[] }) {
  return (
    <ul className="divide-y divide-subtle">
      {data.map((f) => (
        <li key={f.status} className="flex items-center justify-between py-2">
          <StatusBadge status={f.status} />
          <span className="text-sm font-bold tabular-nums text-primary">{f.count}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------- Executive (Sales_Head / Admin) ---------- */

function ExecutiveSection() {
  const { data, loading, error, retry } = useDashData<ExecutiveData>("/api/dashboard/executive");
  if (loading) return <Section title="Executive Overview"><SectionLoading /></Section>;
  if (error || !data)
    return <Section title="Executive Overview"><ErrorBox error={error || "No data"} onRetry={retry} /></Section>;
  return (
    <Section title="Executive Overview">
      <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Headcount" value={data.headcount} sub="Active employees" />
        <KpiCard label="Customers" value={data.customer_count} sub="Active customers" />
        <KpiCard label="Projects" value={data.project_count} sub="Active projects" />
      </Stagger>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Opportunity Funnel">
          <FunnelBarChart data={data.opportunity_funnel} nameKey="stage" />
        </Card>
        <div className="space-y-4">
          <Card title="Quarterly Matrix">
            <div className="overflow-x-auto">
              <table className="w-full min-w-max lg:min-w-0">
                <thead className={theadCls}>
                  <tr className="border-b border-subtle">
                    <th className={thCls}>Quarter</th>
                    <th className={`${thCls} text-right`}>Joined</th>
                    <th className={`${thCls} text-right`}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.quarterly_matrix.map((q) => (
                    <tr key={q.quarter} className={trCls}>
                      <td className={`${tdCls} font-semibold text-primary`}>{q.quarter}</td>
                      <td className={tdNum}>{q.joined_count}</td>
                      <td className={tdNum}>{inr(q.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Requirement Funnel">
            <FunnelList data={data.requirement_funnel} />
          </Card>
        </div>
      </div>
    </Section>
  );
}

/* ---------- Requirements overview (Sales / Sales_Head / RMG / Admin) ---------- */

function RequirementsSection() {
  const { data, loading, error, retry } = useDashData<RequirementsData>("/api/dashboard/requirements");
  if (loading) return <Section title="Requirements Overview"><SectionLoading /></Section>;
  if (error || !data)
    return <Section title="Requirements Overview"><ErrorBox error={error || "No data"} onRetry={retry} /></Section>;
  const days = (v: number | null) => (v === null || v === undefined ? "—" : `${v} days`);
  return (
    <Section title="Requirements Overview">
      <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Positions Open" value={data.positions.open} sub="Non-terminal requirements" />
        <KpiCard label="Positions Filled" value={data.positions.filled} sub="Fulfilled requirements" />
        <KpiCard
          label="Avg: Submit → Sales Head"
          value={days(data.avg_days_in_stage.submission_to_sales_head_approval)}
          sub="Approval turnaround"
        />
        <KpiCard
          label="Avg: Sales Head → Engineering"
          value={days(data.avg_days_in_stage.sales_head_to_engineering)}
          sub="Review turnaround"
        />
      </Stagger>
      <Card title="Requirement Funnel">
        <FunnelBarChart data={data.funnel} nameKey="status" />
      </Card>
    </Section>
  );
}

/* ---------- RMG (RMG / Admin) ---------- */

function RmgSection() {
  const { data, loading, error, retry } = useDashData<RmgData>("/api/dashboard/rmg");
  if (loading) return <Section title="RMG Pipeline"><SectionLoading /></Section>;
  if (error || !data)
    return <Section title="RMG Pipeline"><ErrorBox error={error || "No data"} onRetry={retry} /></Section>;
  return (
    <Section title="RMG Pipeline">
      <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Pending Engineering Reviews"
          value={data.totals.pending_engineering_reviews}
          sub="Requirements awaiting review"
        />
      </Stagger>
      <Card title="Open Requirements — Sourcing Pipeline">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max lg:min-w-0">
            <thead className={theadCls}>
              <tr className="border-b border-subtle">
                <th className={thCls}>Requirement</th>
                <th className={thCls}>Customer</th>
                <th className={`${thCls} text-right`}>Positions</th>
                <th className={`${thCls} text-right`}>Resumes</th>
                <th className={thCls}>Pipeline Volume</th>
              </tr>
            </thead>
            <tbody>
              {data.pipeline.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState message="No open requirements in sourcing" />
                  </td>
                </tr>
              )}
              {data.pipeline.map((r) => (
                <tr key={r.req_number} className={trCls}>
                  <td className={tdCls}>
                    <div className="font-semibold text-primary">{r.req_number}</div>
                    <div className="text-xs text-muted">{r.title}</div>
                  </td>
                  <td className={tdCls}>{r.customer}</td>
                  <td className={tdNum}>{r.no_of_positions}</td>
                  <td className={tdNum}>{r.resumes_count}</td>
                  <td className={tdCls}>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(r.profiles_by_status).length === 0 && (
                        <span className="text-xs text-muted">—</span>
                      )}
                      {Object.entries(r.profiles_by_status).map(([status, count]) => (
                        <span
                          key={status}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset ring-subtle ${statusColor(status)}`}
                        >
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
      </Card>
    </Section>
  );
}

/* ---------- TA (TA / Admin) ---------- */

function TaSection() {
  const { data, loading, error, retry } = useDashData<TaData>("/api/dashboard/ta");
  if (loading) return <Section title="Talent Acquisition"><SectionLoading /></Section>;
  if (error || !data)
    return <Section title="Talent Acquisition"><ErrorBox error={error || "No data"} onRetry={retry} /></Section>;
  return (
    <Section title="Talent Acquisition">
      <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <KpiCard label="Open Requirements" value={data.open_requirements_count} sub="Sourcing / posted / in progress" />
        <KpiCard label="Resumes Pending Scan" value={data.resumes_pending_scan} sub="Awaiting ATS scan" />
      </Stagger>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Recruiter Productivity">
          <div className="overflow-x-auto">
            <table className="w-full min-w-max lg:min-w-0">
              <thead className={theadCls}>
                <tr className="border-b border-subtle">
                  <th className={thCls}>Recruiter</th>
                  <th className={`${thCls} text-right`}>Today</th>
                  <th className={`${thCls} text-right`}>This Week</th>
                  <th className={`${thCls} text-right`}>Total</th>
                  <th className={`${thCls} text-right`}>Shortlisted</th>
                </tr>
              </thead>
              <tbody>
                {data.recruiter_productivity.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState message="No screening activity yet" />
                    </td>
                  </tr>
                )}
                {data.recruiter_productivity.map((r) => (
                  <tr key={r.user} className={trCls}>
                    <td className={`${tdCls} font-semibold text-primary`}>{r.user}</td>
                    <td className={tdNum}>{r.resumes_screened_today}</td>
                    <td className={tdNum}>{r.this_week}</td>
                    <td className={tdNum}>{r.total}</td>
                    <td className={tdNum}>{r.shortlisted_total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="AI Interviews Pending" ai>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max lg:min-w-0">
              <thead className={theadCls}>
                <tr className="border-b border-subtle">
                  <th className={thCls}>Candidate</th>
                  <th className={thCls}>Requirement</th>
                  <th className={thCls}>Scheduled At</th>
                </tr>
              </thead>
              <tbody>
                {data.interview_pending_queue.length === 0 && (
                  <tr>
                    <td colSpan={3}>
                      <EmptyState message="No interviews pending" />
                    </td>
                  </tr>
                )}
                {data.interview_pending_queue.map((q) => (
                  <tr key={q.id} className={trCls}>
                    <td className={`${tdCls} font-semibold text-primary`}>{q.candidate_name}</td>
                    <td className={tdCls}>
                      {/* Backend supplies req_number only (no id) — deep-link to the requirements list. */}
                      <CrmLink
                        to="requirements"
                        title="Open requirements"
                        className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
                      >
                        {q.requirement}
                      </CrmLink>
                    </td>
                    <td className={tdCls}>{q.scheduled_at ? new Date(q.scheduled_at).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Section>
  );
}

/* ---------- Finance (Finance / Admin) ---------- */

function FinanceSection() {
  const { data, loading, error, retry } = useDashData<FinanceData>("/api/dashboard/finance");
  if (loading) return <Section title="Finance"><SectionLoading /></Section>;
  if (error || !data)
    return <Section title="Finance"><ErrorBox error={error || "No data"} onRetry={retry} /></Section>;
  return (
    <Section title="Finance">
      <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Outstanding Invoices"
          value={data.outstanding_invoices.count}
          sub={`Balance ${inr(data.outstanding_invoices.amount)}`}
        />
        <KpiCard
          label="Outstanding Amount"
          value={inr(data.outstanding_invoices.amount)}
          sub="Unpaid invoice balance"
        />
        <KpiCard
          label="TDS Pending"
          value={data.tds_pending.count}
          sub={`Balance ${inr(data.tds_pending.amount)}`}
        />
      </Stagger>
      <Card title="PO Consumption (Active, top 20 by value)">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max lg:min-w-0">
            <thead className={theadCls}>
              <tr className="border-b border-subtle">
                <th className={thCls}>PO Number</th>
                <th className={`${thCls} text-right`}>Total</th>
                <th className={`${thCls} text-right`}>Consumed</th>
                <th className={`${thCls} text-right`}>Balance</th>
                <th className={`${thCls} w-56`}>Consumption</th>
              </tr>
            </thead>
            <tbody>
              {data.po_consumption.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState message="No active purchase orders" />
                  </td>
                </tr>
              )}
              {data.po_consumption.map((po) => {
                const pct = Math.max(0, Math.min(100, po.pct_consumed));
                return (
                  <tr key={po.po_number} className={trCls}>
                    <td className={`${tdCls} font-semibold text-primary`}>{po.po_number}</td>
                    <td className={tdNum}>{inr(po.total_value)}</td>
                    <td className={tdNum}>{inr(po.consumed_value)}</td>
                    <td className={tdNum}>{inr(po.balance_value)}</td>
                    <td className={tdCls}>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                          <motion.div
                            className={`h-2 rounded-full ${
                              pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warning" : "bg-brand-500"
                            }`}
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
                          />
                        </div>
                        <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums text-muted">
                          {po.pct_consumed}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </Section>
  );
}

/* ---------- Page ---------- */

export function CrmDashboardPage() {
  const me = useMe();
  const showExecutive = useHasRole("Sales_Head");
  const showRequirements = useHasRole("Sales", "Sales_Head", "RMG");
  const showRmg = useHasRole("RMG");
  const showTa = useHasRole("TA");
  const showFinance = useHasRole("Finance");
  const nothing = !showExecutive && !showRequirements && !showRmg && !showTa && !showFinance;

  return (
    <div className="space-y-8">
      <FadeInUp>
        <h1 className="text-display w-fit text-xl font-bold text-primary">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted">
          Welcome back, {me.full_name || me.username}
        </p>
      </FadeInUp>
      {showExecutive && <ExecutiveSection />}
      {showRequirements && <RequirementsSection />}
      {showRmg && <RmgSection />}
      {showTa && <TaSection />}
      {showFinance && <FinanceSection />}
      {nothing && (
        <div className="rounded-card border border-subtle bg-surface-1 shadow-raised">
          <EmptyState
            message={`No dashboard widgets for your roles — nothing to show for ${me.roles.join(", ") || "your current roles"}. Use the sidebar to navigate.`}
          />
        </div>
      )}
    </div>
  );
}
