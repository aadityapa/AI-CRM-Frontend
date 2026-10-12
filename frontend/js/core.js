import { clearAuthSession, getAuthToken } from "./auth/session.js";
import { resolveInviteDeviceId } from "./invite_device.js";

const API = "";

/**
 * What the candidate is told when the server (or the gateway in front of it)
 * answers with something that is not our JSON — an nginx 502 page, a proxy
 * timeout, a captive portal. Never "Unexpected token '<'" (11 Oct 2026).
 */
export function friendlyHttpMessage(status) {
  const s = Number(status) || 0;
  if (s === 0) return "We could not reach the interview server. Please check your internet connection and try again.";
  if (s === 408 || s === 504) return "The interview server is taking too long to respond. Please wait a moment and try again.";
  if (s === 429) return "Too many requests in a short time. Please wait a few seconds and try again.";
  if (s === 502 || s === 503) return "The interview server is restarting or busy. Please wait a moment and try again — your answers so far are saved.";
  if (s >= 500) return "The interview server had a problem. Please try again in a moment — your answers so far are saved.";
  if (s === 404) return "This page or interview could not be found.";
  if (s === 401 || s === 403) return "Your session has ended or you are not allowed to do that. Please open your interview link again.";
  return `Something went wrong (status ${s}). Please try again.`;
}

/**
 * Read a response body as JSON without ever throwing a parse error. Returns
 * `{ data, isJson }` — `data` is the parsed object, or `null` for an HTML /
 * empty / truncated body.
 */
export async function readJsonSafe(res) {
  let text = "";
  try {
    text = await res.text();
  } catch (_) {
    return { data: null, isJson: false };
  }
  if (!text) return { data: null, isJson: false };
  try {
    return { data: JSON.parse(text), isJson: true };
  } catch (_) {
    return { data: null, isJson: false };
  }
}

function _httpError(message, status, code) {
  const err = new Error(message);
  err.status = Number(status) || 0;
  if (code) err.code = code;
  return err;
}

export async function handleJson(res) {
  const { data, isJson } = await readJsonSafe(res);
  if (!isJson || !data || typeof data !== "object") {
    throw _httpError(res.ok ? friendlyHttpMessage(502) : friendlyHttpMessage(res.status), res.status, "bad_response");
  }
  if (!res.ok || data.error) {
    throw _httpError(data.error || data.detail || friendlyHttpMessage(res.status), res.status, data.code);
  }
  return data;
}

export async function handleJsonOrText(res) {
  const { data, isJson } = await readJsonSafe(res.clone ? res.clone() : res);
  if (!res.ok) {
    const msg = (isJson && data && (data.error || data.detail)) || friendlyHttpMessage(res.status);
    throw _httpError(typeof msg === "string" ? msg : friendlyHttpMessage(res.status), res.status, isJson && data ? data.code : "");
  }
  if (isJson) {
    if (data && data.error) throw _httpError(data.error, res.status, data.code);
    return data;
  }
  try {
    return await res.text();
  } catch (_) {
    return "";
  }
}

export async function apiFetch(path, init, options = {}) {
  const token = getAuthToken();
  const headers = new Headers((init && init.headers) || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("x-device-id")) {
    const deviceId = resolveInviteDeviceId();
    if (deviceId) headers.set("x-device-id", deviceId);
  }
  const timeoutMs = Number(options.timeoutMs) || 0;
  let signal = init && init.signal;
  let timer = null;
  if (timeoutMs > 0) {
    const controller = new AbortController();
    if (signal) {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    timer = setTimeout(() => controller.abort(), timeoutMs);
    signal = controller.signal;
  }
  let res;
  try {
    res = await fetch(`${API}${path}`, { ...(init || {}), headers, signal });
  } catch (err) {
    // "Failed to fetch" / "NetworkError…" → a sentence the candidate understands.
    if (err && err.name === "TypeError") {
      const friendly = new Error(friendlyHttpMessage(0));
      friendly.status = 0;
      friendly.code = "network";
      friendly.cause = err;
      throw friendly;
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status === 401) {
    const had = !!token;
    clearAuthSession();
    if (had) {
      try {
        window.dispatchEvent(new CustomEvent("kx-auth-lost"));
      } catch (_) {
        /* ignore */
      }
    }
  }
  return res;
}

export async function assertBackendOnline() {
  try {
    await apiFetch("/session-status", { method: "GET" });
  } catch (_) {
    throw new Error("Cannot reach backend API. Start backend using start_app.bat (or start_app.bat --http).");
  }
}

export function setAiState(text) {
  const el = document.getElementById("aiState");
  if (el) el.innerText = text;
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * The parsed JSON body, or — when the server/gateway sent HTML or nothing —
 * `{ error: <friendly message>, code: "bad_response" }`. Callers that already
 * branch on `data.error` keep working and the candidate reads a sentence,
 * never "Unexpected token '<'" (11 Oct 2026).
 */
export async function jsonOrError(res) {
  const { data, isJson } = await readJsonSafe(res);
  if (isJson && data && typeof data === "object") return data;
  return { error: friendlyHttpMessage(res && res.ok ? 502 : res && res.status), code: "bad_response" };
}
