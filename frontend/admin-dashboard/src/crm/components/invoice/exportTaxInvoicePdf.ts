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

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    logging: false,
    backgroundColor: "#ffffff",
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight,
    imageTimeout: 20_000,
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
