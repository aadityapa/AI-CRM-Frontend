/**
 * recording_mix.js — the ONE audio bus the session recording listens to.
 *
 * Written 7 Oct 2026 after a reviewer played a recording and heard only the
 * candidate: the microphone was the recording's only audio track, while the
 * AI's question was played through the speakers by `question_voice.js` and
 * never reached the recorder. With headphones (most candidates) every question
 * was a silent gap.
 *
 * Design — the candidate's playback path is NOT touched. `question_voice.js`
 * keeps playing its <audio> element straight to the speakers exactly as
 * before; here the SAME clip is decoded a second time and played, in sync,
 * into a `MediaStreamAudioDestinationNode` that nobody hears. The recorder's
 * audio track comes off that bus, with the microphone clone mixed in. So:
 *
 *   • a suspended / missing AudioContext costs the RECORDING its voice track,
 *     never the candidate their question (the interview is the product);
 *   • `createMediaElementSource` is deliberately avoided — it re-routes the
 *     element permanently, and an AudioContext the browser later suspends
 *     would mute the candidate mid-interview.
 *
 * The browser `speechSynthesis` fallback has no capturable audio; a question
 * read that way stays out of the recording (the transcript has the text).
 *
 * Live viewers get the voice too: the recorder's chunks ARE the live stream.
 */

let _ctx = null;
let _bus = null;

function _context() {
  if (_ctx) return _ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try {
    _ctx = new Ctx();
    _bus = _ctx.createMediaStreamDestination();
  } catch (_) {
    _ctx = null;
    _bus = null;
    return null;
  }
  // A context the browser suspends later (tab backgrounded on some phones,
  // an "interrupted" state on iOS) silences the bus; nudge it back.
  _ctx.addEventListener("statechange", () => {
    if (_ctx && _ctx.state !== "running") {
      _ctx.resume().catch(() => { /* needs a gesture; the next call retries */ });
    }
  });
  return _ctx;
}

/**
 * Make sure the bus is running. Call it from a user gesture (the fullscreen
 * gate click at STEP-8 is one) — autoplay policy leaves a fresh context
 * suspended otherwise. Returns whether audio can flow.
 */
export async function ensureMixRunning() {
  const ctx = _context();
  if (!ctx) return false;
  if (ctx.state !== "running") {
    try { await ctx.resume(); } catch (_) { /* ignore */ }
  }
  return ctx.state === "running";
}

export function mixAvailable() {
  const ctx = _context();
  return !!ctx && ctx.state === "running";
}

/**
 * The recorder's audio track: the microphone mixed with everything mirrored
 * onto the bus. `micTrack` is the recorder's OWN clone (we never touch the
 * interview's microphone). Returns null when the bus cannot run — the caller
 * records the bare microphone, exactly as before this module existed.
 */
export function mixedRecorderTrack(micTrack) {
  const ctx = _context();
  if (!ctx || ctx.state !== "running" || !_bus) return null;
  let micSource = null;
  try {
    if (micTrack) {
      micSource = ctx.createMediaStreamSource(new MediaStream([micTrack]));
      micSource.connect(_bus);
    }
  } catch (_) {
    return null;
  }
  const track = _bus.stream.getAudioTracks()[0];
  if (!track) {
    try { micSource && micSource.disconnect(); } catch (_) { /* ignore */ }
    return null;
  }
  return {
    track,
    release() {
      try { micSource && micSource.disconnect(); } catch (_) { /* ignore */ }
    },
  };
}

/**
 * Play a clip into the bus only, in step with an element the candidate is
 * already hearing. `elapsedSeconds()` reports how far that element has got,
 * so a decode that takes a moment starts at the right offset instead of
 * lagging. Returns a handle whose `stop()` ends the mirror (a cancelled
 * question must not keep "speaking" into the recording).
 *
 * Never throws and never blocks the caller — the clip is decoded in the
 * background and simply not mirrored when anything fails.
 */
export function mirrorClipToRecording(blobPromise, elapsedSeconds) {
  const handle = { stopped: false, source: null, stop() { this.stopped = true; try { this.source && this.source.stop(); } catch (_) { /* ignore */ } } };
  const ctx = _context();
  if (!ctx || !_bus) return handle;
  (async () => {
    try {
      if (ctx.state !== "running") {
        try { await ctx.resume(); } catch (_) { /* ignore */ }
      }
      if (ctx.state !== "running") return;
      const blob = await blobPromise;
      if (!blob || !blob.size || handle.stopped) return;
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
      if (handle.stopped) return;
      const elapsed = typeof elapsedSeconds === "function" ? Number(elapsedSeconds()) || 0 : 0;
      const offset = Math.max(0, Math.min(buffer.duration, elapsed));
      if (offset >= buffer.duration) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(_bus);
      source.start(0, offset);
      handle.source = source;
    } catch (err) {
      try { console.warn("[recording-mix] question clip not mirrored:", err?.message || err); } catch (_) { /* ignore */ }
    }
  })();
  return handle;
}

/**
 * Live voice (9 Oct 2026): mirror a whole MediaStream — the realtime
 * interviewer's voice arriving over WebRTC — onto the recording bus. The
 * candidate still hears it through its own <audio> element (Chrome needs that
 * element for remote WebRTC audio to flow into Web Audio at all). Returns a
 * handle whose `release()` disconnects it; never throws.
 */
export function mirrorStreamToRecording(stream) {
  const handle = { release() {} };
  const ctx = _context();
  if (!ctx || !_bus || !stream || !stream.getAudioTracks || !stream.getAudioTracks().length) return handle;
  try {
    const source = ctx.createMediaStreamSource(stream);
    source.connect(_bus);
    handle.release = () => { try { source.disconnect(); } catch (_) { /* ignore */ } };
  } catch (err) {
    try { console.warn("[recording-mix] live voice not mirrored:", err?.message || err); } catch (_) { /* ignore */ }
  }
  return handle;
}
