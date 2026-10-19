/**
 * The month a timesheet / invoice BILLS, as one chip (20 Oct 2026, user ask:
 * "wherever a timesheet or invoice is shown, I can see which month it is
 * without opening it"). The server gives every invoice row `month_label`
 * (the timesheet's month, else the invoice date) and `period_label` when the
 * sheet's window is not the calendar month ("21 Apr – 30 May 2026").
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "May 2026" from (2026, 5). PURE. */
export function monthName(year?: number | null, month?: number | null): string | null {
  if (!year || !month || month < 1 || month > 12) return null;
  return `${MONTHS[month - 1]} ${year}`;
}

/** "21 Apr – 30 May 2026" when the window is not the calendar month, else null. PURE. */
export function periodText(year?: number | null, month?: number | null,
  start?: string | null, end?: string | null): string | null {
  if (!year || !month || !start || !end) return null;
  const last = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, "0");
  if (start === `${year}-${mm}-01` && end === `${year}-${mm}-${String(last).padStart(2, "0")}`) return null;
  const p = (s: string) => { const [y, m, d] = s.split("-").map(Number); return { y, m, d }; };
  const a = p(start), b = p(end);
  if (!a.y || !b.y) return null;
  const left = `${a.d} ${MONTHS[a.m - 1]}${a.y !== b.y ? ` ${a.y}` : ""}`;
  return `${left} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
}

export function WorkMonth({ label, period, compact = false }: {
  label?: string | null; period?: string | null; compact?: boolean;
}) {
  if (!label) return <span className="text-muted">—</span>;
  return (
    <span className={`inline-flex ${compact ? "flex-wrap items-center gap-1" : "flex-col items-start gap-0.5"}`}
      title={period ? `Timesheet period ${period}` : "The month the work was done"}>
      <span className="whitespace-nowrap rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800 dark:bg-teal-950/40 dark:text-teal-200">
        {label}
      </span>
      {period && <span className="whitespace-nowrap text-[11px] text-muted">{period}</span>}
    </span>
  );
}
