/** ⌘K / Ctrl+K command palette — jump to platform sections + common CRM pages. */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Search } from "lucide-react";
import { fuzzyFilter } from "./fuzzyMatch";

const focusRing = "focus-visible:outline-none focus-visible:shadow-focus-ring";

export type CommandItem = {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  run: () => void;
};

export function CommandPalette({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
}) {
  const reduce = useReducedMotion();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const filtered = useMemo(() => fuzzyFilter(items, query), [items, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (filtered.length ? (i + 1) % filtered.length : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const hit = filtered[active];
        if (hit) {
          hit.run();
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, active, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[220] flex items-start justify-center bg-backdrop p-4 pt-[12vh] [backdrop-filter:blur(var(--glass-blur))] [-webkit-backdrop-filter:blur(var(--glass-blur))]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.15 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Jump to"
            className="elev-3 flex w-full max-w-lg flex-col overflow-hidden rounded-modal"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 32 }}
          >
            <div className="flex items-center gap-2 border-b border-subtle px-3 py-2.5">
              <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Jump to a section…"
                className={`min-w-0 flex-1 bg-transparent text-sm font-medium text-primary placeholder:text-muted ${focusRing} rounded-control`}
                aria-autocomplete="list"
                aria-controls={listId}
                aria-activedescendant={filtered[active] ? `${listId}-${filtered[active].id}` : undefined}
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className="hidden rounded-control border border-subtle bg-surface-1 px-1.5 py-0.5 text-[10px] font-semibold text-muted sm:inline">
                Esc
              </kbd>
            </div>
            <ul id={listId} role="listbox" className="max-h-[min(50vh,22rem)] overflow-y-auto p-1.5">
              {filtered.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-muted">No matches</li>
              )}
              {filtered.map((item, i) => {
                const Icon = item.icon;
                const selected = i === active;
                return (
                  <li key={item.id} role="presentation">
                    <button
                      id={`${listId}-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => {
                        item.run();
                        onClose();
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-left text-sm font-semibold transition-colors duration-fast ease-smooth ${focusRing} ${
                        selected
                          ? "bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200"
                          : "text-primary hover:bg-surface-1"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <span className="shrink-0 text-[11px] font-medium text-muted">{item.group}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center gap-3 border-t border-subtle px-3 py-2 text-[11px] text-muted">
              <span>
                <kbd className="rounded border border-subtle bg-surface-1 px-1 font-mono">↑↓</kbd> navigate
              </span>
              <span>
                <kbd className="rounded border border-subtle bg-surface-1 px-1 font-mono">↵</kbd> open
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
