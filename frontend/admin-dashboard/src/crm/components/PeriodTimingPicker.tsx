/**
 * Mutually-exclusive Start/End-of-period checkboxes for leave credit / expire
 * cycles (Monthly | Quarterly | Yearly | Annually). Shared by Leave Billing
 * Policy dialogs (project + branch wizards).
 */
import React from "react";

const chk = "h-4 w-4 rounded border-subtle accent-brand-600";

/** True when the dropdown value is a calendar cycle that has start/end timing. */
export function isPeriodCycle(cycle: string): boolean {
  const c = String(cycle || "").toLowerCase();
  return (
    c.startsWith("month")
    || c.startsWith("quarter")
    || c.startsWith("year")
    || c.startsWith("annual")
  );
}

/** "Monthly" → "month", "Quarterly" → "quarter", "Yearly"/"Annually" → "year". */
export function periodWord(cycle: string): string {
  const c = String(cycle || "").toLowerCase();
  if (c.startsWith("month")) return "month";
  if (c.startsWith("quarter")) return "quarter";
  if (c.startsWith("year") || c.startsWith("annual")) return "year";
  return "period";
}

export type PeriodTiming = "Start_Of_Period" | "End_Of_Period";

export function PeriodTimingPicker({
  cycle,
  value,
  verb,
  onChange,
}: {
  cycle: string;
  value: string;
  verb: "Credit" | "Expire";
  onChange: (v: PeriodTiming) => void;
}) {
  if (!isPeriodCycle(cycle)) return null;
  const word = periodWord(cycle);
  const normalized: PeriodTiming =
    value === "End_Of_Period" ? "End_Of_Period" : "Start_Of_Period";
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
      {(["Start_Of_Period", "End_Of_Period"] as const).map((opt) => (
        <label key={opt} className="flex items-center gap-2 text-xs font-medium text-primary">
          <input
            type="checkbox"
            className={chk}
            checked={normalized === opt}
            onChange={() => onChange(opt)}
          />
          {verb} at {opt === "Start_Of_Period" ? "start" : "end"} of the {word}
        </label>
      ))}
    </div>
  );
}

/** PE leave-row caption: "Credited monthly at start · expires yearly at end". */
export function leaveTimingCaption(opts: {
  leave_credit_type?: string | null;
  leave_credit_timing?: string | null;
  leave_expire?: string | null;
  leave_expire_timing?: string | null;
}): string | null {
  const parts: string[] = [];
  const credit = String(opts.leave_credit_type || "").trim();
  if (credit && isPeriodCycle(credit)) {
    const when = opts.leave_credit_timing === "End_Of_Period" ? "end" : "start";
    parts.push(`Credited ${credit.toLowerCase()} at ${when}`);
  }
  const expire = String(opts.leave_expire || "").trim();
  if (expire && isPeriodCycle(expire)) {
    const when = opts.leave_expire_timing === "Start_Of_Period" ? "start" : "end";
    parts.push(`expires ${expire.toLowerCase()} at ${when}`);
  }
  return parts.length ? parts.join(" · ") : null;
}
