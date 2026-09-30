/**
 * Warm-up question countdown (23 Sep 2026).
 * =========================================
 *
 * "Please introduce yourself." is not scored, so an open-ended answer only
 * spends the interview clock. The server sends `warmup_time_limit_sec` on the
 * warm-up payload (default 60, `INTERVIEW_WARMUP_TIME_LIMIT_SEC`); this module
 * counts it down ON the question so the candidate sees it, and at zero hands
 * the turn to `onExpire` — the caller submits whatever was said (a skip that
 * carries a transcript is stored as the answer) and the next question loads.
 *
 * Rules
 * -----
 * * The clock starts when the candidate CAN speak (mic open), not while the
 *   AI is still reading the question — otherwise a slow TTS eats their time.
 * * Applies to the warm-up only. Scored questions keep the auto-advance
 *   silence rules; this never touches them.
 * * `stop()` is idempotent and is called from every turn/teardown path, so a
 *   stale timer can never fire into the next question.
 * * Purely presentational + one callback: no fetch, no state.js writes.
 */

const TIMER_ID = "candidateWarmupTimer";
const WARN_AT_SEC = 10;

let _handle = null;
let _deadline = 0;
let _onExpire = null;

function _format(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function _element(create) {
  let el = document.getElementById(TIMER_ID);
  if (!el && create) {
    const note = document.getElementById("candidateWarmupNote");
    const question = document.getElementById("candidateQuestion");
    const anchor = note || question;
    if (!anchor || !anchor.parentElement) return null;
    el = document.createElement("div");
    el.id = TIMER_ID;
    el.className = "cand-warmup-timer";
    el.setAttribute("role", "timer");
    el.setAttribute("aria-live", "polite");
    anchor.parentElement.insertBefore(el, anchor.nextSibling);
  }
  return el;
}

function _render(secondsLeft) {
  const el = _element(true);
  if (!el) return;
  el.style.display = "";
  el.classList.toggle("is-warning", secondsLeft <= WARN_AT_SEC);
  el.innerHTML = `<span class="cand-warmup-timer-dot"></span>Time for this question: <strong>${_format(secondsLeft)}</strong>`;
}

function _tick() {
  const left = Math.ceil((_deadline - Date.now()) / 1000);
  if (left > 0) {
    _render(left);
    return;
  }
  const cb = _onExpire;
  stopWarmupCountdown({ keepVisible: true });
  _render(0);
  try {
    if (typeof cb === "function") cb();
  } catch (err) {
    console.warn("[WARMUP-TIMER] onExpire failed", err);
  }
}

/**
 * @param {number} seconds  limit from the server payload; <= 0 means "no limit".
 * @param {() => void} onExpire  called once when the limit is reached.
 * @returns {boolean} whether a countdown is running.
 */
export function startWarmupCountdown(seconds, onExpire) {
  stopWarmupCountdown();
  const total = Number(seconds) || 0;
  if (total <= 0) return false;
  _onExpire = onExpire;
  _deadline = Date.now() + total * 1000;
  _render(total);
  _handle = window.setInterval(_tick, 250);
  console.info("[WARMUP-TIMER] started", { seconds: total });
  return true;
}

/** Idempotent. Hides the badge unless `keepVisible` (the 0:00 moment). */
export function stopWarmupCountdown({ keepVisible = false } = {}) {
  if (_handle) {
    window.clearInterval(_handle);
    _handle = null;
  }
  _onExpire = null;
  _deadline = 0;
  if (!keepVisible) {
    const el = _element(false);
    if (el) el.style.display = "none";
  }
}

export function isWarmupCountdownRunning() {
  return !!_handle;
}
