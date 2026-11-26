/**
 * Talent Pool — groups, skill tags, fit check and direct apply (24 Nov 2026).
 *
 * User ask (screenshot of the Talent Pool): "create a skill or a group so we
 * can identify that this candidate is good for this position, with all
 * required details for RMG; RMG applies directly to any position from here;
 * make the tab more interactive".
 *
 *  • Groups (a mode tab): named, shared shortlists with the skills they are
 *    about and, optionally, the position they are for. The group page compares
 *    every member side by side — availability, experience vs the band, notice,
 *    CTC vs budget, must-haves held, the ATS fit to the position and whether
 *    they are already applied — and applies the ticked ones in one go.
 *  • Add to group (any card, or several ticked cards).
 *  • + Skill: put a skill on a candidate's record (a new master skill is made
 *    when the list lacks it) so the pool finds them by it at once.
 *  • Check fit & apply: every open position scored against the candidate's
 *    resumes; tick and apply (the candidate page's multi-apply).
 * Server: services/talent_groups.py, routers/crm/talent_pool.py, the resume
 * library's matching-positions / multi-apply (TA + RMG / GM since today).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Award, CheckCircle2, FolderPlus, Layers, Pencil, Plus, Search, Send, Sparkles, Star, Target, Trash2,
  UserCheck, UserMinus, Users, X, XCircle,
} from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut, qs } from "../../api";
import { useHasRole } from "../../CrmApp";
import { useCanApprove } from "../../useAccess";
import { CrmLink } from "../../router";
import { ErrorBox, Modal, Spinner, btnSecondary } from "../../components/ui";
import { CONTROL } from "../../components/controlTower";
import { FLOW_BTN } from "../../components/flowButtons";
import { ScoreIndicator } from "../../components/ScoreIndicator";
import { DialogActions, DialogFailure, DialogHero, DialogSection, ReasonBox, WhatHappens, initials } from "../../components/dialogKit";
import { MultiApplyDialog, type MatchRow, type ResumeVersion } from "../../components/ResumeLibrary";
import { lookOf } from "../../components/bench/BenchGroups";
import { isPlaceholderEmail } from "../../lib/candidateEmail";
import { fmtDateShort } from "../../../lib/datetime";
import { fileViewHref } from "../FileView";
import type { PoolRow } from "../TalentPool";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GroupSkill = { name: string; must: boolean };
export type GroupPosition = {
  requirement_id: number; req_number: string; title: string; opportunity_id: number | null; opp_id: string | null;
  customer_name: string | null; location: string | null; status: string | null;
  experience_min: number | null; experience_max: number | null; budget_ctc_max: number | null; open: boolean;
};
export type TalentGroup = {
  id: number; name: string; description: string | null; color: string; requirement_id: number | null;
  position: GroupPosition | null; skills: GroupSkill[]; members: number;
  created_by: number | null; created_by_name: string | null; created_at: string | null; updated_at: string | null;
};
export type GroupChipData = { id: number; name: string; color: string };
export type PoolPosition = {
  requirement_id: number; req_number: string; title: string; customer_name: string | null;
  opp_id: string; opportunity_title: string;
};
type Fit = {
  scorable: boolean; score: number | null; good_fit: boolean; skills_matched: string[]; skills_missing: string[];
  resume_id: number | null; resume_label: string | null; experience_fit: boolean | null; over_budget: boolean;
  applied: { profile_id: number; status: string | null; tone: string | null; applied_by: string | null } | null;
};
export type MemberRow = PoolRow & {
  coverage: { score: number | null; must: number; must_total: number; nice: number; nice_total: number; missing_must: string[] };
  fit: Fit | null;
  member: { note: string | null; added_by_name: string | null; added_at: string | null };
};
type GroupMeta = {
  group: TalentGroup;
  summary: { members: number; available: number; all_must: number; good_fit: number; applied: number };
  fit_members: number; good_fit_pct: number;
};
type Toast = (m: string, k?: "ok" | "err") => void;

export const GROUP_COLORS = ["teal", "sky", "indigo", "purple", "emerald", "amber", "rose", "slate", "orange", "pink"] as const;

// ---------------------------------------------------------------------------
// Pure helpers (pinned by TalentGroups.test.ts)
// ---------------------------------------------------------------------------

/** Add a skill to a list (must by default), case-insensitive de-dupe, ≤ 15. */
export function addGroupSkill(list: GroupSkill[], name: string, must = true): GroupSkill[] {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean || list.some((s) => s.name.toLowerCase() === clean.toLowerCase())) return list;
  return [...list, { name: clean, must }].slice(0, 15);
}

/** Who in a group may be applied to its position right now. PURE. */
export function applicable(rows: MemberRow[]): MemberRow[] {
  return rows.filter((r) => r.kind === "candidate" && r.candidate_id && !r.fit?.applied);
}

/** "₹8.5 L" from rupees. */
function lakh(v: number | null | undefined): string | null {
  if (v === null || v === undefined || !Number.isFinite(Number(v)) || Number(v) <= 0) return null;
  const l = Number(v) / 100000;
  return `₹${l >= 10 ? Math.round(l) : Math.round(l * 10) / 10} L`;
}

/** TA, RMG, a screener (GM) or Admin / CEO — the server's apply gate. */
export function useCanApplyFromPool(): boolean {
  const role = useHasRole("TA", "RMG");
  const screener = useCanApprove("profile.rmg_screening");
  return role || screener;
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

export function TalentGroupChips({ groups, onOpen }: { groups?: GroupChipData[]; onOpen?: (id: number) => void }) {
  if (!groups?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      <Layers size={11} className="text-muted" aria-hidden />
      {groups.map((g) => {
        const look = lookOf(g.color);
        const body = <><span className={`h-1.5 w-1.5 rounded-full ${look.dot}`} aria-hidden />{g.name}</>;
        const cls = `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${look.chip}`;
        return onOpen
          ? <button key={g.id} type="button" className={`${cls} hover:opacity-80`} onClick={() => onOpen(g.id)} title="Open this group">{body}</button>
          : <span key={g.id} className={cls}>{body}</span>;
      })}
    </div>
  );
}

function SkillsEditor({ skills, onChange, suggestions = [] }: { skills: GroupSkill[]; onChange: (s: GroupSkill[]) => void; suggestions?: string[] }) {
  const [draft, setDraft] = useState("");
  const add = (must: boolean) => { if (draft.trim()) { onChange(addGroupSkill(skills, draft, must)); setDraft(""); } };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {skills.length === 0 && <span className="text-xs text-muted">No skills yet — type one below.</span>}
        {skills.map((s) => (
          <span key={s.name} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
            s.must ? "bg-brand-600 text-white ring-brand-600" : "bg-surface-2 text-secondary ring-subtle"}`}>
            <button type="button" title={s.must ? "Must-have — click to make it nice-to-have" : "Nice-to-have — click to make it a must"}
              onClick={() => onChange(skills.map((x) => (x.name === s.name ? { ...x, must: !x.must } : x)))}>
              <Star size={11} className={s.must ? "fill-current" : ""} />
            </button>
            {s.name}
            <button type="button" aria-label={`Remove ${s.name}`} onClick={() => onChange(skills.filter((x) => x.name !== s.name))}><X size={11} /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input className={`${CONTROL} min-w-0 flex-1`} value={draft} list="tg-skill-suggest" placeholder="Type a skill — Enter adds a must-have"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(!e.shiftKey); } }} />
        <button type="button" className={FLOW_BTN.primary} onClick={() => add(true)} disabled={!draft.trim()}><Plus size={12} /> Must</button>
        <button type="button" className={FLOW_BTN.neutral} onClick={() => add(false)} disabled={!draft.trim()}><Plus size={12} /> Nice</button>
      </div>
      {suggestions.length > 0 && <datalist id="tg-skill-suggest">{suggestions.slice(0, 400).map((s) => <option key={s} value={s} />)}</datalist>}
    </div>
  );
}

function PositionSelect({ value, onChange, positions, emptyLabel = "No position — a general shortlist" }: {
  value: number | null; onChange: (v: number | null) => void; positions: PoolPosition[]; emptyLabel?: string;
}) {
  const byCustomer = useMemo(() => {
    const m = new Map<string, PoolPosition[]>();
    for (const p of positions) m.set(p.customer_name || "No customer", [...(m.get(p.customer_name || "No customer") || []), p]);
    return [...m.entries()];
  }, [positions]);
  return (
    <select className={`${CONTROL} w-full`} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} aria-label="Position">
      <option value="">{emptyLabel}</option>
      {byCustomer.map(([c, list]) => (
        <optgroup key={c} label={c}>{list.map((p) => <option key={p.requirement_id} value={p.requirement_id}>{p.opp_id} · {p.title}</option>)}</optgroup>
      ))}
    </select>
  );
}

function ColorPick({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {GROUP_COLORS.map((c) => (
        <button key={c} type="button" aria-label={c} aria-pressed={value === c} onClick={() => onChange(c)}
          className={`h-6 w-6 rounded-full bg-gradient-to-br ${lookOf(c).grad} ${value === c ? "ring-2 ring-brand-500 ring-offset-2 ring-offset-surface-1" : ""}`} />
      ))}
    </div>
  );
}

function useGroupsList(enabled = true) {
  const [groups, setGroups] = useState<TalentGroup[] | null>(null);
  const [positions, setPositions] = useState<PoolPosition[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    return crmGet<TalentGroup[]>("/api/talent-pool/groups")
      .then((r) => { setGroups(r.data || []); setPositions(((r.meta as unknown as { positions?: PoolPosition[] }) || {}).positions || []); })
      .catch((e) => setError(e?.message || "Could not load the groups"));
  }, []);
  useEffect(() => { if (enabled) void load(); }, [enabled, load]);
  return { groups, positions, error, reload: load };
}

// ---------------------------------------------------------------------------
// Group form (new / edit)
// ---------------------------------------------------------------------------

type GroupDraft = { name: string; description: string; color: string; requirement_id: number | null; skills: GroupSkill[] };
const EMPTY_GROUP: GroupDraft = { name: "", description: "", color: "teal", requirement_id: null, skills: [] };

function GroupForm({ draft, onChange, positions, skillSuggestions }: {
  draft: GroupDraft; onChange: (d: GroupDraft) => void; positions: PoolPosition[]; skillSuggestions?: string[];
}) {
  return (
    <div className="space-y-3">
      <label className="block text-xs font-semibold text-secondary">Group name
        <input className={`${CONTROL} mt-1 w-full`} value={draft.name} maxLength={120} placeholder="e.g. AUTOSAR · Pune · 3–6 yrs"
          onChange={(e) => onChange({ ...draft, name: e.target.value })} />
      </label>
      <div className="text-xs font-semibold text-secondary">For which position <span className="font-normal text-muted">(optional — members are scored against it)</span>
        <div className="mt-1"><PositionSelect value={draft.requirement_id} positions={positions} onChange={(v) => onChange({ ...draft, requirement_id: v })} /></div>
        {draft.requirement_id && draft.skills.length === 0 && <p className="mt-1 font-normal text-muted">The position's skills are copied in when you save.</p>}
      </div>
      <div className="text-xs font-semibold text-secondary">Skills this group is about <span className="font-normal text-muted">(★ = must-have)</span>
        <div className="mt-1"><SkillsEditor skills={draft.skills} onChange={(skills) => onChange({ ...draft, skills })} suggestions={skillSuggestions} /></div>
      </div>
      <label className="block text-xs font-semibold text-secondary">Notes <span className="font-normal text-muted">(optional)</span>
        <textarea className={`${CONTROL} mt-1 w-full !min-h-[56px]`} rows={2} value={draft.description} maxLength={2000}
          placeholder="e.g. Shortlist for the Harman BLE opening — phone-screened" onChange={(e) => onChange({ ...draft, description: e.target.value })} />
      </label>
      <div className="text-xs font-semibold text-secondary">Colour<div className="mt-1"><ColorPick value={draft.color} onChange={(color) => onChange({ ...draft, color })} /></div></div>
    </div>
  );
}

function draftBody(d: GroupDraft) {
  return { name: d.name.trim(), description: d.description.trim() || null, color: d.color, requirement_id: d.requirement_id, skills: d.skills };
}

// ---------------------------------------------------------------------------
// Add to group
// ---------------------------------------------------------------------------

export function AddToGroupDialog({ people, skillSuggestions, presetSkills, onClose, onDone }: {
  people: { candidate_id: number; name: string }[];
  skillSuggestions?: string[];
  /** The search's skills — a new group starts with them. */
  presetSkills?: GroupSkill[];
  onClose: () => void;
  onDone: (message: string, groupId?: number) => void;
}) {
  const { groups, positions, error } = useGroupsList();
  const [pick, setPick] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<GroupDraft>({ ...EMPTY_GROUP, skills: presetSkills || [] });
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (groups && groups.length === 0) setPick("new"); }, [groups]);

  const ready = typeof pick === "number" || (pick === "new" && draft.name.trim().length >= 3);
  const who = people.length === 1 ? people[0].name : `${people.length} candidates`;
  const shown = (groups || []).filter((g) => !query.trim() || `${g.name} ${g.position?.title || ""}`.toLowerCase().includes(query.trim().toLowerCase()));

  const submit = async () => {
    setBusy(true); setErr("");
    const ids = people.map((p) => p.candidate_id);
    try {
      if (pick === "new") {
        const r = await crmPost<TalentGroup>("/api/talent-pool/groups", { ...draftBody(draft), candidate_ids: ids });
        onDone(r.message || "Group created", r.data.id);
      } else if (typeof pick === "number") {
        const r = await crmPost(`/api/talent-pool/groups/${pick}/members`, { candidate_ids: ids, note: note.trim() || null });
        onDone(r.message || "Added", pick);
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal title="Add to a group" onClose={onClose} medium dirty={pick === "new" && !!draft.name}
      hero={<DialogHero tone="emerald" icon={FolderPlus} eyebrow="Talent Pool" title={`Add ${who} to a group`}
        subtitle="Groups are shared shortlists — everyone who opens the Talent Pool sees them. Give a group a position and its members are scored against it."
        person={people.length === 1 ? { name: people[0].name } : null} />}>
      <div className="space-y-4">
        <DialogSection n={1} title="Which group?" done={ready} tone="emerald">
          {error && <DialogFailure message={error} />}
          {!groups ? <Spinner label="Loading groups…" /> : (
            <div className="space-y-2">
              {groups.length > 5 && (
                <input className={`${CONTROL} w-full`} placeholder="Find a group" value={query} onChange={(e) => setQuery(e.target.value)} />
              )}
              <div className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2" role="radiogroup" aria-label="Group">
                {shown.map((g) => (
                  <button key={g.id} type="button" role="radio" aria-checked={pick === g.id} onClick={() => setPick(g.id)}
                    className={`flex items-start gap-2.5 rounded-control border p-3 text-left transition ${pick === g.id ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500 dark:bg-emerald-950/40" : "border-subtle hover:bg-surface-2"}`}>
                    <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-white ${lookOf(g.color).grad}`}><Layers size={15} /></span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-primary">{g.name}</span>
                      <span className="block truncate text-xs text-muted">{g.position ? `${g.position.opp_id || g.position.req_number} · ${g.position.title}` : "General shortlist"}</span>
                      <span className="block text-[11px] text-secondary">{g.members} in it{g.skills.length ? ` · ${g.skills.map((s) => s.name).slice(0, 3).join(", ")}` : ""}</span>
                    </span>
                  </button>
                ))}
                <button type="button" role="radio" aria-checked={pick === "new"} onClick={() => setPick("new")}
                  className={`flex items-center gap-2.5 rounded-control border border-dashed p-3 text-left transition ${pick === "new" ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40" : "border-strong hover:bg-surface-2"}`}>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-emerald-600"><Plus size={16} /></span>
                  <span><span className="block text-sm font-bold text-primary">New group</span><span className="block text-xs text-muted">Name it, pick the position and skills</span></span>
                </button>
              </div>
            </div>
          )}
          {pick === "new" && (
            <div className="mt-3 rounded-control border border-subtle bg-surface-2 p-3">
              <GroupForm draft={draft} onChange={setDraft} positions={positions} skillSuggestions={skillSuggestions} />
            </div>
          )}
        </DialogSection>
        {typeof pick === "number" && (
          <DialogSection n={2} title="Why they belong here" optional tone="emerald">
            <ReasonBox id="tg-note" label="Note" value={note} onChange={setNote} max={500} tone="emerald" rows={2}
              picks={["Phone-screened — interested", "Strong on the must-have skills", "Available immediately", "Ex-Karnex, good feedback"]} />
          </DialogSection>
        )}
        <DialogFailure message={err} />
        <DialogActions onCancel={onClose} busy={busy} tone="emerald" icon={FolderPlus} busyLabel="Saving…"
          label={pick === "new" ? "Create group & add" : "Add to group"} disabled={!ready} onConfirm={submit}
          hint={!ready ? (pick === "new" ? "Name the group (3 characters or more)" : "Pick a group") : undefined} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// + Skill on a candidate
// ---------------------------------------------------------------------------

export function TagSkillDialog({ candidateId, name, has, suggestions, onClose, onDone }: {
  candidateId: number; name: string; has: string[]; suggestions: string[];
  onClose: () => void; onDone: (message: string) => void;
}) {
  const [skills, setSkills] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const hasSet = useMemo(() => new Set(has.map((s) => s.toLowerCase())), [has]);
  const add = (v: string) => {
    const clean = v.replace(/\s+/g, " ").trim();
    if (clean && !skills.some((s) => s.toLowerCase() === clean.toLowerCase())) setSkills([...skills, clean].slice(0, 10));
    setDraft("");
  };
  const submit = async () => {
    setBusy(true); setErr("");
    const msgs: string[] = [];
    try {
      for (const s of skills) {
        const r = await crmPost(`/api/talent-pool/candidates/${candidateId}/skills`, { name: s });
        msgs.push(r.message || "");
      }
      onDone(skills.length === 1 ? msgs[0] : `${skills.length} skills added to ${name}`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add skills" onClose={onClose} medium dirty={skills.length > 0}
      hero={<DialogHero tone="sky" icon={Sparkles} eyebrow="Talent Pool" title={`Add skills to ${name}`}
        subtitle="Goes on the candidate's record — the pool finds them by it straight away. A skill the master list lacks is created." person={{ name }} />}>
      <div className="space-y-4">
        <DialogSection n={1} title="Skills" done={skills.length > 0} tone="sky">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {skills.map((s) => (
              <span key={s} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
                hasSet.has(s.toLowerCase()) ? "bg-surface-2 text-muted ring-subtle" : "bg-sky-600 text-white ring-sky-600"}`}>
                {s}{hasSet.has(s.toLowerCase()) && " (already)"}
                <button type="button" aria-label={`Remove ${s}`} onClick={() => setSkills(skills.filter((x) => x !== s))}><X size={11} /></button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input className={`${CONTROL} min-w-0 flex-1`} value={draft} list="tg-tag-suggest" placeholder="e.g. AUTOSAR, CAPL, Kotlin — Enter adds" autoComplete="off"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(draft); } }} />
            <button type="button" className={FLOW_BTN.primary} disabled={!draft.trim()} onClick={() => add(draft)}><Plus size={12} /> Add</button>
          </div>
          <datalist id="tg-tag-suggest">{suggestions.slice(0, 500).map((s) => <option key={s} value={s} />)}</datalist>
          {has.length > 0 && <p className="mt-2 text-xs text-muted">Already on record: {has.slice(0, 12).join(", ")}{has.length > 12 ? "…" : ""}</p>}
        </DialogSection>
        <DialogFailure message={err} />
        <DialogActions onCancel={onClose} busy={busy} tone="sky" icon={Plus} label={`Add ${skills.length || ""} skill${skills.length === 1 ? "" : "s"}`.replace("  ", " ")}
          disabled={!skills.length} onConfirm={submit} hint={!skills.length ? "Type a skill and press Enter" : undefined} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Check fit & apply (one candidate → many positions)
// ---------------------------------------------------------------------------

type FitMeta = { versions: ResumeVersion[]; good_fit_pct: number; summary: { positions: number; good_fit: number; applied: number } };

export function FitApplyDialog({ candidateId, name, onClose, onDone }: {
  candidateId: number; name: string; onClose: () => void; onDone: (message: string) => void;
}) {
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [meta, setMeta] = useState<FitMeta | null>(null);
  const [error, setError] = useState("");
  const [goodOnly, setGoodOnly] = useState(false);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Record<number, number | null>>({});
  const [applying, setApplying] = useState(false);
  const canApply = useCanApplyFromPool();

  useEffect(() => {
    crmGet<MatchRow[]>(`/api/candidates/${candidateId}/matching-positions`)
      .then((r) => { setRows(r.data || []); setMeta(r.meta as unknown as FitMeta); })
      .catch((e) => setError(e?.message || "Could not score the positions"));
  }, [candidateId]);

  const versionLabel = (id?: number | null) => meta?.versions.find((v) => v.id === id)?.label || "Main resume";
  const shown = (rows || []).filter((r) => (!goodOnly || r.good_fit)
    && (!q.trim() || `${r.title} ${r.opp_id} ${r.customer_name} ${r.location}`.toLowerCase().includes(q.trim().toLowerCase())));
  const chosen = (rows || []).filter((r) => r.requirement_id in picked);

  if (applying) {
    return <MultiApplyDialog candidateId={candidateId} candidateName={name} versionLabel={versionLabel}
      items={chosen.map((row) => ({ row, resumeId: picked[row.requirement_id] ?? row.best?.resume_id ?? null }))}
      onClose={() => setApplying(false)} onDone={onDone} />;
  }

  return (
    <Modal title="Check fit & apply" onClose={onClose} xl
      hero={<DialogHero tone="emerald" icon={Target} eyebrow="Talent Pool" title={`Where does ${name} fit?`}
        subtitle="Every open position scored against each of the candidate's resumes (the same ATS as Applied Candidates). Tick the ones to apply to."
        person={{ name }}
        chips={meta ? <>
          <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold">{meta.summary.positions} open positions</span>
          <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold">{meta.summary.good_fit} good fits (≥ {meta.good_fit_pct}%)</span>
          <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold">{meta.summary.applied} already applied</span>
        </> : null} />}
      footer={canApply ? (
        <DialogActions onCancel={onClose} tone="emerald" icon={Send} label={`Apply to ${chosen.length || ""} position${chosen.length === 1 ? "" : "s"}`.replace("  ", " ")}
          disabled={!chosen.length} onConfirm={() => setApplying(true)}
          hint={chosen.length ? `${chosen.length} ticked — each starts at Sourcing with the resume shown` : "Tick a position to apply"} />
      ) : <div className="flex justify-end"><button type="button" className={btnSecondary} onClick={onClose}>Close</button></div>}>
      <div className="space-y-3 p-1">
        {error ? <ErrorBox error={error} /> : !rows ? <Spinner label="Scoring every open position…" /> : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-[14rem] flex-1">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
                <input type="text" className={`${CONTROL} w-full pl-8`} placeholder="Position, customer, location" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
              <label className="flex items-center gap-2 text-sm text-secondary">
                <input type="checkbox" checked={goodOnly} onChange={(e) => setGoodOnly(e.target.checked)} /> Good fits only
              </label>
            </div>
            {shown.length === 0 ? <p className="rounded-card border border-dashed border-subtle p-6 text-center text-sm text-muted">No open position matches.</p> : (
              <ul className="space-y-2">
                {shown.map((r) => {
                  const on = r.requirement_id in picked;
                  const rid = picked[r.requirement_id] ?? r.best?.resume_id ?? null;
                  const score = r.scores.find((x) => x.resume_id === rid)?.score ?? r.best?.score ?? null;
                  return (
                    <li key={r.requirement_id} className={`rounded-card border p-3 transition ${on ? "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30" : "border-subtle bg-surface-1"}`}>
                      <div className="flex items-start gap-3">
                        {canApply && (
                          <input type="checkbox" className="mt-2" checked={on} disabled={!!r.applied} aria-label={`Apply to ${r.title}`}
                            onChange={(e) => setPicked((p) => { const n = { ...p }; if (e.target.checked) n[r.requirement_id] = r.best?.resume_id ?? null; else delete n[r.requirement_id]; return n; })} />
                        )}
                        <ScoreIndicator score={r.scorable ? score : null} size="md" showLabel={false} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <CrmLink to={`requirements/${r.requirement_id}`} className="text-sm font-bold text-primary hover:underline">{r.title}</CrmLink>
                            {r.good_fit && !r.applied && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">Good fit</span>}
                            {r.priority === "High" && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-800">High priority</span>}
                            {r.applied && (
                              <CrmLink to={`profiles/${r.applied.profile_id}`} className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200 hover:underline dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800">
                                Already applied · {r.applied.status || "open"}{r.applied.applied_by ? ` · ${r.applied.applied_by}` : ""}
                              </CrmLink>
                            )}
                          </div>
                          <div className="text-xs text-muted">
                            {[r.opp_id, r.customer_name, r.location, r.experience_min != null || r.experience_max != null ? `${r.experience_min ?? "?"}–${r.experience_max ?? "?"} yrs` : null,
                              r.budget_ctc_max ? `budget up to ${lakh(r.budget_ctc_max)}` : null].filter(Boolean).join(" · ")}
                          </div>
                          {!r.scorable && <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">This position has no skills or JD to score against yet.</div>}
                          {r.best && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {r.best.skills_matched.map((s) => <span key={s} className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800"><CheckCircle2 size={10} />{s}</span>)}
                              {r.best.skills_missing.map((s) => <span key={s} className="inline-flex items-center gap-0.5 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200 line-through decoration-rose-400 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-800">{s}</span>)}
                            </div>
                          )}
                          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                            {r.experience_fit != null && <span className={r.experience_fit ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>{r.experience_fit ? "✓ In the experience band" : "✗ Outside the experience band"}</span>}
                            {r.over_budget && <span className="font-semibold text-rose-700 dark:text-rose-300">Expects more than the budget</span>}
                          </div>
                        </div>
                        {on && meta && meta.versions.length > 1 && (
                          <select className={`${CONTROL} !w-44 text-xs`} value={rid ?? ""} aria-label="Resume to send"
                            onChange={(e) => setPicked((p) => ({ ...p, [r.requirement_id]: e.target.value ? Number(e.target.value) : null }))}>
                            {meta.versions.map((v) => <option key={v.id} value={v.id}>{v.label}{r.scores.find((x) => x.resume_id === v.id) ? ` · ${Math.round(r.scores.find((x) => x.resume_id === v.id)!.score)}%` : ""}</option>)}
                          </select>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Apply several people to one position
// ---------------------------------------------------------------------------

type ApplyOutcome = { candidate_id: number; name: string; ok: boolean; message: string; profile_id?: number };

/** Applies each person to one position through the candidate page's multi-apply
 *  (one request per person — each answers for itself). With no `requirement`
 *  the dialog asks which position first. */
export function ApplyPeopleDialog({ requirement, positions = [], people, onClose, onDone }: {
  requirement?: { id: number; req_number: string; title: string } | null;
  positions?: PoolPosition[];
  people: { candidate_id: number; name: string; resume_id?: number | null }[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reqId, setReqId] = useState<number | null>(requirement?.id ?? null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ApplyOutcome[] | null>(null);
  const target = requirement || (() => {
    const p = positions.find((x) => x.requirement_id === reqId);
    return p ? { id: p.requirement_id, req_number: p.req_number, title: p.title } : null;
  })();

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    const out: ApplyOutcome[] = [];
    for (const p of people) {
      try {
        const res = await crmPost<{ ok: boolean; message?: string; profile_id?: number }[]>(
          `/api/candidates/${p.candidate_id}/multi-apply`,
          { items: [{ requirement_id: target.id, resume_id: p.resume_id ?? null }], note: note.trim() || null },
        );
        const r = (res.data || [])[0];
        out.push({ candidate_id: p.candidate_id, name: p.name, ok: !!r?.ok, message: r?.message || res.message || "", profile_id: r?.profile_id });
      } catch (e: any) {
        out.push({ candidate_id: p.candidate_id, name: p.name, ok: false, message: e?.message || "Could not apply" });
      }
    }
    setResults(out);
    setBusy(false);
  };
  const okCount = results?.filter((r) => r.ok).length || 0;
  const doneMsg = `${okCount} applied${target ? ` to ${target.title}` : ""}`;

  return (
    <Modal title="Apply from the Talent Pool" onClose={results ? () => onDone(doneMsg) : onClose} medium
      hero={<DialogHero tone="emerald" icon={Send} eyebrow="Talent Pool"
        title={target ? `Apply ${people.length} to ${target.title}` : `Apply ${people.length} to a position`}
        subtitle={`${target ? `${target.req_number} · ` : ""}each application starts at Sourcing; the ATS scores the CV straight away.`}
        flow={{ steps: ["Pick people", "Apply", "Sourcing", "Technical Screening"], current: 1 }} />}>
      {!results ? (
        <div className="space-y-4">
          {!requirement && (
            <DialogSection n={1} title="Which position?" done={!!target} tone="emerald">
              <PositionSelect value={reqId} onChange={setReqId} positions={positions} emptyLabel="Pick a live position…" />
            </DialogSection>
          )}
          <DialogSection n={requirement ? 1 : 2} title="Who" done tone="emerald">
            <ul className="flex flex-wrap gap-1.5">
              {people.map((p) => <li key={p.candidate_id} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-primary ring-1 ring-inset ring-subtle">{p.name}</li>)}
            </ul>
          </DialogSection>
          <DialogSection n={requirement ? 2 : 3} title="Note on the applications" optional tone="emerald">
            <ReasonBox id="pool-note" label="Note" value={note} onChange={setNote} max={500} tone="emerald"
              placeholder="e.g. Found in the Talent Pool — strong AUTOSAR match"
              picks={["Found in the Talent Pool", "Spoke on the phone — interested", "Strong match on the must-have skills"]} />
          </DialogSection>
          <WhatHappens tone="emerald" items={[
            { icon: UserCheck, text: "Each person gets a Sourcing candidacy on this position, with you as the owner." },
            { icon: Award, text: "The ATS scores their CV against the position at once." },
            { icon: Send, text: "Send the opening email or Technical Screening from Applied Candidates as usual." },
          ]} />
          <DialogActions onCancel={onClose} busy={busy} tone="emerald" icon={Send} label={`Apply ${people.length}`}
            busyLabel="Applying…" onConfirm={submit} disabled={!target} hint={!target ? "Pick the position" : undefined} />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-secondary"><b className="text-primary">{okCount}</b> of {results.length} applied.</p>
          <ul className="divide-y divide-subtle rounded-control border border-subtle">
            {results.map((r) => (
              <li key={r.candidate_id} className="flex items-start justify-between gap-2 px-3 py-2 text-sm">
                <span className="inline-flex items-center gap-1.5 font-semibold text-primary">
                  {r.ok ? <CheckCircle2 size={14} className="text-emerald-600" /> : <XCircle size={14} className="text-rose-600" />}{r.name}
                </span>
                <span className={`text-right text-xs ${r.ok ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
                  {r.ok ? (r.profile_id ? <CrmLink to={`profiles/${r.profile_id}`} className="underline">Applied — open</CrmLink> : "Applied") : r.message}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end"><button type="button" className={FLOW_BTN.primary} onClick={() => onDone(doneMsg)}>Done</button></div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Groups mode
// ---------------------------------------------------------------------------

export function GroupsMode({ toast, openId, onOpen, onFindMore, skillSuggestions }: {
  toast: Toast;
  openId: number | null;
  onOpen: (id: number | null) => void;
  /** Search the pool with these skills (switches to Search). */
  onFindMore: (skills: GroupSkill[]) => void;
  skillSuggestions: string[];
}) {
  const { groups, positions, error, reload } = useGroupsList();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const shown = (groups || []).filter((g) => !q.trim()
    || `${g.name} ${g.position?.title || ""} ${g.position?.customer_name || ""} ${g.skills.map((s) => s.name).join(" ")}`.toLowerCase().includes(q.trim().toLowerCase()));
  const current = openId && groups ? groups.find((g) => g.id === openId) || null : null;
  // Open the most recently used group on arrival (or after the open one was deleted).
  useEffect(() => { if (groups?.length && !current) onOpen(groups[0].id); }, [groups, current, onOpen]);

  return (
    <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="space-y-2 self-start rounded-card border border-subtle bg-surface-1 p-3 shadow-raised lg:sticky lg:top-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-primary">Groups</h2>
          <button type="button" className={FLOW_BTN.success} onClick={() => setCreating(true)}><Plus size={12} /> New group</button>
        </div>
        <p className="text-xs text-muted">Shared shortlists — a group with a position scores its members against it.</p>
        {(groups?.length || 0) > 4 && <input className={`${CONTROL} w-full`} placeholder="Find a group" value={q} onChange={(e) => setQ(e.target.value)} />}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {!groups ? <Spinner label="Loading…" /> : groups.length === 0 ? (
          <div className="rounded-control border border-dashed border-subtle p-4 text-center text-xs text-muted">
            No groups yet. Make one here, or press <b>Add to group</b> on any candidate.
          </div>
        ) : (
          <ul className="max-h-[70vh] space-y-1.5 overflow-y-auto">
            {shown.map((g) => (
              <li key={g.id}>
                <button type="button" onClick={() => onOpen(g.id)} aria-current={openId === g.id}
                  className={`flex w-full items-start gap-2.5 rounded-control border p-2.5 text-left transition ${openId === g.id ? "border-brand-500 bg-brand-50 dark:bg-brand-900/30" : "border-transparent hover:bg-surface-2"}`}>
                  <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-xs font-bold text-white ${lookOf(g.color).grad}`}>{g.members}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-primary">{g.name}</span>
                    <span className="block truncate text-[11px] text-muted">{g.position ? `${g.position.opp_id || g.position.req_number} · ${g.position.title}` : "General shortlist"}</span>
                    {g.skills.length > 0 && <span className="block truncate text-[11px] text-secondary">{g.skills.map((s) => s.name).join(" · ")}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <div className="min-w-0">
        {current ? <GroupPage key={current.id} groupId={current.id} positions={positions} toast={toast} skillSuggestions={skillSuggestions}
          onChanged={() => void reload()} onDeleted={() => { onOpen(null); void reload(); }} onFindMore={onFindMore} />
          : (
            <div className="rounded-card border border-dashed border-subtle bg-surface-1 p-10 text-center text-sm text-secondary">
              <Users size={28} className="mx-auto text-muted" aria-hidden />
              <p className="mt-2 font-semibold text-primary">{groups?.length ? "Open a group to compare its candidates" : "Build your first shortlist"}</p>
              <p className="mt-1">A group gathers candidates for a skill set or a position. Its page shows who fits, who is available and who is already applied — and applies the rest in one go.</p>
            </div>
          )}
      </div>
      {creating && (
        <GroupEditDialog positions={positions} skillSuggestions={skillSuggestions} onClose={() => setCreating(false)}
          onSaved={(msg, id) => { setCreating(false); toast(msg); void reload(); if (id) onOpen(id); }} />
      )}
    </div>
  );
}

function GroupEditDialog({ group, positions, skillSuggestions, onClose, onSaved }: {
  group?: TalentGroup; positions: PoolPosition[]; skillSuggestions: string[];
  onClose: () => void; onSaved: (message: string, id?: number) => void;
}) {
  const [draft, setDraft] = useState<GroupDraft>(group
    ? { name: group.name, description: group.description || "", color: group.color, requirement_id: group.requirement_id, skills: group.skills }
    : EMPTY_GROUP);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const r = group ? await crmPut<TalentGroup>(`/api/talent-pool/groups/${group.id}`, draftBody(draft))
        : await crmPost<TalentGroup>("/api/talent-pool/groups", draftBody(draft));
      onSaved(r.message || "Saved", r.data?.id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={group ? "Edit group" : "New group"} onClose={onClose} medium dirty
      hero={<DialogHero tone="emerald" icon={Layers} eyebrow="Talent Pool" title={group ? `Edit “${group.name}”` : "New group"}
        subtitle="Name it after the skill set or the opening. Pick a position to score every member against it." />}>
      <div className="space-y-4">
        <GroupForm draft={draft} onChange={setDraft} positions={positions} skillSuggestions={skillSuggestions} />
        <DialogFailure message={err} />
        <DialogActions onCancel={onClose} busy={busy} tone="emerald" icon={CheckCircle2} label={group ? "Save group" : "Create group"}
          disabled={draft.name.trim().length < 3} onConfirm={save} hint={draft.name.trim().length < 3 ? "Name the group (3 characters or more)" : undefined} />
      </div>
    </Modal>
  );
}

function FitCell({ fit, pct }: { fit: Fit | null; pct: number }) {
  if (!fit) return <span className="text-xs text-muted">—</span>;
  if (!fit.scorable) return <span className="text-xs text-muted" title="No readable resume, or nothing to score against">Not scorable</span>;
  return (
    <div className="flex items-center gap-2">
      <ScoreIndicator score={fit.score} size="sm" showLabel={false} />
      <div className="min-w-0 text-[11px]">
        {fit.good_fit ? <span className="font-bold text-emerald-700 dark:text-emerald-300">Good fit</span>
          : <span className="text-muted">Below {pct}%</span>}
        {fit.skills_missing.length > 0 && <div className="truncate text-rose-700 dark:text-rose-300" title={fit.skills_missing.join(", ")}>Lacks {fit.skills_missing.slice(0, 2).join(", ")}{fit.skills_missing.length > 2 ? "…" : ""}</div>}
      </div>
    </div>
  );
}

const AVAIL_TONE: Record<string, string> = {
  available: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800",
  in_process: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800",
  bench: "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:ring-teal-800",
  deployed: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:ring-slate-700",
};

function GroupPage({ groupId, positions, toast, skillSuggestions, onChanged, onDeleted, onFindMore }: {
  groupId: number; positions: PoolPosition[]; toast: Toast; skillSuggestions: string[];
  onChanged: () => void; onDeleted: () => void; onFindMore: (skills: GroupSkill[]) => void;
}) {
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [meta, setMeta] = useState<GroupMeta | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [applying, setApplying] = useState<"group" | "other" | null>(null);
  const [fitFor, setFitFor] = useState<MemberRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<"all" | "available" | "fit" | "not_applied">("all");
  const canApply = useCanApplyFromPool();

  const load = useCallback(() => {
    setError("");
    return crmGet<MemberRow[]>(`/api/talent-pool/groups/${groupId}`)
      .then((r) => { setRows(r.data || []); setMeta(r.meta as unknown as GroupMeta); })
      .catch((e) => setError(e?.message || "Could not open the group"));
  }, [groupId]);
  useEffect(() => { void load(); }, [load]);

  const g = meta?.group;
  const pos = g?.position || null;
  const shown = (rows || []).filter((r) => filter === "all"
    || (filter === "available" && (r.availability === "available" || r.availability === "bench"))
    || (filter === "fit" && r.fit?.good_fit)
    || (filter === "not_applied" && !r.fit?.applied));
  const chosen = (rows || []).filter((r) => r.candidate_id && picked.has(r.candidate_id));
  const toggle = (id: number, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  const refresh = (msg: string) => { toast(msg); setPicked(new Set()); void load(); onChanged(); };

  const removeOne = async (r: MemberRow) => {
    try { const res = await crmDelete(`/api/talent-pool/groups/${groupId}/members/${r.candidate_id}`); refresh(res.message || "Removed"); }
    catch (e) { toast((e as Error).message, "err"); }
  };
  const removePicked = async () => {
    for (const r of chosen) { try { await crmDelete(`/api/talent-pool/groups/${groupId}/members/${r.candidate_id}`); } catch { /* reported below */ } }
    refresh(`${chosen.length} removed from the group`);
  };
  const deleteGroup = async () => {
    try { const res = await crmDelete(`/api/talent-pool/groups/${groupId}`); toast(res.message || "Deleted"); onDeleted(); }
    catch (e) { toast((e as Error).message, "err"); setDeleting(false); }
  };

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!rows || !meta || !g) return <Spinner label="Opening the group…" />;
  const s = meta.summary;
  const must = g.skills.filter((x) => x.must);
  const nice = g.skills.filter((x) => !x.must);

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className={`h-1.5 bg-gradient-to-r ${lookOf(g.color).grad}`} aria-hidden />
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-primary">{g.name}</h2>
              <p className="text-xs text-muted">Made by {g.created_by_name || "—"}{g.created_at ? ` · ${fmtDateShort(g.created_at)}` : ""}</p>
              {g.description && <p className="mt-1 max-w-3xl text-sm text-secondary">{g.description}</p>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={FLOW_BTN.edit} onClick={() => setEditing(true)}><Pencil size={12} /> Edit</button>
              {g.skills.length > 0 && <button type="button" className={FLOW_BTN.view} onClick={() => onFindMore(g.skills)}><Search size={12} /> Find more like this</button>}
              <button type="button" className={FLOW_BTN.success} onClick={() => setAdding(true)}><Plus size={12} /> Add people</button>
              {deleting ? (
                <span className="inline-flex items-center gap-1.5 text-xs">
                  <span className="font-semibold text-rose-700 dark:text-rose-300">Delete the group? Candidates stay in the pool.</span>
                  <button type="button" className={FLOW_BTN.delete} onClick={() => void deleteGroup()}>Delete</button>
                  <button type="button" className={FLOW_BTN.neutral} onClick={() => setDeleting(false)}>Keep</button>
                </span>
              ) : <button type="button" className={FLOW_BTN.danger} onClick={() => setDeleting(true)} aria-label="Delete group"><Trash2 size={12} /></button>}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="rounded-control bg-surface-2 p-3">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted">For position</div>
              {pos ? (
                <div className="mt-1 text-sm">
                  <CrmLink to={`requirements/${pos.requirement_id}?tab=resumes`} className="font-bold text-brand-700 hover:underline dark:text-brand-300">{pos.title}</CrmLink>
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${pos.open ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{pos.open ? "Open for sourcing" : pos.status || "Closed"}</span>
                  <div className="text-xs text-muted">
                    {[pos.opp_id || pos.req_number, pos.customer_name, pos.location,
                      pos.experience_min != null || pos.experience_max != null ? `${pos.experience_min ?? "?"}–${pos.experience_max ?? "?"} yrs` : null,
                      pos.budget_ctc_max ? `budget up to ${lakh(pos.budget_ctc_max)}` : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
              ) : <p className="mt-1 text-sm text-muted">General shortlist — <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => setEditing(true)}>link a position</button> to score members against it.</p>}
            </div>
            <div className="rounded-control bg-surface-2 p-3">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted">Skills</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {g.skills.length === 0 && <span className="text-xs text-muted">None set</span>}
                {must.map((x) => <span key={x.name} className="inline-flex items-center gap-0.5 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white"><Star size={9} className="fill-current" />{x.name}</span>)}
                {nice.map((x) => <span key={x.name} className="rounded-full bg-surface-1 px-2 py-0.5 text-[11px] font-semibold text-secondary ring-1 ring-inset ring-subtle">{x.name}</span>)}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
            {([
              ["all", `All · ${s.members}`],
              ["available", `Available now · ${s.available}`],
              ...(pos ? [["fit", `Good fit · ${s.good_fit}`], ["not_applied", `Not applied yet · ${s.members - s.applied}`]] : []),
            ] as [typeof filter, string][]).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${filter === k ? "bg-brand-600 text-white ring-brand-600" : "bg-surface-1 text-secondary ring-subtle hover:bg-surface-2"}`}>{label}</button>
            ))}
            <span className="ml-auto self-center text-xs text-muted">{s.all_must} hold every must-have{pos ? ` · ${s.applied} already applied` : ""}</span>
          </div>
        </div>
      </section>

      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-subtle bg-surface-1 p-8 text-center text-sm text-secondary">
          Nobody in this group yet. <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => setAdding(true)}>Add people</button>
          {g.skills.length > 0 && <> or <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => onFindMore(g.skills)}>search the pool for these skills</button></>}.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card border border-subtle bg-surface-1 shadow-raised">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-surface-2 text-left text-[11px] font-bold uppercase tracking-wide text-muted">
              <tr>
                <th className="w-8 px-3 py-2">
                  {canApply && <input type="checkbox" aria-label="Select all" checked={shown.length > 0 && shown.every((r) => r.candidate_id && picked.has(r.candidate_id))}
                    onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((r) => r.candidate_id!).filter(Boolean)) : new Set())} />}
                </th>
                <th className="px-3 py-2">Candidate</th>
                <th className="px-3 py-2">Experience</th>
                <th className="px-3 py-2">Notice · CTC</th>
                <th className="px-3 py-2">Group skills</th>
                {pos && <th className="px-3 py-2">Fit to the position</th>}
                {pos && <th className="px-3 py-2">On this position</th>}
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {shown.map((r) => {
                const email = r.email && !isPlaceholderEmail(r.email) ? r.email : null;
                const cv = fileViewHref(r.cv_url, `${r.name} CV`);
                return (
                  <tr key={r.key} className={r.candidate_id && picked.has(r.candidate_id) ? "bg-brand-50/60 dark:bg-brand-900/20" : "hover:bg-surface-2/60"}>
                    <td className="px-3 py-2 align-top">
                      {canApply && r.candidate_id && <input type="checkbox" aria-label={`Select ${r.name}`} checked={picked.has(r.candidate_id)} onChange={(e) => toggle(r.candidate_id!, e.target.checked)} />}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex items-start gap-2">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-indigo-600 text-[11px] font-bold text-white">{initials(r.name)}</span>
                        <div className="min-w-0">
                          <CrmLink to={`candidates/${r.candidate_id}`} className="font-bold text-primary hover:underline">{r.name}</CrmLink>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold ring-1 ring-inset ${AVAIL_TONE[r.availability] || ""}`}>{r.availability_label}</span>
                            {cv && <a href={cv} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-brand-600 hover:underline">CV</a>}
                          </div>
                          <div className="truncate text-[11px] text-muted">{email || r.phone || ""}</div>
                          {r.member.note && <div className="mt-0.5 max-w-[16rem] truncate text-[11px] italic text-secondary" title={r.member.note}>“{r.member.note}”</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top text-xs">
                      <div className="font-semibold text-primary">{r.experience_years != null ? `${r.experience_years} yrs` : "—"}</div>
                      {r.fit?.experience_fit != null && <div className={r.fit.experience_fit ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>{r.fit.experience_fit ? "✓ in band" : "✗ outside band"}</div>}
                      <div className="text-muted">{r.city || ""}</div>
                    </td>
                    <td className="px-3 py-2 align-top text-xs">
                      <div className="text-secondary">{r.notice_period || "Notice —"}</div>
                      <div>{lakh(r.current_ctc) || "—"} → <b className="text-primary">{lakh(r.expected_ctc) || "—"}</b></div>
                      {r.fit?.over_budget && <div className="font-semibold text-rose-700 dark:text-rose-300">Over budget</div>}
                    </td>
                    <td className="px-3 py-2 align-top text-xs">
                      {r.coverage.must_total + r.coverage.nice_total === 0 ? <span className="text-muted">No skills set</span> : (
                        <>
                          <div className={`font-semibold ${r.coverage.missing_must.length ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>
                            {r.coverage.must}/{r.coverage.must_total} must{r.coverage.nice_total ? ` · ${r.coverage.nice}/${r.coverage.nice_total} nice` : ""}
                          </div>
                          {r.coverage.missing_must.length > 0 && <div className="text-rose-700 dark:text-rose-300">Lacks {r.coverage.missing_must.join(", ")}</div>}
                          {r.matched.some((m) => m.proven) && <div className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-300"><Award size={10} /> proven in interview</div>}
                        </>
                      )}
                    </td>
                    {pos && <td className="px-3 py-2 align-top"><FitCell fit={r.fit} pct={meta.good_fit_pct} /></td>}
                    {pos && (
                      <td className="px-3 py-2 align-top text-xs">
                        {r.fit?.applied ? (
                          <CrmLink to={`profiles/${r.fit.applied.profile_id}`} className="font-semibold text-amber-700 hover:underline dark:text-amber-300">{r.fit.applied.status || "Applied"}</CrmLink>
                        ) : <span className="text-muted">Not applied</span>}
                      </td>
                    )}
                    <td className="px-3 py-2 align-top text-right">
                      <div className="flex justify-end gap-1">
                        {r.candidate_id && <button type="button" className={FLOW_BTN.primary} onClick={() => setFitFor(r)} title="Every open position scored against this candidate"><Target size={12} /> Fit</button>}
                        <button type="button" className={FLOW_BTN.neutral} aria-label={`Remove ${r.name} from the group`} title="Remove from the group" onClick={() => void removeOne(r)}><UserMinus size={12} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pos && rows.length > meta.fit_members && <p className="px-3 py-2 text-xs text-muted">The first {meta.fit_members} members are scored against the position.</p>}
        </div>
      )}

      {chosen.length > 0 && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-2 rounded-card border border-brand-300 bg-surface-1 px-4 py-2.5 shadow-overlay">
          <span className="text-sm font-semibold text-primary">{chosen.length} selected</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={FLOW_BTN.neutral} onClick={() => setPicked(new Set())}>Clear</button>
            <button type="button" className={FLOW_BTN.danger} onClick={() => void removePicked()}><UserMinus size={13} /> Remove</button>
            {canApply && <button type="button" className={FLOW_BTN.view} onClick={() => setApplying("other")}><Send size={13} /> Apply to another position…</button>}
            {canApply && pos?.open && (
              <button type="button" className={FLOW_BTN.success} onClick={() => setApplying("group")}><Send size={13} /> Apply {chosen.length} to {pos.title}</button>
            )}
          </div>
        </div>
      )}

      {editing && <GroupEditDialog group={g} positions={positions} skillSuggestions={skillSuggestions} onClose={() => setEditing(false)}
        onSaved={(m) => { setEditing(false); refresh(m); }} />}
      {applying && (
        <ApplyPeopleDialog
          requirement={applying === "group" && pos ? { id: pos.requirement_id, req_number: pos.req_number, title: pos.title } : null}
          positions={positions}
          people={(applying === "group" ? applicable(chosen) : chosen.filter((r) => r.candidate_id))
            .map((r) => ({ candidate_id: r.candidate_id!, name: r.name, resume_id: applying === "group" ? r.fit?.resume_id ?? null : null }))}
          onClose={() => setApplying(null)}
          onDone={(m) => { setApplying(null); refresh(m); }} />
      )}
      {fitFor?.candidate_id && <FitApplyDialog candidateId={fitFor.candidate_id} name={fitFor.name} onClose={() => setFitFor(null)}
        onDone={(m) => { setFitFor(null); refresh(m); }} />}
      {adding && <AddPeopleDialog groupId={groupId} groupName={g.name} onClose={() => setAdding(false)} onDone={(m) => { setAdding(false); refresh(m); }} />}
    </div>
  );
}

/** Find candidates by name / email / phone and add them to the group. */
function AddPeopleDialog({ groupId, groupName, onClose, onDone }: {
  groupId: number; groupName: string; onClose: () => void; onDone: (message: string) => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<PoolRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Map<number, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return; }
    const t = window.setTimeout(() => {
      setLoading(true);
      crmGet<PoolRow[]>(`/api/talent-pool${qs({ q: q.trim(), limit: 12, include_employees: "false" })}`)
        .then((r) => setRows((r.data || []).filter((x) => x.candidate_id)))
        .catch((e) => setErr(e?.message || "Search failed"))
        .finally(() => setLoading(false));
    }, 300);
    return () => window.clearTimeout(t);
  }, [q]);
  const submit = async () => {
    setBusy(true); setErr("");
    try { const r = await crmPost(`/api/talent-pool/groups/${groupId}/members`, { candidate_ids: [...picked.keys()] }); onDone(r.message || "Added"); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add people" onClose={onClose} medium
      hero={<DialogHero tone="emerald" icon={Users} eyebrow="Talent Pool" title={`Add people to “${groupName}”`} subtitle="Search by name, email, phone or domain." />}>
      <div className="space-y-3">
        <label className="relative block">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input className={`${CONTROL} w-full pl-8`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type at least 2 letters" aria-label="Search candidates" />
        </label>
        {picked.size > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {[...picked.entries()].map(([id, n]) => (
              <span key={id} className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white">{n}
                <button type="button" aria-label={`Remove ${n}`} onClick={() => setPicked((p) => { const m = new Map(p); m.delete(id); return m; })}><X size={11} /></button></span>
            ))}
          </div>
        )}
        {loading ? <Spinner label="Searching…" /> : (
          <ul className="max-h-72 divide-y divide-subtle overflow-y-auto rounded-control border border-subtle">
            {rows.length === 0 && <li className="p-3 text-center text-xs text-muted">{q.trim().length < 2 ? "Start typing to search the pool." : "Nobody found."}</li>}
            {rows.map((r) => (
              <li key={r.key}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-2">
                  <input type="checkbox" checked={picked.has(r.candidate_id!)} onChange={(e) => setPicked((p) => { const m = new Map(p); if (e.target.checked) m.set(r.candidate_id!, r.name); else m.delete(r.candidate_id!); return m; })} />
                  <span className="min-w-0 flex-1"><b className="text-primary">{r.name}</b> <span className="text-xs text-muted">{[r.experience_years != null ? `${r.experience_years} yrs` : null, r.city, r.technical_domain].filter(Boolean).join(" · ")}</span></span>
                  {r.groups?.some((x) => x.id === groupId) && <span className="text-[11px] text-muted">already in</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
        <DialogFailure message={err} />
        <DialogActions onCancel={onClose} busy={busy} tone="emerald" icon={Plus} label={`Add ${picked.size || ""}`.trim()} disabled={!picked.size} onConfirm={submit} />
      </div>
    </Modal>
  );
}
