/**
 * Sales' work from the task list (29 Sep 2026, user ask: "after Feedback due,
 * tabs with all the work Sales has to do — without opening the candidate
 * profile"). B-V2 `work_desk._sales_tabs` sends one tab per stage Sales owns;
 * each item carries what the move needs:
 *
 *   sales_submit · sales_response · sales_decide
 *       `current_status` + `allowed` (the SAME moves the profile's Next-step bar
 *       offers) → named buttons → the status dialog (`Profiles.TransitionModal`,
 *       lazy — Profiles is a big route chunk), already on that move
 *   sales_terms     → "Submit terms" → `SubmitForApprovalModal`
 *   sales_approval  → Approve · Send back · Reject → `SalesHeadDecisionModal`
 *   sales_waiting   → the terms, read-only (it is Sales Head's move)
 *   sales_budget    → "Reply to HR" → `BudgetReplyModal`
 *
 * One component renders the buttons (`SalesItemActions`), one opens the dialog
 * (`SalesActionLauncher`) — My Tasks mounts both.
 */
import { lazy, Suspense, type ReactNode } from "react";
import { BadgeCheck, CalendarCheck2, IndianRupee, MessageSquareReply, Send, Undo2, X } from "lucide-react";

import { FLOW_BTN } from "./flowButtons";
import {
  BudgetReplyModal, SalesHeadDecisionModal, SubmitForApprovalModal,
  type OfferTerms, type SalesHeadDecision,
} from "./OfferApprovalGate";
import { BACKWARD_MOVES, stageActions, type StageAction } from "./StageActions";
import { Modal, Spinner } from "./ui";
import { CrmLink } from "../router";

const TransitionModal = lazy(() =>
  import("../pages/Profiles").then((m) => ({ default: m.TransitionModal })));

/** The fields a Sales desk item adds to the common item shape. */
export type SalesDeskItem = {
  key: string;
  title: string;
  profile_id: number | null;
  path: string;
  action: string | null;
  current_status?: string;
  allowed?: string[];
  offer?: OfferTerms | null;
  expected_ctc?: number | null;
  current_ctc?: number | null;
  approved_ctc_budget?: number | null;
  ctc_slab_band?: string | null;
  opportunity_label?: string | null;
  status_label?: string | null;
  hr_note?: string | null;
  chip?: string | null;
  /** The group the item is listed under (a customer, or a "Submit to Sales Head" section). */
  section?: string | null;
};

export type SalesAct =
  | { kind: "move"; status: string; item: SalesDeskItem }
  | { kind: "terms"; item: SalesDeskItem }
  | { kind: "decision"; decision: SalesHeadDecision; item: SalesDeskItem }
  | { kind: "budget"; item: SalesDeskItem };

/** Sales' billing tabs (29 Sep 2026) are plain links — no candidate move. */
export const SALES_BILLING_TABS = new Set(["sales_timesheets", "sales_invoices_pending", "sales_proformas", "sales_invoices", "sales_collections"]);

export function isSalesTab(key: string): boolean {
  return key.startsWith("sales_") && !SALES_BILLING_TABS.has(key);
}

/** "Submit to Sales Head" section holding terms already sent (B-V2 `work_desk.TERMS_WAITING`). */
export const TERMS_WAITING_PREFIX = "With Sales Head";

/** The moves an item offers — backward moves and withdrawals live on the profile. */
export function deskMoves(item: SalesDeskItem): StageAction[] {
  const current = item.current_status || "";
  return stageActions(current, item.allowed || [], BACKWARD_MOVES[current] || [])
    .filter((a) => a.kind !== "withdraw");
}

const LOOK: Record<StageAction["kind"], string> = {
  forward: FLOW_BTN.primary, win: FLOW_BTN.success, back: FLOW_BTN.neutral,
  reject: FLOW_BTN.danger, withdraw: FLOW_BTN.withdraw,
};

const fmtRs = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const lac = (rupees?: number | null) =>
  rupees == null ? "—" : `${(Number(rupees) / 100_000).toFixed(2).replace(/\.00$/, "")} L`;

/** The terms Sales submitted, as one line of chips (approval / waiting items). */
export function TermsLine({ offer }: { offer?: OfferTerms | null }) {
  if (!offer) return null;
  const rate = offer.rate_value != null && offer.rate_unit && offer.rate_unit !== "Yearly"
    ? `₹${fmtRs(Number(offer.rate_value))} ${offer.rate_unit.toLowerCase()} (≈ ${lac(offer.ctc)} a year)`
    : `${lac(offer.ctc)} a year`;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 font-semibold text-primary">
        <IndianRupee size={11} aria-hidden /> {rate}
      </span>
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 font-semibold text-primary">
        <CalendarCheck2 size={11} aria-hidden /> Onboarding {offer.joining_date?.slice(0, 10) || "not set"}
      </span>
    </span>
  );
}

/** The buttons for one Sales item. */
export function SalesItemActions({ tabKey, item, onAct }: {
  tabKey: string;
  item: SalesDeskItem;
  onAct: (act: SalesAct) => void;
}) {
  const open = item.path ? <CrmLink to={item.path} className={FLOW_BTN.view}>Open</CrmLink> : null;
  if (item.profile_id == null) return open;
  let buttons: ReactNode = null;
  if (tabKey === "sales_terms" && (item.section || "").startsWith(TERMS_WAITING_PREFIX)) {
    // Already sent — Sales Head's move; the terms are printed under the row.
    buttons = null;
  } else if (tabKey === "sales_terms") {
    const back = item.chip === "Sent back by Sales Head";
    buttons = (
      <button type="button" className={FLOW_BTN.success} onClick={() => onAct({ kind: "terms", item })}>
        <Send size={13} aria-hidden /> {back ? "Resubmit terms" : "Submit terms"}
      </button>
    );
  } else if (tabKey === "sales_approval") {
    buttons = (
      <>
        <button type="button" className={FLOW_BTN.success} disabled={!item.offer}
          title={item.offer ? undefined : "No terms on record — send it back so Sales submits them"}
          onClick={() => onAct({ kind: "decision", decision: "approve", item })}>
          <BadgeCheck size={13} aria-hidden /> Approve
        </button>
        <button type="button" className={FLOW_BTN.neutral} onClick={() => onAct({ kind: "decision", decision: "send_back", item })}>
          <Undo2 size={13} aria-hidden /> Send back
        </button>
        <button type="button" className={FLOW_BTN.danger} onClick={() => onAct({ kind: "decision", decision: "reject", item })}>
          <X size={13} aria-hidden /> Reject
        </button>
      </>
    );
  } else if (tabKey === "sales_budget") {
    buttons = (
      <button type="button" className={FLOW_BTN.warn} onClick={() => onAct({ kind: "budget", item })}>
        <MessageSquareReply size={13} aria-hidden /> Reply to HR
      </button>
    );
  } else if (tabKey !== "sales_waiting") {
    buttons = deskMoves(item).map((a) => (
      <button key={a.status} type="button" className={LOOK[a.kind]}
        onClick={() => onAct({ kind: "move", status: a.status, item })}>
        {a.label}
      </button>
    ));
  }
  return <span className="flex flex-wrap items-center gap-2">{buttons}{open}</span>;
}

/** Opens the dialog for one act; `onDone` refreshes the desk. */
export function SalesActionLauncher({ act, onClose, onDone }: {
  act: SalesAct;
  onClose: () => void;
  onDone: (msg?: string) => void;
}) {
  const it = act.item;
  const pid = it.profile_id as number;
  if (act.kind === "terms") {
    return (
      <SubmitForApprovalModal profileId={pid} candidateName={it.title} expectedCtc={it.expected_ctc}
        currentCtc={it.current_ctc} approvedBudgetLac={it.approved_ctc_budget} budgetBand={it.ctc_slab_band}
        opportunityLabel={it.opportunity_label} sentBack={it.chip === "Sent back by Sales Head"}
        existing={it.offer} onClose={onClose} onDone={(m) => onDone(m)} />
    );
  }
  if (act.kind === "decision") {
    return (
      <SalesHeadDecisionModal profileId={pid} candidateName={it.title} decision={act.decision}
        terms={it.offer ?? null} expectedCtc={it.expected_ctc} currentCtc={it.current_ctc}
        approvedBudgetLac={it.approved_ctc_budget} budgetBand={it.ctc_slab_band}
        opportunityLabel={it.opportunity_label} onClose={onClose} onDone={(m) => onDone(m)} />
    );
  }
  if (act.kind === "budget") {
    return (
      <BudgetReplyModal profileId={pid} offer={it.offer} hrNote={it.hr_note || ""}
        onClose={onClose} onDone={(m) => onDone(m)} />
    );
  }
  return (
    <Suspense fallback={<Modal title="Loading…" onClose={onClose}><Spinner label="Loading the form…" /></Modal>}>
      <TransitionModal profileId={pid} currentStatus={it.current_status || ""} allowed={it.allowed || []}
        candidateName={it.title} opportunityLabel={it.opportunity_label} hasOffer={!!it.offer}
        initialStatus={act.status} onClose={onClose} onDone={(m?: string) => onDone(m)} />
    </Suspense>
  );
}
