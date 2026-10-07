/**
 * TabPermissionMatrix — the "which tabs, at what level" picker (23 Sep 2026).
 *
 * One grant map `{ tab_key: "" | "view" | "edit" | "create" }` edited as a
 * module-grouped matrix with a segmented mode control per tab, a search box
 * and per-module All view / All edit / Clear shortcuts. Modes are a ladder
 * (view < edit < create); an absent key is "no access".
 *
 * Extracted for Access Control ▸ Roles so a role is granted permissions with
 * the SAME vocabulary and registry as an Access Template. Tab-level only —
 * field overrides stay a template feature. The registry comes from
 * `GET /api/access-templates/registry`, so a tab added to the server appears
 * here without a frontend change ("Other" catches unknown modules).
 */
import { useMemo, useState } from "react";
import { inputCls } from "./ui";

export type RegistryTab = {
  key: string; label: string; fields?: { key: string; label: string }[];
  /** "Interview Platform" | "CRM" (server, 7 Oct 2026). */
  group?: string;
  /** Interview Platform tabs: the roles that open it by default. */
  default_roles?: string[];
};
export type GrantMap = Record<string, string>;

export const TAB_MODULES: Record<string, string> = {
  dashboard: "General", calendar: "General", reports: "General",
  customers: "Sales", opportunities: "Sales", "rate-cards": "Sales", "branch-policy": "Sales",
  requirements: "Recruitment", candidates: "Recruitment", profiles: "Recruitment",
  "template-requests": "Recruitment", "screening-desk": "Recruitment", "my-interviews": "Recruitment",
  emails: "General", "activity-log": "General",
  projects: "Projects & Finance", "project-employees": "Projects & Finance",
  timesheets: "Projects & Finance", pos: "Projects & Finance", invoices: "Projects & Finance",
  tds: "Projects & Finance", "finance-reports": "Projects & Finance",
  employees: "HR", holidays: "HR", "my-leave": "HR", "leave-applications": "HR", payroll: "HR",
  users: "Administration", settings: "Administration",
};
export const IV_MODULE = "Interview Platform";
export const MODULE_ORDER = [IV_MODULE, "General", "Sales", "Recruitment", "Projects & Finance", "HR", "Administration", "Other"];

/** The editor module a registry tab belongs to. Interview Platform tabs
 *  (`iv:*`, 7 Oct 2026) come first: one template grants the whole login. */
export function moduleOf(tab: Pick<RegistryTab, "key" | "group">): string {
  if (tab.group === IV_MODULE || tab.key.startsWith("iv:")) return IV_MODULE;
  return TAB_MODULES[tab.key] || "Other";
}

/** Shown under the Interview Platform module header. */
export const IV_MODULE_HINT =
  "Once any of these is ticked, the template alone decides the Interview Platform tabs (roles no longer add any). "
  + "View opens the page; Edit also allows the page's changes (template authoring, scheduling, deleting reports).";

const MODES = [
  { value: "", label: "None", title: "No access" },
  { value: "view", label: "View", title: "View only" },
  { value: "edit", label: "Edit", title: "View + Edit" },
  { value: "create", label: "Create", title: "View + Edit + Create" },
];

export function ModeSegments({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-control border border-subtle" role="radiogroup">
      {MODES.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          className={`px-2.5 py-1 text-xs font-semibold transition-colors duration-micro ${i > 0 ? "border-l border-subtle" : ""} ${
            value === o.value
              ? o.value === "" ? "bg-surface-2 text-muted" : "bg-brand-600 text-white"
              : "bg-surface-1 text-secondary hover:bg-surface-2"
          }`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TabPermissionMatrix({
  tabs,
  value,
  onChange,
}: {
  tabs: RegistryTab[];
  value: GrantMap;
  onChange: (next: GrantMap) => void;
}) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();

  const setMode = (key: string, mode: string) => {
    const next = { ...value };
    if (mode) next[key] = mode; else delete next[key];
    onChange(next);
  };
  const bulk = (keys: string[], mode: string) => {
    const next = { ...value };
    keys.forEach((k) => { if (mode) next[k] = mode; else delete next[k]; });
    onChange(next);
  };

  const granted = useMemo(() => Object.keys(value).filter((k) => value[k]).length, [value]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">
          <strong className="text-primary">{granted}</strong> of {tabs.length} tabs granted · View &lt; Edit &lt; Create, each includes the lower
        </span>
        <input
          className={`${inputCls} !h-8 !w-48 !py-1 text-xs`}
          placeholder="Find a tab…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Find a tab"
        />
      </div>
      <div className="space-y-3">
        {MODULE_ORDER.map((mod) => {
          const modTabs = tabs
            .filter((t) => moduleOf(t) === mod)
            .filter((t) => !q || t.label.toLowerCase().includes(q) || t.key.includes(q));
          if (!modTabs.length) return null;
          const inMod = modTabs.filter((t) => value[t.key]).length;
          const keys = modTabs.map((t) => t.key);
          return (
            <div key={mod} className="overflow-hidden rounded-card border border-subtle">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-2 px-3 py-2">
                <span className="text-xs font-bold uppercase tracking-wide text-secondary">
                  {mod}
                  <span className="ml-2 font-semibold normal-case text-muted">{inMod}/{modTabs.length} granted</span>
                </span>
                <span className="flex gap-2">
                  <button type="button" className="text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-300" onClick={() => bulk(keys, "view")}>All view</button>
                  <button type="button" className="text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-300" onClick={() => bulk(keys, "edit")}>All edit</button>
                  <button type="button" className="text-[11px] font-semibold text-muted hover:underline" onClick={() => bulk(keys, "")}>Clear</button>
                </span>
              </div>
              {mod === IV_MODULE && <p className="border-b border-subtle px-3 py-1.5 text-[11px] text-muted">{IV_MODULE_HINT}</p>}
              <div className="divide-y divide-subtle">
                {modTabs.map((tab) => (
                  <div key={tab.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="text-sm font-medium text-primary">{tab.label}</span>
                    <ModeSegments value={value[tab.key] || ""} onChange={(m) => setMode(tab.key, m)} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
