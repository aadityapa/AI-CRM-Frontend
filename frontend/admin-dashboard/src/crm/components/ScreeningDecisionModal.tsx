/**
 * RMG / GM's screening call — Shortlist or Reject (30 Sep 2026 redesign on
 * `dialogKit.DecisionDialog`). ONE dialog for the Screening Desk and the
 * Applied Candidates row; they used to be two copies with different words.
 * POST /api/candidate-profiles/{id}/rmg-screening {decision, note}.
 */
import { BellRing, Bot, CheckCircle2, Route, Send, ThumbsUp, UserRoundCheck, Users, XCircle } from "lucide-react";

import { crmPost } from "../api";
import { DecisionDialog, DialogHero, type DecisionSpec } from "./dialogKit";

export type ScreeningDecision = "Shortlisted" | "Rejected";
/** The L1 route chosen WITH the shortlist (30 Sep 2026, user ask: "Shortlist for AI
 *  Round" / "Shortlist for Manual L1 Round" instead of a bare shortlist + a second
 *  step). `undefined` keeps the old two-step flow (Applied Candidates). */
export type ShortlistRoute = "ai" | "manual";

/** The server's minimum for a rejection note (B-V2 MIN_COMMENT_LENGTH). */
export const MIN_REJECT_NOTE = 5;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** `ta` is lower-case ("the TA (Tara)") — capitalised where it starts a sentence. */
function specFor(decision: ScreeningDecision, ta: string, position?: string | null, route?: ShortlistRoute): DecisionSpec {
  if (decision === "Rejected") {
    return {
      tone: "rose", icon: XCircle, eyebrow: "Technical screening", title: "Reject at screening",
      intro: <>Closes the candidate at RMG screening{position ? <> for <b>{position}</b></> : null}. {cap(ta)} is told why.</>,
      flow: { steps: ["Technical Screening", "RMG Rejected"], current: 1 },
      reason: { label: "Reason", required: true, min: MIN_REJECT_NOTE,
        placeholder: "Why is this candidate not a fit?",
        picks: ["Skills do not match the JD", "Experience outside the band", "Weak ATS match", "Communication concerns in the CV"] },
      happens: [
        { icon: XCircle, text: "Reads \"RMG Rejected\" on every screen; the reason goes on the activity log." },
        { icon: BellRing, text: `${cap(ta)} is notified with your reason.` },
        { icon: UserRoundCheck, text: "The candidate stays in the Candidates master for other positions." },
      ],
      confirmLabel: "Reject & notify TA", busyLabel: "Rejecting…",
    };
  }
  if (route === "ai") {
    return {
      tone: "purple", icon: Bot, eyebrow: "Technical screening", title: "Shortlist for the AI round",
      intro: <>Clears the candidate{position ? <> for <b>{position}</b></> : null} and puts them on the <b>AI L1</b>
        route — {ta} schedules the AI interview and the candidate gets the link.</>,
      flow: { steps: ["Technical Screening", "Shortlisted", "AI L1"], current: 1 },
      reason: { label: "Note for the TA", placeholder: "Anything the TA should know before scheduling",
        picks: ["Strong skill match", "Good ATS score", "Probe the notice period", "Check the expected CTC"] },
      happens: [
        { icon: CheckCircle2, text: "Reads \"AI L1 – Yet to Schedule\" on every screen." },
        { icon: Bot, text: "The AI interview asks from this position's JD; you review the verdict here when it is done." },
        { icon: BellRing, text: `${cap(ta)} is notified to schedule it.` },
      ],
      confirmLabel: "Shortlist for AI round", busyLabel: "Shortlisting…",
    };
  }
  if (route === "manual") {
    return {
      tone: "indigo", icon: Users, eyebrow: "Technical screening", title: "Shortlist for the manual L1 round",
      intro: <>Clears the candidate{position ? <> for <b>{position}</b></> : null} and puts them on the <b>manual L1</b>
        route — {ta} books the Technical L1 with a Karnex panel; no AI interview.</>,
      flow: { steps: ["Technical Screening", "Shortlisted", "Technical L1"], current: 1 },
      reason: { label: "Note for the TA", placeholder: "Who should take the L1, when, anything to probe",
        picks: ["Strong skill match", "Probe the notice period", "Check the expected CTC", "Senior panel preferred"] },
      happens: [
        { icon: CheckCircle2, text: "Reads \"Manual L1 – Yet to Schedule\" on every screen." },
        { icon: Users, text: "You can also book the L1 yourself from the ladder below." },
        { icon: BellRing, text: `${cap(ta)} is notified to book it.` },
      ],
      confirmLabel: "Shortlist for manual L1", busyLabel: "Shortlisting…",
    };
  }
  return {
    tone: "emerald", icon: ThumbsUp, eyebrow: "Technical screening", title: "Shortlist the candidate",
    intro: <>Clears them for the interview rounds{position ? <> on <b>{position}</b></> : null}. Next you choose the
      route — the AI L1, or a manual L1 that {ta} books.</>,
    flow: { steps: ["Technical Screening", "Shortlisted", "Choose the L1 route"], current: 1 },
    reason: { label: "Note for the TA", placeholder: "Anything the TA should know",
      picks: ["Strong skill match", "Good ATS score", "Probe the notice period", "Check the expected CTC"] },
    happens: [
      { icon: CheckCircle2, text: "Reads \"Technical Interview\" — the candidate moves off your screening list." },
      { icon: Route, text: "You pick the AI L1 or a manual L1 right after this." },
      { icon: BellRing, text: `${cap(ta)} is notified.` },
    ],
    confirmLabel: "Shortlist & notify TA", busyLabel: "Shortlisting…",
  };
}

export function ScreeningDecisionModal({ profileId, candidateName, position, taName, decision, route, onClose, onDone }: {
  profileId: number;
  candidateName: string;
  position?: string | null;
  taName?: string | null;
  decision: ScreeningDecision;
  /** With a shortlist: choose the L1 route in the same confirmation. */
  route?: ShortlistRoute;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  return (
    <DecisionDialog
      spec={specFor(decision, taName ? `the TA (${taName})` : "the TA", position, decision === "Shortlisted" ? route : undefined)}
      person={{ name: candidateName, meta: position || undefined }}
      onClose={onClose}
      onConfirm={async (note) => {
        const res = await crmPost(`/api/candidate-profiles/${profileId}/rmg-screening`, {
          decision, note: note || undefined,
        });
        if (decision === "Shortlisted" && route) {
          // The route rides on the same click: the shortlist is saved even when
          // the route call fails (the desk then offers the route card as before).
          const r2 = route === "ai"
            ? await crmPost(`/api/candidate-profiles/${profileId}/request-ai-l1`, { note: note || undefined })
            : await crmPost(`/api/candidate-profiles/${profileId}/skip-ai-l1`, { note: note || undefined, request_manual_l1: true });
          onDone(r2.message || (route === "ai" ? "Shortlisted — TA notified to schedule the AI L1" : "Shortlisted — TA notified to book the manual L1"));
          return;
        }
        onDone(res.message || "Screening decision recorded");
      }}
    />
  );
}

/** The header of RMG / GM's verdict after the rounds — Submit to Sales or
 *  Reject — used by the three places that record it (Screening Desk, Applied
 *  Candidates, the profile's RMG banner). */
export function RmgVerdictHero({ sales, name, position }: {
  sales: boolean;
  name: string;
  position?: string | null;
}) {
  return (
    <DialogHero
      tone={sales ? "emerald" : "rose"}
      icon={sales ? Send : XCircle}
      eyebrow="RMG review · verdict"
      title={sales ? "Submit to the Sales team" : "Reject after the rounds"}
      person={{ name, meta: position || undefined }}
      flow={sales
        ? { steps: ["RMG Review", "Sales Screening", "Customer"], current: 1 }
        : { steps: ["RMG Review", "RMG Rejected"], current: 1 }}
    />
  );
}
