/**
 * CEO dashboard drill-down (27 Oct 2026) — ONE page behind every tile.
 *
 * The CEO asked: "click Billed → a separate page with every invoice behind it and
 * which are pending, paid, partly paid; the same for Cash collected with its POs;
 * the same for every tile of Customer, Sales, People — think like a CEO".
 *
 * Route `insights/:metric?month=&period=&customer_id=&project_id=&scope=` over
 * `GET /api/dashboard/ceo/drill/{metric}` (B-V2 `services/ceo_drilldown.py`).
 * Every metric answers with ONE shape (kpis · charts · segments · tables ·
 * related · notes), so this file lays out every page the same way:
 *   header (question · period controls · back) → KPI tiles → bar charts with
 *   tick filters → status chips → the searchable, sortable table(s) → notes.
 * Nothing is computed here — every figure comes from the server, which builds it
 * the way the tile it was opened from does, so the page adds up to the tile.
 * Same period contract as the dashboard: `month` is the anchor at every zoom.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp, ArrowLeft, Briefcase, Building2, Download, RefreshCw, Search, Users, Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { qs } from "../../api";
import { CrmLink, useCrmParams } from "../../routerHooks";
import { ErrorBox, SkeletonText } from "../../components/ui";
import {
  CONTROL, DateStepper, FilteredBars, ICON_BTN, Panel, PeriodSwitcher, Tile, fyAnchorMonth, openBarLink, inr, inrCompact, num, pct,
  shiftMonthKey, thisMonthKey,
} from "../../components/controlTower";
import type { PeriodKind, TileTone } from "../../components/controlTower";
import { HERO_BTN, PageHeader, type HeroAccent } from "../../components/PageHeader";
import { useDeskData } from "./DeskWidgets";
import { chartPalette, semanticAnchor } from "../../../design-system/tokens/tokens";
import { fmtDateShort } from "../../../lib/datetime";
import type { CeoPeriod } from "./CeoDashboard";

/* ---------- payload ---------- */

export type InsightFormat = "money" | "int" | "pct" | "days" | "num" | "text" | "date" | "badge";
export type InsightTone = "brand" | "success" | "warning" | "danger" | "neutral" | "info" | "violet";
/** What a tile shows when clicked (server-chosen): narrow the main table to these chips
 *  ([] = every row), keep rows whose `where` field is non-zero, order by `sort` (largest
 *  first) — or open another drill page (`metric` + `scope`). */
export type KpiGo = { segments?: string[]; where?: string; sort?: string; metric?: string; scope?: string };
type Kpi = { key: string; label: string; value: number | string | null; format: InsightFormat; tone: InsightTone;
  sub?: string | null; go?: KpiGo | null };
/** The table narrowing a clicked tile asked for. */
export type TableFocus = { kpi: string; label: string; where: string | null; sort: string | null; nonce: number;
  /** A clicked chart bar narrows the table to rows mentioning it (29 Oct 2026). */
  search?: string };

/** What a bar of a drill-page chart does, in this order: open the row's own link ·
 *  zoom the page to that bar's month / quarter / FY · pick the status chip of that
 *  name · narrow the table to rows naming it. PURE (the test pins the order). */
export type DrillBarAction =
  | { kind: "open"; path: string }
  | { kind: "period"; anchor_month: string; period: PeriodKind }
  | { kind: "segment"; key: string }
  | { kind: "search"; text: string };
export function drillBarAction(row: Row, segments: { key: string; label: string }[],
                               current: { month: string; period: PeriodKind }): DrillBarAction | null {
  for (const f of ["link", "customer_link"]) {
    if (typeof row[f] === "string" && row[f]) return { kind: "open", path: row[f] as string };
  }
  const p = bucketPeriod(row.key);
  if (p && !(p.kind === current.period && p.anchor_month === current.month)) {
    return { kind: "period", anchor_month: p.anchor_month, period: p.kind };
  }
  const label = String(row.label ?? "").trim();
  if (!label) return null;
  const seg = segments.find((s) => s.label.toLowerCase() === label.toLowerCase() || s.key === label);
  if (seg) return { kind: "segment", key: seg.key };
  if (/^Others/i.test(label)) return null;
  return { kind: "search", text: label };
}
type Series = { key: string; label: string; tone: InsightTone; stack?: string; off?: boolean };
type Chart = { key: string; title: string; subtitle?: string | null; rows: Record<string, unknown>[]; series: Series[];
  layout: "horizontal" | "vertical"; format: InsightFormat; x_key: string };
type Segment = { key: string; label: string; tone: InsightTone; count: number; amount: number | null };
export type InsightColumn = { key: string; label: string; format: InsightFormat; link?: string; align?: string };
type Row = Record<string, unknown>;
type Table = { key: string; title: string; subtitle?: string | null; columns: InsightColumn[]; rows: Row[]; total: number; truncated: boolean };
export type InsightPayload = {
  metric: string; tab: "finance" | "customer" | "sales" | "people"; title: string; question: string;
  period: CeoPeriod; as_of: string; filters: { customer_id: number | null; project_id: number | null; scope: string | null };
  kpis: Kpi[]; charts: Chart[]; segments: Segment[]; default_segment: string | null; default_segments?: string[] | null;
  tables: Table[]; related: { metric: string; label: string; scope?: string }[]; notes: string[];
};

/* ---------- pure helpers (exported for the test) ---------- */

const TONE_HEX: Record<InsightTone, string> = {
  brand: chartPalette[0], success: semanticAnchor.success, warning: semanticAnchor.warning,
  danger: semanticAnchor.danger, neutral: "#94a3b8", info: "#0ea5e9", violet: "#8b5cf6",
};
export const toneHex = (t: InsightTone | undefined) => TONE_HEX[t ?? "brand"] ?? TONE_HEX.brand;

const TILE_TONE: Record<InsightTone, TileTone> = {
  brand: "brand", success: "success", warning: "warning", danger: "danger", neutral: "neutral", info: "brand", violet: "brand",
};

export const CHIP_TONE: Record<InsightTone, string> = {
  brand: "bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-900/40 dark:text-brand-200 dark:ring-brand-800",
  success: "bg-success-soft text-success ring-success/30",
  warning: "bg-warning-soft text-warning ring-warning/30",
  danger: "bg-danger-soft text-danger ring-danger/30",
  info: "bg-info-soft text-info ring-info/30",
  violet: "bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-900/40 dark:text-purple-200 dark:ring-purple-800",
  neutral: "bg-surface-2 text-secondary ring-subtle",
};

export function formatValue(v: unknown, f: InsightFormat, compact = false): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" && f !== "money" && f !== "int" && f !== "pct" && f !== "days" && f !== "num") {
    return f === "date" ? fmtDateShort(v) : v;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  switch (f) {
    case "money": return compact ? inrCompact(n) : inr(n);
    case "int": return num(Math.round(n));
    case "pct": return pct(n, 0);
    case "days": return `${num(Math.round(n))} d`;
    case "num": return n.toLocaleString("en-IN", { maximumFractionDigits: 1 });
    default: return String(v);
  }
}

/** A row counts for a tile's `where` field when that field is a non-zero number
 *  (or a non-empty value that is not a number). */
export function rowHas(r: Row, field: string): boolean {
  const v = r[field];
  if (v === null || v === undefined || v === "" || v === false) return false;
  const n = Number(v);
  return Number.isFinite(n) ? n !== 0 : true;
}

/** Rows of a table narrowed by the chosen chips, a clicked tile's field and the search text. */
export function filterRows(rows: Row[], segs: string[], search: string, where: string | null = null): Row[] {
  const q = search.trim().toLowerCase();
  return rows.filter((r) => {
    if (segs.length && !segs.includes(String(r.segment ?? ""))) return false;
    if (where && !rowHas(r, where)) return false;
    if (!q) return true;
    return Object.entries(r).some(([k, v]) => !k.endsWith("link") && v !== null && typeof v !== "object"
      && String(v).toLowerCase().includes(q));
  });
}

export function sortRows(rows: Row[], key: string | null, dir: 1 | -1): Row[] {
  if (!key) return rows;
  return [...rows].sort((a, b) => {
    const x = a[key]; const y = b[key];
    if (x === y) return 0;
    if (x === null || x === undefined || x === "") return 1;
    if (y === null || y === undefined || y === "") return -1;
    const nx = Number(x); const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny) && typeof x !== "string") return (nx - ny) * dir;
    return String(x).localeCompare(String(y), "en-IN", { numeric: true }) * dir;
  });
}

export function toCsv(columns: InsightColumn[], rows: Row[]): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;          // formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => cell(c.label)).join(","),
    ...rows.map((r) => columns.map((c) => cell(r[c.key])).join(","))].join("\n");
}

/** The drill-down link a dashboard tile opens — same anchor + zoom, optional scope. */
export type InsightExtra = { scope?: string; customer_id?: number | null; project_id?: number | null;
  /** Opens the page with the main table already narrowed to rows naming this text (a clicked bar). */
  q?: string | null };
export function insightLink(metric: string, p: { anchor_month: string; kind: string }, extra: InsightExtra = {}): string {
  return `insights/${metric}${qs({ month: p.anchor_month, period: p.kind, scope: extra.scope,
    customer_id: extra.customer_id ?? undefined, project_id: extra.project_id ?? undefined, q: extra.q || undefined })}`;
}

/** A chart bucket key → the period it stands for (29 Oct 2026, click a bar):
 *  "2026-04" = that month · "2026-Q2" = that FY quarter (Q1 starts in April) ·
 *  "FY2026" = FY 2026-27. Anything else → null (the bar is not a period). */
export function bucketPeriod(key: unknown): { anchor_month: string; kind: PeriodKind } | null {
  const k = String(key ?? "");
  if (/^\d{4}-\d{2}$/.test(k)) return { anchor_month: k, kind: "month" };
  const q = /^(\d{4})-Q([1-4])$/.exec(k);
  if (q) {
    const y = Number(q[1]); const n = Number(q[2]);
    const m = 4 + (n - 1) * 3;                       // Apr · Jul · Oct · Jan(+1)
    return { anchor_month: m > 12 ? `${y + 1}-${String(m - 12).padStart(2, "0")}` : `${y}-${String(m).padStart(2, "0")}`, kind: "quarter" };
  }
  const f = /^FY(\d{4})$/.exec(k);
  if (f) return { anchor_month: fyAnchorMonth(Number(f[1])), kind: "fy" };
  return null;
}

/** The drill page a bar of a period chart opens: the same metric, zoomed to that bar's bucket. */
export function bucketLink(metric: string, key: unknown, extra: InsightExtra = {}): string | null {
  const p = bucketPeriod(key);
  return p ? insightLink(metric, p, extra) : null;
}

/* ---------- page ---------- */

const TAB_LOOK: Record<InsightPayload["tab"], { label: string; icon: LucideIcon; accent: HeroAccent }> = {
  finance: { label: "Finance", icon: Wallet, accent: "ocean" },
  customer: { label: "Customer", icon: Building2, accent: "teal" },
  sales: { label: "Sales", icon: Briefcase, accent: "violet" },
  people: { label: "People", icon: Users, accent: "amber" },
};

function readParams() {
  const p = new URLSearchParams(window.location.search);
  const kind = p.get("period");
  const cid = Number(p.get("customer_id"));
  const pid = Number(p.get("project_id"));
  return {
    month: /^\d{4}-\d{2}$/.test(p.get("month") || "") ? (p.get("month") as string) : thisMonthKey(),
    period: (kind === "month" || kind === "quarter" || kind === "fy" ? kind : "fy") as PeriodKind,
    customer: Number.isFinite(cid) && cid > 0 ? cid : null,
    project: Number.isFinite(pid) && pid > 0 ? pid : null,
    scope: p.get("scope") || "",
    q: (p.get("q") || "").slice(0, 120),
  };
}

export function CeoInsightPage() {
  const { metric = "" } = useCrmParams();
  const [state, setState] = useState(readParams);
  // Keep the address in step so a copied link opens the same view; replaceState
  // keeps history.state (the app's Back index lives there).
  useEffect(() => {
    const url = new URL(window.location.href);
    const set = (k: string, v: string | number | null) => (v === null || v === "" ? url.searchParams.delete(k) : url.searchParams.set(k, String(v)));
    set("month", state.month); set("period", state.period);
    set("customer_id", state.customer); set("project_id", state.project); set("scope", state.scope || null);
    set("q", state.q || null);
    if (url.toString() !== window.location.href) window.history.replaceState(window.history.state, "", url.toString());
  }, [state]);
  // The bar a page was opened from (`q`) narrows the first view only — a new period starts clean.
  const firstPeriod = useRef(`${state.month}:${state.period}`);
  useEffect(() => {
    if (`${state.month}:${state.period}` !== firstPeriod.current && state.q) setState((s) => ({ ...s, q: "" }));
  }, [state.month, state.period, state.q]);

  const url = `/api/dashboard/ceo/drill/${encodeURIComponent(metric)}${qs({
    month: state.month, period: state.period, customer_id: state.customer ?? undefined,
    project_id: state.project ?? undefined, scope: state.scope || undefined,
  })}`;
  const { data, loading, error, retry } = useDeskData<InsightPayload>(url, { live: 120_000 });

  const look = TAB_LOOK[data?.tab ?? "finance"];
  const atCurrent = data ? data.period.is_current || data.period.end >= new Date().toISOString().slice(0, 10)
    : state.month >= thisMonthKey();

  return (
    <div className="space-y-5">
      <PageHeader
        icon={look.icon}
        accent={look.accent}
        eyebrow={`CEO dashboard · ${look.label}`}
        title={data?.title ?? "Loading…"}
        subtitle={data?.question}
        stats={data ? [{ label: data.period.label, value: data.period.short_label }, { label: "as of", value: fmtDateShort(data.as_of) }] : undefined}
        actions={<>
          <CrmLink to="" className={HERO_BTN}><ArrowLeft size={15} aria-hidden /> Dashboard</CrmLink>
          <button type="button" className={HERO_BTN} onClick={retry} title="Read again"><RefreshCw size={15} aria-hidden /> Refresh</button>
        </>}
      >
        <div className="flex flex-wrap items-center gap-2">
          <PeriodSwitcher value={state.period} onChange={(v) => setState((s) => ({ ...s, period: v }))} />
          <DateStepper month={state.month} period={state.period} atCurrent={atCurrent}
            onShift={(d) => setState((s) => ({ ...s, month: shiftMonthKey(s.month, d) }))}
            onPick={(v) => setState((s) => ({ ...s, month: v }))} />
          {(state.customer || state.project) && (
            <button type="button" className={`${CONTROL} inline-flex items-center gap-1.5`}
              onClick={() => setState((s) => ({ ...s, customer: null, project: null }))} title="Show the whole company">
              One {state.project ? "project" : "customer"} only · <span className="font-semibold text-brand-600 dark:text-brand-300">clear</span>
            </button>
          )}
          {data && data.related.length > 0 && (
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-muted">Next:</span>
              {data.related.map((r) => (
                <CrmLink key={r.metric + (r.scope ?? "")} to={insightLink(r.metric, data.period, { scope: r.scope, customer_id: state.customer, project_id: state.project })}
                  className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-brand-600 ring-1 ring-inset ring-subtle hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-900/30">
                  {r.label} →
                </CrmLink>
              ))}
            </div>
          )}
        </div>
      </PageHeader>

      {error && <ErrorBox error={error} onRetry={retry} />}
      {loading && !data && <SkeletonText lines={8} />}
      {data && <InsightBody key={`${data.metric}:${data.period.key}`} d={data}
        current={{ month: state.month, period: state.period }} initialSearch={state.q}
        onPeriod={(month, period) => setState((s) => ({ ...s, month, period }))} />}
    </div>
  );
}

const KPI_COLS: Record<number, string> = { 3: "xl:grid-cols-3", 4: "xl:grid-cols-4", 5: "xl:grid-cols-5", 6: "xl:grid-cols-6" };

function InsightBody({ d, current, onPeriod, initialSearch = "" }: {
  d: InsightPayload; current: { month: string; period: PeriodKind };
  onPeriod: (month: string, period: PeriodKind) => void; initialSearch?: string;
}) {
  // Opened from a dashboard bar with `q`: every chip, the table narrowed to that name.
  const [segs, setSegs] = useState<string[]>(() => (initialSearch ? []
    : d.default_segments?.length ? d.default_segments : d.default_segment ? [d.default_segment] : []));
  const [first, ...rest] = d.charts;
  const toneOfSeg = useMemo(() => Object.fromEntries(d.segments.map((s) => [s.key, s.tone])), [d.segments]);
  const [focus, setFocus] = useState<TableFocus | null>(() => (initialSearch
    ? { kpi: `bar:${initialSearch}`, label: initialSearch, where: null, sort: null, nonce: Date.now(), search: initialSearch } : null));
  const toggle = (k: string) => setSegs((cur) => (cur.length === 1 && cur[0] === k ? [] : [k]));
  const tableRef = useRef<HTMLDivElement>(null);

  // A tile shows the rows behind its number: the server says which (`go`); a tile
  // without one shows the whole main table. Either way the table scrolls into view.
  const openKpi = (k: Kpi) => {
    const go = k.go ?? {};
    if (d.tables.length === 0) return;
    if (focus?.kpi === k.key) {           // a second click lets go again
      setFocus(null);
      setSegs(d.default_segments?.length ? d.default_segments : d.default_segment ? [d.default_segment] : []);
      return;
    }
    setSegs(go.segments ?? []);
    setFocus({ kpi: k.key, label: k.label, where: go.where ?? null, sort: go.sort ?? null, nonce: Date.now() });
    window.requestAnimationFrame(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const onAll = () => { setSegs([]); setFocus(null); };

  // 29 Oct 2026 — a bar opens the data behind it (see `drillBarAction`).
  const onBar = (row: Row) => {
    const a = drillBarAction(row, d.segments, current);
    if (!a) return;
    if (a.kind === "open") { openBarLink(a.path); return; }
    if (a.kind === "period") { onPeriod(a.anchor_month, a.period); return; }
    if (d.tables.length === 0) return;
    if (a.kind === "segment") { setFocus(null); setSegs([a.key]); }
    else {
      setSegs([]);
      setFocus({ kpi: `bar:${a.text}`, label: String(row.label ?? a.text), where: null, sort: null, nonce: Date.now(), search: a.text });
    }
    window.requestAnimationFrame(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <>
      {d.kpis.length > 0 && (
        <div className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-3 ${KPI_COLS[Math.min(6, Math.max(3, d.kpis.length))]}`}>
          {d.kpis.map((k) => {
            const common = { label: k.label, tone: TILE_TONE[k.tone] ?? "brand", value: formatValue(k.value, k.format, true), sub: k.sub ?? undefined };
            if (k.go?.metric) {
              return <Tile key={k.key} {...common}
                to={insightLink(k.go.metric, d.period, { scope: k.go.scope, customer_id: d.filters.customer_id, project_id: d.filters.project_id })} />;
            }
            return <Tile key={k.key} {...common} active={focus?.kpi === k.key}
              onClick={d.tables.length ? () => openKpi(k) : undefined}
              title={focus?.kpi === k.key ? "Showing these rows — click again to show all" : `Show the ${d.tables[0]?.title.toLowerCase() ?? "rows"} behind this number`} />;
          })}
        </div>
      )}

      {first && <ChartPanel c={first} wide onBar={onBar} />}
      {rest.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">
          {rest.map((c) => <ChartPanel key={c.key} c={c} onBar={onBar} />)}
        </div>
      )}

      {d.tables.map((t, i) => (
        <div key={t.key} ref={i === 0 ? tableRef : undefined} className="scroll-mt-4">
          <TablePanel t={t} segments={i === 0 ? d.segments : []} segs={i === 0 ? segs : []}
            onSeg={(k) => { setFocus(null); toggle(k); }}
            onAll={onAll} toneOfSeg={i === 0 ? toneOfSeg : {}} fileStem={`${d.metric}-${d.period.key}-${t.key}`}
            focus={i === 0 ? focus : null} onClearFocus={onAll} />
        </div>
      ))}

      {d.notes.length > 0 && (
        <section className="rounded-card border border-subtle bg-surface-2 px-5 py-3 text-sm text-secondary">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">How these numbers are worked out</div>
          <ul className="list-disc space-y-1 pl-5">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </section>
      )}
    </>
  );
}

function ChartPanel({ c, wide = false, onBar }: { c: Chart; wide?: boolean; onBar?: (row: Row) => void }) {
  const fmt = (v: number) => formatValue(v, c.format, true);
  const stacked = c.series.some((s) => s.stack);
  return (
    <Panel title={c.title} hint={c.subtitle ?? undefined}>
      {c.rows.length === 0
        ? <p className="py-8 text-center text-sm text-muted">Nothing in this period.</p>
        : <FilteredBars data={c.rows} xKey={c.x_key} format={fmt} height={wide ? 300 : 260} layout={c.layout}
            rowFilter={c.rows.length > 4} stacked={stacked}
            onBarClick={onBar ? (row) => onBar(row) : undefined}
            clickHint="Click a bar to see the rows behind it"
            series={c.series.map((s) => ({ key: s.key, label: s.label, color: toneHex(s.tone), stackId: s.stack, defaultOff: s.off }))} />}
    </Panel>
  );
}

const PAGE = 50;
const thCls = "sticky top-0 z-[1] bg-surface-2 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-muted whitespace-nowrap";
const tdCls = "px-3 py-2 text-sm text-primary tabular-nums whitespace-nowrap";

function TablePanel({ t, segments, segs, onSeg, onAll, toneOfSeg, fileStem, focus = null, onClearFocus }: {
  t: Table; segments: Segment[]; segs: string[]; onSeg: (k: string) => void; onAll: () => void;
  toneOfSeg: Record<string, InsightTone>; fileStem: string;
  focus?: TableFocus | null; onClearFocus?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: string | null; dir: 1 | -1 }>({ key: null, dir: -1 });
  const [shown, setShown] = useState(PAGE);
  const where = focus?.where && t.columns.length ? focus.where : null;
  // A clicked tile orders the table by its own figure, largest first (only when the
  // table has that column — otherwise the order is left alone).
  // A bar's search goes when its focus goes ("Show all rows", a chip); a typed one stays.
  const barSearch = useRef("");
  useEffect(() => {
    if (focus?.sort && t.rows.some((r) => focus.sort! in r)) setSort({ key: focus.sort, dir: -1 });
    if (focus) { barSearch.current = focus.search ?? ""; setSearch(focus.search ?? ""); }
    else if (barSearch.current) { setSearch((cur) => (cur === barSearch.current ? "" : cur)); barSearch.current = ""; }
  }, [focus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => sortRows(filterRows(t.rows, segs, search, where), sort.key, sort.dir), [t.rows, segs, search, where, sort]);
  useEffect(() => setShown(PAGE), [segs, search, sort, where]);
  const moneyCols = t.columns.filter((c) => c.format === "money");
  const totals = useMemo(() => Object.fromEntries(moneyCols.map((c) => [c.key, rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0)])), [rows, moneyCols]);

  const exportCsv = () => {
    const blob = new Blob([toCsv(t.columns, rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileStem}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const sortBy = (k: string) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === 1 ? -1 : 1 } : { key: k, dir: -1 }));

  return (
    <Panel title={t.title} hint={t.subtitle ?? undefined}
      action={<div className="flex flex-wrap items-center gap-2">
        <label className="relative">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
            aria-label={`Search ${t.title}`} className={`${CONTROL} w-52 pl-8`} />
        </label>
        <button type="button" className={ICON_BTN} onClick={exportCsv} title="Download what is shown as CSV" aria-label="Download CSV">
          <Download size={15} aria-hidden />
        </button>
      </div>}>
      {focus && (focus.where || focus.sort || focus.search) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-control border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-100">
          <span>
            Showing the rows behind <strong>{focus.label}</strong> · {num(rows.length)} {rows.length === 1 ? "row" : "rows"}
            {focus.sort && sort.key === focus.sort ? ", largest first" : ""}
          </span>
          <button type="button" onClick={onClearFocus} className="ml-auto text-xs font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-200">
            Show all rows
          </button>
        </div>
      )}
      {segments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          <button type="button" onClick={onAll} aria-pressed={segs.length === 0 && !where}
            className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${segs.length === 0 && !where ? "bg-brand-600 text-white ring-brand-600" : "bg-surface-1 text-secondary ring-subtle hover:bg-surface-2"}`}>
            All · {num(t.rows.length)}
          </button>
          {segments.map((s) => {
            const on = segs.includes(s.key);
            return (
              <button key={s.key} type="button" onClick={() => onSeg(s.key)} aria-pressed={on} disabled={s.count === 0 && !on}
                className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition-shadow disabled:opacity-40 ${CHIP_TONE[s.tone]} ${on ? "ring-2 shadow-raised" : ""}`}>
                {s.label} · {num(s.count)}{s.amount ? ` · ${inrCompact(s.amount)}` : ""}
              </button>
            );
          })}
        </div>
      )}
      <div className="-mx-5 -mb-5 max-h-[38rem] overflow-auto border-t border-subtle">
        <table className="min-w-full">
          <thead>
            <tr>
              {t.columns.map((c) => (
                <th key={c.key} className={`${thCls} ${c.align === "right" ? "text-right" : ""}`}>
                  <button type="button" onClick={() => sortBy(c.key)} className="inline-flex items-center gap-1 hover:text-primary">
                    {c.label}
                    <ArrowDownUp size={11} aria-hidden className={sort.key === c.key ? "text-brand-600" : "opacity-40"} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {rows.slice(0, shown).map((r, i) => (
              <tr key={String(r.id ?? r.link ?? i) + ":" + i} className="row-hover">
                {t.columns.map((c) => <td key={c.key} className={`${tdCls} ${c.align === "right" ? "text-right" : ""}`}><Cell c={c} r={r} toneOfSeg={toneOfSeg} /></td>)}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={t.columns.length} className="px-3 py-10 text-center text-sm text-muted">Nothing here.</td></tr>
            )}
          </tbody>
          {rows.length > 1 && moneyCols.length > 0 && (
            <tfoot>
              <tr className="bg-surface-2 font-semibold">
                {t.columns.map((c, i) => (
                  <td key={c.key} className={`${tdCls} ${c.align === "right" ? "text-right" : ""}`}>
                    {i === 0 ? `Total · ${num(rows.length)}` : c.format === "money" ? inr(totals[c.key]) : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {(rows.length > shown || t.truncated) && (
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm">
          {rows.length > shown && (
            <button type="button" className={CONTROL} onClick={() => setShown((n) => n + PAGE * 2)}>
              Show more ({num(rows.length - shown)} left)
            </button>
          )}
          {t.truncated && <span className="text-muted">Showing the first {num(t.rows.length)} of {num(t.total)} — narrow the period.</span>}
        </div>
      )}
    </Panel>
  );
}

function Cell({ c, r, toneOfSeg }: { c: InsightColumn; r: Row; toneOfSeg: Record<string, InsightTone> }) {
  const v = r[c.key];
  if (c.format === "badge") {
    if (v === null || v === undefined || v === "") return <span className="text-muted">—</span>;
    const tone = toneOfSeg[String(r.segment ?? "")] ?? "neutral";
    return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${CHIP_TONE[tone]}`}>{String(v).replace(/_/g, " ")}</span>;
  }
  if (c.format === "days" && (v === 0 || v === null || v === undefined)) return <span className="text-muted">—</span>;
  const text = formatValue(v, c.format);
  const late = c.key === "days_late" || c.key === "late_by";
  const cls = late && Number(v) > 0 ? (Number(v) > 60 ? "font-semibold text-danger" : "font-semibold text-warning") : "";
  const to = c.link ? r[c.link] : null;
  if (typeof to === "string" && to && v !== null && v !== undefined && v !== "") {
    return <CrmLink to={to} className={`font-medium text-brand-600 hover:underline dark:text-brand-300 ${cls}`}>{text}</CrmLink>;
  }
  return <span className={cls}>{text}</span>;
}

