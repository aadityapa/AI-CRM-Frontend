import { describe, expect, it } from "vitest";

import { filtersToParams, hasCriteria, paramsToFilters, sameSearch } from "./TalentPoolExtras";

describe("saved search parameters", () => {
  it("round-trips the page filters through what is saved", () => {
    const f = paramsToFilters({ skills: ["Python", "RTOS"], nice: "CAN", exp_min: 3, proven_only: true,
                                include_employees: false, availability: "available", sort: "recent" });
    expect(f.skills).toEqual(["Python", "RTOS"]);
    expect(f.nice).toEqual(["CAN"]);
    expect(f.exp_min).toBe("3");
    expect(f.proven_only).toBe(true);
    expect(f.include_employees).toBe(false);
    expect(filtersToParams(f)).toEqual({ skills: ["Python", "RTOS"], nice: ["CAN"], exp_min: "3",
      availability: "available", proven_only: true, include_employees: false, sort: "recent" });
  });

  it("defaults what was not saved", () => {
    const f = paramsToFilters(null);
    expect(f.availability).toBe("any");
    expect(f.include_employees).toBe(true);
    expect(filtersToParams(f)).toEqual({});
    expect(hasCriteria(f)).toBe(false);
    expect(hasCriteria({ ...f, sort: "recent" })).toBe(false);   // a sort alone is not a search
    expect(hasCriteria({ ...f, location: "Pune" })).toBe(true);
  });

  it("compares searches ignoring skill order and case", () => {
    const a = paramsToFilters({ skills: ["Python", "RTOS"] });
    const b = paramsToFilters({ skills: ["rtos", "python"] });
    expect(sameSearch(a, b)).toBe(true);
    expect(sameSearch(a, { ...b, location: "Pune" })).toBe(false);
  });
});
