/** Tiny dependency-free router for the CRM section.
 * The admin app routes by query params; the CRM lives at ?view=crm&p=<path>
 * (e.g. p=customers/12). Supports :param segments, navigate(), <CrmLink>.
 *
 * Page filters may be passed as a query suffix on `path` (e.g.
 * `timesheets?project_id=1&employee_id=2`). Those keys become sibling URL
 * search params — never part of `p` — so matchRoute keeps working. */
import React, { createContext, useContext, useEffect, useState } from "react";

/** Per-page keys that may be set via `crmNavigate("page?…")`. Cleared on every
 * navigation so stale filters do not leak across CRM pages.
 *
 * `tab` is here for the same reason as the filters: it is meaningful only to
 * the page that reads it, so carrying it onto the next page would land the
 * reader on an arbitrary tab (or none) after following any other link. */
const CRM_FILTER_KEYS = ["project_id", "employee_id", "tab", "q"] as const;

function splitPathQuery(path: string): { pathPart: string; queryPart: string } {
  const raw = path.replace(/^\/+/, "");
  const q = raw.indexOf("?");
  if (q < 0) return { pathPart: raw.replace(/\/+$/g, ""), queryPart: "" };
  return {
    pathPart: raw.slice(0, q).replace(/\/+$/g, ""),
    queryPart: raw.slice(q + 1),
  };
}

export function readCrmPath(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    // Strip any legacy ?query that was wrongly baked into `p`.
    return (params.get("p") || "").replace(/^\/+|\/+$/g, "").split("?")[0];
  } catch {
    return "";
  }
}

export function crmUrl(path: string): string {
  const params = new URLSearchParams(window.location.search);
  params.set("view", "crm");
  const { pathPart, queryPart } = splitPathQuery(path);
  if (pathPart) params.set("p", pathPart);
  else params.delete("p");

  for (const k of CRM_FILTER_KEYS) params.delete(k);
  if (queryPart) {
    new URLSearchParams(queryPart).forEach((v, k) => {
      if (v !== "") params.set(k, v);
    });
  }
  return `${window.location.pathname}?${params.toString()}`;
}

export function crmNavigate(path: string): void {
  window.history.pushState({}, "", crmUrl(path));
  window.dispatchEvent(new PopStateEvent("popstate"));
}

type RouterCtx = { path: string; params: Record<string, string> };
const Ctx = createContext<RouterCtx>({ path: "", params: {} });

export function useCrmPath(): string {
  return useContext(Ctx).path;
}

export function useCrmParams(): Record<string, string> {
  return useContext(Ctx).params;
}

/** Match "customers/:id" against "customers/12" → {id: "12"} or null. */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const ps = pattern.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  const xs = path.split("/").filter(Boolean);
  if (pattern === "" || ps.length === 0) return xs.length === 0 ? {} : null;
  if (ps.length !== xs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < ps.length; i++) {
    if (ps[i].startsWith(":")) params[ps[i].slice(1)] = decodeURIComponent(xs[i]);
    else if (ps[i] !== xs[i]) return null;
  }
  return params;
}

export type CrmRoute = { pattern: string; element: React.ComponentType };

export function CrmRouter({ routes, fallback }: { routes: CrmRoute[]; fallback: React.ReactNode }) {
  const [path, setPath] = useState<string>(readCrmPath());
  useEffect(() => {
    const onPop = () => setPath(readCrmPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  for (const r of routes) {
    const params = matchRoute(r.pattern, path);
    if (params) {
      const El = r.element;
      return (
        <Ctx.Provider value={{ path, params }}>
          <El />
        </Ctx.Provider>
      );
    }
  }
  /* Deep-link salvage (25 Aug 2026): a link like "template-requests/14" has no
   * detail route, but its PARENT list does — landing there beats a dead "Page
   * not found" for every notification/email that targets a list-only page. */
  const head = path.split("/")[0];
  if (head && head !== path) {
    for (const r of routes) {
      const params = matchRoute(r.pattern, head);
      if (params) {
        const El = r.element;
        return (
          <Ctx.Provider value={{ path: head, params }}>
            <El />
          </Ctx.Provider>
        );
      }
    }
  }
  return <>{fallback}</>;
}

export function CrmLink({
  to,
  className,
  children,
  title,
  "aria-label": ariaLabel,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
}: {
  to: string;
  className?: string;
  children: React.ReactNode;
  title?: string;
  "aria-label"?: string;
  onMouseEnter?: React.MouseEventHandler<HTMLAnchorElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLAnchorElement>;
  onFocus?: React.FocusEventHandler<HTMLAnchorElement>;
  onBlur?: React.FocusEventHandler<HTMLAnchorElement>;
}) {
  return (
    <a
      href={crmUrl(to)}
      title={title}
      aria-label={ariaLabel}
      className={className}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        crmNavigate(to);
      }}
    >
      {children}
    </a>
  );
}
