/** Shared Customer Contact Person create/edit modal (PO Header + Customers).
 * Zoho-like fields without Communication Matrix Form-ID. */
import React, { useState } from "react";
import { User } from "lucide-react";
import { crmPost, crmPut } from "../api";
import { CONTACT_ROLES } from "../constants/geo";
import { normalizePhoneForSave } from "../lib/phone";
import { Modal, btnPrimary, btnSecondary, inputCls } from "./ui";
import { SectionHeaderBanner, WizardField } from "./wizard";

export type ContactPersonBranch = {
  id: number;
  branch_name: string;
  is_primary?: boolean;
};

export type ContactPersonRow = {
  id: number;
  branch_id?: number | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  designation?: string | null;
  role?: string | null;
  contact_priority?: string | null;
  notification?: string | null;
  is_hiring_manager?: boolean;
  is_active?: boolean;
};

const CONTACT_PRIORITIES = ["Primary", "Secondary"] as const;
const NOTIFICATION_OPTIONS = ["Email", "SMS", "Both", "None"] as const;

type Notify = (msg: string, kind?: "ok" | "err") => void;

type Props = {
  customerId: number;
  /** Display name when customer is locked (PO flow). */
  customerName?: string;
  branches: ContactPersonBranch[];
  initial?: ContactPersonRow;
  /** When true, Customer Branch is required (PO quick-add). */
  requireBranch?: boolean;
  /** When true, customer is shown read-only (already chosen on PO). */
  lockCustomer?: boolean;
  onClose: () => void;
  onSaved: (contact: ContactPersonRow) => void;
  notify: Notify;
};

export function ContactPersonFormModal({
  customerId,
  customerName,
  branches,
  initial,
  requireBranch = false,
  lockCustomer = false,
  onClose,
  onSaved,
  notify,
}: Props) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    branch_id: initial?.branch_id ? String(initial.branch_id) : "",
    email: initial?.email || "",
    phone: initial?.phone || "",
    designation: initial?.designation || "",
    role: initial?.role || "",
    contact_priority: initial?.contact_priority || "",
    notification: initial?.notification || "",
    is_hiring_manager: initial?.is_hiring_manager || false,
    is_active: initial?.is_active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Contact name is required";
    if (requireBranch && !form.branch_id) errs.branch_id = "Customer branch is required";
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) {
      errs.email = "Enter a valid email address";
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        branch_id: form.branch_id ? Number(form.branch_id) : null,
        email: form.email.trim() || null,
        phone: normalizePhoneForSave(form.phone) || null,
        designation: form.designation.trim() || null,
        role: form.role.trim() || null,
        contact_priority: form.contact_priority.trim() || null,
        notification: form.notification.trim() || null,
        is_hiring_manager: form.is_hiring_manager,
        is_active: form.is_active,
      };
      const res = initial
        ? await crmPut<ContactPersonRow>(`/api/customers/${customerId}/contacts/${initial.id}`, payload)
        : await crmPost<ContactPersonRow>(`/api/customers/${customerId}/contacts`, payload);
      const saved = (res.data || { ...payload, id: 0 }) as ContactPersonRow;
      notify(res.message || (initial ? "Contact saved" : "Contact created"));
      onSaved(saved);
      onClose();
    } catch (err: any) {
      notify(err?.message || "Failed to save contact", "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={<span className="sr-only">{initial ? "Edit Contact" : "Customer Contact Persons"}</span>}
      onClose={onClose}
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <div className="crm-wizard wiz-noise min-h-full w-full bg-[color:var(--wiz-bg)] px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto w-full max-w-3xl">
          <SectionHeaderBanner
            title={initial ? "Edit Contact" : "Customer Contact Persons"}
            description="Key contact person, branch, role, and notification preferences."
            icon={<User size={20} aria-hidden />}
          />
          <form onSubmit={submit} className="space-y-5">
            {lockCustomer && (
              <WizardField label="Customers" icon="building" filled>
                <input className={inputCls} value={customerName || `Customer #${customerId}`} readOnly disabled />
              </WizardField>
            )}
            <WizardField
              label="Customer Branch"
              required={requireBranch}
              error={errors.branch_id}
              icon="building"
              filled={!!form.branch_id}
            >
              <select
                className={inputCls}
                value={form.branch_id}
                onChange={(e) => set("branch_id", e.target.value)}
              >
                <option value="">{requireBranch ? "Select branch…" : "— No branch —"}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.branch_name}{b.is_primary ? " (primary)" : ""}
                  </option>
                ))}
              </select>
            </WizardField>
            <WizardField label="Name" required error={errors.name} icon="user" filled={!!form.name.trim()}>
              <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} />
            </WizardField>
            <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
              <WizardField label="Email" error={errors.email} icon="mail" filled={!!form.email.trim() && !errors.email}>
                <input className={inputCls} value={form.email} onChange={(e) => set("email", e.target.value)} />
              </WizardField>
              <WizardField label="Phone" icon="phone" filled={!!form.phone.trim()}>
                <input
                  className={inputCls}
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  maxLength={32}
                  placeholder="+91 …"
                />
              </WizardField>
            </div>
            {/* Department field removed (18 Aug 2026, user request) — the
                designation column stays in the DB; existing values persist. */}
            <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
              <WizardField label="Role" icon="user" filled={!!form.role}>
                <select className={inputCls} value={form.role} onChange={(e) => set("role", e.target.value)}>
                  <option value="">— Select —</option>
                  {CONTACT_ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </WizardField>
              <WizardField label="Primary / Secondary" icon="hash" filled={!!form.contact_priority}>
                <select
                  className={inputCls}
                  value={form.contact_priority}
                  onChange={(e) => set("contact_priority", e.target.value)}
                >
                  <option value="">— Select —</option>
                  {CONTACT_PRIORITIES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </WizardField>
              <WizardField label="Notification" icon="mail" filled={!!form.notification}>
                <select
                  className={inputCls}
                  value={form.notification}
                  onChange={(e) => set("notification", e.target.value)}
                >
                  <option value="">— Select —</option>
                  {NOTIFICATION_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </WizardField>
              <WizardField label="Status" icon="hash" filled>
                <select
                  className={inputCls}
                  value={form.is_active ? "Active" : "Inactive"}
                  onChange={(e) => set("is_active", e.target.value === "Active")}
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </WizardField>
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold text-[color:var(--wiz-text)]">
              <input
                type="checkbox"
                className="h-4 w-4 accent-sky-600"
                checked={form.is_hiring_manager}
                onChange={(e) => set("is_hiring_manager", e.target.checked)}
              />
              Hiring manager
            </label>
            <div className="mt-6 flex items-center gap-3 border-t border-[color:var(--wiz-border)] pt-5">
              <button type="button" className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className={`${btnSecondary} h-10 rounded-xl`}
                disabled={saving}
                onClick={() => {
                  setForm({
                    name: "",
                    branch_id: "",
                    email: "",
                    phone: "",
                    designation: "",
                    role: "",
                    contact_priority: "",
                    notification: "",
                    is_hiring_manager: false,
                    is_active: true,
                  });
                  setErrors({});
                }}
              >
                Reset
              </button>
              <button
                type="submit"
                className={`${btnPrimary} btn-gradient ml-auto h-10 rounded-xl px-4`}
                disabled={saving}
              >
                {saving ? "Saving…" : initial ? "Save contact" : "Submit"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Modal>
  );
}
