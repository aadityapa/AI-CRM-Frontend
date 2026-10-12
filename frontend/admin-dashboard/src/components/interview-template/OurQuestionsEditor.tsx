/**
 * "We write the questions" — how RMG / GM set an AI interview's questions.
 *
 * Redesigned 12 Oct 2026 after the first test interview:
 *  - spoken questions go in BULK — type or paste them, one per line;
 *  - no "answer we expect" box for spoken questions — the AI judges the
 *    answer on its own knowledge of the topic (a reference answer stays
 *    optional for coding questions only);
 *  - the template decides HOW MANY spoken, pseudo-code and coding questions
 *    one interview asks. When the list holds more, every candidate gets a
 *    different random draw; when it holds fewer spoken ones, the AI can write
 *    the rest (medium level).
 *
 * Stored in the SAME `weights.skillBank` shape the server validates
 * (`services/interview/skill_bank.clean_config`): `spoken_count`,
 * `pseudo_count`, `coding_count` are the three numbers; `simplify()` keeps
 * them consistent with the list.
 */
import { useMemo, useState } from "react";
import {
  AlertTriangle, Braces, ChevronDown, ChevronUp, Code2, Copy, ListPlus, MessageSquareText,
  Minus, Plus, Shuffle, Sparkles, Trash2, Wand2,
} from "lucide-react";
import {
  bankProblems, bankSkills, newId, QuestionCard,
  type BankKind, type BankQuestion, type SkillBankConfig,
} from "./SkillBankEditor";

export const DEFAULT_SKILL = "General";
const SPOKEN_MIN = 2.5;
export const MAX_SPOKEN_ASK = 200;
export const MAX_PSEUDO_ASK = 20;
export const MAX_CODING_ASK = 10;

/** PURE: does this bank let the candidate choose skills (some skill not always-asked)? */
export function choosesSkills(c: SkillBankConfig): boolean {
  const skills = bankSkills(c);
  if (!skills.length) return false;
  const always = new Set(c.mandatory_skills.map((m) => m.trim().toLowerCase()));
  return skills.some((s) => !always.has(s.toLowerCase()));
}

export function haveByKind(c: SkillBankConfig): Record<BankKind, number> {
  const out = { normal: 0, pseudo: 0, coding: 0 } as Record<BankKind, number>;
  c.questions.forEach((q) => { out[q.kind] += 1; });
  return out;
}

/** PURE: how many of each kind ONE interview asks (what the candidate meets). */
export function askedByKind(c: SkillBankConfig): Record<BankKind, number> {
  const have = haveByKind(c);
  const spoken = c.spoken_count > 0 ? c.spoken_count : have.normal;
  return {
    normal: c.ai_fill ? spoken : Math.min(spoken, have.normal),
    pseudo: Math.min(c.pseudo_count, have.pseudo),
    coding: Math.min(c.coding_count, have.coding),
  };
}

/**
 * PURE: keep the bank consistent with what the author did.
 * - a question without a skill belongs to `fallbackSkill` (on save, `fill`);
 * - the three "ask" numbers stay within the list (spoken may go above it when
 *   the AI writes the rest); an "ask all" number keeps following the list as
 *   questions are added or removed (`prev` is the bank before the change);
 * - unless the candidate chooses, every skill is always asked (no picker).
 */
export function simplify(
  c: SkillBankConfig,
  opts: { chooseSkills: boolean; fallbackSkill?: string; fill?: boolean; prev?: SkillBankConfig },
): SkillBankConfig {
  const fallback = (opts.fallbackSkill || DEFAULT_SKILL).trim() || DEFAULT_SKILL;
  const filled = c.questions.map((q) => (q.skill.trim() ? q : { ...q, skill: fallback }));
  const questions = opts.fill ? filled : c.questions;
  const have = haveByKind(c);
  const prevHave = opts.prev ? haveByKind(opts.prev) : null;
  const follows = (asked: number, kind: BankKind) => !!prevHave && asked >= prevHave[kind];

  let spoken = c.spoken_count > 0 ? c.spoken_count : have.normal;
  if (opts.prev && follows(opts.prev.spoken_count > 0 ? opts.prev.spoken_count : prevHave!.normal, "normal")
      && !(opts.prev.ai_fill && opts.prev.spoken_count > prevHave!.normal)) {
    spoken = have.normal;
  }
  spoken = Math.max(0, Math.min(c.ai_fill ? MAX_SPOKEN_ASK : have.normal, spoken));
  if (!have.normal && !c.ai_fill) spoken = 0;
  let pseudo = opts.prev && follows(opts.prev.pseudo_count, "pseudo") ? have.pseudo : c.pseudo_count;
  let coding = opts.prev && follows(opts.prev.coding_count, "coding") ? have.coding : c.coding_count;
  pseudo = Math.max(0, Math.min(MAX_PSEUDO_ASK, have.pseudo, pseudo));
  coding = Math.max(0, Math.min(MAX_CODING_ASK, have.coding, coding));

  const perSkill = new Map<string, number>();
  filled.forEach((q) => {
    if (q.kind === "normal") perSkill.set(q.skill.trim().toLowerCase(), (perSkill.get(q.skill.trim().toLowerCase()) || 0) + 1);
  });
  const next: SkillBankConfig = {
    ...c,
    enabled: true,
    questions,
    spoken_count: spoken,
    // Kept for older servers that read the per-skill number.
    normal_per_skill: Math.min(50, Math.max(1, ...perSkill.values())),
    pseudo_count: pseudo,
    coding_count: coding,
  };
  const skills = bankSkills({ ...next, questions: filled });
  if (!opts.chooseSkills) {
    next.mandatory_skills = skills;
    next.pick_min = Math.max(1, Math.min(20, skills.length || 1));
    next.pick_max = next.pick_min;
  } else {
    const always = next.mandatory_skills.filter((m) => skills.some((s) => s.toLowerCase() === m.toLowerCase()));
    next.mandatory_skills = always.length === skills.length ? [] : always;
    next.pick_min = Math.max(1, Math.min(next.pick_min, skills.length || 1));
    next.pick_max = Math.max(next.pick_min, Math.min(next.pick_max, skills.length || 1));
  }
  return next;
}

/** PURE: one spoken question per line (numbering, bullets, "Q:" and blank
 *  lines are ignored; an older "A:" line is dropped). */
export function parseBulkQuestions(text: string, skill = ""): BankQuestion[] {
  const out: BankQuestion[] = [];
  const seen = new Set<string>();
  for (const raw of String(text || "").replace(/\r\n/g, "\n").split("\n")) {
    let line = raw.trim();
    if (!line) continue;
    if (/^(?:a(?:ns(?:wer)?)?\s*\d*\s*[:.)-])/i.test(line)) continue;
    line = line
      .replace(/^(?:q(?:uestion)?\s*\d*\s*[:.)-])\s*/i, "")
      .replace(/^(?:\(?\d{1,3}[.)\]]|[-*•●▪])\s*/, "")
      .trim();
    if (line.length < 3) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: newId(), skill, kind: "normal", text: line, expected: "" });
  }
  return out;
}

/** Older name kept for callers / tests written against it. */
export const parsePastedQuestions = (text: string, skill: string) => parseBulkQuestions(text, skill);

const field = "w-full rounded-control border border-subtle bg-surface-1 px-3 py-2 text-sm text-primary placeholder:text-muted focus:border-brand-500 focus:outline-none";

const KIND_LOOK: Record<BankKind, { label: string; plural: string; icon: React.ReactNode; tile: string; text: string }> = {
  normal: { label: "Spoken", plural: "Spoken questions", icon: <MessageSquareText size={18} aria-hidden />,
    tile: "from-sky-500 to-brand-600", text: "text-sky-700 dark:text-sky-300" },
  pseudo: { label: "Pseudo-code", plural: "Pseudo-code", icon: <Braces size={18} aria-hidden />,
    tile: "from-amber-500 to-orange-600", text: "text-amber-700 dark:text-amber-300" },
  coding: { label: "Coding", plural: "Coding", icon: <Code2 size={18} aria-hidden />,
    tile: "from-emerald-500 to-teal-600", text: "text-emerald-700 dark:text-emerald-300" },
};

function changeKind(q: BankQuestion, kind: BankKind): BankQuestion {
  if (q.kind === kind) return q;
  const next: BankQuestion = { ...q, kind };
  if (kind === "pseudo") {
    next.code = q.code || "";
    next.options = q.options && q.options.length ? q.options : ["", "", "", ""];
    next.language = "pseudo";
  }
  if (kind === "coding") {
    next.code = q.code || "";
    next.language = "any";
    next.languages = q.languages || [];
    next.starters = q.starters || {};
  }
  if (kind === "normal") next.expected = "";
  return next;
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)));
  return (
    <div className="inline-flex items-center overflow-hidden rounded-control border border-subtle bg-surface-1">
      <button type="button" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(clamp(value - 1))}
        className="grid h-9 w-9 place-items-center text-secondary hover:bg-surface-2 disabled:opacity-40"><Minus size={14} /></button>
      <input type="number" aria-label={label} value={value} min={min} max={max}
        onChange={(e) => onChange(clamp(Number(e.target.value) || 0))}
        className="h-9 w-14 border-x border-subtle bg-transparent text-center text-base font-extrabold tabular-nums text-primary focus:outline-none" />
      <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(clamp(value + 1))}
        className="grid h-9 w-9 place-items-center text-secondary hover:bg-surface-2 disabled:opacity-40"><Plus size={14} /></button>
    </div>
  );
}

function MixTile({ kind, asked, have, max, onChange, note }: {
  kind: BankKind; asked: number; have: number; max: number; onChange: (n: number) => void; note: React.ReactNode;
}) {
  const look = KIND_LOOK[kind];
  return (
    <div className="flex flex-col gap-3 rounded-card border border-subtle bg-surface-1 p-4">
      <div className="flex items-center gap-2.5">
        <span className={`grid h-9 w-9 place-items-center rounded-card bg-gradient-to-br ${look.tile} text-[#fff]`}>{look.icon}</span>
        <div className="min-w-0">
          <div className="text-sm font-extrabold text-primary">{look.plural}</div>
          <div className="text-[11px] text-muted">{have} in your list</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-secondary">Ask</span>
        <Stepper value={asked} min={0} max={max} onChange={onChange} label={`${look.label} questions to ask`} />
      </div>
      <div className="min-h-[2rem] text-[11px] leading-snug text-muted">{note}</div>
    </div>
  );
}

function SpokenRow({ q, index, skills, onChange, onRemove, onDuplicate, onMove, first, last }: {
  q: BankQuestion; index: number; skills: string[];
  onChange: (q: BankQuestion) => void; onRemove: () => void; onDuplicate: () => void;
  onMove: (dir: -1 | 1) => void; first: boolean; last: boolean;
}) {
  const listId = `skills-${q.id}`;
  return (
    <li id={`bankq-${q.id}`} className="group flex items-start gap-2 rounded-control border border-subtle bg-surface-1 px-2.5 py-2 hover:border-strong">
      <span className="mt-1.5 grid h-6 w-7 shrink-0 place-items-center rounded-full bg-sky-50 text-[11px] font-extrabold text-sky-700 dark:bg-sky-900/40 dark:text-sky-200">{index + 1}</span>
      <textarea rows={1} value={q.text} onChange={(e) => onChange({ ...q, text: e.target.value })} aria-label={`Spoken question ${index + 1}`}
        className="min-h-[36px] flex-1 resize-y rounded-control border border-transparent bg-transparent px-2 py-1.5 text-sm text-primary hover:border-subtle focus:border-brand-500 focus:bg-surface-1 focus:outline-none"
        placeholder="Type the question" />
      <input list={listId} value={q.skill} onChange={(e) => onChange({ ...q, skill: e.target.value })}
        placeholder="Skill (optional)" aria-label="Skill (optional)"
        className="mt-0.5 hidden h-8 w-36 rounded-control border border-subtle bg-surface-1 px-2 text-xs text-primary sm:block" />
      <datalist id={listId}>{skills.map((s) => <option key={s} value={s} />)}</datalist>
      <div className="mt-0.5 flex shrink-0 items-center opacity-70 group-hover:opacity-100">
        <button type="button" aria-label="Move up" disabled={first} onClick={() => onMove(-1)}
          className="grid h-8 w-7 place-items-center rounded text-muted hover:text-primary disabled:opacity-30"><ChevronUp size={14} /></button>
        <button type="button" aria-label="Move down" disabled={last} onClick={() => onMove(1)}
          className="grid h-8 w-7 place-items-center rounded text-muted hover:text-primary disabled:opacity-30"><ChevronDown size={14} /></button>
        <button type="button" onClick={onDuplicate} title="Duplicate" aria-label="Duplicate"
          className="grid h-8 w-7 place-items-center rounded text-muted hover:text-primary"><Copy size={13} /></button>
        <button type="button" onClick={onRemove} title="Remove" aria-label="Remove question"
          className="grid h-8 w-7 place-items-center rounded text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950"><Trash2 size={14} /></button>
      </div>
    </li>
  );
}

function TypedFooter({ q, onChange, onRemove, onDuplicate }: {
  q: BankQuestion; onChange: (q: BankQuestion) => void; onRemove: () => void; onDuplicate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-subtle bg-surface-2 px-4 py-2.5">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Type</span>
      <div role="radiogroup" aria-label="Question type" className="flex gap-1">
        {(["pseudo", "coding"] as BankKind[]).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={q.kind === k} onClick={() => onChange(changeKind(q, k))}
            className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-bold ring-1 ring-inset ${
              q.kind === k ? (k === "pseudo" ? "bg-amber-500 text-[#fff] ring-amber-500" : "bg-emerald-600 text-[#fff] ring-emerald-600")
                : "bg-surface-1 text-secondary ring-subtle"}`}>
            {k === "pseudo" ? <Braces size={13} aria-hidden /> : <Code2 size={13} aria-hidden />} {KIND_LOOK[k].label}
          </button>
        ))}
      </div>
<span className="flex-1" />
      <button type="button" onClick={onDuplicate} title="Duplicate" aria-label="Duplicate"
        className="grid h-7 w-7 place-items-center rounded-control text-muted hover:bg-surface-1 hover:text-primary"><Copy size={14} /></button>
      <button type="button" onClick={onRemove} title="Remove question" aria-label="Remove question"
        className="grid h-7 w-7 place-items-center rounded-control text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950"><Trash2 size={14} /></button>
    </div>
  );
}

export function OurQuestionsEditor({ value, onChange, suggestedSkills }: {
  value: SkillBankConfig;
  onChange: (next: SkillBankConfig) => void;
  suggestedSkills: string[];
}) {
  const fallbackSkill = suggestedSkills[0] || DEFAULT_SKILL;
  const [choose, setChoose] = useState<boolean>(() => choosesSkills(value));
  const [more, setMore] = useState<boolean>(() => choosesSkills(value));
  const [bulk, setBulk] = useState("");
  const commit = (next: SkillBankConfig, chooseNow = choose) =>
    onChange(simplify(next, { chooseSkills: chooseNow, fallbackSkill, prev: value }));
  // A number the author typed must not be "followed" back to the list size.
  const setCounts = (patch: Partial<SkillBankConfig>) =>
    onChange(simplify({ ...value, ...patch }, { chooseSkills: choose, fallbackSkill }));

  const skills = useMemo(() => {
    const list = bankSkills(value);
    suggestedSkills.forEach((s) => { if (s && !list.some((x) => x.toLowerCase() === s.toLowerCase())) list.push(s); });
    return list;
  }, [value, suggestedSkills]);

  const qs = value.questions;
  const have = haveByKind(value);
  const asked = askedByKind(value);
  const spokenAsk = value.spoken_count > 0 ? value.spoken_count : have.normal;
  const total = asked.normal + asked.pseudo + asked.coding;
  const minutes = Math.round(asked.normal * SPOKEN_MIN + asked.pseudo * value.pseudo_minutes + asked.coding * value.coding_minutes);
  const bulkParsed = useMemo(() => parseBulkQuestions(bulk), [bulk]);
  const errors = bankProblems(value).filter((p) => p.level === "error" && !/choose a skill/i.test(p.text));

  const spoken = qs.map((q, i) => ({ q, i })).filter(({ q }) => q.kind === "normal");
  const typed = qs.map((q, i) => ({ q, i })).filter(({ q }) => q.kind !== "normal");

  const addBulk = () => {
    if (!bulkParsed.length) return;
    const existing = new Set(qs.filter((q) => q.kind === "normal").map((q) => q.text.trim().toLowerCase()));
    const fresh = bulkParsed.filter((q) => !existing.has(q.text.trim().toLowerCase()));
    commit({ ...value, questions: [...qs, ...fresh] });
    setBulk("");
  };
  const addOne = (kind: BankKind) => {
    const q = changeKind({ id: newId(), skill: "", kind: "normal", text: "", expected: "" }, kind);
    commit({ ...value, questions: [...qs, q] });
    window.setTimeout(() => document.getElementById(`bankq-${q.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  };
  const update = (id: string, q: BankQuestion) => commit({ ...value, questions: qs.map((x) => (x.id === id ? q : x)) });
  const remove = (id: string) => commit({ ...value, questions: qs.filter((x) => x.id !== id) });
  const duplicate = (q: BankQuestion) => {
    const i = qs.findIndex((x) => x.id === q.id);
    commit({ ...value, questions: [...qs.slice(0, i + 1), { ...q, id: newId() }, ...qs.slice(i + 1)] });
  };
  const moveWithinKind = (id: string, dir: -1 | 1) => {
    const same = qs.filter((x) => x.kind === "normal");
    const pos = same.findIndex((x) => x.id === id);
    const other = same[pos + dir];
    if (!other) return;
    const a = qs.findIndex((x) => x.id === id);
    const b = qs.findIndex((x) => x.id === other.id);
    const next = [...qs];
    [next[a], next[b]] = [next[b], next[a]];
    commit({ ...value, questions: next });
  };
  const clearSpoken = () => {
    if (!spoken.length || !window.confirm(`Remove all ${spoken.length} spoken questions?`)) return;
    commit({ ...value, questions: qs.filter((q) => q.kind !== "normal") });
  };

  const spokenNote = (() => {
    if (!have.normal && !value.ai_fill) return "Add spoken questions below.";
    if (spokenAsk > have.normal) {
      return value.ai_fill
        ? <><Sparkles size={11} className="mr-0.5 inline text-violet-600" />The AI writes {spokenAsk - have.normal} more (medium level).</>
        : `Only ${have.normal} in your list — all of them are asked.`;
    }
    if (spokenAsk < have.normal) return <><Shuffle size={11} className="mr-0.5 inline" />Each candidate gets a different {spokenAsk} of your {have.normal}.</>;
    return "Every spoken question is asked.";
  })();
  const typedNote = (kind: "pseudo" | "coding") => {
    const n = kind === "pseudo" ? value.pseudo_count : value.coding_count;
    const h = have[kind];
    if (!h) return `None yet — add one below.`;
    if (!n) return "Not asked in this interview.";
    if (n < h) return <><Shuffle size={11} className="mr-0.5 inline" />A different {n} of {h} for each candidate · {kind === "pseudo" ? value.pseudo_minutes : value.coding_minutes} min each.</>;
    return `All ${h} asked · ${kind === "pseudo" ? value.pseudo_minutes : value.coding_minutes} min each.`;
  };

  return (
    <div className="space-y-4">
      {/* ---------- how many ---------- */}
      <section className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="flex flex-wrap items-end justify-between gap-3 bg-gradient-to-r from-brand-600 via-indigo-600 to-violet-600 px-5 py-4 text-[#fff]">
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-widest text-[#fff]/80">Step 1 · Each interview asks</div>
            <div className="mt-0.5 text-lg font-extrabold">How many questions of each kind</div>
            <div className="text-xs text-[#fff]/85">The AI asks them, listens, and scores every answer.</div>
          </div>
          <div className="flex items-baseline gap-3 rounded-card bg-[#fff]/15 px-4 py-2 ring-1 ring-inset ring-[#fff]/25">
            <span className="text-2xl font-black tabular-nums">{total}</span>
            <span className="text-xs font-semibold">questions · about {Math.max(1, minutes)} min</span>
          </div>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-3">
          <MixTile kind="normal" asked={spokenAsk} have={have.normal}
            max={value.ai_fill ? MAX_SPOKEN_ASK : have.normal}
            onChange={(n) => setCounts({ spoken_count: n })} note={spokenNote} />
          <MixTile kind="pseudo" asked={value.pseudo_count} have={have.pseudo} max={Math.min(MAX_PSEUDO_ASK, have.pseudo)}
            onChange={(n) => setCounts({ pseudo_count: n })} note={typedNote("pseudo")} />
          <MixTile kind="coding" asked={value.coding_count} have={have.coding} max={Math.min(MAX_CODING_ASK, have.coding)}
            onChange={(n) => setCounts({ coding_count: n })} note={typedNote("coding")} />
        </div>
        <label className="flex items-start gap-3 border-t border-subtle px-5 py-3">
          <input type="checkbox" className="mt-1" checked={value.ai_fill}
            onChange={(e) => onChange(simplify({ ...value, ai_fill: e.target.checked }, { chooseSkills: choose, fallbackSkill }))} />
          <span>
            <span className="block text-sm font-semibold text-primary"><Sparkles size={13} className="mr-1 inline text-violet-600" />Let the AI write extra spoken questions when my list is short</span>
            <span className="block text-xs text-muted">Then "Spoken" can be set higher than your list — the AI writes the rest at medium level from the job description and skills.</span>
          </span>
        </label>
      </section>

      {/* ---------- spoken, in bulk ---------- */}
      <section className="rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-card bg-gradient-to-br from-sky-500 to-brand-600 text-[#fff]"><MessageSquareText size={16} aria-hidden /></span>
            <div>
              <div className="text-sm font-extrabold text-primary">Step 2 · Spoken questions <span className="ml-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700 dark:bg-sky-900/40 dark:text-sky-200">{have.normal}</span></div>
              <div className="text-xs text-muted">The AI reads each one aloud; the candidate answers by speaking.</div>
            </div>
          </div>
          {spoken.length ? (
            <button type="button" onClick={clearSpoken} className="text-xs font-semibold text-rose-600 hover:underline">Remove all</button>
          ) : null}
        </div>
        <div className="space-y-3 p-4">
          <div className="rounded-card border-2 border-dashed border-brand-500/40 bg-brand-50/50 p-3 dark:bg-brand-900/20">
            <label htmlFor="bulkSpoken" className="flex items-center gap-1.5 text-xs font-bold text-secondary">
              <ListPlus size={14} className="text-brand-600" aria-hidden /> Add many at once — one question per line
            </label>
            <textarea id="bulkSpoken" rows={5} value={bulk} onChange={(e) => setBulk(e.target.value)} className={`${field} mt-2`}
              onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); addBulk(); } }}
              placeholder={"What is the difference between a mutex and a semaphore?\nExplain how CAN bus arbitration works.\nHow do you debug a hard fault on an ARM Cortex-M?\n\nPaste from Word or Excel — numbers and bullets are removed."} />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-secondary">
                {bulkParsed.length ? `${bulkParsed.length} question${bulkParsed.length === 1 ? "" : "s"} ready` : "Duplicates are skipped."}
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={() => addOne("normal")}
                  className="inline-flex items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-3 py-1.5 text-xs font-bold text-secondary hover:bg-surface-2">
                  <Plus size={14} /> One question
                </button>
                <button type="button" disabled={!bulkParsed.length} onClick={addBulk}
                  className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50">
                  <Plus size={14} /> Add {bulkParsed.length || ""} to the list
                </button>
              </div>
            </div>
          </div>

          {spoken.length ? (
            <ol className="max-h-[32rem] space-y-1.5 overflow-y-auto pr-1">
              {spoken.map(({ q }, n) => (
                <SpokenRow key={q.id} q={q} index={n} skills={skills} first={n === 0} last={n === spoken.length - 1}
                  onChange={(next) => update(q.id, next)} onRemove={() => remove(q.id)} onDuplicate={() => duplicate(q)}
                  onMove={(dir) => moveWithinKind(q.id, dir)} />
              ))}
            </ol>
          ) : (
            <div className="rounded-card border border-subtle bg-surface-2 px-4 py-6 text-center text-sm text-secondary">
              <Wand2 className="mx-auto mb-1.5 h-6 w-6 text-brand-600" aria-hidden />
              No spoken questions yet — type or paste them above.
            </div>
          )}
          <p className="text-[11px] text-muted">
            No model answer is needed: the AI judges each answer against what a strong engineer would say for that topic and the job's skills.
            The skill is optional — it only matters if candidates choose their skills (More options).
          </p>
        </div>
      </section>

      {/* ---------- typed ---------- */}
      <section className="rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-card bg-gradient-to-br from-amber-500 to-emerald-600 text-[#fff]"><Code2 size={16} aria-hidden /></span>
            <div>
              <div className="text-sm font-extrabold text-primary">Step 3 · Pseudo-code &amp; coding <span className="ml-1 text-xs font-semibold text-muted">(optional)</span></div>
              <div className="text-xs text-muted">Shown on screen. Pseudo-code: pick the right option. Coding: type the code — the AI checks it.</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => addOne("pseudo")}
              className="inline-flex items-center gap-1.5 rounded-control border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <Braces size={14} /> Add pseudo-code
            </button>
            <button type="button" onClick={() => addOne("coding")}
              className="inline-flex items-center gap-1.5 rounded-control border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              <Code2 size={14} /> Add coding
            </button>
          </div>
        </div>
        <div className="space-y-3 p-4">
          {typed.length ? typed.map(({ q }, n) => (
            <div key={q.id} id={`bankq-${q.id}`} className="overflow-hidden rounded-card border border-subtle">
              <QuestionCard q={q} index={n} skills={skills} onChange={(next) => update(q.id, next)} onRemove={() => remove(q.id)} />
              <TypedFooter q={q} onChange={(next) => update(q.id, next)}
                onRemove={() => remove(q.id)} onDuplicate={() => duplicate(q)} />
            </div>
          )) : (
            <div className="rounded-card border border-subtle bg-surface-2 px-4 py-5 text-center text-xs text-secondary">
              None — this interview is spoken questions only.
            </div>
          )}
        </div>
      </section>

      {errors.length ? (
        <div className="rounded-card border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
          <div className="flex items-center gap-2 font-bold"><AlertTriangle size={15} /> Fix before saving</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">{errors.slice(0, 6).map((p, i) => <li key={i}>{p.text.replace(/^.*?question (\d+)/, "Question $1")}</li>)}</ul>
        </div>
      ) : null}

      {/* ---------- more options ---------- */}
      <div className="rounded-card border border-subtle bg-surface-1">
        <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
          <span>
            <span className="block text-sm font-bold text-primary">More options</span>
            <span className="block text-xs text-muted">Let the candidate choose skills · minutes per typed question</span>
          </span>
          {more ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
        </button>
        {more ? (
          <div className="space-y-4 border-t border-subtle px-4 py-4">
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1" checked={choose} onChange={(e) => {
                setChoose(e.target.checked);
                commit(value, e.target.checked);
              }} />
              <span>
                <span className="block text-sm font-semibold text-primary">Let the candidate choose the skills they know</span>
                <span className="block text-xs text-muted">Off: questions come from the whole list. On: the candidate ticks skills at the start and the questions come from those skills only. Give each question a skill.</span>
              </span>
            </label>
            {choose ? (
              <div className="ml-7 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-secondary">
                  Candidate picks
                  <input type="number" min={1} max={Math.max(1, bankSkills(value).length)} value={value.pick_min}
                    onChange={(e) => commit({ ...value, pick_min: Number(e.target.value) || 1 })}
                    className="h-8 w-14 rounded-control border border-subtle bg-surface-1 px-2 text-center text-sm" aria-label="Minimum skills" />
                  to
                  <input type="number" min={1} max={Math.max(1, bankSkills(value).length)} value={value.pick_max}
                    onChange={(e) => commit({ ...value, pick_max: Number(e.target.value) || 1 })}
                    className="h-8 w-14 rounded-control border border-subtle bg-surface-1 px-2 text-center text-sm" aria-label="Maximum skills" />
                  skills.
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-secondary">Always asked:</span>
                  {bankSkills(value).map((s) => {
                    const on = value.mandatory_skills.some((m) => m.toLowerCase() === s.toLowerCase());
                    return (
                      <button key={s} type="button" aria-pressed={on}
                        onClick={() => commit({ ...value, mandatory_skills: on ? value.mandatory_skills.filter((m) => m.toLowerCase() !== s.toLowerCase()) : [...value.mandatory_skills, s] })}
                        className={`h-7 rounded-full px-2.5 text-[11px] font-bold ring-1 ring-inset ${on ? "bg-indigo-600 text-[#fff] ring-indigo-600" : "bg-surface-1 text-secondary ring-subtle"}`}>
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-4 text-xs text-secondary">
              <label className="flex items-center gap-2">Minutes per pseudo-code question
                <input type="number" min={1} max={10} value={value.pseudo_minutes}
                  onChange={(e) => onChange({ ...value, pseudo_minutes: Math.max(1, Math.min(10, Number(e.target.value) || 2)) })}
                  className="h-8 w-14 rounded-control border border-subtle bg-surface-1 px-2 text-center text-sm" />
              </label>
              <label className="flex items-center gap-2">Minutes per coding question
                <input type="number" min={2} max={45} value={value.coding_minutes}
                  onChange={(e) => onChange({ ...value, coding_minutes: Math.max(2, Math.min(45, Number(e.target.value) || 10)) })}
                  className="h-8 w-14 rounded-control border border-subtle bg-surface-1 px-2 text-center text-sm" />
              </label>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** PURE: the bank as saved — blank skills filled, counts kept within the list,
 *  the candidate-chooses setting read from the bank itself. */
export function finalizeBank(c: SkillBankConfig, fallbackSkill: string): SkillBankConfig {
  if (!c.enabled) return c;
  const fallback = (fallbackSkill || DEFAULT_SKILL).trim() || DEFAULT_SKILL;
  const filled = { ...c, questions: c.questions.map((q) => (q.skill.trim() ? q : { ...q, skill: fallback })) };
  return simplify(filled, { chooseSkills: choosesSkills(filled), fallbackSkill: fallback, fill: true });
}

/** PURE: the questions ONE interview asks — the template's question count. */
export function bankQuestionTotal(c: SkillBankConfig): number {
  const a = askedByKind(c);
  return a.normal + a.pseudo + a.coding;
}
