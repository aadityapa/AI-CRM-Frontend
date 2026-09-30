/**
 * AI Costs (28 Sep 2026) — Admin / CEO only. `AiCostsPage` is the platform view
 * ("AI Costs" in the nav, view key `promptLogs`); `InterviewCostsTab` is the body.
 * The old Logs / Analytics tabs (raw prompt rows, token averages) were removed
 * with their API the same day — this page is the ONE place AI spend is read.
 *
 * The CEO's question: "what does each AI interview cost, and how much do we
 * spend on them per day / week / month / quarter / year?" Everything shown
 * comes from ONE call, `GET /api/ai-costs/interviews` (B-V2
 * `services/ai_interview_costs.py`): every OpenAI call is priced and attributed
 * to its interview at log time, this page only adds up what the server sends.
 *
 * Layout: header card (date presets · custom range · zoom · filters · CSV) →
 * KPI tiles → spend trend at the chosen zoom → three breakdown panels (by kind,
 * by customer, by template / TA) → the interview table (paged, sortable).
 * Rupees are USD × Settings ▸ `ai.usd_inr_rate`; the rate is printed so the
 * reader knows which conversion produced the number.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Search } from "lucide-react";
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { chartPalette, chartPaletteDark, radius } from "../design-system/tokens/tokens";
import { useTheme } from "../theme/ThemeProvider";
import {
  downloadInterviewCostsCsv, getInterviewCosts,
  type CostSort, type Granularity, type InterviewCostQuery, type InterviewCostReport, type InterviewCostRow,
} from "../api/aiCosts";
import { CONTROL, ICON_BTN, Panel, StepBars, Tile, tooltipStyle } from "../crm/components/controlTower";
import { isSuperAdmin } from "../lib/rbac";
import { ErrorBox, SkeletonText, btnSecondary, useToast } from "../crm/components/ui";
import { toDateKey } from "../crm/lib/calendarDates";
import { fmtDateTime12 } from "../lib/datetime";

/* ---------- money & number formatting ---------- */

const usd = (v: number | null | undefined, digits = 2) =>
  v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
/** Rupees — with paise under ₹100, where a single interview's AI cost lives
 *  (whole rupees printed ₹0 for a ₹0.40 interview). */
const inr = (v: number | null | undefined) =>
  v == null ? "—" : `₹${v.toLocaleString("en-IN", {
    minimumFractionDigits: v !== 0 && Math.abs(v) < 100 ? 2 : 0,
    maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0,
  })}`;
const num = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-IN"));

/* ---------- date presets ---------- */

const FY_START_MONTH = 3; // April (0-based)

type Preset = { key: string; label: string; range: () => [Date, Date]; zoom: Granularity };

function startOfFy(d: Date): Date {
  const y = d.getMonth() >= FY_START_MONTH ? d.getFullYear() : d.getFullYear() - 1;
  return new Date(y, FY_START_MONTH, 1);
}
function startOfQuarter(d: Date): Date {
  const offset = (d.getMonth() - FY_START_MONTH + 12) % 12;
  const m = d.getMonth() - (offset % 3);
  return new Date(d.getFullYear(), m, 1);
}

const PRESETS: Preset[] = [
  { key: "today", label: "Today", zoom: "day", range: () => { const t = new Date(); return [t, t]; } },
  { key: "7d", label: "Last 7 days", zoom: "day", range: () => { const t = new Date(); const s = new Date(t); s.setDate(t.getDate() - 6); return [s, t]; } },
  { key: "30d", label: "Last 30 days", zoom: "day", range: () => { const t = new Date(); const s = new Date(t); s.setDate(t.getDate() - 29); return [s, t]; } },
  { key: "month", label: "This month", zoom: "day", range: () => { const t = new Date(); return [new Date(t.getFullYear(), t.getMonth(), 1), t]; } },
  { key: "quarter", label: "This quarter", zoom: "week", range: () => { const t = new Date(); return [startOfQuarter(t), t]; } },
  { key: "fy", label: "This FY", zoom: "month", range: () => { const t = new Date(); return [startOfFy(t), t]; } },
  { key: "12m", label: "Last 12 months", zoom: "month", range: () => { const t = new Date(); const s = new Date(t); s.setMonth(t.getMonth() - 11); s.setDate(1); return [s, t]; } },
  { key: "3y", label: "Last 3 years", zoom: "quarter", range: () => { const t = new Date(); const s = new Date(t); s.setFullYear(t.getFullYear() - 3); s.setDate(s.getDate() + 1); return [s, t]; } },
];

const ZOOMS: { key: Granularity; label: string }[] = [
  { key: "day", label: "Daily" }, { key: "week", label: "Weekly" }, { key: "month", label: "Monthly" },
  { key: "quarter", label: "Quarterly" }, { key: "fy", label: "Yearly (FY)" },
];

const SORTS: { key: CostSort; label: string }[] = [
  { key: "cost", label: "Cost (high → low)" }, { key: "date_desc", label: "Newest first" },
  { key: "date", label: "Oldest first" }, { key: "candidate", label: "Candidate A–Z" },
  { key: "duration", label: "Longest first" }, { key: "tokens", label: "Most tokens" },
];

const STATUS_TONE: Record<string, string> = {
  completed: "bg-success-soft text-success", terminated: "bg-danger-soft text-danger",
  started: "bg-info-soft text-info", recovered: "bg-warning-soft text-warning",
  abandoned: "bg-warning-soft text-warning",
};

function StatusChip({ status }: { status: string }) {
  const cls = STATUS_TONE[status] || "bg-surface-2 text-muted";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${cls}`}>{status || "unknown"}</span>;
}

/* ---------- page ---------- */

/** The platform page. The nav already hides it from non-admins; this gate is
 * for a typed `?view=promptLogs` — the server's `role_required()` is the boundary. */
export function AiCostsPage({ roles }: { roles: string[] }) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-display text-2xl font-bold tracking-tight text-primary">AI Costs</h1>
        <p className="mt-1 text-sm text-secondary">
          What each AI interview costs — candidate, when, and how the money split between questions,
          voice and transcription — with daily to yearly spend. Admin / CEO only.
        </p>
      </header>
      {isSuperAdmin(roles) ? (
        <InterviewCostsTab />
      ) : (
        <ErrorBox error="AI Costs is available to Admin and CEO logins only." />
      )}
    </div>
  );
}

export function InterviewCostsTab() {
  const [toast, showToast] = useToast();
  const { theme } = useTheme();
  const palette = theme === "dark" ? chartPaletteDark : chartPalette;

  const [preset, setPreset] = useState<string>("30d");
  const [range, setRange] = useState<[string, string]>(() => {
    const [s, e] = PRESETS[2].range();
    return [toDateKey(s), toDateKey(e)];
  });
  const [zoom, setZoom] = useState<Granularity>("day");
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [customer, setCustomer] = useState<number | "">("");
  const [ta, setTa] = useState("");
  const [status, setStatus] = useState("");
  const [template, setTemplate] = useState("");
  const [sort, setSort] = useState<CostSort>("cost");
  const [page, setPage] = useState(1);
  const limit = 25;

  const [report, setReport] = useState<InterviewCostReport | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const query = useMemo<InterviewCostQuery>(() => ({
    date_from: range[0], date_to: range[1], granularity: zoom, search, customer_id: customer,
    ta, status, template, sort, page, limit,
  }), [range, zoom, search, customer, ta, status, template, sort, page]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await getInterviewCosts(query);
      setReport(res.data);
      setTotal(Number(res.meta?.total ?? res.data.interviews.length));
    } catch (e: any) {
      setError(e?.message || "Could not load interview costs");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  // Search is debounced so the report is not re-run on every keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => { setSearch(searchDraft.trim()); setPage(1); }, 350);
    return () => window.clearTimeout(t);
  }, [searchDraft]);

  const applyPreset = (key: string) => {
    const p = PRESETS.find((x) => x.key === key);
    if (!p) return;
    const [s, e] = p.range();
    setPreset(key);
    setRange([toDateKey(s), toDateKey(e)]);
    setZoom(p.zoom);
    setPage(1);
  };
  const setCustomRange = (which: 0 | 1, value: string) => {
    if (!value) return;
    setPreset("custom");
    setRange((r) => (which === 0 ? [value, r[1]] : [r[0], value]));
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadInterviewCostsCsv(query);
    } catch (e: any) {
      showToast(e?.message || "Export failed", "err");
    } finally {
      setExporting(false);
    }
  };

  const s = report?.summary;
  const rate = report?.usd_inr_rate ?? 0;
  const pages = Math.max(1, Math.ceil(total / limit));
  const chartData = (report?.series || []).map((b) => ({
    ...b, name: b.label,
  }));
  const kindSteps = (report?.by_kind || []).map((k, i) => ({
    label: k.label, value: k.cost_usd,
    cls: ["bg-brand-600", "bg-violet-500", "bg-accent-500"][i] || "bg-brand-600",
  }));

  return (
    <div className="space-y-6">
      {toast}

      {/* ---------- header: range · zoom · filters · export ---------- */}
      <header className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p.key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                preset === p.key ? "bg-brand-600 text-white shadow-raised" : "bg-surface-2 text-secondary hover:text-primary"
              }`}
            >
              {p.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <label className="text-xs font-semibold text-muted" htmlFor="ai-costs-from">From</label>
            <input id="ai-costs-from" type="date" className={`${CONTROL} w-40`} value={range[0]} max={range[1]}
              onChange={(e) => setCustomRange(0, e.target.value)} />
            <label className="text-xs font-semibold text-muted" htmlFor="ai-costs-to">To</label>
            <input id="ai-costs-to" type="date" className={`${CONTROL} w-40`} value={range[1]} min={range[0]}
              max={toDateKey(new Date())} onChange={(e) => setCustomRange(1, e.target.value)} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-control border border-subtle bg-surface-2 p-0.5" role="tablist" aria-label="Trend zoom">
            {ZOOMS.map((z) => (
              <button
                key={z.key}
                type="button"
                role="tab"
                aria-selected={zoom === z.key}
                onClick={() => setZoom(z.key)}
                className={`rounded-control px-3 py-1.5 text-xs font-semibold transition ${
                  zoom === z.key ? "bg-surface-1 text-brand-600 shadow-raised dark:text-brand-300" : "text-secondary hover:text-primary"
                }`}
              >
                {z.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              className={`${CONTROL} w-64 pl-9`}
              placeholder="Candidate, email, customer, opportunity…"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              aria-label="Search interviews"
            />
          </div>
          <select className={`${CONTROL} w-44`} value={customer} aria-label="Customer"
            onChange={(e) => { setCustomer(e.target.value ? Number(e.target.value) : ""); setPage(1); }}>
            <option value="">All customers</option>
            {(report?.options.customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className={`${CONTROL} w-40`} value={ta} aria-label="TA"
            onChange={(e) => { setTa(e.target.value); setPage(1); }}>
            <option value="">All TAs</option>
            {(report?.options.ta_owners || []).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className={`${CONTROL} w-44`} value={template} aria-label="Interview template"
            onChange={(e) => { setTemplate(e.target.value); setPage(1); }}>
            <option value="">All templates</option>
            {(report?.options.templates || []).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className={`${CONTROL} w-36`} value={status} aria-label="Status"
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {(report?.options.statuses || []).map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
          </select>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className={ICON_BTN} onClick={() => void load()} title="Refresh" aria-label="Refresh">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button type="button" className={btnSecondary} onClick={() => void exportCsv()} disabled={exporting}>
              <Download className="h-4 w-4" /> {exporting ? "Exporting…" : "Export CSV"}
            </button>
          </div>
        </div>
      </header>

      {error && <ErrorBox error={error} onRetry={() => void load()} />}
      {loading && !report && <SkeletonText lines={8} />}

      {report && s && (
        <>
          {/* ---------- KPIs ---------- */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Tile label="Interview spend" value={inr(s.cost_inr)}
              sub={`${usd(s.cost_usd)} · ${s.interviews} interviews${s.estimated_usd ? ` · incl. ${inr(s.estimated_usd * rate)} estimated` : ""}`} />
            <Tile label="Avg per interview" value={inr(s.avg_cost_inr)} sub={usd(s.avg_cost_usd, 4)} tone="neutral" />
            <Tile label="Interviews" value={num(s.interviews)} sub={`${s.completed} completed`} tone="success" />
            <Tile label="Avg duration" value={s.avg_duration_min == null ? "—" : `${s.avg_duration_min} min`} sub="completed interviews" tone="neutral" />
            <Tile label="AI calls" value={num(s.calls)} sub={s.failed_calls ? `${s.failed_calls} failed` : "no failures"} tone={s.failed_calls ? "warning" : "neutral"} />
            <Tile label="Tokens" value={num(s.tokens)} sub={`${s.audio_minutes} audio min`} tone="neutral" />
            <Tile label="Other AI spend" value={inr(s.other_spend_inr)} sub={`${usd(s.other_spend_usd)} · ATS, parsing, Ask AI`} tone="warning" />
            <Tile label="Total AI spend" value={inr(s.total_spend_inr)} sub={`${usd(s.total_spend_usd)} · @ ₹${rate}/$`} tone="danger" />
          </div>

          {/* ---------- trend ---------- */}
          <Panel
            title={`Spend trend — ${ZOOMS.find((z) => z.key === zoom)?.label.toLowerCase()}`}
            hint={`${report.period.date_from} → ${report.period.date_to} · USD per bucket; bars split by kind, line = interviews`}
          >
            <div className="h-72 w-full px-2 pb-3 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis yAxisId="usd" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${v}`} />
                  <YAxis yAxisId="n" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v: number, name: string) => (name === "Interviews" ? num(v) : usd(v, 4))}
                  />
                  <Legend />
                  <Bar yAxisId="usd" dataKey="cost_chat_usd" stackId="c" name="Chat (questions & evaluation)" fill={palette[0]} animationDuration={250} />
                  <Bar yAxisId="usd" dataKey="cost_tts_usd" stackId="c" name="Spoken questions (TTS)" fill={palette[1]} animationDuration={250} />
                  <Bar yAxisId="usd" dataKey="cost_stt_usd" stackId="c" name="Transcription (STT)" fill={palette[2]}
                    radius={[radius.input, radius.input, 0, 0]} animationDuration={250} />
                  <Line yAxisId="n" type="monotone" dataKey="interviews" name="Interviews" stroke={palette[3]} strokeWidth={2} dot={{ r: 3 }} animationDuration={250} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          {/* ---------- breakdowns ---------- */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Where the money goes" hint="per interview kind, this window">
              <div className="p-5">
                <StepBars steps={kindSteps} format={(v) => usd(v)} />
                {report.other_spend.families.length > 0 && (
                  <div className="mt-5 border-t border-subtle pt-3">
                    <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Not an interview</div>
                    <ul className="mt-2 space-y-1 text-sm">
                      {report.other_spend.families.map((f) => (
                        <li key={f.label} className="flex justify-between">
                          <span className="text-secondary">{f.label} <span className="text-muted">· {f.calls} calls</span></span>
                          <span className="tabular-nums font-semibold text-primary">{usd(f.cost_usd)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Panel>
            <GroupPanel title="By customer" hint="top customers by spend" rows={report.by_customer} />
            <GroupPanel title="By template & TA" hint="top interview templates · top TAs" rows={report.by_template} extra={report.by_ta} />
          </div>

          {/* ---------- interviews ---------- */}
          <Panel
            title="Interviews"
            hint={`${num(total)} in this window`}
            action={
              <select className={`${CONTROL} w-44`} value={sort} aria-label="Sort"
                onChange={(e) => { setSort(e.target.value as CostSort); setPage(1); }}>
                {SORTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-sm">
                <thead className="bg-surface-2 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
                  <tr>
                    <th className="px-4 py-2">Candidate</th>
                    <th className="px-4 py-2">Customer · Opportunity</th>
                    <th className="px-4 py-2">Template · TA</th>
                    <th className="px-4 py-2">When</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2 text-right">Duration</th>
                    <th className="px-4 py-2 text-right">Calls</th>
                    <th className="px-4 py-2 text-right">Tokens</th>
                    <th className="px-4 py-2 text-right">Audio</th>
                    <th className="px-4 py-2 text-right">Chat / TTS / STT</th>
                    <th className="px-4 py-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle">
                  {report.interviews.length === 0 && (
                    <tr><td colSpan={11} className="px-4 py-8 text-center text-sm text-muted">No AI interviews in this window.</td></tr>
                  )}
                  {report.interviews.map((r) => <Row key={r.interview_id} r={r} />)}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-between border-t border-subtle px-4 py-2 text-xs text-muted">
                <span>Page {page} of {pages}</span>
                <div className="flex gap-1">
                  <button type="button" className={ICON_BTN} disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">‹</button>
                  <button type="button" className={ICON_BTN} disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">›</button>
                </div>
              </div>
            )}
          </Panel>

          <p className="text-xs text-muted">
            Prices are applied per call at the moment it is logged (OpenAI list prices; override with
            <code className="mx-1">OPENAI_PRICING_JSON</code>). Rupees use Settings ▸ <code>ai.usd_inr_rate</code> = ₹{rate}/$.
            Chat calls are priced on the tokens OpenAI reports (cached prompt tokens at the cached rate); spoken
            questions on the measured length of the audio actually streamed; candidate speech on the audio tokens
            the transcription reports, else the recording's clip length.
            {s.estimated_interviews > 0 && (
              <> <b className="text-warning">{s.estimated_interviews} interview(s) ran before 28 Sep 2026</b>, when speech
              was not yet logged: their voice and transcription cost is <b>estimated</b> from the interview's own questions
              and answers (question text at ~15 characters a second, answers at ~150 words a minute) and marked
              "estimated". Their evaluation calls were matched to the session by time.</>
            )}
          </p>
        </>
      )}
    </div>
  );
}

function GroupPanel({ title, hint, rows, extra }: {
  title: string; hint: string; rows: InterviewCostReport["by_customer"]; extra?: InterviewCostReport["by_ta"];
}) {
  const steps = rows.slice(0, 8).map((g) => ({
    label: `${g.label} · ${g.interviews}`, value: g.cost_usd, cls: "bg-brand-600",
    hint: `${g.interviews} interview(s), avg ${usd(g.avg_cost_usd, 4)}`,
  }));
  return (
    <Panel title={title} hint={hint}>
      <div className="p-5">
        {steps.length ? <StepBars steps={steps} format={(v) => usd(v)} /> : <p className="text-sm text-muted">Nothing in this window.</p>}
        {extra && extra.length > 0 && (
          <div className="mt-5 border-t border-subtle pt-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">TA</div>
            <ul className="mt-2 space-y-1 text-sm">
              {extra.slice(0, 6).map((g) => (
                <li key={String(g.id)} className="flex justify-between">
                  <span className="text-secondary">{g.label} <span className="text-muted">· {g.interviews}</span></span>
                  <span className="tabular-nums font-semibold text-primary">{usd(g.cost_usd)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}

function Row({ r }: { r: InterviewCostRow }) {
  const profileHref = r.profile_id ? `/admin/?view=crm&p=profiles/${r.profile_id}&tab=ai` : null;
  return (
    <tr className="row-hover align-top">
      <td className="px-4 py-2">
        <div className="font-semibold text-primary">
          {profileHref ? <a className="hover:underline" href={profileHref}>{r.candidate_name}</a> : r.candidate_name}
        </div>
        <div className="text-xs text-muted">{r.candidate_email || "—"}</div>
        {r.ai_result && (
          <div className="mt-0.5 text-[11px] text-secondary">AI: {r.ai_result}{r.ai_score != null ? ` · ${r.ai_score}%` : ""}</div>
        )}
      </td>
      <td className="px-4 py-2">
        <div className="text-primary">{r.customer_name || <span className="text-muted">Not linked to CRM</span>}</div>
        {r.opp_id && <div className="text-xs text-muted">{r.opp_id} · {r.opportunity_title}</div>}
      </td>
      <td className="px-4 py-2">
        <div className="text-primary">{r.template_name || "—"}</div>
        <div className="text-xs text-muted">{r.ta_owner_name || r.scheduled_by || "—"}</div>
      </td>
      <td className="px-4 py-2 whitespace-nowrap">
        <div className="text-primary">{fmtDateTime12(r.started_at || r.first_at)}</div>
        {r.scheduled_at && <div className="text-xs text-muted">Sched. {r.scheduled_at}</div>}
      </td>
      <td className="px-4 py-2"><StatusChip status={r.status} /></td>
      <td className="px-4 py-2 text-right tabular-nums">
        {r.duration_min == null ? "—" : `${r.duration_min} min`}
        {r.questions_answered ? <div className="text-xs text-muted">{r.questions_answered} Q</div> : null}
      </td>
      <td className="px-4 py-2 text-right tabular-nums">
        {num(r.calls)}{r.failed_calls ? <div className="text-xs text-danger">{r.failed_calls} failed</div> : null}
      </td>
      <td className="px-4 py-2 text-right tabular-nums">{num(r.tokens)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{r.audio_minutes ? `${r.audio_minutes} min` : "—"}</td>
      <td className="px-4 py-2 text-right tabular-nums text-xs text-secondary">
        {usd(r.cost_chat_usd, 4)} / {usd(r.cost_tts_usd, 4)} / {usd(r.cost_stt_usd, 4)}
      </td>
      <td className="px-4 py-2 text-right tabular-nums">
        <div className="font-semibold text-primary">{inr(r.cost_inr)}</div>
        <div className="text-xs text-muted">{usd(r.cost_usd, 4)}</div>
        {r.estimated_usd > 0 && (
          <span className="mt-0.5 inline-block rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning"
            title="Audio before 28 Sep 2026 was not logged — estimated from this interview's questions and answers.">
            {r.estimated_usd >= r.cost_usd - 1e-6 ? "estimated" : `${usd(r.estimated_usd, 4)} est.`}
          </span>
        )}
      </td>
    </tr>
  );
}
