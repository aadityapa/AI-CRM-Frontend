/**
 * Proformas Finance RETURNED — on the Dashboard of the Sales Manager / Sales
 * Head, RMG / GM, Sales and Finance (26 Oct 2026, user ask: "when Finance
 * rejects a Proforma, show which month and why, then we check the timesheet,
 * update and submit").
 *
 * One row per returned Proforma (`GET /api/dashboard/returned-proformas`):
 * the work month, employee, customer, PI number + amount, Finance's reason,
 * who returned it and when, and WHOSE MOVE it is now (server `step`):
 *   to_correct → check the timesheet: Reopen to correct (or the GM reissues)
 *   correcting → reopened: correct and submit
 *   resubmitted → the GM approves
 *   reissue → approved again: the GM raises the Proforma
 * "Reopen to correct" posts `/api/timesheets/{id}/reopen-for-correction`.
 * Renders nothing for a login the server refuses (403).
 */
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, CalendarRange, CheckCircle2, FileWarning, PencilLine, RefreshCw, RotateCcw, Search, Send, X,
} from "lucide-react";

import { DESK_CHANGED_EVENT, crmGet, crmPost, qs } from "../../api";
import { CrmLink } from "../../routerHooks";
import { CONTROL, inr } from "../../components/controlTower";
import { DecisionDialog, type DecisionSpec } from "../../components/dialogKit";
import { useSessionState } from "../../lib/pageState";

export type ReturnedRow = {
  invoice_id: number; proforma_number: string; amount: number; part: number | null; po_number: string | null;
  returned_reason: string | null; returned_at: string | null; returned_by: string | null; days_since: number | null;
  customer_id: number | null; customer: string | null; project_id: number | null; project: string | null;
  employee_id: number | null; employee: string | null; employee_code: string | null;
  month: string | null; month_label: string | null; period_label: string | null;
  timesheet_id: number | null; timesheet_status: string | null;
  step: StepKey; step_label: string; step_who: string;
};
type StepKey = "to_correct" | "correcting" | "resubmitted" | "reissue" | "manual";
type Meta = {
  total: number; counts: Record<string, number>;
  steps: { key: StepKey; label: string; who: string }[];
  options: { customers: { id: number; name: string }[]; months: { key: string; label: string }[] };
  can_reopen: boolean; can_reissue: boolean;
};
type Filters = { step: string; customer: string; month: string; search: string };
const EMPTY: Filters = { step: "", customer: "", month: "", search: "" };

/** One colour + short words per step. */
export const STEP_LOOK: Record<StepKey, { short: string; chip: string }> = {
  to_correct: { short: "Check & correct", chip: "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-500/30" },
  correcting: { short: "Being corrected", chip: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-500/30" },
  resubmitted: { short: "GM to approve", chip: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-500/30" },
  reissue: { short: "GM to raise again", chip: "bg-indigo-50 text-indigo-800 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:ring-indigo-500/30" },
  manual: { short: "No timesheet", chip: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-200 dark:ring-slate-500/30" },
};

/** "today" · "1 day ago" · "N days ago". PURE. */
export function agoText(days: number | null | undefined): string {
  if (days == null) return "";
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export const REOPEN_SPEC: DecisionSpec = {
  tone: "rose", icon: RotateCcw, eyebrow: "Finance returned the Proforma", title: "Reopen the timesheet to correct it",
  intro: "The approved timesheet goes back to Rejected so it can be corrected and submitted again. The GM approves it and raises the Proforma again — it keeps the same PI number.",
  flow: { steps: ["Returned by Finance", "Correct & submit", "GM approves", "Proforma raised again"], current: 1 },
  reason: { label: "Note (optional)", required: false, placeholder: "What you will change",
    picks: ["Fixing the leave days", "Fixing the hours", "Fixing the period", "Fixing the rate"] },
  happens: [
    { icon: PencilLine, text: "The timesheet opens for editing (status Rejected, with Finance's reason on it)." },
    { icon: Send, text: "Whoever filled it is told; submit it again when it is right." },
    { icon: RotateCcw, text: "Leave and comp-off taken on it are put back until it is submitted again." },
  ],
  confirmLabel: "Reopen to correct", busyLabel: "Reopening…",
};

/** `embedded` (26 Oct 2026): rendered inside My Tasks ▸ Returned Proformas — the
 *  tile already names it, so no rose header and no outer card. The Dashboard
 *  shows a tile only (B-V2 `work_desk._returned_pi_tab`). */
export function ReturnedProformasPanel({ embedded = false, onChanged }: { embedded?: boolean; onChanged?: () => void } = {}) {
  const [f, setF] = useSessionState<Filters>("dash.returnedPi", EMPTY);
  const [text, setText] = useState(f.search);
  const [rows, setRows] = useState<ReturnedRow[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [hidden, setHidden] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [reopen, setReopen] = useState<ReturnedRow | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { if (text !== f.search) setF({ ...f, search: text }); }, 350);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    setLoading(true);
    crmGet<ReturnedRow[]>(`/api/dashboard/returned-proformas${qs({
      step: f.step || undefined, customer_id: f.customer || undefined, month: f.month || undefined,
      search: f.search.trim() || undefined,
    })}`)
      .then((res) => { if (live) { setRows(res.data || []); setMeta(res.meta as unknown as Meta); setErr(null); } })
      .catch((e: any) => {
        if (!live) return;
        if (e?.status === 403) setHidden(true);
        else setErr(e?.message || "Could not load the returned Proformas");
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [JSON.stringify(f), tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real time, like the work desk: every minute while visible, and after any change here.
  useEffect(() => {
    const bump = () => { if (document.visibilityState !== "hidden") setTick((t) => t + 1); };
    const timer = window.setInterval(bump, 60_000);
    window.addEventListener(DESK_CHANGED_EVENT, bump);
    document.addEventListener("visibilitychange", bump);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(DESK_CHANGED_EVENT, bump);
      document.removeEventListener("visibilitychange", bump);
    };
  }, []);

  const filtered = !!(f.customer || f.month || f.search || f.step);
  const chips = useMemo(() => [
    { key: "", label: "All returned", count: meta?.counts.all },
    ...(meta?.steps || []).filter((s) => s.key !== "manual" || (meta?.counts.manual || 0) > 0)
      .map((s) => ({ key: s.key, label: STEP_LOOK[s.key]?.short || s.label, count: meta?.counts[s.key] })),
  ], [meta]);

  if (hidden) return null;
  const allCount = meta?.counts.all ?? 0;
  if (!loading && !err && !filtered && allCount === 0) {
    return (
      <div className="flex items-center gap-2 rounded-card border border-subtle bg-surface-1 px-4 py-2.5 text-sm text-secondary shadow-raised">
        <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> No Proforma is waiting on a correction — Finance has returned nothing.
      </div>
    );
  }

  return (
    <section className={embedded ? "" : "overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised"} aria-label="Proformas returned by Finance">
      {!embedded && <header className="bg-gradient-to-r from-rose-600 via-pink-600 to-orange-500 px-5 py-4 text-[#fff]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-[#fff]/15 ring-1 ring-[#fff]/25">
              <FileWarning className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#fff]/75">Finance sent these back</div>
              <h2 className="text-lg font-bold leading-tight">Returned Proformas · {allCount}</h2>
              <p className="text-xs text-[#fff]/85">Which month, why, and whose move it is — check the timesheet, correct it and submit again.</p>
            </div>
          </div>
          <button type="button" onClick={() => setTick((n) => n + 1)} title="Refresh"
            className="inline-flex h-9 w-9 items-center justify-center rounded-control bg-[#fff]/15 ring-1 ring-[#fff]/25 hover:bg-[#fff]/25">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
          </button>
        </div>
      </header>}

      <div className="space-y-3 border-b border-subtle px-5 py-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Whose move">
          {chips.map((c) => {
            const on = f.step === c.key;
            return (
              <button key={c.key || "all"} type="button" role="tab" aria-selected={on} onClick={() => setF({ ...f, step: c.key })}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-micro ${on
                  ? "border-rose-500 bg-rose-50 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200"
                  : "border-subtle bg-surface-1 text-secondary hover:bg-surface-2"}`}>
                {c.label}
                <span className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums ${on ? "bg-rose-600 text-[#fff]" : "bg-surface-2 text-muted"}`}>
                  {c.count ?? "…"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Search</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <input type="text" value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Employee, PI no., reason…" className={`${CONTROL} w-60 pl-8`} />
          </label>
          <select className={`${CONTROL} w-56`} value={f.customer} aria-label="Customer"
            onChange={(e) => setF({ ...f, customer: e.target.value })}>
            <option value="">All customers</option>
            {(meta?.options.customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className={`${CONTROL} w-44`} value={f.month} aria-label="Work month"
            onChange={(e) => setF({ ...f, month: e.target.value })}>
            <option value="">All months</option>
            {(meta?.options.months || []).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          {filtered && (
            <button type="button" onClick={() => { setText(""); setF(EMPTY); }}
              className="inline-flex h-9 items-center gap-1 rounded-control px-2.5 text-xs font-semibold text-secondary hover:bg-surface-2">
              <X className="h-3.5 w-3.5" aria-hidden /> Clear filters
            </button>
          )}
          <span className="ml-auto text-xs text-muted">{meta ? `${meta.total} shown` : ""}</span>
        </div>
        {done && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-success">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {done}
          </p>
        )}
      </div>

      {err ? <p className="px-5 py-6 text-sm font-semibold text-danger">{err}</p>
        : !loading && rows.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted">Nothing returned for these filters.</p>
        : (
          <ul className={`divide-y divide-[var(--border-subtle)] ${loading ? "opacity-60" : ""}`}>
            {rows.map((r) => (
              <ReturnedRowView key={r.invoice_id} r={r} canReopen={!!meta?.can_reopen} canReissue={!!meta?.can_reissue}
                onReopen={() => { setDone(null); setReopen(r); }} />
            ))}
          </ul>
        )}

      {reopen && (
        <DecisionDialog spec={REOPEN_SPEC}
          person={{ name: reopen.employee || "Timesheet", meta: <>{reopen.month_label}{reopen.customer ? ` · ${reopen.customer}` : ""}</> }}
          notice={<span><b>Finance said:</b> “{reopen.returned_reason}”</span>}
          onClose={() => setReopen(null)}
          onConfirm={async (note) => {
            await crmPost(`/api/timesheets/${reopen.timesheet_id}/reopen-for-correction`, { note: note || null });
            setDone(`${reopen.employee || "The"} timesheet for ${reopen.month_label} is open — correct it and submit again.`);
            setReopen(null);
            setTick((n) => n + 1);
            onChanged?.();
          }} />
      )}
    </section>
  );
}

function ReturnedRowView({ r, canReopen, canReissue, onReopen }: {
  r: ReturnedRow; canReopen: boolean; canReissue: boolean; onReopen: () => void;
}) {
  const look = STEP_LOOK[r.step] || STEP_LOOK.manual;
  return (
    <li className="row-hover grid gap-3 px-5 py-3.5 md:grid-cols-[9rem_minmax(0,1fr)_auto]">
      <div>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          <CalendarRange className="h-3.5 w-3.5" aria-hidden /> {r.month_label || "—"}
        </div>
        {r.period_label && <div className="mt-1 text-[11px] font-semibold text-sky-700 dark:text-sky-300">{r.period_label}</div>}
        <div className="mt-1 text-[11px] text-muted">Returned {agoText(r.days_since)}</div>
      </div>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-semibold text-primary">{r.employee || "Manual Proforma"}</span>
          {r.employee_code && <span className="text-xs text-muted">{r.employee_code}</span>}
          <span className="text-xs text-secondary">
            {r.customer_id ? <CrmLink to={`customers/${r.customer_id}`} className="hover:underline">{r.customer}</CrmLink> : r.customer}
            {r.project ? ` · ${r.project}` : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <CrmLink to={`invoices/${r.invoice_id}`} className="font-semibold text-brand-600 hover:underline dark:text-brand-300">{r.proforma_number}</CrmLink>
          <span className="tabular-nums text-secondary">{inr(r.amount)}</span>
          {r.part ? <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">Part {r.part}</span> : null}
          {r.po_number && <span className="text-muted">PO {r.po_number}</span>}
        </div>
        <blockquote className="rounded-control border-l-4 border-rose-400 bg-rose-50/70 px-3 py-1.5 text-sm text-rose-900 dark:bg-rose-950/30 dark:text-rose-100">
          “{r.returned_reason || "No reason given"}”
          <span className="mt-0.5 block text-[11px] text-rose-700/80 dark:text-rose-300/80">
            — {r.returned_by || "Finance"}{r.returned_at ? `, ${new Date(r.returned_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}
          </span>
        </blockquote>
      </div>
      <div className="flex flex-col items-start gap-2 md:items-end">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${look.chip}`} title={r.step_label}>
          {look.short} · {r.step_who}
        </span>
        <div className="flex flex-wrap gap-1.5 md:justify-end">
          {r.step === "to_correct" && canReopen && r.timesheet_id && (
            <button type="button" onClick={onReopen}
              className="inline-flex h-8 items-center gap-1.5 rounded-control bg-gradient-to-r from-rose-600 to-pink-600 px-3 text-xs font-semibold text-[#fff] hover:opacity-90">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reopen to correct
            </button>
          )}
          {r.timesheet_id && (
            <CrmLink to={`timesheets/${r.timesheet_id}`}
              className="inline-flex h-8 items-center gap-1 rounded-control border border-subtle bg-surface-1 px-3 text-xs font-semibold text-secondary hover:bg-surface-2">
              {r.step === "reissue" && canReissue ? "Raise Proforma again" : r.step === "correcting" ? "Correct & submit" : "Open timesheet"}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </CrmLink>
          )}
        </div>
      </div>
    </li>
  );
}
