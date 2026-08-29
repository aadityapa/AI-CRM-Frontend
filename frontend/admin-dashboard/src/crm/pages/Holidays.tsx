/** Holiday calendar — customer-wise list with rich filters. Customer holidays
 * are branch-scoped so they stay in sync with branch Holiday Billing Policy. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CalendarDays, Eye, FilterX, Pencil, Plus, Power, Search, Trash2 } from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut } from "../api";
import { HolidayNameField } from "../components/HolidayNameField";
import { FilterChips } from "../components/FilterChips";
import type { ActiveFilter } from "../components/FilterChips";
import { fetchAllMaster } from "../lib/fetchAllMaster";
import { useHasRole } from "../CrmApp";
import { useCanAct } from "../useAccess";
import {
  ConfirmModal, EmptyState, ErrorBox, Modal, Spinner, StatusBadge,
} from "../components/ui";
import { TeachingEmpty } from "../components/TeachingEmpty";
import {
  btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";
import { SectionHeaderBanner, WizardField } from "../components/wizard";

/** Local single-screen shell — applies the shared New Opportunity wizard look
 * (theme-aware body + SectionHeaderBanner) inside the existing Modal.
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
    <div className="crm-wizard wiz-noise min-h-full w-full bg-[color:var(--wiz-bg)] px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-3xl">
        <SectionHeaderBanner title={title} description={subtitle} icon={icon} />
        {children}
      </div>
    </div>
  );
}

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
type BranchLite = { id: number; branch_name: string; customer_id?: number; customer_name?: string };

const HOLIDAY_TYPES = ["National", "Regional", "Customer"] as const;
const OBSERVANCE = ["Mandatory", "Optional"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const GLOBAL_KEY = "global";

const fmtDate = (d?: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString() : "—");
const weekday = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: "long" });

const iconBtn =
  "rounded-control p-1.5 text-muted transition-colors duration-micro ease-smooth hover:bg-surface-2 hover:text-primary focus-visible:outline-none focus-visible:shadow-focus-ring";

const filterSelect = `${inputCls} !w-auto min-w-[9.5rem] max-w-[14rem]`;

/* ================================================================ PAGE */

export function HolidaysPage() {
  const canWrite = useCanAct("holidays", "edit", useHasRole("HR"));
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(""); // "" = all
  const [customerId, setCustomerId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [holidayType, setHolidayType] = useState("");
  const [observance, setObservance] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const [groupBy, setGroupBy] = useState<"customer" | "month">("customer");
  const [search, setSearch] = useState("");

  const [rows, setRows] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [allBranches, setAllBranches] = useState<BranchLite[]>([]);
  const [modal, setModal] = useState<{ initial?: Holiday } | null>(null);
  // Deep-link create (hub "New …" buttons): ?create=1 opens the dialog once,
  // then strips the flag so refresh / back never reopen it.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("create") === "1") {
      setModal({});
      sp.delete("create");
      window.history.replaceState(null, "", `${window.location.pathname}?${sp.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [deactivating, setDeactivating] = useState<Holiday | null>(null);
  const [deleting, setDeleting] = useState<Holiday | null>(null);
  const [viewing, setViewing] = useState<Holiday | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();

  useEffect(() => {
    // Match Customers page default: only Active accounts in the picker.
    // Inactive duplicates (e.g. old legal-name rows) otherwise clutter the filter.
    fetchAllMaster<CustomerLite>("/api/customers", { status: "Active" })
      .then((rows) => setCustomers(rows.sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {});
    fetchAllMaster<BranchLite>("/api/customers/all-branches")
      .then(setAllBranches)
      .catch(() => {});
  }, []);

  const branchesForFilter = useMemo(() => {
    const activeIds = new Set(customers.map((c) => c.id));
    const scoped = allBranches.filter((b) => b.customer_id == null || activeIds.has(b.customer_id));
    if (!customerId) return scoped;
    if (customerId === "__global__") return [];
    const cid = Number(customerId);
    return scoped.filter((b) => b.customer_id === cid);
  }, [allBranches, customers, customerId]);

  // Clear branch when it no longer belongs to the selected customer.
  useEffect(() => {
    if (!branchId) return;
    if (!branchesForFilter.some((b) => String(b.id) === branchId)) {
      setBranchId("");
    }
  }, [branchesForFilter, branchId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const companyWideOnly = customerId === "__global__";
      const params: Record<string, string | number | boolean | undefined | null> = {
        year,
        status,
        month: month ? Number(month) : undefined,
        customer_id: customerId && !companyWideOnly ? Number(customerId) : undefined,
        branch_id: branchId && !companyWideOnly ? Number(branchId) : undefined,
        holiday_type: holidayType || undefined,
        observance: observance || undefined,
      };
      let data = await fetchAllMaster<Holiday>("/api/holidays", params);
      if (companyWideOnly) {
        data = data.filter((h) => h.customer_id == null);
      }
      setRows(data);
    } catch (e: any) {
      setError(e?.message || "Failed to load holidays");
    } finally {
      setLoading(false);
    }
  }, [year, month, customerId, branchId, holidayType, observance, status]);
  useEffect(() => { load(); }, [load]);

  const customerName = useMemo(() => {
    const m = new Map<number, string>();
    customers.forEach((c) => m.set(c.id, c.name));
    return (id?: number | null) => (id == null ? null : m.get(id) || `#${id}`);
  }, [customers]);

  const branchName = useMemo(() => {
    const m = new Map<number, string>();
    allBranches.forEach((b) => m.set(b.id, b.branch_name));
    return (id?: number | null) => (id == null ? null : m.get(id) || `#${id}`);
  }, [allBranches]);

  const scopeLabel = useCallback((h: Holiday) => {
    if (!h.customer_id) return "All customers";
    const cust = customerName(h.customer_id) || `Customer #${h.customer_id}`;
    const br = h.branch_id ? branchName(h.branch_id) : null;
    return br ? `${cust} · ${br}` : cust;
  }, [customerName, branchName]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((h) =>
      [
        h.name,
        h.holiday_date,
        h.holiday_type,
        h.observance,
        h.year,
        scopeLabel(h),
        MONTHS[new Date(`${h.holiday_date}T00:00:00`).getMonth()],
      ].some((v) => String(v ?? "").toLowerCase().includes(q)),
    );
  }, [rows, search, scopeLabel]);

  const byCustomer = useMemo(() => {
    const groups = new Map<string, { key: string; title: string; list: Holiday[] }>();
    filtered.forEach((h) => {
      const key = h.customer_id != null ? String(h.customer_id) : GLOBAL_KEY;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          title: h.customer_id != null
            ? (customerName(h.customer_id) || `Customer #${h.customer_id}`)
            : "Company-wide (National / Regional)",
          list: [],
        });
      }
      groups.get(key)!.list.push(h);
    });
    const ordered = [...groups.values()].sort((a, b) => {
      if (a.key === GLOBAL_KEY) return -1;
      if (b.key === GLOBAL_KEY) return 1;
      return a.title.localeCompare(b.title);
    });
    ordered.forEach((g) => g.list.sort((a, b) => a.holiday_date.localeCompare(b.holiday_date)));
    return ordered;
  }, [filtered, customerName]);

  const byMonth = useMemo(() => {
    const groups = new Map<number, Holiday[]>();
    filtered.forEach((h) => {
      const m = new Date(`${h.holiday_date}T00:00:00`).getMonth();
      if (!groups.has(m)) groups.set(m, []);
      groups.get(m)!.push(h);
    });
    return [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([m, list]) => ({
        key: String(m),
        title: `${MONTHS[m]} ${year}`,
        list: [...list].sort((a, b) => a.holiday_date.localeCompare(b.holiday_date)),
      }));
  }, [filtered, year]);

  const groups = groupBy === "customer" ? byCustomer : byMonth;

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const chips: ActiveFilter[] = [];
    if (month) {
      chips.push({
        key: "month",
        label: `Month: ${MONTHS[Number(month) - 1]}`,
        onRemove: () => setMonth(""),
      });
    }
    if (customerId) {
      chips.push({
        key: "customer",
        label: customerId === "__global__"
          ? "Customer: Company-wide only"
          : `Customer: ${customerName(Number(customerId)) || customerId}`,
        onRemove: () => { setCustomerId(""); setBranchId(""); },
      });
    }
    if (branchId) {
      chips.push({
        key: "branch",
        label: `Branch: ${branchName(Number(branchId)) || branchId}`,
        onRemove: () => setBranchId(""),
      });
    }
    if (holidayType) {
      chips.push({
        key: "type",
        label: `Type: ${holidayType}`,
        onRemove: () => setHolidayType(""),
      });
    }
    if (observance) {
      chips.push({
        key: "observance",
        label: `Observance: ${observance}`,
        onRemove: () => setObservance(""),
      });
    }
    if (status !== "active") {
      chips.push({
        key: "status",
        label: `Status: ${status === "all" ? "All" : "Inactive"}`,
        onRemove: () => setStatus("active"),
      });
    }
    if (search.trim()) {
      chips.push({
        key: "search",
        label: `Search: ${search.trim()}`,
        onRemove: () => setSearch(""),
      });
    }
    return chips;
  }, [month, customerId, branchId, holidayType, observance, status, search, customerName, branchName]);

  const clearFilters = () => {
    setMonth("");
    setCustomerId("");
    setBranchId("");
    setHolidayType("");
    setObservance("");
    setStatus("active");
    setSearch("");
  };

  const deactivate = async () => {
    if (!deactivating) return;
    setBusy(true);
    try {
      const res = await crmPost(`/api/holidays/${deactivating.id}/deactivate`);
      showToast(res.message || "Holiday deactivated");
      setDeactivating(null);
      load();
    } catch (e: any) {
      showToast(e?.message || "Failed to deactivate holiday", "err");
    } finally {
      setBusy(false);
    }
  };

  const deleteHoliday = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      const res = await crmDelete(`/api/holidays/${deleting.id}`);
      showToast(res.message || "Holiday deleted");
      setDeleting(null);
      load();
    } catch (e: any) {
      showToast(e?.message || "Failed to delete holiday", "err");
    } finally {
      setBusy(false);
    }
  };

  const years: number[] = [];
  for (let y = currentYear + 2; y >= currentYear - 5; y--) years.push(y);

  const cell = "px-4 py-2.5";
  const hasExtraFilters = activeFilters.length > 0;

  const renderTable = (list: Holiday[], showCustomerCol: boolean) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-sm lg:min-w-0">
        <thead>
          <tr className="border-b border-subtle text-left text-xs font-bold uppercase tracking-wide text-muted">
            <th className={cell}>Date</th>
            <th className={cell}>Day</th>
            <th className={cell}>Holiday</th>
            <th className={cell}>Type</th>
            <th className={cell}>Observance</th>
            {showCustomerCol && <th className={cell}>Customer</th>}
            <th className={cell}>Branch</th>
            <th className={cell}>Status</th>
            <th className={`${cell} text-right`}><span className="sr-only">Actions</span></th>
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
              {showCustomerCol && (
                <td className={`${cell} text-secondary`}>
                  {h.customer_id ? customerName(h.customer_id) : "All customers"}
                </td>
              )}
              <td className={`${cell} text-secondary`}>
                {h.branch_id ? branchName(h.branch_id) : (h.customer_id ? "—" : "All")}
              </td>
              <td className={cell}><StatusBadge status={h.is_active ? "Active" : "Inactive"} /></td>
              <td className={`${cell} text-right`}>
                <span className="inline-flex gap-1">
                  <button
                    className={iconBtn}
                    title="View holiday"
                    aria-label={`View holiday ${h.name}`}
                    onClick={() => setViewing(h)}
                  >
                    <Eye size={15} />
                  </button>
                  {canWrite && (
                    <button
                      className={iconBtn}
                      title="Edit holiday"
                      aria-label={`Edit holiday ${h.name}`}
                      onClick={() => setModal({ initial: h })}
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                  {canWrite && h.is_active && (
                    <button
                      className={`${iconBtn} hover:!text-danger`}
                      title="Deactivate holiday"
                      aria-label={`Deactivate holiday ${h.name}`}
                      onClick={() => setDeactivating(h)}
                    >
                      <Power size={15} />
                    </button>
                  )}
                  {canWrite && (
                    <button
                      className={`${iconBtn} hover:!text-danger`}
                      title="Delete holiday permanently"
                      aria-label={`Delete holiday ${h.name}`}
                      onClick={() => setDeleting(h)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-display text-xl font-bold text-primary">Holidays</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Browse customer-wise calendars. Customer holidays must pick a branch so they appear in
            that branch’s Holiday Billing Policy.
          </p>
        </div>
        {canWrite && (
          <button className={btnPrimary} onClick={() => setModal({})}>
            <Plus size={15} /> Add Holiday
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-card border border-subtle bg-surface-1">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[12rem] flex-1">
            <input
              className={`${inputCls} !pl-9`}
              placeholder="Search name, date, customer, branch…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search holidays"
            />
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          </div>

          <select className={filterSelect} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>

          <select className={filterSelect} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
            <option value="">All months</option>
            {MONTHS.map((label, i) => (
              <option key={label} value={String(i + 1)}>{label}</option>
            ))}
          </select>

          <select
            className={`${filterSelect} max-w-[16rem]`}
            value={customerId}
            onChange={(e) => { setCustomerId(e.target.value); setBranchId(""); }}
            aria-label="Customer"
          >
            <option value="">All customers</option>
            <option value="__global__">Company-wide only</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <select
            className={filterSelect}
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            disabled={customerId === "__global__"}
            aria-label="Branch"
          >
            <option value="">All branches</option>
            {branchesForFilter.map((b) => (
              <option key={b.id} value={b.id}>
                {b.branch_name}{!customerId && b.customer_name ? ` · ${b.customer_name}` : ""}
              </option>
            ))}
          </select>

          <select className={filterSelect} value={holidayType} onChange={(e) => setHolidayType(e.target.value)} aria-label="Type">
            <option value="">All types</option>
            {HOLIDAY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>

          <select className={filterSelect} value={observance} onChange={(e) => setObservance(e.target.value)} aria-label="Observance">
            <option value="">All observance</option>
            {OBSERVANCE.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>

          <select
            className={filterSelect}
            value={status}
            onChange={(e) => setStatus(e.target.value as "active" | "inactive" | "all")}
            aria-label="Status"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All statuses</option>
          </select>

          <select
            className={filterSelect}
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as "customer" | "month")}
            aria-label="Group by"
          >
            <option value="customer">Group: Customer</option>
            <option value="month">Group: Month</option>
          </select>

          {hasExtraFilters && (
            <button type="button" className={btnSecondary} onClick={clearFilters} title="Clear filters">
              <FilterX size={14} /> Clear
            </button>
          )}
        </div>
        <FilterChips
          filters={activeFilters}
          onClearAll={hasExtraFilters ? clearFilters : undefined}
          trailing={<span>{filtered.length} holiday{filtered.length === 1 ? "" : "s"}</span>}
        />
      </div>

      {loading ? (
        <Spinner label="Loading holidays…" />
      ) : error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : filtered.length === 0 ? (
        <div className="glass fx-gradient-border rounded-card">
          <EmptyState
            icon={<CalendarDays size={22} />}
            message={
              hasExtraFilters || search.trim()
                ? "No holidays match your filters"
                : status === "inactive"
                  ? `No deactivated holidays for ${year}`
                  : <TeachingEmpty page="holidays" />
            }
            actionLabel={canWrite && status === "active" && !hasExtraFilters ? "Add Holiday" : undefined}
            onAction={canWrite && status === "active" && !hasExtraFilters ? () => setModal({}) : undefined}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.key} className="overflow-hidden rounded-card border border-subtle bg-surface-1">
              <div className="fx-hairline-b flex flex-wrap items-center gap-2 px-4 py-3">
                {groupBy === "customer" ? (
                  <Building2 size={16} className="text-muted" aria-hidden />
                ) : (
                  <CalendarDays size={16} className="text-muted" aria-hidden />
                )}
                <span className="text-sm font-bold text-primary">{g.title}</span>
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-secondary ring-1 ring-inset ring-subtle">
                  {g.list.length}
                </span>
              </div>
              {renderTable(g.list, groupBy === "month")}
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
      {viewing && (
        <HolidayViewModal
          holiday={viewing}
          customerName={customerName}
          branchName={branchName}
          onClose={() => setViewing(null)}
          onEdit={canWrite ? () => { const h = viewing; setViewing(null); setModal({ initial: h }); } : undefined}
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
      {deleting && (
        <ConfirmModal
          title="Delete holiday"
          message={<>Permanently delete <b>{deleting.name}</b> ({fmtDate(deleting.holiday_date)})? This cannot be undone. The date will also disappear from the branch Holiday Billing Policy.</>}
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={deleteHoliday}
          onClose={() => setDeleting(null)}
        />
      )}
      {toast}
    </div>
  );
}

/* ================================================================ VIEW MODAL */

function HolidayViewModal({
  holiday,
  customerName,
  branchName,
  onClose,
  onEdit,
}: {
  holiday: Holiday;
  customerName: (id?: number | null) => string | null;
  branchName: (id?: number | null) => string | null;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex flex-col gap-0.5 border-b border-subtle py-2 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="w-44 shrink-0 text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
      <span className="min-w-0 text-sm text-primary">{value ?? "—"}</span>
    </div>
  );

  return (
    <Modal
      title={holiday.name}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          {onEdit && (
            <button type="button" className={btnPrimary} onClick={onEdit}>
              Edit
            </button>
          )}
          <button type="button" className={btnSecondary} onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <div className="space-y-0">
        <Row label="Holiday" value={holiday.name} />
        <Row label="Date" value={fmtDate(holiday.holiday_date)} />
        <Row label="Day" value={holiday.holiday_date ? weekday(holiday.holiday_date) : "—"} />
        <Row label="Year" value={holiday.year || (holiday.holiday_date || "").slice(0, 4) || "—"} />
        <Row label="Type" value={holiday.holiday_type || "—"} />
        <Row label="Observance" value={holiday.observance || "Mandatory"} />
        <Row
          label="Customer"
          value={holiday.customer_id ? customerName(holiday.customer_id) : "All customers"}
        />
        <Row
          label="Branch"
          value={holiday.branch_id ? branchName(holiday.branch_id) : (holiday.customer_id ? "—" : "All branches")}
        />
        <Row label="Status" value={<StatusBadge status={holiday.is_active ? "Active" : "Inactive"} />} />
      </div>
    </Modal>
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
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>(
    initial?.branch_id ? [String(initial.branch_id)] : [],
  );
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [branches, setBranches] = useState<BranchLite[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBranches([]);
    if (!customerId) {
      setSelectedBranchIds([]);
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

  useEffect(() => {
    if (!branches.length) return;
    const valid = new Set(branches.map((b) => String(b.id)));
    setSelectedBranchIds((prev) => {
      const next = prev.filter((id) => valid.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [branches]);

  const needsBranch = type === "Customer" || !!customerId;
  const allSelected = branches.length > 0 && selectedBranchIds.length === branches.length;

  const toggleBranch = (id: string) => {
    setSelectedBranchIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const selectAllBranches = () => {
    setSelectedBranchIds(branches.map((b) => String(b.id)));
  };

  const clearBranches = () => setSelectedBranchIds([]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim() && !nameId) errs.name = "Holiday name is required";
    if (!date) errs.date = "Holiday date is required";
    if (type === "Customer" && !customerId) errs.customer = "Select a customer for a customer-specific holiday";
    if (needsBranch && selectedBranchIds.length === 0) {
      errs.branch = "Select one or more branches (or Select all)";
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const ids = selectedBranchIds.map(Number);
      const payload = {
        name: name.trim() || undefined,
        holiday_name_id: nameId ? Number(nameId) : null,
        holiday_date: date,
        holiday_type: type,
        observance,
        customer_id: customerId ? Number(customerId) : null,
        branch_id: ids.length === 1 ? ids[0] : null,
        branch_ids: ids,
        all_branches: false,
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
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title={initial ? "Edit Holiday" : "Add Holiday"}
        subtitle="Select one or more branches for this customer. The holiday is mapped to each selected branch’s Holiday Billing Policy."
        icon={<CalendarDays size={20} aria-hidden />}
      >
        <form onSubmit={submit} className="space-y-5">
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
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
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <WizardField label="Type">
              <select
                className={inputCls}
                value={type}
                onChange={(e) => {
                  const next = e.target.value;
                  setType(next);
                  if (next === "Customer" && !customerId) setSelectedBranchIds([]);
                }}
              >
                {HOLIDAY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </WizardField>
            <WizardField label="Observance">
              <select className={inputCls} value={observance} onChange={(e) => setObservance(e.target.value)}>
                {OBSERVANCE.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </WizardField>
          </div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <WizardField
              label={type === "Customer" ? "Customer" : "Customer (optional)"}
              required={type === "Customer"}
              error={errors.customer}
              icon="building"
            >
              <select
                className={inputCls}
                value={customerId}
                onChange={(e) => { setCustomerId(e.target.value); setSelectedBranchIds([]); }}
              >
                <option value="">{type === "Customer" ? "— Select customer —" : "— All customers —"}</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </WizardField>
            <WizardField
              label={needsBranch ? "Branch" : "Branch (optional)"}
              required={needsBranch}
              error={errors.branch}
              icon="building"
              filled={selectedBranchIds.length > 0}
            >
              <div className={`rounded-xl border bg-[color:var(--wiz-field-bg,transparent)] ${errors.branch ? "border-red-400" : "border-[color:var(--wiz-border)]"}`}>
                {!customerId ? (
                  <p className="px-3 py-3 text-sm text-muted">Select a customer first</p>
                ) : branchesLoading ? (
                  <p className="px-3 py-3 text-sm text-muted">Loading branches…</p>
                ) : branches.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-muted">No branches for this customer</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--wiz-border)] px-3 py-2">
                      <button
                        type="button"
                        className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300"
                        onClick={allSelected ? clearBranches : selectAllBranches}
                      >
                        {allSelected ? "Clear all" : "Select all"}
                      </button>
                      <span className="text-xs text-muted">
                        {selectedBranchIds.length} of {branches.length} selected
                      </span>
                    </div>
                    <div className="max-h-48 space-y-0.5 overflow-y-auto p-2" role="group" aria-label="Branches">
                      {branches.map((b) => {
                        const id = String(b.id);
                        const on = selectedBranchIds.includes(id);
                        return (
                          <label
                            key={b.id}
                            className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors
                              ${on ? "bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-200" : "text-secondary hover:bg-surface-2"}`}
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-brand-600"
                              checked={on}
                              onChange={() => toggleBranch(id)}
                            />
                            <span className="truncate font-medium">{b.branch_name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
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
