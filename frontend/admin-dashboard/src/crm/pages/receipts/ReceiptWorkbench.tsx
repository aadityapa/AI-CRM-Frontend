/**
 * Work on a saved customer receipt (22 Oct 2026, Finance ask with a screenshot):
 * money usually lands BEFORE Finance knows which invoices it pays, so it is
 * recorded "on account" first. Clicking a receipt used to toggle a panel at the
 * very bottom of the page — on a long grouped list nothing seemed to happen.
 *
 *   * ReceiptDetailModal — opens on the row: the amount, where it went (applied ·
 *     TDS · on account), every invoice it settles with Unmap, the proof, notes,
 *     and Map invoices · Edit details · Delete.
 *   * MapInvoicesModal — puts the on-account amount on the customer's open
 *     invoices (oldest first by default, every amount editable, TDS asked per
 *     invoice). `POST /api/customer-receipts/{id}/allocate`.
 *   * EditReceiptModal — date · amount (never below what is applied) · mode ·
 *     reference · branch · notes. `PUT /api/customer-receipts/{id}`.
 *
 * Unmap = `DELETE /api/customer-receipts/{id}/allocations/{invoice_id}`.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Check, Clock, Link2, Lock, MapPin, Pencil, Percent, Trash2, Undo2, Wallet, Wand2,
} from "lucide-react";
import {
  DEFAULT_SECTIONS, TdsChip, TdsDeductionModal, netDue,
  type TdsChoice, type TdsInfo, type TdsSection,
} from "../../components/invoice/TdsDeduction";
import { DialogActions, DialogFailure, DialogHero, DialogSection } from "../../components/dialogKit";
import { crmGet, crmPost, crmPut, crmDelete } from "../../api";
import { CrmLink } from "../../routerHooks";
import { ConfirmModal, Modal, StatusBadge, btnSecondary, inputCls } from "../../components/ui";
import {
  PAYMENT_MODES, ProofChip, ReceiptProofRow, daysLate, fmtDate, inr, isoDay, pillCls,
  type BranchOption, type InvoiceOption, type Receipt,
} from "./receiptShared";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Partly paid: some money in, a balance still due (PURE). */
export function isPartlyPaid(o: Pick<InvoiceOption, "paid_amount" | "balance_amount"> & { tds_deducted?: number }): boolean {
  return (Number(o.paid_amount || 0) > 0 || Number(o.tds_deducted || 0) > 0) && Number(o.balance_amount || 0) > 0;
}

/** The invoice whose balance equals this payment (±₹1) — the likely one when the
 *  customer's advice names no invoice (24 Oct 2026; server `likely_match`). PURE. */
export function isLikelyMatch(o: Pick<InvoiceOption, "balance_amount">, amount: number): boolean {
  const b = Number(o.balance_amount || 0);
  return b > 0 && amount > 0 && Math.abs(b - amount) < 1;
}

/** Likely matches first, the rest in the server's (oldest-first) order. PURE. */
export function orderByLikelyMatch<T extends Pick<InvoiceOption, "balance_amount">>(rows: T[], amount: number): T[] {
  const hit = rows.filter((o) => isLikelyMatch(o, amount));
  return hit.length ? [...hit, ...rows.filter((o) => !isLikelyMatch(o, amount))] : rows;
}

/**
 * How much each ticked invoice gets (PURE, the client twin of the server's
 * `plan_mapping`): typed amounts first, then the rest oldest-first, each up to
 * what is still due on the invoice. `ids` are in oldest-first order.
 */
export function mapPlan(available: number, ids: number[], due: Record<number, number>,
                        typed: Record<number, string>): { take: Record<number, number>; left: number; over: string } {
  const take: Record<number, number> = {};
  let left = round2(available);
  let over = "";
  for (const id of ids) {
    const raw = typed[id];
    if (raw == null || raw === "") continue;
    const v = round2(Math.max(0, Number(raw) || 0));
    if (v > round2(due[id] ?? 0) + 0.004) over = over || "An amount is more than that invoice's balance";
    take[id] = v;
    left = round2(left - v);
  }
  if (left < -0.004) over = over || "The amounts are more than is left on account";
  for (const id of ids) {
    if (id in take) continue;
    const v = Math.max(0, Math.min(round2(due[id] ?? 0), Math.max(0, left)));
    take[id] = round2(v);
    left = round2(left - v);
  }
  return { take, left, over };
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone: "emerald" | "amber" | "slate" | "sky"; hint?: string }) {
  const cls = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200",
    amber: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
    slate: "border-subtle bg-surface-2 text-primary",
    sky: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200",
  }[tone];
  return (
    <div className={`rounded-card border px-3 py-2.5 ${cls}`} title={hint}>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-0.5 text-lg font-extrabold tabular-nums">{value}</div>
    </div>
  );
}

/** Applied · TDS · on account as one bar (out of cash received + TDS). */
function SplitBar({ applied, tds, onAccount }: { applied: number; tds: number; onAccount: number }) {
  const total = applied + tds + onAccount;
  if (!(total > 0)) return null;
  const w = (v: number) => `${Math.max(0, (v / total) * 100)}%`;
  return (
    <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
      <div className="h-full bg-emerald-500" style={{ width: w(applied) }} />
      <div className="h-full bg-amber-400" style={{ width: w(tds) }} />
      <div className="h-full bg-slate-300 dark:bg-slate-600" style={{ width: w(onAccount) }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Open a receipt
// ---------------------------------------------------------------------------

export function ReceiptDetailModal({ receipt, canEdit, startWith, onClose, onChanged, onDelete, onTds, toast }: {
  receipt: Receipt;
  canEdit: boolean;
  /** Open straight into Map / Edit (the row buttons). */
  startWith?: "map" | "edit" | null;
  onClose: () => void;
  /** The server's message + the updated receipt — the list reloads. */
  onChanged: (msg: string, updated?: Receipt) => void;
  onDelete: (r: Receipt) => void;
  onTds: (tds: TdsInfo, invoiceNumber?: string | null) => void;
  toast: (msg: string, kind?: "err") => void;
}) {
  const [sub, setSub] = useState<"map" | "edit" | null>(startWith ?? null);
  const [unmapping, setUnmapping] = useState<Receipt["allocations"][number] | null>(null);
  const [busy, setBusy] = useState(false);
  const r = receipt;
  const applied = Number(r.allocated_amount || 0);
  const tds = Number(r.tds_total || 0);
  const onAccount = Number(r.unallocated_amount || 0);
  const where = [r.customer_name, r.branch_name || "No branch on record"].filter(Boolean).join(" · ");

  return (
    <>
      <Modal title={`Receipt #${r.id}`} xl onClose={onClose}
        hero={<DialogHero tone="emerald" icon={Wallet} eyebrow={`Receipt #${r.id} · ${where}`}
          title={<>{inr(r.amount)} received on {fmtDate(r.received_date)}</>}
          subtitle={[r.payment_mode, r.reference_number].filter(Boolean).join(" · ") || "No mode or reference recorded"}
          chips={<>
            {r.proof_url ? <ProofChip url={r.proof_url} name={r.proof_name} />
              : <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold ring-1 ring-white/25">No proof attached</span>}
            {onAccount > 0
              ? <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[11px] font-bold text-[#1e293b]">{inr(onAccount)} on account</span>
              : <span className="rounded-full bg-emerald-300 px-2 py-0.5 text-[11px] font-bold text-[#1e293b]">Fully mapped</span>}
          </>} />}
        footer={
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <button type="button" className="inline-flex items-center gap-1.5 rounded-control px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                onClick={() => onDelete(r)}>
                <Trash2 size={15} aria-hidden /> Delete receipt
              </button>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              <button type="button" className={btnSecondary} onClick={onClose}>Close</button>
              {canEdit && (
                <button type="button" className={btnSecondary} onClick={() => setSub("edit")}>
                  <Pencil size={15} aria-hidden /> Edit details
                </button>
              )}
              {canEdit && (
                <button type="button" disabled={!(onAccount > 0)}
                  title={onAccount > 0 ? undefined : "Nothing left on account — unmap an invoice or raise the amount first"}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 text-sm font-semibold text-white shadow-md hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => setSub("map")}>
                  <Link2 size={15} aria-hidden /> Map invoices
                </button>
              )}
            </div>
          </div>
        }>
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Received" value={inr(r.amount)} tone="sky" />
            <Stat label="Applied to invoices" value={inr(applied)} tone="emerald" />
            <Stat label="TDS withheld" value={inr(tds)} tone="amber"
              hint={Number(r.tds_pending || 0) > 0 ? `${inr(r.tds_pending)} still pending from the client` : undefined} />
            <Stat label="On account" value={inr(onAccount)} tone={onAccount > 0 ? "amber" : "slate"} />
          </div>
          <SplitBar applied={applied} tds={tds} onAccount={onAccount} />

          {onAccount > 0 && canEdit && (
            <div className="flex flex-wrap items-center gap-3 rounded-card border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
              <Link2 size={18} className="text-amber-700 dark:text-amber-300" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-primary">{inr(onAccount)} is not on any invoice yet</div>
                <div className="text-xs text-secondary">Map it to the invoices this payment covers — the invoices then read paid and the receivables update.</div>
              </div>
              <button type="button" className="inline-flex items-center gap-1.5 rounded-control bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700"
                onClick={() => setSub("map")}>
                <Link2 size={14} aria-hidden /> Map invoices
              </button>
            </div>
          )}

          <section>
            <h3 className="mb-2 text-sm font-bold text-primary">Invoices this payment settles ({r.allocations.length})</h3>
            {r.allocations.length === 0 ? (
              <div className="rounded-card border border-dashed border-subtle bg-surface-2 px-4 py-6 text-center text-sm text-muted">
                Not on any invoice yet — the whole amount is held on account.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-card border border-subtle">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Month · employee</th>
                      <th className="px-3 py-2 text-right">Cash applied</th><th className="px-3 py-2">TDS</th>
                      <th className="px-3 py-2 text-right">Balance now</th><th className="px-3 py-2">Status</th>
                      {canEdit && <th className="px-3 py-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {r.allocations.map((a) => (
                      <tr key={a.invoice_id} className="border-t border-subtle">
                        <td className="px-3 py-2">
                          <CrmLink to={`invoices/${a.invoice_id}`} className="whitespace-nowrap font-semibold text-sky-600 hover:underline">{a.invoice_number || `#${a.invoice_id}`}</CrmLink>
                          {a.project_name && <div className="text-[11px] text-muted">{a.project_name}</div>}
                        </td>
                        <td className="px-3 py-2">
                          {a.month_label && <span className="mr-1 rounded-full bg-teal-50 px-1.5 py-px text-[11px] font-semibold text-teal-800 dark:bg-teal-950/40 dark:text-teal-200">{a.month_label}</span>}
                          <span className="text-secondary">{a.employee_name || "—"}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{inr(a.amount)}</td>
                        <td className="whitespace-nowrap px-3 py-2">{a.tds ? <TdsChip tds={a.tds} compact onClick={() => onTds(a.tds as TdsInfo, a.invoice_number)} /> : <span className="text-muted">—</span>}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{inr(a.balance_amount)}</td>
                        <td className="px-3 py-2">{a.payment_status ? <StatusBadge status={a.payment_status} /> : "—"}</td>
                        {canEdit && (
                          <td className="px-3 py-2 text-right">
                            <button type="button" className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                              title="Take this invoice off the receipt — its money goes back on account"
                              onClick={() => setUnmapping(a)}>
                              <Undo2 size={13} aria-hidden /> Unmap
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {r.notes && (
            <section>
              <h3 className="mb-1 text-sm font-bold text-primary">Notes</h3>
              <p className="whitespace-pre-wrap rounded-card border border-subtle bg-surface-2 px-3 py-2 text-sm text-secondary">{r.notes}</p>
            </section>
          )}
          <ReceiptProofRow receipt={r} canEdit={canEdit}
            onSaved={(msg) => onChanged(msg)} onError={(m) => toast(m, "err")} />
        </div>
      </Modal>

      {sub === "map" && (
        <MapInvoicesModal receipt={r} onClose={() => setSub(null)}
          onSaved={(msg, updated) => { setSub(null); onChanged(msg, updated); }} />
      )}
      {sub === "edit" && (
        <EditReceiptModal receipt={r} onClose={() => setSub(null)}
          onSaved={(msg, updated) => { setSub(null); onChanged(msg, updated); }} />
      )}
      {unmapping && (
        <ConfirmModal
          title={`Unmap ${unmapping.invoice_number || `#${unmapping.invoice_id}`}?`}
          message={`${inr(unmapping.amount)} goes back on account and the invoice shows its balance again${unmapping.tds_booked_here ? " (the TDS recorded with this receipt on it is removed too)" : ""}. You can map it again any time.`}
          confirmLabel="Unmap"
          danger
          busy={busy}
          onClose={() => setUnmapping(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              const res = await crmDelete<Receipt>(`/api/customer-receipts/${r.id}/allocations/${unmapping.invoice_id}`);
              setUnmapping(null);
              onChanged(res.message || "Invoice unmapped", res.data as Receipt);
            } catch (e: any) {
              toast(e?.message || "Could not unmap the invoice", "err");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Map the on-account amount onto invoices
// ---------------------------------------------------------------------------

export function MapInvoicesModal({ receipt, onClose, onSaved }: {
  receipt: Receipt;
  onClose: () => void;
  onSaved: (msg: string, updated?: Receipt) => void;
}) {
  const available = Number(receipt.unallocated_amount || 0);
  const [options, setOptions] = useState<InvoiceOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [noBranch, setNoBranch] = useState<{ invoices: number; balance: number } | null>(null);
  const [branchKey, setBranchKey] = useState(receipt.branch_id ? String(receipt.branch_id) : "");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number[]>([]);
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [tdsMap, setTdsMap] = useState<Record<number, TdsChoice | null>>({});
  const [tdsAsk, setTdsAsk] = useState<InvoiceOption | null>(null);
  const [defaultRate, setDefaultRate] = useState(10);
  const [sections, setSections] = useState<TdsSection[]>(DEFAULT_SECTIONS);
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    crmGet<InvoiceOption[]>(`/api/customer-receipts/invoice-options?customer_id=${receipt.customer_id}`)
      .then((res) => {
        if (!alive) return;
        setOptions(res.data || []);
        const m = (res.meta || {}) as { branches?: BranchOption[]; no_branch?: { invoices: number; balance: number };
          default_tds_rate?: number; tds_sections?: TdsSection[] };
        setBranches(m.branches || []);
        setNoBranch(m.no_branch || null);
        if (m.default_tds_rate) setDefaultRate(Number(m.default_tds_rate));
        if (m.tds_sections?.length) setSections(m.tds_sections);
        if (!receipt.branch_id) {
          const bs = m.branches || [];
          if (bs.length === 1 && !m.no_branch) setBranchKey(String(bs[0].id));
        }
      })
      .catch((e: any) => { if (alive) setError(e?.message || "Could not load the open invoices"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [receipt.customer_id, receipt.branch_id]);

  const lockedBranch = !!receipt.branch_id;
  const needsBranch = branches.length > 0 || !!noBranch;
  /* A branch's invoices + invoices with no branch on record (24 Oct 2026 — the
     server takes them on any branch's receipt). Likely matches first: an invoice
     whose balance is this payment (the advice that came without a number). */
  const branchOptions = useMemo(() => orderByLikelyMatch(options.filter((o) => !needsBranch ? true
    : !branchKey ? false
    : branchKey === "none" ? !o.branch_id : (!o.branch_id || String(o.branch_id) === branchKey)), available),
  [options, needsBranch, branchKey, available]);
  const months = useMemo(() => [...new Map(branchOptions.filter((o) => o.month)
    .map((o) => [o.month as string, o.month_label || o.month])).entries()].sort((a, b) => b[0].localeCompare(a[0])), [branchOptions]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return branchOptions.filter((o) => selected.includes(o.id) || (
      (!month || o.month === month)
      && (!q || [o.invoice_number, o.employee_name, o.project_name, o.month_label].filter(Boolean).join(" ").toLowerCase().includes(q))));
  }, [branchOptions, query, month, selected]);

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const dueOf = (o: InvoiceOption) => netDue(o.balance_amount, tdsMap[o.id]?.amount ?? 0);
  const ordered = useMemo(() => [...selected].sort((a, b) => {
    const A = byId.get(a); const B = byId.get(b);
    return (A?.invoice_date || "").localeCompare(B?.invoice_date || "") || a - b;
  }), [selected, byId]);
  const due = useMemo(() => Object.fromEntries(ordered.map((id) => [id, byId.get(id) ? dueOf(byId.get(id)!) : 0])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ordered, byId, tdsMap]);
  const plan = useMemo(() => mapPlan(available, ordered, due, typed), [available, ordered, due, typed]);
  const mapping = ordered.reduce((t, id) => t + (plan.take[id] || 0), 0);
  const tdsTotal = ordered.reduce((t, id) => t + (tdsMap[id]?.amount ?? 0), 0);

  const toggle = (o: InvoiceOption) => {
    if (o.payment_block) return;
    if (selected.includes(o.id)) {
      setSelected((s) => s.filter((x) => x !== o.id));
      setTyped((t) => { const n = { ...t }; delete n[o.id]; return n; });
      setTdsMap((m) => { const n = { ...m }; delete n[o.id]; return n; });
      return;
    }
    if (o.tds) { setSelected((s) => [...s, o.id]); return; }
    setTdsAsk(o);
  };

  const missing = needsBranch && !branchKey ? "Pick the branch that paid"
    : !selected.length ? "Tick the invoices this payment covers"
    : plan.over ? plan.over
    : !(mapping > 0) && !(tdsTotal > 0) ? "Nothing to map — the ticked invoices are already paid" : "";

  const submit = async () => {
    if (missing) { setError(missing); return; }
    setBusy(true);
    setError("");
    try {
      const res = await crmPost<Receipt>(`/api/customer-receipts/${receipt.id}/allocate`, {
        branch_id: !lockedBranch && branchKey && branchKey !== "none" ? Number(branchKey) : null,
        items: ordered.map((id) => ({ invoice_id: id, amount: plan.take[id] > 0 ? plan.take[id] : null })),
        tds: ordered.filter((id) => tdsMap[id]).map((id) => ({
          invoice_id: id, tds_rate: tdsMap[id]!.rate, tds_base: tdsMap[id]!.base, section: tdsMap[id]!.section || null,
        })),
      });
      onSaved(res.message || "Invoices mapped", res.data as Receipt);
    } catch (e: any) {
      setError(e?.message || "Could not map the invoices");
      setBusy(false);
    }
  };

  const branchName = receipt.branch_name || branches.find((b) => String(b.id) === branchKey)?.name;
  return (
    <Modal title="Map invoices" xl onClose={onClose} dirty={selected.length > 0}
      hero={<DialogHero tone="emerald" icon={Link2} eyebrow={`Receipt #${receipt.id} · ${receipt.customer_name || "Customer"}`}
        title={<>Map {inr(available)} to invoices</>}
        subtitle={`Received ${fmtDate(receipt.received_date)}${receipt.reference_number ? ` · ${receipt.reference_number}` : ""} — tick the invoices this payment covers.`}
        flow={{ steps: ["On account", "Invoices settled", "Receivables updated"], current: selected.length ? 1 : 0 }} />}
      footer={<DialogActions tone="emerald" icon={Link2} busy={busy} disabled={!!missing}
        label={mapping > 0 ? `Map ${inr(mapping)} to ${selected.length} invoice${selected.length === 1 ? "" : "s"}` : "Map invoices"}
        onCancel={onClose} onConfirm={() => void submit()}
        hint={missing ? <span className="text-warning">{missing}</span> : "Ctrl + Enter to save"} />}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="space-y-4">
          {!lockedBranch && needsBranch && (
            <DialogSection n={1} title="Branch that paid" tone="emerald" done={!!branchKey}
              hint="This receipt has no branch yet. Pick it — only that branch's invoices are offered, and the receipt takes the branch.">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Branch that paid">
                {branches.map((b) => (
                  <button key={b.id} type="button" role="radio" aria-checked={branchKey === String(b.id)}
                    onClick={() => { setBranchKey(String(b.id)); setSelected([]); setTyped({}); setTdsMap({}); setMonth(""); }}
                    className={`rounded-card border px-3 py-2 text-left text-sm transition-colors ${branchKey === String(b.id)
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "border-subtle bg-surface-1 hover:border-emerald-300"}`}>
                    <span className="flex items-center gap-1 font-semibold text-primary"><MapPin size={13} aria-hidden /> {b.name}</span>
                    <span className="block text-[11px] text-muted">{b.invoices} open · {inr(b.balance)}</span>
                  </button>
                ))}
                {noBranch && (
                  <button type="button" role="radio" aria-checked={branchKey === "none"}
                    onClick={() => { setBranchKey("none"); setSelected([]); setTyped({}); setTdsMap({}); setMonth(""); }}
                    className={`rounded-card border px-3 py-2 text-left text-sm transition-colors ${branchKey === "none"
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "border-subtle bg-surface-1 hover:border-emerald-300"}`}>
                    <span className="font-semibold text-primary">No branch on record</span>
                    <span className="block text-[11px] text-muted">{noBranch.invoices} open · {inr(noBranch.balance)}</span>
                  </button>
                )}
              </div>
            </DialogSection>
          )}

          <DialogSection n={!lockedBranch && needsBranch ? 2 : 1} title={`Open invoices${branchName ? ` — ${branchName}` : ""}`} tone="emerald"
            done={selected.length > 0}
            hint="Oldest invoice first, up to each balance. Type an amount to put a different sum on an invoice. Ticking asks whether the customer deducted TDS."
            action={branchOptions.length > 0 ? (
              <div className="flex gap-3 text-xs font-semibold">
                {Object.keys(typed).length > 0 && (
                  <button type="button" className="inline-flex items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-300"
                    onClick={() => setTyped({})}><Wand2 size={12} aria-hidden /> Fill oldest first</button>
                )}
                {selected.length > 0 && (
                  <button type="button" className="text-muted hover:underline" onClick={() => { setSelected([]); setTyped({}); setTdsMap({}); }}>Clear</button>
                )}
              </div>
            ) : undefined}>
            {loading ? <p className="text-xs text-muted">Loading invoices…</p>
              : needsBranch && !branchKey ? <p className="text-xs text-muted">Pick the branch that paid to see its invoices.</p>
              : branchOptions.length === 0 ? <p className="text-xs text-muted">No open invoices for this {lockedBranch ? "branch" : "customer"} — nothing to map yet.</p>
              : (
                <>
                  <div className="mb-2 flex flex-wrap gap-2">
                    <input className={`${inputCls} !w-auto min-w-[14rem] flex-1 text-sm`} value={query}
                      placeholder="Search invoice no., employee, project or month…" aria-label="Search invoices"
                      onChange={(e) => setQuery(e.target.value)} />
                    {months.length > 1 && (
                      <select className={`${inputCls} !w-40 text-sm`} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Invoice month">
                        <option value="">All months</option>
                        {months.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    )}
                  </div>
                  <ul className="max-h-[26rem] space-y-1.5 overflow-y-auto pr-1">
                    {visible.length === 0 && <li className="px-1 py-2 text-xs text-muted">No invoice matches.</li>}
                    {visible.map((o) => {
                      const on = selected.includes(o.id);
                      const locked = !!o.payment_block;
                      const late = daysLate(o.due_date);
                      return (
                        <li key={o.id} className={`rounded-control border transition-colors ${locked ? "border-subtle bg-surface-2 opacity-70"
                          : on ? "border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30" : "border-subtle bg-surface-1 hover:border-emerald-300"}`}>
                          <div className="flex items-center gap-3 px-3 py-2">
                            <button type="button" onClick={() => toggle(o)} disabled={locked} aria-pressed={on}
                              aria-label={`${on ? "Untick" : "Tick"} ${o.invoice_number}`}
                              title={locked ? o.payment_block || "" : undefined}
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-subtle bg-surface-1"}`}>
                              {locked ? <Lock size={11} className="text-muted" aria-hidden /> : on ? <Check size={13} aria-hidden /> : null}
                            </button>
                            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => toggle(o)} disabled={locked}>
                              <span className="block truncate text-sm font-semibold text-primary">
                                {o.invoice_number} <span className="text-xs font-normal text-muted">· {fmtDate(o.invoice_date)}</span>
                                {o.month_label && <span className="ml-1.5 rounded-full bg-teal-50 px-1.5 py-px text-[11px] font-semibold text-teal-800 dark:bg-teal-950/40 dark:text-teal-200">{o.month_label}</span>}
                              </span>
                              <span className="block truncate text-xs text-secondary">{[o.employee_name, o.project_name].filter(Boolean).join(" · ") || "—"}</span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                                <span>Invoice {inr(o.grand_total)}</span>
                                {o.paid_amount > 0 && <span>· paid {inr(o.paid_amount)}</span>}
                                {isPartlyPaid(o) && (
                                  <span className="rounded-full bg-orange-50 px-1.5 font-semibold text-orange-800 dark:bg-orange-950/40 dark:text-orange-200">
                                    Partly paid · {inr(o.balance_amount)} still due</span>
                                )}
                                {isLikelyMatch(o, available) && (
                                  <span className="rounded-full bg-emerald-100 px-1.5 font-semibold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200"
                                    title="This invoice's balance equals the amount on this payment">Likely match</span>
                                )}
                                {!o.branch_id && <span>· no branch on record</span>}
                                {o.due_date && (late > 0
                                  ? <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 font-semibold ${late > 60 ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"}`}>
                                      <Clock size={10} aria-hidden /> {late} d late</span>
                                  : <span>· due {fmtDate(o.due_date)}</span>)}
                              </span>
                              {locked && <span className="block text-[11px] text-warning">{o.payment_block}</span>}
                            </button>
                            <span className="shrink-0 text-right">
                              <span className="block text-xs text-muted tabular-nums">Balance {inr(o.balance_amount)}</span>
                              {on ? (
                                <label className="mt-0.5 flex items-center gap-1">
                                  <span className="text-xs text-muted">₹</span>
                                  <input type="number" min={0} step="0.01" aria-label={`Amount on ${o.invoice_number}`}
                                    className={`${inputCls} !h-8 !w-32 text-right text-sm font-bold tabular-nums`}
                                    value={typed[o.id] ?? String(plan.take[o.id] ?? 0)}
                                    onChange={(e) => setTyped((t) => ({ ...t, [o.id]: e.target.value }))} />
                                </label>
                              ) : null}
                            </span>
                          </div>
                          {on && (
                            <div className="flex flex-wrap items-center gap-2 border-t border-emerald-200 px-3 py-1.5 pl-11 text-[11px] dark:border-emerald-900">
                              {o.tds ? <TdsChip tds={o.tds} compact />
                                : tdsMap[o.id] ? (
                                  <>
                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 ring-1 ring-inset ring-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800">
                                      <Percent size={11} aria-hidden /> TDS {tdsMap[o.id]!.rate}% · {inr(tdsMap[o.id]!.amount)}
                                    </span>
                                    <button type="button" className="font-semibold text-sky-600 hover:underline" onClick={() => setTdsAsk(o)}>Change</button>
                                  </>
                                ) : (
                                  <button type="button" className="inline-flex items-center gap-1 font-semibold text-amber-700 hover:underline dark:text-amber-300" onClick={() => setTdsAsk(o)}>
                                    <Percent size={11} aria-hidden /> TDS deducted? Add it
                                  </button>
                                )}
                              <span className="ml-auto text-muted">Still due after this: <b className="tabular-nums text-primary">{inr(Math.max(0, dueOf(o) - (plan.take[o.id] || 0)))}</b></span>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
          </DialogSection>
          {error && <DialogFailure message={error} />}
        </div>

        <aside className="h-max space-y-3 rounded-card border border-subtle bg-surface-1 p-4 shadow-raised lg:sticky lg:top-0">
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted">This mapping</div>
          <div>
            <div className="text-xs text-muted">On account now</div>
            <div className="text-2xl font-extrabold tabular-nums text-primary">{inr(available)}</div>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500"
              style={{ width: `${available > 0 ? Math.min(100, Math.round((mapping / available) * 100)) : 0}%` }} />
          </div>
          <dl className="space-y-1 text-sm [&>div]:gap-3">
            <div className="flex justify-between"><dt className="text-muted">Goes on {selected.length} invoice(s)</dt><dd className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{inr(mapping)}</dd></div>
            {tdsTotal > 0 && (
              <div className="flex justify-between"><dt className="text-muted">TDS withheld (pending from client)</dt><dd className="font-semibold tabular-nums text-amber-700 dark:text-amber-300">{inr(tdsTotal)}</dd></div>
            )}
            <div className="flex justify-between"><dt className="text-muted">Left on account</dt><dd className={`font-semibold tabular-nums ${plan.left < 0 ? "text-danger" : "text-primary"}`}>{inr(plan.left)}</dd></div>
          </dl>
          <p className="text-[11px] text-muted">Unmapping an invoice later puts its money back on account. Nothing here changes the amount received.</p>
        </aside>
      </div>
      {tdsAsk && (
        <TdsDeductionModal invoice={tdsAsk} initial={tdsMap[tdsAsk.id]} defaultRate={defaultRate} sections={sections}
          customerName={receipt.customer_name}
          onClose={() => setTdsAsk(null)}
          onSave={(choice) => {
            const o = tdsAsk;
            setTdsMap((m) => ({ ...m, [o.id]: choice }));
            setSelected((s) => (s.includes(o.id) ? s : [...s, o.id]));
            setTdsAsk(null);
          }} />
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Edit details
// ---------------------------------------------------------------------------

export function EditReceiptModal({ receipt, onClose, onSaved }: {
  receipt: Receipt;
  onClose: () => void;
  onSaved: (msg: string, updated?: Receipt) => void;
}) {
  const applied = Number(receipt.allocated_amount || 0);
  const [amount, setAmount] = useState(String(receipt.amount));
  const [date, setDate] = useState(receipt.received_date.slice(0, 10));
  const [mode, setMode] = useState(receipt.payment_mode || "");
  const [reference, setReference] = useState(receipt.reference_number || "");
  const [notes, setNotes] = useState(receipt.notes || "");
  const [branchKey, setBranchKey] = useState(receipt.branch_id ? String(receipt.branch_id) : "");
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    crmGet<InvoiceOption[]>(`/api/customer-receipts/invoice-options?customer_id=${receipt.customer_id}`)
      .then((r) => setBranches(((r.meta || {}) as { branches?: BranchOption[] }).branches || []))
      .catch(() => setBranches([]));
  }, [receipt.customer_id]);

  const amt = Number(amount) || 0;
  const onAccount = round2(amt - applied);
  const changed = amt !== Number(receipt.amount) || date !== receipt.received_date.slice(0, 10)
    || (mode || "") !== (receipt.payment_mode || "") || reference.trim() !== (receipt.reference_number || "")
    || notes.trim() !== (receipt.notes || "") || branchKey !== (receipt.branch_id ? String(receipt.branch_id) : "");
  const missing = !(amt > 0) ? "Enter the amount received"
    : amt + 0.004 < applied ? `At least ${inr(applied)} — that much is already on invoices (unmap one first)`
    : !date ? "Pick the received date" : !changed ? "Nothing changed yet" : "";

  const submit = async () => {
    if (missing) { setError(missing); return; }
    setBusy(true);
    setError("");
    try {
      const res = await crmPut<Receipt>(`/api/customer-receipts/${receipt.id}`, {
        amount: amt, received_date: date, payment_mode: mode || null,
        reference_number: reference.trim() || null, notes: notes.trim() || null,
        branch_id: branchKey ? Number(branchKey) : null,
      });
      onSaved(res.message || "Receipt updated", res.data as Receipt);
    } catch (e: any) {
      setError(e?.message || "Could not save the receipt");
      setBusy(false);
    }
  };

  return (
    <Modal title="Edit received amount" medium onClose={onClose} dirty={changed}
      hero={<DialogHero tone="sky" icon={Pencil} eyebrow={`Receipt #${receipt.id} · ${receipt.customer_name || "Customer"}`}
        title="Edit the payment details" subtitle="Invoices already mapped keep their amounts; their payment date, mode and reference follow." />}
      footer={<DialogActions tone="sky" icon={Check} label="Save changes" busy={busy} disabled={!!missing}
        onCancel={onClose} onConfirm={() => void submit()}
        hint={missing ? <span className={changed ? "text-warning" : undefined}>{missing}</span> : "Ctrl + Enter to save"} />}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-secondary">Amount received (₹) *</span>
            <input type="number" min={0} step="0.01" className={`${inputCls} text-lg font-bold tabular-nums`} value={amount}
              onChange={(e) => setAmount(e.target.value)} />
            <span className="mt-1 block text-[11px] text-muted">
              {applied > 0 ? <>{inr(applied)} on invoices · </> : null}
              <span className={onAccount < 0 ? "font-semibold text-danger" : ""}>{inr(Math.max(0, onAccount))} on account after saving</span>
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-secondary">Received on *</span>
            <input type="date" className={inputCls} value={date} max={isoDay(0)} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-secondary">Payment mode</span>
            <div className="flex flex-wrap gap-1.5">
              {PAYMENT_MODES.map((m) => (
                <button key={m} type="button" className={pillCls(mode === m)} onClick={() => setMode(mode === m ? "" : m)}>{m}</button>
              ))}
            </div>
          </div>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-secondary">Reference number</span>
            <input className={`${inputCls} font-mono`} value={reference} placeholder="UTR / cheque no. / transaction id"
              onChange={(e) => setReference(e.target.value)} />
          </label>
          {branches.length > 0 && (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-secondary">Branch that paid</span>
              <select className={inputCls} value={branchKey} onChange={(e) => setBranchKey(e.target.value)}>
                <option value="">No branch on record</option>
                {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
              </select>
              {receipt.allocations.length > 0 && (
                <span className="mt-1 block text-[11px] text-muted">Mapped invoices must belong to the branch you pick.</span>
              )}
            </label>
          )}
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-secondary">Notes</span>
            <textarea className={`${inputCls} !h-auto min-h-[64px]`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        {error && <DialogFailure message={error} />}
      </div>
    </Modal>
  );
}
