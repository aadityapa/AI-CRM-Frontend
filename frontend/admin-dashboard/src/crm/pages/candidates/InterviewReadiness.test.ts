import { describe, expect, it } from "vitest";
import { EMPTY_READINESS, readinessQuery, scoreBand } from "./InterviewReadiness";
import { addRejectSkill, rejectSkillsProblem } from "../../components/RejectSkills";
import { joinsWithin30 } from "../Opportunities";
import { poolQuery, skillGroups, withFilterDefaults } from "../TalentPool";

describe("interview readiness", () => {
  it("builds the query from the filters set", () => {
    expect(readinessQuery({ ...EMPTY_READINESS, verdict: "trainable", ai_min: "50", q: " bala " }, 2))
      .toBe("?page=2&limit=20&verdict=trainable&q=bala&ai_min=50");
    expect(readinessQuery({ ...EMPTY_READINESS, sort: "ai" }, 1)).toContain("sort=ai");
  });
  it("bands a score", () => {
    expect(scoreBand(75)).toBe("good");
    expect(scoreBand(55)).toBe("near");
    expect(scoreBand(20)).toBe("low");
    expect(scoreBand(null)).toBe("none");
  });
});

describe("skills on reject", () => {
  it("adds a skill once, never one already on record", () => {
    expect(addRejectSkill([], ["AUTOSAR"], "autosar")).toEqual([]);
    expect(addRejectSkill(["CAN"], [], " can ")).toEqual(["CAN"]);
    expect(addRejectSkill([], [], "  CAPL ")).toEqual(["CAPL"]);
  });
  it("asks for at least one skill only when the candidate is known", () => {
    expect(rejectSkillsProblem({ candidateId: 1, onRecord: [], added: [], loaded: true })).toMatch(/at least one skill/);
    expect(rejectSkillsProblem({ candidateId: 1, onRecord: ["C"], added: [], loaded: true })).toBeNull();
    expect(rejectSkillsProblem({ candidateId: null, onRecord: [], added: [], loaded: true })).toBeNull();
  });
});

describe("talent pool search", () => {
  it("sends the job-board filters and fills old session values", () => {
    const f = withFilterDefaults({ skills: ["Python"], added_days: "15", cur_ctc_min: "8", has_phone: true });
    const q = poolQuery(f, 1);
    expect(q).toContain("added_days=15");
    expect(q).toContain("cur_ctc_min=8");
    expect(q).toContain("has_phone=true");
    expect(withFilterDefaults({ skills: [] }).ctc_min).toBe("");
  });
  it("groups the skill catalogue by family, biggest first", () => {
    const g = skillGroups([
      { id: 1, name: "AUTOSAR", category: "Automotive", count: 9, proven: 2 },
      { id: 2, name: "CAN", category: "Automotive", count: 4, proven: 0 },
      { id: 3, name: "Python", category: "Software", count: 3, proven: 1 },
      { id: 4, name: "Rust", category: "Software", count: 0, proven: 0 },
    ]);
    expect(g.map((x) => x.category)).toEqual(["Automotive", "Software"]);
    expect(g[0].skills.map((s) => s.name)).toEqual(["AUTOSAR", "CAN"]);
    expect(g[1].skills.map((s) => s.name)).toEqual(["Python"]);
  });
});

describe("suggested candidates", () => {
  it("knows who joins within 30 days", () => {
    expect(joinsWithin30({ notice_period: "Immediate" })).toBe(true);
    expect(joinsWithin30({ notice_period: "30 days" })).toBe(true);
    expect(joinsWithin30({ notice_period: "2 months" })).toBe(false);
    expect(joinsWithin30({ notice_period: "90 days" })).toBe(false);
    expect(joinsWithin30({ notice_period: null, last_working_day: "2026-12-01" })).toBe(true);
  });
});
