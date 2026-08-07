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
export function toInputValue(stamp?: string | null): string {
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
  onClose,
  onDone,
  showToast,
}: {
  profileId: number;
  candidate: ScheduleCandidateSeed;
  existing?: ScheduleExistingLink;
  initialWhen?: string;
  onClose: () => void;
  onDone: (res: AiScheduleResult | null) => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const isEdit = !!existing;
  const defaultWhen = useMemo(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 60, 0, 0); // an hour from now, on the minute
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
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    const cleanEmail = email.trim();
    if (!name.trim()) return setError("Candidate name is required");
    if (!cleanEmail) return setError("Candidate email is required — the invite is sent there");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return setError("Enter a valid email address");
    if (!when) return setError("Pick the interview date and time");

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
          },
        );
        showToast(
          sendEmail && !res.data?.email_sent
            ? `Interview scheduled, but the email did not send (${res.data?.email_error || "unknown error"})`
            : res.message || "AI interview scheduled",
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

  return (
    <Modal title={isEdit ? "Edit AI interview" : "Schedule AI interview"} onClose={onClose} medium>
      <WizFormShell
        title={isEdit ? "Edit AI interview" : "Schedule AI interview"}
        subtitle={
          isEdit
            ? "Change the date, time or candidate details. The existing invite link and access key stay valid."
            : "The candidate receives an invite email with the interview link and a secure access key."
        }
        icon={<Bot size={18} />}
      >
        {error && <ErrorBox error={error} />}

        <div className="grid gap-4 sm:grid-cols-2">
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
            {busy ? "Working…" : isEdit ? "Save changes" : "Schedule interview"}
          </button>
        </div>
      </WizFormShell>
    </Modal>
  );
}
