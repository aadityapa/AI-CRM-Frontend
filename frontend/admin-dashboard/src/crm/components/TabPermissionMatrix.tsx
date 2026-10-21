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
  /** The page's sub-tabs (22 Oct 2026) — `tab:<key>` entries of the field map. */
  subtabs?: { key: string; label: string }[];
  /** "Interview Platform" | "CRM" (server, 7 Oct 2026). */
  group?: string;
  /** Interview Platform tabs: the roles that open it by default. */
  default_roles?: string[];
};
export type GrantMap = Record<string, string>;
export type FieldGrantMap = Record<string, Record<string, string>>;

/** PURE (22 Oct 2026) — is this sub-tab ticked, and is the tab's list chosen
 *  explicitly? Mirror of B-V2 `access_registry.subtab_choice`: once any
 *  sub-tab is "view", only "view" ones show; otherwise only "hidden" hides. */
export function subTabState(map: Record<string, string> | undefined, key: string): { checked: boolean; picked: boolean } {
  const entries = Object.entries(map || {}).filter(([k]) => k.startsWith("tab:"));
  const shown = (m?: string) => m === "view" || m === "edit";
  const picked = entries.some(([, m]) => shown(m));
  const mode = (map || {})[key];
  return { picked, checked: picked ? shown(mode) : mode !== "hidden" };
}

/** PURE — tick / untick one sub-tab: the tab's list becomes explicit ("view"
 *  for every ticked one, "hidden" for the rest); other fields are kept. */
export function toggleSubTab(
  map: Record<string, string> | undefined, subtabs: { key: string }[], key: string,
): Record<string, string> {
  const next: Record<string, string> = { ...(map || {}) };
  for (const st of subtabs) {
    const on = st.key === key ? !subTabState(map, st.key).checked : subTabState(map, st.key).checked;
    next[st.key] = on ? "view" : "hidden";
  }
  return next;
}

/** PURE — back to the role defaults: drop every `tab:*` entry. */
export function resetSubTabs(map: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(map || {}).filter(([k]) => !k.startsWith("tab:")));
}

/** Tick list of a tab's sub-tabs (22 Oct 2026, user ask: "give access to each
 *  sub-tab"). Used by Access Templates and Access Control ▸ Roles. */
export function SubTabPicker({
  subtabs, value, onChange,
}: {
  subtabs: { key: string; label: string }[];
  value: Record<string, string> | undefined;
  onChange: (next: Record<string, string>) => void;
}) {
  if (!subtabs.length) return null;
  const picked = subTabState(value, subtabs[0].key).picked;
  const shownCount = subtabs.filter((st) => subTabState(value, st.key).checked).length;
  return (
    <div className="mt-1.5 rounded-control border border-dashed border-subtle bg-surface-2 px-2.5 py-2">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Sub-tabs · {picked ? `only the ${shownCount} ticked` : "following the role"}
        </span>
        {picked ? (
          <button type="button" className="text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-300"
            onClick={() => onChange(resetSubTabs(value))}>
            Back to role defaults
          </button>
        ) : (
          <span className="text-[11px] text-muted">Untick one to choose them yourself</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {subtabs.map((st) => {
          const on = subTabState(value, st.key).checked;
          return (
            <label key={st.key}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-pill border px-2.5 py-1 text-xs font-semibold transition-colors ${
                on ? "border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-900/30 dark:text-brand-200"
                  : "border-subtle bg-surface-1 text-muted line-through"}`}>
              <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={on}
                onChange={() => onChange(toggleSubTab(value, subtabs, st.key))} />
              {st.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}

export const TAB_MODULES: Record<string, string> = {
  dashboard: "General", calendar: "General", reports: "General",
  customers: "Sales", opportunities: "Sales", "rate-cards": "Sales", "branch-policy": "Sales",
  requirements: "Recruitment", candidates: "Recruitment", profiles: "Recruitment",
  "template-requests": "Recruitment", "screening-desk": "Recruitment", "my-interviews": "Recruitment",
  "talent-pool": "Recruitment",
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
  fieldValue,
  onFieldChange,
}: {
  tabs: RegistryTab[];
  value: GrantMap;
  onChange: (next: GrantMap) => void;
  /** Field / sub-tab grants (22 Oct 2026) — with these, a granted tab shows its sub-tab ticks. */
  fieldValue?: FieldGrantMap;
  onFieldChange?: (next: FieldGrantMap) => void;
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
            .filter((t) => !q || t.label.toLowerCase().includes(q) || t.key.includes(q)
              || (t.subtabs || []).some((st) => st.label.toLowerCase().includes(q)));
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
                  <div key={tab.key} className="px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-primary">
                        {tab.label}
                        {tab.subtabs?.length ? <span className="ml-1.5 text-[11px] font-normal text-muted">{tab.subtabs.length} sub-tabs</span> : null}
                      </span>
                      <ModeSegments value={value[tab.key] || ""} onChange={(m) => setMode(tab.key, m)} />
                    </div>
                    {onFieldChange && value[tab.key] && tab.subtabs?.length ? (
                      <SubTabPicker subtabs={tab.subtabs} value={fieldValue?.[tab.key]}
                        onChange={(m) => {
                          const next = { ...(fieldValue || {}) };
                          if (Object.keys(m).length) next[tab.key] = m; else delete next[tab.key];
                          onFieldChange(next);
                        }} />
                    ) : null}
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
