import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CRM_NAV, CrmMeProvider, crmNavItemActive, type Me } from "../CrmApp";
import {
  OpportunitiesWorkspace,
  visibleOpportunitySubTabs,
} from "./OpportunitiesWorkspace";

vi.mock("./Opportunities", () => ({
  OpportunitiesListPage: () => <div data-testid="pipeline-view">PipelineView</div>,
}));

vi.mock("./Requirements", () => ({
  RequirementsListPage: () => <div data-testid="requirements-view">RequirementsView</div>,
}));

vi.mock("./Profiles", () => ({
  ProfilesListPage: () => <div data-testid="applicants-view">ApplicantsView</div>,
}));

function me(roles: string[]): Me {
  return {
    id: 1,
    username: "u",
    full_name: "User",
    email: "u@example.com",
    roles,
  };
}

describe("CRM Opportunities nav merge", () => {
  it("has a single Opportunities sidebar entry (no Requirements sibling)", () => {
    const paths = CRM_NAV.map((n) => n.path);
    expect(paths.filter((p) => p === "opportunities")).toHaveLength(1);
    expect(paths).not.toContain("requirements");
    const opp = CRM_NAV.find((n) => n.path === "opportunities")!;
    expect(opp.roles).toEqual(
      expect.arrayContaining(["Admin", "Sales", "Sales_Head", "RMG", "TA"]),
    );
  });

  it("highlights Opportunities for requirement deep links", () => {
    expect(crmNavItemActive("requirements/12", "opportunities")).toBe(true);
    expect(crmNavItemActive("opportunities/9", "opportunities")).toBe(true);
    expect(crmNavItemActive("customers", "opportunities")).toBe(false);
  });
});

describe("OpportunitiesWorkspace sub-tabs", () => {
  it("Sales sees Pipeline, Requirements, and Applicants", () => {
    expect(visibleOpportunitySubTabs(["Sales"])).toEqual([
      "pipeline",
      "requirements",
      "applicants",
    ]);
  });

  it("Sales_Head sees all three sub-tabs", () => {
    expect(visibleOpportunitySubTabs(["Sales_Head"])).toEqual([
      "pipeline",
      "requirements",
      "applicants",
    ]);
  });

  it("RMG sees only Requirements", () => {
    expect(visibleOpportunitySubTabs(["RMG"])).toEqual(["requirements"]);
  });

  it("mounts Pipeline by default for Sales", () => {
    render(
      <CrmMeProvider value={me(["Sales"])}>
        <OpportunitiesWorkspace />
      </CrmMeProvider>,
    );
    expect(screen.getByText("Pipeline")).toBeTruthy();
    expect(screen.getByText("Requirements")).toBeTruthy();
    expect(screen.getByText("Applicants")).toBeTruthy();
    expect(screen.getByTestId("pipeline-view")).toBeTruthy();
  });

  it("mounts Applicants sub-view for Sales_Head when preferred", () => {
    render(
      <CrmMeProvider value={me(["Sales_Head"])}>
        <OpportunitiesWorkspace preferTab="applicants" />
      </CrmMeProvider>,
    );
    expect(screen.getByTestId("applicants-view")).toBeTruthy();
  });
});
