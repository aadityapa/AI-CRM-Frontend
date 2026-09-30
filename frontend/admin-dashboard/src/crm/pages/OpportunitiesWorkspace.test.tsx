import { beforeEach, describe, it, expect, vi } from "vitest";
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


/* The workspace keeps its tab in the address and in the session (29 Sep 2026,
   crm/lib/pageState.ts) — reset both so one test's tab never opens the next. */
beforeEach(() => {
  window.history.replaceState({}, "", "/admin/?view=crm&p=opportunities");
  window.sessionStorage.clear();
});

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

/* 26 Sep 2026: a GM is a CUSTOM role — no built-in role at all — so every
   role-list gate here said no and the page read "You do not have access to
   Opportunities". For a grant-driven user the tab GRANTS decide. */
function gm(tabs: Record<string, "view" | "edit" | "create">): Me {
  return {
    ...me(["GM"]),
    access: { full: false, tabs, visible_tabs: Object.keys(tabs), source: "custom_role" },
  };
}

describe("OpportunitiesWorkspace for a custom role (GM)", () => {
  it("shows Pipeline, a Requirements button and Applicants from the grants", () => {
    render(
      <CrmMeProvider value={gm({ opportunities: "view", requirements: "edit", profiles: "edit" })}>
        <OpportunitiesWorkspace />
      </CrmMeProvider>,
    );
    expect(screen.getByText("Pipeline T&M")).toBeTruthy();
    expect(screen.getByText("Requirements")).toBeTruthy();
    expect(screen.getByText("Applicants")).toBeTruthy();
    expect(screen.queryByText("Template Requests")).toBeNull();
    expect(screen.getByTestId("pipeline-view")).toBeTruthy();
  });

  it("renders the Requirements list full-page when that is the only grant", () => {
    render(
      <CrmMeProvider value={gm({ requirements: "view" })}>
        <OpportunitiesWorkspace />
      </CrmMeProvider>,
    );
    expect(screen.getByTestId("requirements-view")).toBeTruthy();
    expect(screen.queryByText("Pipeline T&M")).toBeNull();
  });

  it("still refuses when no relevant tab is granted", () => {
    render(
      <CrmMeProvider value={gm({ timesheets: "edit" })}>
        <OpportunitiesWorkspace />
      </CrmMeProvider>,
    );
    expect(screen.getByText("You do not have access to Opportunities.")).toBeTruthy();
  });

  it("keeps the role-based strip for an untemplated Sales user (no Requirements button)", () => {
    render(
      <CrmMeProvider value={me(["Sales"])}>
        <OpportunitiesWorkspace />
      </CrmMeProvider>,
    );
    expect(screen.queryByText("Requirements")).toBeNull();
  });

  it("keeps the TA layout for a templated TA whose template grants Opportunities (28 Sep 2026)", () => {
    // Reported with screenshots: a TA template granting the Opportunities tab
    // turned TA's page into the Sales pipeline. A built-in role keeps its layout.
    const ta: Me = {
      ...me(["TA"]),
      access: { full: false, tabs: { opportunities: "view", requirements: "edit", profiles: "edit" },
                visible_tabs: ["opportunities", "requirements", "profiles"], source: "template" },
    };
    render(
      <CrmMeProvider value={ta}>
        <OpportunitiesWorkspace />
      </CrmMeProvider>,
    );
    expect(screen.getByTestId("requirements-view")).toBeTruthy();
    expect(screen.queryByText("Pipeline T&M")).toBeNull();
    expect(screen.queryByTestId("pipeline-view")).toBeNull();
  });
});
