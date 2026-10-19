/** Talent Pool, Phases 2 + 3 + retention (17 Oct 2026). Server half: B-V2
 *  services/talent_pool.py (synonyms, index), talent_saved_searches.py,
 *  talent_retention.py.
 *
 *  • SavedSearchesBar — the recruiter's saved searches as chips (with the
 *    "N new" count the daily alert found), Save this search, and per search:
 *    alerts on/off, update to what is on screen, mark seen, delete.
 *  • SkillNamesModal — the synonym list (built-in groups + the admin's pairs)
 *    and the skill index status; Admin / CEO can rebuild the index.
 *  • RetentionMode — who is about to leave the pool, who left, who opted out;
 *    Keep / Back in the pool; Admin sets the retention period.
 *  • PoolOptOutButton — "Remove from pool" on a card / candidate page, when the
 *    candidate asked by phone or mail.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell, BellOff, BookmarkPlus, CheckCheck, Clock, Database, LogOut, RefreshCw, RotateCcw, Save, Search,
  Shuffle, Trash2, UserCheck, UserMinus, X,
} from "lucide-react";

import { crmDelete, crmGet, crmPost, crmPut, qs } from "../../api";
import { useHasRole } from "../../CrmApp";
import { CrmLink } from "../../router";
import { Modal, Spinner, ErrorBox } from "../../components/ui";
import { CONTROL } from "../../components/controlTower";
import { FLOW_BTN } from "../../components/flowButtons";
import { StagePills } from "../../components/PageHeader";
import { DecisionDialog, DialogActions, DialogHero, DialogSection, initials } from "../../components/dialogKit";
import { fmtDateShort, fmtDateTime12 } from "../../../lib/datetime";

type Toast = (m: string, k?: "ok" | "err") => void;

// ---------------------------------------------------------------------------
// Filters ⇄ saved parameters (pure, pinned by TalentPoolExtras.test.ts)
// ---------------------------------------------------------------------------

/** The page's filter shape (mirrors TalentPool.tsx PoolFilters — kept local so
 *  this module has no import cycle with the page). */
export type FilterShape = {
  skills: string[]; nice: string[]; q: string; exp_min: string; exp_max: string; location: string;
  notice: string; ctc_max: string; availability: string; untouched_days: string; proven_only: boolean;
  include_employees: boolean; sort: string;
};

const BLANK: FilterShape = {
  skills: [], nice: [], q: "", exp_min: "", exp_max: "", location: "", notice: "", ctc_max: "",
  availability: "any", untouched_days: "", proven_only: false, include_employees: true, sort: "match",
};

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).filter(Boolean) : str(v).split(",").map((s) => s.trim()).filter(Boolean);

/** A saved search's stored parameters → the page's filters. */
export function paramsToFilters(p: Record<string, unknown> | null | undefined): FilterShape {
  const x = p || {};
  return {
    ...BLANK,
    skills: list(x.skills), nice: list(x.nice), q: str(x.q), exp_min: str(x.exp_min), exp_max: str(x.exp_max),
    location: str(x.location), notice: str(x.notice), ctc_max: str(x.ctc_max),
    availability: str(x.availability) || "any", untouched_days: str(x.untouched_days),
    proven_only: x.proven_only === true || x.proven_only === "true",
    include_employees: !(x.include_employees === false || x.include_employees === "false"),
    sort: str(x.sort) || "match",
  };
}

/** The page's filters → what is saved (only what is set; the server cleans it again). */
export function filtersToParams(f: FilterShape): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.skills.length) out.skills = f.skills;
  if (f.nice.length) out.nice = f.nice;
  for (const k of ["q", "exp_min", "exp_max", "location", "notice", "ctc_max", "untouched_days"] as const) {
    if (f[k].trim()) out[k] = f[k].trim();
  }
  if (f.availability && f.availability !== "any") out.availability = f.availability;
  if (f.proven_only) out.proven_only = true;
  if (!f.include_employees) out.include_employees = false;
  if (f.sort && f.sort !== "match") out.sort = f.sort;
  return out;
}

/** Same search? (order of skills ignored; case ignored). */
export function sameSearch(a: FilterShape, b: FilterShape): boolean {
  const norm = (f: FilterShape) => {
    const p = filtersToParams(f);
    const lower = (v: unknown) => (Array.isArray(v) ? [...v].map((s) => String(s).toLowerCase()).sort() : v);
    return JSON.stringify(Object.keys(p).sort().map((k) => [k, lower(p[k])]));
  };
  return norm(a) === norm(b);
}

/** Can this be saved? (the server refuses a search with no criterion). */
export function hasCriteria(f: FilterShape): boolean {
  return Object.keys(filtersToParams(f)).some((k) => k !== "sort");
}

// ---------------------------------------------------------------------------
// Saved searches
// ---------------------------------------------------------------------------

export type SavedSearch = {
  id: number; name: string; filters: Record<string, unknown>; summary: string; alerts_enabled: boolean;
  new_keys: string[]; new_count: number; last_checked_at: string | null; last_alert_at: string | null;
  last_result_count: number | null; created_at: string | null;
};

function readSavedParam(): number | null {
  const raw = new URLSearchParams(window.location.search).get("saved");
  return raw && /^\d{1,10}$/.test(raw) ? Number(raw) : null;
}

export function SavedSearchesBar({ filters, active, onPick, toast }: {
  filters: FilterShape;
  active: SavedSearch | null;
  onPick: (s: SavedSearch | null, apply: boolean) => void;
  toast: Toast;
}) {
  const [items, setItems] = useState<SavedSearch[] | null>(null);
  const [limit, setLimit] = useState(25);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SavedSearch | null>(null);

  const load = useCallback((pickId?: number | null) => {
    setErr("");
    crmGet<SavedSearch[]>("/api/talent-pool/saved-searches")
      .then((r) => {
        const rows = r.data || [];
        setItems(rows);
        setLimit(Number((r.meta as { limit?: number } | undefined)?.limit) || 25);
        if (pickId) {
          const hit = rows.find((s) => s.id === pickId);
          if (hit) onPick(hit, true);
        } else if (active) {
          onPick(rows.find((s) => s.id === active.id) || null, false);
        }
      })
      .catch((e) => setErr(e?.message || "Could not load your saved searches"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(readSavedParam()); }, [load]);

  const act = async (fn: () => Promise<{ data: SavedSearch; message?: string }>, after?: (s: SavedSearch) => void) => {
    try {
      const r = await fn();
      if (r.message) toast(r.message);
      setItems((prev) => (prev || []).map((s) => (s.id === r.data.id ? r.data : s)));
      after?.(r.data);
    } catch (e: any) { toast(e?.message || "Could not save", "err"); }
  };
  const differs = active ? !sameSearch(paramsToFilters(active.filters), filters) : false;
  const totalNew = (items || []).reduce((n, s) => n + s.new_count, 0);

  return (
    <section className="rounded-card border border-subtle bg-surface-1 p-3 shadow-raised">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-muted">
          <BookmarkPlus size={13} aria-hidden /> Saved searches
          {totalNew > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[10px] text-white">{totalNew} new</span>}
        </span>
        {err && <span className="text-xs text-rose-600">{err}</span>}
        {items === null && !err && <span className="text-xs text-muted">Loading…</span>}
        {items?.length === 0 && <span className="text-xs text-muted">None yet — set up a search and save it to hear about new matches every day.</span>}
        {(items || []).map((s) => {
          const on = active?.id === s.id;
          return (
            <button key={s.id} type="button" onClick={() => onPick(on ? null : s, !on)}
              title={`${s.summary}${s.alerts_enabled ? " · daily alert on" : " · alerts off"}`}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset transition-colors ${
                on ? "bg-teal-600 text-white ring-teal-600" : "bg-surface-2 text-primary ring-subtle hover:bg-teal-50 dark:hover:bg-teal-950/40"}`}>
              {s.alerts_enabled ? <Bell size={11} aria-hidden /> : <BellOff size={11} className="opacity-60" aria-hidden />}
              {s.name}
              {s.new_count > 0 && <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${on ? "bg-white/25" : "bg-amber-500 text-white"}`}>{s.new_count} new</span>}
            </button>
          );
        })}
        <button type="button" className={`${FLOW_BTN.primary} ml-auto`} disabled={!hasCriteria(filters) || (items?.length || 0) >= limit}
          title={!hasCriteria(filters) ? "Pick at least one skill or filter first" : (items?.length || 0) >= limit ? `You can keep up to ${limit}` : undefined}
          onClick={() => setSaving(true)}>
          <Save size={13} aria-hidden /> Save this search
        </button>
      </div>
      {active && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-control bg-teal-50 px-3 py-2 text-xs text-teal-900 dark:bg-teal-950/40 dark:text-teal-100">
          <span className="font-semibold">{active.name}</span>
          <span className="text-teal-800/80 dark:text-teal-200/80">{active.summary}</span>
          <span className="text-teal-800/70 dark:text-teal-200/70">
            {active.last_checked_at ? `checked ${fmtDateTime12(active.last_checked_at)}` : ""}
            {active.last_result_count !== null ? ` · ${active.last_result_count} matched` : ""}
          </span>
          <span className="ml-auto flex flex-wrap gap-1.5">
            {active.new_count > 0 && (
              <button type="button" className={FLOW_BTN.success}
                onClick={() => act(() => crmPost<SavedSearch>(`/api/talent-pool/saved-searches/${active.id}/seen`, {}),
                  (s) => onPick(s, false))}>
                <CheckCheck size={12} aria-hidden /> Mark {active.new_count} seen
              </button>
            )}
            {differs && (
              <button type="button" className={FLOW_BTN.primary} title="Save what is on screen into this search — today's matches become seen"
                onClick={() => act(() => crmPut<SavedSearch>(`/api/talent-pool/saved-searches/${active.id}`, { filters: filtersToParams(filters) }),
                  (s) => onPick(s, false))}>
                <Save size={12} aria-hidden /> Update to these filters
              </button>
            )}
            <button type="button" className={FLOW_BTN.neutral}
              onClick={() => act(() => crmPut<SavedSearch>(`/api/talent-pool/saved-searches/${active.id}`, { alerts_enabled: !active.alerts_enabled }),
                (s) => onPick(s, false))}>
              {active.alerts_enabled ? <><BellOff size={12} aria-hidden /> Turn alerts off</> : <><Bell size={12} aria-hidden /> Daily alert on</>}
            </button>
            <button type="button" className={FLOW_BTN.danger} onClick={() => setConfirmDelete(active)}>
              <Trash2 size={12} aria-hidden /> Delete
            </button>
          </span>
        </div>
      )}
      {saving && (
        <SaveSearchDialog filters={filters} onClose={() => setSaving(false)}
          onSaved={(s, msg) => { setSaving(false); toast(msg); setItems((prev) => [...(prev || []), s].sort((a, b) => a.name.localeCompare(b.name))); onPick(s, false); }} />
      )}
      {confirmDelete && (
        <Modal title="Delete saved search" medium onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-secondary">Delete “{confirmDelete.name}”? You will stop getting its daily alert. The candidates are not affected.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={FLOW_BTN.neutral} onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button type="button" className={FLOW_BTN.delete} onClick={async () => {
              try {
                await crmDelete(`/api/talent-pool/saved-searches/${confirmDelete.id}`);
                setItems((prev) => (prev || []).filter((s) => s.id !== confirmDelete.id));
                if (active?.id === confirmDelete.id) onPick(null, false);
                toast("Saved search removed");
              } catch (e: any) { toast(e?.message || "Could not delete", "err"); }
              setConfirmDelete(null);
            }}>Delete</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function SaveSearchDialog({ filters, onClose, onSaved }: {
  filters: FilterShape; onClose: () => void; onSaved: (s: SavedSearch, message: string) => void;
}) {
  const suggested = [...filters.skills, ...filters.nice].slice(0, 3).join(" + ") || filters.q || "My search";
  const [name, setName] = useState(suggested);
  const [alerts, setAlerts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    if (!name.trim()) { setErr("Give the search a name"); return; }
    setBusy(true);
    setErr("");
    try {
      const r = await crmPost<SavedSearch>("/api/talent-pool/saved-searches",
        { name: name.trim(), filters: filtersToParams(filters), alerts_enabled: alerts });
      onSaved(r.data, r.message || "Saved");
    } catch (e: any) { setErr(e?.message || "Could not save"); setBusy(false); }
  };
  return (
    <Modal title="Save this search" medium onClose={() => { if (!busy) onClose(); }}
      hero={<DialogHero tone="emerald" icon={BookmarkPlus} eyebrow="Talent Pool" title="Save this search"
        subtitle="Everyone it matches today counts as seen — you only hear about people who match later." />}>
      <div className="space-y-4">
        <DialogSection n={1} title="Name" done={!!name.trim()}>
          <input type="text" value={name} maxLength={120} onChange={(e) => setName(e.target.value)}
            aria-label="Search name" className={`${CONTROL} w-full`} />
        </DialogSection>
        <DialogSection n={2} title="Daily alert" done>
          <label className="flex items-start gap-2 text-sm text-secondary">
            <input type="checkbox" className="mt-1" checked={alerts} onChange={(e) => setAlerts(e.target.checked)} />
            <span>Tell me once a day when someone new matches — one bell and one email listing them.</span>
          </label>
        </DialogSection>
        {err && <p className="text-sm text-rose-600">{err}</p>}
        <DialogActions onCancel={onClose} busy={busy} tone="emerald" icon={Save} label="Save search"
          busyLabel="Saving…" onConfirm={save} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Skill names (synonyms) + index
// ---------------------------------------------------------------------------

type SynonymCatalogue = { builtin: string[][]; custom: { id: number; canonical: string; synonym: string; created_at: string | null }[] };
type IndexStatus = { ready: boolean; built_at: string | null; refreshed_at: string | null; rebuilding: boolean;
                     last_rebuild: Record<string, unknown> | null };

export function SkillNamesModal({ onClose, toast }: { onClose: () => void; toast: Toast }) {
  const isAdmin = useHasRole();
  const canCurate = useHasRole("RMG", "Sales_Head");
  const [cat, setCat] = useState<SynonymCatalogue | null>(null);
  const [index, setIndex] = useState<IndexStatus | null>(null);
  const [err, setErr] = useState("");
  const [canonical, setCanonical] = useState("");
  const [synonym, setSynonym] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    setErr("");
    crmGet<SynonymCatalogue>("/api/talent-pool/synonyms").then((r) => setCat(r.data)).catch((e) => setErr(e?.message || "Could not load"));
    crmGet<IndexStatus>("/api/talent-pool/index").then((r) => setIndex(r.data)).catch(() => undefined);
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    setBusy(true);
    try {
      const r = await crmPost("/api/talent-pool/synonyms", { canonical: canonical.trim(), synonym: synonym.trim() });
      toast(r.message || "Added");
      setCanonical(""); setSynonym("");
      load();
    } catch (e: any) { toast(e?.message || "Could not add", "err"); }
    setBusy(false);
  };
  const remove = async (id: number) => {
    try { await crmDelete(`/api/talent-pool/synonyms/${id}`); toast("Synonym removed"); load(); }
    catch (e: any) { toast(e?.message || "Could not remove", "err"); }
  };
  const rebuild = async () => {
    try { const r = await crmPost("/api/talent-pool/index/rebuild", {}); toast(r.message || "Rebuilding"); load(); }
    catch (e: any) { toast(e?.message || "Could not start", "err"); }
  };
  const s = search.trim().toLowerCase();
  const groups = (cat?.builtin || []).filter((g) => !s || g.some((n) => n.toLowerCase().includes(s)));
  const custom = (cat?.custom || []).filter((c) => !s || `${c.canonical} ${c.synonym}`.toLowerCase().includes(s));

  return (
    <Modal title="Skill names" medium onClose={onClose}
      hero={<DialogHero tone="indigo" icon={Shuffle} eyebrow="Talent Pool" title="Skill names that mean the same"
        subtitle="A search for one name finds every name in its group — “AUTOSAR Classic” also finds “AUTOSAR CP”." />}>
      {err ? <ErrorBox error={err} onRetry={load} /> : !cat ? <Spinner label="Loading…" /> : (
        <div className="space-y-4">
          {canCurate && (
            <DialogSection n={1} title="Add a pair" optional>
              <div className="flex flex-wrap items-center gap-2">
                <input type="text" value={synonym} onChange={(e) => setSynonym(e.target.value)} placeholder="Name on CVs, e.g. AUTOSAR R4"
                  aria-label="Other name" className={`${CONTROL} min-w-[12rem] flex-1`} maxLength={120} />
                <span className="text-sm text-muted">is the same skill as</span>
                <input type="text" value={canonical} onChange={(e) => setCanonical(e.target.value)} placeholder="e.g. AUTOSAR Classic"
                  aria-label="Skill" className={`${CONTROL} min-w-[12rem] flex-1`} maxLength={120} />
                <button type="button" className={FLOW_BTN.primary} disabled={busy || !canonical.trim() || !synonym.trim()} onClick={add}>Add</button>
              </div>
            </DialogSection>
          )}
          <label className="relative block">
            <span className="sr-only">Find a skill name</span>
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a name"
              className={`${CONTROL} w-full pl-8`} />
          </label>
          <div>
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Added by your team ({custom.length})</div>
            {custom.length === 0 ? <p className="text-xs text-muted">None yet.</p> : (
              <ul className="divide-y divide-subtle rounded-control border border-subtle">
                {custom.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <span className="font-semibold text-primary">{c.synonym}</span>
                    <span className="text-muted">=</span>
                    <span className="text-primary">{c.canonical}</span>
                    {canCurate && (
                      <button type="button" aria-label={`Remove ${c.synonym}`} className="ml-auto rounded p-1 text-muted hover:bg-surface-2 hover:text-rose-600"
                        onClick={() => remove(c.id)}><X size={13} aria-hidden /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Built in ({groups.length})</div>
            <ul className="max-h-60 space-y-1 overflow-y-auto pr-1">
              {groups.map((g) => (
                <li key={g.join("|")} className="flex flex-wrap gap-1">
                  {g.map((n) => <span key={n} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-secondary ring-1 ring-inset ring-subtle">{n}</span>)}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-control bg-surface-2 px-3 py-2 text-xs text-secondary">
            <Database size={13} aria-hidden />
            {index?.ready
              ? <>Skill index built {index.built_at ? fmtDateTime12(index.built_at) : ""}{index.refreshed_at ? ` · refreshed ${fmtDateTime12(index.refreshed_at)}` : ""}. Changes since are read live.</>
              : <>Skill index not built yet — searches read every CV directly (slower, same answers). The nightly job builds it.</>}
            {isAdmin && (
              <button type="button" className={`${FLOW_BTN.neutral} ml-auto`} disabled={index?.rebuilding} onClick={rebuild}>
                <RefreshCw size={12} aria-hidden /> {index?.rebuilding ? "Rebuilding…" : "Rebuild now"}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

type PoolStatus = { state: "in_pool" | "expiring" | "expired" | "opted_out"; ends_on?: string | null; since?: string;
                    source?: string | null; reason?: string | null; kept_at?: string | null };
type RetentionRow = {
  candidate_id: number; name: string; email: string | null; phone: string | null; city: string | null;
  experience_years: number | null; last_activity: string | null; owner: string | null; opt_out_by: string | null;
  kept_by: string | null; pool: PoolStatus;
};
type RetentionMeta = { total: number; page: number; limit: number; retention_months: number; warn_days: number;
                       counts: Record<"expiring" | "expired" | "opted_out", number> };

const SCOPES = [
  { key: "expiring", label: "Leaving soon" },
  { key: "expired", label: "Left the pool" },
  { key: "opted_out", label: "Opted out" },
] as const;

export function RetentionMode({ toast }: { toast: Toast }) {
  const isAdmin = useHasRole();
  const [scope, setScope] = useState<"expiring" | "expired" | "opted_out">("expiring");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState("");
  const [rows, setRows] = useState<RetentionRow[]>([]);
  const [meta, setMeta] = useState<RetentionMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [keep, setKeep] = useState<RetentionRow | null>(null);
  const [back, setBack] = useState<RetentionRow | null>(null);
  const [months, setMonths] = useState<string>("");

  const load = useCallback(() => {
    setLoading(true);
    setErr("");
    crmGet<RetentionRow[]>(`/api/talent-pool/retention${qs({ scope, q: q || undefined, limit: 100 })}`)
      .then((r) => { setRows(r.data || []); const m = r.meta as unknown as RetentionMeta; setMeta(m); setMonths((v) => v || String(m?.retention_months || "")); })
      .catch((e) => setErr(e?.message || "Could not load"))
      .finally(() => setLoading(false));
  }, [scope, q]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = window.setTimeout(() => setQ(draft.trim()), 350); return () => window.clearTimeout(t); }, [draft]);

  const tabs = SCOPES.map((s) => ({ key: s.key, label: meta?.counts?.[s.key] ? `${s.label} · ${meta.counts[s.key]}` : s.label }));
  const saveMonths = async () => {
    try {
      const r = await crmPut("/api/talent-pool/retention/settings", { months: Number(months) });
      toast(r.message || "Saved");
      load();
    } catch (e: any) { toast(e?.message || "Could not save", "err"); }
  };

  return (
    <div className="space-y-3">
      <section className="rounded-card border border-subtle bg-surface-1 p-3 shadow-raised">
        <div className="flex flex-wrap items-center gap-3">
          <StagePills tabs={tabs} active={scope} onChange={(k) => setScope(k as typeof scope)} label="Retention" />
          <label className="relative min-w-[14rem] flex-1">
            <span className="sr-only">Search</span>
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Name, email or phone"
              className={`${CONTROL} w-full pl-8`} />
          </label>
        </div>
        <p className="mt-2 text-xs text-secondary">
          <Clock size={12} className="mr-1 inline" aria-hidden />
          A candidate stays in the pool <b>{meta?.retention_months ?? "…"} months</b> after their last activity (a call note,
          an application, any stage move, a new CV, an edit). Their TA is told {meta?.warn_days ?? 30} days before;
          <b> Keep</b> restarts the clock. People who left are not searched or suggested — their record and history stay.
          Opted-out people asked not to hear about new openings.
        </p>
        {isAdmin && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-secondary">Retention period</span>
            <input type="number" min={6} max={120} value={months} onChange={(e) => setMonths(e.target.value)}
              aria-label="Retention in months" className={`${CONTROL} w-24`} />
            <span className="text-muted">months (6–120)</span>
            <button type="button" className={FLOW_BTN.primary} disabled={!months || Number(months) === meta?.retention_months}
              onClick={saveMonths}>Save</button>
          </div>
        )}
      </section>
      {err ? <ErrorBox error={err} onRetry={load} /> : loading && rows.length === 0 ? <Spinner label="Loading…" /> : rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-subtle bg-surface-1 p-8 text-center text-sm text-secondary">
          {scope === "expiring" ? "Nobody is about to leave the pool." : scope === "expired" ? "Nobody has left the pool." : "Nobody has opted out."}
        </div>
      ) : (
        <ul className="divide-y divide-subtle rounded-card border border-subtle bg-surface-1 shadow-raised">
          {rows.map((r) => (
            <li key={r.candidate_id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-400 to-slate-600 text-xs font-bold text-white">
                {initials(r.name)}
              </span>
              <div className="min-w-0 flex-1">
                <CrmLink to={`candidates/${r.candidate_id}`} className="font-semibold text-primary hover:underline">{r.name}</CrmLink>
                <div className="text-xs text-secondary">
                  {[r.experience_years !== null ? `${r.experience_years} yrs` : null, r.city, r.owner ? `TA ${r.owner}` : null]
                    .filter(Boolean).join(" · ")}
                </div>
                <div className="text-xs text-muted">
                  {r.last_activity ? `Last activity ${fmtDateShort(r.last_activity)}` : "No activity recorded"}
                  {r.pool.state === "expiring" && r.pool.ends_on ? <span className="ml-1 font-semibold text-amber-700 dark:text-amber-300"> · leaves the pool {fmtDateShort(r.pool.ends_on)}</span> : null}
                  {r.pool.state === "expired" && r.pool.since ? ` · left ${fmtDateShort(r.pool.since)}` : ""}
                  {r.pool.state === "opted_out" ? ` · opted out ${r.pool.since ? fmtDateShort(r.pool.since) : ""} ${r.pool.source === "candidate" ? "(email link)" : r.opt_out_by ? `(${r.opt_out_by})` : ""}` : ""}
                </div>
                {r.pool.state === "opted_out" && r.pool.reason && <div className="text-xs italic text-muted">“{r.pool.reason}”</div>}
              </div>
              {r.pool.state === "opted_out" ? (
                <button type="button" className={FLOW_BTN.neutral} onClick={() => setBack(r)}><RotateCcw size={12} aria-hidden /> Back in the pool</button>
              ) : (
                <button type="button" className={FLOW_BTN.success} onClick={() => setKeep(r)}><UserCheck size={12} aria-hidden /> Keep</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {keep && (
        <DecisionDialog
          spec={{ tone: "emerald", icon: UserCheck, eyebrow: "Talent Pool", title: "Keep in the talent pool",
            intro: <>The retention clock restarts today{keep.pool.state === "expired" ? " and they come back into searches at once" : ""}.</>,
            reason: { label: "Note (optional)", required: false, placeholder: "e.g. Spoke today — open to offers",
              picks: ["Spoke today — still interested", "Strong profile, keep for upcoming roles"] },
            happens: [{ icon: Clock, text: `They stay ${meta?.retention_months ?? 24} more months from today.` }],
            confirmLabel: "Keep" }}
          person={{ name: keep.name }}
          onClose={() => setKeep(null)}
          onConfirm={async (note) => {
            const r = await crmPost(`/api/talent-pool/candidates/${keep.candidate_id}/keep`, { note: note || null });
            toast(r.message || "Kept");
            setKeep(null);
            load();
          }} />
      )}
      {back && (
        <DecisionDialog
          spec={{ tone: "sky", icon: RotateCcw, eyebrow: "Talent Pool", title: "Back in the talent pool",
            intro: "Only when the candidate asked to be considered again — they opted out, so their own request is the reason.",
            reason: { label: "When and how they asked", required: true, min: 10,
              placeholder: "e.g. Emailed on 17 Oct asking to be considered for embedded roles" },
            happens: [{ icon: UserCheck, text: "They are searched and suggested again, and can receive opening emails." }],
            confirmLabel: "Put back" }}
          person={{ name: back.name }}
          onClose={() => setBack(null)}
          onConfirm={async (note) => {
            const r = await crmPost(`/api/talent-pool/candidates/${back.candidate_id}/opt-in`, { reason: note });
            toast(r.message || "Back in the pool");
            setBack(null);
            load();
          }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Remove from pool" (staff, when the candidate asked)
// ---------------------------------------------------------------------------

export function PoolOptOutButton({ candidateId, name, onDone, toast, compact = false }: {
  candidateId: number; name: string; onDone?: () => void; toast: Toast; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="The candidate asked not to hear about new openings"
        className={compact ? "inline-flex items-center gap-1 text-[11px] font-semibold text-muted hover:text-rose-600"
          : FLOW_BTN.withdraw}>
        <UserMinus size={compact ? 11 : 12} aria-hidden /> Remove from pool
      </button>
      {open && (
        <DecisionDialog
          spec={{ tone: "rose", icon: LogOut, eyebrow: "Talent Pool", title: "Remove from the talent pool",
            intro: "Use this when the candidate asked not to be contacted about new openings (by phone, mail or in person).",
            reason: { label: "How they asked", required: true, min: 5, placeholder: "e.g. Asked on the phone not to be contacted",
              picks: ["Asked on the phone not to be contacted", "Replied by email asking to be removed", "Not looking for a change"] },
            happens: [
              { icon: Search, text: "Not searched in the Talent Pool and not suggested for positions." },
              { icon: X, text: "No opening or hiring-interest emails. Mail about an application they are in still goes." },
            ],
            confirmLabel: "Remove from pool" }}
          person={{ name }}
          onClose={() => setOpen(false)}
          onConfirm={async (note) => {
            const r = await crmPost(`/api/talent-pool/candidates/${candidateId}/opt-out`, { reason: note });
            toast(r.message || "Removed from the talent pool");
            setOpen(false);
            onDone?.();
          }} />
      )}
    </>
  );
}

/** The candidate's place in the pool — a chip for the candidate page. Renders
 *  nothing for a login that cannot open the Talent Pool (403). */
export function TalentPoolStatusChip({ candidateId, name, toast }: { candidateId: number; name: string; toast: Toast }) {
  const [st, setSt] = useState<PoolStatus | null>(null);
  const load = useCallback(() => {
    crmGet<PoolStatus>(`/api/talent-pool/candidates/${candidateId}/status`).then((r) => setSt(r.data)).catch(() => setSt(null));
  }, [candidateId]);
  useEffect(() => { load(); }, [load]);
  const look = useMemo(() => {
    if (!st) return null;
    if (st.state === "opted_out") return { cls: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-800", text: "Opted out of the talent pool" };
    if (st.state === "expired") return { cls: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:ring-slate-700", text: "Left the talent pool (inactive)" };
    if (st.state === "expiring") return { cls: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800", text: `Leaves the talent pool ${st.ends_on ? fmtDateShort(st.ends_on) : "soon"}` };
    return { cls: "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:ring-teal-800", text: "In the talent pool" };
  }, [st]);
  if (!st || !look) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${look.cls}`} title={st.reason || undefined}>{look.text}</span>
      {(st.state === "expiring" || st.state === "expired") && (
        <button type="button" className="text-[11px] font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
          onClick={async () => {
            try { const r = await crmPost(`/api/talent-pool/candidates/${candidateId}/keep`, { note: null }); toast(r.message || "Kept"); load(); }
            catch (e: any) { toast(e?.message || "Could not keep", "err"); }
          }}>Keep</button>
      )}
      {st.state !== "opted_out" && <PoolOptOutButton compact candidateId={candidateId} name={name} toast={toast} onDone={load} />}
    </span>
  );
}
