/**
 * Branch hub tabs (Aug 2026) — branch-scoped Projects / Timesheets / Invoices /
 * Purchase Orders / Employees, rendered inside the Branch page
 * (Customers → Branches → open a branch).
 *
 * Branch scoping strategy (frontend-only, no new backend filters):
 *  - The branch's project set comes from GET /api/customers/branches/{id}/policy
 *    → linked_projects (passed in as props) — the authoritative branch→project
 *    link.
 *  - Timesheets / Invoices / Employees fan out per branch project over the
 *    EXISTING server filters (/api/timesheets?project_id=, /api/invoices?
 *    project_id=, /api/projects/all-employees?project_id=) and merge, the same
 *    Promise.all pattern Requirements.tsx uses for statuses.
 *  - Purchase Orders load customer-wide and filter client-side on
 *    billing_branch_id / delivery_branch_id when the payload carries them.
 */
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { crmGet, qs } from "../api";
import { crmNavigate } from "../routerHooks";
import { DataTable, type Column } from "./DataTable";
import { EmptyState, ErrorBox, Field, Spinner, StatusBadge, btnPrimary, inputCls } from "./ui";

/** Lazy so the branch page never pulls the 1,900-line wizard into its bundle. */
const LazyNewOpportunityForm = React.lazy(() =>
  import("../pages/opportunity/NewOpportunityForm")
    .then((m) => ({ default: m.NewOpportunityForm })));

export type BranchProject = { id: number; name: string; status?: string | null };

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "—");
const money = (v: unknown) =>
  v === null || v === undefined ? "—" : `₹${Number(v).toLocaleString("en-IN")}`;

function SelectFilter({ label, value, onChange, options, allLabel = "All" }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; allLabel?: string;
}) {
  return (
    <div className="w-44">
      <Field label={label}>
        <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{allLabel}</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
    </div>
  );
}

const opts = (values: string[]) =>
  values.map((v) => ({ value: v, label: v.replace(/_/g, " ") }));

/** Fan a GET out over the branch's projects (or just the selected one) and
 * merge the pages. Each request rides the backend's max limit=100. */
function useProjectFanout<T>(
  projects: BranchProject[],
  projectFilter: string,
  buildUrl: (projectId: number) => string,
  deps: unknown[],
) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const ids = useMemo(
    () => (projectFilter ? [Number(projectFilter)] : projects.map((p) => p.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectFilter, projects.map((p) => p.id).join(",")],
  );
  const load = useCallback(async () => {
    if (!ids.length) { setRows([]); setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const results = await Promise.all(ids.map((pid) => crmGet<T[]>(buildUrl(pid))));
      setRows(results.flatMap((r) => r.data || []));
    } catch (e: any) {
      setError(e?.message || "Failed to load");
      setRows([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(","), ...deps]);
  useEffect(() => { load(); }, [load]);
  return { rows, loading, error, reload: load };
}

/* ------------------------------------------------------------------ Projects */

export function BranchProjectsTab({ projects }: { projects: BranchProject[] }) {
  const [status, setStatus] = useState("");
  const list = status ? projects.filter((p) => p.status === status) : projects;
  const cols: Column<BranchProject>[] = [
    { key: "name", label: "Project", render: (r) => <span className="font-semibold text-primary">{r.name}</span> },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status || "—"} /> },
  ];
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Projects billed under this branch — open one for its Overview / Team / Timesheet / PO &amp; Invoices.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <SelectFilter label="Status" value={status} onChange={setStatus}
          options={opts(["Active", "Completed", "On_Hold"])} />
      </div>
      <DataTable columns={cols} rows={list} loading={false}
        emptyMessage="No projects for this branch yet."
        onRowClick={(r) => crmNavigate(`projects/${r.id}`)} />
    </div>
  );
}

/* ---------------------------------------------------------------- Timesheets */

type BranchTs = {
  id: number; project_id: number; employee_id: number;
  month?: number | null; year?: number | null; status?: string | null;
  submitted_at?: string | null; approved_at?: string | null;
};

export function BranchTimesheetsTab({ projects }: { projects: BranchProject[] }) {
  const [projectId, setProjectId] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [status, setStatus] = useState("");
  const [employees, setEmployees] = useState<any[]>([]);
  useEffect(() => {
    crmGet<any[]>("/api/employees?limit=100").then((r) => setEmployees(r.data || [])).catch(() => {});
  }, []);
  const projectName = useMemo(() => {
    const m = new Map(projects.map((p) => [p.id, p.name]));
    return (id: number) => m.get(id) || `#${id}`;
  }, [projects]);
  const employeeName = useMemo(() => {
    const m = new Map<number, string>();
    employees.forEach((e) => m.set(e.id, e.full_name || `${e.first_name || ""} ${e.last_name || ""}`.trim()));
    return (id: number) => m.get(id) || `#${id}`;
  }, [employees]);

  const { rows, loading, error, reload } = useProjectFanout<BranchTs>(
    projects, projectId,
    (pid) => `/api/timesheets${qs({ project_id: pid, month, year, status, limit: 100 })}`,
    [month, year, status],
  );

  const cols: Column<BranchTs>[] = [
    { key: "project", label: "Project", render: (r) => <span className="font-semibold">{projectName(r.project_id)}</span> },
    { key: "employee", label: "Employee", render: (r) => employeeName(r.employee_id) },
    { key: "period", label: "Period", render: (r) => `${MONTHS[(r.month || 1) - 1]} ${r.year ?? ""}` },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status || "—"} /> },
    { key: "submitted_at", label: "Submitted", render: (r) => fmtDate(r.submitted_at) },
    { key: "approved_at", label: "Approved", render: (r) => fmtDate(r.approved_at) },
  ];
  const now = new Date();
  const years = Array.from({ length: 6 }, (_, i) => String(now.getFullYear() - 4 + i));
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Timesheets across this branch&rsquo;s {projects.length} project{projects.length === 1 ? "" : "s"}.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <SelectFilter label="Project" value={projectId} onChange={setProjectId}
          options={projects.map((p) => ({ value: String(p.id), label: p.name }))} />
        <SelectFilter label="Month" value={month} onChange={setMonth}
          options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
        <SelectFilter label="Year" value={year} onChange={setYear}
          options={years.map((y) => ({ value: y, label: y }))} />
        <SelectFilter label="Status" value={status} onChange={setStatus}
          options={opts(["Draft", "Submitted", "Approved", "Rejected"])} />
      </div>
      {error
        ? <ErrorBox error={error} onRetry={reload} />
        : <DataTable columns={cols} rows={rows} loading={loading}
            emptyMessage="No timesheets for this branch match the current filters."
            onRowClick={(r) => crmNavigate(`timesheets/${r.id}`)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ Invoices */

type BranchInv = {
  id: number; project_id?: number | null; invoice_number?: string | null;
  invoice_date?: string | null; grand_total?: number | null;
  balance_amount?: number | null; payment_status?: string | null;
};

export function BranchInvoicesTab({ projects }: { projects: BranchProject[] }) {
  const [projectId, setProjectId] = useState("");
  const [payment, setPayment] = useState("");
  const projectName = useMemo(() => {
    const m = new Map(projects.map((p) => [p.id, p.name]));
    return (id?: number | null) => (id ? m.get(id) || `#${id}` : "—");
  }, [projects]);
  const { rows, loading, error, reload } = useProjectFanout<BranchInv>(
    projects, projectId,
    (pid) => `/api/invoices${qs({ project_id: pid, payment_status: payment, limit: 100 })}`,
    [payment],
  );
  const cols: Column<BranchInv>[] = [
    { key: "invoice_number", label: "Invoice", render: (r) => <span className="font-semibold text-primary">{r.invoice_number}</span> },
    { key: "project", label: "Project", render: (r) => projectName(r.project_id) },
    { key: "invoice_date", label: "Date", render: (r) => fmtDate(r.invoice_date) },
    { key: "grand_total", label: "Grand total", align: "right", render: (r) => money(r.grand_total) },
    { key: "balance_amount", label: "Balance", align: "right", render: (r) => money(r.balance_amount) },
    { key: "payment_status", label: "Payment", render: (r) => <StatusBadge status={r.payment_status || "—"} /> },
  ];
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Invoices raised against this branch&rsquo;s projects.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <SelectFilter label="Project" value={projectId} onChange={setProjectId}
          options={projects.map((p) => ({ value: String(p.id), label: p.name }))} />
        <SelectFilter label="Payment" value={payment} onChange={setPayment}
          options={opts(["Unpaid", "Partially_Paid", "Paid"])} />
      </div>
      {error
        ? <ErrorBox error={error} onRetry={reload} />
        : <DataTable columns={cols} rows={rows} loading={loading}
            emptyMessage="No invoices for this branch match the current filters."
            onRowClick={(r) => crmNavigate(`invoices/${r.id}`)} />}
    </div>
  );
}

/* ----------------------------------------------------------- Purchase Orders */

export function BranchPosTab({ customerId, branchId }: { customerId: number; branchId: number }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await crmGet<any[]>(`/api/purchase-orders${qs({ customer_id: customerId, status, limit: 100 })}`);
      setRows(r.data || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load purchase orders");
    } finally {
      setLoading(false);
    }
  }, [customerId, status]);
  useEffect(() => { load(); }, [load]);

  // Branch link is on the PO (billing/delivery branch). If the list payload
  // doesn't carry the fields, we show the customer's POs with a note instead
  // of silently hiding rows.
  const hasBranchField = rows.some((r) => "billing_branch_id" in r || "delivery_branch_id" in r);
  const list = hasBranchField
    ? rows.filter((r) => r.billing_branch_id === branchId || r.delivery_branch_id === branchId)
    : rows;

  const cols: Column<any>[] = [
    { key: "po_number", label: "PO Number", render: (r) => <span className="font-semibold text-primary">{r.po_number}</span> },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "total_value", label: "Total", align: "right", render: (r) => money(r.total_value) },
    { key: "consumed_value", label: "Consumed", align: "right", render: (r) => money(r.consumed_value) },
    { key: "balance_value", label: "Balance", align: "right", render: (r) => money(r.balance_value) },
    { key: "end_date", label: "Valid till", align: "right", render: (r) => fmtDate(r.end_date) },
  ];
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        {hasBranchField
          ? "Purchase orders billed to or delivered at this branch."
          : "Branch link unavailable on the PO list — showing every PO for this customer."}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <SelectFilter label="Status" value={status} onChange={setStatus}
          options={opts(["Active", "Exhausted", "Cancelled"])} />
      </div>
      {error
        ? <ErrorBox error={error} onRetry={load} />
        : <DataTable columns={cols} rows={list} loading={loading}
            emptyMessage="No purchase orders for this branch match the current filters."
            onRowClick={(r) => crmNavigate(`pos/${r.id}`)} />}
    </div>
  );
}

/* --------------------------------------------------------- Opportunities */

/** Deals belonging to THIS branch (18 Aug 2026) — server-filtered through the
 * new `branch_id` parameter, so paging and counts stay honest (no client-side
 * slicing of a customer-wide page). "New Opportunity" opens the same wizard
 * as everywhere else, pre-filled with this customer AND branch; both remain
 * editable, exactly like the customer hub's button. */
export function BranchOpportunitiesTab({
  customerId, branchId, branchName, canCreate,
}: {
  customerId: number; branchId: number; branchName?: string | null; canCreate: boolean;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stage, setStage] = useState("");
  const [approval, setApproval] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await crmGet<any[]>(`/api/opportunities${qs({
        branch_id: branchId, pipeline_stage: stage || undefined,
        approval_status: approval || undefined, limit: 100,
      })}`);
      setRows(r.data || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load opportunities");
    } finally {
      setLoading(false);
    }
  }, [branchId, stage, approval]);
  useEffect(() => { load(); }, [load]);

  const cols: Column<any>[] = [
    { key: "opp_id", label: "Opportunity ID",
      render: (r) => <span className="font-semibold text-primary">{r.opp_id}</span> },
    { key: "title", label: "Title", render: (r) => r.title || "—" },
    { key: "opp_type", label: "Type", render: (r) => String(r.opp_type || "—").replace(/_/g, " ") },
    { key: "pipeline_stage", label: "Stage", render: (r) => <StatusBadge status={r.pipeline_stage} /> },
    { key: "approval_status", label: "Approval",
      render: (r) => (r.approval_status ? <StatusBadge status={r.approval_status} /> : "—") },
    { key: "rfi_value", label: "RFI Value", align: "right", render: (r) => money(r.rfi_value) },
    { key: "created_at", label: "Created", align: "right", render: (r) => fmtDate(r.created_at) },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          Opportunities raised for {branchName || "this branch"} — open one for its
          applicants, skills and CTC slab.
        </p>
        {canCreate && (
          <button className={btnPrimary} onClick={() => setShowCreate(true)}>
            <Plus size={15} /> New Opportunity
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <SelectFilter label="Stage" value={stage} onChange={setStage}
          options={opts(["New", "Active", "On_Hold", "Closed_Won", "Closed_Lost",
            "Closed_Partial", "Rejected", "Archived"])} />
        <SelectFilter label="Approval" value={approval} onChange={setApproval}
          options={opts(["Pending_Sales_Head_Approval", "Approved", "Rejected"])} />
      </div>
      {showCreate && (
        <Suspense fallback={<Spinner label="Opening the opportunity wizard…" />}>
          <LazyNewOpportunityForm
            initialCustomerId={customerId}
            initialBranchId={branchId}
            onClose={() => setShowCreate(false)}
            onCreated={() => { setShowCreate(false); load(); }}
          />
        </Suspense>
      )}
      {error
        ? <ErrorBox error={error} onRetry={load} />
        : <DataTable columns={cols} rows={rows} loading={loading}
            emptyMessage={`No opportunities for ${branchName || "this branch"} yet.`}
            onRowClick={(r) => crmNavigate(`opportunities/${r.id}`)} />}
    </div>
  );
}

/* ----------------------------------------------------- Employees working */

type BranchPe = {
  id: number; project_id: number; project_name?: string | null;
  employee_name?: string | null; employee_email?: string | null;
  onboarding_date?: string | null; work_mode?: string | null;
  billing_rate?: number | null; billing_unit?: string | null;
  is_active?: boolean; is_exit?: boolean;
};

export function BranchEmployeesTab({ projects }: { projects: BranchProject[] }) {
  const [projectId, setProjectId] = useState("");
  const [state, setState] = useState("");
  const [search, setSearch] = useState("");
  const { rows, loading, error, reload } = useProjectFanout<BranchPe>(
    projects, projectId,
    (pid) => `/api/projects/all-employees${qs({ project_id: pid, limit: 100 })}`,
    [],
  );
  const projectName = useMemo(() => {
    const m = new Map(projects.map((p) => [p.id, p.name]));
    return (r: BranchPe) => r.project_name || m.get(r.project_id) || `#${r.project_id}`;
  }, [projects]);

  const q = search.trim().toLowerCase();
  const list = rows.filter((r) => {
    if (state === "active" && (r.is_exit || r.is_active === false)) return false;
    if (state === "exited" && !r.is_exit) return false;
    if (q && ![r.employee_name, r.employee_email, projectName(r)]
      .some((v) => (v || "").toLowerCase().includes(q))) return false;
    return true;
  });

  const cols: Column<BranchPe>[] = [
    {
      key: "employee", label: "Employee",
      render: (r) => (
        <div>
          <div className="font-semibold text-primary">{r.employee_name || "—"}</div>
          {r.employee_email && <div className="text-xs text-muted">{r.employee_email}</div>}
        </div>
      ),
    },
    { key: "project", label: "Project", render: (r) => projectName(r) },
    { key: "onboarding_date", label: "Onboarded", render: (r) => fmtDate(r.onboarding_date) },
    { key: "work_mode", label: "Work mode", render: (r) => r.work_mode || "—" },
    {
      key: "rate", label: "Rate", align: "right",
      render: (r) => (r.billing_rate ? `${money(r.billing_rate)}${r.billing_unit ? ` / ${r.billing_unit}` : ""}` : "—"),
    },
    {
      key: "state", label: "Status",
      render: (r) => <StatusBadge status={r.is_exit ? "Exited" : r.is_active === false ? "Inactive" : "Active"} />,
    },
  ];
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Everyone deployed on this branch&rsquo;s projects — open a row for the full mapping
        (rates, leave, timesheets).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <SelectFilter label="Project" value={projectId} onChange={setProjectId}
          options={projects.map((p) => ({ value: String(p.id), label: p.name }))} />
        <SelectFilter label="Status" value={state} onChange={setState}
          options={[{ value: "active", label: "Active" }, { value: "exited", label: "Exited" }]} />
        <div className="w-56">
          <Field label="Search">
            <input className={inputCls} value={search} placeholder="Employee, email or project…"
              onChange={(e) => setSearch(e.target.value)} />
          </Field>
        </div>
      </div>
      {error
        ? <ErrorBox error={error} onRetry={reload} />
        : list.length === 0 && !loading
          ? <EmptyState message="No employees working under this branch match the current filters." />
          : <DataTable columns={cols} rows={list} loading={loading}
              emptyMessage="No employees working under this branch."
              onRowClick={(r) => crmNavigate(`project-employees/${r.id}`)} />}
    </div>
  );
}
