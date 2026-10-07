/** Reports ▸ Recruiter Productivity (rewritten 7 Oct 2026).
 *
 * The page a TA's numbers are shown on in a meeting, so every figure comes
 * from `GET /api/reports/recruiter-productivity` with its definition
 * (`meta.columns[].hint`) and nothing is computed here beyond the totals row.
 * Window presets (This month · Last month · This quarter · Last 90 days ·
 * All time) + From / To; the server returns the window it used and the
 * working days (Mon–Fri) the pace divides by. CSV = the same URL + format=csv.
 */
import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Download, Info } from "lucide-react";

import { authFetch } from "../../../api/client";
import { crmGet, qs } from "../../api";
import { toDateKey } from "../../lib/calendarDates";
import { CONTROL, Tile } from "../../components/controlTower";
import { ErrorBox, btnSecondary, useToast } from "../../components/ui";

export type ProductivityRow = {
  user_id: number;
  name: string;
  username: string;
  is_ta: boolean;
  candidates_added: number;
  applied: number;
  opening_emails: number;
  sent_for_screening: number;
  rmg_shortlisted: number;
  interviews_scheduled: number;
  submitted_to_sales: number;
  to_customer: number;
  selected: number;
  joined: number;
  rejected: number;
  days_active: number;
  per_day_avg: number;
};

export type ProductivityMeta = {
  window: { from: string; to: string; explicit_from: boolean };
  working_days: number;
  columns: { key: string; label: string; group: "sourcing" | "pipeline" | "outcome" | "pace"; hint: string }[];
};

const GROUPS: { key: ProductivityMeta["columns"][number]["group"]; label: string; cls: string }[] = [
  { key: "sourcing", label: "Sourcing", cls: "bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200" },
  { key: "pipeline", label: "Pipeline", cls: "bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-200" },
  { key: "outcome", label: "Outcome", cls: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  { key: "pace", label: "Pace", cls: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
];

type Preset = "month" | "last_month" | "quarter" | "90d" | "all";
const PRESETS: { key: Preset; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "quarter", label: "This quarter" },
  { key: "90d", label: "Last 90 days" },
  { key: "all", label: "All time" },
];

/** PURE — the From / To a preset means, as date keys (local calendar). */
export function presetRange(key: Preset, today = new Date()): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const t = toDateKey(today);
  if (key === "month") return { from: toDateKey(new Date(y, m, 1)), to: t };
  if (key === "last_month") return { from: toDateKey(new Date(y, m - 1, 1)), to: toDateKey(new Date(y, m, 0)) };
  if (key === "quarter") {
    // Indian FY quarters: Apr–Jun · Jul–Sep · Oct–Dec · Jan–Mar.
    const qStart = m - ((m - 3 + 12) % 3);
    return { from: toDateKey(new Date(y, qStart, 1)), to: t };
  }
  if (key === "90d") {
    const d = new Date(today);
    d.setDate(d.getDate() - 89);
    return { from: toDateKey(d), to: t };
  }
  return { from: "", to: "" };
}

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const num = (n: number) => n.toLocaleString("en-IN");

export function RecruiterProductivity() {
  const [toast, showToast] = useToast();
  const [preset, setPreset] = useState<Preset | null>("month");
  const [range, setRange] = useState(() => presetRange("month"));
  const [rows, setRows] = useState<ProductivityRow[]>([]);
  const [meta, setMeta] = useState<ProductivityMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [tick, setTick] = useState(0);
  const [onlyTa, setOnlyTa] = useState(true);

  const url = `/api/reports/recruiter-productivity${qs({ from: range.from, to: range.to })}`;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    crmGet<ProductivityRow[]>(url)
      .then((r) => {
        if (!alive) return;
        setRows(r.data || []);
        setMeta((r.meta as unknown as ProductivityMeta) || null);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setRows([]);
        setError(e?.message || "Failed to load the report");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [url, tick]);

  const pick = (key: Preset) => {
    setPreset(key);
    setRange(presetRange(key));
  };
  const setFrom = (v: string) => { setPreset(null); setRange((r) => ({ ...r, from: v })); };
  const setTo = (v: string) => { setPreset(null); setRange((r) => ({ ...r, to: v })); };

  const shown = useMemo(() => (onlyTa ? rows.filter((r) => r.is_ta) : rows), [rows, onlyTa]);
  const columns = useMemo(() => meta?.columns || [], [meta]);
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of columns) t[c.key] = 0;
    for (const r of shown) for (const c of columns) t[c.key] += Number((r as any)[c.key] || 0);
    if (meta) t.per_day_avg = Math.round((t.applied / Math.max(meta.working_days, 1)) * 100) / 100;
    return t;
  }, [shown, columns, meta]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await authFetch(`${url}${url.includes("?") ? "&" : "?"}format=csv`);
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `recruiter-productivity-${range.from || "all"}-to-${range.to || toDateKey(new Date())}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      showToast("CSV downloaded");
    } catch (e: any) {
      showToast(e?.message || "Export failed", "err");
    } finally {
      setExporting(false);
    }
  };

  const windowLabel = meta
    ? `${fmtDay(meta.window.from)} – ${fmtDay(meta.window.to)} · ${meta.working_days} working day${meta.working_days === 1 ? "" : "s"}`
    : "";

  return (
    <div className="space-y-4">
      {/* ---- window ---- */}
      <div className="rounded-card border border-subtle bg-surface-1 p-3 shadow-raised">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
            <CalendarRange className="h-3.5 w-3.5" /> Window
          </span>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Window presets">
            {PRESETS.map((p) => {
              const on = preset === p.key;
              return (
                <button key={p.key} type="button" role="tab" aria-selected={on} onClick={() => pick(p.key)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors ${
                    on ? "bg-brand-600 text-white ring-brand-600 shadow-raised" : "bg-surface-2 text-secondary ring-subtle hover:text-primary"
                  }`}>
                  {p.label}
                </button>
              );
            })}
          </div>
          <label className="ml-2 flex items-center gap-1.5 text-xs text-muted">
            From
            <input type="date" className={`${CONTROL} h-8 w-40 text-xs`} value={range.from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            To
            <input type="date" className={`${CONTROL} h-8 w-40 text-xs`} value={range.to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </label>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-secondary">
            <input type="checkbox" checked={onlyTa} onChange={(e) => setOnlyTa(e.target.checked)} className="h-3.5 w-3.5 accent-brand-600" />
            TA team only
          </label>
          <button className={btnSecondary} onClick={exportCsv} disabled={exporting || loading}>
            <Download size={15} /> {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
        {windowLabel && (
          <div className="mt-2 text-xs text-muted">
            {windowLabel}
            {meta && !meta.window.explicit_from && " · from the first recorded activity"}
          </div>
        )}
      </div>

      {error ? (
        <ErrorBox error={error} onRetry={() => setTick((t) => t + 1)} />
      ) : (
        <>
          {/* ---- totals ---- */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Tile label="Recruiters" value={loading ? "…" : num(shown.length)} tone="neutral" sub="listed in this window" />
            <Tile label="Applied" value={loading ? "…" : num(totals.applied || 0)} tone="brand" sub="candidacies raised" />
            <Tile label="Sent to screening" value={loading ? "…" : num(totals.sent_for_screening || 0)} tone="brand" sub="handed to RMG / GM" />
            <Tile label="Interviews booked" value={loading ? "…" : num(totals.interviews_scheduled || 0)} tone="brand" sub="AI L1 · manual rounds · slot invites" />
            <Tile label="Selected" value={loading ? "…" : num(totals.selected || 0)} tone="warning" sub="customer shortlisted" />
            <Tile label="Joined" value={loading ? "…" : num(totals.joined || 0)} tone="success" sub={`${num(totals.rejected || 0)} rejected / withdrawn`} />
          </div>

          {/* ---- the table ---- */}
          <div className="overflow-x-auto rounded-card border border-subtle bg-surface-1 shadow-raised">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th rowSpan={2} className="sticky left-0 z-10 bg-surface-1 px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-muted">Recruiter</th>
                  {GROUPS.map((g) => {
                    const n = columns.filter((c) => c.group === g.key).length;
                    return n ? (
                      <th key={g.key} colSpan={n} className={`px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-wider ${g.cls}`}>{g.label}</th>
                    ) : null;
                  })}
                </tr>
                <tr className="border-b border-subtle">
                  {GROUPS.flatMap((g) => columns.filter((c) => c.group === g.key)).map((c) => (
                    <th key={c.key} className="px-2 py-2 text-right text-[11px] font-semibold text-muted" title={c.hint}>
                      <span className="inline-flex items-center gap-0.5 whitespace-nowrap">{c.label}<Info className="h-3 w-3 opacity-50" aria-hidden /></span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={columns.length + 1} className="px-4 py-8 text-center text-xs text-muted">Loading…</td></tr>
                ) : shown.length === 0 ? (
                  <tr><td colSpan={columns.length + 1} className="px-4 py-8 text-center text-xs text-muted">No recruiter activity in this window.</td></tr>
                ) : (
                  shown.map((r) => (
                    <tr key={r.user_id} className="row-hover border-b border-subtle last:border-0">
                      <td className="sticky left-0 z-10 bg-surface-1 px-4 py-2">
                        <div className="font-semibold text-primary">{r.name}</div>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted">
                          {r.username && <span>{r.username}</span>}
                          {!r.is_ta && <span className="rounded-full bg-surface-2 px-1.5 py-0.5 font-semibold text-secondary ring-1 ring-inset ring-subtle">not in the TA role</span>}
                        </div>
                      </td>
                      {GROUPS.flatMap((g) => columns.filter((c) => c.group === g.key)).map((c) => {
                        const v = (r as any)[c.key] as number;
                        const zero = !v;
                        return (
                          <td key={c.key} className={`px-2 py-2 text-right tabular-nums ${zero ? "text-muted" : "font-semibold text-primary"}`}>
                            {c.key === "per_day_avg" ? v.toFixed(2) : num(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
              {!loading && shown.length > 1 && (
                <tfoot>
                  <tr className="border-t-2 border-subtle bg-surface-2">
                    <td className="sticky left-0 z-10 bg-surface-2 px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted">Total</td>
                    {GROUPS.flatMap((g) => columns.filter((c) => c.group === g.key)).map((c) => (
                      <td key={c.key} className="px-2 py-2 text-right text-sm font-bold tabular-nums text-primary">
                        {c.key === "per_day_avg" ? (totals.per_day_avg || 0).toFixed(2) : c.key === "days_active" ? "—" : num(totals[c.key] || 0)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* ---- definitions, so the meeting argues about work, not maths ---- */}
          {columns.length > 0 && (
            <details className="rounded-card border border-subtle bg-surface-1 px-4 py-3 text-xs text-secondary">
              <summary className="cursor-pointer font-semibold text-primary">How each column is counted</summary>
              <dl className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {columns.map((c) => (
                  <div key={c.key} className="flex gap-2">
                    <dt className="w-28 shrink-0 font-semibold text-primary">{c.label}</dt>
                    <dd className="text-muted">{c.hint}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-muted">Every figure is counted inside the window above, attributed by the record the application stamps for that action — never guessed from who touched the profile first.</p>
            </details>
          )}
        </>
      )}
      {toast}
    </div>
  );
}
