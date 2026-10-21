/** The analysis version that reads the report against the position's skills. */
export const SW_POSITION_VERSION = 3;

export type StrengthsWeaknessesDiscussionPoint = {
  question_index: number;
  reason: string;
};

export type StrengthsWeaknessesQuestionItem = {
  question_index: number;
  question: string;
  answer: string;
  question_strengths: string[];
  question_weaknesses: string[];
  score?: number | null;
  score_display?: string;
  skipped?: boolean;
};

/** One POSITION skill and what the answers showed (server, 21 Oct 2026). */
export type PositionSkillEvidence = {
  skill: string;
  mandatory: boolean;
  status: "shown" | "mixed" | "thin" | "weak" | "not_tested";
  status_label: string;
  avg_score_percent: number | null;
  questions: number[];
  ai_estimate_percent?: number | null;
  estimate_overstated?: boolean;
};

export type StrengthsWeaknessesAnalysis = {
  version?: number;
  complete?: boolean;
  generated_at_ist?: string;
  overall_strengths: string[];
  overall_weaknesses: string[];
  overall_key_strengths?: string[];
  overall_improvement_areas?: string[];
  discussion_points?: StrengthsWeaknessesDiscussionPoint[];
  questions: StrengthsWeaknessesQuestionItem[];
  /** Present when the report was read against the position's skills (v3). */
  position_skills?: PositionSkillEvidence[];
  position_caveats?: string[];
  ai_notes_strengths?: string[];
  ai_notes_weaknesses?: string[];
};
