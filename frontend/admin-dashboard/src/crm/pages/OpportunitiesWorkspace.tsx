/** Unified Opportunities workspace — Pipeline + Requirements + Applicants sub-tabs.
 * Keeps both data models / detail routes separate; only merges list navigation. */
import React, { useEffect, useMemo, useState } from "react";
import { useHasRole } from "../CrmApp";
import { Tabs } from "../components/ui";
import { OpportunitiesListPage } from "./Opportunities";
import { RequirementsListPage } from "./Requirements";
import { ProfilesListPage } from "./Profiles";
import { TemplateRequestsPage } from "./TemplateRequests";

export type OppWorkspaceTab =
  | "pipeline" | "sow" | "requirements" | "applicants" | "template-requests";

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
  if (isAdmin || PIPELINE_TAB_ROLES.some((r) => set.has(r))) tabs.push("pipeline", "sow");
  // "requirements" is NOT a visible tab any more (removed 14 Aug 2026 on
  // request) — the panel still renders for deep links (?opp_tab=requirements
  // and the legacy /requirements redirect), it just has no tab button.
  if (isAdmin || APPLICANTS_TAB_ROLES.some((r) => set.has(r))) tabs.push("applicants");
  // Admin/CEO only (26 Aug 2026, user decision): Template Requests lives HERE
  // for admins — their sidebar entry is hidden. TA/RMG keep the sidebar page.
  if (isAdmin) tabs.push("template-requests");
  return tabs;
}

function readInitialTab(fallback: OppWorkspaceTab): OppWorkspaceTab {
  try {
    const v = new URLSearchParams(window.location.search).get("opp_tab");
    if (v === "requirements" || v === "pipeline" || v === "sow"
      || v === "applicants" || v === "template-requests") return v;
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
  // useHasRole("Admin") is true for CEO too (isSuperAdmin shortcut).
  const isAdminCeo = useHasRole("Admin");

  const tabs = useMemo(() => {
    const out: { key: OppWorkspaceTab; label: string }[] = [];
    if (canPipeline) {
      out.push({ key: "pipeline", label: "Pipeline T&M" });
      out.push({ key: "sow", label: "Pipeline SOW" });
    }
    // Requirements tab removed from the strip (14 Aug 2026) — the panel still
    // answers deep links so RMG/TA workflows and old bookmarks keep working.
    if (canApplicants) out.push({ key: "applicants", label: "Applicants" });
    if (isAdminCeo) out.push({ key: "template-requests", label: "Template Requests" });
    return out;
  }, [canPipeline, canApplicants, isAdminCeo]);

  const defaultTab = preferTab && tabs.some((t) => t.key === preferTab)
    ? preferTab
    : (tabs[0]?.key || "pipeline");

  const [tab, setTab] = useState<OppWorkspaceTab>(() =>
    preferTab && (preferTab === "pipeline" || preferTab === "sow"
      || preferTab === "requirements" || preferTab === "applicants"
      || preferTab === "template-requests")
      ? preferTab
      : readInitialTab(defaultTab),
  );

  useEffect(() => {
    // "requirements" stays valid without a tab button (deep links only).
    if (tab === "requirements" && canRequirements) return;
    if (!tabs.some((t) => t.key === tab) && tabs[0]) setTab(tabs[0].key);
  }, [tabs, tab, canRequirements]);

  if (!tabs.length) {
    // RMG/TA-style users: no pipeline tab buttons, but Requirements is their
    // whole workflow — render it directly instead of a dead end.
    if (canRequirements) {
      return (
        <div>
          <div className="mb-6">
            <h1 className="text-display text-xl font-bold text-primary">Requirements</h1>
            <p className="mt-1 text-sm text-muted">Sourcing pipeline across all customers.</p>
          </div>
          <RequirementsListPage />
        </div>
      );
    }
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

      {tab === "pipeline" && canPipeline ? <OpportunitiesListPage typeFilter="T&M" /> : null}
      {tab === "sow" && canPipeline ? <OpportunitiesListPage typeFilter="SOW" /> : null}
      {tab === "requirements" && canRequirements ? <RequirementsListPage /> : null}
      {tab === "applicants" && canApplicants ? (
        <ProfilesListPage
          title="Applicants"
          subtitle="Every candidate application across opportunities."
        />
      ) : null}
      {tab === "template-requests" && isAdminCeo ? <TemplateRequestsPage /> : null}
    </div>
  );
}

/** Legacy /requirements list URL → same workspace with Requirements preselected. */
export function RequirementsListRedirect() {
  return <OpportunitiesWorkspace preferTab="requirements" />;
}
