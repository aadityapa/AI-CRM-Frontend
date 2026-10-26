/**
 * `useDeskData` — the one fetch hook the Dashboard's towers share
 * (Hiring control tower, CEO dashboard, the work desk).
 *
 * This file used to hold the 14 Sep 2026 "role desk" widgets (Today strip ·
 * Upcoming · Quick actions · Team). They were removed from every role's
 * dashboard on 28 Sep 2026 at the user's request — the page now opens on the
 * role's own tower / sections. The server endpoints behind them
 * (`/api/dashboard/today|upcoming|team|my-work`) still exist and still serve
 * the bell links; only the widgets went.
 *
 * 23 Oct 2026 (user report: "the Dashboard filters don't update in real time —
 * a Proforma generated does not show under Proformas to convert"): `live`
 * re-reads QUIETLY (no spinner, no blanking) every `live` ms while the tab is
 * visible, when it becomes visible / focused again (at most every
 * `REFOCUS_GAP_MS`), and whenever any page announces a change with
 * `announceDeskChange()` (an approval, a Proforma raised, an invoice issued…).
 */
import React from "react";

import { DESK_CHANGED_EVENT, crmGet } from "../../api";

export { announceDeskChange } from "../../api";
const REFOCUS_GAP_MS = 15_000;

export function useDeskData<T>(url: string, opts: { live?: number } = {}) {
  const [state, setState] = React.useState<{ data: T | null; loading: boolean; error: string }>({
    data: null, loading: true, error: "",
  });
  const [tick, setTick] = React.useState(0);
  const quiet = React.useRef(false);
  const lastRead = React.useRef(0);
  React.useEffect(() => {
    let alive = true;
    const silent = quiet.current;
    quiet.current = false;
    if (!silent) setState((s) => ({ ...s, loading: true, error: "" }));
    lastRead.current = Date.now();
    crmGet<T>(url)
      .then((r) => alive && setState({ data: r.data, loading: false, error: "" }))
      .catch((e) => {
        if (!alive) return;
        // A quiet re-read that fails keeps what is on screen.
        if (silent) setState((s) => ({ ...s, loading: false }));
        else setState({ data: null, loading: false, error: e?.message || "Failed to load" });
      });
    return () => { alive = false; };
  }, [url, tick]);

  const live = opts.live ?? 0;
  React.useEffect(() => {
    if (!live) return undefined;
    const reread = (force = false) => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (!force && Date.now() - lastRead.current < REFOCUS_GAP_MS) return;
      quiet.current = true;
      setTick((t) => t + 1);
    };
    const timer = window.setInterval(() => reread(true), live);
    const onVisible = () => reread(false);
    const onChange = () => reread(true);
    const onStorage = (e: StorageEvent) => { if (e.key === DESK_CHANGED_EVENT) reread(true); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener(DESK_CHANGED_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener(DESK_CHANGED_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [live]);

  return { ...state, retry: () => setTick((t) => t + 1) };
}
