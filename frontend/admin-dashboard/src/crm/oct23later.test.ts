/**
 * 23 Oct 2026 (later): active customers in name-built dropdowns, and the
 * report-page decision banner's stage words.
 */
import { describe, expect, it } from "vitest";

import { onlyActiveNames } from "./lib/activeCustomers";
import { stageWords } from "../components/candidate-report/DecisionOutcomeBanner";

describe("active customer names", () => {
  const active = [{ id: 1, name: "Harman" }, { id: 2, name: "Uno Minda" }];
  it("drops inactive customers but keeps the chosen one", () => {
    expect(onlyActiveNames(["Harman", "Old Corp", "Uno Minda"], active)).toEqual(["Harman", "Uno Minda"]);
    expect(onlyActiveNames(["Harman", "Old Corp"], active, "Old Corp")).toEqual(["Harman", "Old Corp"]);
    expect(onlyActiveNames([" harman "], active)).toEqual([" harman "]);
  });
  it("keeps everything while the active list is unknown", () => {
    expect(onlyActiveNames(["A", "B"], null)).toEqual(["A", "B"]);
  });
});

describe("decision banner", () => {
  it("prints stage values as words", () => {
    expect(stageWords("RMG_Rejected")).toBe("RMG Rejected");
    expect(stageWords(null)).toBe("");
  });
});
