/**
 * Received Amount, branch by branch (24 Nov 2026, user ask with a screenshot of
 * VISTEON's Received Amount tab: "we need this placed branch-wise, currently all
 * in one"). One card per branch of the customer — what it paid, how much is
 * still on account, TDS pending — and an "All branches" card. A card narrows
 * the list to that branch; a second click lets go.
 */
import { AlertTriangle, Layers, List, MapPin, X } from "lucide-react";
import { inr } from "./receiptShared";

/** `null` = every branch · `0` = no branch on record · else the branch id. */
export type BranchPick = number | null;

export type BranchTotal = {
  key: number;          // branch id, 0 = no branch on record
  name: string;
  receipts: number;
  received: number;
  onAccount: number;
  tdsPending: number;
  last: string | null;  // the latest received date
};

type Row = {
  branch_id?: number | null; branch_name?: string | null; amount?: number | string | null;
  unallocated_amount?: number | string | null; tds_pending?: number | string | null;
  received_date?: string | null;
};

/** PURE — one total per branch: named branches by what they paid (largest
 *  first), "No branch on record" last. */
export function branchTotals(rows: Row[]): BranchTotal[] {
  const by = new Map<number, BranchTotal>();
  for (const r of rows) {
    const key = Number(r.branch_id || 0);
    const t = by.get(key) || {
      key, name: key ? (r.branch_name || `Branch #${key}`) : "No branch on record",
      receipts: 0, received: 0, onAccount: 0, tdsPending: 0, last: null,
    };
    t.receipts += 1;
    t.received += Number(r.amount || 0);
    t.onAccount += Number(r.unallocated_amount || 0);
    t.tdsPending += Number(r.tds_pending || 0);
    if (r.received_date && (!t.last || r.received_date > t.last)) t.last = r.received_date;
    by.set(key, t);
  }
  return [...by.values()].sort((a, b) => (a.key === 0 ? 1 : 0) - (b.key === 0 ? 1 : 0)
    || b.received - a.received || a.name.localeCompare(b.name));
}

/** PURE — the "All branches" card. */
export function allTotal(totals: BranchTotal[]): Omit<BranchTotal, "key" | "name"> {
  return totals.reduce((a, t) => ({
    receipts: a.receipts + t.receipts, received: a.received + t.received,
    onAccount: a.onAccount + t.onAccount, tdsPending: a.tdsPending + t.tdsPending,
    last: !a.last || (t.last && t.last > a.last) ? t.last : a.last,
  }), { receipts: 0, received: 0, onAccount: 0, tdsPending: 0, last: null as string | null });
}

function Card({ active, onClick, name, icon, t, share, warn }: {
  active: boolean; onClick: () => void; name: string; icon: React.ReactNode;
  t: Omit<BranchTotal, "key" | "name">; share?: number; warn?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`group flex min-w-0 flex-col gap-1.5 rounded-card border p-3 text-left transition-all duration-micro ${
        active
          ? "border-teal-500 bg-teal-50 ring-2 ring-teal-500/40 dark:border-teal-400 dark:bg-teal-950/40"
          : warn
            ? "border-amber-300 bg-amber-50/60 hover:border-amber-400 dark:border-amber-800 dark:bg-amber-950/30"
            : "border-subtle bg-surface-1 hover:border-teal-300 hover:shadow-raised dark:hover:border-teal-700"}`}>
      <span className="flex items-center gap-1.5">
        {icon}
        <span className="truncate text-sm font-bold text-primary" title={name}>{name}</span>
        <span className="ml-auto shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-secondary">
          {t.receipts} receipt{t.receipts === 1 ? "" : "s"}
        </span>
      </span>
      <span className="text-lg font-extrabold tabular-nums text-primary">{inr(t.received)}</span>
      {share != null && (
        <span className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <span className="block h-full rounded-full bg-teal-500" style={{ width: `${Math.max(2, Math.min(100, share))}%` }} />
        </span>
      )}
      <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        {t.onAccount > 0
          ? <span className="font-semibold text-amber-700 dark:text-amber-300">{inr(t.onAccount)} on account</span>
          : <span className="text-emerald-700 dark:text-emerald-300">All mapped</span>}
        {t.tdsPending > 0 && <span className="text-amber-700 dark:text-amber-300">TDS {inr(t.tdsPending)} pending</span>}
        {t.last && <span className="text-muted">last {fmtShort(t.last)}</span>}
      </span>
    </button>
  );
}

function fmtShort(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** "By branch / One list" — how the customer's receipts are laid out. */
export function BranchModeToggle({ mode, onChange }: { mode: "branch" | "flat"; onChange: (m: "branch" | "flat") => void }) {
  const seg = (m: "branch" | "flat", label: string, icon: React.ReactNode) => (
    <button type="button" role="radio" aria-checked={mode === m} onClick={() => onChange(m)}
      className={`inline-flex items-center gap-1.5 rounded-control px-2.5 py-1 text-xs font-semibold transition-colors ${
        mode === m ? "bg-teal-600 text-[#fff] shadow-raised" : "text-secondary hover:bg-surface-2"}`}>
      {icon} {label}
    </button>
  );
  return (
    <span role="radiogroup" aria-label="Show receipts" className="inline-flex rounded-control border border-subtle bg-surface-1 p-0.5">
      {seg("branch", "By branch", <MapPin size={13} aria-hidden />)}
      {seg("flat", "One list", <List size={13} aria-hidden />)}
    </span>
  );
}

/** The branch a card narrowed the list to, with a clear button. */
export function PickChip({ pick, totals, onClear }: { pick: number; totals: BranchTotal[]; onClear: () => void }) {
  const name = totals.find((t) => t.key === pick)?.name || (pick ? `Branch #${pick}` : "No branch on record");
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 py-0.5 pl-2.5 pr-1 text-xs font-semibold text-teal-800 ring-1 ring-inset ring-teal-300 dark:bg-teal-950/40 dark:text-teal-200 dark:ring-teal-800">
      <MapPin size={11} aria-hidden /> Only {name}
      <button type="button" onClick={onClear} aria-label="Show every branch"
        className="rounded-full p-0.5 hover:bg-teal-100 dark:hover:bg-teal-900">
        <X size={12} aria-hidden />
      </button>
    </span>
  );
}

/** The strip of branch cards above the customer's received amounts. */
export function BranchSummary({ totals, pick, onPick, loading }: {
  totals: BranchTotal[]; pick: BranchPick; onPick: (p: BranchPick) => void; loading?: boolean;
}) {
  if (loading && !totals.length) return <div className="h-24 animate-pulse rounded-card bg-surface-2" aria-hidden />;
  if (!totals.length) return null;
  const all = allTotal(totals);
  return (
    <section aria-label="Received amount by branch" className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-bold text-primary">By branch</h3>
        <span className="text-xs text-muted">
          {totals.filter((t) => t.key).length} branch{totals.filter((t) => t.key).length === 1 ? "" : "es"} paid —
          click one to see only its receipts.
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <Card active={pick == null} onClick={() => onPick(null)} name="All branches"
          icon={<Layers size={14} className="shrink-0 text-teal-600 dark:text-teal-300" aria-hidden />} t={all} />
        {totals.map((t) => (
          <Card key={t.key} active={pick === t.key} warn={t.key === 0}
            onClick={() => onPick(pick === t.key ? null : t.key)} name={t.name}
            share={all.received > 0 ? (t.received / all.received) * 100 : 0}
            icon={t.key
              ? <MapPin size={14} className="shrink-0 text-teal-600 dark:text-teal-300" aria-hidden />
              : <AlertTriangle size={14} className="shrink-0 text-amber-600 dark:text-amber-300" aria-hidden />}
            t={t} />
        ))}
      </div>
    </section>
  );
}
