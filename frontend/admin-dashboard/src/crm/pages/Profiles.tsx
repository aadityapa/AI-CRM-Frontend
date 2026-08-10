/** Candidate Profiles (candidate x opportunity): pipeline list + detail with
 * Overview / Skill Evaluation / Offers / Activity Log / AI Interview (Phase 5 integration).
 * Status transitions render ONLY detail.allowed_next_statuses (computed server-side per role);
 * every transition requires a comment (min 5 chars).
 * Calm-premium recipe (DESIGN-DECISIONS.md): token-only colors, raised cards,
 * zebra-free 48px table rows, right-aligned numerics, one primary action per screen. */
import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRight, ArrowRightLeft, Bot, Copy, ExternalLink, FileText, GitBranch, Pencil, Plus, Save, Trash2, UserCheck, UsersRound, X } from "lucide-react";
import { CrmApiError, crmDelete, crmGet, crmPost, crmPut, qs } from "../api";
import { fetchAllMaster } from "../lib/fetchAllMaster";
import type { Meta } from "../api";
import { displayEmail, realEmail } from "../lib/candidateEmail";
import { useHasRole } from "../CrmApp";
import { CrmLink, crmNavigate, useCrmParams } from "../routerHooks";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { RowActions, afterListDelete } from "../components/RowActions";
import { FileLink } from "../components/FileUpload";
import {
  TableCustomizerButton, sortToQuery, useTableLayout,
} from "../components/TableCustomizer";
import { Timeline } from "../components/Timeline";
import type { ActivityEntry } from "../components/Timeline";
import { AiInterviewCell } from "../components/AiInterviewCell";
import { ProfilesListPage as ProfilesDirectory } from "./profiles/ProfilesListPage";
import { SalesHeadApprovalBanner } from "../components/SalesHeadApprovalBanner";
import { RoundProgress } from "../components/RoundProgress";
import {
  ScheduleAiInterviewModal,
  toInputValue,
} from "../components/ScheduleAiInterviewModal";
import type { AiScheduleResult as SharedAiScheduleResult } from "../components/ScheduleAiInterviewModal";
import {
  AiThinking, ConfirmModal, EmptyState, ErrorBox, Field, Modal, Spinner, StatusBadge, Tabs,
  btnPrimary, btnSecondary, inputCls, statusLabel, useToast,
} from "../components/ui";
import {
  SectionHeaderBanner, FieldLabel, WizardField,
} from "../components/wizard";

/** Local single-screen shell — applies the shared New Opportunity wizard look
 * (theme-aware body + SectionHeaderBanner) inside the existing Modal.
 * Visual-only wrapper: no field, state, or submit logic lives here. */
function WizFormShell({
  title, subtitle, icon, children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
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

/** Column order this page ships with, until a user saves their own layout.
 * Keys match both the table columns and the server-side sort keys. */
const DEFAULT_PROFILE_COLUMNS = [
  "candidate_name", "email", "phone", "experience_years", "notice_period",
  "opportunity", "pipeline_status", "ai_interview", "current_ctc", "expected_ctc",
  "approved_ctc_budget", "interview_round", "interview_status", "interview_datetime",
  "resume_url", "resignation_certificate_url", "created_at",
];

/* ------------------------------------------------------------------ */
/* Shared types + helpers                                              */
/* ------------------------------------------------------------------ */

type ProfileRow = {
  id: number;
  candidate_id: number;
  opportunity_id: number;
  current_ctc: number | null;
  expected_ctc: number | null;
  hike_percent: number | null;
  /** Approved CTC budget from the opportunity's Candidate CTC Slab, matched to
   * the candidate's experience band. Stored in rupees; shown in lakhs. */
  approved_ctc_budget?: number | null;
  // --- workflow fields (migration 0059) ---
  source?: string | null;
  is_hidden?: boolean;
  sales_submission_date?: string | null;
  technical_submission_date?: string | null;
  customer_submission_date?: string | null;
  customer_onboarding_date?: string | null;
  commercial_approval_status?: string | null;
  offer_letter_reference?: string | null;
  resume_url?: string | null;
  cv_original_filename?: string | null;
  resignation_certificate_url?: string | null;
  resignation_status?: boolean;
  last_working_day?: string | null;
  stage?: string | null;
  employee_ref?: string | null;
  created_by_name?: string | null;
  comments_text?: string | null;
  // latest interview round, for the list columns
  interview_round?: string | null;
  interview_status?: string | null;
  interview_datetime?: string | null;
  interview_result?: string | null;
  interview_count?: number;
  customer_name?: string | null;
  customer_id?: number | null;
  /** The band it came from, e.g. "5-6" or "10+". */
  ctc_slab_band?: string | null;
  pipeline_status: string;
  commercial_approved: boolean;
  ctc_approval_amount: number | null;
  created_at: string | null;
  updated_at: string | null;
  // Enriched list fields (from GET /api/candidate-profiles)
  candidate_name?: string | null;
  email?: string | null;
  phone?: string | null;
  experience_years?: number | null;
  notice_period?: string | null;
  /* AI L1 outcome, from GET /api/candidate-profiles. `ai_hr_decision_label`
     is the recruiter's override where one exists and outranks the AI verdict. */
  ai_interview_status?: string | null;
  ai_interview_result?: string | null;
  ai_overall_score_percent?: number | null;
  ai_hr_decision?: string | null;
  ai_hr_decision_label?: string | null;
  ai_effective_result?: string | null;
  ai_is_overridden?: boolean;
  ai_report_link?: string | null;
  technical_domain?: string | null;
  cv_url?: string | null;
  candidate_current_ctc?: number | null;
  candidate_expected_ctc?: number | null;
  opportunity_opp_id?: string | null;
  opportunity_title?: string | null;
  /** When the candidate applied (Zoho "Added Time"); falls back to created_at. */
  applied_on?: string | null;
  ta_owner_name?: string | null;
  ta_owner_id?: number | null;
};

/** One human interview round (L1–L4, HR, customer) — recorded by RMG in the app
 * or imported from the Zoho Interview_Round subform. */
type InterviewEventRow = {
  id: number;
  kind: string;
  scheduled_at: string | null;
  raw_when: string | null;
  meeting_link: string | null;
  stage: string | null;
  mode: string | null;
  status: string | null;
  result: string | null;
  interviewer: string | null;
  feedback: string | null;
  interview_category: string | null;
  duration_minutes: number | null;
  user_role: string | null;
  employee_id: number | null;
  note: string | null;
  created_at: string | null;
};

/** Dropdown vocabulary + employee list, served by the API so the form and the
 * server validation can never drift apart. */
type InterviewRoundOptions = {
  categories: string[];
  /** `writable` is false for rounds this role may not save (see ROUND_WRITE_ROLES). */
  rounds: { value: string; label: string; writable?: boolean }[];
  writable_rounds?: string[];
  durations: number[];
  statuses: string[];
  results: string[];
  user_roles: string[];
  employees: { id: number; full_name: string; email: string; employee_code: string | null }[];
};

type SkillEvaluation = {
  id?: number;
  skill_id: number;
  skill_name: string;
  required_level: number | null;
  self_rated: number | null;
  reviewer_rated: number | null;
};

type Offer = {
  id: number;
  profile_id: number;
  offer_date: string | null;
  ctc: number | null;
  joining_date: string | null;
  offer_letter_url: string | null;
  acceptance_date: string | null;
  expiry_date: string | null;
  status: string;
};

type ProfileDetail = ProfileRow & {
  candidate: {
    id: number;
    full_name: string;
    email?: string | null;
    phone?: string | null;
    technical_domain?: string | null;
    cv_url?: string | null;
  } | null;
  opportunity: { id: number; opp_id?: string | null; title?: string | null; customer_name?: string | null } | null;
  skill_evaluations: SkillEvaluation[];
  offers: Offer[];
  interview_events: InterviewEventRow[];
  allowed_next_statuses: string[];
};

/** Phase 5 — AI interview session linked to this profile. */
type AiInterviewLink = {
  id: number;
  invite_token: string;
  schedule_id: number | null;
  interview_record_id: number | null;
  candidate_id: number;
  opportunity_id: number | null;
  profile_id: number;
  requirement_id: number | null;
  resume_id: number | null;
  scheduled_by: number | null;
  level: string | null;
  overall_score_percent: number | null;
  result: "Pending" | "Passed" | "Failed";
  created_at: string | null;
  completed_at: string | null;
  /** Same-origin admin URL to the full interview report (null until completed). */
  report_link: string | null;
  pending: boolean;
  /** Session details from the legacy interview_schedule row. */
  scheduled_at_local?: string | null;
  access_key?: string | null;
  candidate_name?: string | null;
  candidate_email?: string | null;
  session_status?: string | null;
  invite_url?: string | null;
  /** The candidate has opened/verified the session — no longer safe to change. */
  started?: boolean;
  /** Server's verdict on whether this session can be rescheduled or cancelled. */
  can_modify?: boolean;
  /**
   * Recruiter override from the interview report page. `result` above stays the
   * AI's own score-threshold verdict, so both can be shown: a candidate can be
   * "Selected" by a human while the AI recorded "Failed at 57.2%".
   */
  hr_decision?: string | null;
  hr_decision_label?: string | null;
  hr_decision_by?: string | null;
  hr_decision_at?: string | null;
  /** The override when present, else `result` — what a human should act on. */
  effective_result?: string | null;
  /** True only when the override actually disagrees with the AI verdict. */
  is_overridden?: boolean;
};

type AiScheduleResult = SharedAiScheduleResult;

/** Pipeline order — the filter dropdown and the status column both read this. */
const ACTIVE_STATUSES = [
  "Sourcing", "Technical_Screening", "RMG_Review", "Sales_Screening", "Customer_Screening",
  "Customer_Interview", "L1_Feedback", "L2_Feedback", "Shortlisted", "Customer_Approval",
  "Preboarding", "Joined",
];
const REJECTED_STATUSES = ["Sales_Rejected", "RMG_Rejected", "Customer_Rejected", "Self_Withdrawn", "Rejected"];
const REJECTION_LIKE = new Set(REJECTED_STATUSES);

const OFFER_STATUSES = ["Pending", "Accepted", "Expired", "Rejected"];

/** CTC is stored in rupees; recruiters read and quote it in lakhs. 2200000 -> "22.00". */
const LAKH = 100000;
const fmtLac = (v?: number | null) =>
  v === null || v === undefined ? "—" : (Number(v) / LAKH).toFixed(2);
/** Lakhs typed into a form -> rupees for the API. */
const lacToRupees = (v: string) => (v === "" ? null : Math.round(Number(v) * LAKH));
/** Rupees from the API -> lakhs for a form field. */
const rupeesToLac = (v?: number | null) =>
  v === null || v === undefined ? "" : String(Number(v) / LAKH);
const fmtHike = (v?: number | null) =>
  v === null || v === undefined ? "—" : `${Number(v).toFixed(2)}%`;
const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : "—");

const label = (s: string) => statusLabel(s);

/* Shared table recipe for the in-card tables (mirrors DataTable: zebra-free,
 * 48px rows, 12px uppercase muted header, right-aligned numerics). */
const cardCls = "rounded-card border border-subtle bg-surface-1 shadow-raised";
const thCls = "px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-muted";
const tdCls = "h-12 px-4 py-2 align-middle text-secondary";

function hikePreview(current: string, expected: string): string | null {
  const c = parseFloat(current);
  const e = parseFloat(expected);
  if (!isFinite(c) || !isFinite(e) || c === 0) return null;
  return (((e - c) / c) * 100).toFixed(2);
}

function numOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ */
/* LIST PAGE                                                           */
/* ------------------------------------------------------------------ */

export function ProfilesListPage(props: { title?: string; subtitle?: string } = {}) {
  // Thin adapter. The page itself lives in ./profiles/ so no single file owns
  // the whole surface; this supplies the formatting helpers and the create
  // modal, both of which are shared with the detail page below.
  return (
    <ProfilesDirectory
      {...props}
      helpers={{ fmtLac, fmtHike, fmtDate, fmtDateTime, roundLabel }}
      statuses={{ active: ACTIVE_STATUSES, rejected: REJECTED_STATUSES }}
      renderCreateModal={(close, onCreated) => (
        <NewProfileModal onClose={close} onCreated={onCreated} />
      )}
    />
  );
}

/* ---------- New Profile modal ---------- */

function NewProfileModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [candSearch, setCandSearch] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [opportunityId, setOpportunityId] = useState("");
  const [currentCtc, setCurrentCtc] = useState("");
  const [expectedCtc, setExpectedCtc] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    crmGet<any[]>("/api/candidates?limit=100").then((r) => setCandidates(r.data || [])).catch(() => {});
    crmGet<any[]>("/api/opportunities?limit=100").then((r) => setOpportunities(r.data || [])).catch(() => {});
  }, []);

  const candName = (c: any) =>
    c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || `Candidate #${c.id}`;

  const filteredCandidates = useMemo(() => {
    const q = candSearch.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) => candName(c).toLowerCase().includes(q) || String(c.email || "").toLowerCase().includes(q),
    );
  }, [candidates, candSearch]);

  const hike = hikePreview(currentCtc, expectedCtc);

  const submit = async () => {
    setError("");
    if (!candidateId || !opportunityId) {
      setError("Candidate and opportunity are required");
      return;
    }
    setBusy(true);
    try {
      const res = await crmPost<ProfileRow>("/api/candidate-profiles", {
        candidate_id: Number(candidateId),
        opportunity_id: Number(opportunityId),
        current_ctc: lacToRupees(currentCtc),
        expected_ctc: lacToRupees(expectedCtc),
        // Backend ProfileCreate has no notes field (ignored server-side); kept for future schema.
        notes: notes.trim() || undefined,
      });
      onCreated(res.data.id);
    } catch (e: any) {
      if (e instanceof CrmApiError && e.status === 409) {
        setError("A profile for this candidate and opportunity already exists.");
      } else {
        setError(e?.message || "Failed to create profile");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={<span className="sr-only">New Candidate Profile</span>}
      onClose={onClose}
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title="New Candidate Profile"
        subtitle="Link a candidate to an opportunity and capture their commercials."
        icon={<UsersRound size={20} aria-hidden />}
      >
        <div className="space-y-5">
          <div>
            <FieldLabel label="Candidate" required />
            <input
              className={`${inputCls} mb-1.5`}
              placeholder="Type to filter candidates…"
              value={candSearch}
              onChange={(e) => setCandSearch(e.target.value)}
            />
            <select className={inputCls} value={candidateId} onChange={(e) => setCandidateId(e.target.value)}>
              <option value="">Select candidate…</option>
              {filteredCandidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {candName(c)}{realEmail(c.email) ? ` — ${realEmail(c.email)}` : ""}
                </option>
              ))}
            </select>
          </div>
          <WizardField label="Opportunity" required icon="building">
            <select className={inputCls} value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)}>
              <option value="">Select opportunity…</option>
              {opportunities.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.opp_id ? `${o.opp_id} — ` : ""}{o.title || `Opportunity #${o.id}`}
                </option>
              ))}
            </select>
          </WizardField>
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <WizardField label="Current CTC (Lac)" icon="hash" filled={currentCtc !== ""}>
              <input type="number" min={0} step={0.01} placeholder="e.g. 22.00" className={inputCls} value={currentCtc} onChange={(e) => setCurrentCtc(e.target.value)} />
            </WizardField>
            <WizardField label="Expected CTC (Lac)" icon="hash" filled={expectedCtc !== ""}>
              <input type="number" min={0} step={0.01} placeholder="e.g. 25.00" className={inputCls} value={expectedCtc} onChange={(e) => setExpectedCtc(e.target.value)} />
            </WizardField>
          </div>
          {hike !== null && (
            <div className="rounded-control bg-info-soft px-3 py-2 text-xs font-semibold text-info">
              Hike preview: {hike}%
            </div>
          )}
          <WizardField label="Notes">
            <textarea className={inputCls} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </WizardField>
          {error && <ErrorBox error={error} />}
          <div className={wizFooterRow}>
            <button className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
            <button className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`} onClick={submit} disabled={busy}>
              {busy ? "Creating…" : "Create Profile"}
            </button>
          </div>
        </div>
      </WizFormShell>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* DETAIL PAGE                                                         */
/* ------------------------------------------------------------------ */

/** RMG hand-off card: shown while a profile sits in RMG_Review. Surfaces the
 * passed AI L1 result and guides the decision — request an L2 AI round, or
 * submit the candidate to the Sales team (or reject). */
function RmgDecisionBanner({
  profileId, aiLinks, onViewReport, onDone, showToast,
}: {
  profileId: number;
  aiLinks: AiInterviewLink[] | null;
  onViewReport: () => void;
  onDone: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const [busy, setBusy] = useState<"l2" | "sales" | "reject" | "f2f" | null>(null);
  const [f2fOpen, setF2fOpen] = useState(false);
  const [f2fWhen, setF2fWhen] = useState("");
  const [f2fLink, setF2fLink] = useState("");
  const [f2fNote, setF2fNote] = useState("");
  const completed = (aiLinks || []).filter((l) => !l.pending && l.overall_score_percent != null);
  const latest = completed.length
    ? completed.reduce((a, b) => ((a.completed_at || "") > (b.completed_at || "") ? a : b))
    : null;

  const transition = async (kind: "sales" | "reject") => {
    const isSales = kind === "sales";
    const comment = window.prompt(
      isSales
        ? "Comment for the activity log (why is this candidate being submitted to Sales?)"
        : "Rejection reason (mandatory)",
      isSales ? "AI L1 passed — RMG review complete, forwarding to Sales team" : "",
    );
    if (comment == null) return;
    if (comment.trim().length < 5) { showToast("A comment of at least 5 characters is required", "err"); return; }
    setBusy(kind);
    try {
      const res = await crmPost(`/api/candidate-profiles/${profileId}/status-transition`, {
        new_status: isSales ? "Sales_Screening" : "RMG_Rejected",
        comment: comment.trim(),
      });
      showToast(res.message || (isSales ? "Submitted to Sales team" : "Candidate rejected"));
      onDone();
    } catch (e: any) {
      showToast(e?.message || "Transition failed", "err");
    } finally {
      setBusy(null);
    }
  };

  const scheduleF2f = async () => {
    setBusy("f2f");
    try {
      const res = await crmPost<any>(`/api/candidate-profiles/${profileId}/l2-face-to-face`, {
        scheduled_at: f2fWhen.trim() || null,
        meeting_link: f2fLink.trim() || null,
        note: f2fNote.trim() || null,
      });
      showToast(res.message || "L2 face-to-face recorded — TA notified");
      setF2fOpen(false);
      onDone();
    } catch (e: any) {
      showToast(e?.message || "Failed to record the L2 round", "err");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-6 rounded-card border border-indigo-200/70 bg-indigo-50/60 p-5 shadow-raised dark:border-indigo-800/40 dark:bg-indigo-950/20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-bold text-indigo-700 dark:text-indigo-300">
            <Bot size={16} /> RMG review needed
          </div>
          <p className="mt-1 text-sm text-secondary">
            {latest
              ? <>AI L1 interview <span className="font-semibold text-emerald-600 dark:text-emerald-400">{latest.result}</span> with <span className="font-semibold">{latest.overall_score_percent}%</span>. Review the report, then decide: request an L2 round, or submit to the Sales team.</>
              : <>This candidate is awaiting your review. Check the AI interview report, then decide: request an L2 round, or submit to the Sales team.</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {latest?.report_link ? (
            <a className={btnSecondary} href={latest.report_link} target="_blank" rel="noreferrer">
              <ExternalLink size={15} /> View report
            </a>
          ) : (
            <button className={btnSecondary} onClick={onViewReport}>
              <FileText size={15} /> View report
            </button>
          )}
          <button className={btnSecondary} onClick={() => setF2fOpen(true)} disabled={busy != null}>
            <UsersRound size={15} /> L2 — Face-to-face
          </button>
          <button className={btnPrimary} onClick={() => void transition("sales")} disabled={busy != null}>
            <ArrowRightLeft size={15} /> {busy === "sales" ? "Submitting…" : "Submit to Sales team"}
          </button>
          <button
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-rose-300/60 bg-rose-50 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-300"
            onClick={() => void transition("reject")}
            disabled={busy != null}
          >
            <X size={15} /> {busy === "reject" ? "Rejecting…" : "Reject"}
          </button>
        </div>
      </div>
      {f2fOpen && (
        <Modal title="Schedule L2 face-to-face round" onClose={() => { if (busy !== "f2f") setF2fOpen(false); }}>
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              Candidate and RMG join a live call (e.g. Microsoft Teams). This logs the round, notifies TA
              to coordinate, and emails the candidate the details when an email is on file. The profile
              stays in RMG Review — decide after the call.
            </p>
            <Field label="Date & time">
              <input
                type="datetime-local"
                className={inputCls}
                value={f2fWhen}
                onChange={(e) => setF2fWhen(e.target.value)}
              />
            </Field>
            <Field label="Meeting link (Teams / Meet)">
              <input
                className={inputCls}
                placeholder="https://teams.microsoft.com/…"
                value={f2fLink}
                onChange={(e) => setF2fLink(e.target.value)}
              />
            </Field>
            <Field label="Note for the candidate / TA (optional)">
              <textarea
                className={inputCls}
                rows={2}
                value={f2fNote}
                onChange={(e) => setF2fNote(e.target.value)}
                placeholder="e.g. Please keep your project portfolio ready."
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button className={btnSecondary} onClick={() => setF2fOpen(false)} disabled={busy === "f2f"}>
                Cancel
              </button>
              <button className={btnPrimary} onClick={() => void scheduleF2f()} disabled={busy === "f2f"}>
                {busy === "f2f" ? "Saving…" : "Schedule & notify"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function ProfileDetailPage() {
  const { id } = useCrmParams();
  const [toast, showToast] = useToast();
  const [detail, setDetail] = useState<ProfileDetail | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");
  const isRmg = useHasRole("RMG");
  const isSalesHead = useHasRole("Sales_Head");

  /** Newest offer, shown to Sales Head as the terms they are approving. */
  const latestOffer = useMemo(() => {
    const offers = detail?.offers || [];
    if (offers.length === 0) return null;
    const newest = [...offers].sort((a, b) =>
      String(b.offer_date || "").localeCompare(String(a.offer_date || "")) || b.id - a.id,
    )[0];
    return {
      ctc: newest.ctc,
      joining_date: newest.joining_date,
      offer_date: newest.offer_date,
      status: newest.status,
    };
  }, [detail?.offers]);

  // AI interview sessions — fetched on page load (powers the header pending
  // badge) and reused by the AI Interview tab.
  const [aiLinks, setAiLinks] = useState<AiInterviewLink[] | null>(null);
  const [aiPendingCount, setAiPendingCount] = useState(0);
  const [aiError, setAiError] = useState("");

  const load = () => {
    setError("");
    crmGet<ProfileDetail>(`/api/candidate-profiles/${id}`)
      .then((r) => setDetail(r.data))
      .catch((e: any) => setError(e?.message || "Failed to load profile"));
  };
  useEffect(load, [id]);

  const loadAi = () => {
    setAiError("");
    crmGet<AiInterviewLink[]>(`/api/candidate-profiles/${id}/ai-interviews`)
      .then((r) => {
        const links = r.data || [];
        setAiLinks(links);
        const pc = (r.meta as any)?.pending_count;
        setAiPendingCount(typeof pc === "number" ? pc : links.filter((l) => l.pending).length);
      })
      .catch((e: any) => setAiError(e?.message || "Failed to load AI interviews"));
  };
  useEffect(loadAi, [id]);

  // Header AI chip: once an interview is COMPLETED, its result is the truth —
  // a leftover unopened invite must not keep showing "pending" forever.
  const aiCompleted = (aiLinks || []).filter((l) => !l.pending && l.overall_score_percent != null);
  const aiLatest = aiCompleted.length
    ? aiCompleted.reduce((a, b) => ((a.completed_at || "") > (b.completed_at || "") ? a : b))
    : null;

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!detail) return <Spinner label="Loading profile…" />;

  return (
    <div>
      {toast}
      <div className="mb-3 text-xs font-semibold text-muted">
        <CrmLink to="profiles" className="hover:underline">Candidate Profiles</CrmLink>
        <span className="mx-1.5">/</span>
        <span>Profile #{detail.id}</span>
      </div>

      {/* ---------- Header card ---------- */}
      <div className="glass fx-gradient-border rounded-card shadow-raised mb-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-display text-xl font-bold text-primary">
                {detail.candidate ? (
                  <CrmLink to={`candidates/${detail.candidate.id}`} className="hover:underline">
                    {detail.candidate.full_name || `Candidate #${detail.candidate.id}`}
                  </CrmLink>
                ) : (
                  `Candidate #${detail.candidate_id}`
                )}
              </h1>
              {aiLatest ? (
                /* A recruiter override outranks the AI verdict in the header —
                   this badge is the at-a-glance status, so it must say what a
                   human decided when a human decided. The AI score stays in the
                   text and the full detail is on the AI Interview tab. */
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ring-subtle ${
                    (aiLatest.hr_decision || "").toLowerCase() === "selected"
                      ? "bg-success-soft text-success"
                      : (aiLatest.hr_decision || "").toLowerCase() === "rejected"
                        ? "bg-danger-soft text-danger"
                        : aiLatest.hr_decision
                          ? "bg-warning-soft text-warning"
                          : aiLatest.result === "Passed"
                            ? "bg-success-soft text-success"
                            : "bg-danger-soft text-danger"
                  }`}
                  title={
                    aiLatest.is_overridden
                      ? `Recruiter marked this ${aiLatest.hr_decision_label}` +
                        (aiLatest.hr_decision_by ? ` (${aiLatest.hr_decision_by})` : "") +
                        `. The AI scored ${aiLatest.overall_score_percent}% and recorded ${aiLatest.result}.`
                      : `AI L1 ${aiLatest.result} at ${aiLatest.overall_score_percent}%`
                  }
                >
                  {aiLatest.hr_decision_label ? <UserCheck size={12} /> : <Bot size={12} />}
                  {aiLatest.hr_decision_label
                    ? <>AI L1 {aiLatest.hr_decision_label} · {aiLatest.overall_score_percent}%</>
                    : <>AI L1 {aiLatest.result} · {aiLatest.overall_score_percent}%</>}
                </span>
              ) : aiPendingCount > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-semibold text-warning ring-1 ring-inset ring-subtle">
                  <AlertTriangle size={12} /> AI interview pending
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted">
              <span>
                {[realEmail(detail.candidate?.email), detail.candidate?.phone]
                  .filter(Boolean).join(" · ") || "No contact details"}
              </span>
              {/* The resume is the thing RMG needs most while reviewing an
                  application — the payload always carried it, it was just never shown. */}
              {detail.candidate?.cv_url ? (
                <FileLink url={detail.candidate.cv_url} label="View CV" />
              ) : (
                <span className="text-xs">No CV on file</span>
              )}
            </div>
            {/* The ladder so far. Pipeline status says WHERE they are; this
                says what happened on the way, without opening a tab. */}
            <div className="mt-2">
              <RoundProgress
                rounds={detail.interview_events || []}
                aiScore={aiLatest?.overall_score_percent}
                aiResult={aiLatest?.effective_result || aiLatest?.result}
                fmtDateTime={fmtDateTime}
                onOpen={() => setTab("interviews")}
              />
            </div>
            <div className="mt-2 text-sm text-secondary">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Opportunity</span>{" "}
              {detail.opportunity ? (
                <CrmLink
                  to={`opportunities/${detail.opportunity.id}`}
                  className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
                >
                  {detail.opportunity.opp_id ? `${detail.opportunity.opp_id} — ` : ""}
                  {detail.opportunity.title || `Opportunity #${detail.opportunity.id}`}
                </CrmLink>
              ) : (
                <span>Opportunity #{detail.opportunity_id}</span>
              )}
              {detail.opportunity?.customer_name && (
                <span className="text-muted"> · {detail.opportunity.customer_name}</span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <StatusBadge status={detail.pipeline_status} />
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ring-subtle ${
                detail.commercial_approved ? "bg-success-soft text-success" : "bg-surface-2 text-muted"
              }`}
            >
              {detail.commercial_approved ? "Commercial approved" : "Commercial not approved"}
            </span>
          </div>
        </div>
        {/* Hike % stays here — only the LIST column was replaced. The approved
            budget is added alongside so the two can be compared at a glance. */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <HeaderStat label="Current CTC (Lac)" value={fmtLac(detail.current_ctc)} />
          <HeaderStat label="Expected CTC (Lac)" value={fmtLac(detail.expected_ctc)} />
          <HeaderStat label="Hike %" value={fmtHike(detail.hike_percent)} />
          <HeaderStat
            label={`Approved CTC Budget (Lac)${detail.ctc_slab_band ? ` · ${detail.ctc_slab_band} yrs` : ""}`}
            value={fmtLac(detail.approved_ctc_budget)}
          />
          <HeaderStat label="CTC Approval (Lac)" value={fmtLac(detail.ctc_approval_amount)} />
        </div>
      </div>

      {isRmg && detail.pipeline_status === "RMG_Review" && (
        <RmgDecisionBanner
          profileId={detail.id}
          aiLinks={aiLinks}
          onViewReport={() => setTab("ai")}
          onDone={() => { load(); loadAi(); }}
          showToast={showToast}
        />
      )}

      {/* Sales Head's one decision, at the one stage they own. Without this
          they had to find "Preboarding" in a generic dropdown, with nothing
          explaining that choosing it IS the approval. */}
      {isSalesHead && detail.pipeline_status === "Customer_Approval" && (
        <SalesHeadApprovalBanner
          profileId={detail.id}
          candidateName={detail.candidate?.full_name || `Candidate #${detail.candidate_id}`}
          offer={latestOffer}
          fmtLac={fmtLac}
          fmtDate={fmtDate}
          onDone={load}
          showToast={showToast}
        />
      )}

      <div className="mb-4">
        <Tabs
          tabs={[
            { key: "overview", label: "Overview" },
            { key: "interviews", label: "Interviews", count: detail.interview_events?.length },
            { key: "skills", label: "Skill Evaluation", count: detail.skill_evaluations?.length },
            { key: "offers", label: "Offers", count: detail.offers?.length },
            { key: "activity", label: "Activity Log" },
            { key: "ai", label: "AI Interview" },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === "overview" && (
        <OverviewTab
          detail={detail}
          onReload={load}
          showToast={showToast}
        />
      )}
      {tab === "interviews" && (
        <InterviewsTab
          profileId={detail.id}
          events={detail.interview_events || []}
          onReload={load}
          showToast={showToast}
        />
      )}
      {tab === "skills" && <SkillsTab detail={detail} onReload={load} showToast={showToast} />}
      {tab === "offers" && <OffersTab detail={detail} onReload={load} showToast={showToast} />}
      {tab === "activity" && <ActivityTab profileId={detail.id} />}
      {tab === "ai" && (
        <AiInterviewTab
          profileId={detail.id}
          candidate={detail.candidate}
          links={aiLinks}
          error={aiError}
          onReload={loadAi}
          showToast={showToast}
        />
      )}
    </div>
  );
}

function HeaderStat({ label: l, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="glass fx-gradient-border fx-lift rounded-card px-3 py-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{l}</div>
      <div className="font-display text-sm font-bold tabular-nums text-primary">{value}</div>
    </div>
  );
}

/* ---------- Overview tab ---------- */

function OverviewTab({
  detail,
  onReload,
  showToast,
}: {
  detail: ProfileDetail;
  onReload: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const canEdit = useHasRole("TA", "Sales", "RMG");
  const [currentCtc, setCurrentCtc] = useState(rupeesToLac(detail.current_ctc));
  const [expectedCtc, setExpectedCtc] = useState(rupeesToLac(detail.expected_ctc));
  const [approvalAmount, setApprovalAmount] = useState(rupeesToLac(detail.ctc_approval_amount));
  const [commercialApproved, setCommercialApproved] = useState(detail.commercial_approved);
  // Workflow references: issued outside this system, so they can only be typed.
  const [offerRef, setOfferRef] = useState(detail.offer_letter_reference ?? "");
  const [employeeRef, setEmployeeRef] = useState(detail.employee_ref ?? "");
  const [onboardingDate, setOnboardingDate] = useState(detail.customer_onboarding_date ?? "");
  const [saving, setSaving] = useState(false);
  const [showTransition, setShowTransition] = useState(false);
  // Workflow actions. Scheduling and feedback reuse the Interviews tab's modal
  // rather than duplicating that form here.
  const canSubmitToCustomer = useHasRole("Sales", "Sales_Head");
  const [submitting, setSubmitting] = useState(false);

  const submitToCustomer = async () => {
    setSubmitting(true);
    try {
      const res = await crmPost(`/api/candidate-profiles/${detail.id}/submit-to-customer`, {});
      showToast(res.message || "Submitted to the customer");
      onReload();
    } catch (e: any) {
      showToast(e?.message || "Failed to record the submission", "err");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    setCurrentCtc(detail.current_ctc?.toString() ?? "");
    setExpectedCtc(detail.expected_ctc?.toString() ?? "");
    setApprovalAmount(detail.ctc_approval_amount?.toString() ?? "");
    setCommercialApproved(detail.commercial_approved);
    setOfferRef(detail.offer_letter_reference ?? "");
    setEmployeeRef(detail.employee_ref ?? "");
    setOnboardingDate(detail.customer_onboarding_date ?? "");
  }, [detail]);

  const allowed = detail.allowed_next_statuses || [];
  const hike = hikePreview(currentCtc, expectedCtc);

  const save = async () => {
    setSaving(true);
    try {
      await crmPut(`/api/candidate-profiles/${detail.id}`, {
        current_ctc: lacToRupees(currentCtc),
        expected_ctc: lacToRupees(expectedCtc),
        ctc_approval_amount: lacToRupees(approvalAmount),
        commercial_approved: commercialApproved,
        // Send null rather than "" so clearing a reference actually clears it.
        offer_letter_reference: offerRef.trim() || null,
        employee_ref: employeeRef.trim() || null,
        customer_onboarding_date: onboardingDate || null,
      });
      showToast("Profile updated");
      onReload();
    } catch (e: any) {
      showToast(e?.message || "Failed to update profile", "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${cardCls} p-6`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold text-primary">Commercials</h2>
        <span title={allowed.length === 0 ? "No transitions available for your role" : undefined}>
          {/* Secondary by design — "Save changes" below is this screen's one primary action. */}
          <button className={btnSecondary} disabled={allowed.length === 0} onClick={() => setShowTransition(true)}>
            <ArrowRightLeft size={15} /> Change Status
          </button>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Current CTC (Lac)">
          <input
            type="number" min={0} step={0.01} placeholder="e.g. 22.00" className={inputCls} value={currentCtc} disabled={!canEdit}
            onChange={(e) => setCurrentCtc(e.target.value)}
          />
        </Field>
        <Field label="Expected CTC (Lac)">
          <input
            type="number" min={0} step={0.01} placeholder="e.g. 25.00" className={inputCls} value={expectedCtc} disabled={!canEdit}
            onChange={(e) => setExpectedCtc(e.target.value)}
          />
        </Field>
        <Field label="CTC Approval (Lac)">
          <input
            type="number" min={0} step={0.01} placeholder="e.g. 26.00" className={inputCls} value={approvalAmount} disabled={!canEdit}
            onChange={(e) => setApprovalAmount(e.target.value)}
          />
        </Field>
      </div>

      {/* Workflow. The handover dates are stamped by the pipeline itself when the
          profile reaches each stage, so they stay read-only — a typed date would
          drift from the status history that turnaround time is measured against.
          The references have no automated source and so are editable here.
          Stage, Commercial Approval Status and Created by used to sit in this
          block; the first two restated the pipeline status and the checkbox
          below, and nothing ever wrote the third. */}
      <div className="mt-5 rounded-xl border border-subtle bg-surface-2 p-4">
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
          Workflow
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
          {([
            ["Submitted for Technical", detail.technical_submission_date,
             "Stamped when the profile reaches Technical Screening"],
            ["Submitted to Sales", detail.sales_submission_date,
             "Stamped when the profile reaches Sales Screening"],
            ["Submitted to Customer", detail.customer_submission_date,
             "Stamped when the profile is submitted to the customer"],
          ] as [string, string | null | undefined, string][]).map(([label, value, hint]) => (
            <div key={label}>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
              <dd className="mt-0.5 text-sm text-primary" title={value ? undefined : hint}>
                {value ? fmtDate(value) : <span className="text-muted">Not yet</span>}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Offer Letter Reference">
            <input
              className={inputCls} value={offerRef} disabled={!canEdit}
              placeholder="e.g. KRX/OL/2026/0142"
              onChange={(e) => setOfferRef(e.target.value)}
            />
          </Field>
          <Field label="Employee Reference">
            <input
              className={inputCls} value={employeeRef} disabled={!canEdit}
              placeholder="Issued after joining"
              onChange={(e) => setEmployeeRef(e.target.value)}
            />
          </Field>
          <Field label="Onboarding Date">
            <input
              type="date" className={inputCls} value={onboardingDate} disabled={!canEdit}
              onChange={(e) => setOnboardingDate(e.target.value)}
            />
          </Field>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">CV</dt>
            <dd className="mt-0.5 text-sm">
              {detail.resume_url ? (
                <FileLink url={detail.resume_url} label={detail.cv_original_filename || "View CV"} />
              ) : (
                <span className="text-muted">—</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
              Resignation Certificate
            </dt>
            <dd className="mt-0.5 text-sm">
              {detail.resignation_certificate_url ? (
                <FileLink url={detail.resignation_certificate_url} label="View" />
              ) : (
                <span className="text-muted">—</span>
              )}
            </dd>
          </div>
        </dl>
        {detail.comments_text && (
          <div className="mt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Comments</div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-secondary">{detail.comments_text}</p>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-secondary">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={commercialApproved}
              disabled={!canEdit}
              onChange={(e) => setCommercialApproved(e.target.checked)}
            />
            Commercial approved
          </label>
          {hike !== null && (
            <span className="rounded-control bg-info-soft px-2.5 py-1 text-xs font-semibold text-info">
              Hike preview: {hike}%
            </span>
          )}
        </div>
        {canEdit && (
          <button className={btnPrimary} onClick={save} disabled={saving}>
            <Save size={15} /> {saving ? "Saving…" : "Save changes"}
          </button>
        )}
      </div>

      {/*
        Workflow actions.

        "Schedule Technical Interview" and "Submit Technical Feedback" were
        removed (Aug 2026). Both were pure navigation — they jumped to the
        Interviews tab and opened a modal that tab already offers. Neither was
        role-gated, so Sales saw two buttons labelled "Technical" leading to a
        tab where they can only write the customer round: a dead end presented
        as an action.

        "Submit to Customer" stays, but only while it is still doable. Once
        submitted it used to become a disabled button reading "Submitted
        8/8/2026" — a status display shaped like a control, duplicating the
        "Submitted to Customer" row in the Workflow list directly above.
      */}
      {canSubmitToCustomer && !detail.customer_submission_date && (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-subtle pt-4">
          <button
            className={btnPrimary}
            onClick={submitToCustomer}
            disabled={submitting}
            title="Stamp today's date and move to Customer Screening"
          >
            <ArrowRight size={15} /> {submitting ? "Submitting…" : "Submit to Customer"}
          </button>
        </div>
      )}

      <div className="mt-6 border-t border-subtle pt-4 text-xs text-muted">
        Created {fmtDate(detail.created_at)} · Last updated {fmtDate(detail.updated_at)}
      </div>

      {showTransition && (
        <TransitionModal
          profileId={detail.id}
          currentStatus={detail.pipeline_status}
          allowed={allowed}
          candidateName={detail.candidate?.full_name || detail.candidate_name}
          opportunityLabel={
            [detail.opportunity?.opp_id, detail.opportunity?.title ?? detail.opportunity?.customer_name]
              .filter(Boolean)
              .join(" · ") || null
          }
          hasOffer={(detail.offers || []).length > 0}
          onClose={() => setShowTransition(false)}
          onDone={(msg) => {
            setShowTransition(false);
            showToast(msg || "Status updated");
            onReload();
          }}
        />
      )}
    </div>
  );
}

function TransitionModal({
  profileId,
  currentStatus,
  allowed,
  candidateName,
  opportunityLabel,
  hasOffer,
  onClose,
  onDone,
}: {
  profileId: number;
  currentStatus: string;
  allowed: string[];
  /** Shown in the dialog — a reviewer moving several candidates in a row needs
   *  to see WHO they are about to move, not just from-status → to-status. */
  candidateName?: string | null;
  opportunityLabel?: string | null;
  /** Customer Approved needs an offer; when there is none we collect it here. */
  hasOffer?: boolean;
  onClose: () => void;
  onDone: (message?: string) => void;
}) {
  const [newStatus, setNewStatus] = useState("");
  const [comment, setComment] = useState("");
  // Offer fields, shown inline when moving to Customer Approved.
  const [offerCtc, setOfferCtc] = useState("");
  const [offerJoining, setOfferJoining] = useState("");
  const [offerDate, setOfferDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [offerError, setOfferError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [commentError, setCommentError] = useState("");

  const submit = async () => {
    setError("");
    setCommentError("");
    setOfferError("");
    if (!newStatus) {
      setError("Select the new status");
      return;
    }
    // Only enforced where the note carries information — mirrors
    // comment_required_for() on the server.
    if (noteRequired && comment.trim().length < 5) {
      setCommentError(
        leavingCustomerInterview
          ? "Record what the customer said (minimum 5 characters)"
          : "Say why this is moving (minimum 5 characters)",
      );
      return;
    }
    if (needsOffer) {
      if (!offerCtc.trim() || Number(offerCtc) <= 0) {
        setOfferError("Enter the offered CTC");
        return;
      }
      if (!offerDate) {
        setOfferError("Pick the offer date");
        return;
      }
    }
    setBusy(true);
    try {
      const res = await crmPost(`/api/candidate-profiles/${profileId}/status-transition`, {
        new_status: newStatus,
        comment: comment.trim() || undefined,
        // Sent with the move so both land in one transaction — a rejected
        // transition rolls the offer back instead of orphaning it.
        offer: needsOffer
          ? {
              offer_date: offerDate,
              ctc: lacToRupees(offerCtc),
              joining_date: offerJoining || null,
            }
          : undefined,
      });
      onDone(res.message);
    } catch (e: any) {
      setError(e?.message || "Transition failed");
      setBusy(false);
    }
  };

  const isReject = !!newStatus && REJECTION_LIKE.has(newStatus);
  /**
   * Mirrors _record_customer_round_from_transition on the server.
   *
   * Two moments make this field the customer's actual interview feedback:
   *   - ARRIVING at L1/L2 Feedback — that round's verdict is in
   *   - LEAVING the customer's ladder with a decision
   * Everything else is just a reason for the activity log.
   */
  const CUSTOMER_LADDER = ["Customer_Interview", "L1_Feedback", "L2_Feedback"];
  const arrivingAtFeedback = ["L1_Feedback", "L2_Feedback"].includes(newStatus);
  const closingTheLadder =
    CUSTOMER_LADDER.includes(currentStatus) &&
    ["Shortlisted", "Customer_Approval", "Customer_Rejected"].includes(newStatus);
  const leavingCustomerInterview = arrivingAtFeedback || closingTheLadder;
  const feedbackRoundLabel =
    newStatus === "L1_Feedback" ? "L1" : newStatus === "L2_Feedback" ? "L2" : null;

  /**
   * Is a written note required? Mirrors comment_required_for() on the server.
   *
   * Requiring one on every move made it noise on routine progress — people
   * type "ok" to get past it, and that habit devalues the notes that matter.
   * It is asked for where nothing else records the information: rejections,
   * backward moves, and the customer's feedback.
   */
  const BACKWARD: Record<string, string[]> = {
    Customer_Screening: ["Sales_Screening"],
    Customer_Interview: ["Customer_Screening"],
    L1_Feedback: ["Customer_Interview"],
    L2_Feedback: ["L1_Feedback"],
  };
  const noteRequired =
    isReject ||
    leavingCustomerInterview ||
    (BACKWARD[currentStatus] || []).includes(newStatus);

  /** Customer Approved needs an offer; collect it here rather than sending the
   *  user to the Offers tab and back. */
  const needsOffer = newStatus === "Customer_Approval" && !hasOffer;
  return (
    <Modal
      title={<span className="sr-only">Change Pipeline Status</span>}
      onClose={onClose}
      scopeClassName="crm-wizard wiz-noise"
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
        className="space-y-5"
      >
        {/* Header: gradient icon tile + title */}
        <div className="flex items-center gap-3">
          <motion.div
            initial={{ rotate: -12, scale: 0.8 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.05 }}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/30"
          >
            <GitBranch size={20} aria-hidden />
          </motion.div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-primary">Change Pipeline Status</h2>
            {candidateName ? (
              <p className="truncate text-xs text-muted">
                <span className="font-semibold text-secondary">{candidateName}</span>
                {opportunityLabel ? <> · {opportunityLabel}</> : null}
              </p>
            ) : (
              <p className="text-xs text-muted">Pick the next stage and record your feedback.</p>
            )}
          </div>
        </div>

        {/* Status flow: current → new */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-subtle bg-surface-2 px-3 py-2.5">
          <StatusBadge status={currentStatus} />
          <motion.span
            animate={{ x: [0, 4, 0] }}
            transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
            className={isReject ? "text-danger" : "text-brand-600 dark:text-brand-300"}
          >
            <ArrowRight size={16} aria-hidden />
          </motion.span>
          <AnimatePresence mode="wait">
            {newStatus ? (
              <motion.span
                key={newStatus}
                initial={{ opacity: 0, scale: 0.7, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ type: "spring", stiffness: 380, damping: 20 }}
              >
                <StatusBadge status={newStatus} />
              </motion.span>
            ) : (
              <motion.span
                key="placeholder"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="rounded-full border border-dashed border-strong px-2.5 py-0.5 text-xs font-semibold text-muted"
              >
                select below…
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <WizardField label="New status" required>
          <select className={inputCls} value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
            <option value="">Select new status…</option>
            {allowed.map((s) => (
              <option key={s} value={s} className={REJECTION_LIKE.has(s) ? "font-semibold text-danger" : ""}>
                {REJECTION_LIKE.has(s) ? `⛔ ${label(s)}` : label(s)}
              </option>
            ))}
          </select>
        </WizardField>

        <AnimatePresence>
          {isReject && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-2 rounded-control bg-danger-soft px-3 py-2 text-xs font-semibold text-danger">
                <AlertTriangle size={14} className="shrink-0" />
                This is a rejection/withdrawal — the profile moves to the Rejected bucket.
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/*
          Two different things wear the same input.

          Leaving an interview stage with a verdict, what you type IS the
          interview feedback — it is saved as a round and shows on the
          Interviews tab. Every other move just needs to say why, for the
          activity log.

          Both stay mandatory. Making routine moves noteless would leave the
          activity log — the only record most stages have — unable to explain
          why anything moved.
        */}
        {/* Offer terms, inline. Customer Approved cannot be entered without an
            offer, so asking for it here removes a detour to the Offers tab and
            back — and both writes land in one server transaction. */}
        <AnimatePresence>
          {needsOffer && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="rounded-card border border-brand-200 bg-brand-50 p-3 dark:border-brand-500/40 dark:bg-brand-900/20">
                <p className="mb-2 text-xs font-semibold text-brand-700 dark:text-brand-300">
                  Offer terms — these are what Sales Head will approve.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <WizardField label="Offered CTC (Lac)" required>
                    <input
                      type="number" min={0} step={0.01} placeholder="e.g. 12.50"
                      className={inputCls}
                      value={offerCtc}
                      onChange={(e) => setOfferCtc(e.target.value)}
                    />
                  </WizardField>
                  <WizardField label="Joining date">
                    <input
                      type="date" className={inputCls}
                      value={offerJoining}
                      onChange={(e) => setOfferJoining(e.target.value)}
                    />
                  </WizardField>
                  <WizardField label="Offer date" required>
                    <input
                      type="date" className={inputCls}
                      value={offerDate}
                      onChange={(e) => setOfferDate(e.target.value)}
                    />
                  </WizardField>
                </div>
                {offerError && <p className="mt-1 text-xs font-semibold text-danger">{offerError}</p>}
                <p className="mt-2 text-xs text-muted">
                  Saved to the Offers tab and sent to Sales Head for approval.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* The note is only asked for where it records something nothing else
            does — see noteRequired. Routine progress does not need one. */}
        {noteRequired && (
        <WizardField
          label={leavingCustomerInterview ? "Feedback" : "Reason"}
          required
          error={commentError}
          info={
            feedbackRoundLabel
              ? `Saved as the customer's ${feedbackRoundLabel} round — it will appear on the Interviews tab.`
              : leavingCustomerInterview
                ? "Saved against the customer round — it will appear on the Interviews tab."
                : undefined
          }
        >
          <textarea
            className={`${inputCls} ${commentError ? "input-error" : ""}`}
            rows={leavingCustomerInterview ? 3 : 2}
            placeholder={
              feedbackRoundLabel
                ? `What did the customer say after their ${feedbackRoundLabel} round? (min 5 characters)`
                : leavingCustomerInterview
                  ? "What did the customer say? (min 5 characters)"
                  : "Why is this moving? (min 5 characters)"
            }
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </WizardField>
        )}
        {error && <ErrorBox error={error} />}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <motion.button
            whileHover={{ scale: busy ? 1 : 1.03 }}
            whileTap={{ scale: busy ? 1 : 0.97 }}
            className={`h-10 rounded-xl px-5 text-sm font-bold text-white shadow-lg transition-colors disabled:opacity-60 ${
              isReject
                ? "bg-gradient-to-r from-rose-500 to-red-600 shadow-rose-500/30"
                : "bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 shadow-violet-500/30"
            }`}
            onClick={submit}
            disabled={busy}
          >
            {busy ? "Updating…" : isReject ? "Confirm & Reject" : "Update Status"}
          </motion.button>
        </div>
      </motion.div>
    </Modal>
  );
}

/* ---------- Skill Evaluation tab ---------- */

type EvalRow = {
  skill_id: number;
  skill_name: string;
  required_level: string;
  self_rated: string;
  reviewer_rated: string;
  isNew?: boolean;
};

function SkillsTab({
  detail,
  onReload,
  showToast,
}: {
  detail: ProfileDetail;
  onReload: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const canEval = useHasRole("RMG", "TA", "Sales");
  const toRows = (evals: SkillEvaluation[]): EvalRow[] =>
    (evals || []).map((e) => ({
      skill_id: e.skill_id,
      skill_name: e.skill_name,
      required_level: e.required_level?.toString() ?? "",
      self_rated: e.self_rated?.toString() ?? "",
      reviewer_rated: e.reviewer_rated?.toString() ?? "",
    }));

  const [rows, setRows] = useState<EvalRow[]>(toRows(detail.skill_evaluations));
  const [skills, setSkills] = useState<any[]>([]);
  const [addSkillId, setAddSkillId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setRows(toRows(detail.skill_evaluations)); }, [detail]);
  useEffect(() => {
    if (canEval) fetchAllMaster<any>("/api/skills").then(setSkills).catch(() => {});
  }, [canEval]);

  const usedIds = new Set(rows.map((r) => r.skill_id));
  const availableSkills = skills.filter((s) => !usedIds.has(s.id));

  const setCell = (idx: number, field: "required_level" | "self_rated" | "reviewer_rated", value: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const addRow = () => {
    const skill = skills.find((s) => String(s.id) === addSkillId);
    if (!skill) return;
    setRows((prev) => [
      ...prev,
      { skill_id: skill.id, skill_name: skill.name, required_level: "", self_rated: "", reviewer_rated: "", isNew: true },
    ]);
    setAddSkillId("");
  };

  const removeNewRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx));

  const ratingOrNull = (s: string): number | null => {
    if (s.trim() === "") return null;
    return parseInt(s, 10);
  };

  const save = async () => {
    setError("");
    if (rows.length === 0) {
      setError("Add at least one skill to evaluate");
      return;
    }
    for (const r of rows) {
      for (const f of ["required_level", "self_rated", "reviewer_rated"] as const) {
        const v = ratingOrNull(r[f]);
        if (v !== null && (!Number.isInteger(v) || v < 1 || v > 5)) {
          setError(`${r.skill_name}: ratings must be between 1 and 5`);
          return;
        }
      }
    }
    setSaving(true);
    try {
      await crmPost(
        `/api/candidate-profiles/${detail.id}/skill-evaluation`,
        rows.map((r) => ({
          skill_id: r.skill_id,
          required_level: ratingOrNull(r.required_level),
          self_rated: ratingOrNull(r.self_rated),
          reviewer_rated: ratingOrNull(r.reviewer_rated),
        })),
      );
      showToast("Skill evaluations saved");
      onReload();
    } catch (e: any) {
      showToast(e?.message || "Failed to save evaluations", "err");
    } finally {
      setSaving(false);
    }
  };

  const ratingInput = (idx: number, field: "required_level" | "self_rated" | "reviewer_rated", value: string) => (
    <input
      type="number"
      min={1}
      max={5}
      className={`${inputCls} !w-20`}
      value={value}
      disabled={!canEval}
      onChange={(e) => setCell(idx, field, e.target.value)}
      aria-label={field.replace(/_/g, " ")}
    />
  );

  return (
    <div className={cardCls}>
      <div className="flex flex-wrap items-center justify-between gap-3 fx-hairline-b px-4 py-3">
        <h2 className="text-base font-bold text-primary">Skill Evaluation</h2>
        {canEval && (
          <div className="flex items-center gap-2">
            <select className={`${inputCls} !w-52`} value={addSkillId} onChange={(e) => setAddSkillId(e.target.value)}>
              <option value="">Add skill…</option>
              {availableSkills.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button className={btnSecondary} onClick={addRow} disabled={!addSkillId}>
              <Plus size={15} /> Add row
            </button>
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm lg:min-w-0">
          <thead className="sticky top-0 z-10 bg-surface-1">
            <tr className="border-b border-subtle text-left">
              {["Skill", "Required level", "Self rated", "Reviewer rated", ""].map((h) => (
                <th key={h} className={thCls}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5}><EmptyState message="No skill evaluations yet" /></td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.skill_id} className="border-b border-subtle">
                  <td className={`${tdCls} font-semibold text-primary`}>{r.skill_name}</td>
                  <td className={tdCls}>{ratingInput(i, "required_level", r.required_level)}</td>
                  <td className={tdCls}>{ratingInput(i, "self_rated", r.self_rated)}</td>
                  <td className={tdCls}>{ratingInput(i, "reviewer_rated", r.reviewer_rated)}</td>
                  <td className={tdCls}>
                    {r.isNew && canEval && (
                      <button
                        className="rounded-control p-1 text-muted transition-colors duration-micro ease-smooth hover:bg-danger-soft hover:text-danger"
                        onClick={() => removeNewRow(i)}
                        aria-label={`Remove ${r.skill_name}`}
                      >
                        <X size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {(error || canEval) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-subtle px-4 py-3">
          <div className="text-xs text-danger">{error}</div>
          {canEval && (
            <button className={btnPrimary} onClick={save} disabled={saving || rows.length === 0}>
              <Save size={15} /> {saving ? "Saving…" : "Save evaluations"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Offers tab ---------- */

function OffersTab({
  detail,
  onReload,
  showToast,
}: {
  detail: ProfileDetail;
  onReload: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const canOffer = useHasRole("Sales", "Sales_Head", "HR");
  const [showCreate, setShowCreate] = useState(false);
  const [busyOfferId, setBusyOfferId] = useState<number | null>(null);

  const offers = detail.offers || [];

  const updateStatus = async (offer: Offer, status: string) => {
    if (!status || status === offer.status) return;
    setBusyOfferId(offer.id);
    try {
      await crmPut(`/api/candidate-profiles/${detail.id}/offer/${offer.id}`, { status });
      showToast(`Offer #${offer.id} marked ${status}`);
      onReload();
    } catch (e: any) {
      showToast(e?.message || "Failed to update offer", "err");
    } finally {
      setBusyOfferId(null);
    }
  };

  return (
    <div className={cardCls}>
      <div className="flex flex-wrap items-center justify-between gap-2 fx-hairline-b px-4 py-3">
        <h2 className="text-base font-bold text-primary">Offer History</h2>
        {canOffer && (
          <button className={btnPrimary} onClick={() => setShowCreate(true)}>
            <Plus size={15} /> New Offer
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm lg:min-w-0">
          <thead className="sticky top-0 z-10 bg-surface-1">
            <tr className="border-b border-subtle text-left">
              <th className={thCls}>Offer date</th>
              <th className={`${thCls} text-right`}>CTC</th>
              <th className={thCls}>Joining</th>
              <th className={thCls}>Expiry</th>
              <th className={thCls}>Status</th>
              <th className={thCls}>Offer letter</th>
              {canOffer && <th className={thCls}>Update status</th>}
            </tr>
          </thead>
          <tbody>
            {offers.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    message="No offers yet"
                    action={canOffer ? (
                      <button type="button" className={btnPrimary} onClick={() => setShowCreate(true)}>
                        <Plus size={15} /> New Offer
                      </button>
                    ) : undefined}
                  />
                </td>
              </tr>
            ) : (
              offers.map((o) => (
                <tr key={o.id} className="border-b border-subtle">
                  <td className={tdCls}>{fmtDate(o.offer_date)}</td>
                  <td className={`${tdCls} text-right font-semibold tabular-nums text-primary`}>{fmtLac(o.ctc)}</td>
                  <td className={tdCls}>{fmtDate(o.joining_date)}</td>
                  <td className={tdCls}>{fmtDate(o.expiry_date)}</td>
                  <td className={tdCls}><StatusBadge status={o.status} /></td>
                  <td className={tdCls}><FileLink url={o.offer_letter_url} label="Offer letter" /></td>
                  {canOffer && (
                    <td className={tdCls}>
                      <select
                        className={`${inputCls} !w-32`}
                        value={o.status}
                        disabled={busyOfferId === o.id}
                        onChange={(e) => updateStatus(o, e.target.value)}
                        aria-label={`Update status of offer ${o.id}`}
                      >
                        {OFFER_STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {showCreate && (
        <NewOfferModal
          profileId={detail.id}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            showToast("Offer created");
            onReload();
          }}
        />
      )}
    </div>
  );
}

function NewOfferModal({
  profileId,
  onClose,
  onCreated,
}: {
  profileId: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [offerDate, setOfferDate] = useState("");
  const [ctc, setCtc] = useState("");
  const [joiningDate, setJoiningDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!offerDate || numOrNull(ctc) === null) {
      setError("Offer date and CTC are required");
      return;
    }
    setBusy(true);
    try {
      await crmPost(`/api/candidate-profiles/${profileId}/offer`, {
        offer_date: offerDate,
        ctc: numOrNull(ctc),
        joining_date: joiningDate || null,
        expiry_date: expiryDate || null,
      });
      onCreated();
    } catch (e: any) {
      setError(e?.message || "Failed to create offer");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={<span className="sr-only">New Offer</span>}
      onClose={onClose}
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title="New Offer"
        subtitle="Record the offered CTC and key dates for this candidate."
        icon={<FileText size={20} aria-hidden />}
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <WizardField label="Offer date" required icon="calendar" filled={!!offerDate}>
              <input type="date" className={inputCls} value={offerDate} onChange={(e) => setOfferDate(e.target.value)} />
            </WizardField>
            <WizardField label="CTC" required icon="hash" filled={ctc !== ""}>
              <input type="number" min={0} className={inputCls} value={ctc} onChange={(e) => setCtc(e.target.value)} />
            </WizardField>
            <WizardField label="Joining date" icon="calendar" filled={!!joiningDate}>
              <input type="date" className={inputCls} value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} />
            </WizardField>
            <WizardField label="Expiry date" icon="calendar" filled={!!expiryDate}>
              <input type="date" className={inputCls} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </WizardField>
          </div>
          {error && <ErrorBox error={error} />}
          <div className={wizFooterRow}>
            <button className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
            <button className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`} onClick={submit} disabled={busy}>
              {busy ? "Creating…" : "Create Offer"}
            </button>
          </div>
        </div>
      </WizFormShell>
    </Modal>
  );
}

/* ---------- Interviews tab ---------- */

/** Human interview rounds for this application — L1/L2/L3, HR and customer rounds,
 * whether scheduled in the app or imported from Zoho. Read-only history: rounds are
 * created by the RMG "L2 — Face-to-face" action or by the importer. */

const ROUND_LABEL: Record<string, string> = {
  L1_Interview: "L1 — Interview",
  L2_F2F: "L2 — Interview",
  L3_Interview: "L3 — Interview",
  L4_Interview: "L4 — Interview",
  HR_Interview: "HR round",
  Customer_Interview: "Customer interview",
  Other: "Interview",
};

const roundLabel = (kind: string) => ROUND_LABEL[kind] || kind;

const fmtDateTime = (v?: string | null) =>
  v ? new Date(v).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;

/** Zoho "Result" is free text — colour only the clear pass/fail wording. */
function resultTone(result?: string | null): string {
  const r = (result || "").toLowerCase();
  if (/no hire|reject|fail|not selected|drop/.test(r)) return "text-danger";
  if (/hire|select|pass|shortlist|clear/.test(r)) return "text-success";
  return "";
}

const squash = (s?: string | null) => (s || "").replace(/\s+/g, " ").trim();

/** Zoho people fields are lists of {id, text}. Rows imported before that was
 * handled stored the raw repr — "[{'id': '270…', 'text': 'Mohit Arya'}]".
 * Pull the names out so the card never shows a Python literal. */
function personName(value?: string | null): string | null {
  const raw = squash(value);
  if (!raw) return null;
  if (!raw.startsWith("[") && !raw.startsWith("{")) return raw;
  const names = [...raw.matchAll(/'text'\s*:\s*'([^']*)'|"text"\s*:\s*"([^"]*)"/g)]
    .map((m) => (m[1] ?? m[2] ?? "").trim())
    .filter(Boolean);
  return names.length ? [...new Set(names)].join(", ") : raw;
}

/** Rows imported by the older importer packed the whole round into `note`
 * ("Round: … / Stage: … / <feedback>"). Rendering that alongside the structured
 * fields shows the feedback twice, so suppress a note that only repeats them.
 * scripts/dedupe_interview_events.py clears these at the source; this is the guard
 * for any row that has not been through it yet. */
function noteWorthShowing(e: InterviewEventRow): string | null {
  const note = squash(e.note);
  if (!note) return null;
  if (/^(round|stage|mode|status|result)\s*:/i.test(note)) return null;
  const feedback = squash(e.feedback);
  if (feedback && note.includes(feedback)) return null;
  return e.note;
}

function InterviewsTab({
  profileId,
  events,
  onReload,
  showToast,
}: {
  profileId: number;
  events: InterviewEventRow[];
  onReload: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  /**
   * Rounds are owned per kind, not per tab.
   *
   * RMG owns the technical ladder (L1–L4); Sales owns the customer's own
   * round. Neither should be able to write the other's — Sales recording an L2
   * result would be inventing an engineering opinion, and RMG recording
   * customer feedback would be inventing the client's.
   *
   * This mirrors ROUND_WRITE_ROLES in services/interview_rounds.py. The server
   * is the authority and rejects anything wrong with a 403; this only decides
   * what to render, so a user is never shown a control that would fail.
   */
  const canWriteTechnical = useHasRole("RMG");
  const canWriteCustomer = useHasRole("Sales", "Sales_Head");
  const canEditRound = (kind?: string | null) =>
    kind === "Customer_Interview" ? canWriteCustomer : canWriteTechnical;
  const canEdit = canWriteTechnical || canWriteCustomer;

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<InterviewEventRow | null>(null);
  const [removing, setRemoving] = useState<InterviewEventRow | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await crmDelete(`/api/candidate-profiles/${profileId}/interview-rounds/${removing.id}`);
      setRemoving(null);
      showToast("Interview round removed");
      onReload();
    } catch (e: any) {
      showToast(e?.message || "Failed to remove the round", "err");
    } finally {
      setBusy(false);
    }
  };

  const header = canEdit && (
    <div className="flex justify-end">
      <button className={btnPrimary} onClick={() => setAdding(true)}>
        <Plus size={15} />
        {/* Sales only ever adds the customer round, so name the thing they are
            actually adding rather than the generic "interview feedback". */}
        {canWriteTechnical ? "Add interview feedback" : "Add customer feedback"}
      </button>
    </div>
  );

  const modals = (
    <>
      {(adding || editing) && (
        <InterviewRoundModal
          profileId={profileId}
          existing={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            onReload();
          }}
          showToast={showToast}
        />
      )}
      {removing && (
        <ConfirmModal
          title="Remove this interview round?"
          message={`${roundLabel(removing.kind)}${
            removing.scheduled_at ? ` on ${fmtDateTime(removing.scheduled_at)}` : ""
          } will be deleted, including its feedback. This cannot be undone.`}
          confirmLabel="Remove round"
          danger
          busy={busy}
          onConfirm={remove}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );

  if (!events.length) {
    return (
      <div className="space-y-3">
        {header}
        <div className={`${cardCls} p-6`}>
          <EmptyState
            message="No interview rounds recorded for this application yet."
            icon={<GitBranch size={28} />}
            action={
              canEdit ? (
                <button type="button" className={btnPrimary} onClick={() => setAdding(true)}>
                  <Plus size={15} />
                  {canWriteTechnical ? "Add interview feedback" : "Add customer feedback"}
                </button>
              ) : undefined
            }
          />
        </div>
        {modals}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {header}
      {events.map((e) => {
        const when = fmtDateTime(e.scheduled_at) || e.raw_when;
        const note = noteWorthShowing(e);
        const interviewer = personName(e.interviewer);
        return (
          <div key={e.id} className={`${cardCls} p-5`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{roundLabel(e.kind)}</span>
                  {e.interview_category && (
                    <span className="rounded-full border border-subtle px-2 py-0.5 text-xs text-muted">
                      {e.interview_category}
                    </span>
                  )}
                  {e.stage && (
                    <span className="rounded-full border border-subtle px-2 py-0.5 text-xs text-muted">
                      {e.stage}
                    </span>
                  )}
                  {e.mode && <span className="text-xs text-muted">· {e.mode}</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                  <span>{when || "Date not recorded"}</span>
                  {e.duration_minutes ? <span>· {e.duration_minutes} min</span> : null}
                  {e.user_role && <span>· by {e.user_role}</span>}
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="text-right">
                  {e.result && (
                    <div className={`text-sm font-semibold ${resultTone(e.result)}`}>{e.result}</div>
                  )}
                  {e.status && <div className="text-xs text-muted">{e.status}</div>}
                </div>
                {/* Per-round, not per-tab: Sales sees these controls on the
                    customer round only, RMG on the technical ones only. */}
                {canEditRound(e.kind) && (
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-control p-1 text-secondary hover:bg-surface-2"
                      onClick={() => setEditing(e)}
                      title="Edit this round"
                      aria-label="Edit interview round"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="rounded-control p-1 text-danger hover:bg-surface-2"
                      onClick={() => setRemoving(e)}
                      title="Remove this round"
                      aria-label="Remove interview round"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {(interviewer || e.meeting_link) && (
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                {interviewer && <span className="text-muted">Interviewer: {interviewer}</span>}
                {e.meeting_link && (
                  <a
                    href={e.meeting_link}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 hover:underline"
                  >
                    <ExternalLink size={14} /> Meeting link
                  </a>
                )}
              </div>
            )}

            {e.feedback && (
              <div className="mt-3 rounded-lg bg-surface-2 p-3 text-sm whitespace-pre-wrap">
                {e.feedback}
              </div>
            )}
            {note && <div className="mt-2 text-sm text-muted whitespace-pre-wrap">{note}</div>}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Add / edit an interview round ---------- */

function InterviewRoundModal({
  profileId,
  existing,
  onClose,
  onSaved,
  showToast,
}: {
  profileId: number;
  existing: InterviewEventRow | null;
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const isEdit = !!existing;
  const [opts, setOpts] = useState<InterviewRoundOptions | null>(null);
  const [optsError, setOptsError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Defaulting to L1 is wrong for Sales, who may only write the customer
  // round — the form would open on a value their save would reject. The real
  // default is set once the server tells us what this role may write.
  const [kind, setKind] = useState(existing?.kind || "");
  const [category, setCategory] = useState(existing?.interview_category || "Internal");
  const [employeeId, setEmployeeId] = useState<string>(
    existing?.employee_id ? String(existing.employee_id) : "",
  );
  const [interviewer, setInterviewer] = useState(existing?.interviewer || "");
  const [duration, setDuration] = useState<string>(
    existing?.duration_minutes ? String(existing.duration_minutes) : "30",
  );
  const [status, setStatus] = useState(existing?.status || "Completed");
  const [when, setWhen] = useState(toInputValue(existing?.scheduled_at));
  const [result, setResult] = useState(existing?.result || "");
  const [feedback, setFeedback] = useState(existing?.feedback || "");
  const [userRole, setUserRole] = useState(existing?.user_role || "RMG");

  useEffect(() => {
    crmGet<InterviewRoundOptions>(`/api/candidate-profiles/${profileId}/interview-rounds/options`)
      .then((r) => {
        setOpts(r.data);
        // Preselect the first round this role may actually save: L1 for RMG,
        // Customer Interview for Sales. Only when adding — never override the
        // kind of a round being edited.
        setKind((current) => current || r.data?.writable_rounds?.[0] || "");
      })
      .catch((e: any) => setOptsError(e?.message || "Failed to load form options"));
  }, [profileId]);

  const submit = async () => {
    if (!kind) return setError("Interview Round is required");
    if (!employeeId && !interviewer.trim()) {
      return setError("Pick an employee, or type a name for an external panellist");
    }
    setError("");
    setBusy(true);
    const body = {
      kind,
      interview_category: category || null,
      employee_id: employeeId ? Number(employeeId) : null,
      // Only send free text when no employee is chosen — the server derives the
      // name from the employee record otherwise.
      interviewer: employeeId ? undefined : interviewer.trim() || null,
      duration_minutes: duration ? Number(duration) : null,
      status: status || null,
      scheduled_at: when ? new Date(when).toISOString() : null,
      result: result || null,
      feedback: feedback.trim() || null,
      user_role: userRole || null,
    };
    try {
      if (isEdit) {
        await crmPut(`/api/candidate-profiles/${profileId}/interview-rounds/${existing!.id}`, body);
        showToast("Interview feedback updated");
      } else {
        await crmPost(`/api/candidate-profiles/${profileId}/interview-rounds`, body);
        showToast("Interview feedback saved");
      }
      onSaved();
    } catch (e: any) {
      setError(e?.message || "Failed to save the interview feedback");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isEdit ? "Edit interview feedback" : "Add interview feedback"} onClose={onClose} medium>
      <WizFormShell
        title={isEdit ? "Edit interview feedback" : "Add interview feedback"}
        subtitle="Record the round, the panel and the outcome. Everything here shows on the candidate's Interviews tab."
        icon={<GitBranch size={18} />}
      >
        {optsError && <ErrorBox error={optsError} />}
        {error && <ErrorBox error={error} />}
        {!opts && !optsError ? (
          <Spinner label="Loading form…" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <WizardField label="Interview Category" required>
                <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
                  {(opts?.categories || []).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </WizardField>

              <WizardField label="Interview Round" required>
                <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>
                  {/* A handful of imported rounds have a kind outside L1–L4 (e.g. "Other").
                      Surface it so editing one does not silently change the round type. */}
                  {kind && !(opts?.rounds || []).some((r) => r.value === kind) && (
                    <option value={kind}>{roundLabel(kind)}</option>
                  )}
                  {/* Only rounds this role owns are selectable. The server sends
                      `writable` per round — offering a choice the save would
                      reject with a 403 is a trap, not a form. */}
                  {(opts?.rounds || [])
                    .filter((r) => r.writable !== false || r.value === kind)
                    .map((r) => (
                      <option key={r.value} value={r.value} disabled={r.writable === false}>
                        {r.label}
                      </option>
                    ))}
                </select>
              </WizardField>

              <WizardField label="Employee" info="The panel member who took the round.">
                <select
                  className={inputCls}
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                >
                  <option value="">— External / not listed —</option>
                  {(opts?.employees || []).map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name}
                      {emp.employee_code ? ` (${emp.employee_code})` : ""}
                    </option>
                  ))}
                </select>
              </WizardField>

              <WizardField
                label="Interviewer name"
                info="Only needed for an external panellist with no employee record."
              >
                <input
                  className={inputCls}
                  value={employeeId ? "" : interviewer}
                  onChange={(e) => setInterviewer(e.target.value)}
                  disabled={!!employeeId}
                  placeholder={employeeId ? "Taken from the employee record" : "External panellist"}
                />
              </WizardField>

              <WizardField label="Interview Duration">
                <select className={inputCls} value={duration} onChange={(e) => setDuration(e.target.value)}>
                  <option value="">—</option>
                  {(opts?.durations || []).map((d) => (
                    <option key={d} value={d}>{d} minutes</option>
                  ))}
                </select>
              </WizardField>

              <WizardField label="Interview Status">
                <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">—</option>
                  {(opts?.statuses || []).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </WizardField>

              <WizardField label="Interview Date/Time From">
                <input
                  type="datetime-local"
                  className={inputCls}
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                />
              </WizardField>

              <WizardField label="Result">
                <select className={inputCls} value={result} onChange={(e) => setResult(e.target.value)}>
                  <option value="">—</option>
                  {(opts?.results || []).map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </WizardField>

              <WizardField label="User Role" info="Which team conducted this round.">
                <select className={inputCls} value={userRole} onChange={(e) => setUserRole(e.target.value)}>
                  <option value="">—</option>
                  {(opts?.user_roles || []).map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </WizardField>

              <WizardField label="Overall Feedback" className="sm:col-span-2">
                <textarea
                  rows={6}
                  className={inputCls}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Technical depth, communication, strengths, gaps, and your recommendation…"
                />
              </WizardField>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} onClick={submit} disabled={busy}>
                {busy ? "Saving…" : isEdit ? "Save changes" : "Save feedback"}
              </button>
            </div>
          </>
        )}
      </WizFormShell>
    </Modal>
  );
}

/* ---------- Activity Log tab ---------- */

function ActivityTab({ profileId }: { profileId: number }) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState("");

  const load = () => {
    setError("");
    crmGet<ActivityEntry[]>(`/api/candidate-profiles/${profileId}/activity-log`)
      .then((r) => setEntries(r.data || []))
      .catch((e: any) => setError(e?.message || "Failed to load activity log"));
  };
  useEffect(load, [profileId]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (entries === null) return <Spinner label="Loading activity…" />;
  return (
    <div className={`${cardCls} p-6`}>
      <Timeline entries={entries} />
    </div>
  );
}

/* ---------- AI Interview tab (Phase 5) ---------- */

const fmtScore = (v?: number | null) =>
  v === null || v === undefined ? "—" : `${Number(v).toFixed(1).replace(/\.0$/, "")}%`;

/** Tailwind classes per override decision. Selected reads positive, Rejected
 *  negative, On Hold / Pending Review neutral-but-attention. */
const HR_DECISION_TONE: Record<string, string> = {
  selected:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/50 dark:bg-emerald-950/40 dark:text-emerald-200",
  rejected:
    "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700/50 dark:bg-rose-950/40 dark:text-rose-200",
  on_hold:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200",
  pending_review:
    "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700/50 dark:bg-sky-950/40 dark:text-sky-200",
};

/**
 * The AI's verdict and the recruiter's decision, side by side.
 *
 * These are two different judgements and the profile needs both. The AI scores
 * against a fixed pass threshold; a recruiter who reads the transcript may
 * disagree and press Shortlist. Showing only the override would erase the
 * evidence — a candidate selected at 57.2% should still visibly be a 57.2%
 * candidate. So the override leads (it is what people act on) and the AI verdict
 * is kept beside it, de-emphasised, with who overrode it and when.
 */
function AiResultBadges({ link }: { link: AiInterviewLink }) {
  const decision = (link.hr_decision || "").toLowerCase();
  const label = link.hr_decision_label;

  if (!decision || !label) return <StatusBadge status={link.result} />;

  const tone = HR_DECISION_TONE[decision] ?? HR_DECISION_TONE.pending_review;
  const who = link.hr_decision_by ? ` by ${link.hr_decision_by}` : "";
  const when = link.hr_decision_at ? ` on ${fmtDate(link.hr_decision_at)}` : "";

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}
        title={`Marked ${label}${who}${when}`}
      >
        <UserCheck size={12} aria-hidden />
        {label}
      </span>
      {link.is_overridden && (
        <span
          className="text-[11px] font-medium text-muted"
          title={`The AI scored this interview ${fmtScore(link.overall_score_percent)} and recorded "${link.result}". A recruiter overrode that${who}${when}.`}
        >
          (AI: {link.result} {fmtScore(link.overall_score_percent)})
        </span>
      )}
    </span>
  );
}

function AiInterviewTab({
  profileId,
  candidate,
  links,
  error,
  onReload,
  showToast,
}: {
  profileId: number;
  candidate: ProfileDetail["candidate"];
  links: AiInterviewLink[] | null;
  error: string;
  onReload: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  // AI L1 is TA's step — matches TRIGGER_ROLES on the server, which RMG and
  // Sales are no longer part of.
  const canTrigger = useHasRole("TA");
  const [showSchedule, setShowSchedule] = useState(false);
  const [editing, setEditing] = useState<AiInterviewLink | null>(null);
  const [cancelling, setCancelling] = useState<AiInterviewLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [scheduled, setScheduled] = useState<AiScheduleResult | null>(null);

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} copied to clipboard`);
    } catch {
      showToast("Copy failed — please copy manually", "err");
    }
  };

  const cancelSession = async () => {
    if (!cancelling) return;
    setBusy(true);
    try {
      await crmDelete(`/api/candidate-profiles/${profileId}/ai-interviews/${cancelling.id}`);
      setCancelling(null);
      setScheduled(null);
      showToast("AI interview cancelled");
      onReload();
    } catch (e: any) {
      showToast(e?.message || "Failed to cancel the interview", "err");
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorBox error={error} onRetry={onReload} />;
  if (links === null) return <Spinner label="Loading AI interviews…" />;

  const completed = links.filter((l) => !l.pending);
  const latest = completed.length
    ? [...completed].sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""))[0]
    : null;

  return (
    <div className="space-y-4">
      {scheduled && (
        <div className="rounded-card border border-subtle bg-success-soft p-4 shadow-raised">
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm font-bold text-success">
              AI interview ready — copy the invite to share with the candidate
            </div>
            <button
              className="rounded-control p-1 text-success transition-colors duration-micro ease-smooth hover:bg-surface-2"
              onClick={() => setScheduled(null)}
              aria-label="Dismiss"
            >
              <X size={15} />
            </button>
          </div>
          <div className="mt-3 space-y-2 text-sm">
            {scheduled.invite_url && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-success">
                  Invite link
                </span>
                <span className="max-w-md truncate rounded-control border border-subtle bg-surface-1 px-2.5 py-1 font-mono text-xs text-secondary">
                  {scheduled.invite_url}
                </span>
                <button className={btnSecondary} onClick={() => copyText(scheduled.invite_url!, "Invite link")}>
                  <Copy size={14} /> Copy
                </button>
              </div>
            )}
            {scheduled.access_key && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-success">
                  Access key
                </span>
                <span className="rounded-control border border-subtle bg-surface-1 px-2.5 py-1 font-mono text-sm font-bold tracking-wider text-primary">
                  {scheduled.access_key}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {latest && (
        /* AI-generated result — animated gradient-border AI surface */
        <div className="glass fx-gradient-border-animated rounded-card p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden />
            Latest completed AI interview
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <span className="font-display text-2xl font-bold tabular-nums text-primary">
              {fmtScore(latest.overall_score_percent)}
            </span>
            <AiResultBadges link={latest} />
            <span className="text-sm text-muted">
              Completed {fmtDate(latest.completed_at)}
            </span>
            {latest.report_link && (
              <a
                href={latest.report_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
              >
                Full report <ExternalLink size={13} />
              </a>
            )}
          </div>
        </div>
      )}

      <div className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-3 fx-hairline-b px-4 py-3">
          <h2 className="flex items-center gap-2 text-base font-bold text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden />
            <Bot size={18} className="text-brand-600 dark:text-brand-300" /> AI Interview Sessions
          </h2>
          {canTrigger && (
            <button className={btnPrimary} onClick={() => setShowSchedule(true)}>
              <Plus size={15} /> Trigger AI Interview
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm lg:min-w-0">
            <thead className="sticky top-0 z-10 bg-surface-1">
              <tr className="border-b border-subtle text-left">
                <th className={thCls}>Created</th>
                <th className={thCls}>Scheduled for</th>
                <th className={thCls}>Level</th>
                <th className={thCls}>Result</th>
                <th className={`${thCls} text-right`}>Score</th>
                <th className={thCls}>Completed</th>
                <th className={thCls}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {links.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      message="No AI interview sessions yet"
                      action={canTrigger ? (
                        <button type="button" className={btnPrimary} onClick={() => setShowSchedule(true)}>
                          <Plus size={15} /> Trigger AI Interview
                        </button>
                      ) : undefined}
                    />
                  </td>
                </tr>
              ) : (
                links.map((l) => (
                  <tr key={l.id} className="border-b border-subtle">
                    <td className={tdCls}>{fmtDate(l.created_at)}</td>
                    <td className={tdCls}>
                      {l.scheduled_at_local || "—"}
                      {l.access_key && (
                        <div className="font-mono text-xs text-muted">Key {l.access_key}</div>
                      )}
                    </td>
                    <td className={`${tdCls} font-semibold text-primary`}>{l.level || "—"}</td>
                    <td className={tdCls}>
                      <div className="flex items-center gap-2">
                        <AiResultBadges link={l} />
                        {l.pending && (
                          /* AI session awaiting the candidate — 3-dot AI pulse */
                          <AiThinking label="In progress" />
                        )}
                      </div>
                    </td>
                    <td className={`${tdCls} text-right font-semibold tabular-nums text-primary`}>
                      {fmtScore(l.overall_score_percent)}
                    </td>
                    <td className={tdCls}>{fmtDate(l.completed_at)}</td>
                    <td className={tdCls}>
                      <div className="flex items-center gap-3">
                        {l.report_link && (
                          <a
                            href={l.report_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline dark:text-brand-300"
                          >
                            Full report <ExternalLink size={13} />
                          </a>
                        )}
                        {l.pending && (
                          <button
                            className="inline-flex items-center gap-1 font-semibold text-secondary hover:underline"
                            onClick={() =>
                              copyText(l.invite_url || `${window.location.origin}/?invite=${l.invite_token}`, "Invite link")
                            }
                          >
                            <Copy size={13} /> Copy invite link
                          </button>
                        )}
                        {canTrigger && l.can_modify !== false && l.pending && (
                          <>
                            <button
                              className="inline-flex items-center gap-1 font-semibold text-secondary hover:underline"
                              onClick={() => setEditing(l)}
                              title="Change the date/time or re-send the invite"
                            >
                              <Pencil size={13} /> Edit
                            </button>
                            <button
                              className="inline-flex items-center gap-1 font-semibold text-danger hover:underline"
                              onClick={() => setCancelling(l)}
                              title="Cancel this interview — the invite link stops working"
                            >
                              <Trash2 size={13} /> Delete
                            </button>
                          </>
                        )}
                        {l.pending && l.started && (
                          <span className="text-xs text-muted">Candidate already started</span>
                        )}
                        {!l.report_link && !l.pending && <span className="text-muted">—</span>}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showSchedule && (
        <ScheduleAiInterviewModal
          profileId={profileId}
          candidate={candidate}
          onClose={() => setShowSchedule(false)}
          onDone={(res) => {
            setShowSchedule(false);
            setScheduled(res);
            onReload();
          }}
          showToast={showToast}
        />
      )}

      {editing && (
        <ScheduleAiInterviewModal
          profileId={profileId}
          candidate={candidate}
          existing={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            onReload();
          }}
          showToast={showToast}
        />
      )}

      {cancelling && (
        <ConfirmModal
          title="Cancel this AI interview?"
          message={
            `The session scheduled for ${cancelling.scheduled_at_local || "now"} will be removed and ` +
            `its invite link will stop working. This cannot be undone — you can schedule a new one afterwards.`
          }
          confirmLabel="Cancel interview"
          danger
          busy={busy}
          onConfirm={cancelSession}
          onClose={() => setCancelling(null)}
        />
      )}
    </div>
  );
}

/* ---------- Schedule / reschedule an AI interview ---------- */
/* The modal and its date helpers now live in
   crm/components/ScheduleAiInterviewModal so the Calendar page can reuse
   them without importing this whole page. */

