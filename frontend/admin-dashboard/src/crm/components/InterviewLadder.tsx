/**
 * InterviewLadder (28 Sep 2026) — the technical interview ladder of one candidate,
 * as RMG / GM work it from the Screening Desk: AI L1 → manual L1 → L2 (→ L3/L4),
 * each rung with the action that is due NOW.
 *
 *  - Renders what the desk row already carries (`ai_l1`, `rounds`, from the
 *    same batched helpers the Applied Candidates tab reads) and loads the full
 *    round list + AI links lazily, so the queue stays one request.
 *  - Every action reuses the profile endpoints — nothing is re-implemented:
 *      book a round      POST …/l2-face-to-face {round, scheduled_at, meeting_link, interviewer, note}
 *      ask TA to book    POST …/l2-request {round}
 *      record feedback   PUT  …/interview-rounds/{id} {status: Completed, result, feedback}
 *      reschedule        PUT  …/interview-rounds/{id} {scheduled_at, meeting_link, interviewer}
 *      extra round       POST …/interview-rounds {kind: L3_Interview | L4_Interview, …}
 *      AI L1             ScheduleAiInterviewModal (existing) · DELETE …/ai-interviews/{id}
 *    The server decides who may (a GM holding the screening approval acts as
 *    RMG — services/action_permissions.screens_as_rmg); the UI only offers.
 *  - ⚠️ datetime-local values are sent as the typed IST wall clock ("T" → " "
 *    for the AI link, as-is for a round) — never `toISOString()` on these paths.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot, CalendarClock, CalendarPlus, CheckCircle2, Circle, ClipboardCheck, Clock, ExternalLink, Link2, MessageSquareText,
  Pencil, Plus, Send, Trash2, UserRound, Users,
} from "lucide-react";

import { crmDelete, crmGet, crmPost, crmPut } from "../api";
import { fmtDateTime12, isoToIstInput } from "../../lib/datetime";
import { STATE_CHIP, type StateTone } from "./controlTower";
import { FLOW_BTN, roundHasStarted } from "./flowButtons";
import { ROUND_KIND_LABEL, roundUserRole } from "../lib/interviewRounds";
import { AiInterviewOverview } from "./AiInterviewOverview";
import { ScheduleAiInterviewModal, type ScheduleExistingLink } from "./ScheduleAiInterviewModal";
import { ScheduleManualRoundModal } from "./ScheduleManualRoundModal";
import { DialogActions, DialogHero, ReasonBox, WhatHappens, type DialogTone } from "./dialogKit";
import {
  ConfirmModal, Field, Modal, btnDanger, btnPrimary, btnSecondary, inputCls,
} from "./ui";

/* ---------- shapes (mirror backend services/screening_desk.py) ---------- */

export type AiL1 = {
  ai_interview_status: string | null;
  ai_interview_result: string | null;
  ai_overall_score_percent: number | null;
  ai_hr_decision: string | null;
  ai_hr_decision_label: string | null;
  ai_effective_result: string | null;
  ai_is_overridden: boolean;
  ai_interview_completed_at: string | null;
  ai_report_link: string | null;
};

export type LadderRounds = {
  l1_requested: boolean; l1_scheduled: boolean; l1_event_id: number | null; l1_result: string | null;
  l1_when: string | null; l1_link: boolean;
  l2_requested: boolean; l2_scheduled: boolean; l2_event_id: number | null; l2_result: string | null;
  l2_when: string | null; l2_link: boolean;
  /** RMG / GM chose the AI L1 and TA is scheduling it (28 Sep 2026). */
  ai_requested?: boolean;
};

type Round = {
  id: number; kind: string; scheduled_at: string | null; raw_when: string | null;
  meeting_link: string | null; status: string | null; result: string | null;
  interviewer: string | null; feedback: string | null; note: string | null;
  employee_id: number | null; duration_minutes: number | null;
};

type AiLink = {
  id: number; result: string | null; effective_result: string | null; overall_score_percent: number | null;
  scheduled_at_local: string | null; invite_url: string | null; report_link: string | null;
  can_modify: boolean; started: boolean; session_status: string | null;
  candidate_name?: string | null; candidate_email?: string | null; completed_at?: string | null;
};

export type Options = {
  results: string[];
  employees: { id: number; full_name: string; email: string | null; employee_code: string | null }[];
  writable_rounds: string[];
};

export const TECH_KINDS: Record<string, string> = {
  L1_Interview: "Manual L1", L2_F2F: "L2", L3_Interview: "L3", L4_Interview: "L4",
};

type ToastFn = (msg: string, kind?: "ok" | "err") => void;

const RESULT_TONE = (r: string | null | undefined): StateTone =>
  !r ? "none" : /hire$/i.test(r) && !/no hire/i.test(r) ? "ok" : /leaning hire/i.test(r) ? "ok" : /leaning no/i.test(r) ? "warn" : "bad";

const AI_TONE = (r: string | null | undefined): StateTone =>
  !r || r === "Pending" ? "none" : /select|pass|shortlist/i.test(r) ? "ok" : "bad";

/* ================================================================== */

export function InterviewLadder({
  profileId, candidate, stage, ai, rounds, resultsScale, onChanged, showToast,
}: {
  profileId: number;
  candidate: { full_name: string; email: string | null };
  stage: string;
  ai: AiL1 | null;
  rounds: LadderRounds;
  resultsScale: string[];
  /** Something changed on the server — the caller reloads the queue row. */
  onChanged: (message?: string) => void;
  showToast: ToastFn;
}) {
  const [open, setOpen] = useState<null | "ai_schedule" | "ai_cancel" | "add_round">(null);
  const [book, setBook] = useState<{ round: "L1" | "L2" } | null>(null);
  const [feedback, setFeedback] = useState<Round | null>(null);
  const [edit, setEdit] = useState<Round | null>(null);
  const [removing, setRemoving] = useState<Round | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [allRounds, setAllRounds] = useState<Round[] | null>(null);
  const [links, setLinks] = useState<AiLink[] | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [showAi, setShowAi] = useState(false);

  const inReview = stage === "RMG_Review";
  const load = useCallback(async () => {
    try {
      const [r, l] = await Promise.all([
        crmGet<Round[]>(`/api/candidate-profiles/${profileId}/interview-rounds`),
        crmGet<AiLink[]>(`/api/candidate-profiles/${profileId}/ai-interviews`),
      ]);
      setAllRounds(r.data || []);
      setLinks(l.data || []);
    } catch (e: any) {
      showToast(e?.message || "Could not load the interview rounds", "err");
    }
  }, [profileId, showToast]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    crmGet<Options>(`/api/candidate-profiles/${profileId}/interview-rounds/options`)
      .then((r) => setOptions(r.data)).catch(() => setOptions(null));
  }, [profileId]);

  const changed = (msg?: string) => { void load(); onChanged(msg); };

  const byKind = useMemo(() => {
    const m = new Map<string, Round>();
    // newest-first list → keep the LATEST round of each kind, like the row does
    (allRounds || []).forEach((r) => { if (!m.has(r.kind)) m.set(r.kind, r); });
    return m;
  }, [allRounds]);
  // Until the full list arrives (and if it fails), the row's own batched facts
  // stand in — the feedback button must never wait for a second request.
  const stub = (kind: string, id: number | null, when: string | null, result: string | null): Round | null =>
    id == null ? null : { id, kind, scheduled_at: when, raw_when: null, meeting_link: null, status: result ? "Completed" : "Scheduled",
      result, interviewer: null, feedback: null, note: null, employee_id: null, duration_minutes: null };
  const l1 = byKind.get("L1_Interview") || stub("L1_Interview", rounds.l1_event_id, rounds.l1_when, rounds.l1_result);
  const l2 = byKind.get("L2_F2F") || stub("L2_F2F", rounds.l2_event_id, rounds.l2_when, rounds.l2_result);
  const extras = (allRounds || []).filter((r) => r.kind === "L3_Interview" || r.kind === "L4_Interview");
  const latestLink = (links || [])[0] || null;
  const aiTaken = !!ai || !!latestLink;
  const manualTaken = rounds.l1_requested || rounds.l1_scheduled || !!l1;
  const l1Done = !!(rounds.l1_result || l1?.result);
  const l2Open = (rounds.l2_requested || rounds.l2_scheduled || !!l2) && !(rounds.l2_result || l2?.result);
  // The L2 follows the L1's VERDICT (28 Sep 2026): a recorded manual L1, or an
  // AI L1 that finished — the server refuses the request before either.
  const aiDone = !!ai?.ai_effective_result && ai.ai_effective_result !== "Pending";
  const ladderCanGrow = inReview && (l1Done || (aiDone && !manualTaken)) && !l2Open;

  const askTa = async (round: "L1" | "L2") => {
    setAsking(round);
    try {
      const res = await crmPost(`/api/candidate-profiles/${profileId}/l2-request`, { round });
      changed(res.message || `TA notified — they will book the ${round}`);
    } catch (e: any) {
      showToast(e?.message || `Could not request the ${round}`, "err");
    } finally {
      setAsking(null);
    }
  };

  return (
    <div className="rounded-card border border-subtle bg-surface-1 shadow-raised">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-primary"><Users size={15} /> Interview rounds</h3>
        <span className="text-xs text-muted">{inReview ? "In RMG review — record each round, then decide." : "The route decides the first rung."}</span>
      </div>
      <ol className="divide-y divide-subtle">
        {/* ---------- AI L1 ---------- */}
        {(aiTaken || !manualTaken) && (
          <Rung
            icon={<Bot size={15} />}
            title="AI L1 interview"
            state={!aiTaken ? "todo" : ai?.ai_effective_result && ai.ai_effective_result !== "Pending" ? "done" : "live"}
            chip={aiTaken ? (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_CHIP[AI_TONE(ai?.ai_effective_result)]}`}>
                {ai?.ai_effective_result && ai.ai_effective_result !== "Pending"
                  ? `${ai.ai_effective_result}${ai.ai_overall_score_percent != null ? ` · ${Math.round(ai.ai_overall_score_percent)}%` : ""}${ai.ai_is_overridden ? " (override)" : ""}`
                  : "Scheduled — waiting for the candidate"}
              </span>
            ) : rounds.ai_requested
              ? <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">Chosen — TA is scheduling it</span>
              : <span className="text-xs text-muted">Not scheduled</span>}
            detail={latestLink ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                {latestLink.scheduled_at_local && <span><Clock size={11} className="mr-1 inline" />{latestLink.scheduled_at_local} IST</span>}
                {latestLink.invite_url && latestLink.can_modify && (
                  <button type="button" className="inline-flex items-center gap-1 text-brand-600 hover:underline"
                    onClick={() => { void navigator.clipboard?.writeText(latestLink.invite_url!); showToast("Interview link copied"); }}>
                    <Link2 size={11} /> Copy candidate link
                  </button>
                )}
              </span>
            ) : null}
            actions={
              <>
                {!aiTaken && !manualTaken && (
                  <button type="button" className={`${btnSecondary} !py-1 text-xs`} onClick={() => setOpen("ai_schedule")}>
                    <Bot size={13} /> Schedule AI L1
                  </button>
                )}
                {latestLink?.can_modify && (
                  <>
                    <button type="button" className={`${btnSecondary} !py-1 text-xs`} onClick={() => setOpen("ai_schedule")} title="Change the date / time">
                      <Pencil size={13} /> Reschedule
                    </button>
                    <button type="button" className={`${btnDanger} !py-1 text-xs`} onClick={() => setOpen("ai_cancel")}>Cancel</button>
                  </>
                )}
                {latestLink && ai?.ai_effective_result && ai.ai_effective_result !== "Pending" && (
                  <button type="button" className={`${btnSecondary} !py-1 text-xs`} onClick={() => setShowAi((v) => !v)}>
                    {showAi ? "Hide AI verdict" : "AI verdict & report"}
                  </button>
                )}
              </>
            }
          >
            {showAi && latestLink && (
              <div className="mt-3">
                <AiInterviewOverview profileId={profileId} linkId={latestLink.id} reportLink={latestLink.report_link} />
              </div>
            )}
          </Rung>
        )}

        {/* ---------- manual L1 ---------- */}
        {(manualTaken || (!aiTaken && inReview)) && (
          <RoundRung
            label="Manual L1"
            requested={rounds.l1_requested}
            round={l1}
            canBook={inReview}
            askBusy={asking === "L1"}
            onAsk={() => void askTa("L1")}
            onBook={() => setBook({ round: "L1" })}
            onFeedback={() => l1 && setFeedback(l1)}
            onEdit={() => l1 && setEdit(l1)}
          />
        )}

        {/* ---------- L2 ---------- */}
        {(rounds.l2_requested || rounds.l2_scheduled || l2 || ladderCanGrow) && (
          <RoundRung
            label="L2"
            requested={rounds.l2_requested}
            round={l2}
            canBook={inReview}
            optional
            blocked={!ladderCanGrow && !l2 && !rounds.l2_requested ? "Record the L1 outcome first" : null}
            askBusy={asking === "L2"}
            onAsk={() => void askTa("L2")}
            onBook={() => setBook({ round: "L2" })}
            onFeedback={() => l2 && setFeedback(l2)}
            onEdit={() => l2 && setEdit(l2)}
          />
        )}

        {/* ---------- L3 / L4 ---------- */}
        {extras.map((r) => (
          <RoundRung key={r.id} label={TECH_KINDS[r.kind] || r.kind} requested={false} round={r} canBook={inReview}
            onAsk={() => undefined} onBook={() => undefined} onFeedback={() => setFeedback(r)} onEdit={() => setEdit(r)}
            onRemove={() => setRemoving(r)} />
        ))}
        {inReview && l1Done && !l2Open && (
          <li className="px-4 py-2">
            <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline" onClick={() => setOpen("add_round")}>
              <Plus size={13} /> Add another round (L3 / L4)
            </button>
          </li>
        )}
      </ol>

      {open === "ai_schedule" && (
        <ScheduleAiInterviewModal
          profileId={profileId}
          candidate={candidate}
          existing={latestLink?.can_modify ? (latestLink as ScheduleExistingLink) : undefined}
          onClose={() => setOpen(null)}
          onDone={() => { setOpen(null); changed(); }}
          showToast={showToast}
        />
      )}
      {open === "ai_cancel" && latestLink && (
        <ConfirmModal
          title="Cancel the AI L1 interview?"
          message="The candidate's link stops working. You can schedule a new one afterwards."
          confirmLabel="Cancel interview"
          danger
          onClose={() => setOpen(null)}
          onConfirm={async () => {
            try {
              const res = await crmDelete(`/api/candidate-profiles/${profileId}/ai-interviews/${latestLink.id}`);
              setOpen(null); changed(res.message || "AI interview cancelled");
            } catch (e: any) { showToast(e?.message || "Could not cancel", "err"); }
          }}
        />
      )}
      {book && (
        <ScheduleManualRoundModal
          profileId={profileId}
          round={book.round}
          candidateName={candidate.full_name}
          candidateEmail={candidate.email}
          interviewerRequired={false}
          interviewerHint="Leave blank and you are the interviewer."
          onClose={() => setBook(null)}
          onDone={(msg) => { setBook(null); changed(msg); }}
        />
      )}
      {feedback && (
        <FeedbackModal
          profileId={profileId}
          round={feedback}
          candidateName={candidate.full_name}
          results={options?.results?.length ? options.results : resultsScale}
          onClose={() => setFeedback(null)}
          onDone={(msg) => { setFeedback(null); changed(msg); }}
          showToast={showToast}
        />
      )}
      {edit && (
        <EditRoundModal
          profileId={profileId}
          round={edit}
          employees={options?.employees || []}
          onClose={() => setEdit(null)}
          onDone={(msg) => { setEdit(null); changed(msg); }}
          showToast={showToast}
        />
      )}
      {open === "add_round" && (
        <EditRoundModal
          profileId={profileId}
          round={null}
          kinds={(options?.writable_rounds || ["L3_Interview", "L4_Interview"]).filter((k) => k === "L3_Interview" || k === "L4_Interview")}
          employees={options?.employees || []}
          onClose={() => setOpen(null)}
          onDone={(msg) => { setOpen(null); changed(msg); }}
          showToast={showToast}
        />
      )}
      {removing && (
        <ConfirmModal
          title={`Remove the ${TECH_KINDS[removing.kind] || removing.kind} round?`}
          message="The round and its feedback are deleted from the candidate's history."
          confirmLabel="Remove round"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            try {
              await crmDelete(`/api/candidate-profiles/${profileId}/interview-rounds/${removing.id}`);
              setRemoving(null); changed("Round removed");
            } catch (e: any) { showToast(e?.message || "Could not remove the round", "err"); }
          }}
        />
      )}
    </div>
  );
}

/* ---------- one rung ---------- */

function Rung({ icon, title, state, chip, detail, actions, children }: {
  icon: React.ReactNode; title: string; state: "todo" | "live" | "done";
  chip?: React.ReactNode; detail?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${
          state === "done" ? "bg-success-soft text-success" : state === "live" ? "bg-brand-50 text-brand-700 dark:bg-surface-2" : "bg-surface-2 text-muted"}`}>
          {state === "done" ? <CheckCircle2 size={15} /> : state === "todo" ? <Circle size={15} /> : icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-primary">{title}</span>
            {chip}
          </div>
          {detail && <div className="mt-1">{detail}</div>}
          {children}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
    </li>
  );
}

function RoundRung({
  label, requested, round, canBook, optional, blocked, askBusy, onAsk, onBook, onFeedback, onEdit, onRemove,
}: {
  label: string; requested: boolean; round: Round | null; canBook: boolean; optional?: boolean;
  blocked?: string | null; askBusy?: boolean;
  onAsk: () => void; onBook: () => void; onFeedback: () => void; onEdit: () => void; onRemove?: () => void;
}) {
  const booked = !!round;
  const done = !!round?.result;
  const state: "todo" | "live" | "done" = done ? "done" : booked || requested ? "live" : "todo";
  const chip = done ? (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_CHIP[RESULT_TONE(round!.result)]}`}>{round!.result}</span>
  ) : booked ? (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_CHIP.warn}`}>Booked — feedback due</span>
  ) : requested ? (
    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted">Requested — TA is booking</span>
  ) : optional ? (
    <span className="text-xs text-muted">Optional</span>
  ) : <span className="text-xs text-muted">Not booked</span>;
  return (
    <Rung
      icon={<UserRound size={15} />}
      title={`${label} round`}
      state={state}
      chip={chip}
      detail={round ? (
        <div className="space-y-1 text-xs text-muted">
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            <span><Clock size={11} className="mr-1 inline" />{round.scheduled_at ? fmtDateTime12(round.scheduled_at) : round.raw_when || "time not set"}</span>
            {round.interviewer && <span><UserRound size={11} className="mr-1 inline" />{round.interviewer}</span>}
            {round.meeting_link && (
              <a href={round.meeting_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                <ExternalLink size={11} /> Join link
              </a>
            )}
          </span>
          {round.feedback && <p className="rounded-control bg-surface-2 px-2.5 py-1.5 text-secondary"><b>Feedback:</b> {round.feedback}</p>}
        </div>
      ) : blocked ? <span className="text-xs text-muted">{blocked}</span> : null}
      actions={
        <>
          {!booked && !blocked && canBook && (
            <>
              <button type="button" className={`${btnPrimary} !py-1 text-xs`} onClick={onBook} title="Enter the time, the link and who takes the call">
                <CalendarPlus size={13} /> Book {label}
              </button>
              {!requested && (
                <button type="button" className={`${btnSecondary} !py-1 text-xs`} onClick={onAsk} disabled={askBusy}
                  title="Notify the TA owner — they agree a time with the candidate and enter it">
                  {askBusy ? "Asking…" : "Ask TA to book"}
                </button>
              )}
            </>
          )}
          {booked && !done && (
            /* Opens at the interview time (28 Sep 2026, user flow); amber once
               it is over — the same rule as the Applied Candidates row. */
            <button type="button"
              className={`${roundHasStarted(round?.scheduled_at) ? FLOW_BTN.warn : FLOW_BTN.manualOutline} !py-1`}
              onClick={onFeedback} disabled={!roundHasStarted(round?.scheduled_at)}
              title={roundHasStarted(round?.scheduled_at)
                ? "The interview is over — record the verdict so the candidate moves on"
                : "Opens at the interview time"}>
              <MessageSquareText size={13} /> {roundHasStarted(round?.scheduled_at) ? "Feedback due" : "Record feedback"}
            </button>
          )}
          {booked && (
            <button type="button" className={`${btnSecondary} !py-1 text-xs`} onClick={done ? onFeedback : onEdit} title={done ? "Change the result or feedback" : "Change the time, link or interviewer"}>
              <Pencil size={13} /> {done ? "Edit feedback" : "Edit"}
            </button>
          )}
          {booked && onRemove && (
            <button type="button" className={`${btnDanger} !py-1 text-xs`} onClick={onRemove} aria-label="Remove round"><Trash2 size={13} /></button>
          )}
        </>
      }
    />
  );
}

/* ---------- modals ---------- */

function EmployeePicker({ value, onChange, employees, label = "Who takes the call", required }: {
  value: string; onChange: (v: string) => void;
  employees: Options["employees"]; label?: string; required?: boolean;
}) {
  return (
    <Field label={label} required={required}>
      <input className={inputCls} list="ladder-employees" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="Type a name — pick from Employees or enter an external panellist" />
      <datalist id="ladder-employees">
        {employees.map((e) => <option key={e.id} value={e.full_name}>{e.employee_code || e.email || ""}</option>)}
      </datalist>
    </Field>
  );
}

/** Who runs the round decides the dialog's colour: customer sky, HR emerald, else indigo. */
const feedbackTone = (kind: string): DialogTone =>
  kind.startsWith("Customer") ? "sky" : kind === "HR_Interview" ? "emerald" : "indigo";

/** Record / edit one round's verdict. Exported (28 Sep 2026) — the interviews
 *  pop-up on Applied Candidates and the Dashboard desk use the same dialog. */
/** Feedback phrases that append into the box — the shape a good verdict has. */
const FEEDBACK_PICKS = ["Strong fundamentals", "Hands-on with the stack we need", "Communicates clearly",
  "Gaps in the basics", "Needs probing on design", "Good fit for the customer's domain"];

export function FeedbackModal({ profileId, round, results, candidateName, onClose, onDone, showToast }: {
  profileId: number;
  round: Pick<Round, "id" | "kind" | "result" | "feedback"> & Partial<Pick<Round, "scheduled_at" | "raw_when" | "interviewer" | "duration_minutes">>;
  results: string[];
  /** Printed in the dialog's header when the caller knows it. */
  candidateName?: string | null;
  onClose: () => void; onDone: (msg: string) => void; showToast: ToastFn;
}) {
  const [result, setResult] = useState(round.result || "");
  const [text, setText] = useState(round.feedback || "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const label = TECH_KINDS[round.kind] || ROUND_KIND_LABEL[round.kind] || round.kind;
  const tone = feedbackTone(round.kind);
  const editing = !!round.result;
  const when = round.scheduled_at ? fmtDateTime12(round.scheduled_at, round.raw_when || undefined) : round.raw_when || null;
  const facts = [
    when ? { icon: CalendarClock, text: when } : null,
    round.interviewer ? { icon: UserRound, text: round.interviewer } : null,
    round.duration_minutes ? { icon: Clock, text: `${round.duration_minutes} min` } : null,
  ].filter(Boolean) as { icon: typeof Clock; text: string }[];
  const submit = async () => {
    if (!result) { setErr("Pick the result"); return; }
    if (text.trim().length < 5) { setErr("Write the feedback — at least a line (5 characters)"); return; }
    setBusy(true);
    try {
      const res = await crmPut(`/api/candidate-profiles/${profileId}/interview-rounds/${round.id}`, {
        status: "Completed", result, feedback: text.trim(), user_role: roundUserRole(round.kind),
      });
      onDone(res.message || `${label} feedback recorded`);
    } catch (e: any) {
      showToast(e?.message || "Could not save the feedback", "err");
      setBusy(false);
    }
  };
  return (
    <Modal title={`${label} feedback`} medium onClose={() => { if (!busy) onClose(); }}
      dirty={result !== (round.result || "") || text !== (round.feedback || "")}
      hero={<DialogHero tone={tone} icon={ClipboardCheck} eyebrow={editing ? "Interview verdict · edit" : "Interview verdict"}
        title={`${label} feedback`} subtitle="Pick the result and say why — the candidate's status follows it on every screen."
        person={candidateName ? { name: candidateName, meta: label } : null}
        flow={{ steps: [label, "Verdict recorded", "Next step"], current: 1 }} />}
      footer={<DialogActions tone={tone} icon={ClipboardCheck} label={editing ? "Update feedback" : "Save feedback"} busy={busy}
        hint={!result ? "Pick a result to continue" : text.trim().length < 5 ? "A line of feedback is needed" : undefined}
        onCancel={onClose} onConfirm={() => void submit()} />}>
      <div className="space-y-4">
        {facts.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs text-secondary">
            {facts.map((f) => (
              <span key={f.text} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 font-medium">
                <f.icon size={12} aria-hidden /> {f.text}
              </span>
            ))}
          </div>
        )}
        <Field label="Result" required error={!result && err ? err : undefined}>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Result">
            {results.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={result === r}
                onClick={() => { setResult(r); setErr(""); }}
                className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors duration-micro ${
                  result === r ? `border-transparent ${STATE_CHIP[RESULT_TONE(r)]} ring-2 ring-brand-600` : "border-subtle bg-surface-1 text-secondary hover:bg-surface-2"}`}>
                {r}
              </button>
            ))}
          </div>
        </Field>
        <ReasonBox id={`fb-${round.id}`} label="Feedback" value={text} onChange={(v) => { setText(v); setErr(""); }}
          required min={5} rows={5} tone={tone} error={result && err ? err : undefined}
          placeholder="Strengths, gaps, communication, what the next round should probe…" picks={FEEDBACK_PICKS} />
        <WhatHappens tone={tone} items={[
          { icon: ClipboardCheck, text: "Shows on the candidate's profile (Interviews tab) and drives the status every screen prints." },
          { icon: Send, text: "Every screener is told the verdict is in; a failed verdict closes the candidacy." },
        ]} />
      </div>
    </Modal>
  );
}

/** Reschedule an existing round, or (round === null) add an L3 / L4. */
function EditRoundModal({ profileId, round, kinds, employees, onClose, onDone, showToast }: {
  profileId: number; round: Round | null; kinds?: string[]; employees: Options["employees"];
  onClose: () => void; onDone: (msg: string) => void; showToast: ToastFn;
}) {
  const [kind, setKind] = useState(round?.kind || kinds?.[0] || "L3_Interview");
  /* IST wall clock — a slice of the UTC instant moved the round 5h30 per edit. */
  const [when, setWhen] = useState(isoToIstInput(round?.scheduled_at || round?.raw_when));
  const [link, setLink] = useState(round?.meeting_link || "");
  const [who, setWho] = useState(round?.interviewer || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    if (!when) { setErr("Pick the date and time"); return; }
    setBusy(true);
    try {
      const body = { kind, scheduled_at: when, meeting_link: link.trim() || null, interviewer: who.trim() || null, status: "Scheduled", user_role: "RMG" };
      const res = round
        ? await crmPut(`/api/candidate-profiles/${profileId}/interview-rounds/${round.id}`, body)
        : await crmPost(`/api/candidate-profiles/${profileId}/interview-rounds`, body);
      onDone(res.message || (round ? "Round updated" : `${TECH_KINDS[kind] || kind} round added`));
    } catch (e: any) {
      showToast(e?.message || "Could not save the round", "err");
      setBusy(false);
    }
  };
  return (
    <Modal title={round ? `Edit the ${TECH_KINDS[round.kind] || round.kind} round` : "Add a round"} onClose={() => { if (!busy) onClose(); }} dirty>
      <div className="space-y-4">
        {!round && kinds && kinds.length > 1 && (
          <Field label="Round">
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>
              {kinds.map((k) => <option key={k} value={k}>{TECH_KINDS[k] || k}</option>)}
            </select>
          </Field>
        )}
        <Field label="Date & time (IST)" required error={err}>
          <input type="datetime-local" className={`${inputCls}${err ? " input-error" : ""}`} value={when} onChange={(e) => { setWhen(e.target.value); setErr(""); }} />
        </Field>
        <Field label="Meeting link">
          <input className={inputCls} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
        </Field>
        <EmployeePicker value={who} onChange={setWho} employees={employees} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={btnPrimary} onClick={() => void submit()} disabled={busy}>{busy ? "Saving…" : round ? "Save" : "Add round"}</button>
        </div>
      </div>
    </Modal>
  );
}
