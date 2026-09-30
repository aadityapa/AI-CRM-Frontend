/**
 * Schedule a manual Technical L1 / L2 round (30 Sep 2026, user ask: "redesign
 * this pop-up best of best, the same for all roles").
 *
 * ONE dialog for every place a human technical round is booked — Applied
 * Candidates (TA), the profile's RMG banner and the Screening Desk ladder /
 * My Tasks (RMG / GM). It used to be three copies with three sets of rules.
 * POST /api/candidate-profiles/{id}/l2-face-to-face {round, scheduled_at,
 * meeting_link, interviewer, note} — `scheduled_at` is the typed IST wall
 * clock (never `toISOString()`, which shifts it 5h30).
 *
 * Four numbered steps (who · when · where · note), each ticking when done,
 * quick time picks, the meeting provider recognised from the link, and a
 * "what happens" list so the person booking knows who is told.
 */
import { useMemo, useState } from "react";
import {
  BellRing, CalendarCheck2, CalendarClock, ExternalLink, Link2, Mail, MailX, UsersRound, Video,
} from "lucide-react";

import { crmPost } from "../api";
import { InterviewerSelect } from "./InterviewerSelect";
import {
  DialogActions, DialogFailure, DialogHero, DialogSection, QuickPicks, WhatHappens, useCtrlEnter,
} from "./dialogKit";
import { Modal, inputCls } from "./ui";

export type ManualRound = "L1" | "L2";

const pad = (n: number) => String(n).padStart(2, "0");
/** A local Date → the "YYYY-MM-DDTHH:MM" a datetime-local field holds. */
const toInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const at = (base: Date, addDays: number, h: number, m = 0) => {
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  d.setHours(h, m, 0, 0);
  return d;
};

/** One-click times (PURE given `now`): the slots a recruiter actually offers. */
export function quickTimes(now: Date = new Date()): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (now.getHours() < 15) out.push({ label: "Today 4:00 PM", value: toInput(at(now, 0, 16)) });
  out.push({ label: "Tomorrow 11:00 AM", value: toInput(at(now, 1, 11)) });
  out.push({ label: "Tomorrow 3:00 PM", value: toInput(at(now, 1, 15)) });
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  out.push({ label: "Next Monday 11:00 AM", value: toInput(at(now, toMonday, 11)) });
  return out;
}

/** "Microsoft Teams" / "Google Meet" / … from a meeting link (PURE). */
export function meetingProvider(link: string): string | null {
  const l = link.trim().toLowerCase();
  if (!/^https?:\/\//.test(l)) return null;
  if (l.includes("teams.microsoft.com") || l.includes("teams.live.com")) return "Microsoft Teams";
  if (l.includes("meet.google.com")) return "Google Meet";
  if (l.includes("zoom.us")) return "Zoom";
  if (l.includes("webex.com")) return "Webex";
  return "Video call";
}

function describeWhen(v: string): { text: string; rel: string; past: boolean } | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const mins = Math.round((d.getTime() - Date.now()) / 60000);
  const past = mins < 0;
  const abs = Math.abs(mins);
  const span = abs < 60 ? `${abs} min` : abs < 48 * 60 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} days`;
  return {
    text: d.toLocaleString("en-IN", { weekday: "long", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }),
    rel: past ? `${span} ago` : `in ${span}`,
    past,
  };
}

const LINK_RE = /^https?:\/\/\S+$/i;

export function ScheduleManualRoundModal({
  profileId, round, candidateName, candidateEmail, context, defaultInterviewer = "",
  interviewerRequired, interviewerHint, onClose, onDone,
}: {
  profileId: number;
  round: ManualRound;
  candidateName: string;
  candidateEmail?: string | null;
  /** Position / opportunity line under the name. */
  context?: string | null;
  defaultInterviewer?: string;
  /** Defaults to L1 only: an L2 left blank goes to the RMG who asked for it. */
  interviewerRequired?: boolean;
  interviewerHint?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const needWho = interviewerRequired ?? round === "L1";
  const [who, setWho] = useState(defaultInterviewer);
  const [when, setWhen] = useState("");
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [errs, setErrs] = useState<{ who?: string; when?: string; link?: string }>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const picks = useMemo(() => quickTimes(), []);
  const whenInfo = describeWhen(when);
  const provider = meetingProvider(link);
  const linkOk = LINK_RE.test(link.trim());
  const label = round === "L1" ? "Technical L1" : "Technical L2";
  const email = candidateEmail && !candidateEmail.endsWith("@import.karnex.in") ? candidateEmail : null;

  const missing = [
    needWho && !who.trim() && "the interviewer",
    !when && "the date & time",
    !linkOk && "the meeting link",
  ].filter(Boolean) as string[];

  const submit = async () => {
    if (busy) return;
    const e: typeof errs = {};
    if (needWho && !who.trim()) e.who = "Pick the employee taking this interview";
    if (!when.trim()) e.when = "Pick the date and time of the call";
    if (!link.trim()) e.link = "Paste the meeting link the candidate should join";
    else if (!linkOk) e.link = "Enter the full link, starting with https://";
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setFailure("");
    try {
      const res = await crmPost(`/api/candidate-profiles/${profileId}/l2-face-to-face`, {
        round, scheduled_at: when.trim(), meeting_link: link.trim(),
        interviewer: who.trim() || null, note: note.trim() || null,
      });
      onDone(res.message || `${label} scheduled — the candidate and TA are told`);
    } catch (err: any) {
      setFailure(err?.message || `Could not schedule the ${label}`);
      setBusy(false);
    }
  };
  useCtrlEnter(() => void submit());

  return (
    <Modal
      title={`Schedule the ${label} — ${candidateName}`}
      medium
      onClose={() => { if (!busy) onClose(); }}
      dirty={!!(when || link || note.trim() || who !== defaultInterviewer)}
      hero={
        <DialogHero
          tone="indigo"
          icon={UsersRound}
          eyebrow={`${label} · manual round`}
          title={`Schedule the ${label} interview`}
          subtitle="A live call — the candidate and the interviewer join the meeting link. Decide after the call."
          person={{ name: candidateName, meta: context || undefined }}
          flow={{ steps: ["Book the call", "Candidate joins", "Record the verdict"], current: 0 }}
        />
      }
      footer={
        <DialogActions
          tone="indigo" icon={CalendarCheck2} label="Schedule & notify" busyLabel="Scheduling…" busy={busy}
          onCancel={onClose} onConfirm={() => void submit()}
          hint={missing.length
            ? <span>Still needed: <b className="text-primary">{missing.join(", ")}</b></span>
            : <span className="font-semibold text-success">Ready — Ctrl + Enter to schedule</span>}
        />
      }
    >
      <div className="space-y-3">
        <DialogSection n={1} tone="indigo" title="Who runs the round" done={!!who.trim()} optional={!needWho}
          hint={interviewerHint || (needWho
            ? "The employee taking the interview — named on the candidate's invite."
            : "Leave blank and it goes to the RMG who asked for this round.")}>
          <InterviewerSelect value={who} err={errs.who}
            onChange={(v) => { setWho(v); setErrs((p) => ({ ...p, who: undefined })); }}
            placeholder="Search the employee taking this interview…" />
          {errs.who && <p className="mt-1 text-xs font-semibold text-danger" role="alert">{errs.who}</p>}
        </DialogSection>

        <DialogSection n={2} tone="indigo" title="When" done={!!whenInfo && !whenInfo.past} hint="India time (IST).">
          <div className="mb-2.5">
            <QuickPicks label="Quick times" tone="indigo" options={picks.map((p) => p.label)}
              active={picks.find((p) => p.value === when)?.label ?? null}
              onPick={(l) => { const p = picks.find((x) => x.label === l); if (p) { setWhen(p.value); setErrs((e) => ({ ...e, when: undefined })); } }} />
          </div>
          <div className="relative">
            <CalendarClock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <input type="datetime-local" aria-label="Date and time" className={`${inputCls} pl-9${errs.when ? " input-error" : ""}`}
              value={when} onChange={(e) => { setWhen(e.target.value); setErrs((p) => ({ ...p, when: undefined })); }} />
          </div>
          {whenInfo && (
            <p className={`mt-1.5 text-xs font-semibold ${whenInfo.past ? "text-warning" : "text-success"}`}>
              {whenInfo.text} IST · {whenInfo.past ? `this time has passed (${whenInfo.rel})` : whenInfo.rel}
            </p>
          )}
          {errs.when && <p className="mt-1 text-xs font-semibold text-danger" role="alert">{errs.when}</p>}
        </DialogSection>

        <DialogSection n={3} tone="indigo" title="Meeting link" done={linkOk}
          hint="Teams, Meet or Zoom — the candidate joins from their invite."
          action={provider ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
              <Video className="h-3 w-3" aria-hidden /> {provider}
            </span>
          ) : undefined}>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <input aria-label="Meeting link" className={`${inputCls} pl-9${errs.link ? " input-error" : ""}`}
                placeholder="https://teams.microsoft.com/l/meetup-join/…" value={link}
                onChange={(e) => { setLink(e.target.value); setErrs((p) => ({ ...p, link: undefined })); }} />
            </div>
            {linkOk && (
              <a href={link.trim()} target="_blank" rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 rounded-control border border-subtle px-3 text-xs font-semibold text-secondary hover:bg-surface-2 hover:text-primary">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Test
              </a>
            )}
          </div>
          {errs.link && <p className="mt-1 text-xs font-semibold text-danger" role="alert">{errs.link}</p>}
        </DialogSection>

        <DialogSection n={4} tone="indigo" title="Note for the candidate / TA" optional done={!!note.trim()}>
          <textarea className={`${inputCls} resize-y`} rows={2} maxLength={1000} value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Keep your project portfolio ready · join 5 minutes early" />
        </DialogSection>

        <WhatHappens tone="indigo" items={[
          email
            ? { icon: Mail, text: <>The candidate gets the invite with a calendar file at <b className="text-primary">{email}</b>.</> }
            : { icon: MailX, text: "No email on file — share the meeting link with the candidate yourself." },
          { icon: BellRing, text: "The TA who applied the candidate is told the time and the link." },
          { icon: CalendarCheck2, text: `The ${label} shows on the Interviews tab — record the verdict after the call.` },
        ]} />
        <DialogFailure message={failure} />
      </div>
    </Modal>
  );
}
