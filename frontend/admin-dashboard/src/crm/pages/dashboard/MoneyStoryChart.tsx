/**
 * "How the year unfolded" v2 (7 Nov 2026, CEO ask: "redesign this as best as —
 * very interactive, colourful; when I click a month I land on the Billed page
 * WITH the ticks I chose here").
 *
 * ONE component, used on the CEO Finance tab AND as the first chart of the Billed
 * drill page, so the two can never look or read differently:
 *   gradient header (title · Show presets · Columns / Trend · extra controls) with
 *   the period's four headline figures → series chips grouped Revenue · Receivable ·
 *   Received · Due · Forecast (each with its period total; hover one to spotlight
 *   it, click to tick / untick) → the chart (gradient columns, Predicted as a
 *   dashed fuchsia line over a soft area, the months still to come shaded
 *   "Forecast", a "Today" line, the chosen month highlighted) beside a MONTH
 *   SPOTLIGHT that follows the mouse (every figure of that month, collection ring,
 *   bank / TDS progress, predicted vs billed) → a month strip (mini bars; click a
 *   month to hide / show it, All · Actuals only · None).
 *
 * Clicking anywhere in a month column calls `onOpen(row, series, ticked, event)`:
 * `series` is the bar clicked (null when the click landed between bars). The
 * dashboard opens the Billed page with `series` / `fmonth` / `bar` in the link;
 * the Billed page narrows its table in place. Nothing is computed beyond sums —
 * the figures come from the server (services/money_split).
 */
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Area, Bar, CartesianGrid, ComposedChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ArrowRight, BarChart3, Eye, LineChart as LineIcon, Sparkles } from "lucide-react";
import { neutral } from "../../../design-system/tokens/tokens";
import { useTheme } from "../../../theme/ThemeProvider";
import { inrCompact, num } from "../../components/controlTower";
import {
  FALLBACK_MONEY_KEYS, MONEY_GROUPS, MONEY_PRESETS, MONEY_SERIES, moneyRows, moneySeriesOf, moneySplitMissing,
  moneyTotals, presetKeys, presetOf, shareOf,
  type MoneyKey, type MoneyPreset, type MoneyRow,
} from "./moneySeries";

export type MoneyChartRow = MoneyRow & {
  key: string; label: string; future?: boolean; invoices?: number; expected_tds?: number;
};
type Full = MoneyChartRow & Record<MoneyKey, number>;
type View = "columns" | "trend";

const PRED = "#d946ef";

function readStore(key: string | undefined): { ticked?: MoneyKey[]; view?: View } | null {
  if (!key) return null;
  try { return JSON.parse(window.sessionStorage.getItem(key) || "null"); } catch { return null; }
}
function writeStore(key: string | undefined, v: unknown) {
  if (!key) return;
  try { window.sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
}

export function MoneyStoryChart({
  rows: rawRows, title, hint, ticked: tickedFromProps, initialPreset = "overview", withPredicted = true,
  highlightMonth = null, onOpen, openLabel, onTickedChange, headerExtra, footer, storageKey, todayKey,
}: {
  rows: MoneyChartRow[];
  title: string;
  hint?: string;
  /** The ticks to start with (a link's `?series=`); else the stored / preset ones. */
  ticked?: MoneyKey[] | null;
  initialPreset?: MoneyPreset;
  withPredicted?: boolean;
  /** The month the page is focused on (drawn as a highlighted band). */
  highlightMonth?: string | null;
  /** A month column was clicked. `series` = the bar clicked (null between bars). */
  onOpen?: (row: MoneyChartRow, series: MoneyKey | null, ticked: MoneyKey[], e?: React.MouseEvent | null) => void;
  /** The spotlight button's words ("Open the invoices of Apr 26"). */
  openLabel?: (row: MoneyChartRow) => string;
  onTickedChange?: (keys: MoneyKey[]) => void;
  headerExtra?: React.ReactNode;
  footer?: React.ReactNode;
  /** sessionStorage key — the ticks and view survive Back from the drill page. */
  storageKey?: string;
  /** "YYYY-MM" of today (the Today line). */
  todayKey?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { theme } = useTheme();
  const dark = theme === "dark";
  const axis = dark ? neutral[400] : neutral[500];
  const rows = useMemo(() => moneyRows(rawRows) as Full[], [rawRows]);
  // 12 Nov 2026 — a backend older than 6 Nov sends no bank / TDS split: show only
  // what it really sent and say why, instead of Inc Tax = Ex. Tax and a row of zeros.
  const splitMissing = useMemo(() => moneySplitMissing(rawRows), [rawRows]);
  const series = useMemo(() => MONEY_SERIES
    .filter((s) => withPredicted || s.key !== "predicted")
    .filter((s) => !splitMissing || FALLBACK_MONEY_KEYS.includes(s.key)), [withPredicted, splitMissing]);

  const stored = useMemo(() => readStore(storageKey), [storageKey]);
  const [ticked, setTicked] = useState<Set<MoneyKey>>(() => new Set(
    tickedFromProps?.length ? tickedFromProps : stored?.ticked?.length ? stored.ticked : presetKeys(initialPreset, withPredicted)));
  const [view, setView] = useState<View>(stored?.view === "trend" ? "trend" : "columns");
  const [hiddenMonths, setHiddenMonths] = useState<Set<string>>(new Set());
  const [hoverMonth, setHoverMonth] = useState<string | null>(null);
  const [spot, setSpot] = useState<MoneyKey | null>(null);       // a chip being hovered
  const tickedList = useMemo(() => series.map((s) => s.key).filter((k) => ticked.has(k)), [series, ticked]);
  const preset = presetOf(tickedList, withPredicted);

  useEffect(() => { writeStore(storageKey, { ticked: tickedList, view }); }, [storageKey, tickedList, view]);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    onTickedChange?.(tickedList);
  }, [tickedList.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (k: MoneyKey) => setTicked((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const pickPreset = (p: MoneyPreset) => setTicked(new Set(presetKeys(p, withPredicted)));

  const visible = rows.filter((r) => !hiddenMonths.has(r.key));
  // A month that has not started has no actual money: null (not 0), so a trend line
  // stops at today instead of diving to zero; only the prediction runs on.
  const chartData = useMemo(() => visible.map((r) => (r.future
    ? { ...r, ...Object.fromEntries(MONEY_SERIES.filter((s) => s.key !== "predicted").map((s) => [s.key, null])) }
    : r)), [visible]);
  const totals = useMemo(() => moneyTotals(visible), [visible]);
  const actual = tickedList.filter((k) => k !== "predicted");
  const showPredicted = withPredicted && ticked.has("predicted");
  const futureRows = visible.filter((r) => r.future);
  const today = todayKey ?? new Date().toISOString().slice(0, 7);
  const todayRow = visible.find((r) => r.key === today);
  const pinnedRow = visible.find((r) => r.key === highlightMonth);

  // The spotlight: the hovered month, else the focused one, else the latest month with money.
  const defaultRow = pinnedRow
    ?? [...visible].reverse().find((r) => !r.future && (r.revenue_ex > 0 || r.total_due > 0))
    ?? visible.find((r) => !r.future) ?? visible[0];
  const spotRow = visible.find((r) => r.label === hoverMonth) ?? defaultRow;

  const clicked = useRef<MoneyKey | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onChartClick = (st: any, e?: React.MouseEvent) => {
    const k = clicked.current;
    clicked.current = null;
    const row = visible.find((r) => r.label === st?.activeLabel);
    if (row && onOpen) onOpen(row, k, tickedList, e ?? null);
  };

  const fade = (k: MoneyKey) => (spot && spot !== k ? 0.18 : 1);
  const received = totals.received_bank + totals.received_tds;
  const collectedPct = splitMissing ? null : shareOf(received, totals.revenue_inc);
  const notSent = "not sent — update the server";

  return (
    <section className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised" aria-label={title}>
      {/* ---------- header ---------- */}
      <div className="relative overflow-hidden px-5 pb-4 pt-4 text-[#fff]"
           style={{ background: "linear-gradient(120deg, #0b1f4d 0%, #1d3fa8 45%, #6d28d9 80%, #c026d3 100%)" }}>
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-30 blur-3xl" style={{ background: "#22d3ee" }} />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full opacity-25 blur-3xl" style={{ background: "#f472b6" }} />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <Sparkles size={18} aria-hidden className="text-[#fde68a]" /> {title}
            </h3>
            {hint && <p className="mt-0.5 max-w-3xl text-xs text-[#e0e7ff]">{hint}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {headerExtra}
            <div className="inline-flex h-8 items-center rounded-full bg-[#ffffff26] p-0.5 ring-1 ring-[#ffffff40]" role="group" aria-label="Chart style">
              {([["columns", "Columns", BarChart3], ["trend", "Trend", LineIcon]] as const).map(([k, label, Icon]) => (
                <button key={k} type="button" onClick={() => setView(k)} aria-pressed={view === k}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors ${view === k ? "bg-[#fff] text-[#1e3a8a] shadow" : "text-[#fff] hover:bg-[#ffffff22]"}`}>
                  <Icon size={13} aria-hidden /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="relative mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Show">
          <span className="mr-1 text-[11px] font-bold uppercase tracking-[0.1em] text-[#c7d2fe]">Show</span>
          {MONEY_PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => pickPreset(p.key)} aria-pressed={preset === p.key}
              className={`h-7 rounded-full px-3 text-xs font-semibold ring-1 transition-all ${preset === p.key ? "bg-[#fff] text-[#4c1d95] ring-[#fff] shadow" : "bg-[#ffffff1a] text-[#fff] ring-[#ffffff40] hover:bg-[#ffffff33]"}`}>
              {p.label}
            </button>
          ))}
          {!preset && <span className="rounded-full bg-[#fde68a] px-2.5 py-1 text-[11px] font-bold text-[#713f12]">Your pick</span>}
        </div>

        <div className="relative mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <HeadStat label="Revenue (Ex. Tax)" value={inrCompact(totals.revenue_ex)}
            sub={splitMissing ? `Inc Tax ${notSent}` : `Inc Tax ${inrCompact(totals.revenue_inc)}`} dot="#93c5fd" />
          <HeadStat label={splitMissing ? "Collected (with GST)" : "Received (Bank + TDS)"} value={inrCompact(received)}
            sub={splitMissing ? `TDS ${notSent}` : collectedPct === null ? "nothing billed yet" : `${collectedPct}% of Inc Tax`}
            dot="#6ee7b7" ring={collectedPct} />
          <HeadStat label="Total Due" value={splitMissing ? "—" : inrCompact(totals.total_due)}
            sub={splitMissing ? notSent : `Bank ${inrCompact(totals.due_bank)} · TDS ${inrCompact(totals.due_tds)}`} dot="#fca5a5" />
          {withPredicted
            ? <HeadStat label="Predicted revenue" value={inrCompact(totals.predicted)}
                sub={futureRows.length ? `incl. ${futureRows.length} month${futureRows.length === 1 ? "" : "s"} ahead` : "deployed team × rate"} dot="#f0abfc" />
            : <HeadStat label="Receivable TDS" value={inrCompact(totals.receivable_tds)} sub={`received ${inrCompact(totals.received_tds)}`} dot="#c4b5fd" />}
        </div>
      </div>

      {splitMissing && (
        <div role="status" className="border-b border-subtle bg-warning-soft px-5 py-2.5 text-xs text-primary">
          <b className="text-warning">The server behind this page has not been updated.</b>{" "}
          It sent billed and collected only, so Revenue (Inc Tax), Receivable, TDS and Due cannot be shown — and
          &ldquo;Received&rdquo; here is cash with GST. Deploy the latest backend (pull, then restart the service) and
          reload: every money word fills in from the invoices.
        </div>
      )}

      {/* ---------- series chips ---------- */}
      <div className="border-b border-subtle px-5 py-3">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {MONEY_GROUPS.filter((g) => series.some((s) => s.group === g.key)).map((g) => (
            <div key={g.key} className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">{g.label}</span>
              {series.filter((s) => s.group === g.key).map((s) => {
                const on = ticked.has(s.key);
                return (
                  <button key={s.key} type="button" onClick={() => toggle(s.key)} aria-pressed={on}
                    onMouseEnter={() => on && setSpot(s.key)} onMouseLeave={() => setSpot(null)}
                    onFocus={() => on && setSpot(s.key)} onBlur={() => setSpot(null)}
                    title={`${s.label} — ${s.hint}. Click to ${on ? "hide" : "show"}.`}
                    className="group inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold transition-all duration-micro"
                    style={on
                      ? { borderColor: s.color, background: `${s.color}1f`, color: dark ? "#fff" : "#0f172a", boxShadow: `0 1px 0 ${s.color}33` }
                      : { borderColor: "var(--border-subtle)", background: "transparent", color: "var(--text-muted)" }}>
                    <span aria-hidden className="inline-block h-3 w-3 rounded-full ring-2 ring-[#ffffff]"
                      style={{ background: on ? `linear-gradient(135deg, ${s.color}, ${s.color}99)` : "transparent", boxShadow: `0 0 0 1.5px ${s.color}` }} />
                    <span>{s.label}</span>
                    <span className="tnum font-bold" style={{ color: on ? s.color : undefined }}>{inrCompact(totals[s.key])}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ---------- chart + spotlight ---------- */}
      <div className="grid gap-4 p-4 xl:grid-cols-[1fr,19rem]">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5"><Eye size={12} aria-hidden /> Hover a month to see every figure · hover a chip to spotlight it</span>
            {onOpen && <span>Click a month to open the invoices behind it · Ctrl-click opens a new tab</span>}
          </div>
          <div className="h-[340px] [&_.recharts-wrapper]:cursor-pointer">
            {tickedList.length && visible.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 18, right: 24, bottom: 0, left: 0 }} barGap={3} barCategoryGap="16%"
                  onMouseMove={(st: { activeLabel?: string } | null) => setHoverMonth(st?.activeLabel ?? null)}
                  onMouseLeave={() => setHoverMonth(null)}
                  onClick={onOpen ? onChartClick : undefined}>
                  <defs>
                    {series.map((s) => (
                      <linearGradient key={s.key} id={`g${uid}${s.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={s.color} stopOpacity={view === "trend" ? 0.32 : 1} />
                        <stop offset="100%" stopColor={s.color} stopOpacity={view === "trend" ? 0.02 : 0.55} />
                      </linearGradient>
                    ))}
                    <linearGradient id={`g${uid}pred-area`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={PRED} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={PRED} stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="4 6" stroke={axis} strokeOpacity={0.22} />
                  {futureRows.length > 0 && (
                    <ReferenceArea x1={futureRows[0].label} x2={futureRows[futureRows.length - 1].label}
                      fill={PRED} fillOpacity={dark ? 0.08 : 0.05} stroke={PRED} strokeOpacity={0.2} strokeDasharray="4 4"
                      label={{ value: "Forecast", position: "insideTopRight", fill: PRED, fontSize: 11, fontWeight: 700 }} />
                  )}
                  {pinnedRow && (
                    <ReferenceArea x1={pinnedRow.label} x2={pinnedRow.label} fill="#2563eb" fillOpacity={dark ? 0.16 : 0.09}
                      stroke="#2563eb" strokeOpacity={0.5} />
                  )}
                  <XAxis dataKey="label" interval={0} axisLine={false} tickLine={false} height={34}
                    tick={(p: { x: number; y: number; payload: { value: string } }) => (
                      <MonthTick {...p} pinned={p.payload.value === pinnedRow?.label} hovered={p.payload.value === spotRow?.label}
                        future={!!visible.find((r) => r.label === p.payload.value)?.future} axis={axis} />
                    )} />
                  <YAxis tickFormatter={(v) => inrCompact(Number(v))} axisLine={false} tickLine={false} width={64}
                    tick={{ fill: axis, fontSize: 11 }} />
                  <Tooltip cursor={{ fill: "#6366f1", fillOpacity: dark ? 0.12 : 0.07, radius: 10 }}
                    content={(p: { active?: boolean; label?: string }) => (
                      <MiniTooltip active={p.active} row={visible.find((r) => r.label === p.label)} keys={tickedList} canOpen={!!onOpen} />
                    )} />
                  {view === "columns"
                    ? actual.map((k) => (
                        <Bar key={k} dataKey={k} name={moneySeriesOf(k)?.label} fill={`url(#g${uid}${k})`}
                          radius={[7, 7, 2, 2]} maxBarSize={26} fillOpacity={fade(k)} animationDuration={600}
                          onClick={() => { clicked.current = k; }} />
                      ))
                    : actual.map((k) => (
                        <Area key={k} dataKey={k} type="monotone" name={moneySeriesOf(k)?.label}
                          stroke={moneySeriesOf(k)?.color} strokeWidth={2.5} strokeOpacity={fade(k)}
                          fill={`url(#g${uid}${k})`} fillOpacity={fade(k)} animationDuration={700}
                          dot={{ r: 3, strokeWidth: 2, fill: "var(--surface-1)" }} activeDot={{ r: 6, strokeWidth: 0 }} />
                      ))}
                  {showPredicted && (
                    <Area dataKey="predicted" type="monotone" name="Predicted revenue" stroke={PRED} strokeWidth={3}
                      strokeDasharray="7 5" strokeOpacity={fade("predicted")} fill={`url(#g${uid}pred-area)`} animationDuration={800}
                      dot={{ r: 4, fill: PRED, stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 7, fill: PRED, stroke: "#fff", strokeWidth: 2 }} />
                  )}
                  {todayRow && (
                    <ReferenceLine x={todayRow.label} stroke="#0ea5e9" strokeWidth={1.5} strokeDasharray="3 3"
                      label={{ value: "Today", position: "top", fill: "#0ea5e9", fontSize: 11, fontWeight: 700 }} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted">
                <BarChart3 size={28} aria-hidden className="opacity-40" />
                Tick a series above and at least one month below to draw the chart.
              </div>
            )}
          </div>

          {/* month strip — click a month to hide / show it */}
          <MonthStrip rows={rows} hidden={hiddenMonths} onToggle={(k) => setHiddenMonths((cur) => {
            const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
            onAll={() => setHiddenMonths(new Set())}
            onActuals={() => setHiddenMonths(new Set(rows.filter((r) => r.future).map((r) => r.key)))}
            onNone={() => setHiddenMonths(new Set(rows.map((r) => r.key)))}
            pinned={pinnedRow?.key ?? null} hover={spotRow?.key ?? null} />
        </div>

        {spotRow
          ? <Spotlight row={spotRow} live={!!hoverMonth} pinned={!hoverMonth && spotRow.key === pinnedRow?.key} withPredicted={withPredicted}
              openLabel={onOpen ? (openLabel ? openLabel(spotRow) : `Open the invoices of ${spotRow.label}`) : null}
              onOpen={onOpen ? (e) => onOpen(spotRow, null, tickedList, e) : undefined} />
          : <div className="rounded-card border border-dashed border-subtle p-6 text-center text-sm text-muted">No month to show.</div>}
      </div>
      {footer && <div className="px-5 pb-4">{footer}</div>}
    </section>
  );
}

/** A segmented control that sits on the chart's gradient header (Counted by …). */
export function GlassToggle<T extends string>({ value, options, onChange, label, ink = "#1e3a8a" }: {
  value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; label: string; ink?: string;
}) {
  return (
    <div className="inline-flex h-8 items-center rounded-full bg-[#ffffff26] p-0.5 ring-1 ring-[#ffffff40]" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" onClick={() => onChange(o.key)} aria-pressed={value === o.key}
          className={`h-7 rounded-full px-3 text-xs font-semibold transition-colors ${value === o.key ? "bg-[#fff] shadow" : "text-[#fff] hover:bg-[#ffffff22]"}`}
          style={value === o.key ? { color: ink } : undefined}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

export function HeadStat({ label, value, sub, dot, ring = null, labelColor = "#c7d2fe", subColor = "#e0e7ff" }: {
  label: string; value: string; sub: string; dot: string; ring?: number | null; labelColor?: string; subColor?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-[#ffffff1a] px-3 py-2 ring-1 ring-[#ffffff33] backdrop-blur-sm">
      {ring !== null && ring !== undefined ? <Ring pct={ring} color={dot} size={38} track="#ffffff33" text="#fff" /> : (
        <span aria-hidden className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: dot }} />
      )}
      <div className="min-w-0">
        <div className="truncate text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: labelColor }}>{label}</div>
        <div className="tnum text-lg font-bold leading-tight">{value}</div>
        <div className="truncate text-[11px]" style={{ color: subColor }}>{sub}</div>
      </div>
    </div>
  );
}

export function Ring({ pct, color, size = 64, track = "var(--surface-2)", text = "var(--text-primary)" }: {
  pct: number | null; color: string; size?: number; track?: string; text?: string;
}) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img" aria-label={`${p}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={5} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"
        strokeDasharray={`${(p / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 500ms cubic-bezier(0.2,0,0,1)" }} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size / 4.2} fontWeight={700} fill={text}>
        {pct === null ? "—" : `${p}%`}
      </text>
    </svg>
  );
}

function MonthTick({ x, y, payload, pinned, hovered, future, axis }: {
  x: number; y: number; payload: { value: string }; pinned: boolean; hovered: boolean; future: boolean; axis: string;
}) {
  const w = 46;
  const fill = pinned ? "#2563eb" : hovered ? "#6366f1" : "transparent";
  return (
    <g transform={`translate(${x},${y + 4})`}>
      <rect x={-w / 2} y={0} width={w} height={20} rx={10} fill={fill} opacity={pinned ? 1 : hovered ? 0.15 : 0} />
      <text x={0} y={14} textAnchor="middle" fontSize={11} fontWeight={pinned || hovered ? 700 : 500}
        fill={pinned ? "#fff" : hovered ? "#4f46e5" : future ? PRED : axis}>
        {payload.value}
      </text>
    </g>
  );
}

function MiniTooltip({ active, row, keys, canOpen }: { active?: boolean; row?: Full; keys: MoneyKey[]; canOpen: boolean }) {
  if (!active || !row) return null;
  return (
    <div className="min-w-[13rem] rounded-xl border border-subtle bg-surface-3 px-3 py-2 text-xs shadow-overlay">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="font-bold text-primary">{row.label}</span>
        {row.future ? <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ background: `${PRED}22`, color: PRED }}>Forecast</span>
          : <span className="text-[10px] text-muted">{num(row.invoices ?? 0)} invoices</span>}
      </div>
      <ul className="space-y-0.5">
        {keys.map((k) => {
          const s = moneySeriesOf(k);
          if (!s) return null;
          return (
            <li key={k} className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-secondary">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}
              </span>
              <span className="tnum font-semibold text-primary">{inrCompact(row[k])}</span>
            </li>
          );
        })}
      </ul>
      {keys.includes("predicted") && (row.predicted_projects || row.predicted_heads) ? (
        <div className="mt-1 text-[10px] text-muted">{num(row.predicted_projects ?? 0)} projects · {num(row.predicted_heads ?? 0)} people predicted</div>
      ) : null}
      {canOpen && <div className="mt-1.5 border-t border-subtle pt-1 text-[10px] font-semibold text-brand-600 dark:text-brand-300">Click to open the invoices →</div>}
    </div>
  );
}

function Spotlight({ row, live, pinned = false, withPredicted, openLabel, onOpen }: {
  row: Full; live: boolean; pinned?: boolean; withPredicted: boolean; openLabel: string | null; onOpen?: (e: React.MouseEvent) => void;
}) {
  const received = row.received_bank + row.received_tds;
  const pct = shareOf(received, row.revenue_inc);
  const predPct = shareOf(row.revenue_ex, row.predicted);
  return (
    <aside className="flex flex-col rounded-card border border-subtle bg-surface-2 p-4" aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">{live ? "Month spotlight" : pinned ? "Chosen month" : "Latest month"}</div>
          <div className="text-xl font-bold text-primary">{row.label}</div>
          <div className="text-[11px] text-muted">{row.future ? "Forecast — no invoices yet" : `${num(row.invoices ?? 0)} invoices · work month`}</div>
        </div>
        <Ring pct={pct} color="#10b981" size={62} />
      </div>

      <div className="mt-3 rounded-xl p-3 text-[#fff]" style={{ background: "linear-gradient(135deg, #2563eb, #6366f1)" }}>
        <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#dbeafe]">Revenue (Ex. Tax)</div>
        <div className="tnum text-2xl font-bold">{inrCompact(row.revenue_ex)}</div>
        <div className="text-[11px] text-[#e0e7ff]">Inc Tax {inrCompact(row.revenue_inc)}</div>
      </div>

      <div className="mt-3 space-y-3">
        <SplitBar label="Bank" receivable={row.receivable_bank} received={row.received_bank} due={row.due_bank}
          colors={["#10b981", "#f59e0b"]} />
        <SplitBar label="TDS" receivable={row.receivable_tds} received={row.received_tds} due={row.due_tds}
          colors={["#84cc16", "#f97316"]} />
        <div className="flex items-center justify-between rounded-control bg-surface-1 px-3 py-2 ring-1 ring-inset ring-subtle">
          <span className="text-xs font-semibold text-secondary">Total Due</span>
          <span className={`tnum text-sm font-bold ${row.total_due > 0 ? "text-danger" : "text-success"}`}>{inrCompact(row.total_due)}</span>
        </div>
        {withPredicted && (
          <div className="rounded-control px-3 py-2 ring-1 ring-inset" style={{ background: `${PRED}12`, boxShadow: `inset 0 0 0 1px ${PRED}40` }}>
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold" style={{ color: PRED }}>Predicted</span>
              <span className="tnum font-bold text-primary">{inrCompact(row.predicted)}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-muted">
              {num(row.predicted_projects ?? 0)} projects · {num(row.predicted_heads ?? 0)} people
              {!row.future && predPct !== null && <> · billed {predPct}% of it</>}
            </div>
          </div>
        )}
      </div>

      {openLabel && onOpen && (
        <button type="button" onClick={(e) => onOpen(e)}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-control px-3 py-2.5 text-sm font-bold text-[#fff] shadow-raised transition-transform hover:-translate-y-px"
          style={{ background: "linear-gradient(120deg, #1d4ed8, #7c3aed, #c026d3)" }}>
          {openLabel} <ArrowRight size={15} aria-hidden />
        </button>
      )}
    </aside>
  );
}

function SplitBar({ label, receivable, received, due, colors }: {
  label: string; receivable: number; received: number; due: number; colors: [string, string];
}) {
  const base = Math.max(receivable, received + due, 1e-9);
  const p = shareOf(received, receivable);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-semibold text-secondary">{label} <span className="text-muted">· receivable {inrCompact(receivable)}</span></span>
        <span className="tnum font-bold text-primary">{p === null ? "—" : `${p}%`}</span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-1 ring-1 ring-inset ring-subtle">
        <div style={{ width: `${(received / base) * 100}%`, background: colors[0] }} className="transition-all duration-panel" />
        <div style={{ width: `${(due / base) * 100}%`, background: colors[1] }} className="transition-all duration-panel" />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-muted">
        <span>received {inrCompact(received)}</span><span>due {inrCompact(due)}</span>
      </div>
    </div>
  );
}

function MonthStrip({ rows, hidden, onToggle, onAll, onActuals, onNone, pinned, hover }: {
  rows: Full[]; hidden: Set<string>; onToggle: (k: string) => void; onAll: () => void; onActuals: () => void; onNone: () => void;
  pinned: string | null; hover: string | null;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.revenue_ex, r.predicted || 0)));
  return (
    <div className="mt-2 rounded-control border border-subtle bg-surface-2 p-2" role="group" aria-label="Months">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 px-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">Months · click to hide or show</span>
        <span className="flex gap-2 text-[11px] font-semibold">
          <button type="button" className="text-brand-600 hover:underline dark:text-brand-300" onClick={onAll}>All</button>
          {rows.some((r) => r.future) && <button type="button" className="text-brand-600 hover:underline dark:text-brand-300" onClick={onActuals}>Actuals only</button>}
          <button type="button" className="text-brand-600 hover:underline dark:text-brand-300" onClick={onNone}>None</button>
        </span>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-0.5">
        {rows.map((r) => {
          const on = !hidden.has(r.key);
          const h1 = Math.round((r.revenue_ex / max) * 22);
          const h2 = Math.round(((r.predicted || 0) / max) * 22);
          return (
            <button key={r.key} type="button" onClick={() => onToggle(r.key)} aria-pressed={on}
              title={`${r.label}: Revenue ${inrCompact(r.revenue_ex)}${r.predicted ? ` · predicted ${inrCompact(r.predicted)}` : ""} — click to ${on ? "hide" : "show"}`}
              className={`flex min-w-[3.25rem] flex-1 flex-col items-center gap-1 rounded-lg px-1.5 pb-1 pt-1.5 text-[10px] font-semibold ring-1 ring-inset transition-all ${
                on ? "bg-surface-1 text-primary ring-subtle" : "bg-transparent text-muted opacity-50 ring-transparent"} ${
                r.key === pinned ? "!ring-2 !ring-brand-500" : r.key === hover && on ? "!ring-brand-300" : ""}`}>
              <span className="flex h-6 items-end gap-0.5" aria-hidden>
                <span className="w-2 rounded-sm" style={{ height: Math.max(2, h1), background: "linear-gradient(#2563eb,#60a5fa)" }} />
                <span className="w-2 rounded-sm" style={{ height: Math.max(2, h2), background: `linear-gradient(${PRED},${PRED}66)` }} />
              </span>
              <span className={r.future ? "text-[#c026d3]" : ""}>{r.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
