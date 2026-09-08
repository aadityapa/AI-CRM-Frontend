/** Leave Applications — self-service + HR leave workflow.
 * List with status filter tabs, "Apply Leave" modal (HR may file for anyone;
 * everyone else files for their own linked employee profile), and per-row
 * Approve / Reject (reason) / Cancel actions. Days are server-computed;
 * insufficient-balance 400s are surfaced inline in the apply modal. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, CalendarOff, Check, Plus, X } from "lucide-react";
import { CrmApiError, crmGet, crmPost, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanAct } from "../useAccess";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { RowActions, afterListDelete } from "../components/RowActions";
import {
  ConfirmModal, ErrorBox, Modal, StatusBadge, Tabs,
  btnDanger, btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";
import { TeachingEmpty } from "../components/TeachingEmpty";
import { SectionHeaderBanner, WizardField, InfoChip } from "../components/wizard";

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

/* ------------------------------------------------------------ types & consts */

type LeaveApplication = {
  id: number;
  employee_id: number;
  project_id: number | null;
  leave_type_id: number;
  leave_period_type: string;
  from_date: string;
  to_date: string;
  days: number;
  comp_off_type: string | null;
  reason: string | null;
  status: string;
  rejection_reason: string | null;
  decided_at: string | null;
  created_at?: string | null;
  employee_name?: string | null;
  leave_type_name?: string | null;
};

type LeaveType = { id: number; name: string };

const PERIOD_TYPES = ["Full_Day", "Half_Day", "Multi_Day"];
const COMP_OFF_TYPES = ["Earned", "Consumed"];
const STATUS_TABS = [
  { key: "Pending", label: "Pending" },
  { key: "Approved", label: "Approved" },
  { key: "Rejected", label: "Rejected" },
  { key: "Cancelled", label: "Cancelled" },
  { key: "All", label: "All" },
];

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "—");
const pretty = (s?: string | null) => (s ? String(s).replace(/_/g, " ") : "—");
const isCompOffType = (name?: string | null) => /comp/i.test(name || "");

const iconBtn =
  "rounded-control p-1.5 text-muted transition-colors duration-micro ease-smooth hover:bg-surface-2 hover:text-primary focus-visible:outline-none focus-visible:shadow-focus-ring";

/* ================================================================ LIST PAGE */

/** `embedded` — rendered as an inner tab (Timesheets → Leave Applications):
 * the host page owns the h1, so the title is hidden. */
export function LeaveApplicationsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const isHr = useCanAct("leave-applications", "edit", useHasRole("HR"));
  const [tab, setTab] = useState("Pending");
  const [rows, setRows] = useState<LeaveApplication[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [page, setPage] = useState(1);
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [showApply, setShowApply] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "approve" | "cancel"; row: LeaveApplication } | null>(null);
  const [rejecting, setRejecting] = useState<LeaveApplication | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<LeaveApplication[]>(`/api/leave-applications${qs({
        status: tab === "All" ? "" : tab,
        leave_type_id: leaveTypeId,
        employee_id: employeeId,
        page,
        limit: 20,
      })}`);
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load leave applications");
    } finally {
      setLoading(false);
    }
  }, [tab, leaveTypeId, employeeId, page]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    crmGet<LeaveType[]>("/api/leave-policy-types?limit=100").then((r) => setLeaveTypes(r.data || [])).catch(() => {});
    crmGet<any[]>("/api/projects?limit=100").then((r) => setProjects(r.data || [])).catch(() => {});
    if (isHr) {
      crmGet<any[]>("/api/employees?limit=100").then((r) => setEmployees(r.data || [])).catch(() => {});
    }
  }, [isHr]);

  const projectName = useMemo(() => {
    const m = new Map<number, string>();
    projects.forEach((p) => m.set(p.id, p.name));
    return (id?: number | null) => (id == null ? "—" : m.get(id) || `#${id}`);
  }, [projects]);

  const doAction = async (row: LeaveApplication, action: "approve" | "cancel") => {
    setBusy(true);
    try {
      const res = await crmPost(`/api/leave-applications/${row.id}/${action}`);
      showToast(res.message || `Leave application ${action === "approve" ? "approved" : "cancelled"}`);
      setConfirm(null);
      await load();
    } catch (e: any) {
      showToast(e?.message || `Failed to ${action} leave application`, "err");
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<LeaveApplication>[] = [
    {
      key: "employee",
      label: "Employee",
      render: (r) => <span className="font-semibold text-primary">{r.employee_name || `#${r.employee_id}`}</span>,
    },
    {
      key: "leave_type",
      label: "Leave Type",
      render: (r) => (
        <span>
          {r.leave_type_name || `#${r.leave_type_id}`}
          {r.comp_off_type && (
            <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-xs font-semibold text-secondary ring-1 ring-inset ring-subtle">
              {r.comp_off_type}
            </span>
          )}
        </span>
      ),
    },
    { key: "period_type", label: "Period Type", render: (r) => pretty(r.leave_period_type) },
    { key: "from_date", label: "From", render: (r) => fmtDate(r.from_date) },
    { key: "to_date", label: "To", render: (r) => fmtDate(r.to_date) },
    { key: "days", label: "Days", align: "right", render: (r) => <span className="font-semibold">{r.days ?? "—"}</span> },
    { key: "project", label: "Project", render: (r) => projectName(r.project_id) },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "created_at", label: "Applied", render: (r) => fmtDate(r.created_at) },
    {
      key: "_actions",
      label: "",
      className: "text-right",
      render: (r) =>
        r.status === "Pending" ? (
          <span className="inline-flex gap-1">
            {isHr && (
              <>
                <button
                  className={`${iconBtn} hover:!text-success`}
                  title="Approve"
                  aria-label={`Approve leave application #${r.id}`}
                  onClick={(e) => { e.stopPropagation(); setConfirm({ kind: "approve", row: r }); }}
                >
                  <Check size={15} />
                </button>
                <button
                  className={`${iconBtn} hover:!text-danger`}
                  title="Reject"
                  aria-label={`Reject leave application #${r.id}`}
                  onClick={(e) => { e.stopPropagation(); setRejecting(r); }}
                >
                  <X size={15} />
                </button>
              </>
            )}
            <button
              className={`${iconBtn} hover:!text-danger`}
              title="Cancel (applicant only)"
              aria-label={`Cancel leave application #${r.id}`}
              onClick={(e) => { e.stopPropagation(); setConfirm({ kind: "cancel", row: r }); }}
            >
              <Ban size={15} />
            </button>
          </span>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!embedded && <h1 className="text-display text-xl font-bold text-primary">Leave Applications</h1>}
        <button className={btnPrimary} onClick={() => setShowApply(true)}>
          <Plus size={15} /> Apply Leave
        </button>
      </div>

      <Tabs tabs={STATUS_TABS} active={tab} onChange={(k) => { setTab(k); setPage(1); }} />

      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : (
        <DataTable<LeaveApplication>
          columns={columns}
          rows={rows}
          meta={meta}
          headerRight={meta ? <span className="whitespace-nowrap text-xs font-medium text-muted">{meta.total} {meta.total === 1 ? "application" : "applications"}, page {meta.page}/{Math.max(1, meta.pages || 1)}</span> : undefined}
          loading={loading}
          onPage={setPage}
          emptyMessage={<TeachingEmpty page="leave-applications" />}
          filters={
            <>
              <select
                className={`${inputCls} !w-44`}
                value={leaveTypeId}
                onChange={(e) => { setLeaveTypeId(e.target.value); setPage(1); }}
                aria-label="Filter by leave type"
              >
                <option value="">All leave types</option>
                {leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {isHr && (
                <select
                  className={`${inputCls} !w-44`}
                  value={employeeId}
                  onChange={(e) => { setEmployeeId(e.target.value); setPage(1); }}
                  aria-label="Filter by employee"
                >
                  <option value="">All employees</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name || `#${e.id}`}</option>)}
                </select>
              )}
            </>
          }
          rowActions={isHr ? (r) => (
            <RowActions
              entity="leave application"
              itemLabel={r.employee_name || `#${r.id}`}
              deleteUrl={`/api/leave-applications/${r.id}`}
              onDeleted={() => afterListDelete(r.id, setRows, load)}
              notify={showToast}
              canEdit={false}
              canDelete
            colored />
          ) : undefined}
        />
      )}

      {showApply && (
        <ApplyLeaveModal
          isHr={isHr}
          employees={employees}
          projects={projects}
          leaveTypes={leaveTypes}
          onClose={() => setShowApply(false)}
          onDone={(msg) => { setShowApply(false); showToast(msg || "Leave application submitted"); load(); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
      {confirm?.kind === "approve" && (
        <ConfirmModal
          title="Approve leave application"
          message={<>Approve <b>{confirm.row.leave_type_name || "leave"}</b> for <b>{confirm.row.employee_name || `#${confirm.row.employee_id}`}</b> ({fmtDate(confirm.row.from_date)} → {fmtDate(confirm.row.to_date)}, {confirm.row.days} day(s))? The employee&apos;s leave balance will be updated.</>}
          confirmLabel="Approve"
          busy={busy}
          onConfirm={() => doAction(confirm.row, "approve")}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "cancel" && (
        <ConfirmModal
          title="Cancel leave application"
          message={<>Cancel this <b>{confirm.row.leave_type_name || "leave"}</b> application ({fmtDate(confirm.row.from_date)} → {fmtDate(confirm.row.to_date)})? Only the applicant can cancel their own application.</>}
          confirmLabel="Cancel application"
          danger
          busy={busy}
          onConfirm={() => doAction(confirm.row, "cancel")}
          onClose={() => setConfirm(null)}
        />
      )}
      {rejecting && (
        <RejectLeaveModal
          application={rejecting}
          onClose={() => setRejecting(null)}
          onDone={() => { setRejecting(null); showToast("Leave application rejected"); load(); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
      {toast}
    </div>
  );
}

/* ================================================================ APPLY MODAL */

function ApplyLeaveModal({
  isHr, employees, projects, leaveTypes, onClose, onDone, onError,
}: {
  isHr: boolean;
  employees: any[];
  projects: any[];
  leaveTypes: LeaveType[];
  onClose: () => void;
  onDone: (message?: string) => void;
  onError: (msg: string) => void;
}) {
  const [employeeIdSel, setEmployeeIdSel] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [periodType, setPeriodType] = useState("Full_Day");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [compOffType, setCompOffType] = useState("");
  const [projectId, setProjectId] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState("");
  const [busy, setBusy] = useState(false);
  const [leaveBalances, setLeaveBalances] = useState<Record<number, number>>({});

  const selectedType = leaveTypes.find((t) => String(t.id) === leaveTypeId);
  const showCompOff = isCompOffType(selectedType?.name);
  const multiDay = periodType === "Multi_Day";
  const selectedBalance = leaveTypeId
    ? leaveBalances[Number(leaveTypeId)]
    : undefined;
  const balanceYear = new Date().getFullYear();
  // HR filing for another employee uses that id; otherwise self (Myself / non-HR).
  const balanceEmployeeId = isHr && employeeIdSel ? Number(employeeIdSel) : null;

  // Per-leave-type balances shown next to the leave-type select.
  // HR/managers read via the employees endpoint; self-service employees (no
  // employee-read permission) fall back to their own /api/me/leave-balances.
  useEffect(() => {
    const toMap = (rows: any[] | undefined) => {
      const m: Record<number, number> = {};
      (rows || []).forEach((b: any) => {
        if (b.leave_type_id != null) m[Number(b.leave_type_id)] = Number(b.balance ?? 0);
      });
      return m;
    };
    const loadMe = () =>
      crmGet<any[]>(`/api/me/leave-balances?year=${balanceYear}`)
        .then((r) => setLeaveBalances(toMap(r.data)))
        .catch(() => setLeaveBalances({}));

    if (balanceEmployeeId) {
      // HR filing for another employee — only that employee's balances (never fall back to /me).
      crmGet<any[]>(`/api/employees/${balanceEmployeeId}/leave-balances?year=${balanceYear}`)
        .then((r) => setLeaveBalances(toMap(r.data)))
        .catch(() => setLeaveBalances({}));
    } else {
      loadMe();
    }
  }, [balanceEmployeeId, balanceYear]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!leaveTypeId) errs.leave_type = "Leave type is required";
    if (!fromDate) errs.from_date = "From date is required";
    if (!projectId) errs.project = "Project is required when applying leave against a client mapping";
    if (multiDay) {
      if (!toDate) errs.to_date = "To date is required for multi-day leave";
      else if (fromDate && toDate < fromDate) errs.to_date = "To date cannot be before from date";
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setApiError("");
    setBusy(true);
    try {
      const res = await crmPost<LeaveApplication>("/api/leave-applications", {
        employee_id: isHr && employeeIdSel ? Number(employeeIdSel) : undefined,
        project_id: Number(projectId),
        leave_type_id: Number(leaveTypeId),
        leave_period_type: periodType,
        from_date: fromDate,
        to_date: multiDay && toDate ? toDate : fromDate,
        comp_off_type: showCompOff && compOffType ? compOffType : undefined,
        reason: reason.trim() || null,
      });
      onDone(res.message);
    } catch (err: any) {
      // 400s (e.g. insufficient balance) are surfaced inline in the form.
      if (err instanceof CrmApiError && err.status === 400) {
        setApiError(err.message);
      } else {
        onError(err?.message || "Failed to submit leave application");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={<span className="sr-only">Apply Leave</span>}
      onClose={onClose}
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title="Apply Leave"
        subtitle="File a leave request against a client mapping — days are computed by the server."
        icon={<CalendarOff size={20} aria-hidden />}
      >
        <form onSubmit={submit} className="space-y-5">
          {apiError && <ErrorBox error={apiError} />}
          {isHr && (
            <WizardField label="Employee" icon="user">
              <select
                className={inputCls}
                value={employeeIdSel}
                onChange={(e) => setEmployeeIdSel(e.target.value)}
              >
                <option value="">Myself</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name || `#${e.id}`}</option>)}
              </select>
            </WizardField>
          )}
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <WizardField
              label="Leave type"
              required
              error={errors.leave_type}
              info={
                leaveTypeId ? (
                  <span className="mt-1.5 inline-flex items-center rounded-lg border border-[#6D5DFB]/35 bg-[#6D5DFB]/12 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-[color:var(--wiz-muted)]">
                    Leave balance:{" "}
                    <span className="ml-1 text-[color:var(--wiz-text)]">
                      {selectedBalance != null
                        ? `${Number(selectedBalance).toLocaleString("en-IN", { maximumFractionDigits: 2 })} day(s)`
                        : "—"}
                    </span>
                  </span>
                ) : undefined
              }
            >
              <select
                className={inputCls}
                value={leaveTypeId}
                onChange={(e) => { setLeaveTypeId(e.target.value); setCompOffType(""); }}
              >
                <option value="">Select leave type…</option>
                {leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </WizardField>
            <WizardField label="Period type">
              <select
                className={inputCls}
                value={periodType}
                onChange={(e) => setPeriodType(e.target.value)}
              >
                {PERIOD_TYPES.map((p) => <option key={p} value={p}>{pretty(p)}</option>)}
              </select>
            </WizardField>
          </div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <WizardField label="From date" required error={errors.from_date} icon="calendar" filled={!!fromDate}>
              <input type="date" className={inputCls} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </WizardField>
            {multiDay && (
              <WizardField label="To date" required error={errors.to_date} icon="calendar" filled={!!toDate}>
                <input type="date" className={inputCls} value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} />
              </WizardField>
            )}
          </div>
          {showCompOff && (
            <WizardField label="Comp-off type">
              <select className={inputCls} value={compOffType} onChange={(e) => setCompOffType(e.target.value)}>
                <option value="">— Select —</option>
                {COMP_OFF_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </WizardField>
          )}
          <WizardField label="Project" required error={errors.project} icon="building">
            <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Select project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </WizardField>
          <InfoChip>
            Select the project mapping so leave draws from that client&apos;s PE balance (not a shared pool).
          </InfoChip>
          <WizardField label="Reason">
            <textarea
              className={`${inputCls} min-h-20`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for this leave…"
            />
          </WizardField>
          <InfoChip>
            Days are computed by the server (Full Day = 1, Half Day = 0.5, Multi Day = inclusive day count).
          </InfoChip>
          <div className={wizFooterRow}>
            <button type="button" className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`} disabled={busy}>{busy ? "Submitting…" : "Submit application"}</button>
          </div>
        </form>
      </WizFormShell>
    </Modal>
  );
}

/* ================================================================ REJECT MODAL */

function RejectLeaveModal({
  application, onClose, onDone, onError,
}: {
  application: LeaveApplication;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (reason.trim().length < 10) {
      setError("Rejection reason is mandatory (minimum 10 characters)");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await crmPost(`/api/leave-applications/${application.id}/reject`, { reason: reason.trim() });
      onDone();
    } catch (e: any) {
      const msg = e?.message || "Failed to reject leave application";
      setError(msg);        // inline, under the field — not only the toast
      onError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={<span className="sr-only">Reject Leave Application</span>}
      onClose={onClose}
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0"
    >
      <WizFormShell
        title="Reject Leave Application"
        subtitle="Provide a clear reason (minimum 10 characters). The applicant will be notified."
        icon={<X size={20} aria-hidden />}
      >
        <p className="mb-4 text-sm text-secondary">
          Rejecting <b>{application.leave_type_name || "leave"}</b> for{" "}
          <b>{application.employee_name || `#${application.employee_id}`}</b>{" "}
          ({fmtDate(application.from_date)} → {fmtDate(application.to_date)}).
        </p>
        <WizardField label="Rejection reason" required error={error}>
          <textarea
            className={`${inputCls} min-h-24`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why this leave application is being rejected (min 10 characters)…"
          />
        </WizardField>
        <div className="mt-1 text-xs text-muted">{reason.trim().length}/10 characters minimum</div>
        <div className={wizFooterRow}>
          <button className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`${btnDanger} ml-auto h-10 rounded-xl px-4`} onClick={submit} disabled={busy}>{busy ? "Rejecting…" : "Reject"}</button>
        </div>
      </WizFormShell>
    </Modal>
  );
}
