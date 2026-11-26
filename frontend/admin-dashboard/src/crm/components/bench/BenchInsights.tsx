/**
 * Bench & Deployed ▸ Insights (25 Nov 2026): what the bench costs a day, who is
 * on it for 30+ days, who rolls off soon (matched to open positions), the skill
 * gap, and "Share resume with Sales". Server: `GET /api/bench/insights`,
 * `POST /api/bench/{id}/share-resume` (`services/bench_insights.py`, B-V2).
 * `BenchSnapshot` is the small card on the RMG / GM / CEO Dashboard.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Clock, Copy, FileText, GraduationCap, IndianRupee, Send, Share2, Target, Users } from "lucide-react";
import { crmGet, crmPost, qs } from "../../api";
import { CrmLink } from "../../router";
import { ErrorBox, Modal, useToast } from "../ui";
import { Panel, Tile, inr, inrCompact } from "../controlTower";
import { FLOW_BTN } from "../flowButtons";
import { DialogActions, DialogFailure, DialogHero, DialogSection, ReasonBox } from "../dialogKit";
import { PlanDialog, TrainingChip, useTrainingWriter, type TrainingRef } from "../training/TrainingParts";
import { crmNavigate } from "../../router";
import { fmtDateShort } from "../../../lib/datetime";

type Fit = { requirement_id: number; req_number: string; title: string; opp_id: string; customer: string | null;
  open: number; score: number | null; matched: string[]; missing: string[] };
type BenchP = { id: number; name: string; employee_code: string | null; designation: string | null; skills: string[];
  bench_days: number | null; bench_since: string | null; per_day: number | null; spell_cost: number | null;
  training?: TrainingRef; experience_years?: number | null };
type Rolloff = { id: number; name: string; employee_code: string | null; designation: string | null; skills: string[];
  release_date: string; days_left: number; project: string | null; customer: string | null; positions: Fit[] };
type Gap = { skill: string; positions: number; open_heads: number; must: number; position_titles: string[];
  bench_holders: number; holder_names: string[]; gap: number };
export type Insights = {
  today: string;
  cost: { per_day: number; per_month: number; spells_so_far: number; people: number; no_ctc: number; over_30: number; over_30_per_day: number };
  bench: BenchP[]; over_30: BenchP[]; rolloffs: Rolloff[]; rolloff_days: number; skill_gap: Gap[]; open_positions: number;
};

export function BenchInsightsView() {
  const [days, setDays] = useState(60);
  const [d, setD] = useState<Insights | null>(null);
  const [error, setError] = useState("");
  const [toastEl, toast] = useToast();
  const canEdit = useTrainingWriter();
  const [train, setTrain] = useState<{ p: BenchP; skill?: string } | null>(null);
  const [share, setShare] = useState<{ id: number; name: string; requirement?: { id: number; label: string } } | null>(null);
  const [gapPick, setGapPick] = useState<Gap | null>(null);
  const load = useCallback(async () => {
    setError("");
    try { setD((await crmGet<Insights>(`/api/bench/insights${qs({ rolloff_days: days })}`)).data); } catch (e) { setError((e as Error).message); }
  }, [days]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!d) return <div className="p-6 text-sm text-muted">Loading…</div>;
  const soon30 = d.rolloffs.filter((r) => r.days_left <= 30).length;
  return (
    <div className="space-y-4">
      {toastEl}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Bench cost a day" value={inr(d.cost.per_day)} sub={`${d.cost.people} people`} tone="danger"
          foot={d.cost.no_ctc ? `${d.cost.no_ctc} without CTC` : "From CTC"} />
        <Tile label="Bench cost a month" value={inrCompact(d.cost.per_month)} sub="at today's bench" tone="warning" />
        <Tile label="Spent on current bench spells" value={inrCompact(d.cost.spells_so_far)} sub="since each person's bench started" tone="neutral" />
        <Tile label="Bench 30+ days" value={d.cost.over_30} sub={`${inr(d.cost.over_30_per_day)} a day`} tone={d.cost.over_30 ? "danger" : "success"} />
        <Tile label={`Rolling off · ${d.rolloff_days} days`} value={d.rolloffs.length} sub={`${soon30} within 30 days`} tone="warning" />
        <Tile label="Biggest skill gap" value={d.skill_gap[0]?.skill || "—"} sub={d.skill_gap[0] ? `${d.skill_gap[0].gap} heads short` : `${d.open_positions} open positions`} tone="brand" />
      </div>

      <Panel className="!h-auto" title="On the bench for more than 30 days" hint="Escalated to RMG / GM every week. Place them, train them, or move them to a group.">
        {d.over_30.length === 0 ? <p className="text-sm text-muted">Nobody — well done.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="py-1.5">Person</th><th>On bench</th><th>Skills</th><th className="text-right">A day</th><th className="pr-4 text-right">This spell</th><th>Training</th><th /></tr></thead>
              <tbody>{d.over_30.map((p) => (
                <tr key={p.id} className="border-t border-subtle align-top">
                  <td className="py-2"><CrmLink to={`bench/${p.id}`} className="font-semibold text-brand-700 hover:underline">{p.name}</CrmLink>
                    <div className="text-[11px] text-muted">{[p.employee_code, p.designation].filter(Boolean).join(" · ")}</div></td>
                  <td className="py-2"><span className={`font-bold ${(p.bench_days || 0) > 60 ? "text-rose-600" : "text-amber-700"}`}>{p.bench_days} days</span>
                    <div className="text-[11px] text-muted">since {fmtDateShort(p.bench_since)}</div></td>
                  <td className="py-2 text-xs text-secondary">{p.skills.slice(0, 4).join(", ") || "—"}</td>
                  <td className="py-2 text-right tabular-nums">{p.per_day != null ? inr(p.per_day) : <span className="text-muted">No CTC</span>}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{p.spell_cost != null ? inrCompact(p.spell_cost) : "—"}</td>
                  <td className="py-2">{p.training ? <TrainingChip training={p.training} compact /> : <span className="text-xs text-muted">None</span>}</td>
                  <td className="py-2 text-right">
                    {canEdit && <div className="flex justify-end gap-1.5">
                      {!p.training || !["Active", "Interview_due", "Not_yet"].includes(p.training.status)
                        ? <button type="button" className={FLOW_BTN.success} onClick={() => setTrain({ p })}><GraduationCap size={13} /> Train</button> : null}
                      <button type="button" className={FLOW_BTN.view} onClick={() => setShare({ id: p.id, name: p.name })}><Share2 size={13} /> Share resume</button>
                    </div>}
                  </td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel className="!h-auto" title="Rolling off soon — place them before they reach the bench"
        action={<div className="flex gap-1" role="group" aria-label="Horizon">{[30, 60, 90].map((n) => (
          <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${days === n ? "bg-brand-600 text-white ring-brand-600" : "text-secondary ring-subtle"}`}>{n} days</button>))}</div>}>
        {d.rolloffs.length === 0 ? <p className="text-sm text-muted">Nobody has a planned release in the next {d.rolloff_days} days.</p> : (
          <ul className="space-y-2">{d.rolloffs.map((r) => (
            <li key={r.id} className="rounded-control border border-subtle bg-surface-1 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <CrmLink to={`bench/${r.id}`} className="font-semibold text-brand-700 hover:underline">{r.name}</CrmLink>
                <span className="text-xs text-muted">{r.project}{r.customer && ` · ${r.customer}`}</span>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${r.days_left <= 15 ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}>
                  <Clock size={11} className="mr-0.5 inline" />releases {fmtDateShort(r.release_date)} · {r.days_left} d</span>
              </div>
              {r.positions.length ? (
                <div className="mt-2 flex flex-wrap gap-2">{r.positions.map((f) => (
                  <span key={f.requirement_id} className="inline-flex items-center gap-1.5 rounded-control border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs dark:border-emerald-900 dark:bg-emerald-950/30">
                    <CrmLink to={`requirements/${f.requirement_id}`} className="font-semibold text-emerald-800 hover:underline dark:text-emerald-200">{f.title}</CrmLink>
                    <span className="text-muted">{f.opp_id} · {f.score}% fit</span>
                    {canEdit && <button type="button" className="font-semibold text-brand-700 hover:underline"
                      onClick={() => setShare({ id: r.id, name: r.name, requirement: { id: f.requirement_id, label: `${f.title} (${f.req_number})` } })}>Share resume</button>}
                  </span>))}</div>
              ) : <p className="mt-1 text-xs text-muted">No open position fits their skills ({r.skills.slice(0, 4).join(", ") || "none on record"}) — consider training.</p>}
            </li>))}</ul>
        )}
      </Panel>

      <Panel className="!h-auto" title="Skill gap — what open positions ask for that the bench does not have" hint="Open heads minus bench people who already hold the skill">
        {d.skill_gap.length === 0 ? <p className="text-sm text-muted">No open position lists its skills yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="py-1.5">Skill</th><th className="text-right">Positions</th><th className="text-right">Open heads</th>
                <th className="text-right">On bench</th><th className="text-right">Short</th><th /></tr></thead>
              <tbody>{d.skill_gap.map((g) => (
                <tr key={g.skill} className="border-t border-subtle">
                  <td className="py-2"><b className="text-primary">{g.skill}</b>{g.must > 0 && <span className="ml-1 text-[10px] font-bold text-amber-700">★ must-have ×{g.must}</span>}
                    <div className="text-[11px] text-muted" title={g.position_titles.join("\n")}>{g.position_titles.slice(0, 2).join(" · ")}</div></td>
                  <td className="py-2 text-right tabular-nums">{g.positions}</td>
                  <td className="py-2 text-right tabular-nums">{g.open_heads}</td>
                  <td className="py-2 text-right tabular-nums" title={g.holder_names.join(", ")}>{g.bench_holders}</td>
                  <td className={`py-2 text-right font-bold tabular-nums ${g.gap > 0 ? "text-rose-600" : "text-emerald-600"}`}>{g.gap}</td>
                  <td className="py-2 text-right">{canEdit && g.gap > 0 && d.bench.length > 0 &&
                    <button type="button" className={FLOW_BTN.success} onClick={() => setGapPick(g)}><Target size={13} /> Train someone</button>}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Panel>

      {gapPick && <PickBenchPerson gap={gapPick} people={d.bench} onClose={() => setGapPick(null)}
        onPick={(p) => { setGapPick(null); setTrain({ p, skill: gapPick.skill }); }} />}
      {train && <PlanDialog subject={{ employee_id: train.p.id, name: train.p.name, isEmployee: true }}
        source={train.skill ? "skill_gap" : "bench"} suggestions={train.p.skills}
        weak={train.skill ? [{ name: train.skill, current: null, target: 4 }] : []}
        onClose={() => setTrain(null)} onDone={(plan, m) => { setTrain(null); toast(m); crmNavigate(`training/${plan.id}`); }} />}
      {share && <ShareResumeDialog employee={share} requirement={share.requirement} onClose={() => setShare(null)} onDone={(m) => { setShare(null); toast(m); }} />}
    </div>
  );
}

function PickBenchPerson({ gap, people, onClose, onPick }: { gap: Gap; people: BenchP[]; onClose: () => void; onPick: (p: BenchP) => void }) {
  const [q, setQ] = useState("");
  const shown = people.filter((p) => !q || `${p.name} ${p.skills.join(" ")} ${p.designation || ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title={`Train someone on ${gap.skill}`} onClose={onClose} medium>
      <p className="mb-2 text-sm text-secondary">{gap.open_heads} open heads ask for <b>{gap.skill}</b>; {gap.bench_holders} bench people have it. Pick who to train:</p>
      <input type="text" className="input-recessed mb-2 min-h-[38px] w-full rounded-control px-3 text-sm" placeholder="Search the bench" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the bench" />
      <ul className="max-h-[50vh] space-y-1 overflow-y-auto">{shown.map((p) => (
        <li key={p.id}><button type="button" onClick={() => onPick(p)}
          className="flex w-full items-center gap-2 rounded-control border border-subtle px-3 py-2 text-left hover:bg-surface-2">
          <span className="min-w-0 flex-1"><b className="text-sm text-primary">{p.name}</b>
            <span className="block truncate text-[11px] text-muted">{p.bench_days} d on bench · {p.skills.slice(0, 5).join(", ") || "no skills on record"}</span></span>
          <ArrowRight size={14} className="text-muted" /></button></li>))}</ul>
    </Modal>
  );
}

export function ShareResumeDialog({ employee, requirement, onClose, onDone }: {
  employee: { id: number; name: string }; requirement?: { id: number; label: string };
  onClose: () => void; onDone: (m: string) => void;
}) {
  const [people, setPeople] = useState<{ id: number; name: string }[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [links, setLinks] = useState<{ docx_url: string; pdf_url: string; resume_percent: number } | null>(null);
  useEffect(() => { crmGet<{ id: number; name: string }[]>("/api/bench/sales-people").then((r) => setPeople(r.data)).catch(() => setPeople([])); }, []);
  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await crmPost<{ sent: number; docx_url: string; pdf_url: string; resume_percent: number }>(`/api/bench/${employee.id}/share-resume`,
        { user_ids: [...picked], requirement_id: requirement?.id ?? null, note: note.trim() || null });
      setLinks(r.data); onDone(r.message || "Sent"); setBusy(false);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Modal title="Share resume with Sales" onClose={onClose} medium
      hero={<DialogHero tone="sky" icon={Share2} eyebrow="Bench & Deployed" title="Share the resume with Sales"
        subtitle="The company-format resume as Word + PDF links (no login, valid 14 days) — Sales forwards it to the customer."
        person={{ name: employee.name, meta: requirement ? `for ${requirement.label}` : undefined }} />}>
      {links ? (
        <div className="space-y-3 text-sm">
          <p className="text-emerald-700">Sent. {links.resume_percent < 100 && <span className="text-amber-700">The resume is only {links.resume_percent}% complete — finish it on the person's Resume section.</span>}</p>
          {[["Word", links.docx_url], ["PDF", links.pdf_url]].map(([l, u]) => (
            <div key={l} className="flex gap-2"><span className="w-12 pt-2 text-xs font-semibold text-secondary">{l}</span>
              <input readOnly className="input-recessed min-h-[36px] w-full rounded-control px-2 text-xs" value={u} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className={FLOW_BTN.view} onClick={() => void navigator.clipboard?.writeText(u)}><Copy size={12} /> Copy</button></div>))}
          <div className="flex justify-end"><button type="button" className={FLOW_BTN.neutral} onClick={onClose}>Close</button></div>
        </div>
      ) : (
        <div className="space-y-3">
          <DialogSection n={1} title="Who gets it" tone="sky" hint="Nobody ticked = every Sales, Sales Manager and Sales Head login">
            {!people ? <p className="text-sm text-muted">Loading…</p> : people.length === 0 ? <p className="text-sm text-muted">No Sales logins found.</p> : (
              <div className="grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">{people.map((p) => (
                <label key={p.id} className="flex items-center gap-2 rounded-control px-2 py-1 text-sm hover:bg-surface-2">
                  <input type="checkbox" checked={picked.has(p.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />
                  {p.name}</label>))}</div>)}
          </DialogSection>
          <DialogSection n={2} title="Note" optional tone="sky">
            <ReasonBox id="shareNote" label="Note for Sales" value={note} onChange={setNote} rows={2} tone="sky"
              picks={["Available to join immediately", "Rolling off the current project soon", "Strong match — please share today"]} />
          </DialogSection>
          <DialogFailure message={err} />
          <DialogActions onCancel={onClose} busy={busy} tone="sky" icon={Send} label={picked.size ? `Send to ${picked.size}` : "Send to all Sales"} busyLabel="Sending…" onConfirm={send} />
        </div>
      )}
    </Modal>
  );
}

/** The Dashboard card for RMG / GM / CEO — renders nothing when the login cannot read the bench. */
export function BenchSnapshot() {
  const [d, setD] = useState<Insights | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    crmGet<Insights>("/api/bench/insights?rolloff_days=30").then((r) => setD(r.data)).catch(() => setHidden(true));
  }, []);
  if (hidden || !d) return null;
  return (
    <section className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised" aria-labelledby="benchSnapTitle">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-amber-500 to-rose-600 text-white"><IndianRupee size={16} /></span>
        <h2 id="benchSnapTitle" className="text-sm font-extrabold text-primary">Bench today</h2>
        <CrmLink to="bench?tab=insights" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">Open insights <ArrowRight size={12} /></CrmLink>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Bench cost a day" value={inr(d.cost.per_day)} sub={`${d.cost.people} on the bench`} tone="danger" to="bench?tab=insights" />
        <Tile label="Bench 30+ days" value={d.cost.over_30} sub={`${inr(d.cost.over_30_per_day)} a day`} tone={d.cost.over_30 ? "warning" : "success"} to="bench?tab=insights" />
        <Tile label="Rolling off in 30 days" value={d.rolloffs.length} sub="match them to positions" tone="warning" to="bench?tab=insights" />
        <Tile label="Biggest skill gap" value={d.skill_gap[0]?.skill || "—"} sub={d.skill_gap[0] ? `${d.skill_gap[0].gap} heads short` : ""} tone="brand" to="bench?tab=insights" />
      </div>
      {d.cost.no_ctc > 0 && <p className="mt-2 flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle size={11} /> {d.cost.no_ctc} bench people have no CTC on record — not in the cost.</p>}
      {d.over_30.length > 0 && <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-secondary"><Users size={12} />
        {d.over_30.slice(0, 5).map((p) => p.name).join(", ")}{d.over_30.length > 5 ? ` and ${d.over_30.length - 5} more` : ""} · <FileText size={12} /> resume, training or a group</p>}
    </section>
  );
}
