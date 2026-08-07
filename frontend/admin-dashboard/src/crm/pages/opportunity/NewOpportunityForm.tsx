/**
 * Full-screen, guided, type-driven New Opportunity form (Parts 1–5).
 * ONE schema drives it (opportunitySchema) via <SectionFields>; per-type state is
 * preserved by opportunityFormState. Autosave is gated behind `isLoaded`.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Plus, Trash2, Upload } from "lucide-react";
import { crmGet, crmPost, crmPut, crmUpload } from "../../api";
import { motion as motionTok } from "../../../design-system/tokens/tokens";
import { Modal, btnSecondary, ErrorBox, inputCls, useToast, ConfirmModal } from "../../components/ui";
import {
  OPPORTUNITY_SCHEMA, OPPORTUNITY_TYPES, sectionVisible, fieldVisible, fieldMatchesShowWhen,
  STRICT_SEQUENTIAL_MODE, SALES_STAGE_OPTIONS, ONBOARDING_STATUS_OPTIONS,
  SALES_ONBOARDING_STATUS_VALUES,
  ROLE_OPTIONS, WORK_LOCATION_OPTIONS, BILLING_TYPE_OPTIONS, APPRAISAL_CYCLE_OPTIONS,
  WFO_REMOTE_OPTIONS, LEAVE_POLICY_OPTIONS,
  customerTypeOptionsForPo, normalizeCustomerType,
  type OpportunityType, type FieldDef,
} from "./opportunitySchema";
import {
  emptyState, switchType, setDetail, isCoreKey, buildSubmitPayload,
  hydrateFromServer, fieldsAtRiskOnSwitch, activeDetails,
  applyBranchContactDetails, sharedDetailsForDraft,
  type OpportunityFormState,
} from "./opportunityFormState";
import { SectionFields, type OptionsMap } from "./FormRenderer";
import { SearchableSelect } from "../../components/SearchableSelect";
import { fetchAllMaster } from "../../lib/fetchAllMaster";
import { CONTACT_ROLES } from "../../constants/geo";
import { CustomerFormModal, type Customer } from "../Customers";
import { branchContactAutofill, emailFromContact, phoneFromContact, splitBranchContacts } from "../../lib/contactPhone";
import { useHasRole } from "../../CrmApp";
import {
  calculateBillingBases,
  calculateRfiValue,
  recalculateCtcSlab,
  resolveRfiPeriodMonths,
  validateCtcExperience,
  type BillingInputs,
} from "./ctcSlab";
import {
  WizardTopBar,
  WizardStepper,
  WizardStepHeader,
  WizardStepProgress,
  WizardFooter,
  WizardFieldSkeleton,
  sectionHelper,
  WizardAurora,
  type AutosaveState,
  type WizardStep,
} from "../../components/WizardChrome";

type Opt = { value: string; label: string };
type EngineerRow = {
  id: string;
  name: string;
  role_title?: string | null;
};
type PendingAttachment = { key: string; file: File | null; file_name: string; kind: "customer_jd" | "general" };
const DRAFT_KEY = "kx.opp.draft";
const uid = () => Math.random().toString(36).slice(2, 11);

const thCls =
  "whitespace-nowrap px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-muted";
const tdCls = "px-3 py-2 align-top";
const tableWrap = "overflow-x-auto rounded-control border border-subtle";
const tableHead = "bg-surface-2";
const tableRow = "border-t border-subtle";

/** Branch effective-policy billing_type enum → opportunity schema value
 * (BILLING_TYPE_OPTIONS / ctcSlab.ts use the spaced "Per X" strings).
 * Unknown / null values leave the field untouched. */
const POLICY_BILLING_TYPE_MAP: Record<string, string> = {
  Per_Hour: "Per Hour",
  Per_Day: "Per Day",
  Per_Month: "Per Month",
  Per_Year: "Per Year",
};

const CTC_TRIGGER_KEYS = new Set([
  "billing_type", "hours_per_day", "project_duration_months",
  "tm_duration_months", "tm_positions_count",
  "holidays", "weekoff", "leave",
  "holidays_billable", "weekoff_billable", "leave_billable",
]);

/** Build the single input shape consumed by all CTC/base recalculation triggers. */
function ctcBillingInputs(
  opportunityType: OpportunityType | "",
  details: Record<string, unknown>,
): BillingInputs {
  const isTm = opportunityType === "T&M";
  return {
    opportunityType,
    projectDurationMonths: details.project_duration_months,
    // Hidden T&M inputs are intentionally ignored for every non-T&M branch.
    billingType: isTm ? details.billing_type : undefined,
    hoursPerDay: isTm ? details.hours_per_day : undefined,
    holidays: isTm ? details.holidays : undefined,
    weekoff: isTm ? details.weekoff : undefined,
    leave: isTm ? details.leave : undefined,
    holidaysBillable: isTm ? details.holidays_billable : undefined,
    weekoffBillable: isTm ? details.weekoff_billable : undefined,
    leaveBillable: isTm ? details.leave_billable : undefined,
    // Branch Billing Properties cap (Max Billable Hours / Month) — inherited
    // from the effective-policy fetch; caps annual billing hours at cap × 12.
    maxBillableHoursMonth: isTm ? details.max_billable_hours_month : undefined,
  };
}

/** Recalculate every type through one path; T&M alone receives billing bases.
 *  Also derives RFI Value when Annual Revenue × Period × Positions are all set.
 */
function recalculateOpportunityState(state: OpportunityFormState): OpportunityFormState {
  const current = { ...(state.detailsByType[state.activeType as OpportunityType] || {}) };
  let details: Record<string, unknown> = current;
  let detailsByType = state.detailsByType;
  if (state.activeType === "T&M") {
    details = {
      ...current,
      hours_per_day: current.hours_per_day === undefined ? 8 : current.hours_per_day,
      // Holidays & Leave stay at 0 until a branch-linked leave policy prefills
      // them (or the user types values) — never invent 10 / 24. Weekoff is NOT
      // policy-driven: it's the fixed number of weekend days in a year
      // (52 weekends × 2 = 104), so it always calculates to 104.
      holidays: current.holidays === undefined || current.holidays === "" ? 0 : current.holidays,
      weekoff: current.weekoff === undefined || current.weekoff === "" ? 104 : current.weekoff,
      leave: current.leave === undefined || current.leave === "" ? 0 : current.leave,
      holidays_billable: current.holidays_billable === undefined ? false : current.holidays_billable,
      weekoff_billable: current.weekoff_billable === undefined ? false : current.weekoff_billable,
      leave_billable: current.leave_billable === undefined ? false : current.leave_billable,
    };
    const bases = calculateBillingBases(ctcBillingInputs(state.activeType, details));
    details.actual_billing_days = bases.actualBillingDays;
    details.actual_billing_hours = bases.actualBillingHours;
    detailsByType = { ...state.detailsByType, "T&M": details };
  }
  const inputs = ctcBillingInputs(state.activeType, details);
  const ctcSlab = recalculateCtcSlab(state.ctcSlab, inputs);
  const period = resolveRfiPeriodMonths(state.activeType, details);
  const rfi = calculateRfiValue({
    revenueAnnual: ctcSlab[0]?.revenue_annual,
    periodMonths: period,
    positionsCount: details.tm_positions_count,
  });
  const core = rfi === null
    ? state.core
    : { ...state.core, rfi_value: rfi };
  return {
    ...state,
    core,
    detailsByType,
    ctcSlab,
  };
}

export function NewOpportunityForm({
  onClose,
  onCreated,
  opportunityId,
  approvalMode = false,
}: {
  onClose: () => void;
  onCreated?: () => void;
  /** When set, load + PUT this opportunity (same wizard chrome as create). */
  opportunityId?: number;
  /** Sales Head reviewing before sign-off: saves any edits, then approves in the
   * same action, so a correction can never be left un-approved by accident. */
  approvalMode?: boolean;
}) {
  const reduce = useReducedMotion();
  const [toast, notify] = useToast();
  const isSales = useHasRole("Sales", "Sales_Head");
  // A plain Sales person — Sales_Head and Admin keep the full status list, since
  // they oversee the whole pipeline rather than just opening it.
  const isSalesOnly = useHasRole("Sales") && !useHasRole("Sales_Head");
  const isEdit = opportunityId != null;
  const [state, setState] = useState<OpportunityFormState>(() => emptyState());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stepIndex, setStepIndex] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [stepDir, setStepDir] = useState<1 | -1>(1);
  const [nextField, setNextField] = useState<string | undefined>("customer_id");
  const [addCustomer, setAddCustomer] = useState(false);
  // "+" on Contact Person / Hiring Manager → create a new contact for the
  // selected customer & branch, then select it. null = closed.
  const [newContactFor, setNewContactFor] = useState<"contact" | "hiringManager" | null>(null);
  const [flash, setFlash] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [customRoles, setCustomRoles] = useState<Opt[]>([]);
  // Branch id whose effective billing policy was last prefilled (drives the note).
  const [policyBranchId, setPolicyBranchId] = useState("");
  // Whether that branch's effective policy actually defines a leave allotment.
  const [branchHasLeavePolicy, setBranchHasLeavePolicy] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveState>("idle");
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [editOppLabel, setEditOppLabel] = useState("");
  const confirmCloseRef = useRef(false);
  const [, setTick] = useState(0);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const bodyRef = useRef<HTMLDivElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);

  // Option sources
  const [customers, setCustomers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [skills, setSkills] = useState<any[]>([]);
  const [engineers, setEngineers] = useState<EngineerRow[]>([]);

  const type = state.activeType;
  const details = activeDetails(state);
  const selectedCustomer = useMemo(
    () => customers.find((c) => String(c.id) === String(state.core.customer_id)),
    [customers, state.core.customer_id],
  );
  const customerHasPo = !!selectedCustomer?.has_po;

  // Backfill Customer Type when it's empty (e.g. imported/hydrated
  // opportunities): the field is locked while the customer has no PO, so the
  // user cannot fill it themselves — derive it exactly like customer selection
  // does (NN without a PO; EN/EE from the customer record otherwise).
  useEffect(() => {
    if (!selectedCustomer) return;
    setState((s) => {
      const cur = String(activeDetails(s).customer_type || "");
      if (!customerHasPo) {
        return cur === "NN" ? s : setDetail(s, "customer_type", "NN");
      }
      if (cur === "EN" || cur === "EE") return s;
      return setDetail(s, "customer_type", normalizeCustomerType(true, selectedCustomer.customer_type));
    });
  }, [selectedCustomer, customerHasPo]);

  // ---- initial load (restore draft OR hydrate edit). Sets isLoaded LAST. ----
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [c, s] = await Promise.all([
          crmGet<any[]>("/api/customers?limit=100"),
          // Page through — the server clamps limit to 100, which truncated the list.
          fetchAllMaster<any>("/api/skills", { is_active: true }),
        ]);
        if (!alive) return;
        setCustomers(c.data || []);
        setSkills(s);

        if (opportunityId != null) {
          const oppRes = await crmGet<Record<string, any>>(`/api/opportunities/${opportunityId}`);
          if (!alive) return;
          const data = oppRes.data || {};
          setEditOppLabel(data.opp_id ? String(data.opp_id) : `#${opportunityId}`);
          const hydrated = hydrateFromServer(data);
          setState(recalculateOpportunityState(hydrated));
          // Unlock every step so editors can jump freely.
          setMaxReached(OPPORTUNITY_SCHEMA.length);
          return;
        }

        // ALWAYS start a fresh, blank form on create (per product decision:
        // stale previous-session values must never appear). Any old autosaved
        // draft is discarded here so it can't leak into the new session.
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch { /* ignore */ }
        if (alive) setState(recalculateOpportunityState({ ...emptyState(), isLoaded: true }));
      } catch (e: any) {
        if (alive) setError(e?.message || "Failed to load form data");
        // Still mark loaded on create so the empty form is usable after a soft failure.
        if (alive && opportunityId == null) {
          setState((s) => ({ ...s, isLoaded: true }));
        }
      }
    })();
    return () => { alive = false; };
  }, [opportunityId]);

  // Dependent dropdowns when the customer or branch changes.
  const customerId = state.core.customer_id;
  const branchId = state.core.branch_id;
  useEffect(() => {
    if (!customerId) { setBranches([]); setContacts([]); return; }
    let alive = true;
    (async () => {
      try {
        const [b, ct] = await Promise.all([
          crmGet<any[]>(`/api/customers/${customerId}/branches`),
          crmGet<any[]>(`/api/customers/${customerId}/contacts${branchId ? `?branch_id=${branchId}` : ""}`),
        ]);
        if (!alive) return;
        setBranches(b.data || []);
        setContacts(ct.data || []);
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [customerId, branchId]);

  // Engineers for Replacement Position Type — only project-employees on the
  // selected customer's projects (active, not exited). Empty until a customer
  // is chosen (field shows dependsOn hint).
  useEffect(() => {
    let alive = true;
    if (!customerId) {
      setEngineers([]);
      return;
    }
    (async () => {
      try {
        const pe = await crmGet<any[]>(
          `/api/projects/all-employees?customer_id=${customerId}&status=active&limit=500`,
        );
        if (!alive) return;
        const byEmp = new Map<string, EngineerRow>();
        for (const r of pe.data || []) {
          const id = String(r.employee_id ?? "");
          if (!id || byEmp.has(id)) continue;
          byEmp.set(id, {
            id,
            name: String(r.employee_name || `Employee #${id}`),
            role_title: r.role_title || null,
          });
        }
        setEngineers(Array.from(byEmp.values()));
      } catch {
        if (alive) setEngineers([]);
      }
    })();
    return () => { alive = false; };
  }, [customerId]);

  const branchContacts = useMemo(() => {
    if (!branchId) return [];
    return contacts.filter((c) => String(c.branch_id) === String(branchId));
  }, [contacts, branchId]);

  const { contactPersons, hiringManagers } = useMemo(
    () => splitBranchContacts(branchContacts),
    [branchContacts],
  );

  // When branch contacts load: auto-pick sole CP/HM and fill email + phone.
  useEffect(() => {
    if (!branchId || !contacts.length) return;
    const forBranch = contacts.filter((c) => String(c.branch_id) === String(branchId));
    if (!forBranch.length) return;
    setState((s) => {
      if (String(s.core.branch_id) !== String(branchId)) return s;
      return applyBranchContactDetails(
        s,
        branchContactAutofill(forBranch, {
          contact_person_id: String(s.core.contact_person_id || ""),
          hiring_manager_id: String(s.core.hiring_manager_id || ""),
        }),
      );
    });
  }, [branchId, contacts]);

  // Branch billing-policy inheritance (same effect family as contact autofill):
  // when a branch is selected, fetch its EFFECTIVE policy (branch → customer →
  // default) once and prefill the T&M billing fields. Prefill OVERWRITES on
  // branch change — like contact autofill — but every field stays editable.
  // Skipped in edit mode so loaded opportunity details are not clobbered.
  // The five keys are T&M-only detail fields, so they are written into the
  // "T&M" bucket (identical to setDetail when T&M is active, and preserved for
  // when the user picks T&M later). Batch recalc runs once at the end, exactly
  // like the init / switchType paths.
  useEffect(() => {
    if (isEdit) return;
    if (!branchId) {
      setPolicyBranchId("");
      setBranchHasLeavePolicy(false);
      setState((s) => {
        const tm = { ...(s.detailsByType["T&M"] || {}) };
        let changed = false;
        // Holidays & Leave reset to 0 (policy-driven); Weekoff stays the
        // standard 104 (weekends) since it isn't tied to any leave policy.
        for (const key of ["holidays", "leave"] as const) {
          if (tm[key] !== 0) {
            tm[key] = 0;
            changed = true;
          }
        }
        if (tm.weekoff !== 104) {
          tm.weekoff = 104;
          changed = true;
        }
        for (const key of ["credit_leave_monthly", "leave_policy"] as const) {
          if (tm[key] !== undefined && tm[key] !== "") {
            tm[key] = "";
            changed = true;
          }
        }
        if (!changed) return s;
        return recalculateOpportunityState({
          ...s,
          detailsByType: { ...s.detailsByType, "T&M": tm },
        });
      });
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await crmGet<any>(`/api/customers/branches/${branchId}/effective-policy`);
        if (!alive) return;
        const p = res.data;
        if (!p) return;
        // Prefill Holidays/Leave ONLY when a leave policy row is linked to
        // THIS branch (has_branch_leave_policy). Customer-wide / global counts
        // must not invent 10/104/24. Weekoff has no branch column → 0 unless
        // a future weekoff_count is sent.
        const linked = p.has_branch_leave_policy === true;
        setBranchHasLeavePolicy(linked);
        setState((s) => {
          if (String(s.core.branch_id) !== String(branchId)) return s;
          let next = s;
          const setTmDetail = (key: string, value: unknown) => {
            next = {
              ...next,
              detailsByType: {
                ...next.detailsByType,
                "T&M": { ...(next.detailsByType["T&M"] || {}), [key]: value },
              },
            };
          };
          if (typeof p.holidays_billable === "boolean") setTmDetail("holidays_billable", p.holidays_billable);
          if (typeof p.weekoff_billable === "boolean") setTmDetail("weekoff_billable", p.weekoff_billable);
          if (typeof p.leave_billable === "boolean") setTmDetail("leave_billable", p.leave_billable);
          if (p.working_hours_per_day != null && Number.isFinite(Number(p.working_hours_per_day))) {
            setTmDetail("hours_per_day", Number(p.working_hours_per_day));
          }
          // Max Billable Hours / Month (branch Billing Properties) — caps the
          // CTC slab's annual billing hours at cap × 12 in calculateBillingBases.
          if (p.max_billable_hours_month != null && Number.isFinite(Number(p.max_billable_hours_month))) {
            setTmDetail("max_billable_hours_month", Number(p.max_billable_hours_month));
          }
          const mappedBillingType = POLICY_BILLING_TYPE_MAP[String(p.billing_type || "")];
          if (mappedBillingType) setTmDetail("billing_type", mappedBillingType);
          // HOLIDAYS come from THIS branch's own holiday calendar
          // (branch_holidays_count) — independent of any leave policy. A branch
          // with a configured calendar (e.g. HARMAN - Bangalore) shows its count
          // even when no branch leave policy is linked. 0 when the branch has
          // no calendar of its own.
          const branchHolidays = p.branch_holidays_count;
          setTmDetail(
            "holidays",
            branchHolidays != null && Number.isFinite(Number(branchHolidays))
              ? Number(branchHolidays)
              : 0,
          );
          // WEEKOFF is not policy-driven — always the standard 104 (52 weekends),
          // unless a future branch weekoff_count is sent.
          setTmDetail(
            "weekoff",
            p.weekoff_count != null && Number.isFinite(Number(p.weekoff_count))
              ? Number(p.weekoff_count)
              : 104,
          );
          // LEAVE prefills ONLY when a leave policy row is linked to THIS branch.
          if (linked) {
            const leaveTotal = p.branch_leave_total ?? p.leave_total;
            setTmDetail(
              "leave",
              leaveTotal != null && Number.isFinite(Number(leaveTotal))
                ? Number(leaveTotal)
                : 0,
            );
            if (p.credit_leave_monthly != null && Number.isFinite(Number(p.credit_leave_monthly))) {
              setTmDetail("credit_leave_monthly", Number(p.credit_leave_monthly));
            } else {
              setTmDetail("credit_leave_monthly", "");
            }
            if (p.leave_policy_name != null && String(p.leave_policy_name)) {
              const name = String(p.leave_policy_name);
              if (LEAVE_POLICY_OPTIONS.some((o) => o.value === name)) {
                setTmDetail("leave_policy", name);
              }
            }
          } else {
            setTmDetail("leave", 0);
            setTmDetail("credit_leave_monthly", "");
            setTmDetail("leave_policy", "");
          }
          return recalculateOpportunityState(next);
        });
        setPolicyBranchId(String(branchId));
      } catch { /* non-fatal — leave the billing fields as-is */ }
    })();
    return () => { alive = false; };
  }, [branchId, isEdit]);

  // Keep emails + phones in sync with the selected Contact Person / Hiring Manager.
  // Runs when the id changes or when contacts finish loading after an id was chosen.
  useEffect(() => {
    const cpId = String(state.core.contact_person_id || "");
    const hmId = String(state.core.hiring_manager_id || "");
    if (!contacts.length || (!cpId && !hmId)) return;

    setState((s) => {
      let next = s;
      let changed = false;
      const details = activeDetails(s);

      if (cpId) {
        const ct = contacts.find((c) => String(c.id) === cpId);
        if (ct) {
          const email = emailFromContact(ct);
          const phone = phoneFromContact(ct);
          if (email !== String(details.contact_email || "")) {
            next = setDetail(next, "contact_email", email);
            changed = true;
          }
          if (phone !== String(details.contact_phone || "")) {
            next = setDetail(next, "contact_phone", phone);
            changed = true;
          }
        }
      }

      if (hmId) {
        const hm = contacts.find((c) => String(c.id) === hmId);
        if (hm) {
          const email = emailFromContact(hm);
          const phone = phoneFromContact(hm);
          if (email !== String(details.hiring_manager_email || "")) {
            next = setDetail(next, "hiring_manager_email", email);
            changed = true;
          }
          if (phone !== String(details.hiring_manager_contact || "")) {
            next = setDetail(next, "hiring_manager_contact", phone);
            changed = true;
          }
        }
      }

      return changed ? next : s;
    });
  }, [contacts, state.core.contact_person_id, state.core.hiring_manager_id]);

  // ---- autosave draft — GATED behind isLoaded (never overwrite with empties) ----
  // Edit mode never touches the create draft key.
  useEffect(() => {
    if (!state.isLoaded || isEdit) return;
    setAutosaveStatus("saving");
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(serializeForDraft(state)));
        setDraftSavedAt(Date.now());
        setAutosaveStatus("saved");
      } catch {
        setAutosaveStatus("error");
      }
    }, 800);
    return () => window.clearTimeout(t);
  }, [state, isEdit]);

  // Keep relative "just now" label fresh while the modal is open.
  useEffect(() => {
    if (autosaveStatus !== "saved" || !draftSavedAt) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 10_000);
    return () => window.clearInterval(id);
  }, [autosaveStatus, draftSavedAt]);

  // Stage default: Sales Validation for Sales roles; Sales Verify otherwise.
  useEffect(() => {
    if (!state.isLoaded) return;
    setState((s) => {
      const cur = String(activeDetails(s).sales_stage || "");
      const allowed = isSales
        ? SALES_STAGE_OPTIONS
        : SALES_STAGE_OPTIONS.filter((o) => o.value !== "Sales Validation");
      if (cur && allowed.some((o) => o.value === cur)) return s;
      return setDetail(s, "sales_stage", isSales ? "Sales Validation" : "Sales Verify");
    });
  }, [state.isLoaded, isSales]);

  const options: OptionsMap = useMemo(() => ({
    customers: customers.map((c) => ({ value: String(c.id), label: c.name })),
    branches: branches.map((b) => ({ value: String(b.id), label: b.branch_name })),
    contacts: contactPersons.map((c) => ({ value: String(c.id), label: c.name || "" })),
    hiringManagers: hiringManagers.length
      ? hiringManagers.map((c) => ({ value: String(c.id), label: c.name || "" }))
      : [],
    skills: skills.map((s) => ({ value: String(s.id), label: s.name })),
    customerTypes: customerTypeOptionsForPo(customerHasPo),
    salesStages: isSales
      ? SALES_STAGE_OPTIONS
      : SALES_STAGE_OPTIONS.filter((o) => o.value !== "Sales Validation"),
    // Sales only drives the opening stages; TA/RMG move it on from there.
    onboardingStatus: isSalesOnly
      ? ONBOARDING_STATUS_OPTIONS.filter((o) => SALES_ONBOARDING_STATUS_VALUES.includes(o.value))
      : ONBOARDING_STATUS_OPTIONS,
    leavePolicy: LEAVE_POLICY_OPTIONS,
    billingType: BILLING_TYPE_OPTIONS,
    positionType: [],
    role: [...ROLE_OPTIONS, ...customRoles.filter((r) => !ROLE_OPTIONS.some((o) => o.value === r.value))],
    workLocation: WORK_LOCATION_OPTIONS,
    wfoRemote: WFO_REMOTE_OPTIONS,
    appraisalCycle: APPRAISAL_CYCLE_OPTIONS,
    engineers: engineers.map((e) => ({ value: e.id, label: e.name })),
  }), [customers, branches, contactPersons, hiringManagers, skills, customerHasPo, customRoles, isSales, engineers]);

  // ---- change handlers -----------------------------------------------------
  const setCore = (key: string, value: unknown) =>
    setState((s) => ({ ...s, core: { ...s.core, [key]: value } }));

  const onChange = (f: FieldDef, value: unknown) => {
    // Contact Person / Hiring Manager: set id + email + phone in one update.
    if (f.key === "contact_person_id") {
      const ct = contacts.find((c) => String(c.id) === String(value))
        || contactPersons.find((c) => String(c.id) === String(value));
      setState((s) => {
        let next: OpportunityFormState = {
          ...s,
          core: { ...s.core, contact_person_id: value },
        };
        next = setDetail(next, "contact_email", emailFromContact(ct));
        next = setDetail(next, "contact_phone", phoneFromContact(ct));
        return next;
      });
      if (f.next) setNextField(f.next);
      return;
    }
    // Opportunity Title → auto-fill T&M Position Title. Tracks the title while
    // Position Title is empty or still mirrors it; a manual edit breaks the
    // link so the user's own value is never overwritten. Written straight into
    // the T&M bucket (not the active type) so it works even before the
    // opportunity type is selected.
    if (f.key === "title") {
      const newTitle = String(value ?? "");
      setState((s) => {
        const tm = { ...(s.detailsByType["T&M"] || {}) };
        const currentPos = String(tm.tm_position_title ?? "");
        const prevTitle = String(s.core.title ?? "");
        if (!currentPos.trim() || currentPos === prevTitle) {
          tm.tm_position_title = newTitle;
        }
        return {
          ...s,
          core: { ...s.core, title: value },
          detailsByType: { ...s.detailsByType, "T&M": tm },
        };
      });
      if (f.next) setNextField(f.next);
      return;
    }

    if (f.key === "hiring_manager_id") {
      const hm = contacts.find((c) => String(c.id) === String(value))
        || hiringManagers.find((c) => String(c.id) === String(value));
      setState((s) => {
        let next: OpportunityFormState = {
          ...s,
          core: { ...s.core, hiring_manager_id: value },
        };
        next = setDetail(next, "hiring_manager_email", emailFromContact(hm));
        next = setDetail(next, "hiring_manager_contact", phoneFromContact(hm));
        return next;
      });
      if (f.next) setNextField(f.next);
      return;
    }

    if (isCoreKey(f.key)) {
      setCore(f.key, value);
      if (f.key === "customer_id") {
        const cust = customers.find((c) => String(c.id) === String(value));
        setState((s) => {
          let next: OpportunityFormState = {
            ...s,
            core: {
              ...s.core,
              customer_id: value,
              branch_id: "",
              contact_person_id: "",
              hiring_manager_id: "",
            },
          };
          next = setDetail(next, "contact_email", "");
          next = setDetail(next, "contact_phone", "");
          next = setDetail(next, "hiring_manager_email", "");
          next = setDetail(next, "hiring_manager_contact", "");
          next = setDetail(next, "tm_replacement_engineer", "");
          return next;
        });
        if (cust) {
          const ct = normalizeCustomerType(!!cust.has_po, cust.customer_type);
          setState((s) => setDetail(s, "customer_type", ct));
        }
      }
      if (f.key === "branch_id") {
        setState((s) => {
          let next: OpportunityFormState = {
            ...s,
            core: {
              ...s.core,
              branch_id: value,
              contact_person_id: "",
              hiring_manager_id: "",
            },
          };
          next = setDetail(next, "contact_email", "");
          next = setDetail(next, "contact_phone", "");
          next = setDetail(next, "hiring_manager_email", "");
          next = setDetail(next, "hiring_manager_contact", "");
          return next;
        });
      }
      if (f.key === "opp_type" && value) onSwitchType(value as OpportunityType);
    } else {
      if (f.key === "customer_type" && !customerHasPo) return;
      // Position Type: clear Replacement Engineer when switching away from Replacement.
      if (f.key === "tm_position_type") {
        setState((s) => {
          let next = setDetail(s, f.key, value);
          if (String(value) !== "Replacement") {
            next = setDetail(next, "tm_replacement_engineer", "");
          }
          return next;
        });
        if (f.next) setNextField(f.next);
        return;
      }
      // Replacement Engineer → auto-fill Role from the engineer's role/designation.
      if (f.key === "tm_replacement_engineer") {
        const eng = engineers.find((e) => e.id === String(value));
        const role = String(eng?.role_title || "").trim();
        setState((s) => {
          let next = setDetail(s, f.key, value);
          if (role) next = setDetail(next, "tm_role", role);
          return next;
        });
        if (role) {
          const known = [...ROLE_OPTIONS, ...customRoles]
            .some((r) => r.value.toLowerCase() === role.toLowerCase());
          if (!known) setCustomRoles((prev) => [...prev, { value: role, label: role }]);
        }
        if (f.next) setNextField(f.next);
        return;
      }
      // Customer JD: store file names in details; queue files for upload on submit.
      if (f.type === "file" && f.key === "tm_jd_attachments") {
        const files = Array.isArray(value) ? (value as File[]) : [];
        const names = files.map((file) => file.name).join(", ");
        setState((s) => setDetail(s, "tm_jd_attachments", names));
        setAttachments((prev) => {
          const kept = prev.filter((a) => !String(a.key).startsWith("jd-"));
          const jdRows = files.map((file) => ({
            key: `jd-${uid()}`,
            file,
            file_name: file.name,
            kind: "customer_jd" as const,
          }));
          return [...kept, ...jdRows];
        });
        if (f.next) setNextField(f.next);
        return;
      }
      setState((s) => {
        let next = setDetail(s, f.key, value);
        if (CTC_TRIGGER_KEYS.has(f.key)) next = recalculateOpportunityState(next);
        return next;
      });
    }
  };

  const validateField = (f: FieldDef): string => {
    const v = isCoreKey(f.key) ? state.core[f.key] : details[f.key];
    if (f.required && (v === "" || v === null || v === undefined)) return `${f.label} is required`;
    if (f.type === "email" && v && !/^\S+@\S+\.\S+$/.test(String(v))) return "Enter a valid email";
    if ((f.type === "number" || f.type === "currency" || f.type === "percent")
      && v !== "" && v !== null && v !== undefined) {
      const n = Number(v);
      if (!Number.isFinite(n)) return `${f.label} must be a number`;
      if (f.min != null && n < f.min) return `${f.label} must be ≥ ${f.min}`;
      if (f.max != null && n > f.max) return `${f.label} must be ≤ ${f.max}`;
    }
    return "";
  };

  const onBlur = (f: FieldDef) => {
    const msg = validateField(f);
    setErrors((e) => ({ ...e, [f.key]: msg }));
    if (!msg && f.next) {
      setNextField(f.next);
      if (!reduce && !STRICT_SEQUENTIAL_MODE) {
        // FOCUS-STEAL GUARD: when the user clicks/tabs into ANOTHER field
        // (possibly in a different section), blur fires here first and this
        // auto-advance used to yank focus back to this section's next field.
        // Defer one tick and only pull focus if it didn't land on any other
        // interactive element — i.e. auto-advance only when nothing else was
        // chosen by the user.
        window.setTimeout(() => {
          const el = fieldRefs.current[f.next!];
          const activeEl = document.activeElement as HTMLElement | null;
          const userChoseElsewhere =
            !!activeEl &&
            activeEl !== document.body &&
            (activeEl.matches?.("input, select, textarea, button, a[href], [tabindex]") ?? false);
          if (el && !userChoseElsewhere && document.activeElement !== el) el.focus?.();
        }, 0);
      }
    }
  };

  const onSwitchType = (next: OpportunityType) => {
    if (type && type !== next) {
      const risky = fieldsAtRiskOnSwitch(state, type);
      // values are PRESERVED per type (not wiped) — no destructive confirm needed.
      void risky;
    }
    setState((s) => recalculateOpportunityState(switchType(s, next)));
  };

  // ---- inline customer creation (Part 4) -----------------------------------
  const onCustomerCreated = (c: Customer) => {
    // The opportunity form is NOT remounted, so all in-progress data survives.
    setCustomers((prev) => [c, ...prev.filter((x) => String(x.id) !== String(c.id))]);
    setState((s) => {
      const withSel = { ...s, core: { ...s.core, customer_id: String(c.id), branch_id: "", contact_person_id: "", hiring_manager_id: "" } };
      const ct = normalizeCustomerType(!!(c as any).has_po, (c as any).customer_type);
      return setDetail(withSel, "customer_type", ct);
    });
    setAddCustomer(false);
    setFlash(["customer_id", "customer_type"]);
    window.setTimeout(() => setFlash([]), 1600);
    notify(`Customer "${c.name}" created and selected`);
  };

  // ---- wizard section nav --------------------------------------------------
  // Skill Evaluation Details is RMG/Admin/CEO territory — Sales & Sales Head never
  // see it in the wizard; RMG adds it on the approval screen after submission.
  const visibleSections = OPPORTUNITY_SCHEMA.filter(
    (s) => sectionVisible(s, type) && !(s.key === "skillEval" && isSales),
  );
  const totalSteps = visibleSections.length;
  const clampedStep = Math.min(Math.max(stepIndex, 0), Math.max(totalSteps - 1, 0));
  const currentSection = visibleSections[clampedStep];
  const isFirstStep = clampedStep <= 0;
  const isLastStep = clampedStep >= totalSteps - 1 && totalSteps > 0;

  // Type switches change the visible section list — keep the index in range.
  useEffect(() => {
    setStepIndex((i) => Math.min(i, Math.max(totalSteps - 1, 0)));
    setMaxReached((m) => Math.min(m, Math.max(totalSteps - 1, 0)));
  }, [totalSteps, type]);

  // Scroll panel to top whenever the step changes.
  useEffect(() => {
    bodyRef.current?.scrollTo?.({ top: 0, behavior: reduce ? "auto" : "smooth" });
    const panel = bodyRef.current?.closest?.("[data-modal-body]") || bodyRef.current?.parentElement;
    panel?.scrollTo?.({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }, [clampedStep, reduce]);

  const sectionStatus = (secKey: string): "empty" | "partial" | "complete" | "error" => {
    const sec = OPPORTUNITY_SCHEMA.find((s) => s.key === secKey);
    if (!sec) return "empty";
    if (!sec.fields?.length) {
      // Table / attachments / activity steps have no required field list — treat as complete when visited.
      if (sec.kind === "table" || sec.kind === "attachments" || sec.kind === "activityLog") return "complete";
      return "empty";
    }
    const reqd = sec.fields.filter(
      (f) => f.required && fieldVisible(sec, f, type) && fieldMatchesShowWhen(f, state.core, details),
    );
    if (reqd.some((f) => errors[f.key])) return "error";
    if (!reqd.length) return "complete";
    const filled = reqd.filter((f) => {
      const v = isCoreKey(f.key) ? state.core[f.key] : details[f.key];
      return v !== "" && v !== null && v !== undefined;
    });
    if (filled.length === 0) return "empty";
    return filled.length === reqd.length ? "complete" : "partial";
  };

  /** Validate required fields in one section; flash + focus the first invalid field. */
  const validateSection = (secKey: string): boolean => {
    const sec = OPPORTUNITY_SCHEMA.find((s) => s.key === secKey);
    if (!sec) return true;
    const nextErrs: Record<string, string> = { ...errors };
    let firstInvalid: string | null = null;

    for (const f of sec.fields || []) {
      if (!fieldVisible(sec, f, type)) continue;
      if (!fieldMatchesShowWhen(f, state.core, details)) continue;
      if (f.type === "readonly") continue;
      const m = validateField(f);
      if (m) {
        nextErrs[f.key] = m;
        if (!firstInvalid) firstInvalid = f.key;
      } else {
        delete nextErrs[f.key];
      }
    }

    if (secKey === "ctcSlab" && type) {
      state.ctcSlab.forEach((row, index) => {
        const message = validateCtcExperience(row);
        const ek = `ctcSlab.${index}.experience`;
        if (message) {
          nextErrs[ek] = message;
          if (!firstInvalid) firstInvalid = ek;
        } else {
          delete nextErrs[ek];
        }
      });
    }

    setErrors(nextErrs);
    if (firstInvalid) {
      setFlash([firstInvalid]);
      window.setTimeout(() => setFlash([]), 1600);
      const el = fieldRefs.current[firstInvalid];
      el?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "center" });
      el?.focus?.();
      notify("Please complete the required fields in this section", "err");
      return false;
    }
    return true;
  };

  const goToStep = (index: number) => {
    if (index < 0 || index >= totalSteps) return;
    if (index > maxReached) return; // don't skip ahead past visited steps
    setStepDir(index >= clampedStep ? 1 : -1);
    setStepIndex(index);
  };

  const goPrev = () => {
    if (isFirstStep) return;
    setStepDir(-1);
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const goNext = () => {
    if (!currentSection) return;
    if (!validateSection(currentSection.key)) return;
    if (isLastStep) return;
    const next = clampedStep + 1;
    setStepDir(1);
    setStepIndex(next);
    setMaxReached((m) => Math.max(m, next));
  };

  // ---- submit / draft / reset ---------------------------------------------
  const runFullValidation = (): boolean => {
    const errs: Record<string, string> = {};
    for (const sec of visibleSections) {
      for (const f of sec.fields || []) {
        if (!fieldVisible(sec, f, type)) continue;
        if (!fieldMatchesShowWhen(f, state.core, details)) continue;
        const m = validateField(f);
        if (m) errs[f.key] = m;
      }
    }
    if (type) {
      state.ctcSlab.forEach((row, index) => {
        const message = validateCtcExperience(row);
        if (message) errs[`ctcSlab.${index}.experience`] = message;
      });
    }
    if (!type) errs["opp_type"] = "Opportunity Type is required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submit = async () => {
    if (!runFullValidation()) { notify("Please fix the highlighted fields", "err"); return; }
    setBusy(true); setError("");
    try {
      const payload = buildSubmitPayload(state);
      // PUT schema has no skills — send them on the dedicated replace endpoint.
      const { skills: skillsPayload = [], ...body } = payload;

      let oppId = opportunityId;
      if (isEdit && opportunityId != null) {
        await crmPut(`/api/opportunities/${opportunityId}`, {
          ...body,
          version: state.version,
        });
        await crmPost(`/api/opportunities/${opportunityId}/skills`, skillsPayload);
      } else {
        const res = await crmPost<{ id: number }>("/api/opportunities", payload);
        oppId = res.data?.id;
        localStorage.removeItem(DRAFT_KEY);
      }

      const pending = attachments.filter((a) => a.file);
      if (oppId && pending.length) {
        for (const att of pending) {
          if (att.file) {
            await crmUpload(`/api/opportunities/${oppId}/attachments`, att.file, {
              kind: att.kind || "general",
            });
          }
        }
      }
      // Sales Head review: sign off in the same action as the save, so an edit
      // can never be left sitting un-approved.
      if (approvalMode && oppId != null) {
        await crmPost(`/api/opportunities/${oppId}/approve`, {
          comment: "Reviewed and approved by Sales Head",
        });
        notify("Opportunity approved");
      } else {
        notify(isEdit ? "Opportunity updated" : "Opportunity created");
      }
      onCreated?.();
      onClose();
    } catch (e: any) {
      const msg = e?.message || (isEdit ? "Failed to update opportunity" : "Failed to create opportunity");
      setError(msg);
      notify(msg, "err");
    } finally { setBusy(false); }
  };

  const saveDraft = () => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(serializeForDraft(state, attachments)));
      setDraftSavedAt(Date.now());
      setAutosaveStatus("saved");
      notify("Draft saved");
    } catch {
      setAutosaveStatus("error");
      notify("Could not save draft", "err");
    }
  };
  const reset = () => {
    localStorage.removeItem(DRAFT_KEY);
    setState({ ...emptyState(), isLoaded: true });
    setAttachments([]);
    setErrors({});
    setStepIndex(0);
    setMaxReached(0);
    setDraftSavedAt(null);
    setAutosaveStatus("idle");
  };

  const isDirty = !!(
    state.core.customer_id
    || state.core.title
    || type
    || attachments.length
    || Object.keys(details).some((k) => details[k] !== undefined && details[k] !== "" && details[k] !== null)
  );

  const requestClose = () => {
    if (busy || confirmCloseRef.current) return;
    if (isDirty) {
      confirmCloseRef.current = true;
      setConfirmClose(true);
      return;
    }
    onClose();
  };

  const stepPct = totalSteps ? Math.round(((clampedStep + 1) / totalSteps) * 100) : 0;

  // Focus step heading (a11y), then first focusable field on step enter.
  useEffect(() => {
    if (!currentSection || !state.isLoaded) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedStep, currentSection?.key, state.isLoaded]);

  // Enter advances (Next / Submit) unless focus is in a textarea.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (t.tagName === "BUTTON" || t.tagName === "A") return;
      if (busy) return;
      e.preventDefault();
      if (isLastStep) void submit();
      else goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wizard nav helpers are stable enough for Enter
  }, [busy, isLastStep, clampedStep, currentSection, state, attachments]);

  const wizardSteps: WizardStep[] = useMemo(
    () => visibleSections.map((s) => ({
      key: s.key,
      title: s.title,
      sublabel: sectionHelper(s.key).split(".")[0],
      status: sectionStatus(s.key),
    })),
    // sectionStatus closes over state/errors — recompute when those change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleSections, state, errors, type, details],
  );

  // ---- render --------------------------------------------------------------
  const header = (
    <WizardTopBar
      title={
        approvalMode
          ? `Review & Approve${editOppLabel ? ` — ${editOppLabel}` : ""}`
          : isEdit
            ? `Edit Opportunity${editOppLabel ? ` — ${editOppLabel}` : ""}`
            : "New Opportunity"
      }
      stepIndex={clampedStep}
      totalSteps={totalSteps}
      stepPct={stepPct}
      autosaveStatus={isEdit ? "idle" : autosaveStatus}
      savedAt={isEdit ? null : draftSavedAt}
      onSaveDraft={isEdit ? undefined : saveDraft}
      onReset={isEdit ? undefined : reset}
      busy={busy}
    />
  );

  const footer = (
    <WizardFooter
      stepIndex={clampedStep}
      totalSteps={totalSteps}
      stepPct={stepPct}
      isFirstStep={isFirstStep}
      isLastStep={isLastStep}
      busy={busy}
      onPrev={goPrev}
      onNext={goNext}
      onSubmit={() => void submit()}
      submitLabel={approvalMode ? "Save & Approve" : isEdit ? "Save Opportunity" : "Create Opportunity"}
      submitBusyLabel={isEdit ? "Saving…" : "Creating…"}
    />
  );

  const renderStepBody = (s: (typeof visibleSections)[number]) => (
    <>
      {s.key === "leaveHoliday" && type === "T&M" && !!policyBranchId
        && String(state.core.branch_id) === policyBranchId && (
        branchHasLeavePolicy ? (
          <p className="-mt-2 mb-5 text-xs leading-relaxed text-muted">
            Prefilled from {branches.find((b) => String(b.id) === policyBranchId)?.branch_name
              || "the selected branch"}&rsquo;s billing policy — editable.
          </p>
        ) : (
          <p className="-mt-2 mb-5 text-xs leading-relaxed text-muted">
            No leave policy linked to {branches.find((b) => String(b.id) === policyBranchId)?.branch_name
              || "this branch"}. Leave shows 0 until a leave policy is linked; Holidays reflect this branch&rsquo;s holiday calendar and Weekoff is the standard 104 (52 weekends). Edit any value if needed for costing.
          </p>
        )
      )}
      {s.key === "ctcSlab" && type === "T&M" && state.ctcSlab.length > 0
        && !String(details.billing_type ?? "").trim() && (
        <p className="-mt-2 mb-5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
          Revenue, Engineering Budget and Approved CTC auto-calculate once you set a{" "}
          <span className="font-semibold">Billing Type</span> in{" "}
          <span className="font-semibold">Commercial Details</span> — a Rate alone can&rsquo;t be
          annualised without knowing whether it&rsquo;s per hour, day, month or year.
        </p>
      )}
      {s.kind === "table" ? (
        <TableSection section={s} type={type}
          rows={(s.key === "ctcSlab" ? state.ctcSlab : state.skills) as any[]}
          options={options}
          rowErrors={s.key === "ctcSlab" ? errors : undefined}
          onRows={(rows) => setState((prev) => (
            s.key === "ctcSlab"
              ? recalculateOpportunityState({ ...prev, ctcSlab: rows })
              : { ...prev, skills: rows }
          ))} />
      ) : s.kind === "attachments" ? (
        <AttachmentsSection rows={attachments} onRows={setAttachments} />
      ) : s.kind === "activityLog" ? (
        <ActivityLogSection opportunityId={opportunityId} />
      ) : (
        <SectionFields
          section={s} type={type} values={state.core} details={details} errors={errors}
          options={options} nextFieldKey={nextField} strictSequential={STRICT_SEQUENTIAL_MODE} flashKeys={flash}
          forceReadonlyKeys={
            calculateRfiValue({
              revenueAnnual: state.ctcSlab[0]?.revenue_annual,
              periodMonths: resolveRfiPeriodMonths(type, details),
              positionsCount: details.tm_positions_count,
            }) !== null
              ? ["rfi_value"]
              : []
          }
          disabledReason={(f) => {
            if (f.key === "customer_type" && !customerHasPo) {
              return "Locked to NN until the customer has a purchase order.";
            }
            if (f.dependsOn && !state.core[f.dependsOn.field]) return f.dependsOn.hint;
            return null;
          }}
          onChange={onChange} onBlur={onBlur}
          registerRef={(k, el) => { fieldRefs.current[k] = el; }}
          onAddNew={(kind) => {
            if (kind === "customer") { setAddCustomer(true); return; }
            if (kind === "contact" || kind === "hiringManager") {
              if (!customerId) { notify("Select a customer first", "err"); return; }
              setNewContactFor(kind);
              return;
            }
            if (kind === "role") {
              const raw = window.prompt("Add a custom role (e.g. Lead Engineer)");
              const name = (raw || "").trim();
              if (!name) return;
              const existing = [...ROLE_OPTIONS, ...customRoles]
                .find((r) => r.value.toLowerCase() === name.toLowerCase());
              if (existing) {
                setState((st) => setDetail(st, "tm_role", existing.value));
                notify(`Role "${existing.label}" selected`);
                return;
              }
              setCustomRoles((prev) => [...prev, { value: name, label: name }]);
              setState((st) => setDetail(st, "tm_role", name));
              notify(`Role "${name}" added`);
            }
          }}
        />
      )}
    </>
  );

  return (
    <>
    <Modal
      title={header}
      onClose={requestClose}
      fullScreen
      footer={footer}
      bodyClassName="!overflow-hidden !p-0 sm:!px-0 sm:!py-0"
      scopeClassName="crm-wizard wiz-noise"
      panelClassName="wiz-moonlit-panel"
      headerClassName="wiz-moonlit-header"
      footerClassName="wiz-moonlit-footer"
    >
      {toast}
      <div className="wiz-moonlit-shell relative flex h-full min-h-0 flex-col">
        <WizardAurora />
        <div className="relative z-10 flex h-full min-h-0 flex-col">
        {/* Mobile / tablet: compact horizontal stepper under top bar */}
        <div className="shrink-0 border-b border-subtle bg-surface-2/40 px-4 py-2.5 md:hidden">
          <WizardStepper
            steps={wizardSteps}
            currentIndex={clampedStep}
            maxReached={maxReached}
            onSelect={goToStep}
            orientation="horizontal"
          />
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Desktop: vertical stepper rail */}
          <aside className="hidden w-[260px] shrink-0 overflow-y-auto border-r border-subtle bg-surface-2/30 px-3 py-5 md:block lg:px-4">
            <WizardStepper
              steps={wizardSteps}
              currentIndex={clampedStep}
              maxReached={maxReached}
              onSelect={goToStep}
              orientation="vertical"
              ariaLabel="Opportunity wizard steps"
            />
            <WizardStepProgress
              pct={
                currentSection
                  ? sectionStatus(currentSection.key) === "complete"
                    ? 100
                    : sectionStatus(currentSection.key) === "partial"
                      ? 55
                      : sectionStatus(currentSection.key) === "error"
                        ? 30
                        : 0
                  : 0
              }
            />
          </aside>

          {/* Scrollable content card */}
          <div ref={bodyRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-4 py-5 sm:px-6 sm:py-6 lg:px-10 lg:py-8">
            {error && (
              <div className="mb-4 max-w-3xl">
                <ErrorBox error={error} />
              </div>
            )}
            <AnimatePresence mode="wait" initial={false}>
              {currentSection && (
                <motion.section
                  key={currentSection.key}
                  id={`sec-${currentSection.key}`}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, x: stepDir * 28 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, x: stepDir * -28 }}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { duration: motionTok.panel, ease: motionTok.easeOut }
                  }
                  className="wiz-moonlit-form-card mx-auto max-w-3xl rounded-card border border-subtle bg-surface-1 px-5 py-6 shadow-raised sm:px-8 sm:py-8"
                >
                  <WizardStepHeader
                    title={currentSection.title}
                    description={sectionHelper(currentSection.key, currentSection.title)}
                    headingRef={stepHeadingRef}
                  />
                  {!state.isLoaded ? (
                    <WizardFieldSkeleton rows={6} />
                  ) : (
                    renderStepBody(currentSection)
                  )}
                </motion.section>
              )}
            </AnimatePresence>
          </div>
        </div>
        </div>
      </div>
    </Modal>
    {confirmClose && (
      <ConfirmModal
        title="Close wizard?"
        message="Unsaved changes will be lost — the form starts blank next time it opens."
        confirmLabel="Close"
        onConfirm={() => {
          confirmCloseRef.current = false;
          setConfirmClose(false);
          onClose();
        }}
        onClose={() => {
          confirmCloseRef.current = false;
          setConfirmClose(false);
        }}
      />
    )}
    {/* Inline customer creation — layered ABOVE, opportunity form stays mounted. */}
    {addCustomer && (
      <CustomerFormModal
        onClose={() => setAddCustomer(false)}
        onSaved={onCustomerCreated}
        notify={notify}
      />
    )}
    {newContactFor && (
      <OpportunityContactModal
        customerId={String(customerId)}
        customerName={customers.find((c) => String(c.id) === String(customerId))?.name || ""}
        branches={branches}
        defaultBranchId={String(branchId || "")}
        isHiringManager={newContactFor === "hiringManager"}
        onClose={() => setNewContactFor(null)}
        onCreated={(contact) => {
          // Add to the loaded contacts and select it in the matching field.
          setContacts((prev) => [...prev, contact]);
          const key = newContactFor === "hiringManager" ? "hiring_manager_id" : "contact_person_id";
          const field = OPPORTUNITY_SCHEMA
            .flatMap((s) => (s.kind === "fields" ? s.fields : []))
            .find((f) => f?.key === key);
          if (field) onChange(field, String(contact.id));
          setNewContactFor(null);
          notify(`${newContactFor === "hiringManager" ? "Hiring manager" : "Contact"} added`);
        }}
      />
    )}
    </>
  );
}

/** "Customer Contact Persons" popup (New Opportunity → Customer Details).
 * Mirrors the source form minus the Communication-Matrix ID. Customer comes
 * from the wizard; branch defaults to the selected branch. Saved contact
 * appears in this wizard's dropdown AND under the customer's branch. */
function OpportunityContactModal({
  customerId,
  customerName,
  branches,
  defaultBranchId,
  isHiringManager,
  onClose,
  onCreated,
}: {
  customerId: string;
  customerName: string;
  branches: any[];
  defaultBranchId: string;
  isHiringManager: boolean;
  onClose: () => void;
  onCreated: (contact: any) => void;
}) {
  const [branchId, setBranchId] = useState(defaultBranchId || "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [designation, setDesignation] = useState("");
  const [role, setRole] = useState("");
  // Contact roles come from the master (/api/contact-roles), merged with the
  // built-in seeds so the list is never empty if the master fetch fails.
  const [roleMaster, setRoleMaster] = useState<{ id: number; name: string }[]>([]);
  const [addingRole, setAddingRole] = useState(false);
  useEffect(() => {
    crmGet<{ id: number; name: string }[]>("/api/contact-roles?limit=200&is_active=true")
      .then((r) => setRoleMaster(r.data || []))
      .catch(() => setRoleMaster([]));
  }, []);
  const roleOptions = useMemo(() => {
    const seen = new Map<string, { value: string; label: string }>();
    for (const name of [...CONTACT_ROLES, ...roleMaster.map((r) => r.name)]) {
      const key = name.trim().toLowerCase();
      if (key && !seen.has(key)) seen.set(key, { value: name, label: name });
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [roleMaster]);
  const addRole = async (name: string) => {
    const q = name.trim();
    if (!q || roleOptions.some((o) => o.value.toLowerCase() === q.toLowerCase())) return;
    setAddingRole(true);
    try {
      const res = await crmPost<{ id: number; name: string }>(
        "/api/contact-roles", { name: q, is_active: true },
      );
      setRoleMaster((prev) => [...prev, res.data]);
      setRole(res.data.name);
    } catch (e: any) {
      setErr(e?.message || "Failed to add the role");
    } finally {
      setAddingRole(false);
    }
  };
  const [priority, setPriority] = useState("");
  const [notification, setNotification] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!name.trim()) { setErr("Name is required"); return; }
    setErr("");
    setBusy(true);
    try {
      const res = await crmPost(`/api/customers/${customerId}/contacts`, {
        name: name.trim(),
        branch_id: branchId ? Number(branchId) : null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        designation: designation.trim() || null,
        role: role || null,
        contact_priority: priority || null,
        notification: notification || null,
        is_hiring_manager: isHiringManager,
        is_active: isActive,
      });
      onCreated(res.data);
    } catch (e: any) {
      setErr(e?.message || "Failed to create contact");
      setBusy(false);
    }
  };

  const row = "flex flex-col gap-1";
  const lbl = "text-xs font-semibold text-secondary";
  return (
    <Modal title="Customer Contact Persons" onClose={onClose} medium scopeClassName="crm-wizard wiz-noise" deep>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className={row}>
          <span className={lbl}>Customer</span>
          <input className={inputCls} value={customerName} readOnly disabled />
        </div>
        <div className={row}>
          <span className={lbl}>Customer Branch</span>
          <select className={inputCls} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">— Customer-wide —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.branch_name}{b.is_primary ? " (primary)" : ""}</option>
            ))}
          </select>
        </div>
        <div className={row}>
          <span className={lbl}>Name *</span>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className={row}>
          <span className={lbl}>Email</span>
          <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className={row}>
          <span className={lbl}>Phone</span>
          <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 …" />
        </div>
        <div className={row}>
          <span className={lbl}>Department</span>
          <input className={inputCls} value={designation} onChange={(e) => setDesignation(e.target.value)} />
        </div>
        <div className={row}>
          <span className={lbl}>Role</span>
          {/* Master-backed with inline add, mirroring the customer form — a
              hardcoded list meant a role like PMO could not be recorded at all. */}
          <SearchableSelect
            value={role}
            options={roleOptions}
            allowAdd
            searchable
            disabled={addingRole}
            addLabel="Add new role"
            placeholder="Search or add a role…"
            onChange={(v) => setRole(v)}
            onOptionsChange={(next) => {
              const known = new Set(roleOptions.map((o) => o.value.toLowerCase()));
              for (const o of next) {
                if (!known.has(o.value.toLowerCase())) void addRole(o.value);
              }
            }}
          />
        </div>
        <div className={row}>
          <span className={lbl}>Primary / Secondary</span>
          <select className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">-Select-</option>
            <option value="Primary">Primary</option>
            <option value="Secondary">Secondary</option>
          </select>
        </div>
        <div className={row}>
          <span className={lbl}>Notification</span>
          <select className={inputCls} value={notification} onChange={(e) => setNotification(e.target.value)}>
            <option value="">-Select-</option>
            {["Email", "SMS", "Both", "None"].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className={row}>
          <span className={lbl}>Status</span>
          <select className={inputCls} value={isActive ? "Active" : "Inactive"} onChange={(e) => setIsActive(e.target.value === "Active")}>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-primary sm:col-span-2">
          <input type="checkbox" className="h-4 w-4" checked={isHiringManager} readOnly />
          {isHiringManager ? "Saved as Hiring Manager" : "Contact person"}
        </label>
      </div>
      {err && <p className="mt-3 text-sm text-danger" role="alert">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>Reset</button>
        <button type="button" className={`${btnSecondary} btn-gradient !text-white`} onClick={() => void save()} disabled={busy}>
          {busy ? "Submitting…" : "Submit"}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ attachments */
function AttachmentsSection({ rows, onRows }: {
  rows: PendingAttachment[];
  onRows: (rows: PendingAttachment[]) => void;
}) {
  const jdRows = rows.filter((r) => r.kind === "customer_jd");
  const genRows = rows.filter((r) => r.kind !== "customer_jd");

  const addGeneral = () => onRows([...rows, { key: uid(), file: null, file_name: "", kind: "general" }]);
  const addCustomerJd = () => onRows([...rows, { key: uid(), file: null, file_name: "", kind: "customer_jd" }]);
  const removeRow = (key: string) => onRows(rows.filter((r) => r.key !== key));
  const pickFile = (key: string, file: File | null) => {
    onRows(rows.map((r) => (r.key === key ? { ...r, file, file_name: file?.name || "" } : r)));
  };

  const renderTable = (sectionRows: PendingAttachment[], emptyLabel: string, accept?: string) => (
    <div className={tableWrap}>
      <table className="w-full min-w-max text-sm lg:min-w-0">
        <thead className={tableHead}>
          <tr>
            <th className={thCls}>File</th>
            <th className={`${thCls} w-12`} />
          </tr>
        </thead>
        <tbody>
          {sectionRows.length === 0 ? (
            <tr className={tableRow}>
              <td colSpan={2} className={`${tdCls} py-6 text-center text-sm text-muted`}>
                {emptyLabel}
              </td>
            </tr>
          ) : sectionRows.map((row) => (
            <tr key={row.key} className={tableRow}>
              <td className={tdCls}>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-control border border-subtle bg-surface-2 px-3 py-2 text-sm font-semibold text-secondary transition-colors hover:bg-surface-1">
                    <Upload size={14} />
                    {row.file_name || "Select File"}
                    <input
                      type="file"
                      className="hidden"
                      accept={accept}
                      onChange={(e) => pickFile(row.key, e.target.files?.[0] || null)}
                    />
                  </label>
                  {row.file_name && <span className="text-xs text-muted">{row.file_name}</span>}
                </div>
              </td>
              <td className={tdCls}>
                <button type="button" aria-label="Remove file" className="rounded-control p-1 text-muted transition-colors duration-micro ease-smooth hover:text-danger"
                  onClick={() => removeRow(row.key)}><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <div className="text-sm font-semibold text-primary">Customer JD</div>
          <p className="text-xs text-muted">Upload the customer job description (PDF / DOC / DOCX). Available for all opportunity types.</p>
        </div>
        {renderTable(jdRows, "No customer JD attached yet", ".pdf,.doc,.docx")}
        <button type="button" className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300" onClick={addCustomerJd}>
          <Plus size={14} className="mr-1 inline" /> Add Customer JD
        </button>
      </div>
      <div className="space-y-3">
        <div className="text-sm font-semibold text-primary">Other attachments</div>
        {renderTable(genRows, "No files attached yet")}
        <button type="button" className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300" onClick={addGeneral}>
          <Plus size={14} className="mr-1 inline" /> Add New
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ activity log */
function ActivityLogSection({ opportunityId }: { opportunityId?: number }) {
  const [rows, setRows] = useState<Array<{
    comment?: string | null;
    timestamp?: string | null;
    action_type?: string | null;
    username?: string | null;
    full_name?: string | null;
    id?: number;
  }>>([]);
  const [loading, setLoading] = useState(!!opportunityId);

  useEffect(() => {
    if (!opportunityId) { setRows([]); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    crmGet<typeof rows>(`/api/opportunities/${opportunityId}/activity-log`)
      .then((r) => { if (alive) setRows(r.data || []); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [opportunityId]);

  const cols = ["Comments", "Date-Time", "Action_Type", "User", "RecordID"];
  return (
    <div className={tableWrap}>
      <table className="w-full min-w-max text-sm lg:min-w-0">
        <thead className={tableHead}>
          <tr>
            {cols.map((c) => (
              <th key={c} className={thCls}>
                {c}{c === "RecordID" ? <span className="text-danger"> *</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr className={tableRow}>
              <td colSpan={cols.length} className={`${tdCls} py-8 text-center text-sm text-muted`}>
                Loading activity…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr className={tableRow}>
              <td colSpan={cols.length} className={`${tdCls} py-8 text-center text-sm text-muted`}>
                {opportunityId
                  ? "No activity recorded yet"
                  : "Activity history will appear after the opportunity is saved"}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id} className={tableRow}>
                <td className={tdCls}>{r.comment || "—"}</td>
                <td className={tdCls}>
                  {r.timestamp ? new Date(r.timestamp).toLocaleString() : "—"}
                </td>
                <td className={tdCls}>{r.action_type || "—"}</td>
                <td className={tdCls}>{r.full_name || r.username || "—"}</td>
                <td className={tdCls}>{r.id ?? "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------ table section */
/** Editable skill-evaluation table or vertical CTC slab cards. */
function TableSection({ section, type, rows, options, rowErrors, onRows }: {
  section: any;
  type: OpportunityType | "";
  rows: any[];
  options: OptionsMap;
  rowErrors?: Record<string, string>;
  onRows: (rows: any[]) => void;
}) {
  void type;
  const cols = section.table.columns as FieldDef[];
  const list = rows || [];
  const addRow = () => onRows([...list, {}]);
  const removeRow = (i: number) => onRows(list.filter((_, idx) => idx !== i));
  const setCell = (i: number, key: string, value: unknown) => {
    onRows(list.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  };

  if (!list.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <p className="text-sm text-muted">{section.table.emptyLabel}</p>
        <button type="button" className={btnSecondary} onClick={addRow}><Plus size={14} /> {section.table.addLabel}</button>
      </div>
    );
  }

  /* Candidate CTC Slab: stacked cards — no horizontal scroll */
  if (section.key === "ctcSlab") {
    return (
      <div className="space-y-4 pb-6">
        {list.map((row, i) => (
          <div
            key={i}
            className="rounded-card border border-subtle bg-surface-2/40 p-4 sm:p-5"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-primary">
                CTC Slab {list.length > 1 ? i + 1 : ""}
              </div>
              <button
                type="button"
                aria-label={`Remove CTC slab ${i + 1}`}
                className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs font-semibold text-muted transition-colors duration-micro ease-smooth hover:bg-surface-1 hover:text-danger"
                onClick={() => removeRow(i)}
              >
                <Trash2 size={14} /> Remove
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {cols.map((c) => {
                const derived = !!c.computed;
                const opts = c.options || (c.optionsSource ? options[c.optionsSource] : undefined);
                const id = `ctc-${i}-${c.key}`;
                return (
                  <label key={c.key} className="flex flex-col gap-1.5" htmlFor={id}>
                    <span className="text-xs font-semibold text-muted">
                      {c.label}
                      {derived ? (
                        <span className="ml-1 font-normal opacity-70">(auto)</span>
                      ) : null}
                    </span>
                    {c.type === "checkbox" ? (
                      <input
                        id={id}
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-brand-600"
                        checked={!!row[c.key]}
                        onChange={(e) => setCell(i, c.key, e.target.checked)}
                      />
                    ) : opts ? (
                      <select
                        id={id}
                        className={`${inputCls} w-full`}
                        value={String(row[c.key] ?? "")}
                        onChange={(e) => setCell(i, c.key, e.target.value)}
                      >
                        <option value="">—</option>
                        {opts.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={id}
                        readOnly={derived}
                        title={derived ? "Calculated automatically" : undefined}
                        type={["number", "currency", "percent"].includes(c.type) ? "number" : "text"}
                        min={c.min}
                        max={c.max}
                        step="any"
                        className={`${inputCls} w-full ${derived ? "cursor-default bg-surface-2/80 opacity-80" : ""}`}
                        value={String(row[c.key] ?? "")}
                        onChange={(e) => setCell(i, c.key, e.target.value)}
                      />
                    )}
                  </label>
                );
              })}
            </div>
            {rowErrors?.[`ctcSlab.${i}.experience`] && (
              <p className="mt-3 text-xs font-semibold text-danger">
                {rowErrors[`ctcSlab.${i}.experience`]}
              </p>
            )}
          </div>
        ))}
        <button type="button" className={btnSecondary} onClick={addRow}>
          <Plus size={14} /> {section.table.addLabel}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm lg:min-w-0">
          <thead>
            <tr className="text-left text-xs text-muted">
              {cols.map((c) => <th key={c.key} className="px-2 py-1 font-semibold">{c.label}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((row, i) => (
              <React.Fragment key={i}>
                <tr className="border-t border-subtle">
                  {cols.map((c) => {
                    const derived = !!c.computed;
                    const opts = c.options || (c.optionsSource ? options[c.optionsSource] : undefined);
                    return (
                      <td key={c.key} className="px-1 py-1">
                        {c.type === "checkbox" ? (
                          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!row[c.key]}
                            onChange={(e) => setCell(i, c.key, e.target.checked)} />
                        ) : opts ? (
                          <select className="input-recessed w-full rounded-control px-2 py-1 text-sm"
                            value={String(row[c.key] ?? "")} onChange={(e) => setCell(i, c.key, e.target.value)}>
                            <option value="">—</option>
                            {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : (
                          <input readOnly={derived} title={derived ? "Calculated automatically" : undefined}
                            type={["number", "currency", "percent"].includes(c.type) ? "number" : "text"}
                            min={c.min} max={c.max} step="any"
                            className={`input-recessed min-w-28 w-full rounded-control px-2 py-1 text-sm ${derived ? "bg-surface-2 opacity-70" : ""}`}
                            value={String(row[c.key] ?? "")} onChange={(e) => setCell(i, c.key, e.target.value)} />
                        )}
                      </td>
                    );
                  })}
                  <td className="px-1">
                    <button type="button" aria-label="Remove row"
                      className="rounded-control p-1 text-muted transition-colors duration-micro ease-smooth hover:text-danger"
                      onClick={() => removeRow(i)}><Trash2 size={14} /></button>
                  </td>
                </tr>
                {rowErrors?.[`ctcSlab.${i}.experience`] && (
                  <tr>
                    <td colSpan={cols.length + 1} className="px-2 pb-2 text-xs font-semibold text-danger">
                      {rowErrors[`ctcSlab.${i}.experience`]}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className={btnSecondary} onClick={addRow}><Plus size={14} /> {section.table.addLabel}</button>
    </div>
  );
}


/** Plain-JSON draft echo that round-trips through hydrateFromServer. */
function serializeForDraft(s: OpportunityFormState, attachments?: PendingAttachment[]) {
  return {
    opp_type: s.activeType,
    ...s.core,
    details: sharedDetailsForDraft(s),
    ctc_slab: s.ctcSlab,
    skills: s.skills,
    version: s.version,
    _attachments: attachments
      ? attachments.map((a) => ({ key: a.key, file_name: a.file_name }))
      : undefined,
  };
}
