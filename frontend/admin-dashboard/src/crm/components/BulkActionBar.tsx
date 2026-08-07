/**
 * Floating bar shown while rows are selected.
 *
 * Anchored to the viewport rather than the table because the selection is
 * still live when you have scrolled past row 40 — a toolbar pinned above the
 * table would be off-screen exactly when you want it.
 *
 * Rendered in a portal so the fixed positioning cannot be trapped by an
 * ancestor's `transform` or `overflow` (framer-motion sets transforms on the
 * page wrapper, which would otherwise turn `fixed` into `absolute`).
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export function BulkActionBar({
  count,
  onClear,
  children,
  noun = "candidate",
}: {
  count: number;
  onClear: () => void;
  /** The actions themselves — the bar owns layout, the caller owns verbs. */
  children: React.ReactNode;
  noun?: string;
}) {
  const reduce = useReducedMotion();

  // Escape clears the selection. Standard for a transient mode, and stops the
  // bar becoming something you have to hunt for a Clear button to dismiss.
  useEffect(() => {
    if (count === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, onClear]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          role="region"
          aria-label={`${count} ${noun}${count === 1 ? "" : "s"} selected`}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-6 left-1/2 z-[60] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap
                     items-center gap-2 rounded-card border border-strong bg-surface-1 p-2 shadow-modal"
        >
          <span className="tnum border-r border-subtle pr-2 text-sm font-bold text-primary">
            {count} selected
          </span>
          {children}
          <button
            type="button"
            onClick={onClear}
            className="rounded-control px-2 py-1 text-sm font-semibold text-secondary transition-colors
                       duration-micro hover:bg-surface-2 hover:text-primary focus-visible:outline-none
                       focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Clear
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
