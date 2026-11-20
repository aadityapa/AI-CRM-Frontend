import { describe, expect, it } from "vitest";
import { quarterOf, tdsPlan } from "./ReceivedTds";
import { blockNote } from "./receipts/receiptShared";
import { smallBalances } from "../components/invoice/SettleInFull";

describe("Received TDS", () => {
  it("maps typed amounts first, the rest in order from what is left", () => {
    const p = tdsPlan(150, [1, 2], { 1: 100, 2: 100 }, { 1: 100, 2: 1180 }, { 2: "120" });
    expect(p.take).toEqual({ 2: 120, 1: 30 });
    expect(p.left).toBe(0);
    expect(tdsPlan(50, [1], { 1: 100 }, { 1: 100 }, { 1: "200" }).over).toBeTruthy();
  });
  it("names the Indian FY quarter", () => {
    expect(quarterOf("2026-11-20")).toBe("Q3 FY26-27");
    expect(quarterOf("2027-02-01")).toBe("Q4 FY26-27");
    expect(quarterOf("2026-05-01")).toBe("Q1 FY26-27");
  });
  it("keeps the approval note as information and picks small balances", () => {
    expect(blockNote(null)).toBeNull();
    expect(blockNote("Waiting for the customer's approval")).toMatch(/approval pending/);
    expect(smallBalances([{ id: 1, balance_amount: 9.5 }, { id: 2, balance_amount: 23497 }, { id: 3, balance_amount: 0 }], 100)).toEqual([1]);
  });
});
