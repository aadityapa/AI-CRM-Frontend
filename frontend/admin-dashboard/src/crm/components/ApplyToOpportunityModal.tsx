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
import { Briefcase, Check, Search, UserRound } from "lucide-react";
import { crmGet, crmPost, qs } from "../api";
import { DuplicateProfileNotice, duplicateProfileFromError } from "./DuplicateProfileNotice";
import type { DuplicateProfile } from "./DuplicateProfileNotice";
import {
  ErrorBox, Modal, Spinner, btnPrimary, btnSecondary, inputCls,
} from "./ui";

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
};

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
          `/api/opportunities${qs({ page: 1, limit: PAGE_SIZE, search: debounced || undefined })}`,
        );
        setOptions(
          (res.data || []).map((o) => ({
            id: o.id,
            title: o.title || `Opportunity #${o.id}`,
            subtitle: o.customer_name,
            meta: o.opp_id,
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
  }, [debounced, pickingOpportunity]);

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

  return (
    <Modal title={heading} onClose={onClose} medium>
      <div className="space-y-4">
        <p className="text-sm text-muted">{subtitle}</p>

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
            className={`${inputCls} !pl-9`}
            placeholder={pickingOpportunity ? "Search opportunities…" : "Search candidates by name, email or phone…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={pickingOpportunity ? "Search opportunities" : "Search candidates"}
          />
        </div>

        <div className="max-h-80 overflow-y-auto rounded-xl border border-subtle bg-surface-2">
          {(() => {
            const renderRow = (o: Option) => {
              const active = selected?.id === o.id;
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => { setSelected(o); setDupProfile(null); setError(""); }}
                    className={`flex w-full items-center gap-3 border-b border-subtle px-4 py-2.5 text-left last:border-b-0 transition-colors ${
                      active ? "bg-surface-1" : "hover:bg-surface-1"
                    }`}
                  >
                    <span className="text-muted" aria-hidden>
                      {pickingOpportunity ? <Briefcase size={15} /> : <UserRound size={15} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-primary">{o.title}</span>
                        {o.engaged && (
                          <span className="shrink-0 rounded-full bg-danger-soft px-1.5 py-0.5 text-[10px] font-bold text-danger" title="Currently Joined / Preboarding on another opportunity">
                            engaged
                          </span>
                        )}
                      </span>
                      {(o.subtitle || o.meta) && (
                        <span className="block truncate text-xs text-muted">
                          {[o.meta, o.subtitle].filter(Boolean).join(" · ")}
                        </span>
                      )}
                      {o.score != null && (o.matched?.length || o.missing?.length) ? (
                        <span className="block truncate text-[11px] text-muted">
                          {o.matched && o.matched.length > 0 && <>matches: {o.matched.slice(0, 4).join(", ")}{o.matched.length > 4 ? "…" : ""}</>}
                          {o.missing && o.missing.length > 0 && <span className="text-danger"> · missing: {o.missing.join(", ")}</span>}
                        </span>
                      ) : null}
                    </span>
                    {o.score != null && (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${scoreTone(o.score)}`} title="Skills / experience match">
                        {o.score}%
                      </span>
                    )}
                    {active && <Check size={16} className="shrink-0 text-success" aria-hidden />}
                  </button>
                </li>
              );
            };
            const sectionHead = (label: string, count: number) => (
              <li className="sticky top-0 z-[1] border-b border-subtle bg-surface-2 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
                {label} <span className="font-medium normal-case tracking-normal">({count})</span>
              </li>
            );
            const showSuggested = !pickingOpportunity;
            const nothing = !loading && otherOptions.length === 0 && (!showSuggested || visibleSuggested.length === 0);
            if (nothing) {
              return (
                <p className="p-6 text-center text-sm text-muted">
                  {debounced ? "Nothing matched that search." : "No results."}
                </p>
              );
            }
            return (
              <ul role="listbox" aria-label={pickingOpportunity ? "Opportunities" : "Candidates"}>
                {showSuggested && suggested === null && (
                  <li className="px-4 py-2 text-xs text-muted">Finding matched candidates…</li>
                )}
                {showSuggested && visibleSuggested.length > 0 && (
                  <>
                    {sectionHead("Suggested — matched to this opportunity", visibleSuggested.length)}
                    {visibleSuggested.map(renderRow)}
                  </>
                )}
                {showSuggested && sectionHead("All candidates", otherOptions.length)}
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

        {selected && (
          <p className="text-sm text-secondary">
            Selected: <span className="font-semibold text-primary">{selected.title}</span>
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={apply} disabled={busy || !selected}>
            {busy ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
