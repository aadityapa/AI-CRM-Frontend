import { state } from "./state.js";
import { apiFetch, handleJson, setAiState } from "./core.js";
import { loadHrRecords } from "./results.js";
import { clearAuthSession, getAuthUserRaw } from "./auth/session.js";
import {
  readPersistedDeviceTestState,
  clearPersistedDeviceTestState,
  getVerifiedMicStream,
  releaseVerifiedMicStream,
  adoptVerifiedMicStream,
} from "./device_test.js";
import {
  postInterviewFinalizeBackground,
  postInterviewFinalizeKeepalive,
  clearCandidateSessionAfterExit,
} from "./interview_finalization.js";
import {
  applyTimeWarningConfig,
  dismissTimeWarningsOnInterviewEnd,
  resetTimeWarningUiState,
  tickInterviewTimeWarnings,
} from "./interview_time_warnings.js";
import {
  applyAutoAdvanceConfig,
  autoAdvanceWhisperBusy,
  beginAutoAdvanceTurn,
  cancelAutoAdvancePopup,
  confirmAutoAdvanceNow,
  flushAutoAdvanceWhisperTranscription,
  getAutoAdvanceCaptureSnapshot,
  notifyAutoAdvanceAnswerActivity,
  resetAutoAdvanceUi,
  stopAutoAdvanceTurn,
} from "./interview_auto_advance.js";
import { createQuestionProvider, InterviewEngine } from "./interview_engine.js";

/**
 * Candidate live interview voice + submission flow (2026):
 * - TTS completion is awaited on `ended` (not `play()`), then mic starts automatically.
 * - No manual “Begin Response” / “Submit Interview” — Send Response + auto finalize + thank-you redirect.
 * - `submitInterview` is idempotent while in-flight (timer / completion / proctor paths).
 */

let showScreenRef = null;
let activeRecorder = null;
let recorderStream = null;
let recordedChunks = [];
let isMicListening = false;
let spokenAnswerText = "";
let activeQuestionAudio = null;
let lastSpokenQuestion = "";
let lastSpeakTs = 0;
let questionTypewriterHandle = null;
const SKIPPED_ANSWER_TOKEN = "skip";
let _toastHideHandle = null;
let _answerSubmitInFlight = false;
let _pendingManualSubmit = false;
let _questionLoadSeq = 0;
let _interviewFlowStopped = false;

/** Resolves when in-flight mic stop + transcription finishes (auto-submit / flush paths). */
let _micStopDoneResolver = null;

/** Prevents double /submit from timer + completion + security race. */
let _submitInterviewInFlight = false;

/** Backend grace window to finalize mic transcript before /submit (ms). */
const FINALIZE_GRACE_MS = 12000;

/**
 * How long Send Response waits for the microphone to finish transcribing.
 *
 * Two very different situations were sharing one 8-second ceiling:
 *
 *  - We ALREADY have a transcript. The wait is only to catch the last word or
 *    two still in the recorder. The answer is not at risk, so a long ceiling
 *    buys nothing and costs the candidate a visible pause on every question.
 *
 *  - We have NOTHING yet. Here the wait is the answer itself — cutting it short
 *    would submit an empty response and waste the question. This one stays
 *    generous.
 *
 * Both are ceilings, not delays: the promise resolves as soon as the recorder
 * flushes, which is usually well inside them.
 */
const SUBMIT_TAIL_GRACE_MS = 2500;
const SUBMIT_TRANSCRIPT_WAIT_MS = 8000;

let _unloadGuardInstalled = false;

/** When true, mic stop skips server transcription so End Interview stays instant. */
let _terminatingInterview = false;

/** When true, the *next* mic stop skips server transcription (skip / end paths only). */
let _bypassTranscription = false;

/** Reset per-question capture state so a prior skip never affects the next turn. */
function _resetQuestionTurnState(reason = "new_question") {
  _bypassTranscription = false;
  _transcriptionInFlight = false;
  recordedChunks = [];
  _setSpokenAnswer("");
  try {
    console.info("[candidate-turn] state_reset", { reason });
  } catch (_) {
    /* ignore */
  }
}

function _logTurnEvent(event, detail = {}) {
  try {
    const q = state.currentQuestion || "";
    const flowEvent = String(event || "").toUpperCase().replace(/\s+/g, "_");
    console.info(`[FLOW] ${flowEvent}`, {
      question_preview: String(q).slice(0, 120),
      question_index: detail.question_index ?? state.currentQuestionIndex,
      action: detail.action,
      skipped: detail.skipped,
      transcript_len: detail.transcript_len,
      ...detail,
    });
  } catch (_) {
    /* ignore */
  }
}

/** True while MediaRecorder onstop is awaiting /candidate/transcribe. */
let _transcriptionInFlight = false;

/** True while AI TTS audio is playing (Send Response stays disabled). */
let _aiSpeaking = false;

// Proctoring state
const MAX_WARNINGS = 3;
let proctorSessionId = "";
let proctorViolationCounts = { tabSwitch: 0, extraFace: 0 };
let proctorActive = false;
let proctorListenersBound = false;
let proctorStream = null;
let mediaGateBound = false;
let proctoringFullyStarted = false;
let proctorFullscreenEntered = false;

function _cancelActiveSpeech() {
  if (activeQuestionAudio) {
    try {
      activeQuestionAudio.pause();
    } catch (_) {
      // ignore
    }
    activeQuestionAudio = null;
  }
}

function _candidateHostSpeaking(isSpeaking) {
  state.aiHostSpeaking = !!isSpeaking;
  const host = document.getElementById("candidateAiHost");
  if (host) host.classList.toggle("speaking", !!isSpeaking);
  const videoPanel = document.querySelector(".cand-video");
  if (videoPanel) videoPanel.classList.toggle("speaking", !!isSpeaking);
  setAiState(isSpeaking ? "AI speaking..." : "AI waiting for your answer");
}

function _clearQuestionTypewriter() {
  if (questionTypewriterHandle) {
    clearInterval(questionTypewriterHandle);
    questionTypewriterHandle = null;
  }
}

function _prepareQuestionVisual(targetEl, questionText) {
  if (!targetEl) return;
  const spoken = String(questionText || "").trim();
  targetEl.classList.remove("question-enter");
  void targetEl.offsetWidth;
  targetEl.classList.add("question-enter");
  _clearQuestionTypewriter();
  if (!spoken) {
    targetEl.innerText = "No question available.";
    return;
  }
  targetEl.innerText = spoken;
}

/* ---------------------------------------------------------------------------
 * Question audio: prefetch + progressive playback
 *
 * Previously every question's audio was requested only at the moment it had to
 * be spoken, and `await res.blob()` waited for the last byte before playback
 * could begin. Two full waits, back to back, in front of every question.
 *
 * Now: while the candidate answers question N we ask the server to synthesise
 * N+1 (`/candidate/tts/prewarm`), and playback starts from the first chunk
 * instead of the last.
 * ------------------------------------------------------------------------- */

/** Questions we've already asked the server to warm, so we ask only once. */
const _prewarmedQuestions = new Set();

/**
 * Ask the server to synthesise a question's audio ahead of time.
 * Fire-and-forget: a failed prefetch just means the live path does the work.
 */
export function prewarmQuestionAudio(text) {
  const spoken = String(text || "").trim();
  if (!spoken || _prewarmedQuestions.has(spoken)) return;
  _prewarmedQuestions.add(spoken);
  // Keep the set from growing across a long interview.
  if (_prewarmedQuestions.size > 40) {
    _prewarmedQuestions.delete(_prewarmedQuestions.values().next().value);
  }
  try {
    const fd = new FormData();
    fd.append("text", spoken);
    apiFetch("/candidate/tts/prewarm", { method: "POST", body: fd }).catch(() => {});
  } catch (_) {
    // never block the interview on a prefetch
  }
}

/** Discard a prefetch that is no longer valid (adaptive follow-up replaced it). */
export function invalidatePrewarmedQuestion(text) {
  const spoken = String(text || "").trim();
  if (spoken) _prewarmedQuestions.delete(spoken);
}

/**
 * Build an <audio> for a question, starting playback as early as possible.
 *
 * Prefers MediaSource-free progressive streaming: pointing the element straight
 * at the response URL lets the browser start decoding on the first chunk. Falls
 * back to the blob path where that is not possible, so behaviour is unchanged
 * on anything that cannot stream.
 */
async function _questionAudioElement(spoken) {
  const fd = new FormData();
  fd.append("text", spoken);
  const res = await apiFetch("/candidate/tts", { method: "POST", body: fd });
  if (!res.ok) throw new Error("TTS request failed");

  // A JSON body means the server reported an error rather than sending audio.
  const contentType = String(res.headers.get("content-type") || "");
  if (contentType.includes("application/json")) {
    throw new Error("TTS unavailable");
  }

  // Progressive path: consume the stream and hand each chunk to the browser as
  // it lands, so audio begins while synthesis is still running server-side.
  if (res.body && typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg")) {
    try {
      return await _streamingAudioElement(res);
    } catch (_) {
      // fall through to the blob path below — correctness beats latency
    }
  }

  const blob = await res.blob();
  if (!blob.size) throw new Error("Empty TTS audio");
  return new Audio(URL.createObjectURL(blob));
}

/** Feed a fetch stream into a MediaSource so playback can start on chunk 1. */
function _streamingAudioElement(res) {
  return new Promise((resolve, reject) => {
    const mediaSource = new MediaSource();
    const audio = new Audio();
    audio.src = URL.createObjectURL(mediaSource);
    let settled = false;

    mediaSource.addEventListener("sourceopen", async () => {
      let buffer;
      try {
        buffer = mediaSource.addSourceBuffer("audio/mpeg");
      } catch (err) {
        if (!settled) { settled = true; reject(err); }
        return;
      }

      const reader = res.body.getReader();
      const queue = [];
      let done = false;

      const pump = () => {
        if (buffer.updating) return;
        if (queue.length) {
          try {
            buffer.appendBuffer(queue.shift());
          } catch (err) {
            if (!settled) { settled = true; reject(err); }
          }
          return;
        }
        if (done && mediaSource.readyState === "open") {
          try { mediaSource.endOfStream(); } catch (_) { /* already ended */ }
        }
      };

      buffer.addEventListener("updateend", pump);

      try {
        for (;;) {
          const { value, done: finished } = await reader.read();
          if (finished) break;
          if (value && value.byteLength) {
            queue.push(value);
            // The first chunk is enough to start playing — resolve now so the
            // caller can call play() while the rest is still downloading.
            if (!settled) { settled = true; resolve(audio); }
            pump();
          }
        }
        done = true;
        pump();
      } catch (err) {
        done = true;
        if (!settled) { settled = true; reject(err); }
      }

      if (!settled) { settled = true; reject(new Error("Empty TTS stream")); }
    });

    // Don't hang forever if sourceopen never fires.
    setTimeout(() => {
      if (!settled) { settled = true; reject(new Error("TTS stream timeout")); }
    }, 6000);
  });
}

/**
 * Fetch and play TTS for a question.
 * Resolves when playback **ends** (not when play() starts) so mic can open after the AI finishes speaking.
 */
async function _speakQuestionAudioOnly(text) {
  const spoken = String(text || "").trim();
  if (!spoken) {
    _candidateHostSpeaking(false);
    return;
  }
  const now = Date.now();
  if (spoken === lastSpokenQuestion && now - lastSpeakTs < 1500) {
    return;
  }
  lastSpokenQuestion = spoken;
  lastSpeakTs = now;
  _cancelActiveSpeech();
  // Optimistically flag "AI speaking" right away (before TTS bytes arrive) so the
  // subtle chip shows "AI speaking…" immediately instead of "Mic ready" for the
  // 200-600 ms it takes to round-trip the /candidate/tts request.
  _aiSpeaking = true;
  _candidateHostSpeaking(true);
  _setInterviewPhase("ai_speaking");
  _setMicUi(false);
  console.info("[INTERVIEW] AI speaking started");
  try {
    const audio = await _questionAudioElement(spoken);
    // Feature 5: hint the browser to buffer audio bytes ASAP so play() resolves
    // instantly when we call it — eliminating the visible "question on screen
    // but no voice yet" gap.
    audio.preload = "auto";
    activeQuestionAudio = audio;
    const cleanup = () => {
      _aiSpeaking = false;
      _candidateHostSpeaking(false);
      _setInterviewPhase("waiting_for_answer");
      try {
        URL.revokeObjectURL(audio.src);
      } catch (_) {
        // ignore
      }
      if (activeQuestionAudio === audio) activeQuestionAudio = null;
    };
    await new Promise((resolve) => {
      const finish = () => {
        cleanup();
        // Flip mic chip back to idle as soon as AI audio ends; mic auto-start
        // will then promote it to "Listening…".
        _setMicUi(false);
        resolve();
      };
      audio.onplaying = () => {
        _aiSpeaking = true;
        _candidateHostSpeaking(true);
        // Show the subtle "AI speaking…" state on the inline chip.
        _setMicUi(false);
      };
      audio.onended = () => finish();
      audio.onerror = () => finish();
      audio.play().catch(() => finish());
    });
    console.info("[INTERVIEW] AI speaking completed");
  } catch (_) {
    _aiSpeaking = false;
    _candidateHostSpeaking(false);
  }
}

/**
 * Render the subtle voice-status chip (May 2026 redesign).
 *
 * Three visual states are driven by classes on `#candidateListenStatus`:
 *   - default  → "Awaiting AI…" / "Mic ready"  (slate dot, no fill)
 *   - listening → "Listening…"                 (emerald dot + soft green fill)
 *   - ai-speaking → "AI speaking…"             (indigo dot + soft indigo fill)
 *
 * `listening` is mutually exclusive with `ai-speaking`, so we clear both before
 * setting the active one to avoid stale classes after rapid transitions.
 */
function _setMicUi(listening) {
  const wrap = document.getElementById("candidateListenStatus");
  if (wrap) {
    wrap.classList.remove("listening", "ai-speaking", "processing");
    if (listening) wrap.classList.add("listening");
    else if (wrap.dataset.processing === "1") wrap.classList.add("processing");
    else if (_aiSpeaking) wrap.classList.add("ai-speaking");
    wrap.title = listening
      ? "Microphone is active — speak your answer, then tap Send Response."
      : wrap.dataset.processing === "1"
        ? "AI is processing your response and preparing the next question."
      : _aiSpeaking
        ? "AI is speaking — microphone is muted until it finishes."
        : "Microphone activates automatically after the AI finishes speaking.";
  }
  const label = document.getElementById("candidateMicLabel");
  if (label) {
    label.innerText = listening ? "Listening…" : wrap && wrap.dataset.processing === "1" ? "AI processing…" : _aiSpeaking ? "AI speaking…" : "Mic ready";
  }
}

/** Strict interview state machine (BUG #5). */
const INTERVIEW_STATE = Object.freeze({
  QUESTION_SHOWN: "question_shown",
  AI_SPEAKING: "ai_speaking",
  WAITING_FOR_RESPONSE: "waiting_for_response",
  WARNING_COUNTDOWN: "warning_countdown",
  LISTENING: "listening",
  ANSWER_DETECTED: "answer_captured",
  EVALUATING: "evaluating",
  NEXT_QUESTION: "generating_next",
});

const _PHASE_TO_STATE = {
  question_shown: INTERVIEW_STATE.QUESTION_SHOWN,
  ai_speaking: INTERVIEW_STATE.AI_SPEAKING,
  waiting_for_answer: INTERVIEW_STATE.WAITING_FOR_RESPONSE,
  waiting_for_response: INTERVIEW_STATE.WAITING_FOR_RESPONSE,
  no_response_warning: INTERVIEW_STATE.WARNING_COUNTDOWN,
  warning_countdown: INTERVIEW_STATE.WARNING_COUNTDOWN,
  listening: INTERVIEW_STATE.LISTENING,
  answer_captured: INTERVIEW_STATE.ANSWER_DETECTED,
  evaluating: INTERVIEW_STATE.EVALUATING,
  generating_next: INTERVIEW_STATE.NEXT_QUESTION,
  moving_next: INTERVIEW_STATE.NEXT_QUESTION,
  question_skipped: INTERVIEW_STATE.NEXT_QUESTION,
};

const _ALLOWED_STATE_TRANSITIONS = {
  [INTERVIEW_STATE.QUESTION_SHOWN]: new Set([
    INTERVIEW_STATE.AI_SPEAKING,
    INTERVIEW_STATE.WAITING_FOR_RESPONSE,
    INTERVIEW_STATE.NEXT_QUESTION,
  ]),
  [INTERVIEW_STATE.AI_SPEAKING]: new Set([
    INTERVIEW_STATE.WAITING_FOR_RESPONSE,
    INTERVIEW_STATE.LISTENING,
    INTERVIEW_STATE.NEXT_QUESTION,
    INTERVIEW_STATE.EVALUATING,
  ]),
  [INTERVIEW_STATE.WAITING_FOR_RESPONSE]: new Set([
    INTERVIEW_STATE.WARNING_COUNTDOWN,
    INTERVIEW_STATE.LISTENING,
    INTERVIEW_STATE.ANSWER_DETECTED,
    INTERVIEW_STATE.EVALUATING,
    INTERVIEW_STATE.NEXT_QUESTION,
  ]),
  [INTERVIEW_STATE.WARNING_COUNTDOWN]: new Set([
    INTERVIEW_STATE.LISTENING,
    INTERVIEW_STATE.EVALUATING,
    INTERVIEW_STATE.NEXT_QUESTION,
    INTERVIEW_STATE.WAITING_FOR_RESPONSE,
    INTERVIEW_STATE.WARNING_COUNTDOWN,
    INTERVIEW_STATE.QUESTION_SHOWN,
  ]),
  [INTERVIEW_STATE.LISTENING]: new Set([
    INTERVIEW_STATE.ANSWER_DETECTED,
    INTERVIEW_STATE.EVALUATING,
    INTERVIEW_STATE.NEXT_QUESTION,
    INTERVIEW_STATE.WAITING_FOR_RESPONSE,
    INTERVIEW_STATE.QUESTION_SHOWN,
    INTERVIEW_STATE.WARNING_COUNTDOWN,
  ]),
  [INTERVIEW_STATE.ANSWER_DETECTED]: new Set([
    INTERVIEW_STATE.LISTENING,
    INTERVIEW_STATE.EVALUATING,
    INTERVIEW_STATE.NEXT_QUESTION,
  ]),
  [INTERVIEW_STATE.EVALUATING]: new Set([
    INTERVIEW_STATE.NEXT_QUESTION,
    INTERVIEW_STATE.AI_SPEAKING,
    INTERVIEW_STATE.WAITING_FOR_RESPONSE,
  ]),
  [INTERVIEW_STATE.NEXT_QUESTION]: new Set([
    INTERVIEW_STATE.AI_SPEAKING,
    INTERVIEW_STATE.QUESTION_SHOWN,
    INTERVIEW_STATE.EVALUATING,
    INTERVIEW_STATE.WAITING_FOR_RESPONSE,
  ]),
};

let _interviewState = INTERVIEW_STATE.QUESTION_SHOWN;

const INTERVIEW_PHASE_LABELS = {
  question_shown: "Question Shown...",
  ai_speaking: "AI Speaking...",
  waiting_for_answer: "Waiting For Response...",
  waiting_for_response: "Waiting For Response...",
  warning_countdown: "No Response Detected...",
  listening: "Listening...",
  answer_captured: "Answer Captured...",
  evaluating: "Evaluating Answer...",
  generating_next: "Generating Next Question...",
  moving_next: "Moving To Next Question...",
  question_skipped: "Question Skipped...",
  no_response: "Waiting For Response...",
};

function _resolveInterviewState(phase) {
  return _PHASE_TO_STATE[phase] || INTERVIEW_STATE.WAITING_FOR_RESPONSE;
}

function _canTransitionInterviewState(fromState, toState) {
  if (!fromState || !toState || fromState === toState) return true;
  const allowed = _ALLOWED_STATE_TRANSITIONS[fromState];
  return allowed ? allowed.has(toState) : true;
}

function _setInterviewPhase(phase) {
  const nextState = _resolveInterviewState(phase);
  if (!_canTransitionInterviewState(_interviewState, nextState)) {
    try {
      console.warn("[interview-state] transition blocked", {
        from: _interviewState,
        to: nextState,
        phase,
      });
    } catch (_) {
      /* ignore */
    }
    return false;
  }
  _interviewState = nextState;
  const label = INTERVIEW_PHASE_LABELS[phase] || INTERVIEW_PHASE_LABELS[nextState] || "Waiting For Response...";
  const tracker = document.getElementById("interviewPhaseTracker");
  if (tracker) tracker.innerText = label;
  setAiState(label);
  return true;
}

const AUTO_ADVANCE_PHASE_LABELS = {
  waiting_for_response: "Waiting For Response...",
  listening: "Listening...",
  moving_next: "Moving To Next Question...",
  question_skipped: "Question Skipped...",
};

const _AUTO_ADVANCE_TO_INTERVIEW_PHASE = {
  waiting_for_response: "waiting_for_response",
  listening: "listening",
  moving_next: "moving_next",
  question_skipped: "question_skipped",
  skipped: "question_skipped",
};

function _onAutoAdvancePhase(phase, message) {
  const mapped = _AUTO_ADVANCE_TO_INTERVIEW_PHASE[phase] || phase;
  _setInterviewPhase(mapped);
  const label = AUTO_ADVANCE_PHASE_LABELS[phase] || INTERVIEW_PHASE_LABELS[mapped] || "Listening...";
  const tracker = document.getElementById("interviewPhaseTracker");
  if (tracker) tracker.innerText = label;
  setAiState(label);
  const statusEl = document.getElementById("candidateStatus");
  if (statusEl && message) statusEl.innerText = message;
}

function _startAutoAdvanceForTurn(isWarmup) {
  if (!recorderStream) return;
  if (!state.autoAdvance?.enabled) return;
  beginAutoAdvanceTurn({
    audioStream: recorderStream,
    questionIndex: state.currentQuestionIndex,
    questionText: state.currentQuestion,
    isWarmup,
    listenOnly: !!isWarmup,
    getCaptureText: () => spokenAnswerText,
    onPhase: _onAutoAdvancePhase,
    onInterimTranscript: (text) => {
      if (text) _setSpokenAnswer(text);
    },
    onSpeechStart: () => _setInterviewPhase("listening"),
    onAutoSubmit: (meta) => {
      submitCandidateAnswer(false, false, { autoAdvanceMeta: meta, autoSubmitted: true });
    },
    onAutoSkip: (reason, meta) => {
      submitCandidateAnswer(true, false, { skipReason: reason, autoAdvanceMeta: meta, autoSkipped: true });
    },
  });
}

export function cancelAutoAdvance() {
  cancelAutoAdvancePopup();
}

export function submitAutoAdvanceNow() {
  confirmAutoAdvanceNow();
}

function _setResponseProcessingUi(on, message) {
  const card = document.querySelector(".qc-response-card");
  const send = document.getElementById("candidateSendBtn");
  const skip = document.getElementById("candidateSkipBtn");
  const transcriptPanel = document.getElementById("candidateTranscriptPanel");
  const statusEl = document.getElementById("candidateStatus");
  const listen = document.getElementById("candidateListenStatus");
  if (listen) {
    listen.dataset.processing = on ? "1" : "0";
  }
  if (card) card.classList.toggle("processing", !!on);
  if (send) send.disabled = !!on;
  if (skip) skip.disabled = !!on;
  if (transcriptPanel && on) {
    transcriptPanel.hidden = true;
    transcriptPanel.classList.remove("is-visible");
    transcriptPanel.setAttribute("aria-hidden", "true");
  }
  if (statusEl) {
    statusEl.classList.toggle("processing", !!on);
    statusEl.innerText = on ? (message || "AI processing...") : (message || "");
  }
  if (on) {
    const phase =
      message && /skipp/i.test(message)
        ? "generating_next"
        : message && /prepar|next/i.test(message)
          ? "generating_next"
          : message && /sav|process|evaluat/i.test(message)
            ? "evaluating"
            : "evaluating";
    _setInterviewPhase(phase);
  } else if (!message || !/^error:/i.test(String(message))) {
    _setInterviewPhase("waiting_for_answer");
    setAiState("Waiting For Response...");
  } else {
    _setInterviewPhase("waiting_for_answer");
    setAiState(message.replace(/^error:\s*/i, "Error: "));
  }
  _setMicUi(false);
}

function _setEndingOverlayText(message) {
  const card = document.querySelector("#interviewEndingOverlay .qc-ending-card");
  if (card) card.textContent = message || "Submitting your interview...";
}

export function showCandidateToast(message, durationMs = 1500) {
  return _showCandidateToast(message, durationMs);
}

function _showCandidateToast(message, durationMs = 1500) {
  const toast = document.getElementById("candidateToast");
  if (!toast) return;
  if (_toastHideHandle) {
    clearTimeout(_toastHideHandle);
    _toastHideHandle = null;
  }
  toast.innerText = String(message || "").trim();
  toast.classList.add("show");
  _toastHideHandle = window.setTimeout(() => {
    toast.classList.remove("show");
    _toastHideHandle = null;
  }, Math.max(800, Number(durationMs) || 1500));
}

function _normalizeQuestionPhrasing(raw) {
  let q = String(raw || "").trim();
  if (!q) return q;
  // Remove repetitive canned acknowledgements that make interviews feel robotic.
  q = q.replace(
    /^(interesting approach|good answer|nice explanation|great point|good point|nice approach|interesting start)\s*[,.!:\-]+\s*/i,
    ""
  );
  q = q.replace(/^(thanks for sharing|thanks)\s*[,.!:\-]+\s*/i, "");
  q = q.replace(/\s+/g, " ").trim();
  return q;
}

/**
 * Toggle the "System Warmup" UI affordances (Issue 2, May 2026).
 *
 * On the warmup turn we:
 *   - replace the "Technical Interview / HR Interview" mode chip with a
 *     neutral "System Warmup" pill,
 *   - inject a small "This response is not evaluated." subtitle below the
 *     question text (created lazily — no markup change required).
 * On every other turn we remove the subtitle and restore the original mode
 * chip text so the candidate sees the normal interview chrome.
 */
let _originalModeTagText = "";
function _applyWarmupChrome(isWarmup, label, note) {
  const modeTag = document.getElementById("modeTag");
  if (modeTag) {
    if (!_originalModeTagText) _originalModeTagText = (modeTag.innerText || "").trim() || "Technical Interview";
    modeTag.innerText = isWarmup ? (label || "System Warmup") : _originalModeTagText;
    modeTag.classList.toggle("warmup", !!isWarmup);
  }
  const questionEl = document.getElementById("candidateQuestion");
  if (!questionEl || !questionEl.parentElement) return;
  let subtitle = document.getElementById("candidateWarmupNote");
  if (isWarmup) {
    if (!subtitle) {
      subtitle = document.createElement("div");
      subtitle.id = "candidateWarmupNote";
      subtitle.className = "cand-warmup-note";
      subtitle.setAttribute("role", "note");
      questionEl.parentElement.insertBefore(subtitle, questionEl.nextSibling);
    }
    subtitle.innerText = note || "This response is not evaluated.";
    subtitle.style.display = "";
  } else if (subtitle) {
    subtitle.style.display = "none";
  }
}

/** Send Response: disabled while AI speaks; enabled when candidate may answer (after AI or while typing-only). */
function _setSendResponseEnabled(on) {
  const btn = document.getElementById("candidateSendBtn");
  const skipBtn = document.getElementById("candidateSkipBtn");
  if (btn) btn.disabled = !on;
  if (skipBtn) skipBtn.disabled = !on;
}

function _setSpokenAnswer(text) {
  spokenAnswerText = String(text || "").trim();
  if (spokenAnswerText) {
    notifyAutoAdvanceAnswerActivity("transcript", { text: spokenAnswerText });
    console.info("[TRANSCRIPT] Transcript received", {
      words: spokenAnswerText.split(/\s+/).filter(Boolean).length,
      preview: spokenAnswerText.slice(0, 120),
    });
    if (_pendingManualSubmit) {
      console.info("[SUBMIT] Auto-submitting after transcript arrived");
      _pendingManualSubmit = false;
      _answerSubmitInFlight = false;
      void submitCandidateAnswer(false, true);
    }
  }
  if (!state.showSpokenText) return;
  const box = document.getElementById("candidateSpokenAnswer");
  if (box) box.innerText = spokenAnswerText || "Awaiting vocal stream...";
}

/** Read spoken transcript only (voice-only interview flow). */
function _collectPendingAnswerText() {
  const snap = getAutoAdvanceCaptureSnapshot();
  return String(spokenAnswerText || snap.capture_text || snap.interim_transcript || snap.whisper_transcript || "").trim();
}

/**
 * Save the active question before interview finalization (timer / End Interview).
 * Posts /answer so evaluation runs before /submit — avoids losing the last spoken answer.
 */
async function _submitBoundaryAnswerBeforeFinalize({ timeExpired = false, manualEnd = false } = {}) {
  stopInterviewTimer();
  stopAutoAdvanceTurn();

  const statusEl = document.getElementById("candidateStatus");
  if (statusEl) statusEl.innerText = "Saving your answer…";
  _setEndingOverlayText("Saving your answer…");

  await waitForMicTranscriptionIdleWithTimeout(FINALIZE_GRACE_MS);
  _stopMicImmediate();

  const snap = getAutoAdvanceCaptureSnapshot();
  const text = _collectPendingAnswerText();
  if (text) {
    if (!String(spokenAnswerText || "").trim()) _setSpokenAnswer(text);
    console.info("[FLOW] BOUNDARY_AUTO_SAVE", {
      timeExpired,
      manualEnd,
      words: text.split(/\s+/).filter(Boolean).length,
      preview: text.slice(0, 120),
    });
    const meta = {
      ...snap,
      trigger: timeExpired ? "interview_timer_expired" : "interview_manual_end",
      auto_submitted: true,
      auto_submitted_on_timeout: timeExpired,
      partial_answer: true,
      skipped: false,
    };
    try {
      await handleJson(
        await apiFetch("/answer", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            ans: text,
            action: "send",
            auto_advance_meta: JSON.stringify(meta),
          }),
        }),
      );
      _setSpokenAnswer("");
      console.info("[FLOW] BOUNDARY_ANSWER_SAVED");
    } catch (err) {
      const m = String(err?.message || err);
      if (!/already completed|No active session/i.test(m)) {
        console.warn("[FLOW] BOUNDARY_ANSWER_SAVE_FAILED", m);
      }
    }
    return text;
  }

  if (timeExpired) {
    console.info("[FLOW] BOUNDARY_NO_ANSWER_ON_TIMEOUT");
    try {
      await handleJson(
        await apiFetch("/answer", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            ans: "skip",
            action: "skip",
            skip_reason: "Interview time expired — no answer captured",
            auto_advance_meta: JSON.stringify({
              trigger: "interview_timer_expired",
              auto_submitted: false,
              auto_submitted_on_timeout: false,
              skipped: true,
            }),
          }),
        }),
      );
    } catch (err) {
      const m = String(err?.message || err);
      if (!/already completed|No active session/i.test(m)) {
        console.warn("[FLOW] BOUNDARY_SKIP_FAILED", m);
      }
    }
  }
  return "";
}

function _delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Stop mic and wait for transcription, bounded by FINALIZE_GRACE_MS. */
async function waitForMicTranscriptionIdleWithTimeout(maxMs = FINALIZE_GRACE_MS) {
  const recorderActive = activeRecorder && activeRecorder.state !== "inactive";
  const whisperBusy = autoAdvanceWhisperBusy();
  if (!isMicListening && !recorderActive && !_transcriptionInFlight && !whisperBusy) return;
  const waitPromise = new Promise((resolve) => {
    _micStopDoneResolver = resolve;
    try {
      if (recorderActive) activeRecorder.stop();
      else resolve();
    } catch (_) {
      resolve();
    }
  });
  await Promise.race([waitPromise, _delay(maxMs)]);
  await _finalizeMicTranscription();
}

/**
 * Grace period: stop mic with transcription, then collect pending answer.
 * Called before /submit on timer expiry and End Interview.
 */
async function _graceCapturePendingAnswer() {
  const statusEl = document.getElementById("candidateStatus");
  if (statusEl) statusEl.innerText = "Saving your answer…";
  _setEndingOverlayText("Saving your answer…");
  setAiState("Saving your answer…");
  await waitForMicTranscriptionIdleWithTimeout(FINALIZE_GRACE_MS);
  _stopMicImmediate();
  return _collectPendingAnswerText();
}

function _ensureInterviewUnloadGuard() {
  if (_unloadGuardInstalled) return;
  _unloadGuardInstalled = true;
  window.addEventListener("pagehide", () => {
    if (_submitInterviewInFlight || state.endingInterview || _interviewFlowStopped) return;
    const pending = _collectPendingAnswerText();
    if (!pending) return;
    try {
      postInterviewFinalizeKeepalive({
        pendingAnswer: pending,
        timeExpired: false,
        finalizeVia: "unload",
        boundaryAutoSaved: true,
      });
    } catch (_) {
      /* ignore */
    }
  });
}

/**
 * Freeze interview UI when ending (timer / End Interview).
 * Mic capture + transcription finish in _graceCapturePendingAnswer before /submit.
 */
function _freezeInterviewForFinalize() {
  dismissTimeWarningsOnInterviewEnd();
  _interviewFlowStopped = true;
  _questionLoadSeq += 1;
  state.endingInterview = true;
  state.redirecting = true;
  proctorActive = false;

  stopInterviewTimer();
  _cancelActiveSpeech();
  _clearQuestionTypewriter();
  _setSendResponseEnabled(false);

  const endBtn = document.querySelector(".qc-end-btn");
  const sendBtn = document.getElementById("candidateSendBtn");
  const skipBtn = document.getElementById("candidateSkipBtn");
  if (endBtn) {
    endBtn.disabled = true;
    endBtn.setAttribute("aria-disabled", "true");
  }
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.setAttribute("aria-disabled", "true");
  }
  if (skipBtn) {
    skipBtn.disabled = true;
    skipBtn.setAttribute("aria-disabled", "true");
  }

  const overlay = document.getElementById("interviewEndingOverlay");
  if (overlay) {
    _setEndingOverlayText("Finalizing interview...");
    overlay.classList.add("is-active");
    overlay.setAttribute("aria-hidden", "false");
  }

  const statusEl = document.getElementById("candidateStatus");
  if (statusEl) statusEl.innerText = "Ending interview…";
  setAiState("Interview ending");
}

/** Stop mic without transcription — used only for explicit skip and end interview. */
function _stopMicWithoutTranscription() {
  const recorderActive = activeRecorder && activeRecorder.state !== "inactive";
  if (recorderActive) {
    _bypassTranscription = true;
    try {
      activeRecorder.stop();
    } catch (_) {
      _bypassTranscription = false;
    }
  } else {
    _bypassTranscription = false;
  }
  const done = _micStopDoneResolver;
  _micStopDoneResolver = null;
  if (typeof done === "function") {
    try {
      done();
    } catch (_) {
      /* ignore */
    }
  }
  _stopMicInputInternal();
}

/** Stop mic/recorder immediately; skip transcription when terminating. */
function _stopMicImmediate() {
  _terminatingInterview = true;
  _bypassTranscription = true;
  if (activeRecorder && activeRecorder.state !== "inactive") {
    try {
      activeRecorder.stop();
    } catch (_) {
      /* ignore */
    }
  }
  const done = _micStopDoneResolver;
  _micStopDoneResolver = null;
  if (typeof done === "function") {
    try {
      done();
    } catch (_) {
      /* ignore */
    }
  }
  _stopMicInputInternal();
}

function _redirectAfterInterview(exitTerminated) {
  const dest = exitTerminated ? "/interview-terminated.html" : "/thank-you.html";
  try {
    window.location.replace(dest);
  } catch (_) {
    window.location.href = dest;
  }
}

/** Background: grace capture, /submit, proctor end. Does not block redirect. */
async function _backgroundFinalizeInterview({
  timeExpired = false,
  exitTerminated = false,
  manualEnd = false,
} = {}) {
  const statusEl = document.getElementById("candidateStatus");
  const pending = await _graceCapturePendingAnswer();
  const finalizeVia = timeExpired ? "timer" : manualEnd ? "manual" : "";
  const boundaryAutoSaved = !!pending && (timeExpired || manualEnd);
  try {
    console.info("[FLOW] INTERVIEW_ENDED", { timeExpired, manualEnd, exitTerminated });
    _setEndingOverlayText("Saving answers...");
    if (statusEl) statusEl.innerText = "Saving answers...";
    setAiState("Saving answers...");
    console.info("[FLOW] REPORT_STARTED");
    const finalize = await postInterviewFinalizeBackground({
      pendingAnswer: pending,
      timeExpired,
      finalizeVia,
      boundaryAutoSaved,
    });
    console.info("[FLOW] REPORT_COMPLETED", {
      report_ready: finalize?.report_ready,
      report_status: finalize?.report_status,
      interview_id: finalize?.interview_id,
    });
    try {
      await endProctorSession();
    } catch (_) {
      /* ignore */
    }
    clearCandidateSessionAfterExit();
  } catch (err) {
    const timedOut = err && String(err.message || "").includes("REPORT_TIMEOUT");
    try {
      postInterviewFinalizeKeepalive({
        pendingAnswer: pending,
        timeExpired,
        finalizeVia,
        boundaryAutoSaved,
      });
    } catch (_) {
      /* keepalive best-effort */
    }
    console.warn("[FLOW] REPORT_COMPLETED", {
      fallback: true,
      timedOut,
      error: String(err?.message || err),
    });
    try {
      await endProctorSession();
    } catch (_) {
      /* ignore */
    }
    clearCandidateSessionAfterExit();
  }
}

/** Merge new Whisper output with prior text; strip overlaps / duplicated phrases from repeated mic stops. */
function _mergeVoiceTranscript(existing, incoming) {
  let a = String(existing || "").trim().replace(/\s+/g, " ");
  let b = String(incoming || "").trim().replace(/\s+/g, " ");
  if (!b) return a;
  if (!a) return b;
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (bl.length > 10 && (al.includes(bl) || al.endsWith(bl.slice(0, Math.min(bl.length, 32))))) return a;
  if (al.length > 10 && bl.includes(al)) return b;
  if (al === bl) return a;
  const maxOv = Math.min(al.length, bl.length, 48);
  for (let k = maxOv; k >= 10; k--) {
    if (al.endsWith(bl.slice(0, k))) {
      const rest = b.slice(k).trim();
      return rest ? `${a} ${rest}`.replace(/\s+/g, " ").trim() : a;
    }
  }
  return `${a} ${b}`.replace(/\s+/g, " ").trim();
}

/** Full-blob STT when VAD/Whisper segments produced no text (warmup or missed VAD). */
async function _transcribeRecordedChunksFallback() {
  const blob = new Blob(recordedChunks, { type: "audio/webm" });
  if (!blob.size) return "";
  try {
    console.info("[candidate-stt] blob_fallback", { bytes: blob.size });
    return await _transcribeCapturedAudio(blob);
  } catch (err) {
    console.warn("[candidate-stt] blob_fallback_failed", err?.message || err);
    return "";
  }
}

/** Whisper segments first; fall back to recorded webm blob when empty. */
async function _finalizeMicTranscription() {
  let text = "";
  const useVadWhisper = state.autoAdvance?.enabled && state.vadWhisperPipeline !== false;
  if (useVadWhisper) {
    text = String((await flushAutoAdvanceWhisperTranscription()) || "").trim();
  }
  if (!text) {
    text = String((await _transcribeRecordedChunksFallback()) || "").trim();
  }
  if (text) {
    const merged = _mergeVoiceTranscript(spokenAnswerText, text);
    _setSpokenAnswer(merged);
    return merged;
  }
  return String(spokenAnswerText || "").trim();
}

function _stopMicInputInternal() {
  stopAutoAdvanceTurn();
  if (activeRecorder && activeRecorder.state !== "inactive") {
    try {
      activeRecorder.stop();
    } catch (_) {
      // ignore
    }
  }
  activeRecorder = null;
  if (recorderStream) {
    try {
      recorderStream.getTracks().forEach((t) => t.stop());
    } catch (_) {
      // ignore
    }
  }
  recorderStream = null;
  recordedChunks = [];
  isMicListening = false;
  _setMicUi(false);
}

/** Wait until MediaRecorder stop + server transcription finishes (used before /answer or /submit). */
async function waitForMicTranscriptionIdle() {
  const recorderActive = activeRecorder && activeRecorder.state !== "inactive";
  const whisperBusy = autoAdvanceWhisperBusy();
  if (!isMicListening && !recorderActive && !_transcriptionInFlight && !whisperBusy) return;
  await new Promise((resolve) => {
    _micStopDoneResolver = resolve;
    try {
      if (recorderActive) activeRecorder.stop();
      else if (!_transcriptionInFlight && !whisperBusy) resolve();
    } catch (_) {
      resolve();
    }
  });
  if (state.autoAdvance?.enabled && state.vadWhisperPipeline !== false) {
    const text = await flushAutoAdvanceWhisperTranscription();
    if (text) _setSpokenAnswer(_mergeVoiceTranscript(spokenAnswerText, text));
  }
}

/**
 * Start recording after AI finishes (no manual “Begin Response” button).
 * Voice-only capture; surfaces errors if getUserMedia fails.
 */
async function startMicRecordingAuto() {
  if (!window.MediaRecorder) {
    const st = document.getElementById("candidateStatus");
    if (st) st.innerText = "Voice capture is not supported in this browser.";
    return;
  }
  if (isMicListening) return;
  _bypassTranscription = false;
  try {
    recorderStream = await _pickAudioStream();
    recordedChunks = [];
    const rec = new MediaRecorder(recorderStream, { mimeType: "audio/webm" });
    rec.onstart = () => {
      _cancelActiveSpeech();
      isMicListening = true;
      notifyAutoAdvanceAnswerActivity("mic_active");
      const hasQuestion = !!(state.currentQuestion || "").trim();
      _setInterviewPhase(
        state.autoAdvance?.enabled && hasQuestion ? "waiting_for_response" : "listening",
      );
      _setMicUi(true);
      const st = document.getElementById("candidateStatus");
      if (st) {
        st.innerText = state.autoAdvance?.enabled
          ? "Speak your answer — we'll detect when you're done."
          : "Listening… speak your answer, then tap Send Response.";
      }
      _startAutoAdvanceForTurn(!!state.isWarmupTurn);
    };
    rec.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
        if (event.data.size > 800) {
          notifyAutoAdvanceAnswerActivity("speech", { bytes: event.data.size });
        }
      }
    };
    rec.onerror = () => {
      const d = _micStopDoneResolver;
      _micStopDoneResolver = null;
      if (typeof d === "function") {
        try {
          d();
        } catch (_) {
          /* ignore */
        }
      }
      _stopMicInputInternal();
      const st = document.getElementById("candidateStatus");
      if (st) st.innerText = "Voice recording error — tap Send Response to retry or Skip Question.";
    };
    rec.onstop = async () => {
      isMicListening = false;
      _setMicUi(false);
      const done = _micStopDoneResolver;
      _micStopDoneResolver = null;
      // Skip / empty submit / End Interview — never call transcription API.
      if (_terminatingInterview || _bypassTranscription) {
        _bypassTranscription = false;
        if (typeof done === "function") {
          try {
            done();
          } catch (_) {
            /* ignore */
          }
        }
        activeRecorder = null;
        recordedChunks = [];
        return;
      }
      try {
        _transcriptionInFlight = true;
        const useVadWhisper = state.autoAdvance?.enabled && state.vadWhisperPipeline !== false;
        if (useVadWhisper) {
          const merged = await _finalizeMicTranscription();
          const st = document.getElementById("candidateStatus");
          if (st) st.innerText = merged ? "Transcription ready." : "";
        } else {
          const blob = new Blob(recordedChunks, { type: "audio/webm" });
          if (!blob.size) {
            try {
              console.warn("[candidate-stt] speech_received_empty_blob");
            } catch (_) {
              /* ignore */
            }
            const st = document.getElementById("candidateStatus");
            if (st) st.innerText = "";
          } else {
            try {
              console.info("[candidate-stt] speech_received", { bytes: blob.size });
            } catch (_) {
              /* ignore */
            }
            const transcribed = await _transcribeCapturedAudio(blob);
            const merged = _mergeVoiceTranscript(spokenAnswerText, transcribed);
            try {
              console.info("[candidate-stt] transcript_generated", { len: merged.length, preview: merged.slice(0, 120) });
            } catch (_) {
              /* ignore */
            }
            _setSpokenAnswer(merged);
            try {
              console.info("[candidate-stt] transcript_stored");
            } catch (_) {
              /* ignore */
            }
            const st = document.getElementById("candidateStatus");
            if (st) st.innerText = merged ? "Transcription ready. Review and tap Send Response." : "";
          }
        }
      } catch (err) {
        const st = document.getElementById("candidateStatus");
        if (st) st.innerText = `Transcription failed: ${err.message}. Tap Send Response to retry.`;
      } finally {
        _transcriptionInFlight = false;
        if (typeof done === "function") {
          try {
            done();
          } catch (_) {
            // ignore
          }
        }
        activeRecorder = null;
        if (recorderStream) {
          try {
            recorderStream.getTracks().forEach((t) => t.stop());
          } catch (_) {
            // ignore
          }
        }
        recorderStream = null;
        recordedChunks = [];
      }
    };
    activeRecorder = rec;
    rec.start(250);
  } catch (err) {
    _cancelActiveSpeech();
    _stopMicInputInternal();
    const st = document.getElementById("candidateStatus");
    if (st) st.innerText = `Microphone unavailable: ${err.message}. Use Skip Question if needed.`;
  }
}

/** Legacy export — still used from app.js console; toggles recording off if active. */
export async function toggleMicInput() {
  if (isMicListening) {
    const st = document.getElementById("candidateStatus");
    if (st) st.innerText = "Transcribing your response…";
    await waitForMicTranscriptionIdle();
    return;
  }
  await startMicRecordingAuto();
}

async function flushPendingAnswerBeforeSubmit() {
  await waitForMicTranscriptionIdleWithTimeout(FINALIZE_GRACE_MS);
  const ans = _collectPendingAnswerText();
  if (!ans) return;
  try {
    await handleJson(
      await apiFetch("/answer", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ans, action: "send" }),
      })
    );
    _setSpokenAnswer("");
    _stopMicInputInternal();
  } catch (err) {
    const m = String(err && err.message ? err.message : err);
    if (/already completed|No active session/i.test(m)) return;
    throw err;
  }
}

async function _pickAudioStream() {
  const verifiedMic = getVerifiedMicStream();
  if (verifiedMic) {
    const vTracks = verifiedMic.getAudioTracks ? verifiedMic.getAudioTracks() : [];
    if (vTracks.length && vTracks[0].readyState === "live") {
      return new MediaStream([vTracks[0].clone()]);
    }
  }
  const live = proctorStream && proctorStream.active ? proctorStream.getAudioTracks() : [];
  if (live && live.length && live[0].readyState === "live") return new MediaStream([live[0].clone()]);
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    throw new Error("This browser does not support microphone capture.");
  }
  return navigator.mediaDevices.getUserMedia({
    audio: {
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
    },
    video: false,
  });
}

async function _transcribeCapturedAudio(blob) {
  const fd = new FormData();
  fd.append("audio_file", blob, "candidate-response.webm");
  const data = await handleJson(await apiFetch("/candidate/transcribe", { method: "POST", body: fd }));
  return String(data.text || "").trim();
}

export function setScreenNavigator(fn) {
  showScreenRef = fn;
}

let _interviewEngine = null;

function _getInterviewEngine() {
  if (!_interviewEngine) {
    _interviewEngine = new InterviewEngine({
      provider: createQuestionProvider({ apiFetch, handleJson, questionSource: state.questionSource }),
      state,
      hooks: {
        setInterviewRuntimeConfig,
        setLiveTranscriptVisible,
        loadQuestion,
        transitionToNextQuestion: _transitionToNextQuestion,
        submitAnswer: submitCandidateAnswer,
        startMicRecordingAuto,
        startAutoAdvanceForTurn: _startAutoAdvanceForTurn,
      },
    });
  }
  return _interviewEngine;
}

function _applyRuntimeFromNextPayload(data) {
  _getInterviewEngine().applyRuntimePayload(data);
}

async function _transitionToNextQuestion(data, loadSeq, options = {}) {
  const { fastTransition = false } = options;
  if (loadSeq !== _questionLoadSeq || _interviewFlowStopped || state.endingInterview || state.redirecting) return;

  stopAutoAdvanceTurn();
  _cancelActiveSpeech();
  _stopMicInputInternal();
  _resetQuestionTurnState("next_question_loaded");
  _applyRuntimeFromNextPayload(data);

  const questionEl = document.getElementById("candidateQuestion");
  const progressEl = document.getElementById("progressPill");
  const statusEl = document.getElementById("candidateStatus");
  if (!questionEl) return;

  state.currentQuestion = _normalizeQuestionPhrasing((data.question || "").replace(/\s+/g, " ").trim());

  if (!state.currentQuestion && data.message === "Interview completed") {
    const idx = Number(data.index) || 0;
    const total = Number(data.total) || 0;
    if (total > 0 && idx < total) {
      console.warn("[FLOW] Premature completion — fetching next question", { idx, total });
      await loadQuestion({ fastTransition: true });
      return;
    }
    if (statusEl) statusEl.innerText = "Finalizing your interview…";
    _setInterviewPhase("evaluating");
    await submitInterview({});
    return;
  }

  const rendered = state.currentQuestion || data.message || "No question available.";
  _prepareQuestionVisual(questionEl, rendered);
  questionEl.title = state.currentQuestion || "";
  _setInterviewPhase("question_shown");
  _logTurnEvent("question_shown", { question_index: data.index, is_warmup: !!data.is_warmup });
  console.info("[FLOW] QUESTION_SHOWN", {
    index: data.index,
    isWarmup: !!data.is_warmup,
    questionType: data.question_type || (data.is_warmup ? "INTRODUCTION" : "TECHNICAL"),
  });
  _applyWarmupChrome(!!data.is_warmup, data.warmup_label, data.warmup_note);
  if (data.is_warmup) {
    if (progressEl) progressEl.innerText = "";
  } else if (data.total && progressEl) {
    progressEl.innerText = `Question ${data.index}/${data.total}`;
  }
  if (fastTransition) {
    _setResponseProcessingUi(false, "");
    _setSendResponseEnabled(false);
    _setInterviewPhase("ai_speaking");
    await _speakQuestionAudioOnly(rendered);
    if (loadSeq !== _questionLoadSeq || _interviewFlowStopped || state.endingInterview || state.redirecting) return;
    _setSendResponseEnabled(true);
    _setInterviewPhase("waiting_for_answer");
    try {
      await startMicRecordingAuto();
    } catch (_) {
      /* startMicRecordingAuto updates status */
    }
    return;
  }

  const speakPromise = _speakQuestionAudioOnly(rendered);
  await speakPromise;
  if (loadSeq !== _questionLoadSeq || _interviewFlowStopped || state.endingInterview || state.redirecting) return;

  _setResponseProcessingUi(false, "");
  _setSendResponseEnabled(true);
  _setInterviewPhase("waiting_for_answer");
  try {
    await startMicRecordingAuto();
  } catch (_) {
    /* startMicRecordingAuto updates status */
  }
}

async function _fetchNextQuestionPayload(timeoutMs = 30000) {
  return _getInterviewEngine().provider.fetchNext(timeoutMs);
}

export async function loadQuestion(options = {}) {
  if (_interviewFlowStopped || state.endingInterview || state.redirecting) return false;
  const loadSeq = ++_questionLoadSeq;
  const prefetched = options.prefetched || null;
  const fastTransition = !!options.fastTransition;
  const throwOnError = !!options.throwOnError;
  const isFirstQuestion = !prefetched && !state.currentQuestion;
  try {
    console.info("[QUESTION] Loading first question", { isFirstQuestion, fastTransition });
    if (!prefetched && isMicListening && !isFirstQuestion) {
      await waitForMicTranscriptionIdle();
    }
    if (loadSeq !== _questionLoadSeq || _interviewFlowStopped || state.endingInterview || state.redirecting) return false;
    _cancelActiveSpeech();
    lastSpokenQuestion = "";
    _stopMicInputInternal();
    _setSendResponseEnabled(false);
    _setInterviewPhase("generating_next");

    const data = prefetched || (await _fetchNextQuestionPayload(isFirstQuestion ? 45000 : 30000));
    if (data?.error) {
      throw new Error(String(data.error));
    }
    console.info("[QUESTION] Question loaded successfully", {
      index: data.index,
      hasQuestion: !!(data.question || "").trim(),
    });
    await _transitionToNextQuestion(data, loadSeq, { fastTransition });
    console.info("[INTERVIEW] Active");
    return true;
  } catch (err) {
    console.error("[QUESTION] Failed", { message: err?.message || String(err) });
    if (_interviewFlowStopped || state.endingInterview || state.redirecting) return false;
    const questionEl = document.getElementById("candidateQuestion");
    if (questionEl) questionEl.innerText = `Error: ${err.message}`;
    _setResponseProcessingUi(false, `Error: ${err.message}`);
    _setSendResponseEnabled(true);
    if (throwOnError) throw err;
    return false;
  }
}

function _hasCapturableAnswerContent(snapshot = null, meta = null) {
  const snap = snapshot || getAutoAdvanceCaptureSnapshot();
  const metaText = _transcriptFromAutoAdvanceMeta(meta);
  const text = String(spokenAnswerText || metaText || snap.capture_text || snap.interim_transcript || snap.whisper_transcript || "").trim();
  const speechMs = Number(snap.speech_duration_ms || snap.confirmed_speech_ms || meta?.speech_duration_ms || meta?.confirmed_speech_ms || 0);
  const wordCount = Number(snap.word_count || meta?.word_count || 0) || text.split(/\s+/).filter(Boolean).length;
  return text.length > 0 || speechMs >= 1000 || wordCount > 0;
}

function _transcriptFromAutoAdvanceMeta(meta) {
  if (!meta || typeof meta !== "object") return "";
  return String(meta.capture_text || meta.interim_transcript || meta.transcript || "").trim();
}

async function _finalizeSkipTranscriptCapture() {
  const hasRecorderAudio = isMicListening || (activeRecorder && activeRecorder.state !== "inactive") || recordedChunks.length > 0;
  if (!hasRecorderAudio && !autoAdvanceWhisperBusy() && String(spokenAnswerText || "").trim()) {
    return _collectPendingAnswerText();
  }
  if (state.autoAdvance?.enabled && state.vadWhisperPipeline !== false) {
    const flushed = String((await flushAutoAdvanceWhisperTranscription()) || "").trim();
    if (flushed) _setSpokenAnswer(_mergeVoiceTranscript(spokenAnswerText, flushed));
  }
  const deadline = Date.now() + 4000;
  while (autoAdvanceWhisperBusy() && Date.now() < deadline) {
    await _delay(80);
    const flushed = String((await flushAutoAdvanceWhisperTranscription()) || "").trim();
    if (flushed) _setSpokenAnswer(_mergeVoiceTranscript(spokenAnswerText, flushed));
  }
  if (!String(spokenAnswerText || "").trim() && recordedChunks.length > 0) {
    const recovered = await _finalizeMicTranscription();
    if (recovered) _setSpokenAnswer(recovered);
  }
  return _collectPendingAnswerText();
}

export async function submitCandidateAnswer(forceSkip = false, _retryAfterTranscription = false, options = {}) {
  const skipRequested = forceSkip === true;
  let autoAdvanceMeta = options.autoAdvanceMeta || null;

  if (_answerSubmitInFlight || _submitInterviewInFlight || _interviewFlowStopped || state.endingInterview || state.redirecting) {
    console.warn("[SUBMIT] Ignored — interview busy or submit in flight");
    return;
  }

  if (skipRequested && !_retryAfterTranscription) {
    const finalized = await _finalizeSkipTranscriptCapture();
    if (finalized) {
      console.info("[SKIP] Transcript finalized before skip decision", {
        question_index: state.currentQuestionIndex,
        transcript_len: finalized.length,
        preview: finalized.slice(0, 120),
      });
    }
  }

  const captureSnapshot = getAutoAdvanceCaptureSnapshot();
  let explicitSkip = skipRequested;

  if (skipRequested) {
    console.info("[SKIP] Skip clicked", {
      question_index: state.currentQuestionIndex,
      hasTranscript: !!String(spokenAnswerText || "").trim(),
    });
    if (_hasCapturableAnswerContent(captureSnapshot, autoAdvanceMeta)) {
      console.info("[SKIP] Transcript exists — converting skip into answered question", {
        question_index: state.currentQuestionIndex,
        transcript_len: String(spokenAnswerText || _transcriptFromAutoAdvanceMeta(autoAdvanceMeta) || captureSnapshot.capture_text || "").length,
      });
      explicitSkip = false;
      const snapText = String(
        spokenAnswerText || _transcriptFromAutoAdvanceMeta(autoAdvanceMeta) || captureSnapshot.capture_text || captureSnapshot.interim_transcript || "",
      ).trim();
      if (!String(spokenAnswerText || "").trim() && snapText) _setSpokenAnswer(snapText);
      if (!autoAdvanceMeta) {
        autoAdvanceMeta = {
          ...captureSnapshot,
          trigger: "manual_skip_with_answer",
          partial_answer: true,
          auto_submitted: false,
          skipped: false,
        };
      } else {
        autoAdvanceMeta = {
          ...autoAdvanceMeta,
          partial_answer: true,
          auto_submitted: false,
          skipped: false,
          trigger: autoAdvanceMeta.trigger || "skip_with_answer",
        };
      }
    }
  }

  console.info("[SUBMIT] Button clicked", {
    forceSkip: explicitSkip,
    skipRequested,
    retryAfterTranscription: _retryAfterTranscription,
    hasTranscript: !!String(spokenAnswerText || "").trim(),
    question_index: state.currentQuestionIndex,
    inFlight: _answerSubmitInFlight,
  });
  _pendingManualSubmit = false;
  _answerSubmitInFlight = true;
  stopAutoAdvanceTurn();
  const statusEl = document.getElementById("candidateStatus");

  if (explicitSkip) {
    _logTurnEvent("action_taken", { action: "skip", skipped: true });
    _stopMicWithoutTranscription();
    _setInterviewPhase("generating_next");
  } else {
    _bypassTranscription = false;
    _logTurnEvent("action_taken", { action: "send", skipped: false });
    const existingTranscript = _collectPendingAnswerText();
    const recorderActive = activeRecorder && activeRecorder.state !== "inactive";
    const awaitingTranscript = isMicListening || recorderActive || _transcriptionInFlight;
    if (existingTranscript) {
      if (!String(spokenAnswerText || "").trim()) _setSpokenAnswer(existingTranscript);
      if (recorderActive || isMicListening) {
        // We already hold the answer — this only catches trailing words.
        await waitForMicTranscriptionIdleWithTimeout(SUBMIT_TAIL_GRACE_MS);
      }
    } else if (awaitingTranscript) {
      _pendingManualSubmit = true;
      if (statusEl) statusEl.innerText = "Processing answer…";
      _setResponseProcessingUi(true, "Processing answer…");
      _setInterviewPhase("evaluating");
      console.info("[SUBMIT] Processing answer — waiting for transcript");
      // Nothing captured yet: this wait IS the answer, so keep it generous.
      await waitForMicTranscriptionIdleWithTimeout(SUBMIT_TRANSCRIPT_WAIT_MS);
      if (!_pendingManualSubmit) {
        _answerSubmitInFlight = false;
        return;
      }
      _pendingManualSubmit = false;
    }
  }
  if (_interviewFlowStopped || state.endingInterview || state.redirecting) {
    _answerSubmitInFlight = false;
    return;
  }

  const spokenText = explicitSkip ? "" : _collectPendingAnswerText();
  if (!explicitSkip && spokenText && !String(spokenAnswerText || "").trim()) _setSpokenAnswer(spokenText);
  let ans = explicitSkip ? SKIPPED_ANSWER_TOKEN : spokenText || String(spokenAnswerText || "").trim();
  const skipped = explicitSkip;

  if (!explicitSkip && !ans) {
    const stillBusy = isMicListening || _transcriptionInFlight || (activeRecorder && activeRecorder.state !== "inactive");
    if (stillBusy && !_retryAfterTranscription) {
      _answerSubmitInFlight = false;
      return submitCandidateAnswer(false, true);
    }
    if (!stillBusy && (recordedChunks.length > 0 || autoAdvanceWhisperBusy())) {
      const recovered = await _finalizeMicTranscription();
      if (recovered) ans = recovered;
    }
  }
  if (!explicitSkip && !ans) {
    _setResponseProcessingUi(false, "");
    _setInterviewPhase("waiting_for_answer");
    setLiveTranscriptVisible(state.showSpokenText);
    _setSendResponseEnabled(true);
    const emptyMsg = "No answer captured. Speak first, then tap Send Response.";
    if (statusEl) statusEl.innerText = emptyMsg;
    _showCandidateToast(emptyMsg);
    _answerSubmitInFlight = false;
    return;
  }

  if (explicitSkip) {
    _showCandidateToast("Question skipped");
  }

  _logTurnEvent("transcript_received", {
    action: skipped ? "skip" : "send",
    skipped,
    transcript_len: skipped ? 0 : String(ans || "").length,
    transcript_preview: skipped ? SKIPPED_ANSWER_TOKEN : String(ans || "").slice(0, 120),
  });

  const loadSeq = ++_questionLoadSeq;
  try {
    _setResponseProcessingUi(true, skipped ? "Skipping question..." : "Saving answer...");
    if (!skipped) {
      console.info("[EVALUATION] Started");
      _logTurnEvent("evaluation_started", { action: "send", skipped: false });
      if (skipRequested) {
        console.info("[ANSWER] Saving transcript");
      }
    }
    _logTurnEvent("answer_received", {
      action: skipped ? "skip" : "send",
      skipped,
      question_index: state.currentQuestionIndex,
      transcript_len: skipped ? 0 : String(ans || "").length,
    });
    console.info("[SUBMIT] Payload", {
      question_index: state.currentQuestionIndex,
      action: skipped ? "skip" : "send",
      skipped,
      transcript_len: skipped ? 0 : String(ans || "").length,
      transcript_preview: skipped ? SKIPPED_ANSWER_TOKEN : String(ans || "").slice(0, 120),
    });
    const params = new URLSearchParams({
      ans,
      action: skipped ? "skip" : "send",
    });
    if (skipped) {
      params.set("skip_reason", options.skipReason || "Candidate skipped manually");
    }
    if (autoAdvanceMeta && typeof autoAdvanceMeta === "object") {
      params.set("auto_advance_meta", JSON.stringify(autoAdvanceMeta));
    }

    const res = await apiFetch("/answer", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (res.status === 409) {
      let blocked = null;
      try {
        blocked = await res.json();
      } catch (_) {
        blocked = null;
      }
      if (blocked?.speech_blocked) {
        console.info("[SKIP] Server blocked skip — resuming listen", { reason: blocked.reason });
        _setResponseProcessingUi(false, "");
        _setInterviewPhase("listening");
        setAiState("Listening...");
        _startAutoAdvanceForTurn(!!state.isWarmupTurn);
        return;
      }
    }
    const resp = await handleJson(res);

    _cancelActiveSpeech();
    if (!skipped) {
      _logTurnEvent("evaluation_completed", { action: "send", skipped: false });
      console.info("[EVALUATION] Completed");
    }
    _logTurnEvent("answer_saved", {
      action: skipped ? "skip" : "send",
      skipped,
      words: skipped ? 0 : String(ans || "").split(/\s+/).filter(Boolean).length,
    });

    if (skipped) {
      _logTurnEvent("question_skipped", { action: "skip", skipped: true });
    }
    _resetQuestionTurnState(skipped ? "after_skip_saved" : "after_answer_saved");

    console.info("[FLOW] NEXT_QUESTION_FETCHED", { skipped, hasNext: !!resp.next });
    if (resp.next) {
      if (resp.next.tts_invalidate) {
        lastSpokenQuestion = "";
        _cancelActiveSpeech();
        // The server swapped in an adaptive follow-up, so any audio we warmed
        // for the old question is now wrong. Warm the replacement instead.
        invalidatePrewarmedQuestion(resp.next.question);
        prewarmQuestionAudio(resp.next.question);
      }
      await _transitionToNextQuestion(resp.next, loadSeq, { fastTransition: true });
      _logTurnEvent("next_question_displayed", { question_index: state.currentQuestionIndex });
    } else {
      _setInterviewPhase("generating_next");
      await loadQuestion({ fastTransition: true });
      _logTurnEvent("next_question_displayed", { question_index: state.currentQuestionIndex });
    }
  } catch (err) {
    if (_interviewFlowStopped || state.endingInterview || state.redirecting) return;
    console.error("[FLOW] ANSWER_SUBMIT_FAILED", err);
    _setResponseProcessingUi(false, `Error: ${err.message}`);
    _setInterviewPhase("waiting_for_answer");
    setAiState(`Error: ${err.message}`);
    setLiveTranscriptVisible(state.showSpokenText);
    _setSendResponseEnabled(true);
  } finally {
    _pendingManualSubmit = false;
    if (!_terminatingInterview) _bypassTranscription = false;
    _answerSubmitInFlight = false;
  }
}


export async function submitInterview(options = {}) {
  const timeExpired = !!(options && options.timeExpired);
  if (_submitInterviewInFlight) return;
  _submitInterviewInFlight = true;

  const exitTerminated = (() => {
    try {
      return window.__karnexInterviewExitOutcome === "terminated";
    } catch (_) {
      return false;
    }
  })();

  let role = "";
  try {
    role = JSON.parse(getAuthUserRaw() || "{}").role || "";
  } catch (_) {
    role = "";
  }

  // May 2026 — Save boundary answer via /answer, then finalize and redirect only after report persists.
  if (role === "candidate" || role === "") {
    try {
      window.__karnexInterviewExitOutcome = "";
    } catch (_) {
      /* ignore */
    }

    const overlay = document.getElementById("interviewEndingOverlay");
    if (overlay) {
      _setEndingOverlayText("Saving your answer…");
      overlay.classList.add("is-active");
      overlay.setAttribute("aria-hidden", "false");
    }

    try {
      await _submitBoundaryAnswerBeforeFinalize({
        timeExpired,
        manualEnd: !timeExpired,
      });
      _freezeInterviewForFinalize();
      _setEndingOverlayText("Interview complete — generating report…");
      await _backgroundFinalizeInterview({
        timeExpired,
        exitTerminated,
        manualEnd: !timeExpired,
      });
    } catch (err) {
      console.warn("[SUBMIT] Interview finalize error", err);
      if (!state.endingInterview) _freezeInterviewForFinalize();
      try {
        await _backgroundFinalizeInterview({
          timeExpired,
          exitTerminated,
          manualEnd: !timeExpired,
        });
      } catch (inner) {
        console.warn("[SUBMIT] Background finalize retry failed", inner);
      }
    } finally {
      _submitInterviewInFlight = false;
    }
    _redirectAfterInterview(exitTerminated);
    return;
  }

  // HR / demo-session path: keep synchronous submit + result screen.
  const statusEl = document.getElementById("candidateStatus");
  try {
    if (statusEl && timeExpired) statusEl.innerText = "Time limit reached. Saving and submitting interview…";
    await flushPendingAnswerBeforeSubmit();
    _stopMicInputInternal();
    _cancelActiveSpeech();
    await endProctorSession();
    await handleJson(await apiFetch("/submit", { method: "POST" }));
    try {
      window.__karnexInterviewExitOutcome = "";
    } catch (_) {
      /* ignore */
    }
    if (statusEl) statusEl.innerText = "Interview submitted successfully.";
    stopInterviewTimer();
    _submitInterviewInFlight = false;
    try {
      await loadHrRecords();
    } catch (_) {
      /* ignore */
    }
    setTimeout(() => {
      window.close();
      if (!window.closed) window.location.href = "/thank-you.html";
    }, 1400);
    if (showScreenRef) showScreenRef("result");
  } catch (err) {
    _submitInterviewInFlight = false;
    _terminatingInterview = false;
    state.endingInterview = false;
    if (statusEl) statusEl.innerText = `Submit failed: ${err.message}`;
  }
}

export function setLiveTranscriptVisible(show) {
  // May 2026: transcript is OFF unless the template explicitly enables it.
  // Only one panel exists in the DOM; when OFF we hide it and skip UI updates.
  const enabled = show === true;
  state.showSpokenText = enabled;
  const panel = document.getElementById("candidateTranscriptPanel");
  if (panel) {
    panel.hidden = !enabled;
    panel.classList.toggle("is-visible", enabled);
    panel.setAttribute("aria-hidden", enabled ? "false" : "true");
    if (enabled) state.transcriptInitialized = true;
  }
  const box = document.getElementById("candidateSpokenAnswer");
  if (box && !enabled) box.innerText = "";
}

export function setInterviewRuntimeConfig({
  timingMode,
  timeLimitSec,
  micAlwaysOn,
  showSpokenText,
  timeWarnings,
  autoAdvance,
} = {}) {
  if (timingMode) state.timingMode = String(timingMode);
  state.interviewLimitSec = Number(timeLimitSec) || 0;
  state.micAlwaysOn = !!micAlwaysOn;
  if (showSpokenText !== undefined) {
    setLiveTranscriptVisible(showSpokenText);
  }
  if (timeWarnings !== undefined) {
    applyTimeWarningConfig({ time_warnings: timeWarnings });
  }
  if (autoAdvance !== undefined) {
    applyAutoAdvanceConfig({ auto_advance: autoAdvance });
  }
}

export function startInterviewTimer() {
  stopInterviewTimer();
  _ensureInterviewUnloadGuard();
  resetTimeWarningUiState();
  resetAutoAdvanceUi();
  state.interviewStartTs = Date.now();
  console.info("[TIMER] Started");
  const timerEl = document.getElementById("interviewTimer");
  if (timerEl) timerEl.classList.remove("countdown-active");
  state.interviewTimerHandle = setInterval(() => {
    if (_interviewFlowStopped || state.endingInterview || state.redirecting) {
      stopInterviewTimer();
      return;
    }
    const el = document.getElementById("interviewTimer");
    if (!el || !state.interviewStartTs) return;
    const elapsed = Math.max(0, Math.floor((Date.now() - state.interviewStartTs) / 1000));
    const limit = Math.max(0, Number(state.interviewLimitSec) || 0);
    const useLimit = String(state.timingMode || "").toLowerCase() === "time" && limit > 0;
    const diff = useLimit ? Math.max(0, limit - elapsed) : elapsed;
    const mm = String(Math.floor(diff / 60)).padStart(2, "0");
    const ss = String(diff % 60).padStart(2, "0");
    el.innerText = useLimit ? `${mm}.${ss}` : `${mm}:${ss}`;
    if (useLimit && diff <= 300 && diff > 0) {
      el.classList.add("countdown-active");
    } else if (useLimit) {
      el.classList.remove("countdown-active");
    }
    if (useLimit) {
      tickInterviewTimeWarnings(diff);
    }
    if (useLimit && elapsed >= limit) {
      const st = document.getElementById("candidateStatus");
      if (st) st.innerText = "Time limit reached. Saving and submitting interview…";
      stopInterviewTimer();
      void submitInterview({ timeExpired: true });
    }
  }, 1000);
}

export function stopInterviewTimer() {
  if (state.interviewTimerHandle) {
    clearInterval(state.interviewTimerHandle);
    state.interviewTimerHandle = null;
  }
}

function setProctorUi(status, score, message) {
  const pill = document.getElementById("proctorStatusPill");
  const warn = document.getElementById("proctorWarnings");
  const viol = document.getElementById("proctorViolations");
  const setCheck = (id, ok) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("ok", !!ok);
  };
  if (pill) {
    pill.innerText = String(status || "SAFE");
    pill.classList.remove("safe", "warn", "fail");
    if (status === "FAIL") pill.classList.add("fail");
    else if (status === "WARNING") pill.classList.add("warn");
    else pill.classList.add("safe");
  }
  if (viol) {
    const v = proctorViolationCounts;
    viol.innerText = `tab=${v.tabSwitch || 0} | faces=${v.extraFace || 0} | score=${score ?? "--"}`;
  }
  if (warn) warn.innerText = message || "";

  // Map checks to current state (simple deterministic)
  setCheck("proctorCamCheck", (proctorStream && proctorStream.getVideoTracks().length) || false);
  setCheck("proctorMicCheck", (proctorStream && proctorStream.getAudioTracks().length) || false);
  setCheck("proctorScreenCheck", document.fullscreenElement != null);
  setCheck("proctorFsCheck", document.fullscreenElement != null);
  setCheck("proctorTabCheck", (proctorViolationCounts.tabSwitch || 0) === 0);
  setCheck("proctorFaceCheck", (proctorViolationCounts.extraFace || 0) === 0);
  setCheck("proctorCopyCheck", true);
}

async function startProctorSession() {
  if (proctorActive) return;
  try {
    const fd = new FormData();
    fd.append("candidateId", "");
    fd.append("interviewId", "");
    const data = await handleJson(await apiFetch("/proctor/start-session", { method: "POST", body: fd }));
    proctorSessionId = data.session?.sessionId || "";
    proctorViolationCounts = data.session?.violations || proctorViolationCounts;
    proctorActive = true;
    window.__karnexReportProctorViolation = (type, meta) => sendViolation(type, meta);
  } catch (e) {
    proctorActive = false;
    setProctorUi("WARNING", 55, `Live proctor sync failed: ${e.message}. Interview continues.`);
  }
}

async function sendViolation(type, meta) {
  if (!proctorSessionId) return;
  try {
    const fd = new FormData();
    fd.append("sessionId", proctorSessionId);
    fd.append("type", type);
    fd.append("meta", meta || "");
    const data = await handleJson(await apiFetch("/proctor/violation", { method: "POST", body: fd }));
    proctorViolationCounts = data.violations || proctorViolationCounts;
    const warningLevel = Number(data.warning_level || 0);
    const warningText =
      data.status === "FAIL"
        ? "Session terminated."
        : `Warning ${Math.max(1, warningLevel)} of ${MAX_WARNINGS} issued.`;
    setProctorUi(data.status, data.proctorScore, `Violation detected: ${type}. ${warningText}`);
    if (data.terminated) {
      try {
        window.__karnexInterviewExitOutcome = "terminated";
      } catch (_) {
        /* ignore */
      }
      const st = document.getElementById("candidateStatus");
      if (st) st.innerText = "Proctoring failed due to violations. Interview terminated. Finalizing session…";
      _cancelActiveSpeech();
      stopInterviewTimer();
      await submitInterview();
    }
  } catch (e) {
    setProctorUi("WARNING", 0, `Violation log error: ${e.message}`);
  }
}

function _releaseProctorStream() {
  if (!proctorStream) return;
  try {
    proctorStream.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch (_) {
        /* ignore */
      }
    });
  } catch (_) {
    /* ignore */
  }
  proctorStream = null;
  const video = document.getElementById("proctorCam");
  if (video) video.srcObject = null;
}

export async function endProctorSession() {
  if (!proctorSessionId) {
    _releaseProctorStream();
    return;
  }
  try {
    const fd = new FormData();
    fd.append("sessionId", proctorSessionId);
    fd.append("candidateId", "");
    await handleJson(await apiFetch("/proctor/end-session", { method: "POST", body: fd }));
  } catch (_) {
    // ignore
  } finally {
    proctorSessionId = "";
    proctorActive = false;
    try {
      delete window.__karnexReportProctorViolation;
    } catch (_) {
      window.__karnexReportProctorViolation = undefined;
    }
    _releaseProctorStream();
  }
}

export async function enterFullscreen() {
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
    proctorFullscreenEntered = !!document.fullscreenElement;
  } catch (_) {
    // Fullscreen requires a direct user gesture in most browsers.
  }
  return !!document.fullscreenElement;
}

function bindProctorListeners() {
  if (proctorListenersBound) return;
  proctorListenersBound = true;
  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement) proctorFullscreenEntered = true;
  });
}

function isLocalHost() {
  const h = window.location.hostname || "";
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

function showMediaGate() {
  const gate = document.getElementById("candMediaGate");
  if (!gate) return;
  gate.hidden = false;
  gate.removeAttribute("aria-hidden");
  gate.style.removeProperty("display");
  document.body.classList.remove("cand-media-gate-dismissed");
}

function hideMediaGate() {
  const gate = document.getElementById("candMediaGate");
  if (!gate) return;
  gate.hidden = true;
  gate.setAttribute("aria-hidden", "true");
  gate.style.setProperty("display", "none", "important");
  document.body.classList.add("cand-media-gate-dismissed");
}

function setGateStatus(html) {
  const el = document.getElementById("candMediaGateStatus");
  if (!el) return;
  const text = String(html || "");
  if (/<[a-z][\s\S]*>/i.test(text)) {
    el.innerHTML = text;
  } else {
    el.textContent = text;
  }
}

function bindVideoTracks(stream) {
  const video = document.getElementById("proctorCam");
  if (video) video.srcObject = stream;
  const track = stream.getVideoTracks()[0];
  if (track) {
    track.addEventListener("ended", () => {
      setProctorUi("WARNING", 0, "Camera feed ended. Interview audio and answers continue.");
    });
    track.addEventListener("mute", () => {
      setProctorUi("WARNING", 0, "Camera feed muted. Interview audio and answers continue.");
    });
  }
}

/** Must run from a click/tap handler so the browser can show the permission prompt. */
/** Optional camera preview only — does not re-request microphone (device check owns mic). */
async function _initOptionalCameraVideoOnly() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    return false;
  }
  if (proctorStream && proctorStream.active && proctorStream.getVideoTracks().length) {
    return true;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    proctorStream = stream;
    bindVideoTracks(stream);
    return true;
  } catch (_) {
    return false;
  }
}

async function requestCameraMicFromUserGesture() {
  const video = document.getElementById("proctorCam");
  if (!video) return false;
  if (proctorStream && proctorStream.active && proctorStream.getVideoTracks().length) {
    return true;
  }
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    throw new Error("NO_GET_USER_MEDIA");
  }
  if (proctorStream) {
    proctorStream.getTracks().forEach((t) => t.stop());
    proctorStream = null;
  }
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: {
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
      },
    });
  } catch (_) {
    // Camera optional: continue with microphone-only if camera is unavailable.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
      },
      video: false,
    });
  }
  proctorStream = stream;
  if (stream.getVideoTracks().length) bindVideoTracks(stream);
  return true;
}

function formatMediaError(err) {
  const name = err && err.name ? err.name : "";
  const msg = err && err.message ? String(err.message) : String(err || "");
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return (
      "<strong>Access was blocked.</strong> Click the lock or tune icon in the address bar → set Camera and Microphone to <strong>Allow</strong>, then click the button again."
    );
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "<strong>No camera/mic found.</strong> Plug in a device and try again.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "<strong>Camera or mic is busy.</strong> Close other apps using them and try again.";
  }
  if (name === "SecurityError" || name === "NotSupportedError" || msg.includes("secure context")) {
    return (
      "<strong>This address cannot use camera/mic.</strong> Use <strong>HTTPS</strong> on your LAN (run <code>start_app.bat</code>, open <code>https://&lt;your-IP&gt;:8443</code>) or use <strong>http://localhost:8010</strong> on this computer."
    );
  }
  if (msg === "NO_GET_USER_MEDIA") {
    return "This browser does not support camera/microphone access.";
  }
  return `<strong>Could not start camera/mic.</strong> (${name || "error"}) ${msg}`;
}

async function onAllowMediaButtonClick() {
  const primaryBtn = document.getElementById("candBtnAllowMedia");
  if (primaryBtn) primaryBtn.disabled = true;
  setGateStatus("Requesting access… look for the browser’s permission bar or popup.");
  try {
    const ok = await requestCameraMicFromUserGesture();
    const camAvailable = !!(proctorStream && proctorStream.getVideoTracks().length);
    // Dismiss overlay immediately so success is never hidden behind display:grid vs [hidden] bugs.
    hideMediaGate();
    setGateStatus("");
    const st = document.getElementById("candidateStatus");
    if (st) st.innerText = camAvailable ? "Camera and microphone enabled. Starting interview…" : "Microphone enabled. Camera unavailable; continuing interview.";
    await completeProctoringStartup(Boolean(ok && camAvailable));
    if (st) st.innerText = "";
  } catch (err) {
    hideMediaGate();
    setGateStatus("");
    setProctorUi("WARNING", 0, "Camera/Mic unavailable. Continuing without camera.");
    await completeProctoringStartup(false);
    const st = document.getElementById("candidateStatus");
    if (st) st.innerText = `Media unavailable: ${formatMediaError(err).replace(/<[^>]*>/g, "")}`;
  } finally {
    if (primaryBtn) primaryBtn.disabled = false;
  }
}

async function onAllowExtraPermissionsClick() {
  const bits = [];
  if (!window.isSecureContext && !isLocalHost()) {
    bits.push("Location needs HTTPS or localhost — use start_app.bat (port 8443).");
  } else if (navigator.geolocation) {
    try {
      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 20000,
          maximumAge: 600000,
          enableHighAccuracy: false,
        });
      });
      bits.push("Location: allowed.");
    } catch (gerr) {
      bits.push(`Location: ${gerr && gerr.code === 1 ? "denied" : "unavailable"}.`);
    }
  }
  if ("Notification" in window) {
    try {
      if (Notification.permission === "default") {
        const n = await Notification.requestPermission();
        bits.push(`Notifications: ${n}.`);
      } else {
        bits.push(`Notifications: ${Notification.permission}.`);
      }
    } catch (_) {
      bits.push("Notifications: could not request.");
    }
  }
  setGateStatus(bits.join(" "));
}

function bindMediaGateOnce() {
  if (mediaGateBound) return;
  mediaGateBound = true;
  const primary = document.getElementById("candBtnAllowMedia");
  const skip = document.getElementById("candBtnSkipMedia");
  const extra = document.getElementById("candBtnAllowExtra");
  if (primary) primary.addEventListener("click", () => void onAllowMediaButtonClick());
  if (skip) {
    skip.addEventListener("click", async () => {
      hideMediaGate();
      setGateStatus("");
      await completeProctoringStartup(false);
      const st = document.getElementById("candidateStatus");
      if (st) st.innerText = "Continuing without camera. You can still complete interview normally.";
    });
  }
  if (extra) extra.addEventListener("click", () => void onAllowExtraPermissionsClick());
}

async function completeProctoringStartup(camOk) {
  if (proctoringFullyStarted) return;
  await startProctorSession();
  bindProctorListeners();
  proctoringFullyStarted = true;
  if (!camOk) {
    setProctorUi("WARNING", 0, "Camera is OFF. Use “Camera / mic prompt” if you need to retry.");
    return;
  }
  if (proctorActive) {
    setProctorUi("SAFE", 100, "Camera is ON. Interview runs in fullscreen mode.");
  } else {
    setProctorUi(
      "WARNING",
      65,
      "Camera is on; server proctor session unavailable — you can still complete all questions."
    );
  }
}

/** Legacy path if something calls ensureCamera directly */
async function ensureCamera() {
  try {
    return await requestCameraMicFromUserGesture();
  } catch (_) {
    setProctorUi("WARNING", 0, "Camera/Mic permission is required. Use “Allow camera & microphone” on the welcome card.");
    return false;
  }
}

function updateSecureContextBanner() {
  const el = document.getElementById("candSecureBanner");
  if (!el) return;
  const host = window.location.hostname || "";
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (window.isSecureContext || isLocal) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML =
    "Camera and microphone are blocked on this URL: the browser requires HTTPS (or localhost) for media. " +
    "Run <code>start_app.bat</code> and open <strong>https://&lt;your-LAN-IP&gt;:8443</strong> (accept the certificate warning), " +
    "or test on this machine with <strong>http://localhost:8010</strong>. " +
    "Add that origin to <code>CORS_ALLOW_ORIGINS</code> in <code>.env</code> if API calls fail.";
}

/**
 * Best-effort detection that camera + microphone have already been approved
 * in this browsing session — either via the Device Check page or via Chrome's
 * persistent permission cache. Returns:
 *   { mic: boolean, camera: boolean, source: "device-test" | "permissions-api" }
 *   or null if no signal is available.
 *
 * We intentionally treat the value as a hint, not a guarantee: any subsequent
 * `getUserMedia` failure falls back to the legacy media gate (Issue 1 failsafe).
 */
async function _detectExistingMediaPermissions() {
  const persisted = readPersistedDeviceTestState();
  if (persisted && (persisted.mic || persisted.camera || persisted.cameraSkipped)) {
    return {
      mic: !!persisted.mic,
      camera: !!persisted.camera,
      cameraSkipped: !!persisted.cameraSkipped,
      source: "device-test",
    };
  }
  if (!navigator.permissions || typeof navigator.permissions.query !== "function") {
    return null;
  }
  try {
    const [camRes, micRes] = await Promise.allSettled([
      navigator.permissions.query({ name: "camera" }),
      navigator.permissions.query({ name: "microphone" }),
    ]);
    const camGranted = camRes.status === "fulfilled" && camRes.value && camRes.value.state === "granted";
    const micGranted = micRes.status === "fulfilled" && micRes.value && micRes.value.state === "granted";
    if (!camGranted && !micGranted) return null;
    return {
      mic: micGranted,
      camera: camGranted,
      cameraSkipped: false,
      source: "permissions-api",
    };
  } catch (_) {
    return null;
  }
}

let _initProctoringPromise = null;

export async function initProctoring() {
  if (proctoringFullyStarted) return;
  if (_initProctoringPromise) return _initProctoringPromise;
  _initProctoringPromise = _initProctoringBody().finally(() => {
    _initProctoringPromise = null;
  });
  return _initProctoringPromise;
}

async function _initProctoringBody() {
  // May 2026: transcript panel hidden until /next confirms template enabled it.
  setLiveTranscriptVisible(false);
  updateSecureContextBanner();
  bindMediaGateOnce();

  if (proctorStream && proctorStream.active && proctorStream.getVideoTracks().length) {
    hideMediaGate();
    await completeProctoringStartup(true);
    return;
  }

  // Device Check already verified the microphone — reuse that stream; never
  // call getUserMedia({ audio: true }) again on the interview page.
  const persisted = readPersistedDeviceTestState();
  let verifiedMic = getVerifiedMicStream();
  if (persisted && persisted.mic && !verifiedMic && navigator.mediaDevices?.getUserMedia) {
    try {
      const silentMic = await navigator.mediaDevices.getUserMedia({
        audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
        video: false,
      });
      adoptVerifiedMicStream(silentMic);
      verifiedMic = getVerifiedMicStream();
    } catch (_) {
      /* fall through to media gate */
    }
  }
  if (persisted && persisted.mic && verifiedMic) {
    proctoringFullyStarted = false;
    hideMediaGate();
    setGateStatus("");
    if (persisted.camera && !persisted.cameraSkipped) {
      try {
        await _initOptionalCameraVideoOnly();
      } catch (_) {
        /* camera optional */
      }
    }
    const camAvailable = !!(proctorStream && proctorStream.getVideoTracks().length);
    await completeProctoringStartup(camAvailable);
    return;
  }

  const prior = await _detectExistingMediaPermissions();
  if (prior && prior.source === "permissions-api" && (prior.mic || prior.camera)) {
    proctoringFullyStarted = false;
    hideMediaGate();
    setGateStatus("");
    try {
      const ok = await requestCameraMicFromUserGesture();
      const camAvailable = !!(proctorStream && proctorStream.getVideoTracks().length);
      await completeProctoringStartup(Boolean(ok && camAvailable));
      return;
    } catch (_) {
      clearPersistedDeviceTestState();
      releaseVerifiedMicStream();
    }
  }

  proctoringFullyStarted = false;
  showMediaGate();
  setGateStatus("Tap <strong>Allow camera & microphone</strong> so your browser can show the permission prompt.");
  setProctorUi("WARNING", 0, "Waiting for you to allow camera and microphone (use the blue button).");
}

/** Call from console or a future “Fix permissions” link */
export function reopenMediaPermissionGate() {
  proctoringFullyStarted = false;
  showMediaGate();
  setGateStatus("Try again: click the blue button, then choose Allow.");
}

export function setModeTag(text) {
  const el = document.getElementById("modeTag");
  if (el) el.innerText = text;
}

