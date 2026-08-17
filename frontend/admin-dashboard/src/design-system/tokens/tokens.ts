/**
 * KARNEX DESIGN SYSTEM — typed token mirror for JS consumers (recharts etc.).
 *
 * DECISION (documented): these are STATIC HEX MIRRORS of the primitives in
 * ./tokens.css rather than live getComputedStyle reads. Rationale: recharts
 * (and most canvas/SVG chart libs) resolve colors once at render time and do
 * not re-read CSS variables on theme flips; static mirrors keep chart code
 * deterministic, SSR/test-safe and tree-shakeable. For the rare consumer that
 * DOES need the live, theme-resolved value (e.g. a tooltip matching the
 * current surface), use the `cssVar()` helper below.
 *
 * KEEP IN SYNC with src/design-system/tokens/tokens.css — the contrast
 * checker (scripts/check-contrast.mjs) is the source-of-truth verifier.
 */

export const brand = {
  50: "#eff6ff",
  100: "#dbeafe",
  200: "#bfdbfe",
  300: "#93c5fd",
  400: "#60a5fa",
  500: "#3b82f6",
  600: "#2563eb",
  700: "#1d4ed8",
  800: "#1e40af",
  900: "#1e3a8a",
} as const;

/** v4 secondary hue (slot name kept) — deep navy, gradient far-stop only
 * (buttons, nav pill, AI surfaces). */
export const violet = {
  300: "#94b8f0",
  400: "#5a8fdd",
  500: "#1d4ed8",
  600: "#1e40af",
  700: "#1e3a8a",
  800: "#172b66",
} as const;

/** v3 cyan accent — sparingly: live indicators, AI highlights, focus accents. */
export const accent = {
  300: "#67e8f9",
  400: "#22d3ee",
  500: "#06b6d4",
  600: "#0891b2",
} as const;

export const neutral = {
  0: "#ffffff",
  50: "#f8fafc",
  100: "#f1f5f9",
  200: "#e3e9f0",
  300: "#cbd5e1",
  400: "#94a3b8",
  500: "#64748b",
  600: "#475569",
  700: "#334155",
  800: "#1e293b",
  900: "#0f172a",
} as const;

/** Semantic colors — light-theme (default) values. */
export const semantic = {
  success: "#047857",
  warning: "#b45309",
  danger: "#c81e2c",
  info: "#075985",
} as const;

/** Semantic colors re-tuned for the .dark theme (text-grade on dark surfaces). */
export const semanticDark = {
  success: "#34d399",
  warning: "#fbbf24",
  danger: "#f87171",
  info: "#7dd3fc",
} as const;

/** v3 semantic family anchors — decorative / large-UI / charts ONLY (not
 * text-grade on light surfaces; the text-grade tokens above stay the source). */
export const semanticAnchor = {
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
} as const;

/**
 * Categorical chart palette, derived from brand + semantic primitives (no
 * ad-hoc hex in chart code — import this instead). Ordered for maximum
 * adjacent-series separation while staying inside the system palette.
 */
export const chartPalette: readonly string[] = [
  brand[500],
  semantic.success,
  semantic.warning,
  brand[800],
  semantic.info,
  brand[300],
  semantic.danger,
  neutral[500],
];

/** Dark-theme chart palette (same derivation from the dark semantics). */
export const chartPaletteDark: readonly string[] = [
  brand[400],
  semanticDark.success,
  semanticDark.warning,
  brand[200],
  semanticDark.info,
  brand[600],
  semanticDark.danger,
  neutral[400],
];

/** Motion — mirrors --motion-micro / --motion-panel / --ease-out (framer-motion
 * needs raw numbers; keep in sync with tokens.css). */
export const motion = {
  /** 150ms — hover, press, fades. Seconds for framer-motion. */
  micro: 0.15,
  /** 250ms — drawers, modals, collapses. Seconds for framer-motion. */
  panel: 0.25,
  /** cubic-bezier(0.2, 0, 0, 1) */
  easeOut: [0.2, 0, 0, 1] as [number, number, number, number],
} as const;

export const radius = {
  input: 6,
  card: 10,
  modal: 16,
  /** Shape exception — pills / avatars / dots only. */
  pill: 9999,
} as const;

/** 4px-grid spacing scale (px). Prefer Tailwind numeric utilities in JSX. */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
  12: 48,
  16: 64,
} as const;

/**
 * Live, theme-resolved read of any CSS custom property (e.g. cssVar("--brand-500")).
 * Use sparingly — static mirrors above are preferred for charts.
 */
export function cssVar(name: string, el?: HTMLElement): string {
  if (typeof window === "undefined" || typeof document === "undefined") return "";
  const target = el ?? document.documentElement;
  return getComputedStyle(target).getPropertyValue(name).trim();
}
