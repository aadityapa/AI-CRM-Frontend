/**
 * Loading MediaPipe Tasks Vision — shared by the face monitor
 * (`face_detection.js`) and the hand monitor (`hand_monitor.js`, 13 Nov 2026).
 *
 * The code, the SIMD WebAssembly and the models are self-hosted under
 * /vendor/mediapipe (see its README); jsDelivr and Google storage are the
 * fallbacks. One import of the bundle and one fileset serve both tasks.
 */

export const MP_VERSION = "0.10.20";
export const LOCAL_BASE = "/vendor/mediapipe";
export const CDN_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;

let _visionPromise = null;

async function _importVision() {
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

async function _fileset(vision, base) {
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

/** `{ vision, fileset }` — loaded once per page. A failure is retried next call. */
export function loadVision() {
  if (!_visionPromise) {
    _visionPromise = (async () => {
      const { vision, base } = await _importVision();
      const fileset = await _fileset(vision, base);
      return { vision, fileset };
    })().catch((err) => {
      _visionPromise = null;
      throw err;
    });
  }
  return _visionPromise;
}

/** The first model of `urls` that downloads in full. */
export async function modelBytes(urls, minBytes = 100000) {
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "force-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > minBytes) return buf;
      throw new Error(`model at ${url} is too small (${buf.length} bytes)`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("model unavailable");
}
