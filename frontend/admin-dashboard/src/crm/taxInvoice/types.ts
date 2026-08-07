/** KARNEX GST Tax Invoice — TS types (identical field names to backend Pydantic). */

export interface LineItem {
  employee_name: string;
  service_month?: string;
  sac: string;
  billing_hours: number;
  rate_per_hour: number;
}

export interface Buyer {
  name: string;
  address: string;
  pan: string;
  gstn: string;
  state_code: string;
  state_name: string;
  shipping: string;
  shipping_address: string;
}

export interface Invoice {
  invoice_no: string;
  invoice_date: string;
  po_no?: string | null;
  po_date?: string | null;
  footer_text: string;
  buyer: Buyer;
  items: LineItem[];
}

export interface Totals {
  subtotal: number;
  intra: boolean;
  cgst: number;
  sgst: number;
  igst: number;
  total_gst: number;
  total: number;
  amount_in_words: string;
  tax_in_words: string;
}

export interface SellerConstants {
  name: string;
  address: string;
  state_name: string;
  state_code: string;
  email: string;
  cin: string;
  pan: string;
  gstin: string;
  bank_name: string;
  bank_name_short: string;
  bank_acc: string;
  ifsc: string;
  branch: string;
  contact_web: string;
  contact_email: string;
  contact_phone: string;
  contact_loc: string;
}

export const DEFAULT_FOOTER =
  "Certified that the particulars above are true and correct. The amount charged is the actual price with no additional consideration from the Service Recipient.";

export const DEFAULT_INVOICE_NO = "KRSW26-27-65-VS";
export const DEFAULT_SAC = "998314";

export const FIXED_SELLER: SellerConstants = {
  name: "Karnex Software Solutions Private Limited",
  address:
    "103, Pride Purple Accord, Opp. RMZ Icon\nNear Mahalaxwiwar Hotel, Baner\nPune, MH, India - 411045",
  state_name: "Maharashtra",
  state_code: "27",
  email: "karnex.singh@karnex.in",
  cin: "U72900RJ2019OPC63826",
  pan: "AAHCK4749A",
  gstin: "27AAHCK4749A1ZL",
  bank_name: "HDFC Bank, Baner",
  bank_name_short: "HDFC Bank",
  bank_acc: "50200073368143",
  ifsc: "HDFC0001794",
  branch: "Baner, Pune",
  contact_web: "www.karnex.in",
  contact_email: "info@karnex.in",
  contact_phone: "+91 20 1234 5678",
  contact_loc: "Pune, Maharashtra, India",
};

export function emptyInvoice(): Invoice {
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, "0");
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const yyyy = today.getFullYear();
  return {
    invoice_no: DEFAULT_INVOICE_NO,
    invoice_date: `${dd}/${mm}/${yyyy}`,
    po_no: "",
    po_date: "",
    footer_text: DEFAULT_FOOTER,
    buyer: {
      name: "",
      address: "",
      pan: "",
      gstn: "",
      state_code: "27",
      state_name: "Maharashtra",
      shipping: "",
      shipping_address: "",
    },
    items: [{ employee_name: "", sac: DEFAULT_SAC, billing_hours: 0, rate_per_hour: 0 }],
  };
}
