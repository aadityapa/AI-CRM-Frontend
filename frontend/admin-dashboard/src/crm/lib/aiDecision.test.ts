import { describe, expect, it } from "vitest";
import { aiDecisionLabel, aiIsDecided, aiSuggestion } from "./aiDecision";
import { candidateGuidance, endingWarning, type InterviewDiagnosis } from "../../components/interview-diagnosis/InterviewDiagnosisPanel";

describe("AI L1 status (18 Nov 2026 — the AI scores, a person decides)", () => {
  it("reads In Review until RMG / GM decide, whatever the AI scored", () => {
    expect(aiDecisionLabel({ ai_effective_result: "In Review" })).toBe("In Review");
    expect(aiDecisionLabel({ ai_effective_result: "Passed" })).toBe("In Review");      // an older server
    expect(aiDecisionLabel({ ai_interview_result: "Failed" })).toBe("In Review");
    expect(aiDecisionLabel({ ai_hr_decision_label: "Selected", ai_interview_result: "Failed" })).toBe("Selected");
    expect(aiDecisionLabel({ ai_effective_result: "On Hold" })).toBe("On Hold");
    expect(aiDecisionLabel({ ai_interview_status: "Scheduled" })).toBe("Scheduled");
    expect(aiDecisionLabel({})).toBeNull();
    expect(aiIsDecided({ ai_effective_result: "In Review" })).toBe(false);
    expect(aiIsDecided({ ai_effective_result: "Rejected" })).toBe(true);
  });

  it("keeps the AI's read as advice only", () => {
    expect(aiSuggestion({ ai_suggestion: "Passed" })).toMatch(/above the pass mark/);
    expect(aiSuggestion({ ai_interview_result: "Failed" })).toMatch(/below/);
    expect(aiSuggestion({ ai_suggestion: "Failed", ai_not_attempted: true })).toBeNull();
  });
});

describe("Integrity — what to tell the candidate", () => {
  const d: InterviewDiagnosis = {
    headline: "Terminated — 4 warnings, 3 allowed", tone: "bad", explanation: [], next_steps: [], steps: [], flags: [],
    facts: {}, max_warnings: 3, terminated: true,
    warnings: [1, 2, 3, 4].map((n) => ({ n, type: "window_blur", label: "Window lost focus", family: "focus",
      at: null, question: "", details: "" })),
    causes: [{ family: "focus", count: 4, label: "Window lost focus", cause: "c", advice: "Close Teams and WhatsApp." }],
  };
  it("names the warning that ended it and builds a message", () => {
    expect(endingWarning(d)?.n).toBe(4);
    expect(candidateGuidance(d)).toContain("Close Teams and WhatsApp.");
    expect(endingWarning({ ...d, terminated: false })).toBeNull();
  });
});
