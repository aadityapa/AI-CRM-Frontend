/**
 * SkillListEditor (7 Oct 2026) — the skills a position is sourced and scored on.
 *
 * Reported with a screenshot: in "Approve position — confirm the JD & skills" RMG
 * added several skills and "RTOS (Embedded)" ended up on two rows. Every row was
 * its own picker offering EVERY skill, so the same one could be picked twice and
 * the save was refused ("A skill is listed twice"). This editor makes that
 * impossible and adding many skills quick:
 *   - ONE search box adds skills; the list it offers never holds a skill that is
 *     already added, and it stays open so several can be added in a row;
 *   - Enter on a name that is not in the master creates it (once);
 *   - pasting "C++, RTOS, CAPL" (comma / semicolon / new line) adds them all;
 *   - "Found in the JD" offers the master skills the JD text mentions;
 *   - rows carry a stable key, so removing one never shifts another's values.
 * The server merges duplicates as a second line of defence (`merge_duplicate_skills`).
 */
import { useMemo, useRef, useState } from "react";
import { Plus, Search, Sparkles, Star, Trash2, X } from "lucide-react";

import { focusRing, inputCls } from "./ui";

export type SkillMaster = { id: number | string; name: string; category?: string | null };
export type SkillRow = { key: string; skill_id: string; is_mandatory: boolean; min_rating: string };

export const SKILL_LEVELS = [
  { v: "1", label: "1 · Aware" },
  { v: "2", label: "2 · Basic" },
  { v: "3", label: "3 · Working" },
  { v: "4", label: "4 · Strong" },
  { v: "5", label: "5 · Expert" },
];

let keySeq = 0;
export const newSkillKey = () => `sk${Date.now().toString(36)}${(keySeq++).toString(36)}`;

/** One row per skill: a repeat is merged (mandatory if any copy is, the higher level
 *  wins) — the same rule the server applies. Order of first appearance is kept. */
export function mergeSkillRows<T extends { skill_id: string; is_mandatory: boolean; min_rating: string }>(rows: T[]): T[] {
  const out: T[] = [];
  const at = new Map<string, number>();
  for (const r of rows) {
    if (!r.skill_id) { out.push(r); continue; }
    const i = at.get(r.skill_id);
    if (i == null) { at.set(r.skill_id, out.length); out.push(r); continue; }
    const prev = out[i];
    const levels = [prev.min_rating, r.min_rating].filter(Boolean).map(Number);
    out[i] = { ...prev, is_mandatory: prev.is_mandatory || r.is_mandatory, min_rating: levels.length ? String(Math.max(...levels)) : "" };
  }
  return out;
}

/** Names typed or pasted as a list: "C++, RTOS; CAPL\nAUTOSAR" → four names. */
export function splitSkillNames(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,;\n\r\t]+/)) {
    const name = raw.replace(/^[\s•*\-–]+/, "").trim();
    const k = name.toLowerCase();
    if (name && !seen.has(k)) { seen.add(k); out.push(name); }
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Master skills whose NAME appears in the JD text as a whole word (≥ 2 chars),
 *  not yet added — the "Found in the JD" chips. Longest names first. */
export function skillsInJd(jd: string, master: SkillMaster[], picked: Set<string>, limit = 10): SkillMaster[] {
  const text = (jd || "").toLowerCase();
  if (!text.trim()) return [];
  const hits: SkillMaster[] = [];
  for (const s of [...master].sort((a, b) => b.name.length - a.name.length)) {
    const name = String(s.name || "").trim().toLowerCase();
    if (name.length < 2 || picked.has(String(s.id))) continue;
    const re = new RegExp(`(^|[^a-z0-9+#])${escapeRe(name)}(?=$|[^a-z0-9+#])`, "i");
    if (re.test(text)) hits.push(s);
    if (hits.length >= limit) break;
  }
  return hits;
}

const labelOf = (s: SkillMaster | undefined) =>
  s ? `${s.name}${s.category ? ` (${s.category})` : ""}` : "Unknown skill";

export function SkillListEditor({ rows, onChange, master, onCreate, jdText = "", disabled }: {
  rows: SkillRow[];
  onChange: (rows: SkillRow[]) => void;
  master: SkillMaster[];
  /** Creates a skill in the master; resolves the new row or null on failure. */
  onCreate: (name: string) => Promise<SkillMaster | null>;
  jdText?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const byId = useMemo(() => new Map(master.map((s) => [String(s.id), s])), [master]);
  const picked = useMemo(() => new Set(rows.map((r) => r.skill_id).filter(Boolean)), [rows]);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => master
    .filter((s) => !picked.has(String(s.id)))
    .filter((s) => !q || labelOf(s).toLowerCase().includes(q))
    .sort((a, b) => {
      const an = a.name.toLowerCase(), bn = b.name.toLowerCase();
      const as = an.startsWith(q) ? 0 : 1, bs = bn.startsWith(q) ? 0 : 1;
      return as - bs || an.localeCompare(bn);
    })
    .slice(0, 40), [master, picked, q]);
  const exact = q ? master.find((s) => s.name.trim().toLowerCase() === q) : undefined;
  const canCreate = !!q && !exact;
  const fromJd = useMemo(() => skillsInJd(jdText, master, picked), [jdText, master, picked]);
  const mandatory = rows.filter((r) => r.is_mandatory && r.skill_id).length;

  const addIds = (ids: string[], note?: string) => {
    const fresh = ids.filter((id) => id && !picked.has(id));
    if (!fresh.length) { setNotice(note || "Already in the list."); return; }
    onChange([...rows, ...fresh.map((id) => ({ key: newSkillKey(), skill_id: id, is_mandatory: true, min_rating: "" }))]);
    setNotice(note || "");
  };

  /** Adds names: an existing master skill by name (case-insensitive), else creates it. */
  const addNames = async (names: string[]) => {
    const ids: string[] = [];
    let skipped = 0;
    setCreating(true);
    try {
      for (const name of names) {
        const hit = master.find((s) => s.name.trim().toLowerCase() === name.toLowerCase());
        const id = hit ? String(hit.id) : String((await onCreate(name))?.id ?? "");
        if (!id) continue;
        if (picked.has(id) || ids.includes(id)) skipped += 1; else ids.push(id);
      }
    } finally {
      setCreating(false);
    }
    addIds(ids, ids.length
      ? `${ids.length} skill${ids.length === 1 ? "" : "s"} added${skipped ? ` · ${skipped} already in the list` : ""}`
      : "Those skills are already in the list.");
    setQuery("");
  };

  const pick = (s: SkillMaster) => { addIds([String(s.id)]); setQuery(""); setActive(0); inputRef.current?.focus(); };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const total = matches.length + (canCreate ? 1 : 0);
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, Math.max(total - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Escape") { if (open) { e.stopPropagation(); setOpen(false); } }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (!q) return;
      if (/[,;]/.test(query)) { void addNames(splitSkillNames(query)); return; }
      if (active < matches.length && matches[active]) pick(matches[active]);
      else if (exact) addIds([String(exact.id)]);
      else void addNames([query.trim()]);
      setQuery("");
    }
  };

  const update = (key: string, patch: Partial<SkillRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const setAll = (is_mandatory: boolean) => onChange(rows.map((r) => ({ ...r, is_mandatory })));

  return (
    <div className="space-y-3">
      {/* The one way in: search, pick, keep going. */}
      <div className="relative">
        <div className={`flex items-center gap-2 rounded-xl border-2 bg-surface-1 px-3 transition-colors duration-micro ${
          open ? "border-indigo-500" : "border-subtle hover:border-strong"}`}>
          <Search size={16} className="shrink-0 text-muted" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls="skill-adder-list"
            aria-label="Search or add skills"
            disabled={disabled || creating}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-muted"
            placeholder="Search a skill, or paste several: C++, RTOS, CAPL"
            value={query}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); setNotice(""); }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (/[,;\n]/.test(text)) { e.preventDefault(); void addNames(splitSkillNames(text)); }
            }}
            onKeyDown={onKey}
          />
          {creating && <span className="text-xs font-semibold text-indigo-600">Adding…</span>}
          {query && !creating && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")}
              className="rounded-full p-1 text-muted hover:bg-surface-2"><X size={14} /></button>
          )}
        </div>
        {open && (matches.length > 0 || canCreate) && (
          <ul id="skill-adder-list" role="listbox"
            className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-subtle bg-surface-1 p-1 shadow-overlay">
            {matches.map((s, i) => (
              <li key={s.id} role="option" aria-selected={i === active}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                    i === active ? "bg-indigo-50 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200" : "text-primary"}`}>
                  <span className="truncate">{s.name}</span>
                  <span className="flex items-center gap-2">
                    {s.category && <span className="rounded-full bg-surface-2 px-2 py-px text-[11px] text-muted">{s.category}</span>}
                    <Plus size={14} className="text-indigo-600" aria-hidden />
                  </span>
                </button>
              </li>
            ))}
            {canCreate && (
              <li role="option" aria-selected={active === matches.length}>
                <button type="button" onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void addNames(/[,;]/.test(query) ? splitSkillNames(query) : [query.trim()])}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-indigo-700 dark:text-indigo-300 ${
                    active === matches.length ? "bg-indigo-50 dark:bg-indigo-950/50" : ""}`}>
                  <Plus size={14} aria-hidden /> Create “{query.trim()}” as a new skill
                </button>
              </li>
            )}
          </ul>
        )}
        <p className="mt-1 text-[11px] text-muted">
          {notice ? <span className="font-semibold text-indigo-700 dark:text-indigo-300">{notice}</span>
            : "Enter adds the highlighted skill · new names are created once · added skills drop out of the list, so nothing can be added twice."}
        </p>
      </div>

      {fromJd.length > 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-900 dark:bg-indigo-950/30">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-800 dark:text-indigo-200">
              <Sparkles size={13} aria-hidden /> Found in the JD
            </span>
            <button type="button" onClick={() => addIds(fromJd.map((s) => String(s.id)), `${fromJd.length} skills from the JD added`)}
              className="text-xs font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Add all</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {fromJd.map((s) => (
              <button key={s.id} type="button" onClick={() => pick(s)}
                className={`inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-surface-1 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:border-indigo-400 dark:border-indigo-800 dark:text-indigo-300 ${focusRing}`}>
                <Plus size={12} aria-hidden /> {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-subtle bg-surface-2 px-4 py-5 text-center text-sm text-secondary">
          No skills yet — search above and add the must-haves first.
        </div>
      ) : (
        <div className="rounded-xl border border-subtle">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle bg-surface-2 px-3 py-2 text-xs">
            <span className="font-semibold text-secondary">
              {rows.length} skill{rows.length === 1 ? "" : "s"} · <span className="text-amber-700 dark:text-amber-300">{mandatory} mandatory</span>
            </span>
            <span className="flex items-center gap-3">
              <button type="button" onClick={() => setAll(true)} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">All mandatory</button>
              <button type="button" onClick={() => setAll(false)} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">All optional</button>
            </span>
          </div>
          <ul className="divide-y divide-subtle">
            {rows.map((r) => {
              const s = byId.get(r.skill_id);
              return (
                <li key={r.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <button type="button" aria-pressed={r.is_mandatory}
                    title={r.is_mandatory ? "Mandatory — drives the ATS score. Click to make optional." : "Optional — click to make mandatory."}
                    onClick={() => update(r.key, { is_mandatory: !r.is_mandatory })}
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors duration-micro ${focusRing} ${
                      r.is_mandatory ? "bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow" : "bg-surface-2 text-muted hover:text-amber-600"}`}>
                    <Star size={14} fill={r.is_mandatory ? "currentColor" : "none"} aria-hidden />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-primary">{s?.name || "Unknown skill"}</div>
                    <div className="text-[11px] text-muted">
                      {r.is_mandatory ? "Mandatory" : "Optional"}{s?.category ? ` · ${s.category}` : ""}
                    </div>
                  </div>
                  <select aria-label={`Required level for ${s?.name || "this skill"}`}
                    className={`${inputCls} !h-8 !w-36 !py-0 text-xs`}
                    value={r.min_rating}
                    onChange={(e) => update(r.key, { min_rating: e.target.value })}>
                    <option value="">Level — any</option>
                    {SKILL_LEVELS.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
                  </select>
                  <button type="button" aria-label={`Remove ${s?.name || "skill"}`}
                    onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
                    className={`rounded-lg p-1.5 text-muted hover:bg-danger-soft hover:text-danger ${focusRing}`}>
                    <Trash2 size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
