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
 * The interview page no longer prints the model name (12 Oct 2026, user
 * decision): #kxAiProviderLabel stays "AI interviewer: OpenAI" and
 * .kx-brand-powered keeps its static text. The label is still returned for
 * callers that log it; the dashboard (Settings ▸ AI engine, reports, AI Costs)
 * keeps showing the model to staff.
 */
export async function applyAiEngineLabels() {
  const provider = document.getElementById("kxAiProviderLabel");
  if (provider) provider.textContent = "AI interviewer: OpenAI";
  return interviewModelLabel();
}
