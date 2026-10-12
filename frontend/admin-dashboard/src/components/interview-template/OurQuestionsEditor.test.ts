import { describe, expect, it } from "vitest";
import {
  askedByKind, bankQuestionTotal, choosesSkills, finalizeBank, parseBulkQuestions, simplify,
} from "./OurQuestionsEditor";
import { SKILL_BANK_DEFAULTS, type SkillBankConfig } from "./SkillBankEditor";

const bank = (questions: SkillBankConfig["questions"], extra: Partial<SkillBankConfig> = {}): SkillBankConfig =>
  ({ ...SKILL_BANK_DEFAULTS, enabled: true, ai_fill: false, questions, ...extra });

const spoken = (n: number, skill = "") =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, skill, kind: "normal" as const, text: `Question ${i + 1}?`, expected: "" }));

describe("Our questions", () => {
  it("asks every question by default — no picker, counts follow the list", () => {
    const edited = simplify(bank([
      ...spoken(3),
      { id: "c", skill: "CAN", kind: "coding", text: "Toggle a bit" },
    ]), { chooseSkills: false, fallbackSkill: "Embedded C" });
    const out = finalizeBank(edited, "Embedded C");
    expect(out.questions.map((q) => q.skill)).toEqual(["Embedded C", "Embedded C", "Embedded C", "CAN"]);
    expect(out.spoken_count).toBe(3);
    expect(out.coding_count).toBe(1);
    expect(out.pseudo_count).toBe(0);
    expect(choosesSkills(out)).toBe(false);
    expect(bankQuestionTotal(out)).toBe(4);
  });

  it("lets the author ask fewer than the list holds, and keeps that number as questions are added", () => {
    const start = simplify(bank(spoken(10)), { chooseSkills: false });
    const five = simplify({ ...start, spoken_count: 5 }, { chooseSkills: false });
    expect(askedByKind(five).normal).toBe(5);
    // Adding questions does not move a number the author chose…
    const more = simplify({ ...five, questions: [...five.questions, ...spoken(3).map((q) => ({ ...q, id: q.id + "x" }))] },
      { chooseSkills: false, prev: five });
    expect(more.spoken_count).toBe(5);
    // …but "all of them" keeps meaning all of them.
    const all = simplify({ ...start, questions: [...start.questions, { ...spoken(1)[0], id: "new" }] },
      { chooseSkills: false, prev: start });
    expect(all.spoken_count).toBe(11);
  });

  it("caps spoken at the list unless the AI may write the rest", () => {
    expect(simplify(bank(spoken(4), { spoken_count: 9 }), { chooseSkills: false }).spoken_count).toBe(4);
    const ai = simplify(bank(spoken(4), { spoken_count: 9, ai_fill: true }), { chooseSkills: false });
    expect(ai.spoken_count).toBe(9);
    expect(askedByKind(ai).normal).toBe(9);
  });

  it("reads one spoken question per line, dropping numbering, bullets, answers and repeats", () => {
    const qs = parseBulkQuestions("1. What is CAN?\n- Explain LIN.\n\nQ: What is FlexRay?\nA: A bus.\nWhat is CAN?\n•  RTOS vs bare metal?");
    expect(qs.map((q) => q.text)).toEqual(["What is CAN?", "Explain LIN.", "What is FlexRay?", "RTOS vs bare metal?"]);
    expect(qs.every((q) => q.kind === "normal" && q.expected === "")).toBe(true);
  });
});
