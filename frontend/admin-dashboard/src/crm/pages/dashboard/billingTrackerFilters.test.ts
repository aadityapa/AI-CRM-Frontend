import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, activeChips, moreFilterCount, trackerQuery, withDefaults } from "./billingTrackerFilters";

describe("billing tracker filters (24 Oct 2026)", () => {
  it("an old session filter gets the new keys", () => {
    const f = withDefaults({ stage: "all", customer: "3" } as never);
    expect(f.flags).toEqual([]);
    expect(f.dateField).toBe("invoice");
    expect(f.customer).toBe("3");
  });

  it("sends only what is set, with the date field only when a date is set", () => {
    const q = trackerQuery({ ...EMPTY_FILTERS, branch: "0", late: "late", flags: ["tds_pending", "split"] }, 2, 15);
    expect(q).toMatchObject({ stage: "open", branch_id: "0", late: "late", flags: "tds_pending,split", page: 2, limit: 15 });
    expect(q.date_field).toBeUndefined();
    expect(q.customer_id).toBeUndefined();
    expect(trackerQuery({ ...EMPTY_FILTERS, dateField: "due", dateFrom: "2026-09-01" }, 1, 15).date_field).toBe("due");
    expect(trackerQuery({ ...EMPTY_FILTERS, stage: "all" }, 1, 15).stage).toBe("");
  });

  it("names every filter that is on and clears the dependants", () => {
    const f = { ...EMPTY_FILTERS, customer: "5", project: "9", po: "0", waitingMin: "7", flags: ["overdue" as const] };
    expect(moreFilterCount(f)).toBe(4);
    const chips = activeChips(f, { customers: [{ id: 5, name: "MAHLE" }], projects: [{ id: 9, name: "Mahle_T&M" }] });
    expect(chips.map((c) => c.label)).toEqual(["MAHLE", "Project: Mahle_T&M", "No PO", "Waiting 7+ days", "Overdue only"]);
    expect(chips[0].clear).toEqual({ customer: "", branch: "", project: "" });
    expect(chips[4].clear).toEqual({ flags: [] });
  });
});
