/**
 * Directory filter state, backed by the URL.
 *
 * Previously every filter lived in `useState`, which meant a refresh threw the
 * view away and there was no way to send a colleague "the 12 people awaiting
 * review on this role". Filters are now query params, so a filtered view is
 * just a link.
 *
 * This app uses its own tiny query-string router (`?view=crm&p=<path>`) rather
 * than React Router, so the params are read and written directly and a
 * `popstate` listener keeps state in sync with Back/Forward.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

export type ProfileFilters = {
  /** "archive" (6 Oct 2026) = archived by hand, or parked because the deal is on hold. */
  bucket: "active" | "rejected" | "archive";
  /** The stage strip (29 Sep 2026): a `services/candidate_status.STAGES` key, sent as `phase`. */
  phase: string;
  /** Derived candidate-status keys, CSV (sent as `status_key`). */
  status: string;
  opportunityId: string;
  taOwnerId: string;
  customerId: string;
  appliedFrom: string;
  appliedTo: string;
  source: string;
  search: string;
  page: number;
};

const DEFAULTS: ProfileFilters = {
  bucket: "active",
  phase: "",
  status: "",
  opportunityId: "",
  taOwnerId: "",
  customerId: "",
  appliedFrom: "",
  appliedTo: "",
  source: "",
  search: "",
  page: 1,
};

/** Prefixed so these cannot collide with the router's own `view`/`p` params. */
const PARAM = {
  bucket: "f_bucket",
  phase: "f_stage",
  // "f_state", not the old "f_status" (25 Sep 2026): the value is now a
  // derived candidate-status key, and a bookmark carrying a stage name must
  // not turn into a 400 — the old param is simply ignored.
  status: "f_state",
  opportunityId: "f_opp",
  taOwnerId: "f_ta",
  customerId: "f_cust",
  appliedFrom: "f_from",
  appliedTo: "f_to",
  source: "f_src",
  search: "f_q",
  page: "f_page",
} as const;

function read(): ProfileFilters {
  if (typeof window === "undefined") return { ...DEFAULTS };
  const p = new URLSearchParams(window.location.search);
  const bucket = p.get(PARAM.bucket);
  const page = Number(p.get(PARAM.page));
  return {
    bucket: bucket === "rejected" || bucket === "archive" ? bucket : "active",
    phase: p.get(PARAM.phase) || "",
    status: p.get(PARAM.status) || "",
    opportunityId: p.get(PARAM.opportunityId) || "",
    taOwnerId: p.get(PARAM.taOwnerId) || "",
    customerId: p.get(PARAM.customerId) || "",
    appliedFrom: p.get(PARAM.appliedFrom) || "",
    appliedTo: p.get(PARAM.appliedTo) || "",
    source: p.get(PARAM.source) || "",
    search: p.get(PARAM.search) || "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Only non-default values are written, so a clean view has a clean URL. */
function write(next: ProfileFilters, replace: boolean) {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams(window.location.search);
  (Object.keys(PARAM) as (keyof typeof PARAM)[]).forEach((key) => {
    const value = next[key];
    const isDefault = value === DEFAULTS[key];
    if (isDefault || value === "" || value === undefined) p.delete(PARAM[key]);
    else p.set(PARAM[key], String(value));
  });
  const url = `${window.location.pathname}?${p.toString()}${window.location.hash}`;
  // replaceState while typing so the Back button does not have to walk through
  // every keystroke; pushState for deliberate filter changes.
  if (replace) window.history.replaceState({}, "", url);
  else window.history.pushState({}, "", url);
}

export function useProfileFilters() {
  const [filters, setFilters] = useState<ProfileFilters>(read);

  // Back/Forward must move between filter views, not just between pages.
  useEffect(() => {
    const onPop = () => setFilters(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const update = useCallback((patch: Partial<ProfileFilters>, opts?: { replace?: boolean }) => {
    setFilters((prev) => {
      // Any filter change resets to page 1 — staying on page 4 of a narrower
      // result set is the classic "why is this empty?" bug.
      const changedFilter = Object.keys(patch).some((k) => k !== "page");
      const next: ProfileFilters = { ...prev, ...patch, ...(changedFilter && patch.page === undefined ? { page: 1 } : {}) };
      write(next, opts?.replace ?? false);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setFilters(() => {
      const next = { ...DEFAULTS };
      write(next, false);
      return next;
    });
  }, []);

  /** True when anything is narrowing the list — drives "Clear all" visibility. */
  const isFiltered = useMemo(
    () =>
      filters.status !== "" ||
      filters.phase !== "" ||
      filters.opportunityId !== "" ||
      filters.taOwnerId !== "" ||
      filters.customerId !== "" ||
      filters.appliedFrom !== "" ||
      filters.appliedTo !== "" ||
      filters.source !== "" ||
      filters.search !== "" ||
      filters.bucket !== "active",
    [filters],
  );

  return { filters, update, clearAll, isFiltered };
}
