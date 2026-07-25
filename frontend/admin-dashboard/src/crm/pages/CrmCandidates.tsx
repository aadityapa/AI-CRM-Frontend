/** Candidate master pages: searchable list + detail with personal info,
 * education, experience, skills and linked candidate-profiles tabs. */
import React, { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Briefcase, GraduationCap, Linkedin, ListChecks, Mail, MessageCircle, MessageSquarePlus, MoreHorizontal, Pencil, Phone, Plus, Trash2, User } from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole, useMe } from "../CrmApp";
import { crmNavigate, useCrmParams } from "../routerHooks";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { RowActions } from "../components/RowActions";
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
import {
  SectionHeaderBanner, WizardField,
} from "../components/wizard";

/** Local single-screen shell — applies the shared New Opportunity wizard look
 * (dark themed body + gradient SectionHeaderBanner) inside the existing Modal.
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
    <div className="crm-wizard wiz-noise min-h-full w-full px-4 py-6 sm:px-6 sm:py-8">
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
  first_name: string;
  last_name?: string | null;
  full_name?: string;
  email: string;
  phone?: string | null;
  current_address?: string | null;
  permanent_address?: string | null;
  technical_domain?: string | null;
  designation_id?: number | null;
  cv_url?: string | null;
  linkedin_url?: string | null;
  resignation_status?: boolean;
  last_working_day?: string | null;
  expected_ctc?: number | null;
  preferred_location_id?: number | null;
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

type LinkedProfile = {
  id: number;
  opportunity_id: number;
  opportunity_title: string;
  pipeline_status: string;
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
    crmGet<T[]>(`${path}${path.includes("?") ? "&" : "?"}limit=100`)
      .then((r) => setItems(r.data || []))
      .catch(() => {});
  }, [path]);
  return items;
}

/* ------------------------------------------------------------------ list page */

export function CandidatesListPage() {
  const canWrite = useHasRole(...WRITE_ROLES);
  const skills = useMaster<SkillOpt>("/api/skills?is_active=true");

  const [rows, setRows] = useState<Candidate[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [skillId, setSkillId] = useState("");
  const [domain, setDomain] = useState("");
  const [debounced, setDebounced] = useState({ search: "", domain: "" });
  const [showCreate, setShowCreate] = useState(false);
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
        })}`,
      );
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load candidates");
    } finally {
      setLoading(false);
    }
  }, [page, debounced, skillId]);

  useEffect(() => {
    load();
  }, [load]);

  const columns: Column<Candidate>[] = [
    { key: "full_name", label: "Name", render: (r) => <span className="font-semibold">{candName(r)}</span> },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone", render: (r) => r.phone || "—" },
    { key: "technical_domain", label: "Domain", render: (r) => r.technical_domain || "—" },
    { key: "expected_ctc", label: "Expected CTC", render: (r) => fmtMoney(r.expected_ctc) },
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
          loading={loading}
          search={search}
          onSearch={setSearch}
          onPage={setPage}
          onRowClick={(r) => crmNavigate(`candidates/${r.id}`)}
          filters={
            <>
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
          emptyMessage="No candidates found"
          rowActions={canWrite ? (r) => (
            <RowActions
              entity="candidate"
              itemLabel={candName(r)}
              onEdit={() => crmNavigate(`candidates/${r.id}`)}
              deleteUrl={`/api/candidates/${r.id}`}
              onDeleted={load}
              notify={showToast}
              canEdit
              canDelete
            />
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
    technical_domain: initial?.technical_domain || "",
    roles: init.roles || "",
    designation_id: initial?.designation_id ? String(initial.designation_id) : "",
    linkedin_url: initial?.linkedin_url || "",
    current_ctc: init.current_ctc !== null && init.current_ctc !== undefined ? String(init.current_ctc) : "",
    expected_ctc: initial?.expected_ctc !== null && initial?.expected_ctc !== undefined ? String(initial.expected_ctc) : "",
    preferred_location_id: initial?.preferred_location_id ? String(initial.preferred_location_id) : "",
    current_address: initial?.current_address || "",
    permanent_address: initial?.permanent_address || "",
    resignation_status: !!initial?.resignation_status,
    last_working_day: initial?.last_working_day ? initial.last_working_day.slice(0, 10) : "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.first_name.trim()) return setError("First name is required");
    if (!form.email.trim()) return setError("Email is required");
    setBusy(true);
    setError("");
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
      technical_domain: form.technical_domain.trim() || null,
      roles: form.roles.trim() || null,
      designation_id: form.designation_id ? Number(form.designation_id) : null,
      linkedin_url: form.linkedin_url.trim() || null,
      current_ctc: form.current_ctc !== "" ? Number(form.current_ctc) : null,
      expected_ctc: form.expected_ctc !== "" ? Number(form.expected_ctc) : null,
      preferred_location_id: form.preferred_location_id ? Number(form.preferred_location_id) : null,
      current_address: form.current_address.trim() || null,
      permanent_address: form.permanent_address.trim() || null,
      resignation_status: form.resignation_status,
      last_working_day: form.resignation_status && form.last_working_day ? form.last_working_day : null,
    };
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
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title={isEdit ? "Edit Candidate" : "New Candidate"}
        subtitle="Capture the candidate's personal, professional, and compensation details."
        icon={<User size={20} aria-hidden />}
      >
      {error && <div className="mb-3"><ErrorBox error={error} /></div>}
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <div className={secHead}>Name</div>
        <WizardField label="Salutation">
          <select className={inputCls} value={form.salutation} onChange={(e) => set("salutation", e.target.value)}>
            <option value="">—</option>
            {["Mr", "Ms", "Mrs", "Dr", "Mx"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </WizardField>
        <WizardField label="First name" required icon="user" filled={!!form.first_name.trim()}>
          <input className={inputCls} value={form.first_name} onChange={(e) => set("first_name", e.target.value)} />
        </WizardField>
        <WizardField label="Middle name" icon="user">
          <input className={inputCls} value={form.middle_name} onChange={(e) => set("middle_name", e.target.value)} />
        </WizardField>
        <WizardField label="Last name" icon="user">
          <input className={inputCls} value={form.last_name} onChange={(e) => set("last_name", e.target.value)} />
        </WizardField>

        <div className={secHead}>Basic details</div>
        <WizardField label="Email" required icon="mail" filled={!!form.email.trim()}>
          <input className={inputCls} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </WizardField>
        <WizardField label="Phone" icon="phone" filled={!!form.phone.trim()}>
          <input className={inputCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} />
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
          <input className={inputCls} type="number" step="0.5" min={0} value={form.experience_years} onChange={(e) => set("experience_years", e.target.value)} />
        </WizardField>
        <WizardField label="Notice period">
          <input className={inputCls} value={form.notice_period} onChange={(e) => set("notice_period", e.target.value)} placeholder="e.g. 30 days / Immediate" />
        </WizardField>
        <WizardField className="sm:col-span-2" label="Current address">
          <textarea className={inputCls} rows={2} value={form.current_address} onChange={(e) => set("current_address", e.target.value)} />
        </WizardField>
        <WizardField className="sm:col-span-2" label="Permanent address">
          <textarea className={inputCls} rows={2} value={form.permanent_address} onChange={(e) => set("permanent_address", e.target.value)} />
        </WizardField>

        <div className={secHead}>Professional</div>
        <WizardField label="Technical domain">
          <input className={inputCls} value={form.technical_domain} onChange={(e) => set("technical_domain", e.target.value)} placeholder="e.g. Backend, Data Engineering" />
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
        <WizardField label="Current CTC (annual)" icon="hash" filled={form.current_ctc !== ""}>
          <input className={inputCls} type="number" min={0} value={form.current_ctc} onChange={(e) => set("current_ctc", e.target.value)} />
        </WizardField>
        <WizardField label="Expected CTC (annual)" icon="hash" filled={form.expected_ctc !== ""}>
          <input className={inputCls} type="number" min={0} value={form.expected_ctc} onChange={(e) => set("expected_ctc", e.target.value)} />
        </WizardField>

        <div className={secHead}>Separation</div>
        <div className="flex items-end gap-4 pb-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-secondary">
            <input type="checkbox" checked={form.resignation_status} onChange={(e) => set("resignation_status", e.target.checked)} />
            Resigned / serving notice
          </label>
        </div>
        {form.resignation_status && (
          <WizardField label="Last working day" icon="calendar" filled={!!form.last_working_day}>
            <input className={inputCls} type="date" value={form.last_working_day} onChange={(e) => set("last_working_day", e.target.value)} />
          </WizardField>
        )}
      </div>
      <div className={wizFooterRow}>
        <button className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`} onClick={submit} disabled={busy}>
          {busy ? "Saving…" : isEdit ? "Save changes" : "Create Candidate"}
        </button>
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

  const load = useCallback(() => {
    crmGet<CandidateDetail>(`/api/candidates/${id}`)
      .then((r) => setData(r.data))
      .catch((e: any) => setError(e?.message || "Failed to load candidate"));
  }, [id]);

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
    { key: "opportunity_title", label: "Opportunity", render: (r) => <span className="font-semibold">{r.opportunity_title}</span> },
    { key: "pipeline_status", label: "Pipeline Status", render: (r) => <StatusBadge status={r.pipeline_status} /> },
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
              {data.email}
              {data.phone ? ` · ${data.phone}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <FileLink url={data.cv_url} label="View CV" />
            {canWrite && (
              <FileUploadButton
                path={`/api/candidates/${data.id}/cv`}
                label={data.cv_url ? "Replace CV" : "Upload CV"}
                accept=".pdf,.doc,.docx"
                onDone={(d) => {
                  setData({ ...data, cv_url: d?.cv_url || data.cv_url });
                  showToast("CV uploaded");
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
      {toast}
    </div>
  );
}

/* ------------------------------------------------------------------ outreach tab */

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

  const rows: [string, React.ReactNode][] = [
    ["First name", c.first_name],
    ["Last name", c.last_name || "—"],
    ["Email", c.email],
    ["Phone", c.phone || "—"],
    ["Technical domain", c.technical_domain || "—"],
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
    ["Expected CTC", fmtMoney(c.expected_ctc)],
    ["Preferred location", location ? locLabel(location) : c.preferred_location_id ? `#${c.preferred_location_id}` : "—"],
    ["Resignation status", c.resignation_status ? "Resigned / serving notice" : "Not resigned"],
    ["Last working day", fmtDate(c.last_working_day)],
    ["Current address", c.current_address || "—"],
    ["Permanent address", c.permanent_address || "—"],
    ["Created", fmtDate(c.created_at)],
  ];

  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
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
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
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
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
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
    crmGet<SkillOpt[]>("/api/skills?limit=100&is_active=true")
      .then((r) => setAll(r.data || []))
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
