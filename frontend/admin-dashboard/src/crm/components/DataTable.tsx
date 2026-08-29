/** Generic CRM list table: search, filter slot, pagination, column sorting.
 * Calm-premium recipe: opaque raised card (.elev-1), zebra-free rows with a
 * 48px minimum height, sticky opaque header with a subtle bottom border,
 * 150ms neutral hover shift, shimmer skeleton loading rows, and token-only
 * pagination controls. Numeric columns opt into right alignment via
 * Column.align = "right" (rendered with tabular figures). */
import React, { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown, Filter, Search } from "lucide-react";
import type { Meta } from "../api";
import { EmptyState, btnPrimary, btnSecondary, focusRing, inputCls } from "./ui";

/** Per-column filter (Aug 2026) — OPT-IN. A column that declares `filter` gets
 * a funnel in its header; the page receives the value and re-queries the
 * SERVER, so filtering covers the whole dataset, not just the visible page. */
export type ColumnFilterDef =
  | { type: "text"; placeholder?: string }
  | { type: "number-range"; minLabel?: string; maxLabel?: string; step?: number }
  | { type: "date-range" }
  | { type: "select"; options: { value: string; label: string }[] };

export type ColumnFilterValue = {
  text?: string; value?: string; min?: string; max?: string; from?: string; to?: string;
};

export function columnFilterActive(v?: ColumnFilterValue): boolean {
  if (!v) return false;
  return Boolean(v.text || v.value || v.min || v.max || v.from || v.to);
}

export type Column<T> = {
  key: string;
  label: string;
  sortable?: boolean;
  /** Right-align this column (numbers, amounts). Rendered with tabular-nums. */
  align?: "right";
  render?: (row: T) => React.ReactNode;
  className?: string;
  /** Opt-in header filter — see ColumnFilterDef. Requires the table's
   * `onColumnFilter` prop; ignored otherwise. */
  filter?: ColumnFilterDef;
};

/** The header funnel + its popover. Fixed-positioned from the button rect so
 * the table's horizontal scroll container cannot clip it. */
function HeaderFilter({
  column, value, onApply,
}: {
  column: { key: string; label: string; filter: ColumnFilterDef };
  value?: ColumnFilterValue;
  onApply: (v: ColumnFilterValue | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ColumnFilterValue>(value || {});
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const active = columnFilterActive(value);

  useEffect(() => { if (open) setDraft(value || {}); }, [open, value]);
  useEffect(() => {
    if (!open) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 268)) });
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)
          && !btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const apply = () => { onApply(columnFilterActive(draft) ? draft : null); setOpen(false); };
  const clear = () => { onApply(null); setOpen(false); };
  const fld = `${inputCls} h-8 text-sm`;
  const def = column.filter;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-label={`Filter ${column.label}`}
        aria-expanded={open}
        className={`rounded-control p-0.5 transition-colors duration-micro ${
          active ? "text-brand-600 dark:text-brand-300" : "text-muted opacity-50 hover:opacity-100 hover:text-primary"
        }`}
      >
        <Filter size={12} fill={active ? "currentColor" : "none"} />
      </button>
      {open && (
        <div
          ref={panelRef}
          style={{ position: "fixed", top: pos.top, left: pos.left }}
          className="z-50 w-64 rounded-card border border-subtle bg-surface-1 p-3 shadow-overlay"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
        >
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
            Filter: {column.label}
          </div>
          {def.type === "text" && (
            <input autoFocus className={fld} placeholder={def.placeholder || "Contains…"}
              value={draft.text || ""}
              onChange={(e) => setDraft({ text: e.target.value })} />
          )}
          {def.type === "select" && (
            <select autoFocus className={fld} value={draft.value || ""}
              onChange={(e) => setDraft({ value: e.target.value })}>
              <option value="">All</option>
              {def.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          {def.type === "number-range" && (
            <div className="flex items-center gap-2">
              <input autoFocus type="number" step={def.step ?? 1} className={fld}
                placeholder={def.minLabel || "Min"} value={draft.min || ""}
                onChange={(e) => setDraft((d) => ({ ...d, min: e.target.value }))} />
              <span className="text-xs text-muted">to</span>
              <input type="number" step={def.step ?? 1} className={fld}
                placeholder={def.maxLabel || "Max"} value={draft.max || ""}
                onChange={(e) => setDraft((d) => ({ ...d, max: e.target.value }))} />
            </div>
          )}
          {def.type === "date-range" && (
            <div className="space-y-2">
              <input autoFocus type="date" className={fld} value={draft.from || ""}
                onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
              <input type="date" className={fld} value={draft.to || ""}
                onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            {active && (
              <button type="button" className={`${btnSecondary} !h-8 !px-3 text-xs`} onClick={clear}>
                Clear
              </button>
            )}
            <button type="button" className={`${btnPrimary} !h-8 !px-3 text-xs`} onClick={apply}>
              Apply
            </button>
          </div>
        </div>
      )}
    </>
  );
}

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
  columnFilters,
  onColumnFilter,
  headerRight,
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
  /** ReactNode so empty lists can teach (what this page is for, what to do). */
  emptyMessage?: React.ReactNode;
  /**
   * Opt-in row selection. Off by default, so every existing table that does
   * not pass these props renders exactly as before.
   */
  selectable?: boolean;
  selectedIds?: Set<string | number>;
  onSelectionChange?: (next: Set<string | number>) => void;
  /** Accessible name for a row's checkbox, e.g. (r) => r.candidate_name. */
  rowLabel?: (row: T) => string;
  /** Current per-column filter values, keyed by column key (opt-in). */
  columnFilters?: Record<string, ColumnFilterValue>;
  /** Receives a column's new filter (null = cleared). The page re-queries. */
  onColumnFilter?: (key: string, value: ColumnFilterValue | null) => void;
  /** Right-aligned extra in the search/filter row, e.g. "30 projects, page 1/1". */
  headerRight?: React.ReactNode;
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
      {(onSearch || filters || headerRight) && (
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
          {headerRight != null && <div className="ml-auto">{headerRight}</div>}
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
                  {c.filter && onColumnFilter && (
                    <HeaderFilter
                      column={{ key: c.key, label: c.label, filter: c.filter }}
                      value={columnFilters?.[c.key]}
                      onApply={(v) => onColumnFilter(c.key, v)}
                    />
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
