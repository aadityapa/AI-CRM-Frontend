import { useState, useEffect, useMemo, memo } from "react";
import { Shield, AlertTriangle, CheckCircle2, XCircle, Clock, Monitor, ChevronDown, ChevronUp } from "lucide-react";
import { apiGet } from "../api/client";

interface IntegrityLog {
  invite_token?: string;
  candidate_name: string;
  candidate_email: string;
  template_name?: string;
  role?: string;
  reason?: string;
  terminated_at?: string;
  scheduled_at: string;
  session_status: string;
  login_attempts: number;
  verified_at: string;
  interview_started_at: string;
  interview_completed_at: string;
  violation_count: number;
  tab_switch_count?: number;
  violations_log: string | object[] | null;
  active_device_id: string;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  pending: { bg: "bg-surface-2", text: "text-secondary", icon: <Clock className="w-3.5 h-3.5" /> },
  verified: { bg: "bg-info-soft", text: "text-info", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  active: { bg: "bg-success-soft", text: "text-success", icon: <Monitor className="w-3.5 h-3.5" /> },
  completed: { bg: "bg-success-soft", text: "text-success", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  terminated: { bg: "bg-danger-soft", text: "text-danger", icon: <XCircle className="w-3.5 h-3.5" /> },
};

const SUMMARY_CARDS = [
  {
    label: "Total Sessions",
    card: "bg-surface-2 border-subtle",
    valueClass: "text-primary",
    labelClass: "text-secondary",
  },
  {
    label: "Active Now",
    card: "bg-success-soft border-subtle",
    valueClass: "text-success",
    labelClass: "text-success",
  },
  {
    label: "Total Violations",
    card: "bg-warning-soft border-subtle",
    valueClass: "text-warning",
    labelClass: "text-warning",
  },
  {
    label: "Terminated",
    card: "bg-danger-soft border-subtle",
    valueClass: "text-danger",
    labelClass: "text-danger",
  },
] as const;

function SummarySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-card border border-subtle p-4 animate-pulse">
          <div className="h-8 w-16 bg-surface-2 rounded-control" />
          <div className="h-3 w-24 bg-surface-2 rounded-control mt-2" />
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ring-inset ring-subtle ${s.bg} ${s.text}`}>
      {s.icon} {status}
    </span>
  );
}

function ViolationBadge({ count }: { count: number }) {
  if (!count) return <span className="text-muted text-sm">—</span>;
  const color = count >= 4 ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ring-1 ring-inset ring-subtle ${color}`}>
      <AlertTriangle className="w-3 h-3" /> {count}
    </span>
  );
}

const ViolationDetail = memo(function ViolationDetail({ log }: { log: IntegrityLog }) {
  const [violations, setViolations] = useState<any[]>([]);
  const [detailReason, setDetailReason] = useState(log.reason || "");
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const token = String(log.invite_token || "").trim();
    if (!token) {
      if (Array.isArray(log.violations_log)) setViolations(log.violations_log);
      return;
    }
    (async () => {
      setLoadingDetail(true);
      try {
        const data = await apiGet<{ violations_log: any[]; reason?: string }>(
          `/interview/integrity-logs/${encodeURIComponent(token)}`
        );
        if (cancelled) return;
        setViolations(Array.isArray(data.violations_log) ? data.violations_log : []);
        if (data.reason) setDetailReason(data.reason);
      } catch {
        if (!cancelled) setViolations([]);
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [log.invite_token, log.violations_log, log.reason]);

  return (
    <div className="bg-surface-2 border border-subtle rounded-card p-4 space-y-3">
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
        <div>
          <span className="text-muted text-xs block">Tab Switches</span>
          <span className="font-semibold text-secondary">{log.tab_switch_count ?? log.violation_count}</span>
        </div>
        <div>
          <span className="text-muted text-xs block">Warning History</span>
          <span className="font-semibold text-secondary">
            {(log.tab_switch_count ?? log.violation_count) > 0 ? `${Math.min(log.tab_switch_count ?? log.violation_count, 3)} warning(s)` : "No warnings"}
          </span>
        </div>
        <div>
          <span className="text-muted text-xs block">Termination Reason</span>
          <span className="font-semibold text-secondary">
            {detailReason || "—"}
          </span>
        </div>
      </div>
      {loadingDetail ? (
        <div className="text-xs text-muted">Loading warning timeline…</div>
      ) : violations.length > 0 ? (
        <div>
          <div className="text-xs font-semibold text-secondary mb-2">Warning Timeline</div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {violations.map((v: any, i: number) => (
              <div
                key={i}
                className="flex items-center gap-3 text-xs bg-surface-1 border border-subtle rounded-control px-3 py-2"
              >
                <span className="text-danger font-bold">#{i + 1}</span>
                <span className="font-semibold text-secondary">{v.type === "termination" ? "terminated" : "tab switch"}</span>
                <span className="text-muted flex-1">{v.details || ""}</span>
                <span className="text-muted whitespace-nowrap">
                  {v.timestamp ? new Date(v.timestamp).toLocaleTimeString() : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
});

export function IntegrityLogsPage() {
  const [logs, setLogs] = useState<IntegrityLog[]>([]);
  const [terminated, setTerminated] = useState<IntegrityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<{ logs: IntegrityLog[]; terminated?: IntegrityLog[] }>("/interview/integrity-logs");
        if (!cancelled) setLogs(Array.isArray(data.logs) ? data.logs : []);
        if (!cancelled) setTerminated(Array.isArray(data.terminated) ? data.terminated : []);
      } catch {
        if (!cancelled) setLogs([]);
        if (!cancelled) setTerminated([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (filter === "terminated") return terminated;
    if (filter === "all") return logs;
    if (filter === "violations") return logs.filter((l) => l.violation_count > 0);
    return logs.filter((l) => l.session_status === filter);
  }, [logs, terminated, filter]);

  const summaryValues = useMemo(() => {
    const all = [...logs, ...terminated];
    const totalViolations = all.reduce((s, l) => s + (l.tab_switch_count ?? l.violation_count ?? 0), 0);
    const active = logs.filter((l) => l.session_status === "active").length;
    return {
      "Total Sessions": all.length,
      "Active Now": active,
      "Total Violations": totalViolations,
      Terminated: terminated.length,
    } as Record<(typeof SUMMARY_CARDS)[number]["label"], number>;
  }, [logs, terminated]);

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="fx-glow flex h-10 w-10 items-center justify-center rounded-card bg-gradient-to-br from-brand-600 to-violet-600">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-display text-xl font-bold tracking-tight text-primary">Interview Integrity</h2>
            <p className="text-sm text-muted">Tab switching warnings, history, and terminations</p>
          </div>
        </div>
      </div>

      {loading ? (
        <SummarySkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {SUMMARY_CARDS.map((card) => (
            <div key={card.label} className={`rounded-card border p-4 ${card.card}`}>
              <div className={`text-display text-2xl font-bold tabular-nums ${card.valueClass}`}>{summaryValues[card.label]}</div>
              <div className={`text-xs font-medium mt-1 ${card.labelClass}`}>{card.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {["all", "active", "completed", "violations", "terminated"].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-control text-xs font-semibold transition-colors duration-micro ease-smooth ${
              filter === f
                ? "bg-gradient-to-r from-brand-600 to-violet-600 text-white shadow-raised"
                : "bg-surface-1 border border-subtle text-secondary hover:bg-surface-2 hover:text-primary"
            }`}
          >
            {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-card bg-surface-2 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted">No integrity logs found.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((log, idx) => (
            <div
              key={`${log.candidate_email}-${log.scheduled_at}-${idx}`}
              className="rounded-card border border-subtle bg-surface-1 shadow-raised overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                className="row-hover w-full flex items-center justify-between px-5 py-3.5 transition-colors duration-micro ease-smooth text-left"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="min-w-0">
                    <div className="font-semibold text-primary text-sm truncate">
                      {log.candidate_name || "Unknown"}
                    </div>
                    <div className="text-xs text-muted truncate">
                      {filter === "terminated"
                        ? `${log.template_name || "Interview"}${log.role ? ` • ${log.role}` : ""}`
                        : log.candidate_email}
                    </div>
                  </div>
                  <StatusBadge status={log.session_status || "pending"} />
                  <ViolationBadge count={log.tab_switch_count ?? log.violation_count} />
                  {filter === "terminated" && log.reason ? (
                    <span className="text-xs text-danger font-semibold truncate">{log.reason}</span>
                  ) : null}
                </div>
                <div className="flex items-center gap-3 text-muted">
                  <span className="text-xs hidden md:inline">{filter === "terminated" ? log.terminated_at || log.scheduled_at || "" : log.scheduled_at || ""}</span>
                  {expandedIdx === idx ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </button>
              {expandedIdx === idx && (
                <div className="px-5 pb-4">
                  <ViolationDetail log={log} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
