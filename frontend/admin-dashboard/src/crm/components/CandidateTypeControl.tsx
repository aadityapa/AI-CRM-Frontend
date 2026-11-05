/**
 * Internal / External on the candidate profile (4 Nov 2026).
 *
 * Shows what this candidacy is and why (marked by TA · company email · employee
 * record), and lets TA / RMG / Sales / Sales Head / HR change it — the server
 * (`PUT /api/candidate-profiles/{id}/candidate-type`) refuses anyone else.
 * "Auto" hands the decision back to the email / employee record.
 */
import { useState } from "react";
import { Building2 } from "lucide-react";
import { crmPut } from "../api";
import { useHasRole } from "../CrmApp";
import { CandidateTypeChip } from "../lib/internalCandidate";

export type CandidateKind = {
  type: "Internal" | "External";
  source: "chosen" | "email" | "employee" | "default";
  employee_id: number | null;
};

const WHY: Record<CandidateKind["source"], string> = {
  chosen: "marked by TA",
  email: "company email address",
  employee: "matches an Employees record",
  default: "no company email or employee record",
};

export function CandidateTypeControl({ profileId, kind, chosen, onSaved, onError }: {
  profileId: number;
  kind: CandidateKind | null | undefined;
  chosen: string | null | undefined;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const canEdit = useHasRole("TA", "RMG", "Sales", "Sales_Head", "HR");
  const [busy, setBusy] = useState(false);
  if (!kind) return null;
  const save = async (value: string) => {
    setBusy(true);
    try {
      const res = await crmPut<{ candidate_type: string | null }>(
        `/api/candidate-profiles/${profileId}/candidate-type`, { candidate_type: value || null });
      onSaved(res.message || "Saved");
    } catch (e: any) {
      onError(e?.message || "Could not change the candidate type");
    } finally {
      setBusy(false);
    }
  };
  const internal = kind.type === "Internal";
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-card border px-4 py-2.5 text-xs ${
      internal ? "border-teal-200 bg-teal-50/60 dark:border-teal-800 dark:bg-teal-900/20" : "border-subtle bg-surface-2"}`}>
      <Building2 className={`h-4 w-4 ${internal ? "text-teal-600" : "text-muted"}`} aria-hidden />
      <CandidateTypeChip type={kind.type} chosen={kind.source === "chosen"} />
      <span className="text-secondary">{WHY[kind.source]}</span>
      {internal && (
        <span className="text-secondary">
          · After the Sales Head approves the terms, goes straight to Pre-Onboarding with the Employees
          details — no HR Discussion / HR Round.
        </span>
      )}
      {canEdit && (
        <label className="ml-auto inline-flex items-center gap-1.5 text-secondary">
          Type
          <select className="rounded-control border border-subtle bg-surface-1 px-2 py-1 text-xs text-primary"
            value={chosen || ""} disabled={busy} onChange={(e) => save(e.target.value)}
            aria-label="Candidate type">
            <option value="">Auto (email / employee record)</option>
            <option value="Internal">Internal</option>
            <option value="External">External</option>
          </select>
        </label>
      )}
    </div>
  );
}
