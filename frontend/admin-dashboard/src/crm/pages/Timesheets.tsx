/** Timesheets — list (filters + create) and detail entry page ("Tab 9: TimeSheet"):
 * header info card, daily entries grid with server-computed billables, collapsible
 * invoice-preview section (Finance/Admin can generate the invoice), summary rollup,
 * submit/approve/reject workflow. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BellRing, CalendarDays, Check, ChevronDown, Clock, FilePlus2, History, MessageSquare, Plus, Receipt, Save, Send, X } from "lucide-react";
import { crmDelete, crmGet, crmPatch, crmPost, crmPut, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole, useMe } from "../CrmApp";
import { crmTabVisibleFromMe, useCanAct } from "../useAccess";
import { PayrollPage } from "./Payroll";
import { MyLeavePage } from "./MyLeave";
import { LeaveApplicationsPage } from "./LeaveApplications";
import { CrmLink, crmNavigate, useCrmParams } from "../routerHooks";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { RowActions, afterListDelete } from "../components/RowActions";
import { FileLink, FileUploadButton } from "../components/FileUpload";
import {
  ConfirmModal, ErrorBox, Field, Modal, Spinner, StatusBadge,
  btnDanger, btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";
import { TeachingEmpty } from "../components/TeachingEmpty";
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
  /** Leave excess + Absent + unworked Half_Day. Since Aug 2026 this REDUCES a
      Monthly bill: each LOP day deducts one working day's value (rate × lop /
      working-days), and qty becomes the billed fraction so Qty × Rate always
      equals Amount. Hourly/Daily paths were already zero for LOP days. */
  loss_of_pay_days?: number | null;
  /** "Harman rule": LOP day-fractions made up by worked week-off/holiday days
      (credit mode). Net loss_of_pay_days above already excludes these. */
  lop_covered_days?: number | null;
  /** Initial no-billing period (26 Aug 2026): days of this sheet inside the
      employee's free ramp-up window — they bill zero, this says how many. */
  no_billing_days_excluded?: number | null;
  no_billing_until?: string | null;
  /** Rate basis, from the Project Employee record: Hourly|Daily|Monthly|Yearly.
      For Yearly, rate_per_unit is already the monthly equivalent (annual ÷ 12). */
  billing_unit?: string | null;
  working_days_in_period?: number | null;
  hours_per_full_day?: number | null;
  /** Derived: what one day / one hour of this employee costs in THIS period.
      Monthly → rate ÷ working days (same denominator as the LOP deduction). */
  per_day_charge?: number | null;
  per_hour_charge?: number | null;
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
    // Pure week-off (0 hours): Week Off Billable bills the day itself, same
    // as Holidays Billable does for an unworked holiday (mirror server) —
    // with both flags on, a 31-day month bills all 31 days.
    if (policy.week_off_billable) {
      return {
        billable_hours: policy.min_hours_full_day,
        billable_day: billableDayFromHours(policy.min_hours_full_day),
      };
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
  // Payroll, My Leave and Leave Applications live INSIDE Timesheets since
  // Aug 2026 (no standalone sidebar pages) — this page is the attendance hub.
  // Payroll: Admin/HR/Finance. My Leave: every CRM role (incl. TA, who sees
  // ONLY this tab). Leave Applications: Admin/HR.
  { key: "payroll", label: "Payroll" },
  { key: "myleave", label: "My Leave" },
  { key: "leaveApps", label: "Leave Applications" },
] as const;

type ReportTab = typeof REPORT_TABS[number]["key"];

export function TimesheetsListPage() {
  const isStaff = useCanAct("timesheets", "edit", useHasRole("HR", "Finance", "RMG"));
  // Inner tabs mirror their old sidebar entries' gating (roles + Access
  // Templates), so nobody gains or loses access in the move (Aug 2026):
  //  - core timesheet tabs: the page's original roles (TA never had them)
  //  - Payroll: Admin/HR/Finance   - My Leave: every CRM role
  //  - Leave Applications: Admin/HR
  const me = useMe();
  const tsRoleOk = useCanAct("timesheets", "view", useHasRole("HR", "Finance", "RMG", "Sales", "Sales_Head"));
  const payrollRoleOk = useCanAct("payroll", "view", useHasRole("HR", "Finance"));
  const myLeaveRoleOk = useCanAct("my-leave", "view", useHasRole("Sales", "Sales_Head", "RMG", "TA", "HR", "Finance"));
  const leaveAppsRoleOk = useCanAct("leave-applications", "view", useHasRole("HR"));
  const showPayroll = crmTabVisibleFromMe(me, "payroll", payrollRoleOk, false);
  const showMyLeave = crmTabVisibleFromMe(me, "my-leave", myLeaveRoleOk, false);
  const showLeaveApps = crmTabVisibleFromMe(me, "leave-applications", leaveAppsRoleOk, false);
  const canManage = useCanAct("timesheets", "edit", useHasRole("HR", "Finance", "RMG", "Sales", "Sales_Head"));
  // Force delete (also removes the linked invoice) — Sales/Sales_Head/RMG + Admin/CEO.
  const canForceDelete = useCanAct("timesheets", "create", useHasRole("Sales", "Sales_Head", "RMG", "Admin", "CEO"));
  const [tab, setTab] = useState<ReportTab>(() =>
    isStaff ? "due" : tsRoleOk ? "all" : "myleave",
  );
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
  const [showImport, setShowImport] = useState(false);
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

  const visibleTabs = REPORT_TABS.filter((t) => {
    if (t.key === "payroll") return showPayroll;
    if (t.key === "myleave") return showMyLeave;
    if (t.key === "leaveApps") return showLeaveApps;
    if (t.key === "all") return tsRoleOk;
    return tsRoleOk && isStaff; // due / submission / approvals
  });
  // If the current tab is not visible for this user (e.g. an Access Template
  // hides it), snap to the first tab they CAN see instead of a blank page.
  useEffect(() => {
    if (visibleTabs.length && !visibleTabs.some((t) => t.key === tab)) {
      setTab(visibleTabs[0].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, visibleTabs.map((t) => t.key).join(",")]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-display text-xl font-bold text-primary">Timesheets</h1>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <button className={btnSecondary} onClick={() => setShowImport(true)}>
              Import Excel
            </button>
          )}
          {canManage && (
            <button className={btnPrimary} onClick={() => openNew()}>
              <Plus size={15} /> New Timesheet
            </button>
          )}
        </div>
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
      {tab === "payroll" && showPayroll && <PayrollPage embedded />}
      {tab === "myleave" && showMyLeave && <MyLeavePage embedded />}
      {tab === "leaveApps" && showLeaveApps && <LeaveApplicationsPage embedded />}
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
              headerRight={meta ? <span className="whitespace-nowrap text-xs font-medium text-muted">{meta.total} {meta.total === 1 ? "timesheet" : "timesheets"}, page {meta.page}/{Math.max(1, meta.pages || 1)}</span> : undefined}
              loading={loading}
              onPage={setPage}
              onRowClick={(r) => crmNavigate(`timesheets/${r.id}`)}
              emptyMessage={<TeachingEmpty page="timesheets" />}
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
                colored />
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
      {showImport && (
        <TimesheetImportModal
          projects={projects}
          onClose={() => setShowImport(false)}
          onDone={() => load()}
          notify={showToast}
        />
      )}
      {toast}
    </div>
  );
}

/* =====================================================================
 * Bulk Excel import — pick project + employee, upload day rows
 * =================================================================== */

type TsImportResult = {
  months: { period: string; timesheet_id: number | null; applied: number; skipped: string | null
    counts?: Record<string, number>;
  }[];
  failed_rows: { row: number; error: string }[];
  summary: string;
};

export function TimesheetImportModal({ projects, initialProjectId, onClose, onDone, notify }: {
  projects: any[];
  /** Pre-scope to one project (the project-detail Timesheet tab). */
  initialProjectId?: string;
  onClose: () => void;
  onDone: () => void;
  notify: (msg: string, kind?: "ok" | "err") => void;
}) {
  const [projectId, setProjectId] = useState(initialProjectId || "");
  const [pes, setPes] = useState<any[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TsImportResult | null>(null);

  // Employees mapped to the CHOSEN project — historic data belongs to a
  // (project, employee) assignment, never to a free-floating person.
  useEffect(() => {
    setPes([]); setEmployeeId("");
    if (!projectId) return;
    crmGet<any[]>(`/api/projects/all-employees${qs({ project_id: projectId, limit: 100 })}`)
      .then((r) => setPes(r.data || []))
      .catch(() => setPes([]));
  }, [projectId]);

  const downloadTemplate = async () => {
    try {
      const { authFetch } = await import("../../api/client");
      const res = await authFetch("/api/timesheets/import-template");
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = "timesheet-import-template.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e: any) {
      notify(e?.message || "Template download failed", "err");
    }
  };

  const upload = async () => {
    if (!file || !projectId || !employeeId) return;
    setBusy(true);
    try {
      const { crmUpload } = await import("../api");
      const res = await crmUpload<TsImportResult>(
        `/api/timesheets/bulk-import${qs({ project_id: projectId, employee_id: employeeId })}`,
        file,
      );
      setResult(res.data);
      const anyBad = (res.data?.failed_rows?.length ?? 0) > 0
        || (res.data?.months || []).some((m) => m.skipped);
      notify(res.message || res.data?.summary || "Import complete", anyBad ? "err" : "ok");
      onDone();
    } catch (e: any) {
      notify(e?.message || "Import failed", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Import timesheets from Excel" onClose={onClose} wide>
      {!result ? (
        <div className="space-y-4">
          <div className="rounded-card border border-subtle bg-surface-2/40 p-4 text-sm text-secondary">
            <div className="font-semibold text-primary">How it works</div>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>
                <button type="button" className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
                  onClick={downloadTemplate}>
                  Download the Excel template
                </button>{" "}
                — one row per day: date, hours, status, leave type. Rows may span several months.
              </li>
              <li>Pick the project and the employee the data belongs to.</li>
              <li>Upload — each month becomes (or updates) a Draft sheet with billables computed
                by the normal rules. Submitted/Approved months are never touched.</li>
            </ol>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted">Project</span>
              <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Select project…</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted">Employee</span>
              <select className={inputCls} value={employeeId} disabled={!projectId}
                onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">{projectId ? "Select employee…" : "Select a project first"}</option>
                {pes.map((pe) => (
                  <option key={pe.id} value={pe.employee_id}>
                    {pe.employee_name || pe.full_name || `#${pe.employee_id}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <input
            type="file"
            accept=".xlsx"
            className="block w-full text-sm text-secondary file:mr-3 file:rounded-control file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-700"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <div className="flex justify-end gap-2">
            <button className={btnSecondary} onClick={onClose}>Cancel</button>
            <button className={btnPrimary} onClick={upload} disabled={!file || !projectId || !employeeId || busy}>
              {busy ? "Importing…" : "Upload & import"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-sm font-bold text-primary">{result.summary}</div>
          <div className="space-y-1">
            {result.months.map((m) => (
              <div key={m.period} className="flex flex-wrap items-center gap-2 text-sm">
                {m.timesheet_id ? (
                  <CrmLink to={`timesheets/${m.timesheet_id}`}
                    className="font-semibold text-brand-600 hover:underline dark:text-brand-300">
                    {m.period}
                  </CrmLink>
                ) : (
                  <span className="font-semibold text-primary">{m.period}</span>
                )}
                {m.applied > 0 && <span className="text-success">{m.applied} day(s) applied</span>}
                {m.counts && Object.keys(m.counts).length > 0 && (
                  <span className="text-xs text-muted">
                    ({Object.entries(m.counts)
                      .map(([k, v]) => `${String(k).replace(/_/g, " ")} ${v}`)
                      .join(" · ")})
                  </span>
                )}
                {m.timesheet_id ? (
                  <CrmLink to={`timesheets/${m.timesheet_id}`}
                    className="ml-auto text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
                    Open &amp; verify →
                  </CrmLink>
                ) : null}
                {m.skipped && (
                  <span className={m.applied > 0 ? "text-warning" : "text-danger"}>{m.skipped}</span>
                )}
              </div>
            ))}
          </div>
          {result.failed_rows.length > 0 && (
            <div>
              <div className="text-xs font-bold uppercase text-danger">Rows not imported ({result.failed_rows.length})</div>
              <ul className="mt-1 space-y-0.5 text-sm text-secondary">
                {result.failed_rows.map((r) => <li key={r.row} className="text-danger">{r.error}</li>)}
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button className={btnSecondary} onClick={() => { setResult(null); setFile(null); }}>
              Import another file
            </button>
            <button className={btnPrimary} onClick={onClose}>Done</button>
          </div>
        </div>
      )}
    </Modal>
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
        className="inline-flex max-w-[14rem] items-center gap-1 rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs font-semibold text-violet-700 ring-1 ring-inset ring-violet-500/30 dark:text-violet-200"
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
  /* HR reviews timesheets but does not decide them — approval sits with RMG,
     Sales and (via isSuperAdmin) Admin/CEO. Anyone who can reach this page can
     still read every entry; only the decision is gated. */
  const canApprove = useCanAct("timesheets", "edit", useHasRole("RMG", "Sales"));
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
    // WEEKEND WORK COVERS LOP (server mirror, "Harman rule"): in credit mode
    // a worked week-off/holiday day first makes up a Loss-of-Pay day — net
    // LOP shows/bills, and the covering fraction earns NO comp-off credit.
    const rawLop = round2(leaveSplit.totalLop + lopFromAbsent + lopFromHalf);
    const rawEarned = liveCompOffDayFraction(entries, policy, "earned");
    const lopCover = Math.min(rawLop, rawEarned);
    return {
      hours,
      billableHours,
      actualBillableDay,
      totalLeaveDays,
      totalLopDays: round2(rawLop - lopCover),
      lopCoveredDays: round2(lopCover),
      totalLeaveBillableDays,
      compOffEarned: round2(rawEarned - lopCover),
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

  const entriesPayload = (rows: EntryRow[]) => rows.map((e) => ({
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
  }));

  /* Autosave hooks — MUST live above the early returns below (rules of
     hooks: the loading render has to execute the same hook sequence).
     Null-safe: the effect no-ops until the sheet is loaded and editable. */
  const editSeqRef = useRef(0);
  const [autoState, setAutoState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    const sheetEditable = !!ts && (ts.status === "Draft" || ts.status === "Rejected");
    if (!ts || !sheetEditable || !dirty || saving || busy) return;
    const timer = window.setTimeout(async () => {
      const seq = editSeqRef.current;
      setAutoState("saving");
      try {
        await crmPost(`/api/timesheets/${ts.id}/entries`, entriesPayload(entries));
        if (editSeqRef.current === seq) {
          await load();
          setAutoState("saved");
        }
        // else: user kept typing — stay dirty, the next pause saves again.
      } catch {
        // Quiet failure: the manual Save button surfaces the real error and
        // nothing is lost — the entries are still on screen, still dirty.
        setAutoState("error");
      }
    }, 1800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, dirty, ts, saving, busy]);

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
    editSeqRef.current += 1;
    setAutoState("idle");
    setDirty(true);
  };

  const saveEntries = async () => {
    setSaving(true);
    try {
      // Full-list upsert; the server recomputes billable hours/days.
      await crmPost(`/api/timesheets/${ts.id}/entries`, entriesPayload(entries));
      showToast("Entries saved");
      await load(); // refresh server-computed billables + summary
    } catch (e: any) {
      showToast(e?.message || "Failed to save entries", "err");
    } finally {
      setSaving(false);
    }
  };

  /* ---------------- autosave (Excel-style) ----------------
     Every pause in typing persists the sheet. This is what makes the
     real-time comp-off credit REAL: work Saturday, type the hours, and the
     credit lands without anyone remembering a Save button. The button stays
     for the "save NOW" instinct.

     The edit-sequence guard is the whole trick: a reload only applies when
     nothing changed while the request was in flight, so autosave can never
     stomp on half-typed hours. If edits raced the save, we skip the reload
     and let the next cycle (which is already scheduled by the dirty state)
     pick them up. */
  const changePeriod = async (start: string | null, end: string | null) => {
    const startDate = start || (ts.period_start_date || "").slice(0, 10);
    const endDate = end || (ts.period_end_date || "").slice(0, 10);
    if (!startDate || !endDate) return;
    try {
      await crmPatch(`/api/timesheets/${ts.id}/period`, {
        start_date: startDate, end_date: endDate,
      });
      showToast("Period updated — day grid adjusted");
      await load();
    } catch (e: any) {
      showToast(e?.message || "Failed to update the period", "err");
      await load(); // snap the inputs back to the server's truth
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
  // View column removed (Aug 2026): the checkbox toggled a stored flag that
  // nothing downstream read — pure noise on a screen people fill 30 times.
  const GRID_COLS = 10;

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
          {/* Editable window (Draft/Rejected): the grid regenerates to match —
              added days appear, removed days are DELETED with their hours.
              The Timesheet Period label above always mirrors these two. */}
          {editable ? (
            <>
              <LabeledValue label="Start Date" value={
                <input
                  type="date"
                  className={`${inputCls} !w-40 text-sm`}
                  value={(ts.period_start_date || "").slice(0, 10)}
                  min={`${ts.year}-${String(ts.month).padStart(2, "0")}-01`}
                  max={(ts.period_end_date || "").slice(0, 10) || undefined}
                  aria-label="Timesheet start date"
                  onChange={(e) => { if (e.target.value) void changePeriod(e.target.value, null); }}
                />
              } />
              <LabeledValue label="End Date" value={
                <input
                  type="date"
                  className={`${inputCls} !w-40 text-sm`}
                  value={(ts.period_end_date || "").slice(0, 10)}
                  min={(ts.period_start_date || "").slice(0, 10) || undefined}
                  aria-label="Timesheet end date"
                  onChange={(e) => { if (e.target.value) void changePeriod(null, e.target.value); }}
                />
              } />
            </>
          ) : (
            <>
              <LabeledValue label="Start Date" value={fmtDate(ts.period_start_date)} />
              <LabeledValue label="End Date" value={fmtDate(ts.period_end_date)} />
            </>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-subtle pt-4">
          <StatusBadge status={ts.status} label={tsStatusLabel(ts.status)} />
          {editable && (
            /* Weekend/holiday repair (27 Aug 2026): sheets generated before the
               policy existed show Sat/Sun as working → Absent + LOP. */
            <button
              type="button"
              className="rounded-control border border-subtle bg-surface-2 px-2.5 py-1 text-xs font-semibold text-secondary transition-colors duration-micro hover:border-strong hover:text-primary"
              onClick={async () => {
                try {
                  const r = await crmPost<{ fixed: number }>(`/api/timesheets/${ts.id}/reclassify-days`);
                  showToast(r.message || "Day types corrected");
                  await load();
                } catch (e: any) {
                  showToast(e?.message || "Failed to fix day types", "err");
                }
              }}
            >
              Fix week-offs / holidays
            </button>
          )}
          {editable && (
            /* Save/Submit live at the FOOT of the page, after every day of the
               period — same pattern as the approval decision. You check the
               whole sheet, then act. This is only a pointer down. */
            <a
              href="#save-submit"
              className="text-xs font-semibold text-sky-600 hover:underline dark:text-sky-400"
            >
              Review the entries below, then save or submit ↓
            </a>
          )}
          {editable && leaveSplit.totalLop > 0 && (
            <span className="text-xs font-semibold text-secondary" role="status">
              Excess leave converts to Loss of Pay ({leaveSplit.totalLop} day{leaveSplit.totalLop === 1 ? "" : "s"}) — non-billable.
            </span>
          )}
          {ts.status === "Submitted" && canApprove && (
            /* The decision itself lives at the FOOT of the page, after every
               day of the period. This is only a pointer to it. */
            <a
              href="#approval-decision"
              className="text-xs font-semibold text-sky-600 hover:underline dark:text-sky-400"
            >
              Awaiting your approval — review the entries below ↓
            </a>
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
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex --
            a horizontally scrollable region must be focusable so keyboard
            users can scroll it; this is the WAI-ARIA recommended pattern. */}
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
                              ? "inline-flex items-center rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 ring-1 ring-inset ring-violet-500/35 dark:text-violet-200"
                              : "inline-flex items-center rounded-full bg-teal-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700 ring-1 ring-inset ring-teal-500/35 dark:text-teal-200"
                          }
                          title={
                            billed
                              ? "Billed to client (Week Off / Holidays Billable or Comp Off Billable) — no leave credit"
                              : "Not billed — Comp-Off leave credited when the sheet is saved (autosaves as you type)"
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
            <span className="inline-flex rounded-full bg-violet-500/25 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-violet-700 dark:text-violet-200">Billable</span>
            Comp Off Billable ON
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex rounded-full bg-teal-500/25 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-teal-700 dark:text-teal-200">Credit</span>
            Comp Off Billable OFF
          </span>
        </div>
        {dirty && (
          <div className="border-t border-subtle bg-warning-soft px-4 py-2 text-xs font-semibold text-warning" role="status">
            Unsaved changes — autosaves in a moment; billable hours/days are recomputed by the server on save.
          </div>
        )}
      </div>

      {/* ------------------------------------------------ save / submit

          Same placement rule as the approval decision below: BELOW the daily
          grid, so the person filling the sheet reaches Save/Submit only after
          scrolling past every day of the period. Acting follows checking. */}
      {editable && (
        <div id="save-submit" className="elev-1 rounded-panel p-4 sm:p-5">
          <h2 className="text-sm font-bold tracking-wide text-primary">Save &amp; Submit</h2>
          <p className="mt-1 text-xs text-muted">
            You have now seen every entry in this period. Save your changes, or submit the
            timesheet for approval — submitted sheets can no longer be edited.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-subtle pt-4">
            <StatusBadge status={ts.status} label={tsStatusLabel(ts.status)} />
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
            <span className="text-xs font-semibold" role="status" aria-live="polite">
              {autoState === "saving" ? (
                <span className="text-secondary">Saving…</span>
              ) : dirty ? (
                <span className="text-warning">
                  {autoState === "error" ? "Autosave failed — use Save entries" : "Unsaved changes — autosaving…"}
                </span>
              ) : (
                <span className="text-success">All changes saved</span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ approval decision

          Deliberately BELOW the daily grid and ABOVE invoice details, not in
          the header toolbar. An approver reaches these buttons only by
          scrolling past every day of the period, so the decision follows the
          review instead of preceding it. Invoicing is a consequence of
          approval, so it reads after it. */}
      {ts.status === "Submitted" && canApprove && (
        <div id="approval-decision" className="elev-1 rounded-panel p-4 sm:p-5">
          <h2 className="text-sm font-bold tracking-wide text-primary">Approval Decision</h2>
          <p className="mt-1 text-xs text-muted">
            You have now seen every entry in this timesheet. Approve it to release the period
            for invoicing, or reject it back to {employeeName || "the employee"} with a reason.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-subtle pt-4">
            <button className={btnPrimary} onClick={() => setConfirm("approve")}>
              <Check size={15} /> Approve
            </button>
            <button className={btnDanger} onClick={() => setShowReject(true)}>
              <X size={15} /> Reject
            </button>
          </div>
        </div>
      )}

      {/* An APPROVED sheet can be rejected until an invoice exists (0075) —
          this is the correction path when policy/rates changed after approval
          and the frozen figures no longer match reality. The server 409s once
          an invoice has been generated. */}
      {ts.status === "Approved" && canApprove && (
        <div className="elev-1 rounded-panel p-4 sm:p-5">
          <h2 className="text-sm font-bold tracking-wide text-primary">Approved</h2>
          <p className="mt-1 text-xs text-muted">
            The invoice figures were frozen when this sheet was approved. If rates or the
            billing policy changed afterwards and those frozen figures are wrong, reject the
            sheet to unlock it — after correction and resubmission, re-approval freezes the
            new figures. This is no longer possible once an invoice has been generated.
          </p>
          <div className="mt-4 border-t border-subtle pt-4">
            <button className={btnDanger} onClick={() => setShowReject(true)}>
              <X size={15} /> Reject (undo approval)
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ invoice details (collapsible) */}
      <InvoiceDetailsSection timesheetId={ts.id} showToast={showToast} summary={summary} />

      {/* ------------------------------------------------ summary / calculated fields */}
      <div className="glass rounded-panel p-4 sm:p-5">
        <h2 className="mb-1 text-sm font-bold tracking-wide text-primary">Summary</h2>
        <p className="mb-3 text-xs text-muted">Rollup of days, hours, leave, and billables for this period.</p>
        {/* Ten tiles, reading order = the story of the month (Aug 2026 request):
            the month → how it split (week off / leave / holiday) → what was
            worked → what bills → comp-off in and out. The old 17-tile wall
            (actual-vs-total twins, LOP, credited-vs-billed) told nobody
            anything at a glance; those figures still exist in the invoice
            calculation where they matter. */}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          <Stat label="Total Month Days" value={num(summary?.total_days)} />
          <Stat label="Week Off" value={num(summary?.total_week_off)} />
          <Stat
            label={(() => {
              // Name what was taken: "Leave (Casual Leave 1)" — the number
              // alone answers "how many", never "which".
              const byType: Record<string, number> = {};
              entries.forEach((e) => {
                if (e.attendance_status !== "Leave" || !e.leave_type) return;
                const half = e.leave_period === "Half_AM" || e.leave_period === "Half_PM";
                byType[e.leave_type] = (byType[e.leave_type] || 0) + (half ? 0.5 : 1);
              });
              const names = Object.entries(byType)
                .map(([t, d]) => `${t} ${round2(d)}`).join(", ");
              return names ? `Leave (${names})` : "Leave";
            })()}
            value={num(dirty ? liveSummary.totalLeaveDays : summary?.total_leave_days ?? liveSummary.totalLeaveDays)}
          />
          <Stat label="Holiday" value={num(summary?.holidays)} />
          {/* LOP appears ONLY when money is actually being lost — a permanent
              zero tile trains the eye to skip it; a tile that shows up is an
              alarm. Red value on purpose: this is the one figure on the sheet
              the employee needs to question before submitting. */}
          {(() => {
            const lop = dirty
              ? liveSummary.totalLopDays
              : Number(summary?.total_loss_of_pay_days ?? liveSummary.totalLopDays ?? 0);
            return Number(lop || 0) > 0 ? (
              <Stat label="Loss of Pay"
                value={<span className="text-danger">{num(lop)}</span>} />
            ) : null;
          })()}
          <Stat label="Total Present Days" value={num(summary?.present_days)} />
          <Stat label="Total Hours Worked" value={num(dirty ? liveSummary.hours : summary?.total_hours_worked ?? summary?.hours_worked)} />
          <Stat label="Total Billable Days" value={num(summary?.total_billable_days)} />
          <Stat label="Total Billable Hours" value={num(summary?.total_billable_hours)} />
          {/* Comp-off tiles follow the project's mode (bill XOR credit):
              BILLED mode — weekend work goes on the invoice, so show what was
              billed; there is no credit to earn or spend.
              CREDIT mode — weekend work earns leave (credited in real time on
              save), so show earned and used. */}
          {policy.comp_off_billable ? (
            <Stat label="Comp-Off Billed" value={num(dirty ? liveSummary.compOffBilled : summary?.comp_off_billed)} />
          ) : (
            <>
              <Stat label="Comp-Off Earned" value={num(dirty ? liveSummary.compOffEarned : summary?.comp_off_earned)} />
              <Stat label="Comp-Off Used" value={num(summary?.comp_off_days)} />
            </>
          )}
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
/* ---------------------------------------------------- PO selection (invoice) */

type PoOption = {
  id: number;
  po_number: string;
  po_type?: string | null;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  total_value?: number | null;
  used_value?: number | null;
  balance_value?: number | null;
  expired?: boolean;
  selectable?: boolean;
  project_allocated?: number | null;
  project_used?: number | null;
  employee_id?: number | null;
  employee_name?: string | null;
  employee_match?: boolean;
};

type PoOptionsPayload = {
  pos: PoOption[];
  selected_po_id: number | null;
  suggested_po_id?: number | null;
  timesheet_employee_name?: string | null;
  rate: {
    month: string;
    billing_unit: string;
    rate: number | null;
    rate_split: boolean;
    sub_periods: Array<{ from: string; to: string; rate: number | null }>;
    source: string;
    project_employee_id?: number;
    current_rate_row?: { id: number; effective_from: string; rate: number | null } | null;
  };
};

const UNIT_LABELS: Record<string, string> = {
  Hourly: "Per Hour", Daily: "Per Day", Monthly: "Per Month", Yearly: "Per Year (billed monthly)",
};

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
};

const dShort = (iso?: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** The gate the reviewer passes through between approval and invoicing: name
 * the PO that funds this invoice. Generate stays disabled until a PO is
 * picked — the ONE exception is a customer with no POs at all, where there is
 * nothing to pick and the invoice legitimately goes out unfunded.
 *
 * The rate panel restates what this month will actually bill (straight from
 * Project Employee → Commercial Details, split shown if a change lands
 * mid-month) so the person committing PO budget can see what they commit. */
function PoSelectModal({ timesheetId, onClose, onGenerated, showToast }: {
  timesheetId: number;
  onClose: () => void;
  onGenerated: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const [data, setData] = useState<PoOptionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [poId, setPoId] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  /* Edit = adjust the row this month bills from; Add = start a new rate on a
     new Effective From date. Same rows the Map Employee wizard writes. */
  const [rateMode, setRateMode] = useState<null | "edit" | "add">(null);
  const [rateDate, setRateDate] = useState("");
  const [rateValue, setRateValue] = useState("");
  const [savingRate, setSavingRate] = useState(false);

  // The exact calculation this invoice will be raised with — shown IN the
  // dialog so "Generate" is an informed confirmation, not a leap of faith.
  // Qty and rate are EDITABLE: the reviewer verifies (or corrects) and only
  // then generates. Edits are sent as overrides and audit-logged server-side.
  const [calc, setCalc] = useState<InvoicePreview | null>(null);
  const [qtyStr, setQtyStr] = useState("");
  const [rateStr, setRateStr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<PoOptionsPayload>(`/api/timesheets/${timesheetId}/po-options`);
      setData(res.data);
      // Preselect the one obvious PO (tagged to this employee, live, covering
      // this month) so Finance just confirms; else the project's funding PO.
      const pre = res.data?.suggested_po_id ?? res.data?.selected_po_id;
      if (pre != null) setPoId(String(pre));
      crmGet<InvoicePreview>(`/api/timesheets/${timesheetId}/invoice-preview`)
        .then((r) => {
          setCalc(r.data);
          const li: any = r.data?.line_items?.[0];
          if (li) {
            setQtyStr(String(li.total_billed_qty ?? ""));
            setRateStr(String(li.rate_per_unit ?? ""));
          }
        }).catch(() => setCalc(null));
    } catch (e: any) {
      setError(e?.message || "Failed to load PO options");
    } finally {
      setLoading(false);
    }
  }, [timesheetId]);
  useEffect(() => { load(); }, [load]);

  const pos = data?.pos || [];
  const selected = pos.find((p) => String(p.id) === poId);
  const noPos = !loading && !error && pos.length === 0;
  const canGenerate = noPos || (!!selected && selected.selectable !== false);

  /* Grouped picker (28 Aug 2026): with per-employee POs, "find the right PO"
     was a hunt through the customer's whole PO book. Order: this employee's
     POs → POs already funding this project → the rest; live before expired
     within each group. Pure presentation — every PO stays selectable. */
  const byLiveness = (a: PoOption, b: PoOption) =>
    Number(!!a.expired) - Number(!!b.expired) ||
    String(b.start_date || "").localeCompare(String(a.start_date || ""));
  const poGroups = [
    { label: data?.timesheet_employee_name
        ? `${data.timesheet_employee_name}'s POs` : "This employee's POs",
      items: pos.filter((p) => p.employee_match).sort(byLiveness) },
    { label: "Allocated to this project",
      items: pos.filter((p) => !p.employee_match && p.project_allocated != null).sort(byLiveness) },
    { label: "Other customer POs",
      items: pos.filter((p) => !p.employee_match && p.project_allocated == null).sort(byLiveness) },
  ].filter((g) => g.items.length > 0);
  const poLabel = (p: PoOption) =>
    `${p.po_number}${p.employee_name ? ` — ${p.employee_name}` : ""}` +
    ` — balance ${inr(p.balance_value)} of ${inr(p.total_value)}` +
    (p.expired ? " (expired)" : p.selectable === false ? ` (${p.status.toLowerCase()})` : "");
  // Soft cross-check, never a block: a PO tagged to a DIFFERENT employee is
  // usually the expensive mistake here, but shared POs are legitimate.
  const mismatch = selected && selected.employee_id != null && !selected.employee_match;
  const isSuggested = selected && data?.suggested_po_id != null && selected.id === data.suggested_po_id;

  /* Toasts render BEHIND this modal, so a failure ("PO balance insufficient")
     was invisible to the user. The error must live inside the dialog, right
     under the button that caused it. */
  const [genError, setGenError] = useState("");

  const generate = async () => {
    setGenerating(true);
    setGenError("");
    try {
      const li: any = calc?.line_items?.[0];
      const qtyN = Number(qtyStr);
      const rateN = Number(rateStr);
      const overrides: Record<string, number> = {};
      // Send overrides only when the reviewer actually changed something —
      // untouched values keep the server's computed calculation.
      if (li && Number.isFinite(qtyN) && qtyN > 0 && qtyN !== Number(li.total_billed_qty)) {
        overrides.quantity = qtyN;
      }
      if (li && Number.isFinite(rateN) && rateN > 0 && rateN !== Number(li.rate_per_unit)) {
        overrides.rate_per_unit = rateN;
      }
      const res = await crmPost<{ invoice: any; timesheet_id: number }>(
        `/api/timesheets/${timesheetId}/generate-invoice`,
        { ...(selected ? { po_id: selected.id } : {}), ...overrides },
      );
      showToast(res.message || "Invoice generated");
      onGenerated();
      onClose();
    } catch (e: any) {
      setGenError(e?.message || "Failed to generate invoice");
    } finally {
      setGenerating(false);
    }
  };

  const openRateForm = (mode: "edit" | "add") => {
    const cur = data?.rate.current_rate_row;
    setRateMode(mode);
    setRateDate(mode === "edit" ? (cur?.effective_from || "") : "");
    setRateValue(mode === "edit" ? (cur?.rate != null ? String(cur.rate) : "") : "");
  };

  const saveRate = async () => {
    const peId = data?.rate.project_employee_id;
    if (!peId || !rateDate || !(Number(rateValue) > 0)) {
      showToast("Enter both an Effective From date and a rate above zero", "err");
      return;
    }
    setSavingRate(true);
    try {
      if (rateMode === "edit" && data?.rate.current_rate_row) {
        await crmPut(`/api/projects/employees/${peId}/rates/${data.rate.current_rate_row.id}`,
          { effective_from: rateDate, rate: Number(rateValue) });
      } else {
        /* A future-dated rate must NOT become "current" yet — it takes over on
           its date. Only a rate starting today or earlier is current now. */
        const today = new Date().toISOString().slice(0, 10);
        await crmPost(`/api/projects/employees/${peId}/rates`,
          { effective_from: rateDate, rate: Number(rateValue), is_current_rate: rateDate <= today });
      }
      showToast(rateMode === "edit" ? "Rate updated" : "Rate added");
      setRateMode(null);
      await load();      // re-derive the month's rate + splits from the server
      onGenerated();     // parent refreshes its preview/list — amounts changed
    } catch (e: any) {
      showToast(e?.message || "Failed to save rate", "err");
    } finally {
      setSavingRate(false);
    }
  };

  const row = "flex items-baseline justify-between gap-4 text-sm";
  const lbl = "text-muted";
  const val = "font-semibold text-primary";

  return (
    <Modal title="Select PO for this invoice" onClose={onClose}>
      {loading ? (
        <Spinner label="Loading PO options…" />
      ) : error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : (
        <div className="space-y-4">
          {data?.rate && (
            <div className="rounded-card border border-subtle bg-surface-2/60 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-bold uppercase tracking-wide text-muted">
                  Rate applied — {monthLabel(data.rate.month)}
                </div>
                {data.rate.project_employee_id != null && rateMode === null && (
                  <div className="flex gap-1.5">
                    {data.rate.current_rate_row && (
                      <button type="button"
                        className={`${btnSecondary} !px-2 !py-1 text-xs`}
                        title="Adjust the rate this month bills from"
                        onClick={() => openRateForm("edit")}
                      >
                        Edit Rate
                      </button>
                    )}
                    <button type="button"
                      className={`${btnSecondary} !px-2 !py-1 text-xs`}
                      title="Start a new rate from a new Effective From date"
                      onClick={() => openRateForm("add")}
                    >
                      Add Rate
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-1 text-lg font-bold text-primary">
                {inr(data.rate.rate)}{" "}
                <span className="text-sm font-semibold text-secondary">
                  {UNIT_LABELS[data.rate.billing_unit] || data.rate.billing_unit}
                </span>
              </div>
              {data.rate.rate_split && (
                <div className="mt-1 space-y-0.5 text-xs text-secondary">
                  <div className="font-semibold text-warning">Rate changes mid-month — billed per stretch:</div>
                  {data.rate.sub_periods.map((s, i) => (
                    <div key={i}>{dShort(s.from)} – {dShort(s.to)}: {inr(s.rate)}</div>
                  ))}
                </div>
              )}
              <div className="mt-1 text-[11px] text-muted">{data.rate.source}</div>
              {rateMode !== null && (
                <div className="mt-3 rounded-card border border-subtle bg-surface-1 p-3">
                  <div className="text-xs font-bold text-primary">
                    {rateMode === "edit" ? "Edit the current rate" : "Add a new rate"}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {rateMode === "edit"
                      ? "Changes the stored Commercial Details row this month bills from."
                      : "The previous rate automatically ends the day before this one starts."}
                  </p>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Field label="Effective from" required>
                      <input type="date" className={inputCls} value={rateDate}
                        onChange={(e) => setRateDate(e.target.value)} />
                    </Field>
                    <Field label={`Rate (${UNIT_LABELS[data.rate.billing_unit] || data.rate.billing_unit})`} required>
                      <input type="number" min={0} step="0.01" className={inputCls} value={rateValue}
                        onChange={(e) => setRateValue(e.target.value)} placeholder="0.00" />
                    </Field>
                  </div>
                  <div className="mt-2 flex justify-end gap-2">
                    <button type="button" className={`${btnSecondary} !px-2.5 !py-1 text-xs`}
                      onClick={() => setRateMode(null)} disabled={savingRate}>Cancel</button>
                    <button type="button" className={`${btnPrimary} !px-2.5 !py-1 text-xs`}
                      onClick={saveRate} disabled={savingRate}>
                      {savingRate ? "Saving…" : rateMode === "edit" ? "Save Rate" : "Add Rate"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {noPos ? (
            <div className="rounded-card border border-subtle bg-warning-soft px-4 py-3 text-sm text-warning">
              This customer has no purchase orders — the invoice will be generated without a PO.
            </div>
          ) : (
            <>
              <Field label="Purchase Order" required>
                <select className={inputCls} value={poId}
                  onChange={(e) => { setPoId(e.target.value); setGenError(""); }}>
                  <option value="">Select PO…</option>
                  {/* Expired POs stay selectable (labelled) — billing often
                      continues while a renewal is signed. Only cancelled POs
                      are disabled. */}
                  {poGroups.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.items.map((p) => (
                        <option key={p.id} value={p.id} disabled={p.selectable === false}>
                          {poLabel(p)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </Field>
              {isSuggested && (
                <div className="rounded-card border border-success/30 bg-success-soft px-3 py-2 text-xs font-semibold text-success">
                  Suggested automatically — this PO is raised for{" "}
                  {data?.timesheet_employee_name || "this employee"} and covers this month. Just verify and generate.
                </div>
              )}
              {mismatch && (
                <div className="rounded-card border border-warning/30 bg-warning-soft px-3 py-2 text-xs font-semibold text-warning">
                  Heads up: this PO is raised for <b>{selected!.employee_name}</b>, not{" "}
                  <b>{data?.timesheet_employee_name || "this timesheet's employee"}</b>. You can still
                  use it (shared POs are fine) — just make sure it's the PO you mean to draw down.
                </div>
              )}
              {selected && (
                <div className="space-y-1.5 rounded-card border border-subtle px-4 py-3">
                  <div className={row}>
                    <span className={lbl}>PO</span>
                    <span className={val}>{selected.po_number}{selected.po_type ? ` · ${selected.po_type}` : ""}</span>
                  </div>
                  {selected.employee_name && (
                    <div className={row}>
                      <span className={lbl}>Raised for</span>
                      <span className={val}>{selected.employee_name}</span>
                    </div>
                  )}
                  <div className={row}><span className={lbl}>Total PO amount</span><span className={val}>{inr(selected.total_value)}</span></div>
                  <div className={row}><span className={lbl}>Used amount</span><span className={val}>{inr(selected.used_value)}</span></div>
                  <div className={row}>
                    <span className={lbl}>Balance amount</span>
                    <span className={`${val} text-success`}>{inr(selected.balance_value)}</span>
                  </div>
                  <div className={row}><span className={lbl}>PO starts</span><span className={val}>{dShort(selected.start_date)}</span></div>
                  {selected.end_date && (
                    <div className={row}>
                      <span className={lbl}>PO ends</span>
                      <span className={val}>
                        {dShort(selected.end_date)}
                        {selected.expired && (
                          <span className="ml-2 inline-flex items-center rounded-control bg-warning-soft px-1.5 py-0.5 text-[11px] font-bold text-warning">
                            Expired
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                  {selected.project_allocated != null && (
                    <div className={row}>
                      <span className={lbl}>This project</span>
                      <span className={val}>{inr(selected.project_used)} used of {inr(selected.project_allocated)} allocated</span>
                    </div>
                  )}
                  <div className={row}><span className={lbl}>Status</span><StatusBadge status={selected.status} /></div>
                </div>
              )}
            </>
          )}

          {calc && calc.line_items?.length > 0 && (
            <div className="rounded-card border border-subtle bg-surface-2/40 px-4 py-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
                This invoice will be raised as
              </p>
              {calc.line_items.slice(0, 1).map((li: any, i: number) => {
                const qtyN = Number(qtyStr);
                const rateN = Number(rateStr);
                const liveAmount = Number.isFinite(qtyN) && Number.isFinite(rateN)
                  ? Math.round(qtyN * rateN * 100) / 100 : Number(li.amount);
                const edited = qtyN !== Number(li.total_billed_qty) || rateN !== Number(li.rate_per_unit);
                return (
                  <div key={i} className="space-y-2 text-sm">
                    <div className="font-semibold text-primary">{li.description}</div>
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-semibold text-muted">Qty</span>
                        <input type="number" min={0} step="0.01" className={`${inputCls} !w-28 text-xs`}
                          value={qtyStr} onChange={(e) => setQtyStr(e.target.value)} />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-semibold text-muted">Rate</span>
                        <input type="number" min={0} step="0.01" className={`${inputCls} !w-36 text-xs`}
                          value={rateStr} onChange={(e) => setRateStr(e.target.value)} />
                      </label>
                      <div className="pb-1 text-xs text-secondary">
                        {Number(li.loss_of_pay_days || 0) > 0 && (
                          <span className="mr-4 text-danger">LOP {li.loss_of_pay_days}</span>
                        )}
                        {Number(li.no_billing_days_excluded || 0) > 0 && (
                          <span className="mr-4 text-warning" title={li.no_billing_until
                            ? `Initial no-billing period runs until ${li.no_billing_until}`
                            : undefined}>
                            No-billing period: {li.no_billing_days_excluded} day{Number(li.no_billing_days_excluded) === 1 ? "" : "s"} excluded
                          </span>
                        )}
                        <span className="font-semibold text-primary">Amount {inr(liveAmount)}</span>
                      </div>
                    </div>
                    {edited && (
                      <p className="text-[11px] font-semibold text-warning">
                        Edited from the computed calculation (qty {li.total_billed_qty}, rate {inr(li.rate_per_unit)}) —
                        the change is recorded in the activity log.
                      </p>
                    )}
                  </div>
                );
              })}
              <div className="mt-2 flex justify-between border-t border-subtle pt-2 text-sm">
                <span className="font-semibold text-secondary">Sub-total</span>
                <span className="font-bold text-primary">
                  {inr(Number.isFinite(Number(qtyStr)) && Number.isFinite(Number(rateStr))
                    ? Math.round(Number(qtyStr) * Number(rateStr) * 100) / 100
                    : calc.totals?.sub_total)}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-muted">
                Verify — or correct qty/rate here — then Generate. The invoice is created exactly
                from these figures.
              </p>
              {/* Approval froze these figures. Silence here is what made the
                  old behaviour dangerous — a policy edit after approval used
                  to change the bill with nobody deciding it. */}
              {(calc.totals as any)?.figures_drifted ? (
                <p className="mt-2 rounded-control bg-warning/10 px-2.5 py-2 text-[11px] font-semibold text-warning">
                  ⚠ Billing policy or calendar changed after approval. A live recompute
                  now gives {inr((calc.totals as any).live_sub_total)}, but the figures
                  frozen at approval (shown above) are what will be billed. If the new
                  figures are the intended ones, reject and re-approve this timesheet.
                </p>
              ) : (calc.totals as any)?.frozen_at ? (
                <p className="mt-1 text-[11px] text-muted">
                  Figures frozen at approval
                  {(() => { const d = new Date((calc.totals as any).frozen_at); return Number.isNaN(d.getTime()) ? "" : ` on ${d.toLocaleDateString()}`; })()}.
                </p>
              ) : null}
            </div>
          )}

          <div className="border-t border-subtle pt-4">
            {genError && (
              <div role="alert"
                className="mb-3 rounded-card border border-danger/40 bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
                {genError}
                {/PO balance/i.test(genError) && selected && (
                  <div className="mt-1 text-xs font-normal">
                    {selected.po_number} has {inr(selected.balance_value)} left — less than this
                    invoice's total. Pick another PO, or top up / re-allocate this one under
                    Purchase Orders.
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={onClose} disabled={generating}>Cancel</button>
              <button
                type="button"
                className={btnPrimary}
                disabled={!canGenerate || generating}
                title={!canGenerate ? "Select a PO first" : undefined}
                onClick={generate}
              >
                <FilePlus2 size={15} /> {generating ? "Generating…" : "Generate Invoice"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function InvoiceDetailsSection({
  timesheetId, showToast, summary,
}: {
  timesheetId: number;
  showToast: (msg: string, kind?: "ok" | "err") => void;
  summary?: Summary | null;
}) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const canInvoice = useCanAct("invoices", "create", useHasRole("Finance", "RMG"));
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [selectingPo, setSelectingPo] = useState(false);

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

  const cell = "px-3 py-2";
  const breakdownBtn = (
    <button
      type="button"
      className={`${btnSecondary} !px-2.5 !py-1 text-xs whitespace-nowrap`}
      onClick={() => setShowBreakdown(true)}
      title="Days worked, paid days/hours, LOP, comp-off and tax behind this amount"
    >
      Breakdown
    </button>
  );
  const invoiceCell = preview?.linked_invoice ? (
    <span className="inline-flex flex-wrap items-center gap-2 whitespace-nowrap">
      {breakdownBtn}
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
    breakdownBtn
  );

  const li: any = preview?.line_items?.[0] || null;
  const totals: any = preview?.totals || {};

  return (
    <div className="elev-1 overflow-hidden rounded-panel">
      {/* Payment breakdown popup — the WHY behind the invoice amount, in the
          order money people read it: worked → paid → deductions → tax. */}
      {showBreakdown && (
        <Modal title="Payment breakdown" onClose={() => setShowBreakdown(false)} medium>
          {!preview ? (
            <Spinner label="Loading breakdown…" />
          ) : (
            <div className="space-y-4 text-sm">
              {li && <div className="font-semibold text-primary">{li.description}</div>}
              {(totals as any)?.figures_drifted && (
                <p className="rounded-control bg-warning/10 px-2.5 py-2 text-[11px] font-semibold text-warning">
                  ⚠ Billing policy or calendar changed after this sheet was approved.
                  A live recompute now gives {inr((totals as any).live_sub_total)};
                  the figures below were frozen at approval and are what gets billed.
                </p>
              )}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                <LabeledValue label="Days worked" value={num(summary?.total_no_of_days_worked ?? summary?.present_days)} />
                <LabeledValue label="Hours worked" value={num(summary?.total_hours_worked ?? summary?.hours_worked)} />
                <LabeledValue label="Paid (billable) days" value={num(summary?.total_billable_days)} />
                <LabeledValue label="Paid (billable) hours" value={num(summary?.total_billable_hours)} />
                <LabeledValue label="Paid leave days" value={num(li?.leave_billable_days)} />
                <LabeledValue
                  label="Loss of Pay days"
                  value={<span className={Number(li?.loss_of_pay_days || 0) > 0 ? "text-danger font-semibold" : undefined}>
                    {num(li?.loss_of_pay_days)}
                  </span>}
                />
                {Number(li?.lop_covered_days || 0) > 0 && (
                  <LabeledValue
                    label="LOP covered by weekend work"
                    value={<span className="font-semibold text-success">{num(li.lop_covered_days)}</span>}
                  />
                )}
                <LabeledValue label="Comp-off credited" value={num(summary?.comp_off_earned)} />
                <LabeledValue label="Comp-off billed (qty)" value={num(li?.comp_off_billable_qty)} />
                {li?.comp_off_billable_qty != null && Number(li.comp_off_billable_qty) > 0 && (() => {
                  // Qty is HOURS for Hourly, DAY-fractions for Daily/Monthly.
                  // Hourly/Daily: rate_per_unit is already per hour / per day.
                  // Monthly/Yearly: rate_per_unit is the MONTH price — one
                  // comp-off day is worth the per-day charge, not the month.
                  const perUnit = (li.billing_unit === "Monthly" || li.billing_unit === "Yearly")
                    ? Number(li.per_day_charge || 0)
                    : Number(li.rate_per_unit || 0);
                  return (
                    <LabeledValue label="Comp-off amount"
                      value={inr(Math.round(Number(li.comp_off_billable_qty) * perUnit * 100) / 100)} />
                  );
                })()}
              </div>
              {/* Rate basis — WHICH rate this project bills in (from the
                  Project Employee record) and what one day / one hour of this
                  employee costs in this period, so a manager can sanity-check
                  the LOP deduction without a calculator. */}
              {li?.billing_unit && (
                <div className="rounded-control bg-surface-2 px-3 py-2 text-xs">
                  <div className="font-semibold text-primary">
                    Rate basis: {inr(li.rate_per_unit)}
                    {" / "}
                    {li.billing_unit === "Yearly" ? "Month (Yearly contract ÷ 12)"
                      : li.billing_unit === "Monthly" ? "Month"
                      : li.billing_unit === "Daily" ? "Day" : "Hour"}
                    <span className="ml-1 font-normal text-secondary">— from project rate ({li.billing_unit})</span>
                  </div>
                  <div className="mt-0.5 text-secondary">
                    {Number(li.working_days_in_period || 0) > 0 && (
                      <>This period: {num(li.working_days_in_period)} working days{" · "}</>
                    )}
                    {li.per_day_charge != null && <>{inr(li.per_day_charge)} / day</>}
                    {li.per_day_charge != null && li.per_hour_charge != null && " · "}
                    {li.per_hour_charge != null && (
                      <>{inr(li.per_hour_charge)} / hour (at {num(li.hours_per_full_day)} h/day)</>
                    )}
                  </div>
                </div>
              )}
              <div className="space-y-1.5 border-t border-subtle pt-3">
                <div className="flex justify-between">
                  <span className="text-secondary">Qty × Rate</span>
                  <span>
                    {num(li?.total_billed_qty)} × {inr(li?.rate_per_unit)}
                    {li?.billing_unit ? (
                      <span className="text-secondary">
                        {" / "}{li.billing_unit === "Hourly" ? "Hour" : li.billing_unit === "Daily" ? "Day" : "Month"}
                      </span>
                    ) : null}
                  </span>
                </div>
                {Number(li?.loss_of_pay_days || 0) > 0 && li?.per_day_charge != null && (
                  <div className="flex justify-between text-xs">
                    <span className="text-secondary">incl. Loss of Pay deduction</span>
                    <span className="text-danger">
                      − {inr(Math.round(Number(li.loss_of_pay_days) * Number(li.per_day_charge) * 100) / 100)}
                      {" "}({num(li.loss_of_pay_days)} day × {inr(li.per_day_charge)})
                    </span>
                  </div>
                )}
                {/* Monthly only: billed weekend/holiday work is an ADDITION on
                    top of the flat month — say so, or "Comp-Off Billed 1" reads
                    like a note while the sub-total looks unchanged. Hourly and
                    Daily already carry these inside the quantity itself. */}
                {(li?.billing_unit === "Monthly" || li?.billing_unit === "Yearly")
                  && Number(li?.comp_off_billable_qty || 0) > 0 && li?.per_day_charge != null && (
                  <div className="flex justify-between text-xs">
                    <span className="text-secondary">incl. Comp-off billed (weekend/holiday work)</span>
                    <span className="text-success">
                      + {inr(Math.round(Number(li.comp_off_billable_qty) * Number(li.per_day_charge) * 100) / 100)}
                      {" "}({num(li.comp_off_billable_qty)} day × {inr(li.per_day_charge)})
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-secondary">Sub-total</span>
                  <span className="font-semibold">{inr(totals.sub_total)}</span>
                </div>
                {totals.tax_amount != null ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-secondary">
                        Tax (GST{totals.gst?.intra != null ? (totals.gst.intra ? " — CGST + SGST" : " — IGST") : ""})
                      </span>
                      <span>{inr(totals.tax_amount)}</span>
                    </div>
                    <div className="flex justify-between border-t border-subtle pt-1.5 text-base">
                      <span className="font-semibold text-secondary">Grand total</span>
                      <span className="font-bold text-primary">{inr(totals.grand_total)}</span>
                    </div>
                    <p className="text-[11px] text-muted">
                      Tax is advisory here (computed from the auto-resolved PO/branch);
                      the binding figure is fixed when the invoice is generated.
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] text-muted">
                    Tax not computable yet — no PO or buyer state code on file.
                  </p>
                )}
              </div>
            </div>
          )}
        </Modal>
      )}
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
                    <div className="mt-4 flex items-center justify-end gap-3">
                      <span className="text-xs text-muted">
                        Opens a review popup: verify or edit Qty and Rate, pick the funding PO,
                        then confirm — nothing is created until you do.
                      </span>
                      {/* Opens the verification dialog — editable calculation +
                          PO selection. The invoice cannot be generated until
                          both are confirmed there. */}
                      <button
                        className={btnPrimary}
                        disabled={!preview.can_generate}
                        onClick={() => setSelectingPo(true)}
                      >
                        <FilePlus2 size={15} /> Verify &amp; Generate Invoice…
                      </button>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {selectingPo && (
        <PoSelectModal
          timesheetId={timesheetId}
          onClose={() => setSelectingPo(false)}
          onGenerated={loadPreview}
          showToast={showToast}
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
  /* Who may decide, not who may look. HR keeps full visibility of this tab —
     they just get "Open" instead of "Review", because the decision is RMG's,
     Sales's or (via isSuperAdmin) Admin/CEO's. */
  const canAct = useCanAct("timesheets", "edit", useHasRole("RMG", "Sales"));
  const canInvoice = useCanAct("invoices", "create", useHasRole("Finance", "RMG"));
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [status, setStatus] = useState("");
  /* Approve / reject are no longer reachable from this list, and Generate
     Invoice now goes through the PO selection gate rather than firing
     directly — the reviewer names the funding PO first. */
  const [invoicingId, setInvoicingId] = useState<number | null>(null);

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
                  <tr
                    key={id}
                    className="row-hover cursor-pointer border-b border-subtle transition-colors duration-micro ease-smooth active:bg-surface-0"
                    onClick={() => crmNavigate(`timesheets/${id}`)}
                    title="Open the full timesheet"
                  >
                    {/* stopPropagation: a button in here is its own intent — it
                        must not also open the row behind it. Same rule
                        DataTable applies to its selection checkbox. */}
                    <td className={cell} onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-wrap gap-1">
                        {/* Approve / Reject deliberately do NOT live here. A
                            decision taken off a summary row is a decision taken
                            without reading the timesheet, so the only route to
                            them is opening it — they sit at the foot of the
                            detail page, under the daily grid. */}
                        <button
                          type="button"
                          className={`${canAct && submitted ? btnPrimary : btnSecondary} !px-2 !py-1 text-xs`}
                          onClick={() => crmNavigate(`timesheets/${id}`)}
                          title={canAct && submitted
                            ? "Open the timesheet, review the entries, then approve or reject"
                            : "Open the timesheet"}
                        >
                          {canAct && submitted ? "Review" : "Open"}
                        </button>
                        {canInvoice && (
                          <button type="button"
                            className={`${btnSecondary} !px-2 !py-1 text-xs`}
                            disabled={!approved || hasInvoice}
                            title="Select the funding PO, then generate"
                            onClick={() => setInvoicingId(id)}
                          >
                            Generate Invoice…
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
                    {/* Uploading or removing an attachment is its own intent too. */}
                    <td className={cell} onClick={(e) => e.stopPropagation()}>
                      <AttachmentList timesheetId={id} attachments={r.attachments} onChange={load} showToast={showToast} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {invoicingId != null && (
        <PoSelectModal
          timesheetId={invoicingId}
          onClose={() => setInvoicingId(null)}
          onGenerated={load}
          showToast={showToast}
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
  const canView = useCanAct("timesheets", "view", useHasRole("HR", "Finance", "RMG"));
  const canRemind = useCanAct("timesheets", "edit", useHasRole("HR"));
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
