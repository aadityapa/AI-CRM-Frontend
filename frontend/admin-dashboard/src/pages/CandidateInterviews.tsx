import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  Brain,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  ExternalLink,
  ListChecks,
  Loader2,
  Mail,
  MessageSquare,
  Trash2,
  TriangleAlert,
  User,
} from "lucide-react";
import {
  deleteCandidate,
  deleteInterviewRecord,
  getCandidateInterviewDetail,
  getCandidateInterviewHistory,
} from "../api";
import { StatusPill } from "../components/StatusPill";
import { DeleteInterviewRecordModal } from "../components/DeleteInterviewRecordModal";
import { navButtonMotion, pageSurfaceMotion } from "../lib/motionPresets";
import type { CandidatePdfAnalytics } from "../components/pdf/CandidatePdfTemplate";

const loadCandidatePdf = () =>
  import("../utils/pdf/generateCandidatePdf").then((m) => m.generateCandidatePdf);
const loadInterviewPdf = () =>
  import("../utils/pdf/generateInterviewPdf").then((m) => m.generateInterviewPdf);
import type {
  CandidateInterviewHistory,
  CandidateInterviewSummary,
  InterviewRecord,
} from "../types";
import { pickLatestInterviewId } from "../utils/reportExtract";

const PAGE_SIZE = 5;

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function safeParseDate(value: string): number {
  const t = Date.parse(value || "");
  return Number.isFinite(t) ? t : 0;
}

function fmtDateLabel(date: string) {
  if (!date) return "—";
  const t = safeParseDate(date);
  if (!t) return date;
  const d = new Date(t);
  const dd = String(d.getDate()).padStart(2, "0");
  const month = MONTHS_SHORT[d.getMonth()] || "";
  const yyyy = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const meridiem = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const hh = String(hours).padStart(2, "0");
  return `${dd} ${month} ${yyyy}, ${hh}:${minutes} ${meridiem}`;
}

function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h}h ${String(remM).padStart(2, "0")}m`;
  }
  return `${m}m ${String(rem).padStart(2, "0")}s`;
}

function initials(name: string) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("") || "C";
}

function ScoreBar({ value, tone = "indigo" }: { value: number; tone?: "indigo" | "emerald" | "amber" | "rose" | "violet" }) {
  const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const bar =
    tone === "emerald"
      ? "bg-success-500"
      : tone === "amber"
        ? "bg-warning-500"
        : tone === "rose"
          ? "bg-danger-500"
          : tone === "violet"
            ? "bg-violet-500"
            : "bg-gradient-to-r from-brand-500 to-violet-500";
  return (
    <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
      <div className={`h-full rounded-full ${bar}`} style={{ width: `${v}%` }} />
    </div>
  );
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-card bg-surface-2 ${className}`} />;
}

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-screen-xl w-full px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <SkeletonBlock className="h-10 w-44" />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-4">
          <SkeletonBlock className="h-44" />
          <SkeletonBlock className="h-32" />
        </div>
        <div className="lg:col-span-8 space-y-4">
          <SkeletonBlock className="h-12" />
          <SkeletonBlock className="h-44" />
          <SkeletonBlock className="h-44" />
        </div>
      </div>
    </div>
  );
}

type TabKey = "overview" | "evaluations" | "qa" | "analytics";

function DeleteCandidateModal({
  open,
  candidateName,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  candidateName: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-backdrop" onClick={busy ? undefined : onClose} />
      <div className="absolute inset-x-0 top-24 mx-auto w-full max-w-md px-4">
        <div className="bg-surface-1 rounded-modal border border-subtle shadow-modal overflow-hidden">
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-full bg-danger-soft flex items-center justify-center text-danger shrink-0">
                <TriangleAlert className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-lg font-extrabold text-primary">Delete candidate permanently?</div>
                <div className="mt-2 text-sm text-secondary">
                  Are you sure you want to permanently delete{" "}
                  <span className="font-bold text-primary">{candidateName || "this candidate"}</span>{" "}
                  and all interview records?
                </div>
                <div className="mt-3 text-xs font-semibold text-danger">This action cannot be undone.</div>
                {error ? <div className="mt-3 text-xs text-danger">{error}</div> : null}
              </div>
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="h-10 px-4 rounded-control border border-subtle bg-surface-1 transition-colors duration-micro ease-smooth hover:bg-surface-2 font-semibold text-secondary disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy}
                className="h-10 px-4 rounded-control bg-danger-solid text-white font-semibold shadow-raised transition-colors duration-micro ease-smooth hover:bg-danger-solid-hover disabled:opacity-60 inline-flex items-center gap-2"
              >
                {busy ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InterviewQAPanel({
  candidateId,
  interview,
  onDownloadPdf,
  onOpenFullReport,
  pdfDisabled,
  pdfBusyThis,
}: {
  candidateId: string;
  interview: CandidateInterviewSummary;
  onDownloadPdf: () => void;
  onOpenFullReport?: () => void;
  pdfDisabled: boolean;
  pdfBusyThis: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [record, setRecord] = useState<InterviewRecord | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || record || !interview.id) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const rec = await getCandidateInterviewDetail(candidateId, interview.id);
        if (!alive) return;
        if (!rec) setError("Interview detail not found.");
        setRecord(rec);
      } catch (e: any) {
        if (!alive) return;
        setError(String(e?.message || e));
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, record, candidateId, interview.id]);

  const turns = useMemo(() => {
    const qs = (record?.questions || []).map((x) => String(x || ""));
    const ans = (record?.answers || []).map((x) => String(x || ""));
    const max = Math.max(qs.length, ans.length);
    const out: { idx: number; q: string; a: string }[] = [];
    for (let i = 0; i < max; i++) out.push({ idx: i + 1, q: qs[i] || "", a: ans[i] || "" });
    return out.filter((t) => t.q || t.a);
  }, [record]);

  return (
    <div className="rounded-card border border-subtle bg-surface-1">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="row-hover flex-1 min-w-0 px-5 py-4 flex items-center justify-between gap-4 transition-colors duration-micro ease-smooth text-left"
        >
          <div className="text-left min-w-0">
            <div className="text-sm font-extrabold text-primary truncate">
              {fmtDateLabel(interview.scheduled_at_local || interview.created_at_ist || interview.created_at)}
            </div>
            <div className="text-xs text-muted mt-0.5 truncate">
              Interview ID: {interview.id || "—"} • Score {interview.score}% • {interview.questions_count} questions
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusPill variant="tile" status={String(interview.status || "")} />
            {open ? <ChevronUp className="w-4 h-4 text-muted" /> : <ChevronDown className="w-4 h-4 text-muted" />}
          </div>
        </button>
        <div className="flex items-center gap-1 px-2 border-l border-subtle bg-surface-2">
          {onOpenFullReport ? (
            <button
              type="button"
              onClick={onOpenFullReport}
              className="inline-flex items-center gap-1.5 px-2.5 h-9 rounded-lg border border-subtle bg-brand-50 transition-colors duration-micro ease-smooth hover:bg-brand-100 dark:bg-brand-900 dark:hover:bg-brand-800 text-xs font-bold text-brand-700 dark:text-brand-200"
              title="Open full analytics report for this interview"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Report
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDownloadPdf}
            disabled={pdfDisabled}
            className="inline-flex items-center gap-1.5 px-2.5 h-9 rounded-lg border border-subtle bg-surface-1 transition-colors duration-micro ease-smooth hover:bg-surface-2 text-xs font-bold text-secondary disabled:opacity-50 disabled:pointer-events-none"
          >
            <Download className="w-3.5 h-3.5" />
            {pdfBusyThis ? "…" : "PDF"}
          </button>
        </div>
      </div>
      {open ? (
        <div className="px-5 pb-5">
          {loading ? (
            <div className="space-y-3">
              <SkeletonBlock className="h-16" />
              <SkeletonBlock className="h-16" />
              <SkeletonBlock className="h-16" />
            </div>
          ) : error ? (
            <div className="text-sm text-danger">{error}</div>
          ) : !turns.length ? (
            <div className="text-sm text-muted">No question/answer payload found for this interview.</div>
          ) : (
            <div className="divide-y divide-subtle border border-subtle rounded-card overflow-hidden">
              {turns.map((t) => (
                <div key={t.idx} className="p-4">
                  <div className="text-xs font-black uppercase tracking-widest text-muted">Q{t.idx}</div>
                  <div className="mt-1 font-bold text-primary">{t.q || "—"}</div>
                  <div className="mt-3 text-xs font-black uppercase tracking-widest text-muted">Answer</div>
                  <div className="mt-1 text-sm text-secondary whitespace-pre-wrap">{t.a || "—"}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function CandidateInterviewsPage({
  candidateId,
  onBack,
  onOpenCandidateReport,
}: {
  candidateId: string;
  onBack: () => void;
  /** Opens the full-page candidate report; omit `interviewId` to let the report pick the latest interview. */
  onOpenCandidateReport?: (interviewId?: string) => void;
}) {
  const [tab, setTab] = useState<TabKey>("overview");
  const [data, setData] = useState<CandidateInterviewHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [interviewDeleteTarget, setInterviewDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [interviewDeleteBusy, setInterviewDeleteBusy] = useState(false);
  const [interviewDeleteError, setInterviewDeleteError] = useState("");
  const [pdfBusyFull, setPdfBusyFull] = useState(false);
  const [pdfBusyInterviewId, setPdfBusyInterviewId] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState("");
  const [toast, setToast] = useState("");
  const reduceMotion = useReducedMotion();
  const tabTap = navButtonMotion(!!reduceMotion);
  const tabPanelMotion = pageSurfaceMotion(`candidate-interviews-tab:${tab}`, !!reduceMotion);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const resp = await getCandidateInterviewHistory(candidateId, { limit: 200, offset: 0 });
        if (!alive) return;
        if (!resp) {
          setError("Candidate not found.");
          setData(null);
        } else {
          setData(resp);
        }
      } catch (e: any) {
        if (!alive) return;
        setError(String(e?.message || e));
        setData(null);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [candidateId]);

  const interviews = data?.interviews || [];
  const totalPages = Math.max(1, Math.ceil(interviews.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = interviews.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const analytics = useMemo((): CandidatePdfAnalytics => {
    if (!interviews.length) {
      return {
        totalInterviews: 0,
        avgScore: 0,
        avgComm: 0,
        avgTech: 0,
        avgConf: 0,
        bestScore: 0,
        latestStatus: "Pending Review",
        skillBreakdown: [] as { skill: string; score: number }[],
      };
    }
    const sum = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
    const skillMap = new Map<string, number[]>();
    for (const it of interviews) {
      for (const sb of it.skill_breakdown || []) {
        const arr = skillMap.get(sb.skill) || [];
        arr.push(sb.score);
        skillMap.set(sb.skill, arr);
      }
    }
    const skillBreakdown = Array.from(skillMap.entries())
      .map(([skill, scores]) => ({ skill, score: sum(scores) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    return {
      totalInterviews: interviews.length,
      avgScore: sum(interviews.map((i) => i.score)),
      avgComm: sum(interviews.map((i) => i.communication_score)),
      avgTech: sum(interviews.map((i) => i.technical_score)),
      avgConf: sum(interviews.map((i) => i.confidence_score)),
      bestScore: interviews.reduce((m, i) => Math.max(m, i.score), 0),
      latestStatus: interviews[0]?.status || "Pending Review",
      skillBreakdown,
    };
  }, [interviews]);

  const confirmDelete = async () => {
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteCandidate(candidateId);
      setConfirmOpen(false);
      onBack();
    } catch (e: any) {
      setDeleteError(String(e?.message || e));
    } finally {
      setDeleteBusy(false);
    }
  };

  const refreshHistory = async () => {
    const resp = await getCandidateInterviewHistory(candidateId, { limit: 200, offset: 0 });
    setData(resp);
  };

  const requestDeleteInterview = (interview: CandidateInterviewSummary) => {
    if (!interview.id) return;
    setInterviewDeleteTarget({
      id: interview.id,
      label: `${data?.candidate?.name || "Candidate"} • ${interview.job_title || "Interview"}`,
    });
    setInterviewDeleteError("");
  };

  const confirmDeleteInterview = async () => {
    const interviewId = String(interviewDeleteTarget?.id || "").trim();
    if (!interviewId || interviewDeleteBusy) return;
    setInterviewDeleteBusy(true);
    setInterviewDeleteError("");
    try {
      await deleteInterviewRecord(interviewId);
      await refreshHistory();
      setInterviewDeleteTarget(null);
      setToast("Interview/report deleted.");
      window.setTimeout(() => setToast(""), 1800);
    } catch (e: any) {
      setInterviewDeleteError(String(e?.message || e));
    } finally {
      setInterviewDeleteBusy(false);
    }
  };

  if (loading) return <PageSkeleton />;

  if (error || !data) {
    return (
      <div className="mx-auto max-w-screen-xl w-full px-4 sm:px-6 lg:px-8 py-8">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3 h-9 rounded-control border border-subtle bg-surface-1 transition-colors duration-micro ease-smooth hover:bg-surface-2 text-sm font-semibold text-secondary"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </button>
        <div className="mt-6 bg-danger-soft border border-subtle rounded-card p-8 text-danger">
          <div className="font-extrabold">Could not load candidate</div>
          <div className="mt-2 text-sm text-danger">{error || "Candidate not found."}</div>
        </div>
      </div>
    );
  }

  const candidate = data.candidate;
  const pdfDisabled = pdfBusyFull || pdfBusyInterviewId !== null;

  const handleDownloadFullPdf = async () => {
    setPdfError("");
    setPdfBusyFull(true);
    try {
      const generateCandidatePdf = await loadCandidatePdf();
      await generateCandidatePdf(candidateId, {
        candidate,
        interviews,
        analytics,
      });
    } catch (e: any) {
      setPdfError(String(e?.message || e));
    } finally {
      setPdfBusyFull(false);
    }
  };

  const handleDownloadInterviewPdf = async (it: CandidateInterviewSummary) => {
    setPdfError("");
    setPdfBusyInterviewId(it.id);
    try {
      const generateInterviewPdf = await loadInterviewPdf();
      await generateInterviewPdf(candidateId, { candidate, interview: it });
    } catch (e: any) {
      setPdfError(String(e?.message || e));
    } finally {
      setPdfBusyInterviewId(null);
    }
  };

  const tabBtn = (key: TabKey, label: string, icon: ReactNode) => (
    <motion.button
      type="button"
      onClick={() => setTab(key)}
      {...tabTap}
      className={`px-4 h-10 rounded-control text-sm font-semibold inline-flex items-center gap-2 transition ${
        tab === key
          ? "bg-surface-1 text-brand-700 border border-subtle shadow-raised dark:text-brand-300"
          : "text-secondary hover:text-primary hover:bg-surface-1"
      }`}
    >
      {icon}
      {label}
    </motion.button>
  );

  return (
    <div className="mx-auto max-w-screen-xl w-full px-4 sm:px-6 lg:px-8 py-8">
      <DeleteCandidateModal
        open={confirmOpen}
        candidateName={candidate.name}
        busy={deleteBusy}
        error={deleteError}
        onClose={() => {
          if (deleteBusy) return;
          setConfirmOpen(false);
          setDeleteError("");
        }}
        onConfirm={confirmDelete}
      />
      <DeleteInterviewRecordModal
        open={Boolean(interviewDeleteTarget)}
        busy={interviewDeleteBusy}
        error={interviewDeleteError}
        targetLabel={interviewDeleteTarget?.label}
        onClose={() => {
          if (interviewDeleteBusy) return;
          setInterviewDeleteTarget(null);
          setInterviewDeleteError("");
        }}
        onConfirm={() => void confirmDeleteInterview()}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3 h-9 rounded-control border border-subtle bg-surface-1 transition-colors duration-micro ease-smooth hover:bg-surface-2 text-sm font-semibold text-secondary"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {onOpenCandidateReport ? (
            <button
              type="button"
              onClick={() => {
                const iid = interviews.length ? pickLatestInterviewId(interviews) : "";
                onOpenCandidateReport(iid || undefined);
              }}
              disabled={!interviews.length}
              className="inline-flex items-center gap-2 px-4 h-9 rounded-control border border-subtle bg-surface-1 text-brand-700 dark:text-brand-200 font-semibold shadow-raised transition-colors duration-micro ease-smooth hover:bg-surface-2 disabled:opacity-50 disabled:pointer-events-none"
              title="Open charts, timeline, and Q/A on the full report page"
            >
              <ExternalLink className="w-4 h-4" />
              Full report
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleDownloadFullPdf}
            disabled={pdfDisabled || !interviews.length}
            className="btn-depth btn-gradient inline-flex items-center gap-2 px-4 h-9 rounded-control bg-brand-600 text-white font-semibold disabled:opacity-50 disabled:pointer-events-none"
          >
            <Download className="w-4 h-4" />
            {pdfBusyFull ? "Preparing PDF…" : "Download PDF"}
          </button>
          <button
            type="button"
            onClick={() => {
              setDeleteError("");
              setConfirmOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 h-9 rounded-control bg-surface-1 border border-subtle transition-colors duration-micro ease-smooth hover:bg-danger-soft text-danger font-semibold"
          >
            <Trash2 className="w-4 h-4" />
            Delete candidate
          </button>
        </div>
      </div>

      {pdfError ? (
        <div className="mt-3 text-sm text-danger font-semibold" role="alert">
          {pdfError}
        </div>
      ) : null}
      {toast ? <div className="mt-3 text-sm text-success font-semibold">{toast}</div> : null}

      {/* Header */}
      <div className="mt-5 bg-surface-1 border border-subtle rounded-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start gap-4">
          <div className="fx-glow w-14 h-14 rounded-card bg-gradient-to-br from-brand-600 to-violet-600 text-white flex items-center justify-center font-extrabold text-lg shrink-0">
            {initials(candidate.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-display text-2xl font-bold tracking-tight text-primary">{candidate.name}</h1>
              <StatusPill variant="tile" status={candidate.status as string} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Mail className="w-4 h-4" />
                {candidate.email}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <User className="w-4 h-4" />
                {candidate.role}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ListChecks className="w-4 h-4" />
                {candidate.total_interviews} interview{candidate.total_interviews === 1 ? "" : "s"} attempted
              </span>
            </div>
            {candidate.skills?.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {candidate.skills.slice(0, 12).map((s) => (
                  <span
                    key={s}
                    className="bg-surface-2 ring-1 ring-inset ring-subtle px-2 py-0.5 rounded-control text-xs font-bold text-secondary"
                  >
                    {s}
                  </span>
                ))}
                {candidate.skills.length > 12 ? (
                  <span className="text-xs font-bold text-muted">+{candidate.skills.length - 12} more</span>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-3 sm:ml-auto">
            <div className="rounded-card border border-subtle px-4 py-3">
              <div className="text-xs font-black uppercase tracking-widest text-muted">Avg score</div>
              <div className="mt-1 text-xl font-extrabold text-primary">{candidate.avg_score}%</div>
            </div>
            <div className="rounded-card border border-subtle px-4 py-3">
              <div className="text-xs font-black uppercase tracking-widest text-muted">Best</div>
              <div className="mt-1 text-xl font-extrabold text-primary">{analytics.bestScore}%</div>
            </div>
            <div className="rounded-card border border-subtle px-4 py-3">
              <div className="text-xs font-black uppercase tracking-widest text-muted">Status</div>
              <div className="mt-1 text-xl font-extrabold text-primary truncate">{candidate.status}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 inline-flex gap-1 p-1 bg-surface-2 border border-subtle rounded-control">
        {tabBtn("overview", "Overview", <BadgeCheck className="w-4 h-4" />)}
        {tabBtn("evaluations", "Evaluations", <BarChart3 className="w-4 h-4" />)}
        {tabBtn("qa", "Questions & Answers", <MessageSquare className="w-4 h-4" />)}
        {tabBtn("analytics", "Analytics", <Brain className="w-4 h-4" />)}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          variants={tabPanelMotion.variants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={tabPanelMotion.transition}
        >
          {tab === "overview" ? (
            <OverviewTab
              interviews={interviews}
              onDownloadInterviewPdf={handleDownloadInterviewPdf}
              onOpenInterviewReport={onOpenCandidateReport ? (it) => onOpenCandidateReport(it.id) : undefined}
              onDeleteInterview={requestDeleteInterview}
              deleteBusyInterviewId={interviewDeleteBusy ? interviewDeleteTarget?.id || "" : ""}
              pdfBusyFull={pdfBusyFull}
              pdfBusyInterviewId={pdfBusyInterviewId}
            />
          ) : tab === "evaluations" ? (
            <EvaluationsTab
              interviews={pageItems}
              page={safePage}
              totalPages={totalPages}
              onPageChange={setPage}
              onDownloadInterviewPdf={handleDownloadInterviewPdf}
              onOpenInterviewReport={onOpenCandidateReport ? (it) => onOpenCandidateReport(it.id) : undefined}
              onDeleteInterview={requestDeleteInterview}
              deleteBusyInterviewId={interviewDeleteBusy ? interviewDeleteTarget?.id || "" : ""}
              pdfBusyFull={pdfBusyFull}
              pdfBusyInterviewId={pdfBusyInterviewId}
            />
          ) : tab === "qa" ? (
            <QaTab
              candidateId={candidate.id}
              interviews={pageItems}
              page={safePage}
              totalPages={totalPages}
              onPageChange={setPage}
              onDownloadInterviewPdf={handleDownloadInterviewPdf}
              onOpenInterviewReport={onOpenCandidateReport ? (it) => onOpenCandidateReport(it.id) : undefined}
              pdfBusyFull={pdfBusyFull}
              pdfBusyInterviewId={pdfBusyInterviewId}
            />
          ) : (
            <AnalyticsTab analytics={analytics} interviews={interviews} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-6 bg-surface-1 border-2 border-dashed border-subtle rounded-card p-10 text-center">
      <div className="font-extrabold text-primary">{title}</div>
      <div className="mt-2 text-sm text-muted">{body}</div>
    </div>
  );
}

function OverviewTab({
  interviews,
  onDownloadInterviewPdf,
  onOpenInterviewReport,
  onDeleteInterview,
  deleteBusyInterviewId,
  pdfBusyFull,
  pdfBusyInterviewId,
}: {
  interviews: CandidateInterviewSummary[];
  onDownloadInterviewPdf: (it: CandidateInterviewSummary) => void;
  onOpenInterviewReport?: (it: CandidateInterviewSummary) => void;
  onDeleteInterview?: (it: CandidateInterviewSummary) => void;
  deleteBusyInterviewId?: string;
  pdfBusyFull: boolean;
  pdfBusyInterviewId: string | null;
}) {
  if (!interviews.length) {
    return <EmptyState title="No interviews yet" body="This candidate has not attempted any interview." />;
  }
  return (
    <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-8 space-y-4">
        {interviews.slice(0, 6).map((it) => (
          <div key={it.id} className="bg-surface-1 border border-subtle rounded-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-extrabold text-primary">
                  {fmtDateLabel(it.scheduled_at_local || it.created_at_ist || it.created_at)}
                </div>
                <div className="mt-0.5 text-xs text-muted inline-flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5" />
                  Duration {fmtDuration(it.duration_sec)} • {it.questions_count} questions
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {onOpenInterviewReport ? (
                  <button
                    type="button"
                    onClick={() => onOpenInterviewReport(it)}
                    className="inline-flex items-center gap-1.5 px-3 h-9 rounded-control border border-subtle bg-brand-50 transition-colors duration-micro ease-smooth hover:bg-brand-100 dark:bg-brand-900 dark:hover:bg-brand-800 text-xs font-bold text-brand-700 dark:text-brand-200"
                    title="Open full analytics report"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Report
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onDownloadInterviewPdf(it)}
                  disabled={pdfBusyFull || pdfBusyInterviewId !== null}
                  className="inline-flex items-center gap-1.5 px-3 h-9 rounded-control border border-subtle bg-surface-1 transition-colors duration-micro ease-smooth hover:bg-surface-2 text-xs font-bold text-secondary disabled:opacity-50 disabled:pointer-events-none"
                >
                  <Download className="w-3.5 h-3.5" />
                  {pdfBusyInterviewId === it.id ? "PDF…" : "PDF"}
                </button>
                {onDeleteInterview ? (
                  <button
                    type="button"
                    onClick={() => onDeleteInterview(it)}
                    disabled={deleteBusyInterviewId === it.id}
                    className="inline-flex items-center gap-1.5 px-3 h-9 rounded-control border border-subtle bg-surface-1 transition-colors duration-micro ease-smooth hover:bg-danger-soft text-xs font-bold text-danger disabled:opacity-60 disabled:pointer-events-none"
                  >
                    {deleteBusyInterviewId === it.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    {deleteBusyInterviewId === it.id ? "Deleting…" : "Delete"}
                  </button>
                ) : null}
                <StatusPill variant="tile" status={String(it.status || "")} />
                <span className="font-extrabold text-primary">{it.score}%</span>
              </div>
            </div>
            <div className="mt-4">
              <ScoreBar value={it.score} />
            </div>
            {it.summary ? (
              <div className="mt-4 text-sm text-secondary whitespace-pre-wrap line-clamp-4">{it.summary}</div>
            ) : null}
            {it.recommendation ? (
              <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-control bg-brand-50 ring-1 ring-inset ring-subtle text-brand-700 dark:bg-brand-900 dark:text-brand-200 text-xs font-bold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {it.recommendation}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="lg:col-span-4 space-y-4">
        <div className="bg-surface-1 border border-subtle rounded-card p-5">
          <div className="text-sm font-extrabold tracking-tight">Timeline</div>
          <div className="mt-4 space-y-3 max-h-96 overflow-auto pr-1">
            {interviews.map((it) => (
              <div key={it.id} className="flex items-start gap-3">
                <div className="mt-1 w-2 h-2 rounded-full bg-brand-500 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-secondary">
                    {fmtDateLabel(it.scheduled_at_local || it.created_at_ist || it.created_at)}
                  </div>
                  <div className="text-xs text-muted inline-flex items-center gap-1.5">
                    <CalendarClock className="w-3 h-3" />
                    Score {it.score}% • {String(it.status || "")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PaginationFooter({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between">
      <button
        type="button"
        onClick={() => onPageChange(Math.max(0, page - 1))}
        disabled={page <= 0}
        className="h-9 px-3 rounded-control border border-subtle bg-surface-1 transition-colors duration-micro ease-smooth hover:bg-surface-2 font-semibold text-secondary text-sm disabled:opacity-50"
      >
        Previous
      </button>
      <div className="text-xs text-muted font-semibold">
        Page {page + 1} / {totalPages}
      </div>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
        disabled={page >= totalPages - 1}
        className="h-9 px-3 rounded-control border border-subtle bg-surface-1 transition-colors duration-micro ease-smooth hover:bg-surface-2 font-semibold text-secondary text-sm disabled:opacity-50"
      >
        Next
      </button>
    </div>
  );
}

function EvaluationsTab({
  interviews,
  page,
  totalPages,
  onPageChange,
  onDownloadInterviewPdf,
  onOpenInterviewReport,
  onDeleteInterview,
  deleteBusyInterviewId,
  pdfBusyFull,
  pdfBusyInterviewId,
}: {
  interviews: CandidateInterviewSummary[];
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  onDownloadInterviewPdf: (it: CandidateInterviewSummary) => void;
  onOpenInterviewReport?: (it: CandidateInterviewSummary) => void;
  onDeleteInterview?: (it: CandidateInterviewSummary) => void;
  deleteBusyInterviewId?: string;
  pdfBusyFull: boolean;
  pdfBusyInterviewId: string | null;
}) {
  if (!interviews.length) {
    return <EmptyState title="No evaluations yet" body="Evaluations will appear here once interviews are completed." />;
  }
  return (
    <div className="mt-6">
      <div className="grid grid-cols-1 gap-4">
        {interviews.map((it) => (
          <div key={it.id} className="bg-surface-1 border border-subtle rounded-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-extrabold text-primary">
                  {fmtDateLabel(it.scheduled_at_local || it.created_at_ist || it.created_at)}
                </div>
                <div className="text-xs text-muted">Interview ID: {it.id}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {onOpenInterviewReport ? (
                  <button
                    type="button"
                    onClick={() => onOpenInterviewReport(it)}
                    className="inline-flex items-center gap-1.5 px-3 h-9 rounded-control border border-subtle bg-brand-50 transition-colors duration-micro ease-smooth hover:bg-brand-100 dark:bg-brand-900 dark:hover:bg-brand-800 text-xs font-bold text-brand-700 dark:text-brand-200"
                    title="Open full analytics report"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Report
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onDownloadInterviewPdf(it)}
                  disabled={pdfBusyFull || pdfBusyInterviewId !== null}
                  className="inline-flex items-center gap-1.5 px-3 h-9 rounded-control border border-subtle bg-surface-1 transition-colors duration-micro ease-smooth hover:bg-surface-2 text-xs font-bold text-secondary disabled:opacity-50 disabled:pointer-events-none"
                >
                  <Download className="w-3.5 h-3.5" />
                  {pdfBusyInterviewId === it.id ? "PDF…" : "Download PDF"}
                </button>
                {onDeleteInterview ? (
                  <button
                    type="button"
                    onClick={() => onDeleteInterview(it)}
                    disabled={deleteBusyInterviewId === it.id}
                    className="inline-flex items-center gap-1.5 px-3 h-9 rounded-control border border-subtle bg-surface-1 transition-colors duration-micro ease-smooth hover:bg-danger-soft text-xs font-bold text-danger disabled:opacity-60 disabled:pointer-events-none"
                  >
                    {deleteBusyInterviewId === it.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    {deleteBusyInterviewId === it.id ? "Deleting…" : "Delete"}
                  </button>
                ) : null}
                <StatusPill variant="tile" status={String(it.status || "")} />
                <span className="font-extrabold text-primary">{it.score}%</span>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-card border border-subtle p-3">
                <div className="text-xs font-black uppercase tracking-widest text-muted">Communication</div>
                <div className="mt-1 text-lg font-extrabold text-primary">{it.communication_score}%</div>
                <div className="mt-2">
                  <ScoreBar value={it.communication_score} tone="violet" />
                </div>
              </div>
              <div className="rounded-card border border-subtle p-3">
                <div className="text-xs font-black uppercase tracking-widest text-muted">Technical</div>
                <div className="mt-1 text-lg font-extrabold text-primary">{it.technical_score}%</div>
                <div className="mt-2">
                  <ScoreBar value={it.technical_score} tone="indigo" />
                </div>
              </div>
              <div className="rounded-card border border-subtle p-3">
                <div className="text-xs font-black uppercase tracking-widest text-muted">Confidence</div>
                <div className="mt-1 text-lg font-extrabold text-primary">{it.confidence_score}%</div>
                <div className="mt-2">
                  <ScoreBar value={it.confidence_score} tone="emerald" />
                </div>
              </div>
            </div>
            {it.recommendation ? (
              <div className="mt-4 text-xs font-bold text-brand-700 dark:text-brand-300">HR recommendation: {it.recommendation}</div>
            ) : null}
            {it.summary ? (
              <div className="mt-3 text-sm text-secondary whitespace-pre-wrap">{it.summary}</div>
            ) : null}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-card border border-subtle bg-success-soft p-3">
                <div className="text-xs font-black uppercase tracking-widest text-success">Strengths</div>
                {it.strengths?.length ? (
                  <ul className="mt-2 list-disc pl-5 text-sm text-secondary space-y-1">
                    {it.strengths.map((s, i) => (
                      <li key={`${it.id}-s-${i}`}>{s}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-2 text-xs text-success">—</div>
                )}
              </div>
              <div className="rounded-card border border-subtle bg-danger-soft p-3">
                <div className="text-xs font-black uppercase tracking-widest text-danger">Weaknesses</div>
                {it.weaknesses?.length ? (
                  <ul className="mt-2 list-disc pl-5 text-sm text-secondary space-y-1">
                    {it.weaknesses.map((w, i) => (
                      <li key={`${it.id}-w-${i}`}>{w}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-2 text-xs text-danger">—</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <PaginationFooter page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </div>
  );
}

function QaTab({
  candidateId,
  interviews,
  page,
  totalPages,
  onPageChange,
  onDownloadInterviewPdf,
  onOpenInterviewReport,
  pdfBusyFull,
  pdfBusyInterviewId,
}: {
  candidateId: string;
  interviews: CandidateInterviewSummary[];
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  onDownloadInterviewPdf: (it: CandidateInterviewSummary) => void;
  onOpenInterviewReport?: (it: CandidateInterviewSummary) => void;
  pdfBusyFull: boolean;
  pdfBusyInterviewId: string | null;
}) {
  if (!interviews.length) {
    return <EmptyState title="No questions yet" body="Q/A logs will appear here once the candidate attempts an interview." />;
  }
  return (
    <div className="mt-6">
      <div className="space-y-3">
        {interviews.map((it) => (
          <InterviewQAPanel
            key={it.id}
            candidateId={candidateId}
            interview={it}
            onDownloadPdf={() => onDownloadInterviewPdf(it)}
            onOpenFullReport={onOpenInterviewReport ? () => onOpenInterviewReport(it) : undefined}
            pdfDisabled={pdfBusyFull || pdfBusyInterviewId !== null}
            pdfBusyThis={pdfBusyInterviewId === it.id}
          />
        ))}
      </div>
      <PaginationFooter page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </div>
  );
}

function AnalyticsTab({
  analytics,
  interviews,
}: {
  analytics: {
    totalInterviews: number;
    avgScore: number;
    avgComm: number;
    avgTech: number;
    avgConf: number;
    bestScore: number;
    latestStatus: string;
    skillBreakdown: { skill: string; score: number }[];
  };
  interviews: CandidateInterviewSummary[];
}) {
  if (!interviews.length) {
    return <EmptyState title="No analytics yet" body="Analytics will populate after the candidate completes interviews." />;
  }
  const finalRecommendation = interviews[0]?.recommendation || analytics.latestStatus;
  return (
    <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-7 bg-surface-1 border border-subtle rounded-card p-5">
        <div className="text-sm font-extrabold tracking-tight">Skill performance</div>
        <div className="mt-4 space-y-3">
          {!analytics.skillBreakdown.length ? (
            <div className="text-sm text-muted">No per-skill breakdown available yet.</div>
          ) : (
            analytics.skillBreakdown.map((s) => (
              <div key={s.skill}>
                <div className="flex items-center justify-between text-xs font-semibold text-secondary">
                  <span className="truncate">{s.skill}</span>
                  <span>{s.score}%</span>
                </div>
                <div className="mt-1">
                  <ScoreBar value={s.score} tone="violet" />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="lg:col-span-5 space-y-4">
        <div className="bg-surface-1 border border-subtle rounded-card p-5">
          <div className="text-sm font-extrabold tracking-tight">Score averages</div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-card border border-subtle p-3">
              <div className="text-xs font-black uppercase tracking-widest text-muted">Communication</div>
              <div className="mt-1 text-xl font-extrabold text-primary">{analytics.avgComm}%</div>
              <ScoreBar value={analytics.avgComm} tone="violet" />
            </div>
            <div className="rounded-card border border-subtle p-3">
              <div className="text-xs font-black uppercase tracking-widest text-muted">Technical</div>
              <div className="mt-1 text-xl font-extrabold text-primary">{analytics.avgTech}%</div>
              <ScoreBar value={analytics.avgTech} tone="indigo" />
            </div>
            <div className="rounded-card border border-subtle p-3">
              <div className="text-xs font-black uppercase tracking-widest text-muted">Confidence</div>
              <div className="mt-1 text-xl font-extrabold text-primary">{analytics.avgConf}%</div>
              <ScoreBar value={analytics.avgConf} tone="emerald" />
            </div>
            <div className="rounded-card border border-subtle p-3">
              <div className="text-xs font-black uppercase tracking-widest text-muted">Best score</div>
              <div className="mt-1 text-xl font-extrabold text-primary">{analytics.bestScore}%</div>
              <ScoreBar value={analytics.bestScore} tone="amber" />
            </div>
          </div>
        </div>
        <div className="bg-surface-1 border border-subtle rounded-card p-5">
          <div className="text-sm font-extrabold tracking-tight">Final recommendation</div>
          <div className="mt-3 text-sm text-secondary">{finalRecommendation || "Pending review"}</div>
          <div className="mt-3 inline-flex items-center gap-2">
            <StatusPill variant="tile" status={analytics.latestStatus} />
            <span className="text-xs text-muted font-semibold">
              based on {analytics.totalInterviews} interview{analytics.totalInterviews === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
