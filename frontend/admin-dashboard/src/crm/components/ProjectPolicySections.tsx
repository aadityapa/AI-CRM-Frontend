/**
 * Shared Project policy section UIs used by Create + Edit Project wizards.
 * Keep field mapping identical to EditProjectWizard / Project model columns.
 */
import React, { useState } from "react";
import { CircleDot, Clock3, FolderKanban, Hash, Plus, Repeat, Timer, Trash2 } from "lucide-react";
import { btnSecondary, inputCls, ConfirmModal } from "./ui";
import { InfoChip, WizardField } from "./wizard";
import { LeaveBillingPolicyModal } from "./LeaveBillingPolicyModal";

export const uid = () => Math.random().toString(36).slice(2, 11);
export const numOrNull = (v: string): number | null =>
  (v === "" || v == null ? null : Number(v));
export const strOr = (v: number | null | undefined, fallback = "") =>
  (v == null || Number.isNaN(Number(v)) ? fallback : String(v));

/** Billing Frequency — UI omits Bi_Weekly (kept in DB enum). */
export const BILLING_FREQUENCY_CHOICES = [
  { value: "Weekly", label: "Weekly" },
  { value: "Monthly", label: "Monthly" },
  { value: "Quarterly", label: "Quarterly" },
  { value: "Yearly", label: "Yearly" },
];

export const PROJECT_STATUSES = ["Active", "Completed", "On_Hold"];

/** UI "Initial No Billing QTY" → API initial_no_billing_period */
export const NO_BILLING_QTY_UNITS = ["Hours", "Days", "Week", "Month", "Year"];

export const LEAVE_CREDIT_TYPE_CHOICES = [
  "Monthly", "Quarterly", "Yearly",
];
export const LEAVE_EXPIRE_CHOICES = [
  "Monthly", "Quarterly", "Yearly",
];

export type LeaveType = { id: number; name: string };

export type LeaveRow = {
  key: string;
  id?: number;
  leave_type_id: string;
  name: string;
  leave_credit_type: string;
  /** Start_Of_Period | End_Of_Period — when the cycle credit is granted. */
  leave_credit_timing: string;
  leave_credit_balance: string;
  initial_credit_balance: string;
  leave_expire: string;
  /** Start_Of_Period | End_Of_Period — when the cycle remainder lapses. */
  leave_expire_timing: string;
  is_max_limit: boolean;
  maximum_carry_forward: string;
  effective_date: string;
};

export const emptyLeaveRow = (): LeaveRow => ({
  key: uid(),
  leave_type_id: "",
  name: "",
  leave_credit_type: "",
  leave_credit_timing: "Start_Of_Period",
  leave_credit_balance: "",
  initial_credit_balance: "",
  leave_expire: "",
  leave_expire_timing: "End_Of_Period",
  is_max_limit: false,
  maximum_carry_forward: "0",
  effective_date: "",
});

function formatLeaveDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .replace(/ /g, "-");
}

export type PolicyFormState = {
  holidays_billable: boolean;
  weekoff_billable: boolean;
  comp_off_billable: boolean;
  hours_required_half_day: string;
  hours_required_full_day: string;
  hours_required_half_day_comp_off: string;
  hours_required_full_day_comp_off: string;
  billing_cycle_start_day: string;
  billing_cycle_end_day: string;
  recurring_billing: boolean;
  billing_frequency: string;
  is_max_billable_hours_per_day: boolean;
  max_billable_hours_day: string;
  is_max_billable_hours_per_month: boolean;
  max_billable_hours_month: string;
  is_max_billable_days_per_month: boolean;
  max_billable_days_month: string;
  is_initial_no_billing_period: boolean;
  initial_no_billing_qty_unit: string;
  initial_no_billing_period_num: string;
};

export const defaultPolicyForm = (): PolicyFormState => ({
  holidays_billable: false,
  weekoff_billable: false,
  comp_off_billable: false,
  hours_required_half_day: "",
  hours_required_full_day: "",
  hours_required_half_day_comp_off: "",
  hours_required_full_day_comp_off: "",
  billing_cycle_start_day: "1",
  billing_cycle_end_day: "31",
  recurring_billing: true,
  billing_frequency: "Monthly",
  is_max_billable_hours_per_day: false,
  max_billable_hours_day: "",
  is_max_billable_hours_per_month: false,
  max_billable_hours_month: "",
  is_max_billable_days_per_month: false,
  max_billable_days_month: "",
  is_initial_no_billing_period: false,
  initial_no_billing_qty_unit: "",
  initial_no_billing_period_num: "",
});

/** Wizard steps: combined leave/holiday + leave-billing, then billing props. */
export type PolicySectionKey = "leavePolicy" | "billingProps";

export const POLICY_SECTIONS: {
  key: PolicySectionKey;
  title: string;
  description: string;
}[] = [
  {
    key: "leavePolicy",
    title: "Leave & Holiday Billing Policy",
    description: "Holiday/week-off billability, hours thresholds, and per-leave-type credit rules.",
  },
  {
    key: "billingProps",
    title: "Billing Properties",
    description: "Billing cycle, frequency, caps, and initial no-billing period.",
  },
];

export const chk = "h-4 w-4 rounded border-subtle accent-brand-600";
const thCls = "whitespace-nowrap px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-muted";
const tdCls = "px-3 py-2 align-top";

/** Build PUT/POST policy payload from form state (shared create/edit mapping). */
export function policyPayloadFromForm(pol: PolicyFormState) {
  return {
    holidays_billable: pol.holidays_billable,
    weekoff_billable: pol.weekoff_billable,
    comp_off_billable: pol.comp_off_billable,
    hours_required_half_day: numOrNull(pol.hours_required_half_day),
    hours_required_full_day: numOrNull(pol.hours_required_full_day),
    hours_required_half_day_comp_off: numOrNull(pol.hours_required_half_day_comp_off),
    hours_required_full_day_comp_off: numOrNull(pol.hours_required_full_day_comp_off),
    billing_cycle_start_day: Number(pol.billing_cycle_start_day),
    billing_cycle_end_day: Number(pol.billing_cycle_end_day),
    recurring_billing: pol.recurring_billing,
    billing_frequency: pol.billing_frequency,
    is_max_billable_hours_per_day: pol.is_max_billable_hours_per_day,
    max_billable_hours_day: pol.is_max_billable_hours_per_day
      ? numOrNull(pol.max_billable_hours_day) : null,
    is_max_billable_hours_per_month: pol.is_max_billable_hours_per_month,
    max_billable_hours_month: pol.is_max_billable_hours_per_month
      ? numOrNull(pol.max_billable_hours_month) : null,
    is_max_billable_days_per_month: pol.is_max_billable_days_per_month,
    max_billable_days_month: pol.is_max_billable_days_per_month
      ? numOrNull(pol.max_billable_days_month) : null,
    is_initial_no_billing_period: pol.is_initial_no_billing_period,
    initial_no_billing_period: pol.is_initial_no_billing_period
      ? (pol.initial_no_billing_qty_unit || null) : null,
    initial_no_billing_qty: pol.is_initial_no_billing_period
      ? numOrNull(pol.initial_no_billing_period_num) : null,
  };
}

/** Omit null optional fields so create API can seed them from branch. */
export function omitNullish<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

export function LeaveHolidayBillingSection({
  pol,
  setP,
  errors,
  identity,
}: {
  pol: PolicyFormState;
  setP: (k: keyof PolicyFormState, v: string | boolean) => void;
  errors: Record<string, string>;
  /** When set (edit mode), show name + status above policy toggles. */
  identity?: {
    name: string;
    setName: (v: string) => void;
    status: string;
    setStatus: (v: string) => void;
  };
}) {
  return (
    <div className="space-y-5">
      {identity && (
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <WizardField
            label="Project name"
            required
            error={errors.name}
            icon={<FolderKanban size={15} className="text-muted" aria-hidden />}
            filled={!!identity.name.trim()}
          >
            <input className={inputCls} value={identity.name} onChange={(e) => identity.setName(e.target.value)} />
          </WizardField>
          <WizardField
            label="Status"
            icon={<CircleDot size={15} className="text-muted" aria-hidden />}
            filled={!!identity.status}
          >
            <select className={inputCls} value={identity.status} onChange={(e) => identity.setStatus(e.target.value)}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
              ))}
            </select>
          </WizardField>
        </div>
      )}
      <div className="flex flex-wrap gap-6 rounded-xl border border-subtle bg-surface-2/30 px-4 py-3">
        <label className="flex items-center gap-2 text-sm font-medium text-primary" title="When ON, holiday hours worked bill as normal worked time (no Comp-Off leave). Also bills pure holiday-off days. Precedence over Comp Off Billable.">
          <input type="checkbox" className={chk} checked={pol.holidays_billable}
            onChange={(e) => setP("holidays_billable", e.target.checked)} />
          Holidays Billable
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-primary" title="When ON, weekend hours worked bill as normal worked time (no Comp-Off leave). Precedence over Comp Off Billable.">
          <input type="checkbox" className={chk} checked={pol.weekoff_billable}
            onChange={(e) => setP("weekoff_billable", e.target.checked)} />
          Week Off Billable
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-primary" title="When ON (and Holidays/Week Off Billable are off), weekend/holiday hours worked are BILLED to the client as Comp-Off (added to the invoice) instead of crediting Comp-Off leave.">
          <input type="checkbox" className={chk} checked={pol.comp_off_billable}
            onChange={(e) => setP("comp_off_billable", e.target.checked)} />
          Comp Off Billable
        </label>
      </div>
      <p className="text-xs text-muted">
        Holidays / Week Off Billable: bill worked holiday or weekend hours as normal (no Comp-Off credit).
        Comp Off Billable (below, if set): bill as Comp-Off when the direct flag is off.
        If both off: not billed; Comp-Off leave is credited on submit.
      </p>
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <WizardField
          label="Hours Required Half Day"
          error={errors.half}
          icon={<Clock3 size={15} className="text-muted" aria-hidden />}
          filled={!!pol.hours_required_half_day}
        >
          <input type="number" step="0.5" min={0} max={24} className={inputCls}
            value={pol.hours_required_half_day}
            onChange={(e) => setP("hours_required_half_day", e.target.value)} />
        </WizardField>
        <WizardField
          label="Hours Required Full Day"
          icon={<Clock3 size={15} className="text-muted" aria-hidden />}
          filled={!!pol.hours_required_full_day}
        >
          <input type="number" step="0.5" min={0} max={24} className={inputCls}
            value={pol.hours_required_full_day}
            onChange={(e) => setP("hours_required_full_day", e.target.value)} />
        </WizardField>
        <WizardField
          label="Hours Required Half Day Comp-Off"
          icon={<Clock3 size={15} className="text-muted" aria-hidden />}
          filled={!!pol.hours_required_half_day_comp_off}
        >
          <input type="number" step="0.5" min={0} max={24} className={inputCls}
            value={pol.hours_required_half_day_comp_off}
            onChange={(e) => setP("hours_required_half_day_comp_off", e.target.value)} />
        </WizardField>
        <WizardField
          label="Hours Required Full Day Comp-Off"
          icon={<Clock3 size={15} className="text-muted" aria-hidden />}
          filled={!!pol.hours_required_full_day_comp_off}
        >
          <input type="number" step="0.5" min={0} max={24} className={inputCls}
            value={pol.hours_required_full_day_comp_off}
            onChange={(e) => setP("hours_required_full_day_comp_off", e.target.value)} />
        </WizardField>
      </div>
      <InfoChip>
        Thresholds drive timesheet day classification (project override → branch → defaults).
        Blank fields inherit from the branch policy.
      </InfoChip>
    </div>
  );
}

export function LeaveBillingPolicySection({
  leaveRows,
  leaveTypes,
  errors,
  addingType,
  onSaveRow,
  onDeleteRow,
  onAddType,
  emptyMessage = "No leave policy rows yet for this project.",
}: {
  leaveRows: LeaveRow[];
  leaveTypes: LeaveType[];
  errors: Record<string, string>;
  addingType: boolean;
  onSaveRow: (row: LeaveRow) => void | Promise<void>;
  onDeleteRow: (row: LeaveRow) => void | Promise<void>;
  onAddType: (name: string) => Promise<LeaveType | null>;
  emptyMessage?: string;
}) {
  const [editing, setEditing] = useState<LeaveRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleting, setDeleting] = useState<LeaveRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const openNew = () => {
    setEditing(emptyLeaveRow());
    setModalOpen(true);
  };
  const openEdit = (row: LeaveRow) => {
    setEditing({ ...row });
    setModalOpen(true);
  };
  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const leaveNameOf = (r: LeaveRow) =>
    leaveTypes.find((t) => String(t.id) === r.leave_type_id)?.name || "—";

  return (
    <>
      <div className="overflow-x-auto rounded-control border border-subtle">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-surface-2">
            <tr>
              {/* Single name column — "Name" always mirrored "Leave Name"
                  and the duplicate invited the two to drift apart. */}
              <th className={thCls}>Leave Name</th>
              <th className={thCls}>Leave Credit Type *</th>
              <th className={thCls}>Leave Credit Balance</th>
              <th className={thCls}>Leave Expire *</th>
              <th className={thCls}>Is Max Limit</th>
              <th className={thCls}>Maximum Carry Forward</th>
              <th className={thCls} />
            </tr>
          </thead>
          <tbody>
            {leaveRows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-sm text-muted">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              leaveRows.map((r, i) => (
                <tr
                  key={r.key}
                  className="cursor-pointer border-t border-subtle transition-colors hover:bg-surface-2/50"
                  onClick={() => openEdit(r)}
                >
                  <td className={tdCls}>
                    {leaveNameOf(r)}
                    {errors[`leave_type_${i}`] && (
                      <p className="mt-1 text-xs text-danger">{errors[`leave_type_${i}`]}</p>
                    )}
                  </td>
                  <td className={tdCls}>
                    {r.leave_credit_type || "—"}
                    {errors[`credit_${i}`] && (
                      <p className="mt-1 text-xs text-danger">{errors[`credit_${i}`]}</p>
                    )}
                  </td>
                  <td className={tdCls}>{r.leave_credit_balance || "—"}</td>
                  <td className={tdCls}>
                    {r.leave_expire || "—"}
                    {errors[`expire_${i}`] && (
                      <p className="mt-1 text-xs text-danger">{errors[`expire_${i}`]}</p>
                    )}
                  </td>
                  <td className={tdCls}>{r.is_max_limit ? "Yes" : "No"}</td>
                  <td className={tdCls}>{r.maximum_carry_forward || "0"}</td>
                  <td className={tdCls}>
                    <button
                      type="button"
                      className="rounded-control p-1.5 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleting(r);
                      }}
                      aria-label="Remove leave policy row"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <button type="button" className={`${btnSecondary} mt-3`} onClick={openNew}>
        <Plus size={14} /> Add New
      </button>

      {modalOpen && editing && (
        <LeaveBillingPolicyModal
          initial={editing}
          leaveTypes={leaveTypes}
          addingType={addingType}
          onClose={closeModal}
          onSave={async (row) => {
            await onSaveRow(row);
            closeModal();
          }}
          onDelete={async (row) => {
            await onDeleteRow(row);
            closeModal();
          }}
          onAddType={onAddType}
        />
      )}
      {deleting && (
        <ConfirmModal
          title="Delete a leave policy?"
          message={
            <>
              Do you want to delete this leave billing policy
              {leaveNameOf(deleting) !== "—" ? <> (<b>{leaveNameOf(deleting)}</b>)</> : null}?
              This cannot be undone.
            </>
          }
          confirmLabel="Delete"
          danger
          busy={deleteBusy}
          onConfirm={() => {
            void (async () => {
              setDeleteBusy(true);
              try {
                await onDeleteRow(deleting);
                setDeleting(null);
              } finally {
                setDeleteBusy(false);
              }
            })();
          }}
          onClose={() => { if (!deleteBusy) setDeleting(null); }}
        />
      )}
    </>
  );
}

export function BillingPropertiesSection({
  pol,
  setP,
  errors,
}: {
  pol: PolicyFormState;
  setP: (k: keyof PolicyFormState, v: string | boolean) => void;
  errors: Record<string, string>;
}) {
  const capRow = (
    label: string,
    tKey: "is_max_billable_hours_per_day" | "is_max_billable_hours_per_month" | "is_max_billable_days_per_month",
    vKey: "max_billable_hours_day" | "max_billable_hours_month" | "max_billable_days_month",
  ) => (
    <div className="rounded-control border border-subtle bg-surface-2/40 p-3">
      <label className="flex items-center gap-2 text-sm font-medium text-primary">
        <input type="checkbox" className={chk} checked={pol[tKey]} onChange={(e) => setP(tKey, e.target.checked)} />
        {label}
      </label>
      <div className="mt-2">
        <input
          type="number" step="0.5" min={0}
          className={inputCls}
          value={pol[vKey]}
          disabled={!pol[tKey]}
          placeholder={pol[tKey] ? "Enter a value" : "Enable the toggle to set"}
          onChange={(e) => setP(vKey, e.target.value)}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <WizardField
          label="Billing Cycle Start Day"
          error={errors.start}
          icon={<Hash size={15} className="text-muted" aria-hidden />}
          filled={!!pol.billing_cycle_start_day}
          info={<p className="mt-1 text-xs text-muted">Day of month (1–31). Default 1.</p>}
        >
          <input type="number" min={1} max={31} step={1} className={inputCls}
            value={pol.billing_cycle_start_day}
            onChange={(e) => setP("billing_cycle_start_day", e.target.value)} />
        </WizardField>
        <WizardField
          label="Billing Cycle End Day"
          error={errors.end}
          icon={<Hash size={15} className="text-muted" aria-hidden />}
          filled={!!pol.billing_cycle_end_day}
          info={<p className="mt-1 text-xs text-muted">Day of month (1–31). Default 31.</p>}
        >
          <input type="number" min={1} max={31} step={1} className={inputCls}
            value={pol.billing_cycle_end_day}
            onChange={(e) => setP("billing_cycle_end_day", e.target.value)} />
        </WizardField>
        <WizardField
          label="Billing Frequency"
          required
          error={errors.freq}
          icon={<Repeat size={15} className="text-muted" aria-hidden />}
          filled={!!pol.billing_frequency}
        >
          <select className={inputCls} value={pol.billing_frequency}
            onChange={(e) => setP("billing_frequency", e.target.value)}>
            {BILLING_FREQUENCY_CHOICES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </WizardField>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-sm font-medium text-primary">
            <input type="checkbox" className={chk} checked={pol.recurring_billing}
              onChange={(e) => setP("recurring_billing", e.target.checked)} />
            Recurring Billing
          </label>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {capRow("Is Max Billable Hours Per Day", "is_max_billable_hours_per_day", "max_billable_hours_day")}
        {capRow("Is Max Billable Hours Per Month", "is_max_billable_hours_per_month", "max_billable_hours_month")}
        {capRow("Is Max Billable Days Per Month", "is_max_billable_days_per_month", "max_billable_days_month")}
      </div>
      <div className="rounded-control border border-subtle bg-surface-2/40 p-4">
        <label className="flex items-center gap-2 text-sm font-medium text-primary">
          <input type="checkbox" className={chk} checked={pol.is_initial_no_billing_period}
            onChange={(e) => setP("is_initial_no_billing_period", e.target.checked)} />
          Is Initial No Billing Period
        </label>
        <div className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <WizardField
            label="Initial No Billing QTY"
            icon={<Timer size={15} className="text-muted" aria-hidden />}
            filled={!!pol.initial_no_billing_qty_unit}
            info={<p className="mt-1 text-xs text-muted">Maps to initial_no_billing_period (unit).</p>}
          >
            <select className={inputCls} value={pol.initial_no_billing_qty_unit}
              disabled={!pol.is_initial_no_billing_period}
              onChange={(e) => setP("initial_no_billing_qty_unit", e.target.value)}>
              <option value="">— Select —</option>
              {NO_BILLING_QTY_UNITS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </WizardField>
          <WizardField
            label="Initial No Billing Period"
            icon={<Hash size={15} className="text-muted" aria-hidden />}
            filled={!!pol.initial_no_billing_period_num}
            info={<p className="mt-1 text-xs text-muted">Maps to initial_no_billing_qty (numeric).</p>}
          >
            <input type="number" min={0} step={1} className={inputCls}
              value={pol.initial_no_billing_period_num}
              disabled={!pol.is_initial_no_billing_period}
              placeholder={pol.is_initial_no_billing_period ? "Enter a quantity" : "Enable the toggle to set"}
              onChange={(e) => setP("initial_no_billing_period_num", e.target.value)} />
          </WizardField>
        </div>
      </div>
    </div>
  );
}
