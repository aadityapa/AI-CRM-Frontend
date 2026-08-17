/** Tax Invoice typed models — mapped from GET /api/invoices/{id} detail payload. */

export interface PartyDetails {
  name?: string | null;
  legal_name?: string | null;
  branch_name?: string | null;
  address?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  state_code?: string | null;
  pincode?: string | null;
  country?: string | null;
  gstin?: string | null;
  pan?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface SellerDetails extends PartyDetails {
  tagline?: string | null;
  website?: string | null;
  contact_email?: string | null;
  cin?: string | null;
  logo_url?: string | null;
  seal_url?: string | null;
  declaration?: string | null;
}

export interface BankDetails {
  bank_name?: string | null;
  account_name?: string | null;
  account_number?: string | null;
  ifsc?: string | null;
  branch?: string | null;
  account_type?: string | null;
}

export interface GSTBreakup {
  inter_state: boolean;
  tax_slab?: number | null;
  cgst_percent?: number | null;
  sgst_percent?: number | null;
  igst_percent?: number | null;
  cgst: number;
  sgst: number;
  igst: number;
  total_gst: number;
  sub_total: number;
  grand_total: number;
}

export interface InvoiceLine {
  id?: number;
  s_no: number;
  description: string;
  sac_code?: string | null;
  qty: number;
  rate: number;
  amount: number;
  billing_hours?: number | null;
  rate_per_hour?: number | null;
}

export interface InvoiceData {
  id: number;
  invoice_number: string;
  invoice_date?: string | null;
  due_date?: string | null;
  sub_total: number;
  tax_amount: number;
  grand_total: number;
  payment_status?: string | null;
  po_id?: number | null;
  po_number?: string | null;
  po_date?: string | null;
  project_id?: number | null;
  project_name?: string | null;
  customer_id?: number | null;
  customer_name?: string | null;
  sac_code?: string | null;
  /** Qty/Rate column labels from the PE billing unit (e.g. "Billed Qty
      (Months)" / "Rate/Month (INR)") — server-resolved so the on-screen view
      matches the PDF. Absent on old cached payloads → hourly fallback. */
  qty_label?: string | null;
  rate_label?: string | null;
  lines: InvoiceLine[];
  seller: SellerDetails;
  buyer: PartyDetails;
  shipping: PartyDetails;
  bank: BankDetails;
  gst: GSTBreakup;
}
