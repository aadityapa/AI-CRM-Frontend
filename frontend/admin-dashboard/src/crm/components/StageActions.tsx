/**
 * The candidate's next moves as named buttons (28 Sep 2026, user ask: "Sales
 * gets Customer Screening, Sales Rejected, Self Withdraw buttons — updated in
 * every login — and then the Change Status button is not needed").
 *
 * The buttons are the SERVER's `allowed_next_statuses` for THIS login (B-V2
 * `candidate_profiles.allowed_next_statuses_for_user` — stage authority, role,
 * the screening approval), so every role sees exactly the moves it may make and
 * nothing else; after a move the page reloads and the buttons follow the new
 * stage. A click opens the same status dialog the old dropdown used, already
 * on that status, so the offer / customer slot / note it may need is asked for
 * in one place.
 */
import { ArrowLeft, ArrowRight, CheckCircle2, LogOut, XCircle } from "lucide-react";

import { FLOW_BTN } from "./flowButtons";
import { statusLabel } from "./ui";

/** Every closing status (mirrors the server's rejection buckets). */
export const CLOSING_STATUSES = new Set([
  "Sales_Rejected", "RMG_Rejected", "Customer_Rejected", "Customer_Screen_Rejected",
  "Customer_L1_Rejected", "Customer_L2_Rejected", "Self_Withdrawn", "Rejected",
]);

/** The only backward moves the server allows (`_BACKWARD` in B-V2). */
export const BACKWARD_MOVES: Record<string, string[]> = {
  Customer_Screening: ["Sales_Screening"],
  Customer_Interview: ["Customer_Screening"],
  L1_Feedback: ["Customer_Interview"],
  L2_Feedback: ["L1_Feedback"],
};

/** A positive outcome, not just "the next step". */
const WINNING = new Set(["Shortlisted", "Customer_Approval", "Joined"]);

export type StageAction = { status: string; label: string; kind: "forward" | "win" | "back" | "reject" | "withdraw" };

/**
 * PURE: the buttons for these allowed moves, in reading order — forward, back,
 * reject, withdraw. The generic "Rejected" is dropped when a stage-specific
 * rejection (Sales Rejected, RMG Rejected…) says the same thing better, and
 * `exclude` removes moves a dedicated panel on the page already offers.
 */
export function stageActions(currentStatus: string, allowed: string[], exclude: Iterable<string> = []): StageAction[] {
  const skip = new Set(exclude);
  const moves = allowed.filter((s) => !skip.has(s));
  const specificReject = moves.some((s) => CLOSING_STATUSES.has(s) && s !== "Rejected" && s !== "Self_Withdrawn");
  const back = new Set(BACKWARD_MOVES[currentStatus] || []);
  const out: StageAction[] = [];
  for (const s of moves) {
    if (s === "Rejected" && specificReject) continue;
    if (s === "Self_Withdrawn") out.push({ status: s, label: "Self Withdraw", kind: "withdraw" });
    else if (CLOSING_STATUSES.has(s)) out.push({ status: s, label: s === "Rejected" ? "Reject" : statusLabel(s), kind: "reject" });
    else if (back.has(s)) out.push({ status: s, label: `Back to ${statusLabel(s)}`, kind: "back" });
    else out.push({ status: s, label: statusLabel(s), kind: WINNING.has(s) ? "win" : "forward" });
  }
  const order = { forward: 0, win: 0, back: 1, reject: 2, withdraw: 3 } as const;
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}

const BIG = "!px-3 !py-2 !text-sm";
const LOOK: Record<StageAction["kind"], { cls: string; Icon: typeof ArrowRight }> = {
  forward: { cls: FLOW_BTN.primary, Icon: ArrowRight },
  win: { cls: FLOW_BTN.success, Icon: CheckCircle2 },
  back: { cls: FLOW_BTN.neutral, Icon: ArrowLeft },
  reject: { cls: FLOW_BTN.danger, Icon: XCircle },
  withdraw: { cls: FLOW_BTN.withdraw, Icon: LogOut },
};

export function StageActionBar({ currentStatus, allowed, exclude, onPick, disabled }: {
  currentStatus: string;
  allowed: string[];
  exclude?: Iterable<string>;
  onPick: (status: string) => void;
  disabled?: boolean;
}) {
  const actions = stageActions(currentStatus, allowed, exclude);
  if (!actions.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Move this candidate">
      {actions.map((a) => {
        const { cls, Icon } = LOOK[a.kind];
        return (
          <button key={a.status} type="button" className={`${cls} ${BIG}`} disabled={disabled}
            onClick={() => onPick(a.status)} title={`Move to ${statusLabel(a.status)}`}>
            <Icon size={15} aria-hidden /> {a.label}
          </button>
        );
      })}
    </div>
  );
}
