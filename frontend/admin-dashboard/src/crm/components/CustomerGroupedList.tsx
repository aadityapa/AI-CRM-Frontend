/**
 * Customer-wise list (14 Sep 2026, user request): the Purchase Orders tab's
 * "customers first, their rows beneath" layout, made reusable for every tab
 * of the Projects hub — Projects, Project Employees, Timesheets, Invoices and
 * Customer Received Amount.
 *
 * One expandable section per customer with a count and a summary; the rows
 * inside reuse the page's own DataTable columns. Search auto-opens matching
 * sections (a search means "find that row"). Pages keep their flat, paged
 * table behind a "Flat list" toggle (`ViewToggle`) so nothing is lost.
 */
import { useMemo, useState } from "react";
import { Building2, ChevronDown, ChevronRight, LayoutList, Rows3 } from "lucide-react";

import type { Column } from "./DataTable";

export type GroupView = "customer" | "flat";

const VIEW_KEY = "crm.hub.view";

/** Remembered per browser: once someone picks Flat list, every hub tab opens that way. */
export function useGroupView(): [GroupView, (v: GroupView) => void] {
  const [view, set] = useState<GroupView>(() => {
    try { return (localStorage.getItem(VIEW_KEY) as GroupView) === "flat" ? "flat" : "customer"; } catch { return "customer"; }
  });
  return [view, (v) => { set(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } }];
}

export function ViewToggle({ view, onChange }: { view: GroupView; onChange: (v: GroupView) => void }) {
  const seg = "inline-flex items-center gap-1 rounded-[4px] px-2.5 py-1 text-xs font-semibold transition-colors duration-micro";
  return (
    <div className="inline-flex gap-0.5 rounded-control bg-surface-2 p-0.5" role="group" aria-label="List layout">
      <button type="button" aria-pressed={view === "customer"}
        className={`${seg} ${view === "customer" ? "bg-surface-1 text-primary shadow-raised" : "text-muted hover:text-primary"}`}
        onClick={() => onChange("customer")}>
        <Building2 size={13} aria-hidden /> By customer
      </button>
      <button type="button" aria-pressed={view === "flat"}
        className={`${seg} ${view === "flat" ? "bg-surface-1 text-primary shadow-raised" : "text-muted hover:text-primary"}`}
        onClick={() => onChange("flat")}>
        <Rows3 size={13} aria-hidden /> Flat list
      </button>
    </div>
  );
}

export type CustomerGroup<T> = { customer_id: number; name: string; rows: T[] };

type Props<T> = {
  rows: T[];
  loading?: boolean;
  columns: Column<T>[];
  customerId: (r: T) => number | null | undefined;
  customerName: (r: T) => string | null | undefined;
  /** Client-side search over the whole tab; return true to keep the row. */
  search?: string;
  matches?: (r: T, needle: string) => boolean;
  /** Singular noun for the count pill ("project", "timesheet"). */
  noun: string;
  /** Right-hand summary of one customer's rows (totals, counts). */
  summary?: (rows: T[]) => React.ReactNode;
  onRowClick?: (r: T) => void;
  rowActions?: (r: T) => React.ReactNode;
  rowKey?: (r: T) => string | number;
  empty?: React.ReactNode;
};

export function CustomerGroupedList<T>({
  rows, loading, columns, customerId, customerName, search = "", matches, noun,
  summary, onRowClick, rowActions, rowKey, empty,
}: Props<T>) {
  const groups = useMemo<CustomerGroup<T>[]>(() => {
    const needle = search.trim().toLowerCase();
    const visible = !needle || !matches ? rows : rows.filter((r) =>
      matches(r, needle) || (customerName(r) || "").toLowerCase().includes(needle));
    const by = new Map<number, CustomerGroup<T>>();
    for (const r of visible) {
      const cid = customerId(r) ?? 0;
      const g = by.get(cid) || { customer_id: cid, name: customerName(r) || (cid ? `Customer #${cid}` : "No customer"), rows: [] };
      g.rows.push(r);
      by.set(cid, g);
    }
    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, search, matches, customerId, customerName]);

  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const toggle = (cid: number) => setExpanded((p) => ({ ...p, [cid]: !p[cid] }));
  // A search means "find that row" — open every matching section; otherwise
  // a single customer's tab opens itself so the page is never a lone header.
  const isOpen = (cid: number) => (search.trim() ? expanded[cid] !== false
    : groups.length === 1 ? expanded[cid] !== false : !!expanded[cid]);

  if (loading) return <div className="p-6 text-sm text-muted">Loading…</div>;
  if (groups.length === 0) return <>{empty ?? <div className="rounded-card border border-subtle bg-surface-1 p-6 text-sm text-muted">Nothing to show.</div>}</>;

  const visibleCols = columns;
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.customer_id} className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
          <button
            type="button"
            onClick={() => toggle(g.customer_id)}
            className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors duration-micro hover:bg-surface-2"
            aria-expanded={isOpen(g.customer_id)}
          >
            {isOpen(g.customer_id)
              ? <ChevronDown size={16} className="shrink-0 text-muted" aria-hidden />
              : <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden />}
            <Building2 size={16} className="shrink-0 text-brand-600 dark:text-brand-300" aria-hidden />
            <span className="text-sm font-bold text-primary">{g.name}</span>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-secondary">
              {g.rows.length} {noun}{g.rows.length === 1 ? "" : "s"}
            </span>
            {summary && <span className="ml-auto flex flex-wrap gap-x-5 text-xs text-muted">{summary(g.rows)}</span>}
          </button>
          {isOpen(g.customer_id) && (
            <div className="overflow-x-auto border-t border-subtle">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted">
                    {visibleCols.map((c) => (
                      <th key={String(c.key)} className={`px-3 py-2 first:pl-4 ${c.align === "right" ? "text-right" : ""}`}>{c.label}</th>
                    ))}
                    {rowActions && <th className="px-3 py-2"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r, i) => (
                    <tr
                      key={rowKey ? rowKey(r) : i}
                      className={`border-t border-subtle ${onRowClick ? "row-hover cursor-pointer" : ""}`}
                      onClick={onRowClick ? () => onRowClick(r) : undefined}
                    >
                      {visibleCols.map((c) => (
                        <td key={String(c.key)} className={`px-3 py-2.5 first:pl-4 align-top ${c.align === "right" ? "text-right tnum" : ""} ${c.className || ""}`}>
                          {c.render ? c.render(r) : String((r as any)[c.key] ?? "—")}
                        </td>
                      ))}
                      {rowActions && (
                        <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>{rowActions(r)}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
