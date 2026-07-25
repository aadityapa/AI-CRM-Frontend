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
  sort,
  onSort,
  onPage,
  onRowClick,
  rowActions,
  filters,
  emptyMessage = "No records found",
}: {
  columns: Column<T>[];
  rows: T[];
  meta?: Meta;
  loading?: boolean;
  search?: string;
  onSearch?: (q: string) => void;
  sort?: { by: string; dir: "asc" | "desc" };
  onSort?: (by: string) => void;
  onPage?: (page: number) => void;
  onRowClick?: (row: T) => void;
  /** Optional last column (right-aligned). Clicks inside stopPropagation from row navigation. */
  rowActions?: (row: T) => React.ReactNode;
  filters?: React.ReactNode;
  emptyMessage?: string;
}) {
  const reduce = useReducedMotion();
  const allColumns: Column<T>[] = rowActions
    ? [
        ...columns,
        {
          key: "_row_actions",
          label: "",
          align: "right",
          className: "w-24",
          render: (row) => (
            <div
              className="flex justify-end"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {rowActions(row)}
            </div>
          ),
        },
      ]
    : columns;
  const colCount = allColumns.length;
  return (
    <div className="elev-1 overflow-hidden rounded-panel">
      {(onSearch || filters) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-subtle px-4 py-3">
          {onSearch && (
            <div className="relative w-full sm:w-auto">
              <Search size={15} className="absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-muted" />
              <input
                className={`${inputCls} pl-8 sm:!w-60`}
                placeholder="Search…"
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
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm lg:min-w-0">
          {/* Sticky opaque header: surface bg + subtle bottom border. */}
          <thead className="sticky top-0 z-10 bg-surface-1">
            <tr className="border-b border-subtle text-left">
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
            {loading ? (
              /* Skeleton loading rows (.shimmer recipe) — same geometry as data rows. */
              Array.from({ length: SKELETON_ROWS }).map((_, r) => (
                <tr key={`skeleton-${r}`} className="border-b border-subtle">
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
                <td colSpan={colCount}>
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
                  }`}
                  onClick={() => onRowClick && onRowClick(row)}
                >
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
