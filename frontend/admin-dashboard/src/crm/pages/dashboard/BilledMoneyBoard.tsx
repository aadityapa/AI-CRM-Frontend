/**
 * The Billed page's money board (7 Nov 2026, CEO ask: "arrange the Billed page
 * properly, more attractive, best as"). The page's tiles laid out as the road the
 * money travels — Revenue → Receivable → Received → Due — with the dashboard's
 * ten money words and colours (moneySeries). Every figure is a server tile
 * (`kpis`); clicking one does exactly what its tile did (narrows the invoice
 * table to the rows behind it, `go`). Nothing is computed here but shares.
 */
import React from "react";
import { ArrowRight, CheckCircle2, Clock, Landmark, ReceiptText, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { inrCompact, num } from "../../components/controlTower";
import { moneySeriesOf, shareOf } from "./moneySeries";

export type BoardKpi = { key: string; label: string; value: number | string | null; sub?: string | null };

const val = (k?: BoardKpi) => (typeof k?.value === "number" ? k.value : Number(k?.value) || 0);

export function BilledMoneyBoard({ kpis, activeKey, onPick }: {
  kpis: BoardKpi[]; activeKey: string | null; onPick: (key: string) => void;
}) {
  const by = Object.fromEntries(kpis.map((k) => [k.key, k])) as Record<string, BoardKpi | undefined>;
  const v = (k: string) => val(by[k]);
  const recPct = shareOf(v("received_bank") + v("received_tds"), v("revenue_inc"));

  const fig = (k: string, big = false, tone?: string) => {
    const kpi = by[k];
    if (!kpi) return null;
    const s = moneySeriesOf(k);
    const color = tone ?? s?.color ?? "#2563eb";
    const on = activeKey === k;
    return (
      <button key={k} type="button" onClick={() => onPick(k)} aria-pressed={on}
        title={on ? "Showing these invoices — click again to show all" : "Show the invoices behind this figure"}
        className={`group w-full rounded-xl border bg-surface-1 px-3 py-2.5 text-left transition-all duration-micro hover:-translate-y-px hover:shadow-raised ${on ? "shadow-raised" : ""}`}
        style={{ borderColor: on ? color : "var(--border-subtle)", boxShadow: on ? `0 0 0 2px ${color}55` : undefined }}>
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />
          {kpi.label}
        </div>
        <div className={`tnum font-bold leading-tight ${big ? "text-2xl" : "text-lg"}`} style={{ color }}>
          {inrCompact(val(kpi))}
        </div>
        {kpi.sub && <div className="truncate text-[11px] text-muted">{kpi.sub}</div>}
      </button>
    );
  };

  return (
    <section className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised" aria-label="Where the money stands">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-primary">Where the money stands</h3>
          <p className="text-xs text-muted">Revenue → what the customer owes as cash and as TDS → what came in → what is still due. Click any figure to list its invoices.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {by.paid && (
            <button type="button" onClick={() => onPick("paid")} aria-pressed={activeKey === "paid"}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset transition-shadow ${activeKey === "paid" ? "ring-2" : ""} bg-success-soft text-success ring-success`}>
              <CheckCircle2 size={13} aria-hidden /> {num(val(by.paid))} fully paid
            </button>
          )}
          {by.overdue && (
            <button type="button" onClick={() => onPick("overdue")} aria-pressed={activeKey === "overdue"}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset transition-shadow ${activeKey === "overdue" ? "ring-2" : ""} bg-danger-soft text-danger ring-danger`}>
              <Clock size={13} aria-hidden /> Overdue {inrCompact(val(by.overdue))}
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr,auto,1fr,auto,1fr,auto,1fr]">
        <Stage icon={ReceiptText} title="Revenue" color="#2563eb" note={`GST ${inrCompact(v("revenue_inc") - v("revenue_ex"))}`}>
          {fig("revenue_ex", true)}
          {fig("revenue_inc")}
        </Stage>
        <Arrow />
        <Stage icon={Landmark} title="Receivable" color="#06b6d4" note="what the customer should settle">
          <ShareBar a={v("receivable_bank")} b={v("receivable_tds")} colors={["#06b6d4", "#8b5cf6"]} labels={["Bank", "TDS"]} />
          {fig("receivable_bank")}
          {fig("receivable_tds")}
        </Stage>
        <Arrow />
        <Stage icon={Wallet} title="Received" color="#10b981" note={recPct === null ? "nothing billed" : `${recPct}% of Inc Tax came in`}>
          {fig("received_ex", true)}
          <Progress label="Bank" got={v("received_bank")} of={v("receivable_bank")} color="#10b981" />
          {fig("received_bank")}
          <Progress label="TDS" got={v("received_tds")} of={v("receivable_tds")} color="#84cc16" />
          {fig("received_tds")}
        </Stage>
        <Arrow />
        <Stage icon={Clock} title="Due" color="#ef4444" note="still to come">
          {fig("due_ex", true)}
          {fig("total_due")}
          <div className="grid grid-cols-2 gap-2">
            {fig("due_bank")}
            {fig("due_tds")}
          </div>
        </Stage>
      </div>
    </section>
  );
}

function Stage({ icon: Icon, title, color, note, children }: {
  icon: LucideIcon; title: string; color: string; note: string; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl p-3" style={{ background: `linear-gradient(180deg, ${color}14, transparent 70%)`, boxShadow: `inset 0 0 0 1px ${color}33` }}>
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#fff] shadow-raised"
              style={{ background: `linear-gradient(135deg, ${color}, ${color}aa)` }}>
          <Icon size={15} aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-bold text-primary">{title}</div>
          <div className="truncate text-[11px] text-muted">{note}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function Arrow() {
  return (
    <div aria-hidden className="hidden items-center justify-center lg:flex">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-muted ring-1 ring-inset ring-subtle">
        <ArrowRight size={15} />
      </span>
    </div>
  );
}

function ShareBar({ a, b, colors, labels }: { a: number; b: number; colors: [string, string]; labels: [string, string] }) {
  const total = Math.max(a + b, 1e-9);
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div style={{ width: `${(a / total) * 100}%`, background: colors[0] }} />
        <div style={{ width: `${(b / total) * 100}%`, background: colors[1] }} />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-muted">
        <span>{labels[0]} {shareOf(a, a + b) ?? 0}%</span><span>{labels[1]} {shareOf(b, a + b) ?? 0}%</span>
      </div>
    </div>
  );
}

function Progress({ label, got, of, color }: { label: string; got: number; of: number; color: string }) {
  const p = shareOf(got, of);
  return (
    <div>
      <div className="flex justify-between text-[10px] font-semibold text-muted">
        <span>{label} received</span><span className="tnum" style={{ color }}>{p === null ? "—" : `${p}%`}</span>
      </div>
      <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full transition-all duration-panel" style={{ width: `${Math.min(100, p ?? 0)}%`, background: color }} />
      </div>
    </div>
  );
}
