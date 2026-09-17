/**
 * question_voice.js — read an interview question aloud, whatever it takes.
 *
 * Written 16 Sep 2026 after a live interview ran with no voice at all: the
 * server's TTS call was failing, `/candidate/tts` said so in a body the page
 * threw away, and the turn moved on to "listening" as if the question had been
 * spoken. Three layers now stand between the candidate and silence:
 *
 *   1. Server voice (OpenAI, Indian-English instructions) streamed through a
 *      MediaSource so playback starts on the first chunk.
 *   2. The same server audio as a whole blob when streaming misbehaves — the
 *      old code tried this on a body it had already consumed, so the fallback
 *      never ran.
 *   3. The browser's own `speechSynthesis`, preferring an `en-IN` voice.
 *
 * Every failure is reported through `onStatus` so the page can show it and the
 * console records why a layer was skipped. Nothing here swallows an error
 * silently any more.
 *
 * `speakQuestion()` resolves when the audio has FINISHED (not when it starts),
 * because the microphone must open only after the AI stops talking.
 */
import { apiFetch } from "./core.js";

const STREAM_START_TIMEOUT_MS = 6000;
const BLOB_FETCH_TIMEOUT_MS = 15000;
/** Voice names that sound right for an Indian-English interviewer, best first. */
const PREFERRED_BROWSER_VOICES = [/en[-_]IN/i, /india/i, /heera|ravi|neerja|prabhat/i];

let _active = null; // { kind: "audio" | "synth", stop: () => void }

/** The reason the last spoken question fell back (for status lines / tests). */
export let lastVoiceSource = "none"; // "server-stream" | "server-blob" | "browser" | "none"

export function cancelQuestionVoice() {
  if (_active) {
    try { _active.stop(); } catch (_) { /* already stopped */ }
    _active = null;
  }
}

/**
 * Speak `text`. Resolves `{ source }` when speech ends. Resolves (never rejects)
 * even when every layer fails, so the interview keeps moving; in that case
 * `source` is "none" and `onStatus` has been told.
 *
 * @param {string} text
 * @param {{ onStart?: () => void, onStatus?: (msg: string, level: "info"|"warn") => void }} hooks
 */
export async function speakQuestion(text, hooks = {}) {
  const spoken = String(text || "").trim();
  const onStart = typeof hooks.onStart === "function" ? hooks.onStart : () => {};
  const onStatus = typeof hooks.onStatus === "function" ? hooks.onStatus : () => {};
  if (!spoken) return { source: "none" };
  cancelQuestionVoice();

  let serverFailure = null;
  try {
    const res = await _fetchServerAudio(spoken);
    const source = await _playServerAudio(res, onStart);
    lastVoiceSource = source;
    return { source };
  } catch (err) {
    serverFailure = err;
    console.warn("[VOICE] server voice unavailable — falling back to browser speech:", err?.message || err);
  }

  try {
    await _speakWithBrowser(spoken, onStart);
    lastVoiceSource = "browser";
    onStatus("Using your browser's voice — the AI voice service is unavailable right now.", "warn");
    return { source: "browser" };
  } catch (err) {
    console.error("[VOICE] browser speech also failed:", err?.message || err, "| server:", serverFailure?.message);
    onStatus("Voice playback is unavailable — please read the question on screen.", "warn");
    lastVoiceSource = "none";
    return { source: "none" };
  }
}

/* ---------------------------------------------------------------- server */

async function _fetchServerAudio(spoken) {
  const fd = new FormData();
  fd.append("text", spoken);
  const res = await apiFetch("/candidate/tts", { method: "POST", body: fd });
  const contentType = String(res.headers.get("content-type") || "");
  if (!res.ok || contentType.includes("application/json")) {
    // The server now reports a status + code (503 tts_unavailable, …). Surface
    // both so the console says WHY the AI voice is missing.
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.code) detail = `${body.code} (${body.error || ""})`.trim();
    } catch (_) { /* not JSON */ }
    throw new Error(`TTS request failed: ${detail}`);
  }
  return res;
}

/**
 * Play the response, streaming first. The response is CLONED before streaming
 * so the blob fallback reads an untouched body — `res.blob()` on a body whose
 * reader was already taken throws `TypeError: body stream already read`, which
 * is what made the previous fallback unreachable.
 */
async function _playServerAudio(res, onStart) {
  const canStream = !!res.body && typeof MediaSource !== "undefined"
    && MediaSource.isTypeSupported("audio/mpeg");
  const blobCopy = canStream ? res.clone() : res;

  if (canStream) {
    try {
      const audio = await _streamingAudioElement(res);
      await _playElement(audio, onStart);
      return "server-stream";
    } catch (err) {
      console.warn("[VOICE] streaming playback failed, retrying as a whole clip:", err?.message || err);
    }
  }

  const blob = await _withTimeout(blobCopy.blob(), BLOB_FETCH_TIMEOUT_MS, "TTS download timeout");
  if (!blob.size) throw new Error("Empty TTS audio");
  const audio = new Audio(URL.createObjectURL(blob));
  await _playElement(audio, onStart);
  return "server-blob";
}

/** Resolve when the element finishes; reject when it never starts. */
function _playElement(audio, onStart) {
  return new Promise((resolve, reject) => {
    let started = false;
    const stop = () => {
      try { audio.pause(); } catch (_) { /* ignore */ }
      _release(audio);
      resolve();
    };
    _active = { kind: "audio", stop };
    const finish = () => {
      if (_active && _active.stop === stop) _active = null;
      _release(audio);
      resolve();
    };
    audio.preload = "auto";
    audio.onplaying = () => {
      if (!started) { started = true; onStart(); }
    };
    audio.onended = finish;
    audio.onerror = () => {
      if (_active && _active.stop === stop) _active = null;
      _release(audio);
      const code = audio.error?.code;
      if (started) resolve(); // partial playback still counts as spoken
      else reject(new Error(`audio element error${code ? ` (code ${code})` : ""}`));
    };
    audio.play().catch((err) => {
      if (_active && _active.stop === stop) _active = null;
      _release(audio);
      // NotAllowedError = autoplay policy: the fullscreen gate normally grants
      // the gesture; if it did not, the browser voice below needs one too, so
      // the caller's status line is the only honest option.
      reject(new Error(`play() rejected: ${err?.name || err}`));
    });
  });
}

function _release(audio) {
  try { URL.revokeObjectURL(audio.src); } catch (_) { /* ignore */ }
}

/** Feed a fetch stream into a MediaSource so playback can start on chunk 1. */
function _streamingAudioElement(res) {
  return new Promise((resolve, reject) => {
    const mediaSource = new MediaSource();
    const audio = new Audio();
    audio.src = URL.createObjectURL(mediaSource);
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    mediaSource.addEventListener("sourceopen", async () => {
      let buffer;
      try {
        buffer = mediaSource.addSourceBuffer("audio/mpeg");
      } catch (err) {
        settle(reject, err);
        return;
      }
      const reader = res.body.getReader();
      const queue = [];
      let done = false;
      const pump = () => {
        if (buffer.updating) return;
        if (queue.length) {
          try { buffer.appendBuffer(queue.shift()); } catch (err) { settle(reject, err); }
          return;
        }
        if (done && mediaSource.readyState === "open") {
          try { mediaSource.endOfStream(); } catch (_) { /* already ended */ }
        }
      };
      buffer.addEventListener("updateend", pump);
      try {
        for (;;) {
          const { value, done: finished } = await reader.read();
          if (finished) break;
          if (value && value.byteLength) {
            queue.push(value);
            settle(resolve, audio); // first chunk is enough to start playing
            pump();
          }
        }
        done = true;
        pump();
      } catch (err) {
        done = true;
        settle(reject, err);
      }
      settle(reject, new Error("Empty TTS stream"));
    });

    setTimeout(() => settle(reject, new Error("TTS stream timeout")), STREAM_START_TIMEOUT_MS);
  });
}

/* ---------------------------------------------------------------- browser */

export function browserVoiceAvailable() {
  return typeof window !== "undefined" && "speechSynthesis" in window
    && typeof SpeechSynthesisUtterance !== "undefined";
}

/** Pick the most Indian-English voice the browser offers (null = default). */
export function pickBrowserVoice(voices) {
  const list = Array.isArray(voices) ? voices : [];
  for (const pattern of PREFERRED_BROWSER_VOICES) {
    const hit = list.find((v) => pattern.test(v.lang || "") || pattern.test(v.name || ""));
    if (hit) return hit;
  }
  return list.find((v) => /^en/i.test(v.lang || "")) || null;
}

function _loadVoices() {
  return new Promise((resolve) => {
    const have = window.speechSynthesis.getVoices();
    if (have.length) { resolve(have); return; }
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(window.speechSynthesis.getVoices()); } };
    window.speechSynthesis.addEventListener("voiceschanged", finish, { once: true });
    setTimeout(finish, 800); // some browsers never fire voiceschanged
  });
}

async function _speakWithBrowser(spoken, onStart) {
  if (!browserVoiceAvailable()) throw new Error("speechSynthesis not supported");
  const synth = window.speechSynthesis;
  try { synth.cancel(); } catch (_) { /* ignore */ }
  const voices = await _loadVoices();
  return new Promise((resolve, reject) => {
    const utter = new SpeechSynthesisUtterance(spoken);
    const voice = pickBrowserVoice(voices);
    if (voice) utter.voice = voice;
    utter.lang = voice?.lang || "en-IN";
    utter.rate = 0.95;
    utter.pitch = 1;
    let started = false;
    const stop = () => { try { synth.cancel(); } catch (_) { /* ignore */ } resolve(); };
    _active = { kind: "synth", stop };
    utter.onstart = () => { started = true; onStart(); };
    utter.onend = () => { if (_active && _active.stop === stop) _active = null; resolve(); };
    utter.onerror = (ev) => {
      if (_active && _active.stop === stop) _active = null;
      if (ev?.error === "interrupted" || ev?.error === "canceled") { resolve(); return; }
      if (started) resolve(); else reject(new Error(`speechSynthesis error: ${ev?.error || "unknown"}`));
    };
    synth.speak(utter);
    // Chrome occasionally queues an utterance and never starts it; treat a
    // 4 s no-start as failure so the turn is not stuck on "AI speaking".
    setTimeout(() => {
      if (!started && _active && _active.stop === stop) {
        _active = null;
        try { synth.cancel(); } catch (_) { /* ignore */ }
        reject(new Error("speechSynthesis did not start"));
      }
    }, 4000);
  });
}

/* ---------------------------------------------------------------- utils */

function _withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
