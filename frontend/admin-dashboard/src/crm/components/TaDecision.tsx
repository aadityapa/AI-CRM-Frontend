/**
 * TA's buttons on an Applied Candidates row (28 Sep 2026, user flow).
 *
 * An upload lands at SOURCING, with TA. From the row TA then:
 *   Technical Screening → hands the candidate to RMG / GM (they Shortlist /
 *                         Reject on the Screening Desk and choose the L1)
 *   Hold                → parks them (not reachable, over budget …)
 *   Release hold        → back into the flow
 *   Reject              → closes the candidacy ("Rejected by TA")
 *   Self Withdraw       → the candidate is not interested (any live stage)
 *   Re-apply            → a withdrawn candidate is interested again: the
 *                         candidacy reopens at Sourcing (1 Oct 2026)
 *   Interested /        → the candidate answered the opening email a bulk
 *   Not interested        upload sends (1 Oct 2026): yes = details confirmed
 *                         and on to Technical Screening; no = Self Withdrawn
 *
 * The server applies every decision — `POST /api/candidate-profiles/{id}/
 * ta-decision` (B-V2 `services/candidate_profiles.ta_decision`) — and says
 * why when it refuses. `TaFlowButtons` decides which buttons a row offers;
 * `TaDecisionModal` asks for the reason and posts (the shared DecisionDialog).
 */
import { useState } from "react";
import {
  AlertTriangle, BellRing, EyeOff, Inbox, IndianRupee, LogOut, Mail, MailCheck, PauseCircle, Pencil, PlayCircle,
  RotateCcw, Route, Send, ThumbsDown, ThumbsUp, UserRoundCheck, XCircle,
} from "lucide-react";

import { crmPost } from "../api";
import { DecisionDialog, type DecisionSpec } from "./dialogKit";
import { FLOW_BTN } from "./flowButtons";

export type TaDecision = "screen" | "hold" | "release" | "reject" | "withdraw" | "reapply"
  | "interested" | "not_interested";

/** The opening email and the candidate's answer — `opening_mail` on an
 *  Applied Candidates row (B-V2 `services/opening_interest.opening_states`). */
export type OpeningMail = {
  state: "sent" | "interested" | "not_interested";
  at?: string | null;
  note?: string | null;
};

/** The TA hold value of `budget_status` (mirror of B-V2 `candidate_status.TA_HOLD`). */
export const TA_HOLD = "TA_Hold";

/** Stored stages a candidate can be in before RMG Review (fallback only). */
export const TA_STAGES = ["Sourcing", "Technical_Screening"];

/** The derived phase TA owns (mirror of B-V2 `candidate_status.SOURCING_STAGE`). */
export const SOURCING_STAGE = "sourcing";

const MIN_REASON = 5;

const DECISIONS: Record<TaDecision, {
  label: string; title: string; help: string; icon: typeof Send; cls: string;
  reason: "required" | "optional"; placeholder: string;
}> = {
  screen: {
    label: "Technical Screening", title: "Send for Technical Screening", icon: Send, cls: FLOW_BTN.primary,
    help: "RMG / GM review the CV and the ATS score, then Shortlist or Reject. When they shortlist they "
      + "choose the AI or manual L1 and you are told which to schedule.",
    reason: "optional", placeholder: "e.g. Strong AUTOSAR background, can join in 30 days",
  },
  hold: {
    label: "Hold", title: "Put the candidate on hold", icon: PauseCircle, cls: FLOW_BTN.warn,
    help: "Nobody screens or interviews a held candidate until you release the hold.",
    reason: "optional", placeholder: "e.g. Not picking up calls · asking 18 L against 16 L",
  },
  release: {
    label: "Release hold", title: "Release the hold", icon: PlayCircle, cls: FLOW_BTN.success,
    help: "The candidate goes back to where they were.",
    reason: "optional", placeholder: "e.g. Candidate called back",
  },
  reject: {
    label: "Reject", title: "Reject the candidate", icon: XCircle, cls: FLOW_BTN.danger,
    help: "Closes the candidacy for this opportunity. It reads \"Rejected by TA\" everywhere.",
    reason: "required", placeholder: "e.g. Expected CTC far above the budget",
  },
  withdraw: {
    label: "Self Withdraw", title: "Record that the candidate withdrew", icon: LogOut, cls: FLOW_BTN.withdraw,
    help: "The candidate is not interested any more — the candidacy closes as Self Withdrawn.",
    reason: "required", placeholder: "e.g. Accepted another offer",
  },
  reapply: {
    label: "Re-apply", title: "Apply to this opportunity again", icon: RotateCcw, cls: FLOW_BTN.success,
    help: "The candidate is considered again — the candidacy reopens at Sourcing with you, "
      + "ready for Technical Screening. Their interview history and the earlier closing note stay.",
    reason: "optional", placeholder: "e.g. Candidate called back, the other offer fell through",
  },
  interested: {
    label: "Interested", title: "The candidate is interested", icon: ThumbsUp, cls: FLOW_BTN.success,
    help: "The candidate replied yes to the opening email. Confirm their details, then they go to "
      + "RMG / GM for Technical Screening.",
    reason: "optional", placeholder: "e.g. Confirmed on call — 30 days notice, expects 14 L",
  },
  not_interested: {
    label: "Not interested", title: "The candidate is not interested", icon: ThumbsDown, cls: FLOW_BTN.withdraw,
    help: "The candidate said no to the opening — the candidacy closes as Self Withdrawn.",
    reason: "optional", placeholder: "e.g. Not looking for a change right now",
  },
};

/** Who closed the candidacy and why — `closed_note` on an Applied Candidates
 *  row (server `candidate_status.closing_notes`, 1 Oct 2026). */
export type ClosedNote = {
  status: string;
  reason?: string | null;
  by?: string | null;
  by_id?: number | null;
  at?: string | null;
};

/** The rose "why" box printed on a rejected / withdrawn row and inside the
 *  Re-apply dialog — the user rule: whoever rejects writes why, and the
 *  Rejected filter shows it. */
export function ClosedNoteBox({ note, compact }: { note: ClosedNote; compact?: boolean }) {
  const withdrew = note.status === "Self_Withdrawn";
  const when = note.at ? new Date(note.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
  const who = [note.by, when].filter(Boolean).join(" · ");
  return (
    <div className={`rounded-card border px-3 py-2 text-xs ${withdrew
      ? "border-slate-200 bg-surface-2 text-secondary dark:border-slate-700"
      : "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"}`}
      title={who ? `${withdrew ? "Recorded" : "Rejected"} by ${who}` : undefined}>
      <div className="font-semibold">
        {withdrew ? "Withdrew" : "Rejected"}{who ? ` — ${who}` : ""}
      </div>
      {note.reason && (
        <div className={`mt-0.5 leading-relaxed ${compact ? "line-clamp-2" : ""}`}>{note.reason}</div>
      )}
    </div>
  );
}

/** "₹18.0 L" — the unit TA reads budgets in. */
function lakhs(v: number | null | undefined): string {
  return v == null ? "—" : `₹${(v / 100000).toFixed(1)} L`;
}

/** The amber "Over budget" chip a row shows beside the candidate. */
export function OverBudgetChip({ expected, budget }: { expected?: number | null; budget?: number | null }) {
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning ring-1 ring-inset ring-subtle"
      title={`Expected CTC ${lakhs(expected)} is above the position's budget of ${lakhs(budget)}`}
    >
      <IndianRupee size={11} aria-hidden /> Over budget · {lakhs(expected)} vs {lakhs(budget)}
    </span>
  );
}

/** The stored stages of a closed candidacy (the server's `REJECTED_BUCKET`). */
export const CLOSED_CANDIDACY_STATUSES = [
  "Rejected", "Sales_Rejected", "RMG_Rejected", "Customer_Rejected", "Customer_Screen_Rejected",
  "Customer_L1_Rejected", "Customer_L2_Rejected", "Self_Withdrawn",
] as const;
export const isClosedCandidacy = (status?: string | null) =>
  CLOSED_CANDIDACY_STATUSES.includes(String(status || "") as (typeof CLOSED_CANDIDACY_STATUSES)[number]);

/** Which TA buttons a row offers, in the order they read. PURE.
 *
 *  Technical Screening · Hold · Reject belong to the SOURCING phase (28 Sep
 *  2026, user rule) — read from the server's derived stage, not the stored
 *  pipeline value: a candidate with an L1 already booked reads "Technical
 *  Interview" even while the stored stage is still Sourcing. Past Sourcing
 *  only Self Withdraw is TA's to record. The server applies the same rule. */
export function taDecisionsFor(row: {
  profile_status?: { stage?: { key: string } | null } | null;
  profile_pipeline_status?: string | null;
  budget_status?: string | null;
  opening_mail?: OpeningMail | null;
}): TaDecision[] {
  // A closed candidacy can come back (1 Oct 2026): a withdrawal freely, a
  // rejection with a reason (the server asks for one) — the only TA button
  // on a closed row.
  if (isClosedCandidacy(row.profile_pipeline_status)) return ["reapply"];
  const stage = row.profile_status?.stage?.key
    ?? (TA_STAGES.includes(String(row.profile_pipeline_status || "")) ? SOURCING_STAGE : null);
  if (stage !== SOURCING_STAGE) return ["withdraw"];
  if (row.budget_status === TA_HOLD) return ["release", "reject", "withdraw"];
  // The opening email went out and the reply is awaited: the candidate's
  // answer IS the next step (Interested sends for screening, Not interested
  // withdraws), so those two replace Technical Screening / Self Withdraw.
  return row.opening_mail?.state === "sent"
    ? ["interested", "not_interested", "hold", "reject"]
    : ["screen", "hold", "reject", "withdraw"];
}

/** "Opening email sent · 2 d ago" / "Interested" / "Not interested" — the
 *  state of the opening email on a row, under the Status. */
export function OpeningMailChip({ mail }: { mail?: OpeningMail | null }) {
  if (!mail) return null;
  const when = mail.at ? new Date(mail.at) : null;
  const days = when ? Math.max(0, Math.floor((Date.now() - when.getTime()) / 86_400_000)) : null;
  const ago = days == null ? "" : days === 0 ? "today" : `${days} d ago`;
  const look = {
    sent: { cls: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-800",
      icon: <Mail size={11} aria-hidden />, text: `Opening email sent${ago ? ` · ${ago}` : ""} — awaiting reply` },
    interested: { cls: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800",
      icon: <ThumbsUp size={11} aria-hidden />, text: "Replied: interested" },
    not_interested: { cls: "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-800",
      icon: <ThumbsDown size={11} aria-hidden />, text: "Replied: not interested" },
  }[mail.state];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${look.cls}`}
      title={mail.note || undefined}>
      {look.icon} {look.text}
    </span>
  );
}

/** "Opening email" / "Resend" on a Sourcing row — the same mail a bulk upload
 *  sends, for a single upload, a held duplicate applied later, or after TA
 *  corrected a wrong address (`POST …/opening-email`). */
export function SendOpeningMailButton({ profileId, resend, disabled, onDone }: {
  profileId: number;
  resend?: boolean;
  disabled?: boolean;
  onDone: (message: string, ok: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className={resend ? FLOW_BTN.neutral : FLOW_BTN.view} disabled={disabled || busy}
      title={resend ? "Send the opening email again (e.g. after correcting the address)"
        : "Email the candidate about this opening and ask whether they are interested"}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await crmPost(`/api/candidate-profiles/${profileId}/opening-email`, { resend: !!resend });
          onDone(res.message || "Opening email sent", true);
        } catch (e: any) {
          onDone(e?.message || "Could not send the opening email", false);
        } finally {
          setBusy(false);
        }
      }}>
      {resend ? <MailCheck size={13} aria-hidden /> : <Mail size={13} aria-hidden />}
      {busy ? "Sending…" : resend ? "Resend email" : "Opening email"}
    </button>
  );
}

/** One line of what TA confirms before an Interested candidate goes on. */
export type ConfirmDetail = { label: string; value?: string | null };

function ConfirmDetails({ details, onEdit }: { details: ConfirmDetail[]; onEdit?: () => void }) {
  const missing = details.filter((d) => !String(d.value ?? "").trim()).length;
  return (
    <div className="rounded-card border border-subtle bg-surface-2 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-muted">Confirm the details from their reply</span>
        {onEdit && (
          <button type="button" className={FLOW_BTN.edit} onClick={onEdit}>
            <Pencil size={12} aria-hidden /> Edit details
          </button>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
        {details.map((d) => {
          const v = String(d.value ?? "").trim();
          return (
            <div key={d.label} className="flex min-w-0 items-baseline justify-between gap-2 border-b border-subtle pb-1">
              <dt className="shrink-0 text-xs text-muted">{d.label}</dt>
              <dd className={`truncate text-right font-medium ${v ? "text-primary" : "text-warning"}`} title={v || undefined}>
                {v || "Not captured"}
              </dd>
            </div>
          );
        })}
      </dl>
      {missing > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
          <AlertTriangle size={12} aria-hidden /> {missing} detail{missing === 1 ? "" : "s"} missing — fill them
          with Edit details before you send, or note them below.
        </p>
      )}
    </div>
  );
}

/** The row's TA buttons. `onPick` opens the dialog for that decision. */
export function TaFlowButtons({ decisions, onPick, disabled }: {
  decisions: TaDecision[];
  onPick: (d: TaDecision) => void;
  disabled?: boolean;
}) {
  return (
    <>
      {decisions.map((d) => {
        const spec = DECISIONS[d];
        const Icon = spec.icon;
        return (
          <button key={d} type="button" className={spec.cls} disabled={disabled}
            onClick={() => onPick(d)} title={spec.help}>
            <Icon size={13} aria-hidden /> {spec.label}
          </button>
        );
      })}
    </>
  );
}

/** The dialog's words per decision (30 Sep 2026 redesign — `dialogKit.DecisionDialog`). */
const DIALOG: Record<TaDecision, DecisionSpec> = {
  screen: {
    tone: "brand", icon: Send, eyebrow: "Hand over to RMG / GM", title: "Send for Technical Screening",
    intro: DECISIONS.screen.help,
    flow: { steps: ["Sourcing", "Technical Screening", "Technical Interview"], current: 1 },
    reason: { label: "Note for RMG / GM", placeholder: DECISIONS.screen.placeholder,
      picks: ["Strong skill match", "Can join early", "Within budget", "Referred by an employee"] },
    happens: [
      { icon: Inbox, text: "Lands on the RMG / GM Screening Desk under \"To screen\"." },
      { icon: BellRing, text: "RMG and GM are notified — your note travels with the candidate." },
      { icon: Route, text: "When they shortlist, they pick the AI or manual L1 and you are told what to schedule." },
    ],
    confirmLabel: "Send for screening", busyLabel: "Sending…",
  },
  hold: {
    tone: "amber", icon: PauseCircle, eyebrow: "Pause the candidacy", title: "Put the candidate on hold",
    intro: DECISIONS.hold.help,
    reason: { label: "Why on hold", placeholder: DECISIONS.hold.placeholder,
      picks: ["Not reachable", "Over the budget", "Candidate asked for time", "Awaiting documents"] },
    happens: [
      { icon: PauseCircle, text: "Reads \"On Hold\" on every screen and stays with you at Sourcing." },
      { icon: EyeOff, text: "Kept off the Screening Desk — nobody screens or interviews them." },
      { icon: PlayCircle, text: "Release the hold from the row whenever you are ready." },
    ],
    confirmLabel: "Put on hold", busyLabel: "Saving…",
  },
  release: {
    tone: "emerald", icon: PlayCircle, eyebrow: "Back into the flow", title: "Release the hold",
    intro: DECISIONS.release.help,
    reason: { label: "Note", placeholder: DECISIONS.release.placeholder,
      picks: ["Candidate called back", "Budget approved", "Documents received"] },
    happens: [
      { icon: PlayCircle, text: "The candidate is back at Sourcing, ready for Technical Screening." },
      { icon: Send, text: "Press Technical Screening on the row to hand them to RMG / GM." },
    ],
    confirmLabel: "Release hold", busyLabel: "Releasing…",
  },
  reject: {
    tone: "rose", icon: XCircle, eyebrow: "Close the candidacy", title: "Reject the candidate",
    intro: DECISIONS.reject.help,
    flow: { steps: ["Sourcing", "Rejected by TA"], current: 1 },
    reason: { label: "Reason", required: true, min: MIN_REASON, placeholder: DECISIONS.reject.placeholder,
      picks: ["Expected CTC far above the budget", "Skills do not match the JD", "Not reachable after several attempts", "Notice period too long"] },
    happens: [
      { icon: XCircle, text: "Reads \"Rejected by TA\" on every screen; the reason goes on the activity log." },
      { icon: BellRing, text: "RMG and GM are told." },
      { icon: UserRoundCheck, text: "The candidate stays in the Candidates master for other positions." },
    ],
    confirmLabel: "Reject candidate", busyLabel: "Rejecting…",
  },
  withdraw: {
    tone: "fuchsia", icon: LogOut, eyebrow: "The candidate stepped back", title: "Record Self Withdraw",
    intro: DECISIONS.withdraw.help,
    flow: { steps: ["In the pipeline", "Self Withdrawn"], current: 1 },
    reason: { label: "Why they withdrew", required: true, min: MIN_REASON, placeholder: DECISIONS.withdraw.placeholder,
      picks: ["Accepted another offer", "Not interested in the role", "Relocation not possible", "Counter-offer from current employer"] },
    happens: [
      { icon: LogOut, text: "The candidacy closes as \"Self Withdrawn\", with the stage they left from." },
      { icon: BellRing, text: "RMG, GM and the people working this position are told." },
      { icon: UserRoundCheck, text: "The candidate stays in the Candidates master for other positions." },
    ],
    confirmLabel: "Record Self Withdraw", busyLabel: "Saving…",
  },
  reapply: {
    tone: "emerald", icon: RotateCcw, eyebrow: "Back in the running", title: "Apply to this opportunity again",
    intro: DECISIONS.reapply.help,
    flow: { steps: ["Closed", "Sourcing", "Technical Screening"], current: 1 },
    reason: { label: "Why consider them again", placeholder: DECISIONS.reapply.placeholder,
      picks: ["Candidate called back", "The other offer fell through", "Notice period sorted out",
              "Budget revised by the customer", "Rejection reason no longer applies"] },
    happens: [
      { icon: RotateCcw, text: "The candidacy reopens at Sourcing — it reads \"Sourcing\" again on every screen." },
      { icon: Send, text: "Press Technical Screening on the row to hand them to RMG / GM afresh." },
      { icon: UserRoundCheck, text: "Earlier interviews and notes stay on the activity log." },
    ],
    confirmLabel: "Re-apply", busyLabel: "Reopening…",
  },
  interested: {
    tone: "emerald", icon: ThumbsUp, eyebrow: "Replied to the opening email", title: "Interested — send for Technical Screening",
    intro: DECISIONS.interested.help,
    flow: { steps: ["Opening email", "Interested", "Technical Screening"], current: 1 },
    reason: { label: "Note for RMG / GM", placeholder: DECISIONS.interested.placeholder,
      picks: ["Details confirmed on call", "Confirmed by email", "Can join early", "Within budget"] },
    happens: [
      { icon: ThumbsUp, text: "Their reply is recorded on the candidate's history." },
      { icon: Inbox, text: "They land on the RMG / GM Screening Desk under \"To screen\" — RMG and GM are told." },
      { icon: Route, text: "When RMG / GM shortlist, they pick the AI or manual L1 and you are told what to schedule." },
    ],
    confirmLabel: "Confirm & send for screening", busyLabel: "Sending…",
  },
  not_interested: {
    tone: "fuchsia", icon: ThumbsDown, eyebrow: "Replied to the opening email", title: "Not interested",
    intro: DECISIONS.not_interested.help,
    flow: { steps: ["Opening email", "Not interested", "Self Withdrawn"], current: 2 },
    reason: { label: "What they said", placeholder: DECISIONS.not_interested.placeholder,
      picks: ["Not looking for a change", "Location does not suit", "Expected CTC far above", "Already holding an offer"] },
    happens: [
      { icon: LogOut, text: "The candidacy closes as \"Self Withdrawn\" — their answer is the reason." },
      { icon: UserRoundCheck, text: "The candidate stays in the Candidates master for other positions." },
      { icon: RotateCcw, text: "Re-apply on the row reopens it if they come back." },
    ],
    confirmLabel: "Record not interested", busyLabel: "Saving…",
  },
};

export function TaDecisionModal({
  profileId, candidateName, context, decision, overBudget, closedNote, rejected, details, onEditDetails,
  onClose, onDone,
}: {
  /** Interested (1 Oct 2026): the details TA confirms from the reply. */
  details?: ConfirmDetail[] | null;
  /** Opens the applicant editor to fix a missing / wrong detail. */
  onEditDetails?: () => void;
  profileId: number;
  candidateName?: string | null;
  /** The position / opportunity, printed under the name. */
  context?: string | null;
  decision: TaDecision;
  /** Re-apply (1 Oct 2026): why the candidacy was closed, shown as context. */
  closedNote?: ClosedNote | null;
  /** Re-apply over a REJECTION needs a reason (the server refuses without one). */
  rejected?: boolean;
  /** Shown as context on Hold / Reject when the expected CTC is above the budget. */
  overBudget?: { expected?: number | null; budget?: number | null } | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const spec = decision === "reapply" && rejected
    ? { ...DIALOG.reapply, flow: { steps: ["Rejected", "Sourcing", "Technical Screening"], current: 1 },
        reason: { ...DIALOG.reapply.reason, required: true, min: 5 } }
    : DIALOG[decision];
  return (
    <DecisionDialog
      spec={spec}
      person={candidateName ? { name: candidateName, meta: context || undefined } : null}
      notice={overBudget && (decision === "hold" || decision === "reject") ? (
        <p className="flex items-center gap-2 rounded-card bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <IndianRupee className="h-4 w-4 shrink-0" aria-hidden />
          <span>Expected CTC <b>{lakhs(overBudget.expected)}</b> against a budget of <b>{lakhs(overBudget.budget)}</b>.</span>
        </p>
      ) : decision === "reapply" && closedNote ? (
        <ClosedNoteBox note={closedNote} />
      ) : decision === "interested" && details?.length ? (
        <ConfirmDetails details={details} onEdit={onEditDetails} />
      ) : null}
      onClose={onClose}
      onConfirm={async (note) => {
        const res = await crmPost(`/api/candidate-profiles/${profileId}/ta-decision`, {
          decision, note: note || undefined,
        });
        onDone(res.message || "Saved");
      }}
    />
  );
}
