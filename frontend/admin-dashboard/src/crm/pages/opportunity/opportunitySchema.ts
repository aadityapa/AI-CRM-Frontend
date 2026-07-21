/**
 * KARNEX — declarative schema for the New/Edit Opportunity form.
 *
 * ONE schema drives the whole form (Part 3 of the spec). A single <FormRenderer>
 * reads this; there is no per-type form component. Adding a 5th Opportunity Type
 * later means editing THIS file only.
 *
 * Visibility is type-driven. `visibleFor` lists the OpportunityTypes a section or
 * field appears for; omit it to mean "always visible". Fields hidden by the active
 * type are NOT rendered, NOT validated, and NOT submitted (the renderer strips
 * them, and the server re-derives the same schema for the same type — never trust
 * the client).
 *
 * Ambiguities (resolved from the codebase, flagged in the delivery summary):
 *  - Opportunity ID is SYSTEM-GENERATED (backend next_sequence_number → OPP-YYYY-NNN);
 *    modelled read-only.
 *  - Fixed_Price === Work_Package structurally (screenshots identical).
 *  - Candidate CTC revenue fields are derived by the shared CTC calculator.
 *  - Dates: store ISO/UTC, display dd-MMM-yyyy.
 */

export type OpportunityType = "T&M" | "Work_Package" | "Fixed_Price" | "Retainer";

export const OPPORTUNITY_TYPES: { value: OpportunityType; label: string }[] = [
  { value: "T&M", label: "Time & Material" },
  { value: "Work_Package", label: "Work Package" },
  { value: "Fixed_Price", label: "Fixed Price" },
  { value: "Retainer", label: "Retainer" },
];

export type FieldType =
  | "text"
  | "email"
  | "tel"
  | "number"
  | "currency"
  | "percent"
  | "date"
  | "select"
  | "file" // Customer JD / local file pickers (uploaded with opportunity)
  | "textarea"
  | "richtext" // Project Scope
  | "checkbox"
  | "readonly"; // display-only (e.g. Opportunity ID, auto-filled mirrors)

/** Default Role options (T&M). Users can add more via the "+" control. */
export const ROLE_OPTIONS = [
  { value: "Jr. Engineer", label: "Jr. Engineer" },
  { value: "Engineer", label: "Engineer" },
  { value: "Senior Engineer", label: "Senior Engineer" },
];

export const WORK_LOCATION_OPTIONS = [
  { value: "Bangalore", label: "Bangalore" },
  { value: "Mumbai", label: "Mumbai" },
  { value: "Pune", label: "Pune" },
  { value: "Delhi", label: "Delhi" },
  { value: "Gurgaon", label: "Gurgaon" },
  { value: "Noida", label: "Noida" },
  { value: "Hyderabad", label: "Hyderabad" },
  { value: "Chennai", label: "Chennai" },
  { value: "Kolkata", label: "Kolkata" },
  { value: "Ahmedabad", label: "Ahmedabad" },
  { value: "Jaipur", label: "Jaipur" },
  { value: "Chandigarh", label: "Chandigarh" },
  { value: "Kochi", label: "Kochi" },
  { value: "Coimbatore", label: "Coimbatore" },
  { value: "Indore", label: "Indore" },
  { value: "Nagpur", label: "Nagpur" },
  { value: "Thiruvananthapuram", label: "Thiruvananthapuram" },
  { value: "Mysore", label: "Mysore" },
  { value: "Visakhapatnam", label: "Visakhapatnam" },
  { value: "Bhubaneswar", label: "Bhubaneswar" },
  { value: "Lucknow", label: "Lucknow" },
  { value: "Vadodara", label: "Vadodara" },
  { value: "Nashik", label: "Nashik" },
  { value: "Remote", label: "Remote" },
];

export const WFO_REMOTE_OPTIONS = [
  { value: "Remote", label: "Remote" },
  { value: "Onsite", label: "Onsite" },
  { value: "Hybrid", label: "Hybrid" },
];

export const BILLING_TYPE_OPTIONS = [
  { value: "Per Hour", label: "Per Hour" },
  { value: "Per Day", label: "Per Day" },
  { value: "Per Month", label: "Per Month" },
  { value: "Per Year", label: "Per Year" },
];

export const LEAVE_POLICY_OPTIONS = [
  { value: "Credit Balance Every Month", label: "Credit Balance Every Month" },
  { value: "Carry Forward Every Month", label: "Carry Forward Every Month" },
];

export const APPRAISAL_CYCLE_OPTIONS = [
  { value: "Annual", label: "Annual" },
  { value: "Semi-Annual", label: "Semi-Annual" },
  { value: "Quarterly", label: "Quarterly" },
];

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Grid span in the 2-column layout (default 1). */
  colSpan?: 1 | 2;
  /** Only render for these types; omit = all types. */
  visibleFor?: OpportunityType[];
  /** Default value (strings/numbers/bools as appropriate). */
  default?: string | number | boolean;
  /** Options source for selects: a static list or a named async loader. */
  options?: { value: string; label: string }[];
  optionsSource?:
    | "customers"
    | "branches"
    | "contacts"
    | "hiringManagers"
    | "skills"
    | "customerTypes"
    | "salesStages"
    | "leavePolicy"
    | "billingType"
    | "positionType"
    | "role"
    | "workLocation"
    | "wfoRemote"
    | "onboardingStatus"
    | "appraisalCycle";
  /** Auto-populated from another entity; editable but badged "auto-filled". */
  autoFilledFrom?: "customer" | "contact" | "hiringManager";
  /** Field is disabled until this other field has a value (dependency, with reason). */
  dependsOn?: { field: string; hint: string };
  /** Show a "+" affordance next to this select to create a new master inline. */
  addNew?: "customer" | "branch" | "contact" | "hiringManager" | "role";
  /** Derived/computed read-only cell. */
  computed?: { from: string[]; formula: "monthlyTimes12" | "ctcDerive" };
  /** For type=file: allow multiple files. */
  multiple?: boolean;
  /** Accept attribute for file inputs. */
  accept?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  helperText?: string;
  /** For the guided flow: the next field to auto-advance focus to on satisfy. */
  next?: string;
  /** Render a filterable combobox instead of a native <select>. */
  searchable?: boolean;
}

export interface TableColumnDef extends Omit<FieldDef, "next"> {}

export interface SectionDef {
  key: string;
  title: string;
  /** Only render for these types; omit = all types. */
  visibleFor?: OpportunityType[];
  /** Never render for these types (takes precedence over visibleFor). */
  hiddenFor?: OpportunityType[];
  /** A section can gate ITS FIELDS by type while the header still shows.
   *  Leave & Holiday shows full fields only for T&M; header-only otherwise. */
  fieldsVisibleFor?: OpportunityType[];
  /** Progressive disclosure: section stays collapsed until these fields are filled. */
  prerequisiteFields?: string[];
  fields?: FieldDef[];
  /** Repeating-row table sections (CTC Slab, Skills). */
  table?: {
    columns: TableColumnDef[];
    addLabel: string;
    emptyIcon?: string;
    emptyLabel: string;
  };
  /** Special renderers. */
  kind?: "fields" | "table" | "attachments" | "activityLog";
  readOnly?: boolean;
}

// Re-export for consumers that import from schema; prefer ../lib/customerType for logic.
export { customerTypeOptionsForPo, normalizeCustomerType } from "../../lib/customerType";

export const CUSTOMER_TYPE_OPTIONS = [
  { value: "NN", label: "NN — New customer (no PO yet)" },
  { value: "EN", label: "EN — Existing, new domain/branch" },
  { value: "EE", label: "EE — Existing customer" },
];

export const SALES_STAGE_OPTIONS = [
  { value: "Sales Validation", label: "Sales Validation" },
  { value: "Sales Verify", label: "Sales Verify" },
];

export const ONBOARDING_STATUS_OPTIONS = [
  { value: "Sales Validation", label: "Sales Validation" },
  { value: "Sourcing", label: "Sourcing" },
  { value: "Interviewing", label: "Interviewing" },
  { value: "Offered", label: "Offered" },
  { value: "Onboarded", label: "Onboarded" },
  { value: "Closed", label: "Closed" },
];

/* ----------------------------------------------------------------- sections */

export const OPPORTUNITY_SCHEMA: SectionDef[] = [
  // ---- Customer Details (always) — 2-column layout per reference screenshot ---
  {
    key: "customerDetails",
    title: "Customer Details",
    kind: "fields",
    fields: [
      { key: "customer_id", label: "Customer", type: "select", required: true, optionsSource: "customers",
        addNew: "customer", searchable: true, next: "branch_id" },
      { key: "branch_id", label: "Branch", type: "select", required: true, optionsSource: "branches",
        dependsOn: { field: "customer_id", hint: "Select a customer first." }, next: "contact_person_id" },
      { key: "contact_person_id", label: "Contact Person", type: "select", required: true, optionsSource: "contacts",
        dependsOn: { field: "branch_id", hint: "Select a branch first." }, next: "contact_email" },
      { key: "contact_email", label: "Contact Email", type: "email", required: true, autoFilledFrom: "contact", next: "contact_phone" },
      { key: "contact_phone", label: "Contact Phone", type: "tel", autoFilledFrom: "contact", next: "customer_type" },
      { key: "customer_type", label: "Customer Type", type: "select", required: true, optionsSource: "customerTypes",
        autoFilledFrom: "customer", next: "hiring_manager_id" },
      { key: "hiring_manager_id", label: "Hiring Manager", type: "select", optionsSource: "hiringManagers",
        dependsOn: { field: "branch_id", hint: "Select a branch first." }, next: "hiring_manager_email" },
      { key: "hiring_manager_email", label: "Hiring Manager Email", type: "email", autoFilledFrom: "hiringManager", next: "hiring_manager_contact" },
      { key: "hiring_manager_contact", label: "Hiring Manager Contact", type: "tel", autoFilledFrom: "hiringManager" },
    ],
  },

  // ---- RFI Details (always) -------------------------------------------------
  {
    key: "rfiDetails",
    title: "RFI Details",
    kind: "fields",
    prerequisiteFields: ["customer_id", "branch_id", "contact_person_id"],
    fields: [
      { key: "title", label: "Opportunity Title", type: "text", required: true, next: "rfi_received_date" },
      { key: "rfi_received_date", label: "Received Date", type: "date", required: true,
        placeholder: "dd-MMM-yyyy", helperText: "Format: dd-MMM-yyyy", next: "opp_type" },
      { key: "opp_type", label: "Opportunity Type", type: "select", required: true,
        options: OPPORTUNITY_TYPES.map((t) => ({ value: t.value, label: t.label })), next: "opp_id" },
      { key: "opp_id", label: "Opportunity ID", type: "readonly", helperText: "Auto-generated on save." },
    ],
  },

  // ---- Time & Material Details (T&M only) -----------------------------------
  {
    key: "timeAndMaterial",
    title: "Time & Material Details",
    visibleFor: ["T&M"],
    kind: "fields",
    fields: [
      { key: "tm_position_title", label: "Position Title", type: "text", next: "tm_positions_count" },
      { key: "tm_positions_count", label: "Positions (Count)", type: "number", min: 1, next: "tm_exp_min" },
      { key: "tm_exp_min", label: "Exp. Min", type: "number", min: 0, next: "tm_exp_max" },
      { key: "tm_exp_max", label: "Exp. Max", type: "number", min: 0, next: "tm_notice_period" },
      { key: "tm_notice_period", label: "Notice Period", type: "text", next: "tm_closing_date" },
      { key: "tm_closing_date", label: "Closing Date", type: "date", next: "tm_position_type" },
      { key: "tm_position_type", label: "Position Type", type: "select",
        options: [{ value: "New", label: "New" }, { value: "Replacement", label: "Replacement" }],
        next: "tm_duration_months" },
      { key: "tm_duration_months", label: "Duration (In Month)", type: "number", min: 0, next: "tm_jd_attachments" },
      { key: "tm_jd_attachments", label: "Customer JD Attachments", type: "file", multiple: true,
        accept: ".pdf,.doc,.docx",
        helperText: "Upload the customer job description (PDF/DOC). Also available under Attachments for all types.", next: "tm_role" },
      { key: "tm_role", label: "Role", type: "select", options: ROLE_OPTIONS, optionsSource: "role",
        addNew: "role", next: "tm_work_location" },
      { key: "tm_work_location", label: "Work Location", type: "select", required: true,
        options: WORK_LOCATION_OPTIONS, optionsSource: "workLocation", searchable: true,
        next: "tm_wfo_remote" },
      { key: "tm_wfo_remote", label: "WFO/Remote", type: "select",
        options: WFO_REMOTE_OPTIONS, optionsSource: "wfoRemote", visibleFor: ["T&M"] },
    ],
  },

  // ---- Leave & Holiday Details ----------------------------------------------
  // Full fields for T&M; header-only for the other types (matches screenshots).
  {
    key: "leaveHoliday",
    title: "Leave & Holiday Details",
    kind: "fields",
    fieldsVisibleFor: ["T&M"],
    fields: [
      { key: "holidays_billable", label: "Holidays Billable", type: "checkbox", visibleFor: ["T&M"] },
      { key: "weekoff_billable", label: "Weekoff Billable", type: "checkbox", visibleFor: ["T&M"] },
      { key: "leave_billable", label: "Leave Billable", type: "checkbox", visibleFor: ["T&M"] },
      { key: "credit_leave_monthly", label: "Credit Leave Monthly", type: "number", visibleFor: ["T&M"] },
      { key: "leave_policy", label: "Leave Policy", type: "select", optionsSource: "leavePolicy", visibleFor: ["T&M"] },
      { key: "holidays", label: "Holidays", type: "number", default: 10.0, visibleFor: ["T&M"] },
      { key: "weekoff", label: "Weekoff", type: "number", default: 104.0, visibleFor: ["T&M"] },
      { key: "leave", label: "Leave", type: "number", default: 24.0, visibleFor: ["T&M"] },
    ],
  },

  // ---- Commercial Details ---------------------------------------------------
  // Full for T&M; RFI Value only for Work Package / Fixed Price / Retainer.
  {
    key: "commercial",
    title: "Commercial Details",
    kind: "fields",
    fields: [
      { key: "billing_type", label: "Billing Type", type: "select",
        options: BILLING_TYPE_OPTIONS, optionsSource: "billingType", visibleFor: ["T&M"] },
      { key: "hours_per_day", label: "Hours Per Day", type: "number", default: 8, visibleFor: ["T&M"] },
      { key: "actual_billing_days", label: "Actual Billing Days", type: "readonly", default: 227.0, visibleFor: ["T&M"],
        helperText: "Auto = 365 − non-billable weekoffs, holidays and leave." },
      { key: "actual_billing_hours", label: "Actual Billing Hours", type: "readonly", default: 1816.0, visibleFor: ["T&M"],
        helperText: "Auto = Actual Billing Days × Hours Per Day." },
      { key: "rfi_value", label: "RFI Value", type: "currency", placeholder: "#######.##", min: 0 }, // all types
    ],
  },

  // ---- Candidate CTC Slab (all opportunity types) ---------------------------
  {
    key: "ctcSlab",
    title: "Candidate CTC Slab",
    kind: "table",
    table: {
      addLabel: "Add New",
      emptyLabel: "Add your first Candidate CTC slab",
      columns: [
        { key: "exp_min", label: "Exp Min (Year)", type: "number", min: 0 },
        { key: "exp_max", label: "Exp Max (Year)", type: "number", min: 0,
          computed: { from: ["exp_min", "target_exp"], formula: "ctcDerive" } },
        { key: "target_exp", label: "Target Exp.", type: "number", min: 0 },
        { key: "rate", label: "Rate", type: "currency", min: 0 },
        { key: "revenue_monthly", label: "Revenue (Monthly)", type: "currency",
          computed: { from: ["rate", "billing_type"], formula: "ctcDerive" } },
        { key: "revenue_annual", label: "Revenue (Annual)", type: "currency",
          computed: { from: ["revenue_monthly"], formula: "monthlyTimes12" } },
        { key: "management_cost_pct", label: "Management Cost %", type: "percent", min: 0, max: 100 },
        { key: "engineering_budget", label: "Engineering Budget", type: "currency",
          computed: { from: ["revenue_annual", "management_cost_pct"], formula: "ctcDerive" } },
        { key: "hike_pct", label: "Hike %", type: "percent", min: 0 },
        { key: "appraisal_cycle", label: "Appraisal Cycle", type: "select", optionsSource: "appraisalCycle" },
        { key: "approved_ctc_lac", label: "Approved CTC [Lac]", type: "currency",
          computed: { from: ["engineering_budget", "hike_pct"], formula: "ctcDerive" } },
      ],
    },
  },

  // ---- Work Page Details ----------------------------------------------------
  // Non-T&M contract inputs; T&M keeps these hidden.
  {
    key: "workPage",
    title: "Work Page Details",
    kind: "fields",
    fields: [
      { key: "sales_stage", label: "Stage", type: "select", optionsSource: "salesStages", default: "Sales Verify" },
      { key: "onboarded_count", label: "Onboarded Count", type: "number", default: 0, min: 0 },
      { key: "project_duration_months", label: "Contract Duration (Months)", type: "number", min: 0,
        visibleFor: ["Fixed_Price"], helperText: "Used to annualize the fixed total Rate; leave blank when already annual." },
      { key: "project_scope", label: "Project Scope", type: "richtext", colSpan: 2,
        visibleFor: ["Work_Package", "Fixed_Price", "Retainer"] },
    ],
  },

  // ---- Attachments (always) -------------------------------------------------
  {
    key: "attachments",
    title: "Attachments",
    kind: "attachments",
  },

  // ---- Skill Evaluation Details (always, table) -----------------------------
  {
    key: "skillEval",
    title: "Skill Evaluation Details",
    kind: "table",
    table: {
      addLabel: "Add New",
      emptyLabel: "Add your first skill",
      columns: [
        { key: "skill_id", label: "Skill Name", type: "select", optionsSource: "skills", required: true },
        { key: "required_level", label: "Required Skill Level", type: "select",
          options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) })) },
        { key: "is_mandatory", label: "Is Mandatory", type: "checkbox" },
        { key: "comment", label: "Comment", type: "text" },
      ],
    },
  },

  // ---- Onboarding Status (always) -------------------------------------------
  {
    key: "onboardingStatus",
    title: "Onboarding Status",
    kind: "fields",
    fields: [
      { key: "onboarding_status", label: "Onboarding Status", type: "select", optionsSource: "onboardingStatus" },
    ],
  },

  // ---- Activity Histories (read-only, edit mode) ----------------------------
  {
    key: "activityHistories",
    title: "Activity Histories",
    kind: "activityLog",
    readOnly: true,
  },
];

/* ------------------------------------------------------------ helpers ------ */

/** Is a section shown for the given type? */
export function sectionVisible(section: SectionDef, type: OpportunityType | ""): boolean {
  if (section.hiddenFor && type && section.hiddenFor.includes(type)) return false;
  if (!section.visibleFor) return true;
  return !!type && section.visibleFor.includes(type);
}

/** Is a field shown for the given type (respects section-level field gating)? */
export function fieldVisible(section: SectionDef, field: FieldDef, type: OpportunityType | ""): boolean {
  if (section.fieldsVisibleFor && !(type && section.fieldsVisibleFor.includes(type))) return false;
  if (!field.visibleFor) return true;
  return !!type && field.visibleFor.includes(type);
}

/** All field keys that are VALID (visible) for a type — used client + mirrored server-side. */
export function visibleFieldKeys(type: OpportunityType): string[] {
  const keys: string[] = [];
  for (const s of OPPORTUNITY_SCHEMA) {
    if (!sectionVisible(s, type)) continue;
    for (const f of s.fields || []) {
      if (fieldVisible(s, f, type)) keys.push(f.key);
    }
  }
  return keys;
}

/** Strip any keys not valid for the type (defensive: never submit hidden fields). */
export function stripHiddenFields<T extends Record<string, unknown>>(
  data: T,
  type: OpportunityType,
): Partial<T> {
  const allowed = new Set(visibleFieldKeys(type));
  // table/attachment sections are always allowed
  ["skills", "ctc_slab", "attachments"].forEach((k) => allowed.add(k));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (allowed.has(k)) out[k] = v;
  return out as Partial<T>;
}

/** Config flag from Part 4 — locked-field sequential mode, default OFF (A/B). */
export const STRICT_SEQUENTIAL_MODE = false;
