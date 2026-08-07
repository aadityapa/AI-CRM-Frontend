/**
 * Shared searchable combobox for CRM forms (City / State / Country / selects).
 * Extracted from opportunity FormRenderer — committed value shows as locked label;
 * click / Change reopens the filter list. Optional "+" adds a typed value (or opens
 * an inline name field when the query is empty) and persists via onOptionsChange.
 */
import React from "react";
import { Plus } from "lucide-react";
import { inputCls } from "./ui";

export type SearchableOption = { value: string; label: string };

const lockedInputCls = `${inputCls} bg-surface-2/80 opacity-90 cursor-default pr-10`;
const inputErrCls = "input-error";
const SELECT_PLACEHOLDER = "— Select —";

export function SearchableSelect({
  id,
  value,
  options,
  onChange,
  placeholder,
  searchable = true,
  allowAdd = false,
  disabled,
  err,
  describedBy,
  onBlur,
  registerRef,
  className = inputCls,
  onOptionsChange,
  addLabel = "Add new value",
}: {
  id?: string;
  value: string;
  options: SearchableOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** When false, behaves like a plain filterable list still (kept for API parity). */
  searchable?: boolean;
  /** Shows "+" to add a new option (typed query, or inline name when query empty). */
  allowAdd?: boolean;
  disabled?: boolean;
  err?: string;
  describedBy?: string;
  onBlur?: () => void;
  registerRef?: (el: HTMLElement | null) => void;
  className?: string;
  /** Called when allowAdd creates a new option so parents can extend their list. */
  onOptionsChange?: (next: SearchableOption[]) => void;
  /** Accessible label for the "+" control (e.g. "Add new role"). */
  addLabel?: string;
}) {
  void searchable;
  const autoId = React.useId();
  const fieldId = id || autoId;
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const addInputRef = React.useRef<HTMLInputElement | null>(null);
  const listId = `${fieldId}-listbox`;
  const [localOptions, setLocalOptions] = React.useState(options);
  const selected = localOptions.find((o) => o.value === value);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);
  const [addingInline, setAddingInline] = React.useState(false);
  const [addDraft, setAddDraft] = React.useState("");
  const [openUpward, setOpenUpward] = React.useState(false);
  const [listMaxHeight, setListMaxHeight] = React.useState<number | null>(null);
  const hasValue = !!value;

  React.useEffect(() => {
    setLocalOptions(options);
  }, [options]);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      if (!addingInline) {
        setAddDraft("");
      }
    }
  }, [open, value, addingInline]);

  React.useEffect(() => {
    if (!open && !addingInline) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setAddingInline(false);
        setAddDraft("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, addingInline]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return localOptions;
    return localOptions.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [localOptions, query]);

  React.useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  React.useEffect(() => {
    if (open && !addingInline) inputRef.current?.focus();
  }, [open, addingInline]);

  React.useLayoutEffect(() => {
    if (!open || addingInline || !inputRef.current) return;
    const updatePosition = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
      setOpenUpward(openUp);
      setListMaxHeight(Math.max(140, Math.min(openUp ? spaceAbove : spaceBelow, 320)));
    };
    updatePosition();
    window.addEventListener("resize", updatePosition, { passive: true });
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, addingInline, query, localOptions.length]);

  React.useEffect(() => {
    if (addingInline) addInputRef.current?.focus();
  }, [addingInline]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery("");
    setAddingInline(false);
    setAddDraft("");
  };

  const commitNew = (raw: string) => {
    const label = raw.trim();
    if (!label || disabled) return;
    const existing = localOptions.find(
      (o) => o.value.toLowerCase() === label.toLowerCase() || o.label.toLowerCase() === label.toLowerCase(),
    );
    if (existing) {
      pick(existing.value);
      return;
    }
    const nextOpt = { value: label, label };
    const next = [...localOptions, nextOpt].sort((a, b) => a.label.localeCompare(b.label));
    setLocalOptions(next);
    onOptionsChange?.(next);
    pick(label);
  };

  const startInlineAdd = () => {
    if (disabled) return;
    setOpen(false);
    setQuery("");
    setAddDraft("");
    setAddingInline(true);
  };

  const addTyped = () => {
    const label = query.trim();
    if (label) {
      commitNew(label);
      return;
    }
    // Empty query: open inline name field (the "+" looked broken when disabled).
    startInlineAdd();
  };

  const openPicker = () => {
    if (disabled) return;
    setAddingInline(false);
    setOpen(true);
    setQuery("");
  };

  const clearAndOpen = () => {
    if (disabled) return;
    onChange("");
    setOpen(true);
    setQuery("");
    setAddingInline(false);
  };

  if (hasValue && !open && !addingInline) {
    return (
      <div ref={rootRef} className="relative flex items-center gap-2">
        <button
          type="button"
          id={fieldId}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-haspopup="listbox"
          className={`${lockedInputCls} ${err ? inputErrCls : ""} ${
            disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer text-left"
          } min-w-0 flex-1 truncate`}
          ref={(el) => registerRef?.(el)}
          onClick={openPicker}
          onBlur={onBlur}
          title="Click to change"
        >
          {selected?.label || value}
        </button>
        {!disabled && (
          <button
            type="button"
            className="shrink-0 text-xs font-semibold text-brand-600 hover:text-brand-500"
            onClick={clearAndOpen}
          >
            Change
          </button>
        )}
        {allowAdd && !disabled && (
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-subtle bg-brand-600 text-white transition-colors hover:bg-brand-500"
            aria-label={addLabel}
            title={addLabel}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              startInlineAdd();
            }}
          >
            <Plus size={16} />
          </button>
        )}
      </div>
    );
  }

  const canAdd =
    allowAdd
    && !!query.trim()
    && !localOptions.some(
      (o) => o.value.toLowerCase() === query.trim().toLowerCase()
        || o.label.toLowerCase() === query.trim().toLowerCase(),
    );

  if (addingInline && allowAdd && !disabled) {
    return (
      <div ref={rootRef} className="relative flex flex-wrap items-center gap-2">
        <input
          ref={addInputRef}
          type="text"
          className={`${className} min-w-0 flex-1 ${err ? inputErrCls : ""}`}
          placeholder="New value name…"
          value={addDraft}
          aria-label={addLabel}
          autoComplete="off"
          onChange={(e) => setAddDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitNew(addDraft);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setAddingInline(false);
              setAddDraft("");
            }
          }}
        />
        <button
          type="button"
          className="inline-flex h-10 shrink-0 items-center rounded-control border border-subtle bg-brand-600 px-3 text-xs font-semibold text-white hover:bg-brand-500 disabled:opacity-40"
          disabled={!addDraft.trim()}
          onClick={() => commitNew(addDraft)}
        >
          Save
        </button>
        <button
          type="button"
          className="inline-flex h-10 shrink-0 items-center rounded-control border border-subtle px-3 text-xs font-semibold text-muted hover:bg-surface-2"
          onClick={() => {
            setAddingInline(false);
            setAddDraft("");
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <input
          id={fieldId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={!!err || undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          className={`${className} ${err ? inputErrCls : ""}`}
          placeholder={placeholder || SELECT_PLACEHOLDER}
          value={query}
          autoComplete="off"
          ref={(el) => {
            inputRef.current = el;
            registerRef?.(el);
          }}
          onFocus={() => { if (!disabled) setOpen(true); }}
          onBlur={onBlur}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter" && open) {
              e.preventDefault();
              const hit = filtered[highlight];
              if (hit) pick(hit.value);
              else if (canAdd) commitNew(query);
            } else if (e.key === "Escape") {
              setOpen(false);
              setQuery("");
            }
          }}
        />
        {open && !disabled && (
          <ul
            id={listId}
            role="listbox"
            className={`ss-popover absolute z-20 w-full overflow-auto rounded-control border border-subtle bg-surface-1 py-1 shadow-raised ${
              openUpward ? "bottom-full mb-1" : "top-full mt-1"
            }`}
            style={listMaxHeight ? { maxHeight: `${listMaxHeight}px` } : undefined}
          >
            {filtered.length === 0 && !canAdd ? (
              <li className="px-3 py-2 text-sm text-muted">No matches</li>
            ) : (
              filtered.map((o, i) => (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={o.value === value}
                  className={`cursor-pointer px-3 py-2 text-sm ${
                    i === highlight ? "bg-surface-2 text-primary" : "text-secondary hover:bg-surface-2"
                  }`}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(o.value);
                  }}
                >
                  {o.label}
                </li>
              ))
            )}
            {canAdd && (
              <li
                role="option"
                aria-selected={false}
                className="cursor-pointer border-t border-subtle px-3 py-2 text-sm font-semibold text-brand-600 hover:bg-surface-2"
                onMouseDown={(e) => {
                  e.preventDefault();
                  commitNew(query);
                }}
              >
                + Add “{query.trim()}”
              </li>
            )}
          </ul>
        )}
      </div>
      {allowAdd && !disabled && (
        <button
          type="button"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-subtle bg-brand-600 text-white transition-colors hover:bg-brand-500"
          aria-label={addLabel}
          title={canAdd ? `Add “${query.trim()}”` : addLabel}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            addTyped();
          }}
        >
          <Plus size={16} />
        </button>
      )}
    </div>
  );
}

/** Convert a string list into SearchableSelect options. */
export function optionsFromStrings(values: readonly string[]): SearchableOption[] {
  return values.map((v) => ({ value: v, label: v }));
}
