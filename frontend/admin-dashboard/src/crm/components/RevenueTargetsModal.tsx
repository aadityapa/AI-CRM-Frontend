/**
 * Revenue targets dialog (28 Sep 2026) — ONE dialog for the Revenue report and
 * the CEO dashboard. Four rungs, all rupees before GST:
 *
 *   · this MONTH's target        → `revenue.target.<YYYY-MM>` (override)
 *   · this QUARTER's target      → spread evenly over its three months as
 *                                  overrides — targets are STORED per month, so
 *                                  the three zooms can never disagree
 *   · this FINANCIAL YEAR's      → `revenue.target_fy.<start year>` (per FY;
 *                                  the old single key stays as the default)
 *   · the DEFAULT monthly target → `revenue.target_month_default`
 *
 * The server does the spreading (`PUT /api/reports/revenue/targets` with
 * `quarter_target`), so this file never computes a rupee. The month / quarter /
 * FY rungs are named after the ANCHOR month the caller passes, whatever zoom the
 * page is on.
 */
import React, { useState } from "react";

import { crmPut } from "../api";
import { Field, Modal, btnPrimary, btnSecondary, inputCls } from "./ui";
import { fyLabel, fyOfMonth } from "./controlTower";

/** The `targets` section of the Revenue report / CEO Finance tab — the fields this dialog reads. */
export type TargetsForModal = {
  month_target: number | null; month_target_is_default: boolean;
  fy_label: string; fy_target: number | null; fy_target_is_default?: boolean;
  anchor_month?: string; anchor_month_target?: number | null; anchor_month_target_is_override?: boolean;
  quarter_label?: string; quarter_target?: number | null; quarter_months_with_target?: number;
};

/** "2026-09" → "September 2026". */
export function monthLabelOf(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

const asText = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function RevenueTargetsModal({ month, targets, onClose, onSaved }: {
  month: string; targets: TargetsForModal; onClose: () => void; onSaved: (msg: string) => void;
}) {
  // Month: the anchor's own override (older payloads only carry the period figure — fall back to it at the month zoom).
  const monthOverride = targets.anchor_month_target_is_override ? targets.anchor_month_target
    : targets.anchor_month === undefined && !targets.month_target_is_default ? targets.month_target : null;
  const defaultMonthly = targets.anchor_month === undefined
    ? (targets.month_target_is_default ? targets.month_target : null)
    : (!targets.anchor_month_target_is_override ? targets.anchor_month_target ?? null : null);
  const initial = {
    month: asText(monthOverride), quarter: asText(targets.quarter_target),
    fy: asText(targets.fy_target_is_default ? null : targets.fy_target), def: asText(defaultMonthly),
  };
  const [monthTarget, setMonthTarget] = useState(initial.month);
  const [quarterTarget, setQuarterTarget] = useState(initial.quarter);
  const [fyTarget, setFyTarget] = useState(initial.fy);
  const [defaultTarget, setDefaultTarget] = useState(initial.def);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));
  const fy = targets.fy_label || fyLabel(fyOfMonth(month));
  const quarter = targets.quarter_label || "this quarter";
  const canQuarter = targets.quarter_target !== undefined;

  const save = async () => {
    const m = num(monthTarget), q = num(quarterTarget), f = num(fyTarget), d = num(defaultTarget);
    if ([m, q, f, d].some((v) => v !== null && (!Number.isFinite(v) || v < 0))) {
      setErr("Targets must be positive numbers (rupees, excl. GST)."); return;
    }
    setSaving(true); setErr("");
    try {
      // Only the rungs that CHANGED are written — a blank month field must not
      // erase the share a quarter target just spread onto this month. The
      // quarter goes first so an explicit month value still wins over it.
      if (canQuarter && quarterTarget !== initial.quarter) {
        await crmPut("/api/reports/revenue/targets", { month, quarter_target: q, clear_quarter_target: q === null });
      }
      if (monthTarget !== initial.month) {
        await crmPut("/api/reports/revenue/targets", { month, month_target: m, clear_month_target: m === null });
      }
      if (fyTarget !== initial.fy) {
        await crmPut("/api/reports/revenue/targets", { month, fy_target: f, clear_fy_target: f === null });
      }
      if (defaultTarget !== initial.def) {
        await crmPut("/api/reports/revenue/targets", { month_target: d, clear_month_target: d === null });
      }
      onSaved("Revenue targets saved");
    } catch (e: any) {
      setErr(e?.message || "Could not save targets");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Revenue targets" onClose={onClose} footer={
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className={btnPrimary} onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save targets"}</button>
      </div>
    }>
      <div className="space-y-4">
        <p className="text-sm text-secondary">All figures in rupees, before GST. Leave a field blank to remove that target. Targets are kept per month, so a quarter is spread evenly over its three months and the three zooms always agree.</p>
        <Field label={`Monthly — ${monthLabelOf(month)} (overrides the default)`}>
          <input className={inputCls} inputMode="numeric" value={monthTarget} onChange={(e) => setMonthTarget(e.target.value)} placeholder="e.g. 2500000" />
        </Field>
        {canQuarter && (
          <Field label={`Quarterly — ${quarter} (spread over its three months)`}>
            <input className={inputCls} inputMode="numeric" value={quarterTarget} onChange={(e) => setQuarterTarget(e.target.value)} placeholder="e.g. 7500000" />
            {targets.quarter_months_with_target !== undefined && targets.quarter_months_with_target > 0 && targets.quarter_months_with_target < 3 && (
              <p className="mt-1 text-xs text-muted">Only {targets.quarter_months_with_target} of the 3 months have a target today.</p>
            )}
          </Field>
        )}
        <Field label={`Yearly — ${fy} (April–March)`}>
          <input className={inputCls} inputMode="numeric" value={fyTarget} onChange={(e) => setFyTarget(e.target.value)} placeholder="e.g. 30000000" />
          {targets.fy_target_is_default && targets.fy_target !== null && (
            <p className="mt-1 text-xs text-muted">Currently using the default FY target of ₹{targets.fy_target.toLocaleString("en-IN")} — type a value to set one for {fy} alone.</p>
          )}
        </Field>
        <Field label="Default monthly target (used when a month has no override)">
          <input className={inputCls} inputMode="numeric" value={defaultTarget} onChange={(e) => setDefaultTarget(e.target.value)} placeholder="e.g. 2000000" />
        </Field>
        {err && <div className="text-sm text-danger">{err}</div>}
      </div>
    </Modal>
  );
}
