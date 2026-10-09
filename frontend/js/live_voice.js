/**
 * live_voice.js — F, the live voice interview (9 Oct 2026).
 *
 * When the template's voice mode is "live", the candidate talks to OpenAI's
 * realtime voice model over WebRTC instead of the turn-by-turn text-to-speech
 * + transcription loop. The SERVER still owns the interview:
 *
 *   • the model asks only questions the app hands it, through two tools —
 *     `get_next_question` (start) and `submit_answer` (each answer). Each answer
 *     is the realtime transcript of what the candidate said, POSTed to the
 *     ordinary `/answer` route, so follow-ups, the cap, the clock, scoring and
 *     the report are the same code as every other interview;
 *   • the recording keeps working: the model's voice is mirrored onto the
 *     recording bus (`recording_mix.mirrorStreamToRecording`);
 *   • our OpenAI key never reaches the browser — `/candidate/realtime/session`
 *     mints a short-lived client secret.
 *
 * If the call cannot be opened, or drops and cannot be restored, the page falls
 * back to the standard voice for the rest of the interview (`hooks.fallback`).
 * Nothing here throws into the candidate page.
 */
import { apiFetch } from "./core.js";
import { state } from "./state.js";
import { mirrorStreamToRecording } from "./recording_mix.js";

/** Wait this long for the candidate's last words to be transcribed before an answer is sent. */
const TRANSCRIPT_SETTLE_MS = 2500;
/** After "the interview is complete", the closing must end within this long. */
const CLOSING_MAX_MS = { withQa: 4 * 60 * 1000, plain: 45 * 1000 };
const MAX_RECONNECTS = 2;
const USAGE_FLUSH_MS = 20000;

let _hooks = {};
let _pc = null;
let _dc = null;
let _audioEl = null;
let _mix = null;
let _mic = null;
let _active = false;
let _failed = false;
let _starting = null;
let _reconnects = 0;
let _question = null; // the server payload being asked
let _turnSeq = 0;
const _itemTurn = new Map(); // item_id -> turn seq
const _pendingItems = new Set();
let _turnText = [];
let _pendingCallId = null; // a tool call waiting for the next question
const _handledCalls = new Set();
let _advancing = false;
let _complete = false;
let _endResolve = null;
let _usage = [];
let _usageTimer = null;
let _resumeNote = "";

function _log(...args) {
  try { console.info("[live-voice]", ...args); } catch (_) { /* ignore */ }
}

export function configureLiveVoice(hooks) {
  _hooks = { ...(hooks || {}) };
}

/** The template wants live voice and this browser can do it (and it has not failed). */
export function liveVoiceWanted() {
  return state.conversation?.voice_mode === "live" && !_failed && typeof window.RTCPeerConnection === "function";
}

export function liveVoiceActive() {
  return _active;
}

function _send(evt) {
  try {
    if (_dc && _dc.readyState === "open") {
      _dc.send(JSON.stringify(evt));
      return true;
    }
  } catch (err) {
    _log("send failed", err?.message || err);
  }
  return false;
}

function _questionPayload(q) {
  if (!q) return { status: "no_question" };
  return {
    question: String(q.question || ""),
    is_followup: !!q.is_followup,
    is_warmup: !!q.is_warmup,
    question_number: q.is_warmup ? 0 : Number(q.index) || 0,
    total_questions: Number(q.total) || 0,
    note: q.is_warmup
      ? "This is the warm-up introduction; it is not scored."
      : q.is_followup ? "This is a follow-up on their previous answer." : "",
  };
}

function _functionOutput(callId, output) {
  _send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) } });
  _send({ type: "response.create" });
}

function _injectText(text) {
  _send({ type: "response.cancel" });
  _send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
  _send({ type: "response.create" });
}

function _newTurn() {
  _turnSeq += 1;
  _turnText = [];
  _pendingItems.clear();
}

/* ------------------------------------------------------------------ usage */

function _queueUsage(usage) {
  if (!usage || typeof usage !== "object") return;
  _usage.push(usage);
  if (_usage.length >= 10 || !_active) {
    void _flushUsage();
    return;
  }
  if (!_usageTimer) _usageTimer = setInterval(() => void _flushUsage(), USAGE_FLUSH_MS);
}

async function _flushUsage() {
  if (!_usage.length) return;
  const batch = _usage.splice(0, _usage.length);
  try {
    await apiFetch("/candidate/realtime/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usages: batch }),
    });
  } catch (_) {
    /* cost logging is never worth breaking an interview over */
  }
}

/* ------------------------------------------------------------------ events */

async function _waitForTranscripts() {
  const deadline = Date.now() + TRANSCRIPT_SETTLE_MS;
  while (_pendingItems.size && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 120));
  }
}

async function _advance({ skipped = false, callId = null } = {}) {
  if (_advancing) {
    if (callId) _functionOutput(callId, { status: "already_moved_on", instruction: "Wait for the next question." });
    return;
  }
  _advancing = true;
  try {
    await _waitForTranscripts();
    const answer = _turnText.join(" ").replace(/\s+/g, " ").trim();
    const skip = skipped || !answer;
    const resp = await _hooks.postAnswer?.({ ans: skip ? "" : answer, skipped: skip });
    if (!resp || resp.error) {
      const msg = resp?.error || "The answer could not be saved.";
      _log("answer failed", msg);
      if (/already completed/i.test(msg)) {
        _complete = true;
        if (callId) _functionOutput(callId, { status: "interview_complete" });
        _armClosingDeadline();
        return;
      }
      if (callId) _functionOutput(callId, { status: "error", instruction: "Apologise briefly and ask the candidate to give their answer again." });
      return;
    }
    _newTurn();
    const next = resp.next || null;
    const done = resp.finalizing || resp.status === "completed" || !next || !next.question;
    if (done) {
      _complete = true;
      if (callId) _functionOutput(callId, { status: "interview_complete" });
      else _injectText("[App] The interview questions are complete. Follow your closing instructions now.");
      _armClosingDeadline();
      return;
    }
    _pendingCallId = callId;
    // The page renders the question (progress, chips) and hands it back via liveVoicePresent.
    await _hooks.present?.(next);
  } finally {
    _advancing = false;
  }
}

let _closingTimer = null;
function _armClosingDeadline() {
  clearTimeout(_closingTimer);
  const ms = state.conversation?.closing_qa ? CLOSING_MAX_MS.withQa : CLOSING_MAX_MS.plain;
  _closingTimer = setTimeout(() => _endFromModel("closing_timeout"), ms);
}

function _endFromModel(reason) {
  clearTimeout(_closingTimer);
  _log("interview end", reason);
  const r = _endResolve;
  _endResolve = null;
  stopLiveVoice();
  if (typeof r === "function") r(reason);
  void _hooks.finish?.(reason);
}

function _onToolCall(evt) {
  const callId = evt.call_id;
  if (!callId || _handledCalls.has(callId)) return;
  _handledCalls.add(callId);
  const name = evt.name;
  let args = {};
  try { args = JSON.parse(evt.arguments || "{}"); } catch (_) { args = {}; }
  _log("tool", name, args);
  if (name === "get_next_question") {
    if (_complete) _functionOutput(callId, { status: "interview_complete" });
    else _functionOutput(callId, { ..._questionPayload(_question), resume_note: _resumeNote || undefined });
    _resumeNote = "";
    return;
  }
  if (name === "submit_answer") {
    if (_complete) {
      _functionOutput(callId, { status: "interview_complete" });
      return;
    }
    void _advance({ skipped: !!args.skipped, callId });
    return;
  }
  if (name === "end_interview") {
    _functionOutput(callId, { status: "ok" });
    setTimeout(() => _endFromModel("model_ended"), 1500);
    return;
  }
  _functionOutput(callId, { status: "unknown_tool" });
}

function _onEvent(raw) {
  let evt;
  try { evt = JSON.parse(raw); } catch (_) { return; }
  const t = String(evt.type || "");
  switch (t) {
    case "input_audio_buffer.committed":
      if (evt.item_id) {
        _itemTurn.set(evt.item_id, _turnSeq);
        _pendingItems.add(evt.item_id);
      }
      break;
    case "conversation.item.input_audio_transcription.completed": {
      const id = evt.item_id;
      _pendingItems.delete(id);
      const turn = _itemTurn.has(id) ? _itemTurn.get(id) : _turnSeq;
      const text = String(evt.transcript || "").trim();
      if (text && turn === _turnSeq && !_complete) {
        _turnText.push(text);
        _hooks.onCandidateText?.(_turnText.join(" "));
      }
      break;
    }
    case "conversation.item.input_audio_transcription.failed":
      _pendingItems.delete(evt.item_id);
      break;
    case "input_audio_buffer.speech_started":
      _hooks.onStatus?.("Listening…");
      break;
    case "output_audio_buffer.started":
      _hooks.onSpeaking?.(true);
      break;
    case "output_audio_buffer.stopped":
    case "output_audio_buffer.cleared":
      _hooks.onSpeaking?.(false);
      break;
    case "response.output_audio_transcript.done":
    case "response.audio_transcript.done":
      if (evt.transcript) _hooks.onCaption?.(String(evt.transcript));
      break;
    case "response.function_call_arguments.done":
      _onToolCall(evt);
      break;
    case "response.done":
      if (evt.response?.usage) _queueUsage(evt.response.usage);
      break;
    case "error":
      _log("server error", evt.error?.message || evt.error);
      break;
    default:
      break;
  }
}

/* ------------------------------------------------------------------ connection */

async function _mint() {
  const res = await apiFetch("/candidate/realtime/session", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.client_secret) throw new Error(data?.error || `live voice unavailable (${res.status})`);
  return data;
}

function _teardown() {
  try { _dc && _dc.close(); } catch (_) { /* ignore */ }
  try { _pc && _pc.close(); } catch (_) { /* ignore */ }
  try { _mic && _mic.getTracks().forEach((tr) => tr.stop()); } catch (_) { /* ignore */ }
  try { _mix && _mix.release(); } catch (_) { /* ignore */ }
  if (_audioEl) {
    try { _audioEl.srcObject = null; _audioEl.remove(); } catch (_) { /* ignore */ }
  }
  _dc = null; _pc = null; _mic = null; _mix = null; _audioEl = null;
}

async function _connect() {
  const minted = await _mint();
  const pc = new RTCPeerConnection();
  _pc = pc;
  _audioEl = document.createElement("audio");
  _audioEl.autoplay = true;
  _audioEl.setAttribute("playsinline", "");
  _audioEl.style.display = "none";
  document.body.appendChild(_audioEl);
  pc.ontrack = (e) => {
    const stream = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
    _audioEl.srcObject = stream;
    try { _mix && _mix.release(); } catch (_) { /* ignore */ }
    _mix = mirrorStreamToRecording(stream);
  };
  _mic = await _hooks.getAudioStream?.();
  const track = _mic && _mic.getAudioTracks ? _mic.getAudioTracks()[0] : null;
  if (!track) throw new Error("microphone unavailable");
  pc.addTrack(track, _mic);
  const dc = pc.createDataChannel("oai-events");
  _dc = dc;
  const opened = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("voice channel did not open")), 15000);
    dc.onopen = () => { clearTimeout(t); resolve(); };
  });
  dc.onmessage = (e) => _onEvent(e.data);
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if ((st === "failed" || st === "disconnected" || st === "closed") && _active && pc === _pc) {
      void _onDropped(st);
    }
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const res = await fetch(minted.calls_url, {
    method: "POST",
    body: offer.sdp,
    headers: { Authorization: `Bearer ${minted.client_secret}`, "Content-Type": "application/sdp" },
  });
  if (!res.ok) throw new Error(`voice service refused the call (${res.status})`);
  await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
  await opened;
  _log("connected", minted.model);
}

let _dropTimer = null;
async function _onDropped(st) {
  if (st === "disconnected") {
    // Often recovers on its own within a few seconds.
    clearTimeout(_dropTimer);
    _dropTimer = setTimeout(() => { if (_pc && _pc.connectionState !== "connected") void _onDropped("failed"); }, 6000);
    return;
  }
  if (!_active) return;
  _log("dropped", st);
  _teardown();
  if (_complete) {
    _endFromModel("dropped_after_complete");
    return;
  }
  if (_reconnects < MAX_RECONNECTS) {
    _reconnects += 1;
    _hooks.onStatus?.("Reconnecting the voice…");
    try {
      _resumeNote = "The call dropped and was restored: tell the candidate briefly, then ask this question again.";
      await _connect();
      _send({ type: "response.create" });
      return;
    } catch (err) {
      _log("reconnect failed", err?.message || err);
      _teardown();
    }
  }
  _goStandard("connection lost");
}

function _goStandard(reason) {
  _log("falling back to the standard voice:", reason);
  _active = false;
  _failed = true;
  _teardown();
  void _flushUsage();
  _hooks.onStatus?.("Switched to the standard voice.");
  const q = _question;
  if (q) void _hooks.fallback?.(q);
}

/**
 * Hand a question to the live call (opening it on the first one). Resolves
 * true when the live call is asking it, false when the page should use the
 * standard voice instead.
 */
export async function liveVoicePresent(data) {
  if (!liveVoiceWanted()) return false;
  _question = data;
  if (!_active) {
    if (!_starting) {
      _starting = (async () => {
        try {
          _newTurn();
          await _connect();
          _active = true;
          // The model's brief says: call get_next_question first.
          _send({ type: "response.create" });
          return true;
        } catch (err) {
          _log("could not start", err?.message || err);
          _teardown();
          _failed = true;
          return false;
        } finally {
          _starting = null;
        }
      })();
    }
    return _starting;
  }
  if (_pendingCallId) {
    const id = _pendingCallId;
    _pendingCallId = null;
    _functionOutput(id, _questionPayload(data));
  } else {
    // The candidate pressed Send / Skip: there is no tool call to answer.
    _injectText(`[App] The candidate pressed the button to move on. Next question to ask: ${JSON.stringify(_questionPayload(data))}`);
  }
  return true;
}

/** Send / Skip pressed while live: the same move the model's tool makes. */
export async function liveVoiceManualAdvance(skipped) {
  if (!_active) return false;
  _send({ type: "response.cancel" });
  await _advance({ skipped: !!skipped, callId: null });
  return true;
}

/** Close the call (end of interview, timer, termination). Safe to call twice. */
export function stopLiveVoice() {
  const was = _active;
  _active = false;
  clearTimeout(_closingTimer);
  clearTimeout(_dropTimer);
  if (_usageTimer) { clearInterval(_usageTimer); _usageTimer = null; }
  void _flushUsage();
  _teardown();
  _hooks.onSpeaking?.(false);
  if (was) _log("stopped");
}
