/**
 * Interview Integrity (rebuilt 15 Sep 2026).
 *
 * Every interview the platform ran — HR-screen and CRM-scheduled alike — with
 * an integrity SCORE (0–100), per-family event counts, a "needs review" flag,
 * CRM context (customer · requirement · profile link) and, on expand, the full
 * timeline with the question it happened on and any camera evidence.
 *
 * Data: GET /interview/integrity-logs (all rows + summary),
 *       GET /interview/integrity-logs/{token} (timeline), …/export (CSV).
 */
import { useState, useEffect, useMemo, memo, useCallback } from "react";
import {
  Shield, AlertTriangle, CheckCircle2, XCircle, Clock, Monitor, ChevronDown, ChevronUp,
  Download, Search, Camera, Copy, Code2, Maximize2, Layers, Users, ExternalLink, RefreshCw,
} from "lucide-react";
import { apiGet, authFetch } from "../api/client";

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
  has_evidence?: boolean;
  shared_with?: string[];
  // CRM enrichment (present when the interview was scheduled from the CRM)
  profile_id?: number | null;
  requirement_title?: string;
  customer_name?: string;
  scheduled_by_name?: string;
  ai_score?: number | null;
  ai_result?: string | null;
  level?: string;
}

interface Summary {
  total: number; active: number; pending: number; completed: number; terminated: number;
  needs_review: number; violations: number; avg_score: number | null; shared_devices: number;
}

interface TimelineEvent {
  type: string; label: string; details: string; timestamp: string; question: string;
  ip: string; user_agent: string; evidence_url: string; is_strike: boolean;
}

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

/* ---------- detail (timeline + evidence) ---------- */

const RowDetail = memo(function RowDetail({ row }: { row: IntegrityRow }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [reason, setReason] = useState(row.reason || "");
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    if (!row.invite_token) { setEvents([]); return; }
    apiGet<{ violations_log: TimelineEvent[]; reason?: string }>(`/interview/integrity-logs/${encodeURIComponent(row.invite_token)}`, { force: true })
      .then((d) => { if (cancelled) return; setEvents(Array.isArray(d.violations_log) ? d.violations_log : []); if (d.reason) setReason(d.reason); })
      .catch((e: any) => { if (!cancelled) { setEvents([]); setError(e?.message || "Could not load the timeline"); } });
    return () => { cancelled = true; };
  }, [row.invite_token]);

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

  return (
    <div className="space-y-4 rounded-card border border-subtle bg-surface-2 p-4">
      {row.shared_with && row.shared_with.length > 0 && (
        <div className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
          <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span><b>Same device or IP as other candidates:</b> {row.shared_with.join(", ")}. One machine taking several people's interviews is a proxy-candidate signal.</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 xl:grid-cols-4">
        {facts.map((f) => (
          <div key={f.label}>
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">{f.label}</span>
            <span className="font-semibold text-secondary">{f.value}</span>
          </div>
        ))}
      </div>
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Event breakdown</div>
        <FamilyChips row={row} />
      </div>
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Timeline</div>
        {events === null ? (
          <div className="text-xs text-muted">Loading timeline…</div>
        ) : error ? (
          <div className="text-xs text-danger">{error}</div>
        ) : events.length === 0 ? (
          <div className="text-xs text-muted">No integrity events were recorded for this interview.</div>
        ) : (
          <ol className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {events.map((v, i) => (
              <li key={i} className={`flex items-center gap-3 rounded-control border px-3 py-2 text-xs ${v.type === "termination" ? "border-danger/30 bg-danger-soft" : "border-subtle bg-surface-1"}`}>
                <span className={`w-6 shrink-0 text-right font-bold tabular-nums ${v.is_strike ? "text-danger" : "text-muted"}`}>{i + 1}</span>
                <span className="w-32 shrink-0 font-semibold text-secondary">{v.label}</span>
                <span className="min-w-0 flex-1 truncate text-muted" title={v.details}>{v.details}</span>
                {v.question && <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-secondary">Q{v.question}</span>}
                {v.evidence_url && (
                  <button type="button" className="inline-flex shrink-0 items-center gap-1 text-brand-600 hover:underline dark:text-brand-300" onClick={() => setLightbox(v.evidence_url)}>
                    <Camera className="h-3 w-3" /> View
                  </button>
                )}
                <span className="shrink-0 whitespace-nowrap text-muted">{fmtTime(v.timestamp)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-backdrop p-6" role="dialog" aria-label="Camera evidence" onClick={() => setLightbox("")}>
          <div className="max-w-2xl rounded-card bg-surface-1 p-3 shadow-modal" onClick={(e) => e.stopPropagation()}>
            <EvidenceImage url={lightbox} />
            <div className="mt-2 flex justify-end">
              <button type="button" className="text-xs font-semibold text-secondary hover:text-primary" onClick={() => setLightbox("")}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

/** Evidence is served behind the bearer token, so fetch it to a blob URL. */
function EvidenceImage({ url }: { url: string }) {
  const [src, setSrc] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true; let obj = "";
    authFetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      obj = URL.createObjectURL(await r.blob());
      if (alive) setSrc(obj);
    }).catch((e) => alive && setErr(e?.message || "Could not load the image"));
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [url]);
  if (err) return <div className="p-6 text-sm text-danger">{err}</div>;
  if (!src) return <div className="p-6 text-sm text-muted">Loading snapshot…</div>;
  return <img src={src} alt="Camera snapshot captured at the moment of the event" className="max-h-[70vh] rounded-control" />;
}

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
    <div className="mx-auto max-w-screen-2xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="fx-glow flex h-10 w-10 items-center justify-center rounded-card bg-gradient-to-br from-brand-600 to-violet-600">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-display text-xl font-bold tracking-tight text-primary">Interview Integrity</h2>
            <p className="text-sm text-muted">Every AI interview, scored — tab switches, focus loss, camera, clipboard and dev-tools attempts.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setTick((t) => t + 1)} className="inline-flex items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-3 py-1.5 text-xs font-semibold text-secondary hover:bg-surface-2 hover:text-primary" title="Reload">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button type="button" onClick={exportCsv} disabled={exporting || rows.length === 0} className="inline-flex items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-3 py-1.5 text-xs font-semibold text-secondary hover:bg-surface-2 hover:text-primary disabled:opacity-50">
            <Download className="h-3.5 w-3.5" /> {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

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
            const href = crmProfileHref(row.profile_id);
            return (
              <div key={key} className={`overflow-hidden rounded-card border bg-surface-1 shadow-raised ${row.needs_review ? "border-warning/40" : "border-subtle"}`}>
                <button type="button" onClick={() => setExpanded(open ? null : key)} aria-expanded={open}
                  className="row-hover flex w-full items-center gap-4 px-4 py-3 text-left transition-colors duration-micro ease-smooth">
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
                      {row.has_evidence && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted"><Camera className="h-3 w-3" /> evidence</span>}
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
                {open && (
                  <div className="space-y-3 px-4 pb-4">
                    {href && (
                      <a href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
                        <ExternalLink className="h-3 w-3" /> Open candidate profile · AI Interview tab
                      </a>
                    )}
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
