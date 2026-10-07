/**
 * The work desk — every login's daily tasks (28 Sep 2026).
 *
 * ONE call, `GET /api/dashboard/desk` (B-V2 `services/work_desk.py`): the server
 * decides which tabs this login gets and fills them —
 *   Feedback due · Customer interviews · L1 / L2 interviews · HR interviews ·
 *   Awaiting your call                                 (TA)
 *   Feedback due · Results to review · To screen · Choose route · L1 / L2 to
 *   book · Submit to Sales · … (RMG / GM — the Screening Desk's task board)
 *   Feedback due (HR / Sales: their own rounds)
 *   HR Discussion · HR interviews · Pre-Onboarding · Joining soon · Joined recently ·
 *   Exits & notice                                    (HR — Request HR round / Join in place)
 *   Submit to customer · Customer's response · Customer decision · Submit terms ·
 *   Approve terms / With Sales Head · Budget flags   (Sales — moves made in place,
 *                                                     `SalesDeskActions`)
 *   Upcoming · My queues                              (everyone else)
 *   Approve opportunities · Approve terms             (Admin / CEO ONLY — just their
 *                                                     own decisions, 30 Sep 2026)
 *
 * Two views of that one answer (28 Sep 2026, user ask: "on the Dashboard just
 * show the buttons; clicking one opens the page where the work is done"):
 *   `WorkDesk`     the Dashboard — tiles only, each a link to the tab's `link`
 *                  (RMG / GM categories → the Screening Desk on that task,
 *                  everything else → My Tasks on that tab).
 *   `MyTasksPage`  the `my-tasks` route — the same tiles as a tab strip, and the
 *                  chosen tab's items with their actions. A feedback item opens
 *                  the candidate's interviews in a pop-up (record the verdict in
 *                  place); a "to schedule" item books its round in place
 *                  (`ScheduleRoundLauncher`, + the customer's Sales slots);
 *                  every other item links to the page where it is done.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Armchair, Cake, Plane, UserCog,
  BadgeCheck, BadgeIndianRupee, Building2, CalendarClock, CalendarHeart, CalendarPlus, CheckCircle2,
  ChevronRight, ClipboardCheck, ClipboardList, DoorOpen, ExternalLink, FileClock, FileSpreadsheet, Handshake,
  Hourglass, ListChecks, ListTodo, MessagesSquare, PartyPopper, RefreshCw, ScanSearch, Send, Trophy, UserCheck,
  Receipt, UserSearch, UsersRound, Video, WalletCards, type LucideIcon,
} from "lucide-react";

import { fmtDateTime12 } from "../../../lib/datetime";
import { crmPost } from "../../api";
import { ICON_BTN, STATE_CHIP, type StateTone } from "../../components/controlTower";
import { FLOW_BTN } from "../../components/flowButtons";
import { SalesSlotsButton } from "../../components/CustomerSlots";
import { InterviewRoundsModal } from "../../components/InterviewRoundsModal";
import {
  SalesActionLauncher, SalesItemActions, TermsLine, isSalesTab,
  TERMS_WAITING_PREFIX, type SalesAct, type SalesDeskItem,
} from "../../components/SalesDeskActions";
import { ScheduleRoundLauncher, type ScheduleTarget } from "../../components/ScheduleRoundLauncher";
import { TASK_ACCENT, TASK_ICON } from "../../components/RmgTaskBoard";
import { ErrorBox, useToast } from "../../components/ui";
import type { CustomerSlotOffer } from "../../lib/interviewRounds";
import { CrmLink } from "../../router";
import { useDeskData } from "./DeskWidgets";
import { EMPTY_FILTER, TaskFilterBar, filterItems, groupKeyOf, type GroupBy, type TaskFilter } from "./taskFilters";

type DeskItem = {
  key: string;
  title: string;
  subtitle: string;
  chip: string | null;
  tone: "ok" | "warn" | "bad" | "info";
  when: string | null;
  path: string;
  action: string | null;
  profile_id: number | null;
  /** "To schedule" items: the round the UI books in place (B-V2 `work_desk.SCHEDULE_ROUNDS`). */
  round_kind?: string | null;
  /** TA's "Pending activities" (30 Sep 2026): which list the item came from. */
  activity?: string | null;
  /** The customer's slots Sales passed on — customer rounds only. */
  customer_slots?: CustomerSlotOffer | null;
  candidate_email?: string | null;
  /** HR interviews: the booked round's link and panel. */
  meeting_link?: string | null;
  interviewer?: string | null;
  /** Filter facets (B-V2 `work_desk.fill_facets`): customer · month "YYYY-MM" · project. */
  customer?: string | null;
  month?: string | null;
  project?: string | null;
  employee?: string | null;
} & Partial<Omit<SalesDeskItem, keyof DeskBase>>;
/** The keys every item has — the Sales fields are layered on top. */
type DeskBase = Pick<SalesDeskItem, "key" | "title" | "profile_id" | "path" | "action" | "chip">;
type DeskTab = {
  key: string; label: string; hint: string; count: number; items: DeskItem[];
  icon?: string;
  /** Where the Dashboard tile opens (server-decided). */
  link?: string;
  /** Finance's chain (29 Sep 2026): the tile's place in the flow — "Coming up" ·
   *  "Your move" · "Done" — and whether it is information rather than work. */
  stage?: string;
  info?: boolean;
};
type Desk = { tabs: DeskTab[]; as_of: string };

/** Icon + accent per tab — the server names the tabs, the page dresses them. */
const TAB_LOOK: Record<string, { icon: LucideIcon; accent: string }> = {
  feedback: { icon: ClipboardCheck, accent: "from-amber-500 to-orange-600" },
  // The panel member's own rounds (7 Oct 2026) — open My Interviews.
  panel_feedback: { icon: ClipboardCheck, accent: "from-violet-500 to-purple-700" },
  panel_upcoming: { icon: CalendarClock, accent: "from-sky-500 to-indigo-600" },
  ta_pending: { icon: ListTodo, accent: "from-violet-500 to-fuchsia-600" },
  schedule_customer: { icon: Building2, accent: "from-sky-500 to-blue-600" },
  schedule_internal: { icon: UsersRound, accent: "from-indigo-500 to-violet-600" },
  schedule_hr: { icon: UserCheck, accent: "from-teal-500 to-emerald-600" },
  sourcing: { icon: UserSearch, accent: "from-slate-500 to-slate-700" },
  upcoming: { icon: CalendarClock, accent: "from-emerald-500 to-teal-600" },
  queues: { icon: ListChecks, accent: "from-rose-500 to-pink-600" },
  fin_timesheets: { icon: FileSpreadsheet, accent: "from-sky-500 to-cyan-600" },
  fin_proformas: { icon: FileClock, accent: "from-orange-500 to-amber-600" },
  fin_invoices: { icon: BadgeIndianRupee, accent: "from-emerald-500 to-teal-600" },
  // Customer approval + IRN (6 Oct 2026): Finance's "add the IRN" queue, the
  // Sales Manager / Sales Head's "confirm with customer" queue — both link to the invoice.
  fin_customer_approved: { icon: BadgeCheck, accent: "from-indigo-500 to-blue-600" },
  inv_confirm: { icon: Send, accent: "from-sky-500 to-indigo-600" },
  sales_submit: { icon: Send, accent: "from-sky-500 to-indigo-600" },
  sales_response: { icon: Hourglass, accent: "from-cyan-500 to-sky-600" },
  sales_decide: { icon: Handshake, accent: "from-violet-500 to-fuchsia-600" },
  sales_terms: { icon: Trophy, accent: "from-emerald-500 to-teal-600" },
  sales_approval: { icon: BadgeCheck, accent: "from-indigo-500 to-blue-700" },
  opp_approvals: { icon: Handshake, accent: "from-blue-500 to-indigo-700" },
  sales_waiting: { icon: BadgeCheck, accent: "from-slate-500 to-indigo-600" },
  sales_budget: { icon: WalletCards, accent: "from-rose-500 to-orange-600" },
  sales_timesheets: { icon: FileSpreadsheet, accent: "from-sky-500 to-cyan-600" },
  sales_invoices_pending: { icon: FileClock, accent: "from-amber-500 to-orange-600" },
  sales_proformas: { icon: Receipt, accent: "from-orange-500 to-amber-600" },
  sales_invoices: { icon: BadgeIndianRupee, accent: "from-emerald-500 to-teal-600" },
  sales_collections: { icon: WalletCards, accent: "from-rose-500 to-pink-600" },
  // Sales ladder extras (29 Sep 2026): Sales · Sales Manager (team_*) · Sales Head (head_*).
  renewals: { icon: FileClock, accent: "from-amber-500 to-orange-600" },
  joining_soon: { icon: CalendarHeart, accent: "from-emerald-500 to-teal-600" },
  team_stuck: { icon: Hourglass, accent: "from-rose-500 to-orange-600" },
  team_timesheets: { icon: FileSpreadsheet, accent: "from-sky-500 to-indigo-600" },
  team_collections: { icon: WalletCards, accent: "from-rose-500 to-pink-600" },
  head_pace: { icon: Trophy, accent: "from-indigo-500 to-violet-600" },
  head_stuck: { icon: Hourglass, accent: "from-orange-500 to-rose-600" },
  head_lost: { icon: DoorOpen, accent: "from-slate-500 to-slate-700" },
  head_collections: { icon: BadgeIndianRupee, accent: "from-rose-500 to-pink-600" },
  head_po_renewals: { icon: FileClock, accent: "from-amber-500 to-orange-600" },
  hr_discussion: { icon: MessagesSquare, accent: "from-violet-500 to-purple-600" },
  hr_interviews: { icon: Video, accent: "from-sky-500 to-indigo-600" },
  hr_onboarding: { icon: ClipboardList, accent: "from-amber-500 to-orange-600" },
  hr_joining: { icon: CalendarHeart, accent: "from-emerald-500 to-teal-600" },
  hr_joined: { icon: PartyPopper, accent: "from-teal-500 to-cyan-600" },
  hr_exits: { icon: DoorOpen, accent: "from-rose-500 to-pink-600" },
  hr_leave: { icon: Plane, accent: "from-sky-500 to-indigo-600" },
  hr_records: { icon: UserCog, accent: "from-amber-500 to-orange-600" },
  hr_bench: { icon: Armchair, accent: "from-slate-500 to-slate-700" },
  hr_celebrations: { icon: Cake, accent: "from-pink-500 to-fuchsia-600" },
};
const FALLBACK_LOOK = { icon: ListChecks, accent: "from-slate-500 to-slate-700" };

/** Items in their server order, grouped by `section` (a customer, or a stage of
 *  "Submit to Sales Head"). Items without a section form one unlabelled group. */
export function groupBySection<T extends { section?: string | null; employee?: string | null }>(
  items: T[], groupBy: GroupBy = "section",
): { section: string | null; items: T[] }[] {
  const out: { section: string | null; items: T[] }[] = [];
  const at = new Map<string, number>();
  const sorted = groupBy === "employee"
    ? [...items].sort((a, b) => (groupKeyOf(a, groupBy) || "").localeCompare(groupKeyOf(b, groupBy) || ""))
    : items;
  for (const it of sorted) {
    const label = groupKeyOf(it, groupBy);
    const key = label || "";
    if (!at.has(key)) { at.set(key, out.length); out.push({ section: label || null, items: [] }); }
    out[at.get(key) as number].items.push(it);
  }
  return out;
}

/** RMG / GM tabs are the Screening Desk's task categories — the server names
 *  their icon; the board and this desk share one look. */
function lookOf(t: DeskTab): { icon: LucideIcon; accent: string } {
  if (TAB_LOOK[t.key]) return TAB_LOOK[t.key];
  const icon = t.icon ? TASK_ICON[t.icon] : undefined;
  return { icon: icon ?? FALLBACK_LOOK.icon, accent: TASK_ACCENT[t.key] ?? FALLBACK_LOOK.accent };
}
/** Tabs that belong to the Screening Desk — their presence adds the shortcut. */
const SCREENER_TABS = new Set(["results", "screening", "route", "booking", "decide", "ai_failed", "approvals", "jd", "headcount", "templates"]);
/** Tabs that are information rather than work — never counted as "waiting on you". */
const INFO_TABS = new Set(["queues", "upcoming"]);

const TONE: Record<DeskItem["tone"], StateTone> = { ok: "ok", warn: "warn", bad: "bad", info: "none" };

/** The Dashboard needs the first 50 per tab; My Tasks asks for every item so
 *  its filters work on the whole list (`?full=true`). */
function useWorkDesk(full = false) {
  return useDeskData<Desk>(full ? "/api/dashboard/desk?full=true" : "/api/dashboard/desk");
}

function waitingCount(tabs: DeskTab[]): number {
  return tabs.reduce((n, t) => n + (INFO_TABS.has(t.key) || t.info ? 0 : t.count), 0);
}

/** One tile — the same card on the Dashboard (a link) and on My Tasks (a tab). */
function TileBody({ tab, on }: { tab: DeskTab; on: boolean }) {
  const look = lookOf(tab);
  const Icon = look.icon;
  return (
    <>
      <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${look.accent}`} aria-hidden />
      <span className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-gradient-to-br text-white shadow-raised ${look.accent}`}>
        <Icon className="h-5 w-5" aria-hidden />
        {tab.key === "results" && tab.count > 0 && (
          <span className="absolute -right-1 -top-1 h-3 w-3 animate-ping rounded-full bg-emerald-400 motion-reduce:animate-none" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        {tab.stage && (
          <span className="block text-[10px] font-bold uppercase tracking-wider text-muted">{tab.stage}</span>
        )}
        <span className={`block text-sm font-bold leading-tight ${on ? "text-primary" : "text-secondary"}`}>{tab.label}</span>
        <span className={`mt-1 inline-flex rounded-full px-1.5 text-[11px] font-bold tabular-nums ${
          !tab.count ? STATE_CHIP.ok
            : tab.key === "results" ? "bg-success text-white"
              : tab.info ? "bg-brand-50 text-brand-700 dark:bg-brand-900 dark:text-brand-300"
                : STATE_CHIP.warn}`}>
          {tab.count || (tab.info ? "None" : "All clear")}
        </span>
      </span>
    </>
  );
}

const TILE_BASE =
  "fx-lift relative flex items-center gap-3 overflow-hidden rounded-card border px-3 py-2.5 text-left transition-all duration-micro";
const TILE_GRID = "grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(190px,1fr))]";

/* ================================================================== */
/* Dashboard: tiles only                                              */
/* ================================================================== */

export function WorkDesk() {
  const { data, loading, error, retry } = useWorkDesk();
  const tabs = useMemo(() => data?.tabs ?? [], [data]);

  if (error) return <ErrorBox error={error} onRetry={retry} />;
  if (!data && loading) {
    return <div className="h-32 animate-pulse rounded-card border border-subtle bg-surface-1" aria-hidden />;
  }
  if (!tabs.length) return null;
  const open = waitingCount(tabs);
  const screener = tabs.some((t) => SCREENER_TABS.has(t.key));

  return (
    <section className="rounded-card border border-subtle bg-surface-1 shadow-raised" aria-label="My work">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-display text-base font-bold text-primary">My work today</h2>
          <p className="text-xs text-muted">
            {open ? `${open} task${open === 1 ? "" : "s"} waiting on you` : "Nothing waiting on you right now"}
            {data?.as_of ? ` · as of ${fmtDateTime12(data.as_of)}` : ""}
            {" · click a tile to work on it"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CrmLink to={screener ? "screening-desk" : "my-tasks"} className={FLOW_BTN.primary}
            title="Every pending task, ready to act on">
            {screener ? <ScanSearch size={13} aria-hidden /> : <ListChecks size={13} aria-hidden />}
            {screener ? "Open Screening Desk" : "Open My Tasks"}
          </CrmLink>
          <button type="button" className={ICON_BTN} onClick={retry} aria-label="Refresh" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
          </button>
        </div>
      </header>
      <nav className={`${TILE_GRID} border-t border-subtle px-3 py-3`} aria-label="My work">
        {tabs.map((t) => (
          <CrmLink key={t.key} to={t.link || `my-tasks?tab=${t.key}`} title={t.hint}
            className={`${TILE_BASE} group border-subtle bg-surface-2 hover:border-brand-500 hover:bg-surface-1 hover:shadow-overlay ${t.count ? "" : "opacity-80"}`}>
            <TileBody tab={t} on={t.count > 0} />
            <ChevronRight size={14} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
          </CrmLink>
        ))}
      </nav>
    </section>
  );
}

/* ================================================================== */
/* My Tasks page: the tabs with their items and actions                */
/* ================================================================== */

function readTabParam(): string | null {
  try {
    const t = (new URLSearchParams(window.location.search).get("tab") || "").trim();
    return /^[a-z_]{1,32}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}

function targetOf(it: DeskItem): ScheduleTarget {
  return { profileId: it.profile_id as number, kind: it.round_kind as string,
           candidateName: it.title, candidateEmail: it.candidate_email };
}

export function MyTasksPage() {
  const { data, loading, error, retry } = useWorkDesk(true);
  /* One filter per tab, so switching tabs and back keeps what was chosen. */
  const [filters, setFilters] = useState<Record<string, TaskFilter>>({});
  const [picked, setPicked] = useState<string | null>(readTabParam);
  const [rounds, setRounds] = useState<{ profileId: number; name: string } | null>(null);
  const [booking, setBooking] = useState<ScheduleTarget | null>(null);
  const [salesAct, setSalesAct] = useState<SalesAct | null>(null);
  const [requesting, setRequesting] = useState<number | null>(null);
  /** HR Discussion: ask TA to book the HR round (the profile's "Request HR round from TA"). */
  const requestHrRound = async (profileId: number) => {
    setRequesting(profileId);
    try {
      const res = await crmPost(`/api/candidate-profiles/${profileId}/l2-request`, { round: "HR" });
      showToast(res.message || "HR round requested — TA will book it");
      retry();
    } catch (e: any) {
      showToast(e?.message || "Could not request the HR round", "err");
    } finally {
      setRequesting(null);
    }
  };
  const [toastNode, showToast] = useToast();
  const tabs = useMemo(() => data?.tabs ?? [], [data]);
  /* The linked tab if it exists, else the first one with work in it. */
  const active = tabs.find((t) => t.key === picked) ?? tabs.find((t) => t.count > 0) ?? tabs[0];
  const filter = (active && filters[active.key]) || EMPTY_FILTER;
  const shownItems = useMemo(() => (active ? filterItems(active.items, filter) : []), [active, filter]);

  /* A tile clicked on the Dashboard while this page is open arrives as popstate. */
  useEffect(() => {
    const onPop = () => setPicked(readTabParam());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const pick = (key: string) => {
    setPicked(key);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", key);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch { /* the URL is a convenience */ }
  };

  if (error) return <ErrorBox error={error} onRetry={retry} />;
  const open = waitingCount(tabs);

  return (
    <div className="space-y-4">
      <header className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="bg-gradient-to-r from-brand-700 via-indigo-700 to-violet-700 px-5 py-4 text-white">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-display flex items-center gap-2 text-xl font-bold">
                <ListChecks size={20} aria-hidden /> My Tasks
              </h1>
              <p className="mt-1 text-sm text-white/85">
                {open ? `${open} task${open === 1 ? "" : "s"} waiting on you` : "Nothing waiting on you right now"}
                {data?.as_of ? ` · as of ${fmtDateTime12(data.as_of)}` : ""}
              </p>
            </div>
            <button type="button" onClick={retry} title="Refresh" aria-label="Refresh"
              className="inline-flex h-9 w-9 items-center justify-center rounded-control bg-white/15 hover:bg-white/25">
              <RefreshCw size={16} className={loading ? "animate-spin motion-reduce:animate-none" : ""} />
            </button>
          </div>
        </div>
        {!data && loading ? (
          <div className={`${TILE_GRID} px-3 py-3`} aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[62px] animate-pulse rounded-card bg-surface-2" />)}
          </div>
        ) : (
          <div className={`${TILE_GRID} px-3 py-3`} role="tablist" aria-label="My tasks">
            {tabs.map((t) => {
              const on = active?.key === t.key;
              return (
                <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => pick(t.key)}
                  title={t.hint}
                  className={`${TILE_BASE} ${on ? "border-brand-500 bg-surface-1 shadow-overlay ring-2 ring-brand-500" : "border-subtle bg-surface-2 hover:bg-surface-1"}`}>
                  <TileBody tab={t} on={on} />
                </button>
              );
            })}
          </div>
        )}
      </header>

      {active && (
        <section role="tabpanel" aria-label={active.label} className="rounded-card border border-subtle bg-surface-1 shadow-raised">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-5 py-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-primary">{active.label}</h2>
              <p className="text-xs text-muted">{active.hint}</p>
            </div>
            {SCREENER_TABS.has(active.key) || (active.link || "").startsWith("screening-desk") ? (
              <CrmLink to={active.link || "screening-desk"} className={FLOW_BTN.primary}>
                <ScanSearch size={13} aria-hidden /> Work on these in the Screening Desk
              </CrmLink>
            ) : null}
          </div>
          {active.items.length > 0 && (
            <TaskFilterBar items={active.items} filter={filter} shown={shownItems.length}
              onChange={(f) => setFilters((all) => ({ ...all, [active.key]: f }))} />
          )}
          {active.items.length === 0 ? (
            <p className="flex items-center gap-2 px-5 py-8 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> All clear — nothing here.
            </p>
          ) : shownItems.length === 0 ? (
            <p className="px-5 py-8 text-sm text-muted">
              Nothing matches these filters.{" "}
              <button type="button" className="font-semibold text-brand-700 hover:underline dark:text-brand-300"
                onClick={() => setFilters((all) => ({ ...all, [active.key]: EMPTY_FILTER }))}>Clear filters</button>
            </p>
          ) : (
            <div>
              {groupBySection(shownItems, filter.groupBy).map((g) => (
                <div key={g.section || "_"}>
                  {g.section && (
                    <div className="flex items-center justify-between gap-2 border-y border-subtle bg-surface-2 px-5 py-1.5 first:border-t-0">
                      <span className="text-xs font-bold uppercase tracking-wide text-secondary">{g.section}</span>
                      <span className="rounded-full bg-surface-1 px-2 py-0.5 text-[11px] font-semibold text-muted tnum">{g.items.length}</span>
                    </div>
                  )}
            <ul className="divide-y divide-subtle">
              {g.items.map((it) => (
                <li key={it.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-5 py-2.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-primary">
                      <span className="truncate">{it.title}</span>
                      {it.chip && (
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP[TONE[it.tone]]}`}>{it.chip}</span>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {[it.subtitle, it.when ? fmtDateTime12(it.when) : ""].filter(Boolean).join(" · ")}
                    </div>
                    {(active.key === "sales_approval" || active.key === "sales_waiting"
                      || (active.key === "sales_terms" && (it.section || "").startsWith(TERMS_WAITING_PREFIX)))
                      && <TermsLine offer={it.offer} />}
                    {active.key === "hr_interviews" && it.interviewer && (
                      <div className="mt-0.5 text-xs text-secondary">Panel: {it.interviewer}</div>
                    )}
                    {active.key === "sales_budget" && it.hr_note && (
                      <div className="mt-1 text-xs italic text-secondary">HR: {it.hr_note}</div>
                    )}
                  </div>
                  {active.key === "hr_discussion" && it.profile_id != null && it.action === "Request HR round" ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {/* HR asks TA to book the round, right here (the profile's banner does the same). */}
                      <button type="button" className={FLOW_BTN.primary} disabled={requesting === it.profile_id}
                        onClick={() => void requestHrRound(it.profile_id as number)}>
                        <Send size={13} aria-hidden /> {requesting === it.profile_id ? "Requesting…" : "Request HR round"}
                      </button>
                      {it.path && <CrmLink to={it.path} className={FLOW_BTN.view}>Open</CrmLink>}
                    </span>
                  ) : active.key === "hr_interviews" ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {it.meeting_link && /^https?:\/\//i.test(it.meeting_link) && (
                        <a href={it.meeting_link} target="_blank" rel="noreferrer noopener" className={FLOW_BTN.success}>
                          <ExternalLink size={13} aria-hidden /> Join
                        </a>
                      )}
                      {it.path && <CrmLink to={it.path} className={FLOW_BTN.view}>Open</CrmLink>}
                    </span>
                  ) : isSalesTab(active.key) ? (
                    <SalesItemActions tabKey={active.key} item={it as SalesDeskItem} onAct={setSalesAct} />
                  ) : it.profile_id != null && active.key === "feedback" ? (
                    <span className="flex items-center gap-2">
                      {/* Record the verdict right here, or open the candidate. */}
                      <button type="button" className={FLOW_BTN.warn}
                        onClick={() => setRounds({ profileId: it.profile_id as number, name: it.title })}>
                        <ClipboardCheck size={13} aria-hidden /> {it.action || "Record feedback"}
                      </button>
                      {it.path && <CrmLink to={it.path} className={FLOW_BTN.view}>Open</CrmLink>}
                    </span>
                  ) : it.profile_id != null && it.round_kind ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {/* Book the round right here — the same form as Applied
                          Candidates; the customer's slots are one click away. */}
                      <SalesSlotsButton offer={it.customer_slots} kind={it.round_kind}
                        scheduleLabel={it.action || undefined}
                        onSchedule={() => setBooking(targetOf(it))} />
                      <button type="button" className={FLOW_BTN.primary} onClick={() => setBooking(targetOf(it))}>
                        <CalendarPlus size={13} aria-hidden /> {it.action || "Schedule"}
                      </button>
                      {it.path && <CrmLink to={it.path} className={FLOW_BTN.view}>Open</CrmLink>}
                    </span>
                  ) : it.path ? (
                    <CrmLink to={it.path} className={active.key === "queues" ? FLOW_BTN.view : FLOW_BTN.primary}>
                      {it.action || "Open"}
                    </CrmLink>
                  ) : null}
                </li>
              ))}
            </ul>
                </div>
              ))}
            </div>
          )}
          {active.count > active.items.length && (
            <p className="px-5 pb-3 text-xs text-muted">
              The first {active.items.length} of {active.count} are listed — narrow with the filters, or open the full page.
            </p>
          )}
        </section>
      )}

      {rounds && (
        <InterviewRoundsModal profileId={rounds.profileId} candidateName={rounds.name}
          onClose={() => setRounds(null)} onChanged={(msg) => { if (msg) showToast(msg); retry(); }} />
      )}
      {booking && (
        <ScheduleRoundLauncher target={booking} onClose={() => setBooking(null)} showToast={showToast}
          onDone={(msg) => { setBooking(null); if (msg) showToast(msg); retry(); }} />
      )}
      {salesAct && (
        <SalesActionLauncher act={salesAct} onClose={() => setSalesAct(null)}
          onDone={(msg) => { setSalesAct(null); showToast(msg || "Done"); retry(); }} />
      )}
      {toastNode}
    </div>
  );
}
