/**
 * Billing Tracker filters (24 Oct 2026, Finance ask) — PURE helpers shared by
 * the panel and its test. The server does the filtering
 * (`services/billing_tracker.apply_filters`); this file only shapes the query
 * and names what is switched on.
 */
export type TrackerFlag = "overdue" | "tds_pending" | "split" | "no_branch";

export type TrackerFilters = {
  stage: string; customer: string; month: string; search: string;
  branch: string;        // "" all · "0" no branch on record · id
  project: string;
  employee: string;
  po: string;            // "" all · "0" no PO · id
  owner: string;         // the Sales person who raised the deal
  late: string;          // "" · late · not_due · late_1_30 · late_31_60 · late_61_90 · late_90_plus
  dateField: "invoice" | "due";
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  waitingMin: string;
  flags: TrackerFlag[];
};

export const EMPTY_FILTERS: TrackerFilters = {
  stage: "open", customer: "", month: "", search: "",
  branch: "", project: "", employee: "", po: "", owner: "", late: "",
  dateField: "invoice", dateFrom: "", dateTo: "", amountMin: "", waitingMin: "", flags: [],
};

export const FLAG_LABELS: Record<TrackerFlag, string> = {
  overdue: "Overdue only",
  tds_pending: "TDS pending from client",
  split: "Split across POs",
  no_branch: "No branch on record",
};

export const LATE_LABELS: Record<string, string> = {
  late: "Any days late",
  not_due: "Not yet due",
  late_1_30: "1–30 days late",
  late_31_60: "31–60 days late",
  late_61_90: "61–90 days late",
  late_90_plus: "Over 90 days late",
};

/** A session-stored filter set from before 24 Oct lacks the new keys. PURE. */
export function withDefaults(stored: Partial<TrackerFilters> | null | undefined): TrackerFilters {
  const f = { ...EMPTY_FILTERS, ...(stored || {}) };
  if (!Array.isArray(f.flags)) f.flags = [];
  if (f.dateField !== "due") f.dateField = "invoice";
  return f;
}

/** The query string fields for `GET /api/dashboard/billing`. PURE. */
export function trackerQuery(f: TrackerFilters, page: number, limit: number): Record<string, string | number | undefined> {
  const n = (v: string) => (v.trim() === "" ? undefined : v.trim());
  return {
    stage: f.stage === "all" ? "" : f.stage,
    customer_id: n(f.customer), month: n(f.month), search: n(f.search),
    branch_id: n(f.branch), project_id: n(f.project), employee_id: n(f.employee),
    po_id: n(f.po), owner_id: n(f.owner), late: n(f.late),
    date_field: f.dateFrom || f.dateTo ? f.dateField : undefined,
    date_from: n(f.dateFrom), date_to: n(f.dateTo),
    amount_min: n(f.amountMin), waiting_min: n(f.waitingMin),
    flags: f.flags.length ? f.flags.join(",") : undefined,
    page, limit,
  };
}

/** How many of the "More filters" are on (the toggle's badge). PURE. */
export function moreFilterCount(f: TrackerFilters): number {
  return [f.branch, f.project, f.employee, f.po, f.owner, f.late, f.dateFrom || f.dateTo, f.amountMin, f.waitingMin]
    .filter((v) => !!v).length + f.flags.length;
}

type Named = { id: number; name: string };

/** One removable chip per filter that is on, in words. PURE. */
export function activeChips(f: TrackerFilters, opts: {
  customers?: Named[]; branches?: Named[]; projects?: Named[]; employees?: Named[]; pos?: Named[]; owners?: Named[];
  months?: { key: string; label: string }[];
}): { key: string; label: string; clear: Partial<TrackerFilters> }[] {
  const nameOf = (list: Named[] | undefined, id: string) => list?.find((x) => String(x.id) === id)?.name || `#${id}`;
  const out: { key: string; label: string; clear: Partial<TrackerFilters> }[] = [];
  if (f.customer) out.push({ key: "customer", label: nameOf(opts.customers, f.customer), clear: { customer: "", branch: "", project: "" } });
  if (f.month) out.push({ key: "month", label: opts.months?.find((m) => m.key === f.month)?.label || f.month, clear: { month: "" } });
  if (f.branch) out.push({ key: "branch", label: f.branch === "0" ? "No branch" : `Branch: ${nameOf(opts.branches, f.branch)}`, clear: { branch: "" } });
  if (f.project) out.push({ key: "project", label: `Project: ${nameOf(opts.projects, f.project)}`, clear: { project: "" } });
  if (f.employee) out.push({ key: "employee", label: nameOf(opts.employees, f.employee), clear: { employee: "" } });
  if (f.po) out.push({ key: "po", label: f.po === "0" ? "No PO" : `PO ${nameOf(opts.pos, f.po)}`, clear: { po: "" } });
  if (f.owner) out.push({ key: "owner", label: `Sales: ${nameOf(opts.owners, f.owner)}`, clear: { owner: "" } });
  if (f.late) out.push({ key: "late", label: LATE_LABELS[f.late] || f.late, clear: { late: "" } });
  if (f.dateFrom || f.dateTo) {
    const what = f.dateField === "due" ? "Due" : "Invoiced";
    out.push({ key: "dates", label: `${what} ${f.dateFrom || "…"} → ${f.dateTo || "…"}`, clear: { dateFrom: "", dateTo: "" } });
  }
  if (f.amountMin) out.push({ key: "amount", label: `₹${Number(f.amountMin).toLocaleString("en-IN")}+`, clear: { amountMin: "" } });
  if (f.waitingMin) out.push({ key: "waiting", label: `Waiting ${f.waitingMin}+ days`, clear: { waitingMin: "" } });
  for (const flag of f.flags) {
    out.push({ key: `flag:${flag}`, label: FLAG_LABELS[flag], clear: { flags: f.flags.filter((x) => x !== flag) } });
  }
  return out;
}
