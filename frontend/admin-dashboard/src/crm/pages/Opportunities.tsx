/** Opportunity pipeline pages: tabbed list (stage buckets) + detail with skills,
 * linked candidate profiles, server-validated stage transitions and activity log.
 * Calm-premium recipe (DESIGN-DECISIONS.md): token-only colors, raised cards,
 * one primary action per screen, right-aligned numerics in tables. */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRightLeft, ChevronDown, Mail, Pencil, Plus, UserPlus } from "lucide-react";
import { crmGet, crmPost, qs } from "../api";
import { fetchAllMaster } from "../lib/fetchAllMaster";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanAct, useCrmAccess } from "../useAccess";
import { CrmLink, crmNavigate, useCrmParams } from "../routerHooks";
import { displayEmail, realEmail } from "../lib/candidateEmail";
import { DataTable } from "../components/DataTable";
import type { Column, ColumnFilterValue } from "../components/DataTable";
import { RowActions, afterListDelete } from "../components/RowActions";
import { FileLink } from "../components/FileUpload";
import { AiInterviewCell } from "../components/AiInterviewCell";
import { Timeline } from "../components/Timeline";
import type { ActivityEntry } from "../components/Timeline";
import { NewOpportunityForm } from "./opportunity/NewOpportunityForm";
import { ProjectsListPage } from "./Projects";
import { ProjectEmployeesPage } from "./ProjectEmployees";
import { CustomerScopedTable, ProjectEmployeesScopedTab } from "./Customers";
import { OPPORTUNITY_SCHEMA, sectionVisible, fieldVisible } from "./opportunity/opportunitySchema";
import type { OpportunityType, SectionDef, FieldDef } from "./opportunity/opportunitySchema";
import { ApplyToOpportunityModal } from "../components/ApplyToOpportunityModal";
import { DuplicateProfileNotice, duplicateProfileFromError, duplicateProfileSummary } from "../components/DuplicateProfileNotice";
import type { DuplicateProfile } from "../components/DuplicateProfileNotice";
import {
  EmptyState,
  ErrorBox,
  Field,
  Modal,
  Spinner,
  StatusBadge,
  Tabs,
  btnDanger,
  btnPrimary,
  btnSecondary,
  inputCls,
  useToast, selfWithdrewLabel } from "../components/ui";
import { TeachingEmpty } from "../components/TeachingEmpty";

/* ------------------------------------------------------------------ types */

type OppSkill = { id: number; skill_id: number; skill_name?: string | null; is_mandatory: boolean };

type Opportunity = {
  id: number;
  opp_id: string;
  title: string;
  customer_id: number;
  customer_name?: string | null;
  branch_id?: number | null;
  contact_person_id?: number | null;
  hiring_manager_id?: number | null;
  opp_type: string;
  rfi_value?: number | null;
  rfi_received_date?: string | null;
  pipeline_stage: string;
  approval_status?: string;
  sales_head_approved_by?: number | null;
  sales_head_approved_at?: string | null;
  approval_rejection_reason?: string | null;
  onboarding_status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  // detail-only
  branch_name?: string | null;
  contact_person_name?: string | null;
  hiring_manager_name?: string | null;
  skills?: OppSkill[];
  allowed_next_stages?: string[];
  /** Type-specific form body (detail endpoint) — everything the wizard filled. */
  details?: Record<string, unknown> | null;
  ctc_slab?: Record<string, unknown>[] | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  customer_type?: string | null;
  hiring_manager_email?: string | null;
  hiring_manager_contact?: string | null;
};

type SkillOpt = { id: number; name: string; category?: string | null };

type ProfileRow = {
  id: number;
  candidate_id: number;
  opportunity_id: number;
  pipeline_status: string;
  candidate_name?: string | null;
  email?: string | null;
  phone?: string | null;
  experience_years?: number | null;
  notice_period?: string | null;
  /* AI L1 outcome — see AiInterviewCell. */
  ai_interview_status?: string | null;
  ai_interview_result?: string | null;
  ai_overall_score_percent?: number | null;
  ai_hr_decision?: string | null;
  ai_hr_decision_label?: string | null;
  ai_effective_result?: string | null;
  ai_is_overridden?: boolean;
  ai_report_link?: string | null;
  technical_domain?: string | null;
  cv_url?: string | null;
  current_ctc?: number | null;
  expected_ctc?: number | null;
  hike_percent?: number | null;
  candidate_current_ctc?: number | null;
  candidate_expected_ctc?: number | null;
  created_at?: string | null;
  opportunity_title?: string | null;
  opportunity_opp_id?: string | null;
};

/* ------------------------------------------------------------------ constants */

/** Friendly labels for pipeline_stage (API values stay snake-cased). */
export const PIPELINE_STAGE_LABELS: Record<string, string> = {
  New: "New",
  Active: "Active",
  On_Hold: "Customer Hold",
  Sales_Hold: "Sales Hold",
  Closed_Won: "Close Won",
  Closed_Lost: "Close Lost",
  Closed_Partial: "Close Partial",
  Rejected: "Rejected",
  Archived: "Archived",
};

export function pipelineStageLabel(stage: string): string {
  return PIPELINE_STAGE_LABELS[stage] || String(stage || "").replace(/_/g, " ");
}

/** Backend accepts ONE ?pipeline_stage= value, so multi-stage tabs expose a
 * stage sub-select. Default is "All stages" (18 Aug 2026, user request) — the
 * Active tab used to open pre-narrowed to "Active", which hid brand-new deals
 * sitting in "New". Single-stage tabs have no select and stay pinned to their
 * one stage so server-side pagination stays correct. */
/* Filter model (18 Aug 2026): each opportunity lives in EXACTLY ONE tab —
 * pending-approval deals appear ONLY under "Pending Approval" (never inside
 * Active/New), rejected ones ONLY under "Rejected" (approval rejections),
 * and the stage tabs show approved deals alone. The old "All approvals"
 * dropdown is gone — the tab IS the approval filter. */
const TAB_STAGES: Record<string, string[]> = {
  Active: ["Active", "New"],
  On_Hold: ["On_Hold"],
  Sales_Hold: ["Sales_Hold"],
  Closed: ["Closed_Won", "Closed_Lost", "Closed_Partial"],
  Archived: ["Archived"],
};

const LIST_TABS = [
  { key: "Active", label: "Active" },
  { key: "Pending", label: "Pending Approval" },
  { key: "On_Hold", label: "Customer Hold" },
  { key: "Sales_Hold", label: "Sales Hold" },
  { key: "Closed", label: "Closed" },
  { key: "Rejected", label: "Rejected" },
  { key: "Archived", label: "Archived" },
  // Sidebar entries for these moved into the customer hub (HUB_COVERED) —
  // these two tabs are the pipeline-side road to the same pages.
  { key: "Projects", label: "Project" },
  { key: "ProjectEmployees", label: "Project Employee" },
];

const PENDING_APPROVAL_STATUS = "Pending_Sales_Head_Approval";

const fmtMoney = (v?: number | null) => (v === null || v === undefined ? "—" : Number(v).toLocaleString());
const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : "—");

/* ------------------------------------------------------------------ list page */

export function OpportunitiesListPage({ typeFilter }: { typeFilter?: "T&M" | "SOW" } = {}) {
  /* Both hooks must run unconditionally (rules-of-hooks) — combine after. */
  const canWriteRole = useHasRole("Sales", "Sales_Head");
  const canWrite = useCanAct("opportunities", "edit", canWriteRole);
  // Roles allowed to create a Candidate Profile.
  const canApply = useCanAct("profiles", "create", useHasRole("TA", "Sales", "RMG"));
  const [tab, setTab] = useState("Active");
  // "" = All stages (the tab's whole stage set) — see TAB_STAGES note above.
  const [stage, setStage] = useState<string>("");
  const [rows, setRows] = useState<Opportunity[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<{ by: string; dir: "asc" | "desc" }>({ by: "created_at", dir: "desc" });
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [applyTo, setApplyTo] = useState<Opportunity | null>(null);
  const [toast, showToast] = useToast();
  /* Per-column header filters (4 Sep 2026, user request). Server-side —
     the list is paginated, so filtering the page in hand would hide matches
     on other pages. Kept across the status sub-tabs: a user narrowing to one
     customer wants that to hold while they flip Active → Closed. */
  const [colFilters, setColFilters] = useState<Record<string, ColumnFilterValue>>({});
  const onColumnFilter = (key: string, v: ColumnFilterValue | null) => {
    setColFilters((prev) => {
      const next = { ...prev };
      if (v) next[key] = v;
      else delete next[key];
      return next;
    });
    setPage(1);
  };
  const [customerOpts, setCustomerOpts] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    crmGet<any[]>("/api/customers/names")
      .then((r) => setCustomerOpts((r.data || [])
        .map((c: any) => ({ value: String(c.id), label: String(c.name) }))
        .sort((a: any, b: any) => a.label.localeCompare(b.label))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // A Type column pick narrows within the tab's family (T&M / SOW);
      // otherwise the tab's family filter applies.
      const typePick = colFilters.opp_type?.value;
      const base = { page, limit: 20, search: debounced, sort_by: sort.by, sort_dir: sort.dir,
        ...(typePick ? { opp_type: typePick } : typeFilter ? { opp_type: typeFilter } : {}),
        opp_id: colFilters.opp_id?.text || undefined,
        title: colFilters.title?.text || undefined,
        customer_id: colFilters.customer_name?.value || undefined,
        rfi_min: colFilters.rfi_value?.min || undefined,
        rfi_max: colFilters.rfi_value?.max || undefined,
        created_from: colFilters.created_at?.from || undefined,
        created_to: colFilters.created_at?.to || undefined,
      };
      const query =
        tab === "Pending"
          ? { approval_status: PENDING_APPROVAL_STATUS, ...base }
          : tab === "Rejected"
            ? { approval_status: "Rejected", ...base }
            // "" (All stages) → send the tab's stages as CSV so the tab still
            // owns exactly its own deals; the backend `in_`s them in one query.
            : { pipeline_stage: stage || (TAB_STAGES[tab] || []).join(","),
                approval_status: "Approved", ...base };
      const res = await crmGet<Opportunity[]>(`/api/opportunities${qs(query)}`);
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load opportunities");
    } finally {
      setLoading(false);
    }
  }, [tab, stage, page, debounced, sort, typeFilter, colFilters]);

  useEffect(() => {
    load();
  }, [load]);

  const typeOpts = (typeFilter === "SOW"
    ? ["Work_Package", "Fixed_Price", "Retainer"]
    : typeFilter === "T&M" ? ["T&M"] : ["T&M", "Work_Package", "Fixed_Price", "Retainer"])
    .map((t) => ({ value: t, label: t.replace(/_/g, " ") }));

  const switchTab = (key: string) => {
    setTab(key);
    // Always back to "All stages" — single-stage tabs resolve to their one
    // stage via the CSV fallback, so no select is needed there.
    setStage("");
    setPage(1);
  };

  const stages = TAB_STAGES[tab] || [];

  const columns: Column<Opportunity>[] = [
    { key: "opp_id", label: "Opp ID", sortable: true, filter: { type: "text", placeholder: "e.g. OPP-2026" } },
    { key: "title", label: "Title", sortable: true, filter: { type: "text", placeholder: "Contains…" } },
    { key: "customer_name", label: "Customer", sortable: true, render: (r) => r.customer_name || "—",
      filter: { type: "select", options: customerOpts } },
    { key: "opp_type", label: "Type", sortable: true, render: (r) => String(r.opp_type || "—").replace(/_/g, " "),
      // One family per tab: T&M has a single type, so no filter to offer there.
      ...(typeOpts.length > 1 ? { filter: { type: "select" as const, options: typeOpts } } : {}) },
    // Stage & Approval columns removed (14 Aug 2026): the tab strip + the two
    // dropdown filters carry that state, so the columns were pure repetition.
    { key: "rfi_value", label: "RFI Value", sortable: true, align: "right", render: (r) => fmtMoney(r.rfi_value),
      filter: { type: "number-range", minLabel: "Min ₹", maxLabel: "Max ₹" } },
    { key: "created_at", label: "Created", sortable: true, align: "right", render: (r) => fmtDate(r.created_at),
      filter: { type: "date-range" } },
  ];

  return (
    <div>
      {/* Page header: 24px title, muted 14px subtitle, THE primary action right. */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-display text-xl font-bold text-primary">Opportunities</h1>
          <p className="mt-1 text-sm text-muted">Track and manage the sales pipeline.</p>
        </div>
        {canWrite && (
          <button className={btnPrimary} onClick={() => setShowCreate(true)}>
            <Plus size={15} /> New Opportunity
          </button>
        )}
      </div>

      <div className="mb-4">
        <Tabs tabs={LIST_TABS} active={tab} onChange={switchTab} />
      </div>

      {tab === "Projects" ? (
        <ProjectsListPage />
      ) : tab === "ProjectEmployees" ? (
        <ProjectEmployeesPage />
      ) : error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : (
        <DataTable<Opportunity>
          columns={columns}
          rows={rows}
          meta={meta}
          headerRight={meta ? <span className="whitespace-nowrap text-xs font-medium text-muted">{meta.total} {meta.total === 1 ? "opportunity" : "opportunities"}, page {meta.page}/{Math.max(1, meta.pages || 1)}</span> : undefined}
          loading={loading}
          search={search}
          onSearch={setSearch}
          sort={sort}
          onSort={(by) => setSort((s) => ({ by, dir: s.by === by && s.dir === "desc" ? "asc" : "desc" }))}
          onPage={setPage}
          onRowClick={(r) => crmNavigate(`opportunities/${r.id}`)}
          columnFilters={colFilters}
          onColumnFilter={onColumnFilter}
          filters={
            <span className="inline-flex flex-wrap items-center gap-2">
              {Object.keys(colFilters).length > 0 && (
                <button type="button" className="text-xs font-semibold text-sky-600 hover:underline"
                  onClick={() => { setColFilters({}); setPage(1); }}>
                  Clear column filters ({Object.keys(colFilters).length})
                </button>
              )}
              {stages.length > 1 && (
                <select
                  className={`${inputCls} !w-40`}
                  value={stage}
                  aria-label="Filter by stage"
                  onChange={(e) => { setStage(e.target.value); setPage(1); }}
                >
                  <option value="">All stages</option>
                  {stages.map((s) => (
                    <option key={s} value={s}>{pipelineStageLabel(s)}</option>
                  ))}
                </select>
              )}
              {/* "All approvals" dropdown removed (18 Aug 2026): the tab IS
                  the approval filter — Pending Approval / Rejected / stages. */}
            </span>
          }
          emptyMessage={<TeachingEmpty page="opportunities" />}
          // Apply and Edit/Delete are separate rights (7 Sep 2026 fix): the
          // apply icon used to sit INSIDE the canWrite (Sales) block, so TA
          // and RMG — the roles the backend allows — never saw it on the
          // list and had to open every opportunity to apply.
          rowActions={(canWrite || canApply) ? (r) => (
            <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              {canApply && (
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-control p-1.5 text-muted transition-colors hover:bg-surface-2 hover:!text-indigo-600"
                  title="Apply a candidate to this opportunity"
                  aria-label={`Apply a candidate to ${r.title}`}
                  onClick={(e) => { e.stopPropagation(); setApplyTo(r); }}
                >
                  <UserPlus size={15} />
                </button>
              )}
              {canWrite && (
                <RowActions
                  entity="opportunity"
                  itemLabel={r.title}
                  onEdit={() => setEditId(r.id)}
                  deleteUrl={`/api/opportunities/${r.id}`}
                  onDeleted={() => afterListDelete(r.id, setRows, load)}
                  notify={showToast}
                  canEdit
                  canDelete
                  colored />
              )}
            </span>
          ) : undefined}
        />
      )}

      {applyTo && (
        <ApplyToOpportunityModal
          mode="pick-candidate"
          opportunityId={applyTo.id}
          opportunityLabel={`${applyTo.opp_id} — ${applyTo.title}`}
          onClose={() => setApplyTo(null)}
          onApplied={(msg) => { showToast(msg); load(); }}
        />
      )}

      {showCreate && (
        <NewOpportunityForm
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            showToast("Opportunity created");
            load();
          }}
        />
      )}
      {editId != null && (
        <NewOpportunityForm
          opportunityId={editId}
          onClose={() => setEditId(null)}
          onCreated={() => {
            setEditId(null);
            showToast("Opportunity updated");
            load();
          }}
        />
      )}
      {toast}
    </div>
  );
}

/* ------------------------------------------------------------------ detail page */

const cardCls = "rounded-card border border-subtle bg-surface-1 p-6 shadow-raised";

/* ------------------------------------------- suggested candidates (matching) */

type Suggestion = {
  candidate_id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  experience_years?: number | null;
  notice_period?: string | null;
  technical_domain?: string | null;
  current_ctc?: number | null;
  expected_ctc?: number | null;
  city?: string | null;
  cv_url?: string | null;
  linkedin_url?: string | null;
  score: number;
  matched_skills: string[];
  missing_mandatory_skills: string[];
  reasons: string[];
  engaged: boolean;
  applications_count: number;
  last_application?: { opportunity_title: string; pipeline_status: string } | null;
};

/** DB scan for this position: scored skills/experience/history matches with
 * the WHY spelled out per candidate, and one-click Apply. */
export function SuggestedCandidatesTab({
  oppId, canApply, onApplied, showToast,
}: {
  oppId: number;
  canApply: boolean;
  onApplied: () => void;
  showToast: (msg: string) => void;
}) {
  const [rows, setRows] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);
  /* Bulk apply (17 Aug 2026): tick candidates → one confirm → sequential
   * POSTs to the same /api/candidate-profiles the single Apply uses. Failures
   * don't abort the batch — each candidate succeeds or fails on their own. */
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDone, setBulkDone] = useState(0);
  /* Bulk-apply outcome (7 Sep 2026 fix): every failure listed with the
     duplicate's profile link, instead of "failed: <first name> (+N more)"
     and a cleared selection that hid who was left. */
  const [bulkResult, setBulkResult] = useState<{ ok: number; total: number;
    failed: { name: string; message: string; dup: DuplicateProfile | null }[] } | null>(null);
  /* Single "Apply here" duplicate — rendered inside the confirm modal. */
  const [applyDup, setApplyDup] = useState<DuplicateProfile | null>(null);
  const [applyErr, setApplyErr] = useState("");
  /* TA filters (Aug 2026): the scan can return up to 50 candidates — TA asked
   * to narrow by match %, skill/name, and quality so they don't scroll. All
   * client-side over the already-loaded rows; nothing re-fetches. */
  const [minScore, setMinScore] = useState(0);
  const [q, setQ] = useState("");
  const [hideEngaged, setHideEngaged] = useState(false);
  const [completeOnly, setCompleteOnly] = useState(false);
  const [contactableOnly, setContactableOnly] = useState(false);
  /* Hiring-interest email (Aug 2026): compose → one POST queues a personalised
   * "are you interested?" email to each recipient on the durable outbox.
   *
   * `emailTargets` is the recipient list, NOT the checkbox selection: the row
   * "Email" button mails one candidate without disturbing a bulk selection the
   * recruiter may be part-way through building. Both buttons open the same
   * composer, prefilled from the server template so the recruiter edits real
   * words instead of an empty box, and {{placeholders}} are rendered per
   * candidate server-side so an edited bulk message still greets each person by
   * name. */
  const [emailTargets, setEmailTargets] = useState<Suggestion[] | null>(null);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailPlaceholders, setEmailPlaceholders] = useState<string[]>([]);
  const [emailLoading, setEmailLoading] = useState(false);
  /* The composer body grows to fit the whole message: this is a template the
   * recruiter reads and rewrites, and judging tone through a 3-line porthole is
   * the reason the default wording never gets edited. `inputCls` carries its own
   * `min-h-[40px]`, which ties with any `min-h-[…]` utility added here on
   * specificity — so the height is set inline, where nothing can outrank it.
   * Capped at half the viewport so a long paste can't push Send off-screen. */
  const emailBodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = emailBodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    const cap = Math.max(200, Math.round(window.innerHeight * 0.5));
    // box-sizing is border-box, and scrollHeight excludes the border — without
    // adding it back the field lands ~2px short and shows a scrollbar for the
    // last line, which is the exact problem this is here to solve.
    const border = el.offsetHeight - el.clientHeight;
    const wanted = el.scrollHeight + border;
    el.style.height = `${Math.min(wanted, cap)}px`;
    el.style.overflowY = wanted > cap ? "auto" : "hidden";
  }, [emailMessage, emailTargets]);
  const emailTemplate = useRef<{
    subject: string; message: string; placeholders: string[]; sample: Record<string, string>;
  } | null>(null);

  /** Open the composer for these candidates, prefilled from the server template.
   *  The template is fetched once per mount and reused.
   *
   *  The modal opens only AFTER the template resolves. Opening first and filling
   *  in later silently overwrites anything typed in the gap — and a fetch
   *  started for candidate A could land on top of candidate B's edits. */
  const openEmail = async (targets: Suggestion[]) => {
    if (targets.length === 0) return;
    const apply = (t: { subject: string; message: string; placeholders: string[] }) => {
      setEmailSubject(t.subject);
      setEmailMessage(t.message);
      setEmailPlaceholders(t.placeholders);
      setEmailErrs({});
      setEmailTargets(targets);
    };
    if (emailTemplate.current) { apply(emailTemplate.current); return; }
    setEmailLoading(true);
    try {
      const r = await crmGet<{
        subject: string; message: string; placeholders: string[]; sample: Record<string, string>;
      }>(`/api/opportunities/${oppId}/candidate-email-template`);
      emailTemplate.current = {
        subject: r.data.subject, message: r.data.message,
        placeholders: r.data.placeholders || [], sample: r.data.sample || {},
      };
      apply(emailTemplate.current);
    } catch {
      /* Template fetch failed — open with empty fields. The server falls back to
       * its own default for a blank subject/message, so the send still works. */
      apply({ subject: "", message: "", placeholders: [] });
    } finally {
      setEmailLoading(false);
    }
  };

  const [emailErrs, setEmailErrs] = useState<{ subject?: string; message?: string }>({});

  /* Admin-created drafts (Settings → Email Drafts → Your own drafts) as
     "Use a draft" (3 Sep 2026). Their single-brace {candidate} {first_name}
     {role} {customer} {sender} become the {{double-brace}} placeholders this
     composer renders PER candidate at send time, so one draft still greets
     each recipient by name. */
  const [customDrafts, setCustomDrafts] = useState<{ key: string; label: string; description: string; subject: string; body: string }[]>([]);
  const [customDraftKey, setCustomDraftKey] = useState("");
  useEffect(() => {
    if (!emailTargets) return;
    crmGet<any[]>("/api/email-drafts/custom").then((r) => setCustomDrafts(r.data || [])).catch(() => {});
  }, [emailTargets]);
  const applyCustomDraft = (key: string) => {
    setCustomDraftKey(key);
    const d = customDrafts.find((x) => x.key === key);
    if (!d) {
      if (emailTemplate.current) { setEmailSubject(emailTemplate.current.subject); setEmailMessage(emailTemplate.current.message); }
      return;
    }
    const map: Record<string, string> = {
      candidate: "{{full_name}}", first_name: "{{first_name}}", role: "{{role}}",
      customer: "{{customer}}", sender: "{{sender}}", company: "Karnex",
    };
    const conv = (s: string) => (s || "").replace(/\{([a-z_]+)\}/gi, (m, k: string) => map[k.toLowerCase()] ?? m);
    setEmailSubject(conv(d.subject));
    setEmailMessage(conv(d.body));
    setEmailErrs({});
  };

  const sendEmails = async () => {
    const batch = (emailTargets || []).filter((r) => realEmail(r.email));
    if (batch.length === 0) return;
    /* Both fields are prefilled from the template, so empty means the sender
     * DELETED them — and a blank field used to silently substitute the server
     * default, i.e. the candidate received wording the sender never saw. */
    const errs: { subject?: string; message?: string } = {};
    if (!emailSubject.trim()) errs.subject = "A subject is required — candidates see this line first";
    if (!emailMessage.trim()) errs.message = "Write the message to send (placeholders are filled in per candidate)";
    setEmailErrs(errs);
    if (errs.subject || errs.message) return;
    const ids = batch.map((r) => r.candidate_id);
    setEmailBusy(true);
    try {
      const res = await crmPost<{ sent: number; skipped: any[]; failed: any[] }>(
        `/api/opportunities/${oppId}/email-candidates`,
        {
          candidate_ids: ids,
          subject: emailSubject.trim(),
          message: emailMessage.trim(),
        },
      );
      showToast(res.message || `Queued ${res.data?.sent ?? 0} email(s)`);
      setEmailTargets(null);
      /* Untick who was just mailed. Leaving them checked with no visual change
       * invites a second click that double-mails real candidates. Only the rows
       * that went out are cleared, so a partial batch keeps the rest selected. */
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    } catch (e: any) {
      showToast(e?.message || "Failed to send emails");
    } finally {
      setEmailBusy(false);
    }
  };

  const load = useCallback(() => {
    setRows(null);
    setError("");
    setSelected(new Set());
    crmGet<Suggestion[]>(`/api/opportunities/${oppId}/suggested-candidates`)
      .then((r) => setRows(r.data || []))
      .catch((e: any) => setError(e?.message || "Failed to scan for candidates"));
  }, [oppId]);
  useEffect(() => { load(); }, [load]);

  const toggleOne = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const applySelected = async () => {
    if (!rows) return;
    const batch = rows.filter((r) => selected.has(r.candidate_id));
    setBusy(true);
    setBulkDone(0);
    let ok = 0;
    const failed: { name: string; message: string; dup: DuplicateProfile | null }[] = [];
    const applied = new Set<number>();
    for (const r of batch) {
      try {
        await crmPost("/api/candidate-profiles", {
          candidate_id: r.candidate_id, opportunity_id: oppId,
        });
        ok++;
        applied.add(r.candidate_id);
      } catch (e: any) {
        const dup = duplicateProfileFromError(e);
        failed.push({ name: r.name, message: dup ? duplicateProfileSummary(dup) : (e?.message || "failed"), dup });
      }
      setBulkDone((d) => d + 1);
    }
    setBusy(false);
    setBulkOpen(false);
    // Keep the ones that failed selected so they can be retried or reviewed.
    setSelected((prev) => new Set([...prev].filter((id) => !applied.has(id))));
    if (failed.length) setBulkResult({ ok, total: batch.length, failed });
    else showToast(`Applied ${ok} candidate(s) to this opportunity`);
    load();
    onApplied();
  };

  const scoreTone = (s: number) =>
    s >= 70 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : s >= 40 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
      : "bg-surface-2 text-secondary";

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (rows === null) return <Spinner label="Scanning the candidate database…" />;
  if (rows.length === 0) {
    return (
      <EmptyState message="No matching candidates in the database yet — matches appear once candidates share this opportunity's skills, experience band, or customer history." />
    );
  }

  // Apply the TA filters over the loaded rows (rows is already sorted by score).
  const visible = rows.filter((r) => {
    if (r.score < minScore) return false;
    if (hideEngaged && r.engaged) return false;
    if (completeOnly && r.missing_mandatory_skills.length > 0) return false;
    if (contactableOnly && !(r.phone || realEmail(r.email))) return false;
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      const hay = [r.name, r.technical_domain, r.city, ...r.matched_skills]
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(t)) return false;
    }
    return true;
  });
  const visIds = visible.map((r) => r.candidate_id);
  const allVisSelected = visible.length > 0 && visIds.every((id) => selected.has(id));
  const selectedVisible = visIds.filter((id) => selected.has(id)).length;
  const filtersActive =
    minScore > 0 || q.trim() !== "" || hideEngaged || completeOnly || contactableOnly;
  const clearFilters = () => {
    setMinScore(0); setQ(""); setHideEngaged(false);
    setCompleteOnly(false); setContactableOnly(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Scored against this opportunity&rsquo;s skills, experience band and each
        candidate&rsquo;s pipeline history — candidates already applied here are excluded.
        Contact them directly or apply them into this pipeline.
      </p>

      {/* -------- TA filter bar -------- */}
      <div className="space-y-2 rounded-card border border-subtle bg-surface-2 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-secondary">Min match</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={minScore || ""}
              placeholder="0"
              onChange={(e) =>
                setMinScore(Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))))}
              className={`${inputCls} h-8 w-20 text-sm`}
              aria-label="Minimum match percentage"
            />
            <span className="text-xs text-secondary">%</span>
            {[40, 50, 70].map((s) => (
              <button
                key={s}
                onClick={() => setMinScore(s)}
                className="rounded-full border border-subtle bg-surface-1 px-2 py-0.5 text-[11px] font-semibold text-secondary hover:bg-surface-3"
                title={`Set minimum to ${s}%`}
              >
                {s}%+
              </button>
            ))}
          </div>
          <input
            className={`${inputCls} h-8 max-w-[220px] flex-1 text-sm`}
            placeholder="Search name, skill, domain…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-secondary">
            <input type="checkbox" className="h-3.5 w-3.5 cursor-pointer"
              style={{ accentColor: "var(--brand-600)" }}
              checked={completeOnly} onChange={() => setCompleteOnly((v) => !v)} />
            All mandatory skills
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-secondary">
            <input type="checkbox" className="h-3.5 w-3.5 cursor-pointer"
              style={{ accentColor: "var(--brand-600)" }}
              checked={hideEngaged} onChange={() => setHideEngaged((v) => !v)} />
            Hide engaged elsewhere
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-secondary">
            <input type="checkbox" className="h-3.5 w-3.5 cursor-pointer"
              style={{ accentColor: "var(--brand-600)" }}
              checked={contactableOnly} onChange={() => setContactableOnly((v) => !v)} />
            Contactable (email/phone)
          </label>
          <span className="ml-auto text-xs text-muted">
            Showing <b className="text-secondary">{visible.length}</b> of {rows.length}
          </span>
          {filtersActive && (
            <button onClick={clearFilters}
              className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
              Clear filters
            </button>
          )}
        </div>
      </div>

      {canApply && visible.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-subtle bg-surface-2 px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-secondary">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer"
              style={{ accentColor: "var(--brand-600)" }}
              checked={allVisSelected}
              onChange={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (allVisSelected) visIds.forEach((id) => next.delete(id));
                  else visIds.forEach((id) => next.add(id));
                  return next;
                })}
            />
            Select all ({selectedVisible}/{visible.length})
          </label>
          <div className="flex items-center gap-2">
            <button
              className={btnSecondary}
              disabled={selected.size === 0 || emailLoading}
              onClick={() => void openEmail(rows ? rows.filter((r) => selected.has(r.candidate_id)) : [])}
              title="Email the selected candidates about this role"
            >
              <Mail size={14} /> {emailLoading ? "Opening…" : `Email selected (${selected.size})`}
            </button>
            <button
              className={btnPrimary}
              disabled={selected.size === 0}
              onClick={() => setBulkOpen(true)}
            >
              <UserPlus size={14} /> Apply selected ({selected.size})
            </button>
          </div>
        </div>
      )}

      {visible.length === 0 && (
        <div className="rounded-card border border-subtle bg-surface-1 px-4 py-6 text-center text-sm text-muted">
          No candidates match these filters.{" "}
          <button onClick={clearFilters}
            className="font-semibold text-brand-600 hover:underline dark:text-brand-300">
            Clear filters
          </button>
        </div>
      )}

      {visible.map((r) => (
        <div key={r.candidate_id}
          className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {canApply && (
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer"
                    style={{ accentColor: "var(--brand-600)" }}
                    checked={selected.has(r.candidate_id)}
                    onChange={() => toggleOne(r.candidate_id)}
                    aria-label={`Select ${r.name} for bulk apply`}
                  />
                )}
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${scoreTone(r.score)}`}>
                  {Math.round(r.score)}% match
                </span>
                <CrmLink to={`candidates/${r.candidate_id}`}
                  className="text-sm font-bold text-brand-600 hover:underline dark:text-brand-300">
                  {r.name}
                </CrmLink>
                {r.technical_domain && (
                  <span className="text-xs text-muted">{r.technical_domain}</span>
                )}
                {r.engaged && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                    title="Currently Joined/Preboarding on another opportunity">
                    Engaged elsewhere
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-secondary">
                {r.experience_years != null && <span>{r.experience_years} yrs</span>}
                {r.city && <span>{r.city}</span>}
                {r.notice_period && <span>Notice: {r.notice_period}</span>}
                {r.current_ctc != null && <span>CTC ₹{Number(r.current_ctc).toLocaleString("en-IN")}</span>}
                {r.expected_ctc != null && <span>Expects ₹{Number(r.expected_ctc).toLocaleString("en-IN")}</span>}
                <span>{displayEmail(r.email)}</span>
                {r.phone && <span>{r.phone}</span>}
              </div>
              {r.matched_skills.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.matched_skills.map((s) => (
                    <span key={s} className="rounded-full bg-brand-600/10 px-2 py-0.5 text-[11px] font-semibold text-brand-600 dark:text-brand-300">
                      {s}
                    </span>
                  ))}
                  {r.missing_mandatory_skills.map((s) => (
                    <span key={s} className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                      title="Mandatory skill this candidate is missing">
                      missing: {s}
                    </span>
                  ))}
                </div>
              )}
              <ul className="mt-2 space-y-0.5 text-xs text-muted">
                {r.reasons.map((reason, i) => <li key={i}>· {reason}</li>)}
                {r.last_application && (
                  <li>
                    · Last application: {r.last_application.opportunity_title}{" "}
                    (<span className="font-semibold">
                      {r.last_application.pipeline_status.replace(/_/g, " ")}
                    </span>)
                  </li>
                )}
              </ul>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              {canApply && (
                <button className={btnPrimary} onClick={() => setApplying(r)}>
                  <UserPlus size={14} /> Apply here
                </button>
              )}
              <div className="flex gap-1.5">
                {/* Opens the same composer as "Email selected", scoped to this
                    one candidate. It used to be a mailto: link, which handed the
                    recruiter off to whatever (if anything) the OS had registered
                    — and left no outbox record of what was sent. */}
                {realEmail(r.email) && (
                  <button className={`${btnSecondary} !px-2.5 !py-1 text-xs`}
                    onClick={() => void openEmail([r])}
                    title={`Email ${r.name} about this role`}>
                    Email
                  </button>
                )}
                {r.cv_url && <FileLink url={r.cv_url} label="Resume" />}
                {r.linkedin_url && (
                  <a className={`${btnSecondary} !px-2.5 !py-1 text-xs`} target="_blank"
                    rel="noreferrer" href={r.linkedin_url}>
                    LinkedIn
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}

      {bulkOpen && (() => {
        const batch = rows.filter((r) => selected.has(r.candidate_id));
        const missing = batch.filter((r) => r.missing_mandatory_skills.length > 0);
        const engaged = batch.filter((r) => r.engaged);
        return (
          <Modal title={`Apply ${batch.length} candidate(s)?`}
            onClose={() => { if (!busy) setBulkOpen(false); }}>
            <p className="text-sm text-secondary">
              Create a candidate profile on this opportunity (pipeline starts at
              Sourcing) for each of:
            </p>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm text-primary">
              {batch.map((r) => (
                <li key={r.candidate_id} className="flex flex-wrap items-center gap-2">
                  <b>{r.name}</b>
                  <span className="text-xs text-muted">{Math.round(r.score)}% match</span>
                  {r.missing_mandatory_skills.length > 0 && (
                    <span className="text-xs text-danger">
                      missing: {r.missing_mandatory_skills.join(", ")}
                    </span>
                  )}
                  {r.engaged && <span className="text-xs text-danger">engaged elsewhere</span>}
                </li>
              ))}
            </ul>
            {(missing.length > 0 || engaged.length > 0) && (
              <p className="mt-2 text-xs text-danger">
                {missing.length > 0 && `${missing.length} missing mandatory skill(s). `}
                {engaged.length > 0 && `${engaged.length} currently Joined/Preboarding elsewhere.`}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button className={btnSecondary} disabled={busy} onClick={() => setBulkOpen(false)}>
                Cancel
              </button>
              <button className={btnPrimary} disabled={busy} onClick={applySelected}>
                {busy ? `Applying… ${bulkDone}/${batch.length}` : `Apply all ${batch.length}`}
              </button>
            </div>
          </Modal>
        );
      })()}

      {bulkResult && (
        <Modal title={`Applied ${bulkResult.ok} of ${bulkResult.total}`} onClose={() => setBulkResult(null)}>
          <p className="text-sm text-secondary">
            {bulkResult.failed.length} could not be applied. They stay selected so you can review or retry.
          </p>
          <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
            {bulkResult.failed.map((f) => (
              <li key={f.name}>
                {f.dup ? (
                  <DuplicateProfileNotice dup={{ ...f.dup, candidate_name: f.dup.candidate_name || f.name }} compact />
                ) : (
                  <div className="rounded-card border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
                    <b>{f.name}</b>: {f.message}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end">
            <button className={btnPrimary} onClick={() => setBulkResult(null)}>Close</button>
          </div>
        </Modal>
      )}

      {emailTargets && (() => {
        const batch = emailTargets;
        const withEmail = batch.filter((r) => realEmail(r.email));
        const noEmail = batch.length - withEmail.length;
        const one = batch.length === 1 ? batch[0] : null;
        const close = () => { if (!emailBusy) setEmailTargets(null); };
        /* Live preview against the first real recipient, so the recruiter can
         * see what a {{placeholder}} actually becomes before sending.
         *
         * This mirrors the server's renderer exactly — one pass, every token,
         * case- and space-insensitive, unknown tokens left intact. Previewing a
         * SUBSET of what the server substitutes is worse than no preview: the
         * recruiter "fixes" a token that was working fine. The server stays
         * authoritative; this only has to agree with it. */
        const previewFor = withEmail[0];
        const previewName = (previewFor?.name || "").trim();
        const sample = emailTemplate.current?.sample || {};
        const previewCtx: Record<string, string> = {
          first_name: previewName.split(" ")[0] || "there",
          full_name: previewName || "there",
          role: sample.role || "",
          customer: sample.customer || "",
          sender: sample.sender || "",
        };
        const render = (t: string) =>
          (t || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) => {
            const v = previewCtx[String(key).toLowerCase()];
            return v === undefined ? whole : v;
          });
        return (
          <Modal
            medium
            title={one ? `Email ${one.name}` : `Email ${batch.length} candidates`}
            onClose={close}
            dirty={emailSubject !== (emailTemplate.current?.subject ?? "")
              || emailMessage !== (emailTemplate.current?.message ?? "")}
          >
            <p className="text-sm text-secondary">
              Send a hiring-interest email — &ldquo;we&rsquo;re hiring for this role, are you
              interested?&rdquo; — {one ? <>to <b>{one.name}</b> ({realEmail(one.email)})</> : `to ${withEmail.length} candidate(s)`}.
              Edit the wording below; it goes out through the Email Outbox, so there is a record
              of every send.
            </p>
            {/* Name every recipient. Selections survive a filter change, so the
                list on screen is not necessarily the list being mailed — and a
                bare count gives the sender no way to notice. */}
            {!one && withEmail.length > 0 && (
              <details className="mt-2 rounded-card border border-subtle bg-surface-1 px-3 py-2" open={withEmail.length <= 8}>
                <summary className="cursor-pointer text-xs font-semibold text-secondary">
                  Recipients ({withEmail.length})
                </summary>
                <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto text-xs text-secondary">
                  {withEmail.map((r) => (
                    <li key={r.candidate_id}>
                      <b className="text-primary">{r.name}</b> — {realEmail(r.email)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="mt-3 space-y-3">
              {customDrafts.length > 0 && (
                <div>
                  <label htmlFor="cand-email-draft" className="mb-1 block text-xs font-semibold text-secondary">
                    Use a draft
                  </label>
                  <select id="cand-email-draft" className={inputCls} value={customDraftKey}
                    onChange={(e) => applyCustomDraft(e.target.value)}>
                    <option value="">— Built-in “we're hiring” wording —</option>
                    {customDrafts.map((d) => (
                      <option key={d.key} value={d.key}>{d.label}{d.description ? ` — ${d.description}` : ""}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="cand-email-subject" className="mb-1 block text-xs font-semibold text-secondary">
                  Subject <span className="text-danger">*</span>
                </label>
                <input id="cand-email-subject" className={`${inputCls}${emailErrs.subject ? " input-error" : ""}`} value={emailSubject}
                  onChange={(e) => { setEmailSubject(e.target.value); setEmailErrs((p) => ({ ...p, subject: undefined })); }}
                  placeholder="Exciting opportunity: {{role}}" />
                {emailErrs.subject && <p className="mt-1 text-xs text-danger">{emailErrs.subject}</p>}
              </div>
              <div>
                <label htmlFor="cand-email-body" className="mb-1 block text-xs font-semibold text-secondary">
                  Message <span className="text-danger">*</span>
                </label>
                <textarea
                  id="cand-email-body"
                  ref={emailBodyRef}
                  className={`${inputCls} resize-none font-mono !text-[13px] leading-relaxed${emailErrs.message ? " input-error" : ""}`}
                  style={{ minHeight: 0 }}
                  value={emailMessage}
                  onChange={(e) => { setEmailMessage(e.target.value); setEmailErrs((p) => ({ ...p, message: undefined })); }}
                />
                {emailErrs.message && <p className="mt-1 text-xs text-danger">{emailErrs.message}</p>}
                <p className="mt-1.5 text-xs text-muted">
                  Filled in per candidate, so one message still greets everyone by name — click to
                  insert at the cursor:{" "}
                  {(emailPlaceholders.length
                    ? emailPlaceholders
                    : ["first_name", "full_name", "role", "customer", "sender"]
                  ).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className="mr-1 rounded-full bg-brand-600/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-brand-600 hover:bg-brand-600/20 dark:text-brand-300"
                      title={`Insert {{${p}}} at the cursor`}
                      /* Insert where the caret is, not at the end. Appending to a
                         finished template drops the token after the signature,
                         which reads as the control being broken. */
                      onClick={() => {
                        const el = emailBodyRef.current;
                        const token = `{{${p}}}`;
                        if (!el) { setEmailMessage((m) => m + token); return; }
                        const s = el.selectionStart ?? el.value.length;
                        const e = el.selectionEnd ?? s;
                        setEmailMessage(el.value.slice(0, s) + token + el.value.slice(e));
                        requestAnimationFrame(() => {
                          el.focus();
                          el.setSelectionRange(s + token.length, s + token.length);
                        });
                      }}
                    >
                      {`{{${p}}}`}
                    </button>
                  ))}{" "}
                  An unknown one is left in the text as-is rather than blanking the email.
                </p>
              </div>
              {previewFor && (
                <details className="rounded-card border border-subtle bg-surface-1 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-semibold text-secondary">
                    Preview as {previewName || "the first recipient"}
                  </summary>
                  <div className="mt-2 text-xs text-primary">
                    <div className="font-semibold">{render(emailSubject) || <span className="text-muted">(default subject)</span>}</div>
                    <pre className="mt-1.5 whitespace-pre-wrap font-sans text-xs text-secondary">
                      {render(emailMessage) || "(default message)"}
                    </pre>
                  </div>
                </details>
              )}
            </div>
            {noEmail > 0 && (
              <p className="mt-2 text-xs text-danger">
                {noEmail} selected candidate(s) have no email on file and will be skipped.
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button className={btnSecondary} disabled={emailBusy}
                onClick={close}>Cancel</button>
              <button className={btnPrimary} disabled={emailBusy || withEmail.length === 0}
                onClick={sendEmails}>
                {emailBusy ? "Sending…" : one ? "Send email" : `Send to ${withEmail.length}`}
              </button>
            </div>
          </Modal>
        );
      })()}

      {applying && (
        <Modal title={`Apply ${applying.name}?`} onClose={() => setApplying(null)}>
          <p className="text-sm text-secondary">
            Create a candidate profile for <b>{applying.name}</b> on this opportunity
            (pipeline starts at Sourcing)?
            {applying.missing_mandatory_skills.length > 0 && (
              <span className="mt-2 block text-danger">
                Note: missing mandatory skill(s) — {applying.missing_mandatory_skills.join(", ")}.
              </span>
            )}
            {applying.engaged && (
              <span className="mt-2 block text-danger">
                This candidate is currently Joined/Preboarding on another opportunity.
              </span>
            )}
          </p>
          {applyErr && <div className="mt-3"><ErrorBox error={applyErr} /></div>}
          {applyDup && <div className="mt-3"><DuplicateProfileNotice dup={applyDup} /></div>}
          <div className="mt-4 flex justify-end gap-2">
            <button className={btnSecondary} onClick={() => { setApplying(null); setApplyDup(null); setApplyErr(""); }}>Cancel</button>
            <button className={btnPrimary} disabled={busy || !!applyDup}
              onClick={async () => {
                setBusy(true);
                setApplyDup(null);
                setApplyErr("");
                try {
                  await crmPost("/api/candidate-profiles", {
                    candidate_id: applying.candidate_id, opportunity_id: oppId,
                  });
                  showToast(`${applying.name} applied to this opportunity`);
                  setApplying(null);
                  load();
                  onApplied();
                } catch (e: any) {
                  // Structured 409 (7 Sep 2026 fix): show who applied + the
                  // profile link inside the modal, not a vanishing toast.
                  const dup = duplicateProfileFromError(e);
                  if (dup) setApplyDup(dup);
                  else setApplyErr(e?.message || "Apply failed");
                } finally {
                  setBusy(false);
                }
              }}>
              {busy ? "Applying…" : "Apply"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------- applicant stage filter chips */

/** Requested stage buckets (14 Aug 2026) — each maps to the pipeline
 * statuses it covers; the API takes a comma-separated pipeline_status list,
 * so filtering stays server-paged. */
const APPLICANT_STAGE_FILTERS: { key: string; label: string; statuses: string[] }[] = [
  { key: "all", label: "All", statuses: [] },
  { key: "sourcing", label: "Sourcing", statuses: ["Sourcing"] },
  { key: "tech", label: "Technical Interviewing", statuses: ["Technical_Screening"] },
  { key: "rmg", label: "RMG Screening", statuses: ["RMG_Review"] },
  { key: "cust_screen", label: "Customer Screening", statuses: ["Customer_Screening"] },
  { key: "sales_screen", label: "Sales Screening", statuses: ["Sales_Screening"] },
  { key: "cust_interview", label: "Customer Interviewing",
    statuses: ["Customer_Interview", "L1_Feedback", "L2_Feedback"] },
  { key: "onboarding", label: "Onboarding", statuses: ["HR_Screening", "HR_Interviewing", "Preboarding", "Joined"] },
];

/* ------------------------------------------------------- collapsible card */

/** Detail blocks collapse by default (14 Aug 2026): the page had grown into
 * a wall of every field ever filled — now each block is a headline you
 * expand when you actually need its contents. */
export function CollapsibleCard({
  title, children, defaultOpen = false,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cardCls}>
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <h2 className="text-base font-bold text-primary">{title}</h2>
        <ChevronDown
          size={16}
          className={`shrink-0 text-muted transition-transform duration-base ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="mt-4 border-t border-subtle pt-4">{children}</div>}
    </div>
  );
}

/* ---------------------------------------------- read-only creation details */

/** Everything the wizard captured, rendered straight from OPPORTUNITY_SCHEMA —
 * one source of truth, so a field added to the form automatically shows here.
 * Values come from the top-level record or the type-specific `details` body;
 * id fields display their resolved names. */
/** Fields the page HEADER summary already shows (customer, branch, contacts,
 * type, RFI value/date, onboarding status…). The schema cards below skip
 * these so no fact renders twice — a section left with zero fields (e.g.
 * RFI Details) disappears entirely. */
const HEADER_SHOWN_KEYS = new Set([
  "opp_id", "title", "customer_id", "branch_id", "contact_person_id",
  "hiring_manager_id", "opp_type", "rfi_value", "rfi_received_date",
  "onboarding_status",
]);

function OpportunityAllDetails({ opp }: { opp: Opportunity }) {
  const type = (opp.opp_type || "") as OpportunityType | "";
  const details = (opp.details || {}) as Record<string, unknown>;
  const nameByKey: Record<string, React.ReactNode> = {
    customer_id: opp.customer_name,
    branch_id: opp.branch_name,
    contact_person_id: opp.contact_person_name,
    hiring_manager_id: opp.hiring_manager_name,
  };
  const MONEY_HINT = /(ctc|value|budget|revenue|rate|amount|cost|salary)/i;

  const renderValue = (field: FieldDef): React.ReactNode => {
    if (field.key in nameByKey) return nameByKey[field.key] ?? "—";
    const raw = (opp as Record<string, unknown>)[field.key] ?? details[field.key];
    if (raw === null || raw === undefined || raw === "") return "—";
    if (typeof raw === "boolean") return raw ? "Yes" : "No";
    if (Array.isArray(raw)) return raw.map(String).join(", ") || "—";
    if (field.type === "date" || /_date$/.test(field.key)) return fmtDate(String(raw));
    const opt = field.options?.find((o) => String(o.value) === String(raw));
    if (opt) return opt.label;
    if (typeof raw === "number" && MONEY_HINT.test(field.key)) return `₹${fmtMoney(raw)}`;
    if (typeof raw === "object") return "—";
    return String(raw).replace(/_/g, " ");
  };

  const sections = OPPORTUNITY_SCHEMA.filter(
    (s: SectionDef) => s.kind !== "table" && s.kind !== "attachments"
      && s.kind !== "activityLog" && (s.fields?.length || 0) > 0
      && sectionVisible(s, type),
  );

  const slab = (opp.ctc_slab || []) as Record<string, unknown>[];

  return (
    <>
      {sections.map((s: SectionDef) => {
        const fields = (s.fields || []).filter(
          (f: FieldDef) => fieldVisible(s, f, type) && !HEADER_SHOWN_KEYS.has(f.key),
        );
        if (fields.length === 0) return null;
        // With customer/branch/person now header-only, this card holds just
        // the contact coordinates — title it for what it actually shows.
        const cardTitle = s.key === "customerDetails" ? "Contact Details" : s.title;
        return (
          <CollapsibleCard key={s.key} title={cardTitle}>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map((f: FieldDef) => (
                <div key={f.key}>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{f.label}</dt>
                  <dd className="mt-1 text-sm text-primary">{renderValue(f)}</dd>
                </div>
              ))}
            </dl>
          </CollapsibleCard>
        );
      })}
      {slab.length > 0 && (
        <CollapsibleCard title="Candidate CTC Slab">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  {Object.keys(slab[0]).filter((k) => k !== "id" && k !== "position").map((k) => (
                    <th key={k} className="px-2 py-1.5">{k.replace(/_/g, " ")}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slab.map((row, i) => (
                  <tr key={i} className="border-t border-subtle">
                    {Object.entries(row).filter(([k]) => k !== "id" && k !== "position").map(([k, v]) => (
                      <td key={k} className="px-2 py-1.5 text-primary">
                        {v === null || v === undefined || v === "" ? "—"
                          : typeof v === "number" && MONEY_HINT.test(k) ? `₹${fmtMoney(v)}`
                          : String(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleCard>
      )}
    </>
  );
}

export function OpportunityDetailPage() {
  const params = useCrmParams();
  const id = params.id;
  /* Both hooks must run unconditionally (rules-of-hooks) — combine after. */
  const canWriteRole = useHasRole("Sales", "Sales_Head");
  const canWrite = useCanAct("opportunities", "edit", canWriteRole);
  /* Sub-tab access (25 Aug 2026): templates hide detail tabs. */
  const oppAcc = useCrmAccess("opportunities");
  const canArchive = useHasRole("Sales_Head");
  const canApprove = useHasRole("Sales_Head"); // Sales Head (or Admin) signs off
  const canApplyHere = useHasRole("TA", "Sales", "RMG");
  const [applyHere, setApplyHere] = useState(false);
  // Skill Evaluation Details are owned by RMG (and Admin/CEO) — Sales & Sales Head
  // can view but not add/edit. RMG fills these in during approval review.
  const canEditSkills = useHasRole("RMG", "Admin", "CEO");

  const [opp, setOpp] = useState<Opportunity | null>(null);
  const [log, setLog] = useState<ActivityEntry[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [profileMeta, setProfileMeta] = useState<Meta | undefined>(undefined);
  const [profilePage, setProfilePage] = useState(1);
  const [profileSearch, setProfileSearch] = useState("");
  const [profileStage, setProfileStage] = useState("all");
  const [linkedTemplate, setLinkedTemplate] = useState<{
    template_name?: string | null;
    template_job_id?: string | null;
    tr_number?: string;
    status?: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [showSkills, setShowSkills] = useState(false);
  const [showStage, setShowStage] = useState(false);
  /* The outcome button that was clicked; null = no confirm open. */
  const [outcomeStage, setOutcomeStage] = useState<string | null>(null);
  const [outcomeComment, setOutcomeComment] = useState("");
  const [outcomeBusy, setOutcomeBusy] = useState(false);
  const [outcomeErr, setOutcomeErr] = useState("");
  const [showReject, setShowReject] = useState(false);
  // Sales Head opens the full wizard to review (and optionally correct)
  // before signing off — approval happens on save inside the wizard.
  const [reviewing, setReviewing] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [toast, showToast] = useToast();
  const [tab, setTab] = useState("details");

  const loadLog = useCallback(() => {
    crmGet<ActivityEntry[]>(`/api/opportunities/${id}/activity-log`)
      .then((r) => setLog(r.data || []))
      .catch(() => {});
  }, [id]);

  // Attachments — above all the Customer JD (18 Aug 2026): Sales uploads it,
  // and Sales Head must SEE it before approving. Shown in the details tab and
  // called out inside the pending-approval banner.
  const [attachments, setAttachments] = useState<any[]>([]);
  useEffect(() => {
    let alive = true;
    crmGet<any[]>(`/api/opportunities/${id}/attachments`)
      .then((r) => { if (alive) setAttachments(r.data || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [id]);
  const jdFiles = attachments.filter((a) => a.kind === "customer_jd");

  // Server-paged: a busy opportunity can carry hundreds of applicants, so never
  // fetch "the first 100 and hope" — page + search against the API instead.
  const loadProfiles = useCallback(async () => {
    try {
      const bucket = APPLICANT_STAGE_FILTERS.find((b) => b.key === profileStage);
      const res = await crmGet<ProfileRow[]>(
        `/api/candidate-profiles${qs({
          opportunity_id: id,
          page: profilePage,
          limit: 20,
          search: profileSearch || undefined,
          pipeline_status: bucket && bucket.statuses.length
            ? bucket.statuses.join(",")
            : undefined,
        })}`,
      );
      setProfiles(res.data || []);
      setProfileMeta(res.meta);
    } catch {
      /* linked profiles are non-fatal */
    }
  }, [id, profilePage, profileSearch, profileStage]);

  const loadLinkedTemplate = useCallback(async () => {
    try {
      const res = await crmGet<any[]>(`/api/template-requests${qs({ opportunity_id: id, limit: 20 })}`);
      const ready = (res.data || []).find(
        (t) =>
          (t.status === "Template_Ready" || t.status === "Prepared") &&
          t.template_job_id,
      );
      setLinkedTemplate(ready || null);
    } catch {
      setLinkedTemplate(null);
    }
  }, [id]);

  useEffect(() => {
    setOpp(null);
    setError("");
    crmGet<Opportunity>(`/api/opportunities/${id}`)
      .then((r) => setOpp(r.data))
      .catch((e: any) => setError(e?.message || "Failed to load opportunity"));
    loadLog();
    loadProfiles();
    loadLinkedTemplate();
  }, [id, loadLog, loadProfiles, loadLinkedTemplate]);

  const reloadOpp = useCallback(() => {
    crmGet<Opportunity>(`/api/opportunities/${id}`)
      .then((r) => setOpp(r.data))
      .catch(() => {});
    loadLog();
  }, [id, loadLog]);

  const doApprove = async () => {
    setApprovalBusy(true);
    try {
      await crmPost(`/api/opportunities/${id}/approve`);
      showToast("Opportunity approved");
      reloadOpp();
    } catch (e: any) {
      showToast(e?.message || "Approve failed");
    } finally {
      setApprovalBusy(false);
    }
  };

  const doReject = async () => {
    if (rejectReason.trim().length < 10) {
      showToast("Rejection reason must be at least 10 characters");
      return;
    }
    setApprovalBusy(true);
    try {
      await crmPost(`/api/opportunities/${id}/reject`, { reason: rejectReason.trim() });
      showToast("Opportunity rejected");
      setShowReject(false);
      setRejectReason("");
      reloadOpp();
    } catch (e: any) {
      showToast(e?.message || "Reject failed");
    } finally {
      setApprovalBusy(false);
    }
  };

  const doResubmit = async () => {
    setApprovalBusy(true);
    try {
      await crmPost(`/api/opportunities/${id}/resubmit`);
      showToast("Resubmitted for Sales Head approval");
      reloadOpp();
    } catch (e: any) {
      showToast(e?.message || "Resubmit failed");
    } finally {
      setApprovalBusy(false);
    }
  };

  if (error) return <ErrorBox error={error} onRetry={() => window.location.reload()} />;
  if (!opp) return <Spinner label="Loading opportunity…" />;

  const skills = opp.skills || [];
  const allowedStages = (opp.allowed_next_stages || []).filter((s) => s !== "Archived" || canArchive);

  const fmtCtc = (v?: number | null) =>
    v === null || v === undefined ? "—" : `₹${Number(v).toLocaleString("en-IN")}`;
  const fmtHike = (v?: number | null) =>
    v === null || v === undefined ? "—" : `${Number(v).toFixed(1)}%`;
  const displayCtc = (profile: ProfileRow, kind: "current" | "expected") => {
    if (kind === "current") return profile.current_ctc ?? profile.candidate_current_ctc ?? null;
    return profile.expected_ctc ?? profile.candidate_expected_ctc ?? null;
  };

  const info: [string, React.ReactNode][] = [
    ["Customer", opp.customer_name || "—"],
    ["Branch", opp.branch_name || "—"],
    ["Contact person", opp.contact_person_name || "—"],
    ["Hiring manager", opp.hiring_manager_name || "—"],
    ["Type", String(opp.opp_type || "—").replace(/_/g, " ")],
    ["RFI value", fmtMoney(opp.rfi_value)],
    ["RFI received", fmtDate(opp.rfi_received_date)],
    ["Onboarding status", opp.onboarding_status || "—"],
    ["Created", fmtDate(opp.created_at)],
    ["Updated", fmtDate(opp.updated_at)],
  ];

  const applicantCols: Column<ProfileRow>[] = [
    {
      key: "candidate_name",
      label: "Candidate",
      render: (r) => (
        <span className="font-semibold text-primary">
          {r.candidate_name || `Candidate #${r.candidate_id}`}
        </span>
      ),
    },
    { key: "email", label: "Email", render: (r) => r.email || "—" },
    { key: "phone", label: "Phone", render: (r) => r.phone || "—" },
    {
      key: "experience_years",
      label: "Experience (yrs)",
      align: "right",
      render: (r) => (r.experience_years != null ? String(r.experience_years) : "—"),
    },
    {
      key: "current_ctc",
      label: "Current CTC",
      align: "right",
      render: (r) => fmtCtc(displayCtc(r, "current")),
    },
    {
      key: "expected_ctc",
      label: "Expected CTC",
      align: "right",
      render: (r) => fmtCtc(displayCtc(r, "expected")),
    },
    {
      key: "hike_percent",
      label: "Hike %",
      align: "right",
      render: (r) => fmtHike(r.hike_percent),
    },
    { key: "notice_period", label: "Notice period", render: (r) => r.notice_period || "—" },
    { key: "technical_domain", label: "Technical domain", render: (r) => r.technical_domain || "—" },
    {
      key: "pipeline_status",
      label: "Pipeline status",
      render: (r) => <StatusBadge status={r.pipeline_status} label={selfWithdrewLabel(r.pipeline_status, (r as any).withdrawn_from_status)} />,
    },
    // The applicants table had no AI interview column at all, so an opportunity
    // gave no sign of how its candidates had done in their L1.
    { key: "ai_interview", label: "AI Interview", render: (r) => <AiInterviewCell row={r} /> },
    {
      key: "created_at",
      label: "Applied on",
      align: "right",
      render: (r) => fmtDate(r.created_at),
    },
    {
      key: "cv_url",
      label: "Resume",
      render: (r) => (r.cv_url ? <FileLink url={r.cv_url} label="Resume" /> : "—"),
    },
  ];

  return (
    <div className="space-y-6">
      <button
        className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
        onClick={() => crmNavigate("opportunities")}
      >
        ← Back to opportunities
      </button>

      <div className="glass fx-gradient-border rounded-card p-6 shadow-raised">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">{opp.opp_id}</div>
            <h1 className="text-display mt-1 flex flex-wrap items-center gap-3 text-xl font-bold text-primary">
              {opp.title} <StatusBadge status={opp.pipeline_stage} label={pipelineStageLabel(opp.pipeline_stage)} />
              {opp.approval_status && opp.approval_status !== "Approved" && <StatusBadge status={opp.approval_status} />}
            </h1>
          </div>
          {/* Outcome buttons (8 Sep 2026, user request): Sales / Sales Head
              set the deal's status right here — Close Won / Close Lost /
              Customer Hold / Close Partial / Sales Hold — and the list tabs
              follow. Only the moves the server allows from the current stage
              are offered; a hold or close can be undone with Reactivate. */}
          {canWrite && opp.approval_status === "Approved" && (
            <OutcomeButtons
              current={opp.pipeline_stage}
              allowed={allowedStages}
              busy={!!outcomeStage}
              onPick={(stage) => { setOutcomeComment(""); setOutcomeStage(stage); }}
            />
          )}
        </div>

        {opp.approval_status === "Pending_Sales_Head_Approval" && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-card bg-warning-soft px-4 py-3">
            <span className="text-sm font-semibold text-warning">
              Pending Sales Head approval{canApprove ? "" : " — awaiting review"}
            </span>
            {/* The JD Sales uploaded, right where the decision is made. */}
            {jdFiles.length > 0 && (
              <span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-secondary">
                Customer JD:
                {jdFiles.map((a) => (
                  <FileLink key={a.id} url={a.file_url} label={a.file_name || "JD file"} />
                ))}
              </span>
            )}
            {canApprove && (
              <div className="ml-auto flex gap-2">
                <button className={btnPrimary} disabled={approvalBusy} onClick={() => setReviewing(true)}>
                  Review &amp; Approve
                </button>
                <button
                  className={btnSecondary}
                  disabled={approvalBusy}
                  onClick={doApprove}
                  title="Approve without opening the form"
                >
                  Approve as-is
                </button>
                <button className={btnDanger} disabled={approvalBusy} onClick={() => setShowReject(true)}>
                  Reject
                </button>
              </div>
            )}
          </div>
        )}

        {opp.approval_status === "Rejected" && (
          <div className="mt-4 rounded-card bg-danger-soft px-4 py-3">
            <div className="text-sm font-semibold text-danger">Rejected by Sales Head</div>
            {opp.approval_rejection_reason && (
              <div className="mt-1 text-sm text-danger">{opp.approval_rejection_reason}</div>
            )}
            {canWrite && (
              <button className={`${btnSecondary} mt-2`} disabled={approvalBusy} onClick={doResubmit}>
                Resubmit for approval
              </button>
            )}
          </div>
        )}

        {reviewing && (
          <NewOpportunityForm
            opportunityId={Number(id)}
            approvalMode
            onClose={() => setReviewing(false)}
            onCreated={() => {
              setReviewing(false);
              reloadOpp();
            }}
          />
        )}

        {showReject && (
          <Modal title={`Reject ${opp.opp_id}`} onClose={() => setShowReject(false)}>
            <Field label="Rejection reason" required>
              <textarea
                className={inputCls}
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Explain why this opportunity is rejected (min 10 characters)…"
              />
            </Field>
            <div className="mt-4 flex justify-end gap-2">
              <button className={btnSecondary} onClick={() => setShowReject(false)}>
                Cancel
              </button>
              <button className={btnDanger} disabled={approvalBusy} onClick={doReject}>
                Reject opportunity
              </button>
            </div>
          </Modal>
        )}
      </div>

      {/* Requirements-style tabs (Aug 2026): one surface per question — what
          was sold (Opportunity Details), who applied (Applicants), what to
          test for (Skill Evaluation), and what happened (Activity Log). */}
      <Tabs
        tabs={[
          /* Sub-tab access (25 Aug 2026): templates hide these via the
             `tab:<key>` field entries on the opportunities tab. */
          { key: "details", label: "Opportunity Details", gate: "tab:details" },
          { key: "applicants", label: "Applicants", count: profileMeta?.total, gate: "tab:applicants" },
          { key: "suggested", label: "Suggested Candidates", gate: "tab:applicants" },
          { key: "skills", label: "Skill Evaluation Details", count: skills.length, gate: "tab:skill-eval" },
          { key: "activity", label: "Activity Log", gate: "tab:activity" },
          { key: "projects", label: "Projects", gate: "tab:details" },
          { key: "pes", label: "Project Employees", gate: "tab:details" },
        ].filter((t) => oppAcc.subTabVisible(t.gate)).map(({ gate: _g, ...t }) => t)}
        active={tab}
        onChange={setTab}
      />

      {tab === "details" && (
        <div className="space-y-6">
          {/* Same collapsed-headline treatment as every block below it —
              the whole tab is now a uniform stack of expandable cards. */}
          <CollapsibleCard title="Opportunity Details">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {info.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
                  <dd className="mt-1 text-sm text-primary">{value}</dd>
                </div>
              ))}
            </dl>
            {linkedTemplate && (
              <div className="mt-4 rounded-card border border-subtle bg-surface-2 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">Linked AI L1 template</div>
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
          </CollapsibleCard>
          {attachments.length > 0 && (
            <CollapsibleCard
              title={`Attachments (${attachments.length})`}
              defaultOpen={opp.approval_status === "Pending_Sales_Head_Approval"}
            >
              <ul className="m-0 list-none space-y-2 p-0">
                {attachments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <FileLink url={a.file_url} label={a.file_name || `File #${a.id}`} />
                    {a.kind === "customer_jd" && (
                      <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-[11px] font-semibold text-brand-600 dark:text-brand-300">
                        Customer JD
                      </span>
                    )}
                    {a.uploaded_at && (
                      <span className="text-xs text-muted">{fmtDate(a.uploaded_at)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </CollapsibleCard>
          )}
          <OpportunityAllDetails opp={opp} />
        </div>
      )}

      {tab === "suggested" && (
        <SuggestedCandidatesTab
          oppId={Number(id)}
          canApply={canApplyHere}
          onApplied={loadProfiles}
          showToast={showToast}
        />
      )}

      {tab === "skills" && (
      <div className={cardCls}>
        <div className="fx-hairline-b mb-4 flex flex-wrap items-center justify-between gap-2 pb-3">
          <h2 className="text-base font-bold text-primary">Skill Evaluation Details</h2>
          {canEditSkills && (
            <button className={btnSecondary} onClick={() => setShowSkills(true)}>
              <Pencil size={14} /> Edit skills
            </button>
          )}
        </div>
        {skills.length === 0 ? (
          <div className="text-sm text-muted">No skills attached</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {skills.map((s) => (
              <span
                key={s.skill_id}
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                  s.is_mandatory
                    ? "bg-brand-600 text-white"
                    : "border border-subtle bg-surface-2 text-secondary"
                }`}
                title={s.is_mandatory ? "Mandatory skill" : "Optional skill"}
              >
                {s.skill_name || `Skill #${s.skill_id}`}
                {s.is_mandatory && <span className="ml-1.5 text-xs uppercase tracking-wide">· mandatory</span>}
              </span>
            ))}
          </div>
        )}
      </div>
      )}

      {tab === "applicants" && (
      <div className={cardCls}>
        <div className="fx-hairline-b mb-4 flex flex-wrap items-center justify-between gap-2 pb-3">
          <h2 className="text-base font-bold text-primary">
            Applicants
            {profileMeta?.total ? (
              <span className="ml-2 text-sm font-semibold text-muted">({profileMeta.total})</span>
            ) : null}
          </h2>
          {canApplyHere && (
            <button className={btnSecondary} onClick={() => setApplyHere(true)}>
              <UserPlus size={15} /> Apply a Candidate
            </button>
          )}
        </div>
        <p className="mb-3 text-sm text-muted">Candidates applied to this opportunity.</p>
        <div className="mb-4 flex flex-wrap gap-1.5">
          {APPLICANT_STAGE_FILTERS.map((b) => (
            <button
              key={b.key}
              type="button"
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors duration-micro ease-smooth ${
                profileStage === b.key
                  ? "bg-brand-600 text-white"
                  : "border border-subtle bg-surface-2 text-secondary hover:text-primary"
              }`}
              onClick={() => { setProfileStage(b.key); setProfilePage(1); }}
            >
              {b.label}
            </button>
          ))}
        </div>
        {profiles.length === 0 && !profileSearch && profileStage === "all" ? (
          <EmptyState message="No candidates have applied to this opportunity yet." />
        ) : profiles.length === 0 && profileStage !== "all" && !profileSearch ? (
          <EmptyState message={`No applicants in ${APPLICANT_STAGE_FILTERS.find((b) => b.key === profileStage)?.label || "this stage"} right now.`} />
        ) : (
          <DataTable<ProfileRow>
            columns={applicantCols}
            rows={profiles}
            meta={profileMeta}
            headerRight={profileMeta ? <span className="whitespace-nowrap text-xs font-medium text-muted">{profileMeta.total} {profileMeta.total === 1 ? "applicant" : "applicants"}, page {profileMeta.page}/{Math.max(1, profileMeta.pages || 1)}</span> : undefined}
            onPage={setProfilePage}
            search={profileSearch}
            onSearch={(q) => { setProfileSearch(q); setProfilePage(1); }}
            onRowClick={(r) => crmNavigate(`profiles/${r.id}`)}
            emptyMessage="No applicants match your search."
          />
        )}
      </div>
      )}

      {tab === "activity" && (
      <div className={cardCls}>
        <h2 className="fx-hairline-b mb-4 pb-3 text-base font-bold text-primary">Activity Log</h2>
        <Timeline entries={[...log].reverse()} />
      </div>
      )}

      {tab === "projects" && (
        <div className={cardCls}>
          <p className="mb-3 text-xs text-muted">
            Projects born from this opportunity — open one for its Project Employees
            and their Timesheets.
          </p>
          <CustomerScopedTable
            base={`/api/projects?opportunity_id=${id}`}
            columns={[
              { key: "name", label: "Project", render: (r: any) => <span className="font-semibold text-primary">{r.name}</span> },
              { key: "status", label: "Status", render: (r: any) => <StatusBadge status={r.status} /> },
              { key: "billing_frequency", label: "Billing", render: (r: any) => String(r.billing_frequency || "—") },
              { key: "created_at", label: "Created", align: "right", render: (r: any) => fmtDate(r.created_at) },
            ]}
            onRow={(r: any) => crmNavigate(`projects/${r.id}`)}
            filters={[
              { key: "status", label: "Status",
                options: ["Active", "Completed", "On_Hold"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })) },
            ]}
            emptyMessage="No project has been created from this opportunity yet."
          />
        </div>
      )}

      {tab === "pes" && (
        <div className={cardCls}>
          <ProjectEmployeesScopedTab
            base={`/api/projects/all-employees?opportunity_id=${id}`}
            hint="Employees mapped to this opportunity's projects."
          />
        </div>
      )}

      {showSkills && (
        <EditSkillsModal
          current={skills}
          onClose={() => setShowSkills(false)}
          onSave={async (items) => {
            const res = await crmPost<OppSkill[]>(`/api/opportunities/${opp.id}/skills`, items);
            setOpp({ ...opp, skills: res.data || [] });
            setShowSkills(false);
            showToast("Skills updated");
            loadLog();
          }}
        />
      )}

      {outcomeStage && (
        <Modal
          title={`${pipelineStageLabel(outcomeStage)} — ${opp.opp_id}`}
          onClose={() => { if (!outcomeBusy) { setOutcomeStage(null); setOutcomeErr(""); } }}
          dirty={!!outcomeComment.trim()}
        >
          {outcomeErr && <div className="mb-3"><ErrorBox error={outcomeErr} /></div>}
          <div className="text-sm text-secondary">
            Move <b className="text-primary">{opp.title}</b> from{" "}
            <StatusBadge status={opp.pipeline_stage} label={pipelineStageLabel(opp.pipeline_stage)} /> to{" "}
            <StatusBadge status={outcomeStage} label={pipelineStageLabel(outcomeStage)} />?
            {outcomeStage.startsWith("Closed_") && (
              <div className="mt-2 text-xs text-muted">
                Closed deals move to the Closed tab. Use Reactivate on the opportunity if it comes back.
              </div>
            )}
          </div>
          <div className="mt-4">
            <Field label="Comment">
              <textarea
                className={`${inputCls} min-h-20`}
                rows={3}
                value={outcomeComment}
                onChange={(e) => setOutcomeComment(e.target.value)}
                placeholder="Reason / context (optional) — goes to the activity log"
              />
            </Field>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button className={btnSecondary} onClick={() => setOutcomeStage(null)} disabled={outcomeBusy}>Cancel</button>
            <button
              className={outcomeStage === "Closed_Lost" ? btnDanger : btnPrimary}
              disabled={outcomeBusy}
              onClick={async () => {
                setOutcomeBusy(true);
                setOutcomeErr("");
                try {
                  const res = await crmPost<Opportunity>(`/api/opportunities/${opp.id}/stage-transition`, {
                    new_stage: outcomeStage,
                    comment: outcomeComment.trim() || null,
                  });
                  setOpp(res.data);
                  showToast(`${opp.opp_id} marked ${pipelineStageLabel(outcomeStage)}`);
                  setOutcomeStage(null);
                  loadLog();
                } catch (e: any) {
                  setOutcomeErr(e?.message || "Could not change the status");
                } finally {
                  setOutcomeBusy(false);
                }
              }}
            >
              {outcomeBusy ? "Saving…" : `Mark ${pipelineStageLabel(outcomeStage)}`}
            </button>
          </div>
        </Modal>
      )}

      {showStage && (
        <StageTransitionModal
          current={opp.pipeline_stage}
          allowed={allowedStages}
          onClose={() => setShowStage(false)}
          onSave={async (newStage, comment) => {
            const res = await crmPost<Opportunity>(`/api/opportunities/${opp.id}/stage-transition`, {
              new_stage: newStage,
              comment: comment || null,
            });
            setOpp(res.data);
            setShowStage(false);
            showToast(`Moved to ${newStage.replace(/_/g, " ")}`);
            loadLog();
          }}
        />
      )}
      {/* "Apply a Candidate" — was a dead button (set state no modal read). */}
      {applyHere && (
        <ApplyToOpportunityModal
          mode="pick-candidate"
          opportunityId={opp.id}
          opportunityLabel={`${opp.opp_id} — ${opp.title}`}
          onClose={() => setApplyHere(false)}
          onApplied={(msg) => {
            setApplyHere(false);
            showToast(msg || "Candidate applied");
            loadProfiles();
            loadLog();
          }}
        />
      )}
      {toast}
    </div>
  );
}

/* ------------------------------------------------------------------ skills modal */

function EditSkillsModal({
  current,
  onClose,
  onSave,
}: {
  current: OppSkill[];
  onClose: () => void;
  onSave: (items: { skill_id: number; is_mandatory: boolean }[]) => Promise<void>;
}) {
  const [all, setAll] = useState<SkillOpt[]>([]);
  const [selected, setSelected] = useState<Map<number, boolean>>(
    () => new Map(current.map((s) => [s.skill_id, s.is_mandatory])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetchAllMaster<SkillOpt>("/api/skills", { is_active: true })
      .then((rows) => setAll(rows))
      .catch((e: any) => setError(e?.message || "Failed to load skills"));
  }, []);

  const toggle = (id: number) => {
    setSelected((m) => {
      const next = new Map(m);
      if (next.has(id)) next.delete(id);
      else next.set(id, false);
      return next;
    });
  };
  const toggleMandatory = (id: number) => {
    setSelected((m) => {
      const next = new Map(m);
      if (next.has(id)) next.set(id, !next.get(id));
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave(Array.from(selected.entries()).map(([skill_id, is_mandatory]) => ({ skill_id, is_mandatory })));
    } catch (e: any) {
      setError(e?.message || "Failed to update skills");
      setBusy(false);
    }
  };

  const shown = all.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Modal title="Edit skills" onClose={onClose} fullScreen>
      {error && <div className="mb-3"><ErrorBox error={error} /></div>}
      <input className={`${inputCls} mb-3`} placeholder="Filter skills…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="max-h-72 space-y-1 overflow-y-auto rounded-card border border-subtle p-2">
        {shown.length === 0 && <div className="py-4 text-center text-sm text-muted">No skills found</div>}
        {shown.map((s) => {
          const isSel = selected.has(s.id);
          return (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-control px-2 py-1.5 transition-colors duration-micro ease-smooth hover:bg-surface-2"
            >
              <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm text-secondary">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={isSel} onChange={() => toggle(s.id)} />
                {s.name}
                {s.category && <span className="text-xs text-muted">({s.category})</span>}
              </label>
              {isSel && (
                <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-muted">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!selected.get(s.id)} onChange={() => toggleMandatory(s.id)} />
                  Mandatory
                </label>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={btnPrimary} onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save skills"}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ stage modal */

/** The five outcomes Sales sets from the page header (8 Sep 2026) plus
 * Reactivate. Order is the user's; a button only shows when the server allows
 * that move from the current stage (`allowed_next_stages`). */
const OUTCOME_BUTTONS: { stage: string; label: string; tone: "ok" | "danger" | "hold" | "neutral" }[] = [
  { stage: "Closed_Won", label: "Close Won", tone: "ok" },
  { stage: "Closed_Lost", label: "Close Lost", tone: "danger" },
  { stage: "On_Hold", label: "Customer Hold", tone: "hold" },
  { stage: "Closed_Partial", label: "Close Partial", tone: "neutral" },
  { stage: "Sales_Hold", label: "Sales Hold", tone: "hold" },
  { stage: "Active", label: "Reactivate", tone: "ok" },
];

const OUTCOME_TONE: Record<string, string> = {
  ok: "border-success/40 bg-success-soft text-success hover:bg-success/15",
  danger: "border-danger/40 bg-danger-soft text-danger hover:bg-danger/15",
  hold: "border-warning/40 bg-warning-soft text-warning hover:bg-warning/15",
  neutral: "border-info/40 bg-info-soft text-info hover:bg-info/15",
};

function OutcomeButtons({ current, allowed, busy, onPick }: {
  current: string;
  allowed: string[];
  busy: boolean;
  onPick: (stage: string) => void;
}) {
  const items = OUTCOME_BUTTONS.filter((b) => b.stage !== current && allowed.includes(b.stage));
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Opportunity status">
      {items.map((b) => (
        <button
          key={b.stage}
          type="button"
          disabled={busy}
          onClick={() => onPick(b.stage)}
          className={`rounded-control border px-3 py-1.5 text-xs font-semibold transition-colors duration-micro disabled:opacity-60 ${OUTCOME_TONE[b.tone]}`}
          title={`Mark this opportunity ${b.label}`}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}

function StageTransitionModal({
  current,
  allowed,
  onClose,
  onSave,
}: {
  current: string;
  allowed: string[];
  onClose: () => void;
  onSave: (newStage: string, comment: string) => Promise<void>;
}) {
  const [stage, setStage] = useState(allowed[0] || "");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!stage) return setError("Select a target stage");
    setBusy(true);
    setError("");
    try {
      await onSave(stage, comment.trim());
    } catch (e: any) {
      setError(e?.message || "Stage transition failed");
      setBusy(false);
    }
  };

  return (
    <Modal title="Stage transition" onClose={onClose} fullScreen>
      {error && <div className="mb-3"><ErrorBox error={error} /></div>}
      <div className="mb-3 text-sm text-secondary">
        Current stage: <StatusBadge status={current} label={pipelineStageLabel(current)} />
      </div>
      <div className="space-y-3">
        <Field label="New stage" required>
          <select className={inputCls} value={stage} onChange={(e) => setStage(e.target.value)}>
            {allowed.map((s) => (
              <option key={s} value={s}>{pipelineStageLabel(s)}</option>
            ))}
          </select>
        </Field>
        <Field label="Comment">
          <textarea
            className={`${inputCls} min-h-20`}
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Reason / context for this transition (optional)"
          />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={btnPrimary} onClick={save} disabled={busy}>
          {busy ? "Moving…" : "Move stage"}
        </button>
      </div>
    </Modal>
  );
}
