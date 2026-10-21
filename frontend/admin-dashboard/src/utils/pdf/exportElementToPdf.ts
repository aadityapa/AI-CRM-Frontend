import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { withHtml2CanvasTextFix } from "./html2canvasTextFix";

/**
 * Renders a DOM subtree to an A4 PDF.
 *
 * 21 Oct 2026 — "sometimes the PDF downloads all black". The old version drew
 * the WHOLE report into ONE canvas at scale 2: a long interview (30+ answers,
 * code blocks) passes the browser's canvas limit (≈ 32 767 px tall / 268 M px),
 * the canvas silently stays empty, and an empty canvas saved as JPEG is BLACK
 * (JPEG has no transparency). Now:
 *
 * - every `[data-pdf-block]` child is captured ON ITS OWN (a section, one
 *   question), so no canvas is ever huge, and a block never splits across a page
 *   unless it is taller than a page;
 * - the scale drops for a tall block so it stays under `MAX_CANVAS_PX`;
 * - every slice is painted WHITE first, so a failed draw is a white gap, never
 *   black;
 * - each page gets the brand line on top and "Page N of M" at the bottom.
 */
export type PdfExportOptions = {
  /** Small text at the top of every page (left). */
  headerLeft?: string;
  /** Small text at the top of every page (right). */
  headerRight?: string;
  /** Small text at the bottom of every page (left); "Page N of M" is on the right. */
  footerLeft?: string;
};

const MAX_CANVAS_PX = 14_000;
const MARGIN_MM = 10;
const HEADER_MM = 7;
const FOOTER_MM = 7;
const GAP_MM = 2.5;

/** The capture scale for a block of this height (PURE). */
export function captureScale(heightPx: number, preferred = 2): number {
  if (!(heightPx > 0)) return preferred;
  return Math.max(0.5, Math.min(preferred, MAX_CANVAS_PX / heightPx));
}

/** Where each block goes: [{page, yMm}] for heights in mm (PURE). A block taller
 *  than the page starts on a fresh page and is sliced by the caller. */
export function packBlocks(heightsMm: number[], pageInnerMm: number, gapMm = GAP_MM): { page: number; y: number }[] {
  const out: { page: number; y: number }[] = [];
  let page = 0;
  let y = 0;
  for (const h of heightsMm) {
    if (y > 0 && y + h > pageInnerMm) {
      page += 1;
      y = 0;
    }
    out.push({ page, y });
    if (h > pageInnerMm) {
      // A tall block runs over ceil(h / page) pages; the next block starts after it.
      const extra = Math.ceil(h / pageInnerMm) - 1;
      page += extra;
      y = h - extra * pageInnerMm + gapMm;
    } else {
      y += h + gapMm;
    }
  }
  return out;
}

async function capture(el: HTMLElement): Promise<HTMLCanvasElement> {
  const h = el.scrollHeight || el.offsetHeight || 1;
  return withHtml2CanvasTextFix(() => html2canvas(el, {
    scale: captureScale(h),
    useCORS: true,
    allowTaint: true,
    logging: false,
    backgroundColor: "#ffffff",
    windowWidth: el.scrollWidth,
    windowHeight: h,
    imageTimeout: 20_000,
  }));
}

/** One horizontal band of a canvas as a white-backed JPEG. */
function sliceToJpeg(canvas: HTMLCanvasElement, srcY: number, srcH: number): string {
  const slice = document.createElement("canvas");
  slice.width = Math.max(1, canvas.width);
  slice.height = Math.max(1, Math.ceil(srcH));
  const ctx = slice.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, slice.width, slice.height);
  if (canvas.width > 0 && canvas.height > 0) {
    ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
  }
  return slice.toDataURL("image/jpeg", 0.92);
}

export async function exportElementToPdf(
  element: HTMLElement,
  fileName: string,
  opts: PdfExportOptions = {},
): Promise<void> {
  if (!element?.isConnected) {
    throw new Error("PDF source element is not attached to the document.");
  }
  const blocks = Array.from(element.querySelectorAll<HTMLElement>(":scope > [data-pdf-block], :scope [data-pdf-block]"))
    // Only the outermost blocks (a block inside a block is captured with its parent).
    .filter((b, _i, all) => !all.some((o) => o !== b && o.contains(b)));
  const sources = blocks.length ? blocks : [element];

  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const innerW = pageW - 2 * MARGIN_MM;
  const top = MARGIN_MM + (opts.headerLeft || opts.headerRight ? HEADER_MM : 0);
  const innerH = pageH - top - MARGIN_MM - FOOTER_MM;

  const canvases: HTMLCanvasElement[] = [];
  for (const el of sources) canvases.push(await capture(el));
  const heights = canvases.map((c) => (c.width > 0 ? (c.height * innerW) / c.width : 0));
  const places = packBlocks(heights, innerH);

  let currentPage = 0;
  canvases.forEach((canvas, i) => {
    const hMm = heights[i];
    if (!(hMm > 0)) return;
    let { page, y } = places[i];
    while (currentPage < page) {
      pdf.addPage();
      currentPage += 1;
    }
    let doneMm = 0;
    while (doneMm < hMm - 0.05) {
      const room = innerH - y;
      const partMm = Math.min(room, hMm - doneMm);
      const srcY = (doneMm / hMm) * canvas.height;
      const srcH = (partMm / hMm) * canvas.height;
      pdf.addImage(sliceToJpeg(canvas, srcY, srcH), "JPEG", MARGIN_MM, top + y, innerW, partMm);
      doneMm += partMm;
      if (doneMm < hMm - 0.05) {
        pdf.addPage();
        currentPage += 1;
        page += 1;
        y = 0;
      }
    }
  });

  const total = pdf.getNumberOfPages();
  if (total > 300) throw new Error("PDF page limit exceeded.");
  for (let p = 1; p <= total; p += 1) {
    pdf.setPage(p);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    if (opts.headerLeft) pdf.text(opts.headerLeft, MARGIN_MM, MARGIN_MM + 3);
    if (opts.headerRight) pdf.text(opts.headerRight, pageW - MARGIN_MM, MARGIN_MM + 3, { align: "right" });
    if (opts.headerLeft || opts.headerRight) {
      pdf.setDrawColor(226, 232, 240);
      pdf.line(MARGIN_MM, MARGIN_MM + 5, pageW - MARGIN_MM, MARGIN_MM + 5);
    }
    if (opts.footerLeft) pdf.text(opts.footerLeft, MARGIN_MM, pageH - MARGIN_MM + 2);
    pdf.text(`Page ${p} of ${total}`, pageW - MARGIN_MM, pageH - MARGIN_MM + 2, { align: "right" });
  }
  pdf.save(fileName);
}
