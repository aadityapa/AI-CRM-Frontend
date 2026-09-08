/** Shared Tax Invoice formatters — keep amount/GST logic in one place. */

import type { GSTBreakup, InvoiceData, InvoiceLine } from "./types";

const DASH = "—";

export function displayOrDash(value: string | number | null | undefined): string {
  if (value == null) return DASH;
  const s = String(value).trim();
  return s ? s : DASH;
}

/** Indian Rupee with en-IN grouping. Uses the "INR" text prefix instead of the
 * ₹ glyph so PDF/print output is font-safe (₹ renders as tofu in some PDF
 * fonts). e.g. "INR 1,23,456.78". */
export function formatINR(amount: number | null | undefined, opts?: { withSymbol?: boolean }): string {
  if (amount == null || !Number.isFinite(Number(amount))) return DASH;
  const withSymbol = opts?.withSymbol !== false;
  const n = Number(amount);
  const body = n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return withSymbol ? `INR ${body}` : body;
}

/** dd-MMM-yyyy (e.g. 26-Jul-2026). */
export function dateFmt(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso.includes("T") ? iso : `${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return DASH;
  const dd = String(d.getDate()).padStart(2, "0");
  const mon = d.toLocaleString("en-GB", { month: "short" });
  const yyyy = d.getFullYear();
  return `${dd}-${mon}-${yyyy}`;
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return `${TENS[t]}${o ? ` ${ONES[o]}` : ""}`.trim();
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}

/** Indian numbering system: Crore / Lakh / Thousand. */
export function amountInWordsINR(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(Number(amount))) return DASH;
  const rounded = Math.round(Number(amount) * 100) / 100;
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  let rupees = Math.floor(abs);
  const paise = Math.round((abs - rupees) * 100);

  if (rupees === 0 && paise === 0) return "Zero Rupees Only";

  const parts: string[] = [];
  const crore = Math.floor(rupees / 1_00_00_000);
  rupees %= 1_00_00_000;
  const lakh = Math.floor(rupees / 1_00_000);
  rupees %= 1_00_000;
  const thousand = Math.floor(rupees / 1_000);
  rupees %= 1_000;
  const hundred = rupees;

  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));

  let words = parts.join(" ").replace(/\s+/g, " ").trim();
  if (!words) words = "Zero";
  words = `${words} Rupees`;
  if (paise > 0) words += ` and ${twoDigits(paise)} Paise`;
  words += " Only";
  return negative ? `Minus ${words}` : words;
}

/**
 * Prefer stored GST breakup from API. If missing, derive from seller vs buyer
 * state codes so same-state → CGST+SGST and inter-state → IGST, still summing
 * exactly to stored tax_amount.
 */
export function gstSplit(
  taxAmount: number,
  opts: {
    sellerStateCode?: string | null;
    buyerStateCode?: string | null;
    stored?: GSTBreakup | null;
    subTotal?: number;
    grandTotal?: number;
  } = {},
): GSTBreakup {
  if (opts.stored && typeof opts.stored.total_gst === "number") {
    return opts.stored;
  }
  const tax = Math.round(Number(taxAmount || 0) * 100) / 100;
  const seller = (opts.sellerStateCode || "").trim();
  const buyer = (opts.buyerStateCode || "").trim();
  const inter =
    seller && buyer ? seller !== buyer : false;
  const sub = opts.subTotal ?? 0;
  const grand = opts.grandTotal ?? sub + tax;

  if (inter) {
    return {
      inter_state: true,
      cgst: 0,
      sgst: 0,
      igst: tax,
      total_gst: tax,
      sub_total: sub,
      grand_total: grand,
    };
  }
  const half = Math.round((tax / 2) * 100) / 100;
  const other = Math.round((tax - half) * 100) / 100;
  return {
    inter_state: false,
    cgst: half,
    sgst: other,
    igst: 0,
    total_gst: tax,
    sub_total: sub,
    grand_total: grand,
  };
}

/** Pad line rows to at least `minRows` for a full A4 table look. */
export function padLines(lines: InvoiceLine[], minRows = 5): Array<InvoiceLine | null> {
  const rows: Array<InvoiceLine | null> = [...lines];
  while (rows.length < minRows) rows.push(null);
  return rows;
}

/** Map raw API invoice detail → InvoiceData with safe fallbacks. */
export function mapApiInvoiceToData(raw: Record<string, unknown>): InvoiceData {
  const seller = (raw.seller || {}) as InvoiceData["seller"];
  const buyer = (raw.buyer || {}) as InvoiceData["buyer"];
  const shipping = (raw.shipping || {}) as InvoiceData["shipping"];
  const bank = (raw.bank || {}) as InvoiceData["bank"];
  const gstStored = raw.gst as GSTBreakup | undefined;
  const lines = (Array.isArray(raw.lines) ? raw.lines : []) as InvoiceLine[];
  const sub = Number(raw.sub_total ?? 0);
  const taxAmt = Number(raw.tax_amount ?? 0);
  const grand = Number(raw.grand_total ?? sub + taxAmt);

  return {
    id: Number(raw.id),
    invoice_number: String(raw.invoice_number || ""),
    invoice_date: (raw.invoice_date as string) || null,
    due_date: (raw.due_date as string) || null,
    sub_total: sub,
    tax_amount: taxAmt,
    grand_total: grand,
    payment_status: (raw.payment_status as string) || null,
    po_id: (raw.po_id as number) ?? null,
    po_number: (raw.po_number as string) || null,
    po_date: (raw.po_date as string) || null,
    project_id: (raw.project_id as number) ?? null,
    project_name: (raw.project_name as string) || null,
    customer_id: (raw.customer_id as number) ?? null,
    customer_name: (raw.customer_name as string) || null,
    sac_code: (raw.sac_code as string) || null,
    qty_label: (raw.qty_label as string) || null,
    rate_label: (raw.rate_label as string) || null,
    lines,
    seller,
    buyer,
    shipping,
    bank,
    gst: gstSplit(taxAmt, {
      sellerStateCode: seller.state_code,
      buyerStateCode: buyer.state_code,
      stored: gstStored,
      subTotal: sub,
      grandTotal: grand,
    }),
    share: (raw.share as InvoiceData["share"]) ?? null,
  };
}
