import React from "react";
import type { BillingBreakdown, InvoiceLine } from "./types";
import { displayOrDash, formatINR, padLines } from "./utils";
import styles from "./taxInvoice.module.css";

const qtyFmt = (v: number | null | undefined) =>
  v == null ? displayOrDash(null) : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const plain = (v: number | null | undefined) => (v == null ? displayOrDash(null) : formatINR(v, { withSymbol: false }));

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
      · Amount — with wording that follows the assignment's billing unit
      (hourly / daily / monthly / yearly). */
  billing?: BillingBreakdown | null;
}) {
  const rows = padLines(lines, 5);
  const cols = billing?.columns || null;

  if (cols) {
    return (
      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.tableWide}`}>
          <colgroup>
            <col style={{ width: "5%" }} />
            <col style={{ width: "27%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "16%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>S.No</th>
              <th>Description of Services</th>
              <th>SAC Code</th>
              <th className={styles.num}>{cols.cost}</th>
              <th className={styles.num}>{cols.qty}</th>
              <th className={styles.num}>{cols.leave}</th>
              <th className={styles.num}>{cols.per_day}</th>
              <th className={styles.num}>{cols.amount}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((line, idx) => {
              if (!line) {
                return (
                  <tr key={`blank-${idx}`}>
                    <td>&nbsp;</td><td /><td />
                    <td className={styles.num} /><td className={styles.num} /><td className={styles.num} />
                    <td className={styles.num} /><td className={styles.num} />
                  </tr>
                );
              }
              const cost = line.monthly_cost ?? line.rate_per_hour ?? line.rate;
              const qty = line.qty_days ?? line.billing_hours ?? line.qty;
              return (
                <tr key={line.id ?? `line-${line.s_no}-${idx}`}>
                  <td>{line.s_no}</td>
                  <td>
                    {displayOrDash(line.description)}
                    {line.period_label ? (
                      <div className={styles.periodNote}>Billing period {line.period_label}</div>
                    ) : null}
                  </td>
                  <td>{displayOrDash(line.sac_code || defaultSac)}</td>
                  <td className={styles.num}>{plain(cost)}</td>
                  <td className={styles.num}>{qtyFmt(qty)}</td>
                  <td className={styles.num}>{qtyFmt(line.leave_days ?? 0)}</td>
                  <td className={styles.num}>{plain(line.rate_per_day)}</td>
                  <td className={`${styles.num} ${styles.amountCell}`}>{plain(line.amount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <colgroup>
          <col style={{ width: "8%" }} />
          <col style={{ width: "36%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "16%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>S.No</th>
            <th>Description of Services</th>
            <th>SAC Code</th>
            <th className={styles.num}>{qtyLabel || "Billing Hours"}</th>
            <th className={styles.num}>{rateLabel || "Rate/Hour"}</th>
            <th className={styles.num}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((line, idx) => {
            if (!line) {
              return (
                <tr key={`blank-${idx}`}>
                  <td>&nbsp;</td>
                  <td />
                  <td />
                  <td className={styles.num} />
                  <td className={styles.num} />
                  <td className={styles.num} />
                </tr>
              );
            }
            const hours = line.billing_hours ?? line.qty;
            const rate = line.rate_per_hour ?? line.rate;
            return (
              <tr key={line.id ?? `line-${line.s_no}-${idx}`}>
                <td>{line.s_no}</td>
                <td>{displayOrDash(line.description)}</td>
                <td>{displayOrDash(line.sac_code || defaultSac)}</td>
                <td className={styles.num}>{qtyFmt(hours)}</td>
                <td className={styles.num}>{formatINR(rate)}</td>
                <td className={styles.num}>{formatINR(line.amount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
