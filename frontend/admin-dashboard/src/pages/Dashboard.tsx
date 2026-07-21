import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BrainCircuit,
  Building2,
  BriefcaseBusiness,
  Users,
  ClipboardList,
} from "lucide-react";
import type { Candidate, InterviewStatus, Session } from "../types";
import { deleteInterviewRecord, getDashboardData } from "../api";
import { CandidateSidebar } from "../components/CandidateSidebar";
import { SessionSidebar } from "../components/SessionSidebar";
import { CandidateDetail } from "../components/CandidateDetail";
import { SessionDetail } from "../components/SessionDetail";
import { DeleteInterviewRecordModal } from "../components/DeleteInterviewRecordModal";
import { useSelection } from "../hooks/useSelection";
import { useFilteredCandidates, useFilteredSessions } from "../hooks/useFilteredData";
import { navButtonMotion, pageSurfaceMotion } from "../lib/motionPresets";
import { ensureSessionsFromCandidates } from "../utils/scoreUtils";
import { ReportGroupSidebar } from "../components/ReportGroupSidebar";
import { ReportGroupDetail } from "../components/ReportGroupDetail";
import { buildGroupedReports, filterAndSortGroupedReports, type ReportSortMode } from "../utils/reportGrouping";

type ViewMode = "candidates" | "sessions" | "opportunity" | "customer";
type DeleteTarget = { candidateId: string; interviewId: string; label: string } | null;

function SkeletonCard() {
  return (
    <div className="h-full min-h-96 flex flex-col items-center justify-center bg-surface-1 border-2 border-dashed border-subtle rounded-card text-muted">
      <div className="bg-surface-2 p-8 rounded-full mb-6 ring-1 ring-inset ring-subtle">
        <BrainCircuit className="w-16 h-16 text-brand-300" />
      </div>
      <h3 className="text-display text-xl font-bold text-secondary">Loading dashboard...</h3>
      <p className="mt-2 text-muted max-w-sm text-center">Fetching candidates, sessions, and performance analytics.</p>
    </div>
  );
}

export function Dashboard({
  onOpenCandidateReport,
}: {
  onOpenCandidateReport?: (candidateId: string, interviewId?: string) => void;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("candidates");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortMode, setSortMode] = useState<ReportSortMode>("latest");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [deleteBusyId, setDeleteBusyId] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [toast, setToast] = useState("");

  const sel = useSelection<string>();
  const reduceMotion = useReducedMotion();
  const modeTap = navButtonMotion(!!reduceMotion);
  const detailKey = `${viewMode}:${sel.selectedId || "none"}`;
  const detailMotion = pageSurfaceMotion(`reports-detail:${detailKey}`, !!reduceMotion);

  const reloadDashboardData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError("");
      const { candidates: c, sessions: s } = await getDashboardData(200);
      setCandidates(c);
      setSessions(s);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const { candidates: c, sessions: s } = await getDashboardData(200);
        if (!alive) return;
        setCandidates(c);
        setSessions(s);
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
  }, []);

  const filteredCandidates = useFilteredCandidates(candidates, searchTerm);
  const filteredSessions = useFilteredSessions(sessions, searchTerm);
  const opportunityGroups = useMemo(() => buildGroupedReports(candidates, "opportunity"), [candidates]);
  const customerGroups = useMemo(() => buildGroupedReports(candidates, "customer"), [candidates]);
  const filteredOpportunityGroups = useMemo(
    () => filterAndSortGroupedReports(opportunityGroups, searchTerm, sortMode),
    [opportunityGroups, searchTerm, sortMode],
  );
  const filteredCustomerGroups = useMemo(
    () => filterAndSortGroupedReports(customerGroups, searchTerm, sortMode),
    [customerGroups, searchTerm, sortMode],
  );
  const activeGroupList = viewMode === "opportunity" ? filteredOpportunityGroups : viewMode === "customer" ? filteredCustomerGroups : [];

  const selectedCandidate = useMemo(() => {
    if (viewMode !== "candidates" || !sel.selectedId) return null;
    return candidates.find((c) => c.id === sel.selectedId) || null;
  }, [candidates, sel.selectedId, viewMode]);

  const selectedSession = useMemo(() => {
    if (viewMode !== "sessions" || !sel.selectedId) return null;
    return sessions.find((s) => s.id === sel.selectedId) || null;
  }, [sessions, sel.selectedId, viewMode]);

  const selectedGroup = useMemo(() => {
    if ((viewMode !== "opportunity" && viewMode !== "customer") || !sel.selectedId) return null;
    return activeGroupList.find((group) => group.id === sel.selectedId) || null;
  }, [activeGroupList, sel.selectedId, viewMode]);

  useEffect(() => {
    if (viewMode !== "opportunity" && viewMode !== "customer") return;
    if (!sel.selectedId) return;
    if (activeGroupList.some((group) => group.id === sel.selectedId)) return;
    sel.clear();
  }, [activeGroupList, sel, viewMode]);

  const handleInterviewStatus = useCallback((candidateId: string, interviewId: string, status: InterviewStatus) => {
    setCandidates((prev) =>
      prev.map((c) => {
        if (c.id !== candidateId) return c;
        return {
          ...c,
          interviews: (c.interviews || []).map((it) => (it.id === interviewId ? { ...it, status } : it)),
        };
      }),
    );
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2200);
  }, []);

  const removeInterviewLocally = useCallback((candidateId: string, interviewId: string) => {
    setCandidates((prev) => {
      const next = prev
        .map((c) => {
          if (c.id !== candidateId) return c;
          return { ...c, interviews: (c.interviews || []).filter((it) => it.id !== interviewId) };
        })
        .filter((c) => (c.interviews || []).length > 0);
      setSessions(ensureSessionsFromCandidates(next, []));
      return next;
    });
  }, []);

  const confirmDeleteInterview = useCallback(async () => {
    if (!deleteTarget || deleteBusyId) return;
    const { candidateId, interviewId } = deleteTarget;
    if (!interviewId) {
      setDeleteError("This record has no ID and cannot be deleted. Please contact support.");
      return;
    }
    setDeleteBusyId(interviewId);
    setDeleteError("");
    try {
      const ok = await deleteInterviewRecord(interviewId);
      if (!ok) throw new Error("Delete returned false — interview ID may be missing or invalid.");
      // Instantly remove from local state for immediate feedback, then silently
      // re-fetch from the backend so the sidebar stays consistent with the DB.
      removeInterviewLocally(candidateId, interviewId);
      setDeleteTarget(null);
      sel.clear();
      showToast("Record deleted successfully.");
      void reloadDashboardData(true);
    } catch (e: any) {
      setDeleteError(String(e?.message || e));
    } finally {
      setDeleteBusyId("");
    }
  }, [deleteBusyId, deleteTarget, reloadDashboardData, removeInterviewLocally, sel, showToast]);

  return (
    <div className="min-h-screen flex flex-col font-sans text-primary">
      <DeleteInterviewRecordModal
        open={Boolean(deleteTarget)}
        busy={Boolean(deleteBusyId)}
        error={deleteError}
        targetLabel={deleteTarget?.label}
        onClose={() => {
          if (deleteBusyId) return;
          setDeleteTarget(null);
          setDeleteError("");
        }}
        onConfirm={() => void confirmDeleteInterview()}
      />
      {toast ? (
        <div className="fixed bottom-6 right-6 z-50 rounded-card border border-subtle bg-success-soft px-4 py-3 text-sm font-bold text-success shadow-overlay">
          {toast}
        </div>
      ) : null}
      {/* Header */}
      <header className="glass fx-hairline-b px-4 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="fx-glow bg-gradient-to-br from-brand-600 to-violet-600 p-2 rounded-control">
            <BrainCircuit className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-display text-xl font-bold tracking-tight text-primary">Karnex Admin</h1>
            <p className="text-xs text-muted uppercase font-bold tracking-widest leading-none">Intelligence Dashboard</p>
          </div>
        </div>

        {/* Toggle Switch */}
        <div className="bg-surface-2 p-1 rounded-control flex flex-wrap gap-1 border border-subtle max-w-full">
          <motion.button
            type="button"
            onClick={() => {
              setViewMode("candidates");
              sel.clear();
            }}
            {...modeTap}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-control text-sm font-semibold transition-colors duration-micro ease-smooth ${
              viewMode === "candidates" ? "bg-surface-1 text-brand-600 shadow-raised ring-1 ring-subtle dark:text-brand-300" : "text-muted hover:text-primary"
            }`}
          >
            <Users className="w-4 h-4" /> Candidates
          </motion.button>
          <motion.button
            type="button"
            onClick={() => {
              setViewMode("sessions");
              sel.clear();
            }}
            {...modeTap}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-control text-sm font-semibold transition-colors duration-micro ease-smooth ${
              viewMode === "sessions" ? "bg-surface-1 text-brand-600 shadow-raised ring-1 ring-subtle dark:text-brand-300" : "text-muted hover:text-primary"
            }`}
          >
            <ClipboardList className="w-4 h-4" /> Skills/JD
          </motion.button>
          <motion.button
            type="button"
            onClick={() => {
              setViewMode("opportunity");
              sel.clear();
            }}
            {...modeTap}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-control text-sm font-semibold transition-colors duration-micro ease-smooth ${
              viewMode === "opportunity" ? "bg-surface-1 text-brand-600 shadow-raised ring-1 ring-subtle dark:text-brand-300" : "text-muted hover:text-primary"
            }`}
          >
            <BriefcaseBusiness className="w-4 h-4" /> Opportunity ID
          </motion.button>
          <motion.button
            type="button"
            onClick={() => {
              setViewMode("customer");
              sel.clear();
            }}
            {...modeTap}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-control text-sm font-semibold transition-colors duration-micro ease-smooth ${
              viewMode === "customer" ? "bg-surface-1 text-brand-600 shadow-raised ring-1 ring-subtle dark:text-brand-300" : "text-muted hover:text-primary"
            }`}
          >
            <Building2 className="w-4 h-4" /> Customer Name
          </motion.button>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:block text-right">
            <p className="text-sm font-bold text-primary">Admin Portal</p>
            <p className="text-xs text-accent-600 dark:text-accent-400 flex items-center justify-end gap-1">
              <span className="w-1.5 h-1.5 bg-accent-500 rounded-full motion-safe:animate-pulse"></span> System Live
            </p>
          </div>
          <div className="w-10 h-10 rounded-full bg-surface-2 ring-1 ring-inset ring-subtle flex items-center justify-center font-bold text-secondary">
            HR
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 mx-auto max-w-screen-2xl w-full grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Sidebar */}
        <div className="lg:col-span-3 space-y-4">
          {viewMode === "candidates" ? (
            <CandidateSidebar
              candidates={filteredCandidates}
              searchTerm={searchTerm}
              onSearchTerm={setSearchTerm}
              selectedId={sel.selectedId}
              onSelect={sel.setSelectedId}
            />
          ) : viewMode === "sessions" ? (
            <SessionSidebar
              sessions={filteredSessions}
              searchTerm={searchTerm}
              onSearchTerm={setSearchTerm}
              selectedId={sel.selectedId}
              onSelect={sel.setSelectedId}
            />
          ) : (
            <ReportGroupSidebar
              title={viewMode === "opportunity" ? "Opportunity Reports" : "Customer Reports"}
              searchPlaceholder={viewMode === "opportunity" ? "Search opportunity IDs..." : "Search customers..."}
              groups={activeGroupList}
              searchTerm={searchTerm}
              onSearchTerm={setSearchTerm}
              sortMode={sortMode}
              onSortMode={setSortMode}
              selectedId={sel.selectedId}
              onSelect={sel.setSelectedId}
            />
          )}
        </div>

        {/* Detail Area */}
        <div className="lg:col-span-9">
          {loading ? (
            <SkeletonCard />
          ) : error ? (
            <div className="h-full min-h-96 flex flex-col items-center justify-center bg-danger-soft border border-subtle rounded-card text-danger p-10">
              <div className="font-black text-xl">Dashboard error</div>
              <div className="text-sm mt-2">{error}</div>
              <div className="text-xs mt-4 text-muted">Tip: make sure you are logged in as HR in the main app so the token is present.</div>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={detailKey}
                variants={detailMotion.variants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={detailMotion.transition}
              >
                {!sel.selectedId ? (
                  <div className="h-full min-h-96 flex flex-col items-center justify-center bg-surface-1 border-2 border-dashed border-subtle rounded-card text-muted">
                    <div className="bg-surface-2 p-8 rounded-full mb-6 ring-1 ring-inset ring-subtle">
                      {viewMode === "candidates" ? (
                        <Users className="w-16 h-16 text-brand-300" />
                      ) : viewMode === "sessions" ? (
                        <ClipboardList className="w-16 h-16 text-brand-300" />
                      ) : viewMode === "opportunity" ? (
                        <BriefcaseBusiness className="w-16 h-16 text-brand-300" />
                      ) : (
                        <Building2 className="w-16 h-16 text-brand-300" />
                      )}
                    </div>
                    <h3 className="text-display text-xl font-bold text-secondary">Ready to Review</h3>
                    <p className="mt-2 text-muted max-w-sm text-center">
                      Select{" "}
                      {viewMode === "candidates"
                        ? "a candidate"
                        : viewMode === "sessions"
                          ? "an interview session"
                          : viewMode === "opportunity"
                            ? "an opportunity group"
                            : "a customer group"}{" "}
                      from the sidebar to view full performance metrics.
                    </p>
                  </div>
                ) : viewMode === "candidates" && selectedCandidate ? (
                  <CandidateDetail
                    candidate={selectedCandidate}
                    onOpenInterviewReport={onOpenCandidateReport}
                    onInterviewStatusChange={handleInterviewStatus}
                    onRequestDeleteInterview={(candidateId, interview) => {
                      if (!interview.id) {
                        showToast("Cannot delete: this record has no ID. Contact support.");
                        return;
                      }
                      setDeleteTarget({
                        candidateId,
                        interviewId: interview.id,
                        label: `${selectedCandidate.name} • ${interview.templateTitle || interview.sessionName || "Interview"}`,
                      });
                    }}
                    deleteBusyInterviewId={deleteBusyId}
                  />
                ) : viewMode === "sessions" && selectedSession ? (
                  <SessionDetail
                    session={selectedSession}
                    candidates={candidates}
                    onOpenCandidate={(id) => {
                      setViewMode("candidates");
                      sel.setSelectedId(id);
                    }}
                    onRequestDeleteInterview={(candidate, interview) => {
                      if (!interview.id) {
                        showToast("Cannot delete: this record has no ID. Contact support.");
                        return;
                      }
                      setDeleteTarget({
                        candidateId: candidate.id,
                        interviewId: interview.id,
                        label: `${candidate.name} • ${interview.templateTitle || interview.sessionName || selectedSession.name}`,
                      });
                    }}
                    deleteBusyInterviewId={deleteBusyId}
                  />
                ) : (viewMode === "opportunity" || viewMode === "customer") ? (
                  <ReportGroupDetail
                    groupLabel={viewMode === "opportunity" ? "Opportunity ID" : "Customer Name"}
                    group={selectedGroup}
                    onOpenCandidateReport={onOpenCandidateReport}
                  />
                ) : null}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </main>

      <footer className="glass py-6 px-8 text-muted text-xs font-black uppercase tracking-widest flex justify-between items-center">
        <div>&copy; 2026 AI Recruitment Analytics Engine</div>
        <div className="flex gap-6">
          <span className="hover:text-secondary cursor-pointer">Security Policy</span>
          <span className="hover:text-secondary cursor-pointer">System Logs</span>
          <span className="hover:text-secondary cursor-pointer text-brand-500">Support Terminal</span>
        </div>
      </footer>
    </div>
  );
}

