/**
 * Hiring control tower (23 Sep 2026) — the Sales → TA section at the top of
 * the CRM Dashboard, over `GET /api/dashboard/hiring`.
 *
 * Every number is computed on the server (see B-V2 `services/hiring_dashboard.py`
 * for the definitions); this file only lays them out. The layout follows the
 * "daily fulfilment recovery control" the business runs by hand today: a KPI
 * strip, two pace gauges (Sales pipeline · TA fulfilment) against the
 * quarter's targets, then the trend, the position funnel, active customers
 * and the hiring-stage delays.
 *
 * Rules kept from the rest of the dashboard: colour means STATE (ok / warn /
 * bad), brand blue stays on links and actions; every tile links to the list
 * that produced it; an empty section says what "empty" means. Customer-closed
 * positions are shown BESIDE the fulfilled count and never added to it — the
 * business asked for exactly that split.
 *
 * ⚠️ `inputCls` ends in `w-full`, so controls here use the local `CONTROL`
 * class (no width) — the same trap the Revenue page documents.
 */
import React, { useMemo, useState } from "react";
import { RefreshCw, Target } from "lucide-react";
import { crmPut, qs } from "../../api";
import { useHasRole, useMe } from "../../CrmApp";
import { ErrorBox, Field, Modal, SkeletonText, btnPrimary, btnSecondary, inputCls, useToast } from "../../components/ui";
import {
  CONTROL, DateStepper, FilteredBars, ICON_BTN, MiniStat, PERIODS, Panel, PeriodSwitcher, STATE_CHIP, Speedometer,
  Tile, num, shiftMonthKey, thisMonthKey,
} from "../../components/controlTower";
import type { PeriodKind, StateTone } from "../../components/controlTower";

export type { PeriodKind } from "../../components/controlTower";
import { useDeskData } from "./DeskWidgets";

/* ---------- Backend response shape (services/hiring_dashboard.py) ---------- */

type PaceState = StateTone;

export type Pace = {
  actual: number; target: number | null; gap: number | null; attainment_pct: number | null;
  is_current: boolean;
  working_days_total: number; working_days_elapsed: number; working_days_left: number;
  current_per_week: number; required_per_week: number | null; acceleration: number | null;
  state: PaceState;
};

type RoleTarget = { quarter: number | null; default_quarter: number | null; period: number | null; source: string };

type SeriesPoint = {
  key: string; label: string; positions_in: number; opportunities: number; onboardings: number;
  fulfilled: number; customer_closed: number;
};

export type CustomerRow = {
  id: number; name: string; opportunities: number; open_positions: number; total_positions: number;
  joined: number; share_pct: number | null;
};

type StageRow = {
  key: string; label: string; count: number; avg_days: number; max_days: number;
  over_warn: number; over_bad: number; state: "ok" | "warn" | "bad";
};

export type HiringData = {
  as_of: string;
  period: {
    kind: PeriodKind; key: string; label: string; short_label: string; anchor_month: string;
    start: string; end: string; months: number; is_current: boolean; comparison_label: string;
    days_left: number;
  };
  kpis: {
    pipeline_positions: number; pipeline_positions_prev: number;
    opportunities: number; opportunities_prev: number;
    onboardings: number; onboardings_prev: number;
    positions_fulfilled: number; positions_customer_closed: number;
    active_positions: number; workable_positions: number; active_customers: number;
  };
  pace: { sales: Pace; fulfilment: Pace };
  targets: { quarter_key: string; quarter_label: string; sales: RoleTarget; ta: RoleTarget };
  series: SeriesPoint[];
  funnel: {
    pipeline: number; active_open: number; workable: number; awaiting_approval: number; on_hold: number;
    in_progress_joined: number; fulfilled: number; customer_closed: number;
  };
  customers: {
    count: number; total_open_positions: number; rows: CustomerRow[];
    others: { count: number; open_positions: number };
    largest: { name: string; open_positions: number; share_pct: number | null } | null;
    concentration_risk: boolean;
  };
  stage_delays: { rows: StageRow[]; warn_days: number; bad_days: number; total_waiting: number };
  rules: { workable_statuses: string[]; customer_closed_excluded_from_closed_count: boolean };
};

/* ---------- small helpers ---------- */

const perWeek = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Number(n).toFixed(2)}/wk`);

/* ---------- atoms ---------- */

/** "+3 vs last quarter" in words, never a bare percentage (these are counts). */
function Change({ now, prev, label }: { now: number; prev: number; label: string }) {
  const d = now - prev;
  const cls = d > 0 ? "text-success" : d < 0 ? "text-danger" : "text-muted";
  return (
    <span className={`font-semibold tabular-nums ${cls}`}>
      {d > 0 ? "+" : ""}{num(d)} <span className="font-normal text-muted">{label} ({num(prev)})</span>
    </span>
  );
}

/* ---------- the gauge ---------- */

/** The pace dial: needle = CURRENT pace per week on a red→amber→green band, flag = REQUIRED pace.
 *  Colourful on purpose (CEO ask, 28 Sep 2026) — `Speedometer` is shared with the CEO dashboard. */
export function PaceGauge({ pace, label }: { pace: Pace; label: string }) {
  const current = pace.current_per_week || 0;
  const required = pace.required_per_week ?? 0;
  const scaleMax = Math.max(1, Math.ceil(Math.max(current, required) * 1.25 * 10) / 10);
  return (
    <Speedometer
      value={current}
      max={scaleMax}
      marker={pace.required_per_week}
      markerLabel="need"
      state={pace.state}
      label={label}
      caption="current / week"
      format={(v) => v.toFixed(2)}
      ariaLabel={`${label}: current pace ${perWeek(current)}, required ${perWeek(pace.required_per_week)}`}
    />
  );
}

export function PaceCard({ title, pace, targetLabel, unit, periodLabel, comparison }: {
  title: string; pace: Pace; targetLabel: string; unit: string; periodLabel: string;
  comparison: React.ReactNode;
}) {
  const state = pace.state;
  const headline = pace.target === null
    ? "No target set for this period — set one from Targets."
    : !pace.is_current
      ? (pace.gap === 0 ? `Target met in ${periodLabel}.` : `Closed ${num(pace.gap)} ${unit} short in ${periodLabel}.`)
      : pace.gap === 0
        ? "Target reached — anything more is upside."
        : pace.required_per_week === null
          ? `No working days left; ${num(pace.gap)} ${unit} short.`
          : `Needs ${perWeek(pace.required_per_week)} for the remaining ${pace.working_days_left} working days`
            + (pace.acceleration !== null ? ` — ${pace.acceleration.toFixed(2)}× the current pace.` : ".");
  return (
    <Panel
      title={title}
      action={
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP[state]}`}>
          {targetLabel} {pace.target === null ? "—" : num(pace.target)}
        </span>
      }
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,15rem),1fr] md:items-center">
        <PaceGauge pace={pace} label={title} />
        <div className="grid grid-cols-2 gap-2">
          <MiniStat k="Current" v={<>{num(pace.actual)}<span className="text-muted"> / {pace.target === null ? "—" : num(pace.target)}</span></>} />
          <MiniStat k="Gap" v={pace.gap === null ? "—" : num(pace.gap)} tone={pace.gap === 0 ? "ok" : undefined} />
          <MiniStat k="Current pace" v={perWeek(pace.current_per_week)} />
          <MiniStat k="Required pace" v={perWeek(pace.required_per_week)} tone={state === "none" ? undefined : state} />
          <p className="col-span-2 text-xs leading-relaxed text-secondary">{headline}</p>
          <p className="col-span-2 text-xs text-muted">
            {pace.working_days_elapsed} / {pace.working_days_total} working days elapsed · {comparison}
          </p>
        </div>
      </div>
    </Panel>
  );
}

/* ---------- charts ----------
 * Every chart is a `FilteredBars` (28 Sep 2026): the CEO dashboard's bar chart
 * with series ticks and a row list, so a Sales Head and the CEO read the same
 * picture. The data shaping lives here so the panels stay one line each. */

/** The funnel as bar rows — one row per stage, snapshot of today. */
export function funnelRows(f: HiringData["funnel"]) {
  return [
    { label: "Pipeline", positions: f.pipeline },
    { label: "Open to fill", positions: f.active_open },
    { label: "Workable by TA", positions: f.workable },
    { label: "Joined so far", positions: f.in_progress_joined },
    { label: "Awaiting approval", positions: f.awaiting_approval },
    { label: "On hold", positions: f.on_hold },
  ];
}

/** Active customers as bar rows (+ "Others (N)" when the server folded some). */
export function customerRows(c: HiringData["customers"]) {
  const rows = c.rows.map((r) => ({ label: r.name, open: r.open_positions, joined: r.joined, positions: r.total_positions, opportunities: r.opportunities }));
  if (c.others.count > 0) rows.push({ label: `Others (${c.others.count})`, open: c.others.open_positions, joined: 0, positions: 0, opportunities: 0 });
  return rows;
}

/** Stage delays as bar rows: waiting · over the amber line · over the red line · average days. */
export function stageRows(d: HiringData["stage_delays"]) {
  return d.rows.map((r) => ({ label: r.label, waiting: r.count, over_warn: r.over_warn, over_bad: r.over_bad, avg_days: r.avg_days }));
}

/* ---------- targets modal ---------- */

function TargetsModal({ data, onClose, onSaved }: { data: HiringData; onClose: () => void; onSaved: (msg: string) => void }) {
  const t = data.targets;
  const str = (v: number | null) => (v === null ? "" : String(v));
  const [salesQ, setSalesQ] = useState(str(t.sales.quarter));
  const [taQ, setTaQ] = useState(str(t.ta.quarter));
  const [salesD, setSalesD] = useState(str(t.sales.default_quarter));
  const [taD, setTaD] = useState(str(t.ta.default_quarter));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const parse = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));

  const save = async () => {
    const values = { sales_quarter: parse(salesQ), ta_quarter: parse(taQ), sales_default: parse(salesD), ta_default: parse(taD) };
    if (Object.values(values).some((v) => v !== null && (!Number.isFinite(v) || v < 0))) {
      setErr("Targets must be positive numbers."); return;
    }
    setSaving(true); setErr("");
    try {
      // One write: values set, blanks clear. The server echoes the resolved targets.
      await crmPut("/api/dashboard/hiring/targets", {
        quarter: t.quarter_key,
        ...Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null)),
        clear: Object.entries(values).filter(([, v]) => v === null).map(([k]) => k),
      });
      onSaved("Hiring targets saved");
    } catch (e: any) {
      setErr(e?.message || "Could not save targets");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Hiring targets"
      onClose={onClose}
      dirty={salesQ !== str(t.sales.quarter) || taQ !== str(t.ta.quarter) || salesD !== str(t.sales.default_quarter) || taD !== str(t.ta.default_quarter)}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={btnPrimary} onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save targets"}</button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-secondary">
          Targets are per financial-year quarter. A month reads a third of its quarter and the FY view adds its four quarters,
          so the three zooms always agree. Leave a field blank to remove that target.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Sales — positions for ${t.quarter_key}`}>
            <input className={inputCls} inputMode="numeric" value={salesQ} onChange={(e) => setSalesQ(e.target.value)} placeholder="e.g. 85" />
          </Field>
          <Field label={`TA — onboardings for ${t.quarter_key}`}>
            <input className={inputCls} inputMode="numeric" value={taQ} onChange={(e) => setTaQ(e.target.value)} placeholder="e.g. 18" />
          </Field>
          <Field label="Sales — default per quarter (when a quarter has no override)">
            <input className={inputCls} inputMode="numeric" value={salesD} onChange={(e) => setSalesD(e.target.value)} placeholder="e.g. 60" />
          </Field>
          <Field label="TA — default per quarter">
            <input className={inputCls} inputMode="numeric" value={taD} onChange={(e) => setTaD(e.target.value)} placeholder="e.g. 15" />
          </Field>
        </div>
        <p className="text-xs text-muted">{t.quarter_label}</p>
        {err && <div className="text-sm text-danger">{err}</div>}
      </div>
    </Modal>
  );
}

/* ---------- controls ---------- */

/* ---------- the section ---------- */

/** Roles that read the control tower. HR and Finance desks are about people
 *  and money, not the Sales → TA funnel, so a pure HR/Finance login skips it;
 *  a custom role (any other name) reaches it exactly like a templated user —
 *  the server gate is the "dashboard" tab, which every template carries. */
const SKIP_ONLY_ROLES = new Set(["HR", "Finance"]);

export function useShowsHiringTower(): boolean {
  const me = useMe();
  const roles: string[] = me.roles || [];
  return roles.some((r) => !SKIP_ONLY_ROLES.has(r));
}

export function HiringControlTower() {
  const canSetTargets = useHasRole("Sales_Head");
  const [period, setPeriod] = useState<PeriodKind>("quarter");
  const [month, setMonth] = useState<string>(thisMonthKey());
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [toast, showToast] = useToast();

  const url = `/api/dashboard/hiring${qs({ month, period })}`;
  const { data, loading, error, retry } = useDeskData<HiringData>(url);
  const atCurrent = useMemo(() => {
    if (!data) return month >= thisMonthKey();
    return data.period.is_current || data.period.end >= new Date().toISOString().slice(0, 10);
  }, [data, month]);

  return (
    <section className="space-y-4" aria-label="Hiring control tower">
      {toast}
      {/* Header: title + zoom + anchor + actions in ONE card, so it never wraps into three loose rows. */}
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-subtle bg-surface-1 px-5 py-3 shadow-raised">
        <div className="min-w-0">
          <h2 className="text-display text-base font-bold text-primary">Hiring control tower</h2>
          <p className="text-xs text-muted">
            {data ? `${data.period.label} · as of ${data.as_of}` : "Sales pipeline → TA fulfilment, one page"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodSwitcher value={period} onChange={setPeriod} />
          <DateStepper month={month} period={period} atCurrent={atCurrent} onShift={(d) => setMonth((m) => shiftMonthKey(m, d))} onPick={setMonth} />
          {canSetTargets && (
            <button type="button" className={`${CONTROL} inline-flex items-center gap-1.5 font-semibold`} onClick={() => setTargetsOpen(true)} disabled={!data}>
              <Target className="h-4 w-4" aria-hidden /> Targets
            </button>
          )}
          <button type="button" className={ICON_BTN} onClick={retry} aria-label="Refresh" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
          </button>
        </div>
      </header>

      {error && <ErrorBox error={error} onRetry={retry} />}
      {!data && !error && (
        <div className="rounded-card border border-subtle bg-surface-1 p-5 shadow-raised"><SkeletonText lines={4} /></div>
      )}

      {data && (
        <>
          {/* Row 1 — the KPI strip. Every tile links to the list that produced it. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
            <Tile label="Pipeline positions" value={num(data.kpis.pipeline_positions)} to="opportunities"
              sub={<Change now={data.kpis.pipeline_positions} prev={data.kpis.pipeline_positions_prev} label={data.period.comparison_label} />} />
            <Tile label="Opportunities" value={num(data.kpis.opportunities)} to="opportunities"
              sub={<Change now={data.kpis.opportunities} prev={data.kpis.opportunities_prev} label={data.period.comparison_label} />} />
            <Tile label="Onboardings" value={num(data.kpis.onboardings)} to="profiles" tone="success"
              sub={<Change now={data.kpis.onboardings} prev={data.kpis.onboardings_prev} label={data.period.comparison_label} />} />
            <Tile label="Positions closed" value={num(data.kpis.positions_fulfilled)} to="opportunities" tone="success"
              sub={<><span className="font-semibold text-primary">{num(data.kpis.positions_customer_closed)}</span> closed by customer — not counted</>} />
            <Tile label="Active positions" value={num(data.kpis.active_positions)} to="opportunities" tone="warning" sub="open right now, all statuses" />
            <Tile label="Workable positions" value={num(data.kpis.workable_positions)} to="opportunities" tone="warning" sub="approved & not on hold — TA can source" />
            <Tile label="Active customers" value={num(data.kpis.active_customers)} to="customers" tone="neutral"
              sub={data.customers.largest ? <>largest: <span className="font-semibold text-primary">{data.customers.largest.name}</span></> : "no live deals"} />
            <Tile label={data.period.is_current ? "Days left" : "Period"} value={data.period.is_current ? num(data.period.days_left) : data.period.short_label} to="calendar" tone="neutral"
              sub={data.period.is_current ? `in ${data.period.short_label}` : "closed period"} />
          </div>

          {/* Row 2 — the two gauges: are we on pace? */}
          <div className="grid gap-4 xl:grid-cols-2">
            <PaceCard title="Sales pace" pace={data.pace.sales} targetLabel="Target" unit="positions" periodLabel={data.period.short_label}
              comparison={<>positions brought in {data.period.comparison_label.replace("vs ", "vs ")}: {num(data.kpis.pipeline_positions_prev)}</>} />
            <PaceCard title="Fulfilment pace" pace={data.pace.fulfilment} targetLabel="Target" unit="onboardings" periodLabel={data.period.short_label}
              comparison={<>onboardings {data.period.comparison_label}: {num(data.kpis.onboardings_prev)}</>} />
          </div>

          {/* Row 3 — the trend: positions brought in vs onboarded, with ticks. */}
          <Panel title="Positions brought in vs onboardings" hint={`last ${data.series.length} ${PERIODS.find((p) => p.key === period)?.label.toLowerCase()}s — tick a series or a period`}>
            <FilteredBars rowFilter rowLabel={`${PERIODS.find((p) => p.key === period)?.label ?? "Period"}s`}
                          data={data.series.map((s) => ({ label: s.label, positions_in: s.positions_in, onboardings: s.onboardings, opportunities: s.opportunities, fulfilled: s.fulfilled, customer_closed: s.customer_closed }))}
                          series={[{ key: "positions_in", label: "Positions brought in", color: 0 }, { key: "onboardings", label: "Onboardings", color: 1 },
                                   { key: "opportunities", label: "Opportunities", color: 3, defaultOff: true }, { key: "fulfilled", label: "Fulfilled", color: 2, defaultOff: true },
                                   { key: "customer_closed", label: "Closed by customer", color: 7, defaultOff: true }]} />
          </Panel>

          {/* Row 4 — where the positions stand · active customers · stage delays, all bars. */}
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Where the positions stand" hint="today's snapshot, not the period"
                   action={<span className="text-xs text-muted">all time: <span className="font-semibold text-success">{num(data.funnel.fulfilled)} fulfilled</span> · {num(data.funnel.customer_closed)} closed by customer</span>}>
              <FilteredBars rowFilter rowLabel="Stages" height={220} data={funnelRows(data.funnel)}
                            series={[{ key: "positions", label: "Positions", color: 0 }]} />
            </Panel>
            <Panel
              title="Active customers"
              hint={`${num(data.customers.count)} with a live deal · ${num(data.customers.total_open_positions)} open positions`}
              action={data.customers.concentration_risk && data.customers.largest ? (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP.warn}`} title="One customer holds half or more of the open positions">
                  {data.customers.largest.name} {data.customers.largest.share_pct}%
                </span>
              ) : undefined}
            >
              {data.customers.rows.length ? (
                <FilteredBars rowFilter rowLabel="Customers" height={220} data={customerRows(data.customers)}
                              series={[{ key: "open", label: "Open", color: 5 }, { key: "joined", label: "Joined", color: 2 },
                                       { key: "positions", label: "Total positions", color: 7, defaultOff: true }, { key: "opportunities", label: "Opportunities", color: 3, defaultOff: true }]} />
              ) : (
                <p className="text-sm text-muted">No customer has a live, approved opportunity right now.</p>
              )}
            </Panel>
          </div>

          <Panel title="Hiring stage delays" hint={`${num(data.stage_delays.total_waiting)} candidates waiting right now · amber ≥ ${data.stage_delays.warn_days} days · red ≥ ${data.stage_delays.bad_days} days at the same stage`}
                 action={data.stage_delays.total_waiting ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP[data.stage_delays.rows.some((r) => r.state === "bad") ? "bad" : data.stage_delays.rows.some((r) => r.state === "warn") ? "warn" : "ok"]}`}>{num(data.stage_delays.total_waiting)} waiting</span> : undefined}>
            {data.stage_delays.total_waiting ? (
              <FilteredBars rowFilter rowLabel="Stages" height={220} data={stageRows(data.stage_delays)}
                            series={[{ key: "waiting", label: "Waiting", color: 0 }, { key: "over_warn", label: `Over ${data.stage_delays.warn_days} d`, color: 6 },
                                     { key: "over_bad", label: `Over ${data.stage_delays.bad_days} d`, color: 5 }, { key: "avg_days", label: "Avg days", color: 7, defaultOff: true }]} />
            ) : (
              <p className="text-sm text-muted">Nobody is waiting at an interview, offer or joining stage right now.</p>
            )}
          </Panel>
        </>
      )}

      {targetsOpen && data && (
        <TargetsModal
          data={data}
          onClose={() => setTargetsOpen(false)}
          onSaved={(msg) => { setTargetsOpen(false); showToast(msg, "ok"); retry(); }}
        />
      )}
    </section>
  );
}
