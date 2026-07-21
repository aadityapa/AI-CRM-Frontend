import type { DimensionScores, EnrichedTurn } from "../../utils/reportExtract";
import { turnHasProfessionalAssessment } from "../../utils/reportExtract";

function DimensionBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs font-semibold text-secondary">
        <span>{label}</span>
        <span className="tabular-nums text-brand-600 dark:text-brand-300">{value}%</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

function DimensionGrid({ scores }: { scores: DimensionScores }) {
  return (
    <div className="rounded-card border border-subtle bg-surface-2 p-4 space-y-3">
      <p className="text-xs font-black uppercase text-brand-700 dark:text-brand-300 tracking-wide">
        Dimension scores
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <DimensionBar label="Technical accuracy" value={scores.technicalAccuracy} />
        <DimensionBar label="Concept coverage" value={scores.conceptCoverage} />
        <DimensionBar label="Depth of explanation" value={scores.depth} />
        <DimensionBar label="Communication quality" value={scores.communication} />
        <DimensionBar label="Confidence level" value={scores.confidence} />
      </div>
    </div>
  );
}

function LegacyStrengthsWeaknesses({ turn }: { turn: EnrichedTurn }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <div className="rounded-card border border-subtle bg-success-soft p-3">
        <p className="fx-hairline-b pb-2 text-xs font-black uppercase text-success">Strengths</p>
        <ul className="mt-2 text-sm text-secondary list-disc pl-4 space-y-1">
          {(turn.strengths.length ? turn.strengths : ["—"]).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </div>
      <div className="rounded-card border border-subtle bg-danger-soft p-3">
        <p className="fx-hairline-b pb-2 text-xs font-black uppercase text-danger">Weaknesses</p>
        <ul className="mt-2 text-sm text-secondary list-disc pl-4 space-y-1">
          {(turn.weaknesses.length ? turn.weaknesses : ["—"]).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ProfessionalAssessmentSections({ turn }: { turn: EnrichedTurn }) {
  const professional = turnHasProfessionalAssessment(turn);
  const rating =
    turn.overallRating != null
      ? turn.overallRating
      : turn.score != null
        ? Math.round((turn.score / 10) * 10) / 10
        : null;
  const modelAnswer = turn.expectedAnswer || turn.idealAnswer;

  if (!professional) {
    return (
      <div className="space-y-4">
        {turn.feedback ? (
          <div>
            <p className="text-xs font-black uppercase text-muted mb-1">AI evaluation</p>
            <p className="text-sm text-secondary whitespace-pre-wrap">{turn.feedback}</p>
          </div>
        ) : null}
        <LegacyStrengthsWeaknesses turn={turn} />
        {modelAnswer ? (
          <div className="rounded-card border border-subtle bg-brand-50 dark:bg-surface-2 p-3">
            <p className="text-xs font-black uppercase text-brand-700 dark:text-brand-300">
              Suggested ideal answer
            </p>
            <p className="mt-2 text-sm text-primary whitespace-pre-wrap">{modelAnswer}</p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-subtle bg-surface-1 p-4">
        <p className="text-xs font-black uppercase text-muted">Evaluation summary</p>
        {rating != null ? (
          <p className="mt-1 text-sm font-black tabular-nums text-brand-700 dark:text-brand-300">
            Overall rating: {rating}/10
          </p>
        ) : null}
        <p className="mt-2 text-sm text-secondary whitespace-pre-wrap leading-relaxed">
          {turn.evaluationSummary || turn.feedback || "—"}
        </p>
      </div>

      <div className="rounded-card border border-subtle bg-success-soft p-4">
        <p className="fx-hairline-b pb-2 text-xs font-black uppercase text-success">
          What candidate explained correctly
        </p>
        {turn.correctConcepts.length ? (
          <ol className="mt-3 space-y-3 list-decimal pl-5">
            {turn.correctConcepts.map((item, i) => (
              <li key={i} className="text-sm text-primary">
                <span className="font-bold">✅ {item.topic}</span>
                <p className="mt-0.5 text-secondary">{item.explanation}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-secondary">
            No significant technical strengths identified.
          </p>
        )}
      </div>

      <div className="rounded-card border border-subtle bg-danger-soft p-4">
        <p className="fx-hairline-b pb-2 text-xs font-black uppercase text-danger">Areas for improvement</p>
        {turn.improvementAreas.length ? (
          <ol className="mt-3 space-y-3 list-decimal pl-5">
            {turn.improvementAreas.map((item, i) => (
              <li key={i} className="text-sm text-primary">
                <span className="font-bold">❌ {item.topic}</span>
                <p className="mt-0.5 text-secondary">{item.explanation}</p>
                {item.correction ? (
                  <p className="mt-1 text-xs text-danger">
                    <span className="font-bold">Correction: </span>
                    {item.correction}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : turn.weaknesses.length ? (
          <ul className="mt-2 text-sm text-secondary list-disc pl-4 space-y-1">
            {turn.weaknesses.map((s, i) => (
              <li key={i}>❌ {s}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-secondary">—</p>
        )}
      </div>

      {modelAnswer ? (
        <div className="rounded-card border border-subtle bg-brand-50 dark:bg-surface-2 p-4">
          <p className="text-xs font-black uppercase text-brand-700 dark:text-brand-300">
            Expected interview answer (9–10/10)
          </p>
          <p className="mt-2 text-sm text-primary whitespace-pre-wrap leading-relaxed">
            {modelAnswer}
          </p>
        </div>
      ) : null}

      {turn.interviewFeedback ? (
        <div className="rounded-card border border-subtle bg-surface-2 p-4">
          <p className="text-xs font-black uppercase text-muted">Interview feedback</p>
          <p className="mt-2 text-sm text-secondary whitespace-pre-wrap leading-relaxed">
            {turn.interviewFeedback}
          </p>
        </div>
      ) : null}

      {turn.followUpQuestions.length ? (
        <div className="rounded-card border border-subtle bg-warning-soft p-4">
          <p className="fx-hairline-b pb-2 text-xs font-black uppercase text-warning">
            Manager follow-up questions
          </p>
          <ul className="mt-2 text-sm text-secondary list-disc pl-4 space-y-1.5">
            {turn.followUpQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {turn.dimensionScores ? <DimensionGrid scores={turn.dimensionScores} /> : null}
    </div>
  );
}
