/**
 * Enterprise smart auto-advance — OpenAI Whisper + GPT completion (Jul 2026).
 * Timers are safety fallbacks only; GPT drives answer completion after silence.
 */

import { state } from "./state.js";
import { apiFetch } from "./core.js";
import {
  enqueueWhisperSegment,
  flushWhisperSegments,
  getWhisperSegmentTranscript,
  resetWhisperSegments,
  whisperTranscriptionInFlight,
} from "./interview_whisper_segments.js";
import {
  getSileroSpeechProbability,
  isSileroSpeechActive,
  sileroProbabilityAcceptable,
  sileroVadAvailable,
  startSileroVad,
  stopSileroVad,
} from "./vad_silero.js";

const VOICE_COMMAND_PATTERNS = [
  /\bnext question\b/i,
  /\bskip\b/i,
  /\bi am done\b/i,
  /\bi'm done\b/i,
  /\bthat'?s all\b/i,
  /\bmove on\b/i,
  /\bfinished\b/i,
  /\bthat is my answer\b/i,
];

const SPEECH_BAND_LOW_HZ = 300;
const SPEECH_BAND_HIGH_HZ = 3400;
const CALIBRATION_MS = 1000;
const SPEECH_END_HANGOVER_MS = 280;
const DEBUG_LOG_THROTTLE_MS = 500;
const COMPLETION_DEBOUNCE_MS = 400;

const FILLER_RE = /\b(um+|uh+|er+|ah+|like|you know|let me think|actually|hold on|one moment|give me a (second|moment))\b/i;
const EXPLICIT_DONE_RE = /\b(that'?s all|i'?m done|i am done|that is my answer|finished|move on|next question)\b/i;

export const AUTO_ADVANCE_PHASE = {
  IDLE: "idle",
  WAITING_FOR_RESPONSE: "waiting_for_response",
  LISTENING: "listening",
  SUBMITTING: "moving_next",
  SKIPPED: "question_skipped",
};

let _listenOnly = false;
let _turnSeq = 0;
let _audioCtx = null;
let _analyser = null;
let _freqBuf = null;
let _timeBuf = null;
let _vadHandle = null;
let _speechRecognition = null;
let _callbacks = null;
let _turnMeta = null;
let _phase = AUTO_ADVANCE_PHASE.IDLE;

let _speechConfirmed = false;
let _speechCandidateSince = 0;
let _speechStartTs = 0;
let _lastSpeechTs = 0;
let _silenceSinceTs = 0;
let _belowHangoverSince = 0;
let _turnStartTs = 0;
let _confirmedSpeechMs = 0;
let _lastConfirmedSpeechFrameTs = 0;
let _interimTranscript = "";
let _completionCheckInFlight = false;
let _lastCompletionCheckTs = 0;

let _calibrated = false;
let _calibrationUntil = 0;
let _calibrationSamples = [];
let _noiseFloor = 0.01;
let _lastDebugLevelTs = 0;
let _debugPanelEl = null;
let _sileroActive = false;
let _active = false;
let _initialWaitHandle = null;

function _cfg() {
  return state.autoAdvance || {};
}

function _enabled() {
  return !!_cfg().enabled;
}

function _initialWaitMs() {
  return (Number(_cfg().initial_response_wait_sec) || 5) * 1000;
}

function _extraSkipMs() {
  return (Number(_cfg().no_response_extra_wait_sec) || 2.5) * 1000;
}

function _silenceMs() {
  const sec = Number(_cfg().silence_detection_sec) || 2.5;
  return Math.max(2500, Math.min(5000, sec * 1000));
}

function _vadDebugEnabled() {
  try {
    if (new URLSearchParams(window.location.search).get("vad_debug") === "1") return true;
    return localStorage.getItem("vad_debug") === "1";
  } catch (_) {
    return false;
  }
}

function _vadLog(event, detail = {}) {
  if (!_vadDebugEnabled()) return;
  console.info(`[VAD] ${event}`, detail);
  _appendDebugPanel(event, detail);
}

function _vadEventLog(event, detail = {}) {
  console.info(`[VAD] ${event}`, Object.keys(detail).length ? detail : "");
  if (_vadDebugEnabled()) _appendDebugPanel(event, detail);
}

function _logInterview(event, detail = {}) {
  const qIdx = _turnMeta?.questionIndex;
  const payload = qIdx != null ? { question_index: qIdx, ...detail } : detail;
  console.info(`[INTERVIEW] ${event}`, Object.keys(payload).length ? payload : "");
}

function _appendDebugPanel(event, detail) {
  if (!_debugPanelEl) _debugPanelEl = document.getElementById("vadDebugPanel");
  if (!_debugPanelEl) return;
  const line = document.createElement("div");
  line.className = "vad-debug-line";
  const extra = Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : "";
  line.textContent = `${new Date().toLocaleTimeString()} — ${event}${extra}`;
  _debugPanelEl.appendChild(line);
  while (_debugPanelEl.childNodes.length > 40) {
    _debugPanelEl.removeChild(_debugPanelEl.firstChild);
  }
  _debugPanelEl.scrollTop = _debugPanelEl.scrollHeight;
}

function _ensureDebugPanel() {
  if (!_vadDebugEnabled()) return;
  let panel = document.getElementById("vadDebugPanel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "vadDebugPanel";
    panel.className = "vad-debug-panel";
    panel.setAttribute("aria-live", "polite");
    const title = document.createElement("div");
    title.className = "vad-debug-title";
    title.textContent = "VAD Debug";
    panel.appendChild(title);
    document.body.appendChild(panel);
  }
  panel.hidden = false;
  _debugPanelEl = panel;
}

function _hideDebugPanel() {
  const panel = document.getElementById("vadDebugPanel");
  if (panel) panel.hidden = true;
}

function _wordCount(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function _speechThreshold() {
  const base = Number(_cfg().speech_energy_threshold) || 0.038;
  return Math.max(base, _noiseFloor * 4.0);
}

function _hangoverThreshold() {
  return _speechThreshold() * 0.65;
}

function _speechConfirmMs() {
  return Math.max(300, Math.min(500, Number(_cfg().speech_confirm_ms) || 400));
}

function _clearTimer(handleName) {
  if (handleName === "_initialWaitHandle" && _initialWaitHandle) {
    clearTimeout(_initialWaitHandle);
    _initialWaitHandle = null;
  }
}

function _clearAllTimers() {
  if (_initialWaitHandle) clearTimeout(_initialWaitHandle);
  _initialWaitHandle = null;
}

function _getExternalCaptureText() {
  try {
    return String(_callbacks?.getCaptureText?.() || "").trim();
  } catch (_) {
    return "";
  }
}

function _useVadWhisperPipeline() {
  return state.vadWhisperPipeline !== false && !!_cfg().enabled;
}

function _getCombinedCaptureText() {
  const external = _getExternalCaptureText();
  if (external) return external;
  const whisper = getWhisperSegmentTranscript();
  if (whisper) return whisper;
  return String(_interimTranscript || "").trim();
}

function _hasCapturableAnswer() {
  if (_wordCount(_getCombinedCaptureText()) > 0) return true;
  if (_confirmedSpeechMs >= 1000) return true;
  return false;
}

function _sileroHumanSpeech() {
  return _sileroActive || isSileroSpeechActive();
}

function _heuristicCompletion(transcript, { silenceDurationSec, isStillSpeaking, silenceThresholdSec }) {
  const text = String(transcript || "").trim();
  if (isStillSpeaking) return { status: "ANSWER_IN_PROGRESS", confidence: 0.85, source: "heuristic" };
  if (!text) return { status: "ANSWER_IN_PROGRESS", confidence: 0.6, source: "heuristic" };
  if (EXPLICIT_DONE_RE.test(text)) return { status: "ANSWER_COMPLETE", confidence: 0.9, source: "heuristic" };
  if (FILLER_RE.test(text)) {
    const trailing = text.slice(-80);
    if (FILLER_RE.test(trailing)) return { status: "ANSWER_IN_PROGRESS", confidence: 0.8, source: "heuristic" };
  }
  if (/[,:…\-]$|\.\.\.$/.test(text.replace(/\s+$/, ""))) {
    return { status: "ANSWER_IN_PROGRESS", confidence: 0.75, source: "heuristic" };
  }
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 3) return { status: "ANSWER_IN_PROGRESS", confidence: 0.7, source: "heuristic" };
  if (silenceDurationSec >= silenceThresholdSec) {
    return { status: "ANSWER_COMPLETE", confidence: 0.82, source: "heuristic" };
  }
  return { status: "ANSWER_IN_PROGRESS", confidence: 0.7, source: "heuristic" };
}

function _isCandidateSpeaking(features) {
  if (_sileroHumanSpeech()) return true;
  if (features && _isStillSpeaking(features)) return true;
  if (_speechConfirmed && _lastSpeechTs && Date.now() - _lastSpeechTs < 400) return true;
  return false;
}

function _shouldBlockInitialSkip() {
  if (_speechConfirmed) return true;
  if (_speechCandidateSince) return true;
  if (_sileroHumanSpeech()) return true;
  if (whisperTranscriptionInFlight()) return true;
  if (_wordCount(_getCombinedCaptureText()) > 0) return true;
  return false;
}

/** Stop timers/VAD without discarding whisper transcript or capture callbacks. */
function _freezeAutoAdvanceTurn() {
  _active = false;
  _clearAllTimers();
  _stopVad();
  void stopSileroVad();
  _sileroActive = false;
  _stopSpeechRecognition();
}

export function freezeAutoAdvanceTurn() {
  _freezeAutoAdvanceTurn();
}

async function _awaitWhisperCaptureIdle(maxMs = 4000, { onlyIfSpeechActivity = false } = {}) {
  const hasActivity =
    _speechConfirmed || _speechCandidateSince || _sileroHumanSpeech() || whisperTranscriptionInFlight();
  if (onlyIfSpeechActivity && !hasActivity) {
    try {
      await flushWhisperSegments();
    } catch (_) {
      /* ignore */
    }
    return _getCombinedCaptureText();
  }
  const deadline = Date.now() + Math.max(500, Number(maxMs) || 4000);
  try {
    await flushWhisperSegments();
  } catch (_) {
    /* ignore */
  }
  while (whisperTranscriptionInFlight() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 80));
    try {
      await flushWhisperSegments();
    } catch (_) {
      /* ignore */
    }
  }
  const text = _getCombinedCaptureText();
  if (text && _callbacks?.onInterimTranscript) {
    try {
      _callbacks.onInterimTranscript(text);
    } catch (_) {
      /* ignore */
    }
  }
  return text;
}

function _startInitialWaitTimers() {
  _clearAllTimers();
  _turnStartTs = Date.now();
  const waitMs = _initialWaitMs();
  _logInterview("Listening started", { initialWaitSec: waitMs / 1000 });
  _initialWaitHandle = setTimeout(() => {
    _initialWaitHandle = null;
    if (!_active || _listenOnly) return;
    if (_shouldBlockInitialSkip()) return;
    if (!_cfg().auto_skip_enabled) {
      _logInterview("Auto-skip disabled — staying on question");
      return;
    }
    _logInterview("No speech within initial wait — auto skip", { waitSec: waitMs / 1000 });
    void _triggerAutoSkip("silent_no_response");
  }, waitMs);
}

function _onSpeechDetectedDuringWait(now) {
  _clearTimer("_initialWaitHandle");
  if (!_speechConfirmed) _confirmSpeech(now);
}

function _stopVad() {
  if (_vadHandle) {
    cancelAnimationFrame(_vadHandle);
    _vadHandle = null;
  }
  if (_analyser) {
    try {
      _analyser.disconnect();
    } catch (_) {
      /* ignore */
    }
    _analyser = null;
  }
  if (_audioCtx) {
    try {
      _audioCtx.close();
    } catch (_) {
      /* ignore */
    }
    _audioCtx = null;
  }
  _freqBuf = null;
  _timeBuf = null;
}

function _stopSpeechRecognition() {
  if (!_speechRecognition) return;
  try {
    _speechRecognition.onresult = null;
    _speechRecognition.onerror = null;
    _speechRecognition.onend = null;
    _speechRecognition.stop();
  } catch (_) {
    /* ignore */
  }
  _speechRecognition = null;
}

function _setPhase(phase, message) {
  _phase = phase;
  if (_callbacks?.onPhase) _callbacks.onPhase(phase, message);
}

function _rmsFromTimeDomain(timeBuf) {
  let sum = 0;
  for (let i = 0; i < timeBuf.length; i++) {
    const v = (timeBuf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / timeBuf.length);
}

function _zeroCrossingRate(timeBuf) {
  let crossings = 0;
  for (let i = 1; i < timeBuf.length; i++) {
    const a = timeBuf[i] - 128;
    const b = timeBuf[i - 1] - 128;
    if ((a >= 0 && b < 0) || (a < 0 && b >= 0)) crossings++;
  }
  return crossings / timeBuf.length;
}

function _speechBandRatio(analyser, freqBuf, sampleRate) {
  analyser.getByteFrequencyData(freqBuf);
  const binCount = freqBuf.length;
  const nyquist = sampleRate / 2;
  const binHz = nyquist / binCount;
  const lowBin = Math.floor(SPEECH_BAND_LOW_HZ / binHz);
  const highBin = Math.min(binCount - 1, Math.ceil(SPEECH_BAND_HIGH_HZ / binHz));
  let total = 0;
  let speechBand = 0;
  for (let i = 0; i < binCount; i++) {
    const e = freqBuf[i] / 255;
    total += e;
    if (i >= lowBin && i <= highBin) speechBand += e;
  }
  return total > 0.001 ? speechBand / total : 0;
}

function _analyzeFrame() {
  _analyser.getByteTimeDomainData(_timeBuf);
  const rms = _rmsFromTimeDomain(_timeBuf);
  const zcr = _zeroCrossingRate(_timeBuf);
  const bandRatio = _speechBandRatio(_analyser, _freqBuf, _audioCtx.sampleRate);
  return { rms, zcr, bandRatio };
}

function _isSpeechCandidate(features) {
  if (_speechConfirmed && _sileroHumanSpeech()) return true;
  const sileroOk = sileroVadAvailable() ? sileroProbabilityAcceptable() : true;
  if (!sileroOk) return false;
  const threshold = _speechThreshold();
  const energyOk = features.rms >= threshold;
  const bandOk = features.bandRatio >= 0.22 && features.bandRatio <= 0.9;
  const notTransient = features.zcr <= 0.38;
  return energyOk && bandOk && notTransient;
}

function _isStillSpeaking(features) {
  return features.rms >= _hangoverThreshold() && features.bandRatio >= 0.18;
}

function _finishCalibration() {
  if (_calibrationSamples.length === 0) {
    _noiseFloor = (Number(_cfg().speech_energy_threshold) || 0.038) * 0.35;
  } else {
    const sorted = [..._calibrationSamples].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * 0.75);
    _noiseFloor = sorted[Math.min(idx, sorted.length - 1)];
  }
  _calibrated = true;
  _vadLog("Calibration complete", {
    noiseFloor: Number(_noiseFloor.toFixed(4)),
    threshold: Number(_speechThreshold().toFixed(4)),
  });
  if (_active && !_listenOnly && !_speechConfirmed && _phase === AUTO_ADVANCE_PHASE.WAITING_FOR_RESPONSE) {
    _startInitialWaitTimers();
  }
}

function _resetSpeechTracking() {
  _speechConfirmed = false;
  _speechCandidateSince = 0;
  _speechStartTs = 0;
  _lastSpeechTs = 0;
  _silenceSinceTs = 0;
  _belowHangoverSince = 0;
  _confirmedSpeechMs = 0;
  _lastConfirmedSpeechFrameTs = 0;
  _completionCheckInFlight = false;
}

function _confirmSpeech(now) {
  if (_speechConfirmed) return;
  _speechConfirmed = true;
  _speechStartTs = now;
  _lastSpeechTs = now;
  _lastConfirmedSpeechFrameTs = now;
  _silenceSinceTs = 0;
  _belowHangoverSince = 0;
  _clearTimer("_initialWaitHandle");
  _logInterview("Speech started");
  _vadEventLog("Listening");
  _setPhase(AUTO_ADVANCE_PHASE.LISTENING, "Listening…");
  if (_callbacks?.onSpeechStart) _callbacks.onSpeechStart(now);
}

function _endSpeech(now) {
  if (!_speechConfirmed) return;
  const durationSec = Number(((now - _speechStartTs) / 1000).toFixed(1));
  _logInterview("Speech ended", { durationSec });
  _vadLog("Speech Ended", { durationSec });
  _lastSpeechTs = now;
  if (!_silenceSinceTs) _silenceSinceTs = now;
}

function _matchesVoiceCommand(text) {
  if (!_cfg().voice_commands_enabled) return false;
  const t = String(text || "").trim();
  if (!t) return false;
  return VOICE_COMMAND_PATTERNS.some((re) => re.test(t));
}

function _buildEventMeta(trigger, extra = {}) {
  const now = Date.now();
  const captureText = _getCombinedCaptureText();
  const base = {
    trigger,
    question_index: _turnMeta?.questionIndex,
    start_speaking_at: _speechStartTs ? new Date(_speechStartTs).toISOString() : null,
    end_speaking_at: new Date(now).toISOString(),
    silence_duration_ms: _silenceSinceTs ? Math.max(0, now - _silenceSinceTs) : null,
    speech_duration_ms: _confirmedSpeechMs || null,
    confirmed_speech_ms: _confirmedSpeechMs || null,
    word_count: _wordCount(captureText || _interimTranscript),
    speech_confirmed: _speechConfirmed,
    silero_speech_active: _sileroHumanSpeech(),
    vad_speech_detected: _speechConfirmed || _sileroHumanSpeech(),
    interim_transcript: captureText || _interimTranscript,
    capture_text: captureText,
    interim_transcript_len: (captureText || _interimTranscript).length,
    noise_floor: Number(_noiseFloor.toFixed(5)),
    speech_threshold: Number(_speechThreshold().toFixed(5)),
    ...extra,
  };
  if (base.auto_submitted === undefined) {
    base.auto_submitted = !["no_response", "manual_skip", "silent_no_response"].includes(trigger) || !!extra.partial_answer;
  }
  if (base.skipped === undefined) {
    base.skipped = ["no_response", "manual_skip", "silent_no_response"].includes(trigger);
  }
  return base;
}

async function _validateSkipWithServer(meta) {
  try {
    const res = await apiFetch("/candidate/validate-speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auto_advance_meta: meta, action: "skip" }),
    });
    if (!res.ok) return true;
    const data = await res.json();
    return data.allow_skip !== false;
  } catch (_) {
    return !_sileroHumanSpeech() && !_speechConfirmed && _wordCount(_getCombinedCaptureText()) === 0;
  }
}

async function _triggerAutoSubmit(trigger, extra = {}) {
  if (!_active || _listenOnly) return;
  const onAutoSubmit = _callbacks?.onAutoSubmit;
  if (!onAutoSubmit) return;
  _vadEventLog("Auto submit", { trigger });
  await _awaitWhisperCaptureIdle(5000);
  const meta = _buildEventMeta(trigger, { auto_submitted: true, skipped: false, ...extra });
  _logInterview("Auto submit payload", {
    trigger,
    transcript_len: String(meta.capture_text || meta.interim_transcript || "").length,
    transcript_preview: String(meta.capture_text || meta.interim_transcript || "").slice(0, 120),
  });
  _freezeAutoAdvanceTurn();
  onAutoSubmit(meta);
}

async function _triggerAutoSkip(reason) {
  if (!_active || _listenOnly) return;
  await _awaitWhisperCaptureIdle(5000, { onlyIfSpeechActivity: true });
  if (_hasCapturableAnswer()) {
    _logInterview("Skip blocked — transcript present after whisper flush", {
      transcript_len: _getCombinedCaptureText().length,
    });
    await _triggerAutoSubmit("save_before_skip", { partial_answer: true });
    return;
  }
  if (_sileroHumanSpeech() || _speechConfirmed || _speechCandidateSince || whisperTranscriptionInFlight()) {
    _logInterview("Skip blocked — speech activity or whisper in flight", {
      speech_confirmed: _speechConfirmed,
      whisper_in_flight: whisperTranscriptionInFlight(),
    });
    return;
  }
  const onAutoSkip = _callbacks?.onAutoSkip;
  if (!onAutoSkip) return;
  const meta = _buildEventMeta("silent_no_response", { skipped: true, auto_submitted: false });
  const allowed = await _validateSkipWithServer(meta);
  if (!allowed) {
    _logInterview("Skip blocked by server validate-speech");
    return;
  }
  _logInterview("Auto skip payload", {
    reason: reason || "silent_no_response",
    transcript_len: 0,
    speech_confirmed: _speechConfirmed,
  });
  _freezeAutoAdvanceTurn();
  onAutoSkip(reason || "Auto skip — no response", meta);
}

async function _checkAnswerCompletion(now) {
  if (_listenOnly || !_active || !_speechConfirmed || _completionCheckInFlight) return;
  if (_sileroHumanSpeech() || _speechCandidateSince || _isCandidateSpeaking(_analyser ? _analyzeFrame() : null)) return;
  if (now - _lastCompletionCheckTs < COMPLETION_DEBOUNCE_MS) return;

  const silenceDur = _silenceSinceTs ? now - _silenceSinceTs : 0;
  const silenceThresholdSec = _silenceMs() / 1000;
  if (silenceDur < _silenceMs()) return;

  _completionCheckInFlight = true;
  _lastCompletionCheckTs = now;

  try {
    await flushWhisperSegments();
  } catch (_) {
    /* ignore */
  }

  const transcript = _getCombinedCaptureText();
  if (!transcript && _confirmedSpeechMs < 800) {
    _completionCheckInFlight = false;
    return;
  }

  _logInterview("Transcript snapshot", {
    transcript_preview: transcript.slice(0, 120),
    transcript_len: transcript.length,
    silence_sec: Number((silenceDur / 1000).toFixed(2)),
  });

  let result = { status: "ANSWER_IN_PROGRESS", confidence: 0.5, source: "default" };
  try {
    const res = await apiFetch("/candidate/analyze-answer-completion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question_text: _turnMeta?.questionText || "",
        transcript,
        silence_duration_sec: silenceDur / 1000,
        is_still_speaking: false,
        silence_threshold_sec: silenceThresholdSec,
      }),
    });
    if (res.ok) {
      result = await res.json();
    } else {
      result = _heuristicCompletion(transcript, {
        silenceDurationSec: silenceDur / 1000,
        isStillSpeaking: false,
        silenceThresholdSec,
      });
      _logInterview("Completion API error — heuristic fallback", { httpStatus: res.status });
    }
  } catch (err) {
    result = _heuristicCompletion(transcript, {
      silenceDurationSec: silenceDur / 1000,
      isStillSpeaking: false,
      silenceThresholdSec,
    });
    _logInterview("Completion API failed — heuristic fallback", { err: String(err?.message || err) });
  } finally {
    _completionCheckInFlight = false;
  }

  if (!_active) return;

  _logInterview("GPT completion decision", {
    status: result.status,
    confidence: result.confidence,
    source: result.source || "api",
    transcript_len: transcript.length,
  });
  _vadEventLog("Answer completion", result);

  if (result.status === "ANSWER_COMPLETE") {
    const confirmMs = Math.max(0, Number(_cfg().confirmation_before_next_sec) || 0) * 1000;
    _logInterview("Answer complete — advancing", {
      trigger: "answer_complete",
      confidence: result.confidence,
      confirm_ms: confirmMs,
    });
    _setPhase(AUTO_ADVANCE_PHASE.SUBMITTING, confirmMs > 0 ? "Submitting…" : "Submitting…");
    if (confirmMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, confirmMs));
      if (!_active) return;
    }
    _logInterview("Auto submitted", { trigger: "answer_complete", confidence: result.confidence });
    void _triggerAutoSubmit("answer_complete", { completion_confidence: result.confidence });
    return;
  }

  _silenceSinceTs = now;
  _logInterview("Answer in progress — continuing to listen", { confidence: result.confidence });
}

function _onSilenceDetected(now) {
  if (!_active || !_speechConfirmed) return;
  void _checkAnswerCompletion(now);
}

function _processSpeechCandidate(features, isCandidate, now) {
  if (_isCandidateSpeaking(features)) {
    if (_silenceSinceTs) {
      _silenceSinceTs = 0;
      _setPhase(AUTO_ADVANCE_PHASE.LISTENING, "Listening…");
    }
  }

  if (!_speechConfirmed && (_phase === AUTO_ADVANCE_PHASE.WAITING_FOR_RESPONSE || _initialWaitHandle)) {
    if (isCandidate || _sileroHumanSpeech()) {
      if (!_speechCandidateSince) {
        _speechCandidateSince = now;
        _clearTimer("_initialWaitHandle");
        _logInterview("Speech candidate detected — initial wait cancelled");
      }
      if (now - _speechCandidateSince >= _speechConfirmMs()) {
        _onSpeechDetectedDuringWait(now);
      }
      return;
    }
    _speechCandidateSince = 0;
    return;
  }

  if (isCandidate) {
    if (!_speechCandidateSince) _speechCandidateSince = now;
    if (!_speechConfirmed && now - _speechCandidateSince >= _speechConfirmMs()) {
      _confirmSpeech(now);
    }
    if (_speechConfirmed) {
      _lastSpeechTs = now;
      _belowHangoverSince = 0;
      _silenceSinceTs = 0;
      if (_lastConfirmedSpeechFrameTs) {
        _confirmedSpeechMs += now - _lastConfirmedSpeechFrameTs;
      }
      _lastConfirmedSpeechFrameTs = now;
    }
    return;
  }

  _speechCandidateSince = 0;

  if (_speechConfirmed) {
    if (_isStillSpeaking(features)) {
      _belowHangoverSince = 0;
      _lastSpeechTs = now;
      _silenceSinceTs = 0;
      if (_lastConfirmedSpeechFrameTs) {
        _confirmedSpeechMs += now - _lastConfirmedSpeechFrameTs;
      }
      _lastConfirmedSpeechFrameTs = now;
      return;
    }

    if (!_belowHangoverSince) _belowHangoverSince = now;
    if (now - _belowHangoverSince >= SPEECH_END_HANGOVER_MS) {
      _endSpeech(now);
      _onSilenceDetected(now);
    }
  }
}

function _vadLoop() {
  if (!_active || !_analyser || !_timeBuf || !_freqBuf) return;
  const now = Date.now();
  const features = _analyzeFrame();

  if (now - _lastDebugLevelTs >= DEBUG_LOG_THROTTLE_MS) {
    _lastDebugLevelTs = now;
    _vadLog("Audio Level", {
      rms: Number(features.rms.toFixed(4)),
      band: Number(features.bandRatio.toFixed(3)),
      silero: _sileroHumanSpeech(),
      speechConfirmed: _speechConfirmed,
    });
  }

  if (!_calibrated) {
    _calibrationSamples.push(features.rms);
    if (now >= _calibrationUntil) _finishCalibration();
    if (_wordCount(_getCombinedCaptureText()) > 0 || _sileroHumanSpeech()) {
      _onSpeechDetectedDuringWait(now);
    }
    _vadHandle = requestAnimationFrame(_vadLoop);
    return;
  }

  _processSpeechCandidate(features, _isSpeechCandidate(features), now);

  if (
    _speechConfirmed &&
    _silenceSinceTs &&
    !_completionCheckInFlight &&
    !_speechCandidateSince &&
    !_isCandidateSpeaking(features)
  ) {
    const silenceDur = now - _silenceSinceTs;
    if (silenceDur >= _silenceMs()) {
      void _checkAnswerCompletion(now);
    }
  }

  if (_cfg().voice_commands_enabled && _interimTranscript && _matchesVoiceCommand(_interimTranscript)) {
    if (_speechConfirmed || _wordCount(_getCombinedCaptureText()) >= 2) {
      _setPhase(AUTO_ADVANCE_PHASE.SUBMITTING, "Submitting…");
      void _triggerAutoSubmit("voice_command");
      return;
    }
  }

  _vadHandle = requestAnimationFrame(_vadLoop);
}

function _startSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  try {
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (event) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }
      _interimTranscript = text.trim();
      if (_callbacks?.onInterimTranscript) _callbacks.onInterimTranscript(_interimTranscript);
      if (!_speechConfirmed && _wordCount(_interimTranscript) > 0) {
        _onSpeechDetectedDuringWait(Date.now());
      }
      if (_cfg().voice_commands_enabled && _matchesVoiceCommand(_interimTranscript)) {
        if (_speechConfirmed || _wordCount(_interimTranscript) >= 2) {
          _setPhase(AUTO_ADVANCE_PHASE.SUBMITTING, "Submitting…");
          void _triggerAutoSubmit("voice_command");
        }
      }
    };
    rec.onerror = () => {};
    rec.onend = () => {
      if (_active) {
        try {
          rec.start();
        } catch (_) {
          /* ignore */
        }
      }
    };
    rec.start();
    _speechRecognition = rec;
  } catch (_) {
    /* ignore */
  }
}

export function applyAutoAdvanceConfig(payload = {}) {
  const aa = payload.auto_advance || payload;
  state.autoAdvance = {
    enabled: !!(aa.enabled ?? payload.auto_advance_enabled),
    initial_response_wait_sec: Number(aa.initial_response_wait_sec ?? aa.response_wait_timeout) || 5,
    no_response_extra_wait_sec: Number(aa.no_response_extra_wait_sec ?? 2.5),
    silence_detection_sec: Number(aa.silence_detection_sec ?? aa.silence_detection_timeout) || 2.5,
    no_response_countdown_sec: Number(aa.no_response_countdown_sec) || 3,
    max_no_response_warnings: Number(aa.max_no_response_warnings) || 3,
    auto_skip_enabled: aa.auto_skip_enabled !== false,
    voice_commands_enabled: aa.voice_commands_enabled !== false,
    confirmation_before_next_sec: Number(aa.confirmation_before_next_sec ?? 2.5),
    minimum_answer_words: Number(aa.minimum_answer_words) || 5,
    minimum_speech_duration_sec: Number(aa.minimum_speech_duration_sec) || 2,
    speech_energy_threshold: Number(aa.speech_energy_threshold) || 0.038,
    speech_confirm_ms: Number(aa.speech_confirm_ms) || 400,
  };
}

export function getAutoAdvanceCaptureSnapshot() {
  const captureText = _getCombinedCaptureText();
  return {
    active: _active,
    capture_text: captureText,
    interim_transcript: captureText || _interimTranscript,
    whisper_transcript: getWhisperSegmentTranscript(),
    speech_probability: getSileroSpeechProbability(),
    speech_duration_ms: _confirmedSpeechMs || 0,
    confirmed_speech_ms: _confirmedSpeechMs || 0,
    word_count: _wordCount(captureText || _interimTranscript),
    speech_confirmed: _speechConfirmed,
    silero_speech_active: _sileroHumanSpeech(),
  };
}

export function resetAutoAdvanceUi() {
  stopAutoAdvanceTurn();
}

export function stopAutoAdvanceTurn() {
  _active = false;
  _turnSeq += 1;
  _resetSpeechTracking();
  _interimTranscript = "";
  _calibrated = false;
  _calibrationSamples = [];
  _clearAllTimers();
  _stopVad();
  void stopSileroVad();
  _sileroActive = false;
  _stopSpeechRecognition();
  resetWhisperSegments();
  _callbacks = null;
  _turnMeta = null;
  _listenOnly = false;
  _phase = AUTO_ADVANCE_PHASE.IDLE;
  _hideDebugPanel();
}

export async function flushAutoAdvanceWhisperTranscription() {
  const text = await flushWhisperSegments();
  if (text && _callbacks?.onInterimTranscript) _callbacks.onInterimTranscript(text);
  return text;
}

export function autoAdvanceWhisperBusy() {
  return whisperTranscriptionInFlight();
}

export function isAutoAdvanceActive() {
  return _active && _enabled();
}

/** @deprecated Banner removed — no-op for compatibility */
export function cancelAutoAdvancePopup() {}

/** @deprecated Banner removed — manual skip uses candidateSkipBtn */
export function confirmAutoAdvanceNow() {}

/** @deprecated */
export function cancelAutoAdvanceConfirmation() {
  cancelAutoAdvancePopup();
}

/** @deprecated */
export function submitAutoAdvanceImmediately() {
  confirmAutoAdvanceNow();
}

/** External transcript activity hook (manual/dynamic modes). */
export function notifyAutoAdvanceAnswerActivity(source, detail = {}) {
  if (!_active) return;
  const text = String(detail.text || _interimTranscript || "").trim();
  if (source === "transcript" && _wordCount(text) > 0) {
    _interimTranscript = text;
    if (_callbacks?.onInterimTranscript) _callbacks.onInterimTranscript(_interimTranscript);
    if (!_speechConfirmed) _onSpeechDetectedDuringWait(Date.now());
  }
}

/** @deprecated Banner removed — no-op */
export function initAutoAdvanceBannerUi() {}

export function beginAutoAdvanceTurn(opts = {}) {
  stopAutoAdvanceTurn();
  if (!_enabled()) return;

  _listenOnly = !!(opts.listenOnly || opts.isWarmup);
  const turnSeq = ++_turnSeq;
  _active = true;
  _callbacks = opts;
  _turnMeta = {
    questionIndex: opts.questionIndex,
    questionText: opts.questionText,
  };
  _calibrated = false;
  _calibrationSamples = [];
  _calibrationUntil = Date.now() + CALIBRATION_MS;
  _resetSpeechTracking();
  resetWhisperSegments();
  _phase = AUTO_ADVANCE_PHASE.WAITING_FOR_RESPONSE;

  _ensureDebugPanel();
  _vadEventLog("Waiting for response", {
    questionIndex: opts.questionIndex,
    initialWaitSec: _initialWaitMs() / 1000,
  });
  _setPhase(AUTO_ADVANCE_PHASE.WAITING_FOR_RESPONSE, "Listening…");
  if (_listenOnly) {
    _turnStartTs = Date.now();
    _setPhase(AUTO_ADVANCE_PHASE.LISTENING, "Listening…");
  } else {
    _turnStartTs = Date.now();
    // Initial no-response timer starts after mic calibration (see _finishCalibration).
  }

  const stream = opts.audioStream;
  if (!stream || !stream.getAudioTracks?.().length) {
    console.warn("[INTERVIEW] No audio stream — silence timers still active");
    if (!_listenOnly) _startInitialWaitTimers();
    return;
  }

  try {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === "suspended") {
      void _audioCtx.resume().catch(() => {});
    }
    const source = _audioCtx.createMediaStreamSource(stream);
    _analyser = _audioCtx.createAnalyser();
    _analyser.fftSize = 2048;
    _analyser.smoothingTimeConstant = 0.55;
    source.connect(_analyser);
    _timeBuf = new Uint8Array(_analyser.fftSize);
    _freqBuf = new Uint8Array(_analyser.frequencyBinCount);
    _vadHandle = requestAnimationFrame(_vadLoop);
    if (!_useVadWhisperPipeline()) {
      _startSpeechRecognition();
    }
    void startSileroVad(stream, {
      onSpeechStart: () => {
        _sileroActive = true;
        const now = Date.now();
        _clearTimer("_initialWaitHandle");
        if (_silenceSinceTs) {
          _silenceSinceTs = 0;
          _setPhase(AUTO_ADVANCE_PHASE.LISTENING, "Listening…");
        }
        if (!_speechConfirmed) {
          if (_phase === AUTO_ADVANCE_PHASE.WAITING_FOR_RESPONSE || _initialWaitHandle) {
            _onSpeechDetectedDuringWait(now);
          } else if (sileroProbabilityAcceptable() && _calibrated) {
            _confirmSpeech(now);
          }
        }
      },
      onSpeechEnd: () => {
        _sileroActive = false;
        if (_speechConfirmed) {
          const now = Date.now();
          if (!_silenceSinceTs) _silenceSinceTs = now;
          _lastSpeechTs = now;
        }
      },
      onSpeechEndAudio: (audio) => {
        if (!_useVadWhisperPipeline()) return;
        if (!sileroProbabilityAcceptable(0.75)) return;
        void enqueueWhisperSegment(audio).then(() => {
          const text = getWhisperSegmentTranscript();
          if (text) {
            _interimTranscript = text;
            if (_callbacks?.onInterimTranscript) _callbacks.onInterimTranscript(text);
            if (!_speechConfirmed && _wordCount(text) > 0) {
              _onSpeechDetectedDuringWait(Date.now());
            }
          }
        });
      },
    });
  } catch (err) {
    console.warn("[auto-advance] VAD init failed", err);
  }

  return () => {
    if (turnSeq === _turnSeq) stopAutoAdvanceTurn();
  };
}
