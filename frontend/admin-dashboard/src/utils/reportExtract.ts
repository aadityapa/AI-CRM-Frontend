import type { CandidateInterviewSummary, InterviewRecord } from "../types";

export function safeText(v: unknown): string {
  return String(v ?? "").trim();
}

/** Stored scores may be 0–10 (legacy report fields) or 0–100 (score_reasons / scoring_summary). */
export function normalizePercent(raw: unknown, fallback = 0): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(fallback)));
  // score_reasons and scoring_summary already use 0–100 integers / floats
  if (n > 10) return Math.max(0, Math.min(100, Math.round(n)));
  const scaled = n > 0 ? n * 10 : 0;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

/** For fields that are ALREADY a 0–100 percentage (e.g. *_percent from the
 *  backend). Never rescales — clamps + rounds only. Using normalizePercent on
 *  these wrongly ×10s a genuine low percent (5% → 50%) for weak candidates. */
export function asPercent(raw: unknown, fallback = 0): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(fallback)));
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function overallFromReport(report: Record<string, unknown> | undefined, fallback: number): number {
  if (!report) return normalizePercent(fallback, fallback);
  return normalizePercent(
    report.overall_score ?? report.score ?? report.final_score ?? report.fitment_score,
    fallback,
  );
}

export type AssessmentConcept = {
  topic: string;
  explanation: string;
};

export type AssessmentImprovement = {
  topic: string;
  explanation: string;
  correction: string;
};

export type DimensionScores = {
  technicalAccuracy: number;
  conceptCoverage: number;
  depth: number;
  communication: number;
  confidence: number;
};

export type EnrichedTurn = {
  idx: number;
  question: string;
  answer: string;
  score?: number;
  feedback?: string;
  strengths: string[];
  weaknesses: string[];
  idealAnswer?: string;
  overallRating?: number;
  evaluationSummary?: string;
  correctConcepts: AssessmentConcept[];
  improvementAreas: AssessmentImprovement[];
  expectedAnswer?: string;
  interviewFeedback?: string;
  followUpQuestions: string[];
  dimensionScores?: DimensionScores;
  boundaryLabel?: string;
  excludedFromScore?: boolean;
  excludedBy?: string;
  excludedAt?: string;
  excludedReason?: string;
  isIntroduction?: boolean;
};

export function introductionTurnFromRecord(record: InterviewRecord | null): EnrichedTurn | null {
  if (!record?.report || typeof record.report !== "object") return null;
  const report = record.report as Record<string, unknown>;
  const intro = report.introduction_turn;
  if (!intro || typeof intro !== "object") return null;
  const row = intro as Record<string, unknown>;
  const question = safeText(row.question);
  const answer = safeText(row.answer);
  if (!question && !answer) return null;
  const evaluation =
    row.evaluation && typeof row.evaluation === "object"
      ? (row.evaluation as Record<string, unknown>)
      : (report.introduction_evaluation as Record<string, unknown> | undefined);
  const summary = safeText(evaluation?.summary || evaluation?.feedback);
  return {
    idx: 0,
    question: question || "Please introduce yourself.",
    answer,
    score: undefined,
    feedback: summary || "Saved for review only — not included in technical score.",
    strengths: [],
    weaknesses: [],
    correctConcepts: [],
    improvementAreas: [],
    followUpQuestions: [],
    excludedFromScore: true,
    excludedReason:
      safeText(row.excluded_reason) || "Introduction warmup (not counted toward overall score).",
    isIntroduction: true,
    evaluationSummary: summary || undefined,
    interviewFeedback: safeText(evaluation?.feedback) || undefined,
  };
}

function parseConceptItems(raw: unknown): AssessmentConcept[] {
  if (!Array.isArray(raw)) return [];
  const out: AssessmentConcept[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim()) {
      out.push({ topic: entry.trim(), explanation: entry.trim() });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const topic = safeText(o.topic || o.name || o.label);
    const explanation = safeText(o.explanation || o.detail || o.text);
    if (!topic && !explanation) continue;
    out.push({ topic: topic || "General", explanation: explanation || topic });
  }
  return out;
}

function parseImprovementItems(raw: unknown): AssessmentImprovement[] {
  if (!Array.isArray(raw)) return [];
  const out: AssessmentImprovement[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim()) {
      out.push({ topic: entry.trim(), explanation: entry.trim(), correction: "" });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const topic = safeText(o.topic || o.name || o.label);
    const explanation = safeText(o.explanation || o.detail || o.text);
    const correction = safeText(o.correction || o.fix);
    if (!topic && !explanation) continue;
    out.push({
      topic: topic || "General",
      explanation: explanation || topic,
      correction,
    });
  }
  return out;
}

function parseDimensionScores(pq: Record<string, unknown>): DimensionScores | undefined {
  const dims =
    pq.dimension_scores && typeof pq.dimension_scores === "object"
      ? (pq.dimension_scores as Record<string, unknown>)
      : pq;
  const hasAny =
    dims.technical_accuracy != null ||
    dims.concept_coverage != null ||
    dims.depth != null ||
    dims.communication != null ||
    dims.confidence != null;
  if (!hasAny) return undefined;
  return {
    technicalAccuracy: normalizePercent(dims.technical_accuracy, 0),
    conceptCoverage: normalizePercent(dims.concept_coverage, 0),
    depth: normalizePercent(dims.depth ?? dims.depth_of_explanation, 0),
    communication: normalizePercent(dims.communication ?? dims.communication_quality, 0),
    confidence: normalizePercent(dims.confidence ?? dims.confidence_level, 0),
  };
}

export function turnHasProfessionalAssessment(t: EnrichedTurn): boolean {
  return Boolean(
    t.evaluationSummary ||
      t.interviewFeedback ||
      t.correctConcepts.length ||
      t.improvementAreas.length ||
      t.followUpQuestions.length ||
      t.dimensionScores ||
      t.overallRating != null,
  );
}

function boundaryLabelForTurn(
  report: Record<string, unknown>,
  perQ: Record<string, unknown> | null,
  turnIdx: number,
): string | undefined {
  const pqLabel = safeText(perQ?.boundary_label);
  if (pqLabel) return pqLabel;
  const bq = report.boundary_question;
  if (!bq || typeof bq !== "object") return undefined;
  const row = bq as Record<string, unknown>;
  const reportTurn = Number(row.report_turn);
  if (Number.isFinite(reportTurn) && reportTurn === turnIdx) {
    return safeText(row.label) || undefined;
  }
  return undefined;
}

export function enrichedTurnsFromRecord(record: InterviewRecord | null): EnrichedTurn[] {
  if (!record) return [];
  const qs = (record.questions || []).map((x) => safeText(x));
  const ans = (record.answers || []).map((x) => safeText(x));
  const report = (record.report || {}) as Record<string, unknown>;
  const perQ =
    (Array.isArray(report.per_question) && report.per_question) ||
    (Array.isArray(report.question_evaluations) && report.question_evaluations) ||
    (Array.isArray(report.evaluations) && report.evaluations) ||
    null;
  const turns = record.turns;
  const max = Math.max(qs.length, ans.length);
  const out: EnrichedTurn[] = [];
  for (let i = 0; i < max; i++) {
    const t =
      Array.isArray(turns) && turns[i] && typeof turns[i] === "object"
        ? (turns[i] as Record<string, unknown>)
        : {};
    const pq =
      perQ && perQ[i] && typeof perQ[i] === "object"
        ? (perQ[i] as Record<string, unknown>)
        : {};
    const rawScore = t.score ?? pq.score ?? pq.question_score ?? pq.points;
    const scoreNum = Number(rawScore);
    const hasNumericScore =
      rawScore !== undefined && rawScore !== null && rawScore !== "" && Number.isFinite(scoreNum);
    const score = hasNumericScore ? normalizePercent(scoreNum, 0) : undefined;
    const fb = safeText(t.feedback ?? pq.feedback ?? pq.evaluation ?? pq.comment ?? pq.summary);
    const strengths = Array.isArray(t.strengths)
      ? (t.strengths as unknown[]).map(safeText).filter(Boolean)
      : Array.isArray(pq.strengths)
        ? (pq.strengths as unknown[]).map(safeText).filter(Boolean)
        : [];
    const weaknesses = Array.isArray(t.weaknesses)
      ? (t.weaknesses as unknown[]).map(safeText).filter(Boolean)
      : Array.isArray(pq.weaknesses)
        ? (pq.weaknesses as unknown[]).map(safeText).filter(Boolean)
        : [];
    for (const mistakeKey of [
      "technical_mistakes",
      "conceptual_mistakes",
      "wrong_assumptions",
      "what_missed",
    ] as const) {
      const rawMistakes = t[mistakeKey] ?? pq[mistakeKey];
      if (Array.isArray(rawMistakes)) {
        for (const item of rawMistakes) {
          const text = safeText(item);
          if (text) weaknesses.push(text);
        }
      } else {
        const text = safeText(rawMistakes);
        if (text) weaknesses.push(text);
      }
    }
    const ideal = safeText(
      t.ideal_answer ?? pq.ideal_answer ?? pq.suggested_answer ?? pq.reference_answer ?? pq.model_answer,
    );
    const expected = safeText(
      t.expected_answer ?? pq.expected_answer ?? pq.expected_interview_answer ?? ideal,
    );
    const overallRaw = t.overall_rating ?? pq.overall_rating ?? pq.rating;
    const overallNum = Number(overallRaw);
    const overallRating =
      overallRaw !== undefined && overallRaw !== null && overallRaw !== "" && Number.isFinite(overallNum)
        ? Math.max(0, Math.min(10, Math.round(overallNum * 10) / 10))
        : undefined;
    const evaluationSummary = safeText(
      t.candidate_summary ?? pq.candidate_summary ?? t.summary ?? pq.summary ?? pq.evaluation_summary ?? fb,
    );
    const correctConcepts = parseConceptItems(
      t.correct_concepts ?? pq.correct_concepts ?? pq.what_candidate_explained_correctly,
    );
    const improvementAreas = parseImprovementItems(
      t.improvement_areas ?? pq.improvement_areas ?? pq.areas_for_improvement,
    );
    const howToImprove = safeText(t.how_to_improve ?? pq.how_to_improve);
    if (howToImprove) {
      improvementAreas.push({
        topic: "How to improve",
        explanation: howToImprove,
        correction: "",
      });
    }
    for (const tipKey of ["interview_tips", "recommended_study_topics"] as const) {
      const rawTips = t[tipKey] ?? pq[tipKey];
      if (Array.isArray(rawTips)) {
        for (const tip of rawTips) {
          const text = safeText(tip);
          if (text) {
            improvementAreas.push({ topic: tipKey === "interview_tips" ? "Interview tip" : "Study topic", explanation: text, correction: "" });
          }
        }
      }
    }
    const interviewFeedback = safeText(
      t.interview_feedback ?? pq.interview_feedback ?? pq.detailed_feedback ?? pq.manager_feedback,
    );
    const followRaw = t.follow_up_questions ?? pq.follow_up_questions ?? pq.manager_follow_up_questions;
    const followUpQuestions = Array.isArray(followRaw)
      ? (followRaw as unknown[]).map(safeText).filter(Boolean)
      : [];
    const dimensionScores = parseDimensionScores({ ...pq, ...t });
    const excludedFromScore =
      pq.excluded_from_score === true || pq.excluded_from_evaluation === true;
    out.push({
      idx: i + 1,
      question: qs[i] || safeText(t.question),
      answer: ans[i] || safeText(t.answer),
      score,
      feedback: fb || undefined,
      strengths,
      weaknesses,
      idealAnswer: ideal || undefined,
      overallRating,
      evaluationSummary: evaluationSummary || undefined,
      correctConcepts,
      improvementAreas,
      expectedAnswer: expected || undefined,
      interviewFeedback: interviewFeedback || undefined,
      followUpQuestions,
      dimensionScores,
      boundaryLabel: boundaryLabelForTurn(report, pq, i + 1),
      excludedFromScore,
      excludedBy: excludedFromScore ? safeText(pq.excluded_by) || undefined : undefined,
      excludedAt: excludedFromScore ? safeText(pq.excluded_at) || undefined : undefined,
      excludedReason: excludedFromScore
        ? safeText(pq.excluded_reason || pq.reason) || undefined
        : undefined,
    });
  }
  return out.filter((x) => x.question || x.answer);
}

export function problemSolvingScore(
  report: Record<string, unknown> | undefined,
  s: Pick<CandidateInterviewSummary, "communication_score" | "technical_score" | "confidence_score">,
): number {
  if (report) {
    const reasons = report.score_reasons as Record<string, { score?: unknown }> | undefined;
    if (reasons?.problem_solving?.score != null) {
      return normalizePercent(reasons.problem_solving.score, 0);
    }
    const raw = report.problem_solving_score ?? report.analytical_score ?? report.problem_solving;
    if (raw !== undefined && raw !== null && raw !== "") {
      const ps = Number(raw);
      if (Number.isFinite(ps)) return normalizePercent(ps, 0);
    }
  }
  const a = normalizePercent(s.communication_score, 0);
  const b = normalizePercent(s.technical_score, 0);
  const c = normalizePercent(s.confidence_score, 0);
  return Math.round((a + b + c) / 3);
}

export function completionRatePercent(summary: CandidateInterviewSummary | null): number {
  if (!summary) return 0;
  const q = Math.max(0, Number(summary.questions_count) || 0);
  const a = Math.max(0, Number(summary.answers_count) || 0);
  if (!q) return summary.submitted ? 100 : 0;
  return Math.min(100, Math.round((a / q) * 100));
}

export function pickLatestInterviewId(interviews: CandidateInterviewSummary[]): string {
  const sorted = [...interviews].sort((x, y) => {
    const tx = Date.parse(x.updated_at_ist || x.created_at_ist || x.created_at || "");
    const ty = Date.parse(y.updated_at_ist || y.created_at_ist || y.created_at || "");
    return (Number.isFinite(ty) ? ty : 0) - (Number.isFinite(tx) ? tx : 0);
  });
  const withReport = sorted.find((i) => i.has_report) || sorted[0];
  return withReport?.id || "";
}
