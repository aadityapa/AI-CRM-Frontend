import { describe, expect, it } from "vitest";
import { amountsProblem, figuresOf, gstFor, toNum } from "./CorrectAmounts";

describe("Correct invoice amounts (24 Nov 2026)", () => {
  it("works out the issued invoice's figures", () => {
    const g = gstFor(273337, false);
    expect(g.cgst).toBe(24600.33);
    expect(g.sgst).toBe(24600.33);
    const f = figuresOf(273337, g.cgst, g.sgst, 0, null);
    expect(f.total).toBe(322537.66);
    expect(amountsProblem(f)).toBeNull();
    expect(gstFor(100000, true)).toEqual({ cgst: 0, sgst: 0, igst: 18000 });
  });

  it("refuses what the server refuses, in words", () => {
    expect(amountsProblem(figuresOf(0, 0, 0, 0, null))).toMatch(/before GST/);
    expect(amountsProblem(figuresOf(100, 9, 9, 18, null))).toMatch(/not both/);
    expect(amountsProblem(figuresOf(273337, 1000, 1000, 0, null))).toMatch(/18 %/);
    expect(amountsProblem(figuresOf(100000, 9000, 9000, 0, 500))).toMatch(/typing slip/);
    expect(amountsProblem(figuresOf(toNum("abc"), 0, 0, 0, null))).toMatch(/numbers/);
    expect(toNum("₹2,73,337.00")).toBe(273337);
  });
});
