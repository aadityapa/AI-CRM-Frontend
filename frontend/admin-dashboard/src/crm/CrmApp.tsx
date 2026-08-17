/** Karnex CRM shell: role-based sidebar + notifications bell + mini-router outlet.
 * Depth system: glass header bar, opaque E1 sidebar (so the sheen nav pill never
 * sits inside glass), E2 notifications dropdown, E3 mobile nav drawer.
 * Desktop sidebar: expanded (~240px) or collapsed ICON RAIL (~64px)
 * (localStorage `crm.sidebar.collapsed`); mobile keeps the overlay drawer. */
import React, { Suspense, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Bell, Menu, PanelLeftClose, PanelLeftOpen, X,
} from "lucide-react";
import { crmGet, crmPost, CrmApiError } from "./api";
import { CrmLink, CrmRouter, crmNavigate, readCrmPath } from "./routerHooks";
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
const SIDEBAR_WIDTH_PX = 220; // compact desktop shell for normal 100% zoom
const SIDEBAR_RAIL_WIDTH_PX = 60; // slightly tighter collapsed rail

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
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null);

  const load = async () => {
    try {
      const res = await crmGet<any[]>("/api/notifications?limit=15");
      const rows = (res.data || []).filter(
        (n: any) => n && n.id != null && String(n.title || "").trim() !== "",
      );
      setItems(rows);
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

  const placePanel = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPanelPos({
      top: Math.round(r.bottom + 8),
      right: Math.round(Math.max(8, window.innerWidth - r.right)),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    placePanel();
    const onResize = () => placePanel();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [open, placePanel]);

  const markRead = async (id: number) => {
    try {
      await crmPost(`/api/notifications/${id}/read`);
      load();
    } catch { /* ignore */ }
  };

  /**
   * Open the record a notification is about.
   *
   * The backend has always set a deep link ("/admin?view=crm&p=profiles/42"),
   * but this panel only ever rendered the title and message — so a notification
   * saying "RMG Review: Bibin P S" left the reader to go and find Bibin by hand.
   * That is the difference between an alert and a to-do.
   *
   * Only same-origin CRM links are followed. `link` is server-generated today,
   * but treating a stored string as a navigation target without checking is how
   * an open-redirect appears later.
   */
  const openNotification = async (n: any) => {
    const link = String(n?.link || "").trim();
    if (!n?.is_read) void markRead(n.id);
    if (!link) return;
    setOpen(false);

    const crmPath = link.match(/[?&]p=([^&]+)/);
    if (crmPath && link.includes("view=crm")) {
      crmNavigate(decodeURIComponent(crmPath[1]));
      return;
    }
    // Other in-app links (e.g. the interview report) are relative paths on this
    // origin. Anything absolute or protocol-relative is ignored.
    if (link.startsWith("/") && !link.startsWith("//")) {
      window.location.assign(link);
    }
  };

  const panel = open && panelPos && typeof document !== "undefined"
    ? createPortal(
      /* Portaled to body — must NOT sit inside the glass header (backdrop-filter
         compositing paints a white ghost rectangle over the list on Chromium). */
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-label="Notifications"
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={reduce ? { duration: MOTION_DUR.fast } : { duration: MOTION_DUR.base, ease: MOTION_EASE_OUT }}
        style={{ top: panelPos.top, right: panelPos.right }}
        className="elev-2 fixed z-[80] flex w-80 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-panel bg-surface-2"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-subtle bg-surface-2 px-4 py-2.5">
          <span className="text-sm font-bold text-primary">Notifications</span>
          <button
            type="button"
            className={`rounded-control text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300 ${focusRing}`}
            onClick={async () => { await crmPost("/api/notifications/read-all").catch(() => {}); load(); }}
          >
            Mark all read
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto overscroll-contain bg-surface-2">
          {items.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted">No notifications</div>
          )}
          <ul className="divide-y divide-subtle m-0 list-none p-0">
            {items.map((n) => (
              <li key={n.id} className="bg-surface-2">
                <button
                  type="button"
                  onClick={() => void openNotification(n)}
                  title={n.link ? "Open this candidate" : undefined}
                  className={`block w-full bg-surface-2 px-4 py-2.5 text-left transition-colors duration-base ease-smooth hover:bg-surface-1 focus:outline-none focus-visible:bg-surface-1 ${
                    n.is_read ? "opacity-60" : ""
                  } ${n.link ? "cursor-pointer" : ""}`}
                >
                  <div className="text-sm font-semibold text-primary">{n.title}</div>
                  {n.message ? <div className="text-xs text-muted">{n.message}</div> : null}
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                    <span>{n.created_at ? new Date(n.created_at).toLocaleString() : ""}</span>
                    {n.link && (
                      <span className="font-semibold text-brand-600 dark:text-brand-300">
                        Open →
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </motion.div>,
      document.body,
    )
    : null;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`relative rounded-control p-2 text-muted transition-all duration-base ease-smooth hover:bg-surface-1 hover:text-primary active:scale-90 ${focusRing}`}
        aria-label="Notifications"
        aria-expanded={open}
        aria-haspopup="dialog"
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
      {panel}
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

  // Admin-authored copy overrides (status tooltips, empty-state text).
  // Fire-and-forget: the built-in copy is already correct, overrides just
  // customise it, so nothing waits on this request.
  useEffect(() => {
    import("./lib/statusHelp").then(({ setUiTextOverrides }) => {
      crmGet<Record<string, string>>("/api/ui-text")
        .then((r) => setUiTextOverrides(r.data))
        .catch(() => {});
    });
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

  // The Customer page is the hub (Aug 2026): these pages exist as tabs inside
  // every customer, so anyone who can open Customers reaches them customer-
  // first and their sidebar entries disappear — the rail stays short. Users
  // WITHOUT Customers access (Finance, RMG, HR, employees) keep the global
  // entries: for them the sidebar is the only road to those pages.
  // "opportunities" is NOT here although the hub covers it: that sidebar
  // entry is also the Requirements workspace (cross-customer sourcing for
  // TA/RMG), which no customer tab replaces.
  // "timesheets" left the set in Aug 2026: it became the attendance hub
  // hosting Payroll, My Leave and Leave Applications — personal tabs no
  // customer tab replaces, so the global entry stays for everyone.
  // "projects" is deliberately NOT here any more: it became the project hub
  // (PE / Timesheets / POs / Invoices tabs) replacing the Timesheets entry.
  const HUB_COVERED = new Set([
    "project-employees", "holidays",
    "pos", "invoices",
  ]);
  const customersRoleOk = isSuperAdmin(me.roles)
    || (NAV.find((n) => n.path === "customers")?.roles || []).some((r) => me.roles.includes(r));
  const hasCustomersAccess = crmTabVisibleFromMe(me, "customers", customersRoleOk, false);

  const visible = NAV.filter((n) => {
    const roleOk = isSuperAdmin(me.roles) || n.roles.some((r) => me.roles.includes(r));
    const mandatory = n.path === "";
    if (hasCustomersAccess && HUB_COVERED.has(n.path)) return false;
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
      {/* Desktop (md+): fixed app-shell — the shell itself never scrolls; only
          <main> does. Sidebar + platform bar + CRM header stay pinned without
          relying on position:sticky (which ancestor overflow rules defeat). */}
      <div className="relative flex min-h-[calc(100vh-4rem)] min-w-0 overflow-x-clip md:h-[calc(100vh-4rem)] md:overflow-hidden">
        {/* Aurora ambience + spotlight — no-ops while nested in the platform
            shell (the `.fx-aurora ~ * .fx-aurora` / `.fx-spotlight` dedup
            rules hide them), active if the CRM shell is ever mounted
            standalone. Pure gradients, zero blur.
            NOTE: no `isolate` here — a stacking context on this root would
            trap the fixed drawer (z-50) / page modals below the platform
            header (z-30). */}
          <div aria-hidden className="fx-aurora crm-print-hide" />
        <div aria-hidden className="fx-spotlight crm-print-hide" />
        {/* Desktop sidebar — v3 floating inset glass panel (approved .glass
            surface; the active pill is an opaque gradient, so nothing glossy
            nests inside the glass). Width animates 240 ↔ 64 (icon rail);
            mobile uses the drawer below — this aside stays md+ only. */}
        <motion.aside
          className="crm-print-hide hidden shrink-0 flex-col overflow-hidden md:flex md:h-full"
          initial={false}
          animate={{ width: sidebarCollapsed ? SIDEBAR_RAIL_WIDTH_PX : SIDEBAR_WIDTH_PX }}
          transition={reduce ? { duration: 0 } : { duration: MOTION_DUR.slow, ease: MOTION_EASE_OUT }}
        >
          <div className={`flex h-full min-h-0 w-full min-w-0 flex-col ${sidebarCollapsed ? "p-1" : "p-1.5"}`}>
            <div className="kx-chrome-navy glass flex h-full min-h-0 flex-col overflow-hidden rounded-panel">
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
                  sidebarCollapsed ? "px-0.5 py-1" : "p-2.5"
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
              <div className={`border-t border-subtle ${sidebarCollapsed ? "p-1" : "p-2.5"}`}>
                <SidebarUserBlock compact={sidebarCollapsed} rail={sidebarCollapsed} />
              </div>
            </div>
          </div>
        </motion.aside>
        <div className="min-w-0 flex-1 overflow-x-hidden md:flex md:min-h-0 md:flex-col">
          {/* Glass header bar (E1 glass; nothing glossy nested inside it) with
              the v3 gradient hairline along its bottom edge. */}
          <div className="crm-print-hide kx-chrome-navy glass fx-hairline-b flex min-w-0 items-center justify-between gap-3 border-x-0 border-t-0 px-3 py-2 sm:px-4">
            <div className="flex min-w-0 items-center gap-2 text-sm font-bold text-primary">
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
              <span className="truncate">Karnex CRM</span>
              <span className="hidden flex-wrap items-center gap-1 lg:flex">
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
            <div className="flex shrink-0 items-center gap-2">
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
                  className="kx-chrome-navy elev-3 absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col rounded-r-panel"
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
                  <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
                    <CrmNavLinks items={visible} path={path} roles={me.roles} variant="drawer" reduce={!!reduce} />
                  </nav>
                  <div className="border-t border-subtle p-3">
                    <SidebarUserBlock />
                  </div>
                </motion.aside>
              </div>
            )}
          </AnimatePresence>

          <main className="min-w-0 overflow-x-hidden p-3 sm:p-4 xl:p-5 md:min-h-0 md:flex-1 md:overflow-y-auto">
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
