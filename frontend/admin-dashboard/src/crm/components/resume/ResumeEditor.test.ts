import { describe, expect, it } from "vitest";
import { EMPTY_RESUME, completenessOf, textToBullets } from "./ResumeEditor";
import { daysText, missingDays } from "../bench/BenchParts";

describe("company resume", () => {
  it("scores the resume the way the server does", () => {
    expect(completenessOf(EMPTY_RESUME).percent).toBe(0);
    const full = {
      ...EMPTY_RESUME, name: "Abhishek Singh", headline: "Automotive Software Tester", email: "a@x.com",
      phone: "+91 9", location: "Pune", summary: "x".repeat(120),
      skills: [{ label: "Automation", items: "Python, CAPL" }],
      projects: [{ title: "IVI", duration: "1.5 years", bullets: ["one", "two"] }],
      education: [{ institute: "RMD", degree: "BE", score: "", year: "" }],
    };
    expect(completenessOf(full)).toEqual({ percent: 100, missing: [] });
  });

  it("turns typed lines into clean points", () => {
    expect(textToBullets("- one\n\n• two\n3. three ")).toEqual(["one", "two", "three"]);
  });
});

describe("bench helpers", () => {
  it("lists weekdays with no entry and words a span", () => {
    // Mon 23 Nov 2026; Fri 20 has an entry; Sat/Sun are skipped.
    const miss = missingDays([{ id: 1, date: "2026-11-20", hours: 8, summary: "x", task_ids: [], written_by_name: null, updated_at: null }],
      "2026-11-23", 3);
    expect(miss).toEqual(["2026-11-23"]);
    expect(daysText(12)).toBe("12 days");
    expect(daysText(90)).toBe("3 months");
  });
});
