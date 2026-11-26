/**
 * Talent Pool, round 3 (25 Nov 2026): Ready to place · Keep up to date ·
 * Duplicates, and the re-engagement email. Server: `services/talent_more.py`
 * (B-V2) — `GET /api/talent-pool/ready|freshness|duplicates`,
 * `POST /api/talent-pool/reengage`, `…/candidates/{id}/confirm-details`,
 * `POST /api/talent-pool/duplicates/merge`.
 */
import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2, Copy, FileWarning, GitMerge, Mail, MapPin, PhoneCall, RotateCcw, Search, Send, Sparkles, Star,
} from "lucide-react";
import { crmGet, crmPost, qs } from "../../api";
import { CrmLink } from "../../router";
import { ErrorBox, Modal } from "../../components/ui";
import { Tile } from "../../components/controlTower";
import { FLOW_BTN } from "../../components/flowButtons";
import { DialogActions, DialogFailure, DialogHero, DialogSection, ReasonBox, WhatHappens } from "../../components/dialogKit";
import { TrainingChip, type TrainingRef } from "../../components/training/TrainingParts";
import { fileViewHref } from "../FileView";
import { fmtDateShort } from "../../../lib/datetime";

type Toast = (msg: string, kind?: "ok" | "err") => void;
type Position = { requirement_id: number; req_number: string; title: string; customer_name: string | null; opp_id: string };
const CTRL = "input-recessed min-h-[38px] rounded-control px-3 py-2 text-sm text-primary";
const lakh = (v: number | null | undefined) => (v == null ? "—" : `${v >= 1000 ? (v / 100000).toFixed(1) : v} L`);

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="relative min-w-[240px] flex-1">
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input type="text" className={`${CTRL} w-full pl-8`} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  );
}

/* ================================================================== Ready to place */

type ReadyFit = { requirement_id: number; req_number: string; title: string; opp_id: string; customer: string | null;
  open: number; score: number | null; matched: string[]; missing: string[]; exp_fit: boolean | null };
type ReadyRow = { candidate_id: number; name: string; email: string | null; phone: string | null; city: string | null;
  experience_years: number | null; notice_period: string | null; last_working_day: string | null;
  current_ctc_lakh: number | null; expected_ctc_lakh: number | null; cv_url: string | null; skills: string[];
  why: string[]; ai_best: number | null; communication: number | null; training?: TrainingRef; positions: ReadyFit[] };

export function ReadyMode({ toast, positions }: { toast: Toast; positions: Position[] }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ReadyRow[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; with_fit: number; in_process: number; open_positions: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Map<number, string>>(new Map());
  const [mailing, setMailing] = useState(false);
  const load = useCallback(async () => {
    setError("");
    try { const r = await crmGet<ReadyRow[]>(`/api/talent-pool/ready${qs({ search: q || undefined })}`); setRows(r.data); setMeta(r.meta as never); }
    catch (e) { setError((e as Error).message); }
  }, [q]);
  useEffect(() => { const t = setTimeout(() => void load(), q ? 350 : 0); return () => clearTimeout(t); }, [load, q]);
  const apply = async (r: ReadyRow, f: ReadyFit) => {
    const key = `${r.candidate_id}:${f.requirement_id}`;
    setBusy(key);
    try {
      const res = await crmPost(`/api/candidates/${r.candidate_id}/multi-apply`,
        { items: [{ requirement_id: f.requirement_id }], note: `Ready to place (Talent Pool): ${r.why[0] || "cleared an interview with us"}` });
      setApplied((s) => new Set(s).add(key)); toast(res.message || `${r.name} applied to ${f.title}`);
    } catch (e) { toast((e as Error).message, "err"); }
    finally { setBusy(null); }
  };
  return (
    <div className="space-y-3">
      {meta && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Ready and free now" value={meta.total} sub="cleared an interview with us" tone="success" />
          <Tile label="With a matching position" value={meta.with_fit} sub={`of ${meta.open_positions} open positions`} tone="brand" />
          <Tile label="Ready but in process" value={meta.in_process} sub="already live on a position" tone="neutral" />
          <Tile label="Selected" value={picked.size} sub="tick to email them about new roles" tone="warning" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Name, skill, city" />
        <button type="button" className={FLOW_BTN.neutral} onClick={() => void load()}><RotateCcw size={13} /> Refresh</button>
      </div>
      {error && <ErrorBox error={error} onRetry={load} />}
      {!rows && !error && <div className="p-6 text-sm text-muted">Loading…</div>}
      {rows && rows.length === 0 && <div className="rounded-card border border-dashed border-subtle p-8 text-center text-sm text-muted">
        Nobody ready and free right now. Ready = cleared a technical round or the AI L1 with us (or passed a training re-interview) and not live on another position.</div>}
      <div className="grid gap-3 lg:grid-cols-2">
        {(rows || []).map((r) => (
          <article key={r.candidate_id} className={`rounded-card border bg-surface-1 p-4 shadow-raised ${picked.has(r.candidate_id) ? "border-brand-500 ring-2 ring-brand-500/30" : "border-subtle"}`}>
            <div className="flex items-start gap-3">
              <input type="checkbox" className="mt-1.5" aria-label={`Select ${r.name}`} checked={picked.has(r.candidate_id)}
                onChange={(e) => setPicked((m) => { const n = new Map(m); if (e.target.checked) n.set(r.candidate_id, r.name); else n.delete(r.candidate_id); return n; })} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <CrmLink to={`candidates/${r.candidate_id}`} className="text-sm font-bold text-brand-700 hover:underline">{r.name}</CrmLink>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200"><Star size={10} className="mr-0.5 inline" />Ready</span>
                  {r.ai_best != null && <span className="text-[11px] font-semibold text-secondary">AI {Math.round(r.ai_best)}%</span>}
                  {r.communication != null && <span className="text-[11px] text-muted">· comm {Math.round(r.communication)}%</span>}
                  {r.training && <TrainingChip training={r.training} compact />}
                </div>
                <p className="text-xs text-secondary">{[r.experience_years != null ? `${r.experience_years} yrs` : null, r.city, r.notice_period ? `notice ${r.notice_period}` : null,
                  r.expected_ctc_lakh != null ? `expects ${r.expected_ctc_lakh} L` : null].filter(Boolean).join(" · ")}</p>
                {r.why[0] && <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200"><CheckCircle2 size={11} className="mr-1 inline" />{r.why[0]}</p>}
                <div className="mt-1.5 flex flex-wrap gap-1">{r.skills.slice(0, 8).map((s) => <span key={s} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-secondary">{s}</span>)}</div>
              </div>
              {fileViewHref(r.cv_url, `${r.name} CV`) && <a href={fileViewHref(r.cv_url, `${r.name} CV`)!} target="_blank" rel="noreferrer" className={FLOW_BTN.neutral}>CV</a>}
            </div>
            <div className="mt-3 space-y-1.5">
              {r.positions.length === 0 && <p className="text-xs text-muted">No open position fits their skills yet.</p>}
              {r.positions.map((f) => {
                const key = `${r.candidate_id}:${f.requirement_id}`;
                return (
                  <div key={f.requirement_id} className="flex flex-wrap items-center gap-2 rounded-control border border-subtle bg-surface-2/60 px-2.5 py-1.5 text-xs">
                    <span className={`rounded-full px-1.5 py-0.5 font-bold ${(f.score || 0) >= 70 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{f.score}%</span>
                    <CrmLink to={`requirements/${f.requirement_id}`} className="font-semibold text-primary hover:underline">{f.title}</CrmLink>
                    <span className="text-muted">{f.opp_id} · {f.open} open{f.exp_fit === false ? " · experience outside the band" : ""}</span>
                    {f.missing.length > 0 && <span className="text-amber-700">missing {f.missing.slice(0, 3).join(", ")}</span>}
                    {applied.has(key) ? <span className="ml-auto font-semibold text-emerald-700">Applied ✓</span>
                      : <button type="button" className={`${FLOW_BTN.success} ml-auto`} disabled={busy === key} onClick={() => void apply(r, f)}><Send size={12} /> Apply</button>}
                  </div>);
              })}
            </div>
          </article>
        ))}
      </div>
      {picked.size > 0 && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-2 rounded-card border border-brand-300 bg-surface-1 px-4 py-2.5 shadow-overlay">
          <span className="text-sm font-semibold text-primary">{picked.size} selected</span>
          <div className="flex gap-2"><button type="button" className={FLOW_BTN.neutral} onClick={() => setPicked(new Map())}>Clear</button>
            <button type="button" className={FLOW_BTN.primary} onClick={() => setMailing(true)}><Mail size={13} /> Email {picked.size} about new roles</button></div>
        </div>
      )}
      {mailing && <ReengageDialog people={[...picked.entries()].map(([candidate_id, name]) => ({ candidate_id, name }))} positions={positions}
        onClose={() => setMailing(false)} onDone={(m) => { setMailing(false); setPicked(new Map()); toast(m); }} />}
    </div>
  );
}

/* ================================================================== re-engagement */

export function ReengageDialog({ people, positions, onClose, onDone }: {
  people: { candidate_id: number; name: string }[]; positions: Position[];
  onClose: () => void; onDone: (msg: string) => void;
}) {
  const [req, setReq] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ sent: number; skipped: { name?: string; reason: string }[] } | null>(null);
  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await crmPost<{ sent: number; skipped: { name?: string; reason: string }[] }>("/api/talent-pool/reengage",
        { candidate_ids: people.map((p) => p.candidate_id), requirement_id: req || null, note: note.trim() || null });
      setResult(r.data); setBusy(false); if (!r.data.skipped.length) onDone(r.message || "Sent");
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Modal title="Email about new roles" onClose={onClose} medium
      hero={<DialogHero tone="sky" icon={Mail} eyebrow="Talent Pool" title={`Email ${people.length} about new roles`}
        subtitle="A short, professional “we have openings that match your skills” email. They reply to you; opted-out candidates are never emailed."
        person={{ name: people.slice(0, 3).map((p) => p.name).join(", ") + (people.length > 3 ? ` +${people.length - 3}` : "") }} />}>
      {result ? (
        <div className="space-y-2 text-sm">
          <p className="font-semibold text-emerald-700">{result.sent} email(s) sent.</p>
          {result.skipped.length > 0 && <ul className="max-h-48 overflow-y-auto text-xs text-secondary">{result.skipped.map((s, i) => <li key={i}>• {s.name || "—"}: {s.reason}</li>)}</ul>}
          <div className="flex justify-end"><button type="button" className={FLOW_BTN.neutral} onClick={() => onDone(`${result.sent} email(s) sent`)}>Close</button></div>
        </div>
      ) : (
        <div className="space-y-3">
          <DialogSection n={1} title="Which roles" tone="sky" hint="Blank = each candidate gets the open positions that fit their skills (up to 3).">
            <select className={`${CTRL} w-full`} value={req} onChange={(e) => setReq(e.target.value ? Number(e.target.value) : "")} aria-label="Position">
              <option value="">The best fits for each person</option>
              {positions.map((p) => <option key={p.requirement_id} value={p.requirement_id}>{p.title} · {p.opp_id}</option>)}
            </select>
          </DialogSection>
          <DialogSection n={2} title="Note on their record" optional tone="sky">
            <ReasonBox id="reNote" label="Note" value={note} onChange={setNote} rows={2} tone="sky" picks={["Q4 re-engagement drive", "Follow-up after last interview"]} />
          </DialogSection>
          <WhatHappens tone="sky" items={[
            { icon: Mail, text: "The email names the role(s), never the customer, and asks interest · CTC · notice · location." },
            { icon: CheckCircle2, text: "One email per person per role (or per week) — repeats are skipped." },
          ]} />
          <DialogFailure message={err} />
          <DialogActions onCancel={onClose} busy={busy} tone="sky" icon={Send} label={`Send ${people.length} email(s)`} busyLabel="Sending…" onConfirm={send} />
        </div>
      )}
    </Modal>
  );
}

/* ================================================================== Keep up to date */

type FreshRow = { candidate_id: number; name: string; email: string | null; phone: string | null; city: string | null;
  preferred_locations: string | null; notice_period: string | null; current_ctc: number | null; expected_ctc: number | null;
  experience_years: number | null; cv_url: string | null; owner: string | null; confirmed_at: string | null; cv_at: string | null;
  cv_stale: boolean; facts_stale: boolean; cv_days: number | null; facts_days: number | null; no_cv: boolean };

export function FreshMode({ toast }: { toast: Toast }) {
  const [scope, setScope] = useState("any");
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<FreshRow[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; counts: Record<string, number>; cv_stale_days: number; facts_stale_days: number; limit: number } | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<FreshRow | null>(null);
  const load = useCallback(async () => {
    setError("");
    try { const r = await crmGet<FreshRow[]>(`/api/talent-pool/freshness${qs({ scope, mine: mine || undefined, search: q || undefined, page })}`);
      setRows(r.data); setMeta(r.meta as never); }
    catch (e) { setError((e as Error).message); }
  }, [scope, mine, q, page]);
  useEffect(() => { const t = setTimeout(() => void load(), q ? 350 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { setPage(1); }, [scope, mine, q]);
  const c = meta?.counts || {};
  const pages = meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Need a call" value={c.any ?? "—"} tone="warning" onClick={() => setScope("any")} active={scope === "any"} />
        <Tile label="CV out of date" value={c.cv ?? "—"} sub={meta ? `older than ${Math.round(meta.cv_stale_days / 30)} months` : ""} tone="danger" onClick={() => setScope("cv")} active={scope === "cv"} />
        <Tile label="Notice / CTC not confirmed" value={c.facts ?? "—"} sub={meta ? `for ${meta.facts_stale_days}+ days` : ""} tone="warning" onClick={() => setScope("facts")} active={scope === "facts"} />
        <Tile label="Both" value={c.both ?? "—"} tone="neutral" onClick={() => setScope("both")} active={scope === "both"} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox value={q} onChange={setQ} placeholder="Name, email, phone, city" />
        <label className="flex items-center gap-2 text-sm text-primary"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only candidates I added</label>
      </div>
      {error && <ErrorBox error={error} onRetry={load} />}
      {!rows && !error && <div className="p-6 text-sm text-muted">Loading…</div>}
      {rows && rows.length === 0 && <div className="rounded-card border border-dashed border-subtle p-8 text-center text-sm text-muted">Everything is up to date.</div>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-subtle bg-surface-1">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-muted"><tr>
              <th className="px-3 py-2">Candidate</th><th className="px-3 py-2">CV</th><th className="px-3 py-2">Facts</th>
              <th className="px-3 py-2">Notice · CTC</th><th className="px-3 py-2">Added by</th><th className="px-3 py-2" /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.candidate_id} className="border-t border-subtle">
                <td className="px-3 py-2"><CrmLink to={`candidates/${r.candidate_id}`} className="font-semibold text-brand-700 hover:underline">{r.name}</CrmLink>
                  <div className="text-[11px] text-muted">{[r.phone, r.email, r.city].filter(Boolean).join(" · ")}</div></td>
                <td className="px-3 py-2">{r.cv_stale ? <span className="font-semibold text-rose-600"><FileWarning size={12} className="mr-1 inline" />{r.no_cv ? "No CV" : `${Math.round((r.cv_days || 0) / 30)} months old`}</span>
                  : <span className="text-emerald-700">Fresh</span>}</td>
                <td className="px-3 py-2">{r.facts_stale ? <span className="font-semibold text-amber-700">{r.confirmed_at ? `confirmed ${r.facts_days} d ago` : `never confirmed`}</span>
                  : <span className="text-emerald-700">Confirmed {fmtDateShort(r.confirmed_at)}</span>}</td>
                <td className="px-3 py-2 text-xs text-secondary">{r.notice_period || "—"} · {lakh(r.current_ctc)} → {lakh(r.expected_ctc)}</td>
                <td className="px-3 py-2 text-xs text-secondary">{r.owner || "—"}</td>
                <td className="px-3 py-2 text-right"><div className="flex justify-end gap-1.5">
                  <button type="button" className={FLOW_BTN.success} onClick={() => setConfirm(r)}><PhoneCall size={12} /> Called — confirm</button>
                  {r.cv_stale && <CrmLink to={`candidates/${r.candidate_id}?tab=resumes`} className={FLOW_BTN.edit}>New CV</CrmLink>}
                </div></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button type="button" className={FLOW_BTN.neutral} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="text-secondary">Page {page} of {pages}</span>
          <button type="button" className={FLOW_BTN.neutral} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
      {confirm && <ConfirmDetailsDialog row={confirm} onClose={() => setConfirm(null)} onDone={(m) => { setConfirm(null); toast(m); void load(); }} />}
    </div>
  );
}

function ConfirmDetailsDialog({ row, onClose, onDone }: { row: FreshRow; onClose: () => void; onDone: (m: string) => void }) {
  const toL = (v: number | null) => (v == null ? "" : String(v >= 1000 ? +(v / 100000).toFixed(2) : v));
  const [f, setF] = useState({ notice_period: row.notice_period || "", current_ctc: toL(row.current_ctc), expected_ctc: toL(row.expected_ctc),
    city: row.city || "", preferred_locations: row.preferred_locations || "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const num = (v: string) => (v.trim() ? Number(v) : null);
      const r = await crmPost(`/api/talent-pool/candidates/${row.candidate_id}/confirm-details`, {
        notice_period: f.notice_period.trim() || null, current_ctc: num(f.current_ctc), expected_ctc: num(f.expected_ctc),
        city: f.city.trim() || null, preferred_locations: f.preferred_locations.trim() || null, note: f.note.trim() || null });
      onDone(r.message || "Confirmed");
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const field = (k: keyof typeof f, label: string, suffix?: string) => (
    <label className="text-xs font-semibold text-secondary">{label}
      <div className="relative mt-1"><input className={`${CTRL} w-full`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">{suffix}</span>}</div>
    </label>);
  return (
    <Modal title="Confirm the details" onClose={onClose} medium
      hero={<DialogHero tone="emerald" icon={PhoneCall} eyebrow="Keep up to date" title="Confirm what they told you" person={{ name: row.name, meta: row.phone || row.email || undefined }} />}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {field("notice_period", "Notice period")}{field("city", "Current location")}
          {field("current_ctc", "Current CTC", "lakh")}{field("expected_ctc", "Expected CTC", "lakh")}
          <div className="sm:col-span-2">{field("preferred_locations", "Preferred locations")}</div>
        </div>
        <ReasonBox id="confNote" label="What they said (optional)" value={f.note} onChange={(v) => setF({ ...f, note: v })} rows={2} tone="emerald"
          picks={["Open to a change", "Not looking right now", "Will share an updated CV"]} />
        <p className="flex items-center gap-1 text-[11px] text-muted"><MapPin size={11} /> Saved on the candidate record and as a call note.</p>
        <DialogFailure message={err} />
        <DialogActions onCancel={onClose} busy={busy} tone="emerald" icon={CheckCircle2} label="Confirm details" onConfirm={save} />
      </div>
    </Modal>
  );
}

/* ================================================================== Duplicates */

type DupMember = { candidate_id: number; name: string; email: string | null; phone: string | null; city: string | null;
  experience_years: number | null; added_at: string | null; applications: number; has_cv: boolean };
type DupGroup = { key: string; why: string; strength: "strong" | "possible"; members: DupMember[] };

export function DupesMode({ toast }: { toast: Toast }) {
  const [groups, setGroups] = useState<DupGroup[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; strong: number } | null>(null);
  const [error, setError] = useState("");
  const [merging, setMerging] = useState<{ keep: DupMember; drop: DupMember } | null>(null);
  const [keepOf, setKeepOf] = useState<Record<string, number>>({});
  const load = useCallback(async () => {
    setError("");
    try { const r = await crmGet<DupGroup[]>("/api/talent-pool/duplicates"); setGroups(r.data); setMeta(r.meta as never); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="space-y-3">
      {meta && <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Tile label="Possible duplicates" value={meta.total} tone="warning" />
        <Tile label="Same phone number" value={meta.strong} sub="almost certainly one person" tone="danger" />
        <Tile label="Same name and city" value={meta.total - meta.strong} sub="check before merging" tone="neutral" />
      </div>}
      {error && <ErrorBox error={error} onRetry={load} />}
      {!groups && !error && <div className="p-6 text-sm text-muted">Loading…</div>}
      {groups && groups.length === 0 && <div className="rounded-card border border-dashed border-subtle p-8 text-center text-sm text-muted">No duplicates found.</div>}
      <div className="grid gap-3 lg:grid-cols-2">
        {(groups || []).map((g) => {
          const keepId = keepOf[g.key] ?? g.members[0].candidate_id;
          const keep = g.members.find((m) => m.candidate_id === keepId) || g.members[0];
          return (
            <article key={g.key} className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
              <div className="mb-2 flex items-center gap-2">
                <Copy size={14} className="text-muted" />
                <b className="text-sm text-primary">{g.why}</b>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${g.strength === "strong" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}>{g.strength === "strong" ? "Strong" : "Possible"}</span>
              </div>
              <ul className="space-y-1.5">{g.members.map((m) => (
                <li key={m.candidate_id} className={`flex flex-wrap items-center gap-2 rounded-control border px-2.5 py-1.5 text-xs ${m.candidate_id === keep.candidate_id ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30" : "border-subtle"}`}>
                  <input type="radio" name={g.key} aria-label={`Keep ${m.name}`} checked={m.candidate_id === keep.candidate_id} onChange={() => setKeepOf({ ...keepOf, [g.key]: m.candidate_id })} />
                  <CrmLink to={`candidates/${m.candidate_id}`} className="font-semibold text-brand-700 hover:underline">{m.name}</CrmLink>
                  <span className="text-muted">#{m.candidate_id} · {[m.email, m.phone, m.city].filter(Boolean).join(" · ")}</span>
                  <span className="ml-auto text-secondary">{m.applications} applications{m.has_cv ? " · CV" : ""} · added {fmtDateShort(m.added_at)}</span>
                  {m.candidate_id !== keep.candidate_id && (
                    <button type="button" className={FLOW_BTN.warn} onClick={() => setMerging({ keep, drop: m })}><GitMerge size={12} /> Merge into the kept one</button>)}
                </li>))}</ul>
              <p className="mt-2 text-[11px] text-muted">Tick the record to keep (the one with most history is pre-picked).</p>
            </article>);
        })}
      </div>
      {merging && <MergeDialog keep={merging.keep} drop={merging.drop} onClose={() => setMerging(null)} onDone={(m) => { setMerging(null); toast(m); void load(); }} />}
    </div>
  );
}

function MergeDialog({ keep, drop, onClose, onDone }: { keep: DupMember; drop: DupMember; onClose: () => void; onDone: (m: string) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await crmPost("/api/talent-pool/duplicates/merge", { keep_id: keep.candidate_id, drop_id: drop.candidate_id, reason: reason.trim() }); onDone(r.message || "Merged"); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Modal title="Merge duplicate records" onClose={onClose} medium
      hero={<DialogHero tone="amber" icon={GitMerge} eyebrow="Talent Pool · duplicates" title="Merge into one record"
        subtitle={`Keep #${keep.candidate_id}; #${drop.candidate_id} is removed after its history moves over.`} person={{ name: keep.name }} />}>
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 text-xs">
          <div className="rounded-control border border-emerald-300 bg-emerald-50 p-2 dark:bg-emerald-950/30"><b className="text-emerald-800 dark:text-emerald-200">Keep</b>
            <p>{keep.name} · {keep.email || "no email"} · {keep.phone || "no phone"}</p><p>{keep.applications} applications</p></div>
          <div className="rounded-control border border-rose-300 bg-rose-50 p-2 dark:bg-rose-950/30"><b className="text-rose-800 dark:text-rose-200">Remove</b>
            <p>{drop.name} · {drop.email || "no email"} · {drop.phone || "no phone"}</p><p>{drop.applications} applications</p></div>
        </div>
        <ReasonBox id="mergeWhy" label="Why they are the same person" value={reason} onChange={setReason} required min={5} rows={2} tone="amber"
          picks={["Same phone, same person", "Same person — two email addresses", "Re-applied with a new email"]} />
        <WhatHappens tone="amber" items={[
          { icon: Sparkles, text: "Applications, resumes, call notes, skills, interviews and groups move to the kept record." },
          { icon: CheckCircle2, text: "Blank fields on the kept record are filled from the other; the merge is recorded." },
        ]} />
        <DialogFailure message={err} />
        <DialogActions onCancel={onClose} busy={busy} tone="amber" icon={GitMerge} disabled={reason.trim().length < 5}
          hint={reason.trim().length < 5 ? "Say why (5 characters or more)" : undefined} label="Merge" busyLabel="Merging…" onConfirm={go} />
      </div>
    </Modal>
  );
}
