/**
 * `useDeskData` — the one fetch hook the Dashboard's towers share
 * (Hiring control tower, CEO dashboard).
 *
 * This file used to hold the 14 Sep 2026 "role desk" widgets (Today strip ·
 * Upcoming · Quick actions · Team). They were removed from every role's
 * dashboard on 28 Sep 2026 at the user's request — the page now opens on the
 * role's own tower / sections. The server endpoints behind them
 * (`/api/dashboard/today|upcoming|team|my-work`) still exist and still serve
 * the bell links; only the widgets went.
 */
import React from "react";

import { crmGet } from "../../api";

export function useDeskData<T>(url: string) {
  const [state, setState] = React.useState<{ data: T | null; loading: boolean; error: string }>({
    data: null, loading: true, error: "",
  });
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    crmGet<T>(url)
      .then((r) => alive && setState({ data: r.data, loading: false, error: "" }))
      .catch((e) => alive && setState({ data: null, loading: false, error: e?.message || "Failed to load" }));
    return () => { alive = false; };
  }, [url, tick]);
  return { ...state, retry: () => setTick((t) => t + 1) };
}
