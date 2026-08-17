/** Projects — list (status tabs) + detail (Overview, Team, Timesheet,
 * PO & Invoices, Communication Matrix) incl. one-click "Create PO". */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Receipt, Trash2, UserPlus } from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanAct } from "../useAccess";
import { CrmLink, crmNavigate, useCrmParams } from "../routerHooks";
import { CrmBreadcrumb } from "../components/CrmBreadcrumb";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { RowActions, afterListDelete } from "../components/RowActions";
import {
  ConfirmModal, EmptyState, ErrorBox, Field, Modal, Spinner, StatusBadge, Tabs,
  btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";
import { TeachingEmpty } from "../components/TeachingEmpty";
import { CreateProjectWizard, EditProjectWizard } from "../components/EditProjectWizard";
import { SectionHeaderBanner, WizardField } from "../components/wizard";
import { LOCATIONS, RateHistory } from "./ProjectEmployees";

/* ------------------------------------------------------------ types & consts */

type Project = {
  id: number;
  opportunity_id: number;
  customer_id: number;
  name: string;
  billing_cycle_start_day: number;
  billing_cycle_end_day: number;
  billing_frequency: string;
  recurring_billing?: boolean | null;
  max_billable_hours_day: number | null;
  max_billable_hours_month: number | null;
  max_billable_days_month: number | null;
  no_billing_period_days: number | null;
  holidays_billable?: boolean | null;
  weekoff_billable?: boolean | null;
  hours_required_half_day?: number | null;
  hours_required_full_day?: number | null;
  hours_required_half_day_comp_off?: number | null;
  hours_required_full_day_comp_off?: number | null;
  is_max_billable_hours_per_day?: boolean | null;
  is_max_billable_hours_per_month?: boolean | null;
  is_max_billable_days_per_month?: boolean | null;
  is_initial_no_billing_period?: boolean | null;
  initial_no_billing_qty?: number | null;
  initial_no_billing_period?: string | null;
  status: string;
  created_at: string | null;
};

type TeamMember = {
  id: number;
  pe_id?: number;
  employee_id: number;
  employee_name: string | null;
  employee_email: string | null;
  onboarding_date: string | null;
  experience_years: number | null;
  work_mode: string | null;
  billing_rate: number | null;
  billing_unit: string;
  rates?: import("./ProjectEmployees").RateRowOut[];
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
  branch_id?: number | null;
  branch_name?: string | null;
  team: TeamMember[];
  communication_matrix: CommEntry[];
};

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

/* ============================================================ PROJECT HUB

   The sidebar's Timesheets entry became THIS hub (Aug 2026): everything
   project-related — the projects themselves, their employees, timesheets,
   purchase orders and invoices — lives behind one entry. Embeds are lazy so
   the chunks stay split and no import cycles form. */
const LazyProjectEmployees = React.lazy(() =>
  import("./ProjectEmployees").then((m) => ({ default: m.ProjectEmployeesPage })));
const LazyTimesheets = React.lazy(() =>
  import("./Timesheets").then((m) => ({ default: m.TimesheetsListPage })));
const LazyPurchaseOrders = React.lazy(() =>
  import("./Finance").then((m) => ({ default: m.PurchaseOrdersPage })));
const LazyInvoices = React.lazy(() =>
  import("./Finance").then((m) => ({ default: m.InvoicesPage })));

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
  const [hubTab, setHubTab] = useState("projects");
  /* Hub-tab visibility mirrors each embedded page's own rules. */
  const peRole = useHasRole("Sales", "Sales_Head", "HR", "Finance");
  const canPE = useCanAct("project-employees", "view", peRole);
  const tsRole = useHasRole("HR", "Finance", "RMG", "Sales", "Sales_Head", "TA");
  const canTs = useCanAct("timesheets", "view", tsRole);
  const finRole = useHasRole("Finance", "Sales", "Sales_Head");
  const canPos = useCanAct("pos", "view", finRole);
  const canInv = useCanAct("invoices", "view", finRole);
  // Deep-link create (hub "New …" buttons): ?create=1 opens the dialog once,
  // then strips the flag so refresh / back never reopen it.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("create") === "1") {
      setShowNew(true);
      sp.delete("create");
      window.history.replaceState(null, "", `${window.location.pathname}?${sp.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canCreate = useCanAct("projects", "create", useHasRole("Sales_Head", "Finance"));
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
    // Null-safe: projects created without a sales opportunity show a dash.
    { key: "opportunity", label: "Opportunity",
      render: (r) => (r.opportunity_id ? oppTitle(r.opportunity_id) : "—") },
    { key: "billing_frequency", label: "Billing frequency", render: (r) => pretty(r.billing_frequency) },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-display text-xl font-bold text-primary">Projects</h1>
        {hubTab === "projects" && canCreate && (
          <button className={btnPrimary} onClick={() => setShowNew(true)}>
            <Plus size={15} /> New Project
          </button>
        )}
      </div>
      <Tabs
        tabs={[
          { key: "projects", label: "Projects" },
          ...(canPE ? [{ key: "employees", label: "Project Employees" }] : []),
          ...(canTs ? [{ key: "timesheets", label: "Timesheets" }] : []),
          ...(canPos ? [{ key: "pos", label: "Purchase Orders" }] : []),
          ...(canInv ? [{ key: "invoices", label: "Invoices" }] : []),
        ]}
        active={hubTab}
        onChange={setHubTab}
      />
      {hubTab !== "projects" ? (
        <React.Suspense fallback={<Spinner label="Loading…" />}>
          {hubTab === "employees" && canPE && <LazyProjectEmployees />}
          {hubTab === "timesheets" && canTs && <LazyTimesheets />}
          {hubTab === "pos" && canPos && <LazyPurchaseOrders />}
          {hubTab === "invoices" && canInv && <LazyInvoices />}
        </React.Suspense>
      ) : (
      <>
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
          emptyMessage={<TeachingEmpty page="projects" />}
          rowActions={canCreate ? (r) => (
            <RowActions
              entity="project"
              itemLabel={r.name}
              onView={() => crmNavigate(`projects/${r.id}`)}
              onEdit={() => crmNavigate(`projects/${r.id}`)}
              deleteUrl={`/api/projects/${r.id}`}
              onDeleted={() => afterListDelete(r.id, setRows, load)}
              notify={showToast}
              canEdit
              canDelete
            />
          ) : undefined}
        />
      )}
      {showNew && (
        <CreateProjectWizard
          customers={customers}
          onClose={() => setShowNew(false)}
          onSaved={(p) => { setShowNew(false); crmNavigate(`projects/${p.id}`); }}
          notify={showToast}
        />
      )}
      </>
      )}
      {toast}
    </div>
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

  const crumbs = [
    { label: "Customers", to: "customers" },
    ...(project.customer_id
      ? [{ label: project.customer_name || `Customer #${project.customer_id}`, to: `customers/${project.customer_id}` }]
      : []),
    ...(project.branch_id
      ? [{ label: project.branch_name || `Branch #${project.branch_id}`, to: `branch-policy/${project.branch_id}` }]
      : []),
    { label: project.name },
  ];

  return (
    <div className="space-y-4">
      <CrmBreadcrumb items={crumbs} />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-display text-xl font-bold text-primary">{project.name}</h1>
        <StatusBadge status={project.status} />
      </div>
      <Tabs
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "team", label: "Team", count: project.team?.length },
          { key: "timesheets", label: "Timesheet" },
          { key: "finance", label: "PO & Invoices" },
          { key: "comm", label: "Communication Matrix", count: project.communication_matrix?.length },
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
  const canEdit = useCanAct("projects", "edit", useHasRole("Sales_Head", "Finance"));
  const canPo = useCanAct("pos", "create", useHasRole("Finance"));
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
      <div className="glass fx-gradient-border grid grid-cols-1 gap-4 rounded-card p-5 sm:grid-cols-2 xl:grid-cols-3">
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
        <EditProjectWizard
          initial={project}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); reload(); }}
          notify={showToast}
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

/** Standard GST slabs — mirrors the Purchase Orders tab's full form. */
const PO_TAX_SLABS = [0, 5, 12, 18, 25, 30] as const;

function CreatePoModal({
  projectId, onClose, onDone, onError,
}: {
  projectId: number;
  onClose: () => void;
  onDone: (po: any) => void;
  onError: (msg: string) => void;
}) {
  /* Same fields as the Purchase Orders tab's form MINUS customer / branch /
     contact — those derive from the project (that's the point of creating the
     PO from here). PO number is auto-sequenced server-side. */
  const [totalValue, setTotalValue] = useState("");
  const [taxSlab, setTaxSlab] = useState("");
  const [interState, setInterState] = useState(false);
  const [poType, setPoType] = useState("Regular PO");
  const [receivedDate, setReceivedDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const v = Number(totalValue);
  const slabN = taxSlab === "" ? null : Number(taxSlab);
  const gstAmt = slabN != null && v > 0 ? Math.round(v * slabN) / 100 : 0;
  const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  const submit = async () => {
    if (!totalValue.trim() || !(v > 0)) {
      setError("PO value must be greater than 0");
      return;
    }
    if (startDate && endDate && endDate < startDate) {
      setError("PO End Date cannot be before PO Start Date");
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
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        payment_terms: paymentTerms.trim() || undefined,
      });
      onDone(res.data);
    } catch (e: any) {
      onError(e?.message || "Failed to create PO");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={<span className="sr-only">Create Purchase Order</span>}
      onClose={onClose}
      wide
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      {/* Same shell as the Map Employee wizard, so the two popups feel like
          one product rather than two eras of it. */}
      <div className="crm-wizard wiz-noise min-h-full w-full bg-[color:var(--wiz-bg)] px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto w-full max-w-2xl">
          <SectionHeaderBanner
            title="Create Purchase Order"
            description="Customer, branch, contact and PO number come from this project — the full value is allocated here."
            icon={<Receipt size={20} aria-hidden />}
          />
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            <WizardField label="PO value" required error={error} icon="hash" filled={v > 0}>
              <input type="number" min={0} step="0.01" className={inputCls} value={totalValue}
                onChange={(e) => setTotalValue(e.target.value)} placeholder="0.00" />
            </WizardField>
            <WizardField label="PO type" icon="hash">
              <select className={inputCls} value={poType} onChange={(e) => setPoType(e.target.value)}>
                <option value="Regular PO">Regular PO</option>
                <option value="Open PO">Open PO</option>
              </select>
            </WizardField>
            <WizardField label="Tax slab (%)" icon="hash" filled={taxSlab !== ""}>
              <select className={inputCls} value={taxSlab} onChange={(e) => setTaxSlab(e.target.value)}>
                <option value="">No GST</option>
                {PO_TAX_SLABS.map((s) => <option key={s} value={s}>{s}%</option>)}
              </select>
            </WizardField>
            <WizardField label="Received date" icon="calendar" filled={!!receivedDate}>
              <input type="date" className={inputCls} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
            </WizardField>
            <WizardField label="PO start date" icon="calendar" filled={!!startDate}>
              <input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </WizardField>
            <WizardField label="PO end date" icon="calendar" filled={!!endDate}>
              <input type="date" className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </WizardField>
            <div className="sm:col-span-2">
              <WizardField label="Payment terms" icon="hash" filled={!!paymentTerms.trim()}>
                <input className={inputCls} value={paymentTerms} placeholder="e.g. Net 30 Days"
                  onChange={(e) => setPaymentTerms(e.target.value)} />
              </WizardField>
            </div>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-primary">
            <input type="checkbox" checked={interState} onChange={(e) => setInterState(e.target.checked)} />
            Inter-state (IGST instead of CGST/SGST)
          </label>
          {v > 0 && slabN != null && (
            <div className="mt-4 rounded-card border border-[color:var(--wiz-border)] bg-surface-1/70 px-4 py-3 text-sm backdrop-blur-sm">
              <div className="flex justify-between"><span className="text-muted">PO value</span><span className="font-semibold text-primary">{fmt(v)}</span></div>
              <div className="flex justify-between">
                <span className="text-muted">{interState ? `IGST ${slabN}%` : `CGST ${slabN / 2}% + SGST ${slabN / 2}%`}</span>
                <span className="font-semibold text-primary">{fmt(gstAmt)}</span>
              </div>
              <div className="mt-1 flex justify-between border-t border-subtle pt-1">
                <span className="font-bold text-primary">Total incl. GST</span>
                <span className="font-bold text-primary">{fmt(v + gstAmt)}</span>
              </div>
            </div>
          )}
          <div className="mt-6 flex items-center gap-3 border-t border-[color:var(--wiz-border)] pt-5">
            <button className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
            <button className={`${btnPrimary} btn-gradient ml-auto h-10 rounded-xl px-4`} onClick={submit} disabled={busy}>
              {busy ? "Creating…" : "Create PO"}
            </button>
          </div>
        </div>
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
  const canManage = useCanAct("project-employees", "edit", useHasRole("Sales_Head", "HR"));
  const [showAssign, setShowAssign] = useState(false);
  const [editRow, setEditRow] = useState<TeamMember | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const rows = project.team || [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [
        r.employee_name,
        r.employee_email,
        r.employee_id,
        r.work_mode,
        r.billing_rate,
        r.billing_unit,
        r.onboarding_date,
        r.is_active ? "active" : "inactive",
      ].some((v) => String(v ?? "").toLowerCase().includes(q)),
    );
  }, [project.team, search]);

  const columns: Column<TeamMember>[] = [
    {
      key: "employee_name",
      label: "Employee",
      render: (r) => (
        <span className="font-semibold text-brand-600 dark:text-brand-300">
          {r.employee_name || `#${r.employee_id}`}
        </span>
      ),
    },
    { key: "onboarding_date", label: "Onboarding", render: (r) => fmtDate(r.onboarding_date) },
    { key: "work_mode", label: "Work mode", render: (r) => pretty(r.work_mode) },
    {
      key: "billing_rate", label: "Billing rate",
      /* The whole Commercial Details history, not just today's number — each
         rate with its derived validity and a Current badge. */
      render: (r) => (r.rates?.length
        ? <RateHistory rates={r.rates} unit={r.billing_unit} compact />
        : (r.billing_rate != null ? `${r.billing_rate} / ${pretty(r.billing_unit)}` : "—")),
    },
    { key: "is_active", label: "Active", render: (r) => <StatusBadge status={r.is_active ? "Active" : "Inactive"} /> },
    ...(canManage
      ? [{
          key: "actions", label: "",
          render: (r: TeamMember) => (
            <button
              className={btnSecondary}
              onClick={(e) => { e.stopPropagation(); setEditRow(r); }}
            >
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
      <DataTable<TeamMember>
        columns={columns}
        rows={filtered}
        search={search}
        onSearch={setSearch}
        emptyMessage={search.trim() ? "No employees match your search" : "No employees assigned"}
        searchPlaceholder="Search team…"
        onRowClick={(r) => crmNavigate(`project-employees/${r.pe_id ?? r.id}`)}
      />
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
  /* No bare "Billing rate" box anymore. That field PUT a rate with no date,
     and the backend minted a new rate row on every save — which is exactly
     how team members ended up with three rates all starting the same day.
     Rates here now work like the Map Employee wizard's Commercial Details:
     a new rate needs its own Effective From date, and the previous rate's
     end is derived automatically. */
  const [workMode, setWorkMode] = useState(row.work_mode || "");
  const [isActive, setIsActive] = useState(row.is_active);
  const [newRateDate, setNewRateDate] = useState("");
  const [newRateValue, setNewRateValue] = useState("");
  const [rateError, setRateError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ratesDirty, setRatesDirty] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await crmPut(`/api/projects/${projectId}/employees/${row.id}`, {
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

  const addRate = async () => {
    if (!newRateDate || !(Number(newRateValue) > 0)) {
      setRateError("Enter the billing start date and a rate above zero");
      return;
    }
    if ((row.rates || []).some((r) => r.effective_from?.slice(0, 10) === newRateDate)) {
      setRateError("A rate already starts on that date — pick a different Effective From, or edit the existing row on the mapping page");
      return;
    }
    setRateError("");
    setBusy(true);
    const today = new Date().toISOString().slice(0, 10);
    try {
      const res = await crmPost(`/api/projects/employees/${row.id}/rates`, {
        effective_from: newRateDate,
        rate: Number(newRateValue),
        is_current_rate: newRateDate <= today,
      });
      // Show the new row immediately without waiting for the parent reload.
      row.rates = [...(row.rates || []), (res as any).data].sort(
        (a: any, b: any) => String(a.effective_from).localeCompare(String(b.effective_from)));
      setNewRateDate("");
      setNewRateValue("");
      setRatesDirty(true);
    } catch (e: any) {
      onError(e?.message || "Failed to add rate");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Edit — ${row.employee_name || `Employee #${row.employee_id}`}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Location">
            <select className={inputCls} value={workMode} onChange={(e) => setWorkMode(e.target.value)}>
              <option value="">Not set</option>
              {LOCATIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </Field>
          <Field label="Active on project">
            <select className={inputCls} value={isActive ? "1" : "0"} onChange={(e) => setIsActive(e.target.value === "1")}>
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
          </Field>
        </div>

        <div className="rounded-card border border-subtle bg-surface-2/50 p-3">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
            Commercial Details — rate history
          </div>
          <RateHistory rates={row.rates} unit={row.billing_unit} />
          <div className="mt-3 border-t border-subtle pt-3">
            <div className="mb-1 text-xs font-semibold text-secondary">Add new rate</div>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Billing start date" required>
                <input type="date" className={inputCls} value={newRateDate}
                  onChange={(e) => { setNewRateDate(e.target.value); setRateError(""); }} />
              </Field>
              <Field label={`Rate (${pretty(row.billing_unit) || "per unit"})`} required>
                <input type="number" min={0} step="0.01" className={inputCls} value={newRateValue}
                  placeholder="0.00" onChange={(e) => { setNewRateValue(e.target.value); setRateError(""); }} />
              </Field>
              <button type="button" className={`${btnSecondary} !py-1.5`} disabled={busy} onClick={addRate}>
                <Plus size={14} /> Add rate
              </button>
            </div>
            {rateError && <div className="mt-2 text-xs font-semibold text-danger" role="alert">{rateError}</div>}
            <p className="mt-2 text-[11px] text-muted">
              The previous rate ends automatically the day before this one starts. To correct or
              delete an existing rate, open the mapping and use Commercial Details → Edit rates.
            </p>
          </div>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnSecondary} onClick={busy ? undefined : () => { if (ratesDirty) onDone(); onClose(); }} disabled={busy}>
          {ratesDirty ? "Close" : "Cancel"}
        </button>
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
  const canManage = useCanAct("project-employees", "edit", useHasRole("Sales_Head", "HR"));
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
  const [employeeId, setEmployeeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

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
        `/api/projects/${project.id}/timesheets${qs({ month, year, status, employee_id: employeeId, include_missing: 1, page, limit: 20 })}`,
      );
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load timesheets");
    } finally {
      setLoading(false);
    }
  }, [project.id, month, year, status, employeeId, page]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [
        employeeName(r.employee_id),
        MONTHS[(r.month || 1) - 1],
        r.year,
        r.status,
      ].some((v) => String(v ?? "").toLowerCase().includes(q)),
    );
  }, [rows, search, employeeName]);

  const columns: Column<any>[] = [
    { key: "employee", label: "Employee", render: (r) => employeeName(r.employee_id) },
    { key: "period", label: "Period", render: (r) => `${MONTHS[(r.month || 1) - 1]} ${r.year}` },
    { key: "status", label: "Status", render: (r) => (
      r.id ? <StatusBadge status={r.status} /> : (
        // Synthetic "Due" row: the month is owed (employee was onboarded) but
        // no timesheet exists yet — the gap the old list silently hid.
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-semibold text-danger ring-1 ring-inset ring-subtle">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden />
          Due — not created
        </span>
      )
    ) },
    { key: "submitted_at", label: "Submitted", render: (r) => fmtDate(r.submitted_at) },
    { key: "approved_at", label: "Approved", render: (r) => fmtDate(r.approved_at) },
  ];

  if (error) return <ErrorBox error={error} onRetry={load} />;
  return (
    <DataTable<any>
      columns={columns}
      rows={filtered}
      meta={meta}
      loading={loading}
      onPage={setPage}
      search={search}
      onSearch={setSearch}
      onRowClick={(r) => { if (r.id) crmNavigate(`timesheets/${r.id}`); }}
      emptyMessage={search.trim() ? "No timesheets match your search" : "No timesheets for this project"}
      searchPlaceholder="Search timesheets…"
      filters={
        <>
          {/* Server-side, unlike the text search: an employee's older sheets
              may sit on later pages, and the review flow is per-person. */}
          <select className={`${inputCls} !w-44`} value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setPage(1); }}>
            <option value="">All employees</option>
            {(project.team || [])
              .filter((t) => t.employee_name)
              .map((t) => <option key={t.employee_id} value={t.employee_id}>{t.employee_name}</option>)}
          </select>
          <select className={`${inputCls} !w-36`} value={month} onChange={(e) => { setMonth(e.target.value); setPage(1); }}>
            <option value="">All months</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <input
            type="number" placeholder="Year" className={`${inputCls} !w-28`}
            value={year} onChange={(e) => { setYear(e.target.value); setPage(1); }}
          />
          <select className={`${inputCls} !w-40`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {TS_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            <option value="Due">Due (not created)</option>
          </select>
        </>
      }
    />
  );
}

/* ---------------------------------------------------------------- POs & Invoices tab */

const PO_STATUSES = ["Active", "Exhausted", "Cancelled"];
const INVOICE_PAYMENT_STATUSES = ["Unpaid", "Partially_Paid", "Paid"];

function FinanceTab({ project }: { project: ProjectDetail }) {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Filters — same treatment as the Timesheet tab, per section.
  const [poSearch, setPoSearch] = useState("");
  const [poStatus, setPoStatus] = useState("");
  const [invSearch, setInvSearch] = useState("");
  const [invStatus, setInvStatus] = useState("");
  const [invMonth, setInvMonth] = useState("");
  const [invYear, setInvYear] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      crmGet<any[]>(`/api/invoices${qs({ project_id: project.id, limit: 100 })}`),
      crmGet<any[]>(`/api/purchase-orders${qs({ customer_id: project.customer_id, limit: 100 })}`).catch(() => ({ data: [] as any[] })),
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

  // Both lists are already scoped (this project / this customer) and capped at
  // 100, so the filters run client-side — no round trip per keystroke.
  const filteredPos = useMemo(() => {
    const q = poSearch.trim().toLowerCase();
    return pos.filter((r) =>
      (!poStatus || r.status === poStatus) &&
      (!q || [r.po_number, r.po_type, r.payment_terms]
        .some((v) => String(v ?? "").toLowerCase().includes(q))),
    );
  }, [pos, poSearch, poStatus]);

  const filteredInvoices = useMemo(() => {
    const q = invSearch.trim().toLowerCase();
    return invoices.filter((r) => {
      if (invStatus && r.payment_status !== invStatus) return false;
      if (invMonth || invYear) {
        const d = r.invoice_date ? new Date(r.invoice_date) : null;
        if (!d || Number.isNaN(d.getTime())) return false;
        if (invMonth && d.getMonth() + 1 !== Number(invMonth)) return false;
        if (invYear && d.getFullYear() !== Number(invYear)) return false;
      }
      return !q || [r.invoice_number, r.po_number, r.timesheet_period]
        .some((v) => String(v ?? "").toLowerCase().includes(q));
    });
  }, [invoices, invSearch, invStatus, invMonth, invYear]);

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
              { key: "end_date", label: "End date", render: (r) => fmtDate(r.end_date) },
              { key: "total_value", label: "Total", render: (r) => r.total_value ?? "—" },
              { key: "balance_value", label: "Balance", render: (r) => r.balance_value ?? "—" },
              { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
            ]}
            rows={filteredPos}
            search={poSearch}
            onSearch={setPoSearch}
            searchPlaceholder="Search PO number / type / terms…"
            emptyMessage={poSearch.trim() || poStatus ? "No POs match these filters" : "No purchase orders"}
            filters={
              <select className={`${inputCls} !w-36`} value={poStatus} onChange={(e) => setPoStatus(e.target.value)}>
                <option value="">All statuses</option>
                {PO_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            }
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
            rows={filteredInvoices}
            search={invSearch}
            onSearch={setInvSearch}
            searchPlaceholder="Search invoice / PO number…"
            emptyMessage={
              invSearch.trim() || invStatus || invMonth || invYear
                ? "No invoices match these filters" : "No invoices for this project"
            }
            filters={
              <>
                <select className={`${inputCls} !w-36`} value={invMonth} onChange={(e) => setInvMonth(e.target.value)}>
                  <option value="">All months</option>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <input
                  type="number" placeholder="Year" className={`${inputCls} !w-28`}
                  value={invYear} onChange={(e) => setInvYear(e.target.value)}
                />
                <select className={`${inputCls} !w-40`} value={invStatus} onChange={(e) => setInvStatus(e.target.value)}>
                  <option value="">All payment statuses</option>
                  {INVOICE_PAYMENT_STATUSES.map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </>
            }
          />
        )}
      </section>
    </div>
  );
}
