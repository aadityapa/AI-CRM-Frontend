/**
 * Purchase orders to renew (29 Sep 2026, user ask: "show this on the Dashboard in
 * a proper manner"). It replaces the one-line amber strip "Purchase Orders
 * expiring within 45 days (12) · already expired (43) — Show details", which also
 * shipped two dead alpha classes (`border-warning/40`, `bg-warning-soft/60`) and
 * so rendered as a plain grey bar.
 *
 * ONE call, `GET /api/purchase-orders/reports/expiry?days=45` (unchanged). The
 * panel has:
 *  - three stat tiles: expiring within 45 days (amber), already expired (red) and
 *    the next PO to lapse. The first two switch the list below.
 *  - a searchable list per group: PO number (link), customer, end date, a days
 *    chip, a used bar (consumed of total) and the balance left.
 *  - six rows at a time with "Show all N". The whole panel can be collapsed, and
 *    that choice is remembered per browser.
 * Expiring POs sort soonest first. Expired POs sort most recently lapsed first:
 * a PO that ran out last week is usually still being billed against, while one
 * that lapsed a year ago is history.
 */
import { useMemo, useState } from "react";
import { AlarmClock, ChevronDown, FileWarning, Search, ShieldAlert, TimerOff } from "lucide-react";

import { fmtDateShort } from "../../../lib/datetime";
import { CONTROL, ICON_BTN, inrCompact } from "../../components/controlTower";
import { CrmLink } from "../../router";
import { useDeskData } from "./DeskWidgets";

export type PoExpiryRow = {
  id: number; po_number: string; customer_name: string; end_date: string;
  balance_value?: number | null; total_value?: number | null;
  days_left?: number; days_overdue?: number;
};
type Payload = { expired: PoExpiryRow[]; expiring_soon: PoExpiryRow[] };
type Group = "soon" | "expired";

export const PO_EXPIRY_DAYS = 45;
const ROWS = 6;
const OPEN_KEY = "crm.dash.poExpiry.open";

function readOpen(): boolean {
  try { return window.localStorage.getItem(OPEN_KEY) !== "0"; } catch { return true; }
}
function writeOpen(v: boolean) {
  try { window.localStorage.setItem(OPEN_KEY, v ? "1" : "0"); } catch { /* per-browser convenience only */ }
}

const sum = (rows: PoExpiryRow[]) => rows.reduce((n, r) => n + (Number(r.balance_value) || 0), 0);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Days chip: red when expired or within a week, amber within 45 days. */
export function daysChip(r: PoExpiryRow): { text: string; cls: string } {
  if (r.days_overdue != null) {
    return { text: r.days_overdue === 0 ? "Expired today" : `Expired ${plural(r.days_overdue, "day")} ago`,
             cls: "bg-danger-soft text-danger" };
  }
  const d = r.days_left ?? 0;
  return { text: d === 0 ? "Expires today" : `In ${plural(d, "day")}`,
           cls: d <= 7 ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning" };
}

function usedPct(r: PoExpiryRow): number | null {
  const total = Number(r.total_value) || 0;
  if (total <= 0 || r.balance_value == null) return null;
  return Math.max(0, Math.min(100, Math.round(((total - Number(r.balance_value)) / total) * 100)));
}

function StatTile({ icon, label, value, sub, tone, active, onClick }: {
  icon: React.ReactNode; label: string; value: string; sub: string;
  tone: "warn" | "bad" | "info"; active?: boolean; onClick?: () => void;
}) {
  const accent = tone === "bad" ? "from-rose-500 to-red-600" : tone === "warn" ? "from-amber-500 to-orange-600"
    : "from-sky-500 to-blue-600";
  const body = (
    <>
      <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accent}`} aria-hidden />
      <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-gradient-to-br text-white shadow-raised ${accent}`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-muted">{label}</span>
        <span className="block truncate text-xl font-bold leading-7 tabular-nums text-primary">{value}</span>
        <span className="block truncate text-xs text-secondary">{sub}</span>
      </span>
    </>
  );
  const cls = `relative flex items-center gap-3 overflow-hidden rounded-card border px-4 py-3 text-left transition-all duration-micro ${
    active ? "border-brand-500 bg-surface-1 shadow-overlay ring-2 ring-brand-500" : "border-subtle bg-surface-2"}`;
  return onClick
    ? <button type="button" aria-pressed={active} onClick={onClick} className={`${cls} fx-lift hover:border-brand-500`}>{body}</button>
    : <div className={cls}>{body}</div>;
}

export function PoExpiryPanel() {
  const { data, loading, error } = useDeskData<Payload>(`/api/purchase-orders/reports/expiry?days=${PO_EXPIRY_DAYS}`);
  const [open, setOpen] = useState(readOpen);
  const [picked, setPicked] = useState<Group | null>(null);
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);

  const soon = useMemo(() => [...(data?.expiring_soon ?? [])].sort((a, b) => (a.days_left ?? 0) - (b.days_left ?? 0)), [data]);
  const expired = useMemo(() => [...(data?.expired ?? [])].sort((a, b) => (a.days_overdue ?? 0) - (b.days_overdue ?? 0)), [data]);
  const group: Group = picked ?? (soon.length ? "soon" : "expired");
  const rows = group === "soon" ? soon : expired;
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? rows.filter((r) => `${r.po_number} ${r.customer_name}`.toLowerCase().includes(needle))
    : rows;
  const visible = all ? shown : shown.slice(0, ROWS);

  // A login that cannot read POs (the endpoint 403s) simply gets no panel.
  if (error) return null;
  if (!data) {
    return loading ? <div className="h-28 animate-pulse rounded-card border border-subtle bg-surface-1" aria-hidden /> : null;
  }
  if (!soon.length && !expired.length) return null;
  const next = soon[0];
  const toggle = () => { setOpen((v) => { writeOpen(!v); return !v; }); };
  const pick = (g: Group) => { setPicked(g); setAll(false); };

  return (
    <section className="relative overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised"
      aria-label="Purchase orders to renew">
      <span className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${expired.length ? "from-rose-500 to-amber-500" : "from-amber-500 to-orange-500"}`} aria-hidden />
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-gradient-to-br from-amber-500 to-rose-500 text-white shadow-raised">
            <FileWarning className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-display text-base font-bold text-primary">Purchase orders to renew</h2>
            <p className="text-xs text-muted">
              {soon.length ? `${plural(soon.length, "PO")} ending within ${PO_EXPIRY_DAYS} days` : "Nothing ending soon"}
              {expired.length ? ` · ${expired.length} already expired` : ""}
              {" — renew before billing stops"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CrmLink to="pos" className="rounded-control border border-subtle bg-surface-2 px-3 py-1.5 text-xs font-bold text-primary hover:border-brand-500">
            All purchase orders
          </CrmLink>
          <button type="button" className={ICON_BTN} onClick={toggle} aria-expanded={open}
            aria-label={open ? "Collapse" : "Expand"} title={open ? "Collapse" : "Expand"}>
            <ChevronDown className={`h-4 w-4 transition-transform duration-micro ${open ? "rotate-180" : ""}`} aria-hidden />
          </button>
        </div>
      </header>

      {open && (
        <div className="space-y-4 border-t border-subtle px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile icon={<AlarmClock className="h-5 w-5" aria-hidden />} tone="warn"
              label={`Ending in ${PO_EXPIRY_DAYS} days`} value={String(soon.length)}
              sub={soon.length ? `${inrCompact(sum(soon))} balance still to bill` : "None — nothing to chase"}
              active={group === "soon"} onClick={soon.length ? () => pick("soon") : undefined} />
            <StatTile icon={<TimerOff className="h-5 w-5" aria-hidden />} tone="bad"
              label="Already expired" value={String(expired.length)}
              sub={expired.length ? `${inrCompact(sum(expired))} left unused` : "None"}
              active={group === "expired"} onClick={expired.length ? () => pick("expired") : undefined} />
            <StatTile icon={<ShieldAlert className="h-5 w-5" aria-hidden />} tone="info"
              label="Next to lapse" value={next ? next.po_number : "—"}
              sub={next ? `${next.customer_name} · ${daysChip(next).text.toLowerCase()}` : "No PO ending soon"} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-primary">
              {group === "soon" ? `Ending within ${PO_EXPIRY_DAYS} days — soonest first` : "Expired — most recent first"}
            </p>
            <label className="relative">
              <span className="sr-only">Search purchase orders</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <input type="text" className={`${CONTROL} w-56 pl-8`} placeholder="PO number or customer"
                value={q} onChange={(e) => { setQ(e.target.value); setAll(false); }} />
            </label>
          </div>

          <div className="overflow-x-auto rounded-card border border-subtle">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface-2">
                <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted">
                  <th className="px-3 py-2">PO</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">End date</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Used</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const chip = daysChip(r);
                  const used = usedPct(r);
                  return (
                    <tr key={r.id} className="border-t border-subtle hover:bg-surface-2">
                      <td className="px-3 py-2.5">
                        <CrmLink to={`pos/${r.id}`} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
                          {r.po_number}
                        </CrmLink>
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-2.5 text-secondary" title={r.customer_name}>{r.customer_name}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-secondary">{fmtDateShort(r.end_date)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${chip.cls}`}>{chip.text}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        {used == null ? <span className="text-muted">—</span> : (
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                              <span className={`block h-full rounded-full ${used >= 90 ? "bg-danger" : "bg-brand-500"}`} style={{ width: `${used}%` }} />
                            </span>
                            <span className="text-xs tabular-nums text-secondary">{used}%</span>
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-primary">
                        {r.balance_value == null ? "—" : inrCompact(r.balance_value)}
                      </td>
                    </tr>
                  );
                })}
                {!visible.length && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-muted">No purchase order matches “{q}”.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {shown.length > ROWS && (
            <button type="button" className="text-xs font-bold text-brand-700 hover:underline dark:text-brand-300"
              onClick={() => setAll((v) => !v)}>
              {all ? "Show fewer" : `Show all ${shown.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
