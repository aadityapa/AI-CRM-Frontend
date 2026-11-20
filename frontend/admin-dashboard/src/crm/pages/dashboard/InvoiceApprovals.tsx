/**
 * Invoice approvals — the Admin / CEO Dashboard tab (20 Nov 2026, user ask:
 * "after everything about an invoice is done — payment collected, TDS collected
 * — it goes to Admin / CEO for approval; give a tab on the Dashboard").
 *
 * Server: `GET /api/dashboard/invoice-approvals` (Admin / CEO by role,
 * `services/invoice_closure.approval_queue`). Every issued tax invoice in the
 * data window is in exactly one state:
 *   ready     — customer approved, IRN, collected in full, TDS received → approve
 *   changed   — approved, but money / TDS was taken back since → re-approve or undo
 *   waiting   — not ready yet; the row names what is missing
 *   approved  — signed off
 * Approve one or many (`POST /api/invoices/closure-approval/bulk`), undo with a reason.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, BadgeCheck, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, ExternalLink, Hourglass,
  IndianRupee, ListChecks, Mail, RefreshCw, RotateCcw, Search, ShieldCheck,
} from "lucide-react";

import { DESK_CHANGED_EVENT, crmGet, crmPost, qs } from "../../api";
import { CrmLink } from "../../routerHooks";
import { CONTROL, ICON_BTN, Tile, inrCompact, num } from "../../components/controlTower";
import { DecisionDialog, type DecisionSpec } from "../../components/dialogKit";
import { ErrorBox, SkeletonText, useToast } from "../../components/ui";
import { useSessionState } from "../../lib/pageState";
import { fmtDateShort, fmtDateTime12 } from "../../../lib/datetime";

/** Rupees with paise — an invoice figure is exact. */
const inr = (v: number | null | undefined): string =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type ClosureCheck = { key: string; label: string; ok: boolean; detail: string };
export type ClosureState = "ready" | "changed" | "waiting" | "approved";

export type ApprovalRow = {
  id: number; invoice_number: string | null; invoice_date: string | null;
  customer_id: number | null; customer: string | null; branch: string | null; employee: string | null;
  month: string | null; month_label: string | null; period_label: string | null;
  sub_total: number; grand_total: number; cash: number;
  tds_amount: number; tds_received: number; tds_pending: number; adjusted: number; balance: number;
  last_payment_date: string | null; waiting_days: number | null;
  checks: ClosureCheck[]; done: number; missing: string | null;
  state: ClosureState; state_label: string;
  approved_at: string | null; approved_by_name: string | null; note: string | null;
};

type Meta = {
  total: number; page: number; limit: number; state: string;
  counts: Record<ClosureState, number>; amounts: Record<ClosureState, number>;
  summary: {
    ready: number; ready_amount: number; changed: number;
    approved_this_month: number; approved_this_month_amount: number;
    waiting: number; waiting_amount: number; oldest_ready_days: number;
    missing: { label: string; count: number }[];
  };
  options: { customers: { id: number; name: string }[]; months: { key: string; label: string }[] };
};

type Filters = { state: ClosureState | "all"; customer: number | null; month: string; search: string };
const EMPTY: Filters = { state: "ready", customer: null, month: "", search: "" };
const PAGE = 25;

export const STATE_LOOK: Record<ClosureState, { label: string; chip: string; dot: string }> = {
  ready: { label: "Ready for your approval", chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200", dot: "bg-emerald-500" },
  changed: { label: "Changed after approval", chip: "bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200", dot: "bg-rose-500" },
  waiting: { label: "Not ready yet", chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200", dot: "bg-amber-500" },
  approved: { label: "Approved", chip: "bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200", dot: "bg-sky-500" },
};
const PILLS: (ClosureState | "all")[] = ["ready", "changed", "waiting", "approved", "all"];

/** Which ticked rows can be approved now. PURE — exported for tests. */
export function approvable(rows: ApprovalRow[], picked: Set<number>): ApprovalRow[] {
  return rows.filter((r) => picked.has(r.id) && (r.state === "ready" || r.state === "changed")
    && r.checks.every((c) => c.ok));
}

/** "Cash ₹x + TDS ₹y + adjusted ₹z" — how the invoice was collected. PURE. */
export function collectedLine(r: Pick<ApprovalRow, "cash" | "tds_received" | "tds_amount" | "adjusted">): string {
  const parts = [`Cash ${inr(r.cash)}`];
  if (r.tds_amount > 0) parts.push(`TDS ${inr(r.tds_received)}${r.tds_received < r.tds_amount ? ` of ${inr(r.tds_amount)}` : ""}`);
  if (r.adjusted > 0) parts.push(`adjusted ${inr(r.adjusted)}`);
  return parts.join(" + ");
}

/** The five checks as dots — green done, amber still to do. */
export function CheckDots({ checks }: { checks: ClosureCheck[] }) {
  return (
    <ul className="flex items-center gap-1" aria-label={`${checks.filter((c) => c.ok).length} of ${checks.length} done`}>
      {checks.map((c) => (
        <li key={c.key} title={`${c.label} — ${c.detail}`}
          className={`flex h-5 w-5 items-center justify-center rounded-full ${c.ok ? "bg-emerald-500 text-white" : "border border-amber-400 bg-amber-50 text-amber-600 dark:bg-amber-950/40"}`}>
          {c.ok ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <CircleDashed className="h-3 w-3" aria-hidden />}
          <span className="sr-only">{c.label}: {c.ok ? "done" : c.detail}</span>
        </li>
      ))}
    </ul>
  );
}

export function approveSpec(count: number, amount: number, first?: string | null): DecisionSpec {
  return {
    tone: "emerald", icon: BadgeCheck, eyebrow: "Admin / CEO approval",
    title: count === 1 ? `Approve ${first || "this invoice"}` : `Approve ${count} invoices`,
    intro: <>{count === 1 ? "This invoice is" : "These invoices are"} collected in full ({inr(amount)} incl. GST) and the TDS is received. Approving closes {count === 1 ? "it" : "them"}.</>,
    flow: { steps: ["Issued", "Customer approved", "e-Invoice", "Collected + TDS", "Your approval"], current: 4 },
    reason: { label: "Note (optional)", placeholder: "e.g. Checked against the bank statement",
      picks: ["Checked against the bank statement", "TDS matched with Form 26AS", "All good — close it"] },
    happens: [
      { icon: ShieldCheck, text: "Step 4 of the invoice reads Approved, with your name and the time." },
      { icon: Mail, text: "Finance gets a bell and an email." },
      { icon: RotateCcw, text: "You can undo it later with a reason." },
    ],
    confirmLabel: count === 1 ? "Approve & close" : `Approve ${count} invoices`, busyLabel: "Approving…",
  };
}

export function undoSpec(number?: string | null): DecisionSpec {
  return {
    tone: "rose", icon: RotateCcw, eyebrow: "Admin / CEO approval", title: `Undo the approval of ${number || "this invoice"}`,
    intro: <>The invoice goes back to waiting for your approval — for a click made by mistake, or money that was mapped wrongly.</>,
    reason: { label: "Why", required: true, min: 10,
      picks: ["Payment was mapped to the wrong invoice", "TDS needs to be checked again", "Approved by mistake"] },
    happens: [{ icon: Hourglass, text: "It shows again under Ready for your approval (or Not ready yet)." }],
    confirmLabel: "Undo approval", busyLabel: "Undoing…",
  };
}

export function InvoiceApprovals() {
  const [f, setF] = useSessionState<Filters>("dash.invoiceApprovals", EMPTY);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(f.search);
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<null | { kind: "approve"; rows: ApprovalRow[] } | { kind: "undo"; row: ApprovalRow }>(null);
  const [toast, showToast] = useToast();

  useEffect(() => {
    const t = window.setTimeout(() => setF((x) => (x.search === search ? x : { ...x, search })), 350);
    return () => window.clearTimeout(t);
  }, [search, setF]);
  useEffect(() => { setPage(1); setPicked(new Set()); }, [f.state, f.customer, f.month, f.search]);

  const url = `/api/dashboard/invoice-approvals${qs({
    state: f.state, customer_id: f.customer ?? undefined, month: f.month || undefined,
    search: f.search || undefined, page, limit: PAGE,
  })}`;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    crmGet<ApprovalRow[]>(url)
      .then((r) => { if (!alive) return; setRows(r.data || []); setMeta(r.meta as unknown as Meta); setError(""); })
      .catch((e) => { if (alive) setError(e?.message || "Could not load the invoice approvals"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    const on = () => reload();
    window.addEventListener(DESK_CHANGED_EVENT, on);
    return () => window.removeEventListener(DESK_CHANGED_EVENT, on);
  }, [reload]);

  const set = (patch: Partial<Filters>) => setF((x) => ({ ...x, ...patch }));
  const s = meta?.summary;
  const pages = meta ? Math.max(1, Math.ceil(meta.total / PAGE)) : 1;
  const selectable = rows.filter((r) => r.state === "ready" || (r.state === "changed" && r.checks.every((c) => c.ok)));
  const toApprove = useMemo(() => approvable(rows, picked), [rows, picked]);
  const allPicked = selectable.length > 0 && selectable.every((r) => picked.has(r.id));
  const toggle = (id: number) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <section className="space-y-4" aria-label="Invoice approvals">
      <div className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-emerald-600 via-teal-600 to-sky-600 px-5 py-4 text-white">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card bg-white/20 shadow-raised">
              <BadgeCheck className="h-6 w-6" aria-hidden />
            </span>
            <div className="min-w-0">
              <h3 className="text-display text-lg font-bold">Invoice approvals</h3>
              <p className="text-xs text-white/85">Customer approved · e-Invoice · collected in full · TDS received → your sign-off closes the invoice.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {toApprove.length > 0 && (
              <button type="button" onClick={() => setDialog({ kind: "approve", rows: toApprove })}
                className="inline-flex h-9 items-center gap-1.5 rounded-control bg-[#fff] px-3 text-sm font-bold text-emerald-700 shadow-raised hover:brightness-95">
                <BadgeCheck className="h-4 w-4" aria-hidden /> Approve {toApprove.length} selected
              </button>
            )}
            <button type="button" onClick={reload} aria-label="Refresh" title="Refresh"
              className="inline-flex h-9 w-9 items-center justify-center rounded-control bg-white/15 hover:bg-white/25">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            </button>
          </div>
        </div>

        {s && (
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
            <Tile label="Ready for your approval" value={num(s.ready)} tone="success" active={f.state === "ready"}
              onClick={() => set({ state: "ready" })} sub={`${inr(s.ready_amount)} collected in full`} />
            <Tile label="Oldest waiting" value={s.ready ? `${num(s.oldest_ready_days)} d` : "—"} tone={s.oldest_ready_days > 7 ? "warning" : "neutral"}
              onClick={() => set({ state: "ready" })} sub={s.ready ? "since the last money came in" : "nothing waiting"} />
            <Tile label="Changed after approval" value={num(s.changed)} tone={s.changed ? "danger" : "neutral"} active={f.state === "changed"}
              onClick={() => set({ state: "changed" })} sub={s.changed ? "money or TDS taken back since" : "none"} />
            <Tile label="Approved this month" value={num(s.approved_this_month)} tone="brand" active={f.state === "approved"}
              onClick={() => set({ state: "approved" })} sub={inrCompact(s.approved_this_month_amount)} />
            <Tile label="Not ready yet" value={num(s.waiting)} tone="warning" active={f.state === "waiting"}
              onClick={() => set({ state: "waiting" })} sub={`${inrCompact(s.waiting_amount)} still in progress`} />
          </div>
        )}

        <div className="space-y-3 border-t border-subtle px-4 py-3">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Approval state">
            {PILLS.map((k) => {
              const active = f.state === k;
              const count = k === "all" ? (meta ? Object.values(meta.counts).reduce((a, b) => a + b, 0) : null)
                : meta?.counts[k] ?? null;
              return (
                <button key={k} type="button" role="tab" aria-selected={active} onClick={() => set({ state: k })}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${active ? "border-emerald-500 bg-emerald-600 text-white" : "border-subtle bg-surface-1 text-secondary hover:bg-surface-2"}`}>
                  {k !== "all" && <span className={`h-2 w-2 rounded-full ${STATE_LOOK[k].dot}`} aria-hidden />}
                  {k === "all" ? "All invoices" : STATE_LOOK[k].label}
                  {count != null && <span className={`rounded-full px-1.5 tabular-nums ${active ? "bg-white/25" : "bg-surface-2"}`}>{count}</span>}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Invoice, customer, employee, month"
                aria-label="Search" className={`${CONTROL} w-64 pl-8`} />
            </label>
            <select className={`${CONTROL} w-56`} value={f.customer ?? ""} aria-label="Customer"
              onChange={(e) => set({ customer: e.target.value ? Number(e.target.value) : null })}>
              <option value="">All customers</option>
              {meta?.options.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className={`${CONTROL} w-44`} value={f.month} aria-label="Work month" onChange={(e) => set({ month: e.target.value })}>
              <option value="">All work months</option>
              {meta?.options.months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            {(f.customer || f.month || f.search) && (
              <button type="button" className="text-xs font-semibold text-brand-600 hover:underline"
                onClick={() => { setSearch(""); set({ customer: null, month: "", search: "" }); }}>Clear filters</button>
            )}
          </div>
          {f.state === "waiting" && s && s.missing.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-semibold text-secondary">Still to do:</span>
              {s.missing.map((m) => (
                <span key={m.label} className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  {m.label} · {m.count}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <ErrorBox error={error} onRetry={reload} />}

      <div className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
        {loading && !rows.length ? (
          <div className="p-4"><SkeletonText lines={4} /></div>
        ) : !rows.length ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <ListChecks className="h-8 w-8 text-muted" aria-hidden />
            <p className="text-sm font-semibold text-primary">
              {f.state === "ready" ? "Nothing is waiting for your approval" : "No invoice here"}
            </p>
            <p className="text-xs text-muted">
              {f.state === "ready" ? "An invoice shows here once it is collected in full and its TDS is received." : "Try another state or clear the filters."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-surface-2 text-left text-[11px] font-bold uppercase tracking-wide text-muted">
                <tr>
                  <th className="w-10 px-3 py-2">
                    {selectable.length > 0 && (
                      <input type="checkbox" aria-label="Select all ready invoices" checked={allPicked}
                        onChange={() => setPicked(allPicked ? new Set() : new Set(selectable.map((r) => r.id)))} />
                    )}
                  </th>
                  <th className="px-3 py-2">Invoice</th>
                  <th className="px-3 py-2">Customer · for</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Collected</th>
                  <th className="px-3 py-2">Checks</th>
                  <th className="px-3 py-2">Where it stands</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {rows.map((r) => {
                  const look = STATE_LOOK[r.state];
                  const canPick = r.state === "ready" || (r.state === "changed" && r.checks.every((c) => c.ok));
                  return (
                    <tr key={r.id} className={`align-top hover:bg-surface-2/60 ${picked.has(r.id) ? "bg-emerald-50/60 dark:bg-emerald-950/20" : ""}`}>
                      <td className="px-3 py-3">
                        {canPick && <input type="checkbox" aria-label={`Select ${r.invoice_number}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} />}
                      </td>
                      <td className="px-3 py-3">
                        <CrmLink to={`invoices/${r.id}`} className="font-bold text-brand-600 hover:underline">{r.invoice_number || `#${r.id}`}</CrmLink>
                        <div className="text-[11px] text-muted">{r.invoice_date ? fmtDateShort(r.invoice_date) : "—"}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-primary">{r.customer || "—"}</div>
                        <div className="text-[11px] text-muted">
                          {[r.branch, r.employee, r.period_label || r.month_label].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-bold tabular-nums text-primary">{inr(r.grand_total)}</td>
                      <td className="px-3 py-3">
                        <div className="text-xs text-secondary">{collectedLine(r)}</div>
                        {r.balance > 0 && <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">{inr(r.balance)} still to collect</div>}
                        {r.tds_pending > 0 && <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">TDS {inr(r.tds_pending)} pending from client</div>}
                        {r.last_payment_date && <div className="text-[11px] text-muted">last money {fmtDateShort(r.last_payment_date)}</div>}
                      </td>
                      <td className="px-3 py-3"><CheckDots checks={r.checks} /><div className="mt-1 text-[11px] text-muted">{r.done} of {r.checks.length}</div></td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${look.chip}`}>{look.label}</span>
                        {r.state === "ready" && r.waiting_days != null && (
                          <div className={`mt-1 text-[11px] ${r.waiting_days > 7 ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted"}`}>
                            waiting {r.waiting_days} d
                          </div>
                        )}
                        {r.state === "waiting" && r.missing && <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">Next: {r.missing}</div>}
                        {(r.state === "approved" || r.state === "changed") && (
                          <div className="mt-1 text-[11px] text-muted">
                            by <b className="text-secondary">{r.approved_by_name || "Admin"}</b>{r.approved_at ? ` · ${fmtDateTime12(r.approved_at)}` : ""}
                          </div>
                        )}
                        {r.state === "changed" && (
                          <div className="mt-1 flex items-center gap-1 text-[11px] text-rose-700 dark:text-rose-300">
                            <AlertTriangle className="h-3 w-3" aria-hidden /> {r.missing ? `${r.missing} no longer done` : "Re-approve the new figures"}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {canPick && (
                            <button type="button" onClick={() => setDialog({ kind: "approve", rows: [r] })}
                              className="inline-flex h-8 items-center gap-1 rounded-control bg-gradient-to-r from-emerald-600 to-teal-600 px-3 text-xs font-bold text-white shadow-raised hover:brightness-110">
                              <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> {r.state === "changed" ? "Re-approve" : "Approve"}
                            </button>
                          )}
                          {(r.state === "approved" || r.state === "changed") && (
                            <button type="button" onClick={() => setDialog({ kind: "undo", row: r })}
                              className="inline-flex h-8 items-center gap-1 rounded-control border border-rose-200 bg-rose-50 px-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Undo
                            </button>
                          )}
                          <CrmLink to={`invoices/${r.id}`} className={`${ICON_BTN} h-8 w-8`} aria-label={`Open ${r.invoice_number}`} title="Open the invoice">
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                          </CrmLink>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {meta && meta.total > PAGE && (
          <div className="flex items-center justify-between border-t border-subtle px-4 py-2 text-xs text-muted">
            <span>{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, meta.total)} of {meta.total} · {inr(meta.amounts[f.state as ClosureState] ?? 0)}</span>
            <div className="flex items-center gap-1">
              <button type="button" className={ICON_BTN} disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
              <span className="px-1 tabular-nums">{page} / {pages}</span>
              <button type="button" className={ICON_BTN} disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        )}
      </div>

      {dialog?.kind === "approve" && (
        <DecisionDialog
          spec={approveSpec(dialog.rows.length, dialog.rows.reduce((a, r) => a + r.grand_total, 0), dialog.rows[0]?.invoice_number)}
          person={dialog.rows.length === 1 ? { name: dialog.rows[0].customer || "Customer", meta: <><IndianRupee className="inline h-3 w-3" /> {collectedLine(dialog.rows[0])}</> } : null}
          onClose={() => setDialog(null)}
          onConfirm={async (note) => {
            const res = await crmPost<{ approved: number[]; skipped: { invoice_number: string | null; reason: string }[] }>(
              "/api/invoices/closure-approval/bulk", { invoice_ids: dialog.rows.map((r) => r.id), note: note.trim() || null });
            const skipped = res.data?.skipped || [];
            showToast(res.message + (skipped.length ? ` — ${skipped[0].invoice_number}: ${skipped[0].reason}` : ""), skipped.length ? "err" : "ok");
            setDialog(null); setPicked(new Set()); reload();
          }} />
      )}
      {dialog?.kind === "undo" && (
        <DecisionDialog spec={undoSpec(dialog.row.invoice_number)} onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            const res = await crmPost(`/api/invoices/${dialog.row.id}/closure-approval/undo`, { reason: reason.trim() });
            showToast(res.message || "Approval undone");
            setDialog(null); reload();
          }} />
      )}
      {toast}
    </section>
  );
}
