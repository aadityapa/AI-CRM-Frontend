/**
 * Employee ▸ Joining Documents — HR only (26 Nov 2026).
 *
 * User ask: a tab after Project History, seen only by HR, listing the papers a
 * joiner hands over (last company letters, salary slips, degrees, Aadhaar,
 * PAN, photograph …) in groups; Admin adds to the list and it shows on every
 * employee. Server: `services/joining_documents.py` (HR + Admin / CEO; Admin /
 * CEO keep the list). Files are never served by /api/crm-files — they open
 * through `/api/joining-document-files/{employee}/{name}`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, Ban, Briefcase, CheckCircle2, CircleDashed, Download, Eye, EyeOff, FileText,
  FolderCog, GraduationCap, IdCard, Plus, RotateCcw, ShieldCheck, Trash2, Upload, X,
} from "lucide-react";
import { authFetch } from "../../../api/client";
import { crmDelete, crmGet, crmPost, crmPut } from "../../api";
import { FilePreviewPane } from "../FileUpload";
import { ConfirmModal, ErrorBox, Modal, Spinner, btnPrimary, btnSecondary, focusRing, inputCls } from "../ui";
import { DialogHero } from "../dialogKit";

export type DocState = "missing" | "received" | "verified" | "not_applicable";
export type DocFile = { name: string; original: string; size: number; uploaded_by_name: string | null; uploaded_at: string; url: string };
export type DocItem = {
  type_id: number; group: string; name: string; description: string | null; required: boolean;
  hidden_from_list: boolean; state: DocState; files: DocFile[]; note: string | null;
  checked_by_name: string | null; checked_at: string | null; updated_at: string | null;
};
export type DocSummary = {
  total: number; required: number; required_done: number; received: number; verified: number;
  not_applicable: number; missing_required: string[]; percent: number;
};
export type Checklist = { employee_id: number; groups: { name: string; items: DocItem[] }[]; summary: DocSummary; can_manage: boolean; max_files: number };
export type DocType = { id: number; group: string; name: string; description: string | null; required: boolean; sort_order: number; is_active: boolean; employees_with_files: number };

export type DocFilter = "all" | "todo" | "received" | "verified";

export const STATE_LOOK: Record<DocState, { label: string; chip: string; icon: typeof CheckCircle2; ring: string }> = {
  missing: { label: "Not received", chip: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800", icon: CircleDashed, ring: "text-amber-500" },
  received: { label: "Received — to verify", chip: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-800", icon: FileText, ring: "text-sky-500" },
  verified: { label: "Verified", chip: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800", icon: ShieldCheck, ring: "text-emerald-500" },
  not_applicable: { label: "Not needed", chip: "bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600", icon: Ban, ring: "text-slate-400" },
};

/** Which items a filter pill keeps. PURE. */
export function docFilter(items: DocItem[], f: DocFilter): DocItem[] {
  if (f === "todo") return items.filter((i) => i.state === "missing" && i.required);
  if (f === "received") return items.filter((i) => i.state === "received");
  if (f === "verified") return items.filter((i) => i.state === "verified" || i.state === "not_applicable");
  return items;
}

/** "248 KB", "1.2 MB". PURE. */
export function fileSize(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** An icon per group name (unknown groups get a file). PURE. */
export function groupIcon(name: string) {
  const n = name.toLowerCase();
  if (/employ|company|experience|salary/.test(n)) return Briefcase;
  if (/educat|degree|school|certif/.test(n)) return GraduationCap;
  if (/ident|kyc|aadhaar|pan/.test(n)) return IdCard;
  return FileText;
}

const GROUP_GRAD = ["from-indigo-500 to-purple-600", "from-sky-500 to-blue-600", "from-teal-500 to-emerald-600", "from-amber-500 to-orange-600", "from-rose-500 to-pink-600"];
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx";

function when(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

async function uploadFiles(employeeId: number, typeId: number, files: File[]): Promise<{ data: Checklist; message: string }> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const res = await authFetch(`/api/employees/${employeeId}/joining-documents/${typeId}/files`, { method: "POST", body: form });
  let body: any = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || body?.success === false) throw new Error(body?.detail || body?.message || `Upload failed (${res.status})`);
  return { data: body.data, message: body.message || "Uploaded" };
}

async function downloadFile(f: DocFile) {
  const res = await authFetch(f.url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = href; a.download = f.original || f.name;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 2000);
}

/* ------------------------------------------------------------------ the tab */

export function JoiningDocumentsTab({ employeeId, employeeName, showToast }: {
  employeeId: number;
  employeeName: string;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const [data, setData] = useState<Checklist | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<DocFilter>("all");
  const [manage, setManage] = useState(false);
  const [preview, setPreview] = useState<DocFile | null>(null);

  const load = useCallback(() => {
    crmGet<Checklist>(`/api/employees/${employeeId}/joining-documents`)
      .then((r) => { setData(r.data); setError(""); })
      .catch((e) => setError(e?.message || "Could not load the joining documents"));
  }, [employeeId]);
  useEffect(load, [load]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <Spinner label="Loading joining documents…" />;

  const all = data.groups.flatMap((g) => g.items);
  const s = data.summary;
  const counts: Record<DocFilter, number> = {
    all: all.length, todo: docFilter(all, "todo").length,
    received: docFilter(all, "received").length, verified: docFilter(all, "verified").length,
  };
  const pills: { key: DocFilter; label: string }[] = [
    { key: "all", label: "All documents" },
    { key: "todo", label: "Still to collect" },
    { key: "received", label: "To verify" },
    { key: "verified", label: "Done" },
  ];
  const r = 30;
  const c = 2 * Math.PI * r;
  const ringTone = s.percent === 100 ? "text-emerald-500" : s.percent >= 50 ? "text-sky-500" : "text-amber-500";

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:gap-5">
          <svg viewBox="0 0 72 72" className={`h-20 w-20 shrink-0 ${ringTone}`} role="img"
            aria-label={`${s.required_done} of ${s.required} required documents collected`}>
            <circle cx="36" cy="36" r={r} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="7" />
            <circle cx="36" cy="36" r={r} fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round"
              strokeDasharray={c} strokeDashoffset={c * (1 - s.percent / 100)} transform="rotate(-90 36 36)" />
            <text x="36" y="40" textAnchor="middle" className="fill-current text-[14px] font-bold">{s.percent}%</text>
          </svg>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-primary">Joining documents</h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-800">
                <EyeOff size={11} aria-hidden /> HR only
              </span>
            </div>
            <p className="mt-0.5 text-sm text-secondary">
              {s.required_done} of {s.required} required documents collected for {employeeName}
              {s.missing_required.length > 0 && <> · still to collect: <b className="text-amber-700 dark:text-amber-300">{s.missing_required.slice(0, 3).join(", ")}{s.missing_required.length > 3 ? ` +${s.missing_required.length - 3}` : ""}</b></>}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <StatChip tone="sky" value={s.received} label="to verify" />
              <StatChip tone="emerald" value={s.verified} label="verified" />
              <StatChip tone="slate" value={s.not_applicable} label="not needed" />
              <StatChip tone="amber" value={s.missing_required.length} label="required missing" />
            </div>
          </div>
          {data.can_manage && (
            <button type="button" className={btnSecondary} onClick={() => setManage(true)}>
              <FolderCog size={15} aria-hidden /> Manage the list
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-subtle bg-surface-2 px-5 py-2.5" role="tablist" aria-label="Show documents">
          {pills.map((p) => {
            const on = filter === p.key;
            return (
              <button key={p.key} type="button" role="tab" aria-selected={on} onClick={() => setFilter(p.key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${focusRing} ${
                  on ? "bg-gradient-to-r from-teal-600 to-cyan-700 text-white shadow-raised"
                    : "bg-surface-1 text-secondary ring-1 ring-inset ring-black/5 hover:text-primary dark:ring-white/10"}`}>
                {p.label}
                <span className={`rounded-full px-1.5 text-[10px] ${on ? "bg-white/25" : "bg-surface-2"}`}>{counts[p.key]}</span>
              </button>
            );
          })}
        </div>
      </section>

      {data.groups.map((g, gi) => {
        const items = docFilter(g.items, filter);
        if (!items.length) return null;
        const Icon = groupIcon(g.name);
        const req = g.items.filter((i) => i.required);
        const done = req.filter((i) => i.state !== "missing").length;
        return (
          <section key={g.name} className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
            <header className="flex flex-wrap items-center gap-3 border-b border-subtle bg-surface-2 px-5 py-3">
              <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-gradient-to-br text-white shadow-raised ${GROUP_GRAD[gi % GROUP_GRAD.length]}`} aria-hidden>
                <Icon size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-primary">{g.name}</h3>
                <p className="text-xs text-muted">{g.items.length} document{g.items.length === 1 ? "" : "s"}{req.length ? ` · ${done} of ${req.length} required collected` : ""}</p>
              </div>
              {req.length > 0 && (
                <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-1 ring-1 ring-inset ring-black/5 dark:ring-white/10" aria-hidden>
                  <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500" style={{ width: `${Math.round((100 * done) / req.length)}%` }} />
                </div>
              )}
            </header>
            <ul className="divide-y divide-subtle">
              {items.map((it) => (
                <DocumentRow key={it.type_id} item={it} employeeId={employeeId} maxFiles={data.max_files}
                  onChanged={(next, msg) => { setData(next); showToast(msg); }}
                  onError={(m) => showToast(m, "err")} onPreview={setPreview} />
              ))}
            </ul>
          </section>
        );
      })}
      {filter !== "all" && data.groups.every((g) => docFilter(g.items, filter).length === 0) && (
        <p className="rounded-card border border-dashed border-subtle bg-surface-1 px-4 py-6 text-center text-sm text-secondary">
          Nothing here — {filter === "todo" ? "every required document is in" : "no document is in this state yet"}.
        </p>
      )}

      {preview && (
        <Modal title={preview.original} onClose={() => setPreview(null)} xl>
          <FilePreviewPane url={preview.url} title={preview.original} downloadName={preview.original.replace(/\.[^.]+$/, "")} />
        </Modal>
      )}
      {manage && <ManageListDialog onClose={() => setManage(false)} onChanged={(m) => { showToast(m); load(); }} />}
    </div>
  );
}

function StatChip({ tone, value, label }: { tone: "sky" | "emerald" | "slate" | "amber"; value: number; label: string }) {
  const cls = {
    sky: "bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
    emerald: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    amber: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold ${cls}`}><b>{value}</b> {label}</span>;
}

/* ------------------------------------------------------------------ one document */

function DocumentRow({ item, employeeId, maxFiles, onChanged, onError, onPreview }: {
  item: DocItem;
  employeeId: number;
  maxFiles: number;
  onChanged: (next: Checklist, msg: string) => void;
  onError: (msg: string) => void;
  onPreview: (f: DocFile) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [removing, setRemoving] = useState<DocFile | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(item.note || "");
  const look = STATE_LOOK[item.state];
  const StateIcon = look.icon;
  const room = maxFiles - item.files.length;

  const send = async (files: File[]) => {
    if (!files.length) return;
    if (files.length > room) { onError(`At most ${maxFiles} files per document — ${room} more can be added`); return; }
    setBusy(true);
    try {
      const r = await uploadFiles(employeeId, item.type_id, files);
      onChanged(r.data, `${item.name}: ${r.message.toLowerCase()}`);
    } catch (e: any) {
      onError(e?.message || "Upload failed");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const mark = async (m: "verified" | "not_applicable" | null, withNote?: string) => {
    setBusy(true);
    try {
      const r = await crmPut<Checklist>(`/api/employees/${employeeId}/joining-documents/${item.type_id}`,
        { mark: m, note: withNote ?? note });
      onChanged(r.data, `${item.name}: ${r.message || "saved"}`);
      setNoteOpen(false);
    } catch (e: any) {
      onError(e?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (f: DocFile) => {
    const r = await crmDelete<Checklist>(`/api/employees/${employeeId}/joining-documents/${item.type_id}/files/${f.name}`);
    onChanged(r.data, `${f.original} removed`);
  };

  return (
    <li
      className={`px-5 py-4 transition-colors ${drag ? "bg-teal-50 dark:bg-teal-950/30" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); void send(Array.from(e.dataTransfer.files || [])); }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
        <StateIcon size={22} className={`mt-0.5 shrink-0 ${look.ring}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-primary">{item.name}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${item.required ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200" : "bg-surface-2 text-muted"}`}>
              {item.required ? "Required" : "Optional"}
            </span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${look.chip}`}>{look.label}</span>
            {item.hidden_from_list && <span className="text-[11px] text-muted">(no longer on the list)</span>}
          </div>
          {item.description && <p className="mt-0.5 text-xs text-muted">{item.description}</p>}
          {(item.state === "verified" || item.state === "not_applicable") && item.checked_by_name && (
            <p className="mt-1 text-xs text-secondary">
              {item.state === "verified" ? "Verified" : "Marked not needed"} by {item.checked_by_name} · {when(item.checked_at)}
              {item.note && <> — “{item.note}”</>}
            </p>
          )}
          {item.files.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {item.files.map((f) => (
                <li key={f.name} className="group inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-control border border-subtle bg-surface-2 py-1 pl-2 pr-1 text-xs">
                  <FileText size={14} className="shrink-0 text-teal-600" aria-hidden />
                  <button type="button" onClick={() => onPreview(f)} title={`Open ${f.original}`}
                    className={`min-w-0 truncate font-semibold text-primary hover:underline ${focusRing}`} style={{ maxWidth: 220 }}>
                    {f.original}
                  </button>
                  <span className="shrink-0 text-muted">{fileSize(f.size)} · {when(f.uploaded_at)}{f.uploaded_by_name ? ` · ${f.uploaded_by_name}` : ""}</span>
                  <button type="button" aria-label={`Open ${f.original}`} onClick={() => onPreview(f)}
                    className={`rounded p-1 text-secondary hover:bg-surface-1 hover:text-primary ${focusRing}`}><Eye size={13} /></button>
                  <button type="button" aria-label={`Download ${f.original}`}
                    onClick={() => downloadFile(f).catch((e) => onError(e?.message || "Download failed"))}
                    className={`rounded p-1 text-secondary hover:bg-surface-1 hover:text-primary ${focusRing}`}><Download size={13} /></button>
                  <button type="button" aria-label={`Remove ${f.original}`} onClick={() => setRemoving(f)}
                    className={`rounded p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 ${focusRing}`}><X size={13} /></button>
                </li>
              ))}
            </ul>
          )}
          {noteOpen && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input className={`${inputCls} !w-80 max-w-full`} value={note} maxLength={500} autoComplete="off"
                placeholder="Why it is not needed (e.g. Fresher — no previous employer)"
                onChange={(e) => setNote(e.target.value)} aria-label="Note" />
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => mark("not_applicable", note)}>Mark not needed</button>
              <button type="button" className={btnSecondary} onClick={() => setNoteOpen(false)}>Cancel</button>
            </div>
          )}
        </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          <input ref={input} type="file" multiple accept={ACCEPT} className="hidden"
            onChange={(e) => void send(Array.from(e.target.files || []))} aria-label={`Upload ${item.name}`} />
          {item.state !== "not_applicable" && room > 0 && (
            <button type="button" className={item.files.length ? btnSecondary : btnPrimary} disabled={busy}
              onClick={() => input.current?.click()}>
              <Upload size={14} aria-hidden /> {busy ? "Saving…" : item.files.length ? "Add file" : "Upload"}
            </button>
          )}
          {item.state === "received" && (
            <button type="button" disabled={busy} onClick={() => mark("verified")}
              className={`inline-flex items-center gap-1.5 rounded-control bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-2 text-sm font-semibold text-white shadow-raised hover:brightness-110 disabled:opacity-60 ${focusRing}`}>
              <ShieldCheck size={14} aria-hidden /> Mark verified
            </button>
          )}
          {item.state === "missing" && !noteOpen && (
            <button type="button" className={btnSecondary} disabled={busy} onClick={() => setNoteOpen(true)} title="This person does not have this document">
              <Ban size={14} aria-hidden /> Not needed
            </button>
          )}
          {(item.state === "verified" || item.state === "not_applicable") && (
            <button type="button" className={btnSecondary} disabled={busy} onClick={() => mark(null, "")}>
              <RotateCcw size={14} aria-hidden /> Undo
            </button>
          )}
        </div>
      </div>
      {item.state === "missing" && !item.files.length && (
        <p className="mt-2 pl-[34px] text-[11px] text-muted">Drop files here or press Upload · PDF, images or Word · up to {maxFiles} files</p>
      )}
      {removing && (
        <ConfirmModal
          title="Remove this file?"
          message={`${removing.original} is removed from ${item.name}. This cannot be undone.`}
          confirmLabel="Remove"
          danger
          onConfirm={async () => { try { await remove(removing); } catch (e: any) { onError(e?.message || "Could not remove"); } setRemoving(null); }}
          onClose={() => setRemoving(null)}
        />
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ Admin: the list */

type Draft = { id?: number; group: string; name: string; description: string; required: boolean };
const EMPTY: Draft = { group: "", name: "", description: "", required: true };

export function ManageListDialog({ onClose, onChanged }: { onClose: () => void; onChanged: (msg: string) => void }) {
  const [types, setTypes] = useState<DocType[] | null>(null);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<DocType | null>(null);

  const load = useCallback(() => {
    crmGet<DocType[]>("/api/joining-document-types").then((r) => setTypes(r.data || [])).catch((e) => setErr(e?.message || "Could not load the list"));
  }, []);
  useEffect(load, [load]);

  const groups = useMemo(() => {
    const m = new Map<string, DocType[]>();
    (types || []).forEach((t) => m.set(t.group, [...(m.get(t.group) || []), t]));
    return [...m.entries()];
  }, [types]);

  const save = async () => {
    if (!draft) return;
    if (!draft.group.trim() || !draft.name.trim()) { setErr("Give the group and the document name"); return; }
    setBusy(true); setErr("");
    try {
      const body = { group: draft.group.trim(), name: draft.name.trim(), description: draft.description.trim() || null, required: draft.required };
      const r = draft.id ? await crmPut(`/api/joining-document-types/${draft.id}`, body) : await crmPost("/api/joining-document-types", body);
      onChanged(r.message || "Saved");
      setDraft(null);
      load();
    } catch (e: any) {
      setErr(e?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (t: DocType, patch: Partial<DocType>) => {
    try {
      const r = await crmPut(`/api/joining-document-types/${t.id}`, patch);
      onChanged(r.message || "Saved"); load();
    } catch (e: any) { setErr(e?.message || "Could not save"); }
  };

  const move = async (t: DocType, dir: -1 | 1) => {
    if (!types) return;
    const ids = types.map((x) => x.id);
    const i = ids.indexOf(t.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await crmPost("/api/joining-document-types/reorder", { ids }); load(); } catch (e: any) { setErr(e?.message || "Could not reorder"); }
  };

  return (
    <Modal title="Joining documents list" onClose={onClose} xl dirty={draft != null}
      hero={<DialogHero tone="indigo" icon={FolderCog} eyebrow="Admin · every employee" title="Joining documents list"
        subtitle="What HR collects from every joiner. A document you add shows on every employee's Joining Documents tab." />}>
      <div className="space-y-4">
        {err && <p role="alert" className="rounded-control bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{err}</p>}
        {!types && !err && <Spinner label="Loading…" />}
        {draft ? (
          <div className="space-y-3 rounded-card border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-800 dark:bg-indigo-950/30">
            <div className="text-sm font-bold text-primary">{draft.id ? "Change document" : "Add a document"}</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-secondary">Group
                <input className={`${inputCls} mt-1`} list="jd-groups" value={draft.group} maxLength={80}
                  placeholder="e.g. Identity Document Collection" onChange={(e) => setDraft({ ...draft, group: e.target.value })} />
                <datalist id="jd-groups">{groups.map(([g]) => <option key={g} value={g} />)}</datalist>
              </label>
              <label className="block text-xs font-semibold text-secondary">Document name
                <input className={`${inputCls} mt-1`} value={draft.name} maxLength={160}
                  placeholder="e.g. Passport" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label className="block text-xs font-semibold text-secondary sm:col-span-2">Hint for HR <span className="font-normal text-muted">(optional)</span>
                <input className={`${inputCls} mt-1`} value={draft.description} maxLength={400}
                  placeholder="e.g. Both sides, colour scan" onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </label>
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-primary">
              <input type="checkbox" checked={draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.checked })} />
              Required from every joiner
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={() => setDraft(null)} disabled={busy}>Cancel</button>
              <button type="button" className={btnPrimary} onClick={save} disabled={busy}>{busy ? "Saving…" : draft.id ? "Save" : "Add document"}</button>
            </div>
          </div>
        ) : (
          <button type="button" className={btnPrimary} onClick={() => { setErr(""); setDraft({ ...EMPTY, group: groups[0]?.[0] || "" }); }}>
            <Plus size={15} aria-hidden /> Add a document
          </button>
        )}
        {groups.map(([g, list]) => {
          const Icon = groupIcon(g);
          return (
            <section key={g} className="overflow-hidden rounded-card border border-subtle">
              <header className="flex items-center gap-2 bg-surface-2 px-4 py-2 text-sm font-bold text-primary">
                <Icon size={15} className="text-indigo-600" aria-hidden /> {g}
                <button type="button" className="ml-auto text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300"
                  onClick={() => setDraft({ ...EMPTY, group: g })}>+ Add to this group</button>
              </header>
              <ul className="divide-y divide-subtle">
                {list.map((t) => (
                  <li key={t.id} className={`flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm ${t.is_active ? "" : "opacity-60"}`}>
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold text-primary">{t.name}</span>
                      <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${t.required ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200" : "bg-surface-2 text-muted"}`}>
                        {t.required ? "Required" : "Optional"}
                      </span>
                      {!t.is_active && <span className="ml-2 text-xs text-muted">Hidden</span>}
                      {t.description && <div className="text-xs text-muted">{t.description}</div>}
                      {t.employees_with_files > 0 && <div className="text-[11px] text-muted">On record for {t.employees_with_files} employee{t.employees_with_files === 1 ? "" : "s"}</div>}
                    </div>
                    <button type="button" aria-label="Move up" className={`rounded p-1.5 text-secondary hover:bg-surface-2 ${focusRing}`} onClick={() => move(t, -1)}><ArrowUp size={14} /></button>
                    <button type="button" aria-label="Move down" className={`rounded p-1.5 text-secondary hover:bg-surface-2 ${focusRing}`} onClick={() => move(t, 1)}><ArrowDown size={14} /></button>
                    <button type="button" className={btnSecondary} onClick={() => toggle(t, { required: !t.required })}>{t.required ? "Make optional" : "Make required"}</button>
                    <button type="button" className={btnSecondary}
                      onClick={() => setDraft({ id: t.id, group: t.group, name: t.name, description: t.description || "", required: t.required })}>Edit</button>
                    {t.is_active
                      ? <button type="button" aria-label={`Delete ${t.name}`} className={`rounded p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 ${focusRing}`} onClick={() => setDel(t)}><Trash2 size={15} /></button>
                      : <button type="button" className={btnSecondary} onClick={() => toggle(t, { is_active: true })}>Show again</button>}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {del && (
        <ConfirmModal
          title={`Remove “${del.name}”?`}
          message={del.employees_with_files
            ? `${del.employees_with_files} employee(s) already gave it, so it is hidden from the list — their files stay.`
            : "Nobody has given it yet, so it is deleted from the list."}
          confirmLabel={del.employees_with_files ? "Hide" : "Delete"}
          danger
          onConfirm={async () => {
            try { const r = await crmDelete(`/api/joining-document-types/${del.id}`); onChanged(r.message || "Removed"); load(); }
            catch (e: any) { setErr(e?.message || "Could not remove"); }
            setDel(null);
          }}
          onClose={() => setDel(null)}
        />
      )}
    </Modal>
  );
}
