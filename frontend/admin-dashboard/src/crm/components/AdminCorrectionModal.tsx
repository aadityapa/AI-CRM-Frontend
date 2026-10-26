/**
 * Admin / CEO correction of a candidacy (23 Oct 2026, user ask: "if by mistake
 * RMG / GM [decided wrongly] at Technical Screening or the manual round, Admin
 * can change it from his login — or similar things").
 *
 * One dialog over `GET/POST /api/candidate-profiles/{id}/admin-correction`
 * (B-V2 `services/admin_corrections.py`, `role_required()` = Admin / CEO only):
 *   - put the candidacy back on any stage (the last moves are listed, with
 *     "Undo this move" on the one that brought it here),
 *   - set the RMG screening back (Pending / not sent / Shortlisted / Rejected),
 *   - clear an AI L1 decision (Selected / Rejected / On hold),
 *   - restore an archived row.
 * A wrong ROUND verdict is fixed on the round itself (Interviews ▸ Edit) —
 * changing a "No Hire" reopens the candidacy by itself.
 */
import { useEffect, useMemo, useState } from "react";
import { BellRing, History, RotateCcw, ShieldAlert, Undo2, Wrench } from "lucide-react";

import { crmGet, crmPost } from "../api";
import {
  DialogActions, DialogFailure, DialogHero, DialogSection, ReasonBox, WhatHappens, useCtrlEnter,
} from "./dialogKit";
import { Modal, inputCls, statusLabel } from "./ui";
import { fmtDateTime12 } from "../../lib/datetime";

export type CorrectionOptions = {
  current: string;
  closed: boolean;
  stages: string[];
  undo_to: string | null;
  moves: { from: string; to: string; note: string; by: string | null; at: string | null }[];
  screening: string | null;
  screening_values: string[];
  ai_decision: string | null;
  ai_result: string | null;
  archived: boolean;
  min_reason: number;
};

const SCREENING_LEAVE = "__leave__";

/** What the correction would change, in words — empty = nothing. PURE. */
export function correctionSummary(opts: CorrectionOptions | null, f: {
  target: string; screening: string; clearAi: boolean; restore: boolean;
}): string[] {
  if (!opts) return [];
  const out: string[] = [];
  if (f.target && f.target !== opts.current) out.push(`Stage ${statusLabel(opts.current)} → ${statusLabel(f.target)}`);
  if (f.screening !== SCREENING_LEAVE) {
    const want = f.screening || null;
    if (want !== (opts.screening || null)) out.push(`RMG screening ${opts.screening || "not sent"} → ${want || "not sent"}`);
  }
  if (f.clearAi && opts.ai_decision) out.push(`Clear the AI L1 decision (${opts.ai_decision.replace("_", " ")})`);
  if (f.restore && opts.archived) out.push("Restore from Archive");
  return out;
}

export function AdminCorrectionModal({ profileId, candidateName, onClose, onDone }: {
  profileId: number;
  candidateName?: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [opts, setOpts] = useState<CorrectionOptions | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [target, setTarget] = useState("");
  const [screening, setScreening] = useState(SCREENING_LEAVE);
  const [clearAi, setClearAi] = useState(false);
  const [restore, setRestore] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    let alive = true;
    crmGet<CorrectionOptions>(`/api/candidate-profiles/${profileId}/admin-correction`)
      .then((r) => { if (alive) { setOpts(r.data); setTarget(r.data.current); } })
      .catch((e) => { if (alive) setLoadErr(e?.message || "Could not load the candidacy"); });
    return () => { alive = false; };
  }, [profileId]);

  const min = opts?.min_reason ?? 10;
  const changes = useMemo(() => correctionSummary(opts, { target, screening, clearAi, restore }),
    [opts, target, screening, clearAi, restore]);
  const shortNote = note.trim().length < min;

  const save = async () => {
    if (busy || !opts || !changes.length || shortNote) return;
    setBusy(true);
    setFailure("");
    try {
      const res = await crmPost(`/api/candidate-profiles/${profileId}/admin-correction`, {
        target_status: target && target !== opts.current ? target : null,
        screening: screening === SCREENING_LEAVE ? null : screening,
        clear_ai_decision: clearAi,
        restore,
        note: note.trim(),
      });
      onDone(res.message || "Corrected");
    } catch (e: any) {
      setFailure(e?.message || "Could not save the correction");
      setBusy(false);
    }
  };
  useCtrlEnter(() => void save());

  const hint = !changes.length ? "Pick what to change"
    : shortNote ? <span className="text-warning">Say what was wrong ({min}+ characters)</span>
      : `${changes.length} change${changes.length === 1 ? "" : "s"} · Ctrl + Enter to save`;

  return (
    <Modal
      title={`Admin correction${candidateName ? ` — ${candidateName}` : ""}`}
      medium
      onClose={() => { if (!busy) onClose(); }}
      dirty={!!changes.length || !!note.trim()}
      hero={<DialogHero tone="slate" icon={Wrench} eyebrow="Admin / CEO" title="Correct this candidacy"
        subtitle="Undo a wrong move, screening call or AI decision. Every correction is logged with your reason."
        person={candidateName ? { name: candidateName, meta: opts ? statusLabel(opts.current) : undefined } : null} />}
      footer={<DialogActions tone="slate" icon={Wrench} label="Save correction" busyLabel="Saving…" busy={busy}
        disabled={!changes.length || shortNote} onCancel={onClose} onConfirm={() => void save()} hint={hint} />}
    >
      {loadErr ? <DialogFailure message={loadErr} /> : !opts ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="space-y-4">
          <DialogSection n={1} title="Stage" tone="slate" done={target !== opts.current}
            hint={<>Now at <b>{statusLabel(opts.current)}</b>{opts.closed ? " (closed)" : ""}.</>}>
            <div className="flex flex-wrap items-center gap-2">
              <select className={`${inputCls} !w-auto min-w-[14rem]`} value={target}
                onChange={(e) => setTarget(e.target.value)} aria-label="Move the candidacy to">
                {opts.stages.map((s) => <option key={s} value={s}>{statusLabel(s)}{s === opts.current ? " (now)" : ""}</option>)}
              </select>
              {opts.undo_to && opts.undo_to !== target && (
                <button type="button" onClick={() => setTarget(opts.undo_to!)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-subtle bg-surface-2 px-3 py-1 text-xs font-semibold text-secondary hover:text-primary">
                  <Undo2 size={13} aria-hidden /> Undo the last move (back to {statusLabel(opts.undo_to)})
                </button>
              )}
            </div>
            {opts.moves.length > 0 && (
              <details className="mt-3">
                <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-secondary">
                  <History size={13} aria-hidden /> Last {opts.moves.length} moves
                </summary>
                <ol className="mt-2 space-y-1.5">
                  {opts.moves.map((m, i) => (
                    <li key={i} className="rounded-lg bg-surface-2 px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-primary">{statusLabel(m.from)} → {statusLabel(m.to)}</span>
                        <span className="text-muted">{[m.by, m.at ? fmtDateTime12(m.at) : null].filter(Boolean).join(" · ")}</span>
                      </div>
                      {m.note && <p className="mt-0.5 text-secondary">{m.note}</p>}
                      <button type="button" onClick={() => setTarget(m.from)}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:underline dark:text-blue-300">
                        <RotateCcw size={11} aria-hidden /> Put back at {statusLabel(m.from)}
                      </button>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </DialogSection>

          <DialogSection n={2} title="RMG screening" tone="slate" optional done={screening !== SCREENING_LEAVE}
            hint={<>Now: <b>{opts.screening || "not sent"}</b>. Pending puts the candidate back on the Screening Desk.</>}>
            <select className={`${inputCls} !w-auto min-w-[14rem]`} value={screening}
              onChange={(e) => setScreening(e.target.value)} aria-label="RMG screening">
              <option value={SCREENING_LEAVE}>Leave as it is</option>
              <option value="">Not sent (with TA)</option>
              {opts.screening_values.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </DialogSection>

          {(opts.ai_decision || opts.archived) && (
            <DialogSection n={3} title="AI L1 and Archive" tone="slate" optional done={clearAi || restore}>
              <div className="space-y-2 text-sm">
                {opts.ai_decision && (
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={clearAi} onChange={(e) => setClearAi(e.target.checked)} className="mt-1" />
                    <span>Clear the AI L1 decision <b>{opts.ai_decision.replace("_", " ")}</b>
                      <span className="block text-xs text-muted">The AI's own verdict ({opts.ai_result || "—"}) stands again.</span></span>
                  </label>
                )}
                {opts.archived && (
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={restore} onChange={(e) => setRestore(e.target.checked)} className="mt-1" />
                    <span>Restore from Archive<span className="block text-xs text-muted">The row comes back to Applied Candidates.</span></span>
                  </label>
                )}
              </div>
            </DialogSection>
          )}

          <ReasonBox id="admin-correction-note" label="What was wrong" value={note} onChange={setNote}
            required min={min} tone="slate"
            placeholder="e.g. RMG marked No Hire on the wrong candidate — the L1 went well"
            picks={["Wrong candidate was rejected", "Decision recorded by mistake", "Candidate asked to be considered again"]} />

          {changes.length > 0 && (
            <WhatHappens tone="slate" title="This will" items={[
              ...changes.map((c) => ({ icon: Wrench, text: c })),
              { icon: BellRing, text: "Logged on the profile's Activity Log with your name and reason." },
            ]} />
          )}
          <p className="flex items-start gap-2 rounded-card bg-surface-2 px-3 py-2 text-xs text-secondary">
            <ShieldAlert size={14} className="mt-px shrink-0" aria-hidden />
            A wrong interview verdict? Open the Interviews and edit the round — changing a “No Hire” reopens the
            candidacy by itself.
          </p>
          <DialogFailure message={failure} />
        </div>
      )}
    </Modal>
  );
}
