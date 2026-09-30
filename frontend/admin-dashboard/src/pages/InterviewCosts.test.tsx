import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { ThemeProvider } from "../theme/ThemeProvider";
import { AiCostsPage, InterviewCostsTab } from "./InterviewCosts";
import type { InterviewCostReport } from "../api/aiCosts";

// recharts' ResponsiveContainer measures itself; jsdom has no ResizeObserver.
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;

const report: InterviewCostReport = {
  period: { date_from: "2026-09-01", date_to: "2026-09-28", granularity: "day", days: 28 },
  usd_inr_rate: 84,
  summary: {
    interviews: 2, completed: 1, cost_usd: 0.42, cost_inr: 35.28, avg_cost_usd: 0.21, avg_cost_inr: 17.64,
    max_cost_usd: 0.3, cost_chat_usd: 0.3, cost_tts_usd: 0.08, cost_stt_usd: 0.04, estimated_usd: 0, estimated_interviews: 0, calls: 12, failed_calls: 1,
    tokens: 12000, audio_minutes: 6.5, avg_duration_min: 30, other_spend_usd: 0.1, other_spend_inr: 8.4,
    total_spend_usd: 0.52, total_spend_inr: 43.68,
  },
  series: [{ key: "2026-09-25", label: "25 Sep 2026", interviews: 1, cost_usd: 0.3, cost_chat_usd: 0.2,
    cost_tts_usd: 0.06, cost_stt_usd: 0.04, tokens: 9000, audio_minutes: 5, avg_cost_usd: 0.3 }],
  by_kind: [
    { kind: "chat", label: "Questions & evaluation (chat)", cost_usd: 0.3 },
    { kind: "tts", label: "Spoken questions (TTS)", cost_usd: 0.08 },
    { kind: "stt", label: "Candidate speech (transcription)", cost_usd: 0.04 },
  ],
  by_customer: [{ id: 1, label: "HARMAN", interviews: 1, cost_usd: 0.3, avg_cost_usd: 0.3 }],
  by_template: [{ id: "Java Dev", label: "Java Dev", interviews: 1, cost_usd: 0.3, avg_cost_usd: 0.3 }],
  by_ta: [{ id: "Tara TA", label: "Tara TA", interviews: 1, cost_usd: 0.3, avg_cost_usd: 0.3 }],
  other_spend: { cost_usd: 0.1, families: [{ label: "ATS scoring", calls: 3, cost_usd: 0.1 }] },
  top_interviews: [],
  options: { customers: [{ id: 1, name: "HARMAN" }], ta_owners: ["Tara TA"], templates: ["Java Dev"],
    statuses: ["completed", "started"], granularities: ["day", "week", "month", "quarter", "fy"] },
  interviews: [{
    interview_id: "IV-A", invite_token: "t", candidate_name: "Asha Rao", candidate_email: "asha@x.com",
    template_name: "Java Dev", status: "completed", scheduled_at: "2026-09-25 10:00",
    started_at: "2026-09-25T10:01:00+05:30", completed_at: "2026-09-25T10:31:00+05:30", duration_min: 30,
    questions_answered: 6, scheduled_by: "tara", calls: 10, failed_calls: 0, tokens_in: 8000, tokens_out: 1000,
    tokens: 9000, audio_minutes: 5, cost_usd: 0.3, cost_chat_usd: 0.2, cost_tts_usd: 0.06, cost_stt_usd: 0.04, estimated_usd: 0,
    cost_inr: 25.2, day: "2026-09-25", first_at: "2026-09-25T10:01:00+05:30", last_at: null, profile_id: 7,
    ai_result: "Passed", ai_score: 72, ta_owner_name: "Tara TA", opportunity_id: 3, opp_id: "OPP-7",
    opportunity_title: "Java Developer", customer_id: 1, customer_name: "HARMAN",
  }],
};

vi.mock("../api/aiCosts", async () => {
  const actual = await vi.importActual<typeof import("../api/aiCosts")>("../api/aiCosts");
  return {
    ...actual,
    getInterviewCosts: vi.fn(async () => ({ data: report, meta: { total: 1, page: 1, limit: 25 }, message: "" })),
    downloadInterviewCostsCsv: vi.fn(async () => undefined),
  };
});

describe("AI Costs", () => {
  it("renders the spend, the trend zooms and the interview row from the server payload", async () => {
    render(<ThemeProvider><InterviewCostsTab /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText("Asha Rao")).toBeTruthy());
    expect(screen.getAllByText(/₹35/).length).toBeGreaterThan(0);   // interview spend in rupees
    expect(screen.getByText("HARMAN", { selector: "div" })).toBeTruthy();
    expect(screen.getByText("OPP-7 · Java Developer")).toBeTruthy();
    for (const z of ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly (FY)"]) {
      expect(screen.getByRole("tab", { name: z })).toBeTruthy();
    }
    expect(screen.getByText("Export CSV")).toBeTruthy();
    expect(screen.getByText(/@ ₹84\/\$/)).toBeTruthy();
    expect(screen.getByText("ATS scoring", { exact: false })).toBeTruthy();
  });

  it("is offered to Admin / CEO only", async () => {
    const { unmount } = render(<ThemeProvider><AiCostsPage roles={["RMG"]} /></ThemeProvider>);
    expect(screen.getByText(/Admin and CEO logins only/)).toBeTruthy();
    expect(screen.queryByText("Export CSV")).toBeNull();
    unmount();
    render(<ThemeProvider><AiCostsPage roles={["CEO"]} /></ThemeProvider>);
    expect(screen.getByRole("heading", { name: "AI Costs" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Export CSV")).toBeTruthy());
  });
});
