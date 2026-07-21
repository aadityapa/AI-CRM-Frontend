import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Award,
  AlertTriangle,
  Check,
  ChevronDown,
  MessageSquareQuote,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  User,
  X,
} from "lucide-react";
import type { StrengthsWeaknessesAnalysis } from "../../types/strengthsWeaknesses";
import {
  buildManagerDashboardView,
  type ManagerDashboardSnapshot,
  type SkillCard,
} from "../../utils/managerDashboardView";
import { AiThinking } from "../../crm/components/ui";

function BulletList({ items, tone }: { items: string[]; tone: "strength" | "weakness" | "neutral" }) {
  const Icon = tone === "strength" ? Check : tone === "weakness" ? X : Target;
  const iconCls = tone === "strength" ? "text-success" : tone === "weakness" ? "text-danger" : "text-muted";
  return (
    <ul className="space-y-1.5">
      {items.map((line, i) => (
        <li key={i} className="flex items-start gap-2 text-sm leading-snug text-secondary">
          <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${iconCls}`} aria-hidden />
          <span>{line.replace(/^[✓✗]\s*/, "")}</span>
        </li>
      ))}
    </ul>
  );
}

function toneStyles(tone: SkillCard["tone"]) {
  if (tone === "green") {
    return {
      border: "border-subtle",
      bg: "bg-success-soft",
      badge: "bg-surface-1 text-success ring-1 ring-inset ring-subtle",
      dot: "bg-success-500",
    };
  }
  if (tone === "yellow") {
    return {
      border: "border-subtle",
      bg: "bg-warning-soft",
      badge: "bg-surface-1 text-warning ring-1 ring-inset ring-subtle",
      dot: "bg-warning-500",
    };
  }
  return {
    border: "border-subtle",
    bg: "bg-danger-soft",
    badge: "bg-surface-1 text-danger ring-1 ring-inset ring-subtle",
    dot: "bg-danger-500",
  };
}

function SkillCardView({ card }: { card: SkillCard }) {
  const s = toneStyles(card.tone);
  return (
    <div className={`rounded-card border ${s.border} ${s.bg} p-4 flex flex-col gap-2`}>
      <div className="fx-hairline-b flex items-start justify-between gap-2 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} aria-hidden />
          <h4 className="font-bold text-primary truncate">{card.title}</h4>
        </div>
        <span className={`shrink-0 text-xs font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${s.badge}`}>
          {card.levelLabel}
        </span>
      </div>
      <p className="text-xs text-secondary">{card.summary}</p>
      {card.bullets.length > 0 ? <BulletList items={card.bullets} tone={card.tone === "red" ? "weakness" : "strength"} /> : null}
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-start gap-2.5 mb-4">
      <div className="p-2 rounded-control bg-surface-2 text-brand-600 ring-1 ring-inset ring-subtle dark:text-brand-300">
        <Icon className="w-4 h-4" aria-hidden />
      </div>
      <div>
        <h3 className="text-xs font-black uppercase tracking-widest text-secondary">{title}</h3>
        {subtitle ? <p className="text-xs text-muted mt-0.5">{subtitle}</p> : null}
      </div>
    </div>
  );
}

function confidenceBadge(level: "High" | "Moderate" | "Low") {
  if (level === "High") return "bg-success-soft text-success";
  if (level === "Moderate") return "bg-warning-soft text-warning";
  return "bg-danger-soft text-danger";
}

export function StrengthsWeaknessesPanel({
  analysis,
  snapshot,
  busy,
  error,
}: {
  analysis: StrengthsWeaknessesAnalysis | null;
  snapshot: ManagerDashboardSnapshot;
  busy?: boolean;
  error?: string;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const dashboard = useMemo(() => buildManagerDashboardView(analysis, snapshot), [analysis, snapshot]);

  if (busy) {
    return (
      <div className="flex items-center justify-center py-16">
        <AiThinking label="Loading manager review dashboard…" />
      </div>
    );
  }
  if (error) {
    return <div className="p-8 text-center text-danger text-sm">{error}</div>;
  }
  if (!dashboard) {
    return (
      <div className="p-8 text-center text-muted text-sm">
        No evaluation data yet for this interview. Complete the interview and wait for the AI report.
      </div>
    );
  }

  const { snapshot: snap, strengthCards, improvementCards, topBest, topWeakest, followUpQuestions, questions } =
    dashboard;
  const verdictLines = snap.aiVerdict.split("\n").filter(Boolean);

  return (
    <div className="space-y-8">
      {/* SECTION 1 — Candidate Snapshot (summary hero — glass allowed) */}
      <section className="glass rounded-card p-5 shadow-raised sm:p-6">
        <SectionHeader icon={User} title="Candidate Snapshot" subtitle="20-second hiring decision at a glance" />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted">Candidate</p>
            <p className="text-lg font-black text-primary">{snap.candidateName}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted">Role</p>
            <p className="text-sm font-bold text-brand-700 dark:text-brand-300">{snap.role}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted">Score</p>
            <p className="text-display text-2xl font-bold tabular-nums text-primary">{snap.scorePercent}%</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted">Recommendation</p>
            <p className="text-sm font-bold text-success">{snap.hiringRecommendation}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted">Confidence Level</p>
            <span
              className={`inline-block mt-1 text-xs font-black uppercase tracking-wider px-2.5 py-1 rounded-full ${confidenceBadge(snap.confidenceLevel)}`}
            >
              {snap.confidenceLevel}
            </span>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted">Interview Date</p>
            <p className="text-sm font-semibold text-secondary">{snap.interviewDate}</p>
          </div>
        </div>
        {/* AI-generated verdict — animated gradient border + cyan accent label */}
        <div className="fx-gradient-border-animated mt-5 rounded-card bg-surface-1 p-4">
          <div className="flex items-center gap-2 text-brand-700 dark:text-brand-200">
            <Sparkles className="w-4 h-4 shrink-0" aria-hidden />
            <p className="text-xs font-black uppercase tracking-widest">AI Verdict</p>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold normal-case tracking-normal text-accent-600 ring-1 ring-inset ring-subtle dark:text-accent-400">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden />
              AI Analysis
            </span>
          </div>
          <div className="mt-2 space-y-1">
            {verdictLines.map((line, i) => (
              <p key={i} className="text-sm text-secondary leading-relaxed">
                {line}
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 2 — Strength Summary */}
      <section>
        <SectionHeader icon={TrendingUp} title="Strength Summary" subtitle="Skill areas where the candidate performed well" />
        <div className="grid sm:grid-cols-2 gap-3">
          {strengthCards.map((card) => (
            <SkillCardView key={card.id} card={card} />
          ))}
        </div>
      </section>

      {/* SECTION 3 — Improvement Areas */}
      <section>
        <SectionHeader icon={TrendingDown} title="Improvement Areas" subtitle="Topics to probe in the next round" />
        <div className="grid sm:grid-cols-2 gap-3">
          {improvementCards.map((card) => (
            <SkillCardView key={card.id} card={card} />
          ))}
        </div>
      </section>

      {/* SECTION 4 & 5 — Top answers */}
      <div className="grid lg:grid-cols-2 gap-6">
        <section>
          <SectionHeader icon={Award} title="Top 5 Best Answers" />
          <div className="space-y-3">
            {topBest.length ? (
              topBest.map((item) => (
                <div key={item.question_index} className="rounded-card border border-subtle bg-success-soft p-4">
                  <p className="fx-hairline-b pb-2 text-xs font-black uppercase tracking-wider text-success">
                    Best Answer #{item.rank}
                    {item.score_display ? ` · ${item.score_display}` : ""}
                  </p>
                  <p className="mt-2 text-sm font-bold text-primary">{item.question}</p>
                  <p className="mt-2 text-xs text-secondary">
                    <span className="font-semibold text-success">Reason: </span>
                    {item.reason}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">No scored answers available yet.</p>
            )}
          </div>
        </section>

        <section>
          <SectionHeader icon={AlertTriangle} title="Top 5 Weakest Answers" />
          <div className="space-y-3">
            {topWeakest.length ? (
              topWeakest.map((item) => (
                <div key={item.question_index} className="rounded-card border border-subtle bg-danger-soft p-4">
                  <p className="fx-hairline-b pb-2 text-xs font-black uppercase tracking-wider text-danger">
                    Weak Answer #{item.rank}
                    {item.score_display ? ` · ${item.score_display}` : ""}
                  </p>
                  <p className="mt-2 text-sm font-bold text-primary">{item.question}</p>
                  <p className="mt-2 text-xs text-secondary">
                    <span className="font-semibold text-danger">Reason: </span>
                    {item.reason}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">No weak-answer signal yet.</p>
            )}
          </div>
        </section>
      </div>

      {/* SECTION 6 — Follow-up questions */}
      <section className="rounded-card border border-subtle bg-surface-2 p-5">
        <SectionHeader
          icon={MessageSquareQuote}
          title="Follow-up Questions for Manager"
          subtitle="Suggested prompts for HR or L2 technical interview"
        />
        <ol className="space-y-2.5 list-none">
          {followUpQuestions.map((q, i) => (
            <li
              key={i}
              className="flex items-start gap-3 text-sm text-secondary bg-surface-1 rounded-control px-3 py-2.5 border border-subtle"
            >
              <span className="shrink-0 w-6 h-6 rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200 text-xs font-black flex items-center justify-center">
                {i + 1}
              </span>
              <span>
                <span className="font-semibold text-brand-700 dark:text-brand-300">Ask candidate: </span>
                {q}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* SECTION 7 — Question-by-question (collapsed by default) */}
      <section>
        <SectionHeader
          icon={Target}
          title="Question-by-Question Review"
          subtitle="Expand only when you need per-question detail — all data preserved below"
        />
        <div className="space-y-2">
          {questions.map((q) => {
            const open = openIdx === q.question_index;
            return (
              <motion.div
                key={q.question_index}
                layout
                className="rounded-card border border-subtle bg-surface-1 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setOpenIdx(open ? null : q.question_index)}
                  className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left transition-colors duration-micro ease-smooth hover:bg-surface-2"
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <ChevronDown
                      className={`w-4 h-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
                    />
                    <div>
                      <span className="text-xs font-black uppercase tracking-widest text-muted">
                        Question {q.question_index}
                        {q.score_display ? ` · ${q.score_display}` : ""}
                      </span>
                      <p className="mt-0.5 text-sm font-semibold text-primary leading-snug">
                        {q.question || "—"}
                      </p>
                    </div>
                  </div>
                </button>
                <AnimatePresence initial={false}>
                  {open ? (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden border-t border-subtle"
                    >
                      <div className="px-4 py-3 grid sm:grid-cols-2 gap-2.5 bg-surface-2">
                        <div className="rounded-control border border-subtle bg-success-soft p-3">
                          <p className="text-xs font-black uppercase tracking-wider text-success">
                            Strengths
                          </p>
                          <BulletList items={q.question_strengths} tone="strength" />
                        </div>
                        <div className="rounded-control border border-subtle bg-danger-soft p-3">
                          <p className="text-xs font-black uppercase tracking-wider text-danger">
                            Weaknesses
                          </p>
                          <BulletList items={q.question_weaknesses} tone="weakness" />
                        </div>
                        {q.score_display ? (
                          <div className="sm:col-span-2 rounded-control border border-subtle bg-surface-1 p-3">
                            <p className="text-xs font-black uppercase tracking-wider text-muted">Score</p>
                            <p className="text-sm font-bold text-primary">{q.score_display}</p>
                          </div>
                        ) : null}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
