/**
 * Interview Platform ▸ Reports (11 Oct 2026 redesign).
 *
 * One list of every AI interview — newest first — with the things a reviewer
 * decides on in plain view: who, which position, when, the score, the AI's
 * verdict and your decision. Click a row to open the full report (questions,
 * answers, scores, the recording). Filters: verdict, customer, position, date,
 * search; group by candidate, position or customer.
 *
 * Data: the same `GET /hr/dashboard` as before (now also carrying the AI
 * recommendation, "not attempted", the time and "recruiter joined").
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3, ChevronRight, Clock, FileText, Filter, Layers, RefreshCw, Search, Trash2, UserRound, Radio, X,
} from "lucide-react";
import type { Candidate, Interview } from "../types";
import { deleteInterviewRecord, getDashboardData } from "../api";
import { DeleteInterviewRecordModal } from "../components/DeleteInterviewRecordModal";
import { PageHeader, HERO_BTN, StagePills } from "../crm/components/PageHeader";
import { onlyActiveNames, useActiveCustomerList } from "../crm/lib/activeCustomers";

type Row = Interview & {
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  recommendation?: string;
  fitment?: string;
  not_attempted?: boolean;
  time?: string;
  recruiter_joined?: boolean;
};

type Verdict = "hire" | "consider" | "reject" | "not_attempted" | "terminated" | "pending";
type GroupBy = "none" | "candidate" | "position" | "customer";
type SortBy = "latest" | "score_high" | "score_low" | "name";
type Since = "all" | "7" | "30" | "90";

export const VERDICT_LOOK: Record<Verdict, { label: string; chip: string; dot: string }> = {
  hire: { label: "Recommended", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800", dot: "bg-emerald-500" },
  consider: { label: "Consider", chip: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800", dot: "bg-amber-500" },
  reject: { label: "Not recommended", chip: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-800", dot: "bg-rose-500" },
  not_attempted: { label: "Not attempted", chip: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700", dot: "bg-slate-400" },
  terminated: { label: "Terminated", chip: "bg-rose-100 text-rose-800 ring-rose-300 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-800", dot: "bg-rose-700" },
  pending: { label: "Report pending", chip: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800", dot: "bg-sky-500" },
};

const DECISION_LOOK: Record<string, string> = {
  Selected: "text-emerald-700 dark:text-emerald-300",
  Rejected: "text-rose-700 dark:text-rose-300",
  "On Hold": "text-amber-700 dark:text-amber-300",
  "Pending Review": "text-muted",
};

/** PURE: the AI's verdict for one interview — the recommendation when the
 *  report has one, else read from the score. */
export function verdictOf(r: Pick<Row, "recommendation" | "not_attempted" | "final_status" | "completion_status" | "report_status" | "score">): Verdict {
  const final = `${r.final_status || ""} ${r.completion_status || ""}`.toLowerCase();
  if (final.includes("terminated")) return "terminated";
  if (r.not_attempted || /not attempted/i.test(r.recommendation || "")) return "not_attempted";
  const rec = String(r.recommendation || "").toLowerCase();
  if (rec.includes("reject") || rec.includes("not recommend") || rec.includes("no hire")) return "reject";
  if (rec.includes("consider") || rec.includes("maybe") || rec.includes("hold")) return "consider";
  if (rec.includes("hire") || rec.includes("recommend") || rec.includes("strong")) return "hire";
  const ready = !r.report_status || /ready|completed/i.test(r.report_status);
  if (!ready && !Number(r.score)) return "pending";
  const s = Number(r.score) || 0;
  return s >= 70 ? "hire" : s >= 50 ? "consider" : "reject";
}

/** PURE: every interview of every candidate as one flat row. */
export function flattenInterviews(candidates: Candidate[]): Row[] {
  const out: Row[] = [];
  for (const c of candidates || []) {
    for (const it of c.interviews || []) {
      out.push({ ...(it as Row), candidateId: c.id, candidateName: c.name, candidateEmail: c.email });
    }
  }
  return out;
}

function stamp(r: Row): string {
  return `${r.date || ""} ${r.time || ""}`.trim();
}

function fmtDate(d: string): string {
  if (!d) return "—";
  const dt = new Date(`${d.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function fmtTime(t?: string): string {
  if (!t) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}

function initials(name: string): string {
  return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

function ScoreBadge({ score, verdict }: { score: number; verdict: Verdict }) {
  const s = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  const none = verdict === "not_attempted" || verdict === "pending";
  const color = none ? "#94a3b8" : s >= 70 ? "#059669" : s >= 50 ? "#d97706" : "#e11d48";
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-grid h-11 w-11 place-items-center" title={none ? "No score" : `${s} / 100`}>
      <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
        <circle cx="20" cy="20" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-surface-2" />
        {!none && <circle cx="20" cy="20" r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={`${(s / 100) * c} ${c}`} />}
      </svg>
      <span className="text-xs font-extrabold tabular-nums text-primary">{none ? "—" : s}</span>
    </span>
  );
}

const CONTROL = "h-9 rounded-control border border-subtle bg-surface-1 px-2.5 text-sm text-primary";
const PAGE = 40;

export function InterviewReportsPage({
  onOpenCandidateReport,
}: {
  onOpenCandidateReport?: (candidateId: string, interviewId?: string) => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [verdict, setVerdict] = useState<"all" | Verdict>("all");
  const [customer, setCustomer] = useState("");
  const [position, setPosition] = useState("");
  const [since, setSince] = useState<Since>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [sortBy, setSortBy] = useState<SortBy>("latest");
  const [limit, setLimit] = useState(PAGE);
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { candidates: c } = await getDashboardData(500);
      setCandidates(c);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => flattenInterviews(candidates), [candidates]);
  const withVerdict = useMemo(() => rows.map((r) => ({ r, v: verdictOf(r) })), [rows]);

  const activeCustomers = useActiveCustomerList();   // the dropdown lists ACTIVE customers (23 Oct 2026)
  const customers = useMemo(
    () => onlyActiveNames(
      [...new Set(rows.map((r) => (r.customerName || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
      activeCustomers, customer),
    [rows, activeCustomers, customer],
  );
  const positions = useMemo(() => {
    const scoped = customer ? rows.filter((r) => (r.customerName || "") === customer) : rows;
    return [...new Set(scoped.map((r) => (r.templateTitle || r.sessionName || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [rows, customer]);

  const cutoff = useMemo(() => {
    if (since === "all") return "";
    const d = new Date();
    d.setDate(d.getDate() - Number(since));
    return d.toISOString().slice(0, 10);
  }, [since]);

  // Everything except the verdict filter — the chips count from this.
  const base = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return withVerdict.filter(({ r }) => {
      if (customer && (r.customerName || "") !== customer) return false;
      if (position && (r.templateTitle || r.sessionName || "") !== position) return false;
      if (cutoff && (r.date || "") < cutoff) return false;
      if (needle) {
        const hay = `${r.candidateName} ${r.candidateEmail} ${r.templateTitle || ""} ${r.customerName || ""} ${r.opportunityId || ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [withVerdict, customer, position, cutoff, q]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: base.length };
    base.forEach(({ v }) => { out[v] = (out[v] || 0) + 1; });
    return out;
  }, [base]);

  const shown = useMemo(() => {
    const list = verdict === "all" ? base : base.filter(({ v }) => v === verdict);
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortBy === "score_high") return (Number(b.r.score) || 0) - (Number(a.r.score) || 0);
      if (sortBy === "score_low") return (Number(a.r.score) || 0) - (Number(b.r.score) || 0);
      if (sortBy === "name") return a.r.candidateName.localeCompare(b.r.candidateName);
      return stamp(b.r).localeCompare(stamp(a.r));
    });
    return sorted;
  }, [base, verdict, sortBy]);

  const stats = useMemo(() => {
    const scored = base.filter(({ v }) => v !== "not_attempted" && v !== "pending");
    const avg = scored.length ? Math.round(scored.reduce((s, { r }) => s + (Number(r.score) || 0), 0) / scored.length) : 0;
    const week = new Date();
    week.setDate(week.getDate() - 7);
    const weekKey = week.toISOString().slice(0, 10);
    return {
      total: base.length,
      avg,
      hire: base.filter(({ v }) => v === "hire").length,
      toDecide: base.filter(({ r, v }) => (r.status === "Pending Review" || !r.status) && v !== "not_attempted" && v !== "pending").length,
      week: base.filter(({ r }) => (r.date || "") >= weekKey).length,
    };
  }, [base]);

  const groups = useMemo(() => {
    const visible = shown.slice(0, groupBy === "none" ? limit : shown.length);
    if (groupBy === "none") return [{ key: "", title: "", rows: visible }];
    const map = new Map<string, typeof visible>();
    visible.forEach((item) => {
      const k = groupBy === "candidate" ? `${item.r.candidateName} · ${item.r.candidateEmail}`
        : groupBy === "position" ? (item.r.templateTitle || item.r.sessionName || "No position")
          : (item.r.customerName || "No customer");
      map.set(k, [...(map.get(k) || []), item]);
    });
    return [...map.entries()].map(([key, list]) => ({ key, title: key, rows: list }));
  }, [shown, groupBy, limit]);

  const filtersOn = !!(customer || position || since !== "all" || q.trim());
  const clearFilters = () => { setCustomer(""); setPosition(""); setSince("all"); setQ(""); setVerdict("all"); };

  const confirmDelete = async () => {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteInterviewRecord(deleteTarget.id);
      setCandidates((prev) => prev
        .map((c) => (c.id === deleteTarget.candidateId ? { ...c, interviews: c.interviews.filter((i) => i.id !== deleteTarget.id) } : c))
        .filter((c) => c.interviews.length));
      setDeleteTarget(null);
      setToast("Report deleted.");
      window.setTimeout(() => setToast(""), 2200);
    } catch (e: any) {
      setDeleteError(String(e?.message || e));
    } finally {
      setDeleteBusy(false);
    }
  };

  const open = (r: Row) => onOpenCandidateReport?.(r.candidateId, r.id);

  const verdictTabs = [
    { key: "all", label: `All · ${counts.all || 0}` },
    ...(["hire", "consider", "reject", "not_attempted", "terminated", "pending"] as Verdict[])
      .filter((v) => counts[v])
      .map((v) => ({ key: v, label: `${VERDICT_LOOK[v].label} · ${counts[v]}` })),
  ];

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-4 p-4 sm:p-6">
      <DeleteInterviewRecordModal
        open={Boolean(deleteTarget)}
        busy={deleteBusy}
        error={deleteError}
        targetLabel={deleteTarget ? `${deleteTarget.candidateName} • ${deleteTarget.templateTitle || "Interview"}` : ""}
        onClose={() => { if (!deleteBusy) { setDeleteTarget(null); setDeleteError(""); } }}
        onConfirm={() => void confirmDelete()}
      />
      {toast ? (
        <div className="fixed bottom-6 right-6 z-50 rounded-card border border-subtle bg-success-soft px-4 py-3 text-sm font-bold text-success shadow-overlay">{toast}</div>
      ) : null}

      <PageHeader
        icon={BarChart3}
        eyebrow="Interview Platform"
        title="Interview reports"
        subtitle="Every AI interview in one list. Open a report to see the questions, answers, scores and the recording."
        accent="violet"
        stats={[
          { label: "Interviews", value: stats.total },
          { label: "Average score", value: stats.total ? `${stats.avg}` : "—", title: "Across interviews that were scored" },
          { label: "Recommended", value: stats.hire },
          { label: "Waiting for your decision", value: stats.toDecide },
          { label: "Last 7 days", value: stats.week },
        ]}
        actions={(
          <button type="button" className={HERO_BTN} onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        )}
      >
        <div className="space-y-3">
          <StagePills tabs={verdictTabs} active={verdict} onChange={(k) => { setVerdict(k as "all" | Verdict); setLimit(PAGE); }} label="AI verdict" />
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <input type="text" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }}
                placeholder="Search candidate, email, position, customer, opportunity…" aria-label="Search reports"
                className={`${CONTROL} w-full pl-8`} />
            </label>
            <select className={CONTROL} value={customer} aria-label="Customer"
              onChange={(e) => { setCustomer(e.target.value); setPosition(""); setLimit(PAGE); }}>
              <option value="">All customers</option>
              {customers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className={`${CONTROL} max-w-[240px]`} value={position} aria-label="Position"
              onChange={(e) => { setPosition(e.target.value); setLimit(PAGE); }}>
              <option value="">All positions</option>
              {positions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select className={CONTROL} value={since} aria-label="When" onChange={(e) => { setSince(e.target.value as Since); setLimit(PAGE); }}>
              <option value="all">Any time</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
            <select className={CONTROL} value={sortBy} aria-label="Sort" onChange={(e) => setSortBy(e.target.value as SortBy)}>
              <option value="latest">Newest first</option>
              <option value="score_high">Highest score</option>
              <option value="score_low">Lowest score</option>
              <option value="name">Candidate A–Z</option>
            </select>
            <select className={CONTROL} value={groupBy} aria-label="Group by" onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
              <option value="none">No grouping</option>
              <option value="candidate">Group by candidate</option>
              <option value="position">Group by position</option>
              <option value="customer">Group by customer</option>
            </select>
            {filtersOn || verdict !== "all" ? (
              <button type="button" onClick={clearFilters}
                className="inline-flex h-9 items-center gap-1 rounded-control px-2.5 text-sm font-semibold text-secondary hover:bg-surface-2">
                <X className="h-4 w-4" /> Clear
              </button>
            ) : null}
          </div>
        </div>
      </PageHeader>

      {loading && !rows.length ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-card bg-surface-2" />)}
        </div>
      ) : error ? (
        <div className="rounded-card border border-danger/30 bg-danger-soft p-6 text-sm text-danger">
          <div className="font-bold">The reports could not be loaded.</div>
          <div className="mt-1">{error}</div>
          <button type="button" onClick={() => void load()} className="mt-3 rounded-control bg-danger px-3 py-1.5 text-xs font-bold text-white">Try again</button>
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-card border-2 border-dashed border-subtle bg-surface-1 px-6 py-12 text-center">
          <Filter className="mx-auto h-8 w-8 text-muted" aria-hidden />
          <div className="mt-2 text-base font-bold text-primary">{rows.length ? "Nothing matches these filters" : "No interview reports yet"}</div>
          <p className="mt-1 text-sm text-muted">{rows.length ? "Change or clear the filters above." : "Reports appear here as soon as a candidate finishes an AI interview."}</p>
          {rows.length ? <button type="button" onClick={clearFilters} className="mt-3 text-sm font-semibold text-brand-600">Clear filters</button> : null}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.key || "all"} className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
              {g.title ? (
                <div className="flex flex-wrap items-center gap-2 border-b border-subtle bg-surface-2 px-4 py-2.5">
                  <Layers className="h-4 w-4 text-muted" aria-hidden />
                  <span className="text-sm font-bold text-primary">{g.title}</span>
                  <span className="rounded-full bg-surface-1 px-2 py-0.5 text-[11px] font-semibold text-secondary">{g.rows.length} interview{g.rows.length === 1 ? "" : "s"}</span>
                  {(() => {
                    const sc = g.rows.filter(({ v }) => v !== "not_attempted" && v !== "pending");
                    return sc.length ? <span className="text-[11px] text-muted">avg {Math.round(sc.reduce((s, { r }) => s + (Number(r.score) || 0), 0) / sc.length)}</span> : null;
                  })()}
                </div>
              ) : (
                <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,2fr)_minmax(0,1.1fr)_64px_minmax(0,1.3fr)_minmax(0,1fr)_120px] gap-3 border-b border-subtle bg-surface-2 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-muted lg:grid">
                  <span>Candidate</span><span>Position</span><span>When</span><span>Score</span><span>AI verdict</span><span>Your decision</span><span className="text-right">Report</span>
                </div>
              )}
              <ul className="divide-y divide-subtle">
                {g.rows.map(({ r, v }) => (
                  <li key={`${r.candidateId}:${r.id}`}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => open(r)}
                      onKeyDown={(e) => { if (e.key === "Enter") open(r); }}
                      className="grid cursor-pointer grid-cols-1 gap-3 px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none lg:grid-cols-[minmax(0,2.2fr)_minmax(0,2fr)_minmax(0,1.1fr)_64px_minmax(0,1.3fr)_minmax(0,1fr)_120px] lg:items-center"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-600 to-violet-600 text-xs font-extrabold text-[#fff]">{initials(r.candidateName)}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold text-primary">{r.candidateName}</span>
                          <span className="block truncate text-xs text-muted">{r.candidateEmail}</span>
                        </span>
                      </div>
                      <div className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-secondary" title={r.templateTitle}>{r.templateTitle || r.sessionName || "—"}</span>
                        <span className="block truncate text-xs text-muted">
                          {[r.customerName, r.opportunityId].filter(Boolean).join(" · ") || "No customer"}
                        </span>
                      </div>
                      <div className="text-xs text-secondary">
                        <span className="block font-semibold">{fmtDate(r.date)}</span>
                        <span className="flex items-center gap-1 text-muted">{r.time ? <><Clock className="h-3 w-3" aria-hidden /> {fmtTime(r.time)}</> : null}</span>
                      </div>
                      <div><ScoreBadge score={r.score} verdict={v} /></div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${VERDICT_LOOK[v].chip}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${VERDICT_LOOK[v].dot}`} aria-hidden /> {VERDICT_LOOK[v].label}
                        </span>
                        {r.recruiter_joined ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-200" title="A recruiter joined this interview">
                            <Radio className="h-3 w-3" aria-hidden /> Recruiter joined
                          </span>
                        ) : null}
                      </div>
                      <div className={`text-xs font-semibold ${DECISION_LOOK[r.status] || "text-muted"}`}>
                        {r.status === "Pending Review" || !r.status ? "To decide" : r.status}
                      </div>
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" onClick={(e) => { e.stopPropagation(); open(r); }}
                          className="inline-flex items-center gap-1 rounded-control bg-brand-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-brand-700">
                          <FileText className="h-3.5 w-3.5" /> Open <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" aria-label="Delete report" title="Delete this report"
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }}
                          className="grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {groupBy === "none" && shown.length > limit ? (
            <div className="text-center">
              <button type="button" onClick={() => setLimit((n) => n + PAGE)}
                className="inline-flex items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-4 py-2 text-sm font-semibold text-secondary hover:bg-surface-2">
                <UserRound className="h-4 w-4" /> Show {Math.min(PAGE, shown.length - limit)} more of {shown.length - limit}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
