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

/**
 * A stored interview time → the value an `<input type="datetime-local">` shows,
 * as the IST wall clock the team typed (28 Sep 2026 bug).
 *
 * The API returns aware instants (`2026-09-28T05:24:00+00:00` = 10:54 AM IST).
 * The round editors used to `slice(0, 16)` that string, so the field showed the
 * UTC clock (05:24); saving it back (read by the server as IST) moved the
 * interview 5h30 EARLIER on every edit — "Technical L1, 28 Sep, 5:24 am".
 * An aware value is converted to Asia/Kolkata; a naive stamp ("2026-09-28
 * 10:54", already IST) is only reshaped. Unparseable input gives "".
 */
export function isoToIstInput(v: string | null | undefined): string {
  const s = String(v || "").trim();
  if (!s) return "";
  const aware = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
  if (!aware) {
    const m = s.replace(" ", "T").match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    return m ? m[0] : "";
  }
  const d = toDate(s);
  if (!d) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** "15 Sep 2026" */
export function fmtDateShort(v: string | number | Date | null | undefined, fallback = "—"): string {
  const d = toDate(v);
  return d ? d.toLocaleDateString("en-IN", D_OPTS) : fallback;
}
