/**
 * Leave Billing Policy add/edit popup for Create + Edit Project wizards.
 * Title: "Leave Billing Policy". Field order matches SOURCE form spec.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Modal, ConfirmModal, btnDanger, btnPrimary, btnSecondary, inputCls } from "./ui";
import { FieldLabel } from "./wizard";
import {
  LEAVE_CREDIT_TYPE_CHOICES,
  LEAVE_EXPIRE_CHOICES,
  chk,
  emptyLeaveRow,
  type LeaveRow,
  type LeaveType,
} from "./ProjectPolicySections";
import { PeriodTimingPicker } from "./PeriodTimingPicker";

function formatDisplayDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .replace(/ /g, "-");
}

export function LeaveBillingPolicyModal({
  initial,
  leaveTypes,
  addingType,
  onClose,
  onSave,
  onDelete,
  onAddType,
}: {
  initial: LeaveRow | null;
  leaveTypes: LeaveType[];
  addingType: boolean;
  onClose: () => void;
  onSave: (row: LeaveRow) => void | Promise<void>;
  onDelete: (row: LeaveRow) => void | Promise<void>;
  onAddType: (name: string) => Promise<LeaveType | null>;
}) {
  const [form, setForm] = useState<LeaveRow>(() => initial ?? emptyLeaveRow());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typeQuery, setTypeQuery] = useState("");
  const [typeOpen, setTypeOpen] = useState(false);

  useEffect(() => {
    setForm(initial ?? emptyLeaveRow());
    setErrors({});
    setTypeQuery("");
    setTypeOpen(false);
  }, [initial]);

  const selectedType = leaveTypes.find((t) => String(t.id) === form.leave_type_id);
  const filtered = useMemo(() => {
    const q = typeQuery.trim().toLowerCase();
    if (!q) return leaveTypes;
    return leaveTypes.filter((t) => t.name.toLowerCase().includes(q));
  }, [leaveTypes, typeQuery]);

  const set = (patch: Partial<LeaveRow>) => setForm((s) => ({ ...s, ...patch }));

  const pickType = (t: LeaveType) => {
    set({
      leave_type_id: String(t.id),
      // `name` always mirrors the selected leave type — no separate edit path.
      name: t.name,
    });
    setTypeQuery("");
    setTypeOpen(false);
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.leave_type_id) errs.leave_type_id = "Leave Name is required";
    if (!form.leave_credit_type) errs.leave_credit_type = "Leave Credit Type is required";
    if (!form.leave_expire) errs.leave_expire = "Leave Expire is required";
    if (form.leave_credit_balance !== "" && Number.isNaN(Number(form.leave_credit_balance))) {
      errs.leave_credit_balance = "Must be a number";
    }
    const mcf = form.maximum_carry_forward === "" ? 0 : Number(form.maximum_carry_forward);
    if (!Number.isInteger(mcf) || mcf < 0) {
      errs.maximum_carry_forward = "Must be a whole number ≥ 0";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setBusy(true);
    try {
      const normalized: LeaveRow = {
        ...form,
        leave_credit_timing: form.leave_credit_timing || "Start_Of_Period",
        leave_expire_timing: form.leave_expire
          ? (form.leave_expire_timing || "End_Of_Period")
          : "",
        maximum_carry_forward: form.maximum_carry_forward === "" ? "0" : String(Math.trunc(Number(form.maximum_carry_forward))),
      };
      await onSave(normalized);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await onDelete(form);
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };

  const handleAddType = async () => {
    const q = typeQuery.trim();
    if (!q) {
      setErrors((e) => ({ ...e, leave_type_id: "Enter a leave name to add" }));
      return;
    }
    const created = await onAddType(q);
    if (created) pickType(created);
  };

  return (
    <Modal title="Leave Billing Policy" onClose={onClose} medium>
      <div className="space-y-4">
        {/* 1. Leave Name — the ONLY name field. The free-text "Name" twin is
            gone: two name columns holding the same value invited them to
            drift apart, and a policy renamed away from its leave type broke
            the timesheet's per-type billability lookup (matched by name). */}
        <div>
          <FieldLabel label="Leave Name" />
          {selectedType && !typeOpen ? (
            // Committed value is locked — editing it would detach the label
            // from the leave type it identifies. "Change" re-opens the search.
            <div className="flex items-center gap-2">
              <div className={`${inputCls} flex items-center bg-surface-2/50 text-primary`} aria-readonly="true">
                {selectedType.name}
              </div>
              <button
                type="button"
                className={`${btnSecondary} !px-2.5 !py-1.5 text-xs`}
                onClick={() => {
                  setTypeQuery("");
                  setTypeOpen(true);
                }}
              >
                Change
              </button>
            </div>
          ) : (
            <input
              className={inputCls}
              placeholder="-Select-"
              value={typeQuery}
              onFocus={() => setTypeOpen(true)}
              onChange={(e) => {
                setTypeQuery(e.target.value);
                setTypeOpen(true);
                set({ leave_type_id: "" });
              }}
              onBlur={() => {
                // Delay so option click registers
                window.setTimeout(() => setTypeOpen(false), 150);
              }}
              autoComplete="off"
            />
          )}
          {typeOpen && (
            <div className="mt-1 max-h-40 overflow-y-auto rounded-control border border-subtle bg-surface-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted">No matches</div>
              ) : (
                filtered.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm text-primary hover:bg-surface-2"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickType(t)}
                  >
                    {t.name}
                  </button>
                ))
              )}
            </div>
          )}
          <button
            type="button"
            className={`${btnSecondary} mt-1.5 !px-2 !py-1 text-xs`}
            disabled={addingType || busy}
            onClick={() => void handleAddType()}
          >
            <Plus size={12} /> Add New
          </button>
          {errors.leave_type_id && (
            <p className="mt-1 text-xs text-danger" role="alert">{errors.leave_type_id}</p>
          )}
        </div>

        {/* 3. Leave Credit Type * */}
        <div>
          <FieldLabel label="Leave Credit Type" required />
          <select
            className={inputCls}
            value={form.leave_credit_type}
            onChange={(e) => {
              const leave_credit_type = e.target.value;
              set({
                leave_credit_type,
                leave_credit_timing: form.leave_credit_timing || "Start_Of_Period",
              });
            }}
          >
            <option value="">-Select-</option>
            {LEAVE_CREDIT_TYPE_CHOICES.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          {errors.leave_credit_type && (
            <p className="mt-1 text-xs text-danger" role="alert">{errors.leave_credit_type}</p>
          )}
          <PeriodTimingPicker
            cycle={form.leave_credit_type}
            value={form.leave_credit_timing}
            verb="Credit"
            onChange={(v) => set({ leave_credit_timing: v })}
          />
        </div>

        {/* 4. Leave Credit Balance */}
        <div>
          <FieldLabel label="Leave Credit Balance" />
          <input
            type="number"
            step="0.01"
            min={0}
            className={inputCls}
            placeholder="######.##"
            value={form.leave_credit_balance}
            onChange={(e) => set({ leave_credit_balance: e.target.value })}
          />
          {errors.leave_credit_balance && (
            <p className="mt-1 text-xs text-danger" role="alert">{errors.leave_credit_balance}</p>
          )}
        </div>

        {/* 6. Leave_Expire * */}
        <div>
          <FieldLabel label="Leave_Expire" required />
          <select
            className={inputCls}
            value={form.leave_expire}
            onChange={(e) => {
              const leave_expire = e.target.value;
              set({
                leave_expire,
                leave_expire_timing: leave_expire
                  ? (form.leave_expire_timing || "End_Of_Period")
                  : "",
              });
            }}
          >
            <option value="">-Select-</option>
            {LEAVE_EXPIRE_CHOICES.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          {errors.leave_expire && (
            <p className="mt-1 text-xs text-danger" role="alert">{errors.leave_expire}</p>
          )}
          <PeriodTimingPicker
            cycle={form.leave_expire}
            value={form.leave_expire_timing}
            verb="Expire"
            onChange={(v) => set({ leave_expire_timing: v })}
          />
        </div>

        {/* 7. Is Max Limit */}
        <label className="flex items-center gap-2 text-sm font-medium text-primary">
          <input
            type="checkbox"
            className={chk}
            checked={form.is_max_limit}
            onChange={(e) => set({ is_max_limit: e.target.checked })}
          />
          Is Max Limit
        </label>

        {/* 8. Maximum Carry Forward */}
        <div>
          <FieldLabel label="Maximum Carry Forward" />
          <input
            type="number"
            step={1}
            min={0}
            className={inputCls}
            value={form.maximum_carry_forward}
            onChange={(e) => set({ maximum_carry_forward: e.target.value })}
          />
          {errors.maximum_carry_forward && (
            <p className="mt-1 text-xs text-danger" role="alert">{errors.maximum_carry_forward}</p>
          )}
        </div>

        {/* 10. System Fields — header only */}
        <div className="border-t border-subtle pt-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">System Fields</p>
          <p className="mt-1 text-[11px] text-muted">
            Created / modified timestamps are set by the server and are not editable here.
          </p>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          className={btnDanger}
          disabled={busy}
          onClick={() => setConfirmDelete(true)}
        >
          Delete
        </button>
        <button
          type="button"
          className={btnPrimary}
          disabled={busy}
          onClick={() => void handleSave()}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {confirmDelete && (
        <ConfirmModal
          title="Delete a leave policy?"
          message={<>Do you want to delete this leave billing policy row? This cannot be undone.</>}
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={() => { void handleDelete(); }}
          onClose={() => { if (!busy) setConfirmDelete(false); }}
        />
      )}
    </Modal>
  );
}
