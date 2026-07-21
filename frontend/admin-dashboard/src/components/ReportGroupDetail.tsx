import { CalendarClock, CheckCircle2, Clock3, Layers3, Target, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { GroupedReportBucket } from "../utils/reportGrouping";
import { isInterviewCompleted } from "../utils/reportGrouping";
import { ScoreBadge } from "./ScoreBadge";
import { StatusPill } from "./StatusPill";

function fmtWhen(s?: string) {
  const raw = String(s || "").trim();
  if (!raw) return "—";
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

const PAGE_SIZE = 12;

export function ReportGroupDetail({
  groupLabel,
  group,
  onOpenCandidateReport,
}: {
  groupLabel: string;
  group: GroupedReportBucket | null;
  onOpenCandidateReport?: (candidateId: string, interviewId?: string) => void;
}) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [group?.id]);

  const pageCount = useMemo(() => {
    if (!group?.rows?.length) return 1;
    return Math.max(1, Math.ceil(group.rows.length / PAGE_SIZE));
  }, [group?.rows]);

  const rows = useMemo(() => {
    if (!group?.rows?.length) return [];
    const start = (page - 1) * PAGE_SIZE;
    return group.rows.slice(start, start + PAGE_SIZE);
  }, [group?.rows, page]);

  if (!group) {
    return (
      <div className="h-full min-h-96 flex flex-col items-center justify-center bg-surface-1 border-2 border-dashed border-subtle rounded-card text-muted">
        <div className="bg-surface-2 p-8 rounded-full mb-6 ring-1 ring-inset ring-subtle">
          <Layers3 className="w-16 h-16 text-brand-300" />
        </div>
        <h3 className="text-display text-xl font-bold text-secondary">Select {groupLabel}</h3>
        <p className="mt-2 text-muted max-w-sm text-center">
          Pick an item from the sidebar to review grouped interview metrics and linked candidate reports.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
      <div className="glass p-8 rounded-card shadow-raised flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-5 min-w-0">
          <div className="w-16 h-16 rounded-card bg-surface-2 flex items-center justify-center text-brand-600 ring-1 ring-inset ring-subtle dark:text-brand-300">
            <Target className="w-8 h-8" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase text-brand-600 dark:text-brand-300 tracking-widest">{groupLabel}</p>
            <h2 className="text-display text-2xl font-bold text-primary tracking-tight truncate">{group.label}</h2>
            <p className="text-xs text-muted mt-2 flex items-center gap-1">
              <CalendarClock className="w-3.5 h-3.5" /> Latest interview: {fmtWhen(group.latestDate)}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-display text-2xl font-bold tabular-nums text-primary">{group.averageScore}%</p>
          <p className="text-xs font-black uppercase text-muted tracking-widest">Average AI score</p>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <div className="rounded-card border border-subtle bg-surface-1 p-4">
          <p className="text-xs font-black uppercase text-muted tracking-widest">Total candidates</p>
          <p className="text-display text-2xl font-bold tabular-nums text-primary mt-1 flex items-center gap-2"><Users className="w-4 h-4 text-brand-500" /> {group.totalCandidates}</p>
        </div>
        <div className="rounded-card border border-subtle bg-surface-1 p-4">
          <p className="text-xs font-black uppercase text-muted tracking-widest">Total interviews</p>
          <p className="text-display text-2xl font-bold tabular-nums text-primary mt-1">{group.totalInterviews}</p>
        </div>
        <div className="rounded-card border border-subtle bg-success-soft p-4">
          <p className="text-xs font-black uppercase text-success tracking-widest">Completed interviews</p>
          <p className="text-display text-2xl font-bold tabular-nums text-success mt-1 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> {group.completedInterviews}</p>
        </div>
        <div className="rounded-card border border-subtle bg-warning-soft p-4">
          <p className="text-xs font-black uppercase text-warning tracking-widest">Pending interviews</p>
          <p className="text-display text-2xl font-bold tabular-nums text-warning mt-1 flex items-center gap-2"><Clock3 className="w-4 h-4" /> {group.pendingInterviews}</p>
        </div>
        <div className="rounded-card border border-subtle bg-brand-50 dark:bg-surface-2 p-4">
          <p className="text-xs font-black uppercase text-brand-700 dark:text-brand-300 tracking-widest">Latest activity</p>
          <p className="text-sm font-bold text-brand-700 dark:text-brand-200 mt-2">{fmtWhen(group.latestDate)}</p>
        </div>
      </div>

      <div className="bg-surface-1 rounded-card border border-subtle shadow-raised overflow-hidden">
        <div className="px-6 py-4 border-b border-subtle flex items-center justify-between gap-3">
          <h3 className="font-black text-primary uppercase text-xs tracking-widest">Linked Candidate Interviews</h3>
          <span className="text-xs text-muted font-semibold">{group.rows.length} records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-muted text-xs uppercase font-black tracking-widest border-b border-subtle">
                <th className="px-6 py-3">Candidate</th>
                <th className="px-6 py-3">Template</th>
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3">Completion</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-center">AI Score</th>
                <th className="px-6 py-3 text-right">Report</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {rows.map((row) => {
                const interview = row.interview;
                const done = isInterviewCompleted(interview);
                return (
                  <tr key={`${row.candidateId}:${interview.id}`} className="row-hover transition-colors duration-micro ease-smooth">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-bold text-primary">{row.candidateName}</p>
                        <p className="text-xs text-muted">{row.candidateEmail}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-secondary">{interview.templateTitle || interview.sessionName || "Interview"}</td>
                    <td className="px-6 py-4 text-sm text-muted whitespace-nowrap">{fmtWhen(row.sortDate)}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-black uppercase tracking-widest ${
                          done ? "border-subtle bg-success-soft text-success" : "border-subtle bg-warning-soft text-warning"
                        }`}
                      >
                        {done ? "Completed" : "Pending"}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <StatusPill status={interview.status} />
                    </td>
                    <td className="px-6 py-4 text-center">
                      <ScoreBadge score={interview.score} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => onOpenCandidateReport?.(row.candidateId, interview.id)}
                        className="inline-flex items-center gap-1 rounded-control border border-subtle bg-surface-1 px-3 py-1.5 text-xs font-bold text-brand-600 dark:text-brand-300 transition-colors duration-micro ease-smooth hover:bg-surface-2"
                      >
                        Open Report
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!rows.length ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-muted">
                    No linked interviews found for this grouping.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-subtle flex items-center justify-between">
          <p className="text-xs text-muted">
            Page {page} of {pageCount}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-control border border-subtle px-3 py-1.5 text-xs font-semibold text-secondary transition-colors duration-micro ease-smooth hover:bg-surface-2 disabled:opacity-50 disabled:pointer-events-none"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount}
              className="rounded-control border border-subtle px-3 py-1.5 text-xs font-semibold text-secondary transition-colors duration-micro ease-smooth hover:bg-surface-2 disabled:opacity-50 disabled:pointer-events-none"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
