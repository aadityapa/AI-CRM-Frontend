/**
 * Upload a resume and apply the candidate to this opportunity (TA, Applied
 * Candidates ▸ Upload Resume). Redesigned 29 Sep 2026 at the user's request:
 * "Remove Education & Technical skills, add Current Location & Note, and make
 * it a form TA WANTS to fill".
 *
 *  - The resume comes first, in a large drag-and-drop zone. Picking it runs
 *    POST /api/resumes/parse and fills every EMPTY field. A field filled from
 *    the CV carries a small "from CV" tag until TA edits it. A value TA typed
 *    always wins over the extractor.
 *  - Highest education, technical domain and key skills are no longer FIELDS.
 *    Whatever the parser read for them is still sent quietly
 *    (`parsedExtras`), so ATS, Suggested Candidates and the candidate record
 *    lose nothing. TA simply does not have to type them.
 *  - New: Current location (→ `current_location`, which also fills the
 *    candidate's city when empty) and a Note for RMG / GM (→ `note`, logged on
 *    the candidate's Activity Log and shown on the Applied Candidates row).
 *  - Four small section cards (Who · Experience & availability · Pay ·
 *    Location & note), one-tap chips for source / notice / location, a live
 *    hike % against current CTC, the position's band and budget beside the
 *    form, a profile-strength meter, an upload progress bar and Ctrl+Enter.
 *
 * Behaviour kept exactly: duplicate / name-match warnings, name required,
 * only .pdf/.docx/.txt auto-fill, POST /api/requirements/{id}/resumes.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Banknote, Briefcase, CheckCircle2, Circle, FileText, IndianRupee, Lightbulb, MapPin,
  NotebookPen, RefreshCw, Sparkles, UploadCloud, UserRound, X,
} from "lucide-react";

import { crmPut, crmUpload } from "../api";
import { CrmLink } from "../routerHooks";
import { PhoneField } from "./PhoneField";
import { Modal, btnPrimary, btnSecondary, inputCls, statusLabel } from "./ui";

export const SOURCE_PORTALS = ["Naukri", "LinkedIn", "Indeed", "Referral", "Other"];
export const NOTICE_CHIPS = ["Immediate", "15 days", "30 days", "60 days", "90 days"];
const NOTE_MAX = 1000;
const AUTOFILL_EXT = ["pdf", "docx", "txt"];

export type UploadReq = {
  id: number;
  opportunity_id: number;
  title: string;
  req_number?: string | null;
  opportunity_opp_id?: string | null;
  customer_name?: string | null;
  location_name?: string | null;
  experience_min?: number | null;
  experience_max?: number | null;
  budget_ctc_max?: number | null;
  skills?: { name?: string; is_mandatory: boolean }[];
};
type ToastFn = (msg: string, kind?: "ok" | "err") => void;

type Dup = {
  candidate_id: number; name: string; email?: string; phone?: string;
  already_applied_here: boolean; profile_id_here: number | null;
  profiles: { profile_id: number; opportunity_title: string; pipeline_status: string }[];
};
type NameMatch = { candidate_id: number; name: string; email?: string; phone?: string };

type FieldKey =
  | "name" | "email" | "phone" | "source" | "experience" | "notice"
  | "currentCtc" | "expectedCtc" | "currentLocation" | "preferredLocation" | "note";
type Form = Record<FieldKey, string>;
const EMPTY: Form = {
  name: "", email: "", phone: "", source: "", experience: "", notice: "",
  currentCtc: "", expectedCtc: "", currentLocation: "", preferredLocation: "", note: "",
};
/** What the profile-strength meter counts (the note is a bonus, not a gap). */
const CORE: FieldKey[] = [
  "name", "email", "phone", "source", "experience", "notice",
  "currentCtc", "expectedCtc", "currentLocation", "preferredLocation",
];

/** "12 LPA" / "12.5" / "1200000" → lakhs, or null. Bare numbers ≥ 1000 are rupees. */
export function toLakhs(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const s = String(v).toLowerCase().replace(/,/g, "");
  const m = s.match(/\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (s.includes("cr")) return n * 100;
  return n >= 1000 ? n / 100_000 : n;
}
const lakhs = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} LPA`;

function fmtSize(bytes: number) {
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/* ------------------------------------------------------------ small parts */

function Section({ icon, title, hint, accent, done, children }: {
  icon: ReactNode; title: string; hint: string; accent: string; done: boolean; children: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
      <span className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${accent}`} aria-hidden />
      <header className="flex items-center gap-3 border-b border-subtle px-5 py-3">
        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-gradient-to-br text-white shadow-raised ${accent}`}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-primary">{title}</h3>
          <p className="truncate text-xs text-muted">{hint}</p>
        </div>
        {done && <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-label="Section complete" />}
      </header>
      <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({ label, htmlFor, required, fromCv, error, wide, children }: {
  label: string; htmlFor?: string; required?: boolean; fromCv?: boolean; error?: string;
  wide?: boolean; children: ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <div className="mb-1.5 flex items-center gap-2">
        <label htmlFor={htmlFor} className="text-xs font-semibold text-secondary">
          {label}{required && <span className="ml-0.5 text-danger">*</span>}
        </label>
        {fromCv && (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-1.5 py-px text-[10px] font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300"
            title="Read from the resume — check it, edit if needed">
            <Sparkles className="h-2.5 w-2.5" aria-hidden /> from CV
          </span>
        )}
      </div>
      {children}
      {error && <p className="mt-1 text-xs font-semibold text-danger" role="alert">{error}</p>}
    </div>
  );
}

export function Chips({ options, value, onPick, label }: {
  options: string[]; value: string; onPick: (v: string) => void; label: string;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value.trim().toLowerCase() === o.toLowerCase();
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(on ? "" : o)}
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors duration-micro ${
              on ? "border-brand-600 bg-brand-600 text-white"
                : "border-subtle bg-surface-2 text-secondary hover:border-brand-500 hover:text-primary"}`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The resume drop zone (30 Sep 2026: shared by the Upload form and the New
 * Candidate wizard). Before a file: a large drag-and-drop target; after: the
 * file card with Replace / remove and a status line (reading… / filled N).
 * The hidden <input type=file> stays with the caller (it owns the ref).
 */
export function ResumeDropZone({ file, parsing, busy, onBrowse, onDropFile, onClear, status, hint = "We read it and fill in the details for you" }: {
  file: File | null;
  parsing?: boolean;
  busy?: boolean;
  onBrowse: () => void;
  onDropFile: (f: File) => void;
  onClear: () => void;
  /** Shown under the file name once it is read. */
  status?: ReactNode;
  hint?: string;
}) {
  const [dragging, setDragging] = useState(false);
  if (!file) {
    return (
      <button
        type="button"
        onClick={onBrowse}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onDropFile(f);
        }}
        className={`group relative flex w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-card border-2 border-dashed px-6 py-10 text-center transition-all duration-panel ${
          dragging ? "scale-[1.01] border-brand-500 bg-brand-50 dark:bg-brand-900"
            : "border-strong bg-surface-1 hover:border-brand-500 hover:bg-surface-2"}`}
      >
        <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-overlay transition-transform duration-panel group-hover:-translate-y-1">
          <UploadCloud className="h-8 w-8" aria-hidden />
        </span>
        <span className="text-base font-bold text-primary">
          {dragging ? "Drop it here" : "Drop the resume here, or click to browse"}
        </span>
        <span className="flex flex-wrap items-center justify-center gap-1.5 text-xs text-muted">
          <Sparkles className="h-3.5 w-3.5 text-violet-500" aria-hidden />
          {hint}
          <span className="hidden sm:inline">·</span>
          <span>.pdf · .docx · .txt (auto-fill) · .doc</span>
        </span>
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-card border border-subtle bg-surface-1 px-5 py-4 shadow-raised">
      <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-card bg-gradient-to-br from-rose-500 to-orange-500 text-white">
        <FileText className="h-6 w-6" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-primary" title={file.name}>{file.name}</p>
        <p className="text-xs text-muted">{fmtSize(file.size)} · {(file.name.split(".").pop() || "").toUpperCase()}</p>
        {parsing ? (
          <p className="mt-1.5 flex items-center gap-2 text-xs font-semibold text-violet-700 dark:text-violet-300" role="status">
            <span className="ai-thinking inline-block h-2 w-16 rounded-full bg-violet-200 dark:bg-violet-900" aria-hidden />
            Reading the resume and filling in the details…
          </p>
        ) : status}
      </div>
      <div className="flex gap-2">
        <button type="button" className={btnSecondary} onClick={onBrowse} disabled={parsing || busy}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Replace
        </button>
        <button type="button" className={btnSecondary} onClick={onClear} disabled={parsing || busy} aria-label="Remove the file">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function StrengthRing({ pct }: { pct: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const tone = pct >= 100 ? "#059669" : pct >= 70 ? "#2563eb" : pct >= 40 ? "#d97706" : "#e11d48";
  return (
    <svg viewBox="0 0 64 64" className="h-16 w-16 shrink-0" aria-hidden>
      <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-surface-2" />
      <circle cx="32" cy="32" r={r} fill="none" stroke={tone} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform="rotate(-90 32 32)"
        style={{ transition: "stroke-dashoffset 250ms cubic-bezier(0.2,0,0,1)" }} />
      <text x="32" y="36" textAnchor="middle" className="fill-current text-primary" fontSize="14" fontWeight="700">{pct}%</text>
    </svg>
  );
}

function strengthWord(pct: number) {
  if (pct >= 100) return "Complete profile";
  if (pct >= 70) return "Almost there";
  if (pct >= 40) return "Looking good";
  return "Just getting started";
}

/* ------------------------------------------------------------------ modal */

export function UploadResumeModal({ req, onClose, onUploaded, toast }: {
  req: UploadReq;
  onClose: () => void;
  onUploaded: () => void;
  toast: ToastFn;
}) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [fromCv, setFromCv] = useState<Set<FieldKey>>(new Set());
  /** Parsed values that are no longer fields — sent quietly (see the module note). */
  const [parsedExtras, setParsedExtras] = useState<Record<string, string>>({});
  const [nameErr, setNameErr] = useState("");
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [filledCount, setFilledCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dup, setDup] = useState<Dup | null>(null);
  const [nameMatch, setNameMatch] = useState<NameMatch | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const formRef = useRef(form);
  formRef.current = form;

  const set = (k: FieldKey, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFromCv((s) => { if (!s.has(k)) return s; const n = new Set(s); n.delete(k); return n; });
    if (k === "name" && nameErr) setNameErr("");
  };

  const onPickFile = async (f: File | null) => {
    setCvFile(f);
    setDup(null);
    setNameMatch(null);
    setFilledCount(0);
    if (!f) return;
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (!AUTOFILL_EXT.includes(ext)) {
      toast("Auto-fill works for .pdf, .docx and .txt — fill the details manually for this file");
      return;
    }
    setParsing(true);
    try {
      const res = await crmUpload<{ parsed: any; duplicate: Dup | null; name_match: NameMatch | null }>(
        "/api/resumes/parse", f, { opportunity_id: String(req.opportunity_id) },
      );
      const p = res.data?.parsed || {};
      /* Prefill only EMPTY fields — a value TA already typed always wins. */
      const cur = formRef.current;
      const patch: Partial<Form> = {};
      const take = (k: FieldKey, v: unknown) => {
        const s = v == null ? "" : String(v).trim();
        if (s && !cur[k].trim()) patch[k] = s;
      };
      take("name", p.name);
      take("email", p.email);
      take("phone", p.phone);
      take("experience", p.experience);
      take("notice", p.notice_period);
      take("currentCtc", p.current_ctc);
      take("expectedCtc", p.expected_ctc);
      take("currentLocation", p.location);
      const keys = Object.keys(patch) as FieldKey[];
      setForm((fm) => ({ ...fm, ...patch }));
      setFromCv(new Set(keys));
      setFilledCount(keys.length);
      const extras: Record<string, string> = {};
      if (p.education) extras.education = String(p.education).slice(0, 120);
      if (p.technical_domain) extras.technical_domain = String(p.technical_domain).slice(0, 120);
      if (Array.isArray(p.skills) && p.skills.length) extras.skills = p.skills.join(", ").slice(0, 500);
      setParsedExtras(extras);
      setDup(res.data?.duplicate || null);
      setNameMatch(res.data?.name_match || null);
      if (p.text_extracted === false) {
        toast("No text could be read from this file (image-only PDF?) — fill the details manually");
      }
    } catch (e: any) {
      toast(e?.message || "Could not auto-read the resume — fill the details manually");
    } finally {
      setParsing(false);
    }
  };

  const clearFile = () => {
    setCvFile(null); setDup(null); setNameMatch(null); setFilledCount(0); setParsedExtras({});
    if (fileInput.current) fileInput.current.value = "";
  };

  const fields = useMemo(() => {
    const out: Record<string, string> = { candidate_name: form.name.trim(), ...parsedExtras };
    const put = (key: string, v: string) => { if (v.trim()) out[key] = v.trim(); };
    put("email", form.email);
    put("phone", form.phone);
    put("source_portal", form.source);
    put("experience", form.experience);
    put("notice_period", form.notice);
    put("current_ctc", form.currentCtc);
    put("expected_ctc", form.expectedCtc);
    put("current_location", form.currentLocation);
    put("preferred_location", form.preferredLocation);
    put("note", form.note.slice(0, NOTE_MAX));
    return out;
  }, [form, parsedExtras]);

  const doUpload = async () => {
    if (!cvFile) { toast("Add the resume file first", "err"); return; }
    if (!form.name.trim()) {
      setNameErr("Candidate name is required before uploading");
      document.getElementById("upl-name")?.focus();
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      await crmUpload(`/api/requirements/${req.id}/resumes`, cvFile, fields, setProgress);
      toast(`${form.name.trim()} added to ${req.title}`);
      onUploaded();
      onClose();
    } catch (e: any) {
      toast(e?.message || "Upload failed", "err");
    } finally {
      setUploading(false);
    }
  };

  /* ---- derived ---- */
  const filled = CORE.filter((k) => form[k].trim()).length + (cvFile ? 1 : 0);
  const pct = Math.round((filled / (CORE.length + 1)) * 100);
  const missing = [
    !cvFile && "Resume",
    ...CORE.filter((k) => !form[k].trim()).map((k) => LABEL[k]),
  ].filter(Boolean) as string[];

  const cur = toLakhs(form.currentCtc);
  const exp = toLakhs(form.expectedCtc);
  const hike = cur && exp ? Math.round(((exp - cur) / cur) * 100) : null;
  const budget = toLakhs(req.budget_ctc_max ?? null);
  const overBudget = exp != null && budget != null && exp > budget;
  const years = parseFloat(form.experience);
  const band = req.experience_min != null || req.experience_max != null
    ? `${req.experience_min ?? 0}–${req.experience_max ?? "+"} yrs` : null;
  const outOfBand = Number.isFinite(years) && (
    (req.experience_min != null && years < req.experience_min)
    || (req.experience_max != null && years > req.experience_max));
  const mandatory = (req.skills || []).filter((s) => s.is_mandatory && s.name).map((s) => s.name as string);
  const dirty = !uploading && (!!cvFile || Object.values(form).some((v) => v.trim()));

  // Ctrl/⌘+Enter uploads from anywhere in the dialog. Read through a ref so the
  // listener is attached once and always sees the latest form.
  const uploadRef = useRef<() => void>(() => {});
  uploadRef.current = () => { if (!uploading && !parsing) void doUpload(); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); uploadRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const footer = (
    <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-surface-2 sm:w-40" aria-hidden>
          <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-500 transition-all duration-panel"
            style={{ width: `${pct}%` }} />
        </div>
        <span className="truncate text-xs text-muted">
          <b className="text-primary">{pct}%</b> · {strengthWord(pct)}
          <span className="hidden sm:inline"> · Ctrl+Enter to upload</span>
        </span>
      </div>
      <button type="button" className={btnSecondary} onClick={onClose} disabled={uploading}>Cancel</button>
      <button
        type="button"
        className={`${btnPrimary} relative overflow-hidden`}
        onClick={() => void doUpload()}
        disabled={uploading || parsing}
      >
        {uploading && (
          <span className="absolute inset-y-0 left-0 bg-white opacity-20 transition-all" style={{ width: `${progress}%` }} aria-hidden />
        )}
        <UploadCloud className="h-4 w-4" aria-hidden />
        {uploading ? `Uploading… ${progress}%` : parsing ? "Reading resume…" : "Upload & apply"}
      </button>
    </div>
  );

  return (
    <Modal
      title={
        <span className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-raised">
            <UserRound className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate">Add a candidate</span>
            <span className="block truncate text-xs font-medium text-muted">
              {req.title}{req.customer_name ? ` · ${req.customer_name}` : ""}
              {req.opportunity_opp_id || req.req_number ? ` · ${req.opportunity_opp_id || req.req_number}` : ""}
            </span>
          </span>
        </span>
      }
      ariaLabel="Upload resume"
      onClose={onClose}
      fullScreen
      dirty={dirty}
      footer={footer}
    >
      <form className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]"
        onSubmit={(e) => e.preventDefault()} noValidate>
        {/* ------------------------------------------------ the form */}
        <div className="min-w-0 space-y-5">
          {/* Drop zone */}
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,.txt,.doc"
            className="sr-only"
            aria-label="Resume file"
            tabIndex={-1}
            onChange={(e) => void onPickFile(e.target.files?.[0] || null)}
          />
          <ResumeDropZone
            file={cvFile}
            parsing={parsing}
            busy={uploading}
            onBrowse={() => fileInput.current?.click()}
            onDropFile={(f) => void onPickFile(f)}
            onClear={clearFile}
            status={filledCount > 0 ? (
              <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" role="status">
                <Sparkles className="h-3 w-3" aria-hidden /> Filled {filledCount} field{filledCount === 1 ? "" : "s"} from the resume — give them a quick check
              </p>
            ) : null}
          />

          {/* Duplicate warnings — unchanged rules */}
          {dup && (
            <div className={`rounded-card border px-4 py-3 text-sm ${
              dup.already_applied_here
                ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300"
                : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
            }`} role="alert">
              <div className="font-bold">
                {dup.already_applied_here
                  ? "This candidate has ALREADY applied to this opportunity"
                  : "Possible duplicate — this person already exists as a candidate"}
              </div>
              <div className="mt-1">
                Matched <CrmLink to={`candidates/${dup.candidate_id}`} className="font-semibold underline">
                  {dup.name || `Candidate #${dup.candidate_id}`}
                </CrmLink>
                {dup.email ? <> · {dup.email}</> : null}
                {dup.phone ? <> · {dup.phone}</> : null}
                {dup.profile_id_here != null && (
                  <> — <CrmLink to={`profiles/${dup.profile_id_here}`} className="font-semibold underline">
                    open their profile on this opportunity
                  </CrmLink></>
                )}
              </div>
              {dup.profiles.length > 0 && !dup.already_applied_here && (
                <div className="mt-1 text-xs opacity-90">
                  In pipeline: {dup.profiles.slice(0, 3).map((p, i) => (
                    <span key={p.profile_id}>
                      {i > 0 && " · "}
                      <CrmLink to={`profiles/${p.profile_id}`} className="underline">{p.opportunity_title}</CrmLink>
                      {" "}({statusLabel(p.pipeline_status)})
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-1 text-xs opacity-90">
                {dup.already_applied_here
                  ? "Uploading again attaches this file to their existing application — it will not create a second entry."
                  : "Uploading will attach this resume to the EXISTING candidate (no duplicate record is created) and apply them to this opportunity."}
              </div>
            </div>
          )}
          {!dup && nameMatch && (
            <div className="rounded-card border border-subtle bg-surface-2 px-4 py-2.5 text-xs text-secondary">
              <b className="text-primary">Note:</b> a candidate named{" "}
              <CrmLink to={`candidates/${nameMatch.candidate_id}`} className="font-semibold underline">{nameMatch.name}</CrmLink>{" "}
              already exists ({[nameMatch.email, nameMatch.phone].filter(Boolean).join(" · ") || "no contact details"})
              — different email/phone, so this is probably a different person. Worth a glance before uploading.
            </div>
          )}

          <Section icon={<UserRound className="h-5 w-5" aria-hidden />} title="Who is the candidate?"
            hint="Name, and how RMG and the candidate's interviews reach them"
            accent="from-brand-500 to-violet-600" done={!!(form.name.trim() && form.email.trim() && form.phone.trim())}>
            <Field label="Candidate name" htmlFor="upl-name" required fromCv={fromCv.has("name")} error={nameErr} wide>
              <input id="upl-name" className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)}
                placeholder="Full name, as on the resume" autoComplete="off" aria-invalid={!!nameErr} />
            </Field>
            <Field label="Email" htmlFor="upl-email" fromCv={fromCv.has("email")}>
              <input id="upl-email" className={inputCls} type="email" value={form.email}
                onChange={(e) => set("email", e.target.value)} placeholder="name@example.com" autoComplete="off" />
            </Field>
            <Field label="Phone" fromCv={fromCv.has("phone")}>
              <PhoneField value={form.phone} onChange={(v) => set("phone", v)} />
            </Field>
            <Field label="Where did you find them?" wide>
              <Chips options={SOURCE_PORTALS} value={form.source} onPick={(v) => set("source", v)} label="Source portal" />
            </Field>
          </Section>

          <Section icon={<Briefcase className="h-5 w-5" aria-hidden />} title="Experience & availability"
            hint={band ? `This position looks for ${band}` : "How senior, and how soon they can join"}
            accent="from-sky-500 to-cyan-600" done={!!(form.experience.trim() && form.notice.trim())}>
            <Field label="Total experience" htmlFor="upl-exp" fromCv={fromCv.has("experience")}>
              <div className="relative">
                <input id="upl-exp" className={`${inputCls} pr-12`} inputMode="decimal" value={form.experience}
                  onChange={(e) => set("experience", e.target.value)} placeholder="e.g. 4.5" />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-muted">yrs</span>
              </div>
              {band && Number.isFinite(years) && (
                <p className={`mt-1 text-xs font-semibold ${outOfBand ? "text-warning" : "text-success"}`}>
                  {outOfBand ? `Outside the ${band} band — RMG will want a reason in the note` : `Inside the ${band} band`}
                </p>
              )}
            </Field>
            <Field label="Notice period" htmlFor="upl-notice" fromCv={fromCv.has("notice")}>
              <input id="upl-notice" className={inputCls} value={form.notice}
                onChange={(e) => set("notice", e.target.value)} placeholder="e.g. 30 days" />
              <Chips options={NOTICE_CHIPS} value={form.notice} onPick={(v) => set("notice", v)} label="Notice period" />
            </Field>
          </Section>

          <Section icon={<IndianRupee className="h-5 w-5" aria-hidden />} title="Compensation"
            hint={budget != null ? `Budget for this position: up to ${lakhs(budget)}` : "Current and expected, in LPA"}
            accent="from-emerald-500 to-teal-600" done={!!(form.currentCtc.trim() && form.expectedCtc.trim())}>
            <Field label="Current CTC" htmlFor="upl-cur" fromCv={fromCv.has("currentCtc")}>
              <div className="relative">
                <input id="upl-cur" className={`${inputCls} pr-12`} value={form.currentCtc}
                  onChange={(e) => set("currentCtc", e.target.value)} placeholder="e.g. 12" />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-muted">LPA</span>
              </div>
            </Field>
            <Field label="Expected CTC" htmlFor="upl-exp-ctc" fromCv={fromCv.has("expectedCtc")}>
              <div className="relative">
                <input id="upl-exp-ctc" className={`${inputCls} pr-12`} value={form.expectedCtc}
                  onChange={(e) => set("expectedCtc", e.target.value)} placeholder="e.g. 18" />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-muted">LPA</span>
              </div>
            </Field>
            {(hike != null || overBudget) && (
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                {hike != null && (
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
                    hike > 50 ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                      : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"}`}>
                    <Banknote className="h-3.5 w-3.5" aria-hidden /> {hike >= 0 ? "+" : ""}{hike}% hike asked
                  </span>
                )}
                {overBudget && budget != null && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                    Over the {lakhs(budget)} budget — you can still upload, then Hold or decide on the row
                  </span>
                )}
              </div>
            )}
          </Section>

          <Section icon={<MapPin className="h-5 w-5" aria-hidden />} title="Location & note"
            hint="Where they are today, where they will work, and anything RMG should know"
            accent="from-orange-500 to-rose-500" done={!!(form.currentLocation.trim() && form.preferredLocation.trim())}>
            <Field label="Current location" htmlFor="upl-cloc" fromCv={fromCv.has("currentLocation")}>
              <input id="upl-cloc" className={inputCls} value={form.currentLocation}
                onChange={(e) => set("currentLocation", e.target.value)} placeholder="e.g. Pune" />
            </Field>
            <Field label="Preferred location" htmlFor="upl-ploc">
              <input id="upl-ploc" className={inputCls} value={form.preferredLocation}
                onChange={(e) => set("preferredLocation", e.target.value)} placeholder="e.g. Bangalore" />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {form.currentLocation.trim() && form.preferredLocation.trim() !== form.currentLocation.trim() && (
                  <button type="button" className="rounded-full border border-subtle bg-surface-2 px-2.5 py-1 text-xs font-semibold text-secondary hover:border-brand-500 hover:text-primary"
                    onClick={() => set("preferredLocation", form.currentLocation.trim())}>
                    Same as current
                  </button>
                )}
                {req.location_name && form.preferredLocation.trim() !== req.location_name && (
                  <button type="button" className="rounded-full border border-subtle bg-surface-2 px-2.5 py-1 text-xs font-semibold text-secondary hover:border-brand-500 hover:text-primary"
                    onClick={() => set("preferredLocation", req.location_name as string)}>
                    Job location: {req.location_name}
                  </button>
                )}
              </div>
            </Field>
            <Field label="Note for RMG / GM" htmlFor="upl-note" wide>
              <textarea id="upl-note" rows={3} maxLength={NOTE_MAX} className={`${inputCls} resize-y`}
                value={form.note} onChange={(e) => set("note", e.target.value)}
                placeholder="What stood out on the call — communication, why they are moving, can join early, anything to probe…" />
              <p className="mt-1 flex justify-between text-[11px] text-muted">
                <span>Saved on the candidate's Activity Log and shown on the Applied Candidates row.</span>
                <span className="tabular-nums">{form.note.length}/{NOTE_MAX}</span>
              </p>
            </Field>
          </Section>
        </div>

        {/* ------------------------------------------------ the side panel */}
        <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
          <div className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
            <div className="flex items-center gap-3">
              <StrengthRing pct={pct} />
              <div className="min-w-0">
                <p className="text-sm font-bold text-primary">{strengthWord(pct)}</p>
                <p className="text-xs text-muted">
                  {pct >= 100 ? "RMG can screen this one without coming back to you."
                    : "A complete profile saves RMG a round-trip back to you."}
                </p>
              </div>
            </div>
            <ul className="mt-3 space-y-1.5 text-xs">
              {(["Resume", ...CORE.map((k) => LABEL[k])]).map((l) => {
                const done = !missing.includes(l);
                return (
                  <li key={l} className={`flex items-center gap-2 ${done ? "text-secondary" : "text-muted"}`}>
                    {done ? <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
                      : <Circle className="h-3.5 w-3.5" aria-hidden />}
                    <span className={done ? "line-through decoration-1 opacity-70" : ""}>{l}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted">The position</p>
            <p className="mt-1 text-sm font-bold text-primary">{req.title}</p>
            {req.customer_name && <p className="text-xs text-secondary">{req.customer_name}</p>}
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {band && (<><dt className="text-muted">Experience</dt><dd className="font-semibold text-primary">{band}</dd></>)}
              {budget != null && (<><dt className="text-muted">Budget</dt><dd className="font-semibold text-primary">up to {lakhs(budget)}</dd></>)}
              {req.location_name && (<><dt className="text-muted">Location</dt><dd className="font-semibold text-primary">{req.location_name}</dd></>)}
            </dl>
            {mandatory.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">Must-have skills</p>
                <div className="flex flex-wrap gap-1">
                  {mandatory.slice(0, 10).map((s) => (
                    <span key={s} className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 dark:bg-brand-900 dark:text-brand-300">{s}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2.5 rounded-card border border-subtle bg-surface-2 p-3.5 text-xs text-secondary">
            <Lightbulb className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
            <p>
              The candidate lands in <b className="text-primary">Applied Candidates</b> at Sourcing with an ATS score.
              Press <b className="text-primary">Technical Screening</b> on the row when you are ready for RMG.
            </p>
          </div>
          <div className="hidden gap-2.5 text-[11px] text-muted lg:flex">
            <NotebookPen className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Skills, domain and education are read from the resume automatically — no typing needed.</span>
          </div>
        </aside>
      </form>
    </Modal>
  );
}

const LABEL: Record<FieldKey, string> = {
  name: "Name", email: "Email", phone: "Phone", source: "Source", experience: "Experience",
  notice: "Notice period", currentCtc: "Current CTC", expectedCtc: "Expected CTC",
  currentLocation: "Current location", preferredLocation: "Preferred location", note: "Note",
};

/* =================================================================== edit */

/** What the Edit dialog needs from an Applied Candidates row. */
export type EditableApplicant = {
  id: number;
  is_profile_only?: boolean;
  candidate_id: number | null;
  candidate_name: string;
  email: string | null;
  phone: string | null;
  source_portal: string | null;
  applicant_experience?: string | null;
  application_details?: {
    education?: string | null;
    technical_domain?: string | null;
    skills?: string | null;
    notice_period?: string | null;
    current_ctc?: string | null;
    expected_ctc?: string | null;
    preferred_location?: string | null;
    current_location?: string | null;
  } | null;
};

type EditKey =
  | "name" | "email" | "phone" | "source" | "experience" | "notice" | "domain"
  | "currentCtc" | "expectedCtc" | "currentLocation" | "preferredLocation" | "education" | "skills";

const EDIT_LABEL: Record<EditKey, string> = {
  name: "Name", email: "Email", phone: "Phone", source: "Source", experience: "Experience",
  notice: "Notice period", domain: "Technical domain", currentCtc: "Current CTC", expectedCtc: "Expected CTC",
  currentLocation: "Current location", preferredLocation: "Preferred location", education: "Education", skills: "Key skills",
};

/** "12 LPA" / "12,00,000" / "1.2 Cr" → rupees (mirror of B-V2 services/ctc.parse_ctc_to_rupees). */
export function ctcToRupees(v: string): number | null {
  const text = v.trim().toLowerCase();
  if (!text) return null;
  const m = text.replace(/\s/g, "").match(/(\d+(?:[.,]\d+)*)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  let rupees: number;
  if (/\bcr\b|crore/.test(text)) rupees = n * 1e7;
  else if (/lpa|lakh|lacs?\b|\bl\b|\dl\b/.test(text)) rupees = n * 1e5;
  else if (/\bk\b|thousand|\dk\b/.test(text)) rupees = n * 1e3;
  else if (n < 1000) rupees = n * 1e5;   // "12" means 12 LPA
  else rupees = n;                        // already rupees
  return rupees > 5e8 ? null : Math.round(rupees);
}

/**
 * Edit an applicant (30 Sep 2026, user ask: "redesign Edit applicant details
 * best of best") — the Upload form's design: section cards with a tick when
 * complete, one-tap chips, the hike / budget chips, and a side panel with the
 * profile strength, WHAT CHANGED and the position. Save stays disabled until
 * something changed.
 *
 * A resume row saves to PUT /api/resumes/{id}. A profile-only row (applied
 * from the candidate record — negative id, no resume) saves to the CANDIDATE
 * (PUT /api/candidates/{id}); source, education and skills live on a resume,
 * so that row does not offer them.
 */
export function EditApplicantModal({ row, req, onClose, onSaved, toast }: {
  row: EditableApplicant;
  req: UploadReq;
  onClose: () => void;
  onSaved: () => void;
  toast: ToastFn;
}) {
  const d = row.application_details || {};
  const profileOnly = !!row.is_profile_only || row.id < 0;
  const initial = useMemo<Record<EditKey, string>>(() => ({
    name: row.candidate_name || "", email: row.email || "", phone: row.phone || "",
    source: row.source_portal || "", experience: row.applicant_experience || "",
    notice: d.notice_period || "", domain: d.technical_domain || "",
    currentCtc: d.current_ctc || "", expectedCtc: d.expected_ctc || "",
    currentLocation: d.current_location || "", preferredLocation: d.preferred_location || "",
    education: d.education || "", skills: d.skills || "",
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [row.id]);
  const [form, setForm] = useState(initial);
  const [nameErr, setNameErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: EditKey, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (k === "name" && nameErr) setNameErr("");
  };

  const keys = (Object.keys(EDIT_LABEL) as EditKey[])
    .filter((k) => !(profileOnly && (k === "source" || k === "education" || k === "skills")));
  const changed = keys.filter((k) => form[k].trim() !== initial[k].trim());
  const core = keys.filter((k) => k !== "education" && k !== "skills" && k !== "domain");
  const filledCore = core.filter((k) => form[k].trim()).length;
  const pct = Math.round((filledCore / core.length) * 100);

  const cur = toLakhs(form.currentCtc);
  const exp = toLakhs(form.expectedCtc);
  const hike = cur && exp ? Math.round(((exp - cur) / cur) * 100) : null;
  const budget = toLakhs(req.budget_ctc_max ?? null);
  const overBudget = exp != null && budget != null && exp > budget;
  const years = parseFloat(form.experience);
  const band = req.experience_min != null || req.experience_max != null
    ? `${req.experience_min ?? 0}–${req.experience_max ?? "+"} yrs` : null;
  const outOfBand = Number.isFinite(years) && (
    (req.experience_min != null && years < req.experience_min)
    || (req.experience_max != null && years > req.experience_max));

  const save = async () => {
    if (busy || !changed.length) return;
    if (!form.name.trim()) {
      setNameErr("Candidate name is required");
      document.getElementById("edit-name")?.focus();
      return;
    }
    setBusy(true);
    try {
      if (profileOnly) {
        if (!row.candidate_id) throw new Error("This applicant has no candidate record to edit");
        const parts = form.name.trim().split(/\s+/);
        const yrs = form.experience.replace(/[^\d.]/g, "");
        const res = await crmPut(`/api/candidates/${row.candidate_id}`, {
          first_name: parts[0],
          last_name: parts.length > 1 ? parts.slice(1).join(" ") : null,
          ...(form.email.trim() ? { email: form.email.trim() } : {}),
          phone: form.phone.trim() || null,
          experience_years: yrs ? Number(yrs) : null,
          notice_period: form.notice.trim() || null,
          technical_domain: form.domain.trim() || null,
          current_ctc: ctcToRupees(form.currentCtc),
          expected_ctc: ctcToRupees(form.expectedCtc),
          city: form.currentLocation.trim() || null,
          preferred_locations: form.preferredLocation.trim() || null,
        });
        toast(res.message || "Candidate updated");
      } else {
        const res = await crmPut(`/api/resumes/${row.id}`, {
          candidate_name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          source_portal: form.source,
          experience: form.experience.trim(),
          education: form.education.trim(),
          technical_domain: form.domain.trim(),
          skills: form.skills.trim(),
          notice_period: form.notice.trim(),
          current_ctc: form.currentCtc.trim(),
          expected_ctc: form.expectedCtc.trim(),
          current_location: form.currentLocation.trim(),
          preferred_location: form.preferredLocation.trim(),
        });
        toast(res.message || "Applicant updated");
      }
      onSaved();
    } catch (e: any) {
      toast(e?.message || "Update failed", "err");
      setBusy(false);
    }
  };

  const saveRef = useRef<() => void>(() => {});
  saveRef.current = () => { void save(); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); saveRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const lpa = (id: string, k: EditKey, placeholder: string) => (
    <div className="relative">
      <input id={id} className={`${inputCls} pr-12`} value={form[k]} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-muted">LPA</span>
    </div>
  );

  const footer = (
    <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3">
      <span className="min-w-0 flex-1 truncate text-xs text-muted">
        {changed.length
          ? <><b className="text-primary">{changed.length} change{changed.length === 1 ? "" : "s"}</b> · {changed.map((k) => EDIT_LABEL[k]).join(", ")}
            <span className="hidden sm:inline"> · Ctrl+Enter to save</span></>
          : "Nothing changed yet"}
      </span>
      <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy || !changed.length}>
        <CheckCircle2 className="h-4 w-4" aria-hidden /> {busy ? "Saving…" : "Save changes"}
      </button>
    </div>
  );

  return (
    <Modal
      title={
        <span className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-indigo-600 text-sm font-bold text-white shadow-raised">
            {(form.name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
          </span>
          <span className="min-w-0">
            <span className="block truncate">Edit applicant · {form.name || row.candidate_name}</span>
            <span className="block truncate text-xs font-medium text-muted">
              {req.title}{req.customer_name ? ` · ${req.customer_name}` : ""}
              {profileOnly ? " · saves to the candidate record" : " · saves to this application"}
            </span>
          </span>
        </span>
      }
      ariaLabel="Edit applicant details"
      onClose={onClose}
      fullScreen
      dirty={changed.length > 0 && !busy}
      footer={footer}
    >
      <form className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]"
        onSubmit={(e) => e.preventDefault()} noValidate>
        <div className="min-w-0 space-y-5">
          {profileOnly && (
            <div className="flex gap-2.5 rounded-card border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
              <Lightbulb className="h-4 w-4 shrink-0" aria-hidden />
              <p>This applicant was applied from the <b>candidate record</b> (no resume on this position), so your
                edits update that record. Source, education and skills live on a resume and are not offered here.</p>
            </div>
          )}

          <Section icon={<UserRound className="h-5 w-5" aria-hidden />} title="Who is the candidate?"
            hint="Name, and how RMG and the interviews reach them"
            accent="from-brand-500 to-violet-600" done={!!(form.name.trim() && form.email.trim() && form.phone.trim())}>
            <Field label="Candidate name" htmlFor="edit-name" required error={nameErr} wide>
              <input id="edit-name" className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)}
                autoComplete="off" aria-invalid={!!nameErr} />
            </Field>
            <Field label="Email" htmlFor="edit-email">
              <input id="edit-email" className={inputCls} type="email" value={form.email}
                onChange={(e) => set("email", e.target.value)} placeholder="name@example.com" autoComplete="off" />
            </Field>
            <Field label="Phone">
              <PhoneField value={form.phone} onChange={(v) => set("phone", v)} />
            </Field>
            {!profileOnly && (
              <Field label="Where did you find them?" wide>
                <Chips options={SOURCE_PORTALS} value={form.source} onPick={(v) => set("source", v)} label="Source portal" />
              </Field>
            )}
          </Section>

          <Section icon={<Briefcase className="h-5 w-5" aria-hidden />} title="Experience & availability"
            hint={band ? `This position looks for ${band}` : "How senior, and how soon they can join"}
            accent="from-sky-500 to-cyan-600" done={!!(form.experience.trim() && form.notice.trim())}>
            <Field label="Total experience" htmlFor="edit-exp">
              <div className="relative">
                <input id="edit-exp" className={`${inputCls} pr-12`} inputMode="decimal" value={form.experience}
                  onChange={(e) => set("experience", e.target.value)} placeholder="e.g. 4.5" />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-muted">yrs</span>
              </div>
              {band && Number.isFinite(years) && (
                <p className={`mt-1 text-xs font-semibold ${outOfBand ? "text-warning" : "text-success"}`}>
                  {outOfBand ? `Outside the ${band} band` : `Inside the ${band} band`}
                </p>
              )}
            </Field>
            <Field label="Notice period" htmlFor="edit-notice">
              <input id="edit-notice" className={inputCls} value={form.notice}
                onChange={(e) => set("notice", e.target.value)} placeholder="e.g. 30 days" />
              <Chips options={NOTICE_CHIPS} value={form.notice} onPick={(v) => set("notice", v)} label="Notice period" />
            </Field>
            <Field label="Technical domain" htmlFor="edit-domain" wide>
              <input id="edit-domain" className={inputCls} value={form.domain}
                onChange={(e) => set("domain", e.target.value)} placeholder="e.g. Embedded / AUTOSAR · Backend · Data" />
            </Field>
          </Section>

          <Section icon={<IndianRupee className="h-5 w-5" aria-hidden />} title="Compensation"
            hint={budget != null ? `Budget for this position: up to ${lakhs(budget)}` : "Current and expected, in LPA"}
            accent="from-emerald-500 to-teal-600" done={!!(form.currentCtc.trim() && form.expectedCtc.trim())}>
            <Field label="Current CTC" htmlFor="edit-cur">{lpa("edit-cur", "currentCtc", "e.g. 12")}</Field>
            <Field label="Expected CTC" htmlFor="edit-exp-ctc">{lpa("edit-exp-ctc", "expectedCtc", "e.g. 18")}</Field>
            {(hike != null || overBudget) && (
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                {hike != null && (
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
                    hike > 50 ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                      : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"}`}>
                    <Banknote className="h-3.5 w-3.5" aria-hidden /> {hike >= 0 ? "+" : ""}{hike}% hike asked
                  </span>
                )}
                {overBudget && budget != null && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                    Over the {lakhs(budget)} budget
                  </span>
                )}
              </div>
            )}
          </Section>

          <Section icon={<MapPin className="h-5 w-5" aria-hidden />} title="Location"
            hint="Where they are today and where they will work"
            accent="from-orange-500 to-rose-500" done={!!(form.currentLocation.trim() && form.preferredLocation.trim())}>
            <Field label="Current location" htmlFor="edit-cloc">
              <input id="edit-cloc" className={inputCls} value={form.currentLocation}
                onChange={(e) => set("currentLocation", e.target.value)} placeholder="e.g. Pune" />
            </Field>
            <Field label="Preferred location" htmlFor="edit-ploc">
              <input id="edit-ploc" className={inputCls} value={form.preferredLocation}
                onChange={(e) => set("preferredLocation", e.target.value)} placeholder="e.g. Bangalore" />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {form.currentLocation.trim() && form.preferredLocation.trim() !== form.currentLocation.trim() && (
                  <button type="button" className="rounded-full border border-subtle bg-surface-2 px-2.5 py-1 text-xs font-semibold text-secondary hover:border-brand-500 hover:text-primary"
                    onClick={() => set("preferredLocation", form.currentLocation.trim())}>
                    Same as current
                  </button>
                )}
                {req.location_name && form.preferredLocation.trim() !== req.location_name && (
                  <button type="button" className="rounded-full border border-subtle bg-surface-2 px-2.5 py-1 text-xs font-semibold text-secondary hover:border-brand-500 hover:text-primary"
                    onClick={() => set("preferredLocation", req.location_name as string)}>
                    Job location: {req.location_name}
                  </button>
                )}
              </div>
            </Field>
          </Section>

          {!profileOnly && (
            <Section icon={<FileText className="h-5 w-5" aria-hidden />} title="From the resume"
              hint="Read from the CV — correct them if the parser got something wrong"
              accent="from-purple-500 to-indigo-600" done={!!(form.education.trim() && form.skills.trim())}>
              <Field label="Highest education" htmlFor="edit-edu">
                <input id="edit-edu" className={inputCls} value={form.education}
                  onChange={(e) => set("education", e.target.value)} placeholder="e.g. B.Tech, Computer Science" />
              </Field>
              <Field label="Key skills" htmlFor="edit-skills">
                <input id="edit-skills" className={inputCls} value={form.skills}
                  onChange={(e) => set("skills", e.target.value)} placeholder="e.g. C, AUTOSAR, CAN, Python" />
              </Field>
            </Section>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
          <div className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
            <div className="flex items-center gap-3">
              <StrengthRing pct={pct} />
              <div className="min-w-0">
                <p className="text-sm font-bold text-primary">{strengthWord(pct)}</p>
                <p className="text-xs text-muted">{filledCore} of {core.length} key details recorded</p>
              </div>
            </div>
            <ul className="mt-3 space-y-1.5 text-xs">
              {core.map((k) => {
                const done = !!form[k].trim();
                return (
                  <li key={k} className={`flex items-center gap-2 ${done ? "text-secondary" : "text-muted"}`}>
                    {done ? <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden /> : <Circle className="h-3.5 w-3.5" aria-hidden />}
                    <span>{EDIT_LABEL[k]}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted">What changed</p>
            {changed.length === 0 ? (
              <p className="mt-1.5 text-xs text-muted">Nothing yet — edit a field and it appears here.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {changed.map((k) => (
                  <li key={k} className="text-xs">
                    <span className="font-semibold text-primary">{EDIT_LABEL[k]}</span>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-rose-50 px-1.5 py-px text-rose-700 line-through dark:bg-rose-950/40 dark:text-rose-300">
                        {initial[k].trim() || "empty"}
                      </span>
                      <span className="text-muted">→</span>
                      <span className="rounded bg-emerald-50 px-1.5 py-px font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        {form[k].trim() || "empty"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted">The position</p>
            <p className="mt-1 text-sm font-bold text-primary">{req.title}</p>
            {req.customer_name && <p className="text-xs text-secondary">{req.customer_name}</p>}
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {band && (<><dt className="text-muted">Experience</dt><dd className="font-semibold text-primary">{band}</dd></>)}
              {budget != null && (<><dt className="text-muted">Budget</dt><dd className="font-semibold text-primary">up to {lakhs(budget)}</dd></>)}
              {req.location_name && (<><dt className="text-muted">Location</dt><dd className="font-semibold text-primary">{req.location_name}</dd></>)}
            </dl>
          </div>
        </aside>
      </form>
    </Modal>
  );
}
