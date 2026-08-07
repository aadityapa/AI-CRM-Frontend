/**
 * Card view of the directory — the alternate to the table.
 *
 * Not a decorative variant. A table is for comparing a value down a column;
 * cards are for recognising a person. When a reviewer is looking for someone
 * they half-remember rather than ranking a shortlist, the card's avatar,
 * score ring and status together are faster than eight aligned columns.
 */
import { motion, useReducedMotion } from "framer-motion";

import { Avatar } from "../../components/Avatar";
import { ScoreIndicator } from "../../components/ScoreIndicator";
import { StatusBadge, EmptyState } from "../../components/ui";
import { displayEmail } from "../../lib/candidateEmail";
import type { ProfileColumnRow } from "./profileColumns";

export function ProfileCardGrid({
  rows,
  loading,
  emptyMessage,
  onOpen,
  selectedIds,
  onToggleSelect,
  fmtDate,
}: {
  rows: ProfileColumnRow[];
  loading?: boolean;
  emptyMessage: string;
  onOpen: (row: ProfileColumnRow) => void;
  selectedIds: Set<string | number>;
  onToggleSelect: (id: number) => void;
  fmtDate: (v?: string | null) => string;
}) {
  const reduce = useReducedMotion();

  if (loading && rows.length === 0) {
    return (
      <div className="elev-1 grid grid-cols-1 gap-3 rounded-panel p-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          // Skeletons match the final card's dimensions so nothing shifts on load.
          <div key={i} className="rounded-card border border-subtle p-4">
            <div className="flex items-start gap-3">
              <div className="shimmer h-8 w-8 rounded-full" aria-hidden />
              <div className="flex-1">
                <div className="shimmer mb-2 h-3.5 w-2/3 rounded-control" aria-hidden />
                <div className="shimmer h-3 w-1/2 rounded-control" aria-hidden />
              </div>
              <div className="shimmer h-8 w-8 rounded-full" aria-hidden />
            </div>
            <div className="shimmer mt-4 h-5 w-28 rounded-full" aria-hidden />
          </div>
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="elev-1 rounded-panel">
        <EmptyState message={emptyMessage} />
      </div>
    );
  }

  return (
    <div className="elev-1 grid grid-cols-1 gap-3 rounded-panel p-3 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((r, i) => {
        const name = r.candidate_name || `Candidate #${r.candidate_id}`;
        const selected = selectedIds.has(r.id);
        return (
          <motion.article
            key={r.id}
            initial={reduce || i >= 9 ? false : { opacity: 0, y: 4 }}
            animate={reduce || i >= 9 ? undefined : { opacity: 1, y: 0 }}
            transition={reduce || i >= 9 ? undefined : { duration: 0.16, ease: [0.16, 1, 0.3, 1], delay: Math.min(i, 8) * 0.02 }}
            className={`group cursor-pointer rounded-card border p-4 transition-colors duration-micro ease-smooth
              ${selected
                ? "border-brand-400 bg-brand-50 dark:border-brand-500/60 dark:bg-brand-900/20"
                : "border-subtle bg-surface-1 hover:border-strong hover:bg-surface-2"}`}
            onClick={() => onOpen(r)}
          >
            <div className="flex items-start gap-3">
              <Avatar name={name} size={32} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-primary" title={name}>{name}</div>
                <div className="truncate text-xs text-muted">
                  {r.opportunity_opp_id || "—"}{r.customer_name ? ` · ${r.customer_name}` : ""}
                </div>
              </div>
              <input
                type="checkbox"
                className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-brand-600"
                checked={selected}
                onClick={(e) => e.stopPropagation()}
                onChange={() => onToggleSelect(r.id)}
                aria-label={`Select ${name}`}
              />
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <ScoreIndicator score={r.ai_overall_score_percent} size="md" />
              <StatusBadge status={r.pipeline_status} />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-subtle pt-3">
              {r.experience_years != null && <Chip>{r.experience_years} yrs</Chip>}
              {r.notice_period && <Chip>{r.notice_period}</Chip>}
              {r.interview_round && <Chip>{r.interview_round}</Chip>}
              <span className="ml-auto text-xs text-muted">{fmtDate(r.applied_on || r.created_at)}</span>
            </div>
          </motion.article>
        );
      })}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-subtle bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-secondary">
      {children}
    </span>
  );
}
