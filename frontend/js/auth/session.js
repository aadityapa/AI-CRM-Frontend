/**
 * HR / candidate API bearer token + profile.
 *
 * Two scopes (18 Nov 2026):
 *  - STAFF (no `?invite=` in the address): localStorage, shared with the
 *    same-origin /admin dashboard — an HR login on `/` carries into /admin.
 *  - INVITE (the candidate's interview link): sessionStorage under its own
 *    `kxInvite.` keys — this tab only.
 *
 * ⚠️ Why the split: both apps used ONE set of localStorage keys. With the
 * candidate's interview and a recruiter's dashboard open in the same browser
 * (every local test, and any TA who tries the link), the candidate's sign-in
 * overwrote the recruiter's token; the dashboard's next call answered 401,
 * the dashboard cleared the keys, and the candidate page's "storage" listener
 * reloaded the page — the interview closed and the candidate had to open the
 * link again. A TA logging back in overwrote the candidate's token the other
 * way. An interview tab now never reads or writes the staff session.
 */

export const AUTH_USER_KEY = "authUser";
export const AUTH_TOKEN_KEY = "authToken";
export const AUTH_EXPIRY_KEY = "authTokenExpiryIst";
export const INVITE_KEY_PREFIX = "kxInvite.";

const AUTH_KEYS = [AUTH_USER_KEY, AUTH_TOKEN_KEY, AUTH_EXPIRY_KEY];

/** True on a candidate interview link (`?invite=…`) — this tab's own session. */
export function isInviteAuthScope() {
  try {
    return new URLSearchParams(window.location.search || "").has("invite");
  } catch (_) {
    return false;
  }
}

function _store() {
  return isInviteAuthScope() ? window.sessionStorage : window.localStorage;
}

function _key(name) {
  return isInviteAuthScope() ? `${INVITE_KEY_PREFIX}${name}` : name;
}

function _get(name) {
  try {
    return _store().getItem(_key(name)) || "";
  } catch (_) {
    return "";
  }
}

export function getAuthToken() {
  return _get(AUTH_TOKEN_KEY);
}

export function getAuthUserRaw() {
  return _get(AUTH_USER_KEY);
}

/** Best-effort JWT exp check (no signature verification; server still validates). */
export function isAccessTokenExpired(leewaySec = 45) {
  const raw = getAuthToken();
  if (!raw) return true;
  const parts = raw.split(".");
  if (parts.length < 2) return false;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const json = JSON.parse(atob(b64 + pad));
    const exp = Number(json.exp);
    if (!Number.isFinite(exp)) return false;
    return Math.floor(Date.now() / 1000) >= exp - leewaySec;
  } catch (_) {
    return false;
  }
}

export function saveAuthSession(user, token, expiresAtIst) {
  try {
    const store = _store();
    if (user) store.setItem(_key(AUTH_USER_KEY), JSON.stringify(user));
    if (token) store.setItem(_key(AUTH_TOKEN_KEY), token);
    if (expiresAtIst) store.setItem(_key(AUTH_EXPIRY_KEY), expiresAtIst);
  } catch (_) {
    /* ignore quota */
  }
}

/** Clears THIS scope only — an interview tab never signs the recruiter out. */
export function clearAuthSession() {
  try {
    if (isInviteAuthScope()) {
      for (const k of AUTH_KEYS) window.sessionStorage.removeItem(`${INVITE_KEY_PREFIX}${k}`);
      return;
    }
    for (const k of AUTH_KEYS) {
      window.localStorage.removeItem(k);
      window.sessionStorage.removeItem(k);
    }
  } catch (_) {
    /* ignore */
  }
}
