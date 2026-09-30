import { describe, expect, it } from "vitest";

import { displayRoles, roleTitle } from "../../CrmApp";
import { groupBySection } from "./WorkDesk";
import { EMPTY_FILTER, facetOptions, filterItems } from "./taskFilters";

describe("My Tasks sections (29 Sep 2026)", () => {
  it("groups items by section in server order", () => {
    const g = groupBySection([
      { k: 1, section: "HARMAN" }, { k: 2, section: "VISTEON" }, { k: 3, section: "HARMAN" }, { k: 4 },
    ]);
    expect(g.map((x) => [x.section, x.items.map((i) => i.k)])).toEqual([
      ["HARMAN", [1, 3]], ["VISTEON", [2]], [null, [4]],
    ]);
  });

  it("groups by employee on request (30 Sep 2026) — a manual invoice names nobody", () => {
    const g = groupBySection([
      { k: 1, section: "HARMAN", employee: "Asha Rao" }, { k: 2, section: "VISTEON", employee: "Ravi K" },
      { k: 3, section: "HARMAN", employee: "Asha Rao" }, { k: 4, section: "HARMAN" },
    ], "employee");
    expect(g.map((x) => [x.section, x.items.map((i) => i.k)])).toEqual([
      ["Asha Rao", [1, 3]], ["No employee named", [4]], ["Ravi K", [2]],
    ]);
  });

  it("the employee facet filters and is offered only when it can narrow the list", () => {
    const items = [
      { key: "a", title: "PI-1", subtitle: "", chip: null, tone: "info" as const, customer: "HARMAN", employee: "Asha Rao" },
      { key: "b", title: "PI-2", subtitle: "", chip: null, tone: "info" as const, customer: "HARMAN", employee: "Ravi K" },
    ];
    expect(facetOptions(items).employees).toEqual(["Asha Rao", "Ravi K"]);
    expect(filterItems(items, { ...EMPTY_FILTER, employee: "Ravi K" }).map((i) => i.key)).toEqual(["b"]);
    expect(filterItems(items, { ...EMPTY_FILTER, q: "asha" }).map((i) => i.key)).toEqual(["a"]);
  });

  it("TA's Pending activities (30 Sep 2026): the activity and the round are facets too", () => {
    const items = [
      { key: "a", title: "Meera", subtitle: "", chip: "AI L1", tone: "warn" as const, activity: "L1 / L2 interviews", round_kind: "AI_L1" },
      { key: "b", title: "Arun", subtitle: "", chip: "Technical L1", tone: "warn" as const, activity: "L1 / L2 interviews", round_kind: "L1_Interview" },
      { key: "c", title: "Fresh", subtitle: "", chip: "Not sent for screening", tone: "info" as const, activity: "Awaiting your call", round_kind: null },
    ];
    const opts = facetOptions(items);
    expect(opts.activities).toEqual(["Awaiting your call", "L1 / L2 interviews"]);
    expect(opts.rounds).toEqual(["AI_L1", "L1_Interview"]);
    expect(filterItems(items, { ...EMPTY_FILTER, activity: "Awaiting your call" }).map((i) => i.key)).toEqual(["c"]);
    expect(filterItems(items, { ...EMPTY_FILTER, round: "AI_L1" }).map((i) => i.key)).toEqual(["a"]);
  });
});

describe("role chips (29 Sep 2026)", () => {
  it("names a Sales Manager as itself, not the roles it carries", () => {
    const me = { roles: ["Sales", "Sales Manager"], display_roles: ["Sales Manager"] };
    expect(displayRoles(me)).toEqual(["Sales Manager"]);
    expect(roleTitle(me)).toBe("Sales Manager");
  });
  it("puts the highest rung first", () => {
    expect(displayRoles({ roles: ["TA", "Sales_Head", "Sales"] })).toEqual(["Sales_Head", "Sales", "TA"]);
    expect(roleTitle({ roles: ["Sales", "CEO"] })).toBe("CEO");
  });
});
