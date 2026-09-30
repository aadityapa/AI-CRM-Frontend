/**
 * Candidate Profiles directory redesign (29 Sep 2026): one column per round
 * (verdict · date & time · panel · feedback), the next interview, the stage.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { DEFAULT_PROFILE_COLUMNS, buildProfileColumns, type ProfileColumnRow } from "./profileColumns";

const helpers = {
  fmtLac: (v?: number | null) => String(v ?? "—"),
  fmtHike: (v?: number | null) => String(v ?? "—"),
  fmtDate: (v?: string | null) => v || "—",
  fmtDateTime: (v?: string | null) => v || null,
  roundLabel: (k: string) => k,
};

const row = {
  id: 1, candidate_id: 2, opportunity_id: 3, pipeline_status: "Customer_Interview",
  current_ctc: null, expected_ctc: null, hike_percent: null, ctc_approval_amount: null,
  candidate_status: { key: "customer_l1_scheduled", label: "Customer L1 – Scheduled", tone: "info", group: "customer",
    hint: "", stage: { key: "customer_interviewing", label: "Customer Interviewing" } },
  rounds: {
    tech_l1: { event_id: 9, when: "2026-09-20T05:30:00+00:00", result: "Hire", status: "Completed",
      interviewer: "Ravi Kumar", mode: "Video", feedback: "Strong on AUTOSAR", upcoming: false },
  },
  next_interview: { round: "Customer L1", round_key: "cust_l1", when: new Date(Date.now() + 3 * 3600_000).toISOString(),
    interviewer: "Anoop", event_id: 11, meeting_link: false },
} as unknown as ProfileColumnRow;

function cell(key: string) {
  const col = buildProfileColumns(helpers).find((c) => c.key === key)!;
  return render(<div>{col.render!(row)}</div>);
}

describe("Candidate Profiles columns", () => {
  it("the default layout leads with the stage, the next interview and the round ladder", () => {
    expect(DEFAULT_PROFILE_COLUMNS.slice(0, 5)).toEqual(["candidate_name", "opportunity", "phase", "pipeline_status", "next_interview"]);
    expect(DEFAULT_PROFILE_COLUMNS.filter((k) => k.startsWith("round_"))).toEqual(
      ["round_tech_l1", "round_tech_l2", "round_cust_l1", "round_cust_l2", "round_hr"]);
  });

  it("a round cell shows the verdict, the panel and the feedback; an empty one a dash", () => {
    cell("round_tech_l1");
    expect(screen.getByText("Hire")).toBeTruthy();
    expect(screen.getByText("Ravi Kumar")).toBeTruthy();
    expect(screen.getByText("“Strong on AUTOSAR”")).toBeTruthy();
    cell("round_hr");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("the next interview says which round, how soon, and when the link is missing", () => {
    cell("next_interview");
    expect(screen.getByText("Customer L1")).toBeTruthy();
    expect(screen.getByText(/in 3 h · no link/)).toBeTruthy();
    cell("phase");
    expect(screen.getByText("Customer Interviewing")).toBeTruthy();
  });
});
