/**
 * What the two-way conversation added to an interview (9 Oct 2026): which
 * questions were follow-ups, how often the candidate asked for a repeat, and
 * what they asked about the role at the end. Reads `report.conversation`
 * (server `services/interview/conversation.report_summary`); renders nothing
 * for an interview without the feature. Display only — never scored.
 */
import { HelpCircle, MessageCircleQuestion, Radio, Repeat2 } from "lucide-react";

export type ConversationReport = {
  voice_mode?: string;
  followups?: { index: number; question: string }[];
  repeats?: number;
  clarifications?: number;
  closing_qa?: { question: string; answer: string }[];
};

export function conversationFromReport(report: Record<string, unknown> | null | undefined): ConversationReport | null {
  const raw = report && typeof report === "object" ? (report as Record<string, unknown>).conversation : null;
  return raw && typeof raw === "object" ? (raw as ConversationReport) : null;
}

const norm = (q: string) => String(q || "").toLowerCase().replace(/\s+/g, " ").trim();

/** PURE: the follow-up question texts, normalised, for marking turns. */
export function followupQuestionSet(conv: ConversationReport | null): Set<string> {
  return new Set((conv?.followups || []).map((f) => norm(f.question)).filter(Boolean));
}

export function isFollowupQuestion(set: Set<string>, question: string): boolean {
  return set.size > 0 && set.has(norm(question));
}

export function ConversationSummary({ conv }: { conv: ConversationReport | null }) {
  if (!conv) return null;
  const followups = conv.followups || [];
  const closing = conv.closing_qa || [];
  const repeats = Number(conv.repeats || 0);
  const clar = Number(conv.clarifications || 0);
  const live = conv.voice_mode === "live";
  if (!followups.length && !closing.length && !repeats && !clar && !live) return null;
  return (
    <div className="px-6 py-5 bg-surface-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-black uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
          Conversation
        </span>
        {live ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-bold text-purple-700 dark:bg-purple-950 dark:text-purple-200">
            <Radio size={12} aria-hidden /> Live voice
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">
          <MessageCircleQuestion size={12} aria-hidden /> {followups.length} follow-up{followups.length === 1 ? "" : "s"}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700 dark:bg-sky-950 dark:text-sky-200">
          <Repeat2 size={12} aria-hidden /> {repeats} repeat{repeats === 1 ? "" : "s"} · {clar} explanation{clar === 1 ? "" : "s"}
        </span>
        <span className="text-[11px] text-muted">Not scored — shown for context.</span>
      </div>
      {closing.length ? (
        <div className="mt-3 space-y-2">
          <p className="flex items-center gap-1 text-xs font-black uppercase text-muted">
            <HelpCircle size={13} aria-hidden /> Candidate's questions about the role
          </p>
          {closing.map((c, i) => (
            <div key={i} className="rounded-card border border-subtle bg-surface-2 p-3">
              <p className="text-sm font-semibold text-primary">{c.question}</p>
              <p className="mt-1 text-sm text-secondary">{c.answer}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
