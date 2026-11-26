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

/** Hide / show an element. */
function _toggle(id, on) {
  const el = document.getElementById(id);
  if (el) el.hidden = !on;
}

function _setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/**
 * Show the REAL format of this interview (12 Oct 2026). Everything comes from
 * the server's `_interview_format` on the invite lookup: how it ends (time
 * limit OR question count — never both), how many questions and of what kind,
 * whether the candidate chooses skills, typed questions, follow-ups and
 * whether a recruiter may join. `config` may be partial — an older server
 * sends only timing_mode / time_limit_sec / num_q.
 */
/** The rules line for the template's anti-cheating checks — hidden when none. */
function _applyProctoringRule(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const parts = [];
  if (p.headphones && p.headphones !== "off") {
    parts.push(p.headphones === "require" ? "headphones must be connected (we test them)" : "please use headphones (we test them)");
  }
  if (p.lighting && p.lighting !== "off") parts.push("sit in good light, facing it — not with a window behind you");
  if (p.gesture_check) parts.push("show your hands and a gesture we name before you start");
  if (Number(p.gesture_prompts) > 0) parts.push("now and then a small card asks for a quick hand gesture while you answer");
  if (p.gaze_calibration) parts.push("a 10-second eye calibration (follow a dot)");
  if (p.reading_detection) parts.push("eye movements that look like reading are flagged for the reviewer");
  if (p.room_scan) parts.push("show your room on camera before the first question (recorded)");
  const li = document.getElementById("rulesProctorRule");
  const text = document.getElementById("rulesProctorText");
  if (!li || !text) return;
  li.hidden = !parts.length;
  text.textContent = parts.length
    ? `${parts.map((x, i) => (i ? x : x.charAt(0).toUpperCase() + x.slice(1))).join("; ")}. A recruiter may also watch live — you will see a notice when they do.`
    : "";
}

/**
 * A phone interview (25 Nov 2026, the template allowed one): the rules speak
 * of the phone — no full screen, no screen share, no other apps or split
 * screen, keep it upright. Only when THIS page runs in phone mode.
 */
function _applyPhoneRules(devices) {
  const phone =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("kx-phone") &&
    !!(devices && devices.allow_phone);
  if (!phone) return false;
  _setText("rulesStayRuleTitle", "Stay in this page, on the whole screen.");
  _setText(
    "rulesStayRuleText",
    "Opening another app, split screen or a floating window, a call or leaving the page each counts as a warning. After 3 warnings, the next one ends the interview and submits what you have answered.",
  );
  _setText("rulesDeviceRuleTitle", "Your phone, held upright, with the camera on you.");
  _setText(
    "rulesDeviceRuleText",
    "Prop it up at eye level if you can, in a quiet, well-lit place. Turn on Do Not Disturb so calls and notifications do not interrupt.",
  );
  _setText("rulesRecordRuleTitle", "Camera and microphone are recorded.");
  _setText("rulesRecordRuleText", "A phone cannot share its screen, so only the camera and microphone are recorded. The hiring team reviews the recording.");
  _setText("rulesReopenText", "On the same phone you continue from where you left off — answers already sent are saved.");
  _setText(
    "rulesConsentText",
    "I have read these rules, and I agree to my camera and microphone being recorded and proctored for this interview.",
  );
  return true;
}

export function applyRulesConfig(config = {}) {
  const timingMode = String(config.timing_mode || "count").toLowerCase();
  const timed = timingMode === "time";
  const limitSec = timed ? Number(config.time_limit_sec) || 0 : 0;
  const duration = formatDuration(limitSec);
  const count = Number(config.num_questions ?? config.num_q ?? config.total ?? 0) || 0;
  const mix = config.question_mix && typeof config.question_mix === "object" ? config.question_mix : null;
  const spoken = mix ? Number(mix.spoken) || 0 : count;
  const pseudo = mix ? Number(mix.pseudo) || 0 : 0;
  const coding = mix ? Number(mix.coding) || 0 : 0;
  const typed = pseudo + coding > 0;
  const varies = !!config.mix_varies;
  const estimate = Number(config.minutes_estimate) || 0;

  // Anti-cheating checks the template turned on (13 Nov 2026).
  _applyProctoringRule(config.proctoring);
  const phone = _applyPhoneRules(config.devices);

  // Time
  if (timed && duration) {
    _setText("rulesDuration", duration);
    _setText("rulesDurationHint", "Hard stop — the interview ends on the clock.");
  } else {
    _setText("rulesDuration", "No time limit");
    _setText("rulesDurationHint", estimate ? `Usually about ${formatDuration(estimate * 60)}.` : "Take the time you need for each answer.");
  }

  // Questions — the KINDS only, never how many (26 Nov 2026, user rule: the
  // candidate does not see the total; the screen shows only what they attempt).
  void count;
  void varies;
  const kinds = [spoken || !typed ? "spoken" : "", pseudo ? "pseudo-code" : "", coding ? "coding" : ""].filter(Boolean);
  _setText(
    "rulesQuestions",
    kinds.length > 1 ? `${kinds.slice(0, -1).join(", ")} & ${kinds[kinds.length - 1]}`.replace(/^./, (c) => c.toUpperCase()) : "Spoken",
  );
  _setText(
    "rulesQuestionsHint",
    timed && duration ? `As many as fit in ${duration}, after a short introduction.` : "After a short, unscored introduction.",
  );
  const mixEl = document.getElementById("rulesMix");
  if (mixEl) {
    const chips = [];
    if (spoken) chips.push(`<span class="rv-mix-chip rv-mix-chip--spoken">Spoken</span>`);
    if (pseudo) chips.push(`<span class="rv-mix-chip rv-mix-chip--pseudo">Pseudo-code</span>`);
    if (coding) chips.push(`<span class="rv-mix-chip rv-mix-chip--coding">Coding</span>`);
    mixEl.innerHTML = chips.join("");
    mixEl.hidden = !(typed && chips.length);
  }

  // How you answer
  _setText("rulesAnswerBy", typed ? "Speaking + on screen" : "Speaking");
  _setText(
    "rulesAnswerHint",
    typed
      ? "Spoken questions are read aloud; pseudo-code and coding ones appear on screen."
      : "The AI reads each question aloud — you answer by speaking.",
  );

  // Skills the candidate picks
  const choice = config.skills_choice && typeof config.skills_choice === "object" ? config.skills_choice : null;
  const skillsEl = document.getElementById("rulesSkillsNote");
  if (skillsEl) {
    if (choice && Number(choice.max) > 0) {
      const lo = Number(choice.min) || 1;
      const hi = Number(choice.max) || lo;
      skillsEl.textContent =
        `Before the first question you choose ${lo === hi ? lo : `${lo}–${hi}`} skill${hi === 1 ? "" : "s"} you have worked on; the questions come from those skills.`;
      skillsEl.hidden = false;
    } else {
      skillsEl.hidden = true;
    }
  }

  // Typed questions + the keyboard rule
  _toggle("rulesTypedRule", typed);
  if (typed) {
    const tm = config.typed_minutes || {};
    const parts = [];
    if (pseudo) parts.push(`pseudo-code: pick the right option (${Number(tm.pseudo) || 2} min each)`);
    if (coding) parts.push(`coding: write your code in the editor (${Number(tm.coding) || 10} min each)`);
    _setText("rulesTypedText", `Each has its own timer — ${parts.join("; ")}. Copy and paste stay off.`);
    _setText(
      "rulesKeyboardText",
      "Typing works only inside the code editor of a coding question. Everywhere else — and copy / paste — the keyboard is off; use the mouse for buttons.",
    );
  } else {
    _setText("rulesKeyboardText", "You answer by speaking, so typing, copy and paste are off. Use the mouse for the buttons.");
  }
  if (phone) {
    _setText(
      "rulesKeyboardText",
      typed
        ? "The phone keyboard works only inside the code box of a coding question; copy and paste stay off. Tap the buttons to answer."
        : "You answer by speaking — tap Send Response when you finish. Copy and paste are off.",
    );
  }

  // Follow-ups, recruiter, recording
  const followups = Number(config.followups) || 0;
  _toggle("rulesFollowupRule", followups > 0);
  if (followups > 0) {
    _setText("rulesFollowupText", `Based on your answer, up to ${followups} in the interview — answer it like any other question.`);
  }
  _toggle("rulesRecruiterRule", config.recruiter_may_join !== false);
  // Look-away reminders (13 Oct 2026): the server's limit, 0 = never ends it.
  if (config.gaze_limit !== undefined && config.gaze_limit !== null) {
    const gl = Number(config.gaze_limit) || 0;
    _setText(
      "rulesGazeLimit",
      gl > 0
        ? `The ${gl}${gl % 10 === 1 && gl !== 11 ? "st" : gl % 10 === 2 && gl !== 12 ? "nd" : gl % 10 === 3 && gl !== 13 ? "rd" : "th"} reminder ends the interview.`
        : "Reminders are recorded for the recruiter.",
    );
  }

  // How it ends — exactly one rule, the one the template chose.
  let end;
  if (timed && duration) {
    end = `At ${duration} the interview submits itself — even if questions are left. It also ends earlier if the questions run out.`;
  } else if (count) {
    end = `After ${varies ? "your" : "the"} ${count} question${count === 1 ? "" : "s"}, the interview submits itself. There is no clock.`;
  } else {
    end = "It submits itself when the last question is answered.";
  }
  if (config.closing_qa) end += " At the end you may ask a question about the role.";
  _setText("rulesEndCondition", end);
}

/**
 * The "More rules below" hint (18 Nov 2026): shown while the rule list has
 * more to scroll, gone at the end; its button scrolls one view further.
 * Returns a function that removes the listeners.
 */
function _wireMoreHint() {
  const list = document.getElementById("rulesScroll");
  const btn = document.getElementById("rulesMoreBtn");
  if (!list) return () => {};
  const update = () => {
    const atEnd = list.scrollHeight - list.clientHeight - list.scrollTop <= 8;
    list.classList.toggle("is-at-end", atEnd);
  };
  const more = () => {
    list.scrollBy({ top: Math.max(120, list.clientHeight * 0.8), behavior: "smooth" });
  };
  list.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  if (btn) btn.addEventListener("click", more);
  list.scrollTop = 0;
  // After layout (the summary and rules were just filled in).
  requestAnimationFrame(update);
  return () => {
    list.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
    if (btn) btn.removeEventListener("click", more);
  };
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
  const unwireMore = _wireMoreHint();

  return new Promise((resolve) => {
    const finish = (result) => {
      unwireMore();
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
