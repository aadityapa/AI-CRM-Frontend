/**
 * Project wizard — shared premium chrome for Create + Edit.
 * Steps (edit): Leave & Holiday Billing Policy (combined) → Billing Properties.
 * Steps (create): Project Details + same policy sections.
 * Create mode: Branch selector (from customer) drives branch_id + policy prefill.
 *
 * Column mapping notes (reconciled with existing Project model — no duplicates):
 *   hours → hours_required_half_day / full_day / *_comp_off
 *   caps  → is_max_billable_* toggles + max_billable_hours_day|month / days_month
 *   Initial No Billing QTY (UI dropdown Hours|Days|…) → initial_no_billing_period
 *   Initial No Billing Period (UI numeric)           → initial_no_billing_qty
 * Branch → form caps: max_billable_hours_per_day → max_billable_hours_day (etc.)
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Briefcase, CircleDot, Clock3, FolderKanban, GitBranch, Timer } from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut } from "../api";
import { ConfirmModal, inputCls } from "./ui";
import { SearchableSelect } from "./SearchableSelect";
import {
  SectionHeaderBanner,
  WizardField,
  WizardFooter,
  WizardShell,
  WizardStepCard,
  WizardTopBar,
  type StepStatus,
  type WizardStep,
} from "./wizard";
import {
  BillingPropertiesSection,
  LeaveBillingPolicySection,
  LeaveHolidayBillingSection,
  LEAVE_CREDIT_TYPE_CHOICES,
  LEAVE_EXPIRE_CHOICES,
  PROJECT_STATUSES,
  defaultPolicyForm,
  numOrNull,
  policyPayloadFromForm,
  strOr,
  uid,
  type LeaveRow,
  type LeaveType,
  type PolicyFormState,
  type PolicySectionKey,
} from "./ProjectPolicySections";

type Notify = (msg: string, kind?: "ok" | "err") => void;

export type ProjectWizardInitial = {
  id: number;
  name: string;
  status: string;
  customer_id?: number;
  customer_name?: string | null;
  branch_id?: number | null;
  branch_name?: string | null;
  billing_cycle_start_day: number;
  billing_cycle_end_day: number;
  billing_frequency: string;
  recurring_billing?: boolean | null;
  holidays_billable?: boolean | null;
  weekoff_billable?: boolean | null;
  comp_off_billable?: boolean | null;
  hours_required_half_day?: number | null;
  hours_required_full_day?: number | null;
  hours_required_half_day_comp_off?: number | null;
  hours_required_full_day_comp_off?: number | null;
  is_max_billable_hours_per_day?: boolean | null;
  max_billable_hours_day?: number | null;
  is_max_billable_hours_per_month?: boolean | null;
  max_billable_hours_month?: number | null;
  is_max_billable_days_per_month?: boolean | null;
  max_billable_days_month?: number | null;
  is_initial_no_billing_period?: boolean | null;
  initial_no_billing_qty?: number | null;
  initial_no_billing_period?: string | null;
};

type OppOption = {
  id: number;
  title: string;
  customer_id?: number;
  customer_name?: string;
  branch_id?: number | null;
  branch_name?: string | null;
};
type CustomerOption = { id: number; name: string };
type BranchOption = { id: number; branch_name: string };

type SectionDef = {
  key: PolicySectionKey | "projectDetails";
  title: string;
  description: string;
  icon: React.ReactNode;
};

/** Branch GET /policy payload fields used for create-mode prefill. */
type BranchPolicyPayload = {
  branch_name?: string | null;
  holidays_billable?: boolean | null;
  weekoff_billable?: boolean | null;
  comp_off_billable?: boolean | null;
  leave_billable?: boolean | null;
  hours_required_half_day?: number | null;
  hours_required_full_day?: number | null;
  hours_required_half_day_comp_off?: number | null;
  hours_required_full_day_comp_off?: number | null;
  billing_cycle_start_day?: number | null;
  billing_cycle_end_day?: number | null;
  billing_frequency?: string | null;
  is_max_billable_hours_per_day?: boolean | null;
  max_billable_hours_per_day?: number | null;
  is_max_billable_hours_per_month?: boolean | null;
  max_billable_hours_per_month?: number | null;
  is_max_billable_days_per_month?: boolean | null;
  max_billable_days_per_month?: number | null;
  is_initial_no_billing_period?: boolean | null;
  initial_no_billing_qty?: number | null;
  initial_no_billing_period?: string | null;
  leave_policies?: Record<string, unknown>[];
};

const POLICY_SECTION_DEFS: SectionDef[] = [
  {
    key: "leavePolicy",
    title: "Leave & Holiday Billing Policy",
    description: "Holiday/week-off billability, hours thresholds, and per-leave-type credit rules.",
    icon: <Clock3 size={18} />,
  },
  {
    key: "billingProps",
    title: "Billing Properties",
    description: "Billing cycle, frequency, caps, and initial no-billing period.",
    icon: <Timer size={18} />,
  },
];

const CREATE_DETAILS_SECTION: SectionDef = {
  key: "projectDetails",
  title: "Project Details",
  description: "Name, opportunity, customer, and branch for the new project.",
  icon: <FolderKanban size={18} />,
};

function polFromInitial(initial: ProjectWizardInitial): PolicyFormState {
  return {
    holidays_billable: !!initial.holidays_billable,
    weekoff_billable: !!initial.weekoff_billable,
    comp_off_billable: !!initial.comp_off_billable,
    hours_required_half_day: strOr(initial.hours_required_half_day),
    hours_required_full_day: strOr(initial.hours_required_full_day),
    hours_required_half_day_comp_off: strOr(initial.hours_required_half_day_comp_off),
    hours_required_full_day_comp_off: strOr(initial.hours_required_full_day_comp_off),
    billing_cycle_start_day: String(initial.billing_cycle_start_day ?? 1),
    billing_cycle_end_day: String(initial.billing_cycle_end_day ?? 31),
    recurring_billing: initial.recurring_billing !== false,
    billing_frequency:
      initial.billing_frequency === "Bi_Weekly" ? "Monthly" : (initial.billing_frequency || "Monthly"),
    is_max_billable_hours_per_day: !!initial.is_max_billable_hours_per_day,
    max_billable_hours_day: strOr(initial.max_billable_hours_day),
    is_max_billable_hours_per_month: !!initial.is_max_billable_hours_per_month,
    max_billable_hours_month: strOr(initial.max_billable_hours_month),
    is_max_billable_days_per_month: !!initial.is_max_billable_days_per_month,
    max_billable_days_month: strOr(initial.max_billable_days_month),
    is_initial_no_billing_period: !!initial.is_initial_no_billing_period,
    initial_no_billing_qty_unit: initial.initial_no_billing_period || "",
    initial_no_billing_period_num: strOr(initial.initial_no_billing_qty),
  };
}

/** Mirror create_project branch→project seeding pairs into PolicyFormState. */
function polFromBranch(branch: BranchPolicyPayload): PolicyFormState {
  const freqRaw = branch.billing_frequency
    ? String(branch.billing_frequency).trim().replace(/-/g, "_")
    : "";
  const billing_frequency =
    !freqRaw || freqRaw === "Bi_Weekly" ? "Monthly" : freqRaw;
  return {
    holidays_billable: !!branch.holidays_billable,
    weekoff_billable: !!branch.weekoff_billable,
    comp_off_billable: !!branch.comp_off_billable,
    hours_required_half_day: strOr(branch.hours_required_half_day),
    hours_required_full_day: strOr(branch.hours_required_full_day),
    hours_required_half_day_comp_off: strOr(branch.hours_required_half_day_comp_off),
    hours_required_full_day_comp_off: strOr(branch.hours_required_full_day_comp_off),
    billing_cycle_start_day: String(branch.billing_cycle_start_day ?? 1),
    billing_cycle_end_day: String(branch.billing_cycle_end_day ?? 31),
    recurring_billing: true,
    billing_frequency,
    is_max_billable_hours_per_day: !!branch.is_max_billable_hours_per_day,
    max_billable_hours_day: strOr(branch.max_billable_hours_per_day),
    is_max_billable_hours_per_month: !!branch.is_max_billable_hours_per_month,
    max_billable_hours_month: strOr(branch.max_billable_hours_per_month),
    is_max_billable_days_per_month: !!branch.is_max_billable_days_per_month,
    max_billable_days_month: strOr(branch.max_billable_days_per_month),
    is_initial_no_billing_period: !!branch.is_initial_no_billing_period,
    initial_no_billing_qty_unit: branch.initial_no_billing_period || "",
    initial_no_billing_period_num: strOr(branch.initial_no_billing_qty),
  };
}

function leaveRowsFromBranch(policies: Record<string, unknown>[] | undefined): LeaveRow[] {
  /** Branch/customer leave labels → project leave canonical enums. */
  const creditMap: Record<string, string> = {
    "Credit Balance Every Month": "Monthly",
    "Carry Forward Every Month": "Monthly",
    Yearly: "Yearly",
    Annually: "Yearly",
    One_Time: "Yearly",
  };
  const expireMap: Record<string, string> = {
    Days: "Monthly",
    Annually: "Yearly",
    "Carry Forward": "Yearly",
  };
  const toCredit = (raw: string) => {
    if (!raw) return "";
    if ((LEAVE_CREDIT_TYPE_CHOICES as readonly string[]).includes(raw)) return raw;
    return creditMap[raw] || "";
  };
  const toExpire = (raw: string) => {
    if (!raw) return "";
    if ((LEAVE_EXPIRE_CHOICES as readonly string[]).includes(raw)) return raw;
    return expireMap[raw] || "";
  };
  return (policies || []).map((row) => {
    const carry =
      row.maximum_carry_forward != null
        ? row.maximum_carry_forward
        : row.max_limit;
    return {
      key: uid(),
      // No project-policy id — POST as new rows on create.
      leave_type_id: row.leave_type_id != null ? String(row.leave_type_id) : "",
      name: String(row.leave_name || row.name || ""),
      leave_credit_type: toCredit(String(row.leave_credit_type || "")),
      leave_credit_timing: String(row.leave_credit_timing || "Start_Of_Period"),
      leave_credit_balance: row.leave_credit_balance != null ? String(row.leave_credit_balance) : "",
      initial_credit_balance: row.initial_credit_balance != null ? String(row.initial_credit_balance) : "0",
      leave_expire: toExpire(String(row.leave_expire || "")),
      leave_expire_timing: String(row.leave_expire_timing || "End_Of_Period"),
      is_max_limit: !!row.is_max_limit,
      maximum_carry_forward: carry != null ? String(carry) : "0",
      effective_date: row.effective_date ? String(row.effective_date).slice(0, 10) : "",
    };
  });
}

const BRANCH_POLICY_MARKER_KEYS: (keyof BranchPolicyPayload)[] = [
  "holidays_billable", "weekoff_billable", "leave_billable",
  "hours_required_half_day", "hours_required_full_day",
  "hours_required_half_day_comp_off", "hours_required_full_day_comp_off",
  "billing_cycle_start_day", "billing_cycle_end_day", "billing_frequency",
  "is_max_billable_hours_per_day", "max_billable_hours_per_day",
  "is_max_billable_hours_per_month", "max_billable_hours_per_month",
  "is_max_billable_days_per_month", "max_billable_days_per_month",
  "is_initial_no_billing_period", "initial_no_billing_qty", "initial_no_billing_period",
];

function branchHasSavedPolicy(branch: BranchPolicyPayload): boolean {
  if ((branch.leave_policies || []).length > 0) return true;
  return BRANCH_POLICY_MARKER_KEYS.some((k) => branch[k] != null);
}

function isPolicyFormDefault(pol: PolicyFormState, rows: LeaveRow[]): boolean {
  if (rows.length > 0) return false;
  const d = defaultPolicyForm();
  return (Object.keys(d) as (keyof PolicyFormState)[]).every((k) => pol[k] === d[k]);
}

function leaveRowPayload(row: LeaveRow) {
  return {
    leave_type_id: Number(row.leave_type_id),
    name: row.name.trim() || null,
    leave_credit_type: row.leave_credit_type,
    leave_credit_timing: row.leave_credit_timing || "Start_Of_Period",
    leave_credit_balance: numOrNull(row.leave_credit_balance) ?? 0,
    initial_credit_balance: numOrNull(row.initial_credit_balance) ?? 0,
    leave_expire: row.leave_expire,
    leave_expire_timing: row.leave_expire ? (row.leave_expire_timing || "End_Of_Period") : null,
    is_max_limit: row.is_max_limit,
    maximum_carry_forward: Math.trunc(numOrNull(row.maximum_carry_forward) ?? 0),
    effective_date: row.effective_date || null,
  };
}

/* ==================================================================== main */
function ProjectWizard({
  mode,
  initial,
  opps = [],
  customers = [],
  onClose,
  onSaved,
  notify,
}: {
  mode: "create" | "edit";
  initial?: ProjectWizardInitial;
  opps?: OppOption[];
  customers?: CustomerOption[];
  onClose: () => void;
  onSaved: (project?: { id: number }) => void;
  notify: Notify;
}) {
  const isCreate = mode === "create";
  const projectId = initial?.id;
  const sections = useMemo(
    () => (isCreate ? [CREATE_DETAILS_SECTION, ...POLICY_SECTION_DEFS] : POLICY_SECTION_DEFS),
    [isCreate],
  );

  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [maxReached, setMaxReached] = useState(sections.length - 1);
  const [stepDir, setStepDir] = useState(1);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [name, setName] = useState(initial?.name || "");
  const [status, setStatus] = useState(initial?.status || "Active");
  const [oppId, setOppId] = useState("");
  const [customerId, setCustomerId] = useState(
    initial?.customer_id != null ? String(initial.customer_id) : "",
  );
  const [branchId, setBranchId] = useState(
    initial?.branch_id != null ? String(initial.branch_id) : "",
  );
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);

  const [pol, setPol] = useState<PolicyFormState>(
    () => (initial ? polFromInitial(initial) : defaultPolicyForm()),
  );
  const setP = (k: keyof PolicyFormState, v: string | boolean) => {
    setPolicyUserEdited(true);
    setPol((s) => ({ ...s, [k]: v }));
  };

  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveRows, setLeaveRows] = useState<LeaveRow[]>([]);
  const [removedLeaveIds, setRemovedLeaveIds] = useState<number[]>([]);
  const [addingType, setAddingType] = useState(false);
  const [policyUserEdited, setPolicyUserEdited] = useState(false);
  const [branchReloadConfirm, setBranchReloadConfirm] = useState<{
    branchId: number;
    branchName: string;
    payload: BranchPolicyPayload;
  } | null>(null);
  const polRef = useRef(pol);
  const leaveRowsRef = useRef(leaveRows);
  const policyUserEditedRef = useRef(policyUserEdited);
  const branchIdRef = useRef(branchId);
  polRef.current = pol;
  leaveRowsRef.current = leaveRows;
  policyUserEditedRef.current = policyUserEdited;
  branchIdRef.current = branchId;

  const branchRequired = !!customerId && branches.length > 0;
  const branchOptions = useMemo(
    () => branches.map((b) => ({ value: String(b.id), label: b.branch_name })),
    [branches],
  );

  useEffect(() => {
    crmGet<LeaveType[]>("/api/leave-policy-types?limit=100")
      .then((r) => setLeaveTypes(r.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isCreate || projectId == null) return;
    crmGet<ProjectWizardInitial>(`/api/projects/${projectId}`)
      .then((r) => {
        const p = r.data;
        if (!p) return;
        setName(p.name || "");
        setStatus(p.status || "Active");
        if (p.customer_id != null) setCustomerId(String(p.customer_id));
        if (p.branch_id != null) setBranchId(String(p.branch_id));
        setPol(polFromInitial(p));
      })
      .catch(() => {});
    crmGet<Record<string, unknown>[]>(`/api/projects/${projectId}/leave-policies`)
      .then((r) => {
        const rows = (r.data || []).map((row) => ({
          key: uid(),
          id: Number(row.id),
          leave_type_id: row.leave_type_id != null ? String(row.leave_type_id) : "",
          name: String(row.name || ""),
          leave_credit_type: String(row.leave_credit_type || "Monthly"),
          leave_credit_timing: String(row.leave_credit_timing || "Start_Of_Period"),
          leave_credit_balance: row.leave_credit_balance != null ? String(row.leave_credit_balance) : "",
          initial_credit_balance: row.initial_credit_balance != null ? String(row.initial_credit_balance) : "0",
          leave_expire: String(row.leave_expire || "Yearly"),
          leave_expire_timing: String(row.leave_expire_timing || "End_Of_Period"),
          is_max_limit: !!row.is_max_limit,
          maximum_carry_forward: row.maximum_carry_forward != null ? String(row.maximum_carry_forward) : "0",
          effective_date: row.effective_date ? String(row.effective_date).slice(0, 10) : "",
        }));
        setLeaveRows(rows);
      })
      .catch(() => setLeaveRows([]));
  }, [isCreate, projectId]);

  const totalSteps = sections.length;
  const clampedStep = Math.min(Math.max(stepIndex, 0), totalSteps - 1);
  const currentSection = sections[clampedStep];
  const isFirstStep = clampedStep === 0;
  const isLastStep = clampedStep === totalSteps - 1;
  const stepPct = Math.round(((clampedStep + 1) / totalSteps) * 100);

  const sectionStatus = (key: SectionDef["key"]): StepStatus => {
    switch (key) {
      case "projectDetails":
        if (errors.name || errors.opp || errors.customer || errors.branch) return "error";
        if (!(name.trim() && oppId && customerId)) return "empty";
        if (branchRequired && !branchId) return "empty";
        return "complete";
      case "leavePolicy": {
        const holidayErr = !!(errors.name || errors.half || errors.branch);
        const leaveErr = Object.keys(errors).some(
          (k) => k.startsWith("leave_type_") || k.startsWith("credit_") || k.startsWith("expire_"),
        );
        if (holidayErr || leaveErr) return "error";
        const holidayOk = isCreate
          ? !!(pol.hours_required_half_day || pol.hours_required_full_day || pol.holidays_billable || pol.weekoff_billable)
          : !!name.trim();
        const leaveOk = leaveRows.some((r) => r.leave_type_id);
        if (holidayOk && leaveOk) return "complete";
        if (holidayOk || leaveOk) return "partial";
        return "empty";
      }
      case "billingProps":
        if (errors.start || errors.end || errors.freq) return "error";
        return pol.billing_frequency ? "complete" : "empty";
      default:
        return "empty";
    }
  };

  const wizardSteps: WizardStep[] = useMemo(
    () =>
      sections.map((s) => ({
        key: s.key,
        title: s.title,
        sublabel: s.description.split(".")[0],
        status: sectionStatus(s.key),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, status, oppId, customerId, branchId, branches, pol, leaveRows, errors, sections],
  );

  const stepCompletePct = (() => {
    const st = sectionStatus(currentSection.key);
    if (st === "complete") return 100;
    if (st === "partial") return 55;
    if (st === "error") return 30;
    return 0;
  })();

  const goToStep = (i: number) => {
    if (i < 0 || i >= totalSteps || i > maxReached) return;
    setStepDir(i > clampedStep ? 1 : -1);
    setStepIndex(i);
  };
  const goPrev = () => { if (!isFirstStep) goToStep(clampedStep - 1); };
  const goNext = () => {
    if (!validateStep(clampedStep)) return;
    if (!isLastStep) {
      const next = clampedStep + 1;
      setMaxReached((m) => Math.max(m, next));
      setStepDir(1);
      setStepIndex(next);
    }
  };

  const validateStep = (idx: number): boolean => {
    const errs: Record<string, string> = {};
    const key = sections[idx]?.key;
    if (key === "projectDetails") {
      if (!name.trim()) errs.name = "Name is required";
      if (!oppId) errs.opp = "Opportunity is required";
      if (!customerId) errs.customer = "Customer is required";
      if (branchRequired && !branchId) errs.branch = "Branch is required";
    }
    if (key === "leavePolicy") {
      if (!isCreate && !name.trim()) errs.name = "Name is required";
      if (!isCreate && branchRequired && !branchId) errs.branch = "Branch is required";
      const half = numOrNull(pol.hours_required_half_day);
      const full = numOrNull(pol.hours_required_full_day);
      if (half != null && full != null && half > full) {
        errs.half = "Half-day hours cannot exceed full-day hours";
      }
      leaveRows.forEach((r, i) => {
        if (!r.leave_type_id) errs[`leave_type_${i}`] = "Leave Name is required";
        if (!r.leave_credit_type) errs[`credit_${i}`] = "Required";
        if (!r.leave_expire) errs[`expire_${i}`] = "Required";
      });
    }
    if (key === "billingProps") {
      const sd = Number(pol.billing_cycle_start_day);
      const ed = Number(pol.billing_cycle_end_day);
      if (!(sd >= 1 && sd <= 31)) errs.start = "Must be 1–31";
      if (!(ed >= 1 && ed <= 31)) errs.end = "Must be 1–31";
      if (!pol.billing_frequency) errs.freq = "Billing Frequency is required";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const syncLeavePolicies = async (id: number) => {
    const nestedBase = `/api/projects/${id}/leave-policies`;
    for (const rid of removedLeaveIds) {
      await crmDelete(`/api/projects/leave-policies/${rid}`);
    }
    for (const row of leaveRows) {
      if (!row.leave_type_id) continue;
      const payload = leaveRowPayload(row);
      if (row.id) {
        await crmPut(`/api/projects/leave-policies/${row.id}`, payload);
      } else {
        await crmPost(nestedBase, payload);
      }
    }
  };

  const createLeavePolicies = async (id: number) => {
    const base = `/api/projects/${id}/leave-policies`;
    for (const row of leaveRows) {
      if (!row.leave_type_id) continue;
      await crmPost(base, leaveRowPayload(row));
    }
  };

  const submit = async () => {
    for (let i = 0; i < totalSteps; i++) {
      if (!validateStep(i)) {
        setStepIndex(i);
        return;
      }
    }
    setSaving(true);
    try {
      const policy = policyPayloadFromForm(pol);
      if (isCreate) {
        // Always send identity + cycle/frequency (legacy create). Optional policy
        // fields are only included when set so branch seeding still applies.
        const body: Record<string, unknown> = {
          name: name.trim(),
          opportunity_id: Number(oppId),
          customer_id: Number(customerId),
          status,
          billing_cycle_start_day: policy.billing_cycle_start_day,
          billing_cycle_end_day: policy.billing_cycle_end_day,
          billing_frequency: policy.billing_frequency,
          recurring_billing: policy.recurring_billing,
          branch_id: Number(branchId) || null,
        };
        if (pol.holidays_billable) body.holidays_billable = true;
        if (pol.weekoff_billable) body.weekoff_billable = true;
        for (const k of [
          "hours_required_half_day", "hours_required_full_day",
          "hours_required_half_day_comp_off", "hours_required_full_day_comp_off",
        ] as const) {
          if (policy[k] != null) body[k] = policy[k];
        }
        if (pol.is_max_billable_hours_per_day) {
          body.is_max_billable_hours_per_day = true;
          if (policy.max_billable_hours_day != null) body.max_billable_hours_day = policy.max_billable_hours_day;
        }
        if (pol.is_max_billable_hours_per_month) {
          body.is_max_billable_hours_per_month = true;
          if (policy.max_billable_hours_month != null) body.max_billable_hours_month = policy.max_billable_hours_month;
        }
        if (pol.is_max_billable_days_per_month) {
          body.is_max_billable_days_per_month = true;
          if (policy.max_billable_days_month != null) body.max_billable_days_month = policy.max_billable_days_month;
        }
        if (pol.is_initial_no_billing_period) {
          body.is_initial_no_billing_period = true;
          if (policy.initial_no_billing_period) body.initial_no_billing_period = policy.initial_no_billing_period;
          if (policy.initial_no_billing_qty != null) body.initial_no_billing_qty = policy.initial_no_billing_qty;
        }
        const res = await crmPost<{ id: number }>("/api/projects", body);
        const created = res.data;
        await createLeavePolicies(created.id);
        notify("Project created");
        onSaved(created);
      } else {
        if (projectId == null) throw new Error("Missing project id");
        await crmPut(`/api/projects/${projectId}`, {
          name: name.trim(),
          status,
          branch_id: Number(branchId) || null,
          ...policy,
        });
        await syncLeavePolicies(projectId);
        notify("Project updated");
        onSaved({ id: projectId });
      }
    } catch (e: any) {
      notify(e?.message || (isCreate ? "Failed to create project" : "Failed to update project"), "err");
    } finally {
      setSaving(false);
    }
  };

  const applyBranchPolicy = (bid: number, payload: BranchPolicyPayload) => {
    if (!branchHasSavedPolicy(payload)) {
      setBranchId(String(bid));
      setPolicyUserEdited(false);
      return;
    }
    setPol(polFromBranch(payload));
    setLeaveRows(leaveRowsFromBranch(payload.leave_policies));
    setRemovedLeaveIds([]);
    setBranchId(String(bid));
    setPolicyUserEdited(false);
  };

  const resolveAndPrefillBranch = async (
    bid: number,
    branchNameHint?: string | null,
    force = false,
  ) => {
    if (!force && branchIdRef.current === String(bid) && !policyUserEditedRef.current) return;
    try {
      const res = await crmGet<BranchPolicyPayload>(`/api/customers/branches/${bid}/policy`);
      const payload = res.data;
      if (!payload) {
        setBranchId(String(bid));
        return;
      }
      if (!branchHasSavedPolicy(payload)) {
        setBranchId(String(bid));
        return;
      }
      const label = branchNameHint || payload.branch_name || `Branch #${bid}`;
      const firstResolution = !branchIdRef.current;
      const atDefaults = isPolicyFormDefault(polRef.current, leaveRowsRef.current);
      const wouldOverwrite = policyUserEditedRef.current && !atDefaults && !firstResolution
        && branchIdRef.current !== String(bid);
      if (wouldOverwrite) {
        setBranchReloadConfirm({ branchId: bid, branchName: String(label), payload });
        return;
      }
      applyBranchPolicy(bid, payload);
    } catch {
      setBranchId(String(bid));
    }
  };

  /** Load customer branches; optionally prefer a branch id (opp / saved project). */
  const loadBranchesForCustomer = async (
    cid: string,
    preferredBranchId: number | null,
    opts?: { prefill?: boolean },
  ) => {
    if (!cid) {
      setBranches([]);
      setBranchId("");
      return;
    }
    setBranchesLoading(true);
    try {
      const res = await crmGet<BranchOption[]>(`/api/customers/${cid}/branches`);
      const list = (res.data || []).map((b) => ({
        id: Number(b.id),
        branch_name: b.branch_name || `Branch #${b.id}`,
      }));
      setBranches(list);
      let next = "";
      if (preferredBranchId != null && list.some((b) => b.id === preferredBranchId)) {
        next = String(preferredBranchId);
      } else if (list.length === 1) {
        next = String(list[0].id);
      }
      setBranchId(next);
      if (opts?.prefill && next) {
        const label = list.find((b) => String(b.id) === next)?.branch_name;
        await resolveAndPrefillBranch(Number(next), label, true);
      }
    } catch {
      setBranches([]);
      setBranchId("");
    } finally {
      setBranchesLoading(false);
    }
  };

  const onCustomerChange = (v: string) => {
    setCustomerId(v);
    setBranchId("");
    setBranches([]);
    setErrors((e) => {
      const next = { ...e };
      delete next.branch;
      delete next.customer;
      return next;
    });
    if (!v) return;
    void loadBranchesForCustomer(v, null, { prefill: isCreate });
  };

  const onBranchChange = (v: string) => {
    setBranchId(v);
    setErrors((e) => {
      const next = { ...e };
      delete next.branch;
      return next;
    });
    if (!v) return;
    void resolveAndPrefillBranch(
      Number(v),
      branches.find((b) => String(b.id) === v)?.branch_name,
      true,
    );
  };

  // Edit mode: load branches once customer is known (keep saved branch; no policy overwrite).
  useEffect(() => {
    if (isCreate || !customerId) return;
    const preferred = branchIdRef.current
      ? Number(branchIdRef.current)
      : (initial?.branch_id ?? null);
    void loadBranchesForCustomer(customerId, preferred, { prefill: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreate, customerId]);

  const saveLeaveRow = async (row: LeaveRow) => {
    let saved: LeaveRow = { ...row };
    // Persist immediately when editing an existing project (modal Save).
    if (!isCreate && projectId != null && row.leave_type_id) {
      const payload = leaveRowPayload(row);
      if (row.id) {
        await crmPut(`/api/projects/leave-policies/${row.id}`, payload);
      } else {
        const res = await crmPost<Record<string, unknown>>(
          `/api/projects/${projectId}/leave-policies`,
          payload,
        );
        const newId = res.data?.id != null ? Number(res.data.id) : undefined;
        if (newId) saved = { ...saved, id: newId };
      }
    }
    if (isCreate) setPolicyUserEdited(true);
    setLeaveRows((rows) => {
      const has = rows.some((r) => r.key === saved.key);
      if (has) return rows.map((r) => (r.key === saved.key ? saved : r));
      return [...rows, saved];
    });
  };

  const deleteLeaveRow = async (row: LeaveRow) => {
    if (row.id) {
      // Existing row — delete via flat API when project is known; else queue for wizard save.
      if (!isCreate && projectId != null) {
        try {
          await crmDelete(`/api/projects/leave-policies/${row.id}`);
        } catch (e: any) {
          notify(e?.message || "Failed to delete leave policy", "err");
          throw e;
        }
      } else {
        setRemovedLeaveIds((ids) => [...ids, row.id!]);
      }
    }
    if (isCreate) setPolicyUserEdited(true);
    setLeaveRows((rows) => rows.filter((r) => r.key !== row.key));
  };

  const addLeaveType = async (name: string): Promise<LeaveType | null> => {
    const q = name.trim();
    if (!q) {
      notify("Enter a leave name to add", "err");
      return null;
    }
    setAddingType(true);
    try {
      const res = await crmPost<LeaveType>("/api/leave-policy-types", { name: q });
      const row = res.data;
      setLeaveTypes((prev) => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)));
      return row;
    } catch (e: any) {
      notify(e?.message || "Failed to add leave type", "err");
      return null;
    } finally {
      setAddingType(false);
    }
  };

  const onOppChange = (v: string) => {
    setOppId(v);
    const opp = opps.find((o) => String(o.id) === v);
    const cid = opp?.customer_id != null ? String(opp.customer_id) : "";
    setCustomerId(cid);
    setBranchId("");
    setBranches([]);
    setErrors((e) => {
      const next = { ...e };
      delete next.opp;
      delete next.customer;
      delete next.branch;
      return next;
    });
    if (!isCreate || !v || !cid) return;

    void (async () => {
      let preferred: number | null = opp?.branch_id != null ? Number(opp.branch_id) : null;
      let branchName = opp?.branch_name ?? null;
      if (preferred == null) {
        try {
          const res = await crmGet<{ branch_id?: number | null; branch_name?: string | null }>(
            `/api/opportunities/${v}`,
          );
          const d = res.data;
          if (d?.branch_id != null) preferred = Number(d.branch_id);
          if (d?.branch_name) branchName = d.branch_name;
        } catch {
          preferred = null;
        }
      }
      await loadBranchesForCustomer(cid, preferred, { prefill: true });
      // If preferred was resolved after load with a name hint and selected, ensure prefill used name.
      if (preferred != null && branchName) {
        // loadBranchesForCustomer already prefills when preferred/single matches.
      }
    })();
  };

  const title = isCreate
    ? "New Project"
    : `Edit Project — ${name || initial?.name || ""}`;

  const header = (
    <WizardTopBar
      title={title}
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
      submitLabel={isCreate ? "Create project" : "Save changes"}
      submitBusyLabel={isCreate ? "Creating…" : "Saving…"}
    />
  );

  const onKeyDownBody = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "TEXTAREA") return;
    e.preventDefault();
    if (!isLastStep) goNext();
  };

  const renderStepBody = () => {
    switch (currentSection.key) {
      case "projectDetails":
        return (
          <div className="space-y-5">
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <WizardField
                label="Name"
                required
                error={errors.name}
                icon={<FolderKanban size={15} className="text-muted" aria-hidden />}
                filled={!!name.trim()}
              >
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
              </WizardField>
              <WizardField
                label="Status"
                icon={<CircleDot size={15} className="text-muted" aria-hidden />}
                filled={!!status}
              >
                <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
                  {PROJECT_STATUSES.map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </WizardField>
              <WizardField
                label="Opportunity"
                required
                error={errors.opp}
                icon={<Briefcase size={15} className="text-muted" aria-hidden />}
                filled={!!oppId}
              >
                <select className={inputCls} value={oppId} onChange={(e) => onOppChange(e.target.value)}>
                  <option value="">Select opportunity…</option>
                  {opps.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title}{o.customer_name ? ` — ${o.customer_name}` : ""}
                    </option>
                  ))}
                </select>
              </WizardField>
              <WizardField
                label="Customer"
                required
                error={errors.customer}
                icon="building"
                filled={!!customerId}
              >
                <select className={inputCls} value={customerId} onChange={(e) => onCustomerChange(e.target.value)}>
                  <option value="">Select customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </WizardField>
              <WizardField
                label="Branch"
                required={branchRequired}
                error={errors.branch}
                icon={<GitBranch size={15} className="text-muted" aria-hidden />}
                filled={!!branchId}
              >
                <SearchableSelect
                  value={branchId}
                  options={branchOptions}
                  onChange={onBranchChange}
                  disabled={!customerId || branchesLoading}
                  placeholder={
                    !customerId
                      ? "Select a customer first"
                      : branchesLoading
                        ? "Loading branches…"
                        : branches.length === 0
                          ? "No branches for this customer"
                          : "Select branch…"
                  }
                  err={errors.branch}
                />
              </WizardField>
            </div>
          </div>
        );
      case "leavePolicy":
        return (
          <div className="space-y-8">
            {!isCreate && (
              <WizardField
                label="Branch"
                required={branchRequired}
                error={errors.branch}
                icon={<GitBranch size={15} className="text-muted" aria-hidden />}
                filled={!!branchId}
              >
                <SearchableSelect
                  value={branchId}
                  options={branchOptions}
                  onChange={onBranchChange}
                  disabled={!customerId || branchesLoading}
                  placeholder={
                    !customerId
                      ? "Select a customer first"
                      : branchesLoading
                        ? "Loading branches…"
                        : branches.length === 0
                          ? "No branches for this customer"
                          : "Select branch…"
                  }
                  err={errors.branch}
                />
              </WizardField>
            )}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-primary">Leave &amp; Holiday Billing</h3>
              <LeaveHolidayBillingSection
                pol={pol}
                setP={setP}
                errors={errors}
                identity={isCreate ? undefined : {
                  name, setName, status, setStatus,
                }}
              />
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-primary">Leave Billing Policy</h3>
              <LeaveBillingPolicySection
                leaveRows={leaveRows}
                leaveTypes={leaveTypes}
                errors={errors}
                addingType={addingType}
                onSaveRow={(row) => saveLeaveRow(row)}
                onDeleteRow={(row) => deleteLeaveRow(row)}
                onAddType={addLeaveType}
              />
            </div>
          </div>
        );
      case "billingProps":
        return <BillingPropertiesSection pol={pol} setP={setP} errors={errors} />;
      default:
        return null;
    }
  };

  return (
    <WizardShell
      onClose={onClose}
      topBar={header}
      footer={footer}
      steps={wizardSteps}
      currentIndex={clampedStep}
      maxReached={maxReached}
      onSelectStep={goToStep}
      stepProgressPct={stepCompletePct}
      ariaLabel={isCreate ? "New project wizard steps" : "Edit project wizard steps"}
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
      {branchReloadConfirm && (
        <ConfirmModal
          title="Reload branch policies?"
          message={`Reload policies from ${branchReloadConfirm.branchName}?`}
          confirmLabel="Reload"
          onClose={() => setBranchReloadConfirm(null)}
          onConfirm={() => {
            applyBranchPolicy(branchReloadConfirm.branchId, branchReloadConfirm.payload);
            setBranchReloadConfirm(null);
          }}
        />
      )}
    </WizardShell>
  );
}

/** Edit Project — Leave & Holiday Billing Policy + Billing Properties. */
export function EditProjectWizard({
  initial,
  onClose,
  onSaved,
  notify,
}: {
  initial: ProjectWizardInitial;
  onClose: () => void;
  onSaved: () => void;
  notify: Notify;
}) {
  return (
    <ProjectWizard
      mode="edit"
      initial={initial}
      onClose={onClose}
      onSaved={() => onSaved()}
      notify={notify}
    />
  );
}

/** New Project — Project Details + same merged policy sections as Edit. */
export function CreateProjectWizard({
  opps,
  customers,
  onClose,
  onSaved,
  notify,
}: {
  opps: OppOption[];
  customers: CustomerOption[];
  onClose: () => void;
  onSaved: (project: { id: number }) => void;
  notify: Notify;
}) {
  return (
    <ProjectWizard
      mode="create"
      opps={opps}
      customers={customers}
      onClose={onClose}
      onSaved={(p) => { if (p) onSaved(p); }}
      notify={notify}
    />
  );
}
