/**
 * Sales Head's approval step at Customer Approval.
 *
 * Sales records the offer terms and moves the profile to Customer Approved.
 * Sales Head then has one decision to make, so it gets a banner rather than
 * being buried in a generic status dropdown where "Preboarding" is one option
 * among four and nothing says what approving means.
 *
 * Mirrors RmgDecisionBanner, which does the same job one stage earlier.
 *
 * The terms are shown here because that is what is being approved — sending
 * someone to another tab to find the rate they are signing off is how
 * approvals become rubber stamps.
 */
import { useState } from "react";
import { BadgeCheck, IndianRupee, CalendarCheck2, X } from "lucide-react";

import { crmPost } from "../api";
import { ConfirmModal, btnPrimary, btnSecondary, inputCls } from "./ui";

export type OfferSummary = {
  ctc: number | null;
  joining_date: string | null;
  offer_date: string | null;
  status: string;
};

/** Minimum comment the server enforces on every transition. */
const MIN_COMMENT = 5;

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
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const transition = async (newStatus: string, successMsg: string) => {
    if (comment.trim().length < MIN_COMMENT) {
      setError(`Add a note of at least ${MIN_COMMENT} characters — it is recorded against the decision.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await crmPost(`/api/candidate-profiles/${profileId}/status-transition`, {
        new_status: newStatus,
        comment: comment.trim(),
      });
      showToast(successMsg);
      setMode(null);
      setComment("");
      onDone();
    } catch (e: any) {
      setError(e?.message || "Could not record the decision");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mb-4 rounded-card border border-brand-300 bg-brand-50 p-4 dark:border-brand-500/40 dark:bg-brand-900/20">
        <div className="flex flex-wrap items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
            <BadgeCheck size={18} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-primary">Offer awaiting your approval</h2>
            <p className="mt-0.5 text-sm text-secondary">
              Sales has proposed terms for <span className="font-semibold">{candidateName}</span>.
              Review them, edit anything that needs changing on this page, then approve —
              that moves the candidate into Preboarding and hands over to HR.
            </p>

            {offer ? (
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                <div className="flex items-center gap-1.5">
                  <IndianRupee size={13} className="text-muted" aria-hidden />
                  <dt className="text-xs text-muted">Offered CTC</dt>
                  <dd className="tnum text-sm font-bold text-primary">{fmtLac(offer.ctc)}</dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <CalendarCheck2 size={13} className="text-muted" aria-hidden />
                  <dt className="text-xs text-muted">Joining</dt>
                  <dd className="text-sm font-bold text-primary">
                    {offer.joining_date ? fmtDate(offer.joining_date) : "Not set"}
                  </dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <dt className="text-xs text-muted">Offered on</dt>
                  <dd className="text-sm font-semibold text-secondary">{fmtDate(offer.offer_date)}</dd>
                </div>
              </dl>
            ) : (
              /* Should be unreachable — the server refuses entry to Customer
                 Approval without an offer — but a banner asking someone to
                 approve nothing would be worse than a warning. */
              <p className="mt-3 rounded-control bg-warning-soft px-3 py-2 text-xs font-semibold text-warning">
                No offer is recorded on this profile. Add one on the Offers tab before approving.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button className={btnPrimary} onClick={() => { setMode("approve"); setError(""); }}>
              <BadgeCheck size={15} aria-hidden /> Approve
            </button>
            <button className={btnSecondary} onClick={() => { setMode("reject"); setError(""); }}>
              <X size={15} aria-hidden /> Reject
            </button>
          </div>
        </div>
      </div>

      {mode && (
        <ConfirmModal
          title={mode === "approve" ? "Approve these offer terms?" : "Reject this candidate?"}
          danger={mode === "reject"}
          confirmLabel={mode === "approve" ? "Approve and move to Preboarding" : "Reject"}
          busy={busy}
          error={error}
          onClose={() => { setMode(null); setComment(""); setError(""); }}
          onConfirm={() =>
            mode === "approve"
              ? transition("Preboarding", "Approved — moved to Preboarding, HR notified")
              : transition("Customer_Rejected", "Candidate rejected")
          }
          message={
            <div className="space-y-3 text-left">
              <p className="text-sm text-secondary">
                {mode === "approve"
                  ? `${candidateName} moves to Preboarding and HR is notified.`
                  : `${candidateName} moves to Customer Rejected. This is a terminal status.`}
              </p>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">
                  {mode === "approve" ? "Approval note" : "Reason"} (required)
                </span>
                <textarea
                  autoFocus
                  rows={3}
                  className={inputCls}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={
                    mode === "approve"
                      ? "e.g. Terms agreed with the customer, joining date confirmed"
                      : "Why is this candidate being rejected?"
                  }
                />
              </label>
            </div>
          }
        />
      )}
    </>
  );
}
