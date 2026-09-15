/**
 * Settings ▸ Backup — one-click full data backup (Admin / CEO only).
 *
 * Pick the tabs (datasets) to include — or everything — and generate ONE ZIP
 * with every table as Excel / CSV / JSON plus all attached files (CVs, offer
 * letters, documents, payment proofs). The build runs on the server in the
 * background; this tab polls progress and offers the download when done.
 * Finished archives are kept on the server (last N) and listed below.
 *
 * Backend: routers/crm/backup.py → services/data_backup.py.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, Download, RefreshCw, ShieldAlert } from "lucide-react";

import { authFetch } from "../../../api/client";
import { crmGet, crmPost } from "../../api";
import { btnPrimary, btnSecondary } from "../../components/ui";
import { fmtDateTime12 } from "../../../lib/datetime";

type Notify = (msg: string, kind?: "ok" | "err") => void;

type DatasetOption = { key: string; label: string; description: string; tables: number };
type Job = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  datasets: string[];
  requested_by: string;
  started_at: string;
  finished_at: string | null;
  current: string;
  tables_done: number;
  tables_total: number;
  percent: number;
  rows: number;
  files: number;
  files_missing: number;
  bytes_files: number;
  error: string | null;
  archive_name: string | null;
  archive_bytes: number | null;
  skipped_tables?: string[];
  date_from?: string | null;
  date_to?: string | null;
};
type Archive = {
  name: string;
  bytes: number;
  created_at: string;
  datasets?: string[] | null;
  requested_by?: string | null;
  rows?: number | null;
  files?: number | null;
  date_from?: string | null;
  date_to?: string | null;
};

const POLL_MS = 2000;

/** ISO yyyy-mm-dd in local time (what <input type="date"> speaks). */
function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Indian financial year (Apr–Mar) containing `d`, as [from, to]. */
function financialYear(d: Date, offsetYears = 0): [string, string] {
  const startYear = (d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1) + offsetYears;
  return [`${startYear}-04-01`, `${startYear + 1}-03-31`];
}

function windowLabel(from?: string | null, to?: string | null): string {
  if (!from && !to) return "All data (every year)";
  return `${from || "…"} to ${to || "…"}`;
}

function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : fmtDateTime12(d);
}

/** Streams the archive through authFetch (a bare <a href> would carry no bearer token). */
async function downloadArchive(name: string): Promise<void> {
  const res = await authFetch(`/api/admin/backup/download/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function BackupTab({ notify }: { notify: Notify }) {
  const [options, setOptions] = useState<DatasetOption[]>([]);
  const [keepLast, setKeepLast] = useState<number>(3);
  const [freeBytes, setFreeBytes] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [history, setHistory] = useState<Archive[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  // `notify` comes from the parent's useToast and is not memoised — keep it
  // in a ref so it never re-triggers the bootstrap / polling effects.
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const allSelected = options.length > 0 && selected.size === options.length;
  const busy = job?.status === "queued" || job?.status === "running";

  const loadHistory = useCallback(async () => {
    try {
      const res = await crmGet<Archive[]>("/api/admin/backup/history");
      setHistory(res.data || []);
    } catch {
      setHistory([]);
    }
  }, []);

  const loadStatus = useCallback(async (): Promise<Job | null> => {
    try {
      const res = await crmGet<Job | null>("/api/admin/backup/status");
      setJob(res.data || null);
      return res.data || null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await crmGet<{ datasets: DatasetOption[]; keep_last: number; free_space_bytes: number | null }>(
          "/api/admin/backup/datasets",
        );
        if (!alive) return;
        const list = res.data?.datasets || [];
        setOptions(list);
        setSelected(new Set(list.map((d) => d.key)));   // "all" is the default
        setKeepLast(res.data?.keep_last ?? 3);
        setFreeBytes(res.data?.free_space_bytes ?? null);
      } catch (e: any) {
        if (alive) notifyRef.current(e?.message || "Could not load backup options", "err");
      }
      await Promise.all([loadStatus(), loadHistory()]);
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [loadHistory, loadStatus]);

  // Poll while a build is running — a setTimeout chain (never overlapping
  // requests); stops and refreshes history when the job ends.
  useEffect(() => {
    if (!busy) return;
    let alive = true;
    let timer: number | null = null;
    const tick = async () => {
      const next = await loadStatus();
      if (!alive) return;
      if (next && next.status !== "running" && next.status !== "queued") {
        await loadHistory();
        notifyRef.current(next.status === "done"
          ? `Backup ready — ${next.rows.toLocaleString()} rows, ${next.files.toLocaleString()} files`
          : `Backup failed: ${next.error || "unknown error"}`,
          next.status === "done" ? "ok" : "err");
        return;
      }
      timer = window.setTimeout(tick, POLL_MS);
    };
    timer = window.setTimeout(tick, POLL_MS);
    return () => { alive = false; if (timer) window.clearTimeout(timer); };
  }, [busy, loadStatus, loadHistory]);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const start = async () => {
    if (selected.size === 0) { notify("Pick at least one tab to back up", "err"); return; }
    setStarting(true);
    try {
      if (dateFrom && dateTo && dateFrom > dateTo) { notify("'From' date must be on or before 'To' date", "err"); return; }
      const body = {
        datasets: allSelected ? ["all"] : Array.from(selected),
        date_from: dateFrom || null,
        date_to: dateTo || null,
      };
      const res = await crmPost<Job>("/api/admin/backup", body);
      setJob(res.data);
      notify(res.message || "Backup started");
    } catch (e: any) {
      notify(e?.message || "Could not start the backup", "err");
    } finally {
      setStarting(false);
    }
  };

  const download = async (name: string) => {
    setDownloading(name);
    try {
      await downloadArchive(name);
    } catch (e: any) {
      notify(e?.message || "Download failed", "err");
    } finally {
      setDownloading(null);
    }
  };

  if (loading) return <div className="p-6 text-sm text-muted">Loading backup options…</div>;

  return (
    <div className="space-y-5">
      <div className="rounded-card border border-subtle bg-surface-1 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-primary">
              <Archive size={18} aria-hidden /> Full data backup
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-secondary">
              One ZIP with every selected tab as <strong>Excel</strong> (one sheet per table),
              <strong> CSV</strong> and <strong>JSON</strong>, plus every attached file — CVs, offer letters,
              customer documents, payment proofs, timesheet attachments — filed under
              <code className="mx-1 rounded bg-surface-2 px-1">files/&lt;table&gt;/&lt;id&gt;_&lt;name&gt;/</code>
              so each file can be traced back to its record. <strong>By default it is complete: every record from
              day one, all years</strong>, including inactive, closed and rejected ones — or narrow it to a period
              below. Passwords, tokens and API keys are never included.
            </p>
          </div>
          <div className="text-right text-xs text-muted" title="Only the newest generated ZIP files stay on the server for re-download; older ones are removed from the server. Your downloaded copies are unaffected.">
            <div>Server stores the {keepLast} most recent ZIPs</div>
            {freeBytes != null && <div>Free disk: {fmtBytes(freeBytes)}</div>}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">What to include</div>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-primary">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={allSelected}
              onChange={(e) => setSelected(e.target.checked ? new Set(options.map((d) => d.key)) : new Set())}
            />
            All tabs
          </label>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {options.map((d) => (
            <label
              key={d.key}
              className={`flex cursor-pointer items-start gap-2 rounded-control border p-3 text-sm transition-colors duration-micro
                ${selected.has(d.key) ? "border-brand-500/60 bg-brand-50/40" : "border-subtle bg-surface-1 hover:bg-surface-2"}`}
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-brand-600"
                checked={selected.has(d.key)}
                onChange={() => toggle(d.key)}
              />
              <span className="min-w-0">
                <span className="block font-semibold text-primary">{d.label}</span>
                <span className="block text-xs text-muted">{d.description}</span>
                <span className="block text-[11px] text-muted">{d.tables} table{d.tables === 1 ? "" : "s"}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Period</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {([
            ["All data", "", ""],
            ["This FY", ...financialYear(new Date())],
            ["Last FY", ...financialYear(new Date(), -1)],
            ["This year", `${new Date().getFullYear()}-01-01`, isoDay(new Date())],
            ["Last 12 months", isoDay(new Date(new Date().setFullYear(new Date().getFullYear() - 1))), isoDay(new Date())],
          ] as [string, string, string][]).map(([label, f, t]) => {
            const active = dateFrom === f && dateTo === t;
            return (
              <button
                key={label}
                type="button"
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-micro
                  ${active ? "border-brand-500 bg-brand-50/60 text-brand-800" : "border-subtle text-secondary hover:bg-surface-2"}`}
                aria-pressed={active}
                onClick={() => { setDateFrom(f); setDateTo(t); }}
              >
                {label}
              </button>
            );
          })}
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <input type="date" aria-label="From date" className="rounded-control border border-subtle bg-surface-1 px-2 py-1 text-sm text-primary"
              value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} />
            <span>–</span>
            <input type="date" aria-label="To date" className="rounded-control border border-subtle bg-surface-1 px-2 py-1 text-sm text-primary"
              value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted">
          The period applies to dated records (candidates, profiles, timesheets, invoices, POs, leave, interviews…
          by their created / entry / invoice date). Master data — customers, employees, policies, settings — is
          always included in full so the backup stays usable on its own.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={btnPrimary}
            disabled={busy || starting || selected.size === 0}
            onClick={start}
          >
            <Archive size={15} aria-hidden /> {busy ? "Backup running…" : `Generate backup — ${allSelected ? "all tabs" : `${selected.size} tab${selected.size === 1 ? "" : "s"}`}, ${windowLabel(dateFrom, dateTo).toLowerCase()}`}
          </button>
          <button type="button" className={btnSecondary} onClick={() => { loadStatus(); loadHistory(); }}>
            <RefreshCw size={14} aria-hidden /> Refresh
          </button>
          <span className="flex items-center gap-1 text-xs text-muted">
            <ShieldAlert size={13} aria-hidden /> Admin / CEO only. Large datasets can take several minutes.
          </span>
        </div>
      </div>

      {job && (
        <div
          className={`rounded-card border p-4 ${
            job.status === "failed" ? "border-danger/40 bg-danger-soft"
              : job.status === "done" ? "border-success/40 bg-success-soft"
                : "border-subtle bg-surface-1"}`}
          role="region"
          aria-label="Backup status"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-primary">
              {job.status === "running" && "Building backup…"}
              {job.status === "queued" && "Backup queued…"}
              {job.status === "done" && "Backup ready"}
              {job.status === "failed" && "Backup failed"}
              <span className="ml-2 text-xs font-normal text-muted">
                started {fmtWhen(job.started_at)} by {job.requested_by} · {windowLabel(job.date_from, job.date_to)}
              </span>
            </div>
            {job.status === "done" && job.archive_name && (
              <button
                type="button"
                className={btnPrimary}
                disabled={downloading === job.archive_name}
                onClick={() => download(job.archive_name!)}
              >
                <Download size={15} aria-hidden /> {downloading === job.archive_name ? "Downloading…" : `Download (${fmtBytes(job.archive_bytes)})`}
              </button>
            )}
          </div>
          {busy && (
            <div className="mt-3">
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={job.percent}
                aria-label="Backup progress"
              >
                <div className="h-full bg-brand-600 transition-all duration-panel" style={{ width: `${job.percent}%` }} />
              </div>
              <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-muted">
                <span>{job.current || "Preparing…"}</span>
                <span>
                  {job.tables_done}/{job.tables_total} tables · {job.rows.toLocaleString()} rows ·{" "}
                  {job.files.toLocaleString()} files ({fmtBytes(job.bytes_files)})
                </span>
              </div>
            </div>
          )}
          {job.status === "done" && (
            <div className="mt-2 text-xs text-secondary" aria-live="polite">
              {job.rows.toLocaleString()} rows · {job.files.toLocaleString()} files ({fmtBytes(job.bytes_files)})
              {job.files_missing > 0 && (
                <span className="ml-2 text-warning">· {job.files_missing} referenced file{job.files_missing === 1 ? "" : "s"} not found on disk (listed in README.txt)</span>
              )}
              {job.skipped_tables && job.skipped_tables.length > 0 && (
                <span className="ml-2 text-warning">· {job.skipped_tables.length} table{job.skipped_tables.length === 1 ? "" : "s"} not present in this database (see README.txt)</span>
              )}
              {(job.archive_bytes ?? 0) > 1024 ** 3 && (
                <span className="ml-2 text-muted">· large archive — the download is held in browser memory; use a desktop browser</span>
              )}
            </div>
          )}
          {job.status === "failed" && job.error && (
            <div className="mt-2 text-xs text-danger">{job.error}</div>
          )}
        </div>
      )}

      <div className="rounded-card border border-subtle bg-surface-1 p-5">
        <h3 className="text-sm font-bold text-primary">Previous backups on the server</h3>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No backups yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2 pr-4">By</th>
                  <th className="py-2 pr-4">Tabs</th>
                  <th className="py-2 pr-4">Period</th>
                  <th className="py-2 pr-4 text-right">Rows</th>
                  <th className="py-2 pr-4 text-right">Files</th>
                  <th className="py-2 pr-4 text-right">Size</th>
                  <th className="py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.name} className="border-t border-subtle">
                    <td className="py-2 pr-4 whitespace-nowrap">{fmtWhen(h.created_at)}</td>
                    <td className="py-2 pr-4">{h.requested_by || "—"}</td>
                    <td className="py-2 pr-4 text-xs text-secondary">
                      {h.datasets && h.datasets.length === options.length ? "All tabs"
                        : (h.datasets || []).map((k) => options.find((o) => o.key === k)?.label || k).join(", ") || "—"}
                    </td>
                    <td className="py-2 pr-4 text-xs text-secondary whitespace-nowrap">{windowLabel(h.date_from, h.date_to)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{h.rows?.toLocaleString() ?? "—"}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{h.files?.toLocaleString() ?? "—"}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{fmtBytes(h.bytes)}</td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        className={`${btnSecondary} !px-2.5 !py-1 text-xs`}
                        disabled={downloading === h.name}
                        onClick={() => download(h.name)}
                      >
                        <Download size={13} aria-hidden /> {downloading === h.name ? "Downloading…" : "Download"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
