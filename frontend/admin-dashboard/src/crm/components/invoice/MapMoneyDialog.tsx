/**
 * Map money from the Invoices list (20 Nov 2026, Finance ask: "Unpaid 119 —
 * give me a shortcut to map these to the customer's Received Amount and
 * Received TDS from here").
 *
 * Finance ticks invoices (or presses Map on one row) and, in one dialog:
 *  1. picks where the CASH comes from — a received amount still on account, or
 *     records a new one (what is not mapped stays on account);
 *  2. says how the TDS stands — received (Form 16A, from a Received TDS entry,
 *     existing or new), deducted with the certificate pending, or none;
 *  3. types the cash / TDS per invoice (filled oldest first for them).
 * One POST (`/api/receipt-mapping`), one transaction — the server re-checks
 * every rule (one customer, TDS first, nothing above what is open).
 */
import { useEffect, useMemo, useState } from "react";
import { Banknote, CalendarDays, CheckCircle2, FileCheck2, Landmark, Percent, Plus, Wallet } from "lucide-react";
import { crmGet, crmPost } from "../../api";
import { Modal, inputCls } from "../ui";
import { DialogActions, DialogFailure, DialogHero, DialogSection, WhatHappens, useCtrlEnter } from "../dialogKit";

export type MapInvoice = {
  id: number; invoice_number: string | null; invoice_date: string | null;
  employee_name?: string | null; branch_name?: string | null; month_label?: string | null;
  sub_total: number; grand_total: number; balance_amount: number;
  tds_open: number; tds_cap: number; has_tds: boolean;
};
type ReceiptOpt = {
  id: number; received_date: string | null; amount: number; unallocated_amount: number;
  payment_mode: string | null; reference_number: string | null; branch_name: string | null; likely_match?: boolean;
};
type TdsOpt = {
  id: number; received_date: string | null; amount: number; unallocated_amount: number;
  certificate_number: string | null; quarter: string | null; branch_name: string | null;
};
type Options = {
  customer: { id: number; name: string };
  invoices: MapInvoice[]; receipts: ReceiptOpt[]; tds_entries: TdsOpt[];
  payment_modes: string[]; default_tds_rate: number;
};

export type CashSource = { kind: "receipt"; id: number } | { kind: "new" } | { kind: "none" };
export type TdsSource = { kind: "none" } | { kind: "entry"; id: number } | { kind: "new" } | { kind: "pending" };
type Line = { cash: string; tds: string };

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: string) => { const n = Number(String(v).replace(/,/g, "")); return Number.isFinite(n) && n > 0 ? r2(n) : 0; };
export const rupee = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtDay = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");

/** Cash per invoice, oldest first, up to (balance − TDS typed), out of `available`
 *  (Infinity = a new received amount: everything open). PURE. */
export function fillCash(invoices: MapInvoice[], tds: Record<number, number>, available: number): Record<number, number> {
  let left = available;
  const out: Record<number, number> = {};
  for (const inv of [...invoices].sort((a, b) => (a.invoice_date || "").localeCompare(b.invoice_date || "") || a.id - b.id)) {
    const open = r2(Math.max(0, inv.balance_amount - (tds[inv.id] || 0)));
    const take = r2(Math.min(open, left));
    out[inv.id] = take;
    left = r2(left - take);
  }
  return out;
}

/** What still stops the save, in words; "" when it can go. PURE. */
export function mapProblem(invoices: MapInvoice[], lines: Record<number, { cash: number; tds: number }>,
  cash: CashSource, tds: TdsSource, room: { cash: number; tds: number; newCash: number; newTds: number }): string {
  const cashSum = r2(invoices.reduce((a, i) => a + (lines[i.id]?.cash || 0), 0));
  const tdsSum = r2(invoices.reduce((a, i) => a + (lines[i.id]?.tds || 0), 0));
  if (!cashSum && !tdsSum) return "Type the cash or TDS to put on at least one invoice";
  for (const i of invoices) {
    const l = lines[i.id] || { cash: 0, tds: 0 };
    const label = i.invoice_number || `#${i.id}`;
    if (l.tds > i.tds_cap + 0.005) return `TDS on ${label} is more than ${i.has_tds ? "the TDS pending on it" : "its balance"}`;
    if (l.cash + l.tds > i.balance_amount + 0.005) return `Cash + TDS on ${label} is more than its balance ${rupee(i.balance_amount)}`;
    if (tds.kind === "pending" && l.tds > 0 && i.has_tds) return `TDS is already booked on ${label} — map its Form 16A as received`;
  }
  if (cashSum > 0) {
    if (cash.kind === "none") return "Pick where the cash comes from";
    if (cash.kind === "receipt" && cashSum > room.cash + 0.005) return `Only ${rupee(room.cash)} is on account in that received amount`;
    if (cash.kind === "new" && room.newCash < cashSum - 0.005) return `The new received amount must be at least ${rupee(cashSum)}`;
  }
  if (tdsSum > 0) {
    if (tds.kind === "none") return "Say how the TDS stands — received (Form 16A) or deducted, certificate pending";
    if (tds.kind === "entry" && tdsSum > room.tds + 0.005) return `Only ${rupee(room.tds)} of that Received TDS is not mapped`;
    if (tds.kind === "new" && room.newTds < tdsSum - 0.005) return `The new Received TDS must be at least ${rupee(tdsSum)}`;
  }
  return "";
}

/** A ticked invoice on the Invoices list. */
export type MapPick = { id: number; number: string; customer_id: number | null; customer_name: string; balance: number };

/** Can money be mapped onto this list row? An issued tax invoice with money open. PURE. */
export function mappableInvoice(r: { kind?: string | null; balance_amount?: number | string | null }): boolean {
  return r.kind !== "Proforma" && Number(r.balance_amount || 0) > 0.005;
}

/** The customers of the ticked invoices — one is needed to map. PURE. */
export function pickCustomers(picks: Iterable<MapPick>): string[] {
  const names = new Map<string, string>();
  for (const p of picks) names.set(String(p.customer_id ?? p.customer_name), p.customer_name || "Unknown customer");
  return [...names.values()];
}

const radio = (on: boolean) =>
  `w-full rounded-card border px-3 py-2 text-left text-sm transition-colors ${on
    ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-400/50 dark:border-emerald-600 dark:bg-emerald-950/30"
    : "border-subtle bg-surface-1 hover:bg-surface-2"}`;

export function MapMoneyDialog({ invoiceIds, onClose, onDone }: {
  invoiceIds: number[]; onClose: () => void; onDone: (msg: string) => void;
}) {
  const [opts, setOpts] = useState<Options | null>(null);
  const [loadError, setLoadError] = useState("");
  const [lines, setLines] = useState<Record<number, Line>>({});
  const [cash, setCash] = useState<CashSource>({ kind: "none" });
  const [tds, setTds] = useState<TdsSource>({ kind: "none" });
  const [newRc, setNewRc] = useState({ date: today(), amount: "", mode: "NEFT", reference: "" });
  const [newTds, setNewTds] = useState({ date: today(), amount: "", certificate: "", quarter: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const idsKey = invoiceIds.join(",");
  useEffect(() => {
    let alive = true;
    crmGet<Options>(`/api/receipt-mapping/options?invoice_ids=${idsKey}`)
      .then((r) => {
        if (!alive) return;
        const o = r.data as Options;
        setOpts(o);
        // Sensible start: a likely-matching credit on account, else a new received amount.
        const likely = o.receipts.find((x) => x.likely_match) ?? (o.receipts.length === 1 ? o.receipts[0] : null);
        setCash(likely ? { kind: "receipt", id: likely.id } : { kind: "new" });
        const avail = likely ? likely.unallocated_amount : Infinity;
        const filled = fillCash(o.invoices, {}, avail);
        setLines(Object.fromEntries(o.invoices.map((i) => [i.id, { cash: filled[i.id] ? String(filled[i.id]) : "", tds: "" }])));
      })
      .catch((e) => { if (alive) setLoadError(e?.message || "Could not load the invoices"); });
    return () => { alive = false; };
  }, [idsKey]);

  const invoices = useMemo(() => opts?.invoices ?? [], [opts]);
  const tdsOn = tds.kind !== "none";
  const cashOn = cash.kind !== "none";
  // A hidden column counts for nothing (TDS "none", cash "none").
  const parsed = useMemo(() => Object.fromEntries(invoices.map((i) => [i.id, {
    cash: cashOn ? num(lines[i.id]?.cash || "") : 0, tds: tdsOn ? num(lines[i.id]?.tds || "") : 0,
  }])), [invoices, lines, cashOn, tdsOn]);
  const cashSum = r2(invoices.reduce((a, i) => a + parsed[i.id].cash, 0));
  const tdsSum = r2(invoices.reduce((a, i) => a + parsed[i.id].tds, 0));
  const openSum = r2(invoices.reduce((a, i) => a + i.balance_amount, 0));
  const pickedReceipt = cash.kind === "receipt" ? opts?.receipts.find((x) => x.id === cash.id) : undefined;
  const pickedTds = tds.kind === "entry" ? opts?.tds_entries.find((x) => x.id === tds.id) : undefined;
  const room = {
    cash: pickedReceipt?.unallocated_amount ?? 0, tds: pickedTds?.unallocated_amount ?? 0,
    newCash: num(newRc.amount) || cashSum, newTds: num(newTds.amount) || tdsSum,
  };
  const problem = opts ? mapProblem(invoices, parsed, cash, tds, room) : "Loading…";

  const setLine = (id: number, k: keyof Line, v: string) => setLines((s) => ({ ...s, [id]: { ...(s[id] || { cash: "", tds: "" }), [k]: v } }));
  const refillCash = (avail?: number) => {
    const t = Object.fromEntries(invoices.map((i) => [i.id, parsed[i.id].tds]));
    const a = avail ?? (cash.kind === "receipt" ? room.cash : Infinity);
    const f = fillCash(invoices, t, a);
    setLines((s) => Object.fromEntries(invoices.map((i) => [i.id, { ...(s[i.id] || { tds: "" }), cash: f[i.id] ? String(f[i.id]) : "" }])) as Record<number, Line>);
  };
  const fillTds = () => {
    setLines((s) => Object.fromEntries(invoices.map((i) => [i.id, {
      ...(s[i.id] || { cash: "" }), tds: i.tds_open > 0 ? String(r2(i.tds_open)) : "" }])) as Record<number, Line>);
  };

  const submit = async () => {
    if (!opts || problem || busy) return;
    setBusy(true); setError("");
    try {
      const body: Record<string, unknown> = {
        customer_id: opts.customer.id,
        items: invoices.filter((i) => parsed[i.id].cash || parsed[i.id].tds).map((i) => ({
          invoice_id: i.id, cash: parsed[i.id].cash || null, tds: tdsOn ? parsed[i.id].tds || null : null })),
        tds_mode: tds.kind === "pending" ? "pending" : "received",
      };
      if (cashSum > 0 && cash.kind === "receipt") body.receipt_id = cash.id;
      if (cashSum > 0 && cash.kind === "new") body.new_receipt = { received_date: newRc.date, amount: room.newCash,
        payment_mode: newRc.mode || null, reference_number: newRc.reference || null };
      if (tdsSum > 0 && tds.kind === "entry") body.tds_receipt_id = tds.id;
      if (tdsSum > 0 && tds.kind === "new") body.new_tds = { received_date: newTds.date, amount: room.newTds,
        certificate_number: newTds.certificate || null, quarter: newTds.quarter || null };
      const res = await crmPost<any>("/api/receipt-mapping", body);
      onDone(res.message || "Mapped");
    } catch (e: any) { setError(e?.message || "Could not map"); setBusy(false); }
  };
  useCtrlEnter(submit);

  const n = invoiceIds.length;
  return (
    <Modal title="Map money to invoices" onClose={onClose} wide dirty={cashSum > 0 || tdsSum > 0}
      hero={<DialogHero tone="emerald" icon={Wallet} eyebrow="Received Amount · Received TDS"
        title={`Map money to ${n} invoice${n === 1 ? "" : "s"}`}
        subtitle="Take the cash from a received amount (or record it now) and the TDS from Received TDS — in one step."
        person={opts ? { name: opts.customer.name, meta: `${rupee(openSum)} open` } : null}
        flow={{ steps: ["Invoice open", "Cash + TDS mapped", "Paid"], current: 1 }} />}>
      {loadError ? <DialogFailure message={loadError} /> : !opts ? <p className="text-sm text-muted">Loading the invoices…</p> : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),280px]">
          <div className="min-w-0 space-y-4">
            <DialogSection n={1} title="Where is the cash from?" tone="emerald" done={cash.kind !== "none"}
              hint="A credit already in Received Amount and not mapped yet, or record the bank credit now.">
              <div className="grid gap-2 sm:grid-cols-2">
                {opts.receipts.map((r) => (
                  <button key={r.id} type="button" className={radio(cash.kind === "receipt" && cash.id === r.id)}
                    onClick={() => { setCash({ kind: "receipt", id: r.id }); refillCash(r.unallocated_amount); }}>
                    <span className="flex items-center justify-between gap-2">
                      <b className="tabular-nums">{rupee(r.unallocated_amount)}</b>
                      {r.likely_match && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">Likely match</span>}
                    </span>
                    <span className="block text-xs text-muted">on account · #{r.id} · {fmtDay(r.received_date)} of {rupee(r.amount)}</span>
                    <span className="block truncate text-xs text-secondary">{[r.payment_mode, r.reference_number, r.branch_name].filter(Boolean).join(" · ") || "—"}</span>
                  </button>
                ))}
                <button type="button" className={radio(cash.kind === "new")} onClick={() => { setCash({ kind: "new" }); refillCash(Infinity); }}>
                  <span className="flex items-center gap-1.5 font-semibold"><Plus size={14} /> Record a new received amount</span>
                  <span className="block text-xs text-muted">The bank credit is saved in Received Amount and mapped here</span>
                </button>
                <button type="button" className={radio(cash.kind === "none")}
                  onClick={() => { setCash({ kind: "none" }); setLines((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { ...v, cash: "" }]))); }}>
                  <span className="font-semibold">No cash now</span>
                  <span className="block text-xs text-muted">Only TDS on these invoices</span>
                </button>
              </div>
              {!opts.receipts.length && <p className="mt-2 text-xs text-muted">Nothing of {opts.customer.name} is on account in Received Amount.</p>}
              {cash.kind === "new" && (
                <div className="mt-3 grid gap-2 rounded-card border border-emerald-200 bg-emerald-50/50 p-3 sm:grid-cols-4 dark:border-emerald-900 dark:bg-emerald-950/20">
                  <label className="text-xs font-semibold text-secondary">Received on
                    <input type="date" className={`${inputCls} mt-1`} value={newRc.date} onChange={(e) => setNewRc({ ...newRc, date: e.target.value })} />
                  </label>
                  <label className="text-xs font-semibold text-secondary">Amount ₹
                    <input inputMode="decimal" className={`${inputCls} mt-1 text-right`} placeholder={cashSum ? String(cashSum) : "0"}
                      value={newRc.amount} onChange={(e) => setNewRc({ ...newRc, amount: e.target.value })} />
                  </label>
                  <label className="text-xs font-semibold text-secondary">Mode
                    <select className={`${inputCls} mt-1`} value={newRc.mode} onChange={(e) => setNewRc({ ...newRc, mode: e.target.value })}>
                      {opts.payment_modes.map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-secondary">UTR / reference
                    <input className={`${inputCls} mt-1`} value={newRc.reference} onChange={(e) => setNewRc({ ...newRc, reference: e.target.value })} />
                  </label>
                  <p className="text-[11px] text-muted sm:col-span-4">Blank amount = the cash typed below ({rupee(cashSum)}). A bigger credit keeps the rest on account.</p>
                </div>
              )}
            </DialogSection>

            <DialogSection n={2} title="TDS" tone="emerald" done optional
              hint="If the customer deducted TDS, say whether the Form 16A is in.">
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" className={radio(tds.kind === "none")} onClick={() => setTds({ kind: "none" })}>
                  <span className="font-semibold">No TDS here</span>
                </button>
                <button type="button" className={radio(tds.kind === "pending")} onClick={() => { setTds({ kind: "pending" }); if (!tdsSum) fillTds(); }}>
                  <span className="font-semibold">Deducted — certificate pending</span>
                  <span className="block text-xs text-muted">Booked as “pending from client”</span>
                </button>
                {opts.tds_entries.map((t) => (
                  <button key={t.id} type="button" className={radio(tds.kind === "entry" && tds.id === t.id)}
                    onClick={() => { setTds({ kind: "entry", id: t.id }); if (!tdsSum) fillTds(); }}>
                    <span className="flex items-center gap-1.5"><FileCheck2 size={14} /><b className="tabular-nums">{rupee(t.unallocated_amount)}</b> not mapped</span>
                    <span className="block truncate text-xs text-muted">Received TDS #{t.id} · {fmtDay(t.received_date)}{t.certificate_number ? ` · ${t.certificate_number}` : ""}{t.quarter ? ` · ${t.quarter}` : ""}</span>
                  </button>
                ))}
                <button type="button" className={radio(tds.kind === "new")} onClick={() => { setTds({ kind: "new" }); if (!tdsSum) fillTds(); }}>
                  <span className="flex items-center gap-1.5 font-semibold"><Plus size={14} /> Record new Received TDS (Form 16A)</span>
                </button>
              </div>
              {tds.kind === "new" && (
                <div className="mt-3 grid gap-2 rounded-card border border-emerald-200 bg-emerald-50/50 p-3 sm:grid-cols-4 dark:border-emerald-900 dark:bg-emerald-950/20">
                  <label className="text-xs font-semibold text-secondary">Received on
                    <input type="date" className={`${inputCls} mt-1`} value={newTds.date} onChange={(e) => setNewTds({ ...newTds, date: e.target.value })} />
                  </label>
                  <label className="text-xs font-semibold text-secondary">TDS ₹
                    <input inputMode="decimal" className={`${inputCls} mt-1 text-right`} placeholder={tdsSum ? String(tdsSum) : "0"}
                      value={newTds.amount} onChange={(e) => setNewTds({ ...newTds, amount: e.target.value })} />
                  </label>
                  <label className="text-xs font-semibold text-secondary">Form 16A no.
                    <input className={`${inputCls} mt-1`} value={newTds.certificate} onChange={(e) => setNewTds({ ...newTds, certificate: e.target.value })} />
                  </label>
                  <label className="text-xs font-semibold text-secondary">Quarter
                    <input className={`${inputCls} mt-1`} placeholder="Q2 FY26-27" value={newTds.quarter} onChange={(e) => setNewTds({ ...newTds, quarter: e.target.value })} />
                  </label>
                </div>
              )}
            </DialogSection>

            <DialogSection n={3} title="How much on each invoice" tone="emerald" done={cashSum > 0 || tdsSum > 0}
              action={
                <div className="flex flex-wrap gap-1.5">
                  {cash.kind !== "none" && (
                    <button type="button" className="rounded-control border border-subtle px-2 py-1 text-xs font-semibold hover:bg-surface-2" onClick={() => refillCash()}>
                      Fill cash oldest first
                    </button>
                  )}
                  {tdsOn && (
                    <button type="button" className="rounded-control border border-subtle px-2 py-1 text-xs font-semibold hover:bg-surface-2" onClick={fillTds}>
                      <Percent size={12} className="mr-1 inline" />TDS at {opts.default_tds_rate}% before GST
                    </button>
                  )}
                </div>
              }>
              <div className="overflow-x-auto rounded-card border border-subtle">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-2">Invoice</th>
                      <th className="px-3 py-2 text-right">Open</th>
                      <th className="px-3 py-2 text-right">Cash ₹</th>
                      {tdsOn && <th className="px-3 py-2 text-right">TDS ₹</th>}
                      <th className="px-3 py-2 text-right">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((i) => {
                      const p = parsed[i.id];
                      const after = r2(i.balance_amount - p.cash - (tdsOn ? p.tds : 0));
                      return (
                        <tr key={i.id} className="border-t border-subtle">
                          <td className="px-3 py-2">
                            <div className="font-semibold">{i.invoice_number || `#${i.id}`}</div>
                            <div className="text-[11px] text-muted">{[i.month_label, i.employee_name, i.branch_name].filter(Boolean).join(" · ")}</div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{rupee(i.balance_amount)}
                            {i.has_tds && i.tds_open > 0 && <div className="text-[10px] text-amber-700 dark:text-amber-300">TDS {rupee(i.tds_open)} pending</div>}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input inputMode="decimal" aria-label={`Cash on ${i.invoice_number}`} disabled={cash.kind === "none"}
                              className="h-8 w-28 rounded-control border border-subtle bg-surface-1 px-2 text-right tabular-nums disabled:opacity-50"
                              value={lines[i.id]?.cash ?? ""} onChange={(e) => setLine(i.id, "cash", e.target.value)} />
                          </td>
                          {tdsOn && (
                            <td className="px-3 py-2 text-right">
                              <input inputMode="decimal" aria-label={`TDS on ${i.invoice_number}`}
                                className="h-8 w-24 rounded-control border border-subtle bg-surface-1 px-2 text-right tabular-nums"
                                value={lines[i.id]?.tds ?? ""} onChange={(e) => setLine(i.id, "tds", e.target.value)} />
                            </td>
                          )}
                          <td className={`px-3 py-2 text-right font-semibold tabular-nums ${after < -0.005 ? "text-rose-600" : after <= 0.005 ? "text-emerald-700 dark:text-emerald-300" : "text-secondary"}`}>
                            {Math.abs(after) <= 0.005 ? <span className="inline-flex items-center gap-1"><CheckCircle2 size={13} /> Paid</span> : rupee(after)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </DialogSection>
            <DialogFailure message={error} />
          </div>

          <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
            <div className="rounded-card border border-subtle bg-surface-2 p-3 text-sm">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">This mapping</div>
              <Row icon={Landmark} label="Open on these invoices" value={rupee(openSum)} />
              <Row icon={Banknote} label="Cash" value={rupee(cashSum)} />
              {tdsOn && <Row icon={Percent} label={tds.kind === "pending" ? "TDS (pending)" : "TDS received"} value={rupee(tdsSum)} />}
              <Row icon={CheckCircle2} label="Still open after" value={rupee(Math.max(0, r2(openSum - cashSum - (tdsOn ? tdsSum : 0))))} strong />
              {cash.kind === "receipt" && <p className="mt-2 text-xs text-muted">Left on account after: <b>{rupee(Math.max(0, r2(room.cash - cashSum)))}</b></p>}
              {cash.kind === "new" && room.newCash > cashSum && <p className="mt-2 text-xs text-muted">Stays on account: <b>{rupee(r2(room.newCash - cashSum))}</b></p>}
            </div>
            <WhatHappens tone="emerald" items={[
              { icon: Wallet, text: "Each invoice's paid / balance / status update at once." },
              { icon: FileCheck2, text: "The received amount and the Received TDS list these invoices." },
              { icon: CalendarDays, text: "The CEO Dashboard's Received (Ex. Tax) moves within a minute." },
            ]} />
          </aside>

          <div className="lg:col-span-2">
            <DialogActions onCancel={onClose} busy={busy} tone="emerald" icon={Wallet}
              label={`Map ${rupee(r2(cashSum + (tdsOn ? tdsSum : 0)))}`} busyLabel="Mapping…"
              disabled={!!problem} hint={problem || undefined} onConfirm={submit} />
          </div>
        </div>
      )}
    </Modal>
  );
}

function Row({ icon: Icon, label, value, strong }: { icon: typeof Wallet; label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 py-0.5 ${strong ? "mt-1 border-t border-subtle pt-1.5 font-bold" : ""}`}>
      <span className="inline-flex items-center gap-1.5 text-secondary"><Icon size={13} /> {label}</span>
      <span className="tabular-nums text-primary">{value}</span>
    </div>
  );
}
