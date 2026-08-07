import React from "react";
import type { Invoice, LineItem, SellerConstants } from "./types";
import { DEFAULT_SAC, FIXED_SELLER } from "./types";
import { INDIA_STATES, stateNameForCode } from "./states";
import { formatInr, lineAmount, num } from "./math";
import { inputCls } from "../components/ui";

type Props = {
  value: Invoice;
  onChange: (next: Invoice) => void;
  seller?: SellerConstants;
};

const field = "space-y-1";
const label = "block text-xs font-semibold uppercase tracking-wide text-muted";

export function InvoiceForm({ value, onChange, seller = FIXED_SELLER }: Props) {
  const set = (patch: Partial<Invoice>) => onChange({ ...value, ...patch });
  const setBuyer = (patch: Partial<Invoice["buyer"]>) =>
    onChange({ ...value, buyer: { ...value.buyer, ...patch } });

  const setItem = (idx: number, patch: Partial<LineItem>) => {
    const items = value.items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    onChange({ ...value, items });
  };

  const addItem = () =>
    onChange({
      ...value,
      items: [...value.items, { employee_name: "", sac: DEFAULT_SAC, billing_hours: 0, rate_per_hour: 0 }],
    });

  const removeItem = (idx: number) => {
    if (value.items.length <= 1) return;
    onChange({ ...value, items: value.items.filter((_, i) => i !== idx) });
  };

  const onGstn = (gstn: string) => {
    const upper = gstn.toUpperCase();
    const code = upper.slice(0, 2);
    if (/^\d{2}/.test(code)) {
      setBuyer({ gstn: upper, state_code: code, state_name: stateNameForCode(code) });
    } else {
      setBuyer({ gstn: upper });
    }
  };

  const onState = (code: string) => {
    setBuyer({ state_code: code, state_name: stateNameForCode(code) });
  };

  return (
    <div className="space-y-4 text-sm">
      <section className="rounded-xl border border-subtle bg-surface-1/40 p-4 space-y-3">
        <h2 className="text-sm font-bold text-primary">Seller (fixed PAN / GSTIN / bank)</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className={field}>
            <label className={label}>Name</label>
            <input className={inputCls} value={seller.name} readOnly />
          </div>
          <div className={field}>
            <label className={label}>Email / CIN</label>
            <input className={inputCls} value={`${seller.email} · ${seller.cin}`} readOnly />
          </div>
          <div className={`${field} md:col-span-2`}>
            <label className={label}>Address</label>
            <textarea className={inputCls} rows={3} value={seller.address} readOnly />
          </div>
          <div className={field}>
            <label className={label}>PAN / GSTIN</label>
            <input className={inputCls} value={`${seller.pan} · ${seller.gstin}`} readOnly />
          </div>
          <div className={field}>
            <label className={label}>Bank</label>
            <input
              className={inputCls}
              value={`${seller.bank_name_short} · ${seller.bank_acc} · ${seller.ifsc}`}
              readOnly
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-subtle bg-surface-1/40 p-4 space-y-3">
        <h2 className="text-sm font-bold text-primary">Invoice meta</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className={field}>
            <label className={label}>Invoice No.</label>
            <input
              className={inputCls}
              value={value.invoice_no}
              onChange={(e) => set({ invoice_no: e.target.value })}
            />
          </div>
          <div className={field}>
            <label className={label}>Invoice Date (dd/mm/yyyy)</label>
            <input
              className={inputCls}
              value={value.invoice_date}
              onChange={(e) => set({ invoice_date: e.target.value })}
            />
          </div>
          <div className={field}>
            <label className={label}>P.O. No.</label>
            <input
              className={inputCls}
              value={value.po_no || ""}
              onChange={(e) => set({ po_no: e.target.value })}
            />
          </div>
          <div className={field}>
            <label className={label}>P.O. Date</label>
            <input
              className={inputCls}
              value={value.po_date || ""}
              onChange={(e) => set({ po_date: e.target.value })}
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-subtle bg-surface-1/40 p-4 space-y-3">
        <h2 className="text-sm font-bold text-primary">Buyer</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className={field}>
            <label className={label}>Buyer Details</label>
            <input
              className={inputCls}
              value={value.buyer.name}
              onChange={(e) => setBuyer({ name: e.target.value })}
            />
          </div>
          <div className={field}>
            <label className={label}>PAN</label>
            <input
              className={inputCls}
              value={value.buyer.pan}
              onChange={(e) => setBuyer({ pan: e.target.value.toUpperCase() })}
            />
          </div>
          <div className={`${field} md:col-span-2`}>
            <label className={label}>Address2 (bill-to)</label>
            <textarea
              className={inputCls}
              rows={2}
              value={value.buyer.address}
              onChange={(e) => setBuyer({ address: e.target.value })}
            />
          </div>
          <div className={field}>
            <label className={label}>GSTN ID</label>
            <input
              className={inputCls}
              value={value.buyer.gstn}
              onChange={(e) => onGstn(e.target.value)}
              maxLength={15}
            />
          </div>
          <div className={field}>
            <label className={label}>State</label>
            <select
              className={inputCls}
              value={value.buyer.state_code}
              onChange={(e) => onState(e.target.value)}
            >
              {INDIA_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className={field}>
            <label className={label}>Shipping Details</label>
            <input
              className={inputCls}
              value={value.buyer.shipping}
              onChange={(e) => setBuyer({ shipping: e.target.value })}
            />
          </div>
          <div className={field}>
            <label className={label}>Address1 (ship-to)</label>
            <input
              className={inputCls}
              value={value.buyer.shipping_address}
              onChange={(e) => setBuyer({ shipping_address: e.target.value })}
            />
          </div>
        </div>
        {value.buyer.state_code !== "27" && (
          <p className="text-xs text-amber-400">Buyer state ≠ 27 → IGST @ 18% will apply.</p>
        )}
      </section>

      <section className="rounded-xl border border-subtle bg-surface-1/40 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-primary">Line items</h2>
          <button type="button" className="text-xs font-semibold text-sky-400 hover:underline" onClick={addItem}>
            + Add line
          </button>
        </div>
        <div className="space-y-3">
          {value.items.map((it, idx) => (
            <div key={idx} className="grid gap-2 rounded-lg border border-subtle p-3 md:grid-cols-6">
              <div className={`${field} md:col-span-2`}>
                <label className={label}>Employee / description</label>
                <input
                  className={inputCls}
                  value={it.employee_name}
                  onChange={(e) => setItem(idx, { employee_name: e.target.value })}
                />
              </div>
              <div className={field}>
                <label className={label}>SAC</label>
                <input
                  className={inputCls}
                  value={it.sac}
                  onChange={(e) => setItem(idx, { sac: e.target.value })}
                />
              </div>
              <div className={field}>
                <label className={label}>Billing Hours</label>
                <input
                  className={inputCls}
                  type="number"
                  value={it.billing_hours}
                  onChange={(e) => setItem(idx, { billing_hours: num(e.target.value) })}
                />
              </div>
              <div className={field}>
                <label className={label}>Rate/Hour</label>
                <input
                  className={inputCls}
                  type="number"
                  value={it.rate_per_hour}
                  onChange={(e) => setItem(idx, { rate_per_hour: num(e.target.value) })}
                />
              </div>
              <div className={field}>
                <label className={label}>Amount (derived)</label>
                <div className="flex items-center gap-2">
                  <input className={inputCls} readOnly value={formatInr(lineAmount(it))} />
                  {value.items.length > 1 && (
                    <button
                      type="button"
                      className="text-xs text-rose-400"
                      onClick={() => removeItem(idx)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
