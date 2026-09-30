/**
 * The employee record as HR works it (29 Sep 2026, user ask: "only the required
 * details on the Employee page, and make adding details easy — not a 7-step
 * wizard of empty boxes").
 *
 * ONE declarative list of the fields each profile card holds. A field is
 * `core` when HR needs it on every employee (it always shows, and a blank one
 * is flagged "Not added" and counted in the completeness ring) — the rest are
 * optional: shown only once filled, and offered behind "Add more details" in
 * the form. `mandatory` fields are the two the server refuses to save without.
 * Everything here is PURE; `Employees.tsx` renders it.
 */

export type EmpFieldKind =
  | "text" | "email" | "tel" | "date" | "number" | "select" | "ref" | "skills" | "toggle" | "money";

export type EmpRef = "departments" | "designations" | "people";

export type EmpField = {
  key: string;
  label: string;
  kind: EmpFieldKind;
  /** Needed on every employee: always shown, counted in completeness. */
  core?: boolean;
  /** The server refuses to save without it. */
  mandatory?: boolean;
  options?: { value: string; label: string }[];
  ref?: EmpRef;
  /** Payload key holding the readable value of a `ref` field. */
  display?: string;
  placeholder?: string;
  upper?: boolean;
  maxLength?: number;
  hint?: string;
};

export type EmpCardKey = "job" | "personal" | "attendance";

const opts = (xs: string[]) => xs.map((x) => ({ value: x, label: x }));

export const EMPLOYMENT_TYPES = [
  { value: "Full_Time", label: "Full Time" },
  { value: "Part_Time", label: "Part Time" },
  { value: "Contract", label: "Contract" },
];

export const EMPLOYEE_CARDS: Record<EmpCardKey, { title: string; subtitle: string; fields: EmpField[] }> = {
  job: {
    title: "Job details",
    subtitle: "Where they sit in Karnex and what they are paid",
    fields: [
      { key: "employee_code", label: "Employee ID", kind: "text", core: true, placeholder: "e.g. 324" },
      { key: "email", label: "Official email", kind: "email", core: true, mandatory: true },
      { key: "date_of_joining", label: "Date of joining", kind: "date", core: true },
      { key: "employment_type", label: "Employment type", kind: "select", core: true, options: EMPLOYMENT_TYPES },
      { key: "department_id", label: "Department", kind: "ref", ref: "departments", display: "department_name", core: true },
      { key: "designation_id", label: "Designation", kind: "ref", ref: "designations", display: "designation_name", core: true },
      { key: "reporting_manager_id", label: "Reporting manager", kind: "ref", ref: "people", display: "reporting_manager_name", core: true },
      { key: "work_location", label: "Work location", kind: "text", core: true, placeholder: "e.g. Pune" },
      { key: "current_ctc", label: "Current CTC (per year)", kind: "money", core: true, placeholder: "e.g. 600000" },
      { key: "profile_type", label: "Profile type", kind: "select", core: true, options: opts(["Internal", "External"]) },
      { key: "is_active", label: "Status", kind: "toggle", core: true },
      { key: "reporting_hr_id", label: "Reporting HR", kind: "ref", ref: "people", display: "reporting_hr_name" },
      { key: "role_title", label: "Role", kind: "text" },
      { key: "experience_years", label: "Experience before joining (yrs)", kind: "number" },
      { key: "skills", label: "Skills", kind: "skills" },
      { key: "portal_access", label: "Portal access", kind: "toggle" },
    ],
  },
  personal: {
    title: "Personal details",
    subtitle: "Who they are and how to reach them",
    fields: [
      { key: "first_name", label: "First name", kind: "text", core: true, mandatory: true },
      { key: "last_name", label: "Last name", kind: "text", core: true },
      { key: "phone", label: "Phone", kind: "tel", core: true, placeholder: "10-digit mobile" },
      { key: "personal_email", label: "Personal email", kind: "email", core: true },
      { key: "date_of_birth", label: "Date of birth", kind: "date", core: true },
      { key: "gender", label: "Gender", kind: "select", core: true, options: opts(["Male", "Female", "Other"]) },
      { key: "title", label: "Title", kind: "select", options: opts(["Mr", "Ms", "Mrs", "Dr"]) },
      { key: "middle_name", label: "Middle name", kind: "text" },
      { key: "display_name", label: "Display name", kind: "text" },
      { key: "blood_group", label: "Blood group", kind: "select", options: opts(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]) },
      { key: "emergency_number", label: "Emergency number", kind: "tel" },
      { key: "pan", label: "PAN", kind: "text", upper: true, maxLength: 10, placeholder: "ABCDE1234F" },
      { key: "aadhar", label: "Aadhaar", kind: "text", maxLength: 12, placeholder: "12-digit number" },
    ],
  },
  attendance: {
    title: "Attendance rule",
    subtitle: "Only when this person's hours differ from the branch policy",
    fields: [
      { key: "min_hours_full_day", label: "Min hours for a full day", kind: "number" },
      { key: "min_hours_half_day", label: "Min hours for a half day", kind: "number" },
      { key: "normal_hours_per_day", label: "Normal hours per day", kind: "number" },
    ],
  },
};

export type EmpDraftValue = string | boolean | string[];

/** A value HR has actually recorded (a toggle is always an answer). */
export function isFilled(emp: Record<string, any>, f: EmpField): boolean {
  const v = emp?.[f.key];
  if (f.kind === "toggle") return f.core ? true : Boolean(v);
  if (f.kind === "skills") return Array.isArray(v) && v.length > 0;
  return v !== null && v !== undefined && String(v).trim() !== "";
}

/** Core fields plus any optional field that holds something. */
export function visibleFields(emp: Record<string, any>, fields: EmpField[]): EmpField[] {
  return fields.filter((f) => f.core || isFilled(emp, f));
}

/** Optional fields still blank — what "Add more details" offers. */
export function hiddenFields(emp: Record<string, any>, fields: EmpField[]): EmpField[] {
  return fields.filter((f) => !f.core && !isFilled(emp, f));
}

/** Core fields not yet recorded, card by card (the completeness ring). */
export function missingCore(
  emp: Record<string, any>, skip: (f: EmpField) => boolean = () => false,
): { card: EmpCardKey; field: EmpField }[] {
  const out: { card: EmpCardKey; field: EmpField }[] = [];
  (Object.keys(EMPLOYEE_CARDS) as EmpCardKey[]).forEach((card) => {
    EMPLOYEE_CARDS[card].fields.forEach((f) => {
      if (f.core && f.kind !== "toggle" && !skip(f) && !isFilled(emp, f)) out.push({ card, field: f });
    });
  });
  return out;
}

export function coreCount(skip: (f: EmpField) => boolean = () => false): number {
  return (Object.values(EMPLOYEE_CARDS)).reduce(
    (n, c) => n + c.fields.filter((f) => f.core && f.kind !== "toggle" && !skip(f)).length, 0);
}

/** The form's starting value for one field. */
export function seedValue(emp: Record<string, any>, f: EmpField): EmpDraftValue {
  const v = emp?.[f.key];
  if (f.kind === "toggle") return Boolean(v);
  if (f.kind === "skills") return Array.isArray(v) ? [...v] : [];
  if (v === null || v === undefined) return f.key === "profile_type" ? "Internal" : "";
  if (f.kind === "date") return String(v).slice(0, 10);
  return String(v);
}

/** One form value → what the API takes. */
export function toApi(f: EmpField, v: EmpDraftValue): unknown {
  if (f.kind === "toggle") return Boolean(v);
  if (f.kind === "skills") return v;
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (f.kind === "number" || f.kind === "money") {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (f.kind === "ref") return Number(s);
  return f.upper ? s.toUpperCase() : s;
}

/** Only the fields that CHANGED, so a save never rewrites what HR did not touch. */
export function changedPayload(
  emp: Record<string, any>, fields: EmpField[], draft: Record<string, EmpDraftValue>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  fields.forEach((f) => {
    if (!(f.key in draft)) return;
    const before = JSON.stringify(seedValue(emp, f));
    const after = JSON.stringify(draft[f.key]);
    if (before !== after) out[f.key] = toApi(f, draft[f.key]);
  });
  return out;
}

/** A readable value for the card (null = nothing recorded). */
export function displayValue(emp: Record<string, any>, f: EmpField): string | null {
  if (!isFilled(emp, f)) return null;
  const v = emp[f.key];
  switch (f.kind) {
    case "toggle": return f.key === "is_active" ? (v ? "Active" : "Inactive") : (v ? "Yes" : "No");
    case "ref": return emp[f.display || ""] || `#${v}`;
    case "select": return f.options?.find((o) => o.value === v)?.label || String(v).replace(/_/g, " ");
    case "date": {
      const d = new Date(String(v));
      return Number.isNaN(d.getTime()) ? String(v)
        : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    }
    case "money": return `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
    case "number": return f.key === "experience_years" ? `${v} yrs` : String(v);
    case "skills": return (v as string[]).join(", ");
    default: return String(v);
  }
}

/** The two checks the server enforces, said before the round trip. */
export function validationError(draft: Record<string, EmpDraftValue>): string | null {
  if ("first_name" in draft && !String(draft.first_name || "").trim()) return "First name is required";
  if ("email" in draft && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(draft.email || "").trim())) {
    return "A valid official email is required";
  }
  return null;
}
