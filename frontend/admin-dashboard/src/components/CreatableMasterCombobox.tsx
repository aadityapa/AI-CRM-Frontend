import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { apiGet, authFetch } from "../api/client";

type MasterKind = "opportunity" | "customer";

type MasterItem = {
  id?: string;
  value?: string;
  label?: string;
  opportunityId?: string;
  customerName?: string;
};

function itemValue(item: MasterItem, kind: MasterKind): string {
  return String(item.value || (kind === "opportunity" ? item.opportunityId : item.customerName) || item.label || "").trim();
}

function endpointFor(kind: MasterKind): string {
  return kind === "opportunity" ? "/masters/opportunities" : "/masters/customers";
}

export function CreatableMasterCombobox({
  kind,
  label,
  value,
  onChange,
  placeholder,
}: {
  kind: MasterKind;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value || "");
  const [items, setItems] = useState<MasterItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setQuery(value || "");
  }, [value]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const timer = window.setTimeout(async () => {
      try {
        setLoading(true);
        const qs = new URLSearchParams({ q: query.trim(), limit: "20" });
        const data = await apiGet<{ items: MasterItem[] }>(`${endpointFor(kind)}?${qs.toString()}`, { force: true });
        if (!alive) return;
        setItems(Array.isArray(data.items) ? data.items : []);
        setActiveIndex(0);
      } catch (_) {
        if (!alive) return;
        setItems([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, 220);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [kind, open, query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const normalizedQuery = query.trim().toLowerCase();
  const hasExact = useMemo(
    () => items.some((item) => itemValue(item, kind).toLowerCase() === normalizedQuery),
    [items, kind, normalizedQuery],
  );
  const canCreate = !!query.trim() && !hasExact;
  const optionCount = items.length + (canCreate ? 1 : 0);

  const selectValue = (next: string) => {
    const clean = next.trim();
    onChange(clean);
    setQuery(clean);
    setOpen(false);
  };

  const createValue = async () => {
    const clean = query.trim();
    if (!clean) return;
    try {
      setLoading(true);
      const res = await authFetch(endpointFor(kind), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: clean }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || `Create failed (${res.status})`);
      const created = itemValue(data.item || {}, kind) || clean;
      selectValue(created);
    } catch (_) {
      selectValue(clean);
    } finally {
      setLoading(false);
    }
  };

  const chooseActive = () => {
    if (!optionCount) return;
    if (activeIndex < items.length) {
      selectValue(itemValue(items[activeIndex], kind));
      return;
    }
    void createValue();
  };

  return (
    <div ref={rootRef} className="relative">
      <label className="text-xs font-extrabold tracking-widest uppercase text-muted">{label}</label>
      <div className="relative mt-2">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActiveIndex((idx) => (optionCount ? (idx + 1) % optionCount : 0));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setActiveIndex((idx) => (optionCount ? (idx - 1 + optionCount) % optionCount : 0));
            } else if (e.key === "Enter" && open && optionCount) {
              e.preventDefault();
              chooseActive();
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          role="combobox"
          aria-expanded={open}
          aria-controls="creatable-master-listbox"
          aria-autocomplete="list"
          className="input-recessed w-full h-11 rounded-control px-4 pr-10 text-sm text-primary"
          placeholder={placeholder}
        />
        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronsUpDown className="w-4 h-4" />}
        </div>
      </div>

      {open ? (
        <div id="creatable-master-listbox" role="listbox"
          className="absolute z-40 mt-2 w-full overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-overlay">
          {items.length ? (
            items.map((item, idx) => {
              const val = itemValue(item, kind);
              const active = idx === activeIndex;
              const selected = val.toLowerCase() === value.trim().toLowerCase();
              return (
                <button
                  key={`${item.id || val}-${idx}`}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectValue(val)}
                  className={`w-full px-4 py-3 text-left text-sm font-semibold transition-colors duration-micro ease-smooth flex items-center justify-between gap-3 ${
                    active ? "bg-brand-50 text-brand-700 dark:bg-brand-900 dark:text-brand-200" : "text-secondary hover:bg-surface-2"
                  }`}
                >
                  <span className="truncate">{val}</span>
                  {selected ? <Check className="w-4 h-4 text-brand-600 dark:text-brand-300" /> : null}
                </button>
              );
            })
          ) : loading ? (
            <div className="px-4 py-3 text-sm font-semibold text-muted">Searching...</div>
          ) : (
            <div className="px-4 py-3 text-sm font-semibold text-muted">No matches found.</div>
          )}
          {canCreate ? (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void createValue()}
              className={`w-full px-4 py-3 text-left text-sm font-extrabold transition-colors duration-micro ease-smooth flex items-center gap-2 border-t border-subtle ${
                activeIndex === items.length ? "bg-success-soft text-success" : "text-success hover:bg-success-soft"
              }`}
            >
              <Plus className="w-4 h-4" />
              Create "{query.trim()}"
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
