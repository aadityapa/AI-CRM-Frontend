/** "Questions for the L2 round" (21 Oct 2026, user ask: "give 10 follow-up
 *  questions if we need to take an L2"). One click asks GPT-5.5 for ten
 *  questions from the position's skills and the weak / untested L1 answers;
 *  they are saved on the report, so the next reader sees them without paying
 *  again. Copy all · Write again. */
import { useEffect, useState } from "react";
import { Check, ClipboardCopy, Loader2, MessagesSquare, RefreshCw, Sparkles } from "lucide-react";
import { l2Questions, type L2QuestionSet } from "../../api";

const DIFF_LOOK: Record<string, string> = {
  basic: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  intermediate: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  advanced: "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300",
};

/** Plain text of the set, for the clipboard (PURE). */
export function l2AsText(set: L2QuestionSet | null): string {
  if (!set?.questions?.length) return "";
  return set.questions
    .map((q) => `${q.number}. ${q.skill ? `[${q.skill}] ` : ""}${q.question}${q.listen_for ? `\n   Listen for: ${q.listen_for}` : ""}`)
    .join("\n");
}

export function L2QuestionsCard({
  candidateId,
  interviewId,
  initial,
}: {
  candidateId: string;
  interviewId: string;
  initial?: L2QuestionSet | null;
}) {
  const [set, setSet] = useState<L2QuestionSet | null>(initial || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSet(initial || null);
  }, [initial, interviewId]);

  const run = async (regenerate: boolean) => {
    setBusy(true);
    setError("");
    try {
      setSet(await l2Questions(candidateId, interviewId, { generate: true, regenerate }));
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(l2AsText(set));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Copy is blocked in this browser — select the questions and copy them.");
    }
  };

  return (
    <section className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
      <div className="flex flex-wrap items-center gap-3 bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-4 text-[#fff]">
        <span className="flex h-9 w-9 items-center justify-center rounded-control bg-[#fff]/20">
          <MessagesSquare className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold">Questions for the L2 round</h3>
          <p className="text-xs opacity-90">
            Ten questions on the position's skills, aimed at what this L1 did not prove. Saved with the report.
          </p>
        </div>
        {set?.questions?.length ? (
          <div className="flex gap-2">
            <button type="button" onClick={() => void copy()}
              className="inline-flex items-center gap-1.5 rounded-control bg-[#fff]/15 px-3 py-1.5 text-xs font-semibold hover:bg-[#fff]/25">
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />}
              {copied ? "Copied" : "Copy all"}
            </button>
            <button type="button" onClick={() => void run(true)} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-control bg-[#fff]/15 px-3 py-1.5 text-xs font-semibold hover:bg-[#fff]/25 disabled:opacity-60">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
              Write again
            </button>
          </div>
        ) : null}
      </div>

      <div className="p-5">
        {error ? (
          <p role="alert" className="mb-3 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
        ) : null}
        {!set?.questions?.length ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="max-w-md text-sm text-secondary">
              Need a second, human round? Get ten questions written from the position's skill set and this
              candidate's weaker or untested areas — with what a good answer should contain.
            </p>
            <button type="button" onClick={() => void run(false)} disabled={busy}
              className="inline-flex items-center gap-2 rounded-control bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-[#fff] shadow-raised hover:opacity-90 disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
              {busy ? "Writing the questions… (up to a minute)" : "Suggest L2 questions"}
            </button>
          </div>
        ) : (
          <>
            <ol className="space-y-2.5">
              {set.questions.map((q) => (
                <li key={q.number} className="rounded-control border border-subtle bg-surface-2 p-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-[#fff]">
                      {q.number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap gap-1.5">
                        {q.skill ? (
                          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                            {q.skill}
                          </span>
                        ) : null}
                        {q.difficulty ? (
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${DIFF_LOOK[q.difficulty] || ""}`}>
                            {q.difficulty}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm font-semibold text-primary">{q.question}</p>
                      {q.why ? <p className="mt-1 text-xs text-muted"><span className="font-semibold">Why: </span>{q.why}</p> : null}
                      {q.listen_for ? (
                        <p className="mt-0.5 text-xs text-success"><span className="font-semibold">Listen for: </span>{q.listen_for}</p>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[11px] text-muted">
              Written {set.generated_at_ist ? new Date(set.generated_at_ist).toLocaleString("en-IN") : ""}
              {set.generated_by ? ` · asked by ${set.generated_by}` : ""} · AI-written: check them before the round.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
