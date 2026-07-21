/** Requirements workflow (Draft → approvals → sourcing) + Resume/ATS pipeline pages.
 *
 * Backend contract (routers/crm/requirements.py + resumes.py):
 *  - GET/POST /api/requirements, GET/PUT /api/requirements/{id}
 *  - POST /{id}/submit | /sales-head-approve | /sales-head-reject | /engineering-approve
 *         | /engineering-reject | /close | /cancel
 *  - GET/POST /{id}/job-postings, GET /{id}/activity-log
 *  - POST /api/requirements/{id}/resumes (multipart), GET …/resumes, POST …/resumes/scan-all
 *  - POST /api/resumes/{id}/ats-scan | /shortlist | /reject | /schedule-ai-interview
 * List `?status=` accepts a single status value; multi-status tabs fetch unfiltered
 * and filter client-side within the page.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Bot, CalendarPlus, Check, Copy, ExternalLink, Link2, Pencil, Plus, RefreshCw, ScanLine, Send, Star, Trash2, X,
} from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut, crmUpload, qs } from "../api";
import type { Meta } from "../api";
import { CrmLink, crmNavigate, useCrmParams } from "../routerHooks";
import { useHasRole, useMe } from "../CrmApp";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { FileLink, FileUploadButton } from "../components/FileUpload";
import { Timeline } from "../components/Timeline";
import type { ActivityEntry } from "../components/Timeline";
import {
  AiThinking, ConfirmModal, ErrorBox, Field, Modal, Spinner, StatusBadge, Tabs,
  btnDanger, btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";

/* ------------------------------------------------------------------ types */

type ReqSkill = { skill_id: number; name?: string; is_mandatory: boolean; min_rating: number | null };

type JdAttachment = {
  id: number;
  file_url: string;
  file_name: string | null;
  kind?: string | null;
};

type Req = {
  id: number;
  req_number: string;
  opportunity_id: number;
  customer_id: number | null;
  title: string;
  description: string | null;
  rmg_jd_text?: string | null;
  no_of_positions: number;
  experience_min: number | null;
  experience_max: number | null;
  budget_ctc_min: number | null;
  budget_ctc_max: number | null;
  work_mode: string | null;
  location_id: number | null;
  priority: string;
  target_closure_date: string | null;
  status: string;
  created_by: number;
  sales_head_approved_by: number | null;
  sales_head_approved_at: string | null;
  sales_head_rejection_reason: string | null;
  engineering_reviewed_by: number | null;
  engineering_reviewed_at: string | null;
  engineering_rejection_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
  skills: ReqSkill[];
  customer_jd_attachments?: JdAttachment[];
  rmg_jd_attachments?: JdAttachment[];
};

type ResumeRow = {
  id: number;
  requirement_id: number;
  candidate_id: number | null;
  candidate_name: string;
  email: string | null;
  phone: string | null;
  source_portal: string | null;
  applicant_experience?: string | null;
  application_details?: {
    education?: string | null;
    technical_domain?: string | null;
    skills?: string | null;
    notice_period?: string | null;
    current_ctc?: string | null;
    expected_ctc?: string | null;
    preferred_location?: string | null;
  } | null;
  resume_file_url: string | null;
  received_date: string | null;
  ats_score: number | null;
  ats_score_breakdown: {
    skills_matched?: string[];
    skills_missing?: string[];
    jd_keywords_matched?: string[];
    jd_keywords_missing?: string[];
    experience_match?: boolean;
    jd_text_preview?: string;
    score_details?: Record<string, unknown>;
  } | null;
  ats_status: string;
  screened_by: number | null;
  ai_interview_status: string | null;
  ai_interview_scheduled_at: string | null;
  ai_overall_score_percent?: number | null;
  ai_interview_result?: string | null;
  ai_report_link?: string | null;
  ai_interview_record_id?: string | null;
  profile_id?: number | null;
  ai_invite_token?: string | null;
  ai_invite_url?: string | null;
  ai_access_key?: string | null;
  created_at: string | null;
  /* Automated-pipeline flags returned by scan endpoints (ats_auto_threshold / ats_auto_invite). */
  auto_shortlisted?: boolean;
  slot_invite_sent?: boolean;
};

type JobPosting = {
  id: number;
  requirement_id: number;
  portal_name: string;
  job_post_url: string;
  posted_by: number | null;
  posted_at: string | null;
  status: string | null;
};

type Slot = {
  id: number;
  slot_at: string;
  capacity: number;
  booked_count: number;
  created_at: string;
};

type Booking = {
  id: number;
  token: string;
  resume_id: number;
  candidate_name: string;
  status: string; // Pending | Confirmed | Expired | Cancelled
  slot_at?: string | null;
  invite_url?: string | null;
  created_at: string;
  confirmed_at?: string | null;
};

type ToastFn = (msg: string, kind?: "ok" | "err") => void;

/* -------------------------------------------------------------- constants */

const EDITABLE_STATUSES = ["Draft", "Sales_Head_Rejected", "Engineering_Rejected"];
const TERMINAL_STATUSES = ["Fulfilled", "Closed", "Cancelled"];
const SOURCING_STATUSES = ["Open_For_Sourcing", "Posted_On_Portals", "In_Progress"];
const TA_FILTER_STATUSES = ["Open_For_Sourcing", "Posted_On_Portals", "In_Progress", "Fulfilled"];
const WORK_MODES = ["Remote", "Onsite", "Hybrid"];
const PRIORITIES = ["High", "Medium", "Low"];
const JOB_PORTALS = ["Naukri", "LinkedIn", "Indeed", "Other"];
const SOURCE_PORTALS = ["Naukri", "LinkedIn", "Indeed", "Referral", "Other"];

const smallBtn =
  "inline-flex items-center gap-1 rounded-lg border border-strong bg-surface-1 px-2 py-1 text-xs font-semibold text-secondary hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed";
const smallPrimary =
  "inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2 py-1 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed";
const smallSuccess =
  "inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed";
const smallDanger =
  "inline-flex items-center gap-1 rounded-lg border border-rose-300 dark:border-rose-700 px-2 py-1 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50 disabled:cursor-not-allowed";
/* Reserved AI accent — ONLY for actions that invoke AI (e.g. Schedule AI L1 Interview). */
const smallAi =
  "ai-surface inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-sky-700 dark:text-sky-300 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed";
/* Animated AI border for an in-flight scan (no disabled dimming so the ring stays visible). */
const smallScanning =
  "ai-generating inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-secondary disabled:cursor-not-allowed";
/* Token focus ring (tokens.css) — applied to every NEW interactive element on this page. */
const focusRing = "focus-visible:outline-none focus-visible:shadow-focus-ring";
/* Amber chip marking rows auto-shortlisted by the ATS threshold in this session. */
const autoChip =
  "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-700 ring-1 ring-inset ring-amber-300/60 dark:bg-amber-900/40 dark:text-amber-300 dark:ring-amber-700/50";

/* ---------------------------------------------------------------- helpers */

function fmtDate(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function fmtDateTime(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function fmtRange(min: number | null, max: number | null, unit: string): string {
  if (min == null && max == null) return "—";
  if (min != null && max != null) return `${min} – ${max} ${unit}`;
  if (min != null) return `${min}+ ${unit}`;
  return `up to ${max} ${unit}`;
}

function useDebounced(value: string, ms = 350): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** customer_id → name map (customers list is readable by any CRM role). */
function useCustomerNames(): Record<number, string> {
  const [map, setMap] = useState<Record<number, string>>({});
  useEffect(() => {
    crmGet<any[]>("/api/customers?limit=200")
      .then((r) => {
        const m: Record<number, string> = {};
        (r.data || []).forEach((c: any) => { m[c.id] = c.name; });
        setMap(m);
      })
      .catch(() => { /* non-blocking */ });
  }, []);
  return map;
}

function PriorityPill({ p }: { p?: string | null }) {
  if (!p) return <span className="text-muted">—</span>;
  const cls =
    p === "High"
      ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
      : p === "Low"
        ? "bg-surface-2 text-secondary"
        : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{p}</span>;
}

/* ------------------------------------------------- approve / reject modal */

function DecisionModal({
  req, stage, kind, onClose, onDone, toast,
}: {
  req: Req;
  stage: "sales-head" | "engineering";
  kind: "approve" | "reject";
  onClose: () => void;
  onDone: (updated: Req) => void;
  toast: ToastFn;
}) {
  const [text, setText] = useState("");
  const [rmgJdText, setRmgJdText] = useState(req.rmg_jd_text || "");
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [customerJd, setCustomerJd] = useState<JdAttachment[]>(req.customer_jd_attachments || []);
  const [existingRmgJd, setExistingRmgJd] = useState<JdAttachment[]>(req.rmg_jd_attachments || []);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const stageLabel = stage === "sales-head" ? "Sales Head" : "Engineering (RMG)";
  const needsRmgJd = stage === "engineering" && kind === "approve";

  useEffect(() => {
    if (!needsRmgJd) return;
    let cancelled = false;
    crmGet<Req>(`/api/requirements/${req.id}`)
      .then((r) => {
        if (cancelled || !r.data) return;
        setCustomerJd(r.data.customer_jd_attachments || []);
        setExistingRmgJd(r.data.rmg_jd_attachments || []);
        if (r.data.rmg_jd_text) setRmgJdText(r.data.rmg_jd_text);
      })
      .catch(() => { /* keep whatever we already have */ });
    return () => { cancelled = true; };
  }, [needsRmgJd, req.id]);

  const submit = async () => {
    if (kind === "reject" && text.trim().length < 10) {
      setErr("Rejection reason is mandatory (minimum 10 characters)");
      return;
    }
    if (needsRmgJd) {
      const hasText = rmgJdText.trim().length > 0;
      const hasFile = !!jdFile || existingRmgJd.length > 0;
      if (!hasText && !hasFile) {
        setErr("Add a JD (text or file) before approving");
        return;
      }
    }
    setBusy(true);
    try {
      if (needsRmgJd && jdFile) {
        await crmUpload(`/api/requirements/${req.id}/attachments`, jdFile, { kind: "rmg_jd" });
      }
      let body: Record<string, string> | undefined;
      if (kind === "reject") {
        body = { reason: text.trim() };
      } else if (needsRmgJd) {
        body = {
          ...(text.trim() ? { comment: text.trim() } : {}),
          rmg_jd_text: rmgJdText.trim(),
        };
      } else if (text.trim()) {
        body = { comment: text.trim() };
      }
      const res = await crmPost<Req>(`/api/requirements/${req.id}/${stage}-${kind}`, body);
      toast(res.message || (kind === "approve" ? "Approved" : "Rejected"));
      onDone(res.data);
      onClose();
    } catch (e: any) {
      toast(e?.message || "Action failed", "err");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${kind === "approve" ? "Approve" : "Reject"} ${req.req_number} — ${stageLabel}`}
      onClose={onClose}
      fullScreen
    >
      <div className="space-y-3">
        <div className="text-sm text-secondary">
          {kind === "approve"
            ? <>Approve <span className="font-semibold">“{req.title}”</span>? You may add an optional comment for the activity log.</>
            : <>Reject <span className="font-semibold">“{req.title}”</span>. A reason of at least 10 characters is required; the creator will be notified.</>}
        </div>
        {needsRmgJd && (
          <div className="space-y-3 rounded-xl border border-subtle bg-surface-2 p-3">
            <div className="text-xs font-bold uppercase tracking-wide text-muted">Customer JD (reference)</div>
            {customerJd.length === 0 ? (
              <p className="text-sm text-muted">No customer JD uploaded on the opportunity.</p>
            ) : (
              <ul className="space-y-1">
                {customerJd.map((a) => (
                  <li key={a.id}><FileLink url={a.file_url} label={a.file_name || "Customer JD"} /></li>
                ))}
              </ul>
            )}
            <Field label="RMG JD (text)" required={!jdFile && existingRmgJd.length === 0} error={err && !rmgJdText.trim() && !jdFile && !existingRmgJd.length ? err : ""}>
              <textarea
                className={inputCls}
                rows={6}
                value={rmgJdText}
                onChange={(e) => { setRmgJdText(e.target.value); if (err) setErr(""); }}
                placeholder="Paste or type the job description TA will use for ATS scoring…"
              />
            </Field>
            <Field label="RMG JD (PDF / Word)">
              <input
                type="file"
                accept=".pdf,.doc,.docx"
                className="block w-full text-sm"
                onChange={(e) => { setJdFile(e.target.files?.[0] || null); if (err) setErr(""); }}
              />
              {jdFile && <p className="mt-1 text-xs text-muted">{jdFile.name}</p>}
              {existingRmgJd.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {existingRmgJd.map((a) => (
                    <li key={a.id} className="text-sm"><FileLink url={a.file_url} label={a.file_name || "RMG JD"} /></li>
                  ))}
                </ul>
              )}
            </Field>
            {err && <p className="text-sm text-rose-600">{err}</p>}
          </div>
        )}
        <Field
          label={kind === "approve" ? "Comment (optional)" : "Rejection reason"}
          required={kind === "reject"}
          error={kind === "reject" ? err : ""}
        >
          <textarea
            className={inputCls}
            rows={3}
            value={text}
            onChange={(e) => { setText(e.target.value); if (err) setErr(""); }}
            placeholder={kind === "reject" ? "Why is this requirement being rejected?" : "Optional comment…"}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={kind === "reject" ? btnDanger : btnPrimary} onClick={submit} disabled={busy}>
            {busy ? "Working…" : kind === "approve" ? <><Check size={15} /> Approve</> : <><X size={15} /> Reject</>}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------- create / edit modal */

type FormState = {
  opportunity_id: string;
  title: string;
  description: string;
  no_of_positions: string;
  experience_min: string;
  experience_max: string;
  budget_ctc_min: string;
  budget_ctc_max: string;
  work_mode: string;
  location_id: string;
  priority: string;
  target_closure_date: string;
};

type SkillRow = { skill_id: string; is_mandatory: boolean; min_rating: string };

function RequirementFormModal({
  initial, onClose, onSaved, toast,
}: {
  initial: Req | null;
  onClose: () => void;
  onSaved: (r: Req) => void;
  toast: ToastFn;
}) {
  const editing = !!initial;
  const [opps, setOpps] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [skills, setSkills] = useState<any[]>([]);
  const [form, setForm] = useState<FormState>({
    opportunity_id: initial ? String(initial.opportunity_id) : "",
    title: initial?.title || "",
    description: initial?.description || "",
    no_of_positions: String(initial?.no_of_positions ?? 1),
    experience_min: initial?.experience_min != null ? String(initial.experience_min) : "",
    experience_max: initial?.experience_max != null ? String(initial.experience_max) : "",
    budget_ctc_min: initial?.budget_ctc_min != null ? String(initial.budget_ctc_min) : "",
    budget_ctc_max: initial?.budget_ctc_max != null ? String(initial.budget_ctc_max) : "",
    work_mode: initial?.work_mode || "",
    location_id: initial?.location_id != null ? String(initial.location_id) : "",
    priority: initial?.priority || "Medium",
    target_closure_date: initial?.target_closure_date || "",
  });
  const [rows, setRows] = useState<SkillRow[]>(
    (initial?.skills || []).map((s) => ({
      skill_id: String(s.skill_id),
      is_mandatory: s.is_mandatory,
      min_rating: s.min_rating != null ? String(s.min_rating) : "",
    })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    crmGet<any[]>("/api/opportunities?limit=100").then((r) => setOpps(r.data || [])).catch(() => {});
    crmGet<any[]>("/api/locations?limit=200").then((r) => setLocations(r.data || [])).catch(() => {});
    crmGet<any[]>("/api/skills?limit=200").then((r) => setSkills(r.data || [])).catch(() => {});
  }, []);

  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!editing && !form.opportunity_id) e.opportunity_id = "Opportunity is required";
    if (!form.title.trim()) e.title = "Title is required";
    const positions = Number(form.no_of_positions);
    if (form.no_of_positions.trim() === "" || !Number.isInteger(positions) || positions < 1) {
      e.no_of_positions = "Must be a whole number of at least 1";
    }
    (["experience_min", "experience_max", "budget_ctc_min", "budget_ctc_max"] as const).forEach((k) => {
      const v = form[k];
      if (v.trim() !== "" && (isNaN(Number(v)) || Number(v) < 0)) e[k] = "Must be a number ≥ 0";
    });
    const emin = numOrNull(form.experience_min);
    const emax = numOrNull(form.experience_max);
    if (!e.experience_max && emin != null && emax != null && emin > emax) e.experience_max = "Max must be ≥ min";
    const bmin = numOrNull(form.budget_ctc_min);
    const bmax = numOrNull(form.budget_ctc_max);
    if (!e.budget_ctc_max && bmin != null && bmax != null && bmin > bmax) e.budget_ctc_max = "Max must be ≥ min";
    if (rows.some((r) => !r.skill_id)) {
      e.skills = "Every skill row needs a skill selected";
    } else {
      const ids = rows.map((r) => r.skill_id);
      if (new Set(ids).size !== ids.length) e.skills = "Duplicate skills are not allowed";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setBusy(true);
    const payload: any = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      no_of_positions: Number(form.no_of_positions),
      experience_min: numOrNull(form.experience_min),
      experience_max: numOrNull(form.experience_max),
      budget_ctc_min: numOrNull(form.budget_ctc_min),
      budget_ctc_max: numOrNull(form.budget_ctc_max),
      work_mode: form.work_mode || null,
      location_id: form.location_id ? Number(form.location_id) : null,
      priority: form.priority,
      target_closure_date: form.target_closure_date || null,
      skills: rows.map((r) => ({
        skill_id: Number(r.skill_id),
        is_mandatory: r.is_mandatory,
        min_rating: r.min_rating ? Number(r.min_rating) : null,
      })),
    };
    try {
      const res = editing
        ? await crmPut<Req>(`/api/requirements/${initial!.id}`, payload)
        : await crmPost<Req>("/api/requirements", { ...payload, opportunity_id: Number(form.opportunity_id) });
      toast(res.message || (editing ? "Requirement updated" : "Requirement created"));
      onSaved(res.data);
      onClose();
    } catch (e: any) {
      toast(e?.message || "Save failed", "err");
      setBusy(false);
    }
  };

  const updateRow = (i: number, patch: Partial<SkillRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <Modal title={editing ? `Edit ${initial!.req_number}` : "New Requirement"} onClose={onClose} wide fullScreen>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!editing && (
          <div className="sm:col-span-2">
            <Field label="Opportunity" required error={errors.opportunity_id}>
              <select className={inputCls} value={form.opportunity_id} onChange={(e) => set("opportunity_id", e.target.value)}>
                <option value="">Select an opportunity…</option>
                {opps.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.opp_id} — {o.title}{o.customer_name ? ` (${o.customer_name})` : ""}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <div className="sm:col-span-2">
          <Field label="Title" required error={errors.title}>
            <input className={inputCls} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Senior Java Developer" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Description">
            <textarea className={inputCls} rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
        </div>
        <Field label="No. of positions" required error={errors.no_of_positions}>
          <input className={inputCls} type="number" min={1} value={form.no_of_positions} onChange={(e) => set("no_of_positions", e.target.value)} />
        </Field>
        <Field label="Priority">
          <select className={inputCls} value={form.priority} onChange={(e) => set("priority", e.target.value)}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Experience min (yrs)" error={errors.experience_min}>
          <input className={inputCls} type="number" min={0} step="0.5" value={form.experience_min} onChange={(e) => set("experience_min", e.target.value)} />
        </Field>
        <Field label="Experience max (yrs)" error={errors.experience_max}>
          <input className={inputCls} type="number" min={0} step="0.5" value={form.experience_max} onChange={(e) => set("experience_max", e.target.value)} />
        </Field>
        <Field label="Budget CTC min" error={errors.budget_ctc_min}>
          <input className={inputCls} type="number" min={0} value={form.budget_ctc_min} onChange={(e) => set("budget_ctc_min", e.target.value)} />
        </Field>
        <Field label="Budget CTC max" error={errors.budget_ctc_max}>
          <input className={inputCls} type="number" min={0} value={form.budget_ctc_max} onChange={(e) => set("budget_ctc_max", e.target.value)} />
        </Field>
        <Field label="Work mode">
          <select className={inputCls} value={form.work_mode} onChange={(e) => set("work_mode", e.target.value)}>
            <option value="">—</option>
            {WORK_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Location">
          <select className={inputCls} value={form.location_id} onChange={(e) => set("location_id", e.target.value)}>
            <option value="">—</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.city}{l.state ? `, ${l.state}` : ""} ({l.country})</option>
            ))}
          </select>
        </Field>
        <Field label="Target closure date">
          <input className={inputCls} type="date" value={form.target_closure_date} onChange={(e) => set("target_closure_date", e.target.value)} />
        </Field>
      </div>

      {/* skills editor */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-secondary">Skills</span>
          <button
            type="button"
            className={smallBtn}
            onClick={() => setRows((rs) => [...rs, { skill_id: "", is_mandatory: false, min_rating: "" }])}
          >
            <Plus size={13} /> Add skill
          </button>
        </div>
        {rows.length === 0 && (
          <div className="rounded-lg border border-dashed border-strong px-3 py-2.5 text-xs text-muted">
            No skills yet — mandatory skills drive the ATS score (50 of 100 points).
          </div>
        )}
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select
                className={`${inputCls} !w-56`}
                value={r.skill_id}
                onChange={(e) => updateRow(i, { skill_id: e.target.value })}
              >
                <option value="">Select skill…</option>
                {skills.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}{s.category ? ` (${s.category})` : ""}</option>
                ))}
              </select>
              <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-secondary">
                <input
                  type="checkbox"
                  checked={r.is_mandatory}
                  onChange={(e) => updateRow(i, { is_mandatory: e.target.checked })}
                  className="h-4 w-4 rounded border-strong"
                />
                Mandatory
              </label>
              <select
                className={`${inputCls} !w-32`}
                value={r.min_rating}
                onChange={(e) => updateRow(i, { min_rating: e.target.value })}
              >
                <option value="">Min rating —</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}
              </select>
              <button
                type="button"
                className="rounded-lg p-1.5 text-muted hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                aria-label="Remove skill"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        {errors.skills && <div className="mt-1 text-xs text-rose-600">{errors.skills}</div>}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={btnPrimary} onClick={submit} disabled={busy}>
          {busy ? "Saving…" : editing ? "Save changes" : "Create requirement"}
        </button>
      </div>
    </Modal>
  );
}

/* ================================================================ LIST PAGE */

type TabDef = { key: string; label: string; statuses: string[] | null; queue?: "sales-head" | "engineering" };

export function RequirementsListPage() {
  const me = useMe();
  const canCreate = useHasRole("Sales"); // Admin passes too
  const [toastNode, toast] = useToast();

  const roles = me.roles;
  const isAdmin = roles.includes("Admin");
  const tabs = useMemo<TabDef[]>(() => {
    const t: TabDef[] = [];
    if (roles.includes("Sales")) {
      t.push(
        { key: "draft", label: "Draft", statuses: ["Draft"] },
        { key: "pending", label: "Pending Approval", statuses: ["Pending_Sales_Head_Approval", "Pending_Engineering_Review"] },
        { key: "rejected", label: "Rejected", statuses: ["Sales_Head_Rejected", "Engineering_Rejected"] },
        { key: "active", label: "Active", statuses: SOURCING_STATUSES },
        { key: "closed", label: "Closed", statuses: TERMINAL_STATUSES },
      );
    }
    if (roles.includes("Sales_Head") || isAdmin) {
      t.push({ key: "approval", label: "Approval Queue", statuses: ["Pending_Sales_Head_Approval"], queue: "sales-head" });
    }
    if (roles.includes("RMG") || isAdmin) {
      t.push({ key: "engineering", label: "Engineering Review Queue", statuses: ["Pending_Engineering_Review"], queue: "engineering" });
    }
    if (roles.includes("Sales_Head") || roles.includes("RMG") || isAdmin) {
      t.push({ key: "all", label: "All", statuses: null });
    }
    return t;
  }, [roles, isAdmin]);

  const taMode = tabs.length === 0; // e.g. pure TA — backend already limits to sourcing-onward
  const [tab, setTab] = useState<string>(tabs[0]?.key || "all");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const dq = useDebounced(search);
  const [rows, setRows] = useState<Req[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [decision, setDecision] = useState<{ req: Req; stage: "sales-head" | "engineering"; kind: "approve" | "reject" } | null>(null);
  const customers = useCustomerNames();

  const active = tabs.find((t) => t.key === tab);
  const statuses = taMode ? (statusFilter ? [statusFilter] : null) : (active?.statuses ?? null);
  const statusKey = (statuses || []).join(",");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = statusKey ? statusKey.split(",") : null;
      const single = list && list.length === 1 ? list[0] : undefined;
      const res = await crmGet<Req[]>(
        `/api/requirements${qs({ page, limit: 20, search: dq || undefined, status: single })}`,
      );
      let data = res.data || [];
      if (list && list.length > 1) data = data.filter((r) => list.includes(r.status));
      setRows(data);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load requirements");
    } finally {
      setLoading(false);
    }
  }, [page, dq, statusKey]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [tab, dq, statusFilter]);

  const columns: Column<Req>[] = [
    { key: "req_number", label: "Req #", render: (r) => <span className="font-semibold text-primary">{r.req_number}</span> },
    { key: "title", label: "Title" },
    {
      key: "customer", label: "Customer",
      render: (r) => (r.customer_id != null ? customers[r.customer_id] || `#${r.customer_id}` : "—"),
    },
    { key: "no_of_positions", label: "Positions" },
    { key: "priority", label: "Priority", render: (r) => <PriorityPill p={r.priority} /> },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "target_closure_date", label: "Target date", render: (r) => fmtDate(r.target_closure_date) },
  ];
  if (active?.queue) {
    const stage = active.queue;
    columns.push({
      key: "_actions", label: "Actions",
      render: (r) => (
        <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button className={smallSuccess} onClick={() => setDecision({ req: r, stage, kind: "approve" })}>
            <Check size={13} /> Approve
          </button>
          <button className={smallDanger} onClick={() => setDecision({ req: r, stage, kind: "reject" })}>
            <X size={13} /> Reject
          </button>
        </div>
      ),
    });
  }

  return (
    <div className="space-y-4">
      {toastNode}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-display text-xl font-bold text-primary">Requirements</h1>
        {canCreate && (
          <button className={btnPrimary} onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New Requirement
          </button>
        )}
      </div>

      {!taMode && tabs.length > 0 && (
        <Tabs tabs={tabs.map((t) => ({ key: t.key, label: t.label }))} active={tab} onChange={setTab} />
      )}

      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : (
        <DataTable<Req>
          columns={columns}
          rows={rows}
          meta={meta}
          loading={loading}
          search={search}
          onSearch={setSearch}
          onPage={setPage}
          onRowClick={(r) => crmNavigate(`requirements/${r.id}`)}
          emptyMessage="No requirements found"
          filters={
            taMode ? (
              <select className={`${inputCls} !w-56`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                {TA_FILTER_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
              </select>
            ) : undefined
          }
        />
      )}

      {showCreate && (
        <RequirementFormModal
          initial={null}
          onClose={() => setShowCreate(false)}
          onSaved={(r) => crmNavigate(`requirements/${r.id}`)}
          toast={toast}
        />
      )}
      {decision && (
        <DecisionModal
          req={decision.req}
          stage={decision.stage}
          kind={decision.kind}
          onClose={() => setDecision(null)}
          onDone={() => load()}
          toast={toast}
        />
      )}
    </div>
  );
}

/* ============================================================== DETAIL PAGE */

const STEPS = ["Draft", "Sales Head", "Engineering", "Sourcing", "Posted", "In Progress"];

function stepState(status: string): { current: number; rejectedAt: number | null; terminal: string | null } {
  switch (status) {
    case "Draft": return { current: 0, rejectedAt: null, terminal: null };
    case "Pending_Sales_Head_Approval": return { current: 1, rejectedAt: null, terminal: null };
    case "Sales_Head_Rejected": return { current: 1, rejectedAt: 1, terminal: null };
    case "Pending_Engineering_Review": return { current: 2, rejectedAt: null, terminal: null };
    case "Engineering_Rejected": return { current: 2, rejectedAt: 2, terminal: null };
    case "Open_For_Sourcing": return { current: 3, rejectedAt: null, terminal: null };
    case "Posted_On_Portals": return { current: 4, rejectedAt: null, terminal: null };
    case "In_Progress": return { current: 5, rejectedAt: null, terminal: null };
    case "Fulfilled": return { current: 6, rejectedAt: null, terminal: "Fulfilled" };
    case "Closed": return { current: -1, rejectedAt: null, terminal: "Closed" };
    case "Cancelled": return { current: -1, rejectedAt: null, terminal: "Cancelled" };
    default: return { current: -1, rejectedAt: null, terminal: null };
  }
}

function StatusStepper({ status }: { status: string }) {
  const { current, rejectedAt, terminal } = stepState(status);
  return (
    <div className="rounded-card border border-subtle bg-surface-1 px-5 py-4 shadow-sm">
      <div className="flex items-center">
        {STEPS.map((label, i) => {
          const done = current > i;
          const isCurrent = current === i && rejectedAt === null;
          const rejected = rejectedAt === i;
          const circle = rejected
            ? "bg-rose-600 text-white"
            : done
              ? "bg-sky-600 text-white"
              : isCurrent
                ? "nav-pill-gradient text-white"
                : "bg-surface-2 text-muted";
          return (
            <Fragment key={label}>
              {i > 0 && (
                <div className={`h-0.5 min-w-4 flex-1 ${current > i - 1 ? "bg-sky-500" : "bg-surface-2"}`} />
              )}
              <div className="flex flex-col items-center px-1">
                <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${circle}`}>
                  {rejected ? <X size={13} /> : done ? <Check size={13} /> : i + 1}
                </div>
                <div
                  className={`mt-1 whitespace-nowrap text-xs font-semibold ${
                    rejected
                      ? "text-rose-600 dark:text-rose-400"
                      : done || isCurrent
                        ? "text-primary"
                        : "text-muted"
                  }`}
                >
                  {label}
                </div>
                {rejected && (
                  <div className="mt-0.5 text-xs font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                    Rejected
                  </div>
                )}
              </div>
            </Fragment>
          );
        })}
        {terminal && (
          <div className="ml-4 shrink-0">
            <StatusBadge status={terminal} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- job postings tab */

function JobPostingsTab({
  req, toast, onRequirementChanged,
}: {
  req: Req;
  toast: ToastFn;
  onRequirementChanged: () => void;
}) {
  const isTA = useHasRole("TA");
  const [postings, setPostings] = useState<JobPosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [portal, setPortal] = useState("Naukri");
  const [url, setUrl] = useState("");
  const [urlErr, setUrlErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [applyUrl, setApplyUrl] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<JobPosting[]>(`/api/requirements/${req.id}/job-postings`);
      setPostings(res.data || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load job postings");
    } finally {
      setLoading(false);
    }
  }, [req.id]);
  useEffect(() => { load(); }, [load]);

  const canAdd = isTA && SOURCING_STATUSES.includes(req.status);

  const addPosting = async () => {
    if (!/^https?:\/\/.+\..+/i.test(url.trim())) {
      setUrlErr("Enter a valid URL starting with http:// or https://");
      return;
    }
    setBusy(true);
    try {
      const res = await crmPost(`/api/requirements/${req.id}/job-postings`, {
        portal_name: portal,
        job_post_url: url.trim(),
      });
      toast(res.message || "Job posting added");
      setShowAdd(false);
      setUrl("");
      load();
      onRequirementChanged(); // first posting auto-moves Open_For_Sourcing -> Posted_On_Portals
    } catch (e: any) {
      toast(e?.message || "Failed to add posting", "err");
    } finally {
      setBusy(false);
    }
  };

  const openApplyLink = async () => {
    setLinkBusy(true);
    setCopied(false);
    try {
      const res = await crmGet<{ apply_url: string }>(`/api/requirements/${req.id}/apply-link`);
      setApplyUrl(res.data?.apply_url || "");
      setShowLink(true);
    } catch (e: any) {
      toast(e?.message || "Failed to generate application link", "err");
    } finally {
      setLinkBusy(false);
    }
  };

  const copyApplyUrl = async () => {
    try {
      await navigator.clipboard.writeText(applyUrl);
      setCopied(true);
    } catch {
      /* clipboard blocked — user can still select the text */
    }
  };

  const columns: Column<JobPosting>[] = [
    { key: "portal_name", label: "Portal", render: (p) => <span className="font-semibold">{p.portal_name}</span> },
    {
      key: "job_post_url", label: "URL",
      render: (p) => (
        <a
          href={p.job_post_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-md items-center gap-1 truncate text-sky-600 hover:underline dark:text-sky-400"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink size={13} /> <span className="truncate">{p.job_post_url}</span>
        </a>
      ),
    },
    { key: "posted_by", label: "Posted by", render: (p) => (p.posted_by != null ? `User #${p.posted_by}` : "—") },
    { key: "posted_at", label: "Date", render: (p) => fmtDate(p.posted_at) },
    { key: "status", label: "Status", render: (p) => <StatusBadge status={p.status || "Active"} /> },
  ];

  return (
    <div className="space-y-3">
      {canAdd && (
        <div className="flex flex-wrap justify-end gap-2">
          <button className={btnSecondary} onClick={openApplyLink} disabled={linkBusy}>
            <Link2 size={15} /> {linkBusy ? "Generating…" : "Application link"}
          </button>
          <button className={btnSecondary} onClick={() => setShowAdd(true)}>
            <Link2 size={15} /> Add posting
          </button>
        </div>
      )}

      {showLink && (
        <Modal title="Public application link" onClose={() => setShowLink(false)}>
          <p className="mb-3 text-sm text-secondary">
            Share this link on Naukri, LinkedIn, or anywhere else. Candidates fill in their name, email,
            phone and experience and upload a resume — submissions appear in this requirement’s Resumes tab.
          </p>
          <div className="flex items-center gap-2">
            <input
              className={inputCls}
              readOnly
              value={applyUrl}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button className={btnPrimary} onClick={copyApplyUrl}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="mt-4 flex justify-end">
            <a className={btnSecondary} href={applyUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> Preview form
            </a>
          </div>
        </Modal>
      )}
      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : (
        <DataTable<JobPosting> columns={columns} rows={postings} loading={loading} emptyMessage="No job postings yet" />
      )}
      {showAdd && (
        <Modal title="Add job posting" onClose={() => setShowAdd(false)} fullScreen>
          <div className="space-y-3">
            <Field label="Portal" required>
              <select className={inputCls} value={portal} onChange={(e) => setPortal(e.target.value)}>
                {JOB_PORTALS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Job post URL" required error={urlErr}>
              <input
                className={inputCls}
                value={url}
                onChange={(e) => { setUrl(e.target.value); if (urlErr) setUrlErr(""); }}
                placeholder="https://www.naukri.com/job/…"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button className={btnSecondary} onClick={() => setShowAdd(false)} disabled={busy}>Cancel</button>
              <button className={btnPrimary} onClick={addPosting} disabled={busy}>
                {busy ? "Adding…" : "Add posting"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- resumes tab */

function ScorePill({ row, onClick }: { row: ResumeRow; onClick: () => void }) {
  if (row.ats_score == null) return <span className="text-muted">—</span>;
  const s = row.ats_score;
  const cls =
    s >= 70
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : s >= 40
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300";
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`rounded-full px-2.5 py-0.5 text-xs font-bold shadow-ai-glow ${cls} hover:ring-2 hover:ring-sky-300`}
      title="View ATS score breakdown"
    >
      {s}
    </button>
  );
}

function BreakdownModal({ row, onClose }: { row: ResumeRow; onClose: () => void }) {
  const b = row.ats_score_breakdown || {};
  const matched = b.skills_matched || [];
  const missing = b.skills_missing || [];
  const jdMatched = b.jd_keywords_matched || [];
  const jdMissing = b.jd_keywords_missing || [];
  const details = (b.score_details || {}) as Record<string, unknown>;
  return (
    <Modal
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          ATS breakdown — {row.candidate_name}
          {/* AI-computed score gets the reserved gradient-text accent */}
          <span className="bg-clip-text font-extrabold text-transparent [background-image:var(--ai-gradient)]">
            {row.ats_score ?? "—"}/100
          </span>
        </span>
      }
      onClose={onClose}
      wide
      fullScreen
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Matched skills</div>
          <div className="flex flex-wrap gap-1.5">
            {matched.length === 0 && <span className="text-sm text-muted">None</span>}
            {matched.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                <Check size={11} /> {s}
              </span>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Missing skills</div>
          <div className="flex flex-wrap gap-1.5">
            {missing.length === 0 && <span className="text-sm text-muted">None</span>}
            {missing.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                <X size={11} /> {s}
              </span>
            ))}
          </div>
        </div>
        {(jdMatched.length > 0 || jdMissing.length > 0 || Boolean(details.jd_applied)) && (
          <div>
            <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">JD keywords matched</div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {jdMatched.length === 0 && <span className="text-sm text-muted">None</span>}
              {jdMatched.map((s) => (
                <span key={`jd-m-${s}`} className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  <Check size={11} /> {s}
                </span>
              ))}
            </div>
            {jdMissing.length > 0 && (
              <>
                <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">JD keywords missing</div>
                <div className="flex flex-wrap gap-1.5">
                  {jdMissing.slice(0, 20).map((s) => (
                    <span key={`jd-x-${s}`} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-secondary">
                      {s}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <div className="text-sm text-primary">
          <span className="font-semibold">Experience match:</span>{" "}
          {b.experience_match ? (
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">Yes</span>
          ) : (
            <span className="font-semibold text-rose-600 dark:text-rose-400">No</span>
          )}
        </div>
        <div>
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Score details</div>
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(details).map(([k, v]) => (
                <tr key={k} className="border-b border-subtle">
                  <td className="py-1.5 pr-4 font-medium capitalize text-secondary">
                    {k.replace(/_/g, " ")}
                  </td>
                  <td className="py-1.5 text-primary">
                    {v == null ? "—" : Array.isArray(v) ? (v.length ? v.join(", ") : "—") : String(v)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

function UploadResumeModal({
  req, onClose, onUploaded, toast,
}: {
  req: Req;
  onClose: () => void;
  onUploaded: () => void;
  toast: ToastFn;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");
  const [nameErr, setNameErr] = useState("");

  const fields: Record<string, string> = { candidate_name: name.trim() };
  if (email.trim()) fields.email = email.trim();
  if (phone.trim()) fields.phone = phone.trim();
  if (source) fields.source_portal = source;

  return (
    <Modal title="Upload resume" onClose={onClose} fullScreen>
      <div className="space-y-3">
        <Field label="Candidate name" required error={nameErr}>
          <input
            className={inputCls}
            value={name}
            onChange={(e) => { setName(e.target.value); if (nameErr) setNameErr(""); }}
            placeholder="Full name"
          />
        </Field>
        <Field label="Email">
          <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Phone">
          <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Source portal">
          <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">—</option>
            {SOURCE_PORTALS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <div>
          {name.trim() ? (
            <FileUploadButton
              path={`/api/requirements/${req.id}/resumes`}
              fields={fields}
              label="Choose file & upload"
              accept=".pdf,.doc,.docx,.txt"
              onDone={() => { toast("Resume uploaded"); onUploaded(); onClose(); }}
              onError={(m) => toast(m, "err")}
            />
          ) : (
            <button
              type="button"
              className={btnSecondary}
              onClick={() => setNameErr("Candidate name is required before uploading")}
            >
              Choose file & upload
            </button>
          )}
          <p className="mt-1.5 text-xs text-muted">
            Accepted: .pdf, .doc, .docx, .txt — the upload starts as soon as you pick a file.
          </p>
        </div>
      </div>
    </Modal>
  );
}

function ResumesTab({
  req, toast, onRequirementChanged,
}: {
  req: Req;
  toast: ToastFn;
  onRequirementChanged: () => void;
}) {
  const isTA = useHasRole("TA");
  const [rows, setRows] = useState<ResumeRow[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const dq = useDebounced(search);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [scanAllBusy, setScanAllBusy] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [breakdownRow, setBreakdownRow] = useState<ResumeRow | null>(null);
  const [rejectRow, setRejectRow] = useState<ResumeRow | null>(null);
  const [scheduleRow, setScheduleRow] = useState<ResumeRow | null>(null);
  const [inviteOpenId, setInviteOpenId] = useState<number | null>(null);
  const [profileByResume, setProfileByResume] = useState<Record<number, number>>({});
  const [inviteBusyId, setInviteBusyId] = useState<number | null>(null);
  /* Resume ids reported as auto_shortlisted by a scan run in THIS session (client-side only). */
  const [autoIds, setAutoIds] = useState<Set<number>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<ResumeRow[]>(
        `/api/requirements/${req.id}/resumes${qs({ page, limit: 20, search: dq || undefined })}`,
      );
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load resumes");
    } finally {
      setLoading(false);
    }
  }, [req.id, page, dq]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [dq]);

  /** Scan responses now flag auto_shortlisted / slot_invite_sent per resume.
   * Remember auto-shortlisted ids for this session (drives the "Auto" chip)
   * and return a toast-ready summary ("2 auto-shortlisted, invites sent"). */
  const captureAutoResults = (data: any): string | null => {
    const list: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.results)
        ? data.results
        : data && typeof data === "object"
          ? [data]
          : [];
    const auto = list.filter((x) => x && typeof x === "object" && x.auto_shortlisted);
    if (auto.length === 0) return null;
    setAutoIds((prev) => {
      const next = new Set(prev);
      auto.forEach((x) => { if (x.id != null) next.add(Number(x.id)); });
      return next;
    });
    const invites = auto.filter((x) => x.slot_invite_sent).length;
    const base = `${auto.length} auto-shortlisted`;
    if (invites === 0) return base;
    if (invites === auto.length) return `${base}, invites sent`;
    return `${base}, ${invites} invite${invites === 1 ? "" : "s"} sent`;
  };

  const scan = async (r: ResumeRow) => {
    setBusyId(r.id);
    try {
      const res = await crmPost<any>(`/api/resumes/${r.id}/ats-scan`);
      const summary = captureAutoResults(res.data);
      const msg = res.message || "ATS scan complete";
      toast(summary ? `${msg} — ${summary}` : msg);
      load();
    } catch (e: any) {
      toast(e?.message || "ATS scan failed", "err");
    } finally {
      setBusyId(null);
    }
  };

  const scanAll = async () => {
    setScanAllBusy(true);
    try {
      const res = await crmPost<any>(`/api/requirements/${req.id}/resumes/scan-all`);
      const summary = captureAutoResults(res.data);
      const msg = res.message || "Scan complete";
      toast(summary ? `${msg} — ${summary}` : msg);
      load();
    } catch (e: any) {
      toast(e?.message || "Scan-all failed", "err");
    } finally {
      setScanAllBusy(false);
    }
  };

  /** Email/WhatsApp the candidate a self-service interview-slot booking link. */
  const sendSlotInvite = async (r: ResumeRow) => {
    setInviteBusyId(r.id);
    try {
      const res = await crmPost<{
        booking?: { token?: string };
        email?: { sent: boolean; error?: string | null };
        whatsapp?: { sent: boolean; error?: string | null };
      }>(`/api/resumes/${r.id}/send-slot-invite`);
      const d = res.data || {};
      const part = (label: string, ch?: { sent: boolean; error?: string | null }) =>
        ch ? `${label} ${ch.sent ? "sent" : `failed${ch.error ? ` (${ch.error})` : ""}`}` : null;
      const parts = [part("email", d.email), part("WhatsApp", d.whatsapp)].filter(Boolean);
      const anySent = !!(d.email?.sent || d.whatsapp?.sent);
      toast(
        parts.length ? `Slot invite — ${parts.join(" · ")}` : res.message || "Slot invite sent",
        anySent || parts.length === 0 ? "ok" : "err",
      );
      load();
    } catch (e: any) {
      toast(e?.message || "Failed to send slot invite", "err");
    } finally {
      setInviteBusyId(null);
    }
  };

  const shortlist = async (r: ResumeRow) => {
    setBusyId(r.id);
    try {
      const res = await crmPost(`/api/resumes/${r.id}/shortlist`);
      toast(res.message || "Resume shortlisted");
      load();
    } catch (e: any) {
      toast(e?.message || "Shortlist failed", "err");
    } finally {
      setBusyId(null);
    }
  };

  const doReject = async () => {
    if (!rejectRow) return;
    setBusyId(rejectRow.id);
    try {
      const res = await crmPost(`/api/resumes/${rejectRow.id}/reject`);
      toast(res.message || "Resume rejected");
      setRejectRow(null);
      load();
    } catch (e: any) {
      toast(e?.message || "Reject failed", "err");
    } finally {
      setBusyId(null);
    }
  };

  const doSchedule = async () => {
    if (!scheduleRow) return;
    const r = scheduleRow;
    setBusyId(r.id);
    try {
      const res = await crmPost<any>(`/api/resumes/${r.id}/schedule-ai-interview`);
      toast(res.message || "AI L1 invite ready to share");
      if (res.data?.profile_id) {
        setProfileByResume((m) => ({ ...m, [r.id]: res.data.profile_id }));
      }
      setScheduleRow(null);
      setInviteOpenId(r.id);
      await load();
    } catch (e: any) {
      toast(e?.message || "Scheduling failed", "err");
    } finally {
      setBusyId(null);
    }
  };

  const copyInvite = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label} copied`);
    } catch {
      toast("Copy failed — select and copy manually", "err");
    }
  };

  const buildInviteEmail = (r: ResumeRow): string => {
    const when = fmtDateTime(r.ai_interview_scheduled_at);
    const role = req.title || "the role";
    let body =
      `Hello ${r.candidate_name},\n\n` +
      `Your AI interview for "${role}" is scheduled.\n` +
      `When: ${when}\n\n`;
    if (r.ai_invite_url) {
      body += `Open this link to start your interview:\n${r.ai_invite_url}\n\n`;
    }
    if (r.ai_access_key) {
      body +=
        `Your Secure Access Key: ${r.ai_access_key}\n` +
        `You will need your registered email (${r.email || "your email"}) and this key to enter the interview.\n` +
        `Do NOT share these credentials with anyone.\n\n`;
    }
    body += "— Karnex Recruitment Team\n";
    return body;
  };

  const pendingOnPage = rows.filter((r) => r.ats_status === "Pending_Scan").length;
  const canUpload = isTA && SOURCING_STATUSES.includes(req.status);
  const rmgJdPreview = (req.rmg_jd_text || "").trim();
  const rmgJdFiles = req.rmg_jd_attachments || [];

  const columns: Column<ResumeRow>[] = [
    {
      key: "candidate_name", label: "Candidate",
      render: (r) => {
        const hasInvite = !!(r.ai_invite_url || r.ai_access_key);
        const inviteOpen = inviteOpenId === r.id;
        return (
          <div>
            <div className="font-semibold text-primary">{r.candidate_name}</div>
            {(r.email || r.phone) && (
              <div className="text-xs text-muted">
                {[r.email, r.phone].filter(Boolean).join(" · ")}
              </div>
            )}
            {(r.applicant_experience || r.application_details) && (
              <div className="mt-1 max-w-xs text-xs leading-relaxed text-muted">
                <div>
                  {[
                    r.applicant_experience ? `Exp ${r.applicant_experience}y` : null,
                    r.application_details?.notice_period ? `Notice ${r.application_details.notice_period}` : null,
                    r.application_details?.current_ctc ? `CTC ${r.application_details.current_ctc}` : null,
                    r.application_details?.expected_ctc ? `Exp. ${r.application_details.expected_ctc}` : null,
                    r.application_details?.preferred_location ? `📍 ${r.application_details.preferred_location}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {r.application_details?.skills && (
                  <div className="truncate" title={r.application_details.skills}>
                    Skills: {r.application_details.skills}
                  </div>
                )}
              </div>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <FileLink url={r.resume_file_url} label="Resume" />
              {hasInvite && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                  onClick={(e) => {
                    e.stopPropagation();
                    setInviteOpenId(inviteOpen ? null : r.id);
                  }}
                >
                  <Link2 size={12} />
                  {inviteOpen ? "Hide invite" : "Invite details"}
                </button>
              )}
            </div>
            {inviteOpen && hasInvite && (
              <div
                className="mt-2 max-w-md space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs dark:border-emerald-800 dark:bg-emerald-950/40"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden />
                    AI L1 invite — share manually
                  </div>
                  <button
                    type="button"
                    className={btnSecondary}
                    onClick={() => copyInvite(buildInviteEmail(r), "Email message")}
                    title="Copy a ready-to-paste email for the candidate"
                  >
                    <Copy size={13} /> Copy email
                  </button>
                </div>
                <div>
                  <div className="font-semibold text-muted">Name</div>
                  <div className="font-semibold text-primary">{r.candidate_name}</div>
                </div>
                <div>
                  <div className="font-semibold text-muted">Email</div>
                  <div className="text-primary">{r.email || "—"}</div>
                </div>
                <div>
                  <div className="font-semibold text-muted">Time</div>
                  <div className="text-primary">
                    {fmtDateTime(r.ai_interview_scheduled_at)}
                  </div>
                </div>
                {r.ai_invite_url && (
                  <div>
                    <div className="mb-1 font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                      Invite link
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="max-w-[14rem] truncate rounded-lg border border-emerald-200 dark:border-emerald-800 bg-surface-1 px-2 py-1 font-mono text-xs">
                        {r.ai_invite_url}
                      </span>
                      <button
                        type="button"
                        className={btnSecondary}
                        onClick={() => copyInvite(r.ai_invite_url!, "Invite link")}
                      >
                        <Copy size={13} /> Copy
                      </button>
                    </div>
                  </div>
                )}
                {r.ai_access_key && (
                  <div>
                    <div className="mb-1 font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                      Access key
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-surface-1 px-2 py-1 font-mono text-sm font-bold tracking-wider">
                        {r.ai_access_key}
                      </span>
                      <button
                        type="button"
                        className={btnSecondary}
                        onClick={() => copyInvite(r.ai_access_key!, "Access key")}
                      >
                        <Copy size={13} /> Copy
                      </button>
                    </div>
                  </div>
                )}
                <div>
                  <div className="mb-1 font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                    Email preview
                  </div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-emerald-200 dark:border-emerald-800 bg-surface-1 p-2 font-sans text-xs leading-relaxed text-primary">
                    {buildInviteEmail(r)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        );
      },
    },
    { key: "source_portal", label: "Source", render: (r) => r.source_portal || "—" },
    { key: "received_date", label: "Received", render: (r) => fmtDate(r.received_date || r.created_at) },
    { key: "ats_score", label: "ATS Score", render: (r) => <ScorePill row={r} onClick={() => setBreakdownRow(r)} /> },
    {
      key: "ats_status", label: "ATS Status",
      render: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <StatusBadge status={r.ats_status} />
          {r.ats_status === "Shortlisted" && autoIds.has(r.id) && (
            <span className={autoChip} title="Auto-shortlisted by the ATS threshold during this scan session">
              Auto
            </span>
          )}
        </span>
      ),
    },
    {
      key: "ai_interview_status", label: "AI Interview",
      render: (r) => {
        const status = r.ai_interview_status || "Not_Scheduled";
        const score = r.ai_overall_score_percent;
        const showReport = isTA && !!r.ai_report_link;
        return (
          <div className="flex flex-col items-start gap-1" onClick={(e) => e.stopPropagation()}>
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <StatusBadge status={status} />
              {score != null && Number.isFinite(Number(score)) && (
                <span
                  className="inline-flex items-center rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-bold tabular-nums text-primary"
                  title="AI L1 overall score"
                >
                  {Number(score) % 1 === 0 ? Number(score) : Number(score).toFixed(1)}%
                </span>
              )}
            </span>
            {showReport && (
              <a
                href={r.ai_report_link!}
                className="inline-flex items-center gap-1 text-xs font-semibold text-sky-600 hover:underline dark:text-sky-400"
                title="Open candidate AI interview report"
              >
                <ExternalLink size={12} /> View report
              </a>
            )}
          </div>
        );
      },
    },
    {
      key: "_actions", label: "Actions",
      render: (r) => {
        const busy = busyId === r.id;
        const profileId = r.profile_id ?? profileByResume[r.id];
        return (
          <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
            {isTA && r.ats_status === "Pending_Scan" && (
              <button className={busy ? smallScanning : smallBtn} onClick={() => scan(r)} disabled={busy || scanAllBusy}>
                {busy ? <AiThinking label="Scanning…" /> : <><ScanLine size={13} /> Run ATS Scan</>}
              </button>
            )}
            {isTA && r.ats_status !== "Shortlisted" && r.ats_status !== "Rejected" && (
              <button
                className={smallPrimary}
                onClick={() => shortlist(r)}
                disabled={busy || r.ats_score == null}
                title={r.ats_score == null ? "Run the ATS scan first" : "Shortlist this resume"}
              >
                <Star size={13} /> Shortlist
              </button>
            )}
            {isTA && r.ats_status !== "Rejected" && (
              <button className={smallDanger} onClick={() => setRejectRow(r)} disabled={busy}>
                <X size={13} /> Reject
              </button>
            )}
            {isTA && (r.ats_status === "Scored" || r.ats_status === "Shortlisted") && (
              <button
                className={`${smallBtn} ${focusRing}`}
                onClick={() => sendSlotInvite(r)}
                disabled={busy || inviteBusyId === r.id || (!r.email && !r.phone)}
                title={
                  !r.email && !r.phone
                    ? "No email or phone on file — add contact info to send a slot invite"
                    : "Email/WhatsApp the candidate a link to book an interview slot"
                }
              >
                <CalendarPlus size={13} />{" "}
                {inviteBusyId === r.id ? "Sending…" : r.slot_invite_sent ? "Resend slot invite" : "Slot invite"}
              </button>
            )}
            {isTA && r.ats_status === "Shortlisted" &&
              (!r.ai_interview_status || r.ai_interview_status === "Not_Scheduled") && (
              <button className={smallAi} onClick={() => setScheduleRow(r)} disabled={busy}>
                <Bot size={13} /> {busy ? "Scheduling…" : "Schedule AI L1 Interview"}
              </button>
            )}
            {profileId != null && (
              <button className={smallBtn} onClick={() => crmNavigate(`profiles/${profileId}`)}>
                <ExternalLink size={13} /> View profile
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {isTA && (
          <button className={btnSecondary} onClick={scanAll} disabled={scanAllBusy || pendingOnPage === 0}>
            <RefreshCw size={15} className={scanAllBusy ? "animate-spin" : ""} />
            {scanAllBusy ? "Scanning all pending…" : "Scan all pending"}
          </button>
        )}
        {canUpload && (
          <button className={btnPrimary} onClick={() => setShowUpload(true)}>
            <Plus size={16} /> Upload Resume
          </button>
        )}
      </div>
      {(rmgJdPreview || rmgJdFiles.length > 0) && (
        <div className="rounded-xl border border-subtle bg-surface-2 px-4 py-3">
          <div className="text-xs font-bold uppercase tracking-wide text-muted">JD used for scoring</div>
          {rmgJdPreview ? (
            <p className="mt-1 whitespace-pre-wrap text-sm text-primary">
              {rmgJdPreview.length > 400 ? `${rmgJdPreview.slice(0, 400)}…` : rmgJdPreview}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">RMG JD provided as file only.</p>
          )}
          {rmgJdFiles.length > 0 && (
            <ul className="mt-2 space-y-1">
              {rmgJdFiles.map((a) => (
                <li key={a.id}><FileLink url={a.file_url} label={a.file_name || "RMG JD"} /></li>
              ))}
            </ul>
          )}
        </div>
      )}
      {isTA && !canUpload && (
        <p className="text-xs text-muted">
          Resumes can be uploaded only while the requirement is Open For Sourcing, Posted On Portals or In Progress.
        </p>
      )}

      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : (
        /* While "Scan all pending" runs, the whole resumes section carries the
           animated AI border; it stops the moment the scan completes. */
        <div className={scanAllBusy ? "ai-generating rounded-2xl" : undefined}>
          <DataTable<ResumeRow>
            columns={columns}
            rows={rows}
            meta={meta}
            loading={loading}
            search={search}
            onSearch={setSearch}
            onPage={setPage}
            emptyMessage="No resumes received yet"
          />
        </div>
      )}

      {showUpload && (
        <UploadResumeModal
          req={req}
          onClose={() => setShowUpload(false)}
          onUploaded={() => { load(); onRequirementChanged(); }}
          toast={toast}
        />
      )}
      {breakdownRow && <BreakdownModal row={breakdownRow} onClose={() => setBreakdownRow(null)} />}
      {rejectRow && (
        <ConfirmModal
          title="Reject resume"
          message={<>Reject the resume of <span className="font-semibold">{rejectRow.candidate_name}</span>? This marks it as Rejected in the ATS.</>}
          confirmLabel="Reject"
          danger
          busy={busyId === rejectRow.id}
          onConfirm={doReject}
          onClose={() => setRejectRow(null)}
        />
      )}
      {scheduleRow && (
        <ConfirmModal
          title="Schedule AI L1 Interview"
          message={
            <>
              This creates the candidate + profile and generates an AI L1 invite for{" "}
              <span className="font-semibold">{scheduleRow.candidate_name}</span>. The link will be shown here (not auto-sent). Continue?
            </>
          }
          confirmLabel="Schedule"
          busy={busyId === scheduleRow.id}
          onConfirm={doSchedule}
          onClose={() => setScheduleRow(null)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------- interview slots tab */

type SlotFormRow = { slot_at: string; capacity: string };

function AddSlotsModal({
  reqId, onClose, onAdded, toast,
}: {
  reqId: number;
  onClose: () => void;
  onAdded: () => void;
  toast: ToastFn;
}) {
  const [rows, setRows] = useState<SlotFormRow[]>([{ slot_at: "", capacity: "1" }]);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  const updateRow = (i: number, patch: Partial<SlotFormRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    const errs: Record<number, string> = {};
    rows.forEach((r, i) => {
      if (!r.slot_at) { errs[i] = "Pick a date & time"; return; }
      const d = new Date(r.slot_at);
      if (isNaN(d.getTime())) { errs[i] = "Invalid date/time"; return; }
      if (d.getTime() <= Date.now()) { errs[i] = "Slot must be in the future"; return; }
      const cap = Number(r.capacity);
      if (r.capacity.trim() === "" || !Number.isInteger(cap) || cap < 1) {
        errs[i] = "Capacity must be a whole number of at least 1";
      }
    });
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    try {
      const res = await crmPost<Slot[]>(
        `/api/requirements/${reqId}/slots`,
        rows.map((r) => ({ slot_at: new Date(r.slot_at).toISOString(), capacity: Number(r.capacity) })),
      );
      const n = (res.data || []).length || rows.length;
      toast(res.message || `${n} slot${n === 1 ? "" : "s"} added`);
      onAdded();
      onClose();
    } catch (e: any) {
      toast(e?.message || "Failed to add slots", "err");
      setBusy(false);
    }
  };

  return (
    <Modal title="Add interview slots" onClose={onClose} fullScreen>
      <div className="space-y-3">
        <p className="text-sm text-secondary">
          Add one or more future interview slots. Candidates pick a slot from their booking link;
          capacity is how many candidates can book the same slot.
        </p>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i}>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className={`${inputCls} !w-60`}
                  type="datetime-local"
                  value={r.slot_at}
                  onChange={(e) => {
                    updateRow(i, { slot_at: e.target.value });
                    if (errors[i]) setErrors((es) => { const n = { ...es }; delete n[i]; return n; });
                  }}
                  aria-label={`Slot ${i + 1} date and time`}
                />
                <input
                  className={`${inputCls} !w-28`}
                  type="number"
                  min={1}
                  step={1}
                  value={r.capacity}
                  onChange={(e) => {
                    updateRow(i, { capacity: e.target.value });
                    if (errors[i]) setErrors((es) => { const n = { ...es }; delete n[i]; return n; });
                  }}
                  aria-label={`Slot ${i + 1} capacity`}
                  title="Capacity (candidates per slot)"
                />
                {rows.length > 1 && (
                  <button
                    type="button"
                    className={`rounded-lg p-1.5 text-muted hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 ${focusRing}`}
                    onClick={() => {
                      setRows((rs) => rs.filter((_, idx) => idx !== i));
                      setErrors({});
                    }}
                    aria-label={`Remove slot row ${i + 1}`}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
              {errors[i] && <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">{errors[i]}</div>}
            </div>
          ))}
        </div>
        <button
          type="button"
          className={`${smallBtn} ${focusRing}`}
          onClick={() => setRows((rs) => [...rs, { slot_at: "", capacity: "1" }])}
        >
          <Plus size={13} /> Add another slot
        </button>
        <div className="flex justify-end gap-2 pt-2">
          <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={btnPrimary} onClick={submit} disabled={busy}>
            {busy ? "Adding…" : `Add ${rows.length} slot${rows.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AvailabilityChip({ slot }: { slot: Slot }) {
  const past = new Date(slot.slot_at).getTime() < Date.now();
  const left = slot.capacity - slot.booked_count;
  if (past) {
    return (
      <span className="inline-flex rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">
        Past
      </span>
    );
  }
  if (left <= 0) {
    return (
      <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
        Full
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
      {left} open
    </span>
  );
}

function SlotsTab({ req, toast }: { req: Req; toast: ToastFn }) {
  const isTA = useHasRole("TA");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slotsError, setSlotsError] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [bookingsError, setBookingsError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [deleteSlot, setDeleteSlot] = useState<Slot | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [copiedToken, setCopiedToken] = useState("");

  const loadSlots = useCallback(async () => {
    setSlotsLoading(true);
    setSlotsError("");
    try {
      const res = await crmGet<Slot[]>(`/api/requirements/${req.id}/slots`);
      setSlots(res.data || []);
    } catch (e: any) {
      setSlotsError(e?.message || "Failed to load interview slots");
    } finally {
      setSlotsLoading(false);
    }
  }, [req.id]);

  const loadBookings = useCallback(async () => {
    setBookingsLoading(true);
    setBookingsError("");
    try {
      const res = await crmGet<Booking[]>(`/api/requirements/${req.id}/bookings`);
      setBookings(res.data || []);
    } catch (e: any) {
      setBookingsError(e?.message || "Failed to load bookings");
    } finally {
      setBookingsLoading(false);
    }
  }, [req.id]);

  useEffect(() => { loadSlots(); }, [loadSlots]);
  useEffect(() => { loadBookings(); }, [loadBookings]);

  const doDeleteSlot = async () => {
    if (!deleteSlot) return;
    setDeleteBusy(true);
    try {
      const res = await crmDelete(`/api/slots/${deleteSlot.id}`);
      toast(res.message || "Slot deleted");
      setDeleteSlot(null);
      loadSlots();
    } catch (e: any) {
      // Surfaces the backend 400 (e.g. "slot has confirmed bookings").
      toast(e?.message || "Failed to delete slot", "err");
      setDeleteSlot(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const copyBookingLink = async (b: Booking) => {
    const url = `${window.location.origin}/book/${b.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(b.token);
      toast("Booking link copied");
      window.setTimeout(() => setCopiedToken((t) => (t === b.token ? "" : t)), 2000);
    } catch {
      toast("Clipboard blocked by the browser — copy the invite link instead", "err");
    }
  };

  const slotCols: Column<Slot>[] = [
    {
      key: "slot_at", label: "Date & time",
      render: (s) => <span className="font-semibold text-primary">{fmtDateTime(s.slot_at)}</span>,
    },
    { key: "capacity", label: "Capacity" },
    { key: "booked_count", label: "Booked" },
    { key: "_availability", label: "Availability", render: (s) => <AvailabilityChip slot={s} /> },
    ...(isTA
      ? [{
          key: "_actions", label: "", className: "!text-right",
          render: (s: Slot) => (
            <span className="flex justify-end">
              <button
                className={`rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 ${focusRing}`}
                onClick={(e) => { e.stopPropagation(); setDeleteSlot(s); }}
                aria-label={`Delete slot ${fmtDateTime(s.slot_at)}`}
              >
                <Trash2 size={14} />
              </button>
            </span>
          ),
        } as Column<Slot>]
      : []),
  ];

  const bookingCols: Column<Booking>[] = [
    {
      key: "candidate_name", label: "Candidate",
      render: (b) => <span className="font-semibold text-primary">{b.candidate_name}</span>,
    },
    { key: "status", label: "Status", render: (b) => <StatusBadge status={b.status} /> },
    { key: "slot_at", label: "Chosen slot", render: (b) => fmtDateTime(b.slot_at) },
    { key: "confirmed_at", label: "Confirmed", render: (b) => fmtDateTime(b.confirmed_at) },
    { key: "created_at", label: "Invited", render: (b) => fmtDate(b.created_at) },
    {
      key: "invite_url", label: "Invite",
      render: (b) => <FileLink url={b.invite_url} label="Invite" />,
    },
    {
      key: "_copy", label: "Booking link",
      render: (b) => (
        <button
          className={`${smallBtn} ${focusRing}`}
          onClick={(e) => { e.stopPropagation(); copyBookingLink(b); }}
          title={`${window.location.origin}/book/${b.token}`}
        >
          <Copy size={13} /> {copiedToken === b.token ? "Copied" : "Copy link"}
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {isTA && (
        <div className="flex justify-end">
          <button className={btnPrimary} onClick={() => setShowAdd(true)}>
            <CalendarPlus size={16} /> Add slots
          </button>
        </div>
      )}

      {slotsError ? (
        <ErrorBox error={slotsError} onRetry={loadSlots} />
      ) : (
        <DataTable<Slot>
          columns={slotCols}
          rows={slots}
          loading={slotsLoading}
          emptyMessage={isTA ? "No interview slots yet — add slots so candidates can book" : "No interview slots yet"}
        />
      )}

      <h2 className="fx-hairline-b pb-1.5 pt-2 text-sm font-bold uppercase tracking-wide text-muted">
        Bookings
      </h2>
      {bookingsError ? (
        <ErrorBox error={bookingsError} onRetry={loadBookings} />
      ) : (
        <DataTable<Booking>
          columns={bookingCols}
          rows={bookings}
          loading={bookingsLoading}
          emptyMessage="No slot invites sent yet"
        />
      )}

      {showAdd && (
        <AddSlotsModal
          reqId={req.id}
          onClose={() => setShowAdd(false)}
          onAdded={loadSlots}
          toast={toast}
        />
      )}
      {deleteSlot && (
        <ConfirmModal
          title="Delete interview slot"
          message={
            <>
              Delete the slot on <span className="font-semibold">{fmtDateTime(deleteSlot.slot_at)}</span>
              {deleteSlot.booked_count > 0 && (
                <> ({deleteSlot.booked_count} booking{deleteSlot.booked_count === 1 ? "" : "s"})</>
              )}
              ? Slots with confirmed bookings cannot be deleted.
            </>
          }
          confirmLabel="Delete slot"
          danger
          busy={deleteBusy}
          onConfirm={doDeleteSlot}
          onClose={() => setDeleteSlot(null)}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------- activity tab */

function ActivityTab({ reqId }: { reqId: number }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    setLoading(true);
    crmGet<any[]>(`/api/requirements/${reqId}/activity-log`)
      .then((r) => setEntries((r.data || []).map((e: any) => ({ ...e, timestamp: e.timestamp || "" }))))
      .catch((e: any) => setError(e?.message || "Failed to load activity log"))
      .finally(() => setLoading(false));
  }, [reqId]);
  if (loading) return <Spinner label="Loading activity…" />;
  if (error) return <ErrorBox error={error} />;
  return (
    <div className="rounded-card border border-subtle bg-surface-1 p-5 shadow-sm">
      <Timeline entries={entries} />
    </div>
  );
}

/* --------------------------------------------------------------- detail */

export function RequirementDetailPage() {
  const params = useCrmParams();
  const id = Number(params.id);
  const me = useMe();
  const [toastNode, toast] = useToast();

  const isTA = useHasRole("TA");
  const isSalesHead = useHasRole("Sales_Head");
  const isRMG = useHasRole("RMG");
  const canSeeResumes = useHasRole("TA", "RMG", "Sales_Head");
  const isAdmin = me.roles.includes("Admin");

  const [req, setReq] = useState<Req | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [locationName, setLocationName] = useState("");
  const [tab, setTab] = useState<string>(isTA ? "resumes" : "postings");
  const [showEdit, setShowEdit] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [decision, setDecision] = useState<{ stage: "sales-head" | "engineering"; kind: "approve" | "reject" } | null>(null);
  const [confirmTerminal, setConfirmTerminal] = useState<"close" | "cancel" | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [activityKey, setActivityKey] = useState(0); // bump to force activity reload
  const [linkedTemplate, setLinkedTemplate] = useState<{
    template_name?: string | null;
    template_job_id?: string | null;
    tr_number?: string;
    status?: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<Req>(`/api/requirements/${id}`);
      setReq(res.data);
    } catch (e: any) {
      setError(e?.message || "Failed to load requirement");
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    crmGet<any[]>(`/api/template-requests${qs({ requirement_id: id, limit: 20 })}`)
      .then((r) => {
        const ready = (r.data || []).find(
          (t) =>
            (t.status === "Template_Ready" || t.status === "Prepared") &&
            t.template_job_id,
        );
        setLinkedTemplate(ready || null);
      })
      .catch(() => setLinkedTemplate(null));
  }, [id, activityKey]);

  useEffect(() => {
    if (!req?.customer_id) { setCustomerName(""); return; }
    crmGet<any>(`/api/customers/${req.customer_id}`)
      .then((r) => setCustomerName(r.data?.name || ""))
      .catch(() => setCustomerName(""));
  }, [req?.customer_id]);

  useEffect(() => {
    if (!req?.location_id) { setLocationName(""); return; }
    crmGet<any>(`/api/locations/${req.location_id}`)
      .then((r) => setLocationName(r.data ? [r.data.city, r.data.state, r.data.country].filter(Boolean).join(", ") : ""))
      .catch(() => setLocationName(""));
  }, [req?.location_id]);

  const onChanged = useCallback((updated?: Req) => {
    if (updated) setReq(updated);
    else load();
    setActivityKey((k) => k + 1);
  }, [load]);

  if (loading && !req) return <Spinner label="Loading requirement…" />;
  if (error && !req) return <ErrorBox error={error} onRetry={load} />;
  if (!req) return <ErrorBox error="Requirement not found" />;

  const isCreatorSales = isAdmin || (me.roles.includes("Sales") && req.created_by === me.id);
  const canEdit = isCreatorSales && EDITABLE_STATUSES.includes(req.status);
  const canSubmit = canEdit;
  const canSalesHeadDecide = isSalesHead && req.status === "Pending_Sales_Head_Approval";
  const canRmgDecide = isRMG && req.status === "Pending_Engineering_Review";
  const canTerminate = isSalesHead && !TERMINAL_STATUSES.includes(req.status);

  const doSubmit = async () => {
    setActionBusy(true);
    try {
      const res = await crmPost<Req>(`/api/requirements/${req.id}/submit`);
      toast(res.message || "Submitted for Sales Head approval");
      setConfirmSubmit(false);
      onChanged(res.data);
    } catch (e: any) {
      toast(e?.message || "Submit failed", "err");
    } finally {
      setActionBusy(false);
    }
  };

  const doRequestTemplate = async () => {
    setActionBusy(true);
    try {
      const res = await crmPost(`/api/template-requests`, { requirement_id: req.id });
      toast(res.message || "Template request raised for RMG");
      crmNavigate("template-requests");
    } catch (e: any) {
      toast(e?.message || "Failed to raise template request", "err");
    } finally {
      setActionBusy(false);
    }
  };

  const doTerminal = async () => {
    if (!confirmTerminal) return;
    setActionBusy(true);
    try {
      const res = await crmPost<Req>(`/api/requirements/${req.id}/${confirmTerminal}`);
      toast(res.message || `Requirement ${confirmTerminal}d`);
      setConfirmTerminal(null);
      onChanged(res.data);
    } catch (e: any) {
      toast(e?.message || "Action failed", "err");
    } finally {
      setActionBusy(false);
    }
  };

  const detailTabs = [
    { key: "postings", label: "Job Postings" },
    ...(canSeeResumes
      ? [
          { key: "resumes", label: "Resumes" },
          { key: "slots", label: "Interview Slots" },
        ]
      : []),
    { key: "activity", label: "Activity Log" },
  ];

  return (
    <div className="space-y-4">
      {toastNode}

      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CrmLink
            to="requirements"
            className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-sky-600"
          >
            <ArrowLeft size={13} /> Requirements
          </CrmLink>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-display text-xl font-bold text-primary">
              {req.req_number} — {req.title}
            </h1>
            <StatusBadge status={req.status} />
          </div>
          <div className="mt-1 text-sm text-muted">
            {customerName || (req.customer_id != null ? `Customer #${req.customer_id}` : "No customer")}
            {" · "}{req.no_of_positions} position{req.no_of_positions === 1 ? "" : "s"}
            {" · "}<PriorityPill p={req.priority} />
          </div>
        </div>

        {/* action bar */}
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <button className={btnSecondary} onClick={() => setShowEdit(true)}>
              <Pencil size={15} /> Edit
            </button>
          )}
          {canSubmit && (
            <button className={btnPrimary} onClick={() => setConfirmSubmit(true)}>
              <Send size={15} /> Submit for Approval
            </button>
          )}
          {isTA && SOURCING_STATUSES.includes(req.status) && (
            <button className={btnSecondary} onClick={doRequestTemplate} disabled={actionBusy}>
              <Send size={15} /> Request template
            </button>
          )}
          {canSalesHeadDecide && (
            <>
              <button className={btnPrimary} onClick={() => setDecision({ stage: "sales-head", kind: "approve" })}>
                <Check size={15} /> Approve
              </button>
              <button className={btnDanger} onClick={() => setDecision({ stage: "sales-head", kind: "reject" })}>
                <X size={15} /> Reject
              </button>
            </>
          )}
          {canRmgDecide && (
            <>
              <button className={btnPrimary} onClick={() => setDecision({ stage: "engineering", kind: "approve" })}>
                <Check size={15} /> Engineering Approve
              </button>
              <button className={btnDanger} onClick={() => setDecision({ stage: "engineering", kind: "reject" })}>
                <X size={15} /> Engineering Reject
              </button>
            </>
          )}
          {canTerminate && (
            <>
              <button className={btnSecondary} onClick={() => setConfirmTerminal("close")}>Close</button>
              <button className={btnDanger} onClick={() => setConfirmTerminal("cancel")}>Cancel</button>
            </>
          )}
        </div>
      </div>

      {/* rejection reasons */}
      {req.status === "Sales_Head_Rejected" && req.sales_head_rejection_reason && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-4 py-3">
          <div className="text-sm font-bold text-rose-700 dark:text-rose-300">Rejected by Sales Head</div>
          <div className="mt-0.5 text-sm text-rose-700 dark:text-rose-300">{req.sales_head_rejection_reason}</div>
        </div>
      )}
      {req.status === "Engineering_Rejected" && req.engineering_rejection_reason && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-4 py-3">
          <div className="text-sm font-bold text-rose-700 dark:text-rose-300">Rejected by Engineering (RMG)</div>
          <div className="mt-0.5 text-sm text-rose-700 dark:text-rose-300">{req.engineering_rejection_reason}</div>
        </div>
      )}

      {/* Approval/sourcing lifecycle stepper — hidden for TA (they work from Sourcing onward). */}
      {(!me.roles.includes("TA") || isAdmin) && <StatusStepper status={req.status} />}

      {linkedTemplate && (
        <div className="rounded-card fx-gradient-border-animated bg-surface-1 px-4 py-3 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden />
            Linked AI L1 template
          </div>
          <div className="mt-1 text-sm font-semibold text-primary">
            {linkedTemplate.template_name || "Template"}
            {linkedTemplate.template_job_id ? (
              <span className="ml-2 font-mono text-xs font-normal text-muted">
                {linkedTemplate.template_job_id}
              </span>
            ) : null}
          </div>
          {linkedTemplate.tr_number && (
            <div className="mt-0.5 text-xs text-muted">
              From {linkedTemplate.tr_number} · {String(linkedTemplate.status || "").replace(/_/g, " ")}
            </div>
          )}
        </div>
      )}

      {/* details + skills */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-card border border-subtle bg-surface-1 p-5 shadow-sm lg:col-span-2">
          <h2 className="fx-hairline-b mb-3 pb-1.5 text-sm font-bold uppercase tracking-wide text-muted">Details</h2>
          {req.description && (
            <p className="mb-4 whitespace-pre-wrap text-sm text-primary">{req.description}</p>
          )}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Experience</dt>
              <dd className="font-semibold text-primary">{fmtRange(req.experience_min, req.experience_max, "yrs")}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Budget CTC</dt>
              <dd className="font-semibold text-primary">{fmtRange(req.budget_ctc_min, req.budget_ctc_max, "")}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Work mode</dt>
              <dd className="font-semibold text-primary">{req.work_mode || "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Location</dt>
              <dd className="font-semibold text-primary">{locationName || "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Target closure</dt>
              <dd className="font-semibold text-primary">{fmtDate(req.target_closure_date)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Created</dt>
              <dd className="font-semibold text-primary">{fmtDate(req.created_at)}</dd>
            </div>
          </dl>
        </div>
        <div className="rounded-card border border-subtle bg-surface-1 p-5 shadow-sm">
          <h2 className="fx-hairline-b mb-3 pb-1.5 text-sm font-bold uppercase tracking-wide text-muted">Skills</h2>
          {req.skills.length === 0 ? (
            <p className="text-sm text-muted">No skills defined</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {req.skills.map((s) => (
                <span
                  key={s.skill_id}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    s.is_mandatory
                      ? "bg-sky-600 text-white"
                      : "border border-strong text-secondary"
                  }`}
                  title={s.is_mandatory ? "Mandatory skill" : "Optional skill"}
                >
                  {s.is_mandatory && <Star size={11} className="fill-current" />}
                  {s.name || `Skill #${s.skill_id}`}
                  {s.min_rating != null && <span className="opacity-75">· {s.min_rating}+/5</span>}
                </span>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-muted">
            <Star size={10} className="mr-0.5 inline fill-current" /> filled = mandatory (drives the ATS score)
          </p>
        </div>
      </div>

      {/* Job descriptions */}
      <div className="rounded-card border border-subtle bg-surface-1 p-5 shadow-sm">
        <h2 className="fx-hairline-b mb-3 pb-1.5 text-sm font-bold uppercase tracking-wide text-muted">JD</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Customer JD</div>
            {(req.customer_jd_attachments || []).length === 0 ? (
              <p className="text-sm text-muted">None uploaded on the opportunity</p>
            ) : (
              <ul className="space-y-1">
                {(req.customer_jd_attachments || []).map((a) => (
                  <li key={a.id}><FileLink url={a.file_url} label={a.file_name || "Customer JD"} /></li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">RMG JD</div>
            {req.rmg_jd_text ? (
              <p className="mb-2 whitespace-pre-wrap text-sm text-primary">{req.rmg_jd_text}</p>
            ) : (
              <p className="mb-2 text-sm text-muted">No RMG JD text yet</p>
            )}
            {(req.rmg_jd_attachments || []).length > 0 && (
              <ul className="space-y-1">
                {(req.rmg_jd_attachments || []).map((a) => (
                  <li key={a.id}><FileLink url={a.file_url} label={a.file_name || "RMG JD"} /></li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* tabs */}
      <Tabs tabs={detailTabs} active={tab} onChange={setTab} />
      {tab === "postings" && <JobPostingsTab req={req} toast={toast} onRequirementChanged={() => onChanged()} />}
      {tab === "resumes" && canSeeResumes && (
        <ResumesTab req={req} toast={toast} onRequirementChanged={() => onChanged()} />
      )}
      {tab === "slots" && canSeeResumes && <SlotsTab req={req} toast={toast} />}
      {tab === "activity" && <ActivityTab key={activityKey} reqId={req.id} />}

      {/* modals */}
      {showEdit && (
        <RequirementFormModal
          initial={req}
          onClose={() => setShowEdit(false)}
          onSaved={(r) => onChanged(r)}
          toast={toast}
        />
      )}
      {confirmSubmit && (
        <ConfirmModal
          title="Submit for approval"
          message={
            <>
              Submit <span className="font-semibold">{req.req_number} — “{req.title}”</span> for Sales Head approval?
              {req.status !== "Draft" && " This resubmits the previously rejected requirement."}
            </>
          }
          confirmLabel="Submit"
          busy={actionBusy}
          onConfirm={doSubmit}
          onClose={() => setConfirmSubmit(false)}
        />
      )}
      {decision && (
        <DecisionModal
          req={req}
          stage={decision.stage}
          kind={decision.kind}
          onClose={() => setDecision(null)}
          onDone={(r) => onChanged(r)}
          toast={toast}
        />
      )}
      {confirmTerminal && (
        <ConfirmModal
          title={confirmTerminal === "close" ? "Close requirement" : "Cancel requirement"}
          message={
            <>
              {confirmTerminal === "close" ? "Close" : "Cancel"}{" "}
              <span className="font-semibold">{req.req_number} — “{req.title}”</span>? This is a terminal state and
              cannot be undone.
            </>
          }
          confirmLabel={confirmTerminal === "close" ? "Close requirement" : "Cancel requirement"}
          danger
          busy={actionBusy}
          onConfirm={doTerminal}
          onClose={() => setConfirmTerminal(null)}
        />
      )}
    </div>
  );
}
