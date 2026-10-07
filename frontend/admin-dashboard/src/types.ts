// May 2026: extended pipeline outcomes. "On Hold" parks a candidate in the
// active pipeline without selecting or rejecting them — used when HR is
// waiting on extra info / panel feedback / scheduling slack.
export type InterviewStatus = "Selected" | "Rejected" | "Pending Review" | "On Hold";

export interface Interview {
  id: string;
  sessionName: string;
  templateId?: string;
  templateTitle?: string;
  opportunityId?: string;
  customerName?: string;
  date: string;
  skills: string[];
  score: number;
  status: InterviewStatus;
  completion_status?: string;
  final_status?: string;
  report_status?: string;
  scheduled_at_local?: string;
  completed_at_ist?: string;
  invite_token?: string;
}

export interface Candidate {
  id: string;
  name: string;
  email: string;
  role: string;
  interviews: Interview[];
  /** HR-only: persisted shortlist/reject/on_hold from the full report actions */
  hr_decision?: "shortlist" | "reject" | "on_hold" | null;
}

export interface Session {
  id: string;
  name: string;
  date: string;
  category: string;
  opportunityId?: string;
  customerName?: string;
  candidate_count?: number;
}

export type InterviewTurn = {
  question: string;
  answer: string;
  score?: number;
  feedback?: string;
  difficulty?: string;
  timestamp?: string;
};

export type InterviewRecord = {
  id: string;
  job_id?: string;
  job_title?: string;
  opportunityId?: string;
  customerName?: string;
  candidate_name?: string;
  candidate_email?: string;
  candidate_role?: string;
  candidate_profile?: Record<string, any>;
  created_at_ist?: string;
  updated_at_ist?: string;
  difficulty?: string;
  session_difficulty?: string;
  timing_mode?: "count" | "time" | string;
  time_limit_sec?: number;
  /** The invite the interview ran on — keys the session recording (7 Oct 2026). */
  invite_token?: string;
  skills?: string[];
  questions?: string[];
  answers?: string[];
  report?: Record<string, any>;
  // Optional: if present in newer records
  turns?: InterviewTurn[];
};

export type AtsStatus = "Strong Match" | "Moderate Match" | "Weak Match";

export interface CandidateInterviewSummary {
  id: string;
  /** Resolved job / interview template title when available */
  job_title?: string;
  opportunityId?: string;
  customerName?: string;
  scheduled_at_local: string;
  created_at: string;
  created_at_ist: string;
  created_date_ist: string;
  created_time_ist: string;
  updated_at: string;
  updated_at_ist: string;
  updated_date_ist: string;
  updated_time_ist: string;
  duration_sec: number;
  score: number;
  status: InterviewStatus | string;
  difficulty: string;
  model: string;
  skills: string[];
  questions_count: number;
  answers_count: number;
  submitted: boolean;
  has_report: boolean;
  recommendation: string;
  summary: string;
  communication_score: number;
  technical_score: number;
  confidence_score: number;
  strengths: string[];
  weaknesses: string[];
  skill_breakdown: { skill: string; score: number }[];
  excluded_questions_count?: number;
}

export interface CandidateInterviewHistory {
  candidate: {
    id: string;
    name: string;
    email: string;
    role: string;
    skills: string[];
    status: InterviewStatus | string;
    hr_decision?: "shortlist" | "reject" | "on_hold" | null;
    total_interviews: number;
    avg_score: number;
  };
  interviews: CandidateInterviewSummary[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    has_more: boolean;
  };
}

export interface CandidateDeleteResult {
  status: string;
  deleted: boolean;
  candidate_id: string;
  removed: {
    interview_records?: number;
    interview_schedule?: number;
    login_data?: number;
    registration_data?: number;
    hr_records_file?: number;
    proctor_reports?: number;
    in_memory_sessions?: number;
    learning_rows?: number;
    interview_ids?: string[];
  };
}

