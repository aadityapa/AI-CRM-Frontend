/**
 * Access Control ▸ Users — the two rule panels, redesigned (7 Oct 2026):
 *
 *   • **Action permissions** — WHO may press each gated button. One matrix
 *     per group (Timesheets & invoicing · Sales & hiring · …): a row per
 *     action, a chip per role that toggles on click (defaults carry a dot),
 *     the row turning amber while unsaved. Save per row, or every change at
 *     once; Reset returns a row to the code default.
 *   • **Email flows** — WHO hears about each event. Flows are grouped by what
 *     they are about (deals, candidates, billing, people, system, the mails
 *     candidates themselves receive); a row is one line — switch · name ·
 *     role chips · extra mailboxes count — and opens to the wording editor
 *     (subject, body, extra addresses, the built-in text and the last mail
 *     sent as a worked example).
 *
 * Both save through the SAME endpoints the old panels used
 * (`PUT /api/action-permissions/{action}`, `PUT /api/email-flows/{event}`,
 * `DELETE` to reset) — nothing changed server-side except the `group` the
 * action payload now carries.
 */
import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, ChevronDown, ChevronRight, Filter, Mail, MailX, RotateCcw, Save, Search, ShieldCheck, Sparkles,
  type LucideIcon,
} from "lucide-react";
import { crmDelete, crmPut } from "../../api";
import { btnPrimary, btnSecondary, inputCls } from "../ui";

type Notify = (m: string, k?: "ok" | "err") => void;

/* ------------------------------------------------------------- shared bits */

/** A role as a toggle chip. `isDefault` draws the dot the code default carries. */
function RoleChip({ role, on, isDefault, disabled, onToggle }: {
  role: string; on: boolean; isDefault?: boolean; disabled?: boolean; onToggle: () => void;
}) {
  return (
    <button type="button" role="checkbox" aria-checked={on} disabled={disabled} onClick={onToggle}
      title={isDefault ? `${role} — in the code default` : role}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors duration-micro disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? "border-transparent bg-brand-600 text-white" : "border-subtle bg-surface-1 text-secondary hover:bg-surface-2"}`}>
      {isDefault && <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-white/80" : "bg-brand-600"}`} aria-hidden />}
      {role.replace(/_/g, " ")}
    </button>
  );
}

function PanelShell({ icon: Icon, title, blurb, count, changed, open, onToggle, actions, children }: {
  icon: LucideIcon; title: string; blurb: string; count: string; changed: number; open: boolean; onToggle: () => void;
  actions?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="mt-6 overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <button type="button" className="flex min-w-0 items-center gap-3 text-left" onClick={onToggle} aria-expanded={open}>
          <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-card bg-gradient-to-br from-brand-600 to-indigo-700 text-white shadow-raised">
            <Icon size={18} aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-base font-bold text-primary">
              {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />} {title}
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-secondary">{count}</span>
              {changed > 0 && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">{changed} unsaved</span>}
            </span>
            <span className="block text-xs text-secondary">{blurb}</span>
          </span>
        </button>
        {open && actions}
      </header>
      {open && <div className="border-t border-subtle">{children}</div>}
    </section>
  );
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
}

/* ------------------------------------------------------ action permissions */

export type ActionPerm = {
  action: string;
  label: string;
  description: string;
  kind?: string;
  group?: string;
  tab?: string | null;
  default_roles: string[];
  roles: string[];
  customized: boolean;
};

const GROUP_ORDER = ["Timesheets & invoicing", "Sales & hiring", "Other"];

/** Rows grouped by the server's `group`, catalogue order first. PURE. */
export function groupActions<T extends { group?: string }>(rows: T[]): { group: string; rows: T[] }[] {
  const by = new Map<string, T[]>();
  rows.forEach((r) => { const g = r.group || "Other"; by.set(g, [...(by.get(g) || []), r]); });
  const keys = [...by.keys()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a); const ib = GROUP_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return keys.map((group) => ({ group, rows: by.get(group)! }));
}

export function ActionPermissionsPanel({ allRoles, actions, reload, notify }: {
  allRoles: string[]; actions: ActionPerm[]; reload: () => void; notify: Notify;
}) {
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [onlyCustom, setOnlyCustom] = useState(false);
  useEffect(() => { setDrafts(Object.fromEntries(actions.map((a) => [a.action, a.roles]))); }, [actions]);

  const saved = useMemo(() => new Map(actions.map((a) => [a.action, a])), [actions]);
  const dirtyKeys = useMemo(() => actions.filter((a) => drafts[a.action] && !sameSet(drafts[a.action], a.roles)).map((a) => a.action), [actions, drafts]);
  const q = search.trim().toLowerCase();
  const shown = actions.filter((a) => (!q || a.label.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
    && (!onlyCustom || a.customized || dirtyKeys.includes(a.action)));
  const groups = groupActions(shown);

  const toggle = (action: string, role: string) => setDrafts((d) => {
    const cur = d[action] || [];
    return { ...d, [action]: cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role] };
  });
  const save = async (action: string) => {
    setBusy(action);
    try {
      const res = await crmPut(`/api/action-permissions/${action}`, { roles: drafts[action] || [] });
      notify(res.message || "Permission saved");
      reload();
    } catch (e: any) {
      notify(e?.message || "Failed to save permission", "err");
    } finally { setBusy(null); }
  };
  const saveAll = async () => {
    setBusy("*");
    let n = 0;
    try {
      for (const action of dirtyKeys) {
        await crmPut(`/api/action-permissions/${action}`, { roles: drafts[action] || [] });
        n += 1;
      }
      notify(`${n} permission${n === 1 ? "" : "s"} saved`);
      reload();
    } catch (e: any) {
      notify(e?.message || `Saved ${n}, then failed`, "err");
      reload();
    } finally { setBusy(null); }
  };
  const reset = async (action: string) => {
    setBusy(action);
    try {
      await crmDelete(`/api/action-permissions/${action}`);
      notify("Permission reset to default");
      reload();
    } catch (e: any) {
      notify(e?.message || "Failed to reset permission", "err");
    } finally { setBusy(null); }
  };

  return (
    <PanelShell icon={ShieldCheck} title="Action permissions"
      blurb="Who may press each gated button. Admin / CEO always can — nobody ticked means admins only. Users on an Access Template or a custom role follow its Approvals section instead."
      count={`${actions.length} actions · ${actions.filter((a) => a.customized).length} customised`}
      changed={dirtyKeys.length} open={open} onToggle={() => setOpen((v) => !v)}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input className={`${inputCls} !h-8 !w-48 !pl-8 !py-1 text-xs`} placeholder="Find an action…" value={search}
              onChange={(e) => setSearch(e.target.value)} aria-label="Find an action" />
          </div>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-secondary">
            <input type="checkbox" checked={onlyCustom} onChange={(e) => setOnlyCustom(e.target.checked)} /> <Filter size={12} aria-hidden /> Customised only
          </label>
          {dirtyKeys.length > 0 && (
            <button type="button" className={`${btnPrimary} !px-3 !py-1.5 text-xs`} disabled={busy !== null} onClick={() => void saveAll()}>
              <Save size={13} /> Save {dirtyKeys.length} change{dirtyKeys.length === 1 ? "" : "s"}
            </button>
          )}
        </div>
      }>
      {groups.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">No action matches.</p>}
      {groups.map(({ group, rows }) => (
        <div key={group}>
          <div className="bg-surface-2 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-secondary">{group}</div>
          <div className="divide-y divide-subtle">
            {rows.map((a) => {
              const cur = drafts[a.action] || a.roles;
              const dirty = !sameSet(cur, saved.get(a.action)?.roles || []);
              const isApproval = (a.kind || "").toUpperCase() === "APPROVAL";
              return (
                <div key={a.action} className={`grid gap-2 px-4 py-2.5 md:grid-cols-[minmax(0,18rem)_1fr_auto] md:items-center ${dirty ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold text-primary">{a.label}</span>
                      <span className={`rounded-full px-1.5 py-px text-[10px] font-bold uppercase ${isApproval ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" : "bg-surface-2 text-muted"}`}>
                        {isApproval ? "Approval" : "Button"}
                      </span>
                      {a.customized && <span className="rounded-full bg-sky-100 px-1.5 py-px text-[10px] font-bold uppercase text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">Customised</span>}
                    </div>
                    <div className="text-xs text-muted">{a.description}</div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {allRoles.map((r) => (
                      <RoleChip key={r} role={r} on={cur.includes(r)} isDefault={a.default_roles.includes(r)}
                        disabled={busy !== null} onToggle={() => toggle(a.action, r)} />
                    ))}
                    {cur.length === 0 && <span className="self-center text-[11px] text-muted">admins only</span>}
                  </div>
                  <div className="flex gap-1.5 md:justify-end">
                    {dirty && (
                      <button type="button" className={`${btnPrimary} !px-2.5 !py-1 text-xs`} disabled={busy !== null} onClick={() => void save(a.action)}>
                        {busy === a.action ? "Saving…" : "Save"}
                      </button>
                    )}
                    {a.customized && (
                      <button type="button" className={`${btnSecondary} !px-2.5 !py-1 text-xs`} disabled={busy !== null} onClick={() => void reset(a.action)} title="Back to the code default">
                        <RotateCcw size={12} /> Reset
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </PanelShell>
  );
}

/* ------------------------------------------------------------ email flows */

export type EmailFlow = {
  event: string;
  label: string;
  description: string;
  kind?: string;
  default_roles: string[];
  roles: string[];
  extra_emails: string[];
  enabled: boolean;
  subject_template?: string | null;
  body_template?: string | null;
  default_subject?: string | null;
  default_body?: string | null;
  tokens?: string[];
  last_sent?: { subject?: string; to?: string; sent_at?: string } | null;
  customized: boolean;
};

const FLOW_GROUPS: { key: string; label: string; test: (f: EmailFlow) => boolean }[] = [
  { key: "candidate", label: "Emails to candidates", test: (f) => f.kind === "candidate" },
  { key: "custom", label: "Custom drafts", test: (f) => f.event.startsWith("custom.") || f.event.startsWith("draft.") },
  { key: "deals", label: "Deals & positions", test: (f) => /^(opportunity|requirement|template_request)\./.test(f.event) },
  { key: "hiring", label: "Candidates & interviews", test: (f) => /^(profile|candidate|ai_interview|interview|slot|resume)\./.test(f.event) },
  { key: "billing", label: "Timesheets & billing", test: (f) => /^(timesheet|invoice|credit_note|po|purchase_order|customer_receipt|payment|tds)\./.test(f.event) },
  { key: "people", label: "People & projects", test: (f) => /^(leave|employee|project|holiday|payroll)\./.test(f.event) },
  { key: "system", label: "System & admin", test: () => true },
];

/** Flows grouped by subject (first matching group wins). PURE. */
export function groupFlows(flows: EmailFlow[]): { key: string; label: string; rows: EmailFlow[] }[] {
  return FLOW_GROUPS
    .map((g) => ({ key: g.key, label: g.label, rows: flows.filter((f) => FLOW_GROUPS.find((x) => x.test(f))?.key === g.key) }))
    .filter((g) => g.rows.length > 0);
}

function flowDirty(d: EmailFlow, s: EmailFlow): boolean {
  return d.enabled !== s.enabled || !sameSet(d.roles, s.roles) || !sameSet(d.extra_emails, s.extra_emails)
    || (d.subject_template || "") !== (s.subject_template || "") || (d.body_template || "") !== (s.body_template || "");
}

export function EmailFlowsPanel({ allRoles, flows, reload, notify }: {
  allRoles: string[]; flows: EmailFlow[]; reload: () => void; notify: Notify;
}) {
  const [drafts, setDrafts] = useState<Record<string, EmailFlow>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "customised" | "off">("all");
  useEffect(() => { setDrafts(Object.fromEntries(flows.map((f) => [f.event, { ...f }]))); }, [flows]);

  const saved = useMemo(() => new Map(flows.map((f) => [f.event, f])), [flows]);
  const dirtyKeys = useMemo(() => flows.filter((f) => drafts[f.event] && flowDirty(drafts[f.event], f)).map((f) => f.event), [flows, drafts]);
  const q = search.trim().toLowerCase();
  const shown = flows.filter((f) => (!q || f.label.toLowerCase().includes(q) || f.description.toLowerCase().includes(q) || f.event.includes(q))
    && (filter === "all" || (filter === "customised" ? f.customized || dirtyKeys.includes(f.event) : !(drafts[f.event]?.enabled ?? f.enabled))));
  const groups = groupFlows(shown);
  const offCount = flows.filter((f) => !f.enabled).length;

  const setFlow = (event: string, patch: Partial<EmailFlow>) => setDrafts((d) => ({ ...d, [event]: { ...d[event], ...patch } }));
  const body = (f: EmailFlow) => ({
    roles: f.roles, extra_emails: f.extra_emails, enabled: f.enabled,
    subject_template: f.subject_template || null, body_template: f.body_template || null,
  });
  const valid = (f: EmailFlow) => !(f.enabled && !f.roles.length && !f.extra_emails.length && f.kind !== "candidate" && f.default_roles.length > 0);
  const save = async (event: string) => {
    const f = drafts[event];
    if (!f) return;
    if (!valid(f)) { notify("An enabled flow needs at least one role or extra email — or switch it off", "err"); return; }
    setBusy(event);
    try {
      const res = await crmPut(`/api/email-flows/${event}`, body(f));
      notify(res.message || "Flow saved");
      reload();
    } catch (e: any) {
      notify(e?.message || "Failed to save flow", "err");
    } finally { setBusy(null); }
  };
  const saveAll = async () => {
    const bad = dirtyKeys.find((k) => !valid(drafts[k]));
    if (bad) { notify(`"${drafts[bad].label}" is on with nobody to send it to`, "err"); return; }
    setBusy("*");
    let n = 0;
    try {
      for (const k of dirtyKeys) { await crmPut(`/api/email-flows/${k}`, body(drafts[k])); n += 1; }
      notify(`${n} flow${n === 1 ? "" : "s"} saved`);
      reload();
    } catch (e: any) {
      notify(e?.message || `Saved ${n}, then failed`, "err");
      reload();
    } finally { setBusy(null); }
  };
  const reset = async (event: string) => {
    setBusy(event);
    try {
      await crmDelete(`/api/email-flows/${event}`);
      notify("Flow reset to default");
      reload();
    } catch (e: any) {
      notify(e?.message || "Failed to reset flow", "err");
    } finally { setBusy(null); }
  };

  return (
    <PanelShell icon={Mail} title="Email flows"
      blurb="Who hears about each event — bell and email. Switch a flow off, change the roles, add a group mailbox, or rewrite the wording. The round, the candidate or the approval decides the actual recipient where the description says so."
      count={`${flows.length} flows · ${flows.filter((f) => f.customized).length} customised · ${offCount} off`}
      changed={dirtyKeys.length} open={open} onToggle={() => setOpen((v) => !v)}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input className={`${inputCls} !h-8 !w-48 !pl-8 !py-1 text-xs`} placeholder="Find a flow…" value={search}
              onChange={(e) => setSearch(e.target.value)} aria-label="Find a flow" />
          </div>
          <div className="inline-flex overflow-hidden rounded-control border border-subtle" role="radiogroup" aria-label="Show">
            {([["all", "All"], ["customised", "Customised"], ["off", "Switched off"]] as const).map(([k, l], i) => (
              <button key={k} type="button" role="radio" aria-checked={filter === k} onClick={() => setFilter(k)}
                className={`px-2.5 py-1 text-xs font-semibold ${i > 0 ? "border-l border-subtle" : ""} ${filter === k ? "bg-brand-600 text-white" : "bg-surface-1 text-secondary hover:bg-surface-2"}`}>
                {l}
              </button>
            ))}
          </div>
          {dirtyKeys.length > 0 && (
            <button type="button" className={`${btnPrimary} !px-3 !py-1.5 text-xs`} disabled={busy !== null} onClick={() => void saveAll()}>
              <Save size={13} /> Save {dirtyKeys.length} change{dirtyKeys.length === 1 ? "" : "s"}
            </button>
          )}
        </div>
      }>
      {groups.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">No flow matches.</p>}
      {groups.map((g) => (
        <div key={g.key}>
          <div className="bg-surface-2 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-secondary">{g.label} <span className="font-semibold normal-case text-muted">· {g.rows.length}</span></div>
          <div className="divide-y divide-subtle">
            {g.rows.map((f0) => {
              const f = drafts[f0.event] || f0;
              const s = saved.get(f0.event)!;
              const dirty = flowDirty(f, s);
              const isOpen = !!expanded[f.event];
              const toCandidate = f.kind === "candidate";
              return (
                <div key={f.event} className={dirty ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}>
                  <div className="grid gap-2 px-4 py-2.5 md:grid-cols-[auto_minmax(0,18rem)_1fr_auto] md:items-center">
                    <button type="button" role="switch" aria-checked={f.enabled} aria-label={`${f.label} ${f.enabled ? "on" : "off"}`}
                      disabled={busy !== null} onClick={() => setFlow(f.event, { enabled: !f.enabled })}
                      className={`relative inline-flex h-5 w-9 flex-none items-center rounded-full transition-colors duration-micro ${f.enabled ? "bg-success" : "bg-surface-2"}`}>
                      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-raised transition-transform duration-micro ${f.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                    <div className="min-w-0">
                      <button type="button" className="flex items-start gap-1.5 text-left" onClick={() => setExpanded((e) => ({ ...e, [f.event]: !isOpen }))}>
                        <span className="mt-0.5 flex-none text-muted">{isOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}</span>
                        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className={`text-sm font-semibold ${f.enabled ? "text-primary" : "text-muted line-through"}`}>{f.label}</span>
                          {f.customized && <span className="rounded-full bg-sky-100 px-1.5 py-px text-[10px] font-bold uppercase text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">Customised</span>}
                          {(f.subject_template || f.body_template) && <span className="rounded-full bg-violet-100 px-1.5 py-px text-[10px] font-bold uppercase text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">Own wording</span>}
                        </span>
                      </button>
                      <div className="truncate pl-5 text-xs text-muted" title={f.description}>{f.description}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {toCandidate ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted"><Sparkles size={12} aria-hidden /> Sent to the candidate</span>
                      ) : allRoles.map((r) => (
                        <RoleChip key={r} role={r} on={f.roles.includes(r)} isDefault={f.default_roles.includes(r)} disabled={!f.enabled || busy !== null}
                          onToggle={() => setFlow(f.event, { roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] })} />
                      ))}
                      {f.extra_emails.length > 0 && (
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-secondary" title={f.extra_emails.join(", ")}>
                          +{f.extra_emails.length} mailbox{f.extra_emails.length === 1 ? "" : "es"}
                        </span>
                      )}
                      {!toCandidate && f.roles.length === 0 && f.extra_emails.length === 0 && f.default_roles.length === 0 && (
                        <span className="text-[11px] text-muted">the event decides who</span>
                      )}
                    </div>
                    <div className="flex gap-1.5 md:justify-end">
                      {dirty && (
                        <button type="button" className={`${btnPrimary} !px-2.5 !py-1 text-xs`} disabled={busy !== null} onClick={() => void save(f.event)}>
                          {busy === f.event ? "Saving…" : "Save"}
                        </button>
                      )}
                      {f.customized && (
                        <button type="button" className={`${btnSecondary} !px-2.5 !py-1 text-xs`} disabled={busy !== null} onClick={() => void reset(f.event)} title="Back to the code default">
                          <RotateCcw size={12} /> Reset
                        </button>
                      )}
                    </div>
                  </div>
                  {isOpen && (
                    <div className="grid gap-3 border-t border-subtle bg-surface-2 px-4 py-3 lg:grid-cols-2">
                      <div className="space-y-2">
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-semibold text-muted">
                            Subject (blank = standard){f.tokens?.length ? ` · placeholders: ${f.tokens.map((t) => `{${t}}`).join(" ")}` : ""}
                          </span>
                          <input className={`${inputCls} text-xs`} value={f.subject_template || ""} disabled={!f.enabled}
                            placeholder={f.default_subject || "e.g. [Karnex] {subject}"} onChange={(e) => setFlow(f.event, { subject_template: e.target.value })} />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-semibold text-muted">Body (blank = standard) — {"{body}"} inserts the standard text</span>
                          <textarea className={`${inputCls} min-h-[5rem] text-xs`} rows={4} value={f.body_template || ""} disabled={!f.enabled}
                            placeholder={f.default_body || "Dear {recipient},\n\n{body}\n\nRegards, {company}"} onChange={(e) => setFlow(f.event, { body_template: e.target.value })} />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-semibold text-muted">Extra email addresses (comma separated — auditors, group mailboxes)</span>
                          <input className={`${inputCls} text-xs`} value={f.extra_emails.join(", ")} disabled={!f.enabled}
                            onChange={(e) => setFlow(f.event, { extra_emails: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
                        </label>
                      </div>
                      <div className="space-y-2 text-xs">
                        <div className="rounded-control border border-subtle bg-surface-1 p-3">
                          <div className="mb-1 flex items-center gap-1 font-semibold text-secondary"><CheckCircle2 size={12} aria-hidden /> What goes out today</div>
                          {f.default_subject ? <div className="font-medium text-primary">{f.default_subject}</div> : <div className="text-muted">Standard layout.</div>}
                          {f.default_body && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-[11px] text-secondary">{f.default_body}</pre>}
                        </div>
                        {f.last_sent ? (
                          <div className="rounded-control border border-subtle bg-surface-1 p-3">
                            <div className="mb-1 flex items-center gap-1 font-semibold text-secondary"><Mail size={12} aria-hidden /> Last one sent</div>
                            <div className="text-primary">{f.last_sent.subject || "—"}</div>
                            <div className="text-muted">{f.last_sent.to || ""}{f.last_sent.sent_at ? ` · ${f.last_sent.sent_at}` : ""}</div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-muted"><MailX size={12} aria-hidden /> Nothing sent for this event yet.</div>
                        )}
                        <div className="text-muted">Event key: <code className="rounded bg-surface-1 px-1">{f.event}</code></div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </PanelShell>
  );
}
