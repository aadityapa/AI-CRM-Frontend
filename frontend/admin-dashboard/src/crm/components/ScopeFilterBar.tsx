/**
 * Customer → branch → project scope picker (branch added 2 Nov 2026) (moved out of the Revenue report, 24 Oct 2026,
 * so the Dashboard's Finance tab uses the same one). The project list is scoped
 * to the chosen customer; quiet accounts stay selectable, grouped apart.
 */
import { Filter, X } from "lucide-react";
import { CONTROL } from "./controlTower";

export type FilterOption = {
  id: number; name: string; customer_id?: number | null;
  /** Projects carry their delivery branch, so the list can follow the branch. */
  branch_id?: number | null;
  /** Did this account/project bill inside the selected period? */
  billed?: boolean;
  /** Dormant records stay selectable — they are just labelled. */
  active?: boolean;
};

/** Branch value meaning "projects with no branch on record". */
export const NO_BRANCH = 0;

/** PURE: the projects the pickers offer for a customer + branch. */
export function scopedProjects(projects: FilterOption[], customerId: number | null, branchId: number | null): FilterOption[] {
  return projects.filter((p) =>
    (customerId === null || p.customer_id === customerId)
    && (branchId === null || (branchId === NO_BRANCH ? !p.branch_id : p.branch_id === branchId)));
}

export function ScopeFilterBar({
  options, customerId, projectId, onCustomer, onProject, branchId = null, onBranch,
}: {
  options: { customers: FilterOption[]; projects: FilterOption[]; branches?: FilterOption[] };
  customerId: number | null;
  projectId: number | null;
  onCustomer: (v: number | null) => void;
  onProject: (v: number | null) => void;
  /** Optional (2 Nov 2026): pass both to show the Branch picker. */
  branchId?: number | null;
  onBranch?: (v: number | null) => void;
}) {
  const showBranch = !!onBranch && (options.branches?.length ?? 0) > 0;
  const projects = scopedProjects(options.projects, customerId, showBranch ? branchId : null);
  const branches = (options.branches || []).filter((b) => customerId === null || b.customer_id === customerId);
  const custName = (id?: number | null) => options.customers.find((c) => c.id === id)?.name;
  const branchLabel = (b: FilterOption) =>
    customerId === null && custName(b.customer_id) ? `${custName(b.customer_id)} · ${b.name}` : b.name;
  const active = customerId !== null || projectId !== null || (showBranch && branchId !== null);

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
      {showBranch && (
        <select
          className={`${CONTROL} w-[13rem] max-w-full`}
          value={branchId ?? ""}
          onChange={(e) => onBranch!(e.target.value === "" ? null : Number(e.target.value))}
          aria-label="Filter by customer branch"
        >
          <option value="">All branches</option>
          {branches.filter((b) => b.billed).length > 0 && (
            <optgroup label="Billed in this period">
              {branches.filter((b) => b.billed).map((b) => <option key={b.id} value={b.id}>{branchLabel(b)}</option>)}
            </optgroup>
          )}
          {branches.filter((b) => !b.billed).length > 0 && (
            <optgroup label="No billing in this period">
              {branches.filter((b) => !b.billed).map((b) => <option key={b.id} value={b.id}>{branchLabel(b)}</option>)}
            </optgroup>
          )}
          <option value={NO_BRANCH}>No branch on record</option>
        </select>
      )}
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
          onClick={() => { onCustomer(null); onProject(null); onBranch?.(null); }}
        >
          <X className="h-3.5 w-3.5" aria-hidden /> Clear
        </button>
      )}
    </div>
  );
}

