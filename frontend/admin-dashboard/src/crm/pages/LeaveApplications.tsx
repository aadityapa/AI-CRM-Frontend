/** Leave Applications — self-service + HR leave workflow.
 * List with status filter tabs, "Apply Leave" modal (HR may file for anyone;
 * everyone else files for their own linked employee profile), and per-row
 * Approve / Reject (reason) / Cancel actions. Days are server-computed;
 * insufficient-balance 400s are surfaced inline in the apply modal. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Check, Plus, X } from "lucide-react";
import { CrmApiError, crmGet, crmPost, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import {
  ConfirmModal, ErrorBox, Field, Modal, StatusBadge, Tabs,
  btnDanger, btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";

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

export function LeaveApplicationsPage() {
  const isHr = useHasRole("HR");
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
        <h1 className="text-display text-xl font-bold text-primary">Leave Applications</h1>
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
          loading={loading}
          onPage={setPage}
          emptyMessage="No leave applications found"
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

  const selectedType = leaveTypes.find((t) => String(t.id) === leaveTypeId);
  const showCompOff = isCompOffType(selectedType?.name);
  const multiDay = periodType === "Multi_Day";

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
    <Modal title="Apply Leave" onClose={onClose} fullScreen>
      <form onSubmit={submit} className="space-y-3.5">
        {apiError && <ErrorBox error={apiError} />}
        {isHr && (
          <Field label="Employee">
            <select
              className={inputCls}
              value={employeeIdSel}
              onChange={(e) => setEmployeeIdSel(e.target.value)}
            >
              <option value="">Myself</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name || `#${e.id}`}</option>)}
            </select>
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Leave type" required error={errors.leave_type}>
            <select
              className={inputCls}
              value={leaveTypeId}
              onChange={(e) => { setLeaveTypeId(e.target.value); setCompOffType(""); }}
            >
              <option value="">Select leave type…</option>
              {leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Period type">
            <select
              className={inputCls}
              value={periodType}
              onChange={(e) => setPeriodType(e.target.value)}
            >
              {PERIOD_TYPES.map((p) => <option key={p} value={p}>{pretty(p)}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From date" required error={errors.from_date}>
            <input type="date" className={inputCls} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </Field>
          {multiDay && (
            <Field label="To date" required error={errors.to_date}>
              <input type="date" className={inputCls} value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} />
            </Field>
          )}
        </div>
        {showCompOff && (
          <Field label="Comp-off type">
            <select className={inputCls} value={compOffType} onChange={(e) => setCompOffType(e.target.value)}>
              <option value="">— Select —</option>
              {COMP_OFF_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        )}
        <Field label="Project" required error={errors.project}>
          <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Select project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <p className="text-xs text-muted">
          Select the project mapping so leave draws from that client&apos;s PE balance (not a shared pool).
        </p>
        <Field label="Reason">
          <textarea
            className={`${inputCls} min-h-20`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for this leave…"
          />
        </Field>
        <p className="text-xs text-muted">
          Days are computed by the server (Full Day = 1, Half Day = 0.5, Multi Day = inclusive day count).
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={busy}>{busy ? "Submitting…" : "Submit application"}</button>
        </div>
      </form>
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
      onError(e?.message || "Failed to reject leave application");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Reject Leave Application" onClose={onClose}>
      <p className="mb-3 text-sm text-secondary">
        Rejecting <b>{application.leave_type_name || "leave"}</b> for{" "}
        <b>{application.employee_name || `#${application.employee_id}`}</b>{" "}
        ({fmtDate(application.from_date)} → {fmtDate(application.to_date)}).
      </p>
      <Field label="Rejection reason" required error={error}>
        <textarea
          className={`${inputCls} min-h-24`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Explain why this leave application is being rejected (min 10 characters)…"
        />
      </Field>
      <div className="mt-1 text-xs text-muted">{reason.trim().length}/10 characters minimum</div>
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={btnDanger} onClick={submit} disabled={busy}>{busy ? "Rejecting…" : "Reject"}</button>
      </div>
    </Modal>
  );
}
