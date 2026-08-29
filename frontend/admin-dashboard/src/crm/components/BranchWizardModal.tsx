/**
 * Full-screen Edit Branch wizard — shares the premium chrome with the
 * New Opportunity / New-Edit Customer wizards. Four sections:
 *   1 Branch Info · 2 Holiday Billing Policy (embeds BranchHolidayYearsPanel)
 *   3 Leave & Holiday Billing Policy (includes Billable Leave Policy dialog)
 *   4 Billing Properties
 *
 * VISUAL/STRUCTURAL re-presentation of the existing branch identity edit
 * (Customers → BranchFormModal), branch billing-policy editor
 * (Customers → BranchBillingPolicyModal) and holiday-years table
 * (BranchPolicy page). All endpoints / field wiring preserved.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Building2, CalendarDays, Clock3, Pencil, Plus, Timer, Trash2 } from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut } from "../api";
import { Field, Modal, btnPrimary, btnSecondary, inputCls } from "./ui";
import { SearchableSelect, optionsFromStrings } from "./SearchableSelect";
import {
  COUNTRIES, DEFAULT_COUNTRY, INDIAN_CITIES, INDIAN_STATES,
} from "../constants/geo";
import { BranchHolidayYearsPanel } from "../pages/BranchPolicy";
import {
  FieldLabel,
  InfoChip,
  SectionHeaderBanner,
  WizardFooter,
  WizardShell,
  WizardStepCard,
  WizardTopBar,
  type StepStatus,
  type WizardStep,
} from "./wizard";
import { PeriodTimingPicker } from "./PeriodTimingPicker";

type Notify = (msg: string, kind?: "ok" | "err") => void;

/** Branch identity fields (mirrors Customers.tsx `Branch`, subset we edit). */
export type BranchWizardInitial = {
  id: number;
  branch_name: string;
  branch_legal_name?: string | null;
  billing_address?: string | null;
  address_line_2?: string | null;
  delivery_address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country?: string | null;
  gstin?: string | null;
  pan?: string | null;
  is_primary?: boolean;
};

/* ----------------------------------------------------------------- helpers */
type Tri = "" | "yes" | "no";
const triFromApi = (v: boolean | null | undefined): Tri => (v == null ? "" : v ? "yes" : "no");
const triToApi = (v: Tri): boolean | null => (v === "" ? null : v === "yes");
const numOrNull = (v: string): number | null => (v === "" || v == null ? null : Number(v));
const uid = () => Math.random().toString(36).slice(2, 11);

/** Billing Type — API enum (schemas/customers.py BillingType). */
const BILLING_TYPE_CHOICES = [
  { value: "Per_Hour", label: "Per Hour" },
  { value: "Per_Day", label: "Per Day" },
  { value: "Per_Month", label: "Per Month" },
  { value: "Per_Year", label: "Per Year" },
];

/** Billing frequency — values match Project BillingFrequency enum (Bi_Weekly). */
const BILLING_FREQUENCY_CHOICES = [
  { value: "Monthly", label: "Monthly" },
  { value: "Bi_Weekly", label: "Bi-Weekly" },
  { value: "Weekly", label: "Weekly" },
];

/** Initial no-billing period units. */
const NO_BILLING_PERIOD_CHOICES = ["Days", "Months"];

/**
 * Leave credit types — placeholders until source-system option lists arrive.
 * TODO(source-system): replace with exact Leave Credit Type / Leave Expire /
 * Prorate Balance Credit / Is Max Limit option lists from the source CRM.
 */
const LEAVE_CREDIT_TYPE_CHOICES = [
  "Monthly",
  "Quarterly",
  "Yearly",
];
/** Leave expire period — Monthly / Quarterly / Yearly (Days removed). */
const LEAVE_EXPIRE_CHOICES = ["Monthly", "Quarterly", "Yearly"];

type LeaveType = { id: number; name: string };

type LeaveRow = {
  key: string;
  id?: number;
  leave_type_id: string;
  /** Optional display name (UI); not a CustomerLeavePolicy column. */
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
  max_limit: string;
  maximum_carry_forward: string;
  effective_date: string;
  prorate_balance_credit: boolean;
  is_billable: boolean;
};

const emptyLeaveRow = (): LeaveRow => ({
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
  max_limit: "",
  maximum_carry_forward: "0",
  effective_date: "",
  prorate_balance_credit: false,
  is_billable: true,
});

function formatLeaveDisplayDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .replace(/ /g, "-");
}

function leaveRowFromApi(r: Record<string, unknown>): LeaveRow {
  return {
    key: uid(),
    id: Number(r.id),
    leave_type_id: r.leave_type_id != null ? String(r.leave_type_id) : "",
    name: (r.leave_name as string) || (r.name as string) || "",
    leave_credit_type: (r.leave_credit_type as string) || "",
    leave_credit_timing: (r.leave_credit_timing as string) || "Start_Of_Period",
    leave_credit_balance: r.leave_credit_balance != null ? String(r.leave_credit_balance) : "",
    initial_credit_balance: r.initial_credit_balance != null ? String(r.initial_credit_balance) : "",
    leave_expire: (r.leave_expire as string) || "",
    leave_expire_timing: (r.leave_expire_timing as string) || "End_Of_Period",
    is_max_limit: !!r.is_max_limit,
    max_limit: r.max_limit != null ? String(r.max_limit) : "",
    maximum_carry_forward: r.maximum_carry_forward != null ? String(r.maximum_carry_forward) : "0",
    effective_date: r.effective_date ? String(r.effective_date).slice(0, 10) : "",
    prorate_balance_credit: !!r.prorate_balance_credit,
    is_billable: r.is_billable == null ? true : !!r.is_billable,
  };
}

type CustomerDefaults = {
  weekoff: boolean;
  leave: boolean;
  holidays: boolean;
  fullDay: number;
  halfDay: number;
  perDay: number;
};
const BUILTIN_DEFAULTS: CustomerDefaults = {
  weekoff: false, leave: false, holidays: false, fullDay: 8, halfDay: 4, perDay: 8,
};

const chk = "h-4 w-4 rounded border-subtle accent-brand-600";

/** Branch-specific Leave Billing Policy dialog (Cancel/Save; includes Is Billable + Prorate). */
function BranchLeaveBillingDialog({
  initial,
  leaveTypes,
  addingType,
  onClose,
  onSave,
  onAddType,
}: {
  initial: LeaveRow;
  leaveTypes: LeaveType[];
  addingType: boolean;
  onClose: () => void;
  onSave: (row: LeaveRow) => void;
  onAddType: (name: string) => Promise<LeaveType | null>;
}) {
  const [form, setForm] = useState<LeaveRow>(() => ({ ...initial }));
  const [dialogErrors, setDialogErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [typeQuery, setTypeQuery] = useState("");
  const [typeOpen, setTypeOpen] = useState(false);

  useEffect(() => {
    setForm({ ...initial });
    setDialogErrors({});
    setTypeQuery("");
    setTypeOpen(false);
  }, [initial]);

  const selectedType = leaveTypes.find((t) => String(t.id) === form.leave_type_id);
  const filtered = useMemo(() => {
    const q = typeQuery.trim().toLowerCase();
    if (!q) return leaveTypes;
    return leaveTypes.filter((t) => t.name.toLowerCase().includes(q));
  }, [leaveTypes, typeQuery]);

  const set = (patch: Partial<LeaveRow>) => setForm((s) => ({ ...s, ...patch }));

  const pickType = (t: LeaveType) => {
    set({ leave_type_id: String(t.id), name: t.name });
    setTypeQuery("");
    setTypeOpen(false);
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.leave_type_id) errs.leave_type_id = "Leave Name is required";
    if (!form.leave_credit_type) errs.leave_credit_type = "Leave Credit Type is required";
    if (!form.leave_expire) errs.leave_expire = "Leave Expire is required";
    if (form.leave_credit_balance !== "" && Number.isNaN(Number(form.leave_credit_balance))) {
      errs.leave_credit_balance = "Must be a number";
    }
    if (form.is_max_limit && form.max_limit !== "" && Number.isNaN(Number(form.max_limit))) {
      errs.max_limit = "Must be a number";
    }
    const mcf = form.maximum_carry_forward === "" ? 0 : Number(form.maximum_carry_forward);
    if (!Number.isFinite(mcf) || mcf < 0) {
      errs.maximum_carry_forward = "Must be a number ≥ 0";
    }
    setDialogErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    onSave({
      ...form,
      leave_credit_timing: form.leave_credit_timing || "Start_Of_Period",
      leave_expire_timing: form.leave_expire
        ? (form.leave_expire_timing || "End_Of_Period")
        : "",
      maximum_carry_forward: form.maximum_carry_forward === "" ? "0" : String(form.maximum_carry_forward),
    });
  };

  const handleAddType = async () => {
    const q = typeQuery.trim();
    if (!q) {
      setDialogErrors((e) => ({ ...e, leave_type_id: "Enter a leave name to add" }));
      return;
    }
    setBusy(true);
    try {
      const created = await onAddType(q);
      if (created) pickType(created);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Leave Billing Policy" onClose={onClose} medium>
      <div className="space-y-4">
        <div>
          <FieldLabel label="Leave Name" />
          <input
            className={inputCls}
            placeholder="-Select-"
            value={typeOpen || typeQuery ? typeQuery : (selectedType?.name || "")}
            onFocus={() => {
              setTypeOpen(true);
              setTypeQuery(selectedType?.name || "");
            }}
            onChange={(e) => {
              setTypeQuery(e.target.value);
              setTypeOpen(true);
              set({ leave_type_id: "" });
            }}
            onBlur={() => { window.setTimeout(() => setTypeOpen(false), 150); }}
            autoComplete="off"
          />
          {typeOpen && (
            <div className="mt-1 max-h-40 overflow-y-auto rounded-control border border-subtle bg-surface-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted">No matches</div>
              ) : (
                filtered.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm text-primary hover:bg-surface-2"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickType(t)}
                  >
                    {t.name}
                  </button>
                ))
              )}
            </div>
          )}
          <button
            type="button"
            className={`${btnSecondary} mt-1.5 !px-2 !py-1 text-xs`}
            disabled={addingType || busy}
            onClick={() => void handleAddType()}
          >
            <Plus size={12} /> Add New
          </button>
          {dialogErrors.leave_type_id && (
            <p className="mt-1 text-xs text-danger" role="alert">{dialogErrors.leave_type_id}</p>
          )}
        </div>

        <div>
          <FieldLabel label="Name" />
          <input className={inputCls} value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </div>

        <div>
          <FieldLabel label="Leave Credit Type" required />
          <select
            className={inputCls}
            value={form.leave_credit_type}
            onChange={(e) => {
              const leave_credit_type = e.target.value;
              set({
                leave_credit_type,
                leave_credit_timing: form.leave_credit_timing || "Start_Of_Period",
              });
            }}
          >
            <option value="">-Select-</option>
            {LEAVE_CREDIT_TYPE_CHOICES.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          {dialogErrors.leave_credit_type && (
            <p className="mt-1 text-xs text-danger" role="alert">{dialogErrors.leave_credit_type}</p>
          )}
          <PeriodTimingPicker
            cycle={form.leave_credit_type}
            value={form.leave_credit_timing}
            verb="Credit"
            onChange={(v) => set({ leave_credit_timing: v })}
          />
        </div>

        <div>
          <FieldLabel label="Leave Credit Balance" />
          <input
            type="number"
            step="0.01"
            min={0}
            className={inputCls}
            placeholder="######.##"
            value={form.leave_credit_balance}
            onChange={(e) => set({ leave_credit_balance: e.target.value })}
          />
          {dialogErrors.leave_credit_balance && (
            <p className="mt-1 text-xs text-danger" role="alert">{dialogErrors.leave_credit_balance}</p>
          )}
        </div>


        <div>
          <FieldLabel label="Leave_Expire" required />
          <select
            className={inputCls}
            value={form.leave_expire}
            onChange={(e) => {
              const leave_expire = e.target.value;
              set({
                leave_expire,
                leave_expire_timing: leave_expire
                  ? (form.leave_expire_timing || "End_Of_Period")
                  : "",
              });
            }}
          >
            <option value="">-Select-</option>
            {LEAVE_EXPIRE_CHOICES.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          {dialogErrors.leave_expire && (
            <p className="mt-1 text-xs text-danger" role="alert">{dialogErrors.leave_expire}</p>
          )}
          <PeriodTimingPicker
            cycle={form.leave_expire}
            value={form.leave_expire_timing}
            verb="Expire"
            onChange={(v) => set({ leave_expire_timing: v })}
          />
        </div>

        <label className="flex items-center gap-2 text-sm font-medium text-primary">
          <input
            type="checkbox"
            className={chk}
            checked={form.is_max_limit}
            onChange={(e) => set({ is_max_limit: e.target.checked })}
          />
          Is Max Limit
        </label>
        {form.is_max_limit && (
          <div>
            <FieldLabel label="Max Limit" />
            <input
              type="number"
              step="0.5"
              min={0}
              className={inputCls}
              value={form.max_limit}
              onChange={(e) => set({ max_limit: e.target.value })}
            />
            {dialogErrors.max_limit && (
              <p className="mt-1 text-xs text-danger" role="alert">{dialogErrors.max_limit}</p>
            )}
          </div>
        )}

        <div>
          <FieldLabel label="Maximum Carry Forward" />
          <input
            type="number"
            step={1}
            min={0}
            className={inputCls}
            value={form.maximum_carry_forward}
            onChange={(e) => set({ maximum_carry_forward: e.target.value })}
          />
          {dialogErrors.maximum_carry_forward && (
            <p className="mt-1 text-xs text-danger" role="alert">{dialogErrors.maximum_carry_forward}</p>
          )}
        </div>


        <label className="flex items-center gap-2 text-sm font-medium text-primary">
          <input
            type="checkbox"
            className={chk}
            checked={form.is_billable}
            onChange={(e) => set({ is_billable: e.target.checked })}
          />
          Is Billable
        </label>

        <label className="flex items-center gap-2 text-sm font-medium text-primary">
          <input
            type="checkbox"
            className={chk}
            checked={form.prorate_balance_credit}
            onChange={(e) => set({ prorate_balance_credit: e.target.checked })}
          />
          Prorate Balance Credit
        </label>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={btnSecondary} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={handleSave}>
          Save
        </button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- sections */
type SectionKey = "branchInfo" | "holidayPolicy" | "leaveHolidayBilling" | "billingProps";

const FORM_SECTIONS: { key: SectionKey; title: string; description: string; icon: React.ReactNode }[] = [
  {
    key: "branchInfo",
    title: "Branch Info",
    description: "Branch identity, registered address, and tax identifiers.",
    icon: <Building2 size={18} />,
  },
  {
    key: "holidayPolicy",
    title: "Holiday Billing Policy",
    description: "Per calendar year. Click a year to view, add, or freeze its holidays.",
    icon: <CalendarDays size={18} />,
  },
  {
    key: "leaveHolidayBilling",
    title: "Leave & Holiday Billing Policy",
    description: "Attendance hour thresholds, billable rules, and optional billable leave policies.",
    icon: <Clock3 size={18} />,
  },
  {
    key: "billingProps",
    title: "Billing Properties",
    description: "Billing frequency, cycle window, billing caps, and initial no-billing period.",
    icon: <Timer size={18} />,
  },
];

/* ==================================================================== main */
export function EditBranchWizard({
  customerId,
  customerName,
  initial,
  onClose,
  onSaved,
  notify,
}: {
  customerId: number;
  customerName?: string | null;
  initial: BranchWizardInitial;
  onClose: () => void;
  onSaved: () => void;
  notify: Notify;
}) {
  const branchId = initial.id;
  const reduce = useReducedMotion();
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [maxReached, setMaxReached] = useState(FORM_SECTIONS.length - 1);
  const [stepDir, setStepDir] = useState(1);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // S1 — identity
  const [ident, setIdent] = useState({
    branch_name: initial.branch_name || "",
    branch_legal_name: initial.branch_legal_name || "",
    billing_address: initial.billing_address || "",
    address_line_2: initial.address_line_2 || "",
    delivery_address: initial.delivery_address || "",
    city: initial.city || "",
    state: initial.state || "",
    pincode: initial.pincode || "",
    country: initial.country || DEFAULT_COUNTRY,
    gstin: initial.gstin || "",
    pan: initial.pan || "",
    is_primary: !!initial.is_primary,
  });
  const setI = (k: keyof typeof ident, v: string | boolean) => setIdent((s) => ({ ...s, [k]: v }));

  // S3 / S4 — branch billing policy (tri-state billable, numeric else)
  const [pol, setPol] = useState({
    holidays_billable: "" as Tri,
    weekoff_billable: "" as Tri,
    leave_billable: "" as Tri,
    comp_off_billable: "" as Tri,
    hours_required_half_day: "",
    hours_required_full_day: "",
    hours_required_half_day_comp_off: "",
    hours_required_full_day_comp_off: "",
    working_hours_per_day: "",
    billing_type: "",
    billing_frequency: "",
    billing_cycle_start_day: "",
    billing_cycle_end_day: "",
    is_max_billable_hours_per_day: false,
    max_billable_hours_per_day: "",
    is_max_billable_hours_per_month: false,
    max_billable_hours_per_month: "",
    is_max_billable_days_per_month: false,
    max_billable_days_per_month: "",
    is_initial_no_billing_period: false,
    initial_no_billing_qty: "",
    initial_no_billing_period: "",
  });
  const setP = (k: keyof typeof pol, v: string | boolean) => setPol((s) => ({ ...s, [k]: v }));
  const [defaults, setDefaults] = useState<CustomerDefaults>(BUILTIN_DEFAULTS);

  // S3 — leave policy rows (shown under Leave & Holiday Billing Policy)
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveRows, setLeaveRows] = useState<LeaveRow[]>([]);
  /** Customer-default rows (branch_id NULL) — read-only inherited fallback. */
  const [customerDefaultLeaveRows, setCustomerDefaultLeaveRows] = useState<LeaveRow[]>([]);
  const [removedLeaveIds, setRemovedLeaveIds] = useState<number[]>([]);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [editingLeave, setEditingLeave] = useState<LeaveRow | null>(null);
  const [addingType, setAddingType] = useState(false);

  // Load billing policy + customer defaults + leave data + full identity.
  useEffect(() => {
    crmGet<LeaveType[]>("/api/leave-policy-types?limit=100")
      .then((r) => setLeaveTypes(r.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Full identity (list carries every column; initial may be partial).
    crmGet<BranchWizardInitial[]>(`/api/customers/${customerId}/branches`)
      .then((r) => {
        const b = (r.data || []).find((x) => x.id === branchId);
        if (!b) return;
        setIdent((s) => ({
          ...s,
          branch_name: b.branch_name ?? s.branch_name,
          branch_legal_name: b.branch_legal_name ?? "",
          billing_address: b.billing_address ?? "",
          address_line_2: b.address_line_2 ?? "",
          delivery_address: b.delivery_address ?? "",
          city: b.city ?? "",
          state: b.state ?? "",
          pincode: b.pincode ?? "",
          country: b.country ?? "",
          gstin: b.gstin ?? "",
          pan: b.pan ?? "",
          is_primary: !!b.is_primary,
        }));
      })
      .catch(() => {});
  }, [customerId, branchId]);

  useEffect(() => {
    Promise.all([
      crmGet<Record<string, unknown>>(`/api/customers/branches/${branchId}/policy`),
      crmGet<Record<string, unknown> | null>(`/api/customers/${customerId}/billing-policy`),
      crmGet<Record<string, unknown>[]>(`/api/customers/branches/${branchId}/leave-policies`),
      // Customer-default leave rows (branch_id NULL) — shown read-only as the
      // inherited fallback beneath this branch's own rows.
      crmGet<Record<string, unknown>[]>(
        `/api/customer-leave-policies?customer_id=${customerId}&is_active=true&limit=100`,
      ).catch(() => ({ data: [] as Record<string, unknown>[] })),
    ])
      .then(([polRes, defRes, leaveRes, custLeaveRes]) => {
        const custRows = ((custLeaveRes?.data || []) as Record<string, unknown>[])
          .filter((r) => r.branch_id == null);
        setCustomerDefaultLeaveRows(custRows.map(leaveRowFromApi));
        const p = polRes.data || {};
        const s = (v: unknown) => (v != null ? String(v) : "");
        const freqRaw = s(p.billing_frequency).replace(/-/g, "_");
        setIdent((prev) => ({
          ...prev,
          branch_name: s(p.branch_name) || prev.branch_name,
          branch_legal_name: s(p.branch_legal_name),
          billing_address: s(p.billing_address),
          address_line_2: s(p.address_line_2),
          delivery_address: s(p.delivery_address),
          city: s(p.city),
          state: s(p.state),
          pincode: s(p.pincode),
          country: s(p.country),
          gstin: s(p.gstin),
          pan: s(p.pan),
          is_primary: !!p.is_primary,
        }));
        setPol((prev) => ({
          ...prev,
          holidays_billable: triFromApi(p.holidays_billable as boolean | null),
          weekoff_billable: triFromApi(p.weekoff_billable as boolean | null),
          leave_billable: triFromApi(p.leave_billable as boolean | null),
          comp_off_billable: triFromApi(p.comp_off_billable as boolean | null),
          hours_required_half_day: s(p.hours_required_half_day),
          hours_required_full_day: s(p.hours_required_full_day),
          hours_required_half_day_comp_off: s(p.hours_required_half_day_comp_off),
          hours_required_full_day_comp_off: s(p.hours_required_full_day_comp_off),
          working_hours_per_day: s(p.working_hours_per_day),
          billing_type: s(p.billing_type),
          billing_frequency: freqRaw,
          billing_cycle_start_day: s(p.billing_cycle_start_day),
          billing_cycle_end_day: s(p.billing_cycle_end_day),
          is_max_billable_hours_per_day: !!p.is_max_billable_hours_per_day,
          max_billable_hours_per_day: s(p.max_billable_hours_per_day),
          is_max_billable_hours_per_month: !!p.is_max_billable_hours_per_month,
          max_billable_hours_per_month: s(p.max_billable_hours_per_month),
          is_max_billable_days_per_month: !!p.is_max_billable_days_per_month,
          max_billable_days_per_month: s(p.max_billable_days_per_month),
          is_initial_no_billing_period: !!p.is_initial_no_billing_period,
          initial_no_billing_qty: s(p.initial_no_billing_qty),
          initial_no_billing_period: s(p.initial_no_billing_period),
        }));
        const d = defRes.data;
        if (d) {
          setDefaults({
            weekoff: !!d.week_off_billable,
            leave: !!d.leave_billable,
            holidays: !!d.holidays_billable,
            fullDay: Number(d.min_hours_full_day ?? 8),
            halfDay: Number(d.min_hours_half_day ?? 4),
            perDay: Number(d.normal_hours_per_day ?? 8),
          });
        }
        const rows = (leaveRes.data || []) as Record<string, unknown>[];
        setLeaveRows(rows.map(leaveRowFromApi));
      })
      .catch(() => {});
  }, [customerId, branchId]);

  /* ------------------------------------------------------------ navigation */
  const totalSteps = FORM_SECTIONS.length;
  const clampedStep = Math.min(Math.max(stepIndex, 0), totalSteps - 1);
  const currentSection = FORM_SECTIONS[clampedStep];
  const isFirstStep = clampedStep === 0;
  const isLastStep = clampedStep === totalSteps - 1;
  const stepPct = Math.round(((clampedStep + 1) / totalSteps) * 100);

  const sectionStatus = (key: SectionKey): StepStatus => {
    switch (key) {
      case "branchInfo":
        if (errors.branch_name) return "error";
        return ident.branch_name.trim() ? "complete" : "empty";
      case "holidayPolicy":
        return "complete";
      case "leaveHolidayBilling": {
        if (errors.full || errors.half || errors.whpd) return "error";
        const leaveBad = leaveRows.some(
          (r) => !r.leave_type_id || !r.leave_credit_type || !r.leave_expire,
        );
        if (leaveBad || Object.keys(errors).some((k) => k.startsWith("leave_"))) return "error";
        return "complete";
      }
      case "billingProps":
        if (errors.start || errors.end) return "error";
        return "complete";
      default:
        return "empty";
    }
  };

  const wizardSteps: WizardStep[] = useMemo(
    () =>
      FORM_SECTIONS.map((s) => ({
        key: s.key,
        title: s.title,
        sublabel: s.description.split(".")[0],
        status: sectionStatus(s.key),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ident, pol, leaveRows, errors],
  );

  const stepCompletePct = (() => {
    const st = sectionStatus(currentSection.key);
    if (st === "complete") return 100;
    if (st === "partial") return 55;
    if (st === "error") return 30;
    return 0;
  })();

  // Focus the step heading (a11y), then the first focusable field on step enter.
  useEffect(() => {
    const t = window.setTimeout(() => {
      stepHeadingRef.current?.focus?.({ preventScroll: true });
      const root = bodyRef.current;
      if (!root) return;
      const field = root.querySelector<HTMLElement>(
        'input:not([disabled]):not([readonly]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])',
      );
      field?.focus?.({ preventScroll: false });
    }, reduce ? 0 : 220);
    return () => window.clearTimeout(t);
  }, [clampedStep, reduce]);

  /* ------------------------------------------------------------ validation */
  const validateSection = (key: SectionKey, opts?: { silent?: boolean }): boolean => {
    const errs: Record<string, string> = { ...errors };
    const clear = (...ks: string[]) => { for (const k of ks) delete errs[k]; };

    if (key === "branchInfo") {
      clear("branch_name", "gstin", "pan");
      if (!ident.branch_name.trim()) errs.branch_name = "Branch name is required";
    }
    if (key === "leaveHolidayBilling") {
      clear("full", "half", "whpd");
      Object.keys(errs).forEach((k) => { if (k.startsWith("leave_")) delete errs[k]; });
      const full = numOrNull(pol.hours_required_full_day);
      const half = numOrNull(pol.hours_required_half_day);
      const whpd = numOrNull(pol.working_hours_per_day);
      if (full != null && (!Number.isFinite(full) || full < 0 || full > 24)) errs.full = "Must be between 0 and 24";
      if (half != null && (!Number.isFinite(half) || half < 0 || half > 24)) errs.half = "Must be between 0 and 24";
      if (whpd != null && (!Number.isFinite(whpd) || whpd < 0 || whpd > 24)) errs.whpd = "Must be between 0 and 24";
      if (!errs.full && !errs.half && full != null && half != null && half > full)
        errs.half = "Half-day hours cannot exceed full-day hours";
      leaveRows.forEach((r, i) => {
        if (!r.leave_type_id) errs[`leave_type_${i}`] = "Leave Name is required";
        if (!r.leave_credit_type) errs[`leave_credit_${i}`] = "Leave Credit Type is required";
        if (!r.leave_expire) errs[`leave_expire_${i}`] = "Leave Expire is required";
      });
    }
    if (key === "billingProps") {
      clear("start", "end");
      const sd = numOrNull(pol.billing_cycle_start_day);
      const ed = numOrNull(pol.billing_cycle_end_day);
      if (sd != null && (!Number.isInteger(sd) || sd < 1 || sd > 31)) errs.start = "Day must be 1–31";
      if (ed != null && (!Number.isInteger(ed) || ed < 1 || ed > 31)) errs.end = "Day must be 1–31";
    }

    setErrors(errs);
    const blocking = Object.keys(errs).filter((k) => {
      if (key === "branchInfo") return k === "branch_name";
      if (key === "leaveHolidayBilling") {
        return k === "full" || k === "half" || k === "whpd" || k.startsWith("leave_");
      }
      if (key === "billingProps") return k === "start" || k === "end";
      return false;
    });
    if (blocking.length) {
      if (!opts?.silent) notify("Please fix the highlighted fields", "err");
      return false;
    }
    return true;
  };

  const goToStep = (index: number) => {
    if (index > maxReached) return;
    if (index > clampedStep && !validateSection(currentSection.key)) return;
    setStepDir(index > clampedStep ? 1 : -1);
    setStepIndex(index);
  };
  const goPrev = () => {
    if (isFirstStep) return;
    setStepDir(-1);
    setStepIndex((i) => Math.max(0, i - 1));
  };
  const goNext = () => {
    if (!validateSection(currentSection.key)) return;
    const next = Math.min(clampedStep + 1, totalSteps - 1);
    setStepDir(1);
    setStepIndex(next);
    setMaxReached((m) => Math.max(m, next));
  };

  /* ------------------------------------------------------------------ save */
  const saveBranchPolicy = async () => {
    await crmPut(`/api/customers/branches/${branchId}/policy`, {
      branch_name: ident.branch_name.trim(),
      branch_legal_name: ident.branch_legal_name.trim() || null,
      billing_address: ident.billing_address.trim() || null,
      address_line_2: ident.address_line_2.trim() || null,
      delivery_address: ident.delivery_address.trim() || null,
      city: ident.city.trim() || null,
      state: ident.state.trim() || null,
      pincode: ident.pincode.trim() || null,
      country: ident.country.trim() || null,
      gstin: ident.gstin.trim() || null,
      pan: ident.pan.trim() || null,
      is_primary: ident.is_primary,
      holidays_billable: triToApi(pol.holidays_billable),
      weekoff_billable: triToApi(pol.weekoff_billable),
      leave_billable: triToApi(pol.leave_billable),
      comp_off_billable: triToApi(pol.comp_off_billable),
      hours_required_half_day: numOrNull(pol.hours_required_half_day),
      hours_required_full_day: numOrNull(pol.hours_required_full_day),
      hours_required_half_day_comp_off: numOrNull(pol.hours_required_half_day_comp_off),
      hours_required_full_day_comp_off: numOrNull(pol.hours_required_full_day_comp_off),
      working_hours_per_day: numOrNull(pol.working_hours_per_day),
      billing_type: pol.billing_type || null,
      billing_frequency: pol.billing_frequency || null,
      billing_cycle_start_day: numOrNull(pol.billing_cycle_start_day),
      billing_cycle_end_day: numOrNull(pol.billing_cycle_end_day),
      is_max_billable_hours_per_day: pol.is_max_billable_hours_per_day,
      max_billable_hours_per_day: pol.is_max_billable_hours_per_day ? numOrNull(pol.max_billable_hours_per_day) : null,
      is_max_billable_hours_per_month: pol.is_max_billable_hours_per_month,
      max_billable_hours_per_month: pol.is_max_billable_hours_per_month ? numOrNull(pol.max_billable_hours_per_month) : null,
      is_max_billable_days_per_month: pol.is_max_billable_days_per_month,
      max_billable_days_per_month: pol.is_max_billable_days_per_month ? numOrNull(pol.max_billable_days_per_month) : null,
      is_initial_no_billing_period: pol.is_initial_no_billing_period,
      initial_no_billing_qty: pol.is_initial_no_billing_period ? numOrNull(pol.initial_no_billing_qty) : null,
      initial_no_billing_period: pol.is_initial_no_billing_period ? (pol.initial_no_billing_period || null) : null,
    });
  };

  const saveLeavePolicies = async () => {
    const base = `/api/customers/branches/${branchId}/leave-policies`;
    for (const id of removedLeaveIds) {
      try { await crmDelete(`${base}/${id}`); } catch { /* ignore */ }
    }
    for (const row of leaveRows) {
      if (!row.leave_type_id) continue;
      const body = {
        leave_type_id: Number(row.leave_type_id),
        leave_credit_type: row.leave_credit_type,
        leave_credit_timing: row.leave_credit_timing || "Start_Of_Period",
        leave_expire: row.leave_expire || null,
        leave_expire_timing: row.leave_expire ? (row.leave_expire_timing || "End_Of_Period") : null,
        is_max_limit: row.is_max_limit,
        max_limit: row.is_max_limit ? numOrNull(row.max_limit) : null,
        prorate_balance_credit: row.prorate_balance_credit,
        is_billable: row.is_billable,
        leave_credit_balance: numOrNull(row.leave_credit_balance) ?? 0,
        // Not editable in the form any more, but still sent so editing a policy
        // never silently zeroes a value an older record already carries.
        initial_credit_balance: numOrNull(row.initial_credit_balance) ?? 0,
        maximum_carry_forward: numOrNull(row.maximum_carry_forward === "" ? "0" : row.maximum_carry_forward),
        effective_date: row.effective_date || null,
      };
      if (row.id) {
        await crmPut(`${base}/${row.id}`, body);
      } else {
        await crmPost(base, body);
      }
    }
  };

  const submit = async () => {
    if (!validateSection("branchInfo", { silent: true })) {
      setStepIndex(0);
      notify("Please fix the highlighted fields", "err");
      return;
    }
    if (!validateSection("leaveHolidayBilling", { silent: true })) { setStepIndex(2); return; }
    if (!validateSection("billingProps", { silent: true })) { setStepIndex(3); return; }
    setSaving(true);
    try {
      await saveBranchPolicy();
      await saveLeavePolicies();
      notify("Branch updated");
      onSaved();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save branch";
      notify(msg, "err");
    } finally {
      setSaving(false);
    }
  };

  /* ---------------------------------------------------------- leave rows ops */
  const leaveNameOf = (r: LeaveRow) =>
    leaveTypes.find((t) => String(t.id) === r.leave_type_id)?.name || r.name || "—";

  const openNewLeave = () => {
    setEditingLeave(emptyLeaveRow());
    setLeaveModalOpen(true);
  };
  const openEditLeave = (row: LeaveRow) => {
    setEditingLeave({ ...row });
    setLeaveModalOpen(true);
  };
  const closeLeaveModal = () => {
    setLeaveModalOpen(false);
    setEditingLeave(null);
  };
  const saveLeaveRowLocal = (row: LeaveRow) => {
    setLeaveRows((rows) => {
      const idx = rows.findIndex((r) => r.key === row.key);
      if (idx >= 0) {
        const next = [...rows];
        next[idx] = row;
        return next;
      }
      return [...rows, row];
    });
    closeLeaveModal();
  };
  const removeLeave = (key: string) =>
    setLeaveRows((rows) => {
      const row = rows.find((r) => r.key === key);
      if (row?.id) setRemovedLeaveIds((ids) => [...ids, row.id!]);
      return rows.filter((r) => r.key !== key);
    });

  const addLeaveType = async (name: string): Promise<LeaveType | null> => {
    const q = name.trim();
    if (!q) {
      notify("Enter a leave name to add", "err");
      return null;
    }
    setAddingType(true);
    try {
      const res = await crmPost<LeaveType>("/api/leave-policy-types", { name: q });
      const created = res.data;
      setLeaveTypes((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      return created;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to add leave type";
      notify(msg, "err");
      return null;
    } finally {
      setAddingType(false);
    }
  };

  /* ------------------------------------------------------------------ chrome */
  const header = (
    <WizardTopBar
      title={`Edit Branch — ${ident.branch_name || initial.branch_name}`}
      stepIndex={clampedStep}
      totalSteps={totalSteps}
      stepPct={stepPct}
      busy={saving}
      showAutosave={false}
    />
  );
  const footer = (
    <WizardFooter
      stepIndex={clampedStep}
      totalSteps={totalSteps}
      stepPct={stepPct}
      isFirstStep={isFirstStep}
      isLastStep={isLastStep}
      busy={saving}
      onPrev={goPrev}
      onNext={goNext}
      onSubmit={() => void submit()}
      submitLabel="Save changes"
      submitBusyLabel="Saving…"
    />
  );

  /* Enter = Next (not inside textarea). */
  const onKeyDownBody = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "TEXTAREA") return;
    e.preventDefault();
    if (!isLastStep) goNext();
  };

  const triSelect = (key: "weekoff_billable" | "leave_billable" | "holidays_billable" | "comp_off_billable", label: string, def: boolean | null) => (
    <Field label={label}>
      <select className={inputCls} value={pol[key]} onChange={(e) => setP(key, e.target.value)}>
        <option value="">Inherit customer default</option>
        <option value="yes">Yes (billable)</option>
        <option value="no">No (not billable)</option>
      </select>
      {pol[key] === "" && def != null && (
        <p className="mt-1 text-xs text-muted">Inherits customer default ({def ? "Billable" : "Not billable"})</p>
      )}
    </Field>
  );

  /** Source-form style billable checkbox (null → show inherited default as checked state). */
  const billableChk = (
    key: "holidays_billable" | "weekoff_billable",
    label: string,
    inherited: boolean,
  ) => {
    const explicit = pol[key];
    const checked = explicit === "" ? inherited : explicit === "yes";
    return (
      <label className="flex items-center gap-2 text-sm font-medium text-primary">
        <input
          type="checkbox"
          className={chk}
          checked={checked}
          onChange={(e) => setP(key, e.target.checked ? "yes" : "no")}
        />
        {label}
        {explicit === "" && (
          <span className="text-xs font-normal text-muted">(inherits {inherited ? "Yes" : "No"})</span>
        )}
      </label>
    );
  };

  const capRow = (
    label: string,
    tKey: "is_max_billable_hours_per_day" | "is_max_billable_hours_per_month" | "is_max_billable_days_per_month",
    vKey: "max_billable_hours_per_day" | "max_billable_hours_per_month" | "max_billable_days_per_month",
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

  const renderStepBody = () => {
    switch (currentSection.key) {
      case "branchInfo":
        return (
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Field label="Customer">
              <input className={inputCls} value={customerName || `Customer #${customerId}`} readOnly disabled />
            </Field>
            <Field label="Branch name" required error={errors.branch_name}>
              <input className={inputCls} value={ident.branch_name} onChange={(e) => setI("branch_name", e.target.value)} />
            </Field>
            <Field label="Legal entity name">
              <input className={inputCls} value={ident.branch_legal_name} onChange={(e) => setI("branch_legal_name", e.target.value)} />
            </Field>
            <Field label="GSTIN" error={errors.gstin}>
              <input className={inputCls} value={ident.gstin} maxLength={15}
                placeholder="e.g. 27AAHCK4749A1ZL"
                onChange={(e) => setI("gstin", e.target.value.toUpperCase())} />
            </Field>
            <Field label="PAN" error={errors.pan}>
              <input className={inputCls} value={ident.pan} maxLength={10}
                placeholder="e.g. AAHCK4749A"
                onChange={(e) => setI("pan", e.target.value.toUpperCase())} />
            </Field>
            <Field label="Billing address">
              <textarea className={inputCls} rows={2} value={ident.billing_address} onChange={(e) => setI("billing_address", e.target.value)} />
            </Field>
            <Field label="Address line 2">
              <input className={inputCls} value={ident.address_line_2} onChange={(e) => setI("address_line_2", e.target.value)} />
            </Field>
            <Field label="Delivery address">
              <textarea className={inputCls} rows={2} value={ident.delivery_address} onChange={(e) => setI("delivery_address", e.target.value)} />
            </Field>
            <Field label="City">
              <SearchableSelect
                value={ident.city}
                options={optionsFromStrings(INDIAN_CITIES)}
                allowAdd
                searchable
                placeholder="Search city…"
                onChange={(v) => setI("city", v)}
              />
            </Field>
            <Field label="State">
              <SearchableSelect
                value={ident.state}
                options={optionsFromStrings(INDIAN_STATES)}
                searchable
                placeholder="Search state…"
                onChange={(v) => setI("state", v)}
              />
            </Field>
            <Field label="Pincode">
              <input className={inputCls} value={ident.pincode} maxLength={16} onChange={(e) => setI("pincode", e.target.value)} />
            </Field>
            <Field label="Country">
              <SearchableSelect
                value={ident.country || DEFAULT_COUNTRY}
                options={optionsFromStrings(COUNTRIES)}
                allowAdd
                searchable
                placeholder="Search country…"
                onChange={(v) => setI("country", v)}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm font-semibold text-primary sm:col-span-2">
              <input type="checkbox" className={chk} checked={ident.is_primary} onChange={(e) => setI("is_primary", e.target.checked)} />
              Primary branch
            </label>
          </div>
        );
      case "holidayPolicy":
        return <BranchHolidayYearsPanel branchId={branchId} notify={notify} />;
      case "leaveHolidayBilling":
        return (
          <div className="space-y-5">
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Hours Required Half Day" error={errors.half}>
                <input type="number" step="0.5" min={0} max={24} className={inputCls}
                  placeholder={`Inherit (${defaults.halfDay})`}
                  value={pol.hours_required_half_day} onChange={(e) => setP("hours_required_half_day", e.target.value)} />
              </Field>
              <Field label="Hours Required Full Day" error={errors.full}>
                <input type="number" step="0.5" min={0} max={24} className={inputCls}
                  placeholder={`Inherit (${defaults.fullDay})`}
                  value={pol.hours_required_full_day} onChange={(e) => setP("hours_required_full_day", e.target.value)} />
              </Field>
              <Field label="Working Hours Per Day" error={errors.whpd}>
                <input type="number" step="0.5" min={0} max={24} className={inputCls}
                  placeholder={`Inherit (${defaults.perDay})`}
                  value={pol.working_hours_per_day} onChange={(e) => setP("working_hours_per_day", e.target.value)} />
              </Field>
              <Field label="Comp-Off Half Day Hours">
                <input type="number" step="0.5" min={0} max={24} className={inputCls}
                  value={pol.hours_required_half_day_comp_off} onChange={(e) => setP("hours_required_half_day_comp_off", e.target.value)} />
              </Field>
              <Field label="Comp-Off Full Day Hours">
                <input type="number" step="0.5" min={0} max={24} className={inputCls}
                  value={pol.hours_required_full_day_comp_off} onChange={(e) => setP("hours_required_full_day_comp_off", e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-6 rounded-xl border border-subtle bg-surface-2/30 px-4 py-3">
              {billableChk("holidays_billable", "Holidays Billable", defaults.holidays)}
              {billableChk("weekoff_billable", "Weekoff Billable", defaults.weekoff)}
            </div>
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {triSelect("leave_billable", "Leave Billable", defaults.leave)}
              {triSelect("comp_off_billable", "Comp-Off Billable", null)}
            </div>
            <InfoChip>
              Blank hour fields inherit the customer default. Holidays/Weekoff Billable bill worked
              holiday/weekend hours as normal (precedence over Comp-Off Billable). If both direct and
              Comp-Off flags are off, Comp-Off leave is credited on submit.
            </InfoChip>

            <div className="rounded-control border border-subtle bg-surface-2/20 p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-primary">Billable Leave Policy</p>
                  <p className="mt-0.5 text-xs text-muted">
                    Optional per-branch leave policy rows. May be left empty.
                  </p>
                </div>
                <button type="button" className={btnSecondary} onClick={openNewLeave}>
                  <Plus size={14} /> Add New Leave
                </button>
              </div>

              {leaveRows.length === 0 ? (
                <p className="rounded-control border border-dashed border-subtle px-3 py-6 text-center text-sm text-muted">
                  No billable leave policies yet for this branch.
                </p>
              ) : (
                <ul className="space-y-2">
                  {leaveRows.map((r, i) => (
                    <li
                      key={r.key}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-subtle bg-surface-1 px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-primary">{leaveNameOf(r)}</p>
                        <p className="mt-0.5 text-xs text-muted">
                          {r.leave_credit_type || "—"} · Balance {r.leave_credit_balance || "—"} · Expire {r.leave_expire || "—"} · {r.is_billable ? "Billable" : "Not billable"}
                        </p>
                        {(errors[`leave_type_${i}`] || errors[`leave_credit_${i}`] || errors[`leave_expire_${i}`]) && (
                          <p className="mt-1 text-xs text-danger" role="alert">
                            {errors[`leave_type_${i}`] || errors[`leave_credit_${i}`] || errors[`leave_expire_${i}`]}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          className={`${btnSecondary} !px-2 !py-1 text-xs`}
                          onClick={() => openEditLeave(r)}
                          aria-label="Edit leave policy"
                        >
                          <Pencil size={13} /> Edit
                        </button>
                        <button
                          type="button"
                          className="rounded-control p-1.5 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                          onClick={() => removeLeave(r.key)}
                          aria-label="Remove leave policy"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {/* Inherited customer defaults — read-only fallback view. A branch
                  row for the same leave type overrides the default. */}
              {customerDefaultLeaveRows.length > 0 && (
                <div className="mt-4 rounded-control border border-dashed border-subtle bg-surface-2/30 p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">
                    Inherited customer defaults
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    Apply only for leave types this branch has NOT defined above. Edit them in
                    the Customer form's Billing Policy step.
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {customerDefaultLeaveRows.map((r) => {
                      const overridden = leaveRows.some(
                        (b) => b.leave_type_id === r.leave_type_id,
                      );
                      return (
                        <li
                          key={r.key}
                          className={`flex flex-wrap items-center justify-between gap-2 rounded-control px-3 py-2 text-xs ${
                            overridden ? "opacity-50" : ""
                          }`}
                        >
                          <span className="font-semibold text-secondary">{leaveNameOf(r)}</span>
                          <span className="text-muted">
                            {r.leave_credit_type || "—"} · Balance {r.leave_credit_balance || "—"} · Expire {r.leave_expire || "—"}
                            {overridden ? " · overridden by this branch" : ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </div>
        );
      case "billingProps":
        return (
          <div className="space-y-5">
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Billing Type">
                <select className={inputCls} value={pol.billing_type} onChange={(e) => setP("billing_type", e.target.value)}>
                  <option value="">— Not set —</option>
                  {BILLING_TYPE_CHOICES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Billing Frequency">
                <select className={inputCls} value={pol.billing_frequency} onChange={(e) => setP("billing_frequency", e.target.value)}>
                  <option value="">— Not set —</option>
                  {BILLING_FREQUENCY_CHOICES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Billing Cycle Start Day" error={errors.start}>
                <input type="number" min={1} max={31} step={1} className={inputCls} placeholder="1–31"
                  value={pol.billing_cycle_start_day} onChange={(e) => setP("billing_cycle_start_day", e.target.value)} />
              </Field>
              <Field label="Billing Cycle End Day" error={errors.end}>
                <input type="number" min={1} max={31} step={1} className={inputCls} placeholder="1–31"
                  value={pol.billing_cycle_end_day} onChange={(e) => setP("billing_cycle_end_day", e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {capRow("Max Billable Hours / Day", "is_max_billable_hours_per_day", "max_billable_hours_per_day")}
              {capRow("Max Billable Hours / Month", "is_max_billable_hours_per_month", "max_billable_hours_per_month")}
              {capRow("Max Billable Days / Month", "is_max_billable_days_per_month", "max_billable_days_per_month")}
            </div>
            <div className="rounded-control border border-subtle bg-surface-2/40 p-4">
              <label className="flex items-center gap-2 text-sm font-medium text-primary">
                <input type="checkbox" className={chk} checked={pol.is_initial_no_billing_period}
                  onChange={(e) => setP("is_initial_no_billing_period", e.target.checked)} />
                Initial No-Billing Period
              </label>
              <div className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <Field label="Initial No-Billing Qty">
                  <input type="number" min={0} step={1} className={inputCls}
                    value={pol.initial_no_billing_qty}
                    disabled={!pol.is_initial_no_billing_period}
                    placeholder={pol.is_initial_no_billing_period ? "Enter a quantity" : "Enable the toggle to set"}
                    onChange={(e) => setP("initial_no_billing_qty", e.target.value)} />
                </Field>
                <Field label="Initial No-Billing Period">
                  <select className={inputCls} value={pol.initial_no_billing_period}
                    disabled={!pol.is_initial_no_billing_period}
                    onChange={(e) => setP("initial_no_billing_period", e.target.value)}>
                    <option value="">— Select —</option>
                    {NO_BILLING_PERIOD_CHOICES.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </Field>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <WizardShell
        onClose={onClose}
        topBar={header}
        footer={footer}
        steps={wizardSteps}
        currentIndex={clampedStep}
        maxReached={maxReached}
        onSelectStep={goToStep}
        stepProgressPct={stepCompletePct}
        ariaLabel="Edit branch wizard steps"
        contentRef={bodyRef}
      >
        <div onKeyDown={onKeyDownBody}>
          <WizardStepCard stepKey={currentSection.key} stepDir={stepDir}>
            <SectionHeaderBanner
              title={currentSection.title}
              description={currentSection.description}
              icon={currentSection.icon}
              headingRef={stepHeadingRef}
            />
            {renderStepBody()}
          </WizardStepCard>
        </div>
      </WizardShell>

      {leaveModalOpen && editingLeave && (
        <BranchLeaveBillingDialog
          initial={editingLeave}
          leaveTypes={leaveTypes}
          addingType={addingType}
          onClose={closeLeaveModal}
          onSave={saveLeaveRowLocal}
          onAddType={addLeaveType}
        />
      )}
    </>
  );
}
