/**
 * The Opportunities list row, redesigned (24 Oct 2026, user ask: "redesign the
 * page, more focus on the Actions tab; Assign TA & HM only for RMG / GM, the
 * rest just see it").
 *
 * - `TeamCell` — the "Sourcing team" column: TA and Hiring Manager as avatars.
 *   Whoever may assign (`requirement.team.assign`, RMG / GM by default) clicks a
 *   group or the "+" slot to open the SAME dialog as before (`useAssignTeam`);
 *   everyone else sees the avatars read-only and a dash for nobody.
 * - `FilledCell` — "2 of 5 filled" with a bar and the open count.
 * - `OppRowActions` — ONE main button per row (RMG approve · Assign TAs · Apply),
 *   Edit, and a ⋯ menu holding the rest; Delete is at the bottom of the menu.
 *
 * Nothing here decides a right on its own: the list page passes the same flags
 * it used before, and every write still goes through the endpoint it always did.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import {
  ExternalLink, MoreHorizontal, Pencil, Plus, Trash2, UserCheck, UserPlus, Users, UsersRound,
} from "lucide-react";

import { crmDelete } from "../api";
import { ConfirmModal, focusRing } from "./ui";
import { useAssignTeam, type TaAssignment } from "./PositionTeamPanel";

type ToastFn = (msg: string, kind?: "ok" | "err") => void;

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

const TA_TONES = [
  "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200",
  "bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
  "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-200",
];
const HM_TONE = "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200";

/** The members of one team as overlapping avatars (max 3 + "+N"). */
function AvatarStack({ people, hm }: { people: TaAssignment[]; hm?: boolean }) {
  const shown = people.slice(0, 3);
  const more = people.length - shown.length;
  return (
    <span className="flex items-center">
      {shown.map((p, i) => (
        <span key={p.id ?? p.user_id}
          className={`-ml-1 grid h-7 w-7 place-items-center rounded-full text-[10px] font-bold ring-2 ring-surface-1 first:ml-0 ${hm ? HM_TONE : TA_TONES[i % TA_TONES.length]}`}>
          {initials(p.name)}
        </span>
      ))}
      {more > 0 && (
        <span className="-ml-1 grid h-7 w-7 place-items-center rounded-full bg-surface-2 text-[10px] font-bold text-secondary ring-2 ring-surface-1">
          +{more}
        </span>
      )}
    </span>
  );
}

function memberTitle(word: string, people: TaAssignment[]) {
  if (!people.length) return `No ${word} assigned`;
  return `${word}: ${people.map((p) => p.name).join(", ")}`;
}

/** One role group (TA or HM) inside the team cell. */
function TeamGroup({ kind, people, canAssign, onAssign, busy }: {
  kind: "ta" | "hm";
  people: TaAssignment[];
  canAssign: boolean;
  onAssign: (e: React.SyntheticEvent) => void;
  busy: boolean;
}) {
  const word = kind === "hm" ? "Hiring Manager" : "TA";
  const label = kind === "hm" ? "HM" : "TA";
  const empty = people.length === 0;
  const body = empty
    ? (canAssign
      ? <span className="grid h-7 w-7 place-items-center rounded-full border-[1.5px] border-dashed border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          <Plus size={13} aria-hidden />
        </span>
      : <span className="grid h-7 items-center text-sm text-muted">—</span>)
    : <AvatarStack people={people} hm={kind === "hm"} />;
  const head = <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-muted">{label}</span>;
  if (!canAssign) {
    return <span className="block" title={memberTitle(word, people)}>{head}{body}</span>;
  }
  return (
    <button type="button" disabled={busy} onClick={onAssign}
      className={`block rounded-control px-1 py-0.5 text-left transition hover:bg-surface-2 disabled:opacity-60 ${focusRing}`}
      title={`${memberTitle(word, people)} — click to ${empty ? "assign" : "change"}`}
      aria-label={`${empty ? "Assign" : "Change"} ${word}${empty ? "" : "s"}`}>
      {head}{body}
    </button>
  );
}

/** "Sourcing team" column: TAs + Hiring Managers. Only a team assigner gets buttons. */
export function TeamCell({ requirementId, label, tas, hms, canAssign, onTas, onHms, toast }: {
  requirementId?: number | null;
  label: string;
  tas?: TaAssignment[] | null;
  hms?: TaAssignment[] | null;
  canAssign: boolean;
  onTas: (rows: TaAssignment[]) => void;
  onHms: (rows: TaAssignment[]) => void;
  toast: ToastFn;
}) {
  const ta = useAssignTeam({ requirementId, label, kind: "ta", onChanged: onTas, toast });
  const hm = useAssignTeam({ requirementId, label, kind: "hm", onChanged: onHms, toast });
  if (requirementId == null) {
    return <span className="text-xs text-muted" title="The position is created when the Sales Head approves the deal">After approval</span>;
  }
  const may = canAssign;
  return (
    <span className="flex items-start gap-2" onClick={(e) => e.stopPropagation()}>
      <TeamGroup kind="ta" people={tas || []} canAssign={may} onAssign={(e) => void ta.start(e)} busy={ta.busy} />
      <TeamGroup kind="hm" people={hms || []} canAssign={may} onAssign={(e) => void hm.start(e)} busy={hm.busy} />
      {ta.modal}
      {hm.modal}
    </span>
  );
}

/** "2 of 5 filled" + a bar; open count under it; the pending-change flag stays. */
export function FilledCell({ total, joined, open, changePending }: {
  total?: number | null;
  joined?: number | null;
  open?: number | null;
  changePending?: boolean | null;
}) {
  if (total === null || total === undefined) return <span className="text-muted">—</span>;
  const t = Number(total) || 0;
  const o = Number(open ?? 0);
  const j = joined != null ? Number(joined) : Math.max(0, t - o);
  const pct = t > 0 ? Math.min(100, Math.round((j / t) * 100)) : 0;
  return (
    <div className="min-w-[6.5rem] tabular-nums" title={`${j} filled, ${o} open of ${t}`}>
      <div className="flex items-baseline gap-1 whitespace-nowrap text-sm">
        <span className={`font-bold ${o === 0 && t > 0 ? "text-success" : "text-primary"}`}>{j}</span>
        <span className="text-muted">of {t} filled</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${o === 0 && t > 0 ? "bg-emerald-500" : "bg-brand-600"}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1 whitespace-nowrap"><UsersRound size={11} aria-hidden /> {o} open</span>
        {changePending && (
          <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                title="A position change is waiting for RMG approval">Change</span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ ⋯ menu */

export type RowMenuItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
  danger?: boolean;
  section?: string;
  disabled?: boolean;
  onSelect: () => void;
};

const MENU_W = 300;

/** The ⋯ button + its menu. The menu is portalled to <body> with fixed
 *  coordinates so the table's overflow never clips it; it closes on Esc, an
 *  outside click or resize (it follows a scroll), and returns focus to the button. */
export function RowMenu({ items, label }: { items: RowMenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean }>({ top: 0, left: 0, up: false });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const estH = 44 + items.length * 38;
    const up = r.bottom + estH > window.innerHeight - 8 && r.top > estH;
    setPos({
      top: up ? r.top - 6 : r.bottom + 6,
      left: Math.max(8, Math.min(window.innerWidth - MENU_W - 8, r.right - MENU_W)),
      up,
    });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close(); btnRef.current?.focus(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const btns = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") || []);
        if (!btns.length) return;
        e.preventDefault();
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === "ArrowDown" ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
        btns[next]?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    const follow = () => place();
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", close);
    window.setTimeout(() => menuRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!items.length) return null;
  let lastSection: string | undefined;
  return (
    <>
      <button ref={btnRef} type="button"
        className={`inline-flex h-8 w-8 items-center justify-center rounded-control border transition ${open
          ? "border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200"
          : "border-subtle bg-surface-1 text-secondary hover:bg-surface-2 hover:text-primary"} ${focusRing}`}
        aria-haspopup="menu" aria-expanded={open} aria-label={`More actions for ${label}`} title="More actions"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
        <MoreHorizontal size={16} aria-hidden />
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" tabIndex={-1} aria-label={`Actions for ${label}`}
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: pos.left, width: MENU_W, zIndex: 60,
            ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
          className="rounded-card border border-subtle bg-surface-1 p-1.5 shadow-overlay">
          {items.map((it) => {
            const Icon = it.icon;
            const sectionHead = it.section && it.section !== lastSection ? it.section : null;
            const divider = it.danger && lastSection !== "__danger";
            lastSection = it.danger ? "__danger" : it.section;
            return (
              <React.Fragment key={it.key}>
                {divider && <div className="my-1 border-t border-subtle" />}
                {sectionHead && !it.danger && (
                  <div className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted">{sectionHead}</div>
                )}
                <button type="button" role="menuitem" disabled={it.disabled}
                  className={`flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${focusRing} ${it.danger
                    ? "text-rose-700 hover:bg-rose-50 focus:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40 dark:focus:bg-rose-950/40"
                    : "text-primary hover:bg-surface-2 focus:bg-surface-2"}`}
                  onClick={() => { setOpen(false); it.onSelect(); }}>
                  <Icon size={16} className={it.danger ? "text-rose-600 dark:text-rose-400" : "text-secondary"} />
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="max-w-[7rem] truncate text-[11px] text-muted">{it.hint}</span>}
                </button>
              </React.Fragment>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

/* ------------------------------------------------------------------ actions cell */

const MAIN_BTN = `inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-control px-3 text-xs font-bold text-[#fff] shadow-sm transition hover:brightness-110 disabled:opacity-60 ${focusRing}`;
const ICON_BTN = `inline-flex h-8 w-8 items-center justify-center rounded-control border border-subtle bg-surface-1 text-secondary transition hover:bg-surface-2 hover:text-primary ${focusRing}`;

const names = (people?: TaAssignment[] | null) => {
  const list = (people || []).map((p) => p.name);
  if (!list.length) return undefined;
  return list.length > 1 ? `${list[0]} +${list.length - 1}` : list[0];
};

/** Actions for one opportunity row. Each control appears only with its right,
 *  exactly the flags the list used before. */
export function OppRowActions({
  id, label, title, requirementId, tas, hms, openPath,
  canAssignTeam, canApply, canWrite, approveSlot,
  onApply, onEdit, onTas, onHms, onDeleted, toast,
}: {
  id: number;
  /** "C-2026-00071" — for dialog headers and aria labels. */
  label: string;
  title: string;
  requirementId?: number | null;
  tas?: TaAssignment[] | null;
  hms?: TaAssignment[] | null;
  /** CRM path "Open in new tab" opens — default `opportunities/{id}`. */
  openPath?: string;
  canAssignTeam: boolean;
  canApply: boolean;
  canWrite: boolean;
  /** The RMG approve / reject pair when this position awaits RMG (rendered as the main slot). */
  approveSlot?: React.ReactNode;
  onApply: () => void;
  onEdit?: () => void;
  onTas: (rows: TaAssignment[]) => void;
  onHms: (rows: TaAssignment[]) => void;
  onDeleted: () => void;
  toast: ToastFn;
}) {
  const ta = useAssignTeam({ requirementId, label, kind: "ta", onChanged: onTas, toast });
  const hm = useAssignTeam({ requirementId, label, kind: "hm", onChanged: onHms, toast });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const teamOk = canAssignTeam && requirementId != null;
  const needsTas = teamOk && !(tas?.length);

  /* The one main button: approval waits first, then a missing team (only for
     whoever can fix it), then Apply. */
  let main: React.ReactNode = null;
  let mainIsApply = false;
  if (approveSlot) {
    main = approveSlot;
  } else if (needsTas) {
    main = (
      <button type="button" disabled={ta.busy} onClick={(e) => void ta.start(e)}
        className={MAIN_BTN} style={{ backgroundColor: "#7c3aed" }}
        title="Assign one or more TAs to source this position">
        <UserPlus size={14} aria-hidden /> Assign TAs
      </button>
    );
  } else if (canApply) {
    mainIsApply = true;
    main = (
      <button type="button" onClick={(e) => { e.stopPropagation(); onApply(); }}
        className={MAIN_BTN} style={{ backgroundColor: "#2563eb" }}
        title="Apply a candidate to this opportunity" aria-label={`Apply a candidate to ${title}`}>
        <UserPlus size={14} aria-hidden /> Apply
      </button>
    );
  }

  const items: RowMenuItem[] = [];
  if (teamOk) {
    items.push({ key: "ta", section: "Team", icon: Users, label: tas?.length ? "Change TAs" : "Assign TAs",
      hint: names(tas) || "None yet", onSelect: () => void ta.start() });
    items.push({ key: "hm", section: "Team", icon: UserCheck,
      label: hms?.length ? "Change Hiring Manager" : "Assign Hiring Manager",
      hint: names(hms) || "None yet", onSelect: () => void hm.start() });
  }
  if (canApply && !mainIsApply) {
    items.push({ key: "apply", section: "Position", icon: UserPlus, label: "Apply a candidate", onSelect: onApply });
  }
  items.push({ key: "open", section: "Position", icon: ExternalLink, label: "Open in new tab",
    onSelect: () => {
      const u = new URL(window.location.href);
      u.searchParams.set("view", "crm");
      u.searchParams.set("p", openPath || `opportunities/${id}`);
      window.open(u.toString(), "_blank", "noopener");
    } });
  if (canWrite && onEdit) {
    items.push({ key: "delete", danger: true, icon: Trash2, label: "Delete opportunity",
      onSelect: () => { setDeleteError(null); setConfirming(true); } });
  }

  const doDelete = async () => {
    setBusy(true);
    setDeleteError(null);
    try {
      const res = await crmDelete(`/api/opportunities/${id}`);
      toast(res.message || "Opportunity deleted");
      setConfirming(false);
      onDeleted();
    } catch (e: any) {
      const msg = e?.message || "Failed to delete opportunity";
      setDeleteError(msg);
      toast(msg, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}>
      {main}
      {canWrite && onEdit && (
        <button type="button" className={ICON_BTN} title="Edit opportunity" aria-label={`Edit ${title}`}
          onClick={(e) => { e.stopPropagation(); onEdit(); }}>
          <Pencil size={15} aria-hidden />
        </button>
      )}
      <RowMenu items={items} label={label || title} />
      {ta.modal}
      {hm.modal}
      {confirming && (
        <ConfirmModal
          title="Delete an opportunity?"
          message={<>Do you want to delete this opportunity (<b>{title}</b>)? This cannot be undone.</>}
          confirmLabel="Delete"
          danger
          busy={busy}
          error={deleteError}
          onConfirm={() => { void doDelete(); }}
          onClose={() => { if (!busy) { setConfirming(false); setDeleteError(null); } }}
        />
      )}
    </span>
  );
}
