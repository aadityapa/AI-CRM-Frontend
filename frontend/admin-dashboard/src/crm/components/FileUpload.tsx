/** File upload button with progress indicator + authenticated in-page file preview. */
import React, { useEffect, useRef, useState } from "react";
import { Download, FileText, Upload } from "lucide-react";
import { authFetch } from "../../api/client";
import { crmUpload } from "../api";
import { Modal, btnSecondary } from "./ui";
import { sanitizeHtml } from "../lib/sanitizeHtml";

export function FileUploadButton({
  path,
  fields = {},
  label = "Upload file",
  accept,
  onDone,
  onError,
}: {
  path: string;
  fields?: Record<string, string>;
  label?: string;
  accept?: string;
  onDone: (data: any) => void;
  onError?: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);

  const pick = () => input.current?.click();
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPct(0);
    try {
      const res = await crmUpload(path, file, fields, setPct);
      onDone(res.data);
    } catch (err: any) {
      onError?.(err?.message || "Upload failed");
    } finally {
      setPct(null);
    }
  };

  return (
    <>
      <input ref={input} type="file" accept={accept} className="hidden" onChange={onFile} />
      <button type="button" className={btnSecondary} onClick={pick} disabled={pct !== null}>
        <Upload size={15} /> {pct !== null ? `Uploading ${pct}%` : label}
      </button>
      {pct !== null && (
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </>
  );
}

/** Resolve a CRM file URL to a same-origin path for authFetch. */
function toAuthPath(url: string): string | null {
  try {
    if (url.startsWith("/")) return url;
    const u = new URL(url, window.location.origin);
    if (u.origin === window.location.origin) return `${u.pathname}${u.search}`;
    return null;
  } catch {
    return url.startsWith("/") ? url : null;
  }
}

function extOf(url: string, label: string): string {
  const fromUrl = (url.split("?")[0].split("#")[0].split(".").pop() || "").toLowerCase();
  if (fromUrl && fromUrl.length <= 5 && /^[a-z0-9]+$/i.test(fromUrl)) return fromUrl;
  const fromLabel = label.includes(".") ? (label.split(".").pop() || "").toLowerCase() : "";
  return fromLabel;
}

function mimeForExt(ext: string): string {
  switch (ext) {
    case "pdf": return "application/pdf";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "txt": return "text/plain";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "doc": return "application/msword";
    default: return "application/octet-stream";
  }
}

function typedBlob(blob: Blob, ext: string): Blob {
  const want = mimeForExt(ext);
  const cur = (blob.type || "").toLowerCase();
  if (cur && cur !== "application/octet-stream" && cur !== "binary/octet-stream") return blob;
  return new Blob([blob], { type: want });
}

function sniffExtFromBytes(buf: ArrayBuffer): string | null {
  const bytes = new Uint8Array(buf.slice(0, 8));
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "docx";
  return null;
}

/** Render PDF pages to canvas via pdf.js (avoids Chrome broken blob PDF viewer). */
async function renderPdfToContainer(
  data: ArrayBuffer,
  container: HTMLDivElement,
  signal: { cancelled: boolean },
): Promise<void> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  if (signal.cancelled) return;

  container.replaceChildren();
  const maxPages = Math.min(pdf.numPages, 30);
  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    if (signal.cancelled) return;
    const page = await pdf.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1.4, Math.max(0.9, (container.clientWidth || 720) / base.width));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.className = "mb-3 w-full rounded border border-subtle bg-surface-1 shadow-sm";
    canvas.style.height = "auto";
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport }).promise;
    if (signal.cancelled) return;
    container.appendChild(canvas);
  }
  if (pdf.numPages > maxPages) {
    const note = document.createElement("p");
    note.className = "pb-2 text-center text-xs text-muted";
    note.textContent = `Showing first ${maxPages} of ${pdf.numPages} pages — use Download for the full file.`;
    container.appendChild(note);
  }
}

function FilePreviewModal({
  url,
  title,
  onClose,
}: {
  url: string;
  title: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [kind, setKind] = useState<"pdf" | "image" | "html" | "text" | "other">("other");
  const [ready, setReady] = useState(false);
  const [pdfPainting, setPdfPainting] = useState(false);
  const [fileExt, setFileExt] = useState(() => extOf(url, title));
  const blobRef = useRef<Blob | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const pdfHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const signal = { cancelled: false };

    (async () => {
      setLoading(true);
      setError("");
      setHtml(null);
      setText(null);
      setBlobUrl(null);
      setReady(false);
      setPdfPainting(false);
      setKind("other");
      try {
        const path = toAuthPath(url);
        let blob: Blob;
        if (path) {
          const res = await authFetch(path);
          if (!res.ok) {
            let detail = `Failed to load file (${res.status})`;
            try {
              const body = await res.json();
              if (body?.detail) detail = String(body.detail);
            } catch { /* ignore */ }
            throw new Error(detail);
          }
          blob = await res.blob();
        } else {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
          blob = await res.blob();
        }
        if (cancelled) return;

        const bytes = await blob.arrayBuffer();
        if (cancelled) return;
        const sniffed = sniffExtFromBytes(bytes);
        let ext = extOf(url, title);
        if (sniffed === "pdf" || ext === "pdf") ext = "pdf";
        else if (sniffed && (!ext || ext === "bin")) ext = sniffed;
        else if (!ext && sniffed) ext = sniffed;

        const typed = typedBlob(new Blob([bytes]), ext || sniffed || "bin");
        blobRef.current = typed;
        setFileExt(ext || sniffed || "");
        setReady(true);

        if (ext === "pdf") {
          setKind("pdf");
          setPdfPainting(true);
          setLoading(false);
          // Allow React to paint the PDF host before rendering into it.
          await new Promise((r) => setTimeout(r, 0));
          const host = pdfHostRef.current;
          if (!host || cancelled) return;
          try {
            await renderPdfToContainer(bytes, host, signal);
          } catch (e: any) {
            if (!cancelled) setError(e?.message || "Could not render PDF preview");
          } finally {
            if (!cancelled) setPdfPainting(false);
          }
          return;
        }

        if (ext === "docx" || (sniffed === "docx" && ext !== "pdf")) {
          const mammoth = await import("mammoth");
          const result = await mammoth.convertToHtml({ arrayBuffer: bytes });
          if (cancelled) return;
          // Candidate CVs arrive via the public apply form: never render mammoth
          // output unsanitised (a crafted .docx can carry a javascript: link).
          setHtml(sanitizeHtml(result.value) || "<p>(Empty document)</p>");
          setKind("html");
        } else if (ext === "txt" || typed.type.startsWith("text/")) {
          const t = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          if (cancelled) return;
          setText(t);
          setKind("text");
        } else if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext) || typed.type.startsWith("image/")) {
          const objectUrl = URL.createObjectURL(typed);
          objectUrlRef.current = objectUrl;
          if (cancelled) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          setBlobUrl(objectUrl);
          setKind("image");
        } else {
          setKind("other");
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Could not open file");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      signal.cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [url, title]);

  const download = () => {
    const blob = blobRef.current;
    if (!blob) return;
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    const name = title.includes(".") ? title : `${title || "file"}.${fileExt || "bin"}`;
    a.download = name;
    a.click();
    URL.revokeObjectURL(href);
  };

  return (
    <Modal title={title} onClose={onClose} medium>
      <div className="space-y-3">
        <div className="flex justify-end">
          <button type="button" className={btnSecondary} onClick={download} disabled={!ready || loading}>
            <Download size={14} /> Download
          </button>
        </div>
        {loading && <p className="py-10 text-center text-sm text-muted">Loading file…</p>}
        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </p>
        )}
        {kind === "pdf" && !error && pdfPainting && (
          <p className="text-center text-sm text-muted">Rendering resume…</p>
        )}
        <div
          ref={pdfHostRef}
          className={
            kind === "pdf" && !error
              ? "max-h-[65vh] min-h-[200px] overflow-y-auto rounded-lg bg-surface-2 p-2"
              : "hidden"
          }
        />
        {!loading && !error && kind === "html" && html && (
          <div
            className="prose prose-sm max-w-none dark:prose-invert rounded-lg border border-subtle bg-surface-1 p-4 text-primary [&_p]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-subtle [&_td]:p-1.5 [&_th]:border [&_th]:border-subtle [&_th]:p-1.5"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
        {!loading && !error && kind === "text" && text != null && (
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-subtle bg-surface-2 p-3 text-sm text-primary">
            {text}
          </pre>
        )}
        {!loading && !error && kind === "image" && blobUrl && (
          <img src={blobUrl} alt={title} className="mx-auto max-h-[65vh] max-w-full rounded-lg object-contain" />
        )}
        {!loading && !error && kind === "other" && (
          <p className="py-6 text-center text-sm text-muted">
            Preview is not available for this file type{fileExt ? ` (.${fileExt})` : ""}. Use Download to open it locally.
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Opens CRM files in an authenticated medium modal (same tab). External URLs open in a new tab. */
export function FileLink({ url, label = "View file" }: { url?: string | null; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!url) return <span className="text-xs text-muted">—</span>;

  const authPath = toAuthPath(url);
  const isCrmFile = !!authPath && authPath.includes("/api/crm-files/");

  if (!isCrmFile && !authPath) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-sm font-semibold text-sky-600 hover:underline dark:text-sky-400"
        onClick={(e) => e.stopPropagation()}
      >
        <FileText size={14} /> {label}
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-sm font-semibold text-sky-600 hover:underline dark:text-sky-400"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
      >
        <FileText size={14} /> {label}
      </button>
      {open && <FilePreviewModal url={authPath || url} title={label} onClose={() => setOpen(false)} />}
    </>
  );
}
