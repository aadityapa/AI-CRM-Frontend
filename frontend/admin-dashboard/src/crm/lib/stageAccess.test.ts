/**
 * Role-wise candidate stages (13 Oct 2026): the chips a login sees and the
 * words the Roles page prints for a stage set.
 */
import { describe, expect, it } from "vitest";

import { CANDIDATE_STAGE_BUCKETS, stageRangeLabel, visibleStageBuckets } from "./candidateStageBuckets";
import { sameStages, stageSummary, type StageCatalogue } from "../components/access/CandidateStagesModal";

const SALES = ["sales_screening", "customer_screening", "customer_interviewing", "selection",
  "hr_screening", "hr_interviewing", "onboarding", "joined", "closed"];
const CATALOGUE: StageCatalogue = {
  stages: CANDIDATE_STAGE_BUCKETS.filter((b) => b.key !== "all"),
  presets: [],
};

describe("visibleStageBuckets", () => {
  it("keeps every chip when the login sees every stage", () => {
    expect(visibleStageBuckets(null)).toEqual(CANDIDATE_STAGE_BUCKETS);
    expect(visibleStageBuckets(undefined)).toEqual(CANDIDATE_STAGE_BUCKETS);
  });
  it("keeps All plus the role's stages, in flow order", () => {
    const keys = visibleStageBuckets(SALES).map((b) => b.key);
    expect(keys[0]).toBe("all");
    expect(keys).not.toContain("sourcing");
    expect(keys).not.toContain("technical_interview");
    expect(keys.slice(1)).toEqual(SALES);
  });
});

describe("stage set words", () => {
  it("names a contiguous run as a range and a gap as a count", () => {
    expect(stageRangeLabel(SALES)).toBe("Sales Screening → Closed");
    expect(stageSummary(SALES, CATALOGUE)).toBe("Sales Screening → Closed");
    expect(stageSummary(CATALOGUE.stages.map((s) => s.key), CATALOGUE)).toBe("Every stage");
    expect(stageSummary(["sourcing", "closed"], CATALOGUE)).toBe("2 of 12 stages");
  });
  it("compares sets without caring about order", () => {
    expect(sameStages(["closed", "joined"], ["joined", "closed"])).toBe(true);
    expect(sameStages(["closed"], ["closed", "joined"])).toBe(false);
  });
});
