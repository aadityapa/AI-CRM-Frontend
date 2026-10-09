/**
 * Which OpenAI model runs the interviews (9 Oct 2026) — for the HR setup
 * screen's labels. The name comes from the SERVER (`GET /interview/ai-engine`,
 * staff only), so a switch in Settings ▸ AI engine changes every label at once.
 * Fetched once per page load; any failure leaves the existing text in place.
 */
import { apiFetch, handleJson } from "./core.js";

let _enginePromise = null;

/** The engine payload, or null (not signed in as staff, offline, older server). */
export function loadAiEngine() {
  if (!_enginePromise) {
    _enginePromise = apiFetch("/interview/ai-engine", { method: "GET" })
      .then((res) => (res.ok ? handleJson(res) : null))
      .catch(() => null)
      .then((data) => {
        if (!data || !data.interview) _enginePromise = null; // retry on the next call
        return data && data.interview ? data : null;
      });
  }
  return _enginePromise;
}

/** "GPT-6 Astra" — the interview model's label, or "" when unknown. */
export async function interviewModelLabel() {
  const engine = await loadAiEngine();
  return String(engine?.interview?.label || "").trim();
}

/**
 * Write the model into the HR setup labels:
 *   #kxAiProviderLabel  "AI interviewer: OpenAI GPT-6 Astra" (else "AI interviewer: OpenAI")
 *   .kx-brand-powered   "Powered by OpenAI GPT-6 Astra" (else unchanged)
 */
export async function applyAiEngineLabels() {
  const provider = document.getElementById("kxAiProviderLabel");
  const label = await interviewModelLabel();
  if (provider) provider.textContent = label ? `AI interviewer: OpenAI ${label}` : "AI interviewer: OpenAI";
  if (label) {
    document.querySelectorAll(".kx-brand-powered").forEach((el) => {
      el.textContent = `Powered by OpenAI ${label}`;
    });
  }
  return label;
}
