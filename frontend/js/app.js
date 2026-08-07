import {
  createSetupInterview,
  createShowScreen,
  extractSkillsOnly,
  loadJobConfigs,
  applySelectedJobConfig,
  loadInterviewSchedules,
  loadModels,
  scheduleInterview,
  setScheduleFilter,
  setCandidateNavigator,
  saveJobConfig,
  computeAtsPreview,
  loadRankedCandidates,
  initCandidateAutocomplete,
} from "./hr.js";
import {
  loadQuestion,
  initProctoring,
  enterFullscreen,
  toggleMicInput,
  reopenMediaPermissionGate,
  startInterviewTimer,
  submitCandidateAnswer,
  submitInterview,
  cancelAutoAdvance,
  submitAutoAdvanceNow,
  showCandidateToast,
} from "./candidate.js";
import {
  downloadLatestReportExcel,
  downloadInterviewQaPdf,
  downloadInterviewQaTxt,
  downloadSelectedRecord,
  loadHrRecords,
  printManagementReport,
  unlockResult,
} from "./results.js";
import { initBackground, setInterviewMode } from "./scene.js";
import { initAvatar } from "./avatar.js";
import { apiFetch, handleJson } from "./core.js";
import { switchAuthMode, switchAuthPane } from "./auth/sharedAuth.js";
import { initAuthMotion, initAuthEnterSubmit } from "./auth/authMotion.js";
import { initBrandLogoFallback } from "./brandLogo.js";
import { initHrSetupUi } from "./hrSetupUi.js";
import { initHrAccessDetailsUi } from "./hrAccessDetails.js";
import { initAutoAdvanceBannerUi } from "./interview_auto_advance.js";
import { createHrAuth } from "./auth/hrAuth.js";
import {
  saveAuthSession,
  clearAuthSession,
  getAuthToken,
  getAuthUserRaw,
  isAccessTokenExpired,
} from "./auth/session.js";
import {
  activateInterviewSecurity,
  deactivateInterviewSecurity,
  requireFullscreenBeforeInterview,
} from "./interview_security.js";
import { startFaceMonitoring, stopFaceMonitoring } from "./face_detection.js";
import { runDeviceTestGate, hideDeviceTestGate, readPersistedDeviceTestState } from "./device_test.js";
import {
  applyRulesConfig,
  bindKeyboardBlockedNotice,
  runInterviewRulesGate,
} from "./interview_rules.js";
const inviteTokenFromUrl = new URLSearchParams(window.location.search).get("invite") || "";
const hrFocusFromUrl = new URLSearchParams(window.location.search).get("focus") || "";

/**
 * The template's interview format (duration / question count), read from the
 * invite lookup. Held here so the rules screen can quote the real numbers.
 * Empty until the lookup responds; the rules screen degrades to "—" gracefully.
 */
let _inviteInterviewConfig = {};

// A key that does nothing, with no explanation, reads as a broken page. The
// security module emits this (throttled) whenever it swallows a keypress.
bindKeyboardBlockedNotice((msg) => showCandidateToast(msg, 2600));

(function gateProductionConsole() {
  try {
    const debug =
      new URLSearchParams(window.location.search).get("debug") === "1" ||
      window.localStorage.getItem("kx_debug") === "1";
    if (!debug) {
      console.info = () => {};
      console.debug = () => {};
      console.log = () => {};
    }
  } catch (_) {
    /* ignore */
  }
})();

async function maybeAutoClearCache(scope) {
  const key = scope === "admin" ? "karnexAdminVersion" : "karnexHrVersion";
  try {
    const res = await fetch("/version", { method: "GET", cache: "no-store" });
    const data = await res.json();
    const ver = String(data?.version || "").trim();
    if (!ver) return;
    const prev = String(window.localStorage.getItem(key) || "").trim();
    if (prev && prev !== ver) {
      const keep = new Set([key]);
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const k = window.localStorage.key(i);
        if (!k) continue;
        if (keep.has(k)) continue;
        window.localStorage.removeItem(k);
      }
      clearAuthSession();
      if (window.caches && typeof window.caches.keys === "function") {
        try {
          const keys = await window.caches.keys();
          await Promise.all(keys.map((k) => window.caches.delete(k)));
        } catch (_) {}
      }
      window.localStorage.setItem(key, ver);
      // Reload to pull the latest JS/CSS.
      window.location.reload();
      return;
    }
    if (!prev) window.localStorage.setItem(key, ver);
  } catch (_) {
    // ignore
  }
}

const _showScreen = createShowScreen();
let _deferCandidateProctoring = false;
const showScreen = (id) => {
  _showScreen(id);
  setInterviewMode(id === "candidate");
  if (id === "candidate" && getAuthToken() && !_deferCandidateProctoring) {
    void initProctoring().catch((err) => {
      console.warn("[VAD] Proctoring init deferred", err);
    });
  }
};
setCandidateNavigator(showScreen);
const setupInterview = createSetupInterview(showScreen);
let authUser = null;

function applyHudToggle(value) {
  const mode = value === "off" ? "off" : "on";
  document.body.classList.toggle("hud-off", mode === "off");
  window.localStorage.setItem("hudToggle", mode);
}

function applyThemePreset(value) {
  const preset = value === "jarvis" || value === "presentation" ? value : "enterprise";
  document.body.classList.remove("theme-enterprise", "theme-jarvis", "theme-presentation");
  document.body.classList.add(`theme-${preset}`);
  window.localStorage.setItem("themePreset", preset);
}

function syncHrThemeToggleIcons() {
  const hrThemeBtn = document.getElementById("kxHeaderThemeToggle");
  if (!hrThemeBtn) return;
  const dark = document.documentElement.classList.contains("kx-dark");
  const moon = hrThemeBtn.querySelector(".kx-hr-theme-moon");
  const sun = hrThemeBtn.querySelector(".kx-hr-theme-sun");
  if (moon) moon.style.display = dark ? "none" : "flex";
  if (sun) sun.style.display = dark ? "flex" : "none";
  hrThemeBtn.title = dark ? "Switch to light mode" : "Switch to dark mode";
  hrThemeBtn.setAttribute("aria-label", hrThemeBtn.title);
}

function applyUiDarkMode(on) {
  const v = on ? "1" : "0";
  document.documentElement.classList.toggle("kx-dark", on);
  try {
    window.localStorage.setItem("karnexUiDark", v);
    window.localStorage.setItem("karnexTheme", on ? "dark" : "light");
  } catch (_) {
    /* ignore */
  }
  syncHrThemeToggleIcons();
}

function initUiSettings() {
  const hud = document.getElementById("hudToggle");
  const themePreset = document.getElementById("themePreset");
  const uiDark = document.getElementById("uiDarkMode");
  const saved = window.localStorage.getItem("hudToggle") || "on";
  const savedTheme = window.localStorage.getItem("themePreset") || "enterprise";
  const savedDark =
    window.localStorage.getItem("karnexUiDark") === "1" ||
    window.localStorage.getItem("karnexTheme") === "dark";
  applyHudToggle(saved);
  applyThemePreset(savedTheme);
  applyUiDarkMode(savedDark);
  if (hud) {
    hud.value = saved;
    hud.addEventListener("change", (e) => applyHudToggle(e.target.value));
  }
  if (themePreset) {
    themePreset.value = savedTheme;
    themePreset.addEventListener("change", (e) => applyThemePreset(e.target.value));
  }
  if (uiDark) {
    uiDark.value = savedDark ? "dark" : "light";
    uiDark.addEventListener("change", (e) => applyUiDarkMode(e.target.value === "dark"));
  }
  const hrThemeBtn = document.getElementById("kxHeaderThemeToggle");
  if (hrThemeBtn) {
    syncHrThemeToggleIcons();
    hrThemeBtn.addEventListener("click", () => {
      applyUiDarkMode(!document.documentElement.classList.contains("kx-dark"));
      if (uiDark) uiDark.value = document.documentElement.classList.contains("kx-dark") ? "dark" : "light";
    });
  }
}

function startSystem() {
  const startup = document.getElementById("screenStartup");
  const layout = document.getElementById("mainLayout");
  if (layout) {
    layout.classList.remove("hidden");
    layout.classList.add("pre-reveal");
  }
  if (startup) {
    startup.classList.add("leaving");
    window.setTimeout(() => startup.classList.remove("active"), 300);
  }
  if (layout) {
    window.requestAnimationFrame(() => layout.classList.remove("pre-reveal"));
  }
  showScreen(authUser?.role === "candidate" ? "candidate" : "hr");
  if ((authUser?.role || "") !== "candidate") {
    applyHrFocusFromQuery();
  }
}

function applyHrFocusFromQuery() {
  const focus = String(hrFocusFromUrl || "").trim().toLowerCase();
  if (!focus) return;
  // Only applies to HR screen; never interfere with candidate invite login.
  showScreen("hr");
  const targetId = focus === "invite" ? "scheduleDateTime" : focus === "template" ? "atsJobTitle" : "";
  if (!targetId) return;
  window.setTimeout(() => {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (typeof el.focus === "function") el.focus();
  }, 350);
}

function applyRoleAccess(role) {
  const tabHr = document.getElementById("tabHr");
  const tabCandidate = document.getElementById("tabCandidate");
  const tabDashboard = document.getElementById("tabDashboard");
  if (role === "candidate") {
    if (tabHr) tabHr.style.display = "none";
    if (tabDashboard) tabDashboard.style.display = "none";
    if (tabCandidate) tabCandidate.style.display = "block";
  } else {
    if (tabHr) tabHr.style.display = "block";
    if (tabDashboard) tabDashboard.style.display = "block";
    if (tabCandidate) tabCandidate.style.display = "block";
  }
}

function formatSidebarUserRole(role) {
  const r = String(role || "hr").trim().toLowerCase();
  if (r === "hr") return "HR";
  if (r === "admin") return "Admin";
  if (r === "candidate") return "Candidate";
  if (!r) return "HR";
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function formatSidebarIstNow() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  let h = now.getHours();
  const min = String(now.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const hh = String(h).padStart(2, "0");
  return `IST: ${y}-${m}-${d} ${hh}:${min} ${ampm}`;
}

function initialsFromName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return String(name || "HR").substring(0, 2).toUpperCase() || "HR";
}

function setUserChip(user) {
  const nameEl = document.getElementById("kxSidebarUserName");
  const roleEl = document.getElementById("kxSidebarUserRole");
  const emailEl = document.getElementById("kxSidebarUserEmail");
  const timeEl = document.getElementById("kxUserTime");
  const avatar = document.getElementById("kxUserAvatar");

  if (!user) {
    if (nameEl) nameEl.textContent = "Not logged in";
    if (roleEl) roleEl.textContent = "—";
    if (emailEl) emailEl.textContent = "";
    if (timeEl) timeEl.textContent = "IST: —";
    if (avatar) avatar.textContent = "—";
    return;
  }

  const name = user.full_name || user.username || "User Name";
  const roleLabel = formatSidebarUserRole(user.role);
  const email = String(user.email || "").trim();

  if (nameEl) nameEl.textContent = name;
  if (roleEl) roleEl.textContent = roleLabel;
  if (emailEl) emailEl.textContent = email;

  const initials = initialsFromName(name);
  if (avatar) avatar.textContent = initials;

  const headerAvatar = document.getElementById("kxHeaderAvatar");
  if (headerAvatar) headerAvatar.textContent = initials;

  refreshSidebarProfileClock();
}

export function refreshSidebarProfileClock() {
  const timeEl = document.getElementById("kxUserTime");
  if (timeEl) timeEl.textContent = formatSidebarIstNow();
}

function logoutUser() {
  stopFaceMonitoring();
  deactivateInterviewSecurity();
  const bearer = getAuthToken();
  clearAuthSession();
  authUser = null;
  if (window.caches && typeof window.caches.keys === "function") {
    try {
      void window.caches.keys().then((keys) => Promise.all(keys.map((k) => window.caches.delete(k))));
    } catch (_) {
      /* ignore */
    }
  }
  if (bearer) {
    try {
      void fetch("/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}` },
        keepalive: true,
      });
    } catch (_) {
      /* ignore */
    }
  }
  try {
    window.location.replace(`${window.location.pathname}${window.location.search || ""}`);
  } catch (_) {
    window.location.reload();
  }
}

// Any user with a CRM role now lands in the CRM/admin app instead of the HR Setup
// scheduler. HR Setup is reached deliberately via the "Interview Schedule" button
// (which uses ?focus=...), so an explicit focus intent is never redirected — that
// also avoids a redirect loop. Legacy HR users with no CRM role keep HR Setup.
async function shouldRedirectFromHrSetup() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("focus")) return false; // explicit HR Setup intent — stay
    const token = getAuthToken();
    if (!token) return false;
    const res = await fetch("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return false; // CRM unconfigured / no profile → keep legacy behavior
    const body = await res.json();
    const roles = body && body.data && Array.isArray(body.data.roles) ? body.data.roles : [];
    return roles.length > 0; // has any CRM role → go to /admin (CRM)
  } catch (_) {
    return false; // never block login on an RBAC lookup failure
  }
}

function revealAppAfterAuth(user) {
  authUser = user || null;
  setUserChip(authUser);
  applyRoleAccess(authUser?.role || "candidate");
  const auth = document.getElementById("screenAuth");
  const startup = document.getElementById("screenStartup");
  const layout = document.getElementById("mainLayout");
  if (auth) auth.classList.remove("active");
  if (startup) startup.classList.remove("active");
  if ((authUser?.role || "") === "candidate") {
    if (layout) layout.classList.remove("hidden");
    document.body.classList.add("interview-mode");
    showScreen("candidate");
    return;
  }
  document.body.classList.remove("interview-mode");
  // Keep the layout hidden until we know this role may use HR Setup — avoids a
  // flash of the scheduler for roles that get redirected to /admin.
  void shouldRedirectFromHrSetup().then((redirect) => {
    if (redirect) {
      const qs = window.location.search || "";
      window.location.replace(`/admin/${qs}`);
      return;
    }
    if (layout) layout.classList.remove("hidden");
    loadHrRecords();
    loadInterviewSchedules();
    loadJobConfigs();
    initCandidateAutocomplete();
    showScreen("hr");
    applyHrFocusFromQuery();
  });
}

const setAuthStatus = (text) => {
  const status = document.getElementById("authStatus");
  if (status) status.innerText = text || "";
};

const hrAuth = createHrAuth(saveAuthSession, revealAppAfterAuth, setAuthStatus);

async function registerUser(role = "candidate") {
  const targetRole = role === "hr" ? "hr" : "candidate";
  if (targetRole !== "hr") {
    setAuthStatus("Candidate does not need login. Use the secure invite link from HR.");
    return;
  }
  const ok = await hrAuth.registerHr();
  if (ok) {
    switchAuthMode("login", registerUser, loginUser);
  }
}

async function loginUser(role = "candidate") {
  const targetRole = role === "hr" ? "hr" : "candidate";
  if (targetRole === "hr") {
    await hrAuth.loginHr();
  } else {
    setAuthStatus("Candidate does not need login. Use the secure invite link from HR.");
  }
}

async function restoreSessionIfPossible() {
  if (isAccessTokenExpired()) {
    clearAuthSession();
    return false;
  }
  const rawUser = getAuthUserRaw();
  const token = getAuthToken();
  if (!rawUser || !token) return false;
  try {
    const me = await handleJson(await apiFetch("/auth/me", { method: "GET" }));
    const user = me.user || JSON.parse(rawUser);
    revealAppAfterAuth(user);
    return true;
  } catch (_) {
    clearAuthSession();
    return false;
  }
}

let _inviteCountdownHandle = null;
let _inviteLoginInFlight = null;
let _inviteStartupHandle = null;
function _setCandidateStartupControlsDisabled(disabled) {
  const ids = ["candidateSendBtn", "candidateSkipBtn", "candBtnAllowMedia", "candBtnSkipMedia"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.disabled = !!disabled;
  }
}
function _setInviteStartupState(text) {
  const msg = String(text || "").trim();
  if (!msg) return;
  setAuthStatus(msg);
  const aiState = document.getElementById("aiState");
  if (aiState) aiState.innerText = msg;
  const status = document.getElementById("candidateStatus");
  if (status) status.innerText = msg;
}
function _showInviteLoadingOverlay(message) {
  const welcome = document.getElementById("screenInviteWelcome");
  const startBtn = document.getElementById("inviteWelcomeStartBtn");
  const subEl = document.getElementById("inviteWelcomeSubtitle");
  const titleEl = document.getElementById("inviteWelcomeTitle");
  if (welcome) welcome.classList.add("active");
  if (startBtn) startBtn.hidden = true;
  if (titleEl) titleEl.textContent = "Preparing your interview";
  if (subEl) subEl.textContent = message || "Starting interview session...";
}
function _hideInviteLoadingOverlay() {
  const welcome = document.getElementById("screenInviteWelcome");
  const startBtn = document.getElementById("inviteWelcomeStartBtn");
  if (welcome) welcome.classList.remove("active");
  if (startBtn) startBtn.hidden = false;
}
function _formatQuestionBankValidation(validation) {
  if (!validation || typeof validation !== "object") return "";
  const lines = [];
  const role = validation.role || {};
  if (role.filter) {
    lines.push(`Role “${role.filter}”: ${role.matched ? `${role.pool_count} in pool` : "no matches"}`);
  }
  const skills = Array.isArray(validation.skills) ? validation.skills : [];
  for (const sk of skills) {
    if (!sk || !sk.skill) continue;
    lines.push(`Skill “${sk.skill}”: ${sk.matched ? `${sk.pool_count} in pool` : "no matches"}`);
  }
  const diff = validation.difficulty || {};
  if (diff.filter) {
    lines.push(`Difficulty (${diff.filter}): ${diff.matched ? `${diff.pool_count} in pool` : "no matches"}`);
  }
  const cat = validation.category || {};
  if (cat.filter) {
    lines.push(`Category (${cat.filter}): ${cat.matched ? `${cat.pool_count} in pool` : "no matches"}`);
  }
  const total = Number(validation.total_active_in_bank);
  const matched = Number(validation.matching_after_all_filters);
  const required = Number(validation.required_count);
  if (Number.isFinite(total)) lines.push(`Active questions in bank: ${total}`);
  if (Number.isFinite(matched) && Number.isFinite(required)) {
    lines.push(`Matching all filters: ${matched} (need ${required})`);
  }
  return lines.join("\n");
}
function _showInviteLoginError(message, { allowRetry = true, validation = null } = {}) {
  const msg = String(message || "Could not start interview session.").trim();
  const breakdown = _formatQuestionBankValidation(validation);
  const display = breakdown ? `${msg}\n\n${breakdown}` : msg;
  _hideInviteLoadingOverlay();
  const welcome = document.getElementById("screenInviteWelcome");
  const startBtn = document.getElementById("inviteWelcomeStartBtn");
  const subEl = document.getElementById("inviteWelcomeSubtitle");
  const titleEl = document.getElementById("inviteWelcomeTitle");
  const layout = document.getElementById("mainLayout");
  if (layout) layout.classList.add("hidden");
  document.body.classList.remove("interview-mode");
  if (welcome) welcome.classList.add("active");
  if (titleEl) titleEl.textContent = "Unable to start interview";
  if (subEl) {
    subEl.textContent = display;
    subEl.style.whiteSpace = breakdown ? "pre-line" : "";
  }
  if (startBtn) {
    startBtn.hidden = !allowRetry;
    startBtn.textContent = allowRetry ? "Try again" : "Start Interview";
    if (allowRetry) {
      startBtn.onclick = (ev) => {
        ev.preventDefault();
        startBtn.hidden = true;
        startBtn.textContent = "Start Interview";
        startBtn.onclick = null;
        _showInviteLoadingOverlay("Retrying interview session...");
        void proceedWithInviteLogin();
      };
    }
  }
  const q = document.getElementById("candidateQuestion");
  const status = document.getElementById("candidateStatus");
  if (q) q.innerText = display;
  if (status) status.innerText = "Interview could not start";
  setAuthStatus(display);
}
function _startInviteStartupSequence() {
  if (_inviteStartupHandle) {
    clearInterval(_inviteStartupHandle);
    _inviteStartupHandle = null;
  }
  const stages = [
    "Initializing AI interviewer...",
    "Preparing technical assessment...",
    "Loading interview context...",
    "AI interviewer ready...",
  ];
  let i = 0;
  _setInviteStartupState(stages[0]);
  _inviteStartupHandle = window.setInterval(() => {
    i = (i + 1) % stages.length;
    _setInviteStartupState(stages[i]);
  }, 900);
}
function _stopInviteStartupSequence() {
  if (_inviteStartupHandle) {
    clearInterval(_inviteStartupHandle);
    _inviteStartupHandle = null;
  }
}
function _formatHhMmSs(totalSeconds) {
  const s = Math.max(0, Number(totalSeconds) || 0);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
function startInviteCountdown(seconds, onDone) {
  if (_inviteCountdownHandle) {
    clearTimeout(_inviteCountdownHandle);
    _inviteCountdownHandle = null;
  }
  let left = Math.max(0, Number(seconds) || 0);
  const tick = async () => {
    const timerEl = document.getElementById("interviewTimer");
    if (timerEl) {
      timerEl.classList.add("countdown-active");
      timerEl.innerText = _formatHhMmSs(left);
    }
    const msg = left > 0
      ? `Interview starts in: ${_formatHhMmSs(left)}`
      : "Scheduled time reached. Starting interview...";
    setAuthStatus(msg);
    const q = document.getElementById("candidateQuestion");
    if (q) q.innerText = msg;
    if (left <= 0) {
      if (timerEl) timerEl.classList.remove("countdown-active");
      setAuthStatus("Preparing your interview session...");
      const prepQ = document.getElementById("candidateQuestion");
      if (prepQ) prepQ.innerText = "Preparing your interview session...";
      try {
        await onDone();
      } catch (err) {
        const msg = (err && err.message) ? String(err.message) : "Failed to start interview.";
        setAuthStatus(msg);
        const q = document.getElementById("candidateQuestion");
        if (q) q.innerText = `Error: ${msg}`;
        console.error("[INTERVIEW] Start failed", err);
        left = 5;
        _inviteCountdownHandle = window.setTimeout(tick, 1000);
      }
      return;
    }
    left = Math.max(0, left - 1);
    _inviteCountdownHandle = window.setTimeout(tick, 1000);
  };
  void tick();
}

function _inviteDeviceStorageKey() {
  return inviteTokenFromUrl ? `karnexInviteDevice:${inviteTokenFromUrl}` : "karnexInviteDevice";
}
function _readInviteDeviceId() {
  try {
    return window.localStorage.getItem(_inviteDeviceStorageKey()) || "";
  } catch (_) {
    return "";
  }
}
function _writeInviteDeviceId(value) {
  const v = String(value || "").trim();
  if (!v) return;
  try {
    window.localStorage.setItem(_inviteDeviceStorageKey(), v);
  } catch (_) {
    /* ignore */
  }
}
function _ensureInviteDeviceId() {
  if (_verifiedDeviceId) return _verifiedDeviceId;
  _verifiedDeviceId = _readInviteDeviceId() || crypto.randomUUID();
  _writeInviteDeviceId(_verifiedDeviceId);
  return _verifiedDeviceId;
}

let _verifiedDeviceId = _readInviteDeviceId();

function showVerificationScreen() {
  const gate = document.getElementById("candVerifyGate");
  if (gate) gate.removeAttribute("hidden");
  const status = document.getElementById("verifyStatus");
  if (status) status.textContent = "";
  const btn = document.getElementById("verifySubmitBtn");
  if (btn) btn.disabled = false;
}

function hideVerificationScreen() {
  const gate = document.getElementById("candVerifyGate");
  if (gate) gate.setAttribute("hidden", "");
}

/** Full-screen thank-you or terminated state for finished invite links (not the HR login card). */
function showInviteTerminalState(state, extras = {}) {
  const done = document.getElementById("screenInviteCompleted");
  const term = document.getElementById("screenInviteTerminated");
  const auth = document.getElementById("screenAuth");
  const startup = document.getElementById("screenStartup");
  const layout = document.getElementById("mainLayout");
  hideVerificationScreen();
  if (auth) auth.classList.remove("active");
  if (startup) startup.classList.remove("active");
  if (layout) layout.classList.add("hidden");
  document.body.classList.remove("interview-mode");
  if (done) done.classList.toggle("active", state === "completed");
  if (term) term.classList.toggle("active", state === "terminated");
  const personal = document.getElementById("inviteCompletedPersonal");
  const name = extras && extras.candidate_name ? String(extras.candidate_name).trim() : "";
  if (personal) {
    if (state === "completed" && name) {
      personal.removeAttribute("hidden");
      personal.textContent = `Thank you, ${name}.`;
    } else {
      personal.setAttribute("hidden", "");
      personal.textContent = "";
    }
  }
  setAuthStatus("");
}

async function handleVerifySubmit() {
  const emailEl = document.getElementById("verifyEmail");
  const keyEl = document.getElementById("verifyAccessKey");
  const statusEl = document.getElementById("verifyStatus");
  const btn = document.getElementById("verifySubmitBtn");

  const email = (emailEl ? emailEl.value : "").trim();
  const key = (keyEl ? keyEl.value : "").trim();

  if (!email || !key) {
    if (statusEl) statusEl.textContent = "Please enter both email and access key.";
    return;
  }
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = "Verifying...";

  try {
    const fd = new FormData();
    fd.append("email", email);
    fd.append("access_key", key);
    const res = await apiFetch(`/candidate/invite/${encodeURIComponent(inviteTokenFromUrl)}/verify`, {
      method: "POST",
      body: fd,
      headers: { "x-device-id": _ensureInviteDeviceId() },
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      const st = data.invite_state;
      if (st === "completed" || st === "terminated") {
        showInviteTerminalState(st, { candidate_name: data.candidate_name });
        if (btn) btn.disabled = false;
        return;
      }
      if (statusEl) statusEl.textContent = data.error || "Verification failed.";
      if (btn) btn.disabled = false;
      return;
    }
    _verifiedDeviceId = data.device_id || _verifiedDeviceId || "";
    _writeInviteDeviceId(_verifiedDeviceId);
    hideVerificationScreen();
    await proceedWithInviteLogin();
  } catch (err) {
    if (statusEl) statusEl.textContent = err.message || "Verification failed.";
    if (btn) btn.disabled = false;
  }
}

async function proceedWithInviteLogin() {
  if (_inviteLoginInFlight) return _inviteLoginInFlight;
  _inviteLoginInFlight = (async () => {
    const headers = {};
    headers["x-device-id"] = _ensureInviteDeviceId();
    _setCandidateStartupControlsDisabled(true);
    _showInviteLoadingOverlay("Starting interview session...");
    _setInviteStartupState("Starting interview session...");
    console.info("[STEP-2] Session creation started");
    const loginStartedAt = Date.now();
    const slowTimer = window.setTimeout(() => {
      _startInviteStartupSequence();
    }, 900);
    try {
      const res = await apiFetch(`/candidate/invite/${encodeURIComponent(inviteTokenFromUrl)}/login`, {
        method: "POST",
        headers,
      }, { timeoutMs: 90000 });
      const data = await res.json();
      console.info("[STEP-3] Session created", {
        status: data.status,
        ms: Date.now() - loginStartedAt,
        boot_reused: data.boot_reused,
        question_count: data.question_count,
      });
      if (!res.ok || data.error) {
        _setCandidateStartupControlsDisabled(false);
        const st = data.invite_state;
        if (st === "completed" || st === "terminated") {
          showInviteTerminalState(st, { candidate_name: data.candidate_name });
          return;
        }
        const loginErr = new Error(data.error || `Request failed with status ${res.status}`);
        if (data.validation && typeof data.validation === "object") {
          loginErr.validation = data.validation;
        }
        throw loginErr;
      }
      if ((data.status || "") === "scheduled_wait") {
        _setCandidateStartupControlsDisabled(true);
        const schedule = data.schedule || {};
        const q = document.getElementById("candidateQuestion");
        const aiState = document.getElementById("aiState");
        const meta = document.getElementById("candidateMeta");
        if (meta) {
          meta.innerText = `Name: ${schedule.candidate_name || "Candidate"} | Scheduled: ${schedule.scheduled_at_local || "-"} | Mode: Auto Start`;
        }
        if (q) q.innerText = "Interview starts in: 00:00:00";
        if (aiState) aiState.innerText = "Interview scheduled";
        startInviteCountdown(data.seconds_until_start || 0, () => {
          proceedWithInviteLogin();
        });
        return;
      }
      const user = data.user || {};
      const token = data.access_token || "";
      if (!token) throw new Error("Access token missing for invite login.");
      _deferCandidateProctoring = true;
      saveAuthSession(user, token, data.expires_at_ist || "");
      _hideInviteLoadingOverlay();
      revealAppAfterAuth(user);
      const schedule = data.schedule || {};
      const meta = document.getElementById("candidateMeta");
      if (meta) {
        meta.innerText = `Name: ${schedule.candidate_name || user.full_name || "Candidate"} | Scheduled: ${schedule.scheduled_at_local || "-"} | Mode: Invite Link`;
      }
      console.info("[STEP-7] Timer started");
      startInterviewTimer();
      _setInviteStartupState("Entering fullscreen mode...");
      const fullscreenOk = await requireFullscreenBeforeInterview();
      if (!fullscreenOk) {
        throw new Error("Fullscreen is required to start the interview. Click Enter Fullscreen to continue.");
      }
      _setInviteStartupState("Loading first question...");
      console.info("[STEP-4] Question loading started");
      const loaded = await loadQuestion({ throwOnError: true });
      if (!loaded) {
        throw new Error("Failed to load the first interview question.");
      }
      console.info("[STEP-5] Question loaded");
      _deferCandidateProctoring = false;
      void initProctoring().catch((err) => {
        console.warn("[VAD] Proctoring init deferred", err);
      });
      activateInterviewSecurity();
      startFaceMonitoring(() => document.getElementById("proctorCam"));
      console.info("[STEP-8] Candidate active");
      _setCandidateStartupControlsDisabled(false);
      const status = document.getElementById("candidateStatus");
      if (status && /initializing|preparing|loading interview context|starting interview session|ready/i.test(status.innerText || "")) {
        status.innerText = "";
      }
    } catch (err) {
      _setCandidateStartupControlsDisabled(false);
      const msg = err?.message || "Could not start interview session.";
      _showInviteLoginError(msg, { validation: err?.validation || null });
      return;
    } finally {
      clearTimeout(slowTimer);
      _stopInviteStartupSequence();
    }
  })().finally(() => {
    _inviteLoginInFlight = null;
    _stopInviteStartupSequence();
  });
  return _inviteLoginInFlight;
}

/**
 * Show the candidate Welcome card (Feature 1, May 2026).
 *
 * Returns a promise that resolves when the candidate clicks "Start Interview".
 *
 * The welcome screen MUST stay visible until the user clicks Start; no auto-skips,
 * no race-condition redirects. We also non-destructively
 * fetch the invite metadata in the background to personalize the greeting,
 * but we do NOT block UI on it — if the request fails or is slow, the candidate
 * still sees the welcome card without any flash.
 */
function showCandidateWelcome() {
  return new Promise((resolve) => {
    const welcome = document.getElementById("screenInviteWelcome");
    const startup = document.getElementById("screenStartup");
    const auth = document.getElementById("screenAuth");
    const layout = document.getElementById("mainLayout");
    if (startup) startup.classList.remove("active");
    if (auth) auth.classList.remove("active");
    if (layout) layout.classList.add("hidden");
    document.body.classList.remove("interview-mode");
    if (!welcome) {
      // Defensive: if HTML is older than the JS bundle, do not block the candidate.
      resolve("start");
      return;
    }
    welcome.classList.add("active");

    const startBtn = document.getElementById("inviteWelcomeStartBtn");
    const cleanup = () => {
      welcome.classList.remove("active");
      if (startBtn) startBtn.removeEventListener("click", onStart);
    };
    const finishBootstrap = () => {
      try { document.documentElement.removeAttribute("data-invite-bootstrap"); } catch (_) { /* ignore */ }
    };
    const onStart = (ev) => { ev.preventDefault(); cleanup(); finishBootstrap(); resolve("start"); };
    if (startBtn) startBtn.addEventListener("click", onStart);

    // Background personalization — best-effort, non-blocking.
    if (inviteTokenFromUrl) {
      void apiFetch(`/candidate/invite/${encodeURIComponent(inviteTokenFromUrl)}`)
        .then(async (res) => {
          if (!res.ok) return;
          const data = await res.json().catch(() => null);
          if (!data) return;
          const schedule = data.schedule || {};
          const nameEl = document.getElementById("inviteWelcomeName");
          const subEl = document.getElementById("inviteWelcomeSubtitle");
          const metaEl = document.getElementById("inviteWelcomeMeta");
          // Capture the template's format so the rules screen can state the
          // real duration and question count instead of a generic promise.
          _inviteInterviewConfig = {
            timing_mode: schedule.timing_mode || data.timing_mode,
            time_limit_sec: schedule.time_limit_sec ?? data.time_limit_sec,
            num_questions:
              schedule.num_questions ?? schedule.num_q ?? data.num_questions ?? data.num_q,
          };
          applyRulesConfig(_inviteInterviewConfig);

          const candidate = String(schedule.candidate_name || "").trim();
          if (candidate && nameEl) nameEl.textContent = `, ${candidate}`;
          if (subEl && schedule.job_title) {
            subEl.innerHTML = `Your secure AI interview for <strong>${schedule.job_title}</strong> is ready to begin. ` +
              "Please review the quick checklist below, then click <strong>Start Interview</strong> when you are ready.";
          }
          if (metaEl && schedule.scheduled_at_local) {
            metaEl.hidden = false;
            metaEl.textContent = `Scheduled: ${schedule.scheduled_at_local}`;
          }
        })
        .catch(() => { /* ignore — welcome card stays generic */ });
    }
  });
}

async function autoLoginFromInviteToken() {
  if (!inviteTokenFromUrl) return false;
  try {
    const auth = document.getElementById("screenAuth");
    const startup = document.getElementById("screenStartup");
    const welcome = document.getElementById("screenInviteWelcome");
    const layout = document.getElementById("mainLayout");
    if (auth) auth.classList.remove("active");
    if (startup) startup.classList.remove("active");
    if (welcome) welcome.classList.remove("active");
    hideDeviceTestGate();
    if (layout) layout.classList.add("hidden");
    document.body.classList.remove("interview-mode");
    _showInviteLoadingOverlay("Connecting to your interview session...");

    _verifiedDeviceId = _ensureInviteDeviceId();

    const lookupRes = await apiFetch(`/candidate/invite/${encodeURIComponent(inviteTokenFromUrl)}`);
    const lookup = await lookupRes.json();

    if (!lookupRes.ok || lookup.error) {
      const st = lookup.invite_state;
      if (st === "completed" || st === "terminated") {
        _hideInviteLoadingOverlay();
        showInviteTerminalState(st, { candidate_name: lookup.candidate_name });
        return false;
      }
      _showInviteLoginError(lookup.error || "Invite link error.");
      return false;
    }

    const schedule = lookup.schedule || {};
    const hasAccessKey = !!(schedule.access_key);

    if (hasAccessKey) {
      _hideInviteLoadingOverlay();
      if (layout) layout.classList.remove("hidden");
      document.body.classList.add("interview-mode");
      applyRoleAccess("candidate");
      showScreen("candidate");
      showVerificationScreen();
      return true;
    }

    await proceedWithInviteLogin();
    return true;
  } catch (err) {
    _showInviteLoginError(`Invite link error: ${err.message}`);
    return false;
  }
}

window.handleVerifySubmit = handleVerifySubmit;

window.showScreen = showScreen;
window.setupInterview = setupInterview;
window.extractSkillsOnly = extractSkillsOnly;
window.scheduleInterview = scheduleInterview;
window.setScheduleFilter = setScheduleFilter;
window.loadInterviewSchedules = loadInterviewSchedules;
window.loadHrRecords = loadHrRecords;
window.loadJobConfigs = loadJobConfigs;
window.applySelectedJobConfig = applySelectedJobConfig;
window.downloadSelectedRecord = downloadSelectedRecord;
window.downloadLatestReportExcel = downloadLatestReportExcel;
window.saveJobConfig = saveJobConfig;
window.computeAtsPreview = computeAtsPreview;
window.loadRankedCandidates = loadRankedCandidates;
window.downloadInterviewQaTxt = downloadInterviewQaTxt;
window.downloadInterviewQaPdf = downloadInterviewQaPdf;
window.submitCandidateAnswer = submitCandidateAnswer;
window.cancelAutoAdvance = cancelAutoAdvance;
window.submitAutoAdvanceNow = submitAutoAdvanceNow;
window.submitInterview = (...args) => {
  stopFaceMonitoring();
  deactivateInterviewSecurity();
  return submitInterview(...args);
};
window.unlockResult = unlockResult;
window.enterFullscreen = enterFullscreen;
window.toggleMicInput = toggleMicInput;
window.reopenMediaPermissionGate = reopenMediaPermissionGate;
window.printManagementReport = printManagementReport;
window.startSystem = startSystem;
window.registerUser = registerUser;
window.loginUser = loginUser;
window.logoutUser = logoutUser;
window.refreshSidebarProfileClock = refreshSidebarProfileClock;
window.switchAuthPane = switchAuthPane;
window.switchAuthMode = (mode) => switchAuthMode(mode, registerUser, loginUser);

loadModels();
initUiSettings();
initBackground();
initAvatar();
window.addEventListener("storage", (e) => {
  if ((e.key === "authToken" || e.key === "authUser") && e.oldValue && !e.newValue) {
    try {
      window.location.reload();
    } catch (_) {
      /* ignore */
    }
  }
});
window.addEventListener("kx-auth-lost", () => {
  try {
    window.location.replace(`${window.location.pathname}${window.location.search || ""}`);
  } catch (_) {
    window.location.reload();
  }
});
switchAuthPane("hr");
switchAuthMode("login", registerUser, loginUser);
initAuthMotion((mode) => switchAuthMode(mode, registerUser, loginUser));
initAuthEnterSubmit(loginUser, registerUser);
initBrandLogoFallback();
initHrSetupUi();
initHrAccessDetailsUi();
initAutoAdvanceBannerUi();
maybeAutoClearCache("hr");

/**
 * Welcome → Device Test → Invite Login flow (Features 1 + 4, May 2026).
 *
 * Previously the page silently auto-logged in as soon as `?invite=…` was
 * present, which made the welcome card flicker for <1s. The new flow always
 * pauses on the welcome screen until the candidate clicks a button, then runs
 * the mandatory device test gate, and only then proceeds with the existing
 * `autoLoginFromInviteToken` server handshake.
 */
async function bootstrapInviteFlow() {
  if (!inviteTokenFromUrl) {
    // Non-invite / HR boot:
    //   - If a valid session exists  → restoreSessionIfPossible() reveals the app.
    //   - Otherwise                  → KEEP the "Karnex AI Interview Platform"
    //                                  startup hero visible (it stays `active`
    //                                  from HTML). The user must click the
    //                                  hero's "Login" button to reach the
    //                                  "Welcome back" auth card.
    //
    // Previously we eagerly added `active` to `#screenAuth` here which made
    // the auth card cover the startup hero on every fresh page load — the
    // candidate-facing welcome flow has the same "no auto-skip" requirement.
    //
    // Exception (July 2026): a password-reset deep link (?reset_token=...)
    // must land directly on the auth screen's Reset pane — the pane itself is
    // driven by js/auth/passwordReset.js; here we only keep the screen open.
    let hasResetToken = false;
    try {
      hasResetToken = new URLSearchParams(window.location.search).has("reset_token");
    } catch (_) {
      /* ignore */
    }
    if (hasResetToken) {
      const auth = document.getElementById("screenAuth");
      if (auth) auth.classList.add("active");
      const startup = document.getElementById("screenStartup");
      if (startup) startup.classList.remove("active");
      return Promise.resolve();
    }
    return restoreSessionIfPossible().then((ok) => {
      if (ok) return;
      const auth = document.getElementById("screenAuth");
      if (auth) auth.classList.remove("active");
      const startup = document.getElementById("screenStartup");
      if (startup) startup.classList.add("active");
    });
  }
  console.info("[STEP-1] Interview page opened", { invite: inviteTokenFromUrl ? "present" : "none" });
  while (true) {
    await showCandidateWelcome();

    // Rules BEFORE the device test: the candidate should know what they are
    // consenting to before they start granting camera and microphone access.
    const acknowledged = await runInterviewRulesGate({ config: _inviteInterviewConfig });
    if (!acknowledged) continue; // "Back" — return to the welcome screen

    const passed = await runDeviceTestGate();
    if (!passed) {
      // Candidate hit "Back" — return to welcome screen instead of redirecting.
      continue;
    }
    // Defense-in-depth (May 2026):
    // Even if the UI path returns "passed", require persisted mandatory checks
    // before starting invite login.
    const deviceState = readPersistedDeviceTestState();
    const mandatoryVerified = Boolean(
      deviceState &&
      deviceState.microphone_verified === true &&
      deviceState.speaker_verified === true &&
      deviceState.internet_verified === true
    );
    if (!mandatoryVerified) {
      console.warn("[device-test] Mandatory checks not verified; re-running gate.");
      continue;
    }
    await autoLoginFromInviteToken();
    return;
  }
}

void bootstrapInviteFlow();
