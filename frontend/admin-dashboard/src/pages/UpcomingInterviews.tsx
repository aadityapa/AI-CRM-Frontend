import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Copy, Search, Trash2 } from "lucide-react";
import { deleteSchedule, getSchedules, type InterviewSchedule } from "../api";
import { btnDanger, btnSecondary, focusRing, inputCls } from "../crm/components/ui";

const PAGE_SIZE = 10;

function safeTime(value: string) {
  const t = Date.parse(value || "");
  return Number.isFinite(t) ? t : 0;
}

function fmtWhen(value: string) {
  const t = safeTime(value);
  if (!t) return value || "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(t));
}

function statusLabel(row: InterviewSchedule) {
  return String(row.session_status || row.status || "scheduled");
}

export function UpcomingInterviewsPage({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<InterviewSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("upcoming");
  const [sort, setSort] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<InterviewSchedule | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await getSchedules());
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const now = Date.now();
    const q = search.trim().toLowerCase();
    return (rows || [])
      .filter((row) => {
        const t = safeTime(row.scheduled_at_local);
        if (filter === "upcoming" && (!t || t < now)) return false;
        if (filter !== "all" && filter !== "upcoming" && statusLabel(row).toLowerCase() !== filter) return false;
        if (!q) return true;
        return [
          row.candidate_name,
          row.candidate_email,
          row.job_title,
          row.template_name,
          row.role,
          row.opportunityId,
          row.customerName,
          statusLabel(row),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => (sort === "asc" ? safeTime(a.scheduled_at_local) - safeTime(b.scheduled_at_local) : safeTime(b.scheduled_at_local) - safeTime(a.scheduled_at_local)));
  }, [rows, search, filter, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  const copyLink = async (row: InterviewSchedule) => {
    const link = row.invite_url || (row.invite_token ? `${window.location.origin}/?invite=${row.invite_token}` : "");
    if (!link) {
      setToast("No invite link available");
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setToast("Interview link copied");
    } catch {
      setToast(link);
    }
    window.setTimeout(() => setToast(""), 2000);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setError("");
    try {
      await deleteSchedule(deleteTarget.id);
      setRows((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      setDeleteTarget(null);
      setToast("Interview deleted");
      window.setTimeout(() => setToast(""), 2000);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 py-8 sm:px-6 lg:px-8">
      {deleteTarget ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-backdrop" onClick={deleteBusy ? undefined : () => setDeleteTarget(null)} />
          <div className="absolute inset-x-0 top-24 mx-auto w-full max-w-md px-4">
            <div className="rounded-modal border border-subtle bg-surface-1 p-6 shadow-modal">
              <div className="text-lg font-extrabold text-primary">Delete interview?</div>
              <p className="mt-2 text-sm text-secondary">Are you sure you want to delete this interview/report?</p>
              <div className="mt-6 flex justify-end gap-2">
                <button className={btnSecondary} disabled={deleteBusy} onClick={() => setDeleteTarget(null)}>
                  Cancel
                </button>
                <button className={btnDanger} disabled={deleteBusy} onClick={confirmDelete}>
                  {deleteBusy ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex items-start sm:items-center justify-between gap-4 flex-col sm:flex-row">
        <div>
          <button
            type="button"
            onClick={onBack}
            className={`inline-flex items-center gap-2 rounded-control text-sm font-semibold text-brand-600 transition-colors duration-micro ease-smooth hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200 ${focusRing}`}
          >
            <ArrowLeft className="w-4 h-4" /> Back to dashboard
          </button>
          <h1 className="text-display mt-3 text-2xl font-bold tracking-tight text-primary">Upcoming Interviews</h1>
          <p className="text-muted text-sm mt-1">Search, sort, share, and manage scheduled candidate interviews.</p>
        </div>
      </div>

      <div className="mt-6 glass rounded-card p-4 shadow-raised flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search candidate, template, status..."
            className={`${inputCls} pl-9`}
          />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="input-recessed h-10 rounded-control px-3 text-sm font-semibold text-primary">
          <option value="upcoming">Upcoming</option>
          <option value="all">All</option>
          <option value="scheduled">Scheduled</option>
          <option value="pending">Pending</option>
          <option value="verified">Verified</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="terminated">Terminated</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value === "desc" ? "desc" : "asc")} className="input-recessed h-10 rounded-control px-3 text-sm font-semibold text-primary">
          <option value="asc">Soonest first</option>
          <option value="desc">Latest first</option>
        </select>
      </div>

      {toast ? <div className="mt-3 text-sm font-semibold text-success">{toast}</div> : null}
      {error ? <div className="mt-3 text-sm font-semibold text-danger">{error}</div> : null}

      <div className="mt-6 rounded-card border border-subtle bg-surface-1 shadow-raised overflow-hidden">
        {loading ? (
          <div className="p-8 text-muted">Loading upcoming interviews...</div>
        ) : !pageRows.length ? (
          <div className="p-10 text-center">
            <div className="font-extrabold text-primary">No interviews found</div>
            <div className="mt-1 text-sm text-muted">Scheduled interviews matching your filters will appear here.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm lg:min-w-0">
              <thead className="bg-surface-2 border-b border-subtle text-xs font-black uppercase tracking-widest text-muted">
                <tr>
                  <th className="px-5 py-3 text-left">Candidate</th>
                  <th className="px-5 py-3 text-left">Template / role</th>
                  <th className="px-5 py-3 text-left">Opportunity ID</th>
                  <th className="px-5 py-3 text-left">Customer</th>
                  <th className="px-5 py-3 text-left">Scheduled time</th>
                  <th className="px-5 py-3 text-left">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {pageRows.map((row) => (
                  <tr key={row.id} className="row-hover transition-colors duration-micro ease-smooth">
                    <td className="px-5 py-4">
                      <div className="font-bold text-primary">{row.candidate_name || "Candidate"}</div>
                      <div className="text-xs text-muted">{row.candidate_email || "-"}</div>
                    </td>
                    <td className="px-5 py-4 text-secondary font-semibold">{row.template_name || row.job_title || row.role || "Interview"}</td>
                    <td className="px-5 py-4 text-secondary">{row.opportunityId || "—"}</td>
                    <td className="px-5 py-4 text-secondary">{row.customerName || "—"}</td>
                    <td className="px-5 py-4 text-secondary whitespace-nowrap">{fmtWhen(row.scheduled_at_local)}</td>
                    <td className="px-5 py-4">
                      <span className="inline-flex px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 dark:bg-brand-900 dark:text-brand-200 ring-1 ring-inset ring-subtle text-xs font-bold">
                        {statusLabel(row)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => copyLink(row)}
                          className={`inline-flex h-9 items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-3 font-semibold text-secondary transition-colors duration-micro ease-smooth hover:border-strong hover:bg-surface-2 hover:text-primary ${focusRing}`}
                        >
                          <Copy className="w-3.5 h-3.5" /> Link
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(row)}
                          className={`inline-flex h-9 items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-3 font-semibold text-danger transition-colors duration-micro ease-smooth hover:bg-danger-soft ${focusRing}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-5 py-3 border-t border-subtle bg-surface-2 flex items-center justify-between text-sm">
          <span className="text-muted font-semibold">{filtered.length} interview{filtered.length === 1 ? "" : "s"}</span>
          <div className="flex items-center gap-2">
            <button
              className={`h-9 rounded-control border border-subtle bg-surface-1 px-3 font-semibold text-secondary transition-colors duration-micro ease-smooth hover:bg-surface-2 disabled:opacity-40 ${focusRing}`}
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span className="text-xs font-bold text-muted">Page {page} / {totalPages}</span>
            <button
              className={`h-9 rounded-control border border-subtle bg-surface-1 px-3 font-semibold text-secondary transition-colors duration-micro ease-smooth hover:bg-surface-2 disabled:opacity-40 ${focusRing}`}
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
