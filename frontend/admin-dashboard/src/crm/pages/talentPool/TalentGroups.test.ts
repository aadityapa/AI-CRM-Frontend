import { describe, expect, it } from "vitest";
import { addGroupSkill, applicable, type MemberRow } from "./TalentGroups";

describe("talent groups", () => {
  it("adds a skill once, as a must-have by default", () => {
    let s = addGroupSkill([], " AUTOSAR ");
    s = addGroupSkill(s, "autosar", false);
    s = addGroupSkill(s, "CAN", false);
    expect(s).toEqual([{ name: "AUTOSAR", must: true }, { name: "CAN", must: false }]);
    expect(addGroupSkill(s, "  ")).toBe(s);
  });

  it("applies only candidates not already on the position", () => {
    const row = (id: number, applied: boolean) => ({
      kind: "candidate", candidate_id: id, fit: applied ? { applied: { profile_id: 1 } } : { applied: null },
    }) as unknown as MemberRow;
    expect(applicable([row(1, false), row(2, true)]).map((r) => r.candidate_id)).toEqual([1]);
  });
});
