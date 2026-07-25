/**
 * Shared moonlit ambience for full-screen CRM wizards (Opportunity / Customer / Employee).
 * Visual-only: pointer-events-none, transform/opacity animations, reduced-motion safe.
 */
import React from "react";
import { useReducedMotion } from "framer-motion";
import "./wizard/premium.css";

const STARS: { top: string; left: string; size: number; delay: string }[] = [
  { top: "8%", left: "12%", size: 2, delay: "0s" },
  { top: "14%", left: "28%", size: 1.5, delay: "0.8s" },
  { top: "6%", left: "48%", size: 2, delay: "1.4s" },
  { top: "18%", left: "62%", size: 1.5, delay: "0.3s" },
  { top: "11%", left: "78%", size: 2.5, delay: "1.1s" },
  { top: "22%", left: "88%", size: 1.5, delay: "1.9s" },
  { top: "32%", left: "8%", size: 1.5, delay: "0.5s" },
  { top: "38%", left: "42%", size: 2, delay: "1.6s" },
  { top: "28%", left: "70%", size: 1.5, delay: "2.2s" },
  { top: "44%", left: "92%", size: 2, delay: "0.9s" },
  { top: "55%", left: "18%", size: 1.5, delay: "1.3s" },
  { top: "62%", left: "55%", size: 2, delay: "0.2s" },
  { top: "70%", left: "82%", size: 1.5, delay: "1.8s" },
  { top: "78%", left: "35%", size: 2, delay: "1.0s" },
  { top: "85%", left: "68%", size: 1.5, delay: "2.4s" },
];

/** Absolute moonlit backdrop — place as first child of a `relative` wizard shell. */
export function WizardAurora({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion();
  const motionOff = reduce ? " wiz-moonlit--static" : "";

  return (
    <div
      className={`wiz-moonlit pointer-events-none absolute inset-0 z-0 overflow-hidden${motionOff} ${className}`.trim()}
      aria-hidden
    >
      {/* Soft violet aurora blobs */}
      <div className="wiz-moonlit-blob wiz-moonlit-blob-a" />
      <div className="wiz-moonlit-blob wiz-moonlit-blob-b" />
      <div className="wiz-moonlit-blob wiz-moonlit-blob-c" />

      {/* Moonlight beam from top-right */}
      <div className="wiz-moonlit-beam" />

      {/* Moon disc + halo */}
      <div className="wiz-moonlit-moon-wrap">
        <div className="wiz-moonlit-moon-halo" />
        <div className="wiz-moonlit-moon">
          <span className="wiz-moonlit-crater wiz-moonlit-crater-1" />
          <span className="wiz-moonlit-crater wiz-moonlit-crater-2" />
          <span className="wiz-moonlit-crater wiz-moonlit-crater-3" />
        </div>
      </div>

      {/* Starfield */}
      <div className="wiz-moonlit-stars">
        {STARS.map((s, i) => (
          <span
            key={i}
            className="wiz-moonlit-star"
            style={{
              top: s.top,
              left: s.left,
              width: s.size,
              height: s.size,
              animationDelay: s.delay,
            }}
          />
        ))}
      </div>

      {/* Readability veil — keeps form text/inputs crisp over the effects */}
      <div className="wiz-moonlit-veil" />
    </div>
  );
}
