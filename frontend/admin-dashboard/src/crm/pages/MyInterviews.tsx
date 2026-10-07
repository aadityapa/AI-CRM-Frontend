/**
 * My Interviews — the panel member's own technical rounds (7 Oct 2026).
 *
 * User flow: "whoever takes the interview of a candidate adds that interview's
 * feedback, and sees ONLY that — the candidates whose interview they took."
 * Eight Interviewer logins (a seeded custom role whose one grant is this tab)
 * land here; an RMG / TA login who also takes rounds sees it beside their work.
 *
 * Everything comes from `/api/my-interviews` — the SERVER returns only the
 * rounds whose employee is this login (someone else's round is a 404), so the
 * page never filters by who the user is. Three scopes: Pending feedback
 * (held, no verdict) · Upcoming · Done. The chosen round opens in a detail pane:
 * the candidate (CV inline), the position's skills, the AI L1 verdict card and
 * the feedback dialog — the SAME `FeedbackModal` RMG uses, posting through the
 * scoped `…/feedback` route. `?focus=<round id>` (the bell link) opens that
 * round; `?scope=` picks the list.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Brain, CalendarClock, ClipboardCheck, ExternalLink, FileText, Link2, Mail, Phone,
  RefreshCw, Sparkles, UserRound, Video,
} from "lucide-react";
import { crmGet, crmPut } from "../api";
import { useMe } from "../CrmApp";
import { AiInterviewOverview } from "../components/AiInterviewOverview";
import { FilePreviewPane } from "../components/FileUpload";
import { FeedbackModal } from "../components/InterviewLadder";
import { PageHeader, StagePills } from "../components/PageHeader";
import { ErrorBox, useToast } from "../components/ui";
import { FLOW_BTN } from "../components/flowButtons";
import { roundResultTone } from "../lib/interviewRounds";
import { usePageTab } from "../lib/pageState";
import { fmtDateTime12 } from "../../lib/datetime";

type Phase = "pending" | "upcoming" | "done";
type Scope = Phase | "all";

export type MyRound = {
  id: number;
  profile_id: number;
  kind: string;
  round_label: string;
  phase: Phase;
  scheduled_at: string | null;
  raw_when: string | null;
  duration_minutes: number | null;
  meeting_link: string | null;
  status: string | null;
  result: string | null;
  feedback: string | null;
  note: string | null;
  interviewer: string | null;
  candidate: {
    id: number; name: string; email: string | null; phone: string | null;
    experience_years: number | null; notice_period: string | null; technical_domain: string | null;
    cv_url: string | null; current_ctc: number | null; expected_ctc: number | null;
  };
  position: { opportunity_id: number | null; opp_id: string | null; title: string | null; customer_name: string | null };
  ai_l1: {
    ai_interview_result: string | null; ai_effective_result: string | null; ai_overall_score_percent: number | null;
    ai_not_attempted?: boolean; ai_interview_completed_at: string | null;
  } | null;
};

type Detail = MyRound & {
  skills: { skill_id: number; skill_name: string | null; is_mandatory: boolean; min_rating: number | null }[];
  results_scale: string[];
  my_other_rounds: { id: number; kind: string; round_label: string; scheduled_at: string | null; result: string | null; phase: string }[];
};

type Counts = { pending: number; upcoming: number; done: number };

const SCOPES: { key: Scope; label: string }[] = [
  { key: "pending", label: "Feedback due" },
  { key: "upcoming", label: "Upcoming" },
  { key: "done", label: "Done" },
  { key: "all", label: "All" },
];

const PHASE_CHIP: Record<Phase, string> = {
  pending: "bg-warning-soft text-warning",
  upcoming: "bg-info-soft text-info",
  done: "bg-success-soft text-success",
};
const PHASE_WORD: Record<Phase, string> = { pending: "Feedback due", upcoming: "Upcoming", done: "Done" };

/** Lakhs with one decimal, for the CTC line. PURE. */
export function lakhs(v: number | null | undefined): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  const l = v >= 1000 ? v / 100000 : v;
  return `${Math.round(l * 10) / 10} L`;
}

function readFocus(): number | null {
  try {
    const n = Number(new URLSearchParams(window.location.search).get("focus") || "");
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function whenText(r: { scheduled_at: string | null; raw_when?: string | null }): string {
  if (r.scheduled_at) return fmtDateTime12(r.scheduled_at, r.raw_when || "—");
  return r.raw_when || "Time not set";
}

function RoundCard({ r, active, onOpen }: { r: MyRound; active: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} id={`my-round-${r.id}`}
      className={`w-full rounded-card border p-3 text-left transition-colors duration-micro ${
        active ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-subtle bg-surface-1 hover:bg-surface-2"}`}
      aria-current={active ? "true" : undefined}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-primary">{r.candidate.name}</div>
          <div className="truncate text-xs text-secondary">
            {r.round_label}
            {r.position.title ? ` · ${r.position.opp_id ? `${r.position.opp_id} — ` : ""}${r.position.title}` : ""}
          </div>
        </div>
        <span className={`flex-none rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          r.result ? roundResultTone(r.result) : PHASE_CHIP[r.phase]}`}>
          {r.result || PHASE_WORD[r.phase]}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
        <CalendarClock size={12} aria-hidden /> {whenText(r)}
        {r.duration_minutes ? <span>· {r.duration_minutes} min</span> : null}
      </div>
    </button>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-control bg-surface-2 px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        <Icon size={11} aria-hidden /> {label}
      </div>
      <div className="mt-0.5 text-sm text-primary">{value ?? "—"}</div>
    </div>
  );
}

function DetailPane({ roundId, onChanged, showToast }: {
  roundId: number; onChanged: (msg: string) => void; showToast: (m: string, k?: "ok" | "err") => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [showCv, setShowCv] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    setError("");
    crmGet<Detail>(`/api/my-interviews/${roundId}`)
      .then((r) => setDetail(r.data))
      .catch((e: any) => setError(e?.message || "Could not load this interview"))
      .finally(() => setLoading(false));
  }, [roundId]);
  useEffect(() => { load(); setShowCv(false); }, [load]);

  if (loading && !detail) return <div className="h-48 animate-pulse rounded-card bg-surface-2" aria-busy="true" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!detail) return null;
  const d = detail;
  const c = d.candidate;
  const canRecord = d.phase !== "upcoming" || !!d.result;
  const ai = d.ai_l1;
  const aiWord = ai ? (ai.ai_not_attempted ? "Not attempted" : ai.ai_effective_result || ai.ai_interview_result || "Pending") : null;
  const ctc = [lakhs(c.current_ctc), lakhs(c.expected_ctc)];

  return (
    <div className="space-y-4">
      {/* Identity band */}
      <div className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{d.round_label}</div>
            <h2 className="mt-0.5 truncate text-xl font-bold text-primary">{c.name}</h2>
            <div className="mt-0.5 text-sm text-secondary">
              {d.position.title ? <>{d.position.opp_id ? `${d.position.opp_id} — ` : ""}{d.position.title}</> : "Position not named"}
              {d.position.customer_name ? <span className="text-muted"> · {d.position.customer_name}</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${d.result ? roundResultTone(d.result) : PHASE_CHIP[d.phase]}`}>
              {d.result || PHASE_WORD[d.phase]}
            </span>
            {canRecord && (
              <button type="button" className={d.result ? FLOW_BTN.edit : FLOW_BTN.warn} onClick={() => setFeedbackOpen(true)}>
                <ClipboardCheck size={13} aria-hidden /> {d.result ? "Edit feedback" : "Record feedback"}
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Fact icon={CalendarClock} label="When" value={<>{whenText(d)}{d.duration_minutes ? ` · ${d.duration_minutes} min` : ""}</>} />
          <Fact icon={Video} label="Meeting" value={d.meeting_link
            ? <a className="inline-flex items-center gap-1 text-brand-700 underline" href={d.meeting_link} target="_blank" rel="noreferrer">Join the call <ExternalLink size={12} aria-hidden /></a>
            : "No link yet"} />
          <Fact icon={UserRound} label="Interviewer" value={d.interviewer || "You"} />
          <Fact icon={Mail} label="Email" value={c.email && !c.email.includes("@noemail") && !c.email.includes("@import.") ? c.email : "—"} />
          <Fact icon={Phone} label="Phone" value={c.phone} />
          <Fact icon={Sparkles} label="Experience" value={<>{c.experience_years != null ? `${c.experience_years} yrs` : "—"}{c.technical_domain ? ` · ${c.technical_domain}` : ""}</>} />
          <Fact icon={ClipboardCheck} label="CTC (current → expected)" value={ctc[0] || ctc[1] ? `${ctc[0] || "—"} → ${ctc[1] || "—"}` : "—"} />
          <Fact icon={CalendarClock} label="Notice period" value={c.notice_period} />
          <Fact icon={Brain} label="AI L1" value={aiWord
            ? <>{aiWord}{ai?.ai_overall_score_percent != null ? ` · ${Math.round(ai.ai_overall_score_percent)}%` : ""}</>
            : "Not taken"} />
        </div>
        {d.note && <p className="mt-3 rounded-control bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Note from the scheduler: {d.note}</p>}
        {d.feedback && (
          <blockquote className="mt-3 rounded-control border-l-4 border-brand-600 bg-surface-2 px-3 py-2 text-sm text-secondary">
            <span className="font-semibold text-primary">Your feedback: </span>{d.feedback}
          </blockquote>
        )}
      </div>

      {/* What to probe */}
      {d.skills.length > 0 && (
        <section className="rounded-card border border-subtle bg-surface-1 p-4">
          <h3 className="text-sm font-semibold text-primary">What the position needs</h3>
          <p className="text-xs text-secondary">Mandatory skills first (★); the number is the level the position asks for (1 aware … 5 expert).</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[...d.skills].sort((a, b) => Number(b.is_mandatory) - Number(a.is_mandatory)).map((s) => (
              <span key={s.skill_id} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                s.is_mandatory ? "bg-brand-600 text-white" : "bg-surface-2 text-secondary"}`}>
                {s.is_mandatory ? "★ " : ""}{s.skill_name || `Skill #${s.skill_id}`}{s.min_rating ? ` · ${s.min_rating}` : ""}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* AI L1 verdict */}
      {ai && (
        <section className="rounded-card border border-subtle bg-surface-1 p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-primary"><Brain size={14} aria-hidden /> AI interview — what the AI found</h3>
          <AiInterviewOverview profileId={d.profile_id} linkId={0} summaryUrl={`/api/my-interviews/${d.id}/ai-summary`} />
        </section>
      )}

      {/* The CV */}
      <section className="rounded-card border border-subtle bg-surface-1 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-primary"><FileText size={14} aria-hidden /> Resume</h3>
          {c.cv_url && (
            <div className="flex gap-2">
              <button type="button" className={FLOW_BTN.view} onClick={() => setShowCv((v) => !v)}>
                {showCv ? "Hide" : "View inline"}
              </button>
              <a className={FLOW_BTN.neutral} href={c.cv_url} target="_blank" rel="noreferrer"><Link2 size={13} aria-hidden /> Open</a>
            </div>
          )}
        </div>
        {!c.cv_url && <p className="mt-2 text-sm text-muted">No CV on file for this candidate.</p>}
        {c.cv_url && showCv && <div className="mt-3"><FilePreviewPane url={c.cv_url} title={`${c.name} — resume`} /></div>}
      </section>

      {d.my_other_rounds.length > 0 && (
        <section className="rounded-card border border-subtle bg-surface-1 p-4">
          <h3 className="text-sm font-semibold text-primary">Your other rounds with this candidate</h3>
          <ul className="mt-2 space-y-1 text-sm text-secondary">
            {d.my_other_rounds.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2">
                <span>{o.round_label} · {whenText(o)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${o.result ? roundResultTone(o.result) : "bg-surface-2 text-muted"}`}>
                  {o.result || o.phase}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {feedbackOpen && (
        <FeedbackModal profileId={d.profile_id}
          round={{ id: d.id, kind: d.kind, result: d.result, feedback: d.feedback, scheduled_at: d.scheduled_at,
            raw_when: d.raw_when, interviewer: d.interviewer, duration_minutes: d.duration_minutes }}
          results={d.results_scale} candidateName={c.name} showToast={showToast}
          submit={async (body) => (await crmPut(`/api/my-interviews/${d.id}/feedback`, body)).message || "Feedback saved"}
          onClose={() => setFeedbackOpen(false)}
          onDone={(msg) => { setFeedbackOpen(false); load(); onChanged(msg); }} />
      )}
    </div>
  );
}

export function MyInterviewsPage() {
  const me = useMe();
  const [scope, setScope] = usePageTab<Scope>("scope", "pending", SCOPES.map((s) => s.key));
  const [rows, setRows] = useState<MyRound[]>([]);
  const [counts, setCounts] = useState<Counts>({ pending: 0, upcoming: 0, done: 0 });
  const [linked, setLinked] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [active, setActive] = useState<number | null>(readFocus);
  const [toast, showToast] = useToast();

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    crmGet<MyRound[]>(`/api/my-interviews?scope=${scope}`)
      .then((r) => {
        setRows(r.data || []);
        const meta = (r.meta || {}) as { counts?: Counts; linked?: boolean };
        if (meta.counts) setCounts(meta.counts);
        setLinked(meta.linked !== false);
      })
      .catch((e: any) => setError(e?.message || "Could not load your interviews"))
      .finally(() => setLoading(false));
  }, [scope]);
  useEffect(() => { load(); }, [load]);

  // The bell's `?focus=` names a round that may sit in another scope — switch
  // to "all" once so it is on the list, then scroll to it.
  useEffect(() => {
    if (active == null || loading) return;
    if (!rows.some((r) => r.id === active) && scope !== "all") { setScope("all", { replace: true }); return; }
    document.getElementById(`my-round-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, loading, rows, scope, setScope]);

  const stats = useMemo(() => [
    { label: "Feedback due", value: counts.pending },
    { label: "Upcoming", value: counts.upcoming },
    { label: "Done", value: counts.done },
  ], [counts]);

  const selected = active != null && rows.some((r) => r.id === active) ? active : null;

  return (
    <div className="space-y-4">
      {toast}
      <PageHeader icon={ClipboardCheck} title="My Interviews" accent="violet"
        eyebrow={`Panel · ${me.full_name || me.username || "you"}`}
        subtitle="The candidates whose technical interview you take — their CV, the AI interview, and your feedback once the round is over."
        stats={stats}
        actions={<button type="button" className={FLOW_BTN.neutral} onClick={load} disabled={loading}><RefreshCw size={13} aria-hidden /> Refresh</button>}>
        <StagePills tabs={SCOPES.map((s) => ({ key: s.key, label: `${s.label}${s.key !== "all" ? ` (${counts[s.key]})` : ""}` }))}
          active={scope} onChange={(k) => { setScope(k as Scope); setActive(null); }} label="Interview lists" />
      </PageHeader>

      {!linked && !loading && (
        <div className="flex items-start gap-2 rounded-card border border-warning bg-warning-soft px-4 py-3 text-sm text-warning">
          <AlertTriangle size={16} className="mt-0.5 flex-none" aria-hidden />
          <div>
            <div className="font-semibold">Your login is not linked to an Employees record yet.</div>
            Interviews are matched to you through your Employees record (the official mailbox, or a linked login).
            Ask HR / Admin to add you to Employees with this login's email.
          </div>
        </div>
      )}
      {error && <ErrorBox error={error} onRetry={load} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="space-y-2">
          {loading && rows.length === 0 && <div className="h-40 animate-pulse rounded-card bg-surface-2" aria-busy="true" />}
          {!loading && rows.length === 0 && !error && (
            <div className="rounded-card border border-dashed border-subtle bg-surface-1 p-6 text-center text-sm text-secondary">
              {scope === "pending" ? "Nothing waiting for your feedback." : scope === "upcoming" ? "No interview booked with you yet." : "No interviews here."}
              <div className="mt-1 text-xs text-muted">When TA or RMG books a round with you as the interviewer, it appears here and you get a bell + email.</div>
            </div>
          )}
          {rows.map((r) => <RoundCard key={r.id} r={r} active={r.id === selected} onOpen={() => setActive(r.id)} />)}
        </div>
        <div>
          {selected != null
            ? <DetailPane roundId={selected} showToast={showToast} onChanged={(msg) => { showToast(msg); load(); }} />
            : rows.length > 0 && (
              <div className="flex h-full min-h-[12rem] items-center justify-center rounded-card border border-dashed border-subtle bg-surface-1 p-6 text-center text-sm text-secondary">
                Pick an interview on the left to see the candidate and record your feedback.
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

export default MyInterviewsPage;
