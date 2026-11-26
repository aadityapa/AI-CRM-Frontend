import { describe, expect, it } from "vitest";
import { allTotal, branchTotals } from "./BranchSummary";

describe("Received Amount by branch (24 Nov 2026)", () => {
  const rows = [
    { branch_id: 2, branch_name: "Visteon Pune", amount: 39744, unallocated_amount: 0, received_date: "2026-10-15" },
    { branch_id: 2, branch_name: "Visteon Pune", amount: 461376, unallocated_amount: 0, tds_pending: 8640, received_date: "2026-09-24" },
    { branch_id: null, branch_name: null, amount: 461376, unallocated_amount: 461376, received_date: "2026-09-24" },
    { branch_id: 1, branch_name: "Visteon - Bangalore", amount: 784160, unallocated_amount: 784160, received_date: "2026-10-29" },
  ];

  it("adds each branch up — biggest payer first, no branch last", () => {
    const t = branchTotals(rows);
    expect(t.map((x) => x.name)).toEqual(["Visteon - Bangalore", "Visteon Pune", "No branch on record"]);
    const pune = t[1];
    expect(pune.receipts).toBe(2);
    expect(pune.received).toBe(501120);
    expect(pune.tdsPending).toBe(8640);
    expect(pune.last).toBe("2026-10-15");
    expect(t[2].key).toBe(0);
  });

  it("the All branches card is every branch together", () => {
    const all = allTotal(branchTotals(rows));
    expect(all.receipts).toBe(4);
    expect(all.received).toBe(1746656);
    expect(all.onAccount).toBe(1245536);
    expect(all.last).toBe("2026-10-29");
  });
});
