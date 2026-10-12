import { describe, expect, it } from "vitest";

import { withCurrentCustomer } from "./activeCustomers";

const active = [{ id: 1, name: "Aptiv" }, { id: 3, name: "Harman" }];
const all = [...active, { id: 2, name: "Ford", status: "Inactive" }];

describe("customer pickers list the Customers tab's active customers", () => {
  it("keeps the active list as it is for a new record", () => {
    expect(withCurrentCustomer(active, all, "")).toEqual(active);
    expect(withCurrentCustomer(active, all, 3)).toEqual(active);
  });

  it("adds an edited record's inactive customer back, marked", () => {
    const out = withCurrentCustomer(active, all, "2");
    expect(out.map((c) => c.name)).toEqual(["Aptiv", "Harman", "Ford (inactive)"]);
  });

  it("ignores an id it cannot name", () => {
    expect(withCurrentCustomer(active, all, 99)).toEqual(active);
  });
});
