/**
 * Book ONE round in place (29 Sep 2026, user ask: "TA can do whatever is
 * required for scheduling from the task tab"). Given the round kind a
 * `GET /api/dashboard/desk` schedule item names (B-V2 `work_desk.SCHEDULE_ROUNDS`),
 * opens the SAME form the rest of the app uses for it:
 *
 *   Customer_Interview · Customer_L2 · HR_Interview → the Schedule interview
 *       round form (`Profiles.InterviewRoundModal`, lazy — Profiles is a big
 *       route chunk; the customer's slots are one-click picks there)
 *   AI_L1                → `ScheduleAiInterviewModal`
 *   L1_Interview · L2_F2F → `ScheduleManualRoundModal` (the one Technical L1 /
 *                          L2 booking dialog every screen uses)
 */
import { lazy, Suspense } from "react";
import { ScheduleManualRoundModal } from "./ScheduleManualRoundModal";
import { ScheduleAiInterviewModal } from "./ScheduleAiInterviewModal";
import { Modal, Spinner } from "./ui";

const InterviewRoundModal = lazy(() =>
  import("../pages/Profiles").then((m) => ({ default: m.InterviewRoundModal })));

const TECH_ROUND: Record<string, "L1" | "L2"> = { L1_Interview: "L1", L2_F2F: "L2" };

export type ScheduleTarget = {
  profileId: number;
  kind: string;
  candidateName: string;
  candidateEmail?: string | null;
};

export function ScheduleRoundLauncher({ target, onClose, onDone, showToast }: {
  target: ScheduleTarget;
  onClose: () => void;
  /** Called after a successful booking (refresh the list). `msg` is set only
   *  when the form did not already show its own confirmation. */
  onDone: (msg?: string) => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const { profileId, kind, candidateName, candidateEmail } = target;
  const tech = TECH_ROUND[kind];

  if (kind === "AI_L1") {
    return (
      <ScheduleAiInterviewModal profileId={profileId}
        candidate={{ full_name: candidateName, email: candidateEmail ?? null }}
        onClose={onClose}
        onDone={(res) => { if (res) onDone(); else onClose(); }}
        showToast={showToast} />
    );
  }
  if (tech) {
    return (
      <ScheduleManualRoundModal profileId={profileId} round={tech} candidateName={candidateName}
        candidateEmail={candidateEmail} onClose={onClose} onDone={(msg) => onDone(msg)} />
    );
  }
  return (
    <Suspense fallback={<Modal title="Schedule interview round" onClose={onClose}><Spinner label="Loading…" /></Modal>}>
      <InterviewRoundModal profileId={profileId} existing={null} initialKind={kind} initialMode="schedule"
        onClose={onClose}
        onSaved={() => onDone()}
        showToast={showToast} />
    </Suspense>
  );
}
