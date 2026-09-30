/**
 * Internal candidate → Sales, skipping L1 and L2 (25 Sep 2026).
 *
 * An existing Karnex employee has already been vetted by us, so RMG / GM may
 * hand them straight to Sales for customer screening. The server decides
 * everything — who is internal, from which stage, and whether this user may
 * (`profile.fast_track_internal`, read through `useCanApprove`) — and sends
 * the reason back as `block` when the move is not available. This file only
 * renders that answer; it never guesses from roles.
 *
 * Used by the Screening Desk (row detail) and the candidate profile page.
 */
import { useState } from "react";
import { BellRing, FastForward, Rocket, Send, ShieldCheck } from "lucide-react";

import { crmPost } from "../api";
import { useCanApprove } from "../useAccess";
import { DecisionDialog, type DecisionSpec } from "./dialogKit";
import { Field, Modal, btnPrimary, btnSecondary, inputCls } from "./ui";

/** The employee a candidate IS — server-derived (services/screening_desk.py). */
export type InternalEmployee = {
  employee_id: number;
  employee_code: string | null;
  name: string;
  /** "Deployed" | "Bench" today. */
  deployment: string | null;
  projects: { project_id: number; project: string | null; customer: string | null }[];
  is_resigned: boolean;
};

/** Mirror of services.screening_desk.MIN_FAST_TRACK_NOTE. */
export const MIN_FAST_TRACK_NOTE = 10;

export function useCanFastTrack(): boolean {
  return useCanApprove("profile.fast_track_internal");
}

/** "KX-010 · Bench" — the chip every internal row carries. */
export function InternalChip({ employee }: { employee: InternalEmployee }) {
  const bench = employee.deployment === "Bench";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        bench ? "bg-warning-soft text-warning" : "bg-info-soft text-info"}`}
      title={`Existing Karnex employee${employee.name ? ` (${employee.name})` : ""} — ${
        bench ? "on the bench today" : "deployed on a project today"}`}
    >
      Internal{employee.employee_code ? ` · ${employee.employee_code}` : ""} · {employee.deployment || "—"}
    </span>
  );
}

export function FastTrackButton({
  profileId, candidateName, employee, block, onDone, onError, className = btnPrimary,
}: {
  profileId: number;
  candidateName: string;
  employee: InternalEmployee | null;
  /** The server's reason the move is unavailable; null when it is allowed. */
  block: string | null;
  onDone: (message: string) => void;
  onError: (message: string) => void;
  className?: string;
}) {
  const allowed = useCanFastTrack();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (!allowed || !employee) return null;

  const submit = async () => {
    if (note.trim().length < MIN_FAST_TRACK_NOTE) {
      setErr(`Give a reason of at least ${MIN_FAST_TRACK_NOTE} characters`);
      return;
    }
    setBusy(true);
    try {
      const res = await crmPost(`/api/candidate-profiles/${profileId}/fast-track-to-sales`, { note: note.trim() });
      setOpen(false);
      onDone(res.message || "Sent to Sales for customer screening");
    } catch (e: any) {
      onError(e?.message || "Could not send the candidate to Sales");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={!!block}
        title={block || "Internal candidate — skip the L1 and L2 rounds and hand them to Sales for customer screening"}
        onClick={() => { setOpen(true); setNote(""); setErr(""); }}
      >
        <FastForward size={15} /> Send to Sales (skip L1 & L2)
      </button>
      {open && (
        <Modal title="Send straight to Sales" onClose={() => { if (!busy) setOpen(false); }} dirty={note.trim().length > 0}>
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              <b className="text-primary">{candidateName}</b> is an existing Karnex employee
              {employee.employee_code ? <> (<b>{employee.employee_code}</b>)</> : null}
              {employee.deployment ? <>, {employee.deployment === "Bench" ? "on the bench" : "deployed"} today</> : null}.
              They move to <b>Sales Screening</b> now — the L1 and L2 rounds are skipped. Sales is notified to
              submit them to the customer, and the TA who applied them is told no interview is needed.
            </p>
            <Field label="Why skip the rounds?" required error={err}>
              <textarea
                className={`${inputCls}${err ? " input-error" : ""}`}
                rows={3}
                value={note}
                onChange={(e) => { setNote(e.target.value); setErr(""); }}
                placeholder="e.g. Worked on the same stack for HARMAN until last month; RMG already knows their level"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button type="button" className={btnPrimary} onClick={() => void submit()} disabled={busy}>
                <FastForward size={15} /> {busy ? "Sending…" : "Send to Sales"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

const DIRECT_SPEC: DecisionSpec = {
  tone: "emerald", icon: Rocket, eyebrow: "Screening Desk · direct submission",
  title: "Send straight to Sales for the customer round",
  intro: <>A strong match for the position skips the technical L1 / L2. The candidate moves to
    <b> Sales Screening</b> now; Sales is told to submit them to the customer and the TA is told no
    interview needs booking.</>,
  flow: { steps: ["Technical Screening", "Sales Screening", "Customer round"], current: 1 },
  reason: { label: "Why skip the rounds?", required: true, min: MIN_FAST_TRACK_NOTE,
    placeholder: "e.g. Exact stack and domain the customer asked for; 6 years on the same product",
    picks: ["Exact skill match with the JD", "Strong ATS score and relevant CV",
      "Domain experience the customer asked for", "Referred by the customer"] },
  happens: [
    { icon: Send, text: "Reads \"Sales Screening\" on every screen — Sales owns the candidate now." },
    { icon: BellRing, text: "Sales and the TA who applied them are notified with your reason." },
    { icon: ShieldCheck, text: "The reason is logged on the profile as the record of the skipped rounds." },
  ],
  confirmLabel: "Send to Sales", busyLabel: "Sending…",
};

/** RMG / GM's direct submission (30 Sep 2026): ANY candidate on the desk who is a
 *  close match can go straight to Sales for the customer round, reason mandatory.
 *  The server's `block` says when the move is unavailable (already with Sales). */
export function DirectToSalesButton({
  profileId, candidateName, context, block, onDone, className = btnPrimary,
}: {
  profileId: number;
  candidateName: string;
  context?: string | null;
  block: string | null | undefined;
  onDone: (message: string) => void;
  className?: string;
}) {
  const allowed = useCanApprove("profile.rmg_screening");
  const [open, setOpen] = useState(false);
  if (!allowed) return null;
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={!!block}
        title={block || "Strong match — skip the technical rounds and send them to Sales for the customer round"}
        onClick={() => setOpen(true)}
      >
        <Rocket size={15} /> Direct to Sales
      </button>
      {open && (
        <DecisionDialog
          spec={DIRECT_SPEC}
          person={{ name: candidateName, meta: context || undefined }}
          onClose={() => setOpen(false)}
          onConfirm={async (note) => {
            const res = await crmPost(`/api/candidate-profiles/${profileId}/direct-to-sales`, { note });
            setOpen(false);
            onDone(res.message || "Sent to Sales for the customer round");
          }}
        />
      )}
    </>
  );
}

/** Profile page banner: appears only for an internal candidate the user may fast-track. */
export function FastTrackBanner({
  profileId, candidateName, employee, block, onDone, onError,
}: {
  profileId: number;
  candidateName: string;
  employee: InternalEmployee | null | undefined;
  block: string | null | undefined;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const allowed = useCanFastTrack();
  if (!allowed || !employee || block) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-card border border-subtle bg-info-soft px-5 py-3">
      <div className="text-sm text-info">
        <b>Internal candidate</b> — {employee.name || "existing employee"}
        {employee.employee_code ? ` (${employee.employee_code})` : ""}, {employee.deployment === "Bench"
          ? "on the bench" : "deployed"} today. You can skip the L1 and L2 rounds and send them straight to Sales.
      </div>
      <FastTrackButton
        profileId={profileId}
        candidateName={candidateName}
        employee={employee}
        block={null}
        onDone={onDone}
        onError={onError}
      />
    </div>
  );
}
