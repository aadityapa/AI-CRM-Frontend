import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  CANDIDATE_STATUS_TONE,
  CandidateRoundStatus,
  CandidateStageBadge,
  CandidateStatusBadge,
  WaitingChip,
  candidateStatusOptions,
  waitingTone,
  type CandidateStatusCatalogue,
} from "./CandidateStatusBadge";
import { statusLabel } from "./ui";

describe("CandidateStatusBadge", () => {
  it("renders the server's words, tone and hint — never its own", () => {
    render(
      <CandidateStatusBadge
        status={{ key: "manual_l1_scheduled", label: "Manual L1 – Scheduled", tone: "warn",
          group: "internal", hint: "Manual L1 is booked." }}
        stage="RMG_Review"
      />,
    );
    const badge = screen.getByText("Manual L1 – Scheduled");
    expect(badge.className).toContain(CANDIDATE_STATUS_TONE.warn);
    expect(badge.getAttribute("title")).toBe("Manual L1 is booked.");
  });

  it("falls back to the stage label in the new vocabulary", () => {
    render(<CandidateStatusBadge status={null} stage="HR_Screening" />);
    expect(screen.getByText("HR Discussion")).toBeTruthy();
  });

  it("shows a dash when there is nothing to show", () => {
    render(<CandidateStatusBadge />);
    expect(screen.getByText("—")).toBeTruthy();
  });
});

describe("stage labels", () => {
  it("use the business sheet's words", () => {
    expect(statusLabel("HR_Screening")).toBe("HR Discussion");
    expect(statusLabel("HR_Interviewing")).toBe("HR Round");
    expect(statusLabel("Shortlisted")).toBe("Customer Shortlisted");
    expect(statusLabel("Preboarding")).toBe("Pre-Onboarding");
  });
});

describe("candidateStatusOptions", () => {
  const catalogue: CandidateStatusCatalogue = {
    groups: [{ key: "internal", label: "Internal rounds" }, { key: "closed", label: "Closed" }],
    statuses: [
      { key: "manual_l1_failed", label: "Manual L1 – Failed", tone: "bad", group: "internal", hint: "",
        active: true, closed: true },
      { key: "joined", label: "Joined", tone: "ok", group: "internal", hint: "", active: true, closed: false },
      { key: "self_withdrawn", label: "Self Withdrawn", tone: "bad", group: "closed", hint: "",
        active: false, closed: true },
    ],
  };

  it("offers only what each directory view can hold, with group labels", () => {
    expect(candidateStatusOptions(catalogue, "active").map((o) => o.value))
      .toEqual(["manual_l1_failed", "joined"]);
    expect(candidateStatusOptions(catalogue, "rejected").map((o) => o.value))
      .toEqual(["manual_l1_failed", "self_withdrawn"]);
    expect(candidateStatusOptions(catalogue, "active")[0].group).toBe("Internal rounds");
    expect(candidateStatusOptions(null)).toEqual([]);
  });
});

/* Stage + Status (28 Sep 2026): the phase, then the round with its state and date. */
describe("CandidateStageBadge / CandidateRoundStatus", () => {
  const scheduled = {
    key: "manual_l1_scheduled", label: "Manual L1 – Scheduled", tone: "warn" as const,
    group: "internal", hint: "Manual L1 is booked.",
    stage: { key: "technical_interview", label: "Technical Interview" },
    round: { key: "manual_l1", label: "Technical L1 Interview", state: "Scheduled" },
  };

  it("prints the phase", () => {
    render(<CandidateStageBadge status={scheduled} />);
    expect(screen.getByText("Technical Interview")).toBeTruthy();
  });

  it("prints the round, its state and the round's date from the row", () => {
    render(<CandidateRoundStatus status={scheduled}
      row={{ l1_manual_when: "2026-09-29T11:00:00+05:30", l2_when: "2026-10-05T11:00:00+05:30" }} />);
    expect(screen.getByText("Technical L1 Interview")).toBeTruthy();
    expect(screen.getByText("Scheduled").className).toContain(CANDIDATE_STATUS_TONE.warn);
    expect(screen.getByText(/29 Sept? 2026/)).toBeTruthy();
    expect(screen.queryByText(/5 Oct 2026/)).toBeNull();   // another round's date is not this one's
  });

  it("a status with no round state is one chip", () => {
    render(<CandidateRoundStatus status={{ ...scheduled, key: "sourcing", label: "Sourcing", tone: "info",
      round: { key: null, label: "New Applicant", state: null } }} row={{}} />);
    expect(screen.getByText("New Applicant").className).toContain(CANDIDATE_STATUS_TONE.info);
  });
});

describe("CandidateRoundStatus — who took it, how long they wait, the pop-up (30 Sep 2026)", () => {
  const status = { key: "manual_l1_passed", label: "Manual L1 – Passed", tone: "ok" as const,
    group: "internal", hint: "", round: { key: "manual_l1", label: "Technical L1 Interview", state: "Passed" } };

  it("names the panel, prints the waiting chip and opens the pop-up from the round's name", () => {
    let opened = 0;
    render(<CandidateRoundStatus status={status} waitingDays={4} onOpen={() => { opened += 1; }}
      row={{ l1_manual_when: "2026-09-28T11:00:00+05:30", l1_manual_interviewer: "Suresh K" }} />);
    expect(screen.getByText("with Suresh K")).toBeTruthy();
    expect(screen.getByText("Waiting 4 d")).toBeTruthy();
    screen.getByRole("button", { name: "Technical L1 Interview" }).click();
    expect(opened).toBe(1);
  });

  it("the AI L1 is taken by the AI interviewer; a round with no name says nothing", () => {
    const { unmount } = render(<CandidateRoundStatus
      status={{ ...status, round: { key: "ai_l1", label: "Technical L1 Interview (AI)", state: "Scheduled" } }}
      row={{}} />);
    expect(screen.getByText("with AI interviewer")).toBeTruthy();
    unmount();
    render(<CandidateRoundStatus status={status} row={{}} />);
    expect(screen.queryByText(/^with /)).toBeNull();
  });

  it("waiting turns amber at 3 days and red at 7; today reads Today", () => {
    expect(waitingTone(0)).toBe("neutral");
    expect(waitingTone(3)).toBe("warn");
    expect(waitingTone(7)).toBe("bad");
    render(<WaitingChip days={0} />);
    expect(screen.getByText("Today")).toBeTruthy();
  });
});
