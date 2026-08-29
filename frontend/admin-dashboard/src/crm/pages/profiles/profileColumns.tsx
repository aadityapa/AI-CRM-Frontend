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
import { AlertTriangle } from "lucide-react";

import type { Column } from "../../components/DataTable";
import { FileLink } from "../../components/FileUpload";
import { StatusBadge, selfWithdrewLabel } from "../../components/ui";
import { Avatar } from "../../components/Avatar";
import { ScoreIndicator } from "../../components/ScoreIndicator";
import { AiInterviewCell } from "../../components/AiInterviewCell";
import { displayEmail } from "../../lib/candidateEmail";

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
  customer_name?: string | null;
  pipeline_status: string;
  stage?: string | null;
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
  resume_url?: string | null;
  resignation_certificate_url?: string | null;
  resignation_status?: boolean;
  customer_submission_date?: string | null;
  customer_onboarding_date?: string | null;
  ta_owner_name?: string | null;
  applied_on?: string | null;
  created_at?: string | null;
};

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
  "ai_interview",
  "pipeline_status",
  "interview_round",
  "experience_years",
  "notice_period",
  "applied_on",
  "ta_owner_name",
  "created_by_name",
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
          <div className="truncate text-xs text-muted" title={r.opportunity_title || undefined}>
            {r.customer_name || r.opportunity_title || "—"}
          </div>
        </div>
      ),
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
      key: "pipeline_status",
      label: "Status",
      sortable: true,
      render: (r) => <StatusBadge status={r.pipeline_status} label={selfWithdrewLabel(r.pipeline_status, (r as any).withdrawn_from_status)} />,
    },
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
    { key: "stage", label: "Stage", render: (r) => r.stage || dash },
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
      key: "customer_onboarding_date",
      label: "Onboarding date",
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
