/**
 * The app's own place in the browser history (23 Oct 2026, user report: "the
 * Back / Forward buttons give many issues").
 *
 * Three faults, all fixed here:
 *  1. Back on the first page left the application (to the login page or the
 *     site before) — the buttons could not tell where the app's history began.
 *  2. Pages pushed a NEW entry for an address that was already showing, so
 *     Back "did nothing" once for every such click.
 *  3. Without the Navigation API (Firefox, Safari) Forward was always enabled.
 *
 * Every entry the app pushes carries `{appIdx}` — its position since this tab
 * opened the app — and the furthest position reached is kept in session
 * storage. Back is possible while `appIdx > 0`, Forward while
 * `appIdx < furthest`. A push from the middle drops the forward entries, like
 * the browser does. ALL in-app pushes go through `pushAppHistory`.
 */
const MAX_KEY = "app.hist.max";

type AppState = { appIdx?: number } & Record<string, unknown>;

function readMax(): number {
  try { return Number(window.sessionStorage.getItem(MAX_KEY) || "0") || 0; } catch { return 0; }
}
function writeMax(n: number): void {
  try { window.sessionStorage.setItem(MAX_KEY, String(n)); } catch { /* convenience only */ }
}

/** This entry's position (0 = where this tab entered the app). */
export function historyIndex(): number {
  const s = (window.history.state || {}) as AppState;
  return typeof s.appIdx === "number" ? s.appIdx : 0;
}

/** Stamp the entry the app was opened on (call once at start-up). A reload keeps
 *  `history.state`, so a reloaded page keeps its place. */
export function initAppHistory(): void {
  try {
    const s = (window.history.state || {}) as AppState;
    if (typeof s.appIdx !== "number") {
      window.history.replaceState({ ...s, appIdx: 0 }, "");
      writeMax(0);
    }
  } catch { /* history is a convenience */ }
}

/** Push `url` as the next entry — or replace when it is the address on screen. */
export function pushAppHistory(url: string): void {
  try {
    const next = new URL(url, window.location.href);
    if (next.href === window.location.href) {
      window.history.replaceState(window.history.state, "", next.toString());
      return;
    }
    const idx = historyIndex() + 1;
    window.history.pushState({ appIdx: idx }, "", next.toString());
    writeMax(idx);                                   // anything forward of here is gone
  } catch {
    window.history.pushState({}, "", url);
  }
  try { window.dispatchEvent(new Event(HISTORY_EVENT)); } catch { /* buttons refresh on the next popstate */ }
}

/** Fired after every in-app push (pushState itself fires no event). */
export const HISTORY_EVENT = "app:history";

/** Replace the current entry's address, keeping its position. */
export function replaceAppHistory(url: string): void {
  try {
    window.history.replaceState({ ...((window.history.state || {}) as AppState), appIdx: historyIndex() }, "", url);
  } catch { /* convenience */ }
}

export function canGoBack(): boolean {
  return historyIndex() > 0;
}

export function canGoForward(): boolean {
  return historyIndex() < readMax();
}
