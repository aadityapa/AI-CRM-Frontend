/**
 * Column definitions for the Candidate Profiles table.
 *
 * Extracted from the page so the page component stays readable and so the
 * column set can be reasoned about on its own — it is the product decision
 * that matters most on this screen.
 *
 * All 26 columns are preserved; what changed is which are on by default and
 * how much visual weight each carries. Score and status now lead, because a
 * reviewer's question is "is this a yes?" — everything else is evidence they
 * only need once the answer is "maybe".
 */
import { AlertTriangle, CalendarClock, UserRound } from "lucide-react";

import type { Column } from "../../components/DataTable";
import { FileLink } from "../../components/FileUpload";
import { StatusBadge } from "../../components/ui";
import { CandidateStageBadge, CandidateStatusBadge } from "../../components/CandidateStatusBadge";
import type { CandidateStatus } from "../../components/CandidateStatusBadge";
import { Avatar } from "../../components/Avatar";
import { ScoreIndicator } from "../../components/ScoreIndicator";
import { AiInterviewCell } from "../../components/AiInterviewCell";
import { displayEmail } from "../../lib/candidateEmail";
import { roundResultTone } from "../../lib/interviewRounds";
import { fmtDateTime12 } from "../../../lib/datetime";

/** Row shape is owned by Profiles.tsx; this module only reads from it. */
export type ProfileColumnRow = {
  id: number;
  candidate_id: number;
  candidate_name?: string | null;
  email?: string | null;
  phone?: string | null;
  experience_years?: number | null;
  notice_period?: string | null;
  technical_domain?: string | null;
  opportunity_id: number;
  opportunity_opp_id?: string | null;
  opportunity_title?: string | null;
  opportunity_exp_min?: number | null;
  opportunity_exp_max?: number | null;
  customer_name?: string | null;
  pipeline_status: string;
  /** The derived status every screen shows (server-side). */
  candidate_status?: CandidateStatus | null;
  withdrawn_from_status?: string | null;
  current_ctc: number | null;
  expected_ctc: number | null;
  candidate_current_ctc?: number | null;
  candidate_expected_ctc?: number | null;
  hike_percent: number | null;
  approved_ctc_budget?: number | null;
  ctc_slab_band?: string | null;
  ctc_approval_amount: number | null;
  commercial_approval_status?: string | null;
  interview_round?: string | null;
  interview_status?: string | null;
  interview_datetime?: string | null;
  ai_overall_score_percent?: number | null;
  ai_interview_status?: string | null;
  ai_interview_result?: string | null;
  ai_hr_decision_label?: string | null;
  ai_is_overridden?: boolean;
  ai_report_link?: string | null;
  /** Resume ATS score for this opportunity (latest resume on its requirements). */
  ats_score?: number | null;
  ats_status?: string | null;
  resume_url?: string | null;
  resignation_certificate_url?: string | null;
  resignation_status?: boolean;
  customer_submission_date?: string | null;
  customer_onboarding_date?: string | null;
  karnex_onboarding_date?: string | null;
  ta_owner_name?: string | null;
  applied_on?: string | null;
  created_at?: string | null;
  /** One entry per round column (B-V2 `candidate_profiles.round_ladder`). */
  rounds?: Partial<Record<RoundKey, RoundEntry>>;
  next_interview?: NextInterview | null;
};

export type RoundKey = "tech_l1" | "tech_l2" | "tech_l3" | "cust_l1" | "cust_l2" | "hr";
export type RoundEntry = {
  event_id: number; when: string | null; result: string | null; status: string | null;
  interviewer: string | null; mode: string | null; feedback: string | null; upcoming: boolean;
};
export type NextInterview = {
  round: string; round_key: RoundKey | null; when: string; interviewer: string | null;
  event_id: number; meeting_link: boolean;
};

/** The round columns, in interview order — mirror of B-V2 `ROUND_COLUMNS`. */
export const ROUND_COLUMNS: { key: RoundKey; label: string; family: "karnex" | "customer" | "hr" }[] = [
  { key: "tech_l1", label: "Technical L1", family: "karnex" },
  { key: "tech_l2", label: "Technical L2", family: "karnex" },
  { key: "tech_l3", label: "Technical L3 / L4", family: "karnex" },
  { key: "cust_l1", label: "Customer L1", family: "customer" },
  { key: "cust_l2", label: "Customer L2", family: "customer" },
  { key: "hr", label: "HR round", family: "hr" },
];

/** "in 3 h", "in 2 days", "2 days ago" — the reviewer's clock. */
function relativeWhen(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.round((t - Date.now()) / 60_000);
  const abs = Math.abs(mins);
  const span = abs < 60 ? `${abs} min` : abs < 48 * 60 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} days`;
  return mins >= 0 ? `in ${span}` : `${span} ago`;
}

/** One round in a cell: verdict chip, date & time, panel, and the feedback
 *  (two lines, the whole text on hover). An upcoming round says so. */
function RoundCell({ entry }: { entry?: RoundEntry }) {
  if (!entry) return <span className="text-xs text-muted">—</span>;
  const verdict = entry.result || (entry.upcoming ? "Upcoming" : entry.when ? "Awaiting feedback" : entry.status || "Booked");
  const tone = entry.result ? roundResultTone(entry.result)
    : entry.upcoming ? "bg-info-soft text-info" : "bg-warning-soft text-warning";
  const when = entry.when ? fmtDateTime12(entry.when, entry.when) : null;
  return (
    <div className="min-w-[170px] max-w-[240px] space-y-0.5">
      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{verdict}</span>
      {when && (
        <div className="flex items-center gap-1 whitespace-nowrap text-[11px] text-secondary" title={entry.when || undefined}>
          <CalendarClock size={11} aria-hidden /> {when}
        </div>
      )}
      {entry.interviewer && (
        <div className="flex items-center gap-1 truncate text-[11px] text-muted"><UserRound size={11} aria-hidden /> {entry.interviewer}</div>
      )}
      {entry.feedback && (
        <p className="line-clamp-2 text-[11px] italic leading-snug text-secondary" title={entry.feedback}>“{entry.feedback}”</p>
      )}
    </div>
  );
}

/**
 * Columns shown until a user saves their own layout.
 *
 * Sixteen was too many — every cell had identical weight, so there was no scan
 * path and each row had to be read left to right in full. These nine answer
 * "who is this, how did they do, where are they, whose is it".
 * The other seventeen remain one click away in the column customiser.
 */
export const DEFAULT_PROFILE_COLUMNS = [
  "candidate_name",
  "opportunity",
  "phase",
  "pipeline_status",
  "next_interview",
  "ai_interview",
  "ats_score",
  "round_tech_l1",
  "round_tech_l2",
  "round_cust_l1",
  "round_cust_l2",
  "round_hr",
  "experience_years",
  "opportunity_exp",
  "notice_period",
  "applied_on",
  "ta_owner_name",
];

/**
 * Formatting helpers, owned by Profiles.tsx and passed in.
 *
 * Signatures match the existing functions exactly rather than the other way
 * round — these are used in a dozen other places on the detail page, and
 * changing them to suit this module would ripple further than the redesign
 * should. `fmtDateTime` genuinely returns null for a missing date, and
 * `roundLabel` genuinely requires a string; both are reflected here.
 */
export type ColumnHelpers = {
  fmtLac: (v?: number | null) => string;
  fmtHike: (v?: number | null) => string;
  fmtDate: (v?: string | null) => string;
  fmtDateTime: (v?: string | null) => string | null;
  roundLabel: (kind: string) => string;
};

const dash = <span className="text-muted">—</span>;

/** Absolute date in a tooltip, relative in the cell — scanning wants "3 days
 *  ago", auditing wants the date. Both, without a second column. */
function RelativeDate({ iso, fmtDate }: { iso?: string | null; fmtDate: (v?: string | null) => string }) {
  if (!iso) return dash;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return <>{fmtDate(iso)}</>;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  const label =
    days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 30 ? `${days} days ago` : fmtDate(iso);
  return <span title={fmtDate(iso)}>{label}</span>;
}

export function buildProfileColumns(h: ColumnHelpers): Column<ProfileColumnRow>[] {
  const ctc = (r: ProfileColumnRow, kind: "current" | "expected") =>
    kind === "current"
      ? r.current_ctc ?? r.candidate_current_ctc ?? null
      : r.expected_ctc ?? r.candidate_expected_ctc ?? null;

  return [
    {
      key: "candidate_name",
      label: "Candidate",
      className: "min-w-[220px]",
      render: (r) => (
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={r.candidate_name || `Candidate ${r.candidate_id}`} size={32} />
          <div className="min-w-0">
            <div className="truncate font-semibold text-primary" title={r.candidate_name || undefined}>
              {r.candidate_name || `Candidate #${r.candidate_id}`}
            </div>
            <div className="truncate text-xs text-muted" title={r.email || undefined}>
              {displayEmail(r.email, "—")}
            </div>
          </div>
        </div>
      ),
    },
    { key: "email", label: "Email", render: (r) => displayEmail(r.email, "—") },
    { key: "phone", label: "Phone", render: (r) => r.phone || dash },
    {
      key: "experience_years",
      label: "Exp (yrs)",
      align: "right",
      sortable: true,
      render: (r) => (r.experience_years != null ? r.experience_years : dash),
    },
    { key: "notice_period", label: "Notice", render: (r) => r.notice_period || dash },
    {
      key: "opportunity",
      label: "Opportunity",
      className: "min-w-[170px]",
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate font-semibold text-primary">
            {r.opportunity_opp_id || `Opportunity #${r.opportunity_id}`}
          </div>
          {r.opportunity_title && (
            <div className="truncate text-xs text-secondary" title={r.opportunity_title}>
              {r.opportunity_title}
            </div>
          )}
          <div className="truncate text-xs text-muted">{r.customer_name || "—"}</div>
        </div>
      ),
    },
    {
      // The opportunity's REQUIRED experience band (28 Aug 2026, user
      // request) — next to the candidate's own Exp, "does this person fit?"
      // is answerable without opening the opportunity.
      key: "opportunity_exp",
      label: "Opp Exp (yrs)",
      align: "right",
      render: (r) => {
        const mn = r.opportunity_exp_min;
        const mx = r.opportunity_exp_max;
        if (mn == null && mx == null) return dash;
        if (mn != null && mx != null) return `${mn} – ${mx}`;
        return mn != null ? `${mn}+` : `≤ ${mx}`;
      },
    },
    {
      // The primary signal. The ring states the score and its tier; the badge
      // below appears ONLY when a recruiter overrode the AI, because that is
      // the one thing the ring cannot express. The AI's own pass/fail verdict
      // lives in the tooltip — restating "57 is below 60" in the cell just
      // competes with the number already there.
      key: "ai_interview",
      label: "AI score",
      sortable: true,
      className: "min-w-[150px]",
      render: (r) =>
        r.ai_overall_score_percent == null && !r.ai_interview_status ? (
          <span className="text-xs text-muted">Not scheduled</span>
        ) : (
          <div className="flex flex-col items-start gap-1">
            <ScoreIndicator score={r.ai_overall_score_percent} size="md" />
            <AiInterviewCell row={r} variant="beside-score" />
          </div>
        ),
    },
    {
      // Resume ↔ requirement match (25 Sep 2026, user request: visible to
      // everyone). Same ring as the AI score so the two read side by side;
      // the server scores uploads on arrival and the Screening Desk fills
      // any gaps, so a dash means "no CV / not scored yet", not zero.
      key: "ats_score",
      label: "ATS score",
      sortable: true,
      align: "right",
      render: (r) =>
        r.ats_score == null ? (
          <span className="text-xs text-muted" title={r.ats_status === "Pending_Scan" ? "Resume not scored yet" : "No resume on this opportunity"}>
            {r.ats_status === "Pending_Scan" ? "Not scored" : "—"}
          </span>
        ) : (
          <ScoreIndicator score={r.ats_score} size="sm" showLabel={false} />
        ),
    },
    {
      // The derived candidate status (25 Sep 2026): "Manual L1 – Scheduled",
      // "Customer L2 – Failed", "HR Discussion"… Sorts by pipeline stage.
      key: "pipeline_status",
      label: "Status",
      sortable: true,
      render: (r) => (
        <CandidateStatusBadge status={r.candidate_status} stage={r.pipeline_status}
          withdrawnFrom={r.withdrawn_from_status} />
      ),
    },
    {
      // The stage (29 Sep 2026): the same phase the stage strip above counts.
      key: "phase",
      label: "Stage",
      render: (r) => <CandidateStageBadge status={r.candidate_status} />,
    },
    {
      // The next interview due — round, date & time, and how soon.
      key: "next_interview",
      label: "Next interview",
      className: "min-w-[170px]",
      render: (r) => {
        const n = r.next_interview;
        if (!n) return <span className="text-xs text-muted">None booked</span>;
        const soon = new Date(n.when).getTime() - Date.now() < 24 * 3600_000;
        return (
          <div className="space-y-0.5">
            <div className="text-xs font-semibold text-primary">{n.round}</div>
            <div className="flex items-center gap-1 whitespace-nowrap text-[11px] text-secondary">
              <CalendarClock size={11} aria-hidden /> {fmtDateTime12(n.when)}
            </div>
            <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-bold ${soon ? "bg-warning-soft text-warning" : "bg-info-soft text-info"}`}>
              {relativeWhen(n.when)}{n.meeting_link ? "" : " · no link"}
            </span>
          </div>
        );
      },
    },
    ...ROUND_COLUMNS.map((c) => ({
      key: `round_${c.key}`,
      label: c.label,
      render: (r: ProfileColumnRow) => <RoundCell entry={r.rounds?.[c.key]} />,
    })),
    {
      key: "interview_round",
      label: "Round",
      render: (r) =>
        r.interview_round ? (
          <span className="rounded-full border border-subtle bg-surface-2 px-2 py-0.5 text-xs font-semibold text-secondary">
            {h.roundLabel(r.interview_round)}
          </span>
        ) : (
          dash
        ),
    },
    {
      key: "interview_status",
      label: "Interview status",
      render: (r) => (r.interview_status ? <StatusBadge status={r.interview_status} /> : dash),
    },
    {
      key: "interview_datetime",
      label: "Interview date",
      // fmtDateTime returns null when there is no date; fall back rather than
      // rendering an empty cell that reads as "no data for this column".
      render: (r) => h.fmtDateTime(r.interview_datetime) ?? dash,
    },
    {
      key: "applied_on",
      label: "Applied",
      align: "right",
      sortable: true,
      render: (r) => <RelativeDate iso={r.applied_on} fmtDate={h.fmtDate} />,
    },
    {
      key: "ta_owner_name",
      label: "TA owner",
      render: (r) =>
        r.ta_owner_name ? (
          <span className="flex items-center gap-2">
            <Avatar name={r.ta_owner_name} size={22} />
            <span className="truncate text-secondary">{r.ta_owner_name.split(" ")[0]}</span>
          </span>
        ) : (
          dash
        ),
    },
    {
      // Who filed this profile (18 Aug 2026): a wrong/missing detail goes to
      // the person who SUBMITTED it, not to the whole TA team.
      key: "created_by_name",
      label: "Submitted by",
      render: (r) =>
        (r as any).created_by_name ? (
          <span className="flex items-center gap-2">
            <Avatar name={(r as any).created_by_name} size={22} />
            <span className="truncate text-secondary">{(r as any).created_by_name}</span>
          </span>
        ) : (
          dash
        ),
    },
    { key: "technical_domain", label: "Domain", render: (r) => r.technical_domain || dash },
    { key: "customer", label: "Customer", render: (r) => r.customer_name || dash },
    {
      key: "current_ctc",
      label: "Current CTC (Lac)",
      align: "right",
      sortable: true,
      render: (r) => h.fmtLac(ctc(r, "current")),
    },
    {
      key: "expected_ctc",
      label: "Expected CTC (Lac)",
      align: "right",
      sortable: true,
      render: (r) => h.fmtLac(ctc(r, "expected")),
    },
    { key: "hike_percent", label: "Hike %", align: "right", render: (r) => h.fmtHike(r.hike_percent) },
    {
      key: "approved_ctc_budget",
      label: "Approved budget (Lac)",
      align: "right",
      render: (r) =>
        r.approved_ctc_budget != null ? (
          <span title={r.ctc_slab_band ? `Slab band: ${r.ctc_slab_band}` : undefined}>
            {h.fmtLac(r.approved_ctc_budget)}
          </span>
        ) : (
          dash
        ),
    },
    /* "CTC approval (Lac)" removed (Aug 2026) — it duplicated Approved CTC
       Budget for reviewers and belongs to the commercials workflow, which
       lives on the profile's Overview tab where it is actually edited. */
    {
      key: "commercial_approval_status",
      label: "Commercial approval",
      render: (r) => r.commercial_approval_status || dash,
    },
    {
      key: "resume_url",
      label: "CV",
      render: (r) => (r.resume_url ? <FileLink url={r.resume_url} label="View" /> : dash),
    },
    {
      key: "resignation_certificate_url",
      label: "Resignation cert.",
      render: (r) => {
        if (r.resignation_certificate_url) return <FileLink url={r.resignation_certificate_url} label="View" />;
        // Only chase the document when the candidate has actually resigned —
        // otherwise "missing" is not a problem to flag.
        if (r.resignation_status) {
          return (
            <span
              className="inline-flex items-center gap-1 text-xs font-semibold text-warning"
              title="Candidate has resigned but no certificate has been uploaded"
            >
              <AlertTriangle size={12} aria-hidden /> Not uploaded
            </span>
          );
        }
        return dash;
      },
    },
    {
      key: "customer_submission_date",
      label: "Submitted to customer",
      sortable: true,
      render: (r) => (r.customer_submission_date ? h.fmtDate(r.customer_submission_date) : dash),
    },
    {
      // Two onboarding dates since 2 Sep 2026, so "Onboarding date" no longer
      // says which one — both columns name their side explicitly.
      key: "karnex_onboarding_date",
      label: "Karnex onboarding",
      sortable: true,
      render: (r) => (r.karnex_onboarding_date ? h.fmtDate(r.karnex_onboarding_date) : dash),
    },
    {
      key: "customer_onboarding_date",
      label: "Customer onboarding",
      sortable: true,
      render: (r) => (r.customer_onboarding_date ? h.fmtDate(r.customer_onboarding_date) : dash),
    },
    {
      key: "created_at",
      label: "Created",
      align: "right",
      sortable: true,
      render: (r) => (r.created_at ? h.fmtDate(r.created_at) : dash),
    },
  ];
}
