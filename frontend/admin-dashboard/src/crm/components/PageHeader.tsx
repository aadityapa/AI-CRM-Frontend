/** One page header for every CRM list / workspace (29 Sep 2026, user ask:
 *  "redesign every tab … just change the UI").
 *
 *  A gradient band carrying the page's icon, title, one line of context, a few
 *  headline figures and the page's main actions, with an optional white body
 *  underneath for tabs or filters. Presentation only — every page keeps its own
 *  data, buttons and handlers and simply renders them inside this frame.
 *
 *  Buttons placed in `actions` sit on the gradient: use `HERO_BTN` (glass) or
 *  `HERO_BTN_SOLID` (white) so they stay readable in light and dark themes.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { focusRing } from "./ui";

export type HeroStat = {
  label: string;
  value: ReactNode;
  /** Optional hint shown as the chip's tooltip. */
  title?: string;
};

/** Named gradients, so pages pick a mood rather than hand-writing classes. */
export const HERO_ACCENTS = {
  brand: "from-brand-700 via-indigo-700 to-violet-700",
  ocean: "from-sky-700 via-brand-700 to-indigo-800",
  teal: "from-teal-700 via-emerald-700 to-cyan-800",
  violet: "from-violet-700 via-purple-700 to-fuchsia-700",
  amber: "from-amber-600 via-orange-600 to-rose-600",
  slate: "from-slate-700 via-slate-800 to-brand-800",
  rose: "from-rose-600 via-pink-600 to-fuchsia-700",
} as const;
export type HeroAccent = keyof typeof HERO_ACCENTS;

/** Glass button for the gradient band. */
export const HERO_BTN =
  "inline-flex items-center gap-1.5 rounded-control bg-white/15 px-3 py-2 text-sm font-semibold text-white "
  + "ring-1 ring-inset ring-white/25 transition-colors hover:bg-white/25 focus-visible:outline-none "
  + "focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50";
/** Solid white button for the ONE primary action on the band. Literal hex on
 *  purpose: the dark theme remaps `bg-white` / `brand-*`, which turned it navy. */
export const HERO_BTN_SOLID =
  "inline-flex items-center gap-1.5 rounded-control bg-[#ffffff] px-3 py-2 text-sm font-bold text-[#1d4ed8] "
  + "shadow-raised transition-colors hover:bg-[#eff6ff] focus-visible:outline-none focus-visible:ring-2 "
  + "focus-visible:ring-white disabled:opacity-50";

/** Dot colour per stage key on `StagePills` (the Opportunities / position lists). */
export const STAGE_PILL_DOT: Record<string, string> = {
  "ta-active": "bg-emerald-500", "ta-customer-hold": "bg-amber-500", "ta-sales-hold": "bg-orange-500",
  "ta-closed": "bg-slate-500", "ta-rejected": "bg-rose-500", "ta-archived": "bg-slate-400", "ta-all": "bg-brand-500",
  draft: "bg-slate-400", pending: "bg-amber-500", rejected: "bg-rose-500", active: "bg-emerald-500",
  closed: "bg-slate-500", approval: "bg-violet-500", engineering: "bg-indigo-500", all: "bg-brand-500",
  Active: "bg-emerald-500", Pending: "bg-amber-500", On_Hold: "bg-amber-500", Sales_Hold: "bg-orange-500",
  Closed: "bg-slate-500", Rejected: "bg-rose-500", Archived: "bg-slate-400",
  Projects: "bg-sky-500", ProjectEmployees: "bg-teal-500",
  Inactive: "bg-slate-400", "": "bg-brand-500",
};

/** The pill strip of list tabs inside a `PageHeader` (ONE look on every role's
 *  Opportunities list, 1 Oct 2026). Only the open tab's total is known. */
export function StagePills({ tabs, active, onChange, activeCount, label = "Opportunity stages" }: {
  tabs: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
  activeCount?: number;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={label}>
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors ${focusRing} ${
              on
                ? "bg-brand-600 text-white ring-brand-600 shadow-raised"
                : "bg-surface-2 text-secondary ring-subtle hover:text-primary"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-white" : STAGE_PILL_DOT[t.key] || "bg-slate-400"}`} aria-hidden />
            {t.label}
            {on && activeCount !== undefined && (
              <span className="rounded-full bg-white/25 px-1.5 text-[11px] tabular-nums">{activeCount}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  eyebrow,
  accent = "brand",
  stats,
  actions,
  children,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Small caps line above the title (e.g. the role or the record id). */
  eyebrow?: ReactNode;
  accent?: HeroAccent;
  stats?: HeroStat[];
  actions?: ReactNode;
  /** Rendered in the white body under the band (tabs, filters…). */
  children?: ReactNode;
}) {
  return (
    <header className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
      <div className={`relative bg-gradient-to-r ${HERO_ACCENTS[accent]} px-4 py-4 text-white sm:px-5`}>
        {/* soft light in the corner — decorative only */}
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {Icon && (
              <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-white/15 ring-1 ring-inset ring-white/25">
                <Icon size={20} aria-hidden />
              </span>
            )}
            <div className="min-w-0">
              {eyebrow && (
                <div className="text-[11px] font-bold uppercase tracking-wider text-white/75">{eyebrow}</div>
              )}
              <h1 className="text-display truncate text-xl font-bold leading-tight">{title}</h1>
              {subtitle && <p className="mt-1 max-w-3xl text-sm text-white/85">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {stats && stats.length > 0 && (
          <div className="relative mt-3 flex flex-wrap gap-2">
            {stats.map((s) => (
              <span key={s.label} title={s.title}
                className="inline-flex items-baseline gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs ring-1 ring-inset ring-white/20">
                <span className="text-sm font-bold tabular-nums">{s.value}</span>
                <span className="text-white/80">{s.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      {children && <div className="px-4 py-3 sm:px-5">{children}</div>}
    </header>
  );
}
