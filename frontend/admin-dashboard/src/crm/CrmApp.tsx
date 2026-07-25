/** Karnex CRM shell: role-based sidebar + notifications bell + mini-router outlet.
 * Depth system: glass header bar, opaque E1 sidebar (so the sheen nav pill never
 * sits inside glass), E2 notifications dropdown, E3 mobile nav drawer.
 * Desktop sidebar: expanded (~240px) or collapsed ICON RAIL (~64px)
 * (localStorage `crm.sidebar.collapsed`); mobile keeps the overlay drawer. */
import React, { Suspense, createContext, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Bell, Menu, PanelLeftClose, PanelLeftOpen, X,
} from "lucide-react";
import { crmGet, crmPost, CrmApiError } from "./api";
import { CrmLink, CrmRouter, readCrmPath } from "./routerHooks";
import { CRM_ROUTES } from "./routes";
import { CRM_NAV, type CrmNavItem } from "./nav";
import { ErrorBox, Spinner } from "./components/ui";
import { MOTION_DUR, MOTION_EASE_OUT } from "./components/motion3d";
import { SidebarUserBlock } from "./components/SidebarUserBlock";
import { isSuperAdmin } from "../lib/rbac";
import { performAdminLogout } from "../lib/adminLogout";
import { crmTabVisibleFromMe, type EffectiveAccess } from "./useAccess";

export { CRM_NAV } from "./nav";

/* Shared :focus-visible ring (tokens.css --focus-ring, readable on glass). */
const focusRing = "focus-visible:outline-none focus-visible:shadow-focus-ring";

/** Desktop sidebar collapse — persisted across reloads. Mobile uses the drawer instead. */
const SIDEBAR_COLLAPSED_KEY = "crm.sidebar.collapsed";
const SIDEBAR_WIDTH_PX = 240; // Tailwind w-60
const SIDEBAR_RAIL_WIDTH_PX = 64; // Tailwind w-16 — icon rail (not hidden)

/** Fixed flyout label for the collapsed icon rail (escapes overflow:hidden ancestors). */
function RailFlyout({
  label,
  anchor,
}: {
  label: string;
  anchor: DOMRect | null;
}) {
  if (!anchor || typeof document === "undefined") return null;
  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[60] -translate-y-1/2 whitespace-nowrap rounded-control border border-subtle bg-surface-3 px-2.5 py-1 text-xs font-semibold text-primary shadow-e2"
      style={{ top: anchor.top + anchor.height / 2, left: anchor.right + 8 }}
    >
      {label}
    </div>,
    document.body,
  );
}
function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function writeSidebarCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "true" : "false");
  } catch {
    /* private mode / quota */
  }
}

export type Me = {
  id: number; username: string; full_name: string; email: string; roles: string[];
  // Per-user tab-access override (Admin/CEO managed). null/undefined = no override.
  tab_access?: string[] | null;
  field_access?: Record<string, string[]> | null;
  access?: EffectiveAccess;
  is_superadmin?: boolean;
  is_ceo?: boolean;
};
const MeCtx = createContext<Me | null>(null);

/** Test / story helper — wrap CRM pages that call useMe / useHasRole. */
export function CrmMeProvider({ value, children }: { value: Me; children: React.ReactNode }) {
  return <MeCtx.Provider value={value}>{children}</MeCtx.Provider>;
}

export function useMe(): Me {
  const me = useContext(MeCtx);
  if (!me) throw new Error("useMe outside CrmApp");
  return me;
}
export function useHasRole(...roles: string[]): boolean {
  const me = useMe();
  return isSuperAdmin(me.roles) || roles.some((r) => me.roles.includes(r));
}

type NavItem = CrmNavItem;

/** Whether a sidebar item should highlight for the current CRM path. */
export function crmNavItemActive(path: string, itemPath: string): boolean {
  if (itemPath === "") return path === "";
  // Opportunities workspace owns both opportunity + requirement list/detail deep links.
  if (itemPath === "opportunities") {
    return (
      path === "opportunities" ||
      path.startsWith("opportunities/") ||
      path === "requirements" ||
      path.startsWith("requirements/")
    );
  }
  return path === itemPath || path.startsWith(itemPath + "/");
}

const NAV = CRM_NAV;

function NotificationsBell() {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);

  const load = async () => {
    try {
      const res = await crmGet<any[]>("/api/notifications?limit=15");
      setItems(res.data || []);
      setUnread((res.meta as any)?.unread_count ?? 0);
    } catch {
      /* CRM may be unconfigured */
    }
  };
  useEffect(() => {
    load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, []);

  const markRead = async (id: number) => {
    try {
      await crmPost(`/api/notifications/${id}/read`);
      load();
    } catch { /* ignore */ }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative rounded-control p-2 text-muted transition-all duration-base ease-smooth hover:bg-surface-1 hover:text-primary active:scale-90 ${focusRing}`}
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unread > 0 && (
          <motion.span
            key={unread}
            initial={reduce ? false : { scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 22 }}
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white shadow-e1"
          >
            {unread > 99 ? "99+" : unread}
          </motion.span>
        )}
      </button>
      {open && (
        /* The only E2 surface while open (one dominant raised layer per view). */
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={reduce ? { duration: MOTION_DUR.fast } : { duration: MOTION_DUR.base, ease: MOTION_EASE_OUT }}
          className="elev-2 absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-panel"
        >
          <div className="flex items-center justify-between border-b border-subtle px-4 py-2.5">
            <span className="text-sm font-bold text-primary">Notifications</span>
            <button
              className={`rounded-control text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300 ${focusRing}`}
              onClick={async () => { await crmPost("/api/notifications/read-all").catch(() => {}); load(); }}
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted">No notifications</div>}
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => markRead(n.id)}
                className={`block w-full border-b border-subtle px-4 py-2.5 text-left transition-colors duration-base ease-smooth hover:bg-surface-1 ${focusRing} ${
                  n.is_read ? "opacity-60" : ""
                }`}
              >
                <div className="text-sm font-semibold text-primary">{n.title}</div>
                {n.message && <div className="text-xs text-muted">{n.message}</div>}
                <div className="mt-0.5 text-[11px] text-muted">{new Date(n.created_at).toLocaleString()}</div>
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

/** Role-filtered nav links, shared by the desktop sidebar and the mobile drawer.
 * `variant="drawer"` uses ≥44px touch targets and its own layoutId.
 * `collapsed` (desktop rail only): icon-only + flyout label on hover/focus. */
function CrmNavLinks({
  items,
  path,
  variant,
  reduce,
  collapsed = false,
}: {
  items: NavItem[];
  path: string;
  roles: string[];
  variant: "sidebar" | "drawer";
  reduce: boolean;
  collapsed?: boolean;
}) {
  const drawer = variant === "drawer";
  const rail = !drawer && collapsed;
  return (
    <>
      {items.map((n) => (
        <CrmNavLinkItem
          key={n.path || "home"}
          item={n}
          active={crmNavItemActive(path, n.path)}
          drawer={drawer}
          rail={rail}
          reduce={reduce}
        />
      ))}
    </>
  );
}

function CrmNavLinkItem({
  item,
  active,
  drawer,
  rail,
  reduce,
}: {
  item: NavItem;
  active: boolean;
  drawer: boolean;
  rail: boolean;
  reduce: boolean;
}) {
  const Icon = item.icon;
  const label = item.label;
  const [flyout, setFlyout] = useState<DOMRect | null>(null);

  const showFlyout = (el: HTMLElement) => {
    if (rail) setFlyout(el.getBoundingClientRect());
  };
  const hideFlyout = () => setFlyout(null);

  return (
    <>
      <CrmLink
        to={item.path}
        aria-label={rail ? label : undefined}
        onMouseEnter={(e) => showFlyout(e.currentTarget)}
        onMouseLeave={hideFlyout}
        onFocus={(e) => showFlyout(e.currentTarget)}
        onBlur={hideFlyout}
        className={`group relative flex items-center rounded-control text-sm font-semibold transition-all duration-base ease-smooth ${focusRing} ${
          rail ? "justify-center px-0 py-2" : "gap-2.5 px-3"
        } ${
          drawer ? "min-h-[44px] py-2.5" : rail ? "" : "py-2"
        } ${
          active
            ? "text-white"
            : `text-secondary hover:bg-surface-2 ${drawer || rail ? "" : "hover:translate-x-0.5"}`
        }`}
      >
        {active && (
          /* Active pill: v3 indigo→violet gradient + soft bloom, animated
             layoutId slide. White text is AA on both stops (6.29 / 5.71). */
          <motion.span
            layoutId={drawer ? "crm-nav-active-drawer" : "crm-nav-active"}
            className="nav-pill-gradient absolute inset-0 rounded-control"
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
            aria-hidden
          />
        )}
        <Icon size={16} className="relative z-10 transition-transform duration-base ease-smooth group-hover:scale-110" />
        {!rail && <span className="relative z-10">{label}</span>}
      </CrmLink>
      {rail && <RailFlyout label={label} anchor={flyout} />}
    </>
  );
}

export default function CrmApp() {
  const reduce = useReducedMotion();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [path, setPath] = useState(readCrmPath());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      writeSidebarCollapsed(next);
      return next;
    });
  };

  useEffect(() => {
    const onPop = () => setPath(readCrmPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    crmGet<Me>("/api/me")
      .then((r) => setMe(r.data))
      .catch((e) => {
        // 401 = session missing/expired — send user to login instead of a dead CRM shell.
        if (e instanceof CrmApiError && e.status === 401) {
          void performAdminLogout();
          return;
        }
        const msg = String(e?.message || "");
        if (/authentication required|unauthorized|please login/i.test(msg)) {
          void performAdminLogout();
          return;
        }
        setError(msg || "Failed to load CRM profile");
      });
  }, []);

  // Mobile drawer: close on navigation and on Escape.
  useEffect(() => {
    setDrawerOpen(false);
  }, [path]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  if (error) {
    return (
      <div className="p-6">
        <ErrorBox error={`Karnex CRM unavailable: ${error}`} onRetry={() => window.location.reload()} />
      </div>
    );
  }
  if (!me) return <Spinner label="Loading Karnex CRM…" />;
  if (!me.roles.length) {
    return (
      <div className="p-6">
        <ErrorBox error="No CRM role is assigned to your account. Ask an Admin to assign one (Users page or assign_crm_role.py)." />
      </div>
    );
  }

  const visible = NAV.filter((n) => {
    const roleOk = isSuperAdmin(me.roles) || n.roles.some((r) => me.roles.includes(r));
    const mandatory = n.path === "";
    // Merged Opportunities workspace: show if either opportunities OR requirements tab is allowed.
    if (n.path === "opportunities") {
      return (
        crmTabVisibleFromMe(me, "opportunities", roleOk, mandatory) ||
        crmTabVisibleFromMe(me, "requirements", roleOk, mandatory)
      );
    }
    return crmTabVisibleFromMe(me, n.path, roleOk, mandatory);
  });

  return (
    <MeCtx.Provider value={me}>
      <div className="relative flex min-h-[calc(100vh-4rem)]">
        {/* Aurora ambience + spotlight — no-ops while nested in the platform
            shell (the `.fx-aurora ~ * .fx-aurora` / `.fx-spotlight` dedup
            rules hide them), active if the CRM shell is ever mounted
            standalone. Pure gradients, zero blur.
            NOTE: no `isolate` here — a stacking context on this root would
            trap the fixed drawer (z-50) / page modals below the platform
            header (z-30). */}
        <div aria-hidden className="fx-aurora" />
        <div aria-hidden className="fx-spotlight" />
        {/* Desktop sidebar — v3 floating inset glass panel (approved .glass
            surface; the active pill is an opaque gradient, so nothing glossy
            nests inside the glass). Width animates 240 ↔ 64 (icon rail);
            mobile uses the drawer below — this aside stays md+ only. */}
        <motion.aside
          className="hidden shrink-0 flex-col overflow-hidden md:flex md:sticky md:top-16 md:h-[calc(100vh-4rem)]"
          initial={false}
          animate={{ width: sidebarCollapsed ? SIDEBAR_RAIL_WIDTH_PX : SIDEBAR_WIDTH_PX }}
          transition={reduce ? { duration: 0 } : { duration: MOTION_DUR.slow, ease: MOTION_EASE_OUT }}
        >
          <div className={`flex h-full min-h-0 w-full min-w-0 flex-col ${sidebarCollapsed ? "p-1" : "p-2"}`}>
            <div className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-panel">
              <div
                className={`flex items-center border-b border-subtle ${
                  sidebarCollapsed ? "flex-col gap-0.5 px-0.5 py-1" : "justify-between gap-1 px-2 py-1.5"
                }`}
              >
                {sidebarCollapsed ? (
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-control bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-900 dark:text-brand-200"
                    aria-hidden
                  >
                    K
                  </span>
                ) : (
                  <span className="truncate px-1 text-sm font-bold text-primary">Karnex</span>
                )}
                <button
                  type="button"
                  onClick={toggleSidebarCollapsed}
                  className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted transition-colors duration-base ease-smooth hover:bg-surface-1 hover:text-primary ${focusRing}`}
                  aria-label={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
                  title={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
                  aria-expanded={!sidebarCollapsed}
                  aria-controls="crm-desktop-sidebar"
                >
                  {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
                </button>
              </div>
              <nav
                id="crm-desktop-sidebar"
                className={`flex flex-1 flex-col gap-0.5 overflow-y-auto ${
                  sidebarCollapsed ? "px-0.5 py-1" : "p-3"
                }`}
              >
                <CrmNavLinks
                  items={visible}
                  path={path}
                  roles={me.roles}
                  variant="sidebar"
                  reduce={!!reduce}
                  collapsed={sidebarCollapsed}
                />
              </nav>
              <div className={`border-t border-subtle ${sidebarCollapsed ? "p-1" : "p-3"}`}>
                <SidebarUserBlock compact={sidebarCollapsed} rail={sidebarCollapsed} />
              </div>
            </div>
          </div>
        </motion.aside>
        <div className="min-w-0 flex-1">
          {/* Glass header bar (E1 glass; nothing glossy nested inside it) with
              the v3 gradient hairline along its bottom edge. */}
          <div className="glass fx-hairline-b flex items-center justify-between border-x-0 border-t-0 px-4 py-2.5 sm:px-5">
            <div className="flex items-center gap-2 text-sm font-bold text-primary">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className={`btn-depth -ml-1 inline-flex h-11 w-11 items-center justify-center rounded-control text-secondary md:hidden ${focusRing}`}
                aria-label="Open CRM navigation"
                aria-haspopup="dialog"
                aria-expanded={drawerOpen}
              >
                <Menu size={18} />
              </button>
              {/* Desktop sidebar toggle — also in the header (rail toggle is in
                  the sidebar). Hidden on mobile (drawer). */}
              <button
                type="button"
                onClick={toggleSidebarCollapsed}
                className={`btn-depth -ml-1 hidden h-9 w-9 shrink-0 items-center justify-center rounded-control border border-subtle bg-surface-1 text-primary shadow-e1 transition-colors duration-base ease-smooth hover:bg-surface-2 hover:text-primary md:inline-flex ${focusRing}`}
                aria-label={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
                title={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
                aria-expanded={!sidebarCollapsed}
                aria-controls="crm-desktop-sidebar"
              >
                {sidebarCollapsed ? <PanelLeftOpen size={18} strokeWidth={2.25} /> : <PanelLeftClose size={18} strokeWidth={2.25} />}
              </button>
              Karnex CRM
              <span className="flex flex-wrap items-center gap-1">
                {me.roles.map((r) => (
                  <span
                    key={r}
                    className="rounded-full border border-subtle bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-700 dark:bg-brand-900 dark:text-brand-200"
                  >
                    {r.replace(/_/g, " ")}
                  </span>
                ))}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <NotificationsBell />
              <span className="md:hidden">
                <SidebarUserBlock compact />
              </span>
            </div>
          </div>

          {/* Mobile navigation — E3 slide-in drawer (backdrop, Escape/nav close,
              ≥44px touch targets). Replaces the old horizontal strip. */}
          <AnimatePresence>
            {drawerOpen && (
              <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="CRM navigation">
                <motion.div
                  className="absolute inset-0 bg-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: MOTION_DUR.base }}
                  onClick={() => setDrawerOpen(false)}
                />
                <motion.aside
                  className="elev-3 absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col rounded-r-panel"
                  initial={reduce ? { opacity: 0 } : { x: "-100%" }}
                  animate={reduce ? { opacity: 1 } : { x: 0 }}
                  exit={reduce ? { opacity: 0 } : { x: "-100%" }}
                  transition={reduce ? { duration: MOTION_DUR.base } : { duration: MOTION_DUR.slow, ease: MOTION_EASE_OUT }}
                >
                  <div className="flex items-center justify-between border-b border-subtle px-4 py-3">
                    <span className="text-sm font-bold text-primary">Karnex CRM</span>
                    <button
                      type="button"
                      onClick={() => setDrawerOpen(false)}
                      className={`inline-flex h-11 w-11 items-center justify-center rounded-control text-muted transition-colors duration-base ease-smooth hover:bg-surface-1 hover:text-primary ${focusRing}`}
                      aria-label="Close navigation"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3" onClick={() => setDrawerOpen(false)}>
                    <CrmNavLinks items={visible} path={path} roles={me.roles} variant="drawer" reduce={!!reduce} />
                  </nav>
                  <div className="border-t border-subtle p-3">
                    <SidebarUserBlock />
                  </div>
                </motion.aside>
              </div>
            )}
          </AnimatePresence>

          <main className="p-5">
            <Suspense fallback={<Spinner />}>
              <motion.div
                key={path}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={reduce ? { duration: MOTION_DUR.base } : { duration: MOTION_DUR.slow, ease: MOTION_EASE_OUT }}
              >
                <CrmRouter routes={CRM_ROUTES} fallback={<ErrorBox error={`Page not found: ${path}`} />} />
              </motion.div>
            </Suspense>
          </main>
        </div>
      </div>
    </MeCtx.Provider>
  );
}
