/**
 * Internal vs External candidates (4 Nov 2026; server: services/internal_candidates.py).
 *
 * An address on a company domain (karnex.in by default — the server reads Settings
 * `hiring.internal_email_domains`) makes a candidate INTERNAL unless TA chose
 * otherwise. After the Sales Head approves the terms, an internal candidate goes
 * straight to Pre-Onboarding with the Employees record's details — no HR rounds.
 */
import { Building2, Globe2 } from "lucide-react";

export type CandidateType = "Internal" | "External";
export const CANDIDATE_TYPES: CandidateType[] = ["Internal", "External"];
export const COMPANY_DOMAINS = ["karnex.in"];

/** PURE mirror of the server's `email_is_internal` (domain or a sub-domain). */
export function isCompanyEmail(email: string | null | undefined, domains = COMPANY_DOMAINS): boolean {
  const addr = (email || "").trim().toLowerCase();
  const at = addr.lastIndexOf("@");
  if (at < 0) return false;
  const host = addr.slice(at + 1);
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** What the candidate is: TA's choice wins, else the email decides. PURE. */
export function effectiveType(chosen: string | null | undefined, email: string | null | undefined): CandidateType {
  if (chosen === "Internal" || chosen === "External") return chosen;
  return isCompanyEmail(email) ? "Internal" : "External";
}

export function CandidateTypeChip({ type, chosen, className = "" }: {
  type: string | null | undefined; chosen?: boolean; className?: string;
}) {
  if (type !== "Internal" && type !== "External") return null;
  const internal = type === "Internal";
  const Icon = internal ? Building2 : Globe2;
  return (
    <span
      title={internal
        ? `Internal candidate${chosen ? " (marked by TA)" : " (company email / employee record)"} — after the Sales Head's approval goes straight to Pre-Onboarding`
        : `External candidate${chosen ? " (marked by TA)" : ""}`}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
        internal ? "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-900/40 dark:text-teal-200 dark:ring-teal-800"
          : "bg-surface-2 text-secondary ring-subtle"} ${className}`}>
      <Icon className="h-3 w-3" aria-hidden /> {type}
    </span>
  );
}
