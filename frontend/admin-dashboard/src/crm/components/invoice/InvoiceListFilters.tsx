/**
 * Invoices list — the Status filter and "More filters" (26 Oct 2026, user ask:
 * "a filter for the Status column on every tab, and as many more filters as
 * we can").
 *
 * The Status column is the server's `status_key` (`billing_rules.invoice_status`):
 * a Proforma is With Finance / Returned to GM; an open tax invoice is Overdue /
 * Due in 7 days / Not yet due (due date, else invoice date + 30 days); a paid
 * one is settled or still has TDS pending from the client. Each tab offers only
 * the statuses it can hold, with counts (`meta.status_counts`).
 */
import { SlidersHorizontal, X } from "lucide-react";

export type StatusCount = { key: string; label: string; count: number };
export type FilterOption = { id: number; name: string };

export type InvoiceMoreFilters = {
  employee: string;
  po: string;
  invoiceFrom: string;
  invoiceTo: string;
  dueFrom: string;
  dueTo: string;
  amountMin: string;
  amountMax: string;
};

export const EMPTY_MORE_FILTERS: InvoiceMoreFilters = {
  employee: "", po: "", invoiceFrom: "", invoiceTo: "", dueFrom: "", dueTo: "", amountMin: "", amountMax: "",
};

/** The server query of the More filters (PURE; blanks are left out). */
export function moreFilterQuery(f: InvoiceMoreFilters): Record<string, string | undefined> {
  const v = (s: string) => (s.trim() ? s.trim() : undefined);
  return {
    employee_id: v(f.employee), po_id: v(f.po),
    invoice_from: v(f.invoiceFrom), invoice_to: v(f.invoiceTo),
    due_from: v(f.dueFrom), due_to: v(f.dueTo),
    amount_min: v(f.amountMin), amount_max: v(f.amountMax),
  };
}

/** How many More filters are on (PURE) — the toggle's badge. */
export function moreFilterCount(f: InvoiceMoreFilters): number {
  return Object.values(f).filter((x) => String(x).trim() !== "").length;
}

/** A date range that ends before it starts (PURE) — said, not sent. */
export function rangeProblem(f: InvoiceMoreFilters): string | null {
  if (f.invoiceFrom && f.invoiceTo && f.invoiceTo < f.invoiceFrom) return "Invoice date: “to” is before “from”.";
  if (f.dueFrom && f.dueTo && f.dueTo < f.dueFrom) return "Due date: “to” is before “from”.";
  if (f.amountMin && f.amountMax && Number(f.amountMax) < Number(f.amountMin)) return "Amount: max is below min.";
  return null;
}

export const INVOICE_STATUS_TONE: Record<string, string> = {
  proforma_with_finance: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:ring-orange-800",
  proforma_returned: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:ring-rose-800",
  overdue: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:ring-rose-800",
  due_soon: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800",
  not_due: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-800",
  paid_tds_pending: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800",
  paid: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800",
};

const DOT: Record<string, string> = {
  proforma_with_finance: "bg-orange-500", proforma_returned: "bg-rose-500", overdue: "bg-rose-500",
  due_soon: "bg-amber-500", not_due: "bg-sky-500", paid_tds_pending: "bg-amber-500", paid: "bg-emerald-500",
};

/** The Status cell: the server's words, "· 12 d late" when overdue. */
export function InvoiceStatusChip({ statusKey, label, daysLate }: { statusKey: string; label: string; daysLate?: number | null }) {
  const tone = INVOICE_STATUS_TONE[statusKey] || "bg-surface-2 text-secondary ring-border";
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[statusKey] || "bg-slate-400"}`} />
      {label}{statusKey === "overdue" && daysLate != null && daysLate > 0 ? ` · ${daysLate} d late` : ""}
    </span>
  );
}

/** The Status pills under the tabs: All + each status this tab can hold. */
export function StatusFilterPills({ counts, value, onChange }: {
  counts: StatusCount[] | null; value: string; onChange: (key: string) => void;
}) {
  if (!counts || counts.length === 0) return null;
  const total = counts.reduce((a, c) => a + c.count, 0);
  const pill = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 transition ${
      active ? "bg-brand-600 text-[#fff] ring-brand-600" : "bg-surface-1 text-secondary ring-border hover:bg-surface-2"}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
      <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted">Status</span>
      <button type="button" className={pill(!value)} onClick={() => onChange("")} aria-pressed={!value}>
        All <span className="tnum opacity-80">{total}</span>
      </button>
      {counts.map((c) => (
        <button key={c.key} type="button" className={pill(value === c.key)} aria-pressed={value === c.key}
          onClick={() => onChange(value === c.key ? "" : c.key)}>
          <span className={`h-1.5 w-1.5 rounded-full ${DOT[c.key] || "bg-slate-400"}`} />
          {c.label} <span className="tnum opacity-80">{c.count}</span>
        </button>
      ))}
    </div>
  );
}

const CTRL = "input-recessed rounded-control px-3 py-2 text-sm";

/** "More filters (n)" toggle. */
export function MoreFiltersToggle({ open, count, onToggle }: { open: boolean; count: number; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open}
      className={`inline-flex items-center gap-1.5 rounded-control px-3 py-2 text-sm font-medium ring-1 ${
        open || count ? "bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-900/30 dark:text-brand-300 dark:ring-brand-800"
          : "bg-surface-1 text-secondary ring-border hover:bg-surface-2"}`}>
      <SlidersHorizontal size={14} /> More filters{count ? ` (${count})` : ""}
    </button>
  );
}

/** The More filters panel: employee · PO · invoice date · due date · amount. */
export function MoreFiltersPanel({ value, onChange, employees, pos }: {
  value: InvoiceMoreFilters; onChange: (next: InvoiceMoreFilters) => void;
  employees: FilterOption[]; pos: FilterOption[];
}) {
  const set = (k: keyof InvoiceMoreFilters) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  const problem = rangeProblem(value);
  const label = "mb-1 block text-xs font-semibold text-muted";
  return (
    <div className="rounded-card border border-border bg-surface-1 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className={label}>Employee</span>
          <select className={`${CTRL} w-full`} value={value.employee} onChange={set("employee")}>
            <option value="">All employees</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={label}>Purchase order</span>
          <select className={`${CTRL} w-full`} value={value.po} onChange={set("po")}>
            <option value="">All POs</option>
            {pos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <div>
          <span className={label}>Invoice date</span>
          <div className="flex items-center gap-1.5">
            <input type="date" className={`${CTRL} min-w-0 flex-1`} value={value.invoiceFrom} onChange={set("invoiceFrom")} aria-label="Invoice date from" />
            <span className="text-xs text-muted">to</span>
            <input type="date" className={`${CTRL} min-w-0 flex-1`} value={value.invoiceTo} onChange={set("invoiceTo")} aria-label="Invoice date to" />
          </div>
        </div>
        <div>
          <span className={label}>Due date</span>
          <div className="flex items-center gap-1.5">
            <input type="date" className={`${CTRL} min-w-0 flex-1`} value={value.dueFrom} onChange={set("dueFrom")} aria-label="Due date from" />
            <span className="text-xs text-muted">to</span>
            <input type="date" className={`${CTRL} min-w-0 flex-1`} value={value.dueTo} onChange={set("dueTo")} aria-label="Due date to" />
          </div>
        </div>
        <div>
          <span className={label}>Grand total (₹)</span>
          <div className="flex items-center gap-1.5">
            <input type="number" min={0} inputMode="decimal" placeholder="Min" className={`${CTRL} min-w-0 flex-1`}
              value={value.amountMin} onChange={set("amountMin")} aria-label="Minimum grand total" />
            <span className="text-xs text-muted">to</span>
            <input type="number" min={0} inputMode="decimal" placeholder="Max" className={`${CTRL} min-w-0 flex-1`}
              value={value.amountMax} onChange={set("amountMax")} aria-label="Maximum grand total" />
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {problem && <span className="text-xs font-medium text-danger">{problem}</span>}
        {moreFilterCount(value) > 0 && (
          <button type="button" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300"
            onClick={() => onChange(EMPTY_MORE_FILTERS)}>
            <X size={12} /> Clear these filters
          </button>
        )}
      </div>
    </div>
  );
}
