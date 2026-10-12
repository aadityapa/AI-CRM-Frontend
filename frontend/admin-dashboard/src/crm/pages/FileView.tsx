/**
 * A CRM file opened in its own browser tab (10 Oct 2026).
 *
 * Files under `/api/crm-files/…` need the bearer token, so a plain
 * `<a href target="_blank">` to them answers 401 — that was the interviewer's
 * "Open" button on My Interviews. Links go to `?p=file-view&file=<path>&name=`
 * instead; this page fetches the file through `FilePreviewPane` (authFetch) and
 * shows it full height. Only same-origin `/api/crm-files/` paths are accepted —
 * the param can never point the page at another site.
 */
import { FileText } from "lucide-react";
import { FilePreviewPane } from "../components/FileUpload";
import { crmUrl } from "../routerHooks";

/** The link that opens a CRM file in a new tab, or null for anything else. PURE. */
export function fileViewHref(url: string | null | undefined, name?: string | null): string | null {
  const path = safeFilePath(url);
  if (!path) return null;
  const q = new URLSearchParams({ file: path });
  if (name) q.set("name", name);
  return crmUrl(`file-view?${q.toString()}`);
}

/** Accept only a same-origin CRM file path. PURE. */
export function safeFilePath(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, window.location.origin);
    if (u.origin !== window.location.origin) return null;
    if (!u.pathname.startsWith("/api/crm-files/")) return null;
    return `${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

export function FileViewPage() {
  const params = new URLSearchParams(window.location.search);
  const path = safeFilePath(params.get("file"));
  const name = (params.get("name") || "").slice(0, 120) || "File";
  if (!path) {
    return (
      <div className="rounded-card border border-subtle bg-surface-1 p-6 text-sm text-secondary">
        This link does not point to a file in Karnex Orbit.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <h1 className="flex items-center gap-2 text-lg font-bold text-primary">
        <FileText size={18} aria-hidden /> {name}
      </h1>
      <div className="rounded-card border border-subtle bg-surface-1 p-3 shadow-raised">
        <FilePreviewPane url={path} title={name} />
      </div>
    </div>
  );
}

export default FileViewPage;
