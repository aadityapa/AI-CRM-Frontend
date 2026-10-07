/**
 * The interview ROUTE decision (26 Sep 2026): once RMG / GM shortlists a
 * candidate, someone has to say HOW they are interviewed — the AI L1, or a
 * human ("manual") L1 that TA books. Applied Candidates and the profile page
 * already offered both; the Screening Desk did not, so a GM who never opens
 * those tabs had no way to send a candidate down either path.
 *
 * ONE component for the choice. Since 28 Sep 2026 (user flow) RMG / GM only
 * CHOOSE the route — TA is told and does the scheduling:
 *   - AI L1     → `ChooseAiL1Modal` (POST …/request-ai-l1) → TA gets "Schedule AI L1"
 *   - Manual L1 → `GoManualModal` (POST …/skip-ai-l1 with request_manual_l1) → TA gets "Schedule manual L1"
 * The server says whether the choice is still open (`interview_route.open`
 * on a desk row — B-V2 `screening_desk.interview_route`); this renders that.
 */
import { useState } from "react";
import { BellRing, Bot, CalendarCheck2, PauseCircle, PlayCircle, Sparkles, StepForward, UsersRound } from "lucide-react";

import { crmPost } from "../api";
import { DecisionDialog, type DecisionSpec } from "./dialogKit";
import { FLOW_BTN } from "./flowButtons";

export type InterviewRoute = {
  chosen: "ai" | "manual" | null;
  open: boolean;
  ai_interview_status: string | null;
  ai_effective_result: string | null;
  ai_overall_score_percent: number | null;
  manual_l1_requested: boolean;
  manual_l1_scheduled: boolean;
  manual_l1_result: string | null;
};

const MANUAL_SPEC: DecisionSpec = {
  tone: "indigo", icon: UsersRound, eyebrow: "Interview route", title: "Go manual — skip the AI interview",
  intro: <>The candidate moves to <b>RMG Review</b> and the TA who applied them is asked to arrange a human
    <b> Technical L1</b>. After the L1 feedback you can ask for an L2, then submit the candidate to Sales.</>,
  flow: { steps: ["Shortlisted", "Manual L1", "L1 verdict", "Sales"], current: 1 },
  reason: { label: "Reason", placeholder: "e.g. Known candidate — assessing directly in a human round",
    picks: ["Known candidate", "Senior profile — needs a human panel", "Customer asked for a panel round"] },
  happens: [
    { icon: BellRing, text: "The TA who applied the candidate is asked to book the manual L1." },
    { icon: CalendarCheck2, text: "Once booked, the candidate gets the invite and the round shows on the ladder." },
  ],
  confirmLabel: "Go manual & notify TA", busyLabel: "Switching…",
};

const AI_SPEC: DecisionSpec = {
  tone: "purple", icon: Bot, eyebrow: "Interview route", title: "Choose the AI L1 interview",
  intro: <>The TA who applied the candidate is asked to agree a time and <b>schedule the AI L1</b>. When the
    interview is done you are notified with the score and the report.</>,
  flow: { steps: ["Shortlisted", "AI L1", "Review the result"], current: 1 },
  reason: { label: "Note for TA", placeholder: "e.g. Please schedule this week",
    picks: ["Please schedule this week", "Candidate prefers evenings", "Urgent position"] },
  happens: [
    { icon: BellRing, text: "The TA is asked to schedule the AI L1 with the candidate." },
    { icon: Sparkles, text: "You get the score and the full AI report when the interview ends." },
  ],
  confirmLabel: "Choose AI L1 & notify TA", busyLabel: "Saving…",
};

type RouteDialogProps = {
  profileId: number;
  candidateName?: string | null;
  context?: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
};

/** "Go manual": skip the AI L1 and ask TA for a human L1 (POST …/skip-ai-l1). */
export function GoManualModal({ profileId, candidateName, context, onClose, onDone }: RouteDialogProps) {
  return (
    <DecisionDialog
      spec={MANUAL_SPEC}
      person={candidateName ? { name: candidateName, meta: context || undefined } : null}
      onClose={onClose}
      onConfirm={async (note) => {
        const res = await crmPost(`/api/candidate-profiles/${profileId}/skip-ai-l1`, {
          note: note || undefined, request_manual_l1: true,
        });
        onDone(res.message || "Manual route chosen — TA notified to schedule the L1");
      }}
    />
  );
}

/** "Choose AI L1": RMG / GM pick the AI route and TA is told to schedule it. */
export function ChooseAiL1Modal({ profileId, candidateName, context, onClose, onDone }: RouteDialogProps) {
  return (
    <DecisionDialog
      spec={AI_SPEC}
      person={candidateName ? { name: candidateName, meta: context || undefined } : null}
      onClose={onClose}
      onConfirm={async (note) => {
        const res = await crmPost(`/api/candidate-profiles/${profileId}/request-ai-l1`, { note: note || undefined });
        onDone(res.message || "AI L1 chosen — TA notified to schedule it");
      }}
    />
  );
}

/* ---------- After the AI L1: the screener's call (7 Oct 2026, user ask) ----------
   A FAILED AI L1 (or one a recruiter put ON HOLD from the report page) used to
   leave the row with no button — the ladder only opened on a pass. The AI
   verdict is advice: RMG / GM can proceed to the review anyway (L2 / Submit
   to Sales), park the candidate, or release a hold.
   POST …/ai-l1-decision {decision: proceed|hold|release, note}. */
export type AiL1Decision = "proceed" | "hold" | "release";

const AI_AFTER_SPEC: Record<AiL1Decision, (aiResult: string | null) => DecisionSpec> = {
  proceed: (ai) => ({
    tone: "emerald", icon: StepForward, eyebrow: "After the AI L1", title: "Proceed despite the AI result",
    intro: <>The AI recorded <b>{ai || "no verdict"}</b>. Your decision outranks it: the interview is marked
      <b> Selected</b> (the AI's score stays on record) and the candidate moves to <b>RMG Review</b>, where you
      request the <b>L2</b> or <b>submit to Sales</b>.</>,
    flow: { steps: ["AI L1", "RMG Review", "L2 / Sales"], current: 1 },
    reason: { label: "Why overrule the AI", required: ai !== "Passed" && ai !== "Selected", min: 5,
      placeholder: "e.g. Answers were correct — poor audio dragged the score down",
      picks: ["Answers were correct — transcription errors", "Strong CV and experience — AI was too strict",
        "Reviewed the recording — good enough for the L2"] },
    happens: [
      { icon: Sparkles, text: "The AI report keeps its score; your override is logged beside it." },
      { icon: BellRing, text: "The candidate lands in RMG Review — the L2 / Submit to Sales buttons open on this row." },
    ],
    confirmLabel: "Proceed to RMG review", busyLabel: "Moving…",
  }),
  hold: (ai) => ({
    tone: "amber", icon: PauseCircle, eyebrow: "After the AI L1", title: "Put the candidate on hold",
    intro: <>The AI recorded <b>{ai || "no verdict"}</b>. Nothing moves: the row reads <b>On Hold</b> until you
      proceed, choose a manual L1, send them to Sales or reject.</>,
    flow: { steps: ["AI L1", "On hold", "Your decision"], current: 1 },
    reason: { label: "Note (optional)", placeholder: "e.g. Waiting for the customer's view on the budget",
      picks: ["Waiting for the customer", "Compare with other applicants first", "Candidate unsure about the role"] },
    happens: [{ icon: BellRing, text: "The hold is logged on the profile; release it from this row any time." }],
    confirmLabel: "Put on hold", busyLabel: "Saving…",
  }),
  release: (ai) => ({
    tone: "sky", icon: PlayCircle, eyebrow: "After the AI L1", title: "Release the hold",
    intro: <>The AI verdict <b>{ai || "—"}</b> stands again. Then proceed, choose a manual L1, send to Sales or
      reject from the row.</>,
    flow: { steps: ["On hold", "AI verdict stands", "Your decision"], current: 1 },
    reason: { label: "Note (optional)", placeholder: "e.g. Customer confirmed the budget" },
    happens: [{ icon: BellRing, text: "The release is logged on the profile." }],
    confirmLabel: "Release hold", busyLabel: "Saving…",
  }),
};

export function AiL1DecisionModal({ profileId, candidateName, context, decision, aiResult, onClose, onDone }:
  RouteDialogProps & { decision: AiL1Decision; aiResult: string | null }) {
  return (
    <DecisionDialog
      spec={AI_AFTER_SPEC[decision](aiResult)}
      person={candidateName ? { name: candidateName, meta: context || undefined } : null}
      onClose={onClose}
      onConfirm={async (note) => {
        const res = await crmPost(`/api/candidate-profiles/${profileId}/ai-l1-decision`, {
          decision, note: note || undefined,
        });
        onDone(res.message || "Saved");
      }}
    />
  );
}

/** Two buttons — AI L1 · Manual L1 — plus the dialogs behind them. Renders
 *  nothing when the route is already decided (`route.open` false). */
export function InterviewRouteChoice({ profileId, candidate, route, onDone, showToast, compact }: {
  profileId: number;
  candidate: { full_name?: string | null; email?: string | null };
  route: InterviewRoute | null | undefined;
  /** A route was taken — reload the caller's data; the toast is already shown. */
  onDone: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
  /** Buttons only, no explanatory card — for a row context. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState<"ai" | "manual" | null>(null);
  if (!route?.open) return null;

  const buttons = (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={FLOW_BTN.ai} onClick={() => setOpen("ai")}
        title="Choose the AI L1 interview — TA schedules it and you are told the result">
        <Bot size={14} /> AI L1
      </button>
      <button type="button" className={FLOW_BTN.manual} onClick={() => setOpen("manual")}
        title="Skip the AI interview — ask TA to arrange a human L1 round instead">
        <UsersRound size={14} /> Manual L1
      </button>
    </div>
  );

  return (
    <>
      {compact ? buttons : (
        <div className="rounded-card border border-brand-300 bg-brand-50 p-4 dark:border-brand-500/40 dark:bg-brand-900/20">
          <div className="text-sm font-bold text-primary">Choose the interview route</div>
          <p className="mb-3 mt-0.5 text-sm text-secondary">
            Shortlisted — decide how <b>{candidate.full_name || "this candidate"}</b> is interviewed:
            the AI L1, or a human L1. Either way TA is told and books it with the candidate.
          </p>
          {buttons}
        </div>
      )}
      {open === "ai" && (
        <ChooseAiL1Modal
          profileId={profileId}
          candidateName={candidate.full_name}
          onClose={() => setOpen(null)}
          onDone={(msg) => { setOpen(null); showToast(msg); onDone(); }}
        />
      )}
      {open === "manual" && (
        <GoManualModal
          profileId={profileId}
          candidateName={candidate.full_name}
          onClose={() => setOpen(null)}
          onDone={(msg) => { setOpen(null); showToast(msg); onDone(); }}
        />
      )}
    </>
  );
}
