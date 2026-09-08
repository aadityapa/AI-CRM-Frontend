/** Project Employees — the bridge tab. One row per (employee × project) mapping,
 * each carrying its own rate / leave / timesheet. Backed by
 * GET /api/projects/all-employees. Map new via POST /api/projects/{id}/employees.
 * Group-by-employee collapses to one expandable card per person (UC-12). */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Eye, Network, UserPlus, X } from "lucide-react";
import { crmGet, crmPost, crmPut } from "../api";
import type { Meta } from "../api";
import { useHasRole } from "../CrmApp";
import { useCanAct } from "../useAccess";
import { crmNavigate } from "../routerHooks";
import { DataTable } from "../components/DataTable";
import type { Column } from "../components/DataTable";
import { RowActions, afterListDelete } from "../components/RowActions";
import {
  ErrorBox, Field, Modal, StatusBadge, btnPrimary, btnSecondary, focusRing, inputCls, useToast,
} from "../components/ui";
import { TeachingEmpty } from "../components/TeachingEmpty";
import { InfoChip, SectionHeaderBanner, WizardField } from "../components/wizard";
import { SearchableSelect } from "../components/SearchableSelect";

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

type PeRow = {
  id: number;
  project_id: number;
  project_name?: string | null;
  customer_id?: number | null;
  customer_name?: string | null;
  employee_id: number;
  employee_name?: string | null;
  employee_email?: string | null;
  onboarding_date?: string | null;
  experience_years?: number | null;
  work_mode?: string | null;
  billing_rate?: number | null;
  billing_unit?: string | null;
  rates?: RateRowOut[];
  is_active?: boolean;
  is_exit?: boolean;
  exit_date?: string | null;
  billing_date?: string | null;
  leave_balance_total?: number | null;
  po_status?: "ok" | "warn_80" | "blocked" | string | null;
  po_utilization_pct?: number | null;
  po_number?: string | null;
  settlement_pending?: boolean;
};

type EmpGroup = {
  employee_id: number;
  employee_name?: string | null;
  employee_email?: string | null;
  mapping_count: number;
  mappings: PeRow[];
};

type Opt = { id: number; name: string };
const money = (v?: number | null) => (v == null ? "—" : `₹${Number(v).toLocaleString("en-IN")}`);
const dt = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : "—");

function PoChip({ status, pct }: { status?: string | null; pct?: number | null }) {
  const s = (status || "ok").toLowerCase();
  const label =
    s === "blocked" ? "PO blocked" :
    s === "warn_80" ? `PO ${pct != null ? `${Math.round(pct)}%` : "80%+"}` :
    "PO OK";
  const tone =
    s === "blocked" ? "bg-danger-soft text-danger ring-1 ring-inset ring-danger/30" :
    s === "warn_80" ? "bg-warning-soft text-warning ring-1 ring-inset ring-warning/30" :
    "bg-success-soft text-success ring-1 ring-inset ring-success/30";
  return (
    <span className={`inline-flex items-center rounded-control px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {label}
    </span>
  );
}

/* -------------------------------------------------------- map employee modal */

/** Location dropdown (replaces the old free "Work mode"). Labels are what the
 * user reads; values are what the work_mode enum stores. "On Site" maps onto
 * the existing 'Onsite' value so historical rows and the new form agree. */
export const LOCATIONS = [
  { value: "Onsite", label: "On Site" },
  { value: "Off-Shore", label: "Off-Shore" },
  { value: "Remote", label: "Remote" },
] as const;

const UNITS = [
  { value: "Hourly", label: "Per Hour" },
  { value: "Daily", label: "Per Day" },
  { value: "Monthly", label: "Per Month" },
  { value: "Yearly", label: "Per Year" },
] as const;

type RateDraft = { effective_from: string; rate: string };

/** Derive each rate's expiry from the NEXT row's start — never stored, so the
 * table can't contradict itself. Returns view rows sorted by date with:
 * expiry (day before next start, or null for the last row) and whether the
 * row is the one in force today. */
export function deriveRateSchedule(drafts: RateDraft[]): Array<{
  index: number; effective_from: string; rate: string; expiry: string | null; isCurrent: boolean;
}> {
  const dated = drafts
    .map((d, index) => ({ ...d, index }))
    .filter((d) => d.effective_from)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const today = new Date().toISOString().slice(0, 10);
  // Current = latest start <= today; if every start is in the future, the earliest.
  let currentIdx = -1;
  dated.forEach((d, i) => { if (d.effective_from <= today) currentIdx = i; });
  if (currentIdx === -1 && dated.length) currentIdx = 0;
  return dated.map((d, i) => {
    let expiry: string | null = null;
    if (i + 1 < dated.length) {
      const next = new Date(`${dated[i + 1].effective_from}T00:00:00`);
      next.setDate(next.getDate() - 1);
      expiry = next.toISOString().slice(0, 10);
    }
    return { index: d.index, effective_from: d.effective_from, rate: d.rate, expiry, isCurrent: i === currentIdx };
  });
}

const fmtD = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/* ------------------------------------------------------- rate history view */

export type RateRowOut = {
  id?: number;
  effective_from: string | null;
  rate: number | null;
  billing_unit?: string | null;
  is_current_rate?: boolean;
};

/** Every Commercial Details rate with its derived validity range.
 * Reused by the PE list, the project Team tab and the PE detail page, so all
 * three read the same story: rate — from → until (day before the next), the
 * last one open-ended, the one in force today marked Current. */
export function RateHistory({ rates, unit, compact = false }: {
  rates?: RateRowOut[] | null;
  unit?: string | null;
  compact?: boolean;
}) {
  const rows = (rates || [])
    .filter((r) => r.effective_from)
    .sort((a, b) => (a.effective_from! < b.effective_from! ? -1 : 1));
  if (!rows.length) return <span className="text-muted">—</span>;
  const today = new Date().toISOString().slice(0, 10);
  let currentIdx = -1;
  rows.forEach((r, i) => { if (r.effective_from! <= today) currentIdx = i; });
  if (currentIdx === -1) currentIdx = 0;
  return (
    <div className={compact ? "space-y-0.5" : "space-y-1"}>
      {rows.map((r, i) => {
        let until = "onwards";
        if (i + 1 < rows.length) {
          const next = new Date(`${rows[i + 1].effective_from}T00:00:00`);
          next.setDate(next.getDate() - 1);
          until = next.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
        }
        const isCurrent = i === currentIdx;
        return (
          <div key={r.id ?? i}
            className={`flex flex-wrap items-baseline gap-x-2 ${compact ? "text-xs" : "text-sm"} ${isCurrent ? "font-semibold text-primary" : "text-secondary"}`}>
            <span>{money(r.rate)}{(r.billing_unit || unit) ? ` / ${r.billing_unit || unit}` : ""}</span>
            <span className={compact ? "text-[11px] text-muted" : "text-xs text-muted"}>
              {fmtD(r.effective_from)} → {until}
            </span>
            {isCurrent && (
              <span className="inline-flex items-center rounded-control bg-success-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-success">
                Current
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MapModal({ onClose, onSaved, notify }: {
  onClose: () => void; onSaved: () => void; notify: (m: string, k?: "ok" | "err") => void;
}) {
  const [projects, setProjects] = useState<Opt[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [projectId, setProjectId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [unit, setUnit] = useState("Monthly");
  const [location, setLocation] = useState("Onsite");
  const [onboarding, setOnboarding] = useState("");
  const [billingDate, setBillingDate] = useState("");
  const [experience, setExperience] = useState("");
  const [projectExperience, setProjectExperience] = useState("");
  const [isExit, setIsExit] = useState(false);
  const [exitDate, setExitDate] = useState("");
  const [rates, setRates] = useState<RateDraft[]>([{ effective_from: "", rate: "" }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    crmGet<any[]>("/api/projects?limit=500").then((r) => setProjects((r.data || []).map((p) => ({ id: p.id, name: p.name })))).catch(() => {});
    crmGet<any[]>("/api/employees?limit=1000").then((r) => setEmployees(r.data || [])).catch(() => {});
  }, []);

  const empLabel = (e: any) =>
    [e.first_name, e.last_name].filter(Boolean).join(" ") || e.full_name || e.email || `Employee #${e.id}`;

  const selectedEmp = employees.find((e) => String(e.id) === employeeId);
  const schedule = useMemo(() => deriveRateSchedule(rates), [rates]);

  const setRateField = (i: number, key: keyof RateDraft, value: string) =>
    setRates((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!projectId) errs.project = "Select a project";
    if (!employeeId) errs.employee = "Select an employee";
    const complete = rates.filter((r) => r.effective_from && r.rate && Number(r.rate) > 0);
    if (!complete.length) errs.rates = "Add at least one rate with an Effective From date";
    else if (rates.some((r) => (r.effective_from || r.rate) && !(r.effective_from && r.rate && Number(r.rate) > 0)))
      errs.rates = "Every rate row needs both an Effective From date and a rate above zero";
    else if (new Set(complete.map((r) => r.effective_from)).size !== complete.length)
      errs.rates = "Two rows share the same Effective From date — each rate change needs its own date";
    if (isExit && !exitDate) errs.exit = "Set the exit date";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const current = schedule.find((s) => s.isCurrent);
    setSaving(true);
    try {
      const res = await crmPost(`/api/projects/${projectId}/employees`, {
        employee_id: Number(employeeId),
        billing_rate: Number(current?.rate ?? complete[0].rate),
        billing_unit: unit,
        work_mode: location,
        onboarding_date: onboarding || null,
        billing_date: billingDate || null,
        experience_years: experience === "" ? null : Number(experience),
        project_experience_years: projectExperience === "" ? null : Number(projectExperience),
        is_exit: isExit,
        exit_date: isExit ? exitDate : null,
        rates: complete.map((r) => ({ effective_from: r.effective_from, rate: Number(r.rate) })),
      });
      notify((res as any).message || "Employee mapped to project");
      onSaved();
      onClose();
    } catch (err: any) {
      notify(err?.message || "Failed to map employee", "err");
    } finally {
      setSaving(false);
    }
  };

  const sectionTitle = "mb-3 mt-6 border-b border-[color:var(--wiz-border)] pb-2 text-sm font-bold tracking-wide text-primary first:mt-0";
  const thCls = "px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-muted";

  return (
    <Modal
      title={<span className="sr-only">Map employee to project</span>}
      onClose={onClose}
      wide
      scopeClassName="crm-wizard wiz-noise"
      bodyClassName="!px-0 !py-0 sm:!px-0 sm:!py-0"
    >
      <WizFormShell
        title="Map employee to project"
        subtitle="Deploy an employee onto a project — general details, then the commercial rate schedule."
        icon={<Network size={20} aria-hidden />}
      >
        <form onSubmit={submit}>
          <h3 className={sectionTitle}>General</h3>
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            <WizardField label="Employee" required error={errors.employee} icon="user">
              <SearchableSelect
                value={employeeId}
                onChange={setEmployeeId}
                options={employees.map((e) => ({ value: String(e.id), label: empLabel(e) }))}
                placeholder="Search employee…"
                err={errors.employee}
              />
            </WizardField>
            <WizardField label="Employee ID" icon="hash" filled={!!selectedEmp}>
              <input
                className={`${inputCls} bg-surface-2/80 opacity-90`}
                value={selectedEmp ? (selectedEmp.employee_code || `#${selectedEmp.id}`) : ""}
                placeholder="Auto-filled from the employee"
                readOnly
                tabIndex={-1}
              />
            </WizardField>
            <WizardField label="Project" required error={errors.project} icon="building">
              <SearchableSelect
                value={projectId}
                onChange={setProjectId}
                options={projects.map((p) => ({ value: String(p.id), label: p.name }))}
                placeholder="Search project…"
                err={errors.project}
              />
            </WizardField>
            <WizardField label="Onboarding date" icon="calendar" filled={!!onboarding}>
              <input className={inputCls} type="date" value={onboarding} onChange={(e) => setOnboarding(e.target.value)} />
            </WizardField>
            <WizardField label="Experience (years)" icon="hash" filled={experience !== ""}>
              <input className={inputCls} type="number" min={0} max={99} step="0.1" value={experience} onChange={(e) => setExperience(e.target.value)} />
            </WizardField>
            <WizardField label="Project experience (years)" icon="hash" filled={projectExperience !== ""}>
              <input className={inputCls} type="number" min={0} max={99} step="0.1" value={projectExperience} onChange={(e) => setProjectExperience(e.target.value)} />
            </WizardField>
            <WizardField label="Location" icon="map">
              <select className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)}>
                {LOCATIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </WizardField>
            <WizardField label="Billing date" icon="calendar" filled={!!billingDate}>
              <input className={inputCls} type="date" value={billingDate} onChange={(e) => setBillingDate(e.target.value)} />
            </WizardField>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-secondary">
              <input type="checkbox" checked={isExit} onChange={(e) => setIsExit(e.target.checked)} />
              Is exit
            </label>
            {isExit && (
              <WizardField label="Exit date" required error={errors.exit} icon="calendar" filled={!!exitDate}>
                <input className={inputCls} type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
              </WizardField>
            )}
          </div>

          <h3 className={sectionTitle}>Commercial Details</h3>
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            <WizardField label="Unit" icon="hash">
              <select className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)}>
                {UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </WizardField>
          </div>
          <div className="mt-4 overflow-hidden rounded-card border border-subtle">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-subtle bg-surface-2/60">
                  <th className={thCls}>Effective From</th>
                  <th className={thCls}>Rate</th>
                  <th className={thCls}>Rate Expiry</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {rates.map((row, i) => {
                  /* Expiry / current come from the DERIVED schedule, keyed back
                     to this draft row, so edits re-flow the whole table. */
                  const view = schedule.find((s) => s.index === i);
                  return (
                    <tr key={i} className="border-b border-subtle last:border-b-0">
                      <td className="px-3 py-2">
                        <input
                          className={inputCls} type="date" value={row.effective_from}
                          aria-label={`Rate ${i + 1} effective from`}
                          onChange={(e) => setRateField(i, "effective_from", e.target.value)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className={inputCls} type="number" min={0} step="0.01" value={row.rate}
                          aria-label={`Rate ${i + 1} amount`} placeholder="0.00"
                          onChange={(e) => setRateField(i, "rate", e.target.value)}
                        />
                      </td>
                      <td className="px-3 py-2 text-secondary">
                        {view ? (view.expiry ? fmtD(view.expiry) : "No expiry (latest rate)") : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {view?.isCurrent && (
                          <span className="inline-flex items-center rounded-control bg-success-soft px-2 py-0.5 text-xs font-semibold text-success ring-1 ring-inset ring-success/30">
                            Current
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {rates.length > 1 && (
                          <button
                            type="button"
                            className={`rounded-control p-1 text-muted hover:bg-surface-2 hover:text-danger ${focusRing}`}
                            aria-label={`Remove rate ${i + 1}`}
                            onClick={() => setRates((rows) => rows.filter((_, idx) => idx !== i))}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {errors.rates && <div className="mt-2 text-xs font-semibold text-danger" role="alert">{errors.rates}</div>}
          <button
            type="button"
            className={`mt-3 inline-flex items-center gap-1 text-sm font-semibold text-sky-600 hover:underline dark:text-sky-400 ${focusRing} rounded-control`}
            onClick={() => setRates((rows) => [...rows, { effective_from: "", rate: "" }])}
          >
            + Add New
          </button>
          <InfoChip>
            A rate&apos;s expiry is worked out for you: it ends the day before the next rate begins, and
            invoices split automatically when a change lands mid-period. The latest dated rate runs open-ended.
          </InfoChip>
          <div className={wizFooterRow}>
            <button type="button" className={`${btnSecondary} h-10 rounded-xl`} onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className={`${btnPrimary} btn-gradient ml-auto h-10 rounded-xl px-4`} disabled={saving}>{saving ? "Saving…" : "Map employee"}</button>
          </div>
        </form>
      </WizFormShell>
    </Modal>
  );
}

/* ------------------------------------------------------ edit mapping modal */

/** A real edit form for the list's Edit action — before this, Edit navigated
 * to the detail page exactly like View, which made the button a lie. Rates
 * deliberately stay OUT of this form: they are effective-dated history, so
 * they're edited in the Commercial Details section on the detail page. */
function EditMappingModal({ row, onClose, onSaved, notify }: {
  row: PeRow;
  onClose: () => void;
  onSaved: () => void;
  notify: (m: string, k?: "ok" | "err") => void;
}) {
  const [location, setLocation] = useState(row.work_mode || "");
  const [onboarding, setOnboarding] = useState(row.onboarding_date?.slice(0, 10) || "");
  const [billingDate, setBillingDate] = useState(row.billing_date?.slice(0, 10) || "");
  const [experience, setExperience] = useState(row.experience_years != null ? String(row.experience_years) : "");
  const [isActive, setIsActive] = useState(row.is_active !== false);
  const [isExit, setIsExit] = useState(!!row.is_exit);
  const [exitDate, setExitDate] = useState(row.exit_date?.slice(0, 10) || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (isExit && !exitDate) {
      setError("Set the exit date");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await crmPut(`/api/projects/${row.project_id}/employees/${row.id}`, {
        work_mode: location || null,
        onboarding_date: onboarding || null,
        billing_date: billingDate || null,
        experience_years: experience === "" ? null : Number(experience),
        is_active: isActive,
        is_exit: isExit,
        exit_date: isExit ? exitDate : null,
      });
      notify("Project employee updated");
      onSaved();
      onClose();
    } catch (e: any) {
      notify(e?.message || "Failed to update project employee", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Edit — ${row.employee_name || `Employee #${row.employee_id}`}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Location">
            <select className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="">—</option>
              {LOCATIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </Field>
          <Field label="Onboarding date">
            <input type="date" className={inputCls} value={onboarding} onChange={(e) => setOnboarding(e.target.value)} />
          </Field>
          <Field label="Billing date">
            <input type="date" className={inputCls} value={billingDate} onChange={(e) => setBillingDate(e.target.value)} />
          </Field>
          <Field label="Experience (years)">
            <input type="number" min={0} max={99} step="0.1" className={inputCls} value={experience} onChange={(e) => setExperience(e.target.value)} />
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
            <Field label="Exit date" required error={error}>
              <input type="date" className={inputCls} value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
            </Field>
          )}
        </div>
        <p className="text-xs text-muted">
          Billing rates are effective-dated and edited in the Commercial Details section —
          open the mapping to change or add rates.
        </p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={btnPrimary} onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
      </div>
    </Modal>
  );
}

function MappingRow({ r }: { r: PeRow }) {
  return (
    <div className="grid grid-cols-1 gap-2 border-t border-subtle px-4 py-3 sm:grid-cols-6 sm:items-center">
      <div>
        <div className="font-medium text-primary">{r.project_name || "—"}</div>
        <div className="text-xs text-muted">{r.customer_name || "—"}</div>
      </div>
      <div className="text-sm text-secondary">Onboard {dt(r.onboarding_date)}</div>
      <div className="text-sm text-secondary">
        Leave {r.leave_balance_total != null ? Number(r.leave_balance_total).toFixed(1) : "—"}
      </div>
      <div className="text-sm text-secondary">
        {r.rates?.length
          ? <RateHistory rates={r.rates} unit={r.billing_unit} compact />
          : <>{money(r.billing_rate)} / {r.billing_unit || "—"}</>}
      </div>
      <div><PoChip status={r.po_status} pct={r.po_utilization_pct ?? undefined} /></div>
      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <StatusBadge status={r.is_exit ? "Exited" : r.is_active ? "Active" : "Inactive"} />
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded-control border border-subtle bg-surface-1 px-2 py-1 text-xs font-semibold text-secondary hover:bg-surface-2 ${focusRing}`}
          onClick={() => crmNavigate(`project-employees/${r.id}`)}
        >
          <Eye size={13} /> Open
        </button>
      </div>
    </div>
  );
}

function GroupedList({ groups, loading }: { groups: EmpGroup[]; loading: boolean }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  if (loading) {
    return <div className="rounded-card border border-subtle bg-surface-1 p-8 text-center text-muted">Loading…</div>;
  }
  if (!groups.length) {
    return <div className="rounded-card border border-subtle bg-surface-1 p-8 text-center text-muted">No project employees match these filters</div>;
  }
  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const expanded = open[g.employee_id] !== false; // default expanded
        return (
          <div key={g.employee_id} className="overflow-hidden rounded-card border border-subtle bg-surface-1">
            <button
              type="button"
              className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 ${focusRing}`}
              onClick={() => setOpen((s) => ({ ...s, [g.employee_id]: !expanded }))}
            >
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-primary">{g.employee_name || `Employee #${g.employee_id}`}</div>
                <div className="truncate text-xs text-muted">{g.employee_email || ""}</div>
              </div>
              <span className="rounded-control bg-surface-2 px-2 py-0.5 text-xs font-semibold text-secondary">
                {g.mapping_count} mapping{g.mapping_count === 1 ? "" : "s"}
              </span>
            </button>
            {expanded && g.mappings.map((m) => <MappingRow key={m.id} r={m} />)}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- list page */
export function ProjectEmployeesPage() {
  /* Both hooks must run unconditionally (rules-of-hooks) — combine after. */
  // Template-aware: for templated users the template alone decides.
  const canWrite = useCanAct("project-employees", "edit", useHasRole("Sales_Head", "Finance", "HR"));
  const [toast, notify] = useToast();
  const [rows, setRows] = useState<PeRow[]>([]);
  const [groups, setGroups] = useState<EmpGroup[]>([]);
  const [meta, setMeta] = useState<Meta | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [mapping, setMapping] = useState(false);
  // Deep-link create (hub "New …" buttons): ?create=1 opens the dialog once,
  // then strips the flag so refresh / back never reopen it.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("create") === "1") {
      setMapping(true);
      sp.delete("create");
      window.history.replaceState(null, "", `${window.location.pathname}?${sp.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [editing, setEditing] = useState<PeRow | null>(null);
  const [groupByEmployee, setGroupByEmployee] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "exited">("active");
  const [projectFilter, setProjectFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [projects, setProjects] = useState<Opt[]>([]);
  const [customers, setCustomers] = useState<Opt[]>([]);

  useEffect(() => {
    const t = window.setTimeout(() => { setDebounced(search); setPage(1); }, 350);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    crmGet<any[]>("/api/projects?limit=200").then((r) => setProjects((r.data || []).map((p) => ({ id: p.id, name: p.name })))).catch(() => {});
    crmGet<any[]>("/api/customers/names").then((r) => setCustomers((r.data || []).map((c) => ({ id: c.id, name: c.name })))).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (debounced) params.set("search", debounced);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (projectFilter) params.set("project_id", projectFilter);
      if (customerFilter) params.set("customer_id", customerFilter);
      if (groupByEmployee) params.set("group_by", "employee");
      const res = await crmGet<any[]>(`/api/projects/all-employees?${params}`);
      if (groupByEmployee) {
        setGroups((res.data || []) as EmpGroup[]);
        setRows([]);
      } else {
        setRows((res.data || []) as PeRow[]);
        setGroups([]);
      }
      setMeta(res.meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load project employees");
    } finally {
      setLoading(false);
    }
  }, [page, debounced, statusFilter, projectFilter, customerFilter, groupByEmployee]);
  useEffect(() => { load(); }, [load]);

  const columns: Column<PeRow>[] = useMemo(() => [
    {
      key: "employee_name", label: "Employee",
      filter: { type: "text", placeholder: "Name or email…" },
      render: (r) => (
        <div>
          <div className="font-semibold text-primary">{r.employee_name || "—"}</div>
          <div className="text-xs text-muted">{r.employee_email || ""}</div>
        </div>
      ),
    },
    { key: "project_name", label: "Project", render: (r) => r.project_name || "—",
      filter: { type: "select", options: projects.map((p) => ({ value: String(p.id), label: p.name })) } },
    { key: "customer_name", label: "Client", render: (r) => <span className="text-secondary">{r.customer_name || "—"}</span>,
      filter: { type: "select", options: customers.map((c) => ({ value: String(c.id), label: c.name })) } },
    { key: "onboarding_date", label: "Onboarding", render: (r) => dt(r.onboarding_date) },
    {
      key: "leave_balance_total", label: "Leave balance",
      render: (r) => (r.leave_balance_total != null ? Number(r.leave_balance_total).toFixed(1) : "—"),
    },
    {
      key: "billing_rate", label: "Rate history",
      render: (r) => (r.rates?.length
        ? <RateHistory rates={r.rates} unit={r.billing_unit} compact />
        : `${money(r.billing_rate)} / ${r.billing_unit || "—"}`),
    },
    {
      key: "po_status", label: "PO",
      render: (r) => <PoChip status={r.po_status} pct={r.po_utilization_pct ?? undefined} />,
    },
    {
      key: "is_exit", label: "Is exit",
      render: (r) => <StatusBadge status={r.is_exit ? "Exited" : r.is_active ? "Active" : "Inactive"} />,
    },
  ], [projects, customers]);

  return (
    <div>
      {toast}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-display text-xl font-bold text-primary">Project Employees</h1>
          <p className="mt-0.5 text-sm text-muted">
            One row per employee × project. Leave, holidays, timesheet and rate live on the mapping.
          </p>
        </div>
        {canWrite && (
          <button type="button" className={btnPrimary} onClick={() => setMapping(true)}>
            <UserPlus size={15} /> Map employee
          </button>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-card border border-subtle bg-surface-1 p-3">
        <Field label="Project">
          <select className={inputCls} value={projectFilter} onChange={(e) => { setProjectFilter(e.target.value); setPage(1); }}>
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Client">
          <select className={inputCls} value={customerFilter} onChange={(e) => { setCustomerFilter(e.target.value); setPage(1); }}>
            <option value="">All clients</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className={inputCls} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as any); setPage(1); }}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="exited">Exited</option>
          </select>
        </Field>
        <label className={`mb-1 inline-flex cursor-pointer items-center gap-2 text-sm text-secondary ${focusRing} rounded-control px-1`}>
          <input
            type="checkbox"
            checked={groupByEmployee}
            onChange={(e) => { setGroupByEmployee(e.target.checked); setPage(1); }}
          />
          Group by employee
        </label>
      </div>

      {error && <div className="mb-3"><ErrorBox error={error} onRetry={load} /></div>}
      {groupByEmployee ? (
        <GroupedList groups={groups} loading={loading} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          meta={meta}
          headerRight={meta ? <span className="whitespace-nowrap text-xs font-medium text-muted">{meta.total} {meta.total === 1 ? "employee" : "employees"}, page {meta.page}/{Math.max(1, meta.pages || 1)}</span> : undefined}
          loading={loading}
          search={search}
          onSearch={setSearch}
          onPage={setPage}
          onRowClick={(r) => crmNavigate(`project-employees/${r.id}`)}
          /* Header filters (4 Sep 2026) mirror the toolbar's — one state, two
             handles, so a pick in either place shows in both. */
          columnFilters={{
            employee_name: search ? { text: search } : {},
            project_name: projectFilter ? { value: projectFilter } : {},
            customer_name: customerFilter ? { value: customerFilter } : {},
          }}
          onColumnFilter={(key, v) => {
            if (key === "employee_name") setSearch(v?.text || "");
            else if (key === "project_name") { setProjectFilter(v?.value || ""); setPage(1); }
            else if (key === "customer_name") { setCustomerFilter(v?.value || ""); setPage(1); }
          }}
          emptyMessage={<TeachingEmpty page="project-employees" />}
          rowActions={canWrite ? (r) => (
            <RowActions
              entity="project employee"
              itemLabel={r.employee_name || r.project_name}
              onView={() => crmNavigate(`project-employees/${r.id}`)}
              /* Edit opens a real form now — it used to navigate to the same
                 page as View, which made the two buttons identical. */
              onEdit={() => setEditing(r)}
              deleteUrl={`/api/projects/employees/${r.id}`}
              onDeleted={() => afterListDelete(r.id, setRows, load)}
              notify={notify}
              canEdit
              canDelete
            colored />
          ) : undefined}
        />
      )}
      {mapping && <MapModal onClose={() => setMapping(false)} onSaved={load} notify={notify} />}
      {editing && <EditMappingModal row={editing} onClose={() => setEditing(null)} onSaved={load} notify={notify} />}
    </div>
  );
}
