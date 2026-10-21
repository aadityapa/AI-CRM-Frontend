import React from "react";
import type { EInvoiceIds, ShareLinks } from "./types";
import styles from "./taxInvoice.module.css";

/** "2026-10-15" → "15/10/2026"; anything else is printed as given. */
export function einvoiceDate(v?: string | null): string {
  const s = (v || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s || "—";
}

/**
 * The e-Invoice band (22 Oct 2026, user ask): the e-invoice is the ordinary
 * tax invoice sheet with this one block added under the header — IRN,
 * Ack No., Ack Date, and a QR to the public e-invoice page.
 */
export function EInvoiceBand({ ids, share }: { ids: EInvoiceIds; share?: ShareLinks | null }) {
  const rows: [string, string][] = [
    ["IRN", ids.irn || "—"],
    ["Ack No.", ids.ack_number || "—"],
    ["Ack Date", einvoiceDate(ids.ack_date)],
  ];
  return (
    <section className={styles.einvBand} aria-label="e-Invoice">
      <div className={styles.einvMain}>
        <div className={styles.einvTitle}>e-Invoice</div>
        {rows.map(([k, v]) => (
          <div key={k} className={styles.einvRow}>
            <span className={styles.einvKey}>{k}</span>
            <span className={styles.einvVal}>{v}</span>
          </div>
        ))}
      </div>
      {share?.einvoice_qr_svg && (
        <img className={styles.einvQr} src={share.einvoice_qr_svg} alt="QR code — scan to view this e-invoice" />
      )}
    </section>
  );
}
