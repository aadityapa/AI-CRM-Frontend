/** Session keep-alive banner (17 Aug 2026).
 *
 * The token used to just die: the first request after expiry 401'd, storage
 * was cleared and the page reloaded — taking any half-typed form with it.
 * This watches the JWT's exp claim and, 5 minutes before the end, shows a
 * small fixed banner with one action: "Stay signed in" → POST /auth/refresh
 * swaps the still-valid token for a fresh one. Nothing else in the auth flow
 * changed — an already-expired session still ends exactly as before.
 */
import React, { useEffect, useState } from "react";
import { getAuthToken, getTokenExpiryEpochSec, refreshAuthToken } from "../lib/authSession";

const WARN_SEC = 5 * 60;
const TICK_MS = 15_000;

export function SessionKeeper() {
  const [state, setState] = useState<"hidden" | "warn" | "busy" | "failed">("hidden");
  const [left, setLeft] = useState(0);

  useEffect(() => {
    const tick = () => {
      if (!getAuthToken()) {
        setState("hidden");
        return;
      }
      const exp = getTokenExpiryEpochSec();
      if (exp == null) return;
      const remain = exp - Math.floor(Date.now() / 1000);
      setLeft(remain);
      setState((s) => {
        if (s === "busy" || s === "failed") return s;
        return remain > 0 && remain <= WARN_SEC ? "warn" : "hidden";
      });
    };
    tick();
    const t = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(t);
  }, []);

  if (state === "hidden" || left <= 0) return null;
  const mins = Math.max(1, Math.ceil(left / 60));

  return (
    <div
      role="alert"
      className="fixed bottom-4 left-1/2 z-[120] flex max-w-[95vw] -translate-x-1/2 flex-wrap items-center gap-3 rounded-card border border-subtle bg-surface-1 px-4 py-3 shadow-raised"
    >
      <span className="text-sm text-primary">
        {state === "failed"
          ? "Could not extend the session — please copy any unsaved work, then login again."
          : `Your session ends in about ${mins} min${mins > 1 ? "s" : ""}.`}
      </span>
      {state !== "failed" && (
        <button
          type="button"
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          disabled={state === "busy"}
          onClick={async () => {
            setState("busy");
            const ok = await refreshAuthToken();
            setState(ok ? "hidden" : "failed");
          }}
        >
          {state === "busy" ? "Extending…" : "Stay signed in"}
        </button>
      )}
      <button
        type="button"
        className="text-xs font-semibold text-muted hover:text-primary"
        onClick={() => setState("hidden")}
        aria-label="Dismiss session warning"
      >
        Dismiss
      </button>
    </div>
  );
}
