/**
 * Non-blocking interview timer warnings (Jun 2026).
 * Informational banners only — does not stop mic, TTS questions, or answering.
 */

import { apiFetch } from "./core.js";
import { state } from "./state.js";

const WARNING_LEVELS = [
  {
    key: "5min",
    title: "⏳ Interview Time Reminder",
    body: "You have 5 minutes remaining to complete your interview. Please manage your remaining time carefully.",
    durationMs: 5000,
    variant: "info",
    tts: "You have five minutes remaining.",
  },
  {
    key: "2min",
    title: "⚠ Time Running Low",
    body: "You have 2 minutes remaining. Please complete your current response.",
    durationMs: 6000,
    variant: "amber",
    tts: "You have two minutes remaining.",
  },
  {
    key: "1min",
    title: "⚠ Final Minute Remaining",
    body: "You have 1 minute remaining in this interview.",
    durationMs: 8000,
    variant: "orange",
    tts: "You have one minute remaining.",
  },
  {
    key: "30sec",
    title: "🚨 Final 30 Seconds",
    body: "The interview will end automatically in 30 seconds.",
    durationMs: 0,
    variant: "alert",
    tts: "You have thirty seconds remaining.",
    persistent: true,
  },
];

let _hideTimer = null;
let _activeVariant = "";

export function resetTimeWarningUiState() {
  state.timeWarningsShown = { "5min": false, "2min": false, "1min": false, "30sec": false };
  _clearTimeWarningHideTimer();
  _hideTimeWarningBanner(true);
}

export function applyTimeWarningConfig(payload = {}) {
  const tw = payload.time_warnings || payload;
  state.timeWarningsEnabled = !!(tw.enabled ?? payload.enable_time_warnings);
  const th = tw.thresholds_sec || payload.time_warning_thresholds_sec || {};
  state.timeWarningThresholds = {
    "5min": Number(th["5min"]) || 300,
    "2min": Number(th["2min"]) || 120,
    "1min": Number(th["1min"]) || 60,
    "30sec": Number(th["30sec"]) || 30,
  };
  // Visual banners only — spoken timer announcements disabled product-wide.
  state.timeWarningsTts = false;
  if (!state.timeWarningsShown) {
    resetTimeWarningUiState();
  }
}

function _clearTimeWarningHideTimer() {
  if (_hideTimer) {
    clearTimeout(_hideTimer);
    _hideTimer = null;
  }
}

function _hideTimeWarningBanner(immediate = false) {
  const el = document.getElementById("interviewTimeWarning");
  if (!el) return;
  el.classList.remove("is-visible", "is-persistent");
  if (_activeVariant) el.classList.remove(`qc-time-warning--${_activeVariant}`);
  _activeVariant = "";
  if (immediate) {
    el.hidden = true;
    return;
  }
  window.setTimeout(() => {
    if (!el.classList.contains("is-visible")) el.hidden = true;
  }, 320);
}

function _logTimeWarningAudit(key) {
  const field = { "5min": "5min", "2min": "2min", "1min": "1min", "30sec": "30sec" }[key];
  if (!field) return;
  try {
    const fd = new FormData();
    fd.append("warning_key", field);
    void apiFetch("/interview/time-warning-audit", { method: "POST", body: fd });
  } catch (_) {
    /* ignore */
  }
}

async function _speakTimeWarningOnce(text) {
  if (!state.timeWarningsTts) return;
  if (state.aiHostSpeaking || state.endingInterview) return;
  const spoken = String(text || "").trim();
  if (!spoken) return;
  try {
    const fd = new FormData();
    fd.append("text", spoken);
    const res = await apiFetch("/candidate/tts", { method: "POST", body: fd });
    if (!res.ok) return;
    const blob = await res.blob();
    if (!blob.size) return;
    const audio = new Audio(URL.createObjectURL(blob));
    audio.volume = 0.9;
    audio.onended = () => {
      try {
        URL.revokeObjectURL(audio.src);
      } catch (_) {
        /* ignore */
      }
    };
    audio.onerror = () => {
      try {
        URL.revokeObjectURL(audio.src);
      } catch (_) {
        /* ignore */
      }
    };
    void audio.play().catch(() => {});
  } catch (_) {
    /* ignore */
  }
}

function _showTimeWarningBanner(level) {
  const root = document.getElementById("interviewTimeWarning");
  const titleEl = document.getElementById("interviewTimeWarningTitle");
  const bodyEl = document.getElementById("interviewTimeWarningBody");
  if (!root || !titleEl || !bodyEl) return;

  _clearTimeWarningHideTimer();
  if (!level.persistent) _hideTimeWarningBanner(true);

  if (_activeVariant) root.classList.remove(`qc-time-warning--${_activeVariant}`);
  _activeVariant = level.variant;
  root.classList.add(`qc-time-warning--${level.variant}`);
  titleEl.textContent = level.title;
  bodyEl.textContent = level.body;
  root.hidden = false;
  requestAnimationFrame(() => {
    root.classList.add("is-visible");
    if (level.persistent) root.classList.add("is-persistent");
  });

  if (!level.persistent && level.durationMs > 0) {
    _hideTimer = window.setTimeout(() => {
      root.classList.remove("is-visible");
      _hideTimeWarningBanner(false);
    }, level.durationMs);
  }
}

/**
 * Call once per second from the interview timer with seconds remaining.
 */
export function tickInterviewTimeWarnings(remainingSec) {
  if (!state.timeWarningsEnabled) return;
  const limit = Math.max(0, Number(state.interviewLimitSec) || 0);
  if (String(state.timingMode || "").toLowerCase() !== "time" || limit <= 0) return;

  const rem = Math.max(0, Math.floor(Number(remainingSec) || 0));
  if (!state.timeWarningsShown) resetTimeWarningUiState();

  const thresholds = state.timeWarningThresholds || {};
  for (const level of WARNING_LEVELS) {
    const thresh = Math.max(0, Number(thresholds[level.key]) || 0);
    if (thresh <= 0) continue;
    if (rem > thresh) continue;
    if (state.timeWarningsShown[level.key]) continue;
    state.timeWarningsShown[level.key] = true;
    _showTimeWarningBanner(level);
    _logTimeWarningAudit(level.key);
  }
}

export function dismissTimeWarningsOnInterviewEnd() {
  _clearTimeWarningHideTimer();
  _hideTimeWarningBanner(true);
}
