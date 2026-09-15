/**
 * Support Tickets — Admin / CEO queue for what the Help & Support bot escalated.
 *
 * List (status / priority / category filters, search) → ticket page with the
 * full thread, the bot transcript that preceded it, reply, status, priority
 * and assignment. The user is notified of every reply and status change
 * (server-side). Routes: `support-tickets`, `support-tickets/:id`.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Send } from "lucide-react";

import { crmGet, crmPatch, crmPost, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole, useMe } from "../CrmApp";
import { DataTable, type Column } from "../components/DataTable";
import { ErrorBox, Spinner, btnPrimary, btnSecondary, inputCls, useToast } from "../components/ui";
import { CrmLink, crmNavigate, useCrmParams } from "../router";
import { fmtDateTime12 } from "../../lib/datetime";

type TicketMessage = { id: number; author_name: string | null; is_staff: boolean; is_system: boolean; body: string; created_at: string | null };
type Ticket = {
  id: number; ticket_no: string; user_id: number; user_name: string | null; user_roles: string | null;
  subject: string; description: string; category: string; priority: string; status: string; page: string | null;
  assigned_to: number | null; assigned_to_name: string | null; rating: number | null;
  created_at: string | null; updated_at: string | null; resolved_at: string | null; closed_at: string | null;
  message_count: number; last_message_at: string | null;
  messages?: TicketMessage[]; bot_transcript?: { role: string; content: string }[];
};
type AdminUser = { id: number; full_name?: string | null; username?: string | null; roles?: string[] };

const STATUSES = ["Open", "In_Progress", "Resolved", "Closed"];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const CATEGORIES: Record<string, string> = {
  Bug: "Bug / error", Data_Issue: "Wrong data", Access: "Access / permission",
  How_To: "How do I…", Feature_Request: "Feature request", Other: "Other",
};
const STATUS_STYLE: Record<string, string> = {
  Open: "bg-info-soft text-info", In_Progress: "bg-warning-soft text-warning",
  Resolved: "bg-success-soft text-success", Closed: "bg-surface-2 text-muted",
};
const PRIORITY_STYLE: Record<string, string> = {
  Low: "text-muted", Medium: "text-secondary", High: "text-warning", Urgent: "text-danger",
};

const fmt = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : fmtDateTime12(d);
};
const pretty = (s: string) => s.replace(/_/g, " ");

function Pill({ status }: { status: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status] || "bg-surface-2"}`}>{pretty(status)}</span>;
}

export function SupportTicketsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const isAdmin = useHasRole();
  const [rows, setRows] = useState<Ticket[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("open");
  const [priority, setPriority] = useState("");
  const [category, setCategory] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await crmGet<Ticket[]>(`/api/support/tickets${qs({
        page, limit: 20, search: search || undefined, status: status || undefined,
        priority: priority || undefined, category: category || undefined,
      })}`);
      setRows(r.data || []);
      setMeta(r.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [page, search, status, priority, category]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, status, priority, category]);

  if (!isAdmin) return <ErrorBox error="Access denied: Support Tickets is available to Admin / CEO only." />;

  const columns: Column<Ticket>[] = [
    { key: "ticket_no", label: "Ticket", render: (r) => <span className="font-mono text-xs">{r.ticket_no}</span> },
    { key: "subject", label: "Subject", render: (r) => (
      <div className="min-w-0">
        <div className="truncate font-semibold text-primary">{r.subject}</div>
        <div className="truncate text-xs text-muted">{CATEGORIES[r.category] || r.category}{r.page ? ` · ${r.page}` : ""}</div>
      </div>) },
    { key: "user_name", label: "Raised by", render: (r) => (
      <div><div>{r.user_name || `#${r.user_id}`}</div><div className="text-xs text-muted">{r.user_roles || "—"}</div></div>) },
    { key: "priority", label: "Priority", render: (r) => <span className={`font-semibold ${PRIORITY_STYLE[r.priority] || ""}`}>{r.priority}</span> },
    { key: "status", label: "Status", render: (r) => <Pill status={r.status} /> },
    { key: "assigned_to_name", label: "Assigned", render: (r) => r.assigned_to_name || "—" },
    { key: "updated_at", label: "Updated", render: (r) => <span className="whitespace-nowrap text-xs">{fmt(r.updated_at)}</span> },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          {embedded ? (
            <h2 className="text-base font-bold text-primary">Support Tickets</h2>
          ) : (
            <h1 className="text-display text-xl font-bold text-primary">Support Tickets</h1>
          )}
          <p className="text-sm text-muted">Issues users raised from the Help &amp; Support bot. Reply, set status, assign.</p>
        </div>
      </div>
      {error ? <ErrorBox error={error} onRetry={load} /> : (
        <DataTable
          columns={columns}
          rows={rows}
          meta={meta}
          loading={loading}
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Ticket no, subject, user…"
          onPage={setPage}
          onRowClick={(r) => crmNavigate(`support-tickets/${r.id}`)}
          emptyMessage="No tickets match."
          filters={
            <>
              <select className={`${inputCls} !w-40`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
                <option value="open">Open + In progress</option>
                <option value="">All statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
              </select>
              <select className={`${inputCls} !w-36`} value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
                <option value="">All priorities</option>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className={`${inputCls} !w-44`} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
                <option value="">All categories</option>
                {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </>
          }
        />
      )}
    </div>
  );
}

export function SupportTicketDetailPage() {
  const isAdmin = useHasRole();
  const me = useMe();
  const params = useCrmParams();
  const id = Number(params.id);
  const [toast, notify] = useToast();
  const [t, setT] = useState<Ticket | null>(null);
  const [error, setError] = useState("");
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await crmGet<Ticket>(`/api/support/tickets/${id}`);
      setT(r.data);
      setError("");
    } catch (e: any) { setError(e?.message || "Ticket not found"); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!isAdmin) return;
    crmGet<AdminUser[]>("/api/users?limit=100")
      .then((r) => setAdmins((r.data || []).filter((u) => (u.roles || []).some((x) => x === "Admin" || x === "CEO"))))
      .catch(() => setAdmins([]));
  }, [isAdmin]);

  // Non-admins land here from their own bell notification: they see their
  // ticket and can reply; the admin controls are hidden (the API enforces it).
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!t) return <Spinner label="Loading ticket…" />;

  const patch = async (body: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    try {
      const r = await crmPatch<Ticket>(`/api/support/tickets/${t.id}`, body);
      setT(r.data);
      notify(okMsg);
    } catch (e: any) { notify(e?.message || "Update failed", "err"); } finally { setBusy(false); }
  };
  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      const r = await crmPost<Ticket>(`/api/support/tickets/${t.id}/messages`, { body: reply.trim() });
      setT(r.data);
      setReply("");
      notify(isAdmin ? "Reply sent — the user has been notified" : "Reply sent — the admin team has been notified");
    } catch (e: any) { notify(e?.message || "Could not send", "err"); } finally { setBusy(false); }
  };
  const nextStatuses: Record<string, string[]> = {
    Open: ["In_Progress", "Resolved", "Closed"], In_Progress: ["Open", "Resolved", "Closed"],
    Resolved: ["Open", "Closed"], Closed: ["Open"],
  };

  return (
    <div className="space-y-4">
      {toast}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {isAdmin ? (
          <CrmLink to="settings?tab=support-tickets" className="inline-flex items-center gap-1 text-brand-700 hover:underline"><ChevronLeft size={14} aria-hidden /> Settings · Support Tickets</CrmLink>
        ) : (
          <CrmLink to="" className="inline-flex items-center gap-1 text-brand-700 hover:underline"><ChevronLeft size={14} aria-hidden /> Dashboard</CrmLink>
        )}
        <span className="text-muted">/</span>
        <span className="font-mono text-xs text-muted">{t.ticket_no}</span>
        {!isAdmin && <span className="text-xs text-muted">· your support ticket</span>}
      </div>
      <div className="glass rounded-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-primary">{t.subject}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <Pill status={t.status} />
              <span className={`font-semibold ${PRIORITY_STYLE[t.priority] || ""}`}>{t.priority}</span>
              <span>· {CATEGORIES[t.category] || t.category}</span>
              {t.page && <span>· page: {t.page}</span>}
              <span>· raised {fmt(t.created_at)} by <strong className="text-secondary">{t.user_name}</strong> ({t.user_roles || "no role"})</span>
              {t.rating != null && <span>· user rating {t.rating}/5</span>}
            </div>
          </div>
          {isAdmin && <div className="flex flex-wrap items-center gap-2">
            <select className={`${inputCls} !w-36`} value={t.priority} disabled={busy} aria-label="Priority"
              onChange={(e) => patch({ priority: e.target.value }, "Priority updated")}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select className={`${inputCls} !w-44`} value={t.assigned_to ?? ""} disabled={busy} aria-label="Assign to"
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return patch({ clear_assignee: true }, "Assignee cleared");
                const u = admins.find((a) => String(a.id) === v);
                return patch({ assigned_to: Number(v), assigned_to_name: u?.full_name || u?.username || null }, "Assigned");
              }}>
              <option value="">Unassigned</option>
              {admins.map((a) => <option key={a.id} value={a.id}>{a.full_name || a.username}{a.id === me.id ? " (me)" : ""}</option>)}
            </select>
          </div>}
        </div>
        {isAdmin && <div className="mt-4 flex flex-wrap items-center gap-2">
          <input className={`${inputCls} !w-72`} placeholder="Note to the user (optional, sent with the status change)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          {(nextStatuses[t.status] || []).map((s) => (
            <button key={s} type="button" className={s === "Resolved" ? btnPrimary : btnSecondary} disabled={busy}
              onClick={() => { patch({ status: s, note: note.trim() || undefined }, `Marked ${pretty(s)}`); setNote(""); }}>
              Mark {pretty(s)}
            </button>
          ))}
        </div>}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          <div className="rounded-card border border-subtle bg-surface-1 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Conversation</div>
            <div className="mt-3 space-y-2">
              {(t.messages || []).map((m) => m.is_system ? (
                <div key={m.id} className="text-center text-[11px] text-muted">{m.body} · {fmt(m.created_at)}</div>
              ) : (
                <div key={m.id} className={`flex ${m.is_staff ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-card px-3 py-2 text-sm ${m.is_staff ? "bg-brand-600 text-white" : "bg-surface-2 text-primary"}`}>
                    <div className="whitespace-pre-wrap">{m.body}</div>
                    <div className={`mt-1 text-[10px] ${m.is_staff ? "text-white/70" : "text-muted"}`}>{m.author_name} · {fmt(m.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
            {t.status !== "Closed" ? (
              <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
                <textarea className={`${inputCls} min-h-[44px] flex-1`} rows={2} placeholder={isAdmin ? "Reply to the user… (they get a notification + email)" : "Reply to the admin team…"}
                  value={reply} onChange={(e) => setReply(e.target.value)} aria-label="Reply" />
                <button type="submit" className={btnPrimary} disabled={busy || !reply.trim()}><Send size={14} aria-hidden /> Send</button>
              </form>
            ) : <div className="mt-3 text-xs text-muted">Closed — reopen to reply.</div>}
          </div>
        </div>
        {isAdmin && <div className="space-y-3">
          <div className="rounded-card border border-subtle bg-surface-1 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Bot conversation before the ticket</div>
            {(t.bot_transcript || []).length === 0 ? (
              <div className="mt-2 text-sm text-muted">The user raised this directly, without chatting first.</div>
            ) : (
              <div className="mt-2 max-h-96 space-y-1.5 overflow-y-auto text-xs">
                {(t.bot_transcript || []).map((m, i) => (
                  <div key={i} className={`rounded-control px-2 py-1 ${m.role === "user" ? "bg-brand-50/60 text-primary" : "bg-surface-2 text-secondary"}`}>
                    <span className="font-semibold">{m.role === "user" ? "User" : "Bot"}:</span> {m.content}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>}
      </div>
    </div>
  );
}
