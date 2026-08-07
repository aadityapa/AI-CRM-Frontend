/**
 * Compact metric tile for the directory summary strip.
 *
 * Two constraints shaped this:
 *
 * 1. It must be a BUTTON, not a card. Every tile applies the filter it
 *    describes — "34 awaiting review" is only useful if clicking it shows you
 *    those 34. A number you cannot act on is decoration.
 *
 * 2. It must stay short. The table is the page; if the tiles push it below the
 *    fold they have made the page worse. Hence one line of label, one line of
 *    value, one line of context — no charts, no sparklines.
 */
import { memo } from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";

export type MetricDelta = {
  value: string;
  /** Direction of change, not judgement — see `goodDirection`. */
  direction: "up" | "down" | "flat";
  /**
   * Which direction is good for THIS metric. "Awaiting review" going up is
   * bad; "Advanced" going up is good. Without this the arrows would be
   * green-for-up everywhere and quietly mislead.
   */
  goodDirection?: "up" | "down" | "none";
};

const DELTA_ICON = { up: ArrowUp, down: ArrowDown, flat: ArrowRight } as const;

function deltaTone(d: MetricDelta): string {
  if (d.direction === "flat" || d.goodDirection === "none") return "text-muted";
  const isGood = d.direction === d.goodDirection;
  return isGood ? "text-success" : "text-danger";
}

export const MetricTile = memo(function MetricTile({
  label,
  value,
  context,
  delta,
  active = false,
  onClick,
}: {
  label: string;
  value: string | number;
  /** One short line under the number, e.g. "oldest waiting 6 days". */
  context?: string;
  delta?: MetricDelta;
  active?: boolean;
  onClick?: () => void;
}) {
  const Icon = delta ? DELTA_ICON[delta.direction] : null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-card border p-3 text-left transition-colors duration-micro ease-smooth
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2
        ${active
          ? "border-brand-400 bg-brand-50 dark:border-brand-500/60 dark:bg-brand-900/20"
          : "border-subtle bg-surface-1 hover:border-strong hover:bg-surface-2"}`}
    >
      <span className="block text-[11px] font-bold uppercase tracking-wider text-muted">
        {label}
      </span>
      <span className="mt-0.5 flex items-baseline gap-2">
        <span className="tnum font-display text-2xl font-bold leading-none tracking-tight text-primary">
          {value}
        </span>
        {delta && Icon && (
          <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${deltaTone(delta)}`}>
            <Icon size={11} aria-hidden />
            <span className="tnum">{delta.value}</span>
          </span>
        )}
      </span>
      {context && <span className="mt-0.5 block text-xs text-muted">{context}</span>}
    </button>
  );
});
