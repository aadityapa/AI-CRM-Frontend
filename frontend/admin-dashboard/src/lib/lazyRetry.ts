/** Lazy page loading that survives a deployment (21 Oct 2026).
 *
 *  Every CRM page is its own chunk with a hashed file name. A tab opened BEFORE a
 *  deploy still asks for the OLD names; the new build has deleted them, so the
 *  dynamic import fails ("Failed to fetch dynamically imported module") and the
 *  page the user clicked (Opportunities, Candidate Profiles, …) never opens.
 *
 *  `lazyRetry` retries the import once (a network blip), and when it still fails
 *  with a chunk error it reloads the page ONCE — the fresh index.html names the
 *  new chunks. A sessionStorage stamp stops a reload loop when the server itself
 *  is broken: the second failure inside `RELOAD_GUARD_MS` is thrown to the error
 *  boundary, which shows the message and a Reload button. */
import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const RELOAD_KEY = "karnex.chunkReloadAt";
export const RELOAD_GUARD_MS = 60_000;

/** True for the errors a missing / stale chunk produces in every browser. */
export function isChunkLoadError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err || "");
  const name = String((err as { name?: string })?.name || "");
  return (
    name === "ChunkLoadError" ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Loading (CSS )?chunk [\w-]+ failed/i.test(msg) ||
    /Unable to preload CSS/i.test(msg)
  );
}

function readStamp(): number {
  try {
    return Number(window.sessionStorage.getItem(RELOAD_KEY) || 0) || 0;
  } catch {
    return 0;
  }
}

/** Reload once per `RELOAD_GUARD_MS`; returns false when a reload already happened. */
export function reloadForNewVersion(now = Date.now()): boolean {
  if (now - readStamp() < RELOAD_GUARD_MS) return false;
  try {
    window.sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    /* private mode — reload anyway, at worst once more */
  }
  window.location.reload();
  return true;
}

export async function importWithRetry<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (first) {
    if (!isChunkLoadError(first)) throw first;
    try {
      return await load();
    } catch (second) {
      if (isChunkLoadError(second) && reloadForNewVersion()) {
        // The page is reloading; never resolve so React does not flash an error.
        return new Promise<T>(() => {});
      }
      throw second;
    }
  }
}

/** Drop-in for React.lazy. */
export function lazyRetry<T extends ComponentType<any>>( // eslint-disable-line @typescript-eslint/no-explicit-any
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => importWithRetry(load));
}

/** Vite fires `vite:preloadError` when a preloaded dependency of a chunk is gone. */
export function installPreloadErrorReload(): void {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadForNewVersion()) event.preventDefault();
  });
}
