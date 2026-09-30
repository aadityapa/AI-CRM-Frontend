/**
 * Interview calendar — a week view over every scheduled interview.
 *
 * The platform books interviews in two unrelated places (AI L1 sessions and
 * manual rounds), and until now nothing could show them together, so nobody
 * could answer "what interviews are happening on Friday". This page is that
 * answer: one grid, colour-coded by type, with the detail of any interview one
 * click away and the ability to schedule straight into an empty slot.
 *
 * Modelled on the Outlook/Teams week view, including the Sunday-first columns.
 *
 * API: GET /api/calendar/interviews?start=&end=&sources=&mine=
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bot, Building2, Calendar as CalendarIcon, CalendarDays, ChevronLeft, ChevronRight, Code2,
  ExternalLink, FileText, HeartHandshake, Link2, Mail, MapPin, Plus, RefreshCw, User, Users,
  Clock3,
  Check,
} from "lucide-react";

import { crmGet, qs } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanAct } from "../useAccess";
import { CrmLink, crmNavigate } from "../routerHooks";
import { ScheduleAiInterviewModal } from "../components/ScheduleAiInterviewModal";
import { Modal, btnPrimary, btnSecondary, inputCls } from "../components/ui";
import { HERO_BTN, HERO_BTN_SOLID, PageHeader } from "../components/PageHeader";

/** Matches the card surface used across the CRM pages. */
const cardCls = "rounded-card border border-subtle bg-surface-1 shadow-raised";
import {
  addDays, formatHour, formatLongDate, formatTime, formatWeekRange, isToday,
  isWeekend, layoutDayEvents, minutesSinceMidnight, parseLocalIso, startOfWeek,
  toDateKey, toDateTimeInput, weekDays,
} from "../lib/calendarDates";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type CalendarSource = "ai_l1" | "manual_round";

type CalendarEvent = {
  id: string;
  source: CalendarSource;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  duration_minutes: number | null;
  raw_when: string | null;
  candidate_id: number | null;
  candidate_name: string | null;
  candidate_email: string | null;
  profile_id: number | null;
  opportunity_id: number | null;
  opportunity_title: string | null;
  opportunity_code: string | null;
  customer_name: string | null;
  kind: string | null;
  round_label: string | null;
  mode: string | null;
  status: string | null;
  result: string | null;
  meeting_link: string | null;
  note: string | null;
  organiser: string | null;
  organiser_user_id: number | null;
  panel: (string | null)[];
  cv_url: string | null;
  detail_path: string | null;
  report_link: string | null;
  can_modify: boolean;
};

type CalendarPayload = {
  range: { start: string; end: string };
  events: CalendarEvent[];
  counts: { total: number; ai_l1: number; manual_round: number };
  undated: CalendarEvent[];
};

/* ------------------------------------------------------------------ */
/* Grid geometry                                                       */
/* ------------------------------------------------------------------ */

/** Pixels per minute. 0.9 gives a 60-minute interview a comfortable 54px. */
const PX_PER_MINUTE = 0.9;
/** Working window. Anything outside still renders — the grid just starts here. */
const DAY_START_HOUR = 8;
const DAY_END_HOUR = 21;
const GUTTER_PX = 64;

const minutesToPx = (m: number) => m * PX_PER_MINUTE;

const SOURCE_STYLE: Record<CalendarSource, { label: string }> = {
  ai_l1: { label: "AI interview" },
  manual_round: { label: "Panel round" },
};

/* ------------------------------------------------------------------ */
/* Interview families — colour by WHO runs the interview               */
/* (29 Sep 2026 redesign; same families as InterviewRoundsModal)       */
/* ------------------------------------------------------------------ */

type FamilyKey = "ai" | "tech" | "customer" | "hr";
type Family = {
  label: string;
  icon: typeof Bot;
  /** the grid block */
  block: string;
  /** a small chip / badge */
  chip: string;
  /** the legend / agenda dot */
  dot: string;
};

const FAMILY: Record<FamilyKey, Family> = {
  ai: {
    label: "AI interview",
    icon: Bot,
    block:
      "border-purple-500 bg-purple-50 text-purple-950 hover:bg-purple-100 " +
      "dark:bg-purple-500/20 dark:text-purple-50 dark:hover:bg-purple-500/30",
    chip: "bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-200",
    dot: "bg-purple-500",
  },
  tech: {
    label: "Technical round",
    icon: Code2,
    block:
      "border-indigo-500 bg-indigo-50 text-indigo-950 hover:bg-indigo-100 " +
      "dark:bg-indigo-500/20 dark:text-indigo-50 dark:hover:bg-indigo-500/30",
    chip: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200",
    dot: "bg-indigo-500",
  },
  customer: {
    label: "Customer round",
    icon: Building2,
    block:
      "border-sky-500 bg-sky-50 text-sky-950 hover:bg-sky-100 " +
      "dark:bg-sky-500/20 dark:text-sky-50 dark:hover:bg-sky-500/30",
    chip: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200",
    dot: "bg-sky-500",
  },
  hr: {
    label: "HR round",
    icon: HeartHandshake,
    block:
      "border-emerald-500 bg-emerald-50 text-emerald-950 hover:bg-emerald-100 " +
      "dark:bg-emerald-500/20 dark:text-emerald-50 dark:hover:bg-emerald-500/30",
    chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
    dot: "bg-emerald-500",
  },
};
const FAMILY_ORDER: FamilyKey[] = ["ai", "tech", "customer", "hr"];

/** Which family an event belongs to — read from the source, the round kind and
 *  the round's label (pure presentation; nothing is filtered by it). */
function familyKeyOf(ev: CalendarEvent): FamilyKey {
  if (ev.source === "ai_l1") return "ai";
  const k = `${ev.kind || ""} ${ev.round_label || ""}`.toLowerCase();
  if (/\bhr\b|hr_/.test(k)) return "hr";
  if (k.includes("customer") || k.includes("client")) return "customer";
  return "tech";
}
const familyOf = (ev: CalendarEvent) => FAMILY[familyKeyOf(ev)];

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("") || "?";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function CalendarPage() {
  const canSchedule = useCanAct("calendar", "edit", useHasRole("TA", "RMG"));

  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [showAi, setShowAi] = useState(true);
  const [showManual, setShowManual] = useState(true);
  const [mine, setMine] = useState(false);

  const [payload, setPayload] = useState<CalendarPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [slot, setSlot] = useState<Date | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  /** The day the Agenda panel lists (presentation only). */
  const [agendaKey, setAgendaKey] = useState<string | null>(null);

  const days = useMemo(() => weekDays(anchor), [anchor]);
  const rangeStart = days[0];
  const rangeEnd = useMemo(() => addDays(days[6], 1), [days]);

  const showToast = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const sourcesParam = useMemo(() => {
    const on: string[] = [];
    if (showAi) on.push("ai_l1");
    if (showManual) on.push("manual_round");
    return on.join(",");
  }, [showAi, showManual]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<CalendarPayload>(
        `/api/calendar/interviews${qs({
          start: toDateKey(rangeStart),
          end: toDateKey(rangeEnd),
          sources: sourcesParam || undefined,
          mine: mine || undefined,
        })}`,
      );
      setPayload(res.data);
    } catch (e: any) {
      setError(e?.message || "Could not load the calendar");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [rangeStart, rangeEnd, sourcesParam, mine]);

  useEffect(() => {
    void load();
  }, [load]);

  // Both filters off would silently show an empty week that looks like "no
  // interviews". Keep at least one on.
  useEffect(() => {
    if (!showAi && !showManual) setShowManual(true);
  }, [showAi, showManual]);

  const events = useMemo(() => payload?.events || [], [payload]);

  /** Events bucketed by day key, so each column only scans its own. */
  const byDay = useMemo(() => {
    const map = new Map<string, { event: CalendarEvent; start: Date }[]>();
    for (const ev of events) {
      const start = parseLocalIso(ev.starts_at);
      if (!start) continue;
      const key = toDateKey(start);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ event: ev, start });
    }
    return map;
  }, [events]);

  const hours = useMemo(
    () => Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i),
    [],
  );
  const gridTopMinutes = DAY_START_HOUR * 60;
  const gridHeight = minutesToPx((DAY_END_HOUR + 1 - DAY_START_HOUR) * 60);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // Open near the start of the working day rather than at midnight.
    if (scrollerRef.current) scrollerRef.current.scrollTop = minutesToPx(60);
  }, []);

  const openSlot = (day: Date, hour: number) => {
    if (!canSchedule) return;
    const when = new Date(day);
    when.setHours(hour, 0, 0, 0);
    setSlot(when);
  };

  /* ---- read-only figures for the header, from the loaded week ---- */
  const todayKey = toDateKey(new Date());
  const todayInWeek = days.some((d) => toDateKey(d) === todayKey);
  const todayCount = byDay.get(todayKey)?.length || 0;
  const familyCounts = useMemo(() => {
    const out: Record<FamilyKey, number> = { ai: 0, tech: 0, customer: 0, hr: 0 };
    for (const ev of events) out[familyKeyOf(ev)] += 1;
    return out;
  }, [events]);
  const busiest = useMemo(() => {
    let best: { day: Date; n: number } | null = null;
    for (const d of days) {
      const n = byDay.get(toDateKey(d))?.length || 0;
      if (n > 0 && (!best || n > best.n)) best = { day: d, n };
    }
    return best;
  }, [days, byDay]);

  /* Agenda day: the one picked, else today when it is in view, else the first
     day of the week that has an interview, else the first day. */
  const agendaDay = useMemo(() => {
    const picked = agendaKey ? days.find((d) => toDateKey(d) === agendaKey) : undefined;
    if (picked) return picked;
    if (todayInWeek) return days.find((d) => toDateKey(d) === todayKey)!;
    return days.find((d) => (byDay.get(toDateKey(d))?.length || 0) > 0) || days[0];
  }, [agendaKey, days, todayInWeek, todayKey, byDay]);
  const agendaItems = useMemo(
    () => [...(byDay.get(toDateKey(agendaDay)) || [])].sort((a, b) => a.start.getTime() - b.start.getTime()),
    [byDay, agendaDay],
  );

  const stats = [
    ...(todayInWeek ? [{ label: "today", value: todayCount }] : []),
    { label: "this week", value: loading && !payload ? "…" : events.length },
    { label: "AI", value: familyCounts.ai },
    { label: "panel rounds", value: events.length - familyCounts.ai },
    ...(payload?.undated?.length ? [{ label: "without a date", value: payload.undated.length }] : []),
    ...(busiest ? [{ label: `busiest · ${busiest.day.toLocaleDateString(undefined, { weekday: "short" })}`, value: busiest.n }] : []),
  ];

  return (
    <div className="space-y-4">
      <Toolbar
        days={days}
        loading={loading}
        counts={payload?.counts}
        stats={stats}
        showAi={showAi}
        showManual={showManual}
        mine={mine}
        canSchedule={canSchedule}
        onToggleAi={() => setShowAi((v) => !v)}
        onToggleManual={() => setShowManual((v) => !v)}
        onToggleMine={() => setMine((v) => !v)}
        onPrev={() => setAnchor((d) => addDays(startOfWeek(d), -7))}
        onNext={() => setAnchor((d) => addDays(startOfWeek(d), 7))}
        onToday={() => setAnchor(new Date())}
        onRefresh={() => void load()}
        onNew={() => {
          const when = new Date();
          when.setMinutes(when.getMinutes() + 60, 0, 0);
          setSlot(when);
        }}
      />

      {error && (
        <div className="rounded-card border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className={`${cardCls} min-w-0 overflow-hidden`}>
          {/* legend — what each colour means */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-subtle px-4 py-2.5">
            {FAMILY_ORDER.map((k) => {
              const f = FAMILY[k];
              return (
                <span key={k} className="inline-flex items-center gap-1.5 text-xs font-semibold text-secondary">
                  <span className={`h-2.5 w-2.5 rounded-full ${f.dot}`} aria-hidden />
                  {f.label}
                  <span className="tnum text-muted">{familyCounts[k]}</span>
                </span>
              );
            })}
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted">
              <span className="h-2 w-2 rounded-full bg-rose-500" aria-hidden /> Now
            </span>
          </div>

          {/* the week — scrolls sideways inside its own box on a phone */}
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              {/* Day headers — click one to list it in the Agenda */}
              <div
                className="grid border-b border-subtle bg-surface-1"
                style={{ gridTemplateColumns: `${GUTTER_PX}px repeat(7, minmax(0, 1fr))` }}
              >
                <div className="border-r border-subtle" />
                {days.map((day) => {
                  const key = toDateKey(day);
                  const n = byDay.get(key)?.length || 0;
                  const today = isToday(day);
                  const picked = toDateKey(agendaDay) === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setAgendaKey(key)}
                      aria-pressed={picked}
                      title={`Show ${formatLongDate(day)} in the agenda`}
                      className={`border-r border-subtle px-2 py-2 text-center transition-colors last:border-r-0 hover:bg-surface-2 ${
                        today ? "bg-sky-50 dark:bg-sky-500/10" : isWeekend(day) ? "bg-surface-2" : ""
                      } ${picked ? "shadow-[inset_0_-3px_0_0_#0284c7]" : ""}`}
                    >
                      <div className={`text-[11px] font-semibold uppercase tracking-wide ${today ? "text-sky-700 dark:text-sky-300" : "text-muted"}`}>
                        {day.toLocaleDateString(undefined, { weekday: "short" })}
                      </div>
                      <div
                        className={`mx-auto mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                          today
                            ? "bg-gradient-to-br from-sky-500 to-brand-600 text-white shadow-raised"
                            : "text-primary"
                        }`}
                      >
                        {day.getDate()}
                      </div>
                      <div className="mt-1 h-4">
                        {n > 0 && (
                          <span className="inline-flex items-center rounded-full bg-surface-2 px-1.5 text-[10px] font-bold text-secondary ring-1 ring-inset ring-slate-200 dark:ring-slate-700">
                            {n} interview{n === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Scrollable time grid */}
              <div ref={scrollerRef} className="max-h-[68vh] overflow-y-auto">
                <div
                  className="relative grid"
                  style={{
                    gridTemplateColumns: `${GUTTER_PX}px repeat(7, minmax(0, 1fr))`,
                    height: gridHeight,
                  }}
                >
                  {/* Hour gutter */}
                  <div className="relative border-r border-subtle bg-surface-1">
                    {hours.map((hour) => (
                      <div
                        key={hour}
                        className="absolute right-2 -translate-y-1/2 text-[11px] font-medium text-muted"
                        style={{ top: minutesToPx(hour * 60 - gridTopMinutes) }}
                      >
                        {formatHour(hour)}
                      </div>
                    ))}
                  </div>

                  {/* Day columns */}
                  {days.map((day) => {
                    const key = toDateKey(day);
                    const dayEvents = byDay.get(key) || [];
                    const positioned = layoutDayEvents(
                      dayEvents,
                      ({ event, start }) => {
                        const startMin = minutesSinceMidnight(start);
                        const end = parseLocalIso(event.ends_at);
                        const endMin = end
                          ? minutesSinceMidnight(end)
                          : startMin + (event.duration_minutes || 60);
                        return { start: startMin, end: Math.max(endMin, startMin + 20) };
                      },
                      20,
                    );

                    return (
                      <div
                        key={key}
                        className={`relative border-r border-subtle last:border-r-0 ${
                          isToday(day)
                            ? "bg-sky-50 dark:bg-sky-500/5"
                            : isWeekend(day) ? "bg-slate-50 dark:bg-white/[0.02]" : ""
                        }`}
                      >
                        {/* Hour lines + click targets for scheduling */}
                        {hours.map((hour) => (
                          <button
                            key={hour}
                            type="button"
                            onClick={() => openSlot(day, hour)}
                            disabled={!canSchedule}
                            aria-label={
                              canSchedule
                                ? `Schedule an interview on ${formatLongDate(day)} at ${formatHour(hour)}`
                                : undefined
                            }
                            className={`absolute inset-x-0 border-t border-subtle ${
                              canSchedule ? "hover:bg-sky-100 dark:hover:bg-sky-500/10" : ""
                            }`}
                            style={{
                              top: minutesToPx(hour * 60 - gridTopMinutes),
                              height: minutesToPx(60),
                            }}
                          />
                        ))}

                        {isToday(day) && <NowLine gridTopMinutes={gridTopMinutes} />}

                        {positioned.map(({ item, top, height, column, columns }) => {
                          const ev = item.event;
                          const fam = familyOf(ev);
                          const FamIcon = fam.icon;
                          const widthPct = 100 / columns;
                          return (
                            <button
                              key={ev.id}
                              type="button"
                              onClick={() => setSelected(ev)}
                              title={`${ev.title}\n${formatTime(item.start)}`}
                              className={`absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm ring-1 ring-inset ring-black/5 transition-colors dark:ring-white/10 ${fam.block}`}
                              style={{
                                top: minutesToPx(top - gridTopMinutes),
                                height: Math.max(minutesToPx(height) - 2, 18),
                                left: `calc(${column * widthPct}% + 2px)`,
                                width: `calc(${widthPct}% - 4px)`,
                              }}
                            >
                              <span className="flex items-center gap-1 font-semibold">
                                <Clock3 size={10} className="shrink-0 opacity-70" />
                                <span className="truncate">{formatTime(item.start)}</span>
                                <FamIcon size={10} className="ml-auto shrink-0 opacity-70" />
                              </span>
                              <span className={`mt-0.5 block truncate font-medium ${height >= 34 ? "pr-5" : ""}`}>
                                Interview: {ev.candidate_name || ev.title}
                              </span>
                              {height >= 52 && ev.round_label && (
                                <span className="block truncate text-[10px] opacity-75">{ev.round_label}</span>
                              )}
                              {height >= 34 && (
                                <span className="absolute bottom-1 right-1.5 grid h-4 w-4 place-items-center rounded-full bg-white/80 text-[8px] font-bold text-slate-700 ring-1 ring-black/10 dark:bg-white/20 dark:text-white">
                                  {initialsOf(ev.candidate_name || ev.title || "?")}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {loading && (
            <div className="flex items-center gap-2 border-t border-subtle px-4 py-2 text-xs text-muted">
              <RefreshCw size={12} className="animate-spin" /> Loading…
            </div>
          )}
          {!loading && events.length === 0 && !error && (
            <div className="border-t border-subtle px-4 py-8 text-center text-sm text-muted">
              <CalendarDays size={26} className="mx-auto mb-2 text-sky-500" aria-hidden />
              No interviews scheduled this week.
              {canSchedule && " Click any time slot to schedule one."}
            </div>
          )}
        </div>

        <AgendaPanel
          day={agendaDay}
          items={agendaItems}
          loading={loading}
          canSchedule={canSchedule}
          onOpen={setSelected}
          onSchedule={() => openSlot(agendaDay, 10)}
        />
      </div>

      {payload?.undated && payload.undated.length > 0 && (
        <UndatedList events={payload.undated} onOpen={setSelected} />
      )}

      <AnimatePresence>
        {selected && (
          <EventDetailModal
            event={selected}
            onClose={() => setSelected(null)}
            onChanged={() => {
              setSelected(null);
              void load();
            }}
            canSchedule={canSchedule}
            showToast={showToast}
          />
        )}
        {slot && (
          <ScheduleIntoSlotModal
            when={slot}
            onClose={() => setSlot(null)}
            onDone={() => {
              setSlot(null);
              void load();
            }}
            showToast={showToast}
          />
        )}
      </AnimatePresence>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-card px-4 py-2.5 text-sm font-semibold shadow-lg ${
            toast.kind === "ok"
              ? "bg-success-soft text-success"
              : "bg-danger-soft text-danger"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toolbar — the page header, week stepper and source filters          */
/* ------------------------------------------------------------------ */

function Toolbar({
  days, loading, counts, stats, showAi, showManual, mine, canSchedule,
  onToggleAi, onToggleManual, onToggleMine, onPrev, onNext, onToday, onRefresh, onNew,
}: {
  days: Date[];
  loading: boolean;
  counts?: CalendarPayload["counts"];
  stats: { label: string; value: React.ReactNode }[];
  showAi: boolean;
  showManual: boolean;
  mine: boolean;
  canSchedule: boolean;
  onToggleAi: () => void;
  onToggleManual: () => void;
  onToggleMine: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onRefresh: () => void;
  onNew: () => void;
}) {
  /* One joined control: ‹ · Today · › */
  const segBtn =
    "inline-flex h-9 items-center justify-center px-2.5 text-sm font-semibold text-secondary " +
    "transition-colors hover:bg-surface-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 " +
    "focus-visible:ring-inset focus-visible:ring-sky-500";
  /* Source filters as toggle pills with a coloured tick. */
  const pill = (on: boolean, tone: string) =>
    `inline-flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-full px-3 text-xs font-semibold ring-1 ring-inset transition-colors ${
      on ? `${tone}` : "bg-surface-1 text-muted ring-slate-200 hover:text-primary dark:ring-slate-700"
    }`;
  const tick = (on: boolean, fill: string) =>
    `grid h-3.5 w-3.5 place-items-center rounded-full text-white ${on ? fill : "bg-slate-300 dark:bg-slate-600"}`;

  return (
    <PageHeader
      icon={CalendarDays}
      accent="ocean"
      eyebrow="Interviews"
      title="Interview calendar"
      subtitle="Every AI L1 session and panel round in one week — click an interview for its details, or an empty slot to schedule."
      stats={stats}
      actions={
        <>
          <button
            type="button"
            className={HERO_BTN}
            onClick={onRefresh}
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          {canSchedule && (
            <button type="button" className={HERO_BTN_SOLID} onClick={onNew}>
              <Plus size={15} /> New interview
            </button>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex overflow-hidden rounded-control border border-subtle bg-surface-1 shadow-raised">
            <button type="button" className={segBtn} onClick={onPrev} aria-label="Previous week">
              <ChevronLeft size={16} />
            </button>
            <button type="button" className={`${segBtn} border-x border-subtle px-3.5`} onClick={onToday}>
              Today
            </button>
            <button type="button" className={segBtn} onClick={onNext} aria-label="Next week">
              <ChevronRight size={16} />
            </button>
          </div>
          <h2 className="font-display text-lg font-bold text-primary">
            {formatWeekRange(days)}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden text-[11px] font-bold uppercase tracking-wide text-muted sm:inline">Show</span>
          <button type="button" role="checkbox" aria-checked={showAi} onClick={onToggleAi}
            className={pill(showAi, "bg-purple-50 text-purple-800 ring-purple-200 dark:bg-purple-500/15 dark:text-purple-200 dark:ring-purple-500/40")}>
            <span className={tick(showAi, "bg-purple-500")}>{showAi && <Check size={9} strokeWidth={3.5} />}</span>
            <Bot size={13} aria-hidden />
            AI{counts ? ` (${counts.ai_l1})` : ""}
          </button>
          <button type="button" role="checkbox" aria-checked={showManual} onClick={onToggleManual}
            className={pill(showManual, "bg-indigo-50 text-indigo-800 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-200 dark:ring-indigo-500/40")}>
            <span className={tick(showManual, "bg-indigo-500")}>{showManual && <Check size={9} strokeWidth={3.5} />}</span>
            <Users size={13} aria-hidden />
            Panel{counts ? ` (${counts.manual_round})` : ""}
          </button>
          <button type="button" role="checkbox" aria-checked={mine} onClick={onToggleMine}
            title="Only interviews you scheduled"
            className={pill(mine, "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/40")}>
            <span className={tick(mine, "bg-emerald-500")}>{mine && <Check size={9} strokeWidth={3.5} />}</span>
            <User size={13} aria-hidden />
            Mine
          </button>
        </div>
      </div>
    </PageHeader>
  );
}

/* ------------------------------------------------------------------ */
/* Agenda — the picked day as a list                                   */
/* ------------------------------------------------------------------ */

function AgendaPanel({
  day, items, loading, canSchedule, onOpen, onSchedule,
}: {
  day: Date;
  items: { event: CalendarEvent; start: Date }[];
  loading: boolean;
  canSchedule: boolean;
  onOpen: (e: CalendarEvent) => void;
  onSchedule: () => void;
}) {
  return (
    <aside className={`${cardCls} flex min-w-0 flex-col self-start overflow-hidden xl:sticky xl:top-4`}>
      <div className="flex items-center gap-3 border-b border-subtle px-4 py-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-card bg-gradient-to-br from-sky-500 to-brand-600 text-white shadow-raised">
          <span className="text-center leading-none">
            <span className="block text-[9px] font-bold uppercase tracking-wider opacity-90">
              {day.toLocaleDateString(undefined, { weekday: "short" })}
            </span>
            <span className="block text-base font-bold">{day.getDate()}</span>
          </span>
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-primary">
            Agenda{isToday(day) ? " · Today" : ""}
          </h2>
          <p className="truncate text-xs text-muted">
            {formatLongDate(day)} · {items.length} interview{items.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <CalendarIcon size={24} className="mx-auto text-slate-300 dark:text-slate-600" aria-hidden />
          <p className="mt-2 text-sm text-muted">
            {loading ? "Loading…" : "Nothing booked on this day."}
          </p>
          {canSchedule && !loading && (
            <button type="button" className={`${btnSecondary} mt-3`} onClick={onSchedule}>
              <Plus size={14} /> Schedule on this day
            </button>
          )}
        </div>
      ) : (
        <ol className="max-h-[60vh] divide-y divide-subtle overflow-y-auto">
          {items.map(({ event: ev, start }) => {
            const fam = familyOf(ev);
            const FamIcon = fam.icon;
            const end = parseLocalIso(ev.ends_at);
            return (
              <li key={ev.id}>
                <button
                  type="button"
                  onClick={() => onOpen(ev)}
                  className="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                >
                  <div className="w-[4.5rem] shrink-0 whitespace-nowrap text-right">
                    <div className="tnum text-[13px] font-bold text-primary">{formatTime(start)}</div>
                    {end && <div className="tnum text-[11px] text-muted">{formatTime(end)}</div>}
                  </div>
                  <span className={`w-1 shrink-0 rounded-full ${fam.dot}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-primary">
                      {ev.candidate_name || ev.title}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${fam.chip}`}>
                        <FamIcon size={10} aria-hidden /> {ev.round_label || SOURCE_STYLE[ev.source].label}
                      </span>
                      {ev.status && <Badge>{ev.status}</Badge>}
                    </div>
                    {(ev.opportunity_title || ev.customer_name) && (
                      <div className="mt-0.5 truncate text-xs text-muted">
                        {[ev.opportunity_title, ev.customer_name].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                  {ev.meeting_link && <Link2 size={13} className="mt-1 shrink-0 text-sky-600 dark:text-sky-300" aria-label="Has a meeting link" />}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Now line                                                            */
/* ------------------------------------------------------------------ */

function NowLine({ gridTopMinutes }: { gridTopMinutes: number }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const top = minutesToPx(minutesSinceMidnight(now) - gridTopMinutes);
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
      style={{ top }}
      aria-hidden
    >
      <span className="h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-rose-500 ring-2 ring-white dark:ring-slate-900" />
      <span className="h-0.5 flex-1 bg-rose-500" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Undated rounds                                                      */
/* ------------------------------------------------------------------ */

function UndatedList({
  events, onOpen,
}: { events: CalendarEvent[]; onOpen: (e: CalendarEvent) => void }) {
  return (
    <div className={cardCls}>
      <div className="flex items-start gap-3 border-b border-subtle px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
          <Clock3 size={15} aria-hidden />
        </span>
        <div>
          <h2 className="text-sm font-bold text-primary">
            Not yet on the calendar
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">{events.length}</span>
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Rounds recorded with a written time but no exact date, so they cannot be placed
            on the grid.
          </p>
        </div>
      </div>
      <ul className="divide-y divide-subtle">
        {events.map((ev) => {
          const fam = familyOf(ev);
          return (
            <li key={ev.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
              <span className={`h-2 w-2 shrink-0 rounded-full ${fam.dot}`} aria-hidden />
              <button
                type="button"
                className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
                onClick={() => onOpen(ev)}
              >
                {ev.candidate_name || ev.title}
              </button>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${fam.chip}`}>
                {ev.round_label || SOURCE_STYLE[ev.source].label}
              </span>
              {ev.raw_when && <span className="text-muted">“{ev.raw_when}”</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Event detail — the Outlook-style meeting card                       */
/* ------------------------------------------------------------------ */

function EventDetailModal({
  event, onClose, onChanged, canSchedule, showToast,
}: {
  event: CalendarEvent;
  onClose: () => void;
  onChanged: () => void;
  canSchedule: boolean;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const [editing, setEditing] = useState(false);
  const start = parseLocalIso(event.starts_at);
  const end = parseLocalIso(event.ends_at);
  const style = { chip: familyOf(event).chip, label: SOURCE_STYLE[event.source].label };
  const FamIcon = familyOf(event).icon;
  const panel = (event.panel || []).filter(Boolean) as string[];

  if (editing && event.source === "ai_l1" && event.profile_id) {
    return (
      <ScheduleAiInterviewModal
        profileId={event.profile_id}
        candidate={{ full_name: event.candidate_name, email: event.candidate_email }}
        existing={{
          id: Number(event.id.split(":")[1]),
          scheduled_at_local: event.starts_at || undefined,
          candidate_name: event.candidate_name,
          candidate_email: event.candidate_email,
        }}
        onClose={() => setEditing(false)}
        onDone={() => {
          setEditing(false);
          onChanged();
        }}
        showToast={showToast}
      />
    );
  }

  return (
    <Modal title={event.title} onClose={onClose} medium>
      <div className="space-y-5 p-1">
        <header className="space-y-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${style.chip}`}>
            <FamIcon size={12} />
            {event.round_label || style.label}
          </span>
          <h2 className="font-display text-xl font-bold text-primary">{event.title}</h2>
          <p className="text-sm text-secondary">
            {start ? (
              <>
                {formatLongDate(start)}
                <span className="mx-1.5 text-muted">·</span>
                {formatTime(start)}
                {end && ` – ${formatTime(end)}`}
              </>
            ) : (
              event.raw_when || "No date set"
            )}
          </p>
        </header>

        <dl className="grid gap-3 sm:grid-cols-2">
          <Detail icon={<User size={14} />} label="Candidate">
            {event.profile_id ? (
              <button
                type="button"
                className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
                onClick={() => {
                  onClose();
                  crmNavigate(`profiles/${event.profile_id}`);
                }}
              >
                {event.candidate_name || "—"}
              </button>
            ) : (
              event.candidate_name || "—"
            )}
            {event.candidate_email && (
              <a
                href={`mailto:${event.candidate_email}`}
                className="mt-0.5 flex items-center gap-1 text-xs text-muted hover:underline"
              >
                <Mail size={11} /> {event.candidate_email}
              </a>
            )}
          </Detail>

          <Detail icon={<MapPin size={14} />} label="Opportunity">
            {event.opportunity_title || "—"}
            {(event.opportunity_code || event.customer_name) && (
              <span className="mt-0.5 block text-xs text-muted">
                {[event.opportunity_code, event.customer_name].filter(Boolean).join(" · ")}
              </span>
            )}
          </Detail>

          {panel.length > 0 && (
            <Detail icon={<Users size={14} />} label="Panel">
              {panel.join(", ")}
            </Detail>
          )}

          {event.organiser && (
            <Detail icon={<CalendarIcon size={14} />} label="Scheduled by">
              {event.organiser}
            </Detail>
          )}

          {(event.status || event.result) && (
            <Detail icon={<CalendarIcon size={14} />} label="Status">
              <span className="flex flex-wrap items-center gap-2">
                {event.status && <Badge>{event.status}</Badge>}
                {event.result && <Badge tone={event.result}>{event.result}</Badge>}
              </span>
            </Detail>
          )}

          {event.mode && (
            <Detail icon={<MapPin size={14} />} label="Mode">
              {event.mode}
            </Detail>
          )}
        </dl>

        {event.note && (
          <div className="rounded-card border border-subtle bg-surface-2 p-3 text-sm text-secondary">
            {event.note}
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t border-subtle pt-4">
          {event.meeting_link && (
            <a
              href={event.meeting_link}
              target="_blank"
              rel="noopener noreferrer"
              className={btnPrimary}
            >
              <Link2 size={15} /> Join
            </a>
          )}
          {event.cv_url && (
            <a href={event.cv_url} target="_blank" rel="noopener noreferrer" className={btnSecondary}>
              <FileText size={15} /> CV
            </a>
          )}
          {event.report_link && (
            <a href={event.report_link} target="_blank" rel="noopener noreferrer" className={btnSecondary}>
              <ExternalLink size={15} /> Full report
            </a>
          )}
          {event.detail_path && (
            <CrmLink to={event.detail_path} className={btnSecondary}>
              Open profile
            </CrmLink>
          )}
          {canSchedule && event.source === "ai_l1" && event.can_modify && (
            <button type="button" className={btnSecondary} onClick={() => setEditing(true)}>
              Reschedule
            </button>
          )}
          {canSchedule && event.source === "ai_l1" && !event.can_modify && (
            <span className="self-center text-xs text-muted">
              The candidate has already started this session, so it cannot be moved.
            </span>
          )}
          {event.source === "manual_round" && event.detail_path && (
            <span className="self-center text-xs text-muted">
              Edit panel rounds from the candidate's Interviews tab.
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Detail({
  icon, label, children,
}: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
        {icon} {label}
      </dt>
      <dd className="mt-1 text-sm text-primary">{children}</dd>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: string }) {
  const t = String(tone || "").toLowerCase();
  const cls =
    t.includes("pass") || t.includes("select")
      ? "bg-success-soft text-success"
      : t.includes("fail") || t.includes("reject")
        ? "bg-danger-soft text-danger"
        : t.includes("hold") || t.includes("pending")
          ? "bg-warning-soft text-warning"
          : "bg-surface-2 text-secondary";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>
  );
}

/* ------------------------------------------------------------------ */
/* Schedule into a clicked slot                                        */
/* ------------------------------------------------------------------ */

type ProfileOption = {
  id: number;
  candidate_name: string | null;
  candidate_email?: string | null;
  opportunity_title?: string | null;
  customer_name?: string | null;
};

/**
 * Two-step: pick the candidate profile, then open the real scheduling modal
 * with the clicked date/time already filled in.
 *
 * The AI scheduling endpoints are profile-scoped, so a profile has to be chosen
 * before anything can be booked — there is no "schedule for nobody" state.
 */
function ScheduleIntoSlotModal({
  when, onClose, onDone, showToast,
}: {
  when: Date;
  onClose: () => void;
  onDone: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<ProfileOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<ProfileOption | null>(null);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setBusy(true);
      setError("");
      try {
        const res = await crmGet<ProfileOption[]>(
          `/api/candidate-profiles${qs({ search: term, limit: 20 })}`,
        );
        if (!cancelled) setOptions(res.data || []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Search failed");
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [search]);

  if (chosen) {
    return (
      <ScheduleAiInterviewModal
        profileId={chosen.id}
        candidate={{ full_name: chosen.candidate_name, email: chosen.candidate_email }}
        initialWhen={toDateTimeInput(when)}
        onClose={onClose}
        onDone={onDone}
        showToast={showToast}
      />
    );
  }

  return (
    <Modal title="Schedule an interview" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-card border border-subtle bg-surface-2 px-3 py-2 text-sm">
          <span className="text-muted">Slot: </span>
          <span className="font-semibold text-primary">
            {formatLongDate(when)} at {formatTime(when)}
          </span>
        </div>

        <div>
          <label className="text-xs font-bold uppercase tracking-wide text-muted">
            Candidate
          </label>
          <input
            autoFocus
            className={`${inputCls} mt-1.5`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email or phone…"
          />
          <p className="mt-1 text-xs text-muted">
            Interviews are scheduled against a candidate's application, so pick the
            opportunity they applied to.
          </p>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        {busy && <p className="text-sm text-muted">Searching…</p>}

        {options.length > 0 && (
          <ul className="max-h-72 divide-y divide-subtle overflow-y-auto rounded-card border border-subtle">
            {options.map((opt) => (
              <li key={opt.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                  onClick={() => setChosen(opt)}
                >
                  <span className="block text-sm font-semibold text-primary">
                    {opt.candidate_name || `Profile #${opt.id}`}
                  </span>
                  <span className="block text-xs text-muted">
                    {[opt.opportunity_title, opt.customer_name].filter(Boolean).join(" · ") ||
                      "No opportunity linked"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!busy && search.trim().length >= 2 && options.length === 0 && !error && (
          <p className="text-sm text-muted">No matching applications.</p>
        )}

        <div className="flex justify-end">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
