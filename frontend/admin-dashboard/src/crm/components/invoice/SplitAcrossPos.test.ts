import { describe, expect, it } from "vitest";

import type { PoOption } from "../PoPicker";
import { fillToBalances, rowAmount, splitByQty, splitProblems } from "./SplitAcrossPos";

const po = (id: number, po_number: string, balance: number | null): PoOption =>
  ({ id, po_number, balance_value: balance, selectable: true } as unknown as PoOption);
const POS = [po(1, "PO-A", 56590.8), po(2, "PO-B", 500000)];
const RATE = 1414.77;

describe("split across POs", () => {
  it("bills by hours on an hourly rate, by amount on a monthly one", () => {
    expect(splitByQty("Hourly", false, RATE)).toBe(true);
    expect(splitByQty("Hourly", true, RATE)).toBe(false);
    expect(splitByQty("Monthly", false, 200000)).toBe(false);
  });

  it("fills the first PO to its balance and the rest on the next", () => {
    const rows = fillToBalances([1, 2], POS, { remaining: 237681.36, remainingQty: 168, rate: RATE, byQty: true, unit: "Hourly" });
    expect(rows.map((r) => [r.po_id, Number(r.qty)])).toEqual([[1, 40], [2, 128]]);
    expect(rows.reduce((s, r) => s + rowAmount(r, true, RATE), 0)).toBeCloseTo(237681.36, 2);
  });

  it("names what is wrong and allows leaving the rest for later", () => {
    const over = [{ key: "a", po_id: 1, qty: "41", amount: "" }];
    expect(splitProblems(over, POS, { remaining: 237681.36, rate: RATE, byQty: true })[0]).toMatch(/PO-A has only/);
    const part = [{ key: "a", po_id: 1, qty: "40", amount: "" }];
    expect(splitProblems(part, POS, { remaining: 237681.36, rate: RATE, byQty: true })).toEqual([]);
    const twice = [{ key: "a", po_id: 2, qty: "", amount: "10" }, { key: "b", po_id: 2, qty: "", amount: "10" }];
    expect(splitProblems(twice, POS, { remaining: 100, rate: null, byQty: false })).toContain("The same PO is on two lines");
  });
});
