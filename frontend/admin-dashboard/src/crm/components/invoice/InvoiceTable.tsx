import React from "react";
import type { InvoiceLine } from "./types";
import { displayOrDash, formatINR, padLines } from "./utils";
import styles from "./taxInvoice.module.css";

export function InvoiceTable({
  lines,
  defaultSac,
  qtyLabel,
  rateLabel,
}: {
  lines: InvoiceLine[];
  defaultSac?: string | null;
  /** Server-resolved from the PE billing unit; hourly wording is only the
      fallback for payloads predating qty_label/rate_label. */
  qtyLabel?: string | null;
  rateLabel?: string | null;
}) {
  const rows = padLines(lines, 5);

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
                <td className={styles.num}>
                  {hours == null ? displayOrDash(null) : Number(hours).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </td>
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
