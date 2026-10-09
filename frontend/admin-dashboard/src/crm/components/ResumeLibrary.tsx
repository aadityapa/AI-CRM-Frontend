/**
 * Resume library + matching positions + multi-apply (9 Oct 2026).
 *
 * TA's ask: "a candidate suitable for many positions — keep more than one
 * resume, show which of our open positions each resume fits, and apply in one
 * go". Server half: `services/candidate_resumes.py` +
 * `routers/crm/candidate_resumes.py`.
 *
 *   ResumeLibraryTab        every version (seeded from the CV + every resume
 *                           uploaded for a position), add · rename · make main
 *   MatchingPositionsTab    every open position scored against every version;
 *                           ≥ 60 % reads "Good fit"; the AI review on a click;
 *                           tick positions → apply with the version picked
 *   MultiApplyDialog        the confirm step, results per position
 *
 * Only TA applies and asks the AI (user decision); everyone with the
 * candidate's page can read the matches.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Briefcase,
  CheckCircle2,
  FileText,
  Loader2,
  MapPin,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Wallet,
  XCircle,
} from "lucide-react";

import { crmDelete, crmGet, crmPatch, crmPost, crmUpload } from "../api";
import { CrmLink } from "../router";
import { FileLink } from "./FileUpload";
import { ScoreIndicator } from "./ScoreIndicator";
import { DialogActions, DialogFailure, DialogHero, DialogSection, ReasonBox } from "./dialogKit";
import { ErrorBox, Modal, Spinner, btnSecondary, focusRing } from "./ui";

export type ResumeVersion = {
  id: number;
  file_url: string;
  original_filename?: string | null;
  label: string;
  source?: string | null;
  is_primary: boolean;
  file_size?: number | null;
  uploaded_by_name?: string | null;
  created_at?: string | null;
  has_text?: boolean;
};

type BestMatch = {
  resume_id: number;
  label: string;
  score: number;
  skills_matched: string[];
  skills_missing: string[];
  jd_matched: string[];
  experience_match?: boolean | null;
};

type AiReview = {
  score: number;
  keyword_score: number;
  ai_score: number;
  summary?: string | null;
  strengths?: string[];
  gaps?: string[];
  at?: string;
  by?: string;
};

export type MatchRow = {
  requirement_id: number;
  req_number: string;
  title: string;
  opportunity_id: number;
  opp_id?: string | null;
  opportunity_title?: string | null;
  customer_name?: string | null;
  location?: string | null;
  experience_min?: number | null;
  experience_max?: number | null;
  budget_ctc_min?: number | null;
  budget_ctc_max?: number | null;
  priority?: string | null;
  positions?: number;
  mandatory_skills: string[];
  jd_source?: string | null;
  scorable: boolean;
  best: BestMatch | null;
  scores: { resume_id: number; score: number }[];
  good_fit: boolean;
  experience_fit?: boolean | null;
  over_budget?: boolean;
  applied: { profile_id: number; status?: string | null; tone?: string | null; applied_by?: string | null; applied_on?: string | null } | null;
  ai_reviews: Record<string, AiReview>;
};

type MatchMeta = {
  versions: ResumeVersion[];
  unreadable: number[];
  good_fit_pct: number;
  summary: { positions: number; good_fit: number; applied: number };
};

const lakh = (v?: number | null) => (v == null ? null : `${(v / 100000).toFixed(v >= 1000000 ? 1 : 2).replace(/\.0+$/, "")} L`);
const band = (a?: number | null, b?: number | null) =>
  a == null && b == null ? null : `${a ?? "?"}–${b ?? "?"} yrs`;
const fmtSize = (n?: number | null) => (n ? (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`) : null);

const SOURCE_LABEL: Record<string, string> = { cv: "CV on record", application: "From an application", upload: "Added here" };

/* ================================================================== library */

export function ResumeLibraryTab({ candidateId, canWrite, onChanged, notify }: {
  candidateId: number | string;
  canWrite: boolean;
  onChanged?: () => void;
  notify: (msg: string, kind?: "ok" | "err") => void;
}) {
  const [rows, setRows] = useState<ResumeVersion[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | "upload" | null>(null);
  const [label, setLabel] = useState("");
  const [makeMain, setMakeMain] = useState(false);
  const [editing, setEditing] = useState<{ id: number; label: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(() => {
    setError("");
    crmGet<ResumeVersion[]>(`/api/candidates/${candidateId}/resume-library`)
      .then((r) => setRows(r.data || []))
      .catch((e: any) => setError(e?.message || "Could not load the resumes"));
  }, [candidateId]);
  useEffect(() => { load(); }, [load]);

  const upload = async (file: File) => {
    setBusy("upload");
    try {
      const res = await crmUpload(`/api/candidates/${candidateId}/resume-library`, file,
        { label: label.trim(), make_primary: makeMain ? "true" : "false" });
      notify(res.message || "Resume added");
      setLabel("");
      setMakeMain(false);
      load();
      onChanged?.();
    } catch (e: any) {
      notify(e?.message || "Upload failed", "err");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const patch = async (v: ResumeVersion, body: Record<string, unknown>, ok: string) => {
    setBusy(v.id);
    try {
      await crmPatch(`/api/candidates/${candidateId}/resume-library/${v.id}`, body);
      notify(ok);
      setEditing(null);
      load();
      onChanged?.();
    } catch (e: any) {
      notify(e?.message || "Could not update the resume", "err");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (v: ResumeVersion) => {
    if (!window.confirm(`Remove “${v.label}” from the library? Applications that used it keep their copy.`)) return;
    setBusy(v.id);
    try {
      await crmDelete(`/api/candidates/${candidateId}/resume-library/${v.id}`);
      notify("Resume removed");
      load();
    } catch (e: any) {
      notify(e?.message || "Could not remove it", "err");
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!rows) return <Spinner label="Loading resumes…" />;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-sky-600 via-indigo-600 to-purple-600 px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/30" aria-hidden>
              <FileText size={20} />
            </span>
            <div>
              <h2 className="text-base font-bold">Resume library</h2>
              <p className="text-xs text-white/85">
                {rows.length} version{rows.length === 1 ? "" : "s"} — the <span className="font-semibold">main</span> one is the candidate's CV everywhere else.
              </p>
            </div>
          </div>
          <CrmLink to={`candidates/${candidateId}?tab=matching`}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#fff] px-3 text-xs font-bold text-[#1d4ed8] shadow">
            <Sparkles size={14} aria-hidden /> See matching positions
          </CrmLink>
        </div>
        {canWrite && (
          <div className="flex flex-wrap items-end gap-3 border-b border-subtle bg-surface-2 px-5 py-3">
            <label className="min-w-[14rem] flex-1 text-xs font-semibold text-secondary">
              Name this version
              <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120}
                placeholder="e.g. AUTOSAR version, BLE version"
                className="mt-1 h-10 w-full rounded-control border border-subtle bg-surface-1 px-3 text-sm text-primary" />
            </label>
            <label className="inline-flex h-10 items-center gap-2 text-xs font-semibold text-secondary">
              <input type="checkbox" checked={makeMain} onChange={(e) => setMakeMain(e.target.checked)} />
              Make it the main resume
            </label>
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
            <button type="button" disabled={busy === "upload"} onClick={() => fileRef.current?.click()}
              className={`inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 text-sm font-semibold text-white shadow-md disabled:opacity-60 ${focusRing}`}>
              {busy === "upload" ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {busy === "upload" ? "Uploading…" : "Add a resume"}
            </button>
          </div>
        )}
        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted">No resume on file yet — add the first one above.</div>
        ) : (
          <ul className="divide-y divide-subtle">
            {rows.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white ${
                  v.is_primary ? "bg-gradient-to-br from-amber-400 to-orange-500" : "bg-gradient-to-br from-slate-400 to-slate-600"}`} aria-hidden>
                  {v.is_primary ? <Star size={18} /> : <FileText size={18} />}
                </span>
                <div className="min-w-0 flex-1">
                  {editing?.id === v.id ? (
                    <form className="flex flex-wrap items-center gap-2"
                      onSubmit={(e) => { e.preventDefault(); void patch(v, { label: editing.label }, "Renamed"); }}>
                      <input value={editing.label} onChange={(e) => setEditing({ id: v.id, label: e.target.value })} maxLength={120}
                        className="h-9 min-w-[12rem] flex-1 rounded-control border border-subtle bg-surface-1 px-2 text-sm text-primary" />
                      <button type="submit" className={btnSecondary}>Save</button>
                      <button type="button" className={btnSecondary} onClick={() => setEditing(null)}>Cancel</button>
                    </form>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-bold text-primary">{v.label}</span>
                      {v.is_primary && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200">Main</span>}
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-secondary ring-1 ring-inset ring-subtle">
                        {SOURCE_LABEL[v.source || ""] || "Resume"}
                      </span>
                      {v.has_text === false && <span className="text-[11px] text-amber-700 dark:text-amber-300">Not yet read</span>}
                    </div>
                  )}
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                    {v.original_filename && <span className="truncate">{v.original_filename}</span>}
                    {fmtSize(v.file_size) && <span>{fmtSize(v.file_size)}</span>}
                    {v.uploaded_by_name && <span>by {v.uploaded_by_name}</span>}
                    {v.created_at && <span>{new Date(v.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <FileLink url={v.file_url} label="View" />
                  {canWrite && !v.is_primary && (
                    <button type="button" disabled={busy === v.id} onClick={() => patch(v, { primary: true }, `“${v.label}” is now the main resume`)}
                      className="inline-flex h-8 items-center gap-1 rounded-lg bg-amber-50 px-2.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800">
                      <Star size={13} /> Make main
                    </button>
                  )}
                  {canWrite && editing?.id !== v.id && (
                    <button type="button" onClick={() => setEditing({ id: v.id, label: v.label })} title="Rename"
                      className="inline-flex h-8 items-center gap-1 rounded-lg bg-teal-50 px-2.5 text-xs font-semibold text-teal-800 ring-1 ring-inset ring-teal-200 hover:bg-teal-100 dark:bg-teal-950 dark:text-teal-200 dark:ring-teal-800">
                      <Pencil size={13} /> Rename
                    </button>
                  )}
                  {canWrite && !v.is_primary && (
                    <button type="button" disabled={busy === v.id} onClick={() => remove(v)} title="Remove from the library"
                      className="inline-flex h-8 items-center gap-1 rounded-lg bg-rose-50 px-2.5 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200 hover:bg-rose-100 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-800">
                      <Trash2 size={13} /> Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ================================================================== matching */

function fitTone(score: number | null | undefined, goodPct: number) {
  if (score == null) return "text-muted";
  if (score >= goodPct) return "text-emerald-700 dark:text-emerald-300";
  if (score >= goodPct - 15) return "text-amber-700 dark:text-amber-300";
  return "text-rose-700 dark:text-rose-300";
}

export function MatchingPositionsTab({ candidateId, candidateName, isTa, notify, onApplied }: {
  candidateId: number | string;
  candidateName: string;
  isTa: boolean;
  notify: (msg: string, kind?: "ok" | "err") => void;
  onApplied?: () => void;
}) {
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [meta, setMeta] = useState<MatchMeta | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [goodOnly, setGoodOnly] = useState(false);
  const [hideApplied, setHideApplied] = useState(false);
  const [picked, setPicked] = useState<Record<number, number | null>>({});
  const [aiBusy, setAiBusy] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);

  const load = useCallback(() => {
    setError("");
    setRows(null);
    crmGet<MatchRow[]>(`/api/candidates/${candidateId}/matching-positions`)
      .then((r) => { setRows(r.data || []); setMeta((r.meta || null) as MatchMeta | null); })
      .catch((e: any) => setError(e?.message || "Could not score the positions"));
  }, [candidateId]);
  useEffect(() => { load(); }, [load]);

  const goodPct = meta?.good_fit_pct ?? 60;
  const versions = meta?.versions || [];
  const versionLabel = (id?: number | null) => versions.find((v) => v.id === id)?.label || "Main resume";

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (rows || []).filter((r) => {
      if (goodOnly && !r.good_fit) return false;
      if (hideApplied && r.applied) return false;
      if (!words.length) return true;
      const hay = [r.title, r.req_number, r.opp_id, r.customer_name, r.location, ...(r.mandatory_skills || [])]
        .filter(Boolean).join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [rows, q, goodOnly, hideApplied]);

  const toggle = (r: MatchRow) => {
    setPicked((p) => {
      const next = { ...p };
      if (r.requirement_id in next) delete next[r.requirement_id];
      else next[r.requirement_id] = r.best?.resume_id ?? null;
      return next;
    });
  };

  const runAi = async (r: MatchRow) => {
    const resumeId = picked[r.requirement_id] ?? r.best?.resume_id;
    if (!resumeId) return;
    setAiBusy(r.requirement_id);
    try {
      const res = await crmPost<AiReview>(`/api/candidates/${candidateId}/matching-positions/${r.requirement_id}/ai-review`,
        { resume_id: resumeId });
      setRows((rs) => (rs || []).map((x) => x.requirement_id === r.requirement_id
        ? { ...x, ai_reviews: { ...x.ai_reviews, [String(resumeId)]: res.data } } : x));
      setOpen(r.requirement_id);
    } catch (e: any) {
      notify(e?.message || "AI review failed", "err");
    } finally {
      setAiBusy(null);
    }
  };

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!rows) return <Spinner label="Scoring every open position against each resume…" />;

  const pickedRows = (rows || []).filter((r) => r.requirement_id in picked);
  const s = meta?.summary;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="relative bg-gradient-to-r from-emerald-600 via-teal-600 to-sky-600 px-5 py-4 text-white">
          <span aria-hidden className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-white/10" />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold">Matching positions</h2>
              <p className="text-xs text-white/85">
                Every open position, scored against {versions.length || 1} resume{versions.length === 1 ? "" : "s"} with the ATS. {goodPct}%+ is a good fit.
              </p>
            </div>
            <button type="button" onClick={load} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/15 px-3 text-xs font-bold ring-1 ring-white/30 hover:bg-white/25">
              <RefreshCw size={14} aria-hidden /> Re-score
            </button>
          </div>
          <div className="relative mt-3 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-white/15 px-3 py-1 ring-1 ring-white/25">{s?.positions ?? rows.length} open positions</span>
            <span className="rounded-full bg-[#fff] px-3 py-1 text-[#047857]">{s?.good_fit ?? 0} good fits to apply</span>
            <span className="rounded-full bg-white/15 px-3 py-1 ring-1 ring-white/25">{s?.applied ?? 0} already applied</span>
            {meta?.unreadable?.length ? (
              <span className="rounded-full bg-amber-300/30 px-3 py-1 ring-1 ring-amber-100/40">
                {meta.unreadable.length} resume{meta.unreadable.length === 1 ? "" : "s"} could not be read
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-subtle bg-surface-2 px-5 py-2.5">
          <label className="relative min-w-[12rem] flex-1 sm:max-w-xs">
            <span className="sr-only">Search positions</span>
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search position, customer, skill…"
              className="h-9 w-full rounded-control border border-subtle bg-surface-1 pl-8 pr-2 text-sm text-primary" />
          </label>
          <button type="button" aria-pressed={goodOnly} onClick={() => setGoodOnly((v) => !v)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold ring-1 ring-inset ${goodOnly ? "bg-emerald-600 text-white ring-emerald-600" : "bg-surface-1 text-secondary ring-subtle"}`}>
            Good fits only
          </button>
          <button type="button" aria-pressed={hideApplied} onClick={() => setHideApplied((v) => !v)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold ring-1 ring-inset ${hideApplied ? "bg-indigo-600 text-white ring-indigo-600" : "bg-surface-1 text-secondary ring-subtle"}`}>
            Hide applied
          </button>
          <span className="ml-auto text-xs text-muted tabular-nums">{shown.length} of {rows.length}</span>
        </div>

        {shown.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted">
            {rows.length ? "Nothing matches these filters." : "No position is open for sourcing right now."}
          </div>
        ) : (
          <ul className="divide-y divide-subtle">
            {shown.map((r) => {
              const isPicked = r.requirement_id in picked;
              const chosen = isPicked ? picked[r.requirement_id] : r.best?.resume_id;
              const chosenScore = r.scores.find((x) => x.resume_id === chosen)?.score ?? r.best?.score ?? null;
              const review = chosen != null ? r.ai_reviews?.[String(chosen)] : undefined;
              const expanded = open === r.requirement_id;
              return (
                <li key={r.requirement_id} className={`px-5 py-3 transition-colors ${isPicked ? "bg-emerald-50/70 dark:bg-emerald-950" : ""}`}>
                  <div className="flex flex-wrap items-start gap-3">
                    {isTa && !r.applied && r.scorable ? (
                      <input type="checkbox" checked={isPicked} onChange={() => toggle(r)} aria-label={`Select ${r.title}`}
                        className="mt-3 h-4 w-4 accent-emerald-600" />
                    ) : <span className="w-4" aria-hidden />}
                    <div className="pt-1"><ScoreIndicator score={r.scorable ? chosenScore : null} size="md" showLabel={false} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-primary">{r.title}</span>
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-secondary ring-1 ring-inset ring-subtle">{r.opp_id || r.req_number}</span>
                        {r.good_fit && !r.applied && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">Good fit</span>}
                        {r.priority === "High" && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-200">High priority</span>}
                        {r.applied && (
                          <CrmLink to={`profiles/${r.applied.profile_id}`}
                            className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-800 hover:underline dark:bg-indigo-950 dark:text-indigo-200">
                            Applied{r.applied.status ? ` · ${r.applied.status}` : ""}{r.applied.applied_by ? ` · by ${r.applied.applied_by}` : ""}
                          </CrmLink>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                        {r.customer_name && <span className="inline-flex items-center gap-1"><Briefcase size={12} aria-hidden /> {r.customer_name}</span>}
                        {r.location && <span className="inline-flex items-center gap-1"><MapPin size={12} aria-hidden /> {r.location}</span>}
                        {band(r.experience_min, r.experience_max) && (
                          <span className={r.experience_fit === false ? "font-semibold text-amber-700 dark:text-amber-300" : ""}>
                            {band(r.experience_min, r.experience_max)}{r.experience_fit === false ? " · outside the band" : ""}
                          </span>
                        )}
                        {r.budget_ctc_max != null && (
                          <span className={`inline-flex items-center gap-1 ${r.over_budget ? "font-semibold text-rose-700 dark:text-rose-300" : ""}`}>
                            <Wallet size={12} aria-hidden /> up to {lakh(r.budget_ctc_max)}{r.over_budget ? " · expects more" : ""}
                          </span>
                        )}
                      </div>
                      {r.scorable ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                          <span className={`font-semibold ${fitTone(chosenScore, goodPct)}`}>
                            {Math.round(chosenScore ?? 0)}% with “{versionLabel(chosen)}”
                          </span>
                          {(r.best?.skills_matched || []).slice(0, 6).map((sk) => (
                            <span key={sk} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800">{sk}</span>
                          ))}
                          {(r.best?.skills_missing || []).slice(0, 4).map((sk) => (
                            <span key={sk} className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-800">no {sk}</span>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-1.5 text-xs text-muted">This position has no skills or JD to score against yet.</p>
                      )}
                      {versions.length > 1 && r.scorable && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                          <span>Each resume:</span>
                          {r.scores.map((x) => (
                            <span key={x.resume_id} className={`rounded-full px-2 py-0.5 ring-1 ring-inset ring-subtle ${x.resume_id === r.best?.resume_id ? "bg-emerald-50 font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-surface-2"}`}>
                              {versionLabel(x.resume_id)} {Math.round(x.score)}%
                            </span>
                          ))}
                        </div>
                      )}
                      {review && expanded && (
                        <div className="mt-2 rounded-card border border-purple-200 bg-purple-50 p-3 text-xs dark:border-purple-800 dark:bg-purple-950">
                          <div className="flex flex-wrap items-center gap-2 font-bold text-purple-800 dark:text-purple-200">
                            <Sparkles size={13} aria-hidden /> AI review: {Math.round(review.score)}%
                            <span className="font-normal text-purple-700 dark:text-purple-300">(keyword {Math.round(review.keyword_score)}% · AI {Math.round(review.ai_score)}%{review.by ? ` · by ${review.by}` : ""})</span>
                          </div>
                          {review.summary && <p className="mt-1 text-secondary">{review.summary}</p>}
                          <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                            {review.strengths?.length ? (
                              <ul className="space-y-0.5">{review.strengths.map((t) => <li key={t} className="flex gap-1"><CheckCircle2 size={12} className="mt-0.5 shrink-0 text-emerald-600" />{t}</li>)}</ul>
                            ) : null}
                            {review.gaps?.length ? (
                              <ul className="space-y-0.5">{review.gaps.map((t) => <li key={t} className="flex gap-1"><XCircle size={12} className="mt-0.5 shrink-0 text-rose-600" />{t}</li>)}</ul>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {isTa && isPicked && versions.length > 1 && (
                        <select aria-label="Resume to send" value={picked[r.requirement_id] ?? ""}
                          onChange={(e) => setPicked((p) => ({ ...p, [r.requirement_id]: Number(e.target.value) }))}
                          className="h-8 max-w-[12rem] rounded-control border border-subtle bg-surface-1 px-2 text-xs text-primary">
                          {r.scores.map((x) => <option key={x.resume_id} value={x.resume_id}>{versionLabel(x.resume_id)} · {Math.round(x.score)}%</option>)}
                        </select>
                      )}
                      {review ? (
                        <button type="button" onClick={() => setOpen(expanded ? null : r.requirement_id)}
                          className="inline-flex h-8 items-center gap-1 rounded-lg bg-purple-50 px-2.5 text-xs font-semibold text-purple-800 ring-1 ring-inset ring-purple-200 dark:bg-purple-950 dark:text-purple-200 dark:ring-purple-800">
                          <Sparkles size={13} /> {expanded ? "Hide AI review" : `AI ${Math.round(review.score)}%`}
                        </button>
                      ) : isTa && r.scorable ? (
                        <button type="button" disabled={aiBusy === r.requirement_id} onClick={() => runAi(r)}
                          title="A deeper AI read of this resume against this position (costs a little; kept for next time)"
                          className="inline-flex h-8 items-center gap-1 rounded-lg bg-purple-50 px-2.5 text-xs font-semibold text-purple-800 ring-1 ring-inset ring-purple-200 hover:bg-purple-100 disabled:opacity-60 dark:bg-purple-950 dark:text-purple-200 dark:ring-purple-800">
                          {aiBusy === r.requirement_id ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} AI review
                        </button>
                      ) : null}
                      <CrmLink to={`requirements/${r.requirement_id}`}
                        className="inline-flex h-8 items-center rounded-lg bg-sky-50 px-2.5 text-xs font-semibold text-sky-800 ring-1 ring-inset ring-sky-200 hover:bg-sky-100 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800">
                        Open
                      </CrmLink>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {isTa && pickedRows.length > 0 && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-card border border-emerald-300 bg-surface-1 px-4 py-3 shadow-overlay dark:border-emerald-800">
          <span className="text-sm font-semibold text-primary">{pickedRows.length} position{pickedRows.length === 1 ? "" : "s"} selected</span>
          <button type="button" className={btnSecondary} onClick={() => setPicked({})}>Clear</button>
          <button type="button" onClick={() => setApplyOpen(true)}
            className={`ml-auto inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 text-sm font-semibold text-white shadow-md ${focusRing}`}>
            <Send size={15} /> Apply to {pickedRows.length} position{pickedRows.length === 1 ? "" : "s"}
          </button>
        </div>
      )}

      {applyOpen && (
        <MultiApplyDialog
          candidateId={candidateId}
          candidateName={candidateName}
          items={pickedRows.map((r) => ({ row: r, resumeId: picked[r.requirement_id] ?? r.best?.resume_id ?? null }))}
          versionLabel={versionLabel}
          onClose={() => setApplyOpen(false)}
          onDone={(msg) => {
            setApplyOpen(false);
            setPicked({});
            notify(msg);
            load();
            onApplied?.();
          }}
        />
      )}
    </div>
  );
}

/* ================================================================== apply */

type ApplyResult = { requirement_id: number; position: string; ok: boolean; profile_id?: number; resume?: string | null; message?: string };

export function MultiApplyDialog({ candidateId, candidateName, items, versionLabel, onClose, onDone }: {
  candidateId: number | string;
  candidateName: string;
  items: { row: MatchRow; resumeId: number | null }[];
  versionLabel: (id?: number | null) => string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<ApplyResult[] | null>(null);
  const [message, setMessage] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await crmPost<ApplyResult[]>(`/api/candidates/${candidateId}/multi-apply`, {
        items: items.map((i) => ({ requirement_id: i.row.requirement_id, resume_id: i.resumeId })),
        note: note.trim() || null,
      });
      setResults(res.data || []);
      setMessage(res.message || "Done");
    } catch (e: any) {
      setError(e?.message || "Could not apply");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Apply to several positions"
      onClose={results ? () => onDone(message) : onClose}
      medium
      hero={
        <DialogHero tone="emerald" icon={Send} eyebrow="Resume library" title={`Apply to ${items.length} position${items.length === 1 ? "" : "s"}`}
          subtitle="Each application starts at Sourcing with the resume you picked; the ATS scores it straight away."
          person={{ name: candidateName }}
          flow={{ steps: ["Pick positions", "Apply", "Sourcing", "Technical Screening"], current: 1 }} />
      }
      footer={results ? (
        <div className="flex justify-end">
          <button type="button" className={btnSecondary} onClick={() => onDone(message)}>Done</button>
        </div>
      ) : (
        <DialogActions onCancel={onClose} busy={busy} tone="emerald" icon={Send}
          label={`Apply to ${items.length}`} busyLabel="Applying…" onConfirm={submit}
          hint="A position this candidate is already in is skipped — nothing is duplicated." />
      )}
    >
      <div className="space-y-4 p-1">
        {results ? (
          <section className="space-y-2">
            <p className="text-sm font-bold text-primary">{message}</p>
            {results.map((r) => (
              <div key={r.requirement_id} className={`flex items-start gap-2 rounded-card border p-3 text-sm ${
                r.ok ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950" : "border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-950"}`}>
                {r.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" /> : <XCircle size={16} className="mt-0.5 shrink-0 text-rose-600" />}
                <div className="min-w-0">
                  <div className="font-semibold text-primary">{r.position}</div>
                  <div className="text-xs text-secondary">
                    {r.ok ? <>Applied{r.resume ? ` with “${r.resume}”` : ""} · <CrmLink to={`profiles/${r.profile_id}`} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">open profile</CrmLink></> : r.message}
                  </div>
                </div>
              </div>
            ))}
          </section>
        ) : (
          <>
            <DialogSection n={1} title="Positions and the resume each one gets" tone="emerald" done>
              <ul className="space-y-2">
                {items.map(({ row, resumeId }) => {
                  const sc = row.scores.find((x) => x.resume_id === resumeId)?.score ?? row.best?.score ?? null;
                  return (
                    <li key={row.requirement_id} className="flex items-center gap-3 rounded-control border border-subtle bg-surface-2 px-3 py-2">
                      <ScoreIndicator score={sc} size="sm" showLabel={false} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-primary">{row.title}</div>
                        <div className="truncate text-xs text-muted">{[row.opp_id, row.customer_name, row.location].filter(Boolean).join(" · ")}</div>
                      </div>
                      <span className="shrink-0 rounded-full bg-surface-1 px-2 py-0.5 text-[11px] font-semibold text-secondary ring-1 ring-inset ring-subtle">{versionLabel(resumeId)}</span>
                    </li>
                  );
                })}
              </ul>
            </DialogSection>
            <DialogSection n={2} title="Note for the activity log" tone="emerald" optional>
              <ReasonBox id="multiApplyNote" label="Note" value={note} onChange={setNote} max={2000} tone="emerald"
                placeholder="e.g. Strong BLE + AUTOSAR background — fits both openings"
                picks={["Strong match on the mandatory skills", "Candidate interested in all these roles", "Referred internally"]} />
            </DialogSection>
            <DialogFailure message={error} />
          </>
        )}
      </div>
    </Modal>
  );
}
