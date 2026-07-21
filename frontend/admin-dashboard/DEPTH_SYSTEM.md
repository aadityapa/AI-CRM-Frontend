# KARNEX Depth System — one-page reference

Tokens live in `src/styles/tokens.css` (imported at the top of `src/styles.css`).
Light = `:root`, dark = `.dark` on `<html>` (already toggled by `ThemeProvider`).
All values are contrast-verified: `node scripts/check-contrast.mjs` (re-run after any token change).

## The 4 elevation levels

| Level | Token / class | Surface | Use for |
|---|---|---|---|
| E0 | `--e0` (no class) | `--surface-0` | Page background, text blocks, table bodies, anything flat |
| E1 | `.elev-1` / `shadow-e1` | `--surface-1` | Cards, panels, list rows — the default resting card |
| E2 | `.elev-2` / `shadow-e2` | `--surface-2` | Raised: popovers, dropdowns, hover-lifted cards, sticky bars |
| E3 | `.elev-3` / `shadow-e3` | `--surface-3` | Overlays only: modals, command palette, toasts |

Each shadow is a two-layer pair: tight contact shadow + wide low-alpha ambient.
`.elev-*` classes compose background + border + shadow + specular edges
(`--edge-highlight` top, `--edge-shade` bottom). Add your own `rounded-*`.

**Composition rules (non-negotiable):**
- At most **one E2/E3 element dominant** per view — depth is hierarchy, not decoration.
- **Never gloss-in-gloss**: no `.sheen`/`.glass` nested inside another `.sheen`/`.glass`.
- **Text areas stay E0/E1.** Long-form copy never sits on glass, sheen or E2+.

## Recipes

- **Glass** — `.glass`: `--glass-bg` + `backdrop-filter: blur(var(--glass-blur))` +
  lighter top border (`--glass-border-top`) / darker bottom (`--glass-border-bottom`).
  `--glass-blur` is 14px, auto-drops to 6px under 768px (mobile jank budget —
  the app already has ~82 backdrop-blur usages; prefer `.glass` so they all obey this).
- **Sheen** — `.sheen` (adds `::before`, pointer-events none): 135° gloss over the top
  ~40%. Alpha capped (0.09 light / 0.05 dark) so all AA pairs still pass with sheen composited.
- **Skeleton** — `.shimmer`: moving 135° sheen; becomes an opacity pulse under reduced motion.
- **Inputs** — `.input-recessed`: inset at rest; on focus rises to E1 + `--focus-ring`
  (ring = 2px surface gap + 4px brand, readable on glass).
- **Buttons** — `.btn-depth`: raised (E1 + specular top edge); hover = brighter gloss + E2;
  active = shadow collapses + `translateY(1px)`; disabled = flat, no gloss.

## AI accent — reserved

`--ai-gradient` (brand-400 → violet) and `--ai-glow` are for **AI surfaces only**
(AI-generated content, AI-in-progress states). Never use them for generic emphasis.
- `.ai-surface`: gradient border + glow.
- `.ai-generating`: same, with the border gradient angle animating (`ai-rotate`);
  animation is disabled under `prefers-reduced-motion`.

## Motion tokens

| Token | Value | Tailwind |
|---|---|---|
| `--dur-fast` | 100ms | `duration-fast` — presses, hovers |
| `--dur-base` | 150ms | `duration-base` — most transitions |
| `--dur-slow` | 250ms | `duration-slow` — panels, accordions |
| `--dur-page` | 400ms | `duration-page` — route transitions |
| `--ease-out` | cubic-bezier(0.16,1,0.3,1) | `ease-smooth` |
| `--ease-spring-ish` | cubic-bezier(0.34,1.56,0.64,1) | `ease-spring` |

## Consuming it

**CSS classes:** `.elev-1/2/3`, `.glass`, `.sheen`, `.ai-surface`, `.ai-generating`,
`.shimmer`, `.input-recessed`, `.btn-depth`.

**Tailwind keys** (wired in `tailwind.config.cjs`, all resolve to the CSS vars so
they theme automatically — no `dark:` needed):
- Colors: `bg-brand-50…900`, `bg-surface-0/1/2/3`, `bg-success/-soft`, `warning`, `danger`, `info`
- Text: `text-primary`, `text-secondary`, `text-muted`
- Borders: `border-subtle`, `border-strong`
- Shadows: `shadow-e1/e2/e3`, `shadow-focus-ring`, `shadow-ai-glow`
- Radii: `rounded-control` (8px), `rounded-card` (12px), `rounded-panel` (16px), `rounded-modal` (24px)
- Motion: `duration-fast/base/slow/page`, `ease-smooth`, `ease-spring`

Note: `--brand-500` is `#0d8ecd` (slightly darker than the old sky-500 `#0ea5e9`)
so white-on-brand stays ≥ 3.0:1 even under sheen; `--brand-600+` blend toward indigo.
The legacy `--kx-*` variables in `styles.css` remain untouched for now — migrate
consumers to these tokens, then retire them.
