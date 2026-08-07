/** Timesheets — list (filters + create) and detail entry page ("Tab 9: TimeSheet"):
 * header info card, daily entries grid with server-computed billables, collapsible
 * invoice-preview section (Finance/Admin can generate the invoice), summary rollup,
 * submit/approve/reject workflow. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BellRing, CalendarDays, Check, ChevronDown, Clock, FilePlus2, History, MessageSquare, Plus, Receipt, Save, Send, X } from "lucide-react";
import { crmDelete, crmGet, crmPost, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { CrmLink, crmNavigate, useCrmParams } from "../routerHooks";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { RowActions, afterListDelete } from "../components/RowActions";
import { FileLink, FileUploadButton } from "../components/FileUpload";
import {
  ConfirmModal, ErrorBox, Field, Modal, Spinner, StatusBadge,
  btnDanger, btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";
import { SectionHeaderBanner, WizardField, InfoChip } from "../components/wizard";
import { applyHoursAttendanceRule } from "../lib/timesheetAttendance";

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
  leave_reason?: string | null;
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
  comp_off_billable: boolean;
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
  /** True when opportunity.branch_id points at another customer and was suppressed. */
  branch_unlinked?: boolean;
  branch_link_message?: string | null;
  project_type?: string | null;
  timesheet_period?: string | null;
  period_start_date?: string | null;
  period_end_date?: string | null;
  employee_name?: string | null;
  employee_code?: string | null;
  project_employee_id?: number | null;
  billing_policy?: BillingPolicy | null;
  /** Project-scoped leave-type → billable; same for every employee on the project. */
  leave_billable_by_type?: Record<string, boolean>;
  /** Leave balances by type: PE pool when mapped, else employee yearly balances. */
  leave_balances_by_type?: Record<string, number>;
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
  loss_of_pay_from_leave?: number | null;
  loss_of_pay_from_absent?: number | null;
  loss_of_pay_from_half_day?: number | null;
  total_loss_of_pay_days?: number | null;
  comp_off_earned?: number | null;
  comp_off_billed?: number | null;
  comp_off_billed_hours?: number | null;
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
  comp_off_billable_qty?: number | null;
  /** Reporting only — leave excess + Absent + Half_Day; does not change billed qty. */
  loss_of_pay_days?: number | null;
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
  leave_reason: string;
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
const LOCATIONS: { value: string; label: string }[] = [
  { value: "Onsite", label: "On Site" },
  { value: "Remote", label: "Offshore/Remote" },
];

const round2 = (v: number) => Math.round(v * 100) / 100;
const billableDayFromHours = (hours: number) => (hours > 0 ? round2(hours / 8) : 0);

/** Client-side mirror of server compute_billables (invoice days use thresholds; display uses hours/8). */
function computeBillables(
  row: Pick<EntryRow, "day_type" | "is_working" | "hours_worked" | "attendance_status" | "leave_period" | "leave_type">,
  policy: BillingPolicy,
  maxDayHours?: number | null,
  leaveBillableByType?: Record<string, boolean> | null,
  paidLeaveDays?: number | null,
): { billable_hours: number; billable_day: number } {
  let hours = Number(row.hours_worked || 0);
  if (maxDayHours != null && hours > maxDayHours) hours = maxDayHours;
  const att = row.attendance_status;
  const lp = row.leave_period;
  const working = row.day_type === "Working" && row.is_working;

  if (!working && row.day_type !== "Working") {
    if (att === "Holiday") {
      // DECISION: holidays_billable > comp_off_billable > credit (mirror server).
      if (hours > 0) {
        if (!(policy.holidays_billable || policy.comp_off_billable)) {
          return { billable_hours: 0, billable_day: 0 };
        }
        return { billable_hours: hours, billable_day: billableDayFromHours(hours) };
      }
      return policy.holidays_billable
        ? {
            billable_hours: policy.min_hours_full_day,
            billable_day: billableDayFromHours(policy.min_hours_full_day),
          }
        : { billable_hours: 0, billable_day: 0 };
    }
    // Week Off: week_off_billable > comp_off_billable > credit.
    if (hours > 0 && (policy.week_off_billable || policy.comp_off_billable)) {
      return { billable_hours: hours, billable_day: billableDayFromHours(hours) };
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
    const typeName = (row.leave_type || "").trim();
    if (/loss.*pay/i.test(typeName)) {
      return { billable_hours: 0, billable_day: 0 };
    }
    const perType = leaveBillableByType && typeName
      ? leaveBillableByType[typeName]
      : undefined;
    const isLeaveBillable = perType !== undefined ? perType : policy.leave_billable;
    if (!isLeaveBillable) {
      return { billable_hours: 0, billable_day: 0 };
    }
    // Bill only the paid portion when LOP split is known.
    if (paidLeaveDays != null) {
      if (paidLeaveDays <= 0) return { billable_hours: 0, billable_day: 0 };
      const half = paidLeaveDays <= 0.5;
      const bh = half ? policy.min_hours_half_day : policy.min_hours_full_day;
      return { billable_hours: bh, billable_day: billableDayFromHours(bh) };
    }
    const half = lp === "Half_AM" || lp === "Half_PM";
    const bh = half ? policy.min_hours_half_day : policy.min_hours_full_day;
    return { billable_hours: bh, billable_day: billableDayFromHours(bh) };
  }
  if (att === "Holiday") {
    if (hours > 0) {
      if (!(policy.holidays_billable || policy.comp_off_billable)) {
        return { billable_hours: 0, billable_day: 0 };
      }
      return { billable_hours: hours, billable_day: billableDayFromHours(hours) };
    }
    return policy.holidays_billable
      ? {
          billable_hours: policy.min_hours_full_day,
          billable_day: billableDayFromHours(policy.min_hours_full_day),
        }
      : { billable_hours: 0, billable_day: 0 };
  }
  return { billable_hours: 0, billable_day: 0 };
}

/** Live mirror of server comp_off_earned / comp_off_billed (day fractions). */
function liveCompOffDayFraction(
  entries: EntryRow[],
  policy: BillingPolicy,
  mode: "earned" | "billed",
): number {
  return round2(entries.reduce((s, e) => {
    const hours = Number(e.hours_worked || 0);
    if (hours <= 0) return s;
    const isHoliday = e.day_type === "Holiday" || e.attendance_status === "Holiday";
    const isWeekOff = e.day_type === "Week_Off" || e.attendance_status === "Week_Off";
    if (!isHoliday && !isWeekOff) return s;
    const billed = isHoliday
      ? !!(policy.holidays_billable || policy.comp_off_billable)
      : !!(policy.week_off_billable || policy.comp_off_billable);
    if (mode === "billed" ? !billed : billed) return s;
    if (hours >= policy.min_hours_full_day) return s + 1;
    if (hours >= policy.min_hours_half_day) return s + 0.5;
    return s;
  }, 0));
}

const isCompOffName = (name: string) => /comp.*off/i.test(name || "");
const isLopName = (name: string) => /loss.*pay/i.test(name || "");

/** Per-row paid vs LOP split mirroring server classify_timesheet_leave_paid_vs_lop. */
function classifyLeavePaidVsLop(
  entries: EntryRow[],
  leaveBalances: Record<string, number>,
): { paidDays: number[]; lopDays: number[]; totalLop: number } {
  const runningUsed: Record<string, number> = {};
  const paidDays: number[] = [];
  const lopDays: number[] = [];
  let totalLop = 0;
  entries.forEach((e) => {
    if (e.attendance_status !== "Leave" || !e.leave_type) {
      paidDays.push(0);
      lopDays.push(0);
      return;
    }
    const half = e.leave_period === "Half_AM" || e.leave_period === "Half_PM";
    const req = half ? 0.5 : 1;
    const name = e.leave_type;
    if (isLopName(name)) {
      paidDays.push(0);
      lopDays.push(req);
      totalLop += req;
      return;
    }
    // Comp-Off capped like other paid types (no overdraft → excess is LOP).
    // Match balances case-insensitively (server LeavePolicyType names).
    const balKey = Object.keys(leaveBalances).find((k) => k.toLowerCase() === name.toLowerCase()) || name;
    const avail = Math.max(Number(leaveBalances[balKey] ?? 0), 0);
    const usedKey = balKey;
    const used = runningUsed[usedKey] || 0;
    const remaining = Math.max(avail - used, 0);
    const paid = Math.min(req, remaining);
    const lop = round2(req - paid);
    paidDays.push(paid);
    lopDays.push(lop);
    totalLop += lop;
    runningUsed[usedKey] = used + paid;
  });
  return { paidDays, lopDays, totalLop: round2(totalLop) };
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
const leavePeriodLabel = (p?: string | null) => {
  if (!p) return "—";
  if (p === "Half_AM") return "Half AM";
  if (p === "Half_PM") return "Half PM";
  if (p === "Full") return "Full Day";
  return pretty(p);
};
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
  // Force delete (also removes the linked invoice) — Sales/Sales_Head/RMG + Admin/CEO.
  const canForceDelete = useHasRole("Sales", "Sales_Head", "RMG", "Admin", "CEO");
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
              rowActions={canManage ? (r) => (
                <RowActions
                  entity="timesheet"
                  itemLabel={`${projectName(r.project_id)} · ${MONTHS[(r.month || 1) - 1]} ${r.year}`}
                  onView={() => crmNavigate(`timesheets/${r.id}`)}
                  onEdit={() => crmNavigate(`timesheets/${r.id}`)}
                  deleteUrl={`/api/timesheets/${r.id}`}
                  onDeleted={() => afterListDelete(r.id, setRows, load)}
                  notify={showToast}
                  canEdit
                  canDelete
                  {...(canForceDelete ? {
                    // Force delete: also removes the linked invoice (reverses its
                    // PO consumption) in one server transaction.
                    deactivateLabel: "Force delete (also delete invoice)",
                    deactivateSuccessMessage: "Timesheet and linked invoice deleted",
                    onDeactivate: async () => {
                      await crmDelete(`/api/timesheets/${r.id}?force=true`);
                    },
                  } : {})}
                />
              ) : undefined}
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
  projects, initial, onClose, onDone, onError,
}: {
  projects: any[];
  /** @deprecated unused — employees come from the selected project's team only */
  fallbackEmployees?: any[];
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
    setEmployeeId("");
    if (!projectId) return;
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

  const teamLoading = !!projectId && team === null && !locked;
  const employeeOptions = (team || []).map((t: any) => ({
    id: t.employee_id,
    name: t.employee_name || `#${t.employee_id}`,
    peId: t.id as number | undefined,
  }));
  const selectedPeId = employeeOptions.find((o) => String(o.id) === employeeId)?.peId
    ?? initial?.project_employee_id;

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!projectId) errs.project = "Project is required";
    if (!employeeId) errs.employee = "Employee is required";
    else if (team && team.length > 0 && !employeeOptions.some((o) => String(o.id) === employeeId)) {
      errs.employee = "Employee is not assigned to this project";
    } else if (team && team.length === 0) {
      errs.employee = "No active employees on this project — map an employee first";
    }
    const y = Number(year);
    if (!(y >= 2000 && y <= 2100)) errs.year = "Enter a valid year";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const res = await crmPost<Timesheet & { id: number }>("/api/timesheets", {
        project_id: Number(projectId),
        employee_id: Number(employeeId),
        project_employee_id: selectedPeId ?? undefined,
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
    <Modal
      title={<span className="sr-only">{locked ? "Add Timesheet" : "New Timesheet"}</span>}
      onClose={onClose}
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title={locked ? "Add Timesheet" : "New Timesheet"}
        subtitle="Pick the project, employee, and month — a full-month day grid is generated automatically."
        icon={<Clock size={20} aria-hidden />}
      >
        <div className="space-y-5">
          <WizardField label="Project" required error={errors.project} icon="building">
            <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={locked}>
              <option value="">Select project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </WizardField>
          <WizardField label="Employee" required error={errors.employee} icon="user">
            <select
              className={inputCls}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              disabled={locked || !projectId || teamLoading || (team !== null && team.length === 0)}
            >
              <option value="">
                {!projectId
                  ? "Select a project first"
                  : teamLoading
                    ? "Loading project team…"
                    : team && team.length === 0
                      ? "No employees mapped to this project"
                      : "Select employee…"}
              </option>
              {employeeOptions.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </WizardField>
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <WizardField label="Month" icon="calendar">
              <select className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)} disabled={locked}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </WizardField>
            <WizardField label="Year" error={errors.year} icon="hash" filled={!errors.year && year.trim() !== ""}>
              <input type="number" min={2000} max={2100} className={inputCls} value={year} onChange={(e) => setYear(e.target.value)} disabled={locked} />
            </WizardField>
          </div>
          {!locked && (
            <InfoChip>A full month day grid will be generated automatically.</InfoChip>
          )}
        </div>
        {!locked && (
          <div className={wizFooterRow}>
            <button className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
            <button className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`} onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create timesheet"}</button>
          </div>
        )}
      </WizFormShell>
    </Modal>
  );
}

/* ================================================================ APPLY LEAVE (grid) */

const LEAVE_PERIOD_SEGMENTS = [
  { value: "Full", label: "Full Day" },
  { value: "Half_AM", label: "Half AM" },
  { value: "Half_PM", label: "Half PM" },
] as const;

/** Small apply-leave dialog for 0-hour Absent rows (and Change on Leave rows).
 * Uses leaveBalances from the detail page — same map as billing / LOP classification.
 * Visual-only premium chrome; leave_type / leave_period / note + Apply rules unchanged. */
function TimesheetApplyLeaveDialog({
  dateLabel,
  leaveBalances,
  usedByType,
  initialType,
  initialPeriod,
  initialReason,
  onClose,
  onApply,
}: {
  dateLabel: string;
  leaveBalances: Record<string, number>;
  /** Days already requested on other Leave rows for each type (excludes this row). */
  usedByType: Record<string, number>;
  initialType?: string;
  initialPeriod?: string;
  initialReason?: string;
  onClose: () => void;
  onApply: (leaveType: string, leavePeriod: string, leaveReason: string) => void;
}) {
  const reduce = useReducedMotion();
  const typeSelectRef = useRef<HTMLSelectElement>(null);
  const available = useMemo(
    () => Object.entries(leaveBalances)
      .map(([name, bal]) => ({ name, bal: Number(bal) || 0 }))
      .filter((t) => t.bal > 0)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [leaveBalances],
  );
  const [leaveType, setLeaveType] = useState(() => {
    if (initialType && Number(leaveBalances[initialType] ?? 0) > 0) return initialType;
    return "";
  });
  const [leavePeriod, setLeavePeriod] = useState(
    () => (initialPeriod && ["Full", "Half_AM", "Half_PM"].includes(initialPeriod) ? initialPeriod : "Full"),
  );
  const [leaveReason, setLeaveReason] = useState(() => (initialReason || "").slice(0, 255));

  const reqDays = leavePeriod === "Half_AM" || leavePeriod === "Half_PM" ? 0.5 : 1;
  const selectedBal = leaveType ? Number(leaveBalances[leaveType] ?? 0) : 0;
  const usedElsewhere = leaveType ? Number(usedByType[leaveType] ?? 0) : 0;
  const remaining = round2(Math.max(selectedBal - usedElsewhere, 0));
  const projected = round2(remaining - reqDays);
  const compOff = leaveType ? isCompOffName(leaveType) : false;
  const exceeds = !!leaveType && !compOff && projected < 0;
  const canApply = !!leaveType && available.length > 0 && !exceeds;
  const noteLen = leaveReason.length;
  const counterCls =
    noteLen >= 240 ? "text-amber-400"
      : noteLen >= 200 ? "text-yellow-400/90"
        : "text-[color:var(--wiz-muted)]";

  useEffect(() => {
    const t = window.setTimeout(() => typeSelectRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <Modal
      title={(
        <div className="flex min-w-0 items-center gap-3 pr-2">
          <span className="fx-glow flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#6D5DFB] to-[#8B7BFF] text-white shadow-[0_8px_24px_rgba(109,93,251,0.35)]">
            <CalendarDays size={20} aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-base font-bold tracking-tight text-[color:var(--wiz-text)]">Apply leave</div>
            <div className="truncate text-xs font-medium text-[color:var(--wiz-muted)]">{dateLabel}</div>
          </div>
        </div>
      )}
      onClose={onClose}
      ariaLabel={`Apply leave — ${dateLabel}`}
      scopeClassName="crm-wizard wiz-noise"
      panelClassName="wiz-apply-leave-panel"
      headerClassName="wiz-apply-leave-header"
      bodyClassName="relative overflow-hidden !px-5 !py-5 sm:!px-6"
    >
      {/* Animated aurora + sheen (static when reduced-motion) */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden>
        <div className={`wiz-aurora-blob wiz-aurora-a${reduce ? " !opacity-30" : ""}`} />
        <div className={`wiz-aurora-blob wiz-aurora-b${reduce ? " !opacity-25" : ""}`} />
        <div className={`wiz-aurora-blob wiz-aurora-c${reduce ? " !opacity-20" : ""}`} />
        {!reduce && <div className="wiz-aurora-sheen" />}
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "linear-gradient(135deg, rgba(109,93,251,0.08), transparent 45%, rgba(139,123,255,0.06))",
          }}
        />
      </div>

      <div className="relative z-10 space-y-5">
        {available.length === 0 ? (
          <p className="rounded-xl border border-[color:var(--wiz-border)] bg-[color:var(--wiz-input-bg)]/60 px-3 py-3 text-sm text-[color:var(--wiz-muted)]">
            No leave balance available
          </p>
        ) : (
          <Field label="Leave type" required>
            <div className="flex flex-wrap items-center gap-2">
              <select
                ref={typeSelectRef}
                className={`${inputCls} min-w-0 flex-1`}
                value={leaveType}
                onChange={(e) => setLeaveType(e.target.value)}
                aria-label="Leave type"
              >
                <option value="">Select…</option>
                {available.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name} — {round2(t.bal)} day(s)
                  </option>
                ))}
              </select>
              {leaveType ? (
                <span
                  className="inline-flex shrink-0 items-center rounded-full bg-[rgba(109,93,251,0.18)] px-2.5 py-1 text-xs font-semibold text-[#c4b5fd] ring-1 ring-inset ring-[rgba(139,123,255,0.35)]"
                  title={`Available balance: ${remaining} day(s)`}
                >
                  {remaining} day{remaining === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
          </Field>
        )}

        <Field label="Leave period">
          <div
            className="flex flex-wrap gap-1.5 rounded-xl border border-[color:var(--wiz-border)] bg-[color:var(--wiz-input-bg)]/70 p-1"
            role="group"
            aria-label="Leave period"
          >
            {LEAVE_PERIOD_SEGMENTS.map((seg) => {
              const selected = leavePeriod === seg.value;
              return (
                <button
                  key={seg.value}
                  type="button"
                  disabled={available.length === 0}
                  aria-pressed={selected}
                  onClick={() => setLeavePeriod(seg.value)}
                  className={[
                    "min-w-0 flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-all duration-200",
                    selected
                      ? "btn-gradient text-white shadow-[0_6px_16px_rgba(109,93,251,0.35)]"
                      : "bg-transparent text-[color:var(--wiz-muted)] hover:bg-black/[0.04] hover:text-[color:var(--wiz-text)] dark:hover:bg-white/5",
                    available.length === 0 ? "cursor-not-allowed opacity-50" : "",
                  ].filter(Boolean).join(" ")}
                >
                  {seg.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Note / Reason">
          <textarea
            className={`${inputCls} min-h-[4.5rem] resize-y`}
            value={leaveReason}
            maxLength={255}
            placeholder="Optional note for this leave day…"
            disabled={available.length === 0}
            onChange={(e) => setLeaveReason(e.target.value.slice(0, 255))}
            aria-label="Leave note or reason"
          />
          <motion.p
            className={`mt-1 text-right text-xs font-medium tabular-nums ${counterCls}`}
            animate={reduce ? undefined : { opacity: 1 }}
            key={noteLen >= 240 ? "warn" : noteLen >= 200 ? "mid" : "ok"}
          >
            {noteLen}/255
          </motion.p>
        </Field>

        {leaveType && (
          <div className="rounded-xl border border-[color:var(--wiz-border-strong)] bg-[rgba(15,23,41,0.55)] px-3 py-2.5 text-sm text-[color:var(--wiz-muted)] backdrop-blur-sm">
            <div>
              Current balance:{" "}
              <span className="font-semibold text-[color:var(--wiz-text)]">{remaining}</span> day(s)
            </div>
            <div>
              After apply:{" "}
              <span className={`font-semibold ${exceeds ? "text-danger" : "text-[color:var(--wiz-text)]"}`}>
                {compOff ? round2(remaining - reqDays) : Math.max(projected, 0)}
              </span>
              {" "}day(s)
              {compOff && <span className="ml-1 text-xs">(comp-off)</span>}
            </div>
            {exceeds && (
              <p className="mt-1 text-xs font-semibold text-danger" role="alert">
                Requested {reqDays} day(s) exceeds remaining balance ({remaining}).
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-[color:var(--wiz-border)] pt-4">
          <button
            type="button"
            className={`${btnSecondary} !bg-transparent !border-[color:var(--wiz-border-strong)] hover:!bg-black/[0.04] dark:hover:!bg-white/5`}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${btnPrimary} btn-gradient !border-0 px-5 shadow-[0_8px_24px_rgba(109,93,251,0.35)] transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50`}
            disabled={!canApply}
            onClick={() => {
              if (!canApply) return;
              onApply(leaveType, leavePeriod, leaveReason.trim());
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Colored attendance / day-status pill (read-only display). */
function AttendanceStatusPill({ status }: { status: string }) {
  const label = pretty(status);
  const tone =
    status === "Present" ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
      : status === "Leave" ? "bg-violet-500/15 text-violet-300 ring-violet-500/30"
        : status === "Absent" ? "bg-amber-500/15 text-amber-300 ring-amber-500/30"
          : status === "Half_Day" ? "bg-sky-500/15 text-sky-300 ring-sky-500/30"
            : "bg-surface-2 text-muted ring-white/10";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${tone}`}
      title={label}
    >
      {label}
    </span>
  );
}

/** Applied-leave chip: type · period, optional note icon, optional Change. */
function LeaveAppliedChip({
  leaveType,
  leavePeriod,
  leaveReason,
  onChange,
}: {
  leaveType: string;
  leavePeriod: string;
  leaveReason?: string;
  onChange?: () => void;
}) {
  const period = leavePeriodLabel(leavePeriod);
  const label = `${leaveType || "—"} · ${period}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className="inline-flex max-w-[14rem] items-center gap-1 rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs font-semibold text-violet-200 ring-1 ring-inset ring-violet-500/30"
        title={leaveReason ? `${label} — ${leaveReason}` : label}
      >
        <span className="truncate">{label}</span>
        {leaveReason ? (
          <MessageSquare
            size={12}
            className="shrink-0 opacity-80"
            aria-label={`Note: ${leaveReason}`}
          />
        ) : null}
      </span>
      {onChange && (
        <button
          type="button"
          className={`${btnSecondary} !px-2 !py-0.5 text-xs`}
          onClick={onChange}
        >
          Change
        </button>
      )}
    </div>
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
  const [leaveBalances, setLeaveBalances] = useState<Record<string, number>>({});
  const [applyLeaveRow, setApplyLeaveRow] = useState<number | null>(null);
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
    comp_off_billable: false,
    min_hours_full_day: 8,
    min_hours_half_day: 4,
  };

  const inferDayType = (e: Entry): string => {
    if (e.day_type) return e.day_type;
    if (e.attendance_status === "Holiday") return "Holiday";
    if (!e.is_working) return "Week_Off";
    return "Working";
  };

  const resolvedDefaultHours = (maxDay?: number | null): string => {
    if (maxDay != null && Number(maxDay) > 0) return String(Number(maxDay));
    return "8";
  };

  const toRows = (
    list: Entry[],
    policy: BillingPolicy,
    maxDay?: number | null,
    leaveByType?: Record<string, boolean> | null,
    balances?: Record<string, number>,
  ): EntryRow[] => {
    const bases = list.map((e) => {
      const day_type = inferDayType(e);
      const isWorking = day_type === "Working";
      // Legacy auto-fill was 8.5; prefer project max (or 8) so Hours Worked matches policy.
      const defHrs = resolvedDefaultHours(maxDay);
      let hoursWorked = e.hours_worked != null ? String(e.hours_worked) : "0";
      if (isWorking && (Number(hoursWorked) === 8.5) && Number(defHrs) !== 8.5) {
        hoursWorked = defHrs;
      }
      return {
        entry_date: e.entry_date,
        day_of_week: e.day_of_week || weekday(e.entry_date),
        day_type,
        is_working: isWorking,
        hours_worked: hoursWorked,
        attendance_status: e.attendance_status || (day_type === "Holiday" ? "Holiday" : day_type === "Week_Off" ? "Week_Off" : "Present"),
        leave_type: e.leave_type || "",
        leave_period: e.leave_period || "",
        leave_reason: e.leave_reason || "",
        location: e.location || "Onsite",
        view_flag: !!e.view_flag,
        entry_project_id: e.entry_project_id ? String(e.entry_project_id) : "",
        billable_hours: 0,
        billable_days: e.billable_days,
        billable_day: 0,
      } as EntryRow;
    });
    const split = classifyLeavePaidVsLop(bases, balances || {});
    return bases.map((base, i) => {
      const live = computeBillables(
        base, policy, maxDay, leaveByType,
        base.attendance_status === "Leave" ? split.paidDays[i] : null,
      );
      return {
        ...base,
        billable_hours: live.billable_hours,
        billable_day: live.billable_day,
      };
    });
  };

  const applyLeaveBalances = useCallback((data: TimesheetDetail) => {
    if (data.leave_balances_by_type && Object.keys(data.leave_balances_by_type).length) {
      setLeaveBalances(data.leave_balances_by_type);
      return;
    }
    // Fallback: employee yearly balances (self or HR endpoint).
    const toMap = (rows: any[] | undefined) => {
      const m: Record<string, number> = {};
      (rows || []).forEach((b: any) => {
        if (b.leave_type_name != null) m[b.leave_type_name] = Number(b.balance ?? 0);
      });
      return m;
    };
    if (!data.employee_id) return;
    crmGet<any[]>(`/api/employees/${data.employee_id}/leave-balances?year=${data.year}`)
      .then((r) => setLeaveBalances(toMap(r.data)))
      .catch(() => {
        crmGet<any[]>(`/api/me/leave-balances?year=${data.year}`)
          .then((r) => setLeaveBalances(toMap(r.data)))
          .catch(() => {});
      });
  }, []);

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await crmGet<TimesheetDetail>(`/api/timesheets/${id}`);
      setTs(res.data);
      const policy = res.data.billing_policy || defaultPolicy;
      const maxDay = res.data.max_billable_hours_day;
      const balMap = res.data.leave_balances_by_type || {};
      const rows = toRows(
        res.data.entries || [],
        policy,
        maxDay,
        res.data.leave_billable_by_type,
        balMap,
      );
      setEntries(rows);
      // Persist legacy 8.5 → project-default (e.g. 8) rewrite on next Save.
      const rewritten = (res.data.entries || []).some((e, i) => {
        const dayType = inferDayType(e);
        return dayType === "Working"
          && Number(e.hours_worked) === 8.5
          && Number(rows[i]?.hours_worked) !== 8.5;
      });
      setDirty(rewritten && (res.data.status === "Draft" || res.data.status === "Rejected"));
      if (res.data.summary) setSummary(res.data.summary);
      else crmGet<Summary>(`/api/timesheets/${id}/summary`).then((s) => setSummary(s.data)).catch(() => {});
      applyLeaveBalances(res.data);
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
  }, [id, applyLeaveBalances]);
  useEffect(() => { load(); }, [load]);

  // Live refresh when returning to this tab after editing project policy — skip if dirty.
  useEffect(() => {
    const maybeReload = () => {
      if (document.visibilityState === "hidden") return;
      if (dirtyRef.current) return;
      load();
    };
    const onFocus = () => maybeReload();
    const onVisibility = () => {
      if (document.visibilityState === "visible") maybeReload();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  // leave balances loaded via applyLeaveBalances inside load() (and focus refetch)

  const reduceMotion = useReducedMotion();
  const holidaySet = useMemo(() => new Set(ts?.holiday_dates || []), [ts?.holiday_dates]);
  const policy = ts?.billing_policy || defaultPolicy;

  const leaveSplit = useMemo(
    () => classifyLeavePaidVsLop(entries, leaveBalances),
    [entries, leaveBalances],
  );

  const liveSummary = useMemo(() => {
    const hours = entries.reduce((s, e) => s + Number(e.hours_worked || 0), 0);
    const billableHours = entries.reduce((s, e, i) => {
      const live = computeBillables(
        e, policy, ts?.max_billable_hours_day, ts?.leave_billable_by_type,
        e.attendance_status === "Leave" ? leaveSplit.paidDays[i] : null,
      );
      return s + (live.billable_hours || 0);
    }, 0);
    const actualBillableDay = billableDayFromHours(billableHours);
    // Same paid/LOP split the grid uses (mirrors server classify).
    const totalLeaveDays = round2(entries.reduce((s, e) => {
      if (e.attendance_status !== "Leave") return s;
      const half = e.leave_period === "Half_AM" || e.leave_period === "Half_PM";
      return s + (half ? 0.5 : 1);
    }, 0));
    const totalLeaveBillableDays = round2(entries.reduce((s, e, i) => {
      if (e.attendance_status !== "Leave") return s;
      const paid = leaveSplit.paidDays[i] || 0;
      if (paid <= 0) return s;
      const typeName = (e.leave_type || "").trim();
      if (isLopName(typeName)) return s;
      const perType = ts?.leave_billable_by_type && typeName
        ? ts.leave_billable_by_type[typeName]
        : undefined;
      const isLeaveBillable = perType !== undefined ? perType : policy.leave_billable;
      return isLeaveBillable ? s + paid : s;
    }, 0));
    // Mirror server: leave excess + Working Absent (1.0) + Working Half_Day (0.5).
    const lopFromAbsent = entries.reduce((s, e) => (
      e.day_type === "Working" && e.attendance_status === "Absent" ? s + 1 : s
    ), 0);
    const lopFromHalf = entries.reduce((s, e) => (
      e.day_type === "Working" && e.attendance_status === "Half_Day" ? s + 0.5 : s
    ), 0);
    return {
      hours,
      billableHours,
      actualBillableDay,
      totalLeaveDays,
      totalLopDays: round2(leaveSplit.totalLop + lopFromAbsent + lopFromHalf),
      totalLeaveBillableDays,
      compOffEarned: liveCompOffDayFraction(entries, policy, "earned"),
      compOffBilled: liveCompOffDayFraction(entries, policy, "billed"),
    };
  }, [entries, leaveSplit, policy, ts?.max_billable_hours_day, ts?.leave_billable_by_type]);

  const applyLeaveDialog = useMemo(() => {
    if (applyLeaveRow == null) return null;
    const row = entries[applyLeaveRow];
    if (!row) return null;
    const usedByType: Record<string, number> = {};
    entries.forEach((e, i) => {
      if (i === applyLeaveRow) return;
      if (e.attendance_status !== "Leave" || !e.leave_type) return;
      const half = e.leave_period === "Half_AM" || e.leave_period === "Half_PM";
      usedByType[e.leave_type] = (usedByType[e.leave_type] || 0) + (half ? 0.5 : 1);
    });
    return { row, idx: applyLeaveRow, usedByType };
  }, [applyLeaveRow, entries]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!ts) return <Spinner label="Loading timesheet…" />;

  const editable = ts.status === "Draft" || ts.status === "Rejected";

  /** Default Hours Worked from project max billable hrs/day; fall back to 8. */
  const defaultHoursWorked = (): string => resolvedDefaultHours(ts.max_billable_hours_day);

  const applyDayType = (row: EntryRow, dayType: string): Partial<EntryRow> => {
    if (dayType === "Holiday") {
      return { day_type: dayType, is_working: false, hours_worked: "0", attendance_status: "Holiday", leave_type: "", leave_period: "", leave_reason: "" };
    }
    if (dayType === "Week_Off") {
      return { day_type: dayType, is_working: false, hours_worked: "0", attendance_status: "Week_Off", leave_type: "", leave_period: "", leave_reason: "" };
    }
    return {
      day_type: "Working",
      is_working: true,
      hours_worked: row.hours_worked === "0" ? defaultHoursWorked() : row.hours_worked,
      attendance_status: "Present",
    };
  };

  const updateEntry = (idx: number, patch: Partial<EntryRow>) => {
    setEntries((prev) => {
      const nextRows = prev.map((row, i) => {
        if (i !== idx) return row;
        let next = { ...row, ...patch };
        if (patch.day_type) next = { ...next, ...applyDayType(next, patch.day_type) };
        if (patch.attendance_status === "Leave" && !next.leave_type) next.leave_type = "";
        if (patch.attendance_status && patch.attendance_status !== "Leave") {
          next.leave_type = "";
          next.leave_period = "";
          next.leave_reason = "";
        }
        // Hours Worked = 0 on a working day → Attendance = Absent (Apply leave via dialog).
        // Typing hours back re-derives Present/Half via applyHoursAttendanceRule.
        // Week Off / Holiday: keep attendance as-is; do not force hours back to 0.
        if (patch.hours_worked !== undefined && next.day_type === "Working") {
          const hw = Number(next.hours_worked || 0);
          if (hw === 0) {
            next.attendance_status = "Absent";
            next.leave_type = "";
            next.leave_period = "";
            next.leave_reason = "";
          } else if (next.attendance_status === "Leave") {
            next.attendance_status = "Present";
            next.leave_type = "";
            next.leave_period = "";
            next.leave_reason = "";
          }
        }
        // Soft hour-cap: clamp Week Off / Working hours to project max when set.
        if (patch.hours_worked !== undefined && next.day_type !== "Holiday") {
          const cap = ts.max_billable_hours_day;
          const parsed = Number(next.hours_worked || 0);
          if (cap != null && Number(cap) > 0 && parsed > Number(cap)) {
            next.hours_worked = String(Number(cap));
          }
        }
        next = applyHoursAttendanceRule(next);
        return next;
      });
      // Recompute billables with LOP-aware paid portion across the whole sheet.
      const split = classifyLeavePaidVsLop(nextRows, leaveBalances);
      return nextRows.map((row, i) => {
        const live = computeBillables(
          row, policy, ts.max_billable_hours_day, ts.leave_billable_by_type,
          row.attendance_status === "Leave" ? split.paidDays[i] : null,
        );
        return { ...row, billable_hours: live.billable_hours, billable_day: live.billable_day };
      });
    });
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
        leave_reason: e.attendance_status === "Leave" && e.leave_reason
          ? e.leave_reason.slice(0, 255) : null,
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

  const cellCls = "border-r border-white/[0.04] px-3 py-2.5 last:border-r-0";
  const miniInput = `${inputCls} !rounded-lg !px-2.5 !py-1.5 text-xs ${focusRing}`;
  const GRID_COLS = 11;

  return (
    <div className="min-w-0 space-y-5">
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
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
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
          <LabeledValue
            label="Branch"
            value={
              ts.branch_name
                || (ts.branch_unlinked ? (ts.branch_link_message || "Branch not linked to this customer") : null)
                || "—"
            }
          />
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
              <button
                className={btnSecondary}
                onClick={() => setConfirm("submit")}
                disabled={saving}
              >
                <Send size={15} /> Submit
              </button>
            </>
          )}
          {editable && leaveSplit.totalLop > 0 && (
            <span className="text-xs font-semibold text-secondary" role="status">
              Excess leave converts to Loss of Pay ({leaveSplit.totalLop} day{leaveSplit.totalLop === 1 ? "" : "s"}) — non-billable.
            </span>
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
        <div className="border-b border-subtle px-4 py-3.5 text-sm font-bold tracking-wide text-primary">
          Timesheet Details
        </div>
        <div className="overflow-x-auto" role="region" aria-label="Timesheet daily entries" tabIndex={0}>
        <table className="w-full min-w-[72rem] border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-subtle bg-surface-2/95 text-left text-[11px] font-bold uppercase tracking-wider text-muted backdrop-blur-sm">
              <th scope="col" className={cellCls}>S No</th>
              <th scope="col" className={cellCls}>Date</th>
              <th scope="col" className={cellCls}>Week Day</th>
              <th scope="col" className={cellCls}>Working/Not Working</th>
              <th scope="col" className={cellCls}>Hours Worked</th>
              <th scope="col" className={cellCls}>Attendance</th>
              <th scope="col" className={cellCls}>Leave Applied</th>
              <th scope="col" className={`${cellCls} text-right`}>Billable Hours</th>
              <th scope="col" className={`${cellCls} text-right`}>Billable Day</th>
              <th scope="col" className={cellCls}>View</th>
              <th scope="col" className={cellCls}>Location</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={GRID_COLS} className="px-4 py-10 text-center text-muted">
                  No entries. {editable ? "This timesheet was created without pre-generated days." : ""}
                </td>
              </tr>
            )}
            {entries.map((e, i) => {
              const isLeave = e.attendance_status === "Leave";
              // Trust the FRESH holiday overlay from the server (holidaySet is
              // rebuilt each load from the current calendar). Falling back to the
              // stored day_type would keep a moved/removed holiday showing.
              const isCalendarHoliday = holidaySet.has(e.entry_date);
              const isWeekOff = e.day_type === "Week_Off";
              const hoursNum = Number(e.hours_worked || 0);
              const weekendWorked = (isWeekOff || isCalendarHoliday) && hoursNum > 0;
              const hoursEditable = editable && !isCalendarHoliday
                && (e.day_type === "Working" || isWeekOff);
              const zebra = i % 2 === 1 ? "bg-black/[0.02] dark:bg-white/[0.02]" : "";
              const weekendHl = weekendWorked
                ? ((isCalendarHoliday
                    ? (policy.holidays_billable || policy.comp_off_billable)
                    : (policy.week_off_billable || policy.comp_off_billable))
                  ? "bg-violet-500/[0.08] ring-1 ring-inset ring-violet-500/20"
                  : "bg-teal-500/[0.08] ring-1 ring-inset ring-teal-500/20")
                : "";
              const rowMotion = reduceMotion
                ? undefined
                : { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.18, delay: Math.min(i * 0.012, 0.25) } };
              return (
                <motion.tr
                  key={e.entry_date}
                  {...(rowMotion || {})}
                  className={`border-b border-white/[0.04] transition-colors hover:bg-brand-500/[0.06] ${zebra} ${
                    e.day_type === "Working" ? "" : "bg-surface-2/40"
                  } ${weekendHl}`}
                >
                  <td className={`${cellCls} tabular-nums text-muted`}>{i + 1}</td>
                  <td className={`${cellCls} whitespace-nowrap font-semibold text-primary`}>
                    {entryDate(e.entry_date)}
                  </td>
                  <td className={`${cellCls} whitespace-nowrap text-secondary`}>{e.day_of_week}</td>
                  <td className={cellCls}>
                    <span
                      className="inline-flex items-center rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-medium text-secondary ring-1 ring-inset ring-white/10"
                      title="Calendar-driven — not editable"
                      aria-label={`Working status: ${dayTypeLabel(e.day_type)}`}
                    >
                      {dayTypeLabel(e.day_type)}
                    </span>
                  </td>
                  <td className={cellCls}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <input
                        type="number" min={0} max={24} step={0.5}
                        className={`${miniInput} !w-20`}
                        value={e.hours_worked}
                        disabled={!hoursEditable}
                        aria-label={`Hours worked ${entryDate(e.entry_date)}`}
                        title={
                          ts.max_billable_hours_day != null
                            ? `Max ${ts.max_billable_hours_day} h/day`
                            : undefined
                        }
                        onChange={(ev) => updateEntry(i, { hours_worked: ev.target.value })}
                        onBlur={(ev) => {
                          const parsed = parseFloat(ev.target.value);
                          if (!Number.isNaN(parsed)) {
                            updateEntry(i, { hours_worked: String(parsed) });
                          }
                        }}
                      />
                      {weekendWorked && (() => {
                        const billed = isCalendarHoliday
                          ? !!(policy.holidays_billable || policy.comp_off_billable)
                          : !!(policy.week_off_billable || policy.comp_off_billable);
                        return (
                        <span
                          className={
                            billed
                              ? "inline-flex items-center rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200 ring-1 ring-inset ring-violet-500/35"
                              : "inline-flex items-center rounded-full bg-teal-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-200 ring-1 ring-inset ring-teal-500/35"
                          }
                          title={
                            billed
                              ? "Billed to client (Week Off / Holidays Billable or Comp Off Billable) — no leave credit"
                              : "Not billed — Comp-Off leave credited on submit"
                          }
                        >
                          {billed ? "Billable" : "Comp-off credit"}
                        </span>
                        );
                      })()}
                    </div>
                  </td>
                  <td className={cellCls}>
                    <span
                      title={
                        isCalendarHoliday || e.attendance_status === "Leave" || e.day_type === "Week_Off"
                          ? undefined
                          : "Derived from Hours Worked (≥8 Present, ≥4 Half Day, else Absent)"
                      }
                    >
                      <AttendanceStatusPill status={isCalendarHoliday ? "Holiday" : e.attendance_status} />
                    </span>
                  </td>
                  <td className={cellCls}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {editable && e.attendance_status === "Absent" && e.day_type === "Working" ? (
                        <button
                          type="button"
                          className={`${btnPrimary} !bg-brand-600/90 !px-2.5 !py-1 text-xs`}
                          onClick={() => setApplyLeaveRow(i)}
                        >
                          Apply leave
                        </button>
                      ) : isLeave && e.leave_type ? (
                        <LeaveAppliedChip
                          leaveType={e.leave_type}
                          leavePeriod={e.leave_period}
                          leaveReason={e.leave_reason}
                          onChange={editable ? () => setApplyLeaveRow(i) : undefined}
                        />
                      ) : null}
                      {e.day_type === "Working" && e.attendance_status === "Absent" && (
                        <span
                          className="inline-flex items-center rounded-full bg-[color:var(--wiz-border)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--wiz-muted)] ring-1 ring-inset ring-[color:var(--wiz-border-strong)]"
                          title="Unpaid absence — counts toward Total Loss of Pay Days"
                        >
                          LOP 1.0
                        </span>
                      )}
                      {e.day_type === "Working" && e.attendance_status === "Half_Day" && (
                        <span
                          className="inline-flex items-center rounded-full bg-[color:var(--wiz-border)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--wiz-muted)] ring-1 ring-inset ring-[color:var(--wiz-border-strong)]"
                          title="Unworked half — counts toward Total Loss of Pay Days"
                        >
                          LOP 0.5
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={`${cellCls} text-right font-semibold tabular-nums text-secondary`}>
                    {e.billable_hours ?? "—"}
                  </td>
                  <td className={`${cellCls} text-right font-semibold tabular-nums text-secondary`}>
                    {e.billable_day ?? "—"}
                  </td>
                  <td className={cellCls}>
                    <input
                      type="checkbox"
                      className={`rounded ${focusRing}`}
                      checked={e.view_flag}
                      disabled={!editable}
                      aria-label={`View flag ${entryDate(e.entry_date)}`}
                      onChange={(ev) => updateEntry(i, { view_flag: ev.target.checked })}
                    />
                  </td>
                  <td className={cellCls}>
                    <select
                      className={`${miniInput} !w-32`}
                      value={e.location || "Onsite"}
                      disabled={!editable}
                      aria-label={`Location ${entryDate(e.entry_date)}`}
                      onChange={(ev) => updateEntry(i, { location: ev.target.value })}
                    >
                      {LOCATIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-subtle px-4 py-2.5 text-[11px] text-muted">
          <span className="font-semibold uppercase tracking-wide text-secondary">Legend</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400/80" aria-hidden /> Present
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-violet-400/80" aria-hidden /> Leave
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-400/80" aria-hidden /> Absent
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[color:var(--text-muted)]/70" aria-hidden /> Week Off
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-sky-400/80" aria-hidden /> Holiday
          </span>
          <span className="mx-1 h-3 w-px bg-[color:var(--border-subtle)]" aria-hidden />
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex rounded-full bg-violet-500/25 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-violet-200">Billable</span>
            Comp Off Billable ON
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex rounded-full bg-teal-500/25 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-teal-200">Credit</span>
            Comp Off Billable OFF
          </span>
        </div>
        {dirty && (
          <div className="border-t border-subtle bg-warning-soft px-4 py-2 text-xs font-semibold text-warning" role="status">
            Unsaved changes — billable hours/days are recomputed by the server after saving.
          </div>
        )}
      </div>

      {/* ------------------------------------------------ invoice details (collapsible) */}
      <InvoiceDetailsSection timesheetId={ts.id} showToast={showToast} />

      {/* ------------------------------------------------ summary / calculated fields */}
      <div className="glass rounded-panel p-4 sm:p-5">
        <h2 className="mb-1 text-sm font-bold tracking-wide text-primary">Summary</h2>
        <p className="mb-3 text-xs text-muted">Rollup of days, hours, leave, and billables for this period.</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <Stat label="Total Days" value={num(summary?.total_days)} />
          <Stat label="Total Working Days" value={num(summary?.working_days)} />
          <Stat label="Total Comp-Off Days" value={num(summary?.comp_off_days)} />
          <Stat label="Total No of Hours Worked" value={num(dirty ? liveSummary.hours : summary?.total_hours_worked ?? summary?.hours_worked)} />
          <Stat label="Actual Billable Hours" value={num(dirty ? liveSummary.billableHours : summary?.actual_billable_hours)} />
          <Stat label="Total Week off" value={num(summary?.total_week_off)} />
          <Stat label="Total Billable Days" value={num(summary?.total_billable_days)} />
          <Stat
            label="Total Leave Days"
            value={num(dirty ? liveSummary.totalLeaveDays : summary?.total_leave_days ?? liveSummary.totalLeaveDays)}
          />
          <Stat
            label="Total Loss of Pay Days"
            value={num(dirty ? liveSummary.totalLopDays : summary?.total_loss_of_pay_days ?? liveSummary.totalLopDays)}
          />
          <Stat
            label="Total Leave Billable Days"
            value={num(
              dirty
                ? liveSummary.totalLeaveBillableDays
                : summary?.total_leave_billable_days ?? liveSummary.totalLeaveBillableDays,
            )}
          />
          <Stat label="Actual Working Days" value={num(summary?.total_no_of_days_worked)} />
          <Stat label="Actual Billable Day" value={num(dirty ? liveSummary.actualBillableDay : summary?.actual_billable_day ?? summary?.actual_billable_days)} />
          <Stat label="Total Holiday" value={num(summary?.holidays)} />
          <Stat label="Total Billable Hours" value={num(summary?.total_billable_hours)} />
          <Stat label="Comp-Off Earned" value={num(dirty ? liveSummary.compOffEarned : summary?.comp_off_earned)} />
          <Stat label="Comp-Off Billed" value={num(dirty ? liveSummary.compOffBilled : summary?.comp_off_billed)} />
          <Stat label="Comp-Off Credited" value={num(summary?.comp_off_credited)} />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 border-t border-subtle pt-4 sm:grid-cols-3">
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
      {applyLeaveDialog && (
        <TimesheetApplyLeaveDialog
          key={`apply-leave-${applyLeaveDialog.idx}-${applyLeaveDialog.row.entry_date}`}
          dateLabel={entryDate(applyLeaveDialog.row.entry_date)}
          leaveBalances={leaveBalances}
          usedByType={applyLeaveDialog.usedByType}
          initialType={applyLeaveDialog.row.leave_type || ""}
          initialPeriod={applyLeaveDialog.row.leave_period || "Full"}
          initialReason={applyLeaveDialog.row.leave_reason || ""}
          onClose={() => setApplyLeaveRow(null)}
          onApply={(leaveType, leavePeriod, leaveReason) => {
            updateEntry(applyLeaveDialog.idx, {
              attendance_status: "Leave",
              leave_type: leaveType,
              leave_period: leavePeriod,
              leave_reason: leaveReason,
            });
            setApplyLeaveRow(null);
          }}
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
    <div className="glass fx-gradient-border fx-lift rounded-xl px-3.5 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-display text-lg font-bold tabular-nums text-primary">{value}</div>
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
      <CrmLink
        to={`invoices/${preview.linked_invoice.id}/tax-invoice`}
        className={`rounded-control text-xs font-semibold text-sky-600 hover:underline dark:text-sky-300 ${focusRing}`}
      >
        Tax Invoice
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
                          <th className={`${cell} text-right`}>Comp-off</th>
                          <th className={`${cell} text-right`}>LOP</th>
                          <th className={`${cell} text-right`}>Amount</th>
                          <th className={cell}>Invoice</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.line_items.length === 0 && (
                          <tr>
                            <td colSpan={10} className="px-4 py-6 text-center text-muted">No invoice line items</td>
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
                            <td className={`${cell} text-right text-secondary`}>{li.comp_off_billable_qty ?? 0}</td>
                            <td className={`${cell} text-right text-secondary`}>{li.loss_of_pay_days ?? 0}</td>
                            <td className={`${cell} text-right font-semibold text-primary`}>{inr(li.amount)}</td>
                            <td className={cell}>{invoiceCell}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-strong">
                          <td colSpan={8} className={`${cell} text-right text-xs font-bold uppercase tracking-wide text-muted`}>
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

function filterReportRows(
  rows: ReportRow[],
  opts: { search: string; month: string; year: string; status?: string },
): ReportRow[] {
  const q = opts.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (opts.month && String(r.month) !== opts.month) return false;
    if (opts.year && String(r.year) !== opts.year) return false;
    if (opts.status && (r.status || "") !== opts.status) return false;
    if (!q) return true;
    const hay = [
      r.project_title, r.project_employee_name, r.customer_name, r.project_type,
      r.status, r.status_label, r.timesheet_period,
    ].map((x) => String(x || "").toLowerCase()).join(" ");
    return hay.includes(q);
  });
}

function ReportListFilters({
  search, setSearch, month, setMonth, year, setYear,
  status, setStatus, statusOptions,
  searchPlaceholder = "Search project, employee, customer…",
}: {
  search: string;
  setSearch: (v: string) => void;
  month: string;
  setMonth: (v: string) => void;
  year: string;
  setYear: (v: string) => void;
  status?: string;
  setStatus?: (v: string) => void;
  statusOptions?: string[];
  searchPlaceholder?: string;
}) {
  const now = new Date();
  const years: number[] = [];
  for (let y = now.getFullYear() + 1; y >= now.getFullYear() - 4; y--) years.push(y);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        className={`${inputCls} !w-64`}
        placeholder={searchPlaceholder}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search timesheets"
      />
      <select className={`${inputCls} !w-36`} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Filter month">
        <option value="">All months</option>
        {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select>
      <select className={`${inputCls} !w-28`} value={year} onChange={(e) => setYear(e.target.value)} aria-label="Filter year">
        <option value="">All years</option>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      {setStatus && statusOptions && (
        <select className={`${inputCls} !w-40`} value={status || ""} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
          <option value="">All statuses</option>
          {statusOptions.map((s) => <option key={s} value={s}>{tsStatusLabel(s)}</option>)}
        </select>
      )}
    </div>
  );
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
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");

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
  const filtered = useMemo(
    () => filterReportRows(rows, { search, month, year }),
    [rows, search, month, year],
  );
  const groups = groupByProjectTitle(filtered);
  const hasFilters = !!(search.trim() || month || year);

  if (loading) return <Spinner label="Loading timesheet due report…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;

  return (
    <div className="space-y-4">
      <ReportListFilters
        search={search} setSearch={setSearch}
        month={month} setMonth={setMonth}
        year={year} setYear={setYear}
      />
      {groups.length === 0 ? (
        <div className="rounded-panel border border-subtle px-4 py-8 text-center text-sm text-muted">
          {hasFilters
            ? "No due timesheets match your filters."
            : "No due timesheets — all assignments are submitted or approved."}
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
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [status, setStatus] = useState("");

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
  const filtered = useMemo(
    () => filterReportRows(rows, { search, month, year, status }),
    [rows, search, month, year, status],
  );
  const hasFilters = !!(search.trim() || month || year || status);

  if (loading) return <Spinner label="Loading submission report…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;

  return (
    <div className="space-y-4">
      <ReportListFilters
        search={search} setSearch={setSearch}
        month={month} setMonth={setMonth}
        year={year} setYear={setYear}
        status={status} setStatus={setStatus}
        statusOptions={["Draft", "Rejected"]}
      />
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
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-muted">
                    {hasFilters ? "No timesheets match your filters" : "No timesheets pending submission"}
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const id = r.id ?? r.timesheet_id!;
                const isRejected = r.status === "Rejected";
                return (
                  <tr key={id} className="border-b border-subtle">
                    <td className={cell}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          className={`${btnSecondary} !px-2 !py-1 text-xs`}
                          onClick={() => crmNavigate(`timesheets/${id}`)}
                          title="Open the timesheet to edit before submitting"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={`${btnPrimary} !px-2 !py-1 text-xs`}
                          disabled={busyId === id}
                          onClick={() => submit(r)}
                        >
                          {busyId === id ? "…" : isRejected ? "Resubmit" : "Submit for Approval"}
                        </button>
                      </div>
                    </td>
                    <td className={cell}><StatusBadge status={r.status} label={r.status_label || tsStatusLabel(r.status)} /></td>
                    <td className={cell}>
                      <button
                        type="button"
                        className="text-left font-semibold text-sky-600 hover:underline dark:text-sky-400"
                        onClick={() => crmNavigate(`timesheets/${id}`)}
                      >
                        {r.timesheet_period || fmtPeriod(r.period_start, r.period_end)}
                      </button>
                    </td>
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
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [status, setStatus] = useState("");

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
  const filtered = useMemo(
    () => filterReportRows(rows, { search, month, year, status }),
    [rows, search, month, year, status],
  );
  const hasFilters = !!(search.trim() || month || year || status);

  if (loading) return <Spinner label="Loading approvals report…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;

  return (
    <>
      <div className="mb-4">
        <ReportListFilters
          search={search} setSearch={setSearch}
          month={month} setMonth={setMonth}
          year={year} setYear={setYear}
          status={status} setStatus={setStatus}
          statusOptions={["Submitted", "Approved"]}
        />
      </div>
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
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-muted">
                    {hasFilters ? "No timesheets match your filters" : "No timesheets awaiting approval"}
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
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
    <Modal
      title={<span className="sr-only">Reject Timesheet</span>}
      onClose={onClose}
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0"
    >
      <WizFormShell
        title="Reject Timesheet"
        subtitle="Provide a clear reason (minimum 10 characters). The employee will be notified."
        icon={<X size={20} aria-hidden />}
      >
        <WizardField label="Rejection reason" required error={error}>
          <textarea
            className={`${inputCls} min-h-24`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why this timesheet is being rejected (min 10 characters)…"
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
