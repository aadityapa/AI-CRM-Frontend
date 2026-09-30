/**
 * The ONE candidate status every screen shows (25 Sep 2026).
 *
 * The server derives it (B-V2 `services/candidate_status.py`) from the
 * pipeline stage + the latest Manual / Customer / AI round + RMG's screening,
 * and sends it on every profile payload as `candidate_status` (profile lists,
 * detail, candidate page, reports) or `profile_status` (rows that are not
 * profiles: Applied Candidates, Screening Desk). Naming convention:
 * "<who runs the round> – <result>", e.g. "Manual L1 – Scheduled",
 * "Customer L2 – Failed", "HR Discussion", "Customer Shortlisted".
 *
 * Nothing here decides a status — the UI renders what the server says, so a
 * list, a badge and an export can never disagree. `useCandidateStatusCatalogue`
 * serves the filter vocabulary from `GET /api/candidate-profiles/status-options`.
 */
import { useEffect, useState } from "react";
import { CalendarClock, Hourglass, Info, UserRound } from "lucide-react";

import { fmtDateTime12 } from "../../lib/datetime";
import { crmGet } from "../api";
import { STAGE_TONE } from "../lib/candidateStageBuckets";
import { StatusBadge, selfWithdrewLabel } from "./ui";

export type CandidateStatusTone = "neutral" | "info" | "warn" | "ok" | "bad";

export type CandidateStatus = {
  key: string;
  label: string;
  tone: CandidateStatusTone;
  group: string;
  hint: string;
  /** The PHASE the candidate is in — Sourcing … Onboarding, Closed (28 Sep 2026). */
  stage?: { key: string; label: string };
  /** What is happening in that phase: the round ("Technical L1 Interview")
   *  and its state ("Scheduled"). `key` names the round whose date the row
   *  carries (see `ROUND_WHEN_FIELDS`). */
  round?: { key: string | null; label: string; state: string | null };
};

export type CandidateStatusOption = CandidateStatus & {
  /** Can appear under the directory's "In pipeline" / "Closed" views. */
  active: boolean;
  closed: boolean;
};

export type CandidateStatusCatalogue = {
  groups: { key: string; label: string }[];
  statuses: CandidateStatusOption[];
};

/** One token pair per tone — the only place a candidate status picks colour. */
export const CANDIDATE_STATUS_TONE: Record<CandidateStatusTone, string> = {
  neutral: "bg-surface-2 text-secondary",
  info: "bg-info-soft text-info",
  warn: "bg-warning-soft text-warning",
  ok: "bg-success-soft text-success",
  bad: "bg-danger-soft text-danger",
};

export function CandidateStatusBadge({
  status,
  stage,
  withdrawnFrom,
}: {
  status?: CandidateStatus | null;
  /** Fallback for payloads without a derived status (never expected from
   *  the lists that carry one, kept so an older server still renders). */
  stage?: string | null;
  withdrawnFrom?: string | null;
}) {
  if (!status) {
    return stage
      ? <StatusBadge status={stage} label={selfWithdrewLabel(stage, withdrawnFrom)} />
      : <span className="text-muted">—</span>;
  }
  const tone = CANDIDATE_STATUS_TONE[status.tone] || CANDIDATE_STATUS_TONE.neutral;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ring-subtle ${tone} ${status.hint ? "cursor-help" : ""}`}
      title={status.hint || undefined}
      data-status={status.key}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden />
      {status.label}
      {status.hint && (
        <Info size={12} className="shrink-0 opacity-60" aria-label={`What does ${status.label} mean?`} />
      )}
    </span>
  );
}

let catalogueRequest: Promise<CandidateStatusCatalogue> | null = null;

/** The catalogue, fetched once per page load and shared by every caller. */
export function loadCandidateStatusCatalogue(): Promise<CandidateStatusCatalogue> {
  if (!catalogueRequest) {
    catalogueRequest = crmGet<CandidateStatusCatalogue>("/api/candidate-profiles/status-options")
      .then((r) => r.data as CandidateStatusCatalogue)
      .catch((e) => {
        catalogueRequest = null; // let the next caller retry
        throw e;
      });
  }
  return catalogueRequest;
}

export function useCandidateStatusCatalogue(): CandidateStatusCatalogue | null {
  const [catalogue, setCatalogue] = useState<CandidateStatusCatalogue | null>(null);
  useEffect(() => {
    let alive = true;
    loadCandidateStatusCatalogue()
      .then((c) => { if (alive) setCatalogue(c); })
      .catch(() => { /* the filter shows no options; the list itself still loads */ });
    return () => { alive = false; };
  }, []);
  return catalogue;
}

/** Filter options for one directory view, labelled and grouped. */
export function candidateStatusOptions(
  catalogue: CandidateStatusCatalogue | null,
  bucket: "active" | "rejected" | "all" = "all",
): { value: string; label: string; group: string }[] {
  if (!catalogue) return [];
  const groupLabel = new Map(catalogue.groups.map((g) => [g.key, g.label]));
  return catalogue.statuses
    .filter((s) => bucket === "all" || (bucket === "active" ? s.active : s.closed))
    .map((s) => ({ value: s.key, label: s.label, group: groupLabel.get(s.group) || s.group }));
}

/** The phase chip — "Technical Screening", "Customer Interviewing", "Closed". */
export function CandidateStageBadge({ status }: { status?: CandidateStatus | null }) {
  const stage = status?.stage;
  if (!stage?.label) return <span className="text-muted">—</span>;
  const closed = stage.key === "closed" || status?.group === "closed";
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ring-subtle ${
        closed ? STAGE_TONE.closed : STAGE_TONE[stage.key] || STAGE_TONE.sourcing}`}
      data-stage={stage.key}
    >
      {stage.label}
    </span>
  );
}

/** Row fields that carry each round's date (Applied Candidates rows). */
export const ROUND_WHEN_FIELDS: Record<string, string> = {
  ai_l1: "ai_interview_scheduled_at",
  manual_l1: "l1_manual_when",
  manual_l2: "l2_when",
  customer_l1: "cust_l1_when",
  customer_l2: "cust_l2_when",
  hr: "hr_when",
};

/** Row fields that name who took each round (30 Sep 2026) — the Status cell
 *  says "with <panel>". The AI L1 has no person; it reads "AI interviewer". */
export const ROUND_WHO_FIELDS: Record<string, string> = {
  manual_l1: "l1_manual_interviewer",
  manual_l2: "l2_interviewer",
  customer_l1: "cust_l1_interviewer",
  customer_l2: "cust_l2_interviewer",
  hr: "hr_interviewer",
};
const AI_ROUND_KEY = "ai_l1";
const AI_INTERVIEWER = "AI interviewer";

/** Waiting thresholds (days) — amber from 3, red from 7. */
export const WAITING_WARN_DAYS = 3;
export const WAITING_BAD_DAYS = 7;

export function waitingTone(days: number): CandidateStatusTone {
  return days >= WAITING_BAD_DAYS ? "bad" : days >= WAITING_WARN_DAYS ? "warn" : "neutral";
}

/** "Waiting 4 d" — how long the candidate has sat with whoever holds them
 *  (30 Sep 2026): the server's `waiting_days`, days since the candidacy's
 *  last activity, else since they applied. */
export function WaitingChip({ days, since }: { days?: number | null; since?: string | null }) {
  if (days == null) return null;
  const tone = CANDIDATE_STATUS_TONE[waitingTone(days)];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset ring-subtle ${tone}`}
      title={since ? `Nothing has happened since ${fmtDateTime12(since, since)}` : undefined}>
      <Hourglass size={11} aria-hidden /> {days === 0 ? "Today" : `Waiting ${days} d`}
    </span>
  );
}

/** The Status cell: the round, its state, and when it is / was (28 Sep 2026).
 *  Falls back to the plain status badge for a payload without a round.
 *  With `onOpen` the round's name and its panel become a link that opens the
 *  interviews pop-up; `waitingDays` adds the waiting chip (30 Sep 2026). */
export function CandidateRoundStatus({
  status, row, onOpen, waitingDays, waitingSince,
}: {
  status?: CandidateStatus | null;
  /** The list row — read for the round's date and panel (`ROUND_WHEN_FIELDS` / `ROUND_WHO_FIELDS`). */
  row?: Record<string, unknown>;
  onOpen?: () => void;
  waitingDays?: number | null;
  waitingSince?: string | null;
}) {
  if (!status?.round) {
    return (
      <div className="flex flex-col items-start gap-1">
        <CandidateStatusBadge status={status} />
        <WaitingChip days={waitingDays} since={waitingSince} />
      </div>
    );
  }
  const { key, label, state } = status.round;
  const field = key ? ROUND_WHEN_FIELDS[key] : undefined;
  const when = field && row ? (row[field] as string | null | undefined) : null;
  const whoField = key ? ROUND_WHO_FIELDS[key] : undefined;
  const who = key === AI_ROUND_KEY ? AI_INTERVIEWER
    : whoField && row ? ((row[whoField] as string | null | undefined) || null) : null;
  const tone = CANDIDATE_STATUS_TONE[status.tone] || CANDIDATE_STATUS_TONE.neutral;
  const chip = `inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ring-subtle ${tone}`;
  const name = onOpen ? (
    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }}
      className="text-left text-xs font-semibold text-brand-700 underline decoration-dotted underline-offset-2 hover:text-brand-800 dark:text-brand-300"
      title="Open every interview of this candidate">
      {label}
    </button>
  ) : <span className="text-xs font-semibold text-primary">{label}</span>;
  return (
    <div className="flex min-w-[10rem] flex-col items-start gap-1" title={status.hint || undefined}>
      {/* A round names itself and carries a state; anything else IS the state. */}
      {state ? (
        <>
          {name}
          <span className="flex flex-wrap items-center gap-1">
            <span className={chip}>{state}</span>
            <WaitingChip days={waitingDays} since={waitingSince} />
          </span>
        </>
      ) : (
        <span className="flex flex-wrap items-center gap-1">
          <span className={chip}>{label}</span>
          <WaitingChip days={waitingDays} since={waitingSince} />
        </span>
      )}
      {who && (
        <span className="inline-flex items-center gap-1 text-[11px] text-secondary">
          <UserRound size={11} aria-hidden /> with {who}
        </span>
      )}
      {when ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums text-secondary">
          {/* A time typed as free text (it never parsed) is shown as typed. */}
          <CalendarClock size={11} aria-hidden /> {fmtDateTime12(when, when)}
        </span>
      ) : field && state === "Scheduled" ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-warning"
          title="The round was booked without a date and time — edit it to add one">
          <CalendarClock size={11} aria-hidden /> Time not set
        </span>
      ) : null}
    </div>
  );
}

