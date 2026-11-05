/**
 * "What happened" for one AI interview (5 Nov 2026).
 *
 * The server's `diagnosis` block (B-V2 services/interview_diagnosis.py) on
 * GET /interview/integrity-logs/{token}: a plain-words verdict, what to do
 * next, anything odd, the journey step by step (scheduled → link opened →
 * device check → verified → signed in → first question → answers → ended →
 * report → recording) and the raw facts for whoever debugs further.
 *
 * Reported case it answers: "Completed, Started —, Finished before the slot,
 * Failed 0 %" — the candidate opened the link early and the recovery job closed
 * the prepared session an hour later.
 */
import { useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, CircleDashed, Copy, Info, Stethoscope, XCircle,
} from "lucide-react";
import { fmtDateTime12 } from "../../lib/datetime";

export type DiagnosisTone = "ok" | "warn" | "bad" | "info";
export type StepState = "done" | "missing" | "bad" | "info";

export interface DiagnosisStep {
  key: string;
  label: string;
  at: string | null;
  state: StepState;
  detail: string;
}

export interface InterviewDiagnosis {
  headline: string;
  tone: DiagnosisTone;
  explanation: string[];
  next_steps: string[];
  steps: DiagnosisStep[];
  flags: string[];
  facts: Record<string, unknown>;
}

const TONE: Record<DiagnosisTone, { box: string; icon: React.ReactNode; title: string }> = {
  ok: { box: "border-success/40 bg-success-soft", title: "text-success", icon: <CheckCircle2 className="h-5 w-5 text-success" /> },
  warn: { box: "border-warning/40 bg-warning-soft", title: "text-warning", icon: <AlertTriangle className="h-5 w-5 text-warning" /> },
  bad: { box: "border-danger/40 bg-danger-soft", title: "text-danger", icon: <XCircle className="h-5 w-5 text-danger" /> },
  info: { box: "border-info/40 bg-info-soft", title: "text-info", icon: <Info className="h-5 w-5 text-info" /> },
};

const STEP_ICON: Record<StepState, React.ReactNode> = {
  done: <CheckCircle2 className="h-4 w-4 text-success" />,
  bad: <XCircle className="h-4 w-4 text-danger" />,
  missing: <CircleDashed className="h-4 w-4 text-muted" />,
  info: <Info className="h-4 w-4 text-info" />,
};

/** The facts block as text a developer can paste into a ticket. PURE. */
export function factsText(d: InterviewDiagnosis): string {
  return JSON.stringify({ headline: d.headline, facts: d.facts, steps: d.steps.map((s) => [s.key, s.state, s.at]) }, null, 2);
}

export function InterviewDiagnosisPanel({ diagnosis }: { diagnosis: InterviewDiagnosis | null | undefined }) {
  const [showJourney, setShowJourney] = useState(true);
  const [showFacts, setShowFacts] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!diagnosis) return null;
  const tone = TONE[diagnosis.tone] || TONE.info;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(factsText(diagnosis));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — the text is on screen */ }
  };

  return (
    <div className={`rounded-card border p-3 ${tone.box}`}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0">{tone.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted">
            <Stethoscope className="h-3 w-3" /> What happened
          </div>
          <div className={`text-sm font-extrabold ${tone.title}`}>{diagnosis.headline}</div>
          {diagnosis.explanation.length > 0 && (
            <ul className="mt-1.5 space-y-1 text-xs text-secondary">
              {diagnosis.explanation.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          )}
          {diagnosis.next_steps.length > 0 && (
            <div className="mt-2 rounded-control bg-surface-1/80 px-2.5 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted">What to do</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs font-semibold text-primary">
                {diagnosis.next_steps.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {diagnosis.flags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {diagnosis.flags.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-full bg-surface-1 px-2 py-0.5 text-[11px] font-semibold text-warning ring-1 ring-inset ring-subtle">
                  <AlertTriangle className="h-3 w-3" /> {f}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 rounded-control border border-subtle bg-surface-1">
        <button type="button" onClick={() => setShowJourney((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted">
          <span>The journey, step by step</span>
          {showJourney ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {showJourney && (
          <ol className="space-y-0 px-3 pb-2">
            {diagnosis.steps.map((s, i) => (
              <li key={s.key} className="relative flex gap-2.5 pb-2">
                {i < diagnosis.steps.length - 1 && <span className="absolute left-[7px] top-5 h-full w-px bg-[var(--border-subtle)]" aria-hidden />}
                <span className="relative z-10 mt-0.5 shrink-0 rounded-full bg-surface-1">{STEP_ICON[s.state] || STEP_ICON.info}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className={`text-xs font-bold ${s.state === "missing" ? "text-muted" : "text-primary"}`}>{s.label}</span>
                    <span className="text-[11px] tabular-nums text-muted">{s.at ? fmtDateTime12(s.at) : ""}</span>
                  </div>
                  <div className={`text-[11px] ${s.state === "bad" ? "text-danger" : "text-secondary"}`}>{s.detail}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="mt-2">
        <button type="button" onClick={() => setShowFacts((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted hover:text-primary">
          {showFacts ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} Technical details
        </button>
        {showFacts && (
          <div className="mt-1.5 rounded-control border border-subtle bg-surface-1 p-2">
            <div className="mb-1 flex justify-end">
              <button type="button" onClick={copy}
                className="inline-flex items-center gap-1 rounded-control border border-subtle px-2 py-0.5 text-[11px] font-semibold text-secondary hover:bg-surface-2">
                <Copy className="h-3 w-3" /> {copied ? "Copied" : "Copy for a ticket"}
              </button>
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px] text-secondary">{factsText(diagnosis)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
