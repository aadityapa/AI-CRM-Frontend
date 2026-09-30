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
 */
import { useState, useEffect, useMemo, memo, useCallback, useRef } from "react";
import {
  Shield, AlertTriangle, CheckCircle2, XCircle, Clock, Monitor, ChevronDown, ChevronUp,
  Download, Search, Camera, Copy, Code2, Maximize2, Layers, Users, ExternalLink, RefreshCw,
  Video, Radio,
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
}

interface Summary {
  total: number; active: number; pending: number; completed: number; terminated: number;
  needs_review: number; violations: number; avg_score: number | null; shared_devices: number;
}

interface TimelineEvent {
  type: string; label: string; details: string; timestamp: string; question: string;
  ip: string; user_agent: string; is_strike: boolean;
}

/** Statuses in which the candidate's browser may still be uploading. Mirrors
 *  `interview_recording.LIVE_SESSION_STATUSES`. */
const LIVE_SESSION_STATUSES = new Set(["active", "verified", "pending", "scheduled"]);
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
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Session recording</div>
        <RecordingPanel recording={recording} sessionStatus={row.session_status} token={row.invite_token} onLiveEnded={reload} />
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
                <span className="shrink-0 whitespace-nowrap text-muted">{fmtTime(v.timestamp)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
});

/* ---------- session recording (22 Sep 2026) ---------- */

interface Recording {
  available: boolean;
  url?: string;
  download_url?: string;
  size_bytes?: number;
  mime?: string;
  /** "s3" in production, "local" in development. Decides how we fetch it. */
  backend?: string;
  /** Why there is nothing to play, when available is false. */
  reason?: string;
  parts?: number;
  /** 23 Sep 2026 — the session is still running: stream the parts instead. */
  live?: boolean;
}

const RECORDING_ABSENCE: Record<string, string> = {
  not_recorded:
    "No recording was captured. Interviews taken before 22 Sep 2026, and any run with recording turned off, have none.",
  not_finalized: "The recording is still being assembled. Reopen this row in a moment.",
  storage_error: "The recording store could not be reached. Check the S3 configuration in Settings.",
  no_token: "This interview has no invite token, so nothing was recorded.",
};

interface LiveManifest {
  live: boolean;
  reason?: string;
  finalized?: boolean;
  parts: { seq: number; bytes: number }[];
  next_after: number;
  chunk_seconds?: number;
  session_status?: string;
}

const LIVE_MIME = 'video/webm; codecs="vp8,opus"';
const LIVE_RETRY_MS = 8000;

/**
 * Watches an interview WHILE it runs.
 *
 * The candidate's browser uploads a ~15 s WebM slice at a time; this polls the
 * manifest for slices it has not seen and appends each one to a MediaSource
 * buffer, so the reviewer runs about one slice behind real time. The first
 * slice carries the WebM header and every later one is a run of clusters with
 * absolute timecodes, so appending them in sequence IS the stream — a lost
 * slice shows as a jump, not a failure. Browsers without MediaSource (or a
 * buffer that rejects a slice) fall back to re-building one Blob from every
 * slice so far, keeping the playhead where it was.
 *
 * Parts are fetched through the app (`/part/{seq}`), never straight from S3:
 * a cross-origin `fetch()` would need bucket CORS for every dashboard origin.
 */
function LiveRecordingPlayer({ token, onEnded }: { token: string; onEnded: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<"connecting" | "waiting" | "streaming" | "ended" | "error">("connecting");
  const [err, setErr] = useState("");
  const [parts, setParts] = useState(0);
  const [behind, setBehind] = useState(0);
  const [atLive, setAtLive] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !token) return;
    let alive = true;
    let after = -1;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let mediaSource: MediaSource | null = null;
    let sourceBuffer: SourceBuffer | null = null;
    let objectUrl = "";
    let useBlob = false;
    let seekedToLive = false;
    const queue: ArrayBuffer[] = [];
    const all: ArrayBuffer[] = [];

    const bufferedEnd = () => {
      try { return video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0; } catch { return 0; }
    };
    const jumpToLive = () => {
      const end = bufferedEnd();
      if (end > 1) video.currentTime = Math.max(0, end - 0.5);
      void video.play().catch(() => { /* autoplay may need a click; controls are visible */ });
    };
    const refreshBlob = () => {
      if (!alive || !all.length) return;
      const pos = video.currentTime;
      const wasPlaying = !video.paused;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(new Blob(all, { type: "video/webm" }));
      video.src = objectUrl;
      const first = !seekedToLive;
      seekedToLive = true;
      // Nothing is seekable until the new source has metadata.
      video.addEventListener("loadedmetadata", () => {
        if (!alive) return;
        if (first) { jumpToLive(); return; }
        // Re-building the Blob resets the element; put the reviewer back where
        // they were rather than yanking them to the live edge every refresh.
        video.currentTime = pos;
        if (wasPlaying) void video.play().catch(() => { /* ignore */ });
      }, { once: true });
    };
    const fallbackToBlob = () => {
      if (useBlob) return;
      useBlob = true;
      sourceBuffer = null;
      try { if (mediaSource && mediaSource.readyState === "open") mediaSource.endOfStream(); } catch { /* ignore */ }
      mediaSource = null;
      refreshBlob();
    };
    const pump = () => {
      if (useBlob || !sourceBuffer || sourceBuffer.updating || !queue.length) return;
      try { sourceBuffer.appendBuffer(queue.shift()!); } catch { fallbackToBlob(); }
    };

    const mseOk = typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(LIVE_MIME);
    if (mseOk) {
      mediaSource = new MediaSource();
      objectUrl = URL.createObjectURL(mediaSource);
      video.src = objectUrl;
      mediaSource.addEventListener("sourceopen", () => {
        if (!alive || !mediaSource) return;
        try {
          sourceBuffer = mediaSource.addSourceBuffer(LIVE_MIME);
          sourceBuffer.addEventListener("updateend", () => {
            if (!seekedToLive && bufferedEnd() > 0) { seekedToLive = true; jumpToLive(); }
            pump();
          });
          sourceBuffer.addEventListener("error", fallbackToBlob);
          pump();
        } catch { fallbackToBlob(); }
      });
    } else {
      useBlob = true;
    }

    const onTime = () => {
      const gap = Math.max(0, bufferedEnd() - video.currentTime);
      setBehind(Math.round(gap));
      setAtLive(gap < 20);
    };
    video.addEventListener("timeupdate", onTime);

    const poll = async () => {
      if (!alive) return;
      try {
        const res = await authFetch(`/interview/recording/${encodeURIComponent(token)}/live?after=${after}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const m = (await res.json()) as LiveManifest;
        if (!m.live) {
          setErr(RECORDING_ABSENCE[m.reason || ""] || "The live stream is not available.");
          setPhase("error");
          return;
        }
        for (const p of m.parts || []) {
          if (!alive) return;
          const pr = await authFetch(`/interview/recording/${encodeURIComponent(token)}/part/${p.seq}`);
          if (!pr.ok) continue; // a lost slice is a gap, not a failure
          const buf = await pr.arrayBuffer();
          all.push(buf); queue.push(buf);
          after = p.seq;
        }
        if (!alive) return;
        if (m.parts?.length) {
          setParts(after + 1);
          setPhase("streaming");
          if (useBlob) refreshBlob(); else pump();
        } else if (after < 0) {
          setPhase("waiting");
        }
        const sessionLive = LIVE_SESSION_STATUSES.has(String(m.session_status || "")) && !m.finalized;
        if (!sessionLive) {
          setPhase("ended");
          // Give the server a moment to join the parts, then hand over to the
          // ordinary player via the detail re-fetch.
          timer = setTimeout(() => alive && onEnded(), 3000);
          return;
        }
        timer = setTimeout(poll, Math.max(4000, ((m.chunk_seconds || 15) * 1000) / 2));
      } catch {
        if (alive) timer = setTimeout(poll, LIVE_RETRY_MS);
      }
    };
    void poll();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      video.removeEventListener("timeupdate", onTime);
      try { video.pause(); } catch { /* ignore */ }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, onEnded]);

  const jump = () => {
    const v = videoRef.current;
    if (!v || !v.buffered.length) return;
    v.currentTime = Math.max(0, v.buffered.end(v.buffered.length - 1) - 0.5);
    void v.play().catch(() => { /* ignore */ });
  };

  return (
    <div className="space-y-2">
      <div className="relative w-full max-w-xl">
        {/* A proctoring capture has no caption track to offer — the interview's
            transcript lives on the candidate report. */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} controls autoPlay playsInline className="w-full rounded-control bg-black" aria-label="Live view of this interview" />
        <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-danger px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-raised">
          <span className="h-2 w-2 animate-pulse rounded-full bg-white" aria-hidden /> Live
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
        {phase === "connecting" && <span>Connecting to the live stream…</span>}
        {phase === "waiting" && <span>Interview is starting — waiting for the first slice from the candidate's camera.</span>}
        {phase === "streaming" && (
          <span>
            Streaming · {parts} slice{parts === 1 ? "" : "s"} received · about {behind}s behind the candidate.
          </span>
        )}
        {phase === "ended" && <span>The interview has ended — loading the full recording…</span>}
        {phase === "error" && <span className="text-danger">{err}</span>}
        {phase === "streaming" && !atLive && (
          <button type="button" onClick={jump} className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline dark:text-brand-300">
            <Radio className="h-3 w-3" /> Jump to live
          </button>
        )}
      </div>
    </div>
  );
}

function fmtBytes(n?: number): string {
  const bytes = Number(n) || 0;
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Plays the whole-session recording.
 *
 * Two fetch paths on purpose. In production `media_storage` hands back a
 * PRESIGNED S3 URL, which carries its own credentials and must go straight
 * into <video src> — putting our bearer token on it would break the
 * signature. The local driver serves through `/interview/media/...` behind the
 * dashboard's own auth, which <video> cannot send, so that one is fetched to a
 * blob first. `backend` tells us which we have.
 */
function RecordingPanel({ recording, sessionStatus, token, onLiveEnded }: {
  recording: Recording | null; sessionStatus: string; token: string; onLiveEnded: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState("");
  const [err, setErr] = useState("");
  const isLocal = recording?.backend === "local";
  const remoteUrl = recording?.url || "";

  useEffect(() => {
    setErr("");
    if (!recording?.available || !isLocal || !remoteUrl) { setBlobUrl(""); return; }
    let alive = true; let obj = "";
    authFetch(remoteUrl)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        obj = URL.createObjectURL(await r.blob());
        if (alive) setBlobUrl(obj);
      })
      .catch((e) => alive && setErr(e?.message || "Could not load the recording"));
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [recording?.available, isLocal, remoteUrl]);

  if (!recording) return <div className="text-xs text-muted">Checking for a recording…</div>;
  if (recording.live && !recording.available) {
    // The session is still running: stream the slices as they land.
    return <LiveRecordingPlayer token={token} onEnded={onLiveEnded} />;
  }
  if (!recording.available) {
    const reason = RECORDING_ABSENCE[recording.reason || ""] || "No recording is available for this interview.";
    return (
      <div className="flex items-start gap-2 rounded-control border border-subtle bg-surface-1 px-3 py-2 text-xs text-muted">
        <Video className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{reason}</span>
      </div>
    );
  }
  const src = isLocal ? blobUrl : remoteUrl;
  return (
    <div className="space-y-2">
      {err ? (
        <div className="text-xs text-danger">{err}</div>
      ) : !src ? (
        <div className="text-xs text-muted">Loading recording…</div>
      ) : (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- proctoring capture; the transcript is on the report
        <video
          src={src}
          controls
          preload="metadata"
          className="w-full max-w-xl rounded-control bg-black"
          aria-label="Full session recording of this interview"
        />
      )}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
        <span>
          Camera and microphone for the whole interview
          {sessionStatus === "terminated" ? ", up to the moment it was terminated" : ""}.
        </span>
        {recording.size_bytes ? <span className="tabular-nums">{fmtBytes(recording.size_bytes)}</span> : null}
        {recording.download_url && (
          <a
            className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline dark:text-brand-300"
            href={recording.download_url}
            target="_blank"
            rel="noreferrer"
          >
            <Download className="h-3 w-3" /> Download
          </a>
        )}
      </div>
    </div>
  );
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
    <div className="mx-auto max-w-screen-2xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="fx-glow flex h-10 w-10 items-center justify-center rounded-card bg-gradient-to-br from-brand-600 to-violet-600">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-display text-xl font-bold tracking-tight text-primary">Interview Integrity</h2>
            <p className="text-sm text-muted">Every AI interview, scored — tab switches, focus loss, camera, clipboard and dev-tools attempts. Watch a live interview or replay its recording from the row.</p>
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
