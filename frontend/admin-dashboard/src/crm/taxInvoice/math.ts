/** Local tax math mirroring backend/services/tax_invoice.py (for instant preview). */
import type { Buyer, Invoice, LineItem, Totals } from "./types";

export function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

export function lineAmount(it: LineItem): number {
  return num(it.billing_hours) * num(it.rate_per_hour);
}

export function normalizeStateCode(code: unknown): string {
  const digits = String(code ?? "").replace(/\D/g, "");
  return digits.slice(0, 2);
}

export function buyerStateCode(buyer: Buyer): string {
  const norm = normalizeStateCode(buyer.state_code);
  if (norm.length === 2) return norm;
  const gst = String(buyer.gstn || "").trim().toUpperCase();
  if (gst.length >= 2 && /^\d{2}/.test(gst)) return gst.slice(0, 2);
  return norm;
}

export function isIntraState(buyer: Buyer): boolean {
  return buyerStateCode(buyer) === "27";
}

export function formatInr(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const [whole, frac] = abs.toFixed(2).split(".");
  let grouped: string;
  if (whole.length <= 3) {
    grouped = whole;
  } else {
    const last3 = whole.slice(-3);
    let rest = whole.slice(0, -3);
    const parts: string[] = [];
    while (rest.length > 0) {
      parts.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    grouped = `${parts.join(",")},${last3}`;
  }
  return `INR ${sign}${grouped}.${frac}`;
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
  if (n <= 0) return "";
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) {
    if (h) parts.push("and");
    parts.push(twoDigits(rest));
  }
  return parts.join(" ");
}

export function amountInWords(amount: number): string {
  const negative = amount < 0;
  const rupees = Math.round(Math.abs(amount));
  if (rupees === 0) {
    const z = "Rupees Zero Only";
    return negative ? `Minus ${z}` : z;
  }
  let rem = rupees;
  const crore = Math.floor(rem / 1_00_00_000);
  rem %= 1_00_00_000;
  const lakh = Math.floor(rem / 1_00_000);
  rem %= 1_00_000;
  const thousand = Math.floor(rem / 1_000);
  rem %= 1_000;
  const parts: string[] = [];
  if (crore) parts.push(`${twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rem) parts.push(threeDigits(rem));
  const words = `Rupees ${parts.join(" ")} Only`;
  return negative ? `Minus ${words}` : words;
}

export function computeTotals(inv: Invoice): Totals {
  const subtotal = inv.items.reduce((s, it) => s + lineAmount(it), 0);
  const intra = isIntraState(inv.buyer);
  const cgst = intra ? subtotal * 0.09 : 0;
  const sgst = intra ? subtotal * 0.09 : 0;
  const igst = intra ? 0 : subtotal * 0.18;
  const total_gst = cgst + sgst + igst;
  const total = subtotal + total_gst;
  return {
    subtotal,
    intra,
    cgst,
    sgst,
    igst,
    total_gst,
    total,
    amount_in_words: amountInWords(total),
    tax_in_words: amountInWords(total_gst),
  };
}

/** Normalize 'Jul' / 'July' / 'Jul 2026' / 'July 2026' → 'Jul' or 'Jul 2026'. */
function normalizeServiceMonth(period?: string): string {
  const raw = (period || "").trim();
  if (!raw) return "";
  const parts = raw.split(/\s+/);
  const key = parts[0].toLowerCase();
  const abbrs = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const full = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  let abbr =
    abbrs.find((a) => a.toLowerCase() === key) ||
    (() => {
      const i = full.indexOf(key);
      return i >= 0 ? abbrs[i] : "";
    })();
  if (!abbr) return "";
  if (parts[1] && /^\d{4}$/.test(parts[1])) return `${abbr} ${parts[1]}`;
  return abbr;
}

export function lineDescription(employeeName: string, month?: string): string {
  let name = (employeeName || "").trim();
  let mon = normalizeServiceMonth(month);
  if (/^contract\s+staffing\s+service\b/i.test(name)) {
    name = name.replace(/^contract\s+staffing\s+service\s*/i, "").trim();
    const m = name.match(/^(.+?)\s*[-–—]\s*([A-Za-z]+)(?:\s+(\d{4}))?\s*$/);
    if (m) {
      name = m[1].trim();
      if (!mon) {
        mon = m[3] ? normalizeServiceMonth(`${m[2]} ${m[3]}`) : normalizeServiceMonth(m[2]);
      }
    }
  }
  if (name && mon) return `Contract Staffing Service ${name} - ${mon}`;
  if (name) return `Contract Staffing Service ${name}`;
  if (mon) return `Contract Staffing Service - ${mon}`;
  return "Contract Staffing Service";
}
