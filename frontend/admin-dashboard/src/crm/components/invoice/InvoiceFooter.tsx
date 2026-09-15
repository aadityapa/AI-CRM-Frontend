import React from "react";
import { Globe } from "lucide-react";
import type { SellerDetails } from "./types";
import styles from "./taxInvoice.module.css";

/** Footer strip (11 Sep 2026, user decision): ONLY the website, as a link.
    Email / phone / location moved out — they already sit in the header. */
export function InvoiceFooter({ seller }: { seller: SellerDetails }) {
  let url = (seller.footer_website_url || "").trim();
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  const label = (seller.website || url.replace(/^https?:\/\//i, "")).trim() || "www.karnex.in";
  const extra = (seller.footer_text || "").trim();
  return (
    <footer className={styles.footer}>
      <span className={styles.footerItem}>
        <Globe size={12} aria-hidden />
        {url ? (
          <a className={styles.footerLink} href={url} target="_blank" rel="noreferrer">{label}</a>
        ) : (
          label
        )}
      </span>
      {extra ? <span className={styles.footerItem}>{extra}</span> : null}
    </footer>
  );
}
