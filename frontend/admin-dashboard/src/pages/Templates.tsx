import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
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
};

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

  const sorted = useMemo(() => {
    return [...(jobs || [])].sort((a, b) => String(a.jobTitle || "").localeCompare(String(b.jobTitle || "")));
  }, [jobs]);

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
                return (
                  <div className="mb-3 flex items-center gap-2 flex-wrap">
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
