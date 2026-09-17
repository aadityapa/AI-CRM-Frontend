/**
 * Help & Support — the bottom-right bot (14 Sep 2026).
 *
 * Mounted once in the App shell so it floats on every page. Three views:
 *   • Chat — the bot answers how-to / where-is-it questions from the built-in
 *     help KB (+ OpenAI). Every reply carries "Solved" / "Raise a ticket"; when
 *     the bot judges the problem is beyond it (`escalate`) the ticket form is
 *     offered straight away.
 *   • Raise ticket — subject / description / category / priority; the chat
 *     transcript and the current page travel with it. Admin/CEO are notified.
 *   • My tickets — status, thread with admin replies, reply back, rate.
 *
 * Backend: routers/crm/support.py.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, LifeBuoy, Send, ThumbsDown, ThumbsUp, TicketCheck, X } from "lucide-react";
import { BOT_NAME, KarnexBot, type BotDock } from "./KarnexBot";

import { crmGet, crmPatch, crmPost } from "../../crm/api";
import { MarkdownLite } from "../ask-ai/markdownLite";
import { fmtDateTime12 } from "../../lib/datetime";

type Turn = { role: "user" | "assistant"; content: string; escalate?: boolean; at: number };
type TicketMessage = { id: number; author_name: string | null; is_staff: boolean; is_system: boolean; body: string; created_at: string | null };
type Ticket = {
  id: number; ticket_no: string; subject: string; description: string; category: string; priority: string;
  status: string; page: string | null; created_at: string | null; updated_at: string | null;
  resolved_at: string | null; rating: number | null; message_count: number; last_message_at: string | null;
  messages?: TicketMessage[]; bot_transcript?: { role: string; content: string }[];
};
type Meta = { categories: string[]; priorities: string[]; statuses: string[]; is_staff: boolean };

type View = "chat" | "ticket" | "tickets" | "thread";

const GREETING: Turn = {
  role: "assistant",
  content: "Hi! I'm the Karnex support assistant. Ask me how to do something, where a setting lives, or why a "
    + "screen shows what it shows. If I can't solve it, you can raise a ticket and the admin team will take over.",
  at: 0,
};

const QUICK = [
  "How do I apply leave?",
  "Where do I change the invoice bank account?",
  "Why is a timesheet day showing LOP?",
  "I found a bug",
];

const CATEGORY_LABEL: Record<string, string> = {
  Bug: "Bug / error", Data_Issue: "Wrong data", Access: "Access / permission",
  How_To: "How do I…", Feature_Request: "Feature request", Other: "Other",
};
const STATUS_STYLE: Record<string, string> = {
  Open: "bg-info-soft text-info", In_Progress: "bg-warning-soft text-warning",
  Resolved: "bg-success-soft text-success", Closed: "bg-surface-2 text-muted",
};

function currentPage(): string {
  const p = new URLSearchParams(window.location.search);
  return (p.get("p") || p.get("view") || "dashboard").split("?")[0];
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : fmtDateTime12(d);
}

export function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("chat");
  const [turns, setTurns] = useState<Turn[]>([GREETING]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  /** Where the bot is docked — the panel opens beside it, on the same side. */
  const [dock, setDock] = useState<BotDock>({ side: "right", bottom: 24 });
  const onDockChange = useCallback((d: BotDock) => setDock(d), []);

  // ticket form
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Other");
  const [priority, setPriority] = useState("Medium");
  const [submitting, setSubmitting] = useState(false);
  const [reply, setReply] = useState("");

  const loadMeta = useCallback(async () => {
    try {
      const r = await crmGet<Meta>("/api/support/tickets/meta");
      setMeta(r.data);
    } catch { /* widget still works with defaults */ }
  }, []);
  const loadSummary = useCallback(async () => {
    try {
      const r = await crmGet<{ open: number }>("/api/support/tickets/summary");
      setOpenCount(r.data?.open || 0);
    } catch { /* badge is a convenience */ }
  }, []);
  const loadTickets = useCallback(async () => {
    try {
      const r = await crmGet<Ticket[]>("/api/support/tickets?mine=1&limit=50");
      setTickets(r.data || []);
    } catch (e: any) { setError(e?.message || "Could not load tickets"); }
  }, []);
  const openTicket = useCallback(async (id: number) => {
    try {
      const r = await crmGet<Ticket>(`/api/support/tickets/${id}`);
      setTicket(r.data);
      setView("thread");
      setError("");
    } catch (e: any) { setError(e?.message || "Could not open ticket"); }
  }, []);

  useEffect(() => {
    loadSummary();
    const t = window.setInterval(loadSummary, 120_000);
    return () => window.clearInterval(t);
  }, [loadSummary]);

  useEffect(() => {
    if (!open) return;
    loadMeta();
    loadSummary();
    if (view === "tickets") loadTickets();
    if (view === "chat") window.setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, view, loadMeta, loadSummary, loadTickets]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [turns, thinking, view, ticket]);

  // Esc closes — only when focus is inside the widget, so a page Modal's own
  // Escape handling is untouched; focus returns to the trigger button.
  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && panelRef.current?.contains(document.activeElement)) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const transcript = useMemo(
    () => turns.filter((t) => t.at !== 0).map((t) => ({ role: t.role, content: t.content })),
    [turns],
  );

  const send = async (text?: string) => {
    const msg = (text ?? draft).trim();
    if (!msg || thinking) return;
    setDraft("");
    setError("");
    const next: Turn[] = [...turns, { role: "user", content: msg, at: Date.now() }];
    setTurns(next);
    setThinking(true);
    try {
      const history = next.filter((t) => t.at !== 0).slice(-10).map((t) => ({ role: t.role, content: t.content }));
      const r = await crmPost<{ reply: string; escalate: boolean }>("/api/support/chat", {
        message: msg, route: currentPage(), history: history.slice(0, -1),
      });
      setTurns((prev) => [...prev, { role: "assistant", content: r.data.reply, escalate: !!r.data.escalate, at: Date.now() }]);
    } catch (e: any) {
      setTurns((prev) => [...prev, {
        role: "assistant", escalate: true, at: Date.now(),
        content: e?.message?.includes("429")
          ? "You're sending messages a little fast — give me a moment. If it's urgent, raise a ticket."
          : "I couldn't reach the assistant just now. You can raise a ticket and the admin team will help.",
      }]);
    } finally {
      setThinking(false);
    }
  };

  const startTicket = (fromTurn?: Turn) => {
    const firstUser = turns.find((t) => t.role === "user");
    setSubject((s) => s || (firstUser?.content || "").slice(0, 120));
    setDescription((d) => d || (firstUser ? `${firstUser.content}\n\n` : ""));
    setCategory(fromTurn?.escalate ? "Bug" : "Other");
    setView("ticket");
  };

  const submitTicket = async () => {
    if (subject.trim().length < 3 || description.trim().length < 10) {
      setError("Please give a subject and describe the issue (at least 10 characters).");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const r = await crmPost<Ticket>("/api/support/tickets", {
        subject: subject.trim(), description: description.trim(), category, priority,
        page: currentPage(), bot_transcript: transcript.slice(-30),
      });
      setTicket(r.data);
      setSubject(""); setDescription(""); setCategory("Other"); setPriority("Medium");
      setTurns([GREETING]);
      setView("thread");
      loadSummary();
    } catch (e: any) {
      setError(e?.message || "Could not raise the ticket");
    } finally {
      setSubmitting(false);
    }
  };

  const sendReply = async () => {
    if (!ticket || !reply.trim()) return;
    try {
      const r = await crmPost<Ticket>(`/api/support/tickets/${ticket.id}/messages`, { body: reply.trim() });
      setTicket(r.data);
      setReply("");
    } catch (e: any) { setError(e?.message || "Could not send reply"); }
  };

  const rate = async (n: number) => {
    if (!ticket) return;
    try {
      const r = await crmPost<Ticket>(`/api/support/tickets/${ticket.id}/rating`, { rating: n });
      setTicket({ ...ticket, rating: r.data.rating });
    } catch (e: any) { setError(e?.message || "Could not save rating"); }
  };

  const closeMine = async () => {
    if (!ticket) return;
    try {
      const r = await crmPatch<Ticket>(`/api/support/tickets/${ticket.id}`, { status: "Closed" });
      setTicket(r.data);
    } catch { /* non-staff: server refuses; button is hidden for them anyway */ }
  };

  const header = (title: string, back?: View) => (
    <div className="flex items-center gap-2 border-b border-subtle px-3 py-2">
      {back && (
        <button type="button" className="rounded-control p-1 text-muted hover:bg-surface-2 hover:text-primary"
          onClick={() => { setView(back); setError(""); }} aria-label="Back">
          <ChevronLeft size={16} aria-hidden />
        </button>
      )}
      <LifeBuoy size={16} className="text-brand-600" aria-hidden />
      <div className="min-w-0 flex-1 truncate text-sm font-bold text-primary">{title}</div>
      {view !== "tickets" && view !== "thread" && (
        <button type="button" className="rounded-full px-2 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-50"
          onClick={() => { setError(""); setView("tickets"); }}>
          My tickets{openCount > 0 ? ` (${openCount})` : ""}
        </button>
      )}
      <button type="button" className="rounded-control p-1 text-muted hover:bg-surface-2 hover:text-primary"
        onClick={close} aria-label="Close support">
        <X size={16} aria-hidden />
      </button>
    </div>
  );

  // Beside the bot, on its side; never off the top of the viewport.
  const panelStyle: CSSProperties = {
    [dock.side]: 20,
    bottom: Math.min(dock.bottom + 76, Math.max(20, window.innerHeight - 620)),
  };

  return (
    <>
      <KarnexBot
        open={open}
        openCount={openCount}
        onToggle={() => (open ? close() : setOpen(true))}
        onDockChange={onDockChange}
        triggerRef={triggerRef}
      />

      {open && (
        <div
          ref={panelRef}
          id="support-widget-panel"
          role="dialog"
          aria-modal="false"
          aria-label="Help and Support"
          className="fixed z-[60] flex h-[min(600px,calc(100vh-7rem))] w-[min(400px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-modal border border-subtle bg-surface-1 shadow-modal"
          style={panelStyle}
        >
          {view === "chat" && (
            <>
              {header(BOT_NAME)}
              <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
                {turns.map((t, i) => (
                  <div key={i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[88%] rounded-card px-3 py-2 text-sm ${
                      t.role === "user" ? "bg-brand-600 text-white" : "bg-surface-2 text-primary"}`}>
                      {t.role === "user" ? <div className="whitespace-pre-wrap">{t.content}</div> : <MarkdownLite text={t.content} />}
                      {t.role === "assistant" && t.at !== 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-subtle/60 pt-1.5 text-[11px]">
                          {t.escalate ? (
                            <span className="text-warning">This needs the admin team.</span>
                          ) : (
                            <button type="button" className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-success hover:bg-success-soft"
                              onClick={() => setTurns((p) => [...p, { role: "assistant", content: "Glad that helped! Anything else?", at: Date.now() }])}>
                              <ThumbsUp size={12} aria-hidden /> Solved
                            </button>
                          )}
                          <button type="button" className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold text-brand-700 hover:bg-brand-50"
                            onClick={() => startTicket(t)}>
                            {t.escalate ? <TicketCheck size={12} aria-hidden /> : <ThumbsDown size={12} aria-hidden />}
                            {t.escalate ? "Raise a ticket" : "Not helpful — raise a ticket"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {thinking && <div className="text-xs text-muted">Thinking…</div>}
                {turns.length === 1 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {QUICK.map((q) => (
                      <button key={q} type="button" className="rounded-full border border-subtle px-2.5 py-1 text-xs text-secondary hover:bg-surface-2"
                        onClick={() => send(q)}>{q}</button>
                    ))}
                  </div>
                )}
              </div>
              {error && <div className="px-3 pb-1 text-xs text-danger">{error}</div>}
              <form className="flex items-end gap-2 border-t border-subtle p-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
                <textarea
                  ref={inputRef}
                  className="max-h-28 min-h-[38px] flex-1 resize-none rounded-control border border-subtle bg-surface-0 px-3 py-2 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="Describe your issue or ask a question…"
                  value={draft}
                  rows={1}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  aria-label="Message"
                />
                <button type="submit" className="rounded-control bg-brand-600 p-2 text-white disabled:opacity-50" disabled={thinking || !draft.trim()} aria-label="Send">
                  <Send size={16} aria-hidden />
                </button>
              </form>
              <div className="flex items-center justify-between border-t border-subtle px-3 py-1.5 text-[11px] text-muted">
                <span>Answers come from the built-in help + AI. Nothing is changed on your behalf.</span>
                <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => startTicket()}>Raise a ticket</button>
              </div>
            </>
          )}

          {view === "ticket" && (
            <>
              {header("Raise a ticket", "chat")}
              <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">Subject</span>
                  <input className="mt-1 w-full rounded-control border border-subtle bg-surface-0 px-3 py-2 text-sm" value={subject}
                    maxLength={255} onChange={(e) => setSubject(e.target.value)} placeholder="Short summary" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">What's happening?</span>
                  <textarea className="mt-1 w-full rounded-control border border-subtle bg-surface-0 px-3 py-2 text-sm" rows={5}
                    value={description} onChange={(e) => setDescription(e.target.value)}
                    placeholder="What did you do, what did you expect, what did you see instead? Mention the record (e.g. invoice number, candidate name)." />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">Category</span>
                    <select className="mt-1 w-full rounded-control border border-subtle bg-surface-0 px-2 py-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
                      {(meta?.categories || Object.keys(CATEGORY_LABEL)).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c] || c}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">Priority</span>
                    <select className="mt-1 w-full rounded-control border border-subtle bg-surface-0 px-2 py-2 text-sm" value={priority} onChange={(e) => setPriority(e.target.value)}>
                      {(meta?.priorities || ["Low", "Medium", "High", "Urgent"]).map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </label>
                </div>
                <p className="text-[11px] text-muted">
                  Sent with the ticket: your name and role, the page you're on ({currentPage()}), and this chat
                  ({transcript.length} message{transcript.length === 1 ? "" : "s"}). Admin/CEO get a notification and an email.
                </p>
                {error && <div className="text-xs text-danger">{error}</div>}
              </div>
              <div className="flex justify-end gap-2 border-t border-subtle p-2">
                <button type="button" className="rounded-control px-3 py-2 text-sm text-secondary hover:bg-surface-2" onClick={() => setView("chat")}>Back</button>
                <button type="button" className="rounded-control bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={submitting} onClick={submitTicket}>
                  {submitting ? "Raising…" : "Raise ticket"}
                </button>
              </div>
            </>
          )}

          {view === "tickets" && (
            <>
              {header("My tickets", "chat")}
              <div className="flex-1 overflow-y-auto">
                {tickets.length === 0 ? (
                  <div className="p-4 text-sm text-muted">No tickets yet. Ask the assistant first — if it can't help, raise one.</div>
                ) : tickets.map((t) => (
                  <button key={t.id} type="button" className="flex w-full items-start gap-2 border-b border-subtle px-3 py-2.5 text-left hover:bg-surface-2"
                    onClick={() => openTicket(t.id)}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-muted">{t.ticket_no}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[t.status] || ""}`}>{t.status.replace("_", " ")}</span>
                        <span className="text-[10px] text-muted">{t.priority}</span>
                      </div>
                      <div className="truncate text-sm font-semibold text-primary">{t.subject}</div>
                      <div className="text-[11px] text-muted">{CATEGORY_LABEL[t.category] || t.category} · updated {fmt(t.updated_at)}</div>
                    </div>
                  </button>
                ))}
              </div>
              {error && <div className="px-3 py-1 text-xs text-danger">{error}</div>}
              <div className="border-t border-subtle p-2">
                <button type="button" className="w-full rounded-control bg-brand-600 px-3 py-2 text-sm font-semibold text-white" onClick={() => startTicket()}>Raise a new ticket</button>
              </div>
            </>
          )}

          {view === "thread" && ticket && (
            <>
              {header(`${ticket.ticket_no} · ${ticket.subject}`, "tickets")}
              <div className="flex items-center gap-2 border-b border-subtle px-3 py-1.5 text-[11px] text-muted">
                <span className={`rounded-full px-1.5 py-0.5 font-semibold ${STATUS_STYLE[ticket.status] || ""}`}>{ticket.status.replace("_", " ")}</span>
                <span>{ticket.priority}</span>
                <span>· {CATEGORY_LABEL[ticket.category] || ticket.category}</span>
                <span>· raised {fmt(ticket.created_at)}</span>
              </div>
              <div ref={threadRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
                {(ticket.messages || []).map((m) => m.is_system ? (
                  <div key={m.id} className="text-center text-[11px] text-muted">{m.body} · {fmt(m.created_at)}</div>
                ) : (
                  <div key={m.id} className={`flex ${m.is_staff ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[88%] rounded-card px-3 py-2 text-sm ${m.is_staff ? "bg-surface-2 text-primary" : "bg-brand-600 text-white"}`}>
                      <div className="whitespace-pre-wrap">{m.body}</div>
                      <div className={`mt-1 text-[10px] ${m.is_staff ? "text-muted" : "text-white/70"}`}>{m.author_name}{m.is_staff ? " (Admin)" : ""} · {fmt(m.created_at)}</div>
                    </div>
                  </div>
                ))}
                {(ticket.status === "Resolved" || ticket.status === "Closed") && (
                  <div className="rounded-card border border-subtle bg-surface-0 p-2 text-center text-xs text-secondary">
                    {ticket.rating ? `Thanks — you rated this ${ticket.rating}/5.` : (
                      <>
                        <div>Was this resolved to your satisfaction?</div>
                        <div className="mt-1 flex justify-center gap-1">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button key={n} type="button" className="rounded-full px-2 py-0.5 hover:bg-surface-2" onClick={() => rate(n)} aria-label={`Rate ${n} of 5`}>★{n}</button>
                          ))}
                        </div>
                      </>
                    )}
                    {ticket.status === "Resolved" && (
                      <div className="mt-1 text-[11px] text-muted">Not fixed? Reply below and the ticket reopens automatically.</div>
                    )}
                  </div>
                )}
              </div>
              {error && <div className="px-3 pb-1 text-xs text-danger">{error}</div>}
              {ticket.status !== "Closed" ? (
                <form className="flex items-end gap-2 border-t border-subtle p-2" onSubmit={(e) => { e.preventDefault(); sendReply(); }}>
                  <textarea className="max-h-28 min-h-[38px] flex-1 resize-none rounded-control border border-subtle bg-surface-0 px-3 py-2 text-sm" rows={1}
                    placeholder="Reply to the admin team…" value={reply} onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }} aria-label="Reply" />
                  <button type="submit" className="rounded-control bg-brand-600 p-2 text-white disabled:opacity-50" disabled={!reply.trim()} aria-label="Send reply"><Send size={16} aria-hidden /></button>
                </form>
              ) : (
                <div className="border-t border-subtle p-2 text-center text-xs text-muted">This ticket is closed. If the problem is back, raise a new ticket.</div>
              )}
              {meta?.is_staff && ticket.status !== "Closed" && (
                <div className="border-t border-subtle px-3 py-1.5 text-right">
                  <button type="button" className="text-[11px] font-semibold text-muted hover:text-primary" onClick={closeMine}>Close ticket</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
