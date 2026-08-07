/** Account / utility dropdown for the platform top bar (theme, role, profile, logout).
 * Menu PORTALS to document.body so glass/backdrop-filter on the top bar cannot
 * trap or clip it. Outside-click is deferred so the opening click never closes it. */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, LogOut, Moon, Settings as SettingsIcon, Sun, UserRound } from "lucide-react";
import { Avatar } from "../../crm/components/Avatar";
import { getStoredAuthUser } from "../../lib/authSession";
import { performAdminLogout } from "../../lib/adminLogout";
import { useTheme } from "../../theme/ThemeProvider";
import { crmNavigate } from "../../crm/routerHooks";
import { isSuperAdmin } from "../../lib/rbac";

const focusRing = "focus-visible:outline-none focus-visible:shadow-focus-ring";

function readUserChip(): { name: string; email: string } {
  const u = getStoredAuthUser();
  const name = String(u?.full_name || u?.username || "User").trim() || "User";
  const email = String(u?.email || u?.username || "").trim();
  return { name, email };
}

/** CRM RBAC role names from `/api/me` (e.g. "Admin & CEO"). Falls back to legacy auth role. */
function formatRoleLabel(roles: string[]): string {
  const crm = roles.map((r) => String(r || "").trim()).filter(Boolean);
  if (crm.length) {
    return crm.map((r) => r.replace(/_/g, " ")).join(" & ");
  }
  const legacy = String(getStoredAuthUser()?.role || "").trim();
  return legacy ? legacy.replace(/_/g, " ") : "—";
}

export function AccountMenu({
  canCrm,
  roles,
}: {
  canCrm: boolean;
  roles: string[];
}) {
  const { theme, toggleTheme } = useTheme();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState(readUserChip);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const canSettings = canCrm && isSuperAdmin(roles);
  const roleLabel = useMemo(() => formatRoleLabel(roles), [roles]);

  useEffect(() => {
    setUser(readUserChip());
  }, []);

  const close = () => setOpen(false);

  const openMenu = () => {
    const r = rootRef.current?.getBoundingClientRect();
    if (r) {
      setAnchor({
        top: Math.min(r.bottom + 8, window.innerHeight - 16),
        right: Math.max(8, window.innerWidth - r.right),
      });
    } else {
      setAnchor({ top: 64, right: 8 });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;

    let remove: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      const onPointer = (e: Event) => {
        const t = e.target as Node | null;
        if (!t) return;
        if (rootRef.current?.contains(t)) return;
        if (menuRef.current?.contains(t)) return;
        setOpen(false);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setOpen(false);
      };
      document.addEventListener("pointerdown", onPointer, true);
      window.addEventListener("keydown", onKey);
      remove = () => {
        document.removeEventListener("pointerdown", onPointer, true);
        window.removeEventListener("keydown", onKey);
      };
    }, 0);

    return () => {
      window.clearTimeout(timer);
      remove?.();
    };
  }, [open]);

  const goCrm = (path: string) => {
    setOpen(false);
    crmNavigate(path);
  };

  const menu =
    typeof document !== "undefined"
      ? createPortal(
          <AnimatePresence>
            {open ? (
              <motion.div
                key="account-menu"
                ref={menuRef}
                id={menuId}
                role="menu"
                aria-label="Account"
                initial={reduce ? false : { opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
                transition={reduce ? { duration: 0 } : { duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                className="elev-2 fixed z-[10050] w-[min(16rem,calc(100vw-1rem))] overflow-hidden rounded-panel bg-surface-2 sm:w-64"
                style={{
                  top: anchor?.top ?? 64,
                  right: anchor?.right ?? 8,
                  left: "auto",
                }}
              >
                <div className="border-b border-subtle px-3.5 py-3">
                  <div className="truncate text-sm font-bold text-primary">{user.name}</div>
                  {user.email ? (
                    <div className="mt-0.5 truncate text-xs text-muted">{user.email}</div>
                  ) : null}
                </div>

                <div className="border-b border-subtle px-3.5 py-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Role</div>
                  <div className="mt-0.5 text-sm font-semibold text-primary">{roleLabel}</div>
                </div>

                <button
                  type="button"
                  role="menuitem"
                  className={`flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-sm font-semibold text-primary hover:bg-surface-1 ${focusRing}`}
                  onClick={() => {
                    toggleTheme();
                  }}
                >
                  <span className="inline-flex items-center gap-2">
                    {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                    {theme === "dark" ? "Light mode" : "Dark mode"}
                  </span>
                </button>

                {canCrm && (
                  <button
                    type="button"
                    role="menuitem"
                    className={`flex w-full items-center gap-2 px-3.5 py-2.5 text-sm font-semibold text-primary hover:bg-surface-1 ${focusRing}`}
                    onClick={() => goCrm("profile")}
                  >
                    <UserRound className="h-4 w-4" />
                    My Profile
                  </button>
                )}
                {canSettings && (
                  <button
                    type="button"
                    role="menuitem"
                    className={`flex w-full items-center gap-2 px-3.5 py-2.5 text-sm font-semibold text-primary hover:bg-surface-1 ${focusRing}`}
                    onClick={() => goCrm("settings")}
                  >
                    <SettingsIcon className="h-4 w-4" />
                    Settings
                  </button>
                )}

                <button
                  type="button"
                  role="menuitem"
                  className={`flex w-full items-center gap-2 border-t border-subtle px-3.5 py-2.5 text-sm font-semibold text-danger hover:bg-danger-soft ${focusRing}`}
                  onClick={() => {
                    close();
                    void performAdminLogout();
                  }}
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              </motion.div>
            ) : null}
          </AnimatePresence>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={`btn-depth inline-flex h-10 items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-1.5 pl-1.5 pr-2 text-primary ${focusRing}`}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={`${user.name}${user.email ? ` · ${user.email}` : ""}`}
        onClick={() => (open ? close() : openMenu())}
      >
        <Avatar name={user.name} size={28} />
        <span className="hidden max-w-[6.5rem] truncate text-xs font-semibold xl:inline">
          {user.name.split(/\s+/)[0]}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted transition-transform duration-fast ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {menu}
    </div>
  );
}
