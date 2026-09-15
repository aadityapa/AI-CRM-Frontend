import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, FileText, Printer } from "lucide-react";
import { authFetch } from "../../../api/client";
import { crmGet } from "../../api";
import { CrmLink, useCrmParams } from "../../routerHooks";
import { ErrorBox, Spinner } from "../ui";
import { AmountWords } from "./AmountWords";
import { BankDetails as BankDetailsBlock } from "./BankDetails";
import { BuyerCard, ShippingCard } from "./BuyerCard";
import { Declaration } from "./Declaration";
import { exportTaxInvoicePdf } from "./exportTaxInvoicePdf";
import { GSTSummary, TotalsPanel } from "./GSTSummary";
import { InvoiceFooter } from "./InvoiceFooter";
import { InvoiceHeader } from "./InvoiceHeader";
import { InvoiceTable } from "./InvoiceTable";
import type { InvoiceData } from "./types";
import { mapApiInvoiceToData } from "./utils";
import styles from "./taxInvoice.module.css";

/** Presentational A4 tax invoice document (white print surface). */
export function TaxInvoiceDocument({
  data,
  sheetRef,
}: {
  data: InvoiceData;
  sheetRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div className={styles.page} ref={sheetRef} data-invoice-sheet="1">
      <InvoiceHeader data={data} />
      <div className={styles.cardsRow}>
        <BuyerCard party={data.buyer} />
        <ShippingCard party={data.shipping} />
      </div>
      <InvoiceTable lines={data.lines} defaultSac={data.sac_code}
        qtyLabel={data.qty_label} rateLabel={data.rate_label} billing={data.billing} />
      <div className={styles.totalsRow}>
        <GSTSummary gst={data.gst} />
        <TotalsPanel gst={data.gst} />
      </div>
      <AmountWords grandTotal={data.gst.grand_total} taxAmount={data.gst.total_gst} />
      <div className={styles.bottomRow}>
        <BankDetailsBlock bank={data.bank} />
        <Declaration seller={data.seller} share={data.share} />
      </div>
      <InvoiceFooter seller={data.seller} />
    </div>
  );
}

/** CRM route page: invoices/:id/tax-invoice */
export function InvoicePage() {
  const { id } = useCrmParams();
  const [data, setData] = useState<InvoiceData | null>(null);
  const [error, setError] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [docxBusy, setDocxBusy] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Word export (11 Sep 2026): server-built .docx with the same sections and
  // figures as this sheet, so Finance can edit wording without touching numbers.
  const onDownloadDocx = async () => {
    if (!data) return;
    setDocxBusy(true);
    try {
      const res = await authFetch(`/api/invoices/${id}/tax-invoice.docx`);
      if (!res.ok) throw new Error(`Word export failed (${res.status})`);
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = /filename="?([^"]+)"?/i.exec(cd);
      const safe = (data.invoice_number || `invoice-${id}`).replace(/[^\w.-]+/g, "_");
      const name = m?.[1] || `TaxInvoice_${safe}.docx`;
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      a.click();
      URL.revokeObjectURL(href);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to download Word file");
    } finally {
      setDocxBusy(false);
    }
  };

  const load = () => {
    setError("");
    setData(null);
    crmGet<Record<string, unknown>>(`/api/invoices/${id}`)
      .then((r) => setData(mapApiInvoiceToData((r.data || {}) as Record<string, unknown>)))
      .catch((e) => setError(e?.message || "Failed to load invoice"));
  };

  useEffect(load, [id]);

  const onPrint = () => {
    window.print();
  };

  const onDownloadPdf = async () => {
    if (!sheetRef.current || !data) return;
    setPdfBusy(true);
    try {
      const safe = (data.invoice_number || `invoice-${id}`).replace(/[^\w.-]+/g, "_");
      await exportTaxInvoicePdf(sheetRef.current, `TaxInvoice_${safe}.pdf`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to download PDF";
      setError(msg);
    } finally {
      setPdfBusy(false);
    }
  };

  // One-click "Tax Invoice (PDF)" from the invoice detail page navigates here
  // with ?pdf=1 — auto-download the exact View once rendered, then clear the flag.
  const autoPdfDone = useRef(false);
  useEffect(() => {
    if (autoPdfDone.current || !data) return;
    const wantsPdf = new URLSearchParams(window.location.search).get("pdf") === "1";
    if (!wantsPdf) return;
    autoPdfDone.current = true;
    // Drop the flag from the URL so a refresh / Back does not re-download.
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("pdf");
      window.history.replaceState(window.history.state, "", u.toString());
    } catch { /* ignore */ }
    // Let the A4 sheet paint (fonts + images) before capturing.
    const t = window.setTimeout(() => { void onDownloadPdf(); }, 600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (error && !data) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <Spinner label="Loading tax invoice…" />;

  return (
    <div className={styles.shell}>
      <div className={`${styles.toolbar} crm-print-hide`}>
        <CrmLink
          to={`invoices/${id}`}
          className={`${styles.btn} ${styles.btnSecondary}`}
        >
          <ArrowLeft size={15} aria-hidden /> Back to Invoice
        </CrmLink>
        <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onPrint}>
          <Printer size={15} aria-hidden /> Print Invoice
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={() => void onDownloadPdf()}
          disabled={pdfBusy}
        >
          <Download size={15} aria-hidden />
          {pdfBusy ? "Preparing PDF…" : "Download PDF"}
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnSecondary}`}
          onClick={() => void onDownloadDocx()}
          disabled={docxBusy}
        >
          <FileText size={15} aria-hidden />
          {docxBusy ? "Preparing Word…" : "Download Word"}
        </button>
        {error ? <span style={{ color: "#b91c1c", fontSize: 12 }}>{error}</span> : null}
      </div>
      <div className={styles.pageWrap}>
        <TaxInvoiceDocument data={data} sheetRef={sheetRef} />
      </div>
    </div>
  );
}

export default InvoicePage;
