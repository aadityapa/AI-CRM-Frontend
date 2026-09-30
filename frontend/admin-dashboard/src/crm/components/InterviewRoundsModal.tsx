/**
 * Every interview of one candidacy, with its feedback, in one pop-up (28 Sep
 * 2026, user ask: "click the Rounds / Interviews cell and see the interview-wise
 * feedback — no need to go inside the candidate profile; if there is none, give
 * an Add button; closing brings me back where I was").
 *
 * Redesigned 29 Sep 2026: a summary band (progress + Done · Upcoming · Feedback
 * due · Not held), then the candidate's journey as a timeline — one card per
 * interview, coloured by who runs it (AI · Karnex technical · customer · HR),
 * the verdict as a chip and the feedback as a quote. ⚠️ Saving feedback CLOSES
 * this pop-up too (user ask, every role): the caller gets the server's message
 * through `onChanged(msg)` and shows it, because a toast rendered in here would
 * vanish with the dialog.
 *
 * Three reads, all open to the roles that work Applied Candidates:
 *   GET …/interview-rounds          (any CRM role) — manual L1–L4, customer, HR
 *   GET …/interview-rounds/options  — the verdict scales + the kinds THIS login
 *                                     may record (the server's own rule)
 *   GET …/ai-interviews             — the AI L1 links (expand into the summary)
 * "Add feedback" / "Edit" open the SAME `FeedbackModal` the Screening Desk uses.
 * Oldest first — the candidate's journey.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Bot, Building2, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, Clock3, Code2, ExternalLink,
  HeartHandshake, Link2, MessageSquareQuote, Pencil, Plus, Timer, UserRound, XCircle,
} from "lucide-react";

import { crmGet } from "../api";
import { fmtDateTime12 } from "../../lib/datetime";
import { ROUND_KIND_LABEL, isCustomerRoundKind, isRoundNotHeld, roundResultTone } from "../lib/interviewRounds";
import { AiInterviewOverview, AiReportLink } from "./AiInterviewOverview";
import { FLOW_BTN, roundHasStarted } from "./flowButtons";
import { FeedbackModal } from "./InterviewLadder";
import { ErrorBox, Modal, btnSecondary, useToast } from "./ui";

type Round = {
  id: number; kind: string; scheduled_at: string | null; raw_when: string | null;
  status: string | null; result: string | null; interviewer: string | null;
  feedback: string | null; mode: string | null; duration_minutes: number | null;
  meeting_link?: string | null;
};

type AiLink = {
  id: number; result: string | null; effective_result: string | null;
  overall_score_percent: number | null; scheduled_at_local: string | null;
  completed_at?: string | null; report_link: string | null; created_at?: string | null;
};

type Options = { results: string[]; hr_results: string[]; writable_rounds: string[] };

type Entry =
  | { type: "round"; at: number; round: Round }
  | { type: "ai"; at: number; link: AiLink };

/** Where an entry stands — drives the timeline dot, the card border and the tally. */
type Phase = "done" | "due" | "upcoming" | "not_held" | "waiting";

const CHIP = "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold";

/** Who runs the round → the card's accent. Full-strength classes only (no
 *  alpha modifiers on var() tokens — they compile to nothing). */
type Family = { label: string; icon: LucideIcon; tile: string; ring: string };
const FAMILY: Record<"ai" | "tech" | "customer" | "hr", Family> = {
  ai: { label: "AI interview", icon: Bot, tile: "bg-gradient-to-br from-violet-500 to-fuchsia-600", ring: "border-violet-200 dark:border-violet-800" },
  tech: { label: "Karnex technical", icon: Code2, tile: "bg-gradient-to-br from-indigo-500 to-blue-600", ring: "border-indigo-200 dark:border-indigo-800" },
  customer: { label: "Customer", icon: Building2, tile: "bg-gradient-to-br from-sky-500 to-cyan-600", ring: "border-sky-200 dark:border-sky-800" },
  hr: { label: "HR", icon: HeartHandshake, tile: "bg-gradient-to-br from-emerald-500 to-teal-600", ring: "border-emerald-200 dark:border-emerald-800" },
};
const familyOf = (kind: string): Family =>
  kind === "HR_Interview" ? FAMILY.hr : isCustomerRoundKind(kind) ? FAMILY.customer : FAMILY.tech;

const PHASE_DOT: Record<Phase, string> = {
  done: "bg-emerald-500 ring-emerald-100 dark:ring-emerald-950",
  due: "bg-amber-500 ring-amber-100 dark:ring-amber-950",
  upcoming: "bg-sky-500 ring-sky-100 dark:ring-sky-950",
  waiting: "bg-violet-500 ring-violet-100 dark:ring-violet-950",
  not_held: "bg-slate-300 ring-slate-100 dark:bg-slate-600 dark:ring-slate-800",
};

function sortKey(v: string | null | undefined): number {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

const isNotHeld = (round: Round) => isRoundNotHeld(round.status);

function phaseOf(e: Entry): Phase {
  if (e.type === "ai") return e.link.completed_at ? "done" : "waiting";
  const r = e.round;
  if (isNotHeld(r)) return "not_held";
  if (r.result) return "done";
  return roundHasStarted(r.scheduled_at || r.raw_when) ? "due" : "upcoming";
}

export function InterviewRoundsModal({ profileId, candidateName, onClose, onChanged, feedbackFirst }: {
  profileId: number;
  candidateName?: string | null;
  onClose: () => void;
  /** Open the feedback dialog for the first round waiting for a verdict as soon
   *  as the list loads (30 Sep 2026: the Screening Desk's "Record feedback"
   *  button records in place — the timeline stays behind for context). */
  feedbackFirst?: boolean;
  /** A verdict was saved (the pop-up has closed) — the caller shows `msg` and
   *  reloads its row / list. */
  onChanged?: (msg?: string) => void;
}) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState("");
  const [openAi, setOpenAi] = useState<number | null>(null);
  const [editing, setEditing] = useState<Round | null>(null);
  const [toastNode, showToast] = useToast();

  const load = useCallback(async () => {
    try {
      const [rounds, links, opts] = await Promise.all([
        crmGet<Round[]>(`/api/candidate-profiles/${profileId}/interview-rounds`),
        crmGet<AiLink[]>(`/api/candidate-profiles/${profileId}/ai-interviews`).catch(() => ({ data: [] as AiLink[] })),
        crmGet<Options>(`/api/candidate-profiles/${profileId}/interview-rounds/options`).catch(() => ({ data: null })),
      ]);
      setEntries([
        ...(links.data || []).map((link) => ({
          type: "ai" as const, at: sortKey(link.completed_at || link.scheduled_at_local || link.created_at), link,
        })),
        ...(rounds.data || []).map((round) => ({ type: "round" as const, at: sortKey(round.scheduled_at), round })),
      ].sort((a, b) => a.at - b.at));
      setOptions(opts.data);
      setError("");
      // The latest finished AI interview opens by default — "View feedback"
      // on the profile is most often a request for exactly that verdict.
      const done = (links.data || []).filter((l) => l.completed_at);
      if (done.length) setOpenAi((cur) => cur ?? done[done.length - 1].id);
      if (feedbackFirst) {
        const writable = new Set(opts.data?.writable_rounds || []);
        const due = (rounds.data || []).find((r) => writable.has(r.kind) && phaseOf({ type: "round", at: 0, round: r }) === "due");
        if (due) setEditing((cur) => cur ?? due);
      }
    } catch (e: any) {
      setError(e?.message || "Could not load the interviews");
    }
  }, [profileId, feedbackFirst]);
  useEffect(() => { void load(); }, [load]);

  /* The same tally as the row's Rounds cell (B-V2 `manual_round_state`): a
     round that did not happen is listed but never counted. */
  const phases = entries?.map(phaseOf) ?? [];
  const tally = {
    done: phases.filter((p) => p === "done").length,
    due: phases.filter((p) => p === "due").length,
    upcoming: phases.filter((p) => p === "upcoming" || p === "waiting").length,
    notHeld: phases.filter((p) => p === "not_held").length,
  };
  const counted = phases.length - tally.notHeld;
  const pct = counted ? Math.round((tally.done / counted) * 100) : 0;
  const title = `Interviews${candidateName ? ` — ${candidateName}` : ""}`;

  return (
    <Modal medium onClose={onClose} title={title} ariaLabel={title}>
      {error ? <ErrorBox error={error} onRetry={() => void load()} /> : entries === null ? (
        <div className="space-y-3 py-2" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="shimmer h-20 rounded-card bg-surface-2" />)}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-muted">
            <CalendarClock size={22} aria-hidden />
          </span>
          <p className="text-sm font-semibold text-primary">No interview booked yet</p>
          <p className="text-xs text-muted">Rounds appear here as soon as they are scheduled.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Summary band */}
          <div className="rounded-card border border-subtle bg-surface-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-primary">
                {tally.done} of {counted} done
                {tally.due > 0 && <span className="ml-2 font-semibold text-warning">· {tally.due} waiting for feedback</span>}
              </p>
              <span className="text-xs font-semibold text-muted tnum">{pct}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-1" role="progressbar"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Interviews completed">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-panel"
                style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <Stat icon={CheckCircle2} label="Done" value={tally.done} tone="bg-success-soft text-success" />
              <Stat icon={Clock3} label="Upcoming" value={tally.upcoming} tone="bg-info-soft text-info" />
              <Stat icon={MessageSquareQuote} label="Feedback due" value={tally.due}
                tone={tally.due ? "bg-warning-soft text-warning" : "bg-surface-1 text-muted"} />
              {tally.notHeld > 0 && <Stat icon={XCircle} label="Not held" value={tally.notHeld} tone="bg-surface-1 text-muted" />}
            </div>
          </div>

          {/* Timeline */}
          <ol className="relative space-y-3 pl-6">
            <span aria-hidden className="absolute bottom-3 left-[7px] top-3 w-0.5 rounded-full bg-surface-2" />
            {entries.map((e, i) => (
              <li key={e.type === "ai" ? `ai-${e.link.id}` : `r-${e.round.id}`} className="relative">
                <span aria-hidden className={`absolute -left-6 top-4 h-4 w-4 rounded-full ring-4 ${PHASE_DOT[phases[i]]}`} />
                {e.type === "ai" ? (
                  <AiCard index={i + 1} link={e.link} profileId={profileId}
                    open={openAi === e.link.id} onToggle={() => setOpenAi(openAi === e.link.id ? null : e.link.id)} />
                ) : (
                  <RoundCard index={i + 1} round={e.round} phase={phases[i]}
                    canWrite={!!options?.writable_rounds?.includes(e.round.kind)}
                    onEdit={() => setEditing(e.round)} />
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <button type="button" className={btnSecondary} onClick={onClose}>Close</button>
      </div>
      {editing && (
        <FeedbackModal
          profileId={profileId}
          round={editing}
          candidateName={candidateName}
          results={(editing.kind === "HR_Interview" ? options?.hr_results : options?.results) || []}
          onClose={() => setEditing(null)}
          onDone={(msg) => {
            setEditing(null);
            // Saved → the whole pop-up closes (user ask, every role); the caller
            // shows the message and refreshes what is behind it.
            if (onChanged) { onChanged(msg); onClose(); } else { showToast(msg); void load(); }
          }}
          showToast={showToast}
        />
      )}
      {toastNode}
    </Modal>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number; tone: string }) {
  return (
    <span className={`${CHIP} ${tone}`}>
      <Icon size={12} aria-hidden /> <span className="tnum">{value}</span> {label}
    </span>
  );
}

function CardHead({ family, index, title, children }: {
  family: Family; index: number; title: string; children?: ReactNode;
}) {
  const Icon = family.icon;
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-white shadow-raised ${family.tile}`}>
          <Icon size={17} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-primary">{title}</p>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Step {index} · {family.label}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function AiCard({ index, link, profileId, open, onToggle }: {
  index: number; link: AiLink; profileId: number; open: boolean; onToggle: () => void;
}) {
  const verdict = link.effective_result || link.result;
  return (
    <div className={`rounded-card border bg-surface-1 p-3 shadow-raised ${FAMILY.ai.ring}`}>
      <CardHead family={FAMILY.ai} index={index} title="AI L1 Interview">
        {link.overall_score_percent != null && (
          <span className={`${CHIP} bg-surface-2 text-primary tnum`}>{Math.round(link.overall_score_percent)}%</span>
        )}
        <span className={`${CHIP} ${roundResultTone(verdict)}`}>{verdict || (link.completed_at ? "Completed" : "Invited")}</span>
      </CardHead>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
        {link.scheduled_at_local && (
          <span className="inline-flex items-center gap-1"><CalendarClock size={12} aria-hidden /> {link.scheduled_at_local} IST</span>
        )}
        {link.completed_at && (
          <span className="inline-flex items-center gap-1"><CheckCircle2 size={12} aria-hidden /> Completed {fmtDateTime12(link.completed_at)}</span>
        )}
      </div>
      {link.completed_at ? (
        <div className="mt-2.5">
          <button type="button" onClick={onToggle} aria-expanded={open}
            className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100 dark:bg-violet-950 dark:text-violet-300">
            {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
            {open ? "Hide the AI verdict" : "Show the AI verdict"}
          </button>
          <span className="ml-2"><AiReportLink href={link.report_link} compact /></span>
          {open && <div className="mt-2"><AiInterviewOverview profileId={profileId} linkId={link.id} reportLink={link.report_link} /></div>}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">Waiting for the candidate to take the interview.</p>
      )}
    </div>
  );
}

function RoundCard({ index, round, phase, canWrite, onEdit }: {
  index: number; round: Round; phase: Phase; canWrite: boolean; onEdit: () => void;
}) {
  const family = familyOf(round.kind);
  const notHeld = phase === "not_held";
  const due = phase === "due";
  const when = round.scheduled_at || round.raw_when;
  const border = due ? "border-amber-300 dark:border-amber-700" : family.ring;
  return (
    <div className={`rounded-card border bg-surface-1 p-3 shadow-raised ${border} ${notHeld ? "opacity-70" : ""}`}>
      <CardHead family={family} index={index} title={ROUND_KIND_LABEL[round.kind] || round.kind}>
        {notHeld ? (
          <span className={`${CHIP} bg-surface-2 text-muted`}>{round.status}</span>
        ) : (
          <span className={`${CHIP} ${due ? "bg-warning-soft text-warning" : roundResultTone(round.result)}`}>
            {round.result || (due ? "Feedback due" : "Scheduled")}
          </span>
        )}
      </CardHead>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
        <span className="inline-flex items-center gap-1">
          <CalendarClock size={12} aria-hidden />
          {when ? fmtDateTime12(when, round.raw_when || "—") : <span className="text-warning">Time not set</span>}
        </span>
        {round.duration_minutes ? (
          <span className="inline-flex items-center gap-1"><Timer size={12} aria-hidden /> {round.duration_minutes} min</span>
        ) : null}
        {round.interviewer && <span className="inline-flex items-center gap-1"><UserRound size={12} aria-hidden /> {round.interviewer}</span>}
        {round.mode && <span>{round.mode}</span>}
        {round.meeting_link && phase === "upcoming" && (
          <a href={round.meeting_link} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline">
            <Link2 size={12} aria-hidden /> Join link <ExternalLink size={11} aria-hidden />
          </a>
        )}
      </div>
      {round.feedback?.trim() ? (
        <blockquote className="mt-2.5 rounded-control border-l-4 border-brand-500 bg-surface-2 px-3 py-2 text-sm text-primary">
          <p className="whitespace-pre-wrap">{round.feedback}</p>
        </blockquote>
      ) : !notHeld && (
        <p className={`mt-2.5 text-xs ${due ? "font-medium text-warning" : "text-muted"}`}>
          {due ? "The interview is over — no feedback recorded yet." : "Feedback can be added once the interview has taken place."}
        </p>
      )}
      {/* Add once the interview time has come; edit a recorded verdict. */}
      {canWrite && !notHeld && (round.result || phase === "due") && (
        <div className="mt-2.5 flex justify-end">
          <button type="button" className={round.result ? FLOW_BTN.edit : FLOW_BTN.warn} onClick={onEdit}>
            {round.result ? <><Pencil size={13} aria-hidden /> Edit feedback</> : <><Plus size={13} aria-hidden /> Record feedback</>}
          </button>
        </div>
      )}
    </div>
  );
}
