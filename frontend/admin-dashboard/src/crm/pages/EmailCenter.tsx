/**
 * Emails — the candidate mail center, Outlook-style three-pane (27 Aug 2026
 * redesign to the user's mock; reworked 3 Sep 2026 after "all candidate
 * emails mixed with each other"):
 *
 *   Rail:   New Email · Sent to candidates · Email type (event) filters
 *   List:   ONE ROW PER CANDIDATE, newest activity first, grouped under
 *           Today / Yesterday / This week / Last week / Older headers like
 *           Outlook's message list. Sort by date or name.
 *   Thread: reading pane — header (name, address, N emails, prev/next) and
 *           the conversation as collapsible cards, latest expanded.
 *
 * WHY the rework: the list used to page over individual MAILS (50 a page)
 * and group them in the browser, so one candidate showed on two pages, the
 * order was whichever mail landed on the page, and "50 emails" said nothing
 * about how many people were listed. The grouping now happens server-side
 * (`GET /api/candidates/email-threads`) and paging is per conversation.
 *
 * OUTBOUND ONLY, and only mail addressed to the candidate (3 Sep 2026, user
 * decision — the server allow-lists the events). Candidate replies go to the
 * sending recruiter's mailbox (Reply-To) — Karnex has no inbound receiver.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownUp, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Inbox, Mail, PenSquare, Reply, Search, Send, Tag,
} from "lucide-react";
import { crmGet, crmPost, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole, useMe } from "../CrmApp";
import { useCanAct } from "../useAccess";
import { CrmLink } from "../routerHooks";
import { SearchableSelect } from "../components/SearchableSelect";
import {
  ActionError, EmptyState, ErrorBox, Modal, Spinner, StatusBadge, btnPrimary, btnSecondary,
  inputCls, useToast,
} from "../components/ui";

type MailRow = {
  id: number;
  candidate_id: number | null;
  candidate_name: string;
  to_email: string;
  to_name?: string | null;
  event: string;
  event_label?: string | null;
  subject: string;
  body_text: string;
  status: string;
  from_name?: string | null;
  reply_to_email?: string | null;
  reply_to_name?: string | null;
  attempts: number;
  last_error?: string | null;
  created_at?: string | null;
  sent_at?: string | null;
};

/** One conversation, as `GET /api/candidates/email-threads` returns it. */
type Thread = {
  key: string;
  candidate_id: number | null;
  candidate_name: string;
  candidate_email: string;
  to_email: string;
  count: number;
  failed: number;
  queued: number;
  latest_at: string | null;
  first_at: string | null;
  latest: {
    id: number;
    event: string;
    event_label?: string | null;
    subject: string;
    snippet: string;
    status: string;
    from_name?: string | null;
    created_at?: string | null;
    sent_at?: string | null;
  };
};

type TagRow = { event: string; label?: string; count: number };

const STATUS_FILTERS = ["", "Sent", "Queued", "Failed", "Skipped"] as const;

/* Only mail SENT TO THE CANDIDATE lives here (3 Sep 2026, user decision) —
   shortlist slot picks, AI L1 / L1 / L2 / HR / customer-round invitations,
   hiring-interest and direct messages. Staff notifications about a candidate
   ("candidate joined", "offer submitted"…) used to share the prefix and
   looked like mixed-up threads; the server now allow-lists the events, so
   Inbox / Drafts / Archive had nothing left to hold and were dropped. */
const FOLDERS = [
  { key: "", label: "Sent to candidates", icon: Send },
] as const;

/** Friendly names for the event keys — the server sends `event_label`, this
 * is the fallback for rows that predate it. */
const EVENT_LABELS: Record<string, string> = {
  "candidate.slot_invite": "Shortlisted — pick a slot",
  "candidate.ai_invite": "AI L1 interview scheduled",
  "candidate.interview_link": "AI L1 interview link",
  "candidate.l1_manual_invite": "L1 interview scheduled",
  "candidate.l2_invite": "L2 interview scheduled",
  "candidate.hr_invite": "HR interview scheduled",
  "candidate.round_invite": "Interview scheduled",
  "candidate.hiring_interest": "Hiring interest",
  "candidate.direct_message": "Direct message",
};

const whenOf = (r: { sent_at?: string | null; created_at?: string | null }) => r.sent_at || r.created_at || null;

const fmtWhen = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
const fmtDay = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

/** Outlook's list clock: time today, weekday this week, otherwise a date. */
const fmtListTime = (v: string | null | undefined) => {
  if (!v) return "—";
  const d = new Date(v);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.floor((startToday - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (diffDays <= 0) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

/** Outlook's date buckets for the message list. */
const dateBucket = (v: string | null | undefined): string => {
  if (!v) return "Older";
  const d = new Date(v);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((startToday.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  // Week starts Monday, as in Outlook's default.
  const dow = (startToday.getDay() + 6) % 7;
  if (diffDays <= dow) return "This week";
  if (diffDays <= dow + 7) return "Last week";
  if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) return "Earlier this month";
  return "Older";
};

/** "candidate.interview_link" → "AI L1 interview link". */
const tagLabel = (e: string, label?: string | null) =>
  label || EVENT_LABELS[e] || (e.split(".").pop() || e).replace(/_/g, " ");

const convKey = (r: MailRow) =>
  r.candidate_id != null ? `cand:${r.candidate_id}` : `mail:${(r.to_email || "").toLowerCase()}`;

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("") || "?";

/** Fill `{token}` placeholders in an admin draft; unknown or empty ones are
 * left as-is so the writer sees what still needs filling. */
export const fillDraftTokens = (text: string, values: Record<string, string>) =>
  (text || "").replace(/\{([a-z_]+)\}/gi, (m, k: string) => {
    const v = values[k.toLowerCase()];
    return v ? v : m;
  });

export function EmailCenterPage() {
  const roleOk = useHasRole("TA", "RMG", "Sales", "Sales_Head", "HR");
  const allowed = useCanAct("emails", "view", roleOk);
  const canCompose = useCanAct("emails", "edit", roleOk);
  const [toast, showToast] = useToast();

  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [folder, setFolder] = useState<string>("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState<"date" | "name">("date");
  const [tags, setTags] = useState<TagRow[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [thread, setThread] = useState<MailRow[] | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [compose, setCompose] = useState<{ candidateId: number | null; subject?: string; quote?: string } | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setSearch(draft.trim()), 350);
    return () => window.clearTimeout(t);
  }, [draft]);
  useEffect(() => setPage(1), [search, status, folder, tag, sort]);

  useEffect(() => {
    crmGet<TagRow[]>("/api/candidates/email-tags")
      .then((r) => setTags(r.data || []))
      .catch(() => { /* rail degrades to no tags */ });
  }, []);

  const load = useCallback(() => {
    setError("");
    crmGet<Thread[]>(`/api/candidates/email-threads${qs({
      search: search || undefined,
      status: status || undefined,
      folder: folder || undefined,
      event: tag || undefined,
      sort: sort === "name" ? "name" : undefined,
      page,
      limit: 40,
    })}`)
      .then((r) => {
        const data = r.data || [];
        setThreads(data);
        setMeta(r.meta);
        setOpenKey((prev) => (prev && data.some((t) => t.key === prev)) ? prev : (data[0]?.key ?? null));
      })
      .catch((e: any) => setError(e?.message || "Failed to load emails"));
  }, [search, status, folder, tag, sort, page]);
  useEffect(() => { setThreads(null); load(); }, [load]);

  const selected = threads?.find((c) => c.key === openKey) || null;
  const selectedIdx = selected && threads ? threads.findIndex((c) => c.key === selected.key) : -1;

  /** Outlook groups the list under date headers; only meaningful for date sort. */
  const grouped = useMemo(() => {
    const out: { label: string; items: Thread[] }[] = [];
    for (const t of threads || []) {
      const label = sort === "name"
        ? ((t.candidate_name || t.to_email || "?")[0] || "?").toUpperCase()
        : dateBucket(t.latest_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(t);
      else out.push({ label, items: [t] });
    }
    return out;
  }, [threads, sort]);

  useEffect(() => {
    if (!selected) { setThread(null); return; }
    let cancelled = false;
    setThread(null);
    const params = selected.candidate_id != null
      ? { candidate_id: selected.candidate_id, limit: 100 }
      : { to_email: selected.to_email, limit: 100 };
    crmGet<MailRow[]>(`/api/candidates/email-conversations${qs(params)}`)
      .then((r) => {
        if (cancelled) return;
        const mails = (r.data || [])
          .filter((m) => convKey(m) === selected.key)
          .sort((a, b) => new Date(whenOf(b) || 0).getTime() - new Date(whenOf(a) || 0).getTime());
        setThread(mails);
        // Reading pane: the latest mail open, the rest collapsed to a line —
        // as Outlook shows a conversation.
        setExpanded(new Set(mails[0] ? [mails[0].id] : []));
      })
      .catch(() => { if (!cancelled) setThread([]); });
    return () => { cancelled = true; };
  }, [selected?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!allowed) {
    return <EmptyState message="The Emails tab is not enabled for your role." />;
  }

  const railBtn = (active: boolean) =>
    `flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-sm font-semibold transition-colors duration-micro ${
      active ? "bg-brand-600/10 text-brand-700 dark:text-brand-300" : "text-secondary hover:bg-surface-2 hover:text-primary"
    }`;

  const toggleExpanded = (id: number) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const replyTo = (m: MailRow) => {
    if (!selected?.candidate_id) return;
    const subj = /^re:/i.test(m.subject || "") ? m.subject : `Re: ${m.subject || ""}`;
    const quote = `\n\n\n---- On ${fmtWhen(whenOf(m))}, ${m.from_name || "Karnex"} wrote: ----\n${m.body_text || ""}`;
    setCompose({ candidateId: selected.candidate_id, subject: subj, quote });
  };

  return (
    <div className="flex h-full min-h-[calc(100vh-8rem)] flex-col">
      {/* -------- top bar: title + search + filters (as in the mock) -------- */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-display mr-2 flex items-center gap-2 text-xl font-bold text-primary">
          <Mail size={20} className="text-brand-600 dark:text-brand-300" /> Emails
        </h1>
        <div className="flex min-w-[220px] flex-1 max-w-md items-center gap-2 rounded-control border border-subtle bg-surface-1 px-3">
          <Search size={14} className="shrink-0 text-muted" />
          <input
            className="h-9 w-full bg-transparent text-sm text-primary placeholder:text-muted focus:outline-none"
            placeholder="Search candidate, email or subject…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <select className={`${inputCls} !w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>{s === "" ? "All status" : s}</option>
          ))}
        </select>
        {tag && (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-700 dark:text-brand-300"
            onClick={() => setTag("")}
            title="Clear tag filter"
          >
            <Tag size={11} /> {tagLabel(tag, tags.find((t) => t.event === tag)?.label)} ✕
          </button>
        )}
        {meta && (
          <span className="ml-auto text-xs text-muted">
            {meta.total} conversation{meta.total === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[200px_minmax(280px,360px)_1fr]">
        {/* ------------------------- folder rail ------------------------- */}
        <div className="rounded-card border border-subtle bg-surface-1 p-2">
          {canCompose && (
            <button className={`${btnPrimary} mb-2 w-full justify-center`}
              onClick={() => setCompose({ candidateId: selected?.candidate_id ?? null })}>
              <PenSquare size={14} /> New Email
            </button>
          )}
          {FOLDERS.map((f) => (
            <button key={f.key} type="button" className={railBtn(folder === f.key)}
              onClick={() => setFolder(f.key)}>
              <f.icon size={15} /> {f.label}
            </button>
          ))}
          <div className="mt-3 border-t border-subtle pt-2">
            <div className="flex items-center gap-1.5 px-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-muted">
              <Tag size={11} /> Email type
            </div>
            {tags.map((t) => (
              <button key={t.event} type="button"
                className={railBtn(tag === t.event)}
                onClick={() => setTag(tag === t.event ? "" : t.event)}
                title={tagLabel(t.event, t.label)}>
                <span className="min-w-0 truncate text-xs">{tagLabel(t.event, t.label)}</span>
                <span className="ml-auto text-[10px] text-muted">{t.count}</span>
              </button>
            ))}
            {tags.length === 0 && <p className="px-3 py-1 text-xs text-muted">No emails sent yet.</p>}
          </div>
        </div>

        {/* ---------------------- conversation list ---------------------- */}
        <div className="flex min-h-0 flex-col rounded-card border border-subtle bg-surface-1">
          <div className="flex items-center justify-between border-b border-subtle px-3.5 py-2">
            <span className="text-xs font-bold uppercase tracking-wide text-muted">
              {FOLDERS.find((f) => f.key === folder)?.label || "Sent to candidates"}
            </span>
            <button type="button"
              className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs font-semibold text-secondary hover:bg-surface-2 hover:text-primary"
              onClick={() => setSort((s) => (s === "date" ? "name" : "date"))}
              title="Change sort order">
              <ArrowDownUp size={12} /> {sort === "date" ? "By date" : "By name"}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {threads === null && !error && <Spinner label="Loading…" />}
            {threads !== null && threads.length === 0 && (
              <EmptyState message="No emails match these filters." icon={<Inbox size={26} />} />
            )}
            {grouped.map((g) => (
              <Fragment key={g.label}>
                <div className="sticky top-0 z-[1] border-b border-subtle bg-surface-2/80 px-3.5 py-1 text-[11px] font-bold uppercase tracking-wide text-muted backdrop-blur">
                  {g.label}
                </div>
                {g.items.map((c) => {
                  const active = openKey === c.key;
                  const badge = c.failed > 0 ? "Failed" : c.queued > 0 ? "Queued" : c.latest.status;
                  return (
                    <button key={c.key} type="button" onClick={() => setOpenKey(c.key)}
                      className={`block w-full border-b border-subtle border-l-2 px-3.5 py-2.5 text-left transition-colors duration-micro ${
                        active ? "border-l-brand-600 bg-brand-600/10" : "border-l-transparent hover:bg-surface-2"}`}>
                      <div className="flex items-start gap-2.5">
                        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600/15 text-xs font-bold text-brand-700 dark:text-brand-300">
                          {initialsOf(c.candidate_name || c.to_email)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-bold text-primary">
                              {c.candidate_name || c.to_email}
                            </span>
                            <span className="shrink-0 text-[11px] text-muted">{fmtListTime(c.latest_at)}</span>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between gap-2">
                            <span className="truncate text-[13px] font-medium text-secondary">{c.latest.subject}</span>
                            {c.count > 1 && (
                              <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10px] font-bold text-muted"
                                title={`${c.count} emails in this conversation`}>{c.count}</span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2">
                            <StatusBadge status={badge} />
                            <span className="shrink-0 rounded-full bg-brand-600/10 px-1.5 py-px text-[10px] font-semibold text-brand-700 dark:text-brand-300">
                              {tagLabel(c.latest.event, c.latest.event_label)}
                            </span>
                            <span className="min-w-0 truncate text-xs text-muted">{c.latest.snippet}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </Fragment>
            ))}
            {meta && meta.pages > 1 && (
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <button className="text-xs font-semibold text-brand-600 disabled:text-muted dark:text-brand-300"
                  disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Newer</button>
                <span className="text-[11px] text-muted">Page {meta.page} of {meta.pages}</span>
                <button className="text-xs font-semibold text-brand-600 disabled:text-muted dark:text-brand-300"
                  disabled={page >= meta.pages} onClick={() => setPage((p) => p + 1)}>Older →</button>
              </div>
            )}
          </div>
        </div>

        {/* -------------------------- reading pane -------------------------- */}
        <div className="min-h-0 overflow-y-auto rounded-card border border-subtle bg-surface-1">
          {!selected ? (
            <EmptyState message="Select a conversation to read it." icon={<Mail size={26} />} />
          ) : (
            <>
              {/* thread header — name, address, count, prev/next (per the mock) */}
              <div className="sticky top-0 z-10 border-b border-subtle bg-surface-1 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600/15 text-sm font-bold text-brand-700 dark:text-brand-300">
                    {initialsOf(selected.candidate_name || selected.to_email)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-base font-bold text-primary">
                      {selected.candidate_id ? (
                        <CrmLink to={`candidates/${selected.candidate_id}`} className="hover:underline">
                          {selected.candidate_name || selected.to_email}
                        </CrmLink>
                      ) : (selected.candidate_name || selected.to_email)}
                    </div>
                    <div className="truncate text-xs text-muted">
                      &lt;{selected.candidate_email || selected.to_email}&gt;
                    </div>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {canCompose && selected.candidate_id != null && thread && thread[0] && (
                      <button className={`${btnSecondary} !px-2.5 !py-1 text-xs`} onClick={() => replyTo(thread[0])}>
                        <Reply size={13} /> Reply
                      </button>
                    )}
                    <span className="text-xs font-semibold text-muted">
                      {thread ? `${thread.length} email${thread.length === 1 ? "" : "s"}` : "…"}
                    </span>
                    <span className="text-xs text-muted">{fmtDay(selected.latest_at)}</span>
                    <button type="button" aria-label="Previous conversation"
                      className="rounded-control p-1 text-muted hover:bg-surface-2 hover:text-primary disabled:opacity-40"
                      disabled={selectedIdx <= 0}
                      onClick={() => setOpenKey(threads?.[selectedIdx - 1]?.key || null)}>
                      <ChevronLeft size={15} />
                    </button>
                    <button type="button" aria-label="Next conversation"
                      className="rounded-control p-1 text-muted hover:bg-surface-2 hover:text-primary disabled:opacity-40"
                      disabled={selectedIdx < 0 || !threads || selectedIdx >= threads.length - 1}
                      onClick={() => setOpenKey(threads?.[selectedIdx + 1]?.key || null)}>
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </div>
                {thread && thread[0] && (
                  <div className="mt-2 truncate text-lg font-bold text-primary">{thread[0].subject}</div>
                )}
              </div>

              {/* the conversation: latest open, older collapsed — as Outlook does */}
              <div className="space-y-2 p-4">
                {thread === null && <Spinner label="Loading thread…" />}
                {thread?.map((m) => {
                  const open = expanded.has(m.id);
                  const fromLabel = m.from_name || "Karnex";
                  return (
                    <div key={m.id} className={`rounded-card border ${open ? "border-subtle bg-surface-2/40" : "border-subtle/60 bg-surface-1"}`}>
                      <button type="button" onClick={() => toggleExpanded(m.id)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-bold text-secondary">
                          {initialsOf(fromLabel)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-bold text-primary">{fromLabel}</span>
                            <span className="shrink-0 text-xs text-muted">{open ? fmtWhen(whenOf(m)) : fmtListTime(whenOf(m))}</span>
                          </div>
                          <div className="truncate text-xs text-muted">
                            {open
                              ? <>To: <span className="font-semibold text-secondary">{m.to_name || m.to_email}</span> &lt;{m.to_email}&gt;</>
                              : (m.body_text || "").replace(/\s+/g, " ").slice(0, 90)}
                          </div>
                        </div>
                        <StatusBadge status={m.status} />
                        {open ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
                      </button>
                      {open && (
                        <>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-subtle px-4 pt-2 text-xs text-muted">
                            <span className="font-semibold text-secondary">{m.subject}</span>
                            <span className="inline-flex items-center gap-1"><Tag size={10} /> {tagLabel(m.event, m.event_label)}</span>
                            {m.reply_to_email && (
                              <span>Reply-To: <span className="text-secondary">{m.reply_to_name || m.reply_to_email}</span></span>
                            )}
                            {m.status === "Failed" && m.last_error && (
                              <span className="text-danger">Failed after {m.attempts} attempt{m.attempts === 1 ? "" : "s"}: {m.last_error}</span>
                            )}
                            {canCompose && selected.candidate_id != null && (
                              <button type="button" className="ml-auto inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline dark:text-brand-300"
                                onClick={() => replyTo(m)}>
                                <Reply size={12} /> Reply
                              </button>
                            )}
                          </div>
                          <pre className="whitespace-pre-wrap px-4 py-3 font-sans text-sm leading-relaxed text-primary">
                            {m.body_text}
                          </pre>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {compose && (
        <ComposeModal
          presetCandidateId={compose.candidateId}
          presetSubject={compose.subject}
          presetBody={compose.quote}
          onClose={() => setCompose(null)}
          onSent={(msg) => { setCompose(null); showToast(msg); load(); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
      {toast}
    </div>
  );
}

/** New Email — free-form mail to one candidate, queued on the durable outbox
 * with the author's Reply-To, so replies come back to the writer. */
function ComposeModal({ presetCandidateId, presetSubject, presetBody, onClose, onSent, onError }: {
  presetCandidateId: number | null;
  presetSubject?: string;
  presetBody?: string;
  onClose: () => void;
  onSent: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [candidates, setCandidates] = useState<{ id: number; name: string; email: string }[]>([]);
  const [candidateId, setCandidateId] = useState(presetCandidateId ? String(presetCandidateId) : "");
  const [subject, setSubject] = useState(presetSubject || "");
  const [body, setBody] = useState(presetBody || "");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const isReply = !!presetSubject;
  /* Admin-created drafts (Settings → Email Drafts → Your own drafts), offered
     here as "Use a draft" (3 Sep 2026). Placeholders fill from the chosen
     candidate and the sender; anything unknown stays for the writer. */
  const [draftsList, setDraftsList] = useState<{ key: string; label: string; description: string; subject: string; body: string }[]>([]);
  const [draftKey, setDraftKey] = useState("");
  const me = useMe();

  useEffect(() => {
    crmGet<any[]>("/api/candidates?limit=100")
      .then((r) => setCandidates((r.data || []).map((c: any) => ({
        id: c.id,
        name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email,
        email: c.email || "",
      }))))
      .catch(() => {});
    crmGet<any[]>("/api/email-drafts/custom")
      .then((r) => setDraftsList(r.data || []))
      .catch(() => {});
  }, []);

  const applyDraft = (key: string) => {
    setDraftKey(key);
    const d = draftsList.find((x) => x.key === key);
    if (!d) return;
    const cand = candidates.find((c) => String(c.id) === candidateId);
    const fill = (s: string) => fillDraftTokens(s, {
      candidate: cand?.name || "",
      first_name: (cand?.name || "").split(/\s+/)[0] || "",
      email: cand?.email || "",
      sender: me?.full_name || me?.username || "",
      company: "Karnex",
    });
    setSubject(fill(d.subject));
    setBody(fill(d.body));
  };

  const send = async () => {
    if (!candidateId || !subject.trim() || !body.trim()) return;
    setBusy(true);
    try {
      const res = await crmPost("/api/candidates/email-compose", {
        candidate_id: Number(candidateId),
        subject: subject.trim(),
        body: body.trim(),
      });
      onSent(res.message || "Email queued");
    } catch (e: any) {
      const msg = e?.message || "Failed to send";
      setServerError(msg);   // inline — e.g. "no real email address on file"
      onError(msg);
      setBusy(false);
    }
  };

  return (
    <Modal title={isReply ? "Reply" : "New Email"} onClose={onClose}
      dirty={!!((subject.trim() && subject !== presetSubject) || (body.trim() && body !== presetBody))}>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">To (candidate)</label>
          <SearchableSelect
            value={candidateId}
            onChange={setCandidateId}
            options={candidates.map((c) => ({ value: String(c.id), label: `${c.name} — ${c.email}` }))}
            placeholder="Search candidate…"
          />
        </div>
        {draftsList.length > 0 && !isReply && (
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Use a draft</label>
            <select className={inputCls} value={draftKey} onChange={(e) => applyDraft(e.target.value)}
              title={candidateId ? undefined : "Pick the candidate first so the draft fills in their name"}>
              <option value="">— Write from scratch —</option>
              {draftsList.map((d) => (
                <option key={d.key} value={d.key}>{d.label}{d.description ? ` — ${d.description}` : ""}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Subject</label>
          <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Next steps for your application" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Message</label>
          <textarea className={`${inputCls} min-h-48 resize-y !h-auto py-2 leading-relaxed`}
            value={body} onChange={(e) => setBody(e.target.value)}
            autoFocus={isReply}
            placeholder="Write your message… replies will come to your own mailbox." />
        </div>
        <ActionError error={serverError} />
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose}>Cancel</button>
          <button className={btnPrimary} onClick={() => void send()}
            disabled={busy || !candidateId || !subject.trim() || !body.trim()}>
            <Send size={14} /> {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
