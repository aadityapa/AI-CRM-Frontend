/**
 * Directory toolbar: saved views, filters, and the table/card switch.
 *
 * Sits inside DataTable's `filters` slot so it shares the table's sticky
 * header treatment rather than becoming a second floating bar.
 */
import { LayoutGrid, Rows3 } from "lucide-react";

import { inputCls, statusLabel } from "../../components/ui";
import { MultiSelectFilter } from "../../components/MultiSelectFilter";

export type ViewMode = "table" | "cards";

const segBtn =
  "rounded-[4px] px-3 py-1 text-sm font-semibold text-muted transition-colors duration-micro ease-smooth " +
  "hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";
const segActive = "bg-surface-1 text-primary shadow-raised";

export function ProfileToolbar({
  bucket,
  onBucket,
  status,
  onStatus,
  statusOptions,
  opportunityId,
  onOpportunity,
  opportunities,
  taOwners,
  taOwnerId,
  onTaOwner,
  customers,
  customerId,
  onCustomer,
  appliedFrom,
  appliedTo,
  onApplied,
  source,
  onSource,
  view,
  onView,
  extra,
}: {
  bucket: "active" | "rejected";
  onBucket: (b: "active" | "rejected") => void;
  status: string;
  onStatus: (s: string) => void;
  statusOptions: readonly string[];
  opportunityId: string;
  onOpportunity: (id: string) => void;
  opportunities: { id: number; opp_id?: string | null; title?: string | null; customer_name?: string | null }[];
  taOwners: { id: number; name: string }[];
  taOwnerId: string;
  onTaOwner: (v: string) => void;
  customers: { id: number; name: string }[];
  customerId: string;
  onCustomer: (v: string) => void;
  /** Applied-on window (YYYY-MM-DD, inclusive). */
  appliedFrom: string;
  appliedTo: string;
  onApplied: (from: string, to: string) => void;
  source: string;
  onSource: (v: string) => void;
  view: ViewMode;
  onView: (v: ViewMode) => void;
  /** Column customiser button and anything else the page wants to append. */
  extra?: React.ReactNode;
}) {
  return (
    <>
      {/* Saved views. Two buckets today (active / rejected) — the segmented
          control is here so adding "Shortlisted" later is a data change. */}
      <div className="inline-flex gap-0.5 rounded-control bg-surface-2 p-0.5" role="tablist" aria-label="Saved views">
        <button
          type="button"
          role="tab"
          aria-selected={bucket === "active"}
          className={`${segBtn} ${bucket === "active" ? segActive : ""}`}
          onClick={() => onBucket("active")}
        >
          In pipeline
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={bucket === "rejected"}
          className={`${segBtn} ${bucket === "rejected" ? segActive : ""}`}
          onClick={() => onBucket("rejected")}
        >
          Closed
        </button>
      </div>

      {/* Multi-select: reviewers work across several stages at once, so
          "everything waiting on me" should be one filter, not four visits. */}
      <MultiSelectFilter
        label="Status"
        allLabel="All statuses"
        options={statusOptions.map((s) => ({ value: s, label: statusLabel(s) }))}
        selected={status ? status.split(",").filter(Boolean) : []}
        onChange={(next) => onStatus(next.join(","))}
      />

      {/* Multi-select + searchable (Aug 2026): recruiters compare across several
          roles at once, and the opportunity list is far too long for a native
          <select>. opportunityId travels as a CSV of ids. */}
      <MultiSelectFilter
        label="Opportunities"
        allLabel="All opportunities"
        searchable
        options={opportunities.map((o) => ({
          value: String(o.id),
          label: `${o.opp_id || `#${o.id}`}${o.customer_name ? ` · ${o.customer_name}` : ""}${o.title ? ` — ${o.title}` : ""}`,
        }))}
        selected={opportunityId ? opportunityId.split(",").filter(Boolean) : []}
        onChange={(next) => onOpportunity(next.join(","))}
      />

      <label className="sr-only" htmlFor="profile-ta-owner-filter">TA owner</label>
      <select
        id="profile-ta-owner-filter"
        className={`${inputCls} !w-auto max-w-[190px]`}
        value={taOwnerId}
        onChange={(e) => onTaOwner(e.target.value)}
      >
        <option value="">All TA owners</option>
        {taOwners.map((o) => (
          <option key={o.id} value={String(o.id)}>{o.name}</option>
        ))}
      </select>

      <label className="sr-only" htmlFor="profile-customer-filter">Customer</label>
      <select
        id="profile-customer-filter"
        className={`${inputCls} !w-auto max-w-[190px]`}
        value={customerId}
        onChange={(e) => onCustomer(e.target.value)}
      >
        <option value="">All customers</option>
        {customers.map((c) => (
          <option key={c.id} value={String(c.id)}>{c.name}</option>
        ))}
      </select>

      {/* Applied-on window (11 Sep 2026, TA request): "who did I submit this
          week / this month" is the recruiter's daily question. */}
      <div className="inline-flex items-center gap-1 text-xs text-muted" role="group" aria-label="Applied between">
        <span className="hidden sm:inline">Applied</span>
        <input
          type="date"
          aria-label="Applied from"
          className={`${inputCls} !w-auto !py-1`}
          value={appliedFrom}
          max={appliedTo || undefined}
          onChange={(e) => onApplied(e.target.value, appliedTo)}
        />
        <span>–</span>
        <input
          type="date"
          aria-label="Applied to"
          className={`${inputCls} !w-auto !py-1`}
          value={appliedTo}
          min={appliedFrom || undefined}
          onChange={(e) => onApplied(appliedFrom, e.target.value)}
        />
      </div>

      <label className="sr-only" htmlFor="profile-source-filter">Source</label>
      <select
        id="profile-source-filter"
        className={`${inputCls} !w-auto max-w-[150px]`}
        value={source}
        onChange={(e) => onSource(e.target.value)}
      >
        <option value="">All sources</option>
        <option value="manual">Added by TA</option>
        <option value="apply_link">Apply link</option>
        <option value="resume_upload">Resume upload</option>
        <option value="zoho_import">Zoho import</option>
      </select>

      {extra}

      <div className="ml-auto inline-flex gap-0.5 rounded-control bg-surface-2 p-0.5" role="group" aria-label="View style">
        <button
          type="button"
          aria-pressed={view === "table"}
          aria-label="Table view"
          className={`grid h-7 w-8 place-items-center rounded-[4px] text-muted transition-colors duration-micro
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
            ${view === "table" ? segActive : "hover:text-primary"}`}
          onClick={() => onView("table")}
        >
          <Rows3 size={14} aria-hidden />
        </button>
        <button
          type="button"
          aria-pressed={view === "cards"}
          aria-label="Card view"
          className={`grid h-7 w-8 place-items-center rounded-[4px] text-muted transition-colors duration-micro
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
            ${view === "cards" ? segActive : "hover:text-primary"}`}
          onClick={() => onView("cards")}
        >
          <LayoutGrid size={14} aria-hidden />
        </button>
      </div>
    </>
  );
}
