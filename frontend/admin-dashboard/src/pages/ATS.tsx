type AtsResult = {
  atsScore?: number;
  grade?: string;
  hireProbability?: string;
  strongSkills?: string[];
  missingSkills?: string[];
  recommendation?: string;
  meta?: any;
};
import { useMemo, useState } from "react";
import { AlertTriangle, Calculator, FileText, RefreshCw, Sparkles, UploadCloud, X } from "lucide-react";
import { authFetch } from "../api/client";
import { AiThinking, btnPrimary, btnSecondary, focusRing } from "../crm/components/ui";

function formatBytes(bytes: number) {
  const b = Number(bytes || 0);
  if (!Number.isFinite(b) || b <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Visual-only helper: maps a score/grade/probability value onto the semantic
 * text scale (success / warning / danger bands — bands unchanged, style only). */
function scoreTone(value: string): string {
  const v = String(value || "").trim();
  if (!v || v === "—") return "text-primary";
  const n = Number(v.replace(/%$/, ""));
  if (Number.isFinite(n)) return n >= 75 ? "text-success" : n >= 50 ? "text-warning" : "text-danger";
  if (/high/i.test(v)) return "text-success";
  if (/medium|moderate/i.test(v)) return "text-warning";
  if (/low/i.test(v)) return "text-danger";
  if (/^a/i.test(v)) return "text-success";
  if (/^b/i.test(v)) return "text-primary";
  if (/^c/i.test(v)) return "text-warning";
  if (/^[df]/i.test(v)) return "text-danger";
  return "text-primary";
}

function StatTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="glass fx-gradient-border fx-lift rounded-card p-5 shadow-raised">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
          <div className={`text-display mt-2 text-2xl font-bold tracking-tight tabular-nums ${scoreTone(value)}`}>
            {value}
          </div>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-surface-2 text-brand-600 ring-1 ring-inset ring-subtle dark:text-brand-300">
          {icon}
        </div>
      </div>
    </div>
  );
}

export function AtsPage() {
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<AtsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [cvFile, setCvFile] = useState<File | null>(null);

  const canCompute = useMemo(() => Boolean(jdFile && cvFile && !busy), [jdFile, cvFile, busy]);

  const compute = async () => {
    if (!jdFile || !cvFile) return;
    setBusy(true);
    try {
      setError("");
      setPreview(null);
      const fd = new FormData();
      fd.append("jd_file", jdFile);
      fd.append("cv_file", cvFile);
      fd.append("model", "gpt-4o-mini");
      const res = await authFetch("/ats/score/upload", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || `ATS failed (${res.status})`);
      setPreview(data as AtsResult);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const fileCardCls =
    "rounded-card border border-subtle bg-surface-1 p-4 transition-colors duration-micro ease-smooth hover:bg-surface-2";
  const fileInputCls =
    "block w-full text-sm text-secondary file:mr-3 file:rounded-control file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:font-semibold file:text-white file:transition-opacity file:duration-micro hover:file:opacity-90";

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-display text-2xl font-bold tracking-tight text-primary">ATS Scoring</h1>
          <p className="mt-1 text-sm text-muted">Upload JD and CV to compute ATS score</p>
        </div>
        <div className="flex items-center gap-2">
          {(jdFile || cvFile) && !busy ? (
            <button
              onClick={() => {
                setJdFile(null);
                setCvFile(null);
                setPreview(null);
                setError("");
              }}
              className={btnSecondary}
            >
              <X className="h-4 w-4" />
              Clear
            </button>
          ) : null}
          <button onClick={compute} disabled={!canCompute} className={btnPrimary}>
            <Sparkles className="h-4 w-4" />
            {busy ? "Computing…" : "Compute ATS Score"}
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="glass rounded-card p-6 shadow-raised lg:col-span-7">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-surface-2 text-brand-600 ring-1 ring-inset ring-subtle dark:text-brand-300">
              <UploadCloud className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold tracking-tight text-primary">Upload documents</div>
              <div className="mt-0.5 text-xs text-muted">
                Upload JD and CV. The server extracts text and scores using OpenAI when available.
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className={fileCardCls}>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">Job Description (JD)</div>
              <label className="mt-3 block">
                <input type="file" onChange={(e) => setJdFile(e.target.files?.[0] || null)} className={fileInputCls} />
              </label>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                <FileText className="h-4 w-4" />
                <span className="truncate">{jdFile ? jdFile.name : "No file selected"}</span>
                {jdFile ? <span>• {formatBytes(jdFile.size)}</span> : null}
              </div>
            </div>

            <div className={fileCardCls}>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">Candidate CV</div>
              <label className="mt-3 block">
                <input type="file" onChange={(e) => setCvFile(e.target.files?.[0] || null)} className={fileInputCls} />
              </label>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                <FileText className="h-4 w-4" />
                <span className="truncate">{cvFile ? cvFile.name : "No file selected"}</span>
                {cvFile ? <span>• {formatBytes(cvFile.size)}</span> : null}
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted">Tip: Use PDF/DOCX/TXT/Images. Larger docs may take longer.</div>
            <div className="text-xs text-muted">
              Endpoint: <span className="font-mono">/ats/score/upload</span>
            </div>
          </div>
        </div>

        {/* Score panel — AI surface: animated gradient border while the scan runs,
            resting gradient border + glow once AI output is present. */}
        <div
          className={`rounded-card p-6 lg:col-span-5 ${
            busy ? "fx-gradient-border-animated bg-surface-1 shadow-raised" : preview ? "ai-surface" : "border border-subtle bg-surface-1"
          }`}
        >
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-surface-2 text-brand-600 ring-1 ring-inset ring-subtle dark:text-brand-300">
              <Calculator className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-bold tracking-tight text-primary">Results</div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-accent-600 ring-1 ring-inset ring-subtle dark:text-accent-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden />
                  AI Analysis
                </span>
              </div>
              <div className="mt-0.5 text-xs text-muted">ATS score and key gaps</div>
            </div>
          </div>

          {busy ? (
            /* loading — shimmer skeleton + AI thinking pulse */
            <div className="mt-5 space-y-3" aria-busy="true">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="shimmer h-24 rounded-card" />
                ))}
              </div>
              <div className="shimmer h-16 rounded-card" />
              <div className="shimmer h-16 rounded-card" />
              <AiThinking label="Scoring the CV against the JD…" />
            </div>
          ) : error ? (
            /* error — message + Retry */
            <div className="mt-5 flex flex-col items-center gap-3 rounded-card border border-subtle bg-danger-soft p-6 text-center">
              <AlertTriangle className="h-6 w-6 text-danger" />
              <div className="font-bold text-danger">ATS scoring failed</div>
              <div className="text-sm text-danger">{error}</div>
              <button
                onClick={compute}
                disabled={!canCompute}
                className={`inline-flex items-center gap-2 rounded-control bg-danger-solid px-3.5 py-2 text-sm font-semibold text-white transition-colors duration-micro ease-smooth hover:bg-danger-solid-hover disabled:opacity-60 ${focusRing}`}
              >
                <RefreshCw className="h-4 w-4" /> Retry
              </button>
            </div>
          ) : !preview ? (
            /* empty — designed empty state */
            <div className="mt-5 flex flex-col items-center gap-3 rounded-card border-2 border-dashed border-subtle p-8 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full text-white shadow-raised [background:var(--ai-gradient)]">
                <Sparkles className="h-6 w-6" />
              </span>
              <div className="text-sm font-bold tracking-tight text-primary">No score yet</div>
              <p className="max-w-xs text-sm text-muted">Upload a JD and a CV, then compute to see the AI match score.</p>
              <button onClick={compute} disabled={!canCompute} className={btnPrimary}>
                <Sparkles className="h-4 w-4" /> Compute ATS Score
              </button>
            </div>
          ) : (
            /* success */
            <>
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatTile label="ATS score" value={preview.atsScore !== undefined ? String(preview.atsScore) : "—"} icon={<Calculator className="h-5 w-5" />} />
                <StatTile label="Grade" value={preview.grade || "—"} icon={<Sparkles className="h-5 w-5" />} />
                <StatTile label="Hire probability" value={preview.hireProbability || "—"} icon={<Sparkles className="h-5 w-5" />} />
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3">
                <div className="rounded-card border border-subtle bg-success-soft p-4">
                  <div className="fx-hairline-b pb-2 text-xs font-semibold uppercase tracking-wide text-success">Strong skills</div>
                  <div className="mt-2 text-sm text-secondary">
                    {(preview.strongSkills || []).length ? (preview.strongSkills || []).join(", ") : "—"}
                  </div>
                </div>
                <div className="rounded-card border border-subtle bg-danger-soft p-4">
                  <div className="fx-hairline-b pb-2 text-xs font-semibold uppercase tracking-wide text-danger">Missing skills</div>
                  <div className="mt-2 text-sm text-secondary">
                    {(preview.missingSkills || []).length ? (preview.missingSkills || []).join(", ") : "—"}
                  </div>
                </div>
                {preview.recommendation ? (
                  <div className="rounded-card border border-subtle bg-surface-1 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">Recommendation</div>
                    <div className="mt-2 text-sm text-secondary">{preview.recommendation}</div>
                  </div>
                ) : null}
                {preview.meta?.mode ? (
                  <div className="text-xs text-muted">
                    Mode: <span className="font-semibold text-secondary">{String(preview.meta.mode)}</span>
                    {preview.meta.model ? (
                      <>
                        {" "}
                        • Model: <span className="font-semibold text-secondary">{String(preview.meta.model)}</span>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
