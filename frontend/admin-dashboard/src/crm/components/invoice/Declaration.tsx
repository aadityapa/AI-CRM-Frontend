import React from "react";
import type { SellerDetails } from "./types";
import { displayOrDash } from "./utils";
import styles from "./taxInvoice.module.css";

/** Bundled seal + authorized signature mark. Overridable via seller.seal_url. */
const DEFAULT_SEAL = `${import.meta.env.BASE_URL}assets/karnex-seal-sign.png`;

export function Declaration({ seller }: { seller: SellerDetails }) {
  const sealSrc = (seller.seal_url || "").trim() || DEFAULT_SEAL;

  return (
    <section className={styles.declBox}>
      <div className={styles.sectionTitle}>Declaration</div>
      <p className={styles.bodyText} style={{ margin: 0 }}>
        {displayOrDash(seller.declaration)}
      </p>
      <div className={styles.sealRow}>
        <div className={styles.signBlock}>
          <img
            className={styles.sealImage}
            src={sealSrc}
            alt="Authorized signature and company seal"
          />
          <div className={styles.signLine}>Authorized Signatory</div>
        </div>
      </div>
    </section>
  );
}
