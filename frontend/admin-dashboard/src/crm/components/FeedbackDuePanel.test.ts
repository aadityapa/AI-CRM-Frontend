import { describe, expect, it } from "vitest";

import { EMPTY_FEEDBACK_FILTER, filterFeedback, groupFeedback, type FeedbackItem } from "./FeedbackDuePanel";

const item = (o: Partial<FeedbackItem>): FeedbackItem => ({
  key: o.key || Math.random().toString(), title: "X", subtitle: "", chip: "Technical L1", tone: "warn",
  when: "2026-09-29T10:00:00+00:00", path: "", action: "Record feedback", profile_id: 1,
  section: "C-1 · Bluetooth Developer", round_kind: "L1_Interview", ...o,
});

describe("FeedbackDuePanel (30 Sep 2026): the overdue verdicts by position or by day, filtered", () => {
  const items = [
    item({ key: "a", title: "Anu", when: "2026-09-29T10:00:00+00:00" }),
    item({ key: "b", title: "Bala", when: "2026-09-28T09:00:00+00:00", section: "C-2 · Ethernet Engineer", round_kind: "L2_F2F", chip: "Technical L2" }),
    item({ key: "c", title: "Chitra", when: "2026-09-29T08:00:00+00:00", interviewer: "Ravi" }),
  ];

  it("groups by position (largest group first, oldest inside) and by day (newest day first)", () => {
    const byPos = groupFeedback(items, "position");
    expect(byPos.map((g) => [g.label, g.items.map((i) => i.title)])).toEqual([
      ["C-1 · Bluetooth Developer", ["Chitra", "Anu"]],
      ["C-2 · Ethernet Engineer", ["Bala"]],
    ]);
    const byDay = groupFeedback(items, "day");
    expect(byDay.map((g) => g.key)).toEqual(["2026-09-29", "2026-09-28"]);
    expect(byDay[0].items.map((i) => i.title)).toEqual(["Chitra", "Anu"]);
  });

  it("filters by round, position and free text (name · interviewer · position)", () => {
    expect(filterFeedback(items, { ...EMPTY_FEEDBACK_FILTER, round: "L2_F2F" }).map((i) => i.title)).toEqual(["Bala"]);
    expect(filterFeedback(items, { ...EMPTY_FEEDBACK_FILTER, position: "C-1 · Bluetooth Developer" })).toHaveLength(2);
    expect(filterFeedback(items, { ...EMPTY_FEEDBACK_FILTER, q: "ravi" }).map((i) => i.title)).toEqual(["Chitra"]);
    expect(filterFeedback(items, { ...EMPTY_FEEDBACK_FILTER, q: "ethernet" }).map((i) => i.title)).toEqual(["Bala"]);
  });
});
