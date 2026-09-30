/**
 * The purchase-order picker inside "Raise Proforma" (30 Sep 2026).
 *
 * It replaced a <select> of the customer's WHOLE PO book. The GM now sees
 * this employee's POs by default — the ones tagged to them, or billed for one
 * of their timesheets before (server `employee_match`) — with the project's
 * funding POs and the whole book one click away, a search box, a liveness
 * filter and a sort. Every PO is still selectable except a cancelled one; the
 * server's `suggested_po_id` is pre-selected and flagged.
 *
 * Pure presentation over `GET /api/timesheets/{id}/po-options` — nothing is
 * decided here. `filterPos` / `poScopes` are exported for the tests.
 */
import { useMemo, useState } from "react";
import { BadgeCheck, CalendarRange, Check, Search, UserRound, Wallet } from "lucide-react";

import { CrmLink } from "../routerHooks";
import { CONTROL } from "./controlTower";
import { StatusBadge } from "./ui";

export type PoOption = {
  id: number;
  po_number: string;
  po_type?: string | null;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  total_value?: number | null;
  used_value?: number | null;
  balance_value?: number | null;
  expired?: boolean;
  selectable?: boolean;
  project_allocated?: number | null;
  project_used?: number | null;
  employee_id?: number | null;
  employee_name?: string | null;
  /** Tagged to this timesheet's employee OR billed for them before (server). */
  employee_match?: boolean;
  tagged_to_employee?: boolean;
  billed_before?: number;
};

export type PoScope = "employee" | "project" | "all";
export type PoLiveness = "live" | "expired" | "all";
export type PoSort = "best" | "newest" | "balance" | "ending";

export const SCOPE_LABEL: Record<PoScope, string> = {
  employee: "This employee", project: "Funding this project", all: "All customer POs",
};

/** The three scopes with their counts; the default is the first non-empty one. */
export function poScopes(pos: PoOption[]) {
  const employee = pos.filter((p) => p.employee_match).length;
  const project = pos.filter((p) => p.project_allocated != null).length;
  return { employee, project, all: pos.length, initial: (employee ? "employee" : project ? "project" : "all") as PoScope };
}

const inr = (v?: number | null) =>
  v == null ? "—" : `₹${Math.round(v).toLocaleString("en-IN")}`;

const dShort = (iso?: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function isLive(p: PoOption) {
  return p.selectable !== false && !p.expired && p.status === "Active"
    && (p.balance_value == null || p.balance_value > 0);
}

/** Scope → liveness → search → sort. PURE. */
export function filterPos(pos: PoOption[], f: {
  scope: PoScope; liveness: PoLiveness; search: string; sort: PoSort; suggestedId?: number | null;
}): PoOption[] {
  const q = f.search.trim().toLowerCase();
  let out = pos.filter((p) =>
    f.scope === "all" ? true : f.scope === "employee" ? !!p.employee_match : p.project_allocated != null);
  if (f.liveness === "live") out = out.filter((p) => !p.expired && p.selectable !== false);
  else if (f.liveness === "expired") out = out.filter((p) => !!p.expired);
  if (q) out = out.filter((p) => `${p.po_number} ${p.employee_name || ""} ${p.po_type || ""}`.toLowerCase().includes(q));
  const byNewest = (a: PoOption, b: PoOption) => String(b.start_date || "").localeCompare(String(a.start_date || ""));
  const sorters: Record<PoSort, (a: PoOption, b: PoOption) => number> = {
    best: (a, b) =>
      Number(b.id === f.suggestedId) - Number(a.id === f.suggestedId)
      || Number(!!b.tagged_to_employee) - Number(!!a.tagged_to_employee)
      || (b.billed_before || 0) - (a.billed_before || 0)
      || Number(isLive(b)) - Number(isLive(a))
      || byNewest(a, b),
    newest: byNewest,
    balance: (a, b) => (b.balance_value ?? Number.POSITIVE_INFINITY) - (a.balance_value ?? Number.POSITIVE_INFINITY),
    ending: (a, b) => String(a.end_date || "9999").localeCompare(String(b.end_date || "9999")),
  };
  return [...out].sort(sorters[f.sort]);
}

function pct(used?: number | null, total?: number | null) {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((used || 0) / total) * 100)));
}

const CHIP = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide";

export function PoPicker({ pos, value, onChange, employeeName, suggestedId, monthLabel }: {
  pos: PoOption[];
  value: number | null;
  onChange: (id: number) => void;
  employeeName?: string | null;
  suggestedId?: number | null;
  /** "August 2026" — printed in the empty state. */
  monthLabel?: string;
}) {
  const scopes = poScopes(pos);
  const [scope, setScope] = useState<PoScope>(scopes.initial);
  const [liveness, setLiveness] = useState<PoLiveness>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<PoSort>("best");
  const shown = useMemo(
    () => filterPos(pos, { scope, liveness, search, sort, suggestedId }),
    [pos, scope, liveness, search, sort, suggestedId]);
  const who = employeeName || "this employee";
  const hidden = pos.length - shown.length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Which purchase orders">
        {(["employee", "project", "all"] as PoScope[]).map((k) => {
          const n = scopes[k];
          const on = scope === k;
          return (
            <button key={k} type="button" role="tab" aria-selected={on} onClick={() => setScope(k)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition-colors duration-micro ${
                on ? "bg-brand-600 text-white ring-brand-600" : "bg-surface-1 text-secondary ring-subtle hover:text-primary"}`}>
              {k === "employee" ? <UserRound size={12} /> : k === "project" ? <Wallet size={12} /> : null}
              {k === "employee" ? `${who.split(" ")[0]}'s POs` : SCOPE_LABEL[k]}
              <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${on ? "bg-white/25" : "bg-surface-2 font-bold"}`}>{n}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[12rem] flex-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input type="text" className={`${CONTROL} w-full !pl-8`} placeholder="PO number, person…"
            value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search purchase orders" />
        </label>
        <select className={CONTROL} value={liveness} onChange={(e) => setLiveness(e.target.value as PoLiveness)}
          aria-label="Which POs">
          <option value="live">Live only</option>
          <option value="expired">Expired only</option>
          <option value="all">Live + expired</option>
        </select>
        <select className={CONTROL} value={sort} onChange={(e) => setSort(e.target.value as PoSort)} aria-label="Sort">
          <option value="best">Best match first</option>
          <option value="newest">Newest first</option>
          <option value="balance">Largest balance</option>
          <option value="ending">Ending soonest</option>
        </select>
      </div>

      {scope === "employee" && scopes.employee === 0 && (
        <div className="rounded-card border border-warning bg-warning-soft px-3 py-2 text-xs text-warning">
          No PO is raised for <b>{who}</b> yet — none is tagged to them and none has billed one of their
          timesheets. Pick from the project's or the customer's POs, or tag one on the{" "}
          <CrmLink to="pos" className="font-semibold underline">Purchase Orders</CrmLink> page.
        </div>
      )}

      <div className="max-h-[22rem] space-y-1.5 overflow-y-auto pr-0.5" role="radiogroup" aria-label="Purchase order">
        {shown.length === 0 ? (
          <div className="rounded-card border border-dashed border-subtle px-4 py-6 text-center text-sm text-muted">
            {pos.length === 0 ? "This customer has no purchase orders." : "No PO matches — widen the scope or the filter."}
          </div>
        ) : shown.map((p) => {
          const on = value === p.id;
          const used = pct(p.used_value, p.total_value);
          const disabled = p.selectable === false;
          const suggested = suggestedId != null && p.id === suggestedId;
          return (
            <button key={p.id} type="button" role="radio" aria-checked={on} disabled={disabled}
              onClick={() => onChange(p.id)}
              className={`w-full rounded-card border px-3 py-2.5 text-left transition-colors duration-micro ${
                on ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500 dark:bg-brand-900/30"
                  : disabled ? "cursor-not-allowed border-subtle opacity-50"
                  : "border-subtle bg-surface-0 hover:border-strong hover:bg-surface-1"}`}>
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                  on ? "border-brand-600 bg-brand-600 text-white" : "border-strong"}`} aria-hidden>
                  {on && <Check size={12} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold text-primary">{p.po_number}</span>
                    {p.po_type && <span className="text-xs text-muted">· {p.po_type}</span>}
                    {suggested && <span className={`${CHIP} bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300`}><BadgeCheck size={11} /> Suggested</span>}
                    {p.tagged_to_employee && <span className={`${CHIP} bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300`}>Raised for {who.split(" ")[0]}</span>}
                    {!p.tagged_to_employee && (p.billed_before || 0) > 0 && (
                      <span className={`${CHIP} bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300`}>
                        Billed {p.billed_before} time{p.billed_before === 1 ? "" : "s"} for {who.split(" ")[0]}
                      </span>
                    )}
                    {p.project_allocated != null && <span className={`${CHIP} bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300`}>Funds this project</span>}
                    {p.employee_name && !p.employee_match && (
                      <span className={`${CHIP} bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300`}>Raised for {p.employee_name}</span>
                    )}
                    {p.expired && <span className={`${CHIP} bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300`}>Expired</span>}
                    {disabled && <StatusBadge status={p.status} />}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-secondary">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Wallet size={12} aria-hidden /> <b className="text-success">{inr(p.balance_value)}</b> left of {inr(p.total_value)}
                    </span>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <CalendarRange size={12} aria-hidden /> {dShort(p.start_date)} → {p.end_date ? dShort(p.end_date) : "open"}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2" title={`${used}% used`}>
                    <div className={`h-full rounded-full ${used >= 90 ? "bg-rose-500" : used >= 70 ? "bg-amber-500" : "bg-emerald-500"}`}
                      style={{ width: `${used}%` }} />
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {hidden > 0 && (
        <p className="text-[11px] text-muted">
          {hidden} PO{hidden === 1 ? "" : "s"} hidden by the scope / filter{monthLabel ? ` · raising for ${monthLabel}` : ""}.
        </p>
      )}
    </div>
  );
}
