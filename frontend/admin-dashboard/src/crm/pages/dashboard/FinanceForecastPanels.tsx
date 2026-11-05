/**
 * Finance tab panels added 4 Nov 2026 (server: services/executive_dashboard._finance):
 *
 *  * PredictedRevenuePanel — predicted revenue month / quarter / year, with the
 *    customer and project counts behind it (deployed team × rate up to each
 *    planned release date Sales Managers record on the project employee).
 *  * NetRevenuePanel — net revenue = billed − expenses (user decision), with net
 *    profit (also minus people cost) beside it, month by month + by category.
 *  * TdsCollectionPanel — TDS the customers withheld, certificates received and
 *    what is still pending from clients.
 */
import { useState } from "react";
import { FilteredBars, MiniStat, Panel, STATE_CHIP, inrCompact, num, pct } from "../../components/controlTower";
import type { PeriodKind, StateTone } from "../../components/controlTower";

export type ForecastBucket = {
  key: string; label: string; kind: PeriodKind; start: string; end: string;
  predicted: number; lost_to_releases: number; billed_so_far: number;
  heads: number; customers: number; projects: number; releasing: number; current: boolean;
};
export type ForecastData = {
  month: ForecastBucket[]; quarter: ForecastBucket[]; fy: ForecastBucket[];
  releases: { pe_id: number; name: string; customer: string; customer_id: number; project: string;
    project_id: number; release_date: string; days_left: number; monthly_rate: number }[];
  assumptions: string;
};
export type NetData = {
  billed: number; expenses: number; people_cost: number; net_revenue: number; net_profit: number;
  net_margin_pct: number | null; expense_ratio_pct: number | null;
  by_category: { category: string; amount: number; share_pct: number }[];
};
export type TdsData = {
  deducted: number; deducted_invoices: number; received: number; pending: number; pending_count: number;
  oldest_pending_days: number | null;
  pending_by_customer: { customer: string; customer_id: number | null; amount: number }[];
  monthly: { key: string; label: string; deducted: number; received: number }[];
};

const ZOOMS: { key: PeriodKind; label: string }[] = [
  { key: "month", label: "Monthly" }, { key: "quarter", label: "Quarterly" }, { key: "fy", label: "Yearly" },
];

function Chip({ state, children }: { state: StateTone; children: React.ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP[state]}`}>{children}</span>;
}

function Zoom({ value, onChange }: { value: PeriodKind; onChange: (v: PeriodKind) => void }) {
  return (
    <div className="inline-flex h-9 items-center rounded-control border border-subtle bg-surface-2 p-0.5" role="group" aria-label="Forecast zoom">
      {ZOOMS.map((o) => (
        <button key={o.key} type="button" onClick={() => onChange(o.key)} aria-pressed={value === o.key}
          className={`h-8 rounded-control px-3 text-xs font-semibold transition-all duration-micro ${value === o.key ? "bg-surface-1 text-brand-600 shadow-raised dark:text-brand-300" : "text-secondary hover:text-primary"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The rows the forecast chart draws for a zoom. PURE. */
export function forecastRows(f: ForecastData, zoom: PeriodKind) {
  return (f[zoom] || []).map((b) => ({
    label: b.current ? `${b.label} (now)` : b.label, key: b.key,
    predicted: b.predicted, billed_so_far: b.billed_so_far, lost: b.lost_to_releases,
    customers: b.customers, projects: b.projects, heads: b.heads,
  }));
}

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function PredictedRevenuePanel({ f }: { f: ForecastData | null | undefined }) {
  const [zoom, setZoom] = useState<PeriodKind>("month");
  if (!f) return null;
  const rows = forecastRows(f, zoom);
  const next = f[zoom][0];
  const total = f[zoom].reduce((s, b) => s + b.predicted, 0);
  const lost = f[zoom].reduce((s, b) => s + b.lost_to_releases, 0);
  const soon = f.releases.filter((r) => r.days_left <= 30);
  return (
    <Panel title="Predicted revenue" hint={f.assumptions}
      action={<Zoom value={zoom} onChange={setZoom} />}>
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
        <MiniStat k={zoom === "month" ? "This month" : zoom === "quarter" ? "This quarter" : "This FY"}
          v={inrCompact(next?.predicted ?? 0)} hint={next ? `${inrCompact(next.billed_so_far)} billed so far` : undefined} />
        <MiniStat k={`Next ${f[zoom].length} ${zoom === "month" ? "months" : zoom === "quarter" ? "quarters" : "years"}`} v={inrCompact(total)} tone="ok" />
        <MiniStat k="Customers billing" v={num(next?.customers ?? 0)} hint="customers with someone deployed in the bucket" />
        <MiniStat k="Projects billing" v={num(next?.projects ?? 0)} />
        <MiniStat k="Lost to releases" v={inrCompact(lost)} tone={lost > 0 ? "warn" : "ok"}
          hint="what the planned release dates take off the forecast" />
      </div>
      <FilteredBars rowFilter rowLabel={zoom === "month" ? "Months" : zoom === "quarter" ? "Quarters" : "Years"}
        format={(v) => (v >= 1000 ? inrCompact(v) : num(v))} height={240} key={zoom}
        data={rows}
        series={[
          { key: "predicted", label: "Predicted", color: 4 },
          { key: "billed_so_far", label: "Billed so far", color: 0, defaultOff: true },
          { key: "lost", label: "Lost to releases", color: 5, defaultOff: true },
          { key: "customers", label: "Customers", color: 2, defaultOff: true },
          { key: "projects", label: "Projects", color: 3, defaultOff: true },
        ]} />
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <table className="w-full text-xs md:col-span-2">
          <thead><tr className="text-left text-muted">
            <th className="py-1 pr-2 font-semibold">{zoom === "month" ? "Month" : zoom === "quarter" ? "Quarter" : "FY"}</th>
            <th className="py-1 pr-2 text-right font-semibold">Predicted</th>
            <th className="py-1 pr-2 text-right font-semibold">Customers</th>
            <th className="py-1 pr-2 text-right font-semibold">Projects</th>
            <th className="py-1 pr-2 text-right font-semibold">People</th>
            <th className="py-1 text-right font-semibold">Releasing</th>
          </tr></thead>
          <tbody>
            {f[zoom].map((b) => (
              <tr key={b.key} className={`border-t border-subtle ${b.current ? "font-semibold text-primary" : "text-secondary"}`}>
                <td className="py-1 pr-2">{b.label}{b.current ? " · now" : ""}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{inrCompact(b.predicted)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{b.customers}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{b.projects}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{b.heads}</td>
                <td className={`py-1 text-right tabular-nums ${b.releasing ? "text-warning" : ""}`}>{b.releasing || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="rounded-control border border-subtle bg-surface-2 p-3 text-xs">
          <p className="mb-1.5 font-bold uppercase tracking-wide text-muted">Planned releases</p>
          {f.releases.length ? (
            <ul className="space-y-1">
              {f.releases.slice(0, 6).map((r) => (
                <li key={r.pe_id} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate text-secondary" title={`${r.name} · ${r.customer} · ${r.project}`}>
                    {r.name} <span className="text-muted">· {r.customer}</span>
                  </span>
                  <span className={`shrink-0 tabular-nums ${r.days_left <= 30 ? "font-semibold text-warning" : "text-secondary"}`}>
                    {fmtDay(r.release_date)}
                  </span>
                </li>
              ))}
              {f.releases.length > 6 && <li className="text-muted">+{f.releases.length - 6} more</li>}
            </ul>
          ) : <p className="text-muted">None recorded — Sales Managers add them on the project employee.</p>}
          {soon.length > 0 && <p className="mt-2 text-warning">{soon.length} within 30 days</p>}
        </div>
      </div>
    </Panel>
  );
}

export function NetRevenuePanel({ net, monthly }: {
  net: NetData | null | undefined;
  monthly: { key: string; label: string; billed: number; expenses?: number; cost: number; net_revenue?: number; net_profit?: number; future: boolean }[];
}) {
  if (!net) return null;
  const state: StateTone = net.net_margin_pct === null ? "none" : net.net_margin_pct >= 15 ? "ok" : net.net_margin_pct >= 0 ? "warn" : "bad";
  const rows = monthly.filter((r) => !r.future).map((r) => ({
    label: r.label, key: r.key, billed: r.billed, expenses: r.expenses ?? 0,
    net_revenue: r.net_revenue ?? r.billed - (r.expenses ?? 0), net_profit: r.net_profit ?? r.billed - r.cost - (r.expenses ?? 0),
  }));
  return (
    <Panel title="Net revenue" hint="net revenue = billed − expenses · net profit also takes off people cost"
      action={<Chip state={state}>{pct(net.net_margin_pct, 0)} net profit</Chip>}>
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <MiniStat k="Billed" v={inrCompact(net.billed)} />
        <MiniStat k="Expenses" v={inrCompact(net.expenses)} hint={`${pct(net.expense_ratio_pct, 0)} of billed`} />
        <MiniStat k="Net revenue" v={inrCompact(net.net_revenue)} tone={net.net_revenue >= 0 ? "ok" : "bad"} />
        <MiniStat k="Net profit" v={inrCompact(net.net_profit)} tone={state} hint={`after ${inrCompact(net.people_cost)} people cost`} />
      </div>
      <FilteredBars rowFilter rowLabel="Months" format={inrCompact} height={200} data={rows}
        series={[{ key: "billed", label: "Billed", color: 0, defaultOff: true },
                 { key: "expenses", label: "Expenses", color: 5 },
                 { key: "net_revenue", label: "Net revenue", color: 2 },
                 { key: "net_profit", label: "Net profit", color: 1 }]} />
      {net.by_category.length > 0 ? (
        <p className="mt-3 text-xs text-secondary">
          Biggest expenses: {net.by_category.slice(0, 4).map((c) => `${c.category} ${inrCompact(c.amount)}`).join(" · ")}
        </p>
      ) : <p className="mt-3 text-xs text-muted">No expenses recorded for this period — Finance adds them under Expenses.</p>}
    </Panel>
  );
}

export function TdsCollectionPanel({ tds }: { tds: TdsData | null | undefined }) {
  if (!tds) return null;
  const late = (tds.oldest_pending_days ?? 0) > 90;
  return (
    <Panel title="TDS collection" hint="withheld by customers on our invoices · Form 16A received · still pending"
      action={<Chip state={tds.pending > 0 ? (late ? "bad" : "warn") : "ok"}>{inrCompact(tds.pending)} pending</Chip>}>
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <MiniStat k="Deducted" v={inrCompact(tds.deducted)} hint={`on ${tds.deducted_invoices} invoice(s) of the period`} />
        <MiniStat k="Received" v={inrCompact(tds.received)} tone="ok" hint="certificates received in the period" />
        <MiniStat k="Pending from clients" v={inrCompact(tds.pending)} tone={tds.pending > 0 ? "warn" : "ok"}
          hint={`${tds.pending_count} record(s), as of today`} />
        <MiniStat k="Oldest pending" v={tds.oldest_pending_days === null ? "—" : `${tds.oldest_pending_days} d`}
          tone={late ? "bad" : undefined} />
      </div>
      <FilteredBars rowFilter rowLabel="Months" format={inrCompact} height={180} data={tds.monthly}
        barLink={() => "tds"} clickHint="Click a bar: the TDS register"
        series={[{ key: "deducted", label: "Deducted", color: 3 }, { key: "received", label: "Received", color: 2 }]} />
      {tds.pending_by_customer.length > 0 && (
        <p className="mt-3 text-xs text-secondary">
          Pending most: {tds.pending_by_customer.slice(0, 3).map((c) => `${c.customer} ${inrCompact(c.amount)}`).join(" · ")}
        </p>
      )}
    </Panel>
  );
}
