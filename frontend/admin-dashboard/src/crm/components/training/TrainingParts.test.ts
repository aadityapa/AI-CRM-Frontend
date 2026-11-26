import { describe, expect, it } from "vitest";

import { addPlanSkill, plusDays, suggestTemplate } from "./TrainingParts";

describe("training plan helpers", () => {
  it("adds a skill once, keeping the target at or above the level now", () => {
    let s = addPlanSkill([], " AUTOSAR ");
    s = addPlanSkill(s, "autosar");
    s = addPlanSkill(s, "CAN", 5, 3);
    expect(s).toEqual([{ name: "AUTOSAR", current: null, target: 4 }, { name: "CAN", current: 5, target: 5 }]);
    expect(addPlanSkill(s, "  ")).toBe(s);
  });
  it("suggests the template whose skills overlap the plan most", () => {
    const t = [{ job_id: "a", title: "Java", skills: ["Java"] }, { job_id: "b", title: "BSW", skills: ["CAN", "AUTOSAR"] }];
    expect(suggestTemplate(t, ["autosar", "CAN"])).toBe("b");
    expect(suggestTemplate(t, ["Rust"])).toBeNull();
  });
  it("counts days forward from a date", () => {
    expect(plusDays(14, new Date(2026, 10, 25))).toBe("2026-12-09");
  });
});
