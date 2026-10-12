/**
 * Skill-wise question bank editor (10 Oct 2026): round-trip with the server's
 * key names, the problems that block a save, the time estimate, and adding a
 * pseudo-code question from the UI.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import {
  SKILL_BANK_DEFAULTS,
  SkillBankEditor,
  bankProblems,
  estimateMinutes,
  kindNeed,
  sampleOrder,
  skillBankFromWeights,
  skillBankToWeights,
  type SkillBankConfig,
} from "./SkillBankEditor";

const BANK: SkillBankConfig = {
  ...SKILL_BANK_DEFAULTS,
  enabled: true,
  mandatory_skills: ["Python"],
  questions: [
    { id: "a", skill: "Python", kind: "normal", text: "What is a decorator?", expected: "Wraps a function." },
    { id: "b", skill: "Python", kind: "pseudo", text: "What prints?", code: "print(2*3)", options: ["5", "6"], correct: 1 },
    { id: "c", skill: "SQL", kind: "coding", text: "Second highest salary", expected: "SELECT ...", language: "sql" },
  ],
};

describe("skill bank config", () => {
  it("round-trips through weights with the server's key names", () => {
    const saved = skillBankToWeights(BANK);
    expect(saved.pick_min).toBe(2);
    const back = skillBankFromWeights({ skillBank: saved });
    expect(back.enabled).toBe(true);
    expect(back.questions.map((q) => q.kind)).toEqual(["normal", "pseudo", "coding"]);
    expect(back.questions[1].correct).toBe(1);
    expect(back.mandatory_skills).toEqual(["Python"]);
    expect(skillBankFromWeights({}).enabled).toBe(false);
    expect(skillBankFromWeights({}).ai_fill).toBe(true);
    expect(skillBankFromWeights({ skillBank: { ...saved, ai_fill: false } }).ai_fill).toBe(false);
  });

  it("saves partly-right options (never the correct one) with their credit", () => {
    const withPartial: SkillBankConfig = {
      ...BANK,
      questions: [{ id: "p", skill: "SQL", kind: "pseudo", text: "Rows?", code: "SELECT", options: ["3", "4", "0"], correct: 1, partial: [0, 1], partial_credit: 25 }],
    };
    const q = (skillBankToWeights(withPartial).questions as Record<string, unknown>[])[0];
    expect(q.partial).toEqual([0]);
    expect(q.partial_credit).toBe(25);
    const plain = (skillBankToWeights(BANK).questions as Record<string, unknown>[])[1];
    expect(plain.partial).toBeUndefined();
  });

  it("warns about short skills only when AI top-up is off", () => {
    const short: SkillBankConfig = { ...BANK, normal_per_skill: 3 };
    expect(bankProblems(short).some((p) => /spoken question/.test(p.text))).toBe(false);
    expect(bankProblems({ ...short, ai_fill: false }).some((p) => /spoken question/.test(p.text))).toBe(true);
  });

  it("blocks a pseudo-code question without a correct option, warns on thin banks", () => {
    const bad: SkillBankConfig = {
      ...BANK,
      questions: [...BANK.questions, { id: "d", skill: "SQL", kind: "pseudo", text: "?", code: "x", options: ["a", "b"] }],
    };
    const problems = bankProblems(bad);
    expect(problems.some((p) => p.level === "error" && /correct option/.test(p.text))).toBe(true);
    expect(bankProblems({ ...BANK, pseudo_count: 3 }).some((p) => p.level === "warn" && /pseudo-code/.test(p.text))).toBe(true);
    expect(bankProblems({ ...BANK, enabled: false })).toEqual([]);
  });

  it("estimates the interview length from the mix", () => {
    // 1 + 2 skills × 2 normal × 2.5 + 2 × 2 + 1 × 10 = 25
    expect(estimateMinutes(BANK, 2)).toBe(25);
  });
});

function Harness() {
  const [v, setV] = useState<SkillBankConfig>({ ...SKILL_BANK_DEFAULTS, enabled: true });
  return (
    <>
      <SkillBankEditor value={v} onChange={setV} suggestedSkills={["Python"]} />
      <output data-testid="count">{v.questions.length}:{v.questions.map((q) => q.kind).join(",")}</output>
    </>
  );
}

describe("coding languages", () => {
  it("saves the offered languages and only non-empty starters", () => {
    const c: SkillBankConfig = {
      ...BANK,
      questions: [{ id: "k", skill: "Embedded C", kind: "coding", text: "Toggle bit n", expected: "reg ^ (1U << n)",
        language: "embedded_c", languages: ["embedded_c", "cpp", "nope"], starters: { embedded_c: "uint8_t f(void)", cpp: "  ", kotlin: "fun f()" } }],
    };
    const q = (skillBankToWeights(c).questions as Record<string, unknown>[])[0];
    expect(q.languages).toEqual(["embedded_c", "cpp"]);
    expect(q.starters).toEqual({ embedded_c: "uint8_t f(void)" });
    const back = skillBankFromWeights({ skillBank: skillBankToWeights(c) }).questions[0];
    expect(back.languages).toEqual(["embedded_c", "cpp"]);
  });

  it("puts theory first with the typed questions in between, and counts what is short", () => {
    const order = sampleOrder(BANK, 2);
    expect(order[0]).toBe("normal");
    expect(order[order.length - 1]).toBe("normal");
    expect(order.filter((k) => k === "coding")).toHaveLength(BANK.coding_count);
    expect(kindNeed({ ...BANK, pseudo_count: 3 }, "pseudo")).toEqual({ have: 1, need: 3, short: 2 });
  });
});

describe("SkillBankEditor", () => {
  it("renders nothing while the template does not use the skill-wise mode", () => {
    const { container } = render(<SkillBankEditor value={SKILL_BANK_DEFAULTS} onChange={() => undefined} suggestedSkills={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("adds a pseudo-code question from the skill card and opens its tab", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Add Pseudo-code question for Python" }));
    expect(screen.getByTestId("count").textContent).toBe("1:pseudo");
    expect(screen.getByRole("tab", { name: /Pseudo-code/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/thing\(s\) to fix before saving/)).toBeTruthy();
  });

  it("offers automotive and Android languages on a coding problem", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Add Coding problem for Python" }));
    expect(screen.getByRole("button", { name: /Embedded C/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Android" }));
    expect(screen.getAllByRole("button", { name: /Kotlin \(Android\)/ }).some((b) => b.getAttribute("aria-pressed") === "true")).toBe(true);
  });
});
