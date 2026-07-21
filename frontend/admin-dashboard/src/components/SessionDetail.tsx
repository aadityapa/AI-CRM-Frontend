import { memo } from "react";
import { Calendar, LayoutTemplate, Loader2, Trash2, Users } from "lucide-react";
import type { Candidate, Interview, Session } from "../types";
import { ScoreBadge } from "./ScoreBadge";
import { StatusPill } from "./StatusPill";
import { sessionBenchmark } from "../utils/scoreUtils";
import { CrmMetaLine } from "./CrmMetaLine";

function SessionDetailImpl({
  session,
  candidates,
  onOpenCandidate,
  onRequestDeleteInterview,
  deleteBusyInterviewId = "",
}: {
  session: Session;
  candidates: Candidate[];
  onOpenCandidate: (candidateId: string) => void;
  onRequestDeleteInterview?: (candidate: Candidate, interview: Interview) => void;
  deleteBusyInterviewId?: string;
}) {
  const bench = sessionBenchmark(session.id, candidates);

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
      <div className="glass p-8 rounded-card shadow-raised flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 rounded-card bg-surface-2 flex items-center justify-center text-violet-600 ring-1 ring-inset ring-subtle dark:text-violet-300">
            <LayoutTemplate className="w-10 h-10" />
          </div>
          <div>
            <p className="text-xs font-black uppercase text-violet-500 tracking-widest">Interview Template</p>
            <h2 className="text-display text-2xl font-bold text-primary tracking-tight">{session.name}</h2>
            <div className="flex items-center gap-4 mt-1 flex-wrap">
              <span className="text-violet-600 dark:text-violet-300 font-bold text-sm uppercase tracking-wider bg-surface-2 px-3 py-1 rounded-full ring-1 ring-inset ring-subtle">
                {session.category || "Template"}
              </span>
              <span className="text-muted text-sm font-medium flex items-center gap-1">
                <Calendar className="w-4 h-4" /> Latest activity: {session.date || "—"}
              </span>
            </div>
            <CrmMetaLine
              opportunityId={session.opportunityId}
              customerName={session.customerName}
              className="mt-3"
            />
          </div>
        </div>
        <div className="text-right">
          <p className="text-display text-2xl font-bold tabular-nums text-primary">{bench.attendees.length}</p>
          <p className="text-xs font-black uppercase text-muted tracking-widest">Candidates who gave this interview</p>
        </div>
      </div>

      <div className="bg-surface-1 rounded-card border border-subtle shadow-raised overflow-hidden">
        <div className="px-8 py-5 border-b border-subtle flex items-center justify-between bg-surface-2">
          <h3 className="font-black text-secondary uppercase text-xs tracking-widest flex items-center gap-2">
            <Users className="w-4 h-4 text-violet-500" /> Candidates for this Template
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-muted text-xs uppercase font-black tracking-widest border-b border-subtle">
                <th className="px-8 py-4">Candidate Name</th>
                <th className="px-8 py-4">Current Role</th>
                <th className="px-8 py-4 text-center">Score</th>
                <th className="px-8 py-4">Status</th>
                <th className="px-8 py-4 text-right">Evaluation</th>
                {onRequestDeleteInterview ? <th className="px-8 py-4 text-right">Delete</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {bench.attendees.map(({ candidate, interview }) => (
                <tr key={candidate.id} className="group row-hover transition-colors duration-micro ease-smooth">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center font-bold text-secondary ring-1 ring-inset ring-subtle">
                        {candidate.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-black text-primary">{candidate.name}</p>
                        <p className="text-xs text-muted font-medium">{candidate.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6 text-sm font-bold text-secondary">{candidate.role}</td>
                  <td className="px-8 py-6 text-center">
                    <ScoreBadge score={interview.score} />
                  </td>
                  <td className="px-8 py-6">
                    <StatusPill status={interview.status} />
                  </td>
                  <td className="px-8 py-6 text-right">
                    <button
                      onClick={() => onOpenCandidate(candidate.id)}
                      className="text-violet-600 dark:text-violet-300 text-xs font-black uppercase tracking-widest border border-subtle px-3 py-1.5 rounded-control transition-colors duration-micro ease-smooth hover:bg-surface-2 hover:border-strong"
                    >
                      Full Profile
                    </button>
                  </td>
                  {onRequestDeleteInterview ? (
                    <td className="px-8 py-6 text-right">
                      <button
                        type="button"
                        onClick={() => onRequestDeleteInterview(candidate, interview)}
                        disabled={deleteBusyInterviewId === interview.id}
                        className="inline-flex items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-danger transition-colors duration-micro ease-smooth hover:bg-danger-soft disabled:opacity-60 disabled:pointer-events-none"
                        title="Delete this interview/report"
                      >
                        {deleteBusyInterviewId === interview.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        Delete
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
              {!bench.attendees.length ? (
                <tr>
                  <td className="px-8 py-8 text-muted" colSpan={onRequestDeleteInterview ? 6 : 5}>
                    No attendees found for this session.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mini analytics cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-surface-1 p-6 rounded-card border border-subtle shadow-raised">
          <p className="text-xs font-black uppercase text-muted tracking-widest mb-1">Session Benchmark</p>
          <p className="text-display text-2xl font-bold tabular-nums text-primary">{bench.averageScore}%</p>
          <p className="text-xs text-muted mt-1">Average across all participants</p>
        </div>
        <div className="bg-surface-1 p-6 rounded-card border border-subtle shadow-raised">
          <p className="text-xs font-black uppercase text-muted tracking-widest mb-1">Top Performer</p>
          <p className="text-display text-2xl font-bold text-success">{bench.topPerformer || "-"}</p>
          <p className="text-xs text-muted mt-1">Highest score in this batch</p>
        </div>
        <div className="bg-surface-1 p-6 rounded-card border border-subtle shadow-raised">
          <p className="text-xs font-black uppercase text-muted tracking-widest mb-1">Difficulty Index</p>
          <div className="flex gap-1 mt-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <div
                key={star}
                className={`h-2 flex-1 rounded-full ${star <= bench.difficultyIndex ? "bg-gradient-to-r from-brand-500 to-violet-500" : "bg-surface-2"}`}
              />
            ))}
          </div>
          <p className="text-xs text-muted mt-2">Lower avg score ⇒ higher difficulty</p>
        </div>
      </div>
    </div>
  );
}

export const SessionDetail = memo(
  SessionDetailImpl,
  (prev, next) =>
    prev.session === next.session &&
    prev.candidates === next.candidates &&
    prev.onOpenCandidate === next.onOpenCandidate &&
    prev.onRequestDeleteInterview === next.onRequestDeleteInterview &&
    prev.deleteBusyInterviewId === next.deleteBusyInterviewId
);
