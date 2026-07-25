/** Holiday calendar — year-scoped, month-grouped list of holidays feeding
 * timesheet day generation. Read: any CRM role. Write (add / edit / soft
 * deactivate): HR / Admin. Customer→branch cascading selects scope a holiday
 * to one customer or branch ("Customer" type). */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Pencil, Plus, Power } from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut, qs } from "../api";
import { HolidayNameField } from "../components/HolidayNameField";
import { useHasRole } from "../CrmApp";
import {
  ConfirmModal, EmptyState, ErrorBox, Modal, Spinner, StatusBadge,
  btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";
import { SectionHeaderBanner, WizardField } from "../components/wizard";

/** Local single-screen shell — applies the shared New Opportunity wizard look
 * (dark themed body + gradient SectionHeaderBanner) inside the existing Modal.
 * Visual-only wrapper: no field, state, or submit logic lives here. */
function WizFormShell({
  title, subtitle, icon, children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="crm-wizard wiz-noise min-h-full w-full px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-3xl">
        <SectionHeaderBanner title={title} description={subtitle} icon={icon} />
        {children}
      </div>
    </div>
  );
}

/* Shared footer container for the reskinned single-screen dialogs. */
const wizFooterRow = "mt-6 flex items-center gap-3 border-t border-[color:var(--wiz-border)] pt-5";

/* ------------------------------------------------------------ types & consts */

type Holiday = {
  id: number;
  holiday_name_id?: number | null;
  name: string;
  holiday_date: string;
  holiday_type: string;
  observance: string;
  customer_id: number | null;
  branch_id: number | null;
  year: number;
  is_active: boolean;
};

type CustomerLite = { id: number; name: string };
type BranchLite = { id: number; branch_name: string };

const HOLIDAY_TYPES = ["National", "Regional", "Customer"];
const OBSERVANCE = ["Mandatory", "Optional"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const fmtDate = (d?: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString() : "—");
const weekday = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: "long" });

const iconBtn =
  "rounded-control p-1.5 text-muted transition-colors duration-micro ease-smooth hover:bg-surface-2 hover:text-primary focus-visible:outline-none focus-visible:shadow-focus-ring";

/* ================================================================ PAGE */

export function HolidaysPage() {
  const canWrite = useHasRole("HR");
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [showInactive, setShowInactive] = useState(false);
  const [rows, setRows] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [modal, setModal] = useState<{ initial?: Holiday } | null>(null);
  const [deactivating, setDeactivating] = useState<Holiday | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<Holiday[]>(`/api/holidays${qs({
        year,
        is_active: showInactive ? false : true,
        limit: 100,
      })}`);
      setRows(res.data || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load holidays");
    } finally {
      setLoading(false);
    }
  }, [year, showInactive]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    crmGet<CustomerLite[]>("/api/customers?limit=100").then((r) => setCustomers(r.data || [])).catch(() => {});
  }, []);

  const customerName = useMemo(() => {
    const m = new Map<number, string>();
    customers.forEach((c) => m.set(c.id, c.name));
    return (id?: number | null) => (id == null ? null : m.get(id) || `#${id}`);
  }, [customers]);

  const byMonth = useMemo(() => {
    const groups = new Map<number, Holiday[]>();
    rows.forEach((h) => {
      const m = new Date(`${h.holiday_date}T00:00:00`).getMonth();
      if (!groups.has(m)) groups.set(m, []);
      groups.get(m)!.push(h);
    });
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [rows]);

  const deactivate = async () => {
    if (!deactivating) return;
    setBusy(true);
    try {
      const res = await crmDelete(`/api/holidays/${deactivating.id}`);
      showToast(res.message || "Holiday deactivated");
      setDeactivating(null);
      load();
    } catch (e: any) {
      showToast(e?.message || "Failed to deactivate holiday", "err");
    } finally {
      setBusy(false);
    }
  };

  const years: number[] = [];
  for (let y = currentYear + 2; y >= currentYear - 5; y--) years.push(y);

  const cell = "px-4 py-2.5";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-display text-xl font-bold text-primary">Holidays</h1>
        {canWrite && (
          <button className={btnPrimary} onClick={() => setModal({})}>
            <Plus size={15} /> Add Holiday
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          className={`${inputCls} !w-28`}
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          aria-label="Holiday calendar year"
        >
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm font-semibold text-secondary">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand-600"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show deactivated only
        </label>
      </div>

      {loading ? (
        <Spinner label="Loading holidays…" />
      ) : error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : rows.length === 0 ? (
        <div className="glass fx-gradient-border rounded-card">
          <EmptyState
            icon={<CalendarDays size={22} />}
            message={`No ${showInactive ? "deactivated " : ""}holidays for ${year}`}
            actionLabel={canWrite && !showInactive ? "Add Holiday" : undefined}
            onAction={canWrite && !showInactive ? () => setModal({}) : undefined}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {byMonth.map(([month, list]) => (
            <div key={month} className="overflow-hidden rounded-card border border-subtle bg-surface-1">
              <div className="fx-hairline-b px-4 py-3 text-sm font-bold text-primary">
                {MONTHS[month]} {year}
                <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-secondary ring-1 ring-inset ring-subtle">
                  {list.length}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-max text-sm lg:min-w-0">
                  <thead>
                    <tr className="border-b border-subtle text-left text-xs font-bold uppercase tracking-wide text-muted">
                      <th className={cell}>Date</th>
                      <th className={cell}>Day</th>
                      <th className={cell}>Holiday</th>
                      <th className={cell}>Type</th>
                      <th className={cell}>Observance</th>
                      <th className={cell}>Scope</th>
                      <th className={cell}>Status</th>
                      {canWrite && <th className={`${cell} text-right`}><span className="sr-only">Actions</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((h) => (
                      <tr key={h.id} className="border-b border-subtle transition-colors duration-micro ease-smooth hover:bg-surface-2">
                        <td className={`${cell} whitespace-nowrap font-semibold text-primary`}>{fmtDate(h.holiday_date)}</td>
                        <td className={`${cell} whitespace-nowrap text-secondary`}>{weekday(h.holiday_date)}</td>
                        <td className={`${cell} font-semibold text-primary`}>{h.name}</td>
                        <td className={`${cell} text-secondary`}>{h.holiday_type}</td>
                        <td className={`${cell} text-secondary`}>{h.observance || "Mandatory"}</td>
                        <td className={`${cell} text-secondary`}>
                          {h.customer_id
                            ? <>{customerName(h.customer_id)}{h.branch_id ? <span className="text-muted"> · Branch #{h.branch_id}</span> : null}</>
                            : "All"}
                        </td>
                        <td className={cell}><StatusBadge status={h.is_active ? "Active" : "Inactive"} /></td>
                        {canWrite && (
                          <td className={`${cell} text-right`}>
                            <span className="inline-flex gap-1">
                              <button
                                className={iconBtn}
                                title="Edit holiday"
                                aria-label={`Edit holiday ${h.name}`}
                                onClick={() => setModal({ initial: h })}
                              >
                                <Pencil size={15} />
                              </button>
                              {h.is_active && (
                                <button
                                  className={`${iconBtn} hover:!text-danger`}
                                  title="Deactivate holiday"
                                  aria-label={`Deactivate holiday ${h.name}`}
                                  onClick={() => setDeactivating(h)}
                                >
                                  <Power size={15} />
                                </button>
                              )}
                            </span>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <HolidayFormModal
          initial={modal.initial}
          customers={customers}
          onClose={() => setModal(null)}
          onSaved={(msg) => { setModal(null); showToast(msg || "Holiday saved"); load(); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
      {deactivating && (
        <ConfirmModal
          title="Deactivate holiday"
          message={<>Deactivate <b>{deactivating.name}</b> ({fmtDate(deactivating.holiday_date)})? It will stop feeding timesheet day generation but stays in the calendar history.</>}
          confirmLabel="Deactivate"
          danger
          busy={busy}
          onConfirm={deactivate}
          onClose={() => setDeactivating(null)}
        />
      )}
      {toast}
    </div>
  );
}

/* ================================================================ FORM MODAL */

function HolidayFormModal({
  initial, customers, onClose, onSaved, onError,
}: {
  initial?: Holiday;
  customers: CustomerLite[];
  onClose: () => void;
  onSaved: (message?: string) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [nameId, setNameId] = useState(initial?.holiday_name_id ? String(initial.holiday_name_id) : "");
  const [date, setDate] = useState(initial?.holiday_date || "");
  const [type, setType] = useState(initial?.holiday_type || "National");
  const [observance, setObservance] = useState(initial?.observance || "Mandatory");
  const [customerId, setCustomerId] = useState(initial?.customer_id ? String(initial.customer_id) : "");
  const [branchId, setBranchId] = useState(initial?.branch_id ? String(initial.branch_id) : "");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [branches, setBranches] = useState<BranchLite[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Cascading customer → branch select.
  useEffect(() => {
    setBranches([]);
    if (!customerId) {
      setBranchId("");
      return;
    }
    let cancelled = false;
    setBranchesLoading(true);
    crmGet<BranchLite[]>(`/api/customers/${customerId}/branches`)
      .then((r) => { if (!cancelled) setBranches(r.data || []); })
      .catch(() => { if (!cancelled) setBranches([]); })
      .finally(() => { if (!cancelled) setBranchesLoading(false); });
    return () => { cancelled = true; };
  }, [customerId]);

  // Reset stale branch selections that don't belong to the loaded customer.
  useEffect(() => {
    if (branchId && branches.length && !branches.some((b) => String(b.id) === branchId)) {
      setBranchId("");
    }
  }, [branches, branchId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim() && !nameId) errs.name = "Holiday name is required";
    if (!date) errs.date = "Holiday date is required";
    if (type === "Customer" && !customerId) errs.customer = "Select a customer for a customer-specific holiday";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim() || undefined,
        holiday_name_id: nameId ? Number(nameId) : null,
        holiday_date: date,
        holiday_type: type,
        observance,
        customer_id: customerId ? Number(customerId) : null,
        branch_id: customerId && branchId ? Number(branchId) : null,
        is_active: isActive,
      };
      const res = initial
        ? await crmPut(`/api/holidays/${initial.id}`, payload)
        : await crmPost("/api/holidays", payload);
      onSaved(res.message);
    } catch (err: any) {
      onError(err?.message || "Failed to save holiday");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={<span className="sr-only">{initial ? "Edit Holiday" : "Add Holiday"}</span>}
      onClose={onClose}
      fullScreen
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title={initial ? "Edit Holiday" : "Add Holiday"}
        subtitle="Define the holiday and observance, and optionally scope it to a customer or branch."
        icon={<CalendarDays size={20} aria-hidden />}
      >
        <form onSubmit={submit} className="space-y-5">
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            <HolidayNameField
              valueId={nameId}
              valueName={name}
              onChangeId={setNameId}
              onChangeName={setName}
              required
              error={errors.name}
              onError={onError}
            />
            <WizardField label="Date" required error={errors.date} icon="calendar" filled={!!date}>
              <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
            </WizardField>
          </div>
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            <WizardField label="Type">
              <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
                {HOLIDAY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </WizardField>
            <WizardField label="Observance">
              <select className={inputCls} value={observance} onChange={(e) => setObservance(e.target.value)}>
                {OBSERVANCE.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </WizardField>
          </div>
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            <WizardField label="Customer (optional)" error={errors.customer} icon="building">
              <select
                className={inputCls}
                value={customerId}
                onChange={(e) => { setCustomerId(e.target.value); setBranchId(""); }}
              >
                <option value="">— All customers —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </WizardField>
            <WizardField label="Branch (optional)" icon="building">
              <select
                className={inputCls}
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                disabled={!customerId || branchesLoading}
              >
                <option value="">
                  {!customerId ? "Select a customer first" : branchesLoading ? "Loading branches…" : "— All branches —"}
                </option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
              </select>
            </WizardField>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-secondary">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Active
          </label>
          <div className={wizFooterRow}>
            <button type="button" className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`} disabled={saving}>{saving ? "Saving…" : "Save holiday"}</button>
          </div>
        </form>
      </WizFormShell>
    </Modal>
  );
}
