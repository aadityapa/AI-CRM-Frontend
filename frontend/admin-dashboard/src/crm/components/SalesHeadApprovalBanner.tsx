/**
 * Sales Head's approval step at "Pending Sales Head Approval".
 *
 * Sales submitted the candidate's rate and the customer onboarding date.
 * Sales Head has one decision to make, so it gets a banner rather than being
 * buried in a generic status dropdown. Three outcomes (2 Sep 2026): approve
 * (→ Pre Onboarding, HR notified), send the terms BACK to Sales to redo (a
 * wrong rate is not a rejected candidate), or reject.
 *
 * The terms are shown here because that is what is being approved — sending
 * someone to another tab to find the rate they are signing off is how
 * approvals become rubber stamps. The modals live in OfferApprovalGate so the
 * Applied Candidates tab offers the identical decision.
 */
import { useState } from "react";
import { BadgeCheck, IndianRupee, CalendarCheck2, Undo2, X } from "lucide-react";

import { btnPrimary, btnSecondary } from "./ui";
import { SalesHeadDecisionModal, type SalesHeadDecision } from "./OfferApprovalGate";

export type OfferSummary = {
  ctc: number | null;
  joining_date: string | null;
  offer_date: string | null;
  status: string;
  rate_unit?: string | null;
  rate_value?: number | null;
};

export function SalesHeadApprovalBanner({
  profileId,
  offer,
  candidateName,
  fmtLac,
  fmtDate,
  onDone,
  showToast,
}: {
  profileId: number;
  /** Newest offer on the profile, or null when none has been recorded. */
  offer: OfferSummary | null;
  candidateName: string;
  fmtLac: (v?: number | null) => string;
  fmtDate: (v?: string | null) => string;
  onDone: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const [mode, setMode] = useState<SalesHeadDecision | null>(null);

  return (
    <>
      <div className="mb-4 rounded-card border border-brand-300 bg-brand-50 p-4 dark:border-brand-500/40 dark:bg-brand-900/20">
        <div className="flex flex-wrap items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
            <BadgeCheck size={18} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-primary">Offer terms awaiting your approval</h2>
            <p className="mt-0.5 text-sm text-secondary">
              Sales has proposed terms for <span className="font-semibold">{candidateName}</span>.
              Approve to move them into Pre Onboarding and hand over to HR, send the terms back
              to Sales to redo, or reject.
            </p>

            {offer ? (
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                <div className="flex items-center gap-1.5">
                  <IndianRupee size={13} className="text-muted" aria-hidden />
                  <dt className="text-xs text-muted">Rate</dt>
                  <dd className="tnum text-sm font-bold text-primary">
                    {/* As Sales quoted it; the annual figure is derived. */}
                    {offer.rate_value != null && offer.rate_unit && offer.rate_unit !== "Yearly"
                      ? <>₹{offer.rate_value.toLocaleString("en-IN", { maximumFractionDigits: 0 })} {offer.rate_unit.toLowerCase()}
                          <span className="ml-1 text-xs font-normal text-muted">≈ {fmtLac(offer.ctc)} L / yr</span></>
                      : <>{fmtLac(offer.ctc)} L</>}
                  </dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <CalendarCheck2 size={13} className="text-muted" aria-hidden />
                  <dt className="text-xs text-muted">Customer onboarding</dt>
                  <dd className="text-sm font-bold text-primary">
                    {offer.joining_date ? fmtDate(offer.joining_date) : "Not set"}
                  </dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <dt className="text-xs text-muted">Submitted on</dt>
                  <dd className="text-sm font-semibold text-secondary">{fmtDate(offer.offer_date)}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-3 rounded-control bg-warning-soft px-3 py-2 text-xs font-semibold text-warning">
                No offer is recorded on this profile. Send it back so Sales can submit the terms.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button className={btnPrimary} onClick={() => setMode("approve")} disabled={!offer}>
              <BadgeCheck size={15} aria-hidden /> Approve
            </button>
            <button className={btnSecondary} onClick={() => setMode("send_back")}>
              <Undo2 size={15} aria-hidden /> Send back
            </button>
            <button className={btnSecondary} onClick={() => setMode("reject")}>
              <X size={15} aria-hidden /> Reject
            </button>
          </div>
        </div>
      </div>

      {mode && (
        <SalesHeadDecisionModal
          profileId={profileId}
          candidateName={candidateName}
          decision={mode}
          terms={offer}
          onClose={() => setMode(null)}
          onDone={(msg) => { setMode(null); showToast(msg); onDone(); }}
        />
      )}
    </>
  );
}
