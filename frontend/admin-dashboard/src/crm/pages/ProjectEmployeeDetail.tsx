/** Project Employee detail — ownership bridge for one (employee × project) mapping.
 * Tabs: General | Leave | Holidays | Timesheet | Invoice.
 * API: GET/PUT /api/projects/employees/{pe_id}, leave sub-resources. */
import React, { useCallback, useEffect, useState } from "react";
import { CalendarDays, CalendarOff, ExternalLink, Plus, RefreshCw, Save } from "lucide-react";
import { crmDelete, crmGet, crmPost, crmPut, qs } from "../api";
import { useHasRole } from "../CrmApp";
import { CrmLink, crmNavigate, useCrmParams } from "../routerHooks";
import { CrmBreadcrumb } from "../components/CrmBreadcrumb";
import { RateHistory } from "./ProjectEmployees";
import { DataTable, type Column } from "../components/DataTable";
import {
  EmptyState, ErrorBox, Field, KpiCard, Modal, PolicySourceChip, Spinner, StatusBadge, Tabs,
  btnPrimary, btnSecondary, focusRing, inputCls, useToast,
} from "../components/ui";
import { InfoChip, SectionHeaderBanner, WizardField } from "../components/wizard";
import { leaveTimingCaption } from "../components/PeriodTimingPicker";

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

const money = (v?: number | null) => (v == null ? "—" : `₹${Number(v).toLocaleString("en-IN")}`);
const dt = (v?: string | null) => (v ? new Date(v).toLocaleDateString("en-IN") : "—");
const daysFmt = (v?: number | null) => (v == null ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 }));

type LeaveEligibility = {
  yearly_days?: number | null;
  monthly_days?: number | null;
  credit_type?: string | null;
  credit_timing?: string | null;
  label?: string | null;
};

type LeaveDetail = {
  id: number;
  leave_type_id: number;
  leave_type_name?: string | null;
  customer_leave_policy_id?: number | null;
  initial_balance?: number | null;
  opening_balance?: number | null;
  leave_accrual?: number | null;
  leave_consumed?: number | null;
  leave_balance?: number | null;
  needs_settlement?: boolean;
  settlement_leave_balance?: number | null;
  eligibility?: LeaveEligibility | null;
  eligibility_label?: string | null;
  yearly_entitlement?: number | null;
  monthly_entitlement?: number | null;
  leave_credit_type?: string | null;
  leave_credit_timing?: string | null;
  leave_expire?: string | null;
  leave_expire_timing?: string | null;
  /** Which policy layer credits this row: "project" | "branch" | "customer". */
  policy_source?: string | null;
};

type LeaveEligibilityRow = {
  leave_type_id: number;
  leave_type_name?: string | null;
  label?: string | null;
  yearly_days?: number | null;
  monthly_days?: number | null;
  credit_type?: string | null;
  credit_timing?: string | null;
};

type LeaveSummary = {
  balance?: number | null;
  consumed?: number | null;
  accrued_this_year?: number | null;
  year?: number;
  loss_of_pay_consumed?: number | null;
};

type CreditHistoryRow = {
  id: number;
  event_type?: string;
  leave_type_name?: string | null;
  amount?: number | null;
  balance_after?: number | null;
  source?: string | null;
  note?: string | null;
  created_at?: string | null;
};

type LeaveAppRow = {
  id: number;
  leave_type_name?: string | null;
  leave_period_type?: string | null;
  from_date?: string | null;
  to_date?: string | null;
  days?: number | null;
  status?: string | null;
  reason?: string | null;
  applied_at?: string | null;
};

type TsRollup = {
  id?: number;
  timesheet_id: number;
  month: number;
  year: number;
  status?: string;
  working_days?: number;
  leave_days?: number;
  holiday_days?: number;
  billable_days?: number;
  billable_days_formula?: number;
  billable_formula?: string;
  billable_hours?: number;
};

type HolidayRow = {
  id: number;
  name: string;
  holiday_date?: string | null;
  holiday_type?: string;
  year?: number;
  scope?: string;
};

type HolidayCalendar = {
  year?: number;
  customer_id?: number | null;
  customer_name?: string | null;
  branch_id?: number | null;
  branch_name?: string | null;
  branch_linked?: boolean;
  label?: string | null;
  note?: string | null;
  read_only?: boolean;
  count?: number;
};

type PoSummary = {
  po_id?: number | null;
  po_number?: string | null;
  allocated_amount?: number | null;
  consumed_amount?: number | null;
  utilization_pct?: number | null;
  po_status?: string | null;
  expired?: boolean;
  end_date?: string | null;
  balance_value?: number | null;
};

type PeDetail = {
  id: number;
  project_id: number;
  employee_id: number;
  project_name?: string | null;
  customer_id?: number | null;
  customer_name?: string | null;
  branch_id?: number | null;
  branch_name?: string | null;
  employee_name?: string | null;
  employee_email?: string | null;
  onboarding_date?: string | null;
  experience_years?: number | null;
  project_experience_years?: number | null;
  work_mode?: string | null;
  billing_rate?: number | null;
  billing_unit?: string | null;
  rates?: import("./ProjectEmployees").RateRowOut[];
  is_active?: boolean;
  is_exit?: boolean;
  exit_date?: string | null;
  billing_date?: string | null;
  leave_balance_total?: number | null;
  leave_details?: LeaveDetail[];
  leave_eligibility?: LeaveEligibilityRow[];
  leave_summary?: LeaveSummary | null;
  credit_history?: CreditHistoryRow[];
  leave_applications?: LeaveAppRow[];
  timesheet_rollups?: TsRollup[];
  holidays?: HolidayRow[];
  holiday_calendar?: HolidayCalendar | null;
  po?: PoSummary;
  po_status?: string | null;
};

const PE_TABS = [
  { key: "general", label: "General" },
  { key: "leave", label: "Leave" },
  { key: "holidays", label: "Holidays" },
  { key: "timesheets", label: "Timesheet" },
  { key: "invoice", label: "Invoice" },
];

function InfoItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-sm text-primary">{children}</div>
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-sm font-bold text-primary">{title}</h2>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function PoDrawdownBar({ po }: { po?: PoSummary | null }) {
  if (!po || po.po_id == null) {
    return (
      <div className="rounded-card border border-subtle bg-surface-1 p-3 text-sm text-muted">
        No purchase order allocated to this project yet.
      </div>
    );
  }
  const pct = Math.min(100, Math.max(0, Number(po.utilization_pct || 0)));
  const blocked = po.po_status === "blocked" || po.expired;
  const warn = po.po_status === "warn_80";
  const bar =
    blocked ? "bg-danger" : warn ? "bg-warning" : "bg-success";
  return (
    <div className="space-y-2 rounded-card border border-subtle bg-surface-1 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="font-semibold text-primary">
          PO {po.po_number || `#${po.po_id}`}
          {blocked && <span className="ml-2 text-danger">(blocked — invoices only)</span>}
          {warn && !blocked && <span className="ml-2 text-warning">(≥80% used)</span>}
        </div>
        <div className="text-secondary">
          {money(po.consumed_amount)} / {money(po.allocated_amount)}
          {po.utilization_pct != null ? ` · ${po.utilization_pct.toFixed(0)}%` : ""}
        </div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full ${bar} transition-all duration-panel ease-smooth`} style={{ width: `${pct}%` }} />
      </div>
      {po.end_date && (
        <div className="text-xs text-muted">Ends {dt(po.end_date)}{po.expired ? " · expired" : ""}</div>
      )}
      <p className="text-xs text-muted">
        Timesheet entry is never blocked by PO status. Invoice create/generate is blocked at 100% or after expiry.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- apply leave (PE-scoped) */
function PeApplyLeaveModal({
  pe, onClose, onDone,
}: {
  pe: PeDetail; onClose: () => void; onDone: (m?: string) => void;
}) {
  const [leaveTypes, setLeaveTypes] = useState<{ id: number; name: string }[]>([]);
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [periodType, setPeriodType] = useState("Full_Day");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState("");
  const multiDay = periodType === "Multi_Day";

  useEffect(() => {
    const seeded = (pe.leave_details || []).map((d) => ({
      id: d.leave_type_id,
      name: d.leave_type_name || `Type #${d.leave_type_id}`,
    }));
    if (seeded.length) {
      setLeaveTypes(seeded);
      return;
    }
    crmGet<any[]>("/api/leave-policy-types?limit=100")
      .then((r) => setLeaveTypes((r.data || []).map((t) => ({ id: t.id, name: t.name }))))
      .catch(() => {});
  }, [pe.leave_details]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaveTypeId || !fromDate) {
      setApiError("Leave type and from date are required");
      return;
    }
    setBusy(true); setApiError("");
    try {
      const res = await crmPost("/api/leave-applications", {
        employee_id: pe.employee_id,
        project_id: pe.project_id,
        project_employee_id: pe.id,
        leave_type_id: Number(leaveTypeId),
        leave_period_type: periodType,
        from_date: fromDate,
        to_date: multiDay && toDate ? toDate : fromDate,
        reason: reason.trim() || null,
      });
      onDone((res as any).message);
    } catch (err: any) {
      setApiError(err?.message || "Failed to apply leave");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={<span className="sr-only">Apply leave (this project mapping)</span>}
      onClose={onClose}
      wide
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title="Apply leave"
        subtitle="Log a leave application against this project mapping."
        icon={<CalendarOff size={20} aria-hidden />}
      >
        <form onSubmit={submit}>
          {apiError && <div className="mb-4"><ErrorBox error={apiError} /></div>}
          <InfoChip>
            Consumes leave balance on this Project Employee ({pe.employee_name} @ {pe.project_name}).
          </InfoChip>
          <div className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <WizardField label="Leave type" required icon="hash">
              <select className={inputCls} value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
                <option value="">Select…</option>
                {leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </WizardField>
            <WizardField label="Period" icon="hash">
              <select className={inputCls} value={periodType} onChange={(e) => setPeriodType(e.target.value)}>
                {["Full_Day", "Half_Day", "Multi_Day"].map((p) => (
                  <option key={p} value={p}>{p.replace(/_/g, " ")}</option>
                ))}
              </select>
            </WizardField>
            <WizardField label="From" required icon="calendar" filled={!!fromDate}>
              <input type="date" className={inputCls} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </WizardField>
            {multiDay && (
              <WizardField label="To" required icon="calendar" filled={!!toDate}>
                <input type="date" className={inputCls} value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </WizardField>
            )}
          </div>
          <div className="mt-5">
            <WizardField label="Reason">
              <textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </WizardField>
          </div>
          <div className={wizFooterRow}>
            <button type="button" className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className={`${btnPrimary} btn-gradient ml-auto h-10 rounded-xl px-4`} disabled={busy}>{busy ? "Submitting…" : "Submit"}</button>
          </div>
        </form>
      </WizFormShell>
    </Modal>
  );
}

/* ---------------------------------------------------------------- detail page */
type InvoicePeriod = {
  timesheet_id: number;
  month: number;
  year: number;
  status?: string | null;
  billable_days?: number | null;
  rate_per_unit?: number | null;
  monthly_cost?: number | null;
  rate_split?: boolean;
  amount?: number | null;
  linked_invoice?: { id: number; invoice_number: string; payment_status?: string | null } | null;
  can_generate?: boolean;
};

type InvoiceRollup = {
  po?: PoSummary | null;
  periods: InvoicePeriod[];
  billing_unit?: string | null;
  current_rate?: number | null;
  read_only?: boolean;
};

function InvoiceTab({ peId, projectId }: { peId: number; projectId?: number | null }) {
  const [data, setData] = useState<InvoiceRollup | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    crmGet<InvoiceRollup>(`/api/projects/employees/${peId}/invoices`)
      .then((r) => { if (alive) setData(r.data); })
      .catch((e) => { if (alive) setErr(String(e?.message || e)); });
    return () => { alive = false; };
  }, [peId]);

  const cols: Column<InvoicePeriod>[] = [
    {
      key: "period", label: "Period",
      render: (r) => (
        <button
          type="button"
          className={`font-semibold text-brand-600 hover:underline dark:text-brand-300 ${focusRing}`}
          onClick={() => crmNavigate(`timesheets/${r.timesheet_id}`)}
        >
          {r.month}/{r.year}
        </button>
      ),
    },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status || "—"} /> },
    { key: "billable_days", label: "Billable days", render: (r) => r.billable_days ?? "—" },
    {
      key: "rate", label: "Rate",
      render: (r) => `${money(r.monthly_cost ?? r.rate_per_unit)}${r.rate_split ? " (split)" : ""}`,
    },
    { key: "amount", label: "Amount", render: (r) => <span className="font-semibold text-primary">{money(r.amount)}</span> },
    {
      key: "invoice", label: "Invoice",
      render: (r) => r.linked_invoice
        ? (
          <button
            type="button"
            className={`text-brand-600 hover:underline dark:text-brand-300 ${focusRing}`}
            onClick={() => crmNavigate(`invoices/${r.linked_invoice!.id}`)}
          >
            {r.linked_invoice!.invoice_number}
          </button>
        )
        : (r.can_generate
          ? <span className="text-xs font-semibold text-success">ready to generate</span>
          : <span className="text-muted">—</span>),
    },
  ];

  if (err) return <ErrorBox error={err} />;
  if (!data) return <div className="rounded-card border border-subtle bg-surface-1 p-6"><Spinner /></div>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Read-only invoice preview — billable days × rate (effective / split), per timesheet period.
          Generation &amp; payment are handled in the Invoices module.
        </p>
        <button
          type="button"
          className={btnSecondary}
          onClick={() => crmNavigate(`invoices${qs({ project_id: projectId })}`)}
        >
          Open invoices
        </button>
      </div>
      {data.po && data.po.po_number && <PoDrawdownBar po={data.po} />}
      <DataTable
        columns={cols}
        rows={(data.periods || []).map((r) => ({ ...r, id: r.timesheet_id }))}
        loading={false}
        emptyMessage="No timesheet periods to invoice yet"
      />
    </div>
  );
}

/* ------------------------------------------- commercial details (editable) */

type RateDraftRow = { id?: number; effective_from: string; rate: string };

/** The Commercial Details section, now an editor rather than a plaque.
 *
 * Each stored rate can be corrected (date or amount), deleted, or joined by a
 * new row — hitting the same /rates endpoints the PO panel's Edit/Add Rate
 * use, so there is exactly one rate history everywhere. Validity ranges stay
 * DERIVED; editing a date re-flows the neighbours automatically, which is
 * also how a broken history (two rates sharing a start date) gets fixed:
 * change or delete one of the twins.
 */
function RateHistorySection({ pe, reload, notify }: {
  pe: { id: number; rates?: import("./ProjectEmployees").RateRowOut[]; billing_unit?: string | null };
  reload: () => void;
  notify: (m: string, k?: "ok" | "err") => void;
}) {
  const canEditRates = useHasRole("Sales_Head", "Finance", "HR", "RMG");
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<RateDraftRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const stored = (pe.rates || []).filter((r) => r.effective_from);

  const startEditing = () => {
    setDrafts([...stored]
      .sort((a, b) => String(a.effective_from).localeCompare(String(b.effective_from)))
      .map((r) => ({
        id: r.id, effective_from: r.effective_from!.slice(0, 10),
        rate: r.rate != null ? String(r.rate) : "",
      })));
    setError("");
    setEditing(true);
  };

  /* Live duplicate detection. Legacy data (from the old bug that stacked a
     new rate on the same date at every save) can arrive in this editor
     ALREADY containing twins — so the collision is flagged the moment the
     editor opens, on the exact rows, not as a mystery refusal at save time. */
  const dupDates = React.useMemo(() => {
    const seen = new Map<string, number>();
    drafts.forEach((d) => {
      if (d.effective_from) seen.set(d.effective_from, (seen.get(d.effective_from) || 0) + 1);
    });
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([d]) => d));
  }, [drafts]);
  const dupMessage = dupDates.size
    ? `Two rates start on ${[...dupDates].map((d) =>
        new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
      ).join(", ")} — change the date on one of the highlighted rows, or delete the wrong one, then save.`
    : "";

  const setDraft = (i: number, key: "effective_from" | "rate", value: string) =>
    setDrafts((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));

  const removeRow = async (i: number) => {
    const row = drafts[i];
    if (row.id == null) {
      setDrafts((rows) => rows.filter((_, idx) => idx !== i));
      return;
    }
    if (drafts.filter((d) => d.id != null).length <= 1) {
      setError("Keep at least one rate — billing needs a rate in force");
      return;
    }
    setBusy(true);
    try {
      await crmDelete(`/api/projects/employees/${pe.id}/rates/${row.id}`);
      setDrafts((rows) => rows.filter((_, idx) => idx !== i));
      notify("Rate deleted");
      reload();
    } catch (e: any) {
      notify(e?.message || "Failed to delete rate", "err");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const complete = drafts.filter((d) => d.effective_from && d.rate && Number(d.rate) > 0);
    if (complete.length !== drafts.length) {
      setError("Every row needs an Effective From date and a rate above zero");
      return;
    }
    if (dupDates.size) {
      setError(dupMessage);
      return;
    }
    setError("");
    setBusy(true);
    const today = new Date().toISOString().slice(0, 10);
    try {
      for (const d of drafts) {
        const orig = stored.find((r) => r.id === d.id);
        if (d.id == null) {
          await crmPost(`/api/projects/employees/${pe.id}/rates`, {
            effective_from: d.effective_from, rate: Number(d.rate),
            is_current_rate: d.effective_from <= today,
          });
        } else if (orig && (orig.effective_from!.slice(0, 10) !== d.effective_from
                            || String(orig.rate ?? "") !== d.rate)) {
          await crmPut(`/api/projects/employees/${pe.id}/rates/${d.id}`, {
            effective_from: d.effective_from, rate: Number(d.rate),
          });
        }
      }
      notify("Commercial Details saved");
      setEditing(false);
      reload();
    } catch (e: any) {
      notify(e?.message || "Failed to save rates", "err");
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    if (!stored.length && !canEditRates) return null;
    return (
      <div className="rounded-card border border-subtle bg-surface-2/50 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs font-bold uppercase tracking-wide text-muted">
            Commercial Details — rate history
          </div>
          {canEditRates && (
            <button type="button" className={`${btnSecondary} !px-2 !py-1 text-xs`} onClick={startEditing}>
              Edit rates
            </button>
          )}
        </div>
        {stored.length
          ? <RateHistory rates={pe.rates} unit={pe.billing_unit} />
          : <span className="text-sm text-muted">No rates yet — click Edit rates to add the first one.</span>}
        <p className="mt-2 text-[11px] text-muted">
          Each rate runs until the day before the next begins; the latest runs onwards.
          Timesheet invoices pick the rate in force for their month automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-subtle bg-surface-2/50 p-3">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
        Commercial Details — edit rates
      </div>
      <div className="space-y-2">
        {drafts.map((d, i) => (
          <div key={d.id ?? `new-${i}`} className="flex flex-wrap items-end gap-2">
            <Field label="Effective from">
              <input type="date"
                className={`${inputCls} ${d.effective_from && dupDates.has(d.effective_from)
                  ? "!border-danger ring-2 ring-danger/50" : ""}`}
                value={d.effective_from}
                aria-invalid={!!d.effective_from && dupDates.has(d.effective_from)}
                onChange={(e) => setDraft(i, "effective_from", e.target.value)} />
            </Field>
            <Field label={`Rate${pe.billing_unit ? ` (${pe.billing_unit})` : ""}`}>
              <input type="number" min={0} step="0.01" className={inputCls} value={d.rate}
                placeholder="0.00" onChange={(e) => setDraft(i, "rate", e.target.value)} />
            </Field>
            <button type="button"
              className={`${btnSecondary} !px-2 !py-1.5 text-xs hover:!text-rose-600`}
              disabled={busy} onClick={() => removeRow(i)}>
              Delete
            </button>
            {d.id == null && <span className="pb-2 text-[11px] font-semibold text-sky-600">new</span>}
          </div>
        ))}
      </div>
      <button type="button"
        className={`mt-2 text-sm font-semibold text-sky-600 hover:underline dark:text-sky-400 ${focusRing} rounded-control`}
        onClick={() => setDrafts((rows) => [...rows, { effective_from: "", rate: "" }])}>
        + Add New
      </button>
      {(error || dupMessage) && (
        <div className="mt-2 text-xs font-semibold text-danger" role="alert">{error || dupMessage}</div>
      )}
      <div className="mt-3 flex justify-end gap-2 border-t border-subtle pt-3">
        <button type="button" className={btnSecondary} disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
        <button type="button" className={btnPrimary} disabled={busy || dupDates.size > 0}
          title={dupDates.size ? "Fix the highlighted duplicate dates first" : undefined}
          onClick={save}>
          {busy ? "Saving…" : "Save rates"}
        </button>
      </div>
    </div>
  );
}

export function ProjectEmployeeDetailPage() {
  const { id } = useCrmParams();
  const canWrite = useHasRole("Sales_Head", "HR");
  const canSyncLeave = useHasRole("HR", "Admin");
  const [toast, notify] = useToast();
  const [pe, setPe] = useState<PeDetail | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("general");
  const [saving, setSaving] = useState(false);
  const [syncingLeave, setSyncingLeave] = useState(false);
  const [applying, setApplying] = useState(false);

  const [onboarding, setOnboarding] = useState("");
  const [experience, setExperience] = useState("");
  const [projectExperience, setProjectExperience] = useState("");
  const [workMode, setWorkMode] = useState("");
  const [billingDate, setBillingDate] = useState("");
  const [isExit, setIsExit] = useState(false);
  const [exitDate, setExitDate] = useState("");
  const [isActive, setIsActive] = useState(true);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await crmGet<PeDetail>(`/api/projects/employees/${id}`);
      const d = res.data!;
      setPe(d);
      setOnboarding(d.onboarding_date?.slice(0, 10) || "");
      setExperience(d.experience_years != null ? String(d.experience_years) : "");
      setProjectExperience(d.project_experience_years != null ? String(d.project_experience_years) : "");
      setWorkMode(d.work_mode || "");
      setBillingDate(d.billing_date?.slice(0, 10) || "");
      setIsExit(!!d.is_exit);
      setExitDate(d.exit_date?.slice(0, 10) || "");
      setIsActive(d.is_active !== false);
    } catch (e: any) {
      setError(e?.message || "Failed to load project employee");
      setPe(null);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const saveGeneral = async () => {
    if (!pe) return;
    setSaving(true);
    try {
      await crmPut(`/api/projects/employees/${pe.id}`, {
        onboarding_date: onboarding || null,
        experience_years: experience ? Number(experience) : null,
        project_experience_years: projectExperience ? Number(projectExperience) : null,
        work_mode: workMode || null,
        billing_date: billingDate || null,
        is_exit: isExit,
        exit_date: isExit ? (exitDate || null) : null,
        is_active: isActive,
      });
      notify("General details saved");
      await load();
    } catch (e: any) {
      notify(e?.message || "Save failed", "err");
    } finally {
      setSaving(false);
    }
  };

  const saveLeave = async (row: LeaveDetail, patch: Partial<LeaveDetail>) => {
    if (!pe) return;
    try {
      await crmPut(`/api/projects/employees/${pe.id}/leave/${row.id}`, patch);
      notify("Leave detail updated");
      await load();
    } catch (e: any) {
      notify(e?.message || "Update failed", "err");
    }
  };

  const syncLeavePolicies = async () => {
    if (!pe || syncingLeave) return;
    setSyncingLeave(true);
    try {
      const res = await crmPost<{
        added_count?: number;
        added?: { leave_type_name?: string | null }[];
      }>(`/api/projects/employees/${pe.id}/leave/sync`, {});
      const added = res.data?.added || [];
      const names = added.map((a) => a.leave_type_name).filter(Boolean);
      notify(
        names.length
          ? `Synced — added ${names.join(", ")}`
          : (res.message || "Leave policies already in sync"),
      );
      await load();
    } catch (e: any) {
      notify(e?.message || "Sync failed", "err");
    } finally {
      setSyncingLeave(false);
    }
  };

  if (error && !pe) return <ErrorBox error={error} onRetry={load} />;
  if (!pe) return <Spinner label="Loading project employee…" />;

  const leaveCols: Column<LeaveDetail>[] = [
    {
      key: "leave_type_name",
      label: "Leave type",
      render: (r) => {
        const caption = leaveTimingCaption(r);
        return (
          <div className="flex flex-col gap-0.5">
            <span>{r.leave_type_name || `Type #${r.leave_type_id}`}</span>
            {caption && (
              <span className="text-[11px] text-muted">{caption}</span>
            )}
            <PolicySourceChip source={r.policy_source} />
          </div>
        );
      },
    },
    {
      key: "eligibility_label", label: "Eligible",
      render: (r) => (
        <span className="text-sm text-secondary" title={r.eligibility_label || undefined}>
          {r.eligibility_label || "—"}
        </span>
      ),
    },
    { key: "initial_balance", label: "Initial", render: (r) => daysFmt(r.initial_balance) },
    { key: "leave_accrual", label: "Period accrual", render: (r) => daysFmt(r.leave_accrual) },
    { key: "leave_consumed", label: "Consumed", render: (r) => daysFmt(r.leave_consumed) },
    {
      key: "leave_balance", label: "Balance",
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          {canWrite && !pe.is_exit ? (
            <input
              className={`${inputCls} w-20`}
              type="number"
              step="0.5"
              defaultValue={r.leave_balance ?? 0}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v !== r.leave_balance) {
                  saveLeave(r, { leave_balance: v });
                }
              }}
            />
          ) : daysFmt(r.leave_balance)}
          {r.needs_settlement && (
            <span className="text-xs font-semibold text-warning">Settlement</span>
          )}
        </div>
      ),
    },
  ];

  const creditCols: Column<CreditHistoryRow>[] = [
    { key: "created_at", label: "When", render: (r) => dt(r.created_at) },
    { key: "event_type", label: "Event", render: (r) => r.event_type || "—" },
    { key: "leave_type_name", label: "Type", render: (r) => r.leave_type_name || "—" },
    {
      key: "amount", label: "Amount",
      render: (r) => {
        const n = Number(r.amount ?? 0);
        const cls = n > 0 ? "text-success" : n < 0 ? "text-danger" : "text-secondary";
        return <span className={`font-semibold ${cls}`}>{n > 0 ? "+" : ""}{daysFmt(r.amount)}</span>;
      },
    },
    { key: "balance_after", label: "Balance after", render: (r) => daysFmt(r.balance_after) },
    {
      key: "note", label: "Note",
      render: (r) => <span className="text-xs text-muted">{r.note || r.source || "—"}</span>,
    },
  ];
  const appCols: Column<LeaveAppRow>[] = [
    { key: "id", label: "ID", render: (r) => <span className="font-semibold text-secondary">#{r.id}</span> },
    { key: "leave_type_name", label: "Type", render: (r) => r.leave_type_name || "—" },
    {
      key: "from_date", label: "Dates",
      render: (r) => r.from_date === r.to_date ? dt(r.from_date) : `${dt(r.from_date)} → ${dt(r.to_date)}`,
    },
    { key: "days", label: "Days", render: (r) => daysFmt(r.days) },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status || "—"} /> },
    { key: "applied_at", label: "Applied", render: (r) => dt(r.applied_at) },
  ];

  const tsCols: Column<TsRollup>[] = [
    {
      key: "period", label: "Period",
      render: (r) => (
        <button
          type="button"
          className={`font-semibold text-brand-600 hover:underline dark:text-brand-300 ${focusRing}`}
          onClick={() => crmNavigate(`timesheets/${r.timesheet_id}`)}
        >
          {r.month}/{r.year}
        </button>
      ),
    },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status || "—"} /> },
    { key: "working_days", label: "Working", render: (r) => r.working_days ?? "—" },
    { key: "leave_days", label: "Leave", render: (r) => r.leave_days ?? "—" },
    { key: "holiday_days", label: "Holidays", render: (r) => r.holiday_days ?? "—" },
    {
      key: "billable_days_formula", label: "Formula (W−L−H)",
      render: (r) => r.billable_days_formula ?? "—",
    },
    { key: "billable_days", label: "Billable days", render: (r) => r.billable_days ?? "—" },
    { key: "billable_hours", label: "Billable hrs", render: (r) => r.billable_hours ?? "—" },
  ];

  const holidayCols: Column<HolidayRow>[] = [
    { key: "holiday_date", label: "Date", render: (r) => dt(r.holiday_date) },
    { key: "name", label: "Name", render: (r) => r.name },
    { key: "holiday_type", label: "Type", render: (r) => r.holiday_type || "—" },
    { key: "scope", label: "Scope", render: (r) => r.scope || "—" },
  ];

  const summary = pe.leave_summary || {};
  const eligibility = pe.leave_eligibility || [];
  const calendar = pe.holiday_calendar;
  const empLabel = pe.employee_name || `Employee #${pe.employee_id}`;
  const crumbs = [
    { label: "Customers", to: "customers" },
    ...(pe.customer_id != null
      ? [{ label: pe.customer_name || `Customer #${pe.customer_id}`, to: `customers/${pe.customer_id}` }]
      : []),
    ...(pe.branch_id != null
      ? [{ label: pe.branch_name || `Branch #${pe.branch_id}`, to: `branch-policy/${pe.branch_id}` }]
      : []),
    { label: pe.project_name || `Project #${pe.project_id}`, to: `projects/${pe.project_id}` },
    { label: empLabel },
  ];
  return (
    <div className="space-y-4">
      {toast}
      <CrmBreadcrumb items={crumbs} />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-display text-lg font-bold text-primary">
          {empLabel} — {pe.project_name || `Project #${pe.project_id}`}
        </h1>
        <StatusBadge status={pe.is_exit ? "Exited" : pe.is_active ? "Active" : "Inactive"} />
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <CrmLink to={`employees/${pe.employee_id}`} className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-300">
          Employee <ExternalLink size={12} />
        </CrmLink>
        <CrmLink to={`projects/${pe.project_id}`} className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-300">
          Project <ExternalLink size={12} />
        </CrmLink>
        {pe.customer_id != null && (
          <CrmLink to={`customers/${pe.customer_id}`} className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-300">
            {pe.customer_name || "Customer"} <ExternalLink size={12} />
          </CrmLink>
        )}
        {pe.branch_id != null && (
          <CrmLink to={`branch-policy/${pe.branch_id}`} className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-300">
            {pe.branch_name || "Branch"} <ExternalLink size={12} />
          </CrmLink>
        )}
      </div>

      <Tabs tabs={PE_TABS} active={tab} onChange={setTab} />

      {tab === "general" && (
        <div className="space-y-4 rounded-card border border-subtle bg-surface-1 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            <InfoItem label="Employee">{pe.employee_name || "—"}</InfoItem>
            <InfoItem label="Email">{pe.employee_email || "—"}</InfoItem>
            <InfoItem label="Project">{pe.project_name || "—"}</InfoItem>
            <InfoItem label="Customer">{pe.customer_name || "—"}</InfoItem>
            <InfoItem label="Current rate">{money(pe.billing_rate)} / {pe.billing_unit || "—"}</InfoItem>
            <InfoItem label="Leave balance total">{pe.leave_balance_total ?? "—"}</InfoItem>
          </div>
          <RateHistorySection pe={pe} reload={load} notify={notify} />
          {canWrite ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                <Field label="Onboarding date">
                  <input type="date" className={inputCls} value={onboarding} onChange={(e) => setOnboarding(e.target.value)} />
                </Field>
                <Field label="Experience (years)">
                  <input type="number" step="0.1" min={0} className={inputCls} value={experience} onChange={(e) => setExperience(e.target.value)} />
                </Field>
                <Field label="Project experience (years)">
                  <input type="number" step="0.1" min={0} className={inputCls} value={projectExperience} onChange={(e) => setProjectExperience(e.target.value)} />
                </Field>
                <Field label="Work mode">
                  <select className={inputCls} value={workMode} onChange={(e) => setWorkMode(e.target.value)}>
                    <option value="">—</option>
                    {["Onsite", "Remote", "Hybrid"].map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                </Field>
                <Field label="Billing date">
                  <input type="date" className={inputCls} value={billingDate} onChange={(e) => setBillingDate(e.target.value)} />
                </Field>
                <Field label="Active">
                  <select className={inputCls} value={isActive ? "1" : "0"} onChange={(e) => setIsActive(e.target.value === "1")}>
                    <option value="1">Yes</option>
                    <option value="0">No</option>
                  </select>
                </Field>
                <Field label="Is exit">
                  <select className={inputCls} value={isExit ? "1" : "0"} onChange={(e) => setIsExit(e.target.value === "1")}>
                    <option value="0">No</option>
                    <option value="1">Yes</option>
                  </select>
                </Field>
                {isExit && (
                  <Field label="Exit date">
                    <input type="date" className={inputCls} value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
                  </Field>
                )}
              </div>
              <div className="flex justify-end">
                <button type="button" className={btnPrimary} onClick={saveGeneral} disabled={saving}>
                  <Save size={14} /> {saving ? "Saving…" : "Save general"}
                </button>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              <InfoItem label="Onboarding">{dt(pe.onboarding_date)}</InfoItem>
              <InfoItem label="Experience">{pe.experience_years ?? "—"} yr</InfoItem>
              <InfoItem label="Project experience">{pe.project_experience_years ?? "—"} yr</InfoItem>
              <InfoItem label="Work mode">{pe.work_mode || "—"}</InfoItem>
              <InfoItem label="Billing date">{dt(pe.billing_date)}</InfoItem>
              <InfoItem label="Exit">{pe.is_exit ? dt(pe.exit_date) : "—"}</InfoItem>
            </div>
          )}
        </div>
      )}

      {tab === "leave" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">
              Leave for this Project Employee only — balances copied from the customer leave policy at map time.
            </p>
            <div className="flex flex-wrap gap-2">
              {canSyncLeave && (
                <button
                  type="button"
                  className={btnSecondary}
                  disabled={syncingLeave}
                  onClick={syncLeavePolicies}
                  title="Add leave types from the customer/branch policy that are missing on this PE"
                >
                  <RefreshCw size={14} className={syncingLeave ? "animate-spin" : undefined} />
                  {syncingLeave ? "Syncing…" : "Sync from customer policy"}
                </button>
              )}
              <button type="button" className={btnSecondary} onClick={() => crmNavigate("leave-applications")}>
                <CalendarDays size={14} /> All applications
              </button>
              {!pe.is_exit && (
                <button type="button" className={btnPrimary} onClick={() => setApplying(true)}>
                  <Plus size={14} /> Apply leave
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Balance"
              value={Number(summary.balance ?? pe.leave_balance_total ?? 0)}
              sub="Days remaining on this mapping"
              accent="from-brand-400 to-brand-600"
            />
            <KpiCard
              label="Consumed"
              value={Number(summary.consumed ?? 0)}
              sub="Approved leave drawn from this PE"
              accent="from-warning/80 to-warning"
            />
            <KpiCard
              label="Accrued this year"
              value={Number(summary.accrued_this_year ?? 0)}
              sub={`${summary.year || new Date().getFullYear()} credits (seed + monthly + comp-off)`}
              accent="from-success/80 to-success"
            />
            <KpiCard
              label="Loss of Pay"
              value={Number(summary.loss_of_pay_consumed ?? 0)}
              sub="Unpaid leave consumed (over-balance / explicit LOP)"
              accent="from-danger/80 to-danger"
            />
          </div>

          <div className="space-y-2 rounded-card border border-subtle bg-surface-1 p-4">
            <SectionTitle title="Eligibility" hint="From seeded Customer Leave Policy (not live-ref)" />
            {eligibility.length === 0 ? (
              <EmptyState message="No leave policy seeded for this mapping yet. Map happens when the project customer has active leave policies." />
            ) : (
              <ul className="divide-y divide-subtle">
                {eligibility.map((e) => (
                  <li key={e.leave_type_id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                    <div>
                      <div className="text-sm font-semibold text-primary">{e.leave_type_name || `Type #${e.leave_type_id}`}</div>
                      <div className="text-sm text-secondary">{e.label || "—"}</div>
                    </div>
                    <div className="text-xs text-muted">
                      {e.yearly_days != null && <span>{daysFmt(e.yearly_days)} / year</span>}
                      {e.monthly_days != null && <span className="ml-2">{daysFmt(e.monthly_days)} / month</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <SectionTitle title="Balances by leave type" />
            <DataTable
              columns={leaveCols}
              rows={pe.leave_details || []}
              loading={false}
              emptyMessage="No leave details — seed happens when Customer Leave Policy exists for this customer"
            />
          </div>

          <div className="space-y-2">
            <SectionTitle title="Credit history" hint="PE-scoped ledger (seed · monthly credit · approvals)" />
            {(pe.credit_history || []).length === 0 ? (
              <div className="rounded-card border border-subtle bg-surface-1">
                <EmptyState message="No credit events yet for this Project Employee. Seed and monthly credits appear here when they run." />
              </div>
            ) : (
              <DataTable
                columns={creditCols}
                rows={pe.credit_history || []}
                loading={false}
                emptyMessage="No credit history"
              />
            )}
          </div>

          <div className="space-y-2">
            <SectionTitle title="Leave applications" hint="Filed against this PE record" />
            {(pe.leave_applications || []).length === 0 ? (
              <div className="rounded-card border border-subtle bg-surface-1">
                <EmptyState
                  message="No leave applications on this mapping yet."
                  actionLabel={pe.is_exit ? undefined : "Apply leave"}
                  onAction={pe.is_exit ? undefined : () => setApplying(true)}
                />
              </div>
            ) : (
              <DataTable
                columns={appCols}
                rows={pe.leave_applications || []}
                loading={false}
                emptyMessage="No applications"
              />
            )}
          </div>
        </div>
      )}

      {tab === "holidays" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-card border border-subtle bg-surface-1 p-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">Client calendar</div>
              <div className="mt-0.5 text-sm font-semibold text-primary">
                {calendar?.label || `${pe.customer_name || "Customer"} / ${new Date().getFullYear()}`}
              </div>
              <p className="mt-1 text-xs text-muted">
                Read-only holiday calendar for this PE’s project
                {calendar?.branch_name ? ` · ${calendar.branch_name}` : ""}
                {calendar?.count != null ? ` · ${calendar.count} day(s)` : ""}.
                Edit via Holidays master.
              </p>
              {calendar?.note && (
                <p className="mt-2 text-xs font-semibold text-warning" role="status">
                  {calendar.note}
                </p>
              )}
            </div>
            <span className="rounded-control border border-subtle bg-surface-2 px-2 py-1 text-xs font-semibold text-muted">
              Read-only
            </span>
          </div>
          {(pe.holidays || []).length === 0 ? (
            <div className="rounded-card border border-subtle bg-surface-1">
              <EmptyState message="No holidays for this customer calendar this year." />
            </div>
          ) : (
            <DataTable
              columns={holidayCols}
              rows={(pe.holidays || []).map((h) => ({ ...h, id: h.id }))}
              loading={false}
              emptyMessage="No holidays for this customer this year"
            />
          )}
        </div>
      )}

      {tab === "timesheets" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">
              Billable formula: <span className="font-semibold text-secondary">working − leave − holidays</span>
              {" "}(policy billable flags applied when entries are computed). Rollups are read-only aggregates.
            </p>
            <button
              type="button"
              className={btnSecondary}
              onClick={() => crmNavigate(`timesheets${qs({ project_id: pe.project_id, employee_id: pe.employee_id })}`)}
            >
              Open timesheets
            </button>
          </div>
          <DataTable
            columns={tsCols}
            rows={(pe.timesheet_rollups || []).map((r) => ({ ...r, id: r.timesheet_id }))}
            loading={false}
            emptyMessage="No timesheets for this mapping yet"
          />
        </div>
      )}

      {tab === "invoice" && (
        <InvoiceTab peId={pe.id} projectId={pe.project_id} />
      )}

      {applying && (
        <PeApplyLeaveModal
          pe={pe}
          onClose={() => setApplying(false)}
          onDone={(m) => { setApplying(false); notify(m || "Leave submitted"); load(); }}
        />
      )}
    </div>
  );
}
