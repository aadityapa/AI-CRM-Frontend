# KARNEX Admin Dashboard — Design Decisions

**Redesign direction:** "Linear meets Stripe Dashboard" — premium, calm, professional. Not flashy.
**Scope of this pass:** STEP 1 (design system) + STEP 2 (shared component pass). **Zero page/screen files were edited.**

---

## 1. Strategy: evolve, don't fork (pinned decision)

The existing token layer (`src/styles/tokens.css`, consumed by ~40 pages via Tailwind-mapped
utilities and utility classes like `.glass`/`.elev-1`/`.btn-depth`) was **evolved in place**,
not forked:

- **`src/design-system/tokens/tokens.css`** is the new **canonical primitive source**
  (color, typography, spacing, elevation, radius, motion).
- **`src/styles/tokens.css`** imports it **first** and re-expresses every legacy variable
  (`--brand-*`, `--surface-*`, `--e0..--e3`, `--r-sm..xl`, `--dur-*`, `.glass`, `.sheen`,
  `.btn-depth`, `.input-recessed`, `.elev-1..3`) as **aliases** of the primitives.
- **`src/design-system/tokens/tokens.ts`** is the typed mirror for JS consumers (charts).
- Every existing export signature and class-string name (`btnPrimary`, `inputCls`,
  `rounded-panel`, `shadow-e2`, …) keeps working — **values evolved, APIs did not.**

Import chain: `main.tsx` → `styles.css` → `@import styles/tokens.css` → `@import design-system/tokens/tokens.css` (primitives land first).

## 2. Color

### Brand — one hue, calm Stripe-adjacent blue (hue ≈ 226)

Replaces the old cyan-leaning sky ramp. `brand-600` is the primary action color (white text AA 4.5+).

| Token | Hex | Role |
|---|---|---|
| `--brand-50` | `#f5f8fe` | tinted backgrounds |
| `--brand-100` | `#e9effc` | |
| `--brand-200` | `#d4e0fa` | |
| `--brand-300` | `#aac3f3` | dark-theme link/tab text (AA on dark surfaces) |
| `--brand-400` | `#7d9dec` | accents, AI gradient start |
| `--brand-500` | `#4f6ef7` | accent / focus ring (white text = large-UI 3.0 tier) |
| `--brand-600` | `#3a5bd9` | **primary button**, light-theme link text (white AA 4.5+) |
| `--brand-700` | `#2c47b8` | primary hover |
| `--brand-800` | `#24378f` | primary active |
| `--brand-900` | `#1d2b66` | deep ink |

### Neutral — cool gray with a slight blue cast (only gray in the system)

`--neutral-0..900`: `#ffffff`, `#f8fafc`, `#f1f5f9`, `#e3e9f0`, `#cbd5e1`, `#94a3b8`,
`#64748b`, `#475569`, `#334155`, `#1e293b`, `#0f172a`.

Light surface ladder (aliased in `styles/tokens.css`): page `--surface-0` = neutral-100,
card `--surface-1` = white, **hover/popover `--surface-2` = neutral-50** (one step *darker*
than the card so row hover reads on white — deliberate inversion of the old lighter-when-raised
ladder), modal `--surface-3` = white (separation comes from elevation, not tint).

### Semantic (+ soft) — AA-verified in both themes

Light: success `#047857`/`#ecfdf5`, warning `#b45309`/`#fffbeb`, danger `#c81e2c`/`#fef2f2`,
info `#075985`/`#f0f9ff`. Dark: success `#34d399`, warning `#fbbf24`, danger `#f87171`,
info `#7dd3fc` with 14–15% alpha softs over surface-1.

New: `--danger-solid` / `-hover` / `-active` (`#c81e2c`/`#ad1a26`/`#96161f` light,
`#d02936`/`#c81e2c`/`#ad1a26` dark) — solid danger buttons keep dark pigment in **both**
themes so white text stays AA (the plain `--danger` flips light in dark mode for use as *text*
and must never be a button background). This fixes a latent dark-mode AA bug in `btnDanger`.

## 3. Typography

- **Inter** for UI, loaded in `index.html` (preconnect ×2 + `display=swap`, weights 400–700),
  with a `system-ui` fallback stack in `--font-ui`. `--font-mono` stays system mono.
- Type scale (px): `--text-xs` 12 / `sm` 14 / `base` 16 / `lg` 20 / `xl` 24 / `2xl` 32.
  Body line-height `--leading-body: 1.5`.
- Tailwind `fontSize` is remapped so `text-xs..text-2xl` land **exactly** on this scale
  (note: `text-lg/xl/2xl` grew from Tailwind defaults 18/20/24 → 20/24/32 by design).

## 4. Spacing

Strict **4px grid**: `--space-1..16` = 4/8/12/16/24/32/48/64. Tailwind numeric utilities
(`p-1`, `gap-2`, `m-4`, …) already sit on this grid (1 unit = 4px) and are the **sanctioned**
way to consume it. **Arbitrary pixel values (`p-[13px]`) are banned.**

## 5. Elevation — exactly four levels

Calmer than before: smaller spreads, lower opacity (small contact + soft ambient, Stripe-like).

| Token | Use | Light value |
|---|---|---|
| `--elev-flat` | flush controls | `none` |
| `--elev-raised` | cards | `0 1px 2px rgba(15,23,42,.05), 0 1px 3px rgba(15,23,42,.04)` |
| `--elev-overlay` | dropdowns/popovers | `0 2px 6px rgba(15,23,42,.06), 0 12px 28px rgba(15,23,42,.10)` |
| `--elev-modal` | modals/toasts | `0 8px 20px .10, 0 24px 56px .16` |

Dark theme uses the same geometry at higher black opacities. **Retired aliases:**
`--e0/--e1/--e2/--e3` → flat/raised/overlay/modal; Tailwind `shadow-glass` → raised;
`shadow-e1/e2/e3` → the same four. No fifth shadow exists.

## 6. Radius — exactly three (+ pill exception)

`--radius-input` **6px** (controls/inputs) · `--radius-card` **10px** (cards/panels) ·
`--radius-modal` **16px** (modals). Rewired: `--r-sm`→6, `--r-md`→10, `--r-lg`→16,
`--r-xl`→16 (**deprecated**). Tailwind: `rounded-control`→6, `rounded-card` & `rounded-panel`→10,
`rounded-modal`→16. **Documented exception:** `9999px` (`--r-full`/`rounded-full`) is allowed
**only** for pills, avatars and status dots — a shape, not a radius.

## 7. Motion

Two durations, one curve: `--motion-micro` **150ms** (hover/press/fade), `--motion-panel`
**250ms** (drawers/modals/collapse), `--ease-out: cubic-bezier(0.2, 0, 0, 1)`.
Rewired: `--dur-fast`/`--dur-base` → 150ms, `--dur-slow`/`--dur-page` → 250ms,
`--ease-spring-ish` → `--ease-out` (spring/overshoot **retired**; the framer-motion mirrors in
`motion3d.tsx` and `ui.tsx` were synced). Existing `prefers-reduced-motion` handling kept:
movement is stripped, opacity fades remain, shimmer falls back to pulse.

## 8. Dark mode

Existing mechanism unchanged: `.dark` class on `<html>` (pre-hydration script in `index.html`
+ `src/theme/ThemeProvider.tsx`). Primitives that flip (semantic colors, elevation) carry a
`.dark` block in the primitives file; surface/text aliases flip in `styles/tokens.css`.
Brand and neutral ramps are theme-invariant pigments.

## 9. Glossy → calm (what changed)

- **`.sheen`**: top-light alpha capped 0.09 → **0.05** light / 0.03 dark — barely-there, opt-in.
- **`.glass`**: opacity 0.72 → **0.88** (near-opaque), blur 14px → **8px** (4px mobile). Treat as a slightly-translucent card, not a lens.
- **`.btn-depth`**: now **flat-first** — gloss gradient removed (`--btn-gloss` → transparent), no lift/press translate; bordered control with 150ms background/border micro-transitions, hover tint (`--control-hover`), pressed tint, 50% disabled.
- **`.input-recessed`** (name kept): recessed inner shadow retired → flat field, calm strong border, border darkens on hover, brand focus ring on focus.
- **`KpiCard`**: `Tilt3D` + glass + sheen **dropped** — raised card, hairline accent, `AnimatedNumber` kept.
- Specular edge highlights dimmed (0.75 → 0.40 alpha); elevation recipes no longer stack them.
- Modal backdrop: `neutral-900/60` — opaque enough that background content doesn't bleed.
- Table rows: entrance reduced to a 150ms fade; spinner is a quiet ring, not bouncing dots.

## 10. Component pass (STEP 2 summary)

`src/crm/components/ui.tsx` and `DataTable.tsx` rebuilt on tokens only — every interactive
element has **hover / focus-visible / active / disabled** states:

- Buttons: primary solid brand-600 → hover 700 → active 800, disabled 50% opacity; secondary = the flat `.btn-depth` recipe (surface + border + hover/active tints); danger rides the theme-stable `danger-solid` trio so white text stays AA in both themes. The exported API is the legacy `btnPrimary`/`btnSecondary`/`btnDanger` strings (unchanged names, 30+ consumers). **Solid-button hover-wash fix lives at the CSS layer** (`styles/tokens.css`): `.btn-depth.bg-brand-600:hover` and `.btn-depth.bg-danger:hover` overrides keep the fill and darken instead of washing to `--control-hover`.
- `Modal` 16px / `--elev-modal` / 250ms fade+scale (opacity-only under reduced motion); backdrop is the new `--backdrop` token (`bg-backdrop`, 60% neutral-900 ink light / 65% deeper ink dark) — no more hardcoded `bg-slate-950/60`.
- `Tabs`: 150ms tweened underline (`--motion-micro` + `--ease-out`; the old spring is retired), counts pill on `ring-subtle`, focus-visible ring.
- Toast (`useToast`): **overlay elevation** (`--elev-overlay`), not modal — modals stay the sole modal-tier layer; surface-3 + subtle border, semantic icon colors, 250ms ease-out slide+fade, opacity-only under reduced motion.
- `EmptyState` keeps its single-`message` API (no `title` prop — screens fold headline text into `message`).
- Skeleton primitives `Skeleton`/`SkeletonText` now use the `.shimmer` recipe (neutral tokens; auto-degrades to an opacity pulse under reduced motion) instead of `animate-pulse`.
- `Spinner`: quiet brand ring (subtle track + brand-500 arc, `motion-reduce:animate-none`) — the bouncing dots are gone.
- `KpiCard`: `Tilt3D` + `.glass` + `.sheen` dropped → raised card (`.elev-1`, hover to `--elev-overlay`), hairline (2px) brand accent, `AnimatedNumber` kept.
- Inputs: `inputCls` unchanged (flat `.input-recessed`); error states compose the CSS `.input-error` recipe (danger border at rest/hover, danger focus ring) directly.
- `StatusBadge` ring moved from `ring-black/5 dark:ring-white/10` to the token `ring-subtle` (new Tailwind `ringColor` mapping, with `ring-strong`).
- `DataTable`: zebra-free, 48px min rows (`h-12`), `Column.align: "right"` with `tabular-nums`, sticky opaque header + subtle bottom border, 150ms hover shift, faint dual-chevron sort affordance + `aria-sort`, shimmer skeleton rows, token-only pagination. Header style decision: **12px uppercase + tracking-wide in muted** (quieter than 14px medium next to 14px body cells).
- `focusRing` is now exported from `ui.tsx` (additive) so siblings share the identical ring.
- `ui.tsx` motion mirrors now import from `design-system/tokens/tokens.ts` (`motion.micro`/`panel`/`easeOut`) instead of hand-copied constants.
- Type-only fix in `src/App.tsx`: `NAV_DEFS`'s `Record` type now also excludes `"hrSetup"` (the entry never existed — it opens via the scheduler button, not primary nav). This was a pre-existing `tsc --noEmit` failure from the restructure; zero runtime change.
- What was deliberately NOT changed: `Modal`'s focus trap/portal/fullscreen API, `statusColor`'s status→color map, `DataTable`'s prop contract, the `.glass`/`.sheen` utility classes (kept as calm near-opaque recipes for existing page usage), `Tilt3D` (still exported from `motion3d.tsx` for any external use), and every export name — 30+ screens consume these by name.

## 11. Contrast results

`node scripts/check-contrast.mjs` (extended to the new palette, both themes, every pair also
composited under the worst-case sheen): **112 checks, 112 passed, 0 failed.**
Representative ratios — light: primary text on page 16.30, muted on card 5.43, white on
brand-600 5.71, warning on soft 4.84; dark: muted on modal surface 5.32, brand-300 links 10.04,
white on danger-solid 4.65 (worst pair, still AA). The script exits 1 on any failure — run it
after any token change.

## 12. Screenshots & self-review gate (STEP 4 record)

In-session screenshot files could not be persisted to disk (environment limitation), so the
before/after review was performed live against the running server (https://192.168.1.87:2020)
with screenshots inspected inline. Gate executed 2026-07-12 evening, after the screen pass and
a full launcher rebuild:

- Screens reviewed (before + after): CRM Dashboard (`?view=crm&p=`), Opportunities list +
  New Opportunity full-screen form, Candidate Profiles pipeline (`p=profiles`), HR Setup
  (`?view=hrSetup`), My Profile (`p=profile`).
- Contrast: 112/112 automated checks pass (see §11) — re-run after the gate's fixes: still 112/112.
- Law greps at gate time (5 screens + `ui.tsx` + `DataTable.tsx`): 0 hex, 0 arbitrary `[Npx]`,
  0 raw `slate-*`. Radii and shadows are token-enforced (only 3 radius / 4 elevation variables
  exist in the system).
- Violations found during the gate and fixed: `Modal` backdrop was still hardcoded
  `bg-slate-950/60` → `bg-backdrop`; `Tabs` count pill used `text-[11px]` + `ring-black/5` →
  `text-xs` + `ring-subtle`; solid brand/danger buttons washed to neutral on hover
  (`.btn-depth:hover` cascade bug) → fixed with solid-button CSS overrides in
  `styles/tokens.css` (see §10).
- Visual confirmation after rebuild: page-header blocks consistent (24px title + muted
  subtitle + single primary action), tables zebra-free with 48px rows / right-aligned numerics
  / sticky headers, HR Setup AI cards calmed to raised cards with a single brand icon-chip
  accent, New Opportunity form renders with section nav, 2-col grid, token error/auto-fill
  states.

To reproduce visually: `npm run dev`, or the deployed build at `/admin` — toggle the header
theme switch for the light/dark variants.

## 13. Known screen-level violations (for the screen-pass agent)

The shared layer (`ui.tsx`, `DataTable.tsx`, `motion3d.tsx`, `Avatar.tsx`, tokens, Tailwind
config) is now violation-free. Page/screen files still contain the patterns below —
**deliberately untouched in this pass** (zero page edits was the constraint). Re-grep before
fixing; counts are as of 2026-07-12.

### Arbitrary `[Npx]` Tailwind values — grep `\[\d+(\.\d+)?px\]` (≈243 hits, 38 files)

Worst offenders: `src/pages/TemplateForm.tsx` (54), `src/pages/CandidateReportPage.tsx` (30),
`src/pages/CandidateInterviews.tsx` (24), `src/components/candidate-report/StrengthsWeaknessesPanel.tsx` (14),
`src/components/candidate-report/ProfessionalAssessmentSections.tsx` (12),
`src/components/ReportGroupDetail.tsx` (11), `src/components/SessionDetail.tsx` (9),
`src/crm/pages/Requirements.tsx` (8), `src/crm/pages/UsersAdmin.tsx` (8).
Also (≤7 each): App.tsx, CrmApp.tsx, ATS, Dashboard, Templates, QuestionBank, PromptLogs,
IntegrityLogs, UpcomingInterviews, StatusPill, CandidateSidebar, SessionSidebar,
CandidateDetail, InterviewStatusSelector, KarnexBranding, ReportGroupSidebar,
crm/components/CustomerFormModal (4), crm/components/FileUpload (2), crm/components/Timeline (1),
crm pages: Customers, Holidays, Employees, CrmSettings, Opportunities, CrmCandidates, Finance,
LeaveApplications, Profiles, Timesheets. Most are `text-[11px]`/`text-[13px]` (→ `text-xs`/`text-sm`)
and one-off `w-[…px]`/`h-[…px]` (→ nearest 4px utility).

### Hardcoded hex colors in TSX — grep `#[0-9a-fA-F]{3,6}\b` (≈154 hits, 5 files)

All in the PDF render templates + charts: `src/components/pdf/CandidatePdfTemplate.tsx` (59),
`src/components/pdf/InterviewPdfTemplate.tsx` (46), `src/components/pdf/InterviewPdfQuestionBlock.tsx` (36),
`src/components/pdf/PdfScoreBar.tsx` (7), `src/components/candidate-report/ReportCharts.tsx` (6).
Decision for the screen pass: migrate these to the static mirrors in
`src/design-system/tokens/tokens.ts` (`brand`/`neutral`/`semantic`/`chartPalette`) — PDF output
can't read CSS vars, so the typed mirror is the sanctioned source.

### Raw Tailwind slate-* palette classes instead of token utilities (≈2100 hits)

grep `(text|bg|border)-slate-\d+`. Top: TemplateForm (353), CandidateReportPage (219),
PromptLogs (187), Requirements (133), Profiles (122), CandidateInterviews (110),
ReportGroupDetail (78), IntegrityLogs (69), Opportunities (68), StrengthsWeaknessesPanel (63),
QuestionBank (59), Finance (55), Customers (54), Templates (53), CrmCandidates (49), + others.
These currently work via the `html.dark .bg-slate-*` override shims in `styles.css`; the screen
pass should replace them with `text-primary/secondary/muted`, `bg-surface-*`, `border-subtle/strong`
and then delete the shims.

### Leftover non-token ring hack

`ring-black/5 dark:ring-white/10` still appears in page files (e.g. `crm/pages/Timesheets.tsx`)
— replace with the new `ring-subtle`.

## 14. v3 "Premium AI SaaS" elevation (2026-07-20) — foundations + shells + shared components

Direction: from "Linear/Stripe calm" to premium 2026 AI-SaaS (OpenAI/Vercel/Raycast energy),
**dark-mode first**, light stays functional + AA. Evolve-don't-fork again: zero export renames,
zero page/screen edits, all laws below re-affirmed.

### Palette v3 (final, gate-verified — 146/146 checks pass)

- **Brand → indigo**, anchored `#6366F1` = brand-500. Full ramp:
  50 `#eef2ff` / 100 `#e0e7ff` / 200 `#c7d2fe` / 300 `#a5b4fc` / 400 `#818cf8` /
  500 `#6366f1` / 600 `#4f46e5` (primary action, white 6.29) / 700 `#4338ca` /
  800 `#3730a3` / 900 `#312e81`.
- **Violet promoted** from the inline ai-gradient hex to a scale `--violet-300..800`
  (`#c4b5fd → #5b21b6`, anchor `#8b5cf6`). Role: **gradient far-stop only** (primary button,
  nav pill, AI surfaces) — never a standalone action color. White on violet-600/700/800 =
  5.70 / 7.10 / 8.98.
- **NEW cyan accent** `--accent-300..600` (anchor `#22d3ee`). Used **sparingly**: live
  indicators, AI highlights, gradient hairline tails. Not a text color on light surfaces;
  never a button fill. accent-400 on dark page = 11.0.
- **Semantic family anchors** `--success-500 #10b981` / `--warning-500 #f59e0b` /
  `--danger-500 #ef4444` — decorative / large-UI / charts only (success-500 on white is
  2.5:1 — NOT text-grade). The AA text-grade semantics and the `danger-solid` trio are
  unchanged in both themes.
- **Dark surfaces**: page `--surface-0` **`#050816`** (deep indigo-black), raised
  `--surface-1` `#0f172a`, hover `#1e293b`, modal `#283548` (kept — separation still works).
- **Dark text — requested vs shipped (AA nudges, documented honestly):** the brief asked
  secondary `#94a3b8` / muted `#64748b`. Both fail: `#64748b` is 3.64 on surface-1;
  `#94a3b8` is 4.42 on modal+sheen. Shipped: secondary **`#b6c2d4`** (dimmer than the old
  `#cbd5e1`, worst-case 6.29), muted stays **`#9dabbf`** (worst-case 4.86). Light text
  unchanged.
- **Glass v3**: light `rgba(255,255,255,0.80)`, dark **`rgba(255,255,255,0.06)`**, blur
  12px (4px mobile). Translucency is **`.glass`-only** — opaque token surfaces remain for
  tables/busy screens (perf + readability). Dark glass composites to ≈ surface-1, and the
  gate now checks explicit text-on-glass pairs in both themes.

### Effects kit (styles/tokens.css — opt-in, token-only, GPU-cheap)

`.fx-aurora` (evolved `.moonlight`, which stays as an alias — indigo/violet/cyan mesh, 60s
transform drift, alphas ≤ 0.15, dedup rule covers both class names) · `.fx-aurora-hero`
(login-hero only, ≤ 0.22) · `.fx-noise` (2.5% SVG data-URI) · `.fx-grid` (masked 40px grid)
· `.fx-gradient-border` (+`-animated`, masked indigo→violet→cyan hairline; the animated
angle drift is AI-surfaces-only; do not combine with `.sheen` — both own `::before`) ·
`.fx-glow`/`.fx-glow-hover` (`--glow-brand` bloom — **shadow-only accent in the `--ai-glow`
family, not a fifth elevation**) · `.fx-lift` (−2px/150ms, transform+shadow only) ·
`.fx-hairline-b` (gradient bottom hairline for glass bars) · `.fx-spotlight` (ONE global
mouse-follow highlight per shell, `--spot-x/y` written by the rAF-throttled `useSpotlight`
hook in `motion3d.tsx`, mounted by App.tsx; alpha ≤ 0.06; hidden on touch + reduced motion;
**no per-card listeners**) · `.ai-thinking` (3-dot pulse + `AiThinking` export; static
staggered opacity under reduced motion) · `.row-hover` (brand-tinted row bg) ·
`.nav-pill-gradient` and `.btn-gradient` (indigo→violet fills; every gradient stop white-AA
in every state). All animated effects sit in `no-preference` blocks or are excluded under
`prefers-reduced-motion: reduce`.

### Typography

Space Grotesk (500/600/700, Google Fonts, `display=swap` + existing preconnects) as
`--font-display` / `font-display` / `.text-display` — **h1/page titles + KPI numerals
ONLY**; body stays Inter. The display stack falls back to the Inter stack so FOUT is
metric-benign. Pre-paint dark background in index.html updated to `#050816`.

### Shells & components

- Platform shell root now uses `bg-surface-0 text-primary` (was `--kx-bg`/`--kx-text` —
  those legacy vars still exist in styles.css for pages). Aurora + spotlight mounted in both
  shells (dedup rules make the nested CRM copies no-ops); glass top bars get `.fx-hairline-b`.
- CRM sidebar → floating inset **glass** panel (outer `p-2` keeps sticky geometry —
  no arbitrary offsets; width 56→60 to absorb the inset). Active item = indigo→violet
  gradient pill (`.nav-pill-gradient`, white text, AA both stops) with soft bloom + the
  existing layoutId slide; roles/RBAC/collapse behavior untouched. No fake search or
  workspace switcher was added (the app has neither — skipped rather than stubbed).
- `btnPrimary` → `.btn-depth .btn-gradient bg-brand-600 …` (same export name): gradient
  fill + glow, hover darkens (700-stops) + strong glow + 1px lift, active 800-stops press.
  `bg-brand-600` stays in the string as paint fallback, so the §12 solid-button CSS
  overrides still guard the background-color layer (the `.btn-depth` cascade lesson).
- `KpiCard`: Tilt3D wrapper **dropped** (see scope-outs), now `.glass` +
  `.fx-gradient-border` + `.fx-lift`; accent prop still renders (thinner strip);
  `AnimatedNumber` + `.text-display tabular-nums` numerals.
- Toast: glass + `shadow-overlay` + semantic left rail (`border-l-2` success/danger).
- `EmptyState`: icon chip in a gradient ring (`rounded-full` = documented shape exception)
  + additive `action` ReactNode slot; `message`/`actionLabel`/`onAction` API unchanged.
- `DataTable`: `.row-hover` brand tint replaces the neutral hover (bg tint only — no
  shadows/filters on dense tables); sticky header/skeletons/pagination untouched.
- `StatusBadge` ring moved to `ring-subtle` (was the raw `ring-black/5` hack).
- **Modal radius stays 16px** — the v3 ask was 20px, but the 3-radius law (6/10/16) wins;
  deviation noted here deliberately. Backdrop blur + scale-in already met the brief.

### Laws re-affirmed + honest scope-outs

4 elevations · 3 radii (+pill shape) · 150/250ms, one curve · no arbitrary values ·
contrast gate green (now **146 checks**, incl. glass/violet/accent pairs) · reduced-motion
coverage on every animated effect · effects heavier than shadows are opt-in, hero-only.
**Deliberately NOT built** (requested-adjacent 2026 patterns rejected): confetti, magnetic
buttons, 3D tilt on dense screens (KpiCard's tilt removed for this reason; `Tilt3D` stays
exported for hero use), per-card particles/listeners, ripple (Material language — conflicts
with the flat-press language), resizable table columns (feature change, not skin).

### Known drift found during this pass (for the record)

Parts of §10 described a state this repo had not fully reached (Toast was still `elev-3`,
KpiCard still had Tilt3D/glass/sheen, Tabs still springs, Spinner still bouncing dots).
v3 brings Toast/KpiCard/StatusBadge to (beyond) the documented state; Tabs' spring underline
and the bouncing-dot Spinner remain as-is — flagged for a later interaction pass rather than
silently changed here.
