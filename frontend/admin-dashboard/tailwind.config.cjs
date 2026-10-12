/** @type {import('tailwindcss').Config} */
/**
 * Token-mapped Tailwind theme. Primitives live in
 * src/design-system/tokens/tokens.css — every mapping here points at a CSS
 * variable so light/dark theming stays in CSS.
 *
 * Conventions (see DESIGN-DECISIONS.md):
 * - Radii: rounded-control (6px) / rounded-card & rounded-panel (10px) /
 *   rounded-modal (16px). rounded-full only for pills/avatars/dots.
 * - Elevation: shadow-flat/raised/overlay/modal (e1/e2/e3 + glass are
 *   legacy aliases of raised/overlay/modal).
 * - Spacing: Tailwind numeric utilities are the 4px grid — arbitrary [Npx]
 *   values are banned.
 * - Type: text-xs..text-2xl land exactly on the 12/14/16/20/24/32 scale.
 */
/**
 * Every token colour is alpha-capable (10 Oct 2026). A bare `var(--x)` can
 * not take an opacity modifier, so `bg-brand-50/40` or `dark:bg-brand-900/30`
 * compiled to NO rule at all — the light background stayed in dark mode and
 * the text on it vanished. `color-mix` lets Tailwind put the alpha in.
 */
const mix = (v) => `color-mix(in srgb, var(${v}) calc(<alpha-value> * 100%), transparent)`;

module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: mix("--brand-50"),
          100: mix("--brand-100"),
          200: mix("--brand-200"),
          300: mix("--brand-300"),
          400: mix("--brand-400"),
          500: mix("--brand-500"),
          600: mix("--brand-600"),
          700: mix("--brand-700"),
          800: mix("--brand-800"),
          900: mix("--brand-900"),
        },
        neutral: {
          0: mix("--neutral-0"),
          50: mix("--neutral-50"),
          100: mix("--neutral-100"),
          200: mix("--neutral-200"),
          300: mix("--neutral-300"),
          400: mix("--neutral-400"),
          500: mix("--neutral-500"),
          600: mix("--neutral-600"),
          700: mix("--neutral-700"),
          800: mix("--neutral-800"),
          900: mix("--neutral-900"),
        },
        surface: {
          0: mix("--surface-0"),
          1: mix("--surface-1"),
          2: mix("--surface-2"),
          3: mix("--surface-3"),
        },
        // v3 secondary hue (gradient far-stop only — never standalone action).
        violet: {
          300: mix("--violet-300"),
          400: mix("--violet-400"),
          500: mix("--violet-500"),
          600: mix("--violet-600"),
          700: mix("--violet-700"),
          800: mix("--violet-800"),
        },
        // v3 cyan accent — SPARINGLY: live indicators, AI highlights, focus accents.
        accent: {
          300: mix("--accent-300"),
          400: mix("--accent-400"),
          500: mix("--accent-500"),
          600: mix("--accent-600"),
        },
        // *-500 = v3 family anchors: decorative/large-UI/charts only (not text-grade on light).
        success: { DEFAULT: mix("--success"), soft: mix("--success-soft"), 500: mix("--success-500") },
        warning: { DEFAULT: mix("--warning"), soft: mix("--warning-soft"), 500: mix("--warning-500") },
        danger: {
          DEFAULT: mix("--danger"),
          soft: mix("--danger-soft"),
          solid: mix("--danger-solid"),
          "solid-hover": mix("--danger-solid-hover"),
          "solid-active": mix("--danger-solid-active"),
          500: mix("--danger-500"),
        },
        info: { DEFAULT: mix("--info"), soft: mix("--info-soft") },
        // Assessment scores get their own scale — reusing success/warning/danger
        // would conflate "scored well" with "operation succeeded". See the
        // SCORE SCALE block in styles/tokens.css for the contrast + CVD working.
        score: {
          strong:   { bg: mix("--score-strong-bg"),   bd: mix("--score-strong-bd"),   fg: mix("--score-strong-fg"),   ring: mix("--score-strong-ring") },
          good:     { bg: mix("--score-good-bg"),     bd: mix("--score-good-bd"),     fg: mix("--score-good-fg"),     ring: mix("--score-good-ring") },
          moderate: { bg: mix("--score-moderate-bg"), bd: mix("--score-moderate-bd"), fg: mix("--score-moderate-fg"), ring: mix("--score-moderate-ring") },
          weak:     { bg: mix("--score-weak-bg"),     bd: mix("--score-weak-bd"),     fg: mix("--score-weak-fg"),     ring: mix("--score-weak-ring") },
          none:     { bg: mix("--score-none-bg"),     bd: mix("--score-none-bd"),     fg: mix("--score-none-fg"),     ring: mix("--score-none-ring") },
        },
        backdrop: "var(--backdrop)", // modal/overlay scrim (60% ink, theme-tuned)
      },
      ringColor: {
        subtle: "var(--border-subtle)",
        strong: "var(--border-strong)",
      },
      textColor: {
        primary: "var(--text-primary)",
        secondary: "var(--text-secondary)",
        muted: "var(--text-muted)",
      },
      borderColor: {
        subtle: "var(--border-subtle)",
        strong: "var(--border-strong)",
      },
      fontFamily: {
        sans: ["var(--font-ui)"],
        // Space Grotesk — h1/page titles + KPI numerals ONLY (see .text-display).
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: {
        xs: ["var(--text-xs)", { lineHeight: "1.5" }],
        sm: ["var(--text-sm)", { lineHeight: "1.5" }],
        base: ["var(--text-base)", { lineHeight: "var(--leading-body)" }],
        lg: ["var(--text-lg)", { lineHeight: "1.4" }],
        xl: ["var(--text-xl)", { lineHeight: "1.3" }],
        "2xl": ["var(--text-2xl)", { lineHeight: "1.25" }],
      },
      boxShadow: {
        // The four canonical elevation levels:
        flat: "none",
        raised: "var(--elev-raised)",
        overlay: "var(--elev-overlay)",
        modal: "var(--elev-modal)",
        // Legacy aliases (retired names — all resolve to one of the four):
        glass: "var(--elev-raised)",
        e1: "var(--e1-shadow)",
        e2: "var(--e2-shadow)",
        e3: "var(--e3-shadow)",
        "focus-ring": "var(--focus-ring)",
        "ai-glow": "var(--ai-glow)",
        // v3 brand bloom (accent shadow, NOT a fifth elevation level):
        glow: "var(--glow-brand)",
        "glow-strong": "var(--glow-brand-strong)",
      },
      transitionDuration: {
        micro: "var(--motion-micro)",
        panel: "var(--motion-panel)",
        // Legacy aliases (fast/base -> micro, slow/page -> panel):
        fast: "var(--dur-fast)",
        base: "var(--dur-base)",
        slow: "var(--dur-slow)",
        page: "var(--dur-page)",
      },
      transitionTimingFunction: {
        smooth: "var(--ease-out)",
        spring: "var(--ease-spring-ish)", // retired — aliases --ease-out
      },
      borderRadius: {
        control: "var(--radius-input)", // 6px
        card: "var(--radius-card)", // 10px
        panel: "var(--radius-card)", // 10px (was 16 — panels are cards)
        modal: "var(--radius-modal)", // 16px
      },
    },
  },
  plugins: [],
};
