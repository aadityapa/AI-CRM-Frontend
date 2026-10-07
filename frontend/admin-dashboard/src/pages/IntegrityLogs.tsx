/**
 * Interview Integrity (rebuilt 15 Sep 2026).
 *
 * Every interview the platform ran — HR-screen and CRM-scheduled alike — with
 * an integrity SCORE (0–100), per-family event counts, a "needs review" flag,
 * CRM context (customer · requirement · profile link) and, on expand, the full
 * timeline with the question it happened on, plus the session recording —
 * streamed LIVE while the interview runs (23 Sep 2026), replayed afterwards.
 *
 * Data: GET /interview/integrity-logs (all rows + summary),
 *       GET /interview/integrity-logs/{token} (timeline + recording), …/export (CSV),
 *       GET /interview/recording/{token}/live?after=N + …/part/{seq} (live stream).
 *
 * 7 Oct 2026 — redesigned: the gradient page header, and the open row is two
 * columns — facts + event breakdown + timeline on the left, the recording in a
 * bounded card on the right (it used to stretch across the whole page) under
 * "Open candidate report", which goes straight to the report page (questions,
 * answers, scores AND the recording). The server sends `report_link` only once
 * the session finished.
 */
import { useState, useEffect, useMemo, memo, useCallback } from "react";
import {
  Shield, AlertTriangle, CheckCircle2, XCircle, Clock, Monitor, ChevronDown, ChevronUp,
  Download, Search, Camera, Copy, Code2, Maximize2, Layers, Users, RefreshCw,
  Video, FileText, UserRound,
} from "lucide-react";
import { apiGet, authFetch } from "../api/client";
import { RecordingPanel, LIVE_SESSION_STATUSES, type Recording } from "../components/interview-recording/RecordingViewer";
import { PageHeader, HERO_BTN } from "../crm/components/PageHeader";

/* ---------- types (mirror services/interview_integrity.py) ---------- */

type Family = "tab" | "focus" | "fullscreen" | "keys" | "face" | "clipboard" | "devtools";

interface IntegrityRow {
  invite_token: string;
  hr_username?: string;
  candidate_name: string;
  candidate_email: string;
  scheduled_at: string;
  session_status: string;
  login_attempts: number;
  verified_at: string;
  interview_started_at: string;
  interview_completed_at: string;
  terminated_at?: string;
  strikes: number;
  event_count: number;
  by_family: Record<Family, number>;
  by_type: Record<string, number>;
  integrity_score: number;
  needs_review: boolean;
  active_device_id: string;
  reason?: string;
  template_name?: string;
  /** "" · "recording" (chunks arriving — watchable live) · "ready" · "missing". */
  recording_status?: string;
  /** 22 Sep 2026 — a finished whole-session recording exists for this interview. */
  has_recording?: boolean;
  recording_bytes?: number;
  shared_with?: string[];
  // CRM enrichment (present when the interview was scheduled from the CRM)
  profile_id?: number | null;
  requirement_title?: string;
  customer_name?: string;
  scheduled_by_name?: string;
  ai_score?: number | null;
  ai_result?: string | null;
  level?: string;
  /** 7 Oct 2026 — `/admin/?view=candidateReport&cid=…&iid=…`, only once the session finished. */
  report_link?: string | null;
  interview_record_id?: string | null;
}

interface Summary {
  total: number; active: number; pending: number; completed: number; terminated: number;
  needs_review: number; violations: number; avg_score: number | null; shared_devices: number;
}

interface TimelineEvent {
  type: string; label: string; details: string; timestamp: string; question: string;
  ip: string; user_agent: string; is_strike: boolean;
}

const isLiveRecording = (row: IntegrityRow) => row.recording_status === "recording" && LIVE_SESSION_STATUSES.has(row.session_status);

/* ---------- presentation helpers ---------- */

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: React.ReactNode; label: string }> = {
  pending: { bg: "bg-surface-2", text: "text-secondary", icon: <Clock className="h-3.5 w-3.5" />, label: "Invited" },
  verified: { bg: "bg-info-soft", text: "text-info", icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "Verified" },
  active: { bg: "bg-success-soft", text: "text-success", icon: <Monitor className="h-3.5 w-3.5" />, label: "Live now" },
  completed: { bg: "bg-success-soft", text: "text-success", icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "Completed" },
  terminated: { bg: "bg-danger-soft", text: "text-danger", icon: <XCircle className="h-3.5 w-3.5" />, label: "Terminated" },
};

const FAMILY_META: Record<Family, { label: string; icon: React.ReactNode }> = {
  tab: { label: "Tab switches", icon: <Layers className="h-3 w-3" /> },
  focus: { label: "Focus loss", icon: <Monitor className="h-3 w-3" /> },
  fullscreen: { label: "Fullscreen exits", icon: <Maximize2 className="h-3 w-3" /> },
  keys: { label: "Key escapes", icon: <Code2 className="h-3 w-3" /> },
  face: { label: "Camera", icon: <Camera className="h-3 w-3" /> },
  clipboard: { label: "Clipboard", icon: <Copy className="h-3 w-3" /> },
  devtools: { label: "Dev tools", icon: <Code2 className="h-3 w-3" /> },
};
const FAMILY_ORDER: Family[] = ["tab", "focus", "fullscreen", "face", "clipboard", "devtools", "keys"];

function scoreTone(score: number, status: string): { ring: string; text: string; word: string } {
  if (status === "terminated") return { ring: "stroke-danger", text: "text-danger", word: "Terminated" };
  if (score >= 90) return { ring: "stroke-success", text: "text-success", word: "Clean" };
  if (score > 70) return { ring: "stroke-warning", text: "text-warning", word: "Minor" };
  return { ring: "stroke-danger", text: "text-danger", word: "Review" };
}

function ScoreRing({ score, status, size = 44 }: { score: number; status: string; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const tone = scoreTone(score, status);
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`Integrity score ${score} — ${tone.word}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} style={{ stroke: "var(--border-subtle)" }} strokeWidth={4} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r} className={tone.ring} strokeWidth={4} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center text-[11px] font-extrabold tabular-nums ${tone.text}`}>{score}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ring-subtle ${s.bg} ${s.text}`}>
      {s.icon} {s.label}
    </span>
  );
}

function FamilyChips({ row, compact }: { row: IntegrityRow; compact?: boolean }) {
  const fams = FAMILY_ORDER.filter((f) => (row.by_family?.[f] || 0) > 0);
  if (fams.length === 0) return <span className="text-xs text-muted">No events</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {fams.slice(0, compact ? 3 : fams.length).map((f) => (
        <span key={f} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-secondary ring-1 ring-inset ring-subtle" title={FAMILY_META[f].label}>
          {FAMILY_META[f].icon} {row.by_family[f]} {compact ? "" : FAMILY_META[f].label.toLowerCase()}
        </span>
      ))}
      {compact && fams.length > 3 && <span className="text-[11px] text-muted">+{fams.length - 3}</span>}
    </div>
  );
}

const fmtWhen = (v?: string) => {
  if (!v) return "—";
  const d = new Date(v.includes("T") || v.includes("+") ? v : v.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};
const fmtTime = (v?: string) => {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

function crmProfileHref(profileId?: number | null): string {
  if (!profileId) return "";
  const u = new URL(window.location.href);
  u.search = "";
  u.searchParams.set("view", "crm");
  u.searchParams.set("p", `profiles/${profileId}`);
  u.searchParams.set("tab", "ai-interview");
  return u.toString();
}

/** The report page link: the dashboard lives at /admin/, so the server's
 *  root-relative link opens in place; `null` while the interview runs. */
function reportHref(row: IntegrityRow): string {
  return row.report_link || "";
}

const REPORT_BTN = "inline-flex items-center gap-1.5 rounded-control bg-gradient-to-r from-brand-600 to-violet-600 px-3 py-1.5 text-xs font-bold text-white shadow-raised transition-opacity hover:opacity-90";
const SOFT_BTN = "inline-flex items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-3 py-1.5 text-xs font-semibold text-secondary transition-colors hover:bg-surface-2 hover:text-primary";

/** Where the reviewer goes next: the report page (questions + recording)
 *  first, the CRM profile's AI Interview tab second. */
function RowActions({ row }: { row: IntegrityRow }) {
  const report = reportHref(row);
  const profile = crmProfileHref(row.profile_id);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {report ? (
        <a href={report} className={REPORT_BTN} title="Questions, answers, scores and the recording">
          <FileText className="h-3.5 w-3.5" /> Open candidate report
        </a>
      ) : (
        <span className="text-[11px] text-muted">The report opens here once the interview finishes.</span>
      )}
      {profile && (
        <a href={profile} className={SOFT_BTN}>
          <UserRound className="h-3.5 w-3.5" /> Candidate profile · AI Interview tab
        </a>
      )}
    </div>
  );
}

/* ---------- detail (timeline + recording) ---------- */

const RowDetail = memo(function RowDetail({ row }: { row: IntegrityRow }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [reason, setReason] = useState(row.reason || "");
  const [error, setError] = useState("");
  const [recording, setRecording] = useState<Recording | null>(null);
  // Bumped when the live stream ends, so the detail re-fetches and the
  // ordinary player takes over with the finalized file.
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!row.invite_token) { setEvents([]); return; }
    apiGet<{ violations_log: TimelineEvent[]; reason?: string; recording?: Recording }>(`/interview/integrity-logs/${encodeURIComponent(row.invite_token)}`, { force: true })
      .then((d) => {
        if (cancelled) return;
        setEvents(Array.isArray(d.violations_log) ? d.violations_log : []);
        if (d.reason) setReason(d.reason);
        // The detail endpoint finalizes a half-uploaded recording on demand
        // (never while the session is live), so this is also what repairs an
        // interview that crashed mid-way.
        setRecording(d.recording || { available: false, reason: "not_recorded" });
      })
      .catch((e: any) => { if (!cancelled) { setEvents([]); setError(e?.message || "Could not load the timeline"); } });
    return () => { cancelled = true; };
  }, [row.invite_token, reloadTick]);
  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  const facts: { label: string; value: React.ReactNode }[] = [
    { label: "Integrity score", value: <span className={scoreTone(row.integrity_score, row.session_status).text}>{row.integrity_score} / 100 · {scoreTone(row.integrity_score, row.session_status).word}</span> },
    { label: "Strikes (server)", value: `${row.strikes} of 3 allowed` },
    { label: "Login attempts", value: row.login_attempts ?? 0 },
    { label: "Verified", value: fmtWhen(row.verified_at) },
    { label: "Started", value: fmtWhen(row.interview_started_at) },
    { label: "Finished", value: fmtWhen(row.interview_completed_at) },
    { label: "Device", value: <span className="font-mono text-xs">{row.active_device_id ? row.active_device_id.slice(0, 16) + "…" : "—"}</span> },
    { label: "Scheduled by", value: row.scheduled_by_name || (row.hr_username === "karnex-crm" ? "CRM" : row.hr_username || "—") },
  ];
  if (row.ai_score != null) facts.push({ label: "AI L1 score", value: `${Math.round(row.ai_score)}% · ${row.ai_result || ""}` });
  if (reason) facts.push({ label: "Termination reason", value: <span className="text-danger">{reason}</span> });

  const sectionTitle = "text-[11px] font-bold uppercase tracking-wider text-muted";
  const live = isLiveRecording(row);

  return (
    <div className="grid gap-4 rounded-card border border-subtle bg-surface-2 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
      {/* ---- left: what happened ---- */}
      <div className="min-w-0 space-y-4">
        {row.shared_with && row.shared_with.length > 0 && (
          <div className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
            <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span><b>Same device or IP as other candidates:</b> {row.shared_with.join(", ")}. One machine taking several people's interviews is a proxy-candidate signal.</span>
          </div>
        )}
        <div>
          <div className={`mb-2 ${sectionTitle}`}>Session</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {facts.map((f) => (
              <div key={f.label} className="rounded-control border border-subtle bg-surface-1 px-3 py-2">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">{f.label}</span>
                <span className="block truncate text-sm font-semibold text-secondary">{f.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className={`mb-2 ${sectionTitle}`}>Event breakdown</div>
          <FamilyChips row={row} />
        </div>
        <div>
          <div className={`mb-2 flex items-center justify-between ${sectionTitle}`}>
            <span>Timeline</span>
            {events && events.length > 0 && <span className="font-semibold normal-case tracking-normal">{events.length} events · strikes in red</span>}
          </div>
          {events === null ? (
            <div className="text-xs text-muted">Loading timeline…</div>
          ) : error ? (
            <div className="text-xs text-danger">{error}</div>
          ) : events.length === 0 ? (
            <div className="rounded-control border border-dashed border-subtle px-3 py-4 text-center text-xs text-muted">No integrity events were recorded for this interview.</div>
          ) : (
            <ol className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
              {events.map((v, i) => (
                <li key={i} className={`flex items-center gap-3 rounded-control border px-3 py-2 text-xs ${v.type === "termination" ? "border-danger/30 bg-danger-soft" : "border-subtle bg-surface-1"}`}>
                  <span className={`w-6 shrink-0 text-right font-bold tabular-nums ${v.is_strike ? "text-danger" : "text-muted"}`}>{i + 1}</span>
                  <span className="w-32 shrink-0 truncate font-semibold text-secondary" title={v.label}>{v.label}</span>
                  <span className="min-w-0 flex-1 truncate text-muted" title={v.details}>{v.details}</span>
                  {v.question && <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-secondary">Q{v.question}</span>}
                  <span className="shrink-0 whitespace-nowrap text-muted">{fmtTime(v.timestamp)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* ---- right: where to go + the recording, bounded ---- */}
      <div className="min-w-0 space-y-3 xl:border-l xl:border-subtle xl:pl-4">
        <RowActions row={row} />
        <div className="rounded-card border border-subtle bg-surface-1 p-3">
          <div className={`mb-2 flex items-center justify-between ${sectionTitle}`}>
            <span className="inline-flex items-center gap-1.5"><Video className="h-3.5 w-3.5" /> {live ? "Live interview" : "Session recording"}</span>
            <span className="font-semibold normal-case tracking-normal">Candidate · screen</span>
          </div>
          <RecordingPanel recording={recording} sessionStatus={row.session_status} token={row.invite_token} onLiveEnded={reload} />
        </div>
      </div>
    </div>
  );
});

/* ---------- page ---------- */

type Chip = "all" | "review" | "active" | "pending" | "completed" | "terminated";
const CHIPS: { key: Chip; label: string }[] = [
  { key: "all", label: "All" }, { key: "review", label: "Needs review" }, { key: "active", label: "Live now" },
  { key: "pending", label: "Invited" }, { key: "completed", label: "Completed" }, { key: "terminated", label: "Terminated" },
];

export function IntegrityLogsPage() {
  const [rows, setRows] = useState<IntegrityRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chip, setChip] = useState<Chip>("all");
  const [q, setQ] = useState("");
  const [customer, setCustomer] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<{ logs: IntegrityRow[]; summary?: Summary }>("/interview/integrity-logs", { force: tick > 0 })
      .then((d) => { if (cancelled) return; setRows(Array.isArray(d.logs) ? d.logs : []); setSummary(d.summary || null); setError(""); })
      .catch((e: any) => { if (!cancelled) { setRows([]); setError(e?.message || "Could not load integrity data"); } })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [tick]);

  // While an interview is running, keep the list fresh so the "Watch live"
  // chip appears when the first slice lands and the row settles to "recording"
  // when the session ends. Nothing polls when nothing is live.
  const anyLive = useMemo(() => rows.some((r) => LIVE_SESSION_STATUSES.has(r.session_status) && r.session_status !== "pending"), [rows]);
  useEffect(() => {
    if (!anyLive) return;
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, [anyLive]);

  const customers = useMemo(() => [...new Set(rows.map((r) => r.customer_name).filter(Boolean) as string[])].sort(), [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (chip === "review" && !r.needs_review) return false;
      if (chip === "pending" && !["pending", "verified", "scheduled"].includes(r.session_status)) return false;
      if (["active", "completed", "terminated"].includes(chip) && r.session_status !== chip) return false;
      if (customer && r.customer_name !== customer) return false;
      if (from && (r.scheduled_at || "").slice(0, 10) < from) return false;
      if (to && (r.scheduled_at || "").slice(0, 10) > to) return false;
      if (needle) {
        const hay = `${r.candidate_name} ${r.candidate_email} ${r.requirement_title || ""} ${r.customer_name || ""} ${r.template_name || ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, chip, q, customer, from, to]);

  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      const res = await authFetch("/interview/integrity-logs/export");
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `interview-integrity-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e: any) {
      setError(e?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }, []);

  const kpis = summary ? [
    { label: "Interviews", value: summary.total, cls: "text-primary", sub: `${summary.pending} invited · ${summary.completed} completed` },
    { label: "Live now", value: summary.active, cls: "text-success", sub: "sessions in progress" },
    { label: "Needs review", value: summary.needs_review, cls: summary.needs_review ? "text-warning" : "text-primary", sub: `score ≤ 70, terminated, or shared device` },
    { label: "Terminated", value: summary.terminated, cls: summary.terminated ? "text-danger" : "text-primary", sub: "by the 3-strike rule or expiry" },
    { label: "Avg integrity", value: summary.avg_score == null ? "—" : summary.avg_score, cls: "text-primary", sub: `${summary.violations} events · ${summary.shared_devices} shared devices` },
  ] : [];

  return (
    <div className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        icon={Shield}
        accent="violet"
        eyebrow="Interview Platform"
        title="Interview Integrity"
        subtitle="Every AI interview, scored — tab switches, focus loss, camera, clipboard and dev-tools attempts. Open a row to watch it live or replay the recording; the report button takes you to the questions, answers and scores."
        actions={(
          <>
            <button type="button" onClick={() => setTick((t) => t + 1)} className={HERO_BTN} title="Reload">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button type="button" onClick={exportCsv} disabled={exporting || rows.length === 0} className={HERO_BTN}>
              <Download className="h-4 w-4" /> {exporting ? "Exporting…" : "Export CSV"}
            </button>
          </>
        )}
      />

      {error && <div className="rounded-card border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>}

      {loading && !summary ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-20 animate-pulse rounded-card border border-subtle bg-surface-2" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
              <div className={`text-display text-2xl font-bold tabular-nums ${k.cls}`}>{k.value}</div>
              <div className="mt-0.5 text-xs font-semibold text-secondary">{k.label}</div>
              <div className="truncate text-[11px] text-muted" title={k.sub}>{k.sub}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {CHIPS.map((c) => {
          const n = c.key === "all" ? rows.length
            : c.key === "review" ? rows.filter((r) => r.needs_review).length
            : c.key === "pending" ? rows.filter((r) => ["pending", "verified", "scheduled"].includes(r.session_status)).length
            : rows.filter((r) => r.session_status === c.key).length;
          return (
            <button key={c.key} type="button" onClick={() => setChip(c.key)} aria-pressed={chip === c.key}
              className={`rounded-control px-3 py-1.5 text-xs font-semibold transition-colors duration-micro ease-smooth ${chip === c.key ? "bg-gradient-to-r from-brand-600 to-violet-600 text-white shadow-raised" : "border border-subtle bg-surface-1 text-secondary hover:bg-surface-2 hover:text-primary"}`}>
              {c.label} <span className={`ml-1 tabular-nums ${chip === c.key ? "opacity-80" : "text-muted"}`}>{n}</span>
            </button>
          );
        })}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Candidate, email, requirement…" className="input-recessed w-56 rounded-control border border-subtle bg-surface-1 py-1.5 pl-7 pr-2 text-xs text-primary" />
          </label>
          {customers.length > 0 && (
            <select value={customer} onChange={(e) => setCustomer(e.target.value)} className="rounded-control border border-subtle bg-surface-1 px-2 py-1.5 text-xs text-primary" aria-label="Customer">
              <option value="">All customers</option>
              {customers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-control border border-subtle bg-surface-1 px-2 py-1.5 text-xs text-primary" aria-label="From date" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-control border border-subtle bg-surface-1 px-2 py-1.5 text-xs text-primary" aria-label="To date" />
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-card bg-surface-2" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-card border border-subtle bg-surface-1 py-12 text-center text-sm text-muted">
          {rows.length === 0 ? "No interviews have been scheduled yet." : "Nothing matches these filters."}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((row) => {
            const key = row.invite_token || `${row.candidate_email}-${row.scheduled_at}`;
            const open = expanded === key;
            const report = reportHref(row);
            return (
              <div key={key} className={`overflow-hidden rounded-card border bg-surface-1 shadow-raised ${row.needs_review ? "border-warning/40" : "border-subtle"}`}>
                <div className="flex items-stretch">
                <button type="button" onClick={() => setExpanded(open ? null : key)} aria-expanded={open}
                  className="row-hover flex min-w-0 flex-1 items-center gap-4 px-4 py-3 text-left transition-colors duration-micro ease-smooth">
                  <ScoreRing score={row.integrity_score} status={row.session_status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-primary">{row.candidate_name || "Unknown"}</span>
                      <StatusBadge status={row.session_status || "pending"} />
                      {row.needs_review && row.session_status !== "terminated" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-bold text-warning ring-1 ring-inset ring-subtle"><AlertTriangle className="h-3 w-3" /> Review</span>
                      )}
                      {row.shared_with && row.shared_with.length > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-bold text-danger ring-1 ring-inset ring-subtle" title={`Shared device/IP with ${row.shared_with.join(", ")}`}><Users className="h-3 w-3" /> Shared device</span>
                      )}
                      {isLiveRecording(row) && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-danger px-2 py-0.5 text-[11px] font-bold text-white" title="Open the row to watch the interview live">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden /> Watch live
                        </span>
                      )}
                      {row.has_recording && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted"><Video className="h-3 w-3" /> recording</span>}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted">
                      {row.candidate_email}
                      {(row.customer_name || row.requirement_title || row.template_name) && (
                        <> · {[row.customer_name, row.requirement_title || row.template_name].filter(Boolean).join(" · ")}</>
                      )}
                      {row.reason && row.session_status === "terminated" && <span className="text-danger"> · {row.reason}</span>}
                    </div>
                  </div>
                  <div className="hidden lg:block"><FamilyChips row={row} compact /></div>
                  <div className="hidden w-32 shrink-0 text-right text-xs text-muted md:block">{fmtWhen(row.scheduled_at)}</div>
                  {open ? <ChevronUp className="h-4 w-4 shrink-0 text-muted" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted" />}
                </button>
                {report && (
                  <div className="flex shrink-0 items-center border-l border-subtle px-3">
                    <a href={report} className={REPORT_BTN} title="Open the candidate report — questions, answers, scores and the recording">
                      <FileText className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Report</span>
                    </a>
                  </div>
                )}
                </div>
                {open && (
                  <div className="px-4 pb-4">
                    <RowDetail row={row} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
