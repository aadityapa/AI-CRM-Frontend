/** Account / utility dropdown for the platform top bar (theme, role, profile, logout). */
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const canSettings = canCrm && isSuperAdmin(roles);
  const roleLabel = useMemo(() => formatRoleLabel(roles), [roles]);

  useEffect(() => {
    setUser(readUserChip());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const goCrm = (path: string) => {
    setOpen(false);
    crmNavigate(path);
  };

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
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={user.name} size={28} />
        <span className="hidden max-w-[6.5rem] truncate text-xs font-semibold sm:inline">
          {user.name.split(/\s+/)[0]}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted transition-transform duration-fast ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={menuId}
            role="menu"
            aria-label="Account"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            transition={reduce ? { duration: 0 } : { duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="elev-2 absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-panel"
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
                setOpen(false);
                void performAdminLogout();
              }}
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
