import { describe, expect, it } from "vitest";

import { mergeSkillRows, skillsInJd, splitSkillNames } from "./SkillListEditor";

describe("SkillListEditor helpers", () => {
  it("merges a skill listed twice: mandatory if any copy is, the higher level wins", () => {
    const rows = mergeSkillRows([
      { key: "a", skill_id: "7", is_mandatory: false, min_rating: "2" },
      { key: "b", skill_id: "9", is_mandatory: true, min_rating: "" },
      { key: "c", skill_id: "7", is_mandatory: true, min_rating: "4" },
    ]);
    expect(rows.map((r) => r.skill_id)).toEqual(["7", "9"]);
    expect(rows[0]).toMatchObject({ is_mandatory: true, min_rating: "4", key: "a" });
  });

  it("splits a pasted list and drops repeats", () => {
    expect(splitSkillNames("C++, RTOS; CAPL\n• rtos\n  AUTOSAR ")).toEqual(["C++", "RTOS", "CAPL", "AUTOSAR"]);
  });

  it("finds master skills named in the JD as whole words, skipping ones already added", () => {
    const master = [
      { id: 1, name: "C++" }, { id: 2, name: "RTOS" }, { id: 3, name: "C" },
      { id: 4, name: "CAPL" }, { id: 5, name: "Java" },
    ];
    const hits = skillsInJd("Needs C++ and CAPL scripting; RTOS a plus.", master, new Set(["2"]));
    expect(hits.map((h) => h.name).sort()).toEqual(["C++", "CAPL"]);
  });
});
