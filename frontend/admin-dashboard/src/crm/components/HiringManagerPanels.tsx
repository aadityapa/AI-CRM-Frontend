/**
 * The Hiring Manager's three decisions (22 Oct 2026, server half in B-V2
 * `services/hiring_managers.py`):
 *
 *  1. `HmJdReviewBanner` — a position at Pending_HM_Review: the HM confirms the
 *     JD & skills (→ open for sourcing) or sends them back to RMG.
 *  2. `HmCandidateGate` — on the profile page: the review before the customer
 *     (Sales Screening) and the sign-off before the Sales Head (Customer
 *     Approval), with who decided and when.
 *  3. `HmDecisionButton` — the same two decisions from a list row.
 *
 * Who may press: the server's own answer — `me.approvals` holds the action
 * AND this login is one of the position's Hiring Managers (Admin / CEO always).
 * The server checks both again on every click.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, FileCheck2, Send, ShieldCheck, UserCheck, XCircle } from "lucide-react";

import { crmGet, crmPost } from "../api";
import { useMe } from "../CrmApp";
import { useCanApprove } from "../useAccess";
import { fmtDateTime12 } from "../../lib/datetime";
import { DecisionDialog, type DecisionSpec } from "./dialogKit";
import { FLOW_BTN } from "./flowButtons";

type ToastFn = (msg: string, kind?: "ok" | "err") => void;
type Person = { user_id: number; name: string };
export type HmStep = { status?: string | null; note?: string | null; by_name?: string | null; at?: string | null };
/** `profile.hiring_manager` from GET /api/candidate-profiles/{id} — null when the deal has no HM. */
export type HmProfileInfo = { hiring_managers: Person[]; review: HmStep; signoff: HmStep } | null;
export type HmKind = "review" | "signoff";

const isAdminLike = (roles: string[]) => roles.includes("Admin") || roles.includes("CEO");

/** Is this login one of these Hiring Managers (or Admin / CEO)? PURE. */
export function isHmOf(me: { id: number; roles: string[] }, hms: Person[] | null | undefined): boolean {
  return isAdminLike(me.roles) || Boolean(hms?.some((h) => h.user_id === me.id));
}

// ------------------------------------------------------------ JD & skills ---

const JD_OK: DecisionSpec = {
  tone: "emerald", icon: FileCheck2, eyebrow: "Hiring Manager", title: "Confirm the JD & skills",
  intro: "RMG approved this position. Confirming opens it for sourcing — TA starts finding candidates against this JD and these skills.",
  flow: { steps: ["RMG approved", "You confirm", "TA sources"], current: 1 },
  reason: { label: "Note for TA (optional)", required: false, picks: ["Prioritise AUTOSAR experience", "Customer wants immediate joiners"] },
  happens: [{ icon: Send, text: "The position opens for sourcing; TA and the RMG who approved it are told" }],
  confirmLabel: "Confirm — open for sourcing", busyLabel: "Confirming…",
};
const JD_BACK: DecisionSpec = {
  tone: "amber", icon: ClipboardCheck, eyebrow: "Hiring Manager", title: "Send the JD back to RMG",
  intro: "Say exactly what to change — RMG updates the JD / skills and approves again; it then comes back to you.",
  flow: { steps: ["RMG approved", "Back to RMG", "You confirm again"], current: 1 },
  reason: { label: "What should change", required: true, min: 10,
            picks: ["Add a mandatory skill: ", "The experience band is wrong — ", "The JD misses the domain: "] },
  happens: [{ icon: Send, text: "RMG is told with your note; sourcing does not start yet" }],
  confirmLabel: "Send back to RMG", busyLabel: "Sending…",
};

/** The banner on a position waiting for its Hiring Manager. Renders nothing otherwise. */
export function HmJdReviewBanner({ req, toast, onDone }: {
  req: { id: number; status?: string | null; title?: string | null; hiring_managers?: Person[] | null };
  toast: ToastFn;
  onDone: () => void;
}) {
  const me = useMe();
  const may = useCanApprove("requirement.hm_approve") && isHmOf(me, req.hiring_managers);
  const [open, setOpen] = useState<"ok" | "back" | null>(null);
  if (req.status !== "Pending_HM_Review") return null;
  const names = (req.hiring_managers || []).map((h) => h.name).join(", ") || "the Hiring Manager";
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-800 dark:bg-emerald-950/40">
      <UserCheck size={18} className="shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-emerald-900 dark:text-emerald-100">
          {may ? "Confirm the JD & skills — TA starts sourcing once you do" : `Waiting for ${names} to confirm the JD & skills`}
        </p>
        <p className="text-xs text-emerald-800/80 dark:text-emerald-200/80">
          RMG approved this position; its Hiring Manager checks the JD and the skills before sourcing begins.
        </p>
      </div>
      {may && (
        <div className="flex gap-2">
          <button type="button" className={FLOW_BTN.success} onClick={() => setOpen("ok")}>
            <CheckCircle2 size={14} /> Confirm JD
          </button>
          <button type="button" className={FLOW_BTN.warn} onClick={() => setOpen("back")}>
            <XCircle size={14} /> Request changes
          </button>
        </div>
      )}
      {open && (
        <DecisionDialog
          spec={open === "ok" ? JD_OK : JD_BACK}
          person={{ name: req.title || `Position #${req.id}` }}
          onClose={() => setOpen(null)}
          onConfirm={async (note) => {
            const res = open === "ok"
              ? await crmPost<any>(`/api/requirements/${req.id}/hm-approve`, { comment: note || null })
              : await crmPost<any>(`/api/requirements/${req.id}/hm-request-changes`, { reason: note });
            toast(res.message || "Saved");
            setOpen(null);
            onDone();
          }}
        />
      )}
    </div>
  );
}

/** The same banner for a page that only knows the requirement id (the opportunity page). */
export function HmJdReviewBannerFor({ requirementId, toast, onDone }: {
  requirementId: number; toast: ToastFn; onDone?: () => void;
}) {
  const [req, setReq] = useState<any>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    crmGet<any>(`/api/requirements/${requirementId}`)
      .then((r) => { if (alive) setReq(r.data); })
      .catch(() => { if (alive) setReq(null); });
    return () => { alive = false; };
  }, [requirementId, tick]);
  if (!req) return null;
  return <HmJdReviewBanner req={req} toast={toast} onDone={() => { setTick((t) => t + 1); onDone?.(); }} />;
}

// ------------------------------------------------------------ candidates ---

const SPEC: Record<HmKind, Record<"approve" | "reject", DecisionSpec>> = {
  review: {
    approve: {
      tone: "emerald", icon: CheckCircle2, eyebrow: "Hiring Manager review", title: "Approve for the customer",
      intro: "RMG handed this candidate to Sales. Approving lets Sales submit the profile to the customer.",
      flow: { steps: ["RMG cleared", "Your review", "Sales submits to customer"], current: 1 },
      reason: { label: "Note for Sales (optional)", required: false, picks: ["Strong fit — submit today", "Good on the mandatory skills"] },
      happens: [{ icon: Send, text: "Sales and the candidate's TA are told" }],
      confirmLabel: "Approve for the customer", busyLabel: "Approving…",
    },
    reject: {
      tone: "rose", icon: XCircle, eyebrow: "Hiring Manager review", title: "Reject before the customer",
      intro: "The candidacy closes as “Rejected by Hiring Manager”; the profile never reaches the customer.",
      reason: { label: "Why", required: true, min: 5, picks: ["Not strong enough on the mandatory skills", "Experience does not fit the role", "Domain mismatch"] },
      happens: [{ icon: Send, text: "Sales, RMG and the candidate's TA are told with your reason" }],
      confirmLabel: "Reject candidate", busyLabel: "Rejecting…",
    },
  },
  signoff: {
    approve: {
      tone: "emerald", icon: ShieldCheck, eyebrow: "Hiring Manager sign-off", title: "Sign off the selection",
      intro: "The customer selected this candidate and Sales submitted the terms. Your sign-off lets the Sales Head approve them.",
      flow: { steps: ["Customer selected", "Your sign-off", "Sales Head approves"], current: 1 },
      reason: { label: "Note (optional)", required: false, picks: ["Good fit — go ahead"] },
      happens: [{ icon: Send, text: "The Sales Head and Sales are told" }],
      confirmLabel: "Sign off", busyLabel: "Signing off…",
    },
    reject: {
      tone: "rose", icon: XCircle, eyebrow: "Hiring Manager sign-off", title: "Reject the selection",
      intro: "The candidacy closes as “Rejected by Hiring Manager”; the terms do not go to the Sales Head.",
      reason: { label: "Why", required: true, min: 5, picks: ["Terms do not fit the position", "Concerns from the interviews"] },
      happens: [{ icon: Send, text: "The Sales Head, Sales, RMG and the TA are told with your reason" }],
      confirmLabel: "Reject candidate", busyLabel: "Rejecting…",
    },
  },
};

/** Approve + Reject buttons for one pending HM decision (profile page or a list row). */
export function HmDecisionButton({ profileId, kind, candidateName, toast, onDone, compact }: {
  profileId: number; kind: HmKind; candidateName: string; toast: ToastFn; onDone: () => void; compact?: boolean;
}) {
  const [open, setOpen] = useState<"approve" | "reject" | null>(null);
  const ok = kind === "review" ? "Approve for customer" : "Sign off";
  return (
    <>
      <button type="button" className={FLOW_BTN.success} onClick={(e) => { e.stopPropagation(); setOpen("approve"); }}>
        <CheckCircle2 size={14} /> {compact ? (kind === "review" ? "Approve" : "Sign off") : ok}
      </button>
      <button type="button" className={FLOW_BTN.danger} onClick={(e) => { e.stopPropagation(); setOpen("reject"); }}>
        <XCircle size={14} /> Reject
      </button>
      {open && (
        <DecisionDialog
          spec={SPEC[kind][open]}
          person={{ name: candidateName }}
          onClose={() => setOpen(null)}
          onConfirm={async (note) => {
            const res = await crmPost<any>(`/api/candidate-profiles/${profileId}/hm-${kind}`,
              { decision: open, note: note || null });
            toast(res.message || "Saved");
            setOpen(null);
            onDone();
          }}
        />
      )}
    </>
  );
}

const STATUS_LOOK: Record<string, string> = {
  Pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  Approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  Rejected: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
};

/** The profile page card: both HM steps, with buttons when one is waiting on THIS login. */
export function HmCandidateGate({ info, profileId, stage, candidateName, toast, onDone }: {
  info: HmProfileInfo; profileId: number; stage?: string | null; candidateName: string;
  toast: ToastFn; onDone: () => void;
}) {
  const me = useMe();
  const mayReview = useCanApprove("profile.hm_review");
  const maySign = useCanApprove("profile.hm_signoff");
  if (!info) return null;
  const mine = isHmOf(me, info.hiring_managers);
  const steps: { kind: HmKind; label: string; step: HmStep; due: boolean; may: boolean }[] = [
    { kind: "review", label: "Review before the customer", step: info.review,
      due: stage === "Sales_Screening" && info.review?.status === "Pending", may: mayReview && mine },
    { kind: "signoff", label: "Sign-off before the Sales Head", step: info.signoff,
      due: stage === "Customer_Approval" && info.signoff?.status === "Pending", may: maySign && mine },
  ];
  const names = info.hiring_managers.map((h) => h.name).join(", ") || "—";
  return (
    <div className="rounded-card border border-emerald-200 bg-surface-1 shadow-sm dark:border-emerald-900">
      <div className="flex flex-wrap items-center gap-2 border-b border-subtle px-4 py-2.5">
        <UserCheck size={15} className="text-emerald-600 dark:text-emerald-400" aria-hidden />
        <span className="text-sm font-semibold text-primary">Hiring Manager</span>
        <span className="text-xs text-muted">{names}</span>
      </div>
      <div className="grid gap-px bg-subtle sm:grid-cols-2">
        {steps.map((s) => (
          <div key={s.kind} className="space-y-1.5 bg-surface-1 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">{s.label}</span>
              {s.step?.status && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_LOOK[s.step.status] || "bg-surface-2 text-secondary"}`}>
                  {s.step.status === "Pending" ? "Waiting" : s.step.status}
                </span>
              )}
            </div>
            {s.step?.by_name && (
              <p className="text-xs text-secondary">
                {s.step.by_name}{s.step.at ? ` · ${fmtDateTime12(s.step.at)}` : ""}
                {s.step.note ? <> — “{s.step.note}”</> : null}
              </p>
            )}
            {!s.step?.status && <p className="text-xs text-muted">Not reached yet</p>}
            {s.due && s.may && (
              <div className="flex flex-wrap gap-2 pt-1">
                <HmDecisionButton profileId={profileId} kind={s.kind} candidateName={candidateName}
                  toast={toast} onDone={onDone} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
