import { describe, expect, it } from "vitest";
import { fillCash, mapProblem, mappableInvoice, pickCustomers, type MapInvoice } from "./MapMoneyDialog";

const inv = (id: number, balance: number, extra: Partial<MapInvoice> = {}): MapInvoice => ({
  id, invoice_number: `INV-${id}`, invoice_date: `2026-0${id}-01`, sub_total: balance / 1.18, grand_total: balance,
  balance_amount: balance, tds_open: 0, tds_cap: balance, has_tds: false, ...extra,
});

describe("map money from the Invoices list (20 Nov 2026)", () => {
  it("fills cash oldest first, after the TDS typed, out of what is on account", () => {
    const a = inv(1, 1180), b = inv(2, 2360);
    expect(fillCash([b, a], { 1: 100 }, 2000)).toEqual({ 1: 1080, 2: 920 });
    expect(fillCash([a, b], {}, Infinity)).toEqual({ 1: 1180, 2: 2360 });
  });

  it("says what still stops the save", () => {
    const a = inv(1, 1180);
    const room = { cash: 500, tds: 0, newCash: 0, newTds: 0 };
    expect(mapProblem([a], { 1: { cash: 0, tds: 0 } }, { kind: "none" }, { kind: "none" }, room)).toMatch(/at least one/);
    expect(mapProblem([a], { 1: { cash: 600, tds: 0 } }, { kind: "receipt", id: 9 }, { kind: "none" }, room)).toMatch(/Only ₹500/);
    expect(mapProblem([a], { 1: { cash: 1100, tds: 100 } }, { kind: "new" }, { kind: "pending" }, { ...room, newCash: 1100 }))
      .toMatch(/more than its balance/);
    expect(mapProblem([a], { 1: { cash: 1080, tds: 100 } }, { kind: "new" }, { kind: "pending" }, { ...room, newCash: 1080 })).toBe("");
    expect(mapProblem([a], { 1: { cash: 0, tds: 100 } }, { kind: "none" }, { kind: "none" }, room)).toMatch(/TDS stands/);
  });

  it("only issued invoices with money open are mappable, of one customer", () => {
    expect(mappableInvoice({ kind: "Tax", balance_amount: 10 })).toBe(true);
    expect(mappableInvoice({ kind: "Proforma", balance_amount: 10 })).toBe(false);
    expect(mappableInvoice({ kind: "Tax", balance_amount: 0 })).toBe(false);
    expect(pickCustomers([
      { id: 1, number: "a", customer_id: 5, customer_name: "Aptiv", balance: 1 },
      { id: 2, number: "b", customer_id: 5, customer_name: "Aptiv", balance: 1 },
      { id: 3, number: "c", customer_id: 6, customer_name: "Harman", balance: 1 },
    ])).toEqual(["Aptiv", "Harman"]);
  });
});
