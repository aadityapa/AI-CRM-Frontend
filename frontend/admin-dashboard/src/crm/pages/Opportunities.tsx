/** Opportunity pipeline pages: tabbed list (stage buckets) + detail with skills,
 * linked candidate profiles, server-validated stage transitions and activity log.
 * Calm-premium recipe (DESIGN-DECISIONS.md): token-only colors, raised cards,
 * one primary action per screen, right-aligned numerics in tables. */
import React, { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, ChevronDown, Pencil, Plus, UserPlus } from "lucide-react";
import { crmGet, crmPost, qs } from "../api";
import { fetchAllMaster } from "../lib/fetchAllMaster";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanAct } from "../useAccess";
import { CrmLink, crmNavigate, useCrmParams } from "../routerHooks";
import { displayEmail, realEmail } from "../lib/candidateEmail";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
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
  useToast,
} from "../components/ui";
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
 * stage sub-select (first stage selected by default) to keep server-side
 * pagination correct. */
const TAB_STAGES: Record<string, string[]> = {
  Active: ["Active", "New"],
  On_Hold: ["On_Hold"],
  Closed: ["Closed_Won", "Closed_Lost", "Closed_Partial"],
  Rejected: ["Rejected"],
  Archived: ["Archived"],
};

const LIST_TABS = [
  { key: "Active", label: "Active" },
  { key: "Pending", label: "Pending Approval" },
  { key: "On_Hold", label: "Customer Hold" },
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
  const canApply = useHasRole("TA", "Sales", "RMG");
  const [tab, setTab] = useState("Active");
  const [stage, setStage] = useState<string>(TAB_STAGES.Active[0]);
  const [approval, setApproval] = useState("");  // "" = all approval states
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
      const base = { page, limit: 20, search: debounced, sort_by: sort.by, sort_dir: sort.dir,
        ...(typeFilter ? { opp_type: typeFilter } : {}) };
      const query =
        tab === "Pending"
          ? { approval_status: PENDING_APPROVAL_STATUS, ...base }
          : { pipeline_stage: stage, ...(approval ? { approval_status: approval } : {}), ...base };
      const res = await crmGet<Opportunity[]>(`/api/opportunities${qs(query)}`);
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load opportunities");
    } finally {
      setLoading(false);
    }
  }, [tab, stage, approval, page, debounced, sort, typeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const switchTab = (key: string) => {
    setTab(key);
    const st = TAB_STAGES[key];
    setStage(st ? st[0] : "");
    setPage(1);
  };

  const stages = TAB_STAGES[tab] || [];

  const columns: Column<Opportunity>[] = [
    { key: "opp_id", label: "Opp ID", sortable: true },
    { key: "title", label: "Title", sortable: true },
    { key: "customer_name", label: "Customer", render: (r) => r.customer_name || "—" },
    { key: "opp_type", label: "Type", render: (r) => String(r.opp_type || "—").replace(/_/g, " ") },
    // Stage & Approval columns removed (14 Aug 2026): the tab strip + the two
    // dropdown filters carry that state, so the columns were pure repetition.
    { key: "rfi_value", label: "RFI Value", align: "right", render: (r) => fmtMoney(r.rfi_value) },
    { key: "created_at", label: "Created", sortable: true, align: "right", render: (r) => fmtDate(r.created_at) },
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
          loading={loading}
          search={search}
          onSearch={setSearch}
          sort={sort}
          onSort={(by) => setSort((s) => ({ by, dir: s.by === by && s.dir === "desc" ? "asc" : "desc" }))}
          onPage={setPage}
          onRowClick={(r) => crmNavigate(`opportunities/${r.id}`)}
          filters={
            <span className="inline-flex flex-wrap gap-2">
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
              {tab !== "Pending" && (
                <select
                  className={`${inputCls} !w-44`}
                  value={approval}
                  aria-label="Filter by approval status"
                  onChange={(e) => { setApproval(e.target.value); setPage(1); }}
                >
                  <option value="">All approvals</option>
                  <option value="Approved">Approved</option>
                  <option value="Pending_Sales_Head_Approval">Pending Approval</option>
                  <option value="Rejected">Rejected</option>
                </select>
              )}
            </span>
          }
          emptyMessage={<TeachingEmpty page="opportunities" />}
          rowActions={canWrite ? (r) => (
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
            <RowActions
              entity="opportunity"
              itemLabel={r.title}
              onEdit={() => setEditId(r.id)}
              deleteUrl={`/api/opportunities/${r.id}`}
              onDeleted={() => afterListDelete(r.id, setRows, load)}
              notify={showToast}
              canEdit
              canDelete
            />
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
function SuggestedCandidatesTab({
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
    const failed: string[] = [];
    for (const r of batch) {
      try {
        await crmPost("/api/candidate-profiles", {
          candidate_id: r.candidate_id, opportunity_id: oppId,
        });
        ok++;
      } catch (e: any) {
        failed.push(`${r.name}: ${e?.message || "failed"}`);
      }
      setBulkDone((d) => d + 1);
    }
    setBusy(false);
    setBulkOpen(false);
    setSelected(new Set());
    showToast(
      failed.length
        ? `Applied ${ok} of ${batch.length} — failed: ${failed[0]}${failed.length > 1 ? ` (+${failed.length - 1} more)` : ""}`
        : `Applied ${ok} candidate(s) to this opportunity`,
    );
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

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Scored against this opportunity&rsquo;s skills, experience band and each
        candidate&rsquo;s pipeline history — candidates already applied here are excluded.
        Contact them directly or apply them into this pipeline.
      </p>
      {canApply && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-subtle bg-surface-2 px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-secondary">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer"
              style={{ accentColor: "var(--brand-600)" }}
              checked={rows.length > 0 && selected.size === rows.length}
              onChange={() =>
                setSelected(selected.size === rows.length
                  ? new Set()
                  : new Set(rows.map((r) => r.candidate_id)))}
            />
            Select all ({selected.size}/{rows.length})
          </label>
          <button
            className={btnPrimary}
            disabled={selected.size === 0}
            onClick={() => setBulkOpen(true)}
          >
            <UserPlus size={14} /> Apply selected ({selected.size})
          </button>
        </div>
      )}
      {rows.map((r) => (
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
                {realEmail(r.email) && (
                  <a className={`${btnSecondary} !px-2.5 !py-1 text-xs`}
                    href={`mailto:${realEmail(r.email)}`}>
                    Email
                  </a>
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
          <div className="mt-4 flex justify-end gap-2">
            <button className={btnSecondary} onClick={() => setApplying(null)}>Cancel</button>
            <button className={btnPrimary} disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await crmPost("/api/candidate-profiles", {
                    candidate_id: applying.candidate_id, opportunity_id: oppId,
                  });
                  showToast(`${applying.name} applied to this opportunity`);
                  setApplying(null);
                  load();
                  onApplied();
                } catch (e: any) {
                  showToast(e?.message || "Apply failed");
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
  { key: "tech", label: "Technical Screening", statuses: ["Technical_Screening"] },
  { key: "rmg", label: "RMG Screening", statuses: ["RMG_Review"] },
  { key: "cust_screen", label: "Customer Screening", statuses: ["Customer_Screening"] },
  { key: "sales_screen", label: "Sales Screening", statuses: ["Sales_Screening"] },
  { key: "cust_interview", label: "Customer Interviewing",
    statuses: ["Customer_Interview", "L1_Feedback", "L2_Feedback"] },
  { key: "onboarding", label: "Onboarding", statuses: ["Preboarding", "Joined"] },
];

/* ------------------------------------------------------- collapsible card */

/** Detail blocks collapse by default (14 Aug 2026): the page had grown into
 * a wall of every field ever filled — now each block is a headline you
 * expand when you actually need its contents. */
function CollapsibleCard({
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
      render: (r) => <StatusBadge status={r.pipeline_status} />,
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
          {canWrite && allowedStages.length > 0 && opp.approval_status === "Approved" && (
            <button className={btnPrimary} onClick={() => setShowStage(true)}>
              <ArrowRightLeft size={15} /> Stage transition
            </button>
          )}
        </div>

        {opp.approval_status === "Pending_Sales_Head_Approval" && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-card bg-warning-soft px-4 py-3">
            <span className="text-sm font-semibold text-warning">
              Pending Sales Head approval{canApprove ? "" : " — awaiting review"}
            </span>
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
          { key: "details", label: "Opportunity Details" },
          { key: "applicants", label: "Applicants", count: profileMeta?.total },
          { key: "suggested", label: "Suggested Candidates" },
          { key: "skills", label: "Skill Evaluation Details", count: skills.length },
          { key: "activity", label: "Activity Log" },
          { key: "projects", label: "Projects" },
          { key: "pes", label: "Project Employees" },
        ]}
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
