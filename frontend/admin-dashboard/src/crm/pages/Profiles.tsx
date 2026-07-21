/** Candidate Profiles (candidate x opportunity): pipeline list + detail with
 * Overview / Skill Evaluation / Offers / Activity Log / AI Interview (Phase 5 integration).
 * Status transitions render ONLY detail.allowed_next_statuses (computed server-side per role);
 * every transition requires a comment (min 5 chars).
 * Calm-premium recipe (DESIGN-DECISIONS.md): token-only colors, raised cards,
 * zebra-free 48px table rows, right-aligned numerics, one primary action per screen. */
import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Bot, Copy, ExternalLink, Plus, Save, X } from "lucide-react";
import { CrmApiError, crmGet, crmPost, crmPut, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { CrmLink, crmNavigate, useCrmParams } from "../routerHooks";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { FileLink } from "../components/FileUpload";
import { Timeline } from "../components/Timeline";
import type { ActivityEntry } from "../components/Timeline";
import {
  AiThinking, ConfirmModal, EmptyState, ErrorBox, Field, Modal, Spinner, StatusBadge, Tabs,
  btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";

/* ------------------------------------------------------------------ */
/* Shared types + helpers                                              */
/* ------------------------------------------------------------------ */

type ProfileRow = {
  id: number;
  candidate_id: number;
  opportunity_id: number;
  current_ctc: number | null;
  expected_ctc: number | null;
  hike_percent: number | null;
  pipeline_status: string;
  commercial_approved: boolean;
  ctc_approval_amount: number | null;
  created_at: string | null;
  updated_at: string | null;
  // Enriched list fields (from GET /api/candidate-profiles)
  candidate_name?: string | null;
  email?: string | null;
  phone?: string | null;
  experience_years?: number | null;
  notice_period?: string | null;
  technical_domain?: string | null;
  cv_url?: string | null;
  candidate_current_ctc?: number | null;
  candidate_expected_ctc?: number | null;
  opportunity_opp_id?: string | null;
  opportunity_title?: string | null;
};

type SkillEvaluation = {
  id?: number;
  skill_id: number;
  skill_name: string;
  required_level: number | null;
  self_rated: number | null;
  reviewer_rated: number | null;
};

type Offer = {
  id: number;
  profile_id: number;
  offer_date: string | null;
  ctc: number | null;
  joining_date: string | null;
  offer_letter_url: string | null;
  acceptance_date: string | null;
  expiry_date: string | null;
  status: string;
};

type ProfileDetail = ProfileRow & {
  candidate: { id: number; full_name: string; email?: string | null; phone?: string | null } | null;
  opportunity: { id: number; opp_id?: string | null; title?: string | null; customer_name?: string | null } | null;
  skill_evaluations: SkillEvaluation[];
  offers: Offer[];
  allowed_next_statuses: string[];
};

/** Phase 5 — AI interview session linked to this profile. */
type AiInterviewLink = {
  id: number;
  invite_token: string;
  schedule_id: number | null;
  interview_record_id: number | null;
  candidate_id: number;
  opportunity_id: number | null;
  profile_id: number;
  requirement_id: number | null;
  resume_id: number | null;
  scheduled_by: number | null;
  level: string | null;
  overall_score_percent: number | null;
  result: "Pending" | "Passed" | "Failed";
  created_at: string | null;
  completed_at: string | null;
  /** Same-origin admin URL to the full interview report (null until completed). */
  report_link: string | null;
  pending: boolean;
};

type AiScheduleResult = {
  session_ref: string | null;
  invite_url: string | null;
  access_key: string | null;
  link_id: number | null;
};

const ACTIVE_STATUSES = [
  "Sourcing", "Technical_Screening", "RMG_Review", "Sales_Screening", "Customer_Screening",
  "Customer_Interview", "Shortlisted", "Customer_Approval", "Preboarding", "Joined",
];
const REJECTED_STATUSES = ["Sales_Rejected", "RMG_Rejected", "Customer_Rejected", "Self_Withdrawn", "Rejected"];
const REJECTION_LIKE = new Set(REJECTED_STATUSES);

const OFFER_STATUSES = ["Pending", "Accepted", "Expired", "Rejected"];

const fmtMoney = (v?: number | null) =>
  v === null || v === undefined ? "—" : `₹${Number(v).toLocaleString("en-IN")}`;
const fmtHike = (v?: number | null) =>
  v === null || v === undefined ? "—" : `${Number(v).toFixed(2)}%`;
const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : "—");

const label = (s: string) => s.replace(/_/g, " ");

/* Shared table recipe for the in-card tables (mirrors DataTable: zebra-free,
 * 48px rows, 12px uppercase muted header, right-aligned numerics). */
const cardCls = "rounded-card border border-subtle bg-surface-1 shadow-raised";
const thCls = "px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-muted";
const tdCls = "h-12 px-4 py-2 align-middle text-secondary";

function hikePreview(current: string, expected: string): string | null {
  const c = parseFloat(current);
  const e = parseFloat(expected);
  if (!isFinite(c) || !isFinite(e) || c === 0) return null;
  return (((e - c) / c) * 100).toFixed(2);
}

function numOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ */
/* LIST PAGE                                                           */
/* ------------------------------------------------------------------ */

export function ProfilesListPage({
  title = "Candidate Profiles",
  subtitle = "Candidates in the pipeline, per opportunity.",
}: {
  title?: string;
  subtitle?: string;
} = {}) {
  const canCreate = useHasRole("TA", "Sales", "RMG");
  const [toast, showToast] = useToast();

  const [bucket, setBucket] = useState<"active" | "rejected">("active");
  const [status, setStatus] = useState("");
  const [opportunityId, setOpportunityId] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [opportunities, setOpportunities] = useState<
    { id: number; opp_id?: string | null; title?: string | null; customer_name?: string | null }[]
  >([]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    crmGet<any[]>("/api/opportunities?limit=100")
      .then((r) => setOpportunities(r.data || []))
      .catch(() => {});
  }, []);

  const load = () => {
    setLoading(true);
    setError("");
    crmGet<ProfileRow[]>(
      `/api/candidate-profiles${qs({
        bucket,
        pipeline_status: status,
        opportunity_id: opportunityId || undefined,
        search: debouncedSearch || undefined,
        page,
        limit: 20,
      })}`,
    )
      .then((r) => {
        setRows(r.data || []);
        setMeta(r.meta);
      })
      .catch((e: any) => setError(e?.message || "Failed to load profiles"))
      .finally(() => setLoading(false));
  };
  useEffect(load, [bucket, status, opportunityId, debouncedSearch, page]);

  const statusOptions = bucket === "active" ? ACTIVE_STATUSES : REJECTED_STATUSES;

  const displayCtc = (r: ProfileRow, kind: "current" | "expected") => {
    if (kind === "current") return r.current_ctc ?? r.candidate_current_ctc ?? null;
    return r.expected_ctc ?? r.candidate_expected_ctc ?? null;
  };

  const columns: Column<ProfileRow>[] = [
    {
      key: "candidate",
      label: "Candidate",
      render: (r) => (
        <span className="font-semibold text-primary">
          {r.candidate_name || `Candidate #${r.candidate_id}`}
        </span>
      ),
    },
    {
      key: "email",
      label: "Email",
      render: (r) => r.email || "—",
    },
    {
      key: "phone",
      label: "Phone",
      render: (r) => r.phone || "—",
    },
    {
      key: "experience_years",
      label: "Exp (yrs)",
      align: "right",
      render: (r) => (r.experience_years != null ? String(r.experience_years) : "—"),
    },
    {
      key: "opportunity",
      label: "Opportunity",
      render: (r) => (
        <span>
          <span className="font-mono text-xs text-muted">{r.opportunity_opp_id || "—"}</span>
          <span className="ml-1.5">{r.opportunity_title || `Opportunity #${r.opportunity_id}`}</span>
        </span>
      ),
    },
    { key: "pipeline_status", label: "Status", render: (r) => <StatusBadge status={r.pipeline_status} /> },
    {
      key: "current_ctc",
      label: "Current CTC",
      align: "right",
      render: (r) => fmtMoney(displayCtc(r, "current")),
    },
    {
      key: "expected_ctc",
      label: "Expected CTC",
      align: "right",
      render: (r) => fmtMoney(displayCtc(r, "expected")),
    },
    { key: "hike_percent", label: "Hike %", align: "right", render: (r) => fmtHike(r.hike_percent) },
    { key: "created_at", label: "Applied", render: (r) => fmtDate(r.created_at) },
  ];

  return (
    <div>
      {toast}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-display text-xl font-bold text-primary">{title}</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        </div>
        {canCreate && (
          <button className={btnPrimary} onClick={() => setShowCreate(true)}>
            <Plus size={15} /> New Profile
          </button>
        )}
      </div>

      <div className="mb-4">
        <Tabs
          tabs={[
            { key: "active", label: "Active" },
            { key: "rejected", label: "Rejected" },
          ]}
          active={bucket}
          onChange={(k) => {
            setBucket(k as "active" | "rejected");
            setStatus("");
            setPage(1);
          }}
        />
      </div>

      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : (
        <DataTable<ProfileRow>
          columns={columns}
          rows={rows}
          meta={meta}
          loading={loading}
          search={search}
          onSearch={setSearch}
          onPage={setPage}
          onRowClick={(r) => crmNavigate(`profiles/${r.id}`)}
          filters={
            <div className="flex flex-wrap gap-2">
              <select
                className={`${inputCls} !w-56`}
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                aria-label="Filter by pipeline status"
              >
                <option value="">All statuses</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </select>
              <select
                className={`${inputCls} !w-64`}
                value={opportunityId}
                onChange={(e) => {
                  setOpportunityId(e.target.value);
                  setPage(1);
                }}
                aria-label="Filter by opportunity"
              >
                <option value="">All opportunities</option>
                {opportunities.map((o) => (
                  <option key={o.id} value={String(o.id)}>
                    {(o.opp_id || `#${o.id}`) + (o.title ? ` — ${o.title}` : "")}
                    {o.customer_name ? ` (${o.customer_name})` : ""}
                  </option>
                ))}
              </select>
            </div>
          }
          emptyMessage={bucket === "active" ? "No active applications" : "No rejected applications"}
        />
      )}

      {showCreate && (
        <NewProfileModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            showToast("Candidate profile created");
            crmNavigate(`profiles/${id}`);
          }}
        />
      )}
    </div>
  );
}

/* ---------- New Profile modal ---------- */

function NewProfileModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [candSearch, setCandSearch] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [opportunityId, setOpportunityId] = useState("");
  const [currentCtc, setCurrentCtc] = useState("");
  const [expectedCtc, setExpectedCtc] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    crmGet<any[]>("/api/candidates?limit=100").then((r) => setCandidates(r.data || [])).catch(() => {});
    crmGet<any[]>("/api/opportunities?limit=100").then((r) => setOpportunities(r.data || [])).catch(() => {});
  }, []);

  const candName = (c: any) =>
    c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || `Candidate #${c.id}`;

  const filteredCandidates = useMemo(() => {
    const q = candSearch.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) => candName(c).toLowerCase().includes(q) || String(c.email || "").toLowerCase().includes(q),
    );
  }, [candidates, candSearch]);

  const hike = hikePreview(currentCtc, expectedCtc);

  const submit = async () => {
    setError("");
    if (!candidateId || !opportunityId) {
      setError("Candidate and opportunity are required");
      return;
    }
    setBusy(true);
    try {
      const res = await crmPost<ProfileRow>("/api/candidate-profiles", {
        candidate_id: Number(candidateId),
        opportunity_id: Number(opportunityId),
        current_ctc: numOrNull(currentCtc),
        expected_ctc: numOrNull(expectedCtc),
        // Backend ProfileCreate has no notes field (ignored server-side); kept for future schema.
        notes: notes.trim() || undefined,
      });
      onCreated(res.data.id);
    } catch (e: any) {
      if (e instanceof CrmApiError && e.status === 409) {
        setError("A profile for this candidate and opportunity already exists.");
      } else {
        setError(e?.message || "Failed to create profile");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New Candidate Profile" onClose={onClose} fullScreen>
      <div className="space-y-3">
        <Field label="Candidate" required>
          <input
            className={`${inputCls} mb-1.5`}
            placeholder="Type to filter candidates…"
            value={candSearch}
            onChange={(e) => setCandSearch(e.target.value)}
          />
          <select className={inputCls} value={candidateId} onChange={(e) => setCandidateId(e.target.value)}>
            <option value="">Select candidate…</option>
            {filteredCandidates.map((c) => (
              <option key={c.id} value={c.id}>
                {candName(c)}{c.email ? ` — ${c.email}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Opportunity" required>
          <select className={inputCls} value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)}>
            <option value="">Select opportunity…</option>
            {opportunities.map((o) => (
              <option key={o.id} value={o.id}>
                {o.opp_id ? `${o.opp_id} — ` : ""}{o.title || `Opportunity #${o.id}`}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Current CTC">
            <input type="number" min={0} className={inputCls} value={currentCtc} onChange={(e) => setCurrentCtc(e.target.value)} />
          </Field>
          <Field label="Expected CTC">
            <input type="number" min={0} className={inputCls} value={expectedCtc} onChange={(e) => setExpectedCtc(e.target.value)} />
          </Field>
        </div>
        {hike !== null && (
          <div className="rounded-control bg-info-soft px-3 py-2 text-xs font-semibold text-info">
            Hike preview: {hike}%
          </div>
        )}
        <Field label="Notes">
          <textarea className={inputCls} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error && <ErrorBox error={error} />}
        <div className="flex justify-end gap-2 pt-1">
          <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={btnPrimary} onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create Profile"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* DETAIL PAGE                                                         */
/* ------------------------------------------------------------------ */

export function ProfileDetailPage() {
  const { id } = useCrmParams();
  const [toast, showToast] = useToast();
  const [detail, setDetail] = useState<ProfileDetail | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");

  // AI interview sessions — fetched on page load (powers the header pending
  // badge) and reused by the AI Interview tab.
  const [aiLinks, setAiLinks] = useState<AiInterviewLink[] | null>(null);
  const [aiPendingCount, setAiPendingCount] = useState(0);
  const [aiError, setAiError] = useState("");

  const load = () => {
    setError("");
    crmGet<ProfileDetail>(`/api/candidate-profiles/${id}`)
      .then((r) => setDetail(r.data))
      .catch((e: any) => setError(e?.message || "Failed to load profile"));
  };
  useEffect(load, [id]);

  const loadAi = () => {
    setAiError("");
    crmGet<AiInterviewLink[]>(`/api/candidate-profiles/${id}/ai-interviews`)
      .then((r) => {
        const links = r.data || [];
        setAiLinks(links);
        const pc = (r.meta as any)?.pending_count;
        setAiPendingCount(typeof pc === "number" ? pc : links.filter((l) => l.pending).length);
      })
      .catch((e: any) => setAiError(e?.message || "Failed to load AI interviews"));
  };
  useEffect(loadAi, [id]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!detail) return <Spinner label="Loading profile…" />;

  return (
    <div>
      {toast}
      <div className="mb-3 text-xs font-semibold text-muted">
        <CrmLink to="profiles" className="hover:underline">Candidate Profiles</CrmLink>
        <span className="mx-1.5">/</span>
        <span>Profile #{detail.id}</span>
      </div>

      {/* ---------- Header card ---------- */}
      <div className="glass fx-gradient-border rounded-card shadow-raised mb-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-display text-xl font-bold text-primary">
                {detail.candidate ? (
                  <CrmLink to={`candidates/${detail.candidate.id}`} className="hover:underline">
                    {detail.candidate.full_name || `Candidate #${detail.candidate.id}`}
                  </CrmLink>
                ) : (
                  `Candidate #${detail.candidate_id}`
                )}
              </h1>
              {aiPendingCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-semibold text-warning ring-1 ring-inset ring-subtle">
                  <AlertTriangle size={12} /> AI interview pending
                </span>
              )}
            </div>
            <div className="mt-1 text-sm text-muted">
              {[detail.candidate?.email, detail.candidate?.phone].filter(Boolean).join(" · ") || "No contact details"}
            </div>
            <div className="mt-2 text-sm text-secondary">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Opportunity</span>{" "}
              {detail.opportunity ? (
                <CrmLink
                  to={`opportunities/${detail.opportunity.id}`}
                  className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
                >
                  {detail.opportunity.opp_id ? `${detail.opportunity.opp_id} — ` : ""}
                  {detail.opportunity.title || `Opportunity #${detail.opportunity.id}`}
                </CrmLink>
              ) : (
                <span>Opportunity #{detail.opportunity_id}</span>
              )}
              {detail.opportunity?.customer_name && (
                <span className="text-muted"> · {detail.opportunity.customer_name}</span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <StatusBadge status={detail.pipeline_status} />
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ring-subtle ${
                detail.commercial_approved ? "bg-success-soft text-success" : "bg-surface-2 text-muted"
              }`}
            >
              {detail.commercial_approved ? "Commercial approved" : "Commercial not approved"}
            </span>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <HeaderStat label="Current CTC" value={fmtMoney(detail.current_ctc)} />
          <HeaderStat label="Expected CTC" value={fmtMoney(detail.expected_ctc)} />
          <HeaderStat label="Hike %" value={fmtHike(detail.hike_percent)} />
          <HeaderStat label="CTC Approval Amount" value={fmtMoney(detail.ctc_approval_amount)} />
        </div>
      </div>

      <div className="mb-4">
        <Tabs
          tabs={[
            { key: "overview", label: "Overview" },
            { key: "skills", label: "Skill Evaluation", count: detail.skill_evaluations?.length },
            { key: "offers", label: "Offers", count: detail.offers?.length },
            { key: "activity", label: "Activity Log" },
            { key: "ai", label: "AI Interview" },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === "overview" && <OverviewTab detail={detail} onReload={load} showToast={showToast} />}
      {tab === "skills" && <SkillsTab detail={detail} onReload={load} showToast={showToast} />}
      {tab === "offers" && <OffersTab detail={detail} onReload={load} showToast={showToast} />}
      {tab === "activity" && <ActivityTab profileId={detail.id} />}
      {tab === "ai" && (
        <AiInterviewTab
          profileId={detail.id}
          links={aiLinks}
          error={aiError}
          onReload={loadAi}
          showToast={showToast}
        />
      )}
    </div>
  );
}

function HeaderStat({ label: l, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="glass fx-gradient-border fx-lift rounded-card px-3 py-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{l}</div>
      <div className="font-display text-sm font-bold tabular-nums text-primary">{value}</div>
    </div>
  );
}

/* ---------- Overview tab ---------- */

function OverviewTab({
  detail,
  onReload,
  showToast,
}: {
  detail: ProfileDetail;
  onReload: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const canEdit = useHasRole("TA", "Sales", "RMG");
  const [currentCtc, setCurrentCtc] = useState(detail.current_ctc?.toString() ?? "");
  const [expectedCtc, setExpectedCtc] = useState(detail.expected_ctc?.toString() ?? "");
  const [approvalAmount, setApprovalAmount] = useState(detail.ctc_approval_amount?.toString() ?? "");
  const [commercialApproved, setCommercialApproved] = useState(detail.commercial_approved);
  const [saving, setSaving] = useState(false);
  const [showTransition, setShowTransition] = useState(false);

  useEffect(() => {
    setCurrentCtc(detail.current_ctc?.toString() ?? "");
    setExpectedCtc(detail.expected_ctc?.toString() ?? "");
    setApprovalAmount(detail.ctc_approval_amount?.toString() ?? "");
    setCommercialApproved(detail.commercial_approved);
  }, [detail]);

  const allowed = detail.allowed_next_statuses || [];
  const hike = hikePreview(currentCtc, expectedCtc);

  const save = async () => {
    setSaving(true);
    try {
      await crmPut(`/api/candidate-profiles/${detail.id}`, {
        current_ctc: numOrNull(currentCtc),
        expected_ctc: numOrNull(expectedCtc),
        ctc_approval_amount: numOrNull(approvalAmount),
        commercial_approved: commercialApproved,
      });
      showToast("Profile updated");
      onReload();
    } catch (e: any) {
      showToast(e?.message || "Failed to update profile", "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${cardCls} p-6`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold text-primary">Commercials</h2>
        <span title={allowed.length === 0 ? "No transitions available for your role" : undefined}>
          {/* Secondary by design — "Save changes" below is this screen's one primary action. */}
          <button className={btnSecondary} disabled={allowed.length === 0} onClick={() => setShowTransition(true)}>
            <ArrowRightLeft size={15} /> Change Status
          </button>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Current CTC">
          <input
            type="number" min={0} className={inputCls} value={currentCtc} disabled={!canEdit}
            onChange={(e) => setCurrentCtc(e.target.value)}
          />
        </Field>
        <Field label="Expected CTC">
          <input
            type="number" min={0} className={inputCls} value={expectedCtc} disabled={!canEdit}
            onChange={(e) => setExpectedCtc(e.target.value)}
          />
        </Field>
        <Field label="CTC Approval Amount">
          <input
            type="number" min={0} className={inputCls} value={approvalAmount} disabled={!canEdit}
            onChange={(e) => setApprovalAmount(e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-secondary">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={commercialApproved}
              disabled={!canEdit}
              onChange={(e) => setCommercialApproved(e.target.checked)}
            />
            Commercial approved
          </label>
          {hike !== null && (
            <span className="rounded-control bg-info-soft px-2.5 py-1 text-xs font-semibold text-info">
              Hike preview: {hike}%
            </span>
          )}
        </div>
        {canEdit && (
          <button className={btnPrimary} onClick={save} disabled={saving}>
            <Save size={15} /> {saving ? "Saving…" : "Save changes"}
          </button>
        )}
      </div>

      <div className="mt-6 border-t border-subtle pt-4 text-xs text-muted">
        Created {fmtDate(detail.created_at)} · Last updated {fmtDate(detail.updated_at)}
      </div>

      {showTransition && (
        <TransitionModal
          profileId={detail.id}
          currentStatus={detail.pipeline_status}
          allowed={allowed}
          onClose={() => setShowTransition(false)}
          onDone={(msg) => {
            setShowTransition(false);
            showToast(msg || "Status updated");
            onReload();
          }}
        />
      )}
    </div>
  );
}

function TransitionModal({
  profileId,
  currentStatus,
  allowed,
  onClose,
  onDone,
}: {
  profileId: number;
  currentStatus: string;
  allowed: string[];
  onClose: () => void;
  onDone: (message?: string) => void;
}) {
  const [newStatus, setNewStatus] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [commentError, setCommentError] = useState("");

  const submit = async () => {
    setError("");
    setCommentError("");
    if (!newStatus) {
      setError("Select the new status");
      return;
    }
    if (comment.trim().length < 5) {
      setCommentError("A comment is mandatory (minimum 5 characters)");
      return;
    }
    setBusy(true);
    try {
      const res = await crmPost(`/api/candidate-profiles/${profileId}/status-transition`, {
        new_status: newStatus,
        comment: comment.trim(),
      });
      onDone(res.message);
    } catch (e: any) {
      setError(e?.message || "Transition failed");
      setBusy(false);
    }
  };

  return (
    <Modal title="Change Pipeline Status" onClose={onClose} fullScreen>
      <div className="space-y-3">
        <div className="text-sm text-secondary">
          Current status: <StatusBadge status={currentStatus} />
        </div>
        <Field label="New status" required>
          <select className={inputCls} value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
            <option value="">Select new status…</option>
            {allowed.map((s) => (
              <option key={s} value={s} className={REJECTION_LIKE.has(s) ? "font-semibold text-danger" : ""}>
                {REJECTION_LIKE.has(s) ? `⛔ ${label(s)}` : label(s)}
              </option>
            ))}
          </select>
        </Field>
        {newStatus && REJECTION_LIKE.has(newStatus) && (
          <div className="rounded-control bg-danger-soft px-3 py-2 text-xs font-semibold text-danger">
            This is a rejection/withdrawal — the profile moves to the Rejected bucket.
          </div>
        )}
        <Field label="Comment" required error={commentError}>
          <textarea
            className={`${inputCls} ${commentError ? "input-error" : ""}`}
            rows={3}
            placeholder="Why is this status changing? (mandatory, min 5 characters)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </Field>
        {error && <ErrorBox error={error} />}
        <div className="flex justify-end gap-2 pt-1">
          <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={btnPrimary} onClick={submit} disabled={busy}>
            {busy ? "Updating…" : "Update Status"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- Skill Evaluation tab ---------- */

type EvalRow = {
  skill_id: number;
  skill_name: string;
  required_level: string;
  self_rated: string;
  reviewer_rated: string;
  isNew?: boolean;
};

function SkillsTab({
  detail,
  onReload,
  showToast,
}: {
  detail: ProfileDetail;
  onReload: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const canEval = useHasRole("RMG", "TA", "Sales");
  const toRows = (evals: SkillEvaluation[]): EvalRow[] =>
    (evals || []).map((e) => ({
      skill_id: e.skill_id,
      skill_name: e.skill_name,
      required_level: e.required_level?.toString() ?? "",
      self_rated: e.self_rated?.toString() ?? "",
      reviewer_rated: e.reviewer_rated?.toString() ?? "",
    }));

  const [rows, setRows] = useState<EvalRow[]>(toRows(detail.skill_evaluations));
  const [skills, setSkills] = useState<any[]>([]);
  const [addSkillId, setAddSkillId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setRows(toRows(detail.skill_evaluations)); }, [detail]);
  useEffect(() => {
    if (canEval) crmGet<any[]>("/api/skills?limit=100").then((r) => setSkills(r.data || [])).catch(() => {});
  }, [canEval]);

  const usedIds = new Set(rows.map((r) => r.skill_id));
  const availableSkills = skills.filter((s) => !usedIds.has(s.id));

  const setCell = (idx: number, field: "required_level" | "self_rated" | "reviewer_rated", value: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const addRow = () => {
    const skill = skills.find((s) => String(s.id) === addSkillId);
    if (!skill) return;
    setRows((prev) => [
      ...prev,
      { skill_id: skill.id, skill_name: skill.name, required_level: "", self_rated: "", reviewer_rated: "", isNew: true },
    ]);
    setAddSkillId("");
  };

  const removeNewRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx));

  const ratingOrNull = (s: string): number | null => {
    if (s.trim() === "") return null;
    return parseInt(s, 10);
  };

  const save = async () => {
    setError("");
    if (rows.length === 0) {
      setError("Add at least one skill to evaluate");
      return;
    }
    for (const r of rows) {
      for (const f of ["required_level", "self_rated", "reviewer_rated"] as const) {
        const v = ratingOrNull(r[f]);
        if (v !== null && (!Number.isInteger(v) || v < 1 || v > 5)) {
          setError(`${r.skill_name}: ratings must be between 1 and 5`);
          return;
        }
      }
    }
    setSaving(true);
    try {
      await crmPost(
        `/api/candidate-profiles/${detail.id}/skill-evaluation`,
        rows.map((r) => ({
          skill_id: r.skill_id,
          required_level: ratingOrNull(r.required_level),
          self_rated: ratingOrNull(r.self_rated),
          reviewer_rated: ratingOrNull(r.reviewer_rated),
        })),
      );
      showToast("Skill evaluations saved");
      onReload();
    } catch (e: any) {
      showToast(e?.message || "Failed to save evaluations", "err");
    } finally {
      setSaving(false);
    }
  };

  const ratingInput = (idx: number, field: "required_level" | "self_rated" | "reviewer_rated", value: string) => (
    <input
      type="number"
      min={1}
      max={5}
      className={`${inputCls} !w-20`}
      value={value}
      disabled={!canEval}
      onChange={(e) => setCell(idx, field, e.target.value)}
      aria-label={field.replace(/_/g, " ")}
    />
  );

  return (
    <div className={cardCls}>
      <div className="flex flex-wrap items-center justify-between gap-3 fx-hairline-b px-4 py-3">
        <h2 className="text-base font-bold text-primary">Skill Evaluation</h2>
        {canEval && (
          <div className="flex items-center gap-2">
            <select className={`${inputCls} !w-52`} value={addSkillId} onChange={(e) => setAddSkillId(e.target.value)}>
              <option value="">Add skill…</option>
              {availableSkills.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button className={btnSecondary} onClick={addRow} disabled={!addSkillId}>
              <Plus size={15} /> Add row
            </button>
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm lg:min-w-0">
          <thead className="sticky top-0 z-10 bg-surface-1">
            <tr className="border-b border-subtle text-left">
              {["Skill", "Required level", "Self rated", "Reviewer rated", ""].map((h) => (
                <th key={h} className={thCls}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5}><EmptyState message="No skill evaluations yet" /></td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.skill_id} className="border-b border-subtle">
                  <td className={`${tdCls} font-semibold text-primary`}>{r.skill_name}</td>
                  <td className={tdCls}>{ratingInput(i, "required_level", r.required_level)}</td>
                  <td className={tdCls}>{ratingInput(i, "self_rated", r.self_rated)}</td>
                  <td className={tdCls}>{ratingInput(i, "reviewer_rated", r.reviewer_rated)}</td>
                  <td className={tdCls}>
                    {r.isNew && canEval && (
                      <button
                        className="rounded-control p-1 text-muted transition-colors duration-micro ease-smooth hover:bg-danger-soft hover:text-danger"
                        onClick={() => removeNewRow(i)}
                        aria-label={`Remove ${r.skill_name}`}
                      >
                        <X size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {(error || canEval) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-subtle px-4 py-3">
          <div className="text-xs text-danger">{error}</div>
          {canEval && (
            <button className={btnPrimary} onClick={save} disabled={saving || rows.length === 0}>
              <Save size={15} /> {saving ? "Saving…" : "Save evaluations"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Offers tab ---------- */

function OffersTab({
  detail,
  onReload,
  showToast,
}: {
  detail: ProfileDetail;
  onReload: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const canOffer = useHasRole("Sales", "Sales_Head", "HR");
  const [showCreate, setShowCreate] = useState(false);
  const [busyOfferId, setBusyOfferId] = useState<number | null>(null);

  const offers = detail.offers || [];

  const updateStatus = async (offer: Offer, status: string) => {
    if (!status || status === offer.status) return;
    setBusyOfferId(offer.id);
    try {
      await crmPut(`/api/candidate-profiles/${detail.id}/offer/${offer.id}`, { status });
      showToast(`Offer #${offer.id} marked ${status}`);
      onReload();
    } catch (e: any) {
      showToast(e?.message || "Failed to update offer", "err");
    } finally {
      setBusyOfferId(null);
    }
  };

  return (
    <div className={cardCls}>
      <div className="flex flex-wrap items-center justify-between gap-2 fx-hairline-b px-4 py-3">
        <h2 className="text-base font-bold text-primary">Offer History</h2>
        {canOffer && (
          <button className={btnPrimary} onClick={() => setShowCreate(true)}>
            <Plus size={15} /> New Offer
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm lg:min-w-0">
          <thead className="sticky top-0 z-10 bg-surface-1">
            <tr className="border-b border-subtle text-left">
              <th className={thCls}>Offer date</th>
              <th className={`${thCls} text-right`}>CTC</th>
              <th className={thCls}>Joining</th>
              <th className={thCls}>Expiry</th>
              <th className={thCls}>Status</th>
              <th className={thCls}>Offer letter</th>
              {canOffer && <th className={thCls}>Update status</th>}
            </tr>
          </thead>
          <tbody>
            {offers.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    message="No offers yet"
                    action={canOffer ? (
                      <button type="button" className={btnPrimary} onClick={() => setShowCreate(true)}>
                        <Plus size={15} /> New Offer
                      </button>
                    ) : undefined}
                  />
                </td>
              </tr>
            ) : (
              offers.map((o) => (
                <tr key={o.id} className="border-b border-subtle">
                  <td className={tdCls}>{fmtDate(o.offer_date)}</td>
                  <td className={`${tdCls} text-right font-semibold tabular-nums text-primary`}>{fmtMoney(o.ctc)}</td>
                  <td className={tdCls}>{fmtDate(o.joining_date)}</td>
                  <td className={tdCls}>{fmtDate(o.expiry_date)}</td>
                  <td className={tdCls}><StatusBadge status={o.status} /></td>
                  <td className={tdCls}><FileLink url={o.offer_letter_url} label="Offer letter" /></td>
                  {canOffer && (
                    <td className={tdCls}>
                      <select
                        className={`${inputCls} !w-32`}
                        value={o.status}
                        disabled={busyOfferId === o.id}
                        onChange={(e) => updateStatus(o, e.target.value)}
                        aria-label={`Update status of offer ${o.id}`}
                      >
                        {OFFER_STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {showCreate && (
        <NewOfferModal
          profileId={detail.id}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            showToast("Offer created");
            onReload();
          }}
        />
      )}
    </div>
  );
}

function NewOfferModal({
  profileId,
  onClose,
  onCreated,
}: {
  profileId: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [offerDate, setOfferDate] = useState("");
  const [ctc, setCtc] = useState("");
  const [joiningDate, setJoiningDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!offerDate || numOrNull(ctc) === null) {
      setError("Offer date and CTC are required");
      return;
    }
    setBusy(true);
    try {
      await crmPost(`/api/candidate-profiles/${profileId}/offer`, {
        offer_date: offerDate,
        ctc: numOrNull(ctc),
        joining_date: joiningDate || null,
        expiry_date: expiryDate || null,
      });
      onCreated();
    } catch (e: any) {
      setError(e?.message || "Failed to create offer");
      setBusy(false);
    }
  };

  return (
    <Modal title="New Offer" onClose={onClose} fullScreen>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Offer date" required>
            <input type="date" className={inputCls} value={offerDate} onChange={(e) => setOfferDate(e.target.value)} />
          </Field>
          <Field label="CTC" required>
            <input type="number" min={0} className={inputCls} value={ctc} onChange={(e) => setCtc(e.target.value)} />
          </Field>
          <Field label="Joining date">
            <input type="date" className={inputCls} value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} />
          </Field>
          <Field label="Expiry date">
            <input type="date" className={inputCls} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </Field>
        </div>
        {error && <ErrorBox error={error} />}
        <div className="flex justify-end gap-2 pt-1">
          <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={btnPrimary} onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create Offer"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- Activity Log tab ---------- */

function ActivityTab({ profileId }: { profileId: number }) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState("");

  const load = () => {
    setError("");
    crmGet<ActivityEntry[]>(`/api/candidate-profiles/${profileId}/activity-log`)
      .then((r) => setEntries(r.data || []))
      .catch((e: any) => setError(e?.message || "Failed to load activity log"));
  };
  useEffect(load, [profileId]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (entries === null) return <Spinner label="Loading activity…" />;
  return (
    <div className={`${cardCls} p-6`}>
      <Timeline entries={entries} />
    </div>
  );
}

/* ---------- AI Interview tab (Phase 5) ---------- */

const fmtScore = (v?: number | null) =>
  v === null || v === undefined ? "—" : `${Number(v).toFixed(1).replace(/\.0$/, "")}%`;

function AiInterviewTab({
  profileId,
  links,
  error,
  onReload,
  showToast,
}: {
  profileId: number;
  links: AiInterviewLink[] | null;
  error: string;
  onReload: () => void;
  showToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const canTrigger = useHasRole("TA", "RMG", "Sales");
  const [showConfirm, setShowConfirm] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [scheduled, setScheduled] = useState<AiScheduleResult | null>(null);

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} copied to clipboard`);
    } catch {
      showToast("Copy failed — please copy manually", "err");
    }
  };

  const trigger = async () => {
    setScheduling(true);
    try {
      const res = await crmPost<AiScheduleResult>(`/api/candidate-profiles/${profileId}/ai-interviews`);
      setShowConfirm(false);
      setScheduled(res.data);
      showToast(res.message || "AI interview ready — copy the invite to share");
      onReload();
    } catch (e: any) {
      setShowConfirm(false);
      showToast(e?.message || "Failed to schedule AI interview", "err");
    } finally {
      setScheduling(false);
    }
  };

  if (error) return <ErrorBox error={error} onRetry={onReload} />;
  if (links === null) return <Spinner label="Loading AI interviews…" />;

  const completed = links.filter((l) => !l.pending);
  const latest = completed.length
    ? [...completed].sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""))[0]
    : null;

  return (
    <div className="space-y-4">
      {scheduled && (
        <div className="rounded-card border border-subtle bg-success-soft p-4 shadow-raised">
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm font-bold text-success">
              AI interview ready — copy the invite to share with the candidate
            </div>
            <button
              className="rounded-control p-1 text-success transition-colors duration-micro ease-smooth hover:bg-surface-2"
              onClick={() => setScheduled(null)}
              aria-label="Dismiss"
            >
              <X size={15} />
            </button>
          </div>
          <div className="mt-3 space-y-2 text-sm">
            {scheduled.invite_url && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-success">
                  Invite link
                </span>
                <span className="max-w-md truncate rounded-control border border-subtle bg-surface-1 px-2.5 py-1 font-mono text-xs text-secondary">
                  {scheduled.invite_url}
                </span>
                <button className={btnSecondary} onClick={() => copyText(scheduled.invite_url!, "Invite link")}>
                  <Copy size={14} /> Copy
                </button>
              </div>
            )}
            {scheduled.access_key && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-success">
                  Access key
                </span>
                <span className="rounded-control border border-subtle bg-surface-1 px-2.5 py-1 font-mono text-sm font-bold tracking-wider text-primary">
                  {scheduled.access_key}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {latest && (
        /* AI-generated result — animated gradient-border AI surface */
        <div className="glass fx-gradient-border-animated rounded-card p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden />
            Latest completed AI interview
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <span className="font-display text-2xl font-bold tabular-nums text-primary">
              {fmtScore(latest.overall_score_percent)}
            </span>
            <StatusBadge status={latest.result} />
            <span className="text-sm text-muted">
              Completed {fmtDate(latest.completed_at)}
            </span>
            {latest.report_link && (
              <a
                href={latest.report_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
              >
                Full report <ExternalLink size={13} />
              </a>
            )}
          </div>
        </div>
      )}

      <div className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-3 fx-hairline-b px-4 py-3">
          <h2 className="flex items-center gap-2 text-base font-bold text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden />
            <Bot size={18} className="text-brand-600 dark:text-brand-300" /> AI Interview Sessions
          </h2>
          {canTrigger && (
            <button className={btnPrimary} onClick={() => setShowConfirm(true)}>
              <Plus size={15} /> Trigger AI Interview
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm lg:min-w-0">
            <thead className="sticky top-0 z-10 bg-surface-1">
              <tr className="border-b border-subtle text-left">
                <th className={thCls}>Created</th>
                <th className={thCls}>Level</th>
                <th className={thCls}>Result</th>
                <th className={`${thCls} text-right`}>Score</th>
                <th className={thCls}>Completed</th>
                <th className={thCls}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {links.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      message="No AI interview sessions yet"
                      action={canTrigger ? (
                        <button type="button" className={btnPrimary} onClick={() => setShowConfirm(true)}>
                          <Plus size={15} /> Trigger AI Interview
                        </button>
                      ) : undefined}
                    />
                  </td>
                </tr>
              ) : (
                links.map((l) => (
                  <tr key={l.id} className="border-b border-subtle">
                    <td className={tdCls}>{fmtDate(l.created_at)}</td>
                    <td className={`${tdCls} font-semibold text-primary`}>{l.level || "—"}</td>
                    <td className={tdCls}>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={l.result} />
                        {l.pending && (
                          /* AI session awaiting the candidate — 3-dot AI pulse */
                          <AiThinking label="In progress" />
                        )}
                      </div>
                    </td>
                    <td className={`${tdCls} text-right font-semibold tabular-nums text-primary`}>
                      {fmtScore(l.overall_score_percent)}
                    </td>
                    <td className={tdCls}>{fmtDate(l.completed_at)}</td>
                    <td className={tdCls}>
                      <div className="flex items-center gap-3">
                        {l.report_link && (
                          <a
                            href={l.report_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline dark:text-brand-300"
                          >
                            Full report <ExternalLink size={13} />
                          </a>
                        )}
                        {l.pending && (
                          <button
                            className="inline-flex items-center gap-1 font-semibold text-secondary hover:underline"
                            onClick={() =>
                              copyText(`${window.location.origin}/?invite=${l.invite_token}`, "Invite link")
                            }
                          >
                            <Copy size={13} /> Copy invite link
                          </button>
                        )}
                        {!l.report_link && !l.pending && <span className="text-muted">—</span>}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showConfirm && (
        <ConfirmModal
          title="Trigger AI Interview"
          message="Schedules a new AI L1 interview session for this candidate. The invite link and access key will be shown once scheduling succeeds."
          confirmLabel="Schedule interview"
          busy={scheduling}
          onConfirm={trigger}
          onClose={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
