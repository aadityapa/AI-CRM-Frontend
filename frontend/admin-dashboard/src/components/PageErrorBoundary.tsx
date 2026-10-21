/** Catches a page that fails to render or load (21 Oct 2026).
 *
 *  Without it one bad page — a stale chunk after a deploy, a render error on an
 *  odd record — unmounted the whole CRM shell and left a blank screen. Now the
 *  sidebar stays, the reader sees what went wrong in plain words, and can reload
 *  or go back. `resetKey` (the CRM path) clears the error on navigation. */
import React from "react";
import { AlertTriangle, RefreshCw, ArrowLeft } from "lucide-react";
import { isChunkLoadError } from "../lib/lazyRetry";

type Props = { resetKey?: string; children: React.ReactNode };
type State = { error: Error | null };

export class PageErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep the real error in the console so a screenshot of DevTools explains it.
    console.error("[page error]", error, info?.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isChunkLoadError(error);
    return (
      <div role="alert" className="mx-auto mt-10 max-w-xl rounded-card border border-amber-300 bg-amber-50 p-6 text-amber-900 shadow-raised dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />
          <div className="min-w-0">
            <div className="text-lg font-bold">
              {stale ? "A new version of Karnex Orbit was installed" : "This page could not open"}
            </div>
            <p className="mt-1 text-sm">
              {stale
                ? "Your browser still had the previous version. Reload once to get the new one — nothing you saved is lost."
                : "Something on this page failed while loading. Reload to try again; if it keeps happening, send this message to support."}
            </p>
            {!stale && (
              <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-control bg-white/70 p-2 text-xs text-amber-950 dark:bg-black/30 dark:text-amber-50">
                {String(error.message || error)}
              </pre>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-1.5 rounded-control bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700"
              >
                <RefreshCw className="h-4 w-4" aria-hidden /> Reload
              </button>
              <button
                type="button"
                onClick={() => window.history.back()}
                className="inline-flex items-center gap-1.5 rounded-control border border-amber-400 px-3 py-1.5 text-sm font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden /> Go back
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
