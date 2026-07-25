/** Customer Branch-wise Leave & Holiday Policy — View / Edit.
 * Blocks: Branch Identity · Projects · Holiday Billing · Leave & Holiday Billing ·
 * Billing Properties · Billable Leave Policy.
 * API: GET /api/customers/branches/{id}/policy  (+ branch PUT, holiday-years, holidays, leave policies)
 * Tokens only — Linear-meets-Stripe. */
import React, { useCallback, useEffect, useState } from "react";
import { CalendarDays, ChevronDown, ChevronRight, Lock, LockOpen, Pencil, Plus, Power, Save } from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut, crmPatch } from "../api";
import { HolidayNameField } from "../components/HolidayNameField";
import { EditBranchWizard } from "../components/BranchWizardModal";
import { crmNavigate, useCrmParams } from "../routerHooks";
import { CrmBreadcrumb } from "../components/CrmBreadcrumb";
import { DataTable, type Column } from "../components/DataTable";
import {
  ConfirmModal, EmptyState, ErrorBox, Field, KpiCard, Modal, Spinner, StatusBadge,
  btnPrimary, btnSecondary, focusRing, inputCls, useToast,
} from "../components/ui";

const OBSERVANCE = ["Mandatory", "Optional"];
const fmtDate = (d?: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString() : "—");

type BranchHoliday = {
  id: number;
  holiday_name_id?: number | null;
  name: string;
  holiday_date: string;
  observance: string;
  is_active: boolean;
};

const num = (v?: number | null) => (v == null ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const yesNo = (v?: boolean | null) => (v ? "Yes" : "No");

type HolidayYear = { id: number; calendar_year: number; holiday_count: number | null; is_freeze: boolean };
type LeavePolicyRow = {
  id: number; leave_name?: string | null; leave_credit_type?: string | null; leave_expire?: string | null;
  is_max_limit?: boolean; prorate_balance_credit?: boolean; leave_credit_balance?: number | null;
  initial_credit_balance?: number | null; maximum_carry_forward?: number | null;
  leave_credit_timing?: string | null; effective_date?: string | null;
};
type LinkedProject = { id: number; name: string; status?: string | null };
type BranchPolicy = {
  id: number; customer_id: number; branch_name: string; branch_legal_name?: string | null;
  billing_address?: string | null; gstin?: string | null; pan?: string | null; customer_name?: string | null;
  holidays_billable?: boolean | null; weekoff_billable?: boolean | null; leave_billable?: boolean | null;
  comp_off_billable?: boolean | null;
  hours_required_half_day?: number | null; hours_required_full_day?: number | null;
  hours_required_half_day_comp_off?: number | null; hours_required_full_day_comp_off?: number | null;
  working_hours_per_day?: number | null;
  billing_frequency?: string | null; billing_cycle_start_day?: number | null; billing_cycle_end_day?: number | null;
  is_max_billable_hours_per_day?: boolean; max_billable_hours_per_day?: number | null;
  is_max_billable_hours_per_month?: boolean; max_billable_hours_per_month?: number | null;
  is_max_billable_days_per_month?: boolean; max_billable_days_per_month?: number | null;
  is_initial_no_billing_period?: boolean; initial_no_billing_qty?: number | null; initial_no_billing_period?: string | null;
  holiday_years: HolidayYear[]; leave_policies: LeavePolicyRow[]; linked_projects: LinkedProject[];
};

function Block({ title, hint, action, children }: {
  title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-card border border-subtle bg-surface-1 p-4">
      <div className="fx-hairline-b flex flex-wrap items-center justify-between gap-2 pb-2">
        <div>
          <h2 className="text-sm font-semibold text-primary">{title}</h2>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="text-sm text-primary">{children}</div>
    </div>
  );
}

export function BranchPolicyPage() {
  const { id } = useCrmParams();
  const [toast, notify] = useToast();
  const [data, setData] = useState<BranchPolicy | null>(null);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Partial<BranchPolicy>>({});
  const [saving, setSaving] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await crmGet<BranchPolicy>(`/api/customers/branches/${id}/policy`);
      setData(res.data);
      setForm(res.data);
    } catch (e: any) { setErr(String(e?.message || e)); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const setF = (k: keyof BranchPolicy, v: unknown) => setForm((s) => ({ ...s, [k]: v }));

  const savePolicy = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const keys: (keyof BranchPolicy)[] = [
        "holidays_billable", "weekoff_billable", "leave_billable", "comp_off_billable",
        "hours_required_half_day", "hours_required_full_day", "hours_required_half_day_comp_off",
        "hours_required_full_day_comp_off", "working_hours_per_day",
        "billing_frequency", "billing_cycle_start_day", "billing_cycle_end_day",
        "is_max_billable_hours_per_day", "max_billable_hours_per_day",
        "is_max_billable_hours_per_month", "max_billable_hours_per_month",
        "is_max_billable_days_per_month", "max_billable_days_per_month",
        "is_initial_no_billing_period", "initial_no_billing_qty", "initial_no_billing_period",
      ];
      const patch: Record<string, unknown> = {};
      keys.forEach((k) => { patch[k] = (form as any)[k]; });
      await crmPut(`/api/customers/${data.customer_id}/branches/${data.id}`, patch);
      notify("Branch policy saved");
      setEdit(false);
      load();
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setSaving(false); }
  };

  const addLeaveTemplate = async () => {
    if (!data) return;
    await crmPost(`/api/customer-leave-policies`, {
      customer_id: data.customer_id, branch_id: data.id, leave_type_id: null,
      leave_credit_type: "Monthly", leave_credit_timing: "Start_of_Month",
    }).catch((e: any) => setErr(String(e?.message || e)));
    load();
  };

  if (err && !data) return <ErrorBox error={err} />;
  if (!data) return <div className="rounded-card border border-subtle bg-surface-1 p-6"><Spinner /></div>;
  const v = edit ? (form as BranchPolicy) : data;

  const leaveCols: Column<LeavePolicyRow>[] = [
    { key: "leave_name", label: "Leave Name", render: (r) => r.leave_name || "—" },
    { key: "leave_credit_type", label: "Credit Type", render: (r) => r.leave_credit_type || "—" },
    { key: "leave_expire", label: "Leave_Expire", render: (r) => r.leave_expire || "—" },
    { key: "is_max_limit", label: "Max Limit", render: (r) => yesNo(r.is_max_limit) },
    { key: "prorate_balance_credit", label: "Prorate", render: (r) => yesNo(r.prorate_balance_credit) },
    { key: "leave_credit_balance", label: "Credit Bal", render: (r) => num(r.leave_credit_balance) },
    { key: "initial_credit_balance", label: "Initial Bal", render: (r) => num(r.initial_credit_balance) },
    { key: "maximum_carry_forward", label: "Max Carry Fwd", render: (r) => num(r.maximum_carry_forward) },
    { key: "leave_credit_timing", label: "Credit Timing", render: (r) => r.leave_credit_timing || "—" },
    { key: "effective_date", label: "Effective Date", render: (r) => r.effective_date || "—" },
  ];

  const chk = (label: string, key: keyof BranchPolicy) => (
    <label className="flex items-center gap-2 text-sm text-primary">
      <input type="checkbox" disabled={!edit} checked={!!v[key]} onChange={(e) => setF(key, e.target.checked)} />
      {label}
    </label>
  );
  const numF = (label: string, key: keyof BranchPolicy) => (
    <Field label={label}>
      {edit
        ? <input type="number" step="0.5" className={inputCls} value={(v[key] as any) ?? ""} onChange={(e) => setF(key, e.target.value === "" ? null : Number(e.target.value))} />
        : <div className="text-sm text-primary">{num(v[key] as any)}</div>}
    </Field>
  );
  const capRow = (label: string, tKey: keyof BranchPolicy, vKey: keyof BranchPolicy) => (
    <div className="flex items-end gap-3">
      <label className="flex items-center gap-2 text-sm text-primary">
        <input type="checkbox" disabled={!edit} checked={!!v[tKey]} onChange={(e) => setF(tKey, e.target.checked)} />
        {label}
      </label>
      <Field label="Value">
        {edit
          ? <input type="number" step="0.5" className={inputCls} value={(v[vKey] as any) ?? ""} onChange={(e) => setF(vKey, e.target.value === "" ? null : Number(e.target.value))} />
          : <div className="text-sm text-primary">{num(v[vKey] as any)}</div>}
      </Field>
    </div>
  );

  return (
    <div className="space-y-4">
      {toast}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CrmBreadcrumb items={[
            { label: "Customers", to: "customers" },
            { label: data.customer_name || `Customer #${data.customer_id}`, to: `customers/${data.customer_id}` },
            { label: data.branch_name },
          ]} />
          <h1 className="mt-1 text-display text-lg font-bold text-primary">{data.branch_name}</h1>
        </div>
        {edit
          ? <div className="flex gap-2">
              <button type="button" className={btnSecondary} onClick={() => { setEdit(false); setForm(data); }}>Cancel</button>
              <button type="button" className={btnPrimary} onClick={savePolicy} disabled={saving}><Save size={14} /> Save</button>
            </div>
          : <div className="flex gap-2">
              <button type="button" className={btnSecondary} onClick={() => setEdit(true)}>Edit policy</button>
              <button type="button" className={btnPrimary} onClick={() => setShowWizard(true)}><Pencil size={14} /> Edit branch</button>
            </div>}
      </div>
      {err && <ErrorBox error={err} />}

      {/* 1 — Branch Identity */}
      <Block title="Branch Identity">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Info label="Customer">{data.customer_name || data.customer_id}</Info>
          <Info label="Branch Name">{data.branch_name}</Info>
          <Info label="Branch Legal Name">{data.branch_legal_name || "—"}</Info>
          <Info label="Billing Address">{data.billing_address || "—"}</Info>
          <Info label="GSTIN">{data.gstin || "—"}</Info>
          <Info label="PAN">{data.pan || "—"}</Info>
        </div>
      </Block>

      {/* 2 — Projects (drill-down to Project detail) */}
      <Block title="Projects" hint="Click a project to open Overview / Team / Timesheet / PO & Invoices.">
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label="Projects" value={String(data.linked_projects.length)} />
        </div>
        {data.linked_projects.length === 0
          ? <EmptyState message="No projects for this branch yet." />
          : (
            <DataTable
              columns={[
                {
                  key: "name",
                  label: "Name",
                  render: (p: LinkedProject) => (
                    <span className="font-semibold text-brand-600 dark:text-brand-300">{p.name}</span>
                  ),
                },
                {
                  key: "status",
                  label: "Status",
                  render: (p: LinkedProject) => <StatusBadge status={p.status || "—"} />,
                },
              ]}
              rows={data.linked_projects}
              loading={false}
              emptyMessage="No projects for this branch yet."
              onRowClick={(p) => crmNavigate(`projects/${p.id}`)}
            />
          )}
      </Block>

      {/* 3 — Holiday Billing Policy */}
      <Block title="Holiday Billing Policy" hint="Per calendar year. Click a year to view its holidays.">
        <BranchHolidayYearsPanel branchId={Number(id)} notify={notify} />
      </Block>

      {/* 4 — Leave & Holiday Billing Policy */}
      <Block title="Leave & Holiday Billing Policy">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {chk("Holidays Billable", "holidays_billable")}
          {chk("Weekoff Billable", "weekoff_billable")}
          {chk("Leave Billable", "leave_billable")}
          {chk("Comp Off Billable", "comp_off_billable")}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {numF("Hours Required Half Day", "hours_required_half_day")}
          {numF("Hours Required Full Day", "hours_required_full_day")}
          {numF("Working Hours Per Day", "working_hours_per_day")}
          {numF("Hours Required Half Day [Comp-Off]", "hours_required_half_day_comp_off")}
          {numF("Hours Required Full Day [Comp-Off]", "hours_required_full_day_comp_off")}
        </div>
      </Block>

      {/* 5 — Billing Properties */}
      <Block title="Billing Properties">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Billing Frequency">
            {edit
              ? <input className={inputCls} value={v.billing_frequency ?? ""} onChange={(e) => setF("billing_frequency", e.target.value)} />
              : <div className="text-sm text-primary">{v.billing_frequency || "—"}</div>}
          </Field>
          {numF("Billing Cycle Start Date", "billing_cycle_start_day")}
          {numF("Billing Cycle End Date", "billing_cycle_end_day")}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {capRow("Is Max Billable Hours Per Day", "is_max_billable_hours_per_day", "max_billable_hours_per_day")}
          {capRow("Is Max Billable Hours Per Month", "is_max_billable_hours_per_month", "max_billable_hours_per_month")}
          {capRow("Is Max Billable Days Per Month", "is_max_billable_days_per_month", "max_billable_days_per_month")}
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 text-sm text-primary">
              <input type="checkbox" disabled={!edit} checked={!!v.is_initial_no_billing_period} onChange={(e) => setF("is_initial_no_billing_period", e.target.checked)} />
              Is Initial No Billing Period
            </label>
            {numF("Initial No Billing QTY", "initial_no_billing_qty")}
            <Field label="Period">
              {edit
                ? <input className={inputCls} value={v.initial_no_billing_period ?? ""} onChange={(e) => setF("initial_no_billing_period", e.target.value)} />
                : <div className="text-sm text-primary">{v.initial_no_billing_period || "—"}</div>}
            </Field>
          </div>
        </div>
      </Block>

      {/* 6 — Billable Leave Policy */}
      <Block title="Billable Leave Policy" hint="Optional per branch — may be empty."
        action={<button type="button" className={btnSecondary} onClick={addLeaveTemplate}><Plus size={14} /> Add row</button>}>
        {data.leave_policies.length === 0
          ? <EmptyState
              message="No billable leave policy rows (valid — this branch has none)."
              action={<button type="button" className={btnPrimary} onClick={addLeaveTemplate}><Plus size={14} /> Add row</button>}
            />
          : <DataTable columns={leaveCols} rows={data.leave_policies.map((p) => ({ ...p, id: p.id }))} loading={false} emptyMessage="No rows" />}
      </Block>
      {showWizard && (
        <EditBranchWizard
          customerId={data.customer_id}
          customerName={data.customer_name}
          initial={{
            id: data.id,
            branch_name: data.branch_name,
            branch_legal_name: data.branch_legal_name,
            billing_address: data.billing_address,
            gstin: data.gstin,
            pan: data.pan,
          }}
          onClose={() => setShowWizard(false)}
          onSaved={() => { setShowWizard(false); load(); }}
          notify={notify}
        />
      )}
    </div>
  );
}

/** Reusable Holiday Billing Policy panel (per calendar-year table → holiday
 * drill-down + freeze). Lifted verbatim from the page's Section 2 so the
 * Edit Branch wizard and this page share one implementation of the
 * freeze/holiday logic. Self-fetches its own holiday years. */
export function BranchHolidayYearsPanel({
  branchId,
  notify,
}: {
  branchId: number;
  notify: (msg: string, kind?: "ok" | "err") => void;
}) {
  const [years, setYears] = useState<HolidayYear[]>([]);
  const [err, setErr] = useState("");
  const [openYear, setOpenYear] = useState<number | null>(null);
  const [holidays, setHolidays] = useState<Record<number, BranchHoliday[]>>({});
  const [holidayModal, setHolidayModal] = useState<{ year: number; initial?: BranchHoliday } | null>(null);
  const [deactivating, setDeactivating] = useState<{ year: number; row: BranchHoliday } | null>(null);
  const [holidayBusy, setHolidayBusy] = useState(false);
  const [newYear, setNewYear] = useState("");

  const loadYears = useCallback(async () => {
    try {
      const res = await crmGet<HolidayYear[]>(`/api/customers/branches/${branchId}/holiday-years`);
      setYears(res.data || []);
    } catch (e: any) { setErr(String(e?.message || e)); }
  }, [branchId]);
  useEffect(() => { loadYears(); }, [loadYears]);

  const loadYearHolidays = useCallback(async (calendarYear: number) => {
    const rows = await crmGet<BranchHoliday[]>(
      `/api/customers/branches/${branchId}/holiday-years/${calendarYear}/holidays`,
    );
    setHolidays((h) => ({ ...h, [calendarYear]: rows.data || [] }));
  }, [branchId]);

  const toggleYear = async (y: HolidayYear) => {
    if (openYear === y.calendar_year) { setOpenYear(null); return; }
    setOpenYear(y.calendar_year);
    if (!holidays[y.calendar_year]) {
      try {
        await loadYearHolidays(y.calendar_year);
      } catch (e: any) {
        setErr(String(e?.message || e));
      }
    }
  };
  const freezeYear = async (y: HolidayYear) => {
    await crmPatch(`/api/customers/branches/${branchId}/holiday-years/${y.id}`, { is_freeze: !y.is_freeze });
    loadYears();
  };
  const addYear = async () => {
    const yr = parseInt(newYear, 10);
    if (!yr) return;
    await crmPost(`/api/customers/branches/${branchId}/holiday-years`, { calendar_year: yr });
    setNewYear("");
    loadYears();
  };

  const openYearRow = years.find((y) => y.calendar_year === openYear) || null;
  const yearFrozen = !!openYearRow?.is_freeze;

  const removeHoliday = async () => {
    if (!deactivating) return;
    setHolidayBusy(true);
    try {
      await crmDelete(
        `/api/customers/branches/${branchId}/holiday-years/${deactivating.year}/holidays/${deactivating.row.id}`,
      );
      notify("Holiday removed");
      setDeactivating(null);
      await loadYearHolidays(deactivating.year);
      loadYears();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setHolidayBusy(false);
    }
  };

  const yearCols: Column<HolidayYear>[] = [
    { key: "calendar_year", label: "Calendar Year", render: (r) => (
        <button type="button" className={`inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline dark:text-brand-300 ${focusRing}`} onClick={() => toggleYear(r)}>
          {openYear === r.calendar_year ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{r.calendar_year}
        </button>) },
    { key: "holiday_count", label: "Holiday Count", render: (r) => r.holiday_count == null ? "—" : r.holiday_count },
    { key: "is_freeze", label: "IsFreeze", render: (r) => <StatusBadge status={r.is_freeze ? "Frozen" : "Open"} /> },
    { key: "edit", label: "", render: (r) => (
        <button type="button" className={`inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300 ${focusRing}`} onClick={() => freezeYear(r)}>
          {r.is_freeze ? <><LockOpen size={12} /> Unfreeze</> : <><Lock size={12} /> Freeze</>}
        </button>) },
  ];

  return (
    <div className="space-y-2">
      {err && <ErrorBox error={err} />}
      <div className="flex items-center justify-end gap-2">
        <input className={inputCls} style={{ width: 110 }} placeholder="Year" value={newYear} onChange={(e) => setNewYear(e.target.value)} />
        <button type="button" className={btnSecondary} onClick={addYear}><Plus size={14} /> Add year</button>
      </div>
      {years.length === 0
        ? <EmptyState message="No holiday years yet for this branch." />
        : <div className="space-y-2">
            <DataTable columns={yearCols} rows={years.map((y) => ({ ...y, id: y.id }))} loading={false} emptyMessage="No holiday years" />
            {openYear != null && (
              <div className="rounded-card border border-subtle bg-surface-2 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                    <CalendarDays size={14} /> Holidays in {openYear}
                    <span className="rounded-full bg-surface-1 px-2 py-0.5 text-primary">
                      {(holidays[openYear] || []).length} date{(holidays[openYear] || []).length === 1 ? "" : "s"}
                    </span>
                    {yearFrozen && <StatusBadge status="Frozen" />}
                  </div>
                  {!yearFrozen && (
                    <button
                      type="button"
                      className={btnSecondary}
                      onClick={() => setHolidayModal({ year: openYear })}
                    >
                      <Plus size={14} /> Add date
                    </button>
                  )}
                </div>
                {(holidays[openYear] || []).length === 0 ? (
                  <div className="text-sm text-muted">No holiday records for {openYear}.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-max text-sm">
                      <thead>
                        <tr className="border-b border-subtle text-left text-xs font-bold uppercase tracking-wide text-muted">
                          <th className="px-2 py-2">Date</th>
                          <th className="px-2 py-2">Holiday</th>
                          <th className="px-2 py-2">Observance</th>
                          {!yearFrozen && <th className="px-2 py-2 text-right">Actions</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {(holidays[openYear] || []).map((h) => (
                          <tr key={h.id} className="border-b border-subtle">
                            <td className="px-2 py-2 whitespace-nowrap">{fmtDate(h.holiday_date)}</td>
                            <td className="px-2 py-2 font-semibold">{h.name}</td>
                            <td className="px-2 py-2 text-secondary">{h.observance || "Mandatory"}</td>
                            {!yearFrozen && (
                              <td className="px-2 py-2 text-right">
                                <span className="inline-flex gap-1">
                                  <button
                                    type="button"
                                    className={`rounded-control p-1.5 text-muted hover:bg-surface-1 hover:text-primary ${focusRing}`}
                                    title="Edit holiday"
                                    onClick={() => setHolidayModal({ year: openYear, initial: h })}
                                  >
                                    <Pencil size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    className={`rounded-control p-1.5 text-muted hover:bg-surface-1 hover:text-danger ${focusRing}`}
                                    title="Remove holiday"
                                    onClick={() => setDeactivating({ year: openYear, row: h })}
                                  >
                                    <Power size={14} />
                                  </button>
                                </span>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>}
      {holidayModal && (
        <BranchHolidayModal
          branchId={branchId}
          calendarYear={holidayModal.year}
          initial={holidayModal.initial}
          onClose={() => setHolidayModal(null)}
          onSaved={async () => {
            const yr = holidayModal.year;
            setHolidayModal(null);
            notify("Holiday saved");
            await loadYearHolidays(yr);
            loadYears();
          }}
          onError={(m) => setErr(m)}
        />
      )}
      {deactivating && (
        <ConfirmModal
          title="Remove holiday date"
          message={<>Remove <b>{deactivating.row.name}</b> ({fmtDate(deactivating.row.holiday_date)}) from {deactivating.year}?</>}
          confirmLabel="Remove"
          danger
          busy={holidayBusy}
          onConfirm={removeHoliday}
          onClose={() => setDeactivating(null)}
        />
      )}
    </div>
  );
}

function BranchHolidayModal({
  branchId, calendarYear, initial, onClose, onSaved, onError,
}: {
  branchId: number;
  calendarYear: number;
  initial?: BranchHoliday;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [nameId, setNameId] = useState(initial?.holiday_name_id ? String(initial.holiday_name_id) : "");
  const [date, setDate] = useState(initial?.holiday_date || "");
  const [observance, setObservance] = useState(initial?.observance || "Mandatory");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim() && !nameId) errs.name = "Holiday name is required";
    if (!date) errs.date = "Date is required";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim() || undefined,
        holiday_name_id: nameId ? Number(nameId) : null,
        holiday_date: date,
        observance,
      };
      if (initial) {
        await crmPut(
          `/api/customers/branches/${branchId}/holiday-years/${calendarYear}/holidays/${initial.id}`,
          payload,
        );
      } else {
        await crmPost(
          `/api/customers/branches/${branchId}/holiday-years/${calendarYear}/holidays`,
          payload,
        );
      }
      onSaved();
    } catch (err: any) {
      onError(err?.message || "Failed to save holiday");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? "Edit holiday date" : "Add holiday date"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <HolidayNameField
          valueId={nameId}
          valueName={name}
          onChangeId={setNameId}
          onChangeName={setName}
          required
          error={errors.name}
          onError={onError}
        />
        <Field label="Date" required error={errors.date}>
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Observance">
          <select className={inputCls} value={observance} onChange={(e) => setObservance(e.target.value)}>
            {OBSERVANCE.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}
