import { describe, expect, it } from "vitest";
import { captureScale, packBlocks } from "./exportElementToPdf";
import { buildSkillCards, questionCoversSkill } from "../managerDashboardView";

describe("PDF export (black-PDF fix)", () => {
  it("lowers the scale so no canvas passes the limit", () => {
    expect(captureScale(1000)).toBe(2);
    expect(captureScale(14_000)).toBe(1);
    expect(captureScale(100_000)).toBe(0.5);
  });

  it("never splits a block that fits, and gives a tall one fresh pages", () => {
    const p = packBlocks([100, 180, 50, 400, 20], 270, 0);
    expect(p[0]).toEqual({ page: 0, y: 0 });
    expect(p[1]).toEqual({ page: 1, y: 0 });      // 100 + 180 > 270 → next page
    expect(p[2]).toEqual({ page: 1, y: 180 });
    expect(p[3]).toEqual({ page: 2, y: 0 });      // tall: starts on a fresh page, runs 2 pages
    expect(p[4]).toEqual({ page: 3, y: 130 });    // after the 130 mm left on page 3
  });
});

describe("strength summary = the position's skills", () => {
  const questions = [
    { question_index: 1, question: "Explain AUTOSAR RTE ports", answer: "x", question_strengths: ["Named ports"], question_weaknesses: [], score: 8 },
    { question_index: 2, question: "What is a CAN bus-off?", answer: "skip", question_strengths: [], question_weaknesses: ["Skipped"], score: null, skipped: true },
  ];

  it("matches a skill as whole words", () => {
    expect(questionCoversSkill("Explain AUTOSAR RTE ports", "AUTOSAR")).toBe(true);
    expect(questionCoversSkill("Explain the scanner", "CAN")).toBe(false);
  });

  it("prints only the position's skills, strong ones as strengths", () => {
    const { strength, improvement } = buildSkillCards(questions as any, [
      { skill: "AUTOSAR", mandatory: true, status: "shown", status_label: "Shown", avg_score_percent: 80, questions: [1] },
      { skill: "UDS", mandatory: false, status: "not_tested", status_label: "Not tested", avg_score_percent: null, questions: [] },
    ]);
    expect(strength.map((c) => c.title)).toEqual(["AUTOSAR · must-have"]);
    expect(improvement.map((c) => c.title)).toEqual(["UDS"]);
    expect(JSON.stringify([...strength, ...improvement])).not.toContain("CAN Protocol");
  });
});
