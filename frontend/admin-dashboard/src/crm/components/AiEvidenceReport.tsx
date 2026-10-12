/**
 * The AI interview, read as EVIDENCE for the panel (10 Oct 2026).
 *
 * User report: the panel saw "candidate is good at X" in the AI summary, asked
 * about X, and the candidate could not explain it. The AI's adjectives and its
 * per-skill scores are the model's own estimate — they can be generous, and a
 * skill can be rated without a single question about it. So this card leads
 * with what the record PROVES, all computed on the server
 * (`ai_interview_summary.evidence_report`):
 *
 *  1. Ask about these — skills not tested, weak, or tested only once; the
 *     mandatory ones first.
 *  2. Skill by skill — how many questions covered it, the average of THOSE
 *     answers, and a flag when the AI's own skill score is higher than its
 *     answers support.
 *  3. Question by question — the question, what the candidate said, the
 *     score, what they got right and what they missed.
 *  4. The AI's own summary last, collapsed and labelled "not checked".
 */
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, CircleHelp, Crosshair, ListChecks, MessageSquareQuote } from "lucide-react";
import { crmGet } from "../api";
import { ScoreIndicator } from "./ScoreIndicator";
import type { AiInterviewSummary } from "./AiInterviewOverview";

type Band = "strong" | "partial" | "weak" | "skipped" | "unscored";
type SkillStatus = "not_tested" | "weak" | "thin" | "mixed" | "shown";

export type EvidenceQuestion = {
  number: number; question: string; answer: string; answered: boolean; score_percent: number | null;
  band: Band; skill: string | null; got_right: string[]; missed: string[]; expected: string | null; excluded: boolean;
};
export type EvidenceSkill = {
  skill: string; mandatory: boolean; questions: number[]; avg_score_percent: number | null;
  status: SkillStatus; status_label: string; ai_estimate_percent: number | null; estimate_overstated: boolean;
};
export type Evidence = {
  available: boolean; asked: number; answered: number; questions: EvidenceQuestion[];
  skills: EvidenceSkill[]; probe: { skill: string; mandatory: boolean; status: SkillStatus; reason: string }[];
  caveats: string[];
};

const BAND_CHIP: Record<Band, string> = {
  strong: "bg-success-soft text-success",
  partial: "bg-warning-soft text-warning",
  weak: "bg-danger-soft text-danger",
  skipped: "bg-surface-2 text-muted",
  unscored: "bg-surface-2 text-muted",
};
const BAND_WORD: Record<Band, string> = {
  strong: "Answered well", partial: "Partly right", weak: "Weak answer", skipped: "Skipped", unscored: "Not scored",
};
const STATUS_CHIP: Record<SkillStatus, string> = {
  shown: "bg-success-soft text-success",
  mixed: "bg-warning-soft text-warning",
  thin: "bg-info-soft text-info",
  weak: "bg-danger-soft text-danger",
  not_tested: "bg-surface-2 text-secondary",
};

function pct(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : `${Math.round(v)}%`;
}

function Section({ icon: Icon, title, hint, children, open: defaultOpen = true }: {
  icon: typeof ListChecks; title: string; hint?: string; children: React.ReactNode; open?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-control border border-subtle bg-surface-1">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-primary"><Icon size={14} aria-hidden /> {title}</span>
        <ChevronDown size={14} className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {hint && open && <p className="-mt-1 px-3 pb-2 text-xs text-secondary">{hint}</p>}
      {open && <div className="border-t border-subtle px-3 py-2">{children}</div>}
    </div>
  );
}

export function AiEvidenceReport({ url }: { url: string }) {
  const [data, setData] = useState<(AiInterviewSummary & { evidence?: Evidence; reason?: string }) | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    crmGet<AiInterviewSummary & { evidence?: Evidence; reason?: string }>(url)
      .then((r) => { if (alive) setData(r.data); })
      .catch((e: any) => { if (alive) setError(e?.message || "Could not load the AI interview"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [url]);

  if (loading) return <div className="mt-2 h-24 animate-pulse rounded-control bg-surface-2" aria-busy="true" />;
  if (error) return <p className="mt-2 text-sm text-danger">{error}</p>;
  if (!data || data.available === false) {
    return <p className="mt-2 text-sm text-secondary">{data?.reason || "The AI interview report is not ready yet."}</p>;
  }
  const ev = data.evidence;
  const verdict = data.not_attempted ? "Not attempted" : data.effective_result || data.result || data.recommendation || "—";

  return (
    <div className="mt-3 space-y-3">
      {/* Headline — the number, and how much it rests on. */}
      <div className="flex flex-wrap items-center gap-3 rounded-control bg-surface-2 px-3 py-2">
        <ScoreIndicator score={data.overall_score_percent ?? null} size="sm" />
        <div className="min-w-0 text-sm">
          <div className="font-semibold text-primary">AI verdict: {verdict}</div>
          <div className="text-xs text-secondary">
            {ev?.available ? `${ev.answered} of ${ev.asked} questions answered` : `${data.questions?.answered ?? 0} answered`}
            {data.completed_at_ist ? ` · ${data.completed_at_ist}` : ""}
            {data.model_label ? ` · ${data.model_label}` : ""}
          </div>
        </div>
      </div>

      {ev && ev.caveats.length > 0 && (
        <div className="space-y-1 rounded-control border border-warning bg-warning-soft px-3 py-2 text-xs text-warning">
          {ev.caveats.map((c) => (
            <div key={c} className="flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 flex-none" aria-hidden /> <span>{c}</span></div>
          ))}
        </div>
      )}

      {ev?.available && (
        <>
          <Section icon={Crosshair} title={`Ask about these (${ev.probe.length})`}
            hint="Skills the AI interview did not prove — not tested, answered weakly, or covered by only one question. Mandatory skills first.">
            {ev.probe.length === 0
              ? <p className="text-sm text-secondary">Every skill of the position was covered by more than one good answer. Still worth a deeper question on the mandatory ones.</p>
              : (
                <ul className="space-y-1.5">
                  {ev.probe.map((p) => (
                    <li key={p.skill} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold text-primary">{p.mandatory ? "★ " : ""}{p.skill}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CHIP[p.status]}`}>{p.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
          </Section>

          {ev.skills.length > 0 && (
            <Section icon={ListChecks} title="Skill by skill — what the answers show"
              hint="Average of the answers to the questions about that skill. 'AI estimate' is the model's own rating — shown for comparison, not trusted on its own.">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                      <th className="py-1 pr-3 font-semibold">Skill</th>
                      <th className="py-1 pr-3 font-semibold">Questions</th>
                      <th className="py-1 pr-3 font-semibold">From answers</th>
                      <th className="py-1 pr-3 font-semibold">AI estimate</th>
                      <th className="py-1 font-semibold">Reading</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ev.skills.map((s) => (
                      <tr key={s.skill} className="border-t border-subtle align-top">
                        <td className="py-1.5 pr-3 font-medium text-primary">{s.mandatory ? "★ " : ""}{s.skill}</td>
                        <td className="py-1.5 pr-3 text-secondary">{s.questions.length ? s.questions.map((n) => `Q${n}`).join(", ") : "None"}</td>
                        <td className="py-1.5 pr-3 text-primary">{pct(s.avg_score_percent)}</td>
                        <td className="py-1.5 pr-3 text-secondary">
                          {pct(s.ai_estimate_percent)}
                          {s.estimate_overstated && (
                            <span className="ml-1.5 rounded-full bg-danger-soft px-1.5 py-0.5 text-[10px] font-semibold text-danger"
                              title="The AI's own skill rating is higher than the answers it scored support.">overstated</span>
                          )}
                        </td>
                        <td className="py-1.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CHIP[s.status]}`}>{s.status_label}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          <Section icon={MessageSquareQuote} title={`Question by question (${ev.questions.length})`} open={false}
            hint="What was asked, what the candidate said, and what the scoring found right and missing.">
            <ol className="space-y-3">
              {ev.questions.map((q) => (
                <li key={q.number} className={`rounded-control border border-subtle p-2.5 ${q.excluded ? "opacity-60" : ""}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 text-sm font-semibold text-primary">Q{q.number}. {q.question}</div>
                    <span className={`flex-none rounded-full px-2 py-0.5 text-[11px] font-semibold ${BAND_CHIP[q.band]}`}>
                      {BAND_WORD[q.band]}{q.score_percent != null ? ` · ${Math.round(q.score_percent)}%` : ""}
                    </span>
                  </div>
                  {q.skill && <div className="mt-0.5 text-[11px] text-muted">Skill: {q.skill}{q.excluded ? " · excluded by HR" : ""}</div>}
                  <p className="mt-1.5 whitespace-pre-wrap rounded-control bg-surface-2 px-2 py-1.5 text-sm text-secondary">
                    {q.answered ? q.answer : <span className="italic text-muted">No answer</span>}
                  </p>
                  {(q.got_right.length > 0 || q.missed.length > 0) && (
                    <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                      {q.got_right.length > 0 && (
                        <div className="text-xs">
                          <div className="flex items-center gap-1 font-semibold text-success"><CheckCircle2 size={12} aria-hidden /> Got right</div>
                          <ul className="ml-4 list-disc text-secondary">{q.got_right.map((x) => <li key={x}>{x}</li>)}</ul>
                        </div>
                      )}
                      {q.missed.length > 0 && (
                        <div className="text-xs">
                          <div className="flex items-center gap-1 font-semibold text-danger"><CircleHelp size={12} aria-hidden /> Missed</div>
                          <ul className="ml-4 list-disc text-secondary">{q.missed.map((x) => <li key={x}>{x}</li>)}</ul>
                        </div>
                      )}
                    </div>
                  )}
                  {q.expected && (
                    <details className="mt-1.5 text-xs text-secondary">
                      <summary className="cursor-pointer font-semibold text-muted">What a good answer covers</summary>
                      <p className="mt-1 whitespace-pre-wrap">{q.expected}</p>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          </Section>
        </>
      )}

      {(data.summary || data.strengths?.length || data.improvements?.length) ? (
        <Section icon={AlertTriangle} title="The AI's own summary — not checked against the answers" open={false}
          hint="Written by the model. It can be generous; trust the sections above where they disagree.">
          {data.summary && <p className="text-sm text-secondary">{data.summary}</p>}
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {data.strengths?.length > 0 && (
              <div className="text-xs"><div className="font-semibold text-primary">Model said strong</div>
                <ul className="ml-4 list-disc text-secondary">{data.strengths.map((x) => <li key={x}>{x}</li>)}</ul></div>
            )}
            {data.improvements?.length > 0 && (
              <div className="text-xs"><div className="font-semibold text-primary">Model said to improve</div>
                <ul className="ml-4 list-disc text-secondary">{data.improvements.map((x) => <li key={x}>{x}</li>)}</ul></div>
            )}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
