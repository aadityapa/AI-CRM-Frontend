import React from "react";
import type { BillingBreakdown, InvoiceFormat, InvoiceLine } from "./types";
import { displayOrDash, formatINR, padLines } from "./utils";
import styles from "./taxInvoice.module.css";

const qtyFmt = (v: number | null | undefined) =>
  v == null ? displayOrDash(null) : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const plain = (v: number | null | undefined) => (v == null ? displayOrDash(null) : formatINR(v, { withSymbol: false }));

/**
 * Service-table columns, mirroring the server's ONE definition
 * (B-V2 `services/tax_invoice.py::service_columns`): the print order, which
 * keys are optional (`sac` · `leave` · `per_day` — B-V2 `invoice_format.py`)
 * and which only exist with a billing breakdown (`cost` · `qty` · `leave` ·
 * `per_day`) or on the plain manual-invoice table (`hours` · `rate`).
 * A column the customer switched off is absent here exactly as in the PDF.
 */
type ColKey = "sno" | "desc" | "sac" | "cost" | "qty" | "leave" | "per_day" | "hours" | "rate" | "amount";
const ORDER: ColKey[] = ["sno", "desc", "sac", "cost", "qty", "leave", "per_day", "hours", "rate", "amount"];
const OPTIONAL: ReadonlySet<ColKey> = new Set(["sac", "leave", "per_day"]);
/** Width share per column; `desc` takes whatever is left. */
const WIDTH: Record<Exclude<ColKey, "desc">, number> = {
  sno: 5, sac: 8, cost: 12, qty: 9, leave: 8, per_day: 15, hours: 14, rate: 14, amount: 16,
};

export function serviceColumns(
  billing: BillingBreakdown | null | undefined,
  qtyLabel?: string | null,
  rateLabel?: string | null,
): { key: ColKey; label: string; width: number }[] {
  const cols = billing?.columns || null;
  const fmt: InvoiceFormat = { sac: true, leave: true, per_day: true, ...(billing?.invoice_format || {}) };
  const labels: Partial<Record<ColKey, string>> = { sno: "S.No", desc: "Description of Services", sac: "SAC Code" };
  if (cols) {
    Object.assign(labels, { cost: cols.cost, qty: cols.qty, leave: cols.leave, per_day: cols.per_day, amount: cols.amount });
  } else {
    Object.assign(labels, { hours: qtyLabel || "Billing Hours", rate: rateLabel || "Rate/Hour", amount: "Amount" });
  }
  const keys = ORDER.filter((k) => labels[k] != null && (!OPTIONAL.has(k) || fmt[k as keyof InvoiceFormat] !== false));
  const used = keys.reduce((s, k) => s + (k === "desc" ? 0 : WIDTH[k as Exclude<ColKey, "desc">]), 0);
  return keys.map((key) => ({
    key, label: labels[key] as string,
    width: key === "desc" ? Math.max(20, 100 - used) : WIDTH[key as Exclude<ColKey, "desc">],
  }));
}

function cell(line: InvoiceLine, key: ColKey, defaultSac?: string | null): React.ReactNode {
  switch (key) {
    case "sno": return line.s_no;
    case "desc":
      return (
        <>
          {displayOrDash(line.description)}
          {line.period_label ? <div className={styles.periodNote}>Billing period {line.period_label}</div> : null}
        </>
      );
    case "sac": return displayOrDash(line.sac_code || defaultSac);
    case "cost": return plain(line.monthly_cost ?? line.rate_per_hour ?? line.rate);
    case "qty": return qtyFmt(line.qty_days ?? line.billing_hours ?? line.qty);
    case "leave": return qtyFmt(line.leave_days ?? 0);
    case "per_day": return plain(line.rate_per_day);
    case "hours": return qtyFmt(line.billing_hours ?? line.qty);
    case "rate": return formatINR(line.rate_per_hour ?? line.rate);
    case "amount": return plain(line.amount);
  }
}

const NUMERIC: ReadonlySet<ColKey> = new Set(["cost", "qty", "leave", "per_day", "hours", "rate", "amount"]);

export function InvoiceTable({
  lines,
  defaultSac,
  qtyLabel,
  rateLabel,
  billing,
}: {
  lines: InvoiceLine[];
  defaultSac?: string | null;
  /** Server-resolved from the PE billing unit; hourly wording is only the
      fallback for payloads predating qty_label/rate_label. */
  qtyLabel?: string | null;
  rateLabel?: string | null;
  /** Billing breakdown (11 Sep 2026): when present the table prints the
      reference layout — cost basis · Qty (Days/Hours) · Leave · Rate Per Day
      · Amount — with wording that follows the assignment's billing unit,
      minus whatever columns the customer's `invoice_format` switches off. */
  billing?: BillingBreakdown | null;
}) {
  const rows = padLines(lines, 5);
  const columns = serviceColumns(billing, qtyLabel, rateLabel);
  const wide = !!billing?.columns;

  return (
    <div className={styles.tableWrap}>
      <table className={`${styles.table} ${wide ? styles.tableWide : ""}`}>
        <colgroup>
          {columns.map((c) => <col key={c.key} style={{ width: `${c.width}%` }} />)}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={NUMERIC.has(c.key) ? styles.num : undefined}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((line, idx) =>
            line ? (
              <tr key={line.id ?? `line-${line.s_no}-${idx}`}>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={[NUMERIC.has(c.key) ? styles.num : "", c.key === "amount" && wide ? styles.amountCell : ""]
                      .filter(Boolean).join(" ") || undefined}
                  >
                    {cell(line, c.key, defaultSac)}
                  </td>
                ))}
              </tr>
            ) : (
              <tr key={`blank-${idx}`}>
                {columns.map((c, i) => (
                  <td key={c.key} className={NUMERIC.has(c.key) ? styles.num : undefined}>{i === 0 ? " " : null}</td>
                ))}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
