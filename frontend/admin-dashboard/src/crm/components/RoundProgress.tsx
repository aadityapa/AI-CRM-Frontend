/**
 * Which rounds this candidate has been through, at a glance.
 *
 * The pipeline status says *where* a candidate is; it does not say what
 * happened on the way. Answering "have they done L2 yet, and what did the
 * panel say?" meant opening the Interviews tab and reading down a list of
 * cards. This puts the whole ladder on one line.
 *
 * Rounds are shown in interview order (AI L1 → L1 → L2 → L3 → L4 → Customer),
 * not in the order they happen to have been entered, because the reader is
 * asking "how far along", which is a sequence question.
 */
import { Bot, Check, Minus, X } from "lucide-react";

export type RoundLike = {
  kind: string;
  /** For customer rounds: "L1" or "L2" — which of the customer's rounds. */
  stage?: string | null;
  result?: string | null;
  status?: string | null;
  scheduled_at?: string | null;
  feedback?: string | null;
};

/**
 * Interview order, not entry order.
 *
 * Two ladders run back to back and both use the names L1 and L2, which is a
 * genuine source of confusion: RMG's technical rounds happen before we submit,
 * the customer's happen after. They are labelled distinctly here so nobody
 * reads "L2 · Hire" and thinks the customer said it when RMG did.
 */
const LADDER: { kind: string; stage?: string; short: string; group: "ours" | "customer" }[] = [
  { kind: "L1_Interview", short: "L1", group: "ours" },
  { kind: "L2_F2F", short: "L2", group: "ours" },
  { kind: "L3_Interview", short: "L3", group: "ours" },
  { kind: "L4_Interview", short: "L4", group: "ours" },
  // Abbreviated because these are chips in a dense strip; the full
  // "Customer L1 Interview" wording lives on the status badge and the tooltip.
  { kind: "Customer_Interview", stage: "L1", short: "Customer L1", group: "customer" },
  { kind: "Customer_Interview", stage: "L2", short: "Customer L2", group: "customer" },
  // Customer rounds recorded before the feedback stages existed, or imported
  // from Zoho, carry no stage — still worth showing.
  { kind: "Customer_Interview", short: "Customer", group: "customer" },
];

/** Result → tone. The Zoho scale is ordered worst-to-best. */
const POSITIVE = new Set(["Hire", "Strong Hire", "Leaning Hire"]);
const NEGATIVE = new Set(["No Hire", "Leaning No"]);

function toneFor(result?: string | null): { cls: string; Icon: typeof Check | null } {
  const r = (result || "").trim();
  if (!r) return { cls: "border-subtle bg-surface-2 text-muted", Icon: Minus };
  if (POSITIVE.has(r)) {
    return { cls: "border-success bg-success-soft text-success", Icon: Check };
  }
  if (NEGATIVE.has(r)) {
    return { cls: "border-danger bg-danger-soft text-danger", Icon: X };
  }
  return { cls: "border-subtle bg-surface-2 text-secondary", Icon: null };
}

export function RoundProgress({
  rounds,
  aiScore,
  aiResult,
  onOpen,
  fmtDateTime,
}: {
  rounds: RoundLike[];
  /** AI L1 sits at the head of the ladder — it is the first round. */
  aiScore?: number | null;
  aiResult?: string | null;
  onOpen?: () => void;
  fmtDateTime: (v?: string | null) => string | null;
}) {
  // Latest entry per (kind, stage): a re-run replaces its predecessor, but the
  // customer's L1 and L2 stay separate rows.
  const key = (kind: string, stage?: string | null) => `${kind}::${stage || ""}`;
  const byKey = new Map<string, RoundLike>();
  for (const r of rounds) if (r?.kind) byKey.set(key(r.kind, r.stage), r);

  const done = LADDER.filter((step) => byKey.has(key(step.kind, step.stage)))
    // A stage-less customer round is a fallback; hide it once the real
    // per-round entries exist, or the strip shows the same interview twice.
    .filter((step, _i, all) =>
      !(step.kind === "Customer_Interview" && !step.stage &&
        all.some((s) => s.kind === "Customer_Interview" && s.stage)));
  const hasAi = aiScore != null || !!aiResult;
  if (done.length === 0 && !hasAi) return null;

  const chip =
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Rounds</span>

      {hasAi && (
        <span
          className={`${chip} ${toneFor(aiResult === "Passed" ? "Hire" : aiResult === "Failed" ? "No Hire" : null).cls}`}
          title={`AI L1${aiScore != null ? ` — ${aiScore}%` : ""}${aiResult ? ` (${aiResult})` : ""}`}
        >
          <Bot size={11} aria-hidden />
          AI L1
          {aiScore != null && <span className="tnum font-bold">{Math.round(Number(aiScore))}</span>}
        </span>
      )}

      {done.map((step) => {
        const r = byKey.get(key(step.kind, step.stage))!;
        const { cls, Icon } = toneFor(r.result);
        const when = fmtDateTime(r.scheduled_at);
        return (
          <span
            key={`${step.kind}-${step.stage || "any"}`}
            className={`${chip} ${cls}`}
            title={[
              step.short,
              r.result ? `Result: ${r.result}` : r.status ? `Status: ${r.status}` : null,
              when,
            ].filter(Boolean).join(" · ")}
          >
            {Icon && <Icon size={11} aria-hidden />}
            {step.short}
          </span>
        );
      })}

      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          className="rounded-control px-1.5 py-0.5 text-xs font-semibold text-brand-600 transition-colors
                     duration-micro hover:underline focus-visible:outline-none focus-visible:ring-2
                     focus-visible:ring-brand-500 dark:text-brand-300"
        >
          View feedback
        </button>
      )}
    </div>
  );
}
