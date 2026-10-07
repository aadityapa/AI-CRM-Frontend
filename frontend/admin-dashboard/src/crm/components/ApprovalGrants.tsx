/**
 * Approvals picker (25 Sep 2026) — the approval buttons an Access Template or a
 * custom role grants, shared by both editors so they speak one vocabulary.
 *
 * Why it exists: an approval is a decision on someone else's work, and a tab
 * grant must never imply it. Sales needs Timesheets: Edit to FILL a sheet;
 * that grant used to put Approve / Reject in front of the person who filled
 * it. Now each approval button is ticked here explicitly, and the server gate
 * (`crm_deps.gated_write_action` → `action_permissions.user_may`) and the UI
 * (`useCanApprove`, from `me.approvals`) read the same list.
 *
 * The catalogue comes from `GET /api/access-templates/registry` → `approvals`,
 * so a new approval action appears here without a frontend change.
 */
import { CheckSquare } from "lucide-react";

export type ApprovalDef = {
  key: string; label: string; description: string; group: string; default_roles: string[];
  /** "approval" (a decision on someone else's work) | "manage" (an ordinary button) — 7 Oct 2026. */
  kind?: string;
  /** Manage buttons: the CRM tab the button lives on. */
  tab?: string;
};

/** The manage buttons a tab grant at Edit or better used to imply — what a
 *  new template's list starts with (mirror of `action_permissions.implied_buttons`). */
export function impliedButtons(tabAccess: Record<string, string>, defs: ApprovalDef[]): string[] {
  return defs
    .filter((a) => a.kind === "manage" && a.tab && ["edit", "create"].includes(tabAccess[a.tab] || ""))
    .map((a) => a.key);
}

export function ApprovalGrants({
  approvals, value, onChange,
}: {
  approvals: ApprovalDef[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  if (!approvals.length) return null;
  const selected = new Set(value);
  const groups = [...new Set(approvals.map((a) => a.group))];
  // Keep registry order, so saved lists are stable and diffs stay readable.
  const commit = (next: Set<string>) => onChange(approvals.map((a) => a.key).filter((k) => next.has(k)));
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    commit(next);
  };
  const setGroup = (group: string, on: boolean) => {
    const next = new Set(selected);
    approvals.filter((a) => a.group === group).forEach((a) => (on ? next.add(a.key) : next.delete(a.key)));
    commit(next);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Every button is granted here — approvals (a decision on someone else's work) and the ordinary
        action buttons. A tab's Edit mode opens the page; the buttons on it are these ticks. Admin and
        CEO always have every button.
      </p>
      {groups.map((group) => {
        const items = approvals.filter((a) => a.group === group);
        const on = items.filter((a) => selected.has(a.key)).length;
        return (
          <div key={group} className="overflow-hidden rounded-card border border-subtle">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-2 px-3 py-2">
              <span className="text-xs font-bold uppercase tracking-wide text-secondary">
                {group}
                <span className="ml-2 font-semibold normal-case text-muted">{on}/{items.length} granted</span>
              </span>
              <span className="flex gap-1.5">
                <button type="button" className="text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-300"
                  onClick={() => setGroup(group, true)}>All</button>
                <button type="button" className="text-[11px] font-semibold text-muted hover:underline"
                  onClick={() => setGroup(group, false)}>None</button>
              </span>
            </div>
            <div className="divide-y divide-subtle">
              {items.map((a) => (
                <label key={a.key} className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-surface-2">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" aria-label={a.label}
                    checked={selected.has(a.key)} onChange={() => toggle(a.key)} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-primary">{a.label}</span>
                    <span className="block text-xs text-muted">{a.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Compact heading line for an editor section. */
export function ApprovalGrantsHeading({ count, total }: { count: number; total: number }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <CheckSquare size={14} className="text-brand-600 dark:text-brand-300" aria-hidden />
      <h2 className="text-sm font-semibold text-primary">Approvals &amp; buttons</h2>
      <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-secondary">
        {count}/{total} granted
      </span>
    </div>
  );
}
