/**
 * ATS breakdown pop-up (1 Oct 2026, user ask: "design this page as best as —
 * open as a pop-up but show everything in it").
 *
 * It used to be a full-page takeover (`Modal wide fullScreen` + the wizard
 * shell). Now an `xl` dialog on the dialog kit: a purple hero with the score
 * ring and the three sub-scores as chips, then the facts — the two coverage
 * bars, the AI reviewer's assessment (strengths · gaps), the skills and JD
 * terms as chips, and the other checks. Nothing computed here: every number
 * is the server's `ats_score_breakdown` (`services/ats_scoring.py`).
 */
import type { ReactNode } from "react";
import { AlertTriangle, Bot, Check, ExternalLink, FileText, ScanLine, Sparkles, X } from "lucide-react";

import { Modal, btnPrimary, btnSecondary } from "./ui";
import { DialogHero } from "./dialogKit";
import { ScoreIndicator } from "./ScoreIndicator";
import { FileLink } from "./FileUpload";

export type AtsBreakdown = {
  skills_matched?: string[];
  skills_missing?: string[];
  jd_keywords_matched?: string[];
  jd_keywords_missing?: string[];
  experience_match?: boolean;
  jd_text_preview?: string;
  score_details?: Record<string, unknown>;
  ai_review?: {
    match_percent?: number;
    summary?: string;
    strengths?: string[];
    gaps?: string[];
    model?: string;
  } | null;
};

export type AtsBreakdownRow = {
  candidate_name: string;
  ats_score?: number | null;
  ats_score_breakdown?: AtsBreakdown | null;
  resume_file_url?: string | null;
  applicant_experience?: string | null;
  profile_id?: number | null;
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || v === "" || !Number.isFinite(n) ? null : n;
};

function Stat({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: "good" | "bad" | "warn"; hint?: string }) {
  const color = tone === "good" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "bad" ? "text-rose-600 dark:text-rose-400"
      : tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-primary";
  return (
    <div className="rounded-card border border-subtle bg-surface-1 px-3 py-2.5" title={hint}>
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 text-sm font-bold ${color}`}>{value}</div>
    </div>
  );
}

function Bar({ label, hit, total, hint }: { label: string; hit: number; total: number; hint?: string }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (hit / total) * 100)) : 0;
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-secondary">{label}{hint && <span className="ml-1 font-normal text-muted">· {hint}</span>}</span>
        <span className="font-bold tabular-nums text-primary">{hit}/{total} · {Math.round(pct)}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full transition-[width] duration-panel ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Chips({ items, tone, max = 40 }: { items: string[]; tone: "good" | "bad" | "muted"; max?: number }) {
  if (!items.length) return <span className="text-sm text-muted">None</span>;
  const cls = tone === "good"
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
    : tone === "bad"
      ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
      : "bg-surface-2 text-secondary";
  const shown = items.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((s) => (
        <span key={s} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
          {tone === "good" ? <Check size={11} /> : tone === "bad" ? <X size={11} /> : null} {s}
        </span>
      ))}
      {items.length > shown.length && <span className="text-xs text-muted">+{items.length - shown.length} more</span>}
    </div>
  );
}

function Section({ title, icon: Icon, children, tone = "slate" }: { title: string; icon: typeof Check; children: ReactNode; tone?: "slate" | "indigo" }) {
  const box = tone === "indigo"
    ? "border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/30"
    : "border-subtle bg-surface-1";
  const head = tone === "indigo" ? "text-indigo-700 dark:text-indigo-300" : "text-muted";
  return (
    <section className={`rounded-card border p-4 ${box}`}>
      <h3 className={`mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide ${head}`}>
        <Icon size={14} aria-hidden /> {title}
      </h3>
      {children}
    </section>
  );
}

export function AtsBreakdownModal({ row, onClose, onOpenProfile }: {
  row: AtsBreakdownRow;
  onClose: () => void;
  /** Optional "Open profile" footer action. */
  onOpenProfile?: () => void;
}) {
  const b: AtsBreakdown = row.ats_score_breakdown || {};
  const matched = b.skills_matched || [];
  const missing = b.skills_missing || [];
  const jdMatched = b.jd_keywords_matched || [];
  const jdMissing = b.jd_keywords_missing || [];
  const d = (b.score_details || {}) as Record<string, unknown>;
  const ai = b.ai_review || null;
  const mandTotal = num(d.mandatory_total) ?? matched.length + missing.length;
  const mandHit = num(d.mandatory_matched) ?? matched.length;
  const jdTotal = num(d.jd_keywords_total) ?? jdMatched.length + jdMissing.length;
  const jdHit = num(d.jd_keywords_matched) ?? jdMatched.length;
  const detScore = num(d.deterministic_score);
  const aiScore = num(d.ai_semantic_score);
  const expYears = num(d.detected_experience_years);
  const eduFound = Array.isArray(d.education_keywords_found) ? (d.education_keywords_found as string[]) : [];
  const score = row.ats_score;
  const aiRan = ai && (ai.summary || (ai.strengths || []).length || (ai.gaps || []).length);
  const expLabel = b.experience_match
    ? `Match${expYears != null ? ` · ${expYears} yrs` : ""}`
    : expYears != null ? `${expYears} yrs — outside range` : "Not detected";

  const chip = (label: string, value: ReactNode) => (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff]/15 px-2.5 py-1 text-xs font-semibold text-[#fff] ring-1 ring-inset ring-[#fff]/25">
      <span className="opacity-80">{label}</span> {value}
    </span>
  );

  return (
    <Modal
      title={`ATS breakdown — ${row.candidate_name}`}
      xl
      onClose={onClose}
      hero={
        <DialogHero
          tone="purple"
          icon={ScanLine}
          eyebrow="ATS match"
          title={
            <span className="flex flex-wrap items-center gap-4">
              <span className="rounded-full bg-[#fff] p-1 shadow-raised"><ScoreIndicator score={score} size="lg" /></span>
              <span>
                <span className="block">{row.candidate_name}</span>
                <span className="block text-sm font-medium opacity-90">
                  {score != null ? `${score} / 100` : "Not scored"} against the position's JD and skills
                </span>
              </span>
            </span>
          }
          chips={
            <>
              {detScore != null && chip("Keyword / criteria", detScore)}
              {aiScore != null && chip("AI semantic fit", aiScore)}
              {chip("Experience", expLabel)}
              {typeof d.blend === "string" && chip("Blend", String(d.blend))}
            </>
          }
        />
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted">
            {ai?.model ? `AI review by ${ai.model}` : "Keyword / criteria score"}
            {typeof d.earned_points === "number" || typeof d.possible_points === "number"
              ? ` · ${d.earned_points ?? "—"} of ${d.possible_points ?? "—"} points` : ""}
          </span>
          <div className="flex gap-2">
            {row.resume_file_url && (
              <span className={`${btnSecondary} !py-1.5 text-xs`}><FileLink url={row.resume_file_url} label="Open resume" /></span>
            )}
            {onOpenProfile && (
              <button type="button" className={`${btnSecondary} !py-1.5 text-xs`} onClick={onOpenProfile}>
                <ExternalLink size={13} /> Open profile
              </button>
            )}
            <button type="button" className={`${btnPrimary} !py-1.5 text-xs`} onClick={onClose}>Close</button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {typeof d.ai_unavailable_reason === "string" && (
          <div className="flex items-start gap-2 rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              <strong className="font-semibold">Partial score.</strong> The AI semantic review did not run, so this is
              the keyword / criteria score only and under-rates a resume whose wording differs from the JD.{" "}
              <span className="opacity-80">{String(d.ai_unavailable_reason)}</span>
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Final score" value={score != null ? `${score} / 100` : "—"} />
          <Stat label="Required skills" value={mandTotal > 0 ? `${mandHit} of ${mandTotal}` : "None set"}
            tone={mandTotal === 0 ? undefined : mandHit === mandTotal ? "good" : mandHit === 0 ? "bad" : "warn"} />
          <Stat label="JD keywords" value={jdTotal > 0 ? `${jdHit} of ${jdTotal}` : "No JD"} tone={jdTotal > 0 ? (jdHit / jdTotal >= 0.5 ? "good" : "warn") : undefined} />
          <Stat label="Experience" value={expLabel} tone={b.experience_match ? "good" : expYears != null ? "bad" : "warn"} />
        </div>

        {(mandTotal > 0 || jdTotal > 0) ? (
          <Section title="Coverage" icon={Sparkles}>
            <div className="space-y-3">
              {mandTotal > 0 && <Bar label="Required skills matched" hit={mandHit} total={mandTotal} />}
              {jdTotal > 0 && <Bar label="JD keywords found in the resume" hit={jdHit} total={jdTotal} />}
            </div>
          </Section>
        ) : (
          <p className="rounded-card border border-dashed border-subtle px-3 py-2 text-sm text-muted">
            The position had no skills or JD to score against when this resume was scanned — add them under Details and the score refreshes.
          </p>
        )}

        {aiRan && (
          <Section title="AI reviewer assessment" icon={Bot} tone="indigo">
            {ai?.summary && <p className="text-sm leading-relaxed text-primary">{ai.summary}</p>}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(ai?.strengths || []).length > 0 && (
                <div className="rounded-card border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
                  <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Strengths</div>
                  <ul className="space-y-1 text-sm text-primary">
                    {(ai?.strengths || []).map((s, i) => (
                      <li key={i} className="flex items-start gap-1.5"><Check size={13} className="mt-0.5 shrink-0 text-emerald-500" /> {s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(ai?.gaps || []).length > 0 && (
                <div className="rounded-card border border-rose-200 bg-rose-50 p-3 dark:border-rose-800 dark:bg-rose-950/30">
                  <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-rose-700 dark:text-rose-300">Gaps</div>
                  <ul className="space-y-1 text-sm text-primary">
                    {(ai?.gaps || []).map((s, i) => (
                      <li key={i} className="flex items-start gap-1.5"><X size={13} className="mt-0.5 shrink-0 text-rose-500" /> {s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Section>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Section title={`Matched skills · ${matched.length}`} icon={Check}><Chips items={matched} tone="good" /></Section>
          <Section title={`Missing skills · ${missing.length}`} icon={X}><Chips items={missing} tone="bad" /></Section>
        </div>

        {(jdMatched.length > 0 || jdMissing.length > 0 || Boolean(d.jd_applied)) && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Section title={`JD terms found · ${jdMatched.length}`} icon={FileText}><Chips items={jdMatched} tone="good" /></Section>
            <Section title={`JD terms not found · ${jdMissing.length}`} icon={FileText}><Chips items={jdMissing} tone="muted" max={24} /></Section>
          </div>
        )}

        <Section title="Other checks" icon={ScanLine}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="All required skills" value={d.all_required_matched ? "Yes" : "No"} tone={d.all_required_matched ? "good" : "bad"} />
            <Stat label="Education" value={eduFound.length ? eduFound.slice(0, 3).join(", ") : "Not found"} tone={eduFound.length ? "good" : "warn"} />
            {d.location_match != null && (
              <Stat label="Location" value={d.location_match ? "Match" : "No match"} tone={d.location_match ? "good" : "bad"} />
            )}
            <Stat label="Points" value={`${d.earned_points ?? "—"} / ${d.possible_points ?? "—"}`} />
          </div>
          {b.jd_text_preview && (
            <details className="mt-3 text-xs text-muted">
              <summary className="cursor-pointer font-semibold text-secondary">JD the resume was scored against</summary>
              <p className="mt-2 whitespace-pre-wrap leading-relaxed">{b.jd_text_preview}</p>
            </details>
          )}
        </Section>
      </div>
    </Modal>
  );
}
