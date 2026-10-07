/**
 * Positions (headcount) — shared by the Requirement page and the Opportunity page.
 *
 * `requirements.no_of_positions` is the sourcing target: TA works against it and
 * fulfilment measures Joined candidates against it. Sales owns the customer
 * conversation that changes it, RMG owns delivery — so the number moves only
 * through an approved request (21 Sep 2026, user flow).
 *
 * It lives in `components/` because Sales never opens the Requirement page: the
 * Requirements sub-tab was removed in Aug 2026, so a Sales login reaches this
 * only from the OPPORTUNITY detail page. One component, two mount points.
 *
 * The panel never guesses permissions from roles — the server returns
 * `can_request` / `can_approve` / `is_requester` / `min_positions` /
 * `change_blocked` in `meta` and this renders exactly that.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Check, Minus, Plus, TrendingUp, X } from "lucide-react";

import { crmGet, crmPost } from "../api";
import {
  Modal, SkeletonText, StatusBadge, btnDanger, btnPrimary, btnSecondary, inputCls,
} from "./ui";

type ToastFn = (msg: string, kind?: "ok" | "err") => void;

/** The minimum a caller must know to render this. */
export type PositionsTarget = {
  /** `requirements.id` — the row the headcount belongs to. */
  requirementId: number;
  /** Human label, e.g. "C-2026-00089" or "REQ-12". */
  label?: string | null;
  /** Role title, shown in the modals. */
  title?: string | null;
  /** Requirement status, e.g. "In_Progress" (drives the blocked message only). */
  status?: string | null;
};

const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : "—");

export type PositionRequest = {
  id: number;
  requirement_id: number;
  status: "Pending" | "Approved" | "Rejected";
  from_positions: number;
  to_positions: number;
  delta: number;
  direction: "increase" | "decrease";
  reason: string;
  status_before?: string | null;
  status_after?: string | null;
  joined_at_decision?: number | null;
  requested_by?: number | null;
  requested_by_name?: string | null;
  requested_at?: string | null;
  decided_by_name?: string | null;
  decided_at?: string | null;
  decision_note?: string | null;
};

type PositionsMeta = {
  positions_total: number;
  positions_joined: number;
  positions_open: number;
  pending_id: number | null;
  pending: PositionRequest | null;
  can_request: boolean;
  can_approve: boolean;
  is_requester: boolean;
  min_positions: number;
  max_positions: number;
  change_blocked: boolean;
};

const POSITION_MIN_REASON = 10;

function PositionChangeModal({
  target, meta, onClose, onDone, toast,
}: {
  target: PositionsTarget;
  meta: PositionsMeta;
  onClose: () => void;
  onDone: () => void;
  toast: ToastFn;
}) {
  const [value, setValue] = useState(String(meta.positions_total));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const wanted = Number(value);
  const delta = Number.isFinite(wanted) ? wanted - meta.positions_total : 0;
  const dirty = value !== String(meta.positions_total) || reason.trim() !== "";

  const submit = async () => {
    setErr("");
    if (!Number.isInteger(wanted) || wanted < 1) { setErr("Enter a whole number of positions (1 or more)."); return; }
    if (wanted === meta.positions_total) { setErr(`This opportunity already has ${meta.positions_total} position(s).`); return; }
    if (wanted < meta.min_positions) {
      setErr(`${meta.min_positions} candidate(s) have already joined, so the count cannot go below ${meta.min_positions}.`);
      return;
    }
    if (reason.trim().length < POSITION_MIN_REASON) {
      setErr(`Give a reason of at least ${POSITION_MIN_REASON} characters — RMG sees it.`);
      return;
    }
    setBusy(true);
    try {
      const res = await crmPost<any>(`/api/requirements/${target.requirementId}/position-requests`,
        { to_positions: wanted, reason: reason.trim() });
      toast(res?.message || "Sent to RMG for approval");
      onDone();
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Could not send the request");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Change number of positions" onClose={onClose} dirty={dirty} footer={
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={btnPrimary} onClick={() => void submit()} disabled={busy}>
          {busy ? "Sending…" : "Send for approval"}
        </button>
      </div>
    }>
      <div className="space-y-4">
        <p className="text-xs text-muted">
          {target.label || `#${target.requirementId}`}{target.title ? ` · ${target.title}` : ""} · currently{" "}
          <strong className="text-primary">{meta.positions_total}</strong> position(s),{" "}
          {meta.positions_joined} filled, {meta.positions_open} open.
        </p>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">New number of positions</label>
          <div className="flex items-center gap-2">
            <button type="button" className={`${btnSecondary} !px-2.5`} aria-label="Decrease"
                    onClick={() => setValue(String(Math.max(meta.min_positions || 1, (Number(value) || 1) - 1)))}>
              <Minus size={14} />
            </button>
            <input className={`${inputCls} !w-24 text-center`} type="number" min={Math.max(1, meta.min_positions)}
                   max={meta.max_positions} value={value} onChange={(e) => setValue(e.target.value)} />
            <button type="button" className={`${btnSecondary} !px-2.5`} aria-label="Increase"
                    onClick={() => setValue(String(Math.min(meta.max_positions, (Number(value) || 0) + 1)))}>
              <Plus size={14} />
            </button>
            {delta !== 0 && Number.isFinite(delta) && (
              <span className={`text-sm font-semibold ${delta > 0 ? "text-success" : "text-danger"}`}>
                {delta > 0 ? `+${delta}` : delta}
              </span>
            )}
          </div>
          {meta.min_positions > 0 && (
            <p className="mt-1 text-xs text-muted">
              Minimum {meta.min_positions} — that many candidate(s) have already joined on this opportunity.
            </p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Reason (RMG sees this)</label>
          <textarea className={`${inputCls} min-h-[90px]`} value={reason} onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Customer approved two more heads for the Wi-Fi track from October" />
        </div>
        {err && <div className="text-sm text-danger">{err}</div>}
      </div>
    </Modal>
  );
}

function PositionDecisionModal({
  target, pending, mode, onClose, onDone, toast,
}: {
  target: PositionsTarget;
  pending: PositionRequest;
  mode: "approve" | "reject";
  onClose: () => void;
  onDone: () => void;
  toast: ToastFn;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const rejecting = mode === "reject";

  const submit = async () => {
    setErr("");
    if (rejecting && note.trim().length < POSITION_MIN_REASON) {
      setErr(`Say why (at least ${POSITION_MIN_REASON} characters) — the requester sees it.`);
      return;
    }
    setBusy(true);
    try {
      const res = await crmPost<any>(
        `/api/requirements/${target.requirementId}/position-requests/${pending.id}/${mode}`,
        { note: note.trim() || null });
      toast(res?.message || (rejecting ? "Position change rejected" : "Position change approved"));
      onDone();
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Could not save the decision");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={rejecting ? "Reject position change" : "Approve position change"} onClose={onClose} dirty={note.trim() !== ""} footer={
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={rejecting ? btnDanger : btnPrimary} onClick={() => void submit()} disabled={busy}>
          {busy ? "Saving…" : rejecting ? "Reject" : "Approve"}
        </button>
      </div>
    }>
      <div className="space-y-3">
        <p className="text-sm text-secondary">
          <strong className="text-primary">{pending.requested_by_name || "Sales"}</strong> asks to{" "}
          {pending.direction === "increase" ? "increase" : "reduce"} positions from{" "}
          <strong className="text-primary">{pending.from_positions}</strong> to{" "}
          <strong className="text-primary">{pending.to_positions}</strong> on {target.title || target.label || "this opportunity"}.
        </p>
        <div className="rounded-control border border-subtle bg-surface-2 px-3 py-2 text-sm text-secondary">
          {pending.reason}
        </div>
        {!rejecting && pending.direction === "increase" && (
          <p className="text-xs text-muted">
            Approving raises the sourcing target — TA is notified, and hiring reopens if it was already fulfilled.
          </p>
        )}
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">
            {rejecting ? "Why (required)" : "Note (optional)"}
          </label>
          <textarea className={`${inputCls} min-h-[80px]`} value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder={rejecting ? "e.g. No delivery capacity before January" : "Anything the requester should know"} />
        </div>
        {err && <div className="text-sm text-danger">{err}</div>}
      </div>
    </Modal>
  );
}

/** Positions card: the live count, the pending decision (if any) and the full
 *  change history. Mounted on the opportunity page (where Sales works) and on
 *  the requirement page. */
export function PositionsPanel({ target, toast, onChanged }:
  { target: PositionsTarget; toast: ToastFn; onChanged?: () => void }) {
  const [rows, setRows] = useState<PositionRequest[]>([]);
  const [meta, setMeta] = useState<PositionsMeta | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [showChange, setShowChange] = useState(false);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [tick, setTick] = useState(0);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    crmGet<PositionRequest[]>(`/api/requirements/${target.requirementId}/position-requests`)
      .then((res) => {
        if (!alive) return;
        setRows(res.data || []);
        setMeta((res.meta as unknown as PositionsMeta) || null);
      })
      .catch((e: any) => {
        // Say WHY rather than vanishing — a silent empty space is
        // indistinguishable from "this feature isn't deployed". The server's
        // copy already speaks in opportunities, never "requirement".
        if (alive) { setMeta(null); setErr(e?.message || "Positions could not be loaded"); }
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [target.requirementId, tick]);

  const refresh = () => { setTick((t) => t + 1); onChanged?.(); };

  if (loading && !meta) {
    return <div className="rounded-card border border-subtle bg-surface-1 px-4 py-3"><SkeletonText lines={2} /></div>;
  }
  if (!meta) {
    if (!err) return null;
    return (
      <div className="rounded-card border border-subtle bg-surface-1 px-4 py-2.5 text-xs text-muted">
        Positions: {err}
      </div>
    );
  }

  const pending = meta.pending;
  const decided = rows.filter((r) => r.status !== "Pending");

  return (
    <div className="rounded-card border border-subtle bg-surface-1 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Positions</div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className={`text-lg font-bold tabular-nums ${meta.positions_open === 0 ? "text-success" : "text-primary"}`}>
                {meta.positions_open}
              </span>
              <span className="text-sm text-muted">open of {meta.positions_total}</span>
            </div>
          </div>
          <div className="hidden sm:block">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Filled</div>
            <div className="mt-0.5 text-lg font-bold tabular-nums text-primary">{meta.positions_joined}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {decided.length > 0 && (
            <button type="button" className={`${btnSecondary} !py-1.5 text-xs`} onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? "Hide" : "History"} ({decided.length})
            </button>
          )}
          {meta.can_request && !pending && !meta.change_blocked && (
            <button type="button" className={`${btnSecondary} !py-1.5 text-xs`} onClick={() => setShowChange(true)}>
              <TrendingUp size={13} /> Change positions
            </button>
          )}
        </div>
      </div>

      {meta.change_blocked && (
        <p className="border-t border-subtle px-4 py-2 text-xs text-muted">
          Hiring here is {(target.status || "closed").replace(/_/g, " ")} — reopen it before changing the headcount.
        </p>
      )}

      {pending && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-amber-300/60 bg-amber-50 px-4 py-2.5 dark:border-amber-700 dark:bg-amber-950/30">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            <AlertTriangle size={14} className="mr-1 inline" />
            <strong>{pending.requested_by_name || "Sales"}</strong> asks to change positions{" "}
            {pending.from_positions} → <strong>{pending.to_positions}</strong> — awaiting RMG.
            <span className="ml-1 opacity-90">Reason: {pending.reason}</span>
          </p>
          <div className="flex shrink-0 gap-2">
            {meta.can_approve && (
              <>
                <button type="button" className={`${btnPrimary} !py-1.5 text-xs`} onClick={() => setDecision("approve")}>
                  <Check size={13} /> Approve
                </button>
                <button type="button" className={`${btnDanger} !py-1.5 text-xs`} onClick={() => setDecision("reject")}>
                  <X size={13} /> Reject
                </button>
              </>
            )}
            {meta.is_requester && (
              <button
                type="button"
                className={`${btnSecondary} !py-1.5 text-xs`}
                onClick={async () => {
                  try {
                    await crmPost(`/api/requirements/${target.requirementId}/position-requests/${pending.id}/cancel`, {});
                    toast("Request withdrawn");
                    refresh();
                  } catch (e: any) {
                    toast(e?.message || "Could not withdraw", "err");
                  }
                }}
              >
                Withdraw
              </button>
            )}
          </div>
        </div>
      )}

      {showHistory && decided.length > 0 && (
        <ul className="divide-y divide-subtle border-t border-subtle">
          {decided.map((r) => (
            <li key={r.id} className="px-4 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={r.status} />
                <span className="font-semibold text-primary tabular-nums">{r.from_positions} → {r.to_positions}</span>
                <span className="text-muted">
                  asked by {r.requested_by_name || "—"}
                  {r.decided_by_name ? ` · ${r.status === "Approved" ? "approved" : "closed"} by ${r.decided_by_name}` : ""}
                  {r.decided_at ? ` · ${fmtDate(r.decided_at)}` : ""}
                </span>
                {r.status_before && r.status_after && r.status_before !== r.status_after && (
                  <span className="text-muted">· {r.status_before.replace(/_/g, " ")} → {r.status_after.replace(/_/g, " ")}</span>
                )}
              </div>
              <div className="mt-0.5 text-secondary">{r.reason}</div>
              {r.decision_note && <div className="mt-0.5 text-muted">Note: {r.decision_note}</div>}
            </li>
          ))}
        </ul>
      )}

      {showChange && (
        <PositionChangeModal target={target} meta={meta} toast={toast}
                             onClose={() => setShowChange(false)} onDone={refresh} />
      )}
      {decision && pending && (
        <PositionDecisionModal target={target} pending={pending} mode={decision} toast={toast}
                               onClose={() => setDecision(null)} onDone={refresh} />
      )}
    </div>
  );
}

