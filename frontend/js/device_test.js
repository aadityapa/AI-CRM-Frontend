/**
 * Pre-Interview Device Test gate (Feature 4, May 2026).
 * ====================================================
 *
 * Validates four prerequisites before the candidate is allowed to enter the
 * interview screen:
 *   1. Microphone   — request permission, sample audio levels for ~3s and
 *                     confirm we actually pick up the candidate's voice.
 *   2. Speaker      — play a soft generated tone and wait for explicit
 *                     "Yes, I hear it" confirmation.
 *   3. Webcam       — open a live preview and wait for explicit confirmation
 *                     that the candidate can see themselves.
 *   4. Internet     — measure a simple HTTP round-trip to `/healthz` (with
 *                     `/version` as a fallback) and read `navigator.onLine`.
 *
 * The Continue button is disabled until all four checks report `ok`. We expose
 * `runDeviceTestGate()` as a Promise so the welcome flow can `await` user
 * approval before starting the actual invite login.
 *
 * Backward compatibility:
 *   - The gate is opt-in: the rest of the app only invokes it when an
 *     `?invite=…` link is loaded. Existing HR/admin flows are untouched.
 *   - We never re-throw fatal errors out of the public API; resolve(false) is
 *     used for "candidate cancelled / went back" so the caller can show a
 *     friendly fallback (return to welcome screen) instead of a stack trace.
 */

const TILE_NAMES = {
  mic: "Microphone",
  speaker: "Speaker",
  webcam: "Webcam",
  network: "Internet",
};

const STATUS_BADGE_TEXT = {
  pending: "Pending",
  required: "Required",
  testing: "Checking",
  ok: "Ready",
  error: "Failed",
  // Used only by the webcam tile when the candidate's system has no camera
  // (or the candidate explicitly skips). The webcam is NOT a hard requirement
  // for the interview — mic + speaker + internet are.
  skipped: "Optional",
};

// Webcam tile may pass in either "ok" (live preview confirmed) or "skipped"
// (no camera hardware detected, or candidate chose to skip).
const WEBCAM_PASS_STATES = new Set(["ok", "skipped"]);

/**
 * sessionStorage flag used by candidate.js to suppress the duplicate
 * "Allow camera & microphone" gate that historically appeared on the
 * interview screen even after the candidate had already approved access on
 * the Device Check page. We also stash which devices were approved/skipped
 * so the proctor UI can show the right banner without re-prompting.
 */
const DEVICE_TEST_STATE_KEY = "karnex_device_test_state";
const DEVICE_TEST_STATE_TTL_MS = 15 * 60 * 1000; // 15-minute safety window

/** Mic stream kept alive after a successful device check (interview reuses it). */
let _verifiedMicStream = null;

/** Return the device-check microphone stream (do not stop tracks until interview ends). */
export function getVerifiedMicStream() {
  if (_verifiedMicStream && _verifiedMicStream.active) {
    const tracks = _verifiedMicStream.getAudioTracks ? _verifiedMicStream.getAudioTracks() : [];
    if (tracks.length && tracks[0].readyState === "live") return _verifiedMicStream;
  }
  return null;
}

/** Stop and clear the handoff stream (end of interview / logout). */
export function releaseVerifiedMicStream() {
  _stopMediaTracks(_verifiedMicStream);
  _verifiedMicStream = null;
}

/** Adopt an already-permitted microphone stream (silent re-acquire after device check). */
export function adoptVerifiedMicStream(stream) {
  if (!stream) return;
  if (_verifiedMicStream && _verifiedMicStream !== stream) {
    _stopMediaTracks(_verifiedMicStream);
  }
  _verifiedMicStream = stream;
}

function _deviceDebug(event, payload = {}) {
  try {
    console.info(`[device-check] ${event}`, payload);
  } catch (_) {
    /* ignore */
  }
}

function _persistDeviceTestState(tileState) {
  try {
    const payload = {
      ts: Date.now(),
      mic: tileState.mic === "ok",
      speaker: tileState.speaker === "ok",
      // Webcam is OPTIONAL — treat "skipped" as "no camera available" rather
      // than "denied" so candidate.js can keep the interview running mic-only.
      camera: tileState.webcam === "ok",
      cameraSkipped: tileState.webcam === "skipped",
      network: tileState.network === "ok",
      microphone_verified: tileState.mic === "ok",
      speaker_verified: tileState.speaker === "ok",
      internet_verified: tileState.network === "ok",
      webcam_verified: tileState.webcam === "ok",
    };
    sessionStorage.setItem(DEVICE_TEST_STATE_KEY, JSON.stringify(payload));
  } catch (_) {
    /* sessionStorage may be unavailable (Safari private mode) — non-fatal. */
  }
}

/** Returns the persisted device-test state (or null) if still within TTL. */
export function readPersistedDeviceTestState() {
  try {
    const raw = sessionStorage.getItem(DEVICE_TEST_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const ts = Number(parsed.ts) || 0;
    if (!ts || Date.now() - ts > DEVICE_TEST_STATE_TTL_MS) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

/** Clears the persisted gate state (e.g. on submit / logout / next interview). */
export function clearPersistedDeviceTestState() {
  try { sessionStorage.removeItem(DEVICE_TEST_STATE_KEY); } catch (_) { /* ignore */ }
  releaseVerifiedMicStream();
}

let _gateRunning = false;

function _qs(sel, root) {
  return (root || document).querySelector(sel);
}

function _tile(name) {
  return _qs(`#screenDeviceTest .device-test-tile[data-test="${name}"]`);
}

function _setTileStatus(name, status) {
  const tile = _tile(name);
  if (!tile) return;
  tile.setAttribute("data-status", status);
  const badge = _qs(".device-test-tile-badge", tile);
  if (badge) badge.textContent = STATUS_BADGE_TEXT[status] || STATUS_BADGE_TEXT.pending;
}

function _setStatusMsg(text) {
  const el = _qs("#screenDeviceTest [data-status-msg]");
  if (el) el.textContent = String(text || "");
}

function _setMeter(name, pct) {
  const tile = _tile(name);
  if (!tile) return;
  const bar = _qs("[data-meter-bar]", tile);
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, Number(pct) || 0))}%`;
}

function _stopMediaTracks(stream) {
  if (!stream) return;
  try {
    stream.getTracks().forEach((t) => {
      try { t.stop(); } catch (_) { /* ignore */ }
    });
  } catch (_) { /* ignore */ }
}

function _allTilesPass(state) {
  // Webcam is OPTIONAL: candidates on camera-less systems must still be able
  // to continue. Accept either confirmed "ok" or auto/manual "skipped" for the
  // webcam tile; mic/speaker/network are mandatory.
  return (
    state.mic === "ok" &&
    state.speaker === "ok" &&
    state.network === "ok" &&
    WEBCAM_PASS_STATES.has(state.webcam)
  );
}

function _refreshContinueButton(state) {
  const btn = document.getElementById("deviceTestContinue");
  if (!btn) return;
  btn.disabled = !_allTilesPass(state);
}

/** Mic test: request stream, sample levels, mark ok when we cross threshold. */
async function _queryPermissionState(name) {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return "unknown";
    const result = await navigator.permissions.query({ name });
    return result && result.state ? String(result.state) : "unknown";
  } catch (_) {
    return "unknown";
  }
}

async function _listAudioInputs() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return (Array.isArray(devices) ? devices : []).filter((d) => d.kind === "audioinput");
  } catch (_) {
    return [];
  }
}

async function _openMicStream() {
  const attempts = [
    { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false },
    { audio: true, video: false },
  ];
  let lastErr = null;
  for (const constraints of attempts) {
    try {
      _deviceDebug("mic:getUserMedia:attempt", { constraints });
      // eslint-disable-next-line no-await-in-loop
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      lastErr = e;
      _deviceDebug("mic:getUserMedia:attempt_failed", { name: e && e.name ? e.name : "unknown" });
    }
  }
  throw lastErr || new Error("MIC_STREAM_OPEN_FAILED");
}

/** The guided mic script: what we ask for, how long we listen, and how we
 *  decide we heard it. Voice = sustained energy; clap = one sharp transient. */
const MIC_STEPS = [
  { key: "one", prompt: "Say “one”", ms: 2200, kind: "voice" },
  { key: "two", prompt: "Say “two”", ms: 2200, kind: "voice" },
  { key: "clap", prompt: "Clap your hands once", ms: 2400, kind: "clap" },
];
const VOICE_PEAK_PCT = 4;      // peak deviation (% of full scale) that counts as speech
const VOICE_RMS = 0.015;       // average RMS that counts as speech
const CLAP_PEAK_PCT = 22;      // a clap is a short, loud transient
const CLAP_RMS_MAX = 0.06;     // …that is NOT sustained (else it is just talking)

function _setMicStep(key, state) {
  const el = _qs(`#screenDeviceTest [data-mic-step="${key}"]`);
  if (!el) return;
  if (state) el.setAttribute("data-state", state);
  else el.removeAttribute("data-state");
}

function _resetMicSteps() {
  MIC_STEPS.forEach((st) => _setMicStep(st.key, ""));
}

/**
 * Listen for one scripted step and return what the analyser saw.
 * The meter animates the whole time so the candidate sees the mic reacting.
 */
function _listenForStep(analyser, data, ms) {
  return new Promise((resolve) => {
    const deadline = Date.now() + ms;
    let peakPct = 0;
    let rmsAccum = 0;
    let samples = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      let max = 0;
      for (let i = 0; i < data.length; i++) {
        const dev = Math.abs(data[i] - 128);
        if (dev > max) max = dev;
        const norm = dev / 128;
        sum += norm * norm;
      }
      const rms = Math.sqrt(sum / data.length);
      rmsAccum += rms;
      samples += 1;
      const pct = Math.min(100, (max / 64) * 100);
      if (pct > peakPct) peakPct = pct;
      _setMeter("mic", pct);
      if (Date.now() < deadline) requestAnimationFrame(tick);
      else resolve({ peakPct, avgRms: samples ? rmsAccum / samples : 0 });
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Guided microphone check (16 Sep 2026): "say one", "say two", "clap once".
 * Each prompt is shown as a chip and marked heard/missed. The test passes when
 * the voice was heard on at least one prompt OR the clap registered — the
 * point is to prove the mic is live, not to grade the candidate.
 */
async function _sampleMicActivity(stream) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error("AudioContext unsupported");
  const ctx = new AC();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.2;
  src.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);

  const results = {};
  _resetMicSteps();
  try {
    for (const step of MIC_STEPS) {
      _setMicStep(step.key, "active");
      _setStatusMsg(`${step.prompt}…`);
      const seen = await _listenForStep(analyser, data, step.ms);
      const heard = step.kind === "clap"
        ? seen.peakPct >= CLAP_PEAK_PCT || (seen.peakPct >= VOICE_PEAK_PCT && seen.avgRms < CLAP_RMS_MAX && seen.peakPct >= 12)
        : seen.peakPct >= VOICE_PEAK_PCT || seen.avgRms >= VOICE_RMS;
      results[step.key] = { ...seen, heard };
      _setMicStep(step.key, heard ? "heard" : "missed");
    }
  } finally {
    _setMeter("mic", 0);
    try { if (ctx && ctx.close) await ctx.close(); } catch (_) { /* ignore */ }
  }

  const voiceHeard = !!(results.one?.heard || results.two?.heard);
  const clapHeard = !!results.clap?.heard;
  const peakNorm = Math.max(...Object.values(results).map((r) => r.peakPct));
  const avgRms = Object.values(results).reduce((n, r) => n + r.avgRms, 0) / MIC_STEPS.length;
  return { peakNorm, avgRms, voiceHeard, clapHeard, active: voiceHeard || clapHeard, steps: results };
}

async function _runMicTest(tileState) {
  if (tileState.mic === "ok") return;
  const tile = _tile("mic");
  if (!tile) return;
  _setStatusMsg("");
  _setTileStatus("mic", "testing");
  _setMeter("mic", 0);
  _setStatusMsg("Requesting microphone permission...");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    _setTileStatus("mic", "error");
    _setStatusMsg("Microphone access is required to participate in this interview.");
    return;
  }
  let stream = null;
  try {
    const permissionState = await _queryPermissionState("microphone");
    const beforeDevices = await _listAudioInputs();
    _deviceDebug("mic:preflight", {
      permissionState,
      secureContext: !!window.isSecureContext,
      detectedInputs: beforeDevices.length,
      labelsVisible: beforeDevices.some((d) => String(d.label || "").trim().length > 0),
    });

    _setStatusMsg("Checking microphone device...");
    stream = await _openMicStream();
    const tracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
    if (!tracks.length) {
      throw Object.assign(new Error("NO_AUDIO_TRACK"), { name: "NoAudioTrackError" });
    }
    const track = tracks[0];
    const settings = track.getSettings ? track.getSettings() : {};
    _deviceDebug("mic:stream_opened", {
      trackReadyState: track.readyState,
      muted: !!track.muted,
      enabled: !!track.enabled,
      deviceId: settings && settings.deviceId ? settings.deviceId : "",
      sampleRate: settings && settings.sampleRate ? settings.sampleRate : "",
    });
    if (track.readyState !== "live") {
      throw Object.assign(new Error("AUDIO_TRACK_NOT_LIVE"), { name: "TrackStartError" });
    }

    const sampled = await _sampleMicActivity(stream);
    _deviceDebug("mic:activity_sample", sampled);
    _setStatusMsg("Verifying audio input...");

    if (!sampled.active) {
      _setTileStatus("mic", "error");
      _setStatusMsg("We could not hear you. Move closer to the microphone, speak clearly, and try again.");
    } else {
      tileState.mic = "ok";
      _setTileStatus("mic", "ok");
      const heard = [sampled.voiceHeard ? "your voice" : null, sampled.clapHeard ? "the clap" : null].filter(Boolean).join(" and ");
      _setStatusMsg(`Microphone working — we heard ${heard}.`);
      if (stream) {
        _verifiedMicStream = stream;
        stream = null;
        _deviceDebug("mic:handoff_stream_kept", { trackCount: _verifiedMicStream.getAudioTracks().length });
      }
    }
  } catch (err) {
    const name = (err && err.name) || "";
    _deviceDebug("mic:failure", {
      name,
      message: err && err.message ? String(err.message) : "",
      secureContext: !!window.isSecureContext,
    });
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      _setTileStatus("mic", "error");
      _setStatusMsg("Please allow microphone access and retry.");
    } else if (name === "NotReadableError" || name === "TrackStartError") {
      _setTileStatus("mic", "error");
      _setStatusMsg("Device busy in another application. Close other apps using microphone and retry.");
    } else if (name === "SecurityError" || name === "NotSupportedError") {
      _setTileStatus("mic", "error");
      _setStatusMsg("Browser blocked microphone access. Use HTTPS or localhost and retry.");
    } else if (
      name === "NotFoundError" ||
      name === "DevicesNotFoundError" ||
      name === "OverconstrainedError"
    ) {
      _setTileStatus("mic", "error");
      _setStatusMsg("No microphone detected. Microphone access is required to participate in this interview.");
    } else {
      _setTileStatus("mic", "error");
      _setStatusMsg(
        `Microphone test failed: ${name || "unknown error"}. ` +
          "Microphone access is required to participate in this interview."
      );
    }
  } finally {
    _setMeter("mic", 0);
    _stopMediaTracks(stream);
    _refreshContinueButton(tileState);
  }
}

let _speakerCtx = null;
/** Length of the speaker test sound, in seconds. */
const SPEAKER_TONE_SECONDS = 5;
/** A rising four-note chime (C5 E5 G5 C6), played twice, then a held resolve. */
const CHIME_NOTES = [523.25, 659.25, 783.99, 1046.5, 523.25, 659.25, 783.99, 1046.5];

/**
 * Play a pleasant 5-second chime instead of a bare beep (16 Sep 2026): a
 * soft triangle-wave arpeggio with a little echo. Resolves when it ends so the
 * "Yes, I hear it" button appears at the right moment.
 */
async function _playSpeakerTone() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error("AudioContext unsupported");
    if (!_speakerCtx || _speakerCtx.state === "closed") _speakerCtx = new AC();
    if (_speakerCtx.state === "suspended") await _speakerCtx.resume();
    const ctx = _speakerCtx;
    const t0 = ctx.currentTime + 0.05;

    const master = ctx.createGain();
    master.gain.value = 0.22;
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.18;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.28;
    delay.connect(feedback).connect(delay);
    master.connect(ctx.destination);
    master.connect(delay).connect(ctx.destination);

    const noteLen = (SPEAKER_TONE_SECONDS - 1.2) / CHIME_NOTES.length;
    CHIME_NOTES.forEach((freq, i) => {
      const start = t0 + i * noteLen;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(1, start + 0.03);
      env.gain.exponentialRampToValueAtTime(0.001, start + noteLen * 1.6);
      osc.connect(env).connect(master);
      osc.start(start);
      osc.stop(start + noteLen * 1.7);
    });
    // Held final chord so the sound lands on something, not a cut-off.
    const tail = t0 + CHIME_NOTES.length * noteLen;
    [523.25, 783.99, 1046.5].forEach((freq) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0, tail);
      env.gain.linearRampToValueAtTime(0.7, tail + 0.05);
      env.gain.exponentialRampToValueAtTime(0.001, tail + 1.15);
      osc.connect(env).connect(master);
      osc.start(tail);
      osc.stop(tail + 1.2);
    });

    // Animate the tile meter for the duration so "is it playing?" is visible.
    await new Promise((resolve) => {
      const end = Date.now() + SPEAKER_TONE_SECONDS * 1000;
      const tick = () => {
        const left = end - Date.now();
        if (left <= 0) { _setMeter("speaker", 0); resolve(); return; }
        const phase = (Date.now() / 260) % 1;
        _setMeter("speaker", 35 + Math.abs(Math.sin(phase * Math.PI)) * 55);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  } catch (err) {
    _setMeter("speaker", 0);
    _setStatusMsg("Speaker test failed to play the sound. Please check the audio output device.");
    throw err;
  }
}

async function _runSpeakerPlay(tileState) {
  const confirm = _qs('[data-action="speaker-confirm"]', _tile("speaker"));
  _setTileStatus("speaker", "testing");
  _setStatusMsg(`Playing the test sound (${SPEAKER_TONE_SECONDS} seconds)…`);
  try {
    await _playSpeakerTone();
    _setStatusMsg("Did you hear the chime? Confirm below.");
    if (confirm) confirm.disabled = false;
  } catch (_) {
    _setTileStatus("speaker", "error");
  }
  _refreshContinueButton(tileState);
}

function _confirmSpeaker(tileState) {
  tileState.speaker = "ok";
  _setTileStatus("speaker", "ok");
  _setStatusMsg("Speaker confirmed.");
  _refreshContinueButton(tileState);
}

let _webcamStream = null;

/** True if `navigator.mediaDevices.enumerateDevices()` reports zero video inputs. */
async function _hasNoCameraDevice() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return false;
    const devices = await navigator.mediaDevices.enumerateDevices();
    return Array.isArray(devices) && devices.every((d) => d.kind !== "videoinput");
  } catch (_) {
    return false; // Be conservative: if we cannot enumerate, fall through to getUserMedia.
  }
}

/** Mark the webcam tile as optional/skipped and unblock Continue. */
function _markWebcamSkipped(tileState, reason) {
  tileState.webcam = "skipped";
  _setTileStatus("webcam", "skipped");
  const hint = _qs(".device-test-tile-hint", _tile("webcam"));
  if (hint) {
    hint.textContent = reason ||
      "No camera detected on this device. The interview will continue without video.";
  }
  const confirm = _qs('[data-action="webcam-confirm"]', _tile("webcam"));
  if (confirm) confirm.disabled = true;
  const skipBtn = _qs('[data-action="webcam-skip"]', _tile("webcam"));
  if (skipBtn) skipBtn.disabled = true;
  _setStatusMsg("");
  _refreshContinueButton(tileState);
}

async function _runWebcamTest(tileState) {
  _setTileStatus("webcam", "testing");
  _setStatusMsg("");

  // Pre-flight: if the browser exposes no video input devices at all, skip
  // the webcam check immediately — the candidate's machine literally has no
  // camera and we must not block them.
  if (await _hasNoCameraDevice()) {
    _markWebcamSkipped(tileState);
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    // No MediaDevices API → treat as optional rather than fatal.
    _markWebcamSkipped(tileState, "Camera API not available in this browser. Continuing without video.");
    return;
  }

  try {
    _webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "user" }, width: { ideal: 640 }, height: { ideal: 360 } },
      audio: false,
    });
    const preview = _qs("[data-webcam-preview]", _tile("webcam"));
    if (preview) {
      preview.srcObject = _webcamStream;
      try { await preview.play(); } catch (_) { /* autoplay can fail silently */ }
    }
    const confirm = _qs('[data-action="webcam-confirm"]', _tile("webcam"));
    if (confirm) confirm.disabled = false;
    _setStatusMsg("Camera preview running. Confirm if you can see yourself.");
  } catch (err) {
    const name = (err && err.name) || "";
    // "No camera" errors → optional skip, not failure. Permission errors stay
    // blocking so a candidate cannot accidentally proceed with a camera they
    // forgot to allow.
    if (
      name === "NotFoundError" ||
      name === "DevicesNotFoundError" ||
      name === "OverconstrainedError"
    ) {
      _markWebcamSkipped(tileState);
      return;
    }
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      _setTileStatus("webcam", "error");
      _setStatusMsg(
        "Camera permission was blocked. If your system has a camera, allow it in " +
          "the browser's address bar and try again — or click \"Skip — no camera\" " +
          "if you do not have one."
      );
    } else {
      _setTileStatus("webcam", "error");
      _setStatusMsg(
        `Camera test failed: ${name || "unknown error"}. ` +
          "Click \"Skip — no camera\" if you do not have a webcam."
      );
    }
  } finally {
    _refreshContinueButton(tileState);
  }
}

function _confirmWebcam(tileState) {
  tileState.webcam = "ok";
  _setTileStatus("webcam", "ok");
  _setStatusMsg("Webcam confirmed.");
  _refreshContinueButton(tileState);
}

/** Explicit "Skip — no camera" path so a candidate can bypass even when their
 *  OS reports a (broken / virtual) camera that getUserMedia cannot use. */
function _skipWebcam(tileState) {
  _stopMediaTracks(_webcamStream);
  _webcamStream = null;
  const preview = _qs("[data-webcam-preview]", _tile("webcam"));
  if (preview) {
    try { preview.srcObject = null; } catch (_) { /* ignore */ }
  }
  _markWebcamSkipped(tileState, "Skipped by candidate. The interview will continue without video.");
}

async function _runNetworkTest(tileState) {
  _setTileStatus("network", "testing");
  _setStatusMsg("");
  const tile = _tile("network");
  const info = _qs("[data-net-info]", tile);
  if (info) info.textContent = "";
  if (navigator.onLine === false) {
    _setTileStatus("network", "error");
    _setStatusMsg("Your browser reports no internet connection.");
    _refreshContinueButton(tileState);
    return;
  }
  const urls = ["/healthz", "/version"];
  for (const u of urls) {
    const started = performance.now();
    try {
      const res = await fetch(u, { method: "GET", cache: "no-store" });
      if (!res.ok) continue;
      const ms = Math.max(0, Math.round(performance.now() - started));
      if (info) info.textContent = `Latency to server: ~${ms} ms`;
      tileState.network = "ok";
      _setTileStatus("network", "ok");
      _setStatusMsg("Network connection healthy.");
      _refreshContinueButton(tileState);
      return;
    } catch (_) {
      /* try next */
    }
  }
  _setTileStatus("network", "error");
  _setStatusMsg("Could not reach the interview server. Please check your internet connection.");
  _refreshContinueButton(tileState);
}

/** Reset all tiles + state. Called when the gate is shown. */
function _resetGate(tileState) {
  tileState.mic = "required";
  _setTileStatus("mic", "required");
  ["speaker", "webcam", "network"].forEach((k) => {
    tileState[k] = "pending";
    _setTileStatus(k, "pending");
  });
  _setMeter("mic", 0);
  _setMeter("speaker", 0);
  _resetMicSteps();
  const speakerConfirm = _qs('[data-action="speaker-confirm"]', _tile("speaker"));
  if (speakerConfirm) speakerConfirm.disabled = true;
  const webcamConfirm = _qs('[data-action="webcam-confirm"]', _tile("webcam"));
  if (webcamConfirm) webcamConfirm.disabled = true;
  const webcamSkip = _qs('[data-action="webcam-skip"]', _tile("webcam"));
  if (webcamSkip) webcamSkip.disabled = false;
  const micHint = _qs(".device-test-tile-hint", _tile("mic"));
  if (micHint) {
    micHint.textContent = "Click Test mic and speak for 3 seconds. We need to detect your voice.";
  }
  // Restore the default webcam hint (it may have been overwritten by a prior
  // "skipped" run within the same browser session).
  const hint = _qs(".device-test-tile-hint", _tile("webcam"));
  if (hint) {
    hint.textContent = "Click Test camera and confirm you can see your live preview.";
  }
  const preview = _qs("[data-webcam-preview]", _tile("webcam"));
  if (preview) {
    try { preview.srcObject = null; } catch (_) { /* ignore */ }
  }
  _stopMediaTracks(_webcamStream);
  _webcamStream = null;
  _setStatusMsg("");
  _refreshContinueButton(tileState);
}

/**
 * Show the gate and resolve(true) only after the candidate clicks Continue with
 * all four checks passing. Resolves(false) if they click Back.
 */
export function runDeviceTestGate() {
  return new Promise((resolve) => {
    if (_gateRunning) {
      resolve(false);
      return;
    }
    _gateRunning = true;
    const screen = document.getElementById("screenDeviceTest");
    if (!screen) {
      _gateRunning = false;
      resolve(true); // Fail-safe: if markup missing, do not block the interview.
      return;
    }
    const tileState = { mic: "pending", speaker: "pending", webcam: "pending", network: "pending" };
    _resetGate(tileState);

    document.querySelectorAll(".startup-screen.active, .auth-screen.active")
      .forEach((s) => s.classList.remove("active"));
    screen.classList.add("active");

    // Auto-run the cheap network probe — does not require permissions.
    void _runNetworkTest(tileState);

    // Pre-flight: if the candidate's system has no camera hardware, mark the
    // webcam tile as "Optional / Skipped" up front so they are not confused by
    // a Failed badge on a device they don't even own. We still expose the
    // "Test camera" button in case enumerateDevices was restricted and a
    // camera turns up later.
    void _hasNoCameraDevice().then((noCam) => {
      if (noCam && tileState.webcam === "pending") _markWebcamSkipped(tileState);
    });

    const handlers = [
      ["[data-action=\"mic-test\"]", () => _runMicTest(tileState)],
      ["[data-action=\"speaker-play\"]", () => _runSpeakerPlay(tileState)],
      ["[data-action=\"speaker-confirm\"]", () => _confirmSpeaker(tileState)],
      ["[data-action=\"webcam-test\"]", () => _runWebcamTest(tileState)],
      ["[data-action=\"webcam-confirm\"]", () => _confirmWebcam(tileState)],
      ["[data-action=\"webcam-skip\"]", () => _skipWebcam(tileState)],
      ["[data-action=\"network-test\"]", () => _runNetworkTest(tileState)],
    ];
    const bound = [];
    handlers.forEach(([sel, fn]) => {
      const el = screen.querySelector(sel);
      if (!el) return;
      const wrapped = (ev) => { ev.preventDefault(); void fn(); };
      el.addEventListener("click", wrapped);
      bound.push([el, wrapped]);
    });

    const cleanup = () => {
      bound.forEach(([el, fn]) => el.removeEventListener("click", fn));
      _stopMediaTracks(_webcamStream);
      _webcamStream = null;
      try {
        if (_speakerCtx && _speakerCtx.state !== "closed") _speakerCtx.close();
      } catch (_) { /* ignore */ }
      _speakerCtx = null;
      _gateRunning = false;
    };

    const continueBtn = document.getElementById("deviceTestContinue");
    const backBtn = document.getElementById("deviceTestBack");
    const onContinue = (ev) => {
      ev.preventDefault();
      if (!_allTilesPass(tileState)) return;
      // Persist the approved set so candidate.js can skip its duplicate
      // "Allow camera & microphone" gate (Issue 1, May 2026 fix).
      _persistDeviceTestState(tileState);
      cleanup();
      screen.classList.remove("active");
      resolve(true);
    };
    const onBack = (ev) => {
      ev.preventDefault();
      // Candidate hit Back — invalidate any prior approval so the next pass
      // re-validates instead of silently inheriting stale state.
      clearPersistedDeviceTestState();
      cleanup();
      screen.classList.remove("active");
      resolve(false);
    };
    if (continueBtn) continueBtn.addEventListener("click", onContinue, { once: true });
    if (backBtn) backBtn.addEventListener("click", onBack, { once: true });
  });
}

/** Hide gate immediately (cleanup helper used by app.js on emergency errors). */
export function hideDeviceTestGate() {
  const screen = document.getElementById("screenDeviceTest");
  if (screen) screen.classList.remove("active");
  _stopMediaTracks(_webcamStream);
  _webcamStream = null;
  _gateRunning = false;
}
