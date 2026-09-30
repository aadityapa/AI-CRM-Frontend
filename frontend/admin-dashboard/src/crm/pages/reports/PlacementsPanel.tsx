/**
 * Customer placements: internal (redeployed) vs external (new hire) — the CEO
 * revenue page's people section (25 Sep 2026; server: B-V2
 * `services/placements_report.py`, `GET /api/reports/revenue/placements`).
 *
 * Every label is DERIVED on the server from facts already recorded — an earlier
 * placement anywhere, or the Karnex joining date vs the customer onboarding date
 * (30-day rule) — because Employees ▸ Profile Type says "Internal" for every
 * joined candidate and cannot answer this. Each row carries the reason, so the
 * list is checkable, and "Unknown" (no joining date) is shown, never folded in.
 *
 * The panel follows the page's zoom + customer/project filters by default, and
 * has its own CUSTOM date range (weekly bars up to ~3 months, monthly beyond).
 * The custom range is deliberately local to this panel: targets and forecasts
 * on the rest of the page are built per month and have no meaning for 9–23 Sep.
 */
import { useEffect, useMemo, useState } from "react";
import { CalendarRange, UsersRound } from "lucide-react";
import {
  Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from "recharts";

import { chartPalette, chartPaletteDark, neutral, radius } from "../../../design-system/tokens/tokens";
import { useTheme } from "../../../theme/ThemeProvider";
import { crmGet, qs } from "../../api";
import { CrmLink } from "../../routerHooks";
import { ErrorBox, SkeletonText } from "../../components/ui";
import { CONTROL, MiniStat, Panel, StepBars, tooltipStyle } from "../../components/controlTower";
import type { PeriodKind } from "../../components/controlTower";

/* ---------- wire shape ---------- */

type Kind = "internal" | "external" | "unknown";

type SeriesRow = { key: string; label: string; start: string; end: string; internal: number; external: number; unknown: number; internal_pct: number | null };
type CustomerRow = {
  customer_id: number | null; customer: string; internal: number; external: number; unknown: number; total: number;
  internal_pct: number | null; billed_internal: number; billed_external: number; billed_unknown: number;
};
type PlacementRow = {
  pe_id: number; employee_id: number; employee: string; employee_code: string | null;
  customer_id: number | null; customer: string | null; project_id: number; project: string;
  placed_on: string; karnex_joined: string | null; kind: Kind; reason: string; gap_days: number | null; billed: number;
};

export type PlacementsData = {
  as_of: string;
  window: { kind: string; key: string; label: string; start: string; end: string; bucket: string; comparison_label: string };
  headline: {
    placements: number; unique_people: number; internal: number; external: number; unknown: number;
    internal_pct: number | null; external_pct: number | null; undated: number;
    previous: { placements: number; internal: number; external: number; unknown: number };
  };
  series: SeriesRow[];
  by_customer: CustomerRow[];
  revenue: { internal: number; external: number; unknown: number; unattributed: number; total: number; internal_pct: number | null };
  rows: PlacementRow[];
  rows_truncated: boolean;
  rules: { grace_days: number; internal: string; external: string; unknown: string; revenue: string };
};

/* ---------- helpers ---------- */

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const num = (n: number) => n.toLocaleString("en-IN");
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toFixed(0)}%`);
const fmtDay = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

const KIND_LABEL: Record<Kind, string> = { internal: "Internal", external: "External", unknown: "Unknown" };
const KIND_CHIP: Record<Kind, string> = {
  internal: "bg-brand-50 text-brand-700 dark:bg-brand-900 dark:text-brand-300",
  external: "bg-success-soft text-success",
  unknown: "bg-surface-2 text-muted",
};
/** Rows shown before "Show all" — the list can hold 500. */
const ROWS_VISIBLE = 15;

function useKindColors(): Record<Kind, string> {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const palette = dark ? chartPaletteDark : chartPalette;
  return { internal: palette[0], external: palette[1], unknown: dark ? neutral[500] : neutral[400] };
}

function monthStartIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "3 more than last quarter" — a count, so in words, never a percentage. */
function CountChange({ now, prev, label }: { now: number; prev: number; label: string }) {
  const d = now - prev;
  const cls = d > 0 ? "text-success" : d < 0 ? "text-danger" : "text-muted";
  return (
    <span className="text-[11px] text-muted">
      <span className={`font-semibold tabular-nums ${cls}`}>{d > 0 ? "+" : ""}{d}</span> {label} ({prev})
    </span>
  );
}

/* ---------- charts ---------- */

function PlacementTrend({ series }: { series: SeriesRow[] }) {
  const { theme } = useTheme();
  const axis = theme === "dark" ? neutral[400] : neutral[500];
  const c = useKindColors();
  const hasUnknown = series.some((s) => s.unknown > 0);
  return (
    <div style={{ height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={axis} strokeOpacity={0.2} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: axis, fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis yAxisId="n" tick={{ fill: axis, fontSize: 11 }} allowDecimals={false} width={32} />
          <YAxis yAxisId="p" orientation="right" domain={[0, 100]} tick={{ fill: axis, fontSize: 11 }}
                 tickFormatter={(v: number) => `${v}%`} width={40} />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ fill: axis, fillOpacity: 0.08 }}
            formatter={(v: number, name: string) => (name === "Internal share" ? [`${v}%`, name] : [num(v), name])}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="n" dataKey="internal" name="Internal" stackId="k" fill={c.internal} barSize={22} animationDuration={250} />
          <Bar yAxisId="n" dataKey="external" name="External" stackId="k" fill={c.external} barSize={22} animationDuration={250}
               radius={hasUnknown ? undefined : [radius.input, radius.input, 0, 0]} />
          {hasUnknown && (
            <Bar yAxisId="n" dataKey="unknown" name="Unknown" stackId="k" fill={c.unknown} barSize={22}
                 radius={[radius.input, radius.input, 0, 0]} animationDuration={250} />
          )}
          <Line yAxisId="p" type="monotone" dataKey="internal_pct" name="Internal share" stroke={axis}
                strokeDasharray="4 3" strokeWidth={1.5} dot={{ r: 2 }} connectNulls animationDuration={250} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function SplitDonut({ h }: { h: PlacementsData["headline"] }) {
  const c = useKindColors();
  const data = (["internal", "external", "unknown"] as Kind[])
    .map((k) => ({ kind: k, name: KIND_LABEL[k], value: h[k] }))
    .filter((d) => d.value > 0);
  if (!data.length) {
    return <div className="flex h-full min-h-[10rem] items-center justify-center text-sm text-muted">No placements in this window.</div>;
  }
  return (
    <div className="relative" style={{ height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={2}
               stroke="none" animationDuration={250}>
            {data.map((d) => <Cell key={d.kind} fill={c[d.kind]} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [num(v), name]} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-display text-2xl font-bold tabular-nums text-primary">{pct(h.internal_pct)}</div>
        <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">internal</div>
      </div>
    </div>
  );
}

/* ---------- panel ---------- */

export function PlacementsPanel({
  month, period, customerId, projectId,
}: {
  month: string; period: PeriodKind; customerId: number | null; projectId: number | null;
}) {
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const [data, setData] = useState<PlacementsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [kindFilter, setKindFilter] = useState<Kind | "">("");

  const query = useMemo(() => ({
    customer_id: customerId ?? undefined,
    project_id: projectId ?? undefined,
    ...(custom ? { date_from: from, date_to: to } : { month, period }),
  }), [custom, from, to, month, period, customerId, projectId]);

  useEffect(() => {
    if (custom && (!from || !to || to < from)) return;   // wait for a valid range
    let cancelled = false;
    setLoading(true); setError("");
    crmGet<PlacementsData>(`/api/reports/revenue/placements${qs(query)}`)
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || "Could not load placements"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query, custom, from, to, tick]);

  const rangeInvalid = custom && !!from && !!to && to < from;
  const rows = useMemo(
    () => (data?.rows || []).filter((r) => !kindFilter || r.kind === kindFilter),
    [data, kindFilter],
  );
  const shown = showAll ? rows : rows.slice(0, ROWS_VISIBLE);
  const c = useKindColors();

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex h-8 items-center rounded-control border border-subtle bg-surface-2 p-0.5" role="group" aria-label="Placement window">
        {[{ k: false, label: "Page period" }, { k: true, label: "Custom range" }].map((o) => (
          <button key={String(o.k)} type="button" aria-pressed={custom === o.k} onClick={() => setCustom(o.k)}
                  className={`h-7 whitespace-nowrap rounded-control px-2.5 text-xs font-semibold transition-all duration-micro ${
                    custom === o.k ? "bg-surface-1 text-brand-600 shadow-raised dark:text-brand-300" : "text-secondary hover:text-primary"}`}>
            {o.label}
          </button>
        ))}
      </div>
      {custom && (
        <span className="inline-flex items-center gap-1.5">
          <CalendarRange className="h-4 w-4 text-muted" aria-hidden />
          <input type="date" aria-label="From" className={`${CONTROL} h-8 w-[9.5rem] [color-scheme:light] dark:[color-scheme:dark]`}
                 value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-xs text-muted">to</span>
          <input type="date" aria-label="To" className={`${CONTROL} h-8 w-[9.5rem] [color-scheme:light] dark:[color-scheme:dark]`}
                 value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </span>
      )}
    </div>
  );

  return (
    <Panel
      title="Customer placements — internal vs external"
      hint={data ? `${data.window.label} · ${data.window.bucket === "week" ? "weekly" : `by ${data.window.bucket}`} bars` : "Who we placed at customers, and where they came from"}
      action={controls}
    >
      {rangeInvalid ? (
        <p className="text-sm text-danger">The end date is before the start date.</p>
      ) : error ? (
        <ErrorBox error={error} onRetry={() => setTick((t) => t + 1)} />
      ) : !data ? (
        <SkeletonText lines={5} />
      ) : (
        <div className={`space-y-5 transition-opacity duration-micro ${loading ? "opacity-60" : ""}`}>
          {/* Headline */}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <MiniStat k="Placements" v={<>{num(data.headline.placements)}<span className="ml-1.5 text-xs font-medium text-muted">{num(data.headline.unique_people)} people</span></>} />
            <MiniStat k="Internal · redeployed" v={<span style={{ color: c.internal }}>{num(data.headline.internal)} <span className="text-xs font-medium text-muted">{pct(data.headline.internal_pct)}</span></span>}
                      hint={data.rules.internal} />
            <MiniStat k="External · new hire" v={<span style={{ color: c.external }}>{num(data.headline.external)} <span className="text-xs font-medium text-muted">{pct(data.headline.external_pct)}</span></span>}
                      hint={data.rules.external} />
            <MiniStat k="Unknown" v={num(data.headline.unknown)} tone={data.headline.unknown > 0 ? "warn" : undefined}
                      hint={data.rules.unknown} />
          </div>
          <div className="-mt-3 flex flex-wrap gap-x-4 gap-y-1">
            <CountChange now={data.headline.placements} prev={data.headline.previous.placements} label={data.window.comparison_label} />
            <CountChange now={data.headline.internal} prev={data.headline.previous.internal} label={`internal ${data.window.comparison_label}`} />
            <CountChange now={data.headline.external} prev={data.headline.previous.external} label={`external ${data.window.comparison_label}`} />
            {data.headline.undated > 0 && (
              <span className="text-[11px] text-warning">{data.headline.undated} assignment(s) have no onboarding date and are not counted</span>
            )}
          </div>

          {/* Trend + split */}
          <div className="grid gap-5 xl:grid-cols-[3fr,2fr]">
            <PlacementTrend series={data.series} />
            <div className="grid gap-4 sm:grid-cols-[12rem,1fr] sm:items-center xl:grid-cols-1">
              <SplitDonut h={data.headline} />
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Billed in the window, by who earned it</div>
                <StepBars
                  format={inr}
                  steps={[
                    { label: "Internal", value: data.revenue.internal, cls: "bg-brand-500" },
                    { label: "External", value: data.revenue.external, cls: "bg-emerald-600" },
                    ...(data.revenue.unknown > 0 ? [{ label: "Unknown", value: data.revenue.unknown, cls: "bg-slate-400" }] : []),
                    ...(data.revenue.unattributed > 0 ? [{ label: "Not linked to a person (manual invoices)", value: data.revenue.unattributed, cls: "bg-slate-300" }] : []),
                  ]}
                />
              </div>
            </div>
          </div>

          {/* By customer */}
          {data.by_customer.length > 0 && (
            <div className="overflow-x-auto rounded-control border border-subtle">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-subtle bg-surface-2 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
                    <th className="px-3 py-2.5">Customer</th>
                    <th className="px-3 py-2.5 text-right">Internal</th>
                    <th className="px-3 py-2.5 text-right">External</th>
                    <th className="px-3 py-2.5 text-right">Unknown</th>
                    <th className="px-3 py-2.5">Mix</th>
                    <th className="px-3 py-2.5 text-right">Billed · internal</th>
                    <th className="px-3 py-2.5 text-right">Billed · external</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_customer.map((r) => {
                    const known = r.internal + r.external + r.unknown;
                    return (
                      <tr key={`${r.customer_id ?? "x"}-${r.customer}`} className="border-b border-subtle text-sm text-secondary last:border-0 hover:bg-surface-2">
                        <td className="px-3 py-2.5 font-semibold text-primary">
                          {r.customer_id ? <CrmLink to={`customers/${r.customer_id}`} className="hover:underline">{r.customer}</CrmLink> : r.customer}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.internal || "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.external || "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.unknown || "—"}</td>
                        <td className="px-3 py-2.5">
                          {known ? (
                            <span className="flex h-2 w-28 overflow-hidden rounded-full bg-surface-2" title={`${pct(r.internal_pct)} internal`}>
                              <span style={{ width: `${(r.internal / known) * 100}%`, background: c.internal }} />
                              <span style={{ width: `${(r.external / known) * 100}%`, background: c.external }} />
                              <span style={{ width: `${(r.unknown / known) * 100}%`, background: c.unknown }} />
                            </span>
                          ) : <span className="text-xs text-muted">no placements · billing only</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.billed_internal ? inr(r.billed_internal) : "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.billed_external ? inr(r.billed_external) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Drill-down */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                <UsersRound className="h-3.5 w-3.5" aria-hidden /> Who was placed · {num(rows.length)}
              </div>
              <div className="inline-flex gap-1" role="group" aria-label="Filter the list by type">
                {(["", "internal", "external", "unknown"] as const).map((k) => (
                  <button key={k || "all"} type="button" aria-pressed={kindFilter === k}
                          onClick={() => { setKindFilter(k); setShowAll(false); }}
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold transition-colors duration-micro ${
                            kindFilter === k ? "bg-brand-600 text-white" : "bg-surface-2 text-secondary hover:text-primary"}`}>
                    {k ? KIND_LABEL[k] : "All"}
                  </button>
                ))}
              </div>
            </div>
            {rows.length === 0 ? (
              <p className="text-sm text-muted">Nobody {kindFilter ? `${KIND_LABEL[kindFilter].toLowerCase()} ` : ""}was placed at a customer in {data.window.label}.</p>
            ) : (
              <ul className="divide-y divide-subtle rounded-control border border-subtle">
                {shown.map((r) => (
                  <li key={r.pe_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${KIND_CHIP[r.kind]}`}>{KIND_LABEL[r.kind]}</span>
                    <CrmLink to={`employees/${r.employee_id}`} className="font-semibold text-primary hover:underline">{r.employee}</CrmLink>
                    {r.employee_code && <span className="font-mono text-xs text-muted">{r.employee_code}</span>}
                    <span className="min-w-0 text-secondary">
                      → {r.customer || "—"} <span className="text-muted">· {r.project}</span>
                    </span>
                    <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-muted">placed {fmtDay(r.placed_on)}</span>
                    <span className="basis-full text-xs text-muted">{r.reason}{r.billed ? ` · billed ${inr(r.billed)} in the window` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
            {rows.length > ROWS_VISIBLE && (
              <button type="button" onClick={() => setShowAll((v) => !v)}
                      className="mt-2 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
                {showAll ? "Show fewer" : `Show all ${num(rows.length)}`}
              </button>
            )}
            {data.rows_truncated && (
              <p className="mt-2 text-xs text-muted">The list shows the newest 500 — the counts above include everyone.</p>
            )}
          </div>

          <p className="text-xs leading-relaxed text-muted">
            <span className="font-semibold text-secondary">How a placement is labelled.</span>{" "}
            Internal: {data.rules.internal}. External: {data.rules.external}. Unknown: {data.rules.unknown}. {data.rules.revenue}.
          </p>
        </div>
      )}
    </Panel>
  );
}
