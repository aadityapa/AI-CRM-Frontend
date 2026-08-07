import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Search,
  Filter,
  Download,
  ChevronLeft,
  ChevronRight,
  Eye,
  X,
  Zap,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  BarChart3,
  Trash2,
  RefreshCw,
  Coins,
  Activity,
  TrendingUp,
} from "lucide-react";
import type {
  PromptLog,
  PromptLogFilters,
  PromptLogQueryParams,
  TokenUsageStats,
} from "../api/promptLogs";
import {
  getPromptLogs,
  getPromptLogById,
  getPromptLogFilters,
  getTokenUsageStats,
  cleanupPromptLogs,
  exportPromptLogs,
} from "../api/promptLogs";

type Tab = "logs" | "stats";

const CALL_TYPE_LABELS: Record<string, string> = {
  generate_questions: "Question Generation",
  generate_one_per_skill: "Per-Skill Questions",
  generate_followup: "Follow-up Question",
  evaluate_turn: "Turn Evaluation",
  evaluate_turn_retry: "Turn Eval (retry)",
  evaluate_interview: "Interview Evaluation",
  evaluate_communication: "Communication Eval",
  extract_text_from_image: "Image OCR",
  ats_score_llm: "ATS LLM Score",
  ats_embedding: "ATS Embedding",
};

function callTypeLabel(ct: string): string {
  return CALL_TYPE_LABELS[ct] || ct;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "success")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-success-soft text-success ring-1 ring-inset ring-subtle">
        <CheckCircle className="w-3 h-3" /> Success
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-danger-soft text-danger ring-1 ring-inset ring-subtle">
      <XCircle className="w-3 h-3" /> Failed
    </span>
  );
}

function StatCard({ icon: Icon, label, value, sub, color = "indigo" }: {
  icon: any;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  const colors: Record<string, string> = {
    indigo: "bg-brand-50 text-brand-700 border-subtle dark:bg-brand-900 dark:text-brand-200",
    emerald: "bg-success-soft text-success border-subtle",
    amber: "bg-warning-soft text-warning border-subtle",
    red: "bg-danger-soft text-danger border-subtle",
    violet: "bg-surface-2 text-violet-600 border-subtle dark:text-violet-300",
    sky: "bg-surface-2 text-accent-600 border-subtle dark:text-accent-400",
  };
  return (
    <div className={`rounded-card border p-4 ${colors[color] || colors.indigo}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</span>
      </div>
      <div className="text-display text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs mt-0.5 opacity-70">{sub}</div>}
    </div>
  );
}

function PromptDetail({ log, onClose }: { log: PromptLog; onClose: () => void }) {
  const sections: { title: string; content: string; lang?: string }[] = [
    { title: "System Prompt", content: log.system_prompt || "(none)" },
    { title: "User Prompt", content: log.user_prompt || "(none)" },
    { title: "Final Compiled Prompt", content: log.final_prompt || "(none)" },
    { title: "Request Payload", content: log.request_payload || "{}", lang: "json" },
    { title: "API Response", content: log.response_payload || "(none)", lang: "json" },
    ...(log.error_log ? [{ title: "Error Log", content: log.error_log }] : []),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-backdrop backdrop-blur-sm overflow-auto p-4">
      <div className="my-8 max-h-[calc(100vh-4rem)] w-full max-w-5xl overflow-hidden rounded-modal border border-subtle bg-surface-1 shadow-modal">
        <div className="sticky top-0 z-10 bg-surface-1 border-b border-subtle rounded-t-modal px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-primary">Prompt Log Detail</h2>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted">
              <span className="font-mono">{log.id}</span>
              <StatusBadge status={log.status} />
              <span>{callTypeLabel(log.call_type)}</span>
              <span>{log.model}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-control transition-colors duration-micro ease-smooth hover:bg-surface-2">
            <X className="w-5 h-5 text-muted" />
          </button>
        </div>

        <div className="max-h-[calc(100vh-9rem)] overflow-y-auto px-6 py-5 space-y-4">
          {/* Meta info grid */}
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Candidate", log.candidate_name || "-"],
              ["Role", log.candidate_role || "-"],
              ["Interview ID", log.interview_id || "-"],
              ["Template", log.template_name || "-"],
              ["Difficulty", log.difficulty || "-"],
              ["Skills", log.selected_skills || "-"],
              ["Model", log.model || "-"],
              ["Temperature", log.temperature != null ? String(log.temperature) : "-"],
              ["Prompt Tokens", String(log.prompt_tokens || 0)],
              ["Completion Tokens", String(log.completion_tokens || 0)],
              ["Total Tokens", String(log.total_tokens || 0)],
              ["Response Time", `${log.response_time_ms || 0}ms`],
              ["Date", log.created_date_ist || "-"],
              ["Time", log.created_time_ist || "-"],
            ].map(([label, val]) => (
              <div key={label}>
                <div className="text-xs font-semibold text-muted uppercase">{label}</div>
                <div className="text-secondary truncate" title={val}>{val}</div>
              </div>
            ))}
          </div>

          {/* Prompt sections */}
          {sections.map((sec) => (
            <div key={sec.title} className="border border-subtle rounded-card overflow-hidden">
              <div className="bg-surface-2 px-4 py-2 text-xs font-bold text-secondary uppercase tracking-wide border-b border-subtle">
                {sec.title}
              </div>
              <pre className="px-4 py-3 text-xs text-secondary whitespace-pre-wrap break-words max-h-96 overflow-auto font-mono bg-surface-1">
                {sec.content}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LogsTab() {
  const [logs, setLogs] = useState<PromptLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<PromptLogFilters | null>(null);
  const [selectedLog, setSelectedLog] = useState<PromptLog | null>(null);
  const [params, setParams] = useState<PromptLogQueryParams>({
    limit: 25,
    offset: 0,
    sort_by: "created_at_ist",
    sort_order: "desc",
  });
  const [searchInput, setSearchInput] = useState("");

  const fetchLogs = useCallback(async (p: PromptLogQueryParams) => {
    setLoading(true);
    try {
      const [res, f] = await Promise.all([getPromptLogs(p), filters ? Promise.resolve(filters) : getPromptLogFilters()]);
      setLogs(res.logs);
      setTotal(res.total);
      if (!filters) setFilters(f as PromptLogFilters);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchLogs(params); }, [params]);

  const setFilter = (key: keyof PromptLogQueryParams, val: string) => {
    setParams((p) => ({ ...p, [key]: val || undefined, offset: 0 }));
  };

  const page = Math.floor((params.offset || 0) / (params.limit || 25));
  const totalPages = Math.ceil(total / (params.limit || 25));

  const handleSearch = () => {
    setParams((p) => ({ ...p, search: searchInput || undefined, offset: 0 }));
  };

  const openDetail = async (id: string) => {
    try {
      const res = await getPromptLogById(id);
      setSelectedLog(res.log);
    } catch { /* ignore */ }
  };

  const handleExport = async () => {
    try {
      await exportPromptLogs({
        call_type: params.call_type,
        date_from: params.date_from,
        date_to: params.date_to,
      });
    } catch (e: any) {
      alert(`Export failed: ${e.message}`);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search & Filters bar */}
      <div className="glass rounded-card p-4 shadow-raised">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:min-w-60">
            <Search className="w-4 h-4 text-muted" />
            <input
              type="text"
              placeholder="Search by candidate, template, prompt..."
              className="flex-1 input-recessed rounded-control px-3 py-2 text-sm text-primary"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <button onClick={handleSearch} className="btn-depth btn-gradient rounded-control bg-brand-600 px-3 py-2 text-sm font-semibold text-white">
              Search
            </button>
          </div>

          <select
            className="input-recessed rounded-control px-3 py-2 text-sm text-primary"
            value={params.call_type || ""}
            onChange={(e) => setFilter("call_type", e.target.value)}
          >
            <option value="">All Types</option>
            {(filters?.call_types || []).map((ct) => (
              <option key={ct} value={ct}>{callTypeLabel(ct)}</option>
            ))}
          </select>

          <select
            className="input-recessed rounded-control px-3 py-2 text-sm text-primary"
            value={params.model || ""}
            onChange={(e) => setFilter("model", e.target.value)}
          >
            <option value="">All Models</option>
            {(filters?.models || []).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          <select
            className="input-recessed rounded-control px-3 py-2 text-sm text-primary"
            value={params.status || ""}
            onChange={(e) => setFilter("status", e.target.value)}
          >
            <option value="">All Status</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
          </select>

          <input
            type="date"
            className="input-recessed rounded-control px-3 py-2 text-sm text-primary"
            value={params.date_from || ""}
            onChange={(e) => setFilter("date_from", e.target.value)}
            title="From Date"
          />
          <input
            type="date"
            className="input-recessed rounded-control px-3 py-2 text-sm text-primary"
            value={params.date_to || ""}
            onChange={(e) => setFilter("date_to", e.target.value)}
            title="To Date"
          />

          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-3 py-2 text-sm font-semibold text-secondary transition-colors duration-micro ease-smooth hover:border-strong hover:bg-surface-2 hover:text-primary"
          >
            <Download className="w-4 h-4" /> Export
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-card border border-subtle bg-surface-1 shadow-raised overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm lg:min-w-0">
            <thead className="bg-surface-2 border-b border-subtle">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-secondary">Time</th>
                <th className="text-left px-4 py-3 font-semibold text-secondary">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-secondary">Model</th>
                <th className="text-left px-4 py-3 font-semibold text-secondary">Candidate</th>
                <th className="text-right px-4 py-3 font-semibold text-secondary">Tokens</th>
                <th className="text-right px-4 py-3 font-semibold text-secondary">Response</th>
                <th className="text-center px-4 py-3 font-semibold text-secondary">Status</th>
                <th className="text-center px-4 py-3 font-semibold text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-muted">
                    <RefreshCw className="w-5 h-5 inline-block animate-spin mr-2" />Loading...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-muted">No prompt logs found.</td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="row-hover transition-colors duration-micro ease-smooth">
                    <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                      <div>{log.created_date_ist}</div>
                      <div className="text-muted">{log.created_time_ist}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 dark:bg-brand-900 dark:text-brand-200 text-xs font-semibold ring-1 ring-inset ring-subtle">
                        {callTypeLabel(log.call_type)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-secondary">{log.model || "-"}</td>
                    <td className="px-4 py-3 text-xs text-secondary max-w-40 truncate" title={log.candidate_name}>
                      {log.candidate_name || "-"}
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-semibold text-secondary">
                      {log.total_tokens ? log.total_tokens.toLocaleString() : "-"}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted">
                      {log.response_time_ms ? `${log.response_time_ms}ms` : "-"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={log.status} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => openDetail(log.id)}
                        className="p-1.5 rounded-control text-brand-600 transition-colors duration-micro ease-smooth hover:bg-surface-2 dark:text-brand-300"
                        title="View Full Prompt"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-subtle bg-surface-2">
            <span className="text-xs text-muted">
              Showing {(params.offset || 0) + 1}–{Math.min((params.offset || 0) + (params.limit || 25), total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={page === 0}
                onClick={() => setParams((p) => ({ ...p, offset: Math.max(0, (p.offset || 0) - (p.limit || 25)) }))}
                className="p-1.5 rounded-control border border-subtle hover:bg-surface-1 disabled:opacity-40 transition"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-secondary font-semibold">
                Page {page + 1} of {totalPages}
              </span>
              <button
                disabled={page + 1 >= totalPages}
                onClick={() => setParams((p) => ({ ...p, offset: (p.offset || 0) + (p.limit || 25) }))}
                className="p-1.5 rounded-control border border-subtle hover:bg-surface-1 disabled:opacity-40 transition"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedLog && <PromptDetail log={selectedLog} onClose={() => setSelectedLog(null)} />}
    </div>
  );
}

function StatsTab() {
  const [stats, setStats] = useState<TokenUsageStats | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [cleaningUp, setCleaningUp] = useState(false);

  useEffect(() => {
    setLoading(true);
    getTokenUsageStats(days)
      .then(setStats)
      .finally(() => setLoading(false));
  }, [days]);

  const handleCleanup = async () => {
    if (!confirm("Remove old prompt logs (file + DB)? This cannot be undone.")) return;
    setCleaningUp(true);
    try {
      const res = await cleanupPromptLogs();
      alert(`Cleanup complete. Files removed: ${res.file_dirs_removed}, DB rows removed: ${res.db_rows_removed}`);
    } catch (e: any) {
      alert(`Cleanup failed: ${e.message}`);
    } finally {
      setCleaningUp(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading statistics...
      </div>
    );
  }

  const s = stats?.total_summary || { total_calls: 0, total_prompt_tokens: 0, total_completion_tokens: 0, total_tokens: 0, avg_response_ms: 0, failed_calls: 0 };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-secondary">Period:</label>
          <select
            className="input-recessed rounded-control px-3 py-2 text-sm text-primary"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
        </div>
        <button
          onClick={handleCleanup}
          disabled={cleaningUp}
          className="flex items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-3 py-2 text-sm font-semibold text-danger transition-colors duration-micro ease-smooth hover:bg-danger-soft disabled:opacity-50"
        >
          <Trash2 className="w-4 h-4" /> {cleaningUp ? "Cleaning..." : "Cleanup Old Logs"}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={Zap} label="Total Calls" value={s.total_calls.toLocaleString()} color="indigo" />
        <StatCard icon={Coins} label="Total Tokens" value={s.total_tokens.toLocaleString()} color="violet" />
        <StatCard icon={TrendingUp} label="Prompt Tokens" value={s.total_prompt_tokens.toLocaleString()} color="sky" />
        <StatCard icon={Activity} label="Completion Tokens" value={s.total_completion_tokens.toLocaleString()} color="emerald" />
        <StatCard icon={Clock} label="Avg Response" value={`${Math.round(s.avg_response_ms)}ms`} color="amber" />
        <StatCard icon={AlertTriangle} label="Failed Calls" value={s.failed_calls} color="red" />
      </div>

      {/* By call type */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-card border border-subtle bg-surface-1 shadow-raised overflow-hidden">
          <div className="px-4 py-3 border-b border-subtle bg-surface-2">
            <h3 className="text-sm font-bold text-secondary">Token Usage by Call Type</h3>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm lg:min-w-0">
            <thead className="bg-surface-2">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-muted">Type</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-muted">Calls</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-muted">Tokens</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-muted">Avg Tokens</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-muted">Avg ms</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {(stats?.by_call_type || []).map((row) => (
                <tr key={row.call_type} className="row-hover">
                  <td className="px-4 py-2 text-xs font-semibold text-brand-700 dark:text-brand-300">{callTypeLabel(row.call_type)}</td>
                  <td className="px-4 py-2 text-right text-xs">{row.call_count}</td>
                  <td className="px-4 py-2 text-right text-xs font-semibold">{row.tokens.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right text-xs">{Math.round(row.avg_tokens)}</td>
                  <td className="px-4 py-2 text-right text-xs text-muted">{Math.round(row.avg_response_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        <div className="rounded-card border border-subtle bg-surface-1 shadow-raised overflow-hidden">
          <div className="px-4 py-3 border-b border-subtle bg-surface-2">
            <h3 className="text-sm font-bold text-secondary">Token Usage by Model</h3>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm lg:min-w-0">
            <thead className="bg-surface-2">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-muted">Model</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-muted">Calls</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-muted">Tokens</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {(stats?.by_model || []).map((row) => (
                <tr key={row.model} className="row-hover">
                  <td className="px-4 py-2 text-xs font-mono text-secondary">{row.model || "(unknown)"}</td>
                  <td className="px-4 py-2 text-right text-xs">{row.call_count}</td>
                  <td className="px-4 py-2 text-right text-xs font-semibold">{row.tokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {/* Most expensive + slowest */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-card border border-subtle bg-surface-1 shadow-raised overflow-hidden">
          <div className="px-4 py-3 border-b border-subtle bg-warning-soft">
            <h3 className="text-sm font-bold text-warning">Most Expensive Prompts (by tokens)</h3>
          </div>
          <div className="divide-y divide-subtle">
            {(stats?.most_expensive || []).map((row, i) => (
              <div key={row.id} className="px-4 py-2 flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-warning mr-2">#{i + 1}</span>
                  <span className="font-semibold text-secondary">{callTypeLabel(row.call_type)}</span>
                  {row.candidate_name && <span className="text-muted ml-2">{row.candidate_name}</span>}
                </div>
                <div className="text-right">
                  <span className="font-bold text-warning">{row.total_tokens.toLocaleString()} tokens</span>
                  <span className="text-muted ml-2">{row.response_time_ms}ms</span>
                </div>
              </div>
            ))}
            {(stats?.most_expensive || []).length === 0 && (
              <div className="px-4 py-6 text-center text-muted text-xs">No data</div>
            )}
          </div>
        </div>

        <div className="rounded-card border border-subtle bg-surface-1 shadow-raised overflow-hidden">
          <div className="px-4 py-3 border-b border-subtle bg-danger-soft">
            <h3 className="text-sm font-bold text-danger">Slowest API Calls (by response time)</h3>
          </div>
          <div className="divide-y divide-subtle">
            {(stats?.slowest_calls || []).map((row, i) => (
              <div key={row.id} className="px-4 py-2 flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-danger mr-2">#{i + 1}</span>
                  <span className="font-semibold text-secondary">{callTypeLabel(row.call_type)}</span>
                  {row.candidate_name && <span className="text-muted ml-2">{row.candidate_name}</span>}
                </div>
                <div className="text-right">
                  <span className="font-bold text-danger">{row.response_time_ms.toLocaleString()}ms</span>
                  <span className="text-muted ml-2">{row.total_tokens} tokens</span>
                </div>
              </div>
            ))}
            {(stats?.slowest_calls || []).length === 0 && (
              <div className="px-4 py-6 text-center text-muted text-xs">No data</div>
            )}
          </div>
        </div>
      </div>

      {/* Daily usage */}
      {(stats?.by_date || []).length > 0 && (
        <div className="rounded-card border border-subtle bg-surface-1 shadow-raised overflow-hidden">
          <div className="px-4 py-3 border-b border-subtle bg-surface-2">
            <h3 className="text-sm font-bold text-secondary">Daily Usage</h3>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm lg:min-w-0">
            <thead className="bg-surface-2">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-muted">Date</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-muted">Calls</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-muted">Total Tokens</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-muted">Bar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {(() => {
                const maxT = Math.max(...(stats?.by_date || []).map((d) => d.tokens), 1);
                return (stats?.by_date || []).map((row) => (
                  <tr key={row.date} className="row-hover">
                    <td className="px-4 py-2 text-xs font-mono text-secondary">{row.date}</td>
                    <td className="px-4 py-2 text-right text-xs">{row.call_count}</td>
                    <td className="px-4 py-2 text-right text-xs font-semibold">{row.tokens.toLocaleString()}</td>
                    <td className="px-4 py-2">
                      <div className="h-4 rounded-full bg-surface-2 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500"
                          style={{ width: `${Math.max(2, (row.tokens / maxT) * 100)}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function PromptLogsPage() {
  const [tab, setTab] = useState<Tab>("logs");

  return (
    <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-display text-2xl font-bold tracking-tight text-primary">AI Prompt Logs</h1>
          <p className="text-sm text-muted mt-0.5">Debug, monitor, and optimize OpenAI API usage</p>
        </div>
        <div className="flex items-center gap-1 bg-surface-2 border border-subtle rounded-control p-1">
          <button
            onClick={() => setTab("logs")}
            className={`px-4 py-2 rounded-control text-sm font-semibold transition flex items-center gap-2 ${
              tab === "logs" ? "bg-surface-1 text-brand-600 dark:text-brand-300 shadow-raised" : "text-secondary hover:text-primary"
            }`}
          >
            <Filter className="w-4 h-4" /> Logs
          </button>
          <button
            onClick={() => setTab("stats")}
            className={`px-4 py-2 rounded-control text-sm font-semibold transition flex items-center gap-2 ${
              tab === "stats" ? "bg-surface-1 text-brand-600 dark:text-brand-300 shadow-raised" : "text-secondary hover:text-primary"
            }`}
          >
            <BarChart3 className="w-4 h-4" /> Analytics
          </button>
        </div>
      </div>

      {tab === "logs" ? <LogsTab /> : <StatsTab />}
    </div>
  );
}
