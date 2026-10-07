/**
 * "The AI interview template is not ready" — the ONE pop-up every Schedule AI L1
 * path shows before it opens a scheduling form (6 Oct 2026, user ask).
 *
 * Without an RMG-linked template the candidate would sit an interview with no
 * questions, so the server refuses (B-V2 `ai_interview_bridge.ensure_l1_template_ready`).
 * This component asks first — `GET …/ai-template-status` — and tells TA what to
 * do instead of letting them fill a form that will be refused:
 *
 *   missing    → nothing requested yet: "Request template from RMG" in place
 *   requested  → a request waits for RMG: its number, status and date
 *   ready      → the caller's action simply runs
 *
 * `useAiTemplateGate()` wraps any "schedule" click: `gate({profileId | requirementId}, proceed)`.
 * A failed status read never blocks — the server still refuses with the same reason.
 */
import { useCallback, useState } from "react";
import { Bot, ClipboardList, ExternalLink, FileWarning, Hourglass, Link2, Send } from "lucide-react";

import { crmGet, crmPost } from "../api";
import { useHasRole } from "../CrmApp";
import { crmNavigate } from "../router";
import { useCanAct } from "../useAccess";
import { fmtDateShort } from "../../lib/datetime";
import { DialogActions, DialogFailure, DialogHero, WhatHappens } from "./dialogKit";
import { Modal } from "./ui";

export type AiTemplateState = "ready" | "requested" | "missing";

export type AiTemplateStatus = {
  ready: boolean;
  state: AiTemplateState;
  code?: string;
  template_job_id?: string | null;
  request?: {
    id: number;
    tr_number?: string | null;
    status?: string | null;
    requested_at?: string | null;
    template_name?: string | null;
  } | null;
  requirement_id?: number | null;
  opportunity_id?: number | null;
  reason?: string;
};

export type AiTemplateTarget = { profileId?: number | null; requirementId?: number | null };

/** The server's status of the position's AI L1 template. */
export async function fetchAiTemplateStatus(t: AiTemplateTarget): Promise<AiTemplateStatus | null> {
  const path = t.profileId != null
    ? `/api/candidate-profiles/${t.profileId}/ai-template-status`
    : t.requirementId != null
      ? `/api/requirements/${t.requirementId}/ai-template-status`
      : null;
  if (!path) return null;
  const res = await crmGet<AiTemplateStatus>(path);
  return res.data ?? null;
}

/** True for the server's "no template" refusal (current and older wording). */
export function isTemplateNotReadyError(message?: string | null): boolean {
  return /interview template is not ready|no interview template|has not linked a template/i.test(String(message || ""));
}

/** A status for a refusal that came back from a schedule call (no prior check). */
export function statusFromError(message: string, requirementId?: number | null): AiTemplateStatus {
  return {
    ready: false,
    state: /template request/i.test(message) && /waiting|has not linked/i.test(message) ? "requested" : "missing",
    reason: message,
    requirement_id: requirementId ?? null,
  };
}

const STATUS_WORDS: Record<string, string> = {
  Pending_RMG: "Waiting for RMG",
  Template_Ready: "Template ready",
  Prepared: "Prepared",
};

export function TemplateNotReadyModal({ status: initial, candidateName, onClose, onReady }: {
  status: AiTemplateStatus;
  candidateName?: string | null;
  onClose: () => void;
  /** Called when a fresh check finds the template linked — the caller proceeds. */
  onReady?: () => void;
}) {
  const [status, setStatus] = useState<AiTemplateStatus>(initial);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [justRequested, setJustRequested] = useState(false);
  // Who may raise one: TA by role, or a template / custom role with the Create grant.
  const canRequest = useCanAct("template-requests", "create", useHasRole("TA"));
  // RMG / GM build it: send them straight to the list.
  const canFulfil = useCanAct("template-requests", "edit", useHasRole("RMG"));

  const reqId = status.requirement_id ?? null;
  const tr = status.request;
  const missing = status.state === "missing";

  const recheck = async () => {
    setBusy(true);
    setFailure("");
    try {
      const fresh = await fetchAiTemplateStatus({ requirementId: reqId });
      if (fresh?.ready) { onClose(); onReady?.(); return; }
      if (fresh) setStatus(fresh);
      setFailure("The template is still not linked. RMG is notified of the request.");
    } catch (e: any) {
      setFailure(e?.message || "Could not check the template");
    } finally {
      setBusy(false);
    }
  };

  const requestTemplate = async () => {
    if (!reqId) { setFailure("This candidate has no position to request a template for."); return; }
    setBusy(true);
    setFailure("");
    try {
      await crmPost(`/api/template-requests`, { requirement_id: reqId });
      setJustRequested(true);
    } catch (e: any) {
      // 409 = someone already raised one — show it rather than an error.
      if (e?.status !== 409) setFailure(e?.message || "Could not raise the template request");
    }
    try {
      const fresh = await fetchAiTemplateStatus({ requirementId: reqId });
      if (fresh) setStatus(fresh);
    } catch { /* the request itself already went through */ }
    setBusy(false);
  };

  const openRequests = () => { onClose(); crmNavigate("template-requests"); };

  const primary = missing && canRequest
    ? { label: "Request template from RMG", busyLabel: "Requesting…", icon: Send, run: requestTemplate }
    : canFulfil
      ? { label: "Open Template Requests", busyLabel: "Opening…", icon: ExternalLink, run: openRequests }
      : { label: "Check again", busyLabel: "Checking…", icon: Hourglass, run: recheck };

  return (
    <Modal
      title="AI interview template not ready"
      medium
      onClose={() => { if (!busy) onClose(); }}
      hero={
        <DialogHero tone="amber" icon={FileWarning} eyebrow="Cannot schedule the AI L1 yet"
          title="The AI interview template is not ready"
          subtitle="Each AI interview asks the questions of a template RMG builds for the position."
          person={candidateName ? { name: candidateName } : null}
          flow={{ steps: ["Template requested", "RMG links the template", "Schedule AI L1"], current: missing ? 0 : 1 }} />
      }
      footer={
        <DialogActions tone="amber" icon={primary.icon} label={primary.label} busyLabel={primary.busyLabel}
          busy={busy} onCancel={onClose} onConfirm={() => void primary.run()}
          hint={justRequested
            ? <span className="text-success">Requested — RMG has been notified</span>
            : "You can schedule the AI L1 once RMG links the template"} />
      }
    >
      <div className="space-y-4">
        {missing ? (
          <div className="flex items-start gap-3 rounded-card border border-warning bg-warning-soft p-3.5">
            <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
            <div className="text-sm text-secondary">
              <p className="font-semibold text-primary">No template has been requested for this opportunity</p>
              <p className="mt-0.5">
                {canRequest
                  ? "Raise a template request — RMG gets it at once and builds the interview from the position's JD and skills."
                  : "Ask TA to raise a template request for this opportunity, or RMG to link one."}
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-card border border-subtle bg-surface-2 p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-bold text-warning">
                <Hourglass className="h-3.5 w-3.5" aria-hidden />
                {tr?.tr_number || "Template request"}
              </span>
              <span className="text-sm font-semibold text-primary">
                {STATUS_WORDS[String(tr?.status || "")] || "Waiting for RMG"}
              </span>
              {tr?.requested_at && (
                <span className="text-xs text-muted">· requested {fmtDateShort(tr.requested_at)}</span>
              )}
            </div>
            <p className="mt-2 text-sm text-secondary">
              {justRequested
                ? "Your request is with RMG. Once they link the template you can schedule the AI L1 from the same button."
                : "A template has been requested and RMG has not linked it yet. There is nothing to request again — follow it up with RMG."}
            </p>
          </div>
        )}

        {status.reason && !justRequested && (
          <p className="text-xs leading-relaxed text-muted">{status.reason}</p>
        )}

        <WhatHappens tone="amber" items={[
          { icon: Send, text: "TA raises a template request (one per opportunity)." },
          { icon: Link2, text: "RMG builds or picks the interview template and links it in Template Requests." },
          { icon: Bot, text: "TA schedules the AI L1 — the candidate gets the invite with the questions ready." },
        ]} />

        {!missing && (
          <button type="button" onClick={openRequests}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:underline">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open Template Requests
          </button>
        )}
        <DialogFailure message={failure} />
      </div>
    </Modal>
  );
}

/**
 * Wrap a "schedule the AI L1" click. `gate(target, proceed, name)` checks the
 * template; ready → `proceed()`, not ready → the pop-up. Render `modal`.
 */
export function useAiTemplateGate() {
  const [pending, setPending] = useState<{ status: AiTemplateStatus; name?: string | null; proceed: () => void } | null>(null);
  const [checking, setChecking] = useState(false);

  const gate = useCallback(async (target: AiTemplateTarget, proceed: () => void, name?: string | null) => {
    setChecking(true);
    let st: AiTemplateStatus | null = null;
    try {
      st = await fetchAiTemplateStatus(target);
    } catch {
      st = null; // never block on a failed check — the server refuses with the reason
    } finally {
      setChecking(false);
    }
    if (st && !st.ready) setPending({ status: st, name, proceed });
    else proceed();
  }, []);

  /** Show the pop-up for a refusal that came back from a schedule call. */
  const showFromError = useCallback((message: string, requirementId?: number | null, name?: string | null) => {
    if (!isTemplateNotReadyError(message)) return false;
    setPending({ status: statusFromError(message, requirementId), name, proceed: () => undefined });
    return true;
  }, []);

  const modal = pending ? (
    <TemplateNotReadyModal status={pending.status} candidateName={pending.name}
      onClose={() => setPending(null)} onReady={pending.proceed} />
  ) : null;

  return { gate, showFromError, modal, checking };
}
