/**
 * AiInterviewOverview — the AI verdict, inline (23 Sep 2026).
 *
 * The profile's Interviews tab listed the AI L1 round as a date and a
 * "Full report" link, so every reviewer had to leave the page to learn
 * anything. This renders the dozen facts a reviewer scans first — score ring,
 * verdict, dimension scores, strengths / gaps, per-skill bars, question
 * counts — from `GET /api/candidate-profiles/{pid}/ai-interviews/{lid}/summary`.
 *
 * Reads only. The full report page remains the place to see per-question
 * transcripts and to override the verdict; this is what you read BEFORE
 * deciding whether to open it. Fetches lazily on mount (one request per AI
 * round shown), and every failure renders its reason rather than a blank.
 *
 * ⚠️ "Full report" needs the Interview Platform's Reports tab (`iv:candidates`
 * — TA / HR / RMG / Admin). A Sales login is bounced to the landing page by
 * `App.isViewAllowed`, which is precisely why the overview lives here: Sales
 * can now read the verdict without a link they cannot follow.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { crmGet } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanApprove } from "../useAccess";
import { ScoreIndicator } from "./ScoreIndicator";
import { InterviewModelChips } from "../../components/AiModelChip";

/** Roles that hold the Interview Platform's Reports tab — mirrors
 *  `lib/rbac.ts` `iv:candidates` (Admin/CEO implicit via `useHasRole`). */
const REPORT_PAGE_ROLES = ["TA", "HR", "RMG"] as const;

/** Whether this login can open the full AI report page (Admin/CEO implicit).
 *  A screener (GM — custom role) can too: App.isViewAllowed admits them. */
export function useCanOpenAiReport(): boolean {
  const byRole = useHasRole(...REPORT_PAGE_ROLES);
  const screener = useCanApprove("profile.rmg_screening");
  return byRole || screener;
}

/** The "Full AI report" button, or the hint for a role that cannot open it. */
export function AiReportLink({ href, label = "Full AI report", compact }: {
  href?: string | null; label?: string; compact?: boolean;
}) {
  const canOpen = useCanOpenAiReport();
  if (!href) return null;
  if (!canOpen) {
    return (
      <span className="text-xs text-muted" title="The full report page needs the Interview Platform's Reports tab (TA / HR / RMG / Admin).">
        Full report: ask RMG or TA
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 rounded-control border border-violet-300 bg-violet-50 font-semibold text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300 ${
        compact ? "px-2 py-0.5 text-[11px]" : "px-3 py-1.5 text-xs"}`}>
      {label} <ExternalLink size={12} aria-hidden />
    </a>
  );
}

export type AiInterviewSummary = {
  available: boolean;
  report_status: string;
  final_status: string;
  terminated: boolean;
  not_attempted: boolean;
  overall_score_percent: number | null;
  technical_score_percent: number | null;
  communication_score_percent: number | null;
  problem_solving_score_percent: number | null;
  recommendation: string;
  fitment: string;
  summary: string;
  strengths: string[];
  improvements: string[];
  skills: { skill: string; score: number | null }[];
  questions: { total: number; answered: number; skipped: number; excluded: number };
  job_title: string;
  completed_at_ist: string;
  result: string;
  effective_result: string | null;
  hr_decision_label: string | null;
  level: string | null;
  /** Which OpenAI model ran / scored it (9 Oct 2026). */
  model?: string;
  model_label?: string;
  evaluation_model?: string;
  evaluation_model_label?: string;
};

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)}%`);

function barTone(v: number | null): string {
  if (v == null) return "bg-surface-3";
  if (v >= 85) return "bg-score-strong-ring";
  if (v >= 70) return "bg-score-good-ring";
  if (v >= 55) return "bg-score-moderate-ring";
  return "bg-score-weak-ring";
}

function Dimension({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-control border border-subtle bg-surface-2 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-base font-bold tabular-nums text-primary">{pct(value)}</div>
    </div>
  );
}

function Bullets({ icon, title, items, tone }: { icon: React.ReactNode; title: string; items: string[]; tone: string }) {
  if (!items.length) return null;
  return (
    <div>
      <div className={`flex items-center gap-1.5 text-xs font-semibold ${tone}`}>
        {icon}
        {title}
      </div>
      <ul className="mt-1.5 space-y-1 text-sm text-secondary">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-current opacity-50" aria-hidden />
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AiInterviewOverview({
  profileId,
  linkId,
  reportLink,
  summaryUrl,
}: {
  profileId: number;
  linkId: number;
  reportLink?: string | null;
  /** A different summary endpoint — the panel member's My Interviews page
   *  (7 Oct 2026) reads the verdict through its own scoped route, since an
   *  Interviewer login has no Candidate Profiles tab. */
  summaryUrl?: string;
}) {
  const [data, setData] = useState<AiInterviewSummary | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    crmGet<AiInterviewSummary>(summaryUrl || `/api/candidate-profiles/${profileId}/ai-interviews/${linkId}/summary`)
      .then((res) => { if (alive) setData(res.data); })
      .catch((err) => { if (alive) setError(err?.message || "Could not load the AI overview."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [profileId, linkId, summaryUrl]);

  if (loading) {
    return <div className="mt-3 h-24 animate-pulse rounded-control bg-surface-2" aria-busy="true" />;
  }
  if (error) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-control border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
        <AlertTriangle size={14} aria-hidden /> {error}
      </div>
    );
  }
  if (!data) return null;

  const verdict = data.effective_result || data.result;
  const verdictTone =
    verdict === "Passed" ? "text-success" : verdict === "Failed" ? "text-danger" : "text-muted";

  return (
    <div className="mt-4 rounded-control border border-subtle bg-surface-2 p-4" data-testid="ai-interview-overview">
      {/* Headline row: ring · verdict · counts · full report */}
      <div className="flex flex-wrap items-center gap-4">
        <ScoreIndicator score={data.overall_score_percent} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-lg font-bold ${verdictTone}`}>{verdict}</span>
            {data.hr_decision_label && (
              <span className="rounded-full border border-subtle bg-surface-1 px-2 py-0.5 text-[11px] font-semibold text-secondary">
                {data.hr_decision_label}
              </span>
            )}
            {data.not_attempted && (
              <span className="rounded-full border border-warning bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">
                Not attempted
              </span>
            )}
            {data.terminated && (
              <span className="rounded-full border border-danger bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger">
                Terminated
              </span>
            )}
          </div>
          <div className="mt-1 text-sm text-secondary">
            {data.recommendation && <span className="font-semibold text-primary">{data.recommendation}</span>}
            {data.recommendation && data.fitment && <span className="text-muted"> · </span>}
            {data.fitment && <span>{data.fitment}</span>}
            {(data.evaluation_model || data.model) && (
              <InterviewModelChips
                model={data.model}
                modelLabel={data.model_label}
                evaluationModel={data.evaluation_model}
                evaluationModelLabel={data.evaluation_model_label}
              />
            )}
          </div>
          <div className="mt-1 text-xs text-muted">
            {data.questions.total > 0
              ? `${data.questions.answered} answered · ${data.questions.skipped} skipped · ${data.questions.total} asked`
              : data.available ? "No scored questions" : "Report not generated yet"}
            {data.job_title ? ` · ${data.job_title}` : ""}
          </div>
        </div>
        <AiReportLink href={reportLink} label="Full report" />
      </div>

      {data.available && (
        <>
          {/* Dimensions */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Dimension label="Technical" value={data.technical_score_percent} />
            <Dimension label="Problem solving" value={data.problem_solving_score_percent} />
            <Dimension label="Communication" value={data.communication_score_percent} />
            <Dimension label="Overall" value={data.overall_score_percent} />
          </div>

          {data.summary && (
            <p className="mt-4 flex gap-2 text-sm text-secondary">
              <Sparkles size={14} className="mt-0.5 flex-none text-brand-600 dark:text-brand-300" aria-hidden />
              <span>{data.summary}</span>
            </p>
          )}

          {(data.strengths.length > 0 || data.improvements.length > 0) && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Bullets icon={<ThumbsUp size={13} aria-hidden />} title="Strengths" items={data.strengths} tone="text-success" />
              <Bullets icon={<ThumbsDown size={13} aria-hidden />} title="Areas to probe" items={data.improvements} tone="text-warning" />
            </div>
          )}

          {data.skills.length > 0 && (
            <div className="mt-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Skill scores</div>
              <ul className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {data.skills.map((s) => (
                  <li key={s.skill} className="flex items-center gap-3 text-sm">
                    <span className="w-36 truncate text-secondary" title={s.skill}>{s.skill}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                      <span
                        className={`block h-full rounded-full ${barTone(s.score)}`}
                        style={{ width: `${Math.max(0, Math.min(100, s.score ?? 0))}%` }}
                      />
                    </span>
                    <span className="w-10 text-right tabular-nums text-primary">{pct(s.score)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
