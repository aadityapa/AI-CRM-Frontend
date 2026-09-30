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
  ActionError, EmptyState, ErrorBox, Modal, Spinner, btnPrimary, btnSecondary,
  inputCls, useToast,
} from "../components/ui";
import { HERO_BTN_SOLID, PageHeader } from "../components/PageHeader";

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

  /* ---- read-only header figures from what is already loaded ---- */
  const pageFailed = (threads || []).reduce((n, t) => n + (t.failed || 0), 0);
  const pageQueued = (threads || []).reduce((n, t) => n + (t.queued || 0), 0);
  const totalMails = tags.reduce((n, t) => n + (t.count || 0), 0);
  const heroStats = [
    { label: meta?.total === 1 ? "conversation" : "conversations", value: meta ? meta.total : "…" },
    ...(tags.length ? [{ label: "emails sent", value: totalMails }] : []),
    ...(tags.length ? [{ label: "email types", value: tags.length }] : []),
    ...(pageQueued ? [{ label: "queued on this page", value: pageQueued }] : []),
    ...(pageFailed ? [{ label: "failed on this page", value: pageFailed }] : []),
  ];

  const pillCls = (active: boolean) =>
    `inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors duration-micro ${
      active
        ? "bg-purple-600 text-white ring-purple-600 shadow-raised"
        : "bg-surface-1 text-secondary ring-slate-200 hover:bg-surface-2 hover:text-primary dark:ring-slate-700"
    }`;

  return (
    <div className="flex h-full min-h-[calc(100vh-8rem)] flex-col gap-3">
      <PageHeader
        icon={Mail}
        accent="violet"
        eyebrow="Candidate mail"
        title="Emails"
        subtitle="Every email sent to a candidate — one conversation per person, newest first. Replies go to the sender's own mailbox."
        stats={heroStats}
        actions={canCompose ? (
          <button type="button" className={HERO_BTN_SOLID}
            onClick={() => setCompose({ candidateId: selected?.candidate_id ?? null })}>
            <PenSquare size={14} /> New Email
          </button>
        ) : undefined}
      >
        <div className="space-y-3">
          {/* search + status + sort */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-1 basis-60 items-center gap-2 rounded-control border border-subtle bg-surface-1 px-3 focus-within:ring-2 focus-within:ring-purple-500 sm:max-w-md">
              <Search size={14} className="shrink-0 text-muted" />
              <input
                className="h-9 w-full bg-transparent text-sm text-primary placeholder:text-muted focus:outline-none"
                placeholder="Search candidate, email or subject…"
                aria-label="Search emails"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
            <div role="radiogroup" aria-label="Status"
              className="inline-flex max-w-full overflow-x-auto rounded-control border border-subtle bg-surface-2 p-0.5">
              {STATUS_FILTERS.map((s) => {
                const active = status === s;
                return (
                  <button key={s} type="button" role="radio" aria-checked={active}
                    onClick={() => setStatus(s)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-[5px] px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                      active ? "bg-surface-1 text-primary shadow-raised" : "text-muted hover:text-primary"
                    }`}>
                    {s && <span className={`h-2 w-2 rounded-full ${MAIL_STATUS[s]?.dot || "bg-slate-400"}`} aria-hidden />}
                    {s === "" ? "All status" : s}
                  </button>
                );
              })}
            </div>
            <button type="button"
              className="inline-flex items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-2.5 py-2 text-xs font-semibold text-secondary hover:bg-surface-2 hover:text-primary"
              onClick={() => setSort((s) => (s === "date" ? "name" : "date"))}
              title="Change sort order">
              <ArrowDownUp size={12} /> {sort === "date" ? "By date" : "By name"}
            </button>
            {meta && (
              <span className="ml-auto text-xs font-semibold text-muted">
                {meta.total} conversation{meta.total === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {/* folder + email-type pill strip */}
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
            {FOLDERS.map((f) => (
              <button key={f.key} type="button" className={pillCls(folder === f.key && !tag)}
                onClick={() => setFolder(f.key)}>
                <f.icon size={13} /> {f.label}
              </button>
            ))}
            <span className="mx-1 inline-flex shrink-0 items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted">
              <Tag size={11} /> Email type
            </span>
            {tags.map((t) => (
              <button key={t.event} type="button"
                className={pillCls(tag === t.event)}
                onClick={() => setTag(tag === t.event ? "" : t.event)}
                title={tag === t.event ? "Clear tag filter" : tagLabel(t.event, t.label)}>
                <span className="max-w-[14rem] truncate">{tagLabel(t.event, t.label)}</span>
                <span className={`rounded-full px-1.5 text-[10px] font-bold ${tag === t.event ? "bg-white/25 text-white" : "bg-surface-2 text-muted"}`}>{t.count}</span>
                {tag === t.event && <span aria-hidden>✕</span>}
              </button>
            ))}
            {tags.length === 0 && <span className="shrink-0 text-xs text-muted">No emails sent yet.</span>}
          </div>
        </div>
      </PageHeader>

      {error && <ErrorBox error={error} onRetry={load} />}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(300px,380px)_1fr]">
        {/* ---------------------- conversation list ---------------------- */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised lg:max-h-[calc(100vh-15rem)]">
          <div className="flex items-center justify-between gap-2 border-b border-subtle px-3.5 py-2.5">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
              <Inbox size={13} aria-hidden />
              <span className="truncate">
                {tag ? tagLabel(tag, tags.find((t) => t.event === tag)?.label) : (FOLDERS.find((f) => f.key === folder)?.label || "Sent to candidates")}
              </span>
            </span>
            {meta && meta.pages > 1 && (
              <span className="shrink-0 text-[11px] text-muted">Page {meta.page} of {meta.pages}</span>
            )}
          </div>
          <div className="min-h-0 max-h-[60vh] flex-1 overflow-y-auto lg:max-h-none">
            {threads === null && !error && <Spinner label="Loading…" />}
            {threads !== null && threads.length === 0 && (
              <EmptyState message="No emails match these filters." icon={<Inbox size={26} />} />
            )}
            {grouped.map((g) => (
              <Fragment key={g.label}>
                <div className="sticky top-0 z-[1] border-b border-subtle bg-surface-2 px-3.5 py-1 text-[11px] font-bold uppercase tracking-wide text-muted">
                  {g.label}
                </div>
                {g.items.map((c) => {
                  const active = openKey === c.key;
                  const badge = c.failed > 0 ? "Failed" : c.queued > 0 ? "Queued" : c.latest.status;
                  const who = c.candidate_name || c.to_email;
                  return (
                    <button key={c.key} type="button" onClick={() => setOpenKey(c.key)}
                      aria-current={active ? "true" : undefined}
                      className={`block w-full border-b border-l-[3px] border-subtle px-3.5 py-3 text-left transition-colors duration-micro ${
                        active
                          ? "border-l-purple-600 bg-purple-50 dark:bg-purple-500/15"
                          : "border-l-transparent hover:bg-surface-2"}`}>
                      <div className="flex items-start gap-3">
                        <Avatar name={who} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-bold text-primary">{who}</span>
                            <span className="shrink-0 text-[11px] font-medium text-muted" title={fmtWhen(c.latest_at)}>
                              {fmtRelative(c.latest_at)}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between gap-2">
                            <span className="truncate text-[13px] font-medium text-secondary">{c.latest.subject}</span>
                            {c.count > 1 && (
                              <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10px] font-bold text-muted ring-1 ring-inset ring-slate-200 dark:ring-slate-700"
                                title={`${c.count} emails in this conversation`}>{c.count}</span>
                            )}
                          </div>
                          <div className="mt-1 flex min-w-0 items-center gap-1.5">
                            <MailStatusChip status={badge} />
                            <span className="shrink-0 truncate rounded-full bg-purple-100 px-1.5 py-px text-[10px] font-semibold text-purple-800 dark:bg-purple-500/20 dark:text-purple-200">
                              {tagLabel(c.latest.event, c.latest.event_label)}
                            </span>
                          </div>
                          {c.latest.snippet && (
                            <div className="mt-1 truncate text-xs text-muted">{c.latest.snippet}</div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </div>
          {meta && meta.pages > 1 && (
            <div className="flex items-center justify-between border-t border-subtle px-3.5 py-2">
              <button className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs font-semibold text-purple-700 hover:bg-surface-2 disabled:text-muted dark:text-purple-300"
                disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Newer</button>
              <span className="text-[11px] text-muted">Page {meta.page} of {meta.pages}</span>
              <button className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs font-semibold text-purple-700 hover:bg-surface-2 disabled:text-muted dark:text-purple-300"
                disabled={page >= meta.pages} onClick={() => setPage((p) => p + 1)}>Older →</button>
            </div>
          )}
        </div>

        {/* -------------------------- reading pane -------------------------- */}
        <div className="min-h-0 overflow-y-auto rounded-card border border-subtle bg-surface-1 shadow-raised lg:max-h-[calc(100vh-15rem)]">
          {!selected ? (
            <EmptyState message="Select a conversation to read it." icon={<Mail size={26} />} />
          ) : (
            <>
              {/* thread header — name, address, count, prev/next */}
              <div className="sticky top-0 z-10 border-b border-subtle bg-surface-1 px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar name={selected.candidate_name || selected.to_email} size="lg" />
                  <div className="min-w-0 flex-1">
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
                  <div className="flex items-center gap-1.5">
                    {canCompose && selected.candidate_id != null && thread && thread[0] && (
                      <button className={`${btnSecondary} !min-h-0 !px-2.5 !py-1 text-xs`} onClick={() => replyTo(thread[0])}>
                        <Reply size={13} /> Reply
                      </button>
                    )}
                    <div className="inline-flex overflow-hidden rounded-control border border-subtle">
                      <button type="button" aria-label="Previous conversation"
                        className="p-1.5 text-muted hover:bg-surface-2 hover:text-primary disabled:opacity-40"
                        disabled={selectedIdx <= 0}
                        onClick={() => setOpenKey(threads?.[selectedIdx - 1]?.key || null)}>
                        <ChevronLeft size={15} />
                      </button>
                      <button type="button" aria-label="Next conversation"
                        className="border-l border-subtle p-1.5 text-muted hover:bg-surface-2 hover:text-primary disabled:opacity-40"
                        disabled={selectedIdx < 0 || !threads || selectedIdx >= threads.length - 1}
                        onClick={() => setOpenKey(threads?.[selectedIdx + 1]?.key || null)}>
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  </div>
                </div>
                {thread && thread[0] && (
                  <div className="mt-2.5 text-lg font-bold leading-snug text-primary">{thread[0].subject}</div>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 font-semibold">
                    <Mail size={11} aria-hidden />
                    {thread ? `${thread.length} email${thread.length === 1 ? "" : "s"}` : "…"}
                  </span>
                  <span>Latest {fmtDay(selected.latest_at)}</span>
                  {selected.failed > 0 && <MailStatusChip status="Failed" label={`${selected.failed} failed`} />}
                  {selected.queued > 0 && <MailStatusChip status="Queued" label={`${selected.queued} queued`} />}
                </div>
              </div>

              {/* the conversation: latest open, older collapsed */}
              <div className="space-y-2.5 p-3 sm:p-4">
                {thread === null && <Spinner label="Loading thread…" />}
                {thread?.map((m) => {
                  const open = expanded.has(m.id);
                  const fromLabel = m.from_name || "Karnex";
                  return (
                    <article key={m.id}
                      className={`overflow-hidden rounded-card border transition-shadow ${
                        open ? "border-purple-200 bg-surface-1 shadow-raised dark:border-purple-500/40" : "border-subtle bg-surface-2"}`}>
                      <button type="button" onClick={() => toggleExpanded(m.id)} aria-expanded={open}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-purple-500 to-fuchsia-600 text-xs font-bold text-white">
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
                        <MailStatusChip status={m.status} />
                        {open ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
                      </button>
                      {open && (
                        <>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-subtle bg-surface-2 px-4 py-2 text-xs text-muted">
                            <span className="font-semibold text-secondary">{m.subject}</span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 font-semibold text-purple-800 dark:bg-purple-500/20 dark:text-purple-200">
                              <Tag size={10} /> {tagLabel(m.event, m.event_label)}
                            </span>
                            {m.reply_to_email && (
                              <span>Reply-To: <span className="text-secondary">{m.reply_to_name || m.reply_to_email}</span></span>
                            )}
                            {canCompose && selected.candidate_id != null && (
                              <button type="button" className="ml-auto inline-flex items-center gap-1 font-semibold text-purple-700 hover:underline dark:text-purple-300"
                                onClick={() => replyTo(m)}>
                                <Reply size={12} /> Reply
                              </button>
                            )}
                          </div>
                          {m.status === "Failed" && m.last_error && (
                            <div className="mx-4 mt-3 rounded-control border border-danger bg-danger-soft px-3 py-2 text-xs text-danger">
                              Failed after {m.attempts} attempt{m.attempts === 1 ? "" : "s"}: {m.last_error}
                            </div>
                          )}
                          <pre className="whitespace-pre-wrap break-words px-4 py-4 font-sans text-sm leading-relaxed text-primary">
                            {m.body_text}
                          </pre>
                        </>
                      )}
                    </article>
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

/* ---------- presentation helpers (29 Sep 2026 redesign) ---------- */

/** One colour per delivery status — Sent green, Queued amber, Failed red,
 *  Skipped grey. The word is always printed; colour is a second channel. */
const MAIL_STATUS: Record<string, { chip: string; dot: string; hint: string }> = {
  Sent: {
    chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
    dot: "bg-emerald-500", hint: "Delivered to the mail server",
  },
  Queued: {
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
    dot: "bg-amber-500", hint: "Waiting in the outbox — it goes out on the next send",
  },
  Failed: {
    chip: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200",
    dot: "bg-rose-500", hint: "The mail server refused it — open the email for the reason",
  },
  Skipped: {
    chip: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200",
    dot: "bg-slate-400", hint: "Not sent (no real address, or mail is switched off)",
  },
};

function MailStatusChip({ status, label }: { status?: string | null; label?: string }) {
  if (!status) return null;
  const look = MAIL_STATUS[status] || {
    chip: "bg-surface-2 text-secondary", dot: "bg-slate-400", hint: status,
  };
  return (
    <span title={look.hint}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-bold ${look.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${look.dot}`} aria-hidden />
      {label || status}
    </span>
  );
}

const AVATAR_TONES = [
  "from-purple-500 to-fuchsia-600",
  "from-sky-500 to-indigo-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-rose-500 to-pink-600",
  "from-indigo-500 to-blue-600",
];

function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  let h = 0;
  for (const ch of name || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const tone = AVATAR_TONES[h % AVATAR_TONES.length];
  const dims = size === "lg" ? "h-10 w-10 text-sm" : "mt-0.5 h-9 w-9 text-xs";
  return (
    <span aria-hidden
      className={`grid shrink-0 place-items-center rounded-full bg-gradient-to-br ${tone} font-bold text-white shadow-raised ${dims}`}>
      {initialsOf(name)}
    </span>
  );
}

/** "just now", "12m", "3h", then the Outlook list clock. */
function fmtRelative(v: string | null | undefined): string {
  if (!v) return "—";
  const diffMin = Math.floor((Date.now() - new Date(v).getTime()) / 60000);
  if (Number.isNaN(diffMin)) return "—";
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 12 * 60) return `${Math.floor(diffMin / 60)}h ago`;
  return fmtListTime(v);
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
