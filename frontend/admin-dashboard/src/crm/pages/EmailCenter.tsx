/**
 * Emails — the candidate mail center, Outlook-style three-pane (27 Aug 2026
 * redesign to the user's mock): folder rail | conversation list | thread.
 *
 *   Rail:   New Email · Inbox / Sent Items / Drafts / Archive · Tags (events)
 *   List:   one row per candidate — name, latest subject, snippet, chip+time
 *   Thread: header (name, address, N emails) + stacked mail cards
 *
 * Folder semantics on OUTBOUND-only data (honest mapping): "Sent Items" =
 * mail TO candidates (candidate.*); "Inbox" = mail coming back to staff about
 * them (slot confirmations). Drafts/Archive render but hold nothing yet.
 * Candidate replies go to the sending recruiter's mailbox (Reply-To) —
 * Karnex has no inbound receiver.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive, ChevronLeft, ChevronRight, FileText, Inbox, Mail, PenSquare,
  Search, Send, Tag,
} from "lucide-react";
import { crmGet, crmPost, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanAct } from "../useAccess";
import { CrmLink } from "../routerHooks";
import { SearchableSelect } from "../components/SearchableSelect";
import {
  EmptyState, ErrorBox, Modal, Spinner, StatusBadge, btnPrimary, btnSecondary,
  inputCls, useToast,
} from "../components/ui";

type MailRow = {
  id: number;
  candidate_id: number | null;
  candidate_name: string;
  to_email: string;
  to_name?: string | null;
  event: string;
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

type Conversation = {
  key: string;
  candidate_id: number | null;
  candidate_name: string;
  to_email: string;
  candidate_email: string | null;
  latest: MailRow;
  count: number;
  anyFailed: boolean;
};

type TagRow = { event: string; count: number };

const STATUS_FILTERS = ["", "Sent", "Queued", "Failed", "Skipped"] as const;

const FOLDERS = [
  { key: "", label: "All Mail", icon: Mail },
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "sent", label: "Sent Items", icon: Send },
  { key: "drafts", label: "Drafts", icon: FileText },
  { key: "archive", label: "Archive", icon: Archive },
] as const;

const fmtWhen = (r: MailRow) => {
  const v = r.sent_at || r.created_at;
  return v ? new Date(v).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
};
const fmtDay = (r: MailRow) => {
  const v = r.sent_at || r.created_at;
  return v ? new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
};
/** "candidate.interview_link" → "interview_link" — the mock shows short tags. */
const tagLabel = (e: string) => (e.split(".").pop() || e);

const convKey = (r: MailRow) =>
  r.candidate_id != null ? `cand:${r.candidate_id}` : `mail:${(r.to_email || "").toLowerCase()}`;

const groupConversations = (rows: MailRow[]): Conversation[] => {
  const out: Conversation[] = [];
  const byKey = new Map<string, Conversation>();
  for (const r of rows) {
    const key = convKey(r);
    const candMail = r.event?.startsWith("candidate.") ? r.to_email : null;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      existing.anyFailed = existing.anyFailed || r.status === "Failed";
      if (!existing.candidate_email && candMail) existing.candidate_email = candMail;
    } else {
      byKey.set(key, {
        key, candidate_id: r.candidate_id, candidate_name: r.candidate_name,
        to_email: r.to_email, candidate_email: candMail, latest: r, count: 1,
        anyFailed: r.status === "Failed",
      });
      out.push(byKey.get(key)!);
    }
  }
  return out;
};

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("") || "?";

export function EmailCenterPage() {
  const roleOk = useHasRole("TA", "RMG", "Sales", "Sales_Head", "HR");
  const allowed = useCanAct("emails", "view", roleOk);
  const canCompose = useCanAct("emails", "edit", roleOk);
  const [toast, showToast] = useToast();

  const [rows, setRows] = useState<MailRow[] | null>(null);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [folder, setFolder] = useState<string>("");
  const [tag, setTag] = useState("");
  const [tags, setTags] = useState<TagRow[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [thread, setThread] = useState<MailRow[] | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setSearch(draft.trim()), 350);
    return () => window.clearTimeout(t);
  }, [draft]);
  useEffect(() => setPage(1), [search, status, folder, tag]);

  useEffect(() => {
    crmGet<TagRow[]>("/api/candidates/email-tags")
      .then((r) => setTags(r.data || []))
      .catch(() => { /* rail degrades to no tags */ });
  }, []);

  const emptyFolder = folder === "drafts" || folder === "archive";

  const load = useCallback(() => {
    if (emptyFolder) { setRows([]); setMeta(undefined); return; }
    setError("");
    crmGet<MailRow[]>(`/api/candidates/email-conversations${qs({
      search: search || undefined,
      status: status || undefined,
      folder: folder || undefined,
      event: tag || undefined,
      page,
      limit: 50,
    })}`)
      .then((r) => {
        const data = r.data || [];
        setRows(data);
        setMeta(r.meta);
        setOpenKey((prev) => prev ?? (data[0] ? convKey(data[0]) : null));
      })
      .catch((e: any) => setError(e?.message || "Failed to load emails"));
  }, [search, status, folder, tag, page, emptyFolder]);
  useEffect(() => { setRows(null); load(); }, [load]);

  const conversations = useMemo(() => (rows ? groupConversations(rows) : []), [rows]);
  const selected = conversations.find((c) => c.key === openKey) || null;
  const selectedIdx = selected ? conversations.findIndex((c) => c.key === selected.key) : -1;

  useEffect(() => {
    if (!selected) { setThread(null); return; }
    let cancelled = false;
    setThread(null);
    const params = selected.candidate_id != null
      ? { candidate_id: selected.candidate_id, limit: 100 }
      : { search: selected.to_email, limit: 100 };
    crmGet<MailRow[]>(`/api/candidates/email-conversations${qs(params)}`)
      .then((r) => {
        if (cancelled) return;
        const mails = (r.data || [])
          .filter((m) => convKey(m) === selected.key)
          .sort((a, b) =>
            new Date(b.sent_at || b.created_at || 0).getTime() -
            new Date(a.sent_at || a.created_at || 0).getTime());
        setThread(mails);
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
            <Tag size={11} /> {tagLabel(tag)} ✕
          </button>
        )}
        {meta && (
          <span className="ml-auto text-xs text-muted">
            {meta.total} email{meta.total === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[200px_minmax(260px,340px)_1fr]">
        {/* ------------------------- folder rail ------------------------- */}
        <div className="rounded-card border border-subtle bg-surface-1 p-2">
          {canCompose && (
            <button className={`${btnPrimary} mb-2 w-full justify-center`} onClick={() => setComposeOpen(true)}>
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
              <Tag size={11} /> Tags
            </div>
            {tags.slice(0, 8).map((t) => (
              <button key={t.event} type="button"
                className={railBtn(tag === t.event)}
                onClick={() => setTag(tag === t.event ? "" : t.event)}>
                <span className="min-w-0 truncate text-xs">{tagLabel(t.event)}</span>
                <span className="ml-auto text-[10px] text-muted">{t.count}</span>
              </button>
            ))}
            {tags.length === 0 && <p className="px-3 py-1 text-xs text-muted">No tags yet.</p>}
          </div>
        </div>

        {/* ---------------------- conversation list ---------------------- */}
        <div className="min-h-0 overflow-y-auto rounded-card border border-subtle bg-surface-1">
          {rows === null && !error && <Spinner label="Loading…" />}
          {rows !== null && conversations.length === 0 && (
            <EmptyState
              message={emptyFolder
                ? `Nothing in ${folder === "drafts" ? "Drafts" : "Archive"} yet.`
                : "No emails match these filters."}
              icon={<Inbox size={26} />}
            />
          )}
          {conversations.map((c) => (
            <button key={c.key} type="button" onClick={() => setOpenKey(c.key)}
              className={`block w-full border-b border-subtle px-3.5 py-3 text-left transition-colors duration-micro ${
                openKey === c.key ? "bg-brand-600/10" : "hover:bg-surface-2"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-bold text-primary">
                  {c.candidate_name || c.to_email}
                </span>
                <span className="shrink-0 text-[11px] text-muted">{fmtWhen(c.latest)}</span>
              </div>
              <div className="mt-0.5 truncate text-[13px] font-medium text-secondary">{c.latest.subject}</div>
              <div className="mt-0.5 flex items-center gap-2">
                <StatusBadge status={c.anyFailed ? "Failed" : c.latest.status} />
                <span className="min-w-0 truncate text-xs text-muted">
                  {c.latest.body_text?.replace(/\s+/g, " ").slice(0, 70)}
                </span>
              </div>
            </button>
          ))}
          {meta && meta.pages > 1 && (
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <button className="text-xs font-semibold text-brand-600 disabled:text-muted dark:text-brand-300"
                disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Newer</button>
              <button className="text-xs font-semibold text-brand-600 disabled:text-muted dark:text-brand-300"
                disabled={page >= meta.pages} onClick={() => setPage((p) => p + 1)}>Older →</button>
            </div>
          )}
        </div>

        {/* -------------------------- thread pane -------------------------- */}
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
                    <span className="text-xs font-semibold text-muted">
                      {thread ? `${thread.length} email${thread.length === 1 ? "" : "s"}` : "…"}
                    </span>
                    <span className="text-xs text-muted">{fmtDay(selected.latest)}</span>
                    <button type="button" aria-label="Previous conversation"
                      className="rounded-control p-1 text-muted hover:bg-surface-2 hover:text-primary disabled:opacity-40"
                      disabled={selectedIdx <= 0}
                      onClick={() => setOpenKey(conversations[selectedIdx - 1]?.key || null)}>
                      <ChevronLeft size={15} />
                    </button>
                    <button type="button" aria-label="Next conversation"
                      className="rounded-control p-1 text-muted hover:bg-surface-2 hover:text-primary disabled:opacity-40"
                      disabled={selectedIdx < 0 || selectedIdx >= conversations.length - 1}
                      onClick={() => setOpenKey(conversations[selectedIdx + 1]?.key || null)}>
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </div>
              </div>

              {/* stacked mail cards, newest first (as in the mock) */}
              <div className="space-y-3 p-4">
                {thread === null && <Spinner label="Loading thread…" />}
                {thread?.map((m) => (
                  <div key={m.id} className="rounded-card border border-subtle bg-surface-2/40">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-subtle px-4 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-sm font-bold text-primary">{m.subject}</span>
                      <span className="text-xs text-muted">{fmtWhen(m)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-2 text-xs text-muted">
                      <StatusBadge status={m.status} />
                      <span>To: <span className="font-semibold text-secondary">{m.to_name || m.to_email}</span></span>
                      {m.from_name && <span>From: <span className="font-semibold text-secondary">{m.from_name}</span></span>}
                      <span className="inline-flex items-center gap-1"><Tag size={10} /> {tagLabel(m.event)}</span>
                      {m.status === "Failed" && m.last_error && (
                        <span className="text-danger">Failed: {m.last_error}</span>
                      )}
                    </div>
                    <pre className="whitespace-pre-wrap px-4 py-3 font-sans text-sm leading-relaxed text-primary">
                      {m.body_text}
                    </pre>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {composeOpen && (
        <ComposeModal
          presetCandidateId={selected?.candidate_id ?? null}
          onClose={() => setComposeOpen(false)}
          onSent={(msg) => { setComposeOpen(false); showToast(msg); load(); }}
          onError={(m) => showToast(m, "err")}
        />
      )}
      {toast}
    </div>
  );
}

/** New Email — free-form mail to one candidate, queued on the durable outbox
 * with the author's Reply-To, so replies come back to the writer. */
function ComposeModal({ presetCandidateId, onClose, onSent, onError }: {
  presetCandidateId: number | null;
  onClose: () => void;
  onSent: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [candidates, setCandidates] = useState<{ id: number; name: string; email: string }[]>([]);
  const [candidateId, setCandidateId] = useState(presetCandidateId ? String(presetCandidateId) : "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    crmGet<any[]>("/api/candidates?limit=100")
      .then((r) => setCandidates((r.data || []).map((c: any) => ({
        id: c.id,
        name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email,
        email: c.email || "",
      }))))
      .catch(() => {});
  }, []);

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
      onError(e?.message || "Failed to send");
      setBusy(false);
    }
  };

  return (
    <Modal title="New Email" onClose={onClose} dirty={!!(subject.trim() || body.trim())}>
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
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Subject</label>
          <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Next steps for your application" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Message</label>
          <textarea className={`${inputCls} min-h-40 resize-y !h-auto py-2 leading-relaxed`}
            value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message… replies will come to your own mailbox." />
        </div>
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
