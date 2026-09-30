/**
 * "Does Sales have what they need?" — the checklist inside every
 * Submit-to-Sales dialog (29 Sep 2026, user ask: "when GM / RMG submit to
 * Sales, show all details Sales requires so RMG / GM can verify — and add
 * what is missing right there").
 *
 * The list is the SERVER's (`checks` on `GET …/handover-note`, B-V2
 * `handover_note.sales_readiness`). A missing item with a `field` gets an
 * inline input; "Save details" PATCHes only what was typed to
 * `…/sales-details` and swaps in the refreshed list. A gap never blocks the
 * submit — RMG may know something the record does not — it is shown in red
 * and counted in the header so nobody submits blind.
 */
import { useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Pencil, Save } from "lucide-react";

import { crmPatch } from "../api";
import type { SalesCheck } from "./handoverNote";
import { btnPrimary } from "./ui";

const CONTROL = "h-8 w-full rounded-input border border-subtle bg-surface-1 px-2 text-sm text-primary focus:border-brand-500 focus:outline-none";

export function SalesReadinessPanel({ profileId, checks, onChecks, onError }: {
  profileId: number;
  checks: SalesCheck[] | null;
  onChecks: (next: SalesCheck[]) => void;
  onError: (msg: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  if (checks === null) {
    return <div className="shimmer h-40 rounded-card bg-surface-2" aria-busy="true" aria-label="Loading what Sales needs" />;
  }
  if (!checks.length) return null;

  const gaps = checks.filter((c) => c.required && !c.ok);
  const typed = Object.entries(values).filter(([, v]) => v.trim() !== "");
  const save = async () => {
    setBusy(true);
    try {
      const body: Record<string, string | number> = {};
      for (const [field, v] of typed) {
        const c = checks.find((x) => x.field === field);
        body[field] = c && c.input !== "text" ? Number(v) : v.trim();
      }
      const res = await crmPatch<{ checks: SalesCheck[] }>(`/api/candidate-profiles/${profileId}/sales-details`, body);
      onChecks(res.data?.checks || checks);
      setValues({}); setEditing({});
    } catch (e: any) {
      onError(e?.message || "Could not save the details");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`rounded-card border p-3 ${gaps.length ? "border-amber-300 dark:border-amber-700" : "border-emerald-300 dark:border-emerald-800"}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 text-sm font-bold text-primary">
          {gaps.length
            ? <AlertTriangle size={15} className="text-warning" aria-hidden />
            : <CheckCircle2 size={15} className="text-success" aria-hidden />}
          What Sales needs
        </h3>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${gaps.length ? "bg-warning-soft text-warning" : "bg-success-soft text-success"}`}>
          {gaps.length ? `${gaps.length} missing` : "All set"}
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {checks.map((c) => {
          const open = !!c.field && (!c.ok || editing[c.key]);
          return (
            <li key={c.key} className={`rounded-control border px-2.5 py-1.5 ${!c.ok && c.required ? "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950" : "border-subtle bg-surface-2"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold text-secondary">
                  {c.ok ? <CheckCircle2 size={13} className="shrink-0 text-success" aria-hidden />
                    : <CircleDashed size={13} className={`shrink-0 ${c.required ? "text-danger" : "text-muted"}`} aria-hidden />}
                  {c.label}{!c.required && <span className="font-normal text-muted"> (optional)</span>}
                </span>
                {c.ok && c.field && !editing[c.key] && (
                  <button type="button" className="text-muted hover:text-primary" aria-label={`Edit ${c.label}`}
                    onClick={() => setEditing((e) => ({ ...e, [c.key]: true }))}>
                    <Pencil size={12} aria-hidden />
                  </button>
                )}
              </div>
              {open ? (
                <div className="mt-1 flex items-center gap-1.5">
                  <input className={CONTROL} aria-label={c.label}
                    type={c.input === "text" ? "text" : "number"} min={0} step={c.input === "money_lac" ? 0.01 : 0.5}
                    placeholder={c.input === "money_lac" ? "Lac, e.g. 12.5" : c.input === "number" ? "Years" : c.key === "notice_period" ? "e.g. 30 days" : ""}
                    value={values[c.field!] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [c.field!]: e.target.value }))} />
                  {c.input === "money_lac" && <span className="text-xs text-muted">L</span>}
                </div>
              ) : (
                <p className={`mt-0.5 truncate text-sm ${c.ok ? "font-semibold text-primary" : "text-muted"}`} title={c.value || c.hint || undefined}>
                  {c.value || c.hint || "Not on file"}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {typed.length > 0 && (
        <div className="mt-2 flex justify-end">
          <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy}>
            <Save size={14} aria-hidden /> {busy ? "Saving…" : `Save ${typed.length} detail${typed.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
    </section>
  );
}
