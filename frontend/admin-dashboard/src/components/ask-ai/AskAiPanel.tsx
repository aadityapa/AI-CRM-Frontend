/** Ask AI — read-only context-aware help slide-over (docked on desktop). */
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
import { ArrowUp, Loader2, MapPin, Sparkles, SquarePen, X } from "lucide-react";
import { CRM_NAV } from "../../crm/nav";
import { crmNavigate, readCrmPath } from "../../crm/routerHooks";
import {
  fetchHelpContext,
  postAssist,
  type ChatTurn,
} from "./askAiApi";
import { MarkdownLite } from "./markdownLite";

const focusRing = "focus-visible:outline-none focus-visible:shadow-focus-ring";
const STORAGE_KEY = "karnex.askAi.chat.v1";
const DUR = { base: 0.15, slow: 0.25 } as const;
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

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

function loadSession(): ChatTurn[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string",
    );
  } catch {
    return [];
  }
}

function saveSession(turns: ChatTurn[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-40)));
  } catch {
    /* ignore quota */
  }
}

function navigateLabel(path: string | null | undefined): string {
  if (path === "" || path === "dashboard") return "Dashboard";
  if (!path) return "page";
  const hit = CRM_NAV.find((n) => n.path === path);
  return hit?.label || path;
}

export function AskAiPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduce = useReducedMotion();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<Element | null>(null);

  const [crmPath, setCrmPath] = useState(() => readCrmPath());
  const [messages, setMessages] = useState<ChatTurn[]>(() => loadSession());
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tabTitle, setTabTitle] = useState(() => tabLabelFromPath(readCrmPath()));
  const [prompts, setPrompts] = useState<string[]>([]);

  const routeKey = useMemo(() => routeKeyFromPath(crmPath), [crmPath]);

  // Track CRM path while open (and on mount)
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

  // Load help context when opened / route changes
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
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

  useEffect(() => {
    saveSession(messages);
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement;
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      window.clearTimeout(t);
      (returnFocusRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  // Escape + mobile focus trap
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      // Focus trap only on narrow viewports (full-sheet)
      const mobile = window.matchMedia("(max-width: 767px)").matches;
      if (!mobile || e.key !== "Tab" || !panelRef.current) return;
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
  }, [open, onClose]);

  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, loading, open]);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || loading) return;
      setError(null);
      setDraft("");
      const history = messages.map(({ role, content }) => ({ role, content }));
      setMessages((prev) => [...prev, { role: "user", content: message }]);
      setLoading(true);
      try {
        const data = await postAssist({
          message,
          route: routeKey,
          history,
        });
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.reply,
            navigateTo: data.navigate_to,
          },
        ]);
        if (data.suggested_prompts?.length) setPrompts(data.suggested_prompts);
        if (data.tab_title) setTabTitle(data.tab_title);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Ask AI failed";
        setError(msg);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "I couldn’t reach the help assistant just now. Please try again — I never change your data.",
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, messages, routeKey],
  );

  const newChat = () => {
    setMessages([]);
    setError(null);
    setDraft("");
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    inputRef.current?.focus();
  };

  const onNavigate = (path: string | null | undefined) => {
    if (path === null || path === undefined) return;
    // Ensure CRM view is active
    const qs = new URLSearchParams(window.location.search);
    if (qs.get("view") !== "crm") {
      qs.set("view", "crm");
      const url = `${window.location.pathname}?${qs.toString()}`;
      window.history.pushState({}, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
    crmNavigate(path);
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="pointer-events-none fixed inset-0 z-[220]" aria-hidden={false}>
          {/* Mobile backdrop only — desktop stays docked so users keep working */}
          <motion.button
            type="button"
            aria-label="Close Ask AI"
            className="pointer-events-auto absolute inset-0 bg-backdrop md:hidden"
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
            className={
              "pointer-events-auto absolute inset-y-0 right-0 flex w-full max-w-none flex-col " +
              "border-l border-subtle bg-surface-1 shadow-overlay " +
              "md:w-[min(420px,92vw)] " +
              "max-md:inset-x-0 max-md:top-auto max-md:h-[min(92dvh,720px)] max-md:rounded-t-panel"
            }
            initial={reduce ? { opacity: 0 } : { x: "100%", opacity: 0.96 }}
            animate={reduce ? { opacity: 1 } : { x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: "100%", opacity: 0.96 }}
            transition={reduce ? { duration: 0 } : { duration: DUR.slow, ease: EASE }}
          >
            <header className="flex shrink-0 items-center gap-2 border-b border-subtle bg-surface-1 px-4 py-3">
              <Sparkles className="h-4.5 w-4.5 text-brand-600" aria-hidden />
              <h2 id={titleId} className="min-w-0 flex-1 text-sm font-bold text-primary">
                Ask AI
              </h2>
              <button
                type="button"
                onClick={newChat}
                className={`btn-depth inline-flex h-9 items-center gap-1.5 rounded-control px-2.5 text-xs font-semibold text-muted hover:text-primary ${focusRing}`}
                title="New chat"
              >
                <SquarePen className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">New chat</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className={`rounded-control p-1.5 text-muted hover:bg-surface-2 hover:text-primary ${focusRing}`}
                aria-label="Close Ask AI"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </header>

            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-subtle px-4 py-2">
              <span className="inline-flex items-center gap-1.5 rounded-control bg-surface-2 px-2.5 py-1 text-xs font-semibold text-secondary ring-1 ring-inset ring-subtle">
                <MapPin className="h-3 w-3 opacity-70" aria-hidden />
                Current page: {tabTitle}
              </span>
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                Read-only guide
              </span>
            </div>

            <div ref={threadRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {messages.length === 0 && (
                <div className="rounded-panel border border-subtle bg-surface-0/60 p-3 text-sm text-secondary">
                  Ask how to use <strong className="text-primary">{tabTitle}</strong>. I explain
                  workflows and rules from the help guide — I never change your data.
                </div>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={
                    (m.role === "user"
                      ? "ml-6 rounded-panel bg-brand-600/15 px-3 py-2 text-sm text-primary"
                      : "mr-2 rounded-panel border border-subtle bg-surface-0 px-3 py-2") +
                    " min-w-0 break-words"
                  }
                >
                  {m.role === "user" ? (
                    <p className="whitespace-pre-wrap text-sm">{m.content}</p>
                  ) : (
                    <>
                      <MarkdownLite text={m.content} />
                      {m.navigateTo !== undefined && m.navigateTo !== null && (
                        <button
                          type="button"
                          onClick={() => onNavigate(m.navigateTo)}
                          className={`btn-depth btn-gradient mt-2 inline-flex items-center gap-1.5 rounded-control bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white ${focusRing}`}
                        >
                          Go to {navigateLabel(m.navigateTo)}
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))}
              {loading && (
                <div className="mr-2 flex items-center gap-2 rounded-panel border border-subtle bg-surface-0 px-3 py-2 text-sm text-muted">
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

            {prompts.length > 0 && (
              <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-subtle px-4 py-2">
                {prompts.slice(0, 4).map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={loading}
                    onClick={() => send(p)}
                    className={`btn-depth rounded-control px-2.5 py-1 text-left text-[11px] font-medium text-secondary hover:bg-surface-2 hover:text-primary disabled:opacity-50 ${focusRing}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}

            <form
              className="flex shrink-0 gap-2 border-t border-subtle bg-surface-1 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
            >
              <label className="sr-only" htmlFor="ask-ai-input">
                Ask a question
              </label>
              <textarea
                id="ask-ai-input"
                ref={inputRef}
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(draft);
                  }
                }}
                placeholder="Ask how to use this page…"
                className="input-recessed min-h-[2.75rem] flex-1 resize-none rounded-control px-3 py-2 text-sm text-primary placeholder:text-muted"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !draft.trim()}
                className={`btn-depth btn-gradient inline-flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-control bg-brand-600 text-white disabled:opacity-40 ${focusRing}`}
                aria-label="Send"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
