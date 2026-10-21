import { describe, expect, it } from "vitest";
import { mapPlan } from "./ReceiptWorkbench";

describe("mapping an on-account receipt to invoices", () => {
  it("fills the ticked invoices oldest first up to each balance", () => {
    const p = mapPlan(1500, [1, 2, 3], { 1: 1000, 2: 400, 3: 800 }, {});
    expect(p.take).toEqual({ 1: 1000, 2: 400, 3: 100 });
    expect(p.left).toBe(0);
    expect(p.over).toBe("");
  });

  it("takes a typed amount first and fills the rest from what is left", () => {
    const p = mapPlan(1000, [1, 2], { 1: 900, 2: 900 }, { 2: "300" });
    expect(p.take).toEqual({ 1: 700, 2: 300 });
    expect(p.left).toBe(0);
  });

  it("says when a typed amount is too much", () => {
    expect(mapPlan(500, [1], { 1: 200 }, { 1: "300" }).over).toMatch(/balance/);
    expect(mapPlan(100, [1, 2], { 1: 900, 2: 900 }, { 1: "80", 2: "50" }).over).toMatch(/on account/);
  });
});
