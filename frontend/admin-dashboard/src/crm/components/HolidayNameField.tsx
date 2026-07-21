/** Searchable holiday_names master picker with inline Add New (POST /api/holiday-names). */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { crmGet, crmPost, qs } from "../api";
import { Field, btnSecondary, inputCls } from "./ui";

export type HolidayNameRow = { id: number; name: string; is_active: boolean };

type Props = {
  valueId: string;
  valueName: string;
  onChangeId: (id: string) => void;
  onChangeName: (name: string) => void;
  required?: boolean;
  error?: string;
  disabled?: boolean;
  onError?: (msg: string) => void;
};

export function HolidayNameField({
  valueId, valueName, onChangeId, onChangeName, required, error, disabled, onError,
}: Props) {
  const [names, setNames] = useState<HolidayNameRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const res = await crmGet<HolidayNameRow[]>(`/api/holiday-names${qs({ limit: 200, q: q || undefined })}`);
      setNames(res.data || []);
    } catch {
      setNames([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return names;
    return names.filter((n) => n.name.toLowerCase().includes(q));
  }, [names, query]);

  const selectedLabel = useMemo(() => {
    if (valueId) {
      const hit = names.find((n) => String(n.id) === valueId);
      if (hit) return hit.name;
    }
    return valueName;
  }, [valueId, valueName, names]);

  const pick = (row: HolidayNameRow) => {
    onChangeId(String(row.id));
    onChangeName(row.name);
    setQuery("");
  };

  const addNew = async () => {
    const label = query.trim() || valueName.trim();
    if (!label) {
      onError?.("Enter a holiday name to add");
      return;
    }
    setAdding(true);
    try {
      const res = await crmPost<HolidayNameRow>("/api/holiday-names", { name: label });
      const row = res.data;
      setNames((prev) => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)));
      onChangeId(String(row.id));
      onChangeName(row.name);
      setQuery("");
    } catch (e: any) {
      onError?.(e?.message || "Failed to add holiday name");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Field label="Holiday name" required={required} error={error}>
      <div className="space-y-2">
        <input
          className={inputCls}
          value={query || selectedLabel}
          onChange={(e) => {
            setQuery(e.target.value);
            onChangeId("");
            onChangeName(e.target.value);
          }}
          placeholder={loading ? "Loading names…" : "Search or type a name"}
          disabled={disabled}
        />
        {query.trim() && !disabled && (
          <div className="max-h-40 overflow-y-auto rounded-control border border-subtle bg-surface-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted">No matches — use Add New below.</div>
            ) : filtered.map((n) => (
              <button
                key={n.id}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2"
                onClick={() => pick(n)}
              >
                {n.name}
              </button>
            ))}
          </div>
        )}
        <button type="button" className={btnSecondary} disabled={disabled || adding} onClick={addNew}>
          <Plus size={14} /> Add New name
        </button>
      </div>
    </Field>
  );
}
