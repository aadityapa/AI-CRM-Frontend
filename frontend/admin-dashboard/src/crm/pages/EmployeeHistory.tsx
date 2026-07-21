/** Employee History — read-only 360° view (joining → exit) for the employee
 * detail page, shown as the "History" tab and lazy-loaded on first open.
 * Data: GET /api/employees/{id}/history (CRM envelope, pinned contract).
 * Layout (top→bottom): summary strip → Projects → Timesheets → Billing →
 * Leave (collapsible sub-sections) → Timeline (oldest→newest).
 * Token-only styling per src/design-system/tokens/README.md — no hex, no
 * arbitrary values, 4px grid, duration-micro hover only (reduced-motion safe:
 * colour fades only, no movement). */
import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { crmGet } from "../api";
import { CrmLink } from "../routerHooks";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState, ErrorBox, focusRing, Skeleton, SkeletonText, StatusBadge } from "../components/ui";

/* ------------------------------------------------------------------ types */

type HistoryEmployee = {
  id: number;
  employee_code?: string | null;
  full_name: string;
  designation?: string | null;
  department?: string | null;
  date_of_joining?: string | null;
  employment_type?: string | null;
  is_exit: boolean;
  exit_date?: string | null;
  last_working_day?: string | null;
  notice_period_days?: number | null;
  tenure_days?: number | null;
};

type HistoryProject = {
  assignment_id: number;
  project_id: number;
  project_title?: string | null;
  customer_name?: string | null;
  status?: string | null;
  onboarding_date?: string | null;
  billing_date?: string | null;
  billing_rate?: number | null;
  billing_unit?: string | null;
  work_mode?: string | null;
  is_active: boolean;
  is_exit: boolean;
  exit_date?: string | null;
};

type HistoryTimesheet = {
  id: number;
  month?: number | null;
  year?: number | null;
  period_label?: string | null;
  project_id?: number | null;
  project_title?: string | null;
  status?: string | null;
  hours_worked?: number | null;
  billable_hours?: number | null;
  billable_days?: number | null;
  comp_off_accrued?: number | null;
  approved_at?: string | null;
};

type HistoryInvoice = {
  id: number;
  invoice_number?: string | null;
  invoice_date?: string | null;
  period_label?: string | null;
  grand_total?: number | null;
  payment_status?: string | null;
};

type HistoryBilling = {
  total_billable_hours?: number | null;
  total_billable_days?: number | null;
  total_invoiced_amount?: number | null;
  invoices?: HistoryInvoice[] | null;
};

type LeaveBalanceRow = {
  code: string;
  label?: string | null;
  accrual?: number | null;
  consumed?: number | null;
  balance?: number | null;
};

type LeaveApplicationRow = {
  id: number;
  leave_type_name?: string | null;
  leave_period_type?: string | null;
  from_date?: string | null;
  to_date?: string | null;
  days?: number | null;
  status?: string | null;
  decided_at?: string | null;
};

type AccrualEventRow = {
  id: number;
  event_type?: string | null;
  leave_type_name?: string | null;
  amount?: number | null;
  balance_after?: number | null;
  source?: string | null;
  note?: string | null;
  created_at?: string | null;
};

type TimelineEvent = { date: string; type: string; label: string };

type EmployeeHistoryData = {
  employee: HistoryEmployee;
  projects?: HistoryProject[] | null;
  timesheets?: HistoryTimesheet[] | null;
  billing?: HistoryBilling | null;
  leave?: {
    balances?: LeaveBalanceRow[] | null;
    applications?: LeaveApplicationRow[] | null;
    accrual_events?: AccrualEventRow[] | null;
  } | null;
  education?: unknown[] | null;
  experience?: unknown[] | null;
  /** Oldest → newest. */
  timeline?: TimelineEvent[] | null;
};

/* ---------------------------------------------------------------- helpers */

const fmtDate = (d?: string | null): string => (d ? new Date(d).toLocaleDateString("en-IN") : "—");

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const fmtInr = (n?: number | null): string => (n == null ? "—" : inr.format(Number(n)));

const fmtNum = (n?: number | null): string =>
  n == null ? "—" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** "1 yr 2 mo" style tenure from a day count. */
function fmtTenure(days?: number | null): string {
  if (days == null || days < 0) return "";
  const months = Math.floor(days / 30.4375);
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (!y && !m) return `${days} d`;
  const parts: string[] = [];
  if (y) parts.push(`${y} yr${y > 1 ? "s" : ""}`);
  if (m) parts.push(`${m} mo`);
  return parts.join(" ");
}

/** Signed accrual amount with semantic colour (+ green / − red). */
function SignedAmount({ value }: { value?: number | null }) {
  if (value == null) return <span className="text-muted">—</span>;
  const cls = value > 0 ? "text-success" : value < 0 ? "text-danger" : "text-secondary";
  return <span className={`font-semibold tabular-nums ${cls}`}>{value > 0 ? `+${fmtNum(value)}` : fmtNum(value)}</span>;
}

/** Timeline dot colour: brand = joining/projects, success = approvals/invoices,
 * warning = resignation/exit (falls back to brand for unknown event types). */
function timelineDotCls(type: string): string {
  const t = String(type || "").toLowerCase();
  if (/resign|exit|separation|last_working|notice|offboard/.test(t)) return "bg-warning";
  if (/approv|invoice|paid|payment|bill/.test(t)) return "bg-success";
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
function SummaryTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="glass fx-gradient-border fx-lift rounded-card px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-display text-lg font-bold tabular-nums text-primary">{value ?? "—"}</div>
      {sub != null && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** Read-only glass section card (matches the detail page's SectionCard shell). */
function HistoryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-card border border-subtle bg-surface-1">
      <div className="fx-hairline-b px-5 py-3">
        <h2 className="text-sm font-bold text-primary">{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/** Definition item for the billing totals row. */
function DefItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums text-primary">{value ?? "—"}</div>
    </div>
  );
}

/** Collapsible sub-section (Leave card). No movement animation — content
 * simply mounts/unmounts, so it is reduced-motion safe by construction. */
function SubSection({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-subtle pt-3 first:border-t-0 first:pt-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 rounded-control py-1 text-left transition-colors duration-micro ease-smooth ${focusRing}`}
      >
        <span className="text-xs font-bold uppercase tracking-wide text-muted">
          {title}
          {count != null && <span className="ml-1.5 font-semibold normal-case text-muted">({count})</span>}
        </span>
        {open ? (
          <ChevronUp size={14} className="text-muted" aria-hidden />
        ) : (
          <ChevronDown size={14} className="text-muted" aria-hidden />
        )}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

/** Loading skeleton mirroring the final layout geometry. */
function HistorySkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading employee history">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="glass fx-gradient-border fx-lift rounded-card px-4 py-3">
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

export function EmployeeHistoryTab({ employeeId }: { employeeId: number }) {
  const [data, setData] = useState<EmployeeHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    crmGet<EmployeeHistoryData>(`/api/employees/${employeeId}/history`)
      .then((r) => { setData(r.data); setError(""); })
      .catch((e) => setError(e?.message || "Failed to load employee history"))
      .finally(() => setLoading(false));
  };
  useEffect(load, [employeeId]);

  if (loading) return <HistorySkeleton />;
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <EmptyState message="No history available for this employee" />;

  const emp = data.employee;
  const projects = data.projects || [];
  const timesheets = data.timesheets || [];
  const billing: HistoryBilling = data.billing || {};
  const invoices = billing.invoices || [];
  const balances = data.leave?.balances || [];
  const applications = data.leave?.applications || [];
  const accrualEvents = data.leave?.accrual_events || [];
  const timeline = data.timeline || [];

  const tenure = fmtTenure(emp.tenure_days);
  const exitDate = emp.exit_date || emp.last_working_day;

  /* ------------------------------------------------ tables (DataTable) */

  type ProjectRow = HistoryProject & { id: number };
  const projectRows: ProjectRow[] = projects.map((p) => ({ ...p, id: p.assignment_id }));
  const projectColumns: Column<ProjectRow>[] = [
    {
      key: "project_title",
      label: "Project",
      render: (r) => (
        <CrmLink to={`projects/${r.project_id}`} className={linkCls}>
          {r.project_title || `#${r.project_id}`}
        </CrmLink>
      ),
    },
    { key: "customer_name", label: "Customer", render: (r) => r.customer_name || "—" },
    { key: "onboarding_date", label: "Onboarded", render: (r) => fmtDate(r.onboarding_date) },
    { key: "billing_date", label: "Billing Start", render: (r) => fmtDate(r.billing_date) },
    {
      key: "billing_rate",
      label: "Rate",
      align: "right",
      render: (r) =>
        r.billing_rate == null ? "—" : `${fmtInr(r.billing_rate)}${r.billing_unit ? ` / ${r.billing_unit}` : ""}`,
    },
    { key: "work_mode", label: "Work Mode", render: (r) => r.work_mode || "—" },
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
          <StatusBadge status={r.is_active ? "Active" : r.status || "Inactive"} />
        ),
    },
  ];

  const timesheetColumns: Column<HistoryTimesheet>[] = [
    {
      key: "period_label",
      label: "Period",
      render: (r) => (
        <CrmLink to={`timesheets/${r.id}`} className={linkCls}>
          {r.period_label || (r.month != null && r.year != null ? `${r.month}/${r.year}` : `#${r.id}`)}
        </CrmLink>
      ),
    },
    { key: "project_title", label: "Project", render: (r) => r.project_title || "—" },
    { key: "hours_worked", label: "Hours", align: "right", render: (r) => fmtNum(r.hours_worked) },
    { key: "billable_hours", label: "Billable Hrs", align: "right", render: (r) => fmtNum(r.billable_hours) },
    { key: "billable_days", label: "Billable Days", align: "right", render: (r) => fmtNum(r.billable_days) },
    { key: "comp_off_accrued", label: "Comp-Off", align: "right", render: (r) => fmtNum(r.comp_off_accrued) },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="space-y-4">
      {/* -------------------------------------------------- Summary strip */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryTile
          label="Joined"
          value={fmtDate(emp.date_of_joining)}
          sub={tenure ? `Tenure: ${tenure}` : undefined}
        />
        <SummaryTile
          label="Status"
          value={<StatusBadge status={emp.is_exit ? "Exited" : "Active"} />}
          sub={
            emp.is_exit
              ? `Exit: ${fmtDate(exitDate)}`
              : emp.employment_type
                ? String(emp.employment_type).replace(/_/g, " ")
                : undefined
          }
        />
        <SummaryTile
          label="Total Billable"
          value={`${fmtNum(billing.total_billable_hours)} hrs`}
          sub={`${fmtNum(billing.total_billable_days)} days`}
        />
        <SummaryTile
          label="Total Invoiced"
          value={fmtInr(billing.total_invoiced_amount)}
          sub={`${invoices.length} invoice${invoices.length === 1 ? "" : "s"}`}
        />
      </div>

      {/* ------------------------------------------------------- Projects */}
      <div className="space-y-2">
        <h2 className="text-sm font-bold text-primary">Projects</h2>
        <DataTable columns={projectColumns} rows={projectRows} emptyMessage="No projects yet" />
      </div>

      {/* ----------------------------------------------------- Timesheets */}
      <div className="space-y-2">
        <h2 className="text-sm font-bold text-primary">Timesheets</h2>
        <DataTable columns={timesheetColumns} rows={timesheets} emptyMessage="No timesheets yet" />
      </div>

      {/* -------------------------------------------------------- Billing */}
      <HistoryCard title="Billing">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <DefItem label="Total billable hours" value={fmtNum(billing.total_billable_hours)} />
          <DefItem label="Total billable days" value={fmtNum(billing.total_billable_days)} />
          <DefItem label="Total invoiced" value={fmtInr(billing.total_invoiced_amount)} />
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
                    <th className={thRightCls}>Amount</th>
                    <th className={thCls}>Payment</th>
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
                      <td className={`${tdRightCls} font-semibold text-primary`}>{fmtInr(inv.grand_total)}</td>
                      <td className={tdCls}><StatusBadge status={inv.payment_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </HistoryCard>

      {/* ---------------------------------------------------------- Leave */}
      <HistoryCard title="Leave">
        <div className="space-y-3">
          <SubSection title="Balances" count={balances.length}>
            {balances.length === 0 ? (
              <EmptyState message="No leave balances recorded" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-max text-sm lg:min-w-0">
                  <thead>
                    <tr className="border-b border-subtle">
                      <th className={thCls}>Leave Type</th>
                      <th className={thRightCls}>Accrual</th>
                      <th className={thRightCls}>Consumed</th>
                      <th className={thRightCls}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balances.map((b) => (
                      <tr key={b.code} className={bodyRowCls}>
                        <td className={`${tdCls} font-semibold text-primary`}>{b.label || b.code}</td>
                        <td className={tdRightCls}>{fmtNum(b.accrual)}</td>
                        <td className={tdRightCls}>{fmtNum(b.consumed)}</td>
                        <td className={`${tdRightCls} font-semibold text-primary`}>{fmtNum(b.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SubSection>

          <SubSection title="Applications" count={applications.length}>
            {applications.length === 0 ? (
              <EmptyState message="No leave applications yet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-max text-sm lg:min-w-0">
                  <thead>
                    <tr className="border-b border-subtle">
                      <th className={thCls}>Type</th>
                      <th className={thCls}>From</th>
                      <th className={thCls}>To</th>
                      <th className={thRightCls}>Days</th>
                      <th className={thCls}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applications.map((a) => (
                      <tr key={a.id} className={bodyRowCls}>
                        <td className={`${tdCls} font-semibold text-primary`}>
                          {a.leave_type_name || "—"}
                          {a.leave_period_type && (
                            <span className="ml-1.5 text-xs font-normal text-muted">({a.leave_period_type})</span>
                          )}
                        </td>
                        <td className={tdCls}>{fmtDate(a.from_date)}</td>
                        <td className={tdCls}>{fmtDate(a.to_date)}</td>
                        <td className={tdRightCls}>{fmtNum(a.days)}</td>
                        <td className={tdCls}><StatusBadge status={a.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SubSection>

          <SubSection title="Accrual Events" count={accrualEvents.length} defaultOpen={false}>
            {accrualEvents.length === 0 ? (
              <EmptyState message="No accrual events yet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-max text-sm lg:min-w-0">
                  <thead>
                    <tr className="border-b border-subtle">
                      <th className={thCls}>Date</th>
                      <th className={thCls}>Event</th>
                      <th className={thCls}>Type</th>
                      <th className={thRightCls}>Amount</th>
                      <th className={thRightCls}>Balance After</th>
                      <th className={thCls}>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accrualEvents.map((ev) => (
                      <tr key={ev.id} className={bodyRowCls}>
                        <td className={`${tdCls} tabular-nums`}>{fmtDate(ev.created_at)}</td>
                        <td className={tdCls}>{ev.event_type ? String(ev.event_type).replace(/_/g, " ") : "—"}</td>
                        <td className={tdCls}>{ev.leave_type_name || "—"}</td>
                        <td className={tdRightCls}><SignedAmount value={ev.amount} /></td>
                        <td className={tdRightCls}>{fmtNum(ev.balance_after)}</td>
                        <td className={tdCls}>
                          {ev.source || "—"}
                          {ev.note && <div className="mt-0.5 text-xs text-muted">{ev.note}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SubSection>
        </div>
      </HistoryCard>

      {/* ------------------------------------------------------- Timeline */}
      <HistoryCard title="Timeline">
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
      </HistoryCard>
    </div>
  );
}
