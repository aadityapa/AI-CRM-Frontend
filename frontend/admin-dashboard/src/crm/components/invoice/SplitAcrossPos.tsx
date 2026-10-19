/**
 * Split one timesheet across several POs (0141, 20 Oct 2026, user flow: "a PO
 * covers only a few hours — one timesheet, two invoices on two POs").
 *
 * Each line = one PO and the share it carries: hours / days on an Hourly /
 * Daily rate, an amount (before GST) on a Monthly rate or a mid-month rate
 * change. "Fill each PO to its balance" puts as much as each PO can carry on
 * it, in order, the rest on the next. The lines may leave part of the sheet for
 * later (a PO still to come). The server re-checks everything (`plan_splits`).
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
  }>;
  returned: unknown[];
};

export type SplitRow = { key: string; po_id: number | null; qty: string; amount: string };

const QTY_UNITS = new Set(["Hourly", "Daily"]);
let seq = 0;
export const newSplitRow = (po_id: number | null = null): SplitRow =>
  ({ key: `s${++seq}`, po_id, qty: "", amount: "" });

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

export function SplitAcrossPos({ rows, onChange, pos, progress, preferredIds, maxRows }: {
  rows: SplitRow[];
  onChange: (rows: SplitRow[]) => void;
  pos: PoOption[];
  progress: BillingProgress;
  /** PO order for "Fill each PO": the picked PO first, then this employee's live POs. */
  preferredIds: number[];
  /** Admin's "Most parts per timesheet" minus the parts already raised (Settings ▸ Organisation ▸ Billing). */
  maxRows?: number;
}) {
  const cap = maxRows == null ? Infinity : Math.max(1, maxRows);
  const rate = progress.rate;
  const byQty = splitByQty(progress.billing_unit, progress.rate_split, rate);
  const remaining = progress.remaining ?? 0;
  const unitWord = progress.billing_unit === "Daily" ? "days" : progress.billing_unit === "Hourly" ? "hours" : "";
  const choices = pos.filter((p) => p.selectable !== false);
  const total = rows.reduce((s, r) => s + rowAmount(r, byQty, rate), 0);
  const later = Math.max(0, r2(remaining - total));
  const set = (key: string, patch: Partial<SplitRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const fill = () => onChange(fillToBalances(preferredIds, pos, {
    remaining, remainingQty: progress.remaining_qty, rate, byQty, unit: progress.billing_unit,
  }).slice(0, cap));
  const done = progress.parts.filter((p) => !p.returned_at);

  return (
    <div className="space-y-3" data-testid="split-across-pos">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <span>
          Left to bill on this timesheet: <b className="tabular-nums">{inr(remaining)}</b>
          {byQty && progress.remaining_qty != null && <> · <b>{progress.remaining_qty} {unitWord}</b></>}
          {done.length > 0 && <> · already raised: {done.map((p) => p.invoice_number).join(", ")}</>}
        </span>
        <button type="button" onClick={fill} disabled={!preferredIds.length}
          className="inline-flex h-7 items-center gap-1 rounded-full bg-amber-600 px-2.5 text-[11px] font-bold text-white hover:bg-amber-700 disabled:opacity-50">
          <Wand2 className="h-3.5 w-3.5" aria-hidden /> Fill each PO to its balance
        </button>
      </div>

      <div className="space-y-2">
        {rows.map((r, i) => {
          const po = pos.find((p) => p.id === r.po_id);
          const amt = rowAmount(r, byQty, rate);
          const after = po?.balance_value != null ? r2(po.balance_value - amt) : null;
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
          <button type="button" onClick={() => onChange([...rows, newSplitRow(null)])}
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
