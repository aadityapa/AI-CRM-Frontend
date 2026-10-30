/**
 * The Hiring Manager's Dashboard (23 Oct 2026).
 *
 * User report: "I am logged in as Hiring Manager and the Dashboard reads
 * 'nothing to show' — design something for his role." Everything here is about
 * the positions THIS login is on, from ONE call, `/api/dashboard/hiring-manager`:
 * what waits for their decision (JD to confirm · candidates to review · selections
 * to sign off), a card per position (status, headcount, candidates per phase,
 * the TA team), their own interviews, and the latest moves on their candidates.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Briefcase, CalendarClock, CheckCircle2, ClipboardCheck, ExternalLink, FileCheck2,
         ListChecks, RefreshCw, UserCheck, Users, Video } from "lucide-react";
import { crmGet } from "../../api";
import { CrmLink } from "../../routerHooks";
import { FilteredBars, ICON_BTN, Panel, Tile } from "../../components/controlTower";
import { ErrorBox, StatusBadge } from "../../components/ui";
import { FLOW_BTN } from "../../components/flowButtons";
import { STAGE_TONE } from "../../lib/candidateStageBuckets";
import { fmtDateShort, fmtDateTime12 } from "../../../lib/datetime";

type StageCount = { key: string; label: string; count: number };
type Decision = {
  kind: "jd" | "review" | "signoff"; title: string; subtitle?: string; customer?: string | null;
  since?: string | null; path: string; action: string; profile_id?: number;
};
type Position = {
  requirement_id: number; opportunity_id: number; label: string; title: string; customer?: string | null;
  status: string; display_status: string; priority?: string | null; target_date?: string | null;
  positions_total: number; positions_joined: number; positions_open: number;
  experience_min?: number | null; experience_max?: number | null; location?: string | null; work_mode?: string | null;
  assigned_tas: { user_id: number; name: string }[]; candidates: number; closed: number;
  stages: StageCount[]; waiting: number;
};
type Round = {
  id: number; round_label: string; scheduled_at?: string | null; raw_when?: string | null;
  meeting_link?: string | null; candidate?: string | null; position?: { opp_id?: string; title?: string } | null;
};
export type HmDashboardData = {
  assigned: boolean;
  tiles: { positions: number; open_positions: number; candidates: number; waiting: number;
           interviews_week: number; feedback_due: number; joined: number };
  decisions: Decision[]; positions: Position[]; stages: StageCount[];
  interviews: { due: Round[]; upcoming: Round[]; linked: boolean };
  recent: { profile_id: number; candidate?: string; action: string; comment: string; by?: string | null; at?: string | null }[];
};

const KIND_LOOK: Record<Decision["kind"], { word: string; cls: string; Icon: typeof FileCheck2 }> = {
  jd: { word: "JD & skills", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300", Icon: FileCheck2 },
  review: { word: "Review", cls: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300", Icon: UserCheck },
  signoff: { word: "Sign-off", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300", Icon: CheckCircle2 },
};

/** "3 d" / "Today" since a timestamp. PURE. */
export function waitedFor(since?: string | null, now = Date.now()): string {
  if (!since) return "";
  const days = Math.floor((now - new Date(since).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 1) return "Today";
  return `${days} d`;
}

/** The phases worth drawing on a card: every live phase with someone in it. PURE. */
export function liveStages(stages: StageCount[]): StageCount[] {
  return stages.filter((s) => s.count > 0);
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-center text-sm text-muted">{children}</p>;
}

function moveWords(m: HmDashboardData["recent"][number]): string {
  if (m.action === "STATUS_CHANGE") {
    const [, to] = (m.comment.split(":")[0] || "").split("->").map((s) => s.trim());
    return to ? `moved to ${to.replace(/_/g, " ")}` : "stage changed";
  }
  if (m.action === "HM_REVIEW") return "Hiring Manager review";
  if (m.action === "HM_SIGNOFF") return "Hiring Manager sign-off";
  if (m.action === "RESULT_RECORDED") return "interview result recorded";
  return m.action.replace(/_/g, " ").toLowerCase();
}

function PositionCard({ p }: { p: Position }) {
  const pct = p.positions_total ? Math.round((p.positions_joined / p.positions_total) * 100) : 0;
  const shown = liveStages(p.stages);
  const band = p.experience_min != null || p.experience_max != null
    ? `${p.experience_min ?? 0}–${p.experience_max ?? "+"} yrs` : null;
  return (
    <article className="fx-lift flex flex-col gap-3 rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] font-semibold text-secondary">{p.label}</span>
            {p.priority && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">{p.priority}</span>}
            {p.waiting > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">{p.waiting} waiting for you</span>}
          </div>
          <CrmLink to={`opportunities/${p.opportunity_id}`} className="mt-1 block truncate text-sm font-bold text-primary hover:underline">{p.title}</CrmLink>
          <div className="truncate text-xs text-secondary">
            {[p.customer, band, [p.work_mode, p.location].filter(Boolean).join(" · ")].filter(Boolean).join(" · ")}
          </div>
        </div>
        <StatusBadge status={p.status} label={p.display_status} />
      </div>
      <div>
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-semibold text-primary">{p.positions_joined} of {p.positions_total} filled</span>
          <span className="text-muted">{p.positions_open} open{p.target_date ? ` · target ${fmtDateShort(p.target_date)}` : ""}</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div>
        <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
          Candidates · {p.candidates} live{p.closed ? ` · ${p.closed} closed` : ""}
        </div>
        {shown.length ? (
          <div className="flex flex-wrap gap-1.5">
            {shown.map((s) => (
              <span key={s.key} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STAGE_TONE[s.key] || "bg-surface-2 text-secondary"}`}>
                {s.label} · {s.count}
              </span>
            ))}
          </div>
        ) : <p className="text-xs text-muted">No candidates applied yet.</p>}
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-subtle pt-2">
        <span className="truncate text-xs text-secondary">
          <Users size={12} className="mr-1 inline" aria-hidden />
          {p.assigned_tas.length ? p.assigned_tas.map((t) => t.name).join(", ") : "No TA assigned yet"}
        </span>
        <CrmLink to={`opportunities/${p.opportunity_id}`} className={FLOW_BTN.view}>Open <ExternalLink size={11} aria-hidden /></CrmLink>
      </div>
    </article>
  );
}

export function HiringManagerDashboard() {
  const [data, setData] = useState<HmDashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    crmGet<HmDashboardData>("/api/dashboard/hiring-manager")
      .then((r) => setData(r.data))
      .catch((e: any) => setError(e?.message || "Could not load your positions"))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const stageRows = useMemo(
    () => (data?.stages || []).filter((s) => s.key !== "closed").map((s) => ({ label: s.label, Candidates: s.count })),
    [data],
  );

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <div className="h-48 animate-pulse rounded-card bg-surface-2" aria-busy={loading} />;
  const t = data.tiles;

  return (
    <section className="space-y-5" aria-label="Hiring Manager dashboard">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-primary"><Briefcase size={16} aria-hidden /> My positions as Hiring Manager</h2>
          <p className="text-xs text-muted">The positions you are on — what waits for you, where every candidate stands, and your interviews.</p>
        </div>
        <button type="button" onClick={load} className={ICON_BTN} aria-label="Refresh" title="Refresh">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} aria-hidden />
        </button>
      </div>

      {!data.assigned && (
        <div className="rounded-card border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
          You are not on any position yet. RMG / GM add you as the Hiring Manager when they approve a position (or later
          from the position's team panel) — it appears here at once, and you are told by email.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Tile label="My positions" value={t.positions} sub="Positions you are the Hiring Manager of" to="opportunities" />
        <Tile label="Open headcount" value={t.open_positions} sub="Still to fill across them" />
        <Tile label="Candidates live" value={t.candidates} sub="In the pipeline on your positions" to="profiles" />
        <Tile label="Waiting for you" value={t.waiting} tone={t.waiting ? "warning" : "success"}
          sub="JD to confirm · reviews · sign-offs" to="my-tasks?tab=hm_review" />
        <Tile label="Interviews this week" value={t.interviews_week}
          sub={t.feedback_due ? `${t.feedback_due} feedback due` : "Booked with you"} tone={t.feedback_due ? "warning" : "brand"}
          to="my-interviews?scope=all" />
        <Tile label="Joined" value={t.joined} tone="success" sub="Filled on your positions" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr),minmax(0,2fr)]">
        <Panel title={`Waiting for your decision (${data.decisions.length})`}
          hint="Oldest first. A candidate goes to the customer only after your review; the Sales Head approves only after your sign-off.">
          {data.decisions.length ? (
            <ul>
              {data.decisions.map((d, i) => {
                const look = KIND_LOOK[d.kind];
                return (
                  <li key={`${d.kind}-${d.profile_id ?? d.path}-${i}`}
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-subtle py-2.5 first:border-t-0">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control ${look.cls}`}><look.Icon size={14} aria-hidden /></span>
                      <div className="min-w-0">
                        <CrmLink to={d.path} className="block truncate text-sm font-semibold text-primary hover:underline">{d.title}</CrmLink>
                        <div className="truncate text-xs text-secondary">{[d.subtitle, d.customer].filter(Boolean).join(" · ")}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${look.cls}`}>{look.word}</span>
                      {d.since && <span className="text-[11px] text-muted">{waitedFor(d.since)}</span>}
                      <CrmLink to={d.path} className={FLOW_BTN.warn}><ClipboardCheck size={12} aria-hidden /> {d.action}</CrmLink>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <Empty><CheckCircle2 size={14} className="mr-1 inline text-success" aria-hidden /> Nothing is waiting for you.</Empty>}
        </Panel>

        <Panel title="My interviews" hint="Rounds booked with you. Record the verdict on My Interviews."
          action={<CrmLink to="my-interviews?scope=all" className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">All <ExternalLink size={11} className="inline" aria-hidden /></CrmLink>}>
          {!data.interviews.linked ? (
            <p className="text-sm text-muted">Your login is not linked to an Employees record yet, so no interview can be booked
              with you. Ask HR / Admin to add you to Employees with this login's email.</p>
          ) : data.interviews.due.length + data.interviews.upcoming.length ? (
            <ul>
              {[...data.interviews.due, ...data.interviews.upcoming].map((r) => {
                const due = data.interviews.due.includes(r);
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-subtle py-2.5 first:border-t-0">
                    <div className="min-w-0">
                      <CrmLink to={`my-interviews?scope=all&focus=${r.id}`} className="block truncate text-sm font-semibold text-primary hover:underline">{r.candidate || "Candidate"}</CrmLink>
                      <div className="truncate text-xs text-secondary">{r.round_label}{r.position?.title ? ` · ${r.position.title}` : ""}</div>
                      <div className="flex items-center gap-1 text-xs text-muted"><CalendarClock size={11} aria-hidden />
                        {r.scheduled_at ? fmtDateTime12(r.scheduled_at, r.raw_when || "—") : r.raw_when || "Time not set"}</div>
                    </div>
                    {due ? (
                      <CrmLink to={`my-interviews?scope=all&focus=${r.id}`} className={FLOW_BTN.warn}><ClipboardCheck size={12} aria-hidden /> Feedback</CrmLink>
                    ) : r.meeting_link ? (
                      <a className={FLOW_BTN.view} href={r.meeting_link} target="_blank" rel="noreferrer"><Video size={12} aria-hidden /> Join</a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : <Empty>No interview due or booked this week.</Empty>}
        </Panel>
      </div>

      {data.positions.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-primary"><ListChecks size={15} aria-hidden /> Positions ({data.positions.length})</h3>
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {data.positions.map((p) => <PositionCard key={p.requirement_id} p={p} />)}
          </div>
        </div>
      )}

      {data.positions.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Candidates by stage" hint="Every live candidate on your positions, by the stage they are in.">
            <FilteredBars data={stageRows} series={[{ key: "Candidates", label: "Candidates", color: 0 }]} height={240}
                          barLink={() => "profiles"} clickHint="Click a bar to open Candidate Profiles" />
          </Panel>
          <Panel title="Latest moves" hint="The last stage changes and decisions on your candidates.">
            {data.recent.length ? (
              <ul>
                {data.recent.map((m, i) => (
                  <li key={`${m.profile_id}-${i}`} className="border-t border-subtle py-2 first:border-t-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <CrmLink to={`profiles/${m.profile_id}`} className="text-sm font-semibold text-primary hover:underline">{m.candidate || "Candidate"}</CrmLink>
                      <span className="text-[11px] text-muted">{m.at ? fmtDateTime12(m.at) : ""}</span>
                    </div>
                    <div className="text-xs text-secondary">{moveWords(m)}{m.by ? ` · by ${m.by}` : ""}</div>
                  </li>
                ))}
              </ul>
            ) : <Empty>No movement yet.</Empty>}
          </Panel>
        </div>
      )}
    </section>
  );
}
