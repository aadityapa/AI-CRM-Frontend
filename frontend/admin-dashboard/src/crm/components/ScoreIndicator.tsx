/**
 * Assessment score — ring + numeral + word.
 *
 * The score is one of the two signals a reviewer actually acts on (the other
 * is pipeline status), so it gets a purpose-built component rather than being
 * one more text cell.
 *
 * Three non-colour channels carry the value, deliberately:
 *   1. the ring's arc length — quantitative, survives greyscale and every form
 *      of colour blindness
 *   2. the numeral
 *   3. the word — Strong / Good / Moderate / Weak
 *
 * Colour is a fourth, redundant accent. That is not belt-and-braces: on a
 * near-white surface four hues cannot be both >=3:1 for graphical objects AND
 * separable under protanopia, because clearing 3:1 compresses the luminance
 * range until simulated teal and amber collide. Measured, not assumed — see
 * the SCORE SCALE block in styles/tokens.css.
 */
import { memo } from "react";

export type ScoreTier = "strong" | "good" | "moderate" | "weak" | "none";

/**
 * Tier thresholds. THE one place scores turn into words and colours —
 * the list, the profile header and the card grid all read from here, so a
 * candidate cannot be "Good" in one view and "Moderate" in another.
 *
 * 55 is the floor for Moderate rather than 60 (the AI pass mark) on purpose:
 * the pass mark is a decision, this scale is a description. A 57 is a mediocre
 * result whether or not it cleared the bar, and the status pill already says
 * whether it passed.
 */
export const SCORE_THRESHOLDS = { strong: 85, good: 70, moderate: 55 } as const;

export function scoreTier(score: number | null | undefined): ScoreTier {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return "none";
  const n = Number(score);
  if (n >= SCORE_THRESHOLDS.strong) return "strong";
  if (n >= SCORE_THRESHOLDS.good) return "good";
  if (n >= SCORE_THRESHOLDS.moderate) return "moderate";
  return "weak";
}

export const SCORE_LABEL: Record<ScoreTier, string> = {
  strong: "Strong",
  good: "Good",
  moderate: "Moderate",
  weak: "Weak",
  none: "Not assessed",
};

/** Ring stroke + text colour per tier. Both come from the token layer. */
const TIER_CLASS: Record<ScoreTier, { stroke: string; text: string }> = {
  strong: { stroke: "stroke-score-strong-ring", text: "text-score-strong-fg" },
  good: { stroke: "stroke-score-good-ring", text: "text-score-good-fg" },
  moderate: { stroke: "stroke-score-moderate-ring", text: "text-score-moderate-fg" },
  weak: { stroke: "stroke-score-weak-ring", text: "text-score-weak-fg" },
  none: { stroke: "stroke-score-none-ring", text: "text-score-none-fg" },
};

type Size = "sm" | "md" | "lg";

/** px per size — kept here rather than inline so the three call sites agree. */
const DIMS: Record<Size, { box: number; radius: number; stroke: number; numeral: string; word: string }> = {
  sm: { box: 28, radius: 11, stroke: 3, numeral: "text-[11px]", word: "text-xs" },
  md: { box: 34, radius: 14, stroke: 3.5, numeral: "text-xs", word: "text-xs" },
  lg: { box: 104, radius: 45, stroke: 8, numeral: "text-2xl", word: "text-base" },
};

export const ScoreIndicator = memo(function ScoreIndicator({
  score,
  size = "md",
  showLabel = true,
  className = "",
}: {
  score: number | null | undefined;
  size?: Size;
  /** Hide the word where space is genuinely tight — the numeral still carries it. */
  showLabel?: boolean;
  className?: string;
}) {
  const tier = scoreTier(score);
  const label = SCORE_LABEL[tier];
  const dims = DIMS[size];
  const tone = TIER_CLASS[tier];

  const pct = tier === "none" ? 0 : Math.max(0, Math.min(100, Number(score)));
  const circumference = 2 * Math.PI * dims.radius;
  const offset = circumference * (1 - pct / 100);
  const centre = dims.box / 2;

  // One accessible sentence rather than a ring, a number and a word read out
  // as three unrelated fragments.
  const spoken =
    tier === "none"
      ? "No assessment score on record"
      : `Assessment score ${pct} out of 100, ${label}`;

  return (
    <span className={`inline-flex items-center gap-2 ${className}`} role="img" aria-label={spoken}>
      <span className="relative shrink-0" style={{ width: dims.box, height: dims.box }}>
        <svg width={dims.box} height={dims.box} className="-rotate-90 block" aria-hidden="true">
          <circle
            cx={centre} cy={centre} r={dims.radius}
            fill="none" strokeWidth={dims.stroke}
            className="stroke-subtle"
          />
          {tier !== "none" && (
            <circle
              cx={centre} cy={centre} r={dims.radius}
              fill="none" strokeWidth={dims.stroke} strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className={`${tone.stroke} transition-[stroke-dashoffset] duration-panel ease-smooth`}
            />
          )}
        </svg>
        <span
          className={`tnum absolute inset-0 grid place-items-center font-bold tracking-tight ${dims.numeral} ${tone.text}`}
          aria-hidden="true"
        >
          {tier === "none" ? "–" : Math.round(pct)}
        </span>
      </span>
      {showLabel && (
        <span className={`font-semibold ${dims.word} ${tone.text}`} aria-hidden="true">
          {label}
        </span>
      )}
    </span>
  );
});
