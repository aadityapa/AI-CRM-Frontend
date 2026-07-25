import type { Transition, Variants } from "framer-motion";

/** Deterministic preset index from a route key (stable per view, no Math.random). */
export function motionPresetIndex(key: string, modulo: number): number {
  if (modulo <= 0) return 0;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % modulo;
}

const PAGE_PRESETS: Variants[] = [
  {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
  },
  {
    initial: { opacity: 0, x: 14 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -10 },
  },
  {
    initial: { opacity: 0, scale: 0.985 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.99 },
  },
];

const spring: Transition = { type: "spring", stiffness: 380, damping: 34, mass: 0.65 };

export function routeSurfaceKey(view: string, candidateId: string): string {
  if (view === "candidateReport") return `candidateReport:${candidateId}`;
  if (view === "candidateInterviews") return `candidateInterviews:${candidateId}`;
  return view;
}

export function pageSurfaceMotion(routeKey: string, reducedMotion: boolean): { variants: Variants; transition: Transition } {
  if (reducedMotion) {
    return {
      variants: {
        initial: { opacity: 0.96 },
        animate: { opacity: 1 },
        exit: { opacity: 0.96 },
      },
      transition: { duration: 0.14 },
    };
  }
  const v = PAGE_PRESETS[motionPresetIndex(routeKey, PAGE_PRESETS.length)]!;
  return { variants: v, transition: spring };
}

export function navButtonMotion(reducedMotion: boolean) {
  if (reducedMotion) return { transition: { duration: 0.15 } as Transition };
  return {
    whileHover: { y: -1, scale: 1.02 },
    whileTap: { scale: 0.97 },
    transition: { type: "spring", stiffness: 520, damping: 30 } as Transition,
  };
}

