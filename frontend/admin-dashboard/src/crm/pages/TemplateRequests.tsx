/** Interview-template request workflow (TA raises → RMG fulfils → TA prepares L1). */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, FileText, LayoutTemplate, RefreshCw, Send, X } from "lucide-react";
import { apiGet } from "../../api/client";
import { crmGet, crmPost, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanAct } from "../useAccess";
import { crmNavigate } from "../routerHooks";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { RowActions, afterListDelete } from "../components/RowActions";
import {
  ConfirmModal, ErrorBox, Modal, StatusBadge, Tabs,
  btnDanger, btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";
import { SectionHeaderBanner, WizardField, InfoChip } from "../components/wizard";

/** Same debounce as the Requirements list — one fetch per pause, not per key. */
function useDebounced(value: string, ms = 350): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Local single-screen shell — applies the shared New Opportunity wizard look
 * (theme-aware body + SectionHeaderBanner) inside the existing Modal.
 * Visual-only wrapper: no field, state, or submit logic lives here. */
function WizFormShell({
  title, subtitle, icon, children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  children: ReactNode;
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
const PREFILL_TEMPLATE_KEY = "crm_prefill_template";

/** Parse "3-7 yrs" / "3-+" style experience_level into [min, max]. */
function parseExpLevel(level?: string | null): [number, number] {
  const m = /([\d.]+)\s*-\s*([\d.]+)?/.exec(String(level || ""));
  const lo = m ? Math.round(Number(m[1]) || 0) : 0;
  const hi = m && m[2] ? Math.round(Number(m[2]) || 0) : 0;
  return [lo, hi];
}

function goToTemplatesTab(row?: TR | null) {
  // Rich prefill (Aug 2026): carry the request's role / skills / experience /
  // customer into the new-template form so RMG types nothing twice. The old
  // opp-id-only key stays for back-compat.
  try {
    if (row?.opportunity_opp_id) sessionStorage.setItem(PREFILL_OPP_KEY, row.opportunity_opp_id);
    if (row) {
      const [expMin, expMax] = parseExpLevel(row.experience_level);
      sessionStorage.setItem(PREFILL_TEMPLATE_KEY, JSON.stringify({
        opportunityId: row.opportunity_opp_id || "",
        jobTitle: row.role_title || row.requirement_title || "",
        requiredSkills: row.skills || "",
        customerName: (row as any).customer_name || "",
        expMin, expMax,
      }));
    }
    // Ask the shell to open the CREATE form directly — landing on the list and
    // clicking "Create Template" again was a pointless extra hop for RMG.
    sessionStorage.setItem("crm_open_template_form", "1");
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
  const canWrite = useCanAct("template-requests", "edit", isRMG || isTA);
  const [tab, setTab] = useState("Pending_RMG");
  const [rows, setRows] = useState<TR[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, showToast] = useToast();
  const [fulfillRow, setFulfillRow] = useState<TR | null>(null);
  const [prepareRow, setPrepareRow] = useState<TR | null>(null);
  const [cancelRow, setCancelRow] = useState<TR | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  /* Filters (25 Aug 2026): search by role/TR number — server-side, the list
   * is paginated. */
  const [search, setSearch] = useState("");
  const dq = useDebounced(search);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = {
        page, limit: 20,
        status: tab === "all" ? undefined : tab,
        search: dq || undefined,
      };
      const res = await crmGet<TR[]>(`/api/template-requests${qs(query)}`);
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load template requests");
    } finally {
      setLoading(false);
    }
  }, [tab, page, dq]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [tab, dq]);

  const confirmCancel = async () => {
    if (!cancelRow) return;
    const r = cancelRow;
    setBusyId(r.id);
    try {
      await crmPost(`/api/template-requests/${r.id}/cancel`);
      showToast("Request cancelled");
      setCancelRow(null);
      afterListDelete(r.id, setRows, load);
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
          {/* ONE id everywhere (18 Aug 2026 rule): the opportunity's opp_id is
              the number every role quotes — REQ-xxxx is internal and never
              shown. The link still lands on the requirement detail page. */}
          {r.requirement_id != null && (
            <button
              className="text-xs text-brand-600 hover:underline dark:text-brand-300"
              onClick={(e) => { e.stopPropagation(); crmNavigate(`requirements/${r.requirement_id}`); }}
            >
              {r.opportunity_opp_id || "Open requirement"}
              {r.opportunity_title ? ` — ${r.opportunity_title}` : ""}
            </button>
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
                onClick={() => goToTemplatesTab(r)}
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
            <button className={btnDanger} onClick={() => setCancelRow(r)} disabled={busyId === r.id}>
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
          headerRight={meta ? <span className="whitespace-nowrap text-xs font-medium text-muted">{meta.total} {meta.total === 1 ? "request" : "requests"}, page {meta.page}/{Math.max(1, meta.pages || 1)}</span> : undefined}
          loading={loading}
          search={search}
          onSearch={setSearch}
          onPage={setPage}
          emptyMessage="No template requests in this view"
          rowActions={canWrite ? (r) => (
            <RowActions
              entity="template request"
              itemLabel={r.tr_number}
              deleteUrl={`/api/template-requests/${r.id}`}
              onDeleted={() => afterListDelete(r.id, setRows, load)}
              notify={showToast}
              canEdit={false}
              canDelete
            colored />
          ) : undefined}
        />
      )}

      {fulfillRow && (
        <FulfillModal row={fulfillRow} onClose={() => setFulfillRow(null)} onDone={() => { setFulfillRow(null); load(); }} toast={showToast} />
      )}
      {prepareRow && (
        <PrepareModal row={prepareRow} onClose={() => setPrepareRow(null)} onDone={() => { setPrepareRow(null); load(); }} toast={showToast} />
      )}
      {cancelRow && (
        <ConfirmModal
          title="Cancel template request?"
          message={<>Do you want to cancel template request <b>{cancelRow.tr_number}</b>?</>}
          confirmLabel="Cancel request"
          danger
          busy={busyId === cancelRow.id}
          onConfirm={() => { void confirmCancel(); }}
          onClose={() => { if (busyId !== cancelRow.id) setCancelRow(null); }}
        />
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
    <Modal
      title={<span className="sr-only">{`Fulfil ${row.tr_number} — ${row.role_title}`}</span>}
      onClose={onClose}
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title={`Fulfil ${row.tr_number} — ${row.role_title}`}
        subtitle="Link an existing interview template so AI L1 uses it for this opportunity."
        icon={<FileText size={20} aria-hidden />}
      >
        <p className="mb-4 text-sm text-secondary">
          Pick an existing interview template. Fulfil stamps its Opportunity ID to{" "}
          <strong>{row.opportunity_opp_id || "the opportunity"}</strong> so AI L1 uses it.
          Skills: {row.skills || "n/a"} · Exp: {row.experience_level || "n/a"}.
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={btnSecondary}
            onClick={() => goToTemplatesTab(row)}
            title="Opens Templates — Opportunity ID is prefilled when you create a new template"
          >
            <LayoutTemplate size={14} /> Create template in Templates tab →
          </button>
          <button type="button" className={btnSecondary} onClick={loadJobs} disabled={loadingJobs}>
            <RefreshCw size={14} /> Refresh list
          </button>
        </div>
        <div className="space-y-5">
          <WizardField label="Interview template" required error={err}>
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
          </WizardField>
          {selected && (
            <InfoChip>
              Will link <strong>{selected.jobTitle}</strong> → opportunity{" "}
              <strong>{row.opportunity_opp_id || "—"}</strong>
            </InfoChip>
          )}
        </div>
        <div className={wizFooterRow}>
          <button className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`} onClick={submit} disabled={busy || !jobId}>
            {busy ? "Linking…" : "Link template"}
          </button>
        </div>
      </WizFormShell>
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
    <Modal
      title={<span className="sr-only">{`Prepare L1 — ${row.tr_number}`}</span>}
      onClose={onClose}
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title={`Prepare L1 — ${row.tr_number}`}
        subtitle="Generate the AI L1 invite — the link is shown on the page (not auto-sent)."
        icon={<FileText size={20} aria-hidden />}
      >
        <p className="mb-4 text-sm text-secondary">
          Template <strong>{row.template_name}</strong>
          {row.template_job_id ? ` (${row.template_job_id})` : ""} is linked.
          Generate the invite from Schedule AI L1 — the link is shown on the page (not auto-sent).
        </p>
        <div className="space-y-5">
          <WizardField label="Candidate email" required error={err} icon="mail" filled={/^\S+@\S+\.\S+$/.test(email.trim())}>
            <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="candidate@email.com" />
          </WizardField>
          <WizardField label="Candidate name (optional)" icon="user" filled={!!name.trim()}>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          </WizardField>
        </div>
        <div className={wizFooterRow}>
          <button className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`} onClick={submit} disabled={busy}>
            {busy ? "Preparing…" : "Prepare L1"}
          </button>
        </div>
      </WizFormShell>
    </Modal>
  );
}
