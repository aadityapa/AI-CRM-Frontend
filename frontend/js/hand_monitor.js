/**
 * The hand detector for the gesture checks (13 Nov 2026).
 *
 * MediaPipe HAND LANDMARKER (21 points per hand, two hands), self-hosted under
 * /vendor/mediapipe like the face model. It runs ONLY while a gesture is being
 * asked for — never all interview long — so the laptop is not loaded with a
 * second model next to the face monitor and the recording.
 *
 * The decisions (which gesture, held long enough) live in
 * `proctoring_logic.js`; this module only turns a video frame into landmarks.
 */
import { LOCAL_BASE, loadVision, modelBytes } from "./mediapipe_loader.js";

const MODEL_URLS = [
  `${LOCAL_BASE}/hand_landmarker.task`,
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
];

let _landmarker = null;
let _loading = null;
let _lastTime = -1;
let _lastError = "";

async function _create() {
  const { vision, fileset } = await loadVision();
  const modelAssetBuffer = await modelBytes(MODEL_URLS);
  let lastErr = null;
  for (const delegate of ["GPU", "CPU"]) {
    try {
      return await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer, delegate },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("HandLandmarker could not start");
}

/** Load the model (once). Resolves true when the detector can run. */
export function loadHandMonitor() {
  if (_landmarker) return Promise.resolve(true);
  if (!_loading) {
    _loading = _create()
      .then((lm) => {
        _landmarker = lm;
        return true;
      })
      .catch((err) => {
        _lastError = String(err && err.message ? err.message : err).slice(0, 160);
        console.warn("[hand-monitor] unavailable", err);
        _loading = null;
        return false;
      });
  }
  return _loading;
}

export function handMonitorError() {
  return _lastError;
}

/**
 * The hands on one frame: an array of landmark arrays (one per hand), [] when
 * none or the frame did not change, null when the detector cannot run.
 */
export async function detectHands(video) {
  if (!video || video.readyState < 2 || !video.videoWidth) return [];
  const ok = await loadHandMonitor();
  if (!ok || !_landmarker) return null;
  if (video.currentTime === _lastTime) return [];
  _lastTime = video.currentTime;
  try {
    const res = _landmarker.detectForVideo(video, performance.now());
    return Array.isArray(res?.landmarks) ? res.landmarks : [];
  } catch (err) {
    console.warn("[hand-monitor] detection failed", err);
    return [];
  }
}
