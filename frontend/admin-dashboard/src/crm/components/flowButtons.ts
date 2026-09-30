/**
 * ONE palette for the small action buttons on candidate rows (28 Sep 2026,
 * user ask: "all these buttons with a good colour combination, in every
 * login"). The colour says what KIND of step a button is, the same on
 * Applied Candidates, the Screening Desk and the profile page:
 *
 *   primary   sky      move the candidate forward (Technical Screening, Schedule, Submit)
 *   success   emerald  a positive verdict (Shortlist, Approve, Release hold)
 *   warn      amber    park / needs attention (Hold, feedback due)
 *   danger    rose     close the candidacy (Reject) — soft fill
 *   delete    rose     remove a record (Delete) — solid, the one irreversible button
 *   ai        violet   the AI interview (AI L1 route, Schedule AI L1, Slot invite)
 *   manual    indigo   a human round (Manual L1, Request L2, Interviews)
 *   view      sky      open something (View profile, View resume)
 *   edit      teal     change details (Edit)
 *   withdraw  fuchsia  the candidate walked away (Self Withdraw)
 *   neutral   slate    anything else (Send back, Dismiss) — still a tinted fill
 *
 * No button is plain white (28 Sep 2026, user ask: "make sure every button has
 * colour"): solid fills for the ONE step the row is waiting on, soft tinted
 * fills for the rest, so the next move stands out in a row of six buttons.
 */
const base =
  "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-colors duration-micro "
  + "focus-visible:outline-none focus-visible:shadow-focus-ring disabled:cursor-not-allowed disabled:opacity-50";

export const FLOW_BTN = {
  primary: `${base} bg-sky-600 text-white hover:bg-sky-700`,
  success: `${base} bg-emerald-600 text-white hover:bg-emerald-700`,
  warn: `${base} border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300`,
  danger: `${base} border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-300`,
  delete: `${base} bg-rose-600 text-white hover:bg-rose-700`,
  ai: `${base} bg-violet-600 text-white hover:bg-violet-700`,
  aiOutline: `${base} border border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-300`,
  manual: `${base} bg-indigo-600 text-white hover:bg-indigo-700`,
  manualOutline: `${base} border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300`,
  view: `${base} border border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-300`,
  edit: `${base} border border-teal-300 bg-teal-50 text-teal-700 hover:bg-teal-100 dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-300`,
  withdraw: `${base} border border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100 dark:border-fuchsia-700 dark:bg-fuchsia-950/40 dark:text-fuchsia-300`,
  neutral: `${base} border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300`,
} as const;

/** A finished step, greyed — history, not an action. */
export const FLOW_DONE_CHIP =
  "inline-flex cursor-default items-center rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted ring-1 ring-inset ring-subtle";

/** Has the interview's start time passed? Unknown time = yes (never lock a
 *  verdict behind a date nobody recorded). */
export function roundHasStarted(when: string | null | undefined, now: Date = new Date()): boolean {
  if (!when) return true;
  const t = new Date(when).getTime();
  return Number.isNaN(t) || t <= now.getTime();
}
