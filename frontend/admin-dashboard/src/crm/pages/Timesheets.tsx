/** Timesheets — list (filters + create) and detail entry page ("Tab 9: TimeSheet"):
 * header info card, daily entries grid with server-computed billables, collapsible
 * invoice-preview section (Finance/Admin can generate the invoice), summary rollup,
 * submit/approve/reject workflow. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BellRing, Check, ChevronDown, FilePlus2, History, Plus, Receipt, Save, Send, X } from "lucide-react";
import { crmDelete, crmGet, crmPost, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { CrmLink, crmNavigate, useCrmParams } from "../routerHooks";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { FileLink, FileUploadButton } from "../components/FileUpload";
import {
  ConfirmModal, ErrorBox, Field, Modal, Spinner, StatusBadge,
  btnDanger, btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";
import { applyHoursAttendanceRule } from "../lib/timesheetAttendance";

/* ------------------------------------------------------------ types & consts */

type Timesheet = {
  id: number;
  project_id: number;
  employee_id: number;
  month: number;
  year: number;
  status: string;
  rejection_reason: string | null;
  submitted_at: string | null;
  approved_by: number | null;
  approved_at: string | null;
  file_attachment_url: string | null;
};

type Entry = {
  id?: number;
  entry_date: string;
  day_of_week: string | null;
  day_type?: string | null;
  is_working: boolean;
  hours_worked: number | null;
  attendance_status: string | null;
  leave_type: string | null;
  leave_period: string | null;
  location: string | null;
  billable_hours: number | null;
  billable_days: number | null;
  billable_day?: number | null;
  view_flag?: boolean;
  entry_project_id?: number | null;
};

type BillingPolicy = {
  week_off_billable: boolean;
  leave_billable: boolean;
  holidays_billable: boolean;
  min_hours_full_day: number;
  min_hours_half_day: number;
};

type TimesheetDetail = Timesheet & {
  created_at?: string | null;
  project_title?: string | null;
  customer_id?: number | null;
  customer_name?: string | null;
  branch_id?: number | null;
  branch_name?: string | null;
  project_type?: string | null;
  timesheet_period?: string | null;
  period_start_date?: string | null;
  period_end_date?: string | null;
  employee_name?: string | null;
  employee_code?: string | null;
  project_employee_id?: number | null;
  billing_policy?: BillingPolicy | null;
  max_billable_hours_day?: number | null;
  holiday_dates?: string[];
  entries: Entry[];
  summary?: Summary | null;
};

type Summary = {
  total_days: number;
  working_days: number;
  comp_off_days: number;
  hours_worked: number;
  total_hours_worked?: number | null;
  billable_hours: number;
  billable_days: number;
  leave_days: number;
  holidays: number;
  present_days: number;
  absent_days: number;
  half_days: number;
  total_week_off?: number | null;
  total_no_of_days_worked?: number | null;
  total_billable_hours?: number | null;
  total_billable_days?: number | null;
  actual_billable_hours?: number | null;
  actual_billable_days?: number | null;
  actual_billable_day?: number | null;
  total_leave_days?: number | null;
  total_leave_billable_days?: number | null;
  comp_off_earned?: number | null;
  comp_off_credited?: number | null;
  approved_time?: { approved_at: string | null; approver_name: string | null } | null;
  reason_for_rejection?: string | null;
  attachment_url?: string | null;
};

type InvoiceLineItem = {
  s_no: number;
  description: string;
  monthly_cost: number | null;
  total_billed_qty: number;
  rate_per_unit: number;
  leave_billable_days: number;
  amount: number;
};

type InvoicePreview = {
  line_items: InvoiceLineItem[];
  totals: { sub_total: number };
  linked_invoice: { id: number; invoice_number: string; payment_status: string } | null;
  can_generate: boolean;
};

/** Editable local row (string inputs for hours). */
type EntryRow = {
  entry_date: string;
  day_of_week: string;
  day_type: string;
  is_working: boolean;
  hours_worked: string;
  attendance_status: string;
  leave_type: string;
  leave_period: string;
  location: string;
  view_flag: boolean;
  entry_project_id: string;
  billable_hours: number | null;
  billable_days: number | null;
  billable_day: number | null;
};

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const TS_STATUSES = ["Draft", "Submitted", "Approved", "Rejected"];
const DAY_TYPES = ["Working", "Week_Off", "Holiday"] as const;
const ATTENDANCE = ["Present", "Week_Off", "Holiday", "Leave", "Absent", "Half_Day"];
const LEAVE_PERIODS = ["", "Full", "Half_AM", "Half_PM"];
const LOCATIONS: { value: string; label: string }[] = [
  { value: "Onsite", label: "On Site" },
  { value: "Remote", label: "Offshore/Remote" },
];

const round2 = (v: number) => Math.round(v * 100) / 100;
const billableDayFromHours = (hours: number) => (hours > 0 ? round2(hours / 8) : 0);

/** Client-side mirror of server compute_billables (invoice days use thresholds; display uses hours/8). */
function computeBillables(
  row: Pick<EntryRow, "day_type" | "is_working" | "hours_worked" | "attendance_status" | "leave_period">,
  policy: BillingPolicy,
  maxDayHours?: number | null,
): { billable_hours: number; billable_day: number } {
  let hours = Number(row.hours_worked || 0);
  if (maxDayHours != null && hours > maxDayHours) hours = maxDayHours;
  const att = row.attendance_status;
  const lp = row.leave_period;
  const working = row.day_type === "Working" && row.is_working;

  if (!working && row.day_type !== "Working") {
    if (hours > 0 && policy.week_off_billable) {
      const bh = hours;
      const days = bh >= policy.min_hours_full_day ? 1 : bh >= policy.min_hours_half_day ? 0.5 : 0;
      return { billable_hours: bh, billable_day: billableDayFromHours(bh) };
    }
    return { billable_hours: 0, billable_day: 0 };
  }
  if (att === "Present") {
    return { billable_hours: hours, billable_day: billableDayFromHours(hours) };
  }
  if (att === "Half_Day") {
    return { billable_hours: hours, billable_day: billableDayFromHours(hours) };
  }
  if (att === "Leave") {
    if (policy.leave_billable) {
      const days = lp === "Half_AM" || lp === "Half_PM" ? 0.5 : 1;
      return { billable_hours: 0, billable_day: billableDayFromHours(days * 8) };
    }
    return { billable_hours: 0, billable_day: 0 };
  }
  if (att === "Holiday") {
    return policy.holidays_billable
      ? { billable_hours: 0, billable_day: billableDayFromHours(8) }
      : { billable_hours: 0, billable_day: 0 };
  }
  return { billable_hours: 0, billable_day: 0 };
}

const dayTypeLabel = (v: string) => {
  if (v === "Week_Off") return "Week Off";
  if (v === "Holiday") return "Holiday";
  return "Working";
};

const fmtPeriod = (start?: string | null, end?: string | null) => {
  if (!start || !end) return "—";
  const s = new Date(`${start}T00:00:00`).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  const e = new Date(`${end}T00:00:00`).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  return `${s} to ${e}`;
};

const tsStatusLabel = (status?: string | null) => {
  switch (status) {
    case "Draft": return "Pending for Submission";
    case "Submitted": return "Pending for Approval";
    case "Approved": return "Approved";
    case "Rejected": return "Rejected";
    case "Due": return "Due";
    default: return status ? String(status).replace(/_/g, " ") : "—";
  }
};
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "—");
const pretty = (s?: string | null) => (s ? String(s).replace(/_/g, " ") : "—");
const weekday = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "long" });
const entryDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString();
const inr = (v?: number | null) =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const num = (v?: number | null): React.ReactNode => (v ?? "—");
/* Mirrors the shared :focus-visible ring used across CRM UI primitives. */
const focusRing = "focus-visible:outline-none focus-visible:shadow-focus-ring";

/* ================================================================ LIST PAGE */

/** Read CRM list-filter query params set by crmUrl / crmNavigate("path?…"). */
function readListFilter(name: string): string {
  try {
    return new URLSearchParams(window.location.search).get(name) || "";
  } catch {
    return "";
  }
}

type ReportRow = {
  id?: number;
  timesheet_id?: number | null;
  project_employee_id?: number | null;
  project_id: number;
  employee_id: number;
  month: number;
  year: number;
  status?: string;
  status_label?: string;
  project_title?: string | null;
  project_type?: string | null;
  customer_name?: string | null;
  project_employee_name?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  period_start_date?: string | null;
  period_end_date?: string | null;
  timesheet_period?: string | null;
  date?: string | null;
  created_at?: string | null;
  actual_billable_hours?: number | null;
  actual_billable_day?: number | null;
  total_hours_worked?: number | null;
  total_leave_billable_days?: number | null;
  total_leave_days?: number | null;
  reason_for_rejection?: string | null;
  rejection_reason?: string | null;
  can_generate_invoice?: boolean;
  invoice?: { id: number; invoice_number: string; payment_status: string } | null;
  attachments?: AttachmentRow[];
};

type AttachmentRow = {
  id: number | null;
  file_url: string;
  file_name?: string | null;
};

const REPORT_TABS = [
  { key: "due", label: "Timesheet Due" },
  { key: "submission", label: "Submit for Approval" },
  { key: "approvals", label: "Timesheet Approvals" },
  { key: "all", label: "All Timesheets" },
] as const;

type ReportTab = typeof REPORT_TABS[number]["key"];

export function TimesheetsListPage() {
  const isStaff = useHasRole("HR", "Finance", "RMG");
  const canManage = useHasRole("HR", "Finance", "RMG", "Sales", "Sales_Head");
  const [tab, setTab] = useState<ReportTab>(() => (isStaff ? "due" : "all"));
  const [rows, setRows] = useState<Timesheet[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [page, setPage] = useState(1);
  const [projectId, setProjectId] = useState(() => readListFilter("project_id"));
  const [employeeId, setEmployeeId] = useState(() => readListFilter("employee_id"));
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [prefill, setPrefill] = useState<{
    project_id?: number; employee_id?: number; project_employee_id?: number;
    month?: number; year?: number;
  } | null>(null);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    if (tab !== "all") return;
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<Timesheet[]>(`/api/timesheets${qs({
        project_id: projectId, employee_id: employeeId, month, year, status, page, limit: 20,
      })}`);
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load timesheets");
    } finally {
      setLoading(false);
    }
  }, [projectId, employeeId, month, year, status, page, tab]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    crmGet<any[]>("/api/projects?limit=100").then((r) => setProjects(r.data || [])).catch(() => {});
    crmGet<any[]>("/api/employees?limit=100").then((r) => setEmployees(r.data || [])).catch(() => {});
  }, []);

  const projectName = useMemo(() => {
    const m = new Map<number, string>();
    projects.forEach((p) => m.set(p.id, p.name));
    return (id: number) => m.get(id) || `#${id}`;
  }, [projects]);
  const employeeName = useMemo(() => {
    const m = new Map<number, string>();
    employees.forEach((e) => m.set(e.id, e.full_name || `${e.first_name || ""} ${e.last_name || ""}`.trim()));
    return (id: number) => m.get(id) || `#${id}`;
  }, [employees]);

  const columns: Column<Timesheet>[] = [
    { key: "project", label: "Project", render: (r) => <span className="font-semibold">{projectName(r.project_id)}</span> },
    { key: "employee", label: "Employee", render: (r) => employeeName(r.employee_id) },
    { key: "period", label: "Period", render: (r) => `${MONTHS[(r.month || 1) - 1]} ${r.year}` },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} label={tsStatusLabel(r.status)} /> },
    { key: "submitted_at", label: "Submitted", render: (r) => fmtDate(r.submitted_at) },
    { key: "approved_at", label: "Approved", render: (r) => fmtDate(r.approved_at) },
  ];

  const openNew = (p?: {
    project_id?: number; employee_id?: number; project_employee_id?: number;
    month?: number; year?: number;
  }) => {
    setPrefill(p || null);
    setShowNew(true);
  };

  const visibleTabs = isStaff ? REPORT_TABS : REPORT_TABS.filter((t) => t.key === "all");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-display text-xl font-bold text-primary">Timesheets</h1>
        {canManage && (
          <button className={btnPrimary} onClick={() => openNew()}>
            <Plus size={15} /> New Timesheet
          </button>
        )}
      </div>

      {visibleTabs.length > 1 && (
        <div className="flex flex-wrap gap-2 border-b border-subtle pb-2">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`rounded-control px-3 py-1.5 text-sm font-semibold transition-colors ${
                tab === t.key ? "bg-brand-600 text-white" : "text-secondary hover:bg-surface-2"
              }`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === "due" && isStaff && (
        <TimesheetDueReport showToast={showToast} onAdd={(r) => openNew({
          project_id: r.project_id,
          employee_id: r.employee_id,
          project_employee_id: r.project_employee_id ?? undefined,
          month: r.month,
          year: r.year,
        })} />
      )}
      {tab === "submission" && isStaff && (
        <SubmitForApprovalReport showToast={showToast} />
      )}
      {tab === "approvals" && isStaff && (
        <TimesheetApprovalsReport showToast={showToast} />
      )}
      {tab === "all" && (
        <>
          {isStaff && <TimesheetDuePanel showToast={showToast} />}
          {error ? (
            <ErrorBox error={error} onRetry={load} />
          ) : (
            <DataTable<Timesheet>
              columns={columns}
              rows={rows}
              meta={meta}
              loading={loading}
              onPage={setPage}
              onRowClick={(r) => crmNavigate(`timesheets/${r.id}`)}
              emptyMessage="No timesheets found"
              filters={
                <>
                  <select className={`${inputCls} !w-44`} value={projectId} onChange={(e) => { setProjectId(e.target.value); setPage(1); }}>
                    <option value="">All projects</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <select className={`${inputCls} !w-44`} value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setPage(1); }}>
                    <option value="">All employees</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name || `#${e.id}`}</option>)}
                  </select>
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
                    {TS_STATUSES.map((s) => <option key={s} value={s}>{tsStatusLabel(s)}</option>)}
                  </select>
                </>
              }
            />
          )}
        </>
      )}

      {showNew && (
        <NewTimesheetModal
          projects={projects}
          fallbackEmployees={employees}
          initial={prefill || undefined}
          onClose={() => { setShowNew(false); setPrefill(null); }}
          onDone={(ts) => { setShowNew(false); setPrefill(null); showToast("Timesheet created"); crmNavigate(`timesheets/${ts.id}`); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
      {toast}
    </div>
  );
}

function NewTimesheetModal({
  projects, fallbackEmployees, initial, onClose, onDone, onError,
}: {
  projects: any[];
  fallbackEmployees: any[];
  initial?: {
    project_id?: number; employee_id?: number; project_employee_id?: number;
    month?: number; year?: number;
  };
  onClose: () => void;
  onDone: (ts: Timesheet & { id: number }) => void;
  onError: (msg: string) => void;
}) {
  const now = new Date();
  const locked = !!(initial?.project_id && initial?.employee_id && initial?.month && initial?.year);
  const [projectId, setProjectId] = useState(initial?.project_id ? String(initial.project_id) : "");
  const [employeeId, setEmployeeId] = useState(initial?.employee_id ? String(initial.employee_id) : "");
  const [month, setMonth] = useState(String(initial?.month ?? now.getMonth() + 1));
  const [year, setYear] = useState(String(initial?.year ?? now.getFullYear()));
  const [generateDays] = useState(true);
  const [team, setTeam] = useState<any[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);

  useEffect(() => {
    if (locked) return;
    setTeam(null);
    if (!projectId) {
      setEmployeeId("");
      return;
    }
    let cancelled = false;
    crmGet<any>(`/api/projects/${projectId}`)
      .then((r) => {
        if (cancelled) return;
        const active = (r.data?.team || []).filter((t: any) => t.is_active);
        setTeam(active);
      })
      .catch(() => !cancelled && setTeam([]));
    return () => { cancelled = true; };
  }, [projectId, locked]);

  useEffect(() => {
    if (locked && projectId && !team) {
      crmGet<any>(`/api/projects/${projectId}`)
        .then((r) => setTeam((r.data?.team || []).filter((t: any) => t.is_active)))
        .catch(() => setTeam([]));
    }
  }, [locked, projectId, team]);

  const employeeOptions = team && team.length > 0
    ? team.map((t: any) => ({ id: t.employee_id, name: t.employee_name || `#${t.employee_id}` }))
    : fallbackEmployees.map((e: any) => ({ id: e.id, name: e.full_name || `#${e.id}` }));

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!projectId) errs.project = "Project is required";
    if (!employeeId) errs.employee = "Employee is required";
    const y = Number(year);
    if (!(y >= 2000 && y <= 2100)) errs.year = "Enter a valid year";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const res = await crmPost<Timesheet & { id: number }>("/api/timesheets", {
        project_id: Number(projectId),
        employee_id: Number(employeeId),
        project_employee_id: initial?.project_employee_id ?? undefined,
        month: Number(month),
        year: y,
        generate_days: generateDays,
      });
      onDone(res.data);
    } catch (e: any) {
      onError(e?.message || "Failed to create timesheet");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (locked && !autoStarted && projectId && employeeId) {
      setAutoStarted(true);
      submit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, autoStarted, projectId, employeeId]);

  if (locked && busy) {
    return (
      <Modal title="Add Timesheet" onClose={onClose} fullScreen>
        <Spinner label="Creating timesheet with day grid…" />
      </Modal>
    );
  }

  return (
    <Modal title={locked ? "Add Timesheet" : "New Timesheet"} onClose={onClose} fullScreen>
      <div className="space-y-3">
        <Field label="Project" required error={errors.project}>
          <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={locked}>
            <option value="">Select project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Employee" required error={errors.employee}>
          <select className={inputCls} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={locked || !projectId}>
            <option value="">{projectId ? "Select employee…" : "Select a project first"}</option>
            {employeeOptions.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Month">
            <select className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)} disabled={locked}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </Field>
          <Field label="Year" error={errors.year}>
            <input type="number" min={2000} max={2100} className={inputCls} value={year} onChange={(e) => setYear(e.target.value)} disabled={locked} />
          </Field>
        </div>
        {!locked && (
          <p className="text-xs text-muted">A full month day grid will be generated automatically.</p>
        )}
      </div>
      {!locked && (
        <div className="mt-5 flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={btnPrimary} onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create timesheet"}</button>
        </div>
      )}
    </Modal>
  );
}

/* ================================================================ DETAIL PAGE */

export function TimesheetDetailPage() {
  const { id } = useCrmParams();
  const isStaff = useHasRole("HR", "Finance", "RMG");
  const [ts, setTs] = useState<TimesheetDetail | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [leaveTypes, setLeaveTypes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<"submit" | "approve" | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();

  const defaultPolicy: BillingPolicy = {
    week_off_billable: false,
    leave_billable: false,
    holidays_billable: false,
    min_hours_full_day: 8,
    min_hours_half_day: 4,
  };

  const inferDayType = (e: Entry): string => {
    if (e.day_type) return e.day_type;
    if (e.attendance_status === "Holiday") return "Holiday";
    if (!e.is_working) return "Week_Off";
    return "Working";
  };

  const toRows = (list: Entry[], policy: BillingPolicy, maxDay?: number | null): EntryRow[] =>
    list.map((e) => {
      const day_type = inferDayType(e);
      const base = {
        entry_date: e.entry_date,
        day_of_week: e.day_of_week || weekday(e.entry_date),
        day_type,
        is_working: day_type === "Working",
        hours_worked: e.hours_worked != null ? String(e.hours_worked) : "0",
        attendance_status: e.attendance_status || (day_type === "Holiday" ? "Holiday" : day_type === "Week_Off" ? "Week_Off" : "Present"),
        leave_type: e.leave_type || "",
        leave_period: e.leave_period || "",
        location: e.location || "Onsite",
        view_flag: !!e.view_flag,
        entry_project_id: e.entry_project_id ? String(e.entry_project_id) : "",
      };
      const live = dirty
        ? computeBillables(base, policy, maxDay)
        : {
            billable_hours: e.billable_hours ?? 0,
            billable_day: e.billable_day ?? billableDayFromHours(e.billable_hours ?? 0),
          };
      return {
        ...base,
        billable_hours: live.billable_hours,
        billable_days: e.billable_days,
        billable_day: live.billable_day,
      };
    });

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await crmGet<TimesheetDetail>(`/api/timesheets/${id}`);
      setTs(res.data);
      const policy = res.data.billing_policy || defaultPolicy;
      setEntries(toRows(res.data.entries || [], policy, res.data.max_billable_hours_day));
      setDirty(false);
      if (res.data.summary) setSummary(res.data.summary);
      else crmGet<Summary>(`/api/timesheets/${id}/summary`).then((s) => setSummary(s.data)).catch(() => {});
      if (!res.data.project_title || !res.data.employee_name) {
        crmGet<any>(`/api/projects/${res.data.project_id}`)
          .then((p) => {
            setProjectName(p.data?.name || "");
            const member = (p.data?.team || []).find((t: any) => t.employee_id === res.data.employee_id);
            if (member?.employee_name) setEmployeeName(member.employee_name);
          })
          .catch(() => {});
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load timesheet");
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    crmGet<any[]>("/api/leave-policy-types?limit=100")
      .then((r) => setLeaveTypes((r.data || []).map((t: any) => t.name).filter(Boolean)))
      .catch(() => {});
  }, []);

  const holidaySet = useMemo(() => new Set(ts?.holiday_dates || []), [ts?.holiday_dates]);
  const policy = ts?.billing_policy || defaultPolicy;

  const liveSummary = useMemo(() => {
    const hours = entries.reduce((s, e) => s + Number(e.hours_worked || 0), 0);
    const billableHours = entries.reduce((s, e) => s + (e.billable_hours || 0), 0);
    const actualBillableDay = billableDayFromHours(billableHours);
    const workingDays = entries.filter((e) => e.day_type === "Working").length;
    return {
      hours,
      billableHours,
      actualBillableDay,
      totalLeaveDays: round2(workingDays - actualBillableDay),
    };
  }, [entries]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!ts) return <Spinner label="Loading timesheet…" />;

  const editable = ts.status === "Draft" || ts.status === "Rejected";

  const applyDayType = (row: EntryRow, dayType: string): Partial<EntryRow> => {
    if (dayType === "Holiday") {
      return { day_type: dayType, is_working: false, hours_worked: "0", attendance_status: "Holiday", leave_type: "", leave_period: "" };
    }
    if (dayType === "Week_Off") {
      return { day_type: dayType, is_working: false, hours_worked: "0", attendance_status: "Week_Off", leave_type: "", leave_period: "" };
    }
    return { day_type: "Working", is_working: true, hours_worked: row.hours_worked === "0" ? "8.5" : row.hours_worked, attendance_status: "Present" };
  };

  const updateEntry = (idx: number, patch: Partial<EntryRow>) => {
    setEntries((prev) => prev.map((row, i) => {
      if (i !== idx) return row;
      let next = { ...row, ...patch };
      if (patch.day_type) next = { ...next, ...applyDayType(next, patch.day_type) };
      if (patch.attendance_status === "Leave" && !next.leave_type) next.leave_type = "";
      if (patch.attendance_status && patch.attendance_status !== "Leave") {
        next.leave_type = "";
        next.leave_period = "";
      }
      next = applyHoursAttendanceRule(next);
      const live = computeBillables(next, policy, ts.max_billable_hours_day);
      return { ...next, billable_hours: live.billable_hours, billable_day: live.billable_day };
    }));
    setDirty(true);
  };

  const saveEntries = async () => {
    setSaving(true);
    try {
      // Full-list upsert; the server recomputes billable hours/days.
      await crmPost(`/api/timesheets/${ts.id}/entries`, entries.map((e) => ({
        entry_date: e.entry_date,
        day_type: e.day_type,
        is_working: e.is_working,
        hours_worked: Number(e.hours_worked || 0),
        attendance_status: e.attendance_status,
        leave_type: e.attendance_status === "Leave" && e.leave_type && e.leave_type !== "Not Applied"
          ? e.leave_type : null,
        leave_period: e.leave_period || null,
        location: e.location || "Onsite",
        view_flag: e.view_flag,
        entry_project_id: e.entry_project_id ? Number(e.entry_project_id) : null,
      })));
      showToast("Entries saved");
      await load(); // refresh server-computed billables + summary
    } catch (e: any) {
      showToast(e?.message || "Failed to save entries", "err");
    } finally {
      setSaving(false);
    }
  };

  const doWorkflow = async (action: "submit" | "approve") => {
    setBusy(true);
    try {
      const res = await crmPost(`/api/timesheets/${ts.id}/${action}`);
      showToast(res.message || `Timesheet ${action === "submit" ? "submitted" : "approved"}`);
      setConfirm(null);
      await load();
    } catch (e: any) {
      showToast(e?.message || `Failed to ${action} timesheet`, "err");
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const cellCls = "px-2 py-1.5";
  const miniInput = `${inputCls} !px-2 !py-1 text-xs`;

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------ header */}
      <div className="flex flex-wrap items-center gap-3">
        <CrmLink to="timesheets" className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300">
          Timesheets
        </CrmLink>
        <span className="text-muted">/</span>
        <h1 className="text-display text-xl font-bold text-primary">
          {MONTHS[(ts.month || 1) - 1]} {ts.year}
        </h1>
        <StatusBadge status={ts.status} label={tsStatusLabel(ts.status)} />
      </div>

      {/* ------------------------------------------------ header info card (Tab 9) */}
      <div className="glass rounded-panel p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
          <LabeledValue label="Date" value={fmtDate(ts.created_at)} />
          <LabeledValue
            label="Project Title"
            value={
              <CrmLink
                to={`projects/${ts.project_id}`}
                className={`rounded-control font-semibold text-brand-600 hover:underline dark:text-brand-300 ${focusRing}`}
              >
                {ts.project_title || projectName || `#${ts.project_id}`}
              </CrmLink>
            }
          />
          <LabeledValue label="Branch" value={ts.branch_name || "—"} />
          <LabeledValue label="Timesheet Period" value={ts.timesheet_period || fmtPeriod(ts.period_start_date, ts.period_end_date)} />
          <LabeledValue label="Project Employee" value={ts.employee_name || employeeName || `#${ts.employee_id}`} />
          <LabeledValue label="Project Type" value={pretty(ts.project_type)} />
          <LabeledValue label="Employee ID" value={ts.employee_code || "—"} />
          <LabeledValue label="Customer" value={ts.customer_name || "—"} />
          <LabeledValue label="Start Date" value={fmtDate(ts.period_start_date)} />
          <LabeledValue label="End Date" value={fmtDate(ts.period_end_date)} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-subtle pt-4">
          <StatusBadge status={ts.status} label={tsStatusLabel(ts.status)} />
          {editable && (
            <>
              <button className={btnPrimary} onClick={saveEntries} disabled={saving || !dirty}>
                <Save size={15} /> {saving ? "Saving…" : "Save entries"}
              </button>
              <button className={btnSecondary} onClick={() => setConfirm("submit")} disabled={saving}>
                <Send size={15} /> Submit
              </button>
            </>
          )}
          {ts.status === "Submitted" && isStaff && (
            <>
              <button className={btnPrimary} onClick={() => setConfirm("approve")}>
                <Check size={15} /> Approve
              </button>
              <button className={btnDanger} onClick={() => setShowReject(true)}>
                <X size={15} /> Reject
              </button>
            </>
          )}
        </div>
      </div>

      {ts.status === "Rejected" && ts.rejection_reason && (
        <div className="rounded-card border border-subtle bg-danger-soft px-4 py-3 text-sm text-danger">
          <span className="font-bold">Rejected:</span> {ts.rejection_reason}
        </div>
      )}

      {/* ------------------------------------------------ timesheet details (daily grid) */}
      <div className="elev-1 overflow-hidden rounded-panel">
        <div className="border-b border-subtle px-4 py-3 text-sm font-bold text-primary">Timesheet Details</div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm lg:min-w-0">
          <thead>
            <tr className="border-b border-subtle text-left text-xs font-bold uppercase tracking-wide text-muted">
              <th className={cellCls}>S No</th>
              <th className={cellCls}>Date</th>
              <th className={cellCls}>Week Day</th>
              <th className={cellCls}>Working/Not Working</th>
              <th className={cellCls}>Hours Worked</th>
              <th className={cellCls}>Attendance</th>
              <th className={cellCls}>Leave Applied</th>
              <th className={cellCls}>Leave Period</th>
              <th className={`${cellCls} text-right`}>Billable Hours</th>
              <th className={`${cellCls} text-right`}>Billable Day</th>
              <th className={cellCls}>View</th>
              <th className={cellCls}>Location</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-muted">
                  No entries. {editable ? "This timesheet was created without pre-generated days." : ""}
                </td>
              </tr>
            )}
            {entries.map((e, i) => {
              const isLeave = e.attendance_status === "Leave";
              const isCalendarHoliday = holidaySet.has(e.entry_date) || e.day_type === "Holiday";
              const attendanceOptions = isCalendarHoliday
                ? ["Holiday"]
                : e.day_type === "Week_Off"
                  ? ATTENDANCE.filter((a) => ["Week_Off", "Leave", "Absent", "Half_Day"].includes(a))
                  : ATTENDANCE.filter((a) => a !== "Holiday");
              return (
                <tr
                  key={e.entry_date}
                  className={`border-b border-subtle ${e.day_type === "Working" ? "" : "bg-surface-2"}`}
                >
                  <td className={`${cellCls} text-muted`}>{i + 1}</td>
                  <td className={`${cellCls} whitespace-nowrap font-semibold text-primary`}>
                    {entryDate(e.entry_date)}
                  </td>
                  <td className={`${cellCls} whitespace-nowrap text-secondary`}>{e.day_of_week}</td>
                  <td className={cellCls}>
                    <select
                      className={`${miniInput} !w-28`}
                      value={e.day_type}
                      disabled={!editable || isCalendarHoliday}
                      onChange={(ev) => updateEntry(i, { day_type: ev.target.value })}
                    >
                      {DAY_TYPES.map((d) => (
                        <option key={d} value={d} disabled={d === "Holiday" && !isCalendarHoliday}>{dayTypeLabel(d)}</option>
                      ))}
                    </select>
                  </td>
                  <td className={cellCls}>
                    <input
                      type="number" min={0} max={24} step={0.5}
                      className={`${miniInput} !w-20`}
                      value={e.hours_worked}
                      disabled={!editable || isCalendarHoliday || e.day_type !== "Working"}
                      onChange={(ev) => updateEntry(i, { hours_worked: ev.target.value })}
                      onBlur={(ev) => {
                        const parsed = parseFloat(ev.target.value);
                        if (!Number.isNaN(parsed)) {
                          updateEntry(i, { hours_worked: String(parsed) });
                        }
                      }}
                    />
                  </td>
                  <td className={cellCls}>
                    {isCalendarHoliday ? (
                      <span className="text-sm font-medium text-secondary" title="Locked from client holiday calendar">
                        Holiday
                      </span>
                    ) : (
                      <select
                        className={`${miniInput} !w-28`}
                        value={e.attendance_status}
                        disabled={!editable}
                        onChange={(ev) => updateEntry(i, {
                          attendance_status: ev.target.value,
                          ...(ev.target.value !== "Leave" ? { leave_type: "", leave_period: "" } : {}),
                        })}
                      >
                        {attendanceOptions.map((a) => (
                          <option key={a} value={a}>{pretty(a)}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className={cellCls}>
                    <select
                      className={`${miniInput} !w-28`}
                      value={e.leave_type || "Not Applied"}
                      disabled={!editable || !isLeave}
                      onChange={(ev) => updateEntry(i, {
                        leave_type: ev.target.value === "Not Applied" ? "" : ev.target.value,
                      })}
                    >
                      <option value="Not Applied">Not Applied</option>
                      {leaveTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className={cellCls}>
                    <select
                      className={`${miniInput} !w-24`}
                      value={e.leave_period || ""}
                      disabled={!editable || !isLeave}
                      onChange={(ev) => updateEntry(i, { leave_period: ev.target.value })}
                    >
                      <option value="">NA</option>
                      {LEAVE_PERIODS.filter(Boolean).map((p) => (
                        <option key={p} value={p}>{p === "Half_AM" ? "Half AM" : p === "Half_PM" ? "Half PM" : pretty(p)}</option>
                      ))}
                    </select>
                  </td>
                  <td className={`${cellCls} text-right font-semibold text-secondary`}>
                    {e.billable_hours ?? "—"}
                  </td>
                  <td className={`${cellCls} text-right font-semibold text-secondary`}>
                    {e.billable_day ?? "—"}
                  </td>
                  <td className={cellCls}>
                    <input
                      type="checkbox"
                      checked={e.view_flag}
                      disabled={!editable}
                      onChange={(ev) => updateEntry(i, { view_flag: ev.target.checked })}
                    />
                  </td>
                  <td className={cellCls}>
                    <select
                      className={`${miniInput} !w-32`}
                      value={e.location || "Onsite"}
                      disabled={!editable}
                      onChange={(ev) => updateEntry(i, { location: ev.target.value })}
                    >
                      {LOCATIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {dirty && (
          <div className="border-t border-subtle bg-warning-soft px-4 py-2 text-xs font-semibold text-warning">
            Unsaved changes — billable hours/days are recomputed by the server after saving.
          </div>
        )}
      </div>

      {/* ------------------------------------------------ invoice details (collapsible) */}
      <InvoiceDetailsSection timesheetId={ts.id} showToast={showToast} />

      {/* ------------------------------------------------ summary / calculated fields */}
      <div className="glass rounded-panel p-4 sm:p-5">
        <h2 className="text-sm font-bold text-primary">Summary</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <Stat label="Total Days" value={num(summary?.total_days)} />
          <Stat label="Total Working Days" value={num(summary?.working_days)} />
          <Stat label="Total Comp-Off Days" value={num(summary?.comp_off_days)} />
          <Stat label="Total No of Hours Worked" value={num(dirty ? liveSummary.hours : summary?.total_hours_worked ?? summary?.hours_worked)} />
          <Stat label="Actual Billable Hours" value={num(dirty ? liveSummary.billableHours : summary?.actual_billable_hours)} />
          <Stat label="Total Week off" value={num(summary?.total_week_off)} />
          <Stat label="Total Billable Days" value={num(summary?.total_billable_days)} />
          <Stat label="Total Leave Days" value={num(dirty ? liveSummary.totalLeaveDays : summary?.total_leave_days ?? summary?.leave_days)} />
          <Stat label="Total No of Days Worked" value={num(summary?.total_no_of_days_worked)} />
          <Stat label="Actual Billable Day" value={num(dirty ? liveSummary.actualBillableDay : summary?.actual_billable_day ?? summary?.actual_billable_days)} />
          <Stat label="Total Holiday" value={num(summary?.holidays)} />
          <Stat label="Total Billable Hours" value={num(summary?.total_billable_hours)} />
          <Stat label="Total Leave Billable Days" value={num(summary?.total_leave_billable_days)} />
          <Stat label="Comp-Off Earned" value={num(summary?.comp_off_earned)} />
          <Stat label="Comp-Off Credited" value={num(summary?.comp_off_credited)} />
        </div>
        <div className="mt-4 grid gap-x-6 gap-y-4 border-t border-subtle pt-4 sm:grid-cols-3">
          <LabeledValue
            label="Reason for Rejection"
            value={
              (summary?.reason_for_rejection || ts.rejection_reason)
                ? <span className="text-danger">{summary?.reason_for_rejection || ts.rejection_reason}</span>
                : "—"
            }
            wrap
          />
          <LabeledValue
            label="Approved Time"
            value={
              summary?.approved_time?.approved_at
                ? `${new Date(summary.approved_time.approved_at).toLocaleString()}${
                    summary.approved_time.approver_name ? ` by ${summary.approved_time.approver_name}` : ""
                  }`
                : ts.approved_at
                  ? new Date(ts.approved_at).toLocaleString()
                  : "—"
            }
            wrap
          />
          <LabeledValue
            label="Attachments"
            value={
              <AttachmentList
                timesheetId={ts.id}
                attachments={(ts as any).attachments}
                onChange={load}
                showToast={showToast}
              />
            }
            wrap
          />
        </div>
      </div>

      {/* ------------------------------------------------ activity history (collapsible) */}
      <ActivityHistorySection timesheetId={ts.id} />

      {/* ------------------------------------------------ modals */}
      {confirm === "submit" && (
        <ConfirmModal
          title="Submit timesheet"
          message={<>Submit this timesheet for {MONTHS[(ts.month || 1) - 1]} {ts.year}? {dirty && <b>You have unsaved entry changes — save them first if they should be included.</b>}</>}
          confirmLabel="Submit"
          busy={busy}
          onConfirm={() => doWorkflow("submit")}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === "approve" && (
        <ConfirmModal
          title="Approve timesheet"
          message="Approve this timesheet? Approved timesheets can no longer be edited."
          confirmLabel="Approve"
          busy={busy}
          onConfirm={() => doWorkflow("approve")}
          onClose={() => setConfirm(null)}
        />
      )}
      {showReject && (
        <RejectModal
          timesheetId={ts.id}
          onClose={() => setShowReject(false)}
          onDone={() => { setShowReject(false); showToast("Timesheet rejected"); load(); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
      {toast}
    </div>
  );
}

/** Read-only labeled value used by the header card and summary footer. */
function LabeledValue({ label, value, wrap }: { label: string; value: React.ReactNode; wrap?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold text-primary ${wrap ? "" : "truncate"}`}>{value ?? "—"}</div>
    </div>
  );
}

/** Summary "calculated field" tile (v3 glass KPI tile). */
function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="glass fx-gradient-border fx-lift rounded-card px-3 py-2.5">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 font-display text-lg font-bold tabular-nums text-primary">{value}</div>
    </div>
  );
}

/** Collapsible "Invoice Details" card — lazily loads the invoice preview on first
 * open; Finance/Admin can generate the invoice when the server says can_generate. */
function InvoiceDetailsSection({
  timesheetId, showToast,
}: {
  timesheetId: number;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const canInvoice = useHasRole("Finance", "RMG");
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [confirmGen, setConfirmGen] = useState(false);
  const [generating, setGenerating] = useState(false);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<InvoicePreview>(`/api/timesheets/${timesheetId}/invoice-preview`);
      setPreview(res.data);
    } catch (e: any) {
      setPreview(null);
      setError(e?.message || "Failed to load invoice preview");
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [timesheetId]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded) loadPreview();
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await crmPost<{ invoice: any; timesheet_id: number }>(
        `/api/timesheets/${timesheetId}/generate-invoice`,
      );
      showToast(res.message || "Invoice generated");
      setConfirmGen(false);
      await loadPreview();
    } catch (e: any) {
      showToast(e?.message || "Failed to generate invoice", "err");
      setConfirmGen(false);
    } finally {
      setGenerating(false);
    }
  };

  const cell = "px-3 py-2";
  const invoiceCell = preview?.linked_invoice ? (
    <span className="inline-flex flex-wrap items-center gap-2 whitespace-nowrap">
      <CrmLink
        to={`invoices/${preview.linked_invoice.id}`}
        className={`rounded-control font-semibold text-brand-600 hover:underline dark:text-brand-300 ${focusRing}`}
      >
        {preview.linked_invoice.invoice_number}
      </CrmLink>
      <StatusBadge status={preview.linked_invoice.payment_status} />
    </span>
  ) : (
    <span className="text-muted">—</span>
  );

  return (
    <div className="elev-1 overflow-hidden rounded-panel">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className={`flex w-full items-center justify-between gap-2 rounded-panel px-4 py-3 text-left transition-colors duration-base ease-smooth hover:bg-surface-2 ${focusRing}`}
      >
        <span className="flex items-center gap-2 text-sm font-bold text-primary">
          <Receipt size={16} className="text-muted" aria-hidden /> Invoice Details
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-muted transition-transform duration-base ease-smooth ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="invoice-body"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-subtle px-4 py-4">
              {loading ? (
                <Spinner label="Loading invoice preview…" />
              ) : error ? (
                <ErrorBox error={error} onRetry={loadPreview} />
              ) : preview ? (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-max text-sm lg:min-w-0">
                      <thead>
                        <tr className="border-b border-subtle text-left text-xs font-bold uppercase tracking-wide text-muted">
                          <th className={cell}>S.No</th>
                          <th className={cell}>Description of Service</th>
                          <th className={`${cell} text-right`}>Monthly Cost</th>
                          <th className={`${cell} text-right`}>Total Billed Hour / Qty</th>
                          <th className={`${cell} text-right`}>Rate Per Hour / Day</th>
                          <th className={`${cell} text-right`}>Leave</th>
                          <th className={`${cell} text-right`}>Amount</th>
                          <th className={cell}>Invoice</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.line_items.length === 0 && (
                          <tr>
                            <td colSpan={8} className="px-4 py-6 text-center text-muted">No invoice line items</td>
                          </tr>
                        )}
                        {preview.line_items.map((li) => (
                          <tr key={li.s_no} className="border-b border-subtle">
                            <td className={`${cell} text-muted`}>{li.s_no}</td>
                            <td className={`${cell} font-semibold text-primary`}>{li.description}</td>
                            <td className={`${cell} text-right text-secondary`}>{inr(li.monthly_cost)}</td>
                            <td className={`${cell} text-right text-secondary`}>{li.total_billed_qty}</td>
                            <td className={`${cell} text-right text-secondary`}>{inr(li.rate_per_unit)}</td>
                            <td className={`${cell} text-right text-secondary`}>{li.leave_billable_days}</td>
                            <td className={`${cell} text-right font-semibold text-primary`}>{inr(li.amount)}</td>
                            <td className={cell}>{invoiceCell}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-strong">
                          <td colSpan={6} className={`${cell} text-right text-xs font-bold uppercase tracking-wide text-muted`}>
                            Sub-total
                          </td>
                          <td className={`${cell} text-right text-base font-bold text-primary`}>
                            {inr(preview.totals.sub_total)}
                          </td>
                          <td className={cell} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {canInvoice && (
                    <div className="mt-4 flex justify-end">
                      <button
                        className={btnPrimary}
                        disabled={!preview.can_generate || generating}
                        onClick={() => setConfirmGen(true)}
                      >
                        <FilePlus2 size={15} /> {generating ? "Generating…" : "Generate Invoice"}
                      </button>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {confirmGen && (
        <ConfirmModal
          title="Generate invoice"
          message="Generate an invoice from this timesheet? Line items and totals will match the preview above."
          confirmLabel="Generate"
          busy={generating}
          onConfirm={generate}
          onClose={() => setConfirmGen(false)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- activity log */

type ActivityEntry = {
  id: number;
  comment: string | null;
  timestamp: string | null;
  action_type: string | null;
  user: string | null;
  user_id: number | null;
};

/** Collapsible "Activity History" card — lazily loads the timesheet audit
 * trail on first open (same pattern as the Invoice Details section). */
function ActivityHistorySection({ timesheetId }: { timesheetId: number }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<ActivityEntry[]>([]);

  const loadLog = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<ActivityEntry[]>(`/api/timesheets/${timesheetId}/activity-log`);
      setRows(res.data || []);
    } catch (e: any) {
      setRows([]);
      setError(e?.message || "Failed to load activity history");
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [timesheetId]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded) loadLog();
  };

  const cell = "px-3 py-2";

  return (
    <div className="elev-1 overflow-hidden rounded-panel">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className={`flex w-full items-center justify-between gap-2 rounded-panel px-4 py-3 text-left transition-colors duration-base ease-smooth hover:bg-surface-2 ${focusRing}`}
      >
        <span className="flex items-center gap-2 text-sm font-bold text-primary">
          <History size={16} className="text-muted" aria-hidden /> Activity History
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-muted transition-transform duration-base ease-smooth ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="activity-body"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-subtle px-4 py-4">
              {loading ? (
                <Spinner label="Loading activity history…" />
              ) : error ? (
                <ErrorBox error={error} onRetry={loadLog} />
              ) : rows.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted">No activity recorded yet</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-max text-sm lg:min-w-0">
                    <thead>
                      <tr className="border-b border-subtle text-left text-xs font-bold uppercase tracking-wide text-muted">
                        <th className={cell}>Comment</th>
                        <th className={cell}>Date-Time</th>
                        <th className={cell}>Action</th>
                        <th className={cell}>User</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((a) => (
                        <tr key={a.id} className="border-b border-subtle">
                          <td className={`${cell} text-secondary`}>{a.comment || "—"}</td>
                          <td className={`${cell} whitespace-nowrap text-secondary`}>
                            {a.timestamp ? new Date(a.timestamp).toLocaleString() : "—"}
                          </td>
                          <td className={cell}>
                            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-secondary ring-1 ring-inset ring-black/5 dark:ring-white/10">
                              {pretty(a.action_type)}
                            </span>
                          </td>
                          <td className={`${cell} font-semibold text-primary`}>{a.user || (a.user_id ? `#${a.user_id}` : "—")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------------- RMG report tabs */

function groupByProjectTitle<T extends { project_title?: string | null }>(rows: T[]): [string, T[]][] {
  const map = new Map<string, T[]>();
  rows.forEach((r) => {
    const key = r.project_title || "Other";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  });
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function TimesheetDueReport({
  showToast, onAdd,
}: {
  showToast: (msg: string, kind?: "ok" | "err") => void;
  onAdd: (row: ReportRow) => void;
}) {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<ReportRow[]>("/api/timesheets/reports/due");
      setRows(res.data || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load due report");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const cell = "px-3 py-2";
  const groups = groupByProjectTitle(rows);

  if (loading) return <Spinner label="Loading timesheet due report…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;

  return (
    <div className="space-y-4">
      {groups.length === 0 ? (
        <div className="rounded-panel border border-subtle px-4 py-8 text-center text-sm text-muted">
          No due timesheets — all assignments are submitted or approved.
        </div>
      ) : groups.map(([title, items]) => (
        <div key={title} className="elev-1 overflow-hidden rounded-panel">
          <div className="border-b border-subtle px-4 py-3 text-sm font-bold text-primary">{title}</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-subtle text-left text-xs font-bold uppercase tracking-wide text-muted">
                  <th className={cell}>Add Timesheet</th>
                  <th className={cell}>Project Employee</th>
                  <th className={cell}>Project Type</th>
                  <th className={cell}>Customer</th>
                  <th className={cell}>Timesheet Start Date</th>
                  <th className={cell}>Timesheet End Date</th>
                  <th className={cell}>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r, i) => (
                  <tr key={`${r.project_id}-${r.employee_id}-${r.month}-${i}`} className="border-b border-subtle">
                    <td className={cell}>
                      {r.timesheet_id ? (
                        <CrmLink to={`timesheets/${r.timesheet_id}`} className={`${btnSecondary} !px-2 !py-1 text-xs`}>
                          Open
                        </CrmLink>
                      ) : (
                        <button type="button" className={`${btnPrimary} !px-2 !py-1 text-xs`} onClick={() => onAdd(r)}>
                          Add Timesheet
                        </button>
                      )}
                    </td>
                    <td className={`${cell} font-semibold text-primary`}>{r.project_employee_name || "—"}</td>
                    <td className={cell}>{pretty(r.project_type)}</td>
                    <td className={cell}>{r.customer_name || "—"}</td>
                    <td className={cell}>{fmtDate(r.period_start)}</td>
                    <td className={cell}>{fmtDate(r.period_end)}</td>
                    <td className={cell}><StatusBadge status={r.status_label || r.status} label={tsStatusLabel(r.status_label || r.status)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function SubmitForApprovalReport({ showToast }: { showToast: (msg: string, kind?: "ok" | "err") => void }) {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<ReportRow[]>("/api/timesheets/reports/for-submission");
      setRows(res.data || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load submission report");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (r: ReportRow) => {
    const id = r.id ?? r.timesheet_id;
    if (!id) return;
    setBusyId(id);
    try {
      const res = await crmPost(`/api/timesheets/${id}/submit`);
      showToast(res.message || "Submitted for approval");
      await load();
    } catch (e: any) {
      showToast(e?.message || "Submit failed", "err");
    } finally {
      setBusyId(null);
    }
  };

  const cell = "px-3 py-2";
  if (loading) return <Spinner label="Loading submission report…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;

  return (
    <div className="elev-1 overflow-hidden rounded-panel">
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-subtle text-left text-xs font-bold uppercase tracking-wide text-muted">
              <th className={cell}>Action</th>
              <th className={cell}>Status</th>
              <th className={cell}>Timesheet Period</th>
              <th className={cell}>Actual Billable Hours</th>
              <th className={cell}>Actual Billable Day</th>
              <th className={cell}>Date</th>
              <th className={cell}>Project Title</th>
              <th className={cell}>Project Type</th>
              <th className={cell}>Total Hours Worked</th>
              <th className={cell}>Total Leave Billable Days</th>
              <th className={cell}>Reason for Rejection</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-muted">No timesheets pending submission</td></tr>
            )}
            {rows.map((r) => {
              const id = r.id ?? r.timesheet_id!;
              const isRejected = r.status === "Rejected";
              return (
                <tr key={id} className="border-b border-subtle">
                  <td className={cell}>
                    <button
                      type="button"
                      className={`${btnPrimary} !px-2 !py-1 text-xs`}
                      disabled={busyId === id}
                      onClick={() => submit(r)}
                    >
                      {busyId === id ? "…" : isRejected ? "Resubmit" : "Submit for Approval"}
                    </button>
                  </td>
                  <td className={cell}><StatusBadge status={r.status} label={r.status_label || tsStatusLabel(r.status)} /></td>
                  <td className={cell}>{r.timesheet_period || fmtPeriod(r.period_start, r.period_end)}</td>
                  <td className={cell}>{num(r.actual_billable_hours)}</td>
                  <td className={cell}>{num(r.actual_billable_day)}</td>
                  <td className={cell}>{fmtDate(r.date || r.created_at)}</td>
                  <td className={cell}>{r.project_title || "—"}</td>
                  <td className={cell}>{pretty(r.project_type)}</td>
                  <td className={cell}>{num(r.total_hours_worked)}</td>
                  <td className={cell}>{num(r.total_leave_billable_days)}</td>
                  <td className={cell}>{r.reason_for_rejection || r.rejection_reason || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TimesheetApprovalsReport({ showToast }: { showToast: (msg: string, kind?: "ok" | "err") => void }) {
  const canAct = useHasRole("HR", "Finance", "RMG");
  const canInvoice = useHasRole("Finance", "RMG");
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejectId, setRejectId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<ReportRow[]>("/api/timesheets/reports/approvals");
      setRows(res.data || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load approvals report");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (id: number, action: "approve" | "generate-invoice") => {
    setBusyId(id);
    try {
      const res = await crmPost(`/api/timesheets/${id}/${action}`);
      showToast(res.message || "Done");
      await load();
    } catch (e: any) {
      showToast(e?.message || "Action failed", "err");
    } finally {
      setBusyId(null);
    }
  };

  const cell = "px-3 py-2";
  if (loading) return <Spinner label="Loading approvals report…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;

  return (
    <>
      <div className="elev-1 overflow-hidden rounded-panel">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-subtle text-left text-xs font-bold uppercase tracking-wide text-muted">
                <th className={cell}>Actions</th>
                <th className={cell}>Status</th>
                <th className={cell}>Date</th>
                <th className={cell}>Project Type</th>
                <th className={cell}>Project Employee</th>
                <th className={cell}>Period</th>
                <th className={cell}>Total Hours Worked</th>
                <th className={cell}>Total Leave Billable Days</th>
                <th className={cell}>Actual Billable Day</th>
                <th className={cell}>Total Leave Days</th>
                <th className={cell}>Attachments</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-muted">No timesheets awaiting approval</td></tr>
              )}
              {rows.map((r) => {
                const id = r.id ?? r.timesheet_id!;
                const submitted = r.status === "Submitted";
                const approved = r.status === "Approved";
                const hasInvoice = !!r.invoice;
                return (
                  <tr key={id} className="border-b border-subtle">
                    <td className={cell}>
                      <div className="flex flex-wrap gap-1">
                        {canAct && submitted && (
                          <>
                            <button type="button" className={`${btnPrimary} !px-2 !py-1 text-xs`} disabled={busyId === id}
                              onClick={() => act(id, "approve")}>Approve</button>
                            <button type="button" className={`${btnDanger} !px-2 !py-1 text-xs`} disabled={busyId === id}
                              onClick={() => setRejectId(id)}>Reject</button>
                          </>
                        )}
                        {canInvoice && (
                          <button type="button"
                            className={`${btnSecondary} !px-2 !py-1 text-xs`}
                            disabled={!approved || hasInvoice || busyId === id}
                            onClick={() => act(id, "generate-invoice")}
                          >
                            Generate Invoice
                          </button>
                        )}
                      </div>
                    </td>
                    <td className={cell}><StatusBadge status={r.status} label={r.status_label || tsStatusLabel(r.status)} /></td>
                    <td className={cell}>{fmtDate(r.date || r.created_at)}</td>
                    <td className={cell}>{pretty(r.project_type)}</td>
                    <td className={cell}>{r.project_employee_name || "—"}</td>
                    <td className={cell}>{r.timesheet_period || fmtPeriod(r.period_start, r.period_end)}</td>
                    <td className={cell}>{num(r.total_hours_worked)}</td>
                    <td className={cell}>{num(r.total_leave_billable_days)}</td>
                    <td className={cell}>{num(r.actual_billable_day)}</td>
                    <td className={cell}>{num(r.total_leave_days)}</td>
                    <td className={cell}>
                      <AttachmentList timesheetId={id} attachments={r.attachments} onChange={load} showToast={showToast} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {rejectId != null && (
        <RejectModal
          timesheetId={rejectId}
          onClose={() => setRejectId(null)}
          onDone={() => { setRejectId(null); showToast("Timesheet rejected"); load(); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
    </>
  );
}

function AttachmentList({
  timesheetId, attachments, onChange, showToast,
}: {
  timesheetId: number;
  attachments?: AttachmentRow[];
  onChange: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const [local, setLocal] = useState<AttachmentRow[]>(attachments || []);
  useEffect(() => { setLocal(attachments || []); }, [attachments]);

  const refresh = async () => {
    try {
      const res = await crmGet<AttachmentRow[]>(`/api/timesheets/${timesheetId}/attachments`);
      setLocal(res.data || []);
      onChange();
    } catch { /* ignore */ }
  };

  return (
    <div className="flex flex-col gap-1 min-w-[10rem]">
      {local.map((a) => (
        <span key={`${a.id}-${a.file_url}`} className="flex items-center gap-1 text-xs">
          <FileLink url={a.file_url} label={a.file_name || "File"} />
          {a.id != null && (
            <button type="button" className="text-danger hover:underline" onClick={async () => {
              try {
                await crmDelete(`/api/timesheets/attachments/${a.id}`);
                showToast("Attachment removed");
                await refresh();
              } catch (e: any) {
                showToast(e?.message || "Delete failed", "err");
              }
            }}>×</button>
          )}
        </span>
      ))}
      <FileUploadButton
        path={`/api/timesheets/${timesheetId}/attachments`}
        label="Upload"
        onDone={() => { showToast("Uploaded"); refresh(); }}
        onError={(m) => showToast(m, "err")}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- timesheet due */

type DueRow = {
  employee_id: number;
  employee_name: string | null;
  project_id: number;
  project_title: string | null;
  month: number;
  year: number;
  status: "Missing" | "Draft" | "Rejected" | string;
};

/** "Timesheet Due" panel on the list view (HR / Finance / Admin): assignments
 * lacking a Submitted/Approved timesheet for a month/year, with an on-demand
 * "Send Reminders" action (HR/Admin) that bell-notifies the employees. */
function TimesheetDuePanel({ showToast }: { showToast: (msg: string, kind?: "ok" | "err") => void }) {
  const canView = useHasRole("HR", "Finance", "RMG");
  const canRemind = useHasRole("HR");
  const reduce = useReducedMotion();
  const now = new Date();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [rows, setRows] = useState<DueRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reminding, setReminding] = useState(false);

  const loadDue = useCallback(async (m: number, y: number) => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<DueRow[]>(`/api/timesheets/due${qs({ month: m, year: y })}`);
      setRows(res.data || []);
    } catch (e: any) {
      setRows([]);
      setError(e?.message || "Failed to load due timesheets");
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  // Lazy-load on first open; reload when the period changes while open.
  useEffect(() => {
    if (open) loadDue(month, year);
  }, [open, month, year, loadDue]);

  if (!canView) return null;

  const remind = async () => {
    setReminding(true);
    try {
      const res = await crmPost<{ due: number; notified: number }>(
        `/api/timesheets/due/remind${qs({ month, year })}`,
      );
      showToast(res.message || `${res.data?.notified ?? 0} of ${res.data?.due ?? 0} employee(s) notified`);
      loadDue(month, year);
    } catch (e: any) {
      showToast(e?.message || "Failed to send reminders", "err");
    } finally {
      setReminding(false);
    }
  };

  const cell = "px-3 py-2";
  const years: number[] = [];
  for (let y = now.getFullYear() + 1; y >= now.getFullYear() - 4; y--) years.push(y);

  return (
    <div className="elev-1 overflow-hidden rounded-panel">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-2 rounded-panel px-4 py-3 text-left transition-colors duration-base ease-smooth hover:bg-surface-2 ${focusRing}`}
      >
        <span className="flex items-center gap-2 text-sm font-bold text-primary">
          <BellRing size={16} className="text-muted" aria-hidden /> Timesheet Due
          {loaded && !loading && !error && (
            <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning ring-1 ring-inset ring-black/5 dark:ring-white/10">
              {rows.length} due
            </span>
          )}
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-muted transition-transform duration-base ease-smooth ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="due-body"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-subtle px-4 py-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <select
                  className={`${inputCls} !w-36`}
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                  aria-label="Due month"
                >
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <select
                  className={`${inputCls} !w-28`}
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  aria-label="Due year"
                >
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
                {canRemind && (
                  <button
                    className={btnPrimary}
                    onClick={remind}
                    disabled={reminding || loading || rows.length === 0}
                  >
                    <BellRing size={15} /> {reminding ? "Sending…" : "Send Reminders"}
                  </button>
                )}
              </div>
              {loading ? (
                <Spinner label="Loading due timesheets…" />
              ) : error ? (
                <ErrorBox error={error} onRetry={() => loadDue(month, year)} />
              ) : rows.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted">
                  All timesheets for {MONTHS[month - 1]} {year} are submitted or approved.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-max text-sm lg:min-w-0">
                    <thead>
                      <tr className="border-b border-subtle text-left text-xs font-bold uppercase tracking-wide text-muted">
                        <th className={cell}>Employee</th>
                        <th className={cell}>Project</th>
                        <th className={cell}>Period</th>
                        <th className={cell}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={`${r.employee_id}-${r.project_id}-${i}`} className="border-b border-subtle">
                          <td className={`${cell} font-semibold text-primary`}>{r.employee_name || `#${r.employee_id}`}</td>
                          <td className={`${cell} text-secondary`}>{r.project_title || `#${r.project_id}`}</td>
                          <td className={`${cell} whitespace-nowrap text-secondary`}>{MONTHS[(r.month || 1) - 1]} {r.year}</td>
                          <td className={cell}><StatusBadge status={r.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RejectModal({
  timesheetId, onClose, onDone, onError,
}: {
  timesheetId: number;
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
      await crmPost(`/api/timesheets/${timesheetId}/reject`, { reason: reason.trim() });
      onDone();
    } catch (e: any) {
      onError(e?.message || "Failed to reject timesheet");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Reject Timesheet" onClose={onClose}>
      <Field label="Rejection reason" required error={error}>
        <textarea
          className={`${inputCls} min-h-24`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Explain why this timesheet is being rejected (min 10 characters)…"
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
