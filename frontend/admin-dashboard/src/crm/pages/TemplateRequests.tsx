/** Interview-template request workflow (TA raises → RMG fulfils → TA prepares L1). */
import { useCallback, useEffect, useState } from "react";
import { Check, LayoutTemplate, RefreshCw, Send, X } from "lucide-react";
import { apiGet } from "../../api/client";
import { crmGet, crmPost, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { crmNavigate } from "../routerHooks";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import {
  ErrorBox, Field, Modal, StatusBadge, Tabs,
  btnDanger, btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";

type TR = {
  id: number;
  tr_number: string;
  requirement_id: number;
  requirement_number: string | null;
  requirement_title: string | null;
  opportunity_id?: number | null;
  opportunity_opp_id?: string | null;
  opportunity_title?: string | null;
  role_title: string;
  skills: string | null;
  experience_level: string | null;
  notes: string | null;
  status: string;
  template_name: string | null;
  template_job_id: string | null;
  candidate_name: string | null;
  candidate_email: string | null;
  created_at: string | null;
};

type JobTpl = { jobId: string; jobTitle: string; opportunityId?: string; domain?: string };

const TABS = [
  { key: "Pending_RMG", label: "Pending (RMG)" },
  { key: "Template_Ready", label: "Ready (TA)" },
  { key: "Prepared", label: "Prepared" },
  { key: "all", label: "All" },
];

const PREFILL_OPP_KEY = "crm_prefill_opportunityId";

/** Leave CRM and open Templates; optionally prefill Opportunity ID on the form. */
function goToTemplatesTab(opportunityOppId?: string | null) {
  try {
    if (opportunityOppId) sessionStorage.setItem(PREFILL_OPP_KEY, opportunityOppId);
  } catch { /* ignore */ }
  const params = new URLSearchParams(window.location.search);
  params.set("view", "templates");
  params.delete("p");
  window.history.pushState({}, "", `${window.location.pathname}?${params.toString()}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function TemplateRequestsPage() {
  const isRMG = useHasRole("RMG");
  const isTA = useHasRole("TA");
  const [tab, setTab] = useState("Pending_RMG");
  const [rows, setRows] = useState<TR[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, showToast] = useToast();
  const [fulfillRow, setFulfillRow] = useState<TR | null>(null);
  const [prepareRow, setPrepareRow] = useState<TR | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = tab === "all" ? { page, limit: 20 } : { status: tab, page, limit: 20 };
      const res = await crmGet<TR[]>(`/api/template-requests${qs(query)}`);
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load template requests");
    } finally {
      setLoading(false);
    }
  }, [tab, page]);
  useEffect(() => { load(); }, [load]);

  const cancel = async (r: TR) => {
    if (!window.confirm(`Cancel template request ${r.tr_number}?`)) return;
    setBusyId(r.id);
    try {
      await crmPost(`/api/template-requests/${r.id}/cancel`);
      showToast("Request cancelled");
      load();
    } catch (e: any) {
      showToast(e?.message || "Cancel failed", "err");
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<TR>[] = [
    { key: "tr_number", label: "Request", render: (r) => <span className="font-semibold">{r.tr_number}</span> },
    {
      key: "role_title", label: "Role / Requirement",
      render: (r) => (
        <div>
          <div className="font-semibold text-primary">{r.role_title}</div>
          {r.requirement_number && (
            <button
              className="text-xs text-brand-600 hover:underline dark:text-brand-300"
              onClick={(e) => { e.stopPropagation(); crmNavigate(`requirements/${r.requirement_id}`); }}
            >
              {r.requirement_number}
            </button>
          )}
          {r.opportunity_opp_id && (
            <div className="text-xs text-muted">
              Opp {r.opportunity_opp_id}{r.opportunity_title ? ` — ${r.opportunity_title}` : ""}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "skills", label: "Skills / Exp",
      render: (r) => (
        <div className="max-w-xs text-xs text-muted">
          <div className="truncate" title={r.skills || ""}>{r.skills || "—"}</div>
          {r.experience_level && <div>Exp: {r.experience_level}</div>}
        </div>
      ),
    },
    {
      key: "template_name", label: "Template",
      render: (r) => (r.template_name ? (
        <div>
          <div className="font-medium">{r.template_name}</div>
          {r.template_job_id && <div className="font-mono text-xs text-muted">{r.template_job_id}</div>}
        </div>
      ) : <span className="text-muted">—</span>),
    },
    {
      key: "candidate_email", label: "Candidate",
      render: (r) => (r.candidate_email ? (
        <div className="text-xs">
          <div className="font-medium text-primary">{r.candidate_name || "—"}</div>
          <div className="text-muted">{r.candidate_email}</div>
        </div>
      ) : <span className="text-muted">—</span>),
    },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "_actions", label: "Actions",
      render: (r) => (
        <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
          {isRMG && r.status === "Pending_RMG" && (
            <>
              <button
                className={btnSecondary}
                title="Open the Templates tab to build this interview template"
                onClick={() => goToTemplatesTab(r.opportunity_opp_id)}
                disabled={busyId === r.id}
              >
                <LayoutTemplate size={13} /> Create template
              </button>
              <button className={btnPrimary} onClick={() => setFulfillRow(r)} disabled={busyId === r.id}>
                <Check size={13} /> Fulfil
              </button>
            </>
          )}
          {isTA && r.status === "Template_Ready" && (
            <button className={btnPrimary} onClick={() => setPrepareRow(r)} disabled={busyId === r.id}>
              <Send size={13} /> Prepare L1
            </button>
          )}
          {isTA && (r.status === "Pending_RMG" || r.status === "Template_Ready") && (
            <button className={btnDanger} onClick={() => cancel(r)} disabled={busyId === r.id}>
              <X size={13} /> Cancel
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-display text-xl font-bold text-primary">Template Requests</h1>
        <p className="text-sm text-muted">
          TA requests an interview template → RMG links a real template to the opportunity → TA triggers AI L1 (link shown, not auto-sent).
        </p>
      </div>

      <div className="mb-4">
        <Tabs tabs={TABS} active={tab} onChange={(k) => { setTab(k); setPage(1); }} />
      </div>

      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : (
        <DataTable<TR>
          columns={columns}
          rows={rows}
          meta={meta}
          loading={loading}
          onPage={setPage}
          emptyMessage="No template requests in this view"
        />
      )}

      {fulfillRow && (
        <FulfillModal row={fulfillRow} onClose={() => setFulfillRow(null)} onDone={() => { setFulfillRow(null); load(); }} toast={showToast} />
      )}
      {prepareRow && (
        <PrepareModal row={prepareRow} onClose={() => setPrepareRow(null)} onDone={() => { setPrepareRow(null); load(); }} toast={showToast} />
      )}
      {toast}
    </div>
  );
}

function FulfillModal({ row, onClose, onDone, toast }: {
  row: TR; onClose: () => void; onDone: () => void; toast: (m: string, k?: "ok" | "err") => void;
}) {
  const [jobs, setJobs] = useState<JobTpl[]>([]);
  const [jobId, setJobId] = useState("");
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const loadJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const data = await apiGet<{ jobs: JobTpl[] }>("/job/configs", { force: true });
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load templates");
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const selected = jobs.find((j) => j.jobId === jobId);

  const submit = async () => {
    if (!jobId) { setErr("Select a template"); return; }
    setBusy(true);
    setErr("");
    try {
      await crmPost(`/api/template-requests/${row.id}/fulfill`, {
        template_job_id: jobId,
        template_name: selected?.jobTitle || null,
      });
      toast(`Template linked to ${row.tr_number} / ${row.opportunity_opp_id || "opportunity"}`);
      onDone();
    } catch (e: any) {
      setErr(e?.message || "Fulfil failed");
      setBusy(false);
    }
  };

  return (
    <Modal title={`Fulfil ${row.tr_number} — ${row.role_title}`} onClose={onClose} fullScreen>
      <p className="mb-3 text-sm text-secondary">
        Pick an existing interview template. Fulfil stamps its Opportunity ID to{" "}
        <strong>{row.opportunity_opp_id || "the opportunity"}</strong> so AI L1 uses it.
        Skills: {row.skills || "n/a"} · Exp: {row.experience_level || "n/a"}.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={btnSecondary}
          onClick={() => goToTemplatesTab(row.opportunity_opp_id)}
          title="Opens Templates — Opportunity ID is prefilled when you create a new template"
        >
          <LayoutTemplate size={14} /> Create template in Templates tab →
        </button>
        <button type="button" className={btnSecondary} onClick={loadJobs} disabled={loadingJobs}>
          <RefreshCw size={14} /> Refresh list
        </button>
      </div>
      <div className="space-y-3">
        <Field label="Interview template" required error={err}>
          <select
            className={inputCls}
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            disabled={loadingJobs}
          >
            <option value="">{loadingJobs ? "Loading templates…" : "Select a template…"}</option>
            {jobs.map((j) => (
              <option key={j.jobId} value={j.jobId}>
                {j.jobTitle || j.jobId} ({j.jobId})
                {j.opportunityId ? ` · opp ${j.opportunityId}` : ""}
              </option>
            ))}
          </select>
        </Field>
        {selected && (
          <div className="rounded-card border border-subtle bg-surface-2 px-3 py-2 text-xs text-secondary">
            Will link <strong>{selected.jobTitle}</strong> → opportunity{" "}
            <strong>{row.opportunity_opp_id || "—"}</strong>
          </div>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={btnPrimary} onClick={submit} disabled={busy || !jobId}>
          {busy ? "Linking…" : "Link template"}
        </button>
      </div>
    </Modal>
  );
}

function PrepareModal({ row, onClose, onDone, toast }: {
  row: TR; onClose: () => void; onDone: () => void; toast: (m: string, k?: "ok" | "err") => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErr("Enter a valid candidate email"); return; }
    setBusy(true);
    try {
      const res = await crmPost(`/api/template-requests/${row.id}/prepare`, {
        candidate_email: email.trim(),
        candidate_name: name.trim() || null,
      });
      toast(res.message || "L1 prepared");
      onDone();
    } catch (e: any) {
      setErr(e?.message || "Prepare failed");
      setBusy(false);
    }
  };

  return (
    <Modal title={`Prepare L1 — ${row.tr_number}`} onClose={onClose} fullScreen>
      <p className="mb-3 text-sm text-secondary">
        Template <strong>{row.template_name}</strong>
        {row.template_job_id ? ` (${row.template_job_id})` : ""} is linked.
        Generate the invite from Schedule AI L1 — the link is shown on the page (not auto-sent).
      </p>
      <div className="space-y-3">
        <Field label="Candidate email" required error={err}>
          <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="candidate@email.com" />
        </Field>
        <Field label="Candidate name (optional)">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={btnPrimary} onClick={submit} disabled={busy}>
          {busy ? "Preparing…" : "Prepare L1"}
        </button>
      </div>
    </Modal>
  );
}
