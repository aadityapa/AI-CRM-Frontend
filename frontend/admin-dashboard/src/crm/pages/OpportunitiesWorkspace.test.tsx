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
  it("Sales sees Pipeline T&M, Pipeline SOW, and Applicants", () => {
    expect(visibleOpportunitySubTabs(["Sales"])).toEqual([
      "pipeline",
      "sow",
      "applicants",
    ]);
  });

  it("Sales_Head sees the same three sub-tabs", () => {
    expect(visibleOpportunitySubTabs(["Sales_Head"])).toEqual([
      "pipeline",
      "sow",
      "applicants",
    ]);
  });

  it("RMG sees no tab buttons (Requirements is deep-link only now)", () => {
    expect(visibleOpportunitySubTabs(["RMG"])).toEqual([]);
  });

  it("gives Admin the Template Requests sub-tab (their sidebar entry is hidden)", () => {
    expect(visibleOpportunitySubTabs(["Admin"])).toEqual([
      "pipeline",
      "sow",
      "applicants",
      "template-requests",
    ]);
    expect(visibleOpportunitySubTabs(["CEO"])).toEqual([
      "pipeline",
      "sow",
      "applicants",
      "template-requests",
    ]);
  });

  it("mounts Pipeline T&M by default for Sales", () => {
    render(
      <CrmMeProvider value={me(["Sales"])}>
        <OpportunitiesWorkspace />
      </CrmMeProvider>,
    );
    expect(screen.getByText("Pipeline T&M")).toBeTruthy();
    expect(screen.getByText("Pipeline SOW")).toBeTruthy();
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
