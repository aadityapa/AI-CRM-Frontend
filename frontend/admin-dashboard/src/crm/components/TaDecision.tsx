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
 *
 * The server applies every decision — `POST /api/candidate-profiles/{id}/
 * ta-decision` (B-V2 `services/candidate_profiles.ta_decision`) — and says
 * why when it refuses. `TaFlowButtons` decides which buttons a row offers;
 * `TaDecisionModal` asks for the reason and posts (the shared DecisionDialog).
 */
import {
  BellRing, EyeOff, Inbox, IndianRupee, LogOut, PauseCircle, PlayCircle, Route, Send, UserRoundCheck, XCircle,
} from "lucide-react";

import { crmPost } from "../api";
import { DecisionDialog, type DecisionSpec } from "./dialogKit";
import { FLOW_BTN } from "./flowButtons";

export type TaDecision = "screen" | "hold" | "release" | "reject" | "withdraw";

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
};

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
}): TaDecision[] {
  const stage = row.profile_status?.stage?.key
    ?? (TA_STAGES.includes(String(row.profile_pipeline_status || "")) ? SOURCING_STAGE : null);
  if (stage !== SOURCING_STAGE) return ["withdraw"];
  return row.budget_status === TA_HOLD
    ? ["release", "reject", "withdraw"]
    : ["screen", "hold", "reject", "withdraw"];
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
};

export function TaDecisionModal({
  profileId, candidateName, context, decision, overBudget, onClose, onDone,
}: {
  profileId: number;
  candidateName?: string | null;
  /** The position / opportunity, printed under the name. */
  context?: string | null;
  decision: TaDecision;
  /** Shown as context on Hold / Reject when the expected CTC is above the budget. */
  overBudget?: { expected?: number | null; budget?: number | null } | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  return (
    <DecisionDialog
      spec={DIALOG[decision]}
      person={candidateName ? { name: candidateName, meta: context || undefined } : null}
      notice={overBudget && (decision === "hold" || decision === "reject") ? (
        <p className="flex items-center gap-2 rounded-card bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <IndianRupee className="h-4 w-4 shrink-0" aria-hidden />
          <span>Expected CTC <b>{lakhs(overBudget.expected)}</b> against a budget of <b>{lakhs(overBudget.budget)}</b>.</span>
        </p>
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
