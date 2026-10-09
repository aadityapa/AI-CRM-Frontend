/**
 * AccessAuditLog (7 Oct 2026) — who changed whose access, when and why.
 *
 * `GET /api/users/access-log` (Admin/CEO). One component, two homes: the
 * Access Control ▸ Audit log tab (everything, with group chips + search) and the
 * Manage-user dialog's History tab (`userId` — changes TO or BY that login).
 * Newest first, grouped by day, "Load more" pages through the server.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cpu, History, KeyRound, Search, ShieldCheck, UserCog, Users, type LucideIcon,
} from "lucide-react";

import { crmGet, qs } from "../../api";
import { fmtDateTime12 } from "../../../lib/datetime";
import { CONTROL } from "../controlTower";

export type AccessLogRow = {
  id: number;
  action: string;
  label: string;
  group: "access" | "account" | "security" | "roles" | "settings" | "other";
  target_user_id: number | null;
  target_name: string | null;
  actor_name: string | null;
  subject_type: string | null;
  subject_name: string | null;
  summary: string | null;
  reason: string | null;
  at: string | null;
};

const GROUPS: { key: string; label: string }[] = [
  { key: "", label: "Everything" },
  { key: "access", label: "Roles & access" },
  { key: "account", label: "Accounts" },
  { key: "security", label: "Passwords" },
  { key: "roles", label: "Role & template edits" },
  { key: "settings", label: "AI engine" },
];

const GROUP_LOOK: Record<AccessLogRow["group"], { icon: LucideIcon; tile: string }> = {
  access: { icon: ShieldCheck, tile: "from-indigo-500 to-blue-600" },
  account: { icon: UserCog, tile: "from-emerald-500 to-teal-600" },
  security: { icon: KeyRound, tile: "from-amber-500 to-orange-600" },
  roles: { icon: Users, tile: "from-purple-500 to-fuchsia-600" },
  settings: { icon: Cpu, tile: "from-sky-500 to-indigo-600" },
  other: { icon: History, tile: "from-slate-500 to-slate-700" },
};

const PAGE = 25;

/** "Today" · "Yesterday" · "Mon, 5 Oct 2026" — the day headers. */
export function dayLabel(iso: string | null, now = new Date()): string {
  if (!iso) return "Undated";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Undated";
  const key = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (key(d) === key(now)) return "Today";
  if (key(d) === key(y)) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export function AccessAuditLog({ userId, compact = false, refreshKey = 0 }: {
  /** Only changes to / by this login (the Manage dialog). */
  userId?: number;
  /** Inside a dialog: no group chips, tighter rows. */
  compact?: boolean;
  /** Bump to reload (after an action on the page). */
  refreshKey?: number;
}) {
  const [group, setGroup] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<AccessLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(search.trim()), 350);
    return () => window.clearTimeout(t);
  }, [search]);

  const load = useCallback(async (nextPage: number) => {
    setLoading(true);
    setErr("");
    try {
      const res = await crmGet<AccessLogRow[]>(`/api/users/access-log${qs({
        user_id: userId, group: group || undefined, search: query || undefined, page: nextPage, limit: PAGE,
      })}`);
      setRows((prev) => (nextPage === 1 ? res.data || [] : [...prev, ...(res.data || [])]));
      setTotal(Number(res.meta?.total || 0));
      setPage(nextPage);
    } catch (e: any) {
      setErr(e?.message || "Could not load the audit log");
    } finally {
      setLoading(false);
    }
  }, [userId, group, query]);

  useEffect(() => { void load(1); }, [load, refreshKey]);

  const days = useMemo(() => {
    const out: { day: string; items: AccessLogRow[] }[] = [];
    for (const r of rows) {
      const day = dayLabel(r.at);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(r); else out.push({ day, items: [r] });
    }
    return out;
  }, [rows]);

  return (
    <div className={compact ? "" : "rounded-card border border-subtle bg-surface-1 p-4 shadow-raised"}>
      {!compact && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Audit log groups">
            {GROUPS.map((g) => (
              <button key={g.key || "all"} type="button" role="tab" aria-selected={group === g.key}
                onClick={() => setGroup(g.key)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors ${
                  group === g.key ? "bg-brand-600 text-white ring-brand-600" : "bg-surface-2 text-secondary ring-subtle hover:text-primary"}`}>
                {g.label}
              </button>
            ))}
          </div>
          <label className="relative ml-auto">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input type="text" className={`${CONTROL} w-64 pl-8`} placeholder="Search person, role, reason…"
              aria-label="Search the audit log" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
      )}
      {err && <p role="alert" className="mb-3 rounded-control bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">{err}</p>}
      {!loading && !err && rows.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-subtle bg-surface-2 px-4 py-8 text-center text-sm text-muted">
          {userId ? "No access changes recorded for this person yet." : "Nothing recorded yet — every change made from here on is listed."}
          <div className="mt-1 text-xs">The log starts with this release; earlier changes were never recorded.</div>
        </div>
      )}
      <div className="space-y-5">
        {days.map((d) => (
          <section key={d.day}>
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">{d.day}</h3>
            <ol className="relative space-y-2 border-l border-subtle pl-5">
              {d.items.map((r) => {
                const look = GROUP_LOOK[r.group] || GROUP_LOOK.other;
                const Icon = look.icon;
                const about = r.target_name || r.subject_name;
                return (
                  <li key={r.id} className="relative">
                    <span className={`absolute -left-[31px] top-1 grid h-5 w-5 place-items-center rounded-full bg-gradient-to-br text-[#fff] ring-4 ring-[color:var(--surface-1)] ${look.tile}`}>
                      <Icon size={11} aria-hidden />
                    </span>
                    <div className={`rounded-xl border border-subtle bg-surface-1 ${compact ? "px-3 py-2" : "px-3.5 py-2.5"} hover:border-strong`}>
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-sm font-semibold text-primary">{r.label}</span>
                        {about && !userId && <span className="text-sm text-secondary">· {about}</span>}
                        <span className="ml-auto whitespace-nowrap text-[11px] text-muted">{fmtDateTime12(r.at)}</span>
                      </div>
                      {r.summary && r.summary !== r.label && <p className="mt-0.5 text-xs text-secondary">{r.summary}</p>}
                      {r.reason && (
                        <p className="mt-1 rounded-lg border-l-2 border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                          “{r.reason}”
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-muted">by {r.actor_name || "the system"}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
      {loading && <p className="mt-3 text-center text-xs text-muted">Loading…</p>}
      {!loading && rows.length < total && (
        <div className="mt-4 text-center">
          <button type="button" onClick={() => void load(page + 1)}
            className="rounded-full border border-subtle bg-surface-2 px-4 py-1.5 text-xs font-semibold text-secondary hover:text-primary">
            Load more · {total - rows.length} older
          </button>
        </div>
      )}
    </div>
  );
}
