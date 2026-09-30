/**
 * Right-click on a list row → "Open in new tab / new window / Copy link"
 * (29 Sep 2026, user ask: "on Candidate Profiles I right-click a candidate to
 * open it in another Chrome window — give that option, and on every list, for
 * every role").
 *
 * A table row is not a link, so the browser's own menu has no "Open link in new
 * tab". Rows that know where they lead (`DataTable`'s `rowHref`,
 * `CustomerGroupedList`'s `rowHref`) get:
 *   · this menu on right-click (Shift + right-click still shows the browser's),
 *   · Ctrl / ⌘ + click and middle-click → a new tab, like a real link.
 * The URL is built with `crmUrl`, so a new tab lands exactly where a click would.
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AppWindow, ArrowUpRight, Copy, ExternalLink } from "lucide-react";

import { crmNavigate, crmUrl } from "../router";

export type RowMenuState = { x: number; y: number; path: string } | null;

/** Absolute URL for a CRM path — what a new tab / window / clipboard gets. */
export function crmAbsoluteUrl(path: string): string {
  return new URL(crmUrl(path), window.location.origin).toString();
}

export function openCrmInNewTab(path: string): void {
  window.open(crmAbsoluteUrl(path), "_blank", "noopener");
}

export function openCrmInNewWindow(path: string): void {
  const w = Math.min(1400, window.screen.availWidth - 80);
  const h = Math.min(900, window.screen.availHeight - 80);
  window.open(crmAbsoluteUrl(path), "_blank", `noopener,popup,width=${w},height=${h}`);
}

/**
 * Row handlers for a clickable row that knows its path. Returns the props to
 * spread on the row, or {} when `path` is null. `onOpen` is the row's normal
 * click (defaults to navigating in place).
 */
export function rowLinkHandlers(path: string | null | undefined, setMenu: (m: RowMenuState) => void) {
  if (!path) return {};
  return {
    onContextMenu: (e: React.MouseEvent) => {
      if (e.shiftKey) return;            // Shift + right-click = the browser's own menu
      if ((e.target as HTMLElement).closest("a,button,input,select,textarea,[role=menu]")) return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, path });
    },
    onAuxClick: (e: React.MouseEvent) => {
      if (e.button !== 1) return;
      if ((e.target as HTMLElement).closest("a,button,input,select,textarea")) return;
      e.preventDefault();
      openCrmInNewTab(path);
    },
  };
}

/** True when a click should open a new tab instead (Ctrl / ⌘ held). */
export const wantsNewTab = (e: React.MouseEvent) => e.ctrlKey || e.metaKey;

export function RowLinkMenu({ menu, onClose, onCopied }: {
  menu: RowMenuState; onClose: () => void; onCopied?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (e.type === "mousedown" && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu, onClose]);
  if (!menu) return null;

  const W = 240, H = 176;
  const left = Math.min(menu.x, window.innerWidth - W - 8);
  const top = Math.min(menu.y, window.innerHeight - H - 8);
  const run = (fn: () => void) => () => { onClose(); fn(); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(crmAbsoluteUrl(menu.path)); onCopied?.(); } catch { /* clipboard blocked */ }
  };
  const item = "flex w-full items-center gap-2.5 whitespace-nowrap rounded-control px-2.5 py-1.5 text-left text-sm text-primary hover:bg-surface-2 focus:bg-surface-2 focus:outline-none";
  return createPortal(
    <div ref={ref} role="menu" aria-label="Open options" tabIndex={-1}
      className="fixed z-[300] w-60 rounded-card border border-subtle bg-surface-1 p-1 shadow-overlay"
      style={{ left, top }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button") || []);
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }}>
      <button type="button" role="menuitem" className={item} onClick={run(() => crmNavigate(menu.path))}>
        <ArrowUpRight size={15} className="text-muted" aria-hidden /> Open
      </button>
      <button type="button" role="menuitem" className={item} onClick={run(() => openCrmInNewTab(menu.path))}>
        <ExternalLink size={15} className="text-muted" aria-hidden /> Open in new tab
        <kbd className="ml-auto text-[10px] text-muted">Ctrl+Click</kbd>
      </button>
      <button type="button" role="menuitem" className={item} onClick={run(() => openCrmInNewWindow(menu.path))}>
        <AppWindow size={15} className="text-muted" aria-hidden /> Open in new window
      </button>
      <div className="my-1 h-px bg-surface-2" />
      <button type="button" role="menuitem" className={item} onClick={run(() => void copy())}>
        <Copy size={15} className="text-muted" aria-hidden /> Copy link
      </button>
    </div>,
    document.body,
  );
}
