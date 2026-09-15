/**
 * Unified interview flow for manual and AI-generated (dynamic) question sources.
 * Candidate UI hooks stay in candidate.js; this module owns provider selection
 * and runtime payload application from /next and /answer responses.
 */

import { applyAutoAdvanceConfig } from "./interview_auto_advance.js";

class QuestionProvider {
  constructor({ apiFetch, handleJson, questionSource = "" }) {
    this.apiFetch = apiFetch;
    this.handleJson = handleJson;
    this.questionSource = questionSource;
  }

  async fetchNext(timeoutMs = 30000) {
    const res = await this.apiFetch("/next", { method: "GET" }, { timeoutMs });
    return this.handleJson(res);
  }
}

class ApiQuestionProvider extends QuestionProvider {}

class ManualQuestionProvider extends QuestionProvider {
  constructor(deps) {
    super({ ...deps, questionSource: "manual" });
  }
}

class DynamicQuestionProvider extends QuestionProvider {
  constructor(deps) {
    super({ ...deps, questionSource: "dynamic" });
  }
}

/**
 * Resolves provider from session payload (question_source is backend metadata).
 * @param {{ apiFetch: Function, handleJson: Function, questionSource?: string }} deps
 */
export function createQuestionProvider(deps) {
  const src = String(deps.questionSource || "").toLowerCase();
  if (src === "manual") return new ManualQuestionProvider(deps);
  if (src === "dynamic") return new DynamicQuestionProvider(deps);
  return new ApiQuestionProvider(deps);
}

export class InterviewEngine {
  /**
   * @param {{ provider: QuestionProvider, state: object, hooks: object }} opts
   */
  constructor({ provider, state, hooks }) {
    this.provider = provider;
    this.state = state;
    this.hooks = hooks;
  }

  /** Apply /next or /answer `next` runtime fields — same for manual + dynamic. */
  applyRuntimePayload(data = {}) {
    if (data.timing_mode !== undefined) {
      this.hooks.setInterviewRuntimeConfig?.({
        timingMode: data.timing_mode,
        timeLimitSec: Number(data.time_limit_sec) || 0,
        // Server-authoritative clock (15 Sep 2026): a reload used to restart
        // the timer from zero; now the countdown resumes from what is left.
        timeRemainingSec: data.time_remaining_sec,
        micAlwaysOn: !!data.mic_always_on,
        showSpokenText: data.enable_transcript_input === true || data.show_spoken_text === true,
        timeWarnings: data.time_warnings,
        autoAdvance: data.auto_advance,
      });
      this.hooks.setLiveTranscriptVisible?.(
        data.enable_transcript_input === true || data.show_spoken_text === true,
      );
    } else if (data.auto_advance !== undefined) {
      applyAutoAdvanceConfig({ auto_advance: data.auto_advance });
    }
    this.state.currentQuestionIndex = Number(data.index) || 0;
    this.state.isWarmupTurn = !!data.is_warmup;
    if (data.question_source) {
      this.state.questionSource = String(data.question_source);
    }
  }

  shouldStartAutoAdvance(data = {}) {
    return !!this.state.autoAdvance?.enabled && !data.is_warmup && !this.state.isWarmupTurn;
  }

  async loadQuestion(options = {}) {
    return this.hooks.loadQuestion?.(options);
  }

  async transitionToNextQuestion(data, loadSeq, options = {}) {
    return this.hooks.transitionToNextQuestion?.(data, loadSeq, options);
  }

  async submitAnswer(forceSkip, retry, options = {}) {
    return this.hooks.submitAnswer?.(forceSkip, retry, options);
  }
}
