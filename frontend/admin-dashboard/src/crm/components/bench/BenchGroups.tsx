/**
 * Bench & Deployed — groups (24 Nov 2026).
 *
 * User ask: "a delete button for an employee who is not useful, or management —
 * remove them from here and add them into another group, so we know which
 * department or group they are from".
 *
 * Nobody is deleted: RMG / GM file a person under a group ("Management &
 * leadership", "Internal staff", "Not deployable now", "Trainees" or their
 * own). A group that does not count as bench takes its members off the Bench
 * tab and onto Groups; "Put back on the bench" undoes it. The server suggests
 * management / internal staff from the designation + department
 * (`bench_desk.suggest_group_key`). Server: `GET|POST /api/bench/groups`,
 * `PUT|DELETE /api/bench/groups/{id}`, `POST /api/bench/move`.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Armchair, Check, FolderInput, Layers, Pencil, Plus, RotateCcw, Sparkles, Trash2, UserMinus, Users,
} from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut } from "../../api";
import { Modal, btnSecondary } from "../ui";
import { DialogActions, DialogFailure, DialogHero, DialogSection, ReasonBox, WhatHappens } from "../dialogKit";

export type BenchGroup = {
  id: number; key: string | null; name: string; description: string | null; color: string;
  counts_as_bench: boolean; sort_order: number; members: number; system: boolean; created_by_name: string | null;
};
export type PersonGroup = {
  id: number; key: string | null; name: string; color: string; counts_as_bench: boolean;
  note: string | null; set_by_name: string | null; set_at: string | null;
};
export type Suggestion = {
  id: number; name: string; designation: string | null; department: string | null;
  suggested_group: string; bench_days: number | null;
};
export type MovePerson = { id: number; name: string; group?: PersonGroup | null };

export const GROUP_COLORS = ["slate", "purple", "sky", "rose", "amber", "emerald", "teal", "indigo", "orange", "pink"] as const;

/** One look per colour — chips, dots and the card stripe. Literal classes so Tailwind keeps them. */
export const GROUP_LOOK: Record<string, { chip: string; dot: string; grad: string }> = {
  slate: { chip: "bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600", dot: "bg-slate-500", grad: "from-slate-500 to-slate-700" },
  purple: { chip: "bg-purple-50 text-purple-800 ring-purple-200 dark:bg-purple-950/40 dark:text-purple-200 dark:ring-purple-800", dot: "bg-purple-500", grad: "from-purple-500 to-indigo-600" },
  sky: { chip: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-800", dot: "bg-sky-500", grad: "from-sky-500 to-blue-600" },
  rose: { chip: "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-800", dot: "bg-rose-500", grad: "from-rose-500 to-pink-600" },
  amber: { chip: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800", dot: "bg-amber-500", grad: "from-amber-500 to-orange-600" },
  emerald: { chip: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800", dot: "bg-emerald-500", grad: "from-emerald-500 to-teal-600" },
  teal: { chip: "bg-teal-50 text-teal-800 ring-teal-200 dark:bg-teal-950/40 dark:text-teal-200 dark:ring-teal-800", dot: "bg-teal-500", grad: "from-teal-500 to-emerald-600" },
  indigo: { chip: "bg-indigo-50 text-indigo-800 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:ring-indigo-800", dot: "bg-indigo-500", grad: "from-indigo-500 to-purple-600" },
  orange: { chip: "bg-orange-50 text-orange-800 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:ring-orange-800", dot: "bg-orange-500", grad: "from-orange-500 to-red-600" },
  pink: { chip: "bg-pink-50 text-pink-800 ring-pink-200 dark:bg-pink-950/40 dark:text-pink-200 dark:ring-pink-800", dot: "bg-pink-500", grad: "from-pink-500 to-rose-600" },
};
export const lookOf = (color: string | null | undefined) => GROUP_LOOK[color || "slate"] || GROUP_LOOK.slate;

/** The words for where a group's members stand. PURE. */
export function groupEffect(g: Pick<BenchGroup, "counts_as_bench">): string {
  return g.counts_as_bench ? "Stays on the Bench tab, with this label" : "Leaves the Bench tab — listed under Groups";
}

/** Who is moved where when RMG accepts the suggestions: group key → ids. PURE. */
export function suggestionPlan(list: Suggestion[], picked: Set<number>, groups: BenchGroup[]): { group: BenchGroup; ids: number[] }[] {
  const byKey = new Map(groups.filter((g) => g.key).map((g) => [g.key as string, g]));
  const out = new Map<number, { group: BenchGroup; ids: number[] }>();
  for (const s of list) {
    if (!picked.has(s.id)) continue;
    const g = byKey.get(s.suggested_group);
    if (!g) continue;
    const slot = out.get(g.id) || { group: g, ids: [] };
    slot.ids.push(s.id);
    out.set(g.id, slot);
  }
  return [...out.values()];
}

export function GroupChip({ group, small }: { group: { name: string; color: string; note?: string | null }; small?: boolean }) {
  const look = lookOf(group.color);
  return (
    <span title={group.note || undefined}
      className={`inline-flex items-center gap-1 rounded-full font-semibold ring-1 ring-inset ${look.chip} ${small ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${look.dot}`} aria-hidden />{group.name}
    </span>
  );
}

const SUGGEST_WORDS: Record<string, string> = { management: "management", internal: "internal staff" };
export const suggestWords = (key: string | null | undefined) => SUGGEST_WORDS[key || ""] || key || "";

export function useBenchGroups(open: boolean) {
  const [groups, setGroups] = useState<BenchGroup[] | null>(null);
  const [error, setError] = useState("");
  const load = () => crmGet<BenchGroup[]>("/api/bench/groups").then((r) => setGroups(r.data || [])).catch((e) => setError(e?.message || "Could not load the groups"));
  useEffect(() => { if (open) void load(); }, [open]);  // eslint-disable-line react-hooks/exhaustive-deps
  return { groups, error, reload: load };
}

/* ------------------------------------------------------------------ new group form */

type Draft = { name: string; description: string; color: string; counts_as_bench: boolean };
const EMPTY_DRAFT: Draft = { name: "", description: "", color: "indigo", counts_as_bench: false };

function GroupForm({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  return (
    <div className="space-y-3">
      <label className="block text-xs font-semibold text-secondary">Name
        <input className="input-recessed mt-1 w-full rounded-control px-3 py-2 text-sm text-primary" value={draft.name} maxLength={80}
          placeholder="e.g. Delivery managers, Long leave, Pune internal team" onChange={(e) => onChange({ ...draft, name: e.target.value })} />
      </label>
      <label className="block text-xs font-semibold text-secondary">What it is for <span className="font-normal text-muted">(optional)</span>
        <input className="input-recessed mt-1 w-full rounded-control px-3 py-2 text-sm text-primary" value={draft.description} maxLength={300}
          onChange={(e) => onChange({ ...draft, description: e.target.value })} />
      </label>
      <div>
        <div className="text-xs font-semibold text-secondary">Colour</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {GROUP_COLORS.map((c) => (
            <button key={c} type="button" aria-label={c} aria-pressed={draft.color === c} onClick={() => onChange({ ...draft, color: c })}
              className={`grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br ${lookOf(c).grad} ${draft.color === c ? "ring-2 ring-offset-2 ring-brand-500 ring-offset-surface-1" : ""}`}>
              {draft.color === c && <Check size={13} className="text-white" />}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Bench tab">
        {[false, true].map((v) => (
          <button key={String(v)} type="button" role="radio" aria-checked={draft.counts_as_bench === v}
            onClick={() => onChange({ ...draft, counts_as_bench: v })}
            className={`rounded-control border p-3 text-left text-xs transition ${draft.counts_as_bench === v ? "border-brand-500 bg-brand-50 dark:bg-brand-900/30" : "border-subtle hover:bg-surface-2"}`}>
            <div className="font-bold text-primary">{v ? "Still on the bench" : "Not part of the bench"}</div>
            <div className="mt-0.5 text-muted">{v ? "Members stay on the Bench tab with this label (e.g. trainees)." : "Members leave the Bench tab (e.g. management, internal staff)."}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ move dialog */

const MOVE_PICKS = ["Management — not billable", "Internal role (HR / Finance / Admin)", "On long leave", "Serving notice", "Training before deployment"];

export function MoveToGroupDialog({ people, onClose, onDone }: {
  people: MovePerson[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { groups, error: loadErr, reload } = useBenchGroups(true);
  const current = people.length === 1 ? people[0].group || null : null;
  const anyGrouped = people.some((p) => p.group);
  const [pick, setPick] = useState<number | "bench" | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const chosen = typeof pick === "number" ? groups?.find((g) => g.id === pick) || null : null;
  const ready = pick === "bench" || chosen != null || (pick === "new" && draft.name.trim().length >= 3);
  const who = people.length === 1 ? people[0].name : `${people.length} people`;

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      let groupId: number | null = null;
      if (pick === "new") {
        const r = await crmPost<BenchGroup>("/api/bench/groups", { ...draft, name: draft.name.trim(), description: draft.description.trim() || null });
        groupId = r.data.id;
      } else if (typeof pick === "number") groupId = pick;
      const r = await crmPost<{ message: string }>("/api/bench/move", { employee_ids: people.map((p) => p.id), group_id: groupId, note: note.trim() || null });
      onDone(r.message || "Moved");
    } catch (e) {
      setErr((e as Error).message);
      void reload();
    } finally { setBusy(false); }
  };

  return (
    <Modal title="Move to a group" onClose={onClose} medium dirty={pick != null && !busy}
      hero={<DialogHero tone="indigo" icon={FolderInput} eyebrow="Bench & Deployed" title={`Move ${who} to a group`}
        subtitle="Nobody is deleted — the person keeps their record, history and login. You can put them back on the bench any time."
        person={people.length === 1 ? { name: people[0].name, meta: current ? <>Now in <b>{current.name}</b></> : "In the bench pool" } : null} />}>
      <div className="space-y-4">
        {people.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {people.slice(0, 12).map((p) => <span key={p.id} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-primary ring-1 ring-inset ring-subtle">{p.name}</span>)}
            {people.length > 12 && <span className="text-xs text-muted">+{people.length - 12} more</span>}
          </div>
        )}
        <DialogSection n={1} title="Which group?" done={ready} tone="indigo">
          {loadErr && <DialogFailure message={loadErr} />}
          {!groups ? <p className="text-sm text-muted">Loading groups…</p> : (
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Group">
              {groups.map((g) => {
                const on = pick === g.id;
                const here = current?.id === g.id;
                return (
                  <button key={g.id} type="button" role="radio" aria-checked={on} disabled={here} onClick={() => setPick(g.id)}
                    className={`flex items-start gap-2.5 rounded-control border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500 dark:bg-brand-900/30" : "border-subtle hover:bg-surface-2"}`}>
                    <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-white ${lookOf(g.color).grad}`}><Layers size={15} /></span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-primary">{g.name}{here && <span className="ml-1 text-[11px] font-semibold text-muted">(now)</span>}</span>
                      {g.description && <span className="block text-xs text-muted">{g.description}</span>}
                      <span className="mt-0.5 block text-[11px] text-secondary">{g.members} in it · {groupEffect(g)}</span>
                    </span>
                  </button>
                );
              })}
              <button type="button" role="radio" aria-checked={pick === "new"} onClick={() => setPick("new")}
                className={`flex items-center gap-2.5 rounded-control border border-dashed p-3 text-left transition ${pick === "new" ? "border-brand-500 bg-brand-50 dark:bg-brand-900/30" : "border-strong hover:bg-surface-2"}`}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-brand-600"><Plus size={16} /></span>
                <span><span className="block text-sm font-bold text-primary">New group</span><span className="block text-xs text-muted">Name it and choose whether it counts as bench</span></span>
              </button>
              {anyGrouped && (
                <button type="button" role="radio" aria-checked={pick === "bench"} onClick={() => setPick("bench")}
                  className={`flex items-center gap-2.5 rounded-control border p-3 text-left transition ${pick === "bench" ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500 dark:bg-emerald-950/40" : "border-subtle hover:bg-surface-2"}`}>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white"><RotateCcw size={15} /></span>
                  <span><span className="block text-sm font-bold text-primary">Put back on the bench</span><span className="block text-xs text-muted">Out of every group — back in the bench pool</span></span>
                </button>
              )}
            </div>
          )}
          {pick === "new" && <div className="mt-3 rounded-control border border-subtle bg-surface-2 p-3"><GroupForm draft={draft} onChange={setDraft} /></div>}
        </DialogSection>
        {pick !== "bench" && (
          <DialogSection n={2} title="Why" optional tone="indigo">
            <ReasonBox id="bench-move-note" label="Note" value={note} onChange={setNote} max={500} tone="indigo"
              placeholder="e.g. Director — not billable" picks={MOVE_PICKS} rows={2} />
          </DialogSection>
        )}
        <WhatHappens tone="indigo" items={pick === "bench" ? [
          { icon: Armchair, text: `${who} ${people.length === 1 ? "is" : "are"} back in the bench pool and on the Bench tab.` },
        ] : [
          { icon: chosen?.counts_as_bench || (pick === "new" && draft.counts_as_bench) ? Armchair : UserMinus,
            text: chosen ? groupEffect(chosen) + "." : pick === "new" ? groupEffect(draft) + "." : "Pick a group to see what happens." },
          { icon: Users, text: "The Talent Pool stops offering people who are not part of the bench." },
          { icon: RotateCcw, text: "Put them back any time from Groups or their page." },
        ]} />
        <DialogFailure message={err} />
        <DialogActions onCancel={onClose} busy={busy} tone={pick === "bench" ? "emerald" : "indigo"} icon={pick === "bench" ? RotateCcw : FolderInput}
          label={pick === "bench" ? "Put back on the bench" : pick === "new" ? "Create group & move" : "Move"} busyLabel="Moving…"
          disabled={!ready} onConfirm={submit}
          hint={!ready ? (pick === "new" ? "Name the new group (3 characters or more)" : "Pick a group") : undefined} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ suggestions */

export function SuggestionsDialog({ suggestions, onClose, onDone }: {
  suggestions: Suggestion[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { groups } = useBenchGroups(true);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(suggestions.map((s) => s.id)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const plan = useMemo(() => suggestionPlan(suggestions, picked, groups || []), [suggestions, picked, groups]);
  const byKey = useMemo(() => {
    const m = new Map<string, Suggestion[]>();
    for (const s of suggestions) m.set(s.suggested_group, [...(m.get(s.suggested_group) || []), s]);
    return [...m.entries()];
  }, [suggestions]);
  const total = plan.reduce((n, p) => n + p.ids.length, 0);
  const toggle = (id: number, on: boolean) => setPicked((prev) => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const msgs: string[] = [];
      for (const p of plan) {
        const r = await crmPost<{ message: string }>("/api/bench/move", { employee_ids: p.ids, group_id: p.group.id, note: "Suggested from the designation / department" });
        msgs.push(r.message || "");
      }
      onDone(msgs.filter(Boolean).join(" · ") || "Moved");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal title="Review suggested groups" onClose={onClose} medium
      hero={<DialogHero tone="purple" icon={Sparkles} eyebrow="Bench & Deployed" title={`${suggestions.length} on the bench look like management or internal staff`}
        subtitle="Read from each person's designation and department. Untick anyone who IS part of the billable bench." />}>
      <div className="space-y-4">
        {byKey.map(([key, list]) => {
          const g = (groups || []).find((x) => x.key === key);
          return (
            <section key={key} className="rounded-card border border-subtle bg-surface-1 p-3 shadow-raised">
              <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-bold text-primary">
                  {g ? <GroupChip group={g} /> : <span>{suggestWords(key)}</span>}
                  <span className="text-xs font-semibold text-muted">{list.length}</span>
                </div>
                <div className="flex gap-2 text-xs font-semibold">
                  <button type="button" className="text-brand-600 hover:underline" onClick={() => list.forEach((s) => toggle(s.id, true))}>All</button>
                  <button type="button" className="text-brand-600 hover:underline" onClick={() => list.forEach((s) => toggle(s.id, false))}>None</button>
                </div>
              </header>
              <ul className="divide-y divide-subtle">
                {list.map((s) => (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-center gap-3 py-1.5 text-sm">
                      <input type="checkbox" aria-label={`Move ${s.name}`} checked={picked.has(s.id)} onChange={(e) => toggle(s.id, e.target.checked)} />
                      <span className="min-w-0 flex-1"><b className="text-primary">{s.name}</b> <span className="text-xs text-muted">{[s.designation, s.department].filter(Boolean).join(" · ")}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        <DialogFailure message={err} />
        <DialogActions onCancel={onClose} busy={busy} tone="purple" icon={FolderInput} label={`Move ${total}`} busyLabel="Moving…"
          disabled={!total} onConfirm={submit} hint={total ? `${total} of ${suggestions.length} ticked` : "Tick at least one person"} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ manage groups */

export function ManageGroupsDialog({ onClose, onChanged }: { onClose: () => void; onChanged: (message: string) => void }) {
  const { groups, error, reload } = useBenchGroups(true);
  const [edit, setEdit] = useState<BenchGroup | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [confirmDel, setConfirmDel] = useState<BenchGroup | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const open = (g: BenchGroup | "new") => {
    setEdit(g); setErr("");
    setDraft(g === "new" ? EMPTY_DRAFT : { name: g.name, description: g.description || "", color: g.color, counts_as_bench: g.counts_as_bench });
  };
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const body = { ...draft, name: draft.name.trim(), description: draft.description.trim() || null };
      const r = edit === "new" ? await crmPost("/api/bench/groups", body) : await crmPut(`/api/bench/groups/${(edit as BenchGroup).id}`, body);
      setEdit(null); void reload(); onChanged(r.message || "Saved");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async (g: BenchGroup) => {
    setBusy(true); setErr("");
    try { const r = await crmDelete(`/api/bench/groups/${g.id}`); setConfirmDel(null); void reload(); onChanged(r.message || "Deleted"); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal title="Bench groups" onClose={onClose} medium
      hero={<DialogHero tone="indigo" icon={Layers} eyebrow="Bench & Deployed" title="Groups"
        subtitle="Where people who are not on the billable bench belong. Deleting a group puts its members back on the bench." />}>
      <div className="space-y-3">
        {error && <DialogFailure message={error} />}
        {!groups ? <p className="text-sm text-muted">Loading…</p> : (
          <ul className="space-y-2">
            {groups.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-3 rounded-control border border-subtle bg-surface-1 p-3">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-white ${lookOf(g.color).grad}`}><Layers size={16} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-primary">{g.name}{g.system && <span className="ml-1.5 text-[10px] font-semibold uppercase text-muted">built in</span>}</div>
                  <div className="text-xs text-muted">{g.members} {g.members === 1 ? "person" : "people"} · {groupEffect(g)}</div>
                </div>
                {confirmDel?.id === g.id ? (
                  <span className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-rose-700 dark:text-rose-300">Delete{g.members ? ` — ${g.members} back on the bench` : ""}?</span>
                    <button type="button" className="rounded-control bg-rose-600 px-2.5 py-1 font-semibold text-white" disabled={busy} onClick={() => void remove(g)}>Delete</button>
                    <button type="button" className={btnSecondary} onClick={() => setConfirmDel(null)}>Keep</button>
                  </span>
                ) : (
                  <span className="flex gap-1">
                    <button type="button" className="rounded-control p-1.5 text-secondary hover:bg-surface-2" aria-label={`Edit ${g.name}`} onClick={() => open(g)}><Pencil size={14} /></button>
                    <button type="button" className="rounded-control p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40" aria-label={`Delete ${g.name}`} onClick={() => setConfirmDel(g)}><Trash2 size={14} /></button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {edit ? (
          <div className="rounded-card border border-brand-300 bg-surface-1 p-3 shadow-raised">
            <div className="mb-2 text-sm font-bold text-primary">{edit === "new" ? "New group" : `Edit “${(edit as BenchGroup).name}”`}</div>
            <GroupForm draft={draft} onChange={setDraft} />
            <DialogFailure message={err} />
            <div className="mt-3">
              <DialogActions onCancel={() => setEdit(null)} busy={busy} tone="indigo" icon={Check} label="Save group"
                disabled={draft.name.trim().length < 3} onConfirm={save} />
            </div>
          </div>
        ) : (
          <>
            <DialogFailure message={err} />
            <button type="button" className={btnSecondary} onClick={() => open("new")}><Plus size={14} /> New group</button>
          </>
        )}
      </div>
    </Modal>
  );
}
