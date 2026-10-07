/** CRM Reports — three tabbed reports (opportunities, candidate profiles,
 * recruiter productivity) with per-tab filters and CSV export, plus the
 * Financial Reports tab (Admin/Finance/Sales_Head) and the CEO Revenue tab
 * (Admin/CEO ONLY — server-enforced by `GET /api/reports/revenue`). */
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3, Briefcase, Download, IndianRupee, Landmark, TrendingUp, UserSearch, type LucideIcon,
} from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { authFetch } from "../../api/client";
import { qs, crmGet } from "../api";
import { useHasRole, useMe } from "../CrmApp";
import { crmTabVisibleFromMe } from "../useAccess";
import { FinanceReportsPage } from "./FinanceReports";
import { RevenueReport } from "./reports/RevenueReport";
import { RecruiterProductivity } from "./reports/RecruiterProductivity";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { ErrorBox, Field, StatusBadge, btnSecondary, inputCls, useToast } from "../components/ui";
import { CandidateStageBadge, CandidateStatusBadge } from "../components/CandidateStatusBadge";
import { Tile, inrCompact } from "../components/controlTower";
import type { CandidateStatus } from "../components/CandidateStatusBadge";
import { usePageTab } from "../lib/pageState";
import { fmtDateShort } from "../../lib/datetime";

type TabKey = "opportunities" | "profiles" | "productivity" | "financial" | "revenue";

const TABS = [
  { key: "opportunities", label: "Opportunities" },
  { key: "profiles", label: "Candidate Profiles" },
  { key: "productivity", label: "Recruiter Productivity" },
];

/* Financial Reports lives INSIDE Reports since Aug 2026 (no standalone
   sidebar page) — the tab appears only for Admin/Finance/Sales_Head,
   mirroring the old sidebar entry's role rules + Access Templates. */
const FINANCIAL_TAB = { key: "financial", label: "Financial Reports" };

/* CEO Revenue (Sep 2026) — Admin/CEO only, no template can widen it; the
   dashboard "Revenue this month" tile deep-links here via `?tab=revenue`. */
const REVENUE_TAB = { key: "revenue", label: "Revenue" };

/** Presentation for the report picker (icon · one line · accent). Keys match
 *  the tab keys above; purely visual. */
const TAB_LOOK: Record<string, { icon: LucideIcon; blurb: string; tone: string }> = {
  opportunities: { icon: Briefcase, blurb: "Every deal by team and stage, with RFI value.", tone: "from-sky-500 to-indigo-600" },
  profiles: { icon: UserSearch, blurb: "Candidates in the pipeline with CTC and hike.", tone: "from-violet-500 to-fuchsia-600" },
  productivity: { icon: TrendingUp, blurb: "Each recruiter's sourcing, pipeline and outcomes in a window.", tone: "from-emerald-500 to-teal-600" },
  financial: { icon: Landmark, blurb: "POs, invoices, payments and TDS in one place.", tone: "from-amber-500 to-orange-600" },
  revenue: { icon: IndianRupee, blurb: "Billed, collected, margin and cash flow.", tone: "from-rose-500 to-pink-600" },
};

/** Tabs that host their own component (no shared DataTable / CSV export). */
const HOSTED_TABS: ReadonlySet<TabKey> = new Set<TabKey>(["financial", "revenue", "productivity"]);

const TEAM_OPTIONS = ["Sales", "RMG", "TA"];
const OPP_STATUS_OPTIONS = ["Active", "On Hold", "Rejected", "Closed", "Archived"];
const PROFILE_STATUS_OPTIONS = ["Active", "Rejected", "Joined"];

const CSV_FILENAMES: Record<Exclude<TabKey, "financial" | "revenue" | "productivity">, string> = {
  opportunities: "opportunities-report.csv",
  profiles: "candidate-profiles-report.csv",
};

const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
// en-IN day-month-year (the locale-dependent `toLocaleDateString` printed 9/28/2026 on en-US boxes).
const dt = (s: string | null | undefined) => fmtDateShort(s, "—");

/* ---------- Row shapes (services/reports.py) ---------- */

type OppRow = {
  opp_id: string;
  title: string;
  customer: string;
  customer_id?: number | null;
  stage: string;
  approval_status?: string | null;
  opp_type: string;
  rfi_value: number | null;
  positions_total?: number | null;
  positions_open?: number | null;
  positions_joined?: number | null;
  position_status?: string | null;
  created_by?: string;
  created_by_username: string;
  created_at: string | null;
};

type OppSummary = {
  count: number; rfi_total: number; rfi_known: number;
  positions_total: number; positions_open: number; positions_joined: number;
  by_stage: Record<string, number>; by_type: Record<string, number>;
};
type ProfileSummary = {
  count: number; joined: number; closed: number; live: number; avg_hike_percent: number | null;
  by_stage: Record<string, number>; by_group: Record<string, number>;
};

type ProfileRow = {
  candidate_name: string;
  candidate_email?: string | null;
  opportunity: string;
  opp_id?: string | null;
  customer: string | null;
  ta_owner: string | null;
  applied_on: string | null;
  pipeline_status: string;
  /** The derived status every screen shows (server-side). */
  candidate_status?: CandidateStatus | null;
  current_ctc: number | null;
  expected_ctc: number | null;
  hike_percent: number | null;
  created_at: string | null;
};

const OPP_COLUMNS: Column<OppRow>[] = [
  { key: "opp_id", label: "Opp ID", render: (r) => <span className="font-semibold">{r.opp_id}</span> },
  { key: "title", label: "Title", render: (r) => <span className="font-medium text-primary">{r.title}</span> },
  { key: "customer", label: "Customer" },
  { key: "stage", label: "Deal stage", render: (r) => (
    <span className="flex flex-wrap items-center gap-1">
      <StatusBadge status={r.stage} />
      {r.approval_status && r.approval_status !== "Approved" && <StatusBadge status={r.approval_status} />}
    </span>) },
  { key: "position_status", label: "Position", render: (r) => r.position_status ? <StatusBadge status={r.position_status} /> : <span className="text-muted">—</span> },
  { key: "positions_open", label: "Open / total", className: "text-right",
    render: (r) => r.positions_total == null ? "—" : <span className="tabular-nums">{r.positions_open ?? 0} / {r.positions_total}{r.positions_joined ? <span className="text-muted"> · {r.positions_joined} joined</span> : null}</span> },
  { key: "opp_type", label: "Type", render: (r) => String(r.opp_type || "—").replace(/_/g, " ") },
  { key: "rfi_value", label: "RFI Value", className: "text-right", render: (r) => inr(r.rfi_value) },
  { key: "created_by", label: "Raised by", render: (r) => r.created_by || r.created_by_username || "—" },
  { key: "created_at", label: "Created", render: (r) => dt(r.created_at) },
];

const PROFILE_COLUMNS: Column<ProfileRow>[] = [
  { key: "candidate_name", label: "Candidate", render: (r) => (
    <span><span className="font-semibold">{r.candidate_name}</span>
      {r.candidate_email && !r.candidate_email.includes("@noemail") && !r.candidate_email.includes("@import.") && <span className="block text-xs text-muted">{r.candidate_email}</span>}</span>) },
  { key: "opportunity", label: "Opportunity", render: (r) => <span>{r.opp_id ? <span className="mr-1 text-xs text-muted">{r.opp_id}</span> : null}{r.opportunity}</span> },
  { key: "customer", label: "Customer", render: (r) => r.customer || "—" },
  { key: "ta_owner", label: "TA", render: (r) => r.ta_owner || "—" },
  { key: "stage", label: "Stage", render: (r) => <CandidateStageBadge status={r.candidate_status} /> },
  { key: "pipeline_status", label: "Status",
    render: (r) => <CandidateStatusBadge status={r.candidate_status} stage={r.pipeline_status} /> },
  { key: "current_ctc", label: "Current CTC", className: "text-right", render: (r) => inr(r.current_ctc) },
  { key: "expected_ctc", label: "Expected CTC", className: "text-right", render: (r) => inr(r.expected_ctc) },
  {
    key: "hike_percent",
    label: "Hike %",
    className: "text-right",
    render: (r) => (r.hike_percent === null || r.hike_percent === undefined ? "—" : `${r.hike_percent}%`),
  },
  { key: "applied_on", label: "Applied", render: (r) => dt(r.applied_on || r.created_at) },
];

/* ---------- Page ---------- */

export function CrmReportsPage() {
  const [toast, showToast] = useToast();
  const [requestedTab, setTab] = usePageTab<TabKey>("tab", "opportunities");

  // Financial Reports tab — mirrors the old sidebar entry's gating
  // (Admin/Finance/Sales_Head + Access Templates).
  const me = useMe();
  const financialRoleOk = useHasRole("Finance", "Sales_Head");
  const showFinancial = crmTabVisibleFromMe(me, "finance-reports", financialRoleOk, false);
  // Revenue is Admin/CEO only — deliberately NOT template-widenable.
  const showRevenue = useHasRole();
  const tabs = [...TABS, ...(showFinancial ? [FINANCIAL_TAB] : []), ...(showRevenue ? [REVENUE_TAB] : [])];
  // A deep link to a tab this user cannot see falls back to the first tab.
  const tab: TabKey = tabs.some((t) => t.key === requestedTab) ? requestedTab : "opportunities";

  // Per-tab filters (+ customer and a date window shared by both tables, 7 Oct 2026)
  const [oppTeam, setOppTeam] = useState("");
  const [oppStatus, setOppStatus] = useState("");
  const [profTeam, setProfTeam] = useState("");
  const [profStatus, setProfStatus] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [customers, setCustomers] = useState<{ id: number; name: string }[]>([]);
  const [summary, setSummary] = useState<OppSummary | ProfileSummary | null>(null);
  useEffect(() => {
    crmGet<{ id: number; name: string }[]>("/api/customers/names")
      .then((r) => setCustomers(r.data || []))
      .catch(() => setCustomers([]));
  }, []);

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [tick, setTick] = useState(0);

  const url =
    tab === "opportunities"
      ? `/api/reports/opportunities${qs({ team: oppTeam, status: oppStatus, customer_id: customerId, from, to })}`
      : `/api/reports/candidate-profiles${qs({ team: profTeam, status: profStatus, customer_id: customerId, from, to })}`;

  useEffect(() => {
    // Hosted tabs (Financial, Revenue) fetch their own data.
    if (HOSTED_TABS.has(tab)) return;
    let alive = true;
    setLoading(true);
    setError("");
    crmGet<any[]>(url)
      .then((r) => {
        if (!alive) return;
        setRows(r.data || []);
        setSummary(((r.meta || {}) as { summary?: OppSummary | ProfileSummary }).summary || null);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setRows([]);
        setError(e?.message || "Failed to load report");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [url, tick]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const csvUrl = `${url}${url.includes("?") ? "&" : "?"}format=csv`;
      const res = await authFetch(csvUrl);
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = CSV_FILENAMES[tab as Exclude<TabKey, "financial" | "revenue" | "productivity">];
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      showToast("CSV downloaded");
    } catch (e: any) {
      showToast(e?.message || "Export failed", "err");
    } finally {
      setExporting(false);
    }
  };

  const selectFilter = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    options: string[],
    allLabel = "All",
  ) => (
    <div className="w-44">
      <Field label={label}>
        <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{allLabel}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );

  const exportButton = (
    <button className={`${btnSecondary} ml-auto`} onClick={exportCsv} disabled={exporting || loading}>
      <Download size={15} /> {exporting ? "Exporting…" : "Export CSV"}
    </button>
  );

  const sharedFilters = (
    <>
      <div className="w-48">
        <Field label="Customer">
          <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">All customers</option>
            {customers.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="w-36">
        <Field label={tab === "opportunities" ? "Created from" : "Applied from"}>
          <input type="date" className={inputCls} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </Field>
      </div>
      <div className="w-36">
        <Field label="To">
          <input type="date" className={inputCls} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {(customerId || from || to) && (
        <button type="button" className="self-end text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300"
          onClick={() => { setCustomerId(""); setFrom(""); setTo(""); }}>Clear</button>
      )}
    </>
  );
  const filters =
    tab === "opportunities" ? (
      <>
        {selectFilter("Raised by team", oppTeam, setOppTeam, TEAM_OPTIONS)}
        {selectFilter("Deal stage", oppStatus, setOppStatus, OPP_STATUS_OPTIONS)}
        {sharedFilters}
        {exportButton}
      </>
    ) : (
      <>
        {selectFilter("Team", profTeam, setProfTeam, TEAM_OPTIONS)}
        {selectFilter("Status", profStatus, setProfStatus, PROFILE_STATUS_OPTIONS)}
        {sharedFilters}
        {exportButton}
      </>
    );

  const columns: Column<any>[] = tab === "opportunities" ? OPP_COLUMNS : PROFILE_COLUMNS;

  const activeLabel = tabs.find((t) => t.key === tab)?.label || "Report";

  /** The strip above the table — the server's summary of the SAME filtered rows. */
  const tiles = useMemo(() => {
    if (!summary || HOSTED_TABS.has(tab)) return null;
    const top = (m: Record<string, number>, n = 3) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(" · ");
    if (tab === "opportunities") {
      const sm = summary as OppSummary;
      return [
        <Tile key="n" label="Deals" value={sm.count} sub={top(sm.by_stage)} />,
        <Tile key="rfi" label="RFI value" value={inrCompact(sm.rfi_total)} sub={sm.rfi_known < sm.count ? `${sm.count - sm.rfi_known} deal${sm.count - sm.rfi_known === 1 ? "" : "s"} without a value` : "every deal valued"} tone="success" />,
        <Tile key="pos" label="Positions open" value={sm.positions_open} sub={`${sm.positions_total} in total · ${sm.positions_joined} joined`} tone={sm.positions_open > 0 ? "warning" : "neutral"} />,
        <Tile key="type" label="By type" value={Object.keys(sm.by_type).length} sub={top(sm.by_type)} tone="neutral" />,
      ];
    }
    const sp = summary as ProfileSummary;
    return [
      <Tile key="n" label="Candidacies" value={sp.count} sub={top(sp.by_stage)} />,
      <Tile key="live" label="In pipeline" value={sp.live} sub={top(sp.by_group)} tone="warning" />,
      <Tile key="joined" label="Joined" value={sp.joined} sub={`${sp.closed} closed`} tone="success" />,
      <Tile key="hike" label="Avg hike asked" value={sp.avg_hike_percent == null ? "—" : `${sp.avg_hike_percent}%`} sub="expected over current CTC" tone="neutral" />,
    ];
  }, [summary, tab]);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={BarChart3}
        accent="slate"
        eyebrow="Insights"
        title="Reports"
        subtitle="Pull operational reports and export them as CSV."
        stats={[{ label: tabs.length === 1 ? "report" : "reports", value: tabs.length }]}
      >
        <div
          role="tablist"
          aria-label="Reports"
          className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-5"
        >
          {tabs.map((t) => {
            const look = TAB_LOOK[t.key] || TAB_LOOK.opportunities;
            const Icon = look.icon;
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.key as TabKey)}
                className={`group flex min-w-0 items-start gap-3 rounded-card border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  on
                    ? "border-brand-500 bg-brand-50 shadow-raised dark:bg-brand-900"
                    : "border-subtle bg-surface-1 hover:-translate-y-0.5 hover:shadow-raised"
                }`}
              >
                <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-gradient-to-br text-white shadow-raised ${look.tone}`} aria-hidden>
                  <Icon size={17} />
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm font-bold ${on ? "text-brand-700 dark:text-brand-200" : "text-primary"}`}>{t.label}</span>
                  <span className="mt-0.5 hidden text-xs leading-snug text-muted sm:block">{look.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      </PageHeader>
      {(!HOSTED_TABS.has(tab) || tab === "productivity") && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <h2 className="text-sm font-bold text-primary">{activeLabel}</h2>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-secondary ring-1 ring-inset ring-subtle">
            Filters narrow the table and the CSV alike
          </span>
        </div>
      )}
      {tiles && !loading && !error && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{tiles}</div>
      )}
      {tab === "revenue" ? (
        showRevenue && <RevenueReport />
      ) : tab === "productivity" ? (
        <RecruiterProductivity />
      ) : tab === "financial" ? (
        showFinancial && <FinanceReportsPage embedded />
      ) : error ? (
        <ErrorBox error={error} onRetry={() => setTick((t) => t + 1)} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          filters={filters}
          emptyMessage="No rows match the current filters"
        />
      )}
      {!HOSTED_TABS.has(tab) && !loading && !error && (
        <div className="text-xs text-muted tabular-nums">{rows.length} row{rows.length === 1 ? "" : "s"}</div>
      )}
      {toast}
    </div>
  );
}
