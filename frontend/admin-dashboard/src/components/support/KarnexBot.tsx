/**
 * Karnex Support Agent — the floating Help & Support bot (16 Sep 2026).
 *
 * Replaces the pill-shaped "Help & Support" button. A round robot avatar that
 *   • floats (gentle bob + glow, reduced-motion aware),
 *   • greets on hover ("Hi! I'm your Karnex Support Agent …") with a speech bubble on the free side,
 *   • can be DRAGGED anywhere and snaps to the nearest screen edge; the docked
 *     position is remembered per browser (localStorage), and
 *   • tells the parent which side it lives on so the chat panel opens next to it.
 *
 * A drag and a click are told apart by distance (DRAG_THRESHOLD_PX): a press
 * that moves less than that is a click and opens the panel.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import "./karnex-bot.css";

export type BotSide = "left" | "right";
export type BotDock = { side: BotSide; /** distance from the bottom edge, px */ bottom: number };

const STORAGE_KEY = "support.bot.dock";
const DRAG_THRESHOLD_PX = 6;
const EDGE_MARGIN_PX = 20;
const BOT_SIZE_PX = 64;
const DEFAULT_DOCK: BotDock = { side: "right", bottom: 24 };

/** Change here and the greeting, header and aria labels follow. */
export const BOT_NAME = "Karnex Support Agent";
export const BOT_TAGLINE = "Ask me anything about hiring, CRM or your account";

function readDock(): BotDock {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DOCK;
    const parsed = JSON.parse(raw) as Partial<BotDock>;
    const side: BotSide = parsed.side === "left" ? "left" : "right";
    const bottom = Number(parsed.bottom);
    return { side, bottom: Number.isFinite(bottom) ? clampBottom(bottom) : DEFAULT_DOCK.bottom };
  } catch {
    return DEFAULT_DOCK;
  }
}

function writeDock(dock: BotDock) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(dock)); } catch { /* private mode */ }
}

function clampBottom(bottom: number): number {
  const max = Math.max(EDGE_MARGIN_PX, window.innerHeight - BOT_SIZE_PX - EDGE_MARGIN_PX);
  return Math.min(max, Math.max(EDGE_MARGIN_PX, Math.round(bottom)));
}

type Props = {
  open: boolean;
  openCount: number;
  onToggle: () => void;
  onDockChange: (dock: BotDock) => void;
  triggerRef: RefObject<HTMLButtonElement>;
};

export function KarnexBot({ open, openCount, onToggle, onDockChange, triggerRef }: Props) {
  const [dock, setDock] = useState<BotDock>(readDock);
  /** Live pointer position while dragging (viewport px of the bot's top-left). */
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState(false);
  const pressRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number; moved: boolean } | null>(null);

  useEffect(() => { onDockChange(dock); }, [dock, onDockChange]);

  // Keep the bot on screen when the window shrinks.
  useEffect(() => {
    const onResize = () => setDock((d) => ({ ...d, bottom: clampBottom(d.bottom) }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    pressRef.current = { x: e.clientX, y: e.clientY, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    const press = pressRef.current;
    if (!press) return;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (!press.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    press.moved = true;
    setHover(false);
    setDragPos({
      x: Math.min(window.innerWidth - BOT_SIZE_PX, Math.max(0, e.clientX - press.offsetX)),
      y: Math.min(window.innerHeight - BOT_SIZE_PX, Math.max(0, e.clientY - press.offsetY)),
    });
  }, []);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    const press = pressRef.current;
    pressRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (!press) return;
    if (!press.moved) {
      setDragPos(null);
      onToggle();
      return;
    }
    // Snap to the nearest horizontal edge; keep the vertical position.
    const x = e.clientX - press.offsetX;
    const y = e.clientY - press.offsetY;
    const side: BotSide = x + BOT_SIZE_PX / 2 < window.innerWidth / 2 ? "left" : "right";
    const next = { side, bottom: clampBottom(window.innerHeight - y - BOT_SIZE_PX) };
    setDragPos(null);
    setDock(next);
    writeDock(next);
  }, [onToggle]);

  const dragging = dragPos !== null;
  const style: CSSProperties = dragging
    ? { left: dragPos!.x, top: dragPos!.y, right: "auto", bottom: "auto", transition: "none" }
    : dock.side === "right"
      ? { right: EDGE_MARGIN_PX, bottom: dock.bottom }
      : { left: EDGE_MARGIN_PX, bottom: dock.bottom };

  const bubbleSide: BotSide = dock.side === "right" ? "left" : "right";
  const showBubble = hover && !open && !dragging;

  return (
    <div
      className={`kx-bot-root${dragging ? " kx-bot-root--dragging" : ""}`}
      style={style}
      data-side={dock.side}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className={`kx-bot-bubble kx-bot-bubble--${bubbleSide}${showBubble ? " kx-bot-bubble--show" : ""}`} role="status" aria-hidden={!showBubble}>
        <div className="kx-bot-bubble-title"><span aria-hidden>👋</span> Hi! I&apos;m your {BOT_NAME}</div>
        <div className="kx-bot-bubble-sub">{BOT_TAGLINE}</div>
      </div>

      <button
        ref={triggerRef}
        type="button"
        className={`kx-bot-bot${open ? " kx-bot-bot--open" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { pressRef.current = null; setDragPos(null); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        aria-expanded={open}
        aria-controls="support-widget-panel"
        aria-label={`${BOT_NAME}. Drag to move.`}
      >
        <span className="kx-bot-halo" aria-hidden />
        <AgentFace />
        {openCount > 0 && (
          <span className="kx-bot-badge" aria-label={`${openCount} open tickets`}>{openCount}</span>
        )}
      </button>
    </div>
  );
}

/** Original robot avatar, drawn inline so it themes with CSS variables. */
function AgentFace() {
  return (
    <svg className="kx-bot-face" viewBox="0 0 64 64" width="44" height="44" aria-hidden>
      <defs>
        <linearGradient id="kxBotHead" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f8fbff" />
          <stop offset="1" stopColor="#dbe7ff" />
        </linearGradient>
        <linearGradient id="kxBotVisor" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1e3a8a" />
          <stop offset="1" stopColor="#0f172a" />
        </linearGradient>
      </defs>
      {/* antenna */}
      <line x1="32" y1="6" x2="32" y2="13" stroke="#dbe7ff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="5" r="3.2" fill="#22d3ee" className="kx-bot-antenna" />
      {/* ears */}
      <rect x="6" y="26" width="6" height="14" rx="3" fill="#dbe7ff" />
      <rect x="52" y="26" width="6" height="14" rx="3" fill="#dbe7ff" />
      {/* head */}
      <rect x="12" y="14" width="40" height="38" rx="14" fill="url(#kxBotHead)" />
      {/* visor */}
      <rect x="18" y="23" width="28" height="18" rx="9" fill="url(#kxBotVisor)" />
      {/* eyes */}
      <g className="kx-bot-eyes">
        <rect x="24" y="29" width="6" height="6" rx="2" fill="#67e8f9" />
        <rect x="34" y="29" width="6" height="6" rx="2" fill="#67e8f9" />
      </g>
      {/* smile */}
      <path d="M26 45 q6 4 12 0" fill="none" stroke="#3b82f6" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
