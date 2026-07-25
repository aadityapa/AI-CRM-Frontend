/** Platform product top bar (NOT the CRM left sidebar).
 * Sticky glass header: section tabs (+ More overflow), Interview Schedule CTA,
 * search/⌘K, and a single account dropdown. */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  CalendarClock,
  ChevronDown,
  Menu,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
import { KarnexBranding } from "../KarnexBranding";
import { AccountMenu } from "./AccountMenu";
import { CommandPalette, type CommandItem } from "./CommandPalette";
import { CRM_NAV } from "../../crm/nav";
import { crmNavigate } from "../../crm/routerHooks";
import { crmTabKey, isSuperAdmin, tabVisible } from "../../lib/rbac";

const focusRing = "focus-visible:outline-none focus-visible:shadow-focus-ring";

export type PlatformNavItem = {
  target: string;
  label: string;
  icon: LucideIcon;
  active: (view: string) => boolean;
};

type NavMotion = Partial<Pick<HTMLMotionProps<"button">, "whileHover" | "whileTap" | "transition">>;

const MORE_BTN_MIN = 72;
const GAP_PX = 4;

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

function useIsMdUp(): boolean {
  const [md, setMd] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : true,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => setMd(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return md;
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
  const mdUp = useIsMdUp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(navItems.length);

  const trackRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreRootRef = useRef<HTMLDivElement>(null);

  /* ---- overflow measurement (desktop track) ---- */
  const remeasure = useCallback(() => {
    const track = trackRef.current;
    const measure = measureRef.current;
    if (!track || !measure || !mdUp) {
      setVisibleCount(navItems.length);
      return;
    }
    const available = track.clientWidth;
    const kids = Array.from(measure.children) as HTMLElement[];
    if (!kids.length) {
      setVisibleCount(0);
      return;
    }
    const widths = kids.map((el) => el.getBoundingClientRect().width);
    const total = widths.reduce((a, b) => a + b, 0) + GAP_PX * Math.max(0, widths.length - 1);
    if (total <= available) {
      setVisibleCount(navItems.length);
      return;
    }
    let used = 0;
    let count = 0;
    for (let i = 0; i < widths.length; i++) {
      const itemW = widths[i];
      const gap = count > 0 ? GAP_PX : 0;
      const restAfter = widths.length - (i + 1);
      const needMore = restAfter > 0;
      const moreCost = needMore ? GAP_PX + MORE_BTN_MIN : 0;
      if (used + gap + itemW + moreCost > available) break;
      used += gap + itemW;
      count += 1;
    }
    setVisibleCount(Math.max(0, count));
  }, [navItems.length, mdUp]);

  useLayoutEffect(() => {
    remeasure();
  }, [remeasure, navItems]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => remeasure());
    ro.observe(track);
    return () => ro.disconnect();
  }, [remeasure]);

  useEffect(() => {
    setMobileOpen(false);
    setMoreOpen(false);
  }, [view]);

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (moreRootRef.current && !moreRootRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  /* ---- ⌘K / Ctrl+K ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const inlineItems = mdUp ? navItems.slice(0, visibleCount) : [];
  const overflowItems = mdUp ? navItems.slice(visibleCount) : navItems;
  const overflowActive = overflowItems.some((item) => item.active(view));

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
    return out;
  }, [navItems, canCrm, roles, tabAccess, rbacActive, canSchedule, onNavigate, onSchedule]);

  const renderTab = (item: PlatformNavItem, opts?: { inMenu?: boolean; onPick?: () => void }) => {
    const Icon = item.icon;
    const isActive = item.active(view);
    const inMenu = opts?.inMenu;
    if (inMenu) {
      return (
        <button
          key={item.target}
          type="button"
          role="menuitem"
          onClick={() => {
            onNavigate(item.target);
            opts?.onPick?.();
          }}
          className={`flex w-full items-center gap-2 rounded-control px-3 py-2.5 text-sm font-semibold transition-colors duration-base ease-smooth ${focusRing} ${
            isActive
              ? "bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200"
              : "text-[var(--kx-text-muted)] hover:bg-surface-1 hover:text-[var(--kx-text)]"
          }`}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {item.label}
        </button>
      );
    }
    return (
      <motion.button
        key={item.target}
        type="button"
        {...navMotion}
        onClick={() => onNavigate(item.target)}
        aria-current={isActive ? "page" : undefined}
        className={`group relative flex items-center gap-2 rounded-control px-3 py-2 text-sm font-semibold transition-colors duration-base ease-smooth lg:px-4 ${focusRing} ${
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
          className={`relative h-4 w-4 transition-transform duration-base ease-smooth group-hover:scale-110 ${
            isActive ? "text-brand-600 dark:text-brand-300" : ""
          }`}
        />
        <span className="relative hidden lg:inline">{item.label}</span>
      </motion.button>
    );
  };

  return (
    <>
      <header
        className={`glass fx-hairline-b sticky top-0 z-40 rounded-none border-x-0 border-t-0 transition-[box-shadow,background-color] duration-base ease-smooth ${
          scrolled ? "shadow-overlay !backdrop-blur-md" : ""
        }`}
      >
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex shrink-0 items-center gap-2">
            <KarnexBranding size="sm" />
          </div>

          {navItems.length > 0 && (
            <div className="hidden min-w-0 flex-1 md:block">
              {/* Measurement row (invisible) — full labels so overflow matches lg layout */}
              <div
                ref={measureRef}
                aria-hidden
                className="pointer-events-none absolute -left-[9999px] top-0 flex items-center gap-1 opacity-0"
              >
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <span
                      key={item.target}
                      className="inline-flex items-center gap-2 whitespace-nowrap rounded-control px-3 py-2 text-sm font-semibold lg:px-4"
                    >
                      <Icon className="h-4 w-4" />
                      <span className="hidden lg:inline">{item.label}</span>
                    </span>
                  );
                })}
              </div>

              <nav
                ref={trackRef}
                className="flex min-w-0 items-center gap-1 overflow-hidden rounded-modal border border-subtle bg-surface-0 p-1 shadow-[var(--recess-shadow)]"
                aria-label="Platform sections"
              >
                {inlineItems.map((item) => renderTab(item))}

                {overflowItems.length > 0 && (
                  <div ref={moreRootRef} className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => setMoreOpen((o) => !o)}
                      aria-haspopup="menu"
                      aria-expanded={moreOpen}
                      aria-label="More sections"
                      title="More sections"
                      className={`relative inline-flex items-center gap-1.5 rounded-control px-3 py-2 text-sm font-semibold transition-colors duration-base ease-smooth ${focusRing} ${
                        overflowActive || moreOpen
                          ? "text-brand-700 dark:text-brand-200"
                          : "text-[var(--kx-text-muted)] hover:bg-surface-1 hover:text-[var(--kx-text)]"
                      }`}
                    >
                      {overflowActive && (
                        <span
                          aria-hidden
                          className="sheen absolute inset-0 rounded-control border border-subtle bg-brand-100 shadow-e1 dark:bg-brand-900"
                        />
                      )}
                      <MoreHorizontal className="relative h-4 w-4" />
                      <span className="relative hidden sm:inline">More</span>
                      <ChevronDown className={`relative h-3.5 w-3.5 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
                    </button>
                    <AnimatePresence>
                      {moreOpen && (
                        <motion.div
                          role="menu"
                          aria-label="More sections"
                          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                          transition={{ duration: reduceMotion ? 0 : 0.15 }}
                          className="elev-2 absolute left-0 z-50 mt-2 min-w-[12rem] overflow-hidden rounded-panel p-1"
                        >
                          {overflowItems.map((item) =>
                            renderTab(item, { inMenu: true, onPick: () => setMoreOpen(false) }),
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </nav>
            </div>
          )}

          {/* Spacer when no center nav (CRM-only roles) */}
          {navItems.length === 0 && <div className="min-w-0 flex-1" />}

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {navItems.length > 0 && (
              <div className="mx-0.5 hidden h-6 w-px bg-[var(--border-subtle)] md:block" aria-hidden />
            )}

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
              className={`btn-depth inline-flex h-10 items-center gap-2 rounded-control px-2.5 text-[var(--kx-text-muted)] hover:bg-surface-1 hover:text-primary ${focusRing}`}
              aria-label="Search sections (Control K)"
              title="Search (⌘K / Ctrl+K)"
            >
              <Search className="h-4 w-4" />
              <kbd className="hidden rounded border border-subtle bg-surface-0 px-1.5 py-0.5 text-[10px] font-semibold text-muted lg:inline">
                ⌘K
              </kbd>
            </button>

            {canSchedule && (
              <button
                type="button"
                onClick={onSchedule}
                className={`btn-depth inline-flex h-10 items-center gap-2 rounded-control bg-brand-600 px-3 text-sm font-semibold text-white ${focusRing}`}
                title="Open HR Setup to schedule / invite a candidate for an interview"
              >
                <CalendarClock className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Interview Schedule</span>
              </button>
            )}

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
    </>
  );
}
