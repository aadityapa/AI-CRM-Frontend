/** What a Project Employee's rate is priced per — the `billing_unit` enum.
 *
 * ONE list for every form that maps an employee onto a project (Map Employee,
 * the New Project wizard's Map Employees step, Assign Employee) and for the
 * Commercial Details unit editor. There is deliberately NO default: every
 * form used to start on "Monthly", so an hourly rate typed without touching
 * the select billed a 168-hour month as ONE month (reported 25 Sep 2026). */
export const BILLING_UNITS = [
  { value: "Hourly", label: "Per Hour" },
  { value: "Daily", label: "Per Day" },
  { value: "Monthly", label: "Per Month" },
  { value: "Yearly", label: "Per Year" },
] as const;

export type BillingUnitValue = (typeof BILLING_UNITS)[number]["value"];

export const BILLING_UNIT_REQUIRED = "Pick what this rate is priced per — hour, day, month or year";

/** "Hour" / "Day" / "Month" / "Year" — for "₹1,414.77 / Hour" style labels. */
export function unitWord(unit?: string | null): string {
  switch (unit) {
    case "Hourly": return "Hour";
    case "Daily": return "Day";
    case "Yearly": return "Year";
    case "Monthly": return "Month";
    default: return "Unit";
  }
}
