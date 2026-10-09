/**
 * Two-way conversation settings on an interview template (9 Oct 2026).
 *
 * Stored in the template's `weights.conversation` bag and read by the server's
 * `services/interview/conversation.conversation_settings` — keep the key names
 * in step. Every switch is OFF by default, so an existing template keeps
 * interviewing exactly as before until RMG turns something on here.
 */
import { AudioLines, Ear, HelpCircle, MessageCircleQuestion, MessagesSquare, Radio, Repeat2, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export type VoiceMode = "standard" | "live";

export type ConversationConfig = {
  followups: boolean;
  maxFollowups: number;
  probeShortAnswers: boolean;
  acknowledge: boolean;
  clarify: boolean;
  closingQa: boolean;
  voiceMode: VoiceMode;
};

export const MAX_FOLLOWUPS_CAP = 5;

export const CONVERSATION_OFF: ConversationConfig = {
  followups: false,
  maxFollowups: 2,
  probeShortAnswers: false,
  acknowledge: false,
  clarify: false,
  closingQa: false,
  voiceMode: "standard",
};

/** Our recommendation: everything on, standard voice (cheap, proven). */
export const CONVERSATION_RECOMMENDED: ConversationConfig = {
  followups: true,
  maxFollowups: 2,
  probeShortAnswers: true,
  acknowledge: true,
  clarify: true,
  closingQa: true,
  voiceMode: "standard",
};

function bool(v: unknown, d: boolean): boolean {
  if (v === undefined || v === null || v === "") return d;
  if (typeof v === "boolean") return v;
  const t = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(t)) return true;
  if (["0", "false", "no", "off"].includes(t)) return false;
  return d;
}

/** PURE: read the saved settings (missing = all off). */
export function conversationFromWeights(weights: unknown): ConversationConfig {
  const raw = weights && typeof weights === "object" ? (weights as Record<string, unknown>).conversation : null;
  const c = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const max = Math.round(Number(c.maxFollowups ?? c.max_followups ?? CONVERSATION_OFF.maxFollowups));
  const voice = String(c.voiceMode ?? c.voice_mode ?? "").toLowerCase();
  return {
    followups: bool(c.followups, false),
    maxFollowups: Number.isFinite(max) ? Math.max(0, Math.min(MAX_FOLLOWUPS_CAP, max)) : CONVERSATION_OFF.maxFollowups,
    probeShortAnswers: bool(c.probeShortAnswers ?? c.probe_short_answers, false),
    acknowledge: bool(c.acknowledge, false),
    clarify: bool(c.clarify, false),
    closingQa: bool(c.closingQa ?? c.closing_qa, false),
    voiceMode: voice === "live" ? "live" : "standard",
  };
}

/** PURE: the object saved under `weights.conversation`. */
export function conversationToWeights(c: ConversationConfig): Record<string, unknown> {
  return {
    followups: c.followups,
    maxFollowups: Math.max(0, Math.min(MAX_FOLLOWUPS_CAP, Math.round(c.maxFollowups))),
    probeShortAnswers: c.probeShortAnswers,
    acknowledge: c.acknowledge,
    clarify: c.clarify,
    closingQa: c.closingQa,
    voiceMode: c.voiceMode,
  };
}

export function conversationEnabled(c: ConversationConfig): boolean {
  return c.followups || c.probeShortAnswers || c.acknowledge || c.clarify || c.closingQa || c.voiceMode === "live";
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-micro ${
        on ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-600"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-[#fff] shadow transition-transform duration-micro ${
          on ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function Row({
  icon,
  tone,
  title,
  hint,
  on,
  onChange,
  children,
}: {
  icon: ReactNode;
  tone: string;
  title: string;
  hint: string;
  on: boolean;
  onChange: (v: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className={`rounded-card border p-3 transition-colors ${on ? "border-indigo-300 bg-indigo-50/60 dark:border-indigo-700 dark:bg-indigo-950" : "border-subtle bg-surface-1"}`}>
      <div className="flex items-start gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-control text-[#fff] bg-gradient-to-br ${tone}`} aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-bold text-primary">{title}</div>
            <Switch on={on} onChange={onChange} label={title} />
          </div>
          <p className="mt-0.5 text-xs leading-snug text-muted">{hint}</p>
          {on && children ? <div className="mt-2">{children}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function ConversationSettings({
  value,
  onChange,
  disabledReason,
}: {
  value: ConversationConfig;
  onChange: (next: ConversationConfig) => void;
  /** Shown instead of the controls (e.g. question-bank templates). */
  disabledReason?: string;
}) {
  const set = (patch: Partial<ConversationConfig>) => onChange({ ...value, ...patch });
  const enabled = conversationEnabled(value);
  return (
    <div className="fx-gradient-border rounded-card border border-subtle bg-surface-1 p-4 md:col-span-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-card bg-gradient-to-br from-indigo-500 to-purple-600 text-[#fff]" aria-hidden>
            <MessagesSquare size={20} />
          </span>
          <div>
            <div className="text-xs font-extrabold uppercase tracking-widest text-indigo-600 dark:text-indigo-300">
              Two-way conversation
            </div>
            <div className="mt-0.5 text-sm font-semibold text-secondary">
              {enabled ? "ON — the AI talks with the candidate, not at them" : "OFF — questions are asked one after another"}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChange(CONVERSATION_RECOMMENDED)}
            className="inline-flex h-9 items-center gap-1.5 rounded-control bg-gradient-to-r from-indigo-600 to-purple-600 px-3 text-xs font-bold text-[#fff] shadow-raised"
          >
            <Sparkles size={14} aria-hidden /> Use recommended
          </button>
          {enabled ? (
            <button
              type="button"
              onClick={() => onChange(CONVERSATION_OFF)}
              className="h-9 rounded-control border border-subtle bg-surface-2 px-3 text-xs font-bold text-secondary hover:border-strong"
            >
              Turn all off
            </button>
          ) : null}
        </div>
      </div>

      {disabledReason ? (
        <p className="mt-3 rounded-control bg-surface-2 px-3 py-2 text-xs text-muted">{disabledReason}</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Row
              icon={<MessageCircleQuestion size={18} />}
              tone="from-indigo-500 to-blue-600"
              title="Follow-up questions"
              hint="After an answer worth exploring, the AI asks ONE follow-up on what the candidate just said. It is added to the interview — no planned question is dropped — and scored like any other."
              on={value.followups}
              onChange={(v) => set({ followups: v })}
            >
              <label className="flex items-center gap-2 text-xs font-semibold text-secondary">
                Most follow-ups per interview
                <select
                  value={value.maxFollowups}
                  onChange={(e) => set({ maxFollowups: Number(e.target.value) })}
                  className="h-8 rounded-control border border-subtle bg-surface-1 px-2 text-xs text-primary"
                >
                  {Array.from({ length: MAX_FOLLOWUPS_CAP }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            </Row>
            <Row
              icon={<Ear size={18} />}
              tone="from-amber-500 to-orange-600"
              title="Probe very short answers"
              hint="A one-line answer earns one “Could you give a concrete example?” before moving on. Shares the follow-up budget."
              on={value.probeShortAnswers}
              onChange={(v) => set({ probeShortAnswers: v })}
            >
              {!value.followups ? (
                <p className="text-[11px] text-muted">Uses the follow-up budget ({value.maxFollowups}) even with follow-ups off.</p>
              ) : null}
            </Row>
            <Row
              icon={<AudioLines size={18} />}
              tone="from-emerald-500 to-teal-600"
              title="Spoken acknowledgements"
              hint="A short neutral line before the next question (“Thanks — you mentioned CAN timing…”). Never praise or a verdict, so the candidate is not biased."
              on={value.acknowledge}
              onChange={(v) => set({ acknowledge: v })}
            />
            <Row
              icon={<Repeat2 size={18} />}
              tone="from-sky-500 to-cyan-600"
              title="Repeat & explain on request"
              hint="“Repeat question” and “Explain the question” buttons, and the same said out loud (“sorry, can you repeat that?”). Explained in plainer words — never a hint at the answer."
              on={value.clarify}
              onChange={(v) => set({ clarify: v })}
            />
            <Row
              icon={<HelpCircle size={18} />}
              tone="from-fuchsia-500 to-pink-600"
              title="Candidate questions at the end"
              hint="“Do you have any questions about the role?” — up to 3, answered only from the job description. The client is never named; salary and selection go to the recruitment team. Not scored."
              on={value.closingQa}
              onChange={(v) => set({ closingQa: v })}
            />
          </div>

          <div className="mt-4 rounded-card border border-subtle bg-surface-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Radio size={16} className="text-purple-600 dark:text-purple-300" aria-hidden />
                <div className="text-sm font-bold text-primary">Interviewer voice</div>
              </div>
              <div className="inline-flex rounded-control bg-surface-1 p-0.5 ring-1 ring-inset ring-subtle" role="radiogroup" aria-label="Interviewer voice">
                {(["standard", "live"] as VoiceMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={value.voiceMode === m}
                    onClick={() => set({ voiceMode: m })}
                    className={`rounded-control px-3 py-1.5 text-xs font-bold transition-colors duration-micro ${
                      value.voiceMode === m
                        ? m === "live"
                          ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-[#fff] shadow-raised"
                          : "bg-surface-0 text-primary shadow-raised"
                        : "text-secondary hover:text-primary"
                    }`}
                  >
                    {m === "standard" ? "Standard" : "Live conversation (beta)"}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-2 text-xs leading-snug text-muted">
              {value.voiceMode === "live" ? (
                <>
                  The candidate talks with the AI in real time and can interrupt or ask it to explain — like a phone
                  interview. Questions, scoring, recording and proctoring stay the same. It costs noticeably more per
                  interview than the standard voice (see <span className="font-semibold text-secondary">AI Costs</span>),
                  and if the live call cannot open, the interview carries on with the standard voice automatically.
                </>
              ) : (
                <>The AI reads each question aloud and listens to the answer — the proven, low-cost mode.</>
              )}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
