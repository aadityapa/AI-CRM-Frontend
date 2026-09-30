import { describe, expect, it } from "vitest";

import { filterPos, poScopes, type PoOption } from "./PoPicker";

const po = (id: number, extra: Partial<PoOption>): PoOption => ({
  id, po_number: `PO-${id}`, status: "Active", total_value: 100, used_value: 0, balance_value: 100,
  start_date: `2026-0${id}-01`, ...extra,
});

const book = [
  po(1, { employee_match: true, tagged_to_employee: true }),
  po(2, { employee_match: true, billed_before: 2 }),
  po(3, { project_allocated: 50 }),
  po(4, { expired: true, status: "Active" }),
  po(5, { status: "Cancelled", selectable: false, employee_name: "Someone Else" }),
];

describe("PoPicker — scopes and filters (30 Sep 2026)", () => {
  it("opens on this employee's POs when there are any, else the project's, else all", () => {
    expect(poScopes(book)).toMatchObject({ employee: 2, project: 1, all: 5, initial: "employee" });
    expect(poScopes([po(3, { project_allocated: 1 })]).initial).toBe("project");
    expect(poScopes([po(9, {})]).initial).toBe("all");
  });

  it("the employee scope is the tagged + billed-before POs; live hides expired and cancelled", () => {
    const ids = (f: Parameters<typeof filterPos>[1]) => filterPos(book, f).map((p) => p.id);
    expect(ids({ scope: "employee", liveness: "live", search: "", sort: "best" })).toEqual([1, 2]);
    expect(ids({ scope: "all", liveness: "live", search: "", sort: "newest" })).toEqual([3, 2, 1]);
    expect(ids({ scope: "all", liveness: "expired", search: "", sort: "best" })).toEqual([4]);
    expect(ids({ scope: "all", liveness: "all", search: "someone", sort: "best" })).toEqual([5]);
  });

  it("best match puts the suggested PO first, then the tagged one, then billed-before", () => {
    const ids = filterPos(book, { scope: "all", liveness: "all", search: "", sort: "best", suggestedId: 2 }).map((p) => p.id);
    expect(ids.slice(0, 3)).toEqual([2, 1, 3]);
  });
});
