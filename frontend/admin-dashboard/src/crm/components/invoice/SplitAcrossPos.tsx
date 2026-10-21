/**
 * Split one timesheet across several POs (0141, 20 Oct 2026, user flow: "a PO
 * covers only a few hours — one timesheet, two invoices on two POs").
 *
 * Each line = one PO and the share it carries: hours / days on an Hourly /
 * Daily rate, an amount (before GST) on a Monthly rate or a mid-month rate
 * change. "Fill each PO to its balance" puts as much as each PO can carry on
 * it, in order, the rest on the next. The lines may leave part of the sheet for
 * later (a PO still to come). The server re-checks everything (`plan_splits`).
 *
 * 0142 (21 Oct 2026) — split BY DATES, the default: "PO A has money for 1–29
 * March only, so 1–29 March is one invoice and 30–31 March another on PO B".
 * Each line is a PO + From / To dates; the amount is the sheet's total shared by
 * the billable days (hours on an Hourly rate) in those dates — the server's
 * `plan_date_splits`, mirrored by `dateRangeAmount`. A day strip shows which
 * part bills each day.
 */
import { Plus, Sparkles, Trash2, Wand2 } from "lucide-react";

import { inputCls } from "../ui";
import type { PoOption } from "../PoPicker";

export type BillingProgress = {
  total: number | null;
  invoiced: number;
  remaining: number | null;
  total_qty: number | null;
  remaining_qty: number | null;
  billing_unit: string | null;
  rate: number | null;
  rate_split: boolean;
  split: boolean;
  fully_billed: boolean;
  parts: Array<{
    id: number; invoice_number: string; kind: string; split_no: number | null; split_qty: number | null;
    po_id: number | null; sub_total: number | null; returned_at: string | null;
    split_start?: string | null; split_end?: string | null;
  }>;
  returned: unknown[];
};

/** 0142 — every day of the sheet with its billable weight (days, or hours on
 * an Hourly rate) and the date ranges already raised, from po-options. */
export type SplitDays = {
  start: string; end: string;
  basis: "days" | "hours";
  days: Array<{ date: string; weight: number }>;
  taken: Array<{ start: string; end: string; split_no: number; invoice_number: string }>;
};

/** How the GM splits: by DATES (1–29 Mar on PO A, 30–31 Mar on PO B) or by
 * hours / amount. */
export type SplitBy = "dates" | "amount";

export type SplitRow = { key: string; po_id: number | null; qty: string; amount: string; start: string; end: string };

const QTY_UNITS = new Set(["Hourly", "Daily"]);
let seq = 0;
export const newSplitRow = (po_id: number | null = null): SplitRow =>
  ({ key: `s${++seq}`, po_id, qty: "", amount: "", start: "", end: "" });

/* ------------------------------------------------------- split by dates (PURE) */

/** "2026-03-29" + n days, in local date maths (never UTC). PURE. */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

const wholeWeight = (sd: SplitDays) => sd.days.reduce((s, d) => s + d.weight, 0);

/** Billable weight and calendar days between two dates (inclusive). PURE. */
export function rangeWeight(sd: SplitDays, start: string, end: string): { weight: number; days: number } {
  let weight = 0;
  let days = 0;
  const calendar = wholeWeight(sd) <= 0;
  for (const d of sd.days) {
    if (d.date >= start && d.date <= end) {
      days += 1;
      weight += calendar ? 1 : d.weight;
    }
  }
  return { weight, days };
}

/** The amount a date range bills — the server's rule: the sheet's total ×
 * (weight in the range ÷ weight of the whole sheet). PURE. */
export function dateRangeAmount(sd: SplitDays, total: number, start: string, end: string): number {
  if (!start || !end || end < start) return 0;
  const whole = wholeWeight(sd) > 0 ? wholeWeight(sd) : sd.days.length;
  if (!whole) return 0;
  return r2(total * rangeWeight(sd, start, end).weight / whole);
}

/** Days not on a part already raised, in date order. PURE. */
export function freeDays(sd: SplitDays): string[] {
  return sd.days.map((d) => d.date)
    .filter((d) => !sd.taken.some((t) => d >= t.start && d <= t.end));
}

/** Fill each PO to its balance BY DATES: the first PO from the first free day
 * for as many days as its balance pays for (1–29 Mar when PO A holds ₹2,00,000),
 * the next PO from the day after, the last PO to the end of the free run. PURE. */
export function fillByDates(poIds: number[], pos: PoOption[], sd: SplitDays, total: number): SplitRow[] {
  const free = freeDays(sd);
  if (!free.length) return [];
  // The first free run (a part never jumps over a day already billed).
  const run: string[] = [free[0]];
  for (let i = 1; i < free.length && free[i] === addDays(free[i - 1], 1); i++) run.push(free[i]);
  const rows: SplitRow[] = [];
  let i = 0;
  for (const id of poIds) {
    if (i >= run.length) break;
    const po = pos.find((p) => p.id === id);
    const bal = po?.balance_value == null ? Infinity : Math.max(0, po.balance_value);
    const last = id === poIds[poIds.length - 1];
    let j = last || bal === Infinity ? run.length - 1 : i - 1;
    if (!(last || bal === Infinity)) {
      while (j + 1 < run.length && dateRangeAmount(sd, total, run[i], run[j + 1]) <= bal + 0.005) j++;
    }
    if (j < i) continue;
    rows.push({ ...newSplitRow(id), start: run[i], end: run[j] });
    i = j + 1;
  }
  return rows;
}

/** What is wrong with date lines, in the GM's words; [] = ready. PURE. */
export function dateProblems(rows: SplitRow[], pos: PoOption[], sd: SplitDays, total: number): string[] {
  const out: string[] = [];
  if (!rows.length) out.push("Add at least one PO");
  const ids = rows.map((r) => r.po_id).filter((x): x is number => x != null);
  if (rows.some((r) => r.po_id == null)) out.push("Pick a PO on every line");
  if (new Set(ids).size !== ids.length) out.push("The same PO is on two lines");
  const ranges: Array<[string, string]> = sd.taken.map((t) => [t.start, t.end]);
  for (const r of rows) {
    if (!r.start || !r.end) { out.push("Give every line a From and a To date"); continue; }
    if (r.end < r.start) { out.push("A To date is before its From date"); continue; }
    if (r.start < sd.start || r.end > sd.end) out.push(`Dates must lie between ${fmtShort(sd.start)} and ${fmtShort(sd.end)}`);
    const amt = dateRangeAmount(sd, total, r.start, r.end);
    if (amt <= 0) out.push(`Nothing billable between ${fmtShort(r.start)} and ${fmtShort(r.end)}`);
    const po = pos.find((p) => p.id === r.po_id);
    if (po?.balance_value != null && amt > po.balance_value + 0.005) {
      out.push(`${po.po_number} has only ₹${po.balance_value.toLocaleString("en-IN")} left`);
    }
    ranges.push([r.start, r.end]);
  }
  const sorted = [...ranges].sort((a, b) => a[0].localeCompare(b[0]));
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k][0] <= sorted[k - 1][1]) { out.push(`${fmtShort(sorted[k][0])} is on two invoices — a day can be billed once`); break; }
  }
  return Array.from(new Set(out));
}

/** The amount one line bills in either mode. PURE. */
export function partAmount(row: SplitRow, by: SplitBy, byQty: boolean, rate: number | null,
  sd: SplitDays | null | undefined, total: number): number {
  return by === "dates" && sd ? dateRangeAmount(sd, total, row.start, row.end) : rowAmount(row, byQty, rate);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-03-29" → "29 Mar". PURE. */
export function fmtShort(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return m && d ? `${d} ${MONTHS[m - 1]}` : iso;
}

/** Hours / days (true) or amount (false) for this rate. PURE. */
export function splitByQty(unit?: string | null, rateSplit?: boolean, rate?: number | null): boolean {
  return !!unit && QTY_UNITS.has(unit) && !rateSplit && !!rate && rate > 0;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The amount each line bills. PURE. */
export function rowAmount(row: SplitRow, byQty: boolean, rate: number | null): number {
  if (byQty) {
    const q = Number(row.qty);
    return Number.isFinite(q) && q > 0 && rate ? r2(q * rate) : 0;
  }
  const a = Number(row.amount);
  return Number.isFinite(a) && a > 0 ? r2(a) : 0;
}

/** Fill each PO to what it can carry, in order (the first one is usually the
 * nearly-used PO the customer named), until the sheet is covered. Hours are
 * whole, days step by ½, amounts to the paisa. PURE. */
export function fillToBalances(poIds: number[], pos: PoOption[], opts: {
  remaining: number; remainingQty: number | null; rate: number | null; byQty: boolean; unit?: string | null;
}): SplitRow[] {
  const rows: SplitRow[] = [];
  let leftAmt = opts.remaining;
  let leftQty = opts.remainingQty ?? 0;
  const step = opts.unit === "Daily" ? 0.5 : 1;
  for (const id of poIds) {
    if (leftAmt <= 0.005) break;
    const po = pos.find((p) => p.id === id);
    const bal = po?.balance_value == null ? Infinity : Math.max(0, po.balance_value);
    const last = id === poIds[poIds.length - 1];
    if (opts.byQty && opts.rate) {
      const fit = last || bal === Infinity ? leftQty : Math.floor(bal / opts.rate / step) * step;
      const q = Math.min(leftQty, fit);
      if (q <= 0) continue;
      rows.push({ ...newSplitRow(id), qty: String(Math.round(q * 10000) / 10000) });
      leftQty -= q;
      leftAmt -= q * opts.rate;
    } else {
      const a = last || bal === Infinity ? leftAmt : Math.min(leftAmt, bal);
      if (a <= 0) continue;
      rows.push({ ...newSplitRow(id), amount: String(r2(a)) });
      leftAmt -= a;
    }
  }
  return rows;
}

/** What is wrong with the lines, in the GM's words; [] = ready. PURE. */
export function splitProblems(rows: SplitRow[], pos: PoOption[], opts: {
  remaining: number; rate: number | null; byQty: boolean;
}): string[] {
  const out: string[] = [];
  if (!rows.length) out.push("Add at least one PO");
  const ids = rows.map((r) => r.po_id).filter((x): x is number => x != null);
  if (rows.some((r) => r.po_id == null)) out.push("Pick a PO on every line");
  if (new Set(ids).size !== ids.length) out.push("The same PO is on two lines");
  rows.forEach((r) => {
    const amt = rowAmount(r, opts.byQty, opts.rate);
    if (amt <= 0) out.push(`Enter the ${opts.byQty ? "hours / days" : "amount"} on every line`);
    const po = pos.find((p) => p.id === r.po_id);
    if (po?.balance_value != null && amt > po.balance_value + 0.005) {
      out.push(`${po.po_number} has only ₹${po.balance_value.toLocaleString("en-IN")} left`);
    }
  });
  const total = rows.reduce((s, r) => s + rowAmount(r, opts.byQty, opts.rate), 0);
  if (total > opts.remaining + 0.01) out.push("The lines add up to more than is left to bill");
  return Array.from(new Set(out));
}

const inr = (n: number | null | undefined) =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** One cell per day of the sheet, coloured by the part that bills it — so the
 * GM SEES that 1–29 Mar is on PO A and 30–31 Mar on PO B, and what is left. */
const PART_COLORS = ["bg-amber-500", "bg-sky-500", "bg-emerald-500", "bg-fuchsia-500", "bg-indigo-500",
  "bg-rose-500", "bg-teal-500", "bg-orange-500", "bg-purple-500", "bg-lime-500"];

function DayStrip({ sd, rows, pos, firstPart }: {
  sd: SplitDays; rows: SplitRow[]; pos: PoOption[]; firstPart: number;
}) {
  return (
    <div>
      <div className="flex gap-px overflow-hidden rounded-control" role="img"
        aria-label="Days of the timesheet and the part that bills each">
        {sd.days.map((d) => {
          const taken = sd.taken.find((t) => d.date >= t.start && d.date <= t.end);
          const idx = rows.findIndex((r) => r.start && r.end && d.date >= r.start && d.date <= r.end);
          const po = idx >= 0 ? pos.find((p) => p.id === rows[idx].po_id) : null;
          const tip = `${fmtShort(d.date)} · ${d.weight} billable ${sd.basis}` + (taken
            ? ` · already on ${taken.invoice_number}`
            : idx >= 0 ? ` · part ${firstPart + idx}${po ? ` on ${po.po_number}` : ""}` : " · not on any part yet");
          const color = taken ? "bg-slate-400 dark:bg-slate-600"
            : idx >= 0 ? PART_COLORS[idx % PART_COLORS.length] : "bg-surface-2";
          return (
            <span key={d.date} title={tip}
              className={`h-6 min-w-[6px] flex-1 ${color} ${d.weight <= 0 ? "opacity-40" : ""}`} />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>{fmtShort(sd.start)}</span>
        <span>Faded = no billable {sd.basis} · grey = already billed</span>
        <span>{fmtShort(sd.end)}</span>
      </div>
    </div>
  );
}

export function SplitAcrossPos({ rows, onChange, pos, progress, preferredIds, maxRows,
  splitBy = "amount", onSplitByChange, splitDays, splitByLocked }: {
  rows: SplitRow[];
  onChange: (rows: SplitRow[]) => void;
  pos: PoOption[];
  progress: BillingProgress;
  /** PO order for "Fill each PO": the picked PO first, then this employee's live POs. */
  preferredIds: number[];
  /** Admin's "Most parts per timesheet" minus the parts already raised (Settings ▸ Organisation ▸ Billing). */
  maxRows?: number;
  /** 0142 — split by dates or by hours / amount. */
  splitBy?: SplitBy;
  onSplitByChange?: (by: SplitBy) => void;
  /** The sheet's days (po-options `split_days`); without it only hours / amount is offered. */
  splitDays?: SplitDays | null;
  /** A sheet already split one way must carry on that way. */
  splitByLocked?: boolean;
}) {
  const cap = maxRows == null ? Infinity : Math.max(1, maxRows);
  const rate = progress.rate;
  const byQty = splitByQty(progress.billing_unit, progress.rate_split, rate);
  const byDates = splitBy === "dates" && !!splitDays;
  const remaining = progress.remaining ?? 0;
  const sheetTotal = progress.total ?? remaining;
  const unitWord = progress.billing_unit === "Daily" ? "days" : progress.billing_unit === "Hourly" ? "hours" : "";
  const choices = pos.filter((p) => p.selectable !== false);
  const amountOf = (r: SplitRow) => partAmount(r, splitBy, byQty, rate, splitDays, sheetTotal);
  const total = rows.reduce((s, r) => s + amountOf(r), 0);
  const later = Math.max(0, r2(remaining - total));
  const set = (key: string, patch: Partial<SplitRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const fill = () => onChange((byDates && splitDays
    ? fillByDates(preferredIds, pos, splitDays, sheetTotal)
    : fillToBalances(preferredIds, pos, {
      remaining, remainingQty: progress.remaining_qty, rate, byQty, unit: progress.billing_unit,
    })).slice(0, cap));
  const done = progress.parts.filter((p) => !p.returned_at);
  const addRow = () => {
    if (!byDates || !splitDays) { onChange([...rows, newSplitRow(null)]); return; }
    // A new date line starts the day after the last one ends.
    const lastEnd = [...rows.map((r) => r.end), ...splitDays.taken.map((t) => t.end)].filter(Boolean).sort().pop();
    const start = lastEnd ? addDays(lastEnd, 1) : splitDays.start;
    onChange([...rows, { ...newSplitRow(null), start: start <= splitDays.end ? start : "", end: start <= splitDays.end ? splitDays.end : "" }]);
  };

  return (
    <div className="space-y-3" data-testid="split-across-pos">
      {splitDays && onSplitByChange && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-secondary">Split by</span>
          <div className="inline-flex rounded-full bg-surface-2 p-0.5 font-semibold" role="group" aria-label="Split by">
            {(["dates", "amount"] as SplitBy[]).map((k) => (
              <button key={k} type="button" aria-pressed={splitBy === k} disabled={splitByLocked && splitBy !== k}
                onClick={() => { if (splitBy !== k) { onSplitByChange(k); } }}
                className={`rounded-full px-2.5 py-1 disabled:opacity-40 ${splitBy === k ? "bg-amber-600 text-white" : "text-secondary"}`}>
                {k === "dates" ? "Dates (1–29 on one PO, 30–31 on another)" : byQty ? `${unitWord[0]?.toUpperCase()}${unitWord.slice(1)} / amount` : "Amount"}
              </button>
            ))}
          </div>
          {splitByLocked && <span className="text-muted">This timesheet is already split this way</span>}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <span>
          Left to bill on this timesheet: <b className="tabular-nums">{inr(remaining)}</b>
          {!byDates && byQty && progress.remaining_qty != null && <> · <b>{progress.remaining_qty} {unitWord}</b></>}
          {done.length > 0 && <> · already raised: {done.map((p) => p.invoice_number).join(", ")}</>}
        </span>
        <button type="button" onClick={fill} disabled={!preferredIds.length}
          className="inline-flex h-7 items-center gap-1 rounded-full bg-amber-600 px-2.5 text-[11px] font-bold text-white hover:bg-amber-700 disabled:opacity-50">
          <Wand2 className="h-3.5 w-3.5" aria-hidden /> {byDates ? "Fill dates from each PO's balance" : "Fill each PO to its balance"}
        </button>
      </div>

      {byDates && splitDays && (
        <>
          <DayStrip sd={splitDays} rows={rows} pos={pos} firstPart={done.length + 1} />
          <p className="text-[11px] text-muted">
            Each PO pays for the days you give it. The amount is this timesheet&rsquo;s total shared by
            the billable {splitDays.basis} in those dates — every invoice prints its own dates.
          </p>
        </>
      )}

      <div className="space-y-2">
        {rows.map((r, i) => {
          const po = pos.find((p) => p.id === r.po_id);
          const amt = amountOf(r);
          const after = po?.balance_value != null ? r2(po.balance_value - amt) : null;
          const rw = byDates && splitDays && r.start && r.end && r.end >= r.start
            ? rangeWeight(splitDays, r.start, r.end) : null;
          if (byDates && splitDays) {
            return (
              <div key={r.key} className="grid items-end gap-2 rounded-card border border-subtle bg-surface-1 p-3 sm:grid-cols-[2rem_minmax(0,1fr)_9.5rem_9.5rem_8.5rem_2rem]">
                <span className={`grid h-8 w-8 place-items-center rounded-full text-xs font-bold text-white ${PART_COLORS[i % PART_COLORS.length]}`} aria-hidden>
                  {done.length + i + 1}
                </span>
                <label className="block min-w-0">
                  <span className="mb-1 block text-[11px] font-semibold text-muted">Purchase order</span>
                  <select className={inputCls} value={r.po_id ?? ""} aria-label={`PO for part ${i + 1}`}
                    onChange={(e) => set(r.key, { po_id: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Pick a PO…</option>
                    {choices.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.po_number} · {p.balance_value == null ? "open" : `${inr(p.balance_value)} left`}
                        {p.expired ? " · expired" : ""}{p.employee_match ? " · this employee" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-muted">From</span>
                  <input type="date" className={`${inputCls} tabular-nums`} aria-label={`From date for part ${i + 1}`}
                    min={splitDays.start} max={splitDays.end} value={r.start}
                    onChange={(e) => set(r.key, { start: e.target.value })} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-muted">To</span>
                  <input type="date" className={`${inputCls} tabular-nums`} aria-label={`To date for part ${i + 1}`}
                    min={r.start || splitDays.start} max={splitDays.end} value={r.end}
                    onChange={(e) => set(r.key, { end: e.target.value })} />
                </label>
                <div className="text-right">
                  <div className="text-sm font-bold tabular-nums text-primary">{inr(amt)}</div>
                  {rw && (
                    <div className="text-[11px] tabular-nums text-muted">
                      {rw.days} day{rw.days === 1 ? "" : "s"} · {Math.round(rw.weight * 100) / 100} billable {splitDays.basis}
                    </div>
                  )}
                  {after != null && (
                    <div className={`text-[11px] tabular-nums ${after < 0 ? "font-bold text-danger" : "text-muted"}`}>
                      PO after: {inr(after)}
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
                  aria-label={`Remove part ${i + 1}`} disabled={rows.length === 1}
                  className="grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30">
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </div>
            );
          }
          return (
            <div key={r.key} className="grid items-end gap-2 rounded-card border border-subtle bg-surface-1 p-3 sm:grid-cols-[2rem_minmax(0,1fr)_9rem_8rem_2rem]">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-xs font-bold text-white" aria-hidden>
                {done.length + i + 1}
              </span>
              <label className="block min-w-0">
                <span className="mb-1 block text-[11px] font-semibold text-muted">Purchase order</span>
                <select className={inputCls} value={r.po_id ?? ""} aria-label={`PO for part ${i + 1}`}
                  onChange={(e) => set(r.key, { po_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Pick a PO…</option>
                  {choices.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.po_number} · {p.balance_value == null ? "open" : `${inr(p.balance_value)} left`}
                      {p.expired ? " · expired" : ""}{p.employee_match ? " · this employee" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-muted">{byQty ? `${unitWord[0].toUpperCase()}${unitWord.slice(1)}` : "Amount (before GST)"}</span>
                <input type="number" min={0} step={byQty ? (progress.billing_unit === "Daily" ? 0.5 : 1) : 0.01}
                  className={`${inputCls} tabular-nums`} aria-label={`${byQty ? unitWord : "Amount"} for part ${i + 1}`}
                  value={byQty ? r.qty : r.amount}
                  onChange={(e) => set(r.key, byQty ? { qty: e.target.value } : { amount: e.target.value })} />
              </label>
              <div className="text-right">
                <div className="text-sm font-bold tabular-nums text-primary">{inr(amt)}</div>
                {after != null && (
                  <div className={`text-[11px] tabular-nums ${after < 0 ? "font-bold text-danger" : "text-muted"}`}>
                    PO after: {inr(after)}
                  </div>
                )}
                {po?.expired && <div className="text-[11px] font-semibold text-warning">Expired PO</div>}
              </div>
              <button type="button" onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
                aria-label={`Remove part ${i + 1}`} disabled={rows.length === 1}
                className="grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30">
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {rows.length < cap ? (
          <button type="button" onClick={addRow}
            className="inline-flex h-8 items-center gap-1.5 rounded-control border border-dashed border-amber-400 px-3 text-xs font-semibold text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/30">
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add another PO
          </button>
        ) : (
          <span className="text-[11px] text-muted">
            Most parts per timesheet reached — Admin sets this in Settings ▸ Organisation ▸ Billing
          </span>
        )}
        <div className="text-xs text-secondary">
          This raise: <b className="tabular-nums text-primary">{inr(total)}</b>
          {later > 0.01 && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
            <Sparkles className="h-3 w-3" aria-hidden /> {inr(later)} stays to bill later
          </span>}
        </div>
      </div>
    </div>
  );
}
