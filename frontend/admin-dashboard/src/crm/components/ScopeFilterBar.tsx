/**
 * Customer → project scope picker (moved out of the Revenue report, 24 Oct 2026,
 * so the Dashboard's Finance tab uses the same one). The project list is scoped
 * to the chosen customer; quiet accounts stay selectable, grouped apart.
 */
import { Filter, X } from "lucide-react";
import { CONTROL } from "./controlTower";

export type FilterOption = {
  id: number; name: string; customer_id?: number | null;
  /** Did this account/project bill inside the selected period? */
  billed?: boolean;
  /** Dormant records stay selectable — they are just labelled. */
  active?: boolean;
};

export function ScopeFilterBar({
  options, customerId, projectId, onCustomer, onProject,
}: {
  options: { customers: FilterOption[]; projects: FilterOption[] };
  customerId: number | null;
  projectId: number | null;
  onCustomer: (v: number | null) => void;
  onProject: (v: number | null) => void;
}) {
  const projects = customerId
    ? options.projects.filter((p) => p.customer_id === customerId)
    : options.projects;
  const active = customerId !== null || projectId !== null;

  /**
   * Split into "billed here" and "everything else" rather than filtering the
   * quiet ones out. A dropdown that hides an account the CEO knows exists reads
   * as a bug, and "why did this one bill nothing?" is a question this page
   * should answer — so the option has to be selectable.
   */
  const split = (rows: FilterOption[]) => ({
    billed: rows.filter((r) => r.billed),
    quiet: rows.filter((r) => !r.billed),
  });
  const label = (r: FilterOption) => (r.active === false ? `${r.name} (inactive)` : r.name);
  const cust = split(options.customers);
  const proj = split(projects);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <Filter className="h-3.5 w-3.5" aria-hidden /> Scope
      </span>
      <select
        className={`${CONTROL} w-[13rem] max-w-full`}
        value={customerId ?? ""}
        onChange={(e) => onCustomer(e.target.value ? Number(e.target.value) : null)}
        aria-label="Filter by customer"
      >
        <option value="">All customers</option>
        {cust.billed.length > 0 && (
          <optgroup label="Billed in this period">
            {cust.billed.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}
          </optgroup>
        )}
        {cust.quiet.length > 0 && (
          <optgroup label="No billing in this period">
            {cust.quiet.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}
          </optgroup>
        )}
      </select>
      <select
        className={`${CONTROL} w-[13rem] max-w-full`}
        value={projectId ?? ""}
        onChange={(e) => onProject(e.target.value ? Number(e.target.value) : null)}
        aria-label="Filter by project"
        disabled={projects.length === 0}
      >
        <option value="">All projects</option>
        {proj.billed.length > 0 && (
          <optgroup label="Billed in this period">
            {proj.billed.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
          </optgroup>
        )}
        {proj.quiet.length > 0 && (
          <optgroup label="No billing in this period">
            {proj.quiet.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
          </optgroup>
        )}
      </select>
      {active && (
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1 rounded-control px-2 text-xs font-semibold text-brand-600 transition-colors duration-micro hover:bg-surface-2 dark:text-brand-300"
          onClick={() => { onCustomer(null); onProject(null); }}
        >
          <X className="h-3.5 w-3.5" aria-hidden /> Clear
        </button>
      )}
    </div>
  );
}

