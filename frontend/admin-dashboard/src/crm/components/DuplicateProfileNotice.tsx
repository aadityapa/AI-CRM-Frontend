/**
 * "Already applied" — the structured 409 from POST /api/candidate-profiles.
 *
 * The server answers a duplicate apply with WHO applied the candidate, WHEN,
 * the current stage and the profile id (user decision, 25 Aug 2026). Until
 * 7 Sep 2026 only ApplyToOpportunityModal rendered it; the Suggested
 * Candidates apply, the bulk apply and the New Profile modal all dropped the
 * payload and showed a bare sentence. One helper + one card, used by all.
 */
import React from "react";
import { CrmLink } from "../routerHooks";

export type DuplicateProfile = {
  profile_id: number;
  candidate_name?: string | null;
  applied_by?: string | null;
  applied_on?: string | null;
  pipeline_status?: string | null;
};

/** Pull the structured duplicate payload out of a CrmApiError, if present. */
export function duplicateProfileFromError(e: any): DuplicateProfile | null {
  if (!e || e.status !== 409) return null;
  const hit = (e.errors || []).find((x: any) => x && typeof x === "object" && x.duplicate_profile);
  return hit ? (hit.duplicate_profile as DuplicateProfile) : null;
}

/** One-line summary for toasts and lists (no link possible there). */
export function duplicateProfileSummary(d: DuplicateProfile): string {
  const who = d.applied_by ? ` by ${d.applied_by}` : "";
  const when = d.applied_on ? ` on ${new Date(d.applied_on).toLocaleDateString()}` : "";
  const stage = d.pipeline_status ? ` — at ${String(d.pipeline_status).replace(/_/g, " ")}` : "";
  return `${d.candidate_name || "This candidate"} was already applied${who}${when}${stage}`;
}

export function DuplicateProfileNotice({ dup, compact }: { dup: DuplicateProfile; compact?: boolean }) {
  return (
    <div className={`rounded-card border border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300 ${compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"}`}>
      {!compact && <div className="font-bold">Already applied to this opportunity</div>}
      <div className={compact ? "" : "mt-1"}>
        <b>{dup.candidate_name || "This candidate"}</b> was applied
        {dup.applied_by ? <> by <b>{dup.applied_by}</b></> : null}
        {dup.applied_on ? <> on {new Date(dup.applied_on).toLocaleDateString()}</> : null}
        {dup.pipeline_status ? <> — currently at {String(dup.pipeline_status).replace(/_/g, " ")}</> : null}.
        {" "}
        <CrmLink to={`profiles/${dup.profile_id}`} className="font-semibold underline">
          Open the existing profile →
        </CrmLink>
      </div>
    </div>
  );
}
