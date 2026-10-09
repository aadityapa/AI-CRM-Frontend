/**
 * conversation.js — the two-way interview, candidate side (9 Oct 2026).
 *
 * Everything here is OFF unless the server's /next payload carries a
 * `conversation` block (the template turned it on), so an interview without
 * the feature never touches this module's UI.
 *
 *   B  lead-in      `data.lead_in` is shown above the question and spoken first
 *   C  repeat       "Repeat question" / "Explain the question" buttons, and the
 *                   same request said out loud ("sorry, can you repeat that?")
 *   E  closing Q&A  after the last question, "do you have any questions about
 *                   the role?" — speak or type up to N questions, then finish
 *
 * The server owns the text of every reply (the client never asks for an
 * arbitrary sentence to be read out); this file is UI + fetch only.
 * `detectTurnIntent` mirrors `services/interview/conversation.detect_turn_intent`
 * — keep the two pattern lists in step.
 */
import { apiFetch } from "./core.js";
import { state } from "./state.js";
import { getVerifiedMicStream } from "./device_test.js";
import { transcribeAudioBlob } from "./speech_transcribe.js";

const REPEAT_PATTERNS = [
  /\b(can|could|would) you (please )?(repeat|say) (that|it|the question)( again)?\b/,
  /\brepeat (the|that|this) question\b/,
  /\b(please )?repeat( it| that)?( please)?\b/,
  /\bsay (that|it) again\b/,
  /\bcome again\b/,
  /\bpardon\b/,
  /\bsorry,? i (didn'?t|did not) (hear|catch)\b/,
  /\bone more time\b/,
];
const CLARIFY_PATTERNS = [
  /\b(can|could|would) you (please )?(clarify|explain|rephrase|elaborate on) (the|that|this) question\b/,
  /\b(can|could|would) you (please )?(rephrase|clarify)( it| that)?\b/,
  /\bwhat do you mean\b/,
  /\bwhat (does|is) (the|that|this) question (mean|asking)\b/,
  /\bi (didn'?t|did not|don'?t|do not) understand( the question| that)?\b/,
  /\bnot (sure|clear) what (you|the question) (mean|means|is asking)\b/,
  /\bin other words\b/,
];
const INTENT_MAX_WORDS = 14;
/** The closing Q&A ends by itself after this long without activity. */
const CLOSING_IDLE_MS = 90000;
/** Longest spoken closing question we record. */
const CLOSING_MAX_RECORD_MS = 45000;

function _words(text) {
  return (String(text || "").match(/[A-Za-z0-9']+/g) || []).length;
}

/** "repeat" | "clarify" | null — a SHORT utterance that is plainly a request. */
export function detectTurnIntent(text) {
  const t = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t || _words(t) > INTENT_MAX_WORDS) return null;
  if (CLARIFY_PATTERNS.some((re) => re.test(t))) return "clarify";
  if (REPEAT_PATTERNS.some((re) => re.test(t))) return "repeat";
  return null;
}

/** Settings from the latest /next payload (null = feature off). */
export function conversationSettings() {
  return state.conversation || null;
}

export function applyConversationPayload(data) {
  if (data && typeof data === "object" && data.conversation && typeof data.conversation === "object") {
    state.conversation = data.conversation;
  }
}

/* ------------------------------------------------------------------ UI */

function _ensureStyles() {
  if (document.getElementById("convStyles")) return;
  const css = `
  .cand-conv-leadin{margin:0 0 6px;font-size:.92rem;line-height:1.4;color:#475569;font-style:italic;display:flex;gap:6px;align-items:flex-start}
  .cand-conv-leadin::before{content:"";flex:none;width:6px;height:6px;margin-top:.5em;border-radius:50%;background:#6366f1}
  html.dark .cand-conv-leadin{color:#cbd5e1}
  .cand-conv-tools{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
  .cand-conv-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(99,102,241,.35);background:rgba(99,102,241,.08);color:#4338ca;border-radius:999px;padding:6px 12px;font-size:.8rem;font-weight:600;cursor:pointer}
  .cand-conv-btn:hover:not(:disabled){background:rgba(99,102,241,.16)}
  .cand-conv-btn:disabled{opacity:.45;cursor:not-allowed}
  html.dark .cand-conv-btn{color:#c7d2fe;border-color:rgba(165,180,252,.4);background:rgba(99,102,241,.18)}
  .cand-conv-chip{display:inline-block;margin-left:8px;padding:1px 8px;border-radius:999px;background:#ede9fe;color:#5b21b6;font-size:.7rem;font-weight:700;letter-spacing:.02em;vertical-align:middle}
  .conv-closing{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.55);backdrop-filter:blur(4px);padding:16px}
  .conv-closing-card{width:min(560px,100%);border-radius:18px;background:#fff;color:#0f172a;box-shadow:0 24px 60px rgba(15,23,42,.35);overflow:hidden}
  html.dark .conv-closing-card{background:#0f172a;color:#e2e8f0}
  .conv-closing-hero{padding:18px 20px;background:linear-gradient(120deg,#4f46e5,#7c3aed);color:#fff}
  .conv-closing-hero h3{margin:0;font-size:1.1rem}
  .conv-closing-hero p{margin:4px 0 0;font-size:.85rem;opacity:.9}
  .conv-closing-body{padding:16px 20px;display:flex;flex-direction:column;gap:10px;max-height:52vh;overflow:auto}
  .conv-closing-msg{font-size:.9rem;line-height:1.45;padding:10px 12px;border-radius:12px;background:#f1f5f9}
  html.dark .conv-closing-msg{background:#1e293b}
  .conv-closing-msg.you{background:#eef2ff;align-self:flex-end;max-width:85%}
  html.dark .conv-closing-msg.you{background:#312e81}
  .conv-closing-row{display:flex;gap:8px;padding:12px 20px 18px;flex-wrap:wrap;align-items:center}
  .conv-closing-row input{flex:1;min-width:180px;border:1px solid #cbd5e1;border-radius:10px;padding:9px 12px;font-size:.9rem;background:transparent;color:inherit}
  .conv-btn{border:0;border-radius:10px;padding:9px 14px;font-weight:700;font-size:.85rem;cursor:pointer}
  .conv-btn.primary{background:#4f46e5;color:#fff}
  .conv-btn.rec{background:#dc2626;color:#fff}
  .conv-btn.ghost{background:transparent;color:inherit;border:1px solid #cbd5e1}
  .conv-btn:disabled{opacity:.5;cursor:not-allowed}
  .conv-closing-note{font-size:.75rem;opacity:.7;padding:0 20px 14px}
  `;
  const el = document.createElement("style");
  el.id = "convStyles";
  el.textContent = css;
  document.head.appendChild(el);
}

/** Show (or hide) the lead-in line above the question. */
export function showLeadIn(text) {
  const q = document.getElementById("candidateQuestion");
  if (!q) return;
  let el = document.getElementById("candidateLeadIn");
  const t = String(text || "").trim();
  if (!t) {
    if (el) el.hidden = true;
    return;
  }
  _ensureStyles();
  if (!el) {
    el = document.createElement("div");
    el.id = "candidateLeadIn";
    el.className = "cand-conv-leadin";
    el.setAttribute("aria-live", "polite");
    q.parentNode.insertBefore(el, q);
  }
  el.textContent = t;
  el.hidden = false;
}

/** "Follow-up" chip beside the progress pill. */
export function showFollowupChip(on) {
  const pill = document.getElementById("progressPill");
  if (!pill) return;
  let chip = document.getElementById("candidateFollowupChip");
  if (!on) {
    if (chip) chip.remove();
    return;
  }
  _ensureStyles();
  if (!chip) {
    chip = document.createElement("span");
    chip.id = "candidateFollowupChip";
    chip.className = "cand-conv-chip";
    chip.textContent = "Follow-up";
    pill.insertAdjacentElement("afterend", chip);
  }
}

/**
 * The Repeat / Explain buttons under the question. `onRequest(mode)` is the
 * candidate page's handler (it owns the microphone). Hidden unless the template
 * enabled clarifications.
 */
export function setClarifyTools(visible, onRequest) {
  const q = document.getElementById("candidateQuestion");
  if (!q) return;
  let bar = document.getElementById("candidateConvTools");
  const enabled = !!conversationSettings()?.clarify && visible;
  if (!enabled) {
    if (bar) bar.hidden = true;
    return;
  }
  _ensureStyles();
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "candidateConvTools";
    bar.className = "cand-conv-tools";
    bar.innerHTML =
      '<button type="button" class="cand-conv-btn" data-conv="repeat" title="Hear the question again">&#8635; Repeat question</button>' +
      '<button type="button" class="cand-conv-btn" data-conv="clarify" title="Hear the question in other words">? Explain the question</button>';
    const notice = document.getElementById("candidateVoiceNotice");
    (notice || q).insertAdjacentElement("afterend", bar);
  }
  bar._onRequest = onRequest;
  if (!bar._bound) {
    bar._bound = true;
    bar.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-conv]");
      if (!btn || btn.disabled) return;
      const fn = bar._onRequest;
      if (typeof fn === "function") fn(btn.getAttribute("data-conv"));
    });
  }
  bar.hidden = false;
}

export function setClarifyToolsBusy(busy) {
  const bar = document.getElementById("candidateConvTools");
  if (!bar) return;
  bar.querySelectorAll("button").forEach((b) => { b.disabled = !!busy; });
}

/** POST the request; resolves {text, message, limitReached}. Never throws. */
export async function requestClarify(mode) {
  try {
    const fd = new FormData();
    fd.append("mode", mode === "clarify" ? "clarify" : "repeat");
    const res = await apiFetch("/candidate/conversation/clarify", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { text: "", message: data?.error || "Could not repeat the question just now.", limitReached: false };
    return { text: String(data.text || ""), message: String(data.message || ""), limitReached: !!data.limit_reached };
  } catch (err) {
    return { text: "", message: "Could not repeat the question just now.", limitReached: false };
  }
}

/* ------------------------------------------------------------------ E closing Q&A */

async function _askClosing(question) {
  const fd = new FormData();
  fd.append("question", question);
  const res = await apiFetch("/candidate/conversation/closing", { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return { answer: String(data.answer || ""), remaining: Number(data.remaining ?? 0), limitReached: !!data.limit_reached };
}

async function _micClone(getAudioStream) {
  if (typeof getAudioStream === "function") {
    try {
      const s = await getAudioStream();
      if (s && s.getAudioTracks && s.getAudioTracks().length) return s;
    } catch (_) { /* fall through */ }
  }
  const src = getVerifiedMicStream && getVerifiedMicStream();
  const track = src && src.getAudioTracks ? src.getAudioTracks()[0] : null;
  return track ? new MediaStream([track.clone()]) : null;
}

async function _recordOnce(maxMs, getAudioStream) {
  // Resolves {blob, durationMs} when stop() is called (or after maxMs). The
  // stream is the recorder's own clone; stopping it never touches the interview mic.
  if (!window.MediaRecorder) return null;
  const stream = await _micClone(getAudioStream);
  if (!stream) return null;
  const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
  const chunks = [];
  const started = Date.now();
  let resolveFn;
  const done = new Promise((r) => { resolveFn = r; });
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    try { stream.getTracks().forEach((t) => t.stop()); } catch (_) { /* ignore */ }
    resolveFn({ blob: new Blob(chunks, { type: "audio/webm" }), durationMs: Date.now() - started });
  };
  rec.start(250);
  const timer = setTimeout(() => { try { rec.stop(); } catch (_) { /* ignore */ } }, maxMs);
  return {
    stop() { clearTimeout(timer); try { if (rec.state !== "inactive") rec.stop(); } catch (_) { /* ignore */ } },
    done,
  };
}

/**
 * Run the closing "any questions about the role?" exchange. `speak(text)` is
 * the candidate page's voice (resolves when speech ends). Resolves when the
 * candidate finishes, runs out of questions, or goes idle — never rejects, so
 * the interview always proceeds to submission.
 */
export async function runClosingQa({ speak, getAudioStream } = {}) {
  const cfg = conversationSettings();
  if (!cfg?.closing_qa) return;
  _ensureStyles();
  const say = async (text) => { try { if (text && typeof speak === "function") await speak(text); } catch (_) { /* ignore */ } };
  const overlay = document.createElement("div");
  overlay.className = "conv-closing";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "convClosingTitle");
  overlay.innerHTML = `
    <div class="conv-closing-card">
      <div class="conv-closing-hero">
        <h3 id="convClosingTitle">Any questions about the role?</h3>
        <p>Your answers are complete. You may ask up to ${Number(cfg.max_closing_questions) || 3} questions — this part is not scored.</p>
      </div>
      <div class="conv-closing-body" id="convClosingLog"></div>
      <div class="conv-closing-row">
        <input id="convClosingInput" type="text" maxlength="600" placeholder="Type your question, or tap Speak" aria-label="Your question" />
        <button type="button" class="conv-btn ghost" id="convClosingSpeak">Speak</button>
        <button type="button" class="conv-btn primary" id="convClosingSend">Ask</button>
      </div>
      <div class="conv-closing-row" style="padding-top:0">
        <button type="button" class="conv-btn ghost" id="convClosingDone" style="margin-left:auto">No questions — finish interview</button>
      </div>
      <div class="conv-closing-note">Answers come from the role description. Salary and selection questions go to the recruitment team.</div>
    </div>`;
  document.body.appendChild(overlay);
  const log = overlay.querySelector("#convClosingLog");
  const input = overlay.querySelector("#convClosingInput");
  const btnSpeak = overlay.querySelector("#convClosingSpeak");
  const btnSend = overlay.querySelector("#convClosingSend");
  const btnDone = overlay.querySelector("#convClosingDone");
  const add = (text, who) => {
    const m = document.createElement("div");
    m.className = `conv-closing-msg${who === "you" ? " you" : ""}`;
    m.textContent = text;
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
  };
  let finish;
  const finished = new Promise((r) => { finish = r; });
  let idle = null;
  const armIdle = () => { clearTimeout(idle); idle = setTimeout(() => finish("idle"), CLOSING_IDLE_MS); };
  let busy = false;
  let recording = null;
  const setBusy = (b) => {
    busy = b;
    [btnSend, btnSpeak, btnDone, input].forEach((el) => { el.disabled = b; });
  };
  const ask = async (question) => {
    const q = String(question || "").trim();
    if (!q || busy) return;
    setBusy(true);
    clearTimeout(idle);
    add(q, "you");
    try {
      const { answer, remaining, limitReached } = await _askClosing(q);
      add(answer, "ai");
      await say(answer);
      if (limitReached || remaining <= 0) {
        finish("limit");
        return;
      }
    } catch (err) {
      add(err?.message || "Could not answer just now.", "ai");
    }
    setBusy(false);
    input.value = "";
    armIdle();
  };
  btnSend.addEventListener("click", () => ask(input.value));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ask(input.value); } });
  btnDone.addEventListener("click", () => finish("done"));
  btnSpeak.addEventListener("click", async () => {
    if (recording) {
      const r = recording;
      recording = null;
      btnSpeak.textContent = "Speak";
      btnSpeak.className = "conv-btn ghost";
      r.stop();
      setBusy(true);
      const { blob, durationMs } = await r.done;
      let text = "";
      try {
        text = blob.size > 1200 ? await transcribeAudioBlob(blob, "closing-question.webm", { durationMs }) : "";
      } catch (_) {
        text = "";
      }
      setBusy(false);
      if (text && text.trim()) await ask(text);
      else add("We didn't catch that — please try again or type your question.", "ai");
      return;
    }
    btnSpeak.disabled = true;
    recording = await _recordOnce(CLOSING_MAX_RECORD_MS, getAudioStream);
    btnSpeak.disabled = false;
    if (!recording) {
      add("The microphone is not available — please type your question.", "ai");
      return;
    }
    clearTimeout(idle);
    btnSpeak.textContent = "Stop & send";
    btnSpeak.className = "conv-btn rec";
  });

  add(cfg.closing_prompt || "Before we finish, do you have any questions about the role?", "ai");
  await say(cfg.closing_prompt || "Before we finish, do you have any questions about the role?");
  armIdle();
  const why = await finished;
  clearTimeout(idle);
  if (recording) { try { recording.stop(); } catch (_) { /* ignore */ } }
  setBusy(true);
  if (why !== "idle") await say(cfg.closing_goodbye || "Thank you for your time today.");
  overlay.remove();
}
