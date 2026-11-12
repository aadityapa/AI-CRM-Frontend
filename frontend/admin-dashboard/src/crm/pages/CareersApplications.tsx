/** Careers applications (6 Nov 2026, user ask: "for RMG, TA & GM one tab that
 *  contains every careers-page candidate with all required details, so they can
 *  see where the candidate comes from and which position").
 *
 *  ONE list: everyone who applied through the public careers page, a position's
 *  application link, or "Didn't find your role? Send your resume" — newest first,
 *  with the channel (LinkedIn · Naukri · WhatsApp …), the position and customer,
 *  the facts TA needs (experience · notice / last working day · CTC in lakhs ·
 *  locations · budget fit), the derived status and the TA owner.
 *
 *  Server: GET /api/careers/applications (services/careers_applications.py),
 *  gate TA · RMG · GM (screener) · Admin / CEO. The page writes one thing — TA's
 *  "Send for Technical Screening" on Sourcing rows — through the same endpoint
 *  Applied Candidates uses.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Briefcase, Building2, ChevronLeft, ChevronRight, ExternalLink, FileText, Globe2, Inbox,
  Linkedin, Mail, MapPin, Phone, RefreshCw, Search, Send, UserRound,
} from "lucide-react";

import { crmGet, crmPost, qs } from "../api";
import { useHasRole } from "../CrmApp";
import { CrmLink } from "../router";
import { ErrorBox, Spinner, useToast } from "../components/ui";
import { PageHeader, HERO_BTN } from "../components/PageHeader";
import { CareersLinkButton } from "../components/CareersLinkModal";
import { CONTROL } from "../components/controlTower";
import { FLOW_BTN } from "../components/flowButtons";
import { CandidateStatusBadge, type CandidateStatus } from "../components/CandidateStatusBadge";
import { initials } from "../components/dialogKit";
import { STAGE_TONE } from "../lib/candidateStageBuckets";
import { useSessionState, useChangeEffect } from "../lib/pageState";
import { fmtDateTime12, fmtDateShort } from "../../lib/datetime";
import { fileViewHref } from "./FileView";

// ---------------------------------------------------------------------------
// Payload (mirror of the server)
// ---------------------------------------------------------------------------

export type CareersApplication = {
  key: string;
  kind: "position" | "general";
  via: "careers" | "apply_link" | "general";
  resume_id: number | null;
  candidate_id: number | null;
  profile_id: number | null;
  applied_at: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  experience: string | null;
  notice_period: string | null;
  last_working_day: string | null;
  current_location: string | null;
  preferred_location: string | null;
  current_ctc: string | null;
  expected_ctc: string | null;
  budget_ctc_max: number | null;
  over_budget: boolean;
  skills: string | null;
  linkedin_url: string | null;
  channel: string;
  channel_key: string;
  resume_url: string | null;
  ats_score: number | null;
  position: { id: number; req_number: string | null; title: string | null; status: string } | null;
  opportunity: { id: number; opp_id: string | null } | null;
  customer: { id: number; name: string } | null;
  ta_owner: string | null;
  status: CandidateStatus | null;
  phase: string | null;
  path: string;
};

type Chip = { key: string; label: string; count: number };
type AppsMeta = {
  total: number; page: number; limit: number; truncated?: boolean;
  counts: {
    total: number; today: number; last_7_days: number; last_30_days: number; over_budget: number;
    by_via: Chip[]; by_channel: Chip[]; by_phase: Chip[];
  };
  overall: { total: number; today: number; last_7_days: number; last_30_days: number };
  options: {
    positions: { id: number; label: string; customer_id: number | null; count: number }[];
    customers: { id: number; name: string }[];
    channels: Chip[];
    via: { key: string; label: string }[];
  };
};

export type AppFilters = {
  search: string; via: string; channel: string; phase: string;
  requirement_id: string; customer_id: string; date_from: string; date_to: string;
};
export const EMPTY_FILTERS: AppFilters = {
  search: "", via: "", channel: "", phase: "", requirement_id: "", customer_id: "", date_from: "", date_to: "",
};

/** PURE — the query string the page sends (blank filters left out). */
export function appsQuery(f: AppFilters, page: number, limit = 25): string {
  return qs({
    search: f.search.trim() || undefined, via: f.via || undefined, channel: f.channel || undefined,
    phase: f.phase || undefined, requirement_id: f.requirement_id || undefined,
    customer_id: f.customer_id || undefined, date_from: f.date_from || undefined,
    date_to: f.date_to || undefined, page, limit,
  });
}

/** PURE — how many filters (other than search) are on. */
export function activeFilterCount(f: AppFilters): number {
  return (["via", "channel", "phase", "requirement_id", "customer_id", "date_from", "date_to"] as const)
    .filter((k) => !!f[k]).length;
}

/** PURE — a TA may send this row for Technical Screening from here. */
export function canSendForScreening(r: CareersApplication): boolean {
  return r.kind === "position" && r.profile_id != null && r.phase === "sourcing";
}

const VIA_LOOK: Record<string, string> = {
  careers: "bg-teal-100 text-teal-800 dark:bg-teal-950/50 dark:text-teal-300",
  apply_link: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
  general: "bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300",
};
const VIA_WORDS: Record<string, string> = {
  careers: "Careers page", apply_link: "Application link", general: "Sent a resume (no position)",
};
const CHANNEL_LOOK: Record<string, string> = {
  linkedin: "bg-[#0a66c2] text-[#ffffff]", naukri: "bg-[#4a90e2] text-[#ffffff]",
  whatsapp: "bg-[#128c4b] text-[#ffffff]", indeed: "bg-[#2557a7] text-[#ffffff]",
};
const chipCls = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold";
const pillCls = (on: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
    on ? "border-brand-600 bg-brand-600 text-white" : "border-subtle bg-surface-1 text-secondary hover:bg-surface-2"}`;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function CareersApplicationsPage() {
  const [toastNode, toast] = useToast();
  const isTa = useHasRole("TA");
  const [filters, setFilters] = useSessionState<AppFilters>("careers.apps.filters", EMPTY_FILTERS);
  const [page, setPage] = useSessionState<number>("careers.apps.page", 1);
  const [searchText, setSearchText] = useState(filters.search);
  const [rows, setRows] = useState<CareersApplication[]>([]);
  const [meta, setMeta] = useState<AppsMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await crmGet<CareersApplication[]>(`/api/careers/applications${appsQuery(filters, page)}`);
      setRows(res.data || []);
      setMeta((res.meta as unknown as AppsMeta) || null);
    } catch (e: any) {
      setError(e?.message || "Could not load the careers applications");
    } finally {
      setLoading(false);
    }
  }, [filters, page]);
  useEffect(() => { void load(); }, [load]);
  useChangeEffect(() => { setPage(1); setPicked(new Set()); }, [JSON.stringify(filters)]);

  // Debounced search box.
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchText !== filters.search) setFilters((f) => ({ ...f, search: searchText }));
    }, 350);
    return () => clearTimeout(t);
  }, [searchText, filters.search, setFilters]);

  const set = (k: keyof AppFilters, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const toggle = (k: keyof AppFilters, v: string) => setFilters((f) => ({ ...f, [k]: f[k] === v ? "" : v }));

  const positions = useMemo(() => {
    const all = meta?.options.positions || [];
    return filters.customer_id ? all.filter((p) => String(p.customer_id) === filters.customer_id) : all;
  }, [meta, filters.customer_id]);

  const sendable = rows.filter(canSendForScreening);
  const sendPicked = async () => {
    const ids = [...picked];
    if (!ids.length) return;
    setSending(true);
    try {
      const res = await crmPost("/api/candidate-profiles/send-for-screening", { profile_ids: ids });
      toast(res.message || "Sent for Technical Screening");
      setPicked(new Set());
      void load();
    } catch (e: any) {
      toast(e?.message || "Could not send them for Technical Screening", "err");
    } finally {
      setSending(false);
    }
  };

  const overall = meta?.overall;
  const counts = meta?.counts;
  const pages = meta ? Math.max(1, Math.ceil(meta.total / (meta.limit || 25))) : 1;

  return (
    <div className="space-y-4">
      {toastNode}
      <PageHeader
        icon={Inbox}
        accent="teal"
        eyebrow="Recruitment · public applications"
        title="Careers applications"
        subtitle="Everyone who applied on the careers page, a position's application link or 'Send your resume' — where they came from, which position, and where they stand now."
        stats={[
          { label: "All applications", value: overall?.total ?? "—" },
          { label: "Today", value: overall?.today ?? "—" },
          { label: "Last 7 days", value: overall?.last_7_days ?? "—" },
          { label: "Last 30 days", value: overall?.last_30_days ?? "—" },
          { label: "Over budget (shown)", value: counts?.over_budget ?? "—",
            title: "Expected CTC above the position's budget — in the list as filtered" },
        ]}
        actions={
          <>
            <CareersLinkButton toast={toast} />
            <button type="button" className={HERO_BTN} onClick={() => void load()} disabled={loading}>
              <RefreshCw size={16} aria-hidden className={loading ? "animate-spin" : ""} /> Refresh
            </button>
          </>
        }
      >
        <div className="space-y-3 p-4">
          {/* Where they came from */}
          <ChipRow label="Came through">
            <button type="button" className={pillCls(!filters.via)} onClick={() => set("via", "")}>
              All <span className="opacity-80">{counts?.total ?? ""}</span>
            </button>
            {(counts?.by_via || []).map((c) => (
              <button key={c.key} type="button" className={pillCls(filters.via === c.key)} onClick={() => toggle("via", c.key)}>
                {c.label} <span className="opacity-80">{c.count}</span>
              </button>
            ))}
          </ChipRow>
          <ChipRow label="Channel">
            <button type="button" className={pillCls(!filters.channel)} onClick={() => set("channel", "")}>All</button>
            {(meta?.options.channels || []).map((c) => (
              <button key={c.key} type="button" className={pillCls(filters.channel === c.key)} onClick={() => toggle("channel", c.key)}>
                {c.label} <span className="opacity-80">{(counts?.by_channel || []).find((x) => x.key === c.key)?.count ?? 0}</span>
              </button>
            ))}
          </ChipRow>
          <ChipRow label="Stage now">
            <button type="button" className={pillCls(!filters.phase)} onClick={() => set("phase", "")}>All</button>
            {(counts?.by_phase || []).filter((c) => c.count || filters.phase === c.key).map((c) => (
              <button key={c.key} type="button"
                className={filters.phase === c.key ? pillCls(true)
                  : `inline-flex items-center gap-1.5 rounded-full border border-subtle px-3 py-1 text-xs font-semibold ${STAGE_TONE[c.key] || "bg-surface-1 text-secondary"}`}
                onClick={() => toggle("phase", c.key)}>
                {c.label} <span className="opacity-80">{c.count}</span>
              </button>
            ))}
          </ChipRow>

          <div className="flex flex-wrap items-end gap-2">
            <label className="relative min-w-[220px] flex-1">
              <span className="sr-only">Search</span>
              <Search size={15} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input type="text" className={`${CONTROL} w-full pl-8`} value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Name, email, phone, position, REQ number, customer, city, skill" />
            </label>
            <select className={`${CONTROL} max-w-[220px]`} aria-label="Customer" value={filters.customer_id}
              onChange={(e) => setFilters((f) => ({ ...f, customer_id: e.target.value, requirement_id: "" }))}>
              <option value="">All customers</option>
              {(meta?.options.customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className={`${CONTROL} max-w-[280px]`} aria-label="Position" value={filters.requirement_id}
              onChange={(e) => set("requirement_id", e.target.value)}>
              <option value="">All positions</option>
              {positions.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.count})</option>)}
            </select>
            <label className="flex items-center gap-1 text-xs text-muted">
              From <input type="date" className={CONTROL} value={filters.date_from} onChange={(e) => set("date_from", e.target.value)} />
            </label>
            <label className="flex items-center gap-1 text-xs text-muted">
              To <input type="date" className={CONTROL} value={filters.date_to} onChange={(e) => set("date_to", e.target.value)} />
            </label>
            {(activeFilterCount(filters) > 0 || filters.search) && (
              <button type="button" className="text-xs font-semibold text-brand-600 hover:underline"
                onClick={() => { setSearchText(""); setFilters(EMPTY_FILTERS); }}>
                Clear all
              </button>
            )}
          </div>
        </div>
      </PageHeader>

      {isTa && sendable.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-subtle bg-surface-1 px-4 py-2.5 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox"
              checked={sendable.every((r) => picked.has(r.profile_id as number))}
              onChange={(e) => setPicked(e.target.checked ? new Set(sendable.map((r) => r.profile_id as number)) : new Set())} />
            Select the {sendable.length} at Sourcing on this page
          </label>
          <span className="text-muted">They applied themselves, so no opening email is needed.</span>
          <button type="button" className={`${FLOW_BTN.primary} ml-auto`} disabled={!picked.size || sending} onClick={() => void sendPicked()}>
            <Send size={14} aria-hidden /> {sending ? "Sending…" : `Send ${picked.size || ""} for Technical Screening`}
          </button>
        </div>
      )}

      {error && <ErrorBox error={error} onRetry={() => void load()} />}
      {loading && !rows.length ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : !rows.length && !error ? (
        <div className="rounded-card border border-dashed border-subtle bg-surface-1 p-10 text-center text-sm text-muted">
          {activeFilterCount(filters) || filters.search
            ? "Nobody matches these filters."
            : "No one has applied through the careers page yet. Share the Careers link on LinkedIn or Naukri to start."}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <ApplicationRow key={r.key} r={r}
              selectable={isTa && canSendForScreening(r)}
              selected={r.profile_id != null && picked.has(r.profile_id)}
              onSelect={(on) => setPicked((s) => {
                const n = new Set(s);
                if (r.profile_id == null) return n;
                if (on) n.add(r.profile_id); else n.delete(r.profile_id);
                return n;
              })} />
          ))}
        </ul>
      )}

      {meta && meta.total > meta.limit && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>{meta.total} applications · page {page} of {pages}{meta.truncated ? " · newest 5,000 read" : ""}</span>
          <div className="flex gap-2">
            <button type="button" className={FLOW_BTN.neutral} disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft size={14} aria-hidden /> Previous
            </button>
            <button type="button" className={FLOW_BTN.neutral} disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next <ChevronRight size={14} aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </div>
  );
}

function Fact({ icon: Icon, children, tone = "" }: { icon?: typeof MapPin; children: React.ReactNode; tone?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-control bg-surface-2 px-2 py-0.5 text-xs text-secondary ${tone}`}>
      {Icon && <Icon size={12} aria-hidden />} {children}
    </span>
  );
}

function ApplicationRow({ r, selectable, selected, onSelect }: {
  r: CareersApplication; selectable: boolean; selected: boolean; onSelect: (on: boolean) => void;
}) {
  const resume = fileViewHref(r.resume_url, r.name);
  const notice = r.last_working_day
    ? `LWD ${fmtDateShort(r.last_working_day)}`
    : r.notice_period ? `Notice ${r.notice_period}` : null;
  const ctc = r.current_ctc || r.expected_ctc
    ? `${r.current_ctc || "—"} → ${r.expected_ctc || "—"}`
    : null;
  return (
    <li className="rounded-card border border-subtle bg-surface-1 p-3 shadow-raised sm:p-4">
      <div className="flex flex-wrap items-start gap-3">
        {selectable && (
          <input type="checkbox" className="mt-3" aria-label={`Select ${r.name || "candidate"}`}
            checked={selected} onChange={(e) => onSelect(e.target.checked)} />
        )}
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-sky-600 text-sm font-bold text-white">
          {initials(r.name)}
        </span>

        {/* Who + where they came from */}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-primary">{r.name || "—"}</span>
            <span className={`${chipCls} ${VIA_LOOK[r.via] || ""}`}>
              <Globe2 size={12} aria-hidden /> {VIA_WORDS[r.via] || r.via}
            </span>
            <span className={`${chipCls} ${CHANNEL_LOOK[r.channel_key] || "bg-surface-2 text-secondary"}`}>
              via {r.channel}
            </span>
            <span className="text-xs text-muted" title={r.applied_at || ""}>applied {fmtDateTime12(r.applied_at)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-secondary">
            {r.email && <a className="inline-flex items-center gap-1 hover:underline" href={`mailto:${r.email}`}><Mail size={12} aria-hidden />{r.email}</a>}
            {r.phone && <a className="inline-flex items-center gap-1 hover:underline" href={`tel:${r.phone}`}><Phone size={12} aria-hidden />{r.phone}</a>}
            {r.linkedin_url && /^https?:\/\//i.test(r.linkedin_url) && (
              <a className="inline-flex items-center gap-1 text-brand-600 hover:underline" href={r.linkedin_url} target="_blank" rel="noopener noreferrer">
                <Linkedin size={12} aria-hidden /> LinkedIn
              </a>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {r.experience && <Fact icon={Briefcase}>{r.experience} yrs</Fact>}
            {notice && <Fact>{notice}</Fact>}
            {ctc && <Fact>CTC {ctc}</Fact>}
            {r.over_budget && (
              <Fact tone="!bg-rose-100 !text-rose-700 dark:!bg-rose-950/50 dark:!text-rose-300">
                Over budget{r.budget_ctc_max ? ` · budget ${(r.budget_ctc_max / 1e5).toFixed(1)} L` : ""}
              </Fact>
            )}
            {(r.current_location || r.preferred_location) && (
              <Fact icon={MapPin}>
                {r.current_location || "—"}{r.preferred_location ? ` → prefers ${r.preferred_location}` : ""}
              </Fact>
            )}
            {r.skills && <Fact>Skills: {r.skills}</Fact>}
          </div>
        </div>

        {/* Which position + where they stand */}
        <div className="w-full space-y-1.5 sm:w-72">
          {r.position ? (
            <CrmLink to={`requirements/${r.position.id}`} className="block rounded-control border border-subtle px-2.5 py-1.5 hover:bg-surface-2">
              <span className="flex items-center gap-1 text-sm font-semibold text-primary">
                <Briefcase size={13} aria-hidden /> {r.position.title || "Position"}
              </span>
              <span className="block text-xs text-muted">
                {[r.position.req_number, r.opportunity?.opp_id].filter(Boolean).join(" · ")}
              </span>
              {r.customer && (
                <span className="mt-0.5 flex items-center gap-1 text-xs text-secondary">
                  <Building2 size={12} aria-hidden /> {r.customer.name}
                </span>
              )}
            </CrmLink>
          ) : (
            <div className="rounded-control border border-dashed border-subtle px-2.5 py-1.5 text-xs text-muted">
              No position — in the Talent Pool for the next opening
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {r.status ? <CandidateStatusBadge status={r.status} /> : r.kind === "position"
              ? <span className={`${chipCls} bg-surface-2 text-muted`}>No candidacy yet</span> : null}
            {r.ats_score != null && <span className={`${chipCls} bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300`}>ATS {Math.round(r.ats_score)}</span>}
            {r.ta_owner && <span className="inline-flex items-center gap-1 text-xs text-muted"><UserRound size={12} aria-hidden />{r.ta_owner}</span>}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 border-t border-subtle pt-2.5">
        <CrmLink to={r.path} className={FLOW_BTN.primary}>
          <ExternalLink size={14} aria-hidden /> {r.kind === "position" ? "Open in Applied Candidates" : "Open candidate"}
        </CrmLink>
        {resume && (
          <a href={resume} target="_blank" rel="noopener noreferrer" className={FLOW_BTN.view}>
            <FileText size={14} aria-hidden /> Resume
          </a>
        )}
        {r.profile_id != null && (
          <CrmLink to={`profiles/${r.profile_id}`} className={FLOW_BTN.neutral}>
            <UserRound size={14} aria-hidden /> Profile
          </CrmLink>
        )}
        {r.candidate_id != null && r.kind === "position" && (
          <CrmLink to={`candidates/${r.candidate_id}?tab=matching`} className={FLOW_BTN.neutral}>
            Other matching positions
          </CrmLink>
        )}
      </div>
    </li>
  );
}
