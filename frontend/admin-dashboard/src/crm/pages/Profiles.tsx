/** Candidate Profiles (candidate x opportunity): pipeline list + detail with
 * Overview / Skill Evaluation / Offers / Activity Log / AI Interview (Phase 5 integration).
 * Status transitions render ONLY detail.allowed_next_statuses (computed server-side per role);
 * every transition requires a comment (min 5 chars).
 * Calm-premium recipe (DESIGN-DECISIONS.md): token-only colors, raised cards,
 * zebra-free 48px table rows, right-aligned numerics, one primary action per screen. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRight, ArrowRightLeft, Bot, Copy, Download, ExternalLink, FileText, GitBranch, Pencil, Plus, Save, Send, Trash2, UserCheck, UsersRound, X } from "lucide-react";
import { authFetch } from "../../api/client";
import { OfferLetterEditor } from "../components/OfferLetterEditor";
import { DuplicateProfileNotice, duplicateProfileFromError } from "../components/DuplicateProfileNotice";
import type { DuplicateProfile } from "../components/DuplicateProfileNotice";
import { BudgetFlagModal, BudgetReplyModal, SubmitForApprovalModal } from "../components/OfferApprovalGate";
import { CrmApiError, crmDelete, crmGet, crmPost, crmPut, qs } from "../api";
import { fetchAllMaster } from "../lib/fetchAllMaster";
import type { Meta } from "../api";
import { displayEmail, realEmail } from "../lib/candidateEmail";
import { useHasRole, useMe } from "../CrmApp";
import { InterviewerSelect } from "../components/InterviewerSelect";
import { SearchableSelect } from "../components/SearchableSelect";
/** Sentinel option in the Employee picker: no Karnex employee on the panel. */
const EXTERNAL_PANELLIST = "__external__";
/** Fallback HR verdicts when the options call has not resolved — mirrors interview_rounds.HR_RESULTS. */
const HR_VERDICTS = ["Hire", "Not Recommend", "Drop"];
import { useCanAct, useCrmAccess } from "../useAccess";
import { CrmLink, crmNavigate, useCrmParams } from "../routerHooks";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { RowActions, afterListDelete } from "../components/RowActions";
import { FileLink, FileUploadButton } from "../components/FileUpload";
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
  btnDanger, btnPrimary, btnSecondary, inputCls, statusLabel, useToast, selfWithdrewLabel } from "../components/ui";
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
  /** The day they join Karnex — distinct from the customer's date (0088). */
  karnex_onboarding_date?: string | null;
  /** HR-verified at onboarding (0089); null = not yet recorded / not asked. */
  total_experience_years?: number | null;
  relocation_applicable?: boolean | null;
  /** The Karnex work mailbox HR issues before Joined (0090). */
  official_email?: string | null;
  /** HR's placement for the Employees record (0091). */
  department_id?: number | null;
  designation_id?: number | null;
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
  /** RMG screening gate (25 Aug 2026). NULL = legacy profile, not gated. */
  rmg_screening_status?: "Pending" | "Shortlisted" | "Rejected" | null;
  rmg_screening_note?: string | null;
  rmg_screening_at?: string | null;
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
  /** The HR round's two-way verdict (3 Sep 2026). */
  hr_results?: string[];
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
    city?: string | null;
    preferred_locations?: string | null;
    resignation_certificate_url?: string | null;
  } | null;
  opportunity: {
    id: number; opp_id?: string | null; title?: string | null; customer_name?: string | null;
    /** Work Location from the opportunity form ("Chennai, Bangalore"). */
    location?: string | null;
  } | null;
  skill_evaluations: SkillEvaluation[];
  offers: Offer[];
  interview_events: InterviewEventRow[];
  allowed_next_statuses: string[];
  /* Human-round state, same shape as the Applied Candidates row. The manual
     L1 is the round RMG runs instead of the AI screen (1 Sep 2026). */
  l1_manual_requested?: boolean;
  l1_manual_scheduled?: boolean;
  l1_manual_event_id?: number | null;
  l1_manual_result?: string | null;
  l2_requested?: boolean;
  l2_scheduled?: boolean;
  l2_event_id?: number | null;
  l2_result?: string | null;
  /* The HR round at HR Screening, and the customer's rounds (2 Sep 2026). */
  hr_requested?: boolean;
  hr_scheduled?: boolean;
  hr_event_id?: number | null;
  hr_result?: string | null;
  cust_l1_scheduled?: boolean;
  cust_l1_result?: string | null;
  cust_l2_scheduled?: boolean;
  cust_l2_result?: string | null;
  /* The Pre-Onboarding budget hold (3 Sep 2026): null · "Concern" (HR's verdict
     was Not Recommend) · "Out_of_Budget" (HR flagged it to Sales) · "Resolved"
     (Sales replied, HR decides). */
  budget_status?: "Concern" | "Out_of_Budget" | "Resolved" | null;
  budget_note?: string | null;
  budget_flagged_at?: string | null;
  budget_resolution_note?: string | null;
  budget_resolved_at?: string | null;
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
  "HR_Screening", "HR_Interviewing", "Preboarding", "Joined",
];
const REJECTED_STATUSES = [
  "Sales_Rejected", "RMG_Rejected", "Customer_Rejected",
  // Round-specific customer rejections (Aug 2026) — must be listed here or the
  // status modal demands a note without rendering the note box.
  "Customer_Screen_Rejected", "Customer_L1_Rejected", "Customer_L2_Rejected",
  "Self_Withdrawn", "Rejected",
];
const REJECTION_LIKE = new Set(REJECTED_STATUSES);

const OFFER_STATUSES = ["Pending", "Accepted", "Expired", "Rejected"];

/** CTC is stored in rupees; recruiters read and quote it in lakhs. 2200000 -> "22.00". */
const LAKH = 100000;
/** Rupees → "12.50" lakh, grouped Indian-style ("1,23,45,678.00"), so a
 *  figure that has gone wrong by a factor of a lakh reads as the absurdity it
 *  is instead of a wall of digits (user report, 2 Sep 2026). */
const fmtLac = (v?: number | null) =>
  v === null || v === undefined
    ? "—"
    : (Number(v) / LAKH).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

/** Server-searched picker for the New Profile form (7 Sep 2026 fix). The old
 *  form loaded the first 100 candidates / opportunities once and filtered
 *  that page client-side, so anyone past record 100 "did not exist". This
 *  asks the server per keystroke (debounced), same as ApplyToOpportunityModal. */
function RemotePicker({
  url, placeholder, value, onChange, toOption, ariaLabel,
}: {
  url: string;
  placeholder: string;
  value: { id: number; label: string } | null;
  onChange: (v: { id: number; label: string } | null) => void;
  toOption: (row: any) => { id: number; label: string; sub?: string };
  ariaLabel: string;
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rows, setRows] = useState<{ id: number; label: string; sub?: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadErr("");
    crmGet<any[]>(`${url}${url.includes("?") ? "&" : "?"}page=1&limit=25${debounced ? `&search=${encodeURIComponent(debounced)}` : ""}`)
      .then((r) => { if (alive) setRows((r.data || []).map(toOption)); })
      .catch((e: any) => { if (alive) setLoadErr(e?.message || "Search failed"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, debounced]);
  if (value) {
    return (
      <div className={`${inputCls} flex items-center justify-between gap-2`}>
        <span className="truncate font-medium text-primary">{value.label}</span>
        <button type="button" className="text-xs font-semibold text-sky-600 hover:underline" onClick={() => onChange(null)}>Change</button>
      </div>
    );
  }
  return (
    <div>
      <input className={`${inputCls} mb-1.5`} placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label={ariaLabel} />
      <div className="max-h-44 overflow-y-auto rounded-control border border-subtle" role="listbox" aria-label={ariaLabel}>
        {loadErr ? (
          <p className="px-3 py-2 text-xs text-danger">{loadErr}</p>
        ) : loading && rows.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted">Searching…</p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted">No matches{debounced ? ` for “${debounced}”` : ""}.</p>
        ) : rows.map((r) => (
          <button key={r.id} type="button" role="option" aria-selected={false}
            className="flex w-full flex-col items-start border-b border-subtle px-3 py-2 text-left last:border-b-0 hover:bg-surface-2"
            onClick={() => onChange({ id: r.id, label: r.label })}>
            <span className="text-sm font-semibold text-primary">{r.label}</span>
            {r.sub && <span className="text-xs text-muted">{r.sub}</span>}
          </button>
        ))}
        {rows.length >= 25 && <p className="px-3 py-1.5 text-[11px] text-muted">Showing the first 25 — type more to narrow.</p>}
      </div>
    </div>
  );
}

function NewProfileModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [candidate, setCandidate] = useState<{ id: number; label: string } | null>(null);
  const [opportunity, setOpportunity] = useState<{ id: number; label: string } | null>(null);
  const [currentCtc, setCurrentCtc] = useState("");
  const [expectedCtc, setExpectedCtc] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dup, setDup] = useState<DuplicateProfile | null>(null);
  const candidateId = candidate ? String(candidate.id) : "";
  const opportunityId = opportunity ? String(opportunity.id) : "";

  const hike = hikePreview(currentCtc, expectedCtc);

  const submit = async () => {
    setError("");
    if (!candidateId || !opportunityId) {
      setError("Candidate and opportunity are required");
      return;
    }
    setBusy(true);
    setDup(null);
    try {
      const res = await crmPost<ProfileRow>("/api/candidate-profiles", {
        candidate_id: Number(candidateId),
        opportunity_id: Number(opportunityId),
        current_ctc: lacToRupees(currentCtc),
        expected_ctc: lacToRupees(expectedCtc),
        // Recorded on the profile's Activity Log (7 Sep 2026).
        notes: notes.trim() || undefined,
      });
      onCreated(res.data.id);
    } catch (e: any) {
      const d = duplicateProfileFromError(e);
      if (d) {
        setDup(d);
      } else if (e instanceof CrmApiError && e.status === 409) {
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
            <RemotePicker
              url="/api/candidates"
              placeholder="Search candidates by name, email or phone…"
              value={candidate}
              onChange={(v) => { setCandidate(v); setDup(null); setError(""); }}
              ariaLabel="Candidates"
              toOption={(c) => ({
                id: c.id,
                label: c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || `Candidate #${c.id}`,
                sub: [realEmail(c.email), c.technical_domain, c.experience_years != null ? `${c.experience_years} yrs` : null].filter(Boolean).join(" · ") || undefined,
              })}
            />
          </div>
          <WizardField label="Opportunity" required icon="building">
            <RemotePicker
              url="/api/opportunities?approval_status=Approved"
              placeholder="Search opportunities by title, ID or customer…"
              value={opportunity}
              onChange={(v) => { setOpportunity(v); setDup(null); setError(""); }}
              ariaLabel="Opportunities"
              toOption={(o) => ({
                id: o.id,
                label: `${o.opp_id ? `${o.opp_id} — ` : ""}${o.title || `Opportunity #${o.id}`}`,
                sub: [o.customer_name, String(o.pipeline_stage || "").replace(/_/g, " ")].filter(Boolean).join(" · ") || undefined,
              })}
            />
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
          {dup && <DuplicateProfileNotice dup={dup} />}
          <div className={wizFooterRow}>
            <button className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
            <button className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`} onClick={submit} disabled={busy || !!dup}>
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

/** RMG screening gate banner (25 Aug 2026): a freshly applied candidate waits
 * here until RMG clears them for the AI L1. RMG gets the decision buttons;
 * everyone else sees why the AI-L1 actions are locked. */
function RmgScreeningBanner({
  profile, isRmg, onDone, showToast,
}: {
  profile: ProfileDetail;
  isRmg: boolean;
  onDone: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const [modal, setModal] = useState<"shortlist" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [noteErr, setNoteErr] = useState("");
  const [busy, setBusy] = useState(false);

  const decide = async () => {
    if (modal === "reject" && note.trim().length < 5) {
      setNoteErr("A rejection note of at least 5 characters is required");
      return;
    }
    setBusy(true);
    try {
      const res = await crmPost(`/api/candidate-profiles/${profile.id}/rmg-screening`, {
        decision: modal === "shortlist" ? "Shortlisted" : "Rejected",
        note: note.trim() || undefined,
      });
      showToast(res.message || "Screening decision recorded");
      setModal(null);
      onDone();
    } catch (e: any) {
      showToast(e?.message || "Decision failed", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-card border border-amber-300/60 bg-amber-50/70 px-5 py-3 dark:border-amber-800/50 dark:bg-amber-950/25">
      <div className="text-sm text-amber-800 dark:text-amber-300">
        <b>Awaiting RMG screening</b>
        {profile.ta_owner_name ? <> — applied by {profile.ta_owner_name}</> : null}.
        {isRmg
          ? " Review the candidate's details and decide: Shortlist to enable the AI L1 interview, or Reject with a note."
          : " AI L1 actions (slot invite / schedule) unlock once RMG shortlists this candidate."}
      </div>
      {isRmg && (
        <div className="flex gap-2">
          <button className={btnPrimary} onClick={() => { setModal("shortlist"); setNote(""); setNoteErr(""); }}>
            Shortlist for AI L1
          </button>
          <button className={btnDanger} onClick={() => { setModal("reject"); setNote(""); setNoteErr(""); }}>
            Reject
          </button>
        </div>
      )}
      {modal && (
        <Modal
          title={modal === "shortlist" ? "Shortlist for AI L1" : "Reject at RMG screening"}
          onClose={() => { if (!busy) setModal(null); }}
        >
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              {modal === "shortlist"
                ? "The TA who applied this candidate will be notified to proceed: contact the candidate, agree an AI L1 slot, and send the invitation link."
                : "The TA will be notified with your note. The AI L1 interview stays locked for this candidate."}
            </p>
            <Field label={modal === "shortlist" ? "Note (optional)" : "Reason"} required={modal === "reject"} error={noteErr}>
              <textarea
                className={`${inputCls}${noteErr ? " input-error" : ""}`}
                rows={3}
                value={note}
                onChange={(e) => { setNote(e.target.value); setNoteErr(""); }}
                placeholder={modal === "reject" ? "Why is this candidate not suitable? (min 5 characters)" : "Anything the TA should know"}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button className={btnSecondary} onClick={() => setModal(null)} disabled={busy}>Cancel</button>
              <button className={modal === "shortlist" ? btnPrimary : btnDanger} onClick={() => void decide()} disabled={busy}>
                {busy ? "Working…" : modal === "shortlist" ? "Shortlist & notify TA" : "Reject & notify TA"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** RMG hand-off card: shown while a profile sits in RMG_Review. Surfaces the
 * passed AI L1 result and guides the decision — request an L2 AI round, or
 * submit the candidate to the Sales team (or reject). */
/** RMG's door past the AI round: the interview is optional, so this offers a
 *  clean, logged way to run the HUMAN ladder instead — manual L1, then L2 —
 *  rather than leaving the candidate parked waiting on a machine. */
function SkipAiL1Banner({ profileId, onDone, showToast }: {
  profileId: number;
  onDone: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await crmPost(`/api/candidate-profiles/${profileId}/skip-ai-l1`, {
        note: note.trim() || undefined,
        request_manual_l1: true,
      });
      showToast(res.message || "Manual route chosen — TA notified to schedule the L1");
      setOpen(false);
      onDone();
    } catch (e: any) {
      showToast(e?.message || "Could not switch to the manual route", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mb-6 rounded-card border border-subtle bg-surface-2/50 px-5 py-3 shadow-raised">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-primary">AI L1 not done yet</div>
            <p className="mt-0.5 text-sm text-secondary">
              Waiting on the AI interview — or skip it and interview this candidate yourself:
              a human L1, then the L2, then submit them to Sales for the customer rounds.
            </p>
          </div>
          <button className={btnSecondary} onClick={() => setOpen(true)} disabled={busy}>
            <UsersRound size={15} /> Go manual — skip AI L1
          </button>
        </div>
      </div>
      {open && (
        <Modal title="Skip the AI interview — go manual?" onClose={() => !busy && setOpen(false)}>
          <p className="text-sm text-secondary">
            The candidate moves to <b>RMG Review</b> and the TA who applied them is asked to
            arrange a human <b>L1</b> round. After the L1 feedback you can request the L2, then
            submit the candidate to Sales for the customer interviews.
          </p>
          <label className="mt-4 block text-xs font-semibold text-muted">Reason (optional)</label>
          <textarea
            rows={3}
            className={inputCls}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Known candidate — assessing directly in the L2 round"
          />
          <div className="mt-5 flex justify-end gap-2">
            <button className={btnSecondary} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            <button className={btnPrimary} onClick={() => void submit()} disabled={busy}>
              {busy ? "Switching…" : "Go manual & notify TA"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}


function RmgDecisionBanner({
  profileId, aiLinks, skillEvaluations, rounds, noticePeriod, onViewReport, onDone, showToast,
}: {
  profileId: number;
  aiLinks: AiInterviewLink[] | null;
  /** The candidate's notice period on record, if any — drives the default
   *  of the "ask TA to collect it" tick on Submit to Sales. */
  noticePeriod?: string | null;
  /** Manual L1 / L2 state — decides which round is the next legal move. */
  rounds: {
    l1_manual_requested?: boolean; l1_manual_scheduled?: boolean;
    l1_manual_event_id?: number | null; l1_manual_result?: string | null;
    l2_requested?: boolean; l2_scheduled?: boolean; l2_result?: string | null;
  };
  /** For the un-scored warning on Submit to Sales (nothing blocks — RMG may
   *  deliberately forward without ratings — but it must be a choice, not an
   *  oversight the Sales team discovers). */
  skillEvaluations?: { reviewer_rated?: number | null }[];
  onViewReport: () => void;
  onDone: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const [busy, setBusy] = useState<"l2" | "sales" | "reject" | "f2f" | null>(null);
  const [f2fOpen, setF2fOpen] = useState(false);
  /* Which round the scheduling modal is booking. The manual L1 and the L2 are
     the same form with a different label (1 Sep 2026). */
  const [f2fRound, setF2fRound] = useState<"L1" | "L2">("L2");
  /* On the manual route the ladder is L1 → feedback → L2: offering the L2
     while the L1 is unjudged would skip a step the team actually runs. */
  const onManualRoute = !!(rounds.l1_manual_requested || rounds.l1_manual_scheduled);
  const l1Pending = onManualRoute && !rounds.l1_manual_result;
  /* Sales only sees candidates the ladder has JUDGED (1 Sep 2026, user
     report). The L2 is OPTIONAL on every route (8 Sep 2026, user decision):
     once the L1 is recorded RMG may run an L2 or submit straight to Sales —
     but an L2 that was asked for or booked must be recorded first. */
  const l2Started = !!(rounds.l2_requested || rounds.l2_scheduled);
  const l2Open = l2Started && !rounds.l2_result;
  const salesBlocked = (onManualRoute && !rounds.l1_manual_result) || l2Open;
  const salesBlockReason = onManualRoute && !rounds.l1_manual_result
    ? "Record the manual L1 outcome first"
    : "Record the L2 outcome first";
  const me = useMe();
  /* The RMG taking the call — prefilled with whoever is scheduling, since
     that is the answer nine times out of ten (user request, 28 Aug 2026).
     Editable: another RMG may be running the round. */
  const [f2fInterviewer, setF2fInterviewer] = useState(me?.full_name || me?.username || "");
  const [f2fWhen, setF2fWhen] = useState("");
  const [f2fLink, setF2fLink] = useState("");
  const [f2fNote, setF2fNote] = useState("");
  const [f2fErrs, setF2fErrs] = useState<{ when?: string; link?: string; who?: string }>({});
  /* Decision modal (was window.prompt — a native prompt can't show a
   * field-level error and some browsers let users suppress it entirely,
   * which made Submit/Reject silently dead). */
  const [decision, setDecision] = useState<"sales" | "reject" | null>(null);
  const [decisionComment, setDecisionComment] = useState("");
  const [decisionErr, setDecisionErr] = useState("");
  /* "Ask TA to collect the notice period" (2 Sep 2026, user request) —
     ticked by default when nothing is on record, since that is exactly when
     Sales would otherwise reach the customer with "unknown". */
  const [askNotice, setAskNotice] = useState(!noticePeriod);
  const completed = (aiLinks || []).filter((l) => !l.pending && l.overall_score_percent != null);
  const latest = completed.length
    ? completed.reduce((a, b) => ((a.completed_at || "") > (b.completed_at || "") ? a : b))
    : null;
  const unrated = (skillEvaluations || []).filter((s) => s.reviewer_rated == null).length;

  const openDecision = (kind: "sales" | "reject") => {
    setDecision(kind);
    setDecisionErr("");
    setDecisionComment(kind === "sales"
      ? "L1 & L2 Done - RMG Review Completed, Forwarding to Sales Team"
      : "");
  };

  const submitDecision = async () => {
    if (decision == null) return;
    const isSales = decision === "sales";
    if (decisionComment.trim().length < 5) {
      setDecisionErr(isSales
        ? "A comment of at least 5 characters is required"
        : "A rejection reason of at least 5 characters is required");
      return;
    }
    setBusy(decision);
    try {
      const res = await crmPost(`/api/candidate-profiles/${profileId}/status-transition`, {
        new_status: isSales ? "Sales_Screening" : "RMG_Rejected",
        comment: decisionComment.trim(),
        ask_notice_period: isSales && askNotice,
      });
      showToast(res.message || (isSales ? "Submitted to Sales team" : "Candidate rejected"));
      setDecision(null);
      onDone();
    } catch (e: any) {
      showToast(e?.message || "Transition failed", "err");
    } finally {
      setBusy(null);
    }
  };

  const scheduleF2f = async () => {
    /* Empty fields used to POST {null,null,null}: the server accepted it,
     * logged an "L2 scheduled" event with no date, and emailed the candidate
     * an invite with no time and no link. Both fields are required now. */
    const errs: { when?: string; link?: string; who?: string } = {};
    if (!f2fWhen.trim()) errs.when = "Pick the date and time of the call";
    if (!f2fLink.trim()) errs.link = "Paste the meeting link the candidate should join";
    else if (!/^https?:\/\/\S+$/i.test(f2fLink.trim())) errs.link = "Enter a full link starting with https://";
    if (f2fRound === "L1" && !f2fInterviewer.trim()) errs.who = "Pick the employee taking this interview";
    setF2fErrs(errs);
    if (errs.when || errs.link || errs.who) return;
    setBusy("f2f");
    try {
      const res = await crmPost<any>(`/api/candidate-profiles/${profileId}/l2-face-to-face`, {
        scheduled_at: f2fWhen.trim(),
        meeting_link: f2fLink.trim(),
        note: f2fNote.trim() || null,
        interviewer: f2fInterviewer.trim() || null,
        round: f2fRound,
      });
      showToast(res.message || `${f2fRound} face-to-face recorded — TA notified`);
      setF2fOpen(false);
      onDone();
    } catch (e: any) {
      showToast(e?.message || `Failed to record the ${f2fRound} round`, "err");
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
            {onManualRoute
              ? (rounds.l1_manual_result
                  ? <>Manual route — L1 result <span className="font-semibold">{rounds.l1_manual_result}</span>. Next: schedule the L2 round, or submit this candidate to the Sales team.</>
                  : rounds.l1_manual_scheduled
                    ? <>Manual route — the L1 round is booked. Record its feedback on the Interviews tab once the call is done; the L2 follows it.</>
                    : <>Manual route — no AI interview. TA is arranging the human L1 round; schedule it here if you are running it yourself.</>)
              : latest
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
          {onManualRoute && !rounds.l1_manual_scheduled && (
            <button
              className={btnSecondary}
              onClick={() => { setF2fRound("L1"); setF2fOpen(true); }}
              disabled={busy != null}
              title="Book the human L1 round yourself instead of waiting for TA to schedule it"
            >
              <UsersRound size={15} /> Schedule L1
            </button>
          )}
          <button
            className={btnSecondary}
            onClick={() => { setF2fRound("L2"); setF2fOpen(true); }}
            disabled={busy != null || l1Pending}
            title={l1Pending
              ? "Record the manual L1 outcome first — the L2 follows it"
              : "Book the L2 face-to-face round"}
          >
            <UsersRound size={15} /> Schedule L2
          </button>
          <button
            className={btnPrimary}
            onClick={() => openDecision("sales")}
            disabled={busy != null || salesBlocked}
            title={salesBlocked
              ? `${salesBlockReason} — Sales only sees candidates the interview ladder has cleared`
              : "RMG review complete — submit this candidate to the Sales team"}
          >
            <ArrowRightLeft size={15} /> {busy === "sales" ? "Submitting…" : "Submit to Sales team"}
          </button>
          <button
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-rose-300/60 bg-rose-50 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-300"
            onClick={() => openDecision("reject")}
            disabled={busy != null}
          >
            <X size={15} /> {busy === "reject" ? "Rejecting…" : "Reject"}
          </button>
        </div>
      </div>
      {f2fOpen && (
        <Modal title={f2fRound === "L1" ? "Schedule manual L1 round" : "Schedule L2 face-to-face round"}
          onClose={() => { if (busy !== "f2f") setF2fOpen(false); }}>
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              Candidate and RMG join a live call (e.g. Microsoft Teams). This logs the round, notifies TA
              to coordinate, and emails the candidate the details when an email is on file. The profile
              stays in RMG Review — decide after the call.
            </p>
            <Field label="Interviewer name" required={f2fRound === "L1"} error={f2fErrs.who}>
              <InterviewerSelect
                value={f2fInterviewer}
                onChange={(v) => { setF2fInterviewer(v); setF2fErrs((p) => ({ ...p, who: undefined })); }}
                err={f2fErrs.who}
                placeholder={f2fRound === "L1"
                  ? "Search the employee taking this interview…"
                  : "Search the RMG taking this call…"}
              />
              <p className="mt-1 text-[11px] text-muted">
                {f2fRound === "L1"
                  ? "The internal employee running the round — they are named on the candidate's invite."
                  : "Defaults to you; change it if another RMG is running the round."}
              </p>
            </Field>
            <Field label="Date & time" required error={f2fErrs.when}>
              <input
                type="datetime-local"
                className={`${inputCls}${f2fErrs.when ? " input-error" : ""}`}
                value={f2fWhen}
                onChange={(e) => { setF2fWhen(e.target.value); setF2fErrs((p) => ({ ...p, when: undefined })); }}
              />
            </Field>
            <Field label="Meeting link (Teams / Meet)" required error={f2fErrs.link}>
              <input
                className={`${inputCls}${f2fErrs.link ? " input-error" : ""}`}
                placeholder="https://teams.microsoft.com/…"
                value={f2fLink}
                onChange={(e) => { setF2fLink(e.target.value); setF2fErrs((p) => ({ ...p, link: undefined })); }}
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
      {decision && (
        <Modal
          title={decision === "sales" ? "Submit to Sales team" : "Reject candidate"}
          onClose={() => { if (busy == null) setDecision(null); }}
          dirty={decisionComment.trim().length > 0 && decision === "reject"}
        >
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              {decision === "sales"
                ? "Move this candidate from RMG Review to Sales Screening. The comment goes on the activity log."
                : "Reject this candidate at the RMG stage. The reason goes on the activity log and cannot be blank."}
            </p>
            {decision === "sales" && unrated > 0 && (
              <p className="rounded-control border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
                {unrated} skill{unrated === 1 ? " has" : "s have"} no reviewer rating on the Skill
                Evaluation tab — the Sales team will see an unscored candidate. You can still submit,
                but consider rating them first.
              </p>
            )}
            {decision === "sales" && (
              <label className="flex cursor-pointer items-start gap-2 rounded-control border border-subtle bg-surface-2/60 px-3 py-2 text-sm text-secondary">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600"
                  checked={askNotice} onChange={(e) => setAskNotice(e.target.checked)} />
                <span>
                  <b className="text-primary">Ask TA to collect the notice period</b>
                  <span className="block text-xs text-muted">
                    {noticePeriod
                      ? `On record: ${noticePeriod}. Tick to have TA re-confirm it with the candidate.`
                      : "Nothing is on record — TA is notified to confirm it with the candidate now, before Sales reaches the customer."}
                  </span>
                </span>
              </label>
            )}
            <Field
              label={decision === "sales" ? "Comment for the activity log" : "Rejection reason"}
              required
              error={decisionErr}
            >
              <textarea
                className={`${inputCls}${decisionErr ? " input-error" : ""}`}
                rows={3}
                value={decisionComment}
                onChange={(e) => { setDecisionComment(e.target.value); setDecisionErr(""); }}
                placeholder={decision === "sales"
                  ? "Why is this candidate being submitted to Sales?"
                  : "Why is this candidate being rejected? (min 5 characters)"}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button className={btnSecondary} onClick={() => setDecision(null)} disabled={busy != null}>
                Cancel
              </button>
              <button
                className={decision === "sales" ? btnPrimary : btnDanger}
                onClick={() => void submitDecision()}
                disabled={busy != null}
              >
                {busy != null ? "Working…" : decision === "sales" ? "Submit to Sales team" : "Reject candidate"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Detail tabs: key → label, in render order. Single source of truth for both
 *  the <Tabs> bar and the `?tab=` deep-link allow-list — a tab added to only one
 *  of those would silently deep-link to Overview with no error anywhere. */
const PROFILE_TAB_LABELS: Record<string, string> = {
  overview: "Overview",
  interviews: "Interviews",
  skills: "Skill Evaluation",
  offers: "Offers",
  activity: "Activity Log",
  ai: "AI Interview",
};
const PROFILE_TABS = Object.keys(PROFILE_TAB_LABELS);

/** The tab a `?tab=` deep link asks for, or "overview". Unknown values are
 *  ignored rather than rendering an empty page. */
function initialProfileTab(): string {
  try {
    const t = new URLSearchParams(window.location.search).get("tab") || "";
    return PROFILE_TABS.includes(t) ? t : "overview";
  } catch {
    return "overview";
  }
}

export function ProfileDetailPage() {
  const { id } = useCrmParams();
  const [toast, showToast] = useToast();
  const [detail, setDetail] = useState<ProfileDetail | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState(initialProfileTab);
  const isRmg = useHasRole("RMG");
  const isSalesHead = useHasRole("Sales_Head");
  // Sales submits the terms; Sales Head may too (they own the account when
  // no Sales person is on it). Admin/CEO pass through useHasRole.
  const isSales = useHasRole("Sales", "Sales_Head");
  const isHrUser = useHasRole("HR");
  const isTaUser = useHasRole("TA");
  const [submitApprovalOpen, setSubmitApprovalOpen] = useState(false);
  const [hrRoundOpen, setHrRoundOpen] = useState(false);
  const [hrFeedbackOpen, setHrFeedbackOpen] = useState(false);
  /* The HR tail (3 Sep 2026): HR asks TA for the round; at Pre-Onboarding HR
     may flag the budget to Sales, and Sales replies. */
  const [hrRequestBusy, setHrRequestBusy] = useState(false);
  const [budgetFlagOpen, setBudgetFlagOpen] = useState(false);
  const [budgetReplyOpen, setBudgetReplyOpen] = useState(false);
  const requestHrRound = async () => {
    if (!detail) return;
    setHrRequestBusy(true);
    try {
      const res = await crmPost(`/api/candidate-profiles/${detail.id}/l2-request`, { round: "HR" });
      showToast(res.message || "TA notified to schedule the HR round");
      load();
    } catch (e: any) {
      showToast(e?.message || "Could not request the HR round", "err");
    } finally {
      setHrRequestBusy(false);
    }
  };
  /* The HR round card to record feedback ON — the latest HR_Interview row. */
  const hrRoundEvent = useMemo(() => {
    const rows = (detail?.interview_events || []).filter((e) => e.kind === "HR_Interview");
    return rows.length ? rows[rows.length - 1] : null;
  }, [detail?.interview_events]);
  /* The Commercials form's unsaved figures (rupees), mirrored in the header
     cards. null = nothing being edited / just saved. */
  const [draft, setDraft] = useState<CommercialsDraft | null>(null);
  /* Sub-tab access (25 Aug 2026): a template can hide detail tabs. */
  const profileAcc = useCrmAccess("profiles");
  useEffect(() => {
    if (!profileAcc.subTabVisible(`tab:${tab}`)) {
      const first = PROFILE_TABS.find((k) => profileAcc.subTabVisible(`tab:${k}`));
      if (first) setTab(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  /* Keep ?tab= in step with the visible tab so the URL is copy-pasteable and a
   * reload stays put. replaceState, not pushState: clicking through five tabs
   * should not cost five presses of Back to leave the profile. */
  const selectTab = (key: string) => {
    setTab(key);
    try {
      const params = new URLSearchParams(window.location.search);
      if (key === "overview") params.delete("tab");
      else params.set("tab", key);
      const qs = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    } catch { /* URL sync is a convenience; never block the tab switch */ }
  };

  /* A deep link that arrives while this page is already mounted (the
   * notification bell navigates in-place) changes only the query string, so
   * re-read it on every popstate — including crmNavigate's synthetic one. */
  useEffect(() => {
    const onPop = () => setTab(initialProfileTab());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

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
      rate_unit: (newest as any).rate_unit ?? null,
      rate_value: (newest as any).rate_value ?? null,
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
      /* Say WHICH profile and WHY. A bare "Failed to load profile" is
       * indistinguishable between a deleted record (the common case when
       * arriving from an old notification), a permission problem and a 500 —
       * and the reader has no way to tell us which one they hit.
       * The status is appended only for real HTTP errors: crm/api.ts also
       * throws on a 200 carrying success:false, and "HTTP 200" reads as
       * nonsense next to an error message. */
      .catch((e: any) => setError(
        e?.status === 404
          ? `Candidate profile #${id} no longer exists. It was probably deleted after the notification that linked here was sent.`
          : `${e?.message || "Failed to load profile"} (profile #${id}${e?.status >= 400 ? `, HTTP ${e.status}` : ""})`,
      ));
  };
  /* Drop the old record first: without this, navigating 42 → 99 in place (the
   * notification bell does exactly that) keeps rendering profile 42's header,
   * banners and tabs until the new fetch resolves. */
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load is stable per id
  useEffect(() => { setDetail(null); load(); }, [id]);

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
                onOpen={() => selectTab("interviews")}
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
            <StatusBadge status={detail.pipeline_status} label={selfWithdrewLabel(detail.pipeline_status, (detail as any).withdrawn_from_status)} />
            {/* Positive-only since 2 Sep 2026: the checkbox that set this was
                removed from the Commercials panel, so a permanent "not
                approved" chip would nag about something nobody can act on
                here. Imported approvals still show. */}
            {detail.commercial_approved && (
              <span className="inline-flex items-center rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-semibold text-success ring-1 ring-inset ring-subtle">
                Commercial approved
              </span>
            )}
          </div>
        </div>
        {/* Hike % stays here — only the LIST column was replaced. The approved
            budget is added alongside so the two can be compared at a glance. */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {/* LIVE (2 Sep 2026, user request): while the Commercials form is
              being edited these mirror the draft, so HR sees the figures they
              are about to save — hike included — before pressing Save. Saved
              values return the moment the draft clears. */}
          <HeaderStat label="Current CTC (Lac)"
            value={fmtLac(draft?.current_ctc !== undefined ? draft.current_ctc : detail.current_ctc)} />
          <HeaderStat label="Expected CTC (Lac)"
            value={fmtLac(draft?.expected_ctc !== undefined ? draft.expected_ctc : detail.expected_ctc)} />
          <HeaderStat label="Hike %"
            value={draft ? (draft.hike != null ? `${draft.hike}%` : "—") : fmtHike(detail.hike_percent)} />
          <HeaderStat
            label={`Approved CTC Budget (Lac)${detail.ctc_slab_band ? ` · ${detail.ctc_slab_band} yrs` : ""}`}
            value={fmtLac(detail.approved_ctc_budget)}
          />
          <HeaderStat label="CTC Approval (Lac)"
            value={fmtLac(draft?.ctc_approval_amount !== undefined ? draft.ctc_approval_amount : detail.ctc_approval_amount)} />
        </div>
      </div>

      {/* RMG screening gate (25 Aug 2026): TA applied → RMG clears for AI L1. */}
      {detail.rmg_screening_status === "Pending" && (
        <RmgScreeningBanner
          profile={detail}
          isRmg={isRmg}
          onDone={load}
          showToast={showToast}
        />
      )}
      {detail.rmg_screening_status === "Rejected" && (
        <div className="mb-6 rounded-card border border-rose-300/60 bg-rose-50/70 px-5 py-3 text-sm text-rose-800 dark:border-rose-800/50 dark:bg-rose-950/25 dark:text-rose-300">
          <b>Rejected at RMG screening</b>
          {detail.rmg_screening_note ? <> — {detail.rmg_screening_note}</> : null}
          {detail.rmg_screening_at ? <> ({fmtDate(detail.rmg_screening_at)})</> : null}.
          The AI L1 interview cannot be scheduled for this candidate.
        </div>
      )}
      {detail.rmg_screening_status === "Shortlisted" && detail.pipeline_status === "Sourcing" && (
        <div className="mb-6 rounded-card border border-emerald-300/60 bg-emerald-50/70 px-5 py-3 text-sm text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/25 dark:text-emerald-300">
          <b>Shortlisted by RMG</b> — proceed with the candidate: agree an AI L1 slot and send the invitation link.
        </div>
      )}

      {/* AI L1 IS OPTIONAL (user decision, 28 Aug 2026): RMG can take a
          shortlisted candidate straight to review — no AI round — and then
          run the manual L2 / submit-to-Sales path from the banner below. */}
      {isRmg && detail.rmg_screening_status === "Shortlisted"
        && (detail.pipeline_status === "Sourcing" || detail.pipeline_status === "Technical_Screening") && (
        <SkipAiL1Banner
          profileId={detail.id}
          onDone={() => { load(); loadAi(); }}
          showToast={showToast}
        />
      )}

      {isRmg && detail.pipeline_status === "RMG_Review" && (
        <RmgDecisionBanner
          profileId={detail.id}
          aiLinks={aiLinks}
          skillEvaluations={detail.skill_evaluations || []}
          rounds={detail}
          noticePeriod={detail.notice_period}
          onViewReport={() => selectTab("ai")}
          onDone={() => { load(); loadAi(); }}
          showToast={showToast}
        />
      )}

      {/* Sales Head's one decision, at the one stage they own. Without this
          they had to find "Preboarding" in a generic dropdown, with nothing
          explaining that choosing it IS the approval. */}
      {/* Sales' half of the gate (2 Sep 2026): once the customer shortlists,
          Sales submits the rate + customer onboarding date. Named step, not a
          dropdown entry — the gate was being skipped because nothing offered it. */}
      {isSales && detail.pipeline_status === "Shortlisted" && (
        <div className="mb-4 rounded-card border border-emerald-300/60 bg-emerald-50/70 p-4 dark:border-emerald-800/50 dark:bg-emerald-950/25">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-bold text-emerald-800 dark:text-emerald-300">Customer shortlisted — submit the terms</div>
              <p className="mt-0.5 text-sm text-secondary">
                Enter the candidate&rsquo;s rate and the customer onboarding date. Sales Head approves them,
                and the candidate moves to Pre Onboarding.
                {detail.approved_ctc_budget != null && <> Approved budget: <b>{fmtLac(detail.approved_ctc_budget)} L</b>.</>}
              </p>
            </div>
            <button className={btnPrimary} onClick={() => setSubmitApprovalOpen(true)}>
              <Send size={15} /> Submit for Sales Head approval
            </button>
          </div>
        </div>
      )}
      {submitApprovalOpen && (
        <SubmitForApprovalModal
          profileId={detail.id}
          candidateName={detail.candidate?.full_name || `Candidate #${detail.candidate_id}`}
          expectedCtc={detail.expected_ctc}
          existing={latestOffer}
          onClose={() => setSubmitApprovalOpen(false)}
          onDone={(msg) => { setSubmitApprovalOpen(false); showToast(msg); load(); }}
        />
      )}

      {/* The HR tail (3 Sep 2026, user flow):
            HR Screening    — HR reviews the details and REQUESTS the round; TA books it.
            HR Interviewing — booked (auto); HR records Hire / Not Recommend → Pre-Onboarding (auto).
          TA sees the schedule button at both stages (a re-book is allowed). */}
      {(isHrUser || isTaUser)
        && (detail.pipeline_status === "HR_Screening" || detail.pipeline_status === "HR_Interviewing") && (
        <div className="mb-4 rounded-card border border-brand-300 bg-brand-50 p-4 dark:border-brand-500/40 dark:bg-brand-900/20">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-bold text-primary">
                {detail.pipeline_status === "HR_Screening" ? "HR Screening" : "HR Interviewing"}
              </div>
              <p className="mt-0.5 text-sm text-secondary">
                {detail.hr_result
                  ? <>HR round recorded: <b>{detail.hr_result}</b>.</>
                  : detail.hr_scheduled
                    ? <>The HR round is booked. HR records <b>Hire</b> or <b>Not Recommend</b> on it — either verdict moves the candidate to Pre Onboarding.</>
                    : detail.hr_requested
                      ? <>HR asked for the HR round — <b>TA</b> books it with the candidate; the stage moves to HR Interviewing once it is scheduled.</>
                      : isHrUser
                        ? <>Sales Head approved the terms. Review the candidate&rsquo;s details, then request the HR round from TA.</>
                        : <>Sales Head approved the terms. HR reviews the details and requests the round; you can also book it now.</>}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {isHrUser && !detail.hr_requested && !detail.hr_scheduled && (
                <button className={btnPrimary} disabled={hrRequestBusy} onClick={() => void requestHrRound()}>
                  <Send size={15} /> {hrRequestBusy ? "Requesting…" : "Request HR round from TA"}
                </button>
              )}
              {isTaUser && !detail.hr_result && (
                <button className={detail.hr_scheduled ? btnSecondary : btnPrimary} onClick={() => setHrRoundOpen(true)}>
                  <UsersRound size={15} /> {detail.hr_scheduled ? "Re-schedule HR round" : "Schedule HR round"}
                </button>
              )}
              {/* HR only — the verdict is HR's, TA merely books the round. Opens
                  the feedback form ON the HR round (2 Sep 2026, user report:
                  it used to just switch tabs). */}
              {isHrUser && detail.hr_scheduled && !detail.hr_result && hrRoundEvent && (
                <button className={btnPrimary} onClick={() => setHrFeedbackOpen(true)}>
                  <Plus size={15} /> Add HR feedback
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pre-Onboarding budget check (3 Sep 2026): HR re-checks the CTCs and
          the customer onboarding date. In budget → complete onboarding → Joined,
          no approval. Not in budget → flag it to Sales with the corrected
          figures; Sales replies; HR decides. */}
      {isHrUser && detail.pipeline_status === "Preboarding" && (
        <div className={`mb-4 rounded-card border p-4 ${
          detail.budget_status === "Out_of_Budget"
            ? "border-rose-300 bg-rose-50/70 dark:border-rose-800/60 dark:bg-rose-950/25"
            : detail.budget_status === "Concern"
              ? "border-amber-300 bg-amber-50/70 dark:border-amber-800/60 dark:bg-amber-950/25"
              : "border-brand-300 bg-brand-50 dark:border-brand-500/40 dark:bg-brand-900/20"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-bold text-primary">
                Pre Onboarding — budget check
                {detail.budget_status === "Out_of_Budget" && <span className="ml-2 rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white">Out of budget — waiting for Sales</span>}
                {detail.budget_status === "Concern" && <span className="ml-2 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">HR: Not Recommend</span>}
                {detail.budget_status === "Resolved" && <span className="ml-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">Sales replied — your decision</span>}
              </div>
              <p className="mt-0.5 text-sm text-secondary">
                {detail.budget_status === "Out_of_Budget" ? (
                  <>You flagged this to Sales{detail.budget_flagged_at ? ` on ${fmtDate(detail.budget_flagged_at)}` : ""}: <i>{detail.budget_note}</i>. Sales Head and the Sales person are discussing it with the customer and will reply here.</>
                ) : detail.budget_status === "Resolved" ? (
                  <>Sales replied{detail.budget_resolved_at ? ` on ${fmtDate(detail.budget_resolved_at)}` : ""}: <i>{detail.budget_resolution_note}</i>. If the terms now fit, complete the onboarding details below and mark <b>Joined</b> with Change Status; otherwise leave the candidate here or raise the flag again.</>
                ) : (
                  <>Re-check <b>Current CTC</b>, <b>Expected CTC</b> and the <b>Customer Onboarding Date</b> against the approved terms{latestOffer ? <> (approved: <b>{latestOffer.rate_value != null ? `₹${Number(latestOffer.rate_value).toLocaleString("en-IN")} ${(latestOffer.rate_unit || "yearly").toLowerCase()}` : `${fmtLac(latestOffer.ctc)} L`}</b>{latestOffer.joining_date ? `, onboarding ${fmtDate(latestOffer.joining_date)}` : ""})</> : null}.
                    In budget: fill the Workflow block (official email, Karnex onboarding date, department…) and mark <b>Joined</b> — no further approval.
                    Not in budget or the date does not fit: correct the figures and notify Sales.</>
                )}
              </p>
            </div>
            {detail.budget_status !== "Out_of_Budget" && (
              <button className={detail.budget_status === "Concern" ? btnPrimary : btnSecondary} onClick={() => setBudgetFlagOpen(true)}>
                <AlertTriangle size={15} /> Out of budget — notify Sales
              </button>
            )}
          </div>
        </div>
      )}
      {budgetFlagOpen && (
        <BudgetFlagModal
          profileId={detail.id}
          currentCtc={detail.current_ctc}
          expectedCtc={detail.expected_ctc}
          customerOnboardingDate={detail.customer_onboarding_date}
          presetNote={detail.budget_status === "Concern" ? (detail.budget_note || "") : ""}
          onClose={() => setBudgetFlagOpen(false)}
          onDone={(msg) => { setBudgetFlagOpen(false); showToast(msg); load(); }}
        />
      )}

      {/* Sales' side of the budget hold: HR's flag with the figures, and the
          reply (optionally with revised terms) that goes back to HR. */}
      {isSales && detail.budget_status === "Out_of_Budget" && (
        <div className="mb-4 rounded-card border border-rose-300 bg-rose-50/70 p-4 dark:border-rose-800/60 dark:bg-rose-950/25">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-bold text-rose-800 dark:text-rose-300">Out of budget — HR needs Sales</div>
              <p className="mt-0.5 text-sm text-secondary">
                HR checked the candidate at Pre Onboarding{detail.budget_flagged_at ? ` on ${fmtDate(detail.budget_flagged_at)}` : ""}: <i>{detail.budget_note}</i>
              </p>
              <p className="mt-1 text-sm text-secondary">
                Expected CTC now <b>{fmtLac(detail.expected_ctc)} L</b>
                {detail.customer_onboarding_date ? <>, customer onboarding <b>{fmtDate(detail.customer_onboarding_date)}</b></> : null}
                {latestOffer ? <>; approved terms <b>{latestOffer.rate_value != null ? `₹${Number(latestOffer.rate_value).toLocaleString("en-IN")} ${(latestOffer.rate_unit || "yearly").toLowerCase()}` : `${fmtLac(latestOffer.ctc)} L`}</b></> : null}.
                Discuss with the customer, then reply to HR — with the revised rate or date if the customer agreed to one.
              </p>
            </div>
            <button className={btnPrimary} onClick={() => setBudgetReplyOpen(true)}>
              <Send size={15} /> Reply to HR
            </button>
          </div>
        </div>
      )}
      {isSales && detail.budget_status === "Resolved" && detail.pipeline_status === "Preboarding" && (
        <div className="mb-4 rounded-card border border-emerald-300/60 bg-emerald-50/70 p-4 text-sm text-secondary dark:border-emerald-800/50 dark:bg-emerald-950/25">
          <b className="text-emerald-800 dark:text-emerald-300">Budget reply sent to HR</b>
          {detail.budget_resolved_at ? ` on ${fmtDate(detail.budget_resolved_at)}` : ""}: <i>{detail.budget_resolution_note}</i> — HR decides whether the candidate joins.
        </div>
      )}
      {budgetReplyOpen && (
        <BudgetReplyModal
          profileId={detail.id}
          offer={latestOffer}
          hrNote={detail.budget_note || ""}
          onClose={() => setBudgetReplyOpen(false)}
          onDone={(msg) => { setBudgetReplyOpen(false); showToast(msg); load(); }}
        />
      )}
      {hrRoundOpen && (
        <InterviewRoundModal
          profileId={detail.id}
          existing={null}
          initialKind="HR_Interview"
          initialMode="schedule"
          onClose={() => setHrRoundOpen(false)}
          onSaved={() => { setHrRoundOpen(false); showToast("HR round scheduled"); load(); }}
          showToast={showToast}
        />
      )}
      {hrFeedbackOpen && hrRoundEvent && (
        <InterviewRoundModal
          profileId={detail.id}
          existing={hrRoundEvent}
          initialMode="feedback"
          onClose={() => setHrFeedbackOpen(false)}
          onSaved={() => { setHrFeedbackOpen(false); showToast("HR feedback recorded"); load(); }}
          showToast={showToast}
        />
      )}

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
          tabs={PROFILE_TABS
            /* Sub-tab access (25 Aug 2026): templates hide tabs via the
             * `tab:<key>` field entries on the profiles tab. */
            .filter((key) => profileAcc.subTabVisible(`tab:${key}`))
            .map((key) => ({
              key,
              label: PROFILE_TAB_LABELS[key],
              count: key === "interviews" ? detail.interview_events?.length
                : key === "skills" ? detail.skill_evaluations?.length
                  : key === "offers" ? detail.offers?.length
                    : undefined,
            }))}
          active={tab}
          onChange={selectTab}
        />
      </div>

      {tab === "overview" && (
        <OverviewTab
          detail={detail}
          onReload={() => { setDraft(null); load(); }}
          onDraftChange={setDraft}
          showToast={showToast}
        />
      )}
      {tab === "interviews" && (
        <InterviewsTab
          profileId={detail.id}
          events={detail.interview_events || []}
          aiLinks={aiLinks}
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

/** Total Experience defaults to what TA entered on the candidate record
 *  (2 Sep 2026, user request) — HR confirms or corrects it rather than
 *  retyping it. The profile's own value wins once HR has saved one. */
/** Unsaved Commercials figures, in RUPEES, for the header cards. `hike` is
 *  the preview string ("20.00") or null when it cannot be computed. */
type CommercialsDraft = {
  current_ctc: number | null;
  expected_ctc: number | null;
  ctc_approval_amount: number | null;
  hike: string | null;
};

function expDefault(d: ProfileDetail): string {
  if (d.total_experience_years != null) return String(d.total_experience_years);
  if (d.experience_years != null) return String(d.experience_years);
  return "";
}

function OverviewTab({
  detail,
  onReload,
  onDraftChange,
  showToast,
}: {
  detail: ProfileDetail;
  onReload: () => void;
  /** Called with the unsaved figures on every keystroke (null when the form
   *  matches the saved record), so the header can mirror them live. */
  onDraftChange?: (draft: CommercialsDraft | null) => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  // Template-aware, per field: the template decides which of these inputs are
  // live for templated users; untemplated users keep the role default. This is
  // the "grey out what this role doesn't need" behaviour from the old system.
  const ownerRole = useHasRole("TA", "Sales", "RMG");
  /* HR's window (2 Sep 2026, user request): HR confirms the onboarding
     paperwork with the candidate at Pre Onboarding — the CTCs, references,
     dates, verified experience, relocation. Outside that stage the profile is
     another team's, so HR stays read-only; and the approval figure is Sales
     Head's at every stage. Mirrors enforce_hr_edit_window on the server. */
  const isHr = useHasRole("HR");
  const hrOnly = isHr && !ownerRole;
  const hrWindow = hrOnly
    && (detail.pipeline_status === "HR_Screening" || detail.pipeline_status === "HR_Interviewing"
        || detail.pipeline_status === "Preboarding");
  const roleOk = ownerRole || hrWindow;
  const acc = useCrmAccess("profiles");
  const canEdit = useCanAct("profiles", "edit", roleOk);
  const fld = (key: string) => canEdit && acc.canEditField(key);
  const canEditCtc = fld("current_ctc");
  const canEditExpected = fld("expected_ctc");
  const canEditApproval = fld("approved_ctc") && !hrOnly;
  /* The whole Workflow block rides ONE field grant, `workflow` (3 Sep 2026,
     user request): Admin/CEO decide per Access Template which logins see it
     (view) and which may fill it in (edit). Untemplated users keep the role
     behaviour — canViewField is true when no template restricts the tab. */
  const canViewWorkflow = acc.canViewField("workflow");
  const canEditOffers = fld("workflow");
  const canEditOnboarding = fld("workflow");
  const [currentCtc, setCurrentCtc] = useState(rupeesToLac(detail.current_ctc));
  const [expectedCtc, setExpectedCtc] = useState(rupeesToLac(detail.expected_ctc));
  const [approvalAmount, setApprovalAmount] = useState(rupeesToLac(detail.ctc_approval_amount));
  // Workflow references: issued outside this system, so they can only be typed.
  const [offerRef, setOfferRef] = useState(detail.offer_letter_reference ?? "");
  const [onboardingDate, setOnboardingDate] = useState(detail.customer_onboarding_date ?? "");
  const [karnexOnboardingDate, setKarnexOnboardingDate] =
    useState(detail.karnex_onboarding_date ?? "");
  const [totalExp, setTotalExp] = useState(expDefault(detail));
  const [officialEmail, setOfficialEmail] = useState(detail.official_email ?? "");
  const [preferredLocation, setPreferredLocation] = useState(detail.candidate?.preferred_locations ?? "");
  const [candidateCity, setCandidateCity] = useState(detail.candidate?.city ?? "");
  /* Department + Designation for the Employees record (2 Sep 2026, user
     report: the joined employee showed "—" for both, and nothing here asked).
     Designation defaults to the candidate's own; department is HR's call. */
  const [departmentId, setDepartmentId] = useState(detail.department_id != null ? String(detail.department_id) : "");
  const [designationId, setDesignationId] = useState(detail.designation_id != null ? String(detail.designation_id) : "");
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [designations, setDesignations] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    if (!canEditOnboarding) return;
    fetchAllMaster<{ id: number; name: string }>("/api/departments").then(setDepartments).catch(() => setDepartments([]));
    fetchAllMaster<{ id: number; name: string }>("/api/designations").then(setDesignations).catch(() => setDesignations([]));
  }, [canEditOnboarding]);
  // "" = not yet asked, "yes" / "no" = the answer — three states, so a bare
  // checkbox (which cannot say "unknown") would have been wrong here.
  const [relocation, setRelocation] = useState<"" | "yes" | "no">(
    detail.relocation_applicable == null ? "" : detail.relocation_applicable ? "yes" : "no");
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
    /* THE ×1,00,000 BUG (2 Sep 2026, user report). These inputs are in LAC
       and the server stores RUPEES. The initial state converted correctly,
       but this reload effect put the raw rupee figure into the Lac box — so
       every Save re-multiplied by 1,00,000 and a ₹10 L salary became
       ₹1,00,000 Cr after two saves ("100000000000" in the screenshot). */
    setCurrentCtc(rupeesToLac(detail.current_ctc));
    setExpectedCtc(rupeesToLac(detail.expected_ctc));
    setApprovalAmount(rupeesToLac(detail.ctc_approval_amount));
    setOfferRef(detail.offer_letter_reference ?? "");
    setOnboardingDate(detail.customer_onboarding_date ?? "");
    setKarnexOnboardingDate(detail.karnex_onboarding_date ?? "");
    setTotalExp(expDefault(detail));
    setOfficialEmail(detail.official_email ?? "");
    setPreferredLocation(detail.candidate?.preferred_locations ?? "");
    setCandidateCity(detail.candidate?.city ?? "");
    setDepartmentId(detail.department_id != null ? String(detail.department_id) : "");
    setDesignationId(detail.designation_id != null ? String(detail.designation_id) : "");
    setRelocation(detail.relocation_applicable == null ? "" : detail.relocation_applicable ? "yes" : "no");
  }, [detail]);

  const allowed = detail.allowed_next_statuses || [];
  const hike = hikePreview(currentCtc, expectedCtc);

  /* Mirror the unsaved figures into the header (2 Sep 2026, user request):
     HR should see what they are about to save, hike included, without a
     round trip. Reports null when nothing differs from the record, so the
     header shows saved values again the moment an edit is undone. */
  useEffect(() => {
    if (!onDraftChange) return;
    const cur = lacToRupees(currentCtc);
    const exp = lacToRupees(expectedCtc);
    const appr = lacToRupees(approvalAmount);
    const same = (a: number | null, b?: number | null) =>
      (a ?? null) === (b == null ? null : Math.round(Number(b)));
    if (same(cur, detail.current_ctc) && same(exp, detail.expected_ctc)
        && same(appr, detail.ctc_approval_amount)) {
      onDraftChange(null);
      return;
    }
    onDraftChange({ current_ctc: cur, expected_ctc: exp, ctc_approval_amount: appr, hike });
  }, [currentCtc, expectedCtc, approvalAmount, hike, detail.current_ctc, detail.expected_ctc,
      detail.ctc_approval_amount, onDraftChange]);

  const save = async () => {
    setSaving(true);
    try {
      // Only send fields this user may edit — the server rejects the whole
      // payload if it carries a view-only field, and rightly so.
      const body: Record<string, unknown> = {};
      if (canEditCtc) body.current_ctc = lacToRupees(currentCtc);
      if (canEditExpected) body.expected_ctc = lacToRupees(expectedCtc);
      if (canEditApproval) body.ctc_approval_amount = lacToRupees(approvalAmount);
      if (canEditOffers) {
        // Send null rather than "" so clearing a reference actually clears it.
        body.offer_letter_reference = offerRef.trim() || null;
      }
      if (canEditOnboarding) {
        body.customer_onboarding_date = onboardingDate || null;
        body.karnex_onboarding_date = karnexOnboardingDate || null;
        body.total_experience_years = totalExp.trim() === "" ? null : Number(totalExp);
        body.official_email = officialEmail.trim() || null;
        body.department_id = departmentId ? Number(departmentId) : null;
        body.designation_id = designationId ? Number(designationId) : null;
        body.relocation_applicable = relocation === "" ? null : relocation === "yes";
      }
      await crmPut(`/api/candidate-profiles/${detail.id}`, body);
      // Preferred location belongs to the CANDIDATE, so it goes to the
      // candidate record — only when it actually changed, so an untouched
      // form never issues a second write.
      const prefBefore = (detail.candidate?.preferred_locations ?? "").trim();
      const cityBefore = (detail.candidate?.city ?? "").trim();
      const candidatePatch: Record<string, string | null> = {};
      if (preferredLocation.trim() !== prefBefore) candidatePatch.preferred_locations = preferredLocation.trim() || null;
      if (candidateCity.trim() !== cityBefore) candidatePatch.city = candidateCity.trim() || null;
      if (canEditOnboarding && detail.candidate?.id && Object.keys(candidatePatch).length > 0) {
        await crmPut(`/api/candidates/${detail.candidate.id}`, candidatePatch);
      }
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
            type="number" min={0} step={0.01} placeholder="e.g. 22.00" className={inputCls} value={currentCtc} disabled={!canEditCtc}
            onChange={(e) => setCurrentCtc(e.target.value)}
          />
        </Field>
        <Field label="Expected CTC (Lac)">
          <input
            type="number" min={0} step={0.01} placeholder="e.g. 25.00" className={inputCls} value={expectedCtc} disabled={!canEditExpected}
            onChange={(e) => setExpectedCtc(e.target.value)}
          />
        </Field>
        <Field label="CTC Approval (Lac)">
          <input
            type="number" min={0} step={0.01} placeholder="e.g. 26.00" className={inputCls} value={approvalAmount} disabled={!canEditApproval}
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
      {canViewWorkflow && (
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

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Offer Letter Reference">
            <input
              className={inputCls} value={offerRef} disabled={!canEditOffers}
              placeholder="e.g. KRX/OL/2026/0142"
              onChange={(e) => setOfferRef(e.target.value)}
            />
          </Field>
          <Field label="Department">
            <select className={inputCls} value={departmentId} disabled={!canEditOnboarding}
              onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">Select…</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-muted">Goes onto the Employees record at Joined.</p>
          </Field>
          <Field label="Designation">
            <select className={inputCls} value={designationId} disabled={!canEditOnboarding}
              onChange={(e) => setDesignationId(e.target.value)}>
              <option value="">Select…</option>
              {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-muted">Prefilled from the candidate record when TA set one.</p>
          </Field>
          <Field label="Official Email" required={detail.pipeline_status === "Preboarding"}>
            <input
              type="email" className={inputCls} value={officialEmail} disabled={!canEditOnboarding}
              placeholder="name@karnex.in"
              onChange={(e) => setOfficialEmail(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted">
              The Karnex mailbox HR issues — needed before <b>Joined</b>; it becomes the Employees record&rsquo;s email.
            </p>
          </Field>
          {/* Employee Reference was here until 2 Sep 2026 (user request) —
              the Employees record carries the employee code; a second box on
              the candidate was a place for the two to disagree. Read-only
              locations take its place: where the customer wants them and
              where the candidate is, side by side, so HR sees a relocation
              at a glance. Both come from their own records, never retyped. */}
          <Field label="Customer Location">
            <div className={`${inputCls} flex items-center bg-surface-2/60 text-secondary`}
              title="Work Location set on the opportunity">
              {detail.opportunity?.location || <span className="text-muted">Not set on the opportunity</span>}
            </div>
          </Field>
          <Field label="Candidate Location">
            {/* Prefilled from the candidate record when TA set it; HR fills it
                when TA did not (4 Sep 2026, user request). Saves back to the
                CANDIDATE, like Preferred Location. */}
            <input
              className={inputCls} value={candidateCity} disabled={!canEditOnboarding}
              placeholder="e.g. Bangalore"
              onChange={(e) => setCandidateCity(e.target.value)}
            />
          </Field>
          <Field label="Candidate Preferred Location">
            {/* TA's entry from the candidate record; HR fills it when TA did
                not. Saves back to the CANDIDATE (one source of truth), so the
                next opportunity this person is put forward for sees it too. */}
            <input
              className={inputCls} value={preferredLocation} disabled={!canEditOnboarding}
              placeholder="e.g. Bangalore, Pune"
              onChange={(e) => setPreferredLocation(e.target.value)}
            />
          </Field>
          {/* TWO onboarding dates (2 Sep 2026, user request). They are different
              events and routinely different days: Karnex = the day the person
              joins us (payroll, employee record); Customer = the day the client
              onboards them onto the project (billing starts). One field meant
              whichever HR typed, the other was lost. */}
          <Field label="Karnex Onboarding Date">
            <input
              type="date" className={inputCls} value={karnexOnboardingDate}
              disabled={!canEditOnboarding}
              onChange={(e) => setKarnexOnboardingDate(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted">
              Their joining date with Karnex — this is what the Employees record uses.
            </p>
          </Field>
          <Field label="Customer Onboarding Date">
            <input
              type="date" className={inputCls} value={onboardingDate} disabled={!canEditOnboarding}
              onChange={(e) => setOnboardingDate(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted">
              The day the customer onboards them onto the project.
            </p>
          </Field>
          {/* HR-verified at onboarding (2 Sep 2026, user request). The resume's
              experience figure is the candidate's claim at apply time; this is
              the number HR signed off for this placement. */}
          <Field label="Total Experience (years)">
            <input
              type="number" min={0} max={60} step={0.5} className={inputCls}
              value={totalExp} disabled={!canEditOnboarding}
              placeholder={detail.experience_years != null
                ? `Resume says ${detail.experience_years}`
                : "e.g. 4.5"}
              onChange={(e) => setTotalExp(e.target.value)}
            />
          </Field>
          <Field label="Relocation Applicable">
            {/* A checkbox, as asked (2 Sep 2026). Unticked saves as "No" once
                HR has saved this block at all — so the column reads null only
                on profiles HR never touched. */}
            <label className={`flex h-10 cursor-pointer items-center gap-2 rounded-input border border-subtle px-3 text-sm font-semibold text-secondary ${!canEditOnboarding ? "cursor-default opacity-60" : ""}`}>
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-600"
                checked={relocation === "yes"}
                disabled={!canEditOnboarding}
                onChange={(e) => setRelocation(e.target.checked ? "yes" : "no")}
              />
              Relocation applicable
            </label>
          </Field>
        </div>
        {hrOnly && !hrWindow && (
          <p className="mt-3 text-xs text-muted">
            HR can edit the CTCs and this workflow block once the candidate reaches{" "}
            <b>HR Screening</b>.
          </p>
        )}

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
            <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-sm">
              {detail.resignation_certificate_url ? (
                <FileLink url={detail.resignation_certificate_url} label="View" />
              ) : (
                <span className="text-muted">Not uploaded yet</span>
              )}
              {/* Uploaded onto the CANDIDATE (one resignation, however many
                  opportunities) — HR can attach it from here when TA has not. */}
              {canEditOnboarding && detail.candidate?.id && (
                <FileUploadButton
                  path={`/api/candidates/${detail.candidate.id}/resignation-certificate`}
                  label={detail.resignation_certificate_url ? "Replace" : "Upload"}
                  accept=".pdf,.jpg,.jpeg,.png"
                  onDone={() => { showToast("Resignation certificate uploaded"); onReload(); }}
                  onError={(m) => showToast(m || "Upload failed", "err")}
                />
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
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          {/* The "Commercial approved" checkbox lived here until 2 Sep 2026
              (user request). Commercial sign-off is Sales Head's decision on
              the pipeline (Customer Approval), not an HR tick-box on the
              candidate — two places to say it meant they disagreed. */}
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
  // The customer's slot, shown when moving to a customer-interview stage.
  /* Customer slots (simplified 7 Sep 2026, user request): the customer sends
     Sales one or more time slots and the meeting link — that is all the form
     asks. Panel / duration are tucked away as optional. */
  const [slots, setSlots] = useState<{ when: string; link: string }[]>([{ when: "", link: "" }]);
  const [showSlotExtras, setShowSlotExtras] = useState(false);
  const [slotPanel, setSlotPanel] = useState("");
  const [slotDuration, setSlotDuration] = useState("45");
  const filledSlots = slots.filter((x) => x.when.trim());
  const slotWhen = filledSlots[0]?.when || "";
  const badLink = slots.find((x) => x.link.trim() && !/^https?:\/\/\S+$/i.test(x.link.trim()));
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
    if (badLink) {
      setError("Enter full meeting links starting with https://");
      return;
    }
    // Only enforced where the note carries information — mirrors
    // comment_required_for() on the server.
    if (noteRequired && comment.trim().length < 5) {
      setCommentError(
        slotWhen
          ? "Add a short note, e.g. \"Slot confirmed by the customer\" (minimum 5 characters)"
          : leavingCustomerInterview
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
        // The customer's slot rides the move (2 Sep 2026) — only when a time
        // was actually entered, so a plain stage change stays a stage change.
        schedule: customerSlotStage && filledSlots.length > 0
          ? {
              slots: filledSlots.map((x) => ({ scheduled_at: x.when, meeting_link: x.link.trim() || null })),
              interviewer: slotPanel.trim() || null,
              duration_minutes: showSlotExtras ? (Number(slotDuration) || null) : null,
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
    ["Shortlisted", "Customer_Approval", "Customer_Rejected",
     "Customer_L1_Rejected", "Customer_L2_Rejected"].includes(newStatus);
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
  const customerSlotStage = ["Customer_Interview", "L1_Feedback", "L2_Feedback"].includes(newStatus);
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
        {/* The customer's slot, inline (2 Sep 2026, user request): moving to a
            customer-interview stage asks for the panel, date/time and link.
            Sales types what the customer gave them; the round lands on the
            Interviews tab, the candidate is invited and TA is told. */}
        <AnimatePresence>
          {customerSlotStage && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="space-y-3 rounded-xl border border-subtle bg-surface-2 p-3">
                <p className="text-xs font-semibold text-secondary">
                  {newStatus === "L2_Feedback" ? "Customer L2" : "Customer L1"} — slots the customer gave you
                  <span className="ml-1 font-normal text-muted">— optional; the first slot is booked, the rest go to the candidate as alternatives; TA is notified</span>
                </p>
                <div className="space-y-2">
                  {slots.map((x, i) => (
                    <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,13rem)_1fr_auto]">
                      <input type="datetime-local" className={inputCls} value={x.when} aria-label={`Slot ${i + 1} date and time`}
                        onChange={(e) => setSlots((ss) => ss.map((y, j) => (j === i ? { ...y, when: e.target.value } : y)))} />
                      <input className={inputCls} value={x.link} placeholder="Meeting link the customer sent (https://…)" aria-label={`Slot ${i + 1} meeting link`}
                        onChange={(e) => setSlots((ss) => ss.map((y, j) => (j === i ? { ...y, link: e.target.value } : y)))} />
                      <button type="button" className={`${btnSecondary} !px-2`} title="Remove this slot"
                        disabled={slots.length <= 1}
                        onClick={() => setSlots((ss) => ss.filter((_, j) => j !== i))}>
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  {slots.length < 5 && (
                    <button type="button" className="text-xs font-semibold text-sky-600 hover:underline"
                      onClick={() => setSlots((ss) => [...ss, { when: "", link: "" }])}>
                      + Add another slot
                    </button>
                  )}
                </div>
                <button type="button" className="text-xs text-muted hover:underline" onClick={() => setShowSlotExtras((v) => !v)}>
                  {showSlotExtras ? "Hide" : "Add"} panel name / duration (optional)
                </button>
                {showSlotExtras && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <WizardField label="Customer panel (interviewer)">
                      <input className={inputCls} value={slotPanel} placeholder="e.g. Anoop — Engineering Manager"
                        onChange={(e) => setSlotPanel(e.target.value)} />
                    </WizardField>
                    <WizardField label="Duration">
                      <select className={inputCls} value={slotDuration} onChange={(e) => setSlotDuration(e.target.value)}>
                        {["15", "30", "45", "60", "90"].map((m) => <option key={m} value={m}>{m} minutes</option>)}
                      </select>
                    </WizardField>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
  const [letterBusy, setLetterBusy] = useState<string | null>(null);
  const [letterFor, setLetterFor] = useState<number | null>(null);

  /* Formatted offer letter (4 Sep 2026, user request): generated server-side
     from the profile + offer + candidate + org settings, as PDF or Word so HR
     can edit before sending. Same blob-download idiom as the Tax Invoice. */
  const downloadLetter = async (offer: Offer, fmt: "pdf" | "docx") => {
    const key = `${offer.id}:${fmt}`;
    setLetterBusy(key);
    try {
      const res = await authFetch(`/api/candidate-profiles/${detail.id}/offer/${offer.id}/letter.${fmt}`);
      if (!res.ok) throw new Error(`Offer letter failed (${res.status})`);
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = /filename="?([^"]+)"?/i.exec(cd);
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = m?.[1] || `Offer_Letter.${fmt}`;
      a.click();
      URL.revokeObjectURL(href);
      showToast(`Offer letter downloaded (${fmt.toUpperCase()})`);
    } catch (e: any) {
      showToast(e?.message || "Failed to generate the offer letter", "err");
    } finally {
      setLetterBusy(null);
    }
  };

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
      {/* Joining IS accepting (2 Sep 2026, user request): HR used to mark the
          candidate Joined and then hand-edit this dropdown, and the offer sat
          on "Pending" whenever the second edit was forgotten. The dropdown
          stays for corrections. */}
      {canOffer && (
        <p className="px-4 pt-3 text-xs text-muted">
          Marking the candidate <b>Joined</b> accepts their pending offer automatically —
          you only need this dropdown to record a rejection, an expiry, or a correction.
        </p>
      )}
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
              {canOffer && <th className={thCls}>Generated letter</th>}
              {canOffer && <th className={thCls}>Update status</th>}
            </tr>
          </thead>
          <tbody>
            {offers.length === 0 ? (
              <tr>
                <td colSpan={8}>
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
                    <td className={`${tdCls} whitespace-nowrap`}>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-sm font-semibold text-sky-600 hover:underline dark:text-sky-400"
                        onClick={() => setLetterFor(o.id)}
                        title="View and edit the offer letter"
                      >
                        <FileText size={14} /> View / Edit
                      </button>
                      <span className="mx-1.5 text-muted">·</span>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-sm font-semibold text-sky-600 hover:underline disabled:opacity-50 dark:text-sky-400"
                        disabled={letterBusy !== null}
                        onClick={() => downloadLetter(o, "pdf")}
                        title="Download the formatted offer letter as PDF"
                      >
                        <Download size={14} /> {letterBusy === `${o.id}:pdf` ? "PDF…" : "PDF"}
                      </button>
                      <span className="mx-1.5 text-muted">·</span>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-sm font-semibold text-sky-600 hover:underline disabled:opacity-50 dark:text-sky-400"
                        disabled={letterBusy !== null}
                        onClick={() => downloadLetter(o, "docx")}
                        title="Download the formatted offer letter as Word (editable)"
                      >
                        <Download size={14} /> {letterBusy === `${o.id}:docx` ? "Word…" : "Word"}
                      </button>
                    </td>
                  )}
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
      {letterFor !== null && (
        <OfferLetterEditor
          profileId={detail.id}
          offerId={letterFor}
          onClose={() => setLetterFor(null)}
          showToast={showToast}
        />
      )}
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
  Customer_Interview: "Customer L1 — Interview",
  Customer_L2: "Customer L2 — Interview",
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
  aiLinks,
  onReload,
  showToast,
}: {
  profileId: number;
  events: InterviewEventRow[];
  aiLinks?: AiInterviewLink[] | null;
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
  // TA coordinates interviews, so TA can record any round alongside the round's
  // owner (RMG for internal, Sales for customer). Mirrors ROUND_WRITE_ROLES.
  const canWriteTechnical = useHasRole("RMG", "TA");
  const canWriteCustomer = useHasRole("Sales", "Sales_Head", "TA");
  // HR's own round (2 Sep 2026): TA books it, but the VERDICT is HR's alone
  // (the server refuses a result from anyone else). Same page, two rights.
  const canWriteHr = useHasRole("HR", "TA");
  const isHrOnlyVerdict = useHasRole("HR");
  const isCustomerRound = (kind?: string | null) =>
    kind === "Customer_Interview" || kind === "Customer_L2";
  const canEditRound = (kind?: string | null) =>
    isCustomerRound(kind) ? canWriteCustomer
    : kind === "HR_Interview" ? canWriteHr
    : canWriteTechnical;
  const canEdit = canWriteTechnical || canWriteCustomer || canWriteHr;

  // The AI L1 result is surfaced here as a read-only round so the interview
  // timeline is complete the moment the AI interview finishes.
  const aiRounds = (aiLinks || []).filter(
    (l) => l.completed_at || l.interview_record_id || l.result !== "Pending",
  );
  const aiCards = aiRounds.map((l) => (
    <div key={`ai-${l.id}`} className={`${cardCls} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">AI {l.level || "L1"} — Interview</span>
            <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-[11px] font-semibold text-brand-600 dark:text-brand-300">
              AI
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{fmtDateTime(l.completed_at) || "In progress"}</span>
          </div>
        </div>
        <div className="text-right">
          {l.result && (
            <div className={`text-sm font-semibold ${resultTone(l.result)}`}>{l.result}</div>
          )}
          {l.overall_score_percent != null && (
            <div className="text-xs text-muted">{l.overall_score_percent}%</div>
          )}
          {l.report_link && (
            <a href={l.report_link} target="_blank" rel="noopener noreferrer"
              className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
              Full report
            </a>
          )}
        </div>
      </div>
    </div>
  ));

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<InterviewEventRow | null>(null);
  const [removing, setRemoving] = useState<InterviewEventRow | null>(null);
  const [busy, setBusy] = useState(false);

  /* LATEST FIRST + filters (3 Sep 2026, user request). The server returns
     rounds in creation order, which interleaves teams and reads oldest-first
     once a candidate has been through five rounds. Sort by the interview
     time (falling back to when the row was created), newest at the top, and
     let the reader narrow by team / outcome / text. */
  type TeamKey = "all" | "technical" | "hr" | "customer" | "ai";
  const [team, setTeam] = useState<TeamKey>("all");
  const [outcome, setOutcome] = useState<"all" | "positive" | "negative" | "pending">("all");
  const [q, setQ] = useState("");
  const [oldestFirst, setOldestFirst] = useState(false);
  const teamOf = (kind?: string | null): Exclude<TeamKey, "all"> =>
    isCustomerRound(kind) ? "customer" : kind === "HR_Interview" ? "hr" : "technical";
  const outcomeOf = (result?: string | null): "positive" | "negative" | "pending" => {
    const r = (result || "").toLowerCase();
    if (!r) return "pending";
    if (/no hire|not recommend|leaning no|reject|fail/.test(r)) return "negative";
    return "positive";
  };
  const whenOf = (e: InterviewEventRow) =>
    new Date(e.scheduled_at || e.created_at || 0).getTime() || 0;
  const t = q.trim().toLowerCase();
  const visibleEvents = [...events]
    .filter((e) => team === "all" || teamOf(e.kind) === team)
    .filter((e) => outcome === "all" || outcomeOf(e.result) === outcome)
    .filter((e) => !t || [roundLabel(e.kind), e.interviewer, e.feedback, e.note, e.result, e.user_role]
      .some((v) => String(v || "").toLowerCase().includes(t)))
    .sort((a, b) => (oldestFirst ? whenOf(a) - whenOf(b) : whenOf(b) - whenOf(a)) || (oldestFirst ? a.id - b.id : b.id - a.id));
  const visibleAi = (team === "all" || team === "ai")
    && (outcome === "all" || aiRounds.some((l) => outcomeOf(l.result) === outcome))
    && (!t || "ai interview".includes(t) || aiRounds.some((l) => String(l.result || "").toLowerCase().includes(t)))
    ? aiCards : [];
  const counts = {
    technical: events.filter((e) => teamOf(e.kind) === "technical").length,
    hr: events.filter((e) => teamOf(e.kind) === "hr").length,
    customer: events.filter((e) => teamOf(e.kind) === "customer").length,
    ai: aiRounds.length,
  };
  const filtersActive = team !== "all" || outcome !== "all" || !!t;

  const chip = (active: boolean) =>
    `rounded-full px-2.5 py-1 text-xs font-semibold transition-colors duration-micro ${
      active ? "bg-brand-600 text-white" : "bg-surface-2 text-secondary hover:text-primary"}`;
  const filterBar = (events.length + aiRounds.length) > 1 && (
    <div className="flex flex-wrap items-center gap-2 rounded-card border border-subtle bg-surface-1 px-3 py-2">
      <span className="text-[11px] font-bold uppercase tracking-wide text-muted">Team</span>
      {([["all", "All"], ["technical", `Technical${counts.technical ? ` · ${counts.technical}` : ""}`],
         ["hr", `HR${counts.hr ? ` · ${counts.hr}` : ""}`],
         ["customer", `Customer${counts.customer ? ` · ${counts.customer}` : ""}`],
         ["ai", `AI L1${counts.ai ? ` · ${counts.ai}` : ""}`]] as [TeamKey, string][])
        .filter(([k]) => k === "all" || counts[k as Exclude<TeamKey, "all">] > 0)
        .map(([k, label]) => (
          <button key={k} type="button" className={chip(team === k)} onClick={() => setTeam(k)}>{label}</button>
        ))}
      <span className="ml-2 text-[11px] font-bold uppercase tracking-wide text-muted">Outcome</span>
      <select className={`${inputCls} !h-8 !w-auto !min-h-0 !py-0 text-xs`} value={outcome}
        onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
        <option value="all">Any</option>
        <option value="positive">Positive (Hire…)</option>
        <option value="negative">Negative (No hire / Not recommend)</option>
        <option value="pending">Awaiting feedback</option>
      </select>
      <input className={`${inputCls} !h-8 !w-48 !min-h-0 !py-0 text-xs`} placeholder="Search interviewer, notes…"
        value={q} onChange={(e) => setQ(e.target.value)} />
      <button type="button" className="ml-auto text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300"
        onClick={() => setOldestFirst((v) => !v)} title="Toggle sort order">
        {oldestFirst ? "Oldest first ↑" : "Latest first ↓"}
      </button>
      {filtersActive && (
        <button type="button" className="text-xs text-muted hover:text-primary"
          onClick={() => { setTeam("all"); setOutcome("all"); setQ(""); }}>
          Clear
        </button>
      )}
    </div>
  );

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

  if (!events.length && aiRounds.length === 0) {
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
      {filterBar}
      {/* The AI L1 is the earliest round, so it sits at the bottom when the
          list reads latest-first and at the top when oldest-first. */}
      {oldestFirst && visibleAi}
      {visibleEvents.length === 0 && visibleAi.length === 0 && (
        <div className={`${cardCls} p-5 text-sm text-muted`}>No interview rounds match these filters.</div>
      )}
      {visibleEvents.map((e) => {
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
                    {/* A scheduled round with no verdict yet gets a named
                        button (2 Sep 2026, user request) — RMG for L1/L2, HR
                        for the HR round, Sales for the customer's — instead
                        of a pencil nobody reads as "record the outcome". */}
                    {!e.result && (e.kind !== "HR_Interview" || isHrOnlyVerdict) && (
                      <button
                        className={`${btnPrimary} !px-2.5 !py-1 text-xs`}
                        onClick={() => setEditing(e)}
                        title="Record the outcome of this round"
                      >
                        <Plus size={13} /> Add feedback
                      </button>
                    )}
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
      {!oldestFirst && visibleAi}
      {modals}
    </div>
  );
}

/* ---------- Add / edit an interview round ---------- */

export function InterviewRoundModal({
  profileId,
  existing,
  initialKind,
  initialMode,
  onClose,
  onSaved,
  showToast,
}: {
  profileId: number;
  existing: InterviewEventRow | null;
  /** Open preset to one round (e.g. the Applied Candidates row's "Schedule
   *  Customer L1" / "Schedule HR round" — 2 Sep 2026). */
  initialKind?: string;
  initialMode?: "schedule" | "feedback";
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
  const [kind, setKind] = useState(existing?.kind || initialKind || "");
  const presetCustomer = initialKind === "Customer_Interview" || initialKind === "Customer_L2";
  const [category, setCategory] = useState(
    existing?.interview_category || (presetCustomer ? "External" : "Internal"));
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
  const [userRole, setUserRole] = useState(
    existing?.user_role || (presetCustomer ? "Customer" : initialKind === "HR_Interview" ? "HR" : "RMG"));
  const [meetingLink, setMeetingLink] = useState(existing?.meeting_link || "");
  /* TWO JOBS, ONE FORM (user decision, 27 Aug 2026). "Schedule" records that
     the round is lined up — date + meeting link, no verdict, pipeline
     untouched. "Feedback" records what happened, and for the customer's own
     rounds the save moves the pipeline itself. */
  /* Which tab opens (2 Sep 2026, user decision): the "Add … feedback" button
     starts on SCHEDULE — a new round is lined up first; the pencil on an
     existing round starts on RECORD FEEDBACK — that round already has its
     date/panel/link, and what's missing is the outcome. */
  const [mode, setMode] = useState<"schedule" | "feedback">(
    initialMode ?? (existing ? "feedback" : "schedule"));
  const isCustomerRound = kind === "Customer_Interview" || kind === "Customer_L2";
  /* Whose verdict this round's feedback is — names the tab and decides who
     may open it (2 Sep 2026). TA books rounds; the owners judge them. */
  const feedbackOwner = isCustomerRound ? "Sales" : kind === "HR_Interview" ? "HR" : "RMG";
  const isRmgUser = useHasRole("RMG");
  const isSalesUser = useHasRole("Sales", "Sales_Head");
  const isHrUser = useHasRole("HR");
  const canRecordFeedback = isCustomerRound ? isSalesUser : kind === "HR_Interview" ? isHrUser : isRmgUser;
  /* Declared AFTER canRecordFeedback — referencing it earlier is a TDZ
     ReferenceError at render, which blanked the whole page for TA when
     "Schedule customer L1" opened this modal (4 Sep 2026). */
  useEffect(() => {
    // Whoever cannot record this round's verdict lands on Schedule instead.
    if (mode === "feedback" && !canRecordFeedback) setMode("schedule");
  }, [mode, canRecordFeedback]);
  /* Feedback on a round that was SCHEDULED here: every detail is already on
     file, so only the outcome is asked for. A brand-new round, or one whose
     details are missing, still shows the full form. */
  const compactFeedback = mode === "feedback" && isEdit && !!existing?.scheduled_at;

  /* Customer rounds are taken by the customer's panel (2 Sep 2026): default
     Interview Category to External, drop the Employee picker (no Karnex
     employee took it) and mark the User Role as Customer. Only auto-applied
     when the user CHANGES the round — an existing row's saved values win. */
  const kindTouched = useRef(false);
  useEffect(() => {
    if (!kindTouched.current) return;
    if (isCustomerRound) {
      setCategory("External");
      setUserRole("Customer");
      setEmployeeId("");
    } else {
      setCategory("Internal");
      setUserRole("RMG");
    }
  }, [isCustomerRound]);

  useEffect(() => {
    crmGet<InterviewRoundOptions>(`/api/candidate-profiles/${profileId}/interview-rounds/options`)
      .then((r) => {
        setOpts(r.data);
        // Preselect the first round this role may actually save: L1 for RMG,
        // Customer Interview for Sales. Only when adding — never override the
        // kind of a round being edited. A preselect counts as a "change" so
        // the customer-round defaults (External / Customer) apply for Sales.
        if (!existing) kindTouched.current = true;
        setKind((current) => current || r.data?.writable_rounds?.[0] || "");
      })
      .catch((e: any) => setOptsError(e?.message || "Failed to load form options"));
  }, [profileId]);

  const submit = async () => {
    if (!kind) return setError("Interview Round is required");
    if (!employeeId && !interviewer.trim()) {
      return setError("Pick an employee, or type a name for an external panellist");
    }
    if (mode === "schedule" && !when) {
      return setError("Interview date & time is required when scheduling a round");
    }
    if (mode === "feedback" && isCustomerRound && !result) {
      return setError("Pick the customer's Result — it is what moves the pipeline forward");
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
      // Scheduling records the plan, never a verdict — a result here would
      // auto-advance the pipeline for an interview that has not happened.
      status: mode === "schedule" ? "Scheduled" : (status || "Completed"),
      scheduled_at: when ? new Date(when).toISOString() : null,
      result: mode === "schedule" ? null : (result || null),
      feedback: mode === "schedule" ? (feedback.trim() || null) : (feedback.trim() || null),
      meeting_link: meetingLink.trim() || null,
      user_role: userRole || null,
    };
    try {
      if (isEdit) {
        const res = await crmPut<any>(`/api/candidate-profiles/${profileId}/interview-rounds/${existing!.id}`, body);
        showToast(res.message || "Interview feedback updated");
      } else {
        const res = await crmPost<any>(`/api/candidate-profiles/${profileId}/interview-rounds`, body);
        showToast(res.message || "Interview feedback saved");
      }
      onSaved();
    } catch (e: any) {
      setError(e?.message || "Failed to save the interview feedback");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={mode === "schedule" ? "Schedule interview round" : (isEdit ? "Edit interview feedback" : "Add interview feedback")}
      onClose={onClose}
      medium
    >
      <WizFormShell
        title={mode === "schedule" ? "Schedule interview round" : (isEdit ? "Edit interview feedback" : "Add interview feedback")}
        subtitle="Record the round, the panel and the outcome. Everything here shows on the candidate's Interviews tab."
        icon={<GitBranch size={18} />}
      >
        {optsError && <ErrorBox error={optsError} />}
        {error && <ErrorBox error={error} />}
        {!opts && !optsError ? (
          <Spinner label="Loading form…" />
        ) : (
          <>
            <div className="mb-4 rounded-card border border-subtle bg-surface-2/40 p-3">
              <div className="flex flex-wrap gap-2">
                {([
                  { key: "schedule", label: "Schedule interview", locked: false },
                  /* The feedback tab is NAMED for the team whose verdict it is
                     (2 Sep 2026, user request) and LOCKED for anyone else —
                     TA schedules every round but records none of them. */
                  { key: "feedback", label: `${feedbackOwner} Feedback`, locked: !canRecordFeedback },
                ] as const)
                  /* Hidden outright for the scheduler (3 Sep 2026, user
                     request): a greyed "Sales Feedback" tab on TA's
                     customer-round form read as something TA had missed. */
                  .filter((m) => !m.locked)
                  .map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    disabled={m.locked}
                    title={m.locked ? `Only ${feedbackOwner} records this round's feedback — TA schedules it` : undefined}
                    onClick={() => { if (!m.locked) setMode(m.key); }}
                    className={`rounded-control px-3 py-1.5 text-sm font-semibold transition-colors duration-micro ${
                      mode === m.key ? "bg-brand-600 text-white"
                      : m.locked ? "cursor-not-allowed bg-surface-1 text-muted opacity-60"
                      : "bg-surface-1 text-secondary hover:text-primary"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">
                {mode === "schedule"
                  ? "Records that the round is lined up — date, panel and meeting link. No verdict, and the pipeline stage is left alone."
                  : isCustomerRound
                    ? "Saving the customer's verdict moves the pipeline to this round's stage automatically — no separate status update needed."
                    : "Records what happened in the round: result and written feedback."}
              </p>
            </div>
            {compactFeedback && (
              /* Everything below was captured when the round was scheduled —
                 restate it, don't re-ask. Switch to "Schedule interview" to change it. */
              <div className="mb-4 rounded-card border border-subtle bg-surface-1 px-4 py-3 text-sm">
                <div className="text-xs font-bold uppercase tracking-wide text-muted">Round on file</div>
                <div className="mt-1 font-semibold text-primary">{roundLabel(kind)}
                  {category ? <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-secondary">{category}</span> : null}
                </div>
                <div className="mt-0.5 text-secondary">
                  {when ? new Date(when).toLocaleString() : "—"}
                  {duration ? ` · ${duration} min` : ""}
                  {(interviewer || employeeId) ? ` · Interviewer: ${interviewer || (opts?.employees || []).find((e) => String(e.id) === employeeId)?.full_name || ""}` : ""}
                  {userRole ? ` · by ${userRole}` : ""}
                </div>
                {meetingLink && (
                  <a href={meetingLink} target="_blank" rel="noreferrer" className="mt-0.5 inline-block text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
                    Meeting link
                  </a>
                )}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {!compactFeedback && (<>
              <WizardField label="Interview Category" required>
                <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
                  {(opts?.categories || []).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </WizardField>

              <WizardField label="Interview Round" required>
                <select className={inputCls} value={kind}
                  onChange={(e) => { kindTouched.current = true; setKind(e.target.value); }}>
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

              {/* No Karnex employee takes a CUSTOMER round — only the name. */}
              {!isCustomerRound && (
                <WizardField label="Employee" info="The panel member who took the round.">
                  {/* Searchable (4 Sep 2026, user request): the bench is a
                      long list, so type-ahead instead of scrolling a <select>.
                      The "external / not listed" choice clears the pick, which
                      re-enables the free-text Interviewer name below. */}
                  <SearchableSelect
                    value={employeeId}
                    onChange={(v) => setEmployeeId(v === EXTERNAL_PANELLIST ? "" : v)}
                    placeholder="Search employee by name…"
                    options={[
                      { value: EXTERNAL_PANELLIST, label: "— External / not listed —" },
                      ...(opts?.employees || []).map((emp) => ({
                        value: String(emp.id),
                        label: emp.employee_code ? `${emp.full_name} (${emp.employee_code})` : emp.full_name,
                      })),
                    ]}
                  />
                </WizardField>
              )}

              <WizardField
                label={isCustomerRound ? "Interviewer name (customer panel)" : "Interviewer name"}
                info={isCustomerRound
                  ? "The customer-side panellist who takes this round."
                  : "Only needed for an external panellist with no employee record."}
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
              </>)}

              {mode === "feedback" && (
                <WizardField label="Interview Status">
                  <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">—</option>
                    {(opts?.statuses || []).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </WizardField>
              )}

              {!compactFeedback && (<>
              <WizardField
                label="Meeting link"
                info="The interview link — the candidate is emailed it (with a calendar invite) when the round is scheduled."
              >
                <input
                  className={inputCls}
                  value={meetingLink}
                  onChange={(e) => setMeetingLink(e.target.value)}
                  placeholder="https://teams.microsoft.com/…"
                />
              </WizardField>

              <WizardField label="Interview Date/Time From">
                <input
                  type="datetime-local"
                  className={inputCls}
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                />
              </WizardField>
              </>)}

              {mode === "feedback" && (
                <WizardField label={kind === "HR_Interview" ? "HR verdict" : "Result"}
                  required={isCustomerRound || kind === "HR_Interview"}
                  info={kind === "HR_Interview"
                    ? "Hire or Not Recommend — either moves the candidate to Pre Onboarding. Not Recommend means the expected CTC or joining date is the problem; you flag it to Sales from there. Drop means the candidate is not continuing (a better offer elsewhere) — the profile closes as Self Withdrawn."
                    : undefined}>
                  <select className={inputCls} value={result} onChange={(e) => setResult(e.target.value)}>
                    <option value="">—</option>
                    {/* The HR round has its own verdict set (3 Sep 2026; Drop added
                        4 Sep 2026). A legacy five-step value already on the row
                        stays selectable. */}
                    {(kind === "HR_Interview"
                      ? [...(opts?.hr_results || HR_VERDICTS),
                         ...(result && !(opts?.hr_results || HR_VERDICTS).includes(result) ? [result] : [])]
                      : (opts?.results || [])).map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </WizardField>
              )}

              {!compactFeedback && (
                <WizardField label="User Role" info="Which team conducted this round.">
                  <select className={inputCls} value={userRole} onChange={(e) => setUserRole(e.target.value)}>
                    <option value="">—</option>
                    {(opts?.user_roles || []).map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </WizardField>
              )}

              <WizardField
                label={mode === "schedule" ? "Notes (optional)" : "Overall Feedback"}
                className="sm:col-span-2"
              >
                <textarea
                  rows={mode === "schedule" ? 3 : 6}
                  className={inputCls}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder={mode === "schedule"
                    ? "Anything the panel should know before the round…"
                    : "Technical depth, communication, strengths, gaps, and your recommendation…"}
                />
              </WizardField>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} onClick={submit} disabled={busy}>
                {busy ? "Saving…"
                  : mode === "schedule" ? (isEdit ? "Update schedule" : "Schedule Interview")
                  : isEdit ? "Save changes" : `Save ${feedbackOwner} feedback`}
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

