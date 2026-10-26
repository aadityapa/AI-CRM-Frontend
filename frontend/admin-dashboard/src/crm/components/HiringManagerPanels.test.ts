import { describe, expect, it } from "vitest";
import { isHmOf } from "./HiringManagerPanels";

describe("Hiring Manager panels (22 Oct 2026)", () => {
  const hms = [{ user_id: 30, name: "Neha" }, { user_id: 31, name: "Ravi" }];

  it("lets only the position's Hiring Managers (and Admin / CEO) decide", () => {
    expect(isHmOf({ id: 30, roles: ["Hiring Manager"] }, hms)).toBe(true);
    expect(isHmOf({ id: 99, roles: ["Hiring Manager"] }, hms)).toBe(false);
    expect(isHmOf({ id: 99, roles: ["CEO"] }, hms)).toBe(true);
    expect(isHmOf({ id: 30, roles: ["Hiring Manager"] }, null)).toBe(false);
  });
});
