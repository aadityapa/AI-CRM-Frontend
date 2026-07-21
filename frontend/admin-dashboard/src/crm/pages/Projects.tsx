/** Projects — list (status tabs) + detail (Overview, Team, Communication Matrix,
 * Timesheets, POs & Invoices) incl. one-click "Create PO". */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Receipt, Trash2, UserPlus } from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { CrmLink, crmNavigate, useCrmParams } from "../routerHooks";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import {
  ConfirmModal, EmptyState, ErrorBox, Field, Modal, Spinner, StatusBadge, Tabs,
  btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";

/* ------------------------------------------------------------ types & consts */

type Project = {
  id: number;
  opportunity_id: number;
  customer_id: number;
  name: string;
  billing_cycle_start_day: number;
  billing_cycle_end_day: number;
  billing_frequency: string;
  max_billable_hours_day: number | null;
  max_billable_hours_month: number | null;
  max_billable_days_month: number | null;
  no_billing_period_days: number | null;
  status: string;
  created_at: string | null;
};

type TeamMember = {
  id: number;
  employee_id: number;
  employee_name: string | null;
  employee_email: string | null;
  onboarding_date: string | null;
  experience_years: number | null;
  work_mode: string | null;
  billing_rate: number | null;
  billing_unit: string;
  is_active: boolean;
};

type CommEntry = {
  id: number;
  name: string;
  role: string | null;
  responsible_person: string | null;
  email: string | null;
  phone: string | null;
  type: string;
};

type ProjectDetail = Project & {
  customer_name?: string | null;
  opportunity_title?: string | null;
  team: TeamMember[];
  communication_matrix: CommEntry[];
};

const BILLING_FREQUENCIES = ["Monthly", "Bi_Weekly", "Weekly"];
const PROJECT_STATUSES = ["Active", "Completed", "On_Hold"];
const WORK_MODES = ["Remote", "Onsite", "Hybrid"];
const BILLING_UNITS = ["Hourly", "Daily", "Monthly"];
const COMM_TYPES = ["Customer", "Internal"];
const TS_STATUSES = ["Draft", "Submitted", "Approved", "Rejected"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "—");
const pretty = (s?: string | null) => (s ? String(s).replace(/_/g, " ") : "—");
const numOrUndef = (s: string) => (s.trim() === "" ? undefined : Number(s));

/* ================================================================ LIST PAGE */

export function ProjectsListPage() {
  const [tab, setTab] = useState("Active");
  const [rows, setRows] = useState<Project[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [opps, setOpps] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const canCreate = useHasRole("Sales_Head", "Finance");
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<Project[]>(`/api/projects${qs({ status: tab, page, limit: 20, search })}`);
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, [tab, page, search]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    crmGet<any[]>("/api/opportunities?limit=100").then((r) => setOpps(r.data || [])).catch(() => {});
    crmGet<any[]>("/api/customers?limit=100").then((r) => setCustomers(r.data || [])).catch(() => {});
  }, []);

  const customerName = useMemo(() => {
    const m = new Map<number, string>();
    customers.forEach((c) => m.set(c.id, c.name));
    return (id: number) => m.get(id) || `#${id}`;
  }, [customers]);
  const oppTitle = useMemo(() => {
    const m = new Map<number, string>();
    opps.forEach((o) => m.set(o.id, o.title));
    return (id: number) => m.get(id) || `#${id}`;
  }, [opps]);

  const columns: Column<Project>[] = [
    { key: "name", label: "Name", render: (r) => <span className="font-semibold">{r.name}</span> },
    { key: "customer", label: "Customer", render: (r) => customerName(r.customer_id) },
    { key: "opportunity", label: "Opportunity", render: (r) => oppTitle(r.opportunity_id) },
    { key: "billing_frequency", label: "Billing frequency", render: (r) => pretty(r.billing_frequency) },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-display text-xl font-bold text-primary">Projects</h1>
        {canCreate && (
          <button className={btnPrimary} onClick={() => setShowNew(true)}>
            <Plus size={15} /> New Project
          </button>
        )}
      </div>
      <Tabs
        tabs={PROJECT_STATUSES.map((s) => ({ key: s, label: pretty(s) }))}
        active={tab}
        onChange={(k) => { setTab(k); setPage(1); }}
      />
      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : (
        <DataTable<Project>
          columns={columns}
          rows={rows}
          meta={meta}
          loading={loading}
          search={search}
          onSearch={(q) => { setSearch(q); setPage(1); }}
          onPage={setPage}
          onRowClick={(r) => crmNavigate(`projects/${r.id}`)}
          emptyMessage={`No ${pretty(tab).toLowerCase()} projects`}
        />
      )}
      {showNew && (
        <NewProjectModal
          opps={opps}
          customers={customers}
          onClose={() => setShowNew(false)}
          onDone={(p) => { setShowNew(false); showToast("Project created"); crmNavigate(`projects/${p.id}`); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
      {toast}
    </div>
  );
}

function NewProjectModal({
  opps, customers, onClose, onDone, onError,
}: {
  opps: any[];
  customers: any[];
  onClose: () => void;
  onDone: (project: Project) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [oppId, setOppId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [startDay, setStartDay] = useState("1");
  const [endDay, setEndDay] = useState("31");
  const [frequency, setFrequency] = useState("Monthly");
  const [maxHrsDay, setMaxHrsDay] = useState("");
  const [maxHrsMonth, setMaxHrsMonth] = useState("");
  const [maxDaysMonth, setMaxDaysMonth] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const onOppChange = (v: string) => {
    setOppId(v);
    const opp = opps.find((o) => String(o.id) === v);
    if (opp?.customer_id) setCustomerId(String(opp.customer_id)); // customer auto-derived
  };

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Name is required";
    if (!oppId) errs.opp = "Opportunity is required";
    if (!customerId) errs.customer = "Customer is required";
    const sd = Number(startDay), ed = Number(endDay);
    if (!(sd >= 1 && sd <= 31)) errs.startDay = "Must be 1–31";
    if (!(ed >= 1 && ed <= 31)) errs.endDay = "Must be 1–31";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const res = await crmPost<Project>("/api/projects", {
        name: name.trim(),
        opportunity_id: Number(oppId),
        customer_id: Number(customerId),
        billing_cycle_start_day: sd,
        billing_cycle_end_day: ed,
        billing_frequency: frequency,
        max_billable_hours_day: numOrUndef(maxHrsDay),
        max_billable_hours_month: numOrUndef(maxHrsMonth),
        max_billable_days_month: numOrUndef(maxDaysMonth),
      });
      onDone(res.data);
    } catch (e: any) {
      onError(e?.message || "Failed to create project");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New Project" onClose={onClose} fullScreen>
      <div className="space-y-3">
        <Field label="Name" required error={errors.name}>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Opportunity" required error={errors.opp}>
          <select className={inputCls} value={oppId} onChange={(e) => onOppChange(e.target.value)}>
            <option value="">Select opportunity…</option>
            {opps.map((o) => (
              <option key={o.id} value={o.id}>{o.title}{o.customer_name ? ` — ${o.customer_name}` : ""}</option>
            ))}
          </select>
        </Field>
        <Field label="Customer" required error={errors.customer}>
          <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Billing cycle start day" error={errors.startDay}>
            <input type="number" min={1} max={31} className={inputCls} value={startDay} onChange={(e) => setStartDay(e.target.value)} />
          </Field>
          <Field label="Billing cycle end day" error={errors.endDay}>
            <input type="number" min={1} max={31} className={inputCls} value={endDay} onChange={(e) => setEndDay(e.target.value)} />
          </Field>
        </div>
        <Field label="Billing frequency">
          <select className={inputCls} value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            {BILLING_FREQUENCIES.map((f) => <option key={f} value={f}>{pretty(f)}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Max billable hrs/day">
            <input type="number" min={0} max={24} className={inputCls} value={maxHrsDay} onChange={(e) => setMaxHrsDay(e.target.value)} />
          </Field>
          <Field label="Max billable hrs/month">
            <input type="number" min={0} className={inputCls} value={maxHrsMonth} onChange={(e) => setMaxHrsMonth(e.target.value)} />
          </Field>
          <Field label="Max billable days/month">
            <input type="number" min={0} max={31} className={inputCls} value={maxDaysMonth} onChange={(e) => setMaxDaysMonth(e.target.value)} />
          </Field>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={btnPrimary} onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create project"}</button>
      </div>
    </Modal>
  );
}

/* ================================================================ DETAIL PAGE */

export function ProjectDetailPage() {
  const { id } = useCrmParams();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await crmGet<ProjectDetail>(`/api/projects/${id}`);
      setProject(res.data);
    } catch (e: any) {
      setError(e?.message || "Failed to load project");
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!project) return <Spinner label="Loading project…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <CrmLink to="projects" className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300">
          Projects
        </CrmLink>
        <span className="text-muted">/</span>
        <h1 className="text-display text-xl font-bold text-primary">{project.name}</h1>
        <StatusBadge status={project.status} />
      </div>
      <Tabs
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "team", label: "Team", count: project.team?.length },
          { key: "comm", label: "Communication Matrix", count: project.communication_matrix?.length },
          { key: "timesheets", label: "Timesheets" },
          { key: "finance", label: "POs & Invoices" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "overview" && <OverviewTab project={project} reload={load} showToast={showToast} />}
      {tab === "team" && <TeamTab project={project} reload={load} showToast={showToast} />}
      {tab === "comm" && <CommMatrixTab project={project} reload={load} showToast={showToast} />}
      {tab === "timesheets" && <ProjectTimesheetsTab project={project} />}
      {tab === "finance" && <FinanceTab project={project} />}
      {toast}
    </div>
  );
}

/* ---------------------------------------------------------------- Overview */

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-primary">{value ?? "—"}</div>
    </div>
  );
}

function OverviewTab({
  project, reload, showToast,
}: {
  project: ProjectDetail;
  reload: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const canEdit = useHasRole("Sales_Head", "Finance");
  const canPo = useHasRole("Finance");
  const [showEdit, setShowEdit] = useState(false);
  const [showPo, setShowPo] = useState(false);
  const [createdPo, setCreatedPo] = useState<{ id: number; po_number: string } | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <button className={btnSecondary} onClick={() => setShowEdit(true)}>
            <Pencil size={15} /> Edit project
          </button>
        )}
        {canPo && (
          <button className={btnPrimary} onClick={() => setShowPo(true)}>
            <Receipt size={15} /> Create PO
          </button>
        )}
      </div>
      {createdPo && (
        <div className="rounded-card border border-success/30 bg-success-soft px-4 py-3 text-sm text-success">
          Purchase order <span className="font-bold">{createdPo.po_number}</span> created.{" "}
          <CrmLink to={`pos/${createdPo.id}`} className="font-semibold underline">View PO</CrmLink>
        </div>
      )}
      <div className="glass fx-gradient-border grid grid-cols-2 gap-4 rounded-card p-5 md:grid-cols-3">
        <Info label="Customer" value={project.customer_name || `#${project.customer_id}`} />
        <Info label="Opportunity" value={project.opportunity_title || `#${project.opportunity_id}`} />
        <Info label="Status" value={<StatusBadge status={project.status} />} />
        <Info label="Billing cycle" value={`Day ${project.billing_cycle_start_day} – ${project.billing_cycle_end_day}`} />
        <Info label="Billing frequency" value={pretty(project.billing_frequency)} />
        <Info label="Max billable hrs/day" value={project.max_billable_hours_day ?? "—"} />
        <Info label="Max billable hrs/month" value={project.max_billable_hours_month ?? "—"} />
        <Info label="Max billable days/month" value={project.max_billable_days_month ?? "—"} />
        <Info label="Created" value={fmtDate(project.created_at)} />
      </div>
      {showEdit && (
        <EditProjectModal
          project={project}
          onClose={() => setShowEdit(false)}
          onDone={() => { setShowEdit(false); showToast("Project updated"); reload(); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
      {showPo && (
        <CreatePoModal
          projectId={project.id}
          onClose={() => setShowPo(false)}
          onDone={(po) => {
            setShowPo(false);
            setCreatedPo({ id: po.id, po_number: po.po_number });
            showToast(`PO ${po.po_number} created`);
          }}
          onError={(m) => showToast(m, "err")}
        />
      )}
    </div>
  );
}

function EditProjectModal({
  project, onClose, onDone, onError,
}: {
  project: ProjectDetail;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(project.name);
  const [startDay, setStartDay] = useState(String(project.billing_cycle_start_day));
  const [endDay, setEndDay] = useState(String(project.billing_cycle_end_day));
  const [frequency, setFrequency] = useState(project.billing_frequency);
  const [maxHrsDay, setMaxHrsDay] = useState(project.max_billable_hours_day != null ? String(project.max_billable_hours_day) : "");
  const [maxHrsMonth, setMaxHrsMonth] = useState(project.max_billable_hours_month != null ? String(project.max_billable_hours_month) : "");
  const [maxDaysMonth, setMaxDaysMonth] = useState(project.max_billable_days_month != null ? String(project.max_billable_days_month) : "");
  const [status, setStatus] = useState(project.status);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Name is required";
    const sd = Number(startDay), ed = Number(endDay);
    if (!(sd >= 1 && sd <= 31)) errs.startDay = "Must be 1–31";
    if (!(ed >= 1 && ed <= 31)) errs.endDay = "Must be 1–31";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await crmPut(`/api/projects/${project.id}`, {
        name: name.trim(),
        billing_cycle_start_day: sd,
        billing_cycle_end_day: ed,
        billing_frequency: frequency,
        max_billable_hours_day: numOrUndef(maxHrsDay) ?? null,
        max_billable_hours_month: numOrUndef(maxHrsMonth) ?? null,
        max_billable_days_month: numOrUndef(maxDaysMonth) ?? null,
        status,
      });
      onDone();
    } catch (e: any) {
      onError(e?.message || "Failed to update project");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Edit Project" onClose={onClose} fullScreen>
      <div className="space-y-3">
        <Field label="Name" required error={errors.name}>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Billing cycle start day" error={errors.startDay}>
            <input type="number" min={1} max={31} className={inputCls} value={startDay} onChange={(e) => setStartDay(e.target.value)} />
          </Field>
          <Field label="Billing cycle end day" error={errors.endDay}>
            <input type="number" min={1} max={31} className={inputCls} value={endDay} onChange={(e) => setEndDay(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Billing frequency">
            <select className={inputCls} value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              {BILLING_FREQUENCIES.map((f) => <option key={f} value={f}>{pretty(f)}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Max billable hrs/day">
            <input type="number" min={0} max={24} className={inputCls} value={maxHrsDay} onChange={(e) => setMaxHrsDay(e.target.value)} />
          </Field>
          <Field label="Max billable hrs/month">
            <input type="number" min={0} className={inputCls} value={maxHrsMonth} onChange={(e) => setMaxHrsMonth(e.target.value)} />
          </Field>
          <Field label="Max billable days/month">
            <input type="number" min={0} max={31} className={inputCls} value={maxDaysMonth} onChange={(e) => setMaxDaysMonth(e.target.value)} />
          </Field>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={btnPrimary} onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
      </div>
    </Modal>
  );
}

function CreatePoModal({
  projectId, onClose, onDone, onError,
}: {
  projectId: number;
  onClose: () => void;
  onDone: (po: any) => void;
  onError: (msg: string) => void;
}) {
  const [totalValue, setTotalValue] = useState("");
  const [taxSlab, setTaxSlab] = useState("");
  const [interState, setInterState] = useState(false);
  const [poType, setPoType] = useState("Standard");
  const [receivedDate, setReceivedDate] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const v = Number(totalValue);
    if (!totalValue.trim() || !(v > 0)) {
      setError("Total value must be greater than 0");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const res = await crmPost(`/api/projects/${projectId}/create-po`, {
        total_value: v,
        tax_slab: numOrUndef(taxSlab),
        inter_state: interState,
        po_type: poType,
        received_date: receivedDate || undefined,
      });
      onDone(res.data);
    } catch (e: any) {
      onError(e?.message || "Failed to create PO");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Create Purchase Order" onClose={onClose} fullScreen>
      <div className="space-y-3">
        <Field label="Total value" required error={error}>
          <input type="number" min={0} className={inputCls} value={totalValue} onChange={(e) => setTotalValue(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tax slab (%)">
            <input type="number" min={0} max={100} className={inputCls} value={taxSlab} onChange={(e) => setTaxSlab(e.target.value)} />
          </Field>
          <Field label="PO type">
            <select className={inputCls} value={poType} onChange={(e) => setPoType(e.target.value)}>
              <option value="Standard">Standard</option>
              <option value="Blanket">Blanket</option>
            </select>
          </Field>
        </div>
        <Field label="Received date">
          <input type="date" className={inputCls} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm font-semibold text-primary">
          <input type="checkbox" checked={interState} onChange={(e) => setInterState(e.target.checked)} />
          Inter-state (IGST instead of CGST/SGST)
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={btnPrimary} onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create PO"}</button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Team */

function TeamTab({
  project, reload, showToast,
}: {
  project: ProjectDetail;
  reload: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const canManage = useHasRole("Sales_Head", "HR");
  const [showAssign, setShowAssign] = useState(false);
  const [editRow, setEditRow] = useState<TeamMember | null>(null);

  const columns: Column<TeamMember>[] = [
    { key: "employee_name", label: "Employee", render: (r) => <span className="font-semibold">{r.employee_name || `#${r.employee_id}`}</span> },
    { key: "onboarding_date", label: "Onboarding", render: (r) => fmtDate(r.onboarding_date) },
    { key: "work_mode", label: "Work mode", render: (r) => pretty(r.work_mode) },
    {
      key: "billing_rate", label: "Billing rate",
      render: (r) => (r.billing_rate != null ? `${r.billing_rate} / ${pretty(r.billing_unit)}` : "—"),
    },
    { key: "is_active", label: "Active", render: (r) => <StatusBadge status={r.is_active ? "Active" : "Inactive"} /> },
    ...(canManage
      ? [{
          key: "actions", label: "",
          render: (r: TeamMember) => (
            <button className={btnSecondary} onClick={() => setEditRow(r)}>
              <Pencil size={13} /> Edit
            </button>
          ),
        } as Column<TeamMember>]
      : []),
  ];

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <button className={btnPrimary} onClick={() => setShowAssign(true)}>
            <UserPlus size={15} /> Assign employee
          </button>
        </div>
      )}
      <DataTable<TeamMember> columns={columns} rows={project.team || []} emptyMessage="No employees assigned" />
      {showAssign && (
        <AssignEmployeeModal
          projectId={project.id}
          onClose={() => setShowAssign(false)}
          onDone={() => { setShowAssign(false); showToast("Employee assigned to project"); reload(); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
      {editRow && (
        <EditTeamModal
          projectId={project.id}
          row={editRow}
          onClose={() => setEditRow(null)}
          onDone={() => { setEditRow(null); showToast("Project employee updated"); reload(); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
    </div>
  );
}

function AssignEmployeeModal({
  projectId, onClose, onDone, onError,
}: {
  projectId: number;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [employees, setEmployees] = useState<any[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [onboardingDate, setOnboardingDate] = useState("");
  const [experienceYears, setExperienceYears] = useState("");
  const [workMode, setWorkMode] = useState("");
  const [billingRate, setBillingRate] = useState("");
  const [billingUnit, setBillingUnit] = useState("Monthly");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    crmGet<any[]>("/api/employees?limit=100").then((r) => setEmployees(r.data || [])).catch(() => {});
  }, []);

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!employeeId) errs.employee = "Employee is required";
    if (billingRate.trim() === "" || Number(billingRate) < 0) errs.rate = "Billing rate is required";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await crmPost(`/api/projects/${projectId}/employees`, {
        employee_id: Number(employeeId),
        onboarding_date: onboardingDate || undefined,
        experience_years: numOrUndef(experienceYears),
        work_mode: workMode || undefined,
        billing_rate: Number(billingRate),
        billing_unit: billingUnit,
      });
      onDone();
    } catch (e: any) {
      onError(e?.message || "Failed to assign employee");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Assign Employee" onClose={onClose} fullScreen>
      <div className="space-y-3">
        <Field label="Employee" required error={errors.employee}>
          <select className={inputCls} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Select employee…</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.full_name || `${e.first_name || ""} ${e.last_name || ""}`.trim() || `#${e.id}`}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Onboarding date">
            <input type="date" className={inputCls} value={onboardingDate} onChange={(e) => setOnboardingDate(e.target.value)} />
          </Field>
          <Field label="Experience (years)">
            <input type="number" min={0} max={99} className={inputCls} value={experienceYears} onChange={(e) => setExperienceYears(e.target.value)} />
          </Field>
        </div>
        <Field label="Work mode">
          <select className={inputCls} value={workMode} onChange={(e) => setWorkMode(e.target.value)}>
            <option value="">Not set</option>
            {WORK_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Billing rate" required error={errors.rate}>
            <input type="number" min={0} className={inputCls} value={billingRate} onChange={(e) => setBillingRate(e.target.value)} />
          </Field>
          <Field label="Billing unit">
            <select className={inputCls} value={billingUnit} onChange={(e) => setBillingUnit(e.target.value)}>
              {BILLING_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={btnPrimary} onClick={submit} disabled={busy}>{busy ? "Assigning…" : "Assign"}</button>
      </div>
    </Modal>
  );
}

function EditTeamModal({
  projectId, row, onClose, onDone, onError,
}: {
  projectId: number;
  row: TeamMember;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [billingRate, setBillingRate] = useState(row.billing_rate != null ? String(row.billing_rate) : "");
  const [billingUnit, setBillingUnit] = useState(row.billing_unit || "Monthly");
  const [workMode, setWorkMode] = useState(row.work_mode || "");
  const [isActive, setIsActive] = useState(row.is_active);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (billingRate.trim() === "" || Number(billingRate) < 0) {
      setError("Billing rate is required");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await crmPut(`/api/projects/${projectId}/employees/${row.id}`, {
        billing_rate: Number(billingRate),
        billing_unit: billingUnit,
        work_mode: workMode || null,
        is_active: isActive,
      });
      onDone();
    } catch (e: any) {
      onError(e?.message || "Failed to update project employee");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Edit — ${row.employee_name || `Employee #${row.employee_id}`}`} onClose={onClose} fullScreen>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Billing rate" required error={error}>
            <input type="number" min={0} className={inputCls} value={billingRate} onChange={(e) => setBillingRate(e.target.value)} />
          </Field>
          <Field label="Billing unit">
            <select className={inputCls} value={billingUnit} onChange={(e) => setBillingUnit(e.target.value)}>
              {BILLING_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Work mode">
          <select className={inputCls} value={workMode} onChange={(e) => setWorkMode(e.target.value)}>
            <option value="">Not set</option>
            {WORK_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm font-semibold text-primary">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active on project
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={btnPrimary} onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Communication matrix */

function CommMatrixTab({
  project, reload, showToast,
}: {
  project: ProjectDetail;
  reload: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const canManage = useHasRole("Sales_Head", "HR");
  const [showAdd, setShowAdd] = useState(false);
  const [deleteRow, setDeleteRow] = useState<CommEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const doDelete = async () => {
    if (!deleteRow) return;
    setBusy(true);
    try {
      await crmDelete(`/api/projects/${project.id}/communication-matrix/${deleteRow.id}`);
      showToast("Communication matrix entry deleted");
      setDeleteRow(null);
      reload();
    } catch (e: any) {
      showToast(e?.message || "Failed to delete entry", "err");
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<CommEntry>[] = [
    { key: "name", label: "Name", render: (r) => <span className="font-semibold">{r.name}</span> },
    { key: "role", label: "Role" },
    { key: "responsible_person", label: "Responsible" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "type", label: "Type", render: (r) => <StatusBadge status={r.type} /> },
    ...(canManage
      ? [{
          key: "actions", label: "",
          render: (r: CommEntry) => (
            <button
              className="rounded-control p-1.5 text-danger hover:bg-danger-soft"
              onClick={() => setDeleteRow(r)}
              aria-label="Delete entry"
            >
              <Trash2 size={15} />
            </button>
          ),
        } as Column<CommEntry>]
      : []),
  ];

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <button className={btnPrimary} onClick={() => setShowAdd(true)}>
            <Plus size={15} /> Add entry
          </button>
        </div>
      )}
      <DataTable<CommEntry> columns={columns} rows={project.communication_matrix || []} emptyMessage="No communication matrix entries" />
      {showAdd && (
        <AddCommEntryModal
          projectId={project.id}
          onClose={() => setShowAdd(false)}
          onDone={() => { setShowAdd(false); showToast("Communication matrix entry added"); reload(); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
      {deleteRow && (
        <ConfirmModal
          title="Delete entry"
          message={<>Delete communication matrix entry <b>{deleteRow.name}</b>? This cannot be undone.</>}
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={doDelete}
          onClose={() => setDeleteRow(null)}
        />
      )}
    </div>
  );
}

function AddCommEntryModal({
  projectId, onClose, onDone, onError,
}: {
  projectId: number;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [responsible, setResponsible] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [type, setType] = useState("Customer");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await crmPost(`/api/projects/${projectId}/communication-matrix`, {
        name: name.trim(),
        role: role.trim() || undefined,
        responsible_person: responsible.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        type,
      });
      onDone();
    } catch (e: any) {
      onError(e?.message || "Failed to add entry");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add Communication Matrix Entry" onClose={onClose} fullScreen>
      <div className="space-y-3">
        <Field label="Name" required error={error}>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Role">
            <input className={inputCls} value={role} onChange={(e) => setRole(e.target.value)} />
          </Field>
          <Field label="Responsible person">
            <input className={inputCls} value={responsible} onChange={(e) => setResponsible(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Email">
            <input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Phone">
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <Field label="Type">
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
            {COMM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={btnPrimary} onClick={submit} disabled={busy}>{busy ? "Adding…" : "Add entry"}</button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Timesheets tab */

function ProjectTimesheetsTab({ project }: { project: ProjectDetail }) {
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [page, setPage] = useState(1);
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const employeeName = useMemo(() => {
    const m = new Map<number, string>();
    (project.team || []).forEach((t) => t.employee_name && m.set(t.employee_id, t.employee_name));
    return (id: number) => m.get(id) || `#${id}`;
  }, [project.team]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<any[]>(
        `/api/projects/${project.id}/timesheets${qs({ month, year, status, page, limit: 20 })}`,
      );
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load timesheets");
    } finally {
      setLoading(false);
    }
  }, [project.id, month, year, status, page]);
  useEffect(() => { load(); }, [load]);

  const columns: Column<any>[] = [
    { key: "employee", label: "Employee", render: (r) => employeeName(r.employee_id) },
    { key: "period", label: "Period", render: (r) => `${MONTHS[(r.month || 1) - 1]} ${r.year}` },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "submitted_at", label: "Submitted", render: (r) => fmtDate(r.submitted_at) },
    { key: "approved_at", label: "Approved", render: (r) => fmtDate(r.approved_at) },
  ];

  if (error) return <ErrorBox error={error} onRetry={load} />;
  return (
    <DataTable<any>
      columns={columns}
      rows={rows}
      meta={meta}
      loading={loading}
      onPage={setPage}
      onRowClick={(r) => crmNavigate(`timesheets/${r.id}`)}
      emptyMessage="No timesheets for this project"
      filters={
        <>
          <select className={`${inputCls} !w-36`} value={month} onChange={(e) => { setMonth(e.target.value); setPage(1); }}>
            <option value="">All months</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <input
            type="number" placeholder="Year" className={`${inputCls} !w-28`}
            value={year} onChange={(e) => { setYear(e.target.value); setPage(1); }}
          />
          <select className={`${inputCls} !w-36`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {TS_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </>
      }
    />
  );
}

/* ---------------------------------------------------------------- POs & Invoices tab */

function FinanceTab({ project }: { project: ProjectDetail }) {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      crmGet<any[]>(`/api/invoices${qs({ project_id: project.id, limit: 50 })}`),
      crmGet<any[]>(`/api/purchase-orders${qs({ customer_id: project.customer_id, limit: 50 })}`).catch(() => ({ data: [] as any[] })),
    ])
      .then(([inv, po]) => {
        if (cancelled) return;
        setInvoices(inv.data || []);
        setPos((po as any).data || []);
      })
      .catch((e: any) => !cancelled && setError(e?.message || "Failed to load finance data"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [project.id, project.customer_id]);

  if (error) return <ErrorBox error={error} />;
  if (loading) return <Spinner label="Loading POs & invoices…" />;

  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 text-sm font-bold text-primary">
          Purchase orders <span className="font-normal text-muted">(for this customer)</span>
        </h2>
        {pos.length === 0 ? (
          <EmptyState message="No purchase orders for this customer" />
        ) : (
          <DataTable<any>
            columns={[
              {
                key: "po_number", label: "PO number",
                render: (r) => (
                  <CrmLink to={`pos/${r.id}`} className="font-semibold text-brand-600 hover:underline dark:text-brand-300">
                    {r.po_number}
                  </CrmLink>
                ),
              },
              { key: "po_type", label: "Type", render: (r) => pretty(r.po_type) },
              { key: "received_date", label: "Received", render: (r) => fmtDate(r.received_date) },
              { key: "total_value", label: "Total", render: (r) => r.total_value ?? "—" },
              { key: "balance_value", label: "Balance", render: (r) => r.balance_value ?? "—" },
              { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
            ]}
            rows={pos}
          />
        )}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-bold text-primary">Invoices</h2>
        {invoices.length === 0 ? (
          <EmptyState message="No invoices for this project" />
        ) : (
          <DataTable<any>
            columns={[
              {
                key: "invoice_number", label: "Invoice",
                render: (r) => (
                  <CrmLink to={`invoices/${r.id}`} className="font-semibold text-brand-600 hover:underline dark:text-brand-300">
                    {r.invoice_number}
                  </CrmLink>
                ),
              },
              { key: "invoice_date", label: "Date", render: (r) => fmtDate(r.invoice_date) },
              { key: "due_date", label: "Due", render: (r) => fmtDate(r.due_date) },
              { key: "grand_total", label: "Grand total", render: (r) => r.grand_total ?? "—" },
              { key: "balance_amount", label: "Balance", render: (r) => r.balance_amount ?? "—" },
              { key: "payment_status", label: "Payment", render: (r) => <StatusBadge status={r.payment_status} /> },
            ]}
            rows={invoices}
          />
        )}
      </section>
    </div>
  );
}
