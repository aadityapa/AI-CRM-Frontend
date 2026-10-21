import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { HERO_BTN, HERO_BTN_SOLID, PageHeader } from "../crm/components/PageHeader";
import { FilteredBars, Panel, StepBars, Tile } from "../crm/components/controlTower";
import type { ReactNode } from "react";
import type { Candidate, Interview, InterviewStatus } from "../types";
import { deleteCandidate, getDashboardData, getSchedules, type InterviewSchedule } from "../api";
import { motion } from "framer-motion";
import { normalizeScore, weightedCandidateScore } from "../utils/scoreUtils";
import { AnimatedNumber } from "../crm/components/motion3d";
import {
  btnDanger,
  btnSecondary,
  EmptyState,
  focusRing,
  Skeleton,
} from "../crm/components/ui";

type Trend = { direction: "up" | "down" | "flat"; label: string };

/* Motion tokens mirrored for framer-motion (--motion-micro 150ms, --ease-out).
 * Rows get a quiet 150ms fade — no entrance movement (calm-premium). */
const EASE_OUT: [number, number, number, number] = [0.2, 0, 0, 1];
const rowFade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { duration: 0.15, ease: EASE_OUT },
} as const;

/* Shared card recipe: raised card on the token ladder. */
const cardCls = "rounded-card border border-subtle bg-surface-1 shadow-raised";

function safeParseDate(value: string): number {
  const t = Date.parse(value || "");
  return Number.isFinite(t) ? t : 0;
}

function initials(name: string) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("") || "C";
}

function latestInterview(c: Candidate): Interview | null {
  const list = c.interviews || [];
  if (!list.length) return null;
  return [...list].sort((a, b) => safeParseDate(b.date) - safeParseDate(a.date))[0] || null;
}

function TrendPill({ trend }: { trend: Trend }) {
  const cls =
    trend.direction === "up"
      ? "bg-success-soft text-success"
      : trend.direction === "down"
        ? "bg-danger-soft text-danger"
        : "bg-surface-2 text-muted";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ring-black/5 dark:ring-white/10 ${cls}`}
    >
      {trend.label}
    </span>
  );
}

export function DashboardStatsCard({
  title,
  value,
  icon,
  trend,
  subtext,
  loading,
}: {
  title: string;
  value: string;
  icon: ReactNode;
  trend: Trend;
  subtext?: string;
  loading?: boolean;
}) {
  const plainNumber = /^\d+$/.test(value);
  return (
    <div className="glass fx-gradient-border fx-lift relative h-full overflow-hidden rounded-card p-5 shadow-raised">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</div>
          {loading ? (
            <Skeleton className="mt-3 h-8 w-28" />
          ) : (
            <div className="text-display mt-2 text-2xl font-bold tracking-tight tabular-nums text-primary">
              {plainNumber ? <AnimatedNumber value={Number(value)} /> : value}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            {loading ? <Skeleton className="h-5 w-14" /> : <TrendPill trend={trend} />}
            {subtext ? <span className="text-xs text-muted">{subtext}</span> : null}
          </div>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-surface-2 text-brand-600 ring-1 ring-inset ring-black/5 dark:text-brand-300 dark:ring-white/10">
          {icon}
        </div>
      </div>
    </div>
  );
}

export function PipelineStageCard({
  name,
  count,
  color,
  percent,
}: {
  name: string;
  count: number;
  color: "slate" | "amber" | "indigo" | "violet" | "emerald";
  percent: number;
}) {
  /* Single-hue system: stage tones map onto the brand/semantic ramps. */
  const tone =
    color === "amber"
      ? "bg-warning"
      : color === "indigo"
        ? "bg-brand-500"
        : color === "violet"
          ? "bg-brand-700"
          : color === "emerald"
            ? "bg-success"
            : "bg-neutral-400";

  return (
    <div className={`p-4 transition-shadow duration-micro ease-smooth hover:shadow-overlay ${cardCls}`}>
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${tone}`} aria-hidden />
          <div className="text-sm font-semibold text-secondary">{name}</div>
        </div>
        <div className="text-sm font-bold tabular-nums text-primary">
          <AnimatedNumber value={count} />
        </div>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${tone} transition-[width] duration-panel ease-smooth`}
          style={{ width: `${Math.max(4, Math.min(100, percent))}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-muted">{percent}% of pipeline</div>
    </div>
  );
}

// May 2026: extended the pipeline pill with a fifth "On Hold" state so the
// recruiter sees the deferred decision directly in candidate lists.
type PipelineStatus = "Pending" | "In Review" | "Completed" | "Rejected" | "On Hold";

function PipelineStatusPill({ status }: { status: PipelineStatus }) {
  const styles =
    status === "Completed"
      ? "bg-success-soft text-success"
      : status === "In Review"
        ? "bg-info-soft text-info"
        : status === "Rejected"
          ? "bg-danger-soft text-danger"
          : "bg-warning-soft text-warning"; // Pending + On Hold
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset ring-black/5 dark:ring-white/10 ${styles}`}>
      {status}
    </span>
  );
}

function mapCandidateStatus(
  latest: Interview | null,
  hrDecision?: "shortlist" | "reject" | "on_hold" | null,
): PipelineStatus {
  if (hrDecision === "reject") return "Rejected";
  if (hrDecision === "shortlist") return "Completed";
  // May 2026 — "on_hold" beats interview-level status, so HR sees the
  // explicit decision instead of the model's default "In Review".
  if (hrDecision === "on_hold") return "On Hold";
  if (!latest) return "Pending";
  const s = String(latest.status || "").toLowerCase();
  if (s.includes("rejected")) return "Rejected";
  if (s.includes("selected")) return "Completed";
  if (s.includes("hold")) return "On Hold";
  if (s.includes("pending")) return "In Review";
  return "In Review";
}

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

const RECENT_CANDIDATES_PAGE_SIZE = 10;

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
      <div className="absolute inset-0 bg-neutral-900/60" onClick={busy ? undefined : onClose} />
      <div className="absolute inset-x-0 top-24 mx-auto w-full max-w-md px-4">
        <div className="overflow-hidden rounded-modal border border-subtle bg-surface-1 shadow-modal">
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-base font-bold text-primary">Delete candidate permanently?</div>
                <div className="mt-2 text-sm text-secondary">
                  Are you sure you want to permanently delete{" "}
                  <span className="font-semibold text-primary">{candidateName || "this candidate"}</span>{" "}
                  and all interview records?
                </div>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">
                  <li>Profile, interview history, evaluations</li>
                  <li>AI analytics, ATS records, schedules</li>
                  <li>Cached data, session and login data</li>
                </ul>
                <div className="mt-3 text-xs font-semibold text-danger">This action cannot be undone.</div>
                {error ? <div className="mt-3 text-xs text-danger">{error}</div> : null}
              </div>
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy} className={btnSecondary}>
                Cancel
              </button>
              <button type="button" onClick={onConfirm} disabled={busy} className={btnDanger}>
                {busy ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RecentCandidatesTable({
  candidates,
  onOpenInvite,
  onViewCandidateReport,
  onRefresh,
  onViewAll,
}: {
  candidates: Candidate[];
  onOpenInvite: (candidateId: string) => void;
  onViewCandidateReport: (candidateId: string, interviewId?: string) => void;
  onRefresh: () => Promise<void> | void;
  onViewAll?: () => void;
}) {
  const [toast, setToast] = useState<string>("");
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    return [...(candidates || [])]
      .map((c) => {
        const latest = latestInterview(c);
        const score = latest ? normalizeScore(latest.score) : weightedCandidateScore(c.interviews || []);
        return {
          id: c.id,
          name: c.name,
          email: c.email || "",
          role: c.role,
          opportunityId: latest?.opportunityId || "",
          customerName: latest?.customerName || "",
          score,
          status: mapCandidateStatus(latest, c.hr_decision),
          date: latest?.date || "",
          scheduledAt: (latest as any)?.scheduled_at_local || "",
          completedAt: (latest as any)?.completed_at_ist || "",
          interviewId: latest?.id || "",
        };
      })
      .sort((a, b) => {
        const ta = safeParseDate(a.scheduledAt || a.completedAt || a.date);
        const tb = safeParseDate(b.scheduledAt || b.completedAt || b.date);
        return tb - ta;
      });
  }, [candidates]);

  const totalPages = Math.max(1, Math.ceil(rows.length / RECENT_CANDIDATES_PAGE_SIZE));

  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages, rows.length]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * RECENT_CANDIDATES_PAGE_SIZE;
    return rows.slice(start, start + RECENT_CANDIDATES_PAGE_SIZE);
  }, [rows, page]);

  const rangeStart = rows.length === 0 ? 0 : (page - 1) * RECENT_CANDIDATES_PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * RECENT_CANDIDATES_PAGE_SIZE, rows.length);

  const requestDelete = (id: string, name: string) => {
    setDeleteError("");
    setConfirmTarget({ id, name });
  };

  const cancelDelete = () => {
    if (deleteBusy) return;
    setConfirmTarget(null);
    setDeleteError("");
  };

  const confirmDelete = async () => {
    if (!confirmTarget) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteCandidate(confirmTarget.id);
      setConfirmTarget(null);
      setToast("Candidate deleted.");
      window.setTimeout(() => setToast(""), 1600);
      try {
        await onRefresh();
      } catch (_) {
        // refresh errors are non-fatal; user still got deletion confirmation
      }
    } catch (e: any) {
      setDeleteError(String(e?.message || e));
    } finally {
      setDeleteBusy(false);
    }
  };

  const thBase =
    "sticky top-0 z-10 whitespace-nowrap bg-surface-1 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted";

  return (
    <div className={`overflow-hidden ${cardCls}`}>
      <DeleteCandidateModal
        open={!!confirmTarget}
        candidateName={confirmTarget?.name || ""}
        busy={deleteBusy}
        error={deleteError}
        onClose={cancelDelete}
        onConfirm={confirmDelete}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-5 py-4">
        <div>
          <div className="text-sm font-bold text-primary">Recent candidates</div>
          <div className="mt-0.5 text-xs text-muted">Latest interview activity and outcomes</div>
        </div>
        {onViewAll ? (
          <button
            onClick={onViewAll}
            className={`inline-flex items-center gap-1 rounded-control px-1.5 py-1 text-sm font-semibold text-brand-600 transition-colors duration-micro ease-smooth hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200 ${focusRing}`}
          >
            View all <ArrowUpRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm lg:min-w-0">
          <thead>
            <tr className="border-b border-subtle text-left">
              <th className={thBase}>Candidate</th>
              <th className={thBase}>Role</th>
              <th className={thBase}>Opportunity ID</th>
              <th className={thBase}>Customer</th>
              <th className={`${thBase} text-right`}>AI Score</th>
              <th className={thBase}>Status</th>
              <th className={thBase}>Interview Date</th>
              <th className={`${thBase} w-44 text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length ? (
              <tr>
                <td colSpan={8}>
                  <EmptyState
                    icon={<ClipboardList size={22} />}
                    message="No candidates yet — schedule an interview from HR Setup and this table will auto-populate from the database."
                    actionLabel="Invite candidate"
                    onAction={() => onOpenInvite("")}
                  />
                </td>
              </tr>
            ) : (
              pageRows.map((r) => (
                <motion.tr
                  key={r.id}
                  className="row-hover h-12 border-b border-subtle align-middle transition-colors duration-micro ease-smooth last:border-b-0"
                  {...rowFade}
                >
                  <td className="px-4 py-2 align-middle">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-secondary ring-1 ring-inset ring-black/5 dark:ring-white/10">
                        {initials(r.name)}
                      </div>
                      <div className="min-w-0 leading-tight">
                        <div className="truncate font-semibold text-primary">{r.name}</div>
                        <div className="truncate text-xs text-muted">{r.email || r.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2 align-middle font-medium text-secondary">{r.role}</td>
                  <td className="px-4 py-2 align-middle text-secondary">{r.opportunityId || "—"}</td>
                  <td className="px-4 py-2 align-middle text-secondary">{r.customerName || "—"}</td>
                  <td className="px-4 py-2 text-right align-middle">
                    <div className="inline-flex items-center justify-end gap-2">
                      <span className="w-8 text-right font-semibold tabular-nums text-primary">{r.score}</span>
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full bg-brand-500 transition-[width] duration-panel ease-smooth"
                          style={{ width: `${Math.max(2, Math.min(100, r.score))}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2 align-middle">
                    <PipelineStatusPill status={r.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 align-middle font-medium text-secondary">
                    {fmtDateLabel(r.scheduledAt || r.completedAt || r.date)}
                  </td>
                  <td className="px-4 py-2 align-middle">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => onViewCandidateReport(r.id, r.interviewId || undefined)}
                        className={`inline-flex h-8 items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-2.5 text-xs font-semibold text-secondary transition-colors duration-micro ease-smooth hover:border-strong hover:bg-surface-2 hover:text-primary active:bg-surface-0 ${focusRing}`}
                      >
                        <ArrowUpRight className="h-4 w-4" /> View
                      </button>
                      <button
                        type="button"
                        onClick={() => requestDelete(r.id, r.name)}
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-control border border-subtle bg-surface-1 text-muted transition-colors duration-micro ease-smooth hover:bg-danger-soft hover:text-danger active:bg-surface-0 ${focusRing}`}
                        aria-label="Delete candidate"
                        title="Delete candidate"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {rows.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-subtle bg-surface-2 px-5 py-3">
          <div className="text-xs text-muted">
            <span className="font-semibold text-secondary">
              {rangeStart}–{rangeEnd}
            </span>
            <span> of {rows.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className={`inline-flex h-8 items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-2.5 text-xs font-semibold text-secondary transition-colors duration-micro ease-smooth hover:border-strong hover:bg-surface-2 hover:text-primary disabled:pointer-events-none disabled:opacity-50 ${focusRing}`}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>
            <span className="px-2 text-xs font-semibold tabular-nums text-muted">
              Page {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className={`inline-flex h-8 items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-2.5 text-xs font-semibold text-secondary transition-colors duration-micro ease-smooth hover:border-strong hover:bg-surface-2 hover:text-primary disabled:pointer-events-none disabled:opacity-50 ${focusRing}`}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {toast ? <div className="px-5 pb-4 text-xs text-muted">{toast}</div> : null}
    </div>
  );
}

export function UpcomingInterviewCard({ schedules, onViewAll }: { schedules: InterviewSchedule[]; onViewAll?: () => void }) {
  const items = useMemo(() => {
    const now = Date.now();
    const next48 = now + 48 * 60 * 60 * 1000;
    return (schedules || [])
      .map((s) => ({
        id: s.id,
        name: s.candidate_name || "Candidate",
        role: s.role || s.job_title || s.template_name || "Interview",
        opportunityId: s.opportunityId || "",
        customerName: s.customerName || "",
        when: s.scheduled_at_local || "",
        status: String(s.status || "scheduled"),
        ts: safeParseDate(s.scheduled_at_local || ""),
      }))
      .filter((x) => x.ts && x.ts >= now && x.ts <= next48)
      .sort((a, b) => a.ts - b.ts)
      .slice(0, 8);
  }, [schedules]);

  const dot = (status: string) => {
    const s = (status || "").toLowerCase();
    if (s.includes("scheduled")) return "bg-success";
    if (s.includes("resched")) return "bg-warning";
    if (s.includes("cancel")) return "bg-danger";
    return "bg-neutral-400";
  };

  return (
    <div className={`overflow-hidden ${cardCls}`}>
      <div className="flex items-start justify-between gap-3 border-b border-subtle px-5 py-4">
        <div>
          <div className="text-sm font-bold text-primary">Upcoming interviews</div>
          <div className="mt-0.5 text-xs text-muted">Next 48 hours</div>
        </div>
        {onViewAll ? (
          <button
            type="button"
            onClick={onViewAll}
            className={`inline-flex items-center gap-1 rounded-control px-1.5 py-1 text-xs font-semibold text-brand-600 transition-colors duration-micro ease-smooth hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200 ${focusRing}`}
          >
            View all <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <div className="space-y-3 p-4">
        {!items.length ? (
          <EmptyState message="No upcoming interviews — once an interview is scheduled in HR Setup, it will appear here automatically." />
        ) : (
          items.map((it) => (
            <motion.div
              key={it.id || `${it.name}-${it.when}`}
              className="flex items-center gap-3 rounded-card border border-subtle bg-surface-1 p-3 transition-colors duration-micro ease-smooth hover:bg-surface-2"
              {...rowFade}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-secondary ring-1 ring-inset ring-black/5 dark:ring-white/10">
                {initials(it.name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate font-semibold text-primary">{it.name}</div>
                  <div className="whitespace-nowrap text-xs text-muted">{fmtDateLabel(it.when)}</div>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs text-muted">{it.role}</div>
                    {(it.opportunityId || it.customerName) ? (
                      <div className="mt-0.5 truncate text-xs text-muted">
                        {[it.opportunityId ? `Opp: ${it.opportunityId}` : "", it.customerName ? it.customerName : ""]
                          .filter(Boolean)
                          .join(" • ")}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted">
                    <span className={`h-2 w-2 rounded-full ${dot(it.status)}`} aria-hidden />
                    <span className="font-semibold">{it.status}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}

function isCompletedStatus(s: InterviewStatus) {
  const t = String(s || "").toLowerCase();
  return t.includes("selected") || t.includes("rejected");
}

export function AIInsightsCard({ candidates }: { candidates: Candidate[] }) {
  const insights = useMemo(() => {
    const list = candidates || [];
    const completedInterviews = list.flatMap((c) => (c.interviews || []).filter((i) => isCompletedStatus(i.status)));
    const allInterviews = list.flatMap((c) => c.interviews || []);
    const completionRate = allInterviews.length ? Math.round((completedInterviews.length / allInterviews.length) * 100) : 0;
    const recommended = list.filter(
      (c) =>
        weightedCandidateScore(c.interviews || []) >= 80 && mapCandidateStatus(latestInterview(c), c.hr_decision) !== "Rejected",
    ).length;

    const byRole = new Map<string, { sum: number; n: number }>();
    for (const c of list) {
      const score = weightedCandidateScore(c.interviews || []);
      const role = String(c.role || "Candidate").trim() || "Candidate";
      const cur = byRole.get(role) || { sum: 0, n: 0 };
      byRole.set(role, { sum: cur.sum + score, n: cur.n + 1 });
    }
    let topRole = "";
    let topRoleScore = 0;
    for (const [role, v] of byRole.entries()) {
      const avg = v.n ? Math.round(v.sum / v.n) : 0;
      if (avg >= topRoleScore) {
        topRoleScore = avg;
        topRole = role;
      }
    }

    const avgScore = allInterviews.length
      ? Math.round(allInterviews.map((i) => normalizeScore(i.score)).reduce((a, b) => a + b, 0) / allInterviews.length)
      : 0;
    const responseQuality = avgScore ? `${(avgScore / 20).toFixed(1)}/5` : "—";

    return {
      topRole: { label: "Top performing role", value: topRole || "—", score: topRoleScore },
      completion: { label: "Interview completion rate", value: `${completionRate}%`, pct: completionRate },
      recommended: { label: "Recommended candidates", value: String(recommended), pct: Math.min(100, Math.round((recommended / Math.max(1, list.length)) * 100)) },
      response: { label: "Avg response quality", value: responseQuality, pct: avgScore },
    };
  }, [candidates]);

  const Bar = ({ pct, tone }: { pct: number; tone: "indigo" | "emerald" | "violet" | "amber" }) => {
    const c =
      tone === "emerald"
        ? "bg-success"
        : tone === "violet"
          ? "bg-brand-700"
          : tone === "amber"
            ? "bg-warning"
            : "bg-brand-500";
    return (
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${c} transition-[width] duration-panel ease-smooth`}
          style={{ width: `${Math.max(4, Math.min(100, pct))}%` }}
        />
      </div>
    );
  };

  return (
    <div className={`fx-gradient-border p-5 transition-shadow duration-micro ease-smooth hover:shadow-overlay ${cardCls}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-primary">
            AI hiring insights
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-accent-600 ring-1 ring-inset ring-subtle dark:text-accent-400">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden />
              AI
            </span>
          </div>
          <div className="mt-0.5 text-xs text-muted">Signal quality, completion, and recommendations</div>
        </div>
        {/* ai-surface: reserved accent for AI-generated content only */}
        <div className="ai-surface flex h-10 w-10 items-center justify-center rounded-control">
          <Sparkles className="h-5 w-5 text-brand-600 dark:text-brand-300" />
        </div>
      </div>

      {!candidates?.length ? (
        <EmptyState
          icon={<Sparkles size={22} />}
          message="Waiting for data — insights appear automatically after candidates/interviews are created from HR Setup."
        />
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-card border border-subtle bg-surface-2 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">{insights.topRole.label}</div>
            <div className="mt-2 font-bold text-primary">{insights.topRole.value}</div>
            <div className="mt-2 text-xs text-muted">
              Avg score: <span className="font-semibold text-secondary">{insights.topRole.score}</span>
            </div>
            <Bar pct={insights.topRole.score} tone="violet" />
          </div>
          <div className="rounded-card border border-subtle p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">{insights.completion.label}</div>
              <div className="text-sm font-bold tabular-nums text-primary">{insights.completion.value}</div>
            </div>
            <Bar pct={insights.completion.pct} tone="emerald" />
            <div className="mt-2 text-xs text-muted">Fewer drop-offs after the first question.</div>
          </div>
          <div className="rounded-card border border-subtle p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">{insights.recommended.label}</div>
              <div className="text-sm font-bold tabular-nums text-primary">{insights.recommended.value}</div>
            </div>
            <Bar pct={insights.recommended.pct} tone="indigo" />
            <div className="mt-2 text-xs text-muted">Calibrated threshold: ≥ 80 AI score.</div>
          </div>
          <div className="rounded-card border border-subtle p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">{insights.response.label}</div>
              <div className="text-sm font-bold tabular-nums text-primary">{insights.response.value}</div>
            </div>
            <Bar pct={insights.response.pct} tone="amber" />
            <div className="mt-2 text-xs text-muted">High coherence and specificity across answers.</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Interview weeks for the trend chart: the last `n` Monday-start weeks (PURE). */
export function weekBuckets(candidates: Candidate[], n = 8, now = new Date()): {
  label: string; completed: number; pending: number; avg: number;
}[] {
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const starts = Array.from({ length: n }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() - (n - 1 - i) * 7);
    return d.getTime();
  });
  const rows = starts.map((t) => ({
    label: new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    completed: 0, pending: 0, sum: 0, scored: 0,
  }));
  const end = starts[starts.length - 1] + 7 * 86_400_000;
  for (const c of candidates || []) {
    for (const iv of c.interviews || []) {
      const t = safeParseDate(iv.date);
      if (!t || t < starts[0] || t >= end) continue;
      const idx = Math.min(n - 1, Math.floor((t - starts[0]) / (7 * 86_400_000)));
      const row = rows[idx];
      if (isCompletedStatus(iv.status) || String(iv.status || "").toLowerCase().includes("hold")) row.completed += 1;
      else row.pending += 1;
      const sc = normalizeScore(iv.score);
      if (sc > 0) { row.sum += sc; row.scored += 1; }
    }
  }
  return rows.map((r) => ({ label: r.label, completed: r.completed, pending: r.pending,
    avg: r.scored ? Math.round(r.sum / r.scored) : 0 }));
}

/** Completed interviews waiting for HR's call, newest first (PURE). */
export function awaitingDecision(candidates: Candidate[], limit = 6) {
  const out: { candidate: Candidate; interview: Interview; score: number; ts: number }[] = [];
  for (const c of candidates || []) {
    if (c.hr_decision) continue;
    const latest = latestInterview(c);
    if (!latest) continue;
    const st = String(latest.status || "").toLowerCase();
    if (!st.includes("pending")) continue;
    const score = normalizeScore(latest.score);
    if (score <= 0) continue;                       // not finished / not scored yet
    out.push({ candidate: c, interview: latest, score, ts: safeParseDate(latest.date) });
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

function scoreTone(v: number): string {
  if (v >= 75) return "text-success";
  if (v >= 55) return "text-brand-600 dark:text-brand-300";
  if (v >= 40) return "text-warning";
  return "text-danger";
}

function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-danger/40 bg-danger-soft p-4 text-sm text-danger">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{message}</span>
      </div>
      <button type="button" onClick={onRetry} className={btnSecondary}>Retry</button>
    </div>
  );
}

/** Readable words for a failed request — never a bare "Internal server error". */
function friendly(e: unknown, what: string): string {
  const raw = String((e as Error)?.message || e || "").trim();
  if (/internal server error|\b500\b/i.test(raw)) {
    return `The server could not load ${what} just now. Retry — if it keeps failing, the server log names the cause.`;
  }
  if (/failed to fetch|network/i.test(raw)) return `No connection to the server while loading ${what}. Check the network and retry.`;
  return raw ? `${what[0].toUpperCase()}${what.slice(1)} could not load: ${raw}` : `${what} could not load.`;
}

export function HrDashboard({
  onCreateTemplate,
  onInviteCandidate,
  onViewCandidateReport,
  onViewAllCandidates,
  onViewAllUpcoming,
}: {
  onCreateTemplate: () => void;
  onInviteCandidate: () => void;
  onViewCandidateReport: (candidateId: string, interviewId?: string) => void;
  onViewAllCandidates?: () => void;
  onViewAllUpcoming?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [candError, setCandError] = useState("");
  const [schedError, setSchedError] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [schedules, setSchedules] = useState<InterviewSchedule[]>([]);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  /* 21 Oct 2026 (user report: the whole page read 0 with "Internal server
     error"): the two calls are independent — one failing no longer blanks the
     other, and each panel says what failed with a Retry. */
  const load = async () => {
    setLoading(true);
    const [dash, sch] = await Promise.allSettled([getDashboardData(200), getSchedules()]);
    if (dash.status === "fulfilled") { setCandidates(dash.value.candidates || []); setCandError(""); }
    else setCandError(friendly(dash.reason, "candidates and interviews"));
    if (sch.status === "fulfilled") { setSchedules(sch.value || []); setSchedError(""); }
    else setSchedError(friendly(sch.reason, "scheduled interviews"));
    setLoadedAt(new Date());
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const derived = useMemo(() => {
    const list = candidates || [];
    const allInterviews = list.flatMap((c) => c.interviews || []);
    const active = allInterviews.filter((i) => String(i.status || "").toLowerCase().includes("pending")).length;
    const completedList = allInterviews.filter((i) => isCompletedStatus(i.status));
    const completed = completedList.length;
    const scored = allInterviews.map((i) => normalizeScore(i.score)).filter((v) => v > 0);
    const avgScore = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 0;
    const selected = allInterviews.filter((i) => String(i.status || "").toLowerCase().includes("selected")).length;
    const rejected = allInterviews.filter((i) => String(i.status || "").toLowerCase().includes("rejected")).length;
    const onHold = allInterviews.filter((i) => String(i.status || "").toLowerCase().includes("hold")).length;
    const decided = selected + rejected;
    const hireRate = decided ? Math.round((selected / decided) * 100) : 0;

    const weekStart = Date.now() - 7 * 86_400_000;
    const thisWeek = allInterviews.filter((i) => safeParseDate(i.date) >= weekStart).length;

    const applied = list.filter((c) => !(c.interviews || []).length).length;
    const screening = list.filter((c) => {
      const latest = latestInterview(c);
      return !!latest && String(latest.status || "").toLowerCase().includes("pending");
    }).length;
    const hired = list.filter((c) => {
      if (c.hr_decision === "shortlist") return true;
      const latest = latestInterview(c);
      return !!latest && String(latest.status || "").toLowerCase().includes("selected");
    }).length;
    const totalPipeline = Math.max(1, applied + screening + completed + hired + active);
    const pipeline = [
      { name: "Applied", count: applied, color: "slate" as const },
      { name: "Screening", count: screening, color: "amber" as const },
      { name: "Interview", count: active, color: "indigo" as const },
      { name: "Evaluation", count: completed, color: "violet" as const },
      { name: "Hired", count: hired, color: "emerald" as const },
    ].map((p) => ({ ...p, percent: Math.round((p.count / totalPipeline) * 100) }));

    const scoreBands = [
      { label: "75–100", value: scored.filter((v) => v >= 75).length, cls: "bg-emerald-500" },
      { label: "55–74", value: scored.filter((v) => v >= 55 && v < 75).length, cls: "bg-brand-500" },
      { label: "40–54", value: scored.filter((v) => v >= 40 && v < 55).length, cls: "bg-amber-500" },
      { label: "Under 40", value: scored.filter((v) => v < 40).length, cls: "bg-rose-500" },
    ];
    return { list, active, completed, avgScore, selected, rejected, onHold, hireRate, thisWeek, pipeline, scoreBands,
      weeks: weekBuckets(list), waiting: awaitingDecision(list) };
  }, [candidates]);

  const upcoming48 = useMemo(() => {
    const now = Date.now();
    return (schedules || []).filter((s) => {
      const t = safeParseDate(s.scheduled_at_local || "");
      return t >= now && t <= now + 48 * 3_600_000;
    }).length;
  }, [schedules]);

  const num = (v: number) => (loading ? "…" : v.toLocaleString("en-IN"));

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        icon={BarChart3}
        accent="brand"
        eyebrow="Interview Platform"
        title="AI interview dashboard"
        subtitle="Every AI interview — who is waiting for your decision, how candidates score, and what is coming up."
        stats={[
          { label: "candidates", value: loading ? "…" : derived.list.length },
          { label: "this week", value: loading ? "…" : derived.thisWeek },
          { label: "next 48 h", value: loading ? "…" : upcoming48 },
        ]}
        actions={
          <>
            <button type="button" onClick={() => void load()} className={HERO_BTN} title="Refresh">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden /> Refresh
            </button>
            <button type="button" onClick={onCreateTemplate} className={HERO_BTN}>
              <Plus className="h-4 w-4" aria-hidden /> Create template
            </button>
            <button type="button" onClick={onInviteCandidate} className={HERO_BTN_SOLID}>
              <ClipboardList className="h-4 w-4" aria-hidden /> Invite candidate
            </button>
          </>
        }
      />

      {candError ? <PanelError message={candError} onRetry={() => void load()} /> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Candidates" value={num(derived.list.length)} sub="with an AI interview record" tone="brand" />
        <Tile label="Awaiting review" value={num(derived.active)} sub="interviews pending a decision" tone="warning" />
        <Tile label="Decided" value={num(derived.completed)} sub={`${derived.selected} selected · ${derived.rejected} rejected`} tone="neutral" />
        <Tile label="Average score" value={loading ? "…" : derived.avgScore ? `${derived.avgScore}%` : "—"} sub="across scored interviews" tone="brand" />
        <Tile label="Selection rate" value={loading ? "…" : derived.selected + derived.rejected ? `${derived.hireRate}%` : "—"} sub="selected of decided" tone="success" />
        <Tile label="On hold" value={num(derived.onHold)} sub="parked by a recruiter" tone="danger" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-8">
          <Panel className="!h-auto" title="Interviews over the last 8 weeks" hint="Decided vs still pending, by the week the interview ran">
            {loading ? <Skeleton className="h-60 w-full" /> : (
              <FilteredBars
                data={derived.weeks}
                series={[
                  { key: "completed", label: "Decided / on hold", color: "#10b981", stackId: "a" },
                  { key: "pending", label: "Pending review", color: "#f59e0b", stackId: "a" },
                  { key: "avg", label: "Average score %", color: "#6366f1", defaultOff: true },
                ]}
                height={250}
                stacked
              />
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Panel title="Hiring pipeline" hint="Where every candidate stands">
              <StepBars
                steps={derived.pipeline.map((p) => ({
                  label: p.name, value: p.count,
                  cls: p.color === "amber" ? "bg-amber-500" : p.color === "indigo" ? "bg-brand-500"
                    : p.color === "violet" ? "bg-purple-500" : p.color === "emerald" ? "bg-emerald-500" : "bg-slate-400",
                  extra: <span className="ml-1 text-muted">· {p.percent}%</span>,
                }))}
              />
            </Panel>
            <Panel title="Score distribution" hint="Overall AI score of every scored interview">
              <StepBars steps={derived.scoreBands} />
            </Panel>
          </div>

          <RecentCandidatesTable
            candidates={candidates}
            onOpenInvite={() => { onInviteCandidate(); }}
            onViewCandidateReport={onViewCandidateReport}
            onViewAll={onViewAllCandidates}
            onRefresh={load}
          />
        </div>

        <div className="space-y-6 xl:col-span-4">
          <Panel
            className="!h-auto"
            title="Waiting for your decision"
            hint="Finished AI interviews nobody has selected, rejected or parked yet"
            action={derived.waiting.length ? (
              <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-bold text-warning">{derived.waiting.length}</span>
            ) : undefined}
          >
            {loading ? <Skeleton className="h-40 w-full" /> : !derived.waiting.length ? (
              <EmptyState message="Nothing waiting — every finished interview has a decision." />
            ) : (
              <ul className="space-y-2">
                {derived.waiting.map(({ candidate, interview, score }) => (
                  <li key={`${candidate.id}-${interview.id}`}>
                    <button
                      type="button"
                      onClick={() => onViewCandidateReport(candidate.id, interview.id)}
                      className={`flex w-full items-center gap-3 rounded-card border border-subtle bg-surface-1 p-3 text-left transition-colors duration-micro hover:bg-surface-2 ${focusRing}`}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-purple-600 text-xs font-bold text-white">
                        {initials(candidate.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-primary">{candidate.name}</span>
                        <span className="block truncate text-xs text-muted">
                          {interview.templateTitle || candidate.role || "AI interview"} · {fmtDateLabel(interview.date)}
                        </span>
                      </span>
                      <span className={`text-lg font-bold tabular-nums ${scoreTone(score)}`}>{score}%</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {schedError ? <PanelError message={schedError} onRetry={() => void load()} /> : (
            <UpcomingInterviewCard schedules={schedules} onViewAll={onViewAllUpcoming} />
          )}
          <AIInsightsCard candidates={candidates} />
          {loadedAt ? (
            <p className="text-right text-[11px] text-muted">Updated {loadedAt.toLocaleTimeString("en-IN")}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
