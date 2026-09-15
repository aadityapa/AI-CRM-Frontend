/**
 * One date-time formatter for the whole dashboard (15 Sep 2026, user request:
 * "all time format should be in 12 hours").
 *
 * `Date.prototype.toLocaleString()` with no arguments follows the machine's
 * locale — 24-hour on en-GB/de/… boxes, seconds included on en-US — so the
 * same timestamp read differently on every desk. These helpers pin the
 * format: en-IN, 12-hour clock, no seconds, `15 Sep 2026, 4:00 PM`.
 */

const DT_OPTS: Intl.DateTimeFormatOptions = {
  day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
};
const T_OPTS: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", hour12: true };
const D_OPTS: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" };

function toDate(v: string | number | Date | null | undefined): Date | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "15 Sep 2026, 4:00 PM" — or the fallback when the value is empty/invalid. */
export function fmtDateTime12(v: string | number | Date | null | undefined, fallback = "—"): string {
  const d = toDate(v);
  return d ? d.toLocaleString("en-IN", DT_OPTS) : fallback;
}

/** "4:00 PM" */
export function fmtTime12(v: string | number | Date | null | undefined, fallback = ""): string {
  const d = toDate(v);
  return d ? d.toLocaleTimeString("en-IN", T_OPTS) : fallback;
}

/** "15 Sep 2026" */
export function fmtDateShort(v: string | number | Date | null | undefined, fallback = "—"): string {
  const d = toDate(v);
  return d ? d.toLocaleDateString("en-IN", D_OPTS) : fallback;
}
