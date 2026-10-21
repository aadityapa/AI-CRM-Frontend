import { describe, expect, it } from "vitest";

import type { PoOption } from "../PoPicker";
import {
  addDays, dateProblems, dateRangeAmount, fillByDates, fillToBalances, rowAmount, splitByQty, splitProblems,
  type SplitDays, type SplitRow,
} from "./SplitAcrossPos";

const po = (id: number, po_number: string, balance: number | null): PoOption =>
  ({ id, po_number, balance_value: balance, selectable: true } as unknown as PoOption);
const POS = [po(1, "PO-A", 56590.8), po(2, "PO-B", 500000)];
const RATE = 1414.77;
const row = (p: Partial<SplitRow>): SplitRow => ({ key: "a", po_id: 1, qty: "", amount: "", start: "", end: "", ...p });

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
    expect(splitProblems([row({ qty: "41" })], POS, { remaining: 237681.36, rate: RATE, byQty: true })[0]).toMatch(/PO-A has only/);
    expect(splitProblems([row({ qty: "40" })], POS, { remaining: 237681.36, rate: RATE, byQty: true })).toEqual([]);
    const twice = [row({ po_id: 2, amount: "10" }), row({ key: "b", po_id: 2, amount: "10" })];
    expect(splitProblems(twice, POS, { remaining: 100, rate: null, byQty: false })).toContain("The same PO is on two lines");
  });
});

/* March 2026 on a Monthly rate: 22 working days, ₹2,20,000 — PO A holds ₹2,00,000. */
const march = (): SplitDays => {
  const days: SplitDays["days"] = [];
  for (let d = "2026-03-01"; d <= "2026-03-31"; d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00`).getDay();
    days.push({ date: d, weight: wd === 0 || wd === 6 ? 0 : 1 });
  }
  return { start: "2026-03-01", end: "2026-03-31", basis: "days", days, taken: [] };
};
const DPOS = [po(1, "PO-A", 200000), po(2, "PO-B", 500000)];

describe("split by dates (mirror of the server)", () => {
  it("1–29 March on PO A, 30–31 March on PO B, priced by billable days", () => {
    const sd = march();
    expect(dateRangeAmount(sd, 220000, "2026-03-01", "2026-03-29")).toBe(200000);
    expect(dateRangeAmount(sd, 220000, "2026-03-30", "2026-03-31")).toBe(20000);
    const rows = fillByDates([1, 2], DPOS, sd, 220000);
    expect(rows.map((r) => [r.po_id, r.start, r.end])).toEqual([
      [1, "2026-03-01", "2026-03-29"], [2, "2026-03-30", "2026-03-31"]]);
    expect(dateProblems(rows, DPOS, sd, 220000)).toEqual([]);
  });

  it("a day on two invoices, or on a part already raised, is refused", () => {
    const sd = march();
    const clash = [row({ start: "2026-03-01", end: "2026-03-29" }),
      row({ key: "b", po_id: 2, start: "2026-03-29", end: "2026-03-31" })];
    expect(dateProblems(clash, DPOS, sd, 220000).join(" ")).toMatch(/two invoices/);
    const taken = { ...sd, taken: [{ start: "2026-03-01", end: "2026-03-29", split_no: 1, invoice_number: "PI-1" }] };
    expect(fillByDates([2], DPOS, taken, 220000).map((r) => [r.start, r.end])).toEqual([["2026-03-30", "2026-03-31"]]);
  });
});
