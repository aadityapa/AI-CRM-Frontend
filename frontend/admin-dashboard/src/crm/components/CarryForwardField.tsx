import React from "react";
import { inputCls } from "./ui";

/** "What happens to the unused balance when the leave expires" (11 Sep 2026,
 *  user request — Earned Leave carries into the next year, Casual/Sick lapse).
 *
 *  Stored on `maximum_carry_forward`:  "0" = lapse · "" = carry ALL · "N" =
 *  carry up to N days. One control for the customer, branch and project
 *  dialogs so the three never drift. */
export function CarryForwardField({
  value,
  onChange,
  error,
  expireCycle,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  expireCycle?: string;
}) {
  const mode: "lapse" | "all" | "cap" = value === "" ? "all" : Number(value) === 0 ? "lapse" : "cap";
  const when = expireCycle ? expireCycle.toLowerCase() : "expiry";
  return (
    <div>
      <span className="mb-1 block text-xs font-semibold text-secondary">At expiry — unused balance</span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px]">
        <select
          className={inputCls}
          value={mode}
          onChange={(e) => {
            const m = e.target.value;
            onChange(m === "lapse" ? "0" : m === "all" ? "" : (Number(value) > 0 ? value : "5"));
          }}
        >
          <option value="lapse">Lapses (balance resets each {when})</option>
          <option value="all">Carries forward — all remaining days</option>
          <option value="cap">Carries forward — up to a maximum</option>
        </select>
        {mode === "cap" && (
          <input
            type="number"
            step={1}
            min={1}
            className={inputCls}
            value={value}
            placeholder="days"
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted">
        {mode === "lapse" && "Whatever is left at the end of the cycle is written off (recorded in the leave ledger)."}
        {mode === "all" && "The whole remaining balance moves into the next cycle; the ledger records the carry."}
        {mode === "cap" && "Up to this many days move into the next cycle; the rest is written off — both recorded in the ledger."}
      </p>
      {error && <p className="mt-1 text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
}
