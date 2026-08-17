/** Payroll — the monthly attendance extract salary processing needs.
 *
 * Every number here already existed inside timesheets; it just never left the
 * system, so someone opened each timesheet and copied figures by hand. This
 * page aggregates one month per employee (a person on two projects gets ONE
 * row, because they get one salary) and exports a CSV for accounting.
 *
 * Loss of Pay is the column that reduces someone's pay, so it is emphasised
 * and comes straight from the same figure the timesheet and invoice show —
 * payroll can never quietly disagree with what the employee already saw.
 * Timesheets that are not Approved are flagged rather than dropped: a missing
 * timesheet is a payroll problem, and hiding it makes it a silent one.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Wallet } from "lucide-react";
import { crmGet } from "../api";
import { useHasRole } from "../CrmApp";
import { ErrorBox, Field, Spinner, btnPrimary, btnSecondary, inputCls, useToast } from "../components/ui";

type PayrollRow = {
  employee_id: number;
  employee_code?: string | null;
  employee_name: string;
  employee_email?: string | null;
  projects: string;
  timesheet_count: number;
  all_approved: boolean;
  pending: string;
  total_days: number;
  working_days: number;
  days_worked: number;
  present_days: number;
  absent_days: number;
  half_days: number;
  leave_days: number;
  loss_of_pay_days: number;
  comp_off_days: number;
  week_offs: number;
  holidays: number;
  hours_worked: number;
  billable_days: number;
};

type PayrollData = {
  month: number;
  year: number;
  employees: PayrollRow[];
  totals: {
    employees: number;
    timesheets: number;
    not_approved: number;
    loss_of_pay_days: number;
    days_worked: number;
  };
};

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const COLUMNS: Array<{ key: keyof PayrollRow; label: string; num?: boolean; strong?: boolean }> = [
  { key: "employee_code", label: "Employee ID" },
  { key: "employee_name", label: "Employee" },
  { key: "projects", label: "Projects" },
  { key: "working_days", label: "Working", num: true },
  { key: "days_worked", label: "Worked", num: true },
  { key: "leave_days", label: "Leave", num: true },
  { key: "loss_of_pay_days", label: "Loss of Pay", num: true, strong: true },
  { key: "comp_off_days", label: "Comp Off", num: true },
  { key: "week_offs", label: "Week Offs", num: true },
  { key: "holidays", label: "Holidays", num: true },
  { key: "hours_worked", label: "Hours", num: true },
];

function csvEscape(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** `embedded` — rendered as an inner tab (Timesheets → Payroll): the host page
 * owns the h1, so we show only the description line. */
export function PayrollPage({ embedded = false }: { embedded?: boolean } = {}) {
  const canView = useHasRole("HR", "Finance");
  const [toast, notify] = useToast();
  const now = new Date();
  // Default to the month that just ended — payroll is always run in arrears.
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [month, setMonth] = useState(prev.getMonth() + 1);
  const [year, setYear] = useState(prev.getFullYear());
  const [data, setData] = useState<PayrollData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<PayrollData>(`/api/payroll/summary?month=${month}&year=${year}`);
      setData(res.data);
    } catch (e: any) {
      setError(e?.message || "Failed to load payroll extract");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [month, year]);
  useEffect(() => { if (canView) load(); }, [canView, load]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = data?.employees || [];
    if (!q) return all;
    return all.filter((r) =>
      [r.employee_name, r.employee_code, r.employee_email, r.projects]
        .some((v) => (v || "").toLowerCase().includes(q)));
  }, [data, search]);

  const exportCsv = () => {
    if (!rows.length) {
      notify("Nothing to export for this month", "err");
      return;
    }
    const headers = ["Employee ID", "Employee Name", "Email", "Projects", "Calendar Days",
      "Working Days", "Days Worked", "Present", "Half Days", "Absent", "Leave Days",
      "Loss of Pay Days", "Comp Off Days", "Week Offs", "Holidays", "Hours Worked",
      "Billable Days", "Timesheets", "Not Approved"];
    const body = rows.map((r) => [
      r.employee_code, r.employee_name, r.employee_email, r.projects, r.total_days,
      r.working_days, r.days_worked, r.present_days, r.half_days, r.absent_days,
      r.leave_days, r.loss_of_pay_days, r.comp_off_days, r.week_offs, r.holidays,
      r.hours_worked, r.billable_days, r.timesheet_count, r.pending,
    ]);
    const csv = [headers, ...body].map((line) => line.map(csvEscape).join(",")).join("\n");
    // BOM so Excel opens UTF-8 names correctly.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `karnex-payroll-${year}-${String(month).padStart(2, "0")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    notify(`Exported ${rows.length} employee row(s)`);
  };

  if (!canView) {
    return <ErrorBox error="Access denied: Payroll is available to HR, Finance and Admin." />;
  }

  const cell = "px-3 py-2";
  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - 4 + i);

  return (
    <div>
      {toast}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          {!embedded && <h1 className="text-display text-xl font-bold text-primary">Payroll</h1>}
          <p className="mt-0.5 text-sm text-muted">
            Monthly attendance extract for salary processing — days worked, leave, loss of pay
            and comp-off per employee, straight from approved timesheets.
          </p>
        </div>
        <button className={btnPrimary} onClick={exportCsv} disabled={!rows.length}>
          <Download size={15} /> Export CSV
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-card border border-subtle bg-surface-1 p-3">
        <Field label="Month">
          <select className={inputCls} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </Field>
        <Field label="Year">
          <select className={inputCls} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
        <Field label="Search">
          <input className={inputCls} value={search} placeholder="Employee, ID or project…"
            onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <button className={`${btnSecondary} mb-1`} onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div className="mb-3"><ErrorBox error={error} onRetry={load} /></div>}

      {data && !loading && (
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Employees", value: data.totals.employees },
            { label: "Timesheets", value: data.totals.timesheets },
            { label: "Total days worked", value: data.totals.days_worked },
            { label: "Total loss of pay", value: data.totals.loss_of_pay_days, warn: data.totals.loss_of_pay_days > 0 },
          ].map((s) => (
            <div key={s.label} className="rounded-card border border-subtle bg-surface-1 px-4 py-3">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted">{s.label}</div>
              <div className={`mt-0.5 text-xl font-bold ${s.warn ? "text-warning" : "text-primary"}`}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {data && data.totals.not_approved > 0 && (
        <div className="mb-3 rounded-card border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning">
          <b>{data.totals.not_approved} employee(s)</b> have timesheets that are not approved yet.
          Their figures below can still change — approve the timesheets before paying.
        </div>
      )}

      {loading ? (
        <Spinner label="Building payroll extract…" />
      ) : (
        <div className="elev-1 overflow-hidden rounded-panel">
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-subtle text-left text-xs font-bold uppercase tracking-wide text-muted">
                  {COLUMNS.map((c) => (
                    <th key={String(c.key)} className={`${cell} ${c.num ? "text-right" : ""}`}>{c.label}</th>
                  ))}
                  <th className={cell}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length + 1} className="px-4 py-8 text-center text-muted">
                      No timesheets for {MONTHS[month - 1]} {year}
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.employee_id} className="border-b border-subtle last:border-b-0">
                    {COLUMNS.map((c) => {
                      const v = r[c.key];
                      const isLop = c.key === "loss_of_pay_days";
                      return (
                        <td key={String(c.key)}
                          className={`${cell} ${c.num ? "text-right" : ""} ${
                            isLop && Number(v) > 0 ? "font-bold text-warning"
                              : c.key === "employee_name" ? "font-semibold text-primary" : "text-secondary"
                          }`}>
                          {v == null || v === "" ? "—" : String(v)}
                        </td>
                      );
                    })}
                    <td className={cell}>
                      {r.all_approved ? (
                        <span className="inline-flex items-center rounded-control bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">
                          Approved
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-control bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning"
                          title={r.pending}>
                          Pending
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 border-t border-subtle px-4 py-2 text-xs text-muted">
            <Wallet size={13} />
            Calendar figures (working days, week-offs, holidays) are the month&apos;s, not a sum across
            projects — one person still has one month.
          </div>
        </div>
      )}
    </div>
  );
}
