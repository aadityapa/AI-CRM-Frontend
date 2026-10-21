/** "Address on this invoice" (21 Oct 2026, reported: a customer moved and every
 * invoice already generated printed the NEW address).
 *
 * Every invoice now keeps the buyer / shipping details it was issued with
 * (server: services/invoice_parties.py, migration 0143). This card shows them,
 * says when the customer's records have changed since, and lets Finance correct
 * the address printed on an invoice — e.g. put back the address it was really
 * sent with — on this invoice and, in one go, on the earlier invoices that print
 * the same address. `GET / PUT /api/invoices/{id}/parties`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, History, Info, Lock, MapPin, PenLine, Truck } from "lucide-react";
import { crmGet, crmPut } from "../../api";
import { Modal, inputCls } from "../ui";
import { DialogActions, DialogFailure, DialogHero, DialogSection, ReasonBox, WhatHappens, useCtrlEnter } from "../dialogKit";
import { fmtDateTime12 } from "../../../lib/datetime";

export type PartyForm = {
  name?: string | null; line1?: string | null; line2?: string | null; city?: string | null;
  state?: string | null; pincode?: string | null; country?: string | null; gstin?: string | null;
  pan?: string | null; print_address?: string | null;
};
type AddrOnly = Omit<PartyForm, "name" | "gstin" | "pan" | "print_address">;

export type InvoiceParties = {
  invoice_id: number; invoice_number: string | null; invoice_date: string | null; kind: string;
  irn_recorded: boolean; frozen: boolean; captured_at: string | null; source: string | null;
  corrected: { at?: string; by_name?: string | null; reason?: string } | null;
  printed: { buyer: PartyForm; shipping: PartyForm };
  current: { buyer: PartyForm; shipping: PartyForm; branch_id: number | null; branch_name: string | null };
  customer_address_changed: boolean;
  po: { po_number: string; billing: AddrOnly | null; delivery: AddrOnly | null } | null;
  same_address: { id: number; invoice_number: string | null; invoice_date: string | null; kind: string }[];
};

const SOURCE_WORDS: Record<string, string> = {
  issued: "Kept from the day it was raised",
  converted: "Kept from the day the original invoice was generated",
  backfill: "Recorded when address-keeping was switched on",
  corrected: "Corrected by Finance",
};

export const MIN_REASON = 10;

/** One printable line for the card ("6th Floor…, Vadodara, Gujarat - 390012"). */
export function addressLine(f: PartyForm | AddrOnly | null | undefined): string {
  if (!f) return "";
  if ("print_address" in f && f.print_address) return f.print_address;
  const tail = [f.city, f.state].filter(Boolean).join(", ");
  return [f.line1, f.line2, tail ? `${tail}${f.pincode ? ` - ${f.pincode}` : ""}` : f.pincode, f.country]
    .filter(Boolean).join(", ");
}

/** What the correction must have before it can be saved (mirror of the server). */
export function correctionProblems(buyer: PartyForm, reason: string): string[] {
  const out: string[] = [];
  if (!(buyer.name || "").trim()) out.push("the buyer's name");
  if (!(buyer.line1 || "").trim()) out.push("the buyer's address");
  if (buyer.gstin && buyer.gstin.trim() && buyer.gstin.trim().length !== 15) out.push("a 15-character GSTIN");
  if (reason.trim().length < MIN_REASON) out.push(`a reason (${MIN_REASON}+ characters)`);
  return out;
}

const fmtDay = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN",
  { day: "numeric", month: "short", year: "numeric" }) : "—");

function PartyBlock({ icon: Icon, title, f, gst }: { icon: typeof Building2; title: string; f: PartyForm; gst?: boolean }) {
  return (
    <div className="rounded-lg border border-subtle bg-surface-2 p-3">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
        <Icon size={12} aria-hidden /> {title}
      </p>
      <p className="text-sm font-semibold text-primary">{f.name || "—"}</p>
      <p className="text-xs leading-relaxed text-secondary">{addressLine(f) || "No address on record"}</p>
      {gst && (f.gstin || f.pan) && (
        <p className="mt-1 text-[11px] text-muted">
          {f.gstin && <>GSTIN <span className="font-mono font-semibold text-secondary">{f.gstin}</span></>}
          {f.gstin && f.pan && " · "}
          {f.pan && <>PAN <span className="font-mono font-semibold text-secondary">{f.pan}</span></>}
        </p>
      )}
    </div>
  );
}

export function InvoiceAddressCard({ invoiceId, canCorrect, onChanged, notify }: {
  invoiceId: number;
  canCorrect: boolean;
  onChanged?: () => void;
  notify?: (msg: string, kind?: "ok" | "err") => void;
}) {
  const [data, setData] = useState<InvoiceParties | null>(null);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    crmGet<InvoiceParties>(`/api/invoices/${invoiceId}/parties`)
      .then((r) => { setData(r.data as InvoiceParties); setErr(""); })
      .catch((e) => setErr(e?.message || "Could not load the invoice address"));
  }, [invoiceId]);
  useEffect(() => { load(); }, [load]);

  if (err) return <p className="rounded-card border border-subtle bg-surface-1 p-3 text-xs text-muted">{err}</p>;
  if (!data) return null;
  const sameShip = addressLine(data.printed.shipping) === addressLine(data.printed.buyer);

  return (
    <section className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
      <header className="mb-3 flex flex-wrap items-start gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white" aria-hidden>
          <MapPin size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-primary">Address on this invoice</h3>
          <p className="flex items-center gap-1 text-xs text-muted">
            {data.frozen ? <Lock size={11} aria-hidden /> : <Info size={11} aria-hidden />}
            {data.frozen
              ? `${SOURCE_WORDS[data.source || ""] || "Kept on the invoice"}${data.captured_at ? ` · ${fmtDateTime12(data.captured_at)}` : ""}`
              : "Read from the customer's records"}
          </p>
        </div>
        {canCorrect && (
          <button type="button" onClick={() => setEditing(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-subtle bg-surface-2 px-3 text-xs font-semibold text-secondary hover:text-primary">
            <PenLine size={13} aria-hidden /> Correct address
          </button>
        )}
      </header>

      {data.customer_address_changed && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <History size={14} className="mt-px shrink-0" aria-hidden />
          <span>
            The customer's address has changed since — this invoice keeps the address it was issued with.
            New invoices print the new one{data.current.branch_name ? ` (${data.current.branch_name})` : ""}:
            <span className="block font-semibold">{addressLine(data.current.buyer)}</span>
          </span>
        </div>
      )}
      {data.corrected && (
        <p className="mb-3 flex items-start gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
          <CheckCircle2 size={13} className="mt-px shrink-0" aria-hidden />
          <span>Corrected{data.corrected.by_name ? ` by ${data.corrected.by_name}` : ""}
            {data.corrected.at ? ` · ${fmtDateTime12(data.corrected.at)}` : ""}{data.corrected.reason ? ` — ${data.corrected.reason}` : ""}</span>
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <PartyBlock icon={Building2} title="Bill to (buyer)" f={data.printed.buyer} gst />
        {sameShip
          ? <div className="rounded-lg border border-dashed border-subtle p-3 text-xs text-muted">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide"><Truck size={12} aria-hidden /> Ship to</p>
              Same as the buyer's address.
            </div>
          : <PartyBlock icon={Truck} title="Ship to" f={data.printed.shipping} />}
      </div>

      {editing && (
        <CorrectAddressModal data={data} onClose={() => setEditing(false)}
          onSaved={(next, msg) => { setData(next); setEditing(false); notify?.(msg, "ok"); onChanged?.(); }} />
      )}
    </section>
  );
}

const FIELDS: { key: keyof PartyForm; label: string; span?: boolean; buyerOnly?: boolean }[] = [
  { key: "name", label: "Name on the invoice", span: true },
  { key: "line1", label: "Address line 1", span: true },
  { key: "line2", label: "Address line 2", span: true },
  { key: "city", label: "City" }, { key: "state", label: "State" },
  { key: "pincode", label: "PIN code" }, { key: "country", label: "Country" },
  { key: "gstin", label: "GSTIN", buyerOnly: true }, { key: "pan", label: "PAN", buyerOnly: true },
];

function PartyFields({ prefix, form, set, buyer }: {
  prefix: string; form: PartyForm; set: (f: PartyForm) => void; buyer?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {FIELDS.filter((f) => buyer || !f.buyerOnly).map((f) => (
        <label key={f.key} className={`text-xs font-semibold text-secondary ${f.span ? "sm:col-span-2" : ""}`}>
          {f.label}
          <input id={`${prefix}-${f.key}`} className={`${inputCls} mt-1`} value={(form[f.key] as string) || ""}
            onChange={(e) => set({ ...form, [f.key]: e.target.value })} />
        </label>
      ))}
    </div>
  );
}

function strip(f: PartyForm): PartyForm {
  const { print_address: _p, ...rest } = f;
  return rest;
}

function CorrectAddressModal({ data, onClose, onSaved }: {
  data: InvoiceParties;
  onClose: () => void;
  onSaved: (next: InvoiceParties, msg: string) => void;
}) {
  const initialShipDiffers = addressLine(data.printed.shipping) !== addressLine(data.printed.buyer);
  const [buyer, setBuyer] = useState<PartyForm>(strip(data.printed.buyer));
  const [shipOwn, setShipOwn] = useState(initialShipDiffers);
  const [ship, setShip] = useState<PartyForm>(strip(data.printed.shipping));
  const [reason, setReason] = useState("");
  const [apply, setApply] = useState<Set<number>>(new Set(data.same_address.map((s) => s.id)));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const problems = correctionProblems(buyer, reason);
  const dirty = JSON.stringify(buyer) !== JSON.stringify(strip(data.printed.buyer)) || reason.trim() !== "";

  const fills = useMemo(() => {
    const out: { label: string; buyer?: AddrOnly; ship?: AddrOnly }[] = [];
    if (data.po?.billing) out.push({ label: `Use the address on PO ${data.po.po_number}`, buyer: data.po.billing,
      ship: data.po.delivery || undefined });
    out.push({ label: "Use the customer's current address", buyer: data.current.buyer, ship: data.current.shipping });
    return out;
  }, [data]);

  const fillFrom = (b?: AddrOnly, s?: AddrOnly) => {
    const pick = (src: AddrOnly) => ({ line1: src.line1, line2: src.line2, city: src.city, state: src.state,
      pincode: src.pincode, country: src.country });
    if (b) setBuyer((cur) => ({ ...cur, ...pick(b) }));
    if (s) { setShip((cur) => ({ ...cur, ...pick(s) })); setShipOwn(addressLine(s) !== addressLine(b)); }
  };

  const save = async () => {
    if (busy || problems.length) return;
    setBusy(true);
    setFailure("");
    try {
      const r = await crmPut<InvoiceParties>(`/api/invoices/${data.invoice_id}/parties`, {
        buyer, shipping: shipOwn ? ship : null, reason: reason.trim(), apply_to: [...apply],
      });
      onSaved(r.data as InvoiceParties, r.message || "Address corrected");
    } catch (e: any) {
      setFailure(e?.message || "Could not save — try again");
      setBusy(false);
    }
  };
  useCtrlEnter(() => void save());

  const n = 1 + apply.size;
  return (
    <Modal title={`Correct the address — ${data.invoice_number || "invoice"}`} xl dirty={dirty}
      onClose={() => { if (!busy) onClose(); }}
      hero={<DialogHero tone="sky" icon={MapPin} eyebrow="Invoice address"
        title={`Correct the address printed on ${data.invoice_number || "this invoice"}`}
        subtitle="Only the printed buyer / shipping details change. Amounts, GST and the customer's own records stay as they are." />}
      footer={<DialogActions tone="sky" icon={CheckCircle2} label={`Save on ${n} invoice${n > 1 ? "s" : ""}`}
        busy={busy} disabled={problems.length > 0} onCancel={onClose} onConfirm={() => void save()}
        hint={problems.length ? <span className="text-warning">Still needed: {problems.join(" · ")}</span> : "Ctrl/⌘ + Enter saves"} />}
    >
      <div className="space-y-4">
        {data.irn_recorded && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            This invoice already has an IRN. Correcting the printed address here does not change what is registered on the
            GST portal — fix it there too if the registered address was wrong.
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {fills.map((f) => (
            <button key={f.label} type="button" onClick={() => fillFrom(f.buyer, f.ship)}
              className="rounded-full border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
              {f.label}
            </button>
          ))}
        </div>
        <DialogSection n={1} tone="sky" title="Bill to (buyer)" done={!!(buyer.name && buyer.line1)}>
          <PartyFields prefix="buyer" form={buyer} set={setBuyer} buyer />
        </DialogSection>
        <DialogSection n={2} tone="sky" title="Ship to" done optional
          action={(
            <label className="flex items-center gap-1.5 text-xs font-semibold text-secondary">
              <input type="checkbox" checked={!shipOwn} onChange={(e) => setShipOwn(!e.target.checked)} />
              Same as the buyer
            </label>
          )}>
          {shipOwn ? <PartyFields prefix="ship" form={ship} set={setShip} />
            : <p className="text-xs text-muted">The invoice ships to the buyer's address.</p>}
        </DialogSection>
        {data.same_address.length > 0 && (
          <DialogSection n={3} tone="sky" title="Earlier invoices printing the same address" optional done
            hint="They were issued before this one and print exactly the same buyer and shipping details. Tick the ones that should get the corrected address too — a later invoice is never changed here.">
            <div className="mb-2 flex gap-3 text-xs">
              <button type="button" className="font-semibold text-brand-600 hover:underline"
                onClick={() => setApply(new Set(data.same_address.map((s) => s.id)))}>Tick all</button>
              <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => setApply(new Set())}>None</button>
            </div>
            <ul className="grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">
              {data.same_address.map((s) => (
                <li key={s.id}>
                  <label className="flex items-center gap-2 rounded-lg border border-subtle bg-surface-2 px-2.5 py-1.5 text-xs">
                    <input type="checkbox" checked={apply.has(s.id)} onChange={(e) => setApply((cur) => {
                      const nx = new Set(cur); if (e.target.checked) nx.add(s.id); else nx.delete(s.id); return nx; })} />
                    <span className="font-semibold text-primary">{s.invoice_number || `#${s.id}`}</span>
                    <span className="text-muted">{fmtDay(s.invoice_date)}</span>
                    {s.kind === "Proforma" && <span className="rounded-full bg-orange-100 px-1.5 text-[10px] font-bold text-orange-700">PI</span>}
                  </label>
                </li>
              ))}
            </ul>
          </DialogSection>
        )}
        <ReasonBox id="address-reason" label="Why is the address being corrected?" value={reason} onChange={setReason}
          required min={MIN_REASON} tone="sky"
          picks={["Customer moved — restore the address these invoices were sent with",
            "Wrong address was on record when the invoice was raised", "Customer asked for the registered office address"]} />
        <WhatHappens tone="sky" items={[
          { icon: Lock, text: "The corrected address is kept on these invoices — later changes to the customer will not touch them." },
          { icon: History, text: "The change is written to the customer's Activity Log with the old and new address." },
          { icon: Building2, text: "The customer's branch record is not changed — new invoices keep using it." },
        ]} />
        <DialogFailure message={failure} />
      </div>
    </Modal>
  );
}

export default InvoiceAddressCard;
