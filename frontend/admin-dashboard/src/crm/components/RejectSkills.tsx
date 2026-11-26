/** "Add their skills before you reject" (24 Nov 2026, user ask): when TA, RMG or
 *  GM reject a candidate, the candidate's skillset is captured so the Talent Pool
 *  finds them for the NEXT position that needs those skills.
 *
 *  Used inside every reject dialog (TA's Reject, RMG / GM's screening Reject,
 *  the AI L1 Reject and the Submit-to-Sales / Reject verdict). The field loads
 *  the skills already on record (through the profile when only a profile id is
 *  known), offers the master list, and `saveRejectSkills` writes the new ones
 *  through the Talent Pool's own skill route (a skill the list lacks is created).
 *  At least ONE skill must be on record or added — `rejectSkillsProblem`. */
import { useEffect, useMemo, useState } from "react";
import { Layers, Plus, X } from "lucide-react";

import { crmGet, crmPost } from "../api";
import { fetchAllMaster } from "../lib/fetchAllMaster";
import { CONTROL } from "./controlTower";

export type RejectSkillsState = {
  candidateId: number | null;
  onRecord: string[];
  added: string[];
  loaded: boolean;
};

let masterCache: Promise<string[]> | null = null;
function masterSkills(): Promise<string[]> {
  if (!masterCache) {
    masterCache = fetchAllMaster<{ name: string }>("/api/skills", { is_active: true })
      .then((rows) => rows.map((r) => r.name).filter(Boolean))
      .catch(() => { masterCache = null; return []; });
  }
  return masterCache;
}

/** Same name, any case / spacing. PURE. */
export function sameSkill(a: string, b: string): boolean {
  return a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Add a skill to the list unless it is already on record or listed. PURE. */
export function addRejectSkill(list: string[], onRecord: string[], name: string): string[] {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 120) return list;
  if (list.some((s) => sameSkill(s, clean)) || onRecord.some((s) => sameSkill(s, clean))) return list;
  return [...list, clean].slice(0, 15);
}

/** Why the reject cannot be saved yet, else null. PURE. */
export function rejectSkillsProblem(st: Pick<RejectSkillsState, "onRecord" | "added" | "loaded" | "candidateId">): string | null {
  if (!st.loaded || !st.candidateId) return null;      // nothing to check against — never block on a failed read
  if (st.onRecord.length + st.added.length === 0) {
    return "Add at least one skill — the Talent Pool uses it to offer this candidate for a matching position later";
  }
  return null;
}

/** Load the candidate's skills on record (by candidate id, else through the profile). */
export function useRejectSkills({ candidateId, profileId }: { candidateId?: number | null; profileId?: number | null }) {
  const [st, setSt] = useState<RejectSkillsState>({ candidateId: candidateId ?? null, onRecord: [], added: [], loaded: false });
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        let cid = candidateId ?? null;
        if (!cid && profileId) {
          const p = await crmGet<{ candidate_id?: number }>(`/api/candidate-profiles/${profileId}`);
          cid = p.data?.candidate_id ?? null;
        }
        if (!cid) { if (live) setSt((s) => ({ ...s, loaded: true })); return; }
        const c = await crmGet<{ skills?: { name: string }[] }>(`/api/candidates/${cid}`);
        if (live) setSt((s) => ({ ...s, candidateId: cid, onRecord: (c.data?.skills || []).map((x) => x.name), loaded: true }));
      } catch {
        if (live) setSt((s) => ({ ...s, loaded: true, candidateId: null }));
      }
    })();
    return () => { live = false; };
  }, [candidateId, profileId]);
  return [st, setSt] as const;
}

/** Write the newly added skills (each through the Talent Pool skill route). */
export async function saveRejectSkills(st: RejectSkillsState): Promise<number> {
  if (!st.candidateId || st.added.length === 0) return 0;
  let n = 0;
  for (const name of st.added) {
    try {
      await crmPost(`/api/talent-pool/candidates/${st.candidateId}/skills`, { name });
      n += 1;
    } catch { /* the reject itself is saved; a skill that fails is named in the toast by the caller's count */ }
  }
  return n;
}

export function RejectSkillsField({ state, onChange, tone = "rose" }: {
  state: RejectSkillsState;
  onChange: (next: RejectSkillsState) => void;
  tone?: "rose" | "amber";
}) {
  const [draft, setDraft] = useState("");
  const [master, setMaster] = useState<string[]>([]);
  useEffect(() => { void masterSkills().then(setMaster); }, []);
  const listId = useMemo(() => `reject-skills-${Math.random().toString(36).slice(2, 8)}`, []);
  if (!state.loaded) return <p className="text-xs text-muted">Reading the candidate's skills…</p>;
  if (!state.candidateId) return null;
  const add = (v: string) => { onChange({ ...state, added: addRejectSkill(state.added, state.onRecord, v) }); setDraft(""); };
  const missing = state.onRecord.length + state.added.length === 0;
  const ring = tone === "amber" ? "border-amber-300 dark:border-amber-700" : "border-rose-200 dark:border-rose-800";
  return (
    <section className={`rounded-card border ${missing ? "border-dashed" : ""} ${ring} bg-surface-2/50 p-3`}>
      <div className="flex items-center gap-1.5 text-sm font-semibold text-primary">
        <Layers size={14} aria-hidden /> Their skillset — keeps them findable in the Talent Pool
      </div>
      <p className="mt-0.5 text-xs text-muted">
        A rejection here is not the end: the pool offers them when a position needs these skills.
        {missing ? " Add at least one." : ""}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {state.onRecord.map((s) => (
          <span key={`r-${s}`} className="rounded-full bg-surface-1 px-2 py-0.5 text-[11px] font-semibold text-secondary ring-1 ring-inset ring-subtle" title="Already on record">{s}</span>
        ))}
        {state.added.map((s) => (
          <span key={`a-${s}`} className="inline-flex items-center gap-1 rounded-full bg-teal-600 px-2 py-0.5 text-[11px] font-semibold text-white">
            {s}
            <button type="button" aria-label={`Remove ${s}`} onClick={() => onChange({ ...state, added: state.added.filter((x) => x !== s) })}>
              <X size={11} aria-hidden />
            </button>
          </span>
        ))}
        {state.onRecord.length + state.added.length === 0 && <span className="text-xs text-rose-700 dark:text-rose-300">No skills on record yet</span>}
      </div>
      <div className="mt-2 flex gap-2">
        <input list={listId} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a skill, e.g. AUTOSAR, CAPL, Python"
          aria-label="Add a skill" className={`${CONTROL} min-w-0 flex-1`}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(draft); }
          }} />
        <datalist id={listId}>{master.slice(0, 400).map((m) => <option key={m} value={m} />)}</datalist>
        <button type="button" className="inline-flex items-center gap-1 rounded-control bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
          disabled={!draft.trim()} onClick={() => add(draft)}>
          <Plus size={12} aria-hidden /> Add
        </button>
      </div>
    </section>
  );
}
