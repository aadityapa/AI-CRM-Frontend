import React from "react";
import { Globe, Mail, MapPin, Phone } from "lucide-react";
import type { SellerDetails } from "./types";
import { displayOrDash } from "./utils";
import styles from "./taxInvoice.module.css";

export function InvoiceFooter({ seller }: { seller: SellerDetails }) {
  const location =
    [seller.city, seller.state, seller.country].filter(Boolean).join(", ") ||
    seller.address_line2;
  const footerEmail = seller.contact_email || seller.email;
  return (
    <footer className={styles.footer}>
      <span className={styles.footerItem}>
        <Globe size={12} aria-hidden />
        {displayOrDash(seller.website)}
      </span>
      <span className={styles.footerItem}>
        <Mail size={12} aria-hidden />
        {displayOrDash(footerEmail)}
      </span>
      <span className={styles.footerItem}>
        <Phone size={12} aria-hidden />
        {displayOrDash(seller.phone)}
      </span>
      <span className={styles.footerItem}>
        <MapPin size={12} aria-hidden />
        {displayOrDash(location)}
      </span>
    </footer>
  );
}
