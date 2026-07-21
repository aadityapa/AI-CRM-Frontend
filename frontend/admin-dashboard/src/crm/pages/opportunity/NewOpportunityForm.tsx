/**
 * Full-screen, guided, type-driven New Opportunity form (Parts 1–5).
 * ONE schema drives it (opportunitySchema) via <SectionFields>; per-type state is
 * preserved by opportunityFormState. Autosave is gated behind `isLoaded`.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Plus, Trash2, Upload, CheckCircle2, Circle, AlertCircle } from "lucide-react";
import { crmGet, crmPost, crmUpload } from "../../api";
import { motion as motionTok } from "../../../design-system/tokens/tokens";
import { Modal, btnPrimary, btnSecondary, ErrorBox, inputCls, useToast } from "../../components/ui";
import {
  OPPORTUNITY_SCHEMA, OPPORTUNITY_TYPES, sectionVisible, fieldVisible,
  STRICT_SEQUENTIAL_MODE, SALES_STAGE_OPTIONS, ONBOARDING_STATUS_OPTIONS,
  ROLE_OPTIONS, WORK_LOCATION_OPTIONS, BILLING_TYPE_OPTIONS, APPRAISAL_CYCLE_OPTIONS,
  WFO_REMOTE_OPTIONS, LEAVE_POLICY_OPTIONS,
  customerTypeOptionsForPo, normalizeCustomerType,
  type OpportunityType, type FieldDef,
} from "./opportunitySchema";
import {
  emptyState, switchType, setDetail, isCoreKey, buildSubmitPayload,
  requiredProgress, hydrateFromServer, fieldsAtRiskOnSwitch, activeDetails,
  applyBranchContactDetails, sharedDetailsForDraft,
  type OpportunityFormState,
} from "./opportunityFormState";
import { SectionFields, type OptionsMap } from "./FormRenderer";
import { CustomerFormModal, type Customer } from "../Customers";
import { branchContactAutofill, emailFromContact, phoneFromContact, splitBranchContacts } from "../../lib/contactPhone";
import { useHasRole } from "../../CrmApp";
import {
  calculateBillingBases,
  recalculateCtcSlab,
  validateCtcExperience,
  type BillingInputs,
} from "./ctcSlab";

type Opt = { value: string; label: string };
type PendingAttachment = { key: string; file: File | null; file_name: string; kind: "customer_jd" | "general" };
const DRAFT_KEY = "kx.opp.draft";
const uid = () => Math.random().toString(36).slice(2, 11);

const thCls =
  "whitespace-nowrap px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-muted";
const tdCls = "px-3 py-2 align-top";
const tableWrap = "overflow-x-auto rounded-control border border-subtle";
const tableHead = "bg-surface-2";
const tableRow = "border-t border-subtle";

const CTC_TRIGGER_KEYS = new Set([
  "billing_type", "hours_per_day", "project_duration_months",
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
  };
}

/** Recalculate every type through one path; T&M alone receives billing bases. */
function recalculateOpportunityState(state: OpportunityFormState): OpportunityFormState {
  const current = { ...(state.detailsByType[state.activeType as OpportunityType] || {}) };
  let details: Record<string, unknown> = current;
  let detailsByType = state.detailsByType;
  if (state.activeType === "T&M") {
    details = {
      ...current,
      hours_per_day: current.hours_per_day === undefined ? 8 : current.hours_per_day,
      holidays: current.holidays === undefined ? 10 : current.holidays,
      weekoff: current.weekoff === undefined ? 104 : current.weekoff,
      leave: current.leave === undefined ? 24 : current.leave,
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
  return {
    ...state,
    detailsByType,
    ctcSlab: recalculateCtcSlab(state.ctcSlab, inputs),
  };
}

export function NewOpportunityForm({ onClose, onCreated }: { onClose: () => void; onCreated?: () => void }) {
  const reduce = useReducedMotion();
  const [toast, notify] = useToast();
  const isSales = useHasRole("Sales", "Sales_Head");
  const [state, setState] = useState<OpportunityFormState>(() => emptyState());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState("customerDetails");
  const [nextField, setNextField] = useState<string | undefined>("customer_id");
  const [addCustomer, setAddCustomer] = useState(false);
  const [flash, setFlash] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [customRoles, setCustomRoles] = useState<Opt[]>([]);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const bodyRef = useRef<HTMLDivElement>(null);

  // Option sources
  const [customers, setCustomers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [skills, setSkills] = useState<any[]>([]);

  const type = state.activeType;
  const details = activeDetails(state);
  const selectedCustomer = useMemo(
    () => customers.find((c) => String(c.id) === String(state.core.customer_id)),
    [customers, state.core.customer_id],
  );
  const customerHasPo = !!selectedCustomer?.has_po;

  // ---- initial load (restore draft, load base options). Sets isLoaded LAST. ----
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [c, s] = await Promise.all([
          crmGet<any[]>("/api/customers?limit=100"),
          crmGet<any[]>("/api/skills?limit=200&is_active=true"),
        ]);
        if (!alive) return;
        setCustomers(c.data || []);
        setSkills(s.data || []);
      } catch (e: any) {
        if (alive) setError(e?.message || "Failed to load form data");
      } finally {
        if (!alive) return;
        // Restore a saved draft if present, else start empty — either way, mark loaded.
        let restored = emptyState();
        try {
          const raw = localStorage.getItem(DRAFT_KEY);
          if (raw) restored = { ...hydrateFromServer(JSON.parse(raw)), isLoaded: true };
        } catch { /* ignore */ }
        setState(recalculateOpportunityState({ ...restored, isLoaded: true }));
      }
    })();
    return () => { alive = false; };
  }, []);

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
  useEffect(() => {
    if (!state.isLoaded) return;
    const t = window.setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(serializeForDraft(state))); } catch { /* ignore */ }
    }, 800);
    return () => window.clearTimeout(t);
  }, [state]);

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
    onboardingStatus: ONBOARDING_STATUS_OPTIONS,
    leavePolicy: LEAVE_POLICY_OPTIONS,
    billingType: BILLING_TYPE_OPTIONS,
    positionType: [],
    role: [...ROLE_OPTIONS, ...customRoles.filter((r) => !ROLE_OPTIONS.some((o) => o.value === r.value))],
    workLocation: WORK_LOCATION_OPTIONS,
    wfoRemote: WFO_REMOTE_OPTIONS,
    appraisalCycle: APPRAISAL_CYCLE_OPTIONS,
  }), [customers, branches, contactPersons, hiringManagers, skills, customerHasPo, customRoles, isSales]);

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
        const el = fieldRefs.current[f.next];
        if (el && document.activeElement !== el) el.focus?.();
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

  // ---- section nav status --------------------------------------------------
  const visibleSections = OPPORTUNITY_SCHEMA.filter((s) => sectionVisible(s, type));
  const sectionStatus = (secKey: string): "empty" | "partial" | "complete" | "error" => {
    const sec = OPPORTUNITY_SCHEMA.find((s) => s.key === secKey);
    if (!sec?.fields) return "empty";
    const reqd = sec.fields.filter((f) => f.required && fieldVisible(sec, f, type));
    if (reqd.some((f) => errors[f.key])) return "error";
    if (!reqd.length) return "complete";
    const filled = reqd.filter((f) => {
      const v = isCoreKey(f.key) ? state.core[f.key] : details[f.key];
      return v !== "" && v !== null && v !== undefined;
    });
    if (filled.length === 0) return "empty";
    return filled.length === reqd.length ? "complete" : "partial";
  };

  const scrollTo = (key: string) => {
    setActive(key);
    document.getElementById(`sec-${key}`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  // ---- submit / draft / reset ---------------------------------------------
  const runFullValidation = (): boolean => {
    const errs: Record<string, string> = {};
    for (const sec of visibleSections) {
      for (const f of sec.fields || []) {
        if (!fieldVisible(sec, f, type)) continue;
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
      const res = await crmPost<{ id: number }>("/api/opportunities", payload);
      const oppId = res.data?.id;
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
      localStorage.removeItem(DRAFT_KEY);
      notify("Opportunity created");
      onCreated?.();
      onClose();
    } catch (e: any) {
      const msg = e?.message || "Failed to create opportunity";
      setError(msg);
      notify(msg, "err");
    } finally { setBusy(false); }
  };

  const saveDraft = () => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(serializeForDraft(state, attachments))); notify("Draft saved"); }
    catch { notify("Could not save draft", "err"); }
  };
  const reset = () => {
    localStorage.removeItem(DRAFT_KEY);
    setState({ ...emptyState(), isLoaded: true });
    setAttachments([]);
    setErrors({});
  };

  const progress = requiredProgress(state);

  // ---- render --------------------------------------------------------------
  const header = (
    <div className="w-full">
      <div className="mb-2 flex items-center gap-3">
        <span className="text-display text-base font-bold text-primary">New Opportunity</span>
        <span className="text-xs text-muted">{progress}% complete</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <motion.div className="h-full rounded-full bg-brand-500" animate={{ width: `${progress}%` }}
          transition={reduce ? { duration: 0 } : { duration: motionTok.panel, ease: motionTok.easeOut }} />
      </div>
    </div>
  );

  const footer = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button type="button" className={btnSecondary} onClick={reset} disabled={busy}>Reset</button>
      <button type="button" className={btnSecondary} onClick={saveDraft} disabled={busy}>Save as Draft</button>
      <button type="button" className={btnPrimary} onClick={submit} disabled={busy}>{busy ? "Submitting…" : "Submit"}</button>
    </div>
  );

  const StatusIcon = ({ st }: { st: ReturnType<typeof sectionStatus> }) =>
    st === "complete" ? <CheckCircle2 size={14} className="text-success" />
    : st === "error" ? <AlertCircle size={14} className="text-danger" />
    : st === "partial" ? <Circle size={14} className="text-brand-500" />
    : <Circle size={14} className="text-muted" />;

  return (
    <>
    <Modal title={header} onClose={onClose} fullScreen footer={footer}>
      {toast}
      {error && <div className="mb-3"><ErrorBox error={error} /></div>}
      <div className="flex flex-col gap-6 xl:flex-row">
        {/* Section nav — horizontal scrolling chips below xl, sticky vertical rail from xl. */}
        <nav aria-label="Form sections" className="shrink-0 xl:w-60">
          <ul className="flex gap-1 overflow-x-auto pb-1 xl:sticky xl:top-0 xl:block xl:space-y-1 xl:overflow-x-visible xl:pb-0">
            {visibleSections.map((s) => {
              const st = sectionStatus(s.key);
              return (
                <li key={s.key} className="shrink-0 xl:shrink">
                  <button
                    onClick={() => scrollTo(s.key)}
                    className={`flex w-full items-center gap-2 whitespace-nowrap rounded-control px-2.5 py-1.5 text-left text-sm font-semibold transition-colors ${
                      active === s.key ? "bg-surface-2 text-primary" : "text-muted hover:text-primary"
                    }`}
                  >
                    <StatusIcon st={st} /> {s.title}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Sections */}
        <div ref={bodyRef} className="min-w-0 flex-1 space-y-6">
          <AnimatePresence initial={false}>
            {visibleSections.map((s) => (
              <motion.section
                key={s.key} id={`sec-${s.key}`}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                transition={{ duration: motionTok.panel, ease: motionTok.easeOut }}
                className="rounded-card border border-subtle bg-surface-1 p-6 shadow-raised"
              >
                <h3 className="fx-hairline-b mb-4 pb-3 text-sm font-bold uppercase tracking-wide text-secondary">{s.title}</h3>
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
                  <ActivityLogSection />
                ) : (
                  <SectionFields
                    section={s} type={type} values={state.core} details={details} errors={errors}
                    options={options} nextFieldKey={nextField} strictSequential={STRICT_SEQUENTIAL_MODE} flashKeys={flash}
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
                      if (kind === "role") {
                        const raw = window.prompt("Add a custom role (e.g. Lead Engineer)");
                        const name = (raw || "").trim();
                        if (!name) return;
                        const existing = [...ROLE_OPTIONS, ...customRoles]
                          .find((r) => r.value.toLowerCase() === name.toLowerCase());
                        if (existing) {
                          setState((s) => setDetail(s, "tm_role", existing.value));
                          notify(`Role "${existing.label}" selected`);
                          return;
                        }
                        setCustomRoles((prev) => [...prev, { value: name, label: name }]);
                        setState((s) => setDetail(s, "tm_role", name));
                        notify(`Role "${name}" added`);
                      }
                    }}
                  />
                )}
              </motion.section>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </Modal>
    {/* Inline customer creation — layered ABOVE, opportunity form stays mounted. */}
    {addCustomer && (
      <CustomerFormModal
        onClose={() => setAddCustomer(false)}
        onSaved={onCustomerCreated}
        notify={notify}
      />
    )}
    </>
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
function ActivityLogSection() {
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
          <tr className={tableRow}>
            <td colSpan={cols.length} className={`${tdCls} py-8 text-center text-sm text-muted`}>
              Activity history will appear after the opportunity is saved
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------ table section */
/** Editable skill-evaluation table driven by a schema table section. */
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
