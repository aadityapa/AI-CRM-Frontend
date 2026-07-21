/** Project 360° Overview — read-only aggregate view for the project detail
 * page, shown as the "Overview" tab (first in tab order, mounted once and
 * kept alive so tab switches don't refetch).
 * Data: GET /api/projects/{id}/history (CRM envelope, pinned contract).
 * Layout (top→bottom): KPI strip → Team → Finance → Billing Policy →
 * Timesheet Compliance → Timeline (oldest→newest).
 * Mirrors src/crm/pages/EmployeeHistory.tsx patterns: typed contract
 * interfaces, null-defensive reads, DataTable + plain sub-tables, skeleton /
 * error / per-section empty states. Token-only styling per
 * src/design-system/tokens/README.md — no hex, no arbitrary values, 4px grid,
 * duration-micro hover only (reduced-motion safe: colour fades only). */
import React, { useEffect, useState } from "react";
import { crmGet } from "../api";
import { CrmLink } from "../routerHooks";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState, ErrorBox, focusRing, Skeleton, SkeletonText, StatusBadge } from "../components/ui";

/* ------------------------------------------------------------------ types */

type OverviewProject = {
  id: number;
  title?: string | null;
  status?: string | null;
  project_type?: string | null;
  customer_name?: string | null;
  branch_name?: string | null;
  billing_frequency?: string | null;
  created_at?: string | null;
  duration_days?: number | null;
};

type BillingPolicy = {
  source?: string | null;
  holidays_billable?: boolean | null;
  weekoff_billable?: boolean | null;
  leave_billable?: boolean | null;
  comp_off_billable?: boolean | null;
  min_hours_full_day?: number | null;
  min_hours_half_day?: number | null;
  normal_hours_per_day?: number | null;
  max_billable_hours_day?: number | null;
};

type OverviewTeamMember = {
  assignment_id: number;
  employee_id: number;
  employee_name?: string | null;
  onboarding_date?: string | null;
  billing_date?: string | null;
  billing_rate?: number | null;
  billing_unit?: string | null;
  work_mode?: string | null;
  experience_years?: number | null;
  is_active: boolean;
  is_exit: boolean;
  exit_date?: string | null;
};

type OverviewTeam = {
  active_count?: number | null;
  exited_count?: number | null;
  members?: OverviewTeamMember[] | null;
};

type OverviewPo = {
  po_id: number;
  po_number?: string | null;
  allocated?: number | null;
  consumed?: number | null;
  balance?: number | null;
  hsn_sac?: string | null;
};

type OverviewInvoice = {
  id: number;
  invoice_number?: string | null;
  invoice_date?: string | null;
  period_label?: string | null;
  employee_name?: string | null;
  grand_total?: number | null;
  paid_amount?: number | null;
  balance_amount?: number | null;
  payment_status?: string | null;
};

type OverviewFinance = {
  po?: OverviewPo | null;
  total_invoiced?: number | null;
  total_paid?: number | null;
  outstanding?: number | null;
  total_tds?: number | null;
  monthly_burn_estimate?: number | null;
  invoices?: OverviewInvoice[] | null;
};

type CoverageRow = {
  month?: number | null;
  year?: number | null;
  period_label?: string | null;
  expected?: number | null;
  submitted_or_approved?: number | null;
};

type RecentTimesheet = {
  id: number;
  employee_name?: string | null;
  period_label?: string | null;
  status?: string | null;
  billable_hours?: number | null;
  billable_days?: number | null;
};

type OverviewTimesheets = {
  total?: number | null;
  approved?: number | null;
  submitted?: number | null;
  draft?: number | null;
  rejected?: number | null;
  coverage?: CoverageRow[] | null;
  recent?: RecentTimesheet[] | null;
};

type TimelineEvent = { date: string; type: string; label: string };

type ProjectHistoryData = {
  project: OverviewProject;
  billing_policy?: BillingPolicy | null;
  team?: OverviewTeam | null;
  finance?: OverviewFinance | null;
  timesheets?: OverviewTimesheets | null;
  /** Oldest → newest. */
  timeline?: TimelineEvent[] | null;
};

/* ---------------------------------------------------------------- helpers */

const fmtDate = (d?: string | null): string => (d ? new Date(d).toLocaleDateString("en-IN") : "—");

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const fmtInr = (n?: number | null): string => (n == null ? "—" : inr.format(Number(n)));

const fmtNum = (n?: number | null): string =>
  n == null ? "—" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** Timeline dot colour: brand = created/onboarded, success = invoices/approvals,
 * warning = exits (falls back to brand for unknown event types). */
function timelineDotCls(type: string): string {
  const t = String(type || "").toLowerCase();
  if (/exit|offboard|resign|removed/.test(t)) return "bg-warning";
  if (/invoice|approv|paid|payment|bill/.test(t)) return "bg-success";
  return "bg-brand-500";
}

const linkCls = `rounded-control font-semibold text-brand-600 hover:underline dark:text-brand-300 ${focusRing}`;

/* Plain sub-table styles (inside a glass card → no nested elevated panel). */
const thCls = "px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-muted";
const thRightCls = "px-3 py-2 text-right text-xs font-bold uppercase tracking-wide text-muted";
const tdCls = "px-3 py-2.5 align-middle text-secondary";
const tdRightCls = "px-3 py-2.5 text-right align-middle tabular-nums text-secondary";
const bodyRowCls = "border-b border-subtle transition-colors duration-micro ease-smooth hover:bg-surface-2";

/* --------------------------------------------------------- building blocks */

/** KPI-style tile for the summary strip. */
function SummaryTile({ label, value, sub, children }: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="glass fx-gradient-border fx-lift rounded-card px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-display text-lg font-bold tabular-nums text-primary">{value ?? "—"}</div>
      {sub != null && <div className="mt-1 text-xs text-muted">{sub}</div>}
      {children}
    </div>
  );
}

/** Thin PO consumption bar (allocated vs consumed). Static — no animation,
 * reduced-motion safe by construction. */
function ConsumptionBar({ allocated, consumed }: { allocated?: number | null; consumed?: number | null }) {
  const alloc = Number(allocated ?? 0);
  const used = Number(consumed ?? 0);
  if (!(alloc > 0)) return null;
  const pct = Math.min(100, Math.max(0, (used / alloc) * 100));
  const over = used > alloc;
  return (
    <div
      className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-2"
      role="progressbar"
      aria-label="PO consumption"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <div className={`h-full rounded-full ${over ? "bg-danger" : "bg-brand-500"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Read-only glass section card (matches the detail page's card shell). */
function OverviewCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-card border border-subtle bg-surface-1">
      <div className="fx-hairline-b px-5 py-3">
        <h2 className="text-sm font-bold text-primary">{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/** Definition item for totals / policy grids. */
function DefItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums text-primary">{value ?? "—"}</div>
    </div>
  );
}

/** Yes / No pill for billing-policy flags (— when the flag is unknown). */
function YesNoPill({ value }: { value?: boolean | null }) {
  if (value == null) return <span className="text-sm text-muted">—</span>;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset ring-subtle ${
        value ? "bg-success-soft text-success" : "bg-surface-2 text-muted"
      }`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden />
      {value ? "Yes" : "No"}
    </span>
  );
}

/** Loading skeleton mirroring the final layout geometry. */
function OverviewSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading project overview">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="glass fx-gradient-border rounded-card px-4 py-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-6 w-28" />
          </div>
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-card border border-subtle bg-surface-1 px-5 py-4">
          <Skeleton className="h-4 w-32" />
          <SkeletonText lines={3} className="mt-4" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ main export */

export function ProjectOverviewTab({ projectId }: { projectId: number }) {
  const [data, setData] = useState<ProjectHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    crmGet<ProjectHistoryData>(`/api/projects/${projectId}/history`)
      .then((r) => { setData(r.data); setError(""); })
      .catch((e) => setError(e?.message || "Failed to load project overview"))
      .finally(() => setLoading(false));
  };
  useEffect(load, [projectId]);

  if (loading) return <OverviewSkeleton />;
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <EmptyState message="No overview available for this project" />;

  const policy: BillingPolicy = data.billing_policy || {};
  const team: OverviewTeam = data.team || {};
  const members = team.members || [];
  const finance: OverviewFinance = data.finance || {};
  const po = finance.po || null;
  const invoices = finance.invoices || [];
  const ts: OverviewTimesheets = data.timesheets || {};
  const coverage = ts.coverage || [];
  const recent = ts.recent || [];
  const timeline = data.timeline || [];

  const activeCount = team.active_count ?? members.filter((m) => m.is_active && !m.is_exit).length;
  const exitedCount = team.exited_count ?? members.filter((m) => m.is_exit).length;
  const lastCoverage = coverage.length ? coverage[coverage.length - 1] : null;

  /* ------------------------------------------------ tables (DataTable) */

  type MemberRow = OverviewTeamMember & { id: number };
  const memberRows: MemberRow[] = members.map((m) => ({ ...m, id: m.assignment_id }));
  const memberColumns: Column<MemberRow>[] = [
    {
      key: "employee_name",
      label: "Employee",
      render: (r) => (
        <CrmLink to={`employees/${r.employee_id}`} className={linkCls}>
          {r.employee_name || `#${r.employee_id}`}
        </CrmLink>
      ),
    },
    { key: "onboarding_date", label: "Onboarded", render: (r) => fmtDate(r.onboarding_date) },
    { key: "billing_date", label: "Billing Start", render: (r) => fmtDate(r.billing_date) },
    {
      key: "billing_rate",
      label: "Rate",
      align: "right",
      render: (r) =>
        r.billing_rate == null ? "—" : `${fmtInr(r.billing_rate)}${r.billing_unit ? ` / ${r.billing_unit}` : ""}`,
    },
    { key: "billing_unit", label: "Unit", render: (r) => r.billing_unit || "—" },
    { key: "work_mode", label: "Work Mode", render: (r) => r.work_mode || "—" },
    {
      key: "experience_years",
      label: "Exp",
      align: "right",
      render: (r) => (r.experience_years == null ? "—" : `${fmtNum(r.experience_years)} yrs`),
    },
    {
      key: "status",
      label: "Status",
      render: (r) =>
        r.is_exit ? (
          <span className="inline-flex flex-col items-start gap-1">
            <StatusBadge status="Exited" />
            {r.exit_date && <span className="text-xs tabular-nums text-muted">{fmtDate(r.exit_date)}</span>}
          </span>
        ) : (
          <StatusBadge status={r.is_active ? "Active" : "Inactive"} />
        ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------- KPI strip */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <SummaryTile
          label="Team"
          value={fmtNum(activeCount)}
          sub={`${fmtNum(exitedCount)} exited`}
        />
        <SummaryTile
          label="PO Balance"
          value={po ? fmtInr(po.balance) : "No PO"}
          sub={po ? `${fmtInr(po.consumed)} of ${fmtInr(po.allocated)} consumed` : "No purchase order linked"}
        >
          {po && <ConsumptionBar allocated={po.allocated} consumed={po.consumed} />}
        </SummaryTile>
        <SummaryTile
          label="Invoiced"
          value={fmtInr(finance.total_invoiced)}
          sub={`${fmtInr(finance.outstanding)} outstanding`}
        />
        <SummaryTile
          label="Monthly Burn"
          value={fmtInr(finance.monthly_burn_estimate)}
          sub="Estimated from rates"
        />
        <SummaryTile
          label="Timesheets"
          value={
            lastCoverage
              ? `${fmtNum(lastCoverage.submitted_or_approved)}/${fmtNum(lastCoverage.expected)}`
              : "—"
          }
          sub={lastCoverage ? `${lastCoverage.period_label || "this month"} submitted` : "No coverage data"}
        />
      </div>

      {/* --------------------------------------------------------- Team */}
      <div className="space-y-2">
        <h2 className="text-sm font-bold text-primary">Team</h2>
        <DataTable columns={memberColumns} rows={memberRows} emptyMessage="No team members yet" />
      </div>

      {/* ------------------------------------------------------ Finance */}
      <OverviewCard title="Finance">
        {po ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <DefItem
              label="PO #"
              value={
                <CrmLink to={`pos/${po.po_id}`} className={linkCls}>
                  {po.po_number || `#${po.po_id}`}
                </CrmLink>
              }
            />
            <DefItem label="Allocated" value={fmtInr(po.allocated)} />
            <DefItem label="Consumed" value={fmtInr(po.consumed)} />
            <DefItem label="Balance" value={fmtInr(po.balance)} />
            <DefItem label="HSN / SAC" value={po.hsn_sac || "—"} />
          </div>
        ) : (
          <p className="text-sm text-muted">No purchase order linked to this project.</p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-subtle pt-4 sm:grid-cols-4">
          <DefItem label="Invoiced" value={fmtInr(finance.total_invoiced)} />
          <DefItem label="Paid" value={fmtInr(finance.total_paid)} />
          <DefItem label="Outstanding" value={fmtInr(finance.outstanding)} />
          <DefItem label="TDS" value={fmtInr(finance.total_tds)} />
        </div>
        <div className="mt-4 border-t border-subtle pt-3">
          {invoices.length === 0 ? (
            <EmptyState message="No invoices yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-sm lg:min-w-0">
                <thead>
                  <tr className="border-b border-subtle">
                    <th className={thCls}>Invoice #</th>
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Period</th>
                    <th className={thCls}>Employee</th>
                    <th className={thRightCls}>Amount</th>
                    <th className={thRightCls}>Paid</th>
                    <th className={thRightCls}>Balance</th>
                    <th className={thCls}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className={bodyRowCls}>
                      <td className={tdCls}>
                        <CrmLink to={`invoices/${inv.id}`} className={linkCls}>
                          {inv.invoice_number || `#${inv.id}`}
                        </CrmLink>
                      </td>
                      <td className={tdCls}>{fmtDate(inv.invoice_date)}</td>
                      <td className={tdCls}>{inv.period_label || "—"}</td>
                      <td className={tdCls}>{inv.employee_name || "—"}</td>
                      <td className={`${tdRightCls} font-semibold text-primary`}>{fmtInr(inv.grand_total)}</td>
                      <td className={tdRightCls}>{fmtInr(inv.paid_amount)}</td>
                      <td className={tdRightCls}>{fmtInr(inv.balance_amount)}</td>
                      <td className={tdCls}><StatusBadge status={inv.payment_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </OverviewCard>

      {/* ----------------------------------------------- Billing Policy */}
      <OverviewCard title="Billing Policy">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <DefItem label="Holidays billable" value={<YesNoPill value={policy.holidays_billable} />} />
          <DefItem label="Week-off billable" value={<YesNoPill value={policy.weekoff_billable} />} />
          <DefItem label="Leave billable" value={<YesNoPill value={policy.leave_billable} />} />
          <DefItem label="Comp-off billable" value={<YesNoPill value={policy.comp_off_billable} />} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-subtle pt-4 sm:grid-cols-4">
          <DefItem label="Min hrs — full day" value={fmtNum(policy.min_hours_full_day)} />
          <DefItem label="Min hrs — half day" value={fmtNum(policy.min_hours_half_day)} />
          <DefItem label="Normal hrs / day" value={fmtNum(policy.normal_hours_per_day)} />
          <DefItem label="Max billable hrs / day" value={fmtNum(policy.max_billable_hours_day)} />
        </div>
        <p className="mt-3 text-xs text-muted">
          {policy.source
            ? policy.source.toLowerCase() === "branch"
              ? "From branch policy"
              : `Source: ${String(policy.source).replace(/_/g, " ")}`
            : "Policy source unknown"}
        </p>
      </OverviewCard>

      {/* ----------------------------------------- Timesheet Compliance */}
      <OverviewCard title="Timesheet Compliance">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <DefItem label="Total" value={fmtNum(ts.total)} />
          <DefItem label="Approved" value={fmtNum(ts.approved)} />
          <DefItem label="Submitted" value={fmtNum(ts.submitted)} />
          <DefItem label="Draft" value={fmtNum(ts.draft)} />
          <DefItem label="Rejected" value={fmtNum(ts.rejected)} />
        </div>
        <div className="mt-4 border-t border-subtle pt-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted">Coverage</h3>
          {coverage.length === 0 ? (
            <EmptyState message="No coverage data yet" />
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-max text-sm lg:min-w-0">
                <thead>
                  <tr className="border-b border-subtle">
                    <th className={thCls}>Period</th>
                    <th className={thRightCls}>Expected</th>
                    <th className={thRightCls}>Submitted / Approved</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.map((c, i) => {
                    const short = (c.submitted_or_approved ?? 0) < (c.expected ?? 0);
                    return (
                      <tr
                        key={`${c.year ?? "y"}-${c.month ?? "m"}-${i}`}
                        className={`${bodyRowCls} ${short ? "bg-warning-soft" : ""}`}
                      >
                        <td className={`${tdCls} font-semibold text-primary`}>
                          {c.period_label || (c.month != null && c.year != null ? `${c.month}/${c.year}` : "—")}
                        </td>
                        <td className={tdRightCls}>{fmtNum(c.expected)}</td>
                        <td className={`${tdRightCls} ${short ? "font-semibold text-warning" : ""}`}>
                          {fmtNum(c.submitted_or_approved)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="mt-4 border-t border-subtle pt-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted">Recent Timesheets</h3>
          {recent.length === 0 ? (
            <EmptyState message="No timesheets yet" />
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-max text-sm lg:min-w-0">
                <thead>
                  <tr className="border-b border-subtle">
                    <th className={thCls}>Period</th>
                    <th className={thCls}>Employee</th>
                    <th className={thRightCls}>Billable Hrs</th>
                    <th className={thRightCls}>Days</th>
                    <th className={thCls}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id} className={bodyRowCls}>
                      <td className={tdCls}>
                        <CrmLink to={`timesheets/${r.id}`} className={linkCls}>
                          {r.period_label || `#${r.id}`}
                        </CrmLink>
                      </td>
                      <td className={tdCls}>{r.employee_name || "—"}</td>
                      <td className={tdRightCls}>{fmtNum(r.billable_hours)}</td>
                      <td className={tdRightCls}>{fmtNum(r.billable_days)}</td>
                      <td className={tdCls}><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </OverviewCard>

      {/* ----------------------------------------------------- Timeline */}
      <OverviewCard title="Timeline">
        {timeline.length === 0 ? (
          <EmptyState message="No timeline events yet" />
        ) : (
          <ol>
            {timeline.map((ev, i) => (
              <li
                key={`${ev.date}-${ev.type}-${i}`}
                className="flex gap-3 rounded-control px-2 transition-colors duration-micro ease-smooth hover:bg-surface-2"
              >
                <span className="flex flex-col items-center" aria-hidden>
                  <span className={`mt-2.5 h-2 w-2 shrink-0 rounded-full ${timelineDotCls(ev.type)}${i === timeline.length - 1 ? " fx-glow" : ""}`} />
                  {i < timeline.length - 1 && <span className="mt-1 flex-1 border-l border-subtle" />}
                </span>
                <div className="min-w-0 py-1.5 pb-4">
                  <div className="text-xs tabular-nums text-muted">{fmtDate(ev.date)}</div>
                  <div className="text-sm text-secondary">{ev.label}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </OverviewCard>
    </div>
  );
}
