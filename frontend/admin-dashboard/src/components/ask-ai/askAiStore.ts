/**
 * Ask AI — local conversation store.
 *
 * Holds multiple named chat threads in localStorage so the assistant behaves
 * like a full chat workspace (history, resume, rename, delete) instead of a
 * single throwaway session.
 */
import type { ChatTurn } from "./askAiApi";

const STORE_KEY = "karnex.askAi.threads.v2";
const ACTIVE_KEY = "karnex.askAi.activeThread.v2";
const MODE_KEY = "karnex.askAi.mode.v2";
/** Legacy single-session key (pre multi-thread). Migrated on first read. */
const LEGACY_KEY = "karnex.askAi.chat.v1";

const MAX_THREADS = 30;
const MAX_TURNS_PER_THREAD = 80;

export type ChatThread = {
  id: string;
  title: string;
  /** Set once the title has been derived from the first user message. */
  titleLocked: boolean;
  messages: ChatTurn[];
  createdAt: number;
  updatedAt: number;
};

export type PanelMode = "dock" | "full";

function uid(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isTurn(v: unknown): v is ChatTurn {
  if (!v || typeof v !== "object") return false;
  const t = v as ChatTurn;
  return (t.role === "user" || t.role === "assistant") && typeof t.content === "string";
}

function sanitizeThread(v: unknown): ChatThread | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Partial<ChatThread>;
  if (typeof t.id !== "string" || !t.id) return null;
  const messages = Array.isArray(t.messages) ? t.messages.filter(isTurn) : [];
  return {
    id: t.id,
    title: typeof t.title === "string" && t.title.trim() ? t.title : "New chat",
    titleLocked: Boolean(t.titleLocked),
    messages: messages.slice(-MAX_TURNS_PER_THREAD),
    createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
    updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : Date.now(),
  };
}

export function newThread(title = "New chat"): ChatThread {
  const now = Date.now();
  return { id: uid(), title, titleLocked: false, messages: [], createdAt: now, updatedAt: now };
}

/** Read all threads, newest first. Migrates the legacy v1 session on first run. */
export function loadThreads(): ChatThread[] {
  let threads: ChatThread[] = [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        threads = parsed.map(sanitizeThread).filter((t): t is ChatThread => t !== null);
      }
    }
  } catch {
    threads = [];
  }

  if (!threads.length) {
    // One-time migration from the old single-session slide-over.
    try {
      const legacy = sessionStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const parsed: unknown = JSON.parse(legacy);
        const msgs = Array.isArray(parsed) ? parsed.filter(isTurn) : [];
        if (msgs.length) {
          const t = newThread(deriveTitle(msgs[0]?.content) || "Previous chat");
          t.titleLocked = true;
          t.messages = msgs.slice(-MAX_TURNS_PER_THREAD);
          threads = [t];
          saveThreads(threads);
        }
        sessionStorage.removeItem(LEGACY_KEY);
      }
    } catch {
      /* ignore */
    }
  }

  return threads.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveThreads(threads: ChatThread[]) {
  try {
    const trimmed = threads
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_THREADS)
      .map((t) => ({ ...t, messages: t.messages.slice(-MAX_TURNS_PER_THREAD) }));
    localStorage.setItem(STORE_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota / private mode — chat still works in memory */
  }
}

export function loadActiveThreadId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function saveActiveThreadId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}

export function loadMode(): PanelMode {
  try {
    return localStorage.getItem(MODE_KEY) === "full" ? "full" : "dock";
  } catch {
    return "dock";
  }
}

export function saveMode(mode: PanelMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

/** Short thread title from the first user message. */
export function deriveTitle(text: string | undefined): string {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > 42 ? `${clean.slice(0, 42).trimEnd()}…` : clean;
}

/** Human-friendly bucket used to group the history list. */
export function relativeDayLabel(ts: number): string {
  const day = 86_400_000;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const diff = startOfToday.getTime() - ts;
  if (diff <= 0) return "Today";
  if (diff <= day) return "Yesterday";
  if (diff <= day * 7) return "Previous 7 days";
  if (diff <= day * 30) return "Previous 30 days";
  return "Older";
}
