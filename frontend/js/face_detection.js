/**
 * Camera monitor during live interviews — extra faces + looking away.
 *
 * Rewritten 13 Oct 2026. The old version never caught a second person:
 *  - Chrome on Windows has no built-in `FaceDetector` (it is behind a flag),
 *  - the MediaPipe fallback fetched its model from storage.googleapis.com,
 *    which the page's Content-Security-Policy did not allow, and
 *  - the policy had no 'wasm-unsafe-eval', so MediaPipe's WebAssembly could
 *    not compile anyway. Every failure was swallowed.
 *
 * Now: the MediaPipe FACE LANDMARKER (478 points + eye blendshapes, up to four
 * faces) is self-hosted under /vendor/mediapipe (jsDelivr / Google storage are
 * fallbacks), the server's CSP allows WebAssembly, and the decisions live in
 * `camera_monitor_logic.js` (pure, unit-tested):
 *   - a second face → `multiple_faces` (a strike — the usual warning modal),
 *   - looking away for 3 s → `gaze_away` (a soft notice; the 10th ends the
 *     interview — the server decides, `services/interview_integrity.py`).
 * If nothing can load, ONE informational `camera_monitor_unavailable` event
 * says so on the Integrity tab instead of failing in silence.
 */

import { reportGazeAway, reportSecurityViolation } from "./interview_security.js";
import { isTypedQuestionOpen } from "./skill_bank.js";
import { state } from "./state.js";
import { CameraMonitorLogic, faceMetrics } from "./camera_monitor_logic.js";

const MP_VERSION = "0.10.20";
const LOCAL_BASE = "/vendor/mediapipe";
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URLS = [
  `${LOCAL_BASE}/face_landmarker.task`,
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
];
const SCAN_INTERVAL_MS = 400;
const MAX_FACES = 4;

let monitoringActive = false;
let scanTimer = null;
let getVideoElement = null;
let scanInFlight = false;
let logic = null;
let landmarker = null;
let nativeDetector = null;
let detectorMode = "";
let loadPromise = null;
let unavailableReported = false;
let loadError = "";
let lastVideoTime = -1;
let lastFaces = [];
let scans = 0;

function resolveVideo() {
  try {
    return typeof getVideoElement === "function" ? getVideoElement() : null;
  } catch (_) {
    return null;
  }
}

function videoReady(video) {
  if (!video || !video.srcObject) return false;
  const track = video.srcObject.getVideoTracks?.()[0];
  if (!track || track.readyState === "ended") return false;
  return video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
}

async function importVision() {
  let lastErr = null;
  for (const base of [LOCAL_BASE, CDN_BASE]) {
    try {
      const vision = await import(/* @vite-ignore */ `${base}/vision_bundle.mjs`);
      return { vision, base };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("MediaPipe could not be loaded");
}

async function wasmFileset(vision, base) {
  let simd = true;
  try {
    simd = await vision.FilesetResolver.isSimdSupported();
  } catch (_) {
    simd = true;
  }
  if (base === LOCAL_BASE && simd) {
    return {
      wasmLoaderPath: `${LOCAL_BASE}/wasm/vision_wasm_internal.js`,
      wasmBinaryPath: `${LOCAL_BASE}/wasm/vision_wasm_internal.wasm`,
    };
  }
  // Only the SIMD build is self-hosted; anything else comes from jsDelivr.
  return vision.FilesetResolver.forVisionTasks(`${CDN_BASE}/wasm`);
}

async function modelBytes() {
  let lastErr = null;
  for (const url of MODEL_URLS) {
    try {
      const res = await fetch(url, { cache: "force-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > 100000) return buf;
      throw new Error(`model at ${url} is too small (${buf.length} bytes)`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("face model unavailable");
}

async function createLandmarker() {
  const { vision, base } = await importVision();
  const fileset = await wasmFileset(vision, base);
  const modelAssetBuffer = await modelBytes();
  let lastErr = null;
  for (const delegate of ["GPU", "CPU"]) {
    try {
      const lm = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer, delegate },
        runningMode: "VIDEO",
        numFaces: MAX_FACES,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
      });
      detectorMode = `landmarker-${delegate.toLowerCase()}`;
      return lm;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("FaceLandmarker could not start");
}

function createNativeDetector() {
  if (typeof window.FaceDetector !== "function") return null;
  try {
    const det = new window.FaceDetector({ fastMode: true, maxDetectedFaces: MAX_FACES });
    detectorMode = "native";
    return det;
  } catch (_) {
    return null;
  }
}

function ensureDetector() {
  if (landmarker || nativeDetector) return Promise.resolve(true);
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        landmarker = await createLandmarker();
        console.info("[camera-monitor] face landmarker ready", detectorMode);
        return true;
      } catch (err) {
        console.warn("[camera-monitor] face landmarker unavailable", err);
        nativeDetector = createNativeDetector();
        if (nativeDetector) {
          console.info("[camera-monitor] using the browser FaceDetector (face count only)");
          return true;
        }
        loadError = String(err && err.message ? err.message : err).slice(0, 160);
        return false;
      }
    })();
  }
  return loadPromise;
}

function landmarkerFaces(video) {
  // detectForVideo needs a strictly increasing timestamp and a new frame.
  if (video.currentTime === lastVideoTime) return null;
  lastVideoTime = video.currentTime;
  const res = landmarker.detectForVideo(video, performance.now());
  const all = Array.isArray(res?.faceLandmarks) ? res.faceLandmarks : [];
  const shapes = Array.isArray(res?.faceBlendshapes) ? res.faceBlendshapes : [];
  return all
    .map((lm, i) => faceMetrics(lm, shapes[i]?.categories, video.videoWidth, video.videoHeight))
    .filter(Boolean);
}

async function nativeFaces(video) {
  const faces = await nativeDetector.detect(video);
  const W = Math.max(1, video.videoWidth);
  return (Array.isArray(faces) ? faces : []).map((f) => ({
    width: (Number(f?.boundingBox?.width) || 0) / W,
    hasGaze: false,
  }));
}

async function scanOnce() {
  if (!monitoringActive || scanInFlight) return;
  const video = resolveVideo();
  if (!videoReady(video)) return;
  if (!(landmarker || nativeDetector)) {
    const ok = await ensureDetector();
    // Said once, while the interview runs (a preload on the Device Check is
    // too early — nothing is being recorded yet).
    if (!ok && !unavailableReported && monitoringActive) {
      unavailableReported = true;
      reportSecurityViolation("camera_monitor_unavailable", `Face / eye monitor could not start: ${loadError || "unknown error"}`);
    }
    return;
  }
  scanInFlight = true;
  try {
    const faces = landmarker ? landmarkerFaces(video) : await nativeFaces(video);
    if (faces === null) return; // same frame as last time
    lastFaces = faces;
    scans += 1;
    const events = logic.step(Date.now(), faces, {
      paused: !!state.liveHold,
      typed: isTypedQuestionOpen(),
    });
    for (const ev of events) {
      if (ev.type === "gaze_away") reportGazeAway(ev.details);
      else reportSecurityViolation(ev.type, `${ev.details} (${detectorMode || "monitor"})`);
    }
  } catch (err) {
    console.warn("[camera-monitor] scan failed", err);
  } finally {
    scanInFlight = false;
  }
}

function scheduleScan() {
  if (!monitoringActive) return;
  scanTimer = window.setTimeout(async () => {
    await scanOnce();
    scheduleScan();
  }, SCAN_INTERVAL_MS);
}

export function startFaceMonitoring(videoResolver) {
  if (monitoringActive) return;
  getVideoElement = typeof videoResolver === "function" ? videoResolver : () => videoResolver;
  monitoringActive = true;
  logic = new CameraMonitorLogic({}, Date.now());
  lastVideoTime = -1;
  void ensureDetector();
  scheduleScan();
}

export function stopFaceMonitoring() {
  monitoringActive = false;
  if (scanTimer) {
    window.clearTimeout(scanTimer);
    scanTimer = null;
  }
  getVideoElement = null;
  scanInFlight = false;
  logic = null;
}

export function isFaceMonitoringActive() {
  return monitoringActive;
}

/** Load the model early (e.g. on the Device Check) so the first scans are not lost. */
export function preloadFaceMonitor() {
  return ensureDetector();
}

/** What the monitor is doing right now — for support / a console check. */
export function cameraMonitorStatus() {
  return {
    active: monitoringActive,
    mode: detectorMode || (loadPromise ? "loading" : "idle"),
    scans,
    faces: lastFaces.length,
    largest_face_width: lastFaces.length ? Math.max(...lastFaces.map((f) => Number(f.width) || 0)) : 0,
    baseline_learnt: !!(logic && logic.base),
    // The largest face's numbers (rounded) — what the look-away rule judges.
    face: lastFaces.length
      ? Object.fromEntries(
        ["yaw", "pitch", "eyeSide", "eyeDown"].map((k) => {
          const f = lastFaces.reduce((a, b) => ((Number(b.width) || 0) > (Number(a.width) || 0) ? b : a));
          return [k, Number.isFinite(f[k]) ? Math.round(f[k] * 1000) / 1000 : null];
        }),
      )
      : null,
  };
}
