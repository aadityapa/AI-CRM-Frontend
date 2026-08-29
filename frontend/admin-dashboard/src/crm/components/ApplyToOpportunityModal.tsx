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
import { CrmLink } from "../routerHooks";
import {
  ErrorBox, Modal, Spinner, btnPrimary, btnSecondary, inputCls,
} from "./ui";

type Mode = "pick-opportunity" | "pick-candidate";

type Option = {
  id: number;
  title: string;
  subtitle?: string | null;
  meta?: string | null;
};

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Structured 409: who already applied this candidate, with the profile link. */
  const [dupProfile, setDupProfile] = useState<{
    profile_id: number; candidate_name?: string; applied_by?: string | null;
    applied_on?: string | null; pipeline_status?: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
      const payload = (e?.errors || []).find((x: any) => x && typeof x === "object" && x.duplicate_profile);
      if (payload) {
        setDupProfile(payload.duplicate_profile);
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
        {dupProfile && (
          <div className="rounded-card border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
            <div className="font-bold">Already applied to this opportunity</div>
            <div className="mt-1">
              <b>{dupProfile.candidate_name || "This candidate"}</b> was applied
              {dupProfile.applied_by ? <> by <b>{dupProfile.applied_by}</b></> : null}
              {dupProfile.applied_on ? <> on {new Date(dupProfile.applied_on).toLocaleDateString()}</> : null}
              {dupProfile.pipeline_status ? <> — currently at {String(dupProfile.pipeline_status).replace(/_/g, " ")}</> : null}.
            </div>
            <div className="mt-1.5">
              <CrmLink to={`profiles/${dupProfile.profile_id}`} className="font-semibold underline">
                Open the existing profile →
              </CrmLink>
            </div>
          </div>
        )}

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

        <div className="max-h-72 overflow-y-auto rounded-xl border border-subtle bg-surface-2">
          {loading ? (
            <div className="p-6">
              <Spinner label="Searching…" />
            </div>
          ) : options.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted">
              {debounced ? "Nothing matched that search." : "No results."}
            </p>
          ) : (
            <ul role="listbox" aria-label={pickingOpportunity ? "Opportunities" : "Candidates"}>
              {options.map((o) => {
                const active = selected?.id === o.id;
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => setSelected(o)}
                      className={`flex w-full items-center gap-3 border-b border-subtle px-4 py-2.5 text-left last:border-b-0 transition-colors ${
                        active ? "bg-surface-1" : "hover:bg-surface-1"
                      }`}
                    >
                      <span className="text-muted" aria-hidden>
                        {pickingOpportunity ? <Briefcase size={15} /> : <UserRound size={15} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-primary">
                          {o.title}
                        </span>
                        {(o.subtitle || o.meta) && (
                          <span className="block truncate text-xs text-muted">
                            {[o.meta, o.subtitle].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </span>
                      {active && <Check size={16} className="shrink-0 text-success" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
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
