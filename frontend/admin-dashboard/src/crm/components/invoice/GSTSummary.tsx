import React from "react";
import type { GSTBreakup } from "./types";
import { formatINR } from "./utils";
import styles from "./taxInvoice.module.css";

function pctLabel(name: string, pct?: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return name;
  return `${name} (${Number(pct).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%)`;
}

export function GSTSummary({ gst }: { gst: GSTBreakup }) {
  return (
    <aside className={styles.gstSummary}>
      <div className={styles.gstSummaryTitle}>GST Summary</div>
      <div className={styles.gstLine}>
        <span>{pctLabel("CGST", gst.cgst_percent)}</span>
        <span className={styles.value}>{formatINR(gst.cgst)}</span>
      </div>
      <div className={styles.gstLine}>
        <span>{pctLabel("SGST", gst.sgst_percent)}</span>
        <span className={styles.value}>{formatINR(gst.sgst)}</span>
      </div>
      <div className={styles.gstLine}>
        <span>{pctLabel("IGST", gst.igst_percent)}</span>
        <span className={styles.value}>{formatINR(gst.igst)}</span>
      </div>
      <div className={styles.gstLine} style={{ borderTop: "1px solid #D9E2EC", marginTop: 4, paddingTop: 4 }}>
        <span className={styles.value}>Total GST</span>
        <span className={styles.value}>{formatINR(gst.total_gst)}</span>
      </div>
    </aside>
  );
}

export function TotalsPanel({ gst }: { gst: GSTBreakup }) {
  return (
    <aside className={styles.totalsBox}>
      <div className={styles.totalsInner}>
        <div className={styles.totalLine}>
          <span>Sub Total</span>
          <span className={styles.value}>{formatINR(gst.sub_total)}</span>
        </div>
        <div className={styles.totalLine}>
          <span>{pctLabel("CGST", gst.cgst_percent)}</span>
          <span className={styles.value}>{formatINR(gst.cgst)}</span>
        </div>
        <div className={styles.totalLine}>
          <span>{pctLabel("SGST", gst.sgst_percent)}</span>
          <span className={styles.value}>{formatINR(gst.sgst)}</span>
        </div>
        <div className={styles.totalLine}>
          <span>{pctLabel("IGST", gst.igst_percent)}</span>
          <span className={styles.value}>{formatINR(gst.igst)}</span>
        </div>
        <div className={styles.totalLine}>
          <span>Total GST</span>
          <span className={styles.value}>{formatINR(gst.total_gst)}</span>
        </div>
      </div>
      <div className={styles.grandBar}>
        <span className={styles.grandLabel}>Grand Total</span>
        <span className={styles.grandValue}>{formatINR(gst.grand_total)}</span>
      </div>
    </aside>
  );
}
