/**
 * The customers a NEW record may be raised for (12 Oct 2026).
 *
 * Reported with a screenshot: New Project's Customer dropdown listed every
 * customer ever imported, while the Customers tab (default "Active") lists a
 * handful. Every picker that STARTS a record (project, PO, received amount,
 * opportunity) now reads the same list the Customers tab shows:
 * `GET /api/customers/names?status=Active` — the names endpoint is open to every
 * CRM role, so a GM / Finance login gets it too (the full /api/customers is
 * gated to the Customers tab).
 *
 * Editing an existing record whose customer has since been made inactive must
 * not blank the field, so the record's own customer is added back, marked
 * "(inactive)".
 *
 * List FILTERS and reports keep the bare `/api/customers/names` — history
 * refers to inactive customers too.
 */
import { useEffect, useMemo, useState } from "react";

import { crmGet } from "../api";

export type CustomerName = { id: number; name: string; status?: string };

let activePromise: Promise<CustomerName[]> | null = null;
let allPromise: Promise<CustomerName[]> | null = null;

function load(path: string): Promise<CustomerName[]> {
  return crmGet<CustomerName[]>(path).then((r) =>
    (r.data || [])
      .map((c) => ({ id: Number(c.id), name: String(c.name), status: c.status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
}

/** Active customers — the Customers tab's default list. One request per page load. */
export function fetchActiveCustomers(): Promise<CustomerName[]> {
  if (!activePromise) {
    activePromise = load("/api/customers/names?status=Active").catch((e) => {
      activePromise = null;                 // retry next time
      throw e;
    });
  }
  return activePromise;
}

function fetchAllCustomers(): Promise<CustomerName[]> {
  if (!allPromise) {
    allPromise = load("/api/customers/names").catch((e) => {
      allPromise = null;
      throw e;
    });
  }
  return allPromise;
}

/** Forget the cached lists (after a customer is created / activated). */
export function resetCustomerCache(): void {
  activePromise = null;
  allPromise = null;
}

/**
 * PURE: the active list, plus the record's own customer when it is not active
 * (labelled "(inactive)"), so an edit never loses its value.
 */
export function withCurrentCustomer(
  active: CustomerName[], all: CustomerName[], currentId?: number | string | null,
): CustomerName[] {
  const id = Number(currentId);
  if (!currentId || !Number.isFinite(id) || active.some((c) => c.id === id)) return active;
  const found = all.find((c) => c.id === id);
  if (!found) return active;
  return [...active, { ...found, name: `${found.name} (inactive)` }];
}

/**
 * Active customers for a picker. `currentId` = the customer already on the
 * record (edit mode); `includeInactive` lists everyone (e.g. money still owed
 * by a customer made inactive).
 */
export function useActiveCustomers(
  currentId?: number | string | null,
  opts: { includeInactive?: boolean } = {},
): CustomerName[] {
  const [active, setActive] = useState<CustomerName[]>([]);
  const [all, setAll] = useState<CustomerName[]>([]);
  const needAll = !!opts.includeInactive || !!currentId;

  useEffect(() => {
    let alive = true;
    fetchActiveCustomers().then((r) => { if (alive) setActive(r); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!needAll) return;
    let alive = true;
    fetchAllCustomers().then((r) => { if (alive) setAll(r); }).catch(() => {});
    return () => { alive = false; };
  }, [needAll]);

  return useMemo(() => {
    if (opts.includeInactive && all.length) {
      return all.map((c) => (c.status && c.status !== "Active" ? { ...c, name: `${c.name} (inactive)` } : c));
    }
    return withCurrentCustomer(active, all, currentId);
  }, [active, all, currentId, opts.includeInactive]);
}
