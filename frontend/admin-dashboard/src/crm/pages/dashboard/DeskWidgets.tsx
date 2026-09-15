/**
 * The role desk (14 Sep 2026 dashboard redesign) — the four zones every
 * login is composed from:
 *
 *   1. TodayStrip    — the numbers this role is judged on (GET /api/dashboard/today)
 *   2. MyWork        — lives in CrmDashboard.tsx (GET /api/dashboard/my-work)
 *   3. UpcomingPanel — next N days (GET /api/dashboard/upcoming) + QuickActions
 *   4. TeamPanel     — the head's layer, Sales Head / Admin / CEO (GET /api/dashboard/team)
 *
 * Rules: colour means STATE (bad / warn / ok), the brand blue stays on links
 * and actions; every number links to the list that produced it; an empty
 * widget says what "empty" means instead of rendering a blank card.
 */
import React from "react";
import { AlertTriangle, ArrowRight, CalendarClock, ChevronRight, Plus } from "lucide-react";

import { crmGet } from "../../api";
import { useMe } from "../../CrmApp";
import { CrmLink } from "../../routerHooks";
import { ErrorBox, SkeletonText } from "../../components/ui";

/* ---------- shared ---------- */

export function useDeskData<T>(url: string) {
  const [state, setState] = React.useState<{ data: T | null; loading: boolean; error: string }>({
    data: null, loading: true, error: "",
  });
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    crmGet<T>(url)
      .then((r) => alive && setState({ data: r.data, loading: false, error: "" }))
      .catch((e) => alive && setState({ data: null, loading: false, error: e?.message || "Failed to load" }));
    return () => { alive = false; };
  }, [url, tick]);
  return { ...state, retry: () => setTick((t) => t + 1) };
}

type State = "ok" | "warn" | "bad" | "info";

const STATE_CHIP: Record<State, string> = {
  ok: "bg-success-soft text-success",
  warn: "bg-warning-soft text-warning",
  bad: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};
const STATE_RAIL: Record<State, string> = {
  ok: "border-l-success", warn: "border-l-warning", bad: "border-l-danger", info: "border-l-brand-600",
};

const inr = (n: number) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`;
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

function fmtValue(value: number, format: string): string {
  if (format === "money") return inr(value);
  if (format === "percent") return `${Math.round(value)}%`;
  return Number(value).toLocaleString("en-IN");
}

/* ---------- 1. Today strip ---------- */

export type Tile = {
  key: string; label: string; value: number; detail: string;
  state: "ok" | "warn" | "bad"; path: string; format: "int" | "money" | "percent";
};

export function TodayStrip() {
  const { data, loading, error, retry } = useDeskData<{ tiles: Tile[] }>("/api/dashboard/today");
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised"><SkeletonText lines={2} /></div>
        ))}
      </div>
    );
  }
  if (error) return <ErrorBox error={error} onRetry={retry} />;
  const tiles = data?.tiles || [];
  if (tiles.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="list" aria-label="Today">
      {tiles.map((t) => (
        <CrmLink
          key={t.key}
          to={t.path}
          className={`group block rounded-card border border-subtle border-l-4 bg-surface-1 px-4 py-3 shadow-raised transition-shadow duration-micro hover:shadow-overlay ${STATE_RAIL[t.state]}`}
        >
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted">{t.label}</div>
          <div className="mt-0.5 text-2xl font-extrabold tabular-nums tracking-tight text-primary">
            {fmtValue(t.value, t.format)}
          </div>
          <div className="mt-0.5 truncate text-xs text-secondary" title={t.detail}>{t.detail}</div>
        </CrmLink>
      ))}
    </div>
  );
}

/* ---------- 3a. Coming up ---------- */

export type UpcomingItem = {
  when: string | null; kind: string; title: string; subtitle: string; path: string; state: State;
};

const KIND_LABEL: Record<string, string> = {
  interview: "Round", ai_l1: "AI L1", joining: "Join", rolloff: "Roll-off", po_expiry: "PO", invoice_due: "Due",
};

function whenLabel(iso: string | null): { day: string; time: string } {
  if (!iso) return { day: "—", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { day: iso, time: "" };
  const hasTime = iso.length > 10;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((that.getTime() - today.getTime()) / 86400000);
  const day = diff === 0 ? "Today" : diff === 1 ? "Tomorrow"
    : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  const time = hasTime ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) + " IST" : "";
  return { day, time };
}

export function UpcomingPanel({ days = 7 }: { days?: number }) {
  const { data, loading, error, retry } = useDeskData<{ items: UpcomingItem[] }>(`/api/dashboard/upcoming?days=${days}`);
  return (
    <div className="rounded-card border border-subtle bg-surface-1 shadow-raised">
      <div className="flex items-center justify-between border-b border-subtle px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-primary">
          <CalendarClock size={15} className="text-muted" aria-hidden /> Coming up · {days} days
        </h2>
        <CrmLink to="calendar" className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">Calendar →</CrmLink>
      </div>
      {loading && <div className="p-4"><SkeletonText lines={3} /></div>}
      {error && <div className="p-4"><ErrorBox error={error} onRetry={retry} /></div>}
      {!loading && !error && (data?.items?.length || 0) === 0 && (
        <p className="px-4 py-4 text-sm text-muted">Nothing dated in the next {days} days.</p>
      )}
      {!loading && !error && (data?.items?.length || 0) > 0 && (
        <ul className="divide-y divide-subtle">
          {data!.items.slice(0, 8).map((it, i) => {
            const w = whenLabel(it.when);
            return (
              <li key={`${it.kind}-${i}`}>
                <CrmLink to={it.path} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
                  <div className="w-24 shrink-0">
                    <div className="text-sm font-semibold text-primary">{w.day}</div>
                    <div className="text-[11px] text-muted">{w.time}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-primary">{it.title}</div>
                    {it.subtitle && <div className="truncate text-xs text-muted">{it.subtitle}</div>}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP[it.state] || STATE_CHIP.info}`}>
                    {KIND_LABEL[it.kind] || it.kind}
                  </span>
                </CrmLink>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------- 3b. Quick actions ---------- */

type QuickAction = { label: string; to: string; roles: string[] };

/** The 3–4 things each role starts most often. Order = first matching role first. */
const QUICK_ACTIONS: QuickAction[] = [
  { label: "Candidates", to: "candidates", roles: ["TA"] },
    { label: "Interview calendar", to: "calendar", roles: ["TA", "RMG"] },
  { label: "Opportunities (engineering review)", to: "opportunities", roles: ["RMG"] },
  { label: "Candidate profiles (screening)", to: "profiles", roles: ["RMG"] },
  { label: "Timesheets to approve", to: "timesheets", roles: ["RMG", "Sales"] },
  { label: "Opportunities", to: "opportunities", roles: ["Sales", "Sales_Head"] },
  { label: "Customers", to: "customers", roles: ["Sales", "Sales_Head"] },
  { label: "Rate cards", to: "rate-cards", roles: ["Sales", "Sales_Head"] },
    { label: "Employees", to: "employees", roles: ["HR"] },
  { label: "Leave applications", to: "leave-applications", roles: ["HR"] },
  { label: "Holidays", to: "holidays", roles: ["HR"] },
  { label: "Purchase orders", to: "pos", roles: ["Finance"] },
  { label: "Customer receipts", to: "customer-receipts", roles: ["Finance"] },
  { label: "Invoices", to: "invoices", roles: ["Finance"] },
  { label: "Users & roles", to: "users", roles: ["Admin", "CEO"] },
  { label: "Reports", to: "reports", roles: ["Admin", "CEO"] },
  { label: "Backup", to: "settings?tab=backup", roles: ["Admin", "CEO"] },
  { label: "Support tickets", to: "settings?tab=support-tickets", roles: ["Admin", "CEO"] },
];

export function QuickActions() {
  const me = useMe();
  const roles = me.roles || [];
  const actions = QUICK_ACTIONS.filter((a) => a.roles.some((r) => roles.includes(r)));
  const seen = new Set<string>();
  const list = actions.filter((a) => (seen.has(a.to) ? false : (seen.add(a.to), true))).slice(0, 6);
  if (list.length === 0) return null;
  return (
    <div className="rounded-card border border-subtle bg-surface-1 shadow-raised">
      <div className="border-b border-subtle px-4 py-3">
        <h2 className="text-sm font-bold text-primary">Quick actions</h2>
      </div>
      <div className="flex flex-wrap gap-2 p-4">
        {list.map((a) => (
          <CrmLink
            key={a.to}
            to={a.to}
            className="inline-flex items-center gap-1.5 rounded-control border border-dashed border-subtle px-3 py-1.5 text-xs font-semibold text-secondary transition-colors hover:border-brand-600 hover:text-brand-600 dark:hover:text-brand-300"
          >
            <Plus size={12} aria-hidden /> {a.label}
          </CrmLink>
        ))}
      </div>
    </div>
  );
}

/* ---------- 4. Team layer ---------- */

export type StuckPoint = { area: string; title: string; detail: string; count: number; state: State; path: string };
export type TeamData = {
  stuck: StuckPoint[];
  ta: { user_id: number; name: string; applied: number; active: number; shortlisted: number; joined: number; interviews_scheduled: number }[];
  sales: { user_id: number; name: string; open: number; stalled: number; pending_approval: number; won_quarter: number; state: State }[];
};

export function TeamPanel({ isAdmin }: { isAdmin: boolean }) {
  const { data, loading, error, retry } = useDeskData<TeamData>("/api/dashboard/team");
  if (loading) return <div className="rounded-card border border-subtle bg-surface-1 p-5 shadow-raised"><SkeletonText lines={4} /></div>;
  if (error || !data) return <ErrorBox error={error || "No data"} onRetry={retry} />;
  const people = [
    ...data.ta.map((r) => ({
      key: `ta-${r.user_id}`, name: r.name, team: "TA",
      line: `${r.active} active · ${r.interviews_scheduled} interviews · ${r.joined} joined`,
      state: (r.active === 0 && r.applied > 0 ? "warn" : "ok") as State,
    })),
    ...data.sales.map((r) => ({
      key: `sales-${r.user_id}`, name: r.name, team: "Sales",
      line: `${r.open} open · ${r.stalled} stalled · ${r.pending_approval} awaiting approval · ${r.won_quarter} won this quarter`,
      state: r.state,
    })),
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
      <div className="rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="flex items-center justify-between border-b border-subtle px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-primary">
            <AlertTriangle size={15} className="text-muted" aria-hidden />
            {isAdmin ? "Where the company is stuck" : "Where the team is stuck"}
          </h2>
          <CrmLink to="reports" className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">Reports →</CrmLink>
        </div>
        {data.stuck.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">Nothing is stuck — every queue is inside its SLA.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {data.stuck.map((s, i) => (
              <li key={`${s.area}-${i}`}>
                <CrmLink to={s.path} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-primary">{s.title}</div>
                    <div className="truncate text-xs text-muted">{s.detail}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_CHIP[s.state]}`}>{s.area}</span>
                  <ChevronRight size={14} className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </CrmLink>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="border-b border-subtle px-4 py-3">
          <h2 className="text-sm font-bold text-primary">Team this week</h2>
        </div>
        {people.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">No TA or Sales activity attributed to a person yet.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {people.slice(0, 10).map((p) => (
              <li key={p.key} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-primary">{p.name} <span className="font-normal text-muted">· {p.team}</span></div>
                  <div className="truncate text-xs text-muted">{p.line}</div>
                </div>
                <span className={`h-2 w-2 shrink-0 rounded-full ${p.state === "ok" ? "bg-success" : p.state === "warn" ? "bg-warning" : "bg-danger"}`} aria-label={p.state} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Small "see all" footer link used by the My work panel. */
export function SeeAll({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <CrmLink to={to} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
      {children} <ArrowRight size={12} aria-hidden />
    </CrmLink>
  );
}
