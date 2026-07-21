/** Karnex CRM shell: role-based sidebar + notifications bell + mini-router outlet.
 * Depth system: glass header bar, opaque E1 sidebar (so the sheen nav pill never
 * sits inside glass), E2 notifications dropdown, E3 mobile nav drawer. */
import React, { Suspense, createContext, useContext, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Banknote, Bell, Briefcase, Building2, CalendarDays, CalendarOff, Clock, FileSpreadsheet,
  FileText, LayoutDashboard, Menu, Network, Receipt, Settings as SettingsIcon, Target, UserCog, Users, UsersRound, X,
} from "lucide-react";
import { crmGet, crmPost, CrmApiError } from "./api";
import { CrmLink, CrmRouter, readCrmPath, useCrmPathActive } from "./routerHooks";
import { CRM_ROUTES } from "./routes";
import { ErrorBox, Spinner } from "./components/ui";
import { MOTION_DUR, MOTION_EASE_OUT } from "./components/motion3d";
import { SidebarUserBlock } from "./components/SidebarUserBlock";
import { isSuperAdmin } from "../lib/rbac";
import { performAdminLogout } from "../lib/adminLogout";
import { crmTabVisibleFromMe, type EffectiveAccess } from "./useAccess";

/* Shared :focus-visible ring (tokens.css --focus-ring, readable on glass). */
const focusRing = "focus-visible:outline-none focus-visible:shadow-focus-ring";

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

type NavItem = { path: string; label: string; icon: React.ComponentType<{ size?: number | string; className?: string }>; roles: string[] };

/** Sidebar entries — exported for light nav-merge tests. */
export const CRM_NAV: NavItem[] = [
  { path: "", label: "Dashboard", icon: LayoutDashboard, roles: ["Admin", "Sales", "Sales_Head", "RMG", "TA", "HR", "Finance"] },
  { path: "customers", label: "Customers", icon: Building2, roles: ["Admin", "Sales", "Sales_Head", "TA"] },
  { path: "opportunities", label: "Opportunities", icon: Target, roles: ["Admin", "Sales", "Sales_Head", "RMG", "TA"] },
  { path: "candidates", label: "Candidates", icon: Users, roles: ["Admin", "TA", "Sales", "Sales_Head"] },
  { path: "template-requests", label: "Template Requests", icon: FileText, roles: ["Admin", "TA", "RMG"] },
  { path: "profiles", label: "Candidate Profiles", icon: UsersRound, roles: ["Admin", "Sales", "Sales_Head", "RMG", "TA"] },
  { path: "projects", label: "Projects", icon: Briefcase, roles: ["Admin", "Sales", "Sales_Head"] },
  { path: "project-employees", label: "Project Employees", icon: Network, roles: ["Admin", "Sales", "Sales_Head", "HR", "Finance"] },
  { path: "my-leave", label: "My Leave", icon: CalendarDays, roles: ["Admin", "Sales", "Sales_Head", "RMG", "TA", "HR", "Finance"] },
  { path: "leave-applications", label: "Leave Applications", icon: CalendarDays, roles: ["Admin", "HR"] },
  { path: "holidays", label: "Holidays", icon: CalendarOff, roles: ["Admin", "HR"] },
  { path: "timesheets", label: "Timesheets", icon: Clock, roles: ["Admin", "HR", "Finance", "RMG", "Sales", "Sales_Head"] },
  { path: "pos", label: "Purchase Orders", icon: Receipt, roles: ["Admin", "Finance"] },
  { path: "invoices", label: "Invoices", icon: FileText, roles: ["Admin", "Finance"] },
  { path: "tds", label: "TDS", icon: Banknote, roles: ["Admin", "Finance"] },
  { path: "employees", label: "Employees", icon: UserCog, roles: ["Admin", "HR"] },
  { path: "reports", label: "Reports", icon: FileSpreadsheet, roles: ["Admin", "Sales", "Sales_Head", "RMG", "TA", "HR", "Finance"] },
  { path: "users", label: "Users", icon: UserCog, roles: ["Admin", "CEO"] },
  { path: "access-templates", label: "Access Templates", icon: UserCog, roles: ["Admin", "CEO"] },
  { path: "settings", label: "Settings", icon: SettingsIcon, roles: ["Admin", "CEO"] },
];

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
 * `variant="drawer"` uses ≥44px touch targets and its own layoutId. */
function CrmNavLinks({
  items,
  path,
  variant,
  reduce,
}: {
  items: NavItem[];
  path: string;
  roles: string[];
  variant: "sidebar" | "drawer";
  reduce: boolean;
}) {
  const drawer = variant === "drawer";
  return (
    <>
      {items.map((n) => {
        const active = crmNavItemActive(path, n.path);
        const Icon = n.icon;
        const label = n.label;
        return (
          <CrmLink
            key={n.path || "home"}
            to={n.path}
            className={`group relative flex items-center gap-2.5 rounded-control px-3 text-sm font-semibold transition-all duration-base ease-smooth ${focusRing} ${
              drawer ? "min-h-[44px] py-2.5" : "py-2"
            } ${
              active
                ? "text-white"
                : `text-secondary hover:bg-surface-2 ${drawer ? "" : "hover:translate-x-0.5"}`
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
            <span className="relative z-10">{label}</span>
          </CrmLink>
        );
      })}
    </>
  );
}

export default function CrmApp() {
  const reduce = useReducedMotion();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [path, setPath] = useState(readCrmPath());
  const [drawerOpen, setDrawerOpen] = useState(false);

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
            nests inside the glass). Outer <aside> keeps the sticky geometry;
            p-2 creates the floating inset. */}
        <aside className="hidden w-60 shrink-0 flex-col p-2 md:flex md:sticky md:top-16 md:h-[calc(100vh-4rem)]">
          <div className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-panel">
            <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
              <CrmNavLinks items={visible} path={path} roles={me.roles} variant="sidebar" reduce={!!reduce} />
            </nav>
            <div className="border-t border-subtle p-3">
              <SidebarUserBlock />
            </div>
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          {/* Glass header bar (E1 glass; nothing glossy nested inside it) with
              the v3 gradient hairline along its bottom edge. */}
          <div className="glass fx-hairline-b flex items-center justify-between border-x-0 border-t-0 px-4 py-2.5 sm:px-5">
            <div className="flex items-center gap-2 text-sm font-bold text-primary">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className={`btn-depth -ml-1 inline-flex h-11 w-11 items-center justify-center rounded-control text-secondary md:hidden`}
                aria-label="Open CRM navigation"
                aria-haspopup="dialog"
                aria-expanded={drawerOpen}
              >
                <Menu size={18} />
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
