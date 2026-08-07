/**
 * Multi-select dropdown for list filters.
 *
 * A single-select status filter forces "everything waiting on me" to be
 * answered one stage at a time. Reviewers work across several stages at once,
 * so the filter should too.
 *
 * Deliberately not a combobox: the option set is small and fixed, so a plain
 * checkbox list is faster to scan than something with a search box in it.
 */
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  allLabel = "All",
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Shown when nothing is selected — i.e. no narrowing applied. */
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape — a filter popover that traps you is
  // worse than no popover.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label || selected[0]
        : `${selected.length} selected`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`inline-flex h-8 items-center gap-1.5 rounded-control border px-2 text-sm transition-colors
          duration-micro ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
          ${selected.length
            ? "border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-500/40 dark:bg-brand-900/25 dark:text-brand-300"
            : "border-subtle bg-surface-1 text-secondary hover:border-strong"}`}
      >
        <span className="max-w-[160px] truncate">{summary}</span>
        <ChevronDown size={13} aria-hidden className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          className="absolute left-0 z-40 mt-1 max-h-72 w-60 overflow-y-auto rounded-card border
                     border-subtle bg-surface-1 p-1 shadow-overlay"
        >
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mb-1 w-full rounded-control px-2 py-1.5 text-left text-xs font-semibold
                         text-secondary transition-colors duration-micro hover:bg-surface-2 hover:text-primary"
            >
              Clear {label.toLowerCase()}
            </button>
          )}
          {options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(o.value)}
                className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-sm
                           text-secondary transition-colors duration-micro hover:bg-surface-2 hover:text-primary"
              >
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded border
                    ${on ? "border-brand-600 bg-brand-600 text-white" : "border-strong"}`}
                  aria-hidden
                >
                  {on && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
