/**
 * Reliable interview termination (May 2026).
 *
 * Candidate waits for /submit confirmation before redirecting so report
 * generation is not cancelled by navigation. Keepalive is only a last-resort
 * unload backup.
 */

import { apiFetch, handleJson } from "./core.js";
import { clearAuthSession, getAuthToken } from "./auth/session.js";
import { resolveInviteDeviceId } from "./invite_device.js";

const FINALIZE_RETRY_MS = 1200;
const MAX_FINALIZE_ATTEMPTS = 3;
// The fast-finalize path answers in well under 12 s; a slow network gets one
// longer attempt before we give up (15 Sep 2026 — a single timeout used to
// abort the whole loop).
const FINALIZE_TIMEOUT_MS = 12000;
const FINALIZE_TIMEOUT_RETRY_MS = 30000;

/**
 * POST /submit. The backend preserves compatibility with background_finalize,
 * but now finalizes synchronously and returns only after a report/fallback
 * report is persisted.
 */
export async function postInterviewFinalizeBackground({
  pendingAnswer = "",
  timeExpired = false,
  finalizeVia = "",
  boundaryAutoSaved = false,
} = {}) {
  const fd = new FormData();
  fd.append("background_finalize", "true");
  if (pendingAnswer) fd.append("pending_answer", pendingAnswer);
  if (timeExpired) fd.append("time_expired", "true");
  const via = String(finalizeVia || "").trim().toLowerCase();
  if (via) fd.append("finalize_via", via);
  if (boundaryAutoSaved) fd.append("boundary_auto_saved", "true");

  console.info("[REPORT] Generation Started");
  let lastErr = null;
  let timedOutOnce = false;
  for (let attempt = 1; attempt <= MAX_FINALIZE_ATTEMPTS; attempt++) {
    try {
      const timeoutMs = timedOutOnce ? FINALIZE_TIMEOUT_RETRY_MS : FINALIZE_TIMEOUT_MS;
      const res = await apiFetch("/submit", { method: "POST", body: fd }, { timeoutMs });
      if (res.status === 404 || res.status === 409 || res.status === 410) {
        // Not retryable: no session (already finalized) or already closed.
        const body = await res.json().catch(() => ({}));
        if (body && body.status === "submitted") return body;
        throw Object.assign(new Error(body.error || `Submit refused (${res.status})`), { fatal: true });
      }
      const data = await handleJson(res);
      if (data && data.status === "submitted") {
        console.info("[FLOW] REPORT_COMPLETED", {
          interview_id: data.interview_id,
          report_ready: data.report_ready,
          report_status: data.report_status,
        });
        return data;
      }
      console.info("[REPORT] Generation Completed", { interview_id: data.interview_id });
      return data;
    } catch (e) {
      lastErr = e;
      const timedOut = e && (e.name === "AbortError" || /abort/i.test(String(e.message || "")));
      console.warn("[REPORT] Generation Failed", { attempt, timedOut, message: String(e?.message || e) });
      if (e && e.fatal) throw e;
      if (timedOut) {
        if (timedOutOnce) throw new Error("REPORT_TIMEOUT");
        timedOutOnce = true;
      }
      if (attempt < MAX_FINALIZE_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, FINALIZE_RETRY_MS * attempt));
      }
    }
  }
  throw lastErr || new Error("Interview finalization failed.");
}

/**
 * Fire-and-forget variant used right before page unload (Thank You redirect).
 * Uses keepalive so the browser may complete the request after navigation starts.
 */
export function postInterviewFinalizeKeepalive({
  pendingAnswer = "",
  timeExpired = false,
  finalizeVia = "",
  boundaryAutoSaved = false,
} = {}) {
  const token = getAuthToken();
  const fd = new FormData();
  fd.append("background_finalize", "true");
  if (pendingAnswer) fd.append("pending_answer", pendingAnswer);
  if (timeExpired) fd.append("time_expired", "true");
  const via = String(finalizeVia || "").trim().toLowerCase();
  if (via) fd.append("finalize_via", via);
  if (boundaryAutoSaved) fd.append("boundary_auto_saved", "true");

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const deviceId = resolveInviteDeviceId();
  if (deviceId) headers["x-device-id"] = deviceId;

  try {
    return fetch("/submit", {
      method: "POST",
      body: fd,
      headers,
      credentials: "same-origin",
      keepalive: true,
    });
  } catch (err) {
    return Promise.reject(err);
  }
}

export function clearCandidateSessionAfterExit() {
  try {
    clearAuthSession();
  } catch (_) {
    /* ignore */
  }
}
