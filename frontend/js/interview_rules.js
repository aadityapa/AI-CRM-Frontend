/**
 * Pre-interview rules gate.
 *
 * The welcome card gives advice ("sit somewhere quiet"). This screen states the
 * rules that are actually enforced in code — fullscreen, tab switching, the
 * disabled keyboard, proctoring, and how the interview ends — and requires an
 * explicit acknowledgement before the candidate can continue.
 *
 * That ordering matters: a candidate whose interview is auto-terminated for
 * switching tabs must have been told, in plain words, that switching tabs ends
 * the interview. Enforcing a rule nobody was shown is not a security feature,
 * it is a trap.
 *
 * Resolves true when acknowledged, false when the candidate backs out.
 */

const SCREEN_ID = "screenInterviewRules";

/** Format a duration the way a person would say it. */
function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (!total) return null;
  const mins = Math.round(total / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (!rest) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours}h ${rest}m`;
}

/**
 * Show the real numbers from the template rather than a generic promise.
 * `config` may be partial — anything missing simply reads "—".
 */
export function applyRulesConfig(config = {}) {
  const durationEl = document.getElementById("rulesDuration");
  const questionsEl = document.getElementById("rulesQuestions");
  const endEl = document.getElementById("rulesEndCondition");

  const timingMode = String(config.timing_mode || "count").toLowerCase();
  const duration = formatDuration(config.time_limit_sec);
  const count = Number(config.num_questions || config.total || 0) || 0;

  if (durationEl) durationEl.textContent = duration || "No fixed limit";
  if (questionsEl) questionsEl.textContent = count ? String(count) : "Varies";

  if (endEl) {
    if (duration && count) {
      endEl.textContent =
        `It submits automatically after ${duration} or after ${count} questions`;
    } else if (duration) {
      endEl.textContent = `It submits automatically after ${duration}`;
    } else if (count) {
      endEl.textContent = `It submits automatically after ${count} questions`;
    } else {
      endEl.textContent =
        timingMode === "time"
          ? "It submits automatically when the time runs out"
          : "It submits automatically when the questions run out";
    }
  }
}

/**
 * Present the rules and wait for a decision.
 * @returns {Promise<boolean>} true = acknowledged, false = went back.
 */
export function runInterviewRulesGate({ config } = {}) {
  const screen = document.getElementById(SCREEN_ID);
  const ack = document.getElementById("interviewRulesAck");
  const continueBtn = document.getElementById("interviewRulesContinueBtn");
  const backBtn = document.getElementById("interviewRulesBackBtn");

  // If the markup is missing (older shell, or the screen was removed), do not
  // block the interview — just proceed as before.
  if (!screen || !ack || !continueBtn) {
    return Promise.resolve(true);
  }

  if (config) applyRulesConfig(config);

  // Always start unticked. A reload must not inherit a previous consent.
  ack.checked = false;
  continueBtn.disabled = true;

  // Same visibility handling as the device-test gate: the app's showScreen()
  // only knows the "hr" and "candidate" screens, so startup screens swap
  // themselves. `hidden` is cleared too because the markup ships hidden.
  document
    .querySelectorAll(".startup-screen.active, .auth-screen.active")
    .forEach((s) => s.classList.remove("active"));
  screen.hidden = false;
  screen.classList.add("active");

  return new Promise((resolve) => {
    const finish = (result) => {
      ack.removeEventListener("change", onToggle);
      continueBtn.removeEventListener("click", onContinue);
      if (backBtn) backBtn.removeEventListener("click", onBack);
      screen.classList.remove("active");
      screen.hidden = true;
      resolve(result);
    };

    const onToggle = () => {
      continueBtn.disabled = !ack.checked;
    };
    const onContinue = () => {
      if (!ack.checked) return;
      finish(true);
    };
    const onBack = () => finish(false);

    ack.addEventListener("change", onToggle);
    continueBtn.addEventListener("click", onContinue);
    if (backBtn) backBtn.addEventListener("click", onBack);
  });
}

/**
 * Explain a swallowed keypress. The keyboard is disabled during the interview,
 * and a key that does nothing with no explanation reads as a broken page.
 * Throttled by the security module, which only emits this occasionally.
 */
export function bindKeyboardBlockedNotice(showToast) {
  if (typeof showToast !== "function") return;
  window.addEventListener("karnex:keyboard-blocked", () => {
    showToast("Keyboard is disabled during the interview — please answer by speaking.");
  });
}
