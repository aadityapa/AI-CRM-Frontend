const AUTH_KEYS = ["authUser", "authToken", "authTokenExpiryIst"] as const;

export function getAuthToken(): string {
  try {
    return window.localStorage.getItem("authToken") || "";
  } catch {
    return "";
  }
}

export function getStoredAuthUser(): Record<string, unknown> | null {
  try {
    const raw = window.localStorage.getItem("authUser");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function clearAuthSession(): void {
  try {
    for (const k of AUTH_KEYS) {
      window.localStorage.removeItem(k);
      window.sessionStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

/** Epoch seconds when the current token expires, or null if unknown. */
export function getTokenExpiryEpochSec(): number | null {
  const raw = getAuthToken();
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const json = JSON.parse(atob(b64 + pad)) as { exp?: number };
    const exp = Number(json.exp);
    return Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

/** Swap the current (still-valid) token for a fresh one via POST /auth/refresh.
 * Returns true on success; false leaves the session exactly as it was. */
export async function refreshAuthToken(): Promise<boolean> {
  const token = getAuthToken();
  if (!token) return false;
  try {
    const res = await fetch("/auth/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { access_token?: string; expires_at_ist?: string };
    if (!data?.access_token) return false;
    window.localStorage.setItem("authToken", data.access_token);
    if (data.expires_at_ist) {
      window.localStorage.setItem("authTokenExpiryIst", String(data.expires_at_ist));
    }
    return true;
  } catch {
    return false;
  }
}

export function isAccessTokenExpired(leewaySec = 45): boolean {
  const raw = getAuthToken();
  if (!raw) return true;
  const parts = raw.split(".");
  if (parts.length < 2) return false;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const json = JSON.parse(atob(b64 + pad)) as { exp?: number };
    const exp = Number(json.exp);
    if (!Number.isFinite(exp)) return false;
    return Math.floor(Date.now() / 1000) >= exp - leewaySec;
  } catch {
    return false;
  }
}
