/**
 * Ask AI — full chat workspace for the Karnex CRM.
 *
 * Two layouts share one thread model:
 *   • dock  — right-hand rail, page stays usable behind it (default)
 *   • full  — full-screen workspace with a conversation history sidebar
 *             and a centred reading column
 *
 * Conversations persist in localStorage (see askAiStore), so history survives
 * reloads and the user can jump between threads. The assistant remains
 * read-only: it explains the CRM and can offer a "go to page" jump, never a
 * data mutation.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowUp,
  Check,
  Copy,
  Loader2,
  MapPin,
  Maximize2,
  MessageSquare,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { CRM_NAV } from "../../crm/nav";
import { crmNavigate, readCrmPath } from "../../crm/routerHooks";
import { fetchHelpContext, postAssist, TOOL_LABELS, type ChatTurn } from "./askAiApi";
import { MarkdownLite } from "./markdownLite";
import {
  deriveTitle,
  loadActiveThreadId,
  loadMode,
  loadThreads,
  newThread,
  relativeDayLabel,
  saveActiveThreadId,
  saveMode,
  saveThreads,
  type ChatThread,
  type PanelMode,
} from "./askAiStore";

const focusRing = "focus-visible:outline-none focus-visible:shadow-focus-ring";
const DUR = { base: 0.15, slow: 0.25 } as const;
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const COMPOSER_MAX_PX = 200;

function tabLabelFromPath(path: string): string {
  const seg = (path || "").split("/")[0];
  if (!seg) return "Dashboard";
  if (seg === "branch-policy") return "Branch";
  const hit = CRM_NAV.find((n) => n.path === seg);
  return hit?.label || seg;
}

function routeKeyFromPath(path: string): string {
  const seg = (path || "").split("/")[0];
  if (!seg) return "dashboard";
  if (seg === "branch-policy") return "branch";
  return seg;
}

function navigateLabel(path: string | null | undefined): string {
  if (path === "" || path === "dashboard") return "Dashboard";
  if (!path) return "page";
  const hit = CRM_NAV.find((n) => n.path === path);
  return hit?.label || path;
}

/* ------------------------------------------------------------------ */
/* History sidebar (full mode only)                                    */
/* ------------------------------------------------------------------ */

function HistoryList({
  threads,
  activeId,
  onSelect,
  onDelete,
}: {
  threads: ChatThread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const groups = useMemo(() => {
    const out: { label: string; items: ChatThread[] }[] = [];
    for (const t of threads) {
      const label = relativeDayLabel(t.updatedAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(t);
      else out.push({ label, items: [t] });
    }
    return out;
  }, [threads]);

  if (!threads.length) {
    return (
      <p className="px-3 py-4 text-xs text-muted">
        No conversations yet. Your chats will be listed here.
      </p>
    );
  }

  return (
    <div className="space-y-4 px-2 py-3">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-muted">
            {g.label}
          </p>
          <ul className="space-y-0.5">
            {g.items.map((t) => {
              const active = t.id === activeId;
              return (
                <li key={t.id} className="group/row relative">
                  <button
                    type="button"
                    onClick={() => onSelect(t.id)}
                    className={`flex w-full items-center gap-2 rounded-control px-2 py-2 pr-8 text-left text-xs font-medium transition-colors ${
                      active
                        ? "bg-surface-2 text-primary"
                        : "text-secondary hover:bg-surface-2/60 hover:text-primary"
                    } ${focusRing}`}
                    title={t.title}
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(t.id)}
                    className={`absolute right-1 top-1/2 -translate-y-1/2 rounded-control p-1.5 text-muted opacity-0 transition-opacity hover:bg-surface-3 hover:text-danger focus-visible:opacity-100 group-hover/row:opacity-100 ${focusRing}`}
                    aria-label={`Delete chat: ${t.title}`}
                    title="Delete chat"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Message row                                                         */
/* ------------------------------------------------------------------ */

function MessageRow({
  turn,
  wide,
  isLastAssistant,
  onNavigate,
  onRegenerate,
}: {
  turn: ChatTurn;
  wide: boolean;
  isLastAssistant: boolean;
  onNavigate: (path: string | null | undefined) => void;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(turn.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className={`min-w-0 whitespace-pre-wrap break-words rounded-panel bg-brand-600/15 px-3.5 py-2.5 text-sm text-primary ring-1 ring-inset ring-brand-600/20 ${
            wide ? "max-w-[80%]" : "max-w-[92%]"
          }`}
        >
          {turn.content}
        </div>
      </div>
    );
  }

  return (
    <div className="group/msg flex gap-3">
      <span
        className="mt-0.5 hidden h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 ring-1 ring-inset ring-subtle sm:flex"
        aria-hidden
      >
        <Sparkles className="h-3.5 w-3.5 text-brand-600" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="min-w-0 break-words">
          <MarkdownLite text={turn.content} />
        </div>

        {/* Says the answer came from their records rather than the model's
            memory — the difference between a number you can act on and one
            you have to go and check. */}
        {(turn.toolsUsed?.length ?? 0) > 0 && (
          <p className="mt-1.5 text-[11px] text-muted">
            Checked your{" "}
            {Array.from(new Set(turn.toolsUsed))
              .map((t) => TOOL_LABELS[t] || t.replace(/_/g, " "))
              .join(", ")}
          </p>
        )}

        {turn.navigateTo !== undefined && turn.navigateTo !== null && (
          <button
            type="button"
            onClick={() => onNavigate(turn.navigateTo)}
            className={`btn-depth btn-gradient mt-2.5 inline-flex items-center gap-1.5 rounded-control bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white ${focusRing}`}
          >
            Go to {navigateLabel(turn.navigateTo)}
          </button>
        )}

        <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100">
          <button
            type="button"
            onClick={() => void copy()}
            className={`inline-flex items-center gap-1 rounded-control px-1.5 py-1 text-[11px] font-medium text-muted hover:bg-surface-2 hover:text-primary ${focusRing}`}
            aria-label="Copy reply"
            title="Copy"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
          {isLastAssistant && (
            <button
              type="button"
              onClick={onRegenerate}
              className={`inline-flex items-center gap-1 rounded-control px-1.5 py-1 text-[11px] font-medium text-muted hover:bg-surface-2 hover:text-primary ${focusRing}`}
              aria-label="Regenerate reply"
              title="Regenerate"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function AskAiPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduce = useReducedMotion();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<Element | null>(null);

  const [mode, setMode] = useState<PanelMode>(() => loadMode());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [threads, setThreads] = useState<ChatThread[]>(() => loadThreads());
  const [activeId, setActiveId] = useState<string | null>(() => loadActiveThreadId());

  const [crmPath, setCrmPath] = useState(() => readCrmPath());
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tabTitle, setTabTitle] = useState(() => tabLabelFromPath(readCrmPath()));
  const [prompts, setPrompts] = useState<string[]>([]);

  const routeKey = useMemo(() => routeKeyFromPath(crmPath), [crmPath]);
  const full = mode === "full";

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeId) ?? null,
    [threads, activeId],
  );
  const messages = activeThread?.messages ?? [];

  /* ---------------- persistence ---------------- */

  useEffect(() => {
    saveThreads(threads);
  }, [threads]);

  useEffect(() => {
    saveActiveThreadId(activeId);
  }, [activeId]);

  useEffect(() => {
    saveMode(mode);
  }, [mode]);

  /* ---------------- CRM route tracking ---------------- */

  useEffect(() => {
    const sync = () => {
      const p = readCrmPath();
      setCrmPath(p);
      setTabTitle(tabLabelFromPath(p));
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const ctx = await fetchHelpContext(routeKey);
        if (cancelled) return;
        setTabTitle(ctx.title || tabLabelFromPath(crmPath));
        setPrompts(ctx.suggested_prompts || []);
      } catch {
        if (!cancelled) {
          setPrompts([]);
          setTabTitle(tabLabelFromPath(crmPath));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, routeKey, crmPath]);

  /* ---------------- focus + keyboard ---------------- */

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement;
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      window.clearTimeout(t);
      (returnFocusRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  // Lock body scroll in full mode so the page behind cannot scroll away.
  useEffect(() => {
    if (!open || !full) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, full]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      // Trap focus when the panel covers the page (full screen or mobile sheet).
      const covering = full || window.matchMedia("(max-width: 767px)").matches;
      if (!covering || e.key !== "Tab" || !panelRef.current) return;
      const f = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
      );
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, full]);

  /* ---------------- autoscroll + composer autogrow ---------------- */

  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, loading, open, mode]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_PX)}px`;
  }, [draft, open, mode]);

  /* ---------------- thread actions ---------------- */

  const upsertThread = useCallback((id: string, patch: (t: ChatThread) => ChatThread) => {
    setThreads((prev) => prev.map((t) => (t.id === id ? patch(t) : t)));
  }, []);

  const startNewChat = useCallback(() => {
    const t = newThread();
    setThreads((prev) => [t, ...prev]);
    setActiveId(t.id);
    setError(null);
    setDraft("");
    window.setTimeout(() => inputRef.current?.focus(), 30);
    return t.id;
  }, []);

  const deleteThread = useCallback(
    (id: string) => {
      setThreads((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (id === activeId) setActiveId(next[0]?.id ?? null);
        return next;
      });
    },
    [activeId],
  );

  /* ---------------- send ---------------- */

  const runAssist = useCallback(
    async (threadId: string, message: string, history: { role: string; content: string }[]) => {
      setLoading(true);
      setError(null);
      try {
        const data = await postAssist({ message, route: routeKey, history });
        upsertThread(threadId, (t) => ({
          ...t,
          messages: [
            ...t.messages,
            {
              role: "assistant",
              content: data.reply,
              navigateTo: data.navigate_to,
              toolsUsed: data.tools_used || [],
            },
          ],
          updatedAt: Date.now(),
        }));
        if (data.suggested_prompts?.length) setPrompts(data.suggested_prompts);
        if (data.tab_title) setTabTitle(data.tab_title);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ask AI failed");
        upsertThread(threadId, (t) => ({
          ...t,
          messages: [
            ...t.messages,
            {
              role: "assistant",
              content:
                "I couldn’t reach the help assistant just now. Please try again — I never change your data.",
            },
          ],
          updatedAt: Date.now(),
        }));
      } finally {
        setLoading(false);
      }
    },
    [routeKey, upsertThread],
  );

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || loading) return;

      let threadId = activeId;
      let history: { role: string; content: string }[] = [];

      if (!threadId || !threads.some((t) => t.id === threadId)) {
        const t = newThread(deriveTitle(message) || "New chat");
        t.titleLocked = true;
        t.messages = [{ role: "user", content: message }];
        threadId = t.id;
        setThreads((prev) => [t, ...prev]);
        setActiveId(t.id);
      } else {
        const current = threads.find((t) => t.id === threadId);
        history = (current?.messages ?? []).map(({ role, content }) => ({ role, content }));
        upsertThread(threadId, (t) => ({
          ...t,
          title: t.titleLocked ? t.title : deriveTitle(message) || t.title,
          titleLocked: true,
          messages: [...t.messages, { role: "user", content: message }],
          updatedAt: Date.now(),
        }));
      }

      setDraft("");
      await runAssist(threadId, message, history);
    },
    [activeId, loading, runAssist, threads, upsertThread],
  );

  const regenerate = useCallback(async () => {
    if (!activeThread || loading) return;
    const msgs = activeThread.messages;
    const lastUserIdx = [...msgs].reverse().findIndex((m) => m.role === "user");
    if (lastUserIdx === -1) return;
    const idx = msgs.length - 1 - lastUserIdx;
    const message = msgs[idx].content;
    const history = msgs.slice(0, idx).map(({ role, content }) => ({ role, content }));
    upsertThread(activeThread.id, (t) => ({
      ...t,
      messages: t.messages.slice(0, idx + 1),
      updatedAt: Date.now(),
    }));
    await runAssist(activeThread.id, message, history);
  }, [activeThread, loading, runAssist, upsertThread]);

  const onNavigate = useCallback(
    (path: string | null | undefined) => {
      if (path === null || path === undefined) return;
      const qs = new URLSearchParams(window.location.search);
      if (qs.get("view") !== "crm") {
        qs.set("view", "crm");
        window.history.pushState({}, "", `${window.location.pathname}?${qs.toString()}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
      crmNavigate(path);
      // In full screen the page is hidden behind the chat — step back to it.
      if (full) setMode("dock");
    },
    [full],
  );

  if (typeof document === "undefined") return null;

  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  })();

  const shellClass = full
    ? "pointer-events-auto absolute inset-0 flex bg-surface-1"
    : "pointer-events-auto absolute inset-y-0 right-0 flex w-full max-w-none flex-col border-l border-subtle bg-surface-1 shadow-overlay md:w-[min(440px,92vw)] max-md:inset-x-0 max-md:top-auto max-md:h-[min(92dvh,720px)] max-md:rounded-t-panel";

  const composer = (
    <form
      className={full ? "mx-auto w-full max-w-3xl px-4 pb-4 pt-2" : "shrink-0 px-3 pb-3 pt-2"}
      onSubmit={(e) => {
        e.preventDefault();
        void send(draft);
      }}
    >
      <div className="flex items-end gap-2 rounded-panel border border-subtle bg-surface-0 p-2 shadow-[var(--recess-shadow)] focus-within:border-brand-600/50">
        <label className="sr-only" htmlFor="ask-ai-input">
          Ask a question
        </label>
        <textarea
          id="ask-ai-input"
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
          placeholder={`Ask anything about ${tabTitle}…`}
          className="max-h-[200px] min-h-[2.25rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-primary outline-none placeholder:text-muted"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !draft.trim()}
          className={`btn-depth btn-gradient inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-brand-600 text-white disabled:opacity-40 ${focusRing}`}
          aria-label="Send"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </button>
      </div>
      <p className="mt-1.5 px-1 text-[10px] text-muted">
        Enter to send · Shift+Enter for a new line · Read-only guide, never changes your data
      </p>
    </form>
  );

  const thread = (
    <div
      ref={threadRef}
      className={`min-h-0 flex-1 overflow-y-auto ${full ? "px-4 py-6" : "px-3 py-3"}`}
    >
      <div className={`space-y-5 ${full ? "mx-auto w-full max-w-3xl" : ""}`}>
        {messages.length === 0 && (
          <div className={full ? "pt-10" : "pt-2"}>
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-brand-600" aria-hidden />
              <h3 className={`font-bold text-primary ${full ? "text-xl" : "text-base"}`}>
                How can I help with {tabTitle}?
              </h3>
            </div>
            <p className="text-sm text-secondary">
              I explain Karnex CRM workflows, rules and fields from the help guide. I can point you
              to the right page — I never change your data.
            </p>
            {prompts.length > 0 && (
              <div className={`mt-4 grid gap-2 ${full ? "sm:grid-cols-2" : ""}`}>
                {prompts.slice(0, 6).map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={loading}
                    onClick={() => void send(p)}
                    className={`btn-depth rounded-panel border border-subtle bg-surface-0 px-3 py-2.5 text-left text-xs font-medium text-secondary hover:border-brand-600/40 hover:text-primary disabled:opacity-50 ${focusRing}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m, i) => (
          <MessageRow
            key={`${activeThread?.id ?? "t"}-${i}`}
            turn={m}
            wide={full}
            isLastAssistant={i === lastAssistantIdx && !loading}
            onNavigate={onNavigate}
            onRegenerate={() => void regenerate()}
          />
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Thinking…
          </div>
        )}
        {error && (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );

  const headerButtons = (
    <>
      <button
        type="button"
        onClick={startNewChat}
        className={`btn-depth inline-flex h-9 items-center gap-1.5 rounded-control px-2.5 text-xs font-semibold text-muted hover:text-primary ${focusRing}`}
        title="New chat"
      >
        <Plus className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">New chat</span>
      </button>
      <button
        type="button"
        onClick={() => setMode(full ? "dock" : "full")}
        className={`rounded-control p-1.5 text-muted hover:bg-surface-2 hover:text-primary ${focusRing}`}
        aria-label={full ? "Exit full screen" : "Open full screen"}
        title={full ? "Exit full screen" : "Full screen"}
      >
        {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={onClose}
        className={`rounded-control p-1.5 text-muted hover:bg-surface-2 hover:text-primary ${focusRing}`}
        aria-label="Close Ask AI"
      >
        <X className="h-4.5 w-4.5" />
      </button>
    </>
  );

  const mainColumn = (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-subtle bg-surface-1 px-3 py-3 sm:px-4">
        {full && (
          <button
            type="button"
            onClick={() => setSidebarOpen((s) => !s)}
            className={`hidden rounded-control p-1.5 text-muted hover:bg-surface-2 hover:text-primary md:inline-flex ${focusRing}`}
            aria-label={sidebarOpen ? "Hide chat history" : "Show chat history"}
            title={sidebarOpen ? "Hide history" : "Show history"}
          >
            {sidebarOpen ? (
              <PanelLeftClose className="h-4 w-4" />
            ) : (
              <PanelLeftOpen className="h-4 w-4" />
            )}
          </button>
        )}
        <Sparkles className="h-4.5 w-4.5 text-brand-600" aria-hidden />
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-bold text-primary">
          {full && activeThread?.titleLocked ? activeThread.title : "Ask AI"}
        </h2>
        <span className="hidden items-center gap-1.5 rounded-control bg-surface-2 px-2.5 py-1 text-xs font-semibold text-secondary ring-1 ring-inset ring-subtle sm:inline-flex">
          <MapPin className="h-3 w-3 opacity-70" aria-hidden />
          {tabTitle}
        </span>
        {headerButtons}
      </header>

      {thread}
      {composer}
    </div>
  );

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={`pointer-events-none fixed inset-0 ${full ? "z-[240]" : "z-[220]"}`}>
          {/* Backdrop: mobile sheet always, desktop only when full screen. */}
          <motion.button
            type="button"
            aria-label="Close Ask AI"
            className={`pointer-events-auto absolute inset-0 bg-backdrop ${full ? "" : "md:hidden"}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : DUR.base }}
            onClick={onClose}
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={shellClass}
            initial={
              reduce ? { opacity: 0 } : full ? { opacity: 0, scale: 0.99 } : { x: "100%", opacity: 0.96 }
            }
            animate={reduce ? { opacity: 1 } : full ? { opacity: 1, scale: 1 } : { x: 0, opacity: 1 }}
            exit={
              reduce ? { opacity: 0 } : full ? { opacity: 0, scale: 0.99 } : { x: "100%", opacity: 0.96 }
            }
            transition={reduce ? { duration: 0 } : { duration: DUR.slow, ease: EASE }}
          >
            {full && sidebarOpen && (
              <aside className="hidden w-64 shrink-0 flex-col border-r border-subtle bg-surface-0 md:flex">
                <div className="shrink-0 px-3 py-3">
                  <button
                    type="button"
                    onClick={startNewChat}
                    className={`btn-depth btn-gradient flex w-full items-center justify-center gap-1.5 rounded-control bg-brand-600 px-3 py-2 text-xs font-semibold text-white ${focusRing}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New chat
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <HistoryList
                    threads={threads}
                    activeId={activeId}
                    onSelect={(id) => {
                      setActiveId(id);
                      setError(null);
                    }}
                    onDelete={deleteThread}
                  />
                </div>
              </aside>
            )}

            {mainColumn}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
