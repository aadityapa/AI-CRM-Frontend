/**
 * Screening Desk (25 Sep 2026) — RMG / GM screen every TA-applied candidate here.
 *
 * Before: open an opportunity → its requirement → Applied Candidates → a row →
 * View resume → ATS → Shortlist, once per candidate, once per opportunity.
 * Now one queue across every live opportunity, grouped by POSITION, with the
 * resume, the ATS score and the decision side by side.
 *
 * Server: `GET /api/screening-desk` (rows + counts + positions + filter
 * options) and `POST /api/screening-desk/score`. Rules live in
 * backend services/screening_desk.py; this page renders them.
 *
 *  - ATS is automatic: rows without a score are scored in small batches as
 *    soon as they are on screen (scan only — the server never auto-shortlists
 *    or emails from here). Each row is tried once per page load; a failure
 *    shows the server's reason rather than retrying forever.
 *  - Decisions reuse the profile endpoints (`rmg-screening`,
 *    `fast-track-to-sales`) so this page and the requirement page can never
 *    disagree about what Shortlist does.
 *  - Access is the approval, never a role: `useCanApprove("profile.rmg_screening")`
 *    (RMG, GM, or whoever Admin ticked) — the same answer the server gate gives.
 *  - 28 Sep 2026 — the whole RMG / GM day lives here: five tabs (Pending ·
 *    Shortlisted · In review · Rejected · All), every row's `next_step` in
 *    plain words, the interview ladder (AI L1 · manual L1 · L2 · L3/L4 — book,
 *    ask TA, record feedback) in `InterviewLadder`, the skill grid
 *    (`SkillEvalGrid`), Submit to Sales / Reject (`VerdictModal`), the
 *    candidate's history, JD & skills on the position header, and the
 *    positions waiting for RMG approval (`RmgApprovalsStrip`). Nothing here
 *    calls a new endpoint — every action is the profile / requirement page's own.
 *
 * ⚠️ Controls use `CONTROL` (no width), not `inputCls`, which ends in `w-full`.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowRight, Bot, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, ExternalLink,
  FileText, History, ListChecks, Pencil, RefreshCw, Search, Send, SlidersHorizontal, Sparkles, Users, X,
} from "lucide-react";

import { crmGet, crmPost, qs } from "../api";
import { FilePreviewPane } from "../components/FileUpload";
import { CONTROL, ICON_BTN, STATE_CHIP, type StateTone } from "../components/controlTower";
import { DirectToSalesButton, FastTrackButton, InternalChip, type InternalEmployee } from "../components/FastTrackToSales";
import { InterviewRouteChoice, type InterviewRoute } from "../components/InterviewRouteChoice";
import { InterviewLadder, type AiL1, type LadderRounds } from "../components/InterviewLadder";
import { JdSkillsModal } from "../components/JdSkillsModal";
import { FLOW_BTN } from "../components/flowButtons";
import { useHandoverNote } from "../components/handoverNote";
import { SalesReadinessPanel } from "../components/SalesReadinessPanel";
import { RmgVerdictHero, ScreeningDecisionModal, type ShortlistRoute } from "../components/ScreeningDecisionModal";
import { DialogActions } from "../components/dialogKit";
import { HandedOverPanel } from "../components/HandedOverPanel";
import { RmgApprovalsStrip, type ApprovalItem } from "../components/RmgApprovalsStrip";
import { RmgTaskBoard, TASK_ACCENT, offDeskItems, type TaskBoardData } from "../components/RmgTaskBoard";
import { SkillEvalGrid } from "../components/SkillEvalGrid";
import { fmtDateTime12 } from "../../lib/datetime";
import { ScoreIndicator } from "../components/ScoreIndicator";
import {
  EmptyState, ErrorBox, Field, Modal, Skeleton, btnDanger, btnPrimary, btnSecondary,
  inputCls, useToast,
} from "../components/ui";
import { CandidateStatusBadge } from "../components/CandidateStatusBadge";
import type { CandidateStatus } from "../components/CandidateStatusBadge";
import { displayEmail } from "../lib/candidateEmail";
import { CrmLink } from "../routerHooks";
import { useCanApprove } from "../useAccess";
import { usePageTab } from "../lib/pageState";

/* ---------- server shapes ---------- */

type Screening = "pending" | "shortlisted" | "review" | "rejected" | "all";

/** Server `next_step` — whose move it is, in plain words. */
export type NextStep = {
  key: string; label: string; owner: "you" | "TA" | "candidate" | "AI" | "done"; tone: "ok" | "warn" | "bad" | "none";
};
type AtsBand = "high" | "medium" | "low" | "unscored";

type AtsSummary = {
  skills_matched: string[];
  skills_missing: string[];
  jd_keywords_matched: number;
  jd_keywords_total: number;
  experience_years: number | null;
  experience_match: boolean | null;
  ai_summary: string | null;
};

export type DeskRow = {
  profile_id: number;
  candidate_id: number;
  candidate_name: string;
  email: string | null;
  phone: string | null;
  experience_years: number | null;
  notice_period: string | null;
  current_ctc: number | null;
  expected_ctc: number | null;
  location: string | null;
  technical_domain: string | null;
  opportunity_id: number;
  opp_id: string;
  opportunity_title: string;
  customer_id: number | null;
  customer_name: string | null;
  requirement_id: number;
  req_number: string;
  position_title: string;
  positions: number;
  exp_min: number | null;
  exp_max: number | null;
  pipeline_status: string;
  /** The derived status every screen shows (server-side). */
  profile_status?: CandidateStatus | null;
  rmg_screening_status: "Pending" | "Shortlisted" | "Rejected" | null;
  rmg_screening_note: string | null;
  rmg_screening_at: string | null;
  ta_owner_id: number | null;
  ta_owner_name: string | null;
  applied_on: string | null;
  waiting_days: number | null;
  resume_id: number | null;
  resume_url: string | null;
  has_cv: boolean;
  ats_score: number | null;
  ats_band: AtsBand;
  ats_status: string | null;
  ats: AtsSummary | null;
  internal: InternalEmployee | null;
  fast_track_block: string | null;
  /** Why RMG / GM's direct submission to Sales is unavailable; null when allowed. */
  direct_to_sales_block?: string | null;
  /** AI L1 vs manual L1 — what was decided, and whether it is still open. */
  interview_route: InterviewRoute | null;
  /** The ladder (28 Sep 2026): the latest AI L1, the manual L1 / L2 state,
   *  the next step and whether Submit to Sales / Reject may be pressed. */
  ai_l1: AiL1 | null;
  rounds: LadderRounds;
  next_step: NextStep | null;
  decision: { can_decide: boolean; blocked: string | null } | null;
  tab: Screening;
  /** Finished interviews no screener has marked reviewed (28 Sep 2026) — the
   *  row's "New result" highlight and the detail pane's review banner. */
  new_results?: NewResult[];
};

type NewResult = {
  key: string; kind: "ai" | "round"; label: string; result: string; score: number | null;
  when: string | null; by: string | null; passed: boolean;
};

type Position = {
  requirement_id: number; req_number: string; position_title: string; positions: number;
  opportunity_id: number; opp_id: string; opportunity_title: string;
  customer_id: number | null; customer_name: string | null; count: number; pending: number;
  review: number; requirement_status: string;
  jd_missing: boolean; description: string | null; rmg_jd_text: string | null;
  skills: { skill_id: number; skill_name: string | null; is_mandatory: boolean; min_rating: number | null }[];
};

type DeskMeta = {
  page: number; limit: number; total: number; pages: number;
  counts: Record<Screening, number>;
  positions: Position[];
  options: {
    customers: { id: number; name: string }[];
    ta_owners: { id: number; name: string }[];
    opportunities: { id: number; label: string; customer_id: number | null }[];
    positions?: { id: number; label: string; customer_id: number | null; opportunity_id: number }[];
  };
  ats_thresholds: { high: number; medium: number };
  max_score_batch: number;
  round_results: string[];
  approvals: { can_approve: boolean; items: ApprovalItem[] };
};

type ScoreResult = {
  scored: { profile_id: number; resume_id: number; ats_score: number; ats_band: AtsBand }[];
  failed: { profile_id: number; reason: string }[];
  skipped: { profile_id: number; reason: string; ats_score?: number }[];
};

/* ---------- page constants ---------- */

/** Task categories that filter the queue (the rest open their own pages). */
const DESK_TASKS = new Set(["results", "feedback", "screening", "route", "booking", "decide", "ai_failed"]);

const TABS: { key: Screening; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "shortlisted", label: "Shortlisted" },
  { key: "review", label: "In review" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];
const PAGE_SIZE = 100;
/** Mirror of the server's rejection-note minimum at the screening gate. */
const MIN_REJECT_NOTE = 5;
const BAND_TONE: Record<AtsBand, StateTone> = { high: "ok", medium: "warn", low: "bad", unscored: "none" };

type Filters = {
  search: string; customer_id: string; opportunity_id: string; requirement_id: string; ta_owner_id: string;
  ats_band: string; internal: string; applied_from: string; applied_to: string; sort: string;
  /* 28 Sep 2026 — "search with all required filters": whose move, route,
     experience vs the band, city, and only rows with a result to review. */
  next_owner: string; route: string; exp_fit: string; location: string; new_results: string;
  /* 29 Sep 2026 — "whatever filter GM & RMG need": budget fit, position priority,
     waiting at least N days, an experience range, notice, AI L1 and manual L1 outcome. */
  budget: string; priority: string; waiting_min: string; exp_min: string; exp_max: string;
  notice: string; ai_result: string; l1_result: string;
};
const NO_FILTERS: Filters = {
  search: "", customer_id: "", opportunity_id: "", requirement_id: "", ta_owner_id: "", ats_band: "",
  internal: "", applied_from: "", applied_to: "", sort: "newest",
  next_owner: "", route: "", exp_fit: "", location: "", new_results: "",
  budget: "", priority: "", waiting_min: "", exp_min: "", exp_max: "", notice: "", ai_result: "", l1_result: "",
};
/** Labels for the active-filter chips (value → words). */
const FILTER_WORDS: Partial<Record<keyof Filters, Record<string, string>>> = {
  next_owner: { you: "Your move", TA: "With TA", candidate: "With the candidate", AI: "AI deciding", done: "Nothing to do" },
  route: { ai: "AI L1 route", manual: "Manual L1 route", none: "Route not chosen" },
  exp_fit: { in: "Experience in band", out: "Experience outside band", unknown: "Experience not recorded" },
  ats_band: { high: "ATS high", medium: "ATS medium", low: "ATS low", unscored: "Not scored yet" },
  internal: { true: "Internal only", false: "External only" },
  new_results: { true: "New results only" },
  budget: { over: "Over budget", within: "Within budget", unknown: "Budget / CTC not known" },
  priority: { High: "High priority", Medium: "Medium priority", Low: "Low priority" },
  waiting_min: { "3": "Waiting 3+ days", "7": "Waiting 7+ days", "14": "Waiting 14+ days", "30": "Waiting 30+ days" },
  notice: { "15": "Notice ≤ 15 days", "30": "Notice ≤ 30 days", "60": "Notice ≤ 60 days", "90": "Notice > 60 days",
            unknown: "Notice not recorded" },
  ai_result: { passed: "AI L1 passed", failed: "AI L1 failed", pending: "AI L1 pending", none: "No AI L1" },
  l1_result: { hire: "L1: hire", no_hire: "L1: no hire", awaiting: "L1 awaiting verdict", none: "No manual L1" },
};
const FILTER_NAMES: Partial<Record<keyof Filters, string>> = {
  search: "Search", customer_id: "Customer", opportunity_id: "Opportunity", requirement_id: "Position",
  ta_owner_id: "TA", applied_from: "Applied from", applied_to: "Applied to", location: "Location",
  exp_min: "Min exp (yrs)", exp_max: "Max exp (yrs)",
};

/* ---------- formatting ---------- */

const lakh = (v: number | null) => (v == null ? "—" : `₹${(v / 100_000).toFixed(v % 100_000 === 0 ? 0 : 2)} L`);
const years = (v: number | null) => (v == null ? "—" : `${v} yrs`);
function band(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `${min}–${max} yrs`;
  return min != null ? `${min}+ yrs` : `≤ ${max} yrs`;
}
function fitsBand(exp: number | null, min: number | null, max: number | null): boolean | null {
  if (exp == null || (min == null && max == null)) return null;
  return (min == null || exp >= min) && (max == null || exp <= max);
}
function waited(days: number | null): string {
  if (days == null) return "—";
  if (days <= 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

/* ================================================================== */

/** `?task=<category>&focus=<profile id>` (28 Sep 2026): the Dashboard, the
 *  task board and every "interview done" notification open the desk AT the
 *  candidate, on the task. Read on mount and on every in-app navigation. */
function readDeskLink(): { task: string | null; focus: number | null } {
  try {
    const p = new URLSearchParams(window.location.search);
    const task = (p.get("task") || "").trim();
    const focus = Number(p.get("focus") || "");
    return { task: /^[a-z_]{1,32}$/.test(task) ? task : null, focus: Number.isInteger(focus) && focus > 0 ? focus : null };
  } catch {
    return { task: null, focus: null };
  }
}

export function ScreeningDeskPage() {
  const canScreen = useCanApprove("profile.rmg_screening");
  if (!canScreen) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <EmptyState
          icon={<ClipboardCheck size={22} />}
          message={<><b className="text-primary">The Screening Desk is for RMG and GM.</b><br />
            Ask Admin to tick “RMG screening decision” in your role or access template if you should screen candidates.</>}
        />
      </div>
    );
  }
  return <Desk />;
}

function Desk() {
  const [toast, showToast] = useToast();
  const [tab, setTab] = usePageTab<Screening>("status", "pending", TABS.map((t) => t.key));
  const [link, setLink] = useState(readDeskLink);
  const task = link.task;
  const [showFilters, setShowFilters] = useState(false);
  /* The task board (same list as the Dashboard's work desk). */
  const [board, setBoard] = useState<{ data: TaskBoardData | null; loading: boolean; error: string }>({ data: null, loading: true, error: "" });
  const boardSeq = useRef(0);
  const loadBoard = useCallback(async () => {
    const seq = ++boardSeq.current;
    setBoard((b) => ({ ...b, loading: true, error: "" }));
    try {
      const res = await crmGet<TaskBoardData>("/api/screening-desk/tasks");
      if (seq === boardSeq.current) setBoard({ data: res.data, loading: false, error: "" });
    } catch (e: any) {
      if (seq === boardSeq.current) setBoard({ data: null, loading: false, error: e?.message || "Failed to load" });
    }
  }, []);
  useEffect(() => { void loadBoard(); }, [loadBoard]);
  /* In-app links to this same page (a task tile, a Dashboard row, the bell)
     arrive as popstate — re-read the task and the candidate to focus. */
  useEffect(() => {
    const onPop = () => setLink(readDeskLink());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [searchDraft, setSearchDraft] = useState("");
  const [locationDraft, setLocationDraft] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<DeskRow[]>([]);
  const [meta, setMeta] = useState<DeskMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  /* auto-ATS bookkeeping: ids being scored now, and why a row could not be. */
  const [scoring, setScoring] = useState<Set<number>>(new Set());
  const [scoreErrors, setScoreErrors] = useState<Record<number, string>>({});
  const attempted = useRef<Set<number>>(new Set());
  const loadSeq = useRef(0);
  /* The candidate a deep link asked for — selected on the next load, once. */
  const focusRef = useRef<number | null>(link.focus);
  useEffect(() => { focusRef.current = link.focus; }, [link]);

  const query = useMemo(() => qs({
    screening: tab,
    task: task && DESK_TASKS.has(task) ? task : undefined,
    search: filters.search || undefined,
    customer_id: filters.customer_id || undefined,
    opportunity_id: filters.opportunity_id || undefined,
    requirement_id: filters.requirement_id || undefined,
    next_owner: filters.next_owner || undefined,
    route: filters.route || undefined,
    exp_fit: filters.exp_fit || undefined,
    location: filters.location || undefined,
    new_results: filters.new_results || undefined,
    budget: filters.budget || undefined,
    priority: filters.priority || undefined,
    waiting_min: filters.waiting_min || undefined,
    exp_min: filters.exp_min || undefined,
    exp_max: filters.exp_max || undefined,
    notice: filters.notice || undefined,
    ai_result: filters.ai_result || undefined,
    l1_result: filters.l1_result || undefined,
    ta_owner_id: filters.ta_owner_id || undefined,
    ats_band: filters.ats_band || undefined,
    internal: filters.internal || undefined,
    applied_from: filters.applied_from || undefined,
    applied_to: filters.applied_to || undefined,
    sort: filters.sort,
    page,
    limit: PAGE_SIZE,
  }), [tab, task, filters, page]);

  const load = useCallback(async (keepSelection?: number | null) => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<DeskRow[]>(`/api/screening-desk${query}`);
      if (seq !== loadSeq.current) return;   // a newer filter change won
      const data = res.data || [];
      setRows(data);
      setMeta((res.meta as unknown as DeskMeta) || null);
      const focus = focusRef.current;
      setSelectedId((prev) => {
        const want = focus ?? (keepSelection !== undefined ? keepSelection : prev);
        return want != null && data.some((r) => r.profile_id === want) ? want : data[0]?.profile_id ?? null;
      });
      if (focus != null) {
        focusRef.current = null;
        window.setTimeout(() => document.getElementById(`desk-row-${focus}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
      }
    } catch (e: any) {
      if (seq === loadSeq.current) setError(e?.message || "Could not load the screening desk");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [query]);

  useEffect(() => { void load(); }, [load]);
  /* The board's counts follow every change made on the desk. */
  const reloadAll = useCallback((keep?: number | null) => { void load(keep); void loadBoard(); }, [load, loadBoard]);
  /* JD / skills saved (30 Sep 2026): the server re-scores the position's
     applicants in the background — forget the old "could not score" reasons,
     reload now and once more when the scores have landed. */
  const afterJdSaved = useCallback(() => {
    attempted.current.clear();
    setScoreErrors({});
    reloadAll(selectedId);
    window.setTimeout(() => reloadAll(selectedId), 6000);
  }, [reloadAll, selectedId]);

  /* Picking a desk task (or clearing it) — kept in the URL so Back works. */
  const pickTask = (key: string | null) => {
    setLink({ task: key, focus: null });
    setPage(1);
    try {
      const url = new URL(window.location.href);
      if (key) url.searchParams.set("task", key); else url.searchParams.delete("task");
      url.searchParams.delete("focus");
      window.history.replaceState(window.history.state, "", url.toString());
    } catch { /* URL is a convenience */ }
    if (key === "approvals") document.getElementById("rmg-approvals")?.scrollIntoView({ behavior: "smooth" });
  };
  const activeCategory = board.data?.categories.find((c) => c.key === task) || null;
  /* The Feedback-due task is answered by the panel on the board (30 Sep 2026). */
  const feedbackView = task === "feedback";
  /* "Positions to approve" lives in the strip above the queue, not in it. */
  useEffect(() => {
    if (task === "approvals" && meta) document.getElementById("rmg-approvals")?.scrollIntoView({ behavior: "smooth" });
  }, [task, meta]);

  /* Debounced search / location: typing must not fire a request per keystroke. */
  useEffect(() => {
    const t = window.setTimeout(() => {
      setFilters((f) => (f.search === searchDraft.trim() && f.location === locationDraft.trim() ? f
        : { ...f, search: searchDraft.trim(), location: locationDraft.trim() }));
      setPage(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchDraft, locationDraft]);

  /* ---- auto-ATS: score what is on screen, a small batch at a time ---- */
  useEffect(() => {
    const batch = meta?.max_score_batch || 5;
    const todo = rows
      .filter((r) => r.ats_score == null && r.has_cv && !attempted.current.has(r.profile_id))
      .map((r) => r.profile_id);
    if (!todo.length) return;
    let cancelled = false;
    todo.forEach((id) => attempted.current.add(id));
    (async () => {
      for (let i = 0; i < todo.length && !cancelled; i += batch) {
        const ids = todo.slice(i, i + batch);
        setScoring((s) => new Set([...s, ...ids]));
        try {
          const res = await crmPost<ScoreResult>("/api/screening-desk/score", { profile_ids: ids });
          const r = res.data;
          const byId = new Map(r.scored.map((s) => [s.profile_id, s]));
          r.skipped.forEach((s) => { if (s.ats_score != null) byId.set(s.profile_id, { profile_id: s.profile_id, resume_id: 0, ats_score: s.ats_score, ats_band: "unscored" }); });
          setRows((prev) => prev.map((row) => {
            const hit = byId.get(row.profile_id);
            return hit ? { ...row, ats_score: hit.ats_score, ats_band: bandOf(hit.ats_score, meta), resume_id: hit.resume_id || row.resume_id } : row;
          }));
          if (r.failed.length) {
            setScoreErrors((prev) => ({ ...prev, ...Object.fromEntries(r.failed.map((f) => [f.profile_id, f.reason])) }));
          }
        } catch (e: any) {
          const reason = e?.message || "ATS scoring is unavailable right now";
          setScoreErrors((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, reason])) }));
        } finally {
          setScoring((s) => { const n = new Set(s); ids.forEach((id) => n.delete(id)); return n; });
        }
      }
    })();
    return () => { cancelled = true; };
    // `meta` is read for thresholds only; re-running on it would double-score.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const setFilter = (key: keyof Filters, value: string) => {
    setFilters((f) => {
      const next = { ...f, [key]: value };
      // An opportunity from another customer would describe an empty intersection.
      if (key === "customer_id" && value && f.opportunity_id) {
        const opp = meta?.options.opportunities.find((o) => String(o.id) === f.opportunity_id);
        if (opp && String(opp.customer_id) !== value) next.opportunity_id = "";
      }
      // A position from another customer / opportunity likewise.
      if ((key === "customer_id" || key === "opportunity_id") && value && next.requirement_id) {
        const pos = meta?.options.positions?.find((o) => String(o.id) === next.requirement_id);
        if (pos && ((next.customer_id && String(pos.customer_id) !== next.customer_id)
          || (next.opportunity_id && String(pos.opportunity_id) !== next.opportunity_id))) next.requirement_id = "";
      }
      return next;
    });
    setPage(1);
  };
  const activeFilters = Object.entries(filters).filter(([k, v]) => k !== "sort" && v).length;
  const clearFilters = () => { setFilters(NO_FILTERS); setSearchDraft(""); setLocationDraft(""); setPage(1); };
  const clearOne = (key: keyof Filters) => {
    if (key === "search") setSearchDraft("");
    if (key === "location") setLocationDraft("");
    setFilter(key, NO_FILTERS[key]);
  };
  /* Human words for one active filter's value (dropdown label, else the value). */
  const filterWord = (key: keyof Filters, value: string): string => {
    const words = FILTER_WORDS[key];
    if (words?.[value]) return words[value];
    const o = meta?.options;
    const find = (list: { id: number; name?: string; label?: string }[] | undefined) =>
      list?.find((x) => String(x.id) === value);
    const hit = key === "customer_id" ? find(o?.customers) : key === "opportunity_id" ? find(o?.opportunities)
      : key === "requirement_id" ? find(o?.positions) : key === "ta_owner_id" ? find(o?.ta_owners) : undefined;
    return `${FILTER_NAMES[key] ? `${FILTER_NAMES[key]}: ` : ""}${hit?.name || hit?.label || value}`;
  };
  const activeList = (Object.keys(filters) as (keyof Filters)[])
    .filter((k) => k !== "sort" && filters[k]);

  /* Rows grouped by position, in the server's position order (pending first). */
  const groups = useMemo(() => {
    const order = new Map((meta?.positions || []).map((p, i) => [p.requirement_id, i]));
    const byReq = new Map<number, DeskRow[]>();
    rows.forEach((r) => { const list = byReq.get(r.requirement_id) || []; list.push(r); byReq.set(r.requirement_id, list); });
    return [...byReq.entries()]
      .sort(([a], [b]) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9))
      .map(([rid, list]) => ({ position: meta?.positions.find((p) => p.requirement_id === rid), rows: list, rid }));
  }, [rows, meta]);

  const flat = useMemo(() => groups.flatMap((g) => (collapsed.has(g.rid) ? [] : g.rows)), [groups, collapsed]);
  const selected = rows.find((r) => r.profile_id === selectedId) || null;

  /* After a decision the row usually leaves this tab — move on to the next one. */
  const afterDecision = (message: string, decidedId: number) => {
    showToast(message);
    const idx = flat.findIndex((r) => r.profile_id === decidedId);
    const next = flat[idx + 1] || flat[idx - 1] || null;
    reloadAll(next ? next.profile_id : null);
  };

  /* ↑ / ↓ move through the queue (not while typing in a field). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (document.querySelector("[role='dialog']")) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const idx = flat.findIndex((r) => r.profile_id === selectedId);
      const next = flat[e.key === "ArrowDown" ? idx + 1 : idx - 1];
      if (next) { e.preventDefault(); setSelectedId(next.profile_id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, selectedId]);

  const oppOptions = (meta?.options.opportunities || [])
    .filter((o) => !filters.customer_id || String(o.customer_id) === filters.customer_id);
  const positionOptions = (meta?.options.positions || [])
    .filter((o) => (!filters.customer_id || String(o.customer_id) === filters.customer_id)
      && (!filters.opportunity_id || String(o.opportunity_id) === filters.opportunity_id));
  /* The "More filters" panel shows the count of what it holds. */
  const moreKeys: (keyof Filters)[] = ["opportunity_id", "ta_owner_id", "next_owner", "route", "exp_fit", "ats_band",
    "internal", "location", "applied_from", "applied_to", "new_results", "budget", "priority", "waiting_min",
    "exp_min", "exp_max", "notice", "ai_result", "l1_result"];
  const moreActive = moreKeys.filter((k) => filters[k]).length;

  return (
    <div className="space-y-4">
      {toast}
      {/* ---------------- header: who you are working for today ---------------- */}
      <header className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="relative bg-gradient-to-r from-brand-700 via-indigo-700 to-violet-700 px-4 py-4 text-white sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-display flex items-center gap-2 text-xl font-bold">
                <ClipboardCheck size={20} aria-hidden /> Screening Desk
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-white/85">
                Your whole day in one place — review results, screen, choose the route, book and judge the
                L1 / L2 rounds and hand over to Sales. Pick a task below to see only those candidates.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {board.data && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm font-bold tabular-nums">
                  <Sparkles size={14} aria-hidden /> {board.data.total} pending
                </span>
              )}
              {scoring.size > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold" aria-live="polite">
                  <RefreshCw size={12} className="animate-spin motion-reduce:animate-none" /> Scoring {scoring.size}…
                </span>
              )}
              <button type="button" onClick={() => reloadAll(selectedId)} title="Refresh" aria-label="Refresh"
                className="inline-flex h-9 w-9 items-center justify-center rounded-control bg-white/15 hover:bg-white/25">
                <RefreshCw size={16} className={loading || board.loading ? "animate-spin motion-reduce:animate-none" : ""} />
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 py-4 sm:px-5">
          <RmgTaskBoard data={board.data} loading={board.loading} error={board.error} onRetry={() => void loadBoard()}
            activeTask={task} onPickDeskTask={pickTask} />
        </div>

        <div className="border-t border-subtle px-4 py-3 sm:px-5">
          {task && DESK_TASKS.has(task) ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-2 rounded-full bg-gradient-to-r px-3 py-1.5 text-sm font-bold text-white ${TASK_ACCENT[task] || "from-slate-500 to-slate-700"}`}>
                {activeCategory?.label || "Task"} · {feedbackView ? activeCategory?.count ?? "…" : <>{meta?.total ?? "…"}{offDeskItems(activeCategory).length ? " on the desk" : ""}</>}
              </span>
              <span className="text-xs text-muted">{activeCategory?.hint}</span>
              <button type="button" className={`${btnSecondary} ml-auto !py-1.5 text-xs`} onClick={() => pickTask(null)}>
                <X size={13} /> Show every candidate
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
          {/* screening tabs */}
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Screening status">
            {TABS.map((t) => {
              const on = tab === t.key;
              const n = meta?.counts?.[t.key];
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => { setTab(t.key); setPage(1); }}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors duration-micro ${
                    on ? "border-brand-600 bg-brand-600 text-white" : "border-subtle bg-surface-1 text-secondary hover:bg-surface-2"}`}
                >
                  {t.label}
                  {n != null && (
                    <span className={`rounded-full px-1.5 text-xs tabular-nums ${on ? "bg-white text-brand-700" : "bg-surface-2 text-muted"}`}>{n}</span>
                  )}
                </button>
              );
            })}
          </div>
            </div>
          )}
          {/* ---- search + filters: always on screen — except the Feedback-due
               view (30 Sep 2026), whose panel above carries its own ---- */}
          {!feedbackView && (<>
          <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search candidates</span>
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
              <input
                type="text"
                className={`${CONTROL} w-full !py-2 pl-9 pr-8`}
                placeholder="Search name, email, phone, position, REQ / OPP number, customer or city"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
              />
              {searchDraft && (
                <button type="button" onClick={() => setSearchDraft("")} aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-primary">
                  <X size={14} />
                </button>
              )}
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:flex-none">
              <select className={`${CONTROL} w-full lg:w-44`} aria-label="Customer" value={filters.customer_id} onChange={(e) => setFilter("customer_id", e.target.value)}>
                <option value="">All customers</option>
                {meta?.options.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className={`${CONTROL} w-full lg:w-56`} aria-label="Position" value={filters.requirement_id} onChange={(e) => setFilter("requirement_id", e.target.value)}>
                <option value="">All positions</option>
                {positionOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              <select className={`${CONTROL} w-full lg:w-52`} aria-label="Sort" value={filters.sort} onChange={(e) => setFilter("sort", e.target.value)}>
                <option value="newest">Newest applied first</option>
                <option value="oldest">Waiting longest first</option>
                <option value="ats">Highest ATS first</option>
                <option value="ats_low">Lowest ATS first</option>
                <option value="experience">Most experienced first</option>
              </select>
              <button type="button" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}
                className={`${btnSecondary} justify-center !py-2 text-sm ${moreActive ? "!border-brand-500 !text-brand-700 dark:!text-brand-300" : ""}`}>
                <SlidersHorizontal size={14} /> <span className="whitespace-nowrap"><span className="hidden sm:inline">More </span>filters{moreActive ? ` (${moreActive})` : ""}</span>
                <ChevronDown size={14} className={`transition-transform ${showFilters ? "rotate-180" : ""}`} />
              </button>
            </div>
          </div>

          {showFilters && (
            <div className="mt-2 grid grid-cols-1 gap-2 rounded-card border border-subtle bg-surface-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
              <FilterField label="Opportunity">
                <select className={`${CONTROL} w-full`} value={filters.opportunity_id} onChange={(e) => setFilter("opportunity_id", e.target.value)}>
                  <option value="">All opportunities</option>
                  {oppOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </FilterField>
              <FilterField label="Applied by (TA)">
                <select className={`${CONTROL} w-full`} value={filters.ta_owner_id} onChange={(e) => setFilter("ta_owner_id", e.target.value)}>
                  <option value="">All TAs</option>
                  {meta?.options.ta_owners.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </FilterField>
              <FilterField label="Whose move">
                <select className={`${CONTROL} w-full`} value={filters.next_owner} onChange={(e) => setFilter("next_owner", e.target.value)}>
                  <option value="">Anyone</option>
                  <option value="you">Your move (RMG / GM)</option>
                  <option value="TA">With TA (booking)</option>
                  <option value="candidate">With the candidate (AI L1 pending)</option>
                  <option value="AI">AI L1 cleared</option>
                  <option value="done">Nothing to do</option>
                </select>
              </FilterField>
              <FilterField label="Interview route">
                <select className={`${CONTROL} w-full`} value={filters.route} onChange={(e) => setFilter("route", e.target.value)}>
                  <option value="">Any route</option>
                  <option value="ai">AI L1</option>
                  <option value="manual">Manual L1</option>
                  <option value="none">Not chosen yet</option>
                </select>
              </FilterField>
              <FilterField label="Experience vs position">
                <select className={`${CONTROL} w-full`} value={filters.exp_fit} onChange={(e) => setFilter("exp_fit", e.target.value)}>
                  <option value="">Any experience</option>
                  <option value="in">Within the band</option>
                  <option value="out">Outside the band</option>
                  <option value="unknown">Not recorded</option>
                </select>
              </FilterField>
              <FilterField label="ATS score">
                <select className={`${CONTROL} w-full`} value={filters.ats_band} onChange={(e) => setFilter("ats_band", e.target.value)}>
                  <option value="">Any ATS score</option>
                  <option value="high">High (≥ {meta?.ats_thresholds.high ?? 70})</option>
                  <option value="medium">Medium ({meta?.ats_thresholds.medium ?? 50}–{(meta?.ats_thresholds.high ?? 70) - 1})</option>
                  <option value="low">Low (&lt; {meta?.ats_thresholds.medium ?? 50})</option>
                  <option value="unscored">Not scored yet</option>
                </select>
              </FilterField>
              <FilterField label="Candidate type">
                <select className={`${CONTROL} w-full`} value={filters.internal} onChange={(e) => setFilter("internal", e.target.value)}>
                  <option value="">Internal + external</option>
                  <option value="true">Internal (our employees)</option>
                  <option value="false">External only</option>
                </select>
              </FilterField>
              <FilterField label="Location">
                <input className={`${CONTROL} w-full`} placeholder="City, e.g. Bengaluru" value={locationDraft}
                  onChange={(e) => setLocationDraft(e.target.value)} />
              </FilterField>
              <FilterField label="AI L1 outcome">
                <select className={`${CONTROL} w-full`} value={filters.ai_result} onChange={(e) => setFilter("ai_result", e.target.value)}>
                  <option value="">Any</option>
                  <option value="passed">Passed</option>
                  <option value="failed">Failed</option>
                  <option value="pending">Scheduled / not finished</option>
                  <option value="none">No AI L1</option>
                </select>
              </FilterField>
              <FilterField label="Manual L1 verdict">
                <select className={`${CONTROL} w-full`} value={filters.l1_result} onChange={(e) => setFilter("l1_result", e.target.value)}>
                  <option value="">Any</option>
                  <option value="hire">Hire (incl. leaning)</option>
                  <option value="no_hire">No hire (incl. leaning)</option>
                  <option value="awaiting">Asked / booked — no verdict</option>
                  <option value="none">No manual L1</option>
                </select>
              </FilterField>
              <FilterField label="Expected CTC vs budget">
                <select className={`${CONTROL} w-full`} value={filters.budget} onChange={(e) => setFilter("budget", e.target.value)}>
                  <option value="">Any</option>
                  <option value="within">Within the budget</option>
                  <option value="over">Over the budget</option>
                  <option value="unknown">CTC or budget not recorded</option>
                </select>
              </FilterField>
              <FilterField label="Notice period">
                <select className={`${CONTROL} w-full`} value={filters.notice} onChange={(e) => setFilter("notice", e.target.value)}>
                  <option value="">Any notice</option>
                  <option value="15">Immediate – 15 days</option>
                  <option value="30">16 – 30 days</option>
                  <option value="60">31 – 60 days</option>
                  <option value="90">More than 60 days</option>
                  <option value="unknown">Not recorded</option>
                </select>
              </FilterField>
              <FilterField label="Experience (years)">
                <div className="flex items-center gap-1.5">
                  <input type="number" min={0} step="0.5" inputMode="decimal" className={`${CONTROL} w-full`} placeholder="Min"
                    aria-label="Minimum experience" value={filters.exp_min} onChange={(e) => setFilter("exp_min", e.target.value)} />
                  <span className="text-muted">–</span>
                  <input type="number" min={0} step="0.5" inputMode="decimal" className={`${CONTROL} w-full`} placeholder="Max"
                    aria-label="Maximum experience" value={filters.exp_max} onChange={(e) => setFilter("exp_max", e.target.value)} />
                </div>
              </FilterField>
              <FilterField label="Position priority">
                <select className={`${CONTROL} w-full`} value={filters.priority} onChange={(e) => setFilter("priority", e.target.value)}>
                  <option value="">Any priority</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
              </FilterField>
              <FilterField label="Waiting since applying">
                <select className={`${CONTROL} w-full`} value={filters.waiting_min} onChange={(e) => setFilter("waiting_min", e.target.value)}>
                  <option value="">Any</option>
                  <option value="3">3 days or more</option>
                  <option value="7">7 days or more</option>
                  <option value="14">14 days or more</option>
                  <option value="30">30 days or more</option>
                </select>
              </FilterField>
              <FilterField label="Applied from">
                <input type="date" className={`${CONTROL} w-full`} value={filters.applied_from} max={filters.applied_to || undefined}
                  onChange={(e) => setFilter("applied_from", e.target.value)} />
              </FilterField>
              <FilterField label="Applied to">
                <input type="date" className={`${CONTROL} w-full`} value={filters.applied_to} min={filters.applied_from || undefined}
                  onChange={(e) => setFilter("applied_to", e.target.value)} />
              </FilterField>
              <label className="flex items-center gap-2 self-end rounded-control px-1 py-2 text-sm font-semibold text-secondary">
                <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={filters.new_results === "true"}
                  onChange={(e) => setFilter("new_results", e.target.checked ? "true" : "")} />
                Only candidates with a new interview result
              </label>
            </div>
          )}

          {activeList.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Active filters">
              {activeList.map((k) => (
                <span key={k} className="inline-flex items-center gap-1 rounded-full border border-brand-500 bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 dark:bg-surface-2 dark:text-brand-300">
                  {k === "search" ? `“${filters.search}”` : filterWord(k, filters[k])}
                  <button type="button" onClick={() => clearOne(k)} aria-label={`Remove filter ${FILTER_NAMES[k] || k}`} className="rounded-full hover:text-danger">
                    <X size={12} />
                  </button>
                </span>
              ))}
              <button type="button" className="ml-1 text-xs font-semibold text-muted underline-offset-2 hover:text-primary hover:underline" onClick={clearFilters}>
                Clear all
              </button>
              {meta && <span className="ml-auto text-xs text-muted">{meta.total} match{meta.total === 1 ? "" : "es"}</span>}
            </div>
          )}
          </>)}
        </div>
      </header>

      {meta?.approvals?.can_approve && (
        <div id="rmg-approvals" className="scroll-mt-4">
          <RmgApprovalsStrip items={meta.approvals.items} onChanged={() => reloadAll(selectedId)} showToast={showToast} />
        </div>
      )}

      {/* "Submit to Sales" empties the moment the job is done — show what was
          handed over and where each candidate is now (29 Sep 2026). */}
      {task === "decide" && <HandedOverPanel reloadKey={board.data?.as_of} />}

      {error && <ErrorBox error={error} onRetry={() => void load()} />}

      {/* ---------------- queue + detail ---------------- */}
      {/* The Feedback-due view IS the panel above (30 Sep 2026): the queue only
          returns when a candidate is focused (a Dashboard / bell deep link). */}
      {!(feedbackView && selectedId == null) && (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section className="min-w-0 space-y-3" aria-label="Candidates by position">
          {loading && !rows.length ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
          ) : !rows.length ? (
            <div className="rounded-card border border-subtle bg-surface-1 shadow-raised">
              <EmptyState
                icon={<ClipboardCheck size={22} />}
                message={task && DESK_TASKS.has(task)
                  ? offDeskItems(activeCategory).length
                    ? <><b className="text-primary">No one in “{activeCategory?.label || "this task"}” is on the desk.</b><br />
                        {offDeskItems(activeCategory).length === 1 ? "The candidate has" : `All ${offDeskItems(activeCategory).length} have`} moved past screening — open them from the list above.</>
                    : <><b className="text-primary">Nothing left in “{activeCategory?.label || "this task"}”.</b><br />Pick another task above, or show every candidate.</>
                  : !activeFilters && tab === "pending"
                  ? <><b className="text-primary">Nothing waiting for screening.</b><br />New applicants appear here the moment TA applies them.</>
                  : !activeFilters && tab === "review"
                    ? <><b className="text-primary">Nobody in RMG review.</b><br />Shortlisted candidates land here once their AI L1 clears or you go manual.</>
                    : "No candidates match these filters."}
                action={activeFilters ? <button type="button" className={btnSecondary} onClick={clearFilters}>Clear filters</button> : undefined}
              />
            </div>
          ) : (
            <>
              {groups.map(({ position, rows: list, rid }) => (
                <PositionGroup
                  key={rid}
                  position={position}
                  fallback={list[0]}
                  rows={list}
                  open={!collapsed.has(rid)}
                  onToggle={() => setCollapsed((s) => { const n = new Set(s); if (n.has(rid)) n.delete(rid); else n.add(rid); return n; })}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  scoring={scoring}
                  scoreErrors={scoreErrors}
                  onPositionChanged={afterJdSaved}
                  showToast={showToast}
                />
              ))}
              {meta && meta.pages > 1 && (
                <div className="flex items-center justify-between rounded-card border border-subtle bg-surface-1 px-4 py-2 text-sm text-secondary">
                  <span>
                    {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} of {meta.total}
                  </span>
                  <span className="flex gap-1">
                    <button type="button" className={ICON_BTN} disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button>
                    <button type="button" className={ICON_BTN} disabled={page >= meta.pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
                  </span>
                </div>
              )}
            </>
          )}
        </section>

        <section className="min-w-0" aria-label="Selected candidate">
          {selected ? (
            <DetailPane
              key={selected.profile_id}
              row={selected}
              positionSkills={meta?.positions.find((p) => p.requirement_id === selected.requirement_id)?.skills || []}
              position={meta?.positions.find((p) => p.requirement_id === selected.requirement_id)}
              onPositionChanged={afterJdSaved}
              roundResults={meta?.round_results || []}
              scoring={scoring.has(selected.profile_id)}
              scoreError={scoreErrors[selected.profile_id]}
              onDecided={(msg) => afterDecision(msg, selected.profile_id)}
              onChanged={(msg) => { if (msg) showToast(msg); reloadAll(selected.profile_id); }}
              onError={(msg) => showToast(msg, "err")}
              showToast={showToast}
            />
          ) : !loading && rows.length ? null : (
            <div className="hidden rounded-card border border-dashed border-subtle p-10 text-center text-sm text-muted lg:block">
              Select a candidate to see their resume and ATS match.
            </div>
          )}
        </section>
      </div>
      )}
    </div>
  );
}

function bandOf(score: number, meta: DeskMeta | null): AtsBand {
  const t = meta?.ats_thresholds || { high: 70, medium: 50 };
  return score >= t.high ? "high" : score >= t.medium ? "medium" : "low";
}

/** The JD & skills dialog's view of a desk position. */
function jdReqOf(position: Position) {
  return {
    id: position.requirement_id, title: position.position_title, req_number: position.req_number,
    opportunity_opp_id: position.opp_id, status: position.requirement_status,
    description: position.description, rmg_jd_text: position.rmg_jd_text,
    skills: position.skills.map((s) => ({ skill_id: s.skill_id, is_mandatory: s.is_mandatory, min_rating: s.min_rating })),
  };
}

/* ---------------- one position ---------------- */

function PositionGroup({
  position, fallback, rows, open, onToggle, selectedId, onSelect, scoring, scoreErrors, onPositionChanged, showToast,
}: {
  position: Position | undefined;
  fallback: DeskRow;
  rows: DeskRow[];
  open: boolean;
  onToggle: () => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  scoring: Set<number>;
  scoreErrors: Record<number, string>;
  onPositionChanged: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const [editJd, setEditJd] = useState(false);
  const title = position?.position_title ?? fallback.position_title;
  const customer = position?.customer_name ?? fallback.customer_name;
  const pending = position?.pending ?? rows.filter((r) => r.rmg_screening_status === "Pending").length;
  const review = position?.review ?? rows.filter((r) => r.pipeline_status === "RMG_Review").length;
  const total = position?.count ?? rows.length;
  return (
    <div className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
      <div className="flex items-start justify-between gap-3 border-b border-subtle px-4 py-3">
        <button type="button" onClick={onToggle} aria-expanded={open} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <ChevronRight size={15} className={`shrink-0 text-muted transition-transform duration-micro ${open ? "rotate-90" : ""}`} aria-hidden />
            <span className="truncate text-sm font-bold text-primary">{title}</span>
          </div>
          <div className="mt-0.5 truncate pl-6 text-xs text-muted">
            {customer || "—"} · {fallback.opp_id} · {fallback.req_number}
            {position?.positions ? ` · ${position.positions} position${position.positions === 1 ? "" : "s"}` : ""}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {position?.jd_missing && (
            <button type="button" onClick={() => setEditJd(true)}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_CHIP.warn} hover:underline`}
              title="No JD and no skills on this position — the ATS has nothing to score against. Add them here.">
              <AlertTriangle size={11} /> Add JD &amp; skills
            </button>
          )}
          {position && !position.jd_missing && (
            <button type="button" onClick={() => setEditJd(true)} className="text-muted hover:text-brand-600" title="Edit the JD & skills" aria-label="Edit JD and skills">
              <Pencil size={13} />
            </button>
          )}
          {pending > 0 && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_CHIP.warn}`}>{pending} pending</span>}
          {review > 0 && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 dark:bg-surface-2">{review} in review</span>}
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">{total} total</span>
          <CrmLink
            to={`requirements/${fallback.requirement_id}?tab=resumes`}
            className="text-muted hover:text-brand-600"
            title="Open this position's Applied Candidates tab"
          >
            <ExternalLink size={14} />
          </CrmLink>
        </div>
      </div>
      {open && (
        <ul className="divide-y divide-subtle">
          {rows.map((r) => (
            <li key={r.profile_id}>
              <QueueRow
                row={r}
                active={r.profile_id === selectedId}
                onSelect={() => onSelect(r.profile_id)}
                scoring={scoring.has(r.profile_id)}
                scoreError={scoreErrors[r.profile_id]}
              />
            </li>
          ))}
        </ul>
      )}
      {editJd && position && (
        <JdSkillsModal
          req={jdReqOf(position)}
          onClose={() => setEditJd(false)}
          onSaved={() => onPositionChanged()}
          toast={showToast}
        />
      )}
    </div>
  );
}

function QueueRow({ row, active, onSelect, scoring, scoreError }: {
  row: DeskRow; active: boolean; onSelect: () => void; scoring: boolean; scoreError?: string;
}) {
  const fit = fitsBand(row.experience_years, row.exp_min, row.exp_max);
  const fresh = (row.new_results || []).length > 0;
  return (
    <button
      type="button"
      id={`desk-row-${row.profile_id}`}
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={`flex w-full scroll-mt-24 items-center gap-3 px-4 py-3 text-left transition-colors duration-micro ${
        active ? "bg-brand-50 dark:bg-surface-2" : fresh ? "bg-success-soft hover:bg-surface-2" : "hover:bg-surface-2"}`}
    >
      <span className={`h-9 w-1 shrink-0 rounded-full ${active ? "bg-brand-600" : "bg-transparent"}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-semibold text-primary">{row.candidate_name}</span>
          {row.internal && <InternalChip employee={row.internal} />}
          {fresh && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-[11px] font-bold text-white"
              title="An interview finished — open the report and mark it reviewed">
              <Sparkles size={10} aria-hidden /> New result
            </span>
          )}
          {row.rmg_screening_status && row.rmg_screening_status !== "Pending" && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              row.rmg_screening_status === "Shortlisted" ? STATE_CHIP.ok : STATE_CHIP.bad}`}>{row.rmg_screening_status}</span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
          <span className={fit === false ? "text-warning" : undefined} title={fit === false ? "Outside the position's experience band" : undefined}>
            {years(row.experience_years)}
          </span>
          <span>Notice {row.notice_period || "—"}</span>
          <span>{lakh(row.current_ctc)} → {lakh(row.expected_ctc)}</span>
          <span>{row.ta_owner_name || "—"} · {waited(row.waiting_days)}</span>
        </div>
        {row.next_step && row.next_step.key !== "wait" && row.next_step.key !== "rejected" && (
          <div className={`mt-1 flex items-center gap-1 text-[11px] font-semibold ${
            row.next_step.tone === "bad" ? "text-danger" : row.next_step.tone === "ok" ? "text-success"
              : row.next_step.owner === "you" ? "text-warning" : "text-muted"}`}>
            <ArrowRight size={11} aria-hidden /> {row.next_step.label}
          </div>
        )}
      </div>
      <AtsCell row={row} scoring={scoring} error={scoreError} />
    </button>
  );
}

function AtsCell({ row, scoring, error }: { row: DeskRow; scoring: boolean; error?: string }) {
  if (row.ats_score != null) return <ScoreIndicator score={row.ats_score} size="md" showLabel={false} />;
  if (scoring) {
    return <span className="inline-flex items-center gap-1 text-xs text-info"><RefreshCw size={12} className="animate-spin motion-reduce:animate-none" /> ATS…</span>;
  }
  if (!row.has_cv) return <span className="text-xs text-muted" title="No resume or CV on file">No CV</span>;
  return <span className="text-xs text-warning" title={error || "Not scored yet"}>{error ? "Not scored" : "—"}</span>;
}

/* ---------------- the selected candidate ---------------- */

/** A row's route facts right after Shortlist, before the list reloads — the
 *  server row still says Pending, so the choice is opened from here. */
const ROUTE_OPEN: InterviewRoute = {
  chosen: null, open: true, ai_interview_status: null, ai_effective_result: null,
  ai_overall_score_percent: null, manual_l1_requested: false, manual_l1_scheduled: false,
  manual_l1_result: null,
};

const STEP_OWNER: Record<NextStep["owner"], string> = {
  you: "Your move", TA: "With TA", candidate: "With the candidate", AI: "AI", done: "",
};

/** The one-line "what now" banner (server `next_step`). */
function NextStepBanner({ step, override }: { step: NextStep | null | undefined; override?: NextStep }) {
  const s = override || step;
  if (!s || s.key === "wait") return null;
  const tone = s.tone === "none" ? "info" : s.tone;
  const cls = tone === "ok" ? "border-success/40 bg-success-soft text-success"
    : tone === "bad" ? "border-danger/40 bg-danger-soft text-danger"
    : tone === "warn" ? "border-warning/40 bg-warning-soft text-warning"
    : "border-subtle bg-surface-2 text-secondary";
  return (
    <div className={`mt-3 flex flex-wrap items-center gap-2 rounded-control border px-3 py-2 text-sm font-semibold ${cls}`} aria-live="polite">
      <ArrowRight size={14} aria-hidden />
      <span className="flex-1">{s.label}</span>
      {STEP_OWNER[s.owner] && <span className="rounded-full bg-surface-1 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted">{STEP_OWNER[s.owner]}</span>}
    </div>
  );
}

/** "Interview done — review it" (28 Sep 2026): every finished interview on
 *  this candidate that no screener has marked reviewed. The row stays
 *  highlighted (and in the "Results to review" task) until Mark reviewed. */
function ResultsReviewBanner({ row, onReviewed, onError }: {
  row: DeskRow; onReviewed: (msg: string) => void; onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const results = row.new_results || [];
  if (!results.length) return null;
  const markReviewed = async () => {
    setBusy(true);
    try {
      const res = await crmPost<{ marked: number }>("/api/screening-desk/results-reviewed", { profile_id: row.profile_id });
      onReviewed(res.message || "Marked reviewed");
    } catch (e: any) {
      onError(e?.message || "Could not mark it reviewed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 rounded-control border border-success bg-success-soft px-3 py-2.5" role="status">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles size={15} className="text-success" aria-hidden />
        <b className="text-sm text-success">Interview done — review the result</b>
        <button type="button" className={`${btnPrimary} ml-auto !py-1 text-xs`} disabled={busy} onClick={() => void markReviewed()}>
          <Check size={13} /> {busy ? "Saving…" : "Mark reviewed"}
        </button>
      </div>
      <ul className="mt-2 space-y-1.5">
        {results.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center gap-2 text-xs text-secondary">
            <span className="font-bold text-primary">{r.label}</span>
            <span className={`rounded-full px-2 py-0.5 font-bold ${r.passed ? STATE_CHIP.ok : STATE_CHIP.bad}`}>
              {r.result}{r.score != null ? ` · ${Math.round(r.score)}%` : ""}
            </span>
            {r.when && <span className="text-muted">{fmtDateTime12(r.when)}</span>}
            {r.by && <span className="text-muted">· {r.by}</span>}
            <CrmLink to={`profiles/${row.profile_id}?tab=${r.kind === "ai" ? "ai" : "interviews"}`}
              className="ml-auto font-semibold text-brand-600 hover:underline">
              Open report <ExternalLink size={11} className="inline" aria-hidden />
            </CrmLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetailPane({ row, positionSkills, position, onPositionChanged, roundResults, scoring, scoreError, onDecided, onChanged, onError, showToast }: {
  row: DeskRow;
  positionSkills: Position["skills"];
  /** The position's header data — for "Add JD & skills" beside a failed score. */
  position?: Position;
  onPositionChanged: () => void;
  roundResults: string[];
  scoring: boolean;
  scoreError?: string;
  /** The row leaves this tab — reload and move to the next candidate. */
  onDecided: (message: string) => void;
  /** Something on this candidate changed — reload, keep the selection. */
  onChanged: (message?: string) => void;
  onError: (message: string) => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  /* Shortlist + route in ONE click (30 Sep 2026, user ask): "Shortlist for AI
     round" / "Shortlist for manual L1 round" → the same screening POST plus the
     route call; the old bare shortlist (then the route card) is gone from here. */
  const [decision, setDecision] = useState<{ kind: "Shortlisted" | "Rejected"; route?: ShortlistRoute } | null>(null);
  const [verdict, setVerdict] = useState<"sales" | "reject" | null>(null);
  const [showSkills, setShowSkills] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [editJd, setEditJd] = useState(false);
  /* Shortlisted a moment ago (26 Sep 2026): hold the reload until RMG / GM picks
     the interview route — AI L1 or manual L1 — or says "later". Otherwise the
     row vanished from the Pending tab and the question was never asked. */
  const [shortlistedMsg, setShortlistedMsg] = useState<string | null>(null);
  const routeOpen = shortlistedMsg != null || !!row.interview_route?.open;
  const reqBand = band(row.exp_min, row.exp_max);
  const fit = fitsBand(row.experience_years, row.exp_min, row.exp_max);
  const ats = row.ats;
  const pending = row.rmg_screening_status === "Pending";
  const shortlisted = row.rmg_screening_status === "Shortlisted";
  const inReview = row.pipeline_status === "RMG_Review";
  const canDecide = pending || row.rmg_screening_status == null || row.rmg_screening_status === "Rejected"
    || (shortlisted && row.pipeline_status === "Sourcing");
  const showLadder = (shortlisted && !shortlistedMsg && !routeOpen) || inReview;
  const decide = row.decision;

  return (
    <div className="space-y-4 lg:sticky lg:top-2">
      {/* identity + next step + primary actions */}
      <div className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-primary">{row.candidate_name}</h2>
              <CandidateStatusBadge status={row.profile_status} stage={row.pipeline_status} />
              {row.internal && <InternalChip employee={row.internal} />}
            </div>
            <p className="mt-0.5 text-sm text-secondary">
              {displayEmail(row.email)}{row.phone ? ` · ${row.phone}` : ""}{row.location ? ` · ${row.location}` : ""}
            </p>
            <p className="mt-1 text-xs text-muted">
              Applied for <b className="text-secondary">{row.position_title}</b> · {row.customer_name || "—"} ·{" "}
              <CrmLink to={`opportunities/${row.opportunity_id}`} className="font-semibold text-brand-600 hover:underline">{row.opp_id}</CrmLink>
            </p>
          </div>
          <CrmLink to={`profiles/${row.profile_id}`} className={`${btnSecondary} !py-1.5 text-xs`}>
            Full profile <ExternalLink size={13} />
          </CrmLink>
        </div>

        <ResultsReviewBanner row={row} onReviewed={(msg) => onChanged(msg)} onError={onError} />

        <NextStepBanner step={row.next_step} override={shortlistedMsg ? { key: "route", label: "Choose the interview route — AI L1 or manual L1", owner: "you", tone: "warn" } : undefined} />

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Fact k="Experience" v={years(row.experience_years)}
            sub={reqBand ? `Needs ${reqBand}` : undefined} tone={fit == null ? undefined : fit ? "ok" : "warn"} />
          <Fact k="Notice period" v={row.notice_period || "—"} />
          <Fact k="Current CTC" v={lakh(row.current_ctc)} />
          <Fact k="Expected CTC" v={lakh(row.expected_ctc)} />
          <Fact k="Applied by" v={row.ta_owner_name || "—"} />
          <Fact k="Waiting" v={waited(row.waiting_days)} tone={row.waiting_days != null && row.waiting_days > 2 && pending ? "warn" : undefined} />
          <Fact k="Domain" v={row.technical_domain || "—"} />
          <Fact k="Screening" v={shortlistedMsg ? "Shortlisted" : row.rmg_screening_status || "Not gated"} />
        </div>

        {routeOpen && (
          <div className="mt-4">
            <InterviewRouteChoice
              profileId={row.profile_id}
              candidate={{ full_name: row.candidate_name, email: row.email }}
              route={shortlistedMsg ? ROUTE_OPEN : row.interview_route}
              showToast={showToast}
              onDone={() => onDecided(shortlistedMsg || "Interview route chosen")}
            />
            {shortlistedMsg && (
              <button type="button" className={`${btnSecondary} mt-2 !py-1.5 text-xs`}
                onClick={() => onDecided(shortlistedMsg)}>
                Decide the route later
              </button>
            )}
          </div>
        )}

        {row.rmg_screening_note && !pending && (
          <p className="mt-3 rounded-control bg-surface-2 px-3 py-2 text-xs text-secondary">
            <b>Screening note:</b> {row.rmg_screening_note}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2 border-t border-subtle pt-4">
          {canDecide && !shortlistedMsg && row.rmg_screening_status !== "Shortlisted" && (
            <>
              <button type="button" className={FLOW_BTN.ai} onClick={() => setDecision({ kind: "Shortlisted", route: "ai" })}
                title="Shortlist and put the candidate on the AI L1 — TA schedules it">
                <Bot size={15} /> Shortlist for AI round
              </button>
              <button type="button" className={FLOW_BTN.manual} onClick={() => setDecision({ kind: "Shortlisted", route: "manual" })}
                title="Shortlist and ask for a manual Technical L1 — TA books it">
                <Users size={15} /> Shortlist for manual L1 round
              </button>
            </>
          )}
          {/* RMG review's own decision (28 Sep 2026): the hand-off to Sales, or
              the rejection — the same rule as the requirement page: the ladder
              must be judged first. */}
          {inReview && decide?.can_decide && (
            <>
              <button type="button" className={btnPrimary} disabled={!!decide.blocked} onClick={() => setVerdict("sales")}
                title={decide.blocked ? `${decide.blocked} — Sales only sees candidates the ladder has cleared` : "RMG review complete — hand the candidate to the Sales team"}>
                <Send size={15} /> Submit to Sales
              </button>
              <button type="button" className={btnDanger} onClick={() => setVerdict("reject")} title="Close the candidate at RMG review">
                <X size={15} /> Reject
              </button>
              {decide.blocked && <span className="self-center text-xs text-warning">{decide.blocked}</span>}
            </>
          )}
          <FastTrackButton
            profileId={row.profile_id}
            candidateName={row.candidate_name}
            employee={row.internal}
            block={row.fast_track_block}
            onDone={onDecided}
            onError={onError}
            className={btnSecondary}
          />
          {/* A close match for the position goes straight to Sales for the customer
              round (30 Sep 2026, user ask) — for any candidate, not only internal;
              hidden once the ladder is being judged (the in-review verdict covers it). */}
          {!inReview && !row.internal && (
            <DirectToSalesButton
              profileId={row.profile_id}
              candidateName={row.candidate_name}
              context={row.opportunity_title || null}
              block={row.direct_to_sales_block}
              onDone={onDecided}
              className={FLOW_BTN.success}
            />
          )}
          {canDecide && !shortlistedMsg && row.rmg_screening_status !== "Rejected" && (
            <button type="button" className={FLOW_BTN.danger} onClick={() => setDecision({ kind: "Rejected" })}>
              <X size={15} /> Reject
            </button>
          )}
        </div>
      </div>

      {/* interview ladder — once the screening is cleared */}
      {showLadder && (
        <InterviewLadder
          profileId={row.profile_id}
          candidate={{ full_name: row.candidate_name, email: row.email }}
          stage={row.pipeline_status}
          ai={row.ai_l1}
          rounds={row.rounds}
          resultsScale={roundResults}
          onChanged={onChanged}
          showToast={showToast}
        />
      )}

      {/* ATS */}
      <div className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-primary">ATS match</h3>
          {row.ats_score != null && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_CHIP[BAND_TONE[row.ats_band]]}`}>
              {row.ats_band === "high" ? "High ATS band" : row.ats_band === "medium" ? "Medium ATS band" : "Low ATS band"}
            </span>
          )}
        </div>
        {row.ats_score != null ? (
          <div className="mt-3 flex flex-col gap-4 sm:flex-row">
            <ScoreIndicator score={row.ats_score} size="lg" />
            <div className="min-w-0 flex-1 space-y-3 text-sm">
              {ats ? (
                <>
                  <ChipRow label="Skills matched" items={ats.skills_matched} tone="ok" empty="None of the required skills found" />
                  <ChipRow label="Skills missing" items={ats.skills_missing} tone="bad" empty="Nothing missing" />
                  <p className="text-xs text-muted">
                    {ats.jd_keywords_total > 0 && <>JD keywords {ats.jd_keywords_matched}/{ats.jd_keywords_total} · </>}
                    Experience found {ats.experience_years != null ? `${ats.experience_years} yrs` : "—"}
                    {ats.experience_match === false ? " (outside the band)" : ""}
                  </p>
                  {ats.ai_summary && <p className="rounded-control bg-surface-2 px-3 py-2 text-xs text-secondary">{ats.ai_summary}</p>}
                </>
              ) : (
                <p className="text-xs text-muted">Scored — open the position for the full breakdown.</p>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">
            {scoring ? "Scoring this resume now…"
              : !row.has_cv ? "No resume or CV on file — ask the TA to upload one on the candidate's record."
                : scoreError ? <span className="text-warning">Could not score: {scoreError}</span>
                  : "Waiting to be scored."}
          </p>
        )}
        {row.ats_score == null && row.has_cv && position && (scoreError || position.jd_missing) && (
          <div className={`mt-3 flex flex-wrap items-center gap-2 rounded-control px-3 py-2 text-xs ${STATE_CHIP.warn}`}>
            <AlertTriangle size={13} aria-hidden />
            <span className="min-w-0 flex-1">
              {position.jd_missing
                ? "This position has no JD and no skills, so the ATS has nothing to score against."
                : "Add or fix the position's JD and skills, then the ATS scores again."}
            </span>
            <button type="button" onClick={() => setEditJd(true)} className={`${FLOW_BTN.warn} !px-2.5 !py-1`}>
              <FileText size={12} /> Add JD (Word / PDF) &amp; skills
            </button>
          </div>
        )}
        {editJd && position && (
          <JdSkillsModal
            req={jdReqOf(position)}
            onClose={() => setEditJd(false)}
            onSaved={() => { setEditJd(false); onPositionChanged(); }}
            toast={showToast}
          />
        )}
      </div>

      {/* skill evaluation — collapsed until the rounds start */}
      {shortlisted && (
        <Collapsible label="Skill evaluation" hint="Rate what you heard in the rounds" open={showSkills || inReview} onToggle={() => setShowSkills((v) => !v)} icon={<ListChecks size={15} />}>
          <SkillEvalGrid profileId={row.profile_id} positionSkills={positionSkills} showToast={showToast} />
        </Collapsible>
      )}

      {/* resume */}
      <div className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="flex items-center justify-between border-b border-subtle px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-primary"><FileText size={15} /> Resume</h3>
        </div>
        <div className="p-3">
          {row.resume_url
            ? <FilePreviewPane url={row.resume_url} title={`${row.candidate_name} — resume`} />
            : <p className="p-6 text-center text-sm text-muted">No resume or CV on file.</p>}
        </div>
      </div>

      <Collapsible label="History" hint="Every step on this candidate" open={showActivity} onToggle={() => setShowActivity((v) => !v)} icon={<History size={15} />}>
        <ActivityCard profileId={row.profile_id} />
      </Collapsible>

      {decision && (
        <ScreeningDecisionModal
          profileId={row.profile_id}
          candidateName={row.candidate_name}
          position={row.position_title}
          taName={row.ta_owner_name}
          decision={decision.kind}
          route={decision.route}
          onClose={() => setDecision(null)}
          onDone={(msg) => {
            const routed = !!decision.route;
            setDecision(null);
            // With the route chosen on the same click the row moves on; a bare
            // shortlist (no route) still asks the route question next.
            if (decision.kind === "Shortlisted" && !routed) { showToast(msg); setShortlistedMsg(msg); }
            else onDecided(msg);
          }}
        />
      )}
      {verdict && (
        <VerdictModal
          row={row}
          verdict={verdict}
          onClose={() => setVerdict(null)}
          onDone={(msg) => { setVerdict(null); onDecided(msg); }}
          onError={onError}
        />
      )}
    </div>
  );
}

function Collapsible({ label, hint, icon, open, onToggle, children }: {
  label: string; hint?: string; icon: React.ReactNode; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  if (open) {
    return (
      <div>
        <button type="button" className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted hover:text-primary" onClick={onToggle} aria-expanded>
          <ChevronDown size={13} /> Hide {label.toLowerCase()}
        </button>
        {children}
      </div>
    );
  }
  return (
    <button type="button" onClick={onToggle} aria-expanded={false}
      className="flex w-full items-center justify-between gap-3 rounded-card border border-dashed border-subtle bg-surface-1 px-4 py-3 text-left text-sm hover:bg-surface-2">
      <span className="flex items-center gap-2 font-semibold text-primary">{icon} {label}</span>
      <span className="flex items-center gap-2 text-xs text-muted">{hint}<ChevronRight size={14} /></span>
    </button>
  );
}

type ActivityRow = { id: number; username: string | null; action_type: string; comment: string | null; timestamp: string | null };

function ActivityCard({ profileId }: { profileId: number }) {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    crmGet<ActivityRow[]>(`/api/candidate-profiles/${profileId}/activity-log`)
      .then((r) => { if (alive) setRows((r.data || []).slice().reverse()); })
      .catch((e: any) => { if (alive) setError(e?.message || "Could not load the history"); });
    return () => { alive = false; };
  }, [profileId]);
  return (
    <div className="rounded-card border border-subtle bg-surface-1 shadow-raised">
      {error ? <p className="p-4 text-sm text-danger">{error}</p>
        : rows == null ? <p className="p-4 text-sm text-muted">Loading…</p>
        : rows.length === 0 ? <p className="p-4 text-sm text-muted">Nothing yet.</p>
        : (
          <ul className="max-h-80 divide-y divide-subtle overflow-y-auto">
            {rows.map((r) => (
              <li key={r.id} className="px-4 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 font-semibold text-secondary">{r.action_type.replace(/_/g, " ")}</span>
                  <span className="text-muted">{fmtDateTime12(r.timestamp)}{r.username ? ` · ${r.username}` : ""}</span>
                </div>
                {r.comment && <p className="mt-1 text-secondary">{r.comment}</p>}
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

/** RMG review's decision: hand over to Sales, or reject (both a status transition). */
function VerdictModal({ row, verdict, onClose, onDone, onError }: {
  row: DeskRow; verdict: "sales" | "reject";
  onClose: () => void; onDone: (message: string) => void; onError: (message: string) => void;
}) {
  const sales = verdict === "sales";
  const [comment, setComment] = useState("");
  /* Submit to Sales comes pre-written from the interviews (28 Sep 2026) — the
     rounds, AI L1 and skill ratings; edit it or send it as it is. Only fills
     an EMPTY field, so it never overwrites what was typed while it loaded. */
  const handover = useHandoverNote(row.profile_id, sales);
  const [prefilled, setPrefilled] = useState("");
  useEffect(() => {
    if (!handover.note) return;
    setComment((c) => (c.trim() ? c : handover.note));
    setPrefilled(handover.note);
  }, [handover.note]);
  const [askNotice, setAskNotice] = useState(!row.notice_period);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (comment.trim().length < MIN_REJECT_NOTE) {
      setErr(`A ${sales ? "comment" : "reason"} of at least ${MIN_REJECT_NOTE} characters is required`);
      return;
    }
    setBusy(true);
    try {
      const res = await crmPost(`/api/candidate-profiles/${row.profile_id}/status-transition`, {
        new_status: sales ? "Sales_Screening" : "RMG_Rejected",
        comment: comment.trim(),
        ask_notice_period: sales && askNotice,
      });
      onDone(res.message || (sales ? "Submitted to the Sales team" : "Candidate rejected"));
    } catch (e: any) {
      onError(e?.message || "Could not record the decision");
      setBusy(false);
    }
  };
  return (
    <Modal title={sales ? `Submit ${row.candidate_name} to Sales` : `Reject ${row.candidate_name}`} medium
      onClose={() => { if (!busy) onClose(); }} dirty={comment.trim().length > 0 && comment !== prefilled}
      hero={<RmgVerdictHero sales={sales} name={row.candidate_name} position={row.position_title} />}
      footer={<DialogActions tone={sales ? "emerald" : "rose"} icon={sales ? Send : X} busy={busy}
        label={sales ? "Submit to Sales" : "Reject candidate"} onCancel={onClose} onConfirm={() => void submit()} />}>
      <div className="space-y-4">
        <p className="text-sm text-secondary">
          {sales
            ? <>Sales takes over for <b>{row.position_title}</b> — they screen and submit the candidate to {row.customer_name || "the customer"}. Your rounds and feedback travel with the profile.</>
            : <>Closes the candidate at RMG review for <b>{row.position_title}</b>. The TA ({row.ta_owner_name || "TA"}) is told why.</>}
        </p>
        {sales && (
          <SalesReadinessPanel profileId={row.profile_id} checks={handover.checks}
            onChecks={handover.setChecks} onError={onError} />
        )}
        <Field label={sales ? "Your recommendation to Sales" : "Reason"} required error={err}>
          <textarea className={`${inputCls}${err ? " input-error" : ""}`} rows={sales ? 7 : 4} value={comment}
            onChange={(e) => { setComment(e.target.value); setErr(""); }}
            placeholder={sales
              ? (handover.loading ? "Writing the summary from the interviews…" : "Strengths, level, anything Sales should position with the customer")
              : "Why is this candidate not going forward?"} />
        </Field>
        {sales && prefilled && (
          <p className="-mt-2 text-xs text-muted">
            Written from the recorded interviews and skill ratings — edit anything before you submit.
          </p>
        )}
        {sales && (
          <label className="flex items-start gap-2 text-sm text-secondary">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-strong" checked={askNotice} onChange={(e) => setAskNotice(e.target.checked)} />
            <span>Ask the TA to collect the notice period now{row.notice_period ? "" : " — it is not on file"}</span>
          </label>
        )}
      </div>
    </Modal>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted">
      {label}
      {children}
    </label>
  );
}

function Fact({ k, v, sub, tone }: { k: string; v: React.ReactNode; sub?: string; tone?: StateTone }) {
  return (
    <div className="rounded-control border border-subtle bg-surface-2 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">{k}</div>
      <div className={`mt-0.5 truncate text-sm font-semibold ${tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : "text-primary"}`}>{v}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function ChipRow({ label, items, tone, empty }: { label: string; items: string[]; tone: "ok" | "bad"; empty: string }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{label}</div>
      {items.length ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((s) => <span key={s} className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_CHIP[tone]}`}>{s}</span>)}
        </div>
      ) : <span className="text-xs text-muted">{empty}</span>}
    </div>
  );
}

