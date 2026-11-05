import { describe, expect, it } from "vitest";
import { agoShort, suggestedPick, workloadLine, type TaOption, type Workload } from "./PositionTeamPanel";

const w = (p: number, c: number): Workload => ({
  active_positions: p, open_headcount: p, live_candidates: c, level: "light", recent: [],
});

describe("Assign dialog workload (5 Nov 2026)", () => {
  it("says how busy someone is, in the team's words", () => {
    expect(workloadLine(w(1, 1))).toBe("1 active position · 1 live candidate");
    expect(workloadLine(w(3, 14))).toBe("3 active positions · 14 live candidates");
    expect(workloadLine(w(2, 3), "hm")).toBe("2 active positions · 3 waiting for review");
    expect(workloadLine(null)).toBe("");
  });

  it("offers the suggestion only while it is not ticked", () => {
    const opts: TaOption[] = [{ id: 1, name: "Asha", workload: w(4, 9) }, { id: 2, name: "Ravi", workload: w(0, 0), suggested: true }];
    expect(suggestedPick(opts, new Set())?.id).toBe(2);
    expect(suggestedPick(opts, new Set([2]))).toBeNull();
    expect(suggestedPick([{ id: 1, name: "Asha" }], new Set())).toBeNull();
  });

  it("prints a short 'when'", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    expect(agoShort("2026-11-05T09:00:00Z", now)).toBe("3 h ago");
    expect(agoShort("2026-11-02T12:00:00Z", now)).toBe("3 d ago");
    expect(agoShort(null, now)).toBe("");
  });
});
