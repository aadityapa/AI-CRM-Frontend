/**
 * Activity Log — the global audit stream (Aug 2026).
 *
 * One feed over every entity's activity trail: Opportunities, Requirements,
 * Candidate Profiles, Purchase Orders and Timesheets — who did what, on which
 * record, when, across all roles and pipeline stages. Each row deep-links to
 * the record it describes.
 *
 * Server-side everything: entity-type chips, action/user/comment search and
 * the date range all narrow the SQL union, so filters cover the whole history,
 * not the visible page.
 */
import { useCallback, useEffect, useState } from "react";
import { History, Search } from "lucide-react";
import { crmGet, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanAct } from "../useAccess";
import { crmNavigate } from "../routerHooks";
import { EmptyState, ErrorBox, Spinner, inputCls } from "../components/ui";

type ActivityRow = {
  id: string;
  entity_type: string;
  entity_id: number;
  entity_label: string;
  user_id: number;
  user_name: string;
  user_roles: string[];
  action_type: string;
  comment: string | null;
  timestamp: string | null;
};

const ENTITY_META: Record<string, { label: string; badge: string; path: (id: number) => string }> = {
  opportunity: { label: "Opportunity", badge: "bg-brand-600/10 text-brand-700 dark:text-brand-300", path: (id) => `opportunities/${id}` },
  requirement: { label: "Requirement", badge: "bg-violet-600/10 text-violet-700 dark:text-violet-300", path: (id) => `requirements/${id}` },
  profile: { label: "Candidate", badge: "bg-success-soft text-success", path: (id) => `profiles/${id}` },
  po: { label: "Purchase Order", badge: "bg-warning-soft text-warning", path: (id) => `pos/${id}` },
  timesheet: { label: "Timesheet", badge: "bg-info-soft text-info", path: (id) => `timesheets/${id}` },
};
const ENTITY_KEYS = Object.keys(ENTITY_META);

/** "profile.status_changed" → "Status Changed" — server action keys are dotted. */
const humanAction = (a: string) =>
  (a.split(".").pop() || a).replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const fmtWhen = (v: string | null) =>
  v ? new Date(v).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

export function ActivityLogPage() {
  const roleOk = useHasRole("TA", "RMG", "Sales", "Sales_Head", "HR", "Finance");
  const allowed = useCanAct("activity-log", "view", roleOk);
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [entities, setEntities] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [userDraft, setUserDraft] = useState("");
  const [userQ, setUserQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => { setSearch(draft.trim()); setUserQ(userDraft.trim()); }, 350);
    return () => window.clearTimeout(t);
  }, [draft, userDraft]);
  useEffect(() => setPage(1), [search, userQ, entities, from, to]);

  const load = useCallback(() => {
    setError("");
    crmGet<ActivityRow[]>(`/api/activity-log${qs({
      entity: entities.length ? entities.join(",") : undefined,
      search: search || undefined,
      user: userQ || undefined,
      date_from: from || undefined,
      date_to: to || undefined,
      page,
      limit: 30,
    })}`)
      .then((r) => { setRows(r.data || []); setMeta(r.meta); })
      .catch((e: any) => setError(e?.message || "Failed to load activity"));
  }, [entities, search, userQ, from, to, page]);
  useEffect(() => { setRows(null); load(); }, [load]);

  if (!allowed) return <EmptyState message="The Activity Log is not enabled for your role." />;

  const toggleEntity = (k: string) =>
    setEntities((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-display flex items-center gap-2 text-xl font-bold text-primary">
          <History size={20} className="text-brand-600 dark:text-brand-300" /> Activity Log
        </h1>
        <p className="mt-0.5 text-sm text-muted">
          Everything that happened, across every role and stage — opportunities, requirements,
          candidates, purchase orders and timesheets in one stream. Click a row to open the record.
        </p>
      </div>

      {/* Entity-type chips: the "bunch of lists" — All, or any combination. */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setEntities([])}
          aria-pressed={entities.length === 0}
          className={`h-8 rounded-full border px-3 text-xs font-bold transition-colors duration-micro ${
            entities.length === 0
              ? "border-transparent bg-brand-600 text-white shadow-raised"
              : "border-subtle bg-surface-1 text-secondary hover:border-strong"
          }`}
        >
          All
        </button>
        {ENTITY_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => toggleEntity(k)}
            aria-pressed={entities.includes(k)}
            className={`h-8 rounded-full border px-3 text-xs font-bold transition-colors duration-micro ${
              entities.includes(k)
                ? "border-transparent bg-brand-600 text-white shadow-raised"
                : "border-subtle bg-surface-1 text-secondary hover:border-strong"
            }`}
          >
            {ENTITY_META[k].label}s
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex min-w-[200px] flex-1 max-w-xs items-center gap-2 rounded-control border border-subtle bg-surface-1 px-3">
          <Search size={14} className="shrink-0 text-muted" />
          <input
            className="h-9 w-full bg-transparent text-sm text-primary placeholder:text-muted focus:outline-none"
            placeholder="Search action or comment…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <input
          className={`${inputCls} !w-44`}
          placeholder="By person…"
          value={userDraft}
          onChange={(e) => setUserDraft(e.target.value)}
        />
        <input type="date" className={`${inputCls} !w-auto`} value={from}
          onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <span className="text-xs text-muted">to</span>
        <input type="date" className={`${inputCls} !w-auto`} value={to}
          onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        {meta && (
          <span className="ml-auto text-xs text-muted">
            {meta.total} entr{meta.total === 1 ? "y" : "ies"} · page {meta.page}/{Math.max(1, meta.pages)}
          </span>
        )}
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}
      {!error && rows === null && <Spinner label="Loading activity…" />}
      {!error && rows !== null && rows.length === 0 && (
        <EmptyState message="No activity matches these filters." />
      )}

      {!error && rows !== null && rows.length > 0 && (
        <div className="elev-1 overflow-hidden rounded-panel">
          {rows.map((r) => {
            const em = ENTITY_META[r.entity_type];
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => em && crmNavigate(em.path(r.entity_id))}
                className="row-hover block w-full border-b border-subtle px-4 py-3 text-left transition-colors duration-micro"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${em?.badge || "bg-surface-2 text-secondary"}`}>
                    {em?.label || r.entity_type}
                  </span>
                  <span className="min-w-0 truncate text-sm font-semibold text-primary">
                    {r.entity_label}
                  </span>
                  <span className="text-sm text-secondary">— {humanAction(r.action_type)}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted">{fmtWhen(r.timestamp)}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-1 text-xs">
                  <span className="text-secondary">
                    by <span className="font-semibold text-primary">{r.user_name}</span>
                    {r.user_roles.length > 0 && (
                      <span className="ml-1 text-muted">({r.user_roles.join(", ")})</span>
                    )}
                  </span>
                  {r.comment && <span className="min-w-0 truncate text-muted">“{r.comment}”</span>}
                </div>
              </button>
            );
          })}
          {meta && meta.pages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 text-sm">
              <button
                className="text-xs font-semibold text-brand-600 disabled:text-muted dark:text-brand-300"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                ← Newer
              </button>
              <span className="text-xs text-muted">Page {meta.page} of {meta.pages}</span>
              <button
                className="text-xs font-semibold text-brand-600 disabled:text-muted dark:text-brand-300"
                disabled={page >= meta.pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Older →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
