/**
 * The Finance tab's "How the year unfolded" look for EVERY CEO tab (8 Nov 2026,
 * CEO ask: "same design as the Finance tab on Customer, Sales, People and the
 * Billing Tracker — as attractive as Finance").
 *
 * The same reading order as `MoneyStoryChart`, but the series are given by the
 * caller, so one component draws money (₹), heads and pieces of work alike:
 *   gradient header in the tab's colour (title · Show presets · Columns / Trend ·
 *   the caller's toggles) with four headline figures → series chips in groups,
 *   each with its period figure (hover = spotlight, click = tick / untick) → the
 *   chart (gradient columns; a `line` series is a dashed line over a soft area;
 *   Today line; the chosen bucket highlighted) beside a SPOTLIGHT that follows the
 *   mouse (every ticked figure of that bucket as a bar, an optional ring and extra
 *   lines, an "Open …" button) → a bucket strip (mini bars; click to hide / show).
 *
 * A click anywhere in a column calls `onOpen(row, series, ticked, event)` — the
 * tab opens the drill page / narrows its table exactly as its old bars did.
 * Nothing here computes a business figure: only sums, "last" values and maxima of
 * what the server sent. Colours are literal hex (the header must read the same in
 * both themes; `bg-white` is remapped in dark mode).
 */
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Area, Bar, CartesianGrid, ComposedChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ArrowRight, BarChart3, Eye, LineChart as LineIcon, Sparkles } from "lucide-react";
import { neutral } from "../../../design-system/tokens/tokens";
import { useTheme } from "../../../theme/ThemeProvider";
import { num } from "../../components/controlTower";
import { HeadStat, Ring } from "./MoneyStoryChart";

/* ------------------------------------------------------------------ types */

export type StorySeries = {
  key: string; label: string; color: string;
  /** Chip group key (see `groups`). */
  group?: string;
  hint?: string;
  /** Drawn as a dashed line over a soft area instead of a column (a total, a target). */
  line?: boolean;
  /** How the chip's period figure is made: a flow sums (billed, joiners), a stock
   *  takes the latest bucket (headcount, deployed), `max` the peak. */
  agg?: "sum" | "last" | "max";
};
export type StoryPreset = { key: string; label: string; keys: string[] };
export type StoryStat = { label: string; value: string; sub: string; dot: string; ring?: number | null };
export type StoryRow = { key: string; label: string; future?: boolean } & Record<string, unknown>;
export type StoryTheme = "finance" | "customer" | "sales" | "people" | "billing";

type Theme = { bg: string; glowA: string; glowB: string; label: string; sub: string; ink: string; lead: string; accent: string; btn: string };

/** One gradient per tab — the colours of the tab strip's icon tiles. */
export const STORY_THEMES: Record<StoryTheme, Theme> = {
  finance: { bg: "linear-gradient(120deg, #0b1f4d 0%, #1d3fa8 45%, #6d28d9 80%, #c026d3 100%)", glowA: "#22d3ee", glowB: "#f472b6",
    label: "#c7d2fe", sub: "#e0e7ff", ink: "#1e3a8a", lead: "linear-gradient(135deg, #2563eb, #6366f1)", accent: "#2563eb",
    btn: "linear-gradient(120deg, #1d4ed8, #7c3aed, #c026d3)" },
  customer: { bg: "linear-gradient(120deg, #082f49 0%, #0369a1 42%, #0891b2 74%, #10b981 100%)", glowA: "#67e8f9", glowB: "#6ee7b7",
    label: "#bae6fd", sub: "#e0f2fe", ink: "#075985", lead: "linear-gradient(135deg, #0284c7, #0891b2)", accent: "#0284c7",
    btn: "linear-gradient(120deg, #0369a1, #0891b2, #059669)" },
  sales: { bg: "linear-gradient(120deg, #2e1065 0%, #6d28d9 42%, #a21caf 74%, #db2777 100%)", glowA: "#f0abfc", glowB: "#fda4af",
    label: "#e9d5ff", sub: "#fae8ff", ink: "#6b21a8", lead: "linear-gradient(135deg, #7c3aed, #c026d3)", accent: "#7c3aed",
    btn: "linear-gradient(120deg, #6d28d9, #a21caf, #db2777)" },
  people: { bg: "linear-gradient(120deg, #431407 0%, #9a3412 40%, #ea580c 72%, #f59e0b 100%)", glowA: "#fde68a", glowB: "#fca5a5",
    label: "#fed7aa", sub: "#ffedd5", ink: "#9a3412", lead: "linear-gradient(135deg, #ea580c, #f59e0b)", accent: "#ea580c",
    btn: "linear-gradient(120deg, #c2410c, #ea580c, #d97706)" },
  billing: { bg: "linear-gradient(120deg, #4c0519 0%, #9f1239 40%, #e11d48 72%, #f472b6 100%)", glowA: "#fecdd3", glowB: "#c4b5fd",
    label: "#fecdd3", sub: "#ffe4e6", ink: "#9f1239", lead: "linear-gradient(135deg, #e11d48, #db2777)", accent: "#e11d48",
    btn: "linear-gradient(120deg, #be123c, #e11d48, #db2777)" },
};

/** A palette for series named by the data (customers, locations). Distinct on
 *  light and dark; "Others" is always slate. */
export const STORY_PALETTE = [
  "#2563eb", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1", "#14b8a6", "#a855f7",
];
export const paletteColor = (name: string, i: number) => (/^Others/i.test(name) ? "#94a3b8" : STORY_PALETTE[i % STORY_PALETTE.length]);

/* ------------------------------------------------------------------ PURE helpers */

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The chip figure of each series over the shown buckets (future buckets left out). PURE. */
export function storyTotals(rows: StoryRow[], series: StorySeries[]): Record<string, number> {
  const started = rows.filter((r) => !r.future);
  const out: Record<string, number> = {};
  for (const s of series) {
    const vals = started.map((r) => n(r[s.key]));
    out[s.key] = !vals.length ? 0
      : s.agg === "last" ? vals[vals.length - 1]
      : s.agg === "max" ? Math.max(...vals)
      : vals.reduce((a, v) => a + v, 0);
  }
  return out;
}

/** The preset a set of ticks is exactly, else null (a custom pick). PURE. */
export function storyPresetOf(presets: StoryPreset[], keys: string[]): string | null {
  const want = [...new Set(keys)].sort().join(",");
  return presets.find((p) => [...new Set(p.keys)].sort().join(",") === want)?.key ?? null;
}

function readStore(key: string | undefined): { ticked?: string[]; view?: "columns" | "trend" } | null {
  if (!key) return null;
  try { return JSON.parse(window.sessionStorage.getItem(key) || "null"); } catch { return null; }
}
function writeStore(key: string | undefined, v: unknown) {
  if (!key) return;
  try { window.sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
}

/* ------------------------------------------------------------------ component */

export function StoryChart({
  rows, series, groups, presets, defaultPreset, title, hint, theme = "finance", stats, format = (v) => num(v),
  onOpen, openLabel, headerExtra, footer, storageKey, todayKey, highlightKey = null, rowLabel = "Months",
  stripKeys, ring, spotlightSub, spotlightExtra, leadKey, emptyText = "Nothing to draw for this period.", height = 330,
}: {
  rows: StoryRow[];
  series: StorySeries[];
  /** Chip groups in reading order; a series without `group` sits in one unnamed group. */
  groups?: { key: string; label: string }[];
  presets?: StoryPreset[];
  defaultPreset?: string;
  title: string;
  hint?: string;
  theme?: StoryTheme;
  /** Up to four headline figures in the header. */
  stats?: StoryStat[];
  format?: (v: number) => string;
  onOpen?: (row: StoryRow, series: string | null, ticked: string[], e?: React.MouseEvent | null) => void;
  openLabel?: (row: StoryRow) => string;
  headerExtra?: React.ReactNode;
  footer?: React.ReactNode;
  /** sessionStorage key — ticks + view survive Back from a drill page. */
  storageKey?: string;
  todayKey?: string;
  highlightKey?: string | null;
  /** "Months" · "Quarters" · "Years" — the bucket strip's name. */
  rowLabel?: string;
  /** The two series the bucket strip draws as mini bars (default: the first two). */
  stripKeys?: [string, string?];
  /** The spotlight's ring (e.g. "% collected", "utilisation"). */
  ring?: (row: StoryRow) => { pct: number | null; color: string } | null;
  spotlightSub?: (row: StoryRow) => string;
  spotlightExtra?: (row: StoryRow) => React.ReactNode;
  /** The series the spotlight's big card shows (default: the first ticked). */
  leadKey?: string;
  emptyText?: string;
  height?: number;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { theme: mode } = useTheme();
  const dark = mode === "dark";
  const axis = dark ? neutral[400] : neutral[500];
  const t = STORY_THEMES[theme];
  const allKeys = series.map((s) => s.key);
  const presetList = presets?.length ? presets : [{ key: "all", label: "All", keys: allKeys }];
  const startKeys = (presetList.find((p) => p.key === defaultPreset) ?? presetList[0]).keys;

  const stored = useMemo(() => readStore(storageKey), [storageKey]);
  const [ticked, setTicked] = useState<Set<string>>(() => {
    const keep = stored?.ticked?.filter((k) => allKeys.includes(k));
    return new Set(keep?.length ? keep : startKeys.filter((k) => allKeys.includes(k)));
  });
  const [view, setView] = useState<"columns" | "trend">(stored?.view === "trend" ? "trend" : "columns");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);
  const [spot, setSpot] = useState<string | null>(null);
  const tickedList = useMemo(() => allKeys.filter((k) => ticked.has(k)), [allKeys.join(","), ticked]); // eslint-disable-line react-hooks/exhaustive-deps
  const preset = storyPresetOf(presetList, tickedList);
  useEffect(() => { writeStore(storageKey, { ticked: tickedList, view }); }, [storageKey, tickedList, view]);

  const toggle = (k: string) => setTicked((cur) => { const s = new Set(cur); if (s.has(k)) s.delete(k); else s.add(k); return s; });
  const byKey = useMemo(() => new Map(series.map((s) => [s.key, s])), [series]);
  const visible = rows.filter((r) => !hidden.has(r.key));
  const totals = useMemo(() => storyTotals(visible, series), [visible, series]);
  const today = todayKey ?? "";
  const todayRow = today ? visible.find((r) => r.key === today) : undefined;
  const pinnedRow = highlightKey ? visible.find((r) => r.key === highlightKey) : undefined;
  const leadDefault = leadKey ?? tickedList[0] ?? allKeys[0];
  const defaultRow = pinnedRow
    ?? [...visible].reverse().find((r) => !r.future && allKeys.some((k) => n(r[k]) > 0))
    ?? visible[visible.length - 1];
  const spotRow = visible.find((r) => r.label === hoverLabel) ?? defaultRow;
  const fade = (k: string) => (spot && spot !== k ? 0.18 : 1);
  const columns = tickedList.filter((k) => !byKey.get(k)?.line);
  const lines = tickedList.filter((k) => byKey.get(k)?.line);
  const groupList = groups?.length ? groups : [{ key: "", label: "" }];

  const clicked = useRef<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onChartClick = (st: any, e?: React.MouseEvent) => {
    const k = clicked.current;
    clicked.current = null;
    const row = visible.find((r) => r.label === st?.activeLabel);
    if (row && onOpen) onOpen(row, k, tickedList, e ?? null);
  };
  const [stripA, stripB] = stripKeys ?? [allKeys[0], allKeys[1]];

  return (
    <section className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised" aria-label={title}>
      {/* ---------- header ---------- */}
      <div className="relative overflow-hidden px-5 pb-4 pt-4 text-[#fff]" style={{ background: t.bg }}>
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-30 blur-3xl" style={{ background: t.glowA }} />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full opacity-25 blur-3xl" style={{ background: t.glowB }} />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <Sparkles size={18} aria-hidden className="text-[#fde68a]" /> {title}
            </h3>
            {hint && <p className="mt-0.5 max-w-3xl text-xs" style={{ color: t.sub }}>{hint}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {headerExtra}
            <div className="inline-flex h-8 items-center rounded-full bg-[#ffffff26] p-0.5 ring-1 ring-[#ffffff40]" role="group" aria-label="Chart style">
              {([["columns", "Columns", BarChart3], ["trend", "Trend", LineIcon]] as const).map(([k, label, Icon]) => (
                <button key={k} type="button" onClick={() => setView(k)} aria-pressed={view === k}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors ${view === k ? "bg-[#fff] shadow" : "text-[#fff] hover:bg-[#ffffff22]"}`}
                  style={view === k ? { color: t.ink } : undefined}>
                  <Icon size={13} aria-hidden /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {presetList.length > 1 && (
          <div className="relative mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Show">
            <span className="mr-1 text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: t.label }}>Show</span>
            {presetList.map((p) => (
              <button key={p.key} type="button" onClick={() => setTicked(new Set(p.keys.filter((k) => allKeys.includes(k))))} aria-pressed={preset === p.key}
                className={`h-7 rounded-full px-3 text-xs font-semibold ring-1 transition-all ${preset === p.key ? "bg-[#fff] ring-[#fff] shadow" : "bg-[#ffffff1a] text-[#fff] ring-[#ffffff40] hover:bg-[#ffffff33]"}`}
                style={preset === p.key ? { color: t.ink } : undefined}>
                {p.label}
              </button>
            ))}
            {!preset && <span className="rounded-full bg-[#fde68a] px-2.5 py-1 text-[11px] font-bold text-[#713f12]">Your pick</span>}
          </div>
        )}

        {stats && stats.length > 0 && (
          <div className="relative mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {stats.slice(0, 4).map((s) => (
              <HeadStat key={s.label} label={s.label} value={s.value} sub={s.sub} dot={s.dot} ring={s.ring ?? null} labelColor={t.label} subColor={t.sub} />
            ))}
          </div>
        )}
      </div>

      {/* ---------- series chips ---------- */}
      <div className="border-b border-subtle px-5 py-3">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {groupList.map((g) => {
            const inGroup = series.filter((s) => (groups?.length ? s.group === g.key : true));
            if (!inGroup.length) return null;
            return (
              <div key={g.key || "all"} className="flex flex-wrap items-center gap-1.5">
                {g.label && <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">{g.label}</span>}
                {inGroup.map((s) => {
                  const on = ticked.has(s.key);
                  return (
                    <button key={s.key} type="button" onClick={() => toggle(s.key)} aria-pressed={on}
                      onMouseEnter={() => on && setSpot(s.key)} onMouseLeave={() => setSpot(null)}
                      onFocus={() => on && setSpot(s.key)} onBlur={() => setSpot(null)}
                      title={`${s.label}${s.hint ? ` — ${s.hint}` : ""}. Click to ${on ? "hide" : "show"}.`}
                      className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold transition-all duration-micro"
                      style={on
                        ? { borderColor: s.color, background: `${s.color}1f`, color: dark ? "#fff" : "#0f172a", boxShadow: `0 1px 0 ${s.color}33` }
                        : { borderColor: "var(--border-subtle)", background: "transparent", color: "var(--text-muted)" }}>
                      <span aria-hidden className={`inline-block h-3 w-3 ring-2 ring-[#ffffff] ${s.line ? "rounded-sm" : "rounded-full"}`}
                        style={{ background: on ? `linear-gradient(135deg, ${s.color}, ${s.color}99)` : "transparent", boxShadow: `0 0 0 1.5px ${s.color}` }} />
                      <span>{s.label}</span>
                      <span className="tnum font-bold" style={{ color: on ? s.color : undefined }}>{format(totals[s.key] ?? 0)}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* ---------- chart + spotlight ---------- */}
      <div className="grid gap-4 p-4 xl:grid-cols-[1fr,19rem]">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5"><Eye size={12} aria-hidden /> Hover a {rowLabel.toLowerCase().replace(/s$/, "")} to see every figure · hover a chip to spotlight it</span>
            {onOpen && <span>Click a column to open what is behind it · Ctrl-click opens a new tab</span>}
          </div>
          <div className={onOpen ? "[&_.recharts-wrapper]:cursor-pointer" : ""} style={{ height }}>
            {tickedList.length && visible.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={visible} margin={{ top: 18, right: 24, bottom: 0, left: 0 }} barGap={3} barCategoryGap="16%"
                  onMouseMove={(st: { activeLabel?: string } | null) => setHoverLabel(st?.activeLabel ?? null)}
                  onMouseLeave={() => setHoverLabel(null)}
                  onClick={onOpen ? onChartClick : undefined}>
                  <defs>
                    {series.map((s) => (
                      <linearGradient key={s.key} id={`s${uid}${s.key.replace(/[^a-zA-Z0-9]/g, "_")}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={s.color} stopOpacity={view === "trend" || s.line ? 0.3 : 1} />
                        <stop offset="100%" stopColor={s.color} stopOpacity={view === "trend" || s.line ? 0.02 : 0.55} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="4 6" stroke={axis} strokeOpacity={0.22} />
                  {pinnedRow && (
                    <ReferenceArea x1={pinnedRow.label} x2={pinnedRow.label} fill={t.accent} fillOpacity={dark ? 0.16 : 0.09} stroke={t.accent} strokeOpacity={0.5} />
                  )}
                  <XAxis dataKey="label" interval={0} axisLine={false} tickLine={false} height={34}
                    tick={(p: { x: number; y: number; payload: { value: string } }) => (
                      <BucketTick {...p} pinned={p.payload.value === pinnedRow?.label} hovered={p.payload.value === spotRow?.label}
                        accent={t.accent} axis={axis} />
                    )} />
                  <YAxis tickFormatter={(v) => format(Number(v))} axisLine={false} tickLine={false} width={64} allowDecimals={false}
                    tick={{ fill: axis, fontSize: 11 }} />
                  <Tooltip cursor={{ fill: t.accent, fillOpacity: dark ? 0.12 : 0.07, radius: 10 }}
                    content={(p: { active?: boolean; label?: string }) => (
                      <StoryTooltip active={p.active} row={visible.find((r) => r.label === p.label)} keys={tickedList} byKey={byKey}
                        format={format} canOpen={!!onOpen} accent={t.accent} />
                    )} />
                  {(view === "columns" ? columns : []).map((k) => {
                    const s = byKey.get(k)!;
                    return (
                      <Bar key={k} dataKey={k} name={s.label} fill={`url(#s${uid}${k.replace(/[^a-zA-Z0-9]/g, "_")})`}
                        radius={[7, 7, 2, 2]} maxBarSize={26} fillOpacity={fade(k)} animationDuration={600}
                        onClick={() => { clicked.current = k; }} />
                    );
                  })}
                  {(view === "trend" ? columns : []).map((k) => {
                    const s = byKey.get(k)!;
                    return (
                      <Area key={k} dataKey={k} type="monotone" name={s.label} stroke={s.color} strokeWidth={2.5} strokeOpacity={fade(k)}
                        fill={`url(#s${uid}${k.replace(/[^a-zA-Z0-9]/g, "_")})`} fillOpacity={fade(k)} animationDuration={700}
                        dot={{ r: 3, strokeWidth: 2, fill: "var(--surface-1)" }} activeDot={{ r: 6, strokeWidth: 0 }} />
                    );
                  })}
                  {lines.map((k) => {
                    const s = byKey.get(k)!;
                    return (
                      <Area key={k} dataKey={k} type="monotone" name={s.label} stroke={s.color} strokeWidth={3} strokeDasharray="7 5"
                        strokeOpacity={fade(k)} fill={`url(#s${uid}${k.replace(/[^a-zA-Z0-9]/g, "_")})`} animationDuration={800}
                        dot={{ r: 4, fill: s.color, stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 7, fill: s.color, stroke: "#fff", strokeWidth: 2 }} />
                    );
                  })}
                  {todayRow && (
                    <ReferenceLine x={todayRow.label} stroke="#0ea5e9" strokeWidth={1.5} strokeDasharray="3 3"
                      label={{ value: "Today", position: "top", fill: "#0ea5e9", fontSize: 11, fontWeight: 700 }} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted">
                <BarChart3 size={28} aria-hidden className="opacity-40" />
                {rows.length ? `Tick a series above and at least one ${rowLabel.toLowerCase().replace(/s$/, "")} below to draw the chart.` : emptyText}
              </div>
            )}
          </div>

          {rows.length > 0 && (
            <BucketStrip rows={rows} hidden={hidden} rowLabel={rowLabel} a={byKey.get(stripA)} b={stripB ? byKey.get(stripB) : undefined}
              format={format} pinned={pinnedRow?.key ?? null} hover={spotRow?.key ?? null} accent={t.accent}
              onToggle={(k) => setHidden((cur) => { const s = new Set(cur); if (s.has(k)) s.delete(k); else s.add(k); return s; })}
              onAll={() => setHidden(new Set())} onNone={() => setHidden(new Set(rows.map((r) => r.key)))} />
          )}
        </div>

        {spotRow ? (
          <StorySpotlight row={spotRow} live={!!hoverLabel} pinned={!hoverLabel && spotRow.key === pinnedRow?.key}
            keys={tickedList.length ? tickedList : allKeys} byKey={byKey} format={format} theme={t}
            leadKey={tickedList.includes(leadDefault) ? leadDefault : tickedList[0] ?? leadDefault}
            ring={ring?.(spotRow) ?? null} sub={spotlightSub?.(spotRow)} extra={spotlightExtra?.(spotRow)}
            openLabel={onOpen ? (openLabel ? openLabel(spotRow) : `Open ${spotRow.label}`) : null}
            onOpen={onOpen ? (e) => onOpen(spotRow, null, tickedList, e) : undefined} />
        ) : <div className="rounded-card border border-dashed border-subtle p-6 text-center text-sm text-muted">{emptyText}</div>}
      </div>
      {footer && <div className="px-5 pb-4">{footer}</div>}
    </section>
  );
}

/* ------------------------------------------------------------------ pieces */

function BucketTick({ x, y, payload, pinned, hovered, accent, axis }: {
  x: number; y: number; payload: { value: string }; pinned: boolean; hovered: boolean; accent: string; axis: string;
}) {
  const w = Math.max(46, String(payload.value).length * 6.6 + 14);
  return (
    <g transform={`translate(${x},${y + 4})`}>
      <rect x={-w / 2} y={0} width={w} height={20} rx={10} fill={pinned || hovered ? accent : "transparent"} opacity={pinned ? 1 : hovered ? 0.15 : 0} />
      <text x={0} y={14} textAnchor="middle" fontSize={11} fontWeight={pinned || hovered ? 700 : 500}
        fill={pinned ? "#fff" : hovered ? accent : axis}>
        {payload.value}
      </text>
    </g>
  );
}

function StoryTooltip({ active, row, keys, byKey, format, canOpen, accent }: {
  active?: boolean; row?: StoryRow; keys: string[]; byKey: Map<string, StorySeries>; format: (v: number) => string; canOpen: boolean; accent: string;
}) {
  if (!active || !row) return null;
  return (
    <div className="min-w-[12rem] rounded-xl border border-subtle bg-surface-3 px-3 py-2 text-xs shadow-overlay">
      <div className="mb-1 font-bold text-primary">{row.label}</div>
      <ul className="space-y-0.5">
        {keys.map((k) => {
          const s = byKey.get(k);
          if (!s) return null;
          return (
            <li key={k} className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-secondary">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}
              </span>
              <span className="tnum font-semibold text-primary">{format(n(row[k]))}</span>
            </li>
          );
        })}
      </ul>
      {canOpen && <div className="mt-1.5 border-t border-subtle pt-1 text-[10px] font-semibold" style={{ color: accent }}>Click to open what is behind it →</div>}
    </div>
  );
}

function StorySpotlight({ row, live, pinned, keys, byKey, format, theme, leadKey, ring, sub, extra, openLabel, onOpen }: {
  row: StoryRow; live: boolean; pinned: boolean; keys: string[]; byKey: Map<string, StorySeries>; format: (v: number) => string;
  theme: Theme; leadKey: string; ring: { pct: number | null; color: string } | null; sub?: string; extra?: React.ReactNode;
  openLabel: string | null; onOpen?: (e: React.MouseEvent) => void;
}) {
  const lead = byKey.get(leadKey);
  const rest = keys.filter((k) => k !== leadKey);
  const max = Math.max(1e-9, ...rest.map((k) => n(row[k])));
  return (
    <aside className="flex flex-col rounded-card border border-subtle bg-surface-2 p-4" aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">{live ? "Spotlight" : pinned ? "Chosen" : "Latest"}</div>
          <div className="truncate text-xl font-bold text-primary">{row.label}</div>
          {sub && <div className="text-[11px] text-muted">{sub}</div>}
        </div>
        {ring && <Ring pct={ring.pct} color={ring.color} size={62} />}
      </div>

      {lead && (
        <div className="mt-3 rounded-xl p-3 text-[#fff]" style={{ background: theme.lead }}>
          <div className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: theme.sub }}>{lead.label}</div>
          <div className="tnum text-2xl font-bold">{format(n(row[lead.key]))}</div>
        </div>
      )}

      {rest.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rest.map((k) => {
            const s = byKey.get(k);
            if (!s) return null;
            const v = n(row[k]);
            return (
              <li key={k}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-secondary">
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                    <span className="truncate">{s.label}</span>
                  </span>
                  <span className="tnum font-bold text-primary">{format(v)}</span>
                </div>
                <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-surface-1 ring-1 ring-inset ring-subtle">
                  <div className="h-full rounded-full transition-all duration-panel" style={{ width: `${Math.max(0, Math.min(100, (v / max) * 100))}%`, background: s.color }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {extra && <div className="mt-3 space-y-2">{extra}</div>}

      {openLabel && onOpen && (
        <button type="button" onClick={(e) => onOpen(e)}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-control px-3 py-2.5 text-sm font-bold text-[#fff] shadow-raised transition-transform hover:-translate-y-px"
          style={{ background: theme.btn }}>
          {openLabel} <ArrowRight size={15} aria-hidden />
        </button>
      )}
    </aside>
  );
}

/** A labelled line inside the spotlight (people cost that month, internal share …). */
export function SpotLine({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "ok" | "warn" | "bad" }) {
  const cls = tone === "bad" ? "text-danger" : tone === "warn" ? "text-warning" : tone === "ok" ? "text-success" : "text-primary";
  return (
    <div className="flex items-center justify-between rounded-control bg-surface-1 px-3 py-2 ring-1 ring-inset ring-subtle">
      <span className="text-xs font-semibold text-secondary">{label}</span>
      <span className={`tnum text-sm font-bold ${cls}`}>{value}</span>
    </div>
  );
}

function BucketStrip({ rows, hidden, rowLabel, a, b, format, pinned, hover, accent, onToggle, onAll, onNone }: {
  rows: StoryRow[]; hidden: Set<string>; rowLabel: string; a?: StorySeries; b?: StorySeries; format: (v: number) => string;
  pinned: string | null; hover: string | null; accent: string;
  onToggle: (k: string) => void; onAll: () => void; onNone: () => void;
}) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.max(a ? n(r[a.key]) : 0, b ? n(r[b.key]) : 0)));
  return (
    <div className="mt-2 rounded-control border border-subtle bg-surface-2 p-2" role="group" aria-label={rowLabel}>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 px-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">{rowLabel} · click to hide or show</span>
        <span className="flex gap-2 text-[11px] font-semibold">
          <button type="button" className="hover:underline" style={{ color: accent }} onClick={onAll}>All</button>
          <button type="button" className="hover:underline" style={{ color: accent }} onClick={onNone}>None</button>
        </span>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-0.5">
        {rows.map((r) => {
          const on = !hidden.has(r.key);
          const h1 = a ? Math.round((n(r[a.key]) / max) * 22) : 0;
          const h2 = b ? Math.round((n(r[b.key]) / max) * 22) : 0;
          return (
            <button key={r.key} type="button" onClick={() => onToggle(r.key)} aria-pressed={on}
              title={`${r.label}${a ? `: ${a.label} ${format(n(r[a.key]))}` : ""}${b ? ` · ${b.label} ${format(n(r[b.key]))}` : ""} — click to ${on ? "hide" : "show"}`}
              className={`flex min-w-[3.25rem] flex-1 flex-col items-center gap-1 rounded-lg px-1.5 pb-1 pt-1.5 text-[10px] font-semibold ring-1 ring-inset transition-all ${
                on ? "bg-surface-1 text-primary ring-subtle" : "bg-transparent text-muted opacity-50 ring-transparent"}`}
              style={r.key === pinned ? { boxShadow: `inset 0 0 0 2px ${accent}` } : r.key === hover && on ? { boxShadow: `inset 0 0 0 1px ${accent}88` } : undefined}>
              <span className="flex h-6 items-end gap-0.5" aria-hidden>
                {a && <span className="w-2 rounded-sm" style={{ height: Math.max(2, h1), background: `linear-gradient(${a.color},${a.color}88)` }} />}
                {b && <span className="w-2 rounded-sm" style={{ height: Math.max(2, h2), background: `linear-gradient(${b.color},${b.color}66)` }} />}
              </span>
              <span className="whitespace-nowrap">{r.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
