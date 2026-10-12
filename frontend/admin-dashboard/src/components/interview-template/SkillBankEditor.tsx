/**
 * Skill-wise question bank on an interview template (10 Oct 2026).
 *
 * RMG / GM write the position's OWN questions, per skill (HR does not author
 * templates — 11 Oct 2026), in three kinds:
 *   - Normal       — spoken question + the expected answer (asked aloud).
 *   - Pseudo-code  — a snippet + 2-6 options + the correct one, optionally
 *                    "partly right" options that earn part of the marks (shown
 *                    on screen, the candidate clicks an option; marked without AI).
 *   - Coding       — an easy problem + a reference solution (shown on screen,
 *                    the candidate types code in an editor).
 * At the start the candidate ticks the skills they have worked on (skills marked
 * "Always asked" are locked) and only those skills' questions are asked, theory
 * first with the pseudo-code / coding questions in between. A skill short of
 * spoken questions is topped up by the AI at medium level (`ai_fill`).
 *
 * Saved as `weights.skillBank`; the server validates it
 * (`services/interview/skill_bank.clean_config`) — keep the key names in step.
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle, Braces, Check, ChevronRight, Clock, Code2, Lock, MessageSquareText, Minus, Plus, Sparkles,
  Trash2, Unlock, Layers,
} from "lucide-react";

export type BankKind = "normal" | "pseudo" | "coding";

export type BankQuestion = {
  id: string;
  skill: string;
  kind: BankKind;
  text: string;
  expected?: string;
  code?: string;
  language?: string;
  options?: string[];
  correct?: number;
  /** Pseudo-code: options that are partly right and earn `partial_credit` %. */
  partial?: number[];
  partial_credit?: number;
  /** Coding: the languages the candidate may answer in (empty = any). */
  languages?: string[];
  /** Coding: starter code per language (optional). */
  starters?: Record<string, string>;
};

export type SkillBankConfig = {
  enabled: boolean;
  coding_count: number;
  pseudo_count: number;
  normal_per_skill: number;
  /** Spoken questions per interview in total (0 = `normal_per_skill` per skill). */
  spoken_count: number;
  coding_minutes: number;
  pseudo_minutes: number;
  pick_min: number;
  pick_max: number;
  /** A picked skill short of spoken questions is topped up by the AI (medium level). */
  ai_fill: boolean;
  mandatory_skills: string[];
  questions: BankQuestion[];
};

/** The user's numbers: 1 coding, 2 pseudo-code, the rest normal. */
export const SKILL_BANK_DEFAULTS: SkillBankConfig = {
  enabled: false,
  coding_count: 1,
  pseudo_count: 2,
  normal_per_skill: 2,
  spoken_count: 0,
  coding_minutes: 10,
  pseudo_minutes: 2,
  pick_min: 2,
  pick_max: 5,
  ai_fill: true,
  mandatory_skills: [],
  questions: [],
};

/** Coding languages (12 Oct 2026: automotive + Android hiring). Keys mirror the
 *  server's `skill_bank.CODE_LANGUAGES` and the candidate editor's list. */
export const CODE_LANGUAGES: { value: string; label: string; group: string }[] = [
  { value: "c", label: "C", group: "Embedded & automotive" },
  { value: "embedded_c", label: "Embedded C", group: "Embedded & automotive" },
  { value: "cpp", label: "C++", group: "Embedded & automotive" },
  { value: "capl", label: "CAPL (CANoe)", group: "Embedded & automotive" },
  { value: "matlab", label: "MATLAB", group: "Embedded & automotive" },
  { value: "asm", label: "Assembly", group: "Embedded & automotive" },
  { value: "rust", label: "Rust", group: "Embedded & automotive" },
  { value: "kotlin", label: "Kotlin (Android)", group: "Android & mobile" },
  { value: "java", label: "Java", group: "Android & mobile" },
  { value: "swift", label: "Swift", group: "Android & mobile" },
  { value: "python", label: "Python", group: "General & web" },
  { value: "javascript", label: "JavaScript", group: "General & web" },
  { value: "typescript", label: "TypeScript", group: "General & web" },
  { value: "csharp", label: "C#", group: "General & web" },
  { value: "go", label: "Go", group: "General & web" },
  { value: "sql", label: "SQL", group: "General & web" },
  { value: "shell", label: "Shell / Bash", group: "General & web" },
];
export const LANGUAGES: { value: string; label: string }[] = [
  { value: "any", label: "Any language" },
  ...CODE_LANGUAGES.map(({ value, label }) => ({ value, label })),
];
/** The languages a pseudo-code snippet can be coloured as. */
export const SNIPPET_LANGUAGES: { value: string; label: string }[] = [
  { value: "pseudo", label: "Pseudo-code" },
  ...CODE_LANGUAGES.map(({ value, label }) => ({ value, label })),
];
export function languageName(key: string | undefined): string {
  if (!key) return "";
  return LANGUAGES.find((l) => l.value === key)?.label || SNIPPET_LANGUAGES.find((l) => l.value === key)?.label || key;
}

const KIND_LOOK: Record<BankKind, { label: string; short: string; tone: string; chip: string; icon: ReactNode }> = {
  normal: {
    label: "Spoken question", short: "Spoken", tone: "from-sky-500 to-indigo-600",
    chip: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800",
    icon: <MessageSquareText size={14} aria-hidden />,
  },
  pseudo: {
    label: "Pseudo-code question", short: "Pseudo-code", tone: "from-amber-500 to-orange-600",
    chip: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800",
    icon: <Braces size={14} aria-hidden />,
  },
  coding: {
    label: "Coding problem", short: "Coding", tone: "from-emerald-500 to-teal-600",
    chip: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800",
    icon: <Code2 size={14} aria-hidden />,
  },
};

const LETTERS = "ABCDEF";
export const PARTIAL_CREDIT_DEFAULT = 50;
const PARTIAL_CREDIT_CHOICES = [25, 50, 75];
const SPOKEN_MINUTES_EACH = 2.5;

function num(v: unknown, d: number, lo: number, hi: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 12);
}

/** PURE: read the saved bank (missing = off with the defaults). */
export function skillBankFromWeights(weights: unknown): SkillBankConfig {
  const raw = weights && typeof weights === "object" ? (weights as Record<string, unknown>).skillBank : null;
  const c = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = SKILL_BANK_DEFAULTS;
  const questions = Array.isArray(c.questions)
    ? (c.questions as Record<string, unknown>[]).map((q) => ({
        id: String(q.id || newId()),
        skill: String(q.skill || ""),
        kind: (["normal", "pseudo", "coding"].includes(String(q.kind)) ? q.kind : "normal") as BankKind,
        text: String(q.text || ""),
        expected: q.expected == null ? "" : String(q.expected),
        code: q.code == null ? "" : String(q.code),
        language: q.language == null ? "" : String(q.language),
        options: Array.isArray(q.options) ? (q.options as unknown[]).map(String) : undefined,
        correct: q.correct == null ? undefined : Number(q.correct),
        partial: Array.isArray(q.partial) ? (q.partial as unknown[]).map(Number).filter((n) => Number.isFinite(n)) : undefined,
        partial_credit: q.partial_credit == null ? undefined : Number(q.partial_credit),
        languages: Array.isArray(q.languages) ? (q.languages as unknown[]).map(String) : undefined,
        starters: q.starters && typeof q.starters === "object"
          ? Object.fromEntries(Object.entries(q.starters as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]))
          : undefined,
      }))
    : [];
  return {
    enabled: c.enabled === true || String(c.enabled).toLowerCase() === "true",
    coding_count: num(c.coding_count, d.coding_count, 0, 10),
    pseudo_count: num(c.pseudo_count, d.pseudo_count, 0, 20),
    normal_per_skill: num(c.normal_per_skill, d.normal_per_skill, 0, 50),
    spoken_count: num(c.spoken_count, d.spoken_count, 0, 200),
    coding_minutes: num(c.coding_minutes, d.coding_minutes, 2, 45),
    pseudo_minutes: num(c.pseudo_minutes, d.pseudo_minutes, 1, 10),
    pick_min: num(c.pick_min, d.pick_min, 1, 20),
    pick_max: num(c.pick_max, d.pick_max, 1, 20),
    ai_fill: c.ai_fill == null ? d.ai_fill : c.ai_fill === true || String(c.ai_fill).toLowerCase() === "true",
    mandatory_skills: Array.isArray(c.mandatory_skills) ? (c.mandatory_skills as unknown[]).map(String) : [],
    questions,
  };
}

/** PURE: the object saved under `weights.skillBank`. */
export function skillBankToWeights(c: SkillBankConfig): Record<string, unknown> {
  return {
    ...c,
    pick_max: Math.max(c.pick_min, c.pick_max),
    questions: c.questions.map((q) => {
      const base: Record<string, unknown> = { id: q.id, skill: q.skill.trim(), kind: q.kind, text: q.text.trim() };
      if (q.kind === "normal") base.expected = (q.expected || "").trim();
      if (q.kind === "pseudo") {
        base.code = q.code || "";
        base.options = (q.options || []).map((o) => o.trim()).filter(Boolean);
        base.correct = q.correct ?? -1;
        const partial = (q.partial || []).filter((i) => i !== q.correct);
        if (partial.length) {
          base.partial = partial;
          base.partial_credit = num(q.partial_credit, PARTIAL_CREDIT_DEFAULT, 10, 90);
        }
        base.expected = (q.expected || "").trim();
        base.language = q.language || "pseudo";
      }
      if (q.kind === "coding") {
        base.code = q.code || "";
        base.expected = (q.expected || "").trim();
        base.language = q.language || "any";
        const langs = (q.languages || []).filter((l) => CODE_LANGUAGES.some((c) => c.value === l));
        if (langs.length) base.languages = langs;
        const starters = Object.fromEntries(
          Object.entries(q.starters || {}).filter(([k, v]) => v.trim() && (!langs.length || langs.includes(k))),
        );
        if (Object.keys(starters).length) base.starters = starters;
      }
      return base;
    }),
  };
}

export type BankProblem = { level: "error" | "warn"; text: string };

/** PURE: what stops the bank from saving (error) or will surprise the author (warn). */
export function bankProblems(c: SkillBankConfig): BankProblem[] {
  if (!c.enabled) return [];
  const out: BankProblem[] = [];
  if (!c.questions.length) out.push({ level: "error", text: "Add at least one question." });
  c.questions.forEach((q, i) => {
    const where = `${q.skill || "No skill"} · question ${i + 1}`;
    if (!q.skill.trim()) out.push({ level: "error", text: `${where}: choose a skill.` });
    if (!q.text.trim()) out.push({ level: "error", text: `${where}: the question is empty.` });
    if (q.kind === "pseudo") {
      const opts = (q.options || []).filter((o) => o.trim());
      if (!(q.code || "").trim()) out.push({ level: "error", text: `${where}: add the pseudo-code.` });
      if (opts.length < 2) out.push({ level: "error", text: `${where}: add at least 2 options.` });
      if (q.correct == null || q.correct < 0 || q.correct >= opts.length)
        out.push({ level: "error", text: `${where}: mark the correct option.` });
    }
    if (q.kind === "coding" && !(q.expected || "").trim())
      out.push({ level: "warn", text: `${where}: no reference solution — add one for fairer scoring.` });
  });
  const kinds = { pseudo: 0, coding: 0 };
  c.questions.forEach((q) => { if (q.kind !== "normal") kinds[q.kind] += 1; });
  if (c.coding_count > kinds.coding)
    out.push({ level: "warn", text: `Settings ask for ${c.coding_count} coding question(s) but the bank has ${kinds.coding}.` });
  if (c.pseudo_count > kinds.pseudo)
    out.push({ level: "warn", text: `Settings ask for ${c.pseudo_count} pseudo-code question(s) but the bank has ${kinds.pseudo}.` });
  const skills = bankSkills(c);
  c.mandatory_skills.forEach((m) => {
    if (!skills.some((s) => s.toLowerCase() === m.toLowerCase()))
      out.push({ level: "warn", text: `"${m}" is marked always asked but has no questions.` });
  });
  if (!c.ai_fill && !c.spoken_count) {
    skills.forEach((sk) => {
      const n = c.questions.filter((q) => q.kind === "normal" && q.skill.trim().toLowerCase() === sk.toLowerCase()).length;
      if (n < c.normal_per_skill)
        out.push({ level: "warn", text: `${sk}: ${n} spoken question(s), settings ask for ${c.normal_per_skill} — turn on AI top-up or add more.` });
    });
  }
  if (skills.length && c.pick_min > skills.length)
    out.push({ level: "warn", text: `Candidates must pick ${c.pick_min} skills but only ${skills.length} have questions.` });
  return out;
}

export function bankSkills(c: SkillBankConfig): string[] {
  const seen = new Map<string, string>();
  c.questions.forEach((q) => { const k = q.skill.trim().toLowerCase(); if (k && !seen.has(k)) seen.set(k, q.skill.trim()); });
  return [...seen.values()];
}

/** PURE: roughly how long the interview runs when the candidate picks `picks` skills. */
export function spokenAsked(c: SkillBankConfig, picks: number): number {
  return c.spoken_count > 0 ? c.spoken_count : Math.max(0, picks) * c.normal_per_skill;
}

export function estimateMinutes(c: SkillBankConfig, picks: number): number {
  const spoken = spokenAsked(c, picks) * SPOKEN_MINUTES_EACH;
  return Math.round(1 + spoken + c.pseudo_count * c.pseudo_minutes + c.coding_count * c.coding_minutes);
}

/** PURE: the order a candidate would meet the questions — theory first, the
 *  typed ones in between (mirrors the server's `skill_bank.interleave`). */
export function sampleOrder(c: SkillBankConfig, picks: number): BankKind[] {
  const n = spokenAsked(c, picks);
  const pseudo = c.pseudo_count;
  const lead = Math.floor((pseudo + 1) / 2);
  const typed: BankKind[] = [
    ...Array<BankKind>(lead).fill("pseudo"),
    ...Array<BankKind>(c.coding_count).fill("coding"),
    ...Array<BankKind>(pseudo - lead).fill("pseudo"),
  ];
  const t = typed.length;
  if (!t) return Array<BankKind>(n).fill("normal");
  if (!n) return typed;
  const cuts = typed.map((_, j) => Math.max(1, Math.min(Math.floor(((j + 1) * n) / (t + 1) + 0.5), n > 1 ? n - 1 : 1)));
  const out: BankKind[] = [];
  let ti = 0;
  for (let i = 1; i <= n; i += 1) {
    out.push("normal");
    while (ti < t && cuts[ti] === i) { out.push(typed[ti]); ti += 1; }
  }
  while (ti < t) { out.push(typed[ti]); ti += 1; }
  return out;
}

/** PURE: how many of a kind the interview needs vs. how many the bank holds. */
export function kindNeed(c: SkillBankConfig, kind: BankKind): { have: number; need: number; short: number } {
  const have = c.questions.filter((q) => q.kind === kind).length;
  const need = kind === "pseudo" ? c.pseudo_count : kind === "coding" ? c.coding_count : 0;
  return { have, need, short: Math.max(0, need - have) };
}

const field = "w-full rounded-control border border-subtle bg-surface-1 px-3 py-2 text-sm text-primary";
const mono = "w-full rounded-control border border-subtle bg-slate-950 px-3 py-2 font-mono text-[13px] leading-5 text-emerald-100";
const sel = "h-9 rounded-control border border-subtle bg-surface-1 px-2 text-sm text-primary";

function NumberField({ label, value, onChange, min, max, suffix, hint }: {
  label: string; value: number; onChange: (n: number) => void; min: number; max: number; suffix?: string; hint?: string;
}) {
  return (
    <label className="block rounded-card border border-subtle bg-surface-1 p-3">
      <span className="block text-[11px] font-bold uppercase tracking-wider text-muted">{label}</span>
      <span className="mt-1.5 flex items-center gap-2">
        <button type="button" aria-label={`Decrease ${label}`} onClick={() => onChange(num(value - 1, value, min, max))}
          className="grid h-8 w-8 place-items-center rounded-control border border-subtle bg-surface-2 text-secondary"><Minus size={14} /></button>
        <input type="number" min={min} max={max} value={value} aria-label={label}
          onChange={(e) => onChange(num(e.target.value, value, min, max))}
          className="h-8 w-14 rounded-control border border-subtle bg-surface-1 px-2 text-center text-sm font-bold text-primary" />
        <button type="button" aria-label={`Increase ${label}`} onClick={() => onChange(num(value + 1, value, min, max))}
          className="grid h-8 w-8 place-items-center rounded-control border border-subtle bg-surface-2 text-secondary"><Plus size={14} /></button>
        {suffix ? <span className="text-xs font-semibold text-secondary">{suffix}</span> : null}
      </span>
      {hint ? <span className="mt-1 block text-[11px] text-muted">{hint}</span> : null}
    </label>
  );
}

function SkillSelect({ value, skills, onChange }: { value: string; skills: string[]; onChange: (s: string) => void }) {
  const list = value && !skills.some((s) => s.toLowerCase() === value.toLowerCase()) ? [value, ...skills] : skills;
  return (
    <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-secondary">
      Skill
      <select value={value} onChange={(e) => onChange(e.target.value)} className={sel} aria-label="Skill">
        {!value ? <option value="">Choose a skill</option> : null}
        {list.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </label>
  );
}

const LANG_PRESETS: { label: string; langs: string[] }[] = [
  { label: "Embedded", langs: ["c", "embedded_c", "cpp"] },
  { label: "Automotive tools", langs: ["capl", "matlab", "python"] },
  { label: "Android", langs: ["kotlin", "java"] },
  { label: "Backend", langs: ["java", "python", "csharp", "go"] },
];

function CodingLanguages({ q, set }: { q: BankQuestion; set: (patch: Partial<BankQuestion>) => void }) {
  const any = !(q.languages && q.languages.length);
  const langs = q.languages || [];
  const toggle = (l: string) => {
    const next = langs.includes(l) ? langs.filter((x) => x !== l) : [...langs, l];
    const def = q.language && q.language !== "any" && !next.includes(q.language) ? (next[0] || "any") : q.language;
    set({ languages: next, language: next.length ? def : "any" });
  };
  const groups = [...new Set(CODE_LANGUAGES.map((l) => l.group))];
  return (
    <div className="rounded-card border border-subtle bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-secondary">Candidate can answer in</span>
        <button type="button" aria-pressed={any} onClick={() => set({ languages: [], language: "any" })}
          className={`h-7 rounded-full px-2.5 text-[11px] font-bold ring-1 ring-inset ${any ? "bg-emerald-600 text-[#fff] ring-emerald-600" : "bg-surface-1 text-secondary ring-subtle"}`}>
          Any language
        </button>
        <span className="text-[11px] text-muted">or pick:</span>
        {LANG_PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => set({ languages: p.langs, language: p.langs[0] })}
            className="h-7 rounded-full bg-surface-1 px-2.5 text-[11px] font-bold text-indigo-700 ring-1 ring-inset ring-indigo-200 dark:text-indigo-300 dark:ring-indigo-800">
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-2 space-y-1.5">
        {groups.map((g) => (
          <div key={g} className="flex flex-wrap items-center gap-1.5">
            <span className="w-40 shrink-0 text-[11px] font-semibold text-muted">{g}</span>
            {CODE_LANGUAGES.filter((l) => l.group === g).map((l) => {
              const on = langs.includes(l.value);
              return (
                <button key={l.value} type="button" aria-pressed={on} onClick={() => toggle(l.value)}
                  className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-bold ring-1 ring-inset ${on ? "bg-indigo-600 text-[#fff] ring-indigo-600" : "bg-surface-1 text-secondary ring-subtle"}`}>
                  {on ? <Check size={11} aria-hidden /> : null}{l.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        {any ? "Every supported language is offered — the candidate picks one in the editor." : `${langs.length} language(s) offered. The AI checks the code in the language the candidate picked.`}
      </p>
    </div>
  );
}

function StarterCode({ q, set }: { q: BankQuestion; set: (patch: Partial<BankQuestion>) => void }) {
  const offered = q.languages && q.languages.length ? q.languages : [q.language && q.language !== "any" ? q.language : "c"];
  const [active, setActive] = useState(offered[0]);
  const cur = offered.includes(active) ? active : offered[0];
  const starters = q.starters || {};
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold text-secondary">Starter code <span className="font-normal text-muted">(optional — a basic template loads when empty)</span></span>
        {offered.map((l) => (
          <button key={l} type="button" onClick={() => setActive(l)} aria-pressed={cur === l}
            className={`h-7 rounded-control px-2 text-[11px] font-bold ${cur === l ? "bg-slate-900 text-[#fff] dark:bg-slate-100 dark:text-slate-900" : "bg-surface-2 text-secondary"}`}>
            {languageName(l)}{(starters[l] || "").trim() ? " •" : ""}
          </button>
        ))}
      </div>
      <textarea rows={5} value={starters[cur] ?? (cur === offered[0] ? q.code || "" : "")} spellCheck={false}
        aria-label={`Starter code for ${languageName(cur)}`}
        onChange={(e) => set({ starters: { ...starters, [cur]: e.target.value }, ...(cur === offered[0] ? { code: e.target.value } : {}) })}
        className={`${mono} mt-1.5`} placeholder={cur === "kotlin" ? "fun solve(items: List<Int>): Int {\n    \n}" : cur === "python" ? "def solve(items):\n    pass" : "uint8_t solve(uint8_t reg)\n{\n    \n}"} />
    </div>
  );
}

export function QuestionCard({ q, index, skills, onChange, onRemove }: {
  q: BankQuestion; index: number; skills: string[]; onChange: (q: BankQuestion) => void; onRemove: () => void;
}) {
  const look = KIND_LOOK[q.kind];
  const set = (patch: Partial<BankQuestion>) => onChange({ ...q, ...patch });
  const options = q.options && q.options.length ? q.options : ["", ""];
  const partial = (q.partial || []).filter((i) => i !== q.correct && i < options.length);
  return (
    <div id={`bankq-${q.id}`} className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${look.chip}`}>
          {look.icon} {look.short} · #{index + 1}
        </span>
        <SkillSelect value={q.skill} skills={skills} onChange={(skill) => set({ skill })} />
        <span className="flex-1" />
        <button type="button" onClick={onRemove} aria-label="Remove question"
          className="grid h-8 w-8 place-items-center rounded-control text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950">
          <Trash2 size={15} />
        </button>
      </div>
      <label className="mt-3 block text-xs font-semibold text-secondary">
        {q.kind === "coding" ? "Problem statement" : "Question"}
        <textarea rows={2} value={q.text} onChange={(e) => set({ text: e.target.value })} className={`${field} mt-1`}
          placeholder={q.kind === "pseudo" ? "e.g. What is the value of count after poll() runs 5 times?" : q.kind === "coding" ? "e.g. Write a function that toggles bit n of an 8-bit register." : "e.g. What is the difference between a mutex and a semaphore?"} />
      </label>

      {q.kind === "normal" ? (
        <label className="mt-2 block text-xs font-semibold text-secondary">
          Expected answer <span className="font-normal text-muted">(the AI compares the candidate's spoken answer with this)</span>
          <textarea rows={2} value={q.expected || ""} onChange={(e) => set({ expected: e.target.value })} className={`${field} mt-1`}
            placeholder="The key points a good answer must contain." />
        </label>
      ) : null}

      {q.kind === "pseudo" ? (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-secondary">Code shown to the candidate</span>
              <select value={q.language || "pseudo"} onChange={(e) => set({ language: e.target.value })} className={`${sel} h-8 text-xs`} aria-label="Code colours">
                {SNIPPET_LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
            <textarea rows={8} value={q.code || ""} onChange={(e) => set({ code: e.target.value })} className={`${mono} mt-1`}
              spellCheck={false} aria-label="Pseudo-code snippet" placeholder={"static uint8_t calls = 0U;\ncalls++;\nif ((calls & 0x01U) != 0U) {\n    count += 2U;\n}"} />
            <span className="mt-1 block text-[11px] text-muted">Shown with line numbers and colours; the candidate cannot copy it.</span>
          </div>
          <div>
            <div className="text-xs font-semibold text-secondary">Options <span className="font-normal text-muted">(click a letter to mark the correct one · “Partly” earns part of the marks)</span></div>
            <div className="mt-1 space-y-1.5">
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <button type="button" onClick={() => set({ correct: i })} aria-label={`Option ${LETTERS[i]} is correct`}
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-extrabold ring-1 ring-inset ${q.correct === i ? "bg-emerald-600 text-[#fff] ring-emerald-600" : "bg-surface-2 text-secondary ring-subtle"}`}>
                    {q.correct === i ? <Check size={14} /> : LETTERS[i]}
                  </button>
                  <input value={opt} onChange={(e) => set({ options: options.map((o, j) => (j === i ? e.target.value : o)) })}
                    className="h-8 min-w-0 flex-1 rounded-control border border-subtle bg-surface-1 px-2 font-mono text-sm text-primary"
                    placeholder={`Option ${LETTERS[i]}`} />
                  {q.correct !== i ? (
                    <button type="button" aria-pressed={partial.includes(i)}
                      title="Partly right — earns part of the marks"
                      onClick={() => set({ partial: partial.includes(i) ? partial.filter((p) => p !== i) : [...partial, i].sort((a, b) => a - b) })}
                      className={`h-8 shrink-0 rounded-full px-2 text-[11px] font-bold ring-1 ring-inset ${partial.includes(i) ? "bg-amber-500 text-[#fff] ring-amber-500" : "bg-surface-2 text-muted ring-subtle"}`}>
                      Partly
                    </button>
                  ) : <span className="h-8 w-[52px] shrink-0" aria-hidden />}
                  {options.length > 2 ? (
                    <button type="button" aria-label={`Remove option ${LETTERS[i]}`}
                      onClick={() => set({
                        options: options.filter((_, j) => j !== i),
                        correct: q.correct == null ? undefined : q.correct === i ? undefined : q.correct > i ? q.correct - 1 : q.correct,
                        partial: partial.filter((p) => p !== i).map((p) => (p > i ? p - 1 : p)),
                      })}
                      className="grid h-8 w-8 place-items-center rounded-control text-muted hover:text-rose-600"><Trash2 size={13} /></button>
                  ) : null}
                </div>
              ))}
            </div>
            {partial.length ? (
              <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-secondary">
                A partly right option earns
                <select value={q.partial_credit ?? PARTIAL_CREDIT_DEFAULT}
                  onChange={(e) => set({ partial_credit: Number(e.target.value) })} className={`${sel} h-8`}>
                  {PARTIAL_CREDIT_CHOICES.map((c) => <option key={c} value={c}>{c}% of the marks</option>)}
                </select>
              </label>
            ) : null}
            {options.length < 6 ? (
              <button type="button" onClick={() => set({ options: [...options, ""] })}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-indigo-300">
                <Plus size={13} /> Add option
              </button>
            ) : null}
            <label className="mt-2 block text-xs font-semibold text-secondary">
              Why it is correct <span className="font-normal text-muted">(optional, shown on the report)</span>
              <input value={q.expected || ""} onChange={(e) => set({ expected: e.target.value })}
                className="mt-1 h-8 w-full rounded-control border border-subtle bg-surface-1 px-2 text-sm text-primary" />
            </label>
          </div>
        </div>
      ) : null}

      {q.kind === "coding" ? (
        <div className="mt-3 space-y-3">
          <CodingLanguages q={q} set={set} />
          <div className="grid gap-4 lg:grid-cols-2">
            <StarterCode q={q} set={set} />
            <label className="block text-xs font-semibold text-secondary">
              Reference solution <span className="font-normal text-muted">(any offered language — the AI checks correct / partly correct / incorrect against it)</span>
              <textarea rows={7} value={q.expected || ""} onChange={(e) => set({ expected: e.target.value })} className={`${mono} mt-1.5`}
                spellCheck={false} aria-label="Reference solution" placeholder={"uint8_t toggle_bit(uint8_t reg, uint8_t n)\n{\n    return (uint8_t)(reg ^ (1U << n));\n}"} />
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type Tab = "skills" | BankKind | "mix";

const TAB_INFO: Record<BankKind, { title: string; what: string; how: string; empty: string }> = {
  normal: {
    title: "Spoken (theory) questions",
    what: "Asked aloud by the AI interviewer; the candidate answers by voice.",
    how: "Write the question and the key points of a good answer — the AI compares the spoken answer with them.",
    empty: "No spoken questions yet. Add a few per skill (or leave AI top-up on and it writes medium-level ones).",
  },
  pseudo: {
    title: "Pseudo-code questions (options)",
    what: "Shown on screen with no voice: the code on the left, 2–6 options on the right. The candidate clicks one.",
    how: "Paste a short snippet, write the options and click the letter of the correct one. Marked automatically — no AI cost.",
    empty: "No pseudo-code questions yet. They are written by you — the AI never writes these.",
  },
  coding: {
    title: "Coding problems",
    what: "Shown on screen with no voice: the problem on the left, a code editor (line numbers, colours) on the right.",
    how: "Write an easy problem, choose the languages the candidate may use (C, Embedded C, C++, Kotlin, Java, Python …), and add a reference solution.",
    empty: "No coding problems yet. They are written by you — the AI only checks the candidate's code.",
  },
};

function KindIcon({ kind, size = 16 }: { kind: BankKind; size?: number }) {
  return kind === "normal" ? <MessageSquareText size={size} aria-hidden /> : kind === "pseudo" ? <Braces size={size} aria-hidden /> : <Code2 size={size} aria-hidden />;
}

function OrderPreview({ order }: { order: BankKind[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label="Order the candidate meets the questions">
      {order.map((k, i) => (
        <span key={i} title={`Question ${i + 1} · ${KIND_LOOK[k].short}`}
          className={`grid h-7 w-7 place-items-center rounded-control ring-1 ring-inset ${KIND_LOOK[k].chip}`}>
          <KindIcon kind={k} size={13} />
        </span>
      ))}
    </div>
  );
}

export function SkillBankEditor({ value, onChange, suggestedSkills }: {
  value: SkillBankConfig;
  onChange: (next: SkillBankConfig) => void;
  /** The template's required skills — offered as skill cards. */
  suggestedSkills: string[];
}) {
  const set = (patch: Partial<SkillBankConfig>) => onChange({ ...value, ...patch });
  const [tab, setTab] = useState<Tab>("skills");
  const [skillFilter, setSkillFilter] = useState<string>("");
  const [extra, setExtra] = useState<string[]>([]);
  const [newSkill, setNewSkill] = useState("");
  const skills = useMemo(() => {
    const list = bankSkills(value);
    [...suggestedSkills, ...extra].forEach((s) => {
      const t = s.trim();
      if (t && !list.some((x) => x.toLowerCase() === t.toLowerCase())) list.push(t);
    });
    return list;
  }, [value, suggestedSkills, extra]);
  if (!value.enabled) return null;

  const problems = bankProblems(value);
  const errors = problems.filter((p) => p.level === "error");
  const isMandatory = (s: string) => value.mandatory_skills.some((m) => m.toLowerCase() === s.toLowerCase());
  const countOf = (kind: BankKind, skill?: string) =>
    value.questions.filter((q) => q.kind === kind && (!skill || q.skill.toLowerCase() === skill.toLowerCase())).length;

  const addQuestion = (skill: string, kind: BankKind) => {
    const q: BankQuestion = { id: newId(), skill, kind, text: "", expected: "" };
    if (kind === "pseudo") { q.code = ""; q.options = ["", "", "", ""]; q.language = "pseudo"; }
    if (kind === "coding") { q.code = ""; q.language = "any"; q.languages = []; q.starters = {}; }
    set({ questions: [...value.questions, q] });
    setTab(kind);
    setSkillFilter("");
    window.setTimeout(() => document.getElementById(`bankq-${q.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  };
  const updateQuestion = (id: string, next: BankQuestion) =>
    set({ questions: value.questions.map((q) => (q.id === id ? next : q)) });
  const removeQuestion = (id: string) => set({ questions: value.questions.filter((q) => q.id !== id) });
  const toggleMandatory = (skill: string) =>
    set({
      mandatory_skills: isMandatory(skill)
        ? value.mandatory_skills.filter((m) => m.toLowerCase() !== skill.toLowerCase())
        : [...value.mandatory_skills, skill],
    });
  const addSkill = () => {
    const t = newSkill.trim();
    if (!t) return;
    setExtra((x) => (x.some((s) => s.toLowerCase() === t.toLowerCase()) ? x : [...x, t]));
    setNewSkill("");
  };

  const tabs: { key: Tab; label: string; icon: ReactNode; count: string; state: "ok" | "warn" | "idle" }[] = [
    { key: "skills", label: "1 · Skills", icon: <Layers size={15} aria-hidden />, count: String(skills.length), state: skills.length ? "ok" : "warn" },
    { key: "normal", label: "2 · Spoken", icon: <MessageSquareText size={15} aria-hidden />, count: String(countOf("normal")),
      state: countOf("normal") || value.ai_fill ? "ok" : "warn" },
    { key: "pseudo", label: "3 · Pseudo-code", icon: <Braces size={15} aria-hidden />,
      count: `${kindNeed(value, "pseudo").have}/${value.pseudo_count}`, state: kindNeed(value, "pseudo").short ? "warn" : value.pseudo_count ? "ok" : "idle" },
    { key: "coding", label: "4 · Coding", icon: <Code2 size={15} aria-hidden />,
      count: `${kindNeed(value, "coding").have}/${value.coding_count}`, state: kindNeed(value, "coding").short ? "warn" : value.coding_count ? "ok" : "idle" },
    { key: "mix", label: "5 · Mix & timing", icon: <Clock size={15} aria-hidden />, count: `~${estimateMinutes(value, value.pick_min)}m`, state: "ok" },
  ];

  const kindPanel = (kind: BankKind) => {
    const info = TAB_INFO[kind];
    const qs = value.questions.filter((q) => q.kind === kind && (!skillFilter || q.skill.toLowerCase() === skillFilter.toLowerCase()));
    const need = kindNeed(value, kind);
    const target = skillFilter || skills[0] || "";
    return (
      <div className="space-y-3">
        <div className={`rounded-card border p-4 ${kind === "pseudo" ? "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40" : kind === "coding" ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40" : "border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/40"}`}>
          <div className="flex flex-wrap items-start gap-3">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-card bg-gradient-to-br text-[#fff] ${KIND_LOOK[kind].tone}`}><KindIcon kind={kind} size={19} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-extrabold text-primary">{info.title}</div>
              <p className="mt-0.5 text-xs text-secondary">{info.what}</p>
              <p className="mt-0.5 text-xs text-muted">{info.how}</p>
            </div>
            {kind !== "normal" ? (
              <div className={`rounded-control px-3 py-2 text-center ${need.short ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"}`}>
                <div className="text-lg font-black leading-none">{need.have}<span className="text-xs font-bold">/{need.need}</span></div>
                <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider">{need.short ? `add ${need.short} more` : "enough"}</div>
              </div>
            ) : (
              <div className="rounded-control bg-sky-100 px-3 py-2 text-center text-sky-800 dark:bg-sky-950 dark:text-sky-200">
                <div className="text-lg font-black leading-none">{value.normal_per_skill}</div>
                <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider">per picked skill</div>
              </div>
            )}
          </div>
          {kind === "normal" ? (
            <label className="mt-3 flex items-start gap-2 text-xs text-primary">
              <input id="skill-bank-ai-fill" type="checkbox" checked={value.ai_fill} onChange={(e) => set({ ai_fill: e.target.checked })} className="mt-0.5 h-4 w-4" />
              <span><span className="font-bold">AI tops up a short skill</span> — when a picked skill has fewer than {value.normal_per_skill} spoken question(s), the AI writes the rest at medium level.</span>
            </label>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-muted">Show</span>
          {["", ...skills].map((s) => (
            <button key={s || "all"} type="button" onClick={() => setSkillFilter(s)} aria-pressed={skillFilter === s}
              className={`h-7 rounded-full px-2.5 text-[11px] font-bold ring-1 ring-inset ${skillFilter === s ? "bg-slate-900 text-[#fff] ring-slate-900 dark:bg-slate-100 dark:text-slate-900" : "bg-surface-1 text-secondary ring-subtle"}`}>
              {s || "All skills"} <span className="opacity-70">{s ? countOf(kind, s) : countOf(kind)}</span>
            </button>
          ))}
        </div>

        {qs.length ? qs.map((q) => (
          <QuestionCard key={q.id} q={q} index={value.questions.filter((x) => x.kind === kind).indexOf(q)} skills={skills}
            onChange={(next) => updateQuestion(q.id, next)} onRemove={() => removeQuestion(q.id)} />
        )) : (
          <div className="rounded-card border border-dashed border-subtle bg-surface-2 p-6 text-center text-sm text-muted">{info.empty}</div>
        )}
        <button type="button" disabled={!target} onClick={() => addQuestion(target, kind)}
          className={`inline-flex h-10 items-center gap-1.5 rounded-control bg-gradient-to-r px-4 text-sm font-bold text-[#fff] shadow-raised disabled:opacity-50 ${KIND_LOOK[kind].tone}`}>
          <Plus size={15} aria-hidden /> Add {KIND_LOOK[kind].label.toLowerCase()} {target ? `· ${target}` : ""}
        </button>
        {!target ? <p className="text-xs text-warning">Add a skill first (tab 1).</p> : null}
      </div>
    );
  };

  return (
    <section className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised" aria-label="Skill-wise questions">
      <header className="bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 px-5 py-4 text-[#fff]">
        <div className="flex flex-wrap items-start gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-card bg-[rgba(255,255,255,.18)]" aria-hidden><Layers size={22} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-extrabold uppercase tracking-widest text-[rgba(255,255,255,.8)]">Skill-wise interview</div>
            <div className="text-base font-extrabold">Your own spoken, pseudo-code and coding questions, per skill</div>
            <p className="mt-0.5 text-xs text-[rgba(255,255,255,.85)]">
              The candidate ticks the skills they know; only those skills' questions are asked — theory first, pseudo-code and coding in between.
            </p>
          </div>
          <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${errors.length ? "bg-[#fff] text-rose-700" : "bg-[rgba(255,255,255,.2)] text-[#fff]"}`}>
            {errors.length ? <><AlertTriangle size={13} aria-hidden /> {errors.length} to fix</> : <><Sparkles size={13} aria-hidden /> {value.questions.length} question(s)</>}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-bold">
          {[
            ["Picks skills", <Layers key="a" size={12} aria-hidden />],
            [`Spoken × ${value.normal_per_skill}/skill`, <MessageSquareText key="b" size={12} aria-hidden />],
            [`Pseudo-code × ${value.pseudo_count}`, <Braces key="c" size={12} aria-hidden />],
            [`Coding × ${value.coding_count}`, <Code2 key="d" size={12} aria-hidden />],
            ["AI scores", <Sparkles key="e" size={12} aria-hidden />],
          ].map(([label, ic], i, arr) => (
            <span key={String(label)} className="inline-flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(255,255,255,.16)] px-2.5 py-1">{ic}{label}</span>
              {i < arr.length - 1 ? <ChevronRight size={13} aria-hidden className="opacity-70" /> : null}
            </span>
          ))}
        </div>
      </header>

      <div role="tablist" aria-label="Question bank sections" className="flex gap-1 overflow-x-auto border-b border-subtle bg-surface-2 px-2 pt-2">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`inline-flex shrink-0 items-center gap-2 rounded-t-control border border-b-0 px-3 py-2 text-xs font-bold ${tab === t.key ? "border-subtle bg-surface-1 text-primary" : "border-transparent text-secondary hover:text-primary"}`}>
            {t.icon}{t.label}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${t.state === "warn" ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" : t.state === "ok" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-surface-2 text-muted"}`}>{t.count}</span>
          </button>
        ))}
      </div>

      <div className="p-4">
        {tab === "skills" ? (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              Each skill below can hold spoken, pseudo-code and coding questions. <span className="font-bold text-secondary">Always asked</span> skills are ticked and locked on the candidate's skill picker; the rest are the candidate's choice.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {skills.map((skill) => {
                const locked = isMandatory(skill);
                return (
                  <div key={skill} className="rounded-card border border-subtle bg-surface-1 p-3 shadow-raised">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-primary" title={skill}>{skill}</span>
                      <button type="button" onClick={() => toggleMandatory(skill)} aria-pressed={locked}
                        title={locked ? "Always asked — ticked and locked on the candidate's skill picker" : "Optional — the candidate chooses"}
                        className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-bold ring-1 ring-inset ${locked ? "bg-indigo-600 text-[#fff] ring-indigo-600" : "bg-surface-2 text-secondary ring-subtle"}`}>
                        {locked ? <Lock size={11} aria-hidden /> : <Unlock size={11} aria-hidden />} {locked ? "Always asked" : "Candidate's choice"}
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-1.5">
                      {(["normal", "pseudo", "coding"] as BankKind[]).map((kind) => (
                        <button key={kind} type="button" onClick={() => addQuestion(skill, kind)}
                          aria-label={`Add ${KIND_LOOK[kind].label} for ${skill}`}
                          className={`flex flex-col items-center gap-0.5 rounded-control px-1 py-2 text-[11px] font-bold ring-1 ring-inset ${KIND_LOOK[kind].chip}`}>
                          <span className="inline-flex items-center gap-1"><KindIcon kind={kind} size={13} /> {countOf(kind, skill)}</span>
                          <span className="inline-flex items-center gap-0.5"><Plus size={10} aria-hidden />{KIND_LOOK[kind].short}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              <div className="flex flex-col justify-center gap-2 rounded-card border border-dashed border-subtle bg-surface-2 p-3">
                <span className="text-xs font-bold text-secondary">Add a skill</span>
                <div className="flex gap-2">
                  <input value={newSkill} onChange={(e) => setNewSkill(e.target.value)} aria-label="New skill"
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }}
                    placeholder="e.g. AUTOSAR, CAN / CAPL, Android"
                    className="h-9 min-w-0 flex-1 rounded-control border border-subtle bg-surface-1 px-3 text-sm text-primary" />
                  <button type="button" onClick={addSkill} className="h-9 rounded-control bg-indigo-600 px-3 text-xs font-bold text-[#fff]">Add</button>
                </div>
              </div>
            </div>
          </div>
        ) : tab === "mix" ? (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-extrabold uppercase tracking-widest text-muted">Per interview</div>
              <div className="mt-2 grid gap-3 sm:grid-cols-3">
                <NumberField label="Spoken per skill" value={value.normal_per_skill} min={0} max={10} onChange={(n) => set({ normal_per_skill: n })} hint="For every skill the candidate picks" />
                <NumberField label="Pseudo-code" value={value.pseudo_count} min={0} max={10} onChange={(n) => set({ pseudo_count: n })} suffix="total" hint="Spread across the picked skills" />
                <NumberField label="Coding" value={value.coding_count} min={0} max={5} onChange={(n) => set({ coding_count: n })} suffix="total" hint="Asked in the middle of the interview" />
              </div>
            </div>
            <div>
              <div className="text-xs font-extrabold uppercase tracking-widest text-muted">Time & skill picker</div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <NumberField label="Pseudo time" value={value.pseudo_minutes} min={1} max={10} onChange={(n) => set({ pseudo_minutes: n })} suffix="min each" />
                <NumberField label="Coding time" value={value.coding_minutes} min={2} max={45} onChange={(n) => set({ coding_minutes: n })} suffix="min each" />
                <NumberField label="Pick at least" value={value.pick_min} min={1} max={20} onChange={(n) => set({ pick_min: n, pick_max: Math.max(n, value.pick_max) })} suffix="skills" />
                <NumberField label="Pick at most" value={value.pick_max} min={1} max={20} onChange={(n) => set({ pick_max: Math.max(value.pick_min, n) })} suffix="skills" />
              </div>
            </div>
            <div className="rounded-card border border-subtle bg-surface-2 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-secondary">
                <Clock size={14} aria-hidden />
                About <span className="font-bold text-primary">{estimateMinutes(value, value.pick_min)}–{estimateMinutes(value, value.pick_max)} minutes</span>
                with {value.pick_min}–{value.pick_max} skills picked (≈{SPOKEN_MINUTES_EACH} min per spoken question). The template's time limit still applies.
              </div>
              <div className="mt-2 text-[11px] font-bold uppercase tracking-wider text-muted">Order with {value.pick_min} skill(s) picked</div>
              <div className="mt-1"><OrderPreview order={sampleOrder(value, value.pick_min)} /></div>
            </div>
          </div>
        ) : (
          kindPanel(tab)
        )}
      </div>

      {problems.length ? (
        <div className={`border-t p-4 text-xs ${errors.length ? "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100" : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"}`}>
          <div className="mb-1 flex items-center gap-1.5 font-bold"><AlertTriangle size={14} aria-hidden />
            {errors.length ? `${errors.length} thing(s) to fix before saving` : "Worth a look"}</div>
          <ul className="list-disc space-y-0.5 pl-5">
            {problems.slice(0, 8).map((p, i) => <li key={i}>{p.text}</li>)}
            {problems.length > 8 ? <li>…and {problems.length - 8} more</li> : null}
          </ul>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 border-t border-subtle px-4 py-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          <Sparkles size={13} aria-hidden /> Ready — the candidate will pick from {bankSkills(value).length} skill(s).
        </p>
      )}
    </section>
  );
}

/** Step 3 (Review) of the template form for a skill-wise interview. */
export function SkillBankReview({ value, jobTitle }: { value: SkillBankConfig; jobTitle: string }) {
  const skills = bankSkills(value);
  const order = sampleOrder(value, value.pick_min);
  const langs = new Set<string>();
  value.questions.filter((q) => q.kind === "coding").forEach((q) => {
    (q.languages && q.languages.length ? q.languages : ["any"]).forEach((l) => langs.add(languageName(l)));
  });
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="fx-gradient-border rounded-card border border-subtle bg-surface-1 p-6 lg:col-span-7">
        <div className="flex items-center gap-2 text-sm font-extrabold tracking-tight text-primary"><Layers className="h-4 w-4 text-emerald-600" /> Your questions — review</div>
        <p className="mt-1 text-xs text-muted">{skills.every((s) => value.mandatory_skills.some((m) => m.toLowerCase() === s.toLowerCase()))
          ? `Each interview asks ${spokenAsked(value, value.pick_min)} spoken, ${value.pseudo_count} pseudo-code and ${value.coding_count} coding question(s) from your list; the AI scores every answer.`
          : `The candidate picks ${value.pick_min}–${value.pick_max} skills; only those skills' questions are asked.`}</p>
        <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs font-bold uppercase tracking-widest text-muted">Template</dt><dd className="mt-0.5 font-semibold text-primary">{jobTitle || "—"}</dd></div>
          <div><dt className="text-xs font-bold uppercase tracking-widest text-muted">Length</dt><dd className="mt-0.5 font-semibold text-primary">~{estimateMinutes(value, value.pick_min)}–{estimateMinutes(value, value.pick_max)} min</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs font-bold uppercase tracking-widest text-muted">Skills</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">{skills.map((s) => (
              <span key={s} className={`rounded-full px-2 py-0.5 text-xs font-bold ring-1 ring-inset ${value.mandatory_skills.some((m) => m.toLowerCase() === s.toLowerCase()) ? "bg-indigo-600 text-[#fff] ring-indigo-600" : "bg-surface-2 text-secondary ring-subtle"}`}>{s}</span>
            ))}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs font-bold uppercase tracking-widest text-muted">Coding languages</dt><dd className="mt-0.5 font-semibold text-primary">{[...langs].join(", ") || "—"}</dd></div>
        </dl>
      </div>
      <div className="rounded-card border border-subtle bg-surface-1 p-5 lg:col-span-5">
        <div className="grid grid-cols-3 gap-2">
          {(["normal", "pseudo", "coding"] as BankKind[]).map((k) => (
            <div key={k} className={`rounded-card p-3 text-center ring-1 ring-inset ${KIND_LOOK[k].chip}`}>
              <div className="flex justify-center"><KindIcon kind={k} /></div>
              <div className="mt-1 text-xl font-black">{value.questions.filter((q) => q.kind === k).length}</div>
              <div className="text-[11px] font-bold">{KIND_LOOK[k].short} in bank</div>
            </div>
          ))}
        </div>
        <div className="mt-4 text-[11px] font-bold uppercase tracking-wider text-muted">Order the candidate meets</div>
        <div className="mt-1"><OrderPreview order={order} /></div>
      </div>
    </div>
  );
}
