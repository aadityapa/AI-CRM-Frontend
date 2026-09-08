/** Branch Rate Card editor — experience-band pricing, embedded in the
 * Customer detail's Branches tab (branch-wise since 0077; the standalone
 * sidebar page is gone).
 *
 * Bands (1–2 yrs … 14–15 yrs) with five OPTIONAL rate columns. Blank = the
 * branch never quoted that unit — rendered as a dash, never as zero, because
 * "free" and "unknown" are different facts. The Opportunity form's Candidate
 * CTC Slab auto-fills from the selected branch's card (customer-wide NULL
 * rows are its fallback).
 *
 * Access: Sales / Sales_Head / Admin / CEO, template-gated ("rate-cards").
 */
import React, { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut } from "../api";
// Local wall-clock date: the server decides "current" with date.today() (IST);
// toISOString() is UTC and lags a day until 05:30 IST (4 Sep 2026 fix).
import { toDateKey } from "../lib/calendarDates";
import { useHasRole } from "../CrmApp";
import { useCanAct } from "../useAccess";
import {
  EmptyState, ErrorBox, Field, Modal, Spinner,
  btnDanger, btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";

type RateRow = {
  id: number;
  customer_id: number;
  branch_id: number | null;
  /** Slab version (0079). NULL = effective since forever (legacy). */
  effective_from: string | null;
  exp_min: number;
  exp_max: number;
  rate_hourly: number | null;
  rate_daily: number | null;
  rate_weekly: number | null;
  rate_monthly: number | null;
  rate_yearly: number | null;
};

const RATE_COLS = [
  ["rate_hourly", "Hourly"],
  ["rate_daily", "Daily"],
  ["rate_weekly", "Weekly"],
  ["rate_monthly", "Monthly"],
  ["rate_yearly", "Yearly"],
] as const;

const fmtSlabDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString() : "the start";

const inr = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `₹${Number(v).toLocaleString("en-IN")}`;

/** Group rows into slab versions: current (latest effective_from <= today),
 * future (starts later), expired (superseded). NULL sorts oldest. */
export function splitSlabVersions(rows: RateRow[]) {
  const today = toDateKey(new Date());
  const keys = [...new Set(rows.map((r) => r.effective_from || ""))].sort();
  const currentKey = [...keys].filter((k) => k <= today).pop();
  const current = currentKey === undefined ? [] : rows.filter((r) => (r.effective_from || "") === currentKey);
  const future = rows.filter((r) => (r.effective_from || "") > today);
  const expired = rows.filter((r) =>
    (r.effective_from || "") <= today && (r.effective_from || "") !== (currentKey ?? "#none"));
  return { current, currentKey: currentKey || null, future, expired };
}

const COL_BY_BILLING: Record<string, { key: (typeof RATE_COLS)[number][0]; label: string }> = {
  Per_Hour: { key: "rate_hourly", label: "Rate (₹/Hour)" },
  Per_Day: { key: "rate_daily", label: "Rate (₹/Day)" },
  Per_Month: { key: "rate_monthly", label: "Rate (₹/Month)" },
  Per_Year: { key: "rate_yearly", label: "Rate (₹/Year)" },
};

export function BranchRateCardEditor({
  customerId,
  branchId,
  branchName,
}: {
  customerId: number;
  branchId: number;
  branchName?: string | null;
}) {
  const roleOk = useHasRole("Sales", "Sales_Head");
  const canView = useCanAct("rate-cards", "view", roleOk);
  const canEdit = useCanAct("rate-cards", "edit", roleOk);
  const canCreate = useCanAct("rate-cards", "create", roleOk);

  const [rows, setRows] = useState<RateRow[]>([]);
  // The branch bills in ONE unit (policy matrix) — the slab shows just that
  // rate column ("1–3 yrs → ₹X"). No billing type set → all five columns.
  const [unitCol, setUnitCol] = useState<{ key: (typeof RATE_COLS)[number][0]; label: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<RateRow | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RateRow | null>(null);
  const [ladderOpen, setLadderOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<RateRow[]>(`/api/rate-cards?customer_id=${customerId}`);
      // This editor owns ONE branch's rows; customer-wide (NULL) legacy rows
      // are managed nowhere else, so show them greyed for context below.
      setRows((res.data || []).filter((r) => r.branch_id === branchId || r.branch_id === null));
    } catch (e: any) {
      setError(e?.message || "Failed to load rate card");
    } finally {
      setLoading(false);
    }
  }, [customerId, branchId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let alive = true;
    crmGet<any>(`/api/customers/branches/${branchId}/effective-policy`)
      .then((r) => {
        if (alive) setUnitCol(COL_BY_BILLING[String(r.data?.billing_type || "")] || null);
      })
      .catch(() => { if (alive) setUnitCol(null); });
    return () => { alive = false; };
  }, [branchId]);

  if (!canView) return <ErrorBox error="You don't have access to the CTC Slab." />;
  if (loading) return <Spinner label="Loading rate card…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;

  const branchRows = rows.filter((r) => r.branch_id === branchId);
  const legacyRows = rows.filter((r) => r.branch_id === null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">
          Experience bands with this branch&rsquo;s agreed rate — e.g. 1–3 yrs → ₹X,
          3–6 yrs → ₹Y. The New Opportunity form&rsquo;s Candidate CTC Slab pulls the
          Rate from here: pick Exp Min + Target Exp and the rest derives itself.
        </p>
        {canCreate && (
          <span className="flex gap-2">
            <button className={btnSecondary} onClick={() => setCopyOpen(true)}>
              Same as another branch…
            </button>
            <button className={btnPrimary} onClick={() => setLadderOpen(true)}>
              <Plus size={15} /> Build ladder
            </button>
          </span>
        )}
      </div>

      {branchRows.length === 0 ? (
        <EmptyState
          message={`No CTC slab for ${branchName || "this branch"} yet. Build the ladder — e.g. 1–3 yrs @ 850, 3–5 yrs @ 1143 — with the date it applies from.`}
        />
      ) : (() => {
        const v = splitSlabVersions(branchRows);
        return (
          <div className="space-y-4">
            {v.future.length > 0 && (
              <div className="rounded-card border border-amber-300/60 bg-amber-50/40 p-3 dark:bg-amber-900/10">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                  Upcoming slab — starts {fmtSlabDate(v.future[0]?.effective_from)}
                </p>
                <RateTable rows={v.future} canEdit={canEdit} unitCol={unitCol}
                  onEdit={setEditing} onDelete={setConfirmDelete} />
              </div>
            )}
            {v.current.length > 0 && (
              <div>
                {/* The start date is ALWAYS shown (17 Aug 2026) — the reader
                    must know since when these rates apply. Legacy ladders
                    saved before versioning have no date; say so plainly
                    instead of hiding the fact. */}
                <p className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Current slab
                  <span className="rounded-full bg-brand-600/10 px-2 py-0.5 font-bold normal-case tracking-normal text-brand-600 dark:text-brand-300">
                    {v.currentKey
                      ? `Effective from ${fmtSlabDate(v.currentKey)}`
                      : "Effective from the beginning (no start date recorded — rebuild the ladder to set one)"}
                  </span>
                </p>
                <RateTable rows={v.current} canEdit={canEdit} unitCol={unitCol}
                  onEdit={setEditing} onDelete={setConfirmDelete} />
              </div>
            )}
            {v.expired.length > 0 && (
              <details className="rounded-card border border-subtle bg-surface-2/40 p-3">
                <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Expired slabs ({[...new Set(v.expired.map((r) => r.effective_from || "start"))].length} version(s))
                </summary>
                <div className="mt-2 opacity-70">
                  <RateTable rows={v.expired} canEdit={canEdit} unitCol={unitCol}
                    onEdit={setEditing} onDelete={setConfirmDelete} />
                </div>
              </details>
            )}
          </div>
        );
      })()}

      {legacyRows.length > 0 && (
        <div className="rounded-card border border-subtle bg-surface-2/40 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Customer-wide bands (apply when a branch has no own card)
          </p>
          <RateTable rows={legacyRows} canEdit={canEdit} unitCol={unitCol}
            onEdit={setEditing} onDelete={setConfirmDelete} />
        </div>
      )}

      {editing && (
        <RateRowModal
          row={editing === "new" ? null : editing}
          customerId={customerId}
          unitCol={unitCol}
          branchId={editing === "new" ? branchId : (editing.branch_id ?? null)}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); showToast("Rate card saved"); }}
        />
      )}

      {copyOpen && (
        <CopyFromBranchModal
          customerId={customerId}
          targetBranchId={branchId}
          targetBranchName={branchName}
          onClose={() => setCopyOpen(false)}
          onCopied={(msg) => { setCopyOpen(false); load(); showToast(msg); }}
        />
      )}

      {ladderOpen && (
        <LadderBuilderModal
          customerId={customerId}
          branchId={branchId}
          unitCol={unitCol}
          existing={branchRows}
          onClose={() => setLadderOpen(false)}
          onSaved={(n) => { setLadderOpen(false); load(); showToast(`${n} band(s) added`); }}
        />
      )}

      {confirmDelete && (
        <Modal title="Delete band" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-secondary">
            Delete the {confirmDelete.exp_min}–{confirmDelete.exp_max} yrs band?
            Opportunities already created keep the rates they were saved with —
            only future auto-fill is affected.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button className={btnSecondary} onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button
              className={btnDanger}
              onClick={async () => {
                try {
                  await crmDelete(`/api/rate-cards/${confirmDelete.id}`);
                  setConfirmDelete(null);
                  load();
                  showToast("Band deleted");
                } catch (e: any) {
                  showToast(e?.message || "Delete failed");
                }
              }}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
      {toast}
    </div>
  );
}

function RateTable({
  rows, canEdit, unitCol, onEdit, onDelete,
}: {
  rows: RateRow[];
  canEdit: boolean;
  unitCol: { key: (typeof RATE_COLS)[number][0]; label: string } | null;
  onEdit: (r: RateRow) => void;
  onDelete: (r: RateRow) => void;
}) {
  // Columns = the branch's billing unit PLUS any other unit that holds data
  // (a customer can quote hourly AND monthly); all five only when nothing
  // narrows it down.
  const withData = RATE_COLS
    .filter(([key]) => rows.some((r) => r[key] != null))
    .map(([key, label]) => ({ key, label }));
  const merged = unitCol
    ? [unitCol, ...withData.filter((c) => c.key !== unitCol.key)]
    : withData;
  const cols: { key: (typeof RATE_COLS)[number][0]; label: string }[] =
    merged.length ? merged : RATE_COLS.map(([key, label]) => ({ key, label }));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
            <th className="px-3 py-2">Experience</th>
            {cols.map((c) => (
              <th key={c.label} className="px-3 py-2 text-right">{c.label}</th>
            ))}
            {canEdit && <th className="px-3 py-2 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="row-hover border-t border-subtle">
              <td className="px-3 py-2 font-semibold text-primary">
                {r.exp_min}–{r.exp_max} yrs
              </td>
              {cols.map((c) => (
                <td key={c.key} className="px-3 py-2 text-right text-secondary">
                  {inr(r[c.key])}
                </td>
              ))}
              {canEdit && (
                <td className="px-3 py-2 text-right">
                  <span className="inline-flex gap-1">
                    <button className={`${btnSecondary} !px-2 !py-1`} title="Edit band"
                      onClick={() => onEdit(r)}>
                      <Pencil size={13} />
                    </button>
                    <button className={`${btnDanger} !px-2 !py-1`} title="Delete band"
                      onClick={() => onDelete(r)}>
                      <Trash2 size={13} />
                    </button>
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------ row modal */

function RateRowModal({
  row,
  customerId,
  branchId,
  unitCol,
  onClose,
  onSaved,
}: {
  row: RateRow | null;
  customerId: number;
  branchId: number | null;
  unitCol: { key: (typeof RATE_COLS)[number][0]; label: string } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [expMin, setExpMin] = useState(row ? String(row.exp_min) : "");
  const [expMax, setExpMax] = useState(row ? String(row.exp_max) : "");
  const [rates, setRates] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const [key] of RATE_COLS) init[key] = row && row[key] != null ? String(row[key]) : "";
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    const lo = Number(expMin);
    const hi = Number(expMax);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
      setError("Enter a valid band — Exp Max must be greater than Exp Min.");
      return;
    }
    const anyRate = RATE_COLS.some(([key]) => rates[key] !== "" && Number(rates[key]) > 0);
    if (!anyRate) {
      setError("Enter at least one rate — the unit this customer actually quoted.");
      return;
    }
    setBusy(true);
    setError("");
    const body: Record<string, unknown> = { exp_min: lo, exp_max: hi };
    for (const [key] of RATE_COLS) {
      body[key] = rates[key] === "" ? null : Number(rates[key]);
    }
    try {
      if (row) await crmPut(`/api/rate-cards/${row.id}`, body);
      else await crmPost("/api/rate-cards", { customer_id: customerId, branch_id: branchId, ...body });
      onSaved();
    } catch (e: any) {
      setError(e?.message || "Save failed");
      setBusy(false);
    }
  };

  return (
    <Modal title={row ? "Edit band" : "Add band"} onClose={onClose}>
      {error && <div className="mb-3"><ErrorBox error={error} /></div>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Exp Min (years)" required>
          <input type="number" min={0} step="0.5" className={inputCls}
            value={expMin} onChange={(e) => setExpMin(e.target.value)} />
        </Field>
        <Field label="Exp Max (years)" required>
          <input type="number" min={0} step="0.5" className={inputCls}
            value={expMax} onChange={(e) => setExpMax(e.target.value)} />
        </Field>
      </div>
      {unitCol ? (
        <div className="mt-4">
          <Field label={unitCol.label} required>
            <input type="number" min={0} step="0.01" className={inputCls}
              value={rates[unitCol.key]}
              onChange={(e) => setRates((m) => ({ ...m, [unitCol.key]: e.target.value }))} />
          </Field>
          <p className="mt-1 text-[11px] text-muted">
            This branch bills {unitCol.label.replace("Rate ", "")} (from its billing
            policy) — one amount per band is all the slab needs.
          </p>
        </div>
      ) : (
        <>
          <p className="mb-2 mt-4 text-xs text-muted">
            No billing type on this branch&rsquo;s policy yet — fill the unit the
            customer quoted; leave the rest blank.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {RATE_COLS.map(([key, label]) => (
              <Field key={key} label={`${label} (₹)`}>
                <input type="number" min={0} step="0.01" className={inputCls}
                  value={rates[key]}
                  onChange={(e) => setRates((m) => ({ ...m, [key]: e.target.value }))} />
              </Field>
            ))}
          </div>
        </>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={busy} onClick={save}>
          {busy ? "Saving…" : row ? "Save changes" : "Add band"}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ ladder builder

   The whole customer ladder in ONE screen — the way rates actually arrive
   ("1–3 @ 850, 3–5 @ 1143, … 12–15 @ 2000"), not one modal per band.
   Each line's From chains from the previous line's To, so a six-slab ladder
   is six Rate keystrokes. Saved as ordinary bands: the Opportunity form's
   Candidate CTC Slab picks the band CONTAINING Exp Min, so year rows like
   8–9 resolve to the 7–10 slab automatically. */

function LadderBuilderModal({
  customerId, branchId, unitCol, existing, onClose, onSaved,
}: {
  customerId: number;
  branchId: number;
  unitCol: { key: (typeof RATE_COLS)[number][0]; label: string } | null;
  existing: RateRow[];
  onClose: () => void;
  onSaved: (added: number) => void;
}) {
  // A ladder is a complete NEW VERSION of the slab (0079): it always starts
  // fresh at year 1 and carries the date it takes effect — the previous
  // version expires by itself the moment this one's date arrives.
  const [effectiveFrom, setEffectiveFrom] = useState(
    () => toDateKey(new Date()));
  const [lines, setLines] = useState<{ from: string; to: string; rate: string }[]>([
    { from: "1", to: "", rate: "" },
  ]);
  // The two units customers actually quote (policy matrix): Hourly or
  // Monthly — chosen per ladder, defaulted from the branch's billing type.
  const [unitKey, setUnitKey] = useState<(typeof RATE_COLS)[number][0]>(
    unitCol?.key === "rate_monthly" ? "rate_monthly"
      : unitCol?.key ?? "rate_hourly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const setLine = (i: number, patch: Partial<{ from: string; to: string; rate: string }>) => {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };
  const addLine = () => {
    setLines((ls) => {
      const last = ls[ls.length - 1];
      return [...ls, { from: last?.to || "", to: "", rate: "" }];
    });
  };
  const removeLine = (i: number) =>
    setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  const save = async () => {
    const parsed: { from: number; to: number; rate: number }[] = [];
    for (const [i, l] of lines.entries()) {
      if (l.from === "" && l.to === "" && l.rate === "") continue;  // blank line
      const from = Number(l.from);
      const to = Number(l.to);
      const rate = Number(l.rate);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from
          || !Number.isFinite(rate) || rate <= 0) {
        setError(`Line ${i + 1}: need From < To and a rate above zero.`);
        return;
      }
      const prev = parsed[parsed.length - 1];
      if (prev && from < prev.to) {
        setError(`Line ${i + 1}: overlaps the previous slab (starts at ${from}, previous ends at ${prev.to}).`);
        return;
      }
      parsed.push({ from, to, rate });
    }
    if (!parsed.length) {
      setError("Add at least one slab line.");
      return;
    }
    if (!effectiveFrom) {
      setError("Pick the date this slab applies from.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      for (const p of parsed) {
        await crmPost("/api/rate-cards", {
          customer_id: customerId,
          branch_id: branchId,
          effective_from: effectiveFrom,
          exp_min: p.from,
          exp_max: p.to,
          [unitKey]: p.rate,
        });
      }
      onSaved(parsed.length);
    } catch (e: any) {
      setError(e?.message || "Save failed — earlier lines may already be saved. A ladder with this exact effective date may already exist; pick a different date or delete it below.");
      setBusy(false);
    }
  };

  const unitLabel = RATE_COLS.find(([k]) => k === unitKey)?.[1] || "Rate";

  return (
    <Modal title="Build the CTC slab ladder" onClose={onClose}>
      {error && <div className="mb-3"><ErrorBox error={error} /></div>}
      <p className="mb-3 text-xs text-muted">
        Enter the whole ladder at once — e.g. 1–3 @ 850, 3–5 @ 1143 … 12–15 @ 2000.
        From the effective date below, THIS ladder is the branch&rsquo;s slab and the
        previous one expires automatically; opportunities created before that date
        keep the rates they were built with.
      </p>
      <label className="mb-3 block">
        <span className="mb-1 block text-[11px] font-semibold text-muted">Effective from</span>
        <input type="date" className={`${inputCls} !w-auto`}
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)} />
      </label>
      <div className="mb-3">
        <span className="mb-1 block text-[11px] font-semibold text-muted">This ladder&rsquo;s rates are</span>
        <div className="flex gap-2">
          {([["rate_hourly", "Per Hour"], ["rate_monthly", "Per Month"]] as const).map(([key, label]) => (
            <button key={key} type="button"
              className={`rounded-control px-3 py-1.5 text-xs font-semibold transition-colors duration-micro ease-smooth ${
                unitKey === key
                  ? "bg-brand-600 text-white"
                  : "border border-subtle bg-surface-2 text-secondary hover:text-primary"
              }`}
              onClick={() => setUnitKey(key)}>
              {label}
            </button>
          ))}
        </div>
        {unitCol && unitCol.key !== unitKey && (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
            Note: this branch&rsquo;s billing policy is {unitCol.label.replace("Rate ", "")} —
            the Opportunity form picks the column matching its Billing Type.
          </p>
        )}
      </div>
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_1fr_1.4fr_auto] gap-2 text-[11px] font-semibold text-muted">
          <span>From (yrs)</span><span>To (yrs)</span><span>{unitLabel} rate (₹)</span><span />
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1.4fr_auto] items-center gap-2">
            <input type="number" min={0} step="0.5" className={inputCls}
              value={l.from} onChange={(e) => setLine(i, { from: e.target.value })} />
            <input type="number" min={0} step="0.5" className={inputCls}
              value={l.to} onChange={(e) => setLine(i, { to: e.target.value })} />
            <input type="number" min={0} step="0.01" className={inputCls}
              placeholder="e.g. 850"
              value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} />
            <button type="button" aria-label={`Remove line ${i + 1}`}
              className="rounded-control p-1.5 text-muted hover:bg-surface-2 hover:text-danger"
              onClick={() => removeLine(i)}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className={`${btnSecondary} mt-3`} onClick={addLine}>
        <Plus size={14} /> Add slab line
      </button>
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save ladder"}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------ copy from branch

   "Same as primary branch": most customers quote ONE ladder and every branch
   bills it. This copies the source branch's CURRENT slab version into this
   branch as a new version here — a COPY, not a link, so this branch can
   diverge later without silently repricing the source. */

function CopyFromBranchModal({
  customerId, targetBranchId, targetBranchName, onClose, onCopied,
}: {
  customerId: number;
  targetBranchId: number;
  targetBranchName?: string | null;
  onClose: () => void;
  onCopied: (msg: string) => void;
}) {
  const [branches, setBranches] = useState<{ id: number; branch_name: string; is_primary?: boolean }[]>([]);
  const [sourceId, setSourceId] = useState<string>("");
  const [effectiveFrom, setEffectiveFrom] = useState(
    () => toDateKey(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    crmGet<any[]>(`/api/customers/${customerId}/branches`)
      .then((r) => {
        if (!alive) return;
        const others = (r.data || []).filter((b: any) => b.id !== targetBranchId);
        setBranches(others);
        // Default to the PRIMARY branch — the usual source of truth.
        const primary = others.find((b: any) => b.is_primary);
        setSourceId(String((primary || others[0])?.id ?? ""));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [customerId, targetBranchId]);

  const save = async () => {
    if (!sourceId) {
      setError("Pick the branch to copy from.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await crmPost<any[]>("/api/rate-cards/copy-from-branch", {
        customer_id: customerId,
        source_branch_id: Number(sourceId),
        target_branch_id: targetBranchId,
        effective_from: effectiveFrom || null,
      });
      onCopied(res.message || "Slab copied");
    } catch (e: any) {
      setError(e?.message || "Copy failed");
      setBusy(false);
    }
  };

  const srcName = branches.find((b) => String(b.id) === sourceId)?.branch_name;

  return (
    <Modal title={`Copy CTC slab into ${targetBranchName || "this branch"}`} onClose={onClose}>
      {error && <div className="mb-3"><ErrorBox error={error} /></div>}
      <p className="mb-3 text-xs text-muted">
        Copies the source branch&rsquo;s CURRENT slab (every band and rate) into{" "}
        {targetBranchName || "this branch"} as a new version from the date below.
        It&rsquo;s a copy — editing either branch later never changes the other.
      </p>
      <Field label="Copy from branch" required>
        <select className={inputCls} value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}>
          <option value="">— pick a branch —</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.branch_name}{b.is_primary ? " (Primary)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <div className="mt-3">
        <Field label="Effective from" required>
          <input type="date" className={`${inputCls} !w-auto`}
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={busy || !sourceId} onClick={save}>
          {busy ? "Copying…" : srcName ? `Copy ${srcName}'s slab` : "Copy slab"}
        </button>
      </div>
    </Modal>
  );
}
