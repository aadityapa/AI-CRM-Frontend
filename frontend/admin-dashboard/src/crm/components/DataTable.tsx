/** Generic CRM list table: search, filter slot, pagination, column sorting.
 * Calm-premium recipe: opaque raised card (.elev-1), zebra-free rows with a
 * 48px minimum height, sticky opaque header with a subtle bottom border,
 * 150ms neutral hover shift, shimmer skeleton loading rows, and token-only
 * pagination controls. Numeric columns opt into right alignment via
 * Column.align = "right" (rendered with tabular figures). */
import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown, Search } from "lucide-react";
import type { Meta } from "../api";
import { EmptyState, focusRing, inputCls } from "./ui";

export type Column<T> = {
  key: string;
  label: string;
  sortable?: boolean;
  /** Right-align this column (numbers, amounts). Rendered with tabular-nums. */
  align?: "right";
  render?: (row: T) => React.ReactNode;
  className?: string;
};

/* Pagination buttons: bordered flat control, hover tint, 50% disabled. */
const pageBtnCls =
  `inline-flex items-center justify-center rounded-control border border-subtle bg-surface-1 p-1.5 text-secondary ` +
  `transition-colors duration-micro ease-smooth hover:border-strong hover:bg-surface-2 hover:text-primary ` +
  `active:bg-surface-0 disabled:pointer-events-none disabled:opacity-50 ${focusRing}`;

const SKELETON_ROWS = 6;
const SKELETON_WIDTHS = ["w-3/4", "w-1/2", "w-2/3"] as const;

export function DataTable<T extends { id?: number | string }>({
  columns,
  rows,
  meta,
  loading,
  search,
  onSearch,
  searchPlaceholder = "Search…",
  sort,
  onSort,
  onPage,
  onRowClick,
  rowActions,
  filters,
  emptyMessage = "No records found",
  selectable = false,
  selectedIds,
  onSelectionChange,
  rowLabel,
}: {
  columns: Column<T>[];
  rows: T[];
  meta?: Meta;
  loading?: boolean;
  search?: string;
  onSearch?: (q: string) => void;
  searchPlaceholder?: string;
  sort?: { by: string; dir: "asc" | "desc" };
  onSort?: (by: string) => void;
  onPage?: (page: number) => void;
  onRowClick?: (row: T) => void;
  /** Optional last column (right-aligned). Clicks inside stopPropagation from row navigation. */
  rowActions?: (row: T) => React.ReactNode;
  filters?: React.ReactNode;
  emptyMessage?: string;
  /**
   * Opt-in row selection. Off by default, so every existing table that does
   * not pass these props renders exactly as before.
   */
  selectable?: boolean;
  selectedIds?: Set<string | number>;
  onSelectionChange?: (next: Set<string | number>) => void;
  /** Accessible name for a row's checkbox, e.g. (r) => r.candidate_name. */
  rowLabel?: (row: T) => string;
}) {
  const reduce = useReducedMotion();

  const selected = selectedIds ?? new Set<string | number>();
  const pageIds = rows.map((r) => r.id).filter((id): id is string | number => id != null);
  const selectedOnPage = pageIds.filter((id) => selected.has(id)).length;
  const allOnPageSelected = pageIds.length > 0 && selectedOnPage === pageIds.length;
  // Header checkbox shows a dash when only some of the page is selected —
  // "select all" and "some are selected" are different states and a plain
  // unchecked box would misreport the second as the first.
  const someOnPageSelected = selectedOnPage > 0 && !allOnPageSelected;

  const toggleRow = (id: string | number) => {
    if (!onSelectionChange) return;
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    onSelectionChange(next);
  };

  const togglePage = () => {
    if (!onSelectionChange) return;
    const next = new Set(selected);
    // Selection survives pagination, so only this page's ids are touched.
    if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    onSelectionChange(next);
  };

  const allColumns: Column<T>[] = rowActions
    ? [
        ...columns,
        {
          key: "_row_actions",
          label: "",
          align: "right",
          className: "w-24",
          render: (row) => rowActions(row),
        },
      ]
    : columns;
  const colCount = allColumns.length;
  return (
    <div className="elev-1 min-w-0 overflow-hidden rounded-panel">
      {(onSearch || filters) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-subtle px-4 py-3">
          {onSearch && (
            <div className="relative w-full sm:w-auto">
              <Search size={15} className="absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-muted" />
              <input
                className={`${inputCls} pl-8 sm:!w-60`}
                placeholder={searchPlaceholder}
                value={search || ""}
                onChange={(e) => onSearch(e.target.value)}
              />
            </div>
          )}
          {filters}
        </div>
      )}
      {/* Mobile/tablet: table keeps its natural width and scrolls horizontally
          instead of crushing columns; from lg it fits the panel again. */}
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full min-w-max text-sm lg:min-w-0">
          {/* Sticky opaque header: surface bg + subtle bottom border. */}
          <thead className="sticky top-0 z-10 bg-surface-1">
            <tr className="border-b border-subtle text-left">
              {selectable && (
                <th scope="col" className="w-10 px-4 py-2.5">
                  <input
                    type="checkbox"
                    className="block h-3.5 w-3.5 cursor-pointer accent-brand-600"
                    checked={allOnPageSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someOnPageSelected;
                    }}
                    onChange={togglePage}
                    aria-label={allOnPageSelected ? "Deselect all rows on this page" : "Select all rows on this page"}
                  />
                </th>
              )}
              {allColumns.map((c) => (
                <th
                  key={c.key}
                  className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-muted ${
                    c.align === "right" ? "text-right" : ""
                  } ${c.className || ""}`}
                >
                  {c.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.key)}
                      aria-sort={sort?.by === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                      className={`inline-flex select-none items-center gap-1 rounded-control uppercase tracking-wide transition-colors duration-micro ease-smooth hover:text-primary active:text-primary disabled:pointer-events-none disabled:opacity-50 ${focusRing}`}
                    >
                      {c.label}
                      {sort?.by === c.key ? (
                        sort.dir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />
                      ) : (
                        /* Sortable-but-unsorted affordance: faint dual chevron. */
                        <ChevronsUpDown size={13} className="opacity-40" aria-hidden />
                      )}
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1">{c.label}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              /* Skeleton only on initial/empty load — keep existing rows visible while
                 soft-refreshing (e.g. after delete) so the list updates in place. */
              Array.from({ length: SKELETON_ROWS }).map((_, r) => (
                <tr key={`skeleton-${r}`} className="border-b border-subtle">
                  {selectable && (
                    <td className="h-12 px-4 py-2 align-middle">
                      <div className="shimmer h-3.5 w-3.5 rounded" aria-hidden />
                    </td>
                  )}
                  {allColumns.map((c, i) => (
                    <td key={c.key} className="h-12 px-4 py-2 align-middle">
                      <div
                        className={`shimmer h-3.5 rounded-control ${SKELETON_WIDTHS[(r + i) % SKELETON_WIDTHS.length]} ${
                          c.align === "right" ? "ml-auto" : ""
                        }`}
                        aria-hidden
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colCount + (selectable ? 1 : 0)}>
                  <EmptyState message={emptyMessage} />
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                /* Entrance fade only for the first screenful of rows — rows
                   beyond that render statically (no per-row animation cost). */
                <motion.tr
                  key={(row.id as React.Key) ?? i}
                  initial={reduce || i >= 12 ? false : { opacity: 0 }}
                  animate={reduce || i >= 12 ? undefined : { opacity: 1 }}
                  transition={reduce || i >= 12 ? undefined : { duration: 0.15, ease: [0.2, 0, 0, 1], delay: Math.min(i, 10) * 0.02 }}
                  /* v3: .row-hover = subtle brand-tinted row glow (bg tint
                     only — no shadows/filters on dense tables). */
                  className={`row-hover border-b border-subtle transition-colors duration-micro ease-smooth ${
                    onRowClick ? "cursor-pointer active:bg-surface-0" : ""
                  } ${row.id != null && selected.has(row.id) ? "bg-brand-50 dark:bg-brand-900/20" : ""}`}
                  onClick={() => onRowClick && onRowClick(row)}
                >
                  {selectable && (
                    /* stopPropagation: ticking a checkbox must not also open
                       the row — selecting and navigating are different intents. */
                    <td className="h-12 px-4 py-2 align-middle" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="block h-3.5 w-3.5 cursor-pointer accent-brand-600"
                        checked={row.id != null && selected.has(row.id)}
                        onChange={() => row.id != null && toggleRow(row.id)}
                        aria-label={`Select ${rowLabel ? rowLabel(row) : `row ${i + 1}`}`}
                      />
                    </td>
                  )}
                  {allColumns.map((c) => (
                    <td
                      key={c.key}
                      className={`h-12 px-4 py-2 align-middle text-secondary ${
                        c.align === "right" ? "text-right tabular-nums" : ""
                      } ${c.className || ""}`}
                    >
                      {c.render ? c.render(row) : String((row as any)[c.key] ?? "—")}
                    </td>
                  ))}
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t border-subtle px-4 py-2 text-xs text-muted lg:hidden">
        Swipe horizontally to view all columns.
      </div>
      {meta && meta.pages > 1 && onPage && (
        <div className="flex items-center justify-between border-t border-subtle px-4 py-2.5 text-sm text-secondary">
          <span>
            Page <span className="font-semibold">{meta.page}</span> of {meta.pages} · {meta.total} records
          </span>
          <div className="flex gap-1.5">
            <button
              className={pageBtnCls}
              disabled={meta.page <= 1}
              onClick={() => onPage(meta.page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              className={pageBtnCls}
              disabled={meta.page >= meta.pages}
              onClick={() => onPage(meta.page + 1)}
              aria-label="Next page"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
