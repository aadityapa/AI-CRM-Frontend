/**
 * Full-screen, guided, type-driven New Opportunity form (Parts 1–5).
 * ONE schema drives it (opportunitySchema) via <SectionFields>; per-type state is
 * preserved by opportunityFormState. Autosave is gated behind `isLoaded`.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Plus, Trash2, Upload } from "lucide-react";
import { crmGet, crmPost, crmPut, crmUpload } from "../../api";
import { toDateKey } from "../../lib/calendarDates";
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
import { useCanAct } from "../../useAccess";
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
  // Paid leaves + the branch hours cap feed calculateBillingBases too — a
  // change must recompute Actual Billing Days/Hours live (18 Aug 2026).
  "paid_leaves", "max_billable_hours_month",
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
    // Paid leaves the customer bills (APTIV rule) — added back to billing days.
    paidLeaves: isTm ? details.paid_leaves : undefined,
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
      // Holidays default to the standard 10 (user decision, 27 Aug 2026) and
      // stay editable — a change reflows straight into Actual Billing Days.
      // Weekoff is NOT policy-driven: it's the fixed number of weekend days
      // in a year (52 weekends × 2 = 104), so it always calculates to 104.
      holidays: current.holidays === undefined || current.holidays === "" ? 10 : current.holidays,
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
  initialCustomerId,
  initialBranchId,
}: {
  onClose: () => void;
  onCreated?: () => void;
  /** When set, load + PUT this opportunity (same wizard chrome as create). */
  opportunityId?: number;
  /** Sales Head reviewing before sign-off: saves any edits, then approves in the
   * same action, so a correction can never be left un-approved by accident. */
  approvalMode?: boolean;
  /** Customer-hub "New Opportunity": the customer is already chosen there. */
  initialCustomerId?: number;
  /** Branch-hub "New Opportunity": customer AND branch are already chosen.
   * Both stay fully editable — this is a head start, not a lock. */
  initialBranchId?: number;
}) {
  const reduce = useReducedMotion();
  const [toast, notify] = useToast();
  const isSales = useCanAct("opportunities", "create", useHasRole("Sales", "Sales_Head"));
  // A plain Sales person — Sales_Head and Admin keep the full status list, since
  // they oversee the whole pipeline rather than just opening it.
  // Both hooks must run unconditionally (rules-of-hooks) — combine after.
  const hasSales = useHasRole("Sales");
  const hasSalesHead = useHasRole("Sales_Head");
  const isSalesOnly = hasSales && !hasSalesHead;
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
  /* Per-type paid-leave breakup from the branch policy (18 Aug 2026) —
   * "Earned 12 · Sick 6 · Casual 6" shown under Commercial Details so the
   * paid_leaves number is explainable at a glance. Display-only. */
  const [leaveBreakup, setLeaveBreakup] = useState<{ name: string; annual: number }[]>([]);
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
          // Page through — the server clamps limit to 100, which truncated the
          // list. That truncation was invisible until the customer hub started
          // pre-selecting a customer (18 Aug 2026): a customer beyond row 100
          // was absent from `customers`, so the locked field showed a raw id
          // and Customer Type (required, derived from the customer) never
          // filled — the form could not be submitted at all.
          fetchAllMaster<any>("/api/customers"),
          fetchAllMaster<any>("/api/skills", { is_active: true }),
        ]);
        if (!alive) return;
        setCustomers(c);
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
        // Seed the hub customer HERE (18 Aug 2026). This blank-state reset
        // lands AFTER the awaits above, so a customer set by the hub effect
        // alone would be wiped a moment later. Everything else about the form
        // is unchanged: the Customer dropdown stays fully editable, and
        // branch/contact are chosen by the user as before.
        const fresh = emptyState();
        if (initialCustomerId) {
          fresh.core = { ...fresh.core, customer_id: String(initialCustomerId) };
        }
        if (initialBranchId) {
          fresh.core = { ...fresh.core, branch_id: String(initialBranchId) };
        }
        if (alive) setState(recalculateOpportunityState({ ...fresh, isLoaded: true }));
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

  // Customer-hub launch: pre-select (only) the customer the button was
  // pressed on — it stays editable, exactly like a manual pick. Create-mode
  // only, never overriding a choice already made. Re-runs once `isLoaded`
  // flips so it also repairs the state after the async init reset above.
  useEffect(() => {
    if (opportunityId || !initialCustomerId) return;
    setState((s) => {
      let core = s.core;
      if (!core.customer_id) core = { ...core, customer_id: String(initialCustomerId) };
      // Branch hub: seed the branch too (it triggers the usual branch
      // policy + contact autofill effects, exactly as a manual pick would).
      if (initialBranchId && !core.branch_id) core = { ...core, branch_id: String(initialBranchId) };
      return core === s.core ? s : { ...s, core };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCustomerId, initialBranchId, opportunityId, state.isLoaded]);

  // Dependent dropdowns when the customer or branch changes.
  const customerId = state.core.customer_id;
  const branchId = state.core.branch_id;

  /* Belt-and-braces live recalculation (18 Aug 2026): instead of trusting
   * every event handler to remember recalculateOpportunityState, this effect
   * watches the VALUES the billing bases depend on and re-derives whenever
   * any of them changes — checkbox, number, prefill, draft-restore, anything.
   * Loop-safe: the recalc writes only DERIVED outputs (actual_billing_days/
   * hours, slab auto columns, RFI), none of which appear in the dep list. */
  const tmDeps = state.detailsByType["T&M"] || {};
  const recalcDeps = JSON.stringify([
    state.activeType,
    tmDeps.holidays, tmDeps.weekoff, tmDeps.leave, tmDeps.paid_leaves,
    tmDeps.holidays_billable, tmDeps.weekoff_billable, tmDeps.leave_billable,
    tmDeps.hours_per_day, tmDeps.billing_type, tmDeps.max_billable_hours_month,
    tmDeps.tm_positions_count, tmDeps.tm_duration_months,
    tmDeps.project_duration_months,
  ]);
  useEffect(() => {
    if (!state.isLoaded || state.activeType !== "T&M") return;
    setState((s) => recalculateOpportunityState(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recalcDeps, state.isLoaded]);

  /* Opportunity ID preview (18 Aug 2026): show the auto number the record
   * would get instead of an empty box — still fully editable. Create mode
   * only; a failure just leaves the field blank (the server auto-numbers). */
  const autoOppIdRef = useRef<string>("");
  useEffect(() => {
    if (opportunityId || !state.isLoaded) return;
    let alive = true;
    crmGet<{ opp_id?: string }>("/api/opportunities/next-id")
      .then((r) => {
        const next = String(r.data?.opp_id || "").trim();
        if (!alive || !next) return;
        autoOppIdRef.current = next;
        setState((s) => (String(s.core.opp_id ?? "").trim()
          ? s
          : { ...s, core: { ...s.core, opp_id: next } }));
      })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunityId, state.isLoaded]);

  /* Live duplicate check on Opportunity ID (26 Aug 2026): a duplicate used to
   * surface only at SAVE, after the whole form was filled. The field now warns
   * ~0.5s after typing stops. The auto-previewed number is never checked (the
   * server guarantees it), and edit mode excludes the record itself. The
   * message feeds validateField, so Next/Create stay blocked while it stands. */
  const [oppIdTaken, setOppIdTaken] = useState("");
  useEffect(() => {
    const typed = String(state.core.opp_id ?? "").trim();
    if (!typed || typed === autoOppIdRef.current) {
      setOppIdTaken("");
      setErrors((e) => (e.opp_id ? { ...e, opp_id: "" } : e));
      return;
    }
    let alive = true;
    const t = window.setTimeout(() => {
      crmGet<{ available: boolean; existing?: { opp_id: string; title?: string | null; customer_name?: string | null } | null }>(
        `/api/opportunities/check-id?opp_id=${encodeURIComponent(typed)}${opportunityId ? `&exclude_id=${opportunityId}` : ""}`,
      )
        .then((r) => {
          if (!alive) return;
          const ex = r.data?.existing;
          const msg = r.data?.available === false
            ? `${ex?.opp_id || typed} already exists${ex?.title ? ` — "${ex.title}"` : ""}${ex?.customer_name ? ` (${ex.customer_name})` : ""}. Choose a different ID.`
            : "";
          setOppIdTaken(msg);
          setErrors((e) => ({ ...e, opp_id: msg }));
        })
        .catch(() => { /* offline check failure must not block typing; save still validates */ });
    }, 450);
    return () => { alive = false; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.core.opp_id, opportunityId]);

  /* Closing Date auto-derives (18 Aug 2026): RFI Received Date + Notice
   * Period days. Fills only while the field is empty or still holding the
   * previous auto value — the moment the user types their own date, the
   * derivation backs off for good. */
  const autoClosingRef = useRef<string>("");
  const tmDetails = state.detailsByType["T&M"] || {};
  useEffect(() => {
    if (state.activeType !== "T&M") return;
    const recv = String(state.core.rfi_received_date || "");
    const notice = Number(tmDetails.tm_notice_period);
    if (!recv || !Number.isFinite(notice) || notice <= 0) return;
    const d = new Date(`${recv}T00:00:00`);
    if (isNaN(d.getTime())) return;
    d.setDate(d.getDate() + notice);
    const iso = d.toISOString().slice(0, 10);
    const cur = String(tmDetails.tm_closing_date || "");
    if (cur && cur !== autoClosingRef.current) return; // user's own date wins
    if (cur === iso) { autoClosingRef.current = iso; return; }
    autoClosingRef.current = iso;
    setState((s) => setDetail(s, "tm_closing_date", iso));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [String(state.core.rfi_received_date ?? ""), String(tmDetails.tm_notice_period ?? "")]);

  // Customer Rate Card (experience-band pricing) — feeds the CTC Slab rate
  // auto-fill. 403/404 simply means no auto-fill (e.g. a role outside
  // Sales/Sales_Head reviewing the form): the rate stays manual, never blocks.
  const [rateCard, setRateCard] = useState<Record<string, any>[]>([]);
  // Leave & Holiday keys the BRANCH policy defined — rendered read-only in the
  // form (they're the branch's commercial terms, not per-opportunity choices;
  // change them on the customer's branch, not here). Keys the branch does NOT
  // define stay editable for costing.
  const [policyLockedKeys, setPolicyLockedKeys] = useState<string[]>([]);
  useEffect(() => {
    if (!customerId) { setRateCard([]); return; }
    let alive = true;
    crmGet<Record<string, any>[]>(`/api/rate-cards?customer_id=${customerId}`)
      .then((r) => { if (alive) setRateCard(r.data || []); })
      .catch(() => { if (alive) setRateCard([]); });
    return () => { alive = false; };
  }, [customerId]);

  /** Rate Card → slab Rate, branch-wise (0077). The selected BRANCH's bands
   * are preferred; customer-wide (NULL-branch) bands are the fallback. Exact
   * band match (Exp Min & Max) first, then the band CONTAINING Exp Min.
   * Column = the opportunity's Billing Type; when the customer quoted exactly
   * ONE unit, that unit is used regardless — it IS their billing basis. Only
   * EMPTY rate cells are filled: auto-fill is a starting point, a typed
   * number is a decision.
   *
   * WIDE BANDS AUTO-BUILD THE SLAB LADDER (Aug 2026): a customer rate of,
   * say, ₹1000 for 3–7 yrs means the SAME revenue for every year the
   * employee spends inside that band. So filling year 3 also generates rows
   * for years 4, 5 and 6: first row keeps its Hike % (default 10) and gets
   * Appraisal Cycle "Annual"; the generated rows carry Hike 0 and no cycle —
   * no new money arrives from the customer until their NEXT band, so there
   * is no hike headroom, and the Approved CTC stays at the full budget. */
  const applyRateCardToSlab = (rows: Record<string, unknown>[]) => {
    if (!rateCard.length) return rows;
    const colByBilling: Record<string, string> = {
      "Per Hour": "rate_hourly", "Per Day": "rate_daily",
      "Per Month": "rate_monthly", "Per Year": "rate_yearly",
    };
    const btCol = colByBilling[String(details.billing_type ?? "")];
    const RATE_KEYS = ["rate_hourly", "rate_daily", "rate_weekly", "rate_monthly", "rate_yearly"];
    // Slab VERSIONS (0079): only the ladder current TODAY prices new
    // opportunities — the newest effective_from on-or-before today wins;
    // future ladders wait, expired ones are history. NULL = since forever.
    const pickCurrentVersion = (rows: Record<string, any>[]) => {
      const today = toDateKey(new Date());
      const keys = [...new Set(rows.map((b) => String(b.effective_from || "")))].sort();
      const cur = keys.filter((k) => k <= today).pop();
      return cur === undefined ? [] : rows.filter((b) => String(b.effective_from || "") === cur);
    };
    const branchRows = pickCurrentVersion(
      rateCard.filter((b) => String(b.branch_id ?? "") === String(branchId ?? "")));
    const fallbackRows = pickCurrentVersion(rateCard.filter((b) => b.branch_id == null));
    const findBand = (lo: number, hi: number) => {
      for (const pool of [branchRows, fallbackRows]) {
        const hit = pool.find((b) => Number(b.exp_min) === lo && Number(b.exp_max) === hi)
          ?? (Number.isFinite(lo)
            ? pool.find((b) => lo >= Number(b.exp_min) && lo < Number(b.exp_max))
            : undefined);
        if (hit) return hit;
      }
      return undefined;
    };
    const bandValue = (band: Record<string, any>) => {
      let value = btCol ? band[btCol] : null;
      if (value == null) {
        const quoted = RATE_KEYS.filter((k) => band[k] != null);
        if (quoted.length === 1) value = band[quoted[0]];
      }
      return value;
    };

    const out: Record<string, unknown>[] = [...rows];
    rows.forEach((r, idx) => {
      if (r.rate !== "" && r.rate !== null && r.rate !== undefined) return;
      const lo = Number(r.exp_min);
      const band = findBand(lo, Number(r.exp_max));
      if (!band) return;
      const value = bandValue(band);
      if (value == null) return;
      out[idx] = {
        ...r,
        rate: value,
        // TARGET = the END of the rate band (Zoho parity, 14 Aug 2026): the
        // candidate's target is the year the customer's next rate arrives.
        // Exp 3 in a 3–5 band targets 5 → cycles = 1; exp 4 targets 5 →
        // cycles = 0. This is what makes Appraisal Cycles descend inside a
        // band instead of sitting at 0 everywhere.
        target_exp: (r.target_exp === "" || r.target_exp == null)
          && Number.isFinite(Number(band.exp_max))
          ? Number(band.exp_max)
          : r.target_exp,
      };
      // Ladder: one row per further year inside the band (…until the year
      // whose target would cross into the customer's next rate band). Each
      // generated row keeps the default Hike 10% — its Appraisal Cycles
      // auto-derive to 0 (target − min − 1), so Approved CTC = full budget,
      // exactly the NEXUS behaviour for the final year of a band.
      const bandEnd = Number(band.exp_max);
      if (!Number.isFinite(lo) || !Number.isFinite(bandEnd)) return;
      for (let m = Math.floor(lo) + 1; m + 1 <= bandEnd; m++) {
        if (out.some((x) => Number(x.exp_min) === m)) continue;  // never duplicate
        out.push({
          exp_min: m,
          target_exp: bandEnd,  // band end (Zoho parity) — cycles descend to 0
          rate: value,
          management_cost_pct: r.management_cost_pct ?? 30,
          hike_pct: 10,
        });
      }
    });
    // Rows no band could price: default the target to the next year so the
    // derivation chain still runs (cycles 0, budget = approved).
    return out.map((r) => {
      const lo = Number(r.exp_min);
      if ((r.target_exp === "" || r.target_exp == null) && Number.isFinite(lo)) {
        return { ...r, target_exp: lo + 1 };
      }
      return r;
    });
  };

  // AUTO-BUILD the Candidate CTC Slab from T&M experience (14 Aug 2026):
  // Exp. Min / Exp. Max in Time & Material Details define the ladder — one
  // row per year from Exp Min until the TARGET (Exp Max) is met, rates from
  // the branch slab, nothing to add manually. Rows carry an __auto marker
  // (stripped by sanitizeCtcSlab) so a slab anyone EDITED is never rebuilt;
  // changing the experience range regenerates only an untouched ladder.
  useEffect(() => {
    const lo = Number(details.tm_exp_min);
    const hi = Number(details.tm_exp_max);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo || type !== "T&M") return;
    setState((prev) => {
      const untouched = prev.ctcSlab.length === 0
        || prev.ctcSlab.every((r) => (r as Record<string, unknown>).__auto === true);
      if (!untouched) return prev;
      const rows: Record<string, unknown>[] = [];
      for (let m = Math.floor(lo); m + 1 <= Math.ceil(hi); m++) {
        // target_exp deliberately EMPTY: applyRateCardToSlab sets it to the
        // rate band's end (Zoho parity), falling back to m+1 outside bands.
        rows.push({ __auto: true, exp_min: m,
          hike_pct: 10, management_cost_pct: 30 });
      }
      if (!rows.length) return prev;
      const filled = applyRateCardToSlab(rows);
      const sameAsBefore = prev.ctcSlab.length === filled.length
        && JSON.stringify(prev.ctcSlab) === JSON.stringify(filled);
      if (sameAsBefore) return prev;
      return recalculateOpportunityState({
        ...prev, ctcSlab: filled as typeof prev.ctcSlab });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details.tm_exp_min, details.tm_exp_max, type, rateCard,
      String(details.billing_type ?? "")]);

  // Re-fill when the card arrives late or the Billing Type changes — both can
  // happen AFTER slab rows exist (edit mode loads state before the card).
  useEffect(() => {
    setState((prev) => {
      if (!prev.ctcSlab.length || !rateCard.length) return prev;
      const next = applyRateCardToSlab(prev.ctcSlab as Record<string, unknown>[]);
      return JSON.stringify(next) === JSON.stringify(prev.ctcSlab)
        ? prev
        : recalculateOpportunityState({ ...prev, ctcSlab: next as typeof prev.ctcSlab });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateCard, String(details.billing_type ?? "")]);
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
      setLeaveBreakup([]);
      setPolicyLockedKeys([]);
      setState((s) => {
        const tm = { ...(s.detailsByType["T&M"] || {}) };
        let changed = false;
        // Holidays default to the standard 10 (user decision, 27 Aug 2026);
        // Leave defaults to the standard 24 (it feeds the CTC Slab deduction);
        // Weekoff stays 104 (52 weekends), not tied to any leave policy.
        if (tm.holidays !== 10) {
          tm.holidays = 10;
          changed = true;
        }
        if (tm.leave !== 24) {
          tm.leave = 24;
          changed = true;
        }
        if (tm.weekoff !== 104) {
          tm.weekoff = 104;
          changed = true;
        }
        for (const key of ["credit_leave_monthly", "leave_policy", "paid_leaves"] as const) {
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
        setLeaveBreakup(Array.isArray(p.leave_breakup) ? p.leave_breakup : []);
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
          // EVERYTHING here is PREFILLED from the branch policy but stays
          // EDITABLE (changed 14 Aug 2026 on request — locking blocked
          // legitimate per-deal costing adjustments, e.g. Aptiv).
          const locked: string[] = [];
          // Paid leaves the customer bills (APTIV rule): explicit policy
          // figure first; else the branch's linked leave-policy total — the
          // accrued leaves (1.5/mo = 18/yr) are exactly what the customer
          // agreed to PAY for, while the standard 24 still deducts:
          // 365 − 104 − 10 − 24 = 227, + 18 paid = 245 billing days.
          const linkedLeaveTotal = p.branch_leave_total ?? p.leave_total;
          const paidLeaves =
            p.billable_leaves_per_year != null && Number.isFinite(Number(p.billable_leaves_per_year))
              ? Number(p.billable_leaves_per_year)
              : (linked && linkedLeaveTotal != null && Number.isFinite(Number(linkedLeaveTotal))
                ? Number(linkedLeaveTotal)
                : null);
          setTmDetail("paid_leaves", paidLeaves ?? "");
          if (typeof p.holidays_billable === "boolean") setTmDetail("holidays_billable", p.holidays_billable);
          if (typeof p.weekoff_billable === "boolean") setTmDetail("weekoff_billable", p.weekoff_billable);
          // Partial-billing model: when the customer pays for SOME leaves,
          // leave must DEDUCT (billable=false) and the paid days add back —
          // a blanket leave_billable=true would skip the deduction entirely
          // (Aptiv read 251 days instead of 245).
          if (paidLeaves != null && paidLeaves > 0) {
            setTmDetail("leave_billable", false);
          } else if (typeof p.leave_billable === "boolean") {
            setTmDetail("leave_billable", p.leave_billable);
          }
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
          // HOLIDAYS: the standard default is 10 on every new opportunity
          // (user decision, 27 Aug 2026) — editable, and a change reflows
          // into Actual Billing Days. The branch's own holiday-calendar count
          // no longer auto-overrides it; type the branch's real count when a
          // specific deal needs it.
          setTmDetail("holidays", 10);
          // WEEKOFF is not policy-driven — always the standard 104 (52 weekends),
          // unless a future branch weekoff_count is sent.
          if (p.weekoff_count != null && Number.isFinite(Number(p.weekoff_count))) {
            setTmDetail("weekoff", Number(p.weekoff_count));
          } else {
            setTmDetail("weekoff", 104);
          }
          // LEAVE (the deduction) is ALWAYS the standard 24 — the linked
          // leave policy's total is the customer's PAID allowance and already
          // landed in paid_leaves above. Putting it here (the old behaviour)
          // both under-deducted and skipped the add-back.
          setTmDetail("leave", 24);
          if (linked) {
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
            setTmDetail("credit_leave_monthly", "");
            setTmDetail("leave_policy", "");
          }
          setPolicyLockedKeys(locked);  // always empty now — prefill, never lock
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
    // Duplicate Opportunity ID blocks Next/Create until changed.
    if (f.key === "opp_id" && oppIdTaken) return oppIdTaken;
    const v = isCoreKey(f.key) ? state.core[f.key] : details[f.key];
    if (f.required && (v === "" || v === null || v === undefined
        || (Array.isArray(v) && v.length === 0))) return `${f.label} is required`;
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
  // "leaveHoliday" is presented as ONE merged step (Aug 2026): Leave & Holiday
  // Details + Commercial Details + Candidate CTC Slab + RFI Value. The schema
  // keeps three sections (field metadata, validation and hydration unchanged);
  // only the wizard folds them into a single card, RFI last.
  const visibleSections = OPPORTUNITY_SCHEMA.filter(
    (s) => sectionVisible(s, type) && !(s.key === "skillEval" && isSales)
      && s.key !== "commercial" && s.key !== "ctcSlab",
  ).map((s) => (s.key === "leaveHoliday" ? { ...s, title: "Commercials & CTC Slab" } : s));
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
    // The merged Commercials step spans three schema sections.
    const keys = secKey === "leaveHoliday" ? ["leaveHoliday", "commercial"] : [secKey];
    const secs = OPPORTUNITY_SCHEMA.filter((s) => keys.includes(s.key));
    if (!secs.length) return "empty";
    if (secKey === "leaveHoliday"
        && Object.keys(errors).some((k) => k.startsWith("ctcSlab."))) {
      return "error";  // slab row problems surface on the merged step chip
    }
    if (secs.length === 1 && !secs[0].fields?.length) {
      // Table / attachments / activity steps have no required field list — treat as complete when visited.
      const k = secs[0].kind;
      if (k === "table" || k === "attachments" || k === "activityLog") return "complete";
      return "empty";
    }
    const reqd = secs.flatMap((sec) => (sec.fields || []).filter(
      (f) => f.required && fieldVisible(sec, f, type) && fieldMatchesShowWhen(f, state.core, details),
    ));
    if (reqd.some((f) => errors[f.key])) return "error";
    if (!reqd.length) return "complete";
    const filled = reqd.filter((f) => {
      const v = isCoreKey(f.key) ? state.core[f.key] : details[f.key];
      if (Array.isArray(v)) return v.length > 0;
      return v !== "" && v !== null && v !== undefined;
    });
    if (filled.length === 0) return "empty";
    return filled.length === reqd.length ? "complete" : "partial";
  };

  /** Validate required fields in one section; flash + focus the first invalid field. */
  const validateSection = (secKey: string): boolean => {
    // Merged Commercials step → validate all three schema sections at once.
    const keys = secKey === "leaveHoliday" ? ["leaveHoliday", "commercial"] : [secKey];
    const secs = OPPORTUNITY_SCHEMA.filter((s) => keys.includes(s.key));
    if (!secs.length) return true;
    const nextErrs: Record<string, string> = { ...errors };
    let firstInvalid: string | null = null;

    for (const sec of secs) {
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
    }

    if ((secKey === "ctcSlab" || secKey === "leaveHoliday") && type) {
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
    // visibleSections folds commercial + ctcSlab into the merged Commercials
    // step — their FIELDS must still be validated here.
    const validationSections = [
      ...visibleSections,
      ...OPPORTUNITY_SCHEMA.filter((x) => x.key === "commercial" || x.key === "ctcSlab"),
    ];
    for (const sec of validationSections) {
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
      // The Opportunity ID box shows the next auto number so the user can SEE
      // what they'll get. If they left that preview untouched, drop it: the
      // server numbers the record at save time, so two people creating at
      // once can't collide on the same previewed value. A typed ID is sent.
      if (!isEdit && autoOppIdRef.current
        && String(payload.opp_id ?? "").trim() === autoOppIdRef.current) {
        delete payload.opp_id;
      }
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

  /** Shared SectionFields renderer — one props blob for every fields block.
   * `dense` = compact grid for the merged Commercials step (fit one screen). */
  const renderFields = (sec: (typeof OPPORTUNITY_SCHEMA)[number], dense = false) => (
    <SectionFields
      dense={dense}
      section={sec} type={type} values={state.core} details={details} errors={errors}
      options={options} nextFieldKey={nextField} strictSequential={STRICT_SEQUENTIAL_MODE} flashKeys={flash}
      forceReadonlyKeys={[
        ...(calculateRfiValue({
          revenueAnnual: state.ctcSlab[0]?.revenue_annual,
          periodMonths: resolveRfiPeriodMonths(type, details),
          positionsCount: details.tm_positions_count,
        }) !== null
          ? ["rfi_value"]
          : []),
        // Branch-defined Leave & Holiday terms are read-only here —
        // they change on the customer's branch, not per opportunity.
        ...policyLockedKeys,
      ]}
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
  );

  const slabTable = () => {
    const slabSec = OPPORTUNITY_SCHEMA.find((x) => x.key === "ctcSlab")!;
    return (
      <TableSection section={slabSec} type={type}
        rows={state.ctcSlab as any[]}
        options={options}
        rowErrors={errors}
        onRows={(rows) => setState((prev) => recalculateOpportunityState({
          ...prev,
          ctcSlab: applyRateCardToSlab(rows as Record<string, unknown>[]) as typeof prev.ctcSlab,
        }))} />
    );
  };

  /** Sub-heading inside the merged Commercials card. */
  const subHead = (title: string, desc?: string) => (
    <div className="mb-2">
      <h3 className="text-sm font-bold tracking-wide text-primary">{title}</h3>
      {desc && <p className="mt-0.5 text-[11px] leading-snug text-muted">{desc}</p>}
    </div>
  );
  /** Bordered mini-panel — the merged step lays these out in a 2-up grid so
   * the whole step fits one viewport without scrolling (Aug 2026 redesign;
   * tightened 18 Aug 2026 — p-3/gap-3/leaner headings). */
  const subPanel = "rounded-card border border-subtle bg-surface-0/60 p-3";

  const renderStepBody = (s: (typeof visibleSections)[number]) => {
    // ---- Merged step: Leave & Holiday + Commercial + CTC Slab + RFI ------
    // One card, read top-to-bottom in calculation order: the costing inputs,
    // the billing basis, the slab that turns them into money, and the RFI
    // Value the money rolls up into — RFI deliberately LAST (Aug 2026).
    if (s.key === "leaveHoliday") {
      const leaveSec = OPPORTUNITY_SCHEMA.find((x) => x.key === "leaveHoliday")!;
      const commSec = OPPORTUNITY_SCHEMA.find((x) => x.key === "commercial")!;
      const commFields = (commSec.fields || []).filter(
        (f) => f.key !== "rfi_value" && fieldVisible(commSec, f, type),
      );
      const rfiField = (commSec.fields || []).find((f) => f.key === "rfi_value");
      // Paid-leave inputs live in their OWN panel under Commercial Details
      // (18 Aug 2026) — they are billing add-backs, not leave costing.
      const PAID_LEAVE_KEYS = new Set(["leave_policy", "paid_leaves"]);
      const leaveFields = (leaveSec.fields || []).filter(
        (f) => !PAID_LEAVE_KEYS.has(f.key) && fieldVisible(leaveSec, f, type),
      );
      const paidLeaveFields = (leaveSec.fields || []).filter(
        (f) => PAID_LEAVE_KEYS.has(f.key) && fieldVisible(leaveSec, f, type),
      );
      const showLeave = leaveFields.length > 0;
      // One-viewport layout (18 Aug 2026): THREE panels in one row —
      // Leave & Holiday | Commercial | Paid Leaves — the slab spans the full
      // width below and RFI is a slim strip. Long explanations became title
      // tooltips so the row stays short enough for the slab to be visible.
      const prefillNote = type === "T&M" && !!policyBranchId
        && String(state.core.branch_id) === policyBranchId
        ? (branchHasLeavePolicy
          ? `Prefilled from ${branches.find((b) => String(b.id) === policyBranchId)?.branch_name || "the branch"}'s billing policy — every value stays editable.`
          : "No branch leave policy — standard defaults (24 leave, 104 weekoff); all editable.")
        : "";
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-3">
            {showLeave && (
              <div className={subPanel} title={prefillNote || undefined}>
                {subHead("Leave & Holiday Details", prefillNote
                  || "Costing basis — every value editable for this opportunity.")}
                {renderFields({ ...leaveSec, fields: leaveFields }, true)}
              </div>
            )}
            <>
              {commFields.length > 0 && (
                <div className={subPanel}>
                  {subHead("Commercial Details",
                    "Billing type and hours — the basis every slab rate is annualised on.")}
                  {renderFields({ ...commSec, fields: commFields }, true)}
                  {/* LIVE formula (18 Aug 2026): shows exactly how Actual
                      Billing Days derive — a BILLABLE holiday/weekoff is
                      billed, so it deducts 0; only unticked ones subtract.
                      Updates on every keystroke, so "why didn't the number
                      move?" answers itself. */}
                  {type === "T&M" && (() => {
                    const n = (v: unknown) =>
                      v === "" || v == null || !Number.isFinite(Number(v)) ? 0 : Number(v);
                    const hb = details.holidays_billable === true;
                    const wb = details.weekoff_billable === true;
                    const lb = details.leave_billable === true;
                    const leaveDed = lb ? 0 : n(details.leave);
                    const paid = Math.min(n(details.paid_leaves), leaveDed);
                    const days = Math.max(0, 365
                      - (hb ? 0 : n(details.holidays))
                      - (wb ? 0 : n(details.weekoff))
                      - leaveDed + paid);
                    // Billable = customer pays that day = stays in the base.
                    const parts = [
                      ...(hb ? [] : [`− ${n(details.holidays)} holidays`]),
                      ...(wb ? [] : [`− ${n(details.weekoff)} weekoff`]),
                      ...(lb ? [] : [`− ${n(details.leave)} leave`]),
                      ...(paid > 0 ? [`+ ${paid} paid`] : []),
                    ];
                    return (
                      <p className="mt-1.5 text-[11px] leading-snug text-muted">
                        365 {parts.join(" ")} ={" "}
                        <span className="font-bold text-primary">{days} billing days</span>
                        {(hb || wb || lb) && (
                          <span> ({[hb && "holidays", wb && "weekoff", lb && "leave"]
                            .filter(Boolean).join(", ")} billable — customer pays, so not deducted)</span>
                        )}
                      </p>
                    );
                  })()}
                </div>
              )}
              {(paidLeaveFields.length > 0 || (type === "T&M" && leaveBreakup.length > 0)) && (
                <div className={subPanel}>
                  {subHead("Paid Leaves",
                    "Leave days the customer pays for — added back to Actual Billing Days.")}
                  {paidLeaveFields.length > 0
                    && renderFields({ ...leaveSec, fields: paidLeaveFields }, true)}
                  {/* WHERE the number comes from: the branch leave policy's
                      per-type accruals (Earned / Sick / Casual …). */}
                  {type === "T&M" && leaveBreakup.length > 0 && (
                    <div className="mt-3 rounded-card border border-subtle bg-surface-2/50 px-3 py-2.5">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                        From branch leave policy
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {leaveBreakup.map((b) => (
                          <span key={b.name}
                            className="rounded-full bg-brand-600/10 px-2.5 py-0.5 text-xs font-semibold text-brand-600 dark:text-brand-300">
                            {b.name}: {Number(b.annual).toLocaleString("en-IN", { maximumFractionDigits: 2 })}/yr
                          </span>
                        ))}
                        <span className="text-xs font-bold text-primary">
                          = {leaveBreakup.reduce((s, b) => s + Number(b.annual || 0), 0)
                            .toLocaleString("en-IN", { maximumFractionDigits: 2 })} days billed by customer
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          </div>
          <div className={subPanel}>
            {subHead("Candidate CTC Slab",
              "Rates auto-fill from the customer's Rate Card by experience band; Revenue, Engineering Budget and Approved CTC calculate as you type.")}
            {type === "T&M" && state.ctcSlab.length > 0
              && !String(details.billing_type ?? "").trim() && (
              <p className="-mt-1 mb-3 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                Revenue, Engineering Budget and Approved CTC auto-calculate once you set a{" "}
                <span className="font-semibold">Billing Type</span> in{" "}
                <span className="font-semibold">Commercial Details</span> above — a Rate alone
                can&rsquo;t be annualised without knowing whether it&rsquo;s per hour, day, month or year.
              </p>
            )}
            {slabTable()}
          </div>
          {rfiField && (
            <div className={`${subPanel} lg:flex lg:items-center lg:justify-between lg:gap-8`}>
              <div className="lg:max-w-xl [&>div]:mb-0">
                {subHead("RFI Value",
                  "Rolls up automatically from the slab's Annual Revenue x (Period / 12) x Positions.")}
              </div>
              <div className="mt-3 lg:mt-0 lg:w-80 lg:shrink-0 [&>div]:sm:!grid-cols-1">
                {renderFields({ ...commSec, fields: [rfiField] }, true)}
              </div>
            </div>
          )}
        </div>
      );
    }

    // ---- Every other step, exactly as before -----------------------------
    return (
      <>
        {s.kind === "table" ? (
          <TableSection section={s} type={type}
            rows={state.skills as any[]}
            options={options}
            onRows={(rows) => setState((prev) => ({ ...prev, skills: rows }))} />
        ) : s.kind === "attachments" ? (
          <AttachmentsSection rows={attachments} onRows={setAttachments} />
        ) : s.kind === "activityLog" ? (
          <ActivityLogSection opportunityId={opportunityId} />
        ) : (
          renderFields(s)
        )}
      </>
    );
  };

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
                  className={`wiz-moonlit-form-card mx-auto rounded-card border border-subtle bg-surface-1 shadow-raised ${
                    currentSection.key === "leaveHoliday"
                      ? "max-w-7xl px-5 py-5 sm:px-6 sm:py-5"
                      : "max-w-3xl px-5 py-6 sm:px-8 sm:py-8"
                  }`}
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
        role: role || null,
        contact_priority: priority || null,
        // Department / Notification / Status are no longer asked here:
        // a contact created mid-deal is Active, with routing left to Settings.
        is_hiring_manager: isHiringManager,
        is_active: true,
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
        {/* Department removed (18 Aug 2026, user request) — the `designation`
            column stays in the DB and existing values are untouched; new
            contacts simply don't ask for it. */}
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
        {/* Notification + Status removed (18 Aug 2026, user request): a
            contact created here is always Active, and notification routing is
            an admin concern (Settings → notification routes), not something
            to decide while filling a deal. Both still POST their defaults. */}
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
/** Indian-format money for DERIVED slab cells: 2022161.4 → "20,22,161.40". */
function fmtMoneyCell(v: unknown): string {
  if (v === "" || v === null || v === undefined) return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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
  // New slab rows open with the agreed defaults (Aug 2026): Hike 10% and
  // Management Cost 30%. For the CTC slab, Add New CONTINUES THE LADDER:
  // the new row starts where the slab currently ends (highest Target Exp),
  // which lets the rate card fill its Rate immediately — and when that year
  // opens a NEW band (e.g. 10 after a 7–10 band), the band's remaining years
  // auto-append too, so one click yields the whole next slab, not one row.
  const addRow = () => {
    if (section.key !== "ctcSlab") return onRows([...list, {}]);
    const ends = list
      .map((r) => Number((r as any).target_exp ?? (r as any).exp_max ?? (r as any).exp_min))
      .filter((n) => Number.isFinite(n) && n > 0);
    const next = ends.length ? Math.max(...ends) : null;
    onRows([...list, {
      hike_pct: 10,
      management_cost_pct: 30,
      ...(next !== null ? { exp_min: next } : {}),
    }]);
  };
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

  /* Candidate CTC Slab renders through the SAME compact table below (Aug 2026
     one-viewport redesign): one row per slab, so five slabs cost five rows —
     not five tall cards. Computed columns are flagged "(auto)" in the header. */
  const slab = section.key === "ctcSlab";
  const cellInput = slab
    ? "input-recessed w-full min-w-16 rounded-control px-1.5 py-1 text-xs"
    : "input-recessed min-w-28 w-full rounded-control px-2 py-1 text-sm";

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm lg:min-w-0">
          <thead>
            <tr className="text-left text-xs text-muted">
              {slab && <th className="px-1 py-1 font-semibold">#</th>}
              {cols.map((c) => (
                <th key={c.key} className="px-2 py-1 font-semibold">
                  {c.label}
                  {slab && c.computed ? (
                    <span className="ml-1 font-normal opacity-70">(auto)</span>
                  ) : null}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((row, i) => (
              <React.Fragment key={i}>
                <tr className="border-t border-subtle">
                  {slab && (
                    <td className="px-1 py-1 text-xs font-semibold text-muted tabular-nums">{i + 1}</td>
                  )}
                  {cols.map((c) => {
                    const derived = !!c.computed;
                    const opts = c.options || (c.optionsSource ? options[c.optionsSource] : undefined);
                    return (
                      <td key={c.key} className="px-1 py-1">
                        {c.type === "checkbox" ? (
                          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!row[c.key]}
                            onChange={(e) => setCell(i, c.key, e.target.checked)} />
                        ) : opts ? (
                          <select className={`input-recessed w-full rounded-control px-2 py-1 text-sm ${slab ? "min-w-20" : ""}`}
                            value={String(row[c.key] ?? "")} onChange={(e) => setCell(i, c.key, e.target.value)}>
                            <option value="">—</option>
                            {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : derived && c.type === "currency" ? (
                          // Derived money reads like money (Zoho parity):
                          // 20,22,161.40 — full width, tooltip carries the
                          // exact value in case the column is still tight.
                          <input readOnly type="text" tabIndex={-1}
                            title={fmtMoneyCell(row[c.key]) || "Calculated automatically"}
                            className={`${cellInput} !min-w-28 cursor-default bg-surface-2 text-right tabular-nums opacity-80`}
                            value={fmtMoneyCell(row[c.key])} />
                        ) : (
                          <input readOnly={derived} title={derived ? "Calculated automatically" : undefined}
                            type={["number", "currency", "percent"].includes(c.type) ? "number" : "text"}
                            min={c.min} max={c.max} step="any"
                            className={`${cellInput} ${derived ? "cursor-default bg-surface-2 opacity-70" : ""}`}
                            value={String(row[c.key] ?? "")} onChange={(e) => setCell(i, c.key, e.target.value)} />
                        )}
                      </td>
                    );
                  })}
                  <td className="px-1">
                    <button type="button" aria-label={slab ? `Remove CTC slab ${i + 1}` : "Remove row"}
                      className="rounded-control p-1 text-muted transition-colors duration-micro ease-smooth hover:text-danger"
                      onClick={() => removeRow(i)}><Trash2 size={14} /></button>
                  </td>
                </tr>
                {rowErrors?.[`ctcSlab.${i}.experience`] && (
                  <tr>
                    <td colSpan={cols.length + (slab ? 2 : 1)} className="px-2 pb-2 text-xs font-semibold text-danger">
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
