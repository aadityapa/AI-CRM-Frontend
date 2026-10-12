/**
 * Join a running AI interview (11 Oct 2026) — the recruiter's side.
 *
 * From the Integrity tab a TA (or anyone with the tab) can:
 *  1. Pause the AI interviewer — the candidate sees a card, the interview clock
 *     stops and integrity warnings are not counted; Resume carries on.
 *  2. Send a short note to the candidate's screen.
 *  3. Queue their OWN question — it is asked next (spoken by the AI voice),
 *     answered like any other and scored against the role.
 *  4. Start a live audio/video call (browser to browser, WebRTC). Starting a
 *     call pauses the AI first, so the candidate is never talking to both.
 *
 * Server: `GET /interview/live/{token}` + `POST /interview/live/{token}/{action}`
 * (backend `services/interview_live.py`). Media never passes through our server.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pause, Play, Phone, PhoneOff, Mic, MicOff, Video, VideoOff, Send, MessageSquare,
  HelpCircle, Trash2, Clock, Radio, Wifi, WifiOff, History, X,
} from "lucide-react";
import { authFetch } from "../../api/client";
import { Modal } from "../../crm/components/ui";

type LiveQuestion = { id: string; text: string; by?: string; at?: number; index?: number };
type LiveLog = { at: number; by: string; action: string; text?: string };
export type LiveState = {
  enabled: boolean;
  rev: number;
  paused: boolean;
  paused_for_sec: number;
  pause_total_sec: number;
  pause_count: number;
  paused_by: string;
  max_pause_sec: number;
  message: { id: string; text: string; by: string } | null;
  questions: LiveQuestion[];
  asked: LiveQuestion[];
  joined: { id: string; name: string; at: number }[];
  call: { id: string; by: string; at: number; video: boolean; answered: boolean; answer: string | null } | null;
  candidate_online: boolean;
  log: LiveLog[];
  poll_sec: number;
  presence_every_sec?: number;
  ice_servers: RTCIceServer[];
  session_status: string;
  candidate_name: string;
};

/** Longest ICE wait before the offer goes (12 Oct 2026: 4 s felt like a
 *  buffer). With a STUN-reflected candidate in hand only 250 ms more. */
const ICE_GATHER_TIMEOUT_MS = 1500;
const ICE_SETTLE_AFTER_SRFLX_MS = 250;
/** Poll fast while something is about to change (a call ringing, right after
 *  an action), at the normal pace otherwise. */
const FAST_POLL_MS = 800;
const NORMAL_POLL_MS = 2000;

async function liveGet(token: string): Promise<LiveState> {
  const res = await authFetch(`/interview/live/${encodeURIComponent(token)}`, { method: "GET", cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error((data && data.error) || `Could not load the live controls (${res.status}).`);
  return data as LiveState;
}

async function livePost(token: string, action: string, body: Record<string, unknown> = {}): Promise<LiveState> {
  const res = await authFetch(`/interview/live/${encodeURIComponent(token)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error((data && data.error) || `That did not work (${res.status}).`);
  return data as LiveState;
}

function waitForIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    let settle = 0;
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const onCand = (ev: RTCPeerConnectionIceEvent) => {
      const c = ev.candidate ? String(ev.candidate.candidate || "") : "";
      if (!settle && /typ (srflx|relay)/.test(c)) settle = window.setTimeout(done, ICE_SETTLE_AFTER_SRFLX_MS);
    };
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      pc.removeEventListener("icecandidate", onCand);
      if (settle) window.clearTimeout(settle);
      resolve();
    };
    pc.addEventListener("icegatheringstatechange", check);
    pc.addEventListener("icecandidate", onCand);
    window.setTimeout(done, ICE_GATHER_TIMEOUT_MS);
  });
}

const mmss = (sec: number) => {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const clock = (epoch: number) =>
  epoch ? new Date(epoch * 1000).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }) : "";

const ACTION_WORDS: Record<string, string> = {
  joined: "opened the live controls",
  paused: "paused the interview",
  resumed: "resumed the interview",
  auto_resumed: "— the pause ended by itself",
  message: "sent a note",
  question_added: "queued a question",
  question_removed: "removed a queued question",
  call_started: "started a call",
  call_ended: "ended the call",
};

const BTN = "inline-flex items-center justify-center gap-2 rounded-control px-3.5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const BTN_SOFT = `${BTN} border border-subtle bg-surface-1 text-secondary hover:bg-surface-2 hover:text-primary`;

export function LiveJoinPanel({
  token, candidateName, onClose, fallbackVideo, autoCall = false,
}: {
  token: string;
  candidateName: string;
  /** "Join now": start the call as soon as the controls load (one click). */
  autoCall?: boolean;
  onClose: () => void;
  /** Shown until a call connects — the ~15 s-behind live recording. */
  fallbackVideo?: React.ReactNode;
}) {
  const [st, setSt] = useState<LiveState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [question, setQuestion] = useState("");
  const [callPhase, setCallPhase] = useState<"idle" | "starting" | "ringing" | "connected" | "failed">("idle");
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [withVideo, setWithVideo] = useState(true);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const selfVideoRef = useRef<HTMLVideoElement | null>(null);
  const callIdRef = useRef<string>("");
  const joinedRef = useRef(false);

  const finished = st ? ["completed", "terminated"].includes(String(st.session_status || "").toLowerCase()) : false;

  /* ---------------- polling ---------------- */
  const refresh = useCallback(async () => {
    try {
      const next = await liveGet(token);
      setSt(next);
      setError("");
      return next;
    } catch (e: any) {
      setError(e?.message || "Could not load the live controls.");
      return null;
    }
  }, [token]);

  // Fast polling while a call rings or right after an action, so the
  // candidate's answer / reaction shows within a second.
  const fastUntilRef = useRef(0);
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const loop = async () => {
      const next = await refresh();
      if (!alive) return;
      const ringing = !!(callIdRef.current && next?.call && !next.call.answered);
      const fast = ringing || Date.now() < fastUntilRef.current;
      timer = window.setTimeout(loop, fast ? FAST_POLL_MS : NORMAL_POLL_MS);
    };
    void loop();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [refresh]);

  // Say "I'm here" at once (in parallel with the first read) — the candidate's
  // page switches to one check a second while a recruiter is present — then
  // keep saying it while the panel stays open.
  useEffect(() => {
    if (joinedRef.current) return;
    joinedRef.current = true;
    void livePost(token, "join").then(setSt).catch(() => {});
  }, [token]);
  const presenceSec = st?.presence_every_sec || 15;
  useEffect(() => {
    if (finished) return;
    const id = window.setInterval(() => { void livePost(token, "presence").catch(() => {}); }, presenceSec * 1000);
    return () => window.clearInterval(id);
  }, [token, finished, presenceSec]);

  /* ---------------- actions ---------------- */
  const act = useCallback(async (action: string, body: Record<string, unknown> = {}, label = action) => {
    setBusy(label);
    fastUntilRef.current = Date.now() + 10_000;
    setError("");
    try {
      const next = await livePost(token, action, body);
      setSt(next);
      return next;
    } catch (e: any) {
      setError(e?.message || "That did not work.");
      return null;
    } finally {
      setBusy("");
    }
  }, [token]);

  const sendNote = async () => {
    const text = note.trim();
    if (!text) return;
    if (await act("message", { text }, "note")) setNote("");
  };
  const queueQuestion = async () => {
    const text = question.trim();
    if (text.length < 5) {
      setError("Type the full question (at least 5 characters).");
      return;
    }
    if (await act("question", { text }, "question")) setQuestion("");
  };

  /* ---------------- the call ---------------- */
  const cleanupCall = useCallback(() => {
    try {
      pcRef.current?.close();
    } catch {
      /* ignore */
    }
    pcRef.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    callIdRef.current = "";
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (selfVideoRef.current) selfVideoRef.current.srcObject = null;
    setMuted(false);
    setCamOff(false);
  }, []);

  useEffect(() => () => cleanupCall(), [cleanupCall]);

  const startCall = async () => {
    if (!st) return;
    if (typeof RTCPeerConnection === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot make calls. Use the latest Chrome or Edge.");
      return;
    }
    setCallPhase("starting");
    setError("");
    try {
      fastUntilRef.current = Date.now() + 20_000;
      // The AI must not keep asking while two people talk — the pause and the
      // camera / mic prompt run side by side, not one after the other.
      const [, local] = await Promise.all([
        st.paused ? Promise.resolve(null) : livePost(token, "pause", { reason: "Recruiter call" }).then(setSt),
        navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo }),
      ]);
      localRef.current = local;
      if (selfVideoRef.current) {
        selfVideoRef.current.srcObject = local;
        void selfVideoRef.current.play().catch(() => {});
      }
      const pc = new RTCPeerConnection({ iceServers: st.ice_servers || [] });
      pcRef.current = pc;
      local.getTracks().forEach((t) => pc.addTrack(t, local));
      // Receive the candidate's camera + microphone even when we send no video.
      if (!withVideo) pc.addTransceiver("video", { direction: "recvonly" });
      pc.ontrack = (ev) => {
        const stream = ev.streams?.[0] || new MediaStream([ev.track]);
        if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== stream) {
          remoteVideoRef.current.srcObject = stream;
          void remoteVideoRef.current.play().catch(() => {});
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") setCallPhase("connected");
        if (pc.connectionState === "failed") setCallPhase("failed");
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIce(pc);
      const next = await livePost(token, "call", { offer: pc.localDescription?.sdp || offer.sdp, video: true });
      callIdRef.current = next.call?.id || "";
      setSt(next);
      setCallPhase("ringing");
    } catch (e: any) {
      cleanupCall();
      setCallPhase("idle");
      const msg = String(e?.name || "") === "NotAllowedError"
        ? "Allow camera and microphone for this site to call the candidate."
        : e?.message || "The call could not start.";
      setError(msg);
    }
  };

  // "Join now" from the Integrity row: call as soon as the first state arrives.
  const autoCalledRef = useRef(false);
  useEffect(() => {
    if (!autoCall || autoCalledRef.current || !st || finished || callPhase !== "idle") return;
    autoCalledRef.current = true;
    void startCall();
    // startCall reads the latest state itself; it must run once only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCall, st, finished, callPhase]);

  // The candidate's answer arrives through the poll.
  useEffect(() => {
    const pc = pcRef.current;
    const call = st?.call;
    if (!pc || !call || call.id !== callIdRef.current || !call.answered || !call.answer) return;
    if (pc.remoteDescription) return;
    void pc.setRemoteDescription({ type: "answer", sdp: call.answer }).catch((e) => {
      setError(e?.message || "The call could not connect.");
      setCallPhase("failed");
    });
  }, [st]);

  // Someone else ended the call, or the interview finished.
  useEffect(() => {
    if (!callIdRef.current) return;
    if (!st?.call || st.call.id !== callIdRef.current || finished) {
      cleanupCall();
      setCallPhase("idle");
    }
  }, [st, finished, cleanupCall]);

  const endCall = async () => {
    cleanupCall();
    setCallPhase("idle");
    await act("hangup", {}, "hangup");
  };

  const toggleMute = () => {
    const next = !muted;
    localRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  };
  const toggleCam = () => {
    const next = !camOff;
    localRef.current?.getVideoTracks().forEach((t) => (t.enabled = !next));
    setCamOff(next);
  };

  const inCall = callPhase !== "idle" && callPhase !== "failed";
  const sectionTitle = "mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted";

  return (
    <Modal
      title={`Live interview · ${candidateName || st?.candidate_name || "Candidate"}`}
      onClose={() => {
        if (inCall) void endCall();
        onClose();
      }}
      xl
    >
      {/* ---------- status strip ---------- */}
      <div className={`mb-4 flex flex-wrap items-center gap-3 rounded-card border px-4 py-3 ${
        st?.paused ? "border-warning/40 bg-warning-soft" : "border-success/30 bg-success-soft"}`}
      >
        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${st?.paused ? "bg-warning text-white" : "bg-success text-white"}`}>
          {st?.paused ? <Pause className="h-4 w-4" /> : <Radio className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-primary">
            {finished ? "This interview has finished"
              : st?.paused ? `Paused by ${st.paused_by || "a recruiter"} · ${mmss(st.paused_for_sec)}`
              : "The AI interviewer is running"}
          </div>
          <div className="text-xs text-secondary">
            {st?.paused
              ? `The clock is stopped and warnings are not counted. It resumes by itself after ${Math.round((st.max_pause_sec || 1200) / 60)} min.`
              : "Pause to talk to the candidate or ask your own question."}
            {st && st.pause_total_sec > 0 ? ` · Paused ${mmss(st.pause_total_sec)} in total` : ""}
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
          st?.candidate_online ? "bg-success/15 text-success" : "bg-surface-2 text-muted"}`}
        >
          {st?.candidate_online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {st?.candidate_online ? "Candidate online" : "Waiting for the candidate's page"}
        </span>
        {!finished && !inCall && (
          <button type="button" className={`${BTN} bg-gradient-to-r from-brand-600 to-violet-600 text-white shadow-raised hover:opacity-90`}
                  disabled={!st} onClick={() => void startCall()} title="Pauses the AI and calls the candidate in one click">
            <Phone className="h-4 w-4" /> Join now · talk to the candidate
          </button>
        )}
        {!finished && (st?.paused ? (
          <button type="button" className={`${BTN} bg-success text-white hover:opacity-90`} disabled={!!busy || !st}
                  onClick={() => void act("resume", {}, "resume")}>
            <Play className="h-4 w-4" /> Resume interview
          </button>
        ) : (
          <button type="button" className={`${BTN} bg-warning text-white hover:opacity-90`} disabled={!!busy || !st}
                  onClick={() => void act("pause", {}, "pause")}>
            <Pause className="h-4 w-4" /> Pause interview
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setError("")}><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* ---------- left: see and talk ---------- */}
        <div className="min-w-0 space-y-3">
          <div className="relative overflow-hidden rounded-card border border-subtle bg-black">
            {/* A live call has no caption track. */}
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={remoteVideoRef} autoPlay playsInline className={`aspect-video w-full object-cover ${inCall ? "" : "hidden"}`} />
            {inCall && (
              <video ref={selfVideoRef} autoPlay playsInline muted
                     className="absolute bottom-3 right-3 h-24 w-32 rounded-control border border-white/30 object-cover shadow-overlay" />
            )}
            {inCall && callPhase !== "connected" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-white">
                <Phone className="h-6 w-6 animate-pulse" />
                <span className="text-sm font-semibold">{callPhase === "starting" ? "Starting the call…" : "Calling the candidate…"}</span>
                <span className="text-xs text-white/70">Their page answers by itself within a few seconds.</span>
              </div>
            )}
            {!inCall && (
              <div className="bg-surface-1 p-3">{fallbackVideo || (
                <div className="py-10 text-center text-sm text-muted">Start a call to see and talk to the candidate in real time.</div>
              )}</div>
            )}
          </div>

          {!finished && (
            <div className="flex flex-wrap items-center gap-2">
              {!inCall ? (
                <>
                  <button type="button" className={`${BTN} bg-gradient-to-r from-brand-600 to-violet-600 text-white hover:opacity-90`}
                          disabled={!st} onClick={() => void startCall()}>
                    <Phone className="h-4 w-4" /> Call the candidate
                  </button>
                  <label className="inline-flex items-center gap-2 text-xs text-secondary">
                    <input type="checkbox" checked={withVideo} onChange={(e) => setWithVideo(e.target.checked)} />
                    With my camera
                  </label>
                  {callPhase === "failed" && (
                    <span className="text-xs text-danger">
                      The call could not connect on this network. A TURN server fixes this — see the deployment guide.
                    </span>
                  )}
                </>
              ) : (
                <>
                  <button type="button" className={BTN_SOFT} onClick={toggleMute}>
                    {muted ? <MicOff className="h-4 w-4 text-danger" /> : <Mic className="h-4 w-4" />} {muted ? "Unmute" : "Mute"}
                  </button>
                  {withVideo && (
                    <button type="button" className={BTN_SOFT} onClick={toggleCam}>
                      {camOff ? <VideoOff className="h-4 w-4 text-danger" /> : <Video className="h-4 w-4" />} {camOff ? "Camera on" : "Camera off"}
                    </button>
                  )}
                  <button type="button" className={`${BTN} bg-danger text-white hover:opacity-90`} onClick={() => void endCall()}>
                    <PhoneOff className="h-4 w-4" /> End call
                  </button>
                  <span className="text-xs text-muted">{callPhase === "connected" ? "Connected · this call is in the recording" : ""}</span>
                </>
              )}
            </div>
          )}

          <p className="text-xs text-muted">
            Calls go browser to browser and are added to the interview recording. Starting a call pauses the AI
            first. When you are done, press <b>Resume interview</b> — the AI asks your queued question next, then carries on.
          </p>
        </div>

        {/* ---------- right: note, question, log ---------- */}
        <div className="min-w-0 space-y-4">
          <section>
            <div className={sectionTitle}><HelpCircle className="h-3.5 w-3.5" /> Ask your own question</div>
            <textarea
              className="w-full rounded-control border border-subtle bg-surface-1 px-3 py-2 text-sm text-primary focus:border-brand-500 focus:outline-none"
              rows={3} maxLength={600} placeholder="e.g. Walk me through how you debugged the CAN bus timeout you mentioned."
              value={question} onChange={(e) => setQuestion(e.target.value)} disabled={finished}
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted">Asked next by the AI voice, answered and scored like any question.</span>
              <button type="button" className={`${BTN} bg-brand-600 text-white hover:bg-brand-700`}
                      disabled={finished || busy === "question" || question.trim().length < 5} onClick={() => void queueQuestion()}>
                <Send className="h-4 w-4" /> Queue question
              </button>
            </div>
            {(st?.questions?.length || 0) > 0 && (
              <ul className="mt-2 space-y-1.5">
                {st!.questions.map((q) => (
                  <li key={q.id} className="flex items-start gap-2 rounded-control border border-brand-500/30 bg-brand-50 px-3 py-2 text-sm dark:bg-brand-900/30">
                    <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
                    <span className="min-w-0 flex-1 text-primary">{q.text}<span className="block text-[11px] text-muted">Waiting — asked when the interview resumes / at the next question</span></span>
                    <button type="button" aria-label="Remove question" className="text-muted hover:text-danger"
                            onClick={() => void act("remove-question", { id: q.id }, "remove")}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {(st?.asked?.length || 0) > 0 && (
              <div className="mt-2 space-y-1">
                <div className="text-[11px] font-semibold text-muted">Already asked</div>
                {st!.asked.map((q) => (
                  <div key={q.id} className="rounded-control bg-surface-2 px-3 py-1.5 text-xs text-secondary">✓ {q.text}</div>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className={sectionTitle}><MessageSquare className="h-3.5 w-3.5" /> Note on the candidate's screen</div>
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-control border border-subtle bg-surface-1 px-3 py-2 text-sm text-primary focus:border-brand-500 focus:outline-none"
                maxLength={300} placeholder="e.g. Please check your microphone, we can't hear you."
                value={note} onChange={(e) => setNote(e.target.value)} disabled={finished}
                onKeyDown={(e) => { if (e.key === "Enter") void sendNote(); }}
              />
              <button type="button" className={BTN_SOFT} disabled={finished || !note.trim() || busy === "note"} onClick={() => void sendNote()}>
                Send
              </button>
            </div>
            {st?.message && <div className="mt-1.5 text-[11px] text-muted">Showing now: “{st.message.text}”</div>}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {["Please check your microphone.", "Please stay in front of the camera.", "One moment — I'll resume shortly."].map((t) => (
                <button key={t} type="button" className="rounded-full border border-subtle px-2.5 py-1 text-[11px] text-secondary hover:bg-surface-2"
                        onClick={() => setNote(t)} disabled={finished}>{t}</button>
              ))}
            </div>
          </section>

          <section>
            <div className={sectionTitle}><History className="h-3.5 w-3.5" /> What happened</div>
            {(st?.log?.length || 0) === 0 ? (
              <div className="text-xs text-muted">Nothing yet.</div>
            ) : (
              <ol className="max-h-48 space-y-1 overflow-y-auto pr-1">
                {[...(st?.log || [])].reverse().map((e, i) => (
                  <li key={i} className="flex gap-2 text-xs">
                    <span className="w-16 shrink-0 text-muted">{clock(e.at)}</span>
                    <span className="min-w-0 flex-1 text-secondary">
                      <b className="text-primary">{e.by}</b> {ACTION_WORDS[e.action] || e.action}
                      {e.text ? <span className="text-muted"> — {e.text}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </Modal>
  );
}
