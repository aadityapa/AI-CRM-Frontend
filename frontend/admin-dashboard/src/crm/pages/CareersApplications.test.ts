import { describe, expect, it } from "vitest";
import { activeFilterCount, appsQuery, canSendForScreening, EMPTY_FILTERS, type CareersApplication } from "./CareersApplications";

describe("Careers applications", () => {
  it("sends only the filters that are on", () => {
    expect(appsQuery(EMPTY_FILTERS, 1)).toBe("?page=1&limit=25");
    const q = appsQuery({ ...EMPTY_FILTERS, search: " ravi ", channel: "linkedin", requirement_id: "12" }, 2);
    expect(q).toContain("search=ravi");
    expect(q).toContain("channel=linkedin");
    expect(q).toContain("requirement_id=12");
    expect(q).toContain("page=2");
    expect(activeFilterCount({ ...EMPTY_FILTERS, search: "x", via: "careers", date_from: "2026-11-01" })).toBe(2);
  });
  it("offers Technical Screening only for a Sourcing candidacy on a position", () => {
    const base = { kind: "position", profile_id: 5, phase: "sourcing" } as CareersApplication;
    expect(canSendForScreening(base)).toBe(true);
    expect(canSendForScreening({ ...base, phase: "technical_screening" })).toBe(false);
    expect(canSendForScreening({ ...base, kind: "general", profile_id: null })).toBe(false);
  });
});
