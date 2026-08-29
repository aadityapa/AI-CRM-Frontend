import type {
  Candidate,
  CandidateDeleteResult,
  CandidateInterviewHistory,
  InterviewRecord,
  InterviewStatus,
  Session,
} from "../types";
import { apiDelete, apiGet, apiPatch, apiPut } from "./client";
import { ensureSessionsFromCandidates } from "../utils/scoreUtils";

export type InterviewSchedule = {
  id: string;
  candidate_name: string;
  candidate_email: string;
  scheduled_at_local: string;
  invite_token: string;
  invite_url?: string;
  status?: string;
  session_status?: string;
  notes?: string;
  job_id?: string;
  job_title?: string;
  opportunityId?: string;
  customerName?: string;
  template_name?: string;
  role?: string;
  created_date_ist?: string;
  created_time_ist?: string;
};

export async function getDashboardData(limit = 200): Promise<{ candidates: Candidate[]; sessions: Session[] }> {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 500));
  const data = await apiGet<{ candidates: Candidate[]; sessions: Session[] }>(`/hr/dashboard?limit=${safeLimit}`);
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  return {
    candidates,
    sessions: ensureSessionsFromCandidates(candidates, sessions),
  };
}

export async function getSchedules(): Promise<InterviewSchedule[]> {
  const data = await apiGet<{ schedules: InterviewSchedule[] }>("/hr/schedules");
  return Array.isArray(data.schedules) ? data.schedules : [];
}

export async function deleteSchedule(scheduleId: string): Promise<boolean> {
  const id = String(scheduleId || "").trim();
  if (!id) return false;
  await apiDelete(`/hr/schedules/${encodeURIComponent(id)}`);
  return true;
}

export async function deleteInterviewRecord(interviewId: string): Promise<boolean> {
  const id = String(interviewId || "").trim();
  if (!id) return false;
  await apiDelete(`/hr/interviews/${encodeURIComponent(id)}`);
  return true;
}

export async function getCandidateInterviewHistory(
  candidateId: string,
  opts: { limit?: number; offset?: number; iid?: string } = {}
): Promise<CandidateInterviewHistory | null> {
  const id = String(candidateId || "").trim();
  if (!id) return null;
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.offset) params.set("offset", String(opts.offset));
  // Interview-id hint: lets the server self-heal a link whose candidate email
  // doesn't match the one the interview was scheduled under.
  if (opts.iid) params.set("iid", String(opts.iid).trim());
  const qs = params.toString();
  const path = `/hr/candidates/${encodeURIComponent(id)}/interviews${qs ? `?${qs}` : ""}`;
  const data = await apiGet<CandidateInterviewHistory>(path);
  return data || null;
}

export async function getCandidateInterviewDetail(
  candidateId: string,
  interviewId: string
): Promise<InterviewRecord | null> {
  const cid = String(candidateId || "").trim();
  const iid = String(interviewId || "").trim();
  if (!cid || !iid) return null;
  const data = await apiGet<{ record: InterviewRecord }>(
    `/hr/candidates/${encodeURIComponent(cid)}/interviews/${encodeURIComponent(iid)}`
  );
  return data?.record || null;
}

export type StrengthsWeaknessesAnalysisResponse = {
  analysis: {
    version?: number;
    complete?: boolean;
    generated_at_ist?: string;
    overall_strengths: string[];
    overall_weaknesses: string[];
    questions: Array<{
      question_index: number;
      question: string;
      answer: string;
      question_strengths: string[];
      question_weaknesses: string[];
      score?: number | null;
      score_display?: string;
    }>;
  };
  cached: boolean;
};

export type ScoreExclusionResponse = {
  status: string;
  interview_id: string;
  question_index: number;
  excluded?: boolean;
  record: InterviewRecord;
  scoring_summary?: Record<string, unknown>;
  overall_score?: number;
  recommendation?: string;
};

export async function excludeQuestionFromScore(
  candidateId: string,
  interviewId: string,
  questionIndex: number,
  reason?: string,
): Promise<ScoreExclusionResponse> {
  const cid = String(candidateId || "").trim();
  const iid = String(interviewId || "").trim();
  const qidx = Number(questionIndex);
  if (!cid || !iid || !Number.isFinite(qidx) || qidx < 1) {
    throw new Error("Candidate, interview, and question index are required.");
  }
  return apiPatch<ScoreExclusionResponse>(
    `/hr/candidates/${encodeURIComponent(cid)}/interviews/${encodeURIComponent(iid)}/per-question/${qidx}/score-exclusion`,
    { excluded: true, reason: String(reason || "").trim() || undefined },
  );
}

export async function includeQuestionInScore(
  candidateId: string,
  interviewId: string,
  questionIndex: number,
): Promise<ScoreExclusionResponse> {
  const cid = String(candidateId || "").trim();
  const iid = String(interviewId || "").trim();
  const qidx = Number(questionIndex);
  if (!cid || !iid || !Number.isFinite(qidx) || qidx < 1) {
    throw new Error("Candidate, interview, and question index are required.");
  }
  return apiPatch<ScoreExclusionResponse>(
    `/hr/candidates/${encodeURIComponent(cid)}/interviews/${encodeURIComponent(iid)}/per-question/${qidx}/score-exclusion`,
    { excluded: false },
  );
}

export async function getCandidateStrengthsWeaknesses(
  candidateId: string,
  interviewId: string,
): Promise<StrengthsWeaknessesAnalysisResponse | null> {
  const cid = String(candidateId || "").trim();
  const iid = String(interviewId || "").trim();
  if (!cid || !iid) return null;
  return apiGet<StrengthsWeaknessesAnalysisResponse>(
    `/hr/candidates/${encodeURIComponent(cid)}/interviews/${encodeURIComponent(iid)}/strengths-weaknesses`,
    { force: true },
  );
}

export async function deleteCandidate(candidateId: string): Promise<CandidateDeleteResult> {
  const id = String(candidateId || "").trim();
  if (!id) throw new Error("Candidate id is required.");
  return apiDelete<CandidateDeleteResult>(`/hr/candidates/${encodeURIComponent(id)}`);
}

function statusToApiSlug(s: InterviewStatus): string {
  if (s === "Selected") return "selected";
  if (s === "Rejected") return "rejected";
  // May 2026: deferred outcome rides through the same /status endpoint.
  if (s === "On Hold") return "on_hold";
  return "pending_review";
}

export async function patchInterviewHrStatus(
  interviewId: string,
  status: InterviewStatus,
): Promise<{ status: string; interview_id: string; interview_status: string }> {
  const id = String(interviewId || "").trim();
  if (!id) throw new Error("Interview id is required.");
  return apiPatch(`/hr/interviews/${encodeURIComponent(id)}/status`, { status: statusToApiSlug(status) });
}

export async function setHrCandidateDecision(
  candidateId: string,
  decision: "shortlist" | "reject" | "on_hold" | null
): Promise<{ status: string; candidate_id: string; hr_decision: string | null }> {
  const id = String(candidateId || "").trim();
  if (!id) throw new Error("Candidate id is required.");
  return apiPut(`/hr/candidates/${encodeURIComponent(id)}/hr-decision`, {
    decision: decision === null ? null : decision,
  });
}

