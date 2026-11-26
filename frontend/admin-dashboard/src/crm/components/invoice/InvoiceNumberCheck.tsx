/**
 * "Is this invoice number already in the tool?" (26 Nov 2026, user rule: an
 * invoice number exists ONCE). The dialogs that take a number ask the server
 * while it is typed (`GET /api/invoices/number-check`) and refuse to submit a
 * taken one; the server applies the same rule on save, so this is advice that
 * saves a round trip, never the only guard.
 *
 * The comparison ignores case, spaces and dash look-alikes — the client twin
 * is `invoiceNumberKey` (PURE, tested).
 */
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { crmGet } from "../../api";
import { CrmLink } from "../../router";

const DASHES = /[‐-―−﹘﹣－]/g;

/** How the server stores a typed number: trimmed, spaces collapsed, dashes plain. */
export function normalizeInvoiceNumber(raw: string): string {
  return String(raw || "").replace(DASHES, "-").split(/\s+/).filter(Boolean).join(" ").slice(0, 64);
}

/** What two numbers are compared on — case, spaces and dash look-alikes ignored. */
export function invoiceNumberKey(raw: string): string {
  return normalizeInvoiceNumber(raw).replace(/ /g, "").toUpperCase();
}

export type NumberCheck =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "free"; number: string }
  | { state: "taken"; number: string; holderId: number; words: string }
  | { state: "unknown" };

/** Debounced check of `number` (blank = idle). `currentNumber` — the number the
 * invoice already carries — is never "taken" by itself. */
export function useInvoiceNumberCheck(number: string, opts: { excludeId?: number; currentNumber?: string | null } = {}): NumberCheck {
  const { excludeId, currentNumber } = opts;
  const [check, setCheck] = useState<NumberCheck>({ state: "idle" });
  const key = invoiceNumberKey(number);
  const sameAsCurrent = !!currentNumber && key === invoiceNumberKey(currentNumber);

  useEffect(() => {
    if (!key || sameAsCurrent) { setCheck({ state: "idle" }); return; }
    let cancelled = false;
    setCheck({ state: "checking" });
    const t = window.setTimeout(() => {
      const params = new URLSearchParams({ number: normalizeInvoiceNumber(number) });
      if (excludeId) params.set("exclude_id", String(excludeId));
      crmGet<{ number: string; available: boolean; taken_by: { id: number; words: string } | null }>(
        `/api/invoices/number-check?${params.toString()}`)
        .then((r) => {
          if (cancelled) return;
          const d = r.data;
          if (d?.taken_by) setCheck({ state: "taken", number: d.number, holderId: d.taken_by.id, words: d.taken_by.words });
          else setCheck({ state: "free", number: d?.number || normalizeInvoiceNumber(number) });
        })
        .catch(() => { if (!cancelled) setCheck({ state: "unknown" }); });   // the save still checks
    }, 350);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [key, sameAsCurrent, excludeId]); // eslint-disable-line react-hooks/exhaustive-deps

  return check;
}

/** The line under the number field. */
export function InvoiceNumberHint({ check }: { check: NumberCheck }) {
  if (check.state === "checking") {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-muted">
        <Loader2 size={12} className="animate-spin" /> Checking the number…
      </p>
    );
  }
  if (check.state === "taken") {
    return (
      <p role="alert" className="mt-1 flex items-start gap-1 text-xs font-medium text-danger">
        <AlertTriangle size={13} className="mt-px shrink-0" />
        <span>
          {check.number} is already present in the tool — {check.words}.{" "}
          <CrmLink to={`invoices/${check.holderId}`} className="underline">Open it</CrmLink>. Use a different number.
        </span>
      </p>
    );
  }
  if (check.state === "free") {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-success">
        <CheckCircle2 size={12} /> {check.number} is free
      </p>
    );
  }
  return null;
}
