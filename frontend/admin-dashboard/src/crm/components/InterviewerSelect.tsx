/**
 * "Who is taking this interview?" — an Employees picker for the round forms.
 *
 * The panel is an internal employee (1 Sep 2026, user request): a manual L1 is
 * run by whoever on the bench knows the stack, an L2 by RMG. Typing the name
 * by hand meant a different spelling on every round and no way to look one up,
 * so this searches the Employees master instead.
 *
 * The VALUE is still the plain name string the round stores, so nothing
 * downstream (the round card, the candidate's invite email, the .ics) changes.
 * Names come from GET /api/employees/interviewer-names — a narrow endpoint TA
 * can read; the full Employees list is HR/Finance/Sales/RMG only and 403'd
 * here, which is what left this dropdown empty for TA.
 */
import React from "react";
import { SearchableSelect } from "./SearchableSelect";
import { crmGet } from "../api";

export type InterviewerOption = {
  id: number;
  name: string;
  email?: string | null;
  designation?: string | null;
};

/** Module-level cache: the list is small, static within a session, and every
 *  round modal would otherwise refetch it on open. */
let cache: InterviewerOption[] | null = null;
let inflight: Promise<InterviewerOption[]> | null = null;

function loadInterviewers(): Promise<InterviewerOption[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = crmGet<InterviewerOption[]>("/api/employees/interviewer-names")
      .then((r) => { cache = r.data || []; return cache; })
      .catch(() => [])          // never block scheduling on a lookup failure
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function InterviewerSelect({
  value,
  onChange,
  placeholder = "Search employee by name…",
  disabled,
  err,
}: {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  disabled?: boolean;
  err?: string;
}) {
  const [people, setPeople] = React.useState<InterviewerOption[]>(cache || []);
  React.useEffect(() => {
    let alive = true;
    void loadInterviewers().then((rows) => { if (alive) setPeople(rows); });
    return () => { alive = false; };
  }, []);

  const options = React.useMemo(() => {
    const seen = new Set<string>();
    const out = people
      // The stored value is the NAME, so two employees who share one would be
      // indistinguishable — keep the first and let the designation label
      // disambiguate visually.
      .filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)))
      .map((p) => ({
        value: p.name,
        label: p.designation ? `${p.name} — ${p.designation}` : p.name,
      }));
    // A name already on the round (or typed before this picker existed) must
    // stay selectable, even if that person has since been deactivated.
    if (value && !seen.has(value)) out.unshift({ value, label: value });
    return out;
  }, [people, value]);

  return (
    <SearchableSelect
      value={value}
      options={options}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      err={err}
      searchable
    />
  );
}
