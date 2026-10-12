import { InterviewReportsPage } from "./InterviewReports";

/** Interview Platform ▸ Reports — the one list of every AI interview (11 Oct 2026). */
export function CandidatesPage({
  onOpenCandidateReport,
}: {
  onOpenCandidateReport?: (candidateId: string, interviewId?: string) => void;
}) {
  return <InterviewReportsPage onOpenCandidateReport={onOpenCandidateReport} />;
}
