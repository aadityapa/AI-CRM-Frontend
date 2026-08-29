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
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle, ArrowLeft, Bot, CalendarPlus, Check, ClipboardCheck, ClipboardList, Copy, ExternalLink, FileUp, Link2, Pencil, Plus, RefreshCw, ScanLine, Send, Star, Trash2, UserPlus, X,
} from "lucide-react";
import { crmDelete, crmGet, crmPatch, crmPost, crmPut, crmUpload, qs } from "../api";
import { SearchableSelect } from "../components/SearchableSelect";
import { ScheduleAiInterviewModal } from "../components/ScheduleAiInterviewModal";
import { fetchAllMaster } from "../lib/fetchAllMaster";
import type { Meta } from "../api";
import { CrmLink, crmNavigate, useCrmParams } from "../routerHooks";
import { useHasRole, useMe } from "../CrmApp";
import { useCanAct, useCrmAccess } from "../useAccess";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { FileLink, FileUploadButton } from "../components/FileUpload";
import { Timeline } from "../components/Timeline";
import type { ActivityEntry } from "../components/Timeline";
import {
  AiThinking, ConfirmModal, ErrorBox, Field, Modal, Spinner, StatusBadge, Tabs,
  btnDanger, btnPrimary, btnSecondary, inputCls, useToast, selfWithdrewLabel } from "../components/ui";
import { TeachingEmpty } from "../components/TeachingEmpty";
// Same DB-scan component the opportunity page uses — one implementation, so
// TA and Sales always see identical matching logic (18 Aug 2026).
import { CollapsibleCard, SuggestedCandidatesTab } from "./Opportunities";
import {
  SectionHeaderBanner, FieldLabel, WizardField, InfoChip, lockedInputCls,
} from "../components/wizard";

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
  // Who may schedule the AI L1 from here (Admin/CEO pass via useHasRole).
  const canSchedule = useCanAct("profiles", "edit", useHasRole("TA"));
  const isRmg = useCanAct("requirements", "edit", useHasRole("RMG"));
  const isTA = useCanAct("requirements", "edit", useHasRole("TA"));
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scheduleRow, setScheduleRow] = useState<any | null>(null);
  /* Filters (25 Aug 2026): search by name/email, and "who submitted". */
  const [q, setQ] = useState("");
  const [appliedBy, setAppliedBy] = useState("");
  /* RMG decide + TA reject-with-note modals. */
  const [decideRow, setDecideRow] = useState<{ row: any; kind: "rmg-shortlist" | "rmg-reject" | "ta-reject" } | null>(null);
  const [decideNote, setDecideNote] = useState("");
  const [decideErr, setDecideErr] = useState("");
  const [decideBusy, setDecideBusy] = useState(false);
  /* Bulk shortlist (25 Aug 2026): RMG ticks Pending rows and clears them in
   * one click. Rejects stay one-by-one — each needs its own note. */
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

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
    ...(isRmg && pendingVisible.length > 0 ? [{
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
    { key: "pipeline_status", label: "Stage",
      render: (r) => <StatusBadge status={r.pipeline_status} label={selfWithdrewLabel(r.pipeline_status, r.withdrawn_from_status)} /> },
    { key: "rmg_screening_status", label: "RMG Screening",
      render: (r) => <RmgScreeningBadge status={r.rmg_screening_status} /> },
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
      const l1Blocked = gate === "Pending" || gate === "Rejected";
      const rejectedStages = ["Rejected", "Sales_Rejected", "RMG_Rejected", "Customer_Rejected", "Self_Withdrawn"];
      return (
        <div className="flex flex-wrap justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          {isRmg && gate === "Pending" && (
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
          {canSchedule && (
            <button
              className={`${btnSecondary} !px-2.5 !py-1 text-xs`}
              disabled={l1Blocked}
              onClick={() => setScheduleRow(r)}
              title={gate === "Pending"
                ? "Locked until RMG shortlists this candidate"
                : gate === "Rejected"
                  ? "RMG rejected this candidate at screening"
                  : "Schedule the AI L1 interview for this applicant"}
            >
              <CalendarPlus size={13} /> Schedule L1
            </button>
          )}
          {isTA && !rejectedStages.includes(r.pipeline_status) && (
            <button className={`${btnSecondary} !px-2.5 !py-1 text-xs text-rose-600 dark:text-rose-300`}
              onClick={() => { setDecideRow({ row: r, kind: "ta-reject" }); setDecideNote(""); setDecideErr(""); }}
              title="Candidate not interested / dropped out — reject with a note">
              <X size={13} /> Reject
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
        {isRmg && selected.size > 0 && (
          <button className={btnPrimary} disabled={bulkBusy} onClick={() => void bulkShortlist()}>
            <Check size={15} /> {bulkBusy ? "Shortlisting…" : `Shortlist selected (${selected.size})`}
          </button>
        )}
      </div>
      {error ? <ErrorBox error={error} /> : (
        <DataTable columns={cols} rows={visible} loading={loading}
          emptyMessage={rows.length === 0
            ? "Nobody has applied to this opportunity yet — check Suggested Candidates for people who already fit."
            : "No applicants match the current filters."}
          onRowClick={(r: any) => crmNavigate(`profiles/${r.id}`)} />
      )}
      {scheduleRow && (
        <ScheduleAiInterviewModal
          profileId={scheduleRow.id}
          candidate={{ full_name: scheduleRow.candidate_name, email: scheduleRow.email }}
          onClose={() => setScheduleRow(null)}
          onDone={() => { setScheduleRow(null); load(); }}
          showToast={(m, k) => toast(m, k)}
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
  /** The id every role tracks — the parent opportunity's (18 Aug 2026). */
  opportunity_opp_id?: string | null;
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
};

type ResumeRow = {
  id: number;
  requirement_id: number;
  candidate_id: number | null;
  /** Bulk upload held this row as a possible duplicate of this candidate. */
  possible_duplicate_of?: number | null;
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
  ai_report_link?: string | null;
  ai_interview_record_id?: string | null;
  profile_id?: number | null;
  profile_pipeline_status?: string | null;
  ai_invite_token?: string | null;
  ai_invite_url?: string | null;
  ai_access_key?: string | null;
  created_at: string | null;
  /* Automated-pipeline flags returned by scan endpoints (ats_auto_threshold / ats_auto_invite). */
  auto_shortlisted?: boolean;
  slot_invite_sent?: boolean;
};

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
const TERMINAL_STATUSES = ["Fulfilled", "Closed", "Cancelled"];
const SOURCING_STATUSES = ["Open_For_Sourcing", "Posted_On_Portals", "In_Progress"];
const TA_FILTER_STATUSES = ["Open_For_Sourcing", "Posted_On_Portals", "In_Progress", "On_Hold", "Fulfilled"];
/** Every requirement status, for the All-tab filter (RMG / Sales_Head). */
const ALL_REQ_STATUSES = [
  "Draft", "Pending_Sales_Head_Approval", "Sales_Head_Rejected",
  "Pending_Engineering_Review", "Engineering_Rejected", "Open_For_Sourcing",
  "Posted_On_Portals", "In_Progress", "On_Hold", "Fulfilled", "Closed", "Cancelled",
];
const WORK_MODES = ["Remote", "Onsite", "Hybrid"];
const PRIORITIES = ["High", "Medium", "Low"];
const JOB_PORTALS = ["Naukri", "LinkedIn", "Indeed", "Other"];
const SOURCE_PORTALS = ["Naukri", "LinkedIn", "Indeed", "Referral", "Other"];

const smallBtn =
  "inline-flex items-center gap-1 rounded-lg border border-strong bg-surface-1 px-2 py-1 text-xs font-semibold text-secondary hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed";
const smallPrimary =
  "inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2 py-1 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed";
const smallSuccess =
  "inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed";
const smallDanger =
  "inline-flex items-center gap-1 rounded-lg border border-rose-300 dark:border-rose-700 px-2 py-1 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50 disabled:cursor-not-allowed";
/* Reserved AI accent — ONLY for actions that invoke AI (e.g. Schedule AI L1 Interview). */
const smallAi =
  "ai-surface inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-sky-700 dark:text-sky-300 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed";
/* Animated AI border for an in-flight scan (no disabled dimming so the ring stays visible). */
const smallScanning =
  "ai-generating inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-secondary disabled:cursor-not-allowed";
/* Token focus ring (tokens.css) — applied to every NEW interactive element on this page. */
const focusRing = "focus-visible:outline-none focus-visible:shadow-focus-ring";
/* Amber chip marking rows auto-shortlisted by the ATS threshold in this session. */
const autoChip =
  "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-700 ring-1 ring-inset ring-amber-300/60 dark:bg-amber-900/40 dark:text-amber-300 dark:ring-amber-700/50";

/* ---------------------------------------------------------------- helpers */

function fmtDate(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function fmtDateTime(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function fmtRange(min: number | null, max: number | null, unit: string): string {
  if (min == null && max == null) return "—";
  if (min != null && max != null) return `${min} – ${max} ${unit}`;
  if (min != null) return `${min}+ ${unit}`;
  return `up to ${max} ${unit}`;
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

function PriorityPill({ p }: { p?: string | null }) {
  if (!p) return <span className="text-muted">—</span>;
  const cls =
    p === "High"
      ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
      : p === "Low"
        ? "bg-surface-2 text-secondary"
        : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{p}</span>;
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
  const stageLabel = stage === "sales-head" ? "Sales Head" : "Engineering (RMG)";
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

type TabDef = { key: string; label: string; statuses: string[] | null; queue?: "sales-head" | "engineering" };

export function RequirementsListPage() {
  const me = useMe();
  const canCreate = useCanAct("opportunities", "create", useHasRole("Sales")); // Admin passes too
  const [toastNode, toast] = useToast();

  const roles = me.roles;
  const isAdmin = roles.includes("Admin");
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
      t.push({ key: "engineering", label: "Engineering Review Queue", statuses: ["Pending_Engineering_Review"], queue: "engineering" });
    }
    if (roles.includes("Sales_Head") || roles.includes("RMG") || isAdmin) {
      t.push({ key: "all", label: "All", statuses: null });
    }
    return t;
  }, [roles, isAdmin]);

  const taMode = tabs.length === 0; // e.g. pure TA — backend already limits to sourcing-onward
  const [tab, setTab] = useState<string>(tabs[0]?.key || "all");
  const [statusFilter, setStatusFilter] = useState("");
  /* List filters (25 Aug 2026): server-side — the list is paginated. */
  const [customerFilter, setCustomerFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
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
    ? (statusFilter ? [statusFilter] : null)
    : (active?.statuses ?? (statusFilter ? [statusFilter] : null));
  const statusKey = (statuses || []).join(",");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = statusKey ? statusKey.split(",") : null;
      if (list && list.length > 1) {
        // The API takes ONE status, so a multi-status tab has to ask per status
        // and merge. Fetching page 1 unfiltered and filtering client-side (the
        // old approach) showed a false "No requirements found" as soon as more
        // than 20 requirements existed and none of the first 20 matched.
        const pages = await Promise.all(
          list.map((s) =>
            crmGet<Req[]>(
              `/api/requirements${qs({
                page: 1, limit: 100, search: dq || undefined, status: s,
                customer_id: customerFilter || undefined,
                priority: priorityFilter || undefined,
              })}`,
            ).catch(() => ({ data: [] as Req[], meta: undefined })),
          ),
        );
        const merged = new Map<number, Req>();
        for (const p of pages) for (const r of p.data || []) merged.set(r.id, r);
        const all = [...merged.values()].sort((a, b) =>
          String(b.created_at || "").localeCompare(String(a.created_at || "")),
        );
        const limit = 20;
        const start = (page - 1) * limit;
        setRows(all.slice(start, start + limit));
        setMeta({
          page,
          limit,
          total: all.length,
          pages: Math.max(1, Math.ceil(all.length / limit)),
        });
        return;
      }
      const single = list && list.length === 1 ? list[0] : undefined;
      const res = await crmGet<Req[]>(
        `/api/requirements${qs({
          page, limit: 20, search: dq || undefined, status: single,
          customer_id: customerFilter || undefined,
          priority: priorityFilter || undefined,
        })}`,
      );
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load requirements");
    } finally {
      setLoading(false);
    }
  }, [page, dq, statusKey, customerFilter, priorityFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [tab, dq, statusFilter, customerFilter, priorityFilter]);

  const columns: Column<Req>[] = [
    { key: "req_number", label: "Opportunity ID",
      /* ONE id for every role (18 Aug 2026): the number Sales quoted IS the
         number RMG/TA see, search and quote back. REQ-xxxx is internal now. */
      render: (r) => <span className="font-semibold text-primary">{reqLabel(r)}</span> },
    { key: "title", label: "Title" },
    {
      key: "customer", label: "Customer",
      render: (r) => {
        const name = r.customer_name || (r.customer_id != null ? customers[r.customer_id] : null);
        const loc = [r.work_mode, r.location_name].filter(Boolean).join(" · ");
        return (
          <div className="min-w-0">
            <div className="text-primary">
              {name || (r.customer_id != null ? `#${r.customer_id}` : "—")}
            </div>
            {loc && <div className="text-xs text-muted">{loc}</div>}
          </div>
        );
      },
    },
    { key: "no_of_positions", label: "Positions" },
    { key: "budget", label: "Budget",
      render: (r) => fmtRange(r.budget_ctc_min, r.budget_ctc_max, "") },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "target_closure_date", label: "Target date", render: (r) => fmtDate(r.target_closure_date) },
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-display text-xl font-bold text-primary">Opportunities</h1>
        {canCreate && (
          <button className={btnPrimary} onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New Requirement
          </button>
        )}
      </div>

      {!taMode && tabs.length > 0 && (
        <Tabs tabs={tabs.map((t) => ({ key: t.key, label: t.label }))} active={tab} onChange={setTab} />
      )}

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
          onRowClick={(r) => crmNavigate(`requirements/${r.id}`)}
          emptyMessage={
            taMode && !statusFilter && !dq
              ? "Nothing to source yet — requirements appear here once RMG approves them for sourcing."
              : <TeachingEmpty page="requirements" />
          }
          filters={
            <>
              {(taMode || tab === "all") && (
                <select className={`${inputCls} !w-56`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All statuses</option>
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
            </>
          }
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

const STEPS = ["Draft", "Sales Head", "Engineering", "Sourcing", "Posted", "In Progress"];

function stepState(status: string): { current: number; rejectedAt: number | null; terminal: string | null } {
  switch (status) {
    case "Draft": return { current: 0, rejectedAt: null, terminal: null };
    case "Pending_Sales_Head_Approval": return { current: 1, rejectedAt: null, terminal: null };
    case "Sales_Head_Rejected": return { current: 1, rejectedAt: 1, terminal: null };
    case "Pending_Engineering_Review": return { current: 2, rejectedAt: null, terminal: null };
    case "Engineering_Rejected": return { current: 2, rejectedAt: 2, terminal: null };
    case "Open_For_Sourcing": return { current: 3, rejectedAt: null, terminal: null };
    case "Posted_On_Portals": return { current: 4, rejectedAt: null, terminal: null };
    case "In_Progress": return { current: 5, rejectedAt: null, terminal: null };
    case "Fulfilled": return { current: 6, rejectedAt: null, terminal: "Fulfilled" };
    case "Closed": return { current: -1, rejectedAt: null, terminal: "Closed" };
    case "Cancelled": return { current: -1, rejectedAt: null, terminal: "Cancelled" };
    default: return { current: -1, rejectedAt: null, terminal: null };
  }
}

function StatusStepper({ status }: { status: string }) {
  const { current, rejectedAt, terminal } = stepState(status);
  return (
    <div className="rounded-card border border-subtle bg-surface-1 px-5 py-4 shadow-sm">
      <div className="flex items-center">
        {STEPS.map((label, i) => {
          const done = current > i;
          const isCurrent = current === i && rejectedAt === null;
          const rejected = rejectedAt === i;
          const circle = rejected
            ? "bg-rose-600 text-white"
            : done
              ? "bg-sky-600 text-white"
              : isCurrent
                ? "nav-pill-gradient text-white"
                : "bg-surface-2 text-muted";
          return (
            <Fragment key={label}>
              {i > 0 && (
                <div className={`h-0.5 min-w-4 flex-1 ${current > i - 1 ? "bg-sky-500" : "bg-surface-2"}`} />
              )}
              <div className="flex flex-col items-center px-1">
                <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${circle}`}>
                  {rejected ? <X size={13} /> : done ? <Check size={13} /> : i + 1}
                </div>
                <div
                  className={`mt-1 whitespace-nowrap text-xs font-semibold ${
                    rejected
                      ? "text-rose-600 dark:text-rose-400"
                      : done || isCurrent
                        ? "text-primary"
                        : "text-muted"
                  }`}
                >
                  {label}
                </div>
                {rejected && (
                  <div className="mt-0.5 text-xs font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                    Rejected
                  </div>
                )}
              </div>
            </Fragment>
          );
        })}
        {terminal && (
          <div className="ml-4 shrink-0">
            <StatusBadge status={terminal} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- job postings tab */

function JobPostingsTab({
  req, toast, onRequirementChanged,
}: {
  req: Req;
  toast: ToastFn;
  onRequirementChanged: () => void;
}) {
  const isTA = useCanAct("requirements", "edit", useHasRole("TA"));
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

function BreakdownStat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-subtle bg-surface-2 px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 text-sm font-bold ${
        tone === "good" ? "text-emerald-600 dark:text-emerald-400"
          : tone === "bad" ? "text-rose-600 dark:text-rose-400" : "text-primary"
      }`}>
        {value}
      </div>
    </div>
  );
}

function BreakdownBar({ label, num, den, suffix }: { label: string; num: number; den: number; suffix?: string }) {
  const pct = den > 0 ? Math.max(0, Math.min(100, (num / den) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-semibold text-secondary">{label}</span>
        <span className="font-bold tabular-nums text-primary">{suffix ?? `${num}/${den}`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-rose-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function BreakdownModal({ row, onClose }: { row: ResumeRow; onClose: () => void }) {
  const b = row.ats_score_breakdown || {};
  const matched = b.skills_matched || [];
  const missing = b.skills_missing || [];
  const jdMatched = b.jd_keywords_matched || [];
  const jdMissing = b.jd_keywords_missing || [];
  const details = (b.score_details || {}) as Record<string, unknown>;
  const ai = b.ai_review || null;
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const mandTotal = num(details.mandatory_total) ?? matched.length + missing.length;
  const mandMatched = num(details.mandatory_matched) ?? matched.length;
  const jdTotal = num(details.jd_keywords_total) ?? jdMatched.length + jdMissing.length;
  const jdHit = num(details.jd_keywords_matched) ?? jdMatched.length;
  const detScore = num(details.deterministic_score);
  const aiScore = num(details.ai_semantic_score);
  const expYears = details.detected_experience_years;
  const eduFound = Array.isArray(details.education_keywords_found)
    ? (details.education_keywords_found as string[]) : [];
  return (
    <Modal
      title={<span className="sr-only">{`ATS breakdown — ${row.candidate_name}`}</span>}
      onClose={onClose}
      wide
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title={`ATS breakdown — ${row.candidate_name}`}
        subtitle={`AI-computed match score ${row.ats_score ?? "—"}/100 against the requirement JD and skills.`}
        icon={<ScanLine size={20} aria-hidden />}
      >
      <div className="space-y-5">
        {/* ---- Score summary ---- */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <BreakdownStat label="Final score" value={`${row.ats_score ?? "—"} / 100`} />
          {detScore != null && aiScore != null && (
            <>
              <BreakdownStat label="Keyword / criteria" value={`${detScore}`} />
              <BreakdownStat label="AI semantic fit" value={`${aiScore}`} />
            </>
          )}
          <BreakdownStat
            label="Experience"
            value={b.experience_match ? `Match${expYears != null ? ` (${expYears} yrs)` : ""}` : expYears != null ? `${expYears} yrs — outside range` : "Not detected"}
            tone={b.experience_match ? "good" : "bad"}
          />
        </div>
        {typeof details.blend === "string" && (
          <p className="-mt-2 text-xs text-muted">Scoring: {String(details.blend)}</p>
        )}
        {/* The AI half of the score can fail (no key, quota, network). When it does
            the number is keyword-only and reads much lower than it should — say so
            here rather than letting it pass as a full score. */}
        {typeof details.ai_unavailable_reason === "string" && (
          <div className="-mt-2 flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              <strong className="font-semibold">Partial score.</strong> The AI semantic
              review did not run, so this is the keyword/criteria score only and will
              under-rate candidates whose wording differs from the JD.{" "}
              <span className="opacity-80">{String(details.ai_unavailable_reason)}</span>
            </span>
          </div>
        )}

        {/* ---- Component bars ---- */}
        <div className="space-y-3 rounded-xl border border-subtle bg-surface-1 p-4">
          <BreakdownBar label="Required skills matched" num={mandMatched} den={Math.max(1, mandTotal)} suffix={`${mandMatched}/${mandTotal}`} />
          {jdTotal > 0 && (
            <BreakdownBar label="JD keywords found in resume" num={jdHit} den={jdTotal} suffix={`${jdHit}/${jdTotal}`} />
          )}
        </div>

        {/* ---- AI reviewer assessment ---- */}
        {ai && (ai.summary || (ai.strengths || []).length > 0 || (ai.gaps || []).length > 0) && (
          <div className="space-y-3 rounded-xl border border-indigo-200/60 bg-indigo-50/50 p-4 dark:border-indigo-800/40 dark:bg-indigo-950/20">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
              <Bot size={14} /> AI reviewer assessment
            </div>
            {ai.summary && <p className="text-sm leading-relaxed text-primary">{ai.summary}</p>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(ai.strengths || []).length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Strengths</div>
                  <ul className="space-y-1 text-sm text-secondary">
                    {(ai.strengths || []).map((s, i) => (
                      <li key={i} className="flex items-start gap-1.5"><Check size={13} className="mt-0.5 shrink-0 text-emerald-500" /> {s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(ai.gaps || []).length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">Gaps</div>
                  <ul className="space-y-1 text-sm text-secondary">
                    {(ai.gaps || []).map((s, i) => (
                      <li key={i} className="flex items-start gap-1.5"><X size={13} className="mt-0.5 shrink-0 text-rose-500" /> {s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        <div>
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Matched skills</div>
          <div className="flex flex-wrap gap-1.5">
            {matched.length === 0 && <span className="text-sm text-muted">None</span>}
            {matched.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                <Check size={11} /> {s}
              </span>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Missing skills</div>
          <div className="flex flex-wrap gap-1.5">
            {missing.length === 0 && <span className="text-sm text-muted">None</span>}
            {missing.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                <X size={11} /> {s}
              </span>
            ))}
          </div>
        </div>
        {(jdMatched.length > 0 || jdMissing.length > 0 || Boolean(details.jd_applied)) && (
          <div>
            <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">JD keywords matched</div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {jdMatched.length === 0 && <span className="text-sm text-muted">None</span>}
              {jdMatched.map((s) => (
                <span key={`jd-m-${s}`} className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  <Check size={11} /> {s}
                </span>
              ))}
            </div>
            {jdMissing.length > 0 && (
              <>
                <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">JD keywords missing</div>
                <div className="flex flex-wrap gap-1.5">
                  {jdMissing.slice(0, 20).map((s) => (
                    <span key={`jd-x-${s}`} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-secondary">
                      {s}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <div>
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Other checks</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <BreakdownStat
              label="All required skills"
              value={details.all_required_matched ? "Yes" : "No"}
              tone={details.all_required_matched ? "good" : "bad"}
            />
            <BreakdownStat
              label="Education"
              value={eduFound.length ? eduFound.slice(0, 3).join(", ") : "Not found"}
              tone={eduFound.length ? "good" : "bad"}
            />
            {details.location_match != null && (
              <BreakdownStat
                label="Location"
                value={details.location_match ? "Match" : "No match"}
                tone={details.location_match ? "good" : "bad"}
              />
            )}
            <BreakdownStat
              label="Points"
              value={`${details.earned_points ?? "—"} / ${details.possible_points ?? "—"}`}
            />
          </div>
        </div>
      </div>
      </WizFormShell>
    </Modal>
  );
}

function UploadResumeModal({
  req, onClose, onUploaded, toast,
}: {
  req: Req;
  onClose: () => void;
  onUploaded: () => void;
  toast: ToastFn;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");
  const [nameErr, setNameErr] = useState("");
  // Same applicant details as the public apply-link form (all optional here —
  // the CV itself can fill gaps via auto-parse).
  const [experience, setExperience] = useState("");
  const [education, setEducation] = useState("");
  const [domain, setDomain] = useState("");
  const [skills, setSkills] = useState("");
  const [noticePeriod, setNoticePeriod] = useState("");
  const [currentCtc, setCurrentCtc] = useState("");
  const [expectedCtc, setExpectedCtc] = useState("");
  const [preferredLocation, setPreferredLocation] = useState("");
  /* Quick apply (20 Aug 2026): pick the file FIRST — the form fills itself
   * from POST /api/resumes/parse (AI extraction, regex fallback) and a
   * duplicate warning appears before anything is created. */
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dup, setDup] = useState<{
    candidate_id: number; name: string; email?: string; phone?: string;
    already_applied_here: boolean; profile_id_here: number | null;
    profiles: { profile_id: number; opportunity_title: string; pipeline_status: string }[];
  } | null>(null);
  /** Soft signal: same full name, different contact details. Never blocks. */
  const [nameMatch, setNameMatch] = useState<{
    candidate_id: number; name: string; email?: string; phone?: string;
  } | null>(null);

  const onPickFile = async (f: File | null) => {
    setCvFile(f);
    setDup(null);
    setNameMatch(null);
    if (!f) return;
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (!["pdf", "docx", "txt"].includes(ext)) {
      toast("Auto-fill works for .pdf, .docx and .txt — fill the details manually for this file");
      return;
    }
    setParsing(true);
    try {
      const res = await crmUpload<{ parsed: any; duplicate: any; name_match: any }>(
        "/api/resumes/parse", f, { opportunity_id: String(req.opportunity_id) },
      );
      const p = res.data?.parsed || {};
      /* Prefill only EMPTY fields — a value the TA already typed wins over
       * the extractor, always. */
      if (!name.trim() && p.name) setName(p.name);
      if (!email.trim() && p.email) setEmail(p.email);
      if (!phone.trim() && p.phone) setPhone(p.phone);
      if (!experience.trim() && p.experience) setExperience(p.experience);
      if (!education.trim() && p.education) setEducation(p.education);
      if (!domain.trim() && p.technical_domain) setDomain(p.technical_domain);
      if (!skills.trim() && (p.skills || []).length) setSkills(p.skills.join(", "));
      if (!noticePeriod.trim() && p.notice_period) setNoticePeriod(p.notice_period);
      if (!currentCtc.trim() && p.current_ctc) setCurrentCtc(p.current_ctc);
      if (!expectedCtc.trim() && p.expected_ctc) setExpectedCtc(p.expected_ctc);
      if (!preferredLocation.trim() && p.location) setPreferredLocation(p.location);
      setDup(res.data?.duplicate || null);
      setNameMatch(res.data?.name_match || null);
      if (p.text_extracted === false) {
        toast("No text could be read from this file (image-only PDF?) — fill the details manually");
      }
    } catch (e: any) {
      toast(e?.message || "Could not auto-read the resume — fill the details manually");
    } finally {
      setParsing(false);
    }
  };

  const doUpload = async () => {
    if (!name.trim()) { setNameErr("Candidate name is required before uploading"); return; }
    if (!cvFile) { toast("Choose the resume file first", "err"); return; }
    setUploading(true);
    try {
      await crmUpload(`/api/requirements/${req.id}/resumes`, cvFile, fields);
      toast("Resume uploaded");
      onUploaded();
      onClose();
    } catch (e: any) {
      toast(e?.message || "Upload failed", "err");
    } finally {
      setUploading(false);
    }
  };

  const fields: Record<string, string> = { candidate_name: name.trim() };
  if (email.trim()) fields.email = email.trim();
  if (phone.trim()) fields.phone = phone.trim();
  if (source) fields.source_portal = source;
  if (experience.trim()) fields.experience = experience.trim();
  if (education.trim()) fields.education = education.trim();
  if (domain.trim()) fields.technical_domain = domain.trim();
  if (skills.trim()) fields.skills = skills.trim();
  if (noticePeriod.trim()) fields.notice_period = noticePeriod.trim();
  if (currentCtc.trim()) fields.current_ctc = currentCtc.trim();
  if (expectedCtc.trim()) fields.expected_ctc = expectedCtc.trim();
  if (preferredLocation.trim()) fields.preferred_location = preferredLocation.trim();

  return (
    <Modal
      title={<span className="sr-only">Upload resume</span>}
      onClose={onClose}
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title="Upload resume"
        subtitle="Pick the resume first — the details below fill themselves; review, complete and upload."
        icon={<FileUp size={20} aria-hidden />}
      >
        <div className="space-y-5">
          <WizardField label="Resume file" required filled={!!cvFile}>
            <input
              type="file"
              accept=".pdf,.docx,.txt,.doc"
              className={inputCls}
              onChange={(e) => void onPickFile(e.target.files?.[0] || null)}
            />
            {parsing && (
              <p className="mt-1.5 text-xs font-semibold text-brand-600 dark:text-brand-300">
                Reading the resume and filling in the details…
              </p>
            )}
          </WizardField>
          {dup && (
            <div className={`rounded-card border px-4 py-3 text-sm ${
              dup.already_applied_here
                ? "border-rose-300/60 bg-rose-50 text-rose-800 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-300"
                : "border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300"
            }`}>
              <div className="font-bold">
                {dup.already_applied_here
                  ? "This candidate has ALREADY applied to this opportunity"
                  : "Possible duplicate — this person already exists as a candidate"}
              </div>
              <div className="mt-1">
                Matched <CrmLink to={`candidates/${dup.candidate_id}`} className="font-semibold underline">
                  {dup.name || `Candidate #${dup.candidate_id}`}
                </CrmLink>
                {dup.email ? <> · {dup.email}</> : null}
                {dup.phone ? <> · {dup.phone}</> : null}
                {dup.profile_id_here != null && (
                  <> — <CrmLink to={`profiles/${dup.profile_id_here}`} className="font-semibold underline">
                    open their profile on this opportunity
                  </CrmLink></>
                )}
              </div>
              {dup.profiles.length > 0 && !dup.already_applied_here && (
                <div className="mt-1 text-xs opacity-90">
                  In pipeline: {dup.profiles.slice(0, 3).map((p, i) => (
                    <span key={p.profile_id}>
                      {i > 0 && " · "}
                      <CrmLink to={`profiles/${p.profile_id}`} className="underline">
                        {p.opportunity_title}
                      </CrmLink> ({p.pipeline_status.replace(/_/g, " ")})
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-1 text-xs opacity-90">
                {dup.already_applied_here
                  ? "Uploading again attaches this file to their existing application — it will not create a second entry."
                  : "Uploading will attach this resume to the EXISTING candidate (no duplicate record is created) and apply them to this opportunity."}
              </div>
            </div>
          )}
          {/* Soft signal only — people share names, so this never blocks. */}
          {!dup && nameMatch && (
            <div className="rounded-card border border-subtle bg-surface-2 px-4 py-2.5 text-xs text-secondary">
              <b className="text-primary">Note:</b> a candidate named{" "}
              <CrmLink to={`candidates/${nameMatch.candidate_id}`} className="font-semibold underline">
                {nameMatch.name}
              </CrmLink>{" "}
              already exists ({[nameMatch.email, nameMatch.phone].filter(Boolean).join(" · ") || "no contact details"})
              — different email/phone, so this is probably a different person. Worth a glance before uploading.
            </div>
          )}
          <WizardField label="Candidate name" required error={nameErr} icon="user" filled={!!name.trim() && !nameErr}>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => { setName(e.target.value); if (nameErr) setNameErr(""); }}
              placeholder="Full name"
            />
          </WizardField>
          <WizardField label="Email" icon="mail" filled={!!email.trim()}>
            <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </WizardField>
          <WizardField label="Phone" icon="phone" filled={!!phone.trim()}>
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </WizardField>
          <WizardField label="Source portal">
            <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">—</option>
              {SOURCE_PORTALS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </WizardField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <WizardField label="Total experience (years)" filled={!!experience.trim()}>
              <input className={inputCls} value={experience} onChange={(e) => setExperience(e.target.value)} placeholder="e.g. 4.5" />
            </WizardField>
            <WizardField label="Highest education" filled={!!education.trim()}>
              <input className={inputCls} value={education} onChange={(e) => setEducation(e.target.value)} placeholder="e.g. B.Tech, Computer Science" />
            </WizardField>
            <WizardField label="Technical domain" filled={!!domain.trim()}>
              <input className={inputCls} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="e.g. Backend / Data Engineering" />
            </WizardField>
            <WizardField label="Notice period" filled={!!noticePeriod.trim()}>
              <input className={inputCls} value={noticePeriod} onChange={(e) => setNoticePeriod(e.target.value)} placeholder="e.g. 30 days" />
            </WizardField>
            <WizardField label="Current CTC" filled={!!currentCtc.trim()}>
              <input className={inputCls} value={currentCtc} onChange={(e) => setCurrentCtc(e.target.value)} placeholder="e.g. 12 LPA" />
            </WizardField>
            <WizardField label="Expected CTC" filled={!!expectedCtc.trim()}>
              <input className={inputCls} value={expectedCtc} onChange={(e) => setExpectedCtc(e.target.value)} placeholder="e.g. 18 LPA" />
            </WizardField>
            <WizardField label="Preferred location" filled={!!preferredLocation.trim()}>
              <input className={inputCls} value={preferredLocation} onChange={(e) => setPreferredLocation(e.target.value)} placeholder="e.g. Bangalore" />
            </WizardField>
          </div>
          <WizardField label="Key skills" filled={!!skills.trim()}>
            <input className={inputCls} value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="e.g. Python, FastAPI, PostgreSQL, AWS" />
          </WizardField>
          <div>
            <button
              type="button"
              className={btnPrimary}
              onClick={() => void doUpload()}
              disabled={uploading || parsing}
            >
              {uploading ? "Uploading…" : "Upload & apply to this opportunity"}
            </button>
            <InfoChip>
              Accepted: .pdf, .docx, .txt (auto-fill) and .doc (manual details). The candidate
              appears in the Applicants tab at Sourcing as soon as the upload completes.
            </InfoChip>
          </div>
        </div>
      </WizFormShell>
    </Modal>
  );
}

function EditResumeModal({
  row, onClose, onSaved, toast,
}: {
  row: ResumeRow;
  onClose: () => void;
  onSaved: () => void;
  toast: ToastFn;
}) {
  const d = row.application_details || {};
  const [name, setName] = useState(row.candidate_name || "");
  const [email, setEmail] = useState(row.email || "");
  const [phone, setPhone] = useState(row.phone || "");
  const [source, setSource] = useState(row.source_portal || "");
  const [experience, setExperience] = useState(row.applicant_experience || "");
  const [education, setEducation] = useState(d.education || "");
  const [domain, setDomain] = useState(d.technical_domain || "");
  const [skills, setSkills] = useState(d.skills || "");
  const [noticePeriod, setNoticePeriod] = useState(d.notice_period || "");
  const [currentCtc, setCurrentCtc] = useState(d.current_ctc || "");
  const [expectedCtc, setExpectedCtc] = useState(d.expected_ctc || "");
  const [preferredLocation, setPreferredLocation] = useState(d.preferred_location || "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) { toast("Candidate name is required", "err"); return; }
    setBusy(true);
    try {
      const res = await crmPut(`/api/resumes/${row.id}`, {
        candidate_name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        source_portal: source,
        experience: experience.trim(),
        education: education.trim(),
        technical_domain: domain.trim(),
        skills: skills.trim(),
        notice_period: noticePeriod.trim(),
        current_ctc: currentCtc.trim(),
        expected_ctc: expectedCtc.trim(),
        preferred_location: preferredLocation.trim(),
      });
      toast(res.message || "Resume updated");
      onSaved();
    } catch (e: any) {
      toast(e?.message || "Update failed", "err");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={<span className="sr-only">Edit applicant details</span>}
      onClose={onClose}
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title="Edit applicant details"
        subtitle={`Update the application details for ${row.candidate_name}.`}
        icon={<Pencil size={20} aria-hidden />}
      >
        <div className="space-y-5">
          <WizardField label="Candidate name" required icon="user" filled={!!name.trim()}>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </WizardField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <WizardField label="Email" icon="mail" filled={!!email.trim()}>
              <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </WizardField>
            <WizardField label="Phone" icon="phone" filled={!!phone.trim()}>
              <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </WizardField>
            <WizardField label="Source portal">
              <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">—</option>
                {SOURCE_PORTALS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </WizardField>
            <WizardField label="Total experience (years)" filled={!!experience.trim()}>
              <input className={inputCls} value={experience} onChange={(e) => setExperience(e.target.value)} placeholder="e.g. 4.5" />
            </WizardField>
            <WizardField label="Highest education" filled={!!education.trim()}>
              <input className={inputCls} value={education} onChange={(e) => setEducation(e.target.value)} placeholder="e.g. B.Tech, Computer Science" />
            </WizardField>
            <WizardField label="Technical domain" filled={!!domain.trim()}>
              <input className={inputCls} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="e.g. Backend / Data Engineering" />
            </WizardField>
            <WizardField label="Notice period" filled={!!noticePeriod.trim()}>
              <input className={inputCls} value={noticePeriod} onChange={(e) => setNoticePeriod(e.target.value)} placeholder="e.g. 30 days" />
            </WizardField>
            <WizardField label="Current CTC" filled={!!currentCtc.trim()}>
              <input className={inputCls} value={currentCtc} onChange={(e) => setCurrentCtc(e.target.value)} placeholder="e.g. 12 LPA" />
            </WizardField>
            <WizardField label="Expected CTC" filled={!!expectedCtc.trim()}>
              <input className={inputCls} value={expectedCtc} onChange={(e) => setExpectedCtc(e.target.value)} placeholder="e.g. 18 LPA" />
            </WizardField>
            <WizardField label="Preferred location" filled={!!preferredLocation.trim()}>
              <input className={inputCls} value={preferredLocation} onChange={(e) => setPreferredLocation(e.target.value)} placeholder="e.g. Bangalore" />
            </WizardField>
          </div>
          <WizardField label="Key skills" filled={!!skills.trim()}>
            <input className={inputCls} value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="e.g. Python, FastAPI, PostgreSQL, AWS" />
          </WizardField>
          <div className={wizFooterRow}>
            <button className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
            <button className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`} onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </WizFormShell>
    </Modal>
  );
}

function ResumesTab({
  req, toast, onRequirementChanged,
}: {
  req: Req;
  toast: ToastFn;
  onRequirementChanged: () => void;
}) {
  const isTA = useCanAct("requirements", "edit", useHasRole("TA"));
  const isRmg = useCanAct("requirements", "edit", useHasRole("RMG"));
  const [rows, setRows] = useState<ResumeRow[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
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
    applied: { file: string; name: string; candidate_id: number; profile_id: number | null; ats_score?: number | null;
      name_match?: { candidate_id: number; name: string; email?: string } | null }[];
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

  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);

  /* The ZIP runs as a BACKGROUND JOB (one AI parse per resume — a full zip is
   * minutes, not seconds). Upload returns a job_id; poll for progress so the
   * button reads "Processing 23/50…" instead of freezing. */
  const uploadZip = async (f: File) => {
    setZipBusy(true);
    setZipProgress(null);
    try {
      const start = await crmUpload<{ job_id: string; total: number; oversize: any[] }>(
        `/api/requirements/${req.id}/resumes/bulk-zip`, f,
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
        setZipResult(result);
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
  const [editRow, setEditRow] = useState<ResumeRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<ResumeRow | null>(null);
  const [inviteOpenId, setInviteOpenId] = useState<number | null>(null);
  const [profileByResume, setProfileByResume] = useState<Record<number, number>>({});
  const [inviteBusyId, setInviteBusyId] = useState<number | null>(null);
  /* Resume ids reported as auto_shortlisted by a scan run in THIS session (client-side only). */
  const [autoIds, setAutoIds] = useState<Set<number>>(() => new Set());
  /* "Applied by" filter (25 Aug 2026): SERVER-side — the list is paginated, so
   * a client-side filter would silently miss the other pages. TA names come
   * from the opportunity's profiles (where attribution is stamped). */
  const [appliedBy, setAppliedBy] = useState("");
  const [taNames, setTaNames] = useState<string[]>([]);
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

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<ResumeRow[]>(
        `/api/requirements/${req.id}/resumes${qs({
          page, limit: 20, search: dq || undefined, applied_by: appliedBy || undefined,
        })}`,
      );
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load resumes");
    } finally {
      setLoading(false);
    }
  }, [req.id, page, dq, appliedBy]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [dq, appliedBy]);

  /** Scan responses now flag auto_shortlisted / slot_invite_sent per resume.
   * Remember auto-shortlisted ids for this session (drives the "Auto" chip)
   * and return a toast-ready summary ("2 auto-shortlisted, invites sent"). */
  const captureAutoResults = (data: any): string | null => {
    const list: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.results)
        ? data.results
        : data && typeof data === "object"
          ? [data]
          : [];
    const auto = list.filter((x) => x && typeof x === "object" && x.auto_shortlisted);
    if (auto.length === 0) return null;
    setAutoIds((prev) => {
      const next = new Set(prev);
      auto.forEach((x) => { if (x.id != null) next.add(Number(x.id)); });
      return next;
    });
    const invites = auto.filter((x) => x.slot_invite_sent).length;
    const base = `${auto.length} auto-shortlisted`;
    if (invites === 0) return base;
    if (invites === auto.length) return `${base}, invites sent`;
    return `${base}, ${invites} invite${invites === 1 ? "" : "s"} sent`;
  };

  const scan = async (r: ResumeRow) => {
    setBusyId(r.id);
    try {
      const res = await crmPost<any>(`/api/resumes/${r.id}/ats-scan`);
      const summary = captureAutoResults(res.data);
      const msg = res.message || "ATS scan complete";
      toast(summary ? `${msg} — ${summary}` : msg);
      load();
    } catch (e: any) {
      toast(e?.message || "ATS scan failed", "err");
    } finally {
      setBusyId(null);
    }
  };

  const scanAll = async () => {
    setScanAllBusy(true);
    try {
      const res = await crmPost<any>(`/api/requirements/${req.id}/resumes/scan-all`);
      const summary = captureAutoResults(res.data);
      const msg = res.message || "Scan complete";
      toast(summary ? `${msg} — ${summary}` : msg);
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
      toast(e?.message || "Failed to send slot invite", "err");
    } finally {
      setInviteBusyId(null);
    }
  };

  const shortlist = async (r: ResumeRow) => {
    setBusyId(r.id);
    try {
      const res = await crmPost(`/api/resumes/${r.id}/shortlist`);
      toast(res.message || "Resume shortlisted");
      load();
    } catch (e: any) {
      toast(e?.message || "Shortlist failed", "err");
    } finally {
      setBusyId(null);
    }
  };

  // ---- RMG decision actions (same flow as the profile's "RMG review needed"
  // banner), available right here on the requirement's resume rows. ----
  const [f2fRow, setF2fRow] = useState<ResumeRow | null>(null);
  const [f2fWhen, setF2fWhen] = useState("");
  const [f2fLink, setF2fLink] = useState("");
  const [f2fNote, setF2fNote] = useState("");
  const [f2fErrs, setF2fErrs] = useState<{ when?: string; link?: string }>({});
  const [rmgBusyId, setRmgBusyId] = useState<number | null>(null);
  /* RMG screening decisions right on this tab (25 Aug 2026) — same endpoint
   * as the Applicants tab, so RMG screens wherever they happen to be. */
  const [screenRow, setScreenRow] = useState<{ row: ResumeRow; profileId: number; kind: "shortlist" | "reject" } | null>(null);
  const [screenNote, setScreenNote] = useState("");
  const [screenErr, setScreenErr] = useState("");
  const [screenBusy, setScreenBusy] = useState(false);

  const submitScreening = async () => {
    if (!screenRow) return;
    if (screenRow.kind === "reject" && screenNote.trim().length < 5) {
      setScreenErr("A rejection note of at least 5 characters is required");
      return;
    }
    setScreenBusy(true);
    try {
      const res = await crmPost(`/api/candidate-profiles/${screenRow.profileId}/rmg-screening`, {
        decision: screenRow.kind === "shortlist" ? "Shortlisted" : "Rejected",
        note: screenNote.trim() || undefined,
      });
      toast(res.message || "Screening decision recorded");
      setScreenRow(null);
      load();
    } catch (e: any) {
      toast(e?.message || "Decision failed", "err");
    } finally {
      setScreenBusy(false);
    }
  };
  /* Decision modal (was window.prompt — can't show field errors, and some
   * browsers let users suppress prompts, silently killing the buttons). */
  const [rmgDecision, setRmgDecision] = useState<{ row: ResumeRow; kind: "sales" | "reject" } | null>(null);
  const [rmgComment, setRmgComment] = useState("");
  const [rmgCommentErr, setRmgCommentErr] = useState("");

  const rmgTransition = (r: ResumeRow, kind: "sales" | "reject") => {
    if (!r.profile_id) return;
    setRmgDecision({ row: r, kind });
    setRmgCommentErr("");
    setRmgComment(kind === "sales"
      ? "AI L1 passed — RMG review complete, forwarding to Sales team"
      : "");
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
  const requestL2 = async (r: ResumeRow) => {
    if (!r.profile_id) return;
    setRmgBusyId(r.id);
    try {
      const res = await crmPost(`/api/candidate-profiles/${r.profile_id}/l2-request`, {});
      toast(res.message || "TA notified — they will schedule the L2 with the candidate");
    } catch (e: any) {
      toast(e?.message || "Failed to request the L2 round", "err");
    } finally {
      setRmgBusyId(null);
    }
  };

  const rmgF2f = async () => {
    if (!f2fRow?.profile_id) return;
    /* Same rule as the profile banner: an empty date/link used to POST nulls,
     * and the candidate got an invite email with no time and no link. */
    const errs: { when?: string; link?: string } = {};
    if (!f2fWhen.trim()) errs.when = "Pick the date and time of the call";
    if (!f2fLink.trim()) errs.link = "Paste the meeting link the candidate should join";
    else if (!/^https?:\/\/\S+$/i.test(f2fLink.trim())) errs.link = "Enter a full link starting with https://";
    setF2fErrs(errs);
    if (errs.when || errs.link) return;
    setRmgBusyId(f2fRow.id);
    try {
      const res = await crmPost(`/api/candidate-profiles/${f2fRow.profile_id}/l2-face-to-face`, {
        scheduled_at: f2fWhen.trim(),
        meeting_link: f2fLink.trim(),
        note: f2fNote.trim() || null,
      });
      toast(res.message || "L2 face-to-face recorded — TA notified");
      setF2fRow(null);
      setF2fWhen(""); setF2fLink(""); setF2fNote(""); setF2fErrs({});
    } catch (e: any) {
      toast(e?.message || "Failed to record the L2 round", "err");
    } finally {
      setRmgBusyId(null);
    }
  };

  const doDelete = async () => {
    if (!deleteRow) return;
    setBusyId(deleteRow.id);
    try {
      const res = await crmDelete(`/api/resumes/${deleteRow.id}`);
      toast(res.message || "Resume deleted");
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
      const res = await crmPost<any>(`/api/resumes/${r.id}/schedule-ai-interview`);
      toast(res.message || "AI L1 invite ready to share");
      if (res.data?.profile_id) {
        setProfileByResume((m) => ({ ...m, [r.id]: res.data.profile_id }));
      }
      setScheduleRow(null);
      setInviteOpenId(r.id);
      await load();
    } catch (e: any) {
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
  const rmgJdPreview = (req.rmg_jd_text || "").trim();
  const rmgJdFiles = req.rmg_jd_attachments || [];

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
                    r.application_details?.preferred_location ? `📍 ${r.application_details.preferred_location}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
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
    { key: "source_portal", label: "Source", render: (r) => r.source_portal || "—" },
    { key: "applied_by", label: "Applied by",
      render: (r) => <span className="text-secondary">{r.applied_by || "—"}</span> },
    { key: "rmg_screening_status", label: "RMG Screening",
      render: (r) => <RmgScreeningBadge status={r.rmg_screening_status} /> },
    { key: "received_date", label: "Received", render: (r) => fmtDate(r.received_date || r.created_at) },
    { key: "ats_score", label: "ATS Score", render: (r) => <ScorePill row={r} onClick={() => setBreakdownRow(r)} /> },
    {
      key: "ats_status", label: "ATS Status",
      // Score-derived status (user decision, 27 Aug 2026): once a score
      // exists, the column answers the only question that matters — did the
      // resume clear the bar? ≥40% "L1 Shortlisted", <40% "Not Considered".
      // Unscored rows keep their real workflow status (Pending Scan etc.).
      render: (r) => {
        const score = r.ats_score != null ? Number(r.ats_score) : null;
        return (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {score != null ? (
              score >= 40 ? (
                <span
                  className="inline-flex items-center rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-bold text-success"
                  title={`ATS score ${score} ≥ 40% — shortlisted for AI L1`}
                >
                  L1 Shortlisted
                </span>
              ) : (
                <span
                  className="inline-flex items-center rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-bold text-muted"
                  title={`ATS score ${score} < 40% — below the consideration bar`}
                >
                  Not Considered
                </span>
              )
            ) : (
              <StatusBadge status={r.ats_status} />
            )}
            {r.ats_status === "Shortlisted" && autoIds.has(r.id) && (
              <span className={autoChip} title="Auto-shortlisted by the ATS threshold during this scan session">
                Auto
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "ai_interview_status", label: "AI Interview",
      render: (r) => {
        const score = r.ai_overall_score_percent;
        const showReport = isTA && !!r.ai_report_link;
        // A recruiter's decision on the report page outranks the AI's own
        // score-threshold verdict. Show theirs, and keep the AI's beside it —
        // this column used to show only the raw verdict, so a candidate already
        // marked Selected still read "Failed 57.2%".
        const status = r.ai_hr_decision_label || r.ai_interview_status || "Not_Scheduled";
        return (
          <div className="flex flex-col items-start gap-1" onClick={(e) => e.stopPropagation()}>
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <StatusBadge status={status} />
              {score != null && Number.isFinite(Number(score)) && (
                <span
                  className="inline-flex items-center rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-bold tabular-nums text-primary"
                  title="AI L1 overall score"
                >
                  {Number(score) % 1 === 0 ? Number(score) : Number(score).toFixed(1)}%
                </span>
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
                AI: {r.ai_interview_result}
              </span>
            )}
            {showReport && (
              <a
                href={r.ai_report_link!}
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
    {
      key: "_actions", label: "Actions",
      render: (r) => {
        const busy = busyId === r.id;
        const profileId = r.profile_id ?? profileByResume[r.id];
        return (
          <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
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
            {isRmg && r.rmg_screening_status === "Pending" && profileId != null && (
              <>
                <button
                  className={smallPrimary}
                  onClick={() => { setScreenRow({ row: r, profileId, kind: "shortlist" }); setScreenNote(""); setScreenErr(""); }}
                  title="Clear this candidate for the AI L1 interview — the TA is notified to proceed"
                >
                  <Check size={13} /> RMG Shortlist
                </button>
                <button
                  className={smallDanger}
                  onClick={() => { setScreenRow({ row: r, profileId, kind: "reject" }); setScreenNote(""); setScreenErr(""); }}
                  title="Reject at RMG screening (note required) — the TA is notified"
                >
                  <X size={13} /> RMG Reject
                </button>
              </>
            )}
            {(isTA || isRmg) && r.ats_status === "Pending_Scan" && (
              <button className={busy ? smallScanning : smallBtn} onClick={() => scan(r)} disabled={busy || scanAllBusy}>
                {busy ? <AiThinking label="Scanning…" /> : <><ScanLine size={13} /> Run ATS Scan</>}
              </button>
            )}
            {isTA && r.ats_status !== "Shortlisted" && r.ats_status !== "Rejected" && (
              <button
                className={smallPrimary}
                onClick={() => shortlist(r)}
                disabled={busy || r.ats_score == null}
                title={r.ats_score == null ? "Run the ATS scan first" : "Shortlist this resume"}
              >
                <Star size={13} /> Shortlist
              </button>
            )}
            {isTA && r.ats_status !== "Rejected" && (
              <button className={smallDanger} onClick={() => setRejectRow(r)} disabled={busy}>
                <X size={13} /> Reject
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
            {isTA && (r.ats_status === "Scored" || r.ats_status === "Shortlisted")
              && (!r.ai_interview_status || r.ai_interview_status === "Not_Scheduled")
              && r.ai_overall_score_percent == null && (
              <button
                className={`${smallBtn} ${focusRing}`}
                onClick={() => void openSlotInvite(r)}
                disabled={busy || inviteBusyId === r.id || (!r.email && !r.phone)}
                title={
                  !r.email && !r.phone
                    ? "No email or phone on file — add contact info to send a slot invite"
                    : "Email/WhatsApp the candidate a link to book an interview slot"
                }
              >
                <CalendarPlus size={13} />{" "}
                {inviteBusyId === r.id ? "Sending…" : r.slot_invite_sent ? "Resend slot invite" : "Slot invite"}
              </button>
            )}
            {isTA && r.ats_status === "Shortlisted" &&
              (!r.ai_interview_status || r.ai_interview_status === "Not_Scheduled") && (
              <button className={smallAi} onClick={() => setScheduleRow(r)} disabled={busy}>
                <Bot size={13} /> {busy ? "Scheduling…" : "Schedule AI L1 Interview"}
              </button>
            )}
            {profileId != null && (
              <button className={smallBtn} onClick={() => crmNavigate(`profiles/${profileId}`)}>
                <ExternalLink size={13} /> View profile
              </button>
            )}
            {isTA && !isRmg && r.profile_pipeline_status === "RMG_Review" && r.profile_id != null && (
              <button
                className={`${smallBtn} ${focusRing}`}
                onClick={() => setF2fRow(r)}
                disabled={rmgBusyId === r.id}
                title="Schedule the L2 face-to-face round RMG requested (date/time + meeting link)"
              >
                Schedule L2
              </button>
            )}
            {isRmg && r.profile_pipeline_status === "RMG_Review" && (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                  <Bot size={11} /> RMG review needed
                </span>
                <button
                  className={`${smallBtn} ${focusRing}`}
                  onClick={() => void requestL2(r)}
                  disabled={rmgBusyId === r.id}
                  title="Ask TA to arrange a face-to-face L2 round — TA agrees the time with the candidate and schedules it"
                >
                  {rmgBusyId === r.id ? "Requesting…" : "L2 — Face-to-face"}
                </button>
                <button
                  className={smallPrimary}
                  onClick={() => void rmgTransition(r, "sales")}
                  disabled={rmgBusyId === r.id}
                  title="RMG review complete — submit this candidate to the Sales team"
                >
                  {rmgBusyId === r.id ? "Working…" : "Submit to Sales"}
                </button>
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
                className={`${smallBtn} ${focusRing}`}
                onClick={() => setEditRow(r)}
                disabled={busy}
                title="Edit applicant details"
              >
                <Pencil size={13} /> Edit
              </button>
            )}
            {isTA && (
              <button
                className={smallDanger}
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* RMG runs the same scan while screening — the score is shared. */}
        {(isTA || isRmg) && (
          <button className={btnSecondary} onClick={scanAll} disabled={scanAllBusy || pendingOnPage === 0}>
            <RefreshCw size={15} className={scanAllBusy ? "animate-spin" : ""} />
            {scanAllBusy ? "Scanning all pending…" : "Scan all pending"}
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
            <button className={btnPrimary} onClick={() => setShowUpload(true)}>
              <Plus size={16} /> Upload Resume
            </button>
          </>
        )}
      </div>
      {(rmgJdPreview || rmgJdFiles.length > 0) && (
        <div className="rounded-xl border border-subtle bg-surface-2 px-4 py-3">
          <div className="text-xs font-bold uppercase tracking-wide text-muted">JD used for scoring</div>
          {rmgJdPreview ? (
            <p className="mt-1 whitespace-pre-wrap text-sm text-primary">
              {rmgJdPreview.length > 400 ? `${rmgJdPreview.slice(0, 400)}…` : rmgJdPreview}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">RMG JD provided as file only.</p>
          )}
          {rmgJdFiles.length > 0 && (
            <ul className="mt-2 space-y-1">
              {rmgJdFiles.map((a) => (
                <li key={a.id}><FileLink url={a.file_url} label={a.file_name || "RMG JD"} /></li>
              ))}
            </ul>
          )}
        </div>
      )}
      {isTA && !canUpload && (
        <p className="text-xs text-muted">
          Resumes can be uploaded only while the requirement is Open For Sourcing, Posted On Portals or In Progress.
        </p>
      )}

      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : (
        /* While "Scan all pending" runs, the whole resumes section carries the
           animated AI border; it stops the moment the scan completes. */
        <div className={scanAllBusy ? "ai-generating rounded-2xl" : undefined}>
          <DataTable<ResumeRow>
            columns={columns}
            rows={rows}
            meta={meta}
            headerRight={meta ? <span className="whitespace-nowrap text-xs font-medium text-muted">{meta.total} {meta.total === 1 ? "resume" : "resumes"}, page {meta.page}/{Math.max(1, meta.pages || 1)}</span> : undefined}
            loading={loading}
            search={search}
            onSearch={setSearch}
            onPage={setPage}
            filters={
              <select
                className={`${inputCls} !w-52`}
                value={appliedBy}
                onChange={(e) => setAppliedBy(e.target.value)}
                title="Filter by the TA who applied the candidate"
              >
                <option value="">Applied by — anyone</option>
                {taNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            }
            emptyMessage={appliedBy || dq ? "No applied candidates match the current filters" : "No applied candidates yet"}
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
              {zipResult.held.length > 0 && <>, <b className="text-amber-700 dark:text-amber-300">{zipResult.held.length} possible duplicate(s) held for your review</b></>}
              {zipResult.skipped.length > 0 && <>, {zipResult.skipped.length} already uploaded</>}
              {zipResult.failed.length > 0 && <>, {zipResult.failed.length} failed</>}.
            </p>
            {zipResult.applied.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Applied — now in the Applicants tab</div>
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
      {breakdownRow && <BreakdownModal row={breakdownRow} onClose={() => setBreakdownRow(null)} />}
      {editRow && (
        <EditResumeModal
          row={editRow}
          onClose={() => setEditRow(null)}
          onSaved={() => { setEditRow(null); load(); }}
          toast={toast}
        />
      )}
      {f2fRow && (
        <Modal title="Schedule L2 face-to-face round" onClose={() => { if (rmgBusyId !== f2fRow.id) setF2fRow(null); }}>
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              Candidate <span className="font-semibold">{f2fRow.candidate_name}</span> and RMG join a live
              call (e.g. Microsoft Teams). This logs the round, notifies TA to coordinate, and emails the
              candidate the details when an email is on file. Decide after the call.
            </p>
            <Field label="Date & time" required error={f2fErrs.when}>
              <input type="datetime-local" className={`${inputCls}${f2fErrs.when ? " input-error" : ""}`} value={f2fWhen}
                onChange={(e) => { setF2fWhen(e.target.value); setF2fErrs((p) => ({ ...p, when: undefined })); }} />
            </Field>
            <Field label="Meeting link (Teams / Meet)" required error={f2fErrs.link}>
              <input className={`${inputCls}${f2fErrs.link ? " input-error" : ""}`} placeholder="https://teams.microsoft.com/…" value={f2fLink}
                onChange={(e) => { setF2fLink(e.target.value); setF2fErrs((p) => ({ ...p, link: undefined })); }} />
            </Field>
            <Field label="Note for the candidate / TA (optional)">
              <textarea className={inputCls} rows={2} value={f2fNote} onChange={(e) => setF2fNote(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <button className={btnSecondary} onClick={() => setF2fRow(null)} disabled={rmgBusyId === f2fRow.id}>Cancel</button>
              <button className={btnPrimary} onClick={() => void rmgF2f()} disabled={rmgBusyId === f2fRow.id}>
                {rmgBusyId === f2fRow.id ? "Saving…" : "Schedule & notify"}
              </button>
            </div>
          </div>
        </Modal>
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
                {invitePreview.next_slot_at ? ` — next: ${new Date(invitePreview.next_slot_at).toLocaleString()}` : ""}.
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
        <Modal
          title={screenRow.kind === "shortlist" ? "Shortlist for AI L1" : "Reject at RMG screening"}
          onClose={() => { if (!screenBusy) setScreenRow(null); }}
        >
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              {screenRow.kind === "shortlist"
                ? <><b>{screenRow.row.candidate_name}</b> will be cleared for the AI L1 interview and the TA who applied them will be notified to proceed.</>
                : <>Reject <b>{screenRow.row.candidate_name}</b> at RMG screening. The TA will be notified with your note.</>}
            </p>
            <Field label={screenRow.kind === "shortlist" ? "Note (optional)" : "Reason"}
              required={screenRow.kind === "reject"} error={screenErr}>
              <textarea
                className={`${inputCls}${screenErr ? " input-error" : ""}`}
                rows={3}
                value={screenNote}
                onChange={(e) => { setScreenNote(e.target.value); setScreenErr(""); }}
                placeholder={screenRow.kind === "reject"
                  ? "Why is this candidate not suitable? (min 5 characters)"
                  : "Anything the TA should know"}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button className={btnSecondary} onClick={() => setScreenRow(null)} disabled={screenBusy}>Cancel</button>
              <button className={screenRow.kind === "shortlist" ? btnPrimary : btnDanger}
                onClick={() => void submitScreening()} disabled={screenBusy}>
                {screenBusy ? "Working…" : screenRow.kind === "shortlist" ? "Shortlist & notify TA" : "Reject & notify TA"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {rmgDecision && (
        <Modal
          title={rmgDecision.kind === "sales" ? "Submit to Sales team" : "Reject candidate"}
          onClose={() => { if (rmgBusyId !== rmgDecision.row.id) setRmgDecision(null); }}
        >
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              {rmgDecision.kind === "sales"
                ? <>Move <span className="font-semibold">{rmgDecision.row.candidate_name}</span> from RMG Review to Sales Screening. The comment goes on the activity log.</>
                : <>Reject <span className="font-semibold">{rmgDecision.row.candidate_name}</span> at the RMG stage. The reason goes on the activity log and cannot be blank.</>}
            </p>
            <Field
              label={rmgDecision.kind === "sales" ? "Comment for the activity log" : "Rejection reason"}
              required
              error={rmgCommentErr}
            >
              <textarea
                className={`${inputCls}${rmgCommentErr ? " input-error" : ""}`}
                rows={3}
                value={rmgComment}
                onChange={(e) => { setRmgComment(e.target.value); setRmgCommentErr(""); }}
                placeholder={rmgDecision.kind === "sales"
                  ? "Why is this candidate being submitted to Sales?"
                  : "Why is this candidate being rejected? (min 5 characters)"}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button className={btnSecondary} onClick={() => setRmgDecision(null)} disabled={rmgBusyId === rmgDecision.row.id}>
                Cancel
              </button>
              <button
                className={rmgDecision.kind === "sales" ? btnPrimary : btnDanger}
                onClick={() => void submitRmgDecision()}
                disabled={rmgBusyId === rmgDecision.row.id}
              >
                {rmgBusyId === rmgDecision.row.id
                  ? "Working…"
                  : rmgDecision.kind === "sales" ? "Submit to Sales team" : "Reject candidate"}
              </button>
            </div>
          </div>
        </Modal>
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
      {scheduleRow && (
        <ConfirmModal
          title="Schedule AI L1 Interview"
          message={
            <>
              This creates the candidate + profile and generates an AI L1 invite for{" "}
              <span className="font-semibold">{scheduleRow.candidate_name}</span>. The link will be shown here (not auto-sent). Continue?
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
  const isTA = useCanAct("requirements", "edit", useHasRole("TA"));
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

export function RequirementDetailPage() {
  const params = useCrmParams();
  const id = Number(params.id);
  const me = useMe();
  const [toastNode, toast] = useToast();

  const isTA = useCanAct("requirements", "edit", useHasRole("TA"));
  const isSalesHead = useCanAct("requirements", "edit", useHasRole("Sales_Head"));
  const isRMG = useCanAct("requirements", "edit", useHasRole("RMG"));
  const canSeeResumes = useCanAct("requirements", "view", useHasRole("TA", "RMG", "Sales_Head"));
  const isAdmin = me.roles.includes("Admin");

  const [req, setReq] = useState<Req | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [locationName, setLocationName] = useState("");
  const [tab, setTab] = useState<string>(isTA ? "resumes" : "postings");
  /* Sub-tab access (25 Aug 2026): templates hide detail tabs via the
   * `tab:<key>` field entries on the requirements tab ("Hidden" mode).
   * These hooks MUST sit here, above the early returns below — placing them
   * lower violates rules-of-hooks and blanked the whole page (seen live). */
  const reqAcc = useCrmAccess("requirements");
  const visibleTabKeys = ["details", "postings", ...(canSeeResumes ? ["resumes", "slots"] : []),
    "applicants", "suggested", "activity"].filter((k) => reqAcc.subTabVisible(`tab:${k}`));
  useEffect(() => {
    /* A hidden sub-tab must not stay selected (e.g. the TA default "resumes"
     * when a template hides it) — fall to the first visible one. */
    if (visibleTabKeys.length && !visibleTabKeys.includes(tab)) setTab(visibleTabKeys[0]);
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

  useEffect(() => {
    crmGet<any[]>(`/api/template-requests${qs({ requirement_id: id, limit: 20 })}`)
      .then((r) => {
        // Mirrors the backend bridge: a non-null template_job_id is what makes
        // an AI L1 runnable, regardless of the request's exact status.
        const ready = (r.data || []).find((t) => t.template_job_id);
        setLinkedTemplate(ready || null);
      })
      .catch(() => setLinkedTemplate(null));
  }, [id, activityKey]);

  useEffect(() => {
    if (!req?.customer_id) { setCustomerName(""); return; }
    crmGet<any>(`/api/customers/${req.customer_id}`)
      .then((r) => setCustomerName(r.data?.name || ""))
      .catch(() => setCustomerName(""));
  }, [req?.customer_id]);

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
  const canSalesHeadDecide = isSalesHead && req.status === "Pending_Sales_Head_Approval";
  const canRmgDecide = isRMG && req.status === "Pending_Engineering_Review";
  const canTerminate = isSalesHead && !TERMINAL_STATUSES.includes(req.status);
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
      const res = await crmPost(`/api/template-requests`, { requirement_id: req.id });
      toast(res.message || "Template request raised for RMG");
      crmNavigate("template-requests");
    } catch (e: any) {
      toast(e?.message || "Failed to raise template request", "err");
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
    { key: "postings", label: "Job Postings" },
    ...(canSeeResumes
      ? [
          // Renamed from "Resumes" (user decision, 25 Aug 2026): every resume
          // here IS an application, so the tab is named for the people.
          { key: "resumes", label: "Applied Candidates" },
          { key: "slots", label: "Interview Slots" },
        ]
      : []),
    // TA works the same opportunity from here (18 Aug 2026): who already
    // applied, and who in the database still could — the two tabs Admin/CEO
    // had on the opportunity page, now where sourcing actually happens.
    { key: "applicants", label: "Applicants" },
    { key: "suggested", label: "Suggested Candidates" },
    { key: "activity", label: "Activity Log" },
  ].filter((t) => reqAcc.subTabVisible(`tab:${t.key}`));

  return (
    <div className="space-y-4">
      {toastNode}

      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CrmLink
            to="requirements"
            className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-sky-600"
          >
            <ArrowLeft size={13} /> Opportunities
          </CrmLink>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-display text-xl font-bold text-primary">
              {reqLabel(req)} — {req.title}
            </h1>
            <StatusBadge status={req.status} />
          </div>
          <div className="mt-1 text-sm text-muted">
            {customerName || (req.customer_id != null ? `Customer #${req.customer_id}` : "No customer")}
            {" · "}{req.no_of_positions} position{req.no_of_positions === 1 ? "" : "s"}
            {" · "}
            {(isRMG || isSalesHead || isAdmin) ? (
              /* RMG/Sales_Head set urgency inline (25 Aug 2026) — deliberately
                 not the full edit form, which exposes budget fields. */
              <select
                className="inline-block rounded-control border border-subtle bg-surface-2 px-2 py-0.5 text-xs font-semibold text-primary"
                value={req.priority}
                disabled={priorityBusy}
                onChange={(e) => void setPriority(e.target.value)}
                title="Set the sourcing priority"
              >
                {["Low", "Medium", "High"].map((p) => <option key={p} value={p}>{p} priority</option>)}
              </select>
            ) : (
              <PriorityPill p={req.priority} />
            )}
          </div>
        </div>

        {/* action bar */}
        <div className="flex flex-wrap items-center gap-2">
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
          {isTA && SOURCING_STATUSES.includes(req.status) && (
            <button className={btnSecondary} onClick={doRequestTemplate} disabled={actionBusy}>
              <Send size={15} /> Request template
            </button>
          )}
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
                <Check size={15} /> Engineering Approve
              </button>
              <button className={btnDanger} onClick={() => setDecision({ stage: "engineering", kind: "reject" })}>
                <X size={15} /> Engineering Reject
              </button>
            </>
          )}
          {canHold && (
            <button className={btnSecondary} onClick={() => { setHoldOpen(true); setHoldNote(""); setHoldErr(""); }}
              title="Pause sourcing — uploads, slot invites and AI L1 scheduling stop until resumed">
              Hold
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
      </div>

      {/* On-hold banner: the reason is the first thing anyone needs to know. */}
      {req.status === "On_Hold" && (
        <div className="rounded-xl border border-amber-300/60 bg-amber-50/80 px-4 py-3 dark:border-amber-800/50 dark:bg-amber-950/30">
          <div className="text-sm font-bold text-amber-800 dark:text-amber-300">Sourcing on hold</div>
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
        <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-4 py-3">
          <div className="text-sm font-bold text-rose-700 dark:text-rose-300">Rejected by Sales Head</div>
          <div className="mt-0.5 text-sm text-rose-700 dark:text-rose-300">{req.sales_head_rejection_reason}</div>
        </div>
      )}
      {req.status === "Engineering_Rejected" && req.engineering_rejection_reason && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-4 py-3">
          <div className="text-sm font-bold text-rose-700 dark:text-rose-300">Rejected by Engineering (RMG)</div>
          <div className="mt-0.5 text-sm text-rose-700 dark:text-rose-300">{req.engineering_rejection_reason}</div>
        </div>
      )}

      {/* Approval/sourcing lifecycle stepper — hidden for TA (they work from Sourcing onward). */}
      {(!me.roles.includes("TA") || isAdmin) && <StatusStepper status={req.status} />}

      {linkedTemplate ? (
        <div className="rounded-card fx-gradient-border-animated bg-surface-1 px-4 py-3 shadow-sm">
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
      ) : (
        /* Always answer "can I run an AI L1 yet?" — before this, no template
           meant NO card, and the TA only learned at scheduling time (a 400). */
        <div className="rounded-card border border-amber-300/60 bg-amber-50/70 px-4 py-3 dark:border-amber-800/50 dark:bg-amber-950/25">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
            No AI L1 template yet
          </div>
          <div className="mt-1 text-sm text-amber-800 dark:text-amber-300">
            The AI L1 interview cannot run for this opportunity until RMG links a template.
            {isTA && SOURCING_STATUSES.includes(req.status)
              ? " Use the Request template button above to ask RMG."
              : " A Template Request must be raised and fulfilled by RMG."}
          </div>
        </div>
      )}

      {/* Overview strip + collapsible detail (18 Aug 2026 redesign): the page
          opens as a one-line answer to "what is this position?", and every
          block below is a headline you expand when you actually need it —
          the same pattern as the Sales-side opportunity page. */}
      <div className="rounded-card border border-subtle bg-surface-1 px-4 py-3 shadow-sm">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
          {([
            ["Experience", fmtRange(req.experience_min, req.experience_max, "yrs")],
            ["Budget CTC", fmtRange(req.budget_ctc_min, req.budget_ctc_max, "")],
            ["Positions", String(req.no_of_positions ?? "—")],
            ["Work mode", req.work_mode || "—"],
            ["Location", locationName || "—"],
            ["Target closure", fmtDate(req.target_closure_date)],
          ] as [string, string][]).map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-primary">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* tabs — placed directly under the summary so recruiters land on the
          working area (Resumes / Suggested Candidates). The reference cards
          live in the Details tab. */}
      <Tabs tabs={detailTabs} active={tab} onChange={setTab} />
      {tab === "postings" && <JobPostingsTab req={req} toast={toast} onRequirementChanged={() => onChanged()} />}
      {tab === "resumes" && canSeeResumes && (
        <ResumesTab req={req} toast={toast} onRequirementChanged={() => onChanged()} />
      )}
      {tab === "slots" && canSeeResumes && <SlotsTab req={req} toast={toast} />}
      {tab === "applicants" && (
        <RequirementApplicantsTab key={applicantsKey} oppId={req.opportunity_id} toast={toast} />
      )}
      {tab === "suggested" && (
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
      <CollapsibleCard title="Requirement Details" defaultOpen>
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
        <CollapsibleCard title="Budget by Experience" defaultOpen>
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

      <CollapsibleCard title={`Skills (${req.skills.length})`} defaultOpen>
        {req.skills.length === 0 ? (
          <p className="text-sm text-muted">No skills defined</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {req.skills.map((s) => (
              <span
                key={s.skill_id}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  s.is_mandatory ? "bg-sky-600 text-white" : "border border-strong text-secondary"
                }`}
                title={s.is_mandatory ? "Mandatory skill" : "Optional skill"}
              >
                {s.is_mandatory && <Star size={11} className="fill-current" />}
                {s.name || `Skill #${s.skill_id}`}
                {s.min_rating != null && <span className="opacity-75">· {s.min_rating}+/5</span>}
              </span>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-muted">
          <Star size={10} className="mr-0.5 inline fill-current" /> filled = mandatory (drives the ATS score)
        </p>
      </CollapsibleCard>

      <CollapsibleCard title="Job Description" defaultOpen>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Customer JD</div>
            {(req.customer_jd_attachments || []).length === 0 ? (
              <p className="text-sm text-muted">None uploaded on the opportunity</p>
            ) : (
              <ul className="space-y-1">
                {(req.customer_jd_attachments || []).map((a) => (
                  <li key={a.id}><FileLink url={a.file_url} label={a.file_name || "Customer JD"} /></li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">RMG JD</div>
            {req.rmg_jd_text ? (
              <p className="mb-2 whitespace-pre-wrap text-sm text-primary">{req.rmg_jd_text}</p>
            ) : (
              <p className="mb-2 text-sm text-muted">No RMG JD text yet</p>
            )}
            {(req.rmg_jd_attachments || []).length > 0 && (
              <ul className="space-y-1">
                {(req.rmg_jd_attachments || []).map((a) => (
                  <li key={a.id}><FileLink url={a.file_url} label={a.file_name || "RMG JD"} /></li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CollapsibleCard>
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
