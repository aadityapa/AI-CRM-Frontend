/**
 * "GPT-6 Astra" — a small pill naming the OpenAI model that ran something
 * (9 Oct 2026). The label comes from the server; `modelLabel` only prettifies an
 * id that arrived without one. Tokens only — no alpha modifier on a var() token.
 */
import { Sparkles } from "lucide-react";

import { modelLabel } from "../lib/aiEngine";

export function AiModelChip({
  id,
  label,
  reasoning,
  prefix,
  className = "",
}: {
  id?: string | null;
  label?: string | null;
  reasoning?: boolean;
  /** e.g. "Scoring" → "Scoring: GPT-6 Astra". */
  prefix?: string;
  className?: string;
}) {
  if (!id && !label) return null;
  const name = modelLabel(id, label);
  const title = `OpenAI ${name}${reasoning ? " · reasoning model" : ""}`;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-800 ring-1 ring-inset ring-purple-200 dark:bg-purple-950 dark:text-purple-200 dark:ring-purple-800 ${className}`}
    >
      <Sparkles size={11} aria-hidden />
      {prefix ? `${prefix}: ${name}` : name}
    </span>
  );
}

/**
 * One chip when the same model asked and scored; "Questions: … · Scoring: …"
 * when an older interview was re-scored on a newer model.
 */
export function InterviewModelChips({
  model,
  modelLabel: label,
  evaluationModel,
  evaluationModelLabel,
}: {
  model?: string | null;
  modelLabel?: string | null;
  evaluationModel?: string | null;
  evaluationModelLabel?: string | null;
}) {
  const evalId = evaluationModel || model;
  if (!model && !evalId) return null;
  if (!model || !evalId || model === evalId) {
    return <AiModelChip id={model || evalId} label={label || evaluationModelLabel} />;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <AiModelChip id={model} label={label} prefix="Questions" />
      <AiModelChip id={evalId} label={evaluationModelLabel} prefix="Scoring" />
    </span>
  );
}
