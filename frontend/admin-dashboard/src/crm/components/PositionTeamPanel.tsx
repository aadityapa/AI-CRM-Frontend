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
import { Flag, UserPlus, Users } from "lucide-react";

import { crmGet, crmPatch, crmPut } from "../api";
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

export type TaOption = { id: number; name: string };

/** The team endpoint, as every caller reads it. `options` is non-empty only for a writer. */
export type TaAssignmentsPayload = { assignments: TaAssignment[]; options: TaOption[] };

/** ONE fetch for "who is on the team, who may I pick, may I change it". */
export async function fetchTaAssignments(requirementId: number): Promise<TaAssignmentsPayload & { canAssign: boolean }> {
  const res = await crmGet<TaAssignmentsPayload>(`/api/requirements/${requirementId}/ta-assignments`);
  return {
    assignments: res.data?.assignments || [],
    options: res.data?.options || [],
    canAssign: Boolean((res.meta as any)?.can_assign),
  };
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
export function TaPicker({ options, picked, onToggle }: {
  options: TaOption[];
  picked: Set<number>;
  onToggle: (id: number) => void;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? options.filter((o) => o.name.toLowerCase().includes(needle)) : options;
  }, [options, q]);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-bold uppercase tracking-wide text-muted">
          TAs · {picked.size} picked
        </span>
        {options.length > 6 && (
          <input type="text" className={`${CONTROL} w-44`} placeholder="Find a TA…" value={q}
                 onChange={(e) => setQ(e.target.value)} aria-label="Find a TA" />
        )}
      </div>
      {options.length === 0 ? (
        <p className="rounded-card border border-dashed border-subtle px-3 py-2 text-sm text-muted">
          No active TA login exists yet — add one under Access Control ▸ Users.
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
                <span className="truncate font-medium">{o.name}</span>
              </label>
            );
          })}
          {shown.length === 0 && <p className="text-sm text-muted">No TA matches “{q}”.</p>}
        </div>
      )}
    </div>
  );
}

function AssignTasModal({ requirementId, label, options, current, onClose, onDone, toast }: {
  requirementId: number;
  label: string;
  options: TaOption[];
  current: number[];
  onClose: () => void;
  onDone: (rows: TaAssignment[]) => void;
  toast: ToastFn;
}) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set(current));
  const toggle = (id: number) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <DecisionDialog
      spec={ASSIGN_SPEC}
      person={{ name: label }}
      onClose={onClose}
      onConfirm={async (note) => {
        const res = await crmPut<{ assignments: TaAssignment[] }>(
          `/api/requirements/${requirementId}/ta-assignments`,
          { user_ids: Array.from(picked), note: note || null });
        toast(res.message || "Team saved");
        onDone(res.data?.assignments || []);
        onClose();
      }}
    >
      <TaPicker options={options} picked={picked} onToggle={toggle} />
    </DecisionDialog>
  );
}

/** "Assign TAs" from a LIST row (1 Oct 2026, user ask: "no need to go inside
 *  the opportunity"). It fetches the team endpoint only when clicked — the
 *  server's `meta.can_assign` is the authority; a refusal is toasted. The
 *  caller decides whether to render it (the list already knows the role). */
/** The list-row button: a chip the size of the TA chips beside it (1 Oct 2026, user ask) —
 *  the same on every role's list. A caller that wants the full button passes `className`. */
const ASSIGN_CHIP = `inline-flex items-center gap-1 rounded-full border border-dashed border-strong px-2 py-0.5 text-[11px] font-semibold text-secondary hover:border-brand-500 hover:text-brand-600 disabled:opacity-60 ${focusRing}`;

export function AssignTasButton({ requirementId, label, assigned, onChanged, toast, className }: {
  requirementId: number;
  label: string;
  assigned?: TaAssignment[] | null;
  onChanged: (rows: TaAssignment[]) => void;
  toast: ToastFn;
  className?: string;
}) {
  const [open, setOpen] = useState<{ options: TaOption[]; current: number[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const count = assigned?.length ?? 0;
  const start = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetchTaAssignments(requirementId);
      if (!res.canAssign) { toast("Your role cannot assign TAs on this position", "err"); return; }
      setOpen({ options: res.options, current: res.assignments.map((a) => a.user_id) });
    } catch (err: any) {
      toast(err?.message || "The sourcing team could not be loaded", "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" disabled={busy} onClick={(e) => void start(e)}
        className={className || ASSIGN_CHIP}
        title={count ? "Change the TAs sourcing this position" : "Assign one or more TAs to source this position"}>
        <UserPlus size={11} aria-hidden /> {count ? "Change" : "Assign TAs"}
      </button>
      {open && (
        <AssignTasModal
          requirementId={requirementId}
          label={label}
          options={open.options}
          current={open.current}
          onClose={() => setOpen(null)}
          onDone={onChanged}
          toast={toast}
        />
      )}
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
  const [assigning, setAssigning] = useState(false);
  const [prio, setPrio] = useState(priority || "Medium");
  const [prioBusy, setPrioBusy] = useState(false);
  useEffect(() => { setPrio(priority || "Medium"); }, [priority]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchTaAssignments(requirementId)
      .then((res) => {
        if (!alive) return;
        setRows(res.assignments);
        setOptions(res.options);
        setCanAssign(res.canAssign);
        setErr("");
      })
      .catch((e: any) => { if (alive) setErr(e?.message || "The sourcing team could not be loaded"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [requirementId]);

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
          {canAssign ? (
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
          <button type="button" className={`${btnSecondary} !py-1.5 text-xs`} onClick={() => setAssigning(true)}>
            <UserPlus size={13} /> {rows.length ? "Change TAs" : "Assign TAs"}
          </button>
        )}
      </div>
      {assigning && (
        <AssignTasModal
          requirementId={requirementId}
          label={label}
          options={options}
          current={rows.map((a) => a.user_id)}
          onClose={() => setAssigning(false)}
          onDone={(next) => { setRows(next); onChanged?.(); }}
          toast={toast}
        />
      )}
    </div>
  );
}
