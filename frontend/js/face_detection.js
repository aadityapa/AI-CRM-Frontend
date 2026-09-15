/**
 * Multi-face monitoring during live interviews.
 * Uses the browser FaceDetector API when available, otherwise MediaPipe Tasks Vision.
 */

import { reportSecurityViolation } from "./interview_security.js";

const SCAN_INTERVAL_MS = 2000;
const VIOLATION_DEBOUNCE_MS = 4500;
const MIN_FACES_FOR_VIOLATION = 2;
const MEDIAPIPE_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/+esm";
const MEDIAPIPE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

let monitoringActive = false;
let scanTimer = null;
let lastViolationAt = 0;
let getVideoElement = null;
let detectorMode = "";
let nativeDetector = null;
let mediapipeDetector = null;
let mediapipeLoadPromise = null;
let scanInFlight = false;

function resolveVideo() {
  try {
    return typeof getVideoElement === "function" ? getVideoElement() : null;
  } catch (_) {
    return null;
  }
}

function videoReady(video) {
  if (!video) return false;
  if (!video.srcObject) return false;
  const track = video.srcObject.getVideoTracks?.()[0];
  if (!track || track.readyState === "ended") return false;
  return video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
}

async function ensureNativeDetector() {
  if (nativeDetector) return true;
  if (typeof window.FaceDetector !== "function") return false;
  try {
    nativeDetector = new window.FaceDetector({
      fastMode: true,
      maxDetectedFaces: 6,
    });
    detectorMode = "native";
    return true;
  } catch (_) {
    nativeDetector = null;
    return false;
  }
}

async function ensureMediapipeDetector() {
  if (mediapipeDetector) return true;
  if (!mediapipeLoadPromise) {
    mediapipeLoadPromise = (async () => {
      const vision = await import(/* @vite-ignore */ MEDIAPIPE_CDN);
      const resolver = await vision.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm"
      );
      mediapipeDetector = await vision.FaceDetector.createFromOptions(resolver, {
        baseOptions: {
          modelAssetPath: MEDIAPIPE_MODEL,
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        minDetectionConfidence: 0.55,
      });
      detectorMode = "mediapipe";
      return true;
    })().catch(() => {
      mediapipeLoadPromise = null;
      mediapipeDetector = null;
      return false;
    });
  }
  return mediapipeLoadPromise;
}

async function ensureDetector() {
  if (nativeDetector || mediapipeDetector) return true;
  if (await ensureNativeDetector()) return true;
  return ensureMediapipeDetector();
}

async function countFaces(video) {
  if (!(await ensureDetector())) return 0;
  if (nativeDetector) {
    const faces = await nativeDetector.detect(video);
    return Array.isArray(faces) ? faces.length : 0;
  }
  if (mediapipeDetector) {
    const result = mediapipeDetector.detectForVideo(video, performance.now());
    return Array.isArray(result?.detections) ? result.detections.length : 0;
  }
  return 0;
}

/* Evidence (15 Sep 2026): a small JPEG of the camera frame travels with every
 * camera event so the Integrity tab can show WHAT the detector saw, not only
 * that it fired. 320px wide, ~15–30 KB. */
const EVIDENCE_WIDTH = 320;
let _evidenceCanvas = null;

async function captureEvidence(video) {
  try {
    if (!videoReady(video)) return null;
    if (!_evidenceCanvas) _evidenceCanvas = document.createElement("canvas");
    const scale = EVIDENCE_WIDTH / video.videoWidth;
    _evidenceCanvas.width = EVIDENCE_WIDTH;
    _evidenceCanvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = _evidenceCanvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, _evidenceCanvas.width, _evidenceCanvas.height);
    return await new Promise((resolve) => _evidenceCanvas.toBlob(resolve, "image/jpeg", 0.6));
  } catch (_) {
    return null;
  }
}

/* "No face" is informational: three consecutive empty scans (~6 s) log one
 * event, then at most one more every NO_FACE_INTERVAL_MS. Never a strike. */
const NO_FACE_SCANS = 3;
const NO_FACE_INTERVAL_MS = 30000;
let _noFaceStreak = 0;
let _lastNoFaceAt = 0;

async function scanOnce() {
  if (!monitoringActive || scanInFlight) return;
  const video = resolveVideo();
  if (!videoReady(video)) return;
  scanInFlight = true;
  try {
    const faceCount = await countFaces(video);
    if (faceCount === 0) {
      _noFaceStreak += 1;
      const now = Date.now();
      if (_noFaceStreak >= NO_FACE_SCANS && now - _lastNoFaceAt >= NO_FACE_INTERVAL_MS) {
        _lastNoFaceAt = now;
        const evidence = await captureEvidence(video);
        reportSecurityViolation("no_face", `No face detected for ${_noFaceStreak} scans`, { evidence });
      }
      return;
    }
    _noFaceStreak = 0;
    if (faceCount < MIN_FACES_FOR_VIOLATION) return;
    const now = Date.now();
    if (now - lastViolationAt < VIOLATION_DEBOUNCE_MS) return;
    lastViolationAt = now;
    const evidence = await captureEvidence(video);
    reportSecurityViolation(
      "multiple_faces",
      `${faceCount} faces detected via ${detectorMode || "unknown"}`,
      { evidence }
    );
  } catch (err) {
    try {
      console.warn("[face-detection] scan failed", err);
    } catch (_) {
      /* ignore */
    }
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
  lastViolationAt = 0;
  void ensureDetector().catch(() => {
    /* detector loads lazily on first successful scan */
  });
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
}

export function isFaceMonitoringActive() {
  return monitoringActive;
}
