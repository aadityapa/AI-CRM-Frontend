/** CRM motion primitives — 3D tilt cards, count-up numbers, stagger/fade helpers.
 * Transform/opacity only (GPU-friendly); every effect degrades under prefers-reduced-motion,
 * and the tilt is fully disabled on touch (pointer: coarse) devices. */
import React, { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";

/* Mirrors the motion tokens in src/design-system/tokens/tokens.css —
 * framer-motion needs raw numbers, so keep in sync with --motion-micro (150ms),
 * --motion-panel (250ms) and --ease-out. fast/base alias micro; slow/page
 * alias panel; the spring curve is RETIRED and now aliases --ease-out. */
export const MOTION_DUR = { fast: 0.15, base: 0.15, slow: 0.25, page: 0.25 } as const;
export const MOTION_EASE_OUT: [number, number, number, number] = [0.2, 0, 0, 1]; // --ease-out
export const MOTION_EASE_SPRING: [number, number, number, number] = [0.2, 0, 0, 1]; // retired -> --ease-out

/* Cursor-tracking spring for the tilt — a physical follow spring by design
 * (duration tokens don't apply to pointer-chasing motion). */
const TILT_SPRING = { stiffness: 260, damping: 24, mass: 0.6 };

/** True on touch-first devices (pointer: coarse) — hover tilt is meaningless there. */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState<boolean>(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(pointer: coarse)");
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return coarse;
}

/** Drives the ONE global .fx-spotlight layer (styles/tokens.css): writes
 * --spot-x/--spot-y on <html> from a rAF-throttled pointermove listener.
 * Mounted once by the platform shell (App.tsx). No per-card listeners.
 * No-ops on touch (pointer: coarse) and under prefers-reduced-motion — the
 * CSS layer is also display:none in both cases, belt and braces. */
export function useSpotlight(): void {
  const reduce = useReducedMotion();
  const coarse = useCoarsePointer();
  useEffect(() => {
    if (reduce || coarse || typeof window === "undefined") return;
    const root = document.documentElement;
    let raf = 0;
    let x = 0;
    let y = 0;
    const onMove = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          root.style.setProperty("--spot-x", `${x}px`);
          root.style.setProperty("--spot-y", `${y}px`);
        });
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
      root.style.removeProperty("--spot-x");
      root.style.removeProperty("--spot-y");
    };
  }, [reduce, coarse]);
}

/** Perspective 3D tilt wrapper: tracks the cursor, tilts up to `maxTilt` degrees
 * (4° per the depth-system spec), scales slightly on hover and paints a moving
 * specular highlight. Renders a plain div on touch or reduced-motion. */
export function Tilt3D({
  children,
  className = "",
  maxTilt = 4,
}: {
  children: React.ReactNode;
  className?: string;
  maxTilt?: number;
}) {
  const reduce = useReducedMotion();
  const coarse = useCoarsePointer();
  const [hovered, setHovered] = useState(false);
  const px = useMotionValue(0.5); // cursor position within the card, 0..1
  const py = useMotionValue(0.5);
  const sx = useSpring(px, TILT_SPRING);
  const sy = useSpring(py, TILT_SPRING);
  const rotateX = useTransform(sy, [0, 1], [maxTilt, -maxTilt]);
  const rotateY = useTransform(sx, [0, 1], [-maxTilt, maxTilt]);
  const highlight = useTransform(
    () =>
      `radial-gradient(240px circle at ${sx.get() * 100}% ${sy.get() * 100}%, rgba(255,255,255,0.28), transparent 65%)`
  );

  if (reduce || coarse) {
    return <div className={`relative ${className}`}>{children}</div>;
  }

  return (
    <motion.div
      className={`relative ${className}`}
      style={{ rotateX, rotateY, transformPerspective: 900, transformStyle: "preserve-3d" }}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: MOTION_DUR.base, ease: MOTION_EASE_OUT }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        px.set((e.clientX - r.left) / Math.max(r.width, 1));
        py.set((e.clientY - r.top) / Math.max(r.height, 1));
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        px.set(0.5);
        py.set(0.5);
      }}
    >
      {children}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-slow ease-smooth"
        style={{ backgroundImage: highlight, opacity: hovered ? 1 : 0 }}
      />
    </motion.div>
  );
}

/** Counts up to `value` on mount and whenever it changes (rAF, cubic ease-out).
 * Non-finite values render as-is without animation. */
export function AnimatedNumber({
  value,
  format,
  duration = 0.9,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(0);
  const from = useRef(0);
  const raf = useRef(0);

  useEffect(() => {
    if (!Number.isFinite(value)) return;
    if (reduce) {
      setDisplay(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    const ms = Math.max(duration, 0.1) * 1000;
    const step = (now: number) => {
      const p = Math.min((now - start) / ms, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(origin + (value - origin) * eased);
      if (p < 1) raf.current = requestAnimationFrame(step);
      else from.current = value;
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration, reduce]);

  if (!Number.isFinite(value)) return <>{String(value)}</>;
  const fmt = format ?? ((n: number) => Math.round(n).toLocaleString("en-IN"));
  return <>{fmt(display)}</>;
}

/** Fade-in-from-below entrance, with configurable delay. */
export function FadeInUp({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduce
          ? { duration: MOTION_DUR.base }
          : { duration: MOTION_DUR.slow, ease: MOTION_EASE_SPRING, delay }
      }
    >
      {children}
    </motion.div>
  );
}

/** Staggers its children by wrapping each one in a delayed FadeInUp.
 * Works as any layout container (e.g. pass a `grid` className). */
export function Stagger({
  children,
  className,
  interval = 0.06,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  interval?: number;
  delay?: number;
}) {
  const items = React.Children.toArray(children);
  return (
    <div className={className}>
      {items.map((child, i) => (
        <FadeInUp
          key={(React.isValidElement(child) && child.key != null ? child.key : i) as React.Key}
          delay={delay + Math.min(i, 12) * interval}
        >
          {child}
        </FadeInUp>
      ))}
    </div>
  );
}

/** Tactile press feedback for buttons / clickable chips. */
export function PressableScale({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      whileTap={{ scale: 0.97 }}
      whileHover={{ y: -1 }}
      transition={{ duration: MOTION_DUR.fast, ease: MOTION_EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}
