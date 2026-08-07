/** Mobile-friendly appearance picker: light/dark + accent color themes.
 * Panel PORTALS to document.body so glass/backdrop-filter on the top bar cannot
 * trap or clip it. Outside-click is deferred so the opening click never closes it. */
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Moon, Palette, Sun, X } from "lucide-react";
import { ACCENT_OPTIONS, useTheme, type AccentId } from "../theme/ThemeProvider";

const focusRing = "focus-visible:outline-none focus-visible:shadow-focus-ring";
const MULTI_COLOR_GRAD =
  "linear-gradient(135deg, #f59e0b 0%, #ef4444 22%, #ec4899 45%, #8b5cf6 68%, #06b6d4 88%, #22c55e 100%)";

export function ThemePicker() {
  const { theme, setTheme, accent, setAccent } = useTheme();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const isDark = theme === "dark";

  const close = () => setOpen(false);

  const openPanel = () => {
    const r = rootRef.current?.getBoundingClientRect();
    if (r && window.innerWidth >= 640) {
      setAnchor({
        top: Math.min(r.bottom + 8, window.innerHeight - 16),
        right: Math.max(8, window.innerWidth - r.right),
      });
    } else {
      setAnchor(null);
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;

    let remove: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      const onPointer = (e: Event) => {
        const t = e.target as Node | null;
        if (!t) return;
        if (rootRef.current?.contains(t)) return;
        if (panelRef.current?.contains(t)) return;
        setOpen(false);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setOpen(false);
      };
      document.addEventListener("pointerdown", onPointer, true);
      window.addEventListener("keydown", onKey);
      remove = () => {
        document.removeEventListener("pointerdown", onPointer, true);
        window.removeEventListener("keydown", onKey);
      };
    }, 0);

    const prev = document.body.style.overflow;
    if (window.matchMedia("(max-width: 639px)").matches) {
      document.body.style.overflow = "hidden";
    }

    return () => {
      window.clearTimeout(timer);
      remove?.();
      document.body.style.overflow = prev;
    };
  }, [open]);

  const pickAccent = (id: AccentId) => {
    setAccent(id);
  };

  const panel =
    typeof document !== "undefined"
      ? createPortal(
          <AnimatePresence>
            {open ? (
              <>
                <motion.button
                  key="theme-scrim"
                  type="button"
                  aria-label="Close appearance panel"
                  className="fixed inset-0 z-[10040] bg-black/45 sm:hidden"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.15 }}
                  onClick={close}
                />

                <motion.div
                  key="theme-panel"
                  ref={panelRef}
                  id={panelId}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Appearance"
                  initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
                  transition={reduce ? { duration: 0 } : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="elev-2 fixed inset-x-0 bottom-0 z-[10050] max-h-[85vh] overflow-y-auto rounded-t-2xl bg-surface-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:bottom-auto sm:w-[19.5rem] sm:max-h-[min(80vh,34rem)] sm:rounded-panel sm:p-3.5 sm:pb-3.5"
                  style={
                    anchor
                      ? { top: anchor.top, right: anchor.right, bottom: "auto", left: "auto" }
                      : undefined
                  }
                >
                  <div className="mb-3 flex items-center justify-between gap-2 sm:mb-2.5">
                    <div>
                      <div className="text-sm font-bold text-primary">Appearance</div>
                      <div className="text-xs text-muted">Mode & accent color</div>
                    </div>
                    <button
                      type="button"
                      className={`inline-flex h-10 w-10 items-center justify-center rounded-control text-muted hover:bg-surface-1 hover:text-primary sm:h-8 sm:w-8 ${focusRing}`}
                      aria-label="Close"
                      onClick={close}
                    >
                      <X className="h-5 w-5 sm:h-4 sm:w-4" />
                    </button>
                  </div>

                  <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--border-subtle)] sm:hidden" aria-hidden />

                  <div className="mb-4 grid grid-cols-2 gap-2 sm:mb-3">
                    <button
                      type="button"
                      onClick={() => setTheme("light")}
                      className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-control border px-3 text-sm font-semibold transition-colors ${focusRing} ${
                        !isDark
                          ? "border-brand-500 bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200"
                          : "border-subtle bg-surface-0 text-muted hover:bg-surface-1 hover:text-primary"
                      }`}
                      aria-pressed={!isDark}
                    >
                      <Sun className="h-4 w-4 shrink-0" />
                      Day
                    </button>
                    <button
                      type="button"
                      onClick={() => setTheme("dark")}
                      className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-control border px-3 text-sm font-semibold transition-colors ${focusRing} ${
                        isDark
                          ? "border-brand-500 bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200"
                          : "border-subtle bg-surface-0 text-muted hover:bg-surface-1 hover:text-primary"
                      }`}
                      aria-pressed={isDark}
                    >
                      <Moon className="h-4 w-4 shrink-0" />
                      Night
                    </button>
                  </div>

                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Accent color
                  </div>
                  <div className="grid grid-cols-4 gap-2.5 sm:gap-2">
                    {ACCENT_OPTIONS.map((opt) => {
                      const selected = accent === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => pickAccent(opt.id)}
                          className={`group flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-control border p-2 transition-colors ${focusRing} ${
                            selected
                              ? "border-brand-500 bg-brand-100/70 dark:bg-brand-900/50"
                              : "border-subtle bg-surface-0 hover:bg-surface-1"
                          }`}
                          aria-pressed={selected}
                          aria-label={`${opt.label} accent`}
                          title={opt.label}
                        >
                          <span
                            className="relative flex h-9 w-9 items-center justify-center rounded-full shadow-e1 ring-2 ring-white/20 dark:ring-black/30 sm:h-8 sm:w-8"
                            style={{ background: opt.swatch }}
                          >
                            {selected ? <Check className="h-4 w-4 text-white drop-shadow" strokeWidth={3} /> : null}
                          </span>
                          <span className="text-[10px] font-semibold text-muted group-hover:text-primary sm:text-[11px]">
                            {opt.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              </>
            ) : null}
          </AnimatePresence>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : openPanel())}
        className={`group relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full p-[2px] ${focusRing}`}
        style={{ background: MULTI_COLOR_GRAD }}
        aria-label="Appearance and color themes"
        title="Appearance"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span
          className="absolute inset-0 rounded-full opacity-60 blur-[6px] transition-opacity duration-base group-hover:opacity-90"
          style={{ background: MULTI_COLOR_GRAD }}
          aria-hidden
        />
        <span className="relative flex h-full w-full items-center justify-center rounded-full bg-surface-0 text-primary shadow-e1 transition-colors duration-base group-hover:bg-surface-1">
          <Palette className="h-4 w-4 text-violet-500" aria-hidden />
        </span>
      </button>
      {panel}
    </div>
  );
}
