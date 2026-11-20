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
import { LOCAL_BASE, loadVision, modelBytes as fetchModel } from "./mediapipe_loader.js";
import { LightMonitor, ReadingDetector, lightingVerdict, meanLuma } from "./proctoring_logic.js";

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

/* 13 Nov 2026 — the template's anti-cheating checks ride on the same scans. */
let proctorOpts = { lighting: "off", reading: false };
let gazeCalibration = null;
let lightMonitor = null;
let readingDetector = null;
let lastLightAt = 0;
let lumaCanvas = null;
const LIGHT_EVERY_MS = 2000;
const LUMA_W = 96;
const LUMA_H = 72;

/**
 * The template's switches for the monitors (lighting during the interview,
 * reading detection). Set before `startFaceMonitoring`.
 */
export function setMonitorOptions({ lighting = "off", reading = false } = {}) {
  proctorOpts = { lighting: String(lighting || "off"), reading: !!reading };
}

/**
 * The candidate's own "on the screen" range from the eye calibration
 * (proctoring_logic.calibrate). The look-away rule uses it instead of learning
 * a baseline from the first scans.
 */
export function setGazeCalibration(cal) {
  gazeCalibration = cal && cal.base && cal.cfg ? cal : null;
}

/** Mean brightness of the face and of the whole frame (0–255). */
export function measureLight(video, face) {
  try {
    if (!lumaCanvas) {
      lumaCanvas = document.createElement("canvas");
      lumaCanvas.width = LUMA_W;
      lumaCanvas.height = LUMA_H;
    }
    const ctx = lumaCanvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, LUMA_W, LUMA_H);
    const img = ctx.getImageData(0, 0, LUMA_W, LUMA_H).data;
    const frame = meanLuma(img, LUMA_W, LUMA_H);
    let faceLuma = null;
    if (face && face.box) {
      const box = { x: face.box.x * LUMA_W, y: face.box.y * LUMA_H, w: face.box.w * LUMA_W, h: face.box.h * LUMA_H };
      if (box.w >= 2 && box.h >= 2) faceLuma = meanLuma(img, LUMA_W, LUMA_H, box);
    }
    return { face: faceLuma, frame };
  } catch (_) {
    return null;
  }
}

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

async function createLandmarker() {
  const { vision, fileset } = await loadVision();
  const modelAssetBuffer = await fetchModel(MODEL_URLS);
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
    const now = Date.now();
    const paused = !!state.liveHold;
    const typed = isTypedQuestionOpen();
    const events = logic.step(now, faces, { paused, typed });
    const me = faces.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    // Lighting during the interview (13 Nov 2026) — every 2 s, soft flag.
    if (lightMonitor && !paused && now - lastLightAt >= LIGHT_EVERY_MS) {
      lastLightAt = now;
      const m = measureLight(video, me);
      if (m) {
        const ev = lightMonitor.feed(now, lightingVerdict(m));
        if (ev) events.push(ev);
      }
    }
    // Reading pattern (13 Nov 2026) — spoken answers only, against the baseline.
    if (readingDetector) {
      if (paused || typed || !me || !me.hasGaze || !logic.base || me.blink >= logic.cfg.blink) {
        if (paused || typed) readingDetector.reset();
      } else {
        const ev = readingDetector.feed(now, me.eyeSide - logic.base.eyeSide);
        if (ev) events.push(ev);
      }
    }
    for (const ev of events) {
      if (ev.type === "gaze_away") reportGazeAway(ev.details);
      else if (ev.type === "low_light") {
        reportSecurityViolation(ev.type, ev.details);
        _softNotice("Please improve your lighting", "Face a window or turn on a light — your face must be clearly visible.");
      } else reportSecurityViolation(ev.type, `${ev.details} (${detectorMode || "monitor"})`);
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
  logic = new CameraMonitorLogic(gazeCalibration ? gazeCalibration.cfg : {}, Date.now());
  if (gazeCalibration) logic.base = { ...gazeCalibration.base };
  lightMonitor = proctorOpts.lighting !== "off" ? new LightMonitor() : null;
  readingDetector = proctorOpts.reading ? new ReadingDetector() : null;
  lastLightAt = 0;
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
  lightMonitor = null;
  readingDetector = null;
}

export function isFaceMonitoringActive() {
  return monitoringActive;
}

/** Load the model early (e.g. on the Device Check) so the first scans are not lost. */
export function preloadFaceMonitor() {
  return ensureDetector();
}

/**
 * One detection on any video element, outside the interview (13 Nov 2026: the
 * lighting check and the eye calibration). Resolves to the faces' numbers
 * (largest first), [] when none, or null when the monitor cannot run.
 */
let oneShotLastTime = -1;
export async function detectFacesOnce(video) {
  if (!videoReady(video)) return [];
  const ok = await ensureDetector();
  if (!ok || !landmarker) return null;
  if (video.currentTime === oneShotLastTime) return [];
  oneShotLastTime = video.currentTime;
  try {
    const res = landmarker.detectForVideo(video, performance.now());
    const all = Array.isArray(res?.faceLandmarks) ? res.faceLandmarks : [];
    const shapes = Array.isArray(res?.faceBlendshapes) ? res.faceBlendshapes : [];
    return all
      .map((lm, i) => faceMetrics(lm, shapes[i]?.categories, video.videoWidth, video.videoHeight))
      .filter(Boolean)
      .sort((a, b) => b.width - a.width);
  } catch (err) {
    console.warn("[camera-monitor] one-shot detection failed", err);
    return [];
  }
}

let _noticeTimer = null;
function _softNotice(title, body) {
  let el = document.getElementById("kxSoftNotice");
  if (!el) {
    el = document.createElement("div");
    el.id = "kxSoftNotice";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.style.cssText = "position:fixed;top:72px;left:50%;transform:translateX(-50%);z-index:99989;"
      + "max-width:min(520px,calc(100vw - 32px));padding:12px 16px;border-radius:14px;background:#1e3a8a;color:#fff;"
      + "font:600 14px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 14px 40px rgba(15,23,42,.35);"
      + "transition:opacity .2s ease;opacity:0;pointer-events:none";
    const t = document.createElement("strong");
    t.id = "kxSoftNoticeTitle";
    const b = document.createElement("div");
    b.id = "kxSoftNoticeBody";
    b.style.cssText = "font-weight:500;font-size:13px;opacity:.92;margin-top:2px";
    el.append(t, b);
    document.body.appendChild(el);
  }
  el.querySelector("#kxSoftNoticeTitle").textContent = title;
  el.querySelector("#kxSoftNoticeBody").textContent = body;
  el.style.opacity = "1";
  if (_noticeTimer) window.clearTimeout(_noticeTimer);
  _noticeTimer = window.setTimeout(() => { el.style.opacity = "0"; }, 6000);
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
