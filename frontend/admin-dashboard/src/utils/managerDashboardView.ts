import type {
  PositionSkillEvidence,
  StrengthsWeaknessesAnalysis,
  StrengthsWeaknessesQuestionItem,
} from "../types/strengthsWeaknesses";
import { normalizeAnalysisForManagerReview } from "./strengthsWeaknessesDisplay";

export type ManagerDashboardSnapshot = {
  candidateName: string;
  role: string;
  scorePercent: number;
  recommendation: string;
  interviewDate: string;
  aiVerdict: string;
  communicationScore?: number;
  technicalScore?: number;
};

export type SkillCard = {
  id: string;
  title: string;
  levelLabel: string;
  tone: "green" | "yellow" | "red";
  summary: string;
  bullets: string[];
};

export type HighlightAnswer = {
  rank: number;
  question_index: number;
  question: string;
  reason: string;
  score_display?: string;
};

export type ManagerDashboardView = {
  snapshot: ManagerDashboardSnapshot & {
    confidenceLevel: "High" | "Moderate" | "Low";
    hiringRecommendation: string;
  };
  strengthCards: SkillCard[];
  improvementCards: SkillCard[];
  topBest: HighlightAnswer[];
  topWeakest: HighlightAnswer[];
  followUpQuestions: string[];
  questions: StrengthsWeaknessesQuestionItem[];
};

/** Lower-case, punctuation-free — for "does this question cover the skill". */
function norm(text: string): string {
  return ` ${String(text || "").toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim()} `;
}

/** A question covers a skill when the skill's name appears in it as whole words. */
export function questionCoversSkill(question: string, skill: string): boolean {
  const core = norm(skill.replace(/\([^)]*\)/g, "")).trim();
  if (!core) return false;
  return norm(question).includes(` ${core} `);
}

function avgScore(items: StrengthsWeaknessesQuestionItem[]): number | null {
  const scores = items.map((q) => q.score).filter((s): s is number => s != null && Number.isFinite(s));
  if (!scores.length) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

const STATUS_LOOK: Record<PositionSkillEvidence["status"], { label: string; tone: SkillCard["tone"] }> = {
  shown: { label: "Strong", tone: "green" },
  mixed: { label: "Mixed", tone: "yellow" },
  thin: { label: "One answer", tone: "yellow" },
  weak: { label: "Weak", tone: "red" },
  not_tested: { label: "Not tested", tone: "red" },
};

function cleanLines(pool: string[]): string[] {
  const out: string[] = [];
  for (const b of pool) {
    const t = b.replace(/^[✓✗]\s*/, "").trim();
    if (t && t !== "None identified" && !out.includes(t)) out.push(t);
  }
  return out;
}

/** 21 Oct 2026 (user report "Strength Summary shows wrong skills"): the cards
 *  are the POSITION's skills, read from what the answers showed (server
 *  `position_skills`). The old fixed CAN / UDS / Troubleshooting themes are gone —
 *  they printed automotive skills on every report, whatever the position. */
export function buildSkillCards(
  questions: StrengthsWeaknessesQuestionItem[],
  positionSkills?: PositionSkillEvidence[] | null,
): { strength: SkillCard[]; improvement: SkillCard[] } {
  const strength: SkillCard[] = [];
  const improvement: SkillCard[] = [];

  for (const ps of positionSkills || []) {
    const matched = questions.filter((q) => !q.skipped && questionCoversSkill(q.question, ps.skill));
    const avg = ps.avg_score_percent;
    const good = ps.status === "shown" || ((ps.status === "mixed" || ps.status === "thin") && (avg ?? 0) >= 60);
    const look = STATUS_LOOK[ps.status] || STATUS_LOOK.mixed;
    const where = ps.questions?.length ? `Q${ps.questions.join(", Q")}` : "";
    const summary = ps.status === "not_tested"
      ? "Not asked in this interview — probe it in the next round."
      : `${ps.status_label}${where ? ` in ${where}` : ""}${avg != null ? ` · average ${Math.round(avg)}%` : ""}.`;
    const bullets = good
      ? cleanLines(matched.flatMap((q) => q.question_strengths))
      : cleanLines(matched.flatMap((q) => q.question_weaknesses));
    if (ps.estimate_overstated) bullets.unshift("The AI's own skill score is higher than these answers support.");
    const card: SkillCard = {
      id: `skill-${ps.skill}`,
      title: ps.mandatory ? `${ps.skill} · must-have` : ps.skill,
      levelLabel: good && look.tone === "yellow" ? "Good" : look.label,
      tone: good ? (ps.status === "shown" ? "green" : "yellow") : look.tone,
      summary,
      bullets: bullets.slice(0, 5),
    };
    (good ? strength : improvement).push(card);
  }

  if (!positionSkills?.length) {
    // Position skills unknown (older report): one card each way, from the answers.
    const avg = avgScore(questions.filter((q) => !q.skipped));
    strength.push({
      id: "foundation",
      title: "What went well",
      levelLabel: avg != null && avg >= 7 ? "Good" : "Partial",
      tone: avg != null && avg >= 7 ? "green" : "yellow",
      summary: "From the answers the AI scored best.",
      bullets: cleanLines(questions.flatMap((q) => q.question_strengths)).slice(0, 5),
    });
    improvement.push({
      id: "depth",
      title: "What to probe",
      levelLabel: "Follow up",
      tone: "yellow",
      summary: "From the weaker or skipped answers.",
      bullets: cleanLines(questions.flatMap((q) => q.question_weaknesses)).slice(0, 5),
    });
  }
  if (!strength.length) {
    strength.push({
      id: "none",
      title: "No position skill clearly shown",
      levelLabel: "—",
      tone: "red",
      summary: "None of the position's skills was answered well enough in this interview.",
      bullets: [],
    });
  }
  return { strength: strength.slice(0, 8), improvement: improvement.slice(0, 8) };
}

function highlightReason(q: StrengthsWeaknessesQuestionItem, kind: "best" | "weak"): string {
  if (kind === "best") {
    const s = q.question_strengths[0];
    if (s && s !== "None identified") return s.replace(/^[✓✗]\s*/, "");
    return "Strong explanation and accurate protocol understanding.";
  }
  const w = q.question_weaknesses[0];
  if (w) return w.replace(/^[✓✗]\s*/, "");
  return "Answer lacked sufficient technical depth.";
}

function buildHighlights(questions: StrengthsWeaknessesQuestionItem[], kind: "best" | "weak"): HighlightAnswer[] {
  const pool = questions.filter((q) => !q.skipped && q.score != null);
  const sorted = [...pool].sort((a, b) => {
    const sa = a.score ?? 0;
    const sb = b.score ?? 0;
    return kind === "best" ? sb - sa : sa - sb;
  });
  return sorted.slice(0, 5).map((q, i) => ({
    rank: i + 1,
    question_index: q.question_index,
    question: q.question,
    reason: highlightReason(q, kind),
    score_display: q.score_display,
  }));
}

function buildFollowUpQuestions(
  questions: StrengthsWeaknessesQuestionItem[],
  positionSkills: PositionSkillEvidence[] | null | undefined,
  topWeakest: HighlightAnswer[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (q: string) => {
    const t = q.trim();
    if (!t || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    out.push(t);
  };
  // The position's must-have skills that were not shown come first.
  const gaps = [...(positionSkills || [])]
    .filter((s) => s.status !== "shown")
    .sort((a, b) => Number(b.mandatory) - Number(a.mandatory));
  for (const s of gaps.slice(0, 3)) {
    add(s.status === "not_tested"
      ? `${s.skill}: walk me through a real task where you used it — what you built, what went wrong, how you fixed it.`
      : `${s.skill}: the L1 answer was ${s.status_label.toLowerCase()} — ask for a concrete example and the trade-offs.`);
  }
  for (const w of topWeakest.slice(0, 3)) {
    add(`Explain your approach to: ${w.question.replace(/\?+$/, "")}?`);
  }
  for (const q of questions.filter((x) => x.skipped).slice(0, 2)) {
    add(`Revisit skipped topic: ${q.question.replace(/\?+$/, "")}?`);
  }
  if (!out.length) {
    add("Walk me through your most recent project end to end — the design choices, a failure, and what you would change.");
  }
  return out.slice(0, 6);
}

function confidenceLevel(score: number, tech?: number): "High" | "Moderate" | "Low" {
  const t = tech ?? score;
  if (score >= 70 && t >= 60) return "High";
  if (score >= 50) return "Moderate";
  return "Low";
}

function hiringRecommendation(score: number, recommendation: string): string {
  const r = recommendation.toLowerCase();
  if (r.includes("reject") || r.includes("weak")) return "Hold — verify gaps before proceeding";
  if (r.includes("hire") || r.includes("select") || r.includes("consider") || r.includes("shortlist")) {
    return score >= 65 ? "Proceed to L2" : "Proceed with caution — schedule technical deep-dive";
  }
  if (score >= 72) return "Proceed to L2";
  if (score >= 55) return "Further evaluation recommended";
  return "Hold — additional assessment advised";
}

function splitAiVerdict(raw: string): string {
  const t = raw.trim();
  if (!t || t === "—") {
    return "Good technical foundation with areas to validate in follow-up.\nNeeds improvement in weaker topics identified below.";
  }
  const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]}\n${parts.slice(1).join(" ")}`;
  return t;
}

export function buildManagerDashboardView(
  analysis: StrengthsWeaknessesAnalysis | null,
  snapshot: ManagerDashboardSnapshot,
): ManagerDashboardView | null {
  const normalized = normalizeAnalysisForManagerReview(analysis);
  if (!normalized?.questions?.length) return null;

  const questions = normalized.questions;
  const positionSkills = analysis?.position_skills || null;
  const { strength: strengthCards, improvement: improvementCards } = buildSkillCards(questions, positionSkills);
  const topBest = buildHighlights(questions, "best");
  const topWeakest = buildHighlights(questions, "weak");
  const followUpQuestions = buildFollowUpQuestions(questions, positionSkills, topWeakest);

  return {
    snapshot: {
      ...snapshot,
      confidenceLevel: confidenceLevel(snapshot.scorePercent, snapshot.technicalScore),
      hiringRecommendation: hiringRecommendation(snapshot.scorePercent, snapshot.recommendation),
      aiVerdict: splitAiVerdict(snapshot.aiVerdict),
    },
    strengthCards,
    improvementCards,
    topBest,
    topWeakest,
    followUpQuestions,
    questions,
  };
}
