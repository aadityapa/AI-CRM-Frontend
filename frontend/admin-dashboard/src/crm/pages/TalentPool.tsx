/** Talent Pool — Phase 1 (16 Oct 2026); Phases 2–3 + retention (17 Oct 2026,
 *  pages/talentPool/TalentPoolExtras.tsx). Server half: B-V2 services/talent_pool.py.
 *
 *  Every candidate we have ever had, searched by skill, so a new position starts
 *  from people we already know. Two modes:
 *    • Search the pool — must-have / nice-to-have skills (from the skill browser
 *      or typed freely), experience, location, notice, expected CTC,
 *      availability, "untouched for N days", proven-in-interview only.
 *    • Match a position — the Suggested Candidates engine for one live position,
 *      dressed with the pool's evidence; TA ticks people and applies them.
 *  Every skill chip says HOW we know it: proven in interview › found by the ATS
 *  in a CV › read from a CV › on the record. The page writes nothing itself —
 *  applying reuses the candidate page's multi-apply.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Award, Briefcase, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, FileText, Filter, FolderPlus, LayoutGrid, List, MapPin,
  CalendarClock, Clock, Copy, Layers, Mail, MessageSquare, Phone, Plus, RotateCcw, Search, Send, Shuffle, Sparkles,
  Target, UserCheck, Users, X,
} from "lucide-react";

import { crmGet, qs } from "../api";
import { useSubTabs } from "../useAccess";
import { CrmLink } from "../router";
import { Spinner, ErrorBox, useToast, isOwnDomClick } from "../components/ui";
import { PageHeader, StagePills, HERO_BTN } from "../components/PageHeader";
import { CONTROL } from "../components/controlTower";
import { FLOW_BTN } from "../components/flowButtons";
import { ScoreIndicator } from "../components/ScoreIndicator";
import { initials } from "../components/dialogKit";
import { usePageTab, useSessionState, useChangeEffect } from "../lib/pageState";
import { DupesMode, FreshMode, ReadyMode, ReengageDialog } from "./talentPool/TalentPoolMore";
import { isPlaceholderEmail } from "../lib/candidateEmail";
import { fmtDateShort } from "../../lib/datetime";
import { fileViewHref } from "./FileView";
import {
  PoolOptOutButton, RetentionMode, SavedSearchesBar, SkillNamesModal, paramsToFilters, type SavedSearch,
} from "./talentPool/TalentPoolExtras";
import {
  AddToGroupDialog, ApplyPeopleDialog, FitApplyDialog, GroupsMode, TagSkillDialog, TalentGroupChips,
  useCanApplyFromPool, type GroupChipData, type GroupSkill,
} from "./talentPool/TalentGroups";

// ---------------------------------------------------------------------------
// Types (mirror the server payload)
// ---------------------------------------------------------------------------

export type Evidence = "interview" | "ats" | "cv" | "profile" | "employee" | "interview_low";

export type PoolSkill = { name: string; key: string; evidence: Evidence[]; best: Evidence | null; rating: number | null };
export type PoolMatch = { skill: string; required: boolean; best: Evidence | null; evidence: Evidence[]; rating: number | null; proven: boolean };
type HistoryItem = {
  profile_id: number; opportunity_id: number; opp_id: string; opportunity_title: string;
  customer_name: string | null; pipeline_status: string; stage_label: string; outcome: string; applied_on: string | null;
};
export type PoolRow = {
  kind: "candidate" | "employee";
  key: string;
  candidate_id: number | null;
  employee_id: number | null;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  preferred_locations: string | null;
  experience_years: number | null;
  notice_period: string | null;
  current_ctc: number | null;
  expected_ctc: number | null;
  technical_domain: string | null;
  cv_url: string | null;
  matched: PoolMatch[];
  missing_nice: string[];
  skills: PoolSkill[];
  skills_total: number;
  score: number | null;
  proven: number;
  availability: "available" | "in_process" | "bench" | "deployed";
  availability_label: string;
  internal: { employee_id: number; employee_code: string | null; deployment: string; projects: { project: string; customer: string | null }[] } | null;
  applications: { count: number; joined: number; rejected: number; live: number; recent: HistoryItem[] } | null;
  last_note: { note: string; channel: string; outcome: string | null; at: string | null; by: string | null } | null;
  notes_count?: number;
  last_touch: string | null;
  strengths?: { area: string; detail: string }[];
  gaps?: { area: string; detail: string }[];
  /** Talent Pool groups the candidate is in (24 Nov 2026). */
  groups?: GroupChipData[];
  /** When the candidate came into the tool, by whom; notice details. */
  added_at?: string | null;
  added_by?: string | null;
  last_working_day?: string | null;
  serving_notice?: boolean;
  notice_bucket?: string | null;
};
type SkillCat = { id: number | null; name: string; category: string; count: number; proven: number };
type Position = {
  requirement_id: number; req_number: string; title: string; customer_name: string | null;
  opp_id: string; opportunity_title: string;
};
type Meta = {
  skills: SkillCat[]; positions: Position[]; proven_rating: number;
  index?: { ready: boolean; built_at: string | null };
  retention?: { months: number; warn_days: number; counts: Record<string, number> };
  added_days?: number[];
  added_counts?: Record<string, number>;
};
type SearchMeta = {
  total: number; page: number; limit: number; truncated: boolean;
  availability_counts: Record<string, number>; holders: Record<string, number>;
  synonyms?: Record<string, string[]>;
  index?: { used: boolean; live_candidates: number | null };
};
type PositionMeta = {
  basis: { req_number: string | null; requirement_title: string | null; jd_source: string | null;
           jd_keywords: string[]; mandatory_skills: string[]; optional_skills: string[];
           experience_band: { min: number; max: number } | null } | null;
  requirement: { id: number; req_number: string; title: string; opportunity_id: number };
  total: number;
};

// ---------------------------------------------------------------------------
// Pure helpers (pinned by TalentPool.test.ts)
// ---------------------------------------------------------------------------

/** How each kind of evidence looks — strongest first. */
export const EVIDENCE_LOOK: Record<Evidence, { label: string; short: string; chip: string; rank: number }> = {
  interview: { label: "Proven in interview", short: "Interview", rank: 6,
    chip: "bg-emerald-600 text-white ring-emerald-600" },
  ats: { label: "Found by the ATS in a CV", short: "ATS", rank: 5,
    chip: "bg-sky-50 text-sky-800 ring-sky-300 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-700" },
  cv: { label: "Read from a CV", short: "CV", rank: 4,
    chip: "bg-indigo-50 text-indigo-800 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:ring-indigo-800" },
  profile: { label: "On the candidate record", short: "Record", rank: 3,
    chip: "bg-surface-2 text-secondary ring-subtle" },
  employee: { label: "On the employee record", short: "Employee", rank: 3,
    chip: "bg-teal-50 text-teal-800 ring-teal-200 dark:bg-teal-950/40 dark:text-teal-200 dark:ring-teal-800" },
  interview_low: { label: "Tested in interview, rated low", short: "Tested low", rank: 1,
    chip: "bg-amber-50 text-amber-800 ring-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-700" },
};

export const AVAILABILITY_LOOK: Record<PoolRow["availability"], string> = {
  available: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800",
  in_process: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800",
  bench: "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:ring-teal-800",
  deployed: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:ring-slate-700",
};

/** Rupees → "₹8.5 L". */
export function lakh(v: number | null | undefined): string | null {
  if (v === null || v === undefined || !Number.isFinite(Number(v)) || Number(v) <= 0) return null;
  const l = Number(v) / 100000;
  return `₹${l >= 10 ? Math.round(l) : Math.round(l * 10) / 10} L`;
}

export type PoolFilters = {
  skills: string[];
  nice: string[];
  q: string;
  exp_min: string;
  exp_max: string;
  location: string;
  notice: string;
  ctc_max: string;
  availability: string;
  untouched_days: string;
  proven_only: boolean;
  include_employees: boolean;
  sort: string;
  /** Job-board filters (24 Nov 2026): expected CTC from, current CTC range (lakh),
   *  added to the tool in the last N days, has a mobile number. */
  ctc_min: string;
  cur_ctc_min: string;
  cur_ctc_max: string;
  added_days: string;
  has_phone: boolean;
};

export const EMPTY_FILTERS: PoolFilters = {
  skills: [], nice: [], q: "", exp_min: "", exp_max: "", location: "", notice: "", ctc_max: "",
  availability: "any", untouched_days: "", proven_only: false, include_employees: true, sort: "match",
  ctc_min: "", cur_ctc_min: "", cur_ctc_max: "", added_days: "", has_phone: false,
};

/** A filter value saved in the session before a key existed gets the blank. */
export function withFilterDefaults(f: Partial<PoolFilters> | null | undefined): PoolFilters {
  return { ...EMPTY_FILTERS, ...(f || {}) } as PoolFilters;
}

/** "Added in" choices (the server's ADDED_DAYS). */
export const ADDED_CHOICES = [7, 15, 30, 60, 90, 180];

/** Same key the server compares skills by. */
export function skillKey(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Add a skill to one list, taking it out of the other (a skill is either must or nice). */
export function addSkill(f: PoolFilters, name: string, kind: "must" | "nice"): PoolFilters {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean) return f;
  const k = skillKey(clean);
  const skills = f.skills.filter((s) => skillKey(s) !== k);
  const nice = f.nice.filter((s) => skillKey(s) !== k);
  return kind === "must" ? { ...f, skills: [...skills, clean].slice(0, 12), nice }
    : { ...f, skills, nice: [...nice, clean].slice(0, 12) };
}

/** The filters → the search query (blank fields left out). */
export function poolQuery(f: PoolFilters, page: number, limit = 24): string {
  return qs({
    skills: f.skills.join(",") || undefined,
    nice: f.nice.join(",") || undefined,
    q: f.q.trim() || undefined,
    exp_min: f.exp_min || undefined,
    exp_max: f.exp_max || undefined,
    location: f.location.trim() || undefined,
    notice: f.notice || undefined,
    ctc_max: f.ctc_max || undefined,
    ctc_min: f.ctc_min || undefined,
    cur_ctc_min: f.cur_ctc_min || undefined,
    cur_ctc_max: f.cur_ctc_max || undefined,
    added_days: f.added_days || undefined,
    has_phone: f.has_phone ? "true" : undefined,
    availability: f.availability !== "any" ? f.availability : undefined,
    untouched_days: f.untouched_days || undefined,
    proven_only: f.proven_only ? "true" : undefined,
    include_employees: f.include_employees ? undefined : "false",
    sort: f.sort !== "match" ? f.sort : undefined,
    page,
    limit,
  });
}

/** How many filters (besides the skills) narrow the search — the "Filters (n)" badge. */
export function activeFilterCount(f: PoolFilters): number {
  return [f.q.trim(), f.exp_min, f.exp_max, f.location.trim(), f.notice, f.ctc_max, f.untouched_days,
    f.ctc_min, f.cur_ctc_min, f.cur_ctc_max, f.added_days]
    .filter(Boolean).length
    + (f.availability !== "any" ? 1 : 0) + (f.proven_only ? 1 : 0) + (f.include_employees ? 0 : 1)
    + (f.has_phone ? 1 : 0);
}

/** Skill browser: categories in order, skills filtered by the search box. */
export function groupCatalogue(skills: SkillCat[], search: string): { category: string; skills: SkillCat[] }[] {
  const s = search.trim().toLowerCase();
  const byCat = new Map<string, SkillCat[]>();
  for (const sk of skills) {
    if (s && !sk.name.toLowerCase().includes(s)) continue;
    const list = byCat.get(sk.category) || [];
    list.push(sk);
    byCat.set(sk.category, list);
  }
  return [...byCat.entries()]
    .sort((a, b) => (a[0] === "Other" ? 1 : b[0] === "Other" ? -1 : a[0].localeCompare(b[0])))
    .map(([category, list]) => ({ category, skills: list }));
}

function daysAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const d = Math.floor((Date.now() - t) / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 60) return `${d} d ago`;
  return fmtDateShort(iso);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const PAGE_SIZE = 24;
const MODES = [
  { key: "search", label: "Search the pool" },
  { key: "ready", label: "Ready to place" },
  { key: "position", label: "Match a position" },
  { key: "groups", label: "Groups" },
  { key: "retention", label: "Retention" },
  { key: "fresh", label: "Keep up to date" },
  { key: "dupes", label: "Duplicates" },
] as const;
type Mode = (typeof MODES)[number]["key"];

export function TalentPoolPage() {
  const [toast, showToast] = useToast();
  const [rawMode, setMode] = usePageTab<Mode>("tab", "search", ["search", "ready", "position", "groups", "retention", "fresh", "dupes"]);
  const [openGroup, setOpenGroup] = useSessionState<number | null>("talent.group", null);
  const [seed, setSeed] = useState<{ skills: string[]; nice: string[]; n: number } | null>(null);
  const openGroupPage = (id: number) => { setOpenGroup(id); setMode("groups"); };
  const findMore = (skills: GroupSkill[]) => {
    setSeed({ skills: skills.filter((x) => x.must).map((x) => x.name), nice: skills.filter((x) => !x.must).map((x) => x.name), n: Date.now() });
    setMode("search");
  };
  // The three modes are sub-tabs a template / custom role can switch off (22 Oct 2026).
  const poolSub = useSubTabs("talent-pool");
  const shownModes = MODES.filter((m) => poolSub.allowed(m.key));
  const mode: Mode = shownModes.some((m) => m.key === rawMode) ? rawMode : (shownModes[0]?.key || "search");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaErr, setMetaErr] = useState("");
  const [names, setNames] = useState(false);
  const skillNames = useMemo(() => (meta?.skills || []).map((x) => x.name), [meta]);

  const loadMeta = useCallback(() => {
    setMetaErr("");
    crmGet<Meta>("/api/talent-pool/meta").then((r) => setMeta(r.data)).catch((e) => setMetaErr(e?.message || "Could not load the pool"));
  }, []);
  useEffect(() => { loadMeta(); }, [loadMeta]);

  return (
    <div className="space-y-4">
      {toast}
      <PageHeader
        icon={Sparkles}
        accent="teal"
        eyebrow="Recruitment"
        title="Talent Pool"
        subtitle="Every candidate we have ever had, searched by skill. Skills proven in an interview rank above skills only on a CV."
        actions={<>
          <button type="button" className={HERO_BTN} onClick={() => setNames(true)} title="Skill names that mean the same, and the skill index">
            <Shuffle size={14} aria-hidden /> Skill names
          </button>
          <button type="button" className={HERO_BTN} onClick={loadMeta}><RotateCcw size={14} aria-hidden /> Refresh</button>
        </>}
      >
        <StagePills tabs={shownModes.map((m) => ({ key: m.key, label: m.key === "retention" && meta?.retention?.counts?.expiring
          ? `${m.label} · ${meta.retention.counts.expiring} leaving` : m.label }))}
          active={mode} onChange={(k) => setMode(k as Mode)} label="Talent Pool mode" />
      </PageHeader>
      {metaErr && <ErrorBox error={metaErr} onRetry={loadMeta} />}
      {(mode === "search" || mode === "position") && <EvidenceLegend />}
      {mode === "search" ? <SearchMode meta={meta} toast={showToast} seed={seed} onOpenGroup={openGroupPage} skillNames={skillNames} />
        : mode === "position" ? <PositionMode meta={meta} toast={showToast} onOpenGroup={openGroupPage} skillNames={skillNames} />
          : mode === "groups" ? <>
            <SkillGroups meta={meta} onPick={(name) => { setSeed({ skills: [name], nice: [], n: Date.now() }); setMode("search"); }} />
            <GroupsMode toast={showToast} openId={openGroup} onOpen={setOpenGroup} onFindMore={findMore} skillSuggestions={skillNames} />
          </>
            : mode === "ready" ? <ReadyMode toast={showToast} positions={meta?.positions || []} />
              : mode === "fresh" ? <FreshMode toast={showToast} />
                : mode === "dupes" ? <DupesMode toast={showToast} />
                  : <RetentionMode toast={showToast} />}
      {names && <SkillNamesModal onClose={() => { setNames(false); loadMeta(); }} toast={showToast} />}
    </div>
  );
}

/** Skill groups — the pool grouped by skill family, built from the live skill
 *  counts (nothing stored). A skill opens the search with it as a must-have. */
export function skillGroups(skills: SkillCat[], perGroup = 8): { category: string; total: number; proven: number; skills: SkillCat[] }[] {
  const byCat = new Map<string, SkillCat[]>();
  for (const sk of skills) {
    if (!sk.count) continue;
    const list = byCat.get(sk.category || "Other") || [];
    list.push(sk);
    byCat.set(sk.category || "Other", list);
  }
  return [...byCat.entries()].map(([category, list]) => {
    const sorted = [...list].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return { category, total: list.reduce((n, x) => n + x.count, 0), proven: list.reduce((n, x) => n + (x.proven || 0), 0),
      skills: sorted.slice(0, perGroup) };
  }).sort((a, b) => b.total - a.total);
}

const SKILL_GROUP_TONES = [
  "from-teal-500 to-emerald-600", "from-sky-500 to-indigo-600", "from-purple-500 to-fuchsia-600",
  "from-amber-500 to-orange-600", "from-rose-500 to-pink-600", "from-cyan-500 to-blue-600",
];

function SkillGroups({ meta, onPick }: { meta: Meta | null; onPick: (skill: string) => void }) {
  const groups = useMemo(() => skillGroups(meta?.skills || []), [meta]);
  const [all, setAll] = useState(false);
  if (!groups.length) return null;
  const shown = all ? groups : groups.slice(0, 6);
  return (
    <section className="rounded-card border border-subtle bg-surface-1 p-3 shadow-raised">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-primary"><Layers size={15} aria-hidden /> Skill groups</h2>
          <p className="text-xs text-muted">The pool grouped by skill family, counted live. Click a skill to see everyone who has it — proven in interview first.</p>
        </div>
        {groups.length > 6 && (
          <button type="button" className={FLOW_BTN.neutral} onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `All ${groups.length} groups`}</button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((g, i) => (
          <div key={g.category} className="rounded-control border border-subtle bg-surface-2/50 p-2.5">
            <div className="flex items-center gap-2">
              <span className={`inline-flex h-7 w-7 items-center justify-center rounded-control bg-gradient-to-br text-white ${SKILL_GROUP_TONES[i % SKILL_GROUP_TONES.length]}`}>
                <Layers size={14} aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-primary">{g.category}</div>
                <div className="text-[11px] text-muted">{g.skills.length} top skills · {g.proven} proven in interview</div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {g.skills.map((sk) => (
                <button key={`${sk.id}-${sk.name}`} type="button" onClick={() => onPick(sk.name)}
                  className="inline-flex items-center gap-1 rounded-full bg-surface-1 px-2 py-0.5 text-[11px] font-semibold text-secondary ring-1 ring-inset ring-subtle hover:text-brand-700 hover:ring-brand-300 dark:hover:text-brand-300">
                  {sk.name}<span className="tabular-nums text-muted">{sk.count}</span>
                  {sk.proven > 0 && <Award size={10} className="text-emerald-600" aria-label={`${sk.proven} proven`} />}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function EvidenceLegend() {
  const order: Evidence[] = ["interview", "ats", "cv", "profile", "employee", "interview_low"];
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
      <span className="mr-1 font-semibold text-secondary">How we know a skill:</span>
      {order.map((ev) => (
        <span key={ev} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ${EVIDENCE_LOOK[ev].chip}`}>
          {ev === "interview" && <Award size={11} aria-hidden />}
          {EVIDENCE_LOOK[ev].label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search mode
// ---------------------------------------------------------------------------

function SearchMode({ meta, toast, seed, onOpenGroup, skillNames }: {
  meta: Meta | null; toast: (m: string, k?: "ok" | "err") => void;
  /** Skills handed over from a group's "Find more like this". */
  seed?: { skills: string[]; nice: string[]; n: number } | null;
  onOpenGroup: (id: number) => void;
  skillNames: string[];
}) {
  const [storedFilters, setFilters] = useSessionState<PoolFilters>("talent.filters", EMPTY_FILTERS);
  const filters = useMemo(() => withFilterDefaults(storedFilters), [storedFilters]);
  const [page, setPage] = useSessionState<number>("talent.page", 1);
  const [rows, setRows] = useState<PoolRow[]>([]);
  const [smeta, setSmeta] = useState<SearchMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showFilters, setShowFilters] = useState(() => !!(storedFilters?.untouched_days || storedFilters?.proven_only
    || storedFilters?.include_employees === false));
  const [draftQ, setDraftQ] = useState(filters.q);
  const [draftLoc, setDraftLoc] = useState(filters.location);
  const [saved, setSaved] = useState<SavedSearch | null>(null);
  const [picked, setPicked] = useState<Map<number, string>>(new Map());
  const [bulk, setBulk] = useState<"group" | "apply" | "mail" | null>(null);
  const canApply = useCanApplyFromPool();
  const [view, setView] = usePoolView();
  const seq = useRef(0);
  useEffect(() => {
    if (!seed) return;
    setFilters({ ...EMPTY_FILTERS, skills: seed.skills, nice: seed.nice });
    setDraftQ(""); setDraftLoc("");
  }, [seed, setFilters]);
  const newKeys = useMemo(() => new Set(saved?.new_keys || []), [saved]);
  const pickSaved = useCallback((s: SavedSearch | null, apply: boolean) => {
    setSaved(s);
    if (s && apply) {
      const f = withFilterDefaults(paramsToFilters(s.filters) as Partial<PoolFilters>);
      setFilters(f);
      setDraftQ(f.q);
      setDraftLoc(f.location);
      if (f.untouched_days || f.proven_only || !f.include_employees) setShowFilters(true);
    }
  }, [setFilters]);

  const query = useMemo(() => poolQuery(filters, page, PAGE_SIZE), [filters, page]);
  const load = useCallback(() => {
    const my = ++seq.current;
    setLoading(true);
    setError("");
    crmGet<PoolRow[]>(`/api/talent-pool${query}`)
      .then((r) => {
        if (my !== seq.current) return;
        setRows(r.data || []);
        setSmeta((r.meta as unknown as SearchMeta) || null);
      })
      .catch((e) => { if (my === seq.current) setError(e?.message || "Search failed"); })
      .finally(() => { if (my === seq.current) setLoading(false); });
  }, [query]);
  useEffect(() => { load(); }, [load]);
  useChangeEffect(() => { setPage(1); }, [filters]);

  // Debounce the two free-text boxes.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setFilters((f) => (f.q === draftQ && f.location === draftLoc ? f : { ...f, q: draftQ, location: draftLoc }));
    }, 350);
    return () => window.clearTimeout(t);
  }, [draftQ, draftLoc, setFilters]);

  const set = <K extends keyof PoolFilters>(k: K, v: PoolFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const add = (name: string, kind: "must" | "nice") => setFilters((f) => addSkill(f, name, kind));
  const remove = (name: string) => setFilters((f) => ({
    ...f, skills: f.skills.filter((s) => s !== name), nice: f.nice.filter((s) => s !== name),
  }));
  const reset = () => { setFilters(EMPTY_FILTERS); setDraftQ(""); setDraftLoc(""); };

  const pages = smeta ? Math.max(1, Math.ceil(smeta.total / (smeta.limit || PAGE_SIZE))) : 1;
  const nFilters = activeFilterCount(filters);
  const counts = smeta?.availability_counts || {};

  return (
    <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <SkillBrowser meta={meta} selected={[...filters.skills, ...filters.nice]} onAdd={add} />

      <div className="min-w-0 space-y-3">
        <SavedSearchesBar filters={filters} active={saved} onPick={pickSaved} toast={toast} />
        <section className="rounded-card border border-subtle bg-surface-1 p-3 shadow-raised">
          <SkillPicker filters={filters} onAdd={add} onRemove={remove} holders={smeta?.holders || {}} synonyms={smeta?.synonyms || {}} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="relative min-w-[14rem] flex-1">
              <span className="sr-only">Search by name, email, mobile or domain</span>
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
              <input type="text" value={draftQ} onChange={(e) => setDraftQ(e.target.value)}
                placeholder="Name, email, mobile number or domain" className={`${CONTROL} w-full pl-8`} />
            </label>
            <select aria-label="Availability" className={CONTROL} value={filters.availability}
              onChange={(e) => set("availability", e.target.value)}>
              <option value="any">Anyone</option>
              <option value="available">Available now</option>
              <option value="in_process">In a live candidacy</option>
              <option value="internal">Internal employees</option>
            </select>
            <select aria-label="Sort" className={CONTROL} value={filters.sort} onChange={(e) => set("sort", e.target.value)}>
              <option value="match">Best match</option>
              <option value="newest">Newest added</option>
              <option value="recent">Latest activity</option>
              <option value="experience">Most experienced</option>
            </select>
            {(nFilters > 0 || filters.skills.length > 0 || filters.nice.length > 0) && (
              <button type="button" className={FLOW_BTN.danger} onClick={reset}><X size={13} aria-hidden /> Clear all</button>
            )}
          </div>

          <AddedInChips value={filters.added_days} counts={meta?.added_counts || {}}
            onChange={(v) => set("added_days", v)} />

          <div className="mt-3 grid gap-2 rounded-control border border-subtle bg-surface-2/50 p-3 sm:grid-cols-2 xl:grid-cols-3">
            <FilterField label="Experience (years)">
              <RangeInputs min={filters.exp_min} max={filters.exp_max} step={0.5} label="experience"
                onMin={(v) => set("exp_min", v)} onMax={(v) => set("exp_max", v)} />
            </FilterField>
            <FilterField label="Location (lives in or prefers)">
              <div className="relative">
                <MapPin size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
                <input type="text" value={draftLoc} onChange={(e) => setDraftLoc(e.target.value)} placeholder="e.g. Pune, Bangalore"
                  className={`${CONTROL} w-full pl-8`} />
              </div>
            </FilterField>
            <FilterField label="Notice period">
              <select className={`${CONTROL} w-full`} value={filters.notice} onChange={(e) => set("notice", e.target.value)}>
                <option value="">Any</option>
                <option value="15">Immediate – 15 days</option>
                <option value="30">Up to 30 days</option>
                <option value="60">Up to 60 days</option>
                <option value="90">More than 60 days</option>
                <option value="serving">Serving notice / LWD given</option>
                <option value="unknown">Not recorded</option>
              </select>
            </FilterField>
            <FilterField label="Current CTC (lakh)">
              <RangeInputs min={filters.cur_ctc_min} max={filters.cur_ctc_max} step={0.5} label="current CTC"
                onMin={(v) => set("cur_ctc_min", v)} onMax={(v) => set("cur_ctc_max", v)} />
            </FilterField>
            <FilterField label="Expected CTC (lakh)">
              <RangeInputs min={filters.ctc_min} max={filters.ctc_max} step={0.5} label="expected CTC"
                onMin={(v) => set("ctc_min", v)} onMax={(v) => set("ctc_max", v)} />
            </FilterField>
            <FilterField label="Reach them">
              <label className="flex h-[38px] items-center gap-2 text-sm text-secondary">
                <input type="checkbox" checked={filters.has_phone} onChange={(e) => set("has_phone", e.target.checked)} />
                <Phone size={13} aria-hidden /> Only people with a mobile number
              </label>
            </FilterField>
          </div>

          <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300"
            onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
            <Filter size={12} aria-hidden /> {showFilters ? "Fewer options" : "More options"} — untouched for N days, proven skills, bench employees
          </button>
          {showFilters && (
            <div className="mt-2 grid gap-2 rounded-control border border-dashed border-subtle bg-surface-2/50 p-3 sm:grid-cols-3">
              <FilterField label="No activity for">
                <select className={`${CONTROL} w-full`} value={filters.untouched_days} onChange={(e) => set("untouched_days", e.target.value)}>
                  <option value="">Any time</option>
                  <option value="30">30 days or more</option>
                  <option value="60">60 days or more</option>
                  <option value="90">90 days or more</option>
                  <option value="180">180 days or more</option>
                </select>
              </FilterField>
              <label className="flex items-center gap-2 self-end text-sm text-secondary">
                <input type="checkbox" checked={filters.proven_only} onChange={(e) => set("proven_only", e.target.checked)} />
                Must-haves proven in an interview
              </label>
              <label className="flex items-center gap-2 self-end text-sm text-secondary">
                <input type="checkbox" checked={filters.include_employees} onChange={(e) => set("include_employees", e.target.checked)} />
                Include bench employees
              </label>
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="text-secondary">
            {loading ? "Searching…" : smeta ? (
              <>
                <b className="text-primary">{smeta.total.toLocaleString("en-IN")}</b> {smeta.total === 1 ? "person" : "people"}
                {filters.skills.length + filters.nice.length > 0 && " · best match first"}
                {saved && saved.new_count > 0 && <span className="ml-2 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white">{saved.new_count} new since you last looked</span>}
                {smeta.truncated && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">Too many to scan — add a skill or filter</span>}
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {smeta && (
              <div className="flex flex-wrap gap-1.5 text-xs">
                {(["available", "bench", "in_process", "deployed"] as const).map((k) => counts[k] ? (
                  <span key={k} className={`rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ${AVAILABILITY_LOOK[k]}`}>
                    {counts[k]} {k === "available" ? "available" : k === "bench" ? "on the bench" : k === "in_process" ? "in process" : "deployed"}
                  </span>
                ) : null)}
              </div>
            )}
            <ViewSwitch view={view} onChange={setView} />
          </div>
        </div>

        {error ? <ErrorBox error={error} onRetry={load} />
          : loading && rows.length === 0 ? <Spinner label="Searching the pool…" />
            : rows.length === 0 ? (
              <EmptyPool hasSkills={filters.skills.length + filters.nice.length > 0} onReset={reset} />
            ) : view === "list" ? (
              <PoolList rows={rows} dim={loading} toast={toast} newKeys={newKeys} skillNames={skillNames} onChanged={load}
                presetSkills={[...filters.skills.map((x) => ({ name: x, must: true })), ...filters.nice.map((x) => ({ name: x, must: false }))]}
                isSelected={(r) => !!r.candidate_id && picked.has(r.candidate_id)}
                onSelect={(r, on) => setPicked((prev) => {
                  const next = new Map(prev);
                  if (r.candidate_id) { if (on) next.set(r.candidate_id, r.name); else next.delete(r.candidate_id); }
                  return next;
                })}
                renderCard={(r) => <PoolCard row={r} onAddSkill={(s) => add(s, "nice")} toast={toast}
                  isNew={newKeys.has(r.key)} onChanged={load} onOpenGroup={onOpenGroup} skillNames={skillNames}
                  presetSkills={[...filters.skills.map((x) => ({ name: x, must: true })), ...filters.nice.map((x) => ({ name: x, must: false }))]} />} />
            ) : (
              <div className={`grid gap-3 xl:grid-cols-2 ${loading ? "opacity-60" : ""}`}>
                {rows.map((r) => <PoolCard key={r.key} row={r} onAddSkill={(s) => add(s, "nice")} toast={toast}
                  isNew={newKeys.has(r.key)} onChanged={load} onOpenGroup={onOpenGroup} skillNames={skillNames}
                  presetSkills={[...filters.skills.map((x) => ({ name: x, must: true })), ...filters.nice.map((x) => ({ name: x, must: false }))]}
                  selectable={r.kind === "candidate"} selected={!!r.candidate_id && picked.has(r.candidate_id)}
                  onSelect={(on) => setPicked((prev) => {
                    const next = new Map(prev);
                    if (r.candidate_id) { if (on) next.set(r.candidate_id, r.name); else next.delete(r.candidate_id); }
                    return next;
                  })} />)}
              </div>
            )}

        {picked.size > 0 && (
          <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-2 rounded-card border border-brand-300 bg-surface-1 px-4 py-2.5 shadow-overlay">
            <span className="text-sm font-semibold text-primary">{picked.size} selected</span>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={FLOW_BTN.neutral} onClick={() => setPicked(new Map())}>Clear</button>
              <button type="button" className={FLOW_BTN.edit} onClick={() => setBulk("group")}><FolderPlus size={13} aria-hidden /> Add {picked.size} to a group</button>
              {canApply && <button type="button" className={FLOW_BTN.success} onClick={() => setBulk("apply")}><Send size={13} aria-hidden /> Apply {picked.size} to a position…</button>}
              <button type="button" className={FLOW_BTN.primary} onClick={() => setBulk("mail")}><Mail size={13} aria-hidden /> Email {picked.size} about new roles</button>
            </div>
          </div>
        )}
        {bulk === "mail" && (
          <ReengageDialog people={[...picked.entries()].map(([candidate_id, name]) => ({ candidate_id, name }))} positions={meta?.positions || []}
            onClose={() => setBulk(null)} onDone={(m) => { setBulk(null); setPicked(new Map()); toast(m); }} />
        )}
        {bulk === "group" && (
          <AddToGroupDialog people={[...picked.entries()].map(([candidate_id, name]) => ({ candidate_id, name }))}
            skillSuggestions={skillNames}
            presetSkills={[...filters.skills.map((x) => ({ name: x, must: true })), ...filters.nice.map((x) => ({ name: x, must: false }))]}
            onClose={() => setBulk(null)}
            onDone={(m) => { setBulk(null); setPicked(new Map()); toast(m); load(); }} />
        )}
        {bulk === "apply" && (
          <ApplyPeopleDialog positions={meta?.positions || []}
            people={[...picked.entries()].map(([candidate_id, name]) => ({ candidate_id, name }))}
            onClose={() => setBulk(null)}
            onDone={(m) => { setBulk(null); setPicked(new Map()); toast(m); load(); }} />
        )}

        {smeta && pages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-1 text-sm">
            <button type="button" className={FLOW_BTN.neutral} disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft size={14} aria-hidden /> Previous
            </button>
            <span className="tabular-nums text-secondary">Page {page} of {pages}</span>
            <button type="button" className={FLOW_BTN.neutral} disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next <ChevronRight size={14} aria-hidden />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      {children}
    </div>
  );
}

/** "Added in the last N days" — when the candidate came into the tool. */
function AddedInChips({ value, counts, onChange }: {
  value: string; counts: Record<string, number>; onChange: (v: string) => void;
}) {
  const chip = (on: boolean) => `inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset transition-colors ${
    on ? "bg-teal-600 text-white ring-teal-600" : "bg-surface-1 text-secondary ring-subtle hover:text-primary"}`;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Added to the tool in the last">
      <span className="mr-1 inline-flex items-center gap-1 text-xs font-semibold text-muted"><CalendarClock size={13} aria-hidden /> Added in</span>
      <button type="button" className={chip(!value)} aria-pressed={!value} onClick={() => onChange("")}>Any time</button>
      {ADDED_CHOICES.map((d) => (
        <button key={d} type="button" className={chip(value === String(d))} aria-pressed={value === String(d)}
          onClick={() => onChange(value === String(d) ? "" : String(d))}>
          Last {d} days
          {counts[String(d)] !== undefined && (
            <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${value === String(d) ? "bg-white/25" : "bg-surface-2"}`}>
              {counts[String(d)].toLocaleString("en-IN")}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function RangeInputs({ min, max, step, label, onMin, onMax }: {
  min: string; max: string; step: number; label: string; onMin: (v: string) => void; onMax: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <input type="number" min={0} step={step} aria-label={`Minimum ${label}`} placeholder="From" className={`${CONTROL} w-full`}
        value={min} onChange={(e) => onMin(e.target.value)} />
      <span className="text-muted">–</span>
      <input type="number" min={0} step={step} aria-label={`Maximum ${label}`} placeholder="To" className={`${CONTROL} w-full`}
        value={max} onChange={(e) => onMax(e.target.value)} />
    </div>
  );
}

/** The notice period as a coloured chip; a serving candidate shows the last day. */
export function noticeLook(bucket: string | null | undefined, serving?: boolean): string {
  if (serving || bucket === "serving") return "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800";
  if (bucket === "15") return "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800";
  if (bucket === "30") return "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-800";
  if (bucket === "60") return "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800";
  if (bucket === "90") return "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-800";
  return "bg-surface-2 text-muted ring-subtle";
}

/** Mobile number with call + copy (a placeholder number is never shown). */
function PhoneChip({ phone, toast }: { phone: string | null; toast?: (m: string, k?: "ok" | "err") => void }) {
  const clean = (phone || "").trim();
  if (clean.replace(/\D/g, "").length < 6) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted ring-1 ring-inset ring-subtle">
      <Phone size={11} aria-hidden /> No mobile</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-800 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:ring-indigo-800">
      <a href={`tel:${clean.replace(/\s+/g, "")}`} className="inline-flex items-center gap-1 hover:underline"><Phone size={11} aria-hidden />{clean}</a>
      <button type="button" aria-label="Copy mobile number" title="Copy" className="ml-0.5 opacity-70 hover:opacity-100"
        onClick={() => { void navigator.clipboard?.writeText(clean).then(() => toast?.("Mobile number copied")); }}>
        <Copy size={11} aria-hidden />
      </button>
    </span>
  );
}

function EmptyPool({ hasSkills, onReset }: { hasSkills: boolean; onReset: () => void }) {
  return (
    <div className="rounded-card border border-dashed border-subtle bg-surface-1 p-8 text-center">
      <Users size={28} className="mx-auto text-muted" aria-hidden />
      <p className="mt-2 font-semibold text-primary">Nobody matches yet</p>
      <p className="mt-1 text-sm text-secondary">
        {hasSkills
          ? "Try moving a must-have skill to nice-to-have, or widen the other filters."
          : "Pick a skill on the left, or type one above, to search everyone we have on record."}
      </p>
      <button type="button" className={`${FLOW_BTN.neutral} mt-3`} onClick={onReset}><RotateCcw size={13} aria-hidden /> Start over</button>
    </div>
  );
}

/** Must-have / nice-to-have chips + a free-text box (Enter = must, Shift+Enter = nice). */
function SkillPicker({ filters, onAdd, onRemove, holders, synonyms }: {
  filters: PoolFilters;
  onAdd: (name: string, kind: "must" | "nice") => void;
  onRemove: (name: string) => void;
  holders: Record<string, number>;
  /** Other names the search also looked for (Phase 2 synonyms). */
  synonyms: Record<string, string[]>;
}) {
  const [draft, setDraft] = useState("");
  const commit = (kind: "must" | "nice") => {
    for (const part of draft.split(",")) onAdd(part, kind);
    setDraft("");
  };
  const chip = (name: string, must: boolean) => (
    <span key={name} title={synonyms[name]?.length ? `Also finds: ${synonyms[name].join(", ")}` : undefined}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
      must ? "bg-brand-600 text-white ring-brand-600" : "bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-200 dark:ring-violet-800"}`}>
      {must && <Target size={11} aria-hidden />}
      {name}
      {synonyms[name]?.length ? <Shuffle size={10} className="opacity-70" aria-label="Also finds other names" /> : null}
      {holders[name] !== undefined && <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${must ? "bg-white/25" : "bg-violet-100 dark:bg-violet-900/60"}`} title="People who have it on record">{holders[name]}</span>}
      <button type="button" aria-label={`Remove ${name}`} onClick={() => onRemove(name)} className="-mr-1 rounded-full p-0.5 hover:bg-black/10">
        <X size={11} aria-hidden />
      </button>
    </span>
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-bold uppercase tracking-wide text-muted">Must have</span>
        {filters.skills.length ? filters.skills.map((s) => chip(s, true)) : <span className="text-xs text-muted">—</span>}
        <span className="ml-2 text-xs font-bold uppercase tracking-wide text-muted">Nice to have</span>
        {filters.nice.length ? filters.nice.map((s) => chip(s, false)) : <span className="text-xs text-muted">—</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(e.shiftKey ? "nice" : "must"); } }}
          placeholder="Type any skill — Enter adds a must-have, Shift+Enter a nice-to-have"
          aria-label="Add a skill" className={`${CONTROL} min-w-[16rem] flex-1`} />
        <button type="button" className={FLOW_BTN.primary} disabled={!draft.trim()} onClick={() => commit("must")}><Plus size={13} aria-hidden /> Must</button>
        <button type="button" className={FLOW_BTN.aiOutline} disabled={!draft.trim()} onClick={() => commit("nice")}><Plus size={13} aria-hidden /> Nice</button>
      </div>
    </div>
  );
}

/** The skill master, grouped by category, with how many people have each on record. */
function SkillBrowser({ meta, selected, onAdd }: {
  meta: Meta | null;
  selected: string[];
  onAdd: (name: string, kind: "must" | "nice") => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => groupCatalogue(meta?.skills || [], search), [meta, search]);
  const chosen = new Set(selected.map(skillKey));
  return (
    <aside className="rounded-card border border-subtle bg-surface-1 shadow-raised lg:sticky lg:top-3 lg:max-h-[calc(100vh-6rem)] lg:overflow-hidden">
      <div className="border-b border-subtle p-3">
        <div className="text-sm font-bold text-primary">Skills</div>
        <p className="text-xs text-muted">Counts = people who have it on record, on a CV or rated in an interview{meta?.index?.ready ? "" : " (CVs are counted once the skill index is built)"}.</p>
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a skill"
          aria-label="Find a skill" className={`${CONTROL} mt-2 w-full`} />
      </div>
      <div className="max-h-[28rem] overflow-y-auto p-2 lg:max-h-[calc(100vh-14rem)]">
        {!meta ? <Spinner label="Loading skills…" /> : groups.length === 0 ? (
          <p className="p-2 text-xs text-muted">No skill matches “{search}”. Type it in the search box — CVs are searched too.</p>
        ) : groups.map((g) => {
          const isOpen = open[g.category] ?? (search.length > 0 || groups.length <= 3);
          return (
            <div key={g.category} className="mb-1">
              <button type="button" onClick={() => setOpen((o) => ({ ...o, [g.category]: !isOpen }))}
                className="flex w-full items-center justify-between rounded-control px-2 py-1.5 text-left text-xs font-bold uppercase tracking-wide text-secondary hover:bg-surface-2"
                aria-expanded={isOpen}>
                <span>{g.category}</span>
                <span className="tabular-nums text-muted">{g.skills.length}</span>
              </button>
              {isOpen && (
                <ul className="space-y-0.5 pb-1">
                  {g.skills.map((s) => {
                    const on = chosen.has(skillKey(s.name));
                    return (
                      <li key={s.id ?? `cv:${s.name}`} className="group flex items-center gap-1">
                        <button type="button" onClick={() => onAdd(s.name, "must")} disabled={on}
                          title="Add as a must-have"
                          className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-control px-2 py-1 text-left text-sm ${
                            on ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-200" : "text-primary hover:bg-surface-2"}`}>
                          <span className="truncate">{s.name}</span>
                          <span className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-muted">
                            {s.proven > 0 && <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400" title="Proven in an interview"><Award size={10} aria-hidden />{s.proven}</span>}
                            {s.count}
                          </span>
                        </button>
                        {!on && (
                          <button type="button" onClick={() => onAdd(s.name, "nice")} title="Add as nice-to-have"
                            className="rounded-control px-1.5 py-1 text-[11px] font-semibold text-violet-700 opacity-0 hover:bg-violet-50 focus:opacity-100 group-hover:opacity-100 dark:text-violet-300 dark:hover:bg-violet-950/40">
                            +nice
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

function SkillChip({ name, evidence, rating, missing, onClick }: {
  name: string; evidence?: Evidence | null; rating?: number | null; missing?: boolean; onClick?: () => void;
}) {
  const look = evidence ? EVIDENCE_LOOK[evidence] : null;
  const title = missing ? "Not on record" : look
    ? `${look.label}${rating ? ` · rated ${rating}/5` : ""}` : name;
  const cls = missing
    ? "border border-dashed border-subtle bg-transparent text-muted line-through decoration-1"
    : `ring-1 ring-inset ${look?.chip || "bg-surface-2 text-secondary ring-subtle"}`;
  const body = (
    <>
      {evidence === "interview" && <Award size={11} aria-hidden />}
      {name}
      {rating ? <span className="opacity-80">· {rating}/5</span> : null}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} title={`${title} — click to add as nice-to-have`}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold hover:opacity-80 ${cls}`}>{body}</button>
  ) : (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{body}</span>
  );
}

const OUTCOME_LOOK: Record<string, string> = {
  joined: "text-emerald-700 dark:text-emerald-300",
  rejected: "text-rose-700 dark:text-rose-300",
  withdrawn: "text-slate-500",
  engaged: "text-teal-700 dark:text-teal-300",
  in_progress: "text-amber-700 dark:text-amber-300",
};

function PoolCard({ row, onAddSkill, selectable, selected, onSelect, toast, isNew, onChanged, onOpenGroup, skillNames = [], presetSkills }: {
  row: PoolRow;
  /** Open a Talent Pool group (its chip on the card). */
  onOpenGroup?: (id: number) => void;
  /** Master skill names — suggestions for "+ Skill". */
  skillNames?: string[];
  /** The search's skills — a new group made from this card starts with them. */
  presetSkills?: GroupSkill[];
  onAddSkill?: (name: string) => void;
  toast?: (m: string, k?: "ok" | "err") => void;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (on: boolean) => void;
  /** New since the owner last looked at the saved search (Phase 3). */
  isNew?: boolean;
  /** The card's person left the pool — reload the list. */
  onChanged?: () => void;
}) {
  const canApply = useCanApplyFromPool();
  const [allSkills, setAllSkills] = useState(false);
  const [dialog, setDialog] = useState<"group" | "skill" | "fit" | null>(null);
  const done = (m: string) => { setDialog(null); toast?.(m); onChanged?.(); };
  const profileLink = row.kind === "candidate" ? `candidates/${row.candidate_id}` : `employees/${row.employee_id}`;
  const email = row.email && !isPlaceholderEmail(row.email) ? row.email : null;
  const cv = fileViewHref(row.cv_url, `${row.name} CV`);
  const now = lakh(row.current_ctc);
  const exp = lakh(row.expected_ctc);
  const others = allSkills ? row.skills : row.skills.slice(0, 10);
  const touched = daysAgo(row.last_touch);

  return (
    <article className={`flex flex-col rounded-card border bg-surface-1 p-3 shadow-raised transition-colors ${
      selected ? "border-brand-500 ring-2 ring-brand-500/30" : "border-subtle"}`}>
      <header className="flex items-start gap-3">
        {selectable && (
          <input type="checkbox" className="mt-2.5" checked={!!selected} onChange={(e) => onSelect?.(e.target.checked)}
            aria-label={`Select ${row.name}`} disabled={row.kind !== "candidate"} />
        )}
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${
          row.kind === "employee" ? "bg-gradient-to-br from-teal-500 to-emerald-600" : "bg-gradient-to-br from-brand-500 to-indigo-600"}`}>
          {initials(row.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <CrmLink to={profileLink} className="truncate text-base font-bold text-primary hover:underline">{row.name}</CrmLink>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${AVAILABILITY_LOOK[row.availability]}`}>
              {row.availability_label}
            </span>
            {isNew && <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">New</span>}
            {row.internal?.employee_code && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-secondary ring-1 ring-inset ring-subtle">
                {row.internal.employee_code}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-secondary">
            {row.experience_years !== null && <span><Briefcase size={11} className="mr-0.5 inline" aria-hidden />{row.experience_years} yrs</span>}
            {(row.city || row.preferred_locations) && (
              <span title={row.preferred_locations ? `Prefers ${row.preferred_locations}` : undefined}>
                <MapPin size={11} className="mr-0.5 inline" aria-hidden />{row.city || "—"}{row.preferred_locations ? ` → ${row.preferred_locations}` : ""}
              </span>
            )}
            {(now || exp) && <span>CTC {now || "—"} → <b className="text-primary">{exp || "—"}</b></span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <PhoneChip phone={row.phone} toast={toast} />
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${noticeLook(row.notice_bucket, row.serving_notice)}`}>
              <Clock size={11} aria-hidden />
              {row.serving_notice || row.last_working_day
                ? `Serving notice${row.last_working_day ? ` · LWD ${fmtDateShort(row.last_working_day)}` : ""}`
                : row.notice_period ? `Notice ${row.notice_period}` : "Notice not recorded"}
            </span>
            {row.added_at && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted" title={row.added_by ? `Added by ${row.added_by}` : undefined}>
                <CalendarClock size={11} aria-hidden /> Added {daysAgo(row.added_at)}{row.added_by ? ` by ${row.added_by}` : ""}
              </span>
            )}
          </div>
          {row.technical_domain && <div className="mt-0.5 truncate text-xs text-muted">{row.technical_domain}</div>}
          {row.internal && row.internal.projects.length > 0 && (
            <div className="mt-0.5 truncate text-xs text-muted">On {row.internal.projects.map((p) => p.project).join(", ")}</div>
          )}
        </div>
        {row.score !== null && <ScoreIndicator score={row.score} size="md" showLabel={false} />}
      </header>

      {(row.matched.length > 0 || row.missing_nice.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {row.matched.map((m) => <SkillChip key={m.skill} name={m.skill} evidence={m.best} rating={m.rating} />)}
          {row.missing_nice.map((s) => <SkillChip key={s} name={s} missing />)}
        </div>
      )}
      {row.skills.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {row.matched.length > 0 && <span className="mr-0.5 text-[11px] font-semibold text-muted">Also:</span>}
          {others.map((s) => <SkillChip key={s.key} name={s.name} evidence={s.best} rating={s.rating}
            onClick={onAddSkill ? () => onAddSkill(s.name) : undefined} />)}
          {row.skills.length > 10 && (
            <button type="button" className="text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-300"
              onClick={() => setAllSkills((v) => !v)}>
              {allSkills ? "Show fewer" : `+${row.skills.length - 10} more`}
            </button>
          )}
        </div>
      )}
      {row.skills.length === 0 && row.matched.length === 0 && (
        <p className="mt-2 text-xs text-muted">No skills on record yet.</p>
      )}
      {row.kind === "candidate" && row.candidate_id && (
        <button type="button" onClick={() => setDialog("skill")}
          className="mt-1.5 inline-flex w-fit items-center gap-1 rounded-full border border-dashed border-sky-300 px-2 py-0.5 text-[11px] font-semibold text-sky-700 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-950/40">
          <Plus size={11} aria-hidden /> Skill
        </button>
      )}
      <TalentGroupChips groups={row.groups} onOpen={onOpenGroup} />

      {(row.strengths?.length || row.gaps?.length) ? (
        <div className="mt-2 grid gap-1.5 text-xs sm:grid-cols-2">
          {row.strengths?.slice(0, 3).map((s, i) => (
            <div key={`s${i}`} className="flex gap-1 text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={12} className="mt-0.5 shrink-0" aria-hidden />{s.detail}</div>
          ))}
          {row.gaps?.slice(0, 3).map((g, i) => (
            <div key={`g${i}`} className="flex gap-1 text-amber-700 dark:text-amber-300"><X size={12} className="mt-0.5 shrink-0" aria-hidden />{g.detail}</div>
          ))}
        </div>
      ) : null}

      {row.applications && row.applications.count > 0 && (
        <div className="mt-2 rounded-control bg-surface-2 px-2.5 py-1.5 text-xs">
          <div className="font-semibold text-secondary">
            {row.applications.count} application{row.applications.count === 1 ? "" : "s"}
            {row.applications.joined ? ` · ${row.applications.joined} joined` : ""}
            {row.applications.rejected ? ` · ${row.applications.rejected} closed` : ""}
            {row.applications.live ? ` · ${row.applications.live} live` : ""}
          </div>
          <ul className="mt-0.5 space-y-0.5">
            {row.applications.recent.map((h) => (
              <li key={h.profile_id} className="flex flex-wrap items-center gap-x-1.5 text-muted">
                <CrmLink to={`profiles/${h.profile_id}`} className="font-semibold text-primary hover:underline">{h.opp_id}</CrmLink>
                <span className="truncate">{h.opportunity_title}{h.customer_name ? ` · ${h.customer_name}` : ""}</span>
                <span className={`font-semibold ${OUTCOME_LOOK[h.outcome] || ""}`}>{h.stage_label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {row.last_note && (
        <div className="mt-2 flex gap-1.5 text-xs text-secondary">
          <MessageSquare size={12} className="mt-0.5 shrink-0 text-muted" aria-hidden />
          <span className="line-clamp-2">
            <b className="text-primary">{row.last_note.channel}</b>
            {row.last_note.outcome ? ` · ${row.last_note.outcome}` : ""} · {daysAgo(row.last_note.at) || ""}
            {row.last_note.by ? ` · ${row.last_note.by}` : ""} — {row.last_note.note}
          </span>
        </div>
      )}

      <footer className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
        <CrmLink to={profileLink} className={FLOW_BTN.view}><UserCheck size={12} aria-hidden /> {row.kind === "candidate" ? "Open candidate" : "Open employee"}</CrmLink>
        {cv && <a href={cv} target="_blank" rel="noreferrer" className={FLOW_BTN.neutral}><FileText size={12} aria-hidden /> CV</a>}
        {row.kind === "candidate" && row.candidate_id && (
          <>
            <button type="button" className={FLOW_BTN.primary} onClick={() => setDialog("fit")}
              title="Every open position scored against this candidate's resumes">
              <Target size={12} aria-hidden /> {canApply ? "Check fit & apply" : "Check fit"}
            </button>
            <button type="button" className={FLOW_BTN.edit} onClick={() => setDialog("group")}><FolderPlus size={12} aria-hidden /> Add to group</button>
          </>
        )}
        <span className="ml-auto text-[11px] text-muted">
          {email || row.phone || ""}{touched ? ` · last activity ${touched}` : ""}
        </span>
        {row.kind === "candidate" && row.candidate_id && toast && (
          <PoolOptOutButton compact candidateId={row.candidate_id} name={row.name} toast={toast} onDone={onChanged} />
        )}
      </footer>
      {dialog === "group" && row.candidate_id && (
        <AddToGroupDialog people={[{ candidate_id: row.candidate_id, name: row.name }]} skillSuggestions={skillNames}
          presetSkills={presetSkills} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog === "skill" && row.candidate_id && (
        <TagSkillDialog candidateId={row.candidate_id} name={row.name} suggestions={skillNames}
          has={[...row.matched.map((m) => m.skill), ...row.skills.map((x) => x.name)]} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog === "fit" && row.candidate_id && (
        <FitApplyDialog candidateId={row.candidate_id} name={row.name} onClose={() => setDialog(null)} onDone={done} />
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Cards | List — the same people, two ways to read them (24 Nov 2026)
// ---------------------------------------------------------------------------

export type PoolView = "cards" | "list";
const VIEW_KEY = "crm.talent.view";

/** The view this login last chose (cards by default; storage may be blocked). */
export function readPoolView(): PoolView {
  try { return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "cards"; } catch { return "cards"; }
}

function usePoolView(): [PoolView, (v: PoolView) => void] {
  const [view, setView] = useState<PoolView>(readPoolView);
  const set = useCallback((v: PoolView) => {
    setView(v);
    try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* per-viewer convenience only */ }
  }, []);
  return [view, set];
}

function ViewSwitch({ view, onChange }: { view: PoolView; onChange: (v: PoolView) => void }) {
  const btn = (v: PoolView, icon: React.ReactNode, label: string) => (
    <button type="button" role="radio" aria-checked={view === v} onClick={() => onChange(v)}
      className={`inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-semibold transition-colors ${
        view === v ? "bg-brand-600 text-white shadow-raised" : "text-secondary hover:bg-surface-2 hover:text-primary"}`}>
      {icon}{label}
    </button>
  );
  return (
    <div role="radiogroup" aria-label="How to show the people" className="inline-flex rounded-control border border-subtle bg-surface-1 p-0.5">
      {btn("cards", <LayoutGrid size={13} aria-hidden />, "Cards")}
      {btn("list", <List size={13} aria-hidden />, "List")}
    </div>
  );
}

export type ListSkill = { name: string; evidence: Evidence | null; rating: number | null; missing?: boolean };

/** The skills one list row has room for: the asked skills first (strongest
 *  evidence), then the missing nice-to-haves, else the person's own skills. */
export function listSkills(row: Pick<PoolRow, "matched" | "missing_nice" | "skills">, max = 4): { shown: ListSkill[]; more: number } {
  const asked: ListSkill[] = [
    ...row.matched.map((m) => ({ name: m.skill, evidence: m.best, rating: m.rating })),
    ...row.missing_nice.map((s) => ({ name: s, evidence: null, rating: null, missing: true })),
  ];
  const all: ListSkill[] = asked.length ? asked : row.skills.map((s) => ({ name: s.name, evidence: s.best, rating: s.rating }));
  const total = asked.length ? asked.length + row.skills.length : row.skills.length;
  const shown = all.slice(0, max);
  return { shown, more: Math.max(0, total - shown.length) };
}

/** One line about their history with us: count, and the latest candidacy. */
export function historyLine(apps: PoolRow["applications"]): { count: string; latest: HistoryItem | null } | null {
  if (!apps || !apps.count) return null;
  const parts = [`${apps.count} application${apps.count === 1 ? "" : "s"}`];
  if (apps.live) parts.push(`${apps.live} live`);
  if (apps.joined) parts.push(`${apps.joined} joined`);
  if (apps.rejected) parts.push(`${apps.rejected} closed`);
  return { count: parts.join(" · "), latest: apps.recent[0] || null };
}

function noticeText(row: PoolRow): string {
  if (row.serving_notice || row.last_working_day) {
    return row.last_working_day ? `LWD ${fmtDateShort(row.last_working_day)}` : "Serving notice";
  }
  return row.notice_period || "Not recorded";
}

const TH = "sticky top-0 z-[1] border-b border-subtle bg-surface-2 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-muted";

/** The list view: one comfortable row per person, everything that decides a
 *  call on one line; a click opens the full card under the row. */
function PoolList({ rows, isSelected, onSelect, renderCard, toast, newKeys, skillNames, presetSkills, onChanged, dim }: {
  rows: PoolRow[];
  isSelected: (r: PoolRow) => boolean;
  onSelect: (r: PoolRow, on: boolean) => void;
  renderCard: (r: PoolRow) => React.ReactNode;
  toast: (m: string, k?: "ok" | "err") => void;
  newKeys?: Set<string>;
  skillNames: string[];
  presetSkills?: GroupSkill[];
  onChanged: () => void;
  dim?: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const selectable = rows.filter((r) => r.kind === "candidate" && r.candidate_id);
  const allOn = selectable.length > 0 && selectable.every(isSelected);
  const someOn = selectable.some(isSelected);
  const toggle = (key: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  return (
    <div className={`overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised ${dim ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-3 py-2 text-xs text-muted">
        <span>Click a row to see the full card · tick people to add them to a group or apply them</span>
        {open.size > 0
          ? <button type="button" className="font-semibold text-brand-700 hover:underline dark:text-brand-300" onClick={() => setOpen(new Set())}>Close all cards</button>
          : <button type="button" className="font-semibold text-brand-700 hover:underline dark:text-brand-300" onClick={() => setOpen(new Set(rows.map((r) => r.key)))}>Open all cards</button>}
      </div>
      <div className="max-h-[75vh] overflow-auto">
        <table className="w-full min-w-[1040px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={`${TH} sticky left-0 z-[2] w-10`}>
                <input type="checkbox" aria-label="Select everyone on this page" checked={allOn}
                  ref={(el) => { if (el) el.indeterminate = !allOn && someOn; }}
                  disabled={selectable.length === 0}
                  onChange={() => selectable.forEach((r) => onSelect(r, !allOn))} />
              </th>
              <th className={`${TH} sticky left-10 z-[2] min-w-[15rem]`}>Candidate</th>
              <th className={`${TH} w-16 text-center`}>Match</th>
              <th className={`${TH} min-w-[11rem]`}>Skills</th>
              <th className={TH}>Exp. · location</th>
              <th className={TH}>CTC</th>
              <th className={TH}>Notice</th>
              <th className={`${TH} min-w-[10rem]`}>With us</th>
              <th className={`${TH} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <PoolListRow key={r.key} row={r} zebra={i % 2 === 1} open={open.has(r.key)} onToggle={() => toggle(r.key)}
                selected={isSelected(r)} onSelect={(on) => onSelect(r, on)} toast={toast} isNew={!!newKeys?.has(r.key)}
                skillNames={skillNames} presetSkills={presetSkills} onChanged={onChanged} card={open.has(r.key) ? renderCard(r) : null} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PoolListRow({ row, zebra, open, onToggle, selected, onSelect, toast, isNew, skillNames, presetSkills, onChanged, card }: {
  row: PoolRow; zebra: boolean; open: boolean; onToggle: () => void;
  selected: boolean; onSelect: (on: boolean) => void;
  toast: (m: string, k?: "ok" | "err") => void; isNew: boolean;
  skillNames: string[]; presetSkills?: GroupSkill[]; onChanged: () => void;
  card: React.ReactNode;
}) {
  const canApply = useCanApplyFromPool();
  const [dialog, setDialog] = useState<"group" | "fit" | null>(null);
  const done = (m: string) => { setDialog(null); toast(m); onChanged(); };
  const profileLink = row.kind === "candidate" ? `candidates/${row.candidate_id}` : `employees/${row.employee_id}`;
  const email = row.email && !isPlaceholderEmail(row.email) ? row.email : null;
  const cv = fileViewHref(row.cv_url, `${row.name} CV`);
  const now = lakh(row.current_ctc);
  const exp = lakh(row.expected_ctc);
  const skills = listSkills(row);
  const hist = historyLine(row.applications);
  const touched = daysAgo(row.last_touch);
  const isCandidate = row.kind === "candidate" && !!row.candidate_id;
  const bg = selected ? "bg-brand-50 dark:bg-brand-900/30" : open ? "bg-surface-2"
    : `${zebra ? "bg-surface-2/40" : "bg-surface-1"} group-hover:bg-brand-50/60 dark:group-hover:bg-brand-900/20`;
  const td = `border-b border-subtle px-3 py-3 align-top ${bg}`;
  // Clicks on links, buttons, inputs and the row's portalled dialogs never toggle the card.
  const onRow = (e: React.MouseEvent<HTMLTableRowElement>) => {
    if (!isOwnDomClick(e)) return;
    if ((e.target as HTMLElement).closest("a,button,input,label,select")) return;
    onToggle();
  };
  return (
    <>
      <tr onClick={onRow} className="group cursor-pointer" aria-expanded={open}>
        <td className={`${td} sticky left-0 z-[1]`}>
          {isCandidate && <input type="checkbox" aria-label={`Select ${row.name}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} />}
        </td>
        <td className={`${td} sticky left-10 z-[1]`}>
          <div className="flex items-start gap-2.5">
            <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
              row.kind === "employee" ? "bg-gradient-to-br from-teal-500 to-emerald-600" : "bg-gradient-to-br from-brand-500 to-indigo-600"}`}>
              {initials(row.name)}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1">
                <CrmLink to={profileLink} className="font-bold text-primary hover:underline">{row.name}</CrmLink>
                <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold ring-1 ring-inset ${AVAILABILITY_LOOK[row.availability]}`}>
                  {row.availability_label}{row.internal?.employee_code ? ` · ${row.internal.employee_code}` : ""}
                </span>
                {isNew && <span className="rounded-full bg-amber-500 px-1.5 py-px text-[10px] font-bold text-white">New</span>}
              </div>
              <ContactLine phone={row.phone} email={email} toast={toast} />
            </div>
          </div>
        </td>
        <td className={`${td} text-center`}>
          {row.score !== null ? <div className="inline-flex"><ScoreIndicator score={row.score} size="sm" showLabel={false} /></div>
            : <span className="text-xs text-muted" title="Pick skills to see a match score">—</span>}
        </td>
        <td className={td}>
          {skills.shown.length === 0 ? <span className="text-xs text-muted">No skills on record</span> : (
            <div className="flex max-w-[16rem] flex-wrap gap-1">
              {skills.shown.map((s) => <SkillChip key={s.name} name={s.name} evidence={s.evidence} rating={s.rating} missing={s.missing} />)}
              {skills.more > 0 && <span className="self-center text-[11px] font-semibold text-muted">+{skills.more}</span>}
            </div>
          )}
          {row.technical_domain && <div className="mt-1 max-w-[16rem] truncate text-[11px] text-muted">{row.technical_domain}</div>}
        </td>
        <td className={td}>
          <div className="whitespace-nowrap tabular-nums">
            {row.experience_years !== null ? <><b className="text-primary">{row.experience_years}</b><span className="text-xs text-muted"> yrs</span></> : <span className="text-muted">—</span>}
          </div>
          <div className="max-w-[9rem] truncate text-xs text-secondary" title={row.preferred_locations ? `Lives in ${row.city || "—"} · prefers ${row.preferred_locations}` : undefined}>
            <MapPin size={10} className="mr-0.5 inline" aria-hidden />{row.city || "—"}{row.preferred_locations ? <span className="text-muted"> → {row.preferred_locations}</span> : null}
          </div>
        </td>
        <td className={`${td} whitespace-nowrap tabular-nums`}>
          {now || exp ? <>
            <div className="text-xs text-muted">Now {now || "—"}</div>
            <div><b className="text-primary">{exp || "—"}</b> <span className="text-[11px] text-muted">expected</span></div>
          </> : <span className="text-muted">—</span>}
        </td>
        <td className={td}>
          <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${noticeLook(row.notice_bucket, row.serving_notice)}`}>
            <Clock size={11} aria-hidden />{noticeText(row)}
          </span>
        </td>
        <td className={td}>
          <div className="max-w-[13rem] text-xs">
            {hist ? <>
              <div className="font-semibold text-secondary">{hist.count}</div>
              {hist.latest && (
                <div className="mt-0.5 truncate text-muted" title={`${hist.latest.opp_id} · ${hist.latest.opportunity_title}${hist.latest.customer_name ? ` · ${hist.latest.customer_name}` : ""}`}>
                  <CrmLink to={`profiles/${hist.latest.profile_id}`} className="font-semibold text-primary hover:underline">{hist.latest.opp_id}</CrmLink>
                  {" "}<span className={`font-semibold ${OUTCOME_LOOK[hist.latest.outcome] || ""}`}>{hist.latest.stage_label}</span>
                </div>
              )}
            </> : <div className="font-semibold text-secondary">New to us</div>}
            <div className="mt-0.5 truncate text-[11px] text-muted" title={row.added_by ? `Added by ${row.added_by}` : undefined}>
              {row.added_at ? `Added ${fmtDateShort(row.added_at)}` : ""}{touched ? `${row.added_at ? " · " : ""}active ${touched}` : ""}
            </div>
          </div>
        </td>
        <td className={`${td} text-right`}>
          <div className="flex items-center justify-end gap-1">
            {isCandidate && (
              <button type="button" className={`${FLOW_BTN.primary} whitespace-nowrap`} onClick={() => setDialog("fit")}
                title="Every open position scored against this candidate's resumes">
                <Target size={12} aria-hidden /> {canApply ? "Fit & apply" : "Fit"}
              </button>
            )}
            {cv && <a href={cv} target="_blank" rel="noreferrer" className={ICON_BTN_SM} title="Open the CV" aria-label={`Open ${row.name}'s CV`}><FileText size={14} aria-hidden /></a>}
            {isCandidate && (
              <button type="button" className={ICON_BTN_SM} title="Add to group" aria-label={`Add ${row.name} to a group`} onClick={() => setDialog("group")}>
                <FolderPlus size={14} aria-hidden />
              </button>
            )}
            <button type="button" className={ICON_BTN_SM} onClick={onToggle} aria-label={open ? "Close the card" : "Open the full card"} title={open ? "Close the card" : "Open the full card"}>
              <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
            </button>
          </div>
          {dialog === "group" && row.candidate_id && (
            <AddToGroupDialog people={[{ candidate_id: row.candidate_id, name: row.name }]} skillSuggestions={skillNames}
              presetSkills={presetSkills} onClose={() => setDialog(null)} onDone={done} />
          )}
          {dialog === "fit" && row.candidate_id && (
            <FitApplyDialog candidateId={row.candidate_id} name={row.name} onClose={() => setDialog(null)} onDone={done} />
          )}
        </td>
      </tr>
      {open && card && (
        <tr>
          <td colSpan={9} className="border-b border-subtle bg-surface-2 px-3 pb-3 pt-1">
            <div className="sticky left-3 max-w-[min(100%,62rem)]">{card}</div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Mobile (call + copy) and email on one small line under the name. */
function ContactLine({ phone, email, toast }: { phone: string | null; email: string | null; toast: (m: string, k?: "ok" | "err") => void }) {
  const clean = (phone || "").trim();
  const hasPhone = clean.replace(/\D/g, "").length >= 6;
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
      {hasPhone ? (
        <span className="inline-flex items-center gap-1 font-semibold text-indigo-700 dark:text-indigo-300">
          <a href={`tel:${clean.replace(/\s+/g, "")}`} className="inline-flex items-center gap-1 hover:underline"><Phone size={10} aria-hidden />{clean}</a>
          <button type="button" aria-label="Copy mobile number" title="Copy" className="opacity-60 hover:opacity-100"
            onClick={() => { void navigator.clipboard?.writeText(clean).then(() => toast("Mobile number copied")); }}>
            <Copy size={10} aria-hidden />
          </button>
        </span>
      ) : <span className="inline-flex items-center gap-1 text-muted"><Phone size={10} aria-hidden />No mobile</span>}
      {email && <a href={`mailto:${email}`} className="max-w-[12rem] truncate text-muted hover:underline" title={email}>{email}</a>}
    </div>
  );
}

const ICON_BTN_SM ="inline-flex h-8 w-8 items-center justify-center rounded-control border border-subtle bg-surface-1 text-secondary hover:bg-surface-2 hover:text-primary";

// ---------------------------------------------------------------------------
// Position mode
// ---------------------------------------------------------------------------

function PositionMode({ meta, toast, onOpenGroup, skillNames }: {
  meta: Meta | null; toast: (m: string, k?: "ok" | "err") => void; onOpenGroup: (id: number) => void; skillNames: string[];
}) {
  const isTa = useCanApplyFromPool();
  const [grouping, setGrouping] = useState(false);
  const [reqId, setReqId] = useSessionState<string>("talent.position", "");
  const [rows, setRows] = useState<PoolRow[]>([]);
  const [pmeta, setPmeta] = useState<PositionMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState(false);
  const [view, setView] = usePoolView();

  const load = useCallback(() => {
    if (!reqId) { setRows([]); setPmeta(null); return; }
    setLoading(true);
    setError("");
    crmGet<PoolRow[]>(`/api/talent-pool/positions/${reqId}`)
      .then((r) => { setRows(r.data || []); setPmeta((r.meta as unknown as PositionMeta) || null); setPicked(new Set()); })
      .catch((e) => setError(e?.message || "Could not match this position"))
      .finally(() => setLoading(false));
  }, [reqId]);
  useEffect(() => { load(); }, [load]);

  const byCustomer = useMemo(() => {
    const m = new Map<string, Position[]>();
    for (const p of meta?.positions || []) {
      const k = p.customer_name || "No customer";
      m.set(k, [...(m.get(k) || []), p]);
    }
    return [...m.entries()];
  }, [meta]);
  const shown = rows.filter((r) => !onlyAvailable || r.availability === "available" || r.availability === "bench");
  const chosen = rows.filter((r) => r.candidate_id && picked.has(r.candidate_id));
  const basis = pmeta?.basis;
  const positionSkills: GroupSkill[] | undefined = basis
    ? [...basis.mandatory_skills.map((x) => ({ name: x, must: true })), ...basis.optional_skills.map((x) => ({ name: x, must: false }))]
    : undefined;

  return (
    <div className="space-y-3">
      <section className="rounded-card border border-subtle bg-surface-1 p-3 shadow-raised">
        <div className="flex flex-wrap items-center gap-2">
          <label className="min-w-[18rem] flex-1">
            <span className="sr-only">Position</span>
            <select className={`${CONTROL} w-full`} value={reqId} onChange={(e) => setReqId(e.target.value)}>
              <option value="">Pick a live position…</option>
              {byCustomer.map(([cust, list]) => (
                <optgroup key={cust} label={cust}>
                  {list.map((p) => (
                    <option key={p.requirement_id} value={String(p.requirement_id)}>{p.opp_id} · {p.title}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-secondary">
            <input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} />
            Only people available now
          </label>
          {pmeta?.requirement && (
            <CrmLink to={`requirements/${pmeta.requirement.id}?tab=resumes`} className={FLOW_BTN.view}>Open the position</CrmLink>
          )}
        </div>
        {basis && (
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
            <div>
              <div className="font-bold uppercase tracking-wide text-muted">Must have</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {basis.mandatory_skills.length ? basis.mandatory_skills.map((s) => <SkillChip key={s} name={s} />) : <span className="text-muted">None set</span>}
              </div>
            </div>
            <div>
              <div className="font-bold uppercase tracking-wide text-muted">Nice to have</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {basis.optional_skills.length ? basis.optional_skills.map((s) => <SkillChip key={s} name={s} />) : <span className="text-muted">None set</span>}
              </div>
            </div>
            <div className="text-secondary">
              <div className="font-bold uppercase tracking-wide text-muted">Scored against</div>
              <div className="mt-1">
                {basis.jd_source ? `The RMG JD (${basis.jd_keywords.length} key terms)` : "Skills only — no RMG JD yet"}
                {basis.experience_band ? ` · ${basis.experience_band.min}–${basis.experience_band.max} yrs` : ""}
              </div>
            </div>
          </div>
        )}
      </section>

      {!reqId ? (
        <div className="rounded-card border border-dashed border-subtle bg-surface-1 p-8 text-center text-sm text-secondary">
          <Target size={28} className="mx-auto text-muted" aria-hidden />
          <p className="mt-2 font-semibold text-primary">Pick a position to see who in the pool fits it</p>
          <p className="mt-1">Scored the same way as Suggested Candidates on the opportunity — people already applied to it are left out.</p>
        </div>
      ) : error ? <ErrorBox error={error} onRetry={load} />
        : loading ? <Spinner label="Matching the pool…" />
          : shown.length === 0 ? (
            <div className="rounded-card border border-dashed border-subtle bg-surface-1 p-8 text-center text-sm text-secondary">
              Nobody in the pool fits this position{onlyAvailable ? " and is available now" : ""} yet.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-secondary"><b className="text-primary">{shown.length}</b> match{shown.length === 1 ? "" : "es"} · best first</div>
                <ViewSwitch view={view} onChange={setView} />
              </div>
              {view === "list" ? (
                <PoolList rows={shown} toast={toast} skillNames={skillNames} onChanged={load} presetSkills={positionSkills}
                  isSelected={(r) => !!r.candidate_id && picked.has(r.candidate_id)}
                  onSelect={(r, on) => setPicked((prev) => {
                    const next = new Set(prev);
                    if (r.candidate_id) { if (on) next.add(r.candidate_id); else next.delete(r.candidate_id); }
                    return next;
                  })}
                  renderCard={(r) => <PoolCard row={r} toast={toast} onChanged={load} onOpenGroup={onOpenGroup}
                    skillNames={skillNames} presetSkills={positionSkills} />} />
              ) : (
              <div className="grid gap-3 xl:grid-cols-2">
                {shown.map((r) => (
                  <PoolCard key={r.key} row={r} toast={toast} onChanged={load} onOpenGroup={onOpenGroup} skillNames={skillNames}
                    presetSkills={basis ? [...basis.mandatory_skills.map((x) => ({ name: x, must: true })), ...basis.optional_skills.map((x) => ({ name: x, must: false }))] : undefined}
                    selectable={r.kind === "candidate"}
                    selected={!!r.candidate_id && picked.has(r.candidate_id)}
                    onSelect={(on) => setPicked((prev) => {
                      const next = new Set(prev);
                      if (r.candidate_id) { if (on) next.add(r.candidate_id); else next.delete(r.candidate_id); }
                      return next;
                    })} />
                ))}
              </div>
              )}
            </>
          )}

      {chosen.length > 0 && pmeta?.requirement && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-2 rounded-card border border-brand-300 bg-surface-1 px-4 py-2.5 shadow-overlay">
          <span className="text-sm font-semibold text-primary">{chosen.length} selected</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={FLOW_BTN.neutral} onClick={() => setPicked(new Set())}>Clear</button>
            <button type="button" className={FLOW_BTN.edit} onClick={() => setGrouping(true)}><FolderPlus size={13} aria-hidden /> Save as a group</button>
            {isTa && (
              <button type="button" className={FLOW_BTN.success} onClick={() => setApplying(true)}>
                <Send size={13} aria-hidden /> Apply {chosen.length} to this position
              </button>
            )}
          </div>
        </div>
      )}
      {applying && pmeta?.requirement && (
        <ApplyPeopleDialog
          requirement={pmeta.requirement}
          people={chosen.filter((r) => r.candidate_id).map((r) => ({ candidate_id: r.candidate_id!, name: r.name }))}
          onClose={() => setApplying(false)}
          onDone={(msg) => { setApplying(false); toast(msg); load(); }}
        />
      )}
      {grouping && pmeta?.requirement && (
        <AddToGroupDialog people={chosen.filter((r) => r.candidate_id).map((r) => ({ candidate_id: r.candidate_id!, name: r.name }))}
          skillSuggestions={skillNames}
          presetSkills={basis ? [...basis.mandatory_skills.map((x) => ({ name: x, must: true })), ...basis.optional_skills.map((x) => ({ name: x, must: false }))] : undefined}
          onClose={() => setGrouping(false)}
          onDone={(m, id) => { setGrouping(false); setPicked(new Set()); toast(m); if (id) onOpenGroup(id); }} />
      )}
    </div>
  );
}
