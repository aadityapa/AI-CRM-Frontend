import { describe, expect, it } from "vitest";
import { NO_BRANCH, scopedProjects, type FilterOption } from "./ScopeFilterBar";
import { branchTotals } from "../pages/FinanceReports";

const projects: FilterOption[] = [
  { id: 1, name: "P-Pune", customer_id: 7, branch_id: 11 },
  { id: 2, name: "P-Blr", customer_id: 7, branch_id: 12 },
  { id: 3, name: "P-None", customer_id: 7, branch_id: null },
  { id: 4, name: "Other", customer_id: 8, branch_id: 21 },
];

describe("branch scope (2 Nov 2026)", () => {
  it("lists the projects of the chosen customer and branch", () => {
    expect(scopedProjects(projects, null, null).map((p) => p.id)).toEqual([1, 2, 3, 4]);
    expect(scopedProjects(projects, 7, null).map((p) => p.id)).toEqual([1, 2, 3]);
    expect(scopedProjects(projects, 7, 12).map((p) => p.id)).toEqual([2]);
    expect(scopedProjects(projects, 7, NO_BRANCH).map((p) => p.id)).toEqual([3]);
  });

  it("adds up the branch cards for All branches", () => {
    expect(branchTotals([
      { branch_id: 11, branch_name: "Pune", invoices: 1, debit: 100, credit: 40, balance: 60 },
      { branch_id: 0, branch_name: "No branch on record", invoices: 2, debit: 20, credit: 5, balance: 15 },
    ])).toEqual({ invoices: 3, debit: 120, credit: 45, balance: 75 });
  });
});
