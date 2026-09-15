import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

/** Capture the A4 tax-invoice sheet into a single-page PDF (margin 0). */
export async function exportTaxInvoicePdf(
  element: HTMLElement,
  fileName: string,
): Promise<void> {
  if (!element?.isConnected) {
    throw new Error("PDF source element is not attached to the document.");
  }

  // The sheet is 210mm (~794px) wide; passing that as windowWidth made the
  // cloned document match the `max-width: 900px` MOBILE media query, so the
  // PDF came out with every row stacked (11 Sep 2026, user report). Capture
  // with a desktop-sized viewport and the sheet pinned to its A4 width.
  const A4_PX = 794;
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    logging: false,
    backgroundColor: "#ffffff",
    width: Math.max(element.offsetWidth, A4_PX),
    windowWidth: 1400,
    windowHeight: Math.max(element.scrollHeight, 1123),
    imageTimeout: 20_000,
    onclone: (doc) => {
      const sheet = doc.querySelector("[data-invoice-sheet]") as HTMLElement | null;
      if (sheet) {
        sheet.style.width = `${A4_PX}px`;
        sheet.style.maxWidth = "none";
        sheet.style.margin = "0";
        sheet.style.borderRadius = "0";
        sheet.style.boxShadow = "none";
      }
    },
  });

  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  // Fit on one A4 page — scale down if content slightly overflows.
  const scale = imgHeight > pageHeight ? pageHeight / imgHeight : 1;
  const drawW = imgWidth * scale;
  const drawH = imgHeight * scale;
  const offsetX = (pageWidth - drawW) / 2;
  const offsetY = 0;

  const imgData = canvas.toDataURL("image/jpeg", 0.95);
  pdf.addImage(imgData, "JPEG", offsetX, offsetY, drawW, drawH);
  pdf.save(fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`);
}
