/**
 * Control-tower atoms (23 Sep 2026) — the visual vocabulary shared by the
 * Dashboard's Hiring control tower and Reports ▸ Revenue.
 *
 * Both pages read a server payload keyed by an ANCHOR month at one of three
 * zooms (month · quarter · financial year), and both lay it out the same way:
 * one header card (title · zoom · date stepper · actions), a strip of accent-
 * bar tiles, half-dial gauges against a target, then panels. Keeping the atoms
 * in one file means a fix to the gauge or the stepper reaches both pages —
 * the two wizard chromes in this repo are the cautionary tale.
 *
 * Rules carried by every atom here:
 *  - colour means STATE (ok / warn / bad); brand blue stays on links and actions;
 *  - `inputCls` ends in `w-full`, so controls use `CONTROL` (no width) — appending
 *    `w-N` after `inputCls` never wins;
 *  - no alpha modifier on a `var()` token (`bg-surface-2/60` compiles to nothing).
 */
import React, { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Minus } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { chartPalette, chartPaletteDark, neutral, radius, semantic, semanticDark } from "../../design-system/tokens/tokens";
import { useTheme } from "../../theme/ThemeProvider";
import { CrmLink } from "../routerHooks";

/* ---------- formatting (one copy for every tower) ---------- */

export const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/** Compact rupees for axes and tiles: 12.5L, 1.2Cr. */
export function inrCompact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(0)}K`;
  return `₹${Math.round(n)}`;
}

export const pct = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined ? "—" : `${Number(n).toFixed(digits)}%`;

export const num = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : Number(n).toLocaleString("en-IN");

/** Change chip: green up, red down, grey when there is no base. In a table
 *  cell (no label) a missing base is a bare "—", never "n/a" on its own. */
export function Delta({ value, label = "", invert = false }: { value: number | null | undefined; label?: string; invert?: boolean }) {
  if (value === null || value === undefined) {
    if (!label) return <span className="text-xs text-muted">—</span>;
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted">
        <Minus className="h-3 w-3" aria-hidden /> {label} n/a
      </span>
    );
  }
  const up = value > 0;
  const flat = value === 0;
  const good = invert ? !up : up;
  const cls = flat ? "text-muted" : good ? "text-success" : "text-danger";
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${cls}`}>
      <Icon className="h-3 w-3" aria-hidden />
      {up ? "+" : ""}{value.toFixed(1)}%{label ? ` ${label}` : ""}
    </span>
  );
}

/* ---------- period zoom ---------- */

export type PeriodKind = "month" | "quarter" | "fy";

/** The three zooms. `months` is how far ‹ › step the anchor, so "previous"
 *  always means the previous period of the SAME kind. */
export const PERIODS: { key: PeriodKind; label: string; months: number; trend: string }[] = [
  { key: "month", label: "Month", months: 1, trend: "12-month trend" },
  { key: "quarter", label: "Quarter", months: 3, trend: "8-quarter trend" },
  { key: "fy", label: "Financial year", months: 12, trend: "5-year trend" },
];

export const periodMeta = (k: PeriodKind) => PERIODS.find((p) => p.key === k) ?? PERIODS[0];

/** Current month as YYYY-MM (local wall clock — the reports are IST-month based). */
export function thisMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/* ---------- financial years (Indian FY, April – March) ---------- */

export const FY_START_MONTH = 4;
/** How many past financial years the FY picker offers. */
export const FY_PICKER_YEARS = 6;

/** FY start year of a month key: "2027-02" → 2026 (FY 2026-27). */
export function fyOfMonth(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return m >= FY_START_MONTH ? y : y - 1;
}

export const fyLabel = (startYear: number) => `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;

/** The anchor month to use for a financial year: today's month while the FY is
 *  running (so run-rate / "current" behaviour holds), else its last month (March). */
export function fyAnchorMonth(startYear: number): string {
  const now = thisMonthKey();
  return fyOfMonth(now) === startYear ? now : `${startYear + 1}-03`;
}

/** The FY picker — replaces the month input at the FY zoom so the CEO can
 *  choose "FY 2025-26" by name instead of typing a month inside it. */
export function FySelect({ month, onPick, className = "" }: { month: string; onPick: (monthKey: string) => void; className?: string }) {
  const current = fyOfMonth(thisMonthKey());
  const chosen = fyOfMonth(month);
  const years: number[] = [];
  for (let y = current; y > current - FY_PICKER_YEARS; y--) years.push(y);
  if (!years.includes(chosen)) years.push(chosen);
  years.sort((a, b) => b - a);
  return (
    <select
      className={`bg-transparent px-2.5 text-sm font-semibold text-primary outline-none ${className}`}
      value={chosen}
      onChange={(e) => onPick(fyAnchorMonth(Number(e.target.value)))}
      aria-label="Financial year"
      title="Choose the financial year"
    >
      {years.map((y) => <option key={y} value={y}>{fyLabel(y)}{y === current ? " (current)" : ""}</option>)}
    </select>
  );
}

/* ---------- state tones ---------- */

export type StateTone = "ok" | "warn" | "bad" | "none";

export const STATE_TEXT: Record<StateTone, string> = {
  ok: "text-success", warn: "text-warning", bad: "text-danger", none: "text-muted",
};
export const STATE_CHIP: Record<StateTone, string> = {
  ok: "bg-success-soft text-success", warn: "bg-warning-soft text-warning",
  bad: "bg-danger-soft text-danger", none: "bg-surface-2 text-muted",
};

/** Hex stroke for a state, resolved per theme (SVG cannot read a Tailwind class). */
export function useStateStroke(): (state: StateTone) => string {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const tone = dark ? semanticDark : semantic;
  return (state) => ({ ok: tone.success, warn: tone.warning, bad: tone.danger, none: dark ? neutral[500] : neutral[400] }[state]);
}

/* ---------- controls ---------- */

/**
 * Local control class instead of `ui.tsx`'s `inputCls`.
 *
 * ⚠️ `inputCls` ends in `w-full`. Appending `w-40` after it does NOT win — both
 * are single-class selectors, so the one later in Tailwind's generated sheet
 * applies, and that is `w-full`. Anything sized in a control tower must
 * therefore avoid `inputCls` and set its own width.
 */
export const CONTROL = "input-recessed h-9 rounded-control border border-subtle bg-surface-1 px-3 text-sm text-primary";

/** Square icon button, sized to line up with CONTROL. */
export const ICON_BTN =
  "inline-flex h-9 w-9 items-center justify-center rounded-control border border-subtle bg-surface-1 " +
  "text-secondary transition-colors duration-micro hover:text-primary disabled:cursor-not-allowed disabled:opacity-40";

/** recharts tooltip chrome on the design tokens. */
export const tooltipStyle = {
  borderRadius: radius.card,
  border: "1px solid var(--border-subtle)",
  boxShadow: "var(--elev-overlay)",
  background: "var(--surface-3)",
  color: "var(--text-primary)",
  fontSize: 12,
  fontWeight: 600,
} as const;

/** Segmented control. One control, three zooms — not three tabs that each
 *  reload a different page, because every panel below reads the same payload. */
export function PeriodSwitcher({ value, onChange }: { value: PeriodKind; onChange: (v: PeriodKind) => void }) {
  return (
    <div className="inline-flex h-9 items-center rounded-control border border-subtle bg-surface-2 p-0.5" role="group" aria-label="Period">
      {PERIODS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onChange(p.key)}
          aria-pressed={value === p.key}
          className={`h-8 whitespace-nowrap rounded-control px-3 text-xs font-semibold transition-all duration-micro ${
            value === p.key ? "bg-surface-1 text-brand-600 shadow-raised dark:text-brand-300" : "text-secondary hover:text-primary"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

/**
 * ‹ · anchor month · › as ONE joined unit, so the three never wrap apart from
 * each other. The month input is the ANCHOR at every zoom.
 */
export function DateStepper({ month, period, atCurrent, onShift, onPick }: {
  month: string; period: PeriodKind; atCurrent: boolean; onShift: (delta: number) => void; onPick: (v: string) => void;
}) {
  const meta = periodMeta(period);
  const unit = meta.label.toLowerCase();
  return (
    <div className="inline-flex h-9 items-stretch overflow-hidden rounded-control border border-subtle bg-surface-1">
      <button
        type="button"
        onClick={() => onShift(-meta.months)}
        aria-label={`Previous ${unit}`}
        title={`Previous ${unit}`}
        className="flex w-8 items-center justify-center border-r border-subtle text-secondary transition-colors duration-micro hover:bg-surface-2 hover:text-primary"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
      {period === "fy" ? (
        <FySelect month={month} onPick={onPick} className="w-[12.5rem]" />
      ) : (
        <input
          type="month"
          className="w-[9.5rem] bg-transparent px-2.5 text-sm font-semibold text-primary outline-none [color-scheme:light] dark:[color-scheme:dark]"
          value={month}
          max={thisMonthKey()}
          onChange={(e) => { if (e.target.value) onPick(e.target.value); }}
          aria-label={period === "month" ? "Month" : "Anchor month"}
          title={period === "month" ? "Month" : `Any month inside the ${unit} you want to see`}
        />
      )}
      <button
        type="button"
        onClick={() => onShift(meta.months)}
        disabled={atCurrent}
        aria-label={`Next ${unit}`}
        title={atCurrent ? `Already at the current ${unit}` : `Next ${unit}`}
        className="flex w-8 items-center justify-center border-l border-subtle text-secondary transition-colors duration-micro hover:bg-surface-2 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

/* ---------- layout atoms ---------- */

/** A bordered card with a header strip; `h-full` flex so side-by-side panels align. */
export function Panel({ title, hint, action, children, className = "" }: {
  title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`flex h-full flex-col overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-subtle px-5 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-primary">{title}</h3>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
        {action}
      </header>
      <div className="flex-1 p-5">{children}</div>
    </section>
  );
}

export type TileTone = "brand" | "success" | "warning" | "danger" | "neutral";

const TILE_BAR: Record<TileTone, string> = {
  brand: "from-brand-500 to-brand-700",
  success: "from-emerald-500 to-emerald-700",
  warning: "from-amber-500 to-amber-600",
  danger: "from-rose-500 to-rose-700",
  neutral: "from-slate-400 to-slate-500",
};

/**
 * KPI tile with a gradient accent bar. With `to` it is a link to the list
 * that produced the number; without, a plain card (a derived figure such as
 * a margin percentage has no list to open).
 */
export function Tile({ label, value, sub, to, tone = "brand", foot }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; to?: string; tone?: TileTone;
  /** Optional bottom row (delta chips); `sub` stays directly under the number. */
  foot?: React.ReactNode;
}) {
  const body = (
    <>
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${TILE_BAR[tone]}`} aria-hidden />
      <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className="text-display mt-1.5 text-[1.75rem] font-bold leading-none tabular-nums text-primary">{value}</div>
      {sub && <div className="mt-2 text-xs leading-snug text-secondary">{sub}</div>}
      {foot && <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2">{foot}</div>}
    </>
  );
  const cls = "fx-lift relative flex min-h-[6.5rem] flex-col overflow-hidden rounded-card border border-subtle bg-surface-1 p-4 shadow-raised";
  if (!to) return <div className={cls}>{body}</div>;
  return (
    <CrmLink to={to} className={`${cls} group transition-shadow duration-micro hover:shadow-overlay`}>
      {body}
    </CrmLink>
  );
}

/** Small labelled figure on a recessed card — the grid beside a gauge. */
export function MiniStat({ k, v, tone, hint }: { k: string; v: React.ReactNode; tone?: StateTone; hint?: string }) {
  return (
    <div className="rounded-control border border-subtle bg-surface-2 px-3 py-2" title={hint}>
      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">{k}</div>
      <div className={`mt-0.5 text-base font-bold tabular-nums ${tone ? STATE_TEXT[tone] : "text-primary"}`}>{v}</div>
    </div>
  );
}

/* ---------- the gauge ---------- */

/**
 * A half-dial. The coloured sweep is `value` against `max`; `marker` draws a
 * tick on the arc (the target / required pace); `needle` (defaults to `value`)
 * is the pointer. Pure SVG — no chart library, so it renders identically in
 * both themes and every accent. `format` prints the big figure under the dial.
 */
export function ArcGauge({ value, max, marker, needle, state, label, caption, format, ariaLabel }: {
  value: number; max: number; marker?: number | null; needle?: number; state: StateTone;
  label: string; caption: string; format: (v: number) => string; ariaLabel?: string;
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const strokeOf = useStateStroke();
  const stroke = strokeOf(state);
  const track = dark ? neutral[700] : neutral[200];
  const ink = dark ? neutral[100] : neutral[800];
  const dim = dark ? neutral[400] : neutral[500];

  const scaleMax = Math.max(max, 1e-9);
  const clamp = (v: number) => Math.min(Math.max(v, 0), scaleMax);
  const sweep = clamp(value);
  const pointer = clamp(needle ?? value);

  const cx = 110, cy = 100, r = 84, width = 14;
  const angleOf = (v: number) => Math.PI - (v / scaleMax) * Math.PI;   // π → 0 (left → right)
  const point = (v: number, radius: number) => ({ x: cx + radius * Math.cos(angleOf(v)), y: cy - radius * Math.sin(angleOf(v)) });
  const arc = (from: number, to: number, radius: number) => {
    const a = point(from, radius), b = point(to, radius);
    return `M ${a.x} ${a.y} A ${radius} ${radius} 0 0 1 ${b.x} ${b.y}`;
  };
  const tip = point(pointer, r - width / 2 - 6);
  const tickA = marker !== null && marker !== undefined ? point(clamp(marker), r + 4) : null;
  const tickB = marker !== null && marker !== undefined ? point(clamp(marker), r - width - 4) : null;

  return (
    <figure className="m-0 flex flex-col items-center" aria-label={ariaLabel ?? `${label}: ${format(value)} of ${format(max)}`}>
      <svg viewBox="0 0 220 118" className="w-full max-w-[240px]" role="img" aria-hidden>
        <path d={arc(0, scaleMax, r)} fill="none" stroke={track} strokeWidth={width} strokeLinecap="round" />
        {sweep > 0 && <path d={arc(0, sweep, r)} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" />}
        {tickA && tickB && (
          <line x1={tickA.x} y1={tickA.y} x2={tickB.x} y2={tickB.y} stroke={dark ? neutral[100] : neutral[900]} strokeWidth={3} strokeLinecap="round" />
        )}
        <line x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke={ink} strokeWidth={3.5} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={6} fill={ink} />
        <text x={cx - r - 2} y={cy + 14} fontSize={10} fill={dim} textAnchor="start">0</text>
        <text x={cx + r + 2} y={cy + 14} fontSize={10} fill={dim} textAnchor="end">{format(scaleMax)}</text>
      </svg>
      <figcaption className="-mt-2 text-center">
        <div className={`text-display text-3xl font-bold tabular-nums leading-none ${STATE_TEXT[state]}`}>{format(needle ?? value)}</div>
        <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{caption}</div>
      </figcaption>
    </figure>
  );
}

/* ---------- the speedometer (28 Sep 2026) ---------- */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Colour at `t` ∈ 0..1 along a list of hex stops. */
export function gradientAt(stops: string[], t: number): string {
  const n = stops.length - 1;
  const x = Math.min(Math.max(t, 0), 1) * n;
  const i = Math.min(Math.floor(x), n - 1);
  const f = x - i;
  const a = hexToRgb(stops[i]), b = hexToRgb(stops[i + 1]);
  const mix = (k: number) => Math.round(a[k] + (b[k] - a[k]) * f);
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
}

/**
 * A coloured speedometer — the CEO asked for the pace dials to be "colorful".
 *
 * The dial is banded from danger through warning to success (the `stops`),
 * so WHERE the needle points already reads as good or bad; the bands past
 * the value are dimmed so the filled part is the sweep. `marker` is the
 * target flag; `state` colours the big figure (the server's verdict, which
 * knows things the arc position does not — e.g. a closed period). Pure SVG.
 * `invert` runs the bands the other way for a number that should be LOW
 * (attrition, DSO).
 */
export function Speedometer({ value, max, marker, needle, state, label, caption, format, ariaLabel, invert = false, markerLabel }: {
  value: number; max: number; marker?: number | null; needle?: number; state: StateTone;
  label: string; caption: string; format: (v: number) => string; ariaLabel?: string;
  invert?: boolean; markerLabel?: string;
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const tone = dark ? semanticDark : semantic;
  const stops = invert ? [tone.success, tone.warning, tone.danger] : [tone.danger, tone.warning, tone.success];
  const ink = dark ? neutral[100] : neutral[800];
  const dim = dark ? neutral[400] : neutral[500];
  const hubRing = dark ? neutral[900] : "#ffffff";

  const scaleMax = Math.max(max, 1e-9);
  const clamp = (v: number) => Math.min(Math.max(v, 0), scaleMax);
  const sweep = clamp(value);
  const pointer = clamp(needle ?? value);
  const cx = 120, cy = 112, r = 92, width = 18;
  const angleOf = (v: number) => Math.PI - (v / scaleMax) * Math.PI;   // π → 0 (left → right)
  const point = (v: number, radius: number) => ({ x: cx + radius * Math.cos(angleOf(v)), y: cy - radius * Math.sin(angleOf(v)) });
  const arc = (from: number, to: number, radius: number) => {
    const a = point(from, radius), b = point(to, radius);
    return `M ${a.x} ${a.y} A ${radius} ${radius} 0 0 1 ${b.x} ${b.y}`;
  };

  const SEGMENTS = 36;
  const gap = scaleMax / SEGMENTS * 0.12;
  const bands = Array.from({ length: SEGMENTS }, (_, i) => {
    const from = (scaleMax / SEGMENTS) * i;
    const to = from + scaleMax / SEGMENTS - gap;
    const mid = (from + to) / 2;
    return { d: arc(from, to, r), color: gradientAt(stops, mid / scaleMax), lit: from < sweep, key: i };
  });
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const v = (scaleMax / 10) * i;
    const major = i % 5 === 0;
    return { a: point(v, r - width / 2 - 4), b: point(v, r - width / 2 - (major ? 12 : 8)), major, key: i };
  });
  const tip = point(pointer, r - width / 2 - 14);
  const tail = point(pointer, -14);
  const flag = marker !== null && marker !== undefined ? clamp(marker) : null;
  const flagOut = flag !== null ? point(flag, r + 14) : null;
  const flagIn = flag !== null ? point(flag, r + 3) : null;
  const gid = `spd-${label.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;

  return (
    <figure className="m-0 flex flex-col items-center" aria-label={ariaLabel ?? `${label}: ${format(value)} of ${format(max)}`}>
      <svg viewBox="0 0 240 136" className="w-full max-w-[260px]" role="img" aria-hidden>
        <defs>
          <filter id={`${gid}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#000" floodOpacity={dark ? 0.6 : 0.25} />
          </filter>
          <filter id={`${gid}-glow`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {bands.map((b) => (
          <path key={b.key} d={b.d} fill="none" stroke={b.color} strokeWidth={width} strokeLinecap="butt"
                opacity={b.lit ? 1 : dark ? 0.22 : 0.18} filter={b.lit ? `url(#${gid}-glow)` : undefined} />
        ))}
        {ticks.map((t) => (
          <line key={t.key} x1={t.a.x} y1={t.a.y} x2={t.b.x} y2={t.b.y} stroke={dim} strokeWidth={t.major ? 2 : 1} strokeLinecap="round" />
        ))}
        {flagOut && flagIn && (
          <g>
            <line x1={flagIn.x} y1={flagIn.y} x2={flagOut.x} y2={flagOut.y} stroke={ink} strokeWidth={3} strokeLinecap="round" />
            <circle cx={flagOut.x} cy={flagOut.y} r={3.5} fill={ink} />
          </g>
        )}
        <g filter={`url(#${gid}-shadow)`}>
          <line x1={tail.x} y1={tail.y} x2={tip.x} y2={tip.y} stroke={ink} strokeWidth={4} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={9} fill={ink} />
          <circle cx={cx} cy={cy} r={3.5} fill={hubRing} />
        </g>
        <text x={cx - r - 4} y={cy + 16} fontSize={10} fill={dim} textAnchor="start">0</text>
        <text x={cx + r + 4} y={cy + 16} fontSize={10} fill={dim} textAnchor="end">{format(scaleMax)}</text>
        {flag !== null && markerLabel && (
          <text x={cx} y={cy + 16} fontSize={10} fill={dim} textAnchor="middle">{markerLabel} {format(flag)}</text>
        )}
      </svg>
      <figcaption className="-mt-1 text-center">
        <div className={`text-display text-3xl font-bold tabular-nums leading-none ${STATE_TEXT[state]}`}>{format(needle ?? value)}</div>
        <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{caption}</div>
      </figcaption>
    </figure>
  );
}

/* ---------- filterable bar chart (28 Sep 2026) ---------- */

export type BarSeries = {
  key: string; label: string;
  /** Index into the chart palette (theme-aware) or an explicit CSS colour. */
  color?: number | string;
  /** Series sharing a `stackId` stack; the rest sit side by side. */
  stackId?: string;
  /** Unticked on first render (a secondary figure the reader can switch on). */
  defaultOff?: boolean;
};

/**
 * ONE bar chart, ticks beside it (the CEO asked for "bar graphs with filters":
 * tick a series or a row and the chart redraws with only what is ticked).
 * `data` rows carry `xKey` (the category label) and one number per series.
 * Row ticks appear when `rowFilter` is set — every distinct `xKey` becomes a
 * checkbox (with All / None), so a 12-month chart can show Q2 alone or a
 * customer chart can hide the elephant. `layout="vertical"` puts categories on
 * the Y axis (long names). Nothing is computed here: the payload is the truth.
 */
/** Category labels longer than this get angled x-axis ticks. */
const LONG_LABEL = 11;

export function FilteredBars({ data, series, xKey = "label", format, height = 260, layout = "horizontal",
                               rowFilter = false, rowLabel = "Show", stacked = false, className = "" }: {
  data: Record<string, unknown>[]; series: BarSeries[]; xKey?: string; format?: (v: number) => string;
  height?: number; layout?: "horizontal" | "vertical"; rowFilter?: boolean; rowLabel?: string;
  stacked?: boolean; className?: string;
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const palette = dark ? chartPaletteDark : chartPalette;
  const axis = dark ? neutral[400] : neutral[500];
  const fmt = format ?? ((v: number) => v.toLocaleString("en-IN"));
  const [on, setOn] = useState<Set<string>>(() => new Set(series.filter((s) => !s.defaultOff).map((s) => s.key)));
  const rowKeys = useMemo(() => data.map((r) => String(r[xKey])), [data, xKey]);
  const [rows, setRows] = useState<Set<string> | null>(null);   // null = every row
  const shownRows = useMemo(() => rows ?? new Set(rowKeys), [rows, rowKeys]);
  const visible = useMemo(() => data.filter((r) => shownRows.has(String(r[xKey]))), [data, shownRows, xKey]);
  const active = series.filter((s) => on.has(s.key));
  const colorOf = (s: BarSeries, i: number) =>
    typeof s.color === "string" ? s.color : palette[(typeof s.color === "number" ? s.color : i) % palette.length];
  const toggleSeries = (k: string) => setOn((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleRow = (k: string) => setRows((prev) => { const n = new Set(prev ?? rowKeys); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const vertical = layout === "vertical";
  // Long category names ("Pending Engineering Review") collide on the x-axis;
  // past LONG_LABEL characters the ticks are angled and the chart grows to fit.
  const angled = !vertical && visible.some((r) => String(r[xKey]).length > LONG_LABEL);
  const chartHeight = vertical ? Math.max(height, 28 * visible.length + 40) : height + (angled ? 40 : 0);

  return (
    <div className={`grid gap-4 ${rowFilter ? "lg:grid-cols-[1fr,11rem]" : ""} ${className}`}>
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Series">
          {series.map((s, i) => {
            const checked = on.has(s.key);
            return (
              <label key={s.key} className={`inline-flex cursor-pointer select-none items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors duration-micro ${checked ? "border-subtle bg-surface-1 text-primary" : "border-transparent bg-surface-2 text-muted"}`}>
                <input type="checkbox" className="h-3.5 w-3.5 accent-current" checked={checked} onChange={() => toggleSeries(s.key)} />
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colorOf(s, i), opacity: checked ? 1 : 0.35 }} aria-hidden />
                {s.label}
              </label>
            );
          })}
        </div>
        <div style={{ height: chartHeight }}>
          {active.length && visible.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={visible} layout={vertical ? "vertical" : "horizontal"} margin={{ top: 8, right: 12, bottom: 4, left: vertical ? 8 : 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={axis} strokeOpacity={0.2} vertical={vertical} horizontal={!vertical} />
                {vertical ? (
                  <>
                    <XAxis type="number" tick={{ fill: axis, fontSize: 11 }} tickFormatter={(v) => fmt(Number(v))} />
                    <YAxis type="category" dataKey={xKey} tick={{ fill: axis, fontSize: 11 }} width={120} interval={0} />
                  </>
                ) : (
                  <>
                    <XAxis dataKey={xKey} tick={{ fill: axis, fontSize: 11 }} interval={0}
                           angle={angled ? -25 : 0} textAnchor={angled ? "end" : "middle"} height={angled ? 64 : 30} />
                    <YAxis tick={{ fill: axis, fontSize: 11 }} tickFormatter={(v) => fmt(Number(v))} width={56} allowDecimals={false} />
                  </>
                )}
                <Tooltip cursor={{ fill: axis, fillOpacity: 0.08 }} contentStyle={tooltipStyle} formatter={(v: number, name: string) => [fmt(Number(v)), name]} />
                {active.map((s) => (
                  <Bar key={s.key} dataKey={s.key} name={s.label} fill={colorOf(s, series.indexOf(s))}
                       stackId={stacked ? (s.stackId ?? "stack") : s.stackId}
                       radius={vertical ? [0, radius.input, radius.input, 0] : [radius.input, radius.input, 0, 0]}
                       barSize={vertical ? 14 : 22} animationDuration={250} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted">Tick a series and at least one row to draw the chart.</div>
          )}
        </div>
      </div>
      {rowFilter && (
        <div className="min-w-0 rounded-control border border-subtle bg-surface-2 p-2" role="group" aria-label={rowLabel}>
          <div className="mb-1 flex items-center justify-between gap-2 px-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">{rowLabel}</span>
            <span className="flex gap-1">
              <button type="button" className="text-[10px] font-semibold text-brand-600 hover:underline dark:text-brand-300" onClick={() => setRows(null)}>All</button>
              <span className="text-[10px] text-muted">·</span>
              <button type="button" className="text-[10px] font-semibold text-brand-600 hover:underline dark:text-brand-300" onClick={() => setRows(new Set())}>None</button>
            </span>
          </div>
          <ul className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
            {rowKeys.map((k) => (
              <li key={k}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-secondary hover:bg-surface-1">
                  <input type="checkbox" className="h-3.5 w-3.5" checked={shownRows.has(k)} onChange={() => toggleRow(k)} />
                  <span className="truncate">{k}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Horizontal step bars — a funnel or a bucket list readable without a legend. */
export function StepBars({ steps, format }: {
  steps: { label: string; value: number; cls: string; hint?: string; extra?: React.ReactNode }[];
  format?: (v: number) => string;
}) {
  const fmt = format ?? ((v: number) => v.toLocaleString("en-IN"));
  const max = Math.max(1e-9, ...steps.map((s) => s.value));
  return (
    <div className="space-y-3">
      {steps.map((s) => (
        <div key={s.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate font-semibold text-secondary">{s.label}</span>
            <span className="shrink-0 font-bold tabular-nums text-primary">{fmt(s.value)}{s.extra}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" title={s.hint}>
            <div className={`h-full rounded-full ${s.cls} transition-all duration-panel`} style={{ width: `${Math.max(0, (s.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
