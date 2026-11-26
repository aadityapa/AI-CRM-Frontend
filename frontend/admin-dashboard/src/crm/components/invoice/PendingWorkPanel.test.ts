import { describe, expect, it } from "vitest";
import {
  EMPTY_PENDING_FILTERS, LANES, STAGE_ORDER, activeFilterCount, groupRows, pendingQuery, rowAction, stepOf,
  toggleLane, toggleStage, waitText, waitTone, type PendingRow,
} from "./PendingWorkPanel";
import { INVOICE_STAGE_TABS, PENDING_TAB_KEY } from "../../lib/invoiceStages";

describe("Invoices ▸ Pending work (26 Nov 2026)", () => {
  it("sends only the filters that are on, stages in chain order", () => {
    const f = { ...EMPTY_PENDING_FILTERS, stages: toggleStage(toggleStage([], "proforma"), "awaiting_approval"),
      customer: "4", search: "  k103 " };
    const q = pendingQuery(f, 2);
    expect(q.stage).toBe("awaiting_approval,proforma");
    expect(q.customer_id).toBe("4");
    expect(q.search).toBe("k103");
    expect(q.employee_id).toBeUndefined();
    expect(q.page).toBe(2);
    expect(activeFilterCount(f)).toBe(2);
    expect(toggleStage(["proforma"], "proforma")).toEqual([]);
  });

  it("each step's button goes where the work is done", () => {
    const base = { key: "k", stage_label: "", next_owner: "" } as const;
    const can = { approve: true, raise: false, convert: true };
    expect(rowAction({ ...base, stage: "awaiting_approval", timesheet_id: 7 } as PendingRow, can))
      .toEqual({ to: "timesheets/7", label: "Review & approve" });
    expect(rowAction({ ...base, stage: "to_raise", timesheet_id: 7 } as PendingRow, can)?.label).toBe("Open timesheet");
    expect(rowAction({ ...base, stage: "proforma", invoice_id: 9 } as PendingRow, can))
      .toEqual({ to: "invoices/9", label: "Generate tax invoice" });
    expect(rowAction({ ...base, stage: "not_created" } as PendingRow, can)?.to).toBe("timesheets?tab=due");
    expect(waitTone(20)).toContain("rose");
    expect(waitTone(1)).toContain("emerald");
  });

  it("reads at a glance: lanes, the progress rail, waiting words, grouping", () => {
    expect(toggleLane([], LANES[0].stages)).toEqual(["not_created", "not_submitted", "rejected"]);
    expect(toggleLane(["not_created", "not_submitted", "rejected"], LANES[0].stages)).toEqual([]);
    expect(LANES.flatMap((l) => l.stages).sort()).toEqual([...STAGE_ORDER].sort());
    expect(stepOf("awaiting_approval")).toEqual({ current: 2, blocked: false });
    expect(stepOf("returned")).toEqual({ current: 3, blocked: true });
    expect(waitText(239)).toEqual({ main: "239 days", sub: "about 8 months" });
    expect(waitText(1).main).toBe("1 day");
    expect(waitText(0).main).toBe("Today");
    expect(pendingQuery({ ...EMPTY_PENDING_FILTERS, groupBy: "project", pageSize: 100 }, 1))
      .toMatchObject({ sort: "project", limit: 100 });
    const rows = [
      { key: "a", stage: "proforma", customer_id: 1, customer: "Uno", amount: 10 },
      { key: "b", stage: "rejected", customer_id: 2, customer: "Harman" },
      { key: "c", stage: "proforma", customer_id: 1, customer: "Uno", amount: 5 },
    ] as PendingRow[];
    const g = groupRows(rows, "customer");
    expect(g.map((x) => [x.label, x.rows.length, x.amount])).toEqual([["Uno", 2, 15], ["Harman", 1, 0]]);
    expect(groupRows(rows, "")).toHaveLength(1);
  });

  it("is a tab right after All", () => {
    const keys = INVOICE_STAGE_TABS.map((t) => t.key);
    expect(keys.indexOf(PENDING_TAB_KEY)).toBe(1);
  });
});
