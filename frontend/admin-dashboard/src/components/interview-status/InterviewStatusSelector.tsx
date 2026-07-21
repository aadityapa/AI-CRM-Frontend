import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronDown, CircleAlert, Loader2, PauseCircle, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import type { InterviewStatus } from "../../types";
import { patchInterviewHrStatus } from "../../api";
import { focusRing } from "../../crm/components/ui";

// May 2026: added "On Hold" as a fourth interview-level outcome so the dropdown
// stays in lockstep with the candidate-level decision buttons on the report
// page (Shortlist / On Hold / Reject).
const OPTIONS: { value: InterviewStatus; label: string; description: string }[] = [
  { value: "Selected", label: "Selected", description: "Move forward in pipeline" },
  { value: "On Hold", label: "On Hold", description: "Park decision — keep in pipeline" },
  { value: "Pending Review", label: "Pending Review", description: "Needs HR follow-up" },
  { value: "Rejected", label: "Rejected", description: "Close this interview outcome" },
];

function normalizeIncomingStatus(raw: string): InterviewStatus {
  const s = String(raw || "").toLowerCase();
  if (s.includes("reject")) return "Rejected";
  if (s.includes("select")) return "Selected";
  if (s.includes("hold")) return "On Hold";
  return "Pending Review";
}

/* v3: token-only semantic pills — soft surfaces, no custom glows/tilt
 * (dense-table restraint law: bg/border tint only). */
function metaFor(status: InterviewStatus) {
  if (status === "Selected") {
    return { pill: "border-subtle bg-success-soft text-success", Icon: ThumbsUp };
  }
  if (status === "Rejected") {
    return { pill: "border-subtle bg-danger-soft text-danger", Icon: ThumbsDown };
  }
  if (status === "On Hold") {
    return { pill: "border-strong bg-warning-soft text-warning", Icon: PauseCircle };
  }
  return { pill: "border-subtle bg-warning-soft text-warning", Icon: CircleAlert };
}

const springSoft = { type: "spring" as const, stiffness: 380, damping: 32, mass: 0.85 };

export type InterviewStatusSelectorProps = {
  interviewId: string;
  status: InterviewStatus | string;
  disabled?: boolean;
  onUpdated: (next: InterviewStatus) => void;
  onToast?: (message: string, variant?: "success" | "error") => void;
};

type MenuCoords = { left: number; top: number; width: number; maxH: number };

/** Premium status control; menu renders in a portal with fixed coords so it is never clipped by tables or overflow. */
export function InterviewStatusSelector({ interviewId, status, disabled, onUpdated, onToast }: InterviewStatusSelectorProps) {
  const reduceMotion = useReducedMotion();
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<MenuCoords | null>(null);
  const [local, setLocal] = useState<InterviewStatus>(() => normalizeIncomingStatus(String(status)));
  const [saving, setSaving] = useState(false);
  const committedRef = useRef<InterviewStatus>(normalizeIncomingStatus(String(status)));
  const onUpdatedRef = useRef(onUpdated);
  const onToastRef = useRef(onToast);

  useEffect(() => {
    onUpdatedRef.current = onUpdated;
    onToastRef.current = onToast;
  }, [onUpdated, onToast]);

  useEffect(() => {
    const n = normalizeIncomingStatus(String(status));
    setLocal(n);
    committedRef.current = n;
  }, [status]);

  const placeMenu = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 10;
    const width = Math.max(272, r.width);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - r.bottom - margin - 12;
    const spaceAbove = r.top - margin - 12;
    const preferBelow = spaceBelow >= 180 || spaceBelow >= spaceAbove;
    if (preferBelow) {
      const top = r.bottom + margin;
      setCoords({ left, top, width, maxH: Math.max(140, spaceBelow) });
    } else {
      const maxH = Math.max(140, spaceAbove);
      const top = Math.max(12, r.top - margin - maxH);
      setCoords({ left, top, width, maxH });
    }
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    placeMenu();
    const onReposition = () => placeMenu();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, placeMenu]);

  const persist = useCallback(
    async (next: InterviewStatus) => {
      const prev = committedRef.current;
      if (next === prev) {
        setOpen(false);
        return;
      }
      setLocal(next);
      setSaving(true);
      setOpen(false);
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await patchInterviewHrStatus(interviewId, next);
          committedRef.current = next;
          onUpdatedRef.current(next);
          onToastRef.current?.("Status saved", "success");
          setSaving(false);
          return;
        } catch (e) {
          lastErr = e;
          if (attempt < 2) await new Promise((r) => setTimeout(r, 380 * attempt));
        }
      }
      setLocal(prev);
      committedRef.current = prev;
      onToastRef.current?.(String((lastErr as Error)?.message || lastErr), "error");
      setSaving(false);
    },
    [interviewId],
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const m = metaFor(local);
  const Icon = m.Icon;

  const onPick = (next: InterviewStatus) => {
    if (disabled || saving) return;
    if (next === local) {
      setOpen(false);
      return;
    }
    void persist(next);
  };

  const menu =
    open && coords && typeof document !== "undefined"
      ? createPortal(
          <AnimatePresence>
            <motion.div
              key={`status-menu-${interviewId}`}
              id={listId}
              ref={panelRef}
              role="listbox"
              aria-label="Interview status"
              style={{
                position: "fixed",
                left: coords.left,
                top: coords.top,
                width: coords.width,
                maxHeight: coords.maxH,
                zIndex: 6000,
              }}
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
              transition={springSoft}
              className="flex flex-col overflow-hidden overflow-y-auto rounded-card border border-subtle bg-surface-1 shadow-modal"
            >
              <div className="fx-hairline-b sticky top-0 z-10 bg-surface-1 px-4 py-2.5">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-muted">
                  <Sparkles className="h-3.5 w-3.5 text-brand-500" />
                  Set interview outcome
                </div>
              </div>
              <div className="p-2">
                {OPTIONS.map((opt, idx) => {
                  const om = metaFor(opt.value);
                  const active = opt.value === local;
                  const OptIcon = om.Icon;
                  return (
                    <motion.button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={active}
                      initial={reduceMotion ? false : { opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ ...springSoft, delay: reduceMotion ? 0 : idx * 0.035 }}
                      onClick={() => onPick(opt.value)}
                      className={`relative flex w-full items-start gap-3 rounded-card px-3 py-2.5 text-left transition-colors duration-micro ease-smooth ${
                        active ? "bg-brand-50 ring-1 ring-inset ring-subtle dark:bg-brand-900" : "hover:bg-surface-2"
                      }`}
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control border ${om.pill}`}
                      >
                        <OptIcon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-black text-primary">{opt.label}</span>
                          {active ? <Check className="h-3.5 w-3.5 text-brand-600 dark:text-brand-300" /> : null}
                        </span>
                        <span className="mt-0.5 block text-xs font-medium text-muted">{opt.description}</span>
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          </AnimatePresence>,
          document.body,
        )
      : null;

  return (
    <div className="inline-flex">
      <motion.button
        ref={triggerRef}
        type="button"
        disabled={disabled || saving}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => !disabled && !saving && setOpen((o) => !o)}
        whileTap={reduceMotion ? undefined : { scale: 0.98 }}
        className={`group relative inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-left transition-colors duration-micro ease-smooth ${focusRing} ${m.pill} ${
          disabled || saving ? "opacity-60 pointer-events-none" : "hover:border-strong"
        }`}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-1 ring-1 ring-inset ring-subtle">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600 dark:text-brand-300" /> : <Icon className="h-3.5 w-3.5" />}
        </span>
        <span className="min-w-32">
          <span className="block text-xs font-black uppercase tracking-widest opacity-70">Status</span>
          <span className="block text-xs font-black tracking-tight">{local}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 opacity-70 transition-transform duration-panel ${open ? "rotate-180" : ""}`} />
      </motion.button>
      {menu}
    </div>
  );
}

/** Lightweight glass panel wrapper for section chrome (optional composition). */
export function FloatingGlassCard({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`glass rounded-card shadow-raised ${className}`}>
      {children}
    </div>
  );
}
