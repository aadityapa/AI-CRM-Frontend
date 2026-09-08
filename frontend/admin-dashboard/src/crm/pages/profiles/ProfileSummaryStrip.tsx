/**
 * Four metric tiles above the directory table.
 *
 * Derived from the rows already on screen rather than a second API call —
 * there is no aggregate endpoint for this, and inventing one would mean the
 * tiles and the table could disagree. The trade-off is honest and stated in
 * the tile context line: these describe the current view, not the whole
 * database. "Total" uses the server's `meta.total` so it is the real count.
 */
import { useMemo } from "react";

import { MetricTile } from "../../components/MetricTile";
import { scoreTier } from "../../components/ScoreIndicator";
import type { ProfileColumnRow } from "./profileColumns";

/** Stages where the candidate is waiting on a human to look at them. */
const AWAITING = new Set(["Technical_Screening", "RMG_Review", "Sales_Screening"]);
/** Stages that mean the candidate got past the internal pipeline. */
const ADVANCED = new Set([
  "Customer_Screening", "Customer_Interview", "Shortlisted",
  "Customer_Approval", "HR_Screening", "HR_Interviewing", "Preboarding", "Joined",
]);

export function ProfileSummaryStrip({
  rows,
  total,
  activeMetric,
  onSelectMetric,
}: {
  rows: ProfileColumnRow[];
  total?: number;
  activeMetric: string | null;
  onSelectMetric: (metric: string | null) => void;
}) {
  const stats = useMemo(() => {
    const awaiting = rows.filter((r) => AWAITING.has(r.pipeline_status)).length;
    const advanced = rows.filter((r) => ADVANCED.has(r.pipeline_status)).length;
    const scored = rows
      .map((r) => r.ai_overall_score_percent)
      .filter((s): s is number => s != null && !Number.isNaN(Number(s)));
    const avg = scored.length
      ? (scored.reduce((a, b) => a + Number(b), 0) / scored.length).toFixed(1)
      : "—";
    const strong = rows.filter((r) => scoreTier(r.ai_overall_score_percent) === "strong").length;
    return { awaiting, advanced, avg, scored: scored.length, strong };
  }, [rows]);

  const toggle = (key: string) => onSelectMetric(activeMetric === key ? null : key);

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricTile
        label="Total"
        value={total ?? rows.length}
        context="all matching this view"
        active={activeMetric === null}
        onClick={() => onSelectMetric(null)}
      />
      <MetricTile
        label="Awaiting review"
        value={stats.awaiting}
        context="on this page"
        delta={{ value: String(stats.awaiting), direction: stats.awaiting > 0 ? "up" : "flat", goodDirection: "down" }}
        active={activeMetric === "awaiting"}
        onClick={() => toggle("awaiting")}
      />
      <MetricTile
        label="Advanced"
        value={stats.advanced}
        context="past internal screening"
        delta={{ value: String(stats.advanced), direction: stats.advanced > 0 ? "up" : "flat", goodDirection: "up" }}
        active={activeMetric === "advanced"}
        onClick={() => toggle("advanced")}
      />
      <MetricTile
        label="Average score"
        value={stats.avg}
        context={stats.scored ? `${stats.strong} strong of ${stats.scored} assessed` : "none assessed yet"}
        active={activeMetric === "strong"}
        onClick={() => toggle("strong")}
      />
    </div>
  );
}
