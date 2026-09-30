/** Unified Opportunities workspace — Pipeline + Requirements + Applicants sub-tabs.
 * Keeps both data models / detail routes separate; only merges list navigation. */
import { useEffect, useMemo } from "react";
import { ClipboardList, FileStack, LayoutList, type LucideIcon, UsersRound, Workflow } from "lucide-react";
import { useHasRole } from "../CrmApp";
import { useCanAct, useIsTemplated } from "../useAccess";
import { OpportunitiesListPage } from "./Opportunities";
import { RequirementsListPage } from "./Requirements";
import { ProfilesListPage } from "./Profiles";
import { TemplateRequestsPage } from "./TemplateRequests";
import { usePageTab } from "../lib/pageState";

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

const WORKSPACE_TAB_KEYS = ["pipeline", "sow", "requirements", "applicants", "template-requests"];

export function OpportunitiesWorkspace({
  preferTab,
}: {
  preferTab?: OppWorkspaceTab;
} = {}) {
  // Grant-aware ONLY for a user with no built-in workflow role (28 Sep 2026).
  // 26 Sep made every gate here follow the tab GRANTS so a GM (a custom role,
  // roles == ["GM"]) could open the page — but that also re-shaped the page
  // for every TEMPLATED TA / RMG / Sales: a TA whose template grants the
  // Opportunities tab suddenly got the Sales pipeline and landed on the
  // opportunity page instead of the requirement page they source from
  // (reported with screenshots). The role layout is THE layout for anyone who
  // holds a built-in role; grants only fill in for users who hold none.
  const rolePipeline = useHasRole(...PIPELINE_TAB_ROLES);
  const roleRequirements = useHasRole(...REQUIREMENTS_TAB_ROLES);
  const roleApplicants = useHasRole(...APPLICANTS_TAB_ROLES);
  const grantPipeline = useCanAct("opportunities", "view", rolePipeline);
  const grantRequirements = useCanAct("requirements", "view", roleRequirements);
  const grantApplicants = useCanAct("profiles", "view", roleApplicants);
  const hasWorkspaceRole = useHasRole(...OPPORTUNITIES_NAV_ROLES);
  const grantDriven = useIsTemplated() && !hasWorkspaceRole;
  const canPipeline = grantDriven ? grantPipeline : rolePipeline;
  const canRequirements = grantDriven ? grantRequirements : roleRequirements;
  const canApplicants = grantDriven ? grantApplicants : roleApplicants;
  // useHasRole("Admin") is true for CEO too (isSuperAdmin shortcut).
  const isAdminCeo = useHasRole("Admin");
  // The Requirements BUTTON was removed for the role-based strip (14 Aug 2026:
  // Sales / Admin never wanted it; RMG / TA get the list full-page below). A
  // grant-driven user who holds BOTH Pipeline and Requirements has no other
  // way to reach the sourcing list, so the button comes back for them only.
  const showRequirementsTab = grantDriven && canRequirements && canPipeline;

  const tabs = useMemo(() => {
    const out: { key: OppWorkspaceTab; label: string }[] = [];
    if (canPipeline) {
      out.push({ key: "pipeline", label: "Pipeline T&M" });
      out.push({ key: "sow", label: "Pipeline SOW" });
    }
    if (showRequirementsTab) out.push({ key: "requirements", label: "Requirements" });
    if (canApplicants) out.push({ key: "applicants", label: "Applicants" });
    if (isAdminCeo) out.push({ key: "template-requests", label: "Template Requests" });
    return out;
  }, [canPipeline, showRequirementsTab, canApplicants, isAdminCeo]);

  const defaultTab = preferTab && tabs.some((t) => t.key === preferTab)
    ? preferTab
    : (tabs[0]?.key || "pipeline");

  /* ?opp_tab= in the address (29 Sep 2026, crm/lib/pageState.ts): Back from an
     opportunity returns to the tab it was opened from. `preferTab` (the
     requirements redirect) is the default when the address names none. */
  const [tab, setTab] = usePageTab<OppWorkspaceTab>("opp_tab",
    preferTab && (preferTab === "pipeline" || preferTab === "sow"
      || preferTab === "requirements" || preferTab === "applicants"
      || preferTab === "template-requests")
      ? preferTab
      : defaultTab,
    WORKSPACE_TAB_KEYS);

  /* An explicit `preferTab` (the route asked for a view) wins at mount over a
     remembered tab — it is the reason this page was opened. */
  useEffect(() => {
    if (preferTab && WORKSPACE_TAB_KEYS.includes(preferTab) && preferTab !== tab) {
      setTab(preferTab as OppWorkspaceTab, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferTab]);

  useEffect(() => {
    // "requirements" stays valid without a tab button (deep links only).
    if (tab === "requirements" && canRequirements) return;
    if (!tabs.some((t) => t.key === tab) && tabs[0]) setTab(tabs[0].key, { replace: true });
  }, [tabs, tab, canRequirements]);

  if (!tabs.length) {
    // RMG/TA-style users: no pipeline tab buttons, but Requirements is their
    // whole workflow — render it directly instead of a dead end.
    if (canRequirements) {
      // The list page carries its own "Opportunities" header (29 Sep 2026) —
      // the old "Requirements" title above it was a second, conflicting name.
      return <RequirementsListPage />;
    }
    return (
      <div className="rounded-card border border-subtle bg-surface-1 px-4 py-6 text-sm text-muted">
        You do not have access to Opportunities.
      </div>
    );
  }

  return (
    <div>
      {/* Section switcher only — each view below renders its own page header,
          so a title here would say "Opportunities" twice (29 Sep 2026). */}
      <WorkspaceSwitcher
        tabs={tabs}
        active={tab}
        onChange={(key) => setTab(key as OppWorkspaceTab)}
      />

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

const WORKSPACE_TAB_ICON: Record<OppWorkspaceTab, LucideIcon> = {
  pipeline: LayoutList, sow: FileStack, requirements: Workflow,
  applicants: UsersRound, "template-requests": ClipboardList,
};

/** Segmented section switcher for the workspace (presentation only). */
function WorkspaceSwitcher({ tabs, active, onChange }: {
  tabs: { key: OppWorkspaceTab; label: string }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="mb-4 overflow-x-auto">
      <div className="inline-flex min-w-max gap-1 rounded-card border border-subtle bg-surface-1 p-1 shadow-raised"
        role="tablist" aria-label="Opportunities sections">
        {tabs.map((t) => {
          const on = t.key === active;
          const Icon = WORKSPACE_TAB_ICON[t.key];
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onChange(t.key)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-control px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:shadow-focus-ring ${
                on
                  ? "bg-gradient-to-r from-sky-600 to-brand-600 text-white shadow-raised"
                  : "text-muted hover:bg-surface-2 hover:text-primary"
              }`}
            >
              <Icon size={15} aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Legacy /requirements list URL → same workspace with Requirements preselected. */
export function RequirementsListRedirect() {
  return <OpportunitiesWorkspace preferTab="requirements" />;
}
