/**
 * Interview Security Module
 * - Mandatory fullscreen gate before the first question
 * - Integrity monitoring: fullscreen exit, focus loss, tab switch, restricted keys
 * - Three-strike policy with backend logging to /interview/violation
 * - Face detection hooks (via face_detection.js)
 */

import { apiFetch } from "./core.js";
import { state } from "./state.js";
import { getAuthUserRaw, getAuthToken } from "./auth/session.js";

const MAX_WARNINGS = 3;
const TERMINATE_AT = 3;
const BLUR_DEBOUNCE_MS = 1500;

let violationCount = 0;
const violationCountsByType = {};
let securityActive = false;
let warningModal = null;
let violationBadge = null;
let fullscreenGateModal = null;
let lastBlurTime = 0;
let fullscreenRecoveryInFlight = false;
let lastFullscreenRecoveryAttempt = 0;
let fullscreenGateResolver = null;
let integrityListenersBound = false;

const INTEGRITY_VIOLATION_TYPES = new Set([
  "tab_switch",
  "fullscreen_exit",
  "key_escape",
  "key_f11",
  "alt_tab",
  "windows_key",
  "ctrl_esc",
  "window_blur",
  "visibility_hidden",
  "focus_lost",
  "multiple_faces",
]);

const VIOLATION_LABELS = {
  tab_switch: "Tab switch",
  fullscreen_exit: "Fullscreen exit",
  key_escape: "Escape key",
  key_f11: "F11 key",
  alt_tab: "Alt+Tab",
  windows_key: "Windows key",
  ctrl_esc: "Ctrl+Esc",
  window_blur: "Window blur",
  visibility_hidden: "Tab hidden",
  focus_lost: "Focus lost",
  multiple_faces: "Extra face",
};

const WARNING_COPY = {
  default: [
    {
      title: "Warning 1 of 3",
      message:
        "You exited Fullscreen or switched away from the interview window. Please return immediately and stay in fullscreen mode.",
    },
    {
      title: "Warning 2 of 3",
      message:
        "Your interview is being monitored. Continued violations will result in interview termination.",
    },
  ],
  termination: {
    title: "Interview Terminated",
    message: "Interview Terminated - Multiple integrity violations detected",
  },
};

function _decodeJwtPayload() {
  const raw = getAuthToken();
  if (!raw) return {};
  try {
    const part = raw.split(".")[1];
    if (!part) return {};
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch (_) {
    return {};
  }
}

function _integrityContext() {
  const jwt = _decodeJwtPayload();
  let candidateId = "";
  try {
    const user = JSON.parse(getAuthUserRaw() || "{}");
    candidateId = String(user.username || user.email || user.full_name || "").trim();
  } catch (_) {
    candidateId = "";
  }
  return {
    interview_id: String(jwt.invite_token || state.lastInterviewId || "").trim(),
    candidate_id: candidateId || String(jwt.sub || "").trim(),
    current_question: String(state.currentQuestion || "").slice(0, 500),
    fullscreen_status: document.fullscreenElement ? "active" : "inactive",
    browser_visibility: document.hidden ? "hidden" : "visible",
    window_focus: typeof document.hasFocus === "function" ? document.hasFocus() : true,
  };
}

function _isEditableTarget(el) {
  if (!el || !(el instanceof Element)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  if (
    el.closest(
      ".monaco-editor, .cm-editor, .cm-content, [data-kx-code-editor], [data-kx-sql-editor], .ace_editor"
    )
  ) {
    return true;
  }
  return false;
}

function isFullscreenActive() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
}

async function _requestFullscreenFromGesture() {
  const root = document.documentElement;
  try {
    if (root.requestFullscreen) {
      await root.requestFullscreen();
    } else if (root.webkitRequestFullscreen) {
      await root.webkitRequestFullscreen();
    } else if (root.mozRequestFullScreen) {
      await root.mozRequestFullScreen();
    } else if (root.msRequestFullscreen) {
      await root.msRequestFullscreen();
    }
  } catch (_) {
    /* user gesture required or blocked */
  }
  return isFullscreenActive();
}

function createFullscreenGateModal() {
  if (document.getElementById("fullscreenRequiredModal")) {
    fullscreenGateModal = document.getElementById("fullscreenRequiredModal");
    return;
  }
  const overlay = document.createElement("div");
  overlay.id = "fullscreenRequiredModal";
  overlay.style.cssText = `
    display:none; position:fixed; inset:0; z-index:100000;
    background:rgba(0,0,0,0.88); backdrop-filter:blur(10px);
    justify-content:center; align-items:center;
  `;
  overlay.innerHTML = `
    <div style="
      background:linear-gradient(135deg,#1e1b4b,#312e81);
      border:2px solid rgba(99,102,241,0.45); border-radius:20px;
      padding:40px 36px; max-width:480px; width:90%; text-align:center;
      box-shadow:0 25px 60px rgba(0,0,0,0.6);
    ">
      <div style="font-size:48px;margin-bottom:16px;">🖥️</div>
      <h2 style="color:#e2e8f0;font-size:22px;font-weight:800;margin:0 0 12px;">Fullscreen Required</h2>
      <p style="color:#cbd5e1;font-size:15px;line-height:1.6;margin:0 0 8px;">
        This interview must be completed in Fullscreen Mode.
      </p>
      <p style="color:#94a3b8;font-size:14px;line-height:1.5;margin:0 0 24px;">
        Please click "Enter Fullscreen" to continue.
      </p>
      <p id="fullscreenGateError" style="color:#f87171;font-size:13px;min-height:18px;margin:0 0 16px;"></p>
      <button id="fullscreenGateBtn" type="button" style="
        padding:12px 32px; background:linear-gradient(135deg,#6366f1,#4f46e5);
        color:#fff; border:none; border-radius:12px; font-weight:700;
        font-size:15px; cursor:pointer;
      ">Enter Fullscreen</button>
    </div>
  `;
  document.body.appendChild(overlay);
  fullscreenGateModal = overlay;
  const btn = document.getElementById("fullscreenGateBtn");
  if (btn) {
    btn.addEventListener("click", () => void _onFullscreenGateClick());
  }
}

async function _onFullscreenGateClick() {
  const errEl = document.getElementById("fullscreenGateError");
  const btn = document.getElementById("fullscreenGateBtn");
  if (btn) btn.disabled = true;
  if (errEl) errEl.textContent = "Requesting fullscreen…";
  const ok = await _requestFullscreenFromGesture();
  if (btn) btn.disabled = false;
  if (ok) {
    if (fullscreenGateModal) fullscreenGateModal.style.display = "none";
    if (errEl) errEl.textContent = "";
    if (typeof fullscreenGateResolver === "function") {
      const done = fullscreenGateResolver;
      fullscreenGateResolver = null;
      done(true);
    }
    return;
  }
  if (errEl) {
    errEl.textContent =
      "Fullscreen was blocked. Allow fullscreen for this site, then click Enter Fullscreen again.";
  }
}

/**
 * Blocks until the candidate enters fullscreen (required before first question).
 */
export function requireFullscreenBeforeInterview() {
  if (isFullscreenActive()) return Promise.resolve(true);
  createFullscreenGateModal();
  if (!fullscreenGateModal) return Promise.resolve(false);
  fullscreenGateModal.style.display = "flex";
  const errEl = document.getElementById("fullscreenGateError");
  if (errEl) errEl.textContent = "";
  return new Promise((resolve) => {
    fullscreenGateResolver = resolve;
  });
}

function createWarningModal() {
  if (document.getElementById("securityWarningModal")) return;
  const overlay = document.createElement("div");
  overlay.id = "securityWarningModal";
  overlay.style.cssText = `
    display:none; position:fixed; inset:0; z-index:99999;
    background:rgba(0,0,0,0.85); backdrop-filter:blur(8px);
    justify-content:center; align-items:center;
  `;
  overlay.innerHTML = `
    <div style="
      background:linear-gradient(135deg,#1e1b4b,#312e81);
      border:2px solid rgba(239,68,68,0.4); border-radius:20px;
      padding:40px 36px; max-width:480px; width:90%; text-align:center;
      box-shadow:0 25px 60px rgba(0,0,0,0.6);
    ">
      <div id="secWarnIcon" style="font-size:48px;margin-bottom:16px;">⚠️</div>
      <h2 id="secWarnTitle" style="color:#fbbf24;font-size:22px;font-weight:800;margin:0 0 12px;"></h2>
      <p id="secWarnMsg" style="color:#e2e8f0;font-size:15px;line-height:1.6;margin:0 0 24px;"></p>
      <div id="secWarnCounter" style="color:#f87171;font-size:13px;font-weight:700;margin-bottom:20px;"></div>
      <button id="secWarnBtn" type="button" style="
        padding:12px 32px; background:linear-gradient(135deg,#6366f1,#4f46e5);
        color:#fff; border:none; border-radius:12px; font-weight:700;
        font-size:15px; cursor:pointer;
      ">I Understand</button>
    </div>
  `;
  document.body.appendChild(overlay);
  warningModal = overlay;
  const btn = document.getElementById("secWarnBtn");
  if (btn) {
    btn.addEventListener("click", () => {
      if (warningModal) warningModal.style.display = "none";
    });
  }
}

function createViolationBadge() {
  if (document.getElementById("violationBadge")) return;
  const badge = document.createElement("div");
  badge.id = "violationBadge";
  badge.style.cssText = `
    display:none; position:fixed; top:12px; right:12px; z-index:9999;
    background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.4);
    backdrop-filter:blur(8px); border-radius:12px; padding:8px 16px;
    color:#fca5a5; font-size:12px; font-weight:700;
    font-family:-apple-system,BlinkMacSystemFont,sans-serif;
  `;
  badge.innerHTML =
    '<span id="violationBadgeText">Violations: <span id="violationBadgeCount">0</span>/' +
    MAX_WARNINGS +
    "</span>";
  document.body.appendChild(badge);
  violationBadge = badge;
}

function showWarning(level) {
  if (!warningModal) createWarningModal();
  const warn = WARNING_COPY.default[Math.min(Math.max(level, 1), 2) - 1] || WARNING_COPY.default[0];
  document.getElementById("secWarnTitle").textContent = warn.title;
  document.getElementById("secWarnMsg").textContent = warn.message;
  document.getElementById("secWarnCounter").textContent = `Warning ${Math.min(level, 2)} of ${MAX_WARNINGS}`;
  document.getElementById("secWarnIcon").textContent = level >= 2 ? "🔴" : "⚠️";
  const btn = document.getElementById("secWarnBtn");
  btn.textContent = "I Understand";
  btn.style.background = "linear-gradient(135deg,#6366f1,#4f46e5)";
  btn.onclick = () => {
    warningModal.style.display = "none";
  };
  warningModal.style.display = "flex";
}

function showTerminationWarning() {
  if (!warningModal) createWarningModal();
  const warn = WARNING_COPY.termination;
  document.getElementById("secWarnTitle").textContent = warn.title;
  document.getElementById("secWarnMsg").textContent = warn.message;
  document.getElementById("secWarnCounter").textContent = `Total violations: ${violationCount}`;
  document.getElementById("secWarnIcon").textContent = "🚫";
  const btn = document.getElementById("secWarnBtn");
  btn.textContent = "Interview Ended";
  btn.style.background = "linear-gradient(135deg,#dc2626,#b91c1c)";
  btn.onclick = () => {
    window.location.reload();
  };
  warningModal.style.display = "flex";
}

function updateBadge() {
  if (!violationBadge) createViolationBadge();
  if (violationCount > 0) {
    violationBadge.style.display = "block";
    const countEl = document.getElementById("violationBadgeCount");
    if (countEl) countEl.textContent = String(violationCount);
    if (violationCount >= 2) {
      violationBadge.style.borderColor = "rgba(239,68,68,0.8)";
      violationBadge.style.background = "rgba(239,68,68,0.25)";
    }
  }
}

async function restoreFullscreenAfterReturn() {
  if (!securityActive || document.hidden || isFullscreenActive() || fullscreenRecoveryInFlight) return;
  const now = Date.now();
  if (now - lastFullscreenRecoveryAttempt < 2000) return;
  lastFullscreenRecoveryAttempt = now;
  fullscreenRecoveryInFlight = true;
  try {
    if (typeof window.enterFullscreen === "function") {
      await window.enterFullscreen();
    } else {
      await _requestFullscreenFromGesture();
    }
  } catch (_) {
    /* gesture may be required */
  } finally {
    fullscreenRecoveryInFlight = false;
  }
}

function mapProctorViolationType(type) {
  if (type === "tab_switch" || type === "visibility_hidden" || type === "window_blur" || type === "focus_lost") {
    return "tabSwitch";
  }
  if (type === "multiple_faces") return "extraFace";
  return type;
}

let lastIntegrityEventTime = 0;

async function reportViolation(type, details = "") {
  if (!INTEGRITY_VIOLATION_TYPES.has(type)) return;
  const now = Date.now();
  if (now - lastIntegrityEventTime < BLUR_DEBOUNCE_MS) return;
  lastIntegrityEventTime = now;
  violationCount += 1;
  violationCountsByType[type] = (violationCountsByType[type] || 0) + 1;
  updateBadge();

  const terminate = violationCount >= TERMINATE_AT;
  if (terminate) {
    showTerminationWarning();
  } else {
    showWarning(violationCount);
    void restoreFullscreenAfterReturn();
  }

  if (typeof window.__karnexReportProctorViolation === "function") {
    try {
      window.__karnexReportProctorViolation(mapProctorViolationType(type), details);
    } catch (_) {
      /* ignore */
    }
  }

  try {
    const ctx = _integrityContext();
    const fd = new FormData();
    fd.append("violation_type", type);
    fd.append("details", String(details || VIOLATION_LABELS[type] || type).slice(0, 500));
    fd.append("current_question", ctx.current_question);
    fd.append("fullscreen_status", ctx.fullscreen_status);
    fd.append("browser_visibility", ctx.browser_visibility);
    fd.append("window_focus", ctx.window_focus ? "true" : "false");
    fd.append("interview_id", ctx.interview_id);
    fd.append("candidate_id", ctx.candidate_id);
    const res = await apiFetch("/interview/violation", { method: "POST", body: fd });
    const data = await res.json();
    if (data.auto_terminated || terminate) {
      triggerAutoTermination();
    }
  } catch (_) {
    if (terminate) triggerAutoTermination();
  }
}

export function reportSecurityViolation(type, details = "") {
  if (!securityActive) return;
  reportViolation(type, details);
}

function triggerAutoTermination() {
  securityActive = false;
  try {
    window.__karnexInterviewExitOutcome = "terminated";
  } catch (_) {
    /* ignore */
  }
  if (typeof window.submitInterview === "function") {
    window.submitInterview();
  }
}

function _debouncedIntegrityEvent(type, details) {
  const now = Date.now();
  if (now - lastBlurTime < BLUR_DEBOUNCE_MS) return;
  lastBlurTime = now;
  void reportViolation(type, details);
}

function onVisibilityChange() {
  if (!securityActive) return;
  if (document.hidden) {
    _debouncedIntegrityEvent("visibility_hidden", "document.hidden via visibilitychange");
    return;
  }
  window.setTimeout(() => void restoreFullscreenAfterReturn(), 250);
}

function onWindowBlur() {
  if (!securityActive || document.hidden) return;
  _debouncedIntegrityEvent("window_blur", "window blur — focus left interview");
}

function onWindowFocus() {
  if (!securityActive) return;
  window.setTimeout(() => void restoreFullscreenAfterReturn(), 250);
}

function onFullscreenChange() {
  if (!securityActive) return;
  if (!isFullscreenActive()) {
    void reportViolation("fullscreen_exit", "Candidate exited fullscreen mode");
    return;
  }
}

/* ---------------------------------------------------------------------------
 * Keyboard lockdown
 *
 * The interview is answered by voice — there is no answer field to type into.
 * A keyboard therefore serves no legitimate purpose during a live interview,
 * and every key it can send is a way to leave, copy, or look something up.
 * So keys are swallowed rather than merely logged.
 *
 * Two carve-outs, both deliberate:
 *
 *  1. A template can enable a typed transcript (`enable_transcript_input`).
 *     When the candidate is focused in that field, typing must work or the
 *     interview becomes impossible to complete. Modifier combinations stay
 *     blocked even there.
 *  2. Tab and Shift+Tab still move focus. Removing them would strand anyone
 *     using a screen reader or who cannot use a mouse, and moving focus between
 *     two on-screen buttons is not an integrity risk.
 * ------------------------------------------------------------------------- */

/** Keys that remain usable because blocking them would break accessibility. */
const KEYBOARD_ALLOWED_KEYS = new Set(["Tab"]);

/** Combinations worth naming in the violation log rather than silently eating. */
function _namedViolationFor(e) {
  if (e.key === "Escape" && e.ctrlKey) return "ctrl_esc";
  if (e.key === "Escape") return "key_escape";
  if (e.key === "F11") return "key_f11";
  if (e.altKey && e.key === "Tab") return "alt_tab";
  if (e.key === "Meta" || e.key === "OS") return "windows_key";
  return null;
}

function _keyboardAllowed(e) {
  // Focus is in a transcript box the template deliberately turned on.
  if (_isEditableTarget(e.target)) {
    // Plain typing yes; Ctrl/Cmd/Alt combinations no — those are copy, paste,
    // find, new tab, print, view-source, devtools.
    return !(e.ctrlKey || e.metaKey || e.altKey);
  }
  if (KEYBOARD_ALLOWED_KEYS.has(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    return true;
  }
  return false;
}

function onIntegrityKeyDown(e) {
  if (!securityActive) return;

  const named = _namedViolationFor(e);
  if (named) {
    void reportViolation(named, `${VIOLATION_LABELS[named] || named} detected`);
  }

  if (_keyboardAllowed(e)) return;

  // Swallow it. preventDefault stops the browser acting on the key;
  // stopPropagation keeps it from reaching any page handler.
  e.preventDefault();
  e.stopPropagation();
  if (!named) _noteKeyboardAttempt(e);
}

/**
 * Tell the candidate why nothing happened, and log the attempt — but only
 * occasionally. Someone resting a hand on the keyboard should not generate a
 * hundred identical events or a strobing toast.
 */
let _lastKeyboardNoticeAt = 0;
let _keyboardAttemptCount = 0;
const KEYBOARD_NOTICE_INTERVAL_MS = 4000;

function _noteKeyboardAttempt(e) {
  _keyboardAttemptCount += 1;
  const now = Date.now();
  if (now - _lastKeyboardNoticeAt < KEYBOARD_NOTICE_INTERVAL_MS) return;
  _lastKeyboardNoticeAt = now;
  try {
    window.dispatchEvent(
      new CustomEvent("karnex:keyboard-blocked", {
        detail: { key: e.key, attempts: _keyboardAttemptCount },
      })
    );
  } catch (_) {
    // non-fatal
  }
}

/** Swallow clipboard and context-menu actions for the same reason. */
function onBlockedClipboardEvent(e) {
  if (!securityActive) return;
  if (_isEditableTarget(e.target)) return;
  e.preventDefault();
  e.stopPropagation();
}

export function keyboardAttemptCount() {
  return _keyboardAttemptCount;
}

function bindIntegrityListeners() {
  if (integrityListenersBound) return;
  integrityListenersBound = true;
  document.addEventListener("visibilitychange", onVisibilityChange);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);
  document.addEventListener("mozfullscreenchange", onFullscreenChange);
  window.addEventListener("blur", onWindowBlur);
  window.addEventListener("focus", onWindowFocus);
  document.addEventListener("keydown", onIntegrityKeyDown, true);
  // keypress/keyup as well, so a swallowed keydown cannot be followed by the
  // browser acting on the later events in the same key press.
  document.addEventListener("keypress", onIntegrityKeyDown, true);
  document.addEventListener("copy", onBlockedClipboardEvent, true);
  document.addEventListener("cut", onBlockedClipboardEvent, true);
  document.addEventListener("paste", onBlockedClipboardEvent, true);
  document.addEventListener("contextmenu", onBlockedClipboardEvent, true);
}

function unbindIntegrityListeners() {
  if (!integrityListenersBound) return;
  integrityListenersBound = false;
  document.removeEventListener("visibilitychange", onVisibilityChange);
  document.removeEventListener("fullscreenchange", onFullscreenChange);
  document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
  document.removeEventListener("mozfullscreenchange", onFullscreenChange);
  window.removeEventListener("blur", onWindowBlur);
  window.removeEventListener("focus", onWindowFocus);
  document.removeEventListener("keydown", onIntegrityKeyDown, true);
  document.removeEventListener("keypress", onIntegrityKeyDown, true);
  document.removeEventListener("copy", onBlockedClipboardEvent, true);
  document.removeEventListener("cut", onBlockedClipboardEvent, true);
  document.removeEventListener("paste", onBlockedClipboardEvent, true);
  document.removeEventListener("contextmenu", onBlockedClipboardEvent, true);
}

export function activateInterviewSecurity() {
  if (securityActive) return;
  securityActive = true;
  violationCount = 0;
  Object.keys(violationCountsByType).forEach((k) => delete violationCountsByType[k]);
  lastBlurTime = 0;
  _keyboardAttemptCount = 0;
  _lastKeyboardNoticeAt = 0;

  createWarningModal();
  createViolationBadge();
  bindIntegrityListeners();
}

export function deactivateInterviewSecurity() {
  securityActive = false;
  unbindIntegrityListeners();
  if (warningModal) warningModal.style.display = "none";
  if (violationBadge) violationBadge.style.display = "none";
}
