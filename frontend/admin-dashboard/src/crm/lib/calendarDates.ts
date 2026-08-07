/**
 * Date maths for the interview calendar.
 *
 * The dashboard has no date library (no dayjs, date-fns or luxon), and adding
 * one for a single week grid is not worth ~20 kB. Native `Date` is enough
 * provided the awkward parts are written once, here, and tested — rather than
 * scattered through the component.
 *
 * Everything works in LOCAL wall time on purpose. The backend returns naive
 * local ISO strings (the legacy interview schedule has no timezone at all), and
 * a recruiter and candidate agree on a clock time, not an instant. Converting
 * to UTC anywhere in this file would shift every interview by the viewer's
 * offset.
 */

export const MS_PER_MINUTE = 60_000;
export const MINUTES_PER_DAY = 24 * 60;

/** Parse the backend's naive local ISO string without a timezone shift. */
export function parseLocalIso(value?: string | null): Date | null {
  const text = String(value || "").trim();
  if (!text) return null;
  // "2026-08-07T12:30:00" — build from parts so the runtime cannot decide this
  // is UTC. `new Date("2026-08-07T12:30:00Z")` and the bare form differ across
  // engines; splitting removes the ambiguity entirely.
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    return new Date(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6] || 0), 0,
    );
  }
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** `Date` -> "YYYY-MM-DD" in local time. */
export function toDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `Date` -> "YYYY-MM-DDTHH:MM" for a datetime-local input. */
export function toDateTimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${toDateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/**
 * Which day the week starts on. 0 = Sunday, 1 = Monday.
 *
 * Sunday matches the Outlook/Teams calendar this view was modelled on (its
 * header reads "August 2–8" with Sunday in the first column). Kept as a named
 * constant rather than a literal so it is one edit if the org switches.
 */
export const WEEK_STARTS_ON = 0;

/** First day of the week containing `d`. */
export function startOfWeek(d: Date, weekStartsOn: number = WEEK_STARTS_ON): Date {
  const out = startOfDay(d);
  // getDay() is 0 for Sunday. Adding 7 before the modulo keeps the result
  // non-negative for any weekStartsOn — a plain subtraction goes negative and
  // silently lands a week early.
  const offset = (out.getDay() - weekStartsOn + 7) % 7;
  return addDays(out, -offset);
}

/** The seven days of the week containing `d`, week-start first. */
export function weekDays(d: Date, weekStartsOn: number = WEEK_STARTS_ON): Date[] {
  const first = startOfWeek(d, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

export function isWeekend(d: Date): boolean {
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

/** Minutes since local midnight — the y coordinate on the grid. */
export function minutesSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** "12:30 PM" style label, respecting the viewer's locale. */
export function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "10 AM" gutter label. */
export function formatHour(hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric" });
}

/** "Friday, 7 August 2026" */
export function formatLongDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

/** "August 2–8, 2026" — the header label, collapsing shared month/year. */
export function formatWeekRange(days: Date[]): string {
  if (days.length === 0) return "";
  const first = days[0];
  const last = days[days.length - 1];
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: "long" });
  if (first.getFullYear() !== last.getFullYear()) {
    return `${month(first)} ${first.getDate()}, ${first.getFullYear()} – ` +
           `${month(last)} ${last.getDate()}, ${last.getFullYear()}`;
  }
  if (first.getMonth() !== last.getMonth()) {
    return `${month(first)} ${first.getDate()} – ${month(last)} ${last.getDate()}, ${last.getFullYear()}`;
  }
  return `${month(first)} ${first.getDate()}–${last.getDate()}, ${last.getFullYear()}`;
}

/* ------------------------------------------------------------------ */
/* Overlap layout                                                      */
/* ------------------------------------------------------------------ */

export type Positioned<T> = {
  item: T;
  /** Minutes from midnight to the top edge. */
  top: number;
  /** Height in minutes (never below `minHeight` so short events stay clickable). */
  height: number;
  /** 0-based column within its overlap cluster. */
  column: number;
  /** How many columns the cluster needs. */
  columns: number;
};

/**
 * Lay out a day's events side by side where they overlap.
 *
 * Events are grouped into clusters of mutual overlap, and each cluster is split
 * into as many columns as its busiest moment needs. This is the same approach
 * Outlook and Google Calendar use: without it, two interviews at 12:30 render
 * exactly on top of each other and one is simply invisible.
 */
export function layoutDayEvents<T>(
  items: T[],
  getRange: (item: T) => { start: number; end: number },
  minHeight = 24,
): Positioned<T>[] {
  const rows = items
    .map((item) => {
      const { start, end } = getRange(item);
      return { item, start, end: Math.max(end, start + minHeight) };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const out: Positioned<T>[] = [];
  let cluster: typeof rows = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    // Greedy column assignment: reuse the first column whose last event ended.
    const columnEnds: number[] = [];
    const assigned = cluster.map((row) => {
      let col = columnEnds.findIndex((end) => end <= row.start);
      if (col === -1) {
        col = columnEnds.length;
        columnEnds.push(row.end);
      } else {
        columnEnds[col] = row.end;
      }
      return { row, col };
    });
    const columns = columnEnds.length;
    for (const { row, col } of assigned) {
      out.push({
        item: row.item,
        top: row.start,
        height: row.end - row.start,
        column: col,
        columns,
      });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const row of rows) {
    if (cluster.length > 0 && row.start >= clusterEnd) flush();
    cluster.push(row);
    clusterEnd = Math.max(clusterEnd, row.end);
  }
  flush();
  return out;
}
