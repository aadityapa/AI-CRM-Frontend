import { clearAuthSession, getAuthToken } from "../lib/authSession";

type CacheEntry<T> = { ts: number; value: T };
const _inflight = new Map<string, Promise<unknown>>();
const _cache = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL_MS = 15_000;
/** Slightly longer TTL for static template list (invalidated on mutations via invalidateApiCache). */
const CONFIGS_TTL_MS = 45_000;

const CACHEABLE_PATTERNS = [
  /^\/hr\/dashboard(\?|$)/,
  /^\/job\/configs(\?|$)/,
  /^\/hr\/schedules(\?|$)/,
  /^\/interview\/integrity-logs(\?|$)/,
];

function shouldCache(path: string): boolean {
  return CACHEABLE_PATTERNS.some((re) => re.test(path));
}

export function invalidateApiCache(prefix?: string): void {
  if (!prefix) {
    _cache.clear();
    _inflight.clear();
    return;
  }
  for (const key of Array.from(_cache.keys())) {
    if (key.startsWith(prefix)) _cache.delete(key);
  }
  for (const key of Array.from(_inflight.keys())) {
    if (key.startsWith(prefix)) _inflight.delete(key);
  }
}

/** Authenticated fetch; clears storage and reloads on 401 when a token was sent. */
export async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init?.headers || undefined);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401 && token) {
    clearAuthSession();
    invalidateApiCache();
    window.setTimeout(() => window.location.reload(), 0);
  }
  return res;
}

async function _rawGet<T>(path: string): Promise<T> {
  const res = await authFetch(path, { method: "GET" });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = text;
  }
  if (!res.ok) {
    throw new Error(typeof data === "string" ? data : data?.error || `Request failed (${res.status})`);
  }
  if (data && typeof data === "object" && data.error) throw new Error(String(data.error));
  return data as T;
}

export async function apiGet<T>(path: string, opts: { force?: boolean; ttlMs?: number } = {}): Promise<T> {
  const ttl =
    opts.ttlMs ??
    (/^\/job\/configs(\?|$)/.test(path)
      ? CONFIGS_TTL_MS
      : /^\/interview\/integrity-logs(\?|$)/.test(path)
        ? 20_000
        : DEFAULT_TTL_MS);
  if (!opts.force && shouldCache(path)) {
    const cached = _cache.get(path) as CacheEntry<T> | undefined;
    if (cached && Date.now() - cached.ts < ttl) {
      return cached.value;
    }
    const inflight = _inflight.get(path) as Promise<T> | undefined;
    if (inflight) return inflight;
    const promise = _rawGet<T>(path)
      .then((v) => {
        _cache.set(path, { ts: Date.now(), value: v as unknown });
        return v;
      })
      .finally(() => {
        _inflight.delete(path);
      });
    _inflight.set(path, promise as Promise<unknown>);
    return promise;
  }
  return _rawGet<T>(path);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await authFetch(path, { method: "DELETE" });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = text;
  }
  if (!res.ok) {
    throw new Error(typeof data === "string" ? data : data?.error || `Request failed (${res.status})`);
  }
  if (data && typeof data === "object" && data.error) throw new Error(String(data.error));
  invalidateApiCache("/hr/dashboard");
  invalidateApiCache("/job/configs");
  invalidateApiCache("/hr/schedules");
  invalidateApiCache("/interview/integrity-logs");
  return data as T;
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await authFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = text;
  }
  if (!res.ok) {
    throw new Error(typeof data === "string" ? data : data?.error || `Request failed (${res.status})`);
  }
  if (data && typeof data === "object" && data.error) throw new Error(String(data.error));
  invalidateApiCache("/hr/dashboard");
  return data as T;
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await authFetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = text;
  }
  if (!res.ok) {
    throw new Error(typeof data === "string" ? data : data?.error || `Request failed (${res.status})`);
  }
  if (data && typeof data === "object" && data.error) throw new Error(String(data.error));
  invalidateApiCache("/hr/dashboard");
  return data as T;
}
