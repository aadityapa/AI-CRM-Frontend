/** Candidate master pages: searchable list + detail with personal info,
 * education, experience, skills and linked candidate-profiles tabs. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Briefcase, Building2, CalendarDays, Check, ChevronRight, Clock, FileBadge, FileText, GraduationCap, IndianRupee, Linkedin,
  ListChecks, Mail, MapPin, MessageCircle, MessageSquarePlus, MoreHorizontal, Pencil, Phone, Plus, Sparkles, Trash2,
  Target, UserRound, Users, Wallet, Wand2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut, crmUpload, qs } from "../api";
import { fetchAllMaster } from "../lib/fetchAllMaster";
import type { Meta } from "../api";
import { ApplyToOpportunityModal } from "../components/ApplyToOpportunityModal";
import { displayEmail, isPlaceholderEmail } from "../lib/candidateEmail";
import { useHasRole, useMe } from "../CrmApp";
import { useCanAct, useCrmAccess } from "../useAccess";
import { CrmLink, crmNavigate, useCrmParams } from "../routerHooks";
import { HERO_BTN, HERO_BTN_SOLID, PageHeader } from "../components/PageHeader";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { RowActions, afterListDelete } from "../components/RowActions";
import { FileLink, FileUploadButton } from "../components/FileUpload";
import {
  ConfirmModal,
  EmptyState,
  ErrorBox,
  Modal,
  Spinner,
  StatusBadge,
  btnPrimary,
  btnSecondary,
  inputCls,
  useToast,
} from "../components/ui";
import { TeachingEmpty } from "../components/TeachingEmpty";
import { CandidateStatusBadge } from "../components/CandidateStatusBadge";
import { MatchingPositionsTab, ResumeLibraryTab } from "../components/ResumeLibrary";
import type { CandidateStatus } from "../components/CandidateStatusBadge";
import {
  SectionHeaderBanner, WizardField, WizardFooter, WizardGroup, WizardShell, WizardStepCard,
  WizardTopBar, type StepStatus, type WizardStep,
} from "../components/wizard";
import { Chips, NOTICE_CHIPS, ResumeDropZone } from "../components/UploadResumeModal";
import { PhoneField } from "../components/PhoneField";
import { fmtDateTime12 } from "../../lib/datetime";
import { usePageTab, useSessionState } from "../lib/pageState";

/** Local single-screen shell — applies the shared wizard look
 * (theme-aware body + SectionHeaderBanner) inside the existing Modal.
 * Visual-only wrapper: no field, state, or submit logic lives here. */
function WizFormShell({
  title, subtitle, icon, children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="crm-wizard wiz-noise min-h-full w-full bg-[color:var(--wiz-bg)] px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-3xl">
        <SectionHeaderBanner title={title} description={subtitle} icon={icon} />
        {children}
      </div>
    </div>
  );
}

/* Shared footer container for the reskinned single-screen dialogs. */
const wizFooterRow = "mt-6 flex items-center gap-3 border-t border-[color:var(--wiz-border)] pt-5";

/* ------------------------------------------------------------------ types */

type Candidate = {
  created_by_id?: number | null;
  created_by_name?: string | null;
  id: number;
  salutation?: string | null;
  first_name: string;
  middle_name?: string | null;
  last_name?: string | null;
  full_name?: string;
  email: string;
  phone?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  experience_years?: number | null;
  notice_period?: string | null;
  current_address?: string | null;
  permanent_address?: string | null;
  technical_domain?: string | null;
  roles?: string | null;
  designation_id?: number | null;
  cv_url?: string | null;
  linkedin_url?: string | null;
  resignation_status?: boolean;
  last_working_day?: string | null;
  resignation_certificate_url?: string | null;
  current_ctc?: number | null;
  expected_ctc?: number | null;
  preferred_location_id?: number | null;
  /** --- Zoho NEXUS export fields --- */
  zoho_candidate_id?: string | null;
  city?: string | null;
  /** Full preferred-location list; preferred_location_id is the primary one. */
  preferred_locations?: string | null;
  recruiter_email?: string | null;
  cv_original_filename?: string | null;
  source_created_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type Education = {
  id: number;
  course: string;
  institution?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  certificate_url?: string | null;
};

type Experience = {
  id: number;
  company_name: string;
  job_title?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  certificate_url?: string | null;
  is_current?: boolean;
};

/** One application by this candidate — the opportunity they applied to and how far
 * it got. Sourced from GET /api/candidates/{id} → profiles[]. */
type LinkedProfile = {
  id: number;
  opportunity_id: number;
  opportunity_opp_id?: string | null;
  opportunity_title: string;
  customer_name?: string | null;
  pipeline_status: string;
  /** The derived status every screen shows (server-side). */
  candidate_status?: CandidateStatus | null;
  expected_ctc?: number | null;
  applied_on?: string | null;
  ta_owner_name?: string | null;
  interview_rounds?: number;
};

type CandidateDetail = Candidate & {
  education: Education[];
  experience: Experience[];
  skills: { skill_id: number; name: string }[];
  profiles: LinkedProfile[];
};

type SkillOpt = { id: number; name: string; category?: string | null };
type DesignationOpt = { id: number; name: string };
type LocationOpt = { id: number; city: string; state?: string | null; country: string };

type OutreachEntry = {
  id: number;
  channel: string; // Call | Email | WhatsApp | LinkedIn | Other
  note: string;
  outcome?: string | null;
  requirement_id?: number | null;
  username: string;
  created_at: string;
};

const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : "—");
const fmtDateTime = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : fmtDateTime12(d);
};
/** CTC is stored in rupees; recruiters read and quote it in lakhs. 2200000 -> "22.00". */
const LAKH = 100000;
const fmtLac = (v?: number | null) =>
  v === null || v === undefined ? "—" : (Number(v) / LAKH).toFixed(2);
/** Lakhs typed into a form -> rupees for the API. */
const lacToRupees = (v: string) => (v === "" ? null : Math.round(Number(v) * LAKH));
/** Rupees from the API -> lakhs for a form field. */
const rupeesToLac = (v?: number | null) =>
  v === null || v === undefined ? "" : String(Number(v) / LAKH);

/** A CTC read off a RESUME -> the value a "(Lac)" input expects.
 *
 * Mirrors services/ctc.py::parse_ctc_to_rupees. A CV writes the same salary as
 * "12 LPA", "12,00,000", "₹12L" or "1.2 Cr"; pasting the raw digits into a Lac
 * field multiplied it by 100,000 on save (2 Sep 2026: ₹1,00,00,00,000 on the
 * Applicants tab). Explicit units win; a bare number under 1,000 is already
 * lakhs. Returns "" when it cannot be read confidently — better blank than wrong.
 */
const ctcToLacInput = (raw: unknown): string => {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) return "";
  const m = text.replace(/\s/g, "").match(/(\d+(?:[.,]\d+)*)/);
  if (!m) return "";
  const num = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(num) || num <= 0) return "";
  let lakhs: number;
  if (/\bcr\b|crore/.test(text)) lakhs = num * 100;
  else if (/lpa|lakh|lacs?\b|\bl\b|\dl\b/.test(text)) lakhs = num;
  else if (/\bk\b|thousand|\dk\b/.test(text)) lakhs = (num * 1000) / LAKH;
  else if (num < 1000) lakhs = num;          // "12" on a CV means 12 LPA
  else lakhs = num / LAKH;                   // already rupees
  if (!(lakhs > 0) || lakhs > 5000) return ""; // > ₹50 crore = a unit slip
  return String(Number(lakhs.toFixed(2)));
};
const candName = (c: Candidate) => c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ");
const AVATAR_TONES = [
  "from-sky-500 to-indigo-600", "from-emerald-500 to-teal-600", "from-amber-500 to-orange-600",
  "from-violet-500 to-fuchsia-600", "from-rose-500 to-pink-600", "from-cyan-500 to-blue-600",
];
/** A stable gradient per name (the list avatar). */
const avatarTone = (name: string) => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
};
const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const locLabel = (l: LocationOpt) => [l.city, l.state, l.country].filter(Boolean).join(", ");

const WRITE_ROLES = ["TA", "RMG", "Sales", "Sales_Head", "HR"];
const OUTREACH_WRITE_ROLES = ["TA", "Sales", "Sales_Head", "RMG", "HR"];
const OUTREACH_CHANNELS = ["Call", "Email", "WhatsApp", "LinkedIn", "Other"];

/* Token focus ring (tokens.css) — applied to every NEW interactive element on this page. */
const focusRing = "focus-visible:outline-none focus-visible:shadow-focus-ring";

const CHANNEL_ICONS: Record<string, React.ComponentType<{ size?: number | string; className?: string }>> = {
  Call: Phone,
  Email: Mail,
  WhatsApp: MessageCircle,
  LinkedIn: Linkedin,
  Other: MoreHorizontal,
};

/** Load a master-data list once (first 100 entries — plenty for selects). */
function useMaster<T = any>(path: string): T[] {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    // Page through: `limit` is clamped to 100 server-side, so a single request
    // silently truncated masters that have grown past that (skills, locations).
    fetchAllMaster<T>(path)
      .then(setItems)
      .catch(() => {});
  }, [path]);
  return items;
}

/* ------------------------------------------------------------------ list page */

export function CandidatesListPage() {
  const canWrite = useHasRole(...WRITE_ROLES);
  // Roles allowed to create a Candidate Profile (POST /api/candidate-profiles).
  const canApply = useCanAct("profiles", "create", useHasRole("TA", "Sales", "RMG"));
  const skills = useMaster<SkillOpt>("/api/skills?is_active=true");

  const [rows, setRows] = useState<Candidate[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useSessionState("cand.page", 1);
  const [search, setSearch] = useSessionState("cand.search", "");
  const [skillId, setSkillId] = useState("");
  // "" = all, "yes" = resume on file, "no" = still missing a CV
  const [hasCv, setHasCv] = useState("");
  /* "Added by" TA + added-date window (11 Sep 2026, TA request) — server-side. */
  const [createdBy, setCreatedBy] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [creators, setCreators] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    crmGet<{ id: string; name: string }[]>("/api/candidates/creators")
      .then((r) => setCreators(r.data || []))
      .catch(() => { /* degrades to "Added by — anyone" */ });
  }, []);
  const [domain, setDomain] = useState("");
  const [debounced, setDebounced] = useState({ search: "", domain: "" });
  const [showCreate, setShowCreate] = useState(false);
  /* Bulk ZIP → talent pool (31 Aug 2026). Background job + polling, exactly
     like the requirement bulk upload: one AI parse per resume is minutes for
     a full zip, so the button reports "Processing 23/50…". */
  const [zipBusy, setZipBusy] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);
  const [zipResult, setZipResult] = useState<{
    created: { file: string; candidate_id: number; name: string; email?: string;
      no_email?: boolean; name_match?: { candidate_id: number; name: string } | null }[];
    enriched: { file: string; candidate_id: number; name: string; email?: string; filled: number }[];
    failed: { file: string; reason: string }[];
    total: number;
  } | null>(null);
  const [applyFor, setApplyFor] = useState<Candidate | null>(null);
  const [toast, showToast] = useToast();

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebounced({ search, domain });
      setPage(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [search, domain]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<Candidate[]>(
        `/api/candidates${qs({
          page,
          limit: 20,
          search: debounced.search,
          skill_id: skillId,
          technical_domain: debounced.domain,
          has_cv: hasCv === "" ? undefined : hasCv === "yes",
          created_by_id: createdBy || undefined,
          created_from: createdFrom || undefined,
          created_to: createdTo || undefined,
        })}`,
      );
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load candidates");
    } finally {
      setLoading(false);
    }
  }, [page, debounced, skillId, hasCv, createdBy, createdFrom, createdTo]);

  useEffect(() => {
    load();
  }, [load]);

  /* ONE row design for every role (1 Oct 2026 redesign): identity (initials ·
     name · email · phone) · where · experience + domain · pay (current →
     expected) · CV · who added them and when. The same cells whatever the
     login; only the Actions column follows the role's rights. */
  const columns: Column<Candidate>[] = [
    { key: "full_name", label: "Candidate",
      render: (r) => {
        const name = candName(r);
        const email = displayEmail(r.email);
        return (
          <div className="flex min-w-[15rem] items-center gap-3">
            <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xs font-bold text-white shadow-raised ${avatarTone(name)}`} aria-hidden>
              {initialsOf(name)}
            </span>
            <div className="min-w-0">
              <div className="truncate font-semibold text-primary">{name}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                {email && <span className="inline-flex items-center gap-1 truncate"><Mail size={11} aria-hidden /> {email}</span>}
                {r.phone && <span className="inline-flex items-center gap-1 whitespace-nowrap"><Phone size={11} aria-hidden /> {r.phone}</span>}
              </div>
            </div>
          </div>
        );
      } },
    { key: "city", label: "Location",
      render: (r) => r.city
        ? <span className="inline-flex items-center gap-1.5 text-sm text-primary"><MapPin size={13} className="shrink-0 text-muted" aria-hidden /> {r.city}</span>
        : <span className="text-muted">—</span> },
    { key: "experience_years", label: "Experience",
      render: (r) => (
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-primary">
            <GraduationCap size={13} className="text-muted" aria-hidden />
            {r.experience_years != null ? `${r.experience_years} yrs` : "—"}
          </div>
          {r.technical_domain && <div className="mt-0.5 truncate text-xs text-muted" title={r.technical_domain}>{r.technical_domain}</div>}
        </div>
      ) },
    { key: "current_ctc", label: "CTC (Lac)",
      render: (r) => (
        <div className="whitespace-nowrap text-sm">
          <span className="inline-flex items-center gap-1 text-primary"><Wallet size={13} className="text-muted" aria-hidden /> {fmtLac(r.current_ctc)}</span>
          <span className="mx-1 text-muted">→</span>
          <span className="font-semibold text-primary">{fmtLac(r.expected_ctc)}</span>
          <div className="text-[11px] text-muted">current → expected</div>
        </div>
      ) },
    { key: "cv_url", label: "CV",
      render: (r) => r.cv_url ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          title={r.cv_original_filename || "Resume on file"}>
          <FileText size={12} aria-hidden /> On file
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">No CV</span>
      ) },
    { key: "created_at", label: "Added",
      render: (r) => (
        <div className="whitespace-nowrap text-sm">
          <div className="text-primary">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</div>
          {r.created_by_name && <div className="text-xs text-muted">by {r.created_by_name}</div>}
        </div>
      ) },
  ];

  const uploadCandidateZip = async (f: File) => {
    setZipBusy(true);
    setZipProgress(null);
    try {
      const start = await crmUpload<{ job_id: string; total: number; oversize: any[] }>(
        "/api/candidates/bulk-zip", f);
      const jobId = start.data.job_id;
      setZipProgress({ done: 0, total: start.data.total });
      const poll = async (): Promise<void> => {
        const res = await crmGet<{
          status: string; done: number; total: number; error?: string;
          oversize?: any[]; result?: NonNullable<typeof zipResult>;
        }>(`/api/resumes/bulk-jobs/${jobId}`);
        const j = res.data;
        if (j.status === "running") {
          setZipProgress({ done: j.done || 0, total: j.total || 0 });
          await new Promise((r) => setTimeout(r, 1500));
          return poll();
        }
        if (j.status === "error") throw new Error(j.error || "Bulk processing failed");
        const result = j.result!;
        if (j.oversize?.length) result.failed = [...result.failed, ...j.oversize];
        setZipResult(result);
        load();
      };
      await poll();
    } catch (e: any) {
      showToast(e?.message || "ZIP upload failed", "err");
    } finally {
      setZipBusy(false);
      setZipProgress(null);
    }
  };

  return (
    <div>
      <div className="mb-4">
        <PageHeader
          icon={Users}
          accent="ocean"
          eyebrow="Talent pool"
          title="Candidates"
          subtitle="Everyone in the talent pool — search by skill or domain, open a record, or apply someone to an opportunity."
          stats={meta ? [
            { label: meta.total === 1 ? "candidate" : "candidates", value: meta.total.toLocaleString() },
            ...(debounced.search || debounced.domain || skillId || hasCv || createdBy || createdFrom || createdTo
              ? [{ label: "filtered", value: "●" }] : []),
          ] : undefined}
          actions={canWrite ? (
            <>
              {/* Bulk pool intake (31 Aug 2026, user request): one ZIP of CVs →
                  many candidates, details extracted per resume. No opportunity —
                  TA applies them later from each record. */}
              <label className={`${HERO_BTN} ${zipBusy ? "pointer-events-none opacity-60" : "cursor-pointer"}`}>
                <input type="file" accept=".zip" className="hidden" disabled={zipBusy}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadCandidateZip(f); e.target.value = ""; }} />
                <FileText size={15} />
                {zipBusy
                  ? (zipProgress ? `Processing ${zipProgress.done}/${zipProgress.total}…` : "Uploading…")
                  : "Bulk upload (ZIP)"}
              </label>
              <button className={HERO_BTN_SOLID} onClick={() => setShowCreate(true)}>
                <Plus size={15} /> New Candidate
              </button>
            </>
          ) : undefined}
        />
      </div>

      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : (
        <DataTable<Candidate>
          columns={columns}
          rows={rows}
          meta={meta}
          headerRight={meta ? <span className="whitespace-nowrap text-xs font-medium text-muted">{meta.total} {meta.total === 1 ? "candidate" : "candidates"}, page {meta.page}/{Math.max(1, meta.pages || 1)}</span> : undefined}
          loading={loading}
          search={search}
          onSearch={setSearch}
          onPage={setPage}
          onRowClick={(r) => crmNavigate(`candidates/${r.id}`)} rowHref={(r: any) => `candidates/${r.id}`}
          filters={
            <>
              <select
                className={`${inputCls} !w-40`}
                value={hasCv}
                onChange={(e) => {
                  setHasCv(e.target.value);
                  setPage(1);
                }}
                aria-label="Filter by whether a CV is on file"
              >
                <option value="">CV: any</option>
                <option value="yes">Has CV</option>
                <option value="no">No CV</option>
              </select>
              <select
                className={`${inputCls} !w-48`}
                value={skillId}
                onChange={(e) => {
                  setSkillId(e.target.value);
                  setPage(1);
                }}
                aria-label="Filter by skill"
              >
                <option value="">All skills</option>
                {skills.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <input
                className={`${inputCls} !w-48`}
                placeholder="Technical domain…"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                aria-label="Filter by technical domain"
              />
              <select
                className={`${inputCls} !w-48`}
                value={createdBy}
                onChange={(e) => { setCreatedBy(e.target.value); setPage(1); }}
                aria-label="Filter by the TA who added the candidate"
              >
                <option value="">Added by — anyone</option>
                {creators.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="inline-flex items-center gap-1 text-xs text-muted" role="group" aria-label="Added between">
                <span>Added</span>
                <input type="date" aria-label="Added from" className={`${inputCls} !w-auto !py-1`}
                  value={createdFrom} max={createdTo || undefined}
                  onChange={(e) => { setCreatedFrom(e.target.value); setPage(1); }} />
                <span>–</span>
                <input type="date" aria-label="Added to" className={`${inputCls} !w-auto !py-1`}
                  value={createdTo} min={createdFrom || undefined}
                  onChange={(e) => { setCreatedTo(e.target.value); setPage(1); }} />
                {(createdFrom || createdTo || createdBy) && (
                  <button type="button" className="ml-1 text-brand-600 hover:underline"
                    onClick={() => { setCreatedFrom(""); setCreatedTo(""); setCreatedBy(""); setPage(1); }}>Clear</button>
                )}
              </div>
            </>
          }
          emptyMessage={<TeachingEmpty page="candidates" />}
          rowActionsLabel="Actions"
          rowActions={canWrite ? (r) => (
            <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              {/* Every candidate gets this — applying creates a Candidate Profile,
                  which needs no CV. It used to be hidden without one because the
                  old flow went through the requirement/ATS route. */}
              {canApply && (
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-control p-1.5 text-muted transition-colors hover:bg-surface-2 hover:!text-indigo-600"
                  title="Apply to an opportunity"
                  aria-label={`Apply ${candName(r)} to an opportunity`}
                  onClick={(e) => { e.stopPropagation(); setApplyFor(r); }}
                >
                  <Briefcase size={15} />
                </button>
              )}
              <RowActions
                entity="candidate"
                itemLabel={candName(r)}
                onView={() => crmNavigate(`candidates/${r.id}`)}
                onEdit={() => crmNavigate(`candidates/${r.id}`)}
                deleteUrl={`/api/candidates/${r.id}`}
                onDeleted={() => afterListDelete(r.id, setRows, load)}
                notify={showToast}
                canEdit
                canDelete
              colored />
            </span>
          ) : undefined}
        />
      )}

      {zipResult && (
        <Modal medium title="Bulk upload results" onClose={() => setZipResult(null)}>
          <div className="space-y-4 text-sm">
            <p className="text-secondary">
              {zipResult.total} resume(s) in the ZIP — {zipResult.created.length} candidate(s) added
              {zipResult.enriched.length > 0 && <>, {zipResult.enriched.length} already existed</>}
              {zipResult.failed.length > 0 && <>, {zipResult.failed.length} failed</>}.
            </p>
            {zipResult.created.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">
                  Added — now in the Candidates list
                </div>
                <ul className="max-h-56 space-y-1 overflow-y-auto">
                  {zipResult.created.map((c) => (
                    <li key={c.file} className="text-secondary">
                      <button type="button" className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
                        onClick={() => { setZipResult(null); crmNavigate(`candidates/${c.candidate_id}`); }}>
                        {c.name}
                      </button>
                      {c.email && !c.no_email && <> · {displayEmail(c.email)}</>}
                      {c.no_email && <span className="text-warning"> · no email found — add one before mailing them</span>}
                      <span className="text-xs text-muted"> ({c.file})</span>
                      {c.name_match && (
                        <div className="text-xs text-muted">
                          note: same name as existing candidate{" "}
                          <button type="button" className="underline"
                            onClick={() => { setZipResult(null); crmNavigate(`candidates/${c.name_match!.candidate_id}`); }}>
                            {c.name_match.name}
                          </button>{" "}
                          (different email/phone — likely a different person)
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {zipResult.enriched.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">
                  Already existed — no duplicate created, missing details topped up
                </div>
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {zipResult.enriched.map((c) => (
                    <li key={c.file} className="text-secondary">
                      <button type="button" className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
                        onClick={() => { setZipResult(null); crmNavigate(`candidates/${c.candidate_id}`); }}>
                        {c.name || `#${c.candidate_id}`}
                      </button>
                      {c.filled > 0 && <> · {c.filled} field(s) filled from this CV</>}
                      <span className="text-xs text-muted"> ({c.file})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {zipResult.failed.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-bold uppercase tracking-wide text-danger">Failed</div>
                <ul className="max-h-24 space-y-0.5 overflow-y-auto text-xs text-danger">
                  {zipResult.failed.map((s) => <li key={s.file}>{s.file} — {s.reason}</li>)}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <button className={btnPrimary} onClick={() => setZipResult(null)}>Done</button>
            </div>
          </div>
        </Modal>
      )}
      {showCreate && (
        <CandidateFormModal
          onClose={() => setShowCreate(false)}
          onSaved={(c) => {
            setShowCreate(false);
            showToast("Candidate created");
            crmNavigate(`candidates/${c.id}`);
          }}
        />
      )}
      {applyFor && (
        <ApplyToOpportunityModal
          mode="pick-opportunity"
          candidateId={applyFor.id}
          candidateName={candName(applyFor)}
          onClose={() => setApplyFor(null)}
          onApplied={(msg) => { showToast(msg); load(); }}
        />
      )}
      {toast}
    </div>
  );
}

/* ------------------------------------------------------------------ create / edit modal */

export function CandidateFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Candidate;
  onClose: () => void;
  onSaved: (c: Candidate) => void;
}) {
  const designations = useMaster<DesignationOpt>("/api/designations?is_active=true");
  const locations = useMaster<LocationOpt>("/api/locations");
  const isEdit = !!initial;
  // Recruiter = whoever is adding the candidate (1 Sep 2026, user request).
  // Prefilled, not locked: a coordinator sometimes enters a colleague's find,
  // and an edit must never silently reassign an existing candidate.
  const me = useMe();

  const init = (initial || {}) as any;
  const [form, setForm] = useState({
    salutation: init.salutation || "",
    first_name: initial?.first_name || "",
    middle_name: init.middle_name || "",
    last_name: initial?.last_name || "",
    email: initial?.email || "",
    phone: initial?.phone || "",
    date_of_birth: init.date_of_birth ? String(init.date_of_birth).slice(0, 10) : "",
    gender: init.gender || "",
    experience_years: init.experience_years !== null && init.experience_years !== undefined ? String(init.experience_years) : "",
    notice_period: init.notice_period || "",
    city: init.city || "",
    preferred_locations: init.preferred_locations || "",
    recruiter_email: init.recruiter_email || (isEdit ? "" : me.email || ""),
    technical_domain: initial?.technical_domain || "",
    roles: init.roles || "",
    designation_id: initial?.designation_id ? String(initial.designation_id) : "",
    linkedin_url: initial?.linkedin_url || "",
    current_ctc: rupeesToLac(init.current_ctc),
    expected_ctc: rupeesToLac(initial?.expected_ctc),
    preferred_location_id: initial?.preferred_location_id ? String(initial.preferred_location_id) : "",
    current_address: initial?.current_address || "",
    permanent_address: initial?.permanent_address || "",
    resignation_status: !!initial?.resignation_status,
    last_working_day: initial?.last_working_day ? initial.last_working_day.slice(0, 10) : "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  /* Resume-FIRST create (31 Aug 2026, user request): TA drops the CV, the AI
     parse prefills every EMPTY field, duplicates surface immediately (email OR
     last-10-digit phone — same rule as bulk upload) with candidate/profile
     links, and the file attaches as the candidate's CV on Create (which also
     auto-fills skills/education/experience history server-side). */
  const [cvFile, setCvFile] = useState<File | null>(null);
  const cvInput = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [parseDup, setParseDup] = useState<any | null>(null);
  const [parseNameNote, setParseNameNote] = useState<any | null>(null);

  const numOnly = (v: unknown): string => {
    const s = String(v ?? "").replace(/[, ]/g, "");
    return s && !Number.isNaN(Number(s)) ? s : "";
  };

  const parseResume = async (f: File) => {
    setCvFile(f);
    setParsing(true);
    setParseDup(null);
    setParseNameNote(null);
    try {
      const res = await crmUpload<any>("/api/resumes/parse", f);
      const p = res.data?.parsed || {};
      setForm((prev) => {
        const next = { ...prev };
        const fill = (k: keyof typeof prev, v: unknown) => {
          const s = String(v ?? "").trim();
          if (s && !String(next[k] ?? "").trim()) (next as any)[k] = s;
        };
        const nameParts = String(p.name || "").trim().split(/\s+/).filter(Boolean);
        if (!next.first_name.trim() && !next.last_name.trim() && nameParts.length) {
          next.first_name = nameParts[0];
          if (nameParts.length > 1) next.last_name = nameParts[nameParts.length - 1];
          if (nameParts.length > 2) next.middle_name = nameParts.slice(1, -1).join(" ");
        }
        fill("email", p.email);
        fill("phone", p.phone);
        fill("experience_years", numOnly(p.experience));
        fill("notice_period", p.notice_period);
        fill("city", p.location);
        fill("preferred_locations", p.location);
        fill("technical_domain", p.technical_domain);
        fill("linkedin_url", p.linkedin_url);
        fill("roles", p.designation);
        // These two fields are in LAC (they are ×100,000'd on save), so a
        // parsed "12,00,000" must become 12 — not 1200000, which stored
        // ₹1,20,00,00,00,000 (2 Sep 2026 bug report).
        fill("current_ctc", ctcToLacInput(p.current_ctc));
        fill("expected_ctc", ctcToLacInput(p.expected_ctc));
        return next;
      });
      setParseDup(res.data?.duplicate || null);
      setParseNameNote(res.data?.name_match || null);
      if (p.text_extracted === false) {
        setError("The file has no readable text — fill the details manually (the CV still attaches on Create)");
      } else {
        setError("");
      }
    } catch (e: any) {
      setError(e?.message || "Could not read the resume — fill the details manually");
    } finally {
      setParsing(false);
    }
  };

  // Template field grants: lock what the template sets to view-only. Applies
  // on EDIT — creating a record types every field of a record that doesn't
  // exist yet, which the tab-level "create" grant already covers.
  const acc = useCrmAccess("candidates");
  const locked = (registryKey: string) => isEdit && !acc.canEditField(registryKey);

  type DupMatch = { id: number; name: string; email?: string | null; phone?: string | null; match_on: string[] };
  const [dupes, setDupes] = useState<DupMatch[] | null>(null);
  // Email is the candidate's unique key: an email match is a HARD block (no
  // second record). Name/phone matches stay a soft warning — two people can
  // share a name. `emailMatch` is the existing record we point the recruiter to.
  const emailMatch = !isEdit ? (dupes || []).find((d) => d.match_on.includes("email")) || null : null;
  const emailBlocked = !!emailMatch;

  /** Check the email the moment it's entered, so a duplicate is caught before
   * the recruiter fills the whole form. Email-only — the full multi-signal
   * check still runs on submit. */
  const checkEmailDuplicate = async () => {
    if (isEdit) return;
    const email = form.email.trim();
    if (!email || email.endsWith("@import.karnex.in")) return;
    try {
      const res = await crmGet<DupMatch[]>(
        `/api/candidates/check-duplicates?email=${encodeURIComponent(email)}`,
      );
      const hits = (res.data || []).filter((d) => d.match_on.includes("email"));
      if (hits.length > 0) setDupes(hits);
    } catch { /* a check failure must never block the form */ }
  };

  /* ---------------------------------------------------------- wizard steps */
  /* Stepped chrome (1 Sep 2026, user request) — the same shell as New Customer
     and New Opportunity. One 40-field scroll became four short screens, and the
     rail on the left doubles as a completeness check before Create. */
  const STEPS = useMemo(() => {
    const rest = [
      { key: "personal", title: "Personal details",
        description: "Name, contact, and where the candidate is based." },
      { key: "professional", title: "Professional",
        description: "Experience, domain, roles, and who is recruiting them." },
      { key: "compensation", title: "Compensation & notice",
        description: "Current and expected CTC, plus resignation status." },
    ];
    return isEdit
      ? rest
      : [{ key: "resume", title: "Resume & email",
           description: "Drop the CV and the form fills itself. The email is checked for duplicates first." },
         ...rest];
  }, [isEdit]);

  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [stepDir, setStepDir] = useState(1);
  const totalSteps = STEPS.length;
  const clampedStep = Math.min(Math.max(stepIndex, 0), totalSteps - 1);
  const currentStep = STEPS[clampedStep];
  const isFirstStep = clampedStep === 0;
  const isLastStep = clampedStep === totalSteps - 1;
  const stepPct = Math.round(((clampedStep + 1) / totalSteps) * 100);

  const stepStatus = (key: string): StepStatus => {
    switch (key) {
      case "resume":
        if (emailBlocked) return "error";
        if (!form.email.trim()) return "empty";
        return cvFile ? "complete" : "partial";
      case "personal": {
        if (!form.first_name.trim() || !form.email.trim()) return "empty";
        return form.phone.trim() ? "complete" : "partial";
      }
      case "professional": {
        const filled = [form.technical_domain, form.roles, form.designation_id,
          form.recruiter_email, form.experience_years].filter((v) => String(v).trim()).length;
        return filled === 0 ? "empty" : filled >= 3 ? "complete" : "partial";
      }
      case "compensation":
        if (form.current_ctc && form.expected_ctc) return "complete";
        return form.current_ctc || form.expected_ctc ? "partial" : "empty";
      default:
        return "empty";
    }
  };

  const wizardSteps: WizardStep[] = STEPS.map((s) => ({
    key: s.key,
    title: s.title,
    status: stepStatus(s.key),
  }));

  /** Returns the step a required field is missing on, or -1 when all good. */
  const firstIncompleteStep = (): number => {
    const need = (key: string) => STEPS.findIndex((s) => s.key === key);
    if (!form.email.trim()) return Math.max(need(isEdit ? "personal" : "resume"), 0);
    if (!form.first_name.trim()) return Math.max(need("personal"), 0);
    return -1;
  };

  const validateStep = (idx: number): boolean => {
    const key = STEPS[idx]?.key;
    if (key === "resume") {
      if (!form.email.trim()) { setError("Enter the candidate's email to continue"); return false; }
      if (emailBlocked) { setError("This email already exists — open the existing candidate instead"); return false; }
    }
    if (key === "personal") {
      if (!form.first_name.trim()) { setError("First name is required"); return false; }
      if (!form.email.trim()) { setError("Email is required"); return false; }
    }
    setError("");
    return true;
  };

  const goToStep = (i: number) => {
    if (i < 0 || i >= totalSteps || i > maxReached) return;
    setStepDir(i > clampedStep ? 1 : -1);
    setStepIndex(i);
  };
  const goPrev = () => { if (!isFirstStep) goToStep(clampedStep - 1); };
  const goNext = () => {
    if (!validateStep(clampedStep) || isLastStep) return;
    const next = clampedStep + 1;
    setMaxReached((m) => Math.max(m, next));
    setStepDir(1);
    setStepIndex(next);
  };

  const submit = async (opts?: { skipDupCheck?: boolean }) => {
    // Jump back to the step that is actually missing something — an error at
    // the bottom of the last step used to point at a field two screens away.
    const bad = firstIncompleteStep();
    if (bad >= 0) {
      setMaxReached((m) => Math.max(m, bad));
      setStepDir(-1);
      setStepIndex(bad);
      return setError(!form.email.trim() ? "Email is required" : "First name is required");
    }
    setBusy(true);
    setError("");
    // Duplicate check BEFORE creating (create mode only): the same person
    // arrives via portal, referral and import, and merging records after
    // profiles hang off both is miserable. A warning, not a wall — the
    // recruiter can still create.
    if (!isEdit && !opts?.skipDupCheck) {
      try {
        const q = new URLSearchParams();
        if (form.phone.trim()) q.set("phone", form.phone.trim());
        if (form.email.trim()) q.set("email", form.email.trim());
        const fullName = [form.first_name, form.middle_name, form.last_name]
          .map((s) => s.trim()).filter(Boolean).join(" ");
        if (fullName) q.set("name", fullName);
        const res = await crmGet<DupMatch[]>(`/api/candidates/check-duplicates?${q.toString()}`);
        if ((res.data || []).length > 0) {
          setDupes(res.data);
          setBusy(false);
          return;
        }
      } catch { /* the check must never block creation */ }
    }
    setDupes(null);
    const payload = {
      salutation: form.salutation || null,
      first_name: form.first_name.trim(),
      middle_name: form.middle_name.trim() || null,
      last_name: form.last_name.trim() || null,
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      date_of_birth: form.date_of_birth || null,
      gender: form.gender || null,
      experience_years: form.experience_years !== "" ? Number(form.experience_years) : null,
      notice_period: form.notice_period.trim() || null,
      city: form.city.trim() || null,
      preferred_locations: form.preferred_locations.trim() || null,
      recruiter_email: form.recruiter_email.trim() || null,
      technical_domain: form.technical_domain.trim() || null,
      roles: form.roles.trim() || null,
      designation_id: form.designation_id ? Number(form.designation_id) : null,
      linkedin_url: form.linkedin_url.trim() || null,
      current_ctc: lacToRupees(form.current_ctc),
      expected_ctc: lacToRupees(form.expected_ctc),
      preferred_location_id: form.preferred_location_id ? Number(form.preferred_location_id) : null,
      current_address: form.current_address.trim() || null,
      permanent_address: form.permanent_address.trim() || null,
      resignation_status: form.resignation_status,
      last_working_day: form.resignation_status && form.last_working_day ? form.last_working_day : null,
    };
    // Drop view-only fields from the edit payload — the server rejects a save
    // that touches them, and an unchanged echo of a locked field still counts
    // as touching it.
    if (isEdit) {
      const FIELD_OF: Record<string, string> = {
        salutation: "name", first_name: "name", middle_name: "name", last_name: "name",
        email: "email", phone: "phone",
        experience_years: "experience_years", notice_period: "notice_period",
        current_ctc: "current_ctc", expected_ctc: "expected_ctc",
        resignation_status: "resignation", last_working_day: "resignation",
      };
      for (const key of Object.keys(payload)) {
        const reg = FIELD_OF[key];
        if (reg && !acc.canEditField(reg)) delete (payload as Record<string, unknown>)[key];
      }
    }
    try {
      const res = isEdit
        ? await crmPut<Candidate>(`/api/candidates/${initial!.id}`, payload)
        : await crmPost<Candidate>("/api/candidates", payload);
      if (!isEdit && cvFile && res.data?.id) {
        // Attach the parsed resume as the candidate's CV — the server also
        // auto-fills skills/education/experience history from it. Best-effort:
        // the candidate exists either way.
        try { await crmUpload(`/api/candidates/${res.data.id}/cv`, cvFile); } catch { /* CV can be re-uploaded from the record */ }
      }
      onSaved(res.data);
    } catch (e: any) {
      setError(e?.message || "Failed to save candidate");
      setBusy(false);
    }
  };


  /* The duplicate banner sits ABOVE the step body, not inside a step: the
     email check fires on blur (step 1) but the full name/phone check fires on
     submit (last step), and a warning the recruiter can't see is no warning. */
  const dupBanner = dupes && dupes.length > 0 ? (
    <div
      className={`mb-4 rounded-card border p-4 ${
        emailBlocked
          ? "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40"
          : "border-warning/40 bg-warning-soft"
      }`}
      role="alert"
    >
      <p className={`text-sm font-bold ${emailBlocked ? "text-rose-700 dark:text-rose-300" : "text-warning"}`}>
        {emailBlocked
          ? "This email already exists — a duplicate can't be created"
          : `Possible duplicate${dupes.length > 1 ? "s" : ""} — is this the same person?`}
      </p>
      <ul className="mt-2 space-y-1.5">
        {dupes.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm text-secondary">
            <span className="font-semibold text-primary">{d.name || `#${d.id}`}</span>
            {d.phone && <span>{d.phone}</span>}
            {d.email && !d.email.endsWith("@import.karnex.in") && <span>{displayEmail(d.email)}</span>}
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted">
              same {d.match_on.join(" + ")}
            </span>
            <button
              type="button"
              className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300"
              onClick={() => { onClose(); crmNavigate(`candidates/${d.id}`); }}
            >
              Open record
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-secondary">
        {emailBlocked
          ? "Email is the candidate's unique key, so a second record isn't allowed. Open the existing candidate to update their resume or details, or apply them to an opportunity."
          : "Open the existing record instead of creating a second one — or, if this really is a different person, create anyway."}
      </p>
    </div>
  ) : null;

  /* Step bodies (30 Sep 2026 redesign): each step is split into titled groups
     (`WizardGroup`) — Name · Contact · About · Address, Experience · Where &
     who, Pay · Resignation — with one-tap chips and unit suffixes. Every field,
     payload key and rule is unchanged. */
  const suffix = (unit: string) => (
    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-[color:var(--wiz-muted)]">{unit}</span>
  );
  const cur = Number(form.current_ctc);
  const exp = Number(form.expected_ctc);
  const hike = form.current_ctc !== "" && form.expected_ctc !== "" && cur > 0 ? Math.round(((exp - cur) / cur) * 100) : null;

  const renderStep = () => {
    switch (currentStep.key) {
      case "resume":
        return (
          <div className="space-y-5">
            <input ref={cvInput} type="file" className="sr-only" accept=".pdf,.docx,.txt" tabIndex={-1} aria-label="Resume file"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void parseResume(f); e.target.value = ""; }} />
            <ResumeDropZone
              file={cvFile}
              parsing={parsing}
              busy={busy}
              hint="Drop the CV — the next steps fill themselves and it attaches on Create"
              onBrowse={() => cvInput.current?.click()}
              onDropFile={(f) => void parseResume(f)}
              onClear={() => { setCvFile(null); setParseDup(null); setParseNameNote(null); }}
              status={
                <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" role="status">
                  <Sparkles size={12} aria-hidden /> Read — the next steps are prefilled; correct anything wrong
                </p>
              }
            />
            {parseDup && (
              <div className="rounded-card border border-warning/40 bg-warning-soft px-4 py-3" role="alert">
                <p className="text-sm font-bold text-warning">
                  This resume matches an existing candidate — don&rsquo;t create a duplicate
                </p>
                <p className="mt-1 text-sm text-secondary">
                  <button type="button" className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
                    onClick={() => { onClose(); crmNavigate(`candidates/${parseDup.candidate_id}`); }}>
                    {parseDup.name || `Candidate #${parseDup.candidate_id}`}
                  </button>
                  {parseDup.email ? <> · {displayEmail(parseDup.email)}</> : null}
                  {parseDup.phone ? <> · {parseDup.phone}</> : null}
                </p>
                {(parseDup.profiles || []).length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-secondary">
                    {parseDup.profiles.map((pr: any) => (
                      <li key={pr.profile_id}>
                        Applied to <b>{pr.opportunity_title}</b> ({String(pr.pipeline_status || "").replace(/_/g, " ")}) —{" "}
                        <button type="button" className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
                          onClick={() => { onClose(); crmNavigate(`profiles/${pr.profile_id}`); }}>
                          open profile
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1.5 text-xs text-secondary">
                  Open the existing record to update their CV or apply them to an opportunity instead.
                </p>
              </div>
            )}
            {parseNameNote && !parseDup && (
              <p className="text-xs text-muted">
                Note: same name as existing candidate{" "}
                <button type="button" className="font-semibold underline"
                  onClick={() => { onClose(); crmNavigate(`candidates/${parseNameNote.candidate_id}`); }}>
                  {parseNameNote.name}
                </button>{" "}
                (different email/phone — likely a different person).
              </p>
            )}
            <WizardGroup icon={Mail} title="The candidate's email" accent="from-indigo-500 to-purple-600"
              hint="Their unique key — checked for duplicates as soon as you leave the field" done={!!form.email.trim() && !emailBlocked} cols={1}>
              <WizardField label="Email" required icon="mail" filled={!!form.email.trim()}>
                <input className={inputCls} type="email" value={form.email}
                  placeholder="Enter the candidate's email first"
                  onChange={(e) => { set("email", e.target.value); if (dupes) setDupes(null); }}
                  onBlur={() => void checkEmailDuplicate()} />
                {isPlaceholderEmail(form.email) && (
                  <p className="mt-1 text-xs text-warning">
                    Placeholder address — replace it with the candidate&rsquo;s real one.
                  </p>
                )}
              </WizardField>
            </WizardGroup>
          </div>
        );

      case "personal":
        return (
          <div className="space-y-4">
            <WizardGroup icon={UserRound} title="Name" accent="from-indigo-500 to-purple-600"
              hint="As it should appear on the invites and the offer" done={!!form.first_name.trim()} cols={4}>
              <WizardField label="Salutation">
                <select className={inputCls} value={form.salutation} onChange={(e) => set("salutation", e.target.value)}>
                  <option value="">—</option>
                  {["Mr", "Ms", "Mrs", "Dr", "Mx"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </WizardField>
              <WizardField label="First name" required filled={!!form.first_name.trim()}>
                <input className={inputCls} value={form.first_name} disabled={locked("name")} onChange={(e) => set("first_name", e.target.value)} />
              </WizardField>
              <WizardField label="Middle name">
                <input className={inputCls} value={form.middle_name} onChange={(e) => set("middle_name", e.target.value)} />
              </WizardField>
              <WizardField label="Last name">
                <input className={inputCls} value={form.last_name} onChange={(e) => set("last_name", e.target.value)} />
              </WizardField>
            </WizardGroup>

            <WizardGroup icon={Phone} title="Contact" accent="from-sky-500 to-cyan-600"
              hint="How TA and the interview invites reach them" done={!!form.email.trim() && !!form.phone.trim()}>
              {/* Email is captured on step 1 when creating; on edit it stays here so it can be replaced. */}
              {isEdit && (
                <WizardField label="Email" required icon="mail" filled={!!form.email.trim()}>
                  <input className={inputCls} type="email" value={form.email} disabled={locked("email")}
                    onChange={(e) => set("email", e.target.value)} />
                  {isPlaceholderEmail(form.email) && (
                    <p className="mt-1 text-xs text-warning">
                      Placeholder address — this candidate had no email in Zoho. Replace it with
                      their real one.
                    </p>
                  )}
                </WizardField>
              )}
              <WizardField className={isEdit ? "" : "sm:col-span-2"} label="Phone">
                <PhoneField value={form.phone} disabled={locked("phone")} onChange={(v) => set("phone", v)} />
              </WizardField>
            </WizardGroup>

            <WizardGroup icon={CalendarDays} title="About" accent="from-emerald-500 to-teal-600"
              hint="Optional — useful for HR later" done={!!(form.date_of_birth && form.gender && form.city.trim())}>
              <WizardField label="Date of birth" icon="calendar" filled={!!form.date_of_birth}>
                <input className={inputCls} type="date" value={form.date_of_birth} onChange={(e) => set("date_of_birth", e.target.value)} />
              </WizardField>
              <WizardField label="City" icon="map" filled={!!form.city.trim()}>
                <input className={inputCls} value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Where they live today, e.g. Pune" />
              </WizardField>
              <div className="sm:col-span-2">
                <span className="wiz-field-label mb-1.5 block text-[11px] font-semibold text-[color:var(--wiz-label)]">Gender</span>
                <Chips label="Gender" options={["Male", "Female", "Other", "Prefer not to say"]} value={form.gender}
                  onPick={(v) => set("gender", v)} />
              </div>
            </WizardGroup>

            <WizardGroup icon={MapPin} title="Address" accent="from-orange-500 to-rose-500"
              hint="Current and permanent" done={!!(form.current_address.trim() && form.permanent_address.trim())}
              action={form.current_address.trim() && form.permanent_address.trim() !== form.current_address.trim() ? (
                <button type="button" onClick={() => set("permanent_address", form.current_address)}
                  className="rounded-full border border-[color:var(--wiz-border-strong)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--wiz-text)] hover:border-indigo-400">
                  Permanent = current
                </button>
              ) : undefined}>
              <WizardField label="Current address">
                <textarea className={inputCls} rows={2} value={form.current_address} onChange={(e) => set("current_address", e.target.value)} />
              </WizardField>
              <WizardField label="Permanent address">
                <textarea className={inputCls} rows={2} value={form.permanent_address} onChange={(e) => set("permanent_address", e.target.value)} />
              </WizardField>
            </WizardGroup>
          </div>
        );

      case "professional":
        return (
          <div className="space-y-4">
            <WizardGroup icon={Briefcase} title="Experience" accent="from-sky-500 to-indigo-600"
              hint="How senior, what they work on, how soon they can join"
              done={form.experience_years !== "" && !!form.notice_period.trim() && !!form.technical_domain.trim()}>
              <WizardField label="Total experience">
                <div className="relative">
                  <input className={`${inputCls} pr-12`} type="number" step="0.5" min={0} value={form.experience_years}
                    disabled={locked("experience_years")} onChange={(e) => set("experience_years", e.target.value)} placeholder="e.g. 4.5" />
                  {suffix("yrs")}
                </div>
              </WizardField>
              <WizardField label="Notice period">
                <input className={inputCls} value={form.notice_period} disabled={locked("notice_period")}
                  onChange={(e) => set("notice_period", e.target.value)} placeholder="e.g. 30 days / Immediate" />
                {!locked("notice_period") && (
                  <Chips label="Notice period" options={NOTICE_CHIPS} value={form.notice_period} onPick={(v) => set("notice_period", v)} />
                )}
              </WizardField>
              <WizardField label="Technical domain" filled={!!form.technical_domain.trim()}>
                <input className={inputCls} value={form.technical_domain} onChange={(e) => set("technical_domain", e.target.value)} placeholder="e.g. Embedded / AUTOSAR, Backend" />
              </WizardField>
              <WizardField label="Designation">
                <select className={inputCls} value={form.designation_id} onChange={(e) => set("designation_id", e.target.value)}>
                  <option value="">None</option>
                  {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </WizardField>
              <WizardField className="sm:col-span-2" label="Roles">
                <input className={inputCls} value={form.roles} onChange={(e) => set("roles", e.target.value)} placeholder="e.g. Backend Engineer, Tech Lead" />
              </WizardField>
            </WizardGroup>

            <WizardGroup icon={Users} title="Where & who" accent="from-purple-500 to-fuchsia-600"
              hint="Where they want to work, who is recruiting them, their LinkedIn"
              done={!!form.preferred_location_id && !!form.recruiter_email.trim()}>
              {/* Free-text "Preferred locations" removed 3 Sep 2026 (user decision) —
                  the master-data dropdown is the only location field. The form key
                  is kept so existing values still round-trip on edit. */}
              <WizardField label="Preferred location" icon="map">
                <select className={inputCls} value={form.preferred_location_id} onChange={(e) => set("preferred_location_id", e.target.value)}>
                  <option value="">None</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{locLabel(l)}</option>)}
                </select>
              </WizardField>
              <WizardField
                label="Recruiter"
                icon="mail"
                filled={!!form.recruiter_email.trim()}
                info={!isEdit && form.recruiter_email === (me.email || "") && form.recruiter_email
                  ? <p className="mt-1 text-xs text-muted">
                      You ({me.full_name || me.username}) — change it if you are adding this
                      candidate on a colleague&rsquo;s behalf.
                    </p>
                  : undefined}
              >
                <input className={inputCls} value={form.recruiter_email} onChange={(e) => set("recruiter_email", e.target.value)} placeholder="recruiter@karnex.in" />
              </WizardField>
              <WizardField className="sm:col-span-2" label="LinkedIn URL" icon={<Linkedin size={15} className="text-[color:var(--wiz-muted)]" aria-hidden />}>
                <input className={inputCls} value={form.linkedin_url} onChange={(e) => set("linkedin_url", e.target.value)} placeholder="https://linkedin.com/in/…" />
              </WizardField>
            </WizardGroup>
          </div>
        );

      case "compensation":
        return (
          <div className="space-y-4">
            <WizardGroup icon={IndianRupee} title="Pay" accent="from-emerald-500 to-teal-600"
              hint="In lakhs a year — saved as rupees" done={form.current_ctc !== "" && form.expected_ctc !== ""}>
              <WizardField label="Current CTC">
                <div className="relative">
                  <input className={`${inputCls} pr-14`} type="number" min={0} step={0.01} placeholder="e.g. 12"
                    value={form.current_ctc} disabled={locked("current_ctc")} onChange={(e) => set("current_ctc", e.target.value)} />
                  {suffix("Lac")}
                </div>
              </WizardField>
              <WizardField label="Expected CTC">
                <div className="relative">
                  <input className={`${inputCls} pr-14`} type="number" min={0} step={0.01} placeholder="e.g. 16"
                    value={form.expected_ctc} disabled={locked("expected_ctc")} onChange={(e) => set("expected_ctc", e.target.value)} />
                  {suffix("Lac")}
                </div>
              </WizardField>
              {hike != null && (
                <p className={`sm:col-span-2 inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
                  hike > 50 ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                    : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"}`}>
                  <Wallet size={13} aria-hidden /> {hike >= 0 ? "+" : ""}{hike}% hike asked
                </p>
              )}
            </WizardGroup>

            <WizardGroup icon={Clock} title="Resignation" accent="from-amber-500 to-orange-600" cols={1}
              hint="Have they already resigned? Sales plans the joining date around it">
              <button
                type="button"
                role="switch"
                aria-checked={form.resignation_status}
                disabled={locked("resignation")}
                onClick={() => set("resignation_status", !form.resignation_status)}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
                  form.resignation_status ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40" : "border-[color:var(--wiz-border)] bg-[color:var(--wiz-card)]"}`}
              >
                <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${form.resignation_status ? "bg-amber-500" : "bg-slate-300 dark:bg-slate-600"}`} aria-hidden>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-[#fff] shadow transition-all ${form.resignation_status ? "left-[22px]" : "left-0.5"}`} />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-[color:var(--wiz-text)]">Resigned / serving notice</span>
                  <span className="block text-xs text-[color:var(--wiz-muted)]">
                    {form.resignation_status ? "Add the last working day below" : "Not resigned yet"}
                  </span>
                </span>
              </button>
              {form.resignation_status && (
                <WizardField label="Last working day" icon="calendar" filled={!!form.last_working_day}>
                  <input className={inputCls} type="date" value={form.last_working_day} disabled={locked("resignation")} onChange={(e) => set("last_working_day", e.target.value)} />
                </WizardField>
              )}
            </WizardGroup>
          </div>
        );

      default:
        return null;
    }
  };

  // The last step's primary action changes with what the duplicate check found.
  const submitLabel = emailBlocked
    ? "Open existing candidate"
    : dupes && dupes.length > 0 && !isEdit
      ? "Create anyway — different person"
      : isEdit ? "Save changes" : "Create Candidate";
  const onSubmitClick = () => {
    if (emailBlocked) {
      onClose();
      if (emailMatch) crmNavigate(`candidates/${emailMatch.id}`);
      return;
    }
    void submit({ skipDupCheck: !!(dupes && dupes.length > 0) });
  };

  return (
    <WizardShell
      onClose={onClose}
      ariaLabel={isEdit ? "Edit candidate steps" : "New candidate steps"}
      topBar={
        <WizardTopBar
          title={isEdit ? `Edit Candidate — ${[form.first_name, form.last_name].filter(Boolean).join(" ")}` : "New Candidate"}
          eyebrow={isEdit ? "Edit candidate" : "New candidate"}
          subtitle={isEdit
            ? [displayEmail(form.email), form.phone].filter((x) => x && x !== "—").join(" · ") || "Update the candidate's record"
            : "Drop the CV and the form fills itself — then check each step"}
          icon={UserRound}
          steps={wizardSteps}
          stepIndex={clampedStep}
          totalSteps={totalSteps}
          stepPct={stepPct}
          busy={busy}
          showAutosave={false}
        />
      }
      footer={
        <WizardFooter
          stepIndex={clampedStep}
          totalSteps={totalSteps}
          stepPct={stepPct}
          isFirstStep={isFirstStep}
          isLastStep={isLastStep}
          busy={busy}
          onPrev={goPrev}
          onNext={goNext}
          onSubmit={onSubmitClick}
          submitLabel={submitLabel}
          submitBusyLabel={isEdit ? "Saving…" : "Creating…"}
          nextTitle={STEPS[clampedStep + 1]?.title}
          prevTitle={STEPS[clampedStep - 1]?.title}
        />
      }
      steps={wizardSteps}
      currentIndex={clampedStep}
      maxReached={maxReached}
      onSelectStep={goToStep}
    >
      <div
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
          e.preventDefault();
          if (!isLastStep) goNext();
        }}
      >
        <WizardStepCard stepKey={currentStep.key} stepDir={stepDir} width="narrow">
          <SectionHeaderBanner
            title={currentStep.title}
            description={currentStep.description}
            headingRef={stepHeadingRef}
            stepKey={currentStep.key}
            step={{ index: clampedStep, total: totalSteps }}
          />
          {error && <div className="mb-4"><ErrorBox error={error} /></div>}
          {dupBanner}
          {renderStep()}
        </WizardStepCard>
      </div>
    </WizardShell>
  );
}

/* ------------------------------------------------------------------ detail page */

type DeleteTarget = { kind: "education" | "experience"; id: number; label: string };

export function CandidateDetailPage() {
  const params = useCrmParams();
  const id = params.id;
  const canWrite = useHasRole(...WRITE_ROLES);
  /* Same rule as the list row and the server gate (7 Sep 2026 fix): TA / Sales /
     RMG, template-aware, and NO CV requirement — applying needs no CV (the
     modal says so), yet this page hid the button until one was uploaded. */
  const canApplyHere = useCanAct("profiles", "create", useHasRole("TA", "Sales", "RMG"));
  // Multi-apply and the AI review are TA's (user decision, 9 Oct 2026); the server's ta_gate says the same.
  const isTa = useHasRole("TA");

  const [data, setData] = useState<CandidateDetail | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = usePageTab<string>("tab", "personal");
  const [showEdit, setShowEdit] = useState(false);
  const [eduModal, setEduModal] = useState<{ open: boolean; item?: Education }>({ open: false });
  const [expModal, setExpModal] = useState<{ open: boolean; item?: Experience }>({ open: false });
  const [skillsModal, setSkillsModal] = useState(false);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [toast, showToast] = useToast();
  const [parsing, setParsing] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);

  const load = useCallback(() => {
    crmGet<CandidateDetail>(`/api/candidates/${id}`)
      .then((r) => setData(r.data))
      .catch((e: any) => setError(e?.message || "Failed to load candidate"));
  }, [id]);

  const parseCv = async () => {
    setParsing(true);
    try {
      const res = await crmPost<{
        autofilled?: { fields?: string[]; skills?: number; education?: number; experience?: number };
      }>(`/api/candidates/${id}/parse-cv`, {});
      const f = res.data?.autofilled;
      const parts: string[] = [];
      if (f?.fields?.length) parts.push(`${f.fields.length} field${f.fields.length === 1 ? "" : "s"}`);
      if (f?.skills) parts.push(`${f.skills} skill${f.skills === 1 ? "" : "s"}`);
      if (f?.education) parts.push(`${f.education} education`);
      if (f?.experience) parts.push(`${f.experience} experience`);
      showToast(parts.length ? `Filled ${parts.join(", ")} from the CV` : "CV parsed — nothing new to add");
      load();
    } catch (e: any) {
      showToast(e?.message || "Failed to parse CV", "err");
    } finally {
      setParsing(false);
    }
  };

  useEffect(() => {
    setData(null);
    setError("");
    load();
  }, [load]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <Spinner label="Loading candidate…" />;

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await crmDelete(`/api/candidates/${data.id}/${deleting.kind}/${deleting.id}`);
      showToast(`${deleting.kind === "education" ? "Education" : "Experience"} deleted`);
      setDeleting(null);
      load();
    } catch (e: any) {
      showToast(e?.message || "Delete failed", "err");
    } finally {
      setDeleteBusy(false);
    }
  };

  const firstLine = [
    data.technical_domain,
    data.experience_years != null ? `${data.experience_years} yrs experience` : null,
    data.city,
  ].filter(Boolean).join(" · ");
  const shownEmail = isPlaceholderEmail(data.email) ? null : displayEmail(data.email);
  const liveApps = data.profiles.filter((p) => !REJECTION_STAGES.has(p.pipeline_status)).length;
  const summaryChips: { icon: LucideIcon; label: string }[] = [
    { icon: Briefcase, label: `${data.profiles.length} linked ${data.profiles.length === 1 ? "opportunity" : "opportunities"}${data.profiles.length ? ` · ${liveApps} active` : ""}` },
    { icon: Sparkles, label: `${data.skills.length} ${data.skills.length === 1 ? "skill" : "skills"}` },
    { icon: Building2, label: `${data.experience.length} ${data.experience.length === 1 ? "role" : "roles"}` },
    { icon: GraduationCap, label: `${data.education.length} education` },
    ...(data.notice_period ? [{ icon: Clock, label: `Notice: ${data.notice_period}` }] : []),
    ...(data.expected_ctc != null ? [{ icon: Wallet, label: `Expects ${fmtLac(data.expected_ctc)} L` }] : []),
  ];

  const detailTabs: { key: string; label: string; icon: LucideIcon; count?: number }[] = [
    { key: "personal", label: "Personal Info", icon: UserRound },
    { key: "education", label: "Education", icon: GraduationCap, count: data.education.length },
    { key: "experience", label: "Experience", icon: Building2, count: data.experience.length },
    { key: "skills", label: "Skills", icon: Sparkles, count: data.skills.length },
    // "Linked Opportunities" (2 Sep 2026, user request): each row IS an
    // opportunity this candidate was put forward for. Key unchanged.
    { key: "profiles", label: "Linked Opportunities", icon: Briefcase, count: data.profiles.length },
    { key: "resumes", label: "Resumes", icon: FileText },
    { key: "matching", label: "Matching positions", icon: Target },
    { key: "outreach", label: "Outreach", icon: MessageCircle },
    { key: "emails", label: "Emails", icon: Mail },
  ];

  return (
    <div className="space-y-5">
      <button className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300" onClick={() => crmNavigate("candidates")}>
        ← Back to candidates
      </button>

      {/* ---------- Identity band (29 Sep 2026 redesign, UI only) ---------- */}
      <div className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="relative bg-gradient-to-r from-brand-700 via-indigo-700 to-violet-700 px-4 py-5 text-white sm:px-6">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3 sm:gap-4">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-base font-bold ring-2 ring-white/40 sm:h-14 sm:w-14 sm:text-lg" aria-hidden>
                {initialsFor(candName(data))}
              </span>
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-white/70">Candidate #{data.id}</div>
                <h1 className="text-display break-words text-xl font-bold leading-tight sm:text-2xl">{candName(data)}</h1>
                {firstLine && <p className="mt-1 text-sm text-white/85">{firstLine}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 ring-1 ring-inset ring-white/20">
                    <Mail size={12} aria-hidden />
                    <span className="truncate">{shownEmail || displayEmail(data.email)}</span>
                  </span>
                  {data.phone && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 ring-1 ring-inset ring-white/20">
                      <Phone size={12} aria-hidden /> {data.phone}
                    </span>
                  )}
                  {data.linkedin_url && (
                    <a href={data.linkedin_url} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 ring-1 ring-inset ring-white/20 hover:bg-white/25">
                      <Linkedin size={12} aria-hidden /> LinkedIn
                    </a>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canApplyHere && (
                <button
                  type="button"
                  className={HERO_BTN_SOLID}
                  onClick={() => setApplyOpen(true)}
                  title="Apply this candidate to an opportunity — creates their pipeline profile at Sourcing"
                >
                  <Briefcase size={15} /> Apply to Opportunity
                </button>
              )}
              {canWrite && (
                <button type="button" className={HERO_BTN} onClick={() => setShowEdit(true)}>
                  <Pencil size={14} /> Edit details
                </button>
              )}
              {canWrite && data.cv_url && (
                <button
                  type="button"
                  className={HERO_BTN}
                  onClick={parseCv}
                  disabled={parsing}
                  title="Extract domain, experience, skills, education and CTC from the CV into the fields below"
                >
                  <Wand2 size={14} /> {parsing ? "Parsing CV…" : "Auto-fill from CV"}
                </button>
              )}
            </div>
          </div>
          <div className="relative mt-4 flex flex-wrap gap-2">
            {summaryChips.map((s) => (
              <span key={s.label} className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold ring-1 ring-inset ring-white/20">
                <s.icon size={12} /> {s.label}
              </span>
            ))}
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              data.cv_url ? "bg-emerald-400/25 ring-1 ring-inset ring-emerald-200/40" : "bg-amber-400/25 ring-1 ring-inset ring-amber-200/40"}`}>
              <FileText size={12} /> {data.cv_url ? "CV on file" : "No CV yet"}
            </span>
            {data.resignation_status && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold ring-1 ring-inset ring-white/20">
                Resigned{data.last_working_day ? ` · LWD ${fmtDate(data.last_working_day)}` : ""}
              </span>
            )}
          </div>
        </div>

        {/* Documents strip — the CV and the resignation certificate, with their uploads. */}
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 sm:px-6">
          <div className="flex flex-wrap items-center gap-3 rounded-control border border-subtle bg-surface-2 px-3 py-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-gradient-to-br from-sky-500 to-indigo-600 text-white" aria-hidden>
              <FileText size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted">Resume / CV</div>
              <div className="truncate text-sm">
                {data.cv_url ? <FileLink url={data.cv_url} label="View CV" /> : <span className="text-muted">Not uploaded yet</span>}
              </div>
            </div>
            {canWrite && (
              <FileUploadButton
                path={`/api/candidates/${data.id}/cv`}
                label={data.cv_url ? "Replace CV" : "Upload CV"}
                accept=".pdf,.doc,.docx"
                onDone={(d) => {
                  setData({ ...data, cv_url: d?.cv_url || data.cv_url });
                  showToast("CV uploaded — details auto-filled from CV");
                  load();
                }}
                onError={(m) => showToast(m, "err")}
              />
            )}
          </div>
          {/* Resignation / relieving certificate — TA attaches it here when the
              candidate hands it over. Stored on the candidate, so it shows on
              every Candidate Profile for them (Sales / Sales Head can open it). */}
          <div className="flex flex-wrap items-center gap-3 rounded-control border border-subtle bg-surface-2 px-3 py-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-gradient-to-br from-teal-500 to-emerald-600 text-white" aria-hidden>
              <FileBadge size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted">Resignation certificate</div>
              <div className="truncate text-sm">
                {data.resignation_certificate_url
                  ? <FileLink url={data.resignation_certificate_url} label="Resignation certificate" />
                  : <span className="text-muted">Not uploaded</span>}
              </div>
            </div>
            {canWrite && (
              <FileUploadButton
                path={`/api/candidates/${data.id}/resignation-certificate`}
                label={data.resignation_certificate_url ? "Replace resignation cert." : "Upload resignation cert."}
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                onDone={(d) => {
                  setData({
                    ...data,
                    resignation_certificate_url:
                      d?.resignation_certificate_url || data.resignation_certificate_url,
                    resignation_status: d?.resignation_status ?? data.resignation_status,
                  });
                  showToast("Resignation certificate uploaded");
                  load();
                }}
                onError={(m) => showToast(m, "err")}
              />
            )}
          </div>
        </div>

        {/* Tab strip with icons (same keys, same ?tab= deep links). */}
        <div className="overflow-x-auto border-t border-subtle px-2 sm:px-4">
          <div className="flex min-w-max gap-1" role="tablist" aria-label="Candidate sections">
            {detailTabs.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.key)}
                  className={`relative inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-3 text-sm font-semibold transition-colors ${focusRing} ${
                    active ? "text-brand-600 dark:text-brand-300" : "text-muted hover:text-primary"}`}
                >
                  <t.icon size={15} />
                  {t.label}
                  {t.count !== undefined && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
                      active ? "bg-brand-600 text-white" : "bg-surface-2 text-secondary ring-1 ring-inset ring-subtle"}`}>
                      {t.count}
                    </span>
                  )}
                  {active && <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-500" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {tab === "personal" && (
        <PersonalInfoGrid
          c={data}
          action={canWrite ? (
            <button className={btnSecondary} onClick={() => setShowEdit(true)}>
              <Pencil size={14} /> Edit
            </button>
          ) : null}
        />
      )}

      {tab === "education" && (
        <SectionCard
          icon={GraduationCap}
          accent="from-violet-500 to-indigo-600"
          title="Education"
          subtitle={`${data.education.length} record${data.education.length === 1 ? "" : "s"}`}
          action={canWrite ? (
            <button className={btnPrimary} onClick={() => setEduModal({ open: true })}>
              <Plus size={15} /> Add education
            </button>
          ) : null}
        >
          {data.education.length === 0 ? (
            <EmptyState message="No education records" icon={<GraduationCap size={22} />} />
          ) : (
            <Timeline
              items={data.education.map((r) => ({
                key: r.id,
                title: r.course,
                subtitle: r.institution || "—",
                from: fmtDate(r.start_date),
                to: fmtDate(r.end_date),
                current: false,
                certificate: r.certificate_url,
                onEdit: canWrite ? () => setEduModal({ open: true, item: r }) : undefined,
                onDelete: canWrite ? () => setDeleting({ kind: "education", id: r.id, label: r.course }) : undefined,
              }))}
              dot="bg-violet-500"
            />
          )}
        </SectionCard>
      )}

      {tab === "experience" && (
        <SectionCard
          icon={Building2}
          accent="from-sky-500 to-brand-600"
          title="Experience"
          subtitle={`${data.experience.length} role${data.experience.length === 1 ? "" : "s"}${data.experience_years != null ? ` · ${data.experience_years} yrs in total` : ""}`}
          action={canWrite ? (
            <button className={btnPrimary} onClick={() => setExpModal({ open: true })}>
              <Plus size={15} /> Add experience
            </button>
          ) : null}
        >
          {data.experience.length === 0 ? (
            <EmptyState message="No experience records" icon={<Building2 size={22} />} />
          ) : (
            <Timeline
              items={data.experience.map((r) => ({
                key: r.id,
                title: r.job_title || "—",
                subtitle: r.company_name,
                from: fmtDate(r.start_date),
                to: r.is_current ? "Present" : fmtDate(r.end_date),
                current: !!r.is_current,
                certificate: r.certificate_url,
                onEdit: canWrite ? () => setExpModal({ open: true, item: r }) : undefined,
                onDelete: canWrite ? () => setDeleting({ kind: "experience", id: r.id, label: r.company_name }) : undefined,
              }))}
              dot="bg-sky-500"
            />
          )}
        </SectionCard>
      )}

      {tab === "skills" && (
        <SectionCard
          icon={Sparkles}
          accent="from-amber-500 to-rose-500"
          title="Skills"
          subtitle={`${data.skills.length} recorded${data.technical_domain ? ` · ${data.technical_domain}` : ""}`}
          action={canWrite ? (
            <button className={btnSecondary} onClick={() => setSkillsModal(true)}>
              <Pencil size={14} /> Edit skills
            </button>
          ) : null}
        >
          {data.skills.length === 0 ? (
            <EmptyState message="No skills recorded" icon={<Sparkles size={22} />} />
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.skills.map((s, i) => (
                <span
                  key={s.skill_id}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${SKILL_TONES[i % SKILL_TONES.length]}`}
                >
                  <Check size={12} aria-hidden /> {s.name}
                </span>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {tab === "profiles" && (
        <SectionCard
          icon={Briefcase}
          accent="from-indigo-500 to-violet-600"
          title="Linked Opportunities"
          subtitle={data.profiles.length ? `${data.profiles.length} application${data.profiles.length === 1 ? "" : "s"} · ${liveApps} active` : "Every opportunity this candidate was put forward for"}
          action={canApplyHere ? (
            <button type="button" className={btnPrimary} onClick={() => setApplyOpen(true)}>
              <Plus size={15} /> Apply to Opportunity
            </button>
          ) : null}
        >
          {data.profiles.length === 0 ? (
            <EmptyState message="Not applied to any opportunity yet" icon={<Briefcase size={22} />} />
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {data.profiles.map((r) => (
                <li key={r.id}>
                  <CrmLink
                    to={`profiles/${r.id}`}
                    className={`group block h-full rounded-card border border-subtle bg-surface-2 p-4 transition-colors hover:border-brand-500 hover:bg-surface-1 ${focusRing}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-primary group-hover:text-brand-600 dark:group-hover:text-brand-300">
                          {r.opportunity_title}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                          {r.opportunity_opp_id && <span className="font-mono">{r.opportunity_opp_id}</span>}
                          <span>{r.customer_name || "—"}</span>
                        </div>
                      </div>
                      <ChevronRight size={16} className="mt-0.5 shrink-0 text-muted group-hover:text-brand-600" aria-hidden />
                    </div>
                    <div className="mt-2">
                      <CandidateStatusBadge status={r.candidate_status} stage={r.pipeline_status} />
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <MiniFact label="Rounds" value={r.interview_rounds ? String(r.interview_rounds) : "—"} />
                      <MiniFact label="Exp. CTC (Lac)" value={fmtLac(r.expected_ctc)} />
                      <MiniFact label="TA" value={r.ta_owner_name || "—"} />
                      <MiniFact label="Applied" value={r.applied_on ? new Date(r.applied_on).toLocaleDateString() : "—"} />
                    </dl>
                  </CrmLink>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {tab === "resumes" && (
        <ResumeLibraryTab candidateId={data.id} canWrite={canWrite} notify={showToast} onChanged={load} />
      )}
      {tab === "matching" && (
        <MatchingPositionsTab candidateId={data.id} isTa={isTa} notify={showToast} onApplied={load}
          candidateName={candName(data)} />
      )}
      {tab === "outreach" && (
        <SectionCard icon={MessageCircle} accent="from-teal-500 to-emerald-600" title="Outreach"
          subtitle="Calls, emails and messages logged by the team">
          <OutreachTab candidateId={data.id} showToast={showToast} />
        </SectionCard>
      )}
      {tab === "emails" && (
        <SectionCard icon={Mail} accent="from-sky-500 to-indigo-600" title="Emails"
          subtitle="Every email the system sent to this candidate">
          <EmailsTab candidateId={data.id} />
        </SectionCard>
      )}

      {showEdit && (
        <CandidateFormModal
          initial={data}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false);
            showToast("Candidate updated");
            load();
          }}
        />
      )}

      {eduModal.open && (
        <EducationModal
          candidateId={data.id}
          item={eduModal.item}
          onClose={() => setEduModal({ open: false })}
          onSaved={() => {
            setEduModal({ open: false });
            showToast(eduModal.item ? "Education updated" : "Education added");
            load();
          }}
        />
      )}

      {expModal.open && (
        <ExperienceModal
          candidateId={data.id}
          item={expModal.item}
          onClose={() => setExpModal({ open: false })}
          onSaved={() => {
            setExpModal({ open: false });
            showToast(expModal.item ? "Experience updated" : "Experience added");
            load();
          }}
        />
      )}

      {skillsModal && (
        <CandidateSkillsModal
          candidateId={data.id}
          current={data.skills.map((s) => s.skill_id)}
          onClose={() => setSkillsModal(false)}
          onSaved={() => {
            setSkillsModal(false);
            showToast("Skills updated");
            load();
          }}
        />
      )}

      {deleting && (
        <ConfirmModal
          title={`Delete ${deleting.kind}`}
          message={
            <>
              Delete the {deleting.kind} record <strong>{deleting.label}</strong>? This cannot be undone.
            </>
          }
          confirmLabel="Delete"
          danger
          busy={deleteBusy}
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
      {applyOpen && (
        <ApplyToOpportunityModal
          mode="pick-opportunity"
          candidateId={data.id}
          candidateName={candName(data)}
          onClose={() => setApplyOpen(false)}
          onApplied={(msg) => { showToast(msg); load(); }}
        />
      )}
      {toast}
    </div>
  );
}

/* ------------------------------------------------------------------ outreach tab */

type CandidateEmailRow = {
  id: number; event: string; subject: string; body_text: string; status: string;
  from_name?: string | null; reply_to_email?: string | null; reply_to_name?: string | null;
  attempts: number; last_error?: string | null; created_at?: string | null; sent_at?: string | null;
};

/** Every email the system sent to this candidate (invites, hiring-interest,
 * confirmations) with delivery status and which recruiter receives the reply.
 * Outbound only — replies land in the recruiter's mailbox, not in Karnex. */
function EmailsTab({ candidateId }: { candidateId: number }) {
  const [rows, setRows] = useState<CandidateEmailRow[] | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    crmGet<CandidateEmailRow[]>(`/api/candidates/${candidateId}/emails`)
      .then((r) => { if (alive) setRows(r.data || []); })
      .catch((e: any) => { if (alive) setError(e?.message || "Failed to load emails"); });
    return () => { alive = false; };
  }, [candidateId]);

  if (error) return <ErrorBox error={error} />;
  if (rows === null) return <Spinner label="Loading email history…" />;
  if (rows.length === 0) {
    return (
      <EmptyState message="No emails sent to this candidate yet — interview invites and hiring-interest mails will appear here. (Replies go to the sending recruiter's mailbox.)" />
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        {rows.length} email{rows.length === 1 ? "" : "s"} sent to this candidate. Replies go to the
        recruiter shown on each mail — Karnex records the outbound side only.
      </p>
      {rows.map((r) => (
        <div key={r.id} className="rounded-card border border-subtle bg-surface-1">
          <button
            type="button"
            className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left"
            onClick={() => setOpenId(openId === r.id ? null : r.id)}
          >
            <StatusBadge status={r.status} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-primary">{r.subject}</span>
            <span className="text-xs text-muted">
              {r.sent_at
                ? new Date(r.sent_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
                : r.created_at
                  ? new Date(r.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
                  : "—"}
            </span>
          </button>
          {openId === r.id && (
            <div className="border-t border-subtle px-4 py-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                <span>Event: <span className="font-semibold text-secondary">{r.event}</span></span>
                {r.from_name && <span>From: <span className="font-semibold text-secondary">{r.from_name}</span></span>}
                {r.reply_to_email && (
                  <span>Replies go to: <span className="font-semibold text-secondary">{r.reply_to_name || r.reply_to_email}</span></span>
                )}
                {r.status === "Failed" && r.last_error && (
                  <span className="text-danger">Error: {r.last_error} ({r.attempts} attempts)</span>
                )}
              </div>
              <pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-card bg-surface-2 p-3 text-sm leading-relaxed text-primary font-sans">
                {r.body_text}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function OutreachTab({
  candidateId,
  showToast,
}: {
  candidateId: number;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const me = useMe();
  const canAdd = useHasRole(...OUTREACH_WRITE_ROLES);
  const reduce = useReducedMotion();

  const [entries, setEntries] = useState<OutreachEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [deleting, setDeleting] = useState<OutreachEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    crmGet<OutreachEntry[]>(`/api/candidates/${candidateId}/outreach`)
      .then((r) => setEntries(r.data || []))
      .catch((e: any) => setError(e?.message || "Failed to load outreach log"))
      .finally(() => setLoading(false));
  }, [candidateId]);

  useEffect(() => { load(); }, [load]);

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await crmDelete(`/api/outreach/${deleting.id}`);
      showToast("Outreach entry deleted");
      setDeleting(null);
      load();
    } catch (e: any) {
      showToast(e?.message || "Delete failed", "err");
    } finally {
      setDeleteBusy(false);
    }
  };

  // Chronological feed, most recent touchpoint first.
  const sorted = [...entries].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  if (loading) return <Spinner label="Loading outreach…" />;

  return (
    <div className="space-y-3">
      {canAdd && (
        <div className="flex justify-end">
          <button className={btnPrimary} onClick={() => setShowLog(true)}>
            <Plus size={15} /> Log outreach
          </button>
        </div>
      )}

      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : sorted.length === 0 ? (
        <div className="glass rounded-panel">
          <EmptyState
            message="No outreach logged yet — record calls, emails and messages to keep the team in sync."
            icon={<Phone size={22} />}
            actionLabel={canAdd ? "Log outreach" : undefined}
            onAction={canAdd ? () => setShowLog(true) : undefined}
          />
        </div>
      ) : (
        <div className="space-y-2.5">
          {sorted.map((e, i) => {
            const Icon = CHANNEL_ICONS[e.channel] || MoreHorizontal;
            const own = e.username === me.username;
            return (
              <motion.div
                key={e.id}
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={reduce ? undefined : { opacity: 1, y: 0 }}
                transition={reduce ? undefined : { duration: 0.25, ease: "easeOut", delay: Math.min(i, 12) * 0.03 }}
                className="glass flex items-start gap-3 rounded-panel p-4"
              >
                <span
                  className="elev-1 mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-brand-600 dark:text-brand-300"
                  aria-hidden
                >
                  <Icon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-primary">{e.channel}</span>
                    {e.outcome && (
                      <span className="inline-flex rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-subtle dark:bg-brand-900/40 dark:text-brand-300">
                        {e.outcome}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-secondary">
                    {e.note}
                  </p>
                  <div className="mt-1.5 text-xs text-muted">
                    {e.username} · {fmtDateTime(e.created_at)}
                  </div>
                </div>
                {own && (
                  <button
                    className={`shrink-0 rounded-control p-1.5 text-danger hover:bg-danger-soft ${focusRing}`}
                    onClick={() => setDeleting(e)}
                    aria-label="Delete outreach entry"
                    title="Delete this entry (yours)"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {showLog && (
        <LogOutreachModal
          candidateId={candidateId}
          onClose={() => setShowLog(false)}
          onSaved={() => {
            setShowLog(false);
            showToast("Outreach logged");
            load();
          }}
        />
      )}
      {deleting && (
        <ConfirmModal
          title="Delete outreach entry"
          message={
            <>
              Delete your <strong>{deleting.channel}</strong> outreach entry from{" "}
              <strong>{fmtDateTime(deleting.created_at)}</strong>? This cannot be undone.
            </>
          }
          confirmLabel="Delete"
          danger
          busy={deleteBusy}
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function LogOutreachModal({
  candidateId,
  onClose,
  onSaved,
}: {
  candidateId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [channel, setChannel] = useState("Call");
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState("");
  const [noteErr, setNoteErr] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (note.trim().length < 5) {
      setNoteErr("Note must be at least 5 characters");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await crmPost(`/api/candidates/${candidateId}/outreach`, {
        channel,
        note: note.trim(),
        outcome: outcome.trim() || null,
      });
      onSaved();
    } catch (e: any) {
      setError(e?.message || "Failed to log outreach");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={<span className="sr-only">Log outreach</span>}
      onClose={onClose}
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title="Log outreach"
        subtitle="Record a call, email, or message so the team stays in sync on this candidate."
        icon={<MessageSquarePlus size={20} aria-hidden />}
      >
        {error && <div className="mb-3"><ErrorBox error={error} /></div>}
        <div className="space-y-5">
          <WizardField label="Channel" required>
            <select className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value)}>
              {OUTREACH_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </WizardField>
          <WizardField label="Note" required error={noteErr}>
            <textarea
              className={inputCls}
              rows={4}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                if (noteErr) setNoteErr("");
              }}
              placeholder="What was discussed? Next steps? (min 5 characters)"
            />
          </WizardField>
          <WizardField label="Outcome (optional)" filled={!!outcome.trim()}>
            <input
              className={inputCls}
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              placeholder="e.g. Interested, Call back next week, No answer"
            />
          </WizardField>
        </div>
        <div className={wizFooterRow}>
          <button className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`} onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Log outreach"}
          </button>
        </div>
      </WizFormShell>
    </Modal>
  );
}

/* ------------------------------------------------------------------ detail helpers */

/** Closed candidacies — everything else counts as "active" in the header chip. */
const REJECTION_STAGES = new Set([
  "Sales_Rejected", "RMG_Rejected", "Customer_Rejected", "Self_Withdrawn", "Rejected",
]);

/** Colour cycle for the skill chip cloud (real palette colours — alpha is safe on these). */
const SKILL_TONES = [
  "bg-indigo-500/10 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300",
  "bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300",
  "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
  "bg-violet-500/10 text-violet-700 ring-violet-500/25 dark:text-violet-300",
  "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300",
  "bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-300",
  "bg-teal-500/10 text-teal-700 ring-teal-500/25 dark:text-teal-300",
];

function initialsFor(name?: string | null): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] || "" : "")).toUpperCase();
}

/** A tidy white section card with a gradient icon tile, a title and an optional action. */
function SectionCard({
  icon: Icon, accent, title, subtitle, action, children,
}: {
  icon: LucideIcon;
  accent: string;
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-control bg-gradient-to-br text-white shadow-raised ${accent}`} aria-hidden>
            <Icon size={17} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-primary">{title}</h2>
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function MiniFact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-control bg-surface-1 px-2 py-1.5 ring-1 ring-inset ring-subtle">
      <dt className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="truncate text-xs font-semibold text-primary">{value}</dd>
    </div>
  );
}

/** Vertical timeline for education and experience entries. */
function Timeline({
  items, dot,
}: {
  items: {
    key: number; title: string; subtitle: string; from: string; to: string; current: boolean;
    certificate?: string | null; onEdit?: () => void; onDelete?: () => void;
  }[];
  dot: string;
}) {
  return (
    <ol className="relative ml-2 border-l-2 border-subtle">
      {items.map((it) => (
        <li key={it.key} className="relative pb-5 pl-5 last:pb-0">
          <span aria-hidden className={`absolute -left-[7px] top-1.5 h-3 w-3 rounded-full ring-4 ring-surface-1 ${it.current ? "bg-emerald-500" : dot}`} />
          <div className="flex flex-wrap items-start justify-between gap-2 rounded-card border border-subtle bg-surface-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-primary">{it.title}</span>
                {it.current && (
                  <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">Current</span>
                )}
              </div>
              <div className="text-sm text-secondary">{it.subtitle}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span className="inline-flex items-center gap-1"><CalendarDays size={12} aria-hidden /> {it.from} – {it.to}</span>
                {it.certificate && <span className="text-xs"><FileLink url={it.certificate} label="Certificate" /></span>}
              </div>
            </div>
            {(it.onEdit || it.onDelete) && (
              <span className="flex shrink-0 gap-1">
                {it.onEdit && (
                  <button className={`rounded-control p-1.5 text-muted hover:bg-surface-1 ${focusRing}`} onClick={it.onEdit} aria-label="Edit">
                    <Pencil size={14} />
                  </button>
                )}
                {it.onDelete && (
                  <button className={`rounded-control p-1.5 text-danger hover:bg-danger-soft ${focusRing}`} onClick={it.onDelete} aria-label="Delete">
                    <Trash2 size={14} />
                  </button>
                )}
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function PersonalInfoGrid({ c, action }: { c: CandidateDetail; action?: React.ReactNode }) {
  const designations = useMaster<DesignationOpt>("/api/designations");
  const locations = useMaster<LocationOpt>("/api/locations");
  const designation = designations.find((d) => d.id === c.designation_id);
  const location = locations.find((l) => l.id === c.preferred_location_id);

  // Every stored field is shown. Several of these (salutation, middle name, DOB,
  // gender, experience, notice period, roles, current CTC) were captured by the
  // form and saved, but never rendered back — so the page under-reported what the
  // record actually held. Grouped into section cards (29 Sep 2026, UI only).
  const sections: { title: string; icon: LucideIcon; accent: string; rows: [string, React.ReactNode][] }[] = [
    {
      title: "Identity", icon: UserRound, accent: "from-indigo-500 to-violet-600",
      rows: [
        ["Salutation", c.salutation || "—"],
        ["First name", c.first_name],
        ["Middle name", c.middle_name || "—"],
        ["Last name", c.last_name || "—"],
        ["Gender", c.gender || "—"],
        ["Date of birth", fmtDate(c.date_of_birth)],
      ],
    },
    {
      title: "Contact", icon: Phone, accent: "from-sky-500 to-brand-600",
      rows: [
        ["Email", displayEmail(c.email)],
        ["Phone", c.phone || "—"],
        ["City", c.city || "—"],
        [
          "LinkedIn",
          c.linkedin_url ? (
            <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline dark:text-brand-300">
              {c.linkedin_url}
            </a>
          ) : (
            "—"
          ),
        ],
        ["Current address", c.current_address || "—"],
        ["Permanent address", c.permanent_address || "—"],
      ],
    },
    {
      title: "Professional", icon: Briefcase, accent: "from-teal-500 to-emerald-600",
      rows: [
        ["Experience (years)", c.experience_years ?? "—"],
        ["Technical domain", c.technical_domain || "—"],
        ["Roles", c.roles || "—"],
        ["Designation", designation ? designation.name : c.designation_id ? `#${c.designation_id}` : "—"],
        [
          "Preferred location",
          // The full list when the export carried several; otherwise the single FK.
          c.preferred_locations ||
            (location ? locLabel(location) : c.preferred_location_id ? `#${c.preferred_location_id}` : "—"),
        ],
      ],
    },
    {
      title: "Compensation & availability", icon: Wallet, accent: "from-amber-500 to-orange-600",
      rows: [
        ["Current CTC (Lac)", fmtLac(c.current_ctc)],
        ["Expected CTC (Lac)", fmtLac(c.expected_ctc)],
        ["Notice period", c.notice_period || "—"],
        ["Resignation status", c.resignation_status ? "Resigned / serving notice" : "Not resigned"],
        ["Last working day", fmtDate(c.last_working_day)],
      ],
    },
    {
      title: "Record", icon: FileText, accent: "from-slate-500 to-slate-700",
      rows: [
        ["Recruiter", c.recruiter_email || "—"],
        ["CV file", c.cv_original_filename || "—"],
        ["Zoho ID", c.zoho_candidate_id ? <span className="font-mono text-xs">{c.zoho_candidate_id}</span> : "—"],
        ["Added in Zoho", fmtDate(c.source_created_date)],
        ["Created", fmtDate(c.created_at)],
      ],
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-primary">Personal information</h2>
        {action}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {sections.map((s) => (
          <SectionCard key={s.title} icon={s.icon} accent={s.accent} title={s.title}>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {s.rows.map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
                  <dd className="mt-0.5 break-words text-sm text-primary">{value}</dd>
                </div>
              ))}
            </dl>
          </SectionCard>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ education modal */

function EducationModal({
  candidateId,
  item,
  onClose,
  onSaved,
}: {
  candidateId: number;
  item?: Education;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [course, setCourse] = useState(item?.course || "");
  const [institution, setInstitution] = useState(item?.institution || "");
  const [startDate, setStartDate] = useState(item?.start_date ? item.start_date.slice(0, 10) : "");
  const [endDate, setEndDate] = useState(item?.end_date ? item.end_date.slice(0, 10) : "");
  const [certificateUrl, setCertificateUrl] = useState(item?.certificate_url || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!course.trim()) return setError("Course is required");
    setBusy(true);
    setError("");
    const payload = {
      course: course.trim(),
      institution: institution.trim() || null,
      start_date: startDate || null,
      end_date: endDate || null,
      certificate_url: certificateUrl.trim() || null,
    };
    try {
      if (item) await crmPut(`/api/candidates/${candidateId}/education/${item.id}`, payload);
      else await crmPost(`/api/candidates/${candidateId}/education`, payload);
      onSaved();
    } catch (e: any) {
      setError(e?.message || "Failed to save education");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={<span className="sr-only">{item ? "Edit education" : "Add education"}</span>}
      onClose={onClose}
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title={item ? "Edit education" : "Add education"}
        subtitle="Add a qualification, the awarding institution, and dates."
        icon={<GraduationCap size={20} aria-hidden />}
      >
        {error && <div className="mb-3"><ErrorBox error={error} /></div>}
        <div className="space-y-5">
          <WizardField label="Course" required filled={!!course.trim()}>
            <input className={inputCls} value={course} onChange={(e) => setCourse(e.target.value)} placeholder="e.g. B.Tech Computer Science" />
          </WizardField>
          <WizardField label="Institution" icon="building" filled={!!institution.trim()}>
            <input className={inputCls} value={institution} onChange={(e) => setInstitution(e.target.value)} />
          </WizardField>
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <WizardField label="Start date" icon="calendar" filled={!!startDate}>
              <input className={inputCls} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </WizardField>
            <WizardField label="End date" icon="calendar" filled={!!endDate}>
              <input className={inputCls} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </WizardField>
          </div>
          <WizardField label="Certificate URL" filled={!!certificateUrl.trim()}>
            <input className={inputCls} value={certificateUrl} onChange={(e) => setCertificateUrl(e.target.value)} placeholder="https://…" />
          </WizardField>
        </div>
        <div className={wizFooterRow}>
          <button className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`} onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </WizFormShell>
    </Modal>
  );
}

/* ------------------------------------------------------------------ experience modal */

function ExperienceModal({
  candidateId,
  item,
  onClose,
  onSaved,
}: {
  candidateId: number;
  item?: Experience;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [company, setCompany] = useState(item?.company_name || "");
  const [jobTitle, setJobTitle] = useState(item?.job_title || "");
  const [startDate, setStartDate] = useState(item?.start_date ? item.start_date.slice(0, 10) : "");
  const [endDate, setEndDate] = useState(item?.end_date ? item.end_date.slice(0, 10) : "");
  const [isCurrent, setIsCurrent] = useState(!!item?.is_current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!company.trim()) return setError("Company name is required");
    setBusy(true);
    setError("");
    const payload = {
      company_name: company.trim(),
      job_title: jobTitle.trim() || null,
      start_date: startDate || null,
      end_date: isCurrent ? null : endDate || null,
      is_current: isCurrent,
    };
    try {
      if (item) await crmPut(`/api/candidates/${candidateId}/experience/${item.id}`, payload);
      else await crmPost(`/api/candidates/${candidateId}/experience`, payload);
      onSaved();
    } catch (e: any) {
      setError(e?.message || "Failed to save experience");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={<span className="sr-only">{item ? "Edit experience" : "Add experience"}</span>}
      onClose={onClose}
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title={item ? "Edit experience" : "Add experience"}
        subtitle="Add a previous or current role, employer, and dates."
        icon={<Briefcase size={20} aria-hidden />}
      >
        {error && <div className="mb-3"><ErrorBox error={error} /></div>}
        <div className="space-y-5">
          <WizardField label="Company" required icon="building" filled={!!company.trim()}>
            <input className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} />
          </WizardField>
          <WizardField label="Job title" icon="user" filled={!!jobTitle.trim()}>
            <input className={inputCls} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </WizardField>
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <WizardField label="Start date" icon="calendar" filled={!!startDate}>
              <input className={inputCls} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </WizardField>
            <WizardField label="End date" icon="calendar" filled={!!endDate && !isCurrent}>
              <input className={inputCls} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={isCurrent} />
            </WizardField>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-secondary">
            <input type="checkbox" checked={isCurrent} onChange={(e) => setIsCurrent(e.target.checked)} />
            Currently working here
          </label>
        </div>
        <div className={wizFooterRow}>
          <button className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`} onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </WizFormShell>
    </Modal>
  );
}

/* ------------------------------------------------------------------ skills modal */

function CandidateSkillsModal({
  candidateId,
  current,
  onClose,
  onSaved,
}: {
  candidateId: number;
  current: number[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [all, setAll] = useState<SkillOpt[]>([]);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(current));
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchAllMaster<SkillOpt>("/api/skills", { is_active: true })
      .then((rows) => setAll(rows))
      .catch((e: any) => setError(e?.message || "Failed to load skills"));
  }, []);

  const toggle = (id: number) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await crmPost(`/api/candidates/${candidateId}/skills`, { skill_ids: Array.from(selected) });
      onSaved();
    } catch (e: any) {
      setError(e?.message || "Failed to update skills");
      setBusy(false);
    }
  };

  const shown = all.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Modal
      title={<span className="sr-only">Edit skills</span>}
      onClose={onClose}
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title="Edit skills"
        subtitle="Select the skills this candidate has. Filter to find skills quickly."
        icon={<ListChecks size={20} aria-hidden />}
      >
        {error && <div className="mb-3"><ErrorBox error={error} /></div>}
        <WizardField label="Filter skills">
          <input className={inputCls} placeholder="Filter skills…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </WizardField>
        <div className="mt-4 max-h-72 space-y-1 overflow-y-auto rounded-control border border-subtle p-2">
          {shown.length === 0 && <div className="py-4 text-center text-sm text-muted">No skills found</div>}
          {shown.map((s) => (
            <label
              key={s.id}
              className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-sm text-primary hover:bg-surface-2"
            >
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
              {s.name}
              {s.category && <span className="text-xs text-muted">({s.category})</span>}
            </label>
          ))}
        </div>
        <div className={wizFooterRow}>
          <button className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`} onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save skills"}
          </button>
        </div>
      </WizFormShell>
    </Modal>
  );
}
