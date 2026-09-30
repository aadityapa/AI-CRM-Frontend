/** Apply a candidate to an opportunity — from either direction.
 *
 * `mode="pick-opportunity"` is opened from a candidate row (choose the opportunity);
 * `mode="pick-candidate"` is opened from an opportunity row (choose the candidate).
 *
 * Applying creates a Candidate Profile (candidate × opportunity), which is what
 * the Candidate Profiles tab and Opportunity → Applicants are both built on. It
 * deliberately does NOT go through the requirement/ATS route, which refuses
 * without a CV — most imported candidates have none, and a missing resume should
 * not stop someone being put forward.
 *
 * Search runs server-side and debounced: there are thousands of candidates, so
 * loading them all into a dropdown is not an option.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Briefcase, Building2, Check, MapPin, Search, Sparkles, UserRound, Users, X } from "lucide-react";
import { crmGet, crmPost, qs } from "../api";
import { DuplicateProfileNotice, duplicateProfileFromError } from "./DuplicateProfileNotice";
import type { DuplicateProfile } from "./DuplicateProfileNotice";
import {
  ErrorBox, Modal, Spinner, btnPrimary, btnSecondary, inputCls,
} from "./ui";
import { useHasRole } from "../CrmApp";

type Mode = "pick-opportunity" | "pick-candidate";

type Option = {
  id: number;
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  /** Suggested-candidate match (pick-candidate mode only). */
  score?: number;
  matched?: string[];
  missing?: string[];
  engaged?: boolean;
  /** Search haystack for filtering suggestions client-side. */
  hay?: string;
  /** Opportunity rows (pick-opportunity mode) — read-only chips from the list row. */
  positionsOpen?: number | null;
  positionsTotal?: number | null;
  stage?: string | null;
  location?: string | null;
};

const STAGE_LABELS: Record<string, string> = {
  New: "New", Active: "Active", On_Hold: "Customer Hold", Sales_Hold: "Sales Hold",
  Closed_Won: "Close Won", Closed_Lost: "Close Lost", Closed_Partial: "Close Partial",
  Rejected: "Rejected", Archived: "Archived",
};
const stageLabel = (v: string) => STAGE_LABELS[v] || v.replace(/_/g, " ");
const stageTone = (v: string) =>
  v === "Active" || v === "New" ? "bg-success-soft text-success"
    : /Hold/.test(v) ? "bg-warning-soft text-warning"
      : "bg-surface-1 text-muted ring-1 ring-inset ring-subtle";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] || "" : "")).toUpperCase();
}

/** Small match ring — arc length + the number carry the score, colour is redundant. */
function MatchRing({ score }: { score: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const stroke = score >= 70 ? "#059669" : score >= 45 ? "#d97706" : "#94a3b8";
  return (
    <span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center" title="Skills / experience match">
      <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" className="stroke-slate-200 dark:stroke-slate-700" />
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" stroke={stroke} strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`} />
      </svg>
      <span className={`relative rounded-full px-0.5 text-[11px] font-bold tabular-nums ${scoreTone(score)} !bg-transparent`}>{score}%</span>
    </span>
  );
}

/** Matched candidates for the opportunity (7 Sep 2026, user request): the
 *  same skills / experience / history scoring the Suggested Candidates tab
 *  uses, shown FIRST with the match %; the whole master follows below. */
type Suggestion = {
  candidate_id: number; name: string; email?: string | null; phone?: string | null;
  experience_years?: number | null; city?: string | null; technical_domain?: string | null;
  score: number; matched_skills: string[]; missing_mandatory_skills: string[]; engaged: boolean;
};

function scoreTone(score: number): string {
  if (score >= 70) return "bg-success-soft text-success";
  if (score >= 45) return "bg-warning-soft text-warning";
  return "bg-surface-1 text-muted";
}

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 25;

export function ApplyToOpportunityModal({
  mode,
  candidateId,
  candidateName,
  opportunityId,
  opportunityLabel,
  onClose,
  onApplied,
}: {
  mode: Mode;
  /** Required for pick-opportunity. */
  candidateId?: number;
  candidateName?: string;
  /** Required for pick-candidate. */
  opportunityId?: number;
  opportunityLabel?: string;
  onClose: () => void;
  onApplied: (message: string) => void;
}) {
  const pickingOpportunity = mode === "pick-opportunity";
  /* A recruiter-only TA may only apply to opportunities OPEN FOR SOURCING (user
     bug report, 29 Sep 2026). The server enforces it; the list filters to match.
     Hooks called unconditionally; useHasRole passes Admin/CEO, so they are never
     restricted. */
  const isTa = useHasRole("TA");
  const hasWider = useHasRole("Sales", "Sales_Head", "RMG");
  const recruiterOnly = isTa && !hasWider;

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Option | null>(null);
  const [suggested, setSuggested] = useState<Option[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Structured 409: who already applied this candidate, with the profile link. */
  const [dupProfile, setDupProfile] = useState<DuplicateProfile | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Suggested (matched) candidates — loaded once per opportunity, best first.
  useEffect(() => {
    if (pickingOpportunity || !opportunityId) return;
    let alive = true;
    crmGet<Suggestion[]>(`/api/opportunities/${opportunityId}/suggested-candidates`)
      .then((r) => {
        if (!alive) return;
        const rows = (r.data || []).slice().sort((a, b) => b.score - a.score);
        setSuggested(rows.map((c) => ({
          id: c.candidate_id,
          title: c.name || `#${c.candidate_id}`,
          subtitle: [c.technical_domain, c.city].filter(Boolean).join(" · ") || null,
          meta: c.experience_years != null ? `${c.experience_years} yrs` : null,
          score: Math.round(c.score),
          matched: c.matched_skills || [],
          missing: c.missing_mandatory_skills || [],
          engaged: !!c.engaged,
          hay: [c.name, c.email, c.phone, c.city, c.technical_domain].filter(Boolean).join(" ").toLowerCase(),
        })));
      })
      .catch(() => { if (alive) setSuggested([]); });   // matcher down → plain search still works
    return () => { alive = false; };
  }, [pickingOpportunity, opportunityId]);

  const visibleSuggested = useMemo(() => {
    if (!suggested) return [];
    const q = debounced.toLowerCase();
    return q ? suggested.filter((o) => (o.hay || "").includes(q)) : suggested;
  }, [suggested, debounced]);
  const suggestedIds = useMemo(() => new Set((suggested || []).map((o) => o.id)), [suggested]);
  // "All candidates" = the server search minus anyone already in the matched list.
  const otherOptions = useMemo(
    () => (pickingOpportunity ? options : options.filter((o) => !suggestedIds.has(o.id))),
    [options, suggestedIds, pickingOpportunity],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (pickingOpportunity) {
        const res = await crmGet<any[]>(
          `/api/opportunities${qs({
            page: 1, limit: PAGE_SIZE, search: debounced || undefined,
            sourcing: recruiterOnly ? true : undefined,
          })}`,
        );
        setOptions(
          (res.data || []).map((o) => ({
            id: o.id,
            title: o.title || `Opportunity #${o.id}`,
            subtitle: o.customer_name,
            meta: o.opp_id,
            positionsOpen: o.positions_open ?? null,
            positionsTotal: o.positions_total ?? null,
            stage: o.pipeline_stage ?? null,
            location: o.details?.tm_work_location ?? null,
          })),
        );
      } else {
        const res = await crmGet<any[]>(
          `/api/candidates${qs({ page: 1, limit: PAGE_SIZE, search: debounced || undefined })}`,
        );
        setOptions(
          (res.data || []).map((c) => ({
            id: c.id,
            title: c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || `#${c.id}`,
            subtitle: c.technical_domain || c.city,
            meta: c.experience_years != null ? `${c.experience_years} yrs` : null,
          })),
        );
      }
    } catch (e: any) {
      setError(e?.message || "Failed to search");
    } finally {
      setLoading(false);
    }
  }, [debounced, pickingOpportunity, recruiterOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const heading = pickingOpportunity ? "Apply to Opportunity" : "Add a Candidate";
  const subtitle = useMemo(
    () =>
      pickingOpportunity
        ? `Choose the opportunity to put ${candidateName || "this candidate"} forward for.`
        : `Choose the candidate to apply to ${opportunityLabel || "this opportunity"}.`,
    [pickingOpportunity, candidateName, opportunityLabel],
  );

  const apply = async () => {
    if (!selected) {
      setError(pickingOpportunity ? "Pick an opportunity first" : "Pick a candidate first");
      return;
    }
    setBusy(true);
    setError("");
    setDupProfile(null);
    try {
      const body = pickingOpportunity
        ? { candidate_id: candidateId, opportunity_id: selected.id }
        : { candidate_id: selected.id, opportunity_id: opportunityId };
      await crmPost("/api/candidate-profiles", body);
      onApplied(
        pickingOpportunity
          ? `Applied to ${selected.title}`
          : `${selected.title} applied to this opportunity`,
      );
      onClose();
    } catch (e: any) {
      // 409 = already applied. The server sends WHO applied and the profile id
      // (user decision, 25 Aug 2026) so a second TA sees the existing entry
      // instead of a dead-end message.
      const dup = duplicateProfileFromError(e);
      if (dup) {
        setDupProfile(dup);
        setError("");
      } else {
        const msg = String(e?.message || "");
        setError(
          /already exists|already applied/i.test(msg)
            ? pickingOpportunity
              ? "This candidate has already applied to that opportunity."
              : "That candidate has already applied to this opportunity."
            : msg || "Failed to apply",
        );
      }
      setBusy(false);
    }
  };

  const heroName = pickingOpportunity ? (candidateName || "this candidate") : (opportunityLabel || "this opportunity");

  return (
    <Modal title={heading} onClose={onClose} medium>
      <div className="space-y-4">
        {/* Hero — who (or what) is being applied. */}
        <div className="relative overflow-hidden rounded-card bg-gradient-to-r from-brand-700 via-indigo-700 to-violet-700 px-4 py-3.5 text-white">
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex items-center gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-bold ring-2 ring-white/40" aria-hidden>
              {pickingOpportunity ? initials(heroName) : <Briefcase size={18} />}
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/70">
                {pickingOpportunity ? "Putting forward" : "Adding a candidate to"}
              </div>
              <div className="truncate text-base font-bold">{heroName}</div>
              <p className="text-xs text-white/85">{subtitle}</p>
            </div>
          </div>
        </div>

        {pickingOpportunity && recruiterOnly && (
          <p className="flex items-center gap-1.5 rounded-control bg-info-soft px-3 py-2 text-xs font-medium text-info">
            <Sparkles size={13} aria-hidden /> Only opportunities open for sourcing are listed.
          </p>
        )}

        {error && <ErrorBox error={error} />}
        {dupProfile && <DuplicateProfileNotice dup={dupProfile} />}

        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            ref={inputRef}
            className={`${inputCls} !pl-9 !pr-9`}
            placeholder={pickingOpportunity ? "Search opportunities…" : "Search candidates by name, email or phone…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={pickingOpportunity ? "Search opportunities" : "Search candidates"}
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted hover:bg-surface-2 hover:text-primary">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="max-h-[22rem] overflow-y-auto rounded-card border border-subtle bg-surface-2">
          {(() => {
            const renderRow = (o: Option) => {
              const active = selected?.id === o.id;
              const hasPositions = o.positionsTotal != null && Number(o.positionsTotal) > 0;
              return (
                <li key={o.id} className="px-2 py-1">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => { setSelected(o); setDupProfile(null); setError(""); }}
                    className={`flex w-full items-start gap-3 rounded-control border px-3 py-2.5 text-left transition-colors ${
                      active
                        ? "border-brand-500 bg-surface-1 shadow-raised"
                        : "border-transparent hover:border-subtle hover:bg-surface-1"
                    }`}
                  >
                    {/* radio-style tick ring */}
                    <span
                      aria-hidden
                      className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                        active ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 dark:border-slate-600"
                      }`}
                    >
                      {active && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-muted" aria-hidden>
                          {pickingOpportunity ? <Briefcase size={14} /> : <UserRound size={14} />}
                        </span>
                        <span className="truncate text-sm font-semibold text-primary">{o.title}</span>
                        {o.engaged && (
                          <span className="shrink-0 rounded-full bg-danger-soft px-1.5 py-0.5 text-[10px] font-bold text-danger" title="Currently Joined / Preboarding on another opportunity">
                            engaged
                          </span>
                        )}
                      </span>
                      {pickingOpportunity ? (
                        <>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                            {o.subtitle && <span className="inline-flex items-center gap-1"><Building2 size={11} aria-hidden /> {o.subtitle}</span>}
                            {o.meta && <span className="font-mono">{o.meta}</span>}
                          </span>
                          {(hasPositions || o.stage || o.location) && (
                            <span className="mt-1.5 flex flex-wrap gap-1.5">
                              {hasPositions && (
                                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                  Number(o.positionsOpen ?? 0) > 0 ? "bg-brand-50 text-brand-700 dark:bg-brand-900 dark:text-brand-200" : "bg-success-soft text-success"}`}>
                                  <Users size={11} aria-hidden /> {Number(o.positionsOpen ?? 0)} of {o.positionsTotal} open
                                </span>
                              )}
                              {o.stage && (
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${stageTone(o.stage)}`}>
                                  {stageLabel(o.stage)}
                                </span>
                              )}
                              {o.location && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-surface-1 px-2 py-0.5 text-[11px] font-semibold text-secondary ring-1 ring-inset ring-subtle">
                                  <MapPin size={11} aria-hidden /> {o.location}
                                </span>
                              )}
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          {(o.subtitle || o.meta) && (
                            <span className="block truncate text-xs text-muted">
                              {[o.meta, o.subtitle].filter(Boolean).join(" · ")}
                            </span>
                          )}
                          {o.score != null && (o.matched?.length || o.missing?.length) ? (
                            <span className="mt-1.5 flex flex-wrap gap-1">
                              {(o.matched || []).slice(0, 4).map((m) => (
                                <span key={`m-${m}`} className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">{m}</span>
                              ))}
                              {(o.matched?.length || 0) > 4 && (
                                <span className="rounded-full bg-surface-1 px-2 py-0.5 text-[11px] text-muted ring-1 ring-inset ring-subtle">+{(o.matched?.length || 0) - 4}</span>
                              )}
                              {(o.missing || []).map((m) => (
                                <span key={`x-${m}`} className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger" title="Missing mandatory skill">missing: {m}</span>
                              ))}
                            </span>
                          ) : null}
                        </>
                      )}
                    </span>
                    {o.score != null && <MatchRing score={o.score} />}
                  </button>
                </li>
              );
            };
            const sectionHead = (label: string, count: number) => (
              <li className="sticky top-0 z-[1] flex items-center justify-between border-b border-subtle bg-surface-2 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-muted">
                <span>{label}</span>
                <span className="rounded-full bg-surface-1 px-2 py-0.5 font-semibold normal-case tracking-normal ring-1 ring-inset ring-subtle">{count}</span>
              </li>
            );
            const showSuggested = !pickingOpportunity;
            const nothing = !loading && otherOptions.length === 0 && (!showSuggested || visibleSuggested.length === 0);
            if (nothing) {
              return (
                <div className="flex flex-col items-center gap-2 p-8 text-center">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-surface-1 text-muted ring-1 ring-inset ring-subtle" aria-hidden>
                    {pickingOpportunity ? <Briefcase size={18} /> : <UserRound size={18} />}
                  </span>
                  <p className="max-w-sm text-sm text-muted">
                    {debounced
                      ? "Nothing matched that search."
                      : pickingOpportunity && recruiterOnly
                        ? "No opportunity is open for sourcing right now — it appears here once the Sales Head and RMG approve it."
                        : "No results."}
                  </p>
                </div>
              );
            }
            return (
              <ul role="listbox" aria-label={pickingOpportunity ? "Opportunities" : "Candidates"} className="pb-1">
                {showSuggested && suggested === null && (
                  <li className="px-4 py-2 text-xs text-muted">Finding matched candidates…</li>
                )}
                {showSuggested && visibleSuggested.length > 0 && (
                  <>
                    {sectionHead("Suggested — matched to this opportunity", visibleSuggested.length)}
                    {visibleSuggested.map(renderRow)}
                  </>
                )}
                {showSuggested
                  ? sectionHead("All candidates", otherOptions.length)
                  : sectionHead(recruiterOnly ? "Open for sourcing" : "Opportunities", otherOptions.length)}
                {loading ? (
                  <li className="p-4"><Spinner label="Searching…" /></li>
                ) : otherOptions.length === 0 ? (
                  <li className="px-4 py-2 text-xs text-muted">{debounced ? "No other candidates match." : "—"}</li>
                ) : (
                  otherOptions.map(renderRow)
                )}
              </ul>
            );
          })()}
        </div>

        {/* Selected summary + actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-subtle pt-3">
          <div className="min-w-0 flex-1 text-sm">
            {selected ? (
              <span className="flex min-w-0 items-center gap-2 text-secondary">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success-soft text-success" aria-hidden>
                  <Check size={13} strokeWidth={3} />
                </span>
                <span className="truncate">
                  Selected: <span className="font-semibold text-primary">{selected.title}</span>
                  {selected.meta && <span className="text-muted"> · {selected.meta}</span>}
                </span>
              </span>
            ) : (
              <span className="text-muted">
                {pickingOpportunity ? "Pick an opportunity above." : "Pick a candidate above."}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} onClick={apply} disabled={busy || !selected}>
              {busy ? "Applying…" : "Apply"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
