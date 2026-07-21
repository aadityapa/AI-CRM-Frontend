/**
 * Full-screen New / Edit Customer form — matches the CRM spec layout:
 * customer details, address, branches (inline table), documents, billing policy,
 * comp-off, and attendance rules. Used from Customers list and New Opportunity (+).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Plus, Trash2, Upload, CheckCircle2, Circle, AlertCircle } from "lucide-react";
import { crmGet, crmPost, crmPut, crmUpload, crmDelete } from "../api";
import {
  Field, Modal, btnPrimary, btnSecondary, inputCls,
} from "./ui";
import { customerTypeOptionsForPo, normalizeCustomerType } from "../lib/customerType";
import { normalizePhoneForSave } from "../lib/phone";

export type CustomerFormCustomer = {
  id: number;
  name: string;
  legal_entity_name?: string | null;
  status: string;
  customer_type?: string | null;
};

type Notify = (msg: string, kind?: "ok" | "err") => void;

type DocType = { id: number; name: string; is_active: boolean };

type BranchContactRow = {
  key: string;
  contact_person_id?: number;
  contact_person_name: string;
  contact_person_email: string;
  contact_person_phone: string;
  hiring_manager_id?: number;
  hiring_manager_name: string;
  hiring_manager_contact: string;
  hiring_manager_email: string;
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
  /** Tri-state: null = inherit the customer's default billing policy. */
  holidays_billable: boolean | null;
  hours_required_half_day: string;
  hours_required_full_day: string;
  is_primary: boolean;
  contact_rows: BranchContactRow[];
};

type ContactRow = {
  id: number;
  branch_id?: number | null;
  name: string;
  email?: string | null;
  phone?: string | null;
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

const emptyContactRow = (): BranchContactRow => ({
  key: uid(),
  contact_person_name: "",
  contact_person_email: "",
  contact_person_phone: "",
  hiring_manager_name: "",
  hiring_manager_contact: "",
  hiring_manager_email: "",
});

const emptyBranch = (primary = false): BranchRow => ({
  key: uid(),
  branch_name: "",
  branch_legal_name: "",
  billing_address: "",
  address_line_2: "",
  city: "",
  state: "",
  pincode: "",
  country: "",
  gstin: "",
  pan: "",
  holidays_billable: null,
  hours_required_half_day: "",
  hours_required_full_day: "",
  is_primary: primary,
  contact_rows: [emptyContactRow()],
});

function contactsToRows(branchContacts: ContactRow[]): BranchContactRow[] {
  const cps = branchContacts.filter((c) => !c.is_hiring_manager);
  const hms = branchContacts.filter((c) => c.is_hiring_manager);
  if (!cps.length && !hms.length) return [emptyContactRow()];
  const count = Math.max(cps.length, hms.length, 1);
  return Array.from({ length: count }, (_, i) => {
    const cp = cps[i];
    const hm = hms[i];
    return {
      key: uid(),
      contact_person_id: cp?.id,
      contact_person_name: cp?.name || "",
      contact_person_email: cp?.email || "",
      contact_person_phone: cp?.phone || hm?.phone || "",
      hiring_manager_id: hm?.id,
      hiring_manager_name: hm?.name || "",
      hiring_manager_contact: hm?.phone || "",
      hiring_manager_email: hm?.email || "",
    };
  });
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
    country: String(b.country || ""),
    gstin: String(b.gstin || ""),
    pan: String(b.pan || ""),
    holidays_billable: b.holidays_billable == null ? null : !!b.holidays_billable,
    hours_required_half_day: b.hours_required_half_day != null ? String(b.hours_required_half_day) : "",
    hours_required_full_day: b.hours_required_full_day != null ? String(b.hours_required_full_day) : "",
    is_primary: !!b.is_primary,
    contact_rows: contactsToRows(branchContacts),
  };
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
  | "billingPolicy"
  | "compOff"
  | "attendance";

const FORM_SECTIONS: { key: SectionKey; title: string }[] = [
  { key: "customerDetails", title: "Customer Details" },
  { key: "address", title: "Address" },
  { key: "branches", title: "Branch" },
  { key: "documents", title: "Documents" },
  { key: "billingPolicy", title: "Leave & Holiday Billing" },
  { key: "compOff", title: "Comp Off" },
  { key: "attendance", title: "Attendance Rule" },
];

const cardCls = "rounded-card border border-subtle bg-surface-1 p-5";
const cardTitle = "mb-4 text-sm font-bold uppercase tracking-wide text-secondary";
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<SectionKey>("customerDetails");
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
    country: String(init.country || ""),
  });
  const [branches, setBranches] = useState<BranchRow[]>([emptyBranch(true)]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [docTypes, setDocTypes] = useState<DocType[]>([]);
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

  const setField = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const setPolicy = (k: string, v: unknown) => setPol((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    crmGet<DocType[]>("/api/document-types?limit=200&is_active=true")
      .then((r) => setDocTypes((r.data || []).filter((d) => d.is_active !== false)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!initial?.id) return;
    const id = initial.id;
    Promise.all([
      crmGet<Record<string, unknown>>(`/api/customers/${id}`),
      crmGet<Record<string, unknown> | null>(`/api/customers/${id}/billing-policy`),
      crmGet<BranchRow[]>(`/api/customers/${id}/branches`),
      crmGet<ContactRow[]>(`/api/customers/${id}/contacts`),
    ])
      .then(([cust, polRes, brRes, ctRes]) => {
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
          country: String(c.country || ""),
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
      })
      .catch(() => {});
  }, [initial?.id]);

  const validBranches = useMemo(
    () => branches.filter((b) => b.branch_name.trim()),
    [branches],
  );

  const progress = useMemo(() => {
    const required = [
      !!f.name.trim(),
      !!f.legal.trim(),
      !!f.address_line_1.trim(),
      validBranches.length > 0,
    ];
    const optional = [
      !!f.city.trim() || !!f.state.trim(),
      docs.some((d) => d.document_type_id),
      !!pol.week_off_billable || !!pol.leave_billable || !!pol.holidays_billable,
      !!pol.comp_off_billable,
    ];
    const done = required.filter(Boolean).length * 2 + optional.filter(Boolean).length;
    return Math.min(100, Math.round((done / (required.length * 2 + optional.length)) * 100));
  }, [f, validBranches, docs, pol]);

  type SectionStatus = "empty" | "partial" | "complete" | "error";

  const sectionStatus = (key: SectionKey): SectionStatus => {
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
      case "billingPolicy":
        if (pol.week_off_billable || pol.leave_billable || pol.holidays_billable) return "complete";
        return "empty";
      case "compOff":
        if (pol.comp_off_billable) return "complete";
        if (pol.comp_off_balance || pol.comp_off_max_limit) return "partial";
        return "empty";
      case "attendance":
        if (pol.normal_hours_per_day || pol.min_hours_full_day) return "complete";
        return "empty";
      default:
        return "empty";
    }
  };

  const scrollTo = (key: SectionKey) => {
    setActive(key);
    document.getElementById(`cust-sec-${key}`)?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
  };

  const StatusIcon = ({ st }: { st: SectionStatus }) =>
    st === "complete" ? <CheckCircle2 size={14} className="text-success" />
    : st === "error" ? <AlertCircle size={14} className="text-danger" />
    : st === "partial" ? <Circle size={14} className="text-brand-500" />
    : <Circle size={14} className="text-muted" />;

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
      country: "",
    });
    setBranches([emptyBranch(true)]);
    setDocs([]);
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
    return Object.keys(errs).length === 0;
  };

  const saveBranchContacts = async (customerId: number, branchId: number, b: BranchRow) => {
    const sync = async (
      existingId: number | undefined,
      payload: { name: string; email: string | null; phone: string | null; is_hiring_manager: boolean },
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
        // Same normalization as the Customers contact modal: store E.164.
        phone: normalizePhoneForSave(payload.phone) || null,
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
      const cpId = await sync(row.contact_person_id, {
        name: row.contact_person_name,
        email: row.contact_person_email || null,
        phone: row.contact_person_phone || row.hiring_manager_contact || null,
        is_hiring_manager: false,
      });
      if (cpId) kept.add(cpId);
      const hmId = await sync(row.hiring_manager_id, {
        name: row.hiring_manager_name,
        email: row.hiring_manager_email || null,
        phone: row.hiring_manager_contact || null,
        is_hiring_manager: true,
      });
      if (hmId) kept.add(hmId);
    }
    // Remove contacts deleted from the form (edit mode).
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
        // Tri-state: null = branch inherits the customer's default policy.
        holidays_billable: b.holidays_billable,
        hours_required_half_day: numOrNull(b.hours_required_half_day),
        hours_required_full_day: numOrNull(b.hours_required_full_day),
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
      const fields: Record<string, string> = { document_type_id: d.document_type_id };
      if (d.start_date) fields.start_date = d.start_date;
      if (d.end_date) fields.end_date = d.end_date;
      await crmUpload(`/api/customers/${customerId}/documents`, d.file, fields);
    }
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!validate()) {
      notify("Please fix the highlighted fields", "err");
      return;
    }
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
      const polPayload = {
        week_off_billable: !!pol.week_off_billable,
        leave_billable: !!pol.leave_billable,
        holidays_billable: !!pol.holidays_billable,
        min_hours_full_day: Number(pol.min_hours_full_day) || 8,
        min_hours_half_day: Number(pol.min_hours_half_day) || 4,
        comp_off_billable: !!pol.comp_off_billable,
        comp_off_balance: numOrNull(String(pol.comp_off_balance)),
        comp_off_balance_initial: numOrNull(String(pol.comp_off_balance_initial)),
        comp_off_max_limit: numOrNull(String(pol.comp_off_max_limit)),
        comp_off_max_carry_forward: numOrNull(String(pol.comp_off_max_carry_forward)),
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
      return { ...b, contact_rows: next.length ? next : [emptyContactRow()] };
    }));
  };

  const updateDoc = (key: string, patch: Partial<DocRow>) => {
    setDocs((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <button type="button" className={btnSecondary} onClick={resetForm} disabled={saving}>
        Reset
      </button>
      <button type="button" className={btnSecondary} onClick={onClose} disabled={saving}>
        Cancel
      </button>
      <button type="button" className={btnPrimary} onClick={() => submit()} disabled={saving}>
        {saving ? "Saving…" : initial ? "Save changes" : "Submit"}
      </button>
    </div>
  );

  const header = (
    <div className="w-full">
      <div className="mb-2 flex items-center gap-3">
        <span className="text-base font-bold text-primary">
          {initial ? `Edit Customer — ${initial.name}` : "New Customer"}
        </span>
        <span className="text-xs text-muted">{progress}% complete</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <motion.div
          className="h-full rounded-full bg-brand-500"
          animate={{ width: `${progress}%` }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 20 }}
        />
      </div>
    </div>
  );

  return (
    <Modal title={header} onClose={onClose} fullScreen footer={footer}>
      <form onSubmit={submit} className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(200px,240px)_1fr]">
        {/* Section nav — matches New Opportunity */}
        <nav aria-label="Customer form sections" className="hidden lg:block">
          <ul className="sticky top-0 space-y-1">
            {FORM_SECTIONS.map((s) => {
              const st = sectionStatus(s.key);
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => scrollTo(s.key)}
                    className={`flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-sm font-semibold transition-colors ${
                      active === s.key ? "bg-surface-2 text-primary" : "text-muted hover:text-primary"
                    }`}
                  >
                    <StatusIcon st={st} />
                    {s.title}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div ref={bodyRef} className="min-w-0 space-y-6">
          <AnimatePresence initial={false}>
            {/* Customer details */}
            <motion.section
              id="cust-sec-customerDetails"
              key="customerDetails"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cardCls}
            >
              <h3 className={cardTitle}>Customer Details</h3>
          <div className="grid gap-3 sm:grid-cols-2">
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
            </motion.section>

            <motion.section
              id="cust-sec-address"
              key="address"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cardCls}
            >
              <h3 className={cardTitle}>Address</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Address line 1" required error={errors.address_line_1}>
              <input className={inputCls} value={f.address_line_1} onChange={(e) => setField("address_line_1", e.target.value)} />
            </Field>
            <Field label="Address line 2">
              <input className={inputCls} value={f.address_line_2} onChange={(e) => setField("address_line_2", e.target.value)} />
            </Field>
            <Field label="City / District">
              <input className={inputCls} value={f.city} onChange={(e) => setField("city", e.target.value)} />
            </Field>
            <Field label="State / Province">
              <input className={inputCls} value={f.state} onChange={(e) => setField("state", e.target.value)} />
            </Field>
            <Field label="Postal code">
              <input className={inputCls} value={f.pincode} onChange={(e) => setField("pincode", e.target.value)} />
            </Field>
            <Field label="Country">
              <select className={inputCls} value={f.country} onChange={(e) => setField("country", e.target.value)}>
                <option value="">— Select —</option>
                <option value="India">India</option>
                <option value="United States">United States</option>
                <option value="United Kingdom">United Kingdom</option>
                <option value="Germany">Germany</option>
                <option value="Other">Other</option>
              </select>
            </Field>
          </div>
            </motion.section>

            <motion.section
              id="cust-sec-branches"
              key="branches"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cardCls}
            >
              <h3 className={cardTitle}>
                Branch <span className="text-danger">*</span>
              </h3>
          {errors.branches && (
            <p className="mb-2 text-xs text-danger">{errors.branches}</p>
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
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Billing address">
                    <div className="grid gap-1.5">
                      <input className={inputCls} placeholder="Line 1" value={b.billing_address}
                        onChange={(e) => updateBranch(b.key, { billing_address: e.target.value })} />
                      <input className={inputCls} placeholder="Line 2" value={b.address_line_2}
                        onChange={(e) => updateBranch(b.key, { address_line_2: e.target.value })} />
                      <div className="grid grid-cols-2 gap-1.5">
                        <input className={inputCls} placeholder="City" value={b.city}
                          onChange={(e) => updateBranch(b.key, { city: e.target.value })} />
                        <input className={inputCls} placeholder="State" value={b.state}
                          onChange={(e) => updateBranch(b.key, { state: e.target.value })} />
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <input className={inputCls} placeholder="Postal" value={b.pincode}
                          onChange={(e) => updateBranch(b.key, { pincode: e.target.value })} />
                        <input className={inputCls} placeholder="Country" value={b.country}
                          onChange={(e) => updateBranch(b.key, { country: e.target.value })} />
                      </div>
                    </div>
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Hours half day">
                      <input type="number" step="0.01" className={inputCls} value={b.hours_required_half_day}
                        onChange={(e) => updateBranch(b.key, { hours_required_half_day: e.target.value })} />
                    </Field>
                    <Field label="Hours full day">
                      <input type="number" step="0.01" className={inputCls} value={b.hours_required_full_day}
                        onChange={(e) => updateBranch(b.key, { hours_required_full_day: e.target.value })} />
                    </Field>
                    <Field label="Holidays billable">
                      <select
                        className={inputCls}
                        value={b.holidays_billable == null ? "" : b.holidays_billable ? "yes" : "no"}
                        onChange={(e) => updateBranch(b.key, {
                          holidays_billable: e.target.value === "" ? null : e.target.value === "yes",
                        })}
                      >
                        <option value="">Inherit customer default</option>
                        <option value="yes">Billable</option>
                        <option value="no">Not billable</option>
                      </select>
                    </Field>
                  </div>
                </div>
                <div className="mt-4 border-t border-subtle pt-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Branch contacts</p>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-control border border-subtle bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-500"
                      onClick={() => addBranchContact(b.key)}
                      aria-label="Add contact person"
                    >
                      <Plus size={14} /> Add contact
                    </button>
                  </div>
                  <div className="space-y-3">
                    {b.contact_rows.map((cr, cri) => (
                      <div key={cr.key} className="rounded-control border border-subtle/80 bg-surface-1/60 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-muted">
                            Person {cri + 1}
                          </span>
                          {b.contact_rows.length > 1 && (
                            <button
                              type="button"
                              className="rounded-control p-1 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                              onClick={() => removeBranchContact(b.key, cr.key)}
                              aria-label="Remove contact"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          <Field label="Contact Person">
                            <input className={inputCls} value={cr.contact_person_name} placeholder="Name"
                              onChange={(e) => updateBranchContact(b.key, cr.key, { contact_person_name: e.target.value })} />
                          </Field>
                          <Field label="Contact Person Email">
                            <input type="email" className={inputCls} value={cr.contact_person_email} placeholder="email@company.com"
                              onChange={(e) => updateBranchContact(b.key, cr.key, { contact_person_email: e.target.value })} />
                          </Field>
                          <Field label="Contact Phone">
                            <input type="tel" className={inputCls} value={cr.contact_person_phone} placeholder="+91 81234 56789"
                              onChange={(e) => updateBranchContact(b.key, cr.key, { contact_person_phone: e.target.value })} />
                          </Field>
                          <Field label="Hiring Manager">
                            <input className={inputCls} value={cr.hiring_manager_name} placeholder="Name"
                              onChange={(e) => updateBranchContact(b.key, cr.key, { hiring_manager_name: e.target.value })} />
                          </Field>
                          <Field label="HiringManager_Contact">
                            <input type="tel" className={inputCls} value={cr.hiring_manager_contact} placeholder="+91 81234 56789"
                              onChange={(e) => updateBranchContact(b.key, cr.key, { hiring_manager_contact: e.target.value })} />
                          </Field>
                          <Field label="HiringManager_Email">
                            <input type="email" className={inputCls} value={cr.hiring_manager_email} placeholder="email@company.com"
                              onChange={(e) => updateBranchContact(b.key, cr.key, { hiring_manager_email: e.target.value })} />
                          </Field>
                        </div>
                      </div>
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
            </motion.section>

            <motion.section
              id="cust-sec-documents"
              key="documents"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cardCls}
            >
              <h3 className={cardTitle}>Documents</h3>
          <div className={tableWrap}>
            <table className="min-w-[720px] w-full text-sm">
              <thead className={tableHead}>
                <tr>
                  <th className={thCls}>Document name</th>
                  <th className={thCls}>Document</th>
                  <th className={thCls}>Start date</th>
                  <th className={thCls}>End date</th>
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
                        <input type="date" className={inputCls} value={d.end_date}
                          onChange={(e) => updateDoc(d.key, { end_date: e.target.value })} />
                      </td>
                      <td className={tdCls}>
                        <select className={inputCls} value={d.status}
                          onChange={(e) => updateDoc(d.key, { status: e.target.value })}>
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
            </motion.section>

            <motion.section
              id="cust-sec-billingPolicy"
              key="billingPolicy"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cardCls}
            >
              <h3 className={cardTitle}>Leave &amp; Holiday Billing</h3>
          <div className="flex flex-wrap gap-5">
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
            </motion.section>

            <motion.section
              id="cust-sec-compOff"
              key="compOff"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cardCls}
            >
              <h3 className={cardTitle}>Comp Off</h3>
          <label className="mb-3 flex items-center gap-2 text-sm font-medium text-primary">
            <input type="checkbox" className={chk} checked={!!pol.comp_off_billable}
              onChange={(e) => setPolicy("comp_off_billable", e.target.checked)} />
            Comp off billable
          </label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Comp off balance">
              <input type="number" className={inputCls} value={String(pol.comp_off_balance ?? "")}
                onChange={(e) => setPolicy("comp_off_balance", e.target.value)} />
            </Field>
            <Field label="Comp off balance initial">
              <input type="number" className={inputCls} value={String(pol.comp_off_balance_initial ?? "")}
                onChange={(e) => setPolicy("comp_off_balance_initial", e.target.value)} />
            </Field>
            <Field label="Comp off max limit">
              <input type="number" className={inputCls} value={String(pol.comp_off_max_limit ?? "")}
                onChange={(e) => setPolicy("comp_off_max_limit", e.target.value)} />
            </Field>
            <Field label="Comp off max carry forward">
              <input type="number" className={inputCls} value={String(pol.comp_off_max_carry_forward ?? "")}
                onChange={(e) => setPolicy("comp_off_max_carry_forward", e.target.value)} />
            </Field>
          </div>
            </motion.section>

            <motion.section
              id="cust-sec-attendance"
              key="attendance"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cardCls}
            >
              <h3 className={cardTitle}>Attendance Rule</h3>
          <div className="grid gap-3 sm:grid-cols-3">
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
            </motion.section>
          </AnimatePresence>
        </div>
      </form>
    </Modal>
  );
}
