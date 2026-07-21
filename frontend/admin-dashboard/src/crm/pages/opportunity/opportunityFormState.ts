/**
 * Pure state logic for the type-driven Opportunity form. No React here — kept
 * pure so it is unit-testable and the renderer stays thin.
 *
 * Data model:
 *  - `core`    : fields common to every type (customer, title, rfi_value, ...).
 *  - `detailsByType`: type-specific field values, bucketed PER TYPE so switching
 *    type and switching back restores the previously entered values (spec Part 3).
 *  - `ctcSlab` / `skills` : repeating tables (always present).
 */
import {
  OPPORTUNITY_SCHEMA,
  OPPORTUNITY_TYPES,
  fieldVisible,
  sectionVisible,
  stripHiddenFields,
  type OpportunityType,
} from "./opportunitySchema";

/** Detail keys editable before an opportunity type is chosen (Customer Details block). */
const SHARED_DETAIL_KEYS = new Set<string>([
  "customer_type", "contact_email", "contact_phone",
  "hiring_manager_email", "hiring_manager_contact", "sales_stage",
]);

/** Shared customer-detail fields may live in any type bucket — merge them for display. */
function mergedSharedDetails(state: OpportunityFormState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of OPPORTUNITY_TYPES) {
    const bucket = state.detailsByType[t.value] || {};
    for (const key of SHARED_DETAIL_KEYS) {
      const v = bucket[key];
      if (v !== undefined && v !== "" && out[key] === undefined) out[key] = v;
    }
  }
  return out;
}

export function activeDetails(state: OpportunityFormState): Record<string, unknown> {
  const shared = mergedSharedDetails(state);
  if (!state.activeType) return shared;
  return { ...shared, ...(state.detailsByType[state.activeType] || {}) };
}

export interface OpportunityFormState {
  core: Record<string, unknown>;
  detailsByType: Partial<Record<OpportunityType, Record<string, unknown>>>;
  ctcSlab: Record<string, unknown>[];
  skills: Record<string, unknown>[];
  activeType: OpportunityType | "";
  isLoaded: boolean; // gate: autosave/submit must not run before this is true
  version: number; // optimistic concurrency (echoed back on save)
}

/** The set of DETAIL field keys (type-specific) — everything not a core field. */
const CORE_KEYS = new Set<string>([
  "customer_id", "branch_id", "contact_person_id", "hiring_manager_id",
  "title", "rfi_received_date", "opp_type", "rfi_value",
  "onboarded_count", "onboarding_status",
]);

export function isCoreKey(key: string): boolean {
  return CORE_KEYS.has(key);
}

export function emptyState(): OpportunityFormState {
  return { core: {}, detailsByType: {}, ctcSlab: [], skills: [], activeType: "", isLoaded: false, version: 1 };
}

/** Switch the active type WITHOUT discarding any per-type detail values. */
export function switchType(state: OpportunityFormState, next: OpportunityType): OpportunityFormState {
  // Ensure a bucket exists for the incoming type; the outgoing bucket is untouched.
  const detailsByType = { ...state.detailsByType };
  if (!detailsByType[next]) detailsByType[next] = {};
  return { ...state, activeType: next, detailsByType, core: { ...state.core, opp_type: next } };
}

/** Which of `next`'s detail fields would be LOST if we discard them (for the warn dialog). */
export function fieldsAtRiskOnSwitch(
  state: OpportunityFormState,
  from: OpportunityType,
): string[] {
  const bucket = state.detailsByType[from] || {};
  return Object.entries(bucket)
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    .map(([k]) => k);
}

/** Set a detail field value for the active type (or shared keys before type is chosen). */
export function setDetail(
  state: OpportunityFormState,
  key: string,
  value: unknown,
): OpportunityFormState {
  // Customer-detail fields are shared across all opportunity types — always
  // mirror them into every bucket so activeDetails never misses an email
  // written while a type was already selected.
  if (SHARED_DETAIL_KEYS.has(key)) {
    const detailsByType = { ...state.detailsByType };
    for (const t of OPPORTUNITY_TYPES) {
      detailsByType[t.value] = { ...(detailsByType[t.value] || {}), [key]: value };
    }
    return { ...state, detailsByType };
  }
  if (!state.activeType) return state;
  const t = state.activeType;
  const bucket = { ...(state.detailsByType[t] || {}), [key]: value };
  return { ...state, detailsByType: { ...state.detailsByType, [t]: bucket } };
}

/** Apply branch contact auto-fill (core ids + shared email/phone fields). */
export function applyBranchContactDetails(
  state: OpportunityFormState,
  fill: {
    contact_person_id: string;
    hiring_manager_id: string;
    contact_email: string;
    contact_phone: string;
    hiring_manager_email: string;
    hiring_manager_contact: string;
  },
): OpportunityFormState {
  let next: OpportunityFormState = {
    ...state,
    core: {
      ...state.core,
      contact_person_id: fill.contact_person_id,
      hiring_manager_id: fill.hiring_manager_id,
    },
  };
  next = setDetail(next, "contact_email", fill.contact_email);
  next = setDetail(next, "contact_phone", fill.contact_phone);
  next = setDetail(next, "hiring_manager_email", fill.hiring_manager_email);
  next = setDetail(next, "hiring_manager_contact", fill.hiring_manager_contact);
  return next;
}

/**
 * Build the payload to POST/PUT. Only the active type's details are sent, and only
 * keys valid for that type (hidden fields are NEVER submitted — spec Part 3).
 *
 * Coerces form-control strings into API types: empty optional ints/floats become
 * null (never ""), IDs become numbers, and incomplete skill rows are dropped.
 * Without this, FastAPI returns 422 on empty `rfi_value` / `hiring_manager_id`.
 */
export function buildSubmitPayload(state: OpportunityFormState): Record<string, unknown> {
  const type = state.activeType;
  const core = sanitizeCore(state.core);
  if (!type) {
    return {
      ...core,
      skills: sanitizeSkills(state.skills),
      ctc_slab: sanitizeCtcSlab(state.ctcSlab),
    };
  }
  const rawDetails = state.detailsByType[type] || {};
  const details = sanitizeDetails(
    stripHiddenFields(rawDetails as Record<string, unknown>, type) as Record<string, unknown>,
  );
  return {
    ...core,
    opp_type: type,
    details,
    skills: sanitizeSkills(state.skills),
    ctc_slab: sanitizeCtcSlab(state.ctcSlab),
  };
}

function emptyToNull(v: unknown): unknown {
  if (v === "" || v === undefined) return null;
  return v;
}

function toIntOrNull(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toFloatOrNull(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sanitizeCore(core: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...core };
  for (const k of ["customer_id", "branch_id", "contact_person_id", "hiring_manager_id", "onboarded_count"] as const) {
    if (k in out) out[k] = toIntOrNull(out[k]);
  }
  if ("rfi_value" in out) out.rfi_value = toFloatOrNull(out.rfi_value);
  if ("rfi_received_date" in out) out.rfi_received_date = emptyToNull(out.rfi_received_date);
  if ("onboarding_status" in out) out.onboarding_status = emptyToNull(out.onboarding_status);
  if ("title" in out && typeof out.title === "string") out.title = out.title.trim();
  // Create schema has no `version`; omit so FastAPI doesn't see an unknown field noise.
  delete out.version;
  delete out.opp_id;
  return out;
}

function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (v === "" || v === undefined) continue; // drop empties; server allow-list is for present keys
    out[k] = v;
  }
  return out;
}

function sanitizeSkills(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const r of rows || []) {
    const skillId = toIntOrNull(r.skill_id);
    if (skillId == null) continue;
    const level = toIntOrNull(r.required_level);
    out.push({
      skill_id: skillId,
      is_mandatory: !!r.is_mandatory,
      required_level: level,
      comment: emptyToNull(r.comment),
    });
  }
  return out;
}

function sanitizeCtcSlab(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const numericKeys = [
    "exp_min", "exp_max", "target_exp", "rate",
    "revenue_monthly", "revenue_annual", "management_cost_pct",
    "engineering_budget", "hike_pct", "approved_ctc_lac",
  ] as const;
  return (rows || [])
    .filter((r) => r && Object.values(r).some((v) => v !== "" && v != null))
    .map((r) => {
      const out: Record<string, unknown> = {};
      for (const key of numericKeys) out[key] = toFloatOrNull(r[key]);
      out.appraisal_cycle = emptyToNull(r.appraisal_cycle);
      return out;
    });
}

/** % of REQUIRED fields (for the active type) that are filled — drives the header bar. */
export function requiredProgress(state: OpportunityFormState): number {
  const type = state.activeType;
  let total = 0;
  let filled = 0;
  const has = (v: unknown) => v !== "" && v !== null && v !== undefined;
  for (const section of OPPORTUNITY_SCHEMA) {
    if (!sectionVisible(section, type)) continue;
    for (const f of section.fields || []) {
      if (!f.required) continue;
      if (!fieldVisible(section, f, type)) continue;
      total += 1;
      const val = isCoreKey(f.key) ? state.core[f.key] : (state.detailsByType[type as OpportunityType] || {})[f.key];
      if (has(val)) filled += 1;
    }
  }
  return total === 0 ? 0 : Math.round((filled / total) * 100);
}

/** Hydrate state from a loaded opportunity (edit mode). Sets isLoaded=true. */
export function hydrateFromServer(data: Record<string, any>): OpportunityFormState {
  const type = (data.opp_type || "") as OpportunityType | "";
  const core: Record<string, unknown> = {};
  for (const k of CORE_KEYS) if (k in data) core[k] = data[k];
  const detailsByType: OpportunityFormState["detailsByType"] = {};
  const rawDetails = { ...(data.details || {}) };
  if (type) {
    detailsByType[type] = rawDetails;
  } else if (Object.keys(rawDetails).length) {
    for (const t of OPPORTUNITY_TYPES) {
      detailsByType[t.value] = { ...rawDetails };
    }
  }
  return {
    core,
    detailsByType,
    ctcSlab: Array.isArray(data.ctc_slab) ? data.ctc_slab : [],
    skills: Array.isArray(data.skills) ? data.skills : [],
    activeType: type,
    isLoaded: true,
    version: Number(data.version || 1),
  };
}

/** Collect shared customer-detail fields for draft persistence. */
export function sharedDetailsForDraft(state: OpportunityFormState): Record<string, unknown> {
  if (state.activeType) return state.detailsByType[state.activeType] || {};
  const out: Record<string, unknown> = {};
  for (const t of OPPORTUNITY_TYPES) {
    const bucket = state.detailsByType[t.value] || {};
    for (const key of SHARED_DETAIL_KEYS) {
      if (bucket[key] !== undefined && bucket[key] !== "" && out[key] === undefined) {
        out[key] = bucket[key];
      }
    }
  }
  return out;
}
