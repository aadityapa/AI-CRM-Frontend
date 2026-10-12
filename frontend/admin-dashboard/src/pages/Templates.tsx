import { useEffect, useMemo, useState } from "react";
import { Archive, ArrowUpRight, Layers, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { apiDelete, apiGet } from "../api/client";
import { FadeInUp, Stagger } from "../crm/components/motion3d";
import { btnPrimary, btnSecondary, Spinner } from "../crm/components/ui";

type JobConfig = {
  jobId: string;
  jobTitle: string;
  domain?: string;
  opportunityId?: string;
  customerName?: string;
  requiredSkills?: string[];
  optionalSkills?: string[];
  expMin?: number;
  expMax?: number;
  generatedPrompt?: string;
  editedPrompt?: string;
  weights?: Record<string, unknown>;
  /** 10 Oct 2026: derived from the linked opportunity — closed / rejected / archived deal. */
  archived?: boolean;
  archived_reason?: string | null;
  opportunity_stage?: string | null;
};

type TemplateTab = "active" | "archive";

/** PURE: how many questions a template's skill-wise bank holds (0 when off). */
function skillBankSize(weights: Record<string, unknown> | undefined): number {
  const bank = (weights || {})["skillBank"] as { enabled?: unknown; questions?: unknown[] } | undefined;
  if (!bank || !(bank.enabled === true || String(bank.enabled) === "true")) return 0;
  return Array.isArray(bank.questions) ? bank.questions.length : 0;
}

export function TemplatesPage({
  onCreateTemplate,
  onEditTemplate,
}: {
  onCreateTemplate: () => void;
  onEditTemplate: (jobId: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<JobConfig[]>([]);
  const [deletingId, setDeletingId] = useState<string>("");
  const [tab, setTab] = useState<TemplateTab>("active");

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const data = await apiGet<{ jobs: JobConfig[] }>("/job/configs", { force: true });
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const archivedCount = useMemo(() => (jobs || []).filter((j) => j.archived).length, [jobs]);
  const sorted = useMemo(() => {
    return [...(jobs || [])]
      .filter((j) => (tab === "archive" ? !!j.archived : !j.archived))
      .sort((a, b) => String(a.jobTitle || "").localeCompare(String(b.jobTitle || "")));
  }, [jobs, tab]);

  const deleteTemplate = async (jobId: string) => {
    const ok = window.confirm("Delete this template? This cannot be undone.");
    if (!ok) return;
    try {
      setDeletingId(jobId);
      setError("");
      await apiDelete<{ status: string; jobId: string }>(`/job/config/${encodeURIComponent(jobId)}`);
      await load();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setDeletingId("");
    }
  };

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-start sm:items-center justify-between gap-4 flex-col sm:flex-row">
        <div>
          <h1 className="text-display text-2xl font-bold tracking-tight text-primary">Interview Templates</h1>
          <p className="text-muted text-sm mt-1">Create and manage job templates used in HR setup and ATS scoring.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className={btnSecondary} disabled={loading}>
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button onClick={onCreateTemplate} className={btnPrimary}>
            <Plus className="w-4 h-4" />
            Create Template
          </button>
        </div>
      </div>

      <div className="mt-5 inline-flex rounded-control border border-subtle bg-surface-2 p-1" role="tablist" aria-label="Templates">
        {([
          ["active", "Active", (jobs || []).length - archivedCount],
          ["archive", "Archive", archivedCount],
        ] as [TemplateTab, string, number][]).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`inline-flex h-9 items-center gap-2 rounded-control px-4 text-sm font-bold transition-colors ${
              tab === key ? "bg-surface-1 text-primary shadow-raised" : "text-secondary hover:text-primary"
            }`}
          >
            {key === "archive" ? <Archive className="h-4 w-4" aria-hidden /> : null}
            {label}
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-extrabold text-secondary ring-1 ring-inset ring-subtle">{count}</span>
          </button>
        ))}
      </div>
      {tab === "archive" ? (
        <p className="mt-2 text-xs text-muted">
          Templates of opportunities that are closed, rejected or archived. They cannot be used for a new AI interview and
          return to Active by themselves when Sales reopens the opportunity.
        </p>
      ) : null}

      {error ? (
        <div className="mt-6 rounded-card border border-subtle bg-danger-soft p-6 text-danger">
          <div className="font-extrabold">Templates error</div>
          <div className="mt-2 text-sm">{error}</div>
        </div>
      ) : null}

      {loading ? (
        <FadeInUp className="mt-6">
          <div className="rounded-card border border-subtle bg-surface-1 p-8">
            <Spinner label="Loading templates…" />
          </div>
        </FadeInUp>
      ) : !sorted.length && tab === "archive" ? (
        <div className="mt-6 rounded-card border border-subtle bg-surface-1 p-8 text-sm text-muted">
          No archived templates — every template's opportunity is still open.
        </div>
      ) : !sorted.length ? (
        <FadeInUp className="mt-6">
          <div className="glass rounded-card p-8 shadow-raised">
            <div className="flex items-start gap-4">
              <div className="fx-glow flex h-11 w-11 items-center justify-center rounded-card bg-gradient-to-br from-brand-600 to-violet-600">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="text-lg font-extrabold tracking-tight text-primary">No templates yet</div>
                <div className="mt-1 text-sm text-muted">
                  Create your first job template. HR will be able to choose it in the HR Setup screen.
                </div>
                <button onClick={onCreateTemplate} className={`mt-4 ${btnPrimary}`}>
                  <Plus className="w-4 h-4" />
                  Create Template
                </button>
              </div>
            </div>
          </div>
        </FadeInUp>
      ) : (
        <Stagger className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" interval={0.05}>
          {sorted.map((j) => (
            <div key={j.jobId} className="fx-lift h-full rounded-card border border-subtle bg-surface-1 p-5 shadow-raised">
              {(() => {
                const hasCustomPrompt = Boolean(String(j.editedPrompt || "").trim());
                const adaptiveEnabled = Boolean((j.weights || {})["adaptiveNextQuestion"]);
                const bankSize = skillBankSize(j.weights);
                return (
                  <div className="mb-3 flex items-center gap-2 flex-wrap">
                    {j.archived ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ring-1 ring-inset ring-subtle bg-surface-2 text-secondary" title={j.archived_reason || ""}>
                        <Archive className="h-3 w-3" aria-hidden /> Archived
                      </span>
                    ) : null}
                    {bankSize ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ring-1 ring-inset ring-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800">
                        <Layers className="h-3 w-3" aria-hidden /> Skill bank · {bankSize}
                      </span>
                    ) : null}
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ring-1 ring-inset ring-subtle ${
                        hasCustomPrompt ? "bg-brand-50 text-brand-700 dark:bg-brand-900 dark:text-brand-200" : "bg-surface-2 text-secondary"
                      }`}
                    >
                      {hasCustomPrompt ? "Custom Prompt" : "Default Prompt"}
                    </span>
                    {adaptiveEnabled ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ring-1 ring-inset ring-subtle bg-success-soft text-success">
                        Adaptive
                      </span>
                    ) : null}
                  </div>
                );
              })()}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-lg font-extrabold tracking-tight text-primary truncate">{j.jobTitle || "Untitled"}</div>
                  <div className="mt-1 text-xs text-muted truncate">{j.domain || "No domain"}</div>
                  <div className="mt-3 text-xs text-muted space-y-1">
                    <div><span className="font-bold text-secondary">Opportunity:</span> {j.opportunityId || "—"}</div>
                    <div><span className="font-bold text-secondary">Customer:</span> {j.customerName || "—"}</div>
                    <div><span className="font-bold text-secondary">Required:</span> {(j.requiredSkills || []).slice(0, 8).join(", ") || "—"}</div>
                    <div><span className="font-bold text-secondary">Optional:</span> {(j.optionalSkills || []).slice(0, 8).join(", ") || "—"}</div>
                    <div><span className="font-bold text-secondary">Experience:</span> {j.expMin ?? 0}–{j.expMax ?? 0} yrs</div>
                    {j.archived && j.archived_reason ? (
                      <div className="font-semibold text-secondary">{j.archived_reason} — reopen it to use this template.</div>
                    ) : null}
                  </div>
                </div>
                <button
                  onClick={() => onEditTemplate(j.jobId)}
                  className="inline-flex h-10 items-center gap-2 rounded-control border border-subtle bg-surface-1 px-3 font-semibold text-secondary transition-colors duration-micro ease-smooth hover:border-strong hover:bg-surface-2 hover:text-primary"
                >
                  <Pencil className="w-4 h-4 text-brand-600 dark:text-brand-300" />
                  Edit
                </button>
              </div>

              <div className="mt-4 text-xs text-muted">
                Job ID: <span className="font-mono">{j.jobId}</span>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <a
                  className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 transition-colors duration-micro ease-smooth hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200"
                  href="/?focus=template"
                  target="_blank"
                  rel="noreferrer"
                >
                  Use in HR Setup <ArrowUpRight className="w-4 h-4" />
                </a>
                <button
                  onClick={() => deleteTemplate(j.jobId)}
                  disabled={deletingId === j.jobId}
                  className="flex h-9 w-9 items-center justify-center rounded-control border border-subtle bg-surface-1 text-muted transition-colors duration-micro ease-smooth hover:bg-danger-soft hover:text-danger disabled:opacity-60"
                  title="Delete template"
                  aria-label="Delete template"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </Stagger>
      )}
    </div>
  );
}
