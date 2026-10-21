/** Customer ▸ Activity Log (21 Oct 2026, user ask: "an Activity Log tab that
 * contains all things from the start"). Reads `GET /api/customers/{id}/activity`
 * — the customer's own changes (branches, addresses, contacts, documents,
 * policies, with old → new values) merged with its opportunities, positions,
 * candidates, POs, timesheets, invoices and payments. Server half:
 * B-V2 services/customer_activity.py. */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2, Briefcase, CalendarDays, ClipboardList, FileText, IndianRupee, ReceiptText,
  RefreshCw, Search, ShoppingCart, UserRound, Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { crmGet, qs } from "../api";
import { CrmLink } from "../router";
import { fmtDateTime12 } from "../../lib/datetime";
import { CONTROL } from "./controlTower";

export type ActivityItem = {
  id: string;
  kind: string;
  kind_label: string;
  action_type: string;
  comment: string | null;
  changes: Record<string, [unknown, unknown]> | null;
  timestamp: string | null;
  user_name: string | null;
  entity_label: string | null;
  subject: string | null;
  path: string | null;
};

type Meta = { page: number; pages: number; total: number; counts: Record<string, number>; all: number;
  kinds: { key: string; label: string }[] };

const KIND_LOOK: Record<string, { icon: LucideIcon; tone: string }> = {
  account: { icon: Building2, tone: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300" },
  opportunity: { icon: Briefcase, tone: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300" },
  requirement: { icon: ClipboardList, tone: "bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300" },
  candidate: { icon: UserRound, tone: "bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300" },
  po: { icon: ShoppingCart, tone: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300" },
  timesheet: { icon: CalendarDays, tone: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300" },
  invoice: { icon: ReceiptText, tone: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300" },
  payment: { icon: IndianRupee, tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
};

/** "BRANCH_ADDRESS_CHANGED" → "Branch address changed". */
export function actionWords(action: string): string {
  const s = (action || "").toLowerCase().replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "Activity";
}

/** Field key → words ("billing_address" → "Billing address"). */
export function fieldWords(key: string): string {
  const MAP: Record<string, string> = {
    billing_address: "Address line 1", address_line_1: "Address line 1", address_line_2: "Address line 2",
    delivery_address: "Delivery address", gstin: "GSTIN", pan: "PAN", pincode: "PIN code",
    branch_legal_name: "Legal name", legal_entity_name: "Legal entity", is_primary: "Primary branch",
  };
  if (MAP[key]) return MAP[key];
  const s = key.replace(/_/g, " ");
  return s ? s[0].toUpperCase() + s.slice(1) : key;
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Group items by calendar day, newest first (input is already newest first). */
export function groupByDay(items: ActivityItem[]): { day: string; items: ActivityItem[] }[] {
  const out: { day: string; items: ActivityItem[] }[] = [];
  for (const it of items) {
    const d = it.timestamp ? new Date(it.timestamp) : null;
    const day = d && !Number.isNaN(d.getTime())
      ? d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
      : "Undated";
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(it);
    else out.push({ day, items: [it] });
  }
  return out;
}

const PAGE = 40;

export function CustomerActivityLog({ customerId }: { customerId: number }) {
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<ActivityItem[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => { const t = window.setTimeout(() => setQ(search.trim()), 350); return () => window.clearTimeout(t); }, [search]);

  const load = useCallback((p: number) => {
    setLoading(true);
    setErr("");
    crmGet<ActivityItem[]>(`/api/customers/${customerId}/activity${qs({
      kind: kind || undefined, search: q || undefined, date_from: from || undefined,
      date_to: to || undefined, page: p, limit: PAGE,
    })}`)
      .then((r) => {
        const data = (r.data || []) as ActivityItem[];
        setRows((prev) => (p === 1 ? data : [...prev, ...data]));
        setMeta((r.meta || null) as unknown as Meta | null);
        setPage(p);
      })
      .catch((e) => setErr(e?.message || "Could not load the activity log"))
      .finally(() => setLoading(false));
  }, [customerId, kind, q, from, to]);

  useEffect(() => { load(1); }, [load]);

  const days = useMemo(() => groupByDay(rows), [rows]);
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chips = [{ key: "", label: "Everything", n: meta?.all ?? 0 },
    ...(meta?.kinds || []).map((k) => ({ key: k.key, label: k.label, n: meta?.counts?.[k.key] ?? 0 }))];

  return (
    <section className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-base font-bold text-primary">Activity Log</h2>
          <p className="text-xs text-muted">
            Everything that happened with this customer — address and branch changes with the old and new
            values, deals, positions, candidates, POs, timesheets, invoices and payments.
          </p>
        </div>
        <button type="button" onClick={() => load(1)} title="Refresh"
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full border border-subtle bg-surface-2 px-3 text-xs font-semibold text-secondary hover:text-primary">
          <RefreshCw size={13} aria-hidden /> Refresh
        </button>
      </header>

      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="What to show">
        {chips.map((c) => {
          const on = kind === c.key;
          return (
            <button key={c.key || "all"} type="button" role="tab" aria-selected={on} onClick={() => setKind(c.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${on
                ? "border-brand-600 bg-brand-600 text-white" : "border-subtle bg-surface-2 text-secondary hover:text-primary"}`}>
              {c.label}
              <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${on ? "bg-white/25" : "bg-surface-1"}`}>{c.n}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[14rem] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input type="text" className={`${CONTROL} w-full pl-8`} placeholder="Search — address, invoice number, name…"
            value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search the activity log" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">From
          <input type="date" className={CONTROL} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">To
          <input type="date" className={CONTROL} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </label>
        {(kind || q || from || to) && (
          <button type="button" className="text-xs font-semibold text-brand-600 hover:underline"
            onClick={() => { setKind(""); setSearch(""); setFrom(""); setTo(""); }}>Clear</button>
        )}
      </div>

      {err && <p role="alert" className="mb-3 rounded-control bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">{err}</p>}
      {!loading && !err && rows.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-subtle bg-surface-2 px-4 py-8 text-center text-sm text-muted">
          Nothing matches.
          <div className="mt-1 text-xs">Changes to the customer's own records are written down from 21 Oct 2026; deals,
            timesheets, invoices and payments go back to the start.</div>
        </div>
      )}

      <div className="space-y-5">
        {days.map((d) => (
          <div key={d.day}>
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">{d.day}</h3>
            <ol className="relative space-y-2 border-l border-subtle pl-5">
              {d.items.map((r) => {
                const look = KIND_LOOK[r.kind] || KIND_LOOK.account;
                const Icon = look.icon;
                const changes = r.changes ? Object.entries(r.changes) : [];
                const isOpen = open.has(r.id);
                const addressChange = r.action_type === "BRANCH_ADDRESS_CHANGED" || r.action_type === "INVOICE_ADDRESS_CORRECTED";
                return (
                  <li key={r.id} className="relative">
                    <span className={`absolute -left-[31px] top-1 grid h-6 w-6 place-items-center rounded-full ring-4 ring-[color:var(--surface-1)] ${look.tone}`} aria-hidden>
                      <Icon size={12} />
                    </span>
                    <div className={`rounded-lg border px-3 py-2 ${addressChange
                      ? "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20" : "border-subtle bg-surface-1"}`}>
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-sm font-semibold text-primary">{actionWords(r.action_type)}</span>
                        <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${look.tone}`}>{r.kind_label}</span>
                        {r.entity_label && (r.path
                          ? <CrmLink to={r.path} className="text-xs font-semibold text-brand-600 hover:underline">{r.entity_label}</CrmLink>
                          : <span className="text-xs font-semibold text-secondary">{r.entity_label}</span>)}
                        {!r.entity_label && r.path && (
                          <CrmLink to={r.path} className="text-xs font-semibold text-brand-600 hover:underline">Open</CrmLink>)}
                        <span className="ml-auto whitespace-nowrap text-[11px] text-muted">{r.timestamp ? fmtDateTime12(r.timestamp) : ""}</span>
                      </div>
                      {r.comment && <p className="mt-0.5 text-xs text-secondary">{r.comment}</p>}
                      {changes.length > 0 && (
                        <div className="mt-1.5">
                          <button type="button" onClick={() => toggle(r.id)}
                            className="text-[11px] font-semibold text-brand-600 hover:underline" aria-expanded={isOpen}>
                            {isOpen ? "Hide" : "Show"} {changes.length} change{changes.length > 1 ? "s" : ""}
                          </button>
                          {isOpen && (
                            <table className="mt-1 w-full text-xs">
                              <thead>
                                <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                                  <th className="py-1 pr-2 font-bold">Field</th>
                                  <th className="py-1 pr-2 font-bold">Was</th>
                                  <th className="py-1 font-bold">Now</th>
                                </tr>
                              </thead>
                              <tbody>
                                {changes.map(([k, [was, now]]) => (
                                  <tr key={k} className="border-t border-subtle align-top">
                                    <td className="py-1 pr-2 font-semibold text-secondary">{fieldWords(k)}</td>
                                    <td className="py-1 pr-2 text-muted line-through decoration-rose-400/60">{show(was)}</td>
                                    <td className="py-1 text-primary">{show(now)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-muted">
                        {r.user_name ? <><Users size={11} aria-hidden /> {r.user_name}</> : <><FileText size={11} aria-hidden /> From the record</>}
                        {r.subject && r.kind === "account" && <span>· {r.subject}</span>}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
      {loading && <p className="mt-3 text-center text-xs text-muted">Loading…</p>}
      {meta && page < meta.pages && !loading && (
        <div className="mt-4 text-center">
          <button type="button" onClick={() => load(page + 1)}
            className="rounded-full border border-subtle bg-surface-2 px-4 py-1.5 text-xs font-semibold text-secondary hover:text-primary">
            Load more ({meta.total - rows.length} older)
          </button>
        </div>
      )}
    </section>
  );
}

export default CustomerActivityLog;
