/**
 * Whisper STT — only for Silero VAD-confirmed speech segments (not continuous streaming).
 */

import { apiFetch, handleJson } from "./core.js";

let _pending = Promise.resolve();
let _transcript = "";
let _inFlight = 0;

function _merge(existing, incoming) {
  const a = String(existing || "").trim().replace(/\s+/g, " ");
  const b = String(incoming || "").trim().replace(/\s+/g, " ");
  if (!b) return a;
  if (!a) return b;
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (bl.length > 8 && al.includes(bl)) return a;
  if (al.length > 8 && bl.includes(al)) return b;
  return `${a} ${b}`.replace(/\s+/g, " ").trim();
}

/** Encode mono Float32 PCM @ sampleRate as WAV blob for /candidate/transcribe. */
export function float32ToWavBlob(samples, sampleRate = 16000) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataLength, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function _transcribeBlob(blob) {
  if (!blob || !blob.size) return "";
  const fd = new FormData();
  fd.append("audio_file", blob, "vad-segment.wav");
  const data = await handleJson(await apiFetch("/candidate/transcribe", { method: "POST", body: fd }));
  return String(data?.text || "").trim();
}

/**
 * Queue a VAD-confirmed segment for Whisper (serializes API calls).
 * @param {Float32Array} float32Audio — 16 kHz mono from Silero
 */
export function enqueueWhisperSegment(float32Audio, { sampleRate = 16000 } = {}) {
  if (!float32Audio || !float32Audio.length) return _pending;
  const blob = float32ToWavBlob(float32Audio, sampleRate);
  if (blob.size < 1200) return _pending;
  _inFlight += 1;
  _pending = _pending
    .then(async () => {
      try {
        const text = await _transcribeBlob(blob);
        if (text) {
          _transcript = _merge(_transcript, text);
          console.info("[INTERVIEW] whisper_segment", { len: text.length, preview: text.slice(0, 80) });
        }
      } catch (err) {
        console.warn("[candidate-stt] whisper_segment_failed", err?.message || err);
      } finally {
        _inFlight = Math.max(0, _inFlight - 1);
      }
    })
    .catch(() => {
      _inFlight = Math.max(0, _inFlight - 1);
    });
  return _pending;
}

export function getWhisperSegmentTranscript() {
  return String(_transcript || "").trim();
}

export function resetWhisperSegments() {
  _transcript = "";
  _pending = Promise.resolve();
  _inFlight = 0;
}

export async function flushWhisperSegments() {
  await _pending;
  return getWhisperSegmentTranscript();
}

export function whisperTranscriptionInFlight() {
  return _inFlight > 0;
}
