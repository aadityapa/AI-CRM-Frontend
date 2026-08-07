import React from "react";
import { amountInWordsINR } from "./utils";
import styles from "./taxInvoice.module.css";

export function AmountWords({
  grandTotal,
  taxAmount,
}: {
  grandTotal: number;
  taxAmount: number;
}) {
  return (
    <section className={styles.wordsBox}>
      <div className={styles.rupeeIcon} aria-hidden>
        INR
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className={styles.wordsLabel}>Amount Chargeable (In Words)</div>
        <div className={styles.wordsValue}>{amountInWordsINR(grandTotal)}</div>
        <div className={styles.wordsLabel} style={{ marginTop: 6 }}>
          Tax Amount (In Words)
        </div>
        <div className={styles.wordsValue}>{amountInWordsINR(taxAmount)}</div>
      </div>
    </section>
  );
}
