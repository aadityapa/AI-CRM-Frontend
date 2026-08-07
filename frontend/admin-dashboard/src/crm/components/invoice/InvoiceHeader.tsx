import React from "react";
import { Building2, IdCard, Mail, MapPin } from "lucide-react";
import type { InvoiceData } from "./types";
import { dateFmt, displayOrDash } from "./utils";
import styles from "./taxInvoice.module.css";

/** Bundled Karnex wordmark (above company legal name). Overridable via seller.logo_url. */
const DEFAULT_LOGO = `${import.meta.env.BASE_URL}assets/karnex-logo-invoice.png`;

export function InvoiceHeader({ data }: { data: InvoiceData }) {
  const s = data.seller;
  const logoSrc = (s.logo_url || "").trim() || DEFAULT_LOGO;
  const address =
    [s.address_line1, s.address_line2].filter(Boolean).join(", ") ||
    s.address ||
    null;

  return (
    <header className={styles.headerRow}>
      <div className={styles.sellerBlock}>
        <img className={styles.logoBanner} src={logoSrc} alt="KARNEX" />
        <div className={styles.sellerName}>{displayOrDash(s.name)}</div>
        {s.tagline ? <div className={styles.tagline}>{s.tagline}</div> : null}
        <div className={styles.iconLine}>
          <MapPin size={12} aria-hidden />
          <span>{displayOrDash(address)}</span>
        </div>
        <div className={styles.iconLine}>
          <Building2 size={12} aria-hidden />
          <span>
            State Name: {displayOrDash(s.state)}{" "}
            &nbsp; State Code: {displayOrDash(s.state_code)}
          </span>
        </div>
        <div className={styles.iconLine}>
          <Mail size={12} aria-hidden />
          <span>Email: {displayOrDash(s.email || s.contact_email)}</span>
        </div>
        <div className={styles.iconLine}>
          <IdCard size={12} aria-hidden />
          <span>CIN No.: {displayOrDash(s.cin)}</span>
        </div>
      </div>

      <div className={styles.invoiceMeta}>
        <div className={styles.heading}>TAX INVOICE</div>
        <div className={styles.invoiceMetaBody}>
          <div className={styles.invoiceMetaGrid}>
            <span className={styles.metaLabel}>Invoice No.</span>
            <span className={styles.metaSep}>:</span>
            <span className={styles.value}>{displayOrDash(data.invoice_number)}</span>
            <span className={styles.metaLabel}>Invoice Date</span>
            <span className={styles.metaSep}>:</span>
            <span className={styles.value}>{dateFmt(data.invoice_date)}</span>
            <span className={styles.metaLabel}>P.O. No.</span>
            <span className={styles.metaSep}>:</span>
            <span className={styles.value}>{displayOrDash(data.po_number)}</span>
            <span className={styles.metaLabel}>P.O. Date</span>
            <span className={styles.metaSep}>:</span>
            <span className={styles.value}>{dateFmt(data.po_date)}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
