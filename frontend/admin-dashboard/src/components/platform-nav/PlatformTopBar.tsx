/** Platform product top bar (NOT the CRM left sidebar).
 * Sticky glass header: section tabs, Interview Schedule CTA, search/⌘K,
 * and a single account dropdown. */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  CalendarClock,
  Menu,
  Moon,
  Search,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { KarnexBranding } from "../KarnexBranding";
import { AccountMenu } from "./AccountMenu";
import { CommandPalette, type CommandItem } from "./CommandPalette";
import { AskAiPanel } from "../ask-ai/AskAiPanel";
import { ThemePicker } from "../../theme/ThemePicker";
import { CRM_NAV } from "../../crm/nav";
import { crmNavigate } from "../../crm/routerHooks";
import { crmTabKey, isSuperAdmin, tabVisible } from "../../lib/rbac";
import { useTheme } from "../../theme/ThemeProvider";

const focusRing = "focus-visible:outline-none focus-visible:shadow-focus-ring";
const MULTI_COLOR_GRAD =
  "linear-gradient(135deg, #f59e0b 0%, #ef4444 22%, #ec4899 45%, #8b5cf6 68%, #06b6d4 88%, #22c55e 100%)";

export type PlatformNavItem = {
  target: string;
  label: string;
  icon: LucideIcon;
  active: (view: string) => boolean;
};

type NavMotion = Partial<Pick<HTMLMotionProps<"button">, "whileHover" | "whileTap" | "transition">>;

function useScrolled(threshold = 4): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}

export function PlatformTopBar({
  navItems,
  view,
  onNavigate,
  canSchedule,
  onSchedule,
  canCrm,
  roles,
  tabAccess,
  rbacActive,
  navMotion,
}: {
  navItems: PlatformNavItem[];
  view: string;
  onNavigate: (target: string) => void;
  canSchedule: boolean;
  onSchedule: () => void;
  canCrm: boolean;
  roles: string[];
  tabAccess: string[] | null;
  rbacActive: boolean;
  navMotion: NavMotion;
}) {
  const reduceMotion = useReducedMotion();
  const scrolled = useScrolled();
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [askAiOpen, setAskAiOpen] = useState(false);
  const isDark = theme === "dark";
  /** The active tab button — kept visible inside the scrollable nav rail. */
  const activeTabRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setMobileOpen(false);
  }, [view]);

  /* Keep the active tab (e.g. CRM) fully visible inside the scrollable rail. */
  useEffect(() => {
    const el = activeTabRef.current;
    if (!el) return;
    const id = window.setTimeout(() => {
      const rail = el.closest("nav");
      if (rail instanceof HTMLElement) {
        const railRect = rail.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const pad = 12;
        if (elRect.right > railRect.right - pad) {
          rail.scrollLeft += elRect.right - railRect.right + pad;
        } else if (elRect.left < railRect.left + pad) {
          rail.scrollLeft -= railRect.left + pad - elRect.left;
        }
      } else {
        el.scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
          inline: "nearest",
          block: "nearest",
        });
      }
    }, 40);
    return () => window.clearTimeout(id);
  }, [view, reduceMotion, navItems.length]);

  /* ---- ⌘K / Ctrl+K (palette) · ⌘/ / Ctrl+/ (Ask AI) — distinct chords ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "/" || e.code === "Slash")) {
        e.preventDefault();
        setAskAiOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commandItems: CommandItem[] = useMemo(() => {
    const out: CommandItem[] = navItems.map((item) => ({
      id: `iv:${item.target}`,
      label: item.label,
      group: "Platform",
      icon: item.icon,
      run: () => onNavigate(item.target),
    }));
    if (canCrm) {
      for (const n of CRM_NAV) {
        if (rbacActive) {
          const roleOk = isSuperAdmin(roles) || n.roles.some((r) => roles.includes(r));
          const permitted = tabVisible(tabAccess, crmTabKey(n.path), roleOk);
          if (!permitted) continue;
        }
        out.push({
          id: `crm:${n.path || "dashboard"}`,
          label: n.label,
          group: "CRM",
          icon: n.icon as LucideIcon,
          run: () => crmNavigate(n.path),
        });
      }
    }
    if (canSchedule) {
      out.push({
        id: "iv:hrSetup",
        label: "Interview Schedule",
        group: "Platform",
        icon: CalendarClock,
        run: onSchedule,
      });
    }
    out.push({
      id: "iv:askAi",
      label: "Ask AI",
      group: "Platform",
      icon: Sparkles,
      run: () => setAskAiOpen(true),
    });
    out.push({
      id: "iv:theme",
      label: isDark ? "Light mode" : "Dark mode",
      group: "Platform",
      icon: isDark ? Sun : Moon,
      run: () => toggleTheme(),
    });
    return out;
  }, [navItems, canCrm, roles, tabAccess, rbacActive, canSchedule, onNavigate, onSchedule, isDark, toggleTheme]);

  const renderTab = (item: PlatformNavItem) => {
    const Icon = item.icon;
    const isActive = item.active(view);
    return (
      <motion.button
        key={item.target}
        type="button"
        {...navMotion}
        ref={isActive ? activeTabRef : undefined}
        onClick={() => onNavigate(item.target)}
        aria-current={isActive ? "page" : undefined}
        aria-label={item.label}
        title={item.label}
        className={`group relative flex shrink-0 scroll-mx-3 items-center justify-center gap-1.5 rounded-control py-2 text-sm font-semibold transition-colors duration-base ease-smooth ${
          isActive ? "px-2.5 sm:px-3" : "px-2"
        } ${focusRing} ${
          isActive
            ? "text-brand-700 dark:text-brand-200"
            : "text-[var(--kx-text-muted)] hover:bg-surface-1 hover:text-[var(--kx-text)]"
        }`}
      >
        {isActive && (
          <motion.span
            layoutId="admin-nav-active"
            aria-hidden
            className="sheen absolute inset-0 rounded-control border border-subtle bg-brand-100 shadow-e1 dark:bg-brand-900"
            transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 35 }}
          />
        )}
        <Icon
          className={`relative h-4 w-4 shrink-0 transition-transform duration-base ease-smooth group-hover:scale-110 ${
            isActive ? "text-brand-600 dark:text-brand-300" : ""
          }`}
        />
        {/* Full class strings so Tailwind JIT keeps them. Labels only on wide screens
            so all 7 tabs (incl. CRM) always fit beside the right action cluster. */}
        {isActive ? (
          <span className="relative hidden md:inline">{item.label}</span>
        ) : (
          <span className="relative hidden 2xl:inline">{item.label}</span>
        )}
      </motion.button>
    );
  };

  return (
    <>
      <header
        className={`kx-chrome-navy glass fx-hairline-b sticky top-0 z-40 rounded-none border-x-0 border-t-0 transition-[box-shadow,background-color] duration-base ease-smooth ${
          scrolled ? "shadow-overlay !backdrop-blur-md" : ""
        }`}
      >
        <div className="relative flex h-16 w-full min-w-0 items-center gap-2 pl-3 pr-3 sm:gap-3 sm:pl-4 sm:pr-5 lg:pl-5 lg:pr-8">
          <div className="z-10 ml-1 flex shrink-0 items-center self-stretch sm:ml-1.5">
            <KarnexBranding size="sm" />
          </div>

          {navItems.length > 0 && (
            <div className="relative z-[5] hidden min-w-0 flex-1 items-center justify-center overflow-hidden md:flex md:px-1 lg:px-2">
              <nav
                className="flex w-max max-w-full min-w-0 items-center gap-0.5 overflow-x-auto overscroll-x-contain rounded-modal border border-subtle bg-surface-0 p-1 shadow-[var(--recess-shadow)] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                aria-label="Platform sections"
              >
                {navItems.map((item) => renderTab(item))}
              </nav>
            </div>
          )}

          {navItems.length === 0 && <div className="min-w-0 flex-1" aria-hidden />}

          <div className="z-10 ml-2 flex shrink-0 items-center gap-1.5 sm:ml-3 sm:gap-2">
            {navItems.length > 0 && (
              <button
                type="button"
                onClick={() => setMobileOpen((o) => !o)}
                className={`btn-depth inline-flex h-10 w-10 items-center justify-center rounded-control text-[var(--kx-text-muted)] md:hidden ${focusRing}`}
                aria-label="Toggle navigation"
                aria-expanded={mobileOpen}
                title="Navigation"
              >
                {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            )}

            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className={`btn-depth inline-flex h-10 w-10 items-center justify-center rounded-control text-[var(--kx-text-muted)] hover:bg-surface-1 hover:text-primary ${focusRing}`}
              aria-label="Search sections (Control K)"
              title="Search (⌘K / Ctrl+K)"
            >
              <Search className="h-4 w-4" />
            </button>

            {canSchedule && (
              <button
                type="button"
                onClick={onSchedule}
                className={`btn-depth inline-flex h-10 items-center gap-2 rounded-control bg-brand-600 px-2.5 text-sm font-semibold text-white sm:px-3 ${focusRing}`}
                title="Open HR Setup to schedule / invite a candidate for an interview"
                aria-label="Interview Schedule"
              >
                <CalendarClock className="h-4 w-4 shrink-0" />
                <span className="hidden 2xl:inline">Interview Schedule</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setAskAiOpen(true)}
              className={`group relative inline-flex h-10 items-center rounded-control p-[2px] ${focusRing}`}
              style={{ background: MULTI_COLOR_GRAD }}
              aria-label="Ask AI help (Control Slash)"
              title="Ask AI (⌘/ / Ctrl+/)"
              aria-haspopup="dialog"
              aria-expanded={askAiOpen}
            >
              <span
                className="absolute inset-0 rounded-control opacity-50 blur-[6px] transition-opacity duration-base group-hover:opacity-80"
                style={{ background: MULTI_COLOR_GRAD }}
                aria-hidden
              />
              <span className="relative inline-flex h-full items-center gap-2 rounded-[calc(var(--radius-control,0.5rem)-1px)] bg-surface-0 px-2.5 text-sm font-semibold text-primary transition-colors duration-base group-hover:bg-surface-1 sm:px-3">
                <Sparkles
                  className="h-4 w-4 shrink-0"
                  style={{
                    stroke: "url(#askAiSparkleGrad)",
                    color: "#8b5cf6",
                  }}
                  aria-hidden
                />
                <svg width="0" height="0" aria-hidden className="absolute">
                  <defs>
                    <linearGradient id="askAiSparkleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#f59e0b" />
                      <stop offset="25%" stopColor="#ef4444" />
                      <stop offset="50%" stopColor="#ec4899" />
                      <stop offset="75%" stopColor="#8b5cf6" />
                      <stop offset="100%" stopColor="#06b6d4" />
                    </linearGradient>
                  </defs>
                </svg>
                <span
                  className="hidden bg-clip-text text-transparent 2xl:inline"
                  style={{ backgroundImage: MULTI_COLOR_GRAD }}
                >
                  Ask AI
                </span>
              </span>
            </button>

            <ThemePicker />

            <AccountMenu canCrm={canCrm} roles={roles} />
          </div>
        </div>

        <AnimatePresence>
          {mobileOpen && navItems.length > 0 && (
            <motion.nav
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: reduceMotion ? 0 : 0.25, ease: [0.2, 0, 0, 1] }}
              className="absolute inset-x-0 top-full border-b border-t border-subtle bg-surface-1 shadow-overlay md:hidden"
              aria-label="Platform sections"
            >
              <div className="grid grid-cols-2 gap-2 px-4 py-3">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.active(view);
                  return (
                    <button
                      key={item.target}
                      type="button"
                      onClick={() => {
                        onNavigate(item.target);
                        setMobileOpen(false);
                      }}
                      className={`flex min-h-[44px] items-center gap-2 rounded-control px-3 py-2.5 text-sm font-semibold transition-colors duration-base ease-smooth ${focusRing} ${
                        isActive
                          ? "border border-subtle bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200"
                          : "text-[var(--kx-text-muted)] hover:bg-surface-2"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </header>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={commandItems} />
      <AskAiPanel open={askAiOpen} onClose={() => setAskAiOpen(false)} />
    </>
  );
}
