/** Project Employees — the bridge tab. One row per (employee × project) mapping,
 * each carrying its own rate / leave / timesheet. Backed by
 * GET /api/projects/all-employees. Map new via POST /api/projects/{id}/employees.
 * Group-by-employee collapses to one expandable card per person (UC-12). */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Eye, Network, UserPlus } from "lucide-react";
import { crmGet, crmPost } from "../api";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanEditTab } from "../useAccess";
import { crmNavigate } from "../routerHooks";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { RowActions, afterListDelete } from "../components/RowActions";
import {
  ErrorBox, Field, Modal, StatusBadge, btnPrimary, btnSecondary, focusRing, inputCls, useToast,
} from "../components/ui";
import { InfoChip, SectionHeaderBanner, WizardField } from "../components/wizard";

/** Local single-screen shell — applies the shared New Opportunity wizard look
 * (theme-aware body + SectionHeaderBanner) inside the existing Modal.
 * Visual-only wrapper: no field, state, or submit logic lives here. */
function WizFormShell({
  title, subtitle, icon, children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="crm-wizard wiz-noise min-h-full w-full bg-[color:var(--wiz-bg)] px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-3xl">
        <SectionHeaderBanner title={title} description={subtitle} icon={icon} />
        {children}
      </div>
    </div>
  );
}

/* Shared footer container for the reskinned single-screen dialogs. */
const wizFooterRow = "mt-6 flex items-center gap-3 border-t border-[color:var(--wiz-border)] pt-5";

type PeRow = {
  id: number;
  project_id: number;
  project_name?: string | null;
  customer_id?: number | null;
  customer_name?: string | null;
  employee_id: number;
  employee_name?: string | null;
  employee_email?: string | null;
  onboarding_date?: string | null;
  experience_years?: number | null;
  work_mode?: string | null;
  billing_rate?: number | null;
  billing_unit?: string | null;
  is_active?: boolean;
  is_exit?: boolean;
  exit_date?: string | null;
  billing_date?: string | null;
  leave_balance_total?: number | null;
  po_status?: "ok" | "warn_80" | "blocked" | string | null;
  po_utilization_pct?: number | null;
  po_number?: string | null;
  settlement_pending?: boolean;
};

type EmpGroup = {
  employee_id: number;
  employee_name?: string | null;
  employee_email?: string | null;
  mapping_count: number;
  mappings: PeRow[];
};

type Opt = { id: number; name: string };
const money = (v?: number | null) => (v == null ? "—" : `₹${Number(v).toLocaleString("en-IN")}`);
const dt = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : "—");

function PoChip({ status, pct }: { status?: string | null; pct?: number | null }) {
  const s = (status || "ok").toLowerCase();
  const label =
    s === "blocked" ? "PO blocked" :
    s === "warn_80" ? `PO ${pct != null ? `${Math.round(pct)}%` : "80%+"}` :
    "PO OK";
  const tone =
    s === "blocked" ? "bg-danger-soft text-danger ring-1 ring-inset ring-danger/30" :
    s === "warn_80" ? "bg-warning-soft text-warning ring-1 ring-inset ring-warning/30" :
    "bg-success-soft text-success ring-1 ring-inset ring-success/30";
  return (
    <span className={`inline-flex items-center rounded-control px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {label}
    </span>
  );
}

/* -------------------------------------------------------- map employee modal */
function MapModal({ onClose, onSaved, notify }: {
  onClose: () => void; onSaved: () => void; notify: (m: string, k?: "ok" | "err") => void;
}) {
  const [projects, setProjects] = useState<Opt[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [projectId, setProjectId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [rate, setRate] = useState("");
  const [unit, setUnit] = useState("Monthly");
  const [workMode, setWorkMode] = useState("Onsite");
  const [onboarding, setOnboarding] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    crmGet<any[]>("/api/projects?limit=200").then((r) => setProjects((r.data || []).map((p) => ({ id: p.id, name: p.name })))).catch(() => {});
    crmGet<any[]>("/api/employees?limit=500").then((r) => setEmployees(r.data || [])).catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!projectId) errs.project = "Select a project";
    if (!employeeId) errs.employee = "Select an employee";
    if (!rate || Number(rate) <= 0) errs.rate = "Enter a billing rate";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const res = await crmPost(`/api/projects/${projectId}/employees`, {
        employee_id: Number(employeeId),
        billing_rate: Number(rate),
        billing_unit: unit,
        work_mode: workMode,
        onboarding_date: onboarding || null,
      });
      notify((res as any).message || "Employee mapped to project");
      onSaved();
      onClose();
    } catch (err: any) {
      notify(err?.message || "Failed to map employee", "err");
    } finally {
      setSaving(false);
    }
  };

  const empLabel = (e: any) =>
    [e.first_name, e.last_name].filter(Boolean).join(" ") || e.full_name || e.email || `Employee #${e.id}`;

  return (
    <Modal
      title={<span className="sr-only">Map employee to project</span>}
      onClose={onClose}
      wide
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title="Map employee to project"
        subtitle="Deploy an employee onto a project with billing rate, unit, and work mode."
        icon={<Network size={20} aria-hidden />}
      >
        <form onSubmit={submit}>
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            <WizardField label="Project" required error={errors.project} icon="building">
              <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Select project…</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </WizardField>
            <WizardField label="Employee" required error={errors.employee} icon="user">
              <select className={inputCls} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">Select employee…</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{empLabel(e)}</option>)}
              </select>
            </WizardField>
            <WizardField label="Billing rate" required error={errors.rate} icon="hash" filled={!!rate && Number(rate) > 0}>
              <input className={inputCls} type="number" min={0} value={rate} onChange={(e) => setRate(e.target.value)} />
            </WizardField>
            <WizardField label="Billing unit" icon="hash">
              <select className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)}>
                {["Hourly", "Daily", "Monthly"].map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </WizardField>
            <WizardField label="Work mode" icon="map">
              <select className={inputCls} value={workMode} onChange={(e) => setWorkMode(e.target.value)}>
                {["Onsite", "Remote", "Hybrid"].map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </WizardField>
            <WizardField label="Onboarding date" icon="calendar" filled={!!onboarding}>
              <input className={inputCls} type="date" value={onboarding} onChange={(e) => setOnboarding(e.target.value)} />
            </WizardField>
          </div>
          <InfoChip>
            Mapping creates a Project Employee record — the bridge that carries this deployment&apos;s leave
            policy, holiday calendar, timesheet and rate, independently of any other project the person is on.
          </InfoChip>
          <div className={wizFooterRow}>
            <button type="button" className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className={`${btnPrimary} btn-gradient ml-auto h-10 rounded-xl px-4`} disabled={saving}>{saving ? "Saving…" : "Map employee"}</button>
          </div>
        </form>
      </WizFormShell>
    </Modal>
  );
}

function MappingRow({ r }: { r: PeRow }) {
  return (
    <div className="grid grid-cols-1 gap-2 border-t border-subtle px-4 py-3 sm:grid-cols-6 sm:items-center">
      <div>
        <div className="font-medium text-primary">{r.project_name || "—"}</div>
        <div className="text-xs text-muted">{r.customer_name || "—"}</div>
      </div>
      <div className="text-sm text-secondary">Onboard {dt(r.onboarding_date)}</div>
      <div className="text-sm text-secondary">
        Leave {r.leave_balance_total != null ? Number(r.leave_balance_total).toFixed(1) : "—"}
      </div>
      <div className="text-sm text-secondary">{money(r.billing_rate)} / {r.billing_unit || "—"}</div>
      <div><PoChip status={r.po_status} pct={r.po_utilization_pct ?? undefined} /></div>
      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <StatusBadge status={r.is_exit ? "Exited" : r.is_active ? "Active" : "Inactive"} />
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded-control border border-subtle bg-surface-1 px-2 py-1 text-xs font-semibold text-secondary hover:bg-surface-2 ${focusRing}`}
          onClick={() => crmNavigate(`project-employees/${r.id}`)}
        >
          <Eye size={13} /> Open
        </button>
      </div>
    </div>
  );
}

function GroupedList({ groups, loading }: { groups: EmpGroup[]; loading: boolean }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  if (loading) {
    return <div className="rounded-card border border-subtle bg-surface-1 p-8 text-center text-muted">Loading…</div>;
  }
  if (!groups.length) {
    return <div className="rounded-card border border-subtle bg-surface-1 p-8 text-center text-muted">No project employees match these filters</div>;
  }
  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const expanded = open[g.employee_id] !== false; // default expanded
        return (
          <div key={g.employee_id} className="overflow-hidden rounded-card border border-subtle bg-surface-1">
            <button
              type="button"
              className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 ${focusRing}`}
              onClick={() => setOpen((s) => ({ ...s, [g.employee_id]: !expanded }))}
            >
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-primary">{g.employee_name || `Employee #${g.employee_id}`}</div>
                <div className="truncate text-xs text-muted">{g.employee_email || ""}</div>
              </div>
              <span className="rounded-control bg-surface-2 px-2 py-0.5 text-xs font-semibold text-secondary">
                {g.mapping_count} mapping{g.mapping_count === 1 ? "" : "s"}
              </span>
            </button>
            {expanded && g.mappings.map((m) => <MappingRow key={m.id} r={m} />)}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- list page */
export function ProjectEmployeesPage() {
  const canWrite = useHasRole("Sales_Head", "Finance", "HR") && useCanEditTab("project-employees");
  const [toast, notify] = useToast();
  const [rows, setRows] = useState<PeRow[]>([]);
  const [groups, setGroups] = useState<EmpGroup[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [mapping, setMapping] = useState(false);
  const [groupByEmployee, setGroupByEmployee] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "exited">("active");
  const [projectFilter, setProjectFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [projects, setProjects] = useState<Opt[]>([]);
  const [customers, setCustomers] = useState<Opt[]>([]);

  useEffect(() => {
    const t = window.setTimeout(() => { setDebounced(search); setPage(1); }, 350);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    crmGet<any[]>("/api/projects?limit=200").then((r) => setProjects((r.data || []).map((p) => ({ id: p.id, name: p.name })))).catch(() => {});
    crmGet<any[]>("/api/customers?limit=200").then((r) => setCustomers((r.data || []).map((c) => ({ id: c.id, name: c.name })))).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (debounced) params.set("search", debounced);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (projectFilter) params.set("project_id", projectFilter);
      if (customerFilter) params.set("customer_id", customerFilter);
      if (groupByEmployee) params.set("group_by", "employee");
      const res = await crmGet<any[]>(`/api/projects/all-employees?${params}`);
      if (groupByEmployee) {
        setGroups((res.data || []) as EmpGroup[]);
        setRows([]);
      } else {
        setRows((res.data || []) as PeRow[]);
        setGroups([]);
      }
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load project employees");
    } finally {
      setLoading(false);
    }
  }, [page, debounced, statusFilter, projectFilter, customerFilter, groupByEmployee]);
  useEffect(() => { load(); }, [load]);

  const columns: Column<PeRow>[] = useMemo(() => [
    {
      key: "employee_name", label: "Employee",
      render: (r) => (
        <div>
          <div className="font-semibold text-primary">{r.employee_name || "—"}</div>
          <div className="text-xs text-muted">{r.employee_email || ""}</div>
        </div>
      ),
    },
    { key: "project_name", label: "Project", render: (r) => r.project_name || "—" },
    { key: "customer_name", label: "Client", render: (r) => <span className="text-secondary">{r.customer_name || "—"}</span> },
    { key: "onboarding_date", label: "Onboarding", render: (r) => dt(r.onboarding_date) },
    {
      key: "leave_balance_total", label: "Leave balance",
      render: (r) => (r.leave_balance_total != null ? Number(r.leave_balance_total).toFixed(1) : "—"),
    },
    {
      key: "billing_rate", label: "Current rate",
      render: (r) => `${money(r.billing_rate)} / ${r.billing_unit || "—"}`,
    },
    {
      key: "po_status", label: "PO",
      render: (r) => <PoChip status={r.po_status} pct={r.po_utilization_pct ?? undefined} />,
    },
    {
      key: "is_exit", label: "Is exit",
      render: (r) => <StatusBadge status={r.is_exit ? "Exited" : r.is_active ? "Active" : "Inactive"} />,
    },
  ], []);

  return (
    <div>
      {toast}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-display text-xl font-bold text-primary">Project Employees</h1>
          <p className="mt-0.5 text-sm text-muted">
            One row per employee × project. Leave, holidays, timesheet and rate live on the mapping.
          </p>
        </div>
        {canWrite && (
          <button type="button" className={btnPrimary} onClick={() => setMapping(true)}>
            <UserPlus size={15} /> Map employee
          </button>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-card border border-subtle bg-surface-1 p-3">
        <Field label="Project">
          <select className={inputCls} value={projectFilter} onChange={(e) => { setProjectFilter(e.target.value); setPage(1); }}>
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Client">
          <select className={inputCls} value={customerFilter} onChange={(e) => { setCustomerFilter(e.target.value); setPage(1); }}>
            <option value="">All clients</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className={inputCls} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as any); setPage(1); }}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="exited">Exited</option>
          </select>
        </Field>
        <label className={`mb-1 inline-flex cursor-pointer items-center gap-2 text-sm text-secondary ${focusRing} rounded-control px-1`}>
          <input
            type="checkbox"
            checked={groupByEmployee}
            onChange={(e) => { setGroupByEmployee(e.target.checked); setPage(1); }}
          />
          Group by employee
        </label>
      </div>

      {error && <div className="mb-3"><ErrorBox error={error} onRetry={load} /></div>}
      {groupByEmployee ? (
        <GroupedList groups={groups} loading={loading} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          meta={meta}
          loading={loading}
          search={search}
          onSearch={setSearch}
          onPage={setPage}
          onRowClick={(r) => crmNavigate(`project-employees/${r.id}`)}
          emptyMessage="No project employees match these filters"
          rowActions={canWrite ? (r) => (
            <RowActions
              entity="project employee"
              itemLabel={r.employee_name || r.project_name}
              onView={() => crmNavigate(`project-employees/${r.id}`)}
              onEdit={() => crmNavigate(`project-employees/${r.id}`)}
              deleteUrl={`/api/projects/employees/${r.id}`}
              onDeleted={() => afterListDelete(r.id, setRows, load)}
              notify={notify}
              canEdit
              canDelete
            />
          ) : undefined}
        />
      )}
      {mapping && <MapModal onClose={() => setMapping(false)} onSaved={load} notify={notify} />}
    </div>
  );
}
