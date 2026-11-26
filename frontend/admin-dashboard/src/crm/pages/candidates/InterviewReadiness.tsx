/** Candidates ▸ Interview readiness (24 Nov 2026, user ask): everyone we have
 *  interviewed — AI L1 score and communication, technical L1 / L2 feedback,
 *  customer rounds — with ONE verdict per person: Ready to approach, Trainable
 *  (call to the office, train, re-interview, then a customer round), Not ready
 *  now. Reads `GET /api/candidates/readiness`, which works over the records the
 *  tool already keeps — nothing new is stored. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot, Briefcase, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock, FileText, GraduationCap,
  MapPin, MessageSquareQuote, Phone, Search, Sparkles, Target, UserX, Users, X,
} from "lucide-react";

import { crmGet, qs } from "../../api";
import { CrmLink } from "../../router";
import { ErrorBox, Spinner } from "../../components/ui";
import { CONTROL } from "../../components/controlTower";
import { FLOW_BTN } from "../../components/flowButtons";
import { initials } from "../../components/dialogKit";
import { isPlaceholderEmail } from "../../lib/candidateEmail";
import { useSessionState, useChangeEffect } from "../../lib/pageState";
import { fmtDateShort } from "../../../lib/datetime";
import { fileViewHref } from "../FileView";
import { crmNavigate } from "../../router";
import { PlanDialog, TrainingChip, useTrainingWriter, type TrainingRef } from "../../components/training/TrainingParts";

export type Verdict = "ready" | "trainable" | "not_ready" | "no_score" | "placed";

type Position = { opportunity_id: number; opp_id: string; title: string; customer: string | null } | null;
type TimelineItem = {
  type: "ai" | "round";
  label?: string; kind?: string; result?: string; outcome?: "pass" | "fail" | null;
  feedback?: string | null; interviewer?: string | null;
  score?: number | null; technical?: number | null; communication?: number | null;
  recommendation?: string | null; summary?: string | null; decision?: string | null; not_attempted?: boolean;
  when: string | null; position: Position;
};
export type ReadinessRow = {
  candidate_id: number; name: string; email: string | null; phone: string | null; city: string | null;
  preferred_locations: string | null; experience_years: number | null; notice_period: string | null;
  notice_bucket: string | null; last_working_day: string | null;
  current_ctc_lakh: number | null; expected_ctc_lakh: number | null; technical_domain: string | null;
  cv_url: string | null; skills: string[];
  verdict: Verdict; verdict_label: string; why: string[]; next_steps: string[];
  ai_best: number | null; ai_technical: number | null; communication: number | null;
  ai_count: number; ai_not_attempted: number;
  technical_best: { label: string; result: string; feedback: string | null } | null;
  technical_outcome: "passed" | "leaning" | "failed" | "none"; customer_outcome: "passed" | "failed" | "none";
  rounds_count: number; weak_skills: string[]; training?: TrainingRef;
  skill_ratings: { skill: string; rated: number; required: number | null }[];
  applications: { profile_id: number; stage_label: string; status: string; closed: boolean; joined: boolean; position: Position }[];
  timeline: TimelineItem[];
  last_interview: string | null; last_interview_days: number | null;
};
type ReadinessMeta = {
  total: number; page: number; limit: number; counts: Record<Verdict, number>; scanned: number; truncated: boolean;
  thresholds: { ai_ready: number; ai_near: number; communication_ok: number };
};

export const VERDICT_LOOK: Record<Verdict, { label: string; short: string; chip: string; tile: string; icon: typeof Target }> = {
  ready: { label: "Ready to approach", short: "Ready", icon: CheckCircle2,
    chip: "bg-emerald-600 text-white", tile: "from-emerald-500 to-teal-600" },
  trainable: { label: "Trainable — call to office", short: "Trainable", icon: GraduationCap,
    chip: "bg-amber-500 text-white", tile: "from-amber-500 to-orange-600" },
  not_ready: { label: "Not ready now", short: "Not ready", icon: UserX,
    chip: "bg-rose-600 text-white", tile: "from-rose-500 to-pink-600" },
  no_score: { label: "Nothing scored yet", short: "No score", icon: Clock,
    chip: "bg-slate-500 text-white", tile: "from-slate-500 to-slate-700" },
  placed: { label: "Already joined", short: "Joined", icon: Briefcase,
    chip: "bg-sky-600 text-white", tile: "from-sky-500 to-indigo-600" },
};
const VERDICT_ORDER: Verdict[] = ["ready", "trainable", "not_ready", "no_score", "placed"];

export type ReadinessFilterState = {
  verdict: string; q: string; skill: string; ai_min: string; comm_min: string; technical: string; customer: string;
  interviewed_days: string; exp_min: string; exp_max: string; location: string; notice: string; ctc_max: string;
  sort: string;
};
export const EMPTY_READINESS: ReadinessFilterState = {
  verdict: "", q: "", skill: "", ai_min: "", comm_min: "", technical: "", customer: "", interviewed_days: "",
  exp_min: "", exp_max: "", location: "", notice: "", ctc_max: "", sort: "best",
};

/** The filters → the query string (blanks left out). PURE. */
export function readinessQuery(f: ReadinessFilterState, page: number, limit = 20): string {
  const out: Record<string, string | number | undefined> = { page, limit };
  for (const [k, v] of Object.entries(f)) {
    if (k === "sort") { if (v && v !== "best") out.sort = v; continue; }
    const t = String(v || "").trim();
    if (t) out[k] = t;
  }
  return qs(out);
}

/** A 0–100 score's colour band (the server's thresholds). PURE. */
export function scoreBand(v: number | null | undefined, ready = 70, near = 50): "good" | "near" | "low" | "none" {
  if (v === null || v === undefined) return "none";
  return v >= ready ? "good" : v >= near ? "near" : "low";
}

const BAND_BAR = { good: "bg-emerald-500", near: "bg-amber-500", low: "bg-rose-500", none: "bg-slate-300" };

export function InterviewReadiness() {
  const [stored, setFilters] = useSessionState<ReadinessFilterState>("cand.readiness", EMPTY_READINESS);
  const f = useMemo(() => ({ ...EMPTY_READINESS, ...(stored || {}) }), [stored]);
  const [page, setPage] = useSessionState("cand.readiness.page", 1);
  const [draft, setDraft] = useState({ q: f.q, skill: f.skill, location: f.location });
  const [rows, setRows] = useState<ReadinessRow[]>([]);
  const [meta, setMeta] = useState<ReadinessMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const seq = useRef(0);

  const query = useMemo(() => readinessQuery(f, page), [f, page]);
  const load = useCallback(() => {
    const my = ++seq.current;
    setLoading(true); setError("");
    crmGet<ReadinessRow[]>(`/api/candidates/readiness${query}`)
      .then((r) => { if (my === seq.current) { setRows(r.data || []); setMeta((r.meta as unknown as ReadinessMeta) || null); } })
      .catch((e) => { if (my === seq.current) setError(e?.message || "Could not load interview readiness"); })
      .finally(() => { if (my === seq.current) setLoading(false); });
  }, [query]);
  useEffect(() => { load(); }, [load]);
  useChangeEffect(() => { setPage(1); }, [f]);
  useEffect(() => {
    const t = window.setTimeout(() => setFilters((p) => {
      const cur = { ...EMPTY_READINESS, ...(p || {}) };
      return cur.q === draft.q && cur.skill === draft.skill && cur.location === draft.location ? cur : { ...cur, ...draft };
    }), 350);
    return () => window.clearTimeout(t);
  }, [draft, setFilters]);

  const set = (k: keyof ReadinessFilterState, v: string) => setFilters((p) => ({ ...EMPTY_READINESS, ...(p || {}), [k]: v }));
  const reset = () => { setFilters(EMPTY_READINESS); setDraft({ q: "", skill: "", location: "" }); };
  const active = Object.entries(f).filter(([k, v]) => k !== "sort" && String(v || "").trim()).length;
  const pages = meta ? Math.max(1, Math.ceil(meta.total / (meta.limit || 20))) : 1;
  const counts = meta?.counts;

  return (
    <div className="space-y-3">
      <section className="rounded-card border border-subtle bg-surface-1 p-3 shadow-raised">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-base font-bold text-primary"><Target size={16} aria-hidden /> Interview readiness</h2>
            <p className="max-w-3xl text-xs text-muted">
              Everyone interviewed with us — AI L1 score and communication, technical L1 / L2 feedback and customer rounds —
              with what to do next. <b>Trainable</b> means a near miss worth bringing to the office for a few days of training
              before a re-interview and a customer round. Read from the records we already keep.
            </p>
          </div>
          {active > 0 && <button type="button" className={FLOW_BTN.danger} onClick={reset}><X size={13} aria-hidden /> Clear filters</button>}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label="Readiness">
          {VERDICT_ORDER.map((v) => {
            const look = VERDICT_LOOK[v];
            const on = f.verdict === v;
            const Icon = look.icon;
            return (
              <button key={v} type="button" aria-pressed={on} onClick={() => set("verdict", on ? "" : v)}
                className={`flex items-center gap-2 rounded-card border p-2.5 text-left transition-colors ${
                  on ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/30 dark:bg-brand-900/30" : "border-subtle bg-surface-2/50 hover:border-brand-300"}`}>
                <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-gradient-to-br text-white ${look.tile}`}>
                  <Icon size={17} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-lg font-bold tabular-nums text-primary">{counts ? counts[v] ?? 0 : "—"}</span>
                  <span className="block truncate text-[11px] font-semibold text-secondary">{look.label}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="relative min-w-[13rem] flex-1">
            <span className="sr-only">Search name, email, mobile</span>
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input type="text" className={`${CONTROL} w-full pl-8`} placeholder="Name, email, mobile or domain"
              value={draft.q} onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))} />
          </label>
          <input type="text" className={`${CONTROL} !w-44`} placeholder="Skill, e.g. AUTOSAR" aria-label="Skill"
            value={draft.skill} onChange={(e) => setDraft((d) => ({ ...d, skill: e.target.value }))} />
          <select className={CONTROL} aria-label="Sort" value={f.sort} onChange={(e) => set("sort", e.target.value)}>
            <option value="best">Most ready first</option>
            <option value="ai">Highest AI score</option>
            <option value="communication">Best communication</option>
            <option value="recent">Interviewed most recently</option>
            <option value="experience">Most experienced</option>
          </select>
        </div>
        <div className="mt-2 grid gap-2 rounded-control border border-subtle bg-surface-2/50 p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <Pick label="AI L1 score" value={f.ai_min} onChange={(v) => set("ai_min", v)}
            options={[["", "Any"], ["80", "80% +"], ["70", "70% +"], ["60", "60% +"], ["50", "50% +"], ["40", "40% +"]]} />
          <Pick label="Communication" value={f.comm_min} onChange={(v) => set("comm_min", v)}
            options={[["", "Any"], ["80", "80% +"], ["70", "70% +"], ["60", "60% +"], ["50", "50% +"]]} />
          <Pick label="Technical L1 / L2" value={f.technical} onChange={(v) => set("technical", v)}
            options={[["", "Any"], ["passed", "Cleared (Hire)"], ["leaning", "Leaning Hire"], ["failed", "Not cleared"], ["any", "Had a round"], ["none", "No round yet"]]} />
          <Pick label="Customer round" value={f.customer} onChange={(v) => set("customer", v)}
            options={[["", "Any"], ["failed", "Customer said no"], ["passed", "Customer said yes"], ["any", "Had a round"], ["none", "No round yet"]]} />
          <Pick label="Interviewed within" value={f.interviewed_days} onChange={(v) => set("interviewed_days", v)}
            options={[["", "Any time"], ["30", "30 days"], ["90", "3 months"], ["180", "6 months"], ["365", "1 year"]]} />
          <Pick label="Notice period" value={f.notice} onChange={(v) => set("notice", v)}
            options={[["", "Any"], ["15", "Immediate – 15 d"], ["30", "≤ 30 days"], ["60", "≤ 60 days"], ["90", "60+ days"], ["serving", "Serving notice"], ["unknown", "Not recorded"]]} />
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Experience (yrs)</div>
            <div className="flex items-center gap-1">
              <input type="number" min={0} step={0.5} placeholder="From" aria-label="Minimum experience" className={`${CONTROL} w-full`}
                value={f.exp_min} onChange={(e) => set("exp_min", e.target.value)} />
              <span className="text-muted">–</span>
              <input type="number" min={0} step={0.5} placeholder="To" aria-label="Maximum experience" className={`${CONTROL} w-full`}
                value={f.exp_max} onChange={(e) => set("exp_max", e.target.value)} />
            </div>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Location</div>
            <input type="text" className={`${CONTROL} w-full`} placeholder="e.g. Pune" value={draft.location}
              onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))} />
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Expected CTC up to (L)</div>
            <input type="number" min={0} step={0.5} className={`${CONTROL} w-full`} placeholder="e.g. 12" value={f.ctc_max}
              onChange={(e) => set("ctc_max", e.target.value)} />
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-secondary">
        <span>{loading ? "Reading the interviews…" : meta ? <><b className="text-primary">{meta.total.toLocaleString("en-IN")}</b> {meta.total === 1 ? "person" : "people"}
          {meta.truncated && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Latest {meta.scanned.toLocaleString("en-IN")} interviewed — narrow with a filter</span>}</> : null}</span>
        {meta && <span className="text-xs text-muted">Ready = technical Hire, or AI ≥ {meta.thresholds.ai_ready}% with communication ≥ {meta.thresholds.communication_ok}% · Trainable = AI {meta.thresholds.ai_near}–{meta.thresholds.ai_ready - 1}%, Leaning Hire, or the customer said no after we cleared them</span>}
      </div>

      {error ? <ErrorBox error={error} onRetry={load} />
        : loading && rows.length === 0 ? <Spinner label="Reading the interviews…" />
          : rows.length === 0 ? (
            <div className="rounded-card border border-dashed border-subtle bg-surface-1 p-8 text-center text-sm text-muted">
              <Users className="mx-auto mb-2 text-muted" size={22} aria-hidden />
              No one interviewed matches these filters.
              {active > 0 && <> <button type="button" className="font-semibold text-brand-700 hover:underline dark:text-brand-300" onClick={reset}>Clear filters</button></>}
            </div>
          ) : (
            <div className={`space-y-3 ${loading ? "opacity-60" : ""}`}>
              {rows.map((r) => <ReadinessCard key={r.candidate_id} row={r} thresholds={meta?.thresholds} />)}
            </div>
          )}

      {meta && pages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-1 text-sm">
          <button type="button" className={FLOW_BTN.neutral} disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={14} aria-hidden /> Previous</button>
          <span className="tabular-nums text-secondary">Page {page} of {pages}</span>
          <button type="button" className={FLOW_BTN.neutral} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next <ChevronRight size={14} aria-hidden /></button>
        </div>
      )}
    </div>
  );
}

function Pick({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <select className={`${CONTROL} w-full`} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

function Meter({ label, value, thresholds }: { label: string; value: number | null; thresholds?: ReadinessMeta["thresholds"] }) {
  const band = scoreBand(value, thresholds?.ai_ready, thresholds?.ai_near);
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="font-semibold text-secondary">{label}</span>
        <span className="font-bold tabular-nums text-primary">{value === null ? "—" : `${Math.round(value)}%`}</span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${BAND_BAR[band]}`} style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
      </div>
    </div>
  );
}

function outcomeChip(o: "passed" | "leaning" | "failed" | "none", label: string) {
  const cls = o === "leaning" ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800"
    : o === "passed" ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800"
    : o === "failed" ? "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-800"
      : "bg-surface-2 text-muted ring-subtle";
  const word = o === "leaning" ? "leaning hire" : o === "passed" ? "cleared" : o === "failed" ? "not cleared" : "none yet";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${cls}`}>{label}: {word}</span>;
}

function ReadinessCard({ row, thresholds }: { row: ReadinessRow; thresholds?: ReadinessMeta["thresholds"] }) {
  const [open, setOpen] = useState(false);
  const look = VERDICT_LOOK[row.verdict];
  const email = row.email && !isPlaceholderEmail(row.email) ? row.email : null;
  const cv = fileViewHref(row.cv_url, `${row.name} CV`);
  const phone = (row.phone || "").trim();
  const canTrain = useTrainingWriter();
  const [training, setTraining] = useState(false);
  const planOpen = !!row.training && ["Active", "Interview_due", "Not_yet"].includes(row.training.status);
  return (
    <article className="rounded-card border border-subtle bg-surface-1 p-3 shadow-raised">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-indigo-600 text-sm font-bold text-white">
            {initials(row.name)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <CrmLink to={`candidates/${row.candidate_id}`} className="truncate text-base font-bold text-primary hover:underline">{row.name}</CrmLink>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${look.chip}`}>{look.short}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-secondary">
              {row.experience_years !== null && <span><Briefcase size={11} className="mr-0.5 inline" aria-hidden />{row.experience_years} yrs</span>}
              {row.city && <span><MapPin size={11} className="mr-0.5 inline" aria-hidden />{row.city}{row.preferred_locations ? ` → ${row.preferred_locations}` : ""}</span>}
              {(row.current_ctc_lakh || row.expected_ctc_lakh) && <span>CTC ₹{row.current_ctc_lakh ?? "—"} L → <b className="text-primary">₹{row.expected_ctc_lakh ?? "—"} L</b></span>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
              {phone.replace(/\D/g, "").length >= 6
                ? <a href={`tel:${phone.replace(/\s+/g, "")}`} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-800 ring-1 ring-inset ring-indigo-200 hover:underline dark:bg-indigo-950/40 dark:text-indigo-200 dark:ring-indigo-800"><Phone size={11} aria-hidden />{phone}</a>
                : <span className="rounded-full bg-surface-2 px-2 py-0.5 text-muted ring-1 ring-inset ring-subtle">No mobile</span>}
              <span className="rounded-full bg-surface-2 px-2 py-0.5 font-semibold text-secondary ring-1 ring-inset ring-subtle">
                {row.last_working_day ? `Serving notice · LWD ${fmtDateShort(row.last_working_day)}` : row.notice_period ? `Notice ${row.notice_period}` : "Notice not recorded"}
              </span>
              {email && <a className="truncate text-brand-700 hover:underline dark:text-brand-300" href={`mailto:${email}`}>{email}</a>}
            </div>
            {row.skills.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {row.skills.slice(0, 8).map((s) => <span key={s} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-secondary ring-1 ring-inset ring-subtle">{s}</span>)}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2 rounded-control border border-subtle bg-surface-2/50 p-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-secondary"><Bot size={13} aria-hidden /> AI L1
            <span className="font-normal text-muted">· {row.ai_count} interview{row.ai_count === 1 ? "" : "s"}{row.ai_not_attempted ? ` (${row.ai_not_attempted} not attempted)` : ""}</span>
          </div>
          <Meter label="Overall" value={row.ai_best} thresholds={thresholds} />
          <Meter label="Technical" value={row.ai_technical} thresholds={thresholds} />
          <Meter label="Communication" value={row.communication} thresholds={thresholds
            ? { ...thresholds, ai_ready: thresholds.communication_ok, ai_near: Math.max(0, thresholds.communication_ok - 15) } : undefined} />
          <div className="flex flex-wrap gap-1 pt-0.5">
            {outcomeChip(row.technical_outcome, "Technical")}
            {outcomeChip(row.customer_outcome, "Customer")}
          </div>
        </div>

        <div className="min-w-0 space-y-2">
          {row.technical_best && (
            <div className="rounded-control border border-subtle p-2 text-xs">
              <div className="font-semibold text-primary">{row.technical_best.label} — {row.technical_best.result}</div>
              {row.technical_best.feedback && (
                <p className="mt-0.5 line-clamp-3 text-secondary"><MessageSquareQuote size={11} className="mr-1 inline text-muted" aria-hidden />{row.technical_best.feedback}</p>
              )}
            </div>
          )}
          {row.weak_skills.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-[11px]">
              <span className="font-semibold text-amber-700 dark:text-amber-300">Train on:</span>
              {row.weak_skills.slice(0, 6).map((s) => <span key={s} className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800">{s}</span>)}
            </div>
          )}
          <div className={`rounded-control p-2 text-xs ${row.verdict === "ready" ? "bg-emerald-50 dark:bg-emerald-950/30" : row.verdict === "trainable" ? "bg-amber-50 dark:bg-amber-950/30" : "bg-surface-2"}`}>
            <div className="mb-0.5 flex items-center gap-1 font-semibold text-primary"><Sparkles size={12} aria-hidden /> {row.verdict_label}</div>
            <ul className="list-disc space-y-0.5 pl-4 text-secondary">
              {row.next_steps.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-subtle pt-2">
        <CrmLink to={`candidates/${row.candidate_id}`} className={FLOW_BTN.view}>Open candidate</CrmLink>
        {cv && <a href={cv} target="_blank" rel="noreferrer" className={FLOW_BTN.neutral}><FileText size={13} aria-hidden /> CV</a>}
        <CrmLink to={`candidates/${row.candidate_id}?tab=matching`} className={FLOW_BTN.success}><Target size={13} aria-hidden /> Matching positions & apply</CrmLink>
        {row.training && <TrainingChip training={row.training} />}
        {canTrain && !planOpen && row.verdict !== "placed" && (
          <button type="button" className={FLOW_BTN.edit} onClick={() => setTraining(true)}><GraduationCap size={13} aria-hidden /> Start training</button>)}
        <button type="button" className={`${FLOW_BTN.neutral} ml-auto`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <ChevronDown size={13} className={open ? "rotate-180" : ""} aria-hidden />
          {open ? "Hide" : "Every interview"} ({row.timeline.length})
        </button>
        {row.last_interview && <span className="text-[11px] text-muted">Last interview {fmtDateShort(row.last_interview)}</span>}
      </div>
      {training && (
        <PlanDialog subject={{ candidate_id: row.candidate_id, name: row.name, isEmployee: false }} source="readiness"
          suggestions={row.skill_ratings.map((x) => x.skill)}
          weak={row.weak_skills.map((w) => {
            const r = row.skill_ratings.find((x) => x.skill === w);
            return { name: w, current: r?.rated ?? null, target: r?.required ?? 4 };
          })}
          onClose={() => setTraining(false)} onDone={(plan) => { setTraining(false); crmNavigate(`training/${plan.id}`); }} />
      )}

      {open && (
        <div className="mt-2 grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <ol className="space-y-1.5">
            {row.timeline.map((t, i) => (
              <li key={i} className="rounded-control border border-subtle p-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-primary">{t.type === "ai" ? "AI L1" : t.label}</span>
                  {t.type === "ai"
                    ? <span className="text-secondary">{t.not_attempted ? "Not attempted" : `${t.score === null || t.score === undefined ? "—" : Math.round(t.score) + "%"}${t.communication != null ? ` · communication ${Math.round(t.communication)}%` : ""}${t.decision ? ` · ${t.decision}` : ""}`}</span>
                    : <span className={t.outcome === "pass" ? "font-semibold text-emerald-700 dark:text-emerald-300" : t.outcome === "fail" ? "font-semibold text-rose-700 dark:text-rose-300" : "text-secondary"}>{t.result}</span>}
                  {t.when && <span className="text-muted">· {fmtDateShort(t.when)}</span>}
                  {t.interviewer && <span className="text-muted">· {t.interviewer}</span>}
                  {t.position && <span className="text-muted">· {t.position.opp_id} {t.position.title}{t.position.customer ? ` (${t.position.customer})` : ""}</span>}
                </div>
                {(t.feedback || t.summary) && <p className="mt-0.5 text-secondary">{t.feedback || t.summary}</p>}
              </li>
            ))}
          </ol>
          <div className="space-y-2 text-xs">
            {row.why.length > 0 && (
              <div className="rounded-control bg-surface-2 p-2">
                <div className="mb-0.5 font-semibold text-primary">Why this verdict</div>
                <ul className="list-disc pl-4 text-secondary">{row.why.map((w) => <li key={w}>{w}</li>)}</ul>
              </div>
            )}
            {row.skill_ratings.length > 0 && (
              <div className="rounded-control border border-subtle p-2">
                <div className="mb-1 font-semibold text-primary">Skill ratings (1–5)</div>
                <div className="flex flex-wrap gap-1">
                  {row.skill_ratings.map((s, i) => (
                    <span key={i} className={`rounded-full px-2 py-0.5 ring-1 ring-inset ${s.required && s.rated < s.required
                      ? "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800"
                      : "bg-surface-2 text-secondary ring-subtle"}`}>
                      {s.skill} {s.rated}{s.required ? `/${s.required}` : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {row.applications.length > 0 && (
              <div className="rounded-control border border-subtle p-2">
                <div className="mb-1 font-semibold text-primary">Applications</div>
                <ul className="space-y-0.5">
                  {row.applications.map((a) => (
                    <li key={a.profile_id}>
                      <CrmLink to={`profiles/${a.profile_id}`} className="text-brand-700 hover:underline dark:text-brand-300">
                        {a.position ? `${a.position.opp_id} ${a.position.title}` : `Profile #${a.profile_id}`}
                      </CrmLink>
                      <span className={a.closed ? " text-rose-700 dark:text-rose-300" : " text-secondary"}> · {a.stage_label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
