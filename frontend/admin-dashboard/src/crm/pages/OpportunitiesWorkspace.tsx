/** Unified Opportunities workspace — Pipeline + Requirements + Applicants sub-tabs.
 * Keeps both data models / detail routes separate; only merges list navigation. */
import React, { useEffect, useMemo, useState } from "react";
import { useHasRole } from "../CrmApp";
import { Tabs } from "../components/ui";
import { OpportunitiesListPage } from "./Opportunities";
import { RequirementsListPage } from "./Requirements";
import { ProfilesListPage } from "./Profiles";

export type OppWorkspaceTab = "pipeline" | "requirements" | "applicants";

/** Roles that see the Pipeline (opportunities table) sub-tab. */
export const PIPELINE_TAB_ROLES = ["Admin", "Sales", "Sales_Head"] as const;

/** Roles that see the Requirements sub-tab. */
export const REQUIREMENTS_TAB_ROLES = ["Admin", "Sales", "Sales_Head", "RMG", "TA"] as const;

/** Roles that see the cross-opportunity Applicants sub-tab. */
export const APPLICANTS_TAB_ROLES = ["Admin", "Sales", "Sales_Head"] as const;

/** Union used by the single sidebar "Opportunities" nav entry. */
export const OPPORTUNITIES_NAV_ROLES = [
  "Admin",
  "Sales",
  "Sales_Head",
  "RMG",
  "TA",
] as const;

/** Pure helper for tests + default-tab selection. */
export function visibleOpportunitySubTabs(roles: string[]): OppWorkspaceTab[] {
  const set = new Set(roles);
  const isAdmin = set.has("Admin") || set.has("CEO");
  const tabs: OppWorkspaceTab[] = [];
  if (isAdmin || PIPELINE_TAB_ROLES.some((r) => set.has(r))) tabs.push("pipeline");
  if (isAdmin || REQUIREMENTS_TAB_ROLES.some((r) => set.has(r))) tabs.push("requirements");
  if (isAdmin || APPLICANTS_TAB_ROLES.some((r) => set.has(r))) tabs.push("applicants");
  return tabs;
}

function readInitialTab(fallback: OppWorkspaceTab): OppWorkspaceTab {
  try {
    const v = new URLSearchParams(window.location.search).get("opp_tab");
    if (v === "requirements" || v === "pipeline" || v === "applicants") return v;
  } catch {
    /* ignore */
  }
  return fallback;
}

export function OpportunitiesWorkspace({
  preferTab,
}: {
  preferTab?: OppWorkspaceTab;
} = {}) {
  const canPipeline = useHasRole(...PIPELINE_TAB_ROLES);
  const canRequirements = useHasRole(...REQUIREMENTS_TAB_ROLES);
  const canApplicants = useHasRole(...APPLICANTS_TAB_ROLES);

  const tabs = useMemo(() => {
    const out: { key: OppWorkspaceTab; label: string }[] = [];
    if (canPipeline) out.push({ key: "pipeline", label: "Pipeline" });
    if (canRequirements) out.push({ key: "requirements", label: "Requirements" });
    if (canApplicants) out.push({ key: "applicants", label: "Applicants" });
    return out;
  }, [canPipeline, canRequirements, canApplicants]);

  const defaultTab = preferTab && tabs.some((t) => t.key === preferTab)
    ? preferTab
    : (tabs[0]?.key || "pipeline");

  const [tab, setTab] = useState<OppWorkspaceTab>(() =>
    preferTab && (preferTab === "pipeline" || preferTab === "requirements" || preferTab === "applicants")
      ? preferTab
      : readInitialTab(defaultTab),
  );

  useEffect(() => {
    if (!tabs.some((t) => t.key === tab) && tabs[0]) setTab(tabs[0].key);
  }, [tabs, tab]);

  if (!tabs.length) {
    return (
      <div className="rounded-card border border-subtle bg-surface-1 px-4 py-6 text-sm text-muted">
        You do not have access to Opportunities.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-display text-xl font-bold text-primary">Opportunities</h1>
        <p className="mt-1 text-sm text-muted">
          Sales pipeline, requirements, and applicants in one place.
        </p>
      </div>

      <div className="mb-4">
        <Tabs
          tabs={tabs}
          active={tab}
          onChange={(key) => setTab(key as OppWorkspaceTab)}
        />
      </div>

      {tab === "pipeline" && canPipeline ? <OpportunitiesListPage /> : null}
      {tab === "requirements" && canRequirements ? <RequirementsListPage /> : null}
      {tab === "applicants" && canApplicants ? (
        <ProfilesListPage
          title="Applicants"
          subtitle="Every candidate application across opportunities."
        />
      ) : null}
    </div>
  );
}

/** Legacy /requirements list URL → same workspace with Requirements preselected. */
export function RequirementsListRedirect() {
  return <OpportunitiesWorkspace preferTab="requirements" />;
}

export default OpportunitiesWorkspace;
