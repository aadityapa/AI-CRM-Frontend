/** Avatar: shows a photo when available, otherwise deterministic-color initials.
 * Reused in the sidebar user block, the Profile page, and anywhere a user shows. */
import { useState } from "react";
import { brand, neutral, semantic } from "../../design-system/tokens/tokens";

/* Deterministic initials palette sourced from the design-system token ramps
 * (brand / semantic / neutral) — no ad-hoc hex. Every entry keeps white
 * initials AA-readable (deep pigments only). */
const COLORS: readonly string[] = [
  brand[600],
  semantic.success,
  semantic.info,
  brand[800],
  semantic.warning,
  brand[500],
  semantic.danger,
  neutral[600],
  brand[900],
  neutral[700],
];

export function initialsOf(name?: string | null): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const a = parts[0][0] || "";
  const b = parts.length > 1 ? parts[parts.length - 1][0] || "" : "";
  return (a + b).toUpperCase() || "?";
}

function colorFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function Avatar({
  name,
  src,
  size = 40,
  className = "",
  title,
}: {
  name?: string | null;
  src?: string | null;
  size?: number;
  className?: string;
  title?: string;
}) {
  const [broken, setBroken] = useState(false);
  const dim = { width: size, height: size };
  const showImg = src && !broken;
  const bg = colorFor(String(name || "?"));

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-black/5 dark:ring-white/10 ${className}`}
      style={dim}
      title={title || name || undefined}
      aria-label={name || "User avatar"}
    >
      {showImg ? (
        <img
          src={src as string}
          alt={name || "avatar"}
          width={size}
          height={size}
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center font-bold text-white"
          style={{ backgroundColor: bg, fontSize: Math.max(11, Math.round(size * 0.4)) }}
          aria-hidden
        >
          {initialsOf(name)}
        </span>
      )}
    </span>
  );
}
