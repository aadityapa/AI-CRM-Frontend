import React from "react";
import type { SellerDetails, ShareLinks } from "./types";
import { displayOrDash } from "./utils";
import styles from "./taxInvoice.module.css";

/** Bundled seal + authorized signature mark. Overridable via seller.seal_url. */
const DEFAULT_SEAL = `${import.meta.env.BASE_URL}assets/karnex-seal-sign.png`;

export function Declaration({ seller, share }: { seller: SellerDetails; share?: ShareLinks | null }) {
  const sealSrc = (seller.seal_url || "").trim() || DEFAULT_SEAL;

  return (
    <section className={styles.declBox}>
      <div className={styles.sectionTitle}>Declaration</div>
      <p className={styles.bodyText} style={{ margin: 0 }}>
        {displayOrDash(seller.declaration)}
      </p>
      <div className={styles.sealRow}>
        {/* "Scan to view this invoice" (3 Sep 2026): the server renders the QR
            for its public, signed link — the same code lands on the on-screen
            sheet, the html2canvas PDF and the server PDF. */}
        {share?.qr_svg && (
          <a
            className={styles.qrBlock}
            href={share.qr_target}
            target="_blank"
            rel="noreferrer"
            title="Scan with a phone camera to open this invoice"
          >
            <img className={styles.qrImage} src={share.qr_svg} alt="QR code — scan to view this invoice" />
            <span className={styles.qrCaption}>Scan to view this invoice</span>
          </a>
        )}
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
