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
module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "var(--brand-50)",
          100: "var(--brand-100)",
          200: "var(--brand-200)",
          300: "var(--brand-300)",
          400: "var(--brand-400)",
          500: "var(--brand-500)",
          600: "var(--brand-600)",
          700: "var(--brand-700)",
          800: "var(--brand-800)",
          900: "var(--brand-900)",
        },
        neutral: {
          0: "var(--neutral-0)",
          50: "var(--neutral-50)",
          100: "var(--neutral-100)",
          200: "var(--neutral-200)",
          300: "var(--neutral-300)",
          400: "var(--neutral-400)",
          500: "var(--neutral-500)",
          600: "var(--neutral-600)",
          700: "var(--neutral-700)",
          800: "var(--neutral-800)",
          900: "var(--neutral-900)",
        },
        surface: {
          0: "var(--surface-0)",
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
        },
        // v3 secondary hue (gradient far-stop only — never standalone action).
        violet: {
          300: "var(--violet-300)",
          400: "var(--violet-400)",
          500: "var(--violet-500)",
          600: "var(--violet-600)",
          700: "var(--violet-700)",
          800: "var(--violet-800)",
        },
        // v3 cyan accent — SPARINGLY: live indicators, AI highlights, focus accents.
        accent: {
          300: "var(--accent-300)",
          400: "var(--accent-400)",
          500: "var(--accent-500)",
          600: "var(--accent-600)",
        },
        // *-500 = v3 family anchors: decorative/large-UI/charts only (not text-grade on light).
        success: { DEFAULT: "var(--success)", soft: "var(--success-soft)", 500: "var(--success-500)" },
        warning: { DEFAULT: "var(--warning)", soft: "var(--warning-soft)", 500: "var(--warning-500)" },
        danger: {
          DEFAULT: "var(--danger)",
          soft: "var(--danger-soft)",
          solid: "var(--danger-solid)",
          "solid-hover": "var(--danger-solid-hover)",
          "solid-active": "var(--danger-solid-active)",
          500: "var(--danger-500)",
        },
        info: { DEFAULT: "var(--info)", soft: "var(--info-soft)" },
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
