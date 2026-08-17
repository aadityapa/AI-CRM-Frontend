import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  Award,
  BarChart3,
  Brain,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  FileJson,
  Loader2,
  PauseCircle,
  Share2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Timer,
  Trash2,
  User,
  XCircle,
} from "lucide-react";
import {
  deleteInterviewRecord,
  excludeQuestionFromScore,
  includeQuestionInScore,
  getCandidateInterviewDetail,
  getCandidateInterviewHistory,
  getCandidateStrengthsWeaknesses,
  setHrCandidateDecision,
} from "../api";
import { invalidateApiCache } from "../api/client";
import type { Candidate, CandidateInterviewHistory, CandidateInterviewSummary, InterviewRecord } from "../types";
import { atsStatusFromScore, normalizeScore, weightedCandidateScore } from "../utils/scoreUtils";
import {
  asPercent,
  completionRatePercent,
  enrichedTurnsFromRecord,
  introductionTurnFromRecord,
  normalizePercent,
  overallFromReport,
  pickLatestInterviewId,
  problemSolvingScore,
  safeText,
} from "../utils/reportExtract";
const SkillBarChart = lazy(() =>
  import("../components/candidate-report/ReportCharts").then((m) => ({ default: m.SkillBarChart })),
);
const PerformanceRadar = lazy(() =>
  import("../components/candidate-report/ReportCharts").then((m) => ({ default: m.PerformanceRadar })),
);
import { StrengthsWeaknessesPanel } from "../components/candidate-report/StrengthsWeaknessesPanel";
import { ProfessionalAssessmentSections } from "../components/candidate-report/ProfessionalAssessmentSections";
import type { StrengthsWeaknessesAnalysis } from "../types/strengthsWeaknesses";
import { DeleteInterviewRecordModal } from "../components/DeleteInterviewRecordModal";
import { CrmMetaLine } from "../components/CrmMetaLine";
import { focusRing } from "../crm/components/ui";
import { navButtonMotion } from "../lib/motionPresets";

const loadInterviewPdf = () =>
  import("../utils/pdf/generateInterviewPdf").then((m) => m.generateInterviewPdf);

export type CandidateReportReturnTarget = "dashboard" | "candidates";

function initials(name: string) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("") || "C";
}

function fmtWhen(s?: string) {
  if (!s) return "—";
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return s;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(t);
}

function StatusBanner({ status }: { status: string }) {
  const s = String(status || "").toLowerCase();
  // Default = warning (Pending Review). On Hold also lives in the warning
  // palette but gets the stronger border so the recruiter can see it is a
  // deliberate HR action rather than the model's neutral "review" state.
  let cls = "bg-warning-soft text-warning border-subtle";
  if (s.includes("reject")) cls = "bg-danger-soft text-danger border-subtle";
  else if (s.includes("select")) cls = "bg-success-soft text-success border-subtle";
  else if (s.includes("hold")) cls = "bg-warning-soft text-warning border-strong";
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border ${cls}`}>
      {status || "—"}
    </span>
  );
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-card bg-surface-2 ${className}`} />;
}

export function CandidateReportPage({
  candidateId,
  initialInterviewId,
  returnTo,
  onBack,
}: {
  candidateId: string;
  initialInterviewId: string;
  returnTo: CandidateReportReturnTarget;
  onBack: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<CandidateInterviewHistory | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [record, setRecord] = useState<InterviewRecord | null>(null);
  const [recordBusy, setRecordBusy] = useState(false);
  const [selectedInterviewId, setSelectedInterviewId] = useState(() => String(initialInterviewId || "").trim());
  const [detailTab, setDetailTab] = useState<"breakdown" | "strengths">("breakdown");
  const [swAnalysis, setSwAnalysis] = useState<StrengthsWeaknessesAnalysis | null>(null);
  const [swBusy, setSwBusy] = useState(false);
  const [swError, setSwError] = useState("");
  const detailSectionRef = useRef<HTMLElement | null>(null);
  // May 2026: hr_decision now supports a third "on_hold" state. We keep the
  // legacy "shortlist" | "reject" wire format and just extend the union.
  const [hrMark, setHrMark] = useState<"shortlist" | "reject" | "on_hold" | null>(null);
  const [hrSaving, setHrSaving] = useState<"shortlist" | "reject" | "on_hold" | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [excludeTarget, setExcludeTarget] = useState<{ idx: number; question: string } | null>(null);
  const [excludeReason, setExcludeReason] = useState("Not relevant to role");
  const [excludeBusy, setExcludeBusy] = useState(false);
  const [excludeError, setExcludeError] = useState("");
  const [scoreToggleBusy, setScoreToggleBusy] = useState<number | null>(null);

  const EXCLUDE_REASON_OPTIONS = [
    "Not relevant to role",
    "Duplicate question",
    "AI generated poor question",
    "Incorrect question",
    "Other",
  ] as const;
  const reduceMotion = useReducedMotion();
  const navTap = navButtonMotion(!!reduceMotion);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 2400);
  }, []);

  useEffect(
    () => () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const hist = await getCandidateInterviewHistory(candidateId, { limit: 80 });
        if (!alive) return;
        setHistory(hist);
        if (hist?.candidate) {
          setCandidate({
            id: hist.candidate.id,
            name: hist.candidate.name,
            email: hist.candidate.email,
            role: hist.candidate.role,
            hr_decision: hist.candidate.hr_decision,
            interviews: [],
          });
        } else {
          setCandidate(null);
        }
        const d = hist?.candidate?.hr_decision;
        setHrMark(d === "shortlist" || d === "reject" || d === "on_hold" ? d : null);
        if (!hist?.candidate?.id) {
          setError("Candidate not found or you may not have access.");
          return;
        }
        let sel = String(initialInterviewId || "").trim();
        if (!sel && hist.interviews?.length) sel = pickLatestInterviewId(hist.interviews);
        setSelectedInterviewId(sel);
      } catch (e: unknown) {
        if (!alive) return;
        setError(String((e as Error)?.message || e));
      } finally {
        /* no `return` in finally (no-unsafe-finally): it would swallow any
           pending exception/return — guard the state update instead. */
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [candidateId, initialInterviewId]);

  useEffect(() => {
    const id = String(selectedInterviewId || "").trim();
    if (!id || !history?.candidate?.id) {
      setRecord(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        setRecordBusy(true);
        const rec = await getCandidateInterviewDetail(candidateId, id);
        if (!alive) return;
        setRecord(rec);
      } catch {
        if (!alive) return;
        setRecord(null);
      } finally {
        /* no `return` in finally (no-unsafe-finally): it would swallow any
           pending exception/return — guard the state update instead. */
        if (alive) setRecordBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [candidateId, selectedInterviewId, history?.candidate?.id]);

  const activeSummary: CandidateInterviewSummary | null = useMemo(() => {
    const id = String(selectedInterviewId || "").trim();
    if (!id || !history?.interviews?.length) return null;
    return history.interviews.find((i) => i.id === id) || null;
  }, [history, selectedInterviewId]);

  const report = (record?.report || {}) as Record<string, unknown>;
  const commEval = (report?.communication_evaluation || {}) as Record<string, unknown>;

  const modelInterviewVerdict = useMemo(() => {
    const fromSummary = safeText(activeSummary?.recommendation || "");
    const fromReport =
      safeText((report?.recommendation as string) || "") ||
      safeText((report?.overall_recommendation as string) || "") ||
      safeText(String(report?.fitment || ""));
    const merged = (fromSummary || fromReport || "").trim();
    return merged || "—";
  }, [activeSummary, report]);
  const normScore = activeSummary ? normalizeScore(activeSummary.score) : overallFromReport(report, 0);
  const overall = useMemo(() => {
    const reasons = report?.score_reasons as Record<string, { score?: unknown }> | undefined;
    if (reasons?.overall?.score != null) return normalizePercent(reasons.overall.score, normScore);
    const ss = report?.scoring_summary as Record<string, unknown> | undefined;
    if (ss?.overall_score_percent != null) return asPercent(ss.overall_score_percent, normScore);
    return overallFromReport(report, normScore);
  }, [report, normScore]);

  const scoreReasons = (report?.score_reasons || {}) as Record<string, { score?: number; reason?: string }>;

  /**
   * Did this role's template assess spoken communication at all?
   *
   * When RMG turns it off, the interview is scored on technical substance only —
   * there is no communication evaluation to show, and Confidence goes with it
   * because it is derived from the same evaluation. Absent means true: reports
   * created before the setting existed WERE assessed, and must keep rendering
   * their scores.
   */
  const assessesCommunication = report?.communication_required !== false;

  const comm = useMemo(() => {
    if (scoreReasons.communication?.score != null) return normalizePercent(scoreReasons.communication.score, 0);
    const commEval = (report?.communication_evaluation || {}) as Record<string, unknown>;
    return normalizePercent(
      commEval.communication_score ?? commEval.overall_score ?? activeSummary?.communication_score ?? 0,
      0,
    );
  }, [report, scoreReasons, activeSummary]);

  const tech = useMemo(() => {
    if (scoreReasons.technical?.score != null) return normalizePercent(scoreReasons.technical.score, 0);
    return normalizePercent(report?.technical_score ?? activeSummary?.technical_score ?? overall, 0);
  }, [report, scoreReasons, activeSummary, overall]);

  const conf = useMemo(() => {
    if (scoreReasons.confidence?.score != null) return normalizePercent(scoreReasons.confidence.score, 0);
    const commEval = (report?.communication_evaluation || {}) as Record<string, unknown>;
    return normalizePercent(
      commEval.presentation_score ?? commEval.confidence_score ?? report?.confidence_score ?? activeSummary?.confidence_score ?? comm,
      0,
    );
  }, [report, scoreReasons, activeSummary, comm]);

  const prob = useMemo(() => {
    if (scoreReasons.problem_solving?.score != null) return normalizePercent(scoreReasons.problem_solving.score, 0);
    return activeSummary ? problemSolvingScore(report, activeSummary) : 0;
  }, [report, scoreReasons, activeSummary]);
  const completion = completionRatePercent(activeSummary);
  const wScore = candidate ? weightedCandidateScore(candidate.interviews || []) : normalizeScore(history?.candidate?.avg_score || 0);
  const ats = atsStatusFromScore(wScore);
  const atsPct = wScore;
  const turns = useMemo(() => enrichedTurnsFromRecord(record), [record]);
  const introductionTurn = useMemo(() => introductionTurnFromRecord(record), [record]);

  const excludedQuestionsCount = useMemo(() => {
    const ss = report?.scoring_summary as Record<string, unknown> | undefined;
    const fromSummary = Number(ss?.excluded_questions);
    if (Number.isFinite(fromSummary) && fromSummary >= 0) return fromSummary;
    return turns.filter((t) => t.excludedFromScore).length;
  }, [report, turns]);

  const swFromRecord = useMemo((): StrengthsWeaknessesAnalysis | null => {
    const sw = (record?.report as Record<string, unknown> | undefined)?.strengths_weaknesses_analysis;
    if (!sw || typeof sw !== "object") return null;
    const o = sw as StrengthsWeaknessesAnalysis;
    return o.complete ? o : null;
  }, [record]);

  const focusInterviewDetail = useCallback((interviewId: string, tab: "breakdown" | "strengths") => {
    setSelectedInterviewId(interviewId);
    setDetailTab(tab);
    window.requestAnimationFrame(() => {
      detailSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  useEffect(() => {
    if (detailTab !== "strengths") return;
    const id = String(selectedInterviewId || "").trim();
    if (!id || !candidateId) return;
    if (swFromRecord) {
      setSwAnalysis(swFromRecord);
      setSwError("");
      return;
    }
    let alive = true;
    (async () => {
      try {
        setSwBusy(true);
        setSwError("");
        const res = await getCandidateStrengthsWeaknesses(candidateId, id);
        if (!alive) return;
        setSwAnalysis((res?.analysis as StrengthsWeaknessesAnalysis) || null);
        if (!res?.analysis?.questions?.length) {
          setSwError("No strengths & weaknesses data available for this interview yet.");
        }
      } catch (e: unknown) {
        if (!alive) return;
        setSwAnalysis(null);
        setSwError(String((e as Error)?.message || e || "Failed to load strengths & weaknesses."));
      } finally {
        if (alive) setSwBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [detailTab, selectedInterviewId, candidateId, swFromRecord]);

  const scoringFootnote = useMemo(() => {
    const s = report?.scoring_summary;
    if (!s || typeof s !== "object") return null;
    const o = s as Record<string, unknown>;
    const gen = Number(o.generated_questions);
    const att = Number(o.attempted_questions);
    const ev = Number(o.evaluated_questions);
    if (![gen, att, ev].some((x) => Number.isFinite(x) && x >= 0)) return null;
    const g = Number.isFinite(gen) ? gen : "—";
    const a = Number.isFinite(att) ? att : "—";
    const e = Number.isFinite(ev) ? ev : "—";
    const ex = Number(o.excluded_questions);
    const base = `Generated ${g} · Attempted slots ${a} · Evaluated ${e} · headline score uses evaluated answers only`;
    if (Number.isFinite(ex) && ex > 0) {
      return `${base} · ${ex} excluded from score`;
    }
    return base;
  }, [report]);

  const refreshInterviewData = useCallback(async () => {
    const id = String(selectedInterviewId || "").trim();
    if (!id || !candidateId) return;
    const [hist, rec] = await Promise.all([
      getCandidateInterviewHistory(candidateId, { limit: 80 }),
      getCandidateInterviewDetail(candidateId, id),
    ]);
    setHistory(hist);
    setRecord(rec);
    setSwAnalysis(null);
    invalidateApiCache();
  }, [candidateId, selectedInterviewId]);

  const confirmExcludeFromScore = useCallback(async () => {
    const id = String(selectedInterviewId || "").trim();
    if (!excludeTarget || !id || !candidateId) return;
    try {
      setExcludeBusy(true);
      setExcludeError("");
      const res = await excludeQuestionFromScore(candidateId, id, excludeTarget.idx, excludeReason);
      if (res?.record) setRecord(res.record);
      await refreshInterviewData();
      setExcludeTarget(null);
      showToast(`Question ${excludeTarget.idx} excluded from final score`);
    } catch (e: unknown) {
      setExcludeError(String((e as Error)?.message || e || "Failed to exclude question."));
    } finally {
      setExcludeBusy(false);
    }
  }, [candidateId, selectedInterviewId, excludeTarget, excludeReason, refreshInterviewData, showToast]);

  const toggleQuestionScoreInclusion = useCallback(
    async (turn: { idx: number; question: string; excludedFromScore?: boolean }) => {
      const id = String(selectedInterviewId || "").trim();
      if (!id || !candidateId) return;
      if (turn.excludedFromScore) {
        try {
          setScoreToggleBusy(turn.idx);
          const res = await includeQuestionInScore(candidateId, id, turn.idx);
          if (res?.record) setRecord(res.record);
          await refreshInterviewData();
          showToast(`Question ${turn.idx} included in final score`);
        } catch (e: unknown) {
          showToast(String((e as Error)?.message || e || "Failed to include question."));
        } finally {
          setScoreToggleBusy(null);
        }
        return;
      }
      setExcludeError("");
      setExcludeReason("Not relevant to role");
      setExcludeTarget({ idx: turn.idx, question: turn.question });
    },
    [candidateId, selectedInterviewId, refreshInterviewData, showToast],
  );

  const aiSummaryBody =
    safeText(report?.overall_summary || report?.summary || report?.feedback) ||
    safeText(activeSummary?.summary) ||
    "—";

  const managerReviewSnapshot = useMemo(
    () => ({
      candidateName: candidate?.name || history?.candidate?.name || "—",
      role: activeSummary?.job_title || candidate?.role || history?.candidate?.role || "—",
      scorePercent: normScore,
      recommendation: modelInterviewVerdict,
      interviewDate:
        activeSummary?.updated_date_ist ||
        activeSummary?.created_date_ist ||
        fmtWhen(activeSummary?.updated_at || activeSummary?.created_at),
      aiVerdict: aiSummaryBody,
      communicationScore: comm,
      technicalScore: tech,
    }),
    [
      candidate?.name,
      candidate?.role,
      history?.candidate?.name,
      history?.candidate?.role,
      activeSummary,
      normScore,
      modelInterviewVerdict,
      aiSummaryBody,
      comm,
      tech,
    ],
  );

  const strengthsList =
    (Array.isArray(report?.strengths) && (report.strengths as string[])) ||
    activeSummary?.strengths ||
    [];
  const gapsList =
    (Array.isArray(report?.weaknesses) && (report.weaknesses as string[])) ||
    activeSummary?.weaknesses ||
    [];

  const exportJson = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exported_at: new Date().toISOString(),
            candidate: history?.candidate,
            interviews: history?.interviews,
            selected_interview_id: selectedInterviewId,
            interview_record: record,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `karnex-candidate-${candidateId}-report.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast("JSON exported");
  };

  const copyShareLink = async () => {
    const params = new URLSearchParams();
    params.set("view", "candidateReport");
    params.set("cid", candidateId);
    if (selectedInterviewId) params.set("iid", selectedInterviewId);
    if (returnTo === "dashboard") params.set("ret", "dashboard");
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast("Report link copied");
    } catch {
      showToast("Could not copy link");
    }
  };

  const downloadPdf = async () => {
    if (!history?.candidate || !activeSummary) {
      showToast("Select an interview with data first");
      return;
    }
    try {
      setPdfBusy(true);
      const gen = await loadInterviewPdf();
      await gen(candidateId, { candidate: history.candidate, interview: activeSummary });
    } catch (e: unknown) {
      showToast(String((e as Error)?.message || e));
    } finally {
      setPdfBusy(false);
    }
  };

  const requestDeleteInterview = (id: string, label?: string) => {
    const rid = String(id || "").trim();
    if (!rid) {
      showToast("Select an interview first");
      return;
    }
    setDeleteTarget({ id: rid, label: label || "Selected interview/report" });
    setDeleteError("");
  };

  const confirmDeleteInterview = async () => {
    const id = String(deleteTarget?.id || "").trim();
    if (!id) {
      showToast("Select an interview first");
      return;
    }
    if (deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteInterviewRecord(id);
      invalidateApiCache();
      const hist = await getCandidateInterviewHistory(candidateId, { limit: 80 });
      setHistory(hist);
      if (hist?.candidate) {
        setCandidate({
          id: hist.candidate.id,
          name: hist.candidate.name,
          email: hist.candidate.email,
          role: hist.candidate.role,
          hr_decision: hist.candidate.hr_decision,
          interviews: [],
        });
      }
      const nextId = hist?.interviews?.length ? pickLatestInterviewId(hist.interviews) : "";
      setSelectedInterviewId(nextId);
      setRecord(null);
      setDeleteTarget(null);
      showToast("Interview/report deleted");
      if (!nextId) onBack();
    } catch (e: unknown) {
      setDeleteError(String((e as Error)?.message || e));
    } finally {
      setDeleteBusy(false);
    }
  };

  const backLabel = returnTo === "dashboard" ? "Back to dashboard" : "Back to reports";

  if (loading) {
    return (
      <div className="mx-auto max-w-screen-2xl w-full px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <SkeletonBlock className="h-12 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <SkeletonBlock className="h-40 lg:col-span-2" />
          <SkeletonBlock className="h-40" />
        </div>
        <SkeletonBlock className="h-72" />
      </div>
    );
  }

  if (error || !history?.candidate) {
    return (
      <div className="mx-auto max-w-screen-2xl w-full px-4 sm:px-6 lg:px-8 py-12">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-semibold text-brand-600 dark:text-brand-300 hover:underline mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          {backLabel}
        </button>
        <div className="rounded-card border border-subtle bg-danger-soft p-8 text-danger">
          <div className="font-extrabold text-lg">Unable to load report</div>
          <p className="mt-2 text-sm opacity-90">{error || "Unknown error"}</p>
        </div>
      </div>
    );
  }

  const c = history.candidate;
  const displayName = candidate?.name || c.name;
  const displayEmail = candidate?.email || c.email;
  const displayRole = candidate?.role || c.role;
  const displayOpportunity =
    activeSummary?.opportunityId || record?.opportunityId || "";
  const displayCustomer =
    activeSummary?.customerName || record?.customerName || "";

  const headerStatusBadge =
    c.hr_decision === "reject"
      ? "Rejected"
      : c.hr_decision === "shortlist"
        ? "Selected"
        : c.hr_decision === "on_hold"
          ? "On Hold"
          : String(activeSummary?.status || c.status || "—");

  // May 2026: Re-toggling the same chip clears the decision so HR can
  // "un-hold" / "un-reject" a candidate without leaving the page.
  const persistHrDecision = async (decision: "shortlist" | "reject" | "on_hold") => {
    setHrSaving(decision);
    const nextDecision: "shortlist" | "reject" | "on_hold" | null =
      hrMark === decision ? null : decision;
    try {
      await setHrCandidateDecision(candidateId, nextDecision);
      invalidateApiCache("/hr/dashboard");
      const hist = await getCandidateInterviewHistory(candidateId, { limit: 80 });
      setHistory(hist);
      if (hist?.candidate) {
        setCandidate({
          id: hist.candidate.id,
          name: hist.candidate.name,
          email: hist.candidate.email,
          role: hist.candidate.role,
          hr_decision: hist.candidate.hr_decision,
          interviews: [],
        });
      }
      const d = hist?.candidate?.hr_decision;
      setHrMark(d === "shortlist" || d === "reject" || d === "on_hold" ? d : null);
      if (nextDecision === null) {
        showToast("Decision cleared for this candidate");
      } else if (nextDecision === "shortlist") {
        showToast("Selected — saved everywhere for this candidate");
      } else if (nextDecision === "reject") {
        showToast("Rejected — saved everywhere for this candidate");
      } else {
        showToast("On Hold — saved everywhere for this candidate");
      }
    } catch (e: unknown) {
      showToast(String((e as Error)?.message || e));
    } finally {
      setHrSaving(null);
    }
  };

  return (
    <div className="pb-16">
      <DeleteInterviewRecordModal
        open={Boolean(deleteTarget)}
        busy={deleteBusy}
        error={deleteError}
        targetLabel={deleteTarget?.label}
        onClose={() => {
          if (deleteBusy) return;
          setDeleteTarget(null);
          setDeleteError("");
        }}
        onConfirm={() => void confirmDeleteInterview()}
      />
      {excludeTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-backdrop p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-modal border border-subtle bg-surface-1 shadow-modal p-6 space-y-4"
          >
            <h3 className="text-lg font-black text-primary">
              Exclude this question from final score?
            </h3>
            <p className="text-sm text-secondary">
              Question, answer, transcript, strengths, weaknesses, and audit history are kept. Only aggregate scores
              are recalculated.
            </p>
            <p className="text-xs text-muted leading-relaxed">
              Question, answer, transcript, strengths &amp; weaknesses, and audit history are kept. Only the final
              score and recommendation will be recalculated.
            </p>
            <p className="text-sm font-semibold text-primary line-clamp-3">
              Question {excludeTarget.idx}: {excludeTarget.question || "—"}
            </p>
            <label className="block text-xs font-bold uppercase tracking-wide text-muted">
              Reason (optional)
              <select
                value={excludeReason}
                onChange={(e) => setExcludeReason(e.target.value)}
                className="mt-1 w-full rounded-control border border-subtle bg-surface-1 px-3 py-2 text-sm font-medium text-primary"
              >
                {EXCLUDE_REASON_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
            {excludeError ? <p className="text-sm text-danger">{excludeError}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={excludeBusy}
                onClick={() => {
                  if (excludeBusy) return;
                  setExcludeTarget(null);
                  setExcludeError("");
                }}
                className="px-4 py-2 rounded-control text-sm font-bold text-secondary transition-colors duration-micro ease-smooth hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={excludeBusy}
                onClick={() => void confirmExcludeFromScore()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-control bg-warning text-white text-sm font-bold transition-opacity duration-micro ease-smooth hover:opacity-90 disabled:opacity-60"
              >
                {excludeBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Exclude
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {/* Sticky toolbar */}
      <div className="sticky top-16 z-10 glass fx-hairline-b">
        <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-control border border-subtle bg-surface-1 px-3 py-2 text-sm font-semibold text-secondary hover:bg-surface-2 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            {backLabel}
          </button>
          <div className="flex flex-wrap items-center gap-2">
            {/*
              Hiring decision buttons (May 2026 redesign).
              ------------------------------------------------------
              Pill-shaped buttons with a circular icon badge that grows on
              hover so the recruiter has immediate visual feedback when their
              cursor / keyboard focus is on a button.

              Visual states:
                - idle      → soft tinted background + 2-px outline
                - hover     → lifts 2px, deeper border, soft colored shadow
                - focus     → 2-px ring with offset for keyboard nav (a11y)
                - selected  → filled gradient + white text + inline CheckCircle
                              badge so the active choice is unmistakable
                - saving    → spinner replaces the icon (existing logic kept)
            */}
            <motion.button
              type="button"
              disabled={hrSaving !== null}
              onClick={() => void persistHrDecision("shortlist")}
              {...navTap}
              aria-pressed={hrMark === "shortlist"}
              title="Mark this candidate as Shortlisted"
              className={`group fx-lift relative inline-flex items-center gap-2.5 rounded-full border px-4 py-2 text-sm font-bold tracking-wide transition-colors duration-micro ease-smooth disabled:opacity-50 disabled:cursor-not-allowed ${focusRing} ${
                hrMark === "shortlist"
                  ? "border-transparent bg-success text-white shadow-raised"
                  : "border-subtle bg-success-soft text-success hover:border-strong"
              }`}
            >
              <span
                className={`inline-flex items-center justify-center w-7 h-7 rounded-full ${
                  hrMark === "shortlist" ? "bg-white/20 text-white" : "bg-surface-1 text-success shadow-raised"
                }`}
              >
                {hrSaving === "shortlist" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ThumbsUp className="w-4 h-4" strokeWidth={2.5} />
                )}
              </span>
              <span>Shortlist</span>
              {hrMark === "shortlist" ? (
                <CheckCircle2 className="w-4 h-4 ml-0.5 opacity-90" aria-hidden="true" />
              ) : null}
            </motion.button>

            {/*
              May 2026 — "On Hold" is the third hiring decision in the pill
              cluster. We use an amber palette to distinguish it visually from
              the green Shortlist and rose Reject options, and a PauseCircle
              icon to communicate "decision parked, not closed". Clicking it
              again clears the mark (see `persistHrDecision`).
            */}
            <motion.button
              type="button"
              disabled={hrSaving !== null}
              onClick={() => void persistHrDecision("on_hold")}
              {...navTap}
              aria-pressed={hrMark === "on_hold"}
              title="Park this candidate as On Hold"
              className={`group fx-lift relative inline-flex items-center gap-2.5 rounded-full border px-4 py-2 text-sm font-bold tracking-wide transition-colors duration-micro ease-smooth disabled:opacity-50 disabled:cursor-not-allowed ${focusRing} ${
                hrMark === "on_hold"
                  ? "border-transparent bg-warning text-white shadow-raised"
                  : "border-subtle bg-warning-soft text-warning hover:border-strong"
              }`}
            >
              <span
                className={`inline-flex items-center justify-center w-7 h-7 rounded-full ${
                  hrMark === "on_hold" ? "bg-white/20 text-white" : "bg-surface-1 text-warning shadow-raised"
                }`}
              >
                {hrSaving === "on_hold" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <PauseCircle className="w-4 h-4" strokeWidth={2.5} />
                )}
              </span>
              <span>On Hold</span>
              {hrMark === "on_hold" ? (
                <Timer className="w-4 h-4 ml-0.5 opacity-90" aria-hidden="true" />
              ) : null}
            </motion.button>

            <motion.button
              type="button"
              disabled={hrSaving !== null}
              onClick={() => void persistHrDecision("reject")}
              {...navTap}
              aria-pressed={hrMark === "reject"}
              title="Mark this candidate as Rejected"
              className={`group fx-lift relative inline-flex items-center gap-2.5 rounded-full border px-4 py-2 text-sm font-bold tracking-wide transition-colors duration-micro ease-smooth disabled:opacity-50 disabled:cursor-not-allowed ${focusRing} ${
                hrMark === "reject"
                  ? "border-transparent bg-danger-solid text-white shadow-raised"
                  : "border-subtle bg-danger-soft text-danger hover:border-strong"
              }`}
            >
              <span
                className={`inline-flex items-center justify-center w-7 h-7 rounded-full ${
                  hrMark === "reject" ? "bg-white/20 text-white" : "bg-surface-1 text-danger shadow-raised"
                }`}
              >
                {hrSaving === "reject" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ThumbsDown className="w-4 h-4" strokeWidth={2.5} />
                )}
              </span>
              <span>Reject</span>
              {hrMark === "reject" ? (
                <XCircle className="w-4 h-4 ml-0.5 opacity-90" aria-hidden="true" />
              ) : null}
            </motion.button>
            <button
              type="button"
              disabled={pdfBusy}
              onClick={() => void downloadPdf()}
              className="inline-flex items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-3 py-2 text-sm font-semibold text-secondary hover:bg-surface-2 disabled:opacity-50"
            >
              {pdfBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              PDF
            </button>
            <button
              type="button"
              onClick={exportJson}
              className="inline-flex items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-3 py-2 text-sm font-semibold text-secondary hover:bg-surface-2"
            >
              <FileJson className="w-4 h-4" />
              JSON
            </button>
            <button
              type="button"
              onClick={() => void copyShareLink()}
              className="inline-flex items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-3 py-2 text-sm font-semibold text-secondary hover:bg-surface-2"
            >
              <Share2 className="w-4 h-4" />
              Share
            </button>
            <button
              type="button"
              onClick={() => requestDeleteInterview(selectedInterviewId, `${displayName} • ${activeSummary?.job_title || displayRole || "Interview"}`)}
              disabled={deleteBusy}
              className="inline-flex items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-3 py-2 text-sm font-semibold text-danger transition-colors duration-micro ease-smooth hover:bg-danger-soft disabled:opacity-60 disabled:pointer-events-none"
            >
              {deleteBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              {deleteBusy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </div>

      {toast ? (
        <div className="fixed bottom-6 right-6 z-50 rounded-control border border-subtle bg-surface-1 px-4 py-3 text-sm font-semibold shadow-overlay flex items-center gap-2">
          <Copy className="w-4 h-4 text-brand-500" />
          {toast}
        </div>
      ) : null}

      <div className="mx-auto max-w-screen-2xl w-full px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/*
          May 2026 — confirmation banner that mirrors the active decision.
          The amber "On Hold" branch lives alongside the existing emerald
          (Shortlist) and rose (Reject) variants, so HR always sees the same
          colour language across the page.
        */}
        {hrMark ? (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-card border px-4 py-3 text-sm font-semibold flex items-center gap-2 ${
              hrMark === "shortlist"
                ? "bg-success-soft border-subtle text-success"
                : hrMark === "on_hold"
                  ? "bg-warning-soft border-subtle text-warning"
                  : "bg-danger-soft border-subtle text-danger"
            }`}
          >
            {hrMark === "shortlist" ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : hrMark === "on_hold" ? (
              <PauseCircle className="w-4 h-4" />
            ) : (
              <XCircle className="w-4 h-4" />
            )}
            {hrMark === "shortlist"
              ? "Selected — this choice is saved and shown on the dashboard, reports list, and interview history (same status everywhere)."
              : hrMark === "on_hold"
                ? "On Hold — candidate is parked in the pipeline. Status is mirrored on the dashboard, reports list, and interview history."
                : "Rejected — this choice is saved and shown on the dashboard, reports list, and interview history (same status everywhere)."}
          </motion.div>
        ) : null}

        {/* Header card */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="rounded-card border border-subtle bg-surface-1 shadow-raised overflow-hidden"
        >
          <div className="h-1.5 w-full bg-gradient-to-r from-brand-600 via-violet-500 to-accent-400" />
          <div className="p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center gap-6 justify-between">
            <div className="flex items-start gap-5 min-w-0">
              <div className="fx-glow w-16 h-16 sm:w-20 sm:h-20 rounded-card bg-gradient-to-br from-brand-600 to-violet-600 text-white flex items-center justify-center text-2xl font-black shrink-0">
                {initials(displayName)}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-widest text-muted">Candidate</p>
                <h1 className="text-display text-2xl font-bold tracking-tight text-primary truncate">{displayName}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-secondary">
                  <span className="truncate max-w-full">{displayEmail}</span>
                  <span className="text-muted">•</span>
                  <span className="font-bold text-brand-600 dark:text-brand-300 uppercase tracking-wide text-xs">{displayRole}</span>
                </div>
                <CrmMetaLine
                  opportunityId={displayOpportunity}
                  customerName={displayCustomer}
                  className="mt-3"
                />
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <StatusBanner status={headerStatusBadge} />
                  <span className="text-xs font-semibold text-muted">
                    Interview: {fmtWhen(activeSummary?.updated_at_ist || activeSummary?.created_at_ist)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-4 shrink-0">
              <div className="rounded-card border border-subtle bg-surface-2 px-5 py-4 min-w-36">
                <p className="text-xs font-black uppercase text-muted tracking-widest">ATS match</p>
                <p className="text-display text-2xl font-bold tabular-nums text-primary mt-1">{atsPct}%</p>
                <p className="text-xs font-bold text-brand-600 dark:text-brand-300 mt-1">{ats}</p>
              </div>
              {/* v3 showcase — overall score as a display numeral inside a
                  CSS-only conic-gradient progress ring (static render from the
                  existing score value; no animation). */}
              <div className="ai-surface rounded-card px-5 py-4 min-w-40">
                <div className="flex items-center gap-4">
                  <div
                    className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full"
                    role="img"
                    aria-label={`AI score ${overall} percent`}
                    style={{
                      background: `conic-gradient(var(--brand-500) 0%, var(--violet-500) ${Math.max(0, Math.min(100, overall)) * 0.7}%, var(--accent-400) ${Math.max(0, Math.min(100, overall))}%, var(--surface-2) ${Math.max(0, Math.min(100, overall))}%)`,
                    }}
                  >
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-1">
                      <span className="text-display text-2xl font-bold tabular-nums text-primary">{overall}%</span>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-brand-700 dark:text-brand-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden />
                      AI score
                    </p>
                    {excludedQuestionsCount > 0 ? (
                      <p className="text-xs font-semibold text-warning mt-2">
                        Excluded Questions: {excludedQuestionsCount}
                      </p>
                    ) : null}
                    {scoringFootnote ? (
                      <p className="text-xs text-muted mt-2 max-w-56 leading-snug">{scoringFootnote}</p>
                    ) : null}
                    {recordBusy ? (
                      <p className="text-xs text-brand-600 dark:text-brand-300 mt-2 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Syncing interview…
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Say WHY communication is absent. Without this, a reader who expects
            the usual six cards assumes the report is broken or incomplete. */}
        {!assessesCommunication && (
          <div className="flex items-start gap-2.5 rounded-card border border-subtle bg-surface-2 px-4 py-3 text-sm">
            <Award className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <p className="text-secondary">
              <span className="font-semibold text-primary">Technical assessment only.</span>{" "}
              This position's template has communication assessment switched off, so the
              candidate was scored purely on technical substance. Communication and
              confidence were not evaluated and carry no weight in the scores below.
            </p>
          </div>
        )}

        {/* Analytics */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6"
        >
          {[
            // Communication and Confidence both come from the communication
            // evaluation, so both disappear when the template did not ask for
            // one. Showing them at 0% would read as "the candidate scored zero",
            // which is a different and much worse claim than "not assessed".
            ...(assessesCommunication
              ? [
                  { label: "Communication", value: comm, reason: scoreReasons.communication?.reason, icon: <User className="w-4 h-4" /> },
                ]
              : []),
            { label: "Technical", value: tech, reason: scoreReasons.technical?.reason, icon: <Award className="w-4 h-4" /> },
            ...(assessesCommunication
              ? [
                  { label: "Confidence", value: conf, reason: scoreReasons.confidence?.reason, icon: <Sparkles className="w-4 h-4" /> },
                ]
              : []),
            { label: "Problem solving", value: prob, reason: scoreReasons.problem_solving?.reason, icon: <Brain className="w-4 h-4" /> },
            { label: "Completion", value: completion, reason: undefined, icon: <BarChart3 className="w-4 h-4" /> },
            {
              label: "Model recommendation",
              value: null,
              text: modelInterviewVerdict,
              reason: undefined,
              icon: <Sparkles className="w-4 h-4" />,
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised"
            >
              <div className="flex items-center justify-between text-muted mb-2">
                <span className="text-xs font-black uppercase tracking-widest leading-tight">{card.label}</span>
                {card.icon}
              </div>
              {card.value != null ? (
                <>
                  <div className="text-2xl font-black text-primary tabular-nums">{card.value}%</div>
                  {card.reason ? (
                    <p className="mt-2 text-xs leading-snug text-muted line-clamp-3">{card.reason}</p>
                  ) : null}
                </>
              ) : (
                <p className="text-xs font-semibold text-secondary line-clamp-4">{card.text}</p>
              )}
              {card.value != null ? (
                <div className="mt-2 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500"
                    style={{ width: `${Math.max(4, Math.min(100, card.value))}%` }}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </motion.section>

        {/* Charts */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.08 }}
          className="grid grid-cols-1 xl:grid-cols-2 gap-4"
        >
          <div className="rounded-card border border-subtle bg-surface-1 p-5 shadow-raised">
            <h2 className="text-xs font-black uppercase tracking-widest text-muted mb-4">Skill scores</h2>
            <Suspense fallback={<SkeletonBlock className="h-52 w-full" />}>
              <SkillBarChart data={activeSummary?.skill_breakdown || []} />
            </Suspense>
          </div>
          <div className="rounded-card border border-subtle bg-surface-1 p-5 shadow-raised">
            <h2 className="text-xs font-black uppercase tracking-widest text-muted mb-2">Performance radar</h2>
            <Suspense fallback={<SkeletonBlock className="h-52 w-full" />}>
              <PerformanceRadar
                communication={comm}
                technical={tech}
                confidence={conf}
                problemSolving={prob}
                overall={overall}
                includeCommunication={assessesCommunication}
              />
            </Suspense>
          </div>
        </motion.section>

        {/* Timeline */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.1 }}
          className="rounded-card border border-subtle bg-surface-1 shadow-raised overflow-hidden"
        >
          <div className="px-6 py-4 border-b border-subtle flex items-center justify-between gap-3">
            <h2 className="text-xs font-black uppercase tracking-widest text-muted">Interview timeline</h2>
            <span className="text-xs font-semibold text-muted">{history.interviews?.length || 0} sessions</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-sm lg:min-w-0">
              <thead>
                <tr className="text-xs uppercase font-black tracking-widest text-muted border-b border-subtle">
                  <th className="px-6 py-3">Role / template</th>
                  <th className="px-6 py-3">Opportunity ID</th>
                  <th className="px-6 py-3">Customer</th>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-center">Score</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {(history.interviews || []).map((row) => {
                  const active = row.id === selectedInterviewId;
                  return (
                    <tr key={row.id} className={active ? "bg-brand-50 dark:bg-brand-900" : "row-hover"}>
                      <td className="px-6 py-4 font-bold text-primary">{row.job_title || displayRole}</td>
                      <td className="px-6 py-4 text-secondary">{row.opportunityId || "—"}</td>
                      <td className="px-6 py-4 text-secondary">{row.customerName || "—"}</td>
                      <td className="px-6 py-4 text-muted whitespace-nowrap">{fmtWhen(row.scheduled_at_local || row.created_at_ist)}</td>
                      <td className="px-6 py-4">
                        <StatusBanner status={String(row.status)} />
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="font-black text-primary">{normalizeScore(row.score)}%</div>
                        {Number(row.excluded_questions_count) > 0 ? (
                          <div className="text-xs font-semibold text-warning mt-1">
                            Excluded Questions: {row.excluded_questions_count}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="inline-flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => focusInterviewDetail(row.id, "breakdown")}
                          className="inline-flex items-center gap-1 rounded-control border border-subtle bg-surface-1 px-3 py-1.5 text-xs font-bold text-brand-600 dark:text-brand-300 transition-colors duration-micro ease-smooth hover:bg-surface-2"
                        >
                          View breakdown
                          <ChevronDown
                            className={`w-3 h-3 transition ${active && detailTab === "breakdown" ? "rotate-180" : ""}`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => focusInterviewDetail(row.id, "strengths")}
                          className="inline-flex items-center gap-1 rounded-control border border-subtle bg-surface-1 px-3 py-1.5 text-xs font-bold text-success transition-colors duration-micro ease-smooth hover:bg-success-soft"
                        >
                          Strengths &amp; Weaknesses
                          <ChevronDown
                            className={`w-3 h-3 transition ${active && detailTab === "strengths" ? "rotate-180" : ""}`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => requestDeleteInterview(row.id, `${displayName} • ${row.job_title || displayRole || "Interview"}`)}
                          disabled={deleteBusy && deleteTarget?.id === row.id}
                          className="inline-flex items-center gap-1 rounded-control border border-subtle bg-surface-1 px-3 py-1.5 text-xs font-bold text-danger transition-colors duration-micro ease-smooth hover:bg-danger-soft disabled:opacity-60 disabled:pointer-events-none"
                        >
                          {deleteBusy && deleteTarget?.id === row.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          Delete
                        </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </motion.section>

        {/* Breakdown / Strengths & Weaknesses */}
        <motion.section
          ref={detailSectionRef}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.12 }}
          className="rounded-card border border-subtle bg-surface-1 shadow-raised overflow-hidden"
        >
          <div className="px-6 py-4 border-b border-subtle flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-xs font-black uppercase tracking-widest text-muted">
                Interview detail
              </h2>
              <p className="text-xs text-muted mt-1">
                {detailTab === "breakdown"
                  ? "Expand each turn for evaluation, scores, and suggested answers."
                  : "Manager review dashboard — hiring verdict, skill cards, top answers, and follow-up prompts."}
              </p>
            </div>
            <div className="inline-flex rounded-control border border-subtle bg-surface-2 p-1 gap-1">
              <button
                type="button"
                onClick={() => setDetailTab("breakdown")}
                className={`px-3 py-1.5 rounded-control text-xs font-bold transition ${
                  detailTab === "breakdown"
                    ? "bg-surface-1 text-brand-600 dark:text-brand-300 shadow-raised"
                    : "text-muted hover:text-primary"
                }`}
              >
                Breakdown
              </button>
              <button
                type="button"
                onClick={() => setDetailTab("strengths")}
                className={`px-3 py-1.5 rounded-control text-xs font-bold transition ${
                  detailTab === "strengths"
                    ? "bg-surface-1 text-success shadow-raised"
                    : "text-muted hover:text-primary"
                }`}
              >
                Strengths &amp; Weaknesses
              </button>
            </div>
          </div>
          {detailTab === "strengths" ? (
            <div className="p-6">
              <StrengthsWeaknessesPanel
                analysis={swAnalysis}
                snapshot={managerReviewSnapshot}
                busy={swBusy || recordBusy}
                error={swError}
              />
            </div>
          ) : (
          <div className="divide-y divide-subtle">
            {!introductionTurn && !turns.length ? (
              <div className="p-8 text-center text-muted text-sm">No questions and answers in this record yet.</div>
            ) : (
              <>
              {introductionTurn ? (
                <details key="introduction" className="group open:bg-surface-2">
                  <summary className="cursor-pointer list-none px-6 py-4 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-black uppercase text-violet-500">Introduction</span>
                        <span className="text-xs font-bold uppercase tracking-wide rounded-full border border-subtle bg-warning-soft text-warning px-2 py-0.5">
                          SAVED · NOT SCORED
                        </span>
                      </div>
                      <p className="font-bold text-primary mt-1">{introductionTurn.question || "—"}</p>
                    </div>
                    <ChevronDown className="w-5 h-5 text-muted transition group-open:rotate-180 shrink-0" />
                  </summary>
                  <div className="px-6 pb-5 space-y-4 border-t border-subtle bg-surface-2">
                    <div>
                      <p className="text-xs font-black uppercase text-muted mb-1">Candidate answer</p>
                      <p className="text-sm text-secondary whitespace-pre-wrap">{introductionTurn.answer || "—"}</p>
                    </div>
                    {introductionTurn.evaluationSummary || introductionTurn.interviewFeedback ? (
                      <div className="rounded-card border border-subtle bg-surface-2 p-3">
                        {/* The intro turn is never scored, so this note stays
                            useful either way — but calling it a "communication
                            note" on a technical-only report implies an
                            assessment that did not happen. */}
                        <p className="text-xs font-black uppercase text-violet-600 dark:text-violet-300 mb-1">
                          {assessesCommunication ? "Communication note" : "Interviewer note"}
                        </p>
                        <p className="text-sm text-secondary">
                          {introductionTurn.evaluationSummary || introductionTurn.interviewFeedback}
                        </p>
                      </div>
                    ) : null}
                    <p className="text-xs text-muted">
                      This response is stored for review only and does not affect the technical interview score.
                    </p>
                  </div>
                </details>
              ) : null}
              {turns.map((t) => (
                <details key={t.idx} className="group open:bg-surface-2">
                  <summary className="cursor-pointer list-none px-6 py-4 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-black uppercase text-brand-500">Question {t.idx}</span>
                        {t.boundaryLabel ? (
                          <span className="text-xs font-bold uppercase tracking-wide rounded-full border border-subtle bg-warning-soft text-warning px-2 py-0.5">
                            {t.boundaryLabel}
                          </span>
                        ) : null}
                        {t.excludedFromScore ? (
                          <span className="text-xs font-bold uppercase tracking-wide rounded-full border border-subtle bg-warning-soft text-warning px-2 py-0.5">
                            EXCLUDED FROM SCORE
                          </span>
                        ) : null}
                      </div>
                      <p className="font-bold text-primary mt-1">{t.question || "—"}</p>
                    </div>
                    <div className="shrink-0 flex flex-col sm:flex-row items-end sm:items-center gap-2">
                      {t.score != null ? (
                        <span className="text-xs font-black rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200 px-2 py-1">
                          Score: {t.score}%
                        </span>
                      ) : null}
                      {!t.excludedFromScore ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void toggleQuestionScoreInclusion(t);
                          }}
                          disabled={scoreToggleBusy === t.idx || excludeBusy}
                          className="inline-flex items-center rounded-control border border-subtle bg-warning-soft px-3 py-1.5 text-xs font-black uppercase tracking-wide text-warning transition-colors duration-micro ease-smooth hover:border-strong disabled:opacity-60"
                        >
                          {scoreToggleBusy === t.idx ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                          Exclude From Score
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void toggleQuestionScoreInclusion(t);
                          }}
                          disabled={scoreToggleBusy === t.idx || excludeBusy}
                          className="inline-flex items-center rounded-control border border-subtle bg-success-soft px-3 py-1.5 text-xs font-black uppercase tracking-wide text-success transition-colors duration-micro ease-smooth hover:border-strong disabled:opacity-60"
                        >
                          {scoreToggleBusy === t.idx ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                          Include In Score
                        </button>
                      )}
                      <ChevronDown className="w-5 h-5 text-muted transition group-open:rotate-180" />
                    </div>
                  </summary>
                  <div className="px-6 pb-5 space-y-4 border-t border-subtle bg-surface-2">
                    <div>
                      <p className="text-xs font-black uppercase text-muted mb-1">Candidate answer</p>
                      <p className="text-sm text-secondary whitespace-pre-wrap">{t.answer || "—"}</p>
                    </div>
                    <ProfessionalAssessmentSections turn={t} includeCommunication={assessesCommunication} />
                    {t.excludedFromScore ? (
                      <div className="rounded-card border border-subtle bg-surface-2 p-3 space-y-1">
                        <p className="text-xs font-black uppercase text-muted">Status</p>
                        <p className="text-sm font-bold text-warning">EXCLUDED FROM SCORE</p>
                        {t.score != null ? (
                          <p className="text-xs text-secondary">
                            Score: {t.score}% — this question is not included in final evaluation.
                          </p>
                        ) : null}
                        {t.excludedBy ? (
                          <p className="text-xs text-muted">Excluded by: {t.excludedBy}</p>
                        ) : null}
                        {t.excludedAt ? (
                          <p className="text-xs text-muted">Excluded at: {fmtWhen(t.excludedAt)}</p>
                        ) : null}
                        {t.excludedReason ? (
                          <p className="text-xs text-muted">Reason: {t.excludedReason}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </details>
              ))}
              </>
            )}
          </div>
          )}
        </motion.section>

        {/* AI Summary */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.14 }}
          className="grid grid-cols-1 lg:grid-cols-3 gap-4"
        >
          {/* AI-generated content — animated gradient border + cyan accent label */}
          <div className="lg:col-span-2 fx-gradient-border-animated rounded-card bg-surface-1 p-6 shadow-raised">
            <h2 className="text-xs font-black uppercase tracking-widest text-muted flex items-center gap-2">
              <Brain className="w-4 h-4 text-brand-500" /> AI executive summary
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold normal-case tracking-normal text-accent-600 ring-1 ring-inset ring-subtle dark:text-accent-400">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden />
                AI Analysis
              </span>
            </h2>
            <p className="mt-4 text-sm sm:text-base text-secondary leading-relaxed whitespace-pre-wrap">{aiSummaryBody}</p>
            <div className="mt-6 rounded-card border border-subtle bg-brand-50 dark:bg-surface-2 px-4 py-3">
              <p className="text-xs font-black uppercase text-brand-700 dark:text-brand-300">Final verdict</p>
              <p className="mt-1 text-sm font-bold text-primary space-y-2">
                <span className="block">
                  Hiring status (lists and dashboards): <span className="text-brand-700 dark:text-brand-200">{headerStatusBadge}</span>
                </span>
                <span className="block text-secondary font-semibold">
                  Model suggestion (this interview): {modelInterviewVerdict}
                </span>
              </p>
            </div>
          </div>
          <div className="rounded-card border border-subtle bg-surface-1 p-6 shadow-raised space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-muted">Highlights</h3>
            <div>
              <p className="text-xs font-bold text-success uppercase">Strengths</p>
              <ul className="mt-2 text-sm text-secondary space-y-1 list-disc pl-4">
                {(strengthsList.length ? strengthsList : ["—"]).slice(0, 8).map((s, i) => (
                  <li key={i}>{String(s)}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-bold text-danger uppercase">Technical / skill gaps</p>
              <ul className="mt-2 text-sm text-secondary space-y-1 list-disc pl-4">
                {(gapsList.length ? gapsList : ["—"]).slice(0, 8).map((s, i) => (
                  <li key={i}>{String(s)}</li>
                ))}
              </ul>
            </div>
            {assessesCommunication && (
              <div>
                <p className="text-xs font-bold text-muted uppercase">Communication</p>
                <p className="mt-1 text-sm text-secondary">
                  Communication score <span className="font-black text-brand-600 dark:text-brand-300">{comm}%</span>
                  {scoreReasons.communication?.reason ? ` — ${scoreReasons.communication.reason}` : " — see breakdown above for tone and clarity signals."}
                </p>
              </div>
            )}
            {(Array.isArray(commEval.improvements) && (commEval.improvements as string[]).length) ||
            (Array.isArray(report?.improvements) && (report.improvements as string[]).length) ? (
              <div>
                <p className="text-xs font-bold text-warning uppercase">Improvement areas</p>
                <ul className="mt-2 text-sm text-secondary space-y-1 list-disc pl-4">
                  {(
                    (Array.isArray(commEval.improvements) ? (commEval.improvements as string[]) : []) ||
                    (Array.isArray(report?.improvements) ? (report.improvements as string[]) : [])
                  )
                    .slice(0, 6)
                    .map((s, i) => (
                      <li key={i}>{String(s)}</li>
                    ))}
                </ul>
              </div>
            ) : null}
          </div>
        </motion.section>
      </div>
    </div>
  );
}
