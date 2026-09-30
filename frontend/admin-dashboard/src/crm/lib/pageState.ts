/**
 * Page state that survives navigation (29 Sep 2026, user report: "I open an
 * Opportunity, go to another tab, come back — it opens from the beginning;
 * Back / Forward must work properly").
 *
 * Two layers, both small:
 *
 *  1. `usePageTab(param, fallback, allowed?)` — a tab bar whose selection lives
 *     in the ADDRESS (`?tab=applicants`). Every click PUSHES a history entry, so
 *     the browser's Back / Forward step through the tabs you visited and a Back
 *     from any other page lands on the exact tab you left. Reading happens on
 *     mount and on every popstate (the CRM router's own navigation signal), so
 *     an in-app link to the same page with another `?tab=` also switches.
 *     When the address names no tab (you arrived from the sidebar or a list),
 *     the tab you last used ON THIS RECORD in this browser session is restored
 *     (sessionStorage, keyed by the CRM path — `opportunities/12`), and the
 *     address is filled in with replaceState so that history entry keeps it.
 *
 *  2. `useSessionState(name, initial)` — plain page state (a list's page
 *     number, its search box) remembered per CRM path for the session, so
 *     Back to a list returns to the same page and search.
 *
 * ⚠️ The tab ALWAYS goes into the address, the default included: an entry
 * without it would fall back to the session memory, which holds the LAST tab
 * used — not the one that entry was showing.
 *
 * Param names in use (each is cleared on navigation — `CRM_FILTER_KEYS` in
 * router.tsx): `tab` (a page's main sections), `sub` (a second tab bar on the
 * same page), `status` (a list's status / stage chips), `rtab` (the
 * requirement list inside the Opportunities workspace), `phase` (Applied
 * Candidates stage chips). Never `view`, `p`, `cid`, `iid`, `ret` — those
 * belong to the platform shell.
 *
 * Storage is a per-viewer convenience only: every access is wrapped, and the
 * page works the same when sessionStorage is unavailable.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { readCrmPath } from "../router";

const TAB_PREFIX = "crm.tab:";
const STATE_PREFIX = "crm.state:";

function sessionGet(key: string): string | null {
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}
function sessionSet(key: string, value: string): void {
  try { window.sessionStorage.setItem(key, value); } catch { /* convenience only */ }
}

function urlParam(name: string): string | null {
  try { return new URLSearchParams(window.location.search).get(name); } catch { return null; }
}

function writeParam(name: string, value: string, mode: "push" | "replace"): void {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get(name) === value) return;
    url.searchParams.set(name, value);
    const fn = mode === "push" ? window.history.pushState : window.history.replaceState;
    fn.call(window.history, window.history.state, "", url.toString());
  } catch { /* the tab still switches; only the address is not updated */ }
}

/** A tab bar whose selection lives in the URL (see the module note).
 *
 *  `allowed` (optional) rejects a stale or foreign value — a tab this user
 *  cannot see, or one a template hid. Pass it only when the list is known;
 *  pages that compute their tabs after a fetch keep their own "snap to the
 *  first visible tab" effect, which calls the setter with `{replace: true}`. */
export function usePageTab<T extends string = string>(
  param: string,
  fallback: T,
  allowed?: readonly string[] | ((value: string) => boolean),
): [T, (next: T, opts?: { replace?: boolean }) => void] {
  const path = useRef(readCrmPath());
  const memKey = `${TAB_PREFIX}${path.current}#${param}`;
  const ok = useCallback((v: string | null): v is string => {
    if (!v) return false;
    if (!allowed) return true;
    return typeof allowed === "function" ? allowed(v) : allowed.includes(v);
  }, [allowed]);

  const resolve = useCallback((): T => {
    const fromUrl = urlParam(param);
    if (ok(fromUrl)) return fromUrl as T;
    const remembered = sessionGet(memKey);
    if (ok(remembered)) return remembered as T;
    return fallback;
  }, [param, memKey, fallback, ok]);

  const [tab, setTabState] = useState<T>(resolve);

  // Record the tab in this history entry (and in the session memory) so Back
  // from the next page returns to it — even when we arrived without one.
  useEffect(() => {
    if (readCrmPath() !== path.current) return;
    writeParam(param, tab, "replace");
    sessionSet(memKey, tab);
  }, [param, tab, memKey]);

  // Back / Forward (and in-app links to this page) re-read the address.
  useEffect(() => {
    const onPop = () => {
      if (readCrmPath() !== path.current) return;   // another page is taking over
      setTabState(resolve());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [resolve]);

  const setTab = useCallback((next: T, opts?: { replace?: boolean }) => {
    setTabState(next);
    if (readCrmPath() !== path.current) return;
    writeParam(param, next, opts?.replace ? "replace" : "push");
    sessionSet(memKey, next);
  }, [param, memKey]);

  return [tab, setTab];
}

/** Page state remembered per CRM path for the session (a list's page number,
 *  its search box). JSON-serialisable values only. */
export function useSessionState<T>(name: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const key = useRef(`${STATE_PREFIX}${readCrmPath()}#${name}`);
  const [value, setValue] = useState<T>(() => {
    const raw = sessionGet(key.current);
    if (raw == null) return initial;
    try { return JSON.parse(raw) as T; } catch { return initial; }
  });
  useEffect(() => {
    sessionSet(key.current, JSON.stringify(value));
  }, [value]);
  return [value, setValue];
}

/** `useEffect` that skips its first run — for "a filter changed, go back to
 *  page 1" effects. Run on mount, they would throw away the page number that
 *  `useSessionState` just restored. */
export function useChangeEffect(effect: () => void, deps: readonly unknown[]): void {
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    effect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
