/**
 * Silero VAD via @ricky0123/vad-web (WASM).
 * Human-speech detector — ignores keyboard clicks, fan/AC hum better than energy-only VAD.
 */

const VAD_WEB_VERSION = "0.0.22";
const ONNX_VERSION = "1.14.0";
export const SILERO_SPEECH_PROB_THRESHOLD = 0.8;

let _micVad = null;
let _speechActive = false;
let _lastSpeechProbability = 0;
let _initPromise = null;
let _callbacks = null;

function _assetPaths() {
  const onnxBase = (typeof window !== "undefined" && window.KARNEX_VAD_ONNX_BASE) || "";
  const vadBase = (typeof window !== "undefined" && window.KARNEX_VAD_ASSET_BASE) || "";
  if (onnxBase && vadBase) {
    return { onnxWASMBasePath: onnxBase, baseAssetPath: vadBase };
  }
  return {
    onnxWASMBasePath: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_VERSION}/dist/`,
    baseAssetPath: `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@${VAD_WEB_VERSION}/dist/`,
  };
}

async function _loadMicVadClass() {
  try {
    const mod = await import("@ricky0123/vad-web");
    return mod.MicVAD;
  } catch (_) {
    const mod = await import(
      /* webpackIgnore: true */
      `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@${VAD_WEB_VERSION}/dist/index.js`
    );
    return mod.MicVAD;
  }
}

export function isSileroSpeechActive() {
  return _speechActive;
}

export function getSileroSpeechProbability() {
  return _lastSpeechProbability;
}

export function sileroProbabilityAcceptable(threshold = SILERO_SPEECH_PROB_THRESHOLD) {
  return _lastSpeechProbability >= threshold || _speechActive;
}

export function sileroVadAvailable() {
  return typeof window !== "undefined" && !!(window.AudioContext || window.webkitAudioContext);
}

/**
 * @param {MediaStream} stream - live microphone stream (cloned track ok)
 * @param {{
 *   onSpeechStart?: () => void,
 *   onSpeechEnd?: () => void,
 *   onSpeechEndAudio?: (audio: Float32Array) => void,
 *   onFrameProbability?: (prob: number) => void,
 * }} callbacks
 */
export async function startSileroVad(stream, callbacks = {}) {
  await stopSileroVad();
  if (!stream || !stream.getAudioTracks?.().length || !sileroVadAvailable()) {
    return false;
  }
  _callbacks = callbacks;
  _lastSpeechProbability = 0;
  _initPromise = _initPromise || _loadMicVadClass();
  try {
    const MicVAD = await _initPromise;
    const paths = _assetPaths();
    _micVad = await MicVAD.new({
      stream,
      onnxWASMBasePath: paths.onnxWASMBasePath,
      baseAssetPath: paths.baseAssetPath,
      positiveSpeechThreshold: SILERO_SPEECH_PROB_THRESHOLD,
      negativeSpeechThreshold: 0.58,
      minSpeechFrames: 3,
      preSpeechPadFrames: 2,
      redemptionFrames: 10,
      onFrameProcessed: (probs) => {
        const p = Number(probs?.isSpeech ?? probs?.speech ?? 0);
        if (Number.isFinite(p)) {
          _lastSpeechProbability = p;
          _callbacks?.onFrameProbability?.(p);
        }
      },
      onSpeechStart: () => {
        _speechActive = true;
        _callbacks?.onSpeechStart?.();
      },
      onSpeechEnd: (audio) => {
        _speechActive = false;
        _callbacks?.onSpeechEnd?.();
        if (audio && audio.length) {
          _callbacks?.onSpeechEndAudio?.(audio);
        }
      },
      onVADMisfire: () => {
        /* short false positive */
      },
    });
    await _micVad.start();
    return true;
  } catch (err) {
    console.warn(
      "[VAD] Silero init failed — FFT fallback only. Self-host WASM via window.KARNEX_VAD_ONNX_BASE / KARNEX_VAD_ASSET_BASE.",
      err
    );
    _micVad = null;
    _speechActive = false;
    return false;
  }
}

export async function stopSileroVad() {
  _speechActive = false;
  _lastSpeechProbability = 0;
  _callbacks = null;
  if (_micVad) {
    try {
      _micVad.pause();
      _micVad.destroy();
    } catch (_) {
      /* ignore */
    }
    _micVad = null;
  }
}
