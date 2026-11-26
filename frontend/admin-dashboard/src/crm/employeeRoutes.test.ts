import { describe, expect, it } from "vitest";
import { isEmployeeOnlyLogin } from "./CrmApp";
import { employeeFocus } from "./employeeRoutes";
import { findFocusRole, jdBlocks, jdPreview, type Role } from "./components/workspace/EmployeePortal";

describe("employee-only login (26 Nov 2026)", () => {
  it("is Employee (+ Interviewer) and nothing else", () => {
    expect(isEmployeeOnlyLogin({ roles: ["Employee", "Interviewer"], display_roles: ["Employee", "Interviewer"] })).toBe(true);
    expect(isEmployeeOnlyLogin({ roles: ["employee"] })).toBe(true);
    expect(isEmployeeOnlyLogin({ roles: ["Interviewer"] })).toBe(false);
    expect(isEmployeeOnlyLogin({ roles: ["Employee", "RMG"] })).toBe(false);
    expect(isEmployeeOnlyLogin({ roles: ["Employee", "GM"] })).toBe(false);
    expect(isEmployeeOnlyLogin({ roles: ["Sales", "Sales Manager"], display_roles: ["Sales Manager"] })).toBe(false);
    expect(isEmployeeOnlyLogin(null)).toBe(false);
  });

  it("opens the role an old link points at", () => {
    expect(employeeFocus("list", "5")).toBeUndefined();
    expect(employeeFocus("opportunity", "71")).toEqual({ opportunityId: 71 });
    expect(employeeFocus("requirement", "x")).toEqual({ requirementId: undefined });
    const role = (id: number, opp: number) => ({ id, opportunity_id: opp } as Role);
    const roles = [role(10, 71), role(11, 72)];
    expect(findFocusRole(roles, { opportunityId: 72 })?.id).toBe(11);
    expect(findFocusRole(roles, { requirementId: 10 })?.id).toBe(10);
    expect(findFocusRole(roles, { requirementId: 99 })).toBeNull();
  });

  it("reads a JD as headings, paragraphs and bullets", () => {
    const jd = "About the role:\nWe build Linux drivers.\n- Kernel modules\n- Device tree\n2) Debug with GDB";
    expect(jdBlocks(jd)).toEqual([
      { kind: "h", text: "About the role" },
      { kind: "p", text: "We build Linux drivers." },
      { kind: "li", text: "Kernel modules" },
      { kind: "li", text: "Device tree" },
      { kind: "li", text: "Debug with GDB" },
    ]);
    expect(jdPreview("a ".repeat(300), 20).endsWith("…")).toBe(true);
  });
});
