/**
 * Session recording viewer (7 Oct 2026) — ONE player for the Integrity tab
 * and the candidate report page.
 *
 * Two streams side by side: the candidate's CAMERA (with the microphone) on
 * the left and their SCREEN on the right, so the reviewer sees which question
 * was up while the candidate answered. The camera element is the master; the
 * screen element follows it on play / pause / seek / rate and is nudged back
 * whenever it drifts (`SYNC_DRIFT_S`). A recording with no screen stream (a
 * phone, a refused share, interviews before this change) shows the camera
 * alone — nothing else changes.
 *
 * Controls are ours, not the browser's: play / pause, −30 −15 +15 +30
 * seconds, a scrub bar, speed, fullscreen and — on a finished recording —
 * Download (camera, and the screen when there is one; user ask 7 Oct 2026).
 * The native controls and context menu stay off so the two halves are only
 * driven through ONE transport. A download is a plain link: the S3 driver's
 * `download_url` is presigned with `Content-Disposition: attachment`, the
 * local driver's file is already a blob here, so the `download` attribute
 * names it.
 *
 * ⚠️ MediaRecorder's WebM carries no duration (the file ends whenever the
 * browser stopped), so `video.duration` reads Infinity and the scrub bar would
 * be useless. `fixDuration` seeks past the end once; the browser then reports
 * the real length (`durationchange`) and we seek back to 0.
 *
 * Two fetch paths, on purpose (unchanged from 22 Sep 2026): a PRESIGNED S3
 * `url` goes straight into `<video src>` (adding our bearer breaks the
 * signature); the local driver's `/interview/media/…` is behind dashboard
 * auth that `<video>` cannot send, so it is fetched to a blob first.
 *
 * Live (23 Sep 2026): while the session runs, the parts the candidate's
 * browser has uploaded ARE the stream — one manifest poll serves both
 * streams, each appended to its own MediaSource buffer (Blob rebuild
 * fallback). Parts come through the app, never presigned (bucket CORS).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Video, Radio, Play, Pause, Maximize2, Monitor, Camera, Download } from "lucide-react";
import { apiGet, authFetch } from "../../api/client";

export interface ScreenRecording {
  available: boolean;
  url?: string;
  download_url?: string;
  size_bytes?: number;
}

/** A file the reviewer may save: the href plus the name the browser should give it. */
export interface DownloadLink {
  label: string;
  href: string;
  filename: string;
}

export interface Recording {
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
  /** 7 Oct 2026 — the screen stream, when the browser shared one. */
  screen?: ScreenRecording;
  session_status?: string;
}

/** Statuses in which the candidate's browser may still be uploading. Mirrors
 *  `interview_recording.LIVE_SESSION_STATUSES`. */
export const LIVE_SESSION_STATUSES = new Set(["active", "verified", "pending", "scheduled"]);

export const RECORDING_ABSENCE: Record<string, string> = {
  not_recorded:
    "No recording was captured. Interviews taken before 22 Sep 2026, and any run with recording turned off, have none.",
  not_finalized: "The recording is still being assembled. Reopen this in a moment.",
  storage_error: "The recording store could not be reached. Check the S3 configuration in Settings.",
  no_token: "This interview has no invite token, so nothing was recorded.",
};

const LIVE_MIME = 'video/webm; codecs="vp8,opus"';
const LIVE_SCREEN_MIME = 'video/webm; codecs="vp8"';
const LIVE_RETRY_MS = 8000;
/** The screen is pulled back in line with the camera past this drift. */
const SYNC_DRIFT_S = 0.35;
const SEEK_STEPS = [-30, -15, 15, 30] as const;
const SPEEDS = [1, 1.25, 1.5, 2] as const;

export function fmtBytes(n?: number): string {
  const bytes = Number(n) || 0;
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtClock(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * MediaRecorder WebM has no duration header. Seeking past the end makes the
 * browser scan the file and report the real length; we then return to 0.
 * Resolves with the duration (or 0 when it cannot be learned).
 */
function fixDuration(video: HTMLVideoElement): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (d: number) => {
      if (settled) return;
      settled = true;
      resolve(Number.isFinite(d) && d > 0 ? d : 0);
    };
    const onMeta = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) { finish(video.duration); return; }
      const onDur = () => {
        if (Number.isFinite(video.duration) && video.duration > 0) {
          video.removeEventListener("durationchange", onDur);
          try { video.currentTime = 0; } catch { /* ignore */ }
          finish(video.duration);
        }
      };
      video.addEventListener("durationchange", onDur);
      try { video.currentTime = 1e101; } catch { finish(0); }
      setTimeout(() => { video.removeEventListener("durationchange", onDur); finish(0); }, 8000);
    };
    if (video.readyState >= 1) onMeta();
    else video.addEventListener("loadedmetadata", onMeta, { once: true });
  });
}

/** Keeps the screen element in lock-step with the camera element. */
function useFollow(master: React.RefObject<HTMLVideoElement>, follower: React.RefObject<HTMLVideoElement>, enabled: boolean) {
  useEffect(() => {
    const m = master.current;
    const f = follower.current;
    if (!enabled || !m || !f) return;
    const align = () => {
      // During `fixDuration`'s seek past the end the master briefly reads a
      // non-finite time; copying that onto the follower throws.
      const t = m.currentTime;
      if (!Number.isFinite(t)) return;
      if (Math.abs(f.currentTime - t) > SYNC_DRIFT_S) f.currentTime = t;
    };
    const onPlay = () => { align(); void f.play().catch(() => { /* ignore */ }); };
    const onPause = () => { f.pause(); };
    const onRate = () => { f.playbackRate = m.playbackRate; };
    m.addEventListener("play", onPlay);
    m.addEventListener("pause", onPause);
    m.addEventListener("seeking", align);
    m.addEventListener("seeked", align);
    m.addEventListener("timeupdate", align);
    m.addEventListener("ratechange", onRate);
    return () => {
      m.removeEventListener("play", onPlay);
      m.removeEventListener("pause", onPause);
      m.removeEventListener("seeking", align);
      m.removeEventListener("seeked", align);
      m.removeEventListener("timeupdate", align);
      m.removeEventListener("ratechange", onRate);
    };
  }, [master, follower, enabled]);
}

const BTN = "inline-flex h-8 items-center justify-center gap-1 rounded-control border border-subtle bg-surface-1 px-2.5 text-[11px] font-bold text-secondary transition-colors hover:bg-surface-2 disabled:opacity-40 tabular-nums";

/** The transport bar shared by the replay and the live player. */
function Transport({ video, duration, live, atLive, onJumpLive, extra }: {
  video: React.RefObject<HTMLVideoElement>;
  duration: number;
  live?: boolean;
  atLive?: boolean;
  onJumpLive?: () => void;
  extra?: React.ReactNode;
}) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [rate, setRate] = useState(1);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onTime = () => setTime(v.currentTime || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onPause);
    };
  }, [video]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => { /* ignore */ }); else v.pause();
  };
  const bufferedEnd = () => {
    const v = video.current;
    try { return v && v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0; } catch { return 0; }
  };
  const seekBy = (delta: number) => {
    const v = video.current;
    if (!v) return;
    const max = duration > 0 ? duration : bufferedEnd();
    const next = Math.max(0, Math.min(max > 0 ? max - 0.1 : Infinity, (v.currentTime || 0) + delta));
    v.currentTime = next;
  };
  const scrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = Number(e.target.value) || 0;
  };
  const speed = (r: number) => {
    const v = video.current;
    if (!v) return;
    v.playbackRate = r;
    setRate(r);
  };
  const fullscreen = () => {
    // Fullscreen the PAIR (the wrapper our parent gave us via the video's
    // closest container), not one video, so both halves stay in view.
    const el = video.current?.closest("[data-recording-stage]") as HTMLElement | null;
    try { void (el || video.current)?.requestFullscreen?.(); } catch { /* ignore */ }
  };
  const max = duration > 0 ? duration : Math.max(bufferedEnd(), time);

  return (
    <div ref={wrapRef} className="space-y-2">
      <input
        type="range"
        min={0}
        max={Math.max(1, max)}
        step={0.5}
        value={Math.min(time, Math.max(1, max))}
        onChange={scrub}
        aria-label="Recording position"
        className="h-1.5 w-full cursor-pointer accent-brand-600"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={toggle} className={BTN} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        {SEEK_STEPS.map((d) => (
          <button key={d} type="button" onClick={() => seekBy(d)} className={BTN} aria-label={`${d > 0 ? "Forward" : "Back"} ${Math.abs(d)} seconds`}>
            {d > 0 ? `+${d}s` : `${d}s`}
          </button>
        ))}
        <span className="ml-1 text-[11px] font-semibold tabular-nums text-muted">
          {fmtClock(time)}{duration > 0 ? ` / ${fmtClock(duration)}` : ""}
        </span>
        <span className="flex-1" />
        {live && !atLive && onJumpLive && (
          <button type="button" onClick={onJumpLive} className={`${BTN} text-brand-600 dark:text-brand-300`}>
            <Radio className="h-3 w-3" /> Jump to live
          </button>
        )}
        <select value={rate} onChange={(e) => speed(Number(e.target.value))} aria-label="Playback speed" className={`${BTN} pr-6`}>
          {SPEEDS.map((r) => <option key={r} value={r}>{r}×</option>)}
        </select>
        <button type="button" onClick={fullscreen} className={BTN} aria-label="Fullscreen">
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        {extra}
      </div>
    </div>
  );
}

const PANE = "relative min-w-0 flex-1 overflow-hidden rounded-control bg-black";
const PANE_TAG = "pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white";
const noMenu = (e: React.SyntheticEvent) => e.preventDefault();

/** Camera | screen, side by side; the screen half only when there is one. */
function Stage({ cam, screen, hasScreen, live, children }: {
  cam: React.RefObject<HTMLVideoElement>;
  screen: React.RefObject<HTMLVideoElement>;
  hasScreen: boolean;
  live?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div data-recording-stage className="flex flex-col gap-1 rounded-control bg-black p-1 sm:flex-row">
      <div className={`${PANE} ${hasScreen ? "aspect-video sm:w-1/2" : "aspect-video w-full"}`}>
        {/* A proctoring capture has no caption track — the transcript is on the report. */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={cam} playsInline preload="metadata" controlsList="nodownload noremoteplayback" disablePictureInPicture onContextMenu={noMenu} className="h-full w-full object-contain" aria-label="Candidate camera" />
        <span className={PANE_TAG}><Camera className="h-3 w-3" /> Candidate</span>
        {live && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-danger px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-raised">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" aria-hidden /> Live
          </span>
        )}
      </div>
      {hasScreen && (
        <div className={`${PANE} aspect-video sm:w-1/2`}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={screen} muted playsInline preload="metadata" controlsList="nodownload noremoteplayback" disablePictureInPicture onContextMenu={noMenu} className="h-full w-full object-contain" aria-label="Candidate screen" />
          <span className={PANE_TAG}><Monitor className="h-3 w-3" /> Screen</span>
        </div>
      )}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------- replay ---- */

function DownloadButtons({ links }: { links: DownloadLink[] }) {
  if (!links.length) return null;
  return (
    <>
      {links.map((l) => (
        <a key={l.label} href={l.href} download={l.filename} className={BTN} aria-label={`Download the ${l.label} recording`}>
          <Download className="h-3.5 w-3.5" /> {l.label}
        </a>
      ))}
    </>
  );
}

function DualPlayer({ camSrc, screenSrc, downloads }: { camSrc: string; screenSrc: string; downloads: DownloadLink[] }) {
  const camRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const hasScreen = !!screenSrc;
  useFollow(camRef, screenRef, hasScreen);

  useEffect(() => {
    const cam = camRef.current;
    if (!cam) return;
    let alive = true;
    cam.src = camSrc;
    void fixDuration(cam).then((d) => { if (alive) setDuration(d); });
    const sc = screenRef.current;
    if (sc && screenSrc) {
      sc.src = screenSrc;
      void fixDuration(sc);
    }
    return () => { alive = false; };
  }, [camSrc, screenSrc]);

  return (
    <div className="space-y-2">
      <Stage cam={camRef} screen={screenRef} hasScreen={hasScreen} />
      <Transport video={camRef} duration={duration} extra={<DownloadButtons links={downloads} />} />
    </div>
  );
}

/* --------------------------------------------------------------- live ---- */

interface LiveManifest {
  live: boolean;
  reason?: string;
  finalized?: boolean;
  parts: { seq: number; bytes: number }[];
  next_after: number;
  screen?: { parts: { seq: number; bytes: number }[]; next_after: number; recorded: boolean };
  chunk_seconds?: number;
  session_status?: string;
}

/** One MediaSource (or Blob-rebuild) feed for one <video>. */
class StreamFeed {
  private queue: ArrayBuffer[] = [];
  private all: ArrayBuffer[] = [];
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private objectUrl = "";
  private useBlob = false;
  private seekedToLive = false;
  alive = true;

  constructor(private video: HTMLVideoElement, private mime: string, private onFirst?: () => void) {
    const mseOk = typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(mime);
    if (mseOk) {
      this.mediaSource = new MediaSource();
      this.objectUrl = URL.createObjectURL(this.mediaSource);
      video.src = this.objectUrl;
      this.mediaSource.addEventListener("sourceopen", () => {
        if (!this.alive || !this.mediaSource) return;
        try {
          this.sourceBuffer = this.mediaSource.addSourceBuffer(mime);
          this.sourceBuffer.addEventListener("updateend", () => {
            if (!this.seekedToLive && this.bufferedEnd() > 0) { this.seekedToLive = true; this.onFirst?.(); }
            this.pump();
          });
          this.sourceBuffer.addEventListener("error", () => this.fallbackToBlob());
          this.pump();
        } catch { this.fallbackToBlob(); }
      });
    } else {
      this.useBlob = true;
    }
  }

  bufferedEnd(): number {
    try { return this.video.buffered.length ? this.video.buffered.end(this.video.buffered.length - 1) : 0; } catch { return 0; }
  }

  push(buf: ArrayBuffer) {
    this.all.push(buf);
    this.queue.push(buf);
  }

  flush() {
    if (this.useBlob) this.refreshBlob(); else this.pump();
  }

  private pump() {
    if (this.useBlob || !this.sourceBuffer || this.sourceBuffer.updating || !this.queue.length) return;
    try { this.sourceBuffer.appendBuffer(this.queue.shift()!); } catch { this.fallbackToBlob(); }
  }

  private refreshBlob() {
    if (!this.alive || !this.all.length) return;
    const v = this.video;
    const pos = v.currentTime;
    const wasPlaying = !v.paused;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(new Blob(this.all, { type: "video/webm" }));
    v.src = this.objectUrl;
    const first = !this.seekedToLive;
    this.seekedToLive = true;
    v.addEventListener("loadedmetadata", () => {
      if (!this.alive) return;
      if (first) { this.onFirst?.(); return; }
      // Re-building the Blob resets the element; put the reviewer back where
      // they were rather than yanking them to the live edge every refresh.
      v.currentTime = pos;
      if (wasPlaying) void v.play().catch(() => { /* ignore */ });
    }, { once: true });
  }

  private fallbackToBlob() {
    if (this.useBlob) return;
    this.useBlob = true;
    this.sourceBuffer = null;
    try { if (this.mediaSource && this.mediaSource.readyState === "open") this.mediaSource.endOfStream(); } catch { /* ignore */ }
    this.mediaSource = null;
    this.refreshBlob();
  }

  dispose() {
    this.alive = false;
    try { this.video.pause(); } catch { /* ignore */ }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
  }
}

function LiveDualPlayer({ token, onEnded }: { token: string; onEnded: () => void }) {
  const camRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<"connecting" | "waiting" | "streaming" | "ended" | "error">("connecting");
  const [err, setErr] = useState("");
  const [parts, setParts] = useState(0);
  const [behind, setBehind] = useState(0);
  const [atLive, setAtLive] = useState(true);
  const [hasScreen, setHasScreen] = useState(false);
  const camFeedRef = useRef<StreamFeed | null>(null);
  useFollow(camRef, screenRef, hasScreen);

  const jumpToLive = useCallback(() => {
    const v = camRef.current;
    const feed = camFeedRef.current;
    if (!v || !feed) return;
    const end = feed.bufferedEnd();
    if (end > 1) v.currentTime = Math.max(0, end - 0.5);
    void v.play().catch(() => { /* autoplay may need a click; the Play button is there */ });
  }, []);

  useEffect(() => {
    const cam = camRef.current;
    if (!cam || !token) return;
    let alive = true;
    let after = -1;
    let screenAfter = -1;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const camFeed = new StreamFeed(cam, LIVE_MIME, jumpToLive);
    camFeedRef.current = camFeed;
    let screenFeed: StreamFeed | null = null;

    const onTime = () => {
      const gap = Math.max(0, camFeed.bufferedEnd() - cam.currentTime);
      setBehind(Math.round(gap));
      setAtLive(gap < 20);
    };
    cam.addEventListener("timeupdate", onTime);

    const fetchPart = async (stream: "cam" | "screen", seq: number) => {
      const pr = await authFetch(`/interview/recording/${encodeURIComponent(token)}/part/${seq}?stream=${stream}`);
      if (!pr.ok) return null; // a lost slice is a gap, not a failure
      return pr.arrayBuffer();
    };

    const poll = async () => {
      if (!alive) return;
      try {
        const res = await authFetch(`/interview/recording/${encodeURIComponent(token)}/live?after=${after}&screen_after=${screenAfter}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const m = (await res.json()) as LiveManifest;
        if (!m.live) {
          setErr(RECORDING_ABSENCE[m.reason || ""] || "The live stream is not available.");
          setPhase("error");
          return;
        }
        for (const p of m.parts || []) {
          if (!alive) return;
          const buf = await fetchPart("cam", p.seq);
          if (buf) camFeed.push(buf);
          after = p.seq;
        }
        const screenParts = m.screen?.parts || [];
        if (screenParts.length && !screenFeed) {
          // The screen element mounts once we know a screen stream exists.
          setHasScreen(true);
          await new Promise((r) => setTimeout(r, 0));
          if (screenRef.current) screenFeed = new StreamFeed(screenRef.current, LIVE_SCREEN_MIME);
        }
        for (const p of screenParts) {
          if (!alive) return;
          const buf = await fetchPart("screen", p.seq);
          if (buf && screenFeed) screenFeed.push(buf);
          screenAfter = p.seq;
        }
        if (!alive) return;
        if (m.parts?.length) {
          setParts(after + 1);
          setPhase("streaming");
          camFeed.flush();
        } else if (after < 0) {
          setPhase("waiting");
        }
        if (screenParts.length && screenFeed) screenFeed.flush();
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
      cam.removeEventListener("timeupdate", onTime);
      camFeed.dispose();
      screenFeed?.dispose();
      camFeedRef.current = null;
    };
  }, [token, onEnded, jumpToLive]);

  return (
    <div className="space-y-2">
      <Stage cam={camRef} screen={screenRef} hasScreen={hasScreen} live />
      <Transport video={camRef} duration={0} live atLive={atLive} onJumpLive={jumpToLive} />
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
        {phase === "connecting" && <span>Connecting to the live stream…</span>}
        {phase === "waiting" && <span>Interview is starting — waiting for the first slice from the candidate's camera.</span>}
        {phase === "streaming" && (
          <span>
            Streaming · {parts} slice{parts === 1 ? "" : "s"} received · about {behind}s behind the candidate
            {hasScreen ? " · camera + screen" : " · camera only (the screen was not shared)"}.
          </span>
        )}
        {phase === "ended" && <span>The interview has ended — loading the full recording…</span>}
        {phase === "error" && <span className="text-danger">{err}</span>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- panel ---- */

/**
 * Plays the whole-session recording from a `recording` payload the caller
 * already holds (the Integrity detail endpoint returns one).
 */
export function RecordingPanel({ recording, sessionStatus, token, onLiveEnded }: {
  recording: Recording | null; sessionStatus: string; token: string; onLiveEnded: () => void;
}) {
  const [camUrl, setCamUrl] = useState("");
  const [screenUrl, setScreenUrl] = useState("");
  const [err, setErr] = useState("");
  const isLocal = recording?.backend === "local";
  const remoteCam = recording?.url || "";
  const remoteScreen = recording?.screen?.available ? recording.screen.url || "" : "";

  useEffect(() => {
    setErr("");
    if (!recording?.available) { setCamUrl(""); setScreenUrl(""); return; }
    if (!isLocal) { setCamUrl(remoteCam); setScreenUrl(remoteScreen); return; }
    let alive = true;
    const objs: string[] = [];
    const toBlob = async (url: string) => {
      if (!url) return "";
      const r = await authFetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const obj = URL.createObjectURL(await r.blob());
      objs.push(obj);
      return obj;
    };
    Promise.all([toBlob(remoteCam), toBlob(remoteScreen).catch(() => "")])
      .then(([c, s]) => { if (alive) { setCamUrl(c); setScreenUrl(s); } })
      .catch((e) => alive && setErr(e?.message || "Could not load the recording"));
    return () => { alive = false; objs.forEach((o) => URL.revokeObjectURL(o)); };
  }, [recording?.available, isLocal, remoteCam, remoteScreen]);

  if (!recording) return <div className="text-xs text-muted">Checking for a recording…</div>;
  if (recording.live && !recording.available) {
    return <LiveDualPlayer token={token} onEnded={onLiveEnded} />;
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
  const hasScreen = !!recording.screen?.available;
  // Local driver: the files are already blobs here, so the link IS the blob
  // and `download=` names it. S3: `download_url` carries the attachment
  // disposition, so the browser saves instead of opening it (the `download`
  // attribute is ignored cross-origin; the header is what does the work).
  const stem = `interview-${token.slice(0, 12).replace(/[^A-Za-z0-9]+$/, "")}`;
  const downloads: DownloadLink[] = [];
  const camDl = isLocal ? camUrl : recording.download_url || "";
  if (camDl) downloads.push({ label: "Camera", href: camDl, filename: `${stem}.webm` });
  const screenDl = isLocal ? screenUrl : recording.screen?.download_url || "";
  if (hasScreen && screenDl) downloads.push({ label: "Screen", href: screenDl, filename: `${stem}-screen.webm` });
  return (
    <div className="space-y-2">
      {err ? (
        <div className="text-xs text-danger">{err}</div>
      ) : !camUrl ? (
        <div className="text-xs text-muted">Loading recording…</div>
      ) : (
        <DualPlayer camSrc={camUrl} screenSrc={screenUrl} downloads={downloads} />
      )}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
        <span>
          {hasScreen ? "Camera, microphone and screen" : "Camera and microphone (the screen was not shared)"} for the whole interview
          {sessionStatus === "terminated" ? ", up to the moment it was terminated" : ""}.
        </span>
        {recording.size_bytes ? (
          <span className="tabular-nums">{fmtBytes((recording.size_bytes || 0) + (recording.screen?.size_bytes || 0))}</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Self-fetching viewer for pages that only know the invite token (the
 * candidate report). Re-fetches when a live session ends.
 */
export function RecordingViewer({ token }: { token: string }) {
  const [recording, setRecording] = useState<Recording | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!token) { setRecording({ available: false, reason: "no_token" }); return; }
    setRecording(null);
    apiGet<Recording>(`/interview/recording/${encodeURIComponent(token)}`, { force: true })
      .then((r) => { if (!cancelled) setRecording(r || { available: false, reason: "not_recorded" }); })
      .catch(() => { if (!cancelled) setRecording({ available: false, reason: "storage_error" }); });
    return () => { cancelled = true; };
  }, [token, tick]);

  return <RecordingPanel recording={recording} sessionStatus={recording?.session_status || ""} token={token} onLiveEnded={reload} />;
}
