import type { CandidateInterviewSummary, InterviewRecord } from "../../types";
import type { StrengthsWeaknessesAnalysis } from "../../types/strengthsWeaknesses";
import {
  buildManagerDashboardView,
  type ManagerDashboardView,
} from "../managerDashboardView";
import {
  enrichedTurnsFromRecord,
  normalizePercent,
  overallFromReport,
  problemSolvingScore,
  safeText,
  type EnrichedTurn,
} from "../reportExtract";
import { fmtDateLabelPdf } from "../../components/pdf/dateFmt";

export type InterviewPdfData = {
  candidateName: string;
  candidateEmail: string;
  role: string;
  customerName: string;
  opportunityId: string;
  interviewDate: string;
  interviewId: string;
  overallScore: number;
  technicalScore: number;
  communicationScore: number;
  confidenceScore: number;
  problemSolvingScore: number;
  hiringStatus: string;
  modelRecommendation: string;
  finalRecommendationLabel: string;
  finalRecommendationReasoning: string;
  overallFeedback: string;
  strengths: string[];
  improvementAreas: string[];
  skillBreakdown: { skill: string; score: number }[];
  turns: EnrichedTurn[];
  nextInterviewFocusAreas: string[];
  managerDashboard: ManagerDashboardView | null;
};

function normalizeScore(raw: unknown, fallback = 0): number {
  return normalizePercent(raw, fallback);
}

function mapRecommendationLabel(score: number, recommendation: string): string {
  const r = recommendation.toLowerCase();
  if (r.includes("reject") || r.includes("no hire") || r.includes("weak")) return "No Hire";
  if (r.includes("strong hire")) return "Strong Hire";
  if (r.includes("hire") && score >= 75) return "Strong Hire";
  if (r.includes("hire") || r.includes("select") || r.includes("shortlist")) return "Hire";
  if (r.includes("borderline") || r.includes("consider") || r.includes("pending")) return "Borderline";
  if (r.includes("further") || r.includes("evaluation") || r.includes("hold")) {
    return "Need Further Evaluation";
  }
  if (score >= 80) return "Strong Hire";
  if (score >= 65) return "Hire";
  if (score >= 50) return "Borderline";
  if (score >= 35) return "Need Further Evaluation";
  return "No Hire";
}

function buildRecommendationReasoning(
  report: Record<string, unknown>,
  overallFeedback: string,
  strengths: string[],
  gaps: string[],
  score: number,
  recommendation: string,
): string {
  const dedicated =
    safeText(report.recommendation_reason) ||
    safeText(report.recommendation_rationale) ||
    safeText(report.fitment_reasoning) ||
    safeText(report.recommendation_explanation);
  if (dedicated) return dedicated;

  const parts: string[] = [];
  if (overallFeedback && overallFeedback !== "—") {
    parts.push(overallFeedback);
  }
  if (strengths.length) {
    parts.push(
      `Key strengths observed: ${strengths.slice(0, 4).join("; ")}.`,
    );
  }
  if (gaps.length) {
    parts.push(
      `Areas requiring follow-up: ${gaps.slice(0, 4).join("; ")}.`,
    );
  }
  parts.push(
    `Based on an overall score of ${score}% and model recommendation "${recommendation || "Pending"}", the assessment is ${mapRecommendationLabel(score, recommendation)}.`,
  );
  return parts.join("\n\n");
}

function collectFocusAreas(
  turns: EnrichedTurn[],
  gaps: string[],
  managerDashboard: ManagerDashboardView | null,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (raw: string) => {
    const t = raw.replace(/^[✓✗❌✅]\s*/, "").trim();
    if (!t || t === "—" || t === "None identified") return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  for (const card of managerDashboard?.improvementCards || []) {
    add(card.title);
    for (const b of card.bullets) add(b);
  }
  for (const g of gaps) add(g);
  for (const t of turns) {
    for (const item of t.improvementAreas) {
      add(item.topic);
      if (item.correction) add(item.correction);
    }
    for (const w of t.weaknesses) add(w);
  }
  for (const q of managerDashboard?.followUpQuestions || []) {
    const topic = q.replace(/^Explain your approach to:\s*/i, "").replace(/^Revisit skipped topic:\s*/i, "");
    if (topic.length < 120) add(topic);
  }

  if (!out.length) {
    return [
      "Core architecture and system design fundamentals",
      "Depth of explanation with practical examples",
      "Production debugging and troubleshooting scenarios",
      "Role-specific advanced topics from the interview template",
    ];
  }
  return out.slice(0, 12);
}

function strengthLines(strengths: string[]): string[] {
  return strengths
    .map((s) => s.replace(/^[✓✗]\s*/, "").trim())
    .filter((s) => s && s !== "—" && s !== "None identified");
}

export function buildInterviewPdfData(
  candidateName: string,
  candidateEmail: string,
  candidateRole: string,
  hiringStatus: string,
  interview: CandidateInterviewSummary,
  record: InterviewRecord | null,
  swAnalysis: StrengthsWeaknessesAnalysis | null,
): InterviewPdfData {
  const report = (record?.report || {}) as Record<string, unknown>;
  const commEval = (report.communication_evaluation || {}) as Record<string, unknown>;
  const overall = overallFromReport(report, normalizeScore(interview.score));
  const comm = normalizeScore(
    commEval.communication_score ?? commEval.overall_score ?? interview.communication_score ?? 0,
  );
  const tech = normalizeScore(report.technical_score ?? interview.technical_score ?? overall);
  const conf = normalizeScore(
    commEval.presentation_score ?? commEval.confidence_score ?? interview.confidence_score ?? comm,
  );
  const prob = problemSolvingScore(report, interview);
  const modelRecommendation =
    safeText(interview.recommendation) ||
    safeText((report.recommendation as string) || "") ||
    safeText((report.overall_recommendation as string) || "") ||
    safeText(String(report.fitment || "")) ||
    "Pending Review";

  const overallFeedback =
    safeText(report.scoring_rationale) ||
    safeText(report.overall_summary || report.summary || report.feedback) ||
    safeText(interview.summary) ||
    "—";

  const strengths =
    (Array.isArray(report.strengths) && (report.strengths as string[]).length
      ? (report.strengths as string[])
      : interview.strengths) || [];

  const gaps =
    (Array.isArray(report.weaknesses) && (report.weaknesses as string[]).length
      ? (report.weaknesses as string[])
      : interview.weaknesses) || [];

  const swFromRecord = report.strengths_weaknesses_analysis as StrengthsWeaknessesAnalysis | undefined;
  const analysis =
    swAnalysis?.questions?.length
      ? swAnalysis
      : swFromRecord?.complete
        ? swFromRecord
        : null;

  const managerDashboard = buildManagerDashboardView(analysis, {
    candidateName,
    role: safeText(interview.job_title) || candidateRole,
    scorePercent: overall,
    recommendation: modelRecommendation,
    interviewDate: fmtDateLabelPdf(
      interview.scheduled_at_local || interview.created_at_ist || interview.created_at,
    ),
    aiVerdict: overallFeedback,
    communicationScore: comm,
    technicalScore: tech,
  });

  const mergedStrengths = strengthLines(
    managerDashboard?.strengthCards.flatMap((c) => [c.title, ...c.bullets]) || [],
  );
  const finalStrengths =
    mergedStrengths.length > 0 ? mergedStrengths : strengthLines(strengths as string[]);

  const mergedGaps = strengthLines(
    managerDashboard?.improvementCards.flatMap((c) => [c.title, ...c.bullets]) || [],
  );
  const finalGaps = mergedGaps.length > 0 ? mergedGaps : strengthLines(gaps as string[]);

  const turns = enrichedTurnsFromRecord(record);
  const finalLabel = mapRecommendationLabel(overall, modelRecommendation);

  return {
    candidateName,
    candidateEmail,
    role: safeText(interview.job_title) || candidateRole,
    customerName: safeText(interview.customerName || record?.customerName),
    opportunityId: safeText(interview.opportunityId || record?.opportunityId),
    interviewDate: fmtDateLabelPdf(
      interview.scheduled_at_local || interview.created_at_ist || interview.created_at,
    ),
    interviewId: interview.id,
    overallScore: overall,
    technicalScore: tech,
    communicationScore: comm,
    confidenceScore: conf,
    problemSolvingScore: prob,
    hiringStatus: hiringStatus || String(interview.status || "Pending Review"),
    modelRecommendation: modelRecommendation || "Pending Review",
    finalRecommendationLabel: finalLabel,
    finalRecommendationReasoning: buildRecommendationReasoning(
      report,
      overallFeedback,
      finalStrengths,
      finalGaps,
      overall,
      modelRecommendation,
    ),
    overallFeedback,
    strengths: finalStrengths.length ? finalStrengths : ["No significant strengths identified in aggregate review."],
    improvementAreas: finalGaps.length ? finalGaps : ["No specific improvement areas recorded."],
    skillBreakdown: interview.skill_breakdown || [],
    turns,
    nextInterviewFocusAreas: collectFocusAreas(turns, finalGaps, managerDashboard),
    managerDashboard,
  };
}
