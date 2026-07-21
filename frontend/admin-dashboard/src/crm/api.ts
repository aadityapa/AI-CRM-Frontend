/** CRM API client — wraps the app's authFetch and unwraps the CRM envelope
 * {success, data, message, errors, meta}. Throws Error(message) on failure. */
import { authFetch } from "../api/client";

export type Meta = { page: number; limit: number; total: number; pages: number };

export class CrmApiError extends Error {
  status: number;
  errors: unknown[];
  constructor(message: string, status: number, errors: unknown[] = []) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

/** Turn FastAPI/CRM error bodies into a single human-readable string. */
function formatApiError(body: unknown, status: number): string {
  if (typeof body === "string" && body.trim()) return body;
  if (!body || typeof body !== "object") return `Request failed (${status})`;
  const b = body as Record<string, unknown>;
  if (typeof b.message === "string" && b.message.trim()) return b.message;
  const detail = b.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((item) => {
      if (!item || typeof item !== "object") return String(item);
      const row = item as { loc?: unknown[]; msg?: string };
      const loc = Array.isArray(row.loc)
        ? row.loc.filter((p) => p !== "body").join(".")
        : "";
      const msg = row.msg || "Invalid value";
      return loc ? `${loc}: ${msg}` : msg;
    });
    if (parts.length) return parts.join("; ");
  }
  return `Request failed (${status})`;
}

async function request<T = any>(path: string, init?: RequestInit): Promise<{ data: T; meta?: Meta; message: string }> {
  const res = await authFetch(path, init);
  let body: any = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok || (body && typeof body === "object" && body.success === false)) {
    const msg = formatApiError(body, res.status);
    throw new CrmApiError(msg, res.status, body?.errors || (Array.isArray(body?.detail) ? body.detail : []));
  }
  if (body && typeof body === "object" && "data" in body) {
    return { data: body.data as T, meta: body.meta as Meta | undefined, message: body.message || "" };
  }
  return { data: body as T, meta: undefined, message: "" };
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const crmGet = <T = any>(path: string) => request<T>(path, { method: "GET" });
export const crmPost = <T = any>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
export const crmPut = <T = any>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
export const crmPatch = <T = any>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
export const crmDelete = <T = any>(path: string) => request<T>(path, { method: "DELETE" });

/** Multipart upload (file + extra form fields). Progress callback optional (XHR-based). */
export function crmUpload<T = any>(
  path: string,
  file: File,
  fields: Record<string, string> = {},
  onProgress?: (pct: number) => void,
): Promise<{ data: T; message: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    Object.entries(fields).forEach(([k, v]) => form.append(k, v));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    const token = localStorage.getItem("authToken") || "";
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = xhr.responseText;
      }
      if (xhr.status >= 200 && xhr.status < 300 && body?.success !== false) {
        resolve({ data: body?.data as T, message: body?.message || "" });
      } else {
        reject(new CrmApiError(String(body?.detail || body?.message || `Upload failed (${xhr.status})`), xhr.status));
      }
    };
    xhr.onerror = () => reject(new CrmApiError("Network error during upload", 0));
    xhr.send(form);
  });
}
