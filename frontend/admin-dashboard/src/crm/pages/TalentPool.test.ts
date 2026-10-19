import { describe, expect, it } from "vitest";

import {
  EMPTY_FILTERS, EVIDENCE_LOOK, activeFilterCount, addSkill, groupCatalogue, lakh, poolQuery,
} from "./TalentPool";

describe("Talent Pool helpers", () => {
  it("moves a skill between must-have and nice-to-have instead of duplicating it", () => {
    let f = addSkill(EMPTY_FILTERS, "  AUTOSAR ", "must");
    expect(f.skills).toEqual(["AUTOSAR"]);
    f = addSkill(f, "autosar", "nice");
    expect(f.skills).toEqual([]);
    expect(f.nice).toEqual(["autosar"]);
    expect(addSkill(f, "   ", "must")).toBe(f);
  });

  it("builds the search query with blank fields left out", () => {
    const f = { ...EMPTY_FILTERS, skills: ["C++", "RTOS"], nice: ["CAN"], ctc_max: "12", proven_only: true };
    const q = poolQuery(f, 2, 24);
    expect(q).toContain("skills=C%2B%2B%2CRTOS");
    expect(q).toContain("nice=CAN");
    expect(q).toContain("ctc_max=12");
    expect(q).toContain("proven_only=true");
    expect(q).toContain("page=2");
    expect(q).not.toContain("availability");
    expect(q).not.toContain("include_employees");
    expect(poolQuery({ ...EMPTY_FILTERS, include_employees: false }, 1)).toContain("include_employees=false");
  });

  it("counts the narrowing filters, not the skills", () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTERS, skills: ["A"], availability: "available", notice: "30" })).toBe(2);
  });

  it("groups the skill browser by category with Other last and filters by name", () => {
    const skills = [
      { id: 1, name: "Python", category: "Programming", count: 4, proven: 1 },
      { id: 2, name: "Misc", category: "Other", count: 1, proven: 0 },
      { id: 3, name: "RTOS", category: "Embedded", count: 2, proven: 0 },
    ];
    expect(groupCatalogue(skills, "").map((g) => g.category)).toEqual(["Embedded", "Programming", "Other"]);
    expect(groupCatalogue(skills, "rt").map((g) => g.skills[0].name)).toEqual(["RTOS"]);
  });

  it("prints rupees as lakh and ranks interview proof first", () => {
    expect(lakh(850000)).toBe("₹8.5 L");
    expect(lakh(2400000)).toBe("₹24 L");
    expect(lakh(null)).toBeNull();
    const ranked = Object.entries(EVIDENCE_LOOK).sort((a, b) => b[1].rank - a[1].rank).map(([k]) => k);
    expect(ranked[0]).toBe("interview");
    expect(ranked[ranked.length - 1]).toBe("interview_low");
  });
});
