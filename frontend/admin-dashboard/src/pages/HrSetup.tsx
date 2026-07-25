/**
 * HR Setup — React rebuild of the interview scheduler (was vanilla index.html).
 * Restyled on the KARNEX design-system tokens (rounded-control/card, the four
 * elevation levels, 150ms micro / 250ms panel motion, brand/neutral/semantic
 * ramps). Wired to the real endpoints: /job/configs, /hr/candidates/suggest,
 * /hr/schedules, /hr/schedule-interview. Motion respects
 * prefers-reduced-motion throughout. ONE dominant primary action: Schedule.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle, CalendarClock, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  Clock, Copy, Globe, Mail, Plus, Search, Sparkles, User, X, Zap, Loader2,
} from "lucide-react";
import { apiGet } from "../api/client";
import { getAuthToken } from "../lib/authSession";
import { btnSecondary, focusRing } from "../crm/components/ui";

/* ----------------------------------------------------------------- types */
type JobTemplate = {
  jobId: string;
  jobTitle: string;
  domain?: string;
  requiredSkills?: string[];
  optionalSkills?: string[];
  expMin?: number;
  expMax?: number;
  customerName?: string;
};
type CandidateSuggest = { name?: string; full_name?: string; email?: string };
type Schedule = { scheduled_at_local?: string; candidate_name?: string; candidate_email?: string; status?: string };
type ScheduleResult = {
  candidate_name: string;
  candidate_email: string;
  scheduled_at_local: string;
  invite_url: string;
  access_key: string;
  email_sent: boolean;
  smtp_configured: boolean;
  email_error?: string;
};

/* ------------------------------------------------------------- utilities */
const TIMEZONES = [
  "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London",
  "Europe/Berlin", "America/New_York", "America/Chicago", "America/Los_Angeles", "UTC",
];
const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DOW_FULL = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const QUICK_TIMES = ["10:00", "11:30", "14:00", "16:00"];

/* Motion tokens mirrored for framer-motion (150ms micro / 250ms panel,
 * single --ease-out decel curve — springs are retired). */
const EASE_OUT: [number, number, number, number] = [0.2, 0, 0, 1];

/* Shared section-card recipe (rounded-card + raised elevation). */
const sectionCls = "rounded-card border border-subtle bg-surface-1 p-6 shadow-raised";
const labelCls = "block text-xs font-medium uppercase tracking-wide text-muted";

/* THE one primary action on this page. Local recipe (solid brand trio,
 * 150ms color micro-motion) instead of the shared `btnPrimary`, whose
 * `.btn-depth` hover rule washes the brand background neutral. */
const btnPrimaryCls = `inline-flex items-center gap-2 rounded-control bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-micro ease-smooth hover:bg-brand-700 active:bg-brand-800 disabled:pointer-events-none disabled:opacity-50 ${focusRing}`;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** "14:30" -> "02:30 pm" (mirrors the en-GB 2-digit hour12 style used in the header). */
const fmtTime12 = (t: string) => {
  const [hRaw, mRaw] = t.split(":");
  const h = Number(hRaw), m = Number(mRaw);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return t;
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ampm}`;
};
const startOfWeek = (d: Date) => { const c = new Date(d); c.setDate(c.getDate() - c.getDay()); c.setHours(0, 0, 0, 0); return c; };
const addDays = (d: Date, n: number) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };

async function formPost(path: string, fields: Record<string, string | number>) {
  const body = new URLSearchParams();
  Object.entries(fields).forEach(([k, v]) => body.set(k, String(v ?? "")));
  const res = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${getAuthToken()}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok || (data && typeof data === "object" && data.error)) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

/* ================================================================= page */
export function HrSetupPage() {
  const reduce = useReducedMotion();
  /* Legacy name kept for the shared layout transitions — now the single
   * 150ms micro tween on the token ease curve (springs retired). */
  const spring = reduce ? { duration: 0 } : { duration: 0.15, ease: EASE_OUT };

  const [templates, setTemplates] = useState<JobTemplate[]>([]);
  const [jobId, setJobId] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [flash, setFlash] = useState<"name" | "email" | "">("");

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(false);
  const [genKey, setGenKey] = useState(0); // bump to re-run the profile synthesis (Retry)
  const [skills, setSkills] = useState<string[]>([]);
  const [newSkill, setNewSkill] = useState("");
  const [editOpen, setEditOpen] = useState(false);

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [monthCursor, setMonthCursor] = useState<Date>(() => new Date());
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [zoneOpen, setZoneOpen] = useState(false);
  const [slotTime, setSlotTime] = useState("10:00");

  const [scheduling, setScheduling] = useState(false);
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [scheduleErr, setScheduleErr] = useState("");
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const template = templates.find((t) => t.jobId === jobId);

  /* --- data --- */
  useEffect(() => {
    apiGet<{ jobs: JobTemplate[] }>("/job/configs", { force: true })
      .then((d) => setTemplates(Array.isArray(d.jobs) ? d.jobs : []))
      .catch(() => {});
    apiGet<{ schedules: Schedule[] }>("/hr/schedules", { force: true })
      .then((d) => setSchedules(Array.isArray(d.schedules) ? d.schedules : []))
      .catch(() => {});
  }, []);

  /* --- "generate" assessment profile when a template is selected --- */
  useEffect(() => {
    if (!template) { setSkills([]); setGenError(false); setGenerating(false); return; }
    let cancelled = false;
    setGenerating(true);
    setGenError(false);
    const t = window.setTimeout(() => {
      if (cancelled) return;
      const req = (template.requiredSkills || []).filter(Boolean);
      const opt = (template.optionalSkills || []).filter(Boolean);
      setSkills(Array.from(new Set([...req, ...opt])));
      setGenerating(false);
    }, reduce ? 0 : 700);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [jobId, reduce, genKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeSkill = (s: string) => setSkills((prev) => prev.filter((x) => x !== s));
  const addSkill = () => {
    const s = newSkill.trim();
    if (s && !skills.includes(s)) setSkills((p) => [...p, s]);
    setNewSkill("");
  };

  /* --- slot counts per day from real schedules --- */
  const slotsByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of schedules) {
      const raw = String(s.scheduled_at_local || "").slice(0, 10);
      if (raw) map.set(raw, (map.get(raw) || 0) + 1);
    }
    return map;
  }, [schedules]);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const shiftWeek = (dir: number) => setWeekStart((w) => addDays(w, dir * 7));
  const pickDate = (d: Date) => {
    setSelectedDate(d);
    setWeekStart(startOfWeek(d));
    setMonthCursor(new Date(d.getFullYear(), d.getMonth(), 1));
  };

  /* --- header shows the currently selected interview slot (date + time) in the chosen zone --- */
  const zoneLabel = useMemo(() => timezone.split("/").pop()?.replace(/_/g, " ") || timezone, [timezone]);
  const headerTime = useMemo(() => {
    try {
      const fmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      return `${fmt.format(selectedDate)}, ${fmtTime12(slotTime)} · ${zoneLabel}`;
    } catch { return `${selectedDate.toDateString()}, ${fmtTime12(slotTime)} · ${zoneLabel}`; }
  }, [selectedDate, slotTime, zoneLabel]);

  /* --- schedule --- */
  const validateEmail = (v: string) => /^\S+@\S+\.\S+$/.test(v.trim());
  const submit = async () => {
    if (!validateEmail(email)) { setEmailErr("Enter a valid email address"); return; }
    if (!jobId) { setToast({ msg: "Select a job template first", kind: "err" }); return; }
    setScheduling(true);
    setScheduleErr("");
    setResult(null);
    try {
      const candidateName = fullName.trim() || email.split("@")[0];
      const candidateEmail = email.trim();
      const scheduled = `${ymd(selectedDate)}T${slotTime || "10:00"}`;
      const data = await formPost("/hr/schedule-interview", {
        candidate_name: candidateName,
        candidate_email: candidateEmail,
        scheduled_at_local: scheduled,
        jobId,
        final_skills: skills.join(","),
      });
      setResult({
        candidate_name: String(data?.schedule?.candidate_name || candidateName),
        candidate_email: String(data?.schedule?.candidate_email || candidateEmail),
        scheduled_at_local: String(data?.schedule?.scheduled_at_local || scheduled),
        invite_url: String(data?.invite_url || ""),
        access_key: String(data?.access_key || data?.schedule?.access_key || ""),
        email_sent: !!data?.email_sent,
        smtp_configured: data?.smtp_configured !== false,
        email_error: data?.email_error ? String(data.email_error) : undefined,
      });
      setToast({ msg: "Interview scheduled — invite sent", kind: "ok" });
      apiGet<{ schedules: Schedule[] }>("/hr/schedules", { force: true })
        .then((d) => setSchedules(Array.isArray(d.schedules) ? d.schedules : [])).catch(() => {});
    } catch (e: any) {
      const msg = e?.message || "Failed to schedule";
      setScheduleErr(msg);
      setToast({ msg, kind: "err" });
    } finally {
      setScheduling(false);
    }
  };

  const onPickCandidate = (c: CandidateSuggest) => {
    const nm = c.full_name || c.name || "";
    if (nm) setFullName(nm);
    if (c.email) { setEmail(c.email); setEmailErr(""); }
    setFlash(c.email ? "email" : "name");
    window.setTimeout(() => setFlash(""), 700);
  };

  const enter = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-8 sm:px-6 lg:px-8">
      <motion.div {...enter} transition={{ duration: reduce ? 0.15 : 0.25, ease: EASE_OUT }}>
        <h1 className="text-display text-2xl font-bold tracking-tight text-primary">HR Setup</h1>
        <p className="mt-1 text-sm text-muted">Empowering modern hiring with Artificial Intelligence.</p>
      </motion.div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* CARD 1 — Candidate sourcing */}
        <motion.section {...enter} transition={reduce ? { duration: 0.15 } : { duration: 0.25, ease: EASE_OUT, delay: 0.06 }}
          className={sectionCls}>
          <CardHead icon={<Search className="h-5 w-5" />} title="AI-Assisted Candidate Sourcing" description="Pick a job template and find the candidate to invite for this AI interview." />
          <label className={`mt-6 ${labelCls}`}>Select from job role template</label>
          <TemplateCombobox templates={templates} value={jobId} onChange={setJobId} spring={spring} reduce={!!reduce} />

          <div className="mt-6 grid gap-4">
            <FloatingField label="Full name" flash={flash === "name"}>
              <CandidateInput value={fullName} onChange={setFullName} placeholder="Type to search candidate…" onPick={onPickCandidate} reduce={!!reduce} leadingIcon={<User className="h-4 w-4" />} />
            </FloatingField>
            <FloatingField label="Email address" required error={emailErr} flash={flash === "email"}>
              <CandidateInput
                value={email}
                onChange={(v) => { setEmail(v); if (emailErr) setEmailErr(""); }}
                onBlur={() => setEmailErr(email && !validateEmail(email) ? "Enter a valid email address" : "")}
                valid={!!email && validateEmail(email)}
                error={!!emailErr}
                placeholder="Type email or select candidate…"
                onPick={onPickCandidate}
                reduce={!!reduce}
                byEmail
                leadingIcon={<Mail className="h-4 w-4" />}
              />
            </FloatingField>
          </div>
        </motion.section>

        {/* CARD 2 — Orchestration & skills. Calm raised card at rest; the
            .ai-generating border animates ONLY while the profile synthesis runs. */}
        <motion.section {...enter} transition={reduce ? { duration: 0.15 } : { duration: 0.25, ease: EASE_OUT, delay: 0.12 }}
          className={generating ? "rounded-card p-6 ai-generating" : sectionCls}>
          <CardHead icon={<Zap className="h-5 w-5" />} title="Interview Orchestration & Skills Synthesis" description="AI synthesizes the assessment profile from the template — refine the skills before scheduling." />
          <div className="mt-6">
            {!template ? (
              <EmptyProfile />
            ) : generating ? (
              <ProfileSkeleton />
            ) : genError ? (
              <div className="flex flex-col items-center gap-3 rounded-card border border-subtle bg-danger-soft p-6 text-center">
                <AlertTriangle className="h-6 w-6 text-danger" />
                <p className="text-sm text-danger">Could not generate the assessment profile.</p>
                <button className={btnSecondary} onClick={() => setGenKey((k) => k + 1)}>Retry</button>
              </div>
            ) : (
              <div>
                <div className={`mb-2 ${labelCls}`}>AI-generated assessment profile</div>
                <div className="mb-3 text-sm font-semibold text-primary">{template.jobTitle}{template.customerName ? ` · ${template.customerName}` : ""}</div>
                <motion.div layout className="flex flex-wrap gap-2">
                  <AnimatePresence mode="popLayout">
                    {skills.map((s) => (
                      <motion.span key={s} layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={spring}
                        className="inline-flex items-center gap-1.5 rounded-full border border-subtle bg-surface-2 px-3 py-1 text-xs font-semibold text-primary">
                        {s}
                        <button aria-label={`Remove ${s}`} onClick={() => removeSkill(s)}
                          className={`rounded-full p-0.5 text-muted transition-colors duration-micro ease-smooth hover:bg-surface-1 hover:text-primary ${focusRing}`}>
                          <X className="h-3 w-3" />
                        </button>
                      </motion.span>
                    ))}
                  </AnimatePresence>
                  {skills.length === 0 && <span className="text-sm text-muted">No skills — add some below.</span>}
                </motion.div>

                <button
                  className={`mt-3 rounded-control text-sm font-semibold text-brand-600 transition-colors duration-micro ease-smooth hover:text-brand-700 hover:underline dark:text-brand-300 dark:hover:text-brand-200 ${focusRing}`}
                  onClick={() => setEditOpen((o) => !o)} aria-expanded={editOpen}>
                  Edit assessment criteria and skills set manually
                </button>
                <AnimatePresence initial={false}>
                  {editOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={reduce ? { duration: 0 } : { duration: 0.25, ease: EASE_OUT }} className="overflow-hidden">
                      <div className="mt-3 flex gap-2">
                        <input className="input-recessed flex-1 rounded-control px-3 py-2 text-sm text-primary placeholder:text-muted" value={newSkill} onChange={(e) => setNewSkill(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSkill()} placeholder="Add a skill and press Enter" />
                        <button className={btnSecondary} onClick={addSkill}><Plus className="h-4 w-4" /> Add</button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </motion.section>
      </div>

      {/* CARD 3 — slot allocation */}
      <motion.section {...enter} transition={reduce ? { duration: 0.15 } : { duration: 0.25, ease: EASE_OUT, delay: 0.18 }}
        className={`mt-6 ${sectionCls}`}>
        <CardHead icon={<CalendarClock className="h-5 w-5" />} title="Interview Slot Allocation" description="Choose the date, time, and zone for the candidate's interview slot." />
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-card border border-subtle bg-surface-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-brand-500" />
            <div>
              <AnimatePresence mode="wait">
                <motion.div key={headerTime} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }} className="text-base font-bold tabular-nums text-brand-600 dark:text-brand-300">
                  {headerTime}
                </motion.div>
              </AnimatePresence>
              <div className="text-xs text-muted">Proposed interview window based on recruiter availability.</div>
            </div>
          </div>
          <div className="flex min-h-12 flex-wrap items-center gap-2">
            <label htmlFor="hr-slot-time" className={labelCls}>Time</label>
            <input
              id="hr-slot-time"
              type="time"
              value={slotTime}
              onChange={(e) => e.target.value && setSlotTime(e.target.value)}
              className="input-recessed h-10 rounded-control px-3 text-sm font-semibold tabular-nums text-primary"
              aria-label="Interview time"
            />
            <div className="flex items-center gap-2" role="group" aria-label="Quick time picks">
              {QUICK_TIMES.map((t) => {
                const on = slotTime === t;
                return (
                  <button key={t} type="button" onClick={() => setSlotTime(t)} aria-pressed={on}
                    className={`inline-flex h-10 items-center rounded-control px-3 text-sm font-semibold tabular-nums transition-colors duration-micro ease-smooth ${focusRing} ${on
                      ? "bg-brand-600 text-white"
                      : "btn-depth text-secondary hover:text-primary"}`}>
                    {t}
                  </button>
                );
              })}
            </div>
            <button className="btn-depth inline-flex h-10 items-center gap-2 rounded-control px-3 text-sm font-semibold text-primary" onClick={() => setZoneOpen(true)}>
              <Globe className="h-4 w-4" /> Change Zone
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* week strip */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className={labelCls}>
                {MONTHS[weekStart.getMonth()].slice(0, 3)} {weekStart.getDate()} – {addDays(weekStart, 6).getDate()}, {weekStart.getFullYear()}
              </span>
              <div className="flex gap-1">
                <IconBtn onClick={() => shiftWeek(-1)} label="Previous week"><ChevronLeft className="h-4 w-4" /></IconBtn>
                <IconBtn onClick={() => shiftWeek(1)} label="Next week"><ChevronRight className="h-4 w-4" /></IconBtn>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {weekDays.map((d) => {
                const count = slotsByDay.get(ymd(d)) || 0;
                const active = ymd(d) === ymd(selectedDate);
                const isToday = ymd(d) === ymd(new Date());
                return (
                  <motion.button key={ymd(d)} onClick={() => pickDate(d)} whileHover={reduce ? undefined : { y: -2 }} transition={spring}
                    className={`relative isolate flex flex-col items-center rounded-card border px-2 py-3 text-center transition-colors duration-micro ease-smooth ${focusRing} ${active
                      ? "border-transparent bg-brand-600 text-white"
                      : isToday
                        ? "border-transparent bg-surface-1 text-primary ring-2 ring-inset ring-brand-500 hover:bg-surface-2"
                        : "border-subtle bg-surface-1 text-primary hover:bg-surface-2"}`}
                    aria-pressed={active} aria-current={isToday ? "date" : undefined}>
                    {active && <motion.span layoutId="hr-day-active" className="absolute inset-0 -z-10 rounded-card bg-brand-600 shadow-raised" transition={spring} />}
                    <span className="text-xs font-semibold uppercase tracking-wide opacity-80">{DOW_FULL[d.getDay()]}</span>
                    <span className="text-lg font-bold">{d.getDate()}</span>
                    <span className={`mt-0.5 text-xs font-semibold ${count ? (active ? "opacity-90" : "text-brand-600 dark:text-brand-300") : "opacity-60"}`}>
                      {count ? `${count} Slot${count > 1 ? "s" : ""}` : "Add slots"}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </div>

          {/* mini calendar */}
          <MiniCalendar cursor={monthCursor} setCursor={setMonthCursor} selected={selectedDate} onPick={pickDate} slotsByDay={slotsByDay} spring={spring} reduce={!!reduce} />
        </div>

        {/* Footer — the schedule CTA is the ONE dominant primary action on this page */}
        <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
          <AnimatePresence>
            {scheduleErr && (
              <motion.span initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: EASE_OUT }}
                className="rounded-control border border-subtle bg-danger-soft px-3 py-1.5 text-xs font-semibold text-danger" role="alert">
                {scheduleErr}
              </motion.span>
            )}
          </AnimatePresence>
          <span className="text-xs tabular-nums text-muted">Selected: {selectedDate.toDateString()}, {fmtTime12(slotTime)}</span>
          <button disabled={scheduling} onClick={submit} className={btnPrimaryCls}>
            {scheduling ? <><Loader2 className="h-4 w-4 animate-spin" /> Scheduling…</> : <><Sparkles className="h-4 w-4" /> Schedule interview</>}
          </button>
        </div>
      </motion.section>

      {/* Invite details — shown after a successful schedule until dismissed */}
      <AnimatePresence>
        {result && <InviteSummary result={result} onClose={() => setResult(null)} reduce={!!reduce} />}
      </AnimatePresence>

      {/* Change Zone modal */}
      <AnimatePresence>
        {zoneOpen && <ZoneModal value={timezone} onClose={() => setZoneOpen(false)} onPick={(z) => { setTimezone(z); setZoneOpen(false); }} reduce={!!reduce} />}
      </AnimatePresence>

      {/* toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            onAnimationComplete={() => window.setTimeout(() => setToast(null), 3000)}
            className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-card border border-subtle bg-surface-3 px-4 py-2.5 text-sm font-semibold text-primary shadow-overlay" role="status">
            {toast.kind === "ok" ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-danger" />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------- sub-components */
/* Section header in the shared "New Opportunity wizard" banner language, using
 * this page's own tokens: a gradient icon tile (fx-glow) + title + description.
 * Structure mirrors the CRM SectionHeaderBanner; visual-only. */
function CardHead({ icon, title, description }: { icon: React.ReactNode; title: string; description?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="fx-glow flex h-11 w-11 shrink-0 items-center justify-center rounded-card bg-gradient-to-br from-brand-600 to-violet-600 text-white">{icon}</span>
      <div className="min-w-0">
        <h2 className="text-base font-bold text-primary">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
    </div>
  );
}

/* Standalone gradient banner (dialogs) — same visual language as CardHead. */
function SectionBanner({ icon, title, description }: { icon: React.ReactNode; title: string; description?: string }) {
  return (
    <header className="relative mb-4 overflow-hidden rounded-card border border-subtle bg-surface-1 px-4 py-4">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand-500/15 via-transparent to-violet-500/10" />
      <div aria-hidden className="pointer-events-none absolute -right-8 -top-12 h-40 w-40 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="relative z-[1] flex items-start gap-3">
        <span className="fx-glow flex h-11 w-11 shrink-0 items-center justify-center rounded-card bg-gradient-to-br from-brand-600 to-violet-600 text-white">{icon}</span>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-primary">{title}</h3>
          {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
        </div>
      </div>
    </header>
  );
}

function IconBtn({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} aria-label={label} className={`btn-depth inline-flex h-8 w-8 items-center justify-center rounded-control text-muted hover:text-primary ${focusRing}`}>
      {children}
    </button>
  );
}

function FloatingField({ label, required, error, flash, children }: { label: string; required?: boolean; error?: string; flash?: boolean; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <div>
      <label className={`mb-1 ${labelCls}`}>
        {label}{required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {/* Autofill flash: brief brand focus-halo via token ring (parent clears
          `flash` after ~700ms; the ring fades on the 150ms micro transition). */}
      <div className={`rounded-control transition-shadow duration-micro ease-smooth ${flash ? "ring-2 ring-brand-500 ring-offset-2 ring-offset-surface-1" : ""}`}>
        {children}
      </div>
      <AnimatePresence>
        {error && (
          <motion.div initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease: EASE_OUT }} className="mt-1 text-xs font-semibold text-danger" role="alert">
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CandidateInput({ value, onChange, onBlur, onPick, placeholder, valid, error, reduce, byEmail, leadingIcon }: {
  value: string; onChange: (v: string) => void; onBlur?: () => void; onPick: (c: CandidateSuggest) => void;
  placeholder?: string; valid?: boolean; error?: boolean; reduce: boolean; byEmail?: boolean; leadingIcon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CandidateSuggest[]>([]);
  const [loading, setLoading] = useState(false);
  const tRef = useRef<number | null>(null);

  useEffect(() => {
    if (tRef.current) window.clearTimeout(tRef.current);
    if (!value || value.length < 2) { setRows([]); return; }
    tRef.current = window.setTimeout(() => {
      setLoading(true);
      apiGet<{ candidates: CandidateSuggest[] }>(`/hr/candidates/suggest?q=${encodeURIComponent(value)}&limit=8`, { force: true })
        .then((d) => { setRows(Array.isArray(d.candidates) ? d.candidates : []); setOpen(true); })
        .catch(() => setRows([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => { if (tRef.current) window.clearTimeout(tRef.current); };
  }, [value]);

  return (
    <div className="relative">
      {leadingIcon ? (
        <span className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-muted">{leadingIcon}</span>
      ) : null}
      <input
        className={`input-recessed w-full rounded-control py-2 text-sm text-primary placeholder:text-muted ${leadingIcon ? "pl-9 pr-3" : "px-3"} ${error ? "input-error" : valid ? "border-success" : ""}`}
        value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => rows.length && setOpen(true)}
        onBlur={() => { window.setTimeout(() => setOpen(false), 150); onBlur?.(); }}
        aria-autocomplete="list"
      />
      {valid && <Check className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-success" />}
      <AnimatePresence>
        {open && (loading || rows.length > 0) && (
          <motion.ul initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease: EASE_OUT }}
            className="elev-2 absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-card py-1" role="listbox">
            {loading && <li className="px-3 py-2 text-xs text-muted">Searching…</li>}
            {!loading && rows.length === 0 && <li className="px-3 py-2 text-xs text-muted">No matches</li>}
            {rows.map((c, i) => (
              <li key={i} role="option" aria-selected={false}>
                <button className={`block w-full px-3 py-2 text-left transition-colors duration-micro ease-smooth hover:bg-surface-2 ${focusRing}`} onMouseDown={(e) => { e.preventDefault(); onPick(c); setOpen(false); }}>
                  <div className="text-sm font-semibold text-primary">{c.full_name || c.name || c.email}</div>
                  {c.email && <div className="truncate text-xs text-muted">{c.email}</div>}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function TemplateCombobox({ templates, value, onChange, spring, reduce }: { templates: JobTemplate[]; value: string; onChange: (v: string) => void; spring: any; reduce: boolean }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const selected = templates.find((t) => t.jobId === value);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { setOpen(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(templates.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const t = templates[active]; if (t) { onChange(t.jobId); setOpen(false); } }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div ref={ref} className="relative mt-1.5">
      <button type="button" id="hr-template-trigger" onClick={() => setOpen((o) => !o)} onKeyDown={onKey} aria-haspopup="listbox" aria-expanded={open}
        className="input-recessed flex w-full items-center justify-between rounded-control px-3 py-2 text-left text-sm text-primary">
        <span className={selected ? "" : "text-muted"}>{selected ? selected.jobTitle : "Select a template…"}</span>
        <ChevronDown className={`h-4 w-4 text-muted transition-transform duration-micro ease-smooth ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring}
            className="elev-2 absolute z-40 mt-1 max-h-64 w-full overflow-auto rounded-card py-1" role="listbox">
            {templates.length === 0 && <li className="px-3 py-2 text-xs text-muted">No templates yet</li>}
            {templates.map((t, i) => (
              <li key={t.jobId} role="option" aria-selected={t.jobId === value}>
                <button className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors duration-micro ease-smooth hover:bg-surface-2 ${i === active ? "bg-surface-2" : ""}`}
                  onMouseEnter={() => setActive(i)} onClick={() => { onChange(t.jobId); setOpen(false); }}>
                  <span className="text-primary">{t.jobTitle}</span>
                  {t.jobId === value && <Check className="h-4 w-4 text-brand-500" />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function EmptyProfile() {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed border-subtle p-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-card bg-brand-50 text-brand-600 dark:bg-brand-900 dark:text-brand-300"><Sparkles className="h-6 w-6" /></span>
      <div className="text-sm font-semibold text-primary">AI-generated assessment profile</div>
      <p className="max-w-xs text-sm text-muted">Select a job template and the AI synthesizes the skills and criteria for this interview.</p>
      <button
        type="button"
        onClick={() => document.getElementById("hr-template-trigger")?.focus()}
        className={btnSecondary}>
        <Search className="h-4 w-4" /> Choose a template
      </button>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="min-h-44 space-y-3" aria-busy>
      <div className="shimmer h-4 w-1/3 rounded-control" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="shimmer h-7 w-24 rounded-full" />)}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating assessment profile…</div>
    </div>
  );
}

function MiniCalendar({ cursor, setCursor, selected, onPick, slotsByDay, spring, reduce }: {
  cursor: Date; setCursor: (d: Date) => void; selected: Date; onPick: (d: Date) => void; slotsByDay: Map<string, number>; spring: any; reduce: boolean;
}) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));

  return (
    <div className="rounded-card border border-subtle bg-surface-1 p-3">
      <div className="mb-2 flex items-center justify-between">
        <IconBtn onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} label="Previous month"><ChevronLeft className="h-4 w-4" /></IconBtn>
        <AnimatePresence mode="wait">
          <motion.span key={`${cursor.getFullYear()}-${cursor.getMonth()}`} initial={reduce ? { opacity: 0 } : { opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease: EASE_OUT }}
            className="text-sm font-semibold uppercase tracking-wide text-primary">{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</motion.span>
        </AnimatePresence>
        <IconBtn onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} label="Next month"><ChevronRight className="h-4 w-4" /></IconBtn>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {DOW.map((d) => <div key={d} className="py-1 text-xs font-semibold text-muted">{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`p${i}`} />;
          const active = ymd(d) === ymd(selected);
          const isToday = ymd(d) === ymd(new Date());
          const has = (slotsByDay.get(ymd(d)) || 0) > 0;
          const cls = active
            ? `bg-brand-600 text-white${isToday ? " ring-2 ring-brand-300 ring-offset-2 ring-offset-surface-1" : ""}`
            : isToday
              ? "font-bold text-brand-600 ring-2 ring-inset ring-brand-500 hover:bg-surface-2 dark:text-brand-300"
              : "text-primary hover:bg-surface-2";
          return (
            <button key={ymd(d)} onClick={() => onPick(d)} aria-pressed={active} aria-current={isToday ? "date" : undefined}
              className={`relative isolate mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-micro ease-smooth ${focusRing} ${cls}`}>
              {active && <motion.span layoutId="hr-mini-active" className="absolute inset-0 -z-10 rounded-full bg-brand-600" transition={spring} />}
              {d.getDate()}
              {has && !active && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-brand-500" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch { return false; }
  }
}

function CopyBtn({ text, label, solid }: { text: string; label: string; solid?: boolean }) {
  const [copied, setCopied] = useState(false);
  const tRef = useRef<number | null>(null);
  useEffect(() => () => { if (tRef.current) window.clearTimeout(tRef.current); }, []);
  const onCopy = async () => {
    const ok = await copyToClipboard(text);
    if (!ok) return;
    setCopied(true);
    if (tRef.current) window.clearTimeout(tRef.current);
    tRef.current = window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button type="button" onClick={onCopy} aria-label={label}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-control px-2.5 py-1.5 text-xs font-semibold transition-colors duration-micro ease-smooth ${focusRing} ${solid
        ? "bg-success-soft text-success ring-1 ring-inset ring-subtle hover:bg-surface-2"
        : "border border-subtle bg-surface-1 text-success hover:border-strong hover:bg-surface-2"}`}>
      {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> {label}</>}
    </button>
  );
}

function InviteSummary({ result, onClose, reduce }: { result: ScheduleResult; onClose: () => void; reduce: boolean }) {
  const allDetails = `Hi ${result.candidate_name}, your AI interview is scheduled for ${result.scheduled_at_local}. Join: ${result.invite_url} | Access key: ${result.access_key}`;
  return (
    <motion.section
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      transition={{ duration: reduce ? 0.15 : 0.25, ease: EASE_OUT }}
      className="mt-6 rounded-card border border-subtle bg-surface-1 p-6 shadow-raised"
      aria-live="polite" aria-label="Interview invite details">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-control bg-success-soft text-success"><CheckCircle2 className="h-5 w-5" /></span>
          <div>
            <h2 className="text-base font-bold text-primary">Interview scheduled</h2>
            <p className="text-xs text-muted">Share these details with the candidate.</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Dismiss invite details" className={`rounded-control p-1 text-muted transition-colors duration-micro ease-smooth hover:bg-surface-2 hover:text-primary ${focusRing}`}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-control border border-subtle bg-surface-2 px-3 py-2.5">
          <div className={labelCls}>Candidate</div>
          <div className="mt-0.5 text-sm font-semibold text-primary">{result.candidate_name}</div>
          <div className="truncate text-xs text-muted">{result.candidate_email}</div>
        </div>
        <div className="rounded-control border border-subtle bg-surface-2 px-3 py-2.5">
          <div className={labelCls}>Date &amp; time</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold tabular-nums text-primary"><Clock className="h-3.5 w-3.5 text-success" /> {result.scheduled_at_local}</div>
        </div>
      </div>

      {result.invite_url && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-control border border-subtle bg-surface-2 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className={labelCls}>Interview link</div>
            <div className="truncate font-mono text-xs text-brand-600 dark:text-brand-300">{result.invite_url}</div>
          </div>
          <CopyBtn text={result.invite_url} label="Copy link" />
        </div>
      )}

      {result.access_key && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-control border border-subtle bg-surface-2 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className={labelCls}>Access key</div>
            <span className="mt-0.5 inline-flex items-center rounded-control bg-success-soft px-2 py-0.5 font-mono text-sm font-bold tracking-wider text-success">{result.access_key}</span>
          </div>
          <CopyBtn text={result.access_key} label="Copy key" />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        {result.email_sent ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success">
            <Mail className="h-3.5 w-3.5" /> Invite emailed to {result.candidate_email}
          </span>
        ) : !result.smtp_configured ? (
          <span className="inline-flex items-center gap-1.5 rounded-control border border-subtle bg-warning-soft px-2.5 py-1.5 text-xs font-semibold text-warning">
            <AlertTriangle className="h-3.5 w-3.5" /> Email is disabled — share the link &amp; access key manually
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-control border border-subtle bg-warning-soft px-2.5 py-1.5 text-xs font-semibold text-warning">
            <AlertTriangle className="h-3.5 w-3.5" /> {result.email_error ? `Email failed: ${result.email_error}` : "Email not sent — share the details manually"}
          </span>
        )}
        <CopyBtn text={allDetails} label="Copy all details" solid />
      </div>
    </motion.section>
  );
}

function ZoneModal({ value, onClose, onPick, reduce }: { value: string; onClose: () => void; onPick: (z: string) => void; reduce: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal aria-label="Choose timezone">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease: EASE_OUT }} className="absolute inset-0 bg-backdrop" onClick={onClose} />
      <motion.div initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
        transition={{ duration: reduce ? 0.15 : 0.25, ease: EASE_OUT }}
        className="relative w-full max-w-sm rounded-modal border border-subtle bg-surface-3 p-4 shadow-modal">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <SectionBanner icon={<Globe className="h-5 w-5" />} title="Select time zone" description="Interview times are shown and scheduled in this zone." />
          </div>
          <button onClick={onClose} aria-label="Close" className={`mt-1 shrink-0 rounded-control p-1 text-muted transition-colors duration-micro ease-smooth hover:bg-surface-2 hover:text-primary ${focusRing}`}><X className="h-5 w-5" /></button>
        </div>
        <ul className="max-h-72 space-y-1 overflow-auto">
          {TIMEZONES.map((z) => (
            <li key={z}>
              <button onClick={() => onPick(z)} className={`flex min-h-12 w-full items-center justify-between rounded-control px-3 py-2 text-left text-sm transition-colors duration-micro ease-smooth hover:bg-surface-2 ${focusRing} ${z === value ? "font-bold text-brand-600 dark:text-brand-300" : "text-primary"}`}>
                {z.replace(/_/g, " ")}{z === value && <Check className="h-4 w-4" />}
              </button>
            </li>
          ))}
        </ul>
      </motion.div>
    </div>
  );
}
