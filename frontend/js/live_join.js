/**
 * A recruiter joins the live AI interview (11 Oct 2026) — the candidate's side.
 *
 * Every few seconds the page checks `GET /candidate/live/state`:
 *  - paused  → the AI interviewer stops (no voice, no listening, clock frozen,
 *              integrity strikes not counted) and a card says a recruiter has
 *              joined; on resume the page asks the current question again — or
 *              the recruiter's own question when they queued one.
 *  - message → a short note from the recruiter on that card.
 *  - call    → a browser-to-browser audio/video call (WebRTC). The candidate's
 *              camera and microphone that are already open are reused (CLONED —
 *              never a second permission prompt). The recruiter's voice plays on
 *              this page and is mixed into the session recording.
 *
 * Nothing here can end or break the interview: every failure is logged and the
 * AI interview simply carries on.
 */
import { apiFetch, escapeHtml } from "./core.js";
import { mirrorStreamToRecording, ensureMixRunning } from "./recording_mix.js";

const DEFAULT_POLL_MS = 3000;
/** Longest wait for ICE candidates before the answer goes out (12 Oct 2026:
 *  4 s made a call feel like a buffer). Usually it settles in ~200 ms. */
const ICE_GATHER_TIMEOUT_MS = 1500;
/** Once a STUN-reflected candidate exists, wait only this much more. */
const ICE_SETTLE_AFTER_SRFLX_MS = 250;

let _hooks = null;
let _timer = null;
let _running = false;
let _paused = false;
let _lastMessageId = "";
let _pc = null;
let _callId = "";
let _remoteStream = null;
let _mixHandle = null;
let _localClones = [];
let _pollMs = DEFAULT_POLL_MS;
let _failures = 0;

/**
 * @param {object} hooks
 * @param {() => void} hooks.onPause      stop the AI turn, freeze the clock
 * @param {() => Promise<void>|void} hooks.onResume  ask the current question again
 * @param {() => MediaStream|null} hooks.getCameraStream
 * @param {() => MediaStream|null} hooks.getMicStream
 * @param {() => void} [hooks.onTimeUp]   the server says the time limit passed
 */
export function startLiveJoinWatch(hooks) {
  _hooks = hooks || {};
  if (_running) return;
  _running = true;
  _failures = 0;
  _ensureStyles();
  _schedule(600);
}

export function stopLiveJoinWatch() {
  _running = false;
  if (_timer) clearTimeout(_timer);
  _timer = null;
  _endCall();
  _hideCard();
  _paused = false;
}

export function isPausedByRecruiter() {
  return _paused;
}

/** The server said "paused" on /next or /answer before the poll noticed. */
export function enterPausedFromServer(live) {
  _applyState(Object.assign({ paused: true }, live || {}));
}

function _schedule(ms) {
  if (!_running) return;
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(_poll, ms);
}

async function _poll() {
  if (!_running) return;
  try {
    const res = await apiFetch("/candidate/live/state", { method: "GET", cache: "no-store" }, { timeoutMs: 8000 });
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      // Not an invite session (an HR demo) or the session ended — stop quietly.
      if (res.status !== 403) {
        _running = false;
        return;
      }
    }
    if (res.ok) {
      const data = await res.json();
      _failures = 0;
      if (data && data.enabled === false) {
        if (data.time_up) {
          _running = false;
          try { _hooks?.onTimeUp?.(); } catch (_) { /* ignore */ }
          return;
        }
        _schedule(10000);
        return;
      }
      // The server says how soon to look again: every second while a recruiter
      // has the live panel open (or the interview is paused / on a call).
      const ms = Number(data?.poll_ms) || Number(data?.poll_sec || 3) * 1000;
      _pollMs = Math.max(800, Math.min(10000, ms));
      if (data && data.time_up) {
        _running = false;
        try {
          _hooks?.onTimeUp?.();
        } catch (err) {
          console.warn("[live-join] time-up hook failed:", err?.message || err);
        }
        return;
      }
      await _applyState(data || {});
    } else {
      _failures += 1;
    }
  } catch (err) {
    _failures += 1;
    if (_failures === 3) console.warn("[live-join] state check failing:", err?.message || err);
  }
  _schedule(_failures ? Math.min(15000, _pollMs * (1 + _failures)) : _pollMs);
}

async function _applyState(data) {
  const wantPaused = !!data.paused;
  const call = data.call || null;
  if (wantPaused && !_paused) {
    _paused = true;
    try {
      _hooks?.onPause?.();
    } catch (err) {
      console.warn("[live-join] pause hook failed:", err?.message || err);
    }
  }
  if (wantPaused || call) {
    _showCard(data);
  }
  if (data.message_id && data.message_id !== _lastMessageId) {
    _lastMessageId = data.message_id;
    _flashMessage();
  }
  // The call: answer a new offer, end a call the recruiter hung up.
  if (call && call.id && call.id !== _callId && call.offer) {
    await _answerCall(call, data.ice_servers || []);
  } else if (!call && _callId) {
    _endCall();
  }
  if (!wantPaused && _paused) {
    _paused = false;
    if (!_callId) _hideCard();
    else _showCard(data);
    try {
      await _hooks?.onResume?.();
    } catch (err) {
      console.warn("[live-join] resume hook failed:", err?.message || err);
    }
  } else if (!wantPaused && !call && !_callId) {
    _hideCard();
  }
}

/* ------------------------------------------------------------------------- */
/* The call                                                                   */
/* ------------------------------------------------------------------------- */

function _cloneTracks(stream, kind) {
  if (!stream || typeof stream.getTracks !== "function") return [];
  return stream
    .getTracks()
    .filter((t) => t.kind === kind && t.readyState === "live")
    .slice(0, 1)
    .map((t) => {
      try {
        return t.clone();
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

function _waitForIce(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    let settleTimer = null;
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      pc.removeEventListener("icecandidate", onCand);
      if (settleTimer) clearTimeout(settleTimer);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    // A reflexive / relay candidate is what crosses NAT; with one in hand the
    // offer / answer can go — waiting for "complete" can take seconds.
    const onCand = (ev) => {
      const c = ev && ev.candidate ? String(ev.candidate.candidate || "") : "";
      if (!settleTimer && /typ (srflx|relay)/.test(c)) settleTimer = setTimeout(done, ICE_SETTLE_AFTER_SRFLX_MS);
    };
    pc.addEventListener("icegatheringstatechange", check);
    pc.addEventListener("icecandidate", onCand);
    setTimeout(done, ICE_GATHER_TIMEOUT_MS);
  });
}

async function _answerCall(call, iceServers) {
  _endCall();
  if (typeof RTCPeerConnection === "undefined") {
    console.warn("[live-join] this browser cannot take the call");
    return;
  }
  _callId = String(call.id);
  try {
    const pc = new RTCPeerConnection({ iceServers: Array.isArray(iceServers) ? iceServers : [] });
    _pc = pc;
    const cam = _hooks?.getCameraStream?.() || null;
    const mic = _hooks?.getMicStream?.() || null;
    const audio = _cloneTracks(mic, "audio").concat(mic ? [] : _cloneTracks(cam, "audio"));
    const video = call.video === false ? [] : _cloneTracks(cam, "video");
    _localClones = audio.concat(video);
    const local = new MediaStream(_localClones);
    _localClones.forEach((t) => pc.addTrack(t, local));
    pc.ontrack = (ev) => {
      _remoteStream = ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream([ev.track]);
      _attachRemote();
    };
    pc.onconnectionstatechange = () => {
      _setCallStatus(pc.connectionState);
      if (pc.connectionState === "failed") {
        console.warn("[live-join] call could not connect (network / firewall)");
      }
    };
    await pc.setRemoteDescription({ type: "offer", sdp: String(call.offer || "") });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await _waitForIce(pc);
    if (_pc !== pc) return;
    const res = await apiFetch("/candidate/live/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call_id: _callId, answer: pc.localDescription?.sdp || answer.sdp }),
    });
    if (!res.ok) {
      console.warn("[live-join] call answer refused", res.status);
      _endCall();
      return;
    }
    _setCallStatus("connecting");
  } catch (err) {
    console.warn("[live-join] could not take the call:", err?.message || err);
    _endCall();
  }
}

function _attachRemote() {
  const card = document.getElementById("kxLiveCard");
  if (!_remoteStream) return;
  const audioEl = document.getElementById("kxLiveRemoteAudio");
  if (audioEl && audioEl.srcObject !== _remoteStream) {
    audioEl.srcObject = _remoteStream;
    void audioEl.play().catch(() => {});
  }
  const videoEl = document.getElementById("kxLiveRemoteVideo");
  if (videoEl) {
    const hasVideo = _remoteStream.getVideoTracks().length > 0;
    videoEl.hidden = !hasVideo;
    if (hasVideo && videoEl.srcObject !== _remoteStream) {
      videoEl.srcObject = _remoteStream;
      void videoEl.play().catch(() => {});
    }
  }
  if (!_mixHandle && _remoteStream.getAudioTracks().length) {
    void ensureMixRunning();
    _mixHandle = mirrorStreamToRecording(_remoteStream);
  }
  if (card) card.classList.add("kx-live-oncall");
}

function _endCall() {
  try {
    _pc?.close();
  } catch (_) {
    /* ignore */
  }
  _pc = null;
  _callId = "";
  _localClones.forEach((t) => {
    try {
      t.stop();
    } catch (_) {
      /* ignore */
    }
  });
  _localClones = [];
  try {
    _mixHandle?.release();
  } catch (_) {
    /* ignore */
  }
  _mixHandle = null;
  _remoteStream = null;
  const audioEl = document.getElementById("kxLiveRemoteAudio");
  if (audioEl) audioEl.srcObject = null;
  const videoEl = document.getElementById("kxLiveRemoteVideo");
  if (videoEl) {
    videoEl.srcObject = null;
    videoEl.hidden = true;
  }
  document.getElementById("kxLiveCard")?.classList.remove("kx-live-oncall");
}

/* ------------------------------------------------------------------------- */
/* The card                                                                   */
/* ------------------------------------------------------------------------- */

function _ensureCard() {
  let card = document.getElementById("kxLiveCard");
  if (card) return card;
  card = document.createElement("div");
  card.id = "kxLiveCard";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-live", "polite");
  card.innerHTML = `
    <div class="kx-live-panel">
      <div class="kx-live-head">
        <span class="kx-live-dot" aria-hidden="true"></span>
        <div>
          <div class="kx-live-eyebrow">Karnex recruiter</div>
          <div class="kx-live-title" id="kxLiveTitle">A recruiter has joined your interview</div>
        </div>
      </div>
      <p class="kx-live-sub" id="kxLiveSub"></p>
      <div class="kx-live-msg" id="kxLiveMsg" hidden></div>
      <div class="kx-live-call">
        <video id="kxLiveRemoteVideo" autoplay playsinline hidden></video>
        <div class="kx-live-callstate" id="kxLiveCallState" hidden></div>
      </div>
      <ul class="kx-live-points">
        <li>The interview timer is paused — no time is lost.</li>
        <li>Warnings for looking away or leaving fullscreen are not counted now.</li>
        <li>Stay on this page; the interview continues when the recruiter resumes it.</li>
      </ul>
      <audio id="kxLiveRemoteAudio" autoplay></audio>
    </div>`;
  document.body.appendChild(card);
  return card;
}

function _showCard(data) {
  const card = _ensureCard();
  const by = escapeHtml(String(data.by || "A recruiter"));
  const onCall = !!(data.call || _callId);
  const title = document.getElementById("kxLiveTitle");
  const sub = document.getElementById("kxLiveSub");
  if (title) {
    title.innerHTML = onCall ? `You are on a call with ${by}` : `${by} from Karnex has paused the interview`;
  }
  if (sub) {
    sub.textContent = onCall
      ? "Speak normally — they can see and hear you. The AI interviewer is waiting."
      : "Please wait a moment. You may be asked a question by the recruiter.";
  }
  const msg = document.getElementById("kxLiveMsg");
  if (msg) {
    const text = String(data.message || "").trim();
    msg.hidden = !text;
    msg.textContent = text ? `“${text}”` : "";
  }
  card.classList.toggle("kx-live-callonly", onCall && !data.paused);
  card.classList.add("is-visible");
}

function _hideCard() {
  const card = document.getElementById("kxLiveCard");
  if (card) card.classList.remove("is-visible");
}

function _flashMessage() {
  const msg = document.getElementById("kxLiveMsg");
  if (!msg) return;
  msg.classList.remove("kx-live-flash");
  void msg.offsetWidth;
  msg.classList.add("kx-live-flash");
}

function _setCallStatus(state) {
  const el = document.getElementById("kxLiveCallState");
  if (!el) return;
  const words = {
    new: "Connecting the call…",
    connecting: "Connecting the call…",
    connected: "Call connected",
    disconnected: "Call interrupted — reconnecting…",
    failed: "The call could not connect on this network. The recruiter can still pause and type to you.",
    closed: "",
  };
  const text = words[state] ?? "";
  el.hidden = !text;
  el.textContent = text;
}

function _ensureStyles() {
  if (document.getElementById("kxLiveStyles")) return;
  const style = document.createElement("style");
  style.id = "kxLiveStyles";
  style.textContent = `
  #kxLiveCard{position:fixed;inset:0;z-index:2147482000;display:none;align-items:center;justify-content:center;
    padding:16px;background:rgba(15,23,42,.55);backdrop-filter:blur(3px)}
  #kxLiveCard.is-visible{display:flex}
  #kxLiveCard.kx-live-callonly{inset:auto 16px 16px auto;background:transparent;backdrop-filter:none;padding:0}
  #kxLiveCard.kx-live-callonly .kx-live-points{display:none}
  .kx-live-panel{width:min(520px,100%);background:#fff;color:#0f172a;border-radius:16px;
    box-shadow:0 24px 60px rgba(15,23,42,.35);padding:22px 22px 18px;border:1px solid #e2e8f0;
    font-family:Inter,system-ui,sans-serif}
  html.kx-dark .kx-live-panel{background:#0f172a;color:#e2e8f0;border-color:#1e293b}
  .kx-live-head{display:flex;gap:12px;align-items:center}
  .kx-live-dot{width:12px;height:12px;border-radius:50%;background:#f59e0b;box-shadow:0 0 0 6px rgba(245,158,11,.18);
    animation:kxLivePulse 1.6s ease-in-out infinite;flex:none}
  #kxLiveCard.kx-live-oncall .kx-live-dot{background:#10b981;box-shadow:0 0 0 6px rgba(16,185,129,.18)}
  @keyframes kxLivePulse{50%{box-shadow:0 0 0 10px rgba(245,158,11,.05)}}
  @media (prefers-reduced-motion:reduce){.kx-live-dot{animation:none}}
  .kx-live-eyebrow{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;font-weight:600}
  .kx-live-title{font-size:18px;font-weight:700;line-height:1.3}
  .kx-live-sub{margin:10px 0 0;font-size:14px;color:#475569}
  html.kx-dark .kx-live-sub{color:#94a3b8}
  .kx-live-msg{margin-top:12px;padding:10px 12px;border-radius:10px;background:#eff6ff;color:#1e3a8a;font-size:14px;
    border:1px solid #bfdbfe}
  html.kx-dark .kx-live-msg{background:#172554;color:#bfdbfe;border-color:#1e3a8a}
  .kx-live-msg.kx-live-flash{animation:kxLiveFlash .9s ease-out}
  @keyframes kxLiveFlash{0%{transform:scale(1.03)}100%{transform:none}}
  .kx-live-call video{margin-top:12px;width:100%;max-height:220px;border-radius:12px;background:#000;object-fit:cover}
  .kx-live-callstate{margin-top:8px;font-size:13px;color:#047857}
  .kx-live-points{margin:14px 0 0;padding-left:18px;font-size:13px;color:#475569;line-height:1.6}
  html.kx-dark .kx-live-points{color:#94a3b8}
  `;
  document.head.appendChild(style);
}
