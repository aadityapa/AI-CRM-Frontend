/**
 * Hold a candidate — anyone who works them, with a reason (16 Oct 2026, user ask).
 *
 * TA, RMG / GM, Sales and HR can put a live candidacy on hold at ANY stage and
 * say whose hold it is (TA · RMG · Sales · Customer · HR). The stage never
 * moves; the status reads "On Hold – Customer" with the reason until someone
 * releases it (`POST /api/candidate-profiles/{id}/hold`). TA's own Sourcing
 * hold (`TaDecision`) is unchanged — this one covers every later stage.
 */
import { useState } from "react";
import { PauseCircle, PlayCircle, Bell, History } from "lucide-react";

import { crmPost } from "../api";
import { fmtDateTime12 } from "../../lib/datetime";
import { DecisionDialog, QuickPicks, type DecisionSpec } from "./dialogKit";
import { FLOW_BTN } from "./flowButtons";

export type CandidateHoldInfo = { side: string; reason: string; by_id?: number | null; at?: string | null };

export const HOLD_SIDES = ["TA", "RMG", "Sales", "Customer", "HR"] as const;
const SIDE_WORDS: Record<string, string> = {
  TA: "TA (recruiter)", RMG: "RMG / GM", Sales: "Sales", Customer: "Customer asked", HR: "HR",
};

const HOLD_SPEC: DecisionSpec = {
  tone: "amber", icon: PauseCircle, eyebrow: "Pause the candidacy", title: "Put the candidate on hold",
  intro: "The candidate stays at their current stage — nothing is closed. Everyone sees \"On Hold\" with your reason until the hold is released.",
  reason: {
    label: "Why on hold", required: true, min: 5,
    placeholder: "e.g. Customer froze hiring until November",
    picks: ["Customer froze hiring", "Candidate asked for time", "Not reachable", "Budget under discussion",
      "Awaiting documents", "Position under review"],
  },
  happens: [
    { icon: PauseCircle, text: "Reads \"On Hold – <who>\" on every screen, with the reason." },
    { icon: Bell, text: "The TAs who work this candidate are told." },
    { icon: PlayCircle, text: "Release the hold from the row whenever it can continue." },
  ],
  confirmLabel: "Put on hold", busyLabel: "Saving…",
};

const RELEASE_SPEC: DecisionSpec = {
  tone: "emerald", icon: PlayCircle, eyebrow: "Back into the flow", title: "Release the hold",
  intro: "The candidate continues exactly where they were.",
  reason: { label: "Note (optional)", placeholder: "e.g. Customer reopened the position",
    picks: ["Customer reopened", "Candidate is available again", "Budget agreed"] },
  happens: [{ icon: History, text: "The release is kept in the candidate's history." }],
  confirmLabel: "Release hold", busyLabel: "Saving…",
};

/** The "On hold · Customer — reason" line printed in a row's Status cell. */
export function HoldNote({ hold }: { hold?: CandidateHoldInfo | null }) {
  if (!hold) return null;
  return (
    <div className="mt-1 max-w-xs rounded-control bg-amber-50 px-2 py-1 text-[11px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
      title={hold.reason}>
      <b>On hold · {SIDE_WORDS[hold.side] || hold.side || "—"}</b>{hold.at ? ` · ${fmtDateTime12(hold.at)}` : ""}
      <span className="line-clamp-2">{hold.reason}</span>
    </div>
  );
}

/** Hold / Release button for one candidacy. */
export function CandidateHoldButton({ profileId, candidateName, hold, defaultSide, onDone, disabled }: {
  profileId: number;
  candidateName: string;
  hold?: CandidateHoldInfo | null;
  /** Side pre-selected for this login (TA → TA, Sales → Sales, HR → HR …). */
  defaultSide: string;
  onDone: (message: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState(defaultSide);
  const held = !!hold;
  return (
    <>
      <button type="button" className={held ? FLOW_BTN.success : FLOW_BTN.warn} disabled={disabled}
        title={held ? `On hold: ${hold!.reason}` : "Put on hold with a reason — any stage"}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
        {held ? <PlayCircle size={13} aria-hidden /> : <PauseCircle size={13} aria-hidden />}
        {held ? "Release hold" : "Hold"}
      </button>
      {open && (
        <DecisionDialog
          spec={held ? RELEASE_SPEC : HOLD_SPEC}
          person={{ name: candidateName }}
          notice={held ? <span>On hold by <b>{SIDE_WORDS[hold!.side] || hold!.side}</b>: {hold!.reason}</span> : undefined}
          onClose={() => setOpen(false)}
          onConfirm={async (note) => {
            const res = await crmPost(`/api/candidate-profiles/${profileId}/hold`, held
              ? { action: "release", reason: note || null }
              : { action: "hold", side, reason: note });
            setOpen(false);
            onDone(res.message || (held ? "Hold released" : "On hold"));
          }}
        >
          {!held && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-secondary">Whose hold is it?</p>
              <QuickPicks label="Hold side" options={[...HOLD_SIDES]} active={side} onPick={setSide} tone="amber" />
              <p className="mt-1 text-[11px] text-muted">{SIDE_WORDS[side]} — shown as "On Hold – {side}".</p>
            </div>
          )}
        </DecisionDialog>
      )}
    </>
  );
}

/** The side a login books a hold to by default (mirror of the server's `default_hold_side`). */
export function defaultHoldSide(roles: string[]): string {
  if (roles.includes("HR")) return "HR";
  if (roles.includes("RMG")) return "RMG";
  if (roles.includes("Sales_Head") || roles.includes("Sales")) return "Sales";
  if (roles.includes("TA")) return "TA";
  return "RMG";
}
