/**
 * How a question is shown on the report (10 Oct 2026): the kind + skill chips
 * of a skill-wise bank question, the answer as the candidate gave it (an option
 * clicked on a pseudo-code snippet, typed code, or speech), and the EVIDENCE —
 * the candidate's own words / code line that earned the score.
 */
import { Braces, Check, CircleDot, Code2, Quote, Sparkles, X } from "lucide-react";

import { languageName } from "../interview-template/SkillBankEditor";
import type { EnrichedTurn } from "../../utils/reportExtract";

const LETTERS = "ABCDEF";

export function QuestionKindChips({ turn }: { turn: EnrichedTurn }) {
  if (!turn.questionKind && !turn.skill) return null;
  return (
    <>
      {turn.questionKind === "pseudo" ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <Braces className="h-3 w-3" aria-hidden /> Pseudo-code
        </span>
      ) : turn.questionKind === "coding" ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          <Code2 className="h-3 w-3" aria-hidden /> Coding
        </span>
      ) : null}
      {turn.skill ? (
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-bold text-secondary ring-1 ring-inset ring-subtle">
          {turn.skill}
        </span>
      ) : null}
      {turn.aiWritten ? (
        <span title="The template had too few spoken questions for this skill — the AI wrote this one at medium level."
          className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-800 dark:bg-purple-950 dark:text-purple-200">
          <Sparkles className="h-3 w-3" aria-hidden /> AI-written · medium
        </span>
      ) : null}
      {turn.questionKind === "coding" && turn.verdict ? <VerdictChip verdict={turn.verdict} /> : null}
    </>
  );
}

const VERDICT_LOOK: Record<string, { label: string; cls: string }> = {
  correct: { label: "Correct", cls: "bg-emerald-600 text-[#fff]" },
  partially_correct: { label: "Partly correct", cls: "bg-amber-500 text-[#fff]" },
  incorrect: { label: "Incorrect", cls: "bg-rose-600 text-[#fff]" },
};

export function VerdictChip({ verdict }: { verdict: string }) {
  const look = VERDICT_LOOK[verdict] || VERDICT_LOOK.incorrect;
  return (
    <span title="The AI's check of the candidate's code against the reference solution"
      className={`rounded-full px-2 py-0.5 text-xs font-bold ${look.cls}`}>
      Code: {look.label}
    </span>
  );
}

function Evidence({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="flex items-start gap-2 rounded-card border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-100">
      <Quote className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        <div className="text-[11px] font-black uppercase tracking-wide opacity-80">Evidence for the score</div>
        <div className="mt-0.5 font-medium">“{text}”</div>
      </div>
    </div>
  );
}

export function AnswerBlock({ turn }: { turn: EnrichedTurn }) {
  const label = "text-xs font-black uppercase text-muted mb-1";
  const codeBox = "overflow-auto rounded-card border border-subtle bg-slate-950 p-3 font-mono text-[13px] leading-5 text-emerald-100 whitespace-pre";

  if (turn.questionKind === "pseudo") {
    const options = turn.options || [];
    return (
      <div className="space-y-3">
        {turn.code ? (
          <div>
            <p className={label}>Code shown</p>
            <pre className={codeBox}>{turn.code}</pre>
          </div>
        ) : null}
        <div>
          <p className={label}>Options</p>
          <ul className="space-y-1.5">
            {options.map((opt, i) => {
              const chosen = turn.selectedOption === i;
              const right = turn.correctOption === i;
              const partly = !right && (turn.partialOptions || []).includes(i);
              return (
                <li key={i}
                  className={`flex items-center gap-2 rounded-control border px-3 py-1.5 text-sm ${
                    right ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
                      : partly && chosen ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
                      : chosen ? "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100"
                        : "border-subtle bg-surface-1 text-secondary"}`}>
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-2 text-xs font-black">{LETTERS[i]}</span>
                  <span className="font-mono">{opt}</span>
                  <span className="ml-auto flex items-center gap-1 text-xs font-bold">
                    {chosen ? "Candidate's choice" : null}
                    {partly ? <span className="rounded-full bg-amber-100 px-1.5 text-[11px] text-amber-800 dark:bg-amber-900 dark:text-amber-100">
                      Partly right · {turn.partialCredit ?? 50}%</span> : null}
                    {right ? <Check className="h-4 w-4" aria-label="Correct option" />
                      : partly && chosen ? <CircleDot className="h-4 w-4" aria-label="Partly right option" />
                      : chosen ? <X className="h-4 w-4" aria-label="Wrong option" /> : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {turn.selectedOption == null ? (
            <p className="mt-1 text-xs text-muted">{turn.answer && turn.answer.toLowerCase() !== "skip" ? turn.answer : "No option selected."}</p>
          ) : null}
        </div>
      </div>
    );
  }

  if (turn.questionKind === "coding") {
    return (
      <div className="space-y-3">
        <div>
          <p className={label}>Candidate's code{turn.language && turn.language !== "any" ? ` (${languageName(turn.language)})` : ""}</p>
          {turn.answer && turn.answer.toLowerCase() !== "skip" ? (
            <pre className={codeBox}>{turn.answer}</pre>
          ) : (
            <p className="text-sm text-secondary">— (skipped)</p>
          )}
        </div>
        <Evidence text={turn.evidence} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <p className={label}>Candidate answer</p>
        <p className="text-sm text-secondary whitespace-pre-wrap">{turn.answer || "—"}</p>
      </div>
      <Evidence text={turn.evidence} />
    </div>
  );
}

type KindCell = { questions?: number; mean?: number; correct?: number; partial?: number;
  verdicts?: Record<string, number> };

/** The skill-wise interview at a glance: skills the candidate picked and the
 * score per question kind. Renders nothing for any other interview. */
export function SkillBankSummary({ report }: { report: Record<string, unknown> }) {
  const sel = report.skill_selection as { picked?: string[]; mandatory?: string[]; confirmed_by_candidate?: boolean } | undefined;
  const kinds = (report.question_kind_scores || {}) as Record<string, KindCell>;
  if (!sel && !Object.keys(kinds).length) return null;
  const mandatory = new Set((sel?.mandatory || []).map((s) => s.toLowerCase()));
  const cells: { key: string; label: string; value: string; tone: string }[] = [];
  if (kinds.normal?.questions) cells.push({ key: "normal", label: `Spoken · ${kinds.normal.questions}`, value: `${Math.round((kinds.normal.mean || 0) * 10)}%`, tone: "from-sky-500 to-indigo-600" });
  if (kinds.pseudo?.questions) cells.push({ key: "pseudo", label: `Pseudo-code · ${kinds.pseudo.questions}`, value: `${kinds.pseudo.correct ?? 0}/${kinds.pseudo.questions} correct${kinds.pseudo.partial ? ` · ${kinds.pseudo.partial} partly` : ""}`, tone: "from-amber-500 to-orange-600" });
  if (kinds.coding?.questions) {
    const v = kinds.coding.verdicts || {};
    const words = [v.correct ? `${v.correct} correct` : "", v.partially_correct ? `${v.partially_correct} partly` : "",
      v.incorrect ? `${v.incorrect} incorrect` : ""].filter(Boolean).join(" · ");
    cells.push({ key: "coding", label: `Coding · ${kinds.coding.questions}${words ? ` · ${words}` : ""}`, value: `${Math.round((kinds.coding.mean || 0) * 10)}%`, tone: "from-emerald-500 to-teal-600" });
  }
  return (
    <div className="mx-6 my-4 rounded-card border border-subtle bg-surface-1 p-4">
      <div className="text-xs font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">Skill-wise interview</div>
      {sel?.picked?.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-muted">Skills {sel.confirmed_by_candidate ? "the candidate picked" : "asked"}:</span>
          {sel.picked.map((s) => (
            <span key={s} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-bold text-secondary ring-1 ring-inset ring-subtle">
              {s}{mandatory.has(s.toLowerCase()) ? " · required" : ""}
            </span>
          ))}
        </div>
      ) : null}
      {cells.length ? (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {cells.map((c) => (
            <div key={c.key} className="rounded-card border border-subtle bg-surface-2 p-3">
              <div className={`mb-1 h-1 w-10 rounded-full bg-gradient-to-r ${c.tone}`} aria-hidden />
              <div className="text-xs font-semibold text-muted">{c.label}</div>
              <div className="text-lg font-black text-primary">{c.value}</div>
            </div>
          ))}
        </div>
      ) : null}
      <p className="mt-2 text-xs text-muted">Questions came from the position template (any “AI-written” one topped up a short skill at medium level); pseudo-code is marked automatically, partly right options earn part of the marks, and the AI checked spoken and coding answers against the template's answers.</p>
    </div>
  );
}
