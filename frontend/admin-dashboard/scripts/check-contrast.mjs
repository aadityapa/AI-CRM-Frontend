#!/usr/bin/env node
/**
 * KARNEX token contrast verifier (WCAG 2.x relative luminance).
 * Hardcodes the hex/rgba values from src/design-system/tokens/tokens.css and
 * src/styles/tokens.css, and checks every text/background pair — each pair is
 * ALSO checked with the sheen gradient's worst-case top stop alpha-composited
 * onto the background first.
 *
 * Tiers: "body" must be >= 4.5, "ui" (large text / UI glyphs) >= 3.0.
 * Exits 1 on any failure. Run: node scripts/check-contrast.mjs
 */

function hex(h) {
  const s = h.replace("#", "");
  const f = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
}

// Composite an rgba overlay onto an opaque rgb base.
function over(baseRgb, topRgb, alpha) {
  return baseRgb.map((c, i) => c * (1 - alpha) + topRgb[i] * alpha);
}

function lum([r, g, b]) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(fgRgb, bgRgb) {
  const l1 = lum(fgRgb);
  const l2 = lum(bgRgb);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = [255, 255, 255];

/* ---- Token values (keep in sync with src/design-system/tokens/tokens.css
        and the surface aliases in src/styles/tokens.css) ------------------- */
const LIGHT = {
  name: "LIGHT",
  sheenAlpha: 0.05, // --sheen worst-case top stop: rgba(255,255,255,0.05)
  s0: hex("#f1f5f9"), // --surface-0 = neutral-100 (page)
  s1: hex("#ffffff"), // --surface-1 = neutral-0 (card / modal)
  s2: hex("#f8fafc"), // --surface-2 = neutral-50 (hover tint / popover)
  // v3 glass: rgba(255,255,255,0.80) over the page (worst case).
  glass: over(hex("#f1f5f9"), WHITE, 0.8),
  textPrimary: hex("#0f172a"), // neutral-900
  textSecondary: hex("#475569"), // neutral-600
  textMuted: hex("#5d6b7e"),
  // v3 indigo ramp (anchored #6366f1)
  brand300: hex("#a5b4fc"),
  brand500: hex("#6366f1"),
  brand600: hex("#4f46e5"),
  brand700: hex("#4338ca"),
  brand800: hex("#3730a3"),
  // v3 violet (gradient far-stops for solid buttons / nav pill)
  violet600: hex("#7c3aed"),
  violet700: hex("#6d28d9"),
  violet800: hex("#5b21b6"),
  success: hex("#047857"),
  warning: hex("#b45309"),
  danger: hex("#c81e2c"),
  info: hex("#075985"),
  successSoft: hex("#ecfdf5"),
  warningSoft: hex("#fffbeb"),
  dangerSoft: hex("#fef2f2"),
  infoSoft: hex("#f0f9ff"),
  dangerSolid: hex("#c81e2c"),
  dangerSolidHover: hex("#ad1a26"),
  dangerSolidActive: hex("#96161f"),
};

const DARK = {
  name: "DARK",
  sheenAlpha: 0.03, // --sheen worst-case top stop: rgba(255,255,255,0.03)
  s0: hex("#050816"), // --surface-0 (v3 page — deep indigo-black)
  s1: hex("#0f172a"), // --surface-1 = neutral-900 (card)
  s2: hex("#1e293b"), // --surface-2 = neutral-800 (hover / popover)
  s3: hex("#283548"), // --surface-3 (modal)
  // v3 dark glass: rgba(255,255,255,0.06) over the page.
  glass: over(hex("#050816"), WHITE, 0.06),
  textPrimary: hex("#f1f5f9"), // neutral-100
  textSecondary: hex("#b6c2d4"), // v3 nudge (asked #94a3b8 fails s3+sheen)
  textMuted: hex("#9dabbf"), // v3 keep (asked #64748b is 3.64 on s1 — fails)
  brand300: hex("#a5b4fc"),
  brand500: hex("#6366f1"),
  brand600: hex("#4f46e5"),
  brand700: hex("#4338ca"),
  brand800: hex("#3730a3"),
  violet600: hex("#7c3aed"),
  violet700: hex("#6d28d9"),
  violet800: hex("#5b21b6"),
  // v3 cyan accent — live indicators / AI highlights (dark surfaces only).
  accent400: hex("#22d3ee"),
  // v3 semantic family anchors (decorative/large-UI, dark surfaces).
  success500: hex("#10b981"),
  warning500: hex("#f59e0b"),
  danger500: hex("#ef4444"),
  success: hex("#34d399"),
  warning: hex("#fbbf24"),
  danger: hex("#f87171"),
  info: hex("#7dd3fc"),
  // dark soft bgs are rgba over surface-1 — composite them here
  successSoft: over(hex("#0f172a"), hex("#34d399"), 0.14),
  warningSoft: over(hex("#0f172a"), hex("#fbbf24"), 0.14),
  dangerSoft: over(hex("#0f172a"), hex("#f87171"), 0.15),
  infoSoft: over(hex("#0f172a"), hex("#38bdf8"), 0.15),
  dangerSolid: hex("#d02936"),
  dangerSolidHover: hex("#c81e2c"),
  dangerSolidActive: hex("#ad1a26"),
};

function pairsFor(t) {
  const p = [];
  const surfaces = t.name === "DARK" ? ["s0", "s1", "s2", "s3"] : ["s0", "s1", "s2"];
  for (const surf of surfaces) {
    p.push([`text-primary on ${surf}`, t.textPrimary, t[surf], "body"]);
    p.push([`text-secondary on ${surf}`, t.textSecondary, t[surf], "body"]);
    p.push([`text-muted on ${surf}`, t.textMuted, t[surf], "body"]);
  }
  // v3 glass surfaces (composited over the page) — headers, sidebar, toasts.
  for (const txt of ["textPrimary", "textSecondary", "textMuted"]) {
    p.push([`${txt.replace("text", "text-").toLowerCase()} on glass`, t[txt], t.glass, "body"]);
  }
  // Solid brand buttons: default / hover / active (white text).
  p.push(["white on brand-500", WHITE, t.brand500, "ui"]);
  p.push(["white on brand-600", WHITE, t.brand600, "body"]);
  p.push(["white on brand-700 (hover)", WHITE, t.brand700, "body"]);
  p.push(["white on brand-800 (active)", WHITE, t.brand800, "body"]);
  // v3 gradient button / nav pill far-stops (white text on violet-*).
  p.push(["white on violet-600 (gradient stop)", WHITE, t.violet600, "body"]);
  p.push(["white on violet-700 (gradient hover)", WHITE, t.violet700, "body"]);
  p.push(["white on violet-800 (gradient active)", WHITE, t.violet800, "body"]);
  // Brand-as-text (links, active tabs).
  if (t.name === "LIGHT") {
    p.push(["brand-600 text on s0", t.brand600, t.s0, "body"]);
    p.push(["brand-600 text on s1", t.brand600, t.s1, "body"]);
  } else {
    p.push(["brand-300 text on s1", t.brand300, t.s1, "body"]);
    p.push(["brand-300 text on s2", t.brand300, t.s2, "body"]);
  }
  for (const s of ["success", "warning", "danger", "info"]) {
    p.push([`${s} on s1`, t[s], t.s1, "body"]);
    p.push([`${s} on ${s}-soft`, t[s], t[`${s}Soft`], "body"]);
  }
  // Solid danger buttons use the theme-stable *-solid trio in BOTH themes.
  p.push(["white on danger-solid", WHITE, t.dangerSolid, "body"]);
  p.push(["white on danger-solid-hover", WHITE, t.dangerSolidHover, "body"]);
  p.push(["white on danger-solid-active", WHITE, t.dangerSolidActive, "body"]);
  if (t.name === "LIGHT") {
    // solid success buttons only exist in light theme
    p.push(["white on success", WHITE, t.success, "body"]);
  }
  if (t.name === "DARK") {
    // v3 cyan accent (live indicators / AI highlights — dark surfaces only).
    p.push(["accent-400 on s0", t.accent400, t.s0, "ui"]);
    p.push(["accent-400 on s1", t.accent400, t.s1, "ui"]);
    // v3 semantic family anchors — decorative/large-UI on dark cards.
    p.push(["success-500 anchor on s1", t.success500, t.s1, "ui"]);
    p.push(["warning-500 anchor on s1", t.warning500, t.s1, "ui"]);
    p.push(["danger-500 anchor on s1", t.danger500, t.s1, "ui"]);
  }
  return p;
}

let fail = 0;
const rows = [];
for (const theme of [LIGHT, DARK]) {
  for (const [label, fg, bg, tier] of pairsFor(theme)) {
    const min = tier === "body" ? 4.5 : 3.0;
    for (const sheened of [false, true]) {
      const bg2 = sheened ? over(bg, WHITE, theme.sheenAlpha) : bg;
      const r = ratio(fg, bg2);
      const ok = r >= min;
      if (!ok) fail++;
      rows.push([
        theme.name,
        label + (sheened ? " (+sheen)" : ""),
        tier,
        min.toFixed(1),
        r.toFixed(2),
        ok ? "PASS" : "FAIL",
      ]);
    }
  }
}

const headers = ["Theme", "Pair", "Tier", "Min", "Ratio", "Result"];
const widths = headers.map((h, i) =>
  Math.max(h.length, ...rows.map((r) => String(r[i]).length))
);
const fmt = (r) => r.map((c, i) => String(c).padEnd(widths[i])).join("  ");
console.log(fmt(headers));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const r of rows) console.log(fmt(r));
console.log(
  `\n${rows.length} checks, ${rows.length - fail} passed, ${fail} failed.`
);
process.exit(fail ? 1 : 0);
