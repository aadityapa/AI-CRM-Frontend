/**
 * Whole-session interview recording (22 Sep 2026).
 * ================================================
 *
 * Records the candidate's camera and microphone for the entire interview and
 * uploads it in slices while the interview runs. HR watches it from the
 * Integrity tab LIVE (each slice is playable the moment it lands, so the
 * viewer runs about one slice behind) and replays it afterwards. It replaced
 * the per-event camera snapshots on 23 Sep 2026 — this is the one record.
 *
 * Why chunks and not one upload at the end
 * ----------------------------------------
 * The interviews worth watching are the ones that ended badly: a crash, a
 * closed laptop, a dropped connection, a termination. A single upload on
 * completion would lose the recording of every one of those. Each chunk is
 * POSTed as it is produced, so a session that dies mid-way still leaves
 * everything up to that moment, and the server joins whatever arrived.
 *
 * Why it can never break the interview
 * ------------------------------------
 * Every failure path here is swallowed and logged. A camera that disappears,
 * a MediaRecorder the browser will not give us, an upload that 500s — none of
 * them may interrupt a candidate mid-answer. Recording is evidence; the
 * interview is the product. `start()` resolves either way and the caller does
 * not branch on it.
 *
 * Size
 * ----
 * The server decides the resolution/bitrate (`GET /interview/recording-config`)
 * so it can be tuned per deployment. The defaults target ~22 MB for a
 * 45-minute interview: 320x240 at 6 fps, VP8 at ~52 kbps plus mono Opus at
 * ~12 kbps. That is a proctoring record, not a portrait — enough to see who
 * is there and whether they are alone.
 */

import { apiFetch } from "./core.js";

/** Ordered by preference; the first the browser supports wins. */
const MIME_CANDIDATES = [
  'video/webm;codecs="vp8,opus"',
  "video/webm;codecs=vp8",
  "video/webm",
];

const DEFAULTS = {
  enabled: true,
  chunk_seconds: 15,
  video_width: 320,
  video_height: 240,
  frame_rate: 6,
  video_bps: 52000,
  audio_bps: 12000,
  max_chunk_bytes: 4 * 1024 * 1024,
};

let _config = null;
let _recorder = null;
let _stream = null;
/** Streams we opened ourselves and must therefore stop ourselves. */
let _ownsStream = false;
let _seq = 0;
let _active = false;
let _startedAt = 0;
let _uploadChain = Promise.resolve();
let _failedChunks = 0;

function _log(event, detail) {
  try {
    console.info(`[RECORDER] ${event}`, detail || {});
  } catch (_) {
    /* ignore */
  }
}

function _warn(event, detail) {
  try {
    console.warn(`[RECORDER] ${event}`, detail || {});
  } catch (_) {
    /* ignore */
  }
}

function _pickMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const candidate of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch (_) {
      /* some browsers throw on odd strings */
    }
  }
  return "";
}

/** Server-side recording settings, fetched once per page load. */
export async function loadRecordingConfig() {
  if (_config) return _config;
  try {
    const res = await apiFetch("/interview/recording-config", { method: "GET" }, { timeoutMs: 8000 });
    if (res.ok) {
      const data = await res.json();
      _config = { ...DEFAULTS, ...(data || {}) };
      return _config;
    }
  } catch (_) {
    /* fall through to defaults */
  }
  _config = { ...DEFAULTS };
  return _config;
}

/**
 * Upload one chunk. Serialised through `_uploadChain` so the slices reach the
 * server in order and a slow network cannot open dozens of parallel requests
 * on a machine that is already busy running the interview.
 */
function _queueUpload(blob, seq) {
  _uploadChain = _uploadChain
    .then(async () => {
      if (!blob || !blob.size) return;
      if (_config && blob.size > _config.max_chunk_bytes) {
        _warn("chunk_oversized_dropped", { seq, bytes: blob.size });
        return;
      }
      const form = new FormData();
      form.append("seq", String(seq));
      form.append("chunk", blob, `${String(seq).padStart(6, "0")}.webm`);
      const res = await apiFetch("/interview/recording/chunk", { method: "POST", body: form }, { timeoutMs: 30000 });
      if (!res.ok) throw new Error(`chunk upload ${res.status}`);
    })
    .catch((err) => {
      // One lost slice is a small gap in the recording, nothing more. Never
      // let it reject the chain, or every later chunk is skipped too.
      _failedChunks += 1;
      _warn("chunk_upload_failed", { seq, error: String((err && err.message) || err) });
    });
  return _uploadChain;
}

/** How long to wait for the interview's own camera stream before giving up. */
const STREAM_WAIT_MS = 30000;
const STREAM_POLL_MS = 500;

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function _hasLiveVideo(stream) {
  return !!(stream && stream.active && stream.getVideoTracks().some((t) => t.readyState === "live"));
}

/**
 * Wait for the interview's camera stream to exist. `initProctoring` is
 * fire-and-forget from app.js, so at the moment we are called the candidate
 * feed is usually still opening — polling for it is what lets us share it.
 */
async function _awaitStream(provider) {
  const deadline = Date.now() + STREAM_WAIT_MS;
  while (Date.now() < deadline) {
    let stream = null;
    try {
      stream = typeof provider === "function" ? provider() : provider;
    } catch (_) {
      stream = null;
    }
    if (_hasLiveVideo(stream)) return stream;
    await _sleep(STREAM_POLL_MS);
  }
  return null;
}

/**
 * Build the recorder's stream by CLONING the interview's tracks.
 *
 * ⚠️ Never open the camera a second time while the candidate feed holds it
 * (23 Sep 2026). A second `getUserMedia` on the same webcam with different
 * constraints makes many Windows camera drivers reconfigure the device for the
 * newest caller — the FIRST consumer freezes or goes black. That was the
 * report: a black Candidate Feed the moment recording started. A cloned track
 * shares the one capture, and `applyConstraints` on the clone downscales it
 * for the recorder without touching what the feed shows.
 */
async function _cloneTracks(videoSource, audioSource, cfg) {
  const tracks = [];
  const video = videoSource.getVideoTracks().find((t) => t.readyState === "live");
  if (!video) return null;
  const videoClone = video.clone();
  try {
    await videoClone.applyConstraints({
      width: { ideal: cfg.video_width },
      height: { ideal: cfg.video_height },
      frameRate: { ideal: cfg.frame_rate, max: cfg.frame_rate },
    });
  } catch (_) {
    // Downscaling is a size optimisation, not a requirement — the bitrate cap
    // still bounds the file. Record the clone as-is.
  }
  tracks.push(videoClone);
  const audio = audioSource && audioSource.getAudioTracks
    ? audioSource.getAudioTracks().find((t) => t.readyState === "live")
    : null;
  if (audio) tracks.push(audio.clone());
  return new MediaStream(tracks);
}

/**
 * Begin recording.
 *
 * @param {MediaStream|(() => MediaStream|null)|null} videoSource the
 *        interview's camera stream, or a getter for it (preferred — the feed
 *        is usually still opening when we are called). Its tracks are CLONED;
 *        the source is never stopped by us.
 * @param {MediaStream|(() => MediaStream|null)|null} audioSource where the
 *        microphone lives when it is not on the video stream (the Device
 *        Check's verified mic). Same cloning rule.
 * @returns {Promise<boolean>} whether recording actually started. Callers may
 *        ignore it — nothing downstream depends on recording succeeding.
 */
export async function startSessionRecording(videoSource = null, audioSource = null) {
  if (_active) return true;
  const cfg = await loadRecordingConfig();
  if (!cfg.enabled) {
    _log("disabled_by_server");
    return false;
  }
  const mimeType = _pickMimeType();
  if (!mimeType) {
    _warn("mediarecorder_unsupported");
    return false;
  }

  try {
    const source = videoSource ? await _awaitStream(videoSource) : null;
    if (source) {
      let audio = null;
      try {
        audio = typeof audioSource === "function" ? audioSource() : audioSource;
      } catch (_) {
        audio = null;
      }
      _stream = await _cloneTracks(source, audio || source, cfg);
      // Clones are ours to stop; stopping a clone never affects the original.
      _ownsStream = true;
      if (!_stream) {
        _warn("no_live_video_track");
        return false;
      }
    } else {
      // No interview camera at all (HR-run session without video, or the
      // feed never opened). Only THEN is it safe to open the device ourselves.
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        _warn("no_media_devices");
        return false;
      }
      _log("opening_own_stream", { reason: videoSource ? "feed_not_ready" : "no_source" });
      _stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: cfg.video_width },
          height: { ideal: cfg.video_height },
          frameRate: { ideal: cfg.frame_rate, max: cfg.frame_rate },
          facingMode: { ideal: "user" },
        },
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      _ownsStream = true;
    }
  } catch (err) {
    _warn("stream_unavailable", { error: String((err && err.name) || err) });
    return false;
  }

  try {
    _recorder = new MediaRecorder(_stream, {
      mimeType,
      videoBitsPerSecond: cfg.video_bps,
      audioBitsPerSecond: cfg.audio_bps,
    });
  } catch (err) {
    _warn("recorder_construct_failed", { error: String((err && err.message) || err) });
    _releaseStream();
    return false;
  }

  _seq = 0;
  _failedChunks = 0;
  _recorder.ondataavailable = (event) => {
    if (!event || !event.data || !event.data.size) return;
    _queueUpload(event.data, _seq++);
  };
  _recorder.onerror = (event) => {
    _warn("recorder_error", { error: String((event && event.error && event.error.name) || "unknown") });
  };

  try {
    // `timeslice` makes the browser emit a chunk on a fixed cadence instead of
    // one blob at stop() — the whole reason a crash is survivable.
    _recorder.start(Math.max(5, Number(cfg.chunk_seconds) || 15) * 1000);
  } catch (err) {
    _warn("recorder_start_failed", { error: String((err && err.message) || err) });
    _releaseStream();
    return false;
  }

  _active = true;
  _startedAt = Date.now();
  _log("started", { mimeType, width: cfg.video_width, fps: cfg.frame_rate });
  return true;
}

function _releaseStream() {
  try {
    if (_ownsStream && _stream) {
      _stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (_) {
          /* ignore */
        }
      });
    }
  } catch (_) {
    /* ignore */
  }
  _stream = null;
  _ownsStream = false;
  _recorder = null;
}

/**
 * Stop recording, flush the last slice and tell the server to join the parts.
 *
 * Safe to call more than once and from any teardown path (normal submit, timer
 * expiry, proctor termination) — the second call is a no-op.
 */
export async function stopSessionRecording({ finalize = true } = {}) {
  if (!_active) {
    return { recorded: false };
  }
  _active = false;
  const durationMs = Date.now() - _startedAt;

  await new Promise((resolve) => {
    if (!_recorder || _recorder.state === "inactive") {
      resolve();
      return;
    }
    // `onstop` fires after the final ondataavailable, so waiting for it is
    // what guarantees the last slice is queued before we finalize.
    const done = () => resolve();
    try {
      _recorder.onstop = done;
      _recorder.stop();
      // Belt and braces: a recorder that never fires onstop must not hang the
      // submit path behind it.
      setTimeout(done, 4000);
    } catch (_) {
      resolve();
    }
  });

  _releaseStream();

  try {
    await _uploadChain;
  } catch (_) {
    /* the chain never rejects, but be explicit */
  }

  if (!finalize) {
    return { recorded: true, chunks: _seq, failed: _failedChunks, durationMs };
  }

  try {
    await apiFetch("/interview/recording/complete", { method: "POST" }, { timeoutMs: 30000 });
    _log("finalized", { chunks: _seq, failed: _failedChunks, durationMs });
  } catch (err) {
    // The server also finalizes from the submit path and on demand when the
    // Integrity tab opens, so a missed call here costs nothing.
    _warn("finalize_call_failed", { error: String((err && err.message) || err) });
  }
  return { recorded: true, chunks: _seq, failed: _failedChunks, durationMs };
}

/** True while a recording is in progress. */
export function isSessionRecording() {
  return _active;
}
