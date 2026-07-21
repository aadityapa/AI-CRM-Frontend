import { ArrowUpRight, LayoutTemplate, Loader2, Trash2, TrendingUp } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { Candidate, Interview, InterviewStatus } from "../types";
import { ScoreBadge } from "./ScoreBadge";
import { atsStatusFromScore, weightedCandidateScore } from "../utils/scoreUtils";
import { FloatingGlassCard, InterviewStatusSelector } from "./interview-status/InterviewStatusSelector";
import { CrmMetaLine } from "./CrmMetaLine";

const rowVariants = {
  hidden: { opacity: 0, y: 10 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: Math.min(i * 0.05, 0.35), type: "spring" as const, stiffness: 420, damping: 34 },
  }),
};

function CandidateDetailImpl({
  candidate,
  onOpenInterviewReport,
  onInterviewStatusChange,
  onRequestDeleteInterview,
  deleteBusyInterviewId = "",
}: {
  candidate: Candidate;
  onOpenInterviewReport?: (candidateId: string, interviewId: string) => void;
  onInterviewStatusChange?: (candidateId: string, interviewId: string, status: InterviewStatus) => void;
  onRequestDeleteInterview?: (candidateId: string, interview: Interview) => void;
  deleteBusyInterviewId?: string;
}) {
  const w = weightedCandidateScore(candidate.interviews || []);
  const ats = atsStatusFromScore(w);
  const atsCls =
    ats === "Strong Match"
      ? "text-success bg-success-soft border-subtle"
      : ats === "Moderate Match"
        ? "text-warning bg-warning-soft border-subtle"
        : "text-danger bg-danger-soft border-subtle";

  const [toast, setToast] = useState<{ msg: string; variant: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, variant: "success" | "error" = "success") => {
    setToast({ msg, variant });
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const latestCrm = useMemo(() => {
    const sorted = [...(candidate.interviews || [])].sort(
      (a, b) => Date.parse(b.date || "") - Date.parse(a.date || ""),
    );
    const hit = sorted.find((i) => (i.opportunityId || i.customerName || "").trim());
    return {
      opportunityId: hit?.opportunityId || sorted[0]?.opportunityId,
      customerName: hit?.customerName || sorted[0]?.customerName,
    };
  }, [candidate.interviews]);

  const templates = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const i of candidate.interviews || []) {
      const title = (i.templateTitle || i.sessionName || "").trim();
      if (!title) continue;
      const k = title.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(title);
    }
    return out;
  }, [candidate]);

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 32 }}
    >
      {toast ? (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-card border px-4 py-3 text-sm font-bold shadow-overlay ${
            toast.variant === "success"
              ? "border-subtle bg-success-soft text-success"
              : "border-subtle bg-danger-soft text-danger"
          }`}
          role="status"
        >
          {toast.msg}
        </div>
      ) : null}

      <FloatingGlassCard className="p-8 flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-6">
          <motion.div
            whileHover={{ scale: 1.03, rotate: -1 }}
            transition={{ type: "spring", stiffness: 400, damping: 22 }}
            className="fx-glow w-20 h-20 rounded-card bg-gradient-to-br from-brand-600 to-violet-600 flex items-center justify-center text-white text-2xl font-black"
          >
            {candidate.name.charAt(0)}
          </motion.div>
          <div>
            <h2 className="text-display text-2xl font-bold text-primary tracking-tight">{candidate.name}</h2>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className="text-brand-600 dark:text-brand-300 font-bold text-sm uppercase tracking-wider bg-brand-50 dark:bg-brand-900 px-3 py-1 rounded-full ring-1 ring-inset ring-subtle">
                {candidate.role}
              </span>
              <span className="text-muted text-sm">{candidate.email}</span>
              <span className={`text-xs font-black uppercase tracking-widest px-3 py-1 rounded-full border ${atsCls}`}>ATS: {ats}</span>
            </div>
            <CrmMetaLine
              opportunityId={latestCrm.opportunityId}
              customerName={latestCrm.customerName}
              className="mt-3"
            />
          </div>
        </div>
        <motion.div
          className="text-right sm:text-right"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 26, delay: 0.08 }}
        >
          <p className="text-xs font-black uppercase text-muted tracking-widest mb-1">Normalized Score</p>
          <p className="text-display text-2xl font-bold tabular-nums bg-gradient-to-br from-brand-500 to-violet-500 bg-clip-text text-transparent">
            {w}%
          </p>
        </motion.div>
      </FloatingGlassCard>

      {templates.length > 0 ? (
        <FloatingGlassCard className="px-6 py-4 flex items-start gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-secondary">
            <LayoutTemplate className="w-4 h-4 text-brand-500" />
            <span className="text-xs font-black uppercase tracking-widest text-muted">Candidate interview is for</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {templates.map((t) => (
              <span
                key={t}
                className="text-xs font-bold text-brand-700 dark:text-brand-200 bg-brand-50 dark:bg-brand-900 ring-1 ring-inset ring-subtle px-3 py-1 rounded-full"
              >
                {t}
              </span>
            ))}
          </div>
        </FloatingGlassCard>
      ) : null}

      <FloatingGlassCard>
        <div className="fx-hairline-b px-8 py-5 flex items-center justify-between bg-surface-2">
          <motion.h3
            className="font-black text-primary uppercase text-xs tracking-widest flex items-center gap-2"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            <TrendingUp className="w-4 h-4 text-brand-500" /> Complete Interview History
          </motion.h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-muted text-xs uppercase font-black tracking-widest border-b border-subtle bg-surface-2">
                <th className="px-8 py-4">Interview Title</th>
                <th className="px-8 py-4">Opportunity ID</th>
                <th className="px-8 py-4">Customer</th>
                <th className="px-8 py-4">Date</th>
                <th className="px-8 py-4">Skills</th>
                <th className="px-8 py-4 text-center">AI Score</th>
                <th className="px-8 py-4">Status</th>
                <th className="px-8 py-4 text-right">Details</th>
                {onRequestDeleteInterview ? <th className="px-8 py-4 text-right">Delete</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {(candidate.interviews || []).map((i, idx) => {
                const skills = Array.from(
                  new Set(
                    (i.skills || [])
                      .map((s) => String(s || "").trim().split(/\s+/).join(" "))
                      .filter(Boolean),
                  ),
                );
                const visibleSkills = skills.slice(0, 4);
                const hiddenCount = Math.max(0, skills.length - visibleSkills.length);

                return (
                <motion.tr
                  key={i.id}
                  custom={idx}
                  variants={rowVariants}
                  initial="hidden"
                  animate="show"
                  className="row-hover transition-colors duration-micro ease-smooth"
                >
                  <td className="px-8 py-6 font-bold text-secondary">{i.templateTitle || i.sessionName}</td>
                  <td className="px-8 py-6 text-sm text-secondary">{i.opportunityId || "—"}</td>
                  <td className="px-8 py-6 text-sm text-secondary">{i.customerName || "—"}</td>
                  <td className="px-8 py-6 text-sm text-muted">{i.date}</td>
                  <td className="px-8 py-6">
                    {!skills.length ? (
                      <span className="text-xs text-muted">—</span>
                    ) : (
                      <div className="max-w-56">
                        <div className="flex flex-wrap gap-1.5">
                          {visibleSkills.map((s) => (
                            <span
                              key={s}
                              title={s}
                              className="bg-surface-1 ring-1 ring-inset ring-subtle px-2 py-0.5 rounded-control text-xs font-bold text-secondary truncate max-w-48"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                        {hiddenCount > 0 ? (
                          <div className="mt-1 text-xs font-semibold text-muted">
                            +{hiddenCount} more
                          </div>
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td className="px-8 py-6 text-center">
                    <ScoreBadge score={i.score} />
                  </td>
                  <td className="px-8 py-6 align-middle relative z-0">
                    <InterviewStatusSelector
                      interviewId={i.id}
                      status={i.status}
                      disabled={!i.id}
                      onUpdated={(next) => onInterviewStatusChange?.(candidate.id, i.id, next)}
                      onToast={showToast}
                    />
                  </td>
                  <td className="px-8 py-6 text-right">
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.97 }}
                      onClick={() => onOpenInterviewReport?.(candidate.id, i.id)}
                      disabled={!onOpenInterviewReport}
                      className="inline-flex items-center gap-2 h-9 px-3 rounded-control border border-subtle bg-surface-1 transition-colors duration-micro ease-smooth hover:bg-surface-2 font-semibold text-secondary disabled:opacity-50 shadow-raised"
                    >
                      <ArrowUpRight className="w-4 h-4" />
                      View
                    </motion.button>
                  </td>
                  {onRequestDeleteInterview ? (
                    <td className="px-8 py-6 text-right">
                      <button
                        type="button"
                        onClick={() => onRequestDeleteInterview(candidate.id, i)}
                        disabled={deleteBusyInterviewId === i.id}
                        className="inline-flex h-9 items-center gap-2 rounded-control border border-subtle bg-surface-1 px-3 text-xs font-black uppercase tracking-wider text-danger shadow-raised transition-colors duration-micro ease-smooth hover:bg-danger-soft disabled:opacity-60 disabled:pointer-events-none"
                        title="Delete this interview/report"
                      >
                        {deleteBusyInterviewId === i.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        Delete
                      </button>
                    </td>
                  ) : null}
                </motion.tr>
              );
            })}
              {!candidate.interviews?.length ? (
                <tr>
                  <td className="px-8 py-8 text-muted" colSpan={onRequestDeleteInterview ? 9 : 8}>
                    No interview records found for this candidate yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </FloatingGlassCard>
    </motion.div>
  );
}

export const CandidateDetail = memo(
  CandidateDetailImpl,
  (prev, next) =>
    prev.candidate === next.candidate &&
    prev.onOpenInterviewReport === next.onOpenInterviewReport &&
    prev.onInterviewStatusChange === next.onInterviewStatusChange &&
    prev.onRequestDeleteInterview === next.onRequestDeleteInterview &&
    prev.deleteBusyInterviewId === next.deleteBusyInterviewId,
);
