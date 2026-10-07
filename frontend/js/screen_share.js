/**
 * Screen share for the session recording (7 Oct 2026).
 * ====================================================
 *
 * The camera recording shows the candidate; it does not show what was on
 * their screen — which question was up, what the timer said, whether the
 * transcript matched. So the Device Check also asks the candidate to share
 * their screen, and `session_recorder.js` records that stream as a second,
 * independent track ("screen") beside the camera ("cam"). The reviewer plays
 * the two side by side.
 *
 * Rules
 * -----
 * - `getDisplayMedia` needs a user gesture, so `requestScreenShare()` is only
 *   ever called from the Device Check's button; the stream is kept here until
 *   the recorder picks it up at STEP-8 (`getScreenStream()`).
 * - Browsers without `getDisplayMedia` (every mobile browser) simply have no
 *   screen stream; the camera recording is unaffected. Nothing here can block
 *   or break the interview.
 * - If the candidate stops sharing mid-interview (the browser's own "Stop
 *   sharing" control), `onScreenShareEnded` tells the recorder, which logs an
 *   informational integrity event and keeps recording the camera.
 */

let _stream = null;
const _endedListeners = new Set();

/** Whether this browser can share its screen at all. */
export function isScreenShareSupported() {
  try {
    return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function");
  } catch (_) {
    return false;
  }
}

function _liveVideoTrack(stream) {
  try {
    return stream ? stream.getVideoTracks().find((t) => t.readyState === "live") || null : null;
  } catch (_) {
    return null;
  }
}

/** The shared screen stream while it is live, else null. */
export function getScreenStream() {
  return _liveVideoTrack(_stream) ? _stream : null;
}

/** `track.getSettings().displaySurface` of the share ("browser" = this tab, "monitor", "window"). */
export function getScreenSurface() {
  const track = _liveVideoTrack(_stream);
  try {
    return String((track && track.getSettings && track.getSettings().displaySurface) || "");
  } catch (_) {
    return "";
  }
}

/**
 * Ask the candidate to share their screen. MUST run inside a click handler.
 * Resolves `{ ok, reason, surface }` — never rejects.
 */
export async function requestScreenShare() {
  if (!isScreenShareSupported()) return { ok: false, reason: "unsupported" };
  releaseScreenShare();
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 4, max: 8 } },
      audio: false,
      // Chrome: offer THIS tab first — the interview page is what we want on
      // record — but any surface the candidate picks is accepted.
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      surfaceSwitching: "exclude",
      systemAudio: "exclude",
    });
    const track = _liveVideoTrack(stream);
    if (!track) {
      try { stream.getTracks().forEach((t) => t.stop()); } catch (_) { /* ignore */ }
      return { ok: false, reason: "no_track" };
    }
    _stream = stream;
    track.addEventListener("ended", () => {
      if (_stream !== stream) return;
      _stream = null;
      _endedListeners.forEach((cb) => {
        try { cb(); } catch (_) { /* ignore */ }
      });
    });
    return { ok: true, reason: "", surface: getScreenSurface() };
  } catch (err) {
    const name = String((err && err.name) || "");
    return { ok: false, reason: name === "NotAllowedError" ? "denied" : name || "error" };
  }
}

/** Called once when the candidate stops sharing (browser control or OS). */
export function onScreenShareEnded(cb) {
  if (typeof cb === "function") _endedListeners.add(cb);
  return () => _endedListeners.delete(cb);
}

/** Stop sharing (interview over). Safe to call when nothing is shared. */
export function releaseScreenShare() {
  const stream = _stream;
  _stream = null;
  if (!stream) return;
  try {
    stream.getTracks().forEach((t) => {
      try { t.stop(); } catch (_) { /* ignore */ }
    });
  } catch (_) {
    /* ignore */
  }
}
