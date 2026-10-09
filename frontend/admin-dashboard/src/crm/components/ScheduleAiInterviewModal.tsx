/**
 * Schedule / reschedule an AI L1 interview.
 *
 * Lifted out of Profiles.tsx so the Calendar page can open it too. It used to
 * be a private function inside that 3,000-line page, which meant importing it
 * would have pulled the whole Profiles bundle into the calendar route.
 *
 * The component is profile-scoped by design — both endpoints live under
 * /api/candidate-profiles/{profileId}/ai-interviews — so callers must supply a
 * profile id. The calendar gets one from the event it was opened from, or from
 * the candidate picker when scheduling into an empty slot.
 */
import React, { useMemo, useState } from "react";
import { Bot } from "lucide-react";

import { crmPost, crmPut } from "../api";
import { realEmail } from "../lib/candidateEmail";
import { useAiEngine } from "../../lib/aiEngine";
import { ErrorBox, Modal, btnPrimary, btnSecondary, inputCls } from "./ui";
import { SectionHeaderBanner, WizardField } from "./wizard";

/**
 * The wizard chrome the CRM's single-screen dialogs use.
 *
 * Duplicated from Profiles.tsx rather than imported, because it is a private
 * helper there and importing it would recreate exactly the bundle dependency
 * this extraction removes. It is six lines of layout.
 */
function WizFormShell({
  title, subtitle, icon, children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="crm-wizard wiz-noise min-h-full w-full bg-[color:var(--wiz-bg)] px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-3xl">
        <SectionHeaderBanner title={title} description={subtitle} icon={icon} />
        {children}
      </div>
    </div>
  );
}

/** Minimal shape needed to prefill the form; the full profile type is not required. */
export type ScheduleCandidateSeed = {
  full_name?: string | null;
  email?: string | null;
} | null | undefined;

/** The subset of an existing AI link this modal reads when editing. */
export type ScheduleExistingLink = {
  id: number;
  scheduled_at_local?: string | null;
  candidate_name?: string | null;
  candidate_email?: string | null;
};

/**
 * A fresh link after an AI L1 that already RAN without a pass (7 Oct 2026):
 * what the previous one ended as, printed in the dialog, and a required note
 * (`reschedule_note`) — why a new link is going out, typically "candidate
 * confirmed on the phone they will sit it on Thursday". The server refuses a
 * reschedule without it, and keeps the old verdict on record.
 */
export type RescheduleSeed = {
  /** "Not attempted" · "Failed (42%)" · "On Hold" — the previous outcome. */
  previous: string;
  /** True when the candidate never answered a question (the common case). */
  notAttempted?: boolean;
  /** 8 Oct 2026: the previous AI L1 PASSED — a fresh link must void it. */
  passed?: boolean;
};

export const MIN_RESCHEDULE_NOTE = 5;
/** Voiding a recorded verdict needs a real reason (server: 10). */
export const MIN_VOID_NOTE = 10;

export type AiScheduleResult = {
  session_ref: string | null;
  invite_url: string | null;
  access_key?: string | null;
  email_sent?: boolean;
  email_error?: string;
};

/** `Date` -> "YYYY-MM-DD HH:MM" in local time (what the backend stores). */
export function toLocalStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** Backend stamp -> the value a <input type="datetime-local"> expects. */
function toInputValue(stamp?: string | null): string {
  const s = String(stamp || "").trim();
  if (!s) return "";
  return s.includes("T") ? s.slice(0, 16) : s.replace(" ", "T").slice(0, 16);
}

export function ScheduleAiInterviewModal({
  profileId,
  candidate,
  existing,
  /** Prefill the date/time — the calendar passes the slot that was clicked. */
  initialWhen,
  reschedule,
  onClose,
  onDone,
  showToast,
}: {
  profileId: number;
  candidate: ScheduleCandidateSeed;
  existing?: ScheduleExistingLink;
  initialWhen?: string;
  /** Create mode only: a NEW link over a finished AI L1 (see RescheduleSeed). */
  reschedule?: RescheduleSeed;
  onClose: () => void;
  onDone: (res: AiScheduleResult | null) => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const isEdit = !!existing;
  const isReschedule = !isEdit && !!reschedule;
  const defaultWhen = useMemo(() => {
    // Default to NOW (on the minute) so "schedule → the candidate takes it now"
    // works immediately. Picking a future time still schedules a wait; leaving
    // this an hour ahead used to strand candidates on a countdown they couldn't see.
    const d = new Date();
    d.setSeconds(0, 0);
    return toLocalStamp(d);
  }, []);

  const [when, setWhen] = useState(
    toInputValue(existing?.scheduled_at_local || initialWhen || defaultWhen),
  );
  const [name, setName] = useState(existing?.candidate_name || candidate?.full_name || "");
  // realEmail(), not candidate.email — a placeholder address would send the invite
  // into a black hole. Leaving it blank forces a real one to be typed.
  const [email, setEmail] = useState(
    existing?.candidate_email || realEmail(candidate?.email) || "",
  );
  const [notes, setNotes] = useState("");
  const [why, setWhy] = useState("");
  // Void the previous AI L1 (8 Oct 2026): forced for a PASS, optional otherwise
  // (e.g. a fail on the wrong template should not count either).
  const [voidPrev, setVoidPrev] = useState(!!reschedule?.passed);
  const voiding = isReschedule && (voidPrev || !!reschedule?.passed);
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const engine = useAiEngine();

  const submit = async () => {
    const cleanEmail = email.trim();
    if (!name.trim()) return setError("Candidate name is required");
    if (!cleanEmail) return setError("Candidate email is required — the invite is sent there");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return setError("Enter a valid email address");
    if (!when) return setError("Pick the interview date and time");
    if (voiding && why.trim().length < MIN_VOID_NOTE) {
      return setError("Say why the previous AI L1 does not count — e.g. it ran on the wrong interview template (at least 10 characters)");
    }
    if (isReschedule && why.trim().length < MIN_RESCHEDULE_NOTE) {
      return setError("Say why a fresh link is going out — e.g. when the candidate confirmed they will attempt it");
    }

    setError("");
    setBusy(true);
    const scheduled_at = when.replace("T", " ").slice(0, 16);
    try {
      if (isEdit) {
        const res = await crmPut<{ email_sent?: boolean; email_error?: string }>(
          `/api/candidate-profiles/${profileId}/ai-interviews/${existing!.id}`,
          {
            scheduled_at,
            candidate_name: name.trim(),
            candidate_email: cleanEmail,
            notes: notes.trim() || undefined,
            resend_email: sendEmail,
          },
        );
        showToast(
          sendEmail && !res.data?.email_sent
            ? `Interview updated, but the email did not send (${res.data?.email_error || "unknown error"})`
            : res.message || "Interview updated",
          sendEmail && !res.data?.email_sent ? "err" : "ok",
        );
        onDone(null);
      } else {
        const res = await crmPost<AiScheduleResult>(
          `/api/candidate-profiles/${profileId}/ai-interviews`,
          {
            scheduled_at,
            candidate_name: name.trim(),
            candidate_email: cleanEmail,
            notes: notes.trim() || undefined,
            send_email: sendEmail,
            reschedule_note: isReschedule ? why.trim() : undefined,
            void_previous: voiding || undefined,
          },
        );
        showToast(
          sendEmail && !res.data?.email_sent
            ? `Interview scheduled, but the email did not send (${res.data?.email_error || "unknown error"})`
            : res.message || (isReschedule ? "New AI L1 link sent" : "AI interview scheduled"),
          sendEmail && !res.data?.email_sent ? "err" : "ok",
        );
        onDone(res.data);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to schedule the AI interview");
    } finally {
      setBusy(false);
    }
  };

  const title = isEdit ? "Edit AI interview" : reschedule?.passed ? "Redo AI L1" : isReschedule ? "Reschedule AI L1" : "Schedule AI interview";
  return (
    <Modal title={title} onClose={onClose} medium>
      <WizFormShell
        title={title}
        subtitle={
          (isEdit
            ? "Change the date, time or candidate details. The existing invite link and access key stay valid."
            : isReschedule
              ? "A NEW invite link and access key go to the candidate. The previous interview stays on record; every screen follows this one from now on."
              : "The candidate receives an invite email with the interview link and a secure access key.") +
          (engine?.interview ? ` Runs on ${engine.interview.label} · questions and scoring.` : "")
        }
        icon={<Bot size={18} />}
      >
        {error && <ErrorBox error={error} />}
        {isReschedule && (
          <div className="mb-4 rounded-card border border-warning bg-warning-soft px-3 py-2 text-sm text-primary">
            <span className="font-semibold">Previous AI L1: {reschedule!.previous}.</span>{" "}
            {reschedule!.passed
              ? "This AI L1 PASSED. Redo it only when it was not a fair test of this role — it asked another position's questions (wrong interview template). The pass is voided: kept on record, labelled, and no longer counts."
              : reschedule!.notAttempted
                ? "The candidate did not answer any question — the link was opened late, the session dropped, or it was never started. Send a fresh link only once they have confirmed they will attempt it."
                : "Send a fresh link only once the candidate has confirmed they will attempt it again; RMG / GM are told so nobody acts on the old result."}
          </div>
        )}
        {isReschedule && !reschedule!.passed && (
          <label className="mb-4 flex items-start gap-2 text-sm text-secondary">
            <input type="checkbox" className="mt-1" checked={voidPrev} onChange={(e) => setVoidPrev(e.target.checked)} />
            <span>
              The previous AI L1 does not count — it ran on the wrong interview template.
              <span className="block text-xs text-muted">It is labelled “Voided” on the candidate's history.</span>
            </span>
          </label>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {isReschedule && (
            <WizardField label={voiding ? "Why the previous AI L1 does not count" : "Why a fresh link — the candidate's confirmation"} required className="sm:col-span-2">
              <textarea
                rows={2}
                className={inputCls}
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                placeholder={voiding
                  ? "e.g. The first AI L1 ran on the AGM ADAS template, not Bluetooth Developer — RMG has linked the right template"
                  : "e.g. Called on 7 Oct — power cut during the first attempt; confirmed they will sit it Thursday 11 AM"}
              />
              <p className="mt-1 text-xs text-muted">
                Logged on the candidate's history beside the previous outcome, and sent to RMG / GM.
              </p>
            </WizardField>
          )}
          <WizardField label="Interview date & time" required className="sm:col-span-2">
            <input
              type="datetime-local"
              className={inputCls}
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted">
              Your local time. This is what the candidate sees in the invite email.
            </p>
          </WizardField>

          <WizardField label="Candidate name" required>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
            />
          </WizardField>

          <WizardField label="Candidate email" required>
            <input
              type="email"
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
            <p className="mt-1 text-xs text-muted">
              The invite and access key go here. Editing this does not change the candidate record.
            </p>
          </WizardField>

          <WizardField label="Note for the candidate" className="sm:col-span-2">
            <textarea
              rows={2}
              className={inputCls}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional — e.g. please join from a quiet room with a working webcam"
            />
          </WizardField>

          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
            />
            <span>
              {isEdit ? "Re-send the invite email now" : "Email the invite to the candidate now"}
              <span className="block text-xs text-muted">
                Uncheck to only generate the link and share it yourself.
              </span>
            </span>
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={submit} disabled={busy}>
            {busy ? "Working…" : isEdit ? "Save changes" : isReschedule ? "Send new link" : "Schedule interview"}
          </button>
        </div>
      </WizFormShell>
    </Modal>
  );
}
