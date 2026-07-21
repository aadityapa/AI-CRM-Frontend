import type { InterviewStatus } from "../types";

type StatusPillProps = {
  status: InterviewStatus | string;
  /** capsule: compact uppercase; tile: interview tables / reports */
  variant?: "capsule" | "tile";
};

export function StatusPill({ status, variant = "capsule" }: StatusPillProps) {
  const raw = String(status ?? "").trim();
  const s = raw.toLowerCase();

  let cls = "bg-warning-soft text-warning border-subtle";
  let label = raw || "Pending Review";

  if (raw === "Rejected" || s.includes("reject")) {
    cls = "bg-danger-soft text-danger border-subtle";
    label = "Rejected";
  } else if (raw === "Selected" || (s.includes("select") && !s.includes("deselect"))) {
    cls = "bg-success-soft text-success border-subtle";
    label = "Selected";
  } else if (raw === "On Hold" || s.includes("hold")) {
    // May 2026: deferred decision — stronger border to differentiate from
    // the neutral "Pending Review" badge.
    cls = "bg-warning-soft text-warning border-strong";
    label = "On Hold";
  } else if (raw === "Pending Review") {
    cls = "bg-warning-soft text-warning border-subtle";
    label = "Pending Review";
  } else if (s.includes("generat")) {
    cls = "bg-info-soft text-info border-subtle";
    label = "Generating";
  } else if (s.includes("complete")) {
    cls = "bg-success-soft text-success border-subtle";
    label = "Completed";
  } else if (s.includes("review")) {
    cls = "bg-brand-50 text-brand-700 border-subtle dark:bg-brand-900 dark:text-brand-200";
    label = "In Review";
  }

  const shape =
    variant === "tile"
      ? "rounded-control px-2.5 py-1 text-xs font-bold"
      : "rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider";

  return <span className={`inline-flex items-center border ${cls} ${shape}`}>{label}</span>;
}
