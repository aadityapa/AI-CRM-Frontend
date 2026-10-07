/** Requirements workflow (Draft → approvals → sourcing) + Resume/ATS pipeline pages.
 *
 * Backend contract (routers/crm/requirements.py + resumes.py):
 *  - GET/POST /api/requirements, GET/PUT /api/requirements/{id}
 *  - POST /{id}/submit | /sales-head-approve | /sales-head-reject | /engineering-approve
 *         | /engineering-reject | /close | /cancel
 *  - GET/POST /{id}/job-postings, GET /{id}/activity-log
 *  - POST /api/requirements/{id}/resumes (multipart), GET …/resumes, POST …/resumes/scan-all
 *  - POST /api/resumes/{id}/ats-scan | /shortlist | /reject | /schedule-ai-interview
 * List `?status=` accepts a single status value; multi-status tabs fetch unfiltered
 * and filter client-side within the page.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity, AlertTriangle, Archive, ArrowLeft, Bot, Briefcase, Building2, CalendarClock, CalendarDays, CalendarPlus, Check, ClipboardCheck, ClipboardList, Copy, ExternalLink, FileText, FileUp, GraduationCap, Layers, Link2, Mail, MapPin, Megaphone, Pause, PauseCircle, Pencil, PlayCircle, Plus, RefreshCw, RotateCcw, ScanLine, Send, Sparkles, StepForward, Trash2, UserPlus, Users, UsersRound, Wallet, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { HERO_BTN_SOLID, PageHeader, StagePills } from "../components/PageHeader";
import { crmDelete, crmGet, crmPatch, crmPost, crmPut, crmUpload, qs } from "../api";
import { SearchableSelect } from "../components/SearchableSelect";
import { ScheduleManualRoundModal } from "../components/ScheduleManualRoundModal";
import { RmgVerdictHero, ScreeningDecisionModal, type ShortlistRoute } from "../components/ScreeningDecisionModal";
import { DirectToSalesButton, FastTrackButton, type InternalEmployee } from "../components/FastTrackToSales";
import { ResultsReviewBanner, type NewResult } from "../components/ResultsReviewBanner";
import { DialogActions } from "../components/dialogKit";
// ONE "Edit JD & skills" dialog (30 Sep 2026): the requirement page used to keep a
// stale private copy without the JD-file drop zone — the Screening Desk had it.
import { JdSkillsCard } from "../components/JdSkillsCard";
import {
  SalesHeadDecisionModal, SubmitForApprovalModal, type SalesHeadDecision,
} from "../components/OfferApprovalGate";
import { AiL1DecisionModal, ChooseAiL1Modal, GoManualModal, type AiL1Decision } from "../components/InterviewRouteChoice";
import { ScheduleAiInterviewModal, type RescheduleSeed } from "../components/ScheduleAiInterviewModal";
import { useAiTemplateGate } from "../components/AiTemplateGate";
import { useCanOpenAiReport } from "../components/AiInterviewOverview";
import { fetchAllMaster } from "../lib/fetchAllMaster";
import type { Meta } from "../api";
import { CrmLink, crmNavigate, useCrmParams } from "../routerHooks";
import { useHasRole, useMe } from "../CrmApp";
import { useCanAct, useCanApprove, useCrmAccess } from "../useAccess";
import { ApplyToOpportunityModal } from "../components/ApplyToOpportunityModal";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { TableCustomizerButton, useTableLayout } from "../components/TableCustomizer";
import { FileLink } from "../components/FileUpload";
import { BulkVerifyModal } from "../components/BulkVerifyModal";
import type { VerifyQueueItem } from "../components/BulkVerifyModal";
import { Timeline } from "../components/Timeline";
import type { ActivityEntry } from "../components/Timeline";
import {
  ConfirmModal, ErrorBox, Field, Modal, Spinner, StatusBadge,
  btnDanger, btnPrimary, btnSecondary, inputCls, statusLabel, useToast } from "../components/ui";
import {
  CandidateRoundStatus, CandidateStageBadge, CandidateStatusBadge, WaitingChip,
} from "../components/CandidateStatusBadge";
import { CANDIDATE_STAGE_BUCKETS, STAGE_TONE, bucketPhase } from "../lib/candidateStageBuckets";
import {
  ClosedNoteBox, OpeningMailChip, OverBudgetChip, SendOpeningMailButton, TaDecisionModal, TaFlowButtons,
  isClosedCandidacy, taDecisionsFor, type ClosedNote, type OpeningMail, type TaDecision,
} from "../components/TaDecision";
import { realEmail } from "../lib/candidateEmail";
import { FLOW_BTN, FLOW_DONE_CHIP, roundHasStarted } from "../components/flowButtons";
import { InterviewRoundsModal } from "../components/InterviewRoundsModal";
import { AtsBreakdownModal } from "../components/AtsBreakdownModal";
import { BulkActionBar } from "../components/BulkActionBar";
import { REQ_TERMINAL_STATUSES, dueChip, fmtRange } from "../lib/positionRows";
import { EditApplicantModal, UploadResumeModal } from "../components/UploadResumeModal";
import { useHandoverNote } from "../components/handoverNote";
import { SalesReadinessPanel } from "../components/SalesReadinessPanel";
import { roundResultTone, type CustomerSlotOffer } from "../lib/interviewRounds";
import { SalesSlotsButton } from "../components/CustomerSlots";
import type { CandidateStatus } from "../components/CandidateStatusBadge";
import { TeachingEmpty } from "../components/TeachingEmpty";
import { PositionsPanel, type PositionRequest } from "../components/PositionsPanel";
import { AssignTasButton, InlinePriority, PositionTeamPanel, PriorityPill, TaChip, type TaAssignment } from "../components/PositionTeamPanel";
// Same DB-scan component the opportunity page uses — one implementation, so
// TA and Sales always see identical matching logic (18 Aug 2026).
import { CollapsibleCard, SuggestedCandidatesTab } from "./Opportunities";
import { InterviewRoundModal } from "./Profiles";
import {
  SectionHeaderBanner, FieldLabel, WizardField, InfoChip, lockedInputCls,
} from "../components/wizard";
import { fmtDateShort, fmtDateTime12 } from "../../lib/datetime";
import { useChangeEffect, usePageTab, useSessionState } from "../lib/pageState";
import { useRefetchOnFocus } from "../lib/useRefetchOnFocus";

/** Local single-screen shell — applies the shared New Opportunity wizard look
 * (theme-aware body + SectionHeaderBanner) inside the existing Modal.
 * Visual-only wrapper: no field, state, or submit logic lives here. */
function WizFormShell({
  title, subtitle, icon, children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="crm-wizard wiz-noise min-h-full w-full bg-[color:var(--wiz-bg)] px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-3xl">
        <SectionHeaderBanner title={title} description={subtitle} icon={icon} />
        {children}
      </div>
    </div>
  );
}

/* Shared footer container for the reskinned single-screen dialogs. */
const wizFooterRow = "mt-6 flex items-center gap-3 border-t border-[color:var(--wiz-border)] pt-5";

/* ------------------------------------------------------------------ types */

type ReqSkill = { skill_id: number; name?: string; is_mandatory: boolean; min_rating: number | null };

type JdAttachment = {
  id: number;
  file_url: string;
  file_name: string | null;
  kind?: string | null;
};

/** Applicants on THIS opportunity — the same pipeline Sales/Admin see, shown
 * where TA sources (18 Aug 2026). Read-only list; stage moves stay on the
 * Candidate Profiles page, which owns the transition rules. */
/** RMG screening badge (25 Aug 2026): the gate that unlocks AI-L1 actions. */

function RmgScreeningBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-xs text-muted" title="Created before the RMG screening gate existed — not gated">—</span>;
  const cls = status === "Shortlisted"
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
    : status === "Rejected"
      ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
      : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  const title = status === "Shortlisted"
    ? "Shortlisted by RMG — proceed to the AI L1 interview"
    : status === "Rejected"
      ? "Rejected by RMG at screening"
      : "Awaiting RMG screening — AI L1 actions unlock when RMG shortlists";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`} title={title}>
      {status === "Shortlisted" ? "RMG Shortlisted" : status === "Rejected" ? "RMG Rejected" : "RMG Pending"}
    </span>
  );
}

function RequirementApplicantsTab({ oppId, toast }: { oppId: number; toast: ToastFn }) {
  /* Role IDENTITY, not tab access (fix 28 Aug 2026): with template authority,
     useCanAct alone made every templated user "RMG" here — TA saw the RMG
     Shortlist/Reject buttons. The role stays a role check; the template only
     gates whether the tab's edit actions render at all. */
  const rmgRole = useHasRole("RMG");
  const rmgCanEdit = useCanAct("requirements", "edit", rmgRole);
  const isRmg = rmgRole && rmgCanEdit;
  const taRole = useHasRole("TA");
  const taCanEdit = useCanAct("requirements", "edit", taRole);
  const isTA = taRole && taCanEdit;
  /* The Shortlist / Reject DECISION is an approval button (25 Sep 2026):
     `me.approvals` decides, exactly like the server's gate. */
  const canScreen = useCanApprove("profile.rmg_screening");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  /* Filters (25 Aug 2026): search by name/email, and "who submitted". A
     candidate deep link (`?q=`) pre-fills the search (29 Sep 2026). */
  const [q, setQ] = useState(() => deepLinkSearch());
  const [appliedBy, setAppliedBy] = useState("");
  /* RMG decide + TA reject-with-note modals. */
  const [decideRow, setDecideRow] = useState<{ row: any; kind: "rmg-shortlist" | "rmg-reject" | "ta-reject" } | null>(null);
  const [decideNote, setDecideNote] = useState("");
  const [decideErr, setDecideErr] = useState("");
  const [decideBusy, setDecideBusy] = useState(false);
  /* Delete an application outright (28 Aug 2026, user request) — for wrong
     uploads. The candidate master record and CV survive; only this profile
     (and its interview links/rounds) goes. */
  const [deleteRow, setDeleteRow] = useState<any | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  /* Bulk shortlist (25 Aug 2026): RMG ticks Pending rows and clears them in
   * one click. Rejects stay one-by-one — each needs its own note. */
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  /* ATS on the intake list (2 Sep 2026, user request): RMG wants the fit
     score BEFORE deciding Shortlist/Reject, and TA uploads now arrive scored.
     The scan endpoint resolves the requirement from the opportunity itself. */
  const [scanning, setScanning] = useState<Set<number>>(new Set());
  const scanRow = async (r: any) => {
    setScanning((p) => new Set(p).add(r.id));
    try {
      const res = await crmPost<any>(`/api/candidate-profiles/${r.id}/ats-scan`, {});
      toast(res.message || "ATS scan complete");
      const score = res.data?.ats_score ?? null;
      setRows((prev) => prev.map((x) => x.id === r.id
        ? { ...x, ats_score: score, ats_status: res.data?.ats_status ?? x.ats_status } : x));
    } catch (e: any) {
      toast(e?.message || "ATS scan failed", "err");
    } finally {
      setScanning((p) => { const n = new Set(p); n.delete(r.id); return n; });
    }
  };

  const bulkShortlist = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setBulkBusy(true);
    let ok = 0, fail = 0;
    for (const id of ids) {
      try {
        await crmPost(`/api/candidate-profiles/${id}/rmg-screening`, { decision: "Shortlisted" });
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    toast(`${ok} shortlisted${fail ? `, ${fail} failed` : ""} — TAs notified to proceed`, fail ? "err" : "ok");
    setSelected(new Set());
    setBulkBusy(false);
    load();
  };

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    crmGet<any[]>(`/api/candidate-profiles?opportunity_id=${oppId}&limit=100`)
      .then((r) => { if (alive) { setRows(r.data || []); setError(""); } })
      .catch((e: any) => { if (alive) setError(e?.message || "Failed to load applicants"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [oppId]);
  useEffect(() => load(), [load]);

  const taNames = [...new Set(rows.map((r) => r.ta_owner_name).filter(Boolean))].sort() as string[];
  const visible = rows.filter((r) => {
    if (appliedBy && (r.ta_owner_name || "") !== appliedBy) return false;
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return [r.candidate_name, r.email, r.phone]
      .some((v) => String(v || "").toLowerCase().includes(t));
  });

  const submitDecision = async () => {
    if (!decideRow) return;
    const { row, kind } = decideRow;
    const needsNote = kind !== "rmg-shortlist";
    if (needsNote && decideNote.trim().length < 5) {
      setDecideErr("A note of at least 5 characters is required");
      return;
    }
    setDecideBusy(true);
    try {
      if (kind === "ta-reject") {
        // Candidate not interested midway → pipeline Rejected with the note.
        const res = await crmPost(`/api/candidate-profiles/${row.id}/status-transition`, {
          new_status: "Rejected", comment: decideNote.trim(),
        });
        toast(res.message || "Candidate rejected");
      } else {
        const res = await crmPost(`/api/candidate-profiles/${row.id}/rmg-screening`, {
          decision: kind === "rmg-shortlist" ? "Shortlisted" : "Rejected",
          note: decideNote.trim() || undefined,
        });
        toast(res.message || "Screening decision recorded");
      }
      setDecideRow(null);
      load();
    } catch (e: any) {
      toast(e?.message || "Action failed", "err");
    } finally {
      setDecideBusy(false);
    }
  };

  const pendingVisible = visible.filter((r) => r.rmg_screening_status === "Pending");
  const cols: Column<any>[] = [
    ...(canScreen && pendingVisible.length > 0 ? [{
      key: "_select",
      label: "",
      render: (r: any) => r.rmg_screening_status === "Pending" ? (
        <input
          type="checkbox"
          className="h-4 w-4 cursor-pointer accent-brand-600"
          checked={selected.has(r.id)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
            return next;
          })}
          title="Select for bulk shortlist"
        />
      ) : null,
    } as Column<any>] : []),
    { key: "candidate_name", label: "Candidate",
      render: (r) => (
        <div>
          <div className="font-semibold text-primary">{r.candidate_name || "—"}</div>
          {r.email && <div className="text-xs text-muted">{r.email}</div>}
        </div>
      ) },
    { key: "pipeline_status", label: "Status",
      render: (r) => <CandidateStatusBadge status={r.candidate_status} stage={r.pipeline_status}
        withdrawnFrom={r.withdrawn_from_status} /> },
    { key: "rmg_screening_status", label: "RMG Screening",
      render: (r) => <RmgScreeningBadge status={r.rmg_screening_status} /> },
    { key: "ats_score", label: "ATS", align: "right",
      render: (r) => {
        if (r.ats_score == null) return <span className="text-muted">—</span>;
        const s = Math.round(Number(r.ats_score));
        const cls = s >= 70
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
          : s >= 40
            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300";
        return <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${cls}`}
          title="ATS match score against the requirement JD and skills">{s}</span>;
      } },
    { key: "experience_years", label: "Exp (yrs)", align: "right",
      render: (r) => (r.experience_years ?? "—") },
    { key: "ta_owner_name", label: "Applied by",
      render: (r) => (
        <span className="text-secondary">{r.ta_owner_name || r.created_by_name || "—"}</span>
      ) },
    { key: "applied_on", label: "Applied", align: "right", render: (r) => fmtDate(r.applied_on) },
  ];
  cols.push({
    key: "_actions", label: "", align: "right",
    render: (r) => {
      const gate = r.rmg_screening_status;
      const rejectedStages =["Rejected", "Sales_Rejected", "RMG_Rejected", "Customer_Rejected", "Self_Withdrawn"];
      return (
        <div className="flex flex-wrap justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          {(isRmg || isTA) && !rejectedStages.includes(r.pipeline_status) && (
            <button className={`${btnSecondary} !px-2.5 !py-1 text-xs`}
              disabled={scanning.has(r.id)}
              onClick={() => void scanRow(r)}
              title={r.ats_score == null
                ? "Score this candidate's CV against the requirement"
                : "Re-run the ATS scan"}>
              <ScanLine size={13} /> {scanning.has(r.id) ? "Scanning…" : r.ats_score == null ? "Run ATS" : "Re-scan"}
            </button>
          )}
          {canScreen && gate === "Pending" && (
            <>
              <button className={`${btnPrimary} !px-2.5 !py-1 text-xs`}
                onClick={() => { setDecideRow({ row: r, kind: "rmg-shortlist" }); setDecideNote(""); setDecideErr(""); }}
                title="Clear this candidate for the AI L1 interview">
                <Check size={13} /> Shortlist
              </button>
              <button className={`${btnDanger} !px-2.5 !py-1 text-xs`}
                onClick={() => { setDecideRow({ row: r, kind: "rmg-reject" }); setDecideNote(""); setDecideErr(""); }}>
                <X size={13} /> Reject
              </button>
            </>
          )}
          {/* No "Schedule L1" here (2 Sep 2026, user decision): this tab is
              the intake list — RMG screens, TA can drop a candidate. Every
              interview from the AI L1 on is scheduled from the Applied
              Candidates tab, and offering it in two places meant two
              buttons that could disagree about whether it was allowed. */}
          {isTA && !rejectedStages.includes(r.pipeline_status) && (
            <button className={`${btnSecondary} !px-2.5 !py-1 text-xs text-rose-600 dark:text-rose-300`}
              onClick={() => { setDecideRow({ row: r, kind: "ta-reject" }); setDecideNote(""); setDecideErr(""); }}
              title="Candidate not interested / dropped out — reject with a note">
              <X size={13} /> Reject
            </button>
          )}
          {isTA && (
            <button className={`${btnSecondary} !px-2.5 !py-1 text-xs text-rose-600 dark:text-rose-300`}
              onClick={() => setDeleteRow(r)}
              title="Delete this application entirely (wrong upload) — the candidate record and CV stay">
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>
      );
    },
  });
  return (
    <div className="rounded-card border border-subtle bg-surface-1 p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className={`${inputCls} !w-64`}
          placeholder="Search name, email, phone…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className={`${inputCls} !w-52`} value={appliedBy}
          onChange={(e) => setAppliedBy(e.target.value)}
          title="Filter by the TA who submitted the profile">
          <option value="">Applied by — anyone</option>
          {taNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {(q || appliedBy) && (
          <span className="text-xs text-muted">{visible.length} of {rows.length}</span>
        )}
        {canScreen && selected.size > 0 && (
          <button className={btnPrimary} disabled={bulkBusy} onClick={() => void bulkShortlist()}>
            <Check size={15} /> {bulkBusy ? "Shortlisting…" : `Shortlist selected (${selected.size})`}
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        Everyone submitted to this opportunity, whatever their screening state. Once RMG
        shortlists a candidate they also appear on the <b>Applied Candidates</b> tab, where
        every interview from AI L1 onwards is scheduled.
      </p>
      {error ? <ErrorBox error={error} /> : (
        <DataTable columns={cols} rows={visible} loading={loading}
          emptyMessage={rows.length === 0
            ? "Nobody has applied to this opportunity yet — check Suggested Candidates for people who already fit."
            : "No applicants match the current filters."}
          onRowClick={(r: any) => crmNavigate(`profiles/${r.id}`)} rowHref={(r: any) => `profiles/${r.id}`} />
      )}
      {deleteRow && (
        <ConfirmModal
          title="Delete this application?"
          message={<>Remove <b>{deleteRow.candidate_name || "this candidate"}</b> from this opportunity?
            The candidate master record and CV stay — only this application (its pipeline history,
            interview rounds and AI interview links) is deleted. This cannot be undone.</>}
          confirmLabel="Delete"
          danger
          busy={deleteBusy}
          onConfirm={async () => {
            setDeleteBusy(true);
            try {
              const res = await crmDelete(`/api/candidate-profiles/${deleteRow.id}`);
              toast(res.message || "Application deleted");
              setDeleteRow(null);
              load();
            } catch (e: any) {
              toast(e?.message || "Delete failed", "err");
            } finally {
              setDeleteBusy(false);
            }
          }}
          onClose={() => { if (!deleteBusy) setDeleteRow(null); }}
        />
      )}
      {decideRow && (
        <Modal
          title={decideRow.kind === "rmg-shortlist" ? "Shortlist for AI L1"
            : decideRow.kind === "rmg-reject" ? "Reject at RMG screening" : "Reject candidate"}
          onClose={() => { if (!decideBusy) setDecideRow(null); }}
        >
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              {decideRow.kind === "rmg-shortlist"
                ? <><b>{decideRow.row.candidate_name}</b> will be cleared for the AI L1 interview and the TA who applied them will be notified to proceed.</>
                : decideRow.kind === "rmg-reject"
                  ? <>Reject <b>{decideRow.row.candidate_name}</b> at RMG screening. The TA will be notified with your note.</>
                  : <>Reject <b>{decideRow.row.candidate_name}</b> — e.g. the candidate is no longer interested. The note goes on the activity log.</>}
            </p>
            <Field
              label={decideRow.kind === "rmg-shortlist" ? "Note (optional)" : "Reason"}
              required={decideRow.kind !== "rmg-shortlist"}
              error={decideErr}
            >
              <textarea
                className={`${inputCls}${decideErr ? " input-error" : ""}`}
                rows={3}
                value={decideNote}
                onChange={(e) => { setDecideNote(e.target.value); setDecideErr(""); }}
                placeholder={decideRow.kind === "ta-reject"
                  ? "Why is this candidate being rejected? (min 5 characters)"
                  : decideRow.kind === "rmg-reject"
                    ? "Why is this candidate not suitable? (min 5 characters)"
                    : "Anything the TA should know"}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button className={btnSecondary} onClick={() => setDecideRow(null)} disabled={decideBusy}>Cancel</button>
              <button
                className={decideRow.kind === "rmg-shortlist" ? btnPrimary : btnDanger}
                onClick={() => void submitDecision()}
                disabled={decideBusy}
              >
                {decideBusy ? "Working…"
                  : decideRow.kind === "rmg-shortlist" ? "Shortlist & notify TA"
                    : decideRow.kind === "rmg-reject" ? "Reject & notify TA" : "Reject candidate"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** ONE id from Sales to TA (18 Aug 2026): show the opportunity's id, never
 * REQ-xxxx. req_number stays the internal key, so nothing in the DB moved. */
const reqLabel = (r: { opportunity_opp_id?: string | null; req_number: string }) =>
  String(r.opportunity_opp_id || r.req_number);

type Req = {
  id: number;
  req_number: string;
  /** RMG hold (25 Aug 2026). */
  held_from_status?: string | null;
  held_reason?: string | null;
  job_postings_count?: number;
  /** The id every role tracks — the parent opportunity's (18 Aug 2026). */
  opportunity_opp_id?: string | null;
  /** The parent DEAL's stage, and the one status every role badges
   *  (22 Sep 2026) — see `display_status` in services/requirements.py. */
  opportunity_stage?: string | null;
  display_status?: string | null;
  opportunity_id: number;
  customer_id: number | null;
  /** Resolved by the list endpoint so the row stands alone (Aug 2026). */
  customer_name?: string | null;
  location_name?: string | null;
  title: string;
  description: string | null;
  rmg_jd_text?: string | null;
  ats_weights?: Record<string, number> | null;
  no_of_positions: number;
  experience_min: number | null;
  experience_max: number | null;
  budget_ctc_min: number | null;
  budget_ctc_max: number | null;
  work_mode: string | null;
  location_id: number | null;
  priority: string;
  target_closure_date: string | null;
  status: string;
  created_by: number;
  sales_head_approved_by: number | null;
  sales_head_approved_at: string | null;
  sales_head_rejection_reason: string | null;
  engineering_reviewed_by: number | null;
  engineering_reviewed_at: string | null;
  engineering_rejection_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
  skills: ReqSkill[];
  customer_jd_attachments?: JdAttachment[];
  rmg_jd_attachments?: JdAttachment[];
  /** TAs assigned to source it (1 Oct 2026, `components/PositionTeamPanel`). */
  assigned_tas?: TaAssignment[];
};

type ResumeRow = {
  /** Resume id — NEGATIVE on a profile-only row (an RMG-cleared candidate
   *  applied from the Candidates page, so there is no resume record and
   *  scheduling goes through `profile_id`, 28 Aug 2026). */
  id: number;
  is_profile_only?: boolean;
  requirement_id: number;
  candidate_id: number | null;
  /** Bulk upload held this row as a possible duplicate of this candidate. */
  possible_duplicate_of?: number | null;
  /** Manual Archive (30 Sep 2026): a closed candidacy RMG / GM may archive … */
  archivable?: boolean;
  /** … and one they already did (the Archive tab's rows — Restore brings it back). */
  archived?: boolean;
  /** TA who applied the candidate (from the linked profile). */
  applied_by?: string | null;
  /** RMG screening gate state of the linked profile (NULL = legacy/ungated). */
  rmg_screening_status?: "Pending" | "Shortlisted" | "Rejected" | null;
  candidate_name: string;
  email: string | null;
  phone: string | null;
  source_portal: string | null;
  applicant_experience?: string | null;
  application_details?: {
    education?: string | null;
    technical_domain?: string | null;
    skills?: string | null;
    notice_period?: string | null;
    current_ctc?: string | null;
    expected_ctc?: string | null;
    preferred_location?: string | null;
    /** Where the candidate lives today (29 Sep 2026 upload form). */
    current_location?: string | null;
    /** TA's note for RMG / GM, typed on the upload form. */
    note?: string | null;
  } | null;
  resume_file_url: string | null;
  received_date: string | null;
  ats_score: number | null;
  ats_score_breakdown: {
    skills_matched?: string[];
    skills_missing?: string[];
    jd_keywords_matched?: string[];
    jd_keywords_missing?: string[];
    experience_match?: boolean;
    jd_text_preview?: string;
    score_details?: Record<string, unknown>;
    ai_review?: {
      match_percent?: number;
      summary?: string;
      strengths?: string[];
      gaps?: string[];
      model?: string;
    } | null;
  } | null;
  ats_status: string;
  screened_by: number | null;
  ai_interview_status: string | null;
  ai_interview_scheduled_at: string | null;
  ai_overall_score_percent?: number | null;
  ai_interview_result?: string | null;
  /** Recruiter override from the interview report page; outranks the AI verdict. */
  ai_hr_decision?: string | null;
  ai_hr_decision_label?: string | null;
  ai_effective_result?: string | null;
  ai_is_overridden?: boolean;
  /** The AI L1 ran but no scored question was answered (7 Oct 2026) — "never happened", not "failed". */
  ai_not_attempted?: boolean;
  ai_report_link?: string | null;
  ai_interview_record_id?: string | null;
  profile_id?: number | null;
  profile_pipeline_status?: string | null;
  /** The derived candidate status every screen shows (server-side). */
  profile_status?: CandidateStatus | null;
  /** The Pre-Onboarding budget hold (3 Sep 2026) · TA's hold of an over-budget applicant (28 Sep 2026). */
  budget_status?: "Concern" | "Out_of_Budget" | "Resolved" | "TA_Hold" | null;
  /** Expected CTC (rupees) vs the position's budget max — server-derived. */
  expected_ctc?: number | null;
  budget_ctc_max?: number | null;
  over_budget?: boolean;
  /** Each round's date (the Status column prints the current one's). */
  l1_manual_when?: string | null;
  /** Who took each round (30 Sep 2026) — the Status cell says "with …". */
  l1_manual_interviewer?: string | null;
  l2_interviewer?: string | null;
  hr_interviewer?: string | null;
  cust_l1_interviewer?: string | null;
  cust_l2_interviewer?: string | null;
  /** Days since the last thing that happened to the candidacy (30 Sep 2026). */
  waiting_days?: number | null;
  waiting_since?: string | null;
  /** Who closed the candidacy and why (1 Oct 2026) — on closed rows only. */
  closed_note?: ClosedNote | null;
  /** The bulk upload's opening email and the candidate's answer (1 Oct 2026). */
  opening_mail?: OpeningMail | null;
  /** Screening Desk parity (7 Oct 2026): the server's reasons a direct / internal
   *  submission is unavailable, the employee this candidate IS, and finished
   *  interviews no screener has marked reviewed. */
  direct_to_sales_block?: string | null;
  internal_employee?: InternalEmployee | null;
  fast_track_block?: string | null;
  new_results?: NewResult[];
  /** Availability (1 Oct 2026): the application's notice period, else the
   *  candidate record's; resignation + last working day from the record. */
  notice_period?: string | null;
  resignation_status?: boolean;
  last_working_day?: string | null;
  l2_when?: string | null;
  hr_when?: string | null;
  l2_requested?: boolean;
  l2_scheduled?: boolean;
  l2_event_id?: number | null;
  l2_result?: string | null;
  /* The MANUAL L1 (1 Sep 2026): the human round RMG runs instead of the AI
     screen. Same four facts as the L2, so both render through one code path. */
  l1_manual_requested?: boolean;
  l1_manual_scheduled?: boolean;
  /** RMG / GM chose the AI L1 route — TA's "Schedule AI L1" (28 Sep 2026). */
  ai_l1_requested?: boolean;
  /** Interviews booked for this candidacy / how many carry a verdict (server tally). */
  rounds_booked?: number;
  rounds_done?: number;
  l1_manual_event_id?: number | null;
  l1_manual_result?: string | null;
  /* Rounds TA schedules from this row (2 Sep 2026): the HR round at HR
     Screening and the customer's own rounds. Same four facts as the L2. */
  hr_requested?: boolean;
  hr_scheduled?: boolean;
  hr_event_id?: number | null;
  hr_result?: string | null;
  cust_l1_scheduled?: boolean;
  cust_l1_result?: string | null;
  cust_l1_event_id?: number | null;
  cust_l1_when?: string | null;
  cust_l1_link?: boolean;
  cust_l2_scheduled?: boolean;
  cust_l2_result?: string | null;
  cust_l2_event_id?: number | null;
  cust_l2_when?: string | null;
  cust_l2_link?: boolean;
  /** The customer's slots Sales passed on with Customer Interviewing (29 Sep 2026). */
  customer_slots?: CustomerSlotOffer | null;
  /** Newest offer on the applied profile — the terms Sales Head approves. */
  latest_offer?: { ctc: number | null; joining_date: string | null;
                   offer_date: string | null; status: string } | null;
  ai_invite_token?: string | null;
  ai_invite_url?: string | null;
  ai_access_key?: string | null;
  created_at: string | null;
};

/** localStorage key of the bulk upload's "Email each candidate" choice. */
const ZIP_OPENING_MAIL_KEY = "crm.zip.openingMail";

/** What TA confirms from the candidate's reply before an Interested candidate
 *  goes for Technical Screening (1 Oct 2026) — the same facts the opening
 *  email asked for. A blank shows "Not captured" in the dialog. */
function confirmDetailsFor(r: ResumeRow) {
  const d = r.application_details || {};
  const exp = String(r.applicant_experience ?? "").trim();
  return [
    { label: "Email", value: realEmail(r.email) },
    { label: "Phone", value: r.phone },
    { label: "Experience", value: exp && /^\d+(\.\d+)?$/.test(exp) ? `${exp} yrs` : exp },
    { label: "Current CTC", value: d.current_ctc },
    { label: "Expected CTC", value: d.expected_ctc },
    { label: "Notice period", value: r.notice_period || d.notice_period },
    { label: "Current location", value: d.current_location },
    { label: "Preferred location", value: d.preferred_location },
  ];
}

/** Can a fresh AI L1 link go out over this row's latest AI L1 (7 Oct 2026)?
 *  Only once it has FINISHED without a pass — not attempted, failed, or a
 *  recruiter's hold; never while it is still to run (reschedule the pending
 *  one instead) and never over a pass. PURE — mirrors the server's refusal. */
export function reschedulableAi(r: Pick<ResumeRow,
  "ai_interview_status" | "ai_overall_score_percent" | "ai_effective_result" | "ai_interview_result">): boolean {
  const finished = r.ai_overall_score_percent != null
    || (!!r.ai_interview_status && !["Scheduled", "Pending", "In_Progress", "Not_Scheduled"].includes(r.ai_interview_status));
  if (!finished) return false;
  const effective = r.ai_effective_result || r.ai_interview_result || "";
  return !["Passed", "Selected"].includes(effective);
}

/** The previous outcome the reschedule dialog prints. PURE. */
export function rescheduleSeed(r: Pick<ResumeRow,
  "ai_not_attempted" | "ai_effective_result" | "ai_interview_result" | "ai_overall_score_percent">): RescheduleSeed {
  if (r.ai_not_attempted && !["On Hold", "Pending Review"].includes(r.ai_effective_result || "")) {
    return { previous: "Not attempted", notAttempted: true };
  }
  const effective = r.ai_effective_result || r.ai_interview_result || "Finished";
  const score = r.ai_overall_score_percent;
  return { previous: score != null ? `${effective} (${Number(score) % 1 === 0 ? Number(score) : Number(score).toFixed(1)}%)` : effective };
}

type JobPosting = {
  id: number;
  requirement_id: number;
  portal_name: string;
  job_post_url: string;
  posted_by: number | null;
  posted_at: string | null;
  status: string | null;
};

type Slot = {
  id: number;
  slot_at: string;
  capacity: number;
  booked_count: number;
  created_at: string;
};

type Booking = {
  id: number;
  token: string;
  resume_id: number;
  candidate_name: string;
  status: string; // Pending | Confirmed | Expired | Cancelled
  slot_at?: string | null;
  invite_url?: string | null;
  created_at: string;
  confirmed_at?: string | null;
};

type ToastFn = (msg: string, kind?: "ok" | "err") => void;

/* -------------------------------------------------------------- constants */

const EDITABLE_STATUSES = ["Draft", "Sales_Head_Rejected", "Engineering_Rejected"];
const TERMINAL_STATUSES = REQ_TERMINAL_STATUSES;
const SOURCING_STATUSES = ["Open_For_Sourcing", "Posted_On_Portals", "In_Progress"];
/**
 * TA's status filter. Closed / Cancelled were added 22 Sep 2026 with the
 * opportunity-stage cascade: closing a deal now moves its requirement out of
 * TA's default queue, so "where did it go?" has to be answerable. The server
 * mirrors this split — `TA_LIVE_STATUSES` by default, `TA_ARCHIVE_STATUSES`
 * only when one is named explicitly (services/requirements.py).
 */
const TA_FILTER_STATUSES = [
  "Open_For_Sourcing", "Posted_On_Portals", "In_Progress", "On_Hold", "Fulfilled",
  "Closed", "Cancelled",
];
/** Every requirement status, for the All-tab filter (RMG / Sales_Head). */
const ALL_REQ_STATUSES = [
  "Draft", "Pending_Sales_Head_Approval", "Sales_Head_Rejected",
  "Pending_Engineering_Review", "Engineering_Rejected", "Open_For_Sourcing",
  "Posted_On_Portals", "In_Progress", "On_Hold", "Fulfilled", "Closed", "Cancelled",
];
const WORK_MODES = ["Remote", "Onsite", "Hybrid"];
const PRIORITIES = ["High", "Medium", "Low"];
const JOB_PORTALS = ["Naukri", "LinkedIn", "Indeed", "Other"];

/* Row buttons share ONE palette (28 Sep 2026) — `components/flowButtons.ts`. */
const smallBtn = FLOW_BTN.neutral;
const smallPrimary = FLOW_BTN.primary;
const smallSuccess = FLOW_BTN.success;
const smallDanger = FLOW_BTN.danger;
/* Token focus ring (tokens.css) — applied to every NEW interactive element on this page. */
const focusRing = "focus-visible:outline-none focus-visible:shadow-focus-ring";

/* ---------------------------------------------------------------- helpers */

/** Notice period · last working day (1 Oct 2026, user ask: "under
 *  Opportunities show notice period / last working day"). A last day that
 *  has passed reads "Available"; one still ahead says how far away it is. */
function AvailabilityCell({ row }: { row: ResumeRow }) {
  const notice = (row.notice_period || "").trim();
  const last = row.last_working_day ? new Date(row.last_working_day) : null;
  if (!notice && !last && !row.resignation_status) return <span className="text-muted">—</span>;
  const days = last ? Math.ceil((last.getTime() - Date.now()) / 86_400_000) : null;
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      {notice && <span className="font-semibold text-primary">Notice {notice}</span>}
      {last ? (
        <span className={days != null && days <= 0 ? "text-success" : days != null && days <= 30 ? "text-warning" : "text-secondary"}
              title={`Last working day ${fmtDateShort(row.last_working_day)}`}>
          LWD {fmtDateShort(row.last_working_day)}
          {days != null && (days <= 0 ? " · available" : ` · in ${days} d`)}
        </span>
      ) : row.resignation_status ? (
        <span className="text-secondary">Resigned · LWD not set</span>
      ) : null}
    </div>
  );
}

function fmtDate(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function fmtDateTime(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : fmtDateTime12(d);
}

function useDebounced(value: string, ms = 350): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** customer_id → name map (customers list is readable by any CRM role). */
function useCustomerNames(): Record<number, string> {
  const [map, setMap] = useState<Record<number, string>>({});
  useEffect(() => {
    crmGet<any[]>("/api/customers/names")
      .then((r) => {
        const m: Record<number, string> = {};
        (r.data || []).forEach((c: any) => { m[c.id] = c.name; });
        setMap(m);
      })
      .catch(() => { /* non-blocking */ });
  }, []);
  return map;
}

/* ------------------------------------------------- approve / reject modal */

// ATS score component weights (points). Defaults match the backend scorer; RMG
// may override any subset per requirement (e.g. an experience-heavy role).
const ATS_WEIGHT_FIELDS: { key: string; label: string; def: number }[] = [
  { key: "mandatory", label: "Mandatory skills", def: 50 },
  { key: "optional", label: "Optional skills", def: 20 },
  { key: "experience", label: "Experience", def: 15 },
  { key: "education", label: "Education", def: 10 },
  { key: "location", label: "Location", def: 5 },
  { key: "jd", label: "JD keywords", def: 20 },
];

function DecisionModal({
  req, stage, kind, onClose, onDone, toast,
}: {
  req: Req;
  stage: "sales-head" | "engineering";
  kind: "approve" | "reject";
  onClose: () => void;
  onDone: (updated: Req) => void;
  toast: ToastFn;
}) {
  const [text, setText] = useState("");
  const [rmgJdText, setRmgJdText] = useState(req.rmg_jd_text || "");
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [customerJd, setCustomerJd] = useState<JdAttachment[]>(req.customer_jd_attachments || []);
  const [existingRmgJd, setExistingRmgJd] = useState<JdAttachment[]>(req.rmg_jd_attachments || []);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const stageLabel = stage === "sales-head" ? "Sales Head" : "RMG Review";
  const needsRmgJd = stage === "engineering" && kind === "approve";
  // Skill Evaluation Details — RMG sets/edits these at the Engineering Review
  // stage (they are copied from the opportunity but owned by RMG here).
  const [skillOpts, setSkillOpts] = useState<any[]>([]);
  const [skillRows, setSkillRows] = useState<SkillRow[]>(
    (req.skills || []).map((s) => ({
      skill_id: String(s.skill_id),
      is_mandatory: s.is_mandatory,
      min_rating: s.min_rating != null ? String(s.min_rating) : "",
    })),
  );
  /** Skill catalogue as SearchableSelect options (value = id, label = name). */
  const skillSelectOptions = useMemo(
    () => skillOpts.map((s) => ({
      value: String(s.id),
      label: `${s.name}${s.category ? ` (${s.category})` : ""}`,
    })),
    [skillOpts],
  );
  const updateSkillRow = (i: number, patch: Partial<SkillRow>) =>
    setSkillRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  // ATS weights (optional): blank input = use the default for that component.
  const [atsWeights, setAtsWeights] = useState<Record<string, string>>(() => {
    const src = (req.ats_weights || {}) as Record<string, number>;
    const out: Record<string, string> = {};
    for (const f of ATS_WEIGHT_FIELDS) out[f.key] = src[f.key] != null ? String(src[f.key]) : "";
    return out;
  });

  // Create a brand-new skill inline when it isn't in the catalog, then select it
  // on this row. Backend allows RMG to POST /api/skills.
  const createSkillForRow = async (rowIndex: number, typed?: string) => {
    const name = (typed ?? window.prompt("New skill name") ?? "").trim();
    if (!name) return;
    const dup = skillOpts.find((o) => String(o.name).toLowerCase() === name.toLowerCase());
    if (dup) { updateSkillRow(rowIndex, { skill_id: String(dup.id) }); return; }
    try {
      const res = await crmPost<any>("/api/skills", { name });
      const created = res.data;
      if (created?.id != null) {
        setSkillOpts((opts) => (
          opts.some((o) => o.id === created.id)
            ? opts
            : [...opts, created].sort((a, b) => String(a.name).localeCompare(String(b.name)))
        ));
        updateSkillRow(rowIndex, { skill_id: String(created.id) });
        toast(`Skill "${created.name}" added`);
      }
    } catch (e: any) {
      toast(e?.message || "Failed to create skill", "err");
    }
  };

  useEffect(() => {
    if (!needsRmgJd) return;
    let cancelled = false;
    // Page through: the server clamps limit to 100, so one request truncated the list.
    fetchAllMaster<any>("/api/skills").then((rows) => { if (!cancelled) setSkillOpts(rows); }).catch(() => {});
    crmGet<Req>(`/api/requirements/${req.id}`)
      .then((r) => {
        if (cancelled || !r.data) return;
        setCustomerJd(r.data.customer_jd_attachments || []);
        setExistingRmgJd(r.data.rmg_jd_attachments || []);
        if (r.data.rmg_jd_text) setRmgJdText(r.data.rmg_jd_text);
        if (Array.isArray(r.data.skills)) {
          setSkillRows(r.data.skills.map((s) => ({
            skill_id: String(s.skill_id),
            is_mandatory: s.is_mandatory,
            min_rating: s.min_rating != null ? String(s.min_rating) : "",
          })));
        }
      })
      .catch(() => { /* keep whatever we already have */ });
    return () => { cancelled = true; };
  }, [needsRmgJd, req.id]);

  const submit = async () => {
    if (kind === "reject" && text.trim().length < 10) {
      setErr("Rejection reason is mandatory (minimum 10 characters)");
      return;
    }
    if (needsRmgJd) {
      const hasText = rmgJdText.trim().length > 0;
      const hasFile = !!jdFile || existingRmgJd.length > 0;
      if (!hasText && !hasFile) {
        setErr("Add a JD (text or file) before approving");
        return;
      }
      if (skillRows.some((r) => !r.skill_id)) {
        setErr("Every skill row needs a skill selected (or remove the empty row)");
        return;
      }
      // Skills are as mandatory as the JD: TA sources against them and the ATS
      // score is built on them (mandatory skills alone carry 50 of 100 points).
      if (skillRows.filter((r) => r.skill_id).length === 0) {
        setErr("Add at least one skill in Skill Evaluation Details before approving");
        return;
      }
      const ids = skillRows.map((r) => r.skill_id);
      if (new Set(ids).size !== ids.length) {
        setErr("Duplicate skills are not allowed");
        return;
      }
    }
    setBusy(true);
    try {
      if (needsRmgJd && jdFile) {
        await crmUpload(`/api/requirements/${req.id}/attachments`, jdFile, { kind: "rmg_jd" });
      }
      let body: Record<string, unknown> | undefined;
      if (kind === "reject") {
        body = { reason: text.trim() };
      } else if (needsRmgJd) {
        // Build ATS weights from any overridden (non-blank) fields; blank = default.
        const weights: Record<string, number> = {};
        for (const f of ATS_WEIGHT_FIELDS) {
          const raw = (atsWeights[f.key] || "").trim();
          if (raw !== "" && Number.isFinite(Number(raw)) && Number(raw) >= 0) {
            weights[f.key] = Number(raw);
          }
        }
        body = {
          ...(text.trim() ? { comment: text.trim() } : {}),
          rmg_jd_text: rmgJdText.trim(),
          skills: skillRows.map((r) => ({
            skill_id: Number(r.skill_id),
            is_mandatory: r.is_mandatory,
            min_rating: r.min_rating ? Number(r.min_rating) : null,
          })),
          ats_weights: Object.keys(weights).length ? weights : null,
        };
      } else if (text.trim()) {
        body = { comment: text.trim() };
      }
      const res = await crmPost<Req>(`/api/requirements/${req.id}/${stage}-${kind}`, body);
      toast(res.message || (kind === "approve" ? "Approved" : "Rejected"));
      onDone(res.data);
      onClose();
    } catch (e: any) {
      toast(e?.message || "Action failed", "err");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={<span className="sr-only">{`${kind === "approve" ? "Approve" : "Reject"} ${reqLabel(req)} — ${stageLabel}`}</span>}
      onClose={onClose}
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title={`${kind === "approve" ? "Approve" : "Reject"} ${reqLabel(req)}`}
        subtitle={kind === "approve"
          ? `Approve this requirement at the ${stageLabel} stage.`
          : `Reject this requirement at the ${stageLabel} stage — a reason is required.`}
        icon={<ClipboardCheck size={20} aria-hidden />}
      >
        <div className="space-y-5">
          <div className="text-sm text-secondary">
            {kind === "approve"
              ? <>Approve <span className="font-semibold">“{req.title}”</span>? You may add an optional comment for the activity log.</>
              : <>Reject <span className="font-semibold">“{req.title}”</span>. A reason of at least 10 characters is required; the creator will be notified.</>}
          </div>
          {needsRmgJd && (
            <div className="space-y-4 rounded-xl border border-subtle bg-surface-2 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-muted">Customer JD (reference)</div>
              {customerJd.length === 0 ? (
                <p className="text-sm text-muted">No customer JD uploaded on the opportunity.</p>
              ) : (
                <ul className="space-y-1">
                  {customerJd.map((a) => (
                    <li key={a.id}><FileLink url={a.file_url} label={a.file_name || "Customer JD"} /></li>
                  ))}
                </ul>
              )}
              <WizardField label="RMG JD (text)" required={!jdFile && existingRmgJd.length === 0} error={err && !rmgJdText.trim() && !jdFile && !existingRmgJd.length ? err : ""}>
                <textarea
                  className={inputCls}
                  rows={6}
                  value={rmgJdText}
                  onChange={(e) => { setRmgJdText(e.target.value); if (err) setErr(""); }}
                  placeholder="Paste or type the job description TA will use for ATS scoring…"
                />
              </WizardField>
              <WizardField label="RMG JD (PDF / Word)" icon={<FileUp size={15} className="text-[color:var(--wiz-muted)]" aria-hidden />}>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx"
                  className="block w-full text-sm"
                  onChange={(e) => { setJdFile(e.target.files?.[0] || null); if (err) setErr(""); }}
                />
                {jdFile && <p className="mt-1 text-xs text-muted">{jdFile.name}</p>}
                {existingRmgJd.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {existingRmgJd.map((a) => (
                      <li key={a.id} className="text-sm"><FileLink url={a.file_url} label={a.file_name || "RMG JD"} /></li>
                    ))}
                  </ul>
                )}
              </WizardField>
              {err && <p className="text-sm text-danger">{err}</p>}
            </div>
          )}
          {needsRmgJd && (
            <div className="space-y-3 rounded-xl border border-subtle bg-surface-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-bold uppercase tracking-wide text-muted">Skill Evaluation Details</div>
                <button
                  type="button"
                  className={`${btnSecondary} h-8 rounded-lg px-3 text-xs`}
                  onClick={() => setSkillRows((rs) => [...rs, { skill_id: "", is_mandatory: false, min_rating: "" }])}
                >
                  <Plus size={14} /> Add skill
                </button>
              </div>
              <p className="text-xs text-muted">Mandatory skills drive the ATS score (50 of 100 points). Set the required level per skill.</p>
              {skillRows.length === 0 ? (
                <>
                  <p className="text-sm text-muted">No skills yet — add the skills TA should source against.</p>
                  {kind === "approve" && (
                    <p className="mt-1 text-sm text-danger">Add at least one skill before approving</p>
                  )}
                </>
              ) : (
                <div className="space-y-2">
                  {skillRows.map((r, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      {/* Searchable, and any skill not in the catalogue can be typed
                          and added here — it is saved to the skills master so it is
                          available on every future requirement. */}
                      <div className="w-56">
                        <SearchableSelect
                          value={r.skill_id}
                          options={skillSelectOptions}
                          allowAdd
                          searchable
                          addLabel="Add new skill"
                          placeholder="Search or add a skill…"
                          onChange={(v) => updateSkillRow(i, { skill_id: v })}
                          onOptionsChange={(next) => {
                            const known = new Set(skillSelectOptions.map((o) => o.label.toLowerCase()));
                            for (const o of next) {
                              if (!known.has(o.label.toLowerCase())) void createSkillForRow(i, o.label);
                            }
                          }}
                        />
                      </div>
                      <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-secondary">
                        <input
                          type="checkbox"
                          checked={r.is_mandatory}
                          onChange={(e) => updateSkillRow(i, { is_mandatory: e.target.checked })}
                          className="h-4 w-4 rounded border-strong"
                        />
                        Mandatory
                      </label>
                      <select
                        className={`${inputCls} !w-32`}
                        value={r.min_rating}
                        onChange={(e) => updateSkillRow(i, { min_rating: e.target.value })}
                      >
                        <option value="">Required level —</option>
                        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}
                      </select>
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-muted hover:bg-danger-soft hover:text-danger"
                        onClick={() => setSkillRows((rs) => rs.filter((_, idx) => idx !== i))}
                        aria-label="Remove skill"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {needsRmgJd && (
            <div className="space-y-3 rounded-xl border border-subtle bg-surface-2 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-muted">ATS Score Weights (optional)</div>
              <p className="text-xs text-muted">
                Points each component contributes to the ATS score. Leave blank to use the default.
                Only components actually configured on this requirement are counted.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {ATS_WEIGHT_FIELDS.map((f) => (
                  <label key={f.key} className="block">
                    <span className="mb-1 block text-xs font-semibold text-secondary">{f.label}</span>
                    <input
                      type="number"
                      min={0}
                      className={inputCls}
                      value={atsWeights[f.key] ?? ""}
                      placeholder={`Default ${f.def}`}
                      onChange={(e) => setAtsWeights((w) => ({ ...w, [f.key]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
          <WizardField
            label={kind === "approve" ? "Comment (optional)" : "Rejection reason"}
            required={kind === "reject"}
            error={kind === "reject" ? err : ""}
          >
            <textarea
              className={inputCls}
              rows={3}
              value={text}
              onChange={(e) => { setText(e.target.value); if (err) setErr(""); }}
              placeholder={kind === "reject" ? "Why is this requirement being rejected?" : "Optional comment…"}
            />
          </WizardField>
          <div className={wizFooterRow}>
            <button className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
            <button className={`${kind === "reject" ? btnDanger : btnPrimary} ml-auto h-10 rounded-xl px-4`} onClick={submit} disabled={busy}>
              {busy ? "Working…" : kind === "approve" ? <><Check size={15} /> Approve</> : <><X size={15} /> Reject</>}
            </button>
          </div>
        </div>
      </WizFormShell>
    </Modal>
  );
}

/* ------------------------------------------------- create / edit modal */

type FormState = {
  opportunity_id: string;
  title: string;
  description: string;
  no_of_positions: string;
  experience_min: string;
  experience_max: string;
  budget_ctc_min: string;
  budget_ctc_max: string;
  work_mode: string;
  location_id: string;
  priority: string;
  target_closure_date: string;
};

type SkillRow = { skill_id: string; is_mandatory: boolean; min_rating: string };

/** "Forgot the JD / skills" fix-up (15 Sep 2026): RMG, Sales, Sales Head and
 *  Admin/CEO can fill or correct the description, RMG JD and the skill list at
 *  any open status via `PATCH /api/requirements/{id}/jd-skills`. Deliberately
 *  narrow — the full edit form stays creator-only and Draft/Rejected-only. */
/** RMG's second queue: headcount changes waiting on a decision, across every
 *  requirement. Shown above the Engineering Review Queue so RMG has one page
 *  for "what needs me" (21 Sep 2026). Deciding happens on the requirement, so
 *  each row links there rather than duplicating the approve/reject buttons. */
function PendingPositionChangesPanel() {
  const [rows, setRows] = useState<(PositionRequest & {
    requirement_label?: string; requirement_title?: string; customer_name?: string | null;
    positions_joined?: number;
  })[]>([]);

  useEffect(() => {
    let alive = true;
    crmGet<any[]>("/api/requirements/position-requests/pending")
      .then((res) => { if (alive) setRows(res.data || []); })
      .catch(() => { /* the queue is additive — never block the list on it */ });
    return () => { alive = false; };
  }, []);

  if (rows.length === 0) return null;
  return (
    <div className="rounded-card border border-amber-300/60 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30">
      <div className="px-4 py-2.5 text-sm font-bold text-amber-900 dark:text-amber-200">
        <AlertTriangle size={14} className="mr-1 inline" />
        Position changes awaiting you ({rows.length})
      </div>
      <ul className="divide-y divide-amber-200/70 dark:divide-amber-800/50">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
            <div className="min-w-0">
              <CrmLink to={`requirements/${r.requirement_id}`} className="font-semibold text-primary hover:underline">
                {r.requirement_label || `#${r.requirement_id}`} — {r.requirement_title}
              </CrmLink>
              <span className="ml-2 text-muted">
                {r.customer_name ? `${r.customer_name} · ` : ""}
                {r.requested_by_name || "Sales"} asks {r.from_positions} → <strong className="text-primary">{r.to_positions}</strong>
                {r.positions_joined ? ` · ${r.positions_joined} joined` : ""}
              </span>
              <div className="truncate text-xs text-secondary">{r.reason}</div>
            </div>
            <CrmLink to={`requirements/${r.requirement_id}`} className={`${btnSecondary} !py-1.5 shrink-0 text-xs`}>
              Review
            </CrmLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RequirementFormModal({
  initial, onClose, onSaved, toast,
}: {
  initial: Req | null;
  onClose: () => void;
  onSaved: (r: Req) => void;
  toast: ToastFn;
}) {
  const editing = !!initial;
  const [opps, setOpps] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [skills, setSkills] = useState<any[]>([]);
  const [form, setForm] = useState<FormState>({
    opportunity_id: initial ? String(initial.opportunity_id) : "",
    title: initial?.title || "",
    description: initial?.description || "",
    no_of_positions: String(initial?.no_of_positions ?? 1),
    experience_min: initial?.experience_min != null ? String(initial.experience_min) : "",
    experience_max: initial?.experience_max != null ? String(initial.experience_max) : "",
    budget_ctc_min: initial?.budget_ctc_min != null ? String(initial.budget_ctc_min) : "",
    budget_ctc_max: initial?.budget_ctc_max != null ? String(initial.budget_ctc_max) : "",
    work_mode: initial?.work_mode || "",
    location_id: initial?.location_id != null ? String(initial.location_id) : "",
    priority: initial?.priority || "Medium",
    target_closure_date: initial?.target_closure_date || "",
  });
  const [rows, setRows] = useState<SkillRow[]>(
    (initial?.skills || []).map((s) => ({
      skill_id: String(s.skill_id),
      is_mandatory: s.is_mandatory,
      min_rating: s.min_rating != null ? String(s.min_rating) : "",
    })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    crmGet<any[]>("/api/opportunities?limit=100").then((r) => setOpps(r.data || [])).catch(() => {});
    crmGet<any[]>("/api/locations?limit=200").then((r) => setLocations(r.data || [])).catch(() => {});
    fetchAllMaster<any>("/api/skills").then(setSkills).catch(() => {});
  }, []);

  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!editing && !form.opportunity_id) e.opportunity_id = "Opportunity is required";
    if (!form.title.trim()) e.title = "Title is required";
    const positions = Number(form.no_of_positions);
    if (form.no_of_positions.trim() === "" || !Number.isInteger(positions) || positions < 1) {
      e.no_of_positions = "Must be a whole number of at least 1";
    }
    (["experience_min", "experience_max", "budget_ctc_min", "budget_ctc_max"] as const).forEach((k) => {
      const v = form[k];
      if (v.trim() !== "" && (isNaN(Number(v)) || Number(v) < 0)) e[k] = "Must be a number ≥ 0";
    });
    const emin = numOrNull(form.experience_min);
    const emax = numOrNull(form.experience_max);
    if (!e.experience_max && emin != null && emax != null && emin > emax) e.experience_max = "Max must be ≥ min";
    const bmin = numOrNull(form.budget_ctc_min);
    const bmax = numOrNull(form.budget_ctc_max);
    if (!e.budget_ctc_max && bmin != null && bmax != null && bmin > bmax) e.budget_ctc_max = "Max must be ≥ min";
    if (rows.some((r) => !r.skill_id)) {
      e.skills = "Every skill row needs a skill selected";
    } else {
      const ids = rows.map((r) => r.skill_id);
      if (new Set(ids).size !== ids.length) e.skills = "Duplicate skills are not allowed";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setBusy(true);
    const payload: any = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      no_of_positions: Number(form.no_of_positions),
      experience_min: numOrNull(form.experience_min),
      experience_max: numOrNull(form.experience_max),
      budget_ctc_min: numOrNull(form.budget_ctc_min),
      budget_ctc_max: numOrNull(form.budget_ctc_max),
      work_mode: form.work_mode || null,
      location_id: form.location_id ? Number(form.location_id) : null,
      priority: form.priority,
      target_closure_date: form.target_closure_date || null,
      skills: rows.map((r) => ({
        skill_id: Number(r.skill_id),
        is_mandatory: r.is_mandatory,
        min_rating: r.min_rating ? Number(r.min_rating) : null,
      })),
    };
    try {
      const res = editing
        ? await crmPut<Req>(`/api/requirements/${initial!.id}`, payload)
        : await crmPost<Req>("/api/requirements", { ...payload, opportunity_id: Number(form.opportunity_id) });
      toast(res.message || (editing ? "Requirement updated" : "Requirement created"));
      onSaved(res.data);
      onClose();
    } catch (e: any) {
      toast(e?.message || "Save failed", "err");
      setBusy(false);
    }
  };

  const updateRow = (i: number, patch: Partial<SkillRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <Modal
      title={<span className="sr-only">{editing ? `Edit ${reqLabel(initial!)}` : "New Requirement"}</span>}
      onClose={onClose}
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title={editing ? `Edit ${reqLabel(initial!)}` : "New Requirement"}
        subtitle="Capture the role, experience band, budget, and required skills for this hiring requirement."
        icon={<ClipboardList size={20} aria-hidden />}
      >
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
        {!editing && (
          <WizardField className="sm:col-span-2" label="Opportunity" required error={errors.opportunity_id} icon="building">
            <select className={inputCls} value={form.opportunity_id} onChange={(e) => set("opportunity_id", e.target.value)}>
              <option value="">Select an opportunity…</option>
              {opps.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.opp_id} — {o.title}{o.customer_name ? ` (${o.customer_name})` : ""}
                </option>
              ))}
            </select>
          </WizardField>
        )}
        <WizardField className="sm:col-span-2" label="Title" required error={errors.title} filled={!!form.title.trim() && !errors.title}>
          <input className={inputCls} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Senior Java Developer" />
        </WizardField>
        <WizardField className="sm:col-span-2" label="Description">
          <textarea className={inputCls} rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </WizardField>
        <WizardField label="No. of positions" required error={errors.no_of_positions} icon="hash" filled={form.no_of_positions.trim() !== "" && !errors.no_of_positions}>
          <input className={inputCls} type="number" min={1} value={form.no_of_positions} onChange={(e) => set("no_of_positions", e.target.value)} />
        </WizardField>
        <WizardField label="Priority">
          <select className={inputCls} value={form.priority} onChange={(e) => set("priority", e.target.value)}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </WizardField>
        <WizardField label="Experience min (yrs)" error={errors.experience_min} icon="hash" filled={form.experience_min.trim() !== "" && !errors.experience_min}>
          <input className={inputCls} type="number" min={0} step="0.5" value={form.experience_min} onChange={(e) => set("experience_min", e.target.value)} />
        </WizardField>
        <WizardField label="Experience max (yrs)" error={errors.experience_max} icon="hash" filled={form.experience_max.trim() !== "" && !errors.experience_max}>
          <input className={inputCls} type="number" min={0} step="0.5" value={form.experience_max} onChange={(e) => set("experience_max", e.target.value)} />
        </WizardField>
        <WizardField label="Budget CTC min" error={errors.budget_ctc_min} icon="hash" filled={form.budget_ctc_min.trim() !== "" && !errors.budget_ctc_min}>
          <input className={inputCls} type="number" min={0} value={form.budget_ctc_min} onChange={(e) => set("budget_ctc_min", e.target.value)} />
        </WizardField>
        <WizardField label="Budget CTC max" error={errors.budget_ctc_max} icon="hash" filled={form.budget_ctc_max.trim() !== "" && !errors.budget_ctc_max}>
          <input className={inputCls} type="number" min={0} value={form.budget_ctc_max} onChange={(e) => set("budget_ctc_max", e.target.value)} />
        </WizardField>
        <WizardField label="Work mode">
          <select className={inputCls} value={form.work_mode} onChange={(e) => set("work_mode", e.target.value)}>
            <option value="">—</option>
            {WORK_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </WizardField>
        <WizardField label="Location" icon="map">
          <select className={inputCls} value={form.location_id} onChange={(e) => set("location_id", e.target.value)}>
            <option value="">—</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.city}{l.state ? `, ${l.state}` : ""} ({l.country})</option>
            ))}
          </select>
        </WizardField>
        <WizardField label="Target closure date" icon="calendar" filled={!!form.target_closure_date}>
          <input className={inputCls} type="date" value={form.target_closure_date} onChange={(e) => set("target_closure_date", e.target.value)} />
        </WizardField>
      </div>

      {/* skills editor */}
      <div className="mt-6">
        <div className="mb-1.5 flex items-center justify-between">
          <FieldLabel label="Skills" />
          <button
            type="button"
            className={smallBtn}
            onClick={() => setRows((rs) => [...rs, { skill_id: "", is_mandatory: false, min_rating: "" }])}
          >
            <Plus size={13} /> Add skill
          </button>
        </div>
        {rows.length === 0 && (
          <InfoChip>
            No skills yet — mandatory skills drive the ATS score (50 of 100 points).
          </InfoChip>
        )}
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select
                className={`${inputCls} !w-56`}
                value={r.skill_id}
                onChange={(e) => updateRow(i, { skill_id: e.target.value })}
              >
                <option value="">Select skill…</option>
                {skills.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}{s.category ? ` (${s.category})` : ""}</option>
                ))}
              </select>
              <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-secondary">
                <input
                  type="checkbox"
                  checked={r.is_mandatory}
                  onChange={(e) => updateRow(i, { is_mandatory: e.target.checked })}
                  className="h-4 w-4 rounded border-strong"
                />
                Mandatory
              </label>
              <select
                className={`${inputCls} !w-32`}
                value={r.min_rating}
                onChange={(e) => updateRow(i, { min_rating: e.target.value })}
              >
                <option value="">Min rating —</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}
              </select>
              <button
                type="button"
                className="rounded-lg p-1.5 text-muted hover:bg-danger-soft hover:text-danger"
                onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                aria-label="Remove skill"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        {errors.skills && <div className="mt-1 text-xs text-danger">{errors.skills}</div>}
      </div>

      <div className={wizFooterRow}>
        <button className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`} onClick={submit} disabled={busy}>
          {busy ? "Saving…" : editing ? "Save changes" : "Create requirement"}
        </button>
      </div>
      </WizFormShell>
    </Modal>
  );
}

/* ================================================================ LIST PAGE */

type TabDef = {
  key: string; label: string; statuses: string[] | null;
  /** Deal stages this tab shows (22 Sep 2026). Sent as `?opportunity_stage=`,
   *  so TA slices by what SALES did, not by internal sourcing status. */
  stages?: string[];
  queue?: "sales-head" | "engineering";
};

/**
 * TA's tabs, mirroring the Sales Opportunities strip so both roles navigate the
 * same pipeline with the same words (reported 22 Sep 2026 — TA had one flat
 * list and no way to find a deal Sales had closed).
 *
 * `statuses: null` on every tab because the DEAL stage is the filter here; the
 * requirement's own status is irrelevant to "did Sales close this?".
 */
const TA_STAGE_TABS: TabDef[] = [
  // Active = what TA can SOURCE today (29 Sep 2026, user ask): a live deal whose
  // requirement is Open / Posted / In progress. A held requirement on a live
  // deal is one status-filter pick away, and the hold tabs follow the deal.
  { key: "ta-active", label: "Active", statuses: SOURCING_STATUSES, stages: ["New", "Active"] },
  { key: "ta-customer-hold", label: "Customer Hold", statuses: null, stages: ["On_Hold"] },
  { key: "ta-sales-hold", label: "Sales Hold", statuses: null, stages: ["Sales_Hold"] },
  { key: "ta-closed", label: "Closed", statuses: null,
    stages: ["Closed_Won", "Closed_Lost", "Closed_Partial"] },
  { key: "ta-rejected", label: "Rejected", statuses: null, stages: ["Rejected"] },
  { key: "ta-archived", label: "Archived", statuses: null, stages: ["Archived"] },
  // Genuinely everything. The previous build narrowed the default inside the
  // visibility layer, so "All" quietly did not mean all — the exact complaint.
  { key: "ta-all", label: "All", statuses: null },
];

/* ------------------------------------------ presentational helpers (UI only)
   29 Sep 2026 redesign: the stage pill strip, the date/overdue chip and the
   detail page's icon tab strip. No data, no handlers of their own. */

/** One colour per tab key, so a stage reads the same on every visit. */

/** Card title with an icon tile (the reference cards on the Details tab). */
function SectionTitle({ icon: Icon, children, tone = "from-brand-500 to-indigo-600" }: {
  icon: LucideIcon; children: ReactNode; tone?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className={`inline-flex h-8 w-8 items-center justify-center rounded-control bg-gradient-to-br text-white shadow-raised ${tone}`}>
        <Icon size={15} aria-hidden />
      </span>
      {children}
    </span>
  );
}

const DETAIL_TAB_ICON: Record<string, LucideIcon> = {
  details: FileText, postings: Megaphone, resumes: UsersRound, slots: CalendarClock,
  applicants: ClipboardList, suggested: Sparkles, activity: Activity,
};

/** The detail page's tab strip, with an icon per tab. Same keys / labels /
 *  onChange as the plain `Tabs` it replaced. */
function DetailTabStrip({ tabs, active, onChange }: {
  tabs: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-card border border-subtle bg-surface-1 p-1 shadow-raised">
      <div className="flex min-w-max gap-1" role="tablist" aria-label="Opportunity sections">
        {tabs.map((t) => {
          const on = t.key === active;
          const Icon = DETAIL_TAB_ICON[t.key] || FileText;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onChange(t.key)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-control px-3 py-2 text-sm font-semibold transition-colors ${focusRing} ${
                on
                  ? "bg-gradient-to-r from-brand-600 to-indigo-600 text-white shadow-raised"
                  : "text-muted hover:bg-surface-2 hover:text-primary"
              }`}
            >
              <Icon size={15} aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A fact on the detail page's gradient band. */
function BandFact({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-control bg-white/10 px-3 py-2 ring-1 ring-inset ring-white/15">
      <Icon size={15} className="mt-0.5 shrink-0 text-white/75" aria-hidden />
      <div className="min-w-0">
        <dt className="text-[10px] font-bold uppercase tracking-wider text-white/65">{label}</dt>
        <dd className="break-words text-sm font-semibold text-white">{value}</dd>
      </div>
    </div>
  );
}

export function RequirementsListPage() {
  const me = useMe();
  const canCreate = useCanAct("opportunities", "create", useHasRole("Sales")); // Admin passes too
  const [toastNode, toast] = useToast();
  /* Apply a candidate straight from the list (7 Sep 2026, user request): TA
     lands on THIS table under the Opportunities tab (the pipeline table is
     Sales-only), so the row icon has to live here too. Same gate as the
     server: profiles create for TA / Sales / RMG, template-aware. */
  const canApply = useCanAct("profiles", "create", useHasRole("TA", "Sales", "RMG"));
  const [applyTo, setApplyTo] = useState<Req | null>(null);

  const roles = me.roles;
  const isAdmin = roles.includes("Admin");
  /* Priority is editable in the row for whoever the server's PATCH admits —
     RMG / Sales Head by role, a GM through the screening approval, Admin. */
  const screens = useCanApprove("profile.rmg_screening");
  const prioRole = useHasRole("RMG", "Sales_Head");   // both hooks always run — never `a || useX()`
  const canSetPriority = screens || prioRole;
  const tabs = useMemo<TabDef[]>(() => {
    const t: TabDef[] = [];
    if (roles.includes("Sales")) {
      t.push(
        { key: "draft", label: "Draft", statuses: ["Draft"] },
        { key: "pending", label: "Pending Approval", statuses: ["Pending_Sales_Head_Approval", "Pending_Engineering_Review"] },
        { key: "rejected", label: "Rejected", statuses: ["Sales_Head_Rejected", "Engineering_Rejected"] },
        { key: "active", label: "Active", statuses: SOURCING_STATUSES },
        { key: "closed", label: "Closed", statuses: TERMINAL_STATUSES },
      );
    }
    if (roles.includes("Sales_Head") || isAdmin) {
      t.push({ key: "approval", label: "Approval Queue", statuses: ["Pending_Sales_Head_Approval"], queue: "sales-head" });
    }
    if (roles.includes("RMG") || isAdmin) {
      t.push({ key: "engineering", label: "RMG Review Queue", statuses: ["Pending_Engineering_Review"], queue: "engineering" });
    }
    if (roles.includes("Sales_Head") || roles.includes("RMG") || isAdmin) {
      t.push({ key: "all", label: "All", statuses: null });
    }
    // A pure TA had no tabs at all — one flat list with nowhere to look for a
    // deal Sales had closed. They now get the Sales-style stage strip.
    if (!t.length) return TA_STAGE_TABS;
    return t;
  }, [roles, isAdmin]);

  // Pure TA: no tab strip. The server scopes the default list to live sourcing
  // and widens only when a settled status is named, so "All statuses" here
  // still means "everything I work on" — not every requirement ever raised.
  // A pure TA now HAS tabs (the stage strip), so identify the mode by which
  // strip they got rather than by its absence.
  const taMode = tabs === TA_STAGE_TABS;
  const [tab, setTab] = usePageTab<string>("rtab", tabs[0]?.key || "all", tabs.map((t) => t.key));
  const [statusFilter, setStatusFilter] = useState("");
  /* List filters (25 Aug 2026): server-side — the list is paginated. */
  const [customerFilter, setCustomerFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  /* "Assigned to me" (1 Oct 2026): only the positions RMG / GM assigned to
     this TA. Off by default — every TA still sees every sourcing position. */
  const [assignedOnly, setAssignedOnly] = useSessionState("req.assigned", false);
  // Page + search survive a Back (crm/lib/pageState.ts).
  const [page, setPage] = useSessionState("req.page", 1);
  const [search, setSearch] = useSessionState("req.search", "");
  const dq = useDebounced(search);
  const [rows, setRows] = useState<Req[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [decision, setDecision] = useState<{ req: Req; stage: "sales-head" | "engineering"; kind: "approve" | "reject" } | null>(null);
  const customers = useCustomerNames();

  const active = tabs.find((t) => t.key === tab);
  // The "All" tab honours the status filter too (25 Aug 2026) — RMG/Sales_Head
  // asked to narrow it the same way TA can.
  const statuses = taMode
    ? (statusFilter ? [statusFilter] : (active?.statuses ?? null))
    : (active?.statuses ?? (statusFilter ? [statusFilter] : null));
  const statusKey = (statuses || []).join(",");
  // Deal-stage filter for the tab. ONE request whatever the tab: the server
  // takes a CSV, unlike `status`, so grouping stages costs no extra round trip.
  const stageKey = (active?.stages || []).join(",");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // ONE request whatever the tab: the server takes a CSV of statuses
      // (29 Sep 2026), so a multi-status tab no longer fans out and merges.
      const res = await crmGet<Req[]>(
        `/api/requirements${qs({
          page, limit: 20, search: dq || undefined, status: statusKey || undefined,
          opportunity_stage: stageKey || undefined,
          customer_id: customerFilter || undefined,
          priority: priorityFilter || undefined,
          assigned_to_me: taMode && assignedOnly ? "true" : undefined,
        })}`,
      );
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load requirements");
    } finally {
      setLoading(false);
    }
  }, [page, dq, statusKey, stageKey, customerFilter, priorityFilter, taMode, assignedOnly]);

  useEffect(() => { load(); }, [load]);
  useRefetchOnFocus(load);
  useChangeEffect(() => { setPage(1); }, [tab, dq, statusFilter, customerFilter, priorityFilter, assignedOnly]);

  const columns: Column<Req>[] = [
    { key: "req_number", label: "Opportunity ID",
      /* ONE id for every role (18 Aug 2026): the number Sales quoted IS the
         number RMG/TA see, search and quote back. REQ-xxxx is internal now. */
      render: (r) => (
        <span className="inline-flex whitespace-nowrap rounded-control bg-brand-50 px-2 py-0.5 font-mono text-xs font-bold text-brand-700 ring-1 ring-inset ring-subtle dark:bg-indigo-500/15 dark:text-indigo-200">
          {reqLabel(r)}
        </span>
      ) },
    { key: "title", label: "Title",
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold text-primary">{r.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {canSetPriority
              ? <InlinePriority requirementId={r.id} value={r.priority} toast={toast}
                  onChanged={(p) => setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, priority: p } : x)))} />
              : r.priority && <PriorityPill p={r.priority} />}
            {(r.experience_min != null || r.experience_max != null) && (
              <span className="inline-flex items-center gap-1 text-xs text-muted">
                <GraduationCap size={12} aria-hidden /> {fmtRange(r.experience_min, r.experience_max, "yrs")}
              </span>
            )}
          </div>
          {(r.assigned_tas?.length ?? 0) > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1" title="TAs assigned to source this position">
              {(r.assigned_tas || []).map((a) => <TaChip key={a.id} a={a} />)}
            </div>
          )}
        </div>
      ) },
    {
      key: "customer", label: "Customer",
      render: (r) => {
        const name = r.customer_name || (r.customer_id != null ? customers[r.customer_id] : null);
        const loc = [r.work_mode, r.location_name].filter(Boolean).join(" · ");
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-primary">
              <Building2 size={13} className="shrink-0 text-muted" aria-hidden />
              <span className="truncate">{name || (r.customer_id != null ? `#${r.customer_id}` : "—")}</span>
            </div>
            {loc && (
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                <MapPin size={12} className="shrink-0" aria-hidden /> <span className="truncate">{loc}</span>
              </div>
            )}
          </div>
        );
      },
    },
    { key: "no_of_positions", label: "Positions",
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-bold text-primary ring-1 ring-inset ring-subtle">
          <UsersRound size={12} className="text-muted" aria-hidden /> {r.no_of_positions ?? "—"}
        </span>
      ) },
    { key: "budget", label: "Budget",
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-primary">
          <Wallet size={13} className="text-muted" aria-hidden />
          {fmtRange(r.budget_ctc_min, r.budget_ctc_max, "")}
        </span>
      ) },
    {
      key: "status",
      label: "Status",
      // ONE vocabulary: a closed or parked DEAL badges with the Sales wording
      // (Close Lost, Customer Hold) because that is the fact that matters to
      // everyone. A live deal keeps its sourcing status — "Active" would not
      // tell TA whether they can source yet. Server decides; see
      // `display_status_for`. Falls back to the raw status on an older payload.
      render: (r) => <StatusBadge status={r.display_status || r.status} />,
    },
    { key: "target_closure_date", label: "Target date",
      render: (r) => {
        const due = dueChip(r.target_closure_date, r.status);
        return (
          <div className="whitespace-nowrap">
            <span className="inline-flex items-center gap-1.5 text-primary">
              <CalendarDays size={13} className="text-muted" aria-hidden /> {fmtDate(r.target_closure_date)}
            </span>
            {due && <div className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${due.cls}`}>{due.label}</div>}
          </div>
        );
      } },
  ];
  /* Header copy + figures (29 Sep 2026 redesign) — all from state already
     loaded; the counts describe the open tab / this page, nothing is fetched. */
  const headerEyebrow = taMode
    ? "Talent acquisition"
    : roles.includes("Sales") ? "Sales" : (roles.includes("RMG") ? "RMG" : roles.includes("Sales_Head") ? "Sales Head" : "Workspace");
  const headerSubtitle = taMode
    ? "Positions you can source today, and every deal Sales has parked or closed."
    : roles.includes("Sales") && !roles.includes("Sales_Head") && !isAdmin
      ? "Your requirements from draft, through approval, to sourcing."
      : "Approval queues and every open position across customers.";
  const pagePositions = rows.reduce((n, r) => n + (Number(r.no_of_positions) || 0), 0);
  const pageHigh = rows.filter((r) => r.priority === "High").length;
  const pageOverdue = rows.filter((r) => dueChip(r.target_closure_date, r.status)?.cls.includes("danger")).length;
  const headerStats = [
    { label: active ? active.label.toLowerCase() : "opportunities", value: meta ? meta.total : "—",
      title: "Total in the open tab" },
    { label: "positions on this page", value: pagePositions },
    { label: "high priority", value: pageHigh },
    ...(pageOverdue ? [{ label: "past target date", value: pageOverdue }] : []),
  ];

  if (active?.queue) {
    const stage = active.queue;
    columns.push({
      key: "_actions", label: "Actions",
      render: (r) => (
        <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button className={smallSuccess} onClick={() => setDecision({ req: r, stage, kind: "approve" })}>
            <Check size={13} /> Approve
          </button>
          <button className={smallDanger} onClick={() => setDecision({ req: r, stage, kind: "reject" })}>
            <X size={13} /> Reject
          </button>
        </div>
      ),
    });
  }

  return (
    <div className="space-y-4">
      {toastNode}
      <PageHeader
        icon={Briefcase}
        title="Opportunities"
        eyebrow={headerEyebrow}
        subtitle={headerSubtitle}
        accent="ocean"
        stats={headerStats}
        actions={canCreate ? (
          <button type="button" className={HERO_BTN_SOLID} onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New Requirement
          </button>
        ) : undefined}
      >
        {tabs.length > 0 && (
          <StagePills
            tabs={tabs.map((t) => ({ key: t.key, label: t.label }))}
            active={tab}
            onChange={setTab}
            activeCount={!loading && meta ? meta.total : undefined}
          />
        )}
      </PageHeader>

      {active?.queue === "engineering" && <PendingPositionChangesPanel />}

      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : (
        <DataTable<Req>
          columns={columns}
          rows={rows}
          meta={meta}
          headerRight={meta ? <span className="whitespace-nowrap text-xs font-medium text-muted">{meta.total} {meta.total === 1 ? "requirement" : "requirements"}, page {meta.page}/{Math.max(1, meta.pages || 1)}</span> : undefined}
          loading={loading}
          search={search}
          onSearch={setSearch}
          onPage={setPage}
          onRowClick={(r) => crmNavigate(`requirements/${r.id}`)} rowHref={(r: any) => `requirements/${r.id}`}
          rowActionsLabel="Actions"
          rowActions={(canApply || canSetPriority) ? (r) => (
            <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              {canSetPriority && (
                <AssignTasButton requirementId={r.id} label={reqLabel(r)} assigned={r.assigned_tas} toast={toast}
                  onChanged={(rows) => setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, assigned_tas: rows } : x)))} />
              )}
              {!canApply ? null : SOURCING_STATUSES.includes(r.status) ? (
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-control p-1.5 text-muted transition-colors hover:bg-surface-2 hover:!text-indigo-600"
                  title="Apply a candidate to this opportunity"
                  aria-label={`Apply a candidate to ${r.title}`}
                  onClick={(e) => { e.stopPropagation(); setApplyTo(r); }}
                >
                  <UserPlus size={15} />
                </button>
              ) : (
                <span className="inline-flex p-1.5 text-muted/40" title="Applications open once the requirement is in sourcing">
                  <UserPlus size={15} />
                </span>
              )}
            </span>
          ) : undefined}
          emptyMessage={
            taMode && tab === "ta-active" && !statusFilter && !dq
              ? "Nothing live to source right now — work appears here once RMG approves it. "
                + "Closed and parked deals are on the other tabs."
              : <TeachingEmpty page="requirements" />
          }
          filters={
            <>
              {(taMode || tab === "all") && (
                <select
                  className={`${inputCls} !w-56`}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  title="Narrow by sourcing status within this tab"
                >
                  {/* "All statuses" now genuinely means all — the tab above is
                      what scopes the view, and the user can see and change it. */}
                  <option value="">All sourcing statuses</option>
                  {(taMode ? TA_FILTER_STATUSES : ALL_REQ_STATUSES).map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                  ))}
                </select>
              )}
              <select className={`${inputCls} !w-52`} value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)} title="Filter by customer">
                <option value="">All customers</option>
                {Object.entries(customers)
                  .sort((a, b) => a[1].localeCompare(b[1]))
                  .map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              <select className={`${inputCls} !w-40`} value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)} title="Filter by priority">
                <option value="">All priorities</option>
                {["High", "Medium", "Low"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              {taMode && (
                <label className={`inline-flex h-9 cursor-pointer items-center gap-2 whitespace-nowrap rounded-control border px-3 text-xs font-semibold ${assignedOnly
                  ? "border-brand-600 bg-brand-50 text-brand-700 dark:bg-indigo-500/15 dark:text-indigo-200"
                  : "border-subtle bg-surface-1 text-secondary"}`}
                  title="Only the positions RMG / GM assigned to you">
                  <input type="checkbox" className="h-3.5 w-3.5" checked={assignedOnly}
                         onChange={(e) => setAssignedOnly(e.target.checked)} />
                  Assigned to me
                </label>
              )}
            </>
          }
        />
      )}

      {applyTo && (
        <ApplyToOpportunityModal
          mode="pick-candidate"
          opportunityId={applyTo.opportunity_id}
          opportunityLabel={`${reqLabel(applyTo)} — ${applyTo.title}`}
          onClose={() => setApplyTo(null)}
          onApplied={(msg) => { toast(msg); setApplyTo(null); }}
        />
      )}
      {showCreate && (
        <RequirementFormModal
          initial={null}
          onClose={() => setShowCreate(false)}
          onSaved={(r) => crmNavigate(`requirements/${r.id}`)}
          toast={toast}
        />
      )}
      {decision && (
        <DecisionModal
          req={decision.req}
          stage={decision.stage}
          kind={decision.kind}
          onClose={() => setDecision(null)}
          onDone={() => load()}
          toast={toast}
        />
      )}
    </div>
  );
}

/* ============================================================== DETAIL PAGE */

/* ------------------------------------------------------- job postings tab */

function JobPostingsTab({
  req, toast, onRequirementChanged,
}: {
  req: Req;
  toast: ToastFn;
  onRequirementChanged: () => void;
}) {
  const taRole = useHasRole("TA");
  const taCanEdit = useCanAct("requirements", "edit", taRole);
  const isTA = taRole && taCanEdit;
  const [postings, setPostings] = useState<JobPosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [portal, setPortal] = useState("Naukri");
  const [url, setUrl] = useState("");
  const [urlErr, setUrlErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [applyUrl, setApplyUrl] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<JobPosting[]>(`/api/requirements/${req.id}/job-postings`);
      setPostings(res.data || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load job postings");
    } finally {
      setLoading(false);
    }
  }, [req.id]);
  useEffect(() => { load(); }, [load]);

  const canAdd = isTA && SOURCING_STATUSES.includes(req.status);

  const addPosting = async () => {
    if (!/^https?:\/\/.+\..+/i.test(url.trim())) {
      setUrlErr("Enter a valid URL starting with http:// or https://");
      return;
    }
    setBusy(true);
    try {
      const res = await crmPost(`/api/requirements/${req.id}/job-postings`, {
        portal_name: portal,
        job_post_url: url.trim(),
      });
      toast(res.message || "Job posting added");
      setShowAdd(false);
      setUrl("");
      load();
      onRequirementChanged(); // first posting auto-moves Open_For_Sourcing -> Posted_On_Portals
    } catch (e: any) {
      toast(e?.message || "Failed to add posting", "err");
    } finally {
      setBusy(false);
    }
  };

  const openApplyLink = async () => {
    setLinkBusy(true);
    setCopied(false);
    try {
      const res = await crmGet<{ apply_url: string }>(`/api/requirements/${req.id}/apply-link`);
      setApplyUrl(res.data?.apply_url || "");
      setShowLink(true);
    } catch (e: any) {
      toast(e?.message || "Failed to generate application link", "err");
    } finally {
      setLinkBusy(false);
    }
  };

  const copyApplyUrl = async () => {
    try {
      await navigator.clipboard.writeText(applyUrl);
      setCopied(true);
    } catch {
      /* clipboard blocked — user can still select the text */
    }
  };

  const columns: Column<JobPosting>[] = [
    { key: "portal_name", label: "Portal", render: (p) => <span className="font-semibold">{p.portal_name}</span> },
    {
      key: "job_post_url", label: "URL",
      render: (p) => (
        <a
          href={p.job_post_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-md items-center gap-1 truncate text-sky-600 hover:underline dark:text-sky-400"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink size={13} /> <span className="truncate">{p.job_post_url}</span>
        </a>
      ),
    },
    { key: "posted_by", label: "Posted by", render: (p) => (p.posted_by != null ? `User #${p.posted_by}` : "—") },
    { key: "posted_at", label: "Date", render: (p) => fmtDate(p.posted_at) },
    { key: "status", label: "Status", render: (p) => <StatusBadge status={p.status || "Active"} /> },
  ];

  return (
    <div className="space-y-3">
      {canAdd && (
        <div className="flex flex-wrap justify-end gap-2">
          <button className={btnSecondary} onClick={openApplyLink} disabled={linkBusy}>
            <Link2 size={15} /> {linkBusy ? "Generating…" : "Application link"}
          </button>
          <button className={btnSecondary} onClick={() => setShowAdd(true)}>
            <Link2 size={15} /> Add posting
          </button>
        </div>
      )}

      {showLink && (
        <Modal
          title={<span className="sr-only">Public application link</span>}
          onClose={() => setShowLink(false)}
          scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0"
        >
          <WizFormShell
            title="Public application link"
            subtitle="Share this link so candidates can apply directly into this requirement."
            icon={<Link2 size={20} aria-hidden />}
          >
            <InfoChip>
              Share this link on Naukri, LinkedIn, or anywhere else. Candidates fill in their name, email,
              phone and experience and upload a resume — submissions appear in this requirement’s Resumes tab.
            </InfoChip>
            <div className="mt-4">
              <FieldLabel label="Application link" />
              <div className="flex items-center gap-2">
                <input
                  className={lockedInputCls}
                  readOnly
                  value={applyUrl}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button className={`${btnPrimary} h-10 shrink-0 rounded-xl`} onClick={copyApplyUrl}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <a className={`${btnSecondary} h-10 rounded-xl`} href={applyUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={14} /> Preview form
              </a>
            </div>
          </WizFormShell>
        </Modal>
      )}
      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : (
        <DataTable<JobPosting> columns={columns} rows={postings} loading={loading} emptyMessage="No job postings yet" />
      )}
      {showAdd && (
        <Modal
          title={<span className="sr-only">Add job posting</span>}
          onClose={() => setShowAdd(false)}
          fullScreen
          scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
        >
          <WizFormShell
            title="Add job posting"
            subtitle="Record where this requirement is advertised so sourcing stays tracked."
            icon={<Link2 size={20} aria-hidden />}
          >
            <div className="space-y-5">
              <WizardField label="Portal" required>
                <select className={inputCls} value={portal} onChange={(e) => setPortal(e.target.value)}>
                  {JOB_PORTALS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </WizardField>
              <WizardField label="Job post URL" required error={urlErr} icon={<Link2 size={15} className="text-[color:var(--wiz-muted)]" aria-hidden />} filled={!!url.trim() && !urlErr}>
                <input
                  className={inputCls}
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); if (urlErr) setUrlErr(""); }}
                  placeholder="https://www.naukri.com/job/…"
                />
              </WizardField>
              <div className={wizFooterRow}>
                <button className={`${btnSecondary} h-10 rounded-xl`} onClick={() => setShowAdd(false)} disabled={busy}>Cancel</button>
                <button className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`} onClick={addPosting} disabled={busy}>
                  {busy ? "Adding…" : "Add posting"}
                </button>
              </div>
            </div>
          </WizFormShell>
        </Modal>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- resumes tab */

function ScorePill({ row, onClick }: { row: ResumeRow; onClick: () => void }) {
  if (row.ats_score == null) return <span className="text-muted">—</span>;
  const s = row.ats_score;
  const cls =
    s >= 70
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : s >= 40
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300";
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`rounded-full px-2.5 py-0.5 text-xs font-bold shadow-ai-glow ${cls} hover:ring-2 hover:ring-sky-300`}
      title="View ATS score breakdown"
    >
      {s}
    </button>
  );
}


/** Applied Candidates column keys — must match `TABLE_REGISTRY["requirement_resumes"]`
 *  in the backend (`routers/crm/table_preferences.py`). */
const RESUME_COLUMN_LABELS: Record<string, string> = {
  candidate_name: "Candidate",
  applied_by: "Applied by",
  // Stage + Status (user decision 30 Sep 2026, after the chips became status-based):
  // the stage stays as its own column beside the status.
  profile_stage: "Stage",
  profile_pipeline_status: "Status",
  availability: "Availability",
  received_date: "Received",
  ats_score: "ATS Score",
  ai_interview_status: "Interview",
  rounds: "Rounds",
  _actions: "Actions",
};
const RESUME_COLUMN_KEYS = Object.keys(RESUME_COLUMN_LABELS);
/** Applied Candidates | Archive (30 Sep 2026): the server's `bucket`. */
type AppliedBucket = "live" | "archive";
const APPLIED_BUCKETS: readonly AppliedBucket[] = ["live", "archive"];
/** `meta.status_counts` — statuses AND stages per bucket, from the list endpoint. */
type StatusCounts = {
  live: Record<string, number>;
  archive: Record<string, number>;
  live_total: number;
  archive_total: number;
  phases?: { live: Record<string, number>; archive: Record<string, number> };
};
/** Columns a TA login does not see (28 Sep 2026, user request): the received date. */
const TA_HIDDEN_RESUME_COLUMNS = new Set(["received_date"]);

/** A round's feedback button on the RMG / GM row (28 Sep 2026): locked until
 *  the interview time, amber once it is over with no verdict, a done-chip once
 *  recorded (editing is on the profile's Interviews tab). */
function FeedbackButton({ label, result, when, busy, onClick }: {
  label: string;
  result?: string | null;
  when?: string | null;
  busy?: boolean;
  onClick: () => void;
}) {
  if (result) {
    return (
      <span className={FLOW_DONE_CHIP} title={`${label} recorded: ${result}. Edit it on the profile's Interviews tab if needed.`}>
        {label}: {result} ✓
      </span>
    );
  }
  const started = roundHasStarted(when);
  return (
    <button type="button" className={started ? FLOW_BTN.warn : FLOW_BTN.manualOutline}
      disabled={busy || !started} onClick={onClick}
      title={started
        ? `The ${label} is over — record the verdict so the candidate moves on`
        : `Opens at the interview time${when ? ` (${fmtDateTime(when)})` : ""}`}>
      <ClipboardCheck size={13} /> {started ? `${label} feedback due` : `${label} feedback`}
    </button>
  );
}

/** Applied Candidates — exported (29 Sep 2026) so the opportunity page can give
 *  RMG / GM the same list (stage · status · rounds · their buttons) in place. */
/** Rejected at any stage or status: a closed candidacy, or RMG / GM rejected it at screening. */
function isRejectedRow(r: { profile_pipeline_status?: string | null; rmg_screening_status?: string | null }): boolean {
  return isClosedCandidacy(r.profile_pipeline_status) || r.rmg_screening_status === "Rejected";
}

export function ResumesTab({
  req, toast, onRequirementChanged,
}: {
  req: Req;
  toast: ToastFn;
  onRequirementChanged: () => void;
}) {
  const taRole = useHasRole("TA");
  const taCanEdit = useCanAct("requirements", "edit", taRole);
  const isTA = taRole && taCanEdit;
  /* AI L1 template check before Schedule AI L1 / Slot invite (6 Oct 2026). */
  const tplGate = useAiTemplateGate();
  // The AI report opens for every role holding the report page (TA · HR · RMG · Admin).
  const canOpenAiReport = useCanOpenAiReport();
  /* Role IDENTITY, not tab access (fix 28 Aug 2026): with template authority,
     useCanAct alone made every templated user "RMG" here — TA saw the RMG
     Shortlist/Reject buttons. The role stays a role check; the template only
     gates whether the tab's edit actions render at all. */
  const rmgRole = useHasRole("RMG");
  const rmgCanEdit = useCanAct("requirements", "edit", rmgRole);
  /* The two DECISIONS on this tab are approval buttons (25 Sep 2026) —
     `me.approvals` decides, the same answer the server's gate gives. A GM (a
     custom role with the screening approval) works this tab as RMG does
     (28 Sep 2026 — mirrors B-V2 `screens_as_rmg`). */
  const canScreen = useCanApprove("profile.rmg_screening");
  const isRmg = (rmgRole && rmgCanEdit) || canScreen;
  const { layout, setLayout } = useTableLayout("requirement_resumes", RESUME_COLUMN_KEYS);
  /* The Sales → Sales Head approval gate on this tab too (2 Sep 2026): the
     step must be offered wherever a candidate is worked, not only on the
     profile page. Same role-identity rule as RMG above. */
  const salesRole = useHasRole("Sales", "Sales_Head");
  const salesCanEdit = useCanAct("requirements", "edit", salesRole);
  const isSales = salesRole && salesCanEdit;
  const salesHeadRole = useHasRole("Sales_Head");
  const salesHeadCanEdit = useCanAct("requirements", "edit", salesHeadRole);
  const isSalesHead = salesHeadRole && salesHeadCanEdit;
  const canDecideTerms = useCanApprove("profile.sales_head_decision");
  const [approvalRow, setApprovalRow] = useState<ResumeRow | null>(null);
  const [decisionRow, setDecisionRow] = useState<{ row: ResumeRow; decision: SalesHeadDecision } | null>(null);
  /* TA schedules EVERY round from here (2 Sep 2026, user flow): the customer's
     L1/L2 and the HR round open the profile's own round form, preset to the
     round — one form, one wording, and the candidate is emailed the invite. */
  const [roundModal, setRoundModal] = useState<{ row: ResumeRow; kind: string; existing?: any } | null>(null);
  /* TA's row buttons — Technical Screening · Hold · Reject · Self Withdraw —
     and RMG / GM's "AI L1" route choice (28 Sep 2026, user flow). */
  const [taPick, setTaPick] = useState<{ row: ResumeRow; profileId: number; decision: TaDecision } | null>(null);
  const [aiRouteRow, setAiRouteRow] = useState<{ row: ResumeRow; profileId: number } | null>(null);
  /* Every interview + its feedback in a pop-up (Rounds / Interview cells). */
  const [roundsRow, setRoundsRow] = useState<{ row: ResumeRow; profileId: number } | null>(null);
  /* A TA-only login gets the trimmed table (no Received column) — RMG, Sales
     and Admin keep every column. */
  const hasOtherWorkRole = useHasRole("RMG", "Sales", "Sales_Head");
  const taView = isTA && !hasOtherWorkRole;
  const [rows, setRows] = useState<ResumeRow[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [page, setPage] = useState(1);
  /* `?q=` from a notification link prefills the search so the candidate the
     mail was about is the first row (8 Sep 2026). */
  const [search, setSearch] = useState(deepLinkSearch);
  const dq = useDebounced(search);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [scanAllBusy, setScanAllBusy] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  /* Bulk ZIP upload (20 Aug 2026): one zip in, every readable resume becomes an
   * application; possible duplicates come back HELD with the matched candidate,
   * and TA applies them (or not) from the results dialog. */
  const [zipBusy, setZipBusy] = useState(false);
  const [zipResult, setZipResult] = useState<{
    applied: { file: string; name: string; resume_id: number; candidate_id: number; profile_id: number | null; ats_score?: number | null;
      name_match?: { candidate_id: number; name: string; email?: string } | null;
      /** The address read from the CV, and what happened to the opening email
       *  (sent · no_email · already_sent · not_sent · off) — 1 Oct 2026. */
      email?: string | null; opening_mail?: string | null }[];
    opening_mail?: { enabled: boolean; sent: number; no_email: number };
    held: { file: string; resume_id: number; extracted_name: string; ats_score?: number | null; duplicate: {
      candidate_id: number; name: string; email?: string; phone?: string;
      already_applied_here: boolean; profile_id_here: number | null;
      profiles: { profile_id: number; opportunity_title: string; pipeline_status: string }[];
    } }[];
    skipped: { file: string; reason: string }[];
    failed: { file: string; reason: string }[];
    total: number;
  } | null>(null);
  const [zipApplying, setZipApplying] = useState<number | null>(null);
  const [zipAppliedDups, setZipAppliedDups] = useState<Set<number>>(new Set());
  /* A bulk upload lands at Sourcing (28 Sep 2026): TA sends the batch for
     Technical Screening in one go — RMG / GM get ONE notice, not fifty. */
  const [zipScreening, setZipScreening] = useState(false);
  const sendZipForScreening = async () => {
    const ids = (zipResult?.applied || []).map((a) => a.profile_id).filter((id): id is number => id != null);
    if (!ids.length) return;
    setZipScreening(true);
    try {
      const res = await crmPost<{ sent: number[]; refused: { profile_id: number; reason: string }[] }>(
        "/api/candidate-profiles/send-for-screening", { profile_ids: ids });
      toast(res.message || "Sent for Technical Screening");
      void load();
    } catch (e: any) {
      toast(e?.message || "Could not send the batch", "err");
    } finally {
      setZipScreening(false);
    }
  };
  /* Verify wizard (28 Aug 2026): TA steps through the applied candidates —
     resume beside parsed details — right from the results dialog. */
  const [verifyQueue, setVerifyQueue] = useState<VerifyQueueItem[] | null>(null);

  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);
  /* Email every uploaded candidate about the opening (1 Oct 2026, user ask) —
     on by default, the TA's last choice remembered on this browser. */
  const [zipOpeningMail, setZipOpeningMail] = useState<boolean>(() => {
    try { return localStorage.getItem(ZIP_OPENING_MAIL_KEY) !== "0"; } catch { return true; }
  });
  const pickZipOpeningMail = (on: boolean) => {
    setZipOpeningMail(on);
    try { localStorage.setItem(ZIP_OPENING_MAIL_KEY, on ? "1" : "0"); } catch { /* per-browser nicety only */ }
  };

  /* The ZIP runs as a BACKGROUND JOB (one AI parse per resume — a full zip is
   * minutes, not seconds). Upload returns a job_id; poll for progress so the
   * button reads "Processing 23/50…" instead of freezing. */
  const uploadZip = async (f: File) => {
    setZipBusy(true);
    setZipProgress(null);
    try {
      const start = await crmUpload<{ job_id: string; total: number; oversize: any[] }>(
        `/api/requirements/${req.id}/resumes/bulk-zip`, f,
        { send_opening_email: zipOpeningMail ? "true" : "false" },
      );
      const jobId = start.data.job_id;
      setZipProgress({ done: 0, total: start.data.total });
      const poll = async (): Promise<void> => {
        const res = await crmGet<{
          status: string; done: number; total: number; message?: string;
          error?: string; oversize?: any[];
          result?: NonNullable<typeof zipResult>;
        }>(`/api/resumes/bulk-jobs/${jobId}`);
        const j = res.data;
        if (j.status === "running") {
          setZipProgress({ done: j.done || 0, total: j.total || 0 });
          await new Promise((r) => setTimeout(r, 1500));
          return poll();
        }
        if (j.status === "error") throw new Error(j.error || "Bulk processing failed");
        const result = j.result!;
        // Oversize members were rejected before the job started — fold them in.
        if (j.oversize?.length) result.failed = [...result.failed, ...j.oversize];
        /* Straight into side-by-side verification (user decision, 28 Aug
           2026): resume left, parsed details right, one candidate at a time —
           applied AND held-duplicate rows both. The summary dialog only
           appears when there is nothing to step through (all skipped/failed),
           because then something must explain why. */
        const queue: VerifyQueueItem[] = [
          ...result.applied.map((a) => ({ resume_id: a.resume_id, name: a.name })),
          ...result.held.map((h) => ({ resume_id: h.resume_id, name: h.extracted_name, held: true })),
        ];
        if (queue.length > 0) {
          const bits = [`${result.applied.length} applied`];
          if (result.opening_mail?.enabled && result.applied.length) {
            bits.push(`${result.opening_mail.sent} opening email(s) sent`);
            if (result.opening_mail.no_email) bits.push(`${result.opening_mail.no_email} without an email`);
          }
          if (result.held.length) bits.push(`${result.held.length} possible duplicate(s)`);
          if (result.skipped.length) bits.push(`${result.skipped.length} already uploaded`);
          if (result.failed.length) bits.push(`${result.failed.length} failed`);
          toast(bits.join(" · "));
          setVerifyQueue(queue);
        } else {
          setZipResult(result);
        }
        setZipAppliedDups(new Set());
        load();
        onRequirementChanged();
      };
      await poll();
    } catch (e: any) {
      toast(e?.message || "ZIP upload failed", "err");
    } finally {
      setZipBusy(false);
      setZipProgress(null);
    }
  };

  /** "Apply anyway" on a held duplicate — one atomic endpoint that applies the
   *  EXISTING candidate and clears the persisted hold flag. */
  const applyHeldDuplicate = async (resumeId: number, candidateId: number) => {
    setZipApplying(candidateId);
    try {
      await crmPost(`/api/resumes/${resumeId}/apply-duplicate`);
      setZipAppliedDups((prev) => new Set(prev).add(candidateId));
      toast("Applied to this opportunity");
      load();
    } catch (e: any) {
      toast(e?.message || "Apply failed", "err");
    } finally {
      setZipApplying(null);
    }
  };
  const [breakdownRow, setBreakdownRow] = useState<ResumeRow | null>(null);
  const [rejectRow, setRejectRow] = useState<ResumeRow | null>(null);
  const [scheduleRow, setScheduleRow] = useState<ResumeRow | null>(null);
  // The interview time the TA agreed with the candidate (IST wall clock).
  // Until 14 Sep 2026 this dialog sent no time and the server stamped "now",
  // so the candidate's email named the moment the TA clicked, not the slot.
  const [scheduleWhen, setScheduleWhen] = useState("");
  /* Profile-only rows schedule through the PROFILE modal — there is no
     resume record for the resume-based confirm path to act on. */
  const [profileScheduleRow, setProfileScheduleRow] = useState<ResumeRow | null>(null);
  /* A fresh AI L1 link over one that was not attempted / not cleared (7 Oct 2026):
     the same dialog, in reschedule mode — a required note, the old verdict kept. */
  const [rescheduleRow, setRescheduleRow] = useState<{ row: ResumeRow; seed: RescheduleSeed } | null>(null);
  const [editRow, setEditRow] = useState<ResumeRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<ResumeRow | null>(null);
  const [inviteOpenId, setInviteOpenId] = useState<number | null>(null);
  const [profileByResume, setProfileByResume] = useState<Record<number, number>>({});
  const [inviteBusyId, setInviteBusyId] = useState<number | null>(null);
  /* "Applied by" filter (25 Aug 2026): SERVER-side — the list is paginated, so
   * a client-side filter would silently miss the other pages. TA names come
   * from the opportunity's profiles (where attribution is stamped). */
  /* A TA opens on THEIR OWN candidates (28 Sep 2026, user ask) — "anyone" is
     one pick away. Not when a notification link named a candidate (`?q=`):
     that one may belong to a colleague (the TA who sent them for screening
     hears about them too). Matches `ta_owner_name`, the name stamped at apply. */
  const me = useMe();
  const myName = (me.full_name || me.username || "").trim();
  const [appliedBy, setAppliedBy] = useState(() => (taView && !deepLinkSearch() ? myName : ""));
  const [taNames, setTaNames] = useState<string[]>([]);
  /* The chosen name stays pickable even before anyone's candidate lists it. */
  const taOptions = appliedBy && !taNames.includes(appliedBy) ? [...taNames, appliedBy].sort() : taNames;
  /* Applied-date window (11 Sep 2026, TA request) — server-side like the TA filter. */
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");
  /* Dismissed duplicates are hidden by default (0087) — this shows ONLY them. */
  const [showDismissed, setShowDismissed] = useState(false);
  /* Stage chips (1 Oct 2026, user decision — STAGES, not the 33 statuses, for
     every login): one-click filter by the candidate's DERIVED stage, the words
     the Stage column prints (`CANDIDATE_STAGE_BUCKETS`, sent as `?phase=`).
     Server-side — the list is paginated. `bucket` is the Applied Candidates |
     Archive switch: Archive holds the closed candidacies RMG / GM moved there. */
  const [stagePill, setStagePill] = usePageTab<string>("phase", "all", CANDIDATE_STAGE_BUCKETS.map((b) => b.key));
  const [bucket, setBucket] = usePageTab<AppliedBucket>("sub", "live", APPLIED_BUCKETS);
  /* Candidates per stage, live and archived apart — from the list's own meta. */
  const [statusCounts, setStatusCounts] = useState<StatusCounts | null>(null);
  const bucketCounts = statusCounts?.phases?.[bucket] ?? null;
  /* Every stage on the live list (a rejected candidate stays there, under
     Closed, until archived); Archive can only hold closed candidacies. */
  const stageChips = CANDIDATE_STAGE_BUCKETS.filter((b) => bucket === "live" || b.key === "all" || b.key === "closed");
  /* Tick rows → "Send N for Technical Screening" (1 Oct 2026, user ask: keep
     the per-row button AND a batch send, but only for the profiles TA picked).
     Only a candidate still at Sourcing with TA can be sent (`taDecisionsFor`
     offers "screen"); other ticked rows are ignored and said so. */
  const [picked, setPicked] = useState<Set<string | number>>(new Set());
  const [batchSending, setBatchSending] = useState(false);
  const canPick = isTA && bucket === "live";
  const sendable = (r: ResumeRow) => r.profile_id != null
    && taDecisionsFor(r).some((d) => d === "screen" || d === "interested");
  const pickedSendable = rows.filter((r) => picked.has(r.id) && sendable(r));
  const sendPickedForScreening = async () => {
    const ids = pickedSendable.map((r) => r.profile_id as number);
    if (!ids.length) return;
    setBatchSending(true);
    try {
      const res = await crmPost<{ sent: number[]; refused: { profile_id: number; reason: string }[] }>(
        "/api/candidate-profiles/send-for-screening", { profile_ids: ids });
      const skipped = picked.size - ids.length;
      toast(`${res.message || "Sent for Technical Screening"}${skipped > 0 ? ` · ${skipped} ticked row${skipped === 1 ? "" : "s"} not at Sourcing — skipped` : ""}`);
      setPicked(new Set());
      void load();
    } catch (e: any) {
      toast(e?.message || "Could not send the batch", "err");
    } finally {
      setBatchSending(false);
    }
  };
  useEffect(() => {
    let alive = true;
    crmGet<any[]>(`/api/candidate-profiles?opportunity_id=${req.opportunity_id}&limit=100`)
      .then((r) => {
        if (!alive) return;
        setTaNames([...new Set((r.data || []).map((p: any) => p.ta_owner_name).filter(Boolean))].sort() as string[]);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [req.opportunity_id]);

  /* RMG / GM archive a closed candidacy by hand, or restore it. */
  const [archivingId, setArchivingId] = useState<number | null>(null);
  const setArchived = async (profileId: number, archived: boolean) => {
    setArchivingId(profileId);
    try {
      const res = await crmPost<any>(`/api/candidate-profiles/${profileId}/archive`, { archived });
      toast(res.message || (archived ? "Moved to Archive" : "Restored"));
      void load();
    } catch (e: any) {
      toast(e?.message || "Could not change the archive", "err");
    } finally {
      setArchivingId(null);
    }
  };
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<ResumeRow[]>(
        `/api/requirements/${req.id}/resumes${qs({
          // 10 a page (1 Sep 2026, user request) — the tab is a working list
          // the recruiter acts on row by row, not something to scroll.
          page, limit: 10, search: dq || undefined, applied_by: appliedBy || undefined,
          applied_from: appliedFrom || undefined, applied_to: appliedTo || undefined,
          dismissed: showDismissed ? 1 : undefined,
          phase: bucketPhase(stagePill),
          bucket: bucket === "live" ? undefined : bucket,
        })}`,
      );
      setRows(res.data || []);
      setMeta(res.meta);
      setStatusCounts(((res.meta as any)?.status_counts as StatusCounts | undefined) ?? null);
    } catch (e: any) {
      setError(e?.message || "Failed to load resumes");
    } finally {
      setLoading(false);
    }
  }, [req.id, page, dq, appliedBy, appliedFrom, appliedTo, showDismissed, stagePill, bucket]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [dq, appliedBy, appliedFrom, appliedTo, showDismissed, stagePill, bucket]);
  /* Switching bucket drops a stage chip the other list may not hold. */
  const pickBucket = (b: AppliedBucket) => { setBucket(b); if (stagePill !== "all") setStagePill("all", { replace: true }); };

  /* ATS runs by itself when a candidate is added (upload, bulk ZIP, Apply to
     Opportunity — 28 Sep 2026), so rows carry no "Run ATS Scan" button;
     "Score pending" below only catches up rows from before that. */
  const scanAll = async () => {
    setScanAllBusy(true);
    try {
      const res = await crmPost<any>(`/api/requirements/${req.id}/resumes/scan-all`);
      toast(res.message || "Scan complete");
      load();
    } catch (e: any) {
      toast(e?.message || "Scan-all failed", "err");
    } finally {
      setScanAllBusy(false);
    }
  };

  /** Email/WhatsApp the candidate a self-service interview-slot booking link. */
  /* Preview-then-confirm (user decision, 25 Aug 2026): clicking Slot invite
   * first shows EXACTLY what the candidate will receive — built by the same
   * server code as the send — plus how many open slots exist. Nothing goes
   * out until the TA confirms. */
  const [invitePreview, setInvitePreview] = useState<{
    row: ResumeRow;
    to_email?: string | null; to_phone?: string | null;
    subject: string; text: string; booking_url: string;
    open_slots: number; next_slot_at?: string | null;
    re_invite?: boolean;
  } | null>(null);

  const openSlotInvite = async (r: ResumeRow) => {
    setInviteBusyId(r.id);
    try {
      const res = await crmGet<any>(`/api/resumes/${r.id}/slot-invite-preview`);
      setInvitePreview({ row: r, ...res.data });
    } catch (e: any) {
      if (tplGate.showFromError(e?.message || "", req.id, r.candidate_name)) return;
      toast(e?.message || "Could not build the invite preview", "err");
    } finally {
      setInviteBusyId(null);
    }
  };

  const sendSlotInvite = async (r: ResumeRow) => {
    setInviteBusyId(r.id);
    try {
      const res = await crmPost<{
        booking?: { token?: string };
        notified?: {
          email?: { sent: boolean; error?: string | null };
          whatsapp?: { sent: boolean; error?: string | null };
        };
        /* The outbox row's REAL status after an immediate drain — "Sent" means
           SMTP accepted it; "Failed"/"Skipped" carry the actual error. */
        email_delivery?: { status: string; attempts: number; error?: string | null } | null;
      }>(`/api/resumes/${r.id}/send-slot-invite`);
      const d = res.data || {};
      const ed = d.email_delivery;
      if (ed?.status === "Failed" || ed?.status === "Skipped") {
        toast(`Email NOT delivered — ${ed.error || ed.status}. Check SMTP settings / Email Outbox.`, "err");
      } else if (ed?.status === "Queued" && ed.error) {
        toast(`Email stuck in queue — ${ed.error}. Fix SMTP settings, then use "Send queued now" in Settings → Operations.`, "err");
      } else if (ed?.status === "Sent") {
        toast("Slot invite emailed to the candidate", "ok");
      } else {
        const ch = d.notified || {};
        const anySent = !!(ch.email?.sent || ch.whatsapp?.sent);
        toast(res.message || (anySent ? "Slot invite sent" : "No channel delivered"), anySent ? "ok" : "err");
      }
      setInvitePreview(null);
      load();
    } catch (e: any) {
      if (tplGate.showFromError(e?.message || "", req.id, r.candidate_name)) { setInvitePreview(null); return; }
      toast(e?.message || "Failed to send slot invite", "err");
    } finally {
      setInviteBusyId(null);
    }
  };

  // ---- RMG decision actions (same flow as the profile's "RMG review needed"
  // banner), available right here on the requirement's resume rows. ----
  /* Which human round the schedule/feedback modals are acting on. The manual
     L1 and the L2 are the same form with a different label, so they share one
     set of state rather than a duplicated pair (1 Sep 2026). */
  type RoundKind = "L1" | "L2";
  const [f2fRow, setF2fRow] = useState<ResumeRow | null>(null);
  const [f2fRound, setF2fRound] = useState<RoundKind>("L2");
  const roundState = (r: ResumeRow, round: RoundKind) => (round === "L1"
    ? { requested: !!r.l1_manual_requested, scheduled: !!r.l1_manual_scheduled,
        eventId: r.l1_manual_event_id ?? null, result: r.l1_manual_result ?? null }
    : { requested: !!r.l2_requested, scheduled: !!r.l2_scheduled,
        eventId: r.l2_event_id ?? null, result: r.l2_result ?? null });
  const [rmgBusyId, setRmgBusyId] = useState<number | null>(null);
  /* RMG screening decisions right on this tab (25 Aug 2026) — same endpoint
   * as the Applicants tab, so RMG screens wherever they happen to be. */
  const [screenRow, setScreenRow] = useState<{ row: ResumeRow; profileId: number; kind: "shortlist" | "reject"; route?: ShortlistRoute } | null>(null);

  /* Decision modal (was window.prompt — can't show field errors, and some
   * browsers let users suppress prompts, silently killing the buttons). */
  const [rmgDecision, setRmgDecision] = useState<{ row: ResumeRow; kind: "sales" | "reject" } | null>(null);
  const [rmgComment, setRmgComment] = useState("");
  const [rmgCommentErr, setRmgCommentErr] = useState("");
  /* "Ask TA to collect the notice period" on Submit to Sales (2 Sep 2026,
     user request) — defaults to ticked when the row has none on record. */
  const [rmgAskNotice, setRmgAskNotice] = useState(true);
  /* Submit to Sales is pre-written from the interviews (28 Sep 2026) — the same
     note as the Screening Desk and the profile page (`useHandoverNote`). */
  const handover = useHandoverNote(rmgDecision?.row.profile_id, rmgDecision?.kind === "sales");
  useEffect(() => {
    if (rmgDecision?.kind === "sales" && handover.note) setRmgComment((c) => (c.trim() ? c : handover.note));
  }, [rmgDecision?.kind, handover.note]);

  const rmgTransition = (r: ResumeRow, kind: "sales" | "reject") => {
    if (!r.profile_id) return;
    setRmgDecision({ row: r, kind });
    setRmgCommentErr("");
    setRmgAskNotice(!(r.application_details?.notice_period || "").trim());
    setRmgComment("");
  };

  const submitRmgDecision = async () => {
    if (!rmgDecision?.row.profile_id) return;
    const isSales = rmgDecision.kind === "sales";
    if (rmgComment.trim().length < 5) {
      setRmgCommentErr(isSales
        ? "A comment of at least 5 characters is required"
        : "A rejection reason of at least 5 characters is required");
      return;
    }
    setRmgBusyId(rmgDecision.row.id);
    try {
      const res = await crmPost(`/api/candidate-profiles/${rmgDecision.row.profile_id}/status-transition`, {
        new_status: isSales ? "Sales_Screening" : "RMG_Rejected",
        comment: rmgComment.trim(),
        ask_notice_period: isSales && rmgAskNotice,
      });
      toast(res.message || (isSales ? "Submitted to Sales team" : "Candidate rejected"));
      setRmgDecision(null);
      load();
    } catch (e: any) {
      toast(e?.message || "Transition failed", "err");
    } finally {
      setRmgBusyId(null);
    }
  };

  /** RMG → TA handoff (27 Aug 2026): RMG no longer fills the schedule form —
   * one click notifies the TA owner, TA schedules, RMG is informed. */
  const requestRound = async (r: ResumeRow, round: RoundKind) => {
    if (!r.profile_id) return;
    setRmgBusyId(r.id);
    try {
      const res = await crmPost(`/api/candidate-profiles/${r.profile_id}/l2-request`, { round });
      toast(res.message || `TA notified — they will schedule the ${round} with the candidate`);
      // One-shot: lock the button immediately (server flag covers reloads).
      setRows((prev) => prev.map((x) => (x.id === r.id
        ? { ...x, ...(round === "L1" ? { l1_manual_requested: true } : { l2_requested: true }) }
        : x)));
    } catch (e: any) {
      toast(e?.message || `Failed to request the ${round} round`, "err");
    } finally {
      setRmgBusyId(null);
    }
  };

  /* RMG's "go manual" decision (1 Sep 2026, user flow): skip the AI screen AND
     ask TA for a human L1 in one click, so the candidate never lands in RMG
     Review with nobody sure whose move it is. RMG-only, by design. */
  const [manualRow, setManualRow] = useState<ResumeRow | null>(null);   // → GoManualModal
  /* After a finished AI L1 — proceed / hold / release (7 Oct 2026). */
  const [aiAfterRow, setAiAfterRow] = useState<{ row: ResumeRow; profileId: number; decision: AiL1Decision } | null>(null);

  /* L2 feedback (28 Aug 2026, user request): RMG records the round's outcome
     right from the row. Saves onto the L2 InterviewEvent — the same record
     the candidate profile's Interviews tab renders, so it reflects there. */
  const [l2FbRow, setL2FbRow] = useState<ResumeRow | null>(null);
  const [l2FbRound, setL2FbRound] = useState<RoundKind>("L2");
  const [l2FbResult, setL2FbResult] = useState("");
  const [l2FbNote, setL2FbNote] = useState("");
  const [l2FbErr, setL2FbErr] = useState("");
  const [l2FbBusy, setL2FbBusy] = useState(false);

  const openFeedback = (r: ResumeRow, round: RoundKind) => {
    setL2FbRow(r); setL2FbRound(round);
    setL2FbResult(""); setL2FbNote(""); setL2FbErr("");
  };

  const submitL2Feedback = async () => {
    const eventId = l2FbRow ? roundState(l2FbRow, l2FbRound).eventId : null;
    if (!l2FbRow?.profile_id || !eventId) return;
    if (!l2FbResult) { setL2FbErr(`Pick the ${l2FbRound} result`); return; }
    if (l2FbNote.trim().length < 5) { setL2FbErr("Feedback of at least 5 characters is required"); return; }
    setL2FbBusy(true);
    try {
      const res = await crmPut(
        `/api/candidate-profiles/${l2FbRow.profile_id}/interview-rounds/${eventId}`,
        { status: "Completed", result: l2FbResult, feedback: l2FbNote.trim(), user_role: "RMG" },
      );
      toast(res.message || `${l2FbRound} feedback recorded — visible on the candidate profile's Interviews tab`);
      setL2FbRow(null); setL2FbResult(""); setL2FbNote(""); setL2FbErr("");
      load();
    } catch (e: any) {
      setL2FbErr(e?.message || "Failed to save feedback");
    } finally {
      setL2FbBusy(false);
    }
  };

  const doDelete = async () => {
    if (!deleteRow) return;
    setBusyId(deleteRow.id);
    try {
      /* Profile-only rows have a NEGATIVE synthetic id and no resume to
         delete (1 Sep 2026) — remove the APPLICATION instead, which is what
         the row actually represents. */
      const isProfileOnly = !!deleteRow.is_profile_only || deleteRow.id < 0;
      const res = isProfileOnly
        ? await crmDelete(`/api/candidate-profiles/${deleteRow.profile_id}`)
        : await crmDelete(`/api/resumes/${deleteRow.id}`);
      toast(res.message || (isProfileOnly ? "Application deleted" : "Resume deleted"));
      setDeleteRow(null);
      load();
      onRequirementChanged();
    } catch (e: any) {
      toast(e?.message || "Delete failed", "err");
    } finally {
      setBusyId(null);
    }
  };

  const doReject = async () => {
    if (!rejectRow) return;
    setBusyId(rejectRow.id);
    try {
      const res = await crmPost(`/api/resumes/${rejectRow.id}/reject`);
      toast(res.message || "Resume rejected");
      setRejectRow(null);
      load();
    } catch (e: any) {
      toast(e?.message || "Reject failed", "err");
    } finally {
      setBusyId(null);
    }
  };

  const doSchedule = async () => {
    if (!scheduleRow) return;
    const r = scheduleRow;
    setBusyId(r.id);
    try {
      const scheduled_at = scheduleWhen ? scheduleWhen.replace("T", " ").slice(0, 16) : undefined;
      const res = await crmPost<any>(`/api/resumes/${r.id}/schedule-ai-interview`, { scheduled_at });
      toast(res.message || "AI L1 invite ready to share");
      if (res.data?.profile_id) {
        setProfileByResume((m) => ({ ...m, [r.id]: res.data.profile_id }));
      }
      setScheduleRow(null);
      setInviteOpenId(r.id);
      await load();
    } catch (e: any) {
      if (tplGate.showFromError(e?.message || "", req.id, r.candidate_name)) { setScheduleRow(null); return; }
      toast(e?.message || "Scheduling failed", "err");
    } finally {
      setBusyId(null);
    }
  };

  const copyInvite = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label} copied`);
    } catch {
      toast("Copy failed — select and copy manually", "err");
    }
  };

  /* TA-reviewed AI-L1 invite (25 Aug 2026): prefill → edit → confirm → send. */
  const [l1Invite, setL1Invite] = useState<{ row: ResumeRow; subject: string; body: string } | null>(null);
  const [l1InviteBusy, setL1InviteBusy] = useState(false);

  const sendL1Invite = async () => {
    if (!l1Invite) return;
    if (!l1Invite.subject.trim() || l1Invite.body.trim().length < 10) {
      toast("Subject and message are required", "err");
      return;
    }
    setL1InviteBusy(true);
    try {
      const res = await crmPost(`/api/resumes/${l1Invite.row.id}/send-interview-invite`, {
        subject: l1Invite.subject.trim(),
        message: l1Invite.body.trim(),
      });
      toast(res.message || "AI L1 invite sent");
      setL1Invite(null);
    } catch (e: any) {
      toast(e?.message || "Send failed", "err");
    } finally {
      setL1InviteBusy(false);
    }
  };

  const buildInviteEmail = (r: ResumeRow): string => {
    const when = fmtDateTime(r.ai_interview_scheduled_at);
    const role = req.title || "the role";
    let body =
      `Hello ${r.candidate_name},\n\n` +
      `Your AI interview for "${role}" is scheduled.\n` +
      `When: ${when}\n\n`;
    if (r.ai_invite_url) {
      body += `Open this link to start your interview:\n${r.ai_invite_url}\n\n`;
    }
    if (r.ai_access_key) {
      body +=
        `Your Secure Access Key: ${r.ai_access_key}\n` +
        `You will need your registered email (${r.email || "your email"}) and this key to enter the interview.\n` +
        `Do NOT share these credentials with anyone.\n\n`;
    }
    body += "— Karnex Recruitment Team\n";
    return body;
  };

  const pendingOnPage = rows.filter((r) => r.ats_status === "Pending_Scan").length;
  const canUpload = isTA && SOURCING_STATUSES.includes(req.status);
  /* A closed candidacy (any rejection / withdrawn / joined) gets no more
     round buttons (7 Sep 2026): the stage checks below already exclude
     these, but the guard is explicit so a future stage value cannot
     resurrect "Schedule Customer L2" on a rejected row. */
  const profileClosed = (r: { profile_pipeline_status?: string | null }) =>
    /rejected|withdrawn|^joined$/i.test(String(r.profile_pipeline_status || ""));
  /* Minimal existing-round object so the round modal edits the booked
     customer slot (adds the link) instead of creating a second round. */
  const custEventStub = (id: number | null | undefined, kind: string, when: string | null | undefined) =>
    id == null ? null : {
      id, kind, scheduled_at: when ?? null, raw_when: null, meeting_link: null, stage: null, mode: null,
      status: "Scheduled", result: null, interviewer: null, feedback: null, interview_category: "External",
      duration_minutes: null, user_role: "Customer", employee_id: null, note: null, created_at: null,
    };
  /* The customer's slots Sales passed on (29 Sep 2026): a "Sales slots (N)"
     button beside Schedule opens a small pop-up with every slot, link, panel
     and note — and can open the Schedule form, where they are one-click picks.
     Only an offer for THIS round. */
  const slotHint = (r: ResumeRow, kind: string) => (
    <SalesSlotsButton offer={r.customer_slots} kind={kind}
      onSchedule={() => setRoundModal({ row: r, kind })} />
  );
  const columns: Column<ResumeRow>[] = [
    {
      key: "candidate_name", label: "Candidate",
      render: (r) => {
        const hasInvite = !!(r.ai_invite_url || r.ai_access_key);
        const inviteOpen = inviteOpenId === r.id;
        return (
          <div>
            <div className="flex flex-wrap items-center gap-1.5 font-semibold text-primary">
              {r.candidate_name}
              {/* Persisted duplicate hold — survives the bulk results dialog,
                  so the review queue is always findable from this list. */}
              {r.possible_duplicate_of != null && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                  title="Bulk upload matched an existing candidate by email/phone — not applied yet. Use Apply / Dismiss to resolve.">
                  Possible duplicate
                </span>
              )}
            </div>
            {(r.email || r.phone) && (
              <div className="text-xs text-muted">
                {[r.email, r.phone].filter(Boolean).join(" · ")}
              </div>
            )}
            {(r.applicant_experience || r.application_details) && (
              <div className="mt-1 max-w-xs text-xs leading-relaxed text-muted">
                <div>
                  {[
                    r.applicant_experience ? `Exp ${r.applicant_experience}y` : null,
                    r.application_details?.notice_period ? `Notice ${r.application_details.notice_period}` : null,
                    r.application_details?.current_ctc ? `CTC ${r.application_details.current_ctc}` : null,
                    r.application_details?.expected_ctc ? `Exp. ${r.application_details.expected_ctc}` : null,
                    r.application_details?.current_location ? `Lives in ${r.application_details.current_location}` : null,
                    r.application_details?.preferred_location ? `📍 ${r.application_details.preferred_location}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {r.application_details?.note && (
                  <div className="mt-0.5 line-clamp-2 rounded-control bg-amber-50 px-1.5 py-0.5 text-amber-900 dark:bg-amber-950 dark:text-amber-200" title={r.application_details.note}>
                    TA note: {r.application_details.note}
                  </div>
                )}
                {r.application_details?.skills && (
                  <div className="truncate" title={r.application_details.skills}>
                    Skills: {r.application_details.skills}
                  </div>
                )}
              </div>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <FileLink url={r.resume_file_url} label="Resume" />
              {hasInvite && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                  onClick={(e) => {
                    e.stopPropagation();
                    setInviteOpenId(inviteOpen ? null : r.id);
                  }}
                >
                  <Link2 size={12} />
                  {inviteOpen ? "Hide invite" : "Invite details"}
                </button>
              )}
            </div>
            {inviteOpen && hasInvite && (
              <div
                className="mt-2 max-w-md space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs dark:border-emerald-800 dark:bg-emerald-950/40"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden />
                    AI L1 invite — share manually
                  </div>
                  <button
                    type="button"
                    className={btnSecondary}
                    onClick={() => copyInvite(buildInviteEmail(r), "Email message")}
                    title="Copy a ready-to-paste email for the candidate"
                  >
                    <Copy size={13} /> Copy email
                  </button>
                </div>
                <div>
                  <div className="font-semibold text-muted">Name</div>
                  <div className="font-semibold text-primary">{r.candidate_name}</div>
                </div>
                <div>
                  <div className="font-semibold text-muted">Email</div>
                  <div className="text-primary">{r.email || "—"}</div>
                </div>
                <div>
                  <div className="font-semibold text-muted">Time</div>
                  <div className="text-primary">
                    {fmtDateTime(r.ai_interview_scheduled_at)}
                  </div>
                </div>
                {r.ai_invite_url && (
                  <div>
                    <div className="mb-1 font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                      Invite link
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="max-w-[14rem] truncate rounded-lg border border-emerald-200 dark:border-emerald-800 bg-surface-1 px-2 py-1 font-mono text-xs">
                        {r.ai_invite_url}
                      </span>
                      <button
                        type="button"
                        className={btnSecondary}
                        onClick={() => copyInvite(r.ai_invite_url!, "Invite link")}
                      >
                        <Copy size={13} /> Copy
                      </button>
                    </div>
                  </div>
                )}
                {r.ai_access_key && (
                  <div>
                    <div className="mb-1 font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                      Access key
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-surface-1 px-2 py-1 font-mono text-sm font-bold tracking-wider">
                        {r.ai_access_key}
                      </span>
                      <button
                        type="button"
                        className={btnSecondary}
                        onClick={() => copyInvite(r.ai_access_key!, "Access key")}
                      >
                        <Copy size={13} /> Copy
                      </button>
                    </div>
                  </div>
                )}
                <div>
                  <div className="mb-1 font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                    Email preview
                  </div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-emerald-200 dark:border-emerald-800 bg-surface-1 p-2 font-sans text-xs leading-relaxed text-primary">
                    {buildInviteEmail(r)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        );
      },
    },
    /* The "Source" column was removed for every role on 30 Sep 2026 (user request). */
    { key: "applied_by", label: "Applied by",
      render: (r) => <span className="text-secondary">{r.applied_by || "—"}</span> },
    /* The "RMG Screening" column was removed 30 Sep 2026 (user request) — the
       Stage + Status columns already say it; the badge stays on the Applicants tab. */
    /* ONE column for where the candidate IS: the derived candidate status
       (25 Sep 2026) — "Manual L1 – Scheduled", "Customer L2 – Passed",
       "HR Discussion"… — the same words as the Candidate Profiles list. It
       replaces the hand-built "L2 Scheduled / L2: Hire" pills, which only
       covered the L2 and read differently from every other screen. */
    /* STATUS (28 Sep 2026, user request): what is happening to the candidate —
       the round, its state, its date, who took it and how long they have
       waited — all server-derived (B-V2 `candidate_status.derive_status`).
       The round's name opens the interviews pop-up (30 Sep 2026). */
    { key: "profile_stage", label: "Stage", render: (r) => <CandidateStageBadge status={r.profile_status} /> },
    { key: "profile_pipeline_status", label: "Status",
      render: (r) => {
        const profileId = r.profile_id ?? profileByResume[r.id];
        /* An archived candidacy is closed — nobody is waiting on it. */
        const waitingDays = bucket === "live" && !profileClosed(r) ? r.waiting_days : null;
        return (
          <div className="flex flex-col items-start gap-1">
            {r.profile_status?.round
              ? <CandidateRoundStatus status={r.profile_status} row={r as unknown as Record<string, unknown>}
                  waitingDays={waitingDays} waitingSince={r.waiting_since}
                  onOpen={profileId != null ? () => setRoundsRow({ row: r, profileId }) : undefined} />
              : (
                <>
                  <CandidateStatusBadge status={r.profile_status} stage={r.profile_pipeline_status} />
                  <WaitingChip days={waitingDays} since={r.waiting_since} />
                </>
              )}
            {r.over_budget && <OverBudgetChip expected={r.expected_ctc} budget={r.budget_ctc_max} />}
            <OpeningMailChip mail={r.opening_mail} />
            {/* Why the candidacy was closed, by whom (1 Oct 2026, user rule). */}
            {r.closed_note && <ClosedNoteBox note={r.closed_note} compact />}
          </div>
        );
      } },
    { key: "availability", label: "Availability", render: (r) => <AvailabilityCell row={r} /> },
    { key: "received_date", label: "Received", render: (r) => fmtDate(r.received_date || r.created_at) },
    { key: "ats_score", label: "ATS Score", render: (r) => <ScorePill row={r} onClick={() => setBreakdownRow(r)} /> },
    {
      key: "ai_interview_status", label: "Interview",
      render: (r) => {
        const profileId = r.profile_id ?? profileByResume[r.id];
        const score = r.ai_overall_score_percent;
        const showReport = canOpenAiReport && !!r.ai_report_link;
        // A recruiter's decision on the report page outranks the AI's own
        // score-threshold verdict. Show theirs, and keep the AI's beside it —
        // this column used to show only the raw verdict, so a candidate already
        // marked Selected still read "Failed 57.2%".
        // A recorded score on a "Not_Scheduled" row = the interview HAPPENED
        // on an earlier link — say "Completed", not "Not Scheduled" (28 Aug
        // 2026, user report: done candidates read as never scheduled).
        const rawStatus = r.ai_interview_status && r.ai_interview_status !== "Not_Scheduled"
          ? r.ai_interview_status
          : score != null ? "Completed" : "Not_Scheduled";
        const status = r.ai_hr_decision_label || rawStatus;
        /* MANUAL ROUTE (1 Sep 2026): RMG chose a human L1 for this candidate,
           so "Not Scheduled" is not a gap waiting to be filled — it is the
           decision. Say so, and show the manual round's own state instead. */
        const manual = !!(r.l1_manual_requested || r.l1_manual_scheduled);
        if (manual && score == null) {
          /* The human rounds live behind one button (28 Sep 2026, user ask):
             every round's feedback in a pop-up, no trip to the profile. */
          return (
            <div className="flex flex-col items-start gap-1.5" onClick={(e) => e.stopPropagation()}>
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                title="RMG / GM chose a human L1 for this candidate instead of the AI interview">
                <UsersRound size={11} /> Manual route
              </span>
              {profileId != null && (
                <button type="button" className={FLOW_BTN.manualOutline}
                  onClick={() => setRoundsRow({ row: r, profileId })}
                  title="Every interview and its feedback">
                  <ClipboardCheck size={13} /> Interviews ({r.rounds_booked ?? 0})
                </button>
              )}
            </div>
          );
        }
        /* No route chosen yet: nothing to show — the AI column is only about
           an AI interview that exists or was asked for. */
        if (score == null && (!r.ai_interview_status || r.ai_interview_status === "Not_Scheduled")
          && !r.ai_l1_requested && !r.ai_hr_decision_label) {
          return <span className="text-muted">—</span>;
        }
        if (score == null && r.ai_l1_requested && (!r.ai_interview_status || r.ai_interview_status === "Not_Scheduled")) {
          return (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
              title="RMG / GM chose the AI L1 — TA schedules it">
              <Bot size={11} /> AI L1 — to schedule
            </span>
          );
        }
        return (
          <div className="flex flex-col items-start gap-1" onClick={(e) => e.stopPropagation()}>
            <span className="inline-flex flex-wrap items-center gap-1.5">
              {/* "Never happened" is not "Failed" (7 Oct 2026): a not-attempted
                  AI L1 shows as such, with no score — there is nothing to score. */}
              {r.ai_not_attempted && !r.ai_is_overridden ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                  title="The candidate did not answer any question — the link was opened late, the session dropped, or it was never started. Reschedule once they confirm they will attempt it.">
                  <AlertTriangle size={11} /> Not attempted
                </span>
              ) : (
                <>
                  <StatusBadge status={status} />
                  {score != null && Number.isFinite(Number(score)) && (
                    <span
                      className="inline-flex items-center rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-bold tabular-nums text-primary"
                      title="AI L1 overall score"
                    >
                      {Number(score) % 1 === 0 ? Number(score) : Number(score).toFixed(1)}%
                    </span>
                  )}
                </>
              )}
            </span>
            {/* The CHOSEN SLOT time — the TA could not see which slot the
                candidate picked without opening the Interview Slots tab. */}
            {r.ai_interview_scheduled_at && (
              <span className="text-[11px] font-semibold tabular-nums text-secondary"
                title="Interview time the candidate booked">
                {fmtDateTime(r.ai_interview_scheduled_at)}
              </span>
            )}
            {r.ai_is_overridden && (
              <span
                className="text-[11px] text-muted"
                title={`A recruiter marked this ${r.ai_hr_decision_label}. The AI recorded ${r.ai_interview_result}.`}
              >
                AI: {r.ai_not_attempted ? "Not attempted" : r.ai_interview_result}
              </span>
            )}
            {showReport && (
              <a
                href={r.ai_report_link!}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-sky-600 hover:underline dark:text-sky-400"
                title="Open candidate AI interview report"
              >
                <ExternalLink size={12} /> View report
              </a>
            )}
          </div>
        );
      },
    },
    /* Every human round's verdict, for EVERY login (7 Sep 2026, user request):
       L1 / L2 (RMG), Customer L1 / L2, HR — the same chips the profile's
       Interviews tab shows, so a rejection at any round is visible in the
       list without opening the profile. */
    {
      key: "rounds", label: "Rounds",
      render: (r) => {
        const profileId = r.profile_id ?? profileByResume[r.id];
        const booked = r.rounds_booked ?? 0;
        const done = r.rounds_done ?? 0;
        const chips: { label: string; result: string | null | undefined; scheduled: boolean; requested: boolean }[] = [
          { label: "AI L1", result: r.ai_overall_score_percent != null
            ? (r.ai_not_attempted && !r.ai_is_overridden ? "Not attempted" : (r.ai_effective_result || r.ai_interview_result || "Done")) : null,
            scheduled: !!r.ai_interview_status && r.ai_interview_status !== "Not_Scheduled", requested: !!r.ai_l1_requested },
          { label: "L1", result: r.l1_manual_result, scheduled: !!r.l1_manual_scheduled, requested: !!r.l1_manual_requested },
          { label: "L2", result: r.l2_result, scheduled: !!r.l2_scheduled, requested: !!r.l2_requested },
          { label: "Cust L1", result: r.cust_l1_result, scheduled: !!r.cust_l1_scheduled, requested: false },
          { label: "Cust L2", result: r.cust_l2_result, scheduled: !!r.cust_l2_scheduled, requested: false },
          { label: "HR", result: r.hr_result, scheduled: !!r.hr_scheduled, requested: !!r.hr_requested },
        ].filter((c) => c.result || c.scheduled || c.requested);
        if (booked === 0 && chips.length === 0) return <span className="text-muted">—</span>;
        const body = (
          <>
            {/* How many rounds this candidate has sat, of those booked. */}
            <span className="text-xs font-bold text-primary">
              {done} of {booked} round{booked === 1 ? "" : "s"} done
            </span>
            <span className="flex max-w-[220px] flex-wrap gap-1">
              {chips.map((c) => (
                <span key={c.label}
                  className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ring-subtle ${roundResultTone(c.result)}`}
                  title={c.result ? `${c.label} verdict: ${c.result}` : c.scheduled ? `${c.label} scheduled — awaiting feedback` : `${c.label} requested — TA scheduling`}>
                  {c.label}: {c.result || (c.scheduled ? "Scheduled" : "Requested")}
                </span>
              ))}
            </span>
          </>
        );
        /* The whole cell opens every round's feedback (28 Sep 2026). */
        return profileId != null ? (
          <button type="button" onClick={(e) => { e.stopPropagation(); setRoundsRow({ row: r, profileId }); }}
            className="flex flex-col items-start gap-1 rounded-control p-1 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:shadow-focus-ring"
            title="See each interview and its feedback">
            {body}
          </button>
        ) : <div className="flex flex-col items-start gap-1">{body}</div>;
      },
    },
    {
      key: "_actions", label: "Actions",
      render: (r) => {
        const busy = busyId === r.id;
        const profileId = r.profile_id ?? profileByResume[r.id];
        /* RMG's part is over once the candidate is with Sales (2 Sep 2026,
           user request): the row used to go blank, which read as "nothing
           happened". Show what RMG did, greyed, so the history is legible
           without offering buttons that would now be wrong. */
        const rmgDone = !!r.profile_pipeline_status
          && !["Sourcing", "Technical_Screening", "RMG_Review"].includes(r.profile_pipeline_status);
        const doneChip = (label: string, title: string) => (
          <span key={label} className={FLOW_DONE_CHIP} title={title}>
            {label}
          </span>
        );
        /* A closed candidacy (rejected at any round / withdrawn / joined) gets
           NO decision buttons in any login (7 Sep 2026, user request) — just
           the profile link, plus Delete for TA housekeeping. */
        if (profileClosed(r)) {
          return (
            <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
              {doneChip(r.profile_status?.label || statusLabel(String(r.profile_pipeline_status)),
                isClosedCandidacy(r.profile_pipeline_status)
                  ? "This candidacy is closed — Re-apply reopens it"
                  : "This candidacy is closed — no further actions")}
              {/* A closed candidate can come back (1 Oct 2026, user ask):
                  TA re-applies them to this opportunity from the row — a
                  rejection asks why. */}
              {isTA && profileId != null && isClosedCandidacy(r.profile_pipeline_status) && (
                <TaFlowButtons decisions={taDecisionsFor(r)} disabled={busy}
                  onPick={(decision) => setTaPick({ row: r, profileId, decision })} />
              )}
              {profileId != null && (
                <button className={FLOW_BTN.view} onClick={() => crmNavigate(`profiles/${profileId}`)}>
                  <ExternalLink size={13} /> View profile
                </button>
              )}
              {/* Manual Archive (30 Sep 2026, user rule): nobody is moved to
                  Archive on their own — RMG / GM press it once the candidate
                  is rejected / withdrawn, and Restore brings them back. */}
              {/* RMG / GM archive any stage; a TA only a rejected / withdrawn candidate (6 Oct 2026). */}
              {profileId != null && (r.archivable || r.archived)
                && (isRmg || (isTA && isRejectedRow(r))) && (
                <button className={r.archived ? FLOW_BTN.view : FLOW_BTN.neutral}
                  disabled={busy || archivingId === profileId}
                  onClick={() => void setArchived(profileId, !r.archived)}
                  title={r.archived ? "Bring the candidate back to Applied Candidates" : "Move this rejected candidate to the Archive tab"}>
                  {r.archived ? <><RotateCcw size={13} /> Restore</> : <><Archive size={13} /> Archive</>}
                </button>
              )}
              {isTA && (
                <button className={FLOW_BTN.delete} onClick={() => setDeleteRow(r)} disabled={busy} title="Delete this resume/application">
                  <Trash2 size={13} /> Delete
                </button>
              )}
            </div>
          );
        }
        /* Did the L1 end in a verdict (manual feedback or a finished AI
           interview)? The L2 is asked for only after it (28 Sep 2026). */
        const hasL1Verdict = !!r.l1_manual_result || r.ai_overall_score_percent != null;
        const aiL1Open = (!r.ai_interview_status || r.ai_interview_status === "Not_Scheduled")
          && r.ai_overall_score_percent == null;
        const manualRoute = !!(r.l1_manual_requested || r.l1_manual_scheduled);
        const preReview = ["Sourcing", "Technical_Screening"].includes(String(r.profile_pipeline_status));
        return (
          <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
            {/* TA's own calls on the candidate (28 Sep 2026): Technical Screening
                hands them to RMG / GM; Hold · Reject · Self Withdraw. */}
            {isTA && profileId != null && (
              <TaFlowButtons decisions={taDecisionsFor(r)} disabled={busy}
                onPick={(decision) => setTaPick({ row: r, profileId, decision })} />
            )}
            {/* The opening email (1 Oct 2026): a bulk upload sends it; here TA
                sends it for any other Sourcing row, or resends it after
                correcting the address. Only with a real address. */}
            {isTA && profileId != null && realEmail(r.email)
              && taDecisionsFor(r).some((d) => d === "screen" || d === "interested")
              && (!r.opening_mail || r.opening_mail.state === "sent") && (
              <SendOpeningMailButton profileId={profileId} resend={r.opening_mail?.state === "sent"}
                disabled={busy}
                onDone={(m, ok) => { toast(m, ok ? undefined : "err"); if (ok) void load(); }} />
            )}
            {/* A candidate RMG / GM rejected at screening stays at the TA stage, so it
                never reaches the closed branch above — Archive it from here (6 Oct 2026). */}
            {profileId != null && (r.archivable || r.archived) && (isRmg || isTA)
              && r.rmg_screening_status === "Rejected" && (
              <button className={r.archived ? FLOW_BTN.view : FLOW_BTN.neutral}
                disabled={busy || archivingId === profileId}
                onClick={() => void setArchived(profileId, !r.archived)}
                title={r.archived ? "Bring the candidate back to Applied Candidates" : "Move this rejected candidate to the Archive tab"}>
                {r.archived ? <><RotateCcw size={13} /> Restore</> : <><Archive size={13} /> Archive</>}
              </button>
            )}
            {isRmg && rmgDone && (
              <>
                {(r.l1_manual_result || r.ai_overall_score_percent != null) &&
                  doneChip(r.l1_manual_result ? `L1: ${r.l1_manual_result} ✓` : "AI L1 ✓",
                    r.l1_manual_result ? "Manual L1 recorded" : "AI L1 interview completed")}
                {r.l2_result && doneChip(`L2: ${r.l2_result} ✓`, "L2 recorded")}
                {r.profile_pipeline_status === "RMG_Rejected"
                  ? doneChip("Rejected by RMG", "Closed at RMG review")
                  : doneChip("Submitted to Sales ✓", "RMG review complete — the candidate is with Sales now")}
              </>
            )}
            {/* The Sales → Sales Head gate, on the row (2 Sep 2026). */}
            {isSales && r.profile_id != null && r.profile_pipeline_status === "Shortlisted" && (
              <button
                className={`${smallPrimary} ${focusRing}`}
                onClick={() => setApprovalRow(r)}
                title="Enter the candidate's rate and customer onboarding date, then send to Sales Head"
              >
                <Send size={13} /> {r.latest_offer ? "Resubmit for approval" : "Submit for approval"}
              </button>
            )}
            {canDecideTerms && r.profile_id != null && r.profile_pipeline_status === "Customer_Approval" && (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {r.latest_offer && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-secondary"
                    title="The terms Sales submitted">
                    {r.latest_offer.ctc != null ? `${(r.latest_offer.ctc / 100000).toFixed(2)} L` : "—"}
                    {r.latest_offer.joining_date ? ` · onboarding ${fmtDate(r.latest_offer.joining_date)}` : ""}
                  </span>
                )}
                <button className={smallPrimary} onClick={() => setDecisionRow({ row: r, decision: "approve" })}
                  disabled={!r.latest_offer} title={r.latest_offer ? "Approve — moves to Pre Onboarding, HR notified" : "No offer on record — send back to Sales"}>
                  Approve
                </button>
                <button className={smallBtn} onClick={() => setDecisionRow({ row: r, decision: "send_back" })}
                  title="Send the terms back to Sales to redo">
                  Send back
                </button>
                <button className={smallDanger} onClick={() => setDecisionRow({ row: r, decision: "reject" })}>
                  Reject
                </button>
              </span>
            )}
            {(isSales || isSalesHead) && !isTA
              && ["HR_Screening", "HR_Interviewing", "Preboarding"].includes(r.profile_pipeline_status || "") && (
              r.budget_status === "Out_of_Budget"
                ? <span className="inline-flex cursor-default items-center rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                    title="HR flagged the candidate out of budget at Pre Onboarding — reply from the profile page">
                    Out of budget — reply to HR
                  </span>
                : doneChip("Approved ✓ — with HR",
                    r.profile_pipeline_status === "HR_Screening"
                      ? "Sales Head approved the terms; HR reviews and requests the HR round"
                      : r.profile_pipeline_status === "HR_Interviewing"
                        ? "The HR round is booked; HR records the verdict"
                        : "HR round done; HR is checking the budget and preboarding")
            )}
            {/* Held duplicate: resolve first — Apply (the EXISTING candidate)
                or Dismiss (keep the CV, don't apply). */}
            {isTA && r.possible_duplicate_of != null && (
              <>
                <button
                  className={smallPrimary}
                  disabled={busy}
                  title="Apply the existing matched candidate to this opportunity (no duplicate record)"
                  onClick={async () => {
                    setBusyId(r.id);
                    try {
                      const res = await crmPost(`/api/resumes/${r.id}/apply-duplicate`);
                      toast(res.message || "Existing candidate applied");
                      load();
                    } catch (e: any) {
                      toast(e?.message || "Apply failed", "err");
                    } finally { setBusyId(null); }
                  }}
                >
                  <UserPlus size={13} /> Apply duplicate
                </button>
                <button
                  className={smallBtn}
                  disabled={busy}
                  title="Keep the resume on file but do not apply this person"
                  onClick={async () => {
                    setBusyId(r.id);
                    try {
                      const res = await crmPost(`/api/resumes/${r.id}/dismiss-duplicate`);
                      toast(res.message || "Hold dismissed");
                      load();
                    } catch (e: any) {
                      toast(e?.message || "Dismiss failed", "err");
                    } finally { setBusyId(null); }
                  }}
                >
                  <X size={13} /> Dismiss
                </button>
              </>
            )}
            {/* RMG screening decision, right here where RMG reviews resumes. */}
            {canScreen && r.rmg_screening_status === "Pending" && profileId != null && (
              <>
                {/* The CV opens from the "Resume" link under the candidate name — the
                    second "View resume" button here was removed (6 Oct 2026, user request). */}
                {/* Shortlist + route in ONE click, as on the Screening Desk (7 Oct 2026). */}
                <button
                  className={FLOW_BTN.ai}
                  onClick={() => { setScreenRow({ row: r, profileId, kind: "shortlist", route: "ai" }); }}
                  title="The candidate fits — shortlist for the AI L1 (TA schedules it)"
                >
                  <Bot size={13} /> Shortlist for AI round
                </button>
                <button
                  className={FLOW_BTN.manual}
                  onClick={() => { setScreenRow({ row: r, profileId, kind: "shortlist", route: "manual" }); }}
                  title="The candidate fits — shortlist for a manual Technical L1 (TA books it)"
                >
                  <UsersRound size={13} /> Shortlist for manual L1
                </button>
                <button
                  className={smallDanger}
                  onClick={() => { setScreenRow({ row: r, profileId, kind: "reject" }); }}
                  title="Not a fit for this opportunity (note required) — the TA is notified"
                >
                  <X size={13} /> Reject
                </button>
              </>
            )}
            {/* Screening Desk parity (7 Oct 2026, user ask): RMG / GM send a strong
                match straight to Sales (or fast-track an internal employee) and
                mark finished interviews reviewed — without opening the desk. */}
            {canScreen && profileId != null && !r.archived && r.direct_to_sales_block == null && (
              r.internal_employee ? (
                <FastTrackButton profileId={profileId} candidateName={r.candidate_name}
                  employee={r.internal_employee} block={r.fast_track_block ?? null}
                  className={FLOW_BTN.success}
                  onDone={(m) => { toast(m); load(); }} onError={(m) => toast(m, "err")} />
              ) : r.profile_pipeline_status !== "RMG_Review" ? (
                <DirectToSalesButton profileId={profileId} candidateName={r.candidate_name}
                  context={req.title} block={r.direct_to_sales_block} className={FLOW_BTN.success}
                  onDone={(m) => { toast(m); load(); }} />
              ) : null
            )}
            {canScreen && profileId != null && (r.new_results || []).length > 0 && (
              <ResultsReviewBanner compact profileId={profileId} results={r.new_results}
                onReviewed={(m) => { toast(m); load(); }} onError={(m) => toast(m, "err")} />
            )}
            {/* A resume with no candidacy yet (e.g. a held duplicate) can
                still be rejected as a file; everything else goes through TA's
                candidate buttons above. */}
            {isTA && profileId == null && !r.is_profile_only && r.ats_status !== "Rejected" && (
              <button className={smallDanger} onClick={() => setRejectRow(r)} disabled={busy}>
                <X size={13} /> Reject resume
              </button>
            )}
            {/* Slot booked → the invite email becomes the next action: TA
                reviews/edits the exact wording, then confirms the send. */}
            {isTA && r.ai_interview_status === "Scheduled" && (r.ai_invite_url || r.ai_access_key) && (
              <button
                className={smallPrimary}
                onClick={() => setL1Invite({
                  row: r,
                  subject: `Your AI interview — ${req.title}`,
                  body: buildInviteEmail(r),
                })}
                title="Review and send the AI L1 interview invite email"
              >
                <Send size={13} /> Send AI L1 invite
              </button>
            )}
            {/* Slot invite's job ends once the AI L1 is scheduled or done —
                keeping the button after that only invited double-bookings
                (27 Aug 2026, user report). A recorded score also hides it,
                covering sessions completed on an earlier link. */}
            {isTA && !r.is_profile_only && r.ai_l1_requested
              && (!r.ai_interview_status || r.ai_interview_status === "Not_Scheduled")
              && !r.l1_manual_requested && !r.l1_manual_scheduled
              /* Past the AI stage (RMG Review onwards) the booking link is
                 only confusing — the server refuses it too (3 Sep 2026). */
              && ["Sourcing", "Technical_Screening", null, undefined].includes(r.profile_pipeline_status as any)
              && r.ai_overall_score_percent == null && (
              <button
                className={FLOW_BTN.aiOutline}
                onClick={() => void tplGate.gate({ requirementId: req.id }, () => void openSlotInvite(r), r.candidate_name)}
                disabled={busy || inviteBusyId === r.id || (!r.email && !r.phone)}
                title={
                  !r.email && !r.phone
                    ? "No email or phone on file — add contact info to send a slot invite"
                    : "Email/WhatsApp the candidate a link to book an interview slot"
                }
              >
                <CalendarPlus size={13} />{" "}
                {inviteBusyId === r.id ? "Sending…" : "Slot invite"}
              </button>
            )}
            {/* TA schedules the AI L1 once RMG / GM chose it (28 Sep 2026, user
                flow). Profile-only rows schedule through the profile. */}
            {isTA && r.ai_l1_requested && aiL1Open && !manualRoute && preReview && (
              <button className={FLOW_BTN.ai} disabled={busy}
                onClick={() => {
                  // Profile-only rows check inside ScheduleAiInterviewModal.
                  if (r.is_profile_only) setProfileScheduleRow(r);
                  else void tplGate.gate({ requirementId: req.id },
                    () => { setScheduleWhen(""); setScheduleRow(r); }, r.candidate_name);
                }}
                title="RMG / GM chose the AI L1 — agree a time with the candidate and schedule it">
                <Bot size={13} /> {busy ? "Scheduling…" : "Schedule AI L1"}
              </button>
            )}
            {profileId != null && (
              <button className={FLOW_BTN.view} onClick={() => crmNavigate(`profiles/${profileId}`)}>
                <ExternalLink size={13} /> View profile
              </button>
            )}
            {/* The interview ROUTE (28 Sep 2026, user flow): after the shortlist
                RMG / GM choose — AI L1 or Manual L1 — and TA is told which to
                schedule. The choice is open until one is taken. */}
            {isRmg && profileId != null && r.rmg_screening_status === "Shortlisted" && preReview
              && aiL1Open && !manualRoute && !r.ai_l1_requested && (
              <>
                <button className={FLOW_BTN.ai} onClick={() => setAiRouteRow({ row: r, profileId })}
                  title="Choose the AI L1 interview — TA schedules it">
                  <Bot size={13} /> AI L1
                </button>
                <button className={FLOW_BTN.manual} onClick={() => setManualRow(r)}
                  title="Skip the AI interview — TA arranges a human L1 round">
                  <UsersRound size={13} /> Manual L1
                </button>
              </>
            )}
            {isRmg && !isTA && r.ai_l1_requested && aiL1Open && preReview
              && doneChip("AI L1 chosen — TA scheduling", "TA is agreeing a time with the candidate")}
            {/* Reschedule AI L1 (7 Oct 2026, user flow): the first link was not
                attempted (or not cleared), the candidate confirmed they are ready,
                TA sends a fresh link — TA ONLY (user decision): RMG / GM decide
                (proceed · manual L1 · hold · reject), TA owns the scheduling.
                Never over a pass; never once the candidate moved on to a manual
                L1 or past the review. */}
            {isTA && profileId != null && preReview && !aiL1Open && !manualRoute && !r.archived
              && reschedulableAi(r) && (
              <button className={FLOW_BTN.aiOutline} disabled={busy}
                onClick={() => setRescheduleRow({ row: r, seed: rescheduleSeed(r) })}
                title={r.ai_not_attempted
                  ? "The candidate did not attempt the AI L1 — once they confirm they are ready, send a fresh link"
                  : "Send a fresh AI L1 link — the previous result stays on record"}>
                <RotateCcw size={13} /> Reschedule AI L1
              </button>
            )}
            {/* The AI L1 exists (7 Oct 2026, user report — "RMG / GM get no buttons"):
                while it is still to run, RMG / GM may switch to a manual L1 or
                send the candidate on; once it has FINISHED without a pass (Failed,
                or a recruiter's On Hold) the AI verdict is advice — proceed to the
                review anyway (L2 / Submit to Sales), park, or reject. A PASS is
                auto-forwarded to RMG Review by the server, so it never lands here. */}
            {isRmg && profileId != null && preReview && !aiL1Open && !manualRoute && !r.archived && (() => {
              const effective = r.ai_effective_result || r.ai_interview_result || null;
              const finished = r.ai_overall_score_percent != null
                || (!!r.ai_interview_status && !["Scheduled", "Pending", "In_Progress", "Not_Scheduled"].includes(r.ai_interview_status));
              const onHold = effective === "On Hold";
              const open = (d: AiL1Decision) => setAiAfterRow({ row: r, profileId, decision: d });
              return (
                <>
                  {!finished && doneChip(
                    r.ai_interview_scheduled_at ? `AI L1 ${fmtDateTime12(r.ai_interview_scheduled_at)}` : "AI L1 scheduled",
                    "The AI interview has not finished yet — switch to a manual L1 or send the candidate on if you do not want to wait")}
                  {finished && !onHold && (
                    <button className={FLOW_BTN.success} onClick={() => open("proceed")} disabled={busy}
                      title={`The AI recorded ${effective || "no verdict"} — your call outranks it: move the candidate to RMG Review for the L2 / Submit to Sales`}>
                      <StepForward size={13} /> Proceed to review
                    </button>
                  )}
                  {finished && onHold && (
                    <>
                      <button className={FLOW_BTN.success} onClick={() => open("proceed")} disabled={busy}
                        title="Lift the hold and move the candidate to RMG Review for the L2 / Submit to Sales">
                        <StepForward size={13} /> Proceed to review
                      </button>
                      <button className={FLOW_BTN.view} onClick={() => open("release")} disabled={busy}
                        title="Release the hold — the AI verdict stands again">
                        <PlayCircle size={13} /> Release hold
                      </button>
                    </>
                  )}
                  <button className={FLOW_BTN.manual} onClick={() => setManualRow(r)} disabled={busy}
                    title="Judge the candidate in a human L1 instead — TA books it">
                    <UsersRound size={13} /> Manual L1 instead
                  </button>
                  {finished && !onHold && (
                    <button className={FLOW_BTN.warn} onClick={() => open("hold")} disabled={busy}
                      title="Park the candidate — decide later from this row">
                      <PauseCircle size={13} /> Put on hold
                    </button>
                  )}
                  <button className={FLOW_BTN.danger} disabled={busy}
                    onClick={() => setScreenRow({ row: r, profileId, kind: "reject" })}
                    title="Reject the candidate at RMG screening — the reason is logged and TA is told">
                    <X size={13} /> Reject
                  </button>
                </>
              );
            })()}
            {/* TA schedules the rounds RMG asked for. The manual L1 comes
                first; the L2 button is the one that already existed. */}
            {isTA && !isRmg && r.profile_pipeline_status === "RMG_Review" && r.profile_id != null
              && (r.l1_manual_requested || r.l1_manual_scheduled) && (
              <button
                className={r.l1_manual_requested && !r.l1_manual_scheduled ? FLOW_BTN.manual : smallBtn}
                onClick={() => { setF2fRound("L1"); setF2fRow(r); }}
                disabled={rmgBusyId === r.id || !!r.l1_manual_scheduled}
                title={r.l1_manual_scheduled
                  ? "Manual L1 already scheduled — RMG has been notified"
                  : "RMG skipped the AI interview and wants a human L1 — agree a time with the candidate and schedule it"}
              >
                {r.l1_manual_scheduled ? "L1 scheduled ✓" : "Schedule manual L1"}
              </button>
            )}
            {/* The customer's rounds and the HR round — TA books them here
                (2 Sep 2026). Each button shows only while its round is the
                next thing due, and turns into a done-chip once booked. */}
            {isTA && r.profile_id != null && !profileClosed(r) && r.profile_pipeline_status === "Customer_Interview" && (
              r.cust_l1_scheduled
                ? (r.cust_l1_link
                  ? doneChip("Customer L1 scheduled ✓", "Sales records the customer's verdict on the Interviews tab")
                  : (
                    /* Sales booked the slot but had no link yet (7 Sep 2026):
                       TA adds the customer's meeting link and the candidate
                       is invited on save. */
                    <button className={`${smallPrimary} ${focusRing}`}
                      onClick={() => setRoundModal({ row: r, kind: "Customer_Interview",
                        existing: custEventStub(r.cust_l1_event_id, "Customer_Interview", r.cust_l1_when) })}
                      title="Slot booked without a meeting link — add the customer's link; the candidate is emailed the invite">
                      <Link2 size={13} /> Add Customer L1 link
                    </button>
                  ))
                : (<>
                  <button className={`${smallPrimary} ${focusRing}`}
                    onClick={() => setRoundModal({ row: r, kind: "Customer_Interview" })}
                    title="Book the customer's first round — the candidate is emailed the invite">
                    <CalendarPlus size={13} /> Schedule Customer L1
                  </button>
                  {slotHint(r, "Customer_Interview")}
                </>)
            )}
            {isTA && r.profile_id != null && !profileClosed(r)
              && (r.profile_pipeline_status === "L1_Feedback" || r.profile_pipeline_status === "L2_Feedback") && (
              r.cust_l2_scheduled
                ? (r.cust_l2_link
                  ? doneChip("Customer L2 scheduled ✓", "Sales records the customer's verdict on the Interviews tab")
                  : (
                    <button className={`${smallPrimary} ${focusRing}`}
                      onClick={() => setRoundModal({ row: r, kind: "Customer_L2",
                        existing: custEventStub(r.cust_l2_event_id, "Customer_L2", r.cust_l2_when) })}
                      title="Slot booked without a meeting link — add the customer's link; the candidate is emailed the invite">
                      <Link2 size={13} /> Add Customer L2 link
                    </button>
                  ))
                : (<>
                  <button className={`${smallPrimary} ${focusRing}`}
                    onClick={() => setRoundModal({ row: r, kind: "Customer_L2" })}
                    title="Book the customer's second round — the candidate is emailed the invite">
                    <CalendarPlus size={13} /> Schedule Customer L2
                  </button>
                  {slotHint(r, "Customer_L2")}
                </>)
            )}
            {isTA && r.profile_id != null && !profileClosed(r)
              && (r.profile_pipeline_status === "HR_Screening" || r.profile_pipeline_status === "HR_Interviewing") && (
              r.hr_scheduled
                ? doneChip(r.hr_result ? `HR: ${r.hr_result} ✓` : "HR round scheduled ✓",
                    r.hr_result ? "HR recorded the verdict" : "HR records Hire / Not Recommend on the Interviews tab")
                : (
                  /* Primary once HR has asked for it (3 Sep 2026: HR reviews the
                     details first, then requests); plain while HR is still reviewing. */
                  <button className={`${r.hr_requested ? smallPrimary : smallBtn} ${focusRing}`}
                    onClick={() => setRoundModal({ row: r, kind: "HR_Interview" })}
                    title={r.hr_requested
                      ? "HR asked for the HR round — agree a time with the candidate and book it"
                      : "Sales Head approved — HR is reviewing; you may book the HR round now"}>
                    <CalendarPlus size={13} /> Schedule HR round{r.hr_requested ? " (requested)" : ""}
                  </button>
                )
            )}
            {isTA && !isRmg && r.profile_pipeline_status === "RMG_Review" && r.profile_id != null
              && (r.l2_requested || r.l2_scheduled) && (
              <button
                className={r.l2_requested && !r.l2_scheduled ? FLOW_BTN.manual : smallBtn}
                onClick={() => { setF2fRound("L2"); setF2fRow(r); }}
                disabled={rmgBusyId === r.id || !!r.l2_scheduled}
                title={r.l2_scheduled
                  ? "L2 already scheduled — RMG has been notified"
                  : "RMG asked for an L2 round — agree a time with the candidate and schedule it"}
              >
                {r.l2_scheduled ? "L2 scheduled ✓" : "Schedule L2"}
              </button>
            )}
            {isRmg && r.profile_pipeline_status === "RMG_Review" && (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                  <Bot size={11} /> RMG review needed
                </span>
                {/* The manual L1 only appears once this candidate is ON the
                    manual route — an AI-screened candidate never sees it. Its
                    feedback button opens when the interview time arrives
                    (28 Sep 2026, user flow) — the reminder goes out after it. */}
                {manualRoute && (
                  r.l1_manual_scheduled && r.l1_manual_event_id != null ? (
                    <FeedbackButton label="L1" result={r.l1_manual_result} when={r.l1_manual_when}
                      busy={rmgBusyId === r.id} onClick={() => openFeedback(r, "L1")} />
                  ) : doneChip("L1 requested — TA scheduling", "TA is agreeing a time with the candidate for the manual L1")
                )}
                {r.l2_scheduled && r.l2_event_id != null ? (
                  <FeedbackButton label="L2" result={r.l2_result} when={r.l2_when}
                    busy={rmgBusyId === r.id} onClick={() => openFeedback(r, "L2")} />
                ) : r.l2_requested ? (
                  doneChip("L2 requested — TA scheduling", "TA is agreeing a time with the candidate")
                ) : (
                  /* The L2 follows the L1's verdict: record the L1 first. */
                  <button
                    className={hasL1Verdict ? FLOW_BTN.manualOutline : smallBtn}
                    onClick={() => void requestRound(r, "L2")}
                    disabled={rmgBusyId === r.id || !hasL1Verdict}
                    title={hasL1Verdict
                      ? "Ask TA to arrange an L2 round — TA agrees the time with the candidate and schedules it"
                      : "Record the L1 feedback first — the L2 follows the L1 verdict"}
                  >
                    {rmgBusyId === r.id ? "Requesting…" : "Request L2"}
                  </button>
                )}
                {(() => {
                  /* The ladder has to be JUDGED before Sales sees anyone
                     (1 Sep 2026, user report). The L2 is OPTIONAL (8 Sep 2026,
                     user decision): once the L1 is recorded, RMG may schedule
                     an L2 or submit straight to Sales — both buttons are live.
                     An L2 that was asked for or booked must still be recorded
                     before the hand-off. */
                  const manual = !!(r.l1_manual_requested || r.l1_manual_scheduled);
                  const l2Open = !!(r.l2_requested || r.l2_scheduled) && !r.l2_result;
                  const blocked = (manual && !r.l1_manual_result) || l2Open;
                  const why = manual && !r.l1_manual_result
                    ? "Record the manual L1 outcome first"
                    : "Record the L2 outcome first";
                  return (
                    <button
                      className={smallPrimary}
                      onClick={() => void rmgTransition(r, "sales")}
                      disabled={rmgBusyId === r.id || blocked}
                      title={blocked
                        ? `${why} — Sales only sees candidates the interview ladder has cleared`
                        : "RMG review complete — submit this candidate to the Sales team"}
                    >
                      {rmgBusyId === r.id ? "Working…" : "Submit to Sales"}
                    </button>
                  );
                })()}
                <button
                  className={smallDanger}
                  onClick={() => void rmgTransition(r, "reject")}
                  disabled={rmgBusyId === r.id}
                >
                  Reject
                </button>
              </span>
            )}
            {isTA && (
              <button
                className={FLOW_BTN.edit}
                onClick={() => setEditRow(r)}
                disabled={busy}
                title="Edit applicant details"
              >
                <Pencil size={13} /> Edit
              </button>
            )}
            {isTA && (
              <button
                className={FLOW_BTN.delete}
                onClick={() => setDeleteRow(r)}
                disabled={busy}
                title="Delete this resume/application"
              >
                <Trash2 size={13} /> Delete
              </button>
            )}
          </div>
        );
      },
    },
  ];

  /* Excel-style column chooser (15 Sep 2026, RMG request): the saved layout
     decides which columns show and in what order; Actions is always pinned
     last so no layout can hide the buttons. */
  const shownLayout = taView
    ? { ...layout, columns: layout.columns.filter((c) => !TA_HIDDEN_RESUME_COLUMNS.has(c.key)) }
    : layout;
  const shownLabels = taView
    ? Object.fromEntries(Object.entries(RESUME_COLUMN_LABELS).filter(([k]) => !TA_HIDDEN_RESUME_COLUMNS.has(k)))
    : RESUME_COLUMN_LABELS;
  const visibleColumns: Column<ResumeRow>[] = (() => {
    const byKey = new Map(columns.filter((c) => !(taView && TA_HIDDEN_RESUME_COLUMNS.has(c.key)))
      .map((c) => [c.key, c]));
    const keys = shownLayout.columns.filter((c) => c.visible && c.key !== "_actions").map((c) => c.key);
    const chosen = keys.length === 0
      ? [...byKey.values()].filter((c) => c.key !== "_actions")
      : (keys.map((k) => byKey.get(k)).filter(Boolean) as Column<ResumeRow>[]);
    const actions = byKey.get("_actions");
    return actions ? [...chosen, actions] : chosen;
  })();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* New candidates are scored automatically; this only appears for
            rows added before that (or whose scan failed) and catches them up. */}
        {(isTA || isRmg) && pendingOnPage > 0 && (
          <button className={btnSecondary} onClick={scanAll} disabled={scanAllBusy}>
            <RefreshCw size={15} className={scanAllBusy ? "animate-spin" : ""} />
            {scanAllBusy ? "Scoring…" : `Score ${pendingOnPage} pending`}
          </button>
        )}
        {canUpload && (
          <>
            <label className={`${btnSecondary} cursor-pointer`} title="Upload a .zip of resumes — each becomes an application; duplicates are held for review">
              <FileUp size={15} />{" "}
              {zipBusy
                ? zipProgress
                  ? `Processing ${zipProgress.done}/${zipProgress.total}…`
                  : "Uploading…"
                : "Bulk upload (ZIP)"}
              <input
                type="file"
                accept=".zip"
                className="hidden"
                disabled={zipBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void uploadZip(f);
                }}
              />
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-secondary"
              title="Each candidate with an email in their CV gets a short, professional note about this opening and is asked to reply to you with their interest, CTC, notice period and location">
              <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" disabled={zipBusy}
                checked={zipOpeningMail} onChange={(e) => pickZipOpeningMail(e.target.checked)} />
              <Mail size={13} aria-hidden /> Email each candidate about the opening
            </label>
            <button className={btnPrimary} onClick={() => setShowUpload(true)}>
              <Plus size={16} /> Upload Resume
            </button>
          </>
        )}
      </div>
      {/* The JD block that used to sit here left on 30 Sep 2026 (user ask): the
          Details tab is where the JD lives; this tab is the candidate list. */}
      {isTA && !canUpload && (
        <p className="text-xs text-muted">
          Resumes can be uploaded only while the requirement is Open For Sourcing, Posted On Portals or In Progress.
        </p>
      )}

      <div className="space-y-2">
        {/* Applied Candidates | Archive (30 Sep 2026, user request): a rejected
            or withdrawn candidacy leaves the live list — RMG / GM's rejection
            moves the candidate here, where the history stays reachable. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg bg-surface-2 p-0.5 ring-1 ring-inset ring-subtle" role="tablist" aria-label="Applied or archived">
            {([
              ["live", "Applied Candidates", statusCounts?.live_total, <Users size={13} key="i" />],
              ["archive", "Archive", statusCounts?.archive_total, <Archive size={13} key="i" />],
            ] as const).map(([key, label, count, icon]) => (
              <button key={key} type="button" role="tab" aria-selected={bucket === key}
                onClick={() => pickBucket(key)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors duration-micro ease-smooth ${
                  bucket === key ? "bg-surface-0 text-primary shadow-raised" : "text-secondary hover:text-primary"}`}>
                {icon} {label}
                {count != null && (
                  <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                    key === "archive" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                      : "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"}`}>{count}</span>
                )}
              </button>
            ))}
          </div>
          <div className="text-xs text-secondary">
            {bucket === "archive"
              ? "Rejected and withdrawn candidates RMG / GM moved here. Their interviews and history stay open."
              : "Candidates applied to this opportunity, by where they stand today."}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {/* Stage chips (1 Oct 2026): the Stage column's own words and colours
              (`STAGE_TONE`), each with its count from the server's
              `status_counts.phases` — so a chip is exactly what it lists. */}
          {stageChips.map(({ key, label }) => {
            const count = key === "all" ? statusCounts?.[`${bucket}_total`] : (bucketCounts?.[key] ?? 0);
            const on = stagePill === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setStagePill(key)}
                aria-pressed={on}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition-colors duration-micro ease-smooth ${
                  on ? "bg-brand-600 text-white ring-brand-600"
                    : `${STAGE_TONE[key] || STAGE_TONE.all} ring-subtle hover:ring-strong`
                }`}
              >
                {label}
                {count != null && (
                  <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                    on ? "bg-white/25" : "bg-white/60 font-bold dark:bg-black/20"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : (
        /* While "Scan all pending" runs, the whole resumes section carries the
           animated AI border; it stops the moment the scan completes. */
        <div className={scanAllBusy ? "ai-generating rounded-2xl" : undefined}>
          <DataTable<ResumeRow>
            columns={visibleColumns}
            rows={rows}
            meta={meta}
            loading={loading}
            search={search}
            onSearch={setSearch}
            onPage={setPage}
            selectable={canPick}
            selectedIds={canPick ? picked : undefined}
            onSelectionChange={canPick ? setPicked : undefined}
            filters={
              <>
                <TableCustomizerButton
                  tableKey="requirement_resumes"
                  labels={shownLabels}
                  layout={shownLayout}
                  onChange={setLayout}
                  sortable={[]}
                  maxSortLevels={0}
                />
                <select
                  className={`${inputCls} !w-52`}
                  value={appliedBy}
                  onChange={(e) => setAppliedBy(e.target.value)}
                  title="Filter by the TA who applied the candidate"
                >
                  <option value="">Applied by — anyone</option>
                  {taOptions.map((n) => <option key={n} value={n}>{n === myName ? `${n} (me)` : n}</option>)}
                </select>
                <div className="inline-flex items-center gap-1 text-xs text-muted" role="group" aria-label="Applied between">
                  <span>Applied</span>
                  <input type="date" aria-label="Applied from" className={`${inputCls} !w-auto !py-1`}
                    value={appliedFrom} max={appliedTo || undefined} onChange={(e) => setAppliedFrom(e.target.value)} />
                  <span>–</span>
                  <input type="date" aria-label="Applied to" className={`${inputCls} !w-auto !py-1`}
                    value={appliedTo} min={appliedFrom || undefined} onChange={(e) => setAppliedTo(e.target.value)} />
                  {(appliedFrom || appliedTo) && (
                    <button type="button" className="ml-1 text-brand-600 hover:underline"
                      onClick={() => { setAppliedFrom(""); setAppliedTo(""); }}>Clear</button>
                  )}
                </div>
              </>
            }
            headerRight={
              <span className="flex items-center gap-4">
                <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-muted"
                  title="Dismissed duplicate CVs are kept on file but hidden from this list">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600"
                    checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} />
                  Show dismissed only
                </label>
                {meta && (
                  <span className="whitespace-nowrap text-xs font-medium text-muted">
                    {/* "candidates", not "resumes": the list also carries people
                        applied from the Candidates page, who have no CV row. */}
                    {meta.total} {meta.total === 1 ? "candidate" : "candidates"}, page {meta.page}/{Math.max(1, meta.pages || 1)}
                  </span>
                )}
              </span>
            }
            emptyMessage={showDismissed ? "No dismissed CVs on this requirement"
              : stagePill !== "all" ? `No candidates at “${CANDIDATE_STAGE_BUCKETS.find((b) => b.key === stagePill)?.label || stagePill}”`
              : bucket === "archive" ? "Nothing archived — TA, RMG or GM move a rejected candidate here with the Archive button"
              : appliedBy || dq ? "No applied candidates match the current filters" : "No applied candidates yet"}
          />
        </div>
      )}

      {showUpload && (
        <UploadResumeModal
          req={req}
          onClose={() => setShowUpload(false)}
          onUploaded={() => { load(); onRequirementChanged(); }}
          toast={toast}
        />
      )}
      {zipResult && (
        <Modal medium title="Bulk upload results" onClose={() => setZipResult(null)}>
          <div className="space-y-4 text-sm">
            <p className="text-secondary">
              {zipResult.total} resume(s) in the ZIP — {zipResult.applied.length} applied
              {zipResult.opening_mail?.enabled && zipResult.applied.length > 0 && (
                <>, {zipResult.opening_mail.sent} emailed about the opening
                  {zipResult.opening_mail.no_email > 0 && <> ({zipResult.opening_mail.no_email} had no usable email)</>}</>
              )}
              {zipResult.held.length > 0 && <>, <b className="text-amber-700 dark:text-amber-300">{zipResult.held.length} possible duplicate(s) held for your review</b></>}
              {zipResult.skipped.length > 0 && <>, {zipResult.skipped.length} already uploaded</>}
              {zipResult.failed.length > 0 && <>, {zipResult.failed.length} failed</>}.
            </p>
            {zipResult.applied.length > 0 && (
              <div>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted">Applied — now in Applied Candidates</span>
                  <span className="flex flex-wrap gap-2">
                  {isTA && zipResult.applied.some((a) => a.profile_id != null) && (
                    <button
                      className={FLOW_BTN.primary}
                      disabled={zipScreening}
                      title="Hand every applied candidate to RMG / GM for Technical Screening — one notice for the batch"
                      onClick={() => void sendZipForScreening()}
                    >
                      <Send size={13} /> {zipScreening ? "Sending…" : "Send all for Technical Screening"}
                    </button>
                  )}
                  <button
                    className={`${btnPrimary} !px-3 !py-1.5 text-xs`}
                    title="Step through each candidate: resume on one side, parsed details on the other — confirm or correct, then next"
                    onClick={() => setVerifyQueue(
                      zipResult.applied.map((a) => ({ resume_id: a.resume_id, name: a.name })))}
                  >
                    Verify details ({zipResult.applied.length})
                  </button>
                  </span>
                </div>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto">
                  {zipResult.applied.map((a) => (
                    <li key={a.file} className="text-secondary">
                      <b className="text-primary">{a.name}</b>
                      {a.ats_score != null && (
                        <span className="ml-1.5 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-bold tabular-nums text-primary"
                          title="ATS score (scanned automatically during upload)">
                          {Math.round(Number(a.ats_score))}%
                        </span>
                      )}
                      {a.profile_id != null && (
                        <> — <CrmLink to={`profiles/${a.profile_id}`} className="text-brand-600 underline dark:text-brand-300">open profile</CrmLink></>
                      )}
                      <span className="text-xs text-muted"> ({a.file})</span>
                      {a.opening_mail === "sent" && (
                        <span className="ml-1.5 text-xs text-success" title="The opening email went to this address">
                          · emailed {a.email}
                        </span>
                      )}
                      {a.opening_mail === "no_email" && (
                        <span className="ml-1.5 text-xs font-semibold text-warning"
                          title="No usable email was found in the CV — add it with Edit on the row, then press Opening email">
                          · no email in the CV
                        </span>
                      )}
                      {a.name_match && (
                        <div className="text-xs text-muted">
                          note: same name as existing candidate{" "}
                          <CrmLink to={`candidates/${a.name_match.candidate_id}`} className="underline">
                            {a.name_match.name}
                          </CrmLink>{" "}
                          (different email/phone — likely a different person)
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {zipResult.held.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Possible duplicates — NOT applied, decide per person
                </div>
                <ul className="max-h-64 space-y-2 overflow-y-auto">
                  {zipResult.held.map((h) => {
                    const d = h.duplicate;
                    const done = zipAppliedDups.has(d.candidate_id) || d.already_applied_here;
                    return (
                      <li key={h.file} className="rounded-card border border-amber-300/60 bg-amber-50/60 px-3 py-2 dark:border-amber-800/50 dark:bg-amber-950/20">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <b className="text-primary">{h.extracted_name}</b>
                            <span className="text-xs text-muted"> ({h.file})</span>
                            <div className="text-xs text-secondary">
                              Matches <CrmLink to={`candidates/${d.candidate_id}`} className="font-semibold underline">{d.name || `#${d.candidate_id}`}</CrmLink>
                              {d.email ? <> · {d.email}</> : null}
                              {d.already_applied_here && d.profile_id_here != null && (
                                <> — <CrmLink to={`profiles/${d.profile_id_here}`} className="font-semibold underline">already applied here</CrmLink></>
                              )}
                            </div>
                          </div>
                          <button
                            className={`${btnSecondary} !px-2.5 !py-1 text-xs`}
                            disabled={done || zipApplying === d.candidate_id}
                            onClick={() => void applyHeldDuplicate(h.resume_id, d.candidate_id)}
                            title="Apply the EXISTING candidate to this opportunity (no duplicate record)"
                          >
                            {done ? "Applied" : zipApplying === d.candidate_id ? "Applying…" : "Apply anyway"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {zipResult.skipped.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Skipped</div>
                <ul className="max-h-24 space-y-0.5 overflow-y-auto text-xs text-muted">
                  {zipResult.skipped.map((s) => <li key={s.file}>{s.file} — {s.reason}</li>)}
                </ul>
              </div>
            )}
            {zipResult.failed.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-bold uppercase tracking-wide text-danger">Failed</div>
                <ul className="max-h-24 space-y-0.5 overflow-y-auto text-xs text-danger">
                  {zipResult.failed.map((s) => <li key={s.file}>{s.file} — {s.reason}</li>)}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <button className={btnPrimary} onClick={() => setZipResult(null)}>Done</button>
            </div>
          </div>
        </Modal>
      )}
      {verifyQueue && (
        <BulkVerifyModal
          queue={verifyQueue}
          onClose={() => { setVerifyQueue(null); load(); }}
          notify={toast}
        />
      )}
      {canPick && picked.size > 0 && (
        <BulkActionBar count={picked.size} onClear={() => setPicked(new Set())}>
          <button type="button" className={FLOW_BTN.primary} disabled={batchSending || pickedSendable.length === 0}
            title={pickedSendable.length === 0 ? "None of the ticked candidates is at Sourcing with you" : undefined}
            onClick={() => void sendPickedForScreening()}>
            <Send size={13} /> {batchSending ? "Sending…" : `Send ${pickedSendable.length} for Technical Screening`}
          </button>
          {pickedSendable.length < picked.size && (
            <span className="text-xs text-muted">{picked.size - pickedSendable.length} not at Sourcing — skipped</span>
          )}
        </BulkActionBar>
      )}
      {breakdownRow && (
        <AtsBreakdownModal row={breakdownRow} onClose={() => setBreakdownRow(null)}
          onOpenProfile={breakdownRow.profile_id != null
            ? () => { setBreakdownRow(null); crmNavigate(`profiles/${breakdownRow.profile_id}`); } : undefined} />
      )}
      {editRow && (
        <EditApplicantModal
          row={editRow}
          req={req}
          onClose={() => setEditRow(null)}
          onSaved={() => { setEditRow(null); load(); }}
          toast={toast}
        />
      )}
      {l2FbRow && (
        <Modal title={`${l2FbRound} feedback — ${l2FbRow.candidate_name || "candidate"}`}
          onClose={() => { if (!l2FbBusy) setL2FbRow(null); }}>
          <div className="space-y-3">
            <Field label="Result" required>
              <select className={inputCls} value={l2FbResult}
                onChange={(e) => { setL2FbResult(e.target.value); setL2FbErr(""); }}>
                <option value="">Select result…</option>
                {["Strong Hire", "Hire", "Leaning Hire", "Leaning No", "No Hire"].map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </Field>
            <Field label="Feedback" required error={l2FbErr}>
              <textarea className={`${inputCls} min-h-[90px]`} value={l2FbNote}
                onChange={(e) => { setL2FbNote(e.target.value); setL2FbErr(""); }}
                placeholder={`How did the candidate do in the ${l2FbRound} round?`} />
            </Field>
            <p className="text-[11px] text-muted">
              Marks the {l2FbRound} round Completed and saves the outcome — visible on the
              candidate profile&rsquo;s Interviews tab.{" "}
              {l2FbRound === "L1"
                ? "The L2 round unlocks once this is recorded."
                : "Then Submit to Sales or Reject as usual."}
            </p>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className={btnSecondary} onClick={() => setL2FbRow(null)} disabled={l2FbBusy}>Cancel</button>
            <button className={btnPrimary} onClick={() => void submitL2Feedback()} disabled={l2FbBusy}>
              {l2FbBusy ? "Saving…" : "Save feedback"}
            </button>
          </div>
        </Modal>
      )}
      {approvalRow?.profile_id != null && (
        <SubmitForApprovalModal
          profileId={approvalRow.profile_id}
          candidateName={approvalRow.candidate_name || "candidate"}
          sentBack={approvalRow.profile_status?.key === "terms_sent_back"}
          existing={approvalRow.latest_offer}
          onClose={() => setApprovalRow(null)}
          onDone={(msg) => { setApprovalRow(null); toast(msg); load(); }}
        />
      )}
      {roundModal?.row.profile_id != null && (
        <InterviewRoundModal
          profileId={roundModal.row.profile_id}
          existing={roundModal.existing ?? null}
          initialKind={roundModal.kind}
          initialMode="schedule"
          onClose={() => setRoundModal(null)}
          onSaved={() => { setRoundModal(null); toast(roundModal.existing ? "Meeting link saved — the candidate has been invited" : "Round scheduled — the candidate has been invited"); load(); }}
          showToast={(m, k) => toast(m, k)}
        />
      )}
      {decisionRow?.row.profile_id != null && (
        <SalesHeadDecisionModal
          profileId={decisionRow.row.profile_id}
          candidateName={decisionRow.row.candidate_name || "candidate"}
          decision={decisionRow.decision}
          terms={decisionRow.row.latest_offer ?? null}
          onClose={() => setDecisionRow(null)}
          onDone={(msg) => { setDecisionRow(null); toast(msg); load(); }}
        />
      )}
      {aiAfterRow && (
        <AiL1DecisionModal
          profileId={aiAfterRow.profileId}
          context={req.title}
          candidateName={aiAfterRow.row.candidate_name}
          decision={aiAfterRow.decision}
          aiResult={aiAfterRow.row.ai_effective_result || aiAfterRow.row.ai_interview_result || null}
          onClose={() => setAiAfterRow(null)}
          onDone={(msg) => { setAiAfterRow(null); toast(msg); load(); }}
        />
      )}
      {manualRow?.profile_id && (
        <GoManualModal
          profileId={manualRow.profile_id}
          context={req.title}
          candidateName={manualRow.candidate_name}
          onClose={() => setManualRow(null)}
          onDone={(msg) => { setManualRow(null); toast(msg); load(); }}
        />
      )}
      {f2fRow?.profile_id != null && (
        /* TA books the round RMG asked for — the interviewer is chosen for an
           L1; an L2 left blank goes to the RMG who asked (server rule). */
        <ScheduleManualRoundModal
          profileId={f2fRow.profile_id}
          round={f2fRound}
          candidateName={f2fRow.candidate_name}
          candidateEmail={f2fRow.email}
          context={req.title}
          onClose={() => setF2fRow(null)}
          onDone={(msg) => { setF2fRow(null); toast(msg); load(); }}
        />
      )}
      {l1Invite && (
        <Modal
          medium
          title={`AI L1 invite — ${l1Invite.row.candidate_name}`}
          onClose={() => { if (!l1InviteBusy) setL1Invite(null); }}
          dirty={l1Invite.body !== buildInviteEmail(l1Invite.row)}
        >
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              Sent to <b>{l1Invite.row.email || "—"}</b>. Edit if needed, then confirm — the
              interview link and access key below are live credentials.
            </p>
            <Field label="Subject" required>
              <input className={inputCls} value={l1Invite.subject}
                onChange={(e) => setL1Invite((p) => p && ({ ...p, subject: e.target.value }))} />
            </Field>
            <Field label="Message" required>
              <textarea className={`${inputCls} min-h-[260px] font-mono !text-[13px] leading-relaxed`}
                value={l1Invite.body}
                onChange={(e) => setL1Invite((p) => p && ({ ...p, body: e.target.value }))} />
            </Field>
            <div className="flex justify-end gap-2">
              <button className={btnSecondary} disabled={l1InviteBusy}
                onClick={() => setL1Invite(null)}>Cancel</button>
              <button className={btnPrimary} disabled={l1InviteBusy}
                onClick={() => void sendL1Invite()}>
                {l1InviteBusy ? "Sending…" : "Confirm & send"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {invitePreview && (
        <Modal
          medium
          title={`Slot invite — ${invitePreview.row.candidate_name}`}
          onClose={() => { if (inviteBusyId == null) setInvitePreview(null); }}
        >
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              This is exactly what the candidate will receive. Verify, then send.
            </p>
            {invitePreview.re_invite && (
              <p className="rounded-control border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
                The candidate missed their previously booked slot — sending this reopens the same
                link so they can pick a new time.
              </p>
            )}
            <div className="rounded-card border border-subtle bg-surface-2 px-4 py-3 text-sm">
              <div className="text-xs text-muted">
                To: <b className="text-secondary">{[invitePreview.to_email, invitePreview.to_phone && `WhatsApp ${invitePreview.to_phone}`].filter(Boolean).join(" · ") || "—"}</b>
              </div>
              <div className="mt-2 font-semibold text-primary">{invitePreview.subject}</div>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-secondary">{invitePreview.text}</pre>
            </div>
            {invitePreview.open_slots === 0 ? (
              <p className="rounded-control border border-rose-300/60 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-300">
                No open interview slots exist for this requirement — the candidate would open the
                link and find nothing to pick. Create slots on the Interview Slots tab first.
              </p>
            ) : (
              <p className="text-xs text-muted">
                {invitePreview.open_slots} open slot(s) available
                {invitePreview.next_slot_at ? ` — next: ${fmtDateTime12(invitePreview.next_slot_at)}` : ""}.
                After the candidate confirms a slot, their AI L1 interview is scheduled automatically
                and they receive the interview link and access key.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button className={btnSecondary} disabled={inviteBusyId != null}
                onClick={() => setInvitePreview(null)}>Cancel</button>
              <button className={btnPrimary}
                disabled={inviteBusyId != null || invitePreview.open_slots === 0}
                title={invitePreview.open_slots === 0 ? "Create interview slots first" : undefined}
                onClick={() => void sendSlotInvite(invitePreview.row)}>
                {inviteBusyId != null ? "Sending…" : "Confirm & send"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {screenRow && (
        <ScreeningDecisionModal
          profileId={screenRow.profileId}
          candidateName={screenRow.row.candidate_name}
          position={req.title}
          taName={screenRow.row.applied_by}
          decision={screenRow.kind === "shortlist" ? "Shortlisted" : "Rejected"}
          route={screenRow.kind === "shortlist" ? screenRow.route : undefined}
          onClose={() => setScreenRow(null)}
          onDone={(msg) => { setScreenRow(null); toast(msg); load(); }}
        />
      )}
      {rmgDecision && (
        <Modal
          title={rmgDecision.kind === "sales" ? "Submit to Sales team" : "Reject candidate"}
          medium
          onClose={() => { if (rmgBusyId !== rmgDecision.row.id) setRmgDecision(null); }}
          hero={<RmgVerdictHero sales={rmgDecision.kind === "sales"} name={rmgDecision.row.candidate_name} position={req.title} />}
          footer={
            <DialogActions tone={rmgDecision.kind === "sales" ? "emerald" : "rose"}
              icon={rmgDecision.kind === "sales" ? Send : X} busy={rmgBusyId === rmgDecision.row.id} busyLabel="Working…"
              label={rmgDecision.kind === "sales" ? "Submit to Sales team" : "Reject candidate"}
              onCancel={() => setRmgDecision(null)} onConfirm={() => void submitRmgDecision()} />
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              {rmgDecision.kind === "sales"
                ? <>Move <span className="font-semibold">{rmgDecision.row.candidate_name}</span> from RMG Review to Sales Screening. The comment goes on the activity log.</>
                : <>Reject <span className="font-semibold">{rmgDecision.row.candidate_name}</span> at the RMG stage. The reason goes on the activity log and cannot be blank.</>}
            </p>
            {rmgDecision.kind === "sales" && rmgDecision.row.profile_id && (
              <SalesReadinessPanel profileId={rmgDecision.row.profile_id} checks={handover.checks}
                onChecks={handover.setChecks} onError={(m) => toast(m, "err")} />
            )}
            {rmgDecision.kind === "sales" && (
              <label className="flex cursor-pointer items-start gap-2 rounded-control border border-subtle bg-surface-2 px-3 py-2 text-sm text-secondary">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600"
                  checked={rmgAskNotice} onChange={(e) => setRmgAskNotice(e.target.checked)} />
                <span>
                  <b className="text-primary">Ask TA to collect the notice period</b>
                  <span className="block text-xs text-muted">
                    {(rmgDecision.row.application_details?.notice_period || "").trim()
                      ? `On record: ${rmgDecision.row.application_details?.notice_period}. Tick to have TA re-confirm it with the candidate.`
                      : "Nothing is on record — TA is notified to confirm it with the candidate now, before Sales reaches the customer."}
                  </span>
                </span>
              </label>
            )}
            <Field
              label={rmgDecision.kind === "sales" ? "Comment for the activity log" : "Rejection reason"}
              required
              error={rmgCommentErr}
            >
              <textarea
                className={`${inputCls}${rmgCommentErr ? " input-error" : ""}`}
                rows={rmgDecision.kind === "sales" ? 7 : 3}
                value={rmgComment}
                onChange={(e) => { setRmgComment(e.target.value); setRmgCommentErr(""); }}
                placeholder={rmgDecision.kind === "sales"
                  ? (handover.loading ? "Writing the summary from the interviews…" : "Why is this candidate being submitted to Sales?")
                  : "Why is this candidate being rejected? (min 5 characters)"}
              />
              {rmgDecision.kind === "sales" && handover.note && (
                <p className="mt-1 text-xs text-muted">Written from the recorded interviews and skill ratings — edit anything before you submit.</p>
              )}
            </Field>
          </div>
        </Modal>
      )}
      {taPick && (
        <TaDecisionModal
          profileId={taPick.profileId}
          context={req.title}
          candidateName={taPick.row.candidate_name}
          decision={taPick.decision}
          overBudget={taPick.row.over_budget
            ? { expected: taPick.row.expected_ctc, budget: taPick.row.budget_ctc_max } : null}
          closedNote={taPick.row.closed_note}
          rejected={isClosedCandidacy(taPick.row.profile_pipeline_status)
            && taPick.row.profile_pipeline_status !== "Self_Withdrawn"}
          details={taPick.decision === "interested" ? confirmDetailsFor(taPick.row) : null}
          onEditDetails={() => { const row = taPick.row; setTaPick(null); setEditRow(row); }}
          onClose={() => setTaPick(null)}
          onDone={(m) => { setTaPick(null); toast(m); void load(); }}
        />
      )}
      {roundsRow && (
        <InterviewRoundsModal profileId={roundsRow.profileId} candidateName={roundsRow.row.candidate_name}
          onClose={() => setRoundsRow(null)} onChanged={(msg) => { if (msg) toast(msg); void load(); }} />
      )}
      {aiRouteRow && (
        <ChooseAiL1Modal
          profileId={aiRouteRow.profileId}
          context={req.title}
          candidateName={aiRouteRow.row.candidate_name}
          onClose={() => setAiRouteRow(null)}
          onDone={(m) => { setAiRouteRow(null); toast(m); void load(); }}
        />
      )}
      {deleteRow && (
        <ConfirmModal
          title="Delete resume"
          message={<>Delete the resume/application of <span className="font-semibold">{deleteRow.candidate_name}</span>? This removes it from this requirement. The candidate record (if created) is kept.</>}
          confirmLabel="Delete"
          danger
          busy={busyId === deleteRow.id}
          onConfirm={() => { void doDelete(); }}
          onClose={() => { if (busyId !== deleteRow.id) setDeleteRow(null); }}
        />
      )}
      {rejectRow && (
        <ConfirmModal
          title="Reject resume"
          message={<>Reject the resume of <span className="font-semibold">{rejectRow.candidate_name}</span>? This marks it as Rejected in the ATS.</>}
          confirmLabel="Reject"
          danger
          busy={busyId === rejectRow.id}
          onConfirm={doReject}
          onClose={() => setRejectRow(null)}
        />
      )}
      {tplGate.modal}
      {profileScheduleRow?.profile_id != null && (
        <ScheduleAiInterviewModal
          profileId={profileScheduleRow.profile_id}
          candidate={{ full_name: profileScheduleRow.candidate_name, email: profileScheduleRow.email }}
          onClose={() => setProfileScheduleRow(null)}
          onDone={() => { setProfileScheduleRow(null); load(); }}
          showToast={(m, k) => toast(m, k)}
        />
      )}
      {rescheduleRow?.row.profile_id != null && (
        <ScheduleAiInterviewModal
          profileId={rescheduleRow.row.profile_id}
          candidate={{ full_name: rescheduleRow.row.candidate_name, email: rescheduleRow.row.email }}
          reschedule={rescheduleRow.seed}
          onClose={() => setRescheduleRow(null)}
          onDone={() => { setRescheduleRow(null); load(); }}
          showToast={(m, k) => toast(m, k)}
        />
      )}
      {scheduleRow && (
        <ConfirmModal
          title="Schedule AI L1 Interview"
          message={
            <>
              This creates the candidate + profile and generates an AI L1 invite for{" "}
              <span className="font-semibold">{scheduleRow.candidate_name}</span>. The link will be shown here (not auto-sent).
              <label className="mt-3 block text-xs font-semibold text-secondary">
                Interview date &amp; time (IST)
                <input
                  type="datetime-local"
                  className={`${inputCls} mt-1`}
                  value={scheduleWhen}
                  onChange={(e) => setScheduleWhen(e.target.value)}
                />
              </label>
              <span className="mt-1 block text-[11px] text-muted">
                This exact time goes into the candidate's invite and gates the link. Leave blank to allow the candidate to start right away.
              </span>
            </>
          }
          confirmLabel="Schedule"
          busy={busyId === scheduleRow.id}
          onConfirm={doSchedule}
          onClose={() => setScheduleRow(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------ interview history tab */

/** Candidate-wise interview history (28 Aug 2026, user decision): now that
 * candidates propose their own time, the slot list stopped being the story —
 * what matters is what HAPPENED: every AI L1 session with its legacy truth
 * (verified/active/completed/terminated, start/finish, tab-switch violations)
 * plus the human rounds. Slot management stays available, collapsed below. */
function InterviewHistoryTab({ req, toast }: { req: Req; toast: ToastFn }) {
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showSlots, setShowSlots] = useState(false);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    crmGet<any[]>(`/api/requirements/${req.id}/interview-history`)
      .then((r) => { if (alive) { setGroups(r.data || []); setError(""); } })
      .catch((e: any) => { if (alive) setError(e?.message || "Failed to load interview history"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [req.id]);
  useEffect(() => load(), [load]);

  const sessPill = (s?: string | null) => {
    if (!s) return <span className="text-xs text-muted">—</span>;
    const v = s.toLowerCase();
    const tone = /terminat|abandon/.test(v)
      ? "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
      : /complete|recovered/.test(v)
        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
        : /active|verified/.test(v)
          ? "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300"
          : "bg-surface-2 text-secondary";
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${tone}`}>
        {s.replace(/_/g, " ")}
      </span>
    );
  };
  const vioCell = (e: any) => {
    const parts = Object.entries(e.violations || {})
      .map(([t, c]) => `${String(t).replace(/_/g, " ")} × ${c}`);
    const n = Number(e.violation_count || 0) || parts.length;
    if (!n) return <span className="text-xs text-muted">None</span>;
    return (
      <span className="inline-flex flex-col">
        <span className={`text-xs font-bold ${n >= 3 ? "text-rose-600 dark:text-rose-300" : "text-amber-700 dark:text-amber-300"}`}>
          {n} violation{n === 1 ? "" : "s"}
        </span>
        {parts.length > 0 && <span className="text-[11px] text-muted">{parts.join(" · ")}</span>}
      </span>
    );
  };
  const th = "px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-muted";
  const td = "px-3 py-2 align-top text-sm";
  /* Legacy scheduled_at_local can be a non-ISO string — show it verbatim
     rather than "—" when Date() can't parse it. */
  const dtf = (v?: string | null) => {
    const s = fmtDateTime(v);
    return s !== "—" ? s : (v || "—");
  };

  return (
    <div className="space-y-4">
      {loading ? <Spinner label="Loading interview history…" /> : error ? <ErrorBox error={error} onRetry={load} /> : (
        groups.length === 0 ? (
          <div className="rounded-card border border-subtle bg-surface-1 p-8 text-center text-sm text-muted">
            No interviews yet on this requirement — schedule an AI L1 from the Applied Candidates tab.
          </div>
        ) : groups.map((g) => (
          <div key={g.candidate_id ?? g.candidate_name} className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
            <div className="flex flex-wrap items-center gap-2 border-b border-subtle px-4 py-2.5">
              <span className="text-sm font-bold text-primary">{g.candidate_name}</span>
              {g.email && <span className="text-xs text-muted">{g.email}</span>}
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-secondary">
                {g.entries.length} round{g.entries.length === 1 ? "" : "s"}
              </span>
              {g.profile_id != null && (
                <CrmLink to={`profiles/${g.profile_id}`} className="ml-auto text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
                  Open profile
                </CrmLink>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead><tr className="border-b border-subtle">
                  <th className={th}>Round</th><th className={th}>Scheduled</th><th className={th}>Session</th>
                  <th className={th}>Started</th><th className={th}>Completed</th><th className={th}>Violations</th>
                  <th className={th}>Result</th><th className={th}></th>
                </tr></thead>
                <tbody>
                  {g.entries.map((e: any, i: number) => (
                    <tr key={i} className="border-b border-subtle last:border-0">
                      <td className={`${td} font-semibold text-primary`}>{e.type}</td>
                      <td className={`${td} tabular-nums text-secondary`}>{dtf(e.scheduled_at)}</td>
                      <td className={td}>{sessPill(e.session_status || e.status)}</td>
                      <td className={`${td} tabular-nums text-secondary`}>{fmtDateTime(e.started_at)}</td>
                      <td className={`${td} tabular-nums text-secondary`}>{fmtDateTime(e.completed_at)}</td>
                      <td className={td}>{vioCell(e)}</td>
                      <td className={td}>
                        <span className="inline-flex items-center gap-1.5">
                          {e.effective_result ? <StatusBadge status={e.effective_result} /> : <span className="text-xs text-muted">—</span>}
                          {e.score_percent != null && (
                            <span className="text-xs font-bold tabular-nums text-primary">
                              {Number(e.score_percent) % 1 === 0 ? e.score_percent : Number(e.score_percent).toFixed(1)}%
                            </span>
                          )}
                        </span>
                      </td>
                      <td className={`${td} text-right`}>
                        {e.report_link && (
                          <a href={e.report_link} className="inline-flex items-center gap-1 text-xs font-semibold text-sky-600 hover:underline dark:text-sky-400">
                            <ExternalLink size={12} /> Report
                          </a>
                        )}
                        {e.meeting_link && (
                          <a href={e.meeting_link} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-sky-600 hover:underline dark:text-sky-400">
                            <Link2 size={12} /> Meeting
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
      <div className="rounded-card border border-subtle bg-surface-1">
        <button type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-secondary hover:text-primary"
          onClick={() => setShowSlots((v) => !v)}>
          <span>Manage interview slots (optional — candidates can propose their own time)</span>
          <span className="text-xs text-muted">{showSlots ? "Hide" : "Show"}</span>
        </button>
        {showSlots && <div className="border-t border-subtle p-4"><SlotsTab req={req} toast={toast} /></div>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------- interview slots tab */

type SlotFormRow = { slot_at: string; capacity: string };

function AddSlotsModal({
  reqId, onClose, onAdded, toast,
}: {
  reqId: number;
  onClose: () => void;
  onAdded: () => void;
  toast: ToastFn;
}) {
  const [rows, setRows] = useState<SlotFormRow[]>([{ slot_at: "", capacity: "1" }]);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  const updateRow = (i: number, patch: Partial<SlotFormRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    const errs: Record<number, string> = {};
    rows.forEach((r, i) => {
      if (!r.slot_at) { errs[i] = "Pick a date & time"; return; }
      const d = new Date(r.slot_at);
      if (isNaN(d.getTime())) { errs[i] = "Invalid date/time"; return; }
      if (d.getTime() <= Date.now()) { errs[i] = "Slot must be in the future"; return; }
      const cap = Number(r.capacity);
      if (r.capacity.trim() === "" || !Number.isInteger(cap) || cap < 1) {
        errs[i] = "Capacity must be a whole number of at least 1";
      }
    });
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    try {
      const res = await crmPost<Slot[]>(
        `/api/requirements/${reqId}/slots`,
        rows.map((r) => ({ slot_at: new Date(r.slot_at).toISOString(), capacity: Number(r.capacity) })),
      );
      const n = (res.data || []).length || rows.length;
      toast(res.message || `${n} slot${n === 1 ? "" : "s"} added`);
      onAdded();
      onClose();
    } catch (e: any) {
      toast(e?.message || "Failed to add slots", "err");
      setBusy(false);
    }
  };

  return (
    <Modal title="Add interview slots" onClose={onClose} fullScreen>
      <div className="space-y-3">
        <p className="text-sm text-secondary">
          Add one or more future interview slots. Candidates pick a slot from their booking link;
          capacity is how many candidates can book the same slot.
        </p>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i}>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className={`${inputCls} !w-60`}
                  type="datetime-local"
                  value={r.slot_at}
                  onChange={(e) => {
                    updateRow(i, { slot_at: e.target.value });
                    if (errors[i]) setErrors((es) => { const n = { ...es }; delete n[i]; return n; });
                  }}
                  aria-label={`Slot ${i + 1} date and time`}
                />
                <input
                  className={`${inputCls} !w-28`}
                  type="number"
                  min={1}
                  step={1}
                  value={r.capacity}
                  onChange={(e) => {
                    updateRow(i, { capacity: e.target.value });
                    if (errors[i]) setErrors((es) => { const n = { ...es }; delete n[i]; return n; });
                  }}
                  aria-label={`Slot ${i + 1} capacity`}
                  title="Capacity (candidates per slot)"
                />
                {rows.length > 1 && (
                  <button
                    type="button"
                    className={`rounded-lg p-1.5 text-muted hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 ${focusRing}`}
                    onClick={() => {
                      setRows((rs) => rs.filter((_, idx) => idx !== i));
                      setErrors({});
                    }}
                    aria-label={`Remove slot row ${i + 1}`}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
              {errors[i] && <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">{errors[i]}</div>}
            </div>
          ))}
        </div>
        <button
          type="button"
          className={`${smallBtn} ${focusRing}`}
          onClick={() => setRows((rs) => [...rs, { slot_at: "", capacity: "1" }])}
        >
          <Plus size={13} /> Add another slot
        </button>
        <div className="flex justify-end gap-2 pt-2">
          <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={btnPrimary} onClick={submit} disabled={busy}>
            {busy ? "Adding…" : `Add ${rows.length} slot${rows.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AvailabilityChip({ slot }: { slot: Slot }) {
  const past = new Date(slot.slot_at).getTime() < Date.now();
  const left = slot.capacity - slot.booked_count;
  if (past) {
    return (
      <span className="inline-flex rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">
        Past
      </span>
    );
  }
  if (left <= 0) {
    return (
      <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
        Full
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
      {left} open
    </span>
  );
}

function SlotsTab({ req, toast }: { req: Req; toast: ToastFn }) {
  const taRole = useHasRole("TA");
  const taCanEdit = useCanAct("requirements", "edit", taRole);
  const isTA = taRole && taCanEdit;
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slotsError, setSlotsError] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [bookingsError, setBookingsError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [deleteSlot, setDeleteSlot] = useState<Slot | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [copiedToken, setCopiedToken] = useState("");

  const loadSlots = useCallback(async () => {
    setSlotsLoading(true);
    setSlotsError("");
    try {
      const res = await crmGet<Slot[]>(`/api/requirements/${req.id}/slots`);
      setSlots(res.data || []);
    } catch (e: any) {
      setSlotsError(e?.message || "Failed to load interview slots");
    } finally {
      setSlotsLoading(false);
    }
  }, [req.id]);

  const loadBookings = useCallback(async () => {
    setBookingsLoading(true);
    setBookingsError("");
    try {
      const res = await crmGet<Booking[]>(`/api/requirements/${req.id}/bookings`);
      setBookings(res.data || []);
    } catch (e: any) {
      setBookingsError(e?.message || "Failed to load bookings");
    } finally {
      setBookingsLoading(false);
    }
  }, [req.id]);

  useEffect(() => { loadSlots(); }, [loadSlots]);
  useEffect(() => { loadBookings(); }, [loadBookings]);

  const doDeleteSlot = async () => {
    if (!deleteSlot) return;
    setDeleteBusy(true);
    try {
      const res = await crmDelete(`/api/slots/${deleteSlot.id}`);
      toast(res.message || "Slot deleted");
      setDeleteSlot(null);
      loadSlots();
    } catch (e: any) {
      // Surfaces the backend 400 (e.g. "slot has confirmed bookings").
      toast(e?.message || "Failed to delete slot", "err");
      setDeleteSlot(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const copyBookingLink = async (b: Booking) => {
    const url = `${window.location.origin}/book/${b.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(b.token);
      toast("Booking link copied");
      window.setTimeout(() => setCopiedToken((t) => (t === b.token ? "" : t)), 2000);
    } catch {
      toast("Clipboard blocked by the browser — copy the invite link instead", "err");
    }
  };

  const slotCols: Column<Slot>[] = [
    {
      key: "slot_at", label: "Date & time",
      render: (s) => <span className="font-semibold text-primary">{fmtDateTime(s.slot_at)}</span>,
    },
    { key: "capacity", label: "Capacity" },
    { key: "booked_count", label: "Booked" },
    { key: "_availability", label: "Availability", render: (s) => <AvailabilityChip slot={s} /> },
    ...(isTA
      ? [{
          key: "_actions", label: "", className: "!text-right",
          render: (s: Slot) => (
            <span className="flex justify-end">
              <button
                className={`rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 ${focusRing}`}
                onClick={(e) => { e.stopPropagation(); setDeleteSlot(s); }}
                aria-label={`Delete slot ${fmtDateTime(s.slot_at)}`}
              >
                <Trash2 size={14} />
              </button>
            </span>
          ),
        } as Column<Slot>]
      : []),
  ];

  const bookingCols: Column<Booking>[] = [
    {
      key: "candidate_name", label: "Candidate",
      render: (b) => <span className="font-semibold text-primary">{b.candidate_name}</span>,
    },
    { key: "status", label: "Status", render: (b) => <StatusBadge status={b.status} /> },
    { key: "slot_at", label: "Chosen slot", render: (b) => fmtDateTime(b.slot_at) },
    { key: "confirmed_at", label: "Confirmed", render: (b) => fmtDateTime(b.confirmed_at) },
    { key: "created_at", label: "Invited", render: (b) => fmtDate(b.created_at) },
    {
      key: "invite_url", label: "Invite",
      render: (b) => <FileLink url={b.invite_url} label="Invite" />,
    },
    {
      key: "_copy", label: "Booking link",
      render: (b) => (
        <button
          className={`${smallBtn} ${focusRing}`}
          onClick={(e) => { e.stopPropagation(); copyBookingLink(b); }}
          title={`${window.location.origin}/book/${b.token}`}
        >
          <Copy size={13} /> {copiedToken === b.token ? "Copied" : "Copy link"}
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {isTA && (
        <div className="flex justify-end">
          <button className={btnPrimary} onClick={() => setShowAdd(true)}>
            <CalendarPlus size={16} /> Add slots
          </button>
        </div>
      )}

      {slotsError ? (
        <ErrorBox error={slotsError} onRetry={loadSlots} />
      ) : (
        <DataTable<Slot>
          columns={slotCols}
          rows={slots}
          loading={slotsLoading}
          emptyMessage={isTA ? "No interview slots yet — add slots so candidates can book" : "No interview slots yet"}
        />
      )}

      <h2 className="fx-hairline-b pb-1.5 pt-2 text-sm font-bold uppercase tracking-wide text-muted">
        Bookings
      </h2>
      {bookingsError ? (
        <ErrorBox error={bookingsError} onRetry={loadBookings} />
      ) : (
        <DataTable<Booking>
          columns={bookingCols}
          rows={bookings}
          loading={bookingsLoading}
          emptyMessage="No slot invites sent yet"
        />
      )}

      {showAdd && (
        <AddSlotsModal
          reqId={req.id}
          onClose={() => setShowAdd(false)}
          onAdded={loadSlots}
          toast={toast}
        />
      )}
      {deleteSlot && (
        <ConfirmModal
          title="Delete interview slot"
          message={
            <>
              Delete the slot on <span className="font-semibold">{fmtDateTime(deleteSlot.slot_at)}</span>
              {deleteSlot.booked_count > 0 && (
                <> ({deleteSlot.booked_count} booking{deleteSlot.booked_count === 1 ? "" : "s"})</>
              )}
              ? Slots with confirmed bookings cannot be deleted.
            </>
          }
          confirmLabel="Delete slot"
          danger
          busy={deleteBusy}
          onConfirm={doDeleteSlot}
          onClose={() => setDeleteSlot(null)}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------- activity tab */

function ActivityTab({ reqId }: { reqId: number }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    setLoading(true);
    crmGet<any[]>(`/api/requirements/${reqId}/activity-log`)
      .then((r) => setEntries((r.data || []).map((e: any) => ({ ...e, timestamp: e.timestamp || "" }))))
      .catch((e: any) => setError(e?.message || "Failed to load activity log"))
      .finally(() => setLoading(false));
  }, [reqId]);
  if (loading) return <Spinner label="Loading activity…" />;
  if (error) return <ErrorBox error={error} />;
  return (
    <div className="rounded-card border border-subtle bg-surface-1 p-5 shadow-sm">
      <Timeline entries={entries} />
    </div>
  );
}

/* --------------------------------------------------------------- detail */

/** Deep links (8 Sep 2026, user report): a notification link may name the
 *  tab (`?tab=resumes` = Applied Candidates) and a search term (`?q=`) so the
 *  reader lands on the candidate the mail was about instead of the page top.
 *  Unknown tab values fall back to Applied Candidates. */
const REQUIREMENT_TABS = ["details", "postings", "resumes", "slots", "applicants", "suggested", "activity"];


export function deepLinkSearch(): string {
  try {
    return (new URLSearchParams(window.location.search).get("q") || "").trim().slice(0, 120);
  } catch {
    return "";
  }
}

export function RequirementDetailPage() {
  const params = useCrmParams();
  const id = Number(params.id);
  const me = useMe();
  const [toastNode, toast] = useToast();

  const taRole = useHasRole("TA");
  const taCanEdit = useCanAct("requirements", "edit", taRole);
  const isTA = taRole && taCanEdit;
  const isSalesHead = useCanAct("requirements", "edit", useHasRole("Sales_Head"));
  const isRMG = useCanAct("requirements", "edit", useHasRole("RMG"));
  /* The server's JD_EDIT_ROLES (RMG · Sales · Sales Head · TA; a GM / any custom
     role through the requirements Edit grant) — the ONE client mirror. */
  const jdEditGrant = useCanAct("requirements", "edit", useHasRole("RMG", "Sales", "Sales_Head", "TA"));
  /* …or whoever screens as RMG — a GM custom role (2 Oct 2026; server `JD_EDIT_GATE` = screener_or). */
  const jdScreener = useCanApprove("profile.rmg_screening");
  const canApproveSalesHead = useCanApprove("requirement.sales_head_approve");
  const canApproveEngineering = useCanApprove("requirement.engineering_approve");
  const canSeeResumes = useCanAct("requirements", "view", useHasRole("TA", "RMG", "Sales_Head"));
  const isAdmin = me.roles.includes("Admin");

  const [req, setReq] = useState<Req | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [locationName, setLocationName] = useState("");
  /* Land on the candidates, not the portal log (28 Aug 2026, user request) —
     every role's first question here is "who applied?". If the user can't see
     that tab, the effect below snaps to their first visible one. */
  const [tab, setTab] = usePageTab<string>("tab", "resumes", REQUIREMENT_TABS);
  /* Sub-tab access (25 Aug 2026): templates hide detail tabs via the
   * `tab:<key>` field entries on the requirements tab ("Hidden" mode).
   * These hooks MUST sit here, above the early returns below — placing them
   * lower violates rules-of-hooks and blanked the whole page (seen live). */
  const reqAcc = useCrmAccess("requirements");
  /* Job Postings hides until USED (28 Aug 2026, user decision): the team
     doesn't log portal ads today, so the tab was noise. It reappears the
     moment a posting exists; Admin/CEO always see it so someone can log the
     first one (that first posting also drives the "Posted" pipeline stage). */
  const isAdminUser = useHasRole("Admin");
  const showPostings = isAdminUser || (req?.job_postings_count ?? 0) > 0;
  /* A TA works every applicant from Applied Candidates (28 Sep 2026, user
     request) — the separate Applicants tab was the same people twice. Other
     roles (RMG, Sales, Admin) keep it. */
  const hasTaRole = useHasRole("TA");
  const hasOtherWorkRole = useHasRole("RMG", "Sales", "Sales_Head");
  /* RMG / GM screen and interview (28 Sep 2026, user request): they never
     SOURCE, so "Applicants" (the same people as Applied Candidates) and
     "Suggested Candidates" (people TA could still apply) are TA's and Sales'
     tabs, not theirs. A screener who also holds a sourcing / selling role
     (TA · Sales · Sales Head) or Admin keeps them. */
  const screensCandidates = useCanApprove("profile.rmg_screening");
  const sourcesOrSells = useHasRole("TA", "Sales", "Sales_Head");
  const screenerOnly = screensCandidates && !sourcesOrSells;
  const showApplicantsTab = !(hasTaRole && !hasOtherWorkRole) && !screenerOnly;
  const showSuggestedTab = !screenerOnly;
  const visibleTabKeys = ["details", ...(showPostings ? ["postings"] : []),
    ...(canSeeResumes || screenerOnly ? ["resumes", "slots"] : []),
    ...(showApplicantsTab ? ["applicants"] : []),
    ...(showSuggestedTab ? ["suggested"] : []), "activity"].filter((k) => reqAcc.subTabVisible(`tab:${k}`));
  useEffect(() => {
    /* A hidden sub-tab must not stay selected (e.g. the TA default "resumes"
     * when a template hides it) — fall to the first visible one. */
    /* A candidate link meant for Applied Candidates (`tab=resumes&q=`) lands
       on Applicants for a role without that tab (plain Sales, 29 Sep 2026) —
       the same people, with the search pre-filled — instead of Details. */
    if (visibleTabKeys.length && !visibleTabKeys.includes(tab)) {
      const fallback = tab === "resumes" && visibleTabKeys.includes("applicants") ? "applicants" : visibleTabKeys[0];
      setTab(fallback, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTabKeys.join(","), tab]);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [decision, setDecision] = useState<{ stage: "sales-head" | "engineering"; kind: "approve" | "reject" } | null>(null);
  const [confirmTerminal, setConfirmTerminal] = useState<"close" | "cancel" | null>(null);
  /* RMG Hold / Resume / priority (25 Aug 2026). */
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdNote, setHoldNote] = useState("");
  const [holdErr, setHoldErr] = useState("");
  const [priorityBusy, setPriorityBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [activityKey, setActivityKey] = useState(0); // bump to force activity reload
  // Bumped after a bulk/one-click apply so the Applicants tab re-fetches.
  const [applicantsKey, setApplicantsKey] = useState(0);
  const canApplyHere = useCanAct("profiles", "create", useHasRole("TA", "Sales", "RMG"));
  const [linkedTemplate, setLinkedTemplate] = useState<{
    template_name?: string | null;
    template_job_id?: string | null;
    tr_number?: string;
    status?: string;
  } | null>(null);
  /* The live (not cancelled) template request of this opportunity, ready or
     not (1 Oct 2026): while one exists TA's Request template button is
     replaced by its number — the server refuses a second one anyway. */
  const [openTemplateRequest, setOpenTemplateRequest] = useState<{
    id: number; tr_number?: string; status?: string; template_job_id?: string | null;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<Req>(`/api/requirements/${id}`);
      setReq(res.data);
    } catch (e: any) {
      setError(e?.message || "Failed to load requirement");
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  // Quiet re-read when the reader comes back to the tab: no spinner, so the
  // open tab and anything typed below it stay put — only the header (status,
  // hold, stage) catches up with what Sales did meanwhile.
  useRefetchOnFocus(useCallback(() => {
    crmGet<Req>(`/api/requirements/${id}`).then((r) => setReq(r.data)).catch(() => {});
  }, [id]));

  /* Template requests are one per OPPORTUNITY (the server's rule), so they are
     read by the opportunity once it is known, else by this requirement. */
  const tplOppId = req?.opportunity_id;
  useEffect(() => {
    crmGet<any[]>(`/api/template-requests${qs(tplOppId
      ? { opportunity_id: tplOppId, limit: 20 } : { requirement_id: id, limit: 20 })}`)
      .then((r) => {
        const rows = r.data || [];
        // Mirrors the backend bridge: a non-null template_job_id is what makes
        // an AI L1 runnable, regardless of the request's exact status.
        const ready = rows.find((t) => t.template_job_id);
        setLinkedTemplate(ready || null);
        setOpenTemplateRequest(rows.find((t) => t.status !== "Cancelled") || null);
      })
      .catch(() => { setLinkedTemplate(null); setOpenTemplateRequest(null); });
  }, [id, tplOppId, activityKey]);

  /* The payload names the customer itself (28 Sep 2026). The old lookup went
     through /api/customers/{id}, which is gated to the Customers tab — so TA,
     RMG and GM read "Customer #60". The open /names list is the fallback for
     an older server. */
  const reqCustomerName = (req as any)?.customer_name as string | undefined;
  useEffect(() => {
    if (!req?.customer_id) { setCustomerName(""); return; }
    if (reqCustomerName) { setCustomerName(reqCustomerName); return; }
    let alive = true;
    crmGet<{ id: number; name: string }[]>("/api/customers/names")
      .then((r) => { if (alive) setCustomerName((r.data || []).find((c) => c.id === req.customer_id)?.name || ""); })
      .catch(() => { if (alive) setCustomerName(""); });
    return () => { alive = false; };
  }, [req?.customer_id, reqCustomerName]);

  useEffect(() => {
    if (!req?.location_id) { setLocationName(""); return; }
    crmGet<any>(`/api/locations/${req.location_id}`)
      .then((r) => setLocationName(r.data ? [r.data.city, r.data.state, r.data.country].filter(Boolean).join(", ") : ""))
      .catch(() => setLocationName(""));
  }, [req?.location_id]);

  const onChanged = useCallback((updated?: Req) => {
    if (updated) setReq(updated);
    else load();
    setActivityKey((k) => k + 1);
  }, [load]);

  if (loading && !req) return <Spinner label="Loading requirement…" />;
  if (error && !req) return <ErrorBox error={error} onRetry={load} />;
  if (!req) return <ErrorBox error="Requirement not found" />;

  const isCreatorSales = isAdmin || (me.roles.includes("Sales") && req.created_by === me.id);
  const canEdit = isCreatorSales && EDITABLE_STATUSES.includes(req.status);
  const canSubmit = canEdit;
  // Approval buttons (25 Sep 2026): `me.approvals`, the same answer as the server gate.
  const canSalesHeadDecide = canApproveSalesHead && req.status === "Pending_Sales_Head_Approval";
  const canRmgDecide = canApproveEngineering && req.status === "Pending_Engineering_Review";
  const canTerminate = isSalesHead && !TERMINAL_STATUSES.includes(req.status);
  /* JD & skills fix-up (15 Sep 2026): RMG / Sales / Sales Head / Admin at any
     open status — the full edit form stays creator + Draft/Rejected only.
     TA too (30 Sep 2026, user ask): a recruiter holding the JD file attaches
     it here; the server's JD_EDIT_ROLES is the same list. */
  const canEditJdSkills = !TERMINAL_STATUSES.includes(req.status) && (isAdmin || jdEditGrant || jdScreener);
  /* RMG sourcing controls (25 Aug 2026): Hold / Resume / Reject + priority. */
  const canHoldControl = isRMG || isSalesHead;
  const canHold = canHoldControl && SOURCING_STATUSES.includes(req.status);
  const canResume = canHoldControl && req.status === "On_Hold";
  const canRmgReject = isRMG && !TERMINAL_STATUSES.includes(req.status)
    && !["Draft", "Pending_Sales_Head_Approval"].includes(req.status);

  const doHold = async () => {
    if (holdNote.trim().length < 10) {
      setHoldErr("A hold reason of at least 10 characters is required");
      return;
    }
    setActionBusy(true);
    try {
      const res = await crmPost<Req>(`/api/requirements/${req.id}/hold`, { reason: holdNote.trim() });
      toast(res.message || "Requirement put on hold");
      setHoldOpen(false);
      onChanged(res.data);
    } catch (e: any) {
      toast(e?.message || "Hold failed", "err");
    } finally {
      setActionBusy(false);
    }
  };

  const doResume = async () => {
    setActionBusy(true);
    try {
      const res = await crmPost<Req>(`/api/requirements/${req.id}/resume`);
      toast(res.message || "Sourcing resumed");
      onChanged(res.data);
    } catch (e: any) {
      toast(e?.message || "Resume failed", "err");
    } finally {
      setActionBusy(false);
    }
  };

  const setPriority = async (p: string) => {
    setPriorityBusy(true);
    try {
      const res = await crmPatch<Req>(`/api/requirements/${req.id}/priority`, { priority: p });
      toast(res.message || `Priority set to ${p}`);
      onChanged(res.data);
    } catch (e: any) {
      toast(e?.message || "Priority update failed", "err");
    } finally {
      setPriorityBusy(false);
    }
  };

  const doSubmit = async () => {
    setActionBusy(true);
    try {
      const res = await crmPost<Req>(`/api/requirements/${req.id}/submit`);
      toast(res.message || "Submitted for Sales Head approval");
      setConfirmSubmit(false);
      onChanged(res.data);
    } catch (e: any) {
      toast(e?.message || "Submit failed", "err");
    } finally {
      setActionBusy(false);
    }
  };

  const doRequestTemplate = async () => {
    setActionBusy(true);
    try {
      const res = await crmPost<any>(`/api/template-requests`, { requirement_id: req.id });
      toast(res.message || "Template request raised for RMG");
      // Stay on the opportunity: the button turns into "Template requested".
      if (res.data) setOpenTemplateRequest(res.data);
      setActivityKey((k) => k + 1);
    } catch (e: any) {
      toast(e?.message || "Failed to raise template request", "err");
      setActivityKey((k) => k + 1);   // a 409 means one exists — show it
    } finally {
      setActionBusy(false);
    }
  };

  const doTerminal = async () => {
    if (!confirmTerminal) return;
    setActionBusy(true);
    try {
      const res = await crmPost<Req>(`/api/requirements/${req.id}/${confirmTerminal}`);
      toast(res.message || `Requirement ${confirmTerminal}d`);
      setConfirmTerminal(null);
      onChanged(res.data);
    } catch (e: any) {
      toast(e?.message || "Action failed", "err");
    } finally {
      setActionBusy(false);
    }
  };

  const detailTabs = [
    // Reference material first (user decision, 25 Aug 2026): the four cards
    // live ONLY here now, instead of trailing below every tab.
    { key: "details", label: "Details" },
    ...(showPostings ? [{ key: "postings", label: "Job Postings" }] : []),
    ...(canSeeResumes || screenerOnly
      ? [
          // Renamed from "Resumes" (user decision, 25 Aug 2026): every resume
          // here IS an application, so the tab is named for the people.
          { key: "resumes", label: "Applied Candidates" },
          { key: "slots", label: "Interview History" },
        ]
      : []),
    // TA works the same opportunity from here (18 Aug 2026): who already
    // applied, and who in the database still could — the two tabs Admin/CEO
    // had on the opportunity page, now where sourcing actually happens.
    ...(showApplicantsTab ? [{ key: "applicants", label: "Applicants" }] : []),
    ...(showSuggestedTab ? [{ key: "suggested", label: "Suggested Candidates" }] : []),
    { key: "activity", label: "Activity Log" },
  ].filter((t) => reqAcc.subTabVisible(`tab:${t.key}`));

  return (
    <div className="space-y-4">
      {toastNode}

      {/* header — gradient identity band (29 Sep 2026 redesign). Who the
          position is for, where, how many, what budget, by when; the action
          bar underneath carries exactly the buttons it always did. */}
      <header className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="relative bg-gradient-to-r from-sky-700 via-brand-700 to-indigo-800 px-4 py-5 text-white sm:px-6">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-white/10 blur-2xl" />
          <CrmLink
            to="requirements"
            className="relative mb-3 inline-flex items-center gap-1 text-xs font-semibold text-white/80 hover:text-white"
          >
            <ArrowLeft size={13} /> Opportunities
          </CrmLink>
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 hidden h-12 w-12 shrink-0 items-center justify-center rounded-card bg-white/15 ring-1 ring-inset ring-white/25 sm:inline-flex">
                <Briefcase size={22} aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white/15 px-2.5 py-0.5 font-mono text-xs font-bold ring-1 ring-inset ring-white/25">
                    {reqLabel(req)}
                  </span>
                  <span className="rounded-full bg-white px-1 py-0.5 shadow-raised">
                    <StatusBadge status={req.status} />
                  </span>
                </div>
                <h1 className="text-display mt-1.5 break-words text-xl font-bold leading-tight sm:text-2xl">
                  <span className="sr-only">{reqLabel(req)} — </span>{req.title}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/85">
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 size={14} aria-hidden />
                    {customerName || req.customer_name || (req.customer_id != null ? "Customer" : "No customer")}
                  </span>
                  {(req.work_mode || locationName || req.location_name) && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin size={14} aria-hidden />
                      {[locationName || req.location_name, req.work_mode].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[11px] font-bold uppercase tracking-wider text-white/70">Priority</span>
              {(isRMG || isSalesHead || isAdmin) ? (
                /* RMG/Sales_Head set urgency inline (25 Aug 2026) — deliberately
                   not the full edit form, which exposes budget fields. */
                <select
                  className="inline-block rounded-control border border-white/30 bg-white px-2 py-1 text-xs font-semibold text-slate-800"
                  value={req.priority}
                  disabled={priorityBusy}
                  onChange={(e) => void setPriority(e.target.value)}
                  title="Set the sourcing priority"
                >
                  {["Low", "Medium", "High"].map((p) => <option key={p} value={p}>{p} priority</option>)}
                </select>
              ) : (
                <span className="rounded-full bg-white px-1 py-0.5"><PriorityPill p={req.priority} /></span>
              )}
            </div>
          </div>

          {/* The overview strip (18 Aug 2026) now lives on the band: the page
              opens as a one-line answer to "what is this position?". */}
          <dl className="relative mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <BandFact icon={UsersRound} label="Positions" value={`${req.no_of_positions ?? "—"} ${req.no_of_positions === 1 ? "position" : "positions"}`} />
            <BandFact icon={Wallet} label="Budget CTC" value={fmtRange(req.budget_ctc_min, req.budget_ctc_max, "")} />
            <BandFact icon={GraduationCap} label="Experience" value={fmtRange(req.experience_min, req.experience_max, "yrs")} />
            <BandFact icon={Layers} label="Work mode" value={req.work_mode || "—"} />
            <BandFact icon={MapPin} label="Location" value={locationName || "—"} />
            <BandFact icon={CalendarDays} label="Target closure" value={(() => {
              const due = dueChip(req.target_closure_date, req.status);
              return <>{fmtDate(req.target_closure_date)}{due && <span className="block text-xs font-bold text-amber-200">{due.label}</span>}</>;
            })()} />
          </dl>
        </div>

        {/* action bar */}
        {(canEdit || canSubmit || (isTA && SOURCING_STATUSES.includes(req.status)) || canSalesHeadDecide
          || canRmgDecide || canHold || canResume || canRmgReject || canTerminate) && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
          {canEdit && (
            <button className={btnSecondary} onClick={() => setShowEdit(true)}>
              <Pencil size={15} /> Edit
            </button>
          )}
          {canSubmit && (
            <button className={btnPrimary} onClick={() => setConfirmSubmit(true)}>
              <Send size={15} /> Submit for Approval
            </button>
          )}
          {isTA && SOURCING_STATUSES.includes(req.status) && !linkedTemplate && (openTemplateRequest ? (
            <button type="button" className={`${btnSecondary} !border-emerald-300 !bg-emerald-50 !text-emerald-800 dark:!border-emerald-800 dark:!bg-emerald-950/30 dark:!text-emerald-300`}
              onClick={() => crmNavigate("template-requests")}
              title="A template is already requested for this opportunity — open Template Requests to follow it up">
              <Check size={15} /> Template requested · {openTemplateRequest.tr_number || `#${openTemplateRequest.id}`}
            </button>
          ) : (
            <button className={btnSecondary} onClick={doRequestTemplate} disabled={actionBusy}>
              <Send size={15} /> Request template
            </button>
          ))}
          {canSalesHeadDecide && (
            <>
              <button className={btnPrimary} onClick={() => setDecision({ stage: "sales-head", kind: "approve" })}>
                <Check size={15} /> Approve
              </button>
              <button className={btnDanger} onClick={() => setDecision({ stage: "sales-head", kind: "reject" })}>
                <X size={15} /> Reject
              </button>
            </>
          )}
          {canRmgDecide && (
            <>
              <button className={btnPrimary} onClick={() => setDecision({ stage: "engineering", kind: "approve" })}>
                <Check size={15} /> RMG Approve
              </button>
              <button className={btnDanger} onClick={() => setDecision({ stage: "engineering", kind: "reject" })}>
                <X size={15} /> RMG Reject
              </button>
            </>
          )}
          {canHold && (
            <button className={btnSecondary} onClick={() => { setHoldOpen(true); setHoldNote(""); setHoldErr(""); }}
              title="Pause sourcing — uploads, slot invites and AI L1 scheduling stop until resumed">
              <Pause size={15} /> Hold
            </button>
          )}
          {canResume && (
            <button className={btnPrimary} onClick={() => void doResume()} disabled={actionBusy}>
              {actionBusy ? "Resuming…" : "Resume sourcing"}
            </button>
          )}
          {canRmgReject && !canTerminate && (
            <button className={btnDanger} onClick={() => setConfirmTerminal("cancel")}
              title="Reject this requirement — a reason is recorded and the creator is notified">
              Reject
            </button>
          )}
          {canTerminate && (
            <>
              <button className={btnSecondary} onClick={() => setConfirmTerminal("close")}>Close</button>
              <button className={btnDanger} onClick={() => setConfirmTerminal("cancel")}>Cancel</button>
            </>
          )}
        </div>
        )}
      </header>

      {/* On-hold banner: the reason is the first thing anyone needs to know. */}
      {req.status === "On_Hold" && (
        <div className="rounded-card border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
          <div className="flex items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-amber-300"><Pause size={14} aria-hidden /> Sourcing on hold</div>
          <div className="mt-0.5 text-sm text-amber-800 dark:text-amber-300">
            {req.held_reason || "No reason recorded."}{" "}
            <span className="text-xs opacity-80">
              Uploads, slot invites and AI L1 scheduling are paused; candidates already in the
              pipeline are unaffected.
            </span>
          </div>
        </div>
      )}

      {/* rejection reasons */}
      {req.status === "Sales_Head_Rejected" && req.sales_head_rejection_reason && (
        <div className="rounded-card border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-800 dark:bg-rose-950/40">
          <div className="flex items-center gap-1.5 text-sm font-bold text-rose-700 dark:text-rose-300"><X size={14} aria-hidden /> Rejected by Sales Head</div>
          <div className="mt-0.5 text-sm text-rose-700 dark:text-rose-300">{req.sales_head_rejection_reason}</div>
        </div>
      )}
      {req.status === "Engineering_Rejected" && req.engineering_rejection_reason && (
        <div className="rounded-card border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-800 dark:bg-rose-950/40">
          <div className="flex items-center gap-1.5 text-sm font-bold text-rose-700 dark:text-rose-300"><X size={14} aria-hidden /> Rejected by RMG</div>
          <div className="mt-0.5 text-sm text-rose-700 dark:text-rose-300">{req.engineering_rejection_reason}</div>
        </div>
      )}

      {/* The Draft → Sales Head → RMG Review → Sourcing stepper was removed
          (28 Sep 2026, user request): the status badge in the header already
          says where the position is, and the stepper repeated it. */}

      {linkedTemplate ? (
        <div className="flex items-start gap-3 rounded-card fx-gradient-border-animated bg-surface-1 px-4 py-3 shadow-sm">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-raised">
            <Bot size={17} aria-hidden />
          </span>
          <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden />
            AI L1 template ready
          </div>
          <div className="mt-1 text-sm font-semibold text-primary">
            {linkedTemplate.template_name || "Template"}
            {linkedTemplate.template_job_id ? (
              <span className="ml-2 font-mono text-xs font-normal text-muted">
                {linkedTemplate.template_job_id}
              </span>
            ) : null}
          </div>
          {linkedTemplate.tr_number && (
            <div className="mt-0.5 text-xs text-muted">
              From {linkedTemplate.tr_number} · {String(linkedTemplate.status || "").replace(/_/g, " ")}
            </div>
          )}
          </div>
        </div>
      ) : (
        /* Always answer "can I run an AI L1 yet?" — before this, no template
           meant NO card, and the TA only learned at scheduling time (a 400). */
        <div className="flex items-start gap-3 rounded-card border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/25">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-amber-500 text-white shadow-raised">
            <Bot size={17} aria-hidden />
          </span>
          <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
            No AI L1 template yet
          </div>
          <div className="mt-1 text-sm text-amber-800 dark:text-amber-300">
            The AI L1 interview cannot run for this opportunity until RMG links a template.
            {openTemplateRequest
              ? ` Requested in ${openTemplateRequest.tr_number || "a template request"} — waiting for RMG to build it.`
              : isTA && SOURCING_STATUSES.includes(req.status)
                ? " Use the Request template button above to ask RMG."
                : " A Template Request must be raised and fulfilled by RMG."}
          </div>
          </div>
        </div>
      )}

      {/* Headcount, and the RMG approval it moves through (21 Sep 2026). */}
      <PositionsPanel
        target={{ requirementId: req.id, label: req.opportunity_opp_id || req.req_number,
                  title: req.title, status: req.status }}
        toast={toast}
        onChanged={() => onChanged()}
      />

      {/* The TAs assigned to source it (1 Oct 2026); the priority control on
          the band above stays — this prints it read-only for everyone else. */}
      <PositionTeamPanel
        requirementId={req.id}
        label={req.opportunity_opp_id || req.req_number}
        priority={req.priority}
        showPriority={false}
        toast={toast}
        onChanged={() => onChanged()}
      />

      {/* tabs — placed directly under the summary so recruiters land on the
          working area (Resumes / Suggested Candidates). The reference cards
          live in the Details tab. */}
      <DetailTabStrip tabs={detailTabs} active={tab} onChange={setTab} />
      {tab === "postings" && <JobPostingsTab req={req} toast={toast} onRequirementChanged={() => onChanged()} />}
      {tab === "resumes" && (canSeeResumes || screenerOnly) && (
        <ResumesTab req={req} toast={toast} onRequirementChanged={() => onChanged()} />
      )}
      {tab === "slots" && (canSeeResumes || screenerOnly) && <InterviewHistoryTab req={req} toast={toast} />}
      {tab === "applicants" && showApplicantsTab && (
        <RequirementApplicantsTab key={applicantsKey} oppId={req.opportunity_id} toast={toast} />
      )}
      {tab === "suggested" && showSuggestedTab && (
        <div className="rounded-card border border-subtle bg-surface-1 p-5 shadow-sm">
          <SuggestedCandidatesTab
            oppId={req.opportunity_id}
            canApply={canApplyHere}
            onApplied={() => setApplicantsKey((k) => k + 1)}
            showToast={(m: string) => toast(m)}
          />
        </div>
      )}
      {tab === "activity" && <ActivityTab key={activityKey} reqId={req.id} />}

      {/* Requirement reference — its own Details tab (user decision,
          25 Aug 2026). Previously these four cards trailed below every tab;
          now they live ONLY here, expanded, and the working tabs stay clean. */}
      {tab === "details" && (<>
      <CollapsibleCard title={<SectionTitle icon={FileText}>Requirement Details</SectionTitle>} defaultOpen>
        {req.description
          ? <p className="mb-4 whitespace-pre-wrap text-sm text-primary">{req.description}</p>
          : <p className="mb-4 text-sm text-muted">No description provided.</p>}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
          {([
            ["Experience", fmtRange(req.experience_min, req.experience_max, "yrs")],
            ["Budget CTC", fmtRange(req.budget_ctc_min, req.budget_ctc_max, "")],
            ["Work mode", req.work_mode || "—"],
            ["Location", locationName || "—"],
            ["Positions", String(req.no_of_positions ?? "—")],
            ["Target closure", fmtDate(req.target_closure_date)],
            ["Created", fmtDate(req.created_at)],
          ] as [string, string][]).map(([label, value]) => (
            <div key={label} className="flex justify-between gap-2">
              <dt className="text-muted">{label}</dt>
              <dd className="font-semibold text-primary">{value}</dd>
            </div>
          ))}
        </dl>
      </CollapsibleCard>

      {(req as any).ctc_bands?.length > 0 && (
        <CollapsibleCard title={<SectionTitle icon={Wallet} tone="from-emerald-500 to-teal-600">Budget by Experience</SectionTitle>} defaultOpen>
          {/* The slab's sourcing columns. Rate, monthly/annual revenue,
              management cost %, hike % and appraisal cycles are withheld by
              the SERVER (routers/crm/requirements.py::_safe_ctc_bands) — they
              reveal the margin and belong to Sales. */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="py-1 pr-4">Exp Min</th>
                  <th className="py-1 pr-4">Exp Max</th>
                  <th className="py-1 pr-4">Target Exp</th>
                  <th className="py-1 pr-4 text-right">Engineering Budget</th>
                  <th className="py-1 text-right">Approved CTC [Lac]</th>
                </tr>
              </thead>
              <tbody>
                {(req as any).ctc_bands.map((b: any, i: number) => {
                  const num = (v: any) => (v === null || v === undefined
                    ? "—"
                    : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
                  const yrs = (v: any) => (v === null || v === undefined ? "—" : `${Number(v)}`);
                  return (
                    <tr key={i} className="border-t border-subtle">
                      <td className="py-1.5 pr-4 text-primary">{yrs(b.exp_min)}</td>
                      <td className="py-1.5 pr-4 text-primary">{yrs(b.exp_max)}</td>
                      <td className="py-1.5 pr-4 text-primary">{yrs(b.target_exp)}</td>
                      <td className="py-1.5 pr-4 text-right text-primary">{num(b.engineering_budget)}</td>
                      <td className="py-1.5 text-right font-semibold text-primary">{num(b.approved_ctc_lac)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CollapsibleCard>
      )}

      <JdSkillsCard req={req} canEdit={canEditJdSkills} toast={toast} onSaved={(u) => onChanged(u)} />
      </>)}

      {/* modals */}
      {showEdit && (
        <RequirementFormModal
          initial={req}
          onClose={() => setShowEdit(false)}
          onSaved={(r) => onChanged(r)}
          toast={toast}
        />
      )}
      {confirmSubmit && (
        <ConfirmModal
          title="Submit for approval"
          message={
            <>
              Submit <span className="font-semibold">{reqLabel(req)} — “{req.title}”</span> for Sales Head approval?
              {req.status !== "Draft" && " This resubmits the previously rejected requirement."}
            </>
          }
          confirmLabel="Submit"
          busy={actionBusy}
          onConfirm={doSubmit}
          onClose={() => setConfirmSubmit(false)}
        />
      )}
      {decision && (
        <DecisionModal
          req={req}
          stage={decision.stage}
          kind={decision.kind}
          onClose={() => setDecision(null)}
          onDone={(r) => onChanged(r)}
          toast={toast}
        />
      )}
      {holdOpen && (
        <Modal title="Put sourcing on hold" onClose={() => { if (!actionBusy) setHoldOpen(false); }}>
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              Pausing <b>{reqLabel(req)} — {req.title}</b>: new uploads, slot invites and AI L1
              scheduling stop until someone resumes it. Candidates already in the pipeline are
              unaffected. The TA team and the creator are notified with your reason.
            </p>
            <Field label="Reason" required error={holdErr}>
              <textarea
                className={`${inputCls}${holdErr ? " input-error" : ""}`}
                rows={3}
                value={holdNote}
                onChange={(e) => { setHoldNote(e.target.value); setHoldErr(""); }}
                placeholder="Why is sourcing being paused? (min 10 characters)"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button className={btnSecondary} onClick={() => setHoldOpen(false)} disabled={actionBusy}>Cancel</button>
              <button className={btnPrimary} onClick={() => void doHold()} disabled={actionBusy}>
                {actionBusy ? "Working…" : "Put on hold & notify"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {confirmTerminal && (
        <ConfirmModal
          title={confirmTerminal === "close" ? "Close requirement" : "Cancel requirement"}
          message={
            <>
              {confirmTerminal === "close" ? "Close" : "Cancel"}{" "}
              <span className="font-semibold">{reqLabel(req)} — “{req.title}”</span>? This is a terminal state and
              cannot be undone.
            </>
          }
          confirmLabel={confirmTerminal === "close" ? "Close requirement" : "Cancel requirement"}
          danger
          busy={actionBusy}
          onConfirm={doTerminal}
          onClose={() => setConfirmTerminal(null)}
        />
      )}
    </div>
  );
}
