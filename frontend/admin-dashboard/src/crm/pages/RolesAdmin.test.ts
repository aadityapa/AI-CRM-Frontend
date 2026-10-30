import { describe, expect, it } from "vitest";
import { groupRolesByDepartment, samePermissions } from "./RolesAdmin";

describe("Roles & permissions (Access Templates merged into Roles, 27 Oct 2026)", () => {
  it("sees a change only when the permissions really changed", () => {
    const a = { tabs: { customers: "view", projects: "" }, fields: {}, actions: null };
    expect(samePermissions(a, { tabs: { customers: "view" }, fields: {}, actions: null })).toBe(true);
    expect(samePermissions(a, { tabs: { customers: "edit" }, fields: {}, actions: null })).toBe(false);
    // Switching buttons from "follow the rules" to an explicit (even empty) list is a change.
    expect(samePermissions(a, { tabs: { customers: "view" }, fields: {}, actions: [] })).toBe(false);
  });

  it("lists built-in and custom roles under their department", () => {
    const depts = [{ key: "sales", label: "Sales" }, { key: "other", label: "Other" }];
    const groups = groupRolesByDepartment(depts, [{ name: "Sales", department: "sales" }],
      [{ name: "GM", department: "nowhere" }]);
    expect(groups.map((g) => g.dept.key)).toEqual(["sales", "other"]);
    expect(groups[1].custom[0].name).toBe("GM");
  });
});
