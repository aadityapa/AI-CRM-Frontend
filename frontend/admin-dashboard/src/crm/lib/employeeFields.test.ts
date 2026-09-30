/**
 * The employee profile shows core details + whatever is filled, flags the core
 * gaps, and saves only what changed (29 Sep 2026).
 */
import { describe, expect, it } from "vitest";

import {
  EMPLOYEE_CARDS, changedPayload, displayValue, hiddenFields, missingCore, seedValue,
  validationError, visibleFields,
} from "./employeeFields";

const emp = {
  id: 324, first_name: "Omkar", last_name: "Kamathe", email: "omkar.kamathe@karnex.in", phone: "9145265887",
  gender: "Male", blood_group: "B+", date_of_birth: "2002-03-20", date_of_joining: "2026-09-07",
  employee_code: "324", department_id: 3, department_name: "Engineering", designation_id: 9,
  designation_name: "Engineer", reporting_manager_id: 12, reporting_manager_name: "Manjeet Singh",
  work_location: "Pune", employment_type: "Full_Time", profile_type: "Internal", is_active: true,
  current_ctc: null, personal_email: "kamatheomkar7@gmail.com", skills: [], pan: null, portal_access: false,
};

describe("employee profile fields", () => {
  it("shows core fields and filled optional ones; blank optional ones wait behind 'Add more'", () => {
    const personal = EMPLOYEE_CARDS.personal.fields;
    const shown = visibleFields(emp, personal).map((f) => f.key);
    expect(shown).toContain("blood_group");           // optional but filled
    expect(shown).not.toContain("pan");               // optional and blank
    expect(hiddenFields(emp, personal).map((f) => f.key)).toEqual(
      ["title", "middle_name", "display_name", "emergency_number", "pan", "aadhar"]);
  });

  it("counts the core gaps — here only the CTC — and skips a field the login cannot see", () => {
    expect(missingCore(emp).map((m) => m.field.key)).toEqual(["current_ctc"]);
    expect(missingCore(emp, (f) => f.key === "current_ctc")).toEqual([]);
  });

  it("saves only what changed, typed for the API", () => {
    const job = EMPLOYEE_CARDS.job.fields;
    const draft = Object.fromEntries(job.map((f) => [f.key, seedValue(emp, f)]));
    expect(changedPayload(emp, job, draft)).toEqual({});
    draft.current_ctc = "600000";
    draft.department_id = "4";
    expect(changedPayload(emp, job, draft)).toEqual({ current_ctc: 600000, department_id: 4 });
  });

  it("reads values the way HR says them, and refuses a blank name or a bad email", () => {
    const f = (k: string) => EMPLOYEE_CARDS.job.fields.find((x) => x.key === k)!;
    expect(displayValue(emp, f("employment_type"))).toBe("Full Time");
    expect(displayValue(emp, f("reporting_manager_id"))).toBe("Manjeet Singh");
    expect(displayValue({ current_ctc: 600000 }, f("current_ctc"))).toBe("₹6,00,000");
    expect(validationError({ first_name: " " })).toBe("First name is required");
    expect(validationError({ email: "nope" })).toBe("A valid official email is required");
    expect(validationError({ phone: "1" })).toBeNull();
  });
});
