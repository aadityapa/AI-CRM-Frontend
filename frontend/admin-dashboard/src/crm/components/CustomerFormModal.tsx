/**
 * Full-screen New / Edit Customer wizard — same chrome as New Opportunity:
 * left step rail, one section per step, Previous + Next both bottom-right.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Building2, MapPin, GitBranch, FileText, CalendarDays, Plus, Trash2, Upload,
} from "lucide-react";
import { crmGet, crmPost, crmPut, crmUpload, crmDelete } from "../api";
import { Field, Modal, btnSecondary, inputCls } from "./ui";
import { motion as motionTok } from "../../design-system/tokens/tokens";
import { customerTypeOptionsForPo, normalizeCustomerType } from "../lib/customerType";
import {
  CONTACT_ROLES, COUNTRIES, DEFAULT_COUNTRY, INDIAN_CITIES, INDIAN_STATES,
} from "../constants/geo";
import { normalizePhoneForSave } from "../lib/phone";
import {
  LeaveBillingPolicySection,
  numOrNull as leaveNumOrNull,
  type LeaveRow,
  type LeaveType,
} from "./ProjectPolicySections";
import { SearchableSelect, optionsFromStrings } from "./SearchableSelect";
import {
  WizardTopBar,
  WizardStepper,
  WizardStepHeader,
  WizardStepProgress,
  WizardFooter,
  sectionHelper,
  WizardAurora,
  type WizardStep,
  type StepStatus,
} from "./WizardChrome";

type ContactRoleMaster = { id: number; name: string; is_active?: boolean };

export type CustomerFormCustomer = {
  id: number;
  name: string;
  legal_entity_name?: string | null;
  status: string;
  customer_type?: string | null;
};

type Notify = (msg: string, kind?: "ok" | "err") => void;

type DocType = { id: number; name: string; is_active: boolean };

/** One Person card under Branch contacts (name / email / phone / role). */
type BranchContactRow = {
  key: string;
  contact_person_id?: number;
  contact_person_name: string;
  contact_person_email: string;
  contact_person_phone: string;
  role: string;
  /** Preserved on edit so Opportunity HM dropdown still works. */
  is_hiring_manager: boolean;
};

type BranchRow = {
  key: string;
  id?: number;
  branch_name: string;
  branch_legal_name: string;
  billing_address: string;
  address_line_2: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  gstin: string;
  pan: string;
  is_primary: boolean;
  contact_rows: BranchContactRow[];
};

type ContactRow = {
  id: number;
  branch_id?: number | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  is_hiring_manager?: boolean;
};

type DocRow = {
  key: string;
  id?: number;
  document_type_id: string;
  file: File | null;
  file_name: string;
  start_date: string;
  end_date: string;
  status: string;
};

const uid = () => Math.random().toString(36).slice(2, 11);
const CUSTOMER_STATUSES = ["Active", "Inactive"];
const DOC_STATUSES = ["Active", "Inactive", "Expired"];

const emptyContactRow = (hm = false): BranchContactRow => ({
  key: uid(),
  contact_person_name: "",
  contact_person_email: "",
  contact_person_phone: "",
  role: "",
  is_hiring_manager: hm,
});

/** Default one contact card under each branch. */
const defaultContactRows = (): BranchContactRow[] => [emptyContactRow()];

const emptyBranch = (primary = false): BranchRow => ({
  key: uid(),
  branch_name: "",
  branch_legal_name: "",
  billing_address: "",
  address_line_2: "",
  city: "",
  state: "",
  pincode: "",
  country: DEFAULT_COUNTRY,
  gstin: "",
  pan: "",
  is_primary: primary,
  contact_rows: defaultContactRows(),
});

function contactsToRows(branchContacts: ContactRow[]): BranchContactRow[] {
  if (!branchContacts.length) return defaultContactRows();
  const rows: BranchContactRow[] = branchContacts.map((c) => ({
    key: uid(),
    contact_person_id: c.id,
    contact_person_name: c.name || "",
    contact_person_email: c.email || "",
    contact_person_phone: c.phone || "",
    role: c.role || "",
    is_hiring_manager: !!c.is_hiring_manager,
  }));
  // Keep at least one contact slot visible.
  while (rows.length < 1) rows.push(emptyContactRow());
  return rows;
}

function branchFromApi(b: Record<string, unknown>, contacts: ContactRow[]): BranchRow {
  const branchId = Number(b.id);
  const branchContacts = contacts.filter((c) => c.branch_id === branchId);
  return {
    key: uid(),
    id: branchId,
    branch_name: String(b.branch_name || ""),
    branch_legal_name: String(b.branch_legal_name || ""),
    billing_address: String(b.billing_address || ""),
    address_line_2: String(b.address_line_2 || ""),
    city: String(b.city || ""),
    state: String(b.state || ""),
    pincode: String(b.pincode || ""),
    country: String(b.country || DEFAULT_COUNTRY),
    gstin: String(b.gstin || ""),
    pan: String(b.pan || ""),
    is_primary: !!b.is_primary,
    contact_rows: contactsToRows(branchContacts),
  };
}

function isDocExpired(endDate: string): boolean {
  if (!endDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(`${endDate}T00:00:00`);
  return !Number.isNaN(end.getTime()) && end <= today;
}

function docDisplayStatus(d: DocRow): string {
  return isDocExpired(d.end_date) ? "Expired" : d.status;
}

const emptyDoc = (): DocRow => ({
  key: uid(),
  document_type_id: "",
  file: null,
  file_name: "",
  start_date: "",
  end_date: "",
  status: "Active",
});

type SectionKey =
  | "customerDetails"
  | "address"
  | "branches"
  | "documents"
  | "billingPolicy";

const FORM_SECTIONS: { key: SectionKey; title: string; icon: React.ReactNode }[] = [
  { key: "customerDetails", title: "Customer Details", icon: <Building2 size={18} /> },
  { key: "address", title: "Address", icon: <MapPin size={18} /> },
  { key: "branches", title: "Branch", icon: <GitBranch size={18} /> },
  { key: "documents", title: "Documents", icon: <FileText size={18} /> },
  { key: "billingPolicy", title: "Leave & Holiday Billing", icon: <CalendarDays size={18} /> },
];

const chk = "h-4 w-4 rounded border-subtle accent-brand-600";
const thCls =
  "whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-muted";
const tdCls = "px-3 py-2 align-top";
const tableWrap = "overflow-x-auto rounded-control border border-subtle";
const tableHead = "bg-surface-2";
const tableRow = "border-t border-subtle";

function numOrNull(v: string) {
  return v === "" || v == null ? null : Number(v);
}

function customerLeavePayload(row: LeaveRow, customerId: number) {
  return {
    customer_id: customerId,
    branch_id: null,
    leave_type_id: Number(row.leave_type_id),
    leave_credit_type: row.leave_credit_type,
    leave_credit_balance: leaveNumOrNull(row.leave_credit_balance) ?? 0,
    initial_credit_balance: leaveNumOrNull(row.initial_credit_balance) ?? 0,
    leave_expire: row.leave_expire || null,
    is_max_limit: row.is_max_limit,
    maximum_carry_forward: leaveNumOrNull(row.maximum_carry_forward) ?? 0,
    effective_date: row.effective_date || null,
    leave_credit_timing: "Start_Of_Period",
    is_billable: true,
  };
}

function apiToLeaveRow(r: Record<string, unknown>): LeaveRow {
  return {
    key: uid(),
    id: r.id != null ? Number(r.id) : undefined,
    leave_type_id: r.leave_type_id != null ? String(r.leave_type_id) : "",
    name: String(r.leave_type_name || r.name || ""),
    leave_credit_type: String(r.leave_credit_type || ""),
    leave_credit_balance: r.leave_credit_balance != null ? String(r.leave_credit_balance) : "",
    initial_credit_balance: r.initial_credit_balance != null ? String(r.initial_credit_balance) : "",
    leave_expire: String(r.leave_expire || ""),
    is_max_limit: !!r.is_max_limit,
    maximum_carry_forward: r.maximum_carry_forward != null ? String(r.maximum_carry_forward) : "0",
    effective_date: r.effective_date ? String(r.effective_date).slice(0, 10) : "",
  };
}

export function CustomerFormModal({
  initial,
  onClose,
  onSaved,
  notify,
}: {
  initial?: CustomerFormCustomer;
  onClose: () => void;
  onSaved: (c: CustomerFormCustomer) => void;
  notify: Notify;
}) {
  const reduce = useReducedMotion();
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [stepDir, setStepDir] = useState(1);
  const init = (initial || {}) as Record<string, unknown>;
  const [f, setF] = useState({
    name: initial?.name || "",
    legal: initial?.legal_entity_name || "",
    customer_type: String(init.customer_type || "NN"),
    status: initial?.status || "Active",
    address_line_1: String(init.address_line_1 || ""),
    address_line_2: String(init.address_line_2 || ""),
    city: String(init.city || ""),
    state: String(init.state || ""),
    pincode: String(init.pincode || ""),
    country: String(init.country || DEFAULT_COUNTRY),
  });
  const [branches, setBranches] = useState<BranchRow[]>([emptyBranch(true)]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [docTypes, setDocTypes] = useState<DocType[]>([]);
  const [contactRoles, setContactRoles] = useState<ContactRoleMaster[]>([]);
  const [addingRole, setAddingRole] = useState(false);
  const [pol, setPol] = useState<Record<string, unknown>>({
    week_off_billable: false,
    leave_billable: false,
    holidays_billable: false,
    min_hours_full_day: 8,
    min_hours_half_day: 4,
    comp_off_billable: false,
    comp_off_balance: "",
    comp_off_balance_initial: "",
    comp_off_max_limit: "",
    comp_off_max_carry_forward: "",
    normal_hours_per_day: "",
    user_role: "",
    operation: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [hasPo, setHasPo] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveRows, setLeaveRows] = useState<LeaveRow[]>([]);
  const [removedLeaveIds, setRemovedLeaveIds] = useState<number[]>([]);
  const [addingType, setAddingType] = useState(false);

  const setField = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const setPolicy = (k: string, v: unknown) => setPol((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    crmGet<DocType[]>("/api/document-types?limit=200&is_active=true")
      .then((r) => setDocTypes((r.data || []).filter((d) => d.is_active !== false)))
      .catch(() => {});
    crmGet<LeaveType[]>("/api/leave-policy-types?limit=100")
      .then((r) => setLeaveTypes(r.data || []))
      .catch(() => {});
    crmGet<ContactRoleMaster[]>("/api/contact-roles?limit=200&is_active=true")
      .then((r) => setContactRoles((r.data || []).filter((d) => d.is_active !== false)))
      .catch(() => {});
  }, []);

  const contactRoleOptions = useMemo(() => {
    const names = new Set<string>();
    const opts: { value: string; label: string }[] = [];
    for (const seed of CONTACT_ROLES) {
      if (!names.has(seed.toLowerCase())) {
        names.add(seed.toLowerCase());
        opts.push({ value: seed, label: seed });
      }
    }
    for (const row of contactRoles) {
      const n = (row.name || "").trim();
      if (!n || names.has(n.toLowerCase())) continue;
      names.add(n.toLowerCase());
      opts.push({ value: n, label: n });
    }
    return opts.sort((a, b) => a.label.localeCompare(b.label));
  }, [contactRoles]);

  useEffect(() => {
    if (!initial?.id) return;
    const id = initial.id;
    Promise.all([
      crmGet<Record<string, unknown>>(`/api/customers/${id}`),
      crmGet<Record<string, unknown> | null>(`/api/customers/${id}/billing-policy`),
      crmGet<BranchRow[]>(`/api/customers/${id}/branches`),
      crmGet<ContactRow[]>(`/api/customers/${id}/contacts`),
      crmGet<Record<string, unknown>[]>(`/api/customer-leave-policies?customer_id=${id}&limit=200`),
    ])
      .then(([cust, polRes, brRes, ctRes, leaveRes]) => {
        const c = cust.data || {};
        setHasPo(!!c.has_po);
        setF((s) => ({
          ...s,
          name: String(c.name || s.name),
          legal: String(c.legal_entity_name || ""),
          customer_type: normalizeCustomerType(!!c.has_po, String(c.customer_type || "NN")),
          status: String(c.status || "Active"),
          address_line_1: String(c.address_line_1 || ""),
          address_line_2: String(c.address_line_2 || ""),
          city: String(c.city || ""),
          state: String(c.state || ""),
          pincode: String(c.pincode || ""),
          country: String(c.country || DEFAULT_COUNTRY),
        }));
        const p = polRes.data;
        if (p) {
          setPol((prev) => ({
            ...prev,
            ...Object.fromEntries(
              Object.entries(p).map(([k, v]) => [k, v === null ? "" : v]),
            ),
          }));
        }
        const brs = (brRes.data || []) as Array<Record<string, unknown>>;
        const contacts = (ctRes.data || []) as ContactRow[];
        if (brs.length) {
          setBranches(brs.map((b) => branchFromApi(b, contacts)));
        }
        // Customer-level leave policies only (branch_id null) — same form as Project Leave Billing Policy.
        const leaveAll = (leaveRes.data || []) as Record<string, unknown>[];
        setLeaveRows(
          leaveAll
            .filter((r) => r.branch_id == null)
            .map(apiToLeaveRow),
        );
        setRemovedLeaveIds([]);
      })
      .catch(() => {});
  }, [initial?.id]);

  const validBranches = useMemo(
    () => branches.filter((b) => b.branch_name.trim()),
    [branches],
  );

  const totalSteps = FORM_SECTIONS.length;
  const clampedStep = Math.min(Math.max(stepIndex, 0), Math.max(totalSteps - 1, 0));
  const currentSection = FORM_SECTIONS[clampedStep];
  const isFirstStep = clampedStep === 0;
  const isLastStep = clampedStep === totalSteps - 1;
  const stepPct = totalSteps ? Math.round(((clampedStep + 1) / totalSteps) * 100) : 0;

  const sectionStatus = (key: SectionKey): StepStatus => {
    switch (key) {
      case "customerDetails":
        if (errors.name || errors.legal) return "error";
        if (f.name.trim() && f.legal.trim()) return "complete";
        if (f.name.trim() || f.legal.trim()) return "partial";
        return "empty";
      case "address":
        if (errors.address_line_1) return "error";
        if (f.address_line_1.trim() && f.city.trim() && f.state.trim()) return "complete";
        if (f.address_line_1.trim() || f.city.trim()) return "partial";
        return "empty";
      case "branches":
        if (errors.branches) return "error";
        return validBranches.length ? "complete" : branches.some((b) => b.branch_name) ? "partial" : "empty";
      case "documents":
        if (!docs.length) return "empty";
        return docs.every((d) => d.document_type_id && d.file) ? "complete" : "partial";
      case "billingPolicy": {
        const leaveBad = leaveRows.some(
          (r) => r.leave_type_id && (!r.leave_credit_type || !r.leave_expire),
        );
        if (leaveBad || Object.keys(errors).some((k) => k.startsWith("leave_"))) return "error";
        const leaveDone = !!(
          pol.week_off_billable || pol.leave_billable || pol.holidays_billable
          || leaveRows.some((r) => r.leave_type_id)
        );
        const compDone = !!pol.comp_off_billable;
        const compPartial = !!(
          !pol.comp_off_billable
          && (pol.comp_off_balance || pol.comp_off_balance_initial
            || pol.comp_off_max_limit || pol.comp_off_max_carry_forward)
        );
        const attDone = !!(pol.normal_hours_per_day || pol.min_hours_full_day || pol.min_hours_half_day);
        // Merged step complete only when all three groups are complete.
        if (leaveDone && compDone && attDone) return "complete";
        if (leaveDone || compDone || compPartial || !!pol.normal_hours_per_day) return "partial";
        return "empty";
      }
      default:
        return "empty";
    }
  };

  const wizardSteps: WizardStep[] = useMemo(
    () => FORM_SECTIONS.map((s) => ({
      key: s.key,
      title: s.title,
      sublabel: sectionHelper(s.key).split(".")[0],
      status: sectionStatus(s.key),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [f, branches, docs, pol, leaveRows, errors, validBranches, contactRoles],
  );

  const stepCompletePct = (() => {
    if (!currentSection) return 0;
    const st = sectionStatus(currentSection.key);
    if (st === "complete") return 100;
    if (st === "partial") return 55;
    if (st === "error") return 30;
    return 0;
  })();

  useEffect(() => {
    stepHeadingRef.current?.focus({ preventScroll: true });
  }, [clampedStep]);

  const resetForm = () => {
    setF({
      name: "",
      legal: "",
      customer_type: "NN",
      status: "Active",
      address_line_1: "",
      address_line_2: "",
      city: "",
      state: "",
      pincode: "",
      country: DEFAULT_COUNTRY,
    });
    setBranches([emptyBranch(true)]);
    setDocs([]);
    setLeaveRows([]);
    setRemovedLeaveIds([]);
    setPol({
      week_off_billable: false,
      leave_billable: false,
      holidays_billable: false,
      min_hours_full_day: 8,
      min_hours_half_day: 4,
      comp_off_billable: false,
      comp_off_balance: "",
      comp_off_balance_initial: "",
      comp_off_max_limit: "",
      comp_off_max_carry_forward: "",
      normal_hours_per_day: "",
      user_role: "",
      operation: "",
    });
    setErrors({});
    setStepIndex(0);
    setMaxReached(0);
  };

  const validateSection = (key: SectionKey, opts?: { silent?: boolean }): boolean => {
    const errs: Record<string, string> = { ...errors };
    const clear = (...ks: string[]) => { for (const k of ks) delete errs[k]; };

    if (key === "customerDetails") {
      clear("name", "legal");
      if (!f.name.trim()) errs.name = "Customer name is required";
      if (!f.legal.trim()) errs.legal = "Legal business name is required";
    }
    if (key === "address") {
      clear("address_line_1");
      if (!f.address_line_1.trim()) errs.address_line_1 = "Address line 1 is required";
    }
    if (key === "branches") {
      clear("branches");
      if (!validBranches.length) errs.branches = "At least one branch is required";
      validBranches.forEach((b, i) => {
        clear(`branch_gstin_${i}`, `branch_pan_${i}`);
        if (b.gstin && b.gstin.length > 15) errs[`branch_gstin_${i}`] = "GSTIN max 15 chars";
        if (b.pan && b.pan.length > 10) errs[`branch_pan_${i}`] = "PAN max 10 chars";
      });
    }

    setErrors(errs);
    const blocking = Object.keys(errs).filter((k) => {
      if (key === "customerDetails") return k === "name" || k === "legal";
      if (key === "address") return k === "address_line_1";
      if (key === "branches") return k === "branches" || k.startsWith("branch_");
      return false;
    });
    if (blocking.length) {
      if (!opts?.silent) notify("Please fix the highlighted fields", "err");
      return false;
    }
    return true;
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!f.name.trim()) errs.name = "Customer name is required";
    if (!f.legal.trim()) errs.legal = "Legal business name is required";
    if (!f.address_line_1.trim()) errs.address_line_1 = "Address line 1 is required";
    if (!validBranches.length) errs.branches = "At least one branch is required";
    validBranches.forEach((b, i) => {
      if (b.gstin && b.gstin.length > 15) errs[`branch_gstin_${i}`] = "GSTIN max 15 chars";
      if (b.pan && b.pan.length > 10) errs[`branch_pan_${i}`] = "PAN max 10 chars";
    });
    setErrors(errs);
    if (Object.keys(errs).length) {
      notify("Please fix the highlighted fields", "err");
      // Jump to the first step that has blocking errors
      if (errs.name || errs.legal) { setStepIndex(0); setMaxReached((m) => Math.max(m, 0)); }
      else if (errs.address_line_1) { setStepIndex(1); setMaxReached((m) => Math.max(m, 1)); }
      else { setStepIndex(2); setMaxReached((m) => Math.max(m, 2)); }
      return false;
    }
    return true;
  };

  const goToStep = (index: number) => {
    if (index > maxReached) return;
    setStepDir(index > clampedStep ? 1 : -1);
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
    const next = Math.min(clampedStep + 1, totalSteps - 1);
    setStepDir(1);
    setStepIndex(next);
    setMaxReached((m) => Math.max(m, next));
  };

  const saveBranchContacts = async (customerId: number, branchId: number, b: BranchRow) => {
    const sync = async (
      existingId: number | undefined,
      payload: {
        name: string;
        email: string | null;
        phone: string | null;
        role: string | null;
        is_hiring_manager: boolean;
      },
    ): Promise<number | undefined> => {
      if (!payload.name.trim()) {
        if (existingId) {
          try { await crmDelete(`/api/customers/${customerId}/contacts/${existingId}`); } catch { /* ignore */ }
        }
        return undefined;
      }
      const body = {
        name: payload.name.trim(),
        email: payload.email?.trim() || null,
        phone: normalizePhoneForSave(payload.phone) || null,
        role: payload.role?.trim() || null,
        branch_id: branchId,
        is_hiring_manager: payload.is_hiring_manager,
        is_active: true,
      };
      if (existingId) {
        await crmPut(`/api/customers/${customerId}/contacts/${existingId}`, body);
        return existingId;
      }
      const res = await crmPost<{ id: number }>(`/api/customers/${customerId}/contacts`, body);
      return res.data?.id;
    };
    const kept = new Set<number>();
    for (const row of b.contact_rows) {
      const id = await sync(row.contact_person_id, {
        name: row.contact_person_name,
        email: row.contact_person_email || null,
        phone: row.contact_person_phone || null,
        role: row.role || null,
        is_hiring_manager: row.is_hiring_manager,
      });
      if (id) kept.add(id);
    }
    if (b.id) {
      try {
        const listed = await crmGet<ContactRow[]>(`/api/customers/${customerId}/contacts?branch_id=${branchId}`);
        for (const c of listed.data || []) {
          if (!kept.has(c.id)) {
            await crmDelete(`/api/customers/${customerId}/contacts/${c.id}`);
          }
        }
      } catch { /* ignore */ }
    }
  };

  const saveLeavePolicies = async (customerId: number) => {
    for (const rid of removedLeaveIds) {
      try { await crmDelete(`/api/customer-leave-policies/${rid}`); } catch { /* ignore */ }
    }
    for (const row of leaveRows) {
      if (!row.leave_type_id || !row.leave_credit_type || !row.leave_expire) continue;
      const payload = customerLeavePayload(row, customerId);
      if (row.id) {
        const { customer_id: _cid, ...updateBody } = payload;
        await crmPut(`/api/customer-leave-policies/${row.id}`, updateBody);
      } else {
        await crmPost("/api/customer-leave-policies", payload);
      }
    }
  };

  const saveLeaveRow = async (row: LeaveRow) => {
    let saved: LeaveRow = { ...row };
    if (initial?.id && row.leave_type_id && row.leave_credit_type && row.leave_expire) {
      const payload = customerLeavePayload(row, initial.id);
      if (row.id) {
        const { customer_id: _cid, ...updateBody } = payload;
        await crmPut(`/api/customer-leave-policies/${row.id}`, updateBody);
      } else {
        const res = await crmPost<Record<string, unknown>>("/api/customer-leave-policies", payload);
        const newId = res.data?.id != null ? Number(res.data.id) : undefined;
        if (newId) saved = { ...saved, id: newId };
      }
    }
    setLeaveRows((rows) => {
      const has = rows.some((r) => r.key === saved.key);
      if (has) return rows.map((r) => (r.key === saved.key ? saved : r));
      return [...rows, saved];
    });
  };

  const deleteLeaveRow = async (row: LeaveRow) => {
    if (row.id) {
      if (initial?.id) {
        try {
          await crmDelete(`/api/customer-leave-policies/${row.id}`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Failed to delete leave policy";
          notify(msg, "err");
          throw err;
        }
      } else {
        setRemovedLeaveIds((ids) => [...ids, row.id!]);
      }
    }
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to add leave type";
      notify(msg, "err");
      return null;
    } finally {
      setAddingType(false);
    }
  };

  const addContactRole = async (name: string): Promise<ContactRoleMaster | null> => {
    const q = name.trim();
    if (!q) {
      notify("Enter a role name to add", "err");
      return null;
    }
    const existing = contactRoleOptions.find(
      (o) => o.value.toLowerCase() === q.toLowerCase() || o.label.toLowerCase() === q.toLowerCase(),
    );
    if (existing) return { id: 0, name: existing.value, is_active: true };
    setAddingRole(true);
    try {
      const res = await crmPost<ContactRoleMaster>("/api/contact-roles", { name: q, is_active: true });
      const row = res.data;
      setContactRoles((prev) => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)));
      return row;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to add contact role";
      notify(msg, "err");
      return null;
    } finally {
      setAddingRole(false);
    }
  };

  const saveBranches = async (customerId: number) => {
    let primarySet = false;
    for (const b of validBranches) {
      const payload = {
        branch_name: b.branch_name.trim(),
        branch_legal_name: b.branch_legal_name.trim() || null,
        billing_address: b.billing_address.trim() || null,
        address_line_2: b.address_line_2.trim() || null,
        city: b.city.trim() || null,
        state: b.state.trim() || null,
        pincode: b.pincode.trim() || null,
        country: b.country.trim() || null,
        gstin: b.gstin.trim() || null,
        pan: b.pan.trim() || null,
        is_primary: !primarySet && (b.is_primary || validBranches.length === 1),
      };
      if (payload.is_primary) primarySet = true;
      let branchId = b.id;
      if (b.id) {
        await crmPut(`/api/customers/${customerId}/branches/${b.id}`, payload);
      } else {
        const res = await crmPost<{ id: number }>(`/api/customers/${customerId}/branches`, payload);
        branchId = res.data?.id;
      }
      if (branchId) await saveBranchContacts(customerId, branchId, b);
    }
  };

  const saveDocuments = async (customerId: number) => {
    for (const d of docs) {
      if (!d.file || !d.document_type_id) continue;
      const status = docDisplayStatus(d);
      const fields: Record<string, string> = {
        document_type_id: d.document_type_id,
        status,
      };
      if (d.start_date) fields.start_date = d.start_date;
      if (d.end_date) fields.end_date = d.end_date;
      await crmUpload(`/api/customers/${customerId}/documents`, d.file, fields);
    }
  };

  const submit = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const custPayload = {
        name: f.name.trim(),
        legal_entity_name: f.legal.trim() || null,
        customer_type: normalizeCustomerType(hasPo, f.customer_type),
        status: f.status,
        address_line_1: f.address_line_1.trim() || null,
        address_line_2: f.address_line_2.trim() || null,
        city: f.city.trim() || null,
        state: f.state.trim() || null,
        pincode: f.pincode.trim() || null,
        country: f.country.trim() || null,
      };
      const compOn = !!pol.comp_off_billable;
      const polPayload = {
        week_off_billable: !!pol.week_off_billable,
        leave_billable: !!pol.leave_billable,
        holidays_billable: !!pol.holidays_billable,
        min_hours_full_day: Number(pol.min_hours_full_day) || 8,
        min_hours_half_day: Number(pol.min_hours_half_day) || 4,
        comp_off_billable: compOn,
        comp_off_balance: compOn ? numOrNull(String(pol.comp_off_balance)) : null,
        comp_off_balance_initial: compOn ? numOrNull(String(pol.comp_off_balance_initial)) : null,
        comp_off_max_limit: compOn ? numOrNull(String(pol.comp_off_max_limit)) : null,
        comp_off_max_carry_forward: compOn ? numOrNull(String(pol.comp_off_max_carry_forward)) : null,
        normal_hours_per_day: numOrNull(String(pol.normal_hours_per_day)),
        user_role: String(pol.user_role || "").trim() || null,
        operation: String(pol.operation || "").trim() || null,
      };

      const res = initial
        ? await crmPut<CustomerFormCustomer>(`/api/customers/${initial.id}`, custPayload)
        : await crmPost<CustomerFormCustomer>("/api/customers", custPayload);
      const customer = res.data;
      const id = customer?.id ?? initial?.id;
      if (!id) throw new Error("Customer id missing after save");

      await crmPut(`/api/customers/${id}/billing-policy`, polPayload);
      await saveBranches(id);
      await saveDocuments(id);
      await saveLeavePolicies(id);

      notify(res.message || (initial ? "Customer updated" : "Customer created"));
      onSaved(customer);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save customer";
      notify(msg, "err");
    } finally {
      setSaving(false);
    }
  };

  const updateBranch = (key: string, patch: Partial<BranchRow>) => {
    setBranches((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const updateBranchContact = (branchKey: string, contactKey: string, patch: Partial<BranchContactRow>) => {
    setBranches((rows) => rows.map((b) => (
      b.key !== branchKey
        ? b
        : { ...b, contact_rows: b.contact_rows.map((cr) => (cr.key === contactKey ? { ...cr, ...patch } : cr)) }
    )));
  };

  const addBranchContact = (branchKey: string) => {
    setBranches((rows) => rows.map((b) => (
      b.key !== branchKey ? b : { ...b, contact_rows: [...b.contact_rows, emptyContactRow()] }
    )));
  };

  const removeBranchContact = (branchKey: string, contactKey: string) => {
    setBranches((rows) => rows.map((b) => {
      if (b.key !== branchKey) return b;
      const next = b.contact_rows.filter((cr) => cr.key !== contactKey);
      // Always keep at least one contact slot.
      while (next.length < 1) next.push(emptyContactRow());
      return { ...b, contact_rows: next };
    }));
  };

  const updateDoc = (key: string, patch: Partial<DocRow>) => {
    setDocs((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const header = (
    <WizardTopBar
      title={initial ? `Edit Customer — ${initial.name}` : "New Customer"}
      stepIndex={clampedStep}
      totalSteps={totalSteps}
      stepPct={stepPct}
      onReset={resetForm}
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
      submitLabel={initial ? "Save changes" : "Create Customer"}
      submitBusyLabel="Saving…"
    />
  );

  const renderStepBody = () => {
    if (!currentSection) return null;
    switch (currentSection.key) {
      case "customerDetails":
        return (
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            <Field label="Customer name" required error={errors.name}>
              <input className={inputCls} value={f.name} onChange={(e) => setField("name", e.target.value)} />
            </Field>
            <Field label="Legal business name" required error={errors.legal}>
              <input className={inputCls} value={f.legal} onChange={(e) => setField("legal", e.target.value)} />
            </Field>
            <Field label="Customer type">
              <select
                className={inputCls}
                value={normalizeCustomerType(hasPo, f.customer_type)}
                disabled={!hasPo}
                title={!hasPo ? "NN — locked until the customer has a purchase order" : undefined}
                onChange={(e) => setField("customer_type", e.target.value)}
              >
                {customerTypeOptionsForPo(hasPo).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {!hasPo && (
                <p className="mt-1 text-xs text-muted">No PO on record — type is NN until a purchase order exists.</p>
              )}
            </Field>
            <Field label="Status">
              <select className={inputCls} value={f.status} onChange={(e) => setField("status", e.target.value)}>
                {CUSTOMER_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>
        );
      case "address":
        return (
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            <Field label="Address line 1" required error={errors.address_line_1}>
              <input className={inputCls} value={f.address_line_1} onChange={(e) => setField("address_line_1", e.target.value)} />
            </Field>
            <Field label="Address line 2">
              <input className={inputCls} value={f.address_line_2} onChange={(e) => setField("address_line_2", e.target.value)} />
            </Field>
            <Field label="City / District">
              <SearchableSelect
                value={f.city}
                options={optionsFromStrings(INDIAN_CITIES)}
                allowAdd
                searchable
                placeholder="Search city…"
                onChange={(v) => setField("city", v)}
              />
            </Field>
            <Field label="State / Province">
              <SearchableSelect
                value={f.state}
                options={optionsFromStrings(INDIAN_STATES)}
                searchable
                placeholder="Search state…"
                onChange={(v) => setField("state", v)}
              />
            </Field>
            <Field label="Postal code">
              <input className={inputCls} value={f.pincode} onChange={(e) => setField("pincode", e.target.value)} />
            </Field>
            <Field label="Country">
              <SearchableSelect
                value={f.country || DEFAULT_COUNTRY}
                options={optionsFromStrings(COUNTRIES)}
                allowAdd
                searchable
                placeholder="Search country…"
                onChange={(v) => setField("country", v)}
              />
            </Field>
          </div>
        );
      case "branches":
        return (
          <>
            {errors.branches && (
              <p className="mb-3 text-xs text-danger">{errors.branches}</p>
            )}
            <div className="space-y-4">
              {branches.map((b, idx) => (
                <div key={b.key} className="rounded-control border border-subtle bg-surface-2/40 p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted">
                      Branch {idx + 1}{b.is_primary ? " · Primary" : ""}
                    </span>
                    {branches.length > 1 && (
                      <button
                        type="button"
                        className="rounded-control p-1.5 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                        onClick={() => setBranches((rows) => rows.filter((r) => r.key !== b.key))}
                        aria-label="Remove branch"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Branch name" required>
                      <input className={inputCls} value={b.branch_name} placeholder="Branch name"
                        onChange={(e) => updateBranch(b.key, { branch_name: e.target.value })} />
                    </Field>
                    <Field label="Branch legal name">
                      <input className={inputCls} value={b.branch_legal_name}
                        onChange={(e) => updateBranch(b.key, { branch_legal_name: e.target.value })} />
                    </Field>
                    <Field label="GSTIN">
                      <input className={inputCls} value={b.gstin} maxLength={15}
                        onChange={(e) => updateBranch(b.key, { gstin: e.target.value.toUpperCase() })} />
                    </Field>
                    <Field label="PAN">
                      <input className={inputCls} value={b.pan} maxLength={10}
                        onChange={(e) => updateBranch(b.key, { pan: e.target.value.toUpperCase() })} />
                    </Field>
                  </div>
                  <div className="mt-3">
                    <Field label="Billing address">
                      <div className="grid gap-1.5">
                        <input className={inputCls} placeholder="Line 1" value={b.billing_address}
                          onChange={(e) => updateBranch(b.key, { billing_address: e.target.value })} />
                        <input className={inputCls} placeholder="Line 2" value={b.address_line_2}
                          onChange={(e) => updateBranch(b.key, { address_line_2: e.target.value })} />
                        <div className="grid grid-cols-2 gap-1.5">
                          <SearchableSelect
                            value={b.city}
                            options={optionsFromStrings(INDIAN_CITIES)}
                            allowAdd
                            searchable
                            placeholder="City / District"
                            onChange={(v) => updateBranch(b.key, { city: v })}
                          />
                          <SearchableSelect
                            value={b.state}
                            options={optionsFromStrings(INDIAN_STATES)}
                            searchable
                            placeholder="State"
                            onChange={(v) => updateBranch(b.key, { state: v })}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <input className={inputCls} placeholder="Postal" value={b.pincode}
                            onChange={(e) => updateBranch(b.key, { pincode: e.target.value })} />
                          <SearchableSelect
                            value={b.country || DEFAULT_COUNTRY}
                            options={optionsFromStrings(COUNTRIES)}
                            allowAdd
                            searchable
                            placeholder="Country"
                            onChange={(v) => updateBranch(b.key, { country: v })}
                          />
                        </div>
                      </div>
                    </Field>
                  </div>
                  <div className="mt-4 border-t border-subtle pt-4">
                    <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted">Branch contacts</p>
                    <div className="space-y-3">
                      {b.contact_rows.map((cr, cri) => (
                        <React.Fragment key={cr.key}>
                          <div className="rounded-control border border-subtle/80 bg-surface-1/60 p-3">
                            {b.contact_rows.length > 1 && (
                              <div className="mb-2 flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  className="rounded-control p-1 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                                  onClick={() => removeBranchContact(b.key, cr.key)}
                                  aria-label="Remove contact"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            )}
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                              <Field label="Contact Person">
                                <input
                                  className={inputCls}
                                  value={cr.contact_person_name}
                                  placeholder="Name"
                                  onChange={(e) => updateBranchContact(b.key, cr.key, { contact_person_name: e.target.value })}
                                />
                              </Field>
                              <Field label="Contact Person Email">
                                <input
                                  type="email"
                                  className={inputCls}
                                  value={cr.contact_person_email}
                                  placeholder="email@company.com"
                                  onChange={(e) => updateBranchContact(b.key, cr.key, { contact_person_email: e.target.value })}
                                />
                              </Field>
                              <Field label="Contact Phone">
                                <input
                                  type="tel"
                                  className={inputCls}
                                  value={cr.contact_person_phone}
                                  placeholder="+91 81234 56789"
                                  onChange={(e) => updateBranchContact(b.key, cr.key, { contact_person_phone: e.target.value })}
                                />
                              </Field>
                              <Field label="Role">
                                <SearchableSelect
                                  value={cr.role}
                                  options={contactRoleOptions}
                                  allowAdd
                                  searchable
                                  disabled={addingRole}
                                  addLabel="Add new role"
                                  placeholder="Search role…"
                                  onChange={(v) => updateBranchContact(b.key, cr.key, { role: v })}
                                  onOptionsChange={(next) => {
                                    const known = new Set(contactRoleOptions.map((o) => o.value.toLowerCase()));
                                    for (const o of next) {
                                      if (!known.has(o.value.toLowerCase())) {
                                        void addContactRole(o.value).then((row) => {
                                          if (row?.name) {
                                            updateBranchContact(b.key, cr.key, { role: row.name });
                                          }
                                        });
                                      }
                                    }
                                  }}
                                />
                              </Field>
                            </div>
                          </div>
                          {cri === 0 && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-control border border-subtle bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-500"
                              onClick={() => addBranchContact(b.key)}
                              aria-label="Add contact person"
                            >
                              <Plus size={14} /> Add contact
                            </button>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      These contacts appear in Opportunity / Requirement dropdowns when this branch is selected.
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className={`${btnSecondary} mt-3`}
              onClick={() => setBranches((rows) => [...rows, emptyBranch(false)])}
            >
              <Plus size={14} /> Add new branch
            </button>
          </>
        );
      case "documents":
        return (
          <>
            <div className={tableWrap}>
              <table className="min-w-[720px] w-full text-sm">
                <thead className={tableHead}>
                  <tr>
                    <th className={thCls}>Document name</th>
                    <th className={thCls}>Document</th>
                    <th className={thCls}>Start date</th>
                    <th className={thCls}>Expire Date</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls} />
                  </tr>
                </thead>
                <tbody>
                  {docs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted">
                        No documents added yet
                      </td>
                    </tr>
                  ) : (
                    docs.map((d) => (
                      <tr key={d.key} className={tableRow}>
                        <td className={tdCls}>
                          <select
                            className={inputCls}
                            value={d.document_type_id}
                            onChange={(e) => updateDoc(d.key, { document_type_id: e.target.value })}
                          >
                            <option value="">— Select —</option>
                            {docTypes.map((t) => (
                              <option key={t.id} value={String(t.id)}>{t.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className={tdCls}>
                          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-brand-600 dark:text-brand-400">
                            <Upload size={14} />
                            {d.file_name || "Select file"}
                            <input
                              type="file"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = "";
                                if (file) updateDoc(d.key, { file, file_name: file.name });
                              }}
                            />
                          </label>
                        </td>
                        <td className={tdCls}>
                          <input type="date" className={inputCls} value={d.start_date}
                            onChange={(e) => updateDoc(d.key, { start_date: e.target.value })} />
                        </td>
                        <td className={tdCls}>
                          <input
                            type="date"
                            className={inputCls}
                            value={d.end_date}
                            title="Document expires on this date"
                            onChange={(e) => {
                              const end_date = e.target.value;
                              updateDoc(d.key, {
                                end_date,
                                status: isDocExpired(end_date) ? "Expired" : (d.status === "Expired" ? "Active" : d.status),
                              });
                            }}
                          />
                          <p className="mt-1 text-[10px] text-muted">Document expires on this date</p>
                        </td>
                        <td className={tdCls}>
                          <select
                            className={inputCls}
                            value={docDisplayStatus(d)}
                            onChange={(e) => updateDoc(d.key, { status: e.target.value })}
                          >
                            {DOC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td className={tdCls}>
                          <button
                            type="button"
                            className="rounded-control p-1.5 text-muted transition-colors hover:text-danger"
                            onClick={() => setDocs((rows) => rows.filter((r) => r.key !== d.key))}
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
            <button type="button" className={`${btnSecondary} mt-3`} onClick={() => setDocs((rows) => [...rows, emptyDoc()])}>
              <Plus size={14} /> Add new document
            </button>
          </>
        );
      case "billingPolicy": {
        const compOn = !!pol.comp_off_billable;
        return (
          <div className="space-y-8">
            <div className="space-y-4">
              <div>
                <p className="text-sm font-bold text-primary">Leave & Holiday Billing</p>
                <p className="mt-0.5 text-xs text-muted">
                  Week-off / leave / holiday billability and per-leave-type credit rules.
                </p>
              </div>
              <div className="flex flex-wrap gap-5 rounded-xl border border-subtle bg-surface-2/30 px-4 py-3">
                {([
                  ["week_off_billable", "Week off billable"],
                  ["leave_billable", "Leave billable"],
                  ["holidays_billable", "Holidays billable"],
                ] as const).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2 text-sm font-medium text-primary">
                    <input type="checkbox" className={chk} checked={!!pol[k]}
                      onChange={(e) => setPolicy(k, e.target.checked)} />
                    {label}
                  </label>
                ))}
              </div>

              <div className="rounded-control border border-subtle bg-surface-2/20 p-4">
                <div className="mb-3">
                  <p className="text-sm font-bold text-primary">Leave Billing Policy</p>
                  <p className="mt-0.5 text-xs text-muted">
                    Per-leave-type credit and expiry rules for this customer (same as Project).
                  </p>
                </div>
                <LeaveBillingPolicySection
                  leaveRows={leaveRows}
                  leaveTypes={leaveTypes}
                  errors={errors}
                  addingType={addingType}
                  onSaveRow={(row) => saveLeaveRow(row)}
                  onDeleteRow={(row) => deleteLeaveRow(row)}
                  onAddType={addLeaveType}
                  emptyMessage="No leave policy rows yet for this customer."
                />
              </div>
            </div>

            <div className="space-y-4 border-t border-subtle pt-6">
              <div>
                <p className="text-sm font-bold text-primary">Comp Off</p>
                <p className="mt-0.5 text-xs text-muted">
                  Compensatory-off balance and carry-forward limits.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-primary">
                <input
                  type="checkbox"
                  className={chk}
                  checked={compOn}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setPol((s) => ({
                      ...s,
                      comp_off_billable: on,
                      ...(on ? {} : {
                        comp_off_balance: "",
                        comp_off_balance_initial: "",
                        comp_off_max_limit: "",
                        comp_off_max_carry_forward: "",
                      }),
                    }));
                  }}
                />
                Comp off billable
              </label>
              <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Comp off balance">
                  <input
                    type="number"
                    className={inputCls}
                    disabled={!compOn}
                    value={String(pol.comp_off_balance ?? "")}
                    onChange={(e) => setPolicy("comp_off_balance", e.target.value)}
                  />
                </Field>
                <Field label="Comp off balance initial">
                  <input
                    type="number"
                    className={inputCls}
                    disabled={!compOn}
                    value={String(pol.comp_off_balance_initial ?? "")}
                    onChange={(e) => setPolicy("comp_off_balance_initial", e.target.value)}
                  />
                </Field>
                <Field label="Comp off max limit">
                  <input
                    type="number"
                    className={inputCls}
                    disabled={!compOn}
                    value={String(pol.comp_off_max_limit ?? "")}
                    onChange={(e) => setPolicy("comp_off_max_limit", e.target.value)}
                  />
                </Field>
                <Field label="Comp off max carry forward">
                  <input
                    type="number"
                    className={inputCls}
                    disabled={!compOn}
                    value={String(pol.comp_off_max_carry_forward ?? "")}
                    onChange={(e) => setPolicy("comp_off_max_carry_forward", e.target.value)}
                  />
                </Field>
              </div>
            </div>

            <div className="space-y-4 border-t border-subtle pt-6">
              <div>
                <p className="text-sm font-bold text-primary">Attendance Rule</p>
                <p className="mt-0.5 text-xs text-muted">
                  Minimum hours for full-day and half-day attendance.
                </p>
              </div>
              <div className="grid gap-x-6 gap-y-5 sm:grid-cols-3">
                <Field label="Min hours for full day">
                  <input type="number" step="0.5" className={inputCls} value={String(pol.min_hours_full_day ?? "")}
                    onChange={(e) => setPolicy("min_hours_full_day", e.target.value)} />
                </Field>
                <Field label="Min hours for half day">
                  <input type="number" step="0.5" className={inputCls} value={String(pol.min_hours_half_day ?? "")}
                    onChange={(e) => setPolicy("min_hours_half_day", e.target.value)} />
                </Field>
                <Field label="Normal hours per day">
                  <input type="number" step="0.5" className={inputCls} value={String(pol.normal_hours_per_day ?? "")}
                    onChange={(e) => setPolicy("normal_hours_per_day", e.target.value)} />
                </Field>
              </div>
            </div>
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <Modal
      title={header}
      onClose={onClose}
      fullScreen
      footer={footer}
      bodyClassName="!overflow-hidden !p-0 sm:!px-0 sm:!py-0"
      scopeClassName="crm-wizard wiz-noise"
      panelClassName="wiz-moonlit-panel"
      headerClassName="wiz-moonlit-header"
      footerClassName="wiz-moonlit-footer"
    >
      <div className="wiz-moonlit-shell relative flex h-full min-h-0 flex-col">
        <WizardAurora />
        <div className="relative z-10 flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-subtle bg-surface-2/40 px-4 py-2.5 md:hidden">
          <WizardStepper
            steps={wizardSteps}
            currentIndex={clampedStep}
            maxReached={maxReached}
            onSelect={goToStep}
            orientation="horizontal"
            ariaLabel="Customer wizard steps"
          />
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-[260px] shrink-0 overflow-y-auto border-r border-subtle bg-surface-2/30 px-3 py-5 md:block lg:px-4">
            <WizardStepper
              steps={wizardSteps}
              currentIndex={clampedStep}
              maxReached={maxReached}
              onSelect={goToStep}
              orientation="vertical"
              ariaLabel="Customer wizard steps"
            />
            <WizardStepProgress pct={stepCompletePct} />
          </aside>

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-6 sm:py-6 lg:px-10 lg:py-8">
            <AnimatePresence mode="wait" initial={false}>
              {currentSection && (
                <motion.section
                  key={currentSection.key}
                  id={`cust-sec-${currentSection.key}`}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, x: stepDir * 28 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, x: stepDir * -28 }}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { duration: motionTok.panel, ease: motionTok.easeOut }
                  }
                  className="wiz-moonlit-form-card mx-auto max-w-5xl rounded-card border border-subtle bg-surface-1 px-5 py-6 shadow-raised sm:px-8 sm:py-8"
                >
                  <WizardStepHeader
                    title={currentSection.title}
                    description={sectionHelper(currentSection.key, currentSection.title)}
                    headingRef={stepHeadingRef}
                    icon={currentSection.icon}
                  />
                  {renderStepBody()}
                </motion.section>
              )}
            </AnimatePresence>
          </div>
        </div>
        </div>
      </div>
    </Modal>
  );
}
