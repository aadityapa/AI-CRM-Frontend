import { describe, expect, it } from "vitest";
import { panelBuckets } from "./PanelDashboard";
import { feedbackOpensAt } from "../MyInterviews";
import { safeFilePath } from "../FileView";
import type { MyRound } from "../MyInterviews";

const now = new Date(2026, 9, 10, 12, 0);
const r = (id: number, phase: MyRound["phase"], at: Date | null, result: string | null = null) => ({
  id, profile_id: 1, kind: "L1_Interview", round_label: "L1", phase, scheduled_at: at ? at.toISOString() : null,
  raw_when: null, duration_minutes: 60, meeting_link: null, status: null, result, feedback: null, note: null,
  interviewer: null, candidate: { id: 1, name: `C${id}`, email: null, phone: null, experience_years: null, technical_domain: null, cv_url: null },
  position: { opportunity_id: null, opp_id: null, title: null, customer_name: null }, ai_l1: null,
} as MyRound);

describe("panel dashboard", () => {
  it("splits today / due / next week / recent", () => {
    const b = panelBuckets([
      r(1, "upcoming", new Date(2026, 9, 10, 15, 0)),
      r(2, "pending", new Date(2026, 9, 10, 10, 0)),
      r(3, "upcoming", new Date(2026, 9, 13, 10, 0)),
      r(4, "done", new Date(2026, 9, 2, 10, 0), "Hire"),
      r(5, "no_show", new Date(2026, 9, 9, 10, 0)),
      r(6, "upcoming", new Date(2026, 9, 30, 10, 0)),
    ], now);
    expect(b.today.map((x) => x.id)).toEqual([2, 1]);
    expect(b.due.map((x) => x.id)).toEqual([2]);
    expect(b.next.map((x) => x.id)).toEqual([3]);
    expect(b.recent.map((x) => x.id)).toEqual([5, 4]);
    expect(b.doneThisMonth).toBe(1);
    expect(b.noShows).toBe(1);
  });

  it("feedback opens 10 minutes after the start", () => {
    const start = new Date(2026, 9, 10, 11, 0);
    expect(feedbackOpensAt({ scheduled_at: start.toISOString() })!.getTime()).toBe(start.getTime() + 10 * 60_000);
    expect(feedbackOpensAt({ scheduled_at: null })).toBeNull();
  });

  it("opens only CRM files in the file tab", () => {
    expect(safeFilePath("/api/crm-files/resumes/a.pdf")).toBe("/api/crm-files/resumes/a.pdf");
    expect(safeFilePath("https://evil.example/api/crm-files/a.pdf")).toBeNull();
    expect(safeFilePath("/api/users")).toBeNull();
  });
});
