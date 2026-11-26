import { describe, expect, it } from "vitest";
import { groupEffect, lookOf, suggestionPlan, suggestWords, type BenchGroup, type Suggestion } from "./BenchGroups";

const g = (id: number, key: string | null, counts = false): BenchGroup => ({
  id, key, name: `G${id}`, description: null, color: "purple", counts_as_bench: counts, sort_order: id, members: 0,
  system: !!key, created_by_name: null,
});

describe("bench groups", () => {
  it("says where a group's members go", () => {
    expect(groupEffect({ counts_as_bench: false })).toMatch(/Leaves the Bench tab/);
    expect(groupEffect({ counts_as_bench: true })).toMatch(/Stays on the Bench tab/);
    expect(lookOf("neon")).toBe(lookOf("slate"));
    expect(suggestWords("internal")).toBe("internal staff");
  });

  it("moves only the ticked suggestions, each to its group", () => {
    const list: Suggestion[] = [
      { id: 1, name: "Karan", designation: "Director & CEO", department: null, suggested_group: "management", bench_days: 9 },
      { id: 2, name: "Neelam", designation: "Senior Executive", department: "HR", suggested_group: "internal", bench_days: 9 },
      { id: 3, name: "Avi", designation: "VP", department: null, suggested_group: "management", bench_days: 9 },
    ];
    const plan = suggestionPlan(list, new Set([1, 2]), [g(10, "management"), g(20, "internal"), g(30, null)]);
    expect(plan.map((p) => [p.group.id, p.ids])).toEqual([[10, [1]], [20, [2]]]);
    expect(suggestionPlan(list, new Set([1]), [])).toEqual([]);
  });
});
