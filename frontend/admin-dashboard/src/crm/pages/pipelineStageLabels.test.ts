import { describe, it, expect } from "vitest";
import { PIPELINE_STAGE_LABELS, pipelineStageLabel } from "./Opportunities";

describe("pipeline stage labels", () => {
  it("maps outcome statuses to friendly labels", () => {
    expect(pipelineStageLabel("Closed_Won")).toBe("Close Won");
    expect(pipelineStageLabel("Closed_Lost")).toBe("Close Lost");
    expect(pipelineStageLabel("On_Hold")).toBe("Customer Hold");
    expect(pipelineStageLabel("Closed_Partial")).toBe("Close Partial");
  });

  it("covers all known pipeline stages", () => {
    for (const key of Object.keys(PIPELINE_STAGE_LABELS)) {
      expect(pipelineStageLabel(key)).toBe(PIPELINE_STAGE_LABELS[key]);
    }
  });
});
