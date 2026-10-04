/**
 * The position row — ONE vocabulary for the Opportunities list every role
 * sees (1 Oct 2026, user ask: "this same UI for all roles for Opportunities,
 * functionality as per role"). TA's requirement list and the Sales / RMG / GM /
 * Admin pipeline list both print these helpers, so a band, a budget or a due
 * chip can never read differently from one login to the next. PURE.
 */

/** Requirement statuses after which nothing is due any more. */
export const REQ_TERMINAL_STATUSES = ["Fulfilled", "Closed", "Cancelled"];

/** "3 – 5 yrs" · "5+ yrs" · "up to 9 yrs" · "—". */
export function fmtRange(min: number | null | undefined, max: number | null | undefined, unit: string): string {
  if (min == null && max == null) return "—";
  const u = unit ? ` ${unit}` : "";
  if (min != null && max != null) return `${min} – ${max}${u}`;
  if (min != null) return `${min}+${u}`;
  return `up to ${max}${u}`;
}

/** "Overdue" / "N days left" chip for a target date — read-only, from the row. */
export function dueChip(date: string | null | undefined, status: string | null | undefined): { label: string; cls: string } | null {
  if (!date || REQ_TERMINAL_STATUSES.includes(String(status || ""))) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { label: `${-days}d overdue`, cls: "bg-danger-soft text-danger" };
  if (days <= 14) return { label: days === 0 ? "due today" : `${days}d left`, cls: "bg-warning-soft text-warning" };
  return null;
}

/** "7/10/2026" the way the position list prints dates (en-IN, no time). */
export function fmtRowDate(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN");
}
