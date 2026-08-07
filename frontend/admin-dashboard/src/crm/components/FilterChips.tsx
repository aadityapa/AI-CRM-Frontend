/**
 * Active filters, rendered as removable chips.
 *
 * Dropdowns alone hide what is currently applied — a reviewer looking at 12
 * rows cannot tell whether that is the whole pipeline or the result of three
 * stacked filters. Chips make the narrowing visible and reversible one
 * condition at a time, which is faster than reopening each dropdown.
 */
import { X } from "lucide-react";

export type ActiveFilter = {
  /** Stable key so React can diff, and so the caller knows what to clear. */
  key: string;
  label: string;
  onRemove: () => void;
};

export function FilterChips({
  filters,
  onClearAll,
  trailing,
}: {
  filters: ActiveFilter[];
  onClearAll?: () => void;
  /** Right-aligned slot — used for the current sort description. */
  trailing?: React.ReactNode;
}) {
  if (filters.length === 0 && !trailing) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-dashed border-subtle px-3 py-2">
      {filters.length > 0 && (
        <span className="text-xs font-semibold text-muted">Filters</span>
      )}
      {filters.map((f) => (
        <span
          key={f.key}
          className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 py-0.5 pl-2.5 pr-1
                     text-xs font-semibold text-brand-700
                     dark:border-brand-500/40 dark:bg-brand-900/25 dark:text-brand-300"
        >
          {f.label}
          <button
            type="button"
            onClick={f.onRemove}
            aria-label={`Remove filter: ${f.label}`}
            className="grid h-4 w-4 place-items-center rounded-full opacity-60 transition-opacity duration-micro
                       hover:bg-black/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-brand-500 dark:hover:bg-white/10"
          >
            <X size={10} aria-hidden />
          </button>
        </span>
      ))}
      {filters.length > 0 && onClearAll && (
        <button
          type="button"
          onClick={onClearAll}
          className="rounded-control px-1.5 py-0.5 text-xs font-semibold text-secondary transition-colors
                     duration-micro hover:bg-surface-2 hover:text-primary focus-visible:outline-none
                     focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          Clear all
        </button>
      )}
      {trailing && <span className="ml-auto text-xs text-muted">{trailing}</span>}
    </div>
  );
}
