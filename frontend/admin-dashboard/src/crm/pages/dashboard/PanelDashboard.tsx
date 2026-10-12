/**
 * The interviewer's Dashboard (10 Oct 2026) — for a panel-only login (the
 * "Interviewer" role, whose one working tab is My Interviews).
 *
 * User ask: "design a Dashboard for this interviewer login as he requires;
 * remove the Hiring control tower". A panel member's day is: which interviews
 * do I have today (and the join link), whose feedback do I still owe, what is
 * booked next, and what did I decide recently. Everything comes from ONE call,
 * `/api/my-interviews?scope=all` — the same rounds My Interviews lists, so the
 * two can never disagree. Every row opens that round on My Interviews.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, ClipboardCheck, ExternalLink, UserX, Video } from "lucide-react";
import { crmGet } from "../../api";
import { CrmLink } from "../../routerHooks";
import { Panel, Tile } from "../../components/controlTower";
import { ErrorBox } from "../../components/ui";
import { FLOW_BTN } from "../../components/flowButtons";
import { roundResultTone } from "../../lib/interviewRounds";
import { fmtDateTime12, fmtTime12 } from "../../../lib/datetime";
import type { Counts, MyRound } from "../MyInterviews";
import { PHASE_CHIP, PHASE_WORD } from "../MyInterviews";

const DAY = 86_400_000;

function startOf(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Split the rounds the way the dashboard reads them. PURE. */
export function panelBuckets(rows: MyRound[], now = new Date()) {
  const t0 = startOf(now);
  const at = (r: MyRound) => (r.scheduled_at ? new Date(r.scheduled_at).getTime() : NaN);
  const byTime = (a: MyRound, b: MyRound) => (at(a) || 0) - (at(b) || 0);
  const today = rows.filter((r) => Number.isFinite(at(r)) && at(r) >= t0 && at(r) < t0 + DAY).sort(byTime);
  const due = rows.filter((r) => r.phase === "pending").sort(byTime);
  const next = rows.filter((r) => r.phase === "upcoming" && Number.isFinite(at(r)) && at(r) >= t0 + DAY && at(r) < t0 + 8 * DAY).sort(byTime);
  const recent = rows.filter((r) => r.phase === "done" || r.phase === "no_show").sort((a, b) => byTime(b, a)).slice(0, 8);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const doneThisMonth = rows.filter((r) => r.result && Number.isFinite(at(r)) && at(r) >= monthStart).length;
  const noShows = rows.filter((r) => r.phase === "no_show").length;
  return { today, due, next, recent, doneThisMonth, noShows };
}

const focusLink = (r: MyRound) => `my-interviews?scope=all&focus=${r.id}`;

function Row({ r, showDate = true }: { r: MyRound; showDate?: boolean }) {
  const when = r.scheduled_at ? (showDate ? fmtDateTime12(r.scheduled_at, r.raw_when || "—") : fmtTime12(r.scheduled_at)) : r.raw_when || "Time not set";
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-t border-subtle py-2.5 first:border-t-0">
      <div className="min-w-0">
        <CrmLink to={focusLink(r)} className="block truncate text-sm font-semibold text-primary hover:underline">{r.candidate.name}</CrmLink>
        <div className="truncate text-xs text-secondary">
          {r.round_label}{r.position.title ? ` · ${r.position.opp_id ? `${r.position.opp_id} — ` : ""}${r.position.title}` : ""}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted"><CalendarClock size={11} aria-hidden /> {when}
          {r.duration_minutes ? <span>· {r.duration_minutes} min</span> : null}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.result ? roundResultTone(r.result) : PHASE_CHIP[r.phase]}`}>
          {r.result || PHASE_WORD[r.phase]}
        </span>
        {r.meeting_link && r.phase === "upcoming" && (
          <a className={FLOW_BTN.view} href={r.meeting_link} target="_blank" rel="noreferrer"><Video size={12} aria-hidden /> Join</a>
        )}
        {r.phase === "pending" && (
          <CrmLink to={focusLink(r)} className={FLOW_BTN.warn}><ClipboardCheck size={12} aria-hidden /> Feedback</CrmLink>
        )}
      </div>
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-center text-sm text-muted">{children}</p>;
}

export function PanelDashboard() {
  const [rows, setRows] = useState<MyRound[]>([]);
  const [counts, setCounts] = useState<Counts>({ pending: 0, upcoming: 0, done: 0, no_show: 0 });
  const [linked, setLinked] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    crmGet<MyRound[]>("/api/my-interviews?scope=all")
      .then((r) => {
        setRows(r.data || []);
        const meta = (r.meta || {}) as { counts?: Counts; linked?: boolean };
        if (meta.counts) setCounts(meta.counts);
        setLinked(meta.linked !== false);
      })
      .catch((e: any) => setError(e?.message || "Could not load your interviews"))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const b = useMemo(() => panelBuckets(rows), [rows]);
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (loading && rows.length === 0) return <div className="h-48 animate-pulse rounded-card bg-surface-2" aria-busy="true" />;

  return (
    <div className="space-y-5">
      {!linked && (
        <div className="rounded-card border border-warning bg-warning-soft px-4 py-3 text-sm text-warning">
          Your login is not linked to an Employees record yet, so no interview can reach you. Ask HR / Admin to add you to
          Employees with this login's email.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="Today" value={b.today.length} sub="Interviews on your calendar today" to="my-interviews?scope=all" />
        <Tile label="Feedback due" value={counts.pending} tone={counts.pending ? "warning" : "success"}
          sub="Interviews over, verdict not recorded" to="my-interviews?scope=pending" />
        <Tile label="Upcoming" value={counts.upcoming} sub="Booked with you" to="my-interviews?scope=upcoming" />
        <Tile label="Decided this month" value={b.doneThisMonth} tone="success" sub="Verdicts you recorded" to="my-interviews?scope=done" />
        <Tile label="Didn't join" value={b.noShows} tone={b.noShows ? "danger" : "neutral"} sub="Rounds the candidate missed" to="my-interviews?scope=done" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Today" hint="Join the call from here; feedback opens 10 minutes after the start."
          action={<CrmLink to="my-interviews?scope=all" className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">All interviews <ExternalLink size={11} className="inline" aria-hidden /></CrmLink>}>
          {b.today.length ? <ul>{b.today.map((r) => <Row key={r.id} r={r} showDate={false} />)}</ul>
            : <Empty>No interview booked with you today.</Empty>}
        </Panel>
        <Panel title={`Feedback you owe (${b.due.length})`} hint="Oldest first — TA and RMG wait on these to move the candidate.">
          {b.due.length ? <ul>{b.due.map((r) => <Row key={r.id} r={r} />)}</ul>
            : <Empty>Nothing waiting for your feedback.</Empty>}
        </Panel>
        <Panel title="Next 7 days" hint="Open one to read the JD, the CV and where the AI interview says to probe.">
          {b.next.length ? <ul>{b.next.map((r) => <Row key={r.id} r={r} />)}</ul>
            : <Empty>Nothing booked in the next week.</Empty>}
        </Panel>
        <Panel title="Recently decided" hint="Your latest verdicts and no-shows.">
          {b.recent.length ? <ul>{b.recent.map((r) => <Row key={r.id} r={r} />)}</ul>
            : <Empty><UserX size={14} className="mr-1 inline" aria-hidden /> No decided interviews yet.</Empty>}
        </Panel>
      </div>
    </div>
  );
}
