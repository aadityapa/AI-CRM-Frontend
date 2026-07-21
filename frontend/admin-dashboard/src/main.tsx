import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { ThemeProvider } from "./theme/ThemeProvider";

window.addEventListener("storage", (e: StorageEvent) => {
  if ((e.key === "authToken" || e.key === "authUser") && e.oldValue && !e.newValue) {
    window.setTimeout(() => window.location.reload(), 0);
  }
});

async function maybeAutoClearCache() {
  const key = "karnexAdminVersion";
  try {
    const res = await fetch("/version", { method: "GET", cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const ver = String(data?.version || "").trim();
    if (!ver) return;
    const prev = String(window.localStorage.getItem(key) || "").trim();
    if (prev && prev !== ver) {
      // New deploy: drop Cache API + stale app caches, but KEEP the auth session
      // so users are not forced to re-login every backend restart / version bump.
      if (window.caches && typeof window.caches.keys === "function") {
        try {
          const keys = await window.caches.keys();
          await Promise.all(keys.map((k) => window.caches.delete(k)));
        } catch (_) {
          /* ignore */
        }
      }
      window.localStorage.setItem(key, ver);
      // Soft reload so the new dist assets load; token stays in localStorage.
      window.location.reload();
      return;
    }
    if (!prev) window.localStorage.setItem(key, ver);
  } catch (_) {
    // ignore — offline / version endpoint unavailable must not clear login
  }
}

void maybeAutoClearCache();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
