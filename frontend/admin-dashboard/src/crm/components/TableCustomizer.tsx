/** Per-user table layout: pick columns, order them, stack an Excel-style sort.
 *
 * The layout is saved against the signed-in user (not the browser), so it
 * follows them to any machine. Anything the server does not recognise is dropped
 * server-side, so a column removed in a later release cannot leave someone with
 * a broken saved layout.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, RotateCcw, Settings2, Trash2, X } from "lucide-react";
import { crmDelete, crmGet, crmPut } from "../api";
import {
  ErrorBox, Modal, Spinner, btnPrimary, btnSecondary, inputCls,
} from "./ui";

export type ColumnPref = { key: string; visible: boolean };
export type SortPref = { by: string; dir: "asc" | "desc" };

export type TableLayout = {
  columns: ColumnPref[];
  sort: SortPref[];
};

type PreferencePayload = TableLayout & {
  table_key: string;
  available_columns: string[];
  sortable_columns: string[];
  max_sort_levels: number;
  is_customised: boolean;
};

/** Turn a saved sort into the `?sort=` the API expects. */
export function sortToQuery(sort: SortPref[]): string | undefined {
  if (!sort.length) return undefined;
  return sort.map((s) => `${s.by}:${s.dir}`).join(",");
}

/**
 * Load and save one table's layout.
 *
 * `defaults` is the column order the page ships with — used until the user saves
 * something of their own, and as the fallback if the request fails, so the table
 * always renders.
 */
export function useTableLayout(tableKey: string, defaults: string[]) {
  const [layout, setLayout] = useState<TableLayout>(() => ({
    columns: defaults.map((key) => ({ key, visible: true })),
    sort: [],
  }));
  const [meta, setMeta] = useState<{ sortable: string[]; max: number } | null>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await crmGet<PreferencePayload>(`/api/me/table-preferences/${tableKey}`);
      const d = res.data;
      setMeta({ sortable: d.sortable_columns || [], max: d.max_sort_levels || 4 });
      // No saved layout yet -> the page's own defaults, all visible.
      setLayout(
        d.is_customised
          ? { columns: d.columns || [], sort: (d.sort || []) as SortPref[] }
          : { columns: defaults.map((key) => ({ key, visible: true })), sort: [] },
      );
    } catch {
      // Keep the defaults — a preference service problem must not blank the table.
    } finally {
      setReady(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableKey]);

  useEffect(() => {
    load();
  }, [load]);

  return { layout, setLayout, meta, ready, reload: load };
}

const LABEL_FALLBACK = (key: string) =>
  key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function TableCustomizerButton({
  tableKey,
  labels,
  layout,
  onChange,
  sortable,
  maxSortLevels = 4,
}: {
  tableKey: string;
  /** column key -> the header text the table uses, so both agree. */
  labels: Record<string, string>;
  layout: TableLayout;
  onChange: (next: TableLayout) => void;
  sortable: string[];
  maxSortLevels?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={btnSecondary}
        onClick={() => setOpen(true)}
        title="Choose columns, their order and the sort priority"
      >
        <Settings2 size={15} /> Columns
      </button>
      {open && (
        <CustomizerModal
          tableKey={tableKey}
          labels={labels}
          layout={layout}
          onChange={onChange}
          sortable={sortable}
          maxSortLevels={maxSortLevels}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function CustomizerModal({
  tableKey, labels, layout, onChange, sortable, maxSortLevels, onClose,
}: {
  tableKey: string;
  labels: Record<string, string>;
  layout: TableLayout;
  onChange: (next: TableLayout) => void;
  sortable: string[];
  maxSortLevels: number;
  onClose: () => void;
}) {
  const [columns, setColumns] = useState<ColumnPref[]>(layout.columns);
  const [sort, setSort] = useState<SortPref[]>(layout.sort);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragKey, setDragKey] = useState<string | null>(null);

  const label = (key: string) => labels[key] || LABEL_FALLBACK(key);
  const visibleCount = columns.filter((c) => c.visible).length;

  const move = (key: string, delta: number) => {
    setColumns((prev) => {
      const i = prev.findIndex((c) => c.key === key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const dropOn = (targetKey: string) => {
    if (!dragKey || dragKey === targetKey) return;
    setColumns((prev) => {
      const from = prev.findIndex((c) => c.key === dragKey);
      const to = prev.findIndex((c) => c.key === targetKey);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDragKey(null);
  };

  const unusedSortable = useMemo(
    () => sortable.filter((k) => !sort.some((s) => s.by === k)),
    [sortable, sort],
  );

  const save = async () => {
    if (visibleCount === 0) {
      setError("Keep at least one column visible");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await crmPut<TableLayout>(`/api/me/table-preferences/${tableKey}`, {
        columns, sort,
      });
      onChange({ columns: res.data.columns, sort: res.data.sort as SortPref[] });
      onClose();
    } catch (e: any) {
      setError(e?.message || "Could not save the layout");
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError("");
    try {
      await crmDelete(`/api/me/table-preferences/${tableKey}`);
      const res = await crmGet<PreferencePayload>(`/api/me/table-preferences/${tableKey}`);
      onChange({ columns: res.data.columns, sort: (res.data.sort || []) as SortPref[] });
      onClose();
    } catch (e: any) {
      setError(e?.message || "Could not reset the layout");
      setBusy(false);
    }
  };

  return (
    <Modal title="Customise this table" onClose={onClose} medium>
      <div className="space-y-5">
        {error && <ErrorBox error={error} />}

        {/* ---- columns ---- */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold text-primary">Columns</h3>
            <span className="text-xs text-muted">
              {visibleCount} of {columns.length} shown · drag to reorder
            </span>
          </div>
          <ul className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-subtle bg-surface-2 p-2">
            {columns.map((c, i) => (
              <li
                key={c.key}
                draggable
                onDragStart={() => setDragKey(c.key)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropOn(c.key)}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
                  dragKey === c.key ? "opacity-50" : ""
                } ${c.visible ? "bg-surface-1" : ""}`}
              >
                <GripVertical size={14} className="shrink-0 cursor-grab text-muted" aria-hidden />
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-600"
                    checked={c.visible}
                    onChange={(e) =>
                      setColumns((prev) =>
                        prev.map((x) => (x.key === c.key ? { ...x, visible: e.target.checked } : x)),
                      )
                    }
                  />
                  <span className={`truncate text-sm ${c.visible ? "text-primary" : "text-muted"}`}>
                    {label(c.key)}
                  </span>
                </label>
                <button
                  type="button"
                  className="rounded p-1 text-muted hover:bg-surface-2 disabled:opacity-30"
                  onClick={() => move(c.key, -1)}
                  disabled={i === 0}
                  aria-label={`Move ${label(c.key)} up`}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-muted hover:bg-surface-2 disabled:opacity-30"
                  onClick={() => move(c.key, 1)}
                  disabled={i === columns.length - 1}
                  aria-label={`Move ${label(c.key)} down`}
                >
                  <ArrowDown size={13} />
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* ---- sort ---- */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold text-primary">Sort priority</h3>
            <span className="text-xs text-muted">
              First rule wins; the next breaks ties · up to {maxSortLevels}
            </span>
          </div>
          {sort.length === 0 ? (
            <p className="rounded-xl border border-subtle bg-surface-2 px-3 py-4 text-center text-sm text-muted">
              No sort set — newest first.
            </p>
          ) : (
            <ol className="space-y-2">
              {sort.map((s, i) => (
                <li key={s.by} className="flex items-center gap-2">
                  <span className="w-5 text-xs font-bold text-muted">{i + 1}</span>
                  <select
                    className={`${inputCls} flex-1`}
                    value={s.by}
                    onChange={(e) =>
                      setSort((prev) =>
                        prev.map((x, xi) => (xi === i ? { ...x, by: e.target.value } : x)),
                      )
                    }
                  >
                    <option value={s.by}>{label(s.by)}</option>
                    {unusedSortable.map((k) => (
                      <option key={k} value={k}>{label(k)}</option>
                    ))}
                  </select>
                  <select
                    className={`${inputCls} !w-36`}
                    value={s.dir}
                    onChange={(e) =>
                      setSort((prev) =>
                        prev.map((x, xi) =>
                          xi === i ? { ...x, dir: e.target.value as "asc" | "desc" } : x,
                        ),
                      )
                    }
                  >
                    <option value="asc">A → Z / low → high</option>
                    <option value="desc">Z → A / high → low</option>
                  </select>
                  <button
                    type="button"
                    className="rounded p-1.5 text-muted hover:bg-danger-soft hover:text-danger"
                    onClick={() => setSort((prev) => prev.filter((_, xi) => xi !== i))}
                    aria-label={`Remove sort on ${label(s.by)}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ol>
          )}
          {sort.length < maxSortLevels && unusedSortable.length > 0 && (
            <button
              type="button"
              className={`${btnSecondary} mt-2`}
              onClick={() => setSort((prev) => [...prev, { by: unusedSortable[0], dir: "asc" }])}
            >
              <Plus size={14} /> Add sort level
            </button>
          )}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-subtle pt-4">
          <button type="button" className={btnSecondary} onClick={reset} disabled={busy}>
            <RotateCcw size={14} /> Reset to default
          </button>
          <div className="flex gap-2">
            <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
              <X size={14} /> Cancel
            </button>
            <button type="button" className={btnPrimary} onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save layout"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export { Spinner };
