/**
 * Call notes on the Applied Candidates row (16 Oct 2026, user ask).
 *
 * TA calls a Sourcing candidate and wants to jot what was discussed — before,
 * that meant profile ▸ Outreach ▸ comment. Now the row carries a "Notes (N)"
 * chip with the latest note under the name; the chip opens this pop-up: add a
 * note in one line (channel + outcome picks) and read every earlier note,
 * newest first. Same store as the profile's Outreach tab
 * (`/api/candidates/{id}/outreach`), so nothing is kept twice.
 */
import { useEffect, useState } from "react";
import { MessageSquareText, NotebookPen, Phone } from "lucide-react";

import { crmGet, crmPost } from "../api";
import { fmtDateTime12 } from "../../lib/datetime";
import { DialogActions, DialogFailure, DialogHero, DialogSection, QuickPicks, ReasonBox, useCtrlEnter } from "./dialogKit";
import { Modal } from "./ui";

export type CallNoteSummary = {
  count: number;
  latest: { note: string; channel: string; outcome?: string | null; at?: string | null; by?: string | null } | null;
};

type Note = {
  id: number; channel: string; note: string; outcome: string | null;
  user_name?: string | null; username?: string | null; created_at: string | null;
};

const CHANNELS = ["Call", "WhatsApp", "Email", "LinkedIn", "Other"];
const OUTCOMES = ["Interested", "Call back later", "Not reachable", "Shared details", "Not interested"];
const NOTE_PICKS = ["Discussed the role", "Confirmed CTC and notice", "Asked for an updated CV", "Will share availability"];

/** The chip + latest-note line printed under the candidate's name. */
export function CallNotesLine({ notes, onOpen }: { notes?: CallNoteSummary | null; onOpen: () => void }) {
  const latest = notes?.latest;
  return (
    <div className="mt-1">
      <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }}
        title={latest ? "Read every call note or add one" : "Add a note about your call with this candidate"}
        className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800 ring-1 ring-inset ring-sky-200 hover:bg-sky-100 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800">
        <NotebookPen size={11} aria-hidden /> {notes?.count ? `Notes (${notes.count})` : "Add call note"}
      </button>
      {latest && (
        <p className="mt-0.5 line-clamp-2 max-w-xs text-[11px] text-secondary" title={latest.note}>
          <b>{latest.channel}{latest.outcome ? ` · ${latest.outcome}` : ""}</b>
          {latest.by ? ` — ${latest.by}` : ""}{latest.at ? `, ${fmtDateTime12(latest.at)}` : ""}: {latest.note}
        </p>
      )}
    </div>
  );
}

export function CallNotesModal({ candidateId, candidateName, requirementId, onClose, onSaved }: {
  candidateId: number;
  candidateName: string;
  requirementId?: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [channel, setChannel] = useState("Call");
  const [outcome, setOutcome] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = () => {
    crmGet<Note[]>(`/api/candidates/${candidateId}/outreach`)
      .then((r) => setNotes(r.data || []))
      .catch((e: any) => setLoadErr(e?.message || "Could not load the notes"));
  };
  useEffect(load, [candidateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ok = text.trim().length > 0;
  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setErr("");
    try {
      await crmPost(`/api/candidates/${candidateId}/outreach`, {
        channel, note: text.trim(), outcome, requirement_id: requirementId ?? null,
      });
      setText("");
      setOutcome(null);
      load();
      onSaved();
    } catch (e: any) {
      setErr(e?.message || "Could not save the note");
    } finally {
      setBusy(false);
    }
  };
  useCtrlEnter(() => void save());

  return (
    <Modal title={`Call notes — ${candidateName}`} medium onClose={() => { if (!busy) onClose(); }} dirty={text.trim().length > 0}
      hero={<DialogHero tone="sky" icon={Phone} eyebrow="Applied Candidates" title="Call notes"
        subtitle="What you discussed, for the next call — seen by everyone who works this candidate."
        person={{ name: candidateName }} />}
      footer={
        <div className="space-y-2">
          <DialogFailure message={err} />
          <DialogActions tone="sky" icon={NotebookPen} label="Save note" busyLabel="Saving…" busy={busy}
            disabled={!ok} onCancel={onClose} onConfirm={() => void save()}
            hint={ok ? "Ctrl + Enter to save" : "Write what you discussed"} />
        </div>
      }>
      <div className="space-y-4">
        <DialogSection n={1} title="New note" tone="sky" done={ok}>
          <div className="space-y-2">
            <QuickPicks label="Channel" options={CHANNELS} active={channel} onPick={setChannel} tone="sky" />
            <QuickPicks label="Outcome" options={OUTCOMES} active={outcome}
              onPick={(o) => setOutcome((cur) => (cur === o ? null : o))} tone="sky" />
            <ReasonBox id="call-note" label="What you discussed" value={text} onChange={setText}
              picks={NOTE_PICKS} tone="sky" rows={3} max={2000}
              placeholder="e.g. Interested; current CTC 8 L, expects 11 L; 30 days notice; call back Monday 11 AM" />
          </div>
        </DialogSection>
        <DialogSection n={2} title={`Earlier notes${notes ? ` (${notes.length})` : ""}`} tone="sky" done={!!notes && notes.length > 0}>
          {!notes && !loadErr && <p className="text-sm text-muted">Loading…</p>}
          {loadErr && <p className="text-sm text-warning">{loadErr}</p>}
          {notes && notes.length === 0 && <p className="text-sm text-muted">No notes yet — this will be the first.</p>}
          {notes && notes.length > 0 && (
            <ol className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {notes.map((n) => (
                <li key={n.id} className="rounded-card border border-subtle bg-surface-2 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                    <MessageSquareText size={12} aria-hidden />
                    <span className="font-semibold text-secondary">{n.channel}</span>
                    {n.outcome && <span className="rounded-full bg-sky-100 px-1.5 font-semibold text-sky-800 dark:bg-sky-900 dark:text-sky-200">{n.outcome}</span>}
                    <span>· {n.user_name || n.username || "—"}</span>
                    <span>· {fmtDateTime12(n.created_at)}</span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-primary">{n.note}</p>
                </li>
              ))}
            </ol>
          )}
        </DialogSection>
      </div>
    </Modal>
  );
}
