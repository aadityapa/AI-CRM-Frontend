/** CRM Reports — three tabbed reports (opportunities, candidate profiles,
 * recruiter productivity) with per-tab filters and CSV export, plus the
 * Financial Reports tab (Admin/Finance/Sales_Head) and the CEO Revenue tab
 * (Admin/CEO ONLY — server-enforced by `GET /api/reports/revenue`). */
import { useEffect, useState } from "react";
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
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { ErrorBox, Field, StatusBadge, btnSecondary, inputCls, useToast } from "../components/ui";
import { CandidateStatusBadge } from "../components/CandidateStatusBadge";
import type { CandidateStatus } from "../components/CandidateStatusBadge";
import { usePageTab } from "../lib/pageState";

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
  productivity: { icon: TrendingUp, blurb: "Resumes, scans and shortlists per recruiter.", tone: "from-emerald-500 to-teal-600" },
  financial: { icon: Landmark, blurb: "POs, invoices, payments and TDS in one place.", tone: "from-amber-500 to-orange-600" },
  revenue: { icon: IndianRupee, blurb: "Billed, collected, margin and cash flow.", tone: "from-rose-500 to-pink-600" },
};

/** Tabs that host their own component (no shared DataTable / CSV export). */
const HOSTED_TABS: ReadonlySet<TabKey> = new Set<TabKey>(["financial", "revenue"]);

const TEAM_OPTIONS = ["Sales", "RMG", "TA"];
const OPP_STATUS_OPTIONS = ["Active", "On Hold", "Rejected", "Closed", "Archived"];
const PROFILE_STATUS_OPTIONS = ["Active", "Rejected", "Joined"];

const CSV_FILENAMES: Record<Exclude<TabKey, "financial" | "revenue">, string> = {
  opportunities: "opportunities-report.csv",
  profiles: "candidate-profiles-report.csv",
  productivity: "recruiter-productivity-report.csv",
};

const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString() : "—");

/* ---------- Row shapes (services/reports.py) ---------- */

type OppRow = {
  opp_id: string;
  title: string;
  customer: string;
  stage: string;
  opp_type: string;
  rfi_value: number | null;
  created_by_username: string;
  created_at: string | null;
};

type ProfileRow = {
  candidate_name: string;
  opportunity: string;
  pipeline_status: string;
  /** The derived status every screen shows (server-side). */
  candidate_status?: CandidateStatus | null;
  current_ctc: number | null;
  expected_ctc: number | null;
  hike_percent: number | null;
  created_at: string | null;
};

type ProductivityRow = {
  username: string;
  resumes_uploaded: number;
  scans_run: number;
  shortlisted: number;
  profiles_created: number;
  per_day_avg: number;
};

const OPP_COLUMNS: Column<OppRow>[] = [
  { key: "opp_id", label: "Opp ID", render: (r) => <span className="font-semibold">{r.opp_id}</span> },
  { key: "title", label: "Title" },
  { key: "customer", label: "Customer" },
  { key: "stage", label: "Stage", render: (r) => <StatusBadge status={r.stage} /> },
  { key: "opp_type", label: "Type", render: (r) => String(r.opp_type || "—").replace(/_/g, " ") },
  { key: "rfi_value", label: "RFI Value", className: "text-right", render: (r) => inr(r.rfi_value) },
  { key: "created_by_username", label: "Created By" },
  { key: "created_at", label: "Created", render: (r) => dt(r.created_at) },
];

const PROFILE_COLUMNS: Column<ProfileRow>[] = [
  { key: "candidate_name", label: "Candidate", render: (r) => <span className="font-semibold">{r.candidate_name}</span> },
  { key: "opportunity", label: "Opportunity" },
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
  { key: "created_at", label: "Created", render: (r) => dt(r.created_at) },
];

const PRODUCTIVITY_COLUMNS: Column<ProductivityRow>[] = [
  { key: "username", label: "Recruiter", render: (r) => <span className="font-semibold">{r.username}</span> },
  { key: "resumes_uploaded", label: "Resumes Uploaded", className: "text-right" },
  { key: "scans_run", label: "Scans Run", className: "text-right" },
  { key: "shortlisted", label: "Shortlisted", className: "text-right" },
  { key: "profiles_created", label: "Profiles Created", className: "text-right" },
  { key: "per_day_avg", label: "Per-Day Avg", className: "text-right" },
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

  // Per-tab filters
  const [oppTeam, setOppTeam] = useState("");
  const [oppStatus, setOppStatus] = useState("");
  const [profTeam, setProfTeam] = useState("");
  const [profStatus, setProfStatus] = useState("");
  const [prodFrom, setProdFrom] = useState("");
  const [prodTo, setProdTo] = useState("");

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [tick, setTick] = useState(0);

  const url =
    tab === "opportunities"
      ? `/api/reports/opportunities${qs({ team: oppTeam, status: oppStatus })}`
      : tab === "profiles"
        ? `/api/reports/candidate-profiles${qs({ team: profTeam, status: profStatus })}`
        : `/api/reports/recruiter-productivity${qs({ from: prodFrom, to: prodTo })}`;

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
      a.download = CSV_FILENAMES[tab as Exclude<TabKey, "financial" | "revenue">];
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

  const filters =
    tab === "opportunities" ? (
      <>
        {selectFilter("Team", oppTeam, setOppTeam, TEAM_OPTIONS)}
        {selectFilter("Status", oppStatus, setOppStatus, OPP_STATUS_OPTIONS)}
        {exportButton}
      </>
    ) : tab === "profiles" ? (
      <>
        {selectFilter("Team", profTeam, setProfTeam, TEAM_OPTIONS)}
        {selectFilter("Status", profStatus, setProfStatus, PROFILE_STATUS_OPTIONS)}
        {exportButton}
      </>
    ) : (
      <>
        <div className="w-44">
          <Field label="From">
            <input type="date" className={inputCls} value={prodFrom} onChange={(e) => setProdFrom(e.target.value)} />
          </Field>
        </div>
        <div className="w-44">
          <Field label="To">
            <input type="date" className={inputCls} value={prodTo} onChange={(e) => setProdTo(e.target.value)} />
          </Field>
        </div>
        {exportButton}
      </>
    );

  const columns: Column<any>[] =
    tab === "opportunities" ? OPP_COLUMNS : tab === "profiles" ? PROFILE_COLUMNS : PRODUCTIVITY_COLUMNS;

  const activeLabel = tabs.find((t) => t.key === tab)?.label || "Report";

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
      {!HOSTED_TABS.has(tab) && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <h2 className="text-sm font-bold text-primary">{activeLabel}</h2>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-secondary ring-1 ring-inset ring-subtle">
            Filters narrow the table and the CSV alike
          </span>
        </div>
      )}
      {tab === "revenue" ? (
        showRevenue && <RevenueReport />
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
