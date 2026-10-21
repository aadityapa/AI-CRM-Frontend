/**
 * Shared pieces of the Customer Received Amount screens (22 Oct 2026): the
 * receipt / invoice-option shapes, money + date formatting, the proof chip and
 * the "attach proof later" row. Used by CustomerReceipts.tsx (list + Add) and
 * receipts/ReceiptWorkbench.tsx (open a receipt · map invoices · edit).
 */
import React, { useState } from "react";
import { Paperclip } from "lucide-react";
import type { TdsInfo } from "../../components/invoice/TdsDeduction";
import { crmPut, crmUpload } from "../../api";
import { fileViewHref } from "../FileView";

export type Allocation = {
  payment_id: number | null; invoice_id: number; amount: number;
  /** 16 Oct 2026 — the TDS the customer withheld on this invoice. */
  tds?: TdsInfo | null; tds_booked_here?: boolean;
  invoice_number?: string; employee_name?: string | null; project_name?: string | null;
  balance_amount?: number; payment_status?: string;
  /** 16 Oct 2026 — the month the invoice bills and its branch. */
  month_label?: string | null; branch_name?: string | null;
  invoice_date?: string | null; grand_total?: number; due_date?: string | null;
};
export type Receipt = {
  id: number; customer_id: number; customer_name?: string | null;
  /** The paying branch (16 Oct 2026); null = before that / no branch. */
  branch_id?: number | null; branch_name?: string | null;
  received_date: string; amount: number; payment_mode?: string | null;
  reference_number?: string | null; notes?: string | null;
  unallocated_amount: number; allocated_amount: number; created_at?: string | null;
  /** TDS withheld on the invoices of this receipt, and what is still pending from the client. */
  tds_total?: number; tds_pending?: number;
  /** Proof of the credit (19 Oct 2026) — screenshot / remittance advice. */
  proof_url?: string | null; proof_name?: string | null;
  created_by?: number | null;
  allocations: Allocation[];
};
export type InvoiceOption = {
  id: number; invoice_number: string; invoice_date: string | null; project_name?: string | null;
  employee_name?: string | null; grand_total: number; paid_amount: number; balance_amount: number;
  payment_status: string;
  /** 16 Oct 2026 — the TDS base (value before GST), GST, and any TDS already on record. */
  sub_total: number; tax_amount: number; tds_deducted?: number; tds?: TdsInfo | null;
  /** 8 Oct 2026 — why money cannot go on it yet (customer approval / IRN); null = open. */
  payment_block?: string | null;
  /** 16 Oct 2026 — the branch it belongs to and the month it bills. */
  branch_id?: number | null; branch_name?: string | null;
  month?: string | null; month_label?: string | null; due_date?: string | null;
};
export type BranchOption = { id: number; name: string; invoices: number; balance: number };
/** The branch page's scope — the list and the Add dialog are locked to it.
 *  Without `branchId` (the customer page's tab, 19 Oct 2026) it is the whole
 *  customer: every branch listed, the branch picked in the Add dialog. */
export type BranchScope = { customerId: number; customerName?: string | null; branchId?: number | null; branchName?: string | null };

export const PAYMENT_MODES = ["NEFT", "RTGS", "IMPS", "UPI", "Cheque", "Cash", "Wire", "Other"];
export const inr = (v: number | null | undefined) =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
/** Days an open invoice is past its due date (0 when not yet due). PURE. */
export function daysLate(due: string | null | undefined, today: Date = new Date()): number {
  if (!due) return 0;
  const d = new Date(`${due.slice(0, 10)}T00:00:00`);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((t.getTime() - d.getTime()) / 86400000));
}

/** "Proof" chip — opens the stored file in the CRM's file viewer. */
export function ProofChip({ url, name }: { url: string; name?: string | null }) {
  const href = fileViewHref(url, name || "Payment proof");
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
      title={name || "Proof of payment"}
      className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800 ring-1 ring-inset ring-sky-200 hover:underline dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-800">
      <Paperclip size={11} aria-hidden /> Proof
    </a>
  );
}

/** "2026-10-08" for today minus `daysBack`, in local time. PURE. */
export function isoDay(daysBack = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** In the expanded receipt: the proof, and attach / replace / remove it later. */
export function ReceiptProofRow({ receipt, canEdit, onSaved, onError }: {
  receipt: Receipt; canEdit: boolean; onSaved: (msg: string) => void; onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const save = async (url: string | null, name: string | null) => {
    setBusy(true);
    try {
      const res = await crmPut(`/api/customer-receipts/${receipt.id}/proof`, { proof_url: url, proof_name: name });
      onSaved(res.message || "Proof saved");
    } catch (e: any) {
      onError(e?.message || "Could not save the proof");
    } finally {
      setBusy(false);
    }
  };
  const pick = async (file: File) => {
    setBusy(true);
    try {
      const up = await crmUpload<{ url: string; name: string }>("/api/customer-receipts/proof", file);
      await save(up.data.url, up.data.name || file.name);
    } catch (e: any) {
      onError(e?.message || "Could not upload the proof");
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-subtle pt-3 text-xs">
      <span className="font-semibold text-secondary">Proof of payment:</span>
      {receipt.proof_url ? <><ProofChip url={receipt.proof_url} name={receipt.proof_name} />
        <span className="text-muted">{receipt.proof_name}</span></> : <span className="text-muted">none attached</span>}
      {canEdit && (
        <>
          <button type="button" disabled={busy} className="font-semibold text-sky-600 hover:underline"
            onClick={() => inputRef.current?.click()}>{receipt.proof_url ? "Replace" : "Attach proof"}</button>
          {receipt.proof_url && (
            <button type="button" disabled={busy} className="font-semibold text-rose-600 hover:underline"
              onClick={() => void save(null, null)}>Remove</button>
          )}
          <input ref={inputRef} type="file" className="hidden" accept="image/*,.pdf,.xls,.xlsx,.csv,.doc,.docx,.txt"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ""; }} />
        </>
      )}
    </div>
  );
}

export const pillCls = (on: boolean) => `rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${on
  ? "border-emerald-500 bg-emerald-600 text-white shadow-raised"
  : "border-subtle bg-surface-1 text-secondary hover:border-emerald-300 hover:text-primary"}`;
