/** CRM Reports — three tabbed reports (opportunities, candidate profiles,
 * recruiter productivity) with per-tab filters and CSV export. */
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { authFetch } from "../../api/client";
import { qs, crmGet } from "../api";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { ErrorBox, Field, StatusBadge, Tabs, btnSecondary, inputCls, useToast } from "../components/ui";

type TabKey = "opportunities" | "profiles" | "productivity";

const TABS = [
  { key: "opportunities", label: "Opportunities" },
  { key: "profiles", label: "Candidate Profiles" },
  { key: "productivity", label: "Recruiter Productivity" },
];

const TEAM_OPTIONS = ["Sales", "RMG", "TA"];
const OPP_STATUS_OPTIONS = ["Active", "On Hold", "Rejected", "Closed", "Archived"];
const PROFILE_STATUS_OPTIONS = ["Active", "Rejected", "Joined"];

const CSV_FILENAMES: Record<TabKey, string> = {
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
  { key: "pipeline_status", label: "Status", render: (r) => <StatusBadge status={r.pipeline_status} /> },
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
  const [tab, setTab] = useState<TabKey>("opportunities");

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
      a.download = CSV_FILENAMES[tab];
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-display text-xl font-bold text-primary">Reports</h1>
        <p className="text-sm text-muted">
          Pull operational reports and export them as CSV.
        </p>
      </div>
      <Tabs tabs={TABS} active={tab} onChange={(k) => setTab(k as TabKey)} />
      {error ? (
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
      {!loading && !error && (
        <div className="text-xs text-muted tabular-nums">{rows.length} row{rows.length === 1 ? "" : "s"}</div>
      )}
      {toast}
    </div>
  );
}
