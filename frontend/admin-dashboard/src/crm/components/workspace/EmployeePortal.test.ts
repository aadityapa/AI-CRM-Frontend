import { describe, expect, it } from "vitest";
import { filterRoles, interviewWords, type InterviewRow, type Role } from "./EmployeePortal";

const role = (id: number, title: string, band: Role["fit"]["band"], applied = false): Role => ({
  id, title, jd: "Write CAPL scripts for HIL rigs", skills: [{ name: "CAPL", must: true }], posted: null,
  fit: { score: band === "good" ? 80 : 20, band, matched: [], missing: [] },
  applied: applied ? { label: "In progress · Sourcing", state: "in_progress", applied_on: null } : null,
});

describe("employee portal helpers", () => {
  it("filters open positions by fit, applied and words in the title / JD / skills", () => {
    const roles = [role(1, "CAPL Tester", "good"), role(2, "Android Dev", "low", true)];
    expect(filterRoles(roles, "", "good").map((r) => r.id)).toEqual([1]);
    expect(filterRoles(roles, "", "applied").map((r) => r.id)).toEqual([2]);
    expect(filterRoles(roles, "", "not_applied").map((r) => r.id)).toEqual([1]);
    expect(filterRoles(roles, "hil capl", "all").map((r) => r.id)).toEqual([1, 2]);
    expect(filterRoles(roles, "android", "all").map((r) => r.id)).toEqual([2]);
  });

  it("says where an interview stands", () => {
    const base = { kind: "ai_l1", id: 1, kind_label: "AI L1", title: "x", when: null, overall: null,
                   technical: null, communication: null, has_report: false } as const;
    expect(interviewWords({ ...base, status: "invited", voided: false } as InterviewRow)).toMatch(/email/);
    expect(interviewWords({ ...base, status: "completed", voided: true } as InterviewRow)).toBe("Did not count");
  });
});
