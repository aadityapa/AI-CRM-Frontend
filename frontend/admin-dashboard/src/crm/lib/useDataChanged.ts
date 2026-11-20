/**
 * 20 Nov 2026 (user: "whenever Finance maps invoices to a received amount, the
 * dashboards must change too"): call `onChange` when money may have moved —
 * right after any change made in this browser (`announceDeskChange`, fired by
 * every successful non-GET request: Map invoices, Record payment, Settle …),
 * from another tab of this browser (storage), on return to the tab, and every
 * `everyMs` while the tab is visible. Return visits are throttled to one per
 * `GAP_MS`, so switching windows does not hammer the server.
 */
import { useEffect, useRef } from "react";
import { DESK_CHANGED_EVENT } from "../api";

const GAP_MS = 15_000;

export function useDataChanged(onChange: () => void, everyMs = 60_000): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    let last = Date.now();
    const fire = (force: boolean) => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (!force && Date.now() - last < GAP_MS) return;
      last = Date.now();
      cb.current();
    };
    const onVisible = () => fire(false);
    const onEvent = () => fire(true);
    const onStorage = (e: StorageEvent) => { if (e.key === DESK_CHANGED_EVENT) fire(true); };
    const timer = everyMs > 0 ? window.setInterval(() => fire(true), everyMs) : 0;
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener(DESK_CHANGED_EVENT, onEvent);
    window.addEventListener("storage", onStorage);
    return () => {
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener(DESK_CHANGED_EVENT, onEvent);
      window.removeEventListener("storage", onStorage);
    };
  }, [everyMs]);
}
