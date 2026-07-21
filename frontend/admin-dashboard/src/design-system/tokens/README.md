# Karnex Design System — Tokens

Canonical primitives for the whole admin dashboard. **This directory is the
single source of truth** — everything else (the legacy alias layer in
`src/styles/tokens.css`, the Tailwind theme in `tailwind.config.cjs`, the JS
mirror `tokens.ts`) derives from `tokens.css` here.

- `tokens.css` — CSS custom properties. `:root` = light, `.dark` on `<html>` =
  dark (toggled by `src/theme/ThemeProvider.tsx` + the pre-hydration script in
  `index.html`). The app is dark-first: treat dark as the primary polish target.
- `tokens.ts` — typed static mirror for JS consumers (charts, framer-motion
  durations). Keep in sync; `scripts/check-contrast.mjs` is the verifier.

## The laws

1. **No arbitrary values.** No `p-[13px]`, `text-[11px]`, `bg-[#1e293b]`,
   inline hex, or hand-rolled `box-shadow`. If a value is missing, add a token
   here first.
2. **The 4px law (spacing).** All spacing sits on the 4px grid:
   `--space-1..16` = 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64. Tailwind numeric
   utilities (`p-1`, `gap-2`, `m-4`, …) are the sanctioned way to consume it.
3. **The 3 law (radius).** Exactly three radii: `--radius-input` 6px
   (`rounded-control`), `--radius-card` 10px (`rounded-card` / `rounded-panel`),
   `--radius-modal` 16px (`rounded-modal`). Documented exception:
   `rounded-full` for pills / avatars / status dots only (a shape, not a radius).
4. **The 4 law (elevation).** Exactly four levels: `--elev-flat` (border only),
   `--elev-raised` (cards, `shadow-raised`), `--elev-overlay`
   (dropdowns/popovers/toasts, `shadow-overlay`), `--elev-modal` (modals,
   `shadow-modal`). Legacy `shadow-e1/e2/e3`, `.elev-1/2/3` and `.glass` all
   resolve to one of these — never invent a fifth shadow.

## Quick reference

| Domain | Tokens | Consume as |
|---|---|---|
| Brand (indigo, anchor #6366F1) | `--brand-50..900` (`600` = primary action) | `bg-brand-600`, `text-brand-600` |
| Violet (gradient far-stop ONLY) | `--violet-300..800` | `via --btn-gradient / .nav-pill-gradient / --ai-gradient` |
| Accent cyan (sparingly: live/AI) | `--accent-300..600` | `text-accent-400`, `bg-accent-400` (dark surfaces) |
| Display type (h1/KPI only) | `--font-display` (Space Grotesk) | `.text-display`, `font-display` |
| Neutral (only gray) | `--neutral-0..900` | `bg-neutral-*` (prefer surface/text aliases) |
| Surfaces | `--surface-0..3` (alias layer) | `bg-surface-0/1/2/3` |
| Text | `--text-primary/secondary/muted` | `text-primary/secondary/muted` |
| Semantic | `--success/warning/danger/info` + `*-soft`, `--danger-solid(-hover/-active)` | `text-success`, `bg-danger-soft`, `bg-danger-solid` |
| Borders | `--border-subtle/strong` | `border-subtle/strong`, `ring-subtle/strong` |
| Backdrop | `--backdrop` | `bg-backdrop` (modal scrim) |
| Type scale | 12/14/16/20/24/32, body 1.5 (headings 1.2–1.3) | `text-xs..text-2xl` (exact mapping) |
| Fonts | `--font-ui` (Inter + system stack), `--font-mono` (IDs/code) | `font-sans`, `font-mono` |
| Motion | `--motion-micro` 150ms, `--motion-panel` 250ms, `--ease-out` | `duration-micro/panel ease-smooth`; JS: `motion` from `tokens.ts` |
| Focus | `--focus-ring` | `focusRing` export from `src/crm/components/ui.tsx` |

## Verifying changes

Any change to a color token must pass the contrast gate before commit:

```
node scripts/check-contrast.mjs   # WCAG AA — exits 1 on failure
```

Update the hardcoded mirror values in that script (and `tokens.ts`) whenever a
hex changes here.
