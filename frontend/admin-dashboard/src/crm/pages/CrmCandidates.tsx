/** Candidate master pages: searchable list + detail with personal info,
 * education, experience, skills and linked candidate-profiles tabs. */
import React, { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Briefcase, FileText, GraduationCap, Linkedin, ListChecks, Mail, MessageCircle, MessageSquarePlus, MoreHorizontal, Pencil, Phone, Plus, Trash2, User } from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut, qs } from "../api";
import { fetchAllMaster } from "../lib/fetchAllMaster";
import type { Meta } from "../api";
import { ApplyToOpportunityModal } from "../components/ApplyToOpportunityModal";
import { displayEmail, isPlaceholderEmail } from "../lib/candidateEmail";
import { useHasRole, useMe } from "../CrmApp";
import { useCrmAccess } from "../useAccess";
import { crmNavigate, useCrmParams } from "../routerHooks";
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
  Tabs,
  btnPrimary,
  btnSecondary,
  inputCls,
  useToast,
} from "../components/ui";
import { TeachingEmpty } from "../components/TeachingEmpty";
import {
  SectionHeaderBanner, WizardField,
} from "../components/wizard";

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
  return isNaN(d.getTime()) ? "—" : d.toLocaleString();
};
const fmtMoney = (v?: number | null) => (v === null || v === undefined ? "—" : Number(v).toLocaleString());
/** CTC is stored in rupees; recruiters read and quote it in lakhs. 2200000 -> "22.00". */
const LAKH = 100000;
const fmtLac = (v?: number | null) =>
  v === null || v === undefined ? "—" : (Number(v) / LAKH).toFixed(2);
/** Lakhs typed into a form -> rupees for the API. */
const lacToRupees = (v: string) => (v === "" ? null : Math.round(Number(v) * LAKH));
/** Rupees from the API -> lakhs for a form field. */
const rupeesToLac = (v?: number | null) =>
  v === null || v === undefined ? "" : String(Number(v) / LAKH);
const candName = (c: Candidate) => c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ");
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
  // Applying a candidate to a requirement is TA's job (sourcing) — Admin/CEO pass too.
  const isTAUser = useHasRole("TA");
  // Roles allowed to create a Candidate Profile (POST /api/candidate-profiles).
  const canApply = useHasRole("TA", "Sales", "RMG");
  const skills = useMaster<SkillOpt>("/api/skills?is_active=true");

  const [rows, setRows] = useState<Candidate[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [skillId, setSkillId] = useState("");
  // "" = all, "yes" = resume on file, "no" = still missing a CV
  const [hasCv, setHasCv] = useState("");
  const [domain, setDomain] = useState("");
  const [debounced, setDebounced] = useState({ search: "", domain: "" });
  const [showCreate, setShowCreate] = useState(false);
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
        })}`,
      );
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load candidates");
    } finally {
      setLoading(false);
    }
  }, [page, debounced, skillId, hasCv]);

  useEffect(() => {
    load();
  }, [load]);

  const columns: Column<Candidate>[] = [
    { key: "full_name", label: "Name", render: (r) => <span className="font-semibold">{candName(r)}</span> },
    { key: "email", label: "Email", render: (r) => displayEmail(r.email) },
    { key: "phone", label: "Phone", render: (r) => r.phone || "—" },
    { key: "city", label: "City", render: (r) => r.city || "—" },
    {
      key: "experience_years",
      label: "Exp (yrs)",
      align: "right",
      render: (r) => (r.experience_years ?? "—"),
    },
    { key: "technical_domain", label: "Domain", render: (r) => r.technical_domain || "—" },
    { key: "current_ctc", label: "Current CTC (Lac)", align: "right", render: (r) => fmtLac(r.current_ctc) },
    { key: "expected_ctc", label: "Expected CTC (Lac)", align: "right", render: (r) => fmtLac(r.expected_ctc) },
    {
      key: "cv_url",
      label: "CV",
      render: (r) =>
        r.cv_url ? (
          <span
            className="inline-flex items-center gap-1 text-xs font-semibold text-success"
            title={r.cv_original_filename || "Resume on file"}
          >
            <FileText size={13} /> Yes
          </span>
        ) : (
          <span className="text-xs text-muted">—</span>
        ),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-display text-xl font-bold text-primary">Candidates</h1>
        {canWrite && (
          <button className={btnPrimary} onClick={() => setShowCreate(true)}>
            <Plus size={15} /> New Candidate
          </button>
        )}
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
          onRowClick={(r) => crmNavigate(`candidates/${r.id}`)}
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
            </>
          }
          emptyMessage={<TeachingEmpty page="candidates" />}
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

function CandidateFormModal({
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
    recruiter_email: init.recruiter_email || "",
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

  const submit = async (opts?: { skipDupCheck?: boolean }) => {
    if (!form.first_name.trim()) return setError("First name is required");
    if (!form.email.trim()) return setError("Email is required");
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
      onSaved(res.data);
    } catch (e: any) {
      setError(e?.message || "Failed to save candidate");
      setBusy(false);
    }
  };

  const secHead = "sm:col-span-2 mt-1 border-t border-subtle pt-3 text-xs font-bold uppercase tracking-wide text-muted";

  return (
    <Modal
      title={<span className="sr-only">{isEdit ? "Edit Candidate" : "New Candidate"}</span>}
      onClose={onClose}
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title={isEdit ? "Edit Candidate" : "New Candidate"}
        subtitle="Capture the candidate's personal, professional, and compensation details."
        icon={<User size={20} aria-hidden />}
      >
      {error && <div className="mb-3"><ErrorBox error={error} /></div>}
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
        {/* Email FIRST (create): the unique key, checked before anything else so a
            duplicate is caught up front and the recruiter is pointed at the
            existing record. */}
        {!isEdit && (
          <>
            <div className={secHead}>Candidate email — checked first</div>
            <WizardField label="Email" required icon="mail" filled={!!form.email.trim()}>
              <input className={inputCls} type="email" value={form.email} autoFocus
                placeholder="Enter the candidate's email first"
                onChange={(e) => { set("email", e.target.value); if (dupes) setDupes(null); }}
                onBlur={() => void checkEmailDuplicate()} />
              {isPlaceholderEmail(form.email) && (
                <p className="mt-1 text-xs text-warning">
                  Placeholder address — replace it with the candidate&rsquo;s real one.
                </p>
              )}
            </WizardField>
            {dupes && dupes.length > 0 && (
              <div
                className={`sm:col-span-2 rounded-card border p-4 ${
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
            )}
          </>
        )}
        <div className={secHead}>Name</div>
        <WizardField label="Salutation">
          <select className={inputCls} value={form.salutation} onChange={(e) => set("salutation", e.target.value)}>
            <option value="">—</option>
            {["Mr", "Ms", "Mrs", "Dr", "Mx"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </WizardField>
        <WizardField label="First name" required icon="user" filled={!!form.first_name.trim()}>
          <input className={inputCls} value={form.first_name} disabled={locked("name")} onChange={(e) => set("first_name", e.target.value)} />
        </WizardField>
        <WizardField label="Middle name" icon="user">
          <input className={inputCls} value={form.middle_name} onChange={(e) => set("middle_name", e.target.value)} />
        </WizardField>
        <WizardField label="Last name" icon="user">
          <input className={inputCls} value={form.last_name} onChange={(e) => set("last_name", e.target.value)} />
        </WizardField>

        <div className={secHead}>Basic details</div>
        {/* Email lives up top on create; on edit it stays here so it can be replaced. */}
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
        <WizardField label="Phone" icon="phone" filled={!!form.phone.trim()}>
          <input className={inputCls} value={form.phone} disabled={locked("phone")} onChange={(e) => set("phone", e.target.value)} />
        </WizardField>
        <WizardField label="Date of birth" icon="calendar" filled={!!form.date_of_birth}>
          <input className={inputCls} type="date" value={form.date_of_birth} onChange={(e) => set("date_of_birth", e.target.value)} />
        </WizardField>
        <WizardField label="Gender">
          <select className={inputCls} value={form.gender} onChange={(e) => set("gender", e.target.value)}>
            <option value="">Select…</option>
            {["Male", "Female", "Other", "Prefer not to say"].map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </WizardField>
        <WizardField label="Experience (years)" icon="hash" filled={form.experience_years !== ""}>
          <input className={inputCls} type="number" step="0.5" min={0} value={form.experience_years} disabled={locked("experience_years")} onChange={(e) => set("experience_years", e.target.value)} />
        </WizardField>
        <WizardField label="Notice period">
          <input className={inputCls} value={form.notice_period} disabled={locked("notice_period")} onChange={(e) => set("notice_period", e.target.value)} placeholder="e.g. 30 days / Immediate" />
        </WizardField>
        <WizardField className="sm:col-span-2" label="Current address">
          <textarea className={inputCls} rows={2} value={form.current_address} onChange={(e) => set("current_address", e.target.value)} />
        </WizardField>
        <WizardField className="sm:col-span-2" label="Permanent address">
          <textarea className={inputCls} rows={2} value={form.permanent_address} onChange={(e) => set("permanent_address", e.target.value)} />
        </WizardField>

        <WizardField label="City">
          <input className={inputCls} value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Bangalore" />
        </WizardField>

        <div className={secHead}>Professional</div>
        <WizardField label="Technical domain">
          <input className={inputCls} value={form.technical_domain} onChange={(e) => set("technical_domain", e.target.value)} placeholder="e.g. Backend, Data Engineering" />
        </WizardField>
        <WizardField label="Recruiter">
          <input className={inputCls} value={form.recruiter_email} onChange={(e) => set("recruiter_email", e.target.value)} placeholder="recruiter@karnex.in" />
        </WizardField>
        <WizardField label="Preferred locations" info="Comma separated when the candidate is open to several.">
          <input className={inputCls} value={form.preferred_locations} onChange={(e) => set("preferred_locations", e.target.value)} placeholder="e.g. Bangalore, Pune" />
        </WizardField>
        <WizardField label="Roles">
          <input className={inputCls} value={form.roles} onChange={(e) => set("roles", e.target.value)} placeholder="e.g. Backend Engineer, Tech Lead" />
        </WizardField>
        <WizardField label="Designation">
          <select className={inputCls} value={form.designation_id} onChange={(e) => set("designation_id", e.target.value)}>
            <option value="">None</option>
            {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </WizardField>
        <WizardField label="LinkedIn URL" icon={<Linkedin size={15} className="text-[color:var(--wiz-muted)]" aria-hidden />}>
          <input className={inputCls} value={form.linkedin_url} onChange={(e) => set("linkedin_url", e.target.value)} placeholder="https://linkedin.com/in/…" />
        </WizardField>
        <WizardField label="Preferred location" icon="map">
          <select className={inputCls} value={form.preferred_location_id} onChange={(e) => set("preferred_location_id", e.target.value)}>
            <option value="">None</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{locLabel(l)}</option>)}
          </select>
        </WizardField>

        <div className={secHead}>Compensation</div>
        <WizardField label="Current CTC (Lac)" icon="hash" filled={form.current_ctc !== ""}>
          <input className={inputCls} type="number" min={0} step={0.01} placeholder="e.g. 22.00" value={form.current_ctc} disabled={locked("current_ctc")} onChange={(e) => set("current_ctc", e.target.value)} />
        </WizardField>
        <WizardField label="Expected CTC (Lac)" icon="hash" filled={form.expected_ctc !== ""}>
          <input className={inputCls} type="number" min={0} step={0.01} placeholder="e.g. 22.00" value={form.expected_ctc} disabled={locked("expected_ctc")} onChange={(e) => set("expected_ctc", e.target.value)} />
        </WizardField>

        <div className={secHead}>Separation</div>
        <div className="flex items-end gap-4 pb-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-secondary">
            <input type="checkbox" checked={form.resignation_status} disabled={locked("resignation")} onChange={(e) => set("resignation_status", e.target.checked)} />
            Resigned / serving notice
          </label>
        </div>
        {form.resignation_status && (
          <WizardField label="Last working day" icon="calendar" filled={!!form.last_working_day}>
            <input className={inputCls} type="date" value={form.last_working_day} disabled={locked("resignation")} onChange={(e) => set("last_working_day", e.target.value)} />
          </WizardField>
        )}
      </div>
      <div className={wizFooterRow}>
        <button className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
        {emailBlocked ? (
          <button
            className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`}
            onClick={() => { onClose(); if (emailMatch) crmNavigate(`candidates/${emailMatch.id}`); }}
            disabled={busy}
          >
            Open existing candidate
          </button>
        ) : dupes && dupes.length > 0 && !isEdit ? (
          <button
            className={`${btnSecondary} ml-auto h-10 rounded-xl px-4`}
            onClick={() => void submit({ skipDupCheck: true })}
            disabled={busy}
          >
            {busy ? "Saving…" : "Create anyway — different person"}
          </button>
        ) : (
          <button className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`} onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create Candidate"}
          </button>
        )}
      </div>
      </WizFormShell>
    </Modal>
  );
}

/* ------------------------------------------------------------------ detail page */

type DeleteTarget = { kind: "education" | "experience"; id: number; label: string };

export function CandidateDetailPage() {
  const params = useCrmParams();
  const id = params.id;
  const canWrite = useHasRole(...WRITE_ROLES);
  // Applying a candidate to a requirement is TA's job (sourcing) — Admin/CEO pass too.
  const isTAUser = useHasRole("TA");

  const [data, setData] = useState<CandidateDetail | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("personal");
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

  const eduCols: Column<Education>[] = [
    { key: "course", label: "Course", render: (r) => <span className="font-semibold">{r.course}</span> },
    { key: "institution", label: "Institution", render: (r) => r.institution || "—" },
    { key: "start_date", label: "From", render: (r) => fmtDate(r.start_date) },
    { key: "end_date", label: "To", render: (r) => fmtDate(r.end_date) },
    { key: "certificate_url", label: "Certificate", render: (r) => <FileLink url={r.certificate_url} label="View" /> },
    ...(canWrite ? [rowActionsCol<Education>(
      (r) => setEduModal({ open: true, item: r }),
      (r) => setDeleting({ kind: "education", id: r.id, label: r.course }),
    )] : []),
  ];

  const expCols: Column<Experience>[] = [
    { key: "company_name", label: "Company", render: (r) => <span className="font-semibold">{r.company_name}</span> },
    { key: "job_title", label: "Title", render: (r) => r.job_title || "—" },
    { key: "start_date", label: "From", render: (r) => fmtDate(r.start_date) },
    { key: "end_date", label: "To", render: (r) => (r.is_current ? "Present" : fmtDate(r.end_date)) },
    { key: "certificate_url", label: "Certificate", render: (r) => <FileLink url={r.certificate_url} label="View" /> },
    ...(canWrite ? [rowActionsCol<Experience>(
      (r) => setExpModal({ open: true, item: r }),
      (r) => setDeleting({ kind: "experience", id: r.id, label: r.company_name }),
    )] : []),
  ];

  const profileCols: Column<LinkedProfile>[] = [
    {
      key: "opportunity_title",
      label: "Opportunity",
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold truncate">{r.opportunity_title}</div>
          {r.opportunity_opp_id && (
            <div className="font-mono text-xs opacity-60">{r.opportunity_opp_id}</div>
          )}
        </div>
      ),
    },
    { key: "customer_name", label: "Customer", render: (r) => r.customer_name || "—" },
    { key: "pipeline_status", label: "Pipeline Status", render: (r) => <StatusBadge status={r.pipeline_status} /> },
    {
      key: "interview_rounds",
      label: "Rounds",
      align: "right",
      render: (r) => (r.interview_rounds ? String(r.interview_rounds) : "—"),
    },
    { key: "expected_ctc", label: "Expected CTC (Lac)", align: "right", render: (r) => fmtLac(r.expected_ctc) },
    { key: "ta_owner_name", label: "TA", render: (r) => r.ta_owner_name || "—" },
    {
      key: "applied_on",
      label: "Applied",
      render: (r) => (r.applied_on ? new Date(r.applied_on).toLocaleDateString() : "—"),
    },
  ];

  return (
    <div className="space-y-5">
      <button className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300" onClick={() => crmNavigate("candidates")}>
        ← Back to candidates
      </button>

      <div className="glass fx-gradient-border rounded-card p-5 shadow-raised">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-display text-xl font-bold text-primary">{candName(data)}</h1>
            <div className="mt-1 text-sm text-muted">
              {displayEmail(data.email)}
              {data.phone ? ` · ${data.phone}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <FileLink url={data.cv_url} label="View CV" />
            {isTAUser && data.cv_url && (
              <button
                type="button"
                className={`${btnPrimary} h-10 rounded-xl`}
                onClick={() => setApplyOpen(true)}
                title="Apply this candidate directly to an open requirement — CV and details attach automatically"
              >
                <Briefcase size={15} /> Apply to Opportunity
              </button>
            )}
            {canWrite && data.cv_url && (
              <button
                type="button"
                className={`${btnSecondary} h-10 rounded-xl`}
                onClick={parseCv}
                disabled={parsing}
                title="Extract domain, experience, skills, education and CTC from the CV into the fields below"
              >
                {parsing ? "Parsing CV…" : "Auto-fill from CV"}
              </button>
            )}
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
            {/* Resignation / relieving certificate — TA attaches it here when the
                candidate hands it over. Stored on the candidate, so it shows on
                every Candidate Profile for them (Sales / Sales Head can open it). */}
            {data.resignation_certificate_url && (
              <FileLink url={data.resignation_certificate_url} label="Resignation certificate" />
            )}
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
      </div>

      <Tabs
        tabs={[
          { key: "personal", label: "Personal Info" },
          { key: "education", label: "Education", count: data.education.length },
          { key: "experience", label: "Experience", count: data.experience.length },
          { key: "skills", label: "Skills", count: data.skills.length },
          { key: "profiles", label: "Linked Profiles", count: data.profiles.length },
          { key: "outreach", label: "Outreach" },
          { key: "emails", label: "Emails" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "personal" && (
        <div className="rounded-card border border-subtle bg-surface-1 p-5 shadow-raised">
          <div className="fx-hairline-b mb-3 flex items-center justify-between pb-3">
            <h2 className="text-base font-bold text-primary">Personal information</h2>
            {canWrite && (
              <button className={btnSecondary} onClick={() => setShowEdit(true)}>
                <Pencil size={14} /> Edit
              </button>
            )}
          </div>
          <PersonalInfoGrid c={data} />
        </div>
      )}

      {tab === "education" && (
        <div>
          {canWrite && (
            <div className="mb-3 flex justify-end">
              <button className={btnPrimary} onClick={() => setEduModal({ open: true })}>
                <Plus size={15} /> Add education
              </button>
            </div>
          )}
          <DataTable<Education> columns={eduCols} rows={data.education} emptyMessage="No education records" />
        </div>
      )}

      {tab === "experience" && (
        <div>
          {canWrite && (
            <div className="mb-3 flex justify-end">
              <button className={btnPrimary} onClick={() => setExpModal({ open: true })}>
                <Plus size={15} /> Add experience
              </button>
            </div>
          )}
          <DataTable<Experience> columns={expCols} rows={data.experience} emptyMessage="No experience records" />
        </div>
      )}

      {tab === "skills" && (
        <div className="rounded-card border border-subtle bg-surface-1 p-5 shadow-raised">
          <div className="fx-hairline-b mb-3 flex items-center justify-between pb-3">
            <h2 className="text-base font-bold text-primary">Skills</h2>
            {canWrite && (
              <button className={btnSecondary} onClick={() => setSkillsModal(true)}>
                <Pencil size={14} /> Edit skills
              </button>
            )}
          </div>
          {data.skills.length === 0 ? (
            <div className="text-sm text-muted">No skills recorded</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.skills.map((s) => (
                <span
                  key={s.skill_id}
                  className="inline-flex items-center rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                >
                  {s.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "profiles" && (
        <DataTable<LinkedProfile>
          columns={profileCols}
          rows={data.profiles}
          onRowClick={(r) => crmNavigate(`profiles/${r.id}`)}
          emptyMessage="No linked candidate profiles"
        />
      )}

      {tab === "outreach" && <OutreachTab candidateId={data.id} showToast={showToast} />}
      {tab === "emails" && <EmailsTab candidateId={data.id} />}

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

function rowActionsCol<T>(onEdit: (r: T) => void, onDelete: (r: T) => void): Column<T> {
  return {
    key: "_actions",
    label: "",
    className: "!text-right",
    render: (r: T) => (
      <span className="flex justify-end gap-1">
        <button
          className="rounded-control p-1.5 text-muted hover:bg-surface-2"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(r);
          }}
          aria-label="Edit"
        >
          <Pencil size={14} />
        </button>
        <button
          className="rounded-control p-1.5 text-danger hover:bg-danger-soft"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(r);
          }}
          aria-label="Delete"
        >
          <Trash2 size={14} />
        </button>
      </span>
    ),
  };
}

function PersonalInfoGrid({ c }: { c: CandidateDetail }) {
  const designations = useMaster<DesignationOpt>("/api/designations");
  const locations = useMaster<LocationOpt>("/api/locations");
  const designation = designations.find((d) => d.id === c.designation_id);
  const location = locations.find((l) => l.id === c.preferred_location_id);

  // Every stored field is shown. Several of these (salutation, middle name, DOB,
  // gender, experience, notice period, roles, current CTC) were captured by the
  // form and saved, but never rendered back — so the page under-reported what the
  // record actually held.
  const rows: [string, React.ReactNode][] = [
    ["Salutation", c.salutation || "—"],
    ["First name", c.first_name],
    ["Middle name", c.middle_name || "—"],
    ["Last name", c.last_name || "—"],
    ["Email", displayEmail(c.email)],
    ["Phone", c.phone || "—"],
    ["Gender", c.gender || "—"],
    ["Date of birth", fmtDate(c.date_of_birth)],
    ["City", c.city || "—"],
    ["Experience (years)", c.experience_years ?? "—"],
    ["Notice period", c.notice_period || "—"],
    ["Technical domain", c.technical_domain || "—"],
    ["Roles", c.roles || "—"],
    ["Designation", designation ? designation.name : c.designation_id ? `#${c.designation_id}` : "—"],
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
    ["Current CTC (Lac)", fmtLac(c.current_ctc)],
    ["Expected CTC (Lac)", fmtLac(c.expected_ctc)],
    [
      "Preferred location",
      // The full list when the export carried several; otherwise the single FK.
      c.preferred_locations ||
        (location ? locLabel(location) : c.preferred_location_id ? `#${c.preferred_location_id}` : "—"),
    ],
    ["Resignation status", c.resignation_status ? "Resigned / serving notice" : "Not resigned"],
    ["Last working day", fmtDate(c.last_working_day)],
    ["Current address", c.current_address || "—"],
    ["Permanent address", c.permanent_address || "—"],
    ["Recruiter", c.recruiter_email || "—"],
    ["CV file", c.cv_original_filename || "—"],
    ["Zoho ID", c.zoho_candidate_id ? <span className="font-mono text-xs">{c.zoho_candidate_id}</span> : "—"],
    ["Added in Zoho", fmtDate(c.source_created_date)],
    ["Created", fmtDate(c.created_at)],
  ];

  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
          <dd className="mt-0.5 break-words text-sm text-primary">{value}</dd>
        </div>
      ))}
    </dl>
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
