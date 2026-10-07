/**
 * User lifecycle dialogs (7 Oct 2026) — Deactivate and Delete, the two actions
 * that end someone's access. Both read `GET /api/users/{id}/open-work` first:
 *   - Deactivate shows the live work still pointing at the person (candidates
 *     they own, positions assigned, open deals) so it can be handed over — a
 *     warning, nothing is reassigned — and asks WHY (kept in the audit log).
 *   - Delete is only possible for an account with NO history; otherwise it says
 *     what the person did and offers Deactivate instead. The server enforces both.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, ArchiveX, CheckCircle2, LogIn, ShieldOff, Trash2, UserX } from "lucide-react";

import { crmDelete, crmGet, crmPost } from "../../api";
import {
  DialogActions, DialogFailure, DialogHero, DialogSection, ReasonBox, WhatHappens, useCtrlEnter,
} from "../dialogKit";
import { Modal, inputCls } from "../ui";

export type LifecycleUser = { id: number; full_name: string; username: string; email: string };
type OpenWork = {
  open_work: { key: string; label: string; count: number; hint: string }[];
  history: { label: string; count: number }[];
};

export const DEACTIVATE_REASON_MIN = 5;
const REASON_PICKS = ["Left the company", "Moved to another team", "Account no longer needed", "Security concern"];

function useOpenWork(userId: number) {
  const [data, setData] = useState<OpenWork | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let cancelled = false;
    crmGet<OpenWork>(`/api/users/${userId}/open-work`)
      .then((r) => { if (!cancelled) setData(r.data || { open_work: [], history: [] }); })
      .catch((e: any) => { if (!cancelled) setErr(e?.message || "Could not check the account"); });
    return () => { cancelled = true; };
  }, [userId]);
  return { data, err };
}

const nameOf = (u: LifecycleUser) => u.full_name || u.username;

export function DeactivateUserModal({ user, onClose, onDone }: {
  user: LifecycleUser;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { data, err: loadErr } = useOpenWork(user.id);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ok = reason.trim().length >= DEACTIVATE_REASON_MIN;

  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await crmPost(`/api/users/${user.id}/deactivate`, { reason: reason.trim() });
      onDone(res.message || `${nameOf(user)} deactivated`);
    } catch (e: any) {
      setErr(e?.message || "Could not deactivate");
      setBusy(false);
    }
  };

  useCtrlEnter(() => void submit());
  const work = data?.open_work || [];
  return (
    <Modal title={`Deactivate ${nameOf(user)}`} medium onClose={() => { if (!busy) onClose(); }} dirty={reason.trim().length > 0}
      hero={<DialogHero tone="rose" icon={UserX} eyebrow="Access Control" title="Deactivate account"
        subtitle="They cannot sign in from the moment you confirm. Everything they did stays on record under their name."
        person={{ name: nameOf(user), meta: user.email }} />}
      footer={
        <div className="space-y-2">
          <DialogFailure message={err} />
          <DialogActions tone="rose" icon={UserX} label="Deactivate account" busyLabel="Deactivating…" busy={busy}
            disabled={!ok} onCancel={onClose} onConfirm={() => void submit()}
            hint={ok ? "Ctrl + Enter to confirm" : `Give a reason (at least ${DEACTIVATE_REASON_MIN} characters)`} />
        </div>
      }>
      <div className="space-y-4">
        <DialogSection n={1} title="Hand over their open work" tone="rose" done={!!data && work.length === 0}
          hint="Nothing is reassigned automatically — move these to someone else so no notice goes unread.">
          {!data && !loadErr && <p className="text-sm text-muted">Checking…</p>}
          {loadErr && <p className="text-sm text-warning">{loadErr}</p>}
          {data && work.length === 0 && (
            <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 size={16} aria-hidden /> No live work points at them.</p>
          )}
          {work.length > 0 && (
            <ul className="space-y-2">
              {work.map((w) => (
                <li key={w.key} className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/30">
                  <span className="grid h-8 min-w-[2rem] place-items-center rounded-lg bg-amber-500 px-1.5 text-sm font-bold text-[#fff]">{w.count}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-amber-900 dark:text-amber-200">{w.label}</span>
                    <span className="block text-xs text-amber-800/80 dark:text-amber-300/80">{w.hint}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DialogSection>
        <DialogSection n={2} title="Why are they leaving the system?" tone="rose" done={ok}>
          <ReasonBox id="deactivate-reason" label="Reason (kept in the audit log)" value={reason} onChange={setReason}
            required min={DEACTIVATE_REASON_MIN} picks={REASON_PICKS} tone="rose"
            placeholder="e.g. Last working day 30 Sep — moved to the Pune team" />
        </DialogSection>
        <WhatHappens tone="rose" items={[
          { icon: ShieldOff, text: "Signing in stops immediately — any open session ends at its next request." },
          { icon: ArchiveX, text: "Records they created or approved keep their name; nothing is rewritten." },
          { icon: LogIn, text: "You can activate the account again at any time." },
        ]} />
      </div>
    </Modal>
  );
}

export function DeleteUserModal({ user, onClose, onDone, onDeactivateInstead }: {
  user: LifecycleUser;
  onClose: () => void;
  onDone: (message: string) => void;
  onDeactivateInstead: () => void;
}) {
  const { data, err: loadErr } = useOpenWork(user.id);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const history = data?.history || [];
  const blocked = history.length > 0;
  const confirmed = typed.trim().toLowerCase() === user.username.toLowerCase();

  const submit = async () => {
    if (!confirmed || blocked || busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await crmDelete(`/api/users/${user.id}`);
      onDone(res.message || "Account deleted");
    } catch (e: any) {
      setErr(e?.message || "Could not delete");
      setBusy(false);
    }
  };

  return (
    <Modal title={`Delete ${nameOf(user)}`} medium onClose={() => { if (!busy) onClose(); }}
      hero={<DialogHero tone="rose" icon={Trash2} eyebrow="Access Control" title="Delete account"
        subtitle="Only an account that never did anything can be deleted. Everyone else is deactivated, so history stays true."
        person={{ name: nameOf(user), meta: user.email }} />}
      footer={
        <div className="space-y-2">
          <DialogFailure message={err} />
          {blocked ? (
            <div className="flex items-center justify-end gap-2">
              <button type="button" className="rounded-control px-3 py-2 text-sm font-semibold text-secondary hover:text-primary" onClick={onClose}>Close</button>
              <button type="button" onClick={onDeactivateInstead}
                className="inline-flex items-center gap-1.5 rounded-control bg-gradient-to-r from-rose-600 to-red-600 px-4 py-2 text-sm font-semibold text-[#fff] shadow hover:brightness-110">
                <UserX size={15} aria-hidden /> Deactivate instead
              </button>
            </div>
          ) : (
            <DialogActions tone="rose" icon={Trash2} label="Delete permanently" busyLabel="Deleting…" busy={busy}
              disabled={!data || !confirmed} onCancel={onClose} onConfirm={() => void submit()}
              hint={confirmed ? "This cannot be undone" : `Type ${user.username} to confirm`} />
          )}
        </div>
      }>
      {!data && !loadErr && <p className="text-sm text-muted">Checking the account's history…</p>}
      {loadErr && <p className="text-sm text-warning">{loadErr}</p>}
      {data && blocked && (
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
            <div className="text-sm text-amber-900 dark:text-amber-200">
              <b>{nameOf(user)}</b> has history. Deleting would erase who created and approved these records:
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {history.map((h) => (
                  <li key={h.label} className="flex items-center gap-2 text-xs">
                    <span className="rounded-full bg-amber-500 px-2 py-px font-bold text-[#fff]">{h.count}</span> {h.label}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-sm text-secondary">Deactivate the account instead — they cannot sign in, and every record keeps its true owner.</p>
        </div>
      )}
      {data && !blocked && (
        <div className="space-y-3">
          <p className="text-sm text-secondary">
            This account never created, approved or owned anything, so it can be removed completely. The deletion
            itself is recorded in the audit log.
          </p>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-secondary">Type <b className="text-primary">{user.username}</b> to confirm</span>
            <input className={inputCls} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
        </div>
      )}
    </Modal>
  );
}
