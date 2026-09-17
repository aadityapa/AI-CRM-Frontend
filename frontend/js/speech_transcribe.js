/**
 * speech_transcribe.js — the ONE client for `POST /candidate/transcribe`.
 *
 * Both transcript producers (Silero/Whisper segments and the whole-recording
 * fallback in candidate.js) go through here so they agree on what a failure
 * means. The distinction that matters for the interview:
 *
 *   - "silence"  → the provider worked and heard nothing. `{ text: "" }`.
 *   - "down"     → the provider (or network) failed. `TranscribeUnavailableError`.
 *
 * The old code collapsed both into an empty string, which is how a broken
 * OpenAI key turned every answer into "skip" (16 Sep 2026). Callers now keep
 * the recorded audio and let the candidate retry when the service is down.
 */
import { apiFetch } from "./core.js";

/** Codes the server sends for provider/network failures (see main.py _speech_error). */
const UNAVAILABLE_CODES = new Set(["stt_unavailable", "stt_failed"]);

export class TranscribeUnavailableError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = "TranscribeUnavailableError";
    this.code = code || "stt_unavailable";
    this.status = status || 0;
  }
}

let _lastFailure = null; // { at: ms, code, message }

/** Last provider failure, or null when the last call succeeded. */
export function lastTranscribeFailure() {
  return _lastFailure;
}

/** True when transcription failed within the last `withinMs` (default 60 s). */
export function transcriptionRecentlyDown(withinMs = 60000) {
  return !!_lastFailure && Date.now() - _lastFailure.at < withinMs;
}

/**
 * Transcribe one audio blob.
 * @returns {Promise<string>} the text ("" for silence / too-short clips)
 * @throws {TranscribeUnavailableError} when the service itself failed
 */
export async function transcribeAudioBlob(blob, filename = "candidate-response.webm") {
  if (!blob || !blob.size) return "";
  const fd = new FormData();
  fd.append("audio_file", blob, filename);

  let res;
  try {
    res = await apiFetch("/candidate/transcribe", { method: "POST", body: fd });
  } catch (err) {
    _remember("network", err?.message || "network error");
    throw new TranscribeUnavailableError(`Transcription request failed: ${err?.message || err}`, "network", 0);
  }

  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }

  if (res.ok) {
    _lastFailure = null;
    return String(data?.text || "").trim();
  }
  const code = String(data?.code || "");
  const message = String(data?.error || `HTTP ${res.status}`);
  if (res.status === 400 && !UNAVAILABLE_CODES.has(code)) {
    // too_short / empty_audio / no_audio — our clip, not their service.
    console.info("[candidate-stt] clip rejected:", code || res.status, message);
    return "";
  }
  if (res.status === 401 || res.status === 403) {
    // Session problem — let the caller's normal auth handling see it.
    throw new Error(message);
  }
  _remember(code || `http_${res.status}`, message);
  throw new TranscribeUnavailableError(message, code, res.status);
}

function _remember(code, message) {
  _lastFailure = { at: Date.now(), code, message };
  console.warn("[candidate-stt] transcription service unavailable:", code, message);
}
