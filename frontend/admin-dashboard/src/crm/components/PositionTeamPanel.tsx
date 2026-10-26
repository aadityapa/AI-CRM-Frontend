/**
 * Priority + the TAs assigned to source a position (1 Oct 2026, user ask: "on
 * the opportunity page I need the priority & RMG / GM can assign a position to
 * multiple TAs").
 *
 * One card, mounted on the OPPORTUNITY page (where RMG / GM and Sales work)
 * and on the requirement page. The server says who may change it
 * (`meta.can_assign` from `GET /api/requirements/{id}/ta-assignments` — the
 * same gate as the priority PATCH), so the panel never guesses from roles:
 * a GM custom role passes through the screener gate exactly like RMG.
 */
import { useEffect, useMemo, useState } from "react";
import { Flag, UserCheck, UserPlus, Users } from "lucide-react";

import { crmGet, crmPatch, crmPut } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanApprove } from "../useAccess";
import { fmtDateShort } from "../../lib/datetime";
import { DecisionDialog, type DecisionSpec } from "./dialogKit";
import { CONTROL } from "./controlTower";
import { SkeletonText, btnSecondary, focusRing } from "./ui";

type ToastFn = (msg: string, kind?: "ok" | "err") => void;

export type TaAssignment = {
  id: number;
  user_id: number;
  name: string;
  assigned_by_name?: string | null;
  assigned_at?: string | null;
  note?: string | null;
};

/** `stale` (14 Oct 2026): someone already on the team who is no longer an
 *  active TA login — listed so they can be unticked, never offered fresh. */
export type TaOption = { id: number; name: string; stale?: boolean };

/** The picker's choices: the active TA logins plus anyone already on the team
 *  who is no longer one (deactivated / TA role removed). Without them the
 *  dialog counted a person it never showed, and the save was refused. PURE. */
export function withStaleAssignees(options: TaOption[], team: Pick<TaAssignment, "user_id" | "name">[]): TaOption[] {
  const known = new Set(options.map((o) => o.id));
  const stale = team.filter((a) => !known.has(a.user_id))
    .map((a) => ({ id: a.user_id, name: a.name || `User #${a.user_id}`, stale: true }));
  return [...options, ...stale];
}

/** The team endpoint, as every caller reads it. `options` is non-empty only for a writer. */
export type TaAssignmentsPayload = { assignments: TaAssignment[]; options: TaOption[] };

/** The two teams on a position (22 Oct 2026): the TAs who source it and the
 *  Hiring Managers who own it. Same row shape, same gate, two endpoints. */
export type TeamKind = "ta" | "hm";
const TEAM = {
  ta: { path: "ta-assignments", key: "assignments", word: "TA", plural: "TAs" },
  hm: { path: "hiring-managers", key: "hiring_managers", word: "Hiring Manager", plural: "Hiring Managers" },
} as const;

/** ONE fetch for "who is on the team, who may I pick, may I change it".
 *  `isMine` (Hiring Managers only): this login is one of them. */
export async function fetchTeam(requirementId: number, kind: TeamKind = "ta"):
  Promise<TaAssignmentsPayload & { canAssign: boolean; isMine: boolean }> {
  const t = TEAM[kind];
  const res = await crmGet<any>(`/api/requirements/${requirementId}/${t.path}`);
  return {
    assignments: res.data?.[t.key] || [],
    options: res.data?.options || [],
    canAssign: Boolean((res.meta as any)?.can_assign),
    isMine: Boolean((res.meta as any)?.is_mine),
  };
}

export function fetchTaAssignments(requirementId: number) {
  return fetchTeam(requirementId, "ta");
}

export const PRIORITIES = ["Low", "Medium", "High"] as const;

/** The priority chip — ONE colour per level, used by the requirement list,
 *  the band and this panel. */
export function PriorityPill({ p }: { p?: string | null }) {
  if (!p) return <span className="text-muted">—</span>;
  const cls =
    p === "High"
      ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
      : p === "Low"
        ? "bg-surface-2 text-secondary"
        : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{p}</span>;
}

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/** A TA on the team — avatar initials + name; the title says who assigned them and when. */
export function TaChip({ a }: { a: TaAssignment }) {
  const title = [
    a.assigned_by_name ? `Assigned by ${a.assigned_by_name}` : "Assigned",
    a.assigned_at ? `on ${fmtDateShort(a.assigned_at)}` : "",
    a.note ? `— ${a.note}` : "",
  ].filter(Boolean).join(" ");
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-subtle bg-surface-2 py-0.5 pl-0.5 pr-2.5 text-xs font-semibold text-primary" title={title}>
      <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-[10px] font-bold text-[#fff]">
        {initials(a.name)}
      </span>
      {a.name}
    </span>
  );
}

/** "HM: Neha, Ravi" under a list row's title (22 Oct 2026) — renders nothing without one. */
export function HmLine({ hms }: { hms?: TaAssignment[] | null }) {
  if (!hms?.length) return null;
  return (
    <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
         title="Hiring Manager(s) of this position">
      <UserCheck size={11} aria-hidden /> HM: {hms.map((h) => h.name).join(", ")}
    </div>
  );
}

const HM_SPEC: DecisionSpec = {
  tone: "emerald",
  icon: UserCheck,
  eyebrow: "Hiring Manager",
  title: "Assign the Hiring Manager",
  intro: "Tick the Karnex Hiring Manager(s) who own this position. They see only the positions they are on, " +
    "confirm the JD & skills before TA sources, review candidates before the customer and sign off the selection.",
  reason: {
    label: "Note for the Hiring Manager (optional)",
    required: false,
    placeholder: "e.g. Customer wants two AUTOSAR heads by month end",
    picks: ["Please confirm the JD today", "Customer interviews start next week"],
  },
  happens: [
    { icon: UserCheck, text: "Each newly assigned Hiring Manager is told (bell + email)" },
    { icon: Users, text: "A position RMG has not approved yet waits for their JD confirmation after approval" },
  ],
  confirmLabel: "Save Hiring Managers",
  busyLabel: "Saving…",
};

const ASSIGN_SPEC: DecisionSpec = {
  tone: "indigo",
  icon: UserPlus,
  eyebrow: "Sourcing team",
  title: "Assign TAs to this position",
  intro: "Tick every TA who should source this position. Each newly assigned TA is told (bell + email); " +
    "unticking removes someone from the team quietly.",
  reason: {
    label: "Note for the TAs (optional)",
    required: false,
    placeholder: "e.g. Two heads by Friday — customer interviews run Mon / Wed",
    picks: ["Urgent — customer is waiting", "Source from the existing pool first", "Share the JD before calling"],
  },
  happens: [
    { icon: Users, text: "The team shows on the opportunity for every login" },
    { icon: UserPlus, text: "Assigned TAs see the position under “Assigned to me” on their Opportunities page" },
  ],
  confirmLabel: "Save team",
  busyLabel: "Saving…",
};

/** The TA checkbox grid — the Assign dialog and the RMG approval dialog share it. */
export function TaPicker({ options, picked, onToggle, kind = "ta" }: {
  options: TaOption[];
  picked: Set<number>;
  onToggle: (id: number) => void;
  /** Whose picker — the wording only (22 Oct 2026: the Hiring Manager picker). */
  kind?: TeamKind;
}) {
  const t = TEAM[kind];
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? options.filter((o) => o.name.toLowerCase().includes(needle)) : options;
  }, [options, q]);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-bold uppercase tracking-wide text-muted">
          {t.plural} · {picked.size} picked
        </span>
        {options.length > 6 && (
          <input type="text" className={`${CONTROL} w-44`} placeholder={`Find a ${t.word}…`} value={q}
                 onChange={(e) => setQ(e.target.value)} aria-label={`Find a ${t.word}`} />
        )}
      </div>
      {options.length === 0 ? (
        <p className="rounded-card border border-dashed border-subtle px-3 py-2 text-sm text-muted">
          {kind === "hm"
            ? "No active Hiring Manager login exists yet — give someone the Hiring Manager role under Access Control ▸ Users."
            : "No active TA login exists yet — add one under Access Control ▸ Users."}
        </p>
      ) : (
        <div className="grid max-h-64 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
          {shown.map((o) => {
            const on = picked.has(o.id);
            return (
              <label key={o.id}
                className={`flex cursor-pointer items-center gap-2 rounded-card border px-2.5 py-2 text-sm transition ${on
                  ? "border-indigo-300 bg-indigo-50 text-indigo-900 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200"
                  : "border-subtle bg-surface-1 text-primary hover:bg-surface-2"}`}>
                <input type="checkbox" className="h-4 w-4" checked={on} onChange={() => onToggle(o.id)} />
                <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-2 text-[10px] font-bold text-secondary">
                  {initials(o.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{o.name}</span>
                  {o.stale && (
                    <span className="block text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                      No longer an active {t.word} — untick to remove
                    </span>
                  )}
                </span>
              </label>
            );
          })}
          {shown.length === 0 && <p className="text-sm text-muted">No {t.word} matches “{q}”.</p>}
        </div>
      )}
    </div>
  );
}

function AssignTasModal({ requirementId, label, options, current, onClose, onDone, toast, kind = "ta" }: {
  kind?: TeamKind;
  requirementId: number;
  label: string;
  options: TaOption[];
  current: TaAssignment[];
  onClose: () => void;
  onDone: (rows: TaAssignment[]) => void;
  toast: ToastFn;
}) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set(current.map((a) => a.user_id)));
  const choices = useMemo(() => withStaleAssignees(options, current), [options, current]);
  const toggle = (id: number) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <DecisionDialog
      spec={kind === "hm" ? HM_SPEC : ASSIGN_SPEC}
      person={{ name: label }}
      onClose={onClose}
      onConfirm={async (note) => {
        const t = TEAM[kind];
        const res = await crmPut<any>(
          `/api/requirements/${requirementId}/${t.path}`,
          { user_ids: Array.from(picked), note: note || null });
        toast(res.message || "Team saved");
        onDone(res.data?.[t.key] || []);
        onClose();
      }}
    >
      <TaPicker options={choices} picked={picked} onToggle={toggle} kind={kind} />
    </DecisionDialog>
  );
}

/** "Assign TAs" from a LIST row (1 Oct 2026, user ask: "no need to go inside
 *  the opportunity"). It fetches the team endpoint only when clicked — the
 *  server's `meta.can_assign` is the authority; a refusal is toasted. The
 *  caller decides whether to render it (the list already knows the role). */
/** The list-row button: a chip the size of the TA chips beside it (1 Oct 2026, user ask) —
 *  the same on every role's list. A caller that wants the full button passes `className`. */
const CHIP_BASE = `inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold shadow-sm transition hover:shadow hover:brightness-110 disabled:opacity-60 ${focusRing}`;
/** No team yet: a filled gradient chip — it is a call to action (7 Oct 2026, user ask: "make it colorful"). */
const ASSIGN_CHIP = `${CHIP_BASE} bg-gradient-to-r from-purple-500 to-indigo-600 text-[#fff]`;
/** A team exists: a filled teal → sky gradient (user ask 7 Oct 2026: "make the Change button colourful") —
 *  a different hue from Assign so the two states still read apart at a glance. */
const CHANGE_CHIP = `${CHIP_BASE} bg-gradient-to-r from-teal-500 to-sky-600 text-[#fff]`;

/** The assign flow without its button (24 Oct 2026): fetch the team when asked,
 *  refuse with a toast when the server's `meta.can_assign` says no, then render
 *  the same dialog. `AssignTasButton`, the list's team avatars and its ⋯ menu all
 *  open the dialog through this — one flow, one gate (the server's). */
export function useAssignTeam({ requirementId, label, kind = "ta", onChanged, toast }: {
  requirementId: number | null | undefined;
  label: string;
  kind?: TeamKind;
  onChanged: (rows: TaAssignment[]) => void;
  toast: ToastFn;
}) {
  const [open, setOpen] = useState<{ options: TaOption[]; current: TaAssignment[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const start = async (e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (busy || requirementId == null) return;
    setBusy(true);
    try {
      const res = await fetchTeam(requirementId, kind);
      if (!res.canAssign) { toast(`Your role cannot assign ${TEAM[kind].plural} on this position`, "err"); return; }
      setOpen({ options: res.options, current: res.assignments });
    } catch (err: any) {
      toast(err?.message || "The sourcing team could not be loaded", "err");
    } finally {
      setBusy(false);
    }
  };
  const modal = open && requirementId != null ? (
    <AssignTasModal
      kind={kind}
      requirementId={requirementId}
      label={label}
      options={open.options}
      current={open.current}
      onClose={() => setOpen(null)}
      onDone={onChanged}
      toast={toast}
    />
  ) : null;
  return { start, busy, modal };
}

export function AssignTasButton({ requirementId, label, assigned, onChanged, toast, className, kind = "ta" }: {
  /** "hm" = the Hiring Manager chip (22 Oct 2026). */
  kind?: TeamKind;
  requirementId: number;
  label: string;
  assigned?: TaAssignment[] | null;
  onChanged: (rows: TaAssignment[]) => void;
  toast: ToastFn;
  className?: string;
}) {
  const { start, busy, modal } = useAssignTeam({ requirementId, label, kind, onChanged, toast });
  const count = assigned?.length ?? 0;
  return (
    <>
      <button type="button" disabled={busy} onClick={(e) => void start(e)}
        className={className || (count ? CHANGE_CHIP : ASSIGN_CHIP)}
        title={kind === "hm"
          ? (count ? "Change the Hiring Managers of this position" : "Assign the Hiring Manager of this position")
          : (count ? "Change the TAs sourcing this position" : "Assign one or more TAs to source this position")}>
        {kind === "hm" ? <UserCheck size={11} aria-hidden /> : <UserPlus size={11} aria-hidden />}
        {count ? "Change" : kind === "hm" ? "Assign HM" : "Assign TAs"}
      </button>
      {modal}
    </>
  );
}

/** The priority pill as an inline control (1 Oct 2026, user ask: "RMG / GM
 *  change the priority from the list, no need to open the opportunity").
 *  PATCHes `/api/requirements/{id}/priority` (the screener gate admits RMG /
 *  GM / Sales Head) and hands the saved value back through `onChanged`. */
export function InlinePriority({ requirementId, value, onChanged, toast }: {
  requirementId: number;
  value?: string | null;
  onChanged?: (priority: string) => void;
  toast?: ToastFn;
}) {
  const [busy, setBusy] = useState(false);
  const p = value || "Medium";
  const cls = p === "High"
    ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
    : p === "Low" ? "bg-surface-2 text-secondary"
      : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  const set = async (next: string) => {
    if (next === p || busy) return;
    setBusy(true);
    try {
      const res = await crmPatch<any>(`/api/requirements/${requirementId}/priority`, { priority: next });
      toast?.(res.message || `Priority set to ${next}`);
      onChanged?.(next);
    } catch (e: any) {
      toast?.(e?.message || "Priority update failed", "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <select
      className={`inline-flex cursor-pointer appearance-none rounded-full border-0 px-2 py-0.5 text-xs font-semibold ${cls} ${busy ? "opacity-60" : ""}`}
      value={p} disabled={busy} aria-label="Priority" title="Change the sourcing priority"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => void set(e.target.value)}
    >
      {PRIORITIES.map((x) => <option key={x} value={x}>{x}</option>)}
    </select>
  );
}

/** Priority + sourcing team. `priority` is the requirement's current value
 *  (the caller's payload); the panel writes it back through the priority
 *  PATCH and reports the change through `onChanged`. */
export function PositionTeamPanel({ requirementId, label, priority, showPriority = true, toast, onChanged }: {
  requirementId: number;
  /** Human label — "C-2026-00071" — for the dialog title. */
  label: string;
  priority?: string | null;
  /** The requirement page already has the priority control on its band. */
  showPriority?: boolean;
  toast: ToastFn;
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<TaAssignment[]>([]);
  const [options, setOptions] = useState<TaOption[]>([]);
  const [canAssign, setCanAssign] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [assigning, setAssigning] = useState<TeamKind | null>(null);
  // The Hiring Managers of the position (22 Oct 2026) — same gate as the TA team.
  const [hms, setHms] = useState<TaAssignment[]>([]);
  const [hmOptions, setHmOptions] = useState<TaOption[]>([]);
  const [isHm, setIsHm] = useState(false);
  const [prio, setPrio] = useState(priority || "Medium");
  const [prioBusy, setPrioBusy] = useState(false);
  useEffect(() => { setPrio(priority || "Medium"); }, [priority]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([fetchTeam(requirementId, "ta"), fetchTeam(requirementId, "hm").catch(() => null)])
      .then(([ta, hm]) => {
        if (!alive) return;
        setRows(ta.assignments);
        setOptions(ta.options);
        setCanAssign(ta.canAssign);
        setHms(hm?.assignments || []);
        setHmOptions(hm?.options || []);
        setIsHm(Boolean(hm?.isMine));
        setErr("");
      })
      .catch((e: any) => { if (alive) setErr(e?.message || "The sourcing team could not be loaded"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [requirementId]);
  // Priority keeps its own rule (RMG / Sales Head / a screener / the position's
  // Hiring Manager — server `hm_or(screener_or(…))`); assigning the team is the
  // separate `requirement.team.assign` decision (23 Oct 2026).
  const prioRole = useHasRole("RMG", "Sales_Head");
  const prioScreener = useCanApprove("profile.rmg_screening");
  const canSetPriority = canAssign || isHm || prioRole || prioScreener;

  const setPriority = async (p: string) => {
    const before = prio;
    setPrio(p);
    setPrioBusy(true);
    try {
      const res = await crmPatch<any>(`/api/requirements/${requirementId}/priority`, { priority: p });
      toast(res.message || `Priority set to ${p}`);
      onChanged?.();
    } catch (e: any) {
      setPrio(before);
      toast(e?.message || "Priority update failed", "err");
    } finally {
      setPrioBusy(false);
    }
  };

  if (loading && rows.length === 0 && !err) {
    return <div className="rounded-card border border-subtle bg-surface-1 px-4 py-3"><SkeletonText lines={1} /></div>;
  }

  return (
    <div className="rounded-card border border-subtle bg-surface-1 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        {showPriority && <div className="flex items-center gap-2">
          <Flag size={14} className="text-muted" aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Priority</span>
          {canSetPriority ? (
            <select className={`${CONTROL} !h-8 !py-0 text-xs font-semibold`} value={prio} disabled={prioBusy}
                    onChange={(e) => void setPriority(e.target.value)} title="Set the sourcing priority" aria-label="Priority">
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          ) : (
            <PriorityPill p={prio} />
          )}
        </div>}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Users size={14} className="text-muted" aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Sourcing team</span>
          {err ? (
            <span className="text-xs text-muted">{err}</span>
          ) : rows.length === 0 ? (
            <span className="text-xs text-muted">No TA assigned yet{canAssign ? " — assign one or more below" : ""}</span>
          ) : (
            rows.map((a) => <TaChip key={a.id} a={a} />)
          )}
        </div>
        {canAssign && !err && (
          <button type="button" className={`${btnSecondary} !py-1.5 text-xs`} onClick={() => setAssigning("ta")}>
            <UserPlus size={13} /> {rows.length ? "Change TAs" : "Assign TAs"}
          </button>
        )}
      </div>
      {!err && (hms.length > 0 || canAssign) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-subtle px-4 py-2.5">
          <UserCheck size={14} className="text-emerald-600 dark:text-emerald-400" aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Hiring Manager</span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {hms.length === 0
              ? <span className="text-xs text-muted">None yet — a Hiring Manager confirms the JD, reviews candidates and signs off the selection</span>
              : hms.map((a) => <TaChip key={a.id} a={a} />)}
            {isHm && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                You
              </span>
            )}
          </div>
          {canAssign && (
            <button type="button" className={`${btnSecondary} !py-1.5 text-xs`} onClick={() => setAssigning("hm")}>
              <UserCheck size={13} /> {hms.length ? "Change Hiring Manager" : "Assign Hiring Manager"}
            </button>
          )}
        </div>
      )}
      {assigning && (
        <AssignTasModal
          kind={assigning}
          requirementId={requirementId}
          label={label}
          options={assigning === "hm" ? hmOptions : options}
          current={assigning === "hm" ? hms : rows}
          onClose={() => setAssigning(null)}
          onDone={(next) => { if (assigning === "hm") setHms(next); else setRows(next); onChanged?.(); }}
          toast={toast}
        />
      )}
    </div>
  );
}
