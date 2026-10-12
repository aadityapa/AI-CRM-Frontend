import { describe, expect, it } from "vitest";
import { flattenInterviews, verdictOf } from "./InterviewReports";

describe("verdictOf", () => {
  it("reads the AI recommendation first", () => {
    expect(verdictOf({ recommendation: "Hire", score: 20 })).toBe("hire");
    expect(verdictOf({ recommendation: "Consider", score: 90 })).toBe("consider");
    expect(verdictOf({ recommendation: "Reject", score: 90 })).toBe("reject");
  });
  it("never calls an empty interview a reject", () => {
    expect(verdictOf({ recommendation: "Not Attempted", score: 0 })).toBe("not_attempted");
    expect(verdictOf({ not_attempted: true, score: 0 })).toBe("not_attempted");
  });
  it("terminated and pending reports are their own verdicts", () => {
    expect(verdictOf({ final_status: "terminated", recommendation: "Hire", score: 80 })).toBe("terminated");
    expect(verdictOf({ report_status: "generating", score: 0 })).toBe("pending");
  });
  it("falls back to the score", () => {
    expect(verdictOf({ score: 75 })).toBe("hire");
    expect(verdictOf({ score: 55 })).toBe("consider");
    expect(verdictOf({ score: 30 })).toBe("reject");
  });
});

describe("flattenInterviews", () => {
  it("gives one row per interview with the candidate on it", () => {
    const rows = flattenInterviews([
      { id: "a@x.in", name: "A", email: "a@x.in", role: "", interviews: [
        { id: "1", sessionName: "", date: "2026-10-01", skills: [], score: 70, status: "Selected" },
        { id: "2", sessionName: "", date: "2026-10-02", skills: [], score: 40, status: "Pending Review" },
      ] },
    ]);
    expect(rows.map((r) => [r.id, r.candidateName])).toEqual([["1", "A"], ["2", "A"]]);
  });
});
