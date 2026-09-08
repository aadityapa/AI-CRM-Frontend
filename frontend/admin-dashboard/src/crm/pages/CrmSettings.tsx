/** CRM Settings (Admin-only): master-data tables (departments, designations,
 * skills, locations, document types, leave policy types) + app settings. */
import React, { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Power, Settings } from "lucide-react";
import { crmGet, crmPost, crmPut, qs } from "../api";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import {
  ErrorBox, Modal, Spinner, StatusBadge, Tabs,
  btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";
import { SectionHeaderBanner, WizardField } from "../components/wizard";
import { ActivityLogPage } from "./ActivityLog";
import { EmailDraftsTab } from "./settings/EmailDraftsTab";

/** Local single-screen shell — applies the shared New Opportunity wizard look
 * (theme-aware body + SectionHeaderBanner) inside the existing Modal.
 * Visual-only wrapper: no field, state, or submit logic lives here. */
function WizFormShell({
  title, subtitle, icon, children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="crm-wizard wiz-noise min-h-full w-full bg-[color:var(--wiz-bg)] px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-3xl">
        <SectionHeaderBanner title={title} description={subtitle} icon={icon} />
        {children}
      </div>
    </div>
  );
}

/* Shared footer container for the reskinned single-screen dialogs. */
const wizFooterRow = "mt-6 flex items-center gap-3 border-t border-[color:var(--wiz-border)] pt-5";

type Notify = (msg: string, kind?: "ok" | "err") => void;

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

const iconBtn =
  "rounded-control p-1.5 text-muted hover:bg-surface-2 hover:text-primary";

/* -------------------------------------------------- generic master table */

type Option = { value: string; label: string };

type MasterField = {
  key: string;
  label: string;
  type?: "text" | "checkbox" | "select";
  required?: boolean;
  asNumber?: boolean;
  options?: Option[];
  defaultValue?: string | boolean;
  placeholder?: string;
};

function MasterFormModal({
  endpoint,
  label,
  fields,
  initial,
  onClose,
  onSaved,
  notify,
}: {
  endpoint: string;
  label: string;
  fields: MasterField[];
  initial?: Record<string, any>;
  onClose: () => void;
  onSaved: () => void;
  notify: Notify;
}) {
  const init: Record<string, any> = {};
  for (const f of fields) {
    if (initial) {
      init[f.key] = f.type === "checkbox" ? !!initial[f.key] : initial[f.key] != null ? String(initial[f.key]) : "";
    } else {
      init[f.key] = f.type === "checkbox" ? (f.defaultValue ?? false) : String(f.defaultValue ?? "");
    }
  }
  const [form, setForm] = useState<Record<string, any>>(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    for (const f of fields) {
      if (f.required && f.type !== "checkbox" && !String(form[f.key] ?? "").trim()) {
        errs[f.key] = `${f.label} is required`;
      }
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const payload: Record<string, any> = {};
      for (const f of fields) {
        if (f.type === "checkbox") {
          payload[f.key] = !!form[f.key];
        } else {
          const raw = String(form[f.key] ?? "").trim();
          payload[f.key] = raw === "" ? null : f.asNumber ? Number(raw) : raw;
        }
      }
      const res = initial
        ? await crmPut(`/api/${endpoint}/${initial.id}`, payload)
        : await crmPost(`/api/${endpoint}`, payload);
      notify(res.message || `${label} saved`);
      onSaved();
      onClose();
    } catch (err: any) {
      notify(err?.message || `Failed to save ${label.toLowerCase()}`, "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={<span className="sr-only">{`${initial ? "Edit" : "Add"} ${label}`}</span>}
      onClose={onClose}
      fullScreen
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title={`${initial ? "Edit" : "Add"} ${label}`}
        subtitle={`Manage the ${label.toLowerCase()} master record used across the CRM.`}
        icon={<Settings size={20} aria-hidden />}
      >
        <form onSubmit={submit} className="space-y-5">
          {fields.map((f) =>
            f.type === "checkbox" ? (
              <label key={f.key} className="flex items-center gap-2 text-sm font-semibold text-primary">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-sky-600"
                  checked={!!form[f.key]}
                  onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.checked }))}
                />
                {f.label}
              </label>
            ) : f.type === "select" ? (
              <WizardField key={f.key} label={f.label} required={f.required} error={errors[f.key]}>
                <select
                  className={inputCls}
                  value={form[f.key] ?? ""}
                  onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value }))}
                >
                  <option value="">— None —</option>
                  {(f.options || []).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </WizardField>
            ) : (
              <WizardField key={f.key} label={f.label} required={f.required} error={errors[f.key]} filled={!!String(form[f.key] ?? "").trim() && !errors[f.key]}>
                <input
                  className={inputCls}
                  value={form[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              </WizardField>
            ),
          )}
          <div className={wizFooterRow}>
            <button type="button" className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className={`${btnPrimary} ml-auto h-10 rounded-xl px-4`} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </WizFormShell>
    </Modal>
  );
}

function MasterTab({
  endpoint,
  label,
  columns,
  fields,
  hasActive,
  notify,
}: {
  endpoint: string;
  label: string;
  columns: Column<any>[];
  fields: MasterField[];
  hasActive?: boolean;
  notify: Notify;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<{ initial?: Record<string, any> } | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const dSearch = useDebounced(search);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<any[]>(`/api/${endpoint}${qs({ page, limit: 20, search: dSearch })}`);
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || `Failed to load ${label.toLowerCase()} list`);
    } finally {
      setLoading(false);
    }
  }, [endpoint, label, page, dSearch]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [dSearch]);

  const toggleActive = async (row: any) => {
    setTogglingId(row.id);
    try {
      const res = await crmPut(`/api/${endpoint}/${row.id}`, { is_active: !row.is_active });
      notify(res.message || `${label} ${row.is_active ? "deactivated" : "activated"}`);
      load();
    } catch (e: any) {
      notify(e?.message || "Failed to update status", "err");
    } finally {
      setTogglingId(null);
    }
  };

  const allColumns: Column<any>[] = [...columns];
  if (hasActive) {
    allColumns.push({
      key: "is_active",
      label: "Status",
      render: (r) => <StatusBadge status={r.is_active ? "Active" : "Inactive"} />,
    });
  }
  allColumns.push({
    key: "_actions",
    label: "",
    className: "text-right",
    render: (r) => (
      <span className="inline-flex gap-1">
        <button className={iconBtn} title={`Edit ${label.toLowerCase()}`} aria-label={`Edit ${label.toLowerCase()}`} onClick={(e) => { e.stopPropagation(); setModal({ initial: r }); }}>
          <Pencil size={15} />
        </button>
        {hasActive && (
          <button
            className={`${iconBtn} ${r.is_active ? "hover:!text-rose-600" : "hover:!text-emerald-600"}`}
            title={r.is_active ? "Deactivate" : "Activate"}
            aria-label={r.is_active ? "Deactivate" : "Activate"}
            disabled={togglingId === r.id}
            onClick={(e) => { e.stopPropagation(); toggleActive(r); }}
          >
            <Power size={15} />
          </button>
        )}
      </span>
    ),
  });

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button className={btnPrimary} onClick={() => setModal({})}>
          <Plus size={15} /> Add {label}
        </button>
      </div>
      {error && <div className="mb-3"><ErrorBox error={error} onRetry={load} /></div>}
      <DataTable
        columns={allColumns}
        rows={rows}
        meta={meta}
        headerRight={meta ? <span className="whitespace-nowrap text-xs font-medium text-muted">{meta.total} {meta.total === 1 ? "record" : "records"}, page {meta.page}/{Math.max(1, meta.pages || 1)}</span> : undefined}
        loading={loading}
        search={search}
        onSearch={setSearch}
        onPage={setPage}
        emptyMessage={`No ${label.toLowerCase()} records`}
      />
      {modal && (
        <MasterFormModal
          endpoint={endpoint}
          label={label}
          fields={fields}
          initial={modal.initial}
          onClose={() => setModal(null)}
          onSaved={load}
          notify={notify}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------- app settings */

type SettingRow = { key: string; value: string; description?: string | null };

/* ------------------------------------------------ organisation settings */

type OrgSetting = {
  key: string;
  value: string;
  source: "settings" | "environment" | "default";
  env_key: string;
  default: string;
};

/** Groups + friendly labels for the Organisation tab. Everything here used to
 * live in .env or code — now Admin/CEO edit it and it applies within a minute
 * (immediately for the admin who saved). Clearing a field falls back to the
 * server environment / code default, shown as the value's source. */
const ORG_GROUPS: Array<{ title: string; hint: string; fields: Array<{ key: string; label: string; hint?: string; placeholder?: string; type?: "bool" }> }> = [
  {
    title: "Company identity",
    hint: "Appears on interview invitations, invoices and email signatures.",
    fields: [
      { key: "org.company_name", label: "Company name" },
      { key: "org.company_short_name", label: "Short name" },
      { key: "org.company_phone", label: "Phone" },
      { key: "org.company_email", label: "Contact email" },
      { key: "org.company_website", label: "Website" },
    ],
  },
  {
    title: "Email & links",
    hint: "Where email buttons point, and which addresses may appear in the From header.",
    fields: [
      { key: "email.public_base_url", label: "Public base URL",
        hint: "Every 'Open in Karnex' button uses this. A LAN IP here breaks links for anyone outside the office network.",
        placeholder: "https://karnex.example.com" },
      { key: "email.sender_domains", label: "Allowed sender domains",
        hint: "Comma separated. Login users on these domains appear as the From address (domain must be verified with your mail provider).",
        placeholder: "karnex.in" },
    ],
  },
  {
    title: "Interviews",
    hint: "Defaults for AI interview scheduling.",
    fields: [
      { key: "interview.default_duration", label: "Default duration",
        hint: "Shown on the invitation when set, e.g. '45 minutes'. Leave blank to omit the row.",
        placeholder: "45 minutes" },
      { key: "interview.autosend", label: "Auto-send invite on scheduling", type: "bool",
        hint: "When on, scheduling an AI interview immediately emails the candidate the invitation." },
    ],
  },
  {
    // The Operations tab has always pointed here for these switches; until now
    // they were only editable through the database.
    title: "Background jobs",
    hint: "The daily jobs on the Operations tab. Turning one off stops it silently — check Operations after any change.",
    fields: [
      { key: "scheduler.enabled", label: "Scheduler enabled", type: "bool",
        hint: "Master switch. Off means none of the jobs below run at all." },
      { key: "scheduler.run_hour", label: "Run hour",
        hint: "Local hour, 0-23. Jobs catch up after a restart, so a server that was off at this hour still runs the day's work.",
        placeholder: "8" },
      { key: "scheduler.timesheet_reminders", label: "Timesheet due reminders", type: "bool" },
      { key: "scheduler.po_expiry", label: "Purchase order expiry notices", type: "bool" },
      { key: "scheduler.recurring_invoices", label: "Recurring invoice drafts", type: "bool" },
      { key: "scheduler.pe_leave_credit", label: "Monthly leave credit", type: "bool",
        hint: "Credits project-employee leave and replays any month it missed. Turning this off stops accrual — balances drift with no error anywhere." },
      { key: "scheduler.pe_leave_credit_lookback", label: "Leave repair window (months)",
        hint: "How far back the leave job will repair a month it never ran. Longer gaps should be backfilled deliberately with run_pe_leave_credit.py --from.",
        placeholder: "12" },
    ],
  },
  {
    title: "Finance",
    hint: "Statutory rates. Changes apply to invoices generated AFTER the change — existing records keep their figures.",
    fields: [
      { key: "finance.tds_rate_percent", label: "TDS rate (%)",
        hint: "Default deduction under Sec 194J. Used when recording TDS on an invoice.",
        placeholder: "10" },
    ],
  },
  {
    // An office move, a new GSTIN or a bank change must not be a code deploy.
    title: "Tax Invoice — seller details",
    hint: "The company block printed on every tax invoice PDF.",
    fields: [
      { key: "invoice.seller_name", label: "Legal name" },
      { key: "invoice.seller_tagline", label: "Tagline" },
      { key: "invoice.seller_address_line1", label: "Address line 1" },
      { key: "invoice.seller_address_line2", label: "Address line 2" },
      { key: "invoice.seller_city", label: "City" },
      { key: "invoice.seller_state", label: "State" },
      { key: "invoice.seller_state_code", label: "GST state code",
        hint: "Two digits, e.g. 27 for Maharashtra. Drives CGST/SGST vs IGST." },
      { key: "invoice.seller_pincode", label: "Pincode" },
      { key: "invoice.seller_phone", label: "Phone" },
      { key: "invoice.seller_email", label: "Billing email" },
      { key: "invoice.seller_website", label: "Website" },
      { key: "invoice.seller_gstin", label: "GSTIN" },
      { key: "invoice.seller_pan", label: "PAN" },
      { key: "invoice.seller_cin", label: "CIN" },
      { key: "invoice.seller_declaration", label: "Declaration text" },
    ],
  },
  {
    title: "Tax Invoice — bank account",
    hint: "The receivable account printed on every tax invoice.",
    fields: [
      { key: "invoice.bank_name", label: "Bank" },
      { key: "invoice.bank_account_name", label: "Account name" },
      { key: "invoice.bank_account_number", label: "Account number" },
      { key: "invoice.bank_ifsc", label: "IFSC" },
      { key: "invoice.bank_branch", label: "Branch" },
      { key: "invoice.bank_account_type", label: "Account type" },
    ],
  },
];

function OrganisationTab({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<OrgSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testBusy, setTestBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<{ settings: OrgSetting[] }>("/api/org-settings");
      setRows(res.data?.settings || []);
      setEdited({});
    } catch (e: any) {
      setError(e?.message || "Failed to load organisation settings");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  const valueOf = (key: string) => edited[key] ?? (byKey[key]?.source === "settings" ? byKey[key].value : "");
  const effective = (key: string) => edited[key] ?? byKey[key]?.value ?? "";
  const dirty = Object.keys(edited).length > 0;

  const saveAll = async () => {
    setSaving(true);
    try {
      const res = await crmPut("/api/org-settings", { values: edited });
      notify(res.message || "Organisation settings saved");
      await load();
    } catch (e: any) {
      notify(e?.message || "Failed to save settings", "err");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTestBusy(true);
    try {
      const res = await crmPost("/api/org-settings/test-email", { to: testTo.trim() });
      notify(res.message || "Test email queued");
    } catch (e: any) {
      notify(e?.message || "Failed to queue test email", "err");
    } finally {
      setTestBusy(false);
    }
  };

  if (loading) return <Spinner label="Loading organisation settings…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;

  const srcChip = (s?: OrgSetting) => {
    if (!s) return null;
    const tone = s.source === "settings"
      ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
      : s.source === "environment"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        : "bg-surface-2 text-muted";
    const label = s.source === "settings" ? "Settings" : s.source === "environment" ? ".env" : "Default";
    return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${tone}`}>{label}</span>;
  };

  return (
    <div className="space-y-4">
      {ORG_GROUPS.map((g) => (
        <div key={g.title} className="rounded-card border border-subtle bg-surface-1 shadow-raised">
          <div className="border-b border-subtle px-4 py-3">
            <div className="text-sm font-bold text-primary">{g.title}</div>
            <div className="text-xs text-muted">{g.hint}</div>
          </div>
          <div className="divide-y divide-[color:var(--border-subtle)]">
            {g.fields.map((f) => {
              const s = byKey[f.key];
              return (
                <div key={f.key} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <div className="min-w-56 flex-1">
                    <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                      {f.label} {srcChip(s)}
                    </div>
                    {f.hint && <div className="mt-0.5 text-xs text-muted">{f.hint}</div>}
                    {s && s.source !== "settings" && (
                      <div className="mt-0.5 text-[11px] text-muted">
                        Current: <span className="font-semibold">{s.value || "(empty)"}</span> — type here to override
                      </div>
                    )}
                  </div>
                  {f.type === "bool" ? (
                    <select
                      className={`${inputCls} !w-40`}
                      value={/^(1|true|yes|on)$/i.test(effective(f.key)) ? "true" : "false"}
                      onChange={(e) => setEdited((v) => ({ ...v, [f.key]: e.target.value }))}
                    >
                      <option value="false">Off</option>
                      <option value="true">On</option>
                    </select>
                  ) : (
                    <input
                      className={`${inputCls} !w-72`}
                      value={valueOf(f.key)}
                      placeholder={f.placeholder || (s?.source !== "settings" ? s?.value || "" : "")}
                      onChange={(e) => setEdited((v) => ({ ...v, [f.key]: e.target.value }))}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-subtle bg-surface-1 px-4 py-3 shadow-raised">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-secondary">Send a test email to</span>
            <input className={`${inputCls} !w-64`} type="email" value={testTo}
              placeholder="you@karnex.in" onChange={(e) => setTestTo(e.target.value)} />
          </label>
          <button className={btnSecondary} disabled={testBusy || !testTo.trim()} onClick={sendTest}>
            {testBusy ? "Queueing…" : "Send test email"}
          </button>
        </div>
        <button className={btnPrimary} disabled={!dirty || saving} onClick={saveAll}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------ operations (jobs + backup) */

type SchedJob = {
  job: string;
  label: string;
  setting: string;
  last_run: Record<string, any>;
  /** Job switch is on. A disabled job is not "broken", so it never reads red. */
  enabled?: boolean;
  /** No run in 48h. Every job is daily, so this means the worker is not running. */
  stale?: boolean;
};
type BackupStatus = {
  configured: boolean;
  readable?: boolean;
  folder?: string;
  age_hours?: number | null;
  stale?: boolean;
  hint?: string;
  last?: Record<string, any>;
};

const agoText = (hours?: number | null) => {
  if (hours == null) return "unknown";
  if (hours < 1) return "less than an hour ago";
  if (hours < 48) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
};

/* ------------------------------------------------ email outbox (delivery) */

type OutboxRow = {
  id: number; event: string; to_email: string; to_name?: string | null;
  subject: string; status: string; attempts: number;
  last_error?: string | null; sent_at?: string | null; created_at?: string | null;
};
type OutboxStats = {
  by_status: Record<string, number>;
  top_failing_events: { event: string; count: number }[];
  oldest_pending_at?: string | null;
  smtp_configured: boolean;
  notifications_enabled: boolean;
  max_attempts: number;
};

const OUTBOX_STATUSES = ["All", "Queued", "Failed", "Skipped", "Sent"] as const;

/** Every notification and candidate email goes through the outbox; until this
 * panel existed a drain failure was invisible — the sender saw "sent", the
 * recipient got nothing, and the error sat in a table nobody could read. */
function EmailOutboxPanel({ notify }: { notify: Notify }) {
  const [stats, setStats] = useState<OutboxStats | null>(null);
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [status, setStatus] = useState<(typeof OUTBOX_STATUSES)[number]>("All");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await crmGet<OutboxStats>("/api/email-outbox/stats");
      setStats(s.data);
    } catch { setStats(null); }
    try {
      const r = await crmGet<OutboxRow[]>(
        `/api/email-outbox${status !== "All" ? `?status=${status}&limit=20` : "?limit=20"}`);
      setRows(r.data || []);
    } catch { setRows([]); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const drain = async () => {
    setBusy("drain");
    try {
      const res = await crmPost<{ sent?: number; failed?: number; error?: string }>(
        "/api/email-outbox/drain?limit=50");
      const d = res.data || {};
      notify(d.error ? `Drain: ${d.error}` : `Drained — sent ${d.sent ?? 0}, failed ${d.failed ?? 0}`,
             d.error || d.failed ? "err" : "ok");
      await load();
    } catch (e: any) {
      notify(e?.message || "Drain failed", "err");
    } finally { setBusy(null); }
  };

  const retry = async (id: number) => {
    setBusy(`retry-${id}`);
    try {
      await crmPost(`/api/email-outbox/${id}/retry`);
      notify("Queued for retry — it sends on the next drain");
      await load();
    } catch (e: any) {
      notify(e?.message || "Retry failed", "err");
    } finally { setBusy(null); }
  };

  /** Login-only check against the SMTP server — shows its exact answer, so a
   * revoked token reads "535 Authentication Failed" here instead of silently
   * stranding every mail at Queued. */
  const testSmtp = async () => {
    setBusy("test");
    try {
      const res = await crmPost<{ ok: boolean; error?: string; detail?: string }>(
        "/api/email-outbox/test-smtp");
      notify(res.message || (res.data?.ok ? "SMTP login OK" : "SMTP login failed"),
             res.data?.ok ? "ok" : "err");
    } catch (e: any) {
      notify(e?.message || "SMTP test failed", "err");
    } finally { setBusy(null); }
  };

  const retryAllFailed = async () => {
    setBusy("retry-all");
    try {
      const res = await crmPost<{ requeued: number; sent?: number; failed?: number }>(
        "/api/email-outbox/retry-failed");
      notify(res.message || "Requeued failed mails",
             (res.data?.failed ?? 0) > 0 ? "err" : "ok");
      await load();
    } catch (e: any) {
      notify(e?.message || "Retry-all failed", "err");
    } finally { setBusy(null); }
  };

  const smtpBad = stats != null && !stats.smtp_configured;
  const failed = stats?.by_status?.Failed ?? 0;
  const queued = stats?.by_status?.Queued ?? 0;
  const statusBadge = (s: string) => {
    const cls = s === "Sent" ? "bg-success-soft text-success"
      : s === "Failed" ? "bg-danger text-white"
      : s === "Skipped" ? "bg-warning-soft text-warning"
      : "bg-surface-2 text-secondary";
    return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${cls}`}>{s}</span>;
  };

  return (
    <div className={`rounded-card border shadow-raised ${
      smtpBad || failed ? "border-danger/40" : "border-subtle"} bg-surface-1`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-4 py-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-primary">Email delivery (outbox)</span>
            {smtpBad && (
              <span className="rounded-full bg-danger px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                SMTP not configured
              </span>
            )}
            {stats != null && !stats.notifications_enabled && (
              <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-bold uppercase text-warning">
                Notifications off
              </span>
            )}
          </div>
          <div className="text-xs text-muted">
            {stats
              ? `Queued ${queued} · Failed ${failed} · Skipped ${stats.by_status?.Skipped ?? 0} · Sent ${stats.by_status?.Sent ?? 0}`
              : "Loading…"}
            {smtpBad && " — nothing can send until SMTP_HOST / SMTP_USER / SMTP_PASSWORD are set."}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={`${btnSecondary} !px-3 !py-1.5 text-xs`} disabled={busy !== null} onClick={testSmtp}>
            {busy === "test" ? "Testing…" : "Test SMTP"}
          </button>
          {failed > 0 && (
            <button className={`${btnSecondary} !px-3 !py-1.5 text-xs`} disabled={busy !== null} onClick={retryAllFailed}>
              {busy === "retry-all" ? "Requeuing…" : `Retry all failed (${failed})`}
            </button>
          )}
          <button className={btnSecondary} disabled={busy !== null} onClick={drain}>
            {busy === "drain" ? "Sending…" : "Send queued now"}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 px-4 pt-3">
        {OUTBOX_STATUSES.map((s) => (
          <button key={s}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors duration-micro ${
              status === s ? "bg-brand-600 text-white" : "bg-surface-2 text-secondary hover:text-primary"}`}
            onClick={() => setStatus(s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="divide-y divide-[color:var(--border-subtle)] px-1 pb-1 pt-2">
        {rows.length === 0 && (
          <div className="px-4 py-5 text-center text-sm text-muted">No emails{status !== "All" ? ` with status ${status}` : " yet"}.</div>
        )}
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
            <div className="min-w-56 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-primary">{r.to_email}</span>
                {statusBadge(r.status)}
                <span className="text-[11px] text-muted">{r.event}</span>
              </div>
              <div className="truncate text-xs text-secondary" title={r.subject}>{r.subject}</div>
              <div className="text-[11px] text-muted">
                {r.sent_at ? `Sent ${new Date(r.sent_at).toLocaleString()}`
                  : r.created_at ? `Queued ${new Date(r.created_at).toLocaleString()}` : ""}
                {r.attempts ? ` · ${r.attempts} attempt${r.attempts === 1 ? "" : "s"}` : ""}
              </div>
              {r.last_error && (
                <div className="mt-0.5 text-xs font-semibold text-danger">{r.last_error}</div>
              )}
            </div>
            {(r.status === "Failed" || r.status === "Skipped") && (
              <button className={`${btnSecondary} !px-3 !py-1.5 text-xs`}
                disabled={busy !== null} onClick={() => retry(r.id)}>
                {busy === `retry-${r.id}` ? "Queuing…" : "Retry"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Proof that the automation is alive. Background jobs and backups fail in the
 * same silent way — everything looks fine until the day it matters — so this
 * panel states plainly when each last ran and goes red when it stops. */
function OperationsTab({ notify }: { notify: Notify }) {
  const [jobs, setJobs] = useState<SchedJob[]>([]);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await crmGet<{ jobs: SchedJob[] }>("/api/scheduler/status");
      setJobs(res.data?.jobs || []);
    } catch { setJobs([]); }
    try {
      const res = await crmGet<BackupStatus>("/api/backup/status");
      setBackup(res.data);
    } catch { setBackup(null); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const runJob = async (job?: string) => {
    setRunning(job || "all");
    try {
      const res = await crmPost(`/api/scheduler/run${job ? `?job=${job}` : ""}`);
      notify(res.message || "Scheduler run complete");
      await load();
    } catch (e: any) {
      notify(e?.message || "Failed to run the scheduler", "err");
    } finally {
      setRunning(null);
    }
  };

  if (loading) return <Spinner label="Loading operations status…" />;

  const backupBad = !backup?.configured || backup?.stale;

  return (
    <div className="space-y-4">
      <div className={`rounded-card border px-4 py-3 shadow-raised ${
        backupBad ? "border-danger/40 bg-danger-soft" : "border-subtle bg-surface-1"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-bold text-primary">Backups</div>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
            backupBad ? "bg-danger text-white" : "bg-success-soft text-success"}`}>
            {!backup?.configured ? "Never run" : backup?.stale ? "Stale" : "Healthy"}
          </span>
        </div>
        {backup?.configured ? (
          <div className="mt-1 text-xs text-secondary">
            Last {backup.last?.ok ? "successful backup" : "attempt (FAILED)"} {agoText(backup.age_hours)}
            {backup.last?.database_file ? ` — ${backup.last.database_file}` : ""}
            {backup.last?.verify_detail ? ` (verified: ${backup.last.verify_detail})` : ""}
            <div className="mt-0.5 text-muted">Folder: {backup.folder}</div>
            {backup.last?.error && <div className="mt-0.5 font-semibold text-danger">{backup.last.error}</div>}
          </div>
        ) : (
          <div className="mt-1 text-xs text-danger">
            No backup has ever run. Schedule <code>backup_karnex.bat</code> daily in Windows Task
            Scheduler — without it, one disk failure loses every customer, timesheet and invoice.
          </div>
        )}
      </div>

      <div className="rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-4 py-3">
          <div>
            <div className="text-sm font-bold text-primary">Daily jobs</div>
            <div className="text-xs text-muted">
              Timesheet reminders, PO-expiry notices, recurring invoices and the monthly leave
              credit. Switches and the run hour live on the Organisation tab.
            </div>
          </div>
          <button className={btnSecondary} disabled={running !== null} onClick={() => runJob()}>
            {running === "all" ? "Running…" : "Run all now"}
          </button>
        </div>
        <div className="divide-y divide-[color:var(--border-subtle)]">
          {jobs.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted">
              Scheduler not available — restart the backend after applying this update.
            </div>
          )}
          {jobs.map((j) => {
            const last = j.last_run || {};
            const at = last.at ? new Date(last.at).toLocaleString() : null;
            const detail = Object.entries(last)
              .filter(([k]) => k !== "at")
              .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
              .join(" · ");
            // A job that is switched off is not failing — only an ENABLED job
            // that has gone quiet is worth alarming about.
            const silent = j.enabled !== false && j.stale;
            return (
              <div key={j.job} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-56 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-primary">{j.label}</span>
                    {j.enabled === false && (
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold uppercase text-muted">
                        Off
                      </span>
                    )}
                    {silent && (
                      <span className="rounded-full bg-danger px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                        {at ? "Stale" : "Never run"}
                      </span>
                    )}
                  </div>
                  <div className={`text-xs ${silent ? "text-danger" : "text-muted"}`}>
                    {at ? `Last run ${at}` : "Has not run yet"}
                    {detail ? ` — ${detail}` : ""}
                  </div>
                  {silent && (
                    <div className="mt-0.5 text-xs text-danger">
                      This job is on but has not run in over 48 hours — the scheduler worker is
                      probably not running.
                      {j.job === "pe_leave_credit"
                        ? " Leave balances stop accruing while it is down; it repairs missed months on its next run."
                        : ""}
                    </div>
                  )}
                </div>
                <button className={`${btnSecondary} !px-3 !py-1.5 text-xs`}
                  disabled={running !== null} onClick={() => runJob(j.job)}>
                  {running === j.job ? "Running…" : "Run now"}
                </button>
              </div>
            );
          })}
        </div>
        <div className="border-t border-subtle px-4 py-2 text-[11px] text-muted">
          Running a job by hand is safe: every message carries a one-time key, so nothing already
          sent can be sent twice.
        </div>
      </div>

      <EmailOutboxPanel notify={notify} />
    </div>
  );
}

const THRESHOLD_KEY = "ai_interview_pass_threshold";

function AppSettingsTab({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crmGet<SettingRow[]>("/api/settings");
      setRows(res.data || []);
      setEdited({});
      setErrors({});
    } catch (e: any) {
      setError(e?.message || "Failed to load app settings");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const valueOf = (r: SettingRow) => edited[r.key] ?? r.value;

  const save = async (r: SettingRow) => {
    const value = valueOf(r).trim();
    if (r.key === THRESHOLD_KEY) {
      const n = Number(value);
      if (value === "" || !Number.isFinite(n) || n < 0 || n > 100) {
        setErrors((e) => ({ ...e, [r.key]: "Must be a number between 0 and 100" }));
        return;
      }
    }
    setErrors((e) => ({ ...e, [r.key]: "" }));
    setSavingKey(r.key);
    try {
      const res = await crmPut(`/api/settings/${encodeURIComponent(r.key)}`, { value });
      notify(res.message || `Setting '${r.key}' saved`);
      setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, value } : x)));
      setEdited((e) => {
        const next = { ...e };
        delete next[r.key];
        return next;
      });
    } catch (e: any) {
      notify(e?.message || "Failed to save setting", "err");
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) return <Spinner label="Loading settings…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!rows.length) return <div className="py-10 text-center text-sm text-muted">No app settings found</div>;

  return (
    <div className="rounded-card border border-subtle bg-surface-1 shadow-raised">
      {rows.map((r) => {
        const isThreshold = r.key === THRESHOLD_KEY;
        const dirty = edited[r.key] !== undefined && edited[r.key] !== r.value;
        return (
          <div
            key={r.key}
            className={`flex flex-wrap items-start gap-3 border-b border-subtle px-4 py-3.5 last:border-b-0 ${
              isThreshold ? "bg-sky-50/70 dark:bg-sky-950/30" : ""
            }`}
          >
            <div className="min-w-56 flex-1">
              <div className="text-sm font-bold text-primary">
                {r.key}
                {isThreshold && (
                  <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                    AI interview pass threshold
                  </span>
                )}
              </div>
              {r.description && <div className="mt-0.5 text-xs text-muted">{r.description}</div>}
              {errors[r.key] && <div className="mt-1 text-xs text-rose-600">{errors[r.key]}</div>}
            </div>
            <div className="flex items-center gap-2">
              {isThreshold ? (
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className={`${inputCls} !w-32 pr-7`}
                    value={valueOf(r)}
                    onChange={(e) => setEdited((v) => ({ ...v, [r.key]: e.target.value }))}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">%</span>
                </div>
              ) : (
                <input
                  className={`${inputCls} !w-64`}
                  value={valueOf(r)}
                  onChange={(e) => setEdited((v) => ({ ...v, [r.key]: e.target.value }))}
                />
              )}
              <button className={btnPrimary} disabled={!dirty || savingKey === r.key} onClick={() => save(r)}>
                {savingKey === r.key ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- page */

export function CrmSettingsPage() {
  const isAdmin = useHasRole();
  const [toast, notify] = useToast();
  const [tab, setTab] = useState("departments");
  const [deptOptions, setDeptOptions] = useState<Option[]>([]);

  useEffect(() => {
    if (!isAdmin || tab !== "designations") return;
    crmGet<any[]>(`/api/departments${qs({ limit: 200 })}`)
      .then((res) => setDeptOptions((res.data || []).map((d: any) => ({ value: String(d.id), label: d.name }))))
      .catch(() => setDeptOptions([]));
  }, [isAdmin, tab]);

  if (!isAdmin) {
    return <ErrorBox error="Access denied: the Settings page is available to Admins only." />;
  }

  const deptName = (id?: number | null) => deptOptions.find((o) => o.value === String(id))?.label || (id ? `#${id}` : "—");

  return (
    <div>
      {toast}
      <h1 className="text-display mb-4 text-xl font-bold text-primary">Settings</h1>
      <Tabs
        tabs={[
          { key: "departments", label: "Departments" },
          { key: "designations", label: "Designations" },
          { key: "skills", label: "Skills" },
          { key: "locations", label: "Locations" },
          { key: "document-types", label: "Document Types" },
          { key: "leave-policy-types", label: "Leave Policy Types" },
          { key: "customer-policies", label: "Customer Policies" },
          { key: "organisation", label: "Organisation" },
          { key: "operations", label: "Operations" },
          { key: "app-settings", label: "App Settings" },
          { key: "email-drafts", label: "Email Drafts" },
          { key: "ui-text", label: "UI Text" },
          { key: "activity-log", label: "Activity Log" },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="mt-4">
        {tab === "departments" && (
          <MasterTab
            endpoint="departments"
            label="Department"
            hasActive
            notify={notify}
            columns={[{ key: "name", label: "Name", render: (r) => <span className="font-semibold text-primary">{r.name}</span> }]}
            fields={[
              { key: "name", label: "Name", required: true },
              { key: "is_active", label: "Active", type: "checkbox", defaultValue: true },
            ]}
          />
        )}
        {tab === "designations" && (
          <MasterTab
            endpoint="designations"
            label="Designation"
            hasActive
            notify={notify}
            columns={[
              { key: "name", label: "Name", render: (r) => <span className="font-semibold text-primary">{r.name}</span> },
              { key: "department_id", label: "Department", render: (r) => deptName(r.department_id) },
            ]}
            fields={[
              { key: "name", label: "Name", required: true },
              { key: "department_id", label: "Department", type: "select", asNumber: true, options: deptOptions },
              { key: "is_active", label: "Active", type: "checkbox", defaultValue: true },
            ]}
          />
        )}
        {tab === "skills" && (
          <MasterTab
            endpoint="skills"
            label="Skill"
            hasActive
            notify={notify}
            columns={[
              { key: "name", label: "Name", render: (r) => <span className="font-semibold text-primary">{r.name}</span> },
              { key: "category", label: "Category", render: (r) => r.category || "—" },
            ]}
            fields={[
              { key: "name", label: "Name", required: true },
              { key: "category", label: "Category", placeholder: "e.g. Backend, Cloud, QA" },
              { key: "is_active", label: "Active", type: "checkbox", defaultValue: true },
            ]}
          />
        )}
        {tab === "locations" && (
          <MasterTab
            endpoint="locations"
            label="Location"
            notify={notify}
            columns={[
              { key: "city", label: "City", render: (r) => <span className="font-semibold text-primary">{r.city}</span> },
              { key: "state", label: "State", render: (r) => r.state || "—" },
              { key: "country", label: "Country" },
            ]}
            fields={[
              { key: "city", label: "City", required: true },
              { key: "state", label: "State" },
              { key: "country", label: "Country", required: true, defaultValue: "India" },
            ]}
          />
        )}
        {tab === "document-types" && (
          <MasterTab
            endpoint="document-types"
            label="Document Type"
            hasActive
            notify={notify}
            columns={[{ key: "name", label: "Name", render: (r) => <span className="font-semibold text-primary">{r.name}</span> }]}
            fields={[
              { key: "name", label: "Name", required: true },
              { key: "is_active", label: "Active", type: "checkbox", defaultValue: true },
            ]}
          />
        )}
        {tab === "leave-policy-types" && (
          <MasterTab
            endpoint="leave-policy-types"
            label="Leave Policy Type"
            notify={notify}
            columns={[
              { key: "name", label: "Name", render: (r) => <span className="font-semibold text-primary">{r.name}</span> },
              { key: "accrual_rule", label: "Accrual Rule", render: (r) => r.accrual_rule || "—" },
              { key: "carry_forward_rule", label: "Carry-Forward Rule", render: (r) => r.carry_forward_rule || "—" },
            ]}
            fields={[
              { key: "name", label: "Name", required: true },
              { key: "accrual_rule", label: "Accrual rule", placeholder: "e.g. 1.5 days per month" },
              { key: "carry_forward_rule", label: "Carry-forward rule", placeholder: "e.g. Max 10 days per year" },
            ]}
          />
        )}
        {tab === "customer-policies" && <CustomerPoliciesTab notify={notify} />}
        {tab === "organisation" && <OrganisationTab notify={notify} />}
        {tab === "operations" && <OperationsTab notify={notify} />}
        {tab === "email-drafts" && <EmailDraftsTab notify={notify} />}
        {tab === "app-settings" && <AppSettingsTab notify={notify} />}
        {tab === "ui-text" && <UiTextTab notify={notify} />}
        {tab === "activity-log" && <ActivityLogPage />}
      </div>
    </div>
  );
}

/* ------------------------------------------------ UI text (teaching copy) */

/** Rewrite the app's teaching copy without a deploy: status-badge tooltips
 * and empty-state lessons. Blank = the built-in text (shown greyed as the
 * placeholder). Stored as `uitext.*` app settings; served to every user by
 * GET /api/ui-text and applied on next page load. */
function UiTextTab({ notify }: { notify: Notify }) {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [defaults, setDefaults] = useState<{ statuses: [string, string][]; pages: [string, string][] }>({ statuses: [], pages: [] });
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([
      crmGet<Record<string, string>>("/api/ui-text").catch(() => ({ data: {} as Record<string, string> })),
      import("../lib/statusHelp"),
      import("../components/TeachingEmpty"),
    ]).then(([res, sh, te]) => {
      setOverrides(res.data || {});
      setDrafts(res.data || {});
      setDefaults({
        statuses: Object.entries(sh.STATUS_HELP),
        pages: Object.entries(te.LESSONS).map(([k, v]) => [k, v.body] as [string, string]),
      });
      setLoading(false);
    });
  }, []);

  const save = async (key: string) => {
    setBusyKey(key);
    try {
      await crmPut(`/api/settings/${encodeURIComponent(key)}`, {
        value: (drafts[key] || "").trim(),
        description: "UI text override (Settings → UI Text)",
      });
      setOverrides((o) => ({ ...o, [key]: (drafts[key] || "").trim() }));
      notify("Saved — users see it after their next page load");
    } catch (e: any) {
      notify(e?.message || "Failed to save", "err");
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) return <Spinner label="Loading UI text…" />;

  const row = (key: string, label: string, builtIn: string) => {
    const draft = drafts[key] ?? "";
    const changed = (draft || "") !== (overrides[key] || "");
    return (
      <div key={key} className="flex flex-wrap items-start gap-3 px-4 py-3">
        <div className="min-w-56 flex-1">
          <div className="text-sm font-semibold text-primary">{label}</div>
          <textarea
            className={`${inputCls} mt-1 min-h-[2.25rem] text-xs`}
            rows={2}
            value={draft}
            placeholder={builtIn}
            onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
          />
        </div>
        <button
          type="button"
          className={`${btnSecondary} mt-6 !px-3 !py-1.5 text-xs`}
          disabled={busyKey === key || !changed}
          onClick={() => save(key)}
        >
          {busyKey === key ? "Saving…" : draft.trim() ? "Save" : "Use built-in"}
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="border-b border-subtle px-4 py-3">
          <div className="text-sm font-bold text-primary">Status explanations</div>
          <p className="mt-0.5 text-xs text-muted">
            The tooltip on each status badge. Blank uses the built-in text shown greyed.
            Keep it to one or two sentences and always name who acts next.
          </p>
        </div>
        <div className="divide-y divide-[color:var(--border-subtle)]">
          {defaults.statuses.map(([status, builtIn]) =>
            row(`uitext.status.${status}`, status.replace(/_/g, " "), builtIn))}
        </div>
      </div>
      <div className="rounded-card border border-subtle bg-surface-1 shadow-raised">
        <div className="border-b border-subtle px-4 py-3">
          <div className="text-sm font-bold text-primary">Empty-page lessons</div>
          <p className="mt-0.5 text-xs text-muted">
            The explanation shown when a page has no data yet.
          </p>
        </div>
        <div className="divide-y divide-[color:var(--border-subtle)]">
          {defaults.pages.map(([page, builtIn]) =>
            row(`uitext.empty.${page}`, page.replace(/-/g, " "), builtIn))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------- customer policy matrix ----

   The commercial policy matrix (Aug 2026): one row per customer — leave
   accruals, holiday/week-off/comp-off billability, billing type, hours per
   day, paid leaves and the monthly hour cap. A WINDOW onto the same tables
   the New Opportunity form inherits from (customer default billing policy +
   customer leave policies + branch caps) — editing here IS editing what
   opportunities will reference; there is no second copy. */

type PolicyMatrixRow = {
  customer_id: number;
  customer_name: string;
  leaves: { type: string; monthly_credit: number | null; carry_forward: boolean }[];
  holidays_billable: boolean | null;
  week_off_billable: boolean | null;
  leave_billable: boolean | null;
  comp_off_billable: boolean | null;
  billing_type: string | null;
  hours_per_day: number | null;
  min_hours_full_day: number | null;
  billable_leaves_per_year: number | null;
  max_billable_hours_per_month: number | null;
  has_policy: boolean;
};

function CustomerPoliciesTab({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<PolicyMatrixRow[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<PolicyMatrixRow | null>(null);

  const load = useCallback(() => {
    setRows(null);
    setError("");
    crmGet<PolicyMatrixRow[]>("/api/customers/policy-matrix")
      .then((r) => setRows(r.data || []))
      .catch((e: any) => setError(e?.message || "Failed to load policy matrix"));
  }, []);
  useEffect(() => { load(); }, [load]);

  const bill = (v: boolean | null) =>
    v === null ? <span className="text-muted">—</span>
      : v ? <span className="font-semibold text-emerald-600 dark:text-emerald-400">Billable</span>
        : <span className="text-secondary">Not Billable</span>;

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (rows === null) return <Spinner label="Loading customer policies…" />;

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Per-customer commercial terms. The New Opportunity form inherits these
        (via the selected branch) — billability flags and paid leaves arrive
        locked; leave accruals come from each customer&rsquo;s Leave Policies.
        Editing here changes what every FUTURE opportunity references.
      </p>
      <div className="overflow-x-auto rounded-card border border-subtle bg-surface-1 shadow-raised">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Leaves</th>
              <th className="px-3 py-2">Holidays</th>
              <th className="px-3 py-2">Week Offs</th>
              <th className="px-3 py-2">Comp-off</th>
              <th className="px-3 py-2">Billing</th>
              <th className="px-3 py-2 text-right">Hrs/day</th>
              <th className="px-3 py-2 text-right">Paid leaves/yr</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.customer_id} className="row-hover border-t border-subtle align-top">
                <td className="px-3 py-2 font-semibold text-primary">{r.customer_name}</td>
                <td className="px-3 py-2">
                  {r.leaves.length === 0 ? (
                    <span className="text-secondary">No paid leaves</span>
                  ) : (
                    <div className="space-y-0.5">
                      {r.leaves.map((l, i) => (
                        <div key={i} className="text-xs text-secondary">
                          <span className="font-semibold text-primary">{l.type}</span>
                          {l.monthly_credit != null && <> +{l.monthly_credit}/mo</>}
                          {" · "}
                          {l.carry_forward ? "carries forward" : "lapses year-end"}
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">{bill(r.holidays_billable)}</td>
                <td className="px-3 py-2">{bill(r.week_off_billable)}</td>
                <td className="px-3 py-2">
                  {bill(r.comp_off_billable)}
                  {r.comp_off_billable && r.max_billable_hours_per_month != null && (
                    <div className="text-[11px] text-muted">
                      Max {r.max_billable_hours_per_month} hrs/month
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-secondary">
                  {(r.billing_type || "—").replace(/^Per_/, "").replace(/_/g, " ")}
                </td>
                <td className="px-3 py-2 text-right text-secondary">
                  {r.hours_per_day ?? r.min_hours_full_day ?? "—"}
                </td>
                <td className="px-3 py-2 text-right text-secondary">
                  {r.billable_leaves_per_year ?? "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <button className={`${btnSecondary} !px-2 !py-1`} title="Edit policy"
                    onClick={() => setEditing(r)}>
                    <Pencil size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <EditCustomerPolicyModal row={editing} notify={notify}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function EditCustomerPolicyModal({
  row, notify, onClose, onSaved,
}: {
  row: PolicyMatrixRow;
  notify: Notify;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    holidays_billable: row.holidays_billable ?? false,
    week_off_billable: row.week_off_billable ?? false,
    leave_billable: row.leave_billable ?? false,
    comp_off_billable: row.comp_off_billable ?? false,
    billing_type: row.billing_type || "",
    hours_per_day: row.hours_per_day != null ? String(row.hours_per_day) : "",
    billable_leaves_per_year:
      row.billable_leaves_per_year != null ? String(row.billable_leaves_per_year) : "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      // Merge with the CURRENT stored policy: the PUT overwrites several
      // fields unconditionally, and this modal must never wipe values it
      // doesn't display (comp-off balances, min-hours, week-off pattern).
      const cur = (await crmGet<any>(`/api/customers/${row.customer_id}/billing-policy`))
        .data || {};
      await crmPut(`/api/customers/${row.customer_id}/billing-policy`, {
        min_hours_full_day: cur.min_hours_full_day ?? 8,
        min_hours_half_day: cur.min_hours_half_day ?? 4,
        comp_off_balance: cur.comp_off_balance ?? null,
        comp_off_balance_initial: cur.comp_off_balance_initial ?? null,
        comp_off_max_limit: cur.comp_off_max_limit ?? null,
        comp_off_max_carry_forward: cur.comp_off_max_carry_forward ?? null,
        user_role: cur.user_role ?? null,
        operation: cur.operation ?? null,
        holidays_billable: form.holidays_billable,
        week_off_billable: form.week_off_billable,
        leave_billable: form.leave_billable,
        comp_off_billable: form.comp_off_billable,
        billing_type: form.billing_type || null,
        normal_hours_per_day: form.hours_per_day === "" ? null : Number(form.hours_per_day),
        billable_leaves_per_year:
          form.billable_leaves_per_year === "" ? null : Number(form.billable_leaves_per_year),
      });
      notify(`Policy saved for ${row.customer_name}`);
      onSaved();
    } catch (e: any) {
      setError(e?.message || "Save failed");
      setBusy(false);
    }
  };

  const flag = (key: "holidays_billable" | "week_off_billable" | "leave_billable" | "comp_off_billable",
    label: string) => (
    <label className="flex items-center gap-2 text-sm text-secondary">
      <input type="checkbox" className="h-4 w-4 accent-brand-600"
        checked={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))} />
      {label}
    </label>
  );

  return (
    <Modal title={`Customer policy — ${row.customer_name}`} onClose={onClose}>
      {error && <div className="mb-3"><ErrorBox error={error} /></div>}
      <p className="mb-3 text-xs text-muted">
        These are the terms every new opportunity on {row.customer_name} inherits.
        Leave accruals (EL/SL/CL rates, carry-forward) are managed on the
        customer&rsquo;s Leave Policies; branch overrides win where set.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {flag("holidays_billable", "Holidays billable")}
        {flag("week_off_billable", "Week-offs billable")}
        {flag("leave_billable", "Leave billable")}
        {flag("comp_off_billable", "Comp-off billable")}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-muted">Billing</span>
          <select className={inputCls} value={form.billing_type}
            onChange={(e) => setForm((f) => ({ ...f, billing_type: e.target.value }))}>
            <option value="">—</option>
            <option value="Per_Hour">Hourly</option>
            <option value="Per_Day">Daily</option>
            <option value="Per_Month">Monthly</option>
            <option value="Per_Year">Yearly</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-muted">Hrs per day</span>
          <input type="number" min={0} max={24} step="0.5" className={inputCls}
            value={form.hours_per_day}
            onChange={(e) => setForm((f) => ({ ...f, hours_per_day: e.target.value }))} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-muted">Paid leaves / yr</span>
          <input type="number" min={0} max={366} step="0.5" className={inputCls}
            value={form.billable_leaves_per_year}
            placeholder="blank = none"
            onChange={(e) => setForm((f) => ({ ...f, billable_leaves_per_year: e.target.value }))} />
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save policy"}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ email drafts */
/* Moved to ./settings/EmailDraftsTab.tsx (3 Sep 2026) — candidate, internal
   and admin-created drafts in one editor. */
