/** Reload a page's data when the reader comes back to the tab (29 Sep 2026).
 *
 * User report: "if Sales closes or holds an opportunity it does not reflect in
 * every login". The server was fixed, but a TA who had the list open in
 * another tab still looked at the old rows until they pressed refresh. Every
 * page that shows a deal's state now re-reads it when the window regains
 * focus or becomes visible again — throttled, so alt-tabbing back and forth
 * does not hammer the API.
 */
import { useEffect, useRef } from "react";

const MIN_GAP_MS = 15_000;

export function useRefetchOnFocus(reload: () => unknown, enabled = true) {
  const fn = useRef(reload);
  fn.current = reload;
  useEffect(() => {
    if (!enabled) return;
    let last = Date.now();
    const kick = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - last < MIN_GAP_MS) return;
      last = now;
      try { void fn.current(); } catch { /* the page shows its own error */ }
    };
    window.addEventListener("focus", kick);
    document.addEventListener("visibilitychange", kick);
    return () => {
      window.removeEventListener("focus", kick);
      document.removeEventListener("visibilitychange", kick);
    };
  }, [enabled]);
}
