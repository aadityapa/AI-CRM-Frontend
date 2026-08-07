import React from "react";
import type { BankDetails } from "./types";
import { displayOrDash } from "./utils";
import styles from "./taxInvoice.module.css";

export function BankDetails({ bank }: { bank: BankDetails }) {
  return (
    <section className={styles.bankBox}>
      <div className={styles.sectionTitle}>Bank Details</div>
      <div className={styles.bodyText}>
        <div>
          <span className={styles.label}>Bank</span>
          <div className={styles.value}>{displayOrDash(bank.bank_name)}</div>
        </div>
        <div style={{ marginTop: 4 }}>
          <span className={styles.label}>Account Name</span>
          <div className={styles.value}>{displayOrDash(bank.account_name)}</div>
        </div>
        <div style={{ marginTop: 4 }}>
          <span className={styles.label}>A/C No.</span>
          <div className={styles.value}>{displayOrDash(bank.account_number)}</div>
        </div>
        <div style={{ marginTop: 4, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <div>
            <span className={styles.label}>IFSC</span>
            <div className={styles.value}>{displayOrDash(bank.ifsc)}</div>
          </div>
          <div>
            <span className={styles.label}>Branch</span>
            <div className={styles.value}>{displayOrDash(bank.branch)}</div>
          </div>
        </div>
        <div style={{ marginTop: 4 }}>
          <span className={styles.label}>Account Type</span>
          <div className={styles.value}>{displayOrDash(bank.account_type)}</div>
        </div>
      </div>
    </section>
  );
}
