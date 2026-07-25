/** Opportunity pipeline pages: tabbed list (stage buckets) + detail with skills,
 * linked candidate profiles, server-validated stage transitions and activity log.
 * Calm-premium recipe (DESIGN-DECISIONS.md): token-only colors, raised cards,
 * one primary action per screen, right-aligned numerics in tables. */
import React, { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, Pencil, Plus } from "lucide-react";
import { crmGet, crmPost, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanEditTab } from "../useAccess";
import { crmNavigate, useCrmParams } from "../routerHooks";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { RowActions } from "../components/RowActions";
import { FileLink } from "../components/FileUpload";
import { Timeline } from "../components/Timeline";
import type { ActivityEntry } from "../components/Timeline";
import { NewOpportunityForm } from "./opportunity/NewOpportunityForm";
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
  Active: ["New", "Active"],
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
];

const PENDING_APPROVAL_STATUS = "Pending_Sales_Head_Approval";

const fmtMoney = (v?: number | null) => (v === null || v === undefined ? "—" : Number(v).toLocaleString());
const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : "—");

/* ------------------------------------------------------------------ list page */

export function OpportunitiesListPage() {
  const canWrite = useHasRole("Sales", "Sales_Head") && useCanEditTab("opportunities");
  const [tab, setTab] = useState("Active");
  const [stage, setStage] = useState<string>(TAB_STAGES.Active[0]);
  const [rows, setRows] = useState<Opportunity[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<{ by: string; dir: "asc" | "desc" }>({ by: "created_at", dir: "desc" });
  const [showCreate, setShowCreate] = useState(false);
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
      const query =
        tab === "Pending"
          ? { approval_status: PENDING_APPROVAL_STATUS, page, limit: 20, search: debounced, sort_by: sort.by, sort_dir: sort.dir }
          : { pipeline_stage: stage, page, limit: 20, search: debounced, sort_by: sort.by, sort_dir: sort.dir };
      const res = await crmGet<Opportunity[]>(`/api/opportunities${qs(query)}`);
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load opportunities");
    } finally {
      setLoading(false);
    }
  }, [tab, stage, page, debounced, sort]);

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
    {
      key: "pipeline_stage",
      label: "Stage",
      sortable: true,
      render: (r) => <StatusBadge status={r.pipeline_stage} label={pipelineStageLabel(r.pipeline_stage)} />,
    },
    { key: "approval_status", label: "Approval", render: (r) => (r.approval_status ? <StatusBadge status={r.approval_status} /> : "—") },
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

      {error ? (
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
            stages.length > 1 ? (
              <select
                className={`${inputCls} !w-44`}
                value={stage}
                aria-label="Filter by stage"
                onChange={(e) => {
                  setStage(e.target.value);
                  setPage(1);
                }}
              >
                {stages.map((s) => (
                  <option key={s} value={s}>
                    {pipelineStageLabel(s)}
                  </option>
                ))}
              </select>
            ) : undefined
          }
          emptyMessage="No opportunities in this stage"
          rowActions={canWrite ? (r) => (
            <RowActions
              entity="opportunity"
              itemLabel={r.title}
              onEdit={() => crmNavigate(`opportunities/${r.id}`)}
              deleteUrl={`/api/opportunities/${r.id}`}
              onDeleted={load}
              notify={showToast}
              canEdit
              canDelete
            />
          ) : undefined}
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
      {toast}
    </div>
  );
}

/* ------------------------------------------------------------------ detail page */

const cardCls = "rounded-card border border-subtle bg-surface-1 p-6 shadow-raised";

export function OpportunityDetailPage() {
  const params = useCrmParams();
  const id = params.id;
  const canWrite = useHasRole("Sales", "Sales_Head") && useCanEditTab("opportunities");
  const canArchive = useHasRole("Sales_Head");
  const canApprove = useHasRole("Sales_Head"); // Sales Head (or Admin) signs off

  const [opp, setOpp] = useState<Opportunity | null>(null);
  const [log, setLog] = useState<ActivityEntry[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
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
  const [rejectReason, setRejectReason] = useState("");
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [toast, showToast] = useToast();

  const loadLog = useCallback(() => {
    crmGet<ActivityEntry[]>(`/api/opportunities/${id}/activity-log`)
      .then((r) => setLog(r.data || []))
      .catch(() => {});
  }, [id]);

  const loadProfiles = useCallback(async () => {
    try {
      const res = await crmGet<ProfileRow[]>(`/api/candidate-profiles${qs({ opportunity_id: id, limit: 100 })}`);
      setProfiles(res.data || []);
    } catch {
      /* linked profiles are non-fatal */
    }
  }, [id]);

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
                <button className={btnPrimary} disabled={approvalBusy} onClick={doApprove}>
                  Approve
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
        <dl className="mt-6 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
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
      </div>

      <div className={cardCls}>
        <div className="fx-hairline-b mb-4 flex flex-wrap items-center justify-between gap-2 pb-3">
          <h2 className="text-base font-bold text-primary">Skills</h2>
          {canWrite && (
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

      <div className={cardCls}>
        <h2 className="fx-hairline-b mb-4 pb-3 text-base font-bold text-primary">Applicants</h2>
        <p className="mb-4 text-sm text-muted">Candidates applied to this opportunity.</p>
        {profiles.length === 0 ? (
          <EmptyState message="No candidates have applied to this opportunity yet." />
        ) : (
          <DataTable<ProfileRow>
            columns={applicantCols}
            rows={profiles}
            onRowClick={(r) => crmNavigate(`profiles/${r.id}`)}
            emptyMessage="No candidates have applied to this opportunity yet."
          />
        )}
      </div>

      <div className={cardCls}>
        <h2 className="fx-hairline-b mb-4 pb-3 text-base font-bold text-primary">Activity log</h2>
        <Timeline entries={[...log].reverse()} />
      </div>

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
    crmGet<SkillOpt[]>("/api/skills?limit=100&is_active=true")
      .then((r) => setAll(r.data || []))
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
