/**
 * Anti-cheating monitors DURING the interview (13 Nov 2026).
 *
 * Only what the template turned on (`proctoring_checks.getProctoringConfig()`):
 *
 *  - random GESTURE PROMPTS — on a few spoken questions (never the first, never
 *    a pseudo-code / coding one) a small card asks for a gesture for 10 s while
 *    the candidate answers. Passed or missed is logged; a miss is a soft flag
 *    for the reviewer, never a strike. The hand detector runs only during the
 *    prompt.
 *  - HEADPHONES — the audio devices are watched; unplugging the headphones logs
 *    `headphones_disconnected` and (in "require" mode) holds the candidate on a
 *    card until the headphone test passes again; any other change of the
 *    sound devices is logged as `audio_device_changed`.
 *
 * Lighting and reading detection ride on the face monitor's own scans
 * (`face_detection.setMonitorOptions`). Nothing here can end the interview.
 */
import { GestureHold, outputLabelHint, pickPromptTurns, randomGesture } from "./proctoring_logic.js";
import { getProctoringConfig, runHeadphoneTest } from "./proctoring_checks.js";

const PROMPT_SECONDS = 10;
const PROMPT_DELAY_MS = [4000, 9000];

let _deps = null;
let _plan = [];
let _spoken = 0;
let _promptOpen = false;
let _promptTimer = null;
let _deviceLabels = null;
let _hadHeadset = false;
let _headsetCardOpen = false;
let _onDeviceChange = null;

/**
 * @param {object} deps
 * @param {() => HTMLVideoElement|null} deps.getVideo   the candidate feed
 * @param {(type:string, details:string) => void} deps.report  log an integrity event
 * @param {() => boolean} deps.isPaused   a recruiter has the interview paused
 * @param {() => boolean} deps.isTyped    a pseudo-code / coding panel is open
 * @param {number} deps.totalQuestions   scored questions in the interview
 */
export function startInterviewProctoring(deps) {
  stopInterviewProctoring();
  const cfg = getProctoringConfig();
  if (!cfg.enabled) return;
  _deps = deps;
  _spoken = 0;
  _plan = cfg.gesture_prompts > 0 ? pickPromptTurns(cfg.gesture_prompts, Math.max(2, Number(deps.totalQuestions) || 6)) : [];
  if (cfg.headphones !== "off") void _watchDevices(cfg.headphones);
}

export function stopInterviewProctoring() {
  if (_promptTimer) window.clearTimeout(_promptTimer);
  _promptTimer = null;
  document.getElementById("kxpcPrompt")?.remove();
  _promptOpen = false;
  if (_onDeviceChange && navigator.mediaDevices?.removeEventListener) {
    navigator.mediaDevices.removeEventListener("devicechange", _onDeviceChange);
  }
  _onDeviceChange = null;
  _deps = null;
}

/** Called by the interview each time a question is put on screen. */
export function onQuestionShownForProctoring({ isWarmup = false, typed = false } = {}) {
  if (!_deps || isWarmup || typed) return;
  _spoken += 1;
  if (!_plan.length || _plan[0] > _spoken) return;
  const turn = _plan.shift();
  const [lo, hi] = PROMPT_DELAY_MS;
  if (_promptTimer) window.clearTimeout(_promptTimer);
  _promptTimer = window.setTimeout(() => {
    _promptTimer = null;
    // A paused interview or a typed panel: try again on the next spoken question.
    if (!_deps || _deps.isPaused() || _deps.isTyped()) {
      _plan.unshift(_spoken + 1);
      return;
    }
    void _runPrompt(turn);
  }, lo + Math.random() * (hi - lo));
}

async function _runPrompt(turn) {
  if (_promptOpen || !_deps) return;
  const { detectHands, loadHandMonitor } = await import("./hand_monitor.js");
  if (!(await loadHandMonitor())) {
    _deps?.report("gesture_prompt_missed", "The hand detector could not load — prompt not shown");
    return;
  }
  const target = randomGesture();
  _promptOpen = true;
  const card = document.createElement("div");
  card.id = "kxpcPrompt";
  card.className = "kxpc kxpc-prompt";
  card.setAttribute("role", "alert");
  const eyebrow = document.createElement("div");
  eyebrow.className = "kxpc-eyebrow";
  eyebrow.textContent = "Quick check — keep answering";
  const title = document.createElement("p");
  title.className = "kxpc-h";
  title.textContent = `${target.words} to the camera`;
  const count = document.createElement("div");
  count.className = "kxpc-count";
  count.textContent = String(PROMPT_SECONDS);
  card.append(eyebrow, title, count);
  document.body.appendChild(card);
  const hold = new GestureHold(target, 700);
  const until = Date.now() + PROMPT_SECONDS * 1000;
  let passed = false;
  while (_deps && Date.now() < until) {
    if (_deps.isPaused()) break;
    count.textContent = String(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    const video = _deps.getVideo();
    const hands = video ? await detectHands(video) : [];
    if (hands && hold.feed(Date.now(), hands)) {
      passed = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  const what = target.kind === "fingers" ? `${target.n} finger(s)` : "a thumbs up";
  if (_deps && !_deps.isPaused()) {
    _deps.report(passed ? "gesture_prompt_ok" : "gesture_prompt_missed",
      `${passed ? "Showed" : "Did not show"} ${what} on spoken question ${turn}`);
  }
  title.textContent = passed ? "Thank you — carry on." : "Not seen — this is noted for the reviewer.";
  count.textContent = passed ? "✓" : "";
  card.style.borderColor = passed ? "#10b981" : "#ef4444";
  await new Promise((r) => setTimeout(r, passed ? 1200 : 2200));
  card.remove();
  _promptOpen = false;
}

async function _labels() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "audiooutput" || d.kind === "audioinput").map((d) => `${d.kind}:${d.label || ""}`);
  } catch (_) {
    return null;
  }
}

async function _watchDevices(mode) {
  if (!navigator.mediaDevices?.addEventListener) return;
  _deviceLabels = await _labels();
  _hadHeadset = outputLabelHint(_deviceLabels || []) === "headset";
  _onDeviceChange = async () => {
    if (!_deps) return;
    const now = await _labels();
    if (!now) return;
    const before = new Set(_deviceLabels || []);
    const after = new Set(now);
    const removed = [...before].filter((l) => !after.has(l));
    const added = [...after].filter((l) => !before.has(l));
    _deviceLabels = now;
    if (!removed.length && !added.length) return;
    const hasHeadset = outputLabelHint(now) === "headset";
    const lost = _hadHeadset && !hasHeadset;
    _hadHeadset = hasHeadset;
    const names = (list) => list.map((l) => l.split(":").slice(1).join(":") || "unnamed device").join(", ");
    if (lost) {
      _deps.report("headphones_disconnected", `Headphones removed: ${names(removed)}`);
      if (_headsetCardOpen) return;
      _headsetCardOpen = true;
      await runHeadphoneTest({ blocking: mode === "require" });
      _headsetCardOpen = false;
      _deps?.report("headphones_reconnected", "The candidate reconnected headphones");
      _hadHeadset = outputLabelHint((await _labels()) || []) === "headset";
    } else {
      _deps.report("audio_device_changed",
        `${removed.length ? `removed: ${names(removed)}` : ""}${removed.length && added.length ? " · " : ""}${added.length ? `added: ${names(added)}` : ""}`);
    }
  };
  navigator.mediaDevices.addEventListener("devicechange", _onDeviceChange);
}
