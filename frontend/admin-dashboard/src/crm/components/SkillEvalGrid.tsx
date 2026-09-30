/**
 * SkillEvalGrid (28 Sep 2026) — the candidate's Skill Evaluation as a compact,
 * inline editor for the Screening Desk: one row per skill (required · self ·
 * reviewer, 1–5), saved with the SAME `POST …/skill-evaluation` upsert the
 * profile page's Skill Evaluation tab uses, so the two never disagree.
 *
 * "Add the position's skills" seeds the grid from the requirement's Skill
 * Evaluation Details (required level = the position's min rating), which is
 * what RMG actually rates against — no hunting through the skills master.
 */
import { useEffect, useMemo, useState } from "react";
import { ListChecks, Plus, Trash2 } from "lucide-react";

import { crmGet, crmPost } from "../api";
import { fetchAllMaster } from "../lib/fetchAllMaster";
import { btnPrimary, btnSecondary, inputCls } from "./ui";

type Row = { skill_id: number; skill_name: string; required_level: string; self_rated: string; reviewer_rated: string; isNew?: boolean };
type PositionSkill = { skill_id: number; skill_name: string | null; is_mandatory: boolean; min_rating: number | null };
type ToastFn = (msg: string, kind?: "ok" | "err") => void;

const RATINGS = ["", "1", "2", "3", "4", "5"];

export function SkillEvalGrid({ profileId, positionSkills, showToast }: {
  profileId: number;
  positionSkills: PositionSkill[];
  showToast: ToastFn;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [saved, setSaved] = useState<Row[]>([]);
  const [skills, setSkills] = useState<{ id: number; name: string }[]>([]);
  const [addId, setAddId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    crmGet<any>(`/api/candidate-profiles/${profileId}`).then((r) => {
      if (!alive) return;
      const evals = (r.data?.skill_evaluations || []) as any[];
      const next: Row[] = evals.map((e) => ({
        skill_id: e.skill_id, skill_name: e.skill_name,
        required_level: e.required_level?.toString() ?? "",
        self_rated: e.self_rated?.toString() ?? "",
        reviewer_rated: e.reviewer_rated?.toString() ?? "",
      }));
      setRows(next); setSaved(next); setLoaded(true);
    }).catch(() => setLoaded(true));
    fetchAllMaster<any>("/api/skills").then((all) => { if (alive) setSkills(all.map((s: any) => ({ id: s.id, name: s.name }))); }).catch(() => {});
    return () => { alive = false; };
  }, [profileId]);

  const used = useMemo(() => new Set(rows.map((r) => r.skill_id)), [rows]);
  const missingFromPosition = positionSkills.filter((s) => !used.has(s.skill_id));
  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);

  const set = (i: number, k: "required_level" | "self_rated" | "reviewer_rated", v: string) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));

  const seed = () => setRows((rs) => [
    ...rs,
    ...missingFromPosition.map((s) => ({
      skill_id: s.skill_id, skill_name: s.skill_name || `Skill #${s.skill_id}`,
      required_level: s.min_rating != null ? String(s.min_rating) : "", self_rated: "", reviewer_rated: "", isNew: true,
    })),
  ]);

  const save = async () => {
    if (!rows.length) { showToast("Add at least one skill first", "err"); return; }
    setBusy(true);
    try {
      await crmPost(`/api/candidate-profiles/${profileId}/skill-evaluation`, rows.map((r) => ({
        skill_id: r.skill_id,
        required_level: r.required_level ? Number(r.required_level) : null,
        self_rated: r.self_rated ? Number(r.self_rated) : null,
        reviewer_rated: r.reviewer_rated ? Number(r.reviewer_rated) : null,
      })));
      const clean = rows.map((r) => ({ ...r, isNew: undefined }));
      setRows(clean); setSaved(clean);
      showToast("Skill evaluation saved");
    } catch (e: any) {
      showToast(e?.message || "Could not save the evaluation", "err");
    } finally {
      setBusy(false);
    }
  };

  const rated = rows.filter((r) => r.reviewer_rated).length;

  return (
    <div className="rounded-card border border-subtle bg-surface-1 shadow-raised">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-primary">
          <ListChecks size={15} /> Skill evaluation
          {rows.length > 0 && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted">{rated}/{rows.length} rated</span>}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {missingFromPosition.length > 0 && (
            <button type="button" className={`${btnSecondary} !py-1 text-xs`} onClick={seed} title="Add the skills this position asks for, with their required levels">
              <Plus size={13} /> Add the position's {missingFromPosition.length} skill{missingFromPosition.length === 1 ? "" : "s"}
            </button>
          )}
          <select className={`${inputCls} !w-44 !py-1 text-xs`} value={addId} onChange={(e) => setAddId(e.target.value)} aria-label="Add a skill">
            <option value="">Add another skill…</option>
            {skills.filter((s) => !used.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button type="button" className={`${btnSecondary} !py-1 text-xs`} disabled={!addId} onClick={() => {
            const s = skills.find((x) => String(x.id) === addId);
            if (s) setRows((rs) => [...rs, { skill_id: s.id, skill_name: s.name, required_level: "", self_rated: "", reviewer_rated: "", isNew: true }]);
            setAddId("");
          }}><Plus size={13} /></button>
        </div>
      </div>
      {!loaded ? (
        <p className="p-4 text-sm text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="p-4 text-sm text-muted">
          Nothing rated yet.{missingFromPosition.length > 0 ? " Start from the position's skills, then rate what you heard in the rounds." : " Add the skills you assessed and rate them 1–5."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-subtle text-left text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
                <th className="px-4 py-2">Skill</th>
                <th className="px-2 py-2">Required</th>
                <th className="px-2 py-2">Self</th>
                <th className="px-2 py-2">Reviewer</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.skill_id} className="border-b border-subtle last:border-0">
                  <td className="px-4 py-1.5 font-medium text-primary">{r.skill_name}</td>
                  {(["required_level", "self_rated", "reviewer_rated"] as const).map((k) => (
                    <td key={k} className="px-2 py-1.5">
                      <select className={`${inputCls} !w-16 !py-1 text-xs`} value={r[k]} onChange={(e) => set(i, k, e.target.value)} aria-label={`${r.skill_name} ${k.replace("_", " ")}`}>
                        {RATINGS.map((v) => <option key={v} value={v}>{v || "—"}</option>)}
                      </select>
                    </td>
                  ))}
                  <td className="px-2 py-1.5">
                    {r.isNew && (
                      <button type="button" className="rounded-control p-1 text-muted hover:bg-danger-soft hover:text-danger" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))} aria-label="Remove">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(dirty || rows.some((r) => r.isNew)) && (
        <div className="flex justify-end gap-2 border-t border-subtle px-4 py-2">
          <button type="button" className={`${btnSecondary} !py-1 text-xs`} onClick={() => setRows(saved)} disabled={busy}>Discard</button>
          <button type="button" className={`${btnPrimary} !py-1 text-xs`} onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save ratings"}</button>
        </div>
      )}
    </div>
  );
}
