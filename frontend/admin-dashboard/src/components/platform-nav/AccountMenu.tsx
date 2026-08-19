/** Account / utility dropdown for the platform top bar (theme, role, profile, logout).
 * Menu PORTALS to document.body so glass/backdrop-filter on the top bar cannot
 * trap or clip it. Outside-click is deferred so the opening click never closes it. */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, Keyboard, LogOut, Moon, Settings as SettingsIcon, Sun, UserRound } from "lucide-react";
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
  const [showShortcuts, setShowShortcuts] = useState(false);
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
                  className={`flex w-full items-center gap-2 px-3.5 py-2.5 text-sm font-semibold text-primary hover:bg-surface-1 ${focusRing}`}
                  onClick={() => {
                    close();
                    setShowShortcuts(true);
                  }}
                >
                  <Keyboard className="h-4 w-4" />
                  Shortcuts &amp; tips
                </button>

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
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}

/* ---------- Shortcuts & tips (17 Aug 2026) ----------
 * The palette, Ask AI, column customizer and hub create-buttons are the
 * app's best time-savers — and completely invisible until someone tells you.
 * This modal is that someone. Kept dependency-free (portal + plain markup) so
 * the platform top bar stays decoupled from the CRM component library. */
const SHORTCUT_ROWS: { keys: string[]; what: string }[] = [
  { keys: ["Ctrl", "K"], what: "Search & jump anywhere — customers, pages, candidates" },
  { keys: ["Ctrl", "/"], what: "Ask AI — how a workflow works, or look up your own records" },
  { keys: ["Esc"], what: "Close any open dialog" },
];

const TIP_ROWS: string[] = [
  "Tables: the column icon (top-right) lets you hide, reorder and keep YOUR column layout.",
  "Middle-click any link in the CRM to open it in a new tab — filters won't leak between pages.",
  "Customer page is the hub: branches, CTC slabs, opportunities, POs and invoices all live inside it.",
  "Every list tab has a “New …” button — no need to hunt for the create screen.",
  "Timesheet breakdown: click the amount on a summary tile to see the exact per-day calculation.",
];

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label="Shortcuts and tips"
        className="elev-3 w-full max-w-md overflow-hidden rounded-modal border border-subtle bg-surface-1">
        <div className="flex items-center justify-between border-b border-subtle px-5 py-3.5">
          <span className="text-base font-bold text-primary">Shortcuts &amp; tips</span>
          <button type="button" onClick={onClose} aria-label="Close"
            className="rounded-control p-1 text-muted hover:bg-surface-2 hover:text-primary">✕</button>
        </div>
        <div className="max-h-[70dvh] space-y-4 overflow-y-auto px-5 py-4">
          <div className="space-y-2">
            {SHORTCUT_ROWS.map((r) => (
              <div key={r.what} className="flex items-center gap-3 text-sm">
                <span className="flex shrink-0 gap-1">
                  {r.keys.map((k) => (
                    <kbd key={k} className="rounded border border-subtle bg-surface-2 px-1.5 py-0.5 text-xs font-semibold text-primary">{k}</kbd>
                  ))}
                </span>
                <span className="text-secondary">{r.what}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-subtle pt-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Did you know</div>
            <ul className="m-0 list-none space-y-1.5 p-0">
              {TIP_ROWS.map((t) => (
                <li key={t} className="text-sm text-secondary">· {t}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
