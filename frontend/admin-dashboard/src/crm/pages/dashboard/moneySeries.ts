/**
 * The money words of the CEO dashboard (6 Nov 2026, CEO ask):
 * Revenue (Ex. Tax) · Revenue (Inc Tax) · Receivable Bank · Receivable TDS ·
 * Received Bank · Received TDS · Due Bank · Due TDS · Total Due ·
 * Predicted revenue (project count).
 *
 * The server builds the figures per invoice WORK month (B-V2
 * services/money_split.py); this module only names, groups and links them. PURE.
 */
import type { BarSeries } from "../../components/controlTower";

export type MoneyKey =
  | "revenue_ex" | "revenue_inc" | "receivable_bank" | "receivable_tds" | "received_bank"
  | "received_tds" | "due_bank" | "due_tds" | "total_due" | "predicted";

export type MoneyRow = {
  key: string; label: string; future?: boolean;
  billed?: number; collected?: number; received_ex?: number;
  predicted?: number | null; predicted_projects?: number; predicted_heads?: number; predicted_customers?: number;
} & Partial<Record<MoneyKey, number>>;

/** Every series, in the CEO's order. Ten distinct colours (the theme palette
 *  has eight) — each reads on the light and the dark surface. */
export type MoneyGroup = "revenue" | "receivable" | "received" | "due" | "forecast";

export const MONEY_SERIES: { key: MoneyKey; label: string; color: string; hint: string; group: MoneyGroup; short: string }[] = [
  { key: "revenue_ex", label: "Revenue (Ex. Tax)", short: "Ex. Tax", color: "#2563eb", group: "revenue", hint: "invoice value before GST" },
  { key: "revenue_inc", label: "Revenue (Inc Tax)", short: "Inc Tax", color: "#6366f1", group: "revenue", hint: "invoice value with GST" },
  { key: "receivable_bank", label: "Receivable Bank", short: "Bank", color: "#06b6d4", group: "receivable", hint: "Inc Tax − TDS: the cash the customer should send" },
  { key: "receivable_tds", label: "Receivable TDS", short: "TDS", color: "#8b5cf6", group: "receivable", hint: "TDS the customer deducts (booked, else expected at the Settings rate)" },
  { key: "received_bank", label: "Received Bank", short: "Bank", color: "#10b981", group: "received", hint: "cash recorded against the invoices" },
  { key: "received_tds", label: "Received TDS", short: "TDS", color: "#84cc16", group: "received", hint: "TDS certificates received (Form 16A)" },
  { key: "due_bank", label: "Due Bank", short: "Bank", color: "#f59e0b", group: "due", hint: "cash still to come" },
  { key: "due_tds", label: "Due TDS", short: "TDS", color: "#f97316", group: "due", hint: "TDS pending from the client" },
  { key: "total_due", label: "Total Due", short: "Total", color: "#ef4444", group: "due", hint: "Due Bank + Due TDS" },
  { key: "predicted", label: "Predicted revenue (project count)", short: "Predicted", color: "#d946ef", group: "forecast", hint: "deployed team × the rate in force that month" },
];

/** The chip groups of the chart, in reading order (7 Nov 2026). */
export const MONEY_GROUPS: { key: MoneyGroup; label: string }[] = [
  { key: "revenue", label: "Revenue" }, { key: "receivable", label: "Receivable" },
  { key: "received", label: "Received" }, { key: "due", label: "Due" }, { key: "forecast", label: "Forecast" },
];

export const MONEY_KEYS = MONEY_SERIES.map((s) => s.key);
export const moneySeriesOf = (k: string) => MONEY_SERIES.find((s) => s.key === k) ?? null;

export type MoneyPreset = "overview" | "revenue" | "receivable" | "received" | "due" | "all";

export const MONEY_PRESETS: { key: MoneyPreset; label: string; keys: MoneyKey[] }[] = [
  { key: "overview", label: "Overview", keys: ["revenue_ex", "received_bank", "total_due", "predicted"] },
  { key: "revenue", label: "Revenue", keys: ["revenue_ex", "revenue_inc", "predicted"] },
  { key: "receivable", label: "Receivable", keys: ["revenue_inc", "receivable_bank", "receivable_tds"] },
  { key: "received", label: "Received", keys: ["receivable_bank", "received_bank", "receivable_tds", "received_tds"] },
  { key: "due", label: "Due", keys: ["due_bank", "due_tds", "total_due"] },
  { key: "all", label: "All", keys: MONEY_SERIES.map((s) => s.key) },
];

/** The chart series for a preset — every series is listed (so any can be
 *  ticked), the preset decides which start ticked. `withPredicted` false drops
 *  the prediction (the Customer tab has none). */
export function presetSeries(preset: MoneyPreset, withPredicted = true): BarSeries[] {
  const on = new Set((MONEY_PRESETS.find((p) => p.key === preset) ?? MONEY_PRESETS[0]).keys);
  return MONEY_SERIES.filter((s) => withPredicted || s.key !== "predicted")
    .map((s) => ({ key: s.key, label: s.label, color: s.color, defaultOff: !on.has(s.key) }));
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Rows ready for the chart. An older server without the split keys still
 *  draws: Revenue (Ex. Tax) = billed, Received Bank = collected. */
export function moneyRows<T extends MoneyRow>(rows: T[]): (T & Record<MoneyKey, number>)[] {
  return rows.map((r) => {
    const ex = r.revenue_ex ?? n(r.billed);
    const out = {
      ...r,
      revenue_ex: ex,
      revenue_inc: n(r.revenue_inc ?? ex),
      receivable_bank: n(r.receivable_bank), receivable_tds: n(r.receivable_tds),
      received_bank: n(r.received_bank ?? r.collected),
      received_tds: n(r.received_tds),
      due_bank: n(r.due_bank), due_tds: n(r.due_tds), total_due: n(r.total_due),
      predicted: n(r.predicted),
    };
    return out as T & Record<MoneyKey, number>;
  });
}

/** The drill page a money bar opens. */
export function moneyDrill(series: string): string {
  if (series.startsWith("received")) return "collected";
  if (series.startsWith("due") || series === "total_due") return "outstanding";
  return "billed";
}

/** The tooltip's extra words — the predicted bar names its projects and people. */
export function moneyTooltipNote(row: Record<string, unknown>, series: string): string | null {
  if (series !== "predicted") return null;
  const p = n(row.predicted_projects), h = n(row.predicted_heads);
  if (!p && !h) return null;
  return `${p} project${p === 1 ? "" : "s"} · ${h} ${h === 1 ? "person" : "people"}`;
}

/** The keys a preset ticks (`withPredicted` false drops the prediction). PURE. */
export function presetKeys(preset: MoneyPreset, withPredicted = true): MoneyKey[] {
  const keys = (MONEY_PRESETS.find((p) => p.key === preset) ?? MONEY_PRESETS[0]).keys;
  return withPredicted ? [...keys] : keys.filter((k) => k !== "predicted");
}

/** The preset a set of ticks is exactly, else null (a custom pick). PURE. */
export function presetOf(keys: MoneyKey[], withPredicted = true): MoneyPreset | null {
  const want = [...new Set(keys)].sort().join(",");
  const hit = MONEY_PRESETS.find((p) => presetKeys(p.key, withPredicted).sort().join(",") === want);
  return hit ? hit.key : null;
}

/** `?series=` → the ticked keys, in the CEO's order; null when absent / nothing valid. PURE. */
export function parseSeriesParam(raw: string | null | undefined): MoneyKey[] | null {
  if (!raw) return null;
  const asked = new Set(raw.split(",").map((s) => s.trim()));
  const keys = MONEY_KEYS.filter((k) => asked.has(k));
  return keys.length ? keys : null;
}

/** The ticked keys → `?series=` (CEO's order). PURE. */
export function seriesParam(keys: Iterable<MoneyKey>): string {
  const on = new Set(keys);
  return MONEY_KEYS.filter((k) => on.has(k)).join(",");
}

/** A money series key, else null (the `?bar=` the dashboard sends). PURE. */
export function asMoneyKey(raw: unknown): MoneyKey | null {
  return typeof raw === "string" && (MONEY_KEYS as string[]).includes(raw) ? (raw as MoneyKey) : null;
}

/** Sum of each money key over rows (predicted over every row, the rest over months
 *  already started). PURE. */
export function moneyTotals(rows: (MoneyRow & { future?: boolean })[]): Record<MoneyKey, number> {
  const out = Object.fromEntries(MONEY_KEYS.map((k) => [k, 0])) as Record<MoneyKey, number>;
  for (const r of rows) {
    for (const k of MONEY_KEYS) {
      if (k !== "predicted" && r.future) continue;
      out[k] += n(r[k]);
    }
  }
  return out;
}

/** Share of `part` in `whole` as a whole percent (null when whole is 0). PURE. */
export function shareOf(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}
