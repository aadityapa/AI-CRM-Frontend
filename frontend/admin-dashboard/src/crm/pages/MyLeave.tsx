/** My Leave — consolidated, employee-facing leave across every project the
 * current user is mapped to. Balances stay per Project Employee mapping (client
 * policy/holidays/billing differ per project); this screen sums them so the
 * employee sees one place. Apply leave per project via the Project Employee /
 * Leave Applications flow (project selection sets the applicable balance).
 * API: GET /api/me/project-leave */
import React, { useEffect, useState } from "react";
import { crmGet } from "../api";
import { CrmLink } from "../routerHooks";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState, ErrorBox, KpiCard, Spinner, StatusBadge } from "../components/ui";

const daysFmt = (v?: number | null) =>
  v == null ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });

type LeaveRow = {
  id: number;
  leave_type_id: number;
  leave_type_name?: string | null;
  leave_balance?: number | null;
  leave_accrual?: number | null;
  leave_consumed?: number | null;
  eligibility_label?: string | null;
};

type ProjectLeave = {
  project_employee_id: number;
  project_id: number;
  project_name?: string | null;
  customer_name?: string | null;
  is_active?: boolean;
  is_exit?: boolean;
  leave_balance_total?: number | null;
  leave_details: LeaveRow[];
};

type MyLeaveData = {
  employee_id?: number | null;
  total_leave_balance?: number | null;
  projects: ProjectLeave[];
};

const cols: Column<LeaveRow>[] = [
  { key: "leave_type_name", label: "Leave type", render: (r) => r.leave_type_name || "—" },
  { key: "leave_balance", label: "Balance", render: (r) => daysFmt(r.leave_balance) },
  { key: "leave_accrual", label: "Accrual / period", render: (r) => daysFmt(r.leave_accrual) },
  { key: "leave_consumed", label: "Consumed", render: (r) => daysFmt(r.leave_consumed) },
  { key: "eligibility_label", label: "Policy", render: (r) => r.eligibility_label || "—" },
];

export function MyLeavePage() {
  const [data, setData] = useState<MyLeaveData | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    crmGet<MyLeaveData>("/api/me/project-leave")
      .then((r) => { if (alive) setData(r.data); })
      .catch((e) => { if (alive) setErr(String(e?.message || e)); });
    return () => { alive = false; };
  }, []);

  if (err) return <ErrorBox error={err} />;
  if (!data) return <div className="rounded-card border border-subtle bg-surface-1 p-6"><Spinner /></div>;

  const projects = data.projects || [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-display text-lg font-bold text-primary">My Leave</h1>
        <span className="text-sm text-muted">Across {projects.length} project mapping{projects.length === 1 ? "" : "s"}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total leave balance" value={daysFmt(data.total_leave_balance)} />
        <KpiCard label="Active projects" value={String(projects.filter((p) => p.is_active && !p.is_exit).length)} />
      </div>

      {projects.length === 0 ? (
        <div className="rounded-card border border-subtle bg-surface-1">
          <EmptyState message="You are not currently mapped to any project. Leave balances appear once you are deployed on a client project." />
        </div>
      ) : (
        projects.map((p) => (
          <div key={p.project_employee_id} className="space-y-3 rounded-card border border-subtle bg-surface-1 p-4">
            <div className="fx-hairline-b flex flex-wrap items-center justify-between gap-2 pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <CrmLink
                  to={`project-employees/${p.project_employee_id}`}
                  className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
                >
                  {p.project_name || `Project #${p.project_id}`}
                </CrmLink>
                {p.customer_name && <span className="text-sm text-muted">· {p.customer_name}</span>}
                <StatusBadge status={p.is_exit ? "Exited" : p.is_active ? "Active" : "Inactive"} />
              </div>
              <span className="font-display text-sm font-semibold tabular-nums text-primary">
                Balance: {daysFmt(p.leave_balance_total)} day(s)
              </span>
            </div>
            <DataTable
              columns={cols}
              rows={(p.leave_details || []).map((r) => ({ ...r, id: r.id }))}
              loading={false}
              emptyMessage="No leave types seeded for this mapping yet"
            />
          </div>
        ))
      )}

      <p className="text-xs text-muted">
        To apply for leave, open the relevant project mapping and use “Apply leave” — the balance shown is
        specific to that client’s policy. Requests go to RMG/HR for approval.
      </p>
    </div>
  );
}
