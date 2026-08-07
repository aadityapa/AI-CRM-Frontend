import React, { useEffect, useMemo, useState } from "react";
import { FileDown, Printer } from "lucide-react";
import { authFetch } from "../../api/client";
import { crmPost } from "../api";
import { CrmLink } from "../routerHooks";
import { btnPrimary, btnSecondary, useToast } from "../components/ui";
import { InvoiceForm } from "../taxInvoice/InvoiceForm";
import { InvoicePreview } from "../taxInvoice/InvoicePreview";
import { ExcelUpload } from "../taxInvoice/ExcelUpload";
import { emptyInvoice, FIXED_SELLER, type Invoice, type Totals } from "../taxInvoice/types";
import { computeTotals } from "../taxInvoice/math";

function triggerDownload(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}

export function TaxInvoiceGeneratorPage() {
  const [invoice, setInvoice] = useState<Invoice>(() => emptyInvoice());
  const [serverTotals, setServerTotals] = useState<Totals | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [toast, showToast] = useToast();

  const localTotals = useMemo(() => computeTotals(invoice), [invoice]);
  const totals = serverTotals || localTotals;

  // Debounced server /totals (source of truth for words + numbers)
  useEffect(() => {
    const handle = window.setTimeout(() => {
      crmPost<Totals>("/api/invoice/totals", invoice)
        .then((r) => setServerTotals(r.data))
        .catch(() => setServerTotals(null));
    }, 350);
    return () => window.clearTimeout(handle);
  }, [invoice]);

  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      const res = await authFetch("/api/invoice/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invoice),
      });
      if (!res.ok) throw new Error(`PDF failed (${res.status})`);
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = /filename="?([^"]+)"?/i.exec(cd);
      const name = m?.[1] || "TaxInvoice.pdf";
      triggerDownload(blob, name);
      showToast("Tax Invoice downloaded");
    } catch (e: any) {
      showToast(e?.message || "PDF download failed", "err");
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <CrmLink to="invoices" className="text-sm font-semibold text-sky-600 hover:underline">
          Invoices
        </CrmLink>
        <span className="text-muted">/</span>
        <h1 className="min-w-0 truncate text-display text-lg font-bold text-primary">Tax Invoice Generator</h1>
        <div className="ml-auto flex w-full flex-wrap justify-end gap-2 sm:w-auto">
          <button type="button" className={btnSecondary} onClick={() => window.print()}>
            <Printer size={15} /> Print preview
          </button>
          <button type="button" className={btnPrimary} disabled={pdfBusy} onClick={() => void downloadPdf()}>
            <FileDown size={15} /> {pdfBusy ? "Preparing…" : "Download PDF"}
          </button>
        </div>
      </div>

      <ExcelUpload onStatus={(msg, kind) => showToast(msg, kind === "err" ? "err" : kind === "warn" ? "ok" : "ok")} />

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <InvoiceForm value={invoice} onChange={setInvoice} seller={FIXED_SELLER} />
        <div className="min-w-0">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Live preview (white A4) · {totals.intra ? "CGST+SGST" : "IGST"}
          </div>
          <InvoicePreview invoice={invoice} totals={totals} seller={FIXED_SELLER} />
        </div>
      </div>
      {toast}
    </div>
  );
}
